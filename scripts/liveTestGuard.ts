// Refuses to run a test script against live services by accident.
//
// The scripts load .env.local, which on a developer machine usually holds REAL
// credentials. With them present a test run sends real WhatsApp/SMS messages to the
// fixture numbers and writes to the production Redis. Call this right after .env.local
// is loaded and BEFORE any lib module is imported: unless ALLOW_LIVE_TEST=1 is set
// explicitly, any live credential aborts the run.
//
// Run offline by blanking the credentials — the .env.local loaders never override a key
// that already exists in the environment, even an empty one:
//
//   META_WHATSAPP_TOKEN= TWILIO_ACCOUNT_SID= TWILIO_AUTH_TOKEN= \
//   UPSTASH_REDIS_REST_URL= UPSTASH_REDIS_REST_TOKEN= RESEND_API_KEY= npm run test-whatsapp

const LIVE_CREDENTIALS = [
  "META_WHATSAPP_TOKEN",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "RESEND_API_KEY",
] as const;

export function assertNoLiveCredentials(scriptName: string): void {
  if (process.env.ALLOW_LIVE_TEST === "1") {
    console.warn(`[${scriptName}] ALLOW_LIVE_TEST=1 — running against LIVE services.\n`);
    return;
  }
  const present = LIVE_CREDENTIALS.filter((k) => (process.env[k] ?? "").trim() !== "");
  if (present.length === 0) return;

  console.error(
    `\n[${scriptName}] REFUSING TO RUN: live credentials are set (${present.join(", ")}).\n` +
      `This script would send real messages and/or write to the production Redis.\n\n` +
      `Run offline by blanking them for this command:\n` +
      `  ${present.map((k) => `${k}=`).join(" ")} npm run ${scriptName}\n\n` +
      `Or, to deliberately hit live services, set ALLOW_LIVE_TEST=1.\n`
  );
  process.exit(1);
}
