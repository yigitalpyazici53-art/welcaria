import { NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { requireInboxSession } from "@/lib/inboxGuard";
import type { ConversationState } from "@/lib/conversationState";

// Conversation-list for the pilot inbox. Authenticated by this handler itself
// (requireInboxSession), with middleware.ts as an outer perimeter.
//
// Approach: SCAN conv:* directly. Chosen over a thread-index set because it
// requires ZERO changes to the inbound pipeline (an index would need a write on
// every inbound), and at pilot volume the keyspace is small — a bounded cursor
// loop reads it in a handful of round trips. State keys carry a 24h TTL, so this
// naturally lists only conversations active within the last 24h.

const KEY_PREFIX = "conv:";
const SCAN_COUNT = 100;
const MAX_SCAN_ITERATIONS = 100; // hard stop so a large keyspace can never hang

interface ConversationSummary {
  phone: string;
  lastMessagePreview: string;
  lastMessageRole: "user" | "assistant" | null;
  humanHandoff: boolean;
  lastUpdated: number | null;
}

export async function GET(req: Request): Promise<NextResponse> {
  const unauthorized = await requireInboxSession(req);
  if (unauthorized) return unauthorized;

  const r = getRedis();
  if (!r) {
    // Memory-mode dev without Redis: nothing to enumerate.
    return NextResponse.json({
      ok: true,
      conversations: [],
      stateStorage: "memory",
      note: "Redis not configured — conversation listing requires Redis",
    });
  }

  // ── 1. Collect conv:* keys via a bounded SCAN cursor loop ──────────────────
  const keys: string[] = [];
  let cursor: string | number = 0;
  let iterations = 0;
  try {
    do {
      const [next, batch] = (await r.scan(cursor, {
        match: `${KEY_PREFIX}*`,
        count: SCAN_COUNT,
      })) as [string, string[]];
      cursor = next;
      keys.push(...batch);
      iterations++;
    } while (String(cursor) !== "0" && iterations < MAX_SCAN_ITERATIONS);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error("[Inbox] conversation SCAN failed:", error);
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }

  if (keys.length === 0) {
    return NextResponse.json({ ok: true, conversations: [], stateStorage: "redis" });
  }

  // ── 2. Read each state and reduce to a safe summary ────────────────────────
  let raws: unknown[];
  try {
    raws = (await r.mget(...keys)) as unknown[];
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error("[Inbox] conversation MGET failed:", error);
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }

  const conversations: ConversationSummary[] = [];
  for (let i = 0; i < keys.length; i++) {
    const raw = raws[i];
    if (raw === null || raw === undefined) continue;

    let state: ConversationState;
    try {
      state = (typeof raw === "string" ? JSON.parse(raw) : raw) as ConversationState;
    } catch {
      continue; // skip an unparseable key rather than fail the whole list
    }

    const history = Array.isArray(state.history) ? state.history : [];
    const last = history.length > 0 ? history[history.length - 1] : null;

    conversations.push({
      phone: keys[i].slice(KEY_PREFIX.length),
      lastMessagePreview: last ? last.content.slice(0, 120) : "",
      lastMessageRole: last ? last.role : null,
      humanHandoff: state.humanHandoff === true,
      lastUpdated: typeof state.lastUpdated === "number" ? state.lastUpdated : null,
    });
  }

  // Newest first when timestamps are present (untimestamped keys sort last).
  conversations.sort((a, b) => (b.lastUpdated ?? 0) - (a.lastUpdated ?? 0));

  return NextResponse.json({
    ok: true,
    conversations,
    count: conversations.length,
    stateStorage: "redis",
  });
}
