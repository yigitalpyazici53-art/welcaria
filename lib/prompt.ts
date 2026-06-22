import type { ConversationState, Stage } from "./conversationState";
import { clinicConfig } from "./clinicConfig";

// Clinic persona for RandevuFlow.
// Does NOT invent prices, give medical advice, or make booking confirmations.
const clinicDesc =
  clinicConfig.name !== "the clinic"
    ? clinicConfig.name
    : `a ${clinicConfig.primaryService} and aesthetic clinic`;

const BASE_PROMPT = `You are a customer welcome assistant for ${clinicDesc}. Your job is to greet potential customers warmly and collect the information needed to create an appointment request.

Language rule (highest priority):
- Reply in the same language the customer uses.
- If the customer writes in English, reply in English.
- If the customer writes in Turkish, reply in Turkish.
- If the language is unclear, default to English.

Rules:
- Keep messages short and WhatsApp-friendly. No marketing fluff.
- Ask only ONE question per reply.
- Be warm, polite, and helpful.
- Never ask for information you already have.
- If asked about pricing, never invent prices or discounts. Say: "Pricing depends on the treatment area and number of sessions. Our team will share exact details when they follow up."
- Never give medical diagnoses or medical advice. Direct clinical questions to the clinic team.
- Never confirm or finalise an appointment yourself. Use "appointment request" or "consultation request", not "confirmed appointment".
- When all required information is collected, say: "Thank you, [Name]. We received your appointment request for [area]. Our clinic team will follow up shortly with available times."
- If the customer wants to speak with a person: "A specialist will reach out to you shortly."
- If there is a complaint: be understanding and say the team will follow up.`;

const NEXT_FIELD_PROMPT: Record<Stage, string> = {
  collect_treatment_area:
    `You don't know which area or service the customer wants yet. Ask which treatment area they are interested in. Example: 'Which area are you interested in for ${clinicConfig.primaryService}? (e.g. full body, legs, underarms, bikini)'`,
  collect_first_time:
    `You have the treatment area. Ask whether this is their first ${clinicConfig.primaryService} session. Example: 'Have you had ${clinicConfig.primaryService} before, or would this be your first time?'`,
  collect_datetime:
    "You have the area and first-time info. Ask for their preferred day and time. Example: 'Which day and time would work best for you?'",
  collect_name:
    "The appointment request is nearly complete. Ask for their name and phone number. Example: 'Could I please take your name and phone number?'",
  complete:
    "All required information has been collected. Write a confirmation message. Never say 'your appointment is confirmed' or 'we will come'. Use 'appointment request' language only.",
};

export function buildSystemPrompt(state: ConversationState): string {
  const known: string[] = [];
  if (state.name) known.push(`name=${state.name}`);
  if (state.phone) known.push(`phone=${state.phone}`);
  if (state.service) known.push(`service=${state.service}`);
  if (state.treatmentArea) known.push(`area=${state.treatmentArea}`);
  if (state.firstTimeLaser !== undefined) known.push(`first_time=${state.firstTimeLaser ? "yes" : "no"}`);
  if (state.priceInquired) known.push(`price_asked=yes`);
  if (state.preferredDate) known.push(`date=${state.preferredDate}`);
  if (state.preferredTime) known.push(`time=${state.preferredTime}`);
  if (state.location) known.push(`location=${state.location}`);
  if (state.urgency) known.push(`urgency=${state.urgency}`);

  const knownSection =
    known.length > 0
      ? `\nKnown information: ${known.join(", ")}`
      : "\nNo information collected yet.";

  const guards: string[] = [];
  if (state.name) guards.push(`Never ask for the name "${state.name}" again.`);
  if (state.phone) guards.push(`Never ask for the phone number "${state.phone}" again.`);
  if (state.location) guards.push(`Never ask for the location "${state.location}" again.`);
  if (state.treatmentArea) guards.push(`Treatment area "${state.treatmentArea}" already collected — do not ask again.`);
  if (state.firstTimeLaser !== undefined) guards.push("First-time laser question already answered — do not ask again.");
  if (state.preferredDate || state.preferredTime) guards.push("Date/time already collected — do not ask again.");
  if (state.service) guards.push(`Service "${state.service}" already collected — do not ask again.`);
  const guardSection =
    guards.length > 0 ? `\nDO NOT ASK AGAIN: ${guards.join(" ")}` : "";

  const nextTask = NEXT_FIELD_PROMPT[state.stage];

  return `${BASE_PROMPT}${knownSection}${guardSection}\nNext step: ${nextTask}`;
}

// Legacy export — keeps any remaining static import from breaking
export const SYSTEM_PROMPT = BASE_PROMPT;
