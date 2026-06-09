import { NextRequest, NextResponse } from "next/server";
import { sendSms } from "@/lib/twilio";
import { sanitizeSmsText } from "@/lib/sanitize";
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

  try {
    const body = await req.text();
    const params = new URLSearchParams(body);
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

  console.log(`[Voice] From: ${from} | To: ${to} | CallSid: ${callSid}`);
  console.log(`[Voice] Sending missed-call SMS (${MISSED_CALL_SMS.length} chars): ${MISSED_CALL_SMS}`);

  try {
    await sendSms(from, MISSED_CALL_SMS);
    console.log(`[Voice] Missed-call SMS sent to ${from}`);
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
