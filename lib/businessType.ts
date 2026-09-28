import { envOrUndefined } from "./env";

// Deployment business type. The codebase is single-tenant: each business runs as its
// own Vercel project with its own env, so the type is a deployment-wide switch.
//
//   BUSINESS_TYPE unset / empty / whitespace → "clinic"  (the original behaviour)
//   BUSINESS_TYPE=clinic                     → "clinic"
//   BUSINESS_TYPE=restaurant                 → "restaurant"
//   anything else                            → "clinic", with a loud log line
//
// Unknown values fall back to clinic rather than failing: every existing deployment
// predates this variable, and a typo must never silently switch a clinic into a mode
// whose KVKK text and reply logic were written for a different business.
//
// Read at CALL time (not module init) for the same reason as getBookingUrl(): a value
// missing when a module was first evaluated must still take effect per request.

export type BusinessType = "clinic" | "restaurant";

export function getBusinessType(): BusinessType {
  const raw = envOrUndefined("BUSINESS_TYPE")?.trim().toLowerCase();
  if (raw === undefined || raw === "clinic") return "clinic";
  if (raw === "restaurant") return "restaurant";
  console.error(`[BusinessType] unknown BUSINESS_TYPE value — falling back to "clinic"`);
  return "clinic";
}

export function isRestaurantMode(): boolean {
  return getBusinessType() === "restaurant";
}
