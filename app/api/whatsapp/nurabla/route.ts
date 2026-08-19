/**
 * Nurabla Karadeniz Restaurant — isolated Twilio WhatsApp webhook.
 *
 * This endpoint is completely independent from the clinic / laser conversation
 * flow. It receives Twilio WhatsApp webhook POSTs, reads the "Body" form field,
 * and replies with Nurabla's location and/or menu information as TwiML.
 *
 * It deliberately does NOT touch conversation state, the inbound pipeline, or
 * any clinic module.
 */

import { NextRequest, NextResponse } from "next/server";
import twilio from "twilio";
import { buildNurablaReply, NURABLA_FALLBACK } from "@/lib/businesses/nurabla";
import { isValidTwilioSignature } from "@/lib/twilioSignature";

const { MessagingResponse } = twilio.twiml;

/** Build a TwiML XML response containing a single WhatsApp message. */
function twimlResponse(message: string): NextResponse {
  const twiml = new MessagingResponse();
  twiml.message(message);
  return new NextResponse(twiml.toString(), {
    status: 200,
    headers: { "Content-Type": "text/xml; charset=utf-8" },
  });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    // ── Parse the Twilio form body and read the incoming message ────────────
    let body = "";
    let params = new URLSearchParams();
    try {
      const raw = await req.text();
      params = new URLSearchParams(raw);
      body = params.get("Body") ?? "";
    } catch (parseErr) {
      console.error(
        "[NURABLA] Failed to parse request body:",
        parseErr instanceof Error ? parseErr.message : "unknown"
      );
      return twimlResponse(NURABLA_FALLBACK);
    }

    // ── Validate the Twilio signature ───────────────────────────────────────
    // Same check as the clinic Twilio routes. This endpoint only returns static
    // TwiML today, so an unsigned POST leaks nothing — but it was the one webhook
    // anyone on the internet could invoke, and "this handler happens to be
    // harmless" is a property of today's code, not a security boundary. Verifying
    // here means a future change that touches state or sends a message inherits
    // authentication instead of silently lacking it.
    if (!isValidTwilioSignature(req, params, "[NURABLA]", process.env.NURABLA_WEBHOOK_URL)) {
      return new NextResponse("Forbidden", { status: 403 });
    }

    const reply = buildNurablaReply(body);
    console.log(`[NURABLA] body-len=${body.length} reply-len=${reply.length}`);
    return twimlResponse(reply);
  } catch (err) {
    console.error(
      "[NURABLA] Unexpected error:",
      err instanceof Error ? err.message : err
    );
    return twimlResponse(NURABLA_FALLBACK);
  }
}
