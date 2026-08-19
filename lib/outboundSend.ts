import {
  complianceGate,
  getDefaultTenantId,
  logCompliance,
  recordActivity,
} from "./compliance";
import type { ComplianceDecision, GateChannel, OutboundKind } from "./compliance";
import { sendWhatsAppText } from "./metaWhatsApp";
import { sendSms } from "./twilio";
import { sanitizeSmsText } from "./sanitize";

// ── The single mandatory outbound send path ───────────────────────────────────
//
// EVERY patient-facing outbound message (bot replies, booking handoffs, missed-
// call texts, test sends) MUST go through sendOutbound(). Nothing else in the
// codebase may call sendWhatsAppText()/sendSms() for a patient — the compliance
// gate in lib/compliance.ts runs first and its verdict is final. The LLM never
// sees or influences this decision.
//
// Deliberately outside this gate:
//   - notifyOwner() owner alerts: SMS to the clinic's own OWNER_PHONE, not a
//     patient, not WhatsApp.
//   - Nurabla TwiML webhook replies: synchronous responses to an inbound
//     Twilio webhook — structurally inbound-only and inside the window.

export type OutboundChannel = "meta" | "twilio";

export interface OutboundMessage {
  to: string;
  body: string;
  kind: OutboundKind;
  channel: OutboundChannel;
  /** Defaults to the deployment's single tenant (Meta phone number id). */
  tenantId?: string;
  /** Conversation-state key for the thread; defaults to `to`. */
  threadKey?: string;
}

export interface OutboundResult {
  sent: boolean;
  decision: ComplianceDecision;
  error?: string;
  /**
   * True only when the transport put `msg.body` on the wire byte-for-byte. False
   * whenever the send did not happen, and false when the channel rewrote the body
   * (see transmitsBodyIntact). Callers whose message is legally load-bearing — the
   * KVKK consent disclosure above all — MUST require `sent && bodyIntact` before
   * recording it as delivered: a truncated notice is not a notice.
   */
  bodyIntact: boolean;
}

interface OutboundDeps {
  transport?: (to: string, body: string) => Promise<void>;
  now?: number;
  sleep?: (ms: number) => Promise<void>;
}

// Does this channel's transport transmit the body verbatim?
//   meta   → the Cloud API carries `text.body` unchanged in the JSON payload.
//   twilio → sendSms() runs sanitizeSmsText() first, which strips every non-GSM
//            character (newlines and all Arabic/Cyrillic text included) and hard-caps
//            the result at SMS_MAX_CHARS. Anything longer or non-Latin arrives altered.
// Recomputing the sanitizer here is deliberate: it is a pure function, so this stays a
// prediction of exactly what sendSms() will transmit. With an injected deps.transport
// the verdict describes the real channel, not the stub.
function transmitsBodyIntact(msg: OutboundMessage): boolean {
  if (msg.channel === "meta") return true;
  return sanitizeSmsText(msg.body) === msg.body;
}

function gateChannelFor(msg: OutboundMessage): GateChannel {
  if (msg.channel === "meta") return "meta";
  // Twilio delivers WhatsApp with a "whatsapp:" recipient prefix; bare E.164 is SMS.
  return msg.to.toLowerCase().startsWith("whatsapp:") ? "twilio_whatsapp" : "sms";
}

export async function sendOutbound(
  msg: OutboundMessage,
  deps: OutboundDeps = {}
): Promise<OutboundResult> {
  const tenantId = msg.tenantId ?? getDefaultTenantId();
  const thread = msg.threadKey ?? msg.to;

  const gate = await complianceGate({
    tenantId,
    thread,
    kind: msg.kind,
    channel: gateChannelFor(msg),
    now: deps.now,
    sleep: deps.sleep,
  });
  if (!gate.allowed) {
    return { sent: false, decision: gate.decision, bodyIntact: false };
  }

  const transport =
    deps.transport ?? (msg.channel === "meta" ? sendWhatsAppText : sendSms);
  try {
    await transport(msg.to, msg.body);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[Outbound] transport send failed (${msg.channel}):`, message);
    return { sent: false, decision: gate.decision, error: message, bodyIntact: false };
  }

  await recordActivity(tenantId);
  return { sent: true, decision: gate.decision, bodyIntact: transmitsBodyIntact(msg) };
}

/**
 * Pre-approved template sends — the ONLY thing Meta permits outside the 24h
 * window. No templates are approved yet, so this path always refuses.
 *
 * TODO(templates): once templates are approved in 360dialog, implement the
 * Cloud API `type: "template"` payload here, still behind complianceGate()
 * (circuit breaker + rate limits apply; the window check does not).
 */
export async function sendTemplate(
  templateName: string,
  _params: Record<string, string>,
  tenantId: string = getDefaultTenantId()
): Promise<OutboundResult> {
  await logCompliance({
    ts: new Date().toISOString(),
    event: "BLOCKED_WINDOW_CLOSED",
    tenantId,
    detail: `template send refused — no approved templates configured (requested: ${templateName})`,
  });
  return { sent: false, decision: "BLOCKED_WINDOW_CLOSED", bodyIntact: false };
}
