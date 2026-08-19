// Shared gate for the /api/test/* diagnostic endpoints.
//
// These routes read and write real conversation state and can forge an inbound
// message (which refreshes compliance:lastInbound and thereby opens the 24h
// WhatsApp send window). They must exist ONLY on a developer's machine.
//
// This is an allow-list and it fails CLOSED. The previous guard only excluded
// VERCEL_ENV === "production", which left the endpoints fully live on every
// preview deployment — and previews normally inherit production's Upstash and
// Meta credentials. A missing VERCEL_ENV (self-hosted / `next start`) is NOT
// treated as development either: it must be paired with NODE_ENV=development,
// which `next dev` sets and a production build never does.
export function isLocalDevelopment(): boolean {
  const vercelEnv = process.env.VERCEL_ENV;
  if (vercelEnv) return vercelEnv === "development";
  return process.env.NODE_ENV === "development";
}
