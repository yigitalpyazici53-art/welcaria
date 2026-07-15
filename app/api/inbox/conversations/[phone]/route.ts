import { NextResponse } from "next/server";
import {
  readConversationState,
  getStateStorageMode,
} from "@/lib/conversationState";

// Single-conversation read for the pilot inbox. Protected by middleware.ts.
//
// A thin read wrapper over ConversationState — no new persistence. Returns the
// ≤10-message history already held in state (Option A: last-10/24h, no durable
// message log), the humanHandoff flag, and the lead fields already extracted by
// the pipeline. The phone segment is the bare thread key exactly as the
// conversation-list endpoint returns it (Meta delivers `from` without a "+").

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ phone: string }> }
): Promise<NextResponse> {
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
    console.error(`[Inbox] conversation read failed for ${phone}:`, error);
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
