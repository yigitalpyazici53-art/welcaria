import { sanitizeSmsText, sanitizeReplyText } from "./sanitize";
import {
  getState,
  updateState,
  addToHistory,
  getNextStage,
} from "./conversationState";
import type { ConversationState } from "./conversationState";
import { extractSlots, detectConflict, calculateLeadScoreFromState, extractNameFallback, detectServiceCategory } from "./slotExtractor";
import type { ExtractedSlots } from "./slotExtractor";
import { classifyIntent } from "./classifyIntent";
import { generateSmsReply } from "./anthropic";
import { buildOwnerAlert } from "./twilio";
import { clinicConfig, getStartingPriceFor } from "./clinicConfig";

const STAGE_FALLBACK: Record<string, string> = {
  collect_treatment_area: `Hi! Which area or treatment are you interested in?`,
  collect_qualification:  "To guide you better, could you share a bit more about what you're looking for?",
  collect_datetime:       "Which day and time would work best for you?",
  collect_name:           "Could I please take your name and phone number?",
  complete:               "Thank you. We received your appointment request. Our team will follow up shortly.",
};

// Pricing sentence for the static fallback path. Only speaks about price when the
// patient asked. If the matching vertical has a clinic-configured starting price that
// has not been shared yet, it is quoted verbatim (never rounded, converted, or swapped
// for another vertical's price); once a past assistant reply already contains the
// sanitized price, nothing is repeated. Without a configured price the caller's safe
// pricing sentence is used unchanged. Wording is kept short so the qualification
// question survives the SMS-length truncation applied by sanitizeSmsText().
function fallbackPricingSentence(state: ConversationState, safePricingSentence: string): string {
  if (!state.priceInquired) return "";
  const price = getStartingPriceFor(state.serviceCategory);
  if (!price) return safePricingSentence;
  const sharedForm = sanitizeReplyText(price);
  const alreadyShared =
    sharedForm.length > 0 &&
    state.history.some((h) => h.role === "assistant" && h.content.includes(sharedForm));
  if (alreadyShared) return "";
  return `Prices start from ${price}; final cost varies by plan. `;
}

// Deterministic, vertical-aware qualification reply used on the static fallback path
// (no Anthropic key, or the API failed). It mirrors the qualification question the
// system prompt would ask, and critically NEVER requests name/phone or confirms an
// appointment while the vertical field is still missing. Wording is kept short so the
// question survives the SMS-length truncation applied by sanitizeSmsText().
function buildQualificationFallbackReply(state: ConversationState): string {
  const cat = state.serviceCategory;

  if (cat === "laser") {
    const question = "Is this your first time having this treatment?";
    // A volunteered/requested slot is acknowledged as "we'll check availability" — never confirmed.
    if (state.availabilityInquiry || state.preferredDate || state.preferredTime) {
      return `Noted your preferred time; our team will check availability. ${question}`;
    }
    return `${fallbackPricingSentence(state, "Pricing depends on a quick assessment. ")}${question}`;
  }
  if (cat === "hair_transplant") {
    const pricing = fallbackPricingSentence(state, "Pricing depends on a graft assessment. ");
    if (state.estimatedGrafts !== undefined) {
      return `${pricing}Will you be travelling to Istanbul, or already based here?`;
    }
    return `${pricing}Do you know roughly how many grafts you're considering?`;
  }
  if (cat === "dental") {
    const pricing = fallbackPricingSentence(state, "Pricing depends on a quick assessment. ");
    return `${pricing}Are you considering a full smile design or a few teeth?`;
  }
  return STAGE_FALLBACK.collect_qualification;
}

// Chooses the static reply for a stage. The qualification stage is vertical-aware so the
// fallback never regresses to a generic prompt (or worse, a name/phone request).
function staticReplyFor(state: ConversationState): string {
  if (state.stage === "collect_qualification") return buildQualificationFallbackReply(state);
  // Completion copy is language-aware; delegate so the static path never emits the
  // English-only STAGE_FALLBACK.complete string for a Turkish conversation.
  if (state.stage === "complete") return buildCompleteReply(state);
  return STAGE_FALLBACK[state.stage] ?? STAGE_FALLBACK.collect_treatment_area;
}

export interface InboundPipelineResult {
  from: string;
  input: string;
  intent: string;
  extractedSlots: ExtractedSlots;
  stateBefore: ConversationState;
  stateAfter: ConversationState;
  nextStage: string;
  assistantReply: string;
  ownerAlertPreview: string | null;
  shouldNotifyOwner: boolean;
  shouldLogToSheet: boolean;
  isFirstMessage: boolean;
}

export interface InboundMessageOptions {
  from: string;
  body: string;
  source?: string;
  profileName?: string;
}

// Completion + follow-up copy MUST match the active conversation language. The language is
// read from state.detectedLanguage, which slot extraction keeps sticky across the final
// (often language-neutral) name/phone turn — so a Turkish conversation stays Turkish even
// when the closing message is just "Zeynep, +44 7700 900123".
function buildCompleteReply(state: ConversationState): string {
  const area = state.treatmentArea || state.service;
  if (state.detectedLanguage === "turkish") {
    if (state.name && area) {
      return `Teşekkür ederiz ${state.name}. ${area} için randevu talebinizi aldık. Ekibimiz kısa süre içinde sizinle iletişime geçecektir.`;
    }
    if (state.name) {
      return `Teşekkür ederiz ${state.name}. Randevu talebinizi aldık. Ekibimiz kısa süre içinde sizinle iletişime geçecektir.`;
    }
    if (area) {
      return `Teşekkür ederiz. ${area} için randevu talebinizi aldık. Ekibimiz kısa süre içinde sizinle iletişime geçecektir.`;
    }
    return "Teşekkür ederiz. Randevu talebinizi aldık. Ekibimiz kısa süre içinde sizinle iletişime geçecektir.";
  }
  if (state.name && area) {
    return `Thank you, ${state.name}. We received your appointment request for ${area}. Our team will follow up shortly.`;
  }
  if (state.name) {
    return `Thank you, ${state.name}. We received your appointment request. Our team will follow up shortly.`;
  }
  if (area) {
    return `Thank you. We received your appointment request for ${area}. Our team will follow up shortly.`;
  }
  return "Thank you. We received your appointment request. Our team will follow up shortly.";
}

export async function processInboundMessage(
  options: InboundMessageOptions
): Promise<InboundPipelineResult> {
  const { from, body, source } = options;

  const input = sanitizeSmsText(body);
  const stateBefore = await getState(from);
  const isFirstMessage = stateBefore.history.length === 0;

  const intentResult = classifyIntent(input, isFirstMessage);

  let extractedSlots: ExtractedSlots = {};
  try {
    extractedSlots = extractSlots(input);
  } catch (err) {
    console.error("[Pipeline] Slot extraction failed:", err instanceof Error ? err.message : err);
  }

  // Stage-aware name fallback: bare Turkish names like "ayşe" or "mehmet" aren't caught
  // by NAME_PATTERNS (which require explicit prefixes). Try the heuristic fallback when
  // no other slots were extracted from this message (guard) and either the stage expects
  // a name or the user appears to be volunteering one early.
  // NEVER once a name is captured: a heuristic guess must not overwrite a confirmed name
  // (e.g. "gelmedi bir şey" after "Zeynep"). Explicit corrections like "Adım Zeynep
  // değil, Ayşe" still update the name through NAME_PATTERNS above.
  if (!extractedSlots.name && !stateBefore.name) {
    const noOtherSlots = Object.keys(extractedSlots).filter(k => k !== "leadScore" && k !== "detectedLanguage").length === 0;
    const needFallback =
      noOtherSlots &&
      (stateBefore.stage === "collect_name" ||
        stateBefore.stage === "collect_qualification" ||
        stateBefore.stage === "collect_datetime" ||
        stateBefore.history
          .slice(-2)
          .some(
            (h) =>
              h.role === "assistant" &&
              /isminizi|adınızı|adınız\b|adını/i.test(h.content)
          ));
    if (needFallback) {
      const fallback = extractNameFallback(input);
      if (fallback) extractedSlots.name = fallback;
    }
  }

  // When a treatment area is detected without an explicit service, normalize to the configured primary service.
  // Also derive the service category so the vertical qualification gate engages for area-only openers.
  if (extractedSlots.treatmentArea && !extractedSlots.service && !stateBefore.service) {
    extractedSlots.service = clinicConfig.primaryService;
    if (!extractedSlots.serviceCategory && !stateBefore.serviceCategory) {
      extractedSlots.serviceCategory = detectServiceCategory(clinicConfig.primaryService, extractedSlots.treatmentArea);
    }
  }

  const conflictQuestion = detectConflict(stateBefore, extractedSlots, input);

  let assistantReply = "";

  if (conflictQuestion) {
    assistantReply = sanitizeSmsText(conflictQuestion);
  } else {
    const updates: Partial<ConversationState> = extractedSlots as Partial<ConversationState>;
    if (source) updates.source = source;

    let stateUpdated = await updateState(from, updates);
    const recalcScore = calculateLeadScoreFromState(stateUpdated);
    stateUpdated = await updateState(from, {
      leadScore: recalcScore,
      stage: getNextStage(stateUpdated),
    });
    const defaultLocation = clinicConfig.defaultLocation;
    if (stateUpdated.stage === "complete" && !stateUpdated.location && defaultLocation) {
      stateUpdated = await updateState(from, { location: defaultLocation });
    }

    if (stateUpdated.stage === "complete") {
      assistantReply = sanitizeSmsText(buildCompleteReply(stateUpdated));
    } else if (process.env.ANTHROPIC_API_KEY) {
      try {
        assistantReply = await generateSmsReply(input, stateUpdated);
      } catch (err) {
        console.error("[Pipeline] Anthropic failed:", err instanceof Error ? err.message : err);
        console.log(`[Pipeline] using static fallback reply (stage: ${stateUpdated.stage})`);
        assistantReply = sanitizeSmsText(staticReplyFor(stateUpdated));
      }
    } else {
      console.warn("[Pipeline] ANTHROPIC_API_KEY not set — using static fallback reply");
      assistantReply = sanitizeSmsText(staticReplyFor(stateUpdated));
    }
  }

  await addToHistory(from, "user", input);
  await addToHistory(from, "assistant", assistantReply);

  const stateAfter = await getState(from);

  const isFirstHighUrgency = stateAfter.urgency === "high" && !stateAfter.ownerAlertedHighUrgency;
  const isFirstComplete = stateAfter.stage === "complete" && !stateAfter.ownerAlertedComplete;
  const isHotLead = stateAfter.leadScore === "hot";
  const shouldNotifyOwner = isFirstMessage || isFirstHighUrgency || isFirstComplete || isHotLead;
  const ownerAlertPreview = shouldNotifyOwner ? buildOwnerAlert(from, stateAfter) : null;

  const shouldLogToSheet = !!(
    (stateAfter.service || stateAfter.treatmentArea) &&
    stateAfter.name &&
    (stateAfter.preferredDate || stateAfter.preferredTime)
  );

  return {
    from,
    input,
    intent: intentResult.category,
    extractedSlots,
    stateBefore,
    stateAfter,
    nextStage: stateAfter.stage,
    assistantReply,
    ownerAlertPreview,
    shouldNotifyOwner,
    shouldLogToSheet,
    isFirstMessage,
  };
}
