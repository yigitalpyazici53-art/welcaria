import { NextResponse } from "next/server";
import { sendOutbound } from "@/lib/outboundSend";
import { addToHistory, getStateStorageMode } from "@/lib/conversationState";
import type { ComplianceDecision } from "@/lib/compliance";

// Manual owner reply for the pilot inbox. Protected by middleware.ts.
//
// Sends a clinic-authored message to the patient through the mandatory
// compliance gate (lib/outboundSend.ts). Uses kind: "system" so it is treated
// as an operator-initiated send: it skips BOTH the "1 bot_reply per inbound"
// cap and the per-inbound total-send budget (owner replies must not be
// throttled by the bot's send count), while the 24h window, inbound-only
// guarantee, and circuit breaker still fully apply. A blocked send returns a
// clear JSON error the UI can display instead of crashing. History is only
// updated after a confirmed send so the inbox never shows a message that never
// left.

// Human-readable, UI-facing explanation for each blocked decision.
function describeBlock(decision: ComplianceDecision): string {
  switch (decision) {
    case "BLOCKED_WINDOW_CLOSED":
      return "Outside the 24-hour messaging window. WhatsApp only allows free-form replies within 24h of the patient's last message.";
    case "BLOCKED_NO_INBOUND_HISTORY":
      return "No inbound message from this patient — a conversation can only be opened by the patient.";
    case "CIRCUIT_OPEN":
      return "Sending is paused by the compliance circuit breaker (quality hold or kill switch).";
    case "RATE_LIMITED":
      return "Temporarily rate-limited. Please try again in a moment.";
    default:
      return "The message could not be sent.";
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ phone: string }> }
): Promise<NextResponse> {
  const { phone: raw } = await params;
  const phone = decodeURIComponent(raw ?? "").trim();
  if (!phone) {
    return NextResponse.json({ ok: false, error: "Missing phone" }, { status: 400 });
  }

  let parsed: { body?: string; message?: string };
  try {
    parsed = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const body = (parsed.body ?? parsed.message ?? "").trim();
  if (!body) {
    return NextResponse.json(
      { ok: false, error: "Missing message body" },
      { status: 400 }
    );
  }

  const stateStorage = getStateStorageMode();

  // ── Send through the compliance gate as an operator-initiated message ───────
  let result;
  try {
    result = await sendOutbound({
      to: phone,
      body,
      kind: "system",
      channel: "meta",
      threadKey: phone,
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[Inbox] manual reply send threw for ${phone}:`, error);
    return NextResponse.json({ ok: false, error, stateStorage }, { status: 500 });
  }

  if (!result.sent) {
    // Gate blocked or transport failed — surface a clear, displayable error.
    const isTransport = result.decision === "ALLOWED"; // allowed by gate but transport threw
    console.warn(
      `[Inbox] manual reply not sent to ${phone} decision=${result.decision}${result.error ? ` error=${result.error}` : ""}`
    );
    return NextResponse.json(
      {
        ok: false,
        sent: false,
        decision: result.decision,
        error: result.error ?? describeBlock(result.decision),
        phone,
        stateStorage,
      },
      { status: isTransport ? 502 : 422 }
    );
  }

  // ── Record in history only after a confirmed send ───────────────────────────
  // Clinic-side message → "assistant" role, matching how bot replies are stored,
  // so it renders on the outbound side of the thread.
  try {
    await addToHistory(phone, "assistant", body);
  } catch (err) {
    // The message DID go out; failing to log history must not report a failed
    // send. Warn and still return success.
    console.error(
      `[Inbox] manual reply sent to ${phone} but addToHistory failed:`,
      err instanceof Error ? err.message : err
    );
  }

  console.log(`[Inbox] manual reply sent to ${phone} (kind=system)`);
  return NextResponse.json({
    ok: true,
    sent: true,
    decision: result.decision,
    phone,
    stateStorage,
  });
}
