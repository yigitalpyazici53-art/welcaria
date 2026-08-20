// ── KVKK / data-protection status of this integration ─────────────────────────
//
// WHAT LEAVES THE SYSTEM: every generateSmsReply() call sends patient
// conversation content to Anthropic's API (a US-based processor) for reply
// generation. Because patients describe medical treatments (laser, hair
// transplant, dental), this is special-category HEALTH DATA under KVKK Art. 6,
// and the API call is a cross-border transfer under KVKK Art. 9. Concretely,
// each request contains: the patient's latest message and the last 6 history
// turns verbatim, plus a system prompt (lib/prompt.ts) carrying the captured
// lead fields. The system prompt no longer contains DIRECT IDENTIFIERS: the
// name and phone number are sent as captured/not-captured status flags only
// (audit finding O-2), never as literal values. The deterministic reply templates
// we write into history are identifier-free by construction too — completionReply()
// and nameUpdatedReply() no longer accept a name parameter (lib/localization.ts).
// STILL RAW: the patient's OWN message turns are not redacted (deliberate — redacting
// free text is error-prone), so identifiers the patient typed themselves still appear
// in history. That residual exposure is covered by consent + the DPA, not by code.
//
// DPA: a Data Processing Agreement with Anthropic is REQUIRED before real
// patient data is processed in production. Anthropic's DPA
// (https://www.anthropic.com/legal/data-processing-addendum, incl. EU SCCs +
// security measures; subprocessor list at
// https://www.anthropic.com/subprocessors) is incorporated by reference into
// the Commercial Terms of Service — verify the account operates under those
// commercial terms so the DPA applies, and record that verification in the
// compliance file.
//
// CONSENT: generateSmsReply() is unreachable until the KVKK AI-intake disclosure
// has been CONFIRMED delivered to that patient. processInboundMessage() returns at
// the consent gate (consentDisclosureConfirmed) before any classification, slot
// capture or model call, so a patient's first message is never transferred here;
// the gate only opens once sendOutbound() reported sent:true for the disclosure
// (audit findings O-5 and Y-3). See lib/inboundPipeline.ts.
//
// ZERO RETENTION: there is NO per-request opt-out — the API has no
// "anthropic-no-log" / no-store header, and the `metadata` request field is
// only an abuse-tracking user id, not a retention control. Zero Data Retention
// is an ORGANIZATION-LEVEL configuration arranged with Anthropic
// (sales/enterprise agreement). It is NOT enabled for this deployment: by
// default Anthropic retains API inputs/outputs for a limited period for trust &
// safety and does not train on API data. Arranging ZDR (or confirming the
// retention terms in the DPA are acceptable) is an open operational task, not
// something this code can set.
//
// DATA MINIMIZATION (partially implemented): the system prompt sends
// name_collected / phone_collected flags instead of the values, so the
// "don't ask again" guards still work while no direct identifier is
// transferred; the trade-off taken is that replies never address the patient
// by name (the model is instructed to use the formal "you" form instead).
// STILL OPEN: the last 6 history turns are sent as raw free text, so anything
// the patient typed — name, phone, health details — is still transferred.
// A fully minimal variant would drop raw history for a structured
// non-identifying state summary (stage, service category, which slots are
// filled); the qualification flow is deterministic in lib/inboundPipeline.ts,
// so reply quality, not correctness, is the trade-off.
// ──────────────────────────────────────────────────────────────────────────────

import Anthropic from "@anthropic-ai/sdk";
import { buildSystemPrompt, type PromptOptions } from "./prompt";
import { sanitizeReplyText, ensureClinicNamePunctuation, redactPatientIdentifiers, maskPhone } from "./sanitize";
import { clinicConfig } from "./clinicConfig";
import { fallbackText } from "./localization";
import type { ConversationState } from "./conversationState";

export const DEFAULT_MODEL = "claude-sonnet-4-6";

// Lazy-initialized so the module can be imported before env vars are loaded
let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_client) {
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _client;
}

export function getAnthropicModel(): string {
  return process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;
}

export async function generateSmsReply(
  customerMessage: string,
  state: ConversationState,
  promptOptions?: PromptOptions
): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("[Anthropic] ANTHROPIC_API_KEY is not set — AI replies are disabled");
  }

  const model = getAnthropicModel();
  console.log(`[Reply] generating (Claude model: ${model})`);

  // Include recent conversation history for multi-turn context (last 6 turns)
  const messages: Anthropic.Messages.MessageParam[] = [
    ...state.history.slice(-6).map((h) => ({
      role: h.role as "user" | "assistant",
      content: h.content,
    })),
    { role: "user", content: customerMessage },
  ];

  let response: Anthropic.Messages.Message;
  try {
    response = await getClient().messages.create({
      model,
      max_tokens: 256,
      system: buildSystemPrompt(state, promptOptions),
      messages,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Reply] AI generation failed (model: ${model}): ${msg}`);
    throw err;
  }

  const textBlock = response.content.find(
    (b): b is Anthropic.Messages.TextBlock => b.type === "text"
  );
  const raw = textBlock ? textBlock.text.trim() : "";

  // Filter non-SMS characters but do NOT truncate — length is enforced only in
  // sendSms() so that test/WhatsApp endpoints receive the full reply.
  // Also ensures "Welcome to {clinicName}" is properly punctuated before the next sentence.
  const clean = ensureClinicNamePunctuation(sanitizeReplyText(raw), clinicConfig.name);

  // Identifier redaction (audit finding O-2). The model can still read the patient's
  // name and number in the raw history turns, so the prompt rule forbidding it is a
  // soft control; this is the hard one. It runs AFTER sanitization and BEFORE the value
  // is returned — the caller sends this string and writes it to state.history, so
  // anything removed here can never re-enter the next cross-border request.
  const { text: redactedText, redacted } = redactPatientIdentifiers(clean, {
    name: state.name,
    phone: state.phone,
  });
  if (redacted) {
    // Compliance signal: the model echoed an identifier despite the prompt rule.
    // Logged without the reply body or the raw number.
    console.warn(
      `[Reply] patient identifier redacted from model output (thread ${maskPhone(state.phone ?? "")})`
    );
  }

  // A reply that is empty after redaction would fail at send time. Fall back to the
  // neutral localized acknowledgement rather than sending (or storing) the raw text.
  const finalText =
    redactedText.trim().length > 0 ? redactedText : fallbackText("postCompletionAck", state.detectedLanguage);

  console.log("[Reply] generated (Claude):", finalText.slice(0, 80) + (finalText.length > 80 ? "..." : ""));
  return finalText;
}
