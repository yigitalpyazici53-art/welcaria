import { NextRequest, NextResponse } from "next/server";
import twilio from "twilio";
import { sendSms, notifyOwner } from "@/lib/twilio";
import { logToSheet } from "@/lib/googleSheets";
import { updateState } from "@/lib/conversationState";
import { getRedis } from "@/lib/redis";
import { processInboundMessage } from "@/lib/inboundPipeline";
import { clinicConfig, formatBookingLinkMessage } from "@/lib/clinicConfig";

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

const recentSids = new Set<string>();
const MAX_SID_CACHE = 200;
const DEDUP_TTL_S = 300;

export async function POST(req: NextRequest): Promise<NextResponse> {
  console.log("[SMS] start");

  {
    const missing: string[] = [];
    if (!process.env.ANTHROPIC_API_KEY)   missing.push("ANTHROPIC_API_KEY");
    if (!process.env.TWILIO_ACCOUNT_SID)  missing.push("TWILIO_ACCOUNT_SID");
    if (!process.env.TWILIO_AUTH_TOKEN)   missing.push("TWILIO_AUTH_TOKEN");
    if (!process.env.TWILIO_PHONE_NUMBER) missing.push("TWILIO_PHONE_NUMBER");
    if (!process.env.OWNER_PHONE)         missing.push("OWNER_PHONE");
    if (missing.length > 0) {
      console.error("[SMS] MISSING ENV VARS:", missing.join(", "));
    } else {
      console.log("[SMS] env vars present");
    }
  }

  // ── 1. Parse Twilio form body ────────────────────────────────────────────
  let from = "";
  let to = "";
  let customerMessage = "";
  let messageSid = "";
  let params = new URLSearchParams();

  try {
    const body = await req.text();
    params = new URLSearchParams(body);
    from            = params.get("From")       ?? "";
    to              = params.get("To")         ?? "";
    customerMessage = params.get("Body")       ?? "";
    messageSid      = params.get("MessageSid") ?? "";
  } catch (err) {
    console.error("[SMS] Failed to parse request body:", err instanceof Error ? err.message : "unknown");
    return new NextResponse(EMPTY_TWIML, {
      status: 200,
      headers: { "Content-Type": "text/xml" },
    });
  }

  console.log(`[SMS] parsed from=${from} to=${to} sid=${messageSid} body-len=${customerMessage.length}`);

  // ── 2. MessageSid deduplication ──────────────────────────────────────────
  if (messageSid) {
    const r = getRedis();
    let isDuplicate = false;

    if (r) {
      try {
        const result = await r.set(`dedup:${messageSid}`, "1", { nx: true, ex: DEDUP_TTL_S });
        isDuplicate = result === null;
      } catch (err) {
        console.error("[SMS] Redis dedup check failed, falling back to memory:", err instanceof Error ? err.message : err);
        isDuplicate = recentSids.has(messageSid);
        if (!isDuplicate) {
          recentSids.add(messageSid);
          if (recentSids.size > MAX_SID_CACHE) {
            recentSids.delete(recentSids.values().next().value!);
          }
        }
      }
    } else {
      isDuplicate = recentSids.has(messageSid);
      if (!isDuplicate) {
        recentSids.add(messageSid);
        if (recentSids.size > MAX_SID_CACHE) {
          recentSids.delete(recentSids.values().next().value!);
        }
      }
    }

    if (isDuplicate) {
      console.warn(`[SMS] Duplicate MessageSid ${messageSid} — ignoring Twilio retry`);
      return new NextResponse(EMPTY_TWIML, {
        status: 200,
        headers: { "Content-Type": "text/xml" },
      });
    }
  }

  // ── 3. Validate Twilio signature in production ───────────────────────────
  if (process.env.NODE_ENV === "production") {
    try {
      const authToken        = process.env.TWILIO_AUTH_TOKEN ?? "";
      const twilioSignature  = req.headers.get("x-twilio-signature") ?? "";
      const configuredUrl    = process.env.WEBHOOK_URL;
      const urlForValidation = configuredUrl ?? req.url;

      console.log(
        `[SMS] sig-check url=${urlForValidation} using-configured-url=${!!configuredUrl} sig-present=${twilioSignature.length > 0}`
      );
      if (!configuredUrl) {
        console.warn(`[SMS] WEBHOOK_URL not set — falling back to req.url=${req.url}`);
      }

      const paramsObj: Record<string, string> = {};
      for (const [key, value] of params.entries()) paramsObj[key] = value;

      const isValid = twilio.validateRequest(authToken, twilioSignature, urlForValidation, paramsObj);
      if (!isValid) {
        console.warn(
          `[SMS] signature failed — url-used=${urlForValidation} req-url=${req.url} sig-len=${twilioSignature.length}`
        );
        return new NextResponse("Forbidden", { status: 403 });
      }
      console.log("[SMS] signature ok");
    } catch (sigErr) {
      console.error("[SMS] Signature validation threw:", sigErr instanceof Error ? sigErr.message : sigErr);
      return new NextResponse("Forbidden", { status: 403 });
    }
  } else {
    console.log("[SMS] signature disabled (non-production)");
  }

  if (!customerMessage.trim()) {
    console.log("[SMS] Empty message body — ignoring");
    return new NextResponse(EMPTY_TWIML, {
      status: 200,
      headers: { "Content-Type": "text/xml" },
    });
  }

  // ── 4. Run shared inbound pipeline ──────────────────────────────────────
  let result: Awaited<ReturnType<typeof processInboundMessage>>;
  try {
    result = await processInboundMessage({ from, body: customerMessage, source: "sms" });
  } catch (err) {
    console.error("[SMS] Pipeline error:", err instanceof Error ? err.message : err);
    return new NextResponse(EMPTY_TWIML, {
      status: 200,
      headers: { "Content-Type": "text/xml" },
    });
  }

  console.log(
    `[SMS] pipeline done stage=${result.stateAfter.stage} leadScore=${result.stateAfter.leadScore ?? "none"}`
  );

  // ── 5. Send reply to customer ────────────────────────────────────────────
  try {
    await sendSms(from, result.assistantReply);
    console.log(`[SMS] reply sent to=${from}`);
  } catch (err) {
    console.error("[SMS] Failed to send reply:", err instanceof Error ? err.message : err);
  }

  // ── 6. Booking link handoff ──────────────────────────────────────────────
  if (clinicConfig.bookingUrl && result.stateAfter.stage === "complete" && !result.stateAfter.bookingLinkSent) {
    try {
      await sendSms(from, formatBookingLinkMessage(clinicConfig.bookingUrl, result.stateAfter.detectedLanguage));
      await updateState(from, { bookingLinkSent: true });
      console.log("[SMS] booking link sent");
    } catch (err) {
      console.error("[SMS] Booking link send failed:", err instanceof Error ? err.message : err);
    }
  }

  // ── 7. Owner notification ────────────────────────────────────────────────
  if (result.shouldNotifyOwner) {
    try {
      await notifyOwner(from, result.stateAfter);
      console.log("[SMS] owner notification sent");

      const flagUpdates: Record<string, boolean> = {};
      if (result.stateAfter.urgency === "high" && !result.stateAfter.ownerAlertedHighUrgency)
        flagUpdates.ownerAlertedHighUrgency = true;
      if (result.stateAfter.stage === "complete" && !result.stateAfter.ownerAlertedComplete)
        flagUpdates.ownerAlertedComplete = true;
      if (Object.keys(flagUpdates).length > 0) await updateState(from, flagUpdates);
    } catch (err) {
      console.error("[SMS] Owner notify failed:", err instanceof Error ? err.message : err);
    }
  }

  // ── 8. Google Sheets logging — only on first completion ──────────────────
  const sheetsStage = result.stateAfter.stage;
  const sheetLoggedComplete = result.stateAfter.sheetLoggedComplete ?? false;

  console.log(
    `[SMS] sheets decision stage=${sheetsStage} sheetLoggedComplete=${sheetLoggedComplete}`
  );

  if (sheetsStage !== "complete") {
    console.log("[SMS] sheets skipped reason=not_complete");
  } else if (sheetLoggedComplete) {
    console.log("[SMS] sheets skipped reason=already_logged");
  } else {
    console.log("[SMS] sheets log queued");
    try {
      await logToSheet({
        createdAt: new Date().toISOString(),
        source: result.stateAfter.source ?? "sms",
        name: result.stateAfter.name ?? "",
        phone: result.stateAfter.phone ?? from,
        service: result.stateAfter.service ?? "",
        preferredDate: result.stateAfter.preferredDate ?? "",
        preferredTime: result.stateAfter.preferredTime ?? "",
        location: result.stateAfter.location ?? "",
        urgency: result.stateAfter.urgency ?? "",
        leadScore: result.stateAfter.leadScore ?? "",
        intent: result.intent,
        notes: result.stateAfter.notes ?? "",
        conversationSummary: result.input.slice(0, 100),
        status: "complete",
      });
      console.log("[SMS] sheets log success");
      await updateState(from, { sheetLoggedComplete: true });
    } catch (err) {
      console.error("[SMS] Sheets log failed:", err instanceof Error ? err.message : err);
    }
  }

  // ── 9. Return empty TwiML ────────────────────────────────────────────────
  console.log("[SMS] done");
  return new NextResponse(EMPTY_TWIML, {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}
