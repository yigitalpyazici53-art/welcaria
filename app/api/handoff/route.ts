import { NextRequest, NextResponse } from "next/server";
import { getStateStorageMode, updateState } from "@/lib/conversationState";

// Manual human-handoff toggle. Lets the owner pause (paused=true) or resume
// (paused=false) the bot on a specific conversation. Protected by the same
// shared secret as the test/reset endpoint.
export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── 1. Validate secret ───────────────────────────────────────────────────
  const configuredSecret = process.env.TEST_WEBHOOK_SECRET;
  if (!configuredSecret) {
    return NextResponse.json(
      { ok: false, error: "TEST_WEBHOOK_SECRET not configured on server" },
      { status: 500 }
    );
  }

  let parsed: { secret?: string; from?: string; paused?: boolean };
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

  if (typeof parsed.paused !== "boolean") {
    return NextResponse.json({ ok: false, error: "Missing or invalid paused (boolean)" }, { status: 400 });
  }

  // ── 2. Set the pause flag ────────────────────────────────────────────────
  const stateStorage = getStateStorageMode();

  try {
    await updateState(from, { humanHandoff: parsed.paused });
    console.log(
      `[Handoff] set from=${from} humanHandoff=${parsed.paused} stateStorage=${stateStorage}`
    );
    return NextResponse.json({ ok: true, from, humanHandoff: parsed.paused, stateStorage });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[Handoff] update failed for from=${from}: ${error}`);
    return NextResponse.json({ ok: false, error, stateStorage }, { status: 500 });
  }
}
