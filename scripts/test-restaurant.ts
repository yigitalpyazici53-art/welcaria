/**
 * Restaurant mode (BUSINESS_TYPE=restaurant) test suite.
 *
 * Usage:
 *   npm run test-restaurant
 *
 * Fully offline and hermetic: does NOT load .env.local, blanks every live credential,
 * runs on the in-memory state/compliance stores, and replaces the model call with a
 * stub (so no Anthropic request is made). Owner alerts use injected transports.
 *
 * Covers: BUSINESS_TYPE parsing, empty-env-as-unset readers, menu question, unknown
 * product (no invention), reservation flow, takeaway order, empty RESTAURANT_INFO_TEXT,
 * KVKK disclosure-first + fail-closed, handoff + owner alert, identifier redaction,
 * and that clinic mode is unaffected.
 */

// ── Hermetic env — BEFORE any lib import ─────────────────────────────────────
for (const k of [
  "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN",
  "META_WHATSAPP_TOKEN", "META_WHATSAPP_PHONE_NUMBER_ID",
  "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_PHONE_NUMBER",
  "ANTHROPIC_API_KEY", "RESEND_API_KEY", "COMPLIANCE_FORCE_CIRCUIT_OPEN",
  "BUSINESS_TYPE", "RESTAURANT_INFO_TEXT", "RESTAURANT_ORDER_INFO", "RESTAURANT_KVKK_TEXT",
  "OWNER_PHONE",
]) {
  delete process.env[k];
}
process.env.COMPLIANCE_THREAD_MIN_GAP_SECONDS = "0";
process.env.COMPLIANCE_TENANT_RATE_PER_SECOND = "1000";

import { getBusinessType } from "../lib/businessType";
import {
  getRestaurantInfoText,
  getRestaurantOrderInfo,
  getRestaurantKvkkText,
  DEFAULT_RESTAURANT_KVKK_TEXT,
} from "../lib/restaurant/config";
import { detectRestaurantIntent, extractReservationDetails } from "../lib/restaurant/intent";
import { findUngroundedFacts } from "../lib/restaurant/grounding";
import { RESTAURANT_HANDOFF_REPLY, _setRestaurantReplyGeneratorForTest } from "../lib/restaurant/pipeline";
import { completeRestaurantHandoff, buildRestaurantOwnerAlert } from "../lib/restaurant/handoff";
import { processInboundMessage, recordConsentDisclosureResult } from "../lib/inboundPipeline";
import { getState, resetStateForTest } from "../lib/conversationState";
import { recordInboundMessage, _resetComplianceForTest } from "../lib/compliance";
import { consentWelcome, consentDisclosure } from "../lib/localization";
import { isDuplicateMessage } from "../lib/messageDedup";

// Call counters on the clinic controller. The pipeline calls these through the CommonJS
// exports object, so wrapping the export observes every production call.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const slotModule = require("../lib/slotExtractor");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const intentModule = require("../lib/classifyIntent");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const anthropicModule = require("../lib/anthropic");
const clinicCalls = { extractSlots: 0, classifyIntent: 0, generateSmsReply: 0 };
for (const [mod, name] of [
  [slotModule, "extractSlots"],
  [intentModule, "classifyIntent"],
  [anthropicModule, "generateSmsReply"],
] as const) {
  const original = mod[name];
  mod[name] = (...args: unknown[]) => {
    clinicCalls[name as keyof typeof clinicCalls]++;
    return original(...args);
  };
}
function resetClinicCalls() {
  clinicCalls.extractSlots = 0;
  clinicCalls.classifyIntent = 0;
  clinicCalls.generateSmsReply = 0;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

let failures = 0;
function pass(label: string, detail = "") {
  console.log(`  PASS  ${label}${detail ? "  (" + detail + ")" : ""}`);
}
function fail(label: string, detail: string) {
  console.error(`  FAIL  ${label}  —  ${detail}`);
  failures++;
}
function assertEqual<T>(label: string, actual: T, expected: T) {
  if (actual === expected) pass(label, String(actual));
  else fail(label, `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}
function assertTrue(label: string, actual: boolean, detail = "") {
  if (actual) pass(label);
  else fail(label, detail || "expected true, got false");
}
function assertContains(label: string, haystack: string, needle: string) {
  if (haystack.includes(needle)) pass(label, `found "${needle}"`);
  else fail(label, `"${needle}" not found in "${haystack}"`);
}
function assertNotContains(label: string, haystack: string, needle: string) {
  if (!haystack.toLocaleLowerCase("tr-TR").includes(needle.toLocaleLowerCase("tr-TR"))) pass(label, `absent: "${needle}"`);
  else fail(label, `"${needle}" unexpectedly found in "${haystack}"`);
}
function section(title: string) {
  console.log(`\n── ${title} ──`);
}

const INFO_TEXT = [
  "Aile Sofrası — Kadıköy",
  "Menü: Mercimek çorbası 120 TL, Karnıyarık 280 TL, Adana kebap 390 TL, Künefe 180 TL.",
  "Çalışma saatleri: Her gün 11:00-23:00, Pazartesi kapalı.",
  "Adres: Caferağa Mah. Moda Cad. No:12 Kadıköy/İstanbul. Kadıköy iskelesine 10 dakika yürüme.",
  "Telefon: 0216 555 12 34",
].join("\n");

// Model stub: records calls, returns a scripted reply.
const gen = { calls: 0, lastSystem: "", reply: "" as string | Error };
_setRestaurantReplyGeneratorForTest(async (_msg, _state, system) => {
  gen.calls++;
  gen.lastSystem = system;
  if (gen.reply instanceof Error) throw gen.reply;
  return gen.reply;
});

let phoneSeq = 0;
function newPhone(): string {
  phoneSeq++;
  return `90555000${String(phoneSeq).padStart(4, "0")}`;
}

// A thread whose KVKK disclosure was confirmed delivered, with an inbound on record.
async function consentedThread(): Promise<string> {
  const from = newPhone();
  await resetStateForTest(from);
  await recordConsentDisclosureResult(from, true);
  return from;
}

// null → RESTAURANT_INFO_TEXT removed from the environment entirely.
function restaurantEnv(info: string | null = INFO_TEXT) {
  process.env.BUSINESS_TYPE = "restaurant";
  if (info === null) delete process.env.RESTAURANT_INFO_TEXT;
  else process.env.RESTAURANT_INFO_TEXT = info;
  delete process.env.RESTAURANT_ORDER_INFO;
  delete process.env.RESTAURANT_KVKK_TEXT;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== test-restaurant ===");

  section("1. BUSINESS_TYPE parsing (empty = unset = clinic)");
  const cases: Array<[string | undefined, string]> = [
    [undefined, "clinic"], ["", "clinic"], ["   ", "clinic"], ["clinic", "clinic"],
    ["restaurant", "restaurant"], [" Restaurant ", "restaurant"], ["restoran", "clinic"],
  ];
  for (const [raw, expected] of cases) {
    if (raw === undefined) delete process.env.BUSINESS_TYPE;
    else process.env.BUSINESS_TYPE = raw;
    assertEqual(`BUSINESS_TYPE=${JSON.stringify(raw)}`, getBusinessType(), expected);
  }
  delete process.env.BUSINESS_TYPE;

  section("2. Restaurant config readers treat empty/whitespace as unset");
  process.env.RESTAURANT_INFO_TEXT = "   ";
  assertEqual("INFO whitespace → \"\"", getRestaurantInfoText(), "");
  process.env.RESTAURANT_ORDER_INFO = "";
  assertEqual("ORDER empty → \"\"", getRestaurantOrderInfo(), "");
  process.env.RESTAURANT_KVKK_TEXT = "  \n ";
  assertEqual("KVKK whitespace → default", getRestaurantKvkkText(), DEFAULT_RESTAURANT_KVKK_TEXT);
  process.env.RESTAURANT_KVKK_TEXT = "Özel metin.";
  assertEqual("KVKK set → used", getRestaurantKvkkText(), "Özel metin.");
  delete process.env.RESTAURANT_INFO_TEXT;
  delete process.env.RESTAURANT_ORDER_INFO;
  delete process.env.RESTAURANT_KVKK_TEXT;

  section("3. Intent detection + reservation extraction (unit)");
  assertEqual("rezervasyon → reservation", detectRestaurantIntent("Rezervasyon yapmak istiyorum"), "reservation");
  assertEqual("masa ayırtmak → reservation", detectRestaurantIntent("Cumartesi için masa ayırtabilir miyiz?"), "reservation");
  assertEqual("implicit: day + party → reservation", detectRestaurantIntent("Yarın akşam 4 kişi gelebilir miyiz"), "reservation");
  assertEqual("paket → order", detectRestaurantIntent("Paket servisiniz var mı?"), "order");
  assertEqual("sipariş → order", detectRestaurantIntent("Eve sipariş vermek istiyorum"), "order");
  assertEqual("menu → info", detectRestaurantIntent("Menüde neler var?"), "info");
  assertEqual("hours → info", detectRestaurantIntent("Kaça kadar açıksınız?"), "info");
  assertEqual("masaj ≠ masa", detectRestaurantIntent("masaj salonu mu burası"), "info");
  let d = extractReservationDetails("Yarın 19:30 için 4 kişilik masa");
  assertEqual("date yarın", d.date, "Yarın");
  assertEqual("time 19:30", d.time, "19:30");
  assertEqual("party 4", d.partySize, "4");
  d = extractReservationDetails("12.10 akşam 8'de dört kişiyiz");
  assertEqual("date 12.10 (not a time)", d.date, "12.10");
  assertEqual("time akşam 8", d.time, "akşam 8");
  assertEqual("party dört → 4", d.partySize, "4");
  d = extractReservationDetails("Cumartesi saat 20.00, 2 yetişkin 1 çocuk");
  assertEqual("weekday Cumartesi", d.date, "Cumartesi");
  assertEqual("time saat 20.00", d.time, "saat 20.00");
  assertEqual("composite party", d.partySize, "2 yetişkin 1 çocuk");
  assertEqual("bare '4' only when awaiting party", extractReservationDetails("4", "partySize").partySize, "4");
  assertEqual("bare '4' ignored otherwise", extractReservationDetails("4").partySize, undefined);
  assertEqual("bare '20:00' when awaiting time", extractReservationDetails("20:00", "time").time, "20:00");

  section("4. Grounding check (unit)");
  assertEqual("price in info → grounded", findUngroundedFacts("Karnıyarık 280 TL.", [INFO_TEXT]).length, 0);
  assertEqual("reformatted hours → grounded", findUngroundedFacts("11.00 ile 23:00 arası açığız.", [INFO_TEXT]).length, 0);
  assertEqual("invented price → rejected", findUngroundedFacts("Kuzu tandır 450 TL.", [INFO_TEXT]).join(","), "450");
  assertEqual("invented hour → rejected", findUngroundedFacts("Gece 01:00'e kadar açığız.", [INFO_TEXT]).join(","), "01:00");
  assertEqual("phone verbatim → grounded", findUngroundedFacts("Bizi 0216 555 12 34'ten arayabilirsiniz.", [INFO_TEXT]).length, 0);
  assertEqual("customer's own number echoed → grounded", findUngroundedFacts("6 kişilik menü için", [INFO_TEXT, "6 kişi geleceğiz"]).length, 0);

  section("5. KVKK disclosure-first in restaurant mode (+ fail-closed)");
  restaurantEnv();
  resetClinicCalls();
  gen.calls = 0;
  {
    const from = newPhone();
    await resetStateForTest(from);
    const r1 = await processInboundMessage({ from, body: "Merhaba, menüde neler var?", source: "whatsapp" });
    assertTrue("first message → awaitingConsent", r1.awaitingConsent);
    assertTrue("consentMessage present", !!r1.consentMessage);
    const msg = r1.consentMessage ?? "";
    assertContains("default restaurant KVKK text used", msg, DEFAULT_RESTAURANT_KVKK_TEXT);
    for (const word of ["hasta", "sağlık", "patient", "tedavi", "klinik"]) {
      assertNotContains(`disclosure has no "${word}"`, msg, word);
    }
    assertEqual("no bot reply on disclosure turn", r1.assistantReply, "");
    assertEqual("no model call on disclosure turn", gen.calls, 0);
    assertEqual("no owner alert on first contact", r1.shouldNotifyOwner, false);
    assertEqual("no handoff on disclosure turn", r1.requestHandoff, false);
    assertEqual("customer text not stored", (await getState(from)).history.length, 0);

    // Disclosure send blocked/failed → the gate stays closed on the next message.
    await recordConsentDisclosureResult(from, false);
    const r2 = await processInboundMessage({ from, body: "Menüyü alabilir miyim?", source: "whatsapp" });
    assertTrue("failed disclosure → still gated (retry)", r2.awaitingConsent);
    assertEqual("still no model call", gen.calls, 0);

    // Delivered → next message is processed.
    await recordConsentDisclosureResult(from, true);
    gen.reply = "Mercimek çorbası 120 TL, Karnıyarık 280 TL.";
    const r3 = await processInboundMessage({ from, body: "Menüyü alabilir miyim?", source: "whatsapp" });
    assertEqual("after confirmed disclosure → processed", r3.awaitingConsent, false);
    assertEqual("model called once", gen.calls, 1);
  }
  {
    process.env.RESTAURANT_KVKK_TEXT = "Kişisel verileriniz yalnızca talebinizi yanıtlamak için işlenir.";
    const from = newPhone();
    await resetStateForTest(from);
    const r = await processInboundMessage({ from, body: "selam" });
    assertContains("RESTAURANT_KVKK_TEXT used when set", r.consentMessage ?? "", "yalnızca talebinizi yanıtlamak");
    delete process.env.RESTAURANT_KVKK_TEXT;
  }

  section("6. Menu question — answered from RESTAURANT_INFO_TEXT, clinic controller unused");
  restaurantEnv();
  resetClinicCalls();
  gen.calls = 0;
  {
    const from = await consentedThread();
    gen.reply = "Menümüzde Mercimek çorbası 120 TL, Adana kebap 390 TL ve Künefe 180 TL var.";
    const r = await processInboundMessage({ from, body: "Menüde neler var, fiyatlar nasıl?", source: "whatsapp" });
    assertEqual("reply is the grounded model answer", r.assistantReply, gen.reply);
    assertEqual("no handoff", r.requestHandoff, false);
    assertEqual("intent restaurant_info", r.intent, "restaurant_info");
    assertContains("system prompt carries the info text", gen.lastSystem, "Adana kebap 390 TL");
    assertEqual("extractSlots never called", clinicCalls.extractSlots, 0);
    assertEqual("classifyIntent never called", clinicCalls.classifyIntent, 0);
    assertEqual("generateSmsReply never called", clinicCalls.generateSmsReply, 0);
    const st = await getState(from);
    assertEqual("clinic stage untouched", st.stage, "collect_treatment_area");
    assertEqual("no serviceCategory captured", st.serviceCategory, undefined);
    assertEqual("no Sheets logging", r.shouldLogToSheet, false);
    assertEqual("history: user + assistant", st.history.length, 2);
  }

  section("7. Unknown product — no invention, handoff");
  restaurantEnv();
  for (const [label, modelReply, reason] of [
    ["model returns sentinel", "[[DEVRET]]", "info_missing"],
    ["model invents a price", "Kuzu tandır 450 TL, çok lezzetlidir.", "ungrounded_reply"],
    ["model invents opening hours", "Cumartesi 01:00'e kadar açığız.", "ungrounded_reply"],
    ["model returns empty text", "", "info_missing"],
  ] as const) {
    const from = await consentedThread();
    gen.reply = modelReply;
    const r = await processInboundMessage({ from, body: "Kuzu tandırınız var mı, kaç lira?" });
    assertEqual(`${label} → handoff reply`, r.assistantReply, RESTAURANT_HANDOFF_REPLY);
    assertTrue(`${label} → requestHandoff`, r.requestHandoff);
    assertEqual(`${label} → reason`, r.stateAfter.restaurantHandoffReason, reason);
    assertNotContains(`${label} → invented figure not sent`, r.assistantReply, "450");
  }
  {
    const from = await consentedThread();
    gen.reply = new Error("upstream 529");
    const r = await processInboundMessage({ from, body: "Otopark var mı?" });
    assertTrue("model error → handoff", r.requestHandoff);
    assertEqual("model error → reason ai_unavailable", r.stateAfter.restaurantHandoffReason, "ai_unavailable");
  }
  {
    // Real generator path (no stub) without ANTHROPIC_API_KEY: throws before any
    // network call → handoff, never a static guess.
    _setRestaurantReplyGeneratorForTest(null);
    const from = await consentedThread();
    const r = await processInboundMessage({ from, body: "Vejetaryen yemeğiniz var mı?" });
    assertTrue("no API key → handoff", r.requestHandoff);
    assertEqual("no API key → reason ai_unavailable", r.stateAfter.restaurantHandoffReason, "ai_unavailable");
    _setRestaurantReplyGeneratorForTest(async (_m, _s, system) => {
      gen.calls++;
      gen.lastSystem = system;
      if (gen.reply instanceof Error) throw gen.reply;
      return gen.reply;
    });
  }

  section("8. Empty RESTAURANT_INFO_TEXT → direct handoff, model never called");
  for (const [label, value] of [["unset", null], ["empty", ""], ["whitespace", "  \n  "]] as const) {
    restaurantEnv(value);
    gen.calls = 0;
    gen.reply = "Adana kebap 390 TL.";
    const from = await consentedThread();
    const r = await processInboundMessage({ from, body: "Adana kebap ne kadar?" });
    assertEqual(`info ${label} → handoff reply`, r.assistantReply, RESTAURANT_HANDOFF_REPLY);
    assertEqual(`info ${label} → reason`, r.stateAfter.restaurantHandoffReason, "info_not_configured");
    assertEqual(`info ${label} → model not called`, gen.calls, 0);
  }

  section("9. Reservation flow (multi-turn) → owner alert + handoff, never confirmed");
  restaurantEnv("");  // reservations work even without an info text
  gen.calls = 0;
  {
    const from = await consentedThread();
    let r = await processInboundMessage({ from, body: "Rezervasyon yapmak istiyorum" });
    assertContains("asks for the day", r.assistantReply, "Hangi gün");
    assertEqual("no handoff yet", r.requestHandoff, false);
    r = await processInboundMessage({ from, body: "Cumartesi" });
    assertContains("asks for the time", r.assistantReply, "Saat kaç");
    r = await processInboundMessage({ from, body: "akşam 8 gibi" });
    assertContains("asks for party size", r.assistantReply, "Kaç kişi");
    r = await processInboundMessage({ from, body: "4" });
    assertTrue("complete → requestHandoff", r.requestHandoff);
    assertEqual("reason reservation", r.stateAfter.restaurantHandoffReason, "reservation");
    assertContains("summary has day", r.assistantReply, "Cumartesi");
    assertContains("summary has time", r.assistantReply, "akşam 8");
    assertContains("summary has party", r.assistantReply, "4 kişi");
    assertContains("tells the customer it is forwarded", r.assistantReply, "işletmeye iletiyorum");
    for (const w of ["onaylandı", "onayladık", "confirmed", "kesinleşti"]) {
      assertNotContains(`never "${w}"`, r.assistantReply, w);
    }
    assertEqual("model never called for reservations", gen.calls, 0);
    assertEqual("inbox mirror: preferredDate", r.stateAfter.preferredDate, "Cumartesi");
    assertEqual("flow reset after handoff", r.stateAfter.restaurantFlow, "none");

    const alert = buildRestaurantOwnerAlert(from, r.stateAfter);
    assertContains("alert: title", alert, "Yeni rezervasyon talebi");
    assertContains("alert: customer number", alert, `+${from}`);
    assertContains("alert: date", alert, "Tarih: Cumartesi");
    assertContains("alert: time", alert, "Saat: akşam 8");
    assertContains("alert: party", alert, "Kişi: 4 kişi");
  }
  {
    const from = await consentedThread();
    const r = await processInboundMessage({ from, body: "Yarın 19:30 için 4 kişilik masa ayırtmak istiyorum" });
    assertTrue("single message with all details → handoff", r.requestHandoff);
    assertContains("single message summary", r.assistantReply, "Yarın, 19:30, 4 kişi");
  }
  {
    const from = await consentedThread();
    await processInboundMessage({ from, body: "Rezervasyon lütfen" });
    let r = await processInboundMessage({ from, body: "hmm bilmiyorum" });
    assertEqual("1st no-progress turn → re-ask", r.requestHandoff, false);
    assertContains("re-ask apologises", r.assistantReply, "tam anlayamadım");
    r = await processInboundMessage({ from, body: "sonra bakarız belki" });
    assertTrue("2nd no-progress turn → handoff", r.requestHandoff);
    assertEqual("stalled reason", r.stateAfter.restaurantHandoffReason, "reservation_stalled");
  }
  {
    const from = await consentedThread();
    await processInboundMessage({ from, body: "Rezervasyon yapmak istiyorum" });
    const r = await processInboundMessage({ from, body: "vazgeçtim" });
    assertEqual("cancel → no handoff", r.requestHandoff, false);
    assertContains("cancel acknowledged", r.assistantReply, "iptal ettim");
    assertEqual("cancel → flow reset", r.stateAfter.restaurantFlow, "none");
  }

  section("10. Takeaway order");
  restaurantEnv();
  {
    process.env.RESTAURANT_ORDER_INFO = "Paket sipariş için Yemeksepeti'nde 'Aile Sofrası Kadıköy' aratabilirsiniz.\nTelefon: 0216 555 12 34";
    gen.calls = 0;
    const from = await consentedThread();
    const r = await processInboundMessage({ from, body: "Paket sipariş vermek istiyorum" });
    assertEqual("order info sent verbatim (line break kept)", r.assistantReply, process.env.RESTAURANT_ORDER_INFO);
    assertEqual("order → no handoff", r.requestHandoff, false);
    assertEqual("order → model not called", gen.calls, 0);
  }
  {
    process.env.RESTAURANT_ORDER_INFO = "   ";
    const from = await consentedThread();
    const r = await processInboundMessage({ from, body: "Eve sipariş verebilir miyim?" });
    assertTrue("order info empty → handoff", r.requestHandoff);
    assertEqual("order reason", r.stateAfter.restaurantHandoffReason, "order_not_configured");
    delete process.env.RESTAURANT_ORDER_INFO;
  }

  section("11. Handoff: bot paused ALWAYS, owner alert via Meta through the compliance gate");
  restaurantEnv();
  await _resetComplianceForTest();
  const OWNER = "905559990000";
  {
    // Owner never wrote to the business number → gate blocks the Meta alert; no Twilio.
    process.env.OWNER_PHONE = `+${OWNER}`;
    const from = await consentedThread();
    await recordInboundMessage(from, "tenant-test");
    const r = await processInboundMessage({ from, body: "Yarın 20:00 3 kişi rezervasyon" });
    const metaSent: Array<{ to: string; body: string }> = [];
    const h = await completeRestaurantHandoff(
      { from, state: r.stateAfter, tenantId: "tenant-test" },
      { metaTransport: async (to, body) => { metaSent.push({ to, body }); } }
    );
    assertEqual("handoff applied", h.handoffApplied, true);
    assertEqual("owner not notified (no owner inbound)", h.ownerNotified, false);
    assertEqual("Meta transport not reached", metaSent.length, 0);
    assertContains("reason names the gate verdict", h.notDeliveredReason ?? "", "meta_blocked_no_inbound_history");
    assertContains("reason names missing Twilio", h.notDeliveredReason ?? "", "sms_not_configured");
    assertEqual("humanHandoff set in state", (await getState(from)).humanHandoff, true);

    // Paused thread: nothing generated, nothing sent to the model, message kept for the inbox.
    gen.calls = 0;
    const p = await processInboundMessage({ from, body: "Merhaba, cevap bekliyorum" });
    assertEqual("paused → empty reply", p.assistantReply, "");
    assertEqual("paused → no new handoff", p.requestHandoff, false);
    assertEqual("paused → model not called", gen.calls, 0);
    assertEqual("paused → still humanHandoff", p.stateAfter.humanHandoff, true);
    assertEqual("paused → message stored for inbox",
      p.stateAfter.history[p.stateAfter.history.length - 1]?.content, "Merhaba, cevap bekliyorum");
  }
  {
    // Owner wrote in the last 24h → Meta alert goes out.
    await recordInboundMessage(OWNER, "tenant-test");
    const from = await consentedThread();
    const r = await processInboundMessage({ from, body: "Cuma 21:00 için 2 kişilik masa" });
    const metaSent: Array<{ to: string; body: string }> = [];
    const h = await completeRestaurantHandoff(
      { from, state: r.stateAfter, tenantId: "tenant-test" },
      { metaTransport: async (to, body) => { metaSent.push({ to, body }); } }
    );
    assertEqual("owner notified via meta", h.channel, "meta");
    assertEqual("sent to OWNER_PHONE digits", metaSent[0]?.to, OWNER);
    assertContains("alert carries party size", metaSent[0]?.body ?? "", "Kişi: 2 kişi");
    assertContains("alert carries time", metaSent[0]?.body ?? "", "Saat: 21:00");
  }
  {
    // Kill switch blocks the Meta alert too; Twilio fallback (when configured) delivers.
    process.env.COMPLIANCE_FORCE_CIRCUIT_OPEN = "true";
    gen.reply = "[[DEVRET]]";
    const from = await consentedThread();
    const r = await processInboundMessage({ from, body: "Kuzu tandır var mı?" });
    const sms: string[] = [];
    const h = await completeRestaurantHandoff(
      { from, state: r.stateAfter, tenantId: "tenant-test" },
      { metaTransport: async () => { throw new Error("must not be called"); }, smsTransport: async (_to, b) => { sms.push(b); } }
    );
    assertEqual("kill switch → meta blocked, sms fallback", h.channel, "sms");
    assertContains("fallback alert has the question", sms[0] ?? "", "Kuzu tandır var mı?");
    assertEqual("handoff still applied", h.handoffApplied, true);
    delete process.env.COMPLIANCE_FORCE_CIRCUIT_OPEN;
  }
  {
    // No OWNER_PHONE at all → only logged, handoff still applied.
    delete process.env.OWNER_PHONE;
    const from = await consentedThread();
    const r = await processInboundMessage({ from, body: "Rezervasyon: yarın 20:00 5 kişi" });
    const h = await completeRestaurantHandoff({ from, state: r.stateAfter });
    assertEqual("no OWNER_PHONE → not notified", h.ownerNotified, false);
    assertEqual("no OWNER_PHONE → reason", h.notDeliveredReason, "no_owner_phone");
    assertEqual("no OWNER_PHONE → handoff applied", (await getState(from)).humanHandoff, true);
  }

  section("12. Identifier redaction on restaurant model replies");
  restaurantEnv();
  {
    const from = await consentedThread();
    gen.reply = `Numaranız +${from} kaydedildi. Künefe 180 TL.`;
    const r = await processInboundMessage({ from, body: "Künefe kaç para?" });
    assertNotContains("customer number removed", r.assistantReply, from.slice(-7));
    assertContains("rest of the answer kept", r.assistantReply, "Künefe 180 TL");
    assertEqual("no handoff after redaction", r.requestHandoff, false);
  }

  section("13. Webhook dedup unaffected");
  assertEqual("first claim is fresh", await isDuplicateMessage("wamid.restaurant-test-1", "[test]"), false);
  assertEqual("retry is a duplicate", await isDuplicateMessage("wamid.restaurant-test-1", "[test]"), true);

  section("14. Clinic mode unaffected (BUSINESS_TYPE unset)");
  delete process.env.BUSINESS_TYPE;
  process.env.RESTAURANT_INFO_TEXT = INFO_TEXT;  // present but must be ignored
  resetClinicCalls();
  gen.calls = 0;
  {
    const from = newPhone();
    await resetStateForTest(from);
    const r = await processInboundMessage({ from, body: "Merhaba, lazer epilasyon fiyatı nedir?" });
    const lang = r.stateAfter.detectedLanguage;
    assertEqual("clinic disclosure text byte-identical",
      r.consentMessage, `${consentWelcome(lang)}\n\n${consentDisclosure(lang)}`);
    assertContains("clinic disclosure still names the patient intake system", r.consentMessage ?? "", "hasta");
    assertEqual("clinic first contact still alerts owner", r.shouldNotifyOwner, true);
    assertEqual("clinic requestHandoff false", r.requestHandoff, false);

    await recordConsentDisclosureResult(from, true);
    const r2 = await processInboundMessage({ from, body: "Tüm vücut lazer epilasyon istiyorum" });
    assertEqual("clinic requestHandoff false (main path)", r2.requestHandoff, false);
    assertTrue("clinic slot extraction still runs", clinicCalls.extractSlots > 0);
    assertTrue("clinic intent classifier still runs", clinicCalls.classifyIntent > 0);
    assertEqual("restaurant model path never used", gen.calls, 0);
    assertTrue("clinic stage advanced", r2.stateAfter.stage !== "collect_treatment_area");
  }

  console.log("");
  if (failures > 0) {
    console.error(`${failures} test(s) FAILED`);
    process.exit(1);
  }
  console.log("All restaurant-mode tests passed.");
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
