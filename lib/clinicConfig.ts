export const clinicConfig = {
  name:           process.env.CLINIC_NAME            ?? "the clinic",
  primaryService: process.env.CLINIC_PRIMARY_SERVICE ?? "laser hair removal",
  defaultLocation:process.env.CLINIC_DEFAULT_LOCATION ?? "",
  bookingUrl:     process.env.CLINIC_BOOKING_URL      ?? "",
  bookingLinkMessage:
    process.env.CLINIC_BOOKING_LINK_MESSAGE ??
    "You can complete your appointment request here: {url}",
};

export function formatBookingLinkMessage(url: string): string {
  return clinicConfig.bookingLinkMessage.replace("{url}", url);
}
