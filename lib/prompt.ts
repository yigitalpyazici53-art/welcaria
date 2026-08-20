import type { ConversationState, Stage } from "./conversationState";
import { clinicConfig, getStartingPriceFor } from "./clinicConfig";
import { sanitizeReplyText } from "./sanitize";
import { turkishAblative } from "./localization";

// Options for turn-specific prompt behavior, decided deterministically in the pipeline.
export interface PromptOptions {
  // The message is a purely informational question (location, transfer, parking, device,
  // Instagram, or out-of-flow preparation) — answer it, do NOT qualify on this turn.
  informationalTurn?: boolean;
  // The lead was already captured before this message — answer follow-ups without
  // repeating the completion message or re-requesting contact details.
  postCompletion?: boolean;
}

function buildClinicContextBlock(state: ConversationState): string {
  const parts: string[] = [];
  const cat = state.serviceCategory;
  const knownVertical = cat === "laser" || cat === "hair_transplant" || cat === "dental";

  // Feature 4 — starting prices (only when configured; never invent).
  // Vertical isolation: once the patient's vertical is known, ONLY that vertical's
  // price is exposed to the model — other verticals' prices cannot leak.
  const sp = clinicConfig.startingPrices;
  const priceLines: string[] = [];
  const priceValues: string[] = [];
  if (sp.laser && (!knownVertical || cat === "laser")) { priceLines.push(`laser/aesthetic starting from ${sp.laser}`); priceValues.push(sp.laser); }
  if (sp.hairTransplant && (!knownVertical || cat === "hair_transplant")) { priceLines.push(`hair transplant starting from ${sp.hairTransplant}`); priceValues.push(sp.hairTransplant); }
  if (sp.dental && (!knownVertical || cat === "dental")) { priceLines.push(`dental starting from ${sp.dental}`); priceValues.push(sp.dental); }
  if (priceLines.length) {
    // Turkish-suffix example is built from a price already shown above, so no other
    // vertical's amount ever appears in the prompt.
    const exampleTr = turkishAblative(priceValues[0]);
    parts.push(
      `Clinic-approved starting prices: ${priceLines.join("; ")}. ` +
      `When the patient asks about price for one of these verticals, share that vertical's starting price IMMEDIATELY in your reply — do not defer to a generic pricing answer first. ` +
      `Keep the configured amount exactly as written — do not round up, modify, convert, or invent amounts. ` +
      `Copy the configured starting-price string exactly as written. Do not localize its punctuation, currency symbol, spacing, or digit grouping — never swap a period for a comma, move or translate the currency symbol, or convert it to a currency code. The price substring stays byte-for-byte identical in every reply language. ` +
      `Phrase it naturally in the reply language: English "Prices start from X"; Turkish "X'den başlıyor" with the correct apostrophe suffix (e.g. "${exampleTr} başlıyor") — never glue "den/dan" directly to the number, and never use the stiff "başlamaktadır" form. ` +
      `If the configured value already contains starting-price wording, do not repeat it (never "başlangıç fiyatından başlıyor" or "başlangıç fiyatından başlamaktadır"). ` +
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
      `Clinic location: ${locParts.join(" | ")}. Share this when the patient asks for the address, directions, or how to get there. Do not invent details. ` +
      `Write the map link as plain text ("Google Maps: <url>") — never as a Markdown link.`
    );
  }

  // Feature 7 — pre-treatment instructions (only when configured).
  // Vertical isolation: only the active vertical's note once the category is known.
  const pt = clinicConfig.preTreatmentInstructions;
  const ptParts: string[] = [];
  if (pt.laser && (!knownVertical || cat === "laser")) ptParts.push(`Laser/aesthetic: ${pt.laser}`);
  if (pt.hairTransplant && (!knownVertical || cat === "hair_transplant")) ptParts.push(`Hair transplant: ${pt.hairTransplant}`);
  if (pt.dental && (!knownVertical || cat === "dental")) ptParts.push(`Dental: ${pt.dental}`);
  if (ptParts.length) {
    parts.push(
      `Pre-treatment preparation notes (share only when asked, keep to clinic-approved info): ${ptParts.join(" | ")}. ` +
      `Phrase preparation info as one or two natural sentences — NEVER as a bullet list — and add that the team will confirm the exact steps before the visit. ` +
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
    `phrased naturally in the reply language (English: "Prices start from ${price}"; Turkish: "${turkishAblative(price)} başlıyor") ` +
    `and that the final price depends on the exact treatment plan. ` +
    `Copy the configured starting-price string exactly as written. Do not localize its punctuation, currency symbol, spacing, or digit grouping. ` +
    `Then, in the same message: `
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
- Reply in the same language as the latest customer message whenever that language is clear.
- Supported languages: Turkish, English, Arabic, German, Russian, French, Spanish.
- If the latest message carries no clear language signal (for example only a name and a phone number), KEEP the established conversation language (detected_language in Known information) — do not switch.
- Use English only when there is no established conversation language and no clear signal.
- Never say "We were discussing … earlier" or reference the previous conversation language.
- Clinic-configured values — device brands, street names, addresses, prices, currency amounts, URLs, phone numbers — stay VERBATIM in every language; only the surrounding sentence is written in the reply language.
- Never mix Turkish or English boilerplate into a reply written in another language.

Formatting rule (WhatsApp plain text):
- Never use Markdown. No [text](url) links — write "Google Maps: <url>" instead. No headings, bullet points, numbered lists, tables, or code blocks.
- At most an occasional *bold* with single asterisks; the reply must read correctly without any formatting.

Tone (applies in EVERY reply language — write what a native-speaking patient coordinator would naturally type on WhatsApp, never a translation of another language's phrasing):
- Formal register, warm delivery. Always keep the polite/formal "you": Turkish "siz", German "Sie", French "vous", Spanish "usted", Russian "вы", respectful formal Arabic; English stays professionally friendly. Never switch to the informal register. Within that register, write the way a real coordinator texts — warm and human, not the way a brochure or corporate website reads.
- Short sentences, WhatsApp rhythm. Prefer 1-2 short sentences over one long formal sentence. Break long clauses into two short beats. Never write a dense email-style paragraph.
- Vary the rhythm. Consecutive messages must not all follow the identical "information + question" template. When this turn requires a question, you may open with a brief acknowledgment ("Harika, not aldım." / "Perfect, noted.") or a plain short statement — but the required question MUST still appear in that same message, exactly once, unchanged in meaning. When no question is required, end on a natural statement — do not add a courtesy question just to end with one.
- Everyday spoken, still respectful wording. Avoid stiff written-register forms; use their natural spoken equivalents. Turkish: prefer "başlıyor", "paylaşırız", "size döneriz" — avoid "başlamaktadır", "paylaşacaktır", "iletişime geçecektir". Apply the same softening in German, French, Spanish, Russian, and Arabic: no bureaucratic constructions a person would never type in a chat.
- Emoji: default to none. At most a single tasteful emoji (e.g. 🙂), rarely — and NEVER in a message containing a price, medical information, or appointment/booking wording.

Rules:
- Keep messages short and WhatsApp-friendly. No marketing fluff.
- Ask only ONE question per reply.
- Use correct sentence punctuation. If you greet with "Welcome to ${clinicDesc}", always end the clinic name with a period before the next sentence: "Welcome to ${clinicDesc}. [next sentence]"
- Never ask for information you already have.
- NEVER address the patient by name and never write their name or phone number back to them, even if it appears earlier in the conversation. Always use the formal "you" form of the reply language (Turkish "siz", German "Sie", French "vous", Spanish "usted", Russian "вы", respectful formal Arabic). Greet with a plain "Merhaba" / "Hello" — never a greeting that carries the patient's name or a name-based title.
- Ask a qualification question ONLY when the patient shows treatment or appointment intent (asking a treatment price, asking availability, wanting a treatment, giving a treatment area, asking when they can come, or planning treatment). If the patient asks a purely informational question — clinic location, directions, metro, parking, airport transfer, device brand, Instagram, general clinic info — answer it and leave the conversation open naturally. Do NOT append a qualification question, and do NOT ask for name or phone.
- If asked about pricing, never invent prices or give exact figures. The ONLY exception: a clinic-approved starting price listed in the Clinic context below — share it per that guidance. When no starting price is configured for the matching vertical, use these safe responses (translate naturally when replying in another supported language):
  - Laser/aesthetic — Turkish: "Fiyat bilgisi bölgeye ve seans sayısına göre değişiyor. Net fiyatı ekibimiz sizinle paylaşır."
  - Laser/aesthetic — English: "Pricing depends on the treatment area and number of sessions. Our team will follow up with the exact details."
  - Hair transplant — Turkish: "Fiyat bilgisi greft sayısına ve tedavi planına göre değişiyor. Netleşince ekibimiz size döner."
  - Hair transplant — English: "Pricing depends on the treatment plan and final graft assessment. Our team will follow up with the exact details."
  - Dental — Turkish: "Fiyat bilgisi diş sayısına ve tedavi planına göre değişiyor. Net fiyatı ekibimiz sizinle paylaşır."
  - Dental — English: "Veneer and dental pricing depends on the number of teeth and treatment plan. Our team will follow up with the exact details."
- Never give medical diagnoses or medical advice. Direct clinical questions to the clinic team.
- Never confirm or finalise an appointment yourself. Use "appointment request" or "consultation request", not "confirmed appointment".
- Never claim guaranteed results or that the clinic can definitely perform a procedure.
- When all required information is collected, say: "Thank you. We received your appointment request for [area]. Our clinic team will follow up shortly with available times."
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

// Directive for a purely informational turn: answer, do not qualify, leave open.
const INFORMATIONAL_TASK =
  "The patient's latest message is a purely informational question (location, directions, transfer, parking, devices, Instagram, or preparation). " +
  "Answer it using ONLY the Clinic context above (or the matching fallback rule). " +
  "Do NOT ask a qualification question, do NOT ask whether it is their first time, and do NOT ask for their name, phone, or preferred time in this reply. " +
  "End naturally and leave the conversation open.";

// Directive for messages that arrive AFTER the lead is already complete.
const POST_COMPLETION_TASK =
  "This lead is already captured — the appointment request and contact details are recorded. " +
  "Answer the patient's latest message naturally in the conversation language. " +
  "Do NOT repeat the completion/confirmation message, do NOT send or mention any booking link again, and do NOT ask again for their name or phone. " +
  "If they ask a new question, answer it using the Clinic context; if they mention a new treatment, note it and say the team will follow up.";

function buildQualificationTask(state: ConversationState): string {
  const cat = state.serviceCategory;
  if (cat === "laser") {
    // If the patient asked about availability or already gave a day/time, acknowledge that the
    // clinic team will confirm availability first (never confirm the slot yourself), then ask.
    const ackAvailability =
      state.availabilityInquiry || state.preferredDate || state.preferredTime
        ? "First, briefly acknowledge that you have noted their preferred day/time and the clinic team will confirm availability and follow up — do NOT confirm or guarantee the appointment yourself. Then, in the same message, "
        : "";
    return (
      `${ackAvailability}Ask whether this is the patient's first time having this treatment. Ask nothing else. Reference the patient's OWN stated day/time — never substitute a different day. ` +
      `Use the specific treatment name when known — never a vague generic phrase like "für diese Leistung", "pour cette prestation", or "este tratamiento" when the treatment is laser. Keep the formal register (German "Sie/Ihre", French "vous/votre", Spanish "su") and gender-neutral Arabic wording. ` +
      `Preferred wording — TR: 'Bu işlemi ilk kez mi yaptırıyorsunuz?' EN: 'Would this be your first laser treatment?' DE: 'Ist dies Ihre erste Laserbehandlung?' AR: 'هل هذه أول مرة تجري فيها إزالة الشعر بالليزر؟' RU: 'Вы впервые планируете лазерную эпиляцию?' FR: 'S'agit-il de votre première épilation laser ?' ES: '¿Sería esta su primera sesión de depilación láser?'`
    );
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

export function buildSystemPrompt(state: ConversationState, options?: PromptOptions): string {
  const known: string[] = [];
  // KVKK Art. 6 + Art. 9 (audit finding O-2): the patient's name and phone number are
  // direct identifiers and must NEVER cross the border to the model. Only a captured/
  // not-captured status flag is sent — the literal value stays server-side. This also
  // closes O-3: a patient-supplied name can no longer be written into the system prompt.
  const identifierFlags = [
    `name_collected=${state.name ? "yes" : "no"}`,
    `phone_collected=${state.phone ? "yes" : "no"}`,
  ];
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

  // The identifier flags lead the list, but they must not by themselves turn an empty
  // state into a "Known information" block — a fresh thread still reads as collected-nothing.
  const hasKnown = known.length > 0 || !!state.name || !!state.phone;
  const knownSection = hasKnown
    ? `\nKnown information: ${[...identifierFlags, ...known].join(", ")}`
    : "\nNo information collected yet.";

  const guards: string[] = [];
  // Value-free guards (O-2/O-3): the guard fires on the captured/not-captured flag, so
  // the literal name/phone never reaches the prompt and cannot carry injected instructions.
  if (state.name) guards.push("The patient's name is already recorded — never ask for it again, and never state or repeat it.");
  if (state.phone) guards.push("The patient's phone number is already recorded — never ask for it again, and never state or repeat it.");
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

  // Turn-specific task. Informational and post-completion turns are decided
  // deterministically in the pipeline — the model handles wording, not flow control.
  let nextTask: string;
  if (options?.postCompletion) {
    nextTask = POST_COMPLETION_TASK;
  } else if (options?.informationalTurn) {
    nextTask = INFORMATIONAL_TASK;
  } else if (state.stage === "collect_qualification") {
    nextTask = buildQualificationTask(state);
  } else {
    nextTask = NEXT_FIELD_PROMPT[state.stage];
  }

  const priceDirective = options?.informationalTurn || options?.postCompletion ? "" : startingPriceDirective(state);

  // Context block is built per call (not at module load) so clinic config reads stay
  // current and the block is testable without re-importing the module.
  return `${BASE_PROMPT}${buildClinicContextBlock(state)}${knownSection}${guardSection}\nNext step: ${priceDirective}${nextTask}`;
}

// Legacy export — keeps any remaining static import from breaking
export const SYSTEM_PROMPT = BASE_PROMPT;
