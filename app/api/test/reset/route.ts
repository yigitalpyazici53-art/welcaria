import { NextRequest, NextResponse } from "next/server";
import { getStateStorageMode, deleteConversationState } from "@/lib/conversationState";

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── 1. Validate secret ───────────────────────────────────────────────────
  const configuredSecret = process.env.TEST_WEBHOOK_SECRET;
  if (!configuredSecret) {
    return NextResponse.json(
      { ok: false, error: "TEST_WEBHOOK_SECRET not configured on server" },
      { status: 500 }
    );
  }

  let parsed: { secret?: string; from?: string };
  try {
    parsed = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  if (!parsed.secret || parsed.secret !== configuredSecret) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const from = (parsed.from ?? "").trim();
  if (!from) {
    return NextResponse.json({ ok: false, error: "Missing from" }, { status: 400 });
  }

  // ── 2. Delete state for both key variants ────────────────────────────────
  const stateStorage = getStateStorageMode();

  try {
    const deletedKeys = await deleteConversationState(from);
    console.log(
      `[TestReset] Reset from=${from} keys=${deletedKeys.join(",")} stateStorage=${stateStorage}`
    );
    return NextResponse.json({ ok: true, from, deletedKeys, stateStorage });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[TestReset] Redis delete failed for from=${from}: ${error}`);
    return NextResponse.json({ ok: false, error, stateStorage }, { status: 500 });
  }
}
