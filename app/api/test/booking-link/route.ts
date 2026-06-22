// TEMPORARY — remove after production verification of booking link handoff.
// Protected by TEST_WEBHOOK_SECRET. Never sends real SMS or WhatsApp messages.
import { NextRequest, NextResponse } from "next/server";
import {
  _setStateForTest,
  getState,
  updateState,
} from "@/lib/conversationState";
import type { ConversationState } from "@/lib/conversationState";

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── 1. Validate secret ───────────────────────────────────────────────────
  const configuredSecret = process.env.TEST_WEBHOOK_SECRET;
  if (!configuredSecret) {
    return NextResponse.json(
      { ok: false, error: "TEST_WEBHOOK_SECRET not configured" },
      { status: 500 }
    );
  }

  let parsed: { secret?: string; from?: string; state?: Partial<ConversationState> };
  try {
    parsed = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  if (!parsed.secret || parsed.secret !== configuredSecret) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  // ── 2. Require CLINIC_BOOKING_URL ────────────────────────────────────────
  const bookingUrl = process.env.CLINIC_BOOKING_URL;
  if (!bookingUrl) {
    return NextResponse.json(
      { ok: false, error: "CLINIC_BOOKING_URL not set — booking link handoff is disabled" },
      { status: 400 }
    );
  }

  const from = (parsed.from ?? "").trim();
  if (!from) {
    return NextResponse.json({ ok: false, error: "Missing 'from'" }, { status: 400 });
  }

  // ── 3. Merge request.state into existing Redis state ─────────────────────
  // Read first so partial updates don't clobber fields already in Redis.
  const existing = await getState(from);

  // Preserve existing bookingLinkSent unless request.state explicitly sets it.
  const bookingLinkSentOverride =
    parsed.state && "bookingLinkSent" in parsed.state
      ? parsed.state.bookingLinkSent
      : existing.bookingLinkSent;

  const seedState = {
    ...existing,
    lastUpdated: Date.now(),
    ...(parsed.state ?? {}),
    bookingLinkSent: bookingLinkSentOverride,
  } as ConversationState;

  await _setStateForTest(from, seedState);

  // Read back to confirm what is in store (Redis round-trip)
  const state = await getState(from);

  // ── 4. Simulate booking link handoff guard — no real SMS sent ────────────
  let wouldSendBookingLink = false;
  let dryRunBookingMessage: string | null = null;

  if (state.stage === "complete" && !state.bookingLinkSent) {
    wouldSendBookingLink = true;
    dryRunBookingMessage = `Complete your appointment request here: ${bookingUrl}`;
    await updateState(from, { bookingLinkSent: true });
    console.log(`[TestBookingLink] dry-run booking message built for from=${from}`);
  } else {
    console.log(
      `[TestBookingLink] guard skipped stage=${state.stage} bookingLinkSent=${state.bookingLinkSent ?? false}`
    );
  }

  // ── 5. Read state after potential update ─────────────────────────────────
  const stateAfter = await getState(from);

  return NextResponse.json({
    ok: true,
    wouldSendBookingLink,
    dryRunBookingMessage,
    stateAfter,
  });
}
