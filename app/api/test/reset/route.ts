import { NextRequest, NextResponse } from "next/server";
import { getStateStorageMode, deleteConversationState } from "@/lib/conversationState";
import { secretsMatch } from "@/lib/secretCompare";
import { maskPhone } from "@/lib/sanitize";
import { isLocalDevelopment } from "@/lib/devGuard";

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── 0. Local development only (allow-list, fails closed) ──────────────────
  // Excluding only "production" left this live on preview deployments, which
  // normally share production's Redis — i.e. remote deletion of real state.
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

  let parsed: { secret?: string; from?: string };
  try {
    parsed = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  if (!secretsMatch(parsed.secret, configuredSecret)) {
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
      `[TestReset] Reset from=${maskPhone(from)} keyCount=${deletedKeys.length} stateStorage=${stateStorage}`
    );
    return NextResponse.json({ ok: true, from, deletedKeys, stateStorage });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[TestReset] Redis delete failed for from=${maskPhone(from)}: ${error}`);
    return NextResponse.json({ ok: false, error, stateStorage }, { status: 500 });
  }
}
