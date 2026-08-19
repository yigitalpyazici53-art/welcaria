import { NextResponse } from "next/server";
import {
  readConversationState,
  getStateStorageMode,
  deleteConversationState,
} from "@/lib/conversationState";
import { deleteComplianceForThread } from "@/lib/compliance";
import { deleteLeadFromSheets } from "@/lib/googleSheets";
import { maskPhone } from "@/lib/sanitize";
import { requireInboxSession, requireInboxMutation } from "@/lib/inboxGuard";

// Single-conversation read for the pilot inbox. Authenticated by each handler
// itself, with middleware.ts as an outer perimeter.
//
// A thin read wrapper over ConversationState — no new persistence. Returns the
// ≤10-message history already held in state (Option A: last-10/24h, no durable
// message log), the humanHandoff flag, and the lead fields already extracted by
// the pipeline. The phone segment is the bare thread key exactly as the
// conversation-list endpoint returns it (Meta delivers `from` without a "+").

export async function GET(
  req: Request,
  { params }: { params: Promise<{ phone: string }> }
): Promise<NextResponse> {
  const unauthorized = await requireInboxSession(req);
  if (unauthorized) return unauthorized;

  const { phone: raw } = await params;
  const phone = decodeURIComponent(raw ?? "").trim();
  if (!phone) {
    return NextResponse.json({ ok: false, error: "Missing phone" }, { status: 400 });
  }

  const stateStorage = getStateStorageMode();
  if (stateStorage === "memory") {
    // Reading a single conversation requires Redis, same as the list endpoint.
    return NextResponse.json({
      ok: false,
      error: "Redis not configured — conversation read requires Redis",
      stateStorage,
    });
  }

  let state;
  try {
    state = await readConversationState(phone);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[Inbox] conversation read failed for ${maskPhone(phone)}:`, error);
    return NextResponse.json({ ok: false, error, stateStorage }, { status: 500 });
  }

  if (!state) {
    return NextResponse.json(
      { ok: false, error: "Conversation not found", phone, stateStorage },
      { status: 404 }
    );
  }

  const history = Array.isArray(state.history) ? state.history : [];

  // Curated lead fields already present in state — surface only what the inbox
  // UI can use, leaving out compliance/alerting bookkeeping flags.
  const lead = {
    name: state.name ?? null,
    service: state.service ?? null,
    serviceCategory: state.serviceCategory ?? null,
    treatmentArea: state.treatmentArea ?? null,
    language: state.detectedLanguage ?? null,
    stage: state.stage,
    leadScore: state.leadScore ?? null,
    urgency: state.urgency ?? null,
    preferredDate: state.preferredDate ?? null,
    preferredTime: state.preferredTime ?? null,
    location: state.location ?? null,
    notes: state.notes ?? null,
    qualificationNotes: state.qualificationNotes ?? null,
  };

  return NextResponse.json({
    ok: true,
    phone,
    humanHandoff: state.humanHandoff === true,
    lead,
    history: history.map((m) => ({ role: m.role, content: m.content })),
    messageCount: history.length,
    lastUpdated: typeof state.lastUpdated === "number" ? state.lastUpdated : null,
    stateStorage,
  });
}

// ── DELETE — KVKK erasure ─────────────────────────────────────────────────────
// Full right-to-erasure for one patient: clears the Redis conversation state, the
// per-thread compliance keys, that patient's rows in the compliance audit log, and
// every matching row in Google Sheets. Protected
// by middleware.ts (the /api/inbox/* session guard). Each store is erased
// independently and its outcome reported, so a failure in one does not silently
// skip the others — the response makes clear exactly what was removed.
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ phone: string }> }
): Promise<NextResponse> {
  // Session + Origin: this erases Redis state AND Google Sheets rows, so a
  // cookie-bearing request driven by another origin must never reach it.
  const blocked = await requireInboxMutation(req);
  if (blocked) return blocked;

  const { phone: raw } = await params;
  const phone = decodeURIComponent(raw ?? "").trim();
  if (!phone) {
    return NextResponse.json({ ok: false, error: "Missing phone" }, { status: 400 });
  }

  const stateStorage = getStateStorageMode();

  // 1. Redis conversation state (handles all key variants internally).
  let redisState: { deletedKeys: string[]; error: string | null };
  try {
    const deletedKeys = await deleteConversationState(phone);
    redisState = { deletedKeys, error: null };
  } catch (err) {
    redisState = { deletedKeys: [], error: err instanceof Error ? err.message : String(err) };
  }

  // 2. Per-thread compliance keys (lastInbound + threadSend, all variants) plus
  //    this patient's rows in the shared compliance:log audit list, which stored
  //    the raw phone number and used to survive erasure for up to 90 days.
  let compliance: {
    deletedKeys: string[];
    logEntriesRemoved: number;
    error: string | null;
  };
  try {
    const result = await deleteComplianceForThread(phone);
    compliance = {
      deletedKeys: result.keys,
      logEntriesRemoved: result.logEntriesRemoved,
      error: result.logError,
    };
  } catch (err) {
    compliance = {
      deletedKeys: [],
      logEntriesRemoved: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // 3. Google Sheets rows matching this phone.
  const sheets = await deleteLeadFromSheets(phone);

  const anyError = Boolean(redisState.error || compliance.error || sheets.error);

  console.log(
    `[Inbox] erasure phone=${maskPhone(phone)} redisKeys=${redisState.deletedKeys.length} complianceKeys=${compliance.deletedKeys.length} complianceLogRows=${compliance.logEntriesRemoved} sheetRows=${sheets.deletedRows} anyError=${anyError}`
  );

  return NextResponse.json(
    {
      ok: !anyError,
      phone,
      stateStorage,
      deleted: {
        redisState,
        compliance,
        sheets,
      },
    },
    { status: anyError ? 500 : 200 }
  );
}
