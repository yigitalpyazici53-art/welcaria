import { NextRequest, NextResponse } from "next/server";
import { sendOutbound } from "@/lib/outboundSend";
import { isValidTwilioSignature } from "@/lib/twilioSignature";
import { sanitizeSmsText, maskPhone } from "@/lib/sanitize";
import { logToSheet } from "@/lib/googleSheets";

const MISSED_CALL_SMS = sanitizeSmsText(
  "Merhaba! Aramanızı aldık ama şu an müsait olamadık. Size kısa süre içinde dönüş yapacağız. Nasıl yardımcı olabiliriz?"
);

const TWIML_RESPONSE = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="tr-TR">Aramanız için teşekkürler. Sizi kısa sürede arayacağız.</Say>
  <Hangup/>
</Response>`;

export async function POST(req: NextRequest): Promise<NextResponse> {
  console.log("[Voice] Incoming call webhook");

  let from = "";
  let to = "";
  let callSid = "";
  let params = new URLSearchParams();

  try {
    const body = await req.text();
    params = new URLSearchParams(body);
    from    = params.get("From")    ?? "";
    to      = params.get("To")      ?? "";
    callSid = params.get("CallSid") ?? "";
  } catch (err) {
    console.error("[Voice ERROR] Failed to parse request body:", err instanceof Error ? err.message : "unknown");
    return new NextResponse(TWIML_RESPONSE, {
      status: 200,
      headers: { "Content-Type": "text/xml" },
    });
  }

  console.log(`[Voice] From: ${maskPhone(from)} | To: ${maskPhone(to)} | CallSid: ${callSid}`);

  // ── Validate Twilio signature — ALWAYS ───────────────────────────────────
  // Mirrors the incoming-sms route: an unsigned/forged POST must not be able to
  // trigger an outbound SMS to an attacker-chosen number.
  //
  // The URL override is TWILIO_VOICE_WEBHOOK_URL, not WEBHOOK_URL: Twilio signs
  // the exact configured URL, and WEBHOOK_URL points at the /incoming-sms path,
  // so validating this route against it would reject every genuine call. Unset,
  // the URL is rebuilt from the request's forwarded host.
  if (!isValidTwilioSignature(req, params, "[Voice]", process.env.TWILIO_VOICE_WEBHOOK_URL)) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  console.log(`[Voice] Sending missed-call SMS (${MISSED_CALL_SMS.length} chars): ${MISSED_CALL_SMS}`);

  // Plain-SMS send through the compliance gate: window rules don't apply to
  // SMS, but pacing, rate limits, and the audit trail do.
  try {
    const smsResult = await sendOutbound({
      to: from,
      body: MISSED_CALL_SMS,
      kind: "system",
      channel: "twilio",
      threadKey: from,
    });
    console.log(
      `[Voice] Missed-call SMS to ${maskPhone(from)} sent=${smsResult.sent} decision=${smsResult.decision}`
    );
  } catch (err) {
    console.error("[Voice] Failed to send missed-call SMS:", err);
  }

  logToSheet({
    createdAt: new Date().toISOString(),
    source: "missed_call",
    name: "",
    phone: from,
    service: "",
    preferredDate: "",
    preferredTime: "",
    location: "",
    urgency: "",
    leadScore: "",
    intent: "missed_call",
    notes: "",
    conversationSummary: "(missed call)",
    status: "new",
  }).catch((err) => {
    console.error("[Voice] Sheets log error:", err);
  });

  return new NextResponse(TWIML_RESPONSE, {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}
