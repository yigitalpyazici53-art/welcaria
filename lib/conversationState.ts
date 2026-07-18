import { getRedis } from "./redis";

export type Stage =
  | "collect_treatment_area"
  | "collect_qualification"
  | "collect_datetime"
  | "collect_name"
  | "complete";

export type ServiceCategory = "laser" | "hair_transplant" | "dental" | "other";

export type UrgencyLevel = "low" | "medium" | "high";
export type LeadScore = "hot" | "warm" | "cold";

export interface ConversationState {
  name?: string;
  phone?: string;
  service?: string;
  treatmentArea?: string;
  firstTimeLaser?: boolean;
  priceInquired?: boolean;
  preferredDate?: string;
  preferredTime?: string;
  location?: string;
  urgency?: UrgencyLevel;
  source?: string;
  notes?: string;
  leadScore?: LeadScore;
  stage: Stage;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  lastUpdated: number;
  ownerAlertedHighUrgency?: boolean;
  ownerAlertedComplete?: boolean;
  sheetLoggedComplete?: boolean;
  bookingLinkSent?: boolean;
  // When true, the bot stops auto-replying so a human owner can take over the thread.
  humanHandoff?: boolean;
  // KVKK consent: set true once the AI-intake disclosure has been sent on the
  // first turn of a conversation, so it is shown exactly once. consentTimestamp
  // is the epoch-ms time of that disclosure (an auditable consent record).
  consentGiven?: boolean;
  consentTimestamp?: number;
  // Qualification fields
  serviceCategory?: ServiceCategory;
  travellingFromAbroad?: boolean;
  estimatedGrafts?: number;
  dentalTreatmentType?: string;
  teethCountOrScope?: string;
  treatmentTimeline?: string;
  qualificationNotes?: string;
  // Premium clinic capability signals
  availabilityInquiry?: boolean;
  deviceInquiry?: boolean;
  preTreatmentInquiry?: boolean;
  detectedLanguage?: string;
}

const KEY_PREFIX = "conv:";
const STATE_TTL_S = 24 * 60 * 60;
const STATE_TTL_MS = STATE_TTL_S * 1000;

const memStore = new Map<string, ConversationState>();

const VALID_STAGES: Stage[] = ["collect_treatment_area", "collect_qualification", "collect_datetime", "collect_name", "complete"];

// Normalizes persisted stage values. Handles the legacy "collect_first_time" ghost stage
// (which getNextStage() never returned) so old Redis keys do not get stuck.
function normalizeLegacyStage(raw: Record<string, unknown>): Stage {
  const s = String(raw.stage ?? "");
  if (s === "collect_first_time") {
    if (!raw.treatmentArea && !raw.service) return "collect_treatment_area";
    if (!raw.preferredDate && !raw.preferredTime) return "collect_datetime";
    if (!raw.name) return "collect_name";
    return "complete";
  }
  return VALID_STAGES.includes(s as Stage) ? (s as Stage) : "collect_treatment_area";
}

function applyNorm(state: ConversationState): ConversationState {
  const stage = normalizeLegacyStage(state as unknown as Record<string, unknown>);
  return stage === (state.stage as string) ? state : { ...state, stage };
}

function freshState(): ConversationState {
  return { stage: "collect_treatment_area", history: [], lastUpdated: Date.now(), humanHandoff: false };
}

// ── Explicit key / read / write helpers ───────────────────────────────────────

export function getConversationKey(phone: string): string {
  return `${KEY_PREFIX}${phone}`;
}

/**
 * Direct Redis read. Returns null when key is absent; throws on network/auth error.
 * Handles both string and pre-parsed object responses from the Upstash SDK.
 */
export async function readConversationState(phone: string): Promise<ConversationState | null> {
  const r = getRedis();
  if (!r) return null;
  const raw = await r.get(getConversationKey(phone));
  if (raw === null || raw === undefined) return null;
  const parsed = (typeof raw === "string" ? JSON.parse(raw) : raw) as Record<string, unknown>;
  return { ...(parsed as unknown as ConversationState), stage: normalizeLegacyStage(parsed) };
}

/**
 * Direct Redis write. Explicitly JSON.stringifies the state so the Upstash SDK
 * receives a string (not an object), guaranteeing a single encoding layer.
 * Throws on failure — callers decide whether to fall back to memory.
 */
export async function writeConversationState(
  phone: string,
  state: ConversationState
): Promise<void> {
  const r = getRedis();
  if (!r) throw new Error("Redis not configured");
  await r.set(getConversationKey(phone), JSON.stringify(state), { ex: STATE_TTL_S });
}

// ── Core state operations ─────────────────────────────────────────────────────

export async function getState(phone: string): Promise<ConversationState> {
  const r = getRedis();
  if (r) {
    try {
      const raw = await r.get(getConversationKey(phone));
      if (raw !== null && raw !== undefined) {
        const parsed = (typeof raw === "string" ? JSON.parse(raw) : raw) as Record<string, unknown>;
        const stored: ConversationState = { ...(parsed as unknown as ConversationState), stage: normalizeLegacyStage(parsed) };
        if (Date.now() - stored.lastUpdated < STATE_TTL_MS) return stored;
        console.log(`[State] Expired Redis state for ${phone} — resetting`);
      }
    } catch (err) {
      console.error("[State] Redis get failed, falling back to memory:", err instanceof Error ? err.message : err);
      const mem = memStore.get(phone);
      if (mem && Date.now() - mem.lastUpdated < STATE_TTL_MS) return applyNorm(mem);
    }
    // No valid Redis state — return fresh state without writing so getState()
    // is a pure read. updateState()/addToHistory() will write when needed.
    return freshState();
  }

  const existing = memStore.get(phone);
  if (existing) {
    if (Date.now() - existing.lastUpdated < STATE_TTL_MS) return applyNorm(existing);
    console.log(`[State] Expired state for ${phone} — resetting`);
  }
  const state = freshState();
  memStore.set(phone, state);
  return state;
}

export async function updateState(
  phone: string,
  updates: Partial<ConversationState>
): Promise<ConversationState> {
  const current = await getState(phone);
  const safeUpdates = Object.fromEntries(
    Object.entries(updates).filter(([, v]) => v !== undefined)
  ) as Partial<ConversationState>;
  const updated = { ...current, ...safeUpdates, lastUpdated: Date.now() };

  const r = getRedis();
  if (r) {
    try {
      await r.set(getConversationKey(phone), JSON.stringify(updated), { ex: STATE_TTL_S });
    } catch (err) {
      console.error("[State] Redis set failed, falling back to memory:", err instanceof Error ? err.message : err);
      memStore.set(phone, updated);
    }
  } else {
    memStore.set(phone, updated);
  }
  return updated;
}

export async function addToHistory(
  phone: string,
  role: "user" | "assistant",
  content: string
): Promise<void> {
  const state = await getState(phone);
  state.history.push({ role, content });
  if (state.history.length > 10) {
    state.history = state.history.slice(-10);
  }
  state.lastUpdated = Date.now();

  const r = getRedis();
  if (r) {
    try {
      await r.set(getConversationKey(phone), JSON.stringify(state), { ex: STATE_TTL_S });
    } catch (err) {
      console.error("[State] Redis addToHistory failed, falling back to memory:", err instanceof Error ? err.message : err);
      memStore.set(phone, state);
    }
  } else {
    memStore.set(phone, state);
  }
}

// Returns true only when the vertical qualification field for this category has an
// ACTUAL value. Completion depends on real answers, never on whether the question was
// asked — asking-then-ignoring must NOT advance the flow. This is a HARD gate before
// name/phone even when the patient volunteered date/time early: that early-datetime
// bypass was the bug that made LeadAura ask for contact details before qualifying.
//
//   - No/"other" category → nothing vertical to qualify.
//   - laser           → first-time status answered.
//   - hair_transplant → travel origin (abroad vs local) answered.
//   - dental          → treatment scope (full smile vs tooth count) answered.
function qualificationComplete(state: ConversationState): boolean {
  const cat = state.serviceCategory;
  if (!cat || cat === "other") return true;
  if (cat === "laser") return state.firstTimeLaser !== undefined;
  if (cat === "hair_transplant") return state.travellingFromAbroad !== undefined;
  if (cat === "dental") return !!state.teethCountOrScope;
  return true;
}

export function getNextStage(state: ConversationState): Stage {
  if (!state.treatmentArea && !state.service) return "collect_treatment_area";
  if (!qualificationComplete(state)) return "collect_qualification";
  if (!state.preferredDate && !state.preferredTime) return "collect_datetime";
  if (!state.name) return "collect_name";
  return "complete";
}

// ── Diagnostic helpers ────────────────────────────────────────────────────────

export function hasRedisConfig(): boolean {
  return !!(
    process.env.UPSTASH_REDIS_REST_URL &&
    process.env.UPSTASH_REDIS_REST_TOKEN
  );
}

export function getStateStorageMode(): "redis" | "memory" {
  return getRedis() !== null ? "redis" : "memory";
}

// ── Test helpers ─────────────────────────────────────────────────────────────

export async function resetStateForTest(phone: string): Promise<void> {
  const r = getRedis();
  if (r) {
    try { await r.del(getConversationKey(phone)); } catch {}
  }
  memStore.delete(phone);
}

/**
 * Strips the Twilio WhatsApp transport prefix so the E.164 phone number is
 * returned regardless of how Twilio sends the From field.
 * "whatsapp:+15556610104" → "+15556610104"
 * "+15556610104"          → "+15556610104"
 * "15556610104"           → "15556610104"
 */
export function normalizePhone(phone: string): string {
  return phone.replace(/^whatsapp:/i, "");
}

/**
 * Delete conversation state for all key variants of a phone number.
 * Handles bare, '+'-prefixed, and Twilio WhatsApp-prefixed forms
 * (e.g. "15556610104", "+15556610104", "whatsapp:15556610104",
 * "whatsapp:+15556610104") so the reset endpoint reliably clears state
 * regardless of how Twilio delivered the original From field.
 * Clears in-memory fallback first, then Redis — throws if Redis fails.
 * Returns the list of Redis key names that were targeted.
 */
export async function deleteConversationState(phone: string): Promise<string[]> {
  const stripped = normalizePhone(phone);
  const base = stripped.startsWith("+") ? stripped.slice(1) : stripped;
  const withPlus = `+${base}`;

  const phoneVariants = [base, withPlus, `whatsapp:${base}`, `whatsapp:${withPlus}`];
  const keys = phoneVariants.map(getConversationKey);

  // Always clear in-memory fallback so it is clean even if Redis throws below.
  for (const variant of phoneVariants) {
    memStore.delete(variant);
  }

  const r = getRedis();
  if (r) {
    for (const key of keys) {
      await r.del(key);
    }
  }

  return keys;
}

export async function _setStateForTest(phone: string, state: ConversationState): Promise<void> {
  const r = getRedis();
  if (r) {
    try { await r.set(getConversationKey(phone), JSON.stringify(state), { ex: STATE_TTL_S }); } catch {}
  }
  memStore.set(phone, state);
}
