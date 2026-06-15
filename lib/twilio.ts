import twilio from "twilio";
import { sanitizeSmsText, SMS_MAX_CHARS } from "./sanitize";
import type { ConversationState } from "./conversationState";

const accountSid = process.env.TWILIO_ACCOUNT_SID!;
const authToken = process.env.TWILIO_AUTH_TOKEN!;
const fromNumber = process.env.TWILIO_PHONE_NUMBER!;
const ownerPhone = process.env.OWNER_PHONE!;

function getClient() {
  return twilio(accountSid, authToken);
}

export async function sendSms(to: string, body: string): Promise<void> {
  const clean = sanitizeSmsText(body);
  console.log(`[Twilio] sending to=${to} len=${clean.length}`);
  const client = getClient();
  const msg = await client.messages.create({ from: fromNumber, to, body: clean });
  console.log(`[Twilio] sent sid=${msg.sid}`);
}

// Builds a compact owner alert from the lead state.
// Format: [RF] +90xxx HOT | saç bakımı | yarın 14:00 | Ayşe | eksik: konum
export function buildOwnerAlert(
  customerFrom: string,
  state: ConversationState
): string {
  const score = (state.leadScore ?? state.urgency ?? "new").toUpperCase();
  const parts: string[] = [];

  parts.push(state.service ?? "yeni mesaj");
  if (state.preferredDate) parts.push(state.preferredDate);
  if (state.preferredTime) parts.push(state.preferredTime);
  if (state.name) parts.push(state.name);
  if (state.location) parts.push(state.location);

  const missing: string[] = [];
  if (!state.preferredDate && !state.preferredTime) missing.push("tarih");
  if (!state.location) missing.push("konum");
  if (missing.length) parts.push(`eksik: ${missing.join("+")}`);

  const alert = `[RF] ${customerFrom} ${score} | ${parts.join(" | ")}`;
  return alert.length > SMS_MAX_CHARS ? alert.slice(0, SMS_MAX_CHARS) : alert;
}

export async function notifyOwner(
  customerFrom: string,
  state: ConversationState
): Promise<void> {
  console.log(`[OwnerAlert] to=${ownerPhone} customer=${customerFrom}`);

  if (ownerPhone && ownerPhone === customerFrom) {
    console.warn(
      "[OwnerAlert WARNING] owner phone equals customer phone in test mode — alert will reach customer"
    );
  }

  const body = buildOwnerAlert(customerFrom, state);
  await sendSms(ownerPhone, body);
}
