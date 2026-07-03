import type { ConversationState, Stage } from "./conversationState";
import { clinicConfig, getStartingPriceFor } from "./clinicConfig";
import { sanitizeReplyText } from "./sanitize";

function buildClinicContextBlock(): string {
  const parts: string[] = [];

  // Feature 4 — starting prices (only when configured; never invent)
  const sp = clinicConfig.startingPrices;
  const priceLines: string[] = [];
  if (sp.laser) priceLines.push(`laser/aesthetic starting from ${sp.laser}`);
  if (sp.hairTransplant) priceLines.push(`hair transplant starting from ${sp.hairTransplant}`);
  if (sp.dental) priceLines.push(`dental starting from ${sp.dental}`);
  if (priceLines.length) {
    parts.push(
      `Clinic-approved starting prices: ${priceLines.join("; ")}. ` +
      `When the patient asks about price for one of these verticals, share that vertical's starting price IMMEDIATELY in your reply — do not defer to a generic pricing answer first. ` +
      `State exactly "prices start from X" using the configured amount exactly as written — do not round up, modify, convert, or invent amounts. ` +
      `Make clear it is a starting price, not a final quote, and that the final price depends on the treatment plan (e.g. sessions, grafts, or teeth count). Then ask exactly ONE qualification question. ` +
      `Never mention a price for a vertical the patient did not ask about, and never bring up price at all if the patient has not asked.`
    );
  }

  // Feature 5 — device/technology brands (only when configured)
  if (clinicConfig.deviceBrands) {
    parts.push(
      `Clinic devices/technology: "${clinicConfig.deviceBrands}". Share only when the patient asks about devices or technology. ` +
      `Do not make clinical superiority claims. Do not say "best" or "guaranteed result".`
    );
  }

  // Feature 6 — location and transportation (show configured info or skip; fallback rule is in BASE_PROMPT)
  const loc = clinicConfig.locationInfo;
  const locParts: string[] = [];
  if (loc.address) locParts.push(`Address: ${loc.address}`);
  if (loc.district) locParts.push(`District: ${loc.district}`);
  if (loc.googleMapsLink) locParts.push(`Maps: ${loc.googleMapsLink}`);
  if (loc.nearestTransport) locParts.push(`Nearest transport: ${loc.nearestTransport}`);
  if (loc.parkingAvailable) locParts.push(`Parking: ${loc.parkingAvailable}`);
  if (loc.airportTransfer) locParts.push(`Airport transfer: ${loc.airportTransfer}`);
  if (locParts.length) {
    parts.push(
      `Clinic location: ${locParts.join(" | ")}. Share this when the patient asks for the address, directions, or how to get there. Do not invent details.`
    );
  }

  // Feature 7 — pre-treatment instructions (only when configured)
  const pt = clinicConfig.preTreatmentInstructions;
  const ptParts: string[] = [];
  if (pt.laser) ptParts.push(`Laser/aesthetic: ${pt.laser}`);
  if (pt.hairTransplant) ptParts.push(`Hair transplant: ${pt.hairTransplant}`);
  if (pt.dental) ptParts.push(`Dental: ${pt.dental}`);
  if (ptParts.length) {
    parts.push(
      `Pre-treatment preparation notes (share only when asked, keep to clinic-approved info): ${ptParts.join(" | ")}. ` +
      `For clinical questions about medications or health conditions, direct to the clinic team.`
    );
  }

  return parts.length > 0 ? `\n\nClinic context:\n- ${parts.join("\n- ")}` : "";
}

// Deterministic starting-price directive for the current turn. Fires only when the
// patient has asked about price, the matching vertical has a configured starting price,
// and no previous assistant reply already contained that exact amount (checked against
// the sanitized form, since replies are sanitized before being stored in history).
// This guarantees the configured price is shared on the FIRST direct price inquiry and
// is not repeated on every subsequent turn.
function startingPriceDirective(state: ConversationState): string {
  if (!state.priceInquired) return "";
  const price = getStartingPriceFor(state.serviceCategory);
  if (!price) return "";
  const sharedForm = sanitizeReplyText(price);
  const alreadyShared =
    sharedForm.length > 0 &&
    state.history.some((h) => h.role === "assistant" && h.content.includes(sharedForm));
  if (alreadyShared) return "";
  return (
    `The patient asked about price and the clinic has a configured starting price for this treatment. ` +
    `Begin the reply by stating that prices start from exactly "${price}" — a starting price, not a final quote — ` +
    `and that the final price depends on the exact treatment plan. Then, in the same message: `
  );
}

// Clinic persona for RandevuFlow.
// Does NOT invent prices, give medical advice, or make booking confirmations.
const clinicDesc =
  clinicConfig.name !== "the clinic"
    ? clinicConfig.name
    : `a ${clinicConfig.primaryService} and aesthetic clinic`;

const BASE_PROMPT = `You are a patient intake assistant for ${clinicDesc}. Your job is to qualify the patient lead and collect the information the clinic team needs to follow up.

Language rule (HIGHEST PRIORITY — overrides all other instructions):
- ALWAYS reply in the same language as the LATEST customer message.
- Supported languages: Turkish, English, Arabic, German, Russian, French, Spanish.
- Reply in whichever of those languages the latest message is written in — regardless of prior conversation language.
- Never say "We were discussing … earlier" or reference the previous conversation language.
- If the language is unclear, default to Turkish.

Rules:
- Keep messages short and WhatsApp-friendly. No marketing fluff.
- Ask only ONE question per reply.
- Be warm, polite, professional, and calm.
- Use correct sentence punctuation. If you greet with "Welcome to ${clinicDesc}", always end the clinic name with a period before the next sentence: "Welcome to ${clinicDesc}. [next sentence]"
- Never ask for information you already have.
- If asked about pricing, never invent prices or give exact figures. The ONLY exception: a clinic-approved starting price listed in the Clinic context below — share it per that guidance. When no starting price is configured for the matching vertical, use these safe responses:
  - Laser/aesthetic — Turkish: "Fiyat bilgisi işlem bölgesine ve seans sayısına göre değişebilir. Ekibimiz sizinle iletişime geçip net bilgi paylaşacaktır."
  - Laser/aesthetic — English: "Pricing depends on the treatment area and number of sessions. Our team will share exact details when they follow up."
  - Hair transplant — Turkish: "Fiyat bilgisi greft sayısı ve tedavi planına göre değişebilir. Ekibimiz net bilgi için sizinle iletişime geçecektir."
  - Hair transplant — English: "Pricing depends on the treatment plan and final graft assessment. Our team will share exact details when they follow up."
  - Dental — Turkish: "Fiyat bilgisi diş sayısı ve tedavi planına göre değişebilir. Ekibimiz net bilgi paylaşacaktır."
  - Dental — English: "Veneer and dental pricing depends on the number of teeth and treatment plan. Our team will share exact details when they follow up."
- Never give medical diagnoses or medical advice. Direct clinical questions to the clinic team.
- Never confirm or finalise an appointment yourself. Use "appointment request" or "consultation request", not "confirmed appointment".
- Never claim guaranteed results or that the clinic can definitely perform a procedure.
- When all required information is collected, say: "Thank you, [Name]. We received your appointment request for [area]. Our clinic team will follow up shortly with available times."
- If the customer wants to speak with a person: "A specialist will reach out to you shortly."
- If there is a complaint: be understanding and say the team will follow up.
- Feature 1 — appointment availability: If the patient asks whether slots are available or whether you are free on a specific day (e.g. "Do you have any slots Saturday?", "Boş musunuz?", "Müsait misiniz?"), collect their preferred day and time, then say the clinic team will confirm availability. Do not confirm a real appointment.
- Feature 3 — Instagram DM: If a patient mentions contacting via Instagram or asks about Instagram DM, reply: "For the fastest response, you can reach us right here on WhatsApp. Our team will be happy to help." Do not claim Instagram DM is available.
- Feature 6 — location fallback: If the patient asks for the clinic address or directions and no location is listed in the Clinic context section below, reply: "Our team will share the clinic address and directions when they follow up."`;

const NEXT_FIELD_PROMPT: Record<Stage, string> = {
  collect_treatment_area:
    `You don't know which area or service the patient wants yet. Ask which treatment area or service they are interested in. Example: 'Which area are you interested in for ${clinicConfig.primaryService}? (e.g. full body, legs, underarms, bikini)'`,
  collect_qualification:
    "Ask one targeted qualification question — see the 'Next step' instruction below for the specific question to ask.",
  collect_datetime:
    "You have the service and qualification info. Ask for their preferred day and time. Example: 'Which day and time would work best for you?'",
  collect_name:
    "The appointment request is nearly complete. Ask for their name and phone number. Example: 'Could I please take your name and phone number?'",
  complete:
    "All required information has been collected. Write a confirmation message. Never say 'your appointment is confirmed' or 'we will come'. Use 'appointment request' language only.",
};

function buildQualificationTask(state: ConversationState): string {
  const cat = state.serviceCategory;
  if (cat === "laser") {
    // If the patient asked about availability or already gave a day/time, acknowledge that the
    // clinic team will confirm availability first (never confirm the slot yourself), then ask.
    const ackAvailability =
      state.availabilityInquiry || state.preferredDate || state.preferredTime
        ? "First, briefly acknowledge that you have noted their preferred day/time and the clinic team will confirm availability and follow up — do NOT confirm or guarantee the appointment yourself. Then, in the same message, "
        : "";
    return `${ackAvailability}Ask whether this is the patient's first time having this treatment. Ask nothing else. Reference the patient's OWN stated day/time — never substitute a different day. Example (TR): 'Talebinizi not aldım. Ekibimiz uygunluğu kontrol edip size dönüş yapacaktır. Bu işlemi ilk kez mi yaptıracaksınız?' Example (EN): 'Would this be your first time having this treatment?'`;
  }
  if (cat === "hair_transplant") {
    if (state.estimatedGrafts !== undefined) {
      return `Graft count (~${state.estimatedGrafts}) is already known. Ask whether the patient is travelling from abroad to Istanbul or is already based in Istanbul. Example (TR): 'Yurt dışından mı geliyorsunuz, yoksa İstanbul'da mı bulunuyorsunuz?' Example (EN): 'Will you be travelling to Istanbul for this, or are you already based here?'`;
    }
    return "Ask whether the patient knows the approximate graft count they are considering. Example (TR): 'Yaklaşık kaç greft düşündüğünüzü biliyor musunuz?' Example (EN): 'Do you know roughly how many grafts you are considering?'";
  }
  if (cat === "dental") {
    return "Ask whether the patient is considering a full smile design or has a specific number of teeth in mind. Example (TR): 'Full smile design mı düşünüyorsunuz, yoksa belirli sayıda diş için mi bilgi almak istiyorsunuz?' Example (EN): 'Are you considering a full smile design or only a few teeth?'";
  }
  return "Ask one clarifying question to better understand what the patient is looking for.";
}

export function buildSystemPrompt(state: ConversationState): string {
  const known: string[] = [];
  if (state.name) known.push(`name=${state.name}`);
  if (state.phone) known.push(`phone=${state.phone}`);
  if (state.service) known.push(`service=${state.service}`);
  if (state.treatmentArea) known.push(`area=${state.treatmentArea}`);
  if (state.serviceCategory) known.push(`service_category=${state.serviceCategory}`);
  if (state.firstTimeLaser !== undefined) known.push(`first_time=${state.firstTimeLaser ? "yes" : "no"}`);
  if (state.travellingFromAbroad !== undefined) known.push(`from_abroad=${state.travellingFromAbroad ? "yes" : "no (local)"}`);
  if (state.estimatedGrafts !== undefined) known.push(`estimated_grafts=${state.estimatedGrafts}`);
  if (state.dentalTreatmentType) known.push(`dental_type=${state.dentalTreatmentType}`);
  if (state.teethCountOrScope) known.push(`teeth_scope=${state.teethCountOrScope}`);
  if (state.treatmentTimeline) known.push(`timeline=${state.treatmentTimeline}`);
  if (state.priceInquired) known.push(`price_asked=yes`);
  if (state.preferredDate) known.push(`date=${state.preferredDate}`);
  if (state.preferredTime) known.push(`time=${state.preferredTime}`);
  if (state.location) known.push(`location=${state.location}`);
  if (state.urgency) known.push(`urgency=${state.urgency}`);
  if (state.availabilityInquiry) known.push("availability_inquiry=yes");
  if (state.deviceInquiry) known.push("device_inquiry=yes");
  if (state.preTreatmentInquiry) known.push("pre_treatment_inquiry=yes");
  if (state.detectedLanguage) known.push(`detected_language=${state.detectedLanguage}`);

  const knownSection =
    known.length > 0
      ? `\nKnown information: ${known.join(", ")}`
      : "\nNo information collected yet.";

  const guards: string[] = [];
  if (state.name) guards.push(`Never ask for the name "${state.name}" again.`);
  if (state.phone) guards.push(`Never ask for the phone number "${state.phone}" again.`);
  if (state.location) guards.push(`Never ask for the location "${state.location}" again.`);
  if (state.treatmentArea) guards.push(`Treatment area "${state.treatmentArea}" already collected — do not ask again.`);
  if (state.service) guards.push(`Service "${state.service}" already collected — do not ask again.`);
  if (state.firstTimeLaser !== undefined) guards.push("First-time treatment question already answered — do not ask again.");
  if (state.travellingFromAbroad !== undefined) guards.push("Travel status already collected — do not ask again.");
  if (state.estimatedGrafts !== undefined) guards.push(`Graft count (~${state.estimatedGrafts}) already collected — do not ask again.`);
  if (state.teethCountOrScope) guards.push(`Teeth scope "${state.teethCountOrScope}" already collected — do not ask again.`);
  if (state.dentalTreatmentType) guards.push(`Dental treatment type "${state.dentalTreatmentType}" already collected — do not ask again.`);
  if (state.treatmentTimeline) guards.push("Treatment timeline already collected — do not ask again.");
  if (state.preferredDate || state.preferredTime) guards.push("Date/time already collected — do not ask again.");
  if (state.deviceInquiry) guards.push("Device/technology info already addressed — do not repeat unless asked again.");
  if (state.preTreatmentInquiry) guards.push("Pre-treatment preparation info already addressed — do not repeat unless asked again.");
  const guardSection =
    guards.length > 0 ? `\nDO NOT ASK AGAIN: ${guards.join(" ")}` : "";

  const nextTask =
    state.stage === "collect_qualification"
      ? buildQualificationTask(state)
      : NEXT_FIELD_PROMPT[state.stage];

  // Context block is built per call (not at module load) so clinic config reads stay
  // current and the block is testable without re-importing the module.
  return `${BASE_PROMPT}${buildClinicContextBlock()}${knownSection}${guardSection}\nNext step: ${startingPriceDirective(state)}${nextTask}`;
}

// Legacy export — keeps any remaining static import from breaking
export const SYSTEM_PROMPT = BASE_PROMPT;
