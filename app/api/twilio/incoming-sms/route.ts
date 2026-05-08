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
import { getRedis } from "@/lib/redis";
import { extractSlots, detectConflict } from "@/lib/slotExtractor";
import type { ExtractedSlots } from "@/lib/slotExtractor";

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

// Safe fallback replies — never expose errors to customers
const FALLBACK_CLAUDE = "Sorry, we had a system issue. The owner will follow up shortly.";
const FALLBACK_STATE  = "Got it. What address should we send the plumber to?";

// Hardcoded safe reply for gas smell — bypasses Claude entirely (life safety)
const GAS_REPLY = "Leave the area and call 911 if you smell gas. The owner is being notified now.";

// In-memory fallback for MessageSid dedup when Redis is unavailable
const recentSids = new Set<string>();
const MAX_SID_CACHE = 200;

const DEDUP_TTL_S = 300; // Twilio retries within seconds; 5-min window is more than enough

export async function POST(req: NextRequest): Promise<NextResponse> {
  console.log("[Webhook] Incoming Twilio webhook");

  // ── 1. Parse Twilio form body ────────────────────────────────────────────
  let from = "";
  let to = "";
  let customerMessage = "";
  let messageSid = "";

  try {
    const body = await req.text();
    const params = new URLSearchParams(body);

    from = params.get("From") ?? "";
    to   = params.get("To")   ?? "";
    customerMessage = params.get("Body")       ?? "";
    messageSid      = params.get("MessageSid") ?? "";

    console.log(`[Webhook] From: ${from} | To: ${to} | SID: ${messageSid}`);
    console.log(`[Webhook] Message: ${customerMessage}`);

    // ── 2. MessageSid deduplication ──────────────────────────────────────
    // Twilio retries if we're slow; don't process the same message twice.
    if (messageSid) {
      const r = getRedis();
      let isDuplicate = false;

      if (r) {
        try {
          // SET NX EX — returns "OK" if key was new, null if already existed
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

    // ── 3. Validate Twilio signature in production ───────────────────────
    if (process.env.NODE_ENV === "production") {
      const authToken        = process.env.TWILIO_AUTH_TOKEN ?? "";
      const twilioSignature  = req.headers.get("x-twilio-signature") ?? "";
      const url              = process.env.WEBHOOK_URL ?? req.url;

      const paramsObj: Record<string, string> = {};
      for (const [key, value] of params.entries()) paramsObj[key] = value;

      const isValid = twilio.validateRequest(authToken, twilioSignature, url, paramsObj);
      if (!isValid) {
        console.warn("[Webhook] Invalid Twilio signature — rejecting request");
        return new NextResponse("Forbidden", { status: 403 });
      }
    }
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

  if (!customerMessage.trim()) {
    console.log("[Webhook] Empty message body — ignoring");
    return new NextResponse(EMPTY_TWIML, {
      status: 200,
      headers: { "Content-Type": "text/xml" },
    });
  }

  // ── 4. Extract slots (always — needed for gas smell check) ───────────────
  let extracted: ExtractedSlots = {};
  try {
    extracted = extractSlots(customerMessage);
    console.log(`[Webhook] Extracted: ${JSON.stringify(extracted)}`);
  } catch (err) {
    console.error(
      "[Webhook ERROR] Slot extraction failed:",
      err instanceof Error ? err.message : "unknown"
    );
  }

  // ── 5. Gas smell — life-safety bypass (hardcoded safe reply, no Claude) ──
  if (extracted.issue_type === "gas_smell") {
    console.log("[Webhook] Gas smell detected — using safe reply, bypassing Claude");

    try {
      await updateState(from, { issue_type: "gas_smell", urgency: "high" });
    } catch (err) {
      console.error(
        "[Webhook ERROR] State update failed (gas smell):",
        err instanceof Error ? err.message : "unknown"
      );
    }

    await addToHistory(from, "user", customerMessage);
    await addToHistory(from, "assistant", GAS_REPLY);

    const gasClean = sanitizeSmsText(GAS_REPLY);
    console.log(`[SMS final] ${gasClean.length} chars: ${gasClean}`);

    try {
      await sendSms(from, GAS_REPLY);
    } catch (err) {
      console.error(
        "[Webhook ERROR] Failed to send gas smell reply:",
        err instanceof Error ? err.message : "unknown"
      );
    }

    try {
      const gasState = await getState(from);
      await notifyOwner(from, gasState);
    } catch (err) {
      console.error(
        "[Webhook ERROR] Failed to notify owner (gas smell):",
        err instanceof Error ? err.message : "unknown"
      );
    }

    return new NextResponse(EMPTY_TWIML, {
      status: 200,
      headers: { "Content-Type": "text/xml" },
    });
  }

  // ── 6. Load state — check first-message BEFORE adding to history ─────────
  let state = await getState(from);

  // With Redis-backed history, history.length === 0 reliably means a brand-new conversation
  const isFirstMessage = state.history.length === 0;

  let conflictQuestion: string | null = null;

  try {
    conflictQuestion = detectConflict(state, extracted);
    console.log(
      `[Webhook] Stage: ${state.stage} | Conflict: ${conflictQuestion ?? "none"}`
    );
  } catch (err) {
    console.error(
      "[Webhook ERROR] Conflict detection failed:",
      err instanceof Error ? err.message : "unknown"
    );
  }

  // ── 7. Build AI reply ────────────────────────────────────────────────────
  let aiReply: string = FALLBACK_STATE;

  if (conflictQuestion) {
    aiReply = conflictQuestion;
    console.log("[Webhook] Conflict detected — using clarification reply");
  } else {
    // Merge extracted slots and recalculate stage
    try {
      state = await updateState(from, extracted);
      state = await updateState(from, { stage: getNextStage(state) });
      await addToHistory(from, "user", customerMessage);
    } catch (err) {
      console.error(
        "[Webhook ERROR] State update failed:",
        err instanceof Error ? err.message : "unknown"
      );
    }

    // Generate Claude reply
    try {
      aiReply = await generateSmsReply(customerMessage, state);
    } catch (err) {
      console.error(
        "[Webhook ERROR] Claude generation failed:",
        err instanceof Error ? err.message : "unknown"
      );
      aiReply = FALLBACK_CLAUDE;
    }
  }

  await addToHistory(from, "assistant", aiReply);

  const finalReply = sanitizeSmsText(aiReply);
  console.log(`[SMS final] ${finalReply.length} chars: ${finalReply}`);

  // ── 8. Send reply to customer ────────────────────────────────────────────
  try {
    await sendSms(from, aiReply);
  } catch (err) {
    console.error(
      "[Webhook ERROR] Failed to send reply SMS:",
      err instanceof Error ? err.message : "unknown"
    );
  }

  // ── 9. Notify owner — guard against spam on repeated messages ───────────
  state = await getState(from);

  const isFirstHighUrgency = state.urgency === "high" && !state.ownerAlertedHighUrgency;
  const isFirstComplete    = state.stage === "complete" && !state.ownerAlertedComplete;
  const shouldNotify       = isFirstMessage || isFirstHighUrgency || isFirstComplete;

  if (shouldNotify) {
    try {
      await notifyOwner(from, state);

      const alertUpdates: Partial<typeof state> = {};
      if (isFirstHighUrgency) alertUpdates.ownerAlertedHighUrgency = true;
      if (isFirstComplete)    alertUpdates.ownerAlertedComplete    = true;
      if (Object.keys(alertUpdates).length > 0) await updateState(from, alertUpdates);
    } catch (err) {
      console.error(
        "[Webhook ERROR] Failed to notify owner:",
        err instanceof Error ? err.message : "unknown"
      );
    }
  }

  // ── 10. Log to Google Sheets — fire-and-forget, never block the response ──
  logToSheet({
    timestamp: new Date().toISOString(),
    messageSid,
    from,
    to,
    customerMessage,
    aiReply: finalReply,
    ownerNotified: shouldNotify,
  }).catch((err) => {
    console.error(
      "[Webhook ERROR] Sheets log failed:",
      err instanceof Error ? err.message : "unknown"
    );
  });

  // ── 11. Return empty TwiML — reply already sent programmatically ─────────
  return new NextResponse(EMPTY_TWIML, {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}
