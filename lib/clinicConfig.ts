export const clinicConfig = {
  name:           process.env.CLINIC_NAME            ?? "the clinic",
  primaryService: process.env.CLINIC_PRIMARY_SERVICE ?? "laser hair removal",
  defaultLocation:process.env.CLINIC_DEFAULT_LOCATION ?? "",
  bookingUrl:     process.env.CLINIC_BOOKING_URL      ?? "",
  bookingLinkMessage:
    process.env.CLINIC_BOOKING_LINK_MESSAGE ??
    "You can complete your appointment request here: {url}",
  bookingLinkMessageTr:
    process.env.CLINIC_BOOKING_LINK_MESSAGE_TR ??
    "Randevu talebinizi buradan tamamlayabilirsiniz: {url}",
  ownerEmail:     process.env.OWNER_EMAIL             ?? "",
  // Starting prices — clinic-approved guidance only. Leave empty to use safe pricing fallback.
  startingPrices: {
    laser:         process.env.STARTING_PRICE_LASER            ?? "",
    hairTransplant:process.env.STARTING_PRICE_HAIR_TRANSPLANT  ?? "",
    dental:        process.env.STARTING_PRICE_DENTAL           ?? "",
  },
  // Device/technology brands shown when patient asks. Comma-separated list.
  deviceBrands: process.env.CLINIC_DEVICE_BRANDS ?? "",
  // Location and transportation — shared when patient asks for directions.
  locationInfo: {
    address:          process.env.CLINIC_ADDRESS           ?? "",
    district:         process.env.CLINIC_DISTRICT          ?? "",
    googleMapsLink:   process.env.CLINIC_MAPS_LINK         ?? "",
    nearestTransport: process.env.CLINIC_NEAREST_TRANSPORT ?? "",
    parkingAvailable: process.env.CLINIC_PARKING           ?? "",
    airportTransfer:  process.env.CLINIC_AIRPORT_TRANSFER  ?? "",
  },
  // Pre-treatment notes — generic clinic-approved info only. No medical advice.
  preTreatmentInstructions: {
    laser:         process.env.PRE_TREATMENT_LASER            ?? "",
    hairTransplant:process.env.PRE_TREATMENT_HAIR_TRANSPLANT  ?? "",
    dental:        process.env.PRE_TREATMENT_DENTAL           ?? "",
  },
  // Channel capabilities. Instagram DM is a future channel — not yet live.
  channelCapabilities: {
    whatsapp:    true,
    sms:         true,
    instagramDm: (process.env.INSTAGRAM_DM_ENABLED ?? "false") === "true",
  },
};

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

// Picks the booking-link message template for the active conversation language so the
// follow-up link matches the completion reply. Turkish → Turkish template; every other
// language (and unknown/undefined) → the configured default template.
export function formatBookingLinkMessage(url: string, language?: string): string {
  const template =
    language === "turkish"
      ? clinicConfig.bookingLinkMessageTr
      : clinicConfig.bookingLinkMessage;
  return template.replace("{url}", url);
}
