import { NextRequest, NextResponse } from "next/server";
import twilio from "twilio";
import { generateSmsReply } from "@/lib/anthropic";
import { sendSms, notifyOwner } from "@/lib/twilio";
import { logToSheet } from "@/lib/googleSheets";
import { sanitizeSmsText } from "@/lib/sanitize";
import {
  getState,
  updateState,
  addToHistory,
  getNextStage,
} from "@/lib/conversationState";
import type { ConversationState } from "@/lib/conversationState";
import { getRedis } from "@/lib/redis";
import { extractSlots, detectConflict, calculateLeadScoreFromState } from "@/lib/slotExtractor";
import type { ExtractedSlots } from "@/lib/slotExtractor";
import { clinicConfig, formatBookingLinkMessage } from "@/lib/clinicConfig";

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

const teamRef =
  clinicConfig.name === "the clinic"
    ? "Our clinic team"
    : `The ${clinicConfig.name} team`;

const FALLBACK_CLAUDE = `Sorry, something went wrong. ${teamRef} will follow up shortly.`;
const FALLBACK_STATE  = `Thank you. We received your details. ${teamRef} will follow up shortly.`;

const recentSids = new Set<string>();
const MAX_SID_CACHE = 200;
const DEDUP_TTL_S = 300;

export async function POST(req: NextRequest): Promise<NextResponse> {
  console.log("[Webhook] start");

  {
    const missing: string[] = [];
    if (!process.env.ANTHROPIC_API_KEY)   missing.push("ANTHROPIC_API_KEY");
    if (!process.env.TWILIO_ACCOUNT_SID)  missing.push("TWILIO_ACCOUNT_SID");
    if (!process.env.TWILIO_AUTH_TOKEN)   missing.push("TWILIO_AUTH_TOKEN");
    if (!process.env.TWILIO_PHONE_NUMBER) missing.push("TWILIO_PHONE_NUMBER");
    if (!process.env.OWNER_PHONE)         missing.push("OWNER_PHONE");
    if (missing.length > 0) {
      console.error("[Webhook] MISSING ENV VARS:", missing.join(", "));
    } else {
      console.log("[Webhook] env vars present");
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
    console.error(
      "[Webhook ERROR] Failed to parse request body:",
      err instanceof Error ? err.message : "unknown"
    );
    return new NextResponse(EMPTY_TWIML, {
      status: 200,
      headers: { "Content-Type": "text/xml" },
    });
  }

  console.log(`[Webhook] parsed from=${from} to=${to} sid=${messageSid} body-len=${customerMessage.length}`);

  // ── 2. MessageSid deduplication ──────────────────────────────────────────
  if (messageSid) {
    const r = getRedis();
    let isDuplicate = false;

    if (r) {
      try {
        const result = await r.set(`dedup:${messageSid}`, "1", { nx: true, ex: DEDUP_TTL_S });
        isDuplicate = result === null;
      } catch (err) {
        console.error("[Webhook] Redis dedup check failed, falling back to memory:", err instanceof Error ? err.message : err);
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
      console.warn(`[Webhook] Duplicate MessageSid ${messageSid} — ignoring Twilio retry`);
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
        `[Webhook] sig-check url=${urlForValidation} using-configured-url=${!!configuredUrl} sig-present=${twilioSignature.length > 0}`
      );
      if (!configuredUrl) {
        console.warn(`[Webhook] WEBHOOK_URL not set — falling back to req.url=${req.url}`);
      }

      const paramsObj: Record<string, string> = {};
      for (const [key, value] of params.entries()) paramsObj[key] = value;

      const isValid = twilio.validateRequest(authToken, twilioSignature, urlForValidation, paramsObj);
      if (!isValid) {
        console.warn(
          `[Webhook] signature failed — url-used=${urlForValidation} req-url=${req.url} sig-len=${twilioSignature.length}`
        );
        return new NextResponse("Forbidden", { status: 403 });
      }
      console.log("[Webhook] signature ok");
    } catch (sigErr) {
      console.error(
        "[Webhook ERROR] Signature validation threw:",
        sigErr instanceof Error ? sigErr.message : sigErr
      );
      return new NextResponse("Forbidden", { status: 403 });
    }
  } else {
    console.log("[Webhook] signature disabled (non-production)");
  }

  if (!customerMessage.trim()) {
    console.log("[Webhook] Empty message body — ignoring");
    return new NextResponse(EMPTY_TWIML, {
      status: 200,
      headers: { "Content-Type": "text/xml" },
    });
  }

  // ── 4. Extract slots ─────────────────────────────────────────────────────
  let extracted: ExtractedSlots = {};
  try {
    extracted = extractSlots(customerMessage);
    console.log(`[Webhook] extracted slots: ${JSON.stringify(extracted)}`);
  } catch (err) {
    console.error(
      "[Webhook ERROR] Slot extraction failed:",
      err instanceof Error ? err.message : "unknown"
    );
  }

  // ── 5. Load state ────────────────────────────────────────────────────────
  let state = await getState(from);
  console.log(`[State] loaded stage=${state.stage} history-len=${state.history.length}`);

  const isFirstMessage = state.history.length === 0;

  let conflictQuestion: string | null = null;
  try {
    conflictQuestion = detectConflict(state, extracted);
    console.log(
      `[Webhook] conflict=${conflictQuestion ? "yes" : "none"} stage=${state.stage}`
    );
  } catch (err) {
    console.error(
      "[Webhook ERROR] Conflict detection failed:",
      err instanceof Error ? err.message : "unknown"
    );
  }

  // ── 6. Build AI reply ────────────────────────────────────────────────────
  let aiReply: string = FALLBACK_STATE;

  if (conflictQuestion) {
    aiReply = conflictQuestion;
    console.log("[Reply] using conflict clarification (no Claude call)");
  } else {
    try {
      state = await updateState(from, extracted as Partial<ConversationState>);
      const recalcScore = calculateLeadScoreFromState(state);
      state = await updateState(from, { leadScore: recalcScore, stage: getNextStage(state) });
      await addToHistory(from, "user", customerMessage);
    } catch (err) {
      console.error(
        "[Webhook ERROR] State update failed:",
        err instanceof Error ? err.message : "unknown"
      );
    }

    console.log("[Reply] generating");
    try {
      aiReply = await generateSmsReply(customerMessage, state);
      console.log(`[Reply] generated text=${aiReply.slice(0, 80)}${aiReply.length > 80 ? "..." : ""}`);
    } catch (err) {
      console.error(
        "[Webhook ERROR] Claude generation failed:",
        err instanceof Error ? err.message : "unknown"
      );
      aiReply = FALLBACK_CLAUDE;
      console.log("[Reply] using fallback (Claude failed)");
    }
  }

  await addToHistory(from, "assistant", aiReply);

  const finalReply = sanitizeSmsText(aiReply);
  console.log(`[SMS final] ${finalReply.length} chars: ${finalReply}`);

  // ── 7. Send reply to customer ────────────────────────────────────────────
  console.log(`[Twilio] sending customer SMS to=${from}`);
  try {
    await sendSms(from, aiReply);
    console.log(`[Twilio] customer SMS sent`);
  } catch (err) {
    console.error(
      "[Webhook ERROR] Failed to send reply SMS:",
      err instanceof Error ? err.message : "unknown"
    );
  }

  // ── 8. Notify owner — guard against spam on repeated messages ───────────
  state = await getState(from);

  const isFirstHighUrgency = state.urgency === "high" && !state.ownerAlertedHighUrgency;
  const isFirstComplete    = state.stage === "complete" && !state.ownerAlertedComplete;
  const isHotLead          = state.leadScore === "hot";
  const shouldNotify       = isFirstMessage || isFirstHighUrgency || isFirstComplete || isHotLead;

  if (shouldNotify) {
    console.log("[OwnerAlert] sending");
    try {
      await notifyOwner(from, state);
      console.log("[OwnerAlert] sent");

      const alertUpdates: Partial<ConversationState> = {};
      if (isFirstHighUrgency) alertUpdates.ownerAlertedHighUrgency = true;
      if (isFirstComplete)    alertUpdates.ownerAlertedComplete    = true;
      if (Object.keys(alertUpdates).length > 0) await updateState(from, alertUpdates);
    } catch (err) {
      console.error(
        "[Webhook ERROR] Failed to notify owner:",
        err instanceof Error ? err.message : "unknown"
      );
    }
  } else {
    console.log("[OwnerAlert] skipped");
  }

  // ── 9. Booking link handoff ──────────────────────────────────────────────
  if (clinicConfig.bookingUrl && state.stage === "complete" && !state.bookingLinkSent) {
    try {
      await sendSms(from, formatBookingLinkMessage(clinicConfig.bookingUrl));
      await updateState(from, { bookingLinkSent: true });
      console.log("[Webhook] booking link sent");
    } catch (err) {
      console.error("[Webhook] Booking link send failed:", err instanceof Error ? err.message : err);
    }
  }

  // ── 10. Log to Google Sheets — fire-and-forget ────────────────────────────
  logToSheet({
    createdAt: new Date().toISOString(),
    source: state.source ?? "sms",
    name: state.name ?? "",
    phone: from,
    service: state.service ?? "",
    preferredDate: state.preferredDate ?? "",
    preferredTime: state.preferredTime ?? "",
    location: state.location ?? "",
    urgency: state.urgency ?? "",
    leadScore: state.leadScore ?? "",
    intent: "",
    notes: state.notes ?? "",
    conversationSummary: customerMessage.slice(0, 100),
    status: state.stage === "complete" ? "complete" : "in_progress",
  }).catch((err) => {
    console.error(
      "[Webhook ERROR] Sheets log failed:",
      err instanceof Error ? err.message : "unknown"
    );
  });

  // ── 11. Return empty TwiML ───────────────────────────────────────────────
  console.log("[Webhook] done");
  return new NextResponse(EMPTY_TWIML, {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}
