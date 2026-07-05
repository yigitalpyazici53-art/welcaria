/**
 * Nurabla Karadeniz Restaurant — isolated webhook intent tests.
 *
 * Usage:
 *   npm run test-nurabla
 *
 * Exercises the pure intent-detection / reply-building logic used by the
 * isolated Twilio WhatsApp webhook (app/api/whatsapp/nurabla/route.ts).
 * Does NOT hit the network or Twilio.
 */

import {
  buildNurablaReply,
  detectNurablaIntent,
  NURABLA,
  NURABLA_FALLBACK,
} from "../lib/businesses/nurabla";

// ── Test helpers ──────────────────────────────────────────────────────────────

let failures = 0;

function pass(label: string, detail = "") {
  console.log(`  PASS  ${label}${detail ? "  (" + detail + ")" : ""}`);
}

function fail(label: string, detail: string) {
  console.error(`  FAIL  ${label}  —  ${detail}`);
  failures++;
}

function assertTrue(label: string, actual: boolean) {
  if (actual) pass(label);
  else fail(label, `expected true, got false`);
}

function assertEqual<T>(label: string, actual: T, expected: T) {
  if (actual === expected) pass(label, String(actual));
  else fail(label, `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

const CEKMEKOY = NURABLA.branches.cekmekoy;
const UMRANIYE = NURABLA.branches.umraniye;
const BASAKSEHIR = NURABLA.branches.basaksehir;

// ── 1. Location returns both Çekmeköy and Başakşehir (never Ümraniye) ──────────
console.log("\n1. Location question");
for (const msg of ["konum", "Adres", "nerede", "Nasıl gelirim?", "yol tarifi", "harita"]) {
  const intent = detectNurablaIntent(msg);
  assertTrue(`"${msg}" → location intent`, intent.location && !intent.menu);
}
{
  const reply = buildNurablaReply("konum");
  assertTrue("location includes Çekmeköy name", reply.includes(CEKMEKOY.name));
  assertTrue("location includes Çekmeköy address", reply.includes(CEKMEKOY.address));
  assertTrue("location includes Çekmeköy maps link", reply.includes(CEKMEKOY.mapsUrl));
  assertTrue("location includes Başakşehir name", reply.includes(BASAKSEHIR.name));
  assertTrue("location includes Başakşehir address", reply.includes(BASAKSEHIR.address));
  assertTrue("location includes Başakşehir maps link", reply.includes(BASAKSEHIR.mapsUrl));
  assertTrue("location omits Ümraniye address", !reply.includes(UMRANIYE.address));
  assertTrue("location omits Ümraniye maps link", !reply.includes(UMRANIYE.mapsUrl));
  assertTrue("location omits menu link", !reply.includes(NURABLA.menuUrl));
}

// ── 2. Menu only ──────────────────────────────────────────────────────────────
console.log("\n2. Menu only");
for (const msg of ["menü", "menu", "MENÜ", "fiyat", "yemekler", "ne var", "kahvaltı"]) {
  const intent = detectNurablaIntent(msg);
  assertTrue(`"${msg}" → menu intent`, intent.menu && !intent.location);
}
{
  const reply = buildNurablaReply("menü");
  assertEqual("menu-only reply", reply, `Menümüz: ${NURABLA.menuUrl}`);
  assertTrue("menu-only omits any branch address", !reply.includes(CEKMEKOY.address));
}

// ── 3. Menu + location ────────────────────────────────────────────────────────
console.log("\n3. Menu + location");
{
  const reply = buildNurablaReply("menü ve konum lütfen");
  assertTrue("contains menu link", reply.includes(NURABLA.menuUrl));
  assertTrue("contains Çekmeköy address", reply.includes(CEKMEKOY.address));
  assertTrue("contains Çekmeköy maps link", reply.includes(CEKMEKOY.mapsUrl));
  assertTrue("contains Başakşehir address", reply.includes(BASAKSEHIR.address));
  assertTrue("contains Başakşehir maps link", reply.includes(BASAKSEHIR.mapsUrl));
  assertTrue("omits Ümraniye", !reply.includes(UMRANIYE.address));
}

// ── 4. Unsupported question → phone fallback ──────────────────────────────────
console.log("\n4. Unsupported question");
for (const msg of ["rezervasyon yapmak istiyorum", "teşekkürler", "iş başvurusu"]) {
  const intent = detectNurablaIntent(msg);
  assertTrue(`"${msg}" → no intent`, !intent.location && !intent.menu);
  assertEqual(`"${msg}" → phone fallback`, buildNurablaReply(msg), NURABLA_FALLBACK);
}
assertEqual(
  "phone fallback exact text",
  NURABLA_FALLBACK,
  "Bu konuda Nurabla ekibimiz size yardımcı olabilir.\n\n" +
    "📞 Çekmeköy: 0216 642 53 10\n" +
    "📞 Başakşehir: 0212 809 01 77"
);

// ── 5. Empty input → phone fallback ───────────────────────────────────────────
console.log("\n5. Empty message");
for (const msg of ["", "   "]) {
  const intent = detectNurablaIntent(msg);
  assertTrue(`empty (${JSON.stringify(msg)}) → no intent`, !intent.location && !intent.menu);
  assertEqual(`empty (${JSON.stringify(msg)}) → phone fallback`, buildNurablaReply(msg), NURABLA_FALLBACK);
}

// ── 6. Informal / typo'd menu phrasing ────────────────────────────────────────
console.log("\n6. Informal menu phrasing");
for (const msg of [
  "fiayt nedir",
  "fiat listesi",
  "ne kadar",
  "neler var",
  "menuyu at",
  "menuu gönder",
]) {
  const intent = detectNurablaIntent(msg);
  assertTrue(`"${msg}" → menu intent`, intent.menu);
  assertTrue(`"${msg}" → not location`, !intent.location);
}

// ── 7. Informal / typo'd location phrasing ────────────────────────────────────
console.log("\n7. Informal location phrasing");
for (const msg of [
  "yer neresi",
  "yeriniz nerde",
  "knoum atar mısınız",
  "aders nedir",
  "hangi tarafta",
  "mekan nerede",
]) {
  const intent = detectNurablaIntent(msg);
  assertTrue(`"${msg}" → location intent`, intent.location);
  assertTrue(`"${msg}" → not menu`, !intent.menu);
}

// ── 8. False positives must not trigger any intent ────────────────────────────
console.log("\n8. False positives");
for (const msg of [
  "iş yeri başvurusu",
  "rezervasyon var mı",
  "eleman arıyor musunuz",
  "sipariş verebilir miyim",
]) {
  const intent = detectNurablaIntent(msg);
  assertTrue(`"${msg}" → no intent`, !intent.location && !intent.menu);
  assertEqual(`"${msg}" → phone fallback`, buildNurablaReply(msg), NURABLA_FALLBACK);
}

// ── 9. Combined menu + location with typos ────────────────────────────────────
console.log("\n9. Menu + location with typos");
{
  const msg = "fiayt ve knoum atar mısınız";
  const intent = detectNurablaIntent(msg);
  assertTrue(`"${msg}" → both intents`, intent.location && intent.menu);
  const reply = buildNurablaReply(msg);
  assertTrue("contains menu link", reply.includes(NURABLA.menuUrl));
  assertTrue("contains Çekmeköy address", reply.includes(CEKMEKOY.address));
  assertTrue("contains Başakşehir address", reply.includes(BASAKSEHIR.address));
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log("");
if (failures > 0) {
  console.error(`FAILED — ${failures} assertion(s) failed`);
  process.exit(1);
} else {
  console.log("ALL PASSED");
  process.exit(0);
}
