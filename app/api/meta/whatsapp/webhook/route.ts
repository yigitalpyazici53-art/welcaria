import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  processInboundMessage,
  recordConsentDisclosureResult,
} from "@/lib/inboundPipeline";
import { sendOutbound } from "@/lib/outboundSend";
import { handleAccountLevelWebhook } from "@/lib/compliance";
import { notifyOwner } from "@/lib/twilio";
import { logToSheet } from "@/lib/googleSheets";
import { updateState } from "@/lib/conversationState";
import { handleBookingHandoff } from "@/lib/bookingHandoff";
import { isDuplicateMessage } from "@/lib/messageDedup";
import { maskPhone } from "@/lib/sanitize";

// Types for the Meta WhatsApp Cloud API webhook payload
interface MetaWebhookPayload {
  object: string;
  entry?: Array<{
    id: string;
    changes?: Array<{
      value?: MetaWebhookValue;
      field?: string;
    }>;
  }>;
}

interface MetaWebhookValue {
  messaging_product?: string;
  metadata?: {
    display_phone_number: string;
    phone_number_id: string;
  };
  contacts?: Array<{
    profile?: { name?: string };
    wa_id?: string;
  }>;
  messages?: Array<{
    from: string;
    id: string;
    timestamp: string;
    type: string;
    text?: { body: string };
  }>;
  statuses?: Array<{
    id: string;
    status: string;
    timestamp: string;
    recipient_id: string;
  }>;
}

// Meta signs the raw body as "sha256=<64 lowercase hex chars>".
//
// The header is validated against that shape BEFORE any byte comparison. The
// previous version compared string lengths and then handed the values to
// timingSafeEqual, which measures BUFFER length: a header of the right character
// count containing a multi-byte character (e.g. a "ü") produced buffers of
// different byte lengths, timingSafeEqual threw a RangeError, and nothing caught
// it — so a malformed signature crashed the route with a 500 instead of being
// rejected with a 403. A rejection path that can itself fail is not a rejection
// path. Shape check first, byte-length check second, whole thing wrapped.
function signatureMatches(
  header: string | null,
  rawBody: string,
  appSecret: string
): boolean {
  if (!header || !/^sha256=[0-9a-f]{64}$/.test(header)) return false;

  try {
    const expected =
      "sha256=" + crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
    const provided = Buffer.from(header, "utf8");
    const expectedBuf = Buffer.from(expected, "utf8");
    if (provided.length !== expectedBuf.length) return false;
    return crypto.timingSafeEqual(provided, expectedBuf);
  } catch (err) {
    console.error(
      "[WhatsApp Webhook] signature comparison threw (rejecting):",
      err instanceof Error ? err.message : err
    );
    return false;
  }
}

// ── GET — Meta webhook verification ──────────────────────────────────────────
export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("hub.mode");
  const verifyToken = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  const configuredToken = process.env.META_WEBHOOK_VERIFY_TOKEN;

  if (!configuredToken) {
    console.error("[WhatsApp Webhook] META_WEBHOOK_VERIFY_TOKEN not configured");
    return new NextResponse("Forbidden", { status: 403 });
  }

  if (mode === "subscribe" && verifyToken === configuredToken) {
    console.log("[WhatsApp Webhook] Verification successful");
    return new NextResponse(challenge ?? "", { status: 200 });
  }

  console.warn("[WhatsApp Webhook] Verification failed — token mismatch or wrong mode");
  return new NextResponse("Forbidden", { status: 403 });
}

// ── POST — Incoming WhatsApp messages ────────────────────────────────────────
export async function POST(req: NextRequest): Promise<NextResponse> {
  const appSecret = process.env.META_WHATSAPP_APP_SECRET;
  if (!appSecret) {
    console.error("[WhatsApp Webhook] META_WHATSAPP_APP_SECRET not configured");
    return new NextResponse("Forbidden", { status: 403 });
  }

  const rawBody = await req.text();

  if (!signatureMatches(req.headers.get("x-hub-signature-256"), rawBody, appSecret)) {
    console.warn("[WhatsApp Webhook] Signature verification failed");
    return new NextResponse("Forbidden", { status: 403 });
  }

  let payload: MetaWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as MetaWebhookPayload;
  } catch {
    console.error("[WhatsApp Webhook] Failed to parse JSON body");
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  // Validate this is a WhatsApp Business Account webhook
  if (payload.object !== "whatsapp_business_account") {
    console.warn("[WhatsApp Webhook] Unexpected object type:", payload.object);
    return NextResponse.json({ ok: true, processed: false, reason: "unsupported_payload" });
  }

  let messagesProcessed = 0;
  let messagesSkipped = 0;
  let messagesFailed = 0;
  let messagesDuplicate = 0;

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;

      // Account-level changes (quality rating, messaging limits, restrictions)
      // feed the compliance circuit breaker before any message handling.
      if (change.field && change.field !== "messages") {
        try {
          await handleAccountLevelWebhook(
            change.field,
            (value ?? {}) as Record<string, unknown>
          );
        } catch (err) {
          console.error(
            "[WhatsApp Webhook] account-level webhook handling failed:",
            err instanceof Error ? err.message : err
          );
        }
        continue;
      }

      if (!value) continue;

      // Status updates (delivery/read receipts) — skip this change, continue batch
      if (value.statuses && value.statuses.length > 0) {
        console.log("[WhatsApp Webhook] Status update in change — skipping");
        continue;
      }

      const messages = value.messages;
      if (!messages || messages.length === 0) continue;

      for (const message of messages) {
        // ── Per-message deduplication — BEFORE any side effect ──────────────
        // Meta retries the whole webhook when we are slow or return non-2xx, and
        // one payload can carry several messages, so the gate is claimed per
        // message.id rather than per delivery. It sits at the top of the loop:
        // nothing below it — state writes, LLM call, outbound sends, Sheets —
        // can run for an id that was already claimed. A duplicate is dropped
        // silently and the handler still answers 200 at the end, which is what
        // makes Meta stop retrying.
        if (message.id && (await isDuplicateMessage(message.id, "[WhatsApp Webhook]"))) {
          console.warn(
            `[WhatsApp Webhook] Duplicate message id ${message.id} — ignoring Meta retry`
          );
          messagesDuplicate++;
          continue;
        }

        if (message.type !== "text") {
          console.log(`[WhatsApp Webhook] Unsupported message type: ${message.type} — skipping`);
          messagesSkipped++;
          continue;
        }

        const from = message.from;
        const body = message.text?.body;
        const messageId = message.id;

        if (!from || !body) {
          console.warn("[WhatsApp Webhook] Missing from or body — skipping");
          messagesSkipped++;
          continue;
        }

        const profileName = value.contacts?.[0]?.profile?.name;
        console.log(
          `[WhatsApp Webhook] from=${maskPhone(from)} msgId=${messageId} bodyLen=${body.length} name=${profileName ? "(present)" : "(none)"}`
        );

        const tenantId = value.metadata?.phone_number_id;

        try {
          const result = await processInboundMessage({
            from,
            body,
            source: "whatsapp",
            profileName,
            tenantId,
          });

          console.log(
            `[WhatsApp Webhook] pipeline done stage=${result.stateAfter.stage} leadScore=${result.stateAfter.leadScore ?? "none"}`
          );

          // KVKK welcome + consent disclosure — sent while the thread has no
          // CONFIRMED disclosure (first inbound, or a retry after a blocked/failed
          // attempt). kind "system" so it is not counted against the bot's
          // per-inbound reply budget; the 24h window, inbound-only guarantee, and
          // circuit breaker still apply. The consent record is stamped from the send
          // VERDICT only (audit finding Y-3) — a blocked or failed send leaves the
          // thread pending, and the next inbound turn retries the disclosure instead
          // of claiming consent that the patient never received.
          if (result.consentMessage) {
            const consentResult = await sendOutbound({
              to: from,
              body: result.consentMessage,
              kind: "system",
              channel: "meta",
              tenantId,
              threadKey: from,
            });
            // Fail-closed on partial delivery. The Cloud API carries the body
            // verbatim, so bodyIntact is true here for every successful send; the
            // check is kept so this route cannot silently record consent if the
            // channel ever starts rewriting bodies.
            const disclosureDelivered = consentResult.sent && consentResult.bodyIntact;
            await recordConsentDisclosureResult(from, disclosureDelivered);
            if (consentResult.sent && !consentResult.bodyIntact) {
              console.error(
                "[WhatsApp Webhook] consent disclosure was ALTERED in transit — consent NOT recorded, thread stays gated"
              );
            }
            console.log(
              `[WhatsApp Webhook] consent disclosure sent=${consentResult.sent} intact=${consentResult.bodyIntact} recorded=${disclosureDelivered} decision=${consentResult.decision}`
            );
          }

          // Human handoff pause: when the thread is flagged, the bot stops
          // auto-replying (bot reply AND booking link are both skipped) so a human
          // owner can take over. The inbound message was already recorded and the
          // conversation state advanced inside processInboundMessage above, so the
          // 24h-window gate and state logging stay accurate regardless.
          const paused = result.stateAfter.humanHandoff === true;

          if (result.awaitingConsent) {
            // Disclosure turn: the pipeline produced no reply and did not touch the
            // patient's text. Nothing else may be sent until the disclosure lands.
            console.log(
              "[WhatsApp Webhook] awaiting consent disclosure — bot reply and booking handoff skipped"
            );
          } else if (paused) {
            console.log("[WhatsApp Webhook] humanHandoff active — bot reply skipped");
          } else {
            // Send the assistant reply back to the customer — through the
            // mandatory compliance gate (24h window, inbound-only, rate limits,
            // circuit breaker). A blocked send is logged by the gate itself.
            const replyResult = await sendOutbound({
              to: from,
              body: result.assistantReply,
              kind: "bot_reply",
              channel: "meta",
              tenantId,
              threadKey: from,
            });
            console.log(
              `[WhatsApp Webhook] reply sent=${replyResult.sent} decision=${replyResult.decision}`
            );

            // ── Booking link handoff ──────────────────────────────────────────
            // Shared decision: runtime booking-URL read, safe diagnostic log, and the
            // flag-only-after-successful-send ordering — identical to the Twilio route.
            // The injected sender throws when the gate blocks or the transport fails,
            // so bookingLinkSent stays false and a later turn retries.
            await handleBookingHandoff({
              from,
              stateAfter: result.stateAfter,
              channel: "meta",
              send: async (to, sendBody) => {
                const r = await sendOutbound({
                  to,
                  body: sendBody,
                  kind: "booking_handoff",
                  channel: "meta",
                  tenantId,
                  threadKey: from,
                });
                if (!r.sent) throw new Error(`send blocked or failed: ${r.decision}`);
              },
            });
          }

          // ── Owner notification ────────────────────────────────────────────
          if (result.shouldNotifyOwner) {
            try {
              await notifyOwner(from, result.stateAfter);
              console.log("[WhatsApp Webhook] owner notification sent");

              const flagUpdates: Record<string, boolean> = {};
              if (result.stateAfter.urgency === "high" && !result.stateAfter.ownerAlertedHighUrgency)
                flagUpdates.ownerAlertedHighUrgency = true;
              if (result.stateAfter.stage === "complete" && !result.stateAfter.ownerAlertedComplete) {
                flagUpdates.ownerAlertedComplete = true;
                // Bot steps back automatically the moment the owner is alerted about a
                // qualified lead, so the human owner owns the thread from here.
                flagUpdates.humanHandoff = true;
              }
              if (Object.keys(flagUpdates).length > 0) await updateState(from, flagUpdates);
            } catch (err) {
              console.error(
                "[WhatsApp Webhook] Owner notify failed:",
                err instanceof Error ? err.message : err
              );
            }
          }

          // ── Google Sheets logging ─────────────────────────────────────────
          const sheetsStage = result.stateAfter.stage;
          const sheetLoggedComplete = result.stateAfter.sheetLoggedComplete ?? false;

          console.log(
            `[WhatsApp Webhook] sheets decision stage=${sheetsStage} shouldLogToSheet=${result.shouldLogToSheet} sheetLoggedComplete=${sheetLoggedComplete}`
          );

          // Google Sheets is a Google/US destination: no patient row may leave while
          // the disclosure is unconfirmed. Only reachable for a legacy thread that
          // already had captured data before the consent flow existed.
          if (result.awaitingConsent) {
            console.log("[WhatsApp Webhook] sheets skipped reason=awaiting_consent");
          } else if (sheetsStage !== "complete") {
            console.log("[WhatsApp Webhook] sheets skipped reason=not_complete");
          } else if (sheetLoggedComplete) {
            console.log("[WhatsApp Webhook] sheets skipped reason=already_logged");
          } else {
            console.log("[WhatsApp Webhook] sheets log queued");
            try {
              await logToSheet({
                createdAt: new Date().toISOString(),
                source: "whatsapp",
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
              console.log("[WhatsApp Webhook] sheets log success");
              await updateState(from, { sheetLoggedComplete: true });
            } catch (err) {
              console.error(
                "[WhatsApp Webhook] Sheets log failed:",
                err instanceof Error ? err.message : err
              );
            }
          }

          messagesProcessed++;
        } catch (err) {
          console.error(
            `[WhatsApp Webhook] Error processing msgId=${messageId}:`,
            err instanceof Error ? err.message : err
          );
          messagesFailed++;
        }
      }
    }
  }

  return NextResponse.json({
    ok: true,
    messagesProcessed,
    messagesSkipped,
    messagesFailed,
    messagesDuplicate,
  });
}
