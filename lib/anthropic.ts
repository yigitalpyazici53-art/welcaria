// ── KVKK / data-protection status of this integration ─────────────────────────
//
// WHAT LEAVES THE SYSTEM: every generateSmsReply() call sends patient
// conversation content to Anthropic's API (a US-based processor) for reply
// generation. Because patients describe medical treatments (laser, hair
// transplant, dental), this is special-category HEALTH DATA under KVKK Art. 6,
// and the API call is a cross-border transfer under KVKK Art. 9. Concretely,
// each request contains: the patient's latest message, the last 6 history turns
// verbatim, and a system prompt (lib/prompt.ts) that embeds the captured lead
// fields — including the patient's NAME and PHONE NUMBER — as literal values.
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
// CONSENT: the KVKK consent disclosure (audit Step 4) is sent on first contact,
// before the first bot reply, informing the patient that an AI assistant
// processes their messages. See consentMessage in lib/inboundPipeline.ts.
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
// DATA MINIMIZATION (not implemented — documented for a future step): the
// current request sends more than strictly necessary. The name and especially
// the phone number in the system prompt only power personalization and
// "don't ask again" guards; both could use placeholders (e.g. name=<captured>)
// with no loss to the guard logic, at the cost of name-personalized replies.
// A minimal-data variant would send only the latest message plus a structured
// non-identifying state summary (stage, service category, which slots are
// filled) instead of raw history — the qualification flow is deterministic in
// lib/inboundPipeline.ts, so reply quality, not correctness, is the trade-off.
// ──────────────────────────────────────────────────────────────────────────────

import Anthropic from "@anthropic-ai/sdk";
import { buildSystemPrompt, type PromptOptions } from "./prompt";
import { sanitizeReplyText, ensureClinicNamePunctuation } from "./sanitize";
import { clinicConfig } from "./clinicConfig";
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

  console.log("[Reply] generated (Claude):", clean.slice(0, 80) + (clean.length > 80 ? "..." : ""));
  return clean;
}
