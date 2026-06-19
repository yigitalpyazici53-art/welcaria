import { getRedis } from "./redis";

export type Stage =
  | "collect_treatment_area"
  | "collect_first_time"
  | "collect_datetime"
  | "collect_name"
  | "complete";

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
}

const KEY_PREFIX = "conv:";
const STATE_TTL_S = 24 * 60 * 60;
const STATE_TTL_MS = STATE_TTL_S * 1000;

const memStore = new Map<string, ConversationState>();

function freshState(): ConversationState {
  return { stage: "collect_treatment_area", history: [], lastUpdated: Date.now() };
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
  if (typeof raw === "string") return JSON.parse(raw) as ConversationState;
  return raw as ConversationState;
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
        const stored: ConversationState =
          typeof raw === "string" ? JSON.parse(raw) : (raw as ConversationState);
        if (Date.now() - stored.lastUpdated < STATE_TTL_MS) return stored;
        console.log(`[State] Expired Redis state for ${phone} — resetting`);
      }
    } catch (err) {
      console.error("[State] Redis get failed, falling back to memory:", err instanceof Error ? err.message : err);
      const mem = memStore.get(phone);
      if (mem && Date.now() - mem.lastUpdated < STATE_TTL_MS) return mem;
    }
    // No valid Redis state — return fresh state without writing so getState()
    // is a pure read. updateState()/addToHistory() will write when needed.
    return freshState();
  }

  const existing = memStore.get(phone);
  if (existing) {
    if (Date.now() - existing.lastUpdated < STATE_TTL_MS) return existing;
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

export function getNextStage(state: ConversationState): Stage {
  if (!state.treatmentArea && !state.service) return "collect_treatment_area";
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
 * Delete conversation state for both the bare and '+'-prefixed forms of a
 * phone number (e.g. "905419473049" and "+905419473049").
 * Clears in-memory fallback first, then Redis — throws if Redis fails.
 * Returns the list of Redis key names that were targeted.
 */
export async function deleteConversationState(phone: string): Promise<string[]> {
  const base = phone.startsWith("+") ? phone.slice(1) : phone;
  const withPlus = `+${base}`;
  const keys = [getConversationKey(base), getConversationKey(withPlus)];

  // Always clear in-memory fallback so it is clean even if Redis throws below.
  memStore.delete(base);
  memStore.delete(withPlus);

  const r = getRedis();
  if (r) {
    await r.del(keys[0]);
    await r.del(keys[1]);
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
