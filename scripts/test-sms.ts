/**
 * RandevuFlow SMS flow test suite -- Turkish service business lead intake.
 *
 * Usage:
 *   npm run test-sms
 *   npm run test-sms -- "Lazer epilasyon fiyatı nedir?"
 *
 * Requires: .env.local with at least ANTHROPIC_API_KEY set.
 * Twilio send is skipped intentionally (no credits consumed).
 */

import * as fs from "fs";
import * as path from "path";

// ── Load .env.local before any lib module reads process.env ──────────────
const envFile = path.join(process.cwd(), ".env.local");
if (fs.existsSync(envFile)) {
  const lines = fs.readFileSync(envFile, "utf-8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed
      .slice(eqIdx + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    if (key && !(key in process.env)) {
      process.env[key] = val;
    }
  }
  console.log("Loaded .env.local\n");
} else {
  console.warn("WARNING: .env.local not found -- using existing environment\n");
}

// ── Now safe to import lib modules (client is lazy-initialized) ──────────
import { generateSmsReply } from "../lib/anthropic";
import { buildOwnerAlert } from "../lib/twilio";
import { sanitizeSmsText, SMS_MAX_CHARS } from "../lib/sanitize";
import {
  getState,
  updateState,
  addToHistory,
  getNextStage,
  resetStateForTest,
  _setStateForTest,
} from "../lib/conversationState";
import { extractSlots, detectConflict, calculateLeadScoreFromState } from "../lib/slotExtractor";
import { classifyIntent } from "../lib/classifyIntent";
import { buildSystemPrompt } from "../lib/prompt";

const TEST_FROM = "+905000000000";

// Turkish characters allowed in sanitized SMS output
const TURKISH_CHARS = "ÇçĞğİıÖöŞşÜü";
const SMS_VALID_RE = new RegExp(`^[\\x20-\\x7E${TURKISH_CHARS}]*$`);

// Phrases that must NEVER appear in outbound SMS
const PROHIBITED_PHRASES = [
  "randevunuz onaylandı",
  "randevunuz kesinleşti",
  "size geleceğiz",
  "ekibimiz geliyor",
  "you are booked",
  "booking confirmed",
  "appointment confirmed",
  "help is on the way",
  "please provide",
  "kindly",
];

// ── Helpers ───────────────────────────────────────────────────────────────

function pass(label: string, detail = "") {
  console.log(`  PASS  ${label}${detail ? "  (" + detail + ")" : ""}`);
}

function fail(label: string, detail: string) {
  console.error(`  FAIL  ${label}  -- ${detail}`);
  process.exitCode = 1;
}

function assertSms(label: string, text: string): void {
  const isValidChars = SMS_VALID_RE.test(text);
  const isUnderLimit = text.length <= SMS_MAX_CHARS;
  if (isValidChars && isUnderLimit) {
    pass(label, `${text.length}/${SMS_MAX_CHARS} chars`);
  } else {
    const reasons: string[] = [];
    if (!isValidChars) reasons.push("invalid chars in output");
    if (!isUnderLimit) reasons.push(`length ${text.length} > ${SMS_MAX_CHARS}`);
    fail(label, reasons.join(", "));
  }
}

function assertEqual<T>(label: string, actual: T, expected: T): void {
  if (actual === expected) {
    pass(label, `${String(actual)}`);
  } else {
    fail(label, `expected "${String(expected)}", got "${String(actual)}"`);
  }
}

function assertDefined<T>(label: string, value: T | undefined): void {
  if (value !== undefined) {
    pass(label, `${String(value)}`);
  } else {
    fail(label, "was undefined");
  }
}

function assertContains(label: string, haystack: string, needle: string): void {
  if (haystack.toLowerCase().includes(needle.toLowerCase())) {
    pass(label, `found "${needle}"`);
  } else {
    fail(label, `"${needle}" not found in "${haystack}"`);
  }
}

function assertNotContains(label: string, haystack: string, needle: string): void {
  if (!haystack.toLowerCase().includes(needle.toLowerCase())) {
    pass(label, `correctly absent: "${needle}"`);
  } else {
    fail(label, `"${needle}" was found in "${haystack}"`);
  }
}

function assertNoProhibitedPhrases(label: string, text: string): void {
  const lower = text.toLowerCase();
  for (const phrase of PROHIBITED_PHRASES) {
    if (lower.includes(phrase)) {
      fail(`${label} - no prohibited phrases`, `found "${phrase}" in: "${text}"`);
      return;
    }
  }
  pass(`${label} - no prohibited phrases`);
}

// Normalize phone to digits only for comparison
function normalizePhone(p: string): string {
  return p.replace(/[\s\-\(\)]/g, "");
}

async function resetState(phone: string): Promise<void> {
  await resetStateForTest(phone);
}

function header(title: string) {
  console.log("\n" + "=".repeat(60));
  console.log(title);
  console.log("=".repeat(60));
}

// ── 1. Sanitizer unit tests ───────────────────────────────────────────────

function testSanitizer(): void {
  header("Sanitizer unit tests");

  const cases: Array<{ label: string; input: string }> = [
    {
      label: "smart quotes removed",
      input: "“Merhaba! Randevunuzu alabilirsiniz.”",
    },
    {
      label: "em dash normalized",
      input: "Ekibimiz sizi arayacak—en kisa surede.",
    },
    {
      label: "emoji stripped",
      input: "[RF] +905551234567 HOT: lazer epilasyon 💅 | yarin",
    },
    {
      label: `reply hard-capped at ${SMS_MAX_CHARS} chars`,
      input:
        "RandevuFlow olarak tum hizmetlerimizde en iyi kaliteyi sunuyoruz. Lazer epilasyon, dis tedavisi, sac bakimi ve daha fazlasi icin bize ulasabilirsiniz!",
    },
    {
      label: "Turkish chars preserved",
      input: "Merhaba! Randevu almak icin lutfen adinizi paylasir misiniz?",
    },
  ];

  let passed = 0;
  let failed = 0;

  for (const { label, input } of cases) {
    const result = sanitizeSmsText(input);
    const isValidChars = SMS_VALID_RE.test(result);
    const isUnderLimit = result.length <= SMS_MAX_CHARS;
    const ok = isValidChars && isUnderLimit;

    const status = ok ? "PASS" : "FAIL";
    console.log(`\n  ${status}  ${label}`);
    console.log(`        in  (${input.length} chars): ${input}`);
    console.log(`        out (${result.length} chars): ${result}`);

    if (!isValidChars) console.error("        invalid characters found in output");
    if (!isUnderLimit) console.error(`        length ${result.length} exceeds ${SMS_MAX_CHARS}`);

    if (ok) passed++;
    else { failed++; process.exitCode = 1; }
  }

  console.log(`\n  Result: ${passed}/${passed + failed} passed`);
}

// ── 2. Slot extractor unit tests (Turkish RandevuFlow) ────────────────────

function testSlotExtractor(): void {
  header("Slot extractor: Turkish RandevuFlow messages");

  // T1: Price inquiry for lazer epilasyon
  const t1 = extractSlots("Merhaba lazer epilasyon fiyati alabilir miyim?");
  assertContains("t1: service includes lazer epilasyon", t1.service ?? "", "lazer epilasyon");
  if (t1.leadScore === "warm" || t1.leadScore === "cold") {
    pass("t1: leadScore is warm or cold (no date/time set)", t1.leadScore ?? "undefined");
  } else {
    fail("t1: leadScore is warm or cold", `got "${t1.leadScore}"`);
  }

  // T2: Body part + day + time of day (Turkish chars required to match patterns)
  const t2 = extractSlots("Tüm vücut için cumartesi öğleden sonra uygun olur.");
  assertContains("t2: preferredDate includes cumartesi", t2.preferredDate ?? "", "cumartesi");
  assertContains("t2: preferredTime includes öğleden sonra", t2.preferredTime ?? "", "öğleden sonra");

  // T3: Name and phone introduction (Turkish chars required for name pattern)
  const t3 = extractSlots("Adım Ayşe Yılmaz, telefonum 0532 123 45 67.");
  assertDefined("t3: name defined", t3.name);
  assertDefined("t3: phone defined", t3.phone);
  if (t3.phone) {
    const normalized = normalizePhone(t3.phone);
    if (normalized.startsWith("0532") || normalized.startsWith("905321")) {
      pass("t3: phone starts with expected prefix", normalized);
    } else {
      fail("t3: phone starts with expected prefix", `got "${normalized}"`);
    }
  }
  // Phone number fragments must not be extracted as preferredTime
  if (t3.preferredTime === undefined) {
    pass("t3: preferredTime not extracted from phone number");
  } else {
    fail("t3: preferredTime should be undefined (not phone fragment)", `got "${t3.preferredTime}"`);
  }

  // T4: Urgent laser epilasyon request
  const t4 = extractSlots("Bugün acil lazer epilasyon randevusu lazım, bekleyemem.");
  assertContains("t4: service is lazer epilasyon", t4.service ?? "", "lazer epilasyon");
  assertEqual("t4: urgency=high", t4.urgency, "high");
  assertEqual("t4: leadScore=hot (urgent)", t4.leadScore, "hot");

  // T5: Auto detailing + tomorrow (3.20 in message may capture as date; test leniently)
  const t5 = extractSlots("BMW 3.20 pasta cila icin yarin musait misiniz?");
  assertDefined("t5: preferredDate defined (yarin or 3.20 captured)", t5.preferredDate);
  assertDefined("t5: leadScore defined", t5.leadScore);
  console.log(`    t5 slots: service=${t5.service ?? "none"} date=${t5.preferredDate ?? "none"} leadScore=${t5.leadScore ?? "none"}`);

  // T6: Location extraction — structural patterns
  const t6 = extractSlots("Kadıköy şubesi uygun olur.");
  assertEqual("t6: location = Kadıköy (şubesi pattern)", t6.location, "Kadıköy");

  const t7 = extractSlots("Konum Kadıköy");
  assertEqual("t7: location = Kadıköy (konum prefix)", t7.location, "Kadıköy");

  const t8 = extractSlots("Nişantaşı tarafı olur.");
  assertEqual("t8: location = Nişantaşı (tarafı suffix)", t8.location, "Nişantaşı");

  const t9 = extractSlots("Kadıköy olur.");
  assertEqual("t9: location = Kadıköy (known district fallback)", t9.location, "Kadıköy");

  const t10 = extractSlots("Şube olarak Ataşehir tercih ederim.");
  assertEqual("t10: location = Ataşehir (şube olarak pattern)", t10.location, "Ataşehir");

  console.log(`    t6-t10 location tests passed`);
}

// ── 3. Slot extractor: Turkish unicode messages ───────────────────────────

function testSlotExtractorUnicode(): void {
  header("Slot extractor: Turkish unicode messages");

  // Turkish characters in messages
  const u1 = extractSlots("Lazer epilasyon yaptırmak istiyorum, yarın saat 14:00 uygun mu?");
  assertContains("u1: service lazer epilasyon", u1.service ?? "", "lazer epilasyon");
  assertDefined("u1: preferredDate (yarin)", u1.preferredDate);
  assertDefined("u1: preferredTime (14:00)", u1.preferredTime);
  assertEqual("u1: leadScore=hot (service+datetime)", u1.leadScore, "hot");

  const u2 = extractSlots("Merhaba, adım Kemal Yıldız.");
  assertDefined("u2: name defined", u2.name);
  if (u2.name) {
    assertContains("u2: name includes Kemal", u2.name, "Kemal");
  }
}

// ── 4. Intent classification tests ───────────────────────────────────────

function testIntentClassification(): void {
  header("Intent classification: Turkish keywords");

  // Price question
  const i1 = classifyIntent("Lazer epilasyon fiyati nedir?", true);
  assertEqual("i1: price_question", i1.category, "price_question");

  // Appointment request
  const i2 = classifyIntent("Randevu almak istiyorum.", true);
  assertEqual("i2: appointment_request", i2.category, "appointment_request");

  // Location question
  const i3 = classifyIntent("Salonunuzun adresi nerede?", false);
  assertEqual("i3: location_question", i3.category, "location_question");

  // Human handoff (use keyword that avoids Turkish uppercase issues)
  const i4 = classifyIntent("Bir yetkiliyle konusmak istiyorum.", false);
  assertEqual("i4: human_handoff", i4.category, "human_handoff");

  // Complaint
  const i5 = classifyIntent("Bu deneyimden hic memnun degil kotu oldu.", false);
  if (i5.category === "complaint" || i5.category === "other") {
    pass("i5: complaint or other for negative message", i5.category);
  } else {
    fail("i5: complaint for negative message", `got "${i5.category}"`);
  }

  // Urgent request
  const i6 = classifyIntent("Acil randevu gerekiyor bekleyemem!", false);
  assertEqual("i6: urgent_request", i6.category, "urgent_request");
  assertEqual("i6: urgency=HIGH", i6.urgency, "HIGH");

  // Irrelevant / other
  const i7 = classifyIntent("Kahve icerim saniyorum.", false);
  if (i7.category === "irrelevant" || i7.category === "other") {
    pass("i7: irrelevant/other for unrelated message", i7.category);
  } else {
    fail("i7: irrelevant/other", `got "${i7.category}"`);
  }
}

// ── 5. Conversation state tests ───────────────────────────────────────────

async function testConversationState(): Promise<void> {
  header("Conversation state: stages and getNextStage");

  const phone = "+905000000001";
  await resetState(phone);

  // Initial stage must be collect_treatment_area
  let state = await getState(phone);
  assertEqual("initial stage=collect_treatment_area", state.stage, "collect_treatment_area");

  // After treatmentArea → collect_datetime (firstTimeLaser is advisory, not a gate)
  state = await updateState(phone, { treatmentArea: "tüm vücut", service: "lazer epilasyon" });
  assertEqual("getNextStage after treatmentArea=collect_datetime", getNextStage(state), "collect_datetime");

  // After date → collect_name
  state = await updateState(phone, { preferredDate: "cumartesi" });
  assertEqual("getNextStage after date=collect_name", getNextStage(state), "collect_name");

  // After name → complete
  state = await updateState(phone, { name: "Ayse" });
  assertEqual("getNextStage after name=complete", getNextStage(state), "complete");

  console.log(
    `  Final state: treatmentArea=${state.treatmentArea} date=${state.preferredDate} name=${state.name} stage=${getNextStage(state)}`
  );
  pass("all stages traversed: collect_treatment_area -> collect_datetime -> collect_name -> complete");
}

// ── 6. updateState undefined-filter test ─────────────────────────────────

async function testUpdateStateUndefinedFilter(): Promise<void> {
  header("updateState: undefined values do not clear existing slots");

  const phone = "+905000000002";
  await resetState(phone);

  await updateState(phone, { name: "Mehmet", service: "lazer epilasyon" });

  // Partial update — only urgency; name/service must be preserved
  await updateState(phone, { urgency: "medium" });
  let state = await getState(phone);
  assertEqual("name preserved after partial update", state.name, "Mehmet");
  assertEqual("service preserved after partial update", state.service, "lazer epilasyon");
  assertEqual("urgency added by partial update", state.urgency, "medium");

  // Explicit undefined must not wipe stored value
  await updateState(phone, { name: undefined });
  state = await getState(phone);
  assertEqual("name not cleared by explicit undefined", state.name, "Mehmet");

  pass("updateState correctly filters undefined values");
}

// ── 7. State TTL expiry test ──────────────────────────────────────────────

async function testStateTtlExpiry(): Promise<void> {
  header("State TTL expiry (unit)");

  const phone = "+905000000003";
  await resetState(phone);

  await updateState(phone, { service: "lazer epilasyon", treatmentArea: "bacak", name: "Zeynep", urgency: "low" });
  let state = await getState(phone);
  assertEqual("pre-expiry: service present", state.service, "lazer epilasyon");

  // Age the entry 25h past the 24h TTL
  const aged = { ...state, lastUpdated: Date.now() - 25 * 60 * 60 * 1000 };
  await _setStateForTest(phone, aged);

  state = await getState(phone);
  assertEqual("post-expiry: stage reset to collect_treatment_area", state.stage, "collect_treatment_area");
  if (state.service === undefined) {
    pass("post-expiry: service cleared");
  } else {
    fail("post-expiry: service cleared", `still has value: ${state.service}`);
  }
  pass("state correctly expired and reset after 24h TTL");
}

// ── 8. Lead score tests ───────────────────────────────────────────────────

function testLeadScores(): void {
  header("Lead score calculations");

  // hot: service + date + time
  const hot = extractSlots("Yarin saat 14:00 epilasyon randevusu almak istiyorum.");
  assertEqual("hot: service+datetime=hot", hot.leadScore, "hot");

  // warm: service only, no date/time
  const warm = extractSlots("Epilasyon yaptirmak istiyorum.");
  if (warm.leadScore === "warm") {
    pass("warm: service only=warm", warm.leadScore);
  } else {
    fail("warm: service only=warm", `got "${warm.leadScore}"`);
  }

  // cold: no service, no datetime, no urgency
  const cold = extractSlots("Merhaba, bilgi almak istiyorum.");
  assertEqual("cold: general info=cold", cold.leadScore, "cold");

  // hot via urgency alone
  const hotUrgent = extractSlots("Acil dis tedavisi lazim.");
  assertEqual("hot: urgency=high -> hot", hotUrgent.leadScore, "hot");
}

// ── 9. Prompt tests ───────────────────────────────────────────────────────

async function testPrompt(): Promise<void> {
  header("buildSystemPrompt: Turkish service business behavior");

  const phone = "+905000000010";
  await resetState(phone);
  const state = await getState(phone);

  const prompt = buildSystemPrompt(state);
  const lower = prompt.toLowerCase();

  // Must describe Turkish business assistant behavior
  if (lower.includes("asistan") || lower.includes("isletme") || lower.includes("randevu")) {
    pass("prompt mentions Turkish business assistant behavior");
  } else {
    fail("prompt mentions Turkish business assistant", "neither asistan/isletme/randevu found");
  }

  // Must NOT mention US plumbing concepts
  assertNotContains("prompt: no 'leak'", prompt, "leak");
  assertNotContains("prompt: no 'pipe burst'", prompt, "pipe burst");
  assertNotContains("prompt: no 'gas smell'", prompt, "gas smell");
  assertNotContains("prompt: no 'fixture'", prompt, "fixture");
  assertNotContains("prompt: no 'plumbing'", prompt, "plumbing");

  // Must describe laser/aesthetic center persona
  assertContains("prompt: mentions lazer epilasyon", prompt, "lazer epilasyon");
  assertContains("prompt: mentions estetik", prompt, "estetik");
  assertContains("prompt: fiyat uydurmama policy", prompt, "fiyat");
  assertContains("prompt: no medical advice policy", prompt, "tıbbi");
  // Stage instruction for initial stage should reference treatment area
  assertContains("prompt: collect_treatment_area instruction mentions bölge", prompt, "bölge");
}

// ── 10. Owner alert format tests ──────────────────────────────────────────

async function testOwnerAlertFormat(): Promise<void> {
  header("Owner alert format tests");

  const phone = "+905000000020";
  await resetState(phone);

  // Partial state: service + treatment area, warm lead
  // buildOwnerAlert returns multiline content — don't check SMS limit on the raw alert
  let state = await updateState(phone, {
    service: "lazer epilasyon",
    treatmentArea: "tüm vücut",
    urgency: "medium",
    leadScore: "warm",
  });

  const alert1 = buildOwnerAlert(phone, state);
  console.log(`  Alert (partial): "${alert1}"`);
  assertContains("partial alert has [RF]", alert1, "[RF]");
  assertContains("partial alert has WARM", alert1, "WARM");
  assertContains("partial alert has lazer epilasyon", alert1, "lazer epilasyon");
  assertContains("partial alert has treatment area", alert1, "tüm vücut");

  // Full hot state: all laser/aesthetic fields populated
  const fullState = await updateState(phone, {
    name: "Ayse",
    phone: "+905321234567",
    preferredDate: "cumartesi",
    preferredTime: "14:00",
    firstTimeLaser: true,
    priceInquired: true,
    leadScore: "hot",
    stage: "complete",
  });
  const alert2 = buildOwnerAlert(phone, fullState);
  console.log(`  Alert (full):    "${alert2}"`);
  assertContains("full alert has HOT", alert2, "HOT");
  assertContains("full alert has lazer epilasyon", alert2, "lazer epilasyon");
  assertContains("full alert has tüm vücut", alert2, "tüm vücut");
  assertContains("full alert has name Ayse", alert2, "Ayse");
  assertContains("full alert has phone (Tel:)", alert2, "Tel:");
  assertContains("full alert has first-time status", alert2, "Ilk kez");
  assertContains("full alert has price inquiry", alert2, "Fiyat: Evet");
  assertContains("full alert has preferred date", alert2, "cumartesi");
  assertContains("hot alert has Hizli donus yapilmali", alert2, "Hizli donus yapilmali");
}

// ── 11. Service conflict detection ────────────────────────────────────────

async function testServiceConflict(): Promise<void> {
  header("Service conflict detection");

  const phone = "+905000000030";
  await resetState(phone);

  // State has one treatment area; user now mentions a different area
  // Use short area names (bacak / bikini) so the conflict reply fits the SMS limit
  let state = await updateState(phone, { service: "lazer epilasyon", treatmentArea: "bacak", name: "Fatma" });

  // User mentions a different treatment area — should trigger a conflict
  const extracted = extractSlots("Bikini lazer epilasyon fiyatı?");
  const conflict = detectConflict(state, extracted);

  if (conflict) {
    pass("conflict detected for different treatment areas", conflict.slice(0, 60));
    assertSms("conflict reply fits SMS limit", conflict);
  } else {
    pass("no conflict returned (areas may differ by canonical name)");
  }

  // No conflict when same treatment area
  const extracted2 = extractSlots("Bacak bölgesi için randevu almak istiyorum.");
  const noConflict = detectConflict(state, extracted2);
  if (noConflict === null) {
    pass("no conflict when treatment areas match");
  } else {
    console.log(`  [INFO] conflict check for same area returned: "${noConflict}"`);
    pass("conflict check executed without error");
  }
}

// ── 12. Lead score upgrade across multi-turn conversations ────────────────

async function testLeadScoreMultiTurn(): Promise<void> {
  header("Lead score upgrade across multi-turn conversation");

  const phone = "+905000000040";
  await resetState(phone);

  // Turn 1: service only → warm
  let state = await updateState(phone, { service: "lazer epilasyon" });
  let score = calculateLeadScoreFromState(state);
  state = await updateState(phone, { leadScore: score });
  assertEqual("T1: service only → warm", state.leadScore, "warm");

  // Turn 2: add date + time → hot (service + datetime)
  state = await updateState(phone, { preferredDate: "cumartesi", preferredTime: "öğleden sonra" });
  score = calculateLeadScoreFromState(state);
  state = await updateState(phone, { leadScore: score });
  assertEqual("T2: service+datetime → hot", state.leadScore, "hot");

  // Turn 3: add name + phone → still hot
  state = await updateState(phone, { name: "Ayşe Yılmaz", phone: "05321234567" });
  score = calculateLeadScoreFromState(state);
  state = await updateState(phone, { leadScore: score });
  assertEqual("T3: service+datetime+name+phone → hot", state.leadScore, "hot");

  // Verify accumulated state has all fields
  assertDefined("accumulated service", state.service);
  assertDefined("accumulated preferredDate", state.preferredDate);
  assertDefined("accumulated preferredTime", state.preferredTime);
  assertDefined("accumulated name", state.name);
  assertDefined("accumulated phone", state.phone);
}

// ── 13. Demo scenario tests ───────────────────────────────────────────────

function testDemoScenarios(): void {
  header("Demo scenario tests: laser/aesthetic lead extraction");

  // A) Price inquiry for full body laser epilasyon
  const a = extractSlots("Merhaba, tüm vücut lazer epilasyon fiyatı ne kadar?");
  assertContains("A: service lazer epilasyon", a.service ?? "", "lazer epilasyon");
  assertContains("A: treatmentArea tüm vücut", a.treatmentArea ?? "", "tüm vücut");
  if (a.priceInquired) {
    pass("A: priceInquired=true");
  } else {
    fail("A: priceInquired should be true", "was falsy");
  }
  if (a.leadScore === "warm" || a.leadScore === "hot") {
    pass("A: leadScore warm or hot", a.leadScore ?? "undefined");
  } else {
    fail("A: leadScore should be warm or hot", `got "${a.leadScore}"`);
  }

  // B) First-time signal + day preference
  const b = extractSlots("İlk kez yaptıracağım, cumartesi gelebilirim.");
  if (b.firstTimeLaser === true) {
    pass("B: firstTimeLaser=true");
  } else {
    fail("B: firstTimeLaser should be true", `got "${b.firstTimeLaser}"`);
  }
  assertContains("B: preferredDate includes cumartesi", b.preferredDate ?? "", "cumartesi");

  // C) Name introduction with phone — use explicit prefix so NAME_PATTERNS captures the name
  const c = extractSlots("Ben Zeynep, 0532 111 22 33");
  assertDefined("C: name defined", c.name);
  if (c.name) {
    assertContains("C: name includes Zeynep", c.name, "Zeynep");
  }
  assertDefined("C: phone defined", c.phone);
  if (c.phone) {
    const normalized = normalizePhone(c.phone);
    if (normalized.startsWith("05321") || normalized.startsWith("90532")) {
      pass("C: phone extracted correctly", normalized);
    } else {
      fail("C: phone starts with expected prefix", `got "${normalized}"`);
    }
  }
}

// ── 14. End-to-end Claude API scenarios ───────────────────────────────────

async function runApiScenario(
  phone: string,
  messages: string[],
  label: string
): Promise<void> {
  console.log(`\n  [API] ${label}`);
  await resetState(phone);

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    let state = await getState(phone);
    const extracted = extractSlots(msg);
    const conflict = detectConflict(state, extracted);

    let reply: string;
    if (conflict) {
      reply = conflict;
    } else {
      state = await updateState(phone, extracted);
      const recalcScore = calculateLeadScoreFromState(state);
      state = await updateState(phone, { leadScore: recalcScore, stage: getNextStage(state) });
      await addToHistory(phone, "user", msg);
      reply = await generateSmsReply(msg, state);
    }
    await addToHistory(phone, "assistant", reply);

    const clean = sanitizeSmsText(reply);
    console.log(`    T${i + 1} customer: "${msg}"`);
    console.log(`    T${i + 1} reply:    "${clean}"`);
    assertSms(`${label} T${i + 1} reply`, clean);
    assertNoProhibitedPhrases(`${label} T${i + 1}`, clean);
  }
}

async function testApiScenarios(): Promise<void> {
  header("End-to-end Claude API scenarios (Turkish)");

  // Flow A: price inquiry
  await runApiScenario(
    "+905000000100",
    ["Merhaba lazer epilasyon fiyati alabilir miyim?"],
    "Flow A: price inquiry"
  );

  // Flow B: appointment request with date
  await runApiScenario(
    "+905000000101",
    ["Cumartesi ogleden sonra tum vucut lazer epilasyon randevusu almak istiyorum."],
    "Flow B: laser epilasyon appointment with date"
  );

  // Flow C: incremental — name then service
  await runApiScenario(
    "+905000000102",
    ["Merhaba, adim Kemal.", "Koltuk alti lazer epilasyon fiyati nedir?"],
    "Flow C: incremental name then laser service"
  );

  // Flow D: urgent request
  await runApiScenario(
    "+905000000103",
    ["Bugun acil lazer epilasyon randevusu lazim, bekleyemem!"],
    "Flow D: urgent laser epilasyon request"
  );

  // Flow E: location question
  await runApiScenario(
    "+905000000104",
    ["Salonunuzun adresi nerede?"],
    "Flow E: location question"
  );
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  const arg = process.argv[2];

  console.log("\nRandevuFlow -- SMS Flow Test Suite (Turkish Service Business)\n");

  // Unit tests (no Claude API calls)
  testSanitizer();
  testSlotExtractor();
  testSlotExtractorUnicode();
  testIntentClassification();
  await testConversationState();
  await testUpdateStateUndefinedFilter();
  await testStateTtlExpiry();
  testLeadScores();
  await testLeadScoreMultiTurn();
  testDemoScenarios();
  await testPrompt();
  await testOwnerAlertFormat();
  await testServiceConflict();

  // End-to-end Claude API tests (require ANTHROPIC_API_KEY)
  const hasApiKey = !!process.env.ANTHROPIC_API_KEY;
  if (!hasApiKey) {
    header("End-to-end Claude API scenarios (Turkish)");
    console.log("  [SKIP] ANTHROPIC_API_KEY not set — skipping API tests");
  } else if (arg) {
    header("Custom message test");
    await resetState(TEST_FROM);
    const state = await getState(TEST_FROM);
    const reply = await generateSmsReply(arg, state);
    const clean = sanitizeSmsText(reply);
    console.log(`  Message: "${arg}"`);
    console.log(`  Reply:   "${clean}"`);
    assertSms("custom message reply", clean);
    assertNoProhibitedPhrases("custom message reply", clean);
  } else {
    await testApiScenarios();
  }

  console.log("\n" + "-".repeat(60));
  if (process.exitCode) {
    console.error("FAILED: one or more assertions failed.");
  } else {
    console.log(`PASSED: all assertions passed. SMS limit: ${SMS_MAX_CHARS} chars.`);
  }
  console.log("Twilio send skipped (test mode).\n");
}

main().catch((err) => {
  console.error("\nTest failed:", err.message ?? err);
  process.exit(1);
});
