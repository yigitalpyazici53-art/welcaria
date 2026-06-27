import twilio from "twilio";
import { sanitizeSmsText } from "./sanitize";
import type { ConversationState } from "./conversationState";

function validateTwilioConfig(): { accountSid: string; authToken: string; fromNumber: string } {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_PHONE_NUMBER;

  if (!accountSid) throw new Error("Missing TWILIO_ACCOUNT_SID");
  if (!authToken) throw new Error("Missing TWILIO_AUTH_TOKEN");
  if (!fromNumber) throw new Error("Missing TWILIO_PHONE_NUMBER");

  return { accountSid, authToken, fromNumber };
}

export async function sendSms(to: string, body: string): Promise<void> {
  const { accountSid, authToken, fromNumber } = validateTwilioConfig();
  const clean = sanitizeSmsText(body);
  console.log(`[Twilio] sending to=${to} len=${clean.length}`);
  const client = twilio(accountSid, authToken);
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

  // Source / stage line
  const metaParts: string[] = [];
  if (state.source) metaParts.push(`Source: ${state.source}`);
  if (state.stage) metaParts.push(`Stage: ${state.stage}`);
  if (metaParts.length) lines.push(metaParts.join(" | "));

  // Service / treatment area
  if (state.service) lines.push(`Service: ${state.service}`);
  if (state.treatmentArea) lines.push(`Area: ${state.treatmentArea}`);

  // Contact line
  const contactParts: string[] = [];
  if (state.name) contactParts.push(`Name: ${state.name}`);
  if (state.phone) contactParts.push(`Phone: ${state.phone}`);
  if (contactParts.length) lines.push(contactParts.join(" | "));

  // Laser-specific signals
  const signalParts: string[] = [];
  if (state.firstTimeLaser !== undefined) {
    signalParts.push(`First time: ${state.firstTimeLaser ? "Yes" : "No"}`);
  }
  if (state.priceInquired) signalParts.push("Price asked: Yes");
  if (signalParts.length) lines.push(signalParts.join(" | "));

  // Timing
  const timeParts: string[] = [];
  if (state.preferredDate) timeParts.push(state.preferredDate);
  if (state.preferredTime) timeParts.push(state.preferredTime);
  if (timeParts.length) lines.push(`Time: ${timeParts.join(" ")}`);

  if (state.location) lines.push(`Location: ${state.location}`);
  if (state.urgency) lines.push(`Urgency: ${state.urgency}`);
  if (state.notes) lines.push(`Notes: ${state.notes}`);

  if (score === "HOT") lines.push("ACTION: Follow up ASAP");

  return lines.join("\n");
}

export async function notifyOwner(
  customerFrom: string,
  state: ConversationState
): Promise<void> {
  const ownerPhone = process.env.OWNER_PHONE;
  if (!ownerPhone) {
    const msg = "Missing OWNER_PHONE for owner notification";
    console.error(`[OwnerAlert ERROR] ${msg}`);
    throw new Error(msg);
  }

  console.log(`[OwnerAlert] to=${ownerPhone} customer=${customerFrom}`);

  if (ownerPhone === customerFrom) {
    console.warn(
      "[OwnerAlert WARNING] owner phone equals customer phone in test mode — alert will reach customer"
    );
  }

  const body = buildOwnerAlert(customerFrom, state);
  await sendSms(ownerPhone, body);
}
