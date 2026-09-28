import { bookingLinkText, SUPPORTED_LANGUAGES } from "./localization";
import { envOrUndefined } from "./env";

export const clinicConfig = {
  name:           envOrUndefined("CLINIC_NAME")            ?? "the clinic",
  primaryService: envOrUndefined("CLINIC_PRIMARY_SERVICE") ?? "laser hair removal",
  defaultLocation:envOrUndefined("CLINIC_DEFAULT_LOCATION") ?? "",
  bookingUrl:     envOrUndefined("CLINIC_BOOKING_URL")      ?? "",
  bookingLinkMessage:
    envOrUndefined("CLINIC_BOOKING_LINK_MESSAGE") ??
    "You can complete your appointment request here: {url}",
  bookingLinkMessageTr:
    envOrUndefined("CLINIC_BOOKING_LINK_MESSAGE_TR") ??
    "Randevu talebinizi buradan tamamlayabilirsiniz: {url}",
  ownerEmail:     envOrUndefined("OWNER_EMAIL")             ?? "",
  // Starting prices — clinic-approved guidance only. Leave empty to use safe pricing fallback.
  startingPrices: {
    laser:         envOrUndefined("STARTING_PRICE_LASER")            ?? "",
    hairTransplant:envOrUndefined("STARTING_PRICE_HAIR_TRANSPLANT")  ?? "",
    dental:        envOrUndefined("STARTING_PRICE_DENTAL")           ?? "",
  },
  // Device/technology brands shown when patient asks. Comma-separated list.
  deviceBrands: envOrUndefined("CLINIC_DEVICE_BRANDS") ?? "",
  // Working hours, free-form clinic-approved text (e.g. "Pazartesi-Cumartesi 09:00-19:00,
  // Pazar kapalı"). Deliberately has NO fallback string: when it is empty the bot must say
  // the team will confirm the hours, never guess a schedule. Read at call time via
  // getWorkingHours() — see the note on getBookingUrl() below.
  workingHours: envOrUndefined("CLINIC_HOURS") ?? "",
  // Location and transportation — shared when patient asks for directions.
  locationInfo: {
    address:          envOrUndefined("CLINIC_ADDRESS")           ?? "",
    district:         envOrUndefined("CLINIC_DISTRICT")          ?? "",
    googleMapsLink:   envOrUndefined("CLINIC_MAPS_LINK")         ?? "",
    nearestTransport: envOrUndefined("CLINIC_NEAREST_TRANSPORT") ?? "",
    parkingAvailable: envOrUndefined("CLINIC_PARKING")           ?? "",
    airportTransfer:  envOrUndefined("CLINIC_AIRPORT_TRANSFER")  ?? "",
  },
  // Pre-treatment notes — generic clinic-approved info only. No medical advice.
  preTreatmentInstructions: {
    laser:         envOrUndefined("PRE_TREATMENT_LASER")            ?? "",
    hairTransplant:envOrUndefined("PRE_TREATMENT_HAIR_TRANSPLANT")  ?? "",
    dental:        envOrUndefined("PRE_TREATMENT_DENTAL")           ?? "",
  },
  // Channel capabilities. Instagram DM is a future channel — not yet live.
  channelCapabilities: {
    whatsapp:    true,
    sms:         true,
    instagramDm: (process.env.INSTAGRAM_DM_ENABLED ?? "false") === "true",
  },
};

// Runtime accessor for the booking URL. Reads process.env at CALL time (inside the
// request handler) instead of relying on the module-level clinicConfig.bookingUrl,
// which is captured once when the module is first evaluated. In a deployed Next.js
// route that captured value can be an empty string (env not present at module-init),
// which silently disabled the booking-link handoff even though CLINIC_BOOKING_URL was
// configured. Trimmed so stray whitespace never makes the guard truthy-but-broken.
export function getBookingUrl(): string {
  return envOrUndefined("CLINIC_BOOKING_URL")?.trim() ?? "";
}

/**
 * Runtime accessor for the clinic's working hours. Same reasoning as getBookingUrl():
 * reads process.env at CALL time, so a value that was not present when this module was
 * first evaluated still reaches the prompt. Returns "" when unset — and "" is a
 * meaningful value here: it switches the bot to the "team will confirm the hours"
 * response instead of inventing a schedule.
 */
export function getWorkingHours(): string {
  return envOrUndefined("CLINIC_HOURS")?.trim() ?? "";
}

// Maps a conversation service category to that vertical's configured starting price.
// Returns "" when the category is unknown or the price is not configured, so callers
// fall back to the safe pricing response. Reads clinicConfig at call time — never
// returns another vertical's price.
export function getStartingPriceFor(serviceCategory: string | undefined): string {
  switch (serviceCategory) {
    case "laser":
      return clinicConfig.startingPrices.laser;
    case "hair_transplant":
      return clinicConfig.startingPrices.hairTransplant;
    case "dental":
      return clinicConfig.startingPrices.dental;
    default:
      return "";
  }
}

// Picks the booking-link message for the active conversation language so the follow-up
// link matches the completion reply. Turkish and English keep the configurable env
// templates (backward compatible); the other supported languages use the localized
// wording so no English boilerplate leaks into a German/Arabic/Russian/French/Spanish
// conversation. Unknown/undefined language → the configured default (English) template.
export function formatBookingLinkMessage(url: string, language?: string): string {
  if (language === "turkish") return clinicConfig.bookingLinkMessageTr.replace("{url}", url);
  if (language === undefined || language === "english" || !(SUPPORTED_LANGUAGES as readonly string[]).includes(language)) {
    return clinicConfig.bookingLinkMessage.replace("{url}", url);
  }
  return bookingLinkText(url, language);
}
