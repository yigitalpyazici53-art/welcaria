import { sanitizeSmsText } from "./sanitize";
import {
  getState,
  updateState,
  addToHistory,
  getNextStage,
} from "./conversationState";
import type { ConversationState } from "./conversationState";
import { extractSlots, detectConflict, calculateLeadScoreFromState, extractNameFallback } from "./slotExtractor";
import type { ExtractedSlots } from "./slotExtractor";
import { classifyIntent } from "./classifyIntent";
import { generateSmsReply } from "./anthropic";
import { buildOwnerAlert } from "./twilio";

const STAGE_FALLBACK: Record<string, string> = {
  collect_name:     "Merhaba! Randevu talebi icin adinizi ogrenebilir miyim?",
  collect_service:  "Hangi hizmet icin randevu almak istersiniz?",
  collect_datetime: "Hangi gun ve saatte gelmek istersiniz?",
  collect_location: "Hangi subemizi tercih edersiniz?",
  complete:         "Bilgilerinizi aldik. Ekibimiz sizi arayarak onaylayacaktir.",
};

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
  // by NAME_PATTERNS (which require explicit prefixes). When we're in collect_name stage
  // or the last assistant message asked for a name, try the heuristic fallback.
  if (!extractedSlots.name) {
    const needFallback =
      stateBefore.stage === "collect_name" ||
      stateBefore.history
        .slice(-2)
        .some(
          (h) =>
            h.role === "assistant" &&
            /isminizi|adınızı|adınız\b|adını/i.test(h.content)
        );
    if (needFallback) {
      const fallback = extractNameFallback(input);
      if (fallback) extractedSlots.name = fallback;
    }
  }

  const conflictQuestion = detectConflict(stateBefore, extractedSlots);

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
    // Single-location pilot: default location to "Ümraniye" when stage reaches complete
    if (stateUpdated.stage === "complete" && !stateUpdated.location) {
      stateUpdated = await updateState(from, { location: "Ümraniye" });
    }
    await addToHistory(from, "user", input);

    if (process.env.ANTHROPIC_API_KEY) {
      try {
        assistantReply = await generateSmsReply(input, stateUpdated);
      } catch (err) {
        console.error("[Pipeline] Anthropic failed:", err instanceof Error ? err.message : err);
        assistantReply = sanitizeSmsText(
          STAGE_FALLBACK[stateUpdated.stage] ?? STAGE_FALLBACK.collect_name
        );
      }
    } else {
      assistantReply = sanitizeSmsText(
        STAGE_FALLBACK[stateUpdated.stage] ?? STAGE_FALLBACK.collect_name
      );
    }
  }

  await addToHistory(from, "assistant", assistantReply);

  const stateAfter = await getState(from);

  const isFirstHighUrgency = stateAfter.urgency === "high" && !stateAfter.ownerAlertedHighUrgency;
  const isFirstComplete = stateAfter.stage === "complete" && !stateAfter.ownerAlertedComplete;
  const isHotLead = stateAfter.leadScore === "hot";
  const shouldNotifyOwner = isFirstMessage || isFirstHighUrgency || isFirstComplete || isHotLead;
  const ownerAlertPreview = shouldNotifyOwner ? buildOwnerAlert(from, stateAfter) : null;

  const shouldLogToSheet = !!(
    stateAfter.service &&
    stateAfter.name &&
    stateAfter.phone &&
    (stateAfter.preferredDate || stateAfter.preferredTime) &&
    stateAfter.location
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
