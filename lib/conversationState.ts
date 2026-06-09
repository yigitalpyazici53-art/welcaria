import { getRedis } from "./redis";

export type Stage =
  | "collect_name"
  | "collect_service"
  | "collect_datetime"
  | "collect_location"
  | "complete";

export type UrgencyLevel = "low" | "medium" | "high";
export type LeadScore = "hot" | "warm" | "cold";

export interface ConversationState {
  name?: string;
  phone?: string;
  service?: string;
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
}

const KEY_PREFIX = "conv:";
const STATE_TTL_S = 24 * 60 * 60;
const STATE_TTL_MS = STATE_TTL_S * 1000;

const memStore = new Map<string, ConversationState>();

function freshState(): ConversationState {
  return { stage: "collect_name", history: [], lastUpdated: Date.now() };
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
  if (!state.name) return "collect_name";
  if (!state.service) return "collect_service";
  if (!state.preferredDate && !state.preferredTime) return "collect_datetime";
  if (!state.location) return "collect_location";
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
