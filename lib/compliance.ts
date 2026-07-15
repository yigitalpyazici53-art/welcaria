import { getRedis } from "./redis";

// ── Meta ban-protection / compliance layer ────────────────────────────────────
//
// This module is the deterministic rule engine that protects client WhatsApp
// numbers from Meta quality-rating drops, restrictions, and bans. Every
// patient-facing outbound send MUST pass complianceGate() (via
// lib/outboundSend.ts) before a transport is invoked. The LLM never
// participates in any decision here — everything is code, config, and Redis
// state.
//
// Protections implemented:
//   1. 24-hour customer-service-window enforcement (hard gate)
//   2. Inbound-only guarantee (never initiate a conversation)
//   3. Per-thread reply caps + pacing floor, per-tenant token bucket
//   4. Quality-rating circuit breaker (GREEN / YELLOW / RED)
//   5. Coexistence inactivity tracking (day-10 operator nudge)
//
// Storage follows the conversationState pattern: Redis first, in-process
// memory fallback so a Redis outage never crashes the reply path. Writes are
// mirrored to memory so a same-request read always sees them. Fail-closed:
// when neither store can prove the window is open, the send is blocked.

export type QualityState = "GREEN" | "YELLOW" | "RED";

export type ComplianceDecision =
  | "ALLOWED"
  | "BLOCKED_WINDOW_CLOSED"
  | "BLOCKED_NO_INBOUND_HISTORY"
  | "RATE_LIMITED"
  | "CIRCUIT_OPEN";

export type ComplianceEvent =
  | ComplianceDecision
  | "COMPLIANCE_VIOLATION_ATTEMPT"
  | "QUALITY_STATE_CHANGE"
  | "INACTIVITY_NUDGE";

export type OutboundKind = "bot_reply" | "booking_handoff" | "system" | "test";

/** Gate-level channel. "sms" skips WhatsApp-only rules (window, inbound-only, breaker). */
export type GateChannel = "meta" | "twilio_whatsapp" | "sms";

// ── Env-configurable thresholds (safe defaults, read at call time) ────────────

function envNumber(name: string, def: number, min = 0): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return def;
  const v = Number(raw);
  return Number.isFinite(v) && v >= min ? v : def;
}

export function getWindowMs(): number {
  return envNumber("COMPLIANCE_WINDOW_HOURS", 24, 1) * 60 * 60 * 1000;
}

export function getThreadMinGapMs(): number {
  return envNumber("COMPLIANCE_THREAD_MIN_GAP_SECONDS", 3) * 1000;
}

export function getMaxSendsPerInbound(): number {
  return envNumber("COMPLIANCE_MAX_SENDS_PER_INBOUND", 2, 1);
}

export function getTenantRatePerSecond(): number {
  return envNumber("COMPLIANCE_TENANT_RATE_PER_SECOND", 5, 1);
}

export function getInactivityNudgeDays(): number {
  return envNumber("COMPLIANCE_INACTIVITY_NUDGE_DAYS", 10, 1);
}

/** Single-tenant deployments: the tenant is the clinic's WhatsApp number identity. */
export function getDefaultTenantId(): string {
  return (
    process.env.META_WHATSAPP_PHONE_NUMBER_ID ??
    process.env.TWILIO_PHONE_NUMBER ??
    "default"
  );
}

// ── Pure decision functions (unit-tested, no I/O) ─────────────────────────────

export type WindowStatus = "open" | "closed" | "no_history";

/**
 * Window is OPEN strictly when now - lastInboundAt < windowMs. At exactly the
 * boundary the window is CLOSED — the conservative side of Meta's 24h rule.
 */
export function windowStatus(
  lastInboundAt: number | null,
  now: number,
  windowMs: number
): WindowStatus {
  if (lastInboundAt === null) return "no_history";
  return now - lastInboundAt < windowMs ? "open" : "closed";
}

export interface TokenBucketState {
  tokens: number;
  refilledAt: number;
}

/**
 * Token bucket with capacity == refill rate (1 second of burst). A fresh
 * bucket starts full. Returns the post-take state so the caller persists it.
 */
export function takeToken(
  state: TokenBucketState | null,
  now: number,
  ratePerSecond: number
): { allowed: boolean; state: TokenBucketState } {
  const capacity = ratePerSecond;
  let tokens = capacity;
  if (state) {
    const elapsedMs = Math.max(0, now - state.refilledAt);
    tokens = Math.min(capacity, state.tokens + (elapsedMs / 1000) * ratePerSecond);
  }
  if (tokens >= 1) {
    return { allowed: true, state: { tokens: tokens - 1, refilledAt: now } };
  }
  return { allowed: false, state: { tokens, refilledAt: now } };
}

/**
 * Maps a Meta/360dialog account-level webhook change to a quality state.
 * Returns null when the event carries no quality signal. Unknown degrade-ish
 * events are deliberately NOT guessed — only explicit signals move the state.
 */
export function applyQualityEvent(
  field: string,
  value: Record<string, unknown>
): QualityState | null {
  const event = String(value.event ?? "").toUpperCase();
  if (field === "phone_number_quality_update") {
    if (event === "FLAGGED") return "RED";
    if (event === "DOWNGRADE") return "YELLOW";
    if (event === "UNFLAGGED" || event === "UPGRADE") return "GREEN";
    return null;
  }
  if (field === "account_update") {
    if (
      event === "DISABLED_UPDATE" ||
      event === "ACCOUNT_VIOLATION" ||
      event === "ACCOUNT_RESTRICTION"
    ) {
      return "RED";
    }
    return null;
  }
  return null;
}

// ── Redis keys + memory-fallback KV ───────────────────────────────────────────

const P = "compliance:";
const LOG_KEY = `${P}log`;
const TENANTS_KEY = `${P}tenants`;
const LOG_MAX_ENTRIES = 1000;

function lastInboundKey(thread: string): string {
  return `${P}lastInbound:${thread}`;
}
function threadSendKey(thread: string): string {
  return `${P}threadSend:${thread}`;
}
function qualityKey(tenantId: string): string {
  return `${P}quality:${tenantId}`;
}
function breakerKey(tenantId: string): string {
  return `${P}breaker:${tenantId}`;
}
function bucketKey(tenantId: string): string {
  return `${P}bucket:${tenantId}`;
}
function activityKey(tenantId: string): string {
  return `${P}activity:${tenantId}`;
}

const memKv = new Map<string, { value: string; expiresAt: number | null }>();
const memTenants = new Set<string>();

function memGet(key: string): string | null {
  const entry = memKv.get(key);
  if (!entry) return null;
  if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
    memKv.delete(key);
    return null;
  }
  return entry.value;
}

function memSet(key: string, value: string, ttlSeconds?: number): void {
  memKv.set(key, {
    value,
    expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null,
  });
}

async function kvGet(key: string): Promise<string | null> {
  const r = getRedis();
  if (r) {
    try {
      const raw = await r.get(key);
      if (raw !== null && raw !== undefined) {
        return typeof raw === "string" ? raw : JSON.stringify(raw);
      }
      // Absent in Redis — a prior write may have landed only in memory.
      return memGet(key);
    } catch (err) {
      console.error(
        "[Compliance] Redis get failed, falling back to memory:",
        err instanceof Error ? err.message : err
      );
      return memGet(key);
    }
  }
  return memGet(key);
}

async function kvSet(key: string, value: string, ttlSeconds?: number): Promise<void> {
  // Memory mirror first so a same-request read always sees the write.
  memSet(key, value, ttlSeconds);
  const r = getRedis();
  if (r) {
    try {
      await r.set(key, value, ttlSeconds ? { ex: ttlSeconds } : undefined);
    } catch (err) {
      console.error(
        "[Compliance] Redis set failed (memory mirror retained):",
        err instanceof Error ? err.message : err
      );
    }
  }
}

async function kvDel(key: string): Promise<void> {
  memKv.delete(key);
  const r = getRedis();
  if (r) {
    try {
      await r.del(key);
    } catch {}
  }
}

// ── Structured compliance log (audit trail) ───────────────────────────────────

export interface ComplianceLogEntry {
  ts: string;
  event: ComplianceEvent;
  tenantId: string;
  thread?: string;
  kind?: OutboundKind;
  channel?: GateChannel;
  detail?: string;
}

export async function logCompliance(entry: ComplianceLogEntry): Promise<void> {
  const line = JSON.stringify(entry);
  if (entry.event === "ALLOWED") {
    console.log(`[Compliance] ${line}`);
  } else {
    console.warn(`[Compliance] ${line}`);
  }
  const r = getRedis();
  if (r) {
    try {
      await r.lpush(LOG_KEY, line);
      await r.ltrim(LOG_KEY, 0, LOG_MAX_ENTRIES - 1);
    } catch (err) {
      console.error(
        "[Compliance] Failed to persist audit entry:",
        err instanceof Error ? err.message : err
      );
    }
  }
}

// Stub — replace with a real channel (email/Slack) when operator alerting lands.
function notifyOperatorStub(reason: string): void {
  // TODO(operator-alerting): wire to email/Slack. Console-only for now.
  console.error(`[Compliance] OPERATOR NOTIFICATION (stub): ${reason}`);
}

// ── Inbound recording + activity tracking ─────────────────────────────────────

interface ThreadSendMeta {
  lastSendAt: number | null;
  totalSinceInbound: number;
  botRepliesSinceInbound: number;
}

const THREAD_META_TTL_S = 72 * 60 * 60;

async function getThreadSendMeta(thread: string): Promise<ThreadSendMeta> {
  const raw = await kvGet(threadSendKey(thread));
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<ThreadSendMeta>;
      return {
        lastSendAt: typeof parsed.lastSendAt === "number" ? parsed.lastSendAt : null,
        totalSinceInbound: parsed.totalSinceInbound ?? 0,
        botRepliesSinceInbound: parsed.botRepliesSinceInbound ?? 0,
      };
    } catch {}
  }
  return { lastSendAt: null, totalSinceInbound: 0, botRepliesSinceInbound: 0 };
}

async function setThreadSendMeta(thread: string, meta: ThreadSendMeta): Promise<void> {
  await kvSet(threadSendKey(thread), JSON.stringify(meta), THREAD_META_TTL_S);
}

/**
 * MUST be called for every inbound patient message (the shared pipeline does).
 * Persists lastInboundAt (TTL = 3× the window so the key outlives 24h with
 * ample margin), resets the per-inbound reply counters, and records tenant
 * activity for the coexistence inactivity check.
 */
export async function recordInboundMessage(
  thread: string,
  tenantId: string,
  at: number = Date.now()
): Promise<void> {
  const ttlSeconds = Math.ceil((getWindowMs() * 3) / 1000);
  await kvSet(lastInboundKey(thread), String(at), ttlSeconds);
  const meta = await getThreadSendMeta(thread);
  await setThreadSendMeta(thread, {
    lastSendAt: meta.lastSendAt, // pacing floor persists across inbound turns
    totalSinceInbound: 0,
    botRepliesSinceInbound: 0,
  });
  await recordActivity(tenantId, at);
}

export async function getLastInboundAt(thread: string): Promise<number | null> {
  const raw = await kvGet(lastInboundKey(thread));
  if (!raw) return null;
  const ts = Number(raw);
  return Number.isFinite(ts) ? ts : null;
}

/** Any inbound or successful outbound on the tenant's number counts as activity. */
export async function recordActivity(
  tenantId: string,
  at: number = Date.now()
): Promise<void> {
  await kvSet(activityKey(tenantId), String(at));
  memTenants.add(tenantId);
  const r = getRedis();
  if (r) {
    try {
      await r.sadd(TENANTS_KEY, tenantId);
    } catch {}
  }
}

export async function getLastActivityAt(tenantId: string): Promise<number | null> {
  const raw = await kvGet(activityKey(tenantId));
  if (!raw) return null;
  const ts = Number(raw);
  return Number.isFinite(ts) ? ts : null;
}

export async function listKnownTenants(): Promise<string[]> {
  const tenants = new Set<string>(memTenants);
  const r = getRedis();
  if (r) {
    try {
      const members = await r.smembers(TENANTS_KEY);
      for (const m of members) tenants.add(String(m));
    } catch (err) {
      console.error(
        "[Compliance] Failed to list tenants from Redis:",
        err instanceof Error ? err.message : err
      );
    }
  }
  return Array.from(tenants);
}

/**
 * Coexistence keepalive check: flags tenants idle >= nudge threshold so an
 * operator can generate activity before the ~13–14 day disconnect. NEVER
 * sends anything to patients — operator alerting only.
 */
export async function checkInactivityNudges(
  now: number = Date.now()
): Promise<Array<{ tenantId: string; idleDays: number }>> {
  const nudgeMs = getInactivityNudgeDays() * 24 * 60 * 60 * 1000;
  const flagged: Array<{ tenantId: string; idleDays: number }> = [];
  for (const tenantId of await listKnownTenants()) {
    const last = await getLastActivityAt(tenantId);
    if (last === null) continue;
    const idleMs = now - last;
    if (idleMs >= nudgeMs) {
      const idleDays = Math.floor(idleMs / (24 * 60 * 60 * 1000));
      flagged.push({ tenantId, idleDays });
      await logCompliance({
        ts: new Date(now).toISOString(),
        event: "INACTIVITY_NUDGE",
        tenantId,
        detail: `idle ${idleDays}d — coexistence disconnects after ~13-14d of inactivity`,
      });
      notifyOperatorStub(
        `tenant ${tenantId} idle ${idleDays} days — generate activity on the number to avoid coexistence disconnect`
      );
    }
  }
  return flagged;
}

// ── Quality-rating circuit breaker ────────────────────────────────────────────

export async function getQualityState(tenantId: string): Promise<QualityState> {
  const raw = await kvGet(qualityKey(tenantId));
  return raw === "YELLOW" || raw === "RED" ? raw : "GREEN";
}

export async function setQualityState(
  tenantId: string,
  state: QualityState,
  source = "manual"
): Promise<void> {
  const previous = await getQualityState(tenantId);
  await kvSet(qualityKey(tenantId), state);
  if (previous !== state) {
    await logCompliance({
      ts: new Date().toISOString(),
      event: "QUALITY_STATE_CHANGE",
      tenantId,
      detail: `${previous} -> ${state} (source: ${source})`,
    });
  }
  if (state === "RED") {
    await logCompliance({
      ts: new Date().toISOString(),
      event: "CIRCUIT_OPEN",
      tenantId,
      detail: `quality RED — all bot sends stopped (source: ${source})`,
    });
    notifyOperatorStub(
      `circuit breaker OPEN for tenant ${tenantId} — quality rating RED, bot sends stopped`
    );
  } else if (state === "YELLOW") {
    console.warn(
      `[Compliance] ⚠️ QUALITY YELLOW for tenant ${tenantId} — per-tenant rate limit halved`
    );
  }
}

/** Manual operator override, independent of webhook-driven quality state. */
export async function setManualBreaker(tenantId: string, open: boolean): Promise<void> {
  if (open) {
    await kvSet(breakerKey(tenantId), "open");
  } else {
    await kvDel(breakerKey(tenantId));
  }
}

/**
 * Breaker is OPEN when quality is RED, the per-tenant Redis flag is set, or
 * the COMPLIANCE_FORCE_CIRCUIT_OPEN env kill switch is on. Recovery to GREEN
 * (or clearing the flags) closes it.
 */
export async function isCircuitOpen(tenantId: string): Promise<boolean> {
  if ((process.env.COMPLIANCE_FORCE_CIRCUIT_OPEN ?? "").toLowerCase() === "true") {
    return true;
  }
  if ((await kvGet(breakerKey(tenantId))) === "open") return true;
  return (await getQualityState(tenantId)) === "RED";
}

/** YELLOW halves the configured per-tenant rate (floored, never below 1/s). */
export async function getEffectiveRatePerSecond(tenantId: string): Promise<number> {
  const rate = getTenantRatePerSecond();
  const quality = await getQualityState(tenantId);
  return quality === "YELLOW" ? Math.max(1, Math.floor(rate / 2)) : rate;
}

async function takeTenantToken(
  tenantId: string,
  ratePerSecond: number,
  now: number
): Promise<boolean> {
  const raw = await kvGet(bucketKey(tenantId));
  let state: TokenBucketState | null = null;
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as TokenBucketState;
      if (typeof parsed.tokens === "number" && typeof parsed.refilledAt === "number") {
        state = parsed;
      }
    } catch {}
  }
  const result = takeToken(state, now, ratePerSecond);
  await kvSet(bucketKey(tenantId), JSON.stringify(result.state), 120);
  return result.allowed;
}

// ── The gate ──────────────────────────────────────────────────────────────────

export interface GateParams {
  tenantId: string;
  thread: string;
  kind: OutboundKind;
  channel: GateChannel;
  /** Injectable clock/sleep for deterministic tests. */
  now?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface GateResult {
  allowed: boolean;
  decision: ComplianceDecision;
}

const defaultSleep = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));

/**
 * The single mandatory compliance decision for an outbound send. Checks run
 * in severity order: circuit breaker → inbound-only → 24h window → per-thread
 * caps → pacing floor (waits, does not block) → per-tenant token bucket.
 * Every decision is written to the audit log. Deterministic — no LLM input.
 */
export async function complianceGate(params: GateParams): Promise<GateResult> {
  const { tenantId, thread, kind, channel } = params;
  const now = params.now ?? Date.now();
  const sleep = params.sleep ?? defaultSleep;
  const isWhatsApp = channel !== "sms";

  const log = (event: ComplianceEvent, detail?: string) =>
    logCompliance({
      ts: new Date(now).toISOString(),
      event,
      tenantId,
      thread,
      kind,
      channel,
      detail,
    });

  // 1. Circuit breaker — RED quality / manual trip stops WhatsApp sends cold.
  if (isWhatsApp && (await isCircuitOpen(tenantId))) {
    await log("CIRCUIT_OPEN", "circuit breaker open — send stopped");
    return { allowed: false, decision: "CIRCUIT_OPEN" };
  }

  if (isWhatsApp) {
    const lastInboundAt = await getLastInboundAt(thread);
    const status = windowStatus(lastInboundAt, now, getWindowMs());

    // 2. Inbound-only guarantee: no inbound history → structurally forbidden.
    if (status === "no_history") {
      await log(
        "COMPLIANCE_VIOLATION_ATTEMPT",
        "send attempted to a thread with no inbound message history"
      );
      await log("BLOCKED_NO_INBOUND_HISTORY");
      return { allowed: false, decision: "BLOCKED_NO_INBOUND_HISTORY" };
    }

    // 3. 24h customer-service window: closed → only approved templates may go
    //    out, and none exist yet (see sendTemplate stub) → block.
    if (status === "closed") {
      await log(
        "BLOCKED_WINDOW_CLOSED",
        "outside 24h customer service window — free-form sends forbidden, no approved templates configured"
      );
      return { allowed: false, decision: "BLOCKED_WINDOW_CLOSED" };
    }
  }

  // 4. Per-thread caps: at most 1 bot reply per inbound patient message, and a
  //    hard total cap per inbound (reply + booking handoff by default).
  //    `system` sends are operator/owner-initiated (manual inbox replies,
  //    missed-call texts) — they are NOT part of the bot's automatic send
  //    budget, so they bypass the per-inbound total cap. The 24h window, the
  //    inbound-only guarantee, and the circuit breaker above still apply.
  const meta = await getThreadSendMeta(thread);
  if (kind === "bot_reply" && meta.botRepliesSinceInbound >= 1) {
    await log("RATE_LIMITED", "max 1 bot reply per inbound patient message");
    return { allowed: false, decision: "RATE_LIMITED" };
  }
  if (kind !== "system" && meta.totalSinceInbound >= getMaxSendsPerInbound()) {
    await log(
      "RATE_LIMITED",
      `per-inbound send cap reached (${getMaxSendsPerInbound()})`
    );
    return { allowed: false, decision: "RATE_LIMITED" };
  }

  // 5. Pacing floor: never machine-gun a thread. Waits out the remainder of
  //    the gap instead of blocking, so booking handoffs still arrive.
  const gapMs = getThreadMinGapMs();
  if (meta.lastSendAt !== null && gapMs > 0) {
    const elapsed = now - meta.lastSendAt;
    if (elapsed >= 0 && elapsed < gapMs) {
      await sleep(gapMs - elapsed);
    }
  }

  // 6. Per-tenant token bucket, well under Meta's 20 msg/s coexistence cap.
  //    Brief bounded retries, then drop with a warning — never burst.
  const rate = await getEffectiveRatePerSecond(tenantId);
  let tokenTaken = false;
  for (let attempt = 0; attempt < 4; attempt++) {
    tokenTaken = await takeTenantToken(tenantId, rate, params.now ?? Date.now());
    if (tokenTaken) break;
    await sleep(250);
  }
  if (!tokenTaken) {
    await log("RATE_LIMITED", `tenant token bucket empty (rate ${rate}/s) — dropped`);
    return { allowed: false, decision: "RATE_LIMITED" };
  }

  // Reserve the send before the transport call — conservative on failure.
  await setThreadSendMeta(thread, {
    lastSendAt: params.now ?? Date.now(),
    totalSinceInbound: meta.totalSinceInbound + 1,
    botRepliesSinceInbound: meta.botRepliesSinceInbound + (kind === "bot_reply" ? 1 : 0),
  });
  await log("ALLOWED");
  return { allowed: true, decision: "ALLOWED" };
}

/**
 * Handles account-level (non-message) webhook changes from Meta/360dialog:
 * quality rating updates, messaging-limit changes, account restrictions.
 * Only explicit signals move the quality state.
 */
export async function handleAccountLevelWebhook(
  field: string,
  value: Record<string, unknown>,
  tenantId: string = getDefaultTenantId()
): Promise<void> {
  const next = applyQualityEvent(field, value);
  console.log(
    `[Compliance] account-level webhook field=${field} event=${String(value.event ?? "(none)")} mapped=${next ?? "(no change)"}`
  );
  if (next) {
    await setQualityState(tenantId, next, `webhook:${field}`);
  }
}

// ── Test helpers ──────────────────────────────────────────────────────────────

export async function _resetComplianceForTest(): Promise<void> {
  memKv.clear();
  memTenants.clear();
}
