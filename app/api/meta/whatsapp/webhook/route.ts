import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { processInboundMessage } from "@/lib/inboundPipeline";
import { sendWhatsAppText } from "@/lib/metaWhatsApp";
import { notifyOwner } from "@/lib/twilio";
import { logToSheet } from "@/lib/googleSheets";
import { updateState } from "@/lib/conversationState";
import { clinicConfig, formatBookingLinkMessage } from "@/lib/clinicConfig";

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

  const signature = req.headers.get("x-hub-signature-256") ?? "";
  const expectedSig =
    "sha256=" + crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");

  const signaturesMatch =
    signature.length === expectedSig.length &&
    crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig));

  if (!signaturesMatch) {
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

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value) continue;

      // Status updates (delivery/read receipts) — skip this change, continue batch
      if (value.statuses && value.statuses.length > 0) {
        console.log("[WhatsApp Webhook] Status update in change — skipping");
        continue;
      }

      const messages = value.messages;
      if (!messages || messages.length === 0) continue;

      for (const message of messages) {
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
          `[WhatsApp Webhook] from=${from} msgId=${messageId} bodyLen=${body.length} name=${profileName ?? "(none)"}`
        );

        try {
          const result = await processInboundMessage({
            from,
            body,
            source: "whatsapp",
            profileName,
          });

          console.log(
            `[WhatsApp Webhook] pipeline done stage=${result.stateAfter.stage} leadScore=${result.stateAfter.leadScore ?? "none"}`
          );

          // Send the assistant reply back to the customer
          try {
            await sendWhatsAppText(from, result.assistantReply);
            console.log(`[WhatsApp Webhook] Reply sent to=${from}`);
          } catch (err) {
            console.error(
              "[WhatsApp Webhook] Failed to send reply:",
              err instanceof Error ? err.message : err
            );
          }

          // ── Booking link handoff ──────────────────────────────────────────
          if (clinicConfig.bookingUrl && result.stateAfter.stage === "complete" && !result.stateAfter.bookingLinkSent) {
            try {
              await sendWhatsAppText(from, formatBookingLinkMessage(clinicConfig.bookingUrl));
              await updateState(from, { bookingLinkSent: true });
              console.log("[WhatsApp Webhook] booking link sent");
            } catch (err) {
              console.error("[WhatsApp Webhook] Booking link send failed:", err instanceof Error ? err.message : err);
            }
          }

          // ── Owner notification ────────────────────────────────────────────
          if (result.shouldNotifyOwner) {
            try {
              await notifyOwner(from, result.stateAfter);
              console.log("[WhatsApp Webhook] owner notification sent");

              const flagUpdates: Record<string, boolean> = {};
              if (result.stateAfter.urgency === "high" && !result.stateAfter.ownerAlertedHighUrgency)
                flagUpdates.ownerAlertedHighUrgency = true;
              if (result.stateAfter.stage === "complete" && !result.stateAfter.ownerAlertedComplete)
                flagUpdates.ownerAlertedComplete = true;
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

          if (sheetsStage !== "complete") {
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
  });
}
