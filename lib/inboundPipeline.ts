import { sanitizeReplyText } from "./sanitize";
import {
  getState,
  updateState,
  addToHistory,
  getNextStage,
} from "./conversationState";
import type { ConversationState } from "./conversationState";
import {
  extractSlots,
  detectConflict,
  calculateLeadScoreFromState,
  extractNameFallback,
  detectServiceCategory,
  isInformationalOnlyMessage,
  isInstagramInquiry,
  isTransferInquiry,
  isParkingInquiry,
  isLocationInquiry,
} from "./slotExtractor";
import type { ExtractedSlots } from "./slotExtractor";
import { classifyIntent } from "./classifyIntent";
import { recordInboundMessage, getDefaultTenantId } from "./compliance";
import { generateSmsReply } from "./anthropic";
import { buildOwnerAlert } from "./twilio";
import { clinicConfig, getStartingPriceFor } from "./clinicConfig";
import {
  fallbackText,
  firstTimeQuestionText,
  formatStartingPriceSentence,
  enforceExactPriceLiteral,
  completionReply,
  deviceBrandsReply,
  locationReply,
  preTreatmentReply,
  transferReply,
  nameUpdatedReply,
  treatmentAreaLabel,
  consentDisclosure,
} from "./localization";

// Cap inbound message length for the pipeline. WhatsApp allows long texts; slot
// extraction and prompting only need the head of the message.
const INPUT_MAX_CHARS = 500;

// Pricing sentence for the static fallback path, in the conversation language. Only
// speaks about price when the patient asked. If the matching vertical has a
// clinic-configured starting price that has not been shared yet, it is quoted verbatim
// inside a natural sentence (Turkish gets the correct ablative suffix — "2.500 TL'den",
// never "2.500den"); once a past assistant reply already contains the price, nothing is
// repeated. Without a configured price the localized safe pricing sentence is used.
function fallbackPricingSentence(state: ConversationState): string {
  if (!state.priceInquired) return "";
  const lang = state.detectedLanguage;
  const price = getStartingPriceFor(state.serviceCategory);
  if (!price) return `${fallbackText("safePrice", lang)} `;
  const sharedForm = sanitizeReplyText(price);
  const alreadyShared =
    sharedForm.length > 0 &&
    state.history.some((h) => h.role === "assistant" && h.content.includes(sharedForm));
  if (alreadyShared) return "";
  return `${formatStartingPriceSentence(price, lang)} `;
}

// Deterministic, vertical-aware qualification reply used on the static fallback path
// (no Anthropic key, or the API failed). It mirrors the qualification question the
// system prompt would ask — in the conversation language — and critically NEVER
// requests name/phone or confirms an appointment while the vertical field is missing.
// Wording is kept short so composed replies survive SMS-length truncation at send time.
function buildQualificationFallbackReply(state: ConversationState): string {
  const cat = state.serviceCategory;
  const lang = state.detectedLanguage;

  if (cat === "laser") {
    // Laser-specific natural wording when the service is laser-family; generic otherwise
    // (the laser category also covers botox/filler/facial, where "laser" would be wrong).
    const question = firstTimeQuestionText(lang, state.service);
    // A volunteered/requested slot is acknowledged as "we'll check availability" — never confirmed.
    if (state.availabilityInquiry || state.preferredDate || state.preferredTime) {
      return `${fallbackText("availabilityAck", lang)} ${question}`;
    }
    return `${fallbackPricingSentence(state)}${question}`;
  }
  if (cat === "hair_transplant") {
    const pricing = fallbackPricingSentence(state);
    if (state.estimatedGrafts !== undefined) {
      return `${pricing}${fallbackText("travelQuestion", lang)}`;
    }
    return `${pricing}${fallbackText("graftQuestion", lang)}`;
  }
  if (cat === "dental") {
    return `${fallbackPricingSentence(state)}${fallbackText("dentalScopeQuestion", lang)}`;
  }
  return fallbackText("qualificationClarify", lang);
}

// Static reply for an informational-only question, using ONLY clinic-configured values
// (inserted verbatim) with the surrounding sentence in the conversation language.
// Branch selection uses THIS message's slots (not the sticky state flags, which persist
// from earlier turns). Order matters: channel question first, then transfer/parking
// (more specific than the generic location patterns), then device, preparation, location.
function buildInformationalFallbackReply(
  input: string,
  slots: ExtractedSlots,
  state: ConversationState
): string {
  const lang = state.detectedLanguage;
  const loc = clinicConfig.locationInfo;

  if (isInstagramInquiry(input)) return fallbackText("instagramRedirect", lang);
  if (isTransferInquiry(input)) return transferReply(loc.airportTransfer, lang);
  if (isParkingInquiry(input)) {
    return loc.parkingAvailable ? loc.parkingAvailable : fallbackText("locationFallback", lang);
  }
  if (slots.deviceInquiry) {
    return clinicConfig.deviceBrands
      ? deviceBrandsReply(clinicConfig.deviceBrands, lang)
      : fallbackText("deviceFallback", lang);
  }
  if (slots.preTreatmentInquiry) {
    const cat = state.serviceCategory;
    const note =
      cat === "laser" ? clinicConfig.preTreatmentInstructions.laser
      : cat === "hair_transplant" ? clinicConfig.preTreatmentInstructions.hairTransplant
      : cat === "dental" ? clinicConfig.preTreatmentInstructions.dental
      : "";
    return preTreatmentReply(note || undefined, lang);
  }
  if (isLocationInquiry(input)) {
    return locationReply(
      { address: loc.address, googleMapsLink: loc.googleMapsLink, nearestTransport: loc.nearestTransport },
      lang
    );
  }
  return fallbackText("postCompletionAck", lang);
}

// Chooses the static reply for a turn, in the conversation language. The qualification
// stage is vertical-aware so the fallback never regresses to a generic prompt (or worse,
// a name/phone request).
function staticReplyFor(
  state: ConversationState,
  input: string,
  slots: ExtractedSlots,
  informationalOnly: boolean,
  postCompletion: boolean
): string {
  if (postCompletion) {
    if (slots.name) return nameUpdatedReply(slots.name, state.detectedLanguage);
    return informationalOnly
      ? buildInformationalFallbackReply(input, slots, state)
      : fallbackText("postCompletionAck", state.detectedLanguage);
  }
  if (informationalOnly) return buildInformationalFallbackReply(input, slots, state);
  switch (state.stage) {
    case "collect_qualification":
      return buildQualificationFallbackReply(state);
    case "collect_datetime":
      return fallbackText("dateTimeQuestion", state.detectedLanguage);
    case "collect_name":
      return fallbackText("namePhoneQuestion", state.detectedLanguage);
    case "complete":
      return buildCompleteReply(state);
    default:
      return fallbackText("treatmentAreaQuestion", state.detectedLanguage);
  }
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
  /**
   * KVKK consent/disclosure to send BEFORE the assistant reply on the first turn
   * of a new conversation. null on every subsequent turn and for any conversation
   * that already had state (consent already recorded).
   */
  consentMessage: string | null;
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
  /** Compliance tenant (clinic number identity); defaults to the deployment tenant. */
  tenantId?: string;
}

// Completion + follow-up copy MUST match the active conversation language. The language is
// read from state.detectedLanguage, which slot extraction keeps sticky across the final
// (often language-neutral) name/phone turn — so a Turkish conversation stays Turkish even
// when the closing message is just "Zeynep, +44 7700 900123". All seven supported
// languages are covered by the localization dictionary.
function buildCompleteReply(state: ConversationState): string {
  // Localize the canonical treatment area to the conversation language so a Turkish reply
  // never says "full body". A service name (no treatmentArea) passes through unchanged.
  const area = treatmentAreaLabel(state.treatmentArea, state.detectedLanguage) || state.service;
  return completionReply(state.detectedLanguage, state.name, area);
}

export async function processInboundMessage(
  options: InboundMessageOptions
): Promise<InboundPipelineResult> {
  const { from, body, source } = options;

  // Compliance: persist lastInboundAt for the 24h-window gate and reset the
  // per-inbound reply counters. Must run for EVERY inbound patient message —
  // outbound sends are blocked for threads with no recorded inbound.
  try {
    await recordInboundMessage(from, options.tenantId ?? getDefaultTenantId());
  } catch (err) {
    console.error(
      "[Pipeline] compliance inbound recording failed:",
      err instanceof Error ? err.message : err
    );
  }

  // Unicode-preserving sanitization: Arabic/Cyrillic/accented messages must reach slot
  // extraction and language detection intact. SMS charset/length limits apply only at
  // SMS send time (sendSms).
  const input = sanitizeReplyText(body).slice(0, INPUT_MAX_CHARS);
  const stateBefore = await getState(from);
  const isFirstMessage = stateBefore.history.length === 0;
  const wasComplete = stateBefore.stage === "complete";

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
  // NEVER after completion either: post-completion follow-ups are conversation, not names.
  if (!extractedSlots.name && !stateBefore.name && !wasComplete) {
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

  // Deterministic qualification gate: purely informational questions are answered
  // without appending a qualification question or contact request.
  const informationalOnly = isInformationalOnlyMessage(input, extractedSlots, stateBefore);

  // Conflict clarification is suppressed after completion: a follow-up mentioning a
  // different treatment is a new inquiry, not an ambiguity about the captured lead.
  const conflictQuestion = wasComplete ? null : detectConflict(stateBefore, extractedSlots, input);

  let assistantReply = "";

  if (conflictQuestion) {
    assistantReply = sanitizeReplyText(conflictQuestion);
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

    const justCompleted = stateUpdated.stage === "complete" && !wasComplete;
    const postCompletion = stateUpdated.stage === "complete" && wasComplete;

    if (justCompleted) {
      // The completion message is sent exactly once — on the transition to complete.
      assistantReply = sanitizeReplyText(buildCompleteReply(stateUpdated));
    } else if (process.env.ANTHROPIC_API_KEY) {
      try {
        assistantReply = await generateSmsReply(input, stateUpdated, {
          informationalTurn: informationalOnly && !postCompletion,
          postCompletion,
        });
        // The configured starting price is an opaque literal: if the model localized its
        // punctuation or currency token ("₺2.500" → "₺2,500" / "2.500 TL" / "TRY 2,500"),
        // deterministically restore the exact configured string.
        const configuredPrice = getStartingPriceFor(stateUpdated.serviceCategory);
        if (configuredPrice) {
          assistantReply = enforceExactPriceLiteral(assistantReply, configuredPrice);
        }
      } catch (err) {
        console.error("[Pipeline] Anthropic failed:", err instanceof Error ? err.message : err);
        console.log(`[Pipeline] using static fallback reply (stage: ${stateUpdated.stage})`);
        assistantReply = sanitizeReplyText(
          staticReplyFor(stateUpdated, input, extractedSlots, informationalOnly, postCompletion)
        );
      }
    } else {
      console.warn("[Pipeline] ANTHROPIC_API_KEY not set — using static fallback reply");
      assistantReply = sanitizeReplyText(
        staticReplyFor(stateUpdated, input, extractedSlots, informationalOnly, postCompletion)
      );
    }
  }

  await addToHistory(from, "user", input);
  await addToHistory(from, "assistant", assistantReply);

  // KVKK consent: on the very first inbound of a conversation (no prior state and
  // consent not yet recorded), produce the one-time AI-intake disclosure and stamp
  // the consent flags. The disclosure text uses the language detected from this
  // first message, defaulting to Turkish. The route sends this BEFORE the reply.
  let consentMessage: string | null = null;
  if (isFirstMessage && !stateBefore.consentGiven) {
    consentMessage = consentDisclosure(
      extractedSlots.detectedLanguage ?? stateBefore.detectedLanguage
    );
    await updateState(from, { consentGiven: true, consentTimestamp: Date.now() });
  }

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
    consentMessage,
    ownerAlertPreview,
    shouldNotifyOwner,
    shouldLogToSheet,
    isFirstMessage,
  };
}
