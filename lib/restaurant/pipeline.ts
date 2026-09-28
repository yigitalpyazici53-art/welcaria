// Restaurant-mode turn handling (BUSINESS_TYPE=restaurant).
//
// Entered from processInboundMessage() in lib/inboundPipeline.ts, which keeps the
// parts that are identical for every business in front of this module: the inbound
// record for the 24h window, input sanitization, and the KVKK gate. Nothing in here
// uses the clinic qualification controller — no classifyIntent(), no extractSlots(),
// no getNextStage(), no clinic prompt. The conversation `stage` is never advanced, so
// the clinic-only side effects keyed on stage=complete (booking link, Sheets row,
// clinic owner alert) can never fire for a restaurant thread.
//
// Control is deterministic; the model only writes the text of information answers:
//   reservation → collect date, time and party size with fixed questions, then hand
//                 off to the business (owner alert + bot pause) — never confirm.
//   order       → send RESTAURANT_ORDER_INFO verbatim, or hand off when it is unset.
//   info        → answer from RESTAURANT_INFO_TEXT only; hand off when the text is
//                 unset, when the model says the answer is not in it, when a figure
//                 in the reply is not in it, or when the model is unavailable.
//
// A handoff is REQUESTED here (requestHandoff: true) but applied by the route, after
// the handoff reply has been sent — setting humanHandoff here would make the route
// skip the very message that tells the customer a person will follow up.

import type { InboundPipelineResult } from "../inboundPipeline";
import type { ConversationState, RestaurantHandoffReason } from "../conversationState";
import { updateState, addToHistory, getState } from "../conversationState";
import { consentWelcome } from "../localization";
import { sanitizeReplyText, redactPatientIdentifiers, maskPhone } from "../sanitize";
import { generateRestaurantReply } from "../anthropic";
import { getRestaurantInfoText, getRestaurantOrderInfo, getRestaurantKvkkText } from "./config";
import {
  detectRestaurantIntent,
  extractReservationDetails,
  formatPartySize,
  isCancelMessage,
  type ReservationField,
} from "./intent";
import { buildRestaurantSystemPrompt } from "./prompt";
import { findUngroundedFacts } from "./grounding";

export const RESTAURANT_HANDOFF_REPLY =
  "Bunu hemen işletmeye iletiyorum, en kısa sürede size dönüş yapılacak.";

const RESERVATION_QUESTIONS: Record<ReservationField, string> = {
  date: "Hangi gün için rezervasyon yapmak istersiniz?",
  time: "Saat kaç gibi gelmeyi düşünüyorsunuz?",
  partySize: "Kaç kişi olacaksınız?",
};

const RESERVATION_FIELDS: ReservationField[] = ["date", "time", "partySize"];

// Two consecutive reservation turns without any new detail → a human takes over.
const RESERVATION_MAX_STALL_TURNS = 2;

// ── Test seam ─────────────────────────────────────────────────────────────────
// The offline test suite swaps the model call for a stub; production never calls this.
type ReplyGenerator = typeof generateRestaurantReply;
let replyGenerator: ReplyGenerator = generateRestaurantReply;
export function _setRestaurantReplyGeneratorForTest(fn: ReplyGenerator | null): void {
  replyGenerator = fn ?? generateRestaurantReply;
}

interface TurnOutcome {
  intent: string;
  reply: string;
  /** Sent without sanitization (owner-configured text whose line breaks must survive). */
  verbatim?: boolean;
  handoff?: RestaurantHandoffReason;
  updates: Partial<ConversationState>;
}

const RESET_RESERVATION: Partial<ConversationState> = {
  restaurantFlow: "none",
  reservationAwaiting: "",
  reservationStallTurns: 0,
};

function handoff(intent: string, reason: RestaurantHandoffReason, extra: Partial<ConversationState> = {}): TurnOutcome {
  return {
    intent,
    reply: RESTAURANT_HANDOFF_REPLY,
    handoff: reason,
    updates: { ...RESET_RESERVATION, ...extra, restaurantHandoffReason: reason },
  };
}

// ── Consent turn ──────────────────────────────────────────────────────────────

/**
 * Restaurant-mode KVKK disclosure turn. Same contract as the clinic disclosure turn —
 * nothing about the message is processed, the route sends consentMessage and records
 * the send verdict — but with the general personal-data notice instead of the
 * patient/health wording, and no language detection (the notice is a single
 * configured text). No "new customer" owner alert: restaurant owners are alerted only
 * when a conversation is handed to them.
 */
export async function runRestaurantConsentTurn(
  from: string,
  input: string,
  source: string | undefined,
  stateBefore: ConversationState,
  isFirstMessage: boolean
): Promise<InboundPipelineResult> {
  const consentMessage = `${consentWelcome("turkish")}\n\n${getRestaurantKvkkText()}`;
  const stateAfter = await updateState(from, { consentPending: true, source });
  return {
    from,
    input,
    intent: "consent_disclosure",
    extractedSlots: {},
    stateBefore,
    stateAfter,
    nextStage: stateAfter.stage,
    assistantReply: "",
    consentMessage,
    awaitingConsent: true,
    requestHandoff: false,
    ownerAlertPreview: null,
    shouldNotifyOwner: false,
    shouldLogToSheet: false,
    isFirstMessage,
  };
}

// ── Reservation ───────────────────────────────────────────────────────────────

function reservationTurn(input: string, state: ConversationState, starting: boolean): TurnOutcome {
  if (!starting && isCancelMessage(input)) {
    return {
      intent: "restaurant_reservation_cancel",
      reply: "Tamam, rezervasyon talebinizi iptal ettim. Başka bir konuda yardımcı olabilir miyim?",
      updates: { ...RESET_RESERVATION, reservationDate: "", reservationTime: "", reservationPartySize: "" },
    };
  }

  const awaiting = !starting && state.reservationAwaiting ? state.reservationAwaiting : undefined;
  const found = extractReservationDetails(input, awaiting);
  const prev = starting
    ? { date: "", time: "", partySize: "" }
    : {
        date: state.reservationDate ?? "",
        time: state.reservationTime ?? "",
        partySize: state.reservationPartySize ?? "",
      };
  const next = {
    date: found.date ?? prev.date,
    time: found.time ?? prev.time,
    partySize: found.partySize ?? prev.partySize,
  };
  const progress = RESERVATION_FIELDS.some((f) => next[f] !== prev[f]);

  const detailUpdates: Partial<ConversationState> = {
    reservationDate: next.date,
    reservationTime: next.time,
    reservationPartySize: next.partySize,
    // Mirrored so the existing inbox "Preferred" chip and notes show the request.
    preferredDate: next.date,
    preferredTime: next.time,
    notes: next.partySize ? `Rezervasyon: ${formatPartySize(next.partySize)}` : "",
  };

  const missing = RESERVATION_FIELDS.filter((f) => !next[f]);
  if (missing.length === 0) {
    return {
      intent: "restaurant_reservation",
      reply:
        `Teşekkürler, rezervasyon talebinizi aldım: ${next.date}, ${next.time}, ${formatPartySize(next.partySize)}. ` +
        "Talebinizi hemen işletmeye iletiyorum; uygunluk için en kısa sürede size dönüş yapılacak.",
      handoff: "reservation",
      updates: { ...RESET_RESERVATION, ...detailUpdates, restaurantHandoffReason: "reservation" },
    };
  }

  const stall = starting || progress ? 0 : (state.reservationStallTurns ?? 0) + 1;
  if (stall >= RESERVATION_MAX_STALL_TURNS) {
    return handoff("restaurant_reservation", "reservation_stalled", detailUpdates);
  }

  const prefix = starting
    ? "Memnuniyetle, rezervasyon talebinizi alayım. "
    : progress
      ? "Not aldım. "
      : "Kusura bakmayın, tam anlayamadım. ";
  return {
    intent: "restaurant_reservation",
    reply: prefix + RESERVATION_QUESTIONS[missing[0]],
    updates: {
      ...detailUpdates,
      restaurantFlow: "reservation",
      reservationAwaiting: missing[0],
      reservationStallTurns: stall,
    },
  };
}

// ── Information ───────────────────────────────────────────────────────────────

function isHandoffSentinel(reply: string): boolean {
  return /\[\[\s*devret\s*\]\]/i.test(reply) || /^\s*devret\s*$/i.test(reply);
}

async function informationTurn(from: string, input: string, state: ConversationState): Promise<TurnOutcome> {
  const info = getRestaurantInfoText();
  if (!info) {
    // No approved information at all: do not let the model try.
    return handoff("restaurant_info", "info_not_configured");
  }

  let generated: string;
  try {
    generated = await replyGenerator(input, state, buildRestaurantSystemPrompt(info));
  } catch (err) {
    console.error("[Restaurant] reply generation failed — handing off:", err instanceof Error ? err.message : err);
    return handoff("restaurant_info", "ai_unavailable");
  }

  if (!generated.trim() || isHandoffSentinel(generated)) return handoff("restaurant_info", "info_missing");

  // Hard identifier redaction (same control as the clinic path, audit finding O-2).
  // Restaurant mode captures no phone of its own, so the customer's WhatsApp number
  // is the identifier to strip. Runs before the reply is sent or written to history.
  const { text: redactedText, redacted } = redactPatientIdentifiers(generated, {
    phone: state.phone ?? from,
  });
  if (redacted) {
    console.warn(`[Restaurant] customer identifier redacted from model reply (thread ${maskPhone(from)})`);
  }
  const raw = redactedText.trim();
  if (!raw) return handoff("restaurant_info", "info_missing");

  const sources = [info, input, ...state.history.filter((h) => h.role === "user").map((h) => h.content)];
  const ungrounded = findUngroundedFacts(raw, sources);
  if (ungrounded.length > 0) {
    // Count only — the figures themselves may echo customer text.
    console.warn(`[Restaurant] model reply had ${ungrounded.length} figure(s) not in RESTAURANT_INFO_TEXT — handing off`);
    return handoff("restaurant_info", "ungrounded_reply");
  }

  return { intent: "restaurant_info", reply: raw, updates: {} };
}

// ── Turn entry point ──────────────────────────────────────────────────────────

export async function runRestaurantTurn(
  from: string,
  input: string,
  source: string | undefined,
  stateBefore: ConversationState,
  isFirstMessage: boolean
): Promise<InboundPipelineResult> {
  let outcome: TurnOutcome;

  if (stateBefore.humanHandoff === true) {
    // A person owns this thread: record the message for the inbox, generate nothing,
    // and send nothing to the model. The route skips the reply because of the flag.
    outcome = { intent: "restaurant_paused", reply: "", updates: {} };
  } else if (stateBefore.restaurantFlow === "reservation") {
    outcome = reservationTurn(input, stateBefore, false);
  } else {
    const intent = detectRestaurantIntent(input);
    if (intent === "reservation") {
      outcome = reservationTurn(input, stateBefore, true);
    } else if (intent === "order") {
      const orderInfo = getRestaurantOrderInfo();
      outcome = orderInfo
        ? { intent: "restaurant_order", reply: orderInfo, verbatim: true, updates: {} }
        : handoff("restaurant_order", "order_not_configured");
    } else {
      outcome = await informationTurn(from, input, stateBefore);
    }
  }

  const updates: Partial<ConversationState> = { ...outcome.updates };
  if (source) updates.source = source;
  if (Object.keys(updates).length > 0) await updateState(from, updates);

  const assistantReply = outcome.verbatim ? outcome.reply : sanitizeReplyText(outcome.reply);
  await addToHistory(from, "user", input);
  if (assistantReply) await addToHistory(from, "assistant", assistantReply);

  const stateAfter = await getState(from);
  if (outcome.handoff) {
    console.log(`[Restaurant] handoff requested reason=${outcome.handoff}`);
  }

  return {
    from,
    input,
    intent: outcome.intent,
    extractedSlots: {},
    stateBefore,
    stateAfter,
    nextStage: stateAfter.stage,
    assistantReply,
    consentMessage: null,
    awaitingConsent: false,
    requestHandoff: outcome.handoff !== undefined,
    ownerAlertPreview: null,
    shouldNotifyOwner: false,
    shouldLogToSheet: false,
    isFirstMessage,
  };
}
