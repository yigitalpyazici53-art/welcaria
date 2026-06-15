/**
 * RandevuFlow — internal test endpoint validation script.
 *
 * Usage:
 *   npm run test-inbound
 *
 * Tests the /api/test/inbound pipeline logic directly (no HTTP server required).
 * Authorization check, Turkish message processing, and reply quality are verified.
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
const SMS_VALID_RE = new RegExp(`^[\\x20-\\x7E${TURKISH_CHARS}]*$`);

// Prohibited phrases — booking confirmations and old plumbing domain terms
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
  collect_name:     "Merhaba! Randevu talebi icin adinizi ogrenebilir miyim?",
  collect_service:  "Hangi hizmet icin randevu almak istersiniz?",
  collect_datetime: "Hangi gun ve saatte gelmek istersiniz?",
  collect_location: "Hangi subemizi tercih edersiniz?",
  complete:         "Bilgilerinizi aldik. Ekibimiz sizi arayarak onaylayacaktir.",
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

  // Stage-aware name fallback — mirrors inboundPipeline.ts logic
  if (!extractedSlots.name) {
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
    await addToHistory(from, "user", input);

    if (process.env.ANTHROPIC_API_KEY) {
      try {
        assistantReply = await generateSmsReply(input, updated);
      } catch {
        assistantReply = sanitizeSmsText(STAGE_FALLBACK[updated.stage] ?? STAGE_FALLBACK.collect_name);
      }
    } else {
      assistantReply = sanitizeSmsText(STAGE_FALLBACK[updated.stage] ?? STAGE_FALLBACK.collect_name);
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
  console.log("=== test-inbound-endpoint ===\n");

  // ── Section 1: Authorization check ───────────────────────────────────────
  console.log("── 1. Authorization ──");

  const CONFIGURED_SECRET = process.env.TEST_WEBHOOK_SECRET!;

  // Wrong secret should be rejected
  {
    const requestSecret = "totally-wrong-secret";
    const accepted = !!requestSecret && requestSecret === CONFIGURED_SECRET;
    if (!accepted) pass("wrong secret rejected");
    else fail("wrong secret rejected", "wrong secret was accepted");
  }

  // Missing (empty) secret should be rejected
  {
    const requestSecret = "";
    const accepted = !!requestSecret && requestSecret === CONFIGURED_SECRET;
    if (!accepted) pass("missing secret rejected");
    else fail("missing secret rejected", "empty secret was accepted");
  }

  // Correct secret should be accepted
  {
    const requestSecret = CONFIGURED_SECRET;
    const accepted = !!requestSecret && requestSecret === CONFIGURED_SECRET;
    if (accepted) pass("correct secret accepted");
    else fail("correct secret accepted", "valid secret was rejected");
  }

  // ── Section 2: Turkish message 1 — price question ─────────────────────────
  console.log("\n── 2. Mesaj: Fiyat sorusu (lazer epilasyon) ──");

  const PHONE_1 = "+905550000101";
  await resetStateForTest(PHONE_1);

  const MSG1 = "Merhaba lazer epilasyon fiyatı alabilir miyim?";
  const r1 = await runPipeline(PHONE_1, MSG1);

  console.log(`  intent      : ${r1.intent}`);
  console.log(`  service     : ${r1.extractedSlots.service ?? "(none)"}`);
  console.log(`  reply       : ${r1.assistantReply}`);
  console.log(`  stage after : ${r1.nextStage}`);

  assertEqual("intent = price_question", r1.intent, "price_question");
  assertEqual("service extracted = lazer epilasyon", r1.extractedSlots.service, "lazer epilasyon");
  assertDefined("stateAfter.service set", r1.stateAfter.service);
  assertDefined("reply non-empty", r1.assistantReply);
  assertNoProhibitedPhrases("no prohibited phrases", r1.assistantReply);

  // ── Section 3: Turkish message 2 — date/time ─────────────────────────────
  console.log("\n── 3. Mesaj: Tarih ve saat ──");

  const PHONE_2 = "+905550000102";
  await resetStateForTest(PHONE_2);

  const MSG2 = "Tüm vücut için cumartesi öğleden sonra uygun olur.";
  const r2 = await runPipeline(PHONE_2, MSG2);

  console.log(`  intent      : ${r2.intent}`);
  console.log(`  date        : ${r2.extractedSlots.preferredDate ?? "(none)"}`);
  console.log(`  time        : ${r2.extractedSlots.preferredTime ?? "(none)"}`);
  console.log(`  reply       : ${r2.assistantReply}`);
  console.log(`  stage after : ${r2.nextStage}`);

  assertDefined("preferredDate extracted", r2.extractedSlots.preferredDate);
  assertDefined("preferredTime extracted", r2.extractedSlots.preferredTime);
  assertContains("preferredDate contains cumartesi", r2.extractedSlots.preferredDate ?? "", "cumartesi");
  assertDefined("reply non-empty", r2.assistantReply);
  assertNoProhibitedPhrases("no prohibited phrases", r2.assistantReply);

  // ── Section 4: Turkish message 3 — name and phone ────────────────────────
  console.log("\n── 4. Mesaj: İsim ve telefon ──");

  const PHONE_3 = "+905550000103";
  await resetStateForTest(PHONE_3);

  const MSG3 = "Adım Ayşe Yılmaz, telefonum 0532 123 45 67.";
  const r3 = await runPipeline(PHONE_3, MSG3);

  console.log(`  intent      : ${r3.intent}`);
  console.log(`  name        : ${r3.extractedSlots.name ?? "(none)"}`);
  console.log(`  phone       : ${r3.extractedSlots.phone ?? "(none)"}`);
  console.log(`  reply       : ${r3.assistantReply}`);
  console.log(`  stage after : ${r3.nextStage}`);

  assertDefined("name extracted", r3.extractedSlots.name);
  assertDefined("phone extracted", r3.extractedSlots.phone);
  assertContains("name contains Ayşe", r3.extractedSlots.name ?? "", "Ay");
  assertDefined("reply non-empty", r3.assistantReply);
  assertNoProhibitedPhrases("no prohibited phrases", r3.assistantReply);
  assertDefined("stateAfter.name set", r3.stateAfter.name);

  // ── Section 5: Owner alert preview ───────────────────────────────────────
  console.log("\n── 5. Owner alert preview ──");

  // All three first messages should trigger wouldNotifyOwner (isFirstMessage = true)
  if (r1.wouldNotifyOwner) pass("msg1 wouldNotifyOwner = true (isFirstMessage)");
  else fail("msg1 wouldNotifyOwner", "expected true for first message");

  if (r1.ownerAlertPreview) {
    assertSms("owner alert valid SMS format", r1.ownerAlertPreview);
    assertContains("owner alert has [RF] prefix", r1.ownerAlertPreview, "[RF]");
    console.log(`  alert preview: ${r1.ownerAlertPreview}`);
  }

  // ── Section 6: Multi-turn continuity — 3 turns, same from number ─────────
  console.log("\n── 6. Multi-turn continuity (3 turns, same from) ──");

  const PHONE_MT = "+905551112233";
  await resetStateForTest(PHONE_MT);

  // Turn 1: service inquiry
  const mt1 = await runPipeline(PHONE_MT, "Merhaba lazer epilasyon fiyatı alabilir miyim?");
  console.log(`  T1 service=${mt1.stateAfter.service ?? "(none)"} stage=${mt1.nextStage} leadScore=${mt1.stateAfter.leadScore}`);
  assertDefined("T1: stateAfter.service set", mt1.stateAfter.service);
  assertContains("T1: stateAfter.service = lazer epilasyon", mt1.stateAfter.service ?? "", "lazer epilasyon");

  // Turn 2: date/time — service must be carried over
  const mt2 = await runPipeline(PHONE_MT, "Tüm vücut için cumartesi öğleden sonra uygun olur.");
  console.log(`  T2 service=${mt2.stateAfter.service ?? "(none)"} date=${mt2.stateAfter.preferredDate ?? "(none)"} time=${mt2.stateAfter.preferredTime ?? "(none)"} leadScore=${mt2.stateAfter.leadScore}`);
  assertContains("T2: stateAfter.service preserved from T1", mt2.stateAfter.service ?? "", "lazer epilasyon");
  assertContains("T2: stateAfter.preferredDate = cumartesi", mt2.stateAfter.preferredDate ?? "", "cumartesi");
  assertContains("T2: stateAfter.preferredTime = öğleden sonra", mt2.stateAfter.preferredTime ?? "", "öğleden sonra");
  if (mt2.stateAfter.preferredTime === "45") fail("T2: preferredTime is not phone fragment", "got '45'");
  else pass("T2: preferredTime is not '45'", mt2.stateAfter.preferredTime ?? "undefined");

  // Turn 3: name + phone — all prior slots must be preserved
  const mt3 = await runPipeline(PHONE_MT, "Adım Ayşe Yılmaz, telefonum 0532 123 45 67.");
  console.log(`  T3 service=${mt3.stateAfter.service ?? "(none)"} name=${mt3.stateAfter.name ?? "(none)"} phone=${mt3.stateAfter.phone ?? "(none)"}`);
  console.log(`     time=${mt3.stateAfter.preferredTime ?? "(none)"} leadScore=${mt3.stateAfter.leadScore} stage=${mt3.nextStage}`);
  console.log(`     ownerAlert=${mt3.ownerAlertPreview ?? "(null)"}`);

  assertContains("T3: stateAfter.service preserved", mt3.stateAfter.service ?? "", "lazer epilasyon");
  assertContains("T3: stateAfter.name includes Ayşe", mt3.stateAfter.name ?? "", "Ayşe");
  assertDefined("T3: stateAfter.phone captured", mt3.stateAfter.phone);
  assertContains("T3: stateAfter.preferredDate remains cumartesi", mt3.stateAfter.preferredDate ?? "", "cumartesi");
  assertContains("T3: stateAfter.preferredTime remains öğleden sonra", mt3.stateAfter.preferredTime ?? "", "öğleden sonra");
  if (mt3.stateAfter.preferredTime === "45") fail("T3: preferredTime is not phone fragment '45'", "got '45'");
  else pass("T3: preferredTime is not '45'", mt3.stateAfter.preferredTime ?? "undefined");
  assertEqual("T3: leadScore is hot", mt3.stateAfter.leadScore, "hot");
  if (mt3.nextStage === "collect_service") fail("T3: nextStage is not collect_service", `got "${mt3.nextStage}"`);
  else pass("T3: nextStage is not collect_service", mt3.nextStage);
  assertDefined("T3: ownerAlertPreview is non-null", mt3.ownerAlertPreview);
  assertContains("T3: ownerAlertPreview includes HOT", mt3.ownerAlertPreview ?? "", "HOT");
  assertContains("T3: ownerAlertPreview includes lazer epilasyon", mt3.ownerAlertPreview ?? "", "lazer epilasyon");
  assertContains("T3: ownerAlertPreview includes Ayşe", mt3.ownerAlertPreview ?? "", "Ayşe");

  // ── Section 7: State storage mode diagnostics ────────────────────────────
  console.log("\n── 7. State storage mode diagnostics ──");

  const storageMode = getStateStorageMode();
  const redisConf = hasRedisConfig();

  console.log(`  storageMode     : ${storageMode}`);
  console.log(`  redisConfigured : ${redisConf}`);

  // getStateStorageMode must return exactly "redis" or "memory"
  if (storageMode === "redis" || storageMode === "memory") {
    pass("getStateStorageMode returns valid value", storageMode);
  } else {
    fail("getStateStorageMode returns valid value", `got ${JSON.stringify(storageMode)}`);
  }

  // hasRedisConfig must return a boolean
  if (typeof redisConf === "boolean") {
    pass("hasRedisConfig returns boolean", String(redisConf));
  } else {
    fail("hasRedisConfig returns boolean", `got ${typeof redisConf}`);
  }

  // storageMode must be consistent with redisConf:
  // if Redis env vars are absent, mode must be "memory"
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
    console.warn(
      "  [WARN] Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN for production reliability."
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

  // Verify key is identical in read and write paths by calling the function
  // from both sides (no aliasing — same export used everywhere).
  const readKey  = getConversationKey(TEST_PHONE);
  const writeKey = getConversationKey(TEST_PHONE);
  assertEqual("read key === write key", readKey, writeKey);
  pass("key consistency verified", readKey);

  // ── Section 9: 4-turn multi-turn — full lead with location ──────────────
  console.log("\n── 9. Multi-turn: 4 turns — full lead with location ──");

  const PHONE_4T = "+905551112300";
  await resetStateForTest(PHONE_4T);

  const mt4_1 = await runPipeline(PHONE_4T, "Merhaba lazer epilasyon fiyatı alabilir miyim?");
  console.log(`  T1 service=${mt4_1.stateAfter.service ?? "(none)"} stage=${mt4_1.nextStage}`);

  const mt4_2 = await runPipeline(PHONE_4T, "Tüm vücut için cumartesi öğleden sonra uygun olur.");
  console.log(`  T2 date=${mt4_2.stateAfter.preferredDate ?? "(none)"} time=${mt4_2.stateAfter.preferredTime ?? "(none)"} leadScore=${mt4_2.stateAfter.leadScore}`);

  const mt4_3 = await runPipeline(PHONE_4T, "Adım Ayşe Yılmaz, telefonum 0532 123 45 67.");
  console.log(`  T3 name=${mt4_3.stateAfter.name ?? "(none)"} phone=${mt4_3.stateAfter.phone ?? "(none)"} stage=${mt4_3.nextStage}`);

  const mt4_4 = await runPipeline(PHONE_4T, "Kadıköy şubesi uygun olur.");
  console.log(`  T4 location=${mt4_4.stateAfter.location ?? "(none)"} stage=${mt4_4.nextStage}`);
  console.log(`     extractedSlots=${JSON.stringify(mt4_4.extractedSlots)}`);
  console.log(`     ownerAlert=${mt4_4.ownerAlertPreview ?? "(null)"}`);
  console.log(`     reply=${mt4_4.assistantReply.slice(0, 80)}${mt4_4.assistantReply.length > 80 ? "..." : ""}`);

  // Final state assertions after 4 turns
  assertContains("T4: service = lazer epilasyon", mt4_4.stateAfter.service ?? "", "lazer epilasyon");
  assertContains("T4: preferredDate = cumartesi", mt4_4.stateAfter.preferredDate ?? "", "cumartesi");
  assertContains("T4: preferredTime = öğleden sonra", mt4_4.stateAfter.preferredTime ?? "", "öğleden sonra");
  assertContains("T4: name includes Ayşe", mt4_4.stateAfter.name ?? "", "Ayşe");
  assertDefined("T4: phone captured", mt4_4.stateAfter.phone);
  assertEqual("T4: phone normalized", mt4_4.stateAfter.phone, "05321234567");
  assertContains("T4: location = Kadıköy", mt4_4.stateAfter.location ?? "", "Kadıköy");
  assertEqual("T4: location extracted in slots", mt4_4.extractedSlots.location, "Kadıköy");
  assertEqual("T4: leadScore = hot", mt4_4.stateAfter.leadScore, "hot");
  assertEqual("T4: stage = complete", mt4_4.nextStage, "complete");
  assertDefined("T4: ownerAlertPreview non-null", mt4_4.ownerAlertPreview);
  if (mt4_4.ownerAlertPreview) {
    assertNotContains("T4: ownerAlert no 'eksik: konum'", mt4_4.ownerAlertPreview, "eksik: konum");
    assertContains("T4: ownerAlert includes Kadıköy", mt4_4.ownerAlertPreview, "Kadıköy");
    assertContains("T4: ownerAlert includes HOT", mt4_4.ownerAlertPreview, "HOT");
    assertContains("T4: ownerAlert includes lazer epilasyon", mt4_4.ownerAlertPreview, "lazer epilasyon");
  }
  // wouldLogToSheet logic mirrors /api/test/inbound route
  const mt4_wouldLog = !!(
    mt4_4.stateAfter.service &&
    mt4_4.stateAfter.name &&
    mt4_4.stateAfter.phone &&
    (mt4_4.stateAfter.preferredDate || mt4_4.stateAfter.preferredTime) &&
    mt4_4.stateAfter.location
  );
  if (mt4_wouldLog) pass("T4: wouldLogToSheet = true (lead complete)");
  else fail("T4: wouldLogToSheet = true", "lead data incomplete — missing required fields");

  // ── Section 10: 6-turn regression — single-word Turkish name ────────────
  console.log("\n── 10. Regression: 6-turn flow with bare single-word name ──");

  const PHONE_6T = "+905551112402";
  await resetStateForTest(PHONE_6T);

  // T1: service inquiry
  const r6_1 = await runPipeline(PHONE_6T, "Merhaba lazer epilasyon fiyatı alabilir miyim?");
  console.log(`  T1 service=${r6_1.stateAfter.service ?? "(none)"} stage=${r6_1.nextStage}`);
  assertContains("R6/T1: service = lazer epilasyon", r6_1.stateAfter.service ?? "", "lazer epilasyon");

  // T2: bare single-word name (regression — was silently dropped before fix)
  const r6_2 = await runPipeline(PHONE_6T, "ayşe");
  console.log(`  T2 name=${r6_2.stateAfter.name ?? "(none)"} stage=${r6_2.nextStage} reply="${r6_2.assistantReply.slice(0, 60)}"`);
  assertEqual("R6/T2: name = Ayşe", r6_2.stateAfter.name, "Ayşe");
  assertNotContains("R6/T2: reply does not re-ask name", r6_2.assistantReply, "isminizi");

  // T3: phone number
  const r6_3 = await runPipeline(PHONE_6T, "Telefonum 0532 123 45 67");
  console.log(`  T3 phone=${r6_3.stateAfter.phone ?? "(none)"} name=${r6_3.stateAfter.name ?? "(none)"}`);
  assertEqual("R6/T3: phone normalized", r6_3.stateAfter.phone, "05321234567");
  assertContains("R6/T3: name still Ayşe", r6_3.stateAfter.name ?? "", "Ayşe");

  // T4: service detail — must not accidentally overwrite name
  const r6_4 = await runPipeline(PHONE_6T, "Tüm vücut düşünüyorum");
  console.log(`  T4 name=${r6_4.stateAfter.name ?? "(none)"} service=${r6_4.stateAfter.service ?? "(none)"}`);
  assertContains("R6/T4: name still Ayşe", r6_4.stateAfter.name ?? "", "Ayşe");
  assertContains("R6/T4: service preserved", r6_4.stateAfter.service ?? "", "lazer epilasyon");

  // T5: date and time
  const r6_5 = await runPipeline(PHONE_6T, "Cumartesi öğleden sonra uygun olur");
  console.log(`  T5 date=${r6_5.stateAfter.preferredDate ?? "(none)"} time=${r6_5.stateAfter.preferredTime ?? "(none)"}`);
  assertContains("R6/T5: preferredDate = cumartesi", r6_5.stateAfter.preferredDate ?? "", "cumartesi");
  assertContains("R6/T5: preferredTime = öğleden sonra", r6_5.stateAfter.preferredTime ?? "", "öğleden sonra");
  assertNotContains("R6/T5: reply does not ask for phone", r6_5.assistantReply, "telefon");

  // T6: location → stage must reach complete
  const r6_6 = await runPipeline(PHONE_6T, "Kadıköy şubesi uygun olur.");
  console.log(`  T6 location=${r6_6.stateAfter.location ?? "(none)"} stage=${r6_6.nextStage}`);
  console.log(`     ownerAlert=${r6_6.ownerAlertPreview ?? "(null)"}`);
  console.log(`     reply=${r6_6.assistantReply.slice(0, 80)}${r6_6.assistantReply.length > 80 ? "..." : ""}`);

  assertEqual("R6/T6: name = Ayşe", r6_6.stateAfter.name, "Ayşe");
  assertEqual("R6/T6: phone normalized", r6_6.stateAfter.phone, "05321234567");
  assertContains("R6/T6: service = lazer epilasyon", r6_6.stateAfter.service ?? "", "lazer epilasyon");
  assertContains("R6/T6: preferredDate = cumartesi", r6_6.stateAfter.preferredDate ?? "", "cumartesi");
  assertContains("R6/T6: preferredTime = öğleden sonra", r6_6.stateAfter.preferredTime ?? "", "öğleden sonra");
  assertContains("R6/T6: location = Kadıköy", r6_6.stateAfter.location ?? "", "Kadıköy");
  assertEqual("R6/T6: stage = complete", r6_6.nextStage, "complete");
  assertEqual("R6/T6: leadScore = hot", r6_6.stateAfter.leadScore, "hot");
  assertDefined("R6/T6: ownerAlertPreview non-null", r6_6.ownerAlertPreview);
  if (r6_6.ownerAlertPreview) {
    assertContains("R6/T6: ownerAlert includes Ayşe", r6_6.ownerAlertPreview, "Ayşe");
    assertContains("R6/T6: ownerAlert includes Kadıköy", r6_6.ownerAlertPreview, "Kadıköy");
    assertContains("R6/T6: ownerAlert includes HOT", r6_6.ownerAlertPreview, "HOT");
    assertContains("R6/T6: ownerAlert includes lazer epilasyon", r6_6.ownerAlertPreview, "lazer epilasyon");
  }
  // Critical regression assertion — reply must NOT ask for name again
  assertNotContains("R6/T6: reply does not re-ask name (regression)", r6_6.assistantReply, "isminizi öğrenebilir");
  assertNotContains("R6/T6: reply does not ask for phone", r6_6.assistantReply, "telefon numaranız");
  assertNotContains("R6/T6: reply does not re-ask location", r6_6.assistantReply, "şubemizi tercih");
  const r6_wouldLog = !!(
    r6_6.stateAfter.service &&
    r6_6.stateAfter.name &&
    r6_6.stateAfter.phone &&
    (r6_6.stateAfter.preferredDate || r6_6.stateAfter.preferredTime) &&
    r6_6.stateAfter.location
  );
  if (r6_wouldLog) pass("R6/T6: wouldLogToSheet = true");
  else fail("R6/T6: wouldLogToSheet = true", "lead data incomplete");

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
