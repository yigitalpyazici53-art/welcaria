import { NextRequest, NextResponse } from "next/server";
import {
  getStateStorageMode,
  hasRedisConfig,
  getConversationKey,
  readConversationState,
  writeConversationState,
} from "@/lib/conversationState";
import { processInboundMessage } from "@/lib/inboundPipeline";

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

  // ── 2. Storage mode ──────────────────────────────────────────────────────
  const stateStorage = getStateStorageMode();
  const redisConfigured = hasRedisConfig();
  const stateKey = getConversationKey(from);

  // ── 3. Redis diagnostics: read BEFORE main flow ──────────────────────────
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

  // ── 4. Run shared pipeline ───────────────────────────────────────────────
  const result = await processInboundMessage({ from, body: rawInput });

  // ── 5. Redis diagnostics: write + read AFTER to verify persistence ────────
  if (redisConfigured) {
    diagWriteAttempted = true;
    try {
      await writeConversationState(from, result.stateAfter);
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
    `[TestInbound] done from=${from} intent=${result.intent} stage=${result.stateAfter.stage} stateStorage=${stateStorage} diagWriteSucceeded=${diagWriteSucceeded}`
  );

  return NextResponse.json({
    ok: true,
    from,
    input: result.input,
    intent: result.intent,
    extractedSlots: result.extractedSlots,
    stateBefore: result.stateBefore,
    stateAfter: result.stateAfter,
    nextStage: result.nextStage,
    assistantReply: result.assistantReply,
    ownerAlertPreview: result.ownerAlertPreview,
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
      readAfterService: diagReadAfterService,
      redisError: diagRedisError,
    },
  });
}
