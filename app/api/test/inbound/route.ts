import { NextRequest, NextResponse } from "next/server";
import {
  getStateStorageMode,
  hasRedisConfig,
  getConversationKey,
  readConversationState,
  writeConversationState,
} from "@/lib/conversationState";
import type { ConversationState } from "@/lib/conversationState";
import {
  processInboundMessage,
  recordConsentDisclosureResult,
} from "@/lib/inboundPipeline";
import { secretsMatch } from "@/lib/secretCompare";
import { maskPhone } from "@/lib/sanitize";
import { isLocalDevelopment } from "@/lib/devGuard";

// Non-identifying view of a conversation state. Carries the flow markers a
// developer needs to debug the pipeline (did the stage advance, was the vertical
// detected, is the history growing) and NO patient identity: no name, phone,
// notes, treatment area, preferred date/time, or message history.
function summarizeState(state: ConversationState) {
  return {
    stage: state.stage,
    serviceCategory: state.serviceCategory ?? null,
    leadScore: state.leadScore ?? null,
    urgency: state.urgency ?? null,
    detectedLanguage: state.detectedLanguage ?? null,
    historyLength: Array.isArray(state.history) ? state.history.length : 0,
    humanHandoff: state.humanHandoff === true,
    consentGiven: state.consentGiven === true,
    consentDisclosureSent: state.consentDisclosureSent === true,
    consentPending: state.consentPending === true,
    hasName: !!state.name,
    hasTreatmentArea: !!(state.treatmentArea || state.service),
    hasPreferredDateTime: !!(state.preferredDate || state.preferredTime),
  };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── 0. Local development only (allow-list, fails closed) ──────────────────
  if (!isLocalDevelopment()) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }

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

  if (!secretsMatch(parsed.secret, configuredSecret)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const from = (parsed.from ?? "").trim();
  const rawInput = (parsed.body ?? "").trim();

  if (!from || !rawInput) {
    return NextResponse.json({ ok: false, error: "Missing from or body" }, { status: 400 });
  }

  // ── 2. Storage mode ──────────────────────────────────────────────────────
  const stateStorage = getStateStorageMode();
  const redisConfigured = hasRedisConfig();
  const stateKey = getConversationKey(from);

  // ── 3. Redis diagnostics: read BEFORE main flow ──────────────────────────
  let diagReadBeforeFound = false;
  let diagWriteAttempted = false;
  let diagWriteSucceeded = false;
  let diagReadAfterFound = false;
  // Round-trip proof that does not echo patient text: the persisted stage, not
  // the persisted service name.
  let diagReadAfterStage: string | null = null;
  let diagRedisError: string | null = null;

  if (redisConfigured) {
    try {
      const preState = await readConversationState(from);
      diagReadBeforeFound = preState !== null;
    } catch (err) {
      diagRedisError = err instanceof Error ? err.message : String(err);
    }
  }

  // ── 4. Run shared pipeline ───────────────────────────────────────────────
  // KVKK consent gate: the pipeline returns a disclosure turn until the disclosure
  // send is confirmed, and this endpoint is a dry run — it sends nothing at all, so
  // no verdict would ever arrive and every call would return the same disclosure.
  // Seed a delivered-disclosure record so the diagnostic keeps exercising the main
  // flow. Safe: isLocalDevelopment() fails closed, so this never runs in production.
  await recordConsentDisclosureResult(from, true);

  const result = await processInboundMessage({ from, body: rawInput });

  // ── 5. Redis diagnostics: write + read AFTER to verify persistence ────────
  if (redisConfigured) {
    diagWriteAttempted = true;
    try {
      await writeConversationState(from, result.stateAfter);
      diagWriteSucceeded = true;
      const postState = await readConversationState(from);
      diagReadAfterFound = postState !== null;
      diagReadAfterStage = postState?.stage ?? null;
    } catch (err) {
      if (!diagRedisError) {
        diagRedisError = err instanceof Error ? err.message : String(err);
      }
    }
  }

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
    `[TestInbound] done from=${maskPhone(from)} intent=${result.intent} stage=${result.stateAfter.stage} stateStorage=${stateStorage} diagWriteSucceeded=${diagWriteSucceeded}`
  );

  return NextResponse.json({
    ok: true,
    from,
    input: result.input,
    intent: result.intent,
    extractedSlots: result.extractedSlots,
    // stateBefore / stateAfter / ownerAlertPreview used to be returned in full.
    // They are the STORED conversation — name, phone, treatment, notes, and the
    // whole message history — for any `from` the caller names, which turned this
    // route into a one-request PII dump of an arbitrary patient. Only
    // non-identifying flow markers are reported now; the diagnostic purpose
    // (did the stage advance? did Redis persist it?) is unchanged.
    stateBefore: summarizeState(result.stateBefore),
    stateAfter: summarizeState(result.stateAfter),
    nextStage: result.nextStage,
    assistantReply: result.assistantReply,
    wouldNotifyOwner: result.shouldNotifyOwner,
    wouldLogToSheet: result.shouldLogToSheet,
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
      readAfterStage: diagReadAfterStage,
      redisError: diagRedisError,
    },
  });
}
