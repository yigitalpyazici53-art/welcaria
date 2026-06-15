import { NextRequest, NextResponse } from "next/server";
import { sanitizeSmsText } from "@/lib/sanitize";
import {
  getState,
  updateState,
  addToHistory,
  getNextStage,
  getStateStorageMode,
  hasRedisConfig,
  getConversationKey,
  readConversationState,
  writeConversationState,
} from "@/lib/conversationState";
import type { ConversationState } from "@/lib/conversationState";
import { extractSlots, detectConflict, calculateLeadScoreFromState } from "@/lib/slotExtractor";
import type { ExtractedSlots } from "@/lib/slotExtractor";
import { classifyIntent } from "@/lib/classifyIntent";
import { generateSmsReply } from "@/lib/anthropic";
import { buildOwnerAlert } from "@/lib/twilio";

// Stage-based deterministic Turkish fallback used when Anthropic is unavailable.
const STAGE_FALLBACK: Record<string, string> = {
  collect_name:     "Merhaba! Randevu talebi icin adinizi ogrenebilir miyim?",
  collect_service:  "Hangi hizmet icin randevu almak istersiniz?",
  collect_datetime: "Hangi gun ve saatte gelmek istersiniz?",
  collect_location: "Hangi subemizi tercih edersiniz?",
  complete:         "Bilgilerinizi aldik. Ekibimiz sizi arayarak onaylayacaktir.",
};

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── 1. Validate secret ───────────────────────────────────────────────────
  const configuredSecret = process.env.TEST_WEBHOOK_SECRET;
  if (!configuredSecret) {
    return NextResponse.json(
      { ok: false, error: "TEST_WEBHOOK_SECRET not configured on server" },
      { status: 500 }
    );
  }

  let parsed: { secret?: string; from?: string; body?: string };
  try {
    parsed = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  if (!parsed.secret || parsed.secret !== configuredSecret) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const from = (parsed.from ?? "").trim();
  const rawInput = (parsed.body ?? "").trim();

  if (!from || !rawInput) {
    return NextResponse.json({ ok: false, error: "Missing from or body" }, { status: 400 });
  }

  // ── 2. Normalize / sanitize ──────────────────────────────────────────────
  const input = sanitizeSmsText(rawInput);

  // ── 3. Storage mode ──────────────────────────────────────────────────────
  const stateStorage = getStateStorageMode();
  const redisConfigured = hasRedisConfig();
  const stateKey = getConversationKey(from);

  // ── 4. Redis diagnostics: read BEFORE main flow ──────────────────────────
  let diagReadBeforeFound = false;
  let diagWriteAttempted = false;
  let diagWriteSucceeded = false;
  let diagReadAfterFound = false;
  let diagReadAfterService: string | null = null;
  let diagRedisError: string | null = null;

  if (redisConfigured) {
    try {
      const preState = await readConversationState(from);
      diagReadBeforeFound = preState !== null;
    } catch (err) {
      diagRedisError = err instanceof Error ? err.message : String(err);
    }
  }

  // ── 5. Load state before ─────────────────────────────────────────────────
  const stateBefore = await getState(from);
  const isFirstMessage = stateBefore.history.length === 0;

  // ── 6. Classify intent ───────────────────────────────────────────────────
  const intentResult = classifyIntent(input, isFirstMessage);

  // ── 7. Extract slots ─────────────────────────────────────────────────────
  let extractedSlots: ExtractedSlots = {};
  try {
    extractedSlots = extractSlots(input);
  } catch (err) {
    console.error("[TestInbound] Slot extraction failed:", err instanceof Error ? err.message : err);
  }

  // ── 8. Detect service conflict ───────────────────────────────────────────
  const conflictQuestion = detectConflict(stateBefore, extractedSlots);

  // ── 9. Build reply (mirrors incoming-sms logic) ──────────────────────────
  let assistantReply = "";

  if (conflictQuestion) {
    assistantReply = sanitizeSmsText(conflictQuestion);
    console.log("[TestInbound] conflict clarification — no state update");
  } else {
    let stateUpdated = await updateState(from, extractedSlots as Partial<ConversationState>);
    const recalcScore = calculateLeadScoreFromState(stateUpdated);
    stateUpdated = await updateState(from, { leadScore: recalcScore, stage: getNextStage(stateUpdated) });
    await addToHistory(from, "user", input);

    if (process.env.ANTHROPIC_API_KEY) {
      try {
        assistantReply = await generateSmsReply(input, stateUpdated);
      } catch (err) {
        console.error("[TestInbound] Anthropic failed:", err instanceof Error ? err.message : err);
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

  // ── 10. Reload final state ───────────────────────────────────────────────
  const stateAfter = await getState(from);

  // ── 11. Redis diagnostics: write + read AFTER to verify persistence ──────
  if (redisConfigured) {
    diagWriteAttempted = true;
    try {
      await writeConversationState(from, stateAfter);
      diagWriteSucceeded = true;
      const postState = await readConversationState(from);
      diagReadAfterFound = postState !== null;
      diagReadAfterService = postState?.service ?? null;
    } catch (err) {
      if (!diagRedisError) {
        diagRedisError = err instanceof Error ? err.message : String(err);
      }
    }
  }

  // ── 12. Owner alert preview — do NOT send SMS ────────────────────────────
  const isFirstHighUrgency = stateAfter.urgency === "high" && !stateAfter.ownerAlertedHighUrgency;
  const isFirstComplete = stateAfter.stage === "complete" && !stateAfter.ownerAlertedComplete;
  const isHotLead = stateAfter.leadScore === "hot";
  const wouldNotifyOwner = isFirstMessage || isFirstHighUrgency || isFirstComplete || isHotLead;
  const ownerAlertPreview = wouldNotifyOwner ? buildOwnerAlert(from, stateAfter) : null;

  // ── 13. Sheet log preview — do NOT write to sheet ────────────────────────
  // Reflects whether the accumulated lead data is complete enough to produce
  // a meaningful sheet entry (env vars are a separate deployment concern).
  const wouldLogToSheet = !!(
    stateAfter.service &&
    stateAfter.name &&
    stateAfter.phone &&
    (stateAfter.preferredDate || stateAfter.preferredTime) &&
    stateAfter.location
  );

  const statePersistenceWarning =
    stateStorage === "memory"
      ? "Redis is not configured; state will not persist reliably on serverless."
      : null;

  if (stateStorage === "memory") {
    console.warn(
      "[TestInbound] WARNING: stateStorage=memory — Redis env vars missing; multi-turn state will not persist across serverless invocations."
    );
  }

  console.log(
    `[TestInbound] done from=${from} intent=${intentResult.category} stage=${stateAfter.stage} stateStorage=${stateStorage} diagWriteSucceeded=${diagWriteSucceeded}`
  );

  return NextResponse.json({
    ok: true,
    from,
    input,
    intent: intentResult.category,
    extractedSlots,
    stateBefore,
    stateAfter,
    nextStage: stateAfter.stage,
    assistantReply,
    ownerAlertPreview,
    wouldNotifyOwner,
    wouldLogToSheet,
    stateStorage,
    statePersistenceWarning,
    redisConfigured,
    stateKey,
    stateDebug: {
      stateKey,
      storageMode: stateStorage,
      redisConfigured,
      readBeforeFound: diagReadBeforeFound,
      writeAttempted: diagWriteAttempted,
      writeSucceeded: diagWriteSucceeded,
      readAfterFound: diagReadAfterFound,
      readAfterService: diagReadAfterService,
      redisError: diagRedisError,
    },
  });
}
