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

// Builds the owner alert from conversation state.
// Format: [RF] +1xxx HIGH | pipe burst | tomorrow 8pm | need addr
export function buildOwnerAlert(
  customerFrom: string,
  state: ConversationState
): string {
  const urgency = (state.urgency ?? "new").toUpperCase();
  const parts: string[] = [];

  if (state.issue_type) {
    // Use exact label for special emergency types
    const issueLabel =
      state.issue_type === "pipe_burst" ? "pipe burst"
      : state.issue_type === "gas_smell" ? "gas smell"
      : state.issue_type === "water_heater" ? "water heater"
      : state.issue_type.replace("_", " ");

    // For pipe_burst and gas_smell the label already describes the situation
    const skipFixturePrefix =
      state.issue_type === "pipe_burst" || state.issue_type === "gas_smell";

    parts.push(
      !skipFixturePrefix && state.fixture
        ? `${state.fixture} ${issueLabel}`
        : issueLabel
    );
  } else {
    parts.push("new msg");
  }

  if (state.preferred_time) parts.push(state.preferred_time);

  const missing: string[] = [];
  // Fixture is implied for pipe_burst/gas_smell — do not flag as missing
  if (
    !state.fixture &&
    state.issue_type !== "pipe_burst" &&
    state.issue_type !== "gas_smell"
  ) {
    missing.push("fixture");
  }
  // HIGH urgency means "now" — time is not a missing field
  if (!state.preferred_time && state.urgency !== "high") missing.push("time");
  if (!state.address) missing.push("addr");
  if (missing.length) parts.push(`need ${missing.join("+")}`);

  const alert = `[RF] ${customerFrom} ${urgency} | ${parts.join(" | ")}`;
  return alert.length > SMS_MAX_CHARS ? alert.slice(0, SMS_MAX_CHARS) : alert;
}

export async function notifyOwner(
  customerFrom: string,
  state: ConversationState
): Promise<void> {
  // Explicit routing log — make it easy to verify owner vs customer phone
  console.log(`[OwnerAlert] to=${ownerPhone} customer=${customerFrom}`);

  if (ownerPhone && ownerPhone === customerFrom) {
    console.warn(
      "[OwnerAlert WARNING] owner phone equals customer phone in test mode — alert will reach customer"
    );
  }

  const body = buildOwnerAlert(customerFrom, state);
  await sendSms(ownerPhone, body);
}
