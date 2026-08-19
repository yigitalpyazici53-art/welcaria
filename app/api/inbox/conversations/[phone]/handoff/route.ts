import { NextResponse } from "next/server";
import { getStateStorageMode, updateState } from "@/lib/conversationState";
import { maskPhone } from "@/lib/sanitize";
import { requireInboxMutation } from "@/lib/inboxGuard";

// Pause/resume the bot on one conversation. Authenticated by this handler itself
// (session + Origin), with middleware.ts as an outer perimeter — and this is the
// ONLY way to set humanHandoff.
//
// A second, unauthenticated-by-session endpoint (POST /api/handoff, gated only by
// the shared TEST_WEBHOOK_SECRET and live in production) used to write the same
// field. It was removed: anyone holding that test secret could silence the bot on
// any patient thread, and the secret circulates in dev scripts and CI where it is
// treated as low-sensitivity. Do not reintroduce a secret-gated variant.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ phone: string }> }
): Promise<NextResponse> {
  const blocked = await requireInboxMutation(req);
  if (blocked) return blocked;

  const { phone: raw } = await params;
  const phone = decodeURIComponent(raw ?? "").trim();
  if (!phone) {
    return NextResponse.json({ ok: false, error: "Missing phone" }, { status: 400 });
  }

  let parsed: { paused?: boolean };
  try {
    parsed = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof parsed.paused !== "boolean") {
    return NextResponse.json(
      { ok: false, error: "Missing or invalid paused (boolean)" },
      { status: 400 }
    );
  }

  const stateStorage = getStateStorageMode();

  try {
    await updateState(phone, { humanHandoff: parsed.paused });
    console.log(
      `[Inbox] handoff set phone=${maskPhone(phone)} humanHandoff=${parsed.paused} stateStorage=${stateStorage}`
    );
    return NextResponse.json({ ok: true, phone, humanHandoff: parsed.paused, stateStorage });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[Inbox] handoff update failed for phone=${maskPhone(phone)}: ${error}`);
    return NextResponse.json({ ok: false, error, stateStorage }, { status: 500 });
  }
}
