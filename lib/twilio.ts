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

// Builds an owner alert for laser/aesthetic lead state.
// Returned as ownerAlertPreview in the API response (not sanitized).
// When sent via notifyOwner → sendSms, newlines collapse to spaces and length is capped.
export function buildOwnerAlert(
  customerFrom: string,
  state: ConversationState
): string {
  const score = (state.leadScore ?? state.urgency ?? "new").toUpperCase();

  const lines: string[] = [];
  lines.push(`[RF] ${customerFrom} | ${score}`);

  // Service / treatment area line
  const serviceParts: string[] = [];
  if (state.service) serviceParts.push(state.service);
  if (state.treatmentArea) serviceParts.push(`Bolge: ${state.treatmentArea}`);
  if (serviceParts.length) lines.push(serviceParts.join(" | "));

  // Contact line
  const contactParts: string[] = [];
  if (state.name) contactParts.push(`Isim: ${state.name}`);
  if (state.phone) contactParts.push(`Tel: ${state.phone}`);
  if (contactParts.length) lines.push(contactParts.join(" | "));

  // Laser-specific signals
  const laserParts: string[] = [];
  if (state.firstTimeLaser !== undefined) {
    laserParts.push(`Ilk kez: ${state.firstTimeLaser ? "Evet" : "Hayir"}`);
  }
  if (state.priceInquired) laserParts.push("Fiyat: Evet");
  if (laserParts.length) lines.push(laserParts.join(" | "));

  // Timing
  const timeParts: string[] = [];
  if (state.preferredDate) timeParts.push(state.preferredDate);
  if (state.preferredTime) timeParts.push(state.preferredTime);
  if (timeParts.length) lines.push(`Zaman: ${timeParts.join(" ")}`);

  if (state.location) lines.push(`Konum: ${state.location}`);

  if (score === "HOT") lines.push("Hizli donus yapilmali");

  return lines.join("\n");
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
