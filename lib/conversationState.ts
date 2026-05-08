import { getRedis } from "./redis";

export type Stage =
  | "collect_issue_type"
  | "collect_fixture"
  | "collect_time"
  | "collect_address"
  | "complete";

export type IssueType = "leak" | "clog" | "water_heater" | "sewer" | "pipe_burst" | "gas_smell" | "other";
export type Fixture = "sink" | "toilet" | "shower" | "drain" | "pipe" | "other";
export type UrgencyLevel = "low" | "medium" | "high";

export interface ConversationState {
  issue_type?: IssueType;
  fixture?: Fixture;
  urgency?: UrgencyLevel;
  preferred_time?: string;
  address?: string;
  stage: Stage;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  lastUpdated: number;
  ownerAlertedHighUrgency?: boolean;
  ownerAlertedComplete?: boolean;
}

const KEY_PREFIX = "conv:";
const STATE_TTL_S = 24 * 60 * 60;       // Redis TTL in seconds
const STATE_TTL_MS = STATE_TTL_S * 1000; // JS TTL check in ms

// In-memory fallback used when UPSTASH_REDIS_REST_URL / TOKEN are absent
const memStore = new Map<string, ConversationState>();

function freshState(): ConversationState {
  return { stage: "collect_issue_type", history: [], lastUpdated: Date.now() };
}

export async function getState(phone: string): Promise<ConversationState> {
  const r = getRedis();
  if (r) {
    try {
      const stored = await r.get<ConversationState>(`${KEY_PREFIX}${phone}`);
      if (stored && Date.now() - stored.lastUpdated < STATE_TTL_MS) return stored;
      if (stored) console.log(`[State] Expired Redis state for ${phone} — resetting`);
    } catch (err) {
      console.error("[State] Redis get failed, falling back to memory:", err instanceof Error ? err.message : err);
      const mem = memStore.get(phone);
      if (mem && Date.now() - mem.lastUpdated < STATE_TTL_MS) return mem;
    }
    const state = freshState();
    try { await r.set(`${KEY_PREFIX}${phone}`, state, { ex: STATE_TTL_S }); } catch {}
    return state;
  }

  // In-memory path
  const existing = memStore.get(phone);
  if (existing) {
    if (Date.now() - existing.lastUpdated < STATE_TTL_MS) return existing;
    console.log(`[State] Expired state for ${phone} — resetting for fresh conversation`);
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
  // Strip undefined values so a missing slot in extracted data never clears a known slot
  const safeUpdates = Object.fromEntries(
    Object.entries(updates).filter(([, v]) => v !== undefined)
  ) as Partial<ConversationState>;
  const updated = { ...current, ...safeUpdates, lastUpdated: Date.now() };

  const r = getRedis();
  if (r) {
    try {
      await r.set(`${KEY_PREFIX}${phone}`, updated, { ex: STATE_TTL_S });
    } catch (err) {
      console.error("[State] Redis set failed:", err instanceof Error ? err.message : err);
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
  // Keep last 10 turns to avoid context bloat
  if (state.history.length > 10) {
    state.history = state.history.slice(-10);
  }
  state.lastUpdated = Date.now();

  const r = getRedis();
  if (r) {
    try {
      await r.set(`${KEY_PREFIX}${phone}`, state, { ex: STATE_TTL_S });
    } catch (err) {
      console.error("[State] Redis addToHistory failed:", err instanceof Error ? err.message : err);
      memStore.set(phone, state);
    }
  } else {
    memStore.set(phone, state);
  }
}

export function getNextStage(state: ConversationState): Stage {
  if (!state.issue_type) return "collect_issue_type";
  // pipe_burst and gas_smell imply the fixture — skip fixture collection
  if (!state.fixture && state.issue_type !== "pipe_burst" && state.issue_type !== "gas_smell") return "collect_fixture";
  // HIGH urgency means "now" — skip time collection, get address fast
  if (state.urgency !== "high" && !state.preferred_time) return "collect_time";
  if (!state.address) return "collect_address";
  return "complete";
}

// ── Test helpers ─────────────────────────────────────────────────────────────

export async function resetStateForTest(phone: string): Promise<void> {
  const r = getRedis();
  if (r) {
    try { await r.del(`${KEY_PREFIX}${phone}`); } catch {}
  }
  memStore.delete(phone);
}

export async function _setStateForTest(phone: string, state: ConversationState): Promise<void> {
  const r = getRedis();
  if (r) {
    try { await r.set(`${KEY_PREFIX}${phone}`, state, { ex: STATE_TTL_S }); } catch {}
  }
  memStore.set(phone, state);
}
