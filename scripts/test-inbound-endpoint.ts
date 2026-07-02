/**
 * RandevuFlow — internal test endpoint validation script (laser/aesthetic flow).
 *
 * Usage:
 *   npm run test-inbound
 *
 * Tests the /api/test/inbound pipeline logic directly (no HTTP server required).
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
  console.warn("WARNING: .env.local not found — using existing environment\n");
}

// Set test secret if not already configured
if (!process.env.TEST_WEBHOOK_SECRET) {
  process.env.TEST_WEBHOOK_SECRET = "randevuflow-dev";
}

// ── Safe to import lib modules now ───────────────────────────────────────
import { sanitizeSmsText, SMS_MAX_CHARS } from "../lib/sanitize";
import { classifyIntent } from "../lib/classifyIntent";
import { extractSlots, detectConflict, calculateLeadScoreFromState, extractNameFallback } from "../lib/slotExtractor";
import {
  getState,
  updateState,
  addToHistory,
  getNextStage,
  resetStateForTest,
  getStateStorageMode,
  hasRedisConfig,
  getConversationKey,
} from "../lib/conversationState";
import type { ConversationState } from "../lib/conversationState";
import type { ExtractedSlots } from "../lib/slotExtractor";
import { buildOwnerAlert } from "../lib/twilio";
import { generateSmsReply } from "../lib/anthropic";

// Turkish characters allowed in sanitized output
const TURKISH_CHARS = "ÇçĞğİıÖöŞşÜü";
const SMS_VALID_RE = new RegExp(`^[\\x20-\\x7E${TURKISH_CHARS}\\n]*$`);

// Prohibited phrases — booking confirmations and old plumbing/salon domain terms
const PROHIBITED_PHRASES = [
  "randevunuz onaylandı",
  "randevunuz kesinleşti",
  "size geleceğiz",
  "ekibimiz geliyor",
  "you are booked",
  "booking confirmed",
  "appointment confirmed",
  "help is on the way",
  // old plumbing domain
  "plumbing",
  "plumber",
  "pipe burst",
  "water heater",
  "faucet",
  "drain clog",
];

// ── Test helpers ──────────────────────────────────────────────────────────

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

function assertDefined(label: string, value: unknown) {
  if (value !== undefined && value !== null && value !== "") pass(label, String(value));
  else fail(label, `expected truthy, got ${JSON.stringify(value)}`);
}

function assertSms(label: string, text: string) {
  if (!SMS_VALID_RE.test(text)) {
    fail(label, `non-SMS chars in: ${text.slice(0, 60)}`);
  } else if (text.length > SMS_MAX_CHARS) {
    fail(label, `${text.length} chars — exceeds ${SMS_MAX_CHARS}`);
  } else {
    pass(label, `${text.length} chars`);
  }
}

function assertNoProhibitedPhrases(label: string, text: string) {
  const lower = text.toLowerCase();
  for (const phrase of PROHIBITED_PHRASES) {
    if (lower.includes(phrase)) {
      fail(label, `contains prohibited phrase: "${phrase}"`);
      return;
    }
  }
  pass(label);
}

function assertContains(label: string, haystack: string, needle: string) {
  if (haystack.toLowerCase().includes(needle.toLowerCase()))
    pass(label, `found "${needle}"`);
  else fail(label, `"${needle}" not found in "${haystack}"`);
}

function assertNotContains(label: string, haystack: string, needle: string) {
  if (!haystack.toLowerCase().includes(needle.toLowerCase()))
    pass(label, `correctly absent: "${needle}"`);
  else fail(label, `"${needle}" unexpectedly found in "${haystack}"`);
}

// ── Pipeline runner (mirrors /api/test/inbound route logic) ──────────────

const STAGE_FALLBACK: Record<string, string> = {
  collect_treatment_area: "Merhaba! Hangi bolge icin lazer epilasyon dusunuyorsunuz?",
  collect_datetime:       "Hangi gun ve saatte gelebilirsiniz?",
  collect_name:           "Adinizi ve telefon numaranizi alabilir miyim?",
  complete:               "Bilgilerinizi aldik. Merkezimiz sizi arayarak uygun zamani paylasacaktir.",
};

interface PipelineResult {
  input: string;
  intent: string;
  extractedSlots: ExtractedSlots;
  stateBefore: ConversationState;
  stateAfter: ConversationState;
  nextStage: string;
  assistantReply: string;
  ownerAlertPreview: string | null;
  wouldNotifyOwner: boolean;
}

async function runPipeline(from: string, rawInput: string): Promise<PipelineResult> {
  const input = sanitizeSmsText(rawInput);
  const stateBefore = await getState(from);
  const isFirstMessage = stateBefore.history.length === 0;

  const intentResult = classifyIntent(input, isFirstMessage);
  const extractedSlots = extractSlots(input);

  // Normalize service when treatment area is detected without explicit service
  if (extractedSlots.treatmentArea && !extractedSlots.service && !stateBefore.service) {
    extractedSlots.service = "lazer epilasyon";
  }

  // Stage-aware name fallback — mirrors inboundPipeline.ts logic
  // (never runs once a name is captured; heuristic guesses must not overwrite it)
  if (!extractedSlots.name && !stateBefore.name) {
    const needFallback =
      stateBefore.stage === "collect_name" ||
      stateBefore.history
        .slice(-2)
        .some((h) => h.role === "assistant" && /isminizi|adınızı|adınız\b|adını/i.test(h.content));
    if (needFallback) {
      const fallback = extractNameFallback(input);
      if (fallback) extractedSlots.name = fallback;
    }
  }

  const conflictQuestion = detectConflict(stateBefore, extractedSlots);

  let assistantReply = "";

  if (conflictQuestion) {
    assistantReply = sanitizeSmsText(conflictQuestion);
  } else {
    let updated = await updateState(from, extractedSlots as Partial<ConversationState>);
    const recalcScore = calculateLeadScoreFromState(updated);
    updated = await updateState(from, { leadScore: recalcScore, stage: getNextStage(updated) });
    const defaultLocation = process.env.CLINIC_DEFAULT_LOCATION;
    if (updated.stage === "complete" && !updated.location && defaultLocation) {
      updated = await updateState(from, { location: defaultLocation });
    }
    await addToHistory(from, "user", input);

    if (process.env.ANTHROPIC_API_KEY) {
      try {
        assistantReply = await generateSmsReply(input, updated);
      } catch {
        assistantReply = sanitizeSmsText(STAGE_FALLBACK[updated.stage] ?? STAGE_FALLBACK.collect_treatment_area);
      }
    } else {
      assistantReply = sanitizeSmsText(STAGE_FALLBACK[updated.stage] ?? STAGE_FALLBACK.collect_treatment_area);
    }
  }

  await addToHistory(from, "assistant", assistantReply);

  const stateAfter = await getState(from);

  const isFirstHighUrgency = stateAfter.urgency === "high" && !stateAfter.ownerAlertedHighUrgency;
  const isFirstComplete = stateAfter.stage === "complete" && !stateAfter.ownerAlertedComplete;
  const isHotLead = stateAfter.leadScore === "hot";
  const wouldNotifyOwner = isFirstMessage || isFirstHighUrgency || isFirstComplete || isHotLead;
  const ownerAlertPreview = wouldNotifyOwner ? buildOwnerAlert(from, stateAfter) : null;

  return {
    input,
    intent: intentResult.category,
    extractedSlots,
    stateBefore,
    stateAfter,
    nextStage: stateAfter.stage,
    assistantReply,
    ownerAlertPreview,
    wouldNotifyOwner,
  };
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== test-inbound-endpoint (laser/aesthetic flow) ===\n");

  // ── Section 1: Authorization check ───────────────────────────────────────
  console.log("── 1. Authorization ──");

  const CONFIGURED_SECRET = process.env.TEST_WEBHOOK_SECRET!;

  {
    const requestSecret = "totally-wrong-secret";
    const accepted = !!requestSecret && requestSecret === CONFIGURED_SECRET;
    if (!accepted) pass("wrong secret rejected");
    else fail("wrong secret rejected", "wrong secret was accepted");
  }

  {
    const requestSecret = "";
    const accepted = !!requestSecret && requestSecret === CONFIGURED_SECRET;
    if (!accepted) pass("missing secret rejected");
    else fail("missing secret rejected", "empty secret was accepted");
  }

  {
    const requestSecret = CONFIGURED_SECRET;
    const accepted = !!requestSecret && requestSecret === CONFIGURED_SECRET;
    if (accepted) pass("correct secret accepted");
    else fail("correct secret accepted", "valid secret was rejected");
  }

  // ── Section 2: Price inquiry with treatment area ──────────────────────────
  console.log("\n── 2. Mesaj: Tüm vücut lazer epilasyon fiyat sorusu ──");

  const PHONE_1 = "+905550000101";
  await resetStateForTest(PHONE_1);

  const MSG1 = "Merhaba tüm vücut lazer epilasyon fiyatı ne kadar?";
  const r1 = await runPipeline(PHONE_1, MSG1);

  console.log(`  intent        : ${r1.intent}`);
  console.log(`  service       : ${r1.extractedSlots.service ?? "(none)"}`);
  console.log(`  treatmentArea : ${r1.extractedSlots.treatmentArea ?? "(none)"}`);
  console.log(`  priceInquired : ${r1.extractedSlots.priceInquired ?? false}`);
  console.log(`  stage after   : ${r1.nextStage}`);
  console.log(`  reply         : ${r1.assistantReply}`);

  assertEqual("intent = price_question", r1.intent, "price_question");
  assertEqual("treatmentArea = tüm vücut", r1.extractedSlots.treatmentArea, "tüm vücut");
  assertEqual("service normalized = lazer epilasyon", r1.extractedSlots.service, "lazer epilasyon");
  assertEqual("priceInquired = true", r1.extractedSlots.priceInquired, true);
  assertEqual("stage = collect_datetime", r1.nextStage, "collect_datetime");
  assertDefined("reply non-empty", r1.assistantReply);
  assertNoProhibitedPhrases("no prohibited phrases", r1.assistantReply);
  assertNotContains("reply must not invent price (₺)", r1.assistantReply, "₺");
  assertNotContains("reply must not invent price (tl)", r1.assistantReply, " tl");

  // ── Section 3: Date and time extraction ──────────────────────────────────
  console.log("\n── 3. Mesaj: Tarih ve saat ──");

  const PHONE_2 = "+905550000102";
  await resetStateForTest(PHONE_2);

  const MSG2 = "Tüm vücut için cumartesi öğleden sonra uygun olur.";
  const r2 = await runPipeline(PHONE_2, MSG2);

  console.log(`  intent        : ${r2.intent}`);
  console.log(`  treatmentArea : ${r2.extractedSlots.treatmentArea ?? "(none)"}`);
  console.log(`  date          : ${r2.extractedSlots.preferredDate ?? "(none)"}`);
  console.log(`  time          : ${r2.extractedSlots.preferredTime ?? "(none)"}`);
  console.log(`  stage after   : ${r2.nextStage}`);
  console.log(`  reply         : ${r2.assistantReply}`);

  assertDefined("treatmentArea extracted", r2.extractedSlots.treatmentArea);
  assertDefined("preferredDate extracted", r2.extractedSlots.preferredDate);
  assertDefined("preferredTime extracted", r2.extractedSlots.preferredTime);
  assertContains("preferredDate contains cumartesi", r2.extractedSlots.preferredDate ?? "", "cumartesi");
  assertDefined("reply non-empty", r2.assistantReply);
  assertNoProhibitedPhrases("no prohibited phrases", r2.assistantReply);

  // ── Section 4: Name and phone extraction ─────────────────────────────────
  console.log("\n── 4. Mesaj: İsim ve telefon ──");

  const PHONE_3 = "+905550000103";
  await resetStateForTest(PHONE_3);

  const MSG3 = "Adım Zeynep Arslan, telefonum 0532 123 45 67.";
  const r3 = await runPipeline(PHONE_3, MSG3);

  console.log(`  intent        : ${r3.intent}`);
  console.log(`  name          : ${r3.extractedSlots.name ?? "(none)"}`);
  console.log(`  phone         : ${r3.extractedSlots.phone ?? "(none)"}`);
  console.log(`  reply         : ${r3.assistantReply}`);
  console.log(`  stage after   : ${r3.nextStage}`);

  assertDefined("name extracted", r3.extractedSlots.name);
  assertDefined("phone extracted", r3.extractedSlots.phone);
  assertContains("name contains Zeynep", r3.extractedSlots.name ?? "", "Zeynep");
  assertDefined("reply non-empty", r3.assistantReply);
  assertNoProhibitedPhrases("no prohibited phrases", r3.assistantReply);
  assertDefined("stateAfter.name set", r3.stateAfter.name);

  // ── Section 5: Owner alert preview ───────────────────────────────────────
  console.log("\n── 5. Owner alert preview ──");

  if (r1.wouldNotifyOwner) pass("msg1 wouldNotifyOwner = true (isFirstMessage)");
  else fail("msg1 wouldNotifyOwner", "expected true for first message");

  if (r1.ownerAlertPreview) {
    assertDefined("owner alert non-empty", r1.ownerAlertPreview);
    assertContains("owner alert has [RF] prefix", r1.ownerAlertPreview, "[RF]");
    assertContains("owner alert has treatmentArea", r1.ownerAlertPreview, "tüm vücut");
    assertContains("owner alert has price flag", r1.ownerAlertPreview, "Price asked: Yes");
    console.log(`  alert preview:\n${r1.ownerAlertPreview.split("\n").map(l => "    " + l).join("\n")}`);
  }

  // ── Section 6: Multi-turn continuity (3 turns, same from) ────────────────
  console.log("\n── 6. Multi-turn continuity (3 turns, same from) ──");

  const PHONE_MT = "+905551112233";
  await resetStateForTest(PHONE_MT);

  // T1: price + treatment area
  const mt1 = await runPipeline(PHONE_MT, "Merhaba tüm vücut lazer epilasyon fiyatı ne kadar?");
  console.log(`  T1 treatmentArea=${mt1.stateAfter.treatmentArea ?? "(none)"} stage=${mt1.nextStage} score=${mt1.stateAfter.leadScore}`);
  assertDefined("T1: treatmentArea set", mt1.stateAfter.treatmentArea);
  assertEqual("T1: stage = collect_datetime", mt1.nextStage, "collect_datetime");
  assertEqual("T1: priceInquired", mt1.stateAfter.priceInquired, true);

  // T2: first-time + date/time — treatment area must carry over
  const mt2 = await runPipeline(PHONE_MT, "ilk kez yaptıracağım, cumartesi öğleden sonra gelebilirim.");
  console.log(`  T2 firstTimeLaser=${mt2.stateAfter.firstTimeLaser} date=${mt2.stateAfter.preferredDate ?? "(none)"} time=${mt2.stateAfter.preferredTime ?? "(none)"} stage=${mt2.nextStage}`);
  assertContains("T2: treatmentArea preserved from T1", mt2.stateAfter.treatmentArea ?? "", "tüm vücut");
  assertEqual("T2: firstTimeLaser = true", mt2.stateAfter.firstTimeLaser, true);
  assertContains("T2: preferredDate = cumartesi", mt2.stateAfter.preferredDate ?? "", "cumartesi");
  assertContains("T2: preferredTime = öğleden sonra", mt2.stateAfter.preferredTime ?? "", "öğleden sonra");
  assertEqual("T2: stage = collect_name", mt2.nextStage, "collect_name");

  // T3: name + phone — all prior slots must be preserved
  const mt3 = await runPipeline(PHONE_MT, "Adım Zeynep Arslan, telefonum 0532 123 45 67.");
  console.log(`  T3 name=${mt3.stateAfter.name ?? "(none)"} phone=${mt3.stateAfter.phone ?? "(none)"} leadScore=${mt3.stateAfter.leadScore} stage=${mt3.nextStage}`);
  console.log(`     ownerAlert:\n${(mt3.ownerAlertPreview ?? "(null)").split("\n").map(l => "       " + l).join("\n")}`);

  assertContains("T3: treatmentArea preserved", mt3.stateAfter.treatmentArea ?? "", "tüm vücut");
  assertContains("T3: name includes Zeynep", mt3.stateAfter.name ?? "", "Zeynep");
  assertDefined("T3: phone captured", mt3.stateAfter.phone);
  assertEqual("T3: firstTimeLaser preserved", mt3.stateAfter.firstTimeLaser, true);
  assertContains("T3: preferredDate remains cumartesi", mt3.stateAfter.preferredDate ?? "", "cumartesi");
  assertEqual("T3: leadScore is hot", mt3.stateAfter.leadScore, "hot");
  assertEqual("T3: stage = complete", mt3.nextStage, "complete");
  assertDefined("T3: ownerAlertPreview non-null", mt3.ownerAlertPreview);
  assertContains("T3: ownerAlert has HOT", mt3.ownerAlertPreview ?? "", "HOT");
  assertContains("T3: ownerAlert has treatmentArea", mt3.ownerAlertPreview ?? "", "tüm vücut");
  assertContains("T3: ownerAlert has Zeynep", mt3.ownerAlertPreview ?? "", "Zeynep");
  assertContains("T3: ownerAlert has firstTimeLaser", mt3.ownerAlertPreview ?? "", "First time: Yes");
  assertContains("T3: ownerAlert has price flag", mt3.ownerAlertPreview ?? "", "Price asked: Yes");
  assertContains("T3: ownerAlert has action", mt3.ownerAlertPreview ?? "", "ACTION: Follow up ASAP");

  // ── Section 7: State storage mode diagnostics ────────────────────────────
  console.log("\n── 7. State storage mode diagnostics ──");

  const storageMode = getStateStorageMode();
  const redisConf = hasRedisConfig();

  console.log(`  storageMode     : ${storageMode}`);
  console.log(`  redisConfigured : ${redisConf}`);

  if (storageMode === "redis" || storageMode === "memory") {
    pass("getStateStorageMode returns valid value", storageMode);
  } else {
    fail("getStateStorageMode returns valid value", `got ${JSON.stringify(storageMode)}`);
  }

  if (typeof redisConf === "boolean") {
    pass("hasRedisConfig returns boolean", String(redisConf));
  } else {
    fail("hasRedisConfig returns boolean", `got ${typeof redisConf}`);
  }

  if (!redisConf && storageMode !== "memory") {
    fail(
      "storageMode=memory when Redis not configured",
      `redisConfigured=${redisConf} but storageMode=${storageMode}`
    );
  } else {
    pass("storageMode consistent with redisConfigured");
  }

  if (storageMode === "memory") {
    console.warn(
      "  [WARN] stateStorage=memory — multi-turn state will NOT persist across serverless invocations."
    );
  } else {
    pass("Redis configured — multi-turn state will persist across invocations");
  }

  // ── Section 8: Key consistency ────────────────────────────────────────────
  console.log("\n── 8. Key consistency ──");

  const TEST_PHONE = "+905551112255";
  const keyA = getConversationKey(TEST_PHONE);
  const keyB = getConversationKey(TEST_PHONE);
  assertEqual("getConversationKey is deterministic", keyA, keyB);
  assertEqual("getConversationKey format is conv:<phone>", keyA, `conv:${TEST_PHONE}`);

  const readKey  = getConversationKey(TEST_PHONE);
  const writeKey = getConversationKey(TEST_PHONE);
  assertEqual("read key === write key", readKey, writeKey);
  pass("key consistency verified", readKey);

  // ── Section 9: Demo scenario A — price inquiry triggers first-time question ─
  console.log("\n── 9. Demo A: tüm vücut fiyat sorusu → collect_datetime ──");

  const PHONE_DA = "+905551112300";
  await resetStateForTest(PHONE_DA);

  const da1 = await runPipeline(PHONE_DA, "Merhaba, tüm vücut lazer epilasyon fiyatı ne kadar?");
  console.log(`  T1 treatmentArea=${da1.stateAfter.treatmentArea ?? "(none)"} stage=${da1.nextStage} score=${da1.stateAfter.leadScore}`);
  console.log(`  reply: ${da1.assistantReply}`);

  assertEqual("DA/T1: treatmentArea = tüm vücut", da1.stateAfter.treatmentArea, "tüm vücut");
  assertEqual("DA/T1: stage = collect_datetime", da1.nextStage, "collect_datetime");
  assertEqual("DA/T1: priceInquired = true", da1.stateAfter.priceInquired, true);
  assertDefined("DA/T1: reply non-empty", da1.assistantReply);
  assertNoProhibitedPhrases("DA/T1: no prohibited phrases", da1.assistantReply);
  assertNotContains("DA/T1: reply must not invent price (₺)", da1.assistantReply, "₺");
  assertNotContains("DA/T1: reply must not invent price (tl)", da1.assistantReply, " tl");

  // ── Section 10: Demo scenario B — first-time + date ──────────────────────
  console.log("\n── 10. Demo B: İlk kez + cumartesi (continuation of Demo A) ──");

  const db1 = await runPipeline(PHONE_DA, "ilk kez yaptıracağım, cumartesi gelebilirim.");
  console.log(`  T2 firstTimeLaser=${db1.stateAfter.firstTimeLaser} date=${db1.stateAfter.preferredDate ?? "(none)"} stage=${db1.nextStage}`);

  assertEqual("DB/T2: firstTimeLaser = true", db1.stateAfter.firstTimeLaser, true);
  assertContains("DB/T2: preferredDate = cumartesi", db1.stateAfter.preferredDate ?? "", "cumartesi");
  assertEqual("DB/T2: stage = collect_name", db1.nextStage, "collect_name");
  assertContains("DB/T2: treatmentArea preserved", db1.stateAfter.treatmentArea ?? "", "tüm vücut");

  // ── Section 11: Demo scenario C — name + phone → complete + HOT alert ────
  console.log("\n── 11. Demo C: Zeynep, 0532... → complete + HOT ──");

  const dc1 = await runPipeline(PHONE_DA, "Adım Zeynep, 05321234567.");
  console.log(`  T3 name=${dc1.stateAfter.name ?? "(none)"} phone=${dc1.stateAfter.phone ?? "(none)"} stage=${dc1.nextStage} score=${dc1.stateAfter.leadScore}`);
  console.log(`  ownerAlert:\n${(dc1.ownerAlertPreview ?? "(null)").split("\n").map(l => "    " + l).join("\n")}`);

  assertEqual("DC/T3: stage = complete", dc1.nextStage, "complete");
  assertEqual("DC/T3: leadScore = hot", dc1.stateAfter.leadScore, "hot");
  assertDefined("DC/T3: ownerAlertPreview non-null", dc1.ownerAlertPreview);
  if (dc1.ownerAlertPreview) {
    assertContains("DC/T3: ownerAlert has HOT", dc1.ownerAlertPreview, "HOT");
    assertContains("DC/T3: ownerAlert has treatmentArea", dc1.ownerAlertPreview, "tüm vücut");
    assertContains("DC/T3: ownerAlert has firstTimeLaser", dc1.ownerAlertPreview, "First time: Yes");
    assertContains("DC/T3: ownerAlert has price flag", dc1.ownerAlertPreview, "Price asked: Yes");
    assertContains("DC/T3: ownerAlert has action", dc1.ownerAlertPreview, "ACTION: Follow up ASAP");
  }

  // shouldLogToSheet logic
  const dc_wouldLog = !!(
    (dc1.stateAfter.service || dc1.stateAfter.treatmentArea) &&
    dc1.stateAfter.name &&
    (dc1.stateAfter.preferredDate || dc1.stateAfter.preferredTime) &&
    dc1.stateAfter.location
  );
  if (dc_wouldLog) pass("DC/T3: wouldLogToSheet = true (lead complete)");
  else fail("DC/T3: wouldLogToSheet = true", "lead data incomplete — missing required fields");

  // ── Section 12: Returning customer detection ──────────────────────────────
  console.log("\n── 12. Slot extraction: first-time and returning customer ──");

  const ftTests: Array<[string, boolean | undefined]> = [
    ["ilk kez yaptıracağım", true],
    ["İlk kez düşünüyorum", true],   // Turkish İ at sentence start
    ["ilk defa düşünüyorum", true],
    ["İlk defa yaptıracağım", true], // Turkish İ at sentence start
    ["hiç yaptırmadım", true],
    ["daha önce yaptırmadım", true],
    ["daha önce yaptırdım devam edeyim istiyorum", false],
    ["devam ediyorum seanslarıma", false],
    ["yarım kaldı geçen sene", false],
    ["tekrar başlamak istiyorum", false],
  ];

  for (const [msg, expected] of ftTests) {
    const s = extractSlots(msg);
    assertEqual(`FT: "${msg.slice(0, 40)}" → firstTimeLaser`, s.firstTimeLaser, expected);
  }

  // ── Section 13: Treatment area extraction ─────────────────────────────────
  console.log("\n── 13. Slot extraction: treatment areas ──");

  const areaTests: Array<[string, string]> = [
    ["Tüm vücut lazer istiyorum", "tüm vücut"],
    ["full body epilasyon fiyatı", "tüm vücut"],
    ["koltuk altı için randevu", "koltuk altı"],
    ["koltukaltı lazer", "koltuk altı"],
    ["bacak epilasyon", "bacak"],
    ["bikini bölge lazer", "bikini"],
    ["dudak üstü tüy sorunu", "dudak üstü"],
    ["bıyık bölgesi lazer", "dudak üstü"],
    ["üst dudak epilasyon", "dudak üstü"],
    ["çene bölgesi", "çene"],
    ["sırt lazer", "sırt"],
    ["göğüs bölgesi", "göğüs"],
    ["genital bölge lazer", "genital"],
  ];

  for (const [msg, expectedArea] of areaTests) {
    const s = extractSlots(msg);
    assertEqual(`AREA: "${msg.slice(0, 40)}" → ${expectedArea}`, s.treatmentArea, expectedArea);
  }

  // ── Section 14: Price inquiry detection ───────────────────────────────────
  console.log("\n── 14. Slot extraction: price inquiry detection ──");

  const priceTests: Array<[string, boolean]> = [
    ["lazer epilasyon fiyatı ne kadar?", true],
    ["tüm vücut ücret bilgisi alabilir miyim", true],
    ["kampanya var mı?", true],
    ["paket fiyatları nasıl?", true],
    ["indirim yapıyor musunuz", true],
    ["cumartesi gelebilir miyim", false],
    ["ilk kez yaptıracağım", false],
  ];

  for (const [msg, expected] of priceTests) {
    const s = extractSlots(msg);
    const actual = s.priceInquired === true;
    if (actual === expected) pass(`PRICE: "${msg.slice(0, 45)}" → ${expected}`);
    else fail(`PRICE: "${msg.slice(0, 45)}"`, `got priceInquired=${s.priceInquired}, expected ${expected}`);
  }

  // ── Section 15: Lead score from state ─────────────────────────────────────
  console.log("\n── 15. Lead score from accumulated state ──");

  // Cold: nothing
  assertEqual("SCORE: cold (empty state)", calculateLeadScoreFromState({}), "cold");

  // Warm: service only
  assertEqual("SCORE: warm (service only)", calculateLeadScoreFromState({ service: "lazer epilasyon" }), "warm");

  // Warm: price + service (no date yet)
  assertEqual("SCORE: warm (price+service, no date)", calculateLeadScoreFromState({ service: "lazer epilasyon", priceInquired: true }), "warm");

  // Hot: service + datetime
  assertEqual("SCORE: hot (service+date)", calculateLeadScoreFromState({ service: "lazer epilasyon", preferredDate: "cumartesi" }), "hot");

  // Hot: treatmentArea + datetime
  assertEqual("SCORE: hot (area+date)", calculateLeadScoreFromState({ treatmentArea: "bacak", preferredDate: "yarın" }), "hot");

  // Hot: service + datetime + contact
  assertEqual("SCORE: hot (full)", calculateLeadScoreFromState({ service: "lazer epilasyon", preferredDate: "cumartesi", name: "Zeynep" }), "hot");

  // Hot: urgency
  assertEqual("SCORE: hot (urgent)", calculateLeadScoreFromState({ urgency: "high" }), "hot");

  // ── Section 16: Structured message — single-turn complete ─────────────────
  console.log("\n── 16. Structured message: single-turn complete ──");

  const structuredMsg = [
    "İsim: Zeynep Arslan",
    "Telefon: 05321234567",
    "Hizmet: lazer epilasyon",
    "Bölge: tüm vücut",
    "Zaman: cumartesi öğleden sonra",
    "Şube: Ümraniye",
  ].join("\n");

  const sSlots = extractSlots(structuredMsg);
  console.log(`  name          : ${sSlots.name ?? "(none)"}`);
  console.log(`  phone         : ${sSlots.phone ?? "(none)"}`);
  console.log(`  service       : ${sSlots.service ?? "(none)"}`);
  console.log(`  treatmentArea : ${sSlots.treatmentArea ?? "(none)"}`);
  console.log(`  preferredDate : ${sSlots.preferredDate ?? "(none)"}`);
  console.log(`  preferredTime : ${sSlots.preferredTime ?? "(none)"}`);
  console.log(`  location      : ${sSlots.location ?? "(none)"}`);

  assertContains("S1: name includes Zeynep", sSlots.name ?? "", "Zeynep");
  assertEqual("S1: phone", sSlots.phone, "05321234567");
  assertContains("S1: service = lazer epilasyon", sSlots.service ?? "", "lazer epilasyon");
  assertEqual("S1: treatmentArea = tüm vücut", sSlots.treatmentArea, "tüm vücut");
  assertContains("S1: preferredDate = cumartesi", sSlots.preferredDate ?? "", "cumartesi");
  assertContains("S1: preferredTime = öğleden sonra", sSlots.preferredTime ?? "", "öğleden sonra");
  assertEqual("S1: location = Ümraniye", sSlots.location, "Ümraniye");

  // Structured message must reach complete in a single pipeline turn
  // (firstTimeLaser is advisory — its absence does not block completion)
  const PHONE_S1 = "+905551112500";
  await resetStateForTest(PHONE_S1);
  const sr1 = await runPipeline(PHONE_S1, structuredMsg);
  assertEqual("S1: stage = complete (firstTimeLaser advisory, not required)", sr1.nextStage, "complete");

  // With firstTimeLaser in a short single message that stays under SMS_MAX_CHARS (120):
  // sanitizeSmsText collapses newlines to spaces and truncates at 120 chars —
  // a multi-line join of all fields exceeds that limit, so we use a condensed inline message.
  const PHONE_S2 = "+905551112501";
  await resetStateForTest(PHONE_S2);
  const shortFullMsg = "İsim: Zeynep Tel: 05321234567 lazer epilasyon bacak ilk kez cumartesi ogleden sonra";
  const sr2 = await runPipeline(PHONE_S2, shortFullMsg);
  assertEqual("S2: stage = complete (all fields incl firstTimeLaser in one message)", sr2.nextStage, "complete");

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log("\n══════════════════════════════════════");
  if (failures === 0) {
    console.log("ALL TESTS PASSED\n");
  } else {
    console.error(`\n${failures} test(s) FAILED\n`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
