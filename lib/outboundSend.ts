import {
  claimFollowupTemplate,
  complianceGate,
  getDefaultTenantId,
  getLastInboundAt,
  getTemplateMaxAgeDays,
  logCompliance,
  recordActivity,
  releaseFollowupTemplate,
} from "./compliance";
import type { ComplianceDecision, GateChannel, OutboundKind } from "./compliance";
import {
  MetaNotConfiguredError,
  MetaWhatsAppError,
  sendWhatsAppText,
  sendWhatsAppTemplate,
} from "./metaWhatsApp";
import { sendSms } from "./twilio";
import { sanitizeSmsText } from "./sanitize";
import { envOrUndefined } from "./env";

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

// ── Template sends (outside the 24h window) ──────────────────────────────────
//
// Configuration lives in env because the template NAME and LANGUAGE must match a
// template that was approved in Meta WhatsApp Manager for this WABA — approval is a
// manual Meta process the code cannot perform. Until the clinic's template is approved
// and its name set here, sendTemplate() refuses with BLOCKED_TEMPLATE_NOT_CONFIGURED:
// the send path is implemented, the template simply is not registered yet.
//
//   TEMPLATE_NAME_FOLLOWUP=welcaria_followup      (exact name as approved in Meta)
//   TEMPLATE_LANG_FOLLOWUP=tr                     (Meta language code; default "tr")

export function getFollowupTemplateName(): string {
  return envOrUndefined("TEMPLATE_NAME_FOLLOWUP")?.trim() ?? "";
}

export function getFollowupTemplateLanguage(): string {
  const raw = envOrUndefined("TEMPLATE_LANG_FOLLOWUP")?.trim();
  return raw && raw.length > 0 ? raw : "tr";
}

export interface TemplateSendOptions {
  /** Fills the approved template's {{1}}, {{2}}, … IN ORDER. Count must match exactly. */
  bodyParams?: string[];
  tenantId?: string;
  /** Conversation-state key for the thread; defaults to `to`. */
  threadKey?: string;
  /** Injectable clock/sleep for deterministic tests — same contract as OutboundDeps. */
  now?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Injectable transport for tests, so no test can reach the real Meta API. */
  transport?: (
    to: string,
    templateName: string,
    languageCode: string,
    bodyParams: string[]
  ) => Promise<void>;
}

/**
 * Pre-approved template send — the ONLY message Meta permits once the 24h
 * customer-service window has closed.
 *
 * Still fully gated. complianceGate() runs with kind "template", which skips ONLY the
 * window check; the circuit breaker and — critically — the inbound-only guarantee both
 * still apply, so a template can never be used to cold-message someone who never wrote
 * to the clinic.
 *
 * Refusals specific to templates, checked before the gate:
 *   - BLOCKED_TEMPLATE_NOT_CONFIGURED: TEMPLATE_NAME_FOLLOWUP is unset. A configuration
 *     state ("no approved template yet"), not a compliance failure.
 *   - BLOCKED_TEMPLATE_TOO_OLD: the patient's last inbound message is older than
 *     TEMPLATE_MAX_AGE_DAYS (default 30).
 *   - BLOCKED_TEMPLATE_ALREADY_SENT: this thread already got its follow-up template since
 *     the patient last wrote. Enforced here with an atomic claim
 *     (claimFollowupTemplate, SET NX), so two concurrent calls cannot both send; the
 *     claim is cleared when the patient writes again (recordInboundMessage).
 *
 * The claim is taken BEFORE the transport call and is given back only when the template
 * provably did not go out (gate refusal, Meta rejected the request, credentials missing).
 * On an ambiguous failure (network error, timeout) it is kept: a possible missed
 * follow-up is preferred over a possible duplicate.
 */
export async function sendTemplate(
  to: string,
  templateName: string = getFollowupTemplateName(),
  options: TemplateSendOptions = {}
): Promise<OutboundResult> {
  const tenantId = options.tenantId ?? getDefaultTenantId();
  const thread = options.threadKey ?? to;

  if (!templateName) {
    await logCompliance({
      ts: new Date().toISOString(),
      event: "BLOCKED_TEMPLATE_NOT_CONFIGURED",
      tenantId,
      thread,
      kind: "template",
      channel: "meta",
      detail:
        "template send refused — TEMPLATE_NAME_FOLLOWUP is not set (no approved Meta template configured for this clinic)",
    });
    return { sent: false, decision: "BLOCKED_TEMPLATE_NOT_CONFIGURED", bodyIntact: false };
  }

  const now = options.now ?? Date.now();
  const refuse = async (
    decision: ComplianceDecision,
    detail: string
  ): Promise<OutboundResult> => {
    await logCompliance({
      ts: new Date(now).toISOString(),
      event: decision,
      tenantId,
      thread,
      kind: "template",
      channel: "meta",
      detail,
    });
    return { sent: false, decision, bodyIntact: false };
  };

  // No inbound history at all is left to the gate, which reports it as the
  // inbound-only violation it is.
  const lastInboundAt = await getLastInboundAt(thread);
  const maxAgeDays = getTemplateMaxAgeDays();
  if (lastInboundAt !== null && now - lastInboundAt > maxAgeDays * 24 * 60 * 60 * 1000) {
    return refuse(
      "BLOCKED_TEMPLATE_TOO_OLD",
      `last inbound message is older than TEMPLATE_MAX_AGE_DAYS (${maxAgeDays})`
    );
  }

  if (!(await claimFollowupTemplate(thread, now, lastInboundAt))) {
    return refuse(
      "BLOCKED_TEMPLATE_ALREADY_SENT",
      "a follow-up template was already sent to this thread since its last inbound message"
    );
  }

  const gate = await complianceGate({
    tenantId,
    thread,
    kind: "template",
    channel: "meta",
    now: options.now,
    sleep: options.sleep,
  });
  if (!gate.allowed) {
    await releaseFollowupTemplate(thread);
    return { sent: false, decision: gate.decision, bodyIntact: false };
  }

  const language = getFollowupTemplateLanguage();
  const transport = options.transport ?? sendWhatsAppTemplate;
  try {
    await transport(to, templateName, language, options.bodyParams ?? []);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[Outbound] template send failed (${templateName}/${language}):`, message);
    if (err instanceof MetaWhatsAppError || err instanceof MetaNotConfiguredError) {
      await releaseFollowupTemplate(thread);
    }
    return { sent: false, decision: gate.decision, error: message, bodyIntact: false };
  }

  await recordActivity(tenantId);
  // The body is Meta's approved template text, rendered by Meta — there is no local
  // body to compare, so this is not the "transmitted verbatim" claim that bodyIntact
  // makes for free-form sends. Reported false so no caller mistakes a template for a
  // delivered KVKK disclosure.
  return { sent: true, decision: gate.decision, bodyIntact: false };
}
