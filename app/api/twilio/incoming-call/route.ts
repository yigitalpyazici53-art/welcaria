import { NextRequest, NextResponse } from "next/server";
import { sendSms } from "@/lib/twilio";
import { sanitizeSmsText } from "@/lib/sanitize";
import { logToSheet } from "@/lib/googleSheets";

// Pre-computed at module load — sanitizeSmsText enforces the 120-char cap.
const MISSED_CALL_SMS = sanitizeSmsText(
  "Hi, this is RapidFlow Plumbing. Sorry we missed your call. What can we help with?"
);

const TWIML_RESPONSE = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Sorry we missed your call. We just sent you a text.</Say>
  <Hangup/>
</Response>`;

export async function POST(req: NextRequest): Promise<NextResponse> {
  console.log("[Voice] Incoming call webhook");

  let from = "";
  let to = "";
  let callSid = "";

  try {
    const body = await req.text();
    const params = new URLSearchParams(body);
    from    = params.get("From")    ?? "";
    to      = params.get("To")      ?? "";
    callSid = params.get("CallSid") ?? "";
  } catch (err) {
    console.error("[Voice ERROR] Failed to parse request body:", err instanceof Error ? err.message : "unknown");
    // Return valid TwiML so Twilio does not keep retrying
    return new NextResponse(TWIML_RESPONSE, {
      status: 200,
      headers: { "Content-Type": "text/xml" },
    });
  }

  console.log(`[Voice] From: ${from} | To: ${to} | CallSid: ${callSid}`);
  console.log(`[Voice] Sending missed-call SMS (${MISSED_CALL_SMS.length} chars): ${MISSED_CALL_SMS}`);

  // Send missed-call text-back to the caller
  try {
    await sendSms(from, MISSED_CALL_SMS);
    console.log(`[Voice] Missed-call SMS sent to ${from}`);
  } catch (err) {
    console.error("[Voice] Failed to send missed-call SMS:", err);
  }

  // Log to Google Sheets — non-blocking; skipped automatically if env vars are absent
  logToSheet({
    timestamp: new Date().toISOString(),
    messageSid: callSid,
    from,
    to,
    customerMessage: "(missed call)",
    aiReply: MISSED_CALL_SMS,
    ownerNotified: false,
  }).catch((err) => {
    console.error("[Voice] Sheets log error:", err);
  });

  return new NextResponse(TWIML_RESPONSE, {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}
