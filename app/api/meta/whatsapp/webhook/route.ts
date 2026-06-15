import { NextRequest, NextResponse } from "next/server";
import { processInboundMessage } from "@/lib/inboundPipeline";
import { sendWhatsAppText } from "@/lib/metaWhatsApp";

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
  let payload: MetaWebhookPayload;
  try {
    payload = (await req.json()) as MetaWebhookPayload;
  } catch {
    console.error("[WhatsApp Webhook] Failed to parse JSON body");
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  // Validate this is a WhatsApp Business Account webhook
  if (payload.object !== "whatsapp_business_account") {
    console.warn("[WhatsApp Webhook] Unexpected object type:", payload.object);
    return NextResponse.json({ ok: true, processed: false, reason: "unsupported_payload" });
  }

  const value = payload.entry?.[0]?.changes?.[0]?.value;

  if (!value) {
    console.log("[WhatsApp Webhook] Empty payload value");
    return NextResponse.json({ ok: true, processed: false, reason: "empty_payload" });
  }

  // Status updates (delivery receipts, read receipts) — acknowledge and ignore
  if (value.statuses && value.statuses.length > 0) {
    console.log("[WhatsApp Webhook] Status update — ignoring");
    return NextResponse.json({ ok: true, processed: false, reason: "status_update" });
  }

  const messages = value.messages;
  if (!messages || messages.length === 0) {
    return NextResponse.json({ ok: true, processed: false, reason: "no_messages" });
  }

  const message = messages[0];

  // Only handle text messages for now
  if (message.type !== "text") {
    console.log(`[WhatsApp Webhook] Unsupported message type: ${message.type}`);
    return NextResponse.json({ ok: true, processed: false, reason: "unsupported_message" });
  }

  const from = message.from;
  const body = message.text?.body;
  const messageId = message.id;

  if (!from || !body) {
    console.warn("[WhatsApp Webhook] Missing from or body in message");
    return NextResponse.json({ ok: true, processed: false, reason: "missing_fields" });
  }

  const profileName = value.contacts?.[0]?.profile?.name;

  console.log(
    `[WhatsApp Webhook] from=${from} msgId=${messageId} bodyLen=${body.length} name=${profileName ?? "(none)"}`
  );

  // Run the shared RandevuFlow inbound pipeline
  let result: Awaited<ReturnType<typeof processInboundMessage>>;
  try {
    result = await processInboundMessage({
      from,
      body,
      source: "whatsapp",
      profileName,
    });
  } catch (err) {
    console.error(
      "[WhatsApp Webhook] Pipeline error:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json({ ok: false, error: "Pipeline error" }, { status: 500 });
  }

  console.log(
    `[WhatsApp Webhook] pipeline done stage=${result.stateAfter.stage} leadScore=${result.stateAfter.leadScore ?? "none"}`
  );

  // Send the assistant reply back to the customer via WhatsApp
  let messageSent = false;
  try {
    await sendWhatsAppText(from, result.assistantReply);
    messageSent = true;
    console.log(`[WhatsApp Webhook] Reply sent to=${from}`);
  } catch (err) {
    console.error(
      "[WhatsApp Webhook] Failed to send reply:",
      err instanceof Error ? err.message : err
    );
  }

  return NextResponse.json({
    ok: true,
    processed: true,
    messageSent,
  });
}
