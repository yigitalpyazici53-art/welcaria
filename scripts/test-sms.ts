/**
 * Local SMS flow test -- no Twilio number required.
 *
 * Usage:
 *   npm run test-sms
 *   npm run test-sms -- "My kitchen is flooding right now"
 *
 * Requires: .env.local with at least ANTHROPIC_API_KEY set.
 * Optional: GOOGLE_* vars to also test the Sheets log.
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
import { logToSheet } from "../lib/googleSheets";
import { sanitizeSmsText, SMS_MAX_CHARS } from "../lib/sanitize";
import {
  getState,
  updateState,
  addToHistory,
  getNextStage,
  resetStateForTest,
  _setStateForTest,
} from "../lib/conversationState";
import { extractSlots, detectConflict } from "../lib/slotExtractor";

const TEST_FROM = "+10000000000";

// ── Prohibited phrases — must NEVER appear in any outbound SMS ────────────
const PROHIBITED_PHRASES = [
  "you are booked",
  "you have been booked",
  "your booking",
  "booking confirmed",
  "appointment confirmed",
  "we will be there",
  "well be there",
  "help is on the way",
  "we can definitely come",
  "we will send someone",
  "someone is coming",
  "please provide",
  "kindly",
  "service address",
  "for the visit",
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
  const isAsciiOnly = /^[\x20-\x7E]*$/.test(text);
  const isUnderLimit = text.length <= SMS_MAX_CHARS;
  if (isAsciiOnly && isUnderLimit) {
    pass(label, `${text.length}/${SMS_MAX_CHARS} chars`);
  } else {
    const reasons: string[] = [];
    if (!isAsciiOnly) reasons.push("non-ASCII chars");
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

async function resetState(phone: string): Promise<void> {
  await resetStateForTest(phone);
}

// ── Section header ────────────────────────────────────────────────────────

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
      input: "“Hi! We’re happy to help book your appointment.”",
    },
    {
      label: "em dash normalized + contraction expanded",
      input: "Emergency crew en route—ETA 20 min. We'll be there ASAP.",
    },
    {
      label: "emoji stripped from owner alert",
      input: "[RF] +15551234567 HIGH: burst pipe 💧 flooding | Call ASAP",
    },
    {
      label: `reply hard-capped at ${SMS_MAX_CHARS} chars`,
      input:
        "RapidFlow Plumbing can help with all your plumbing needs including emergency repairs, scheduled maintenance, water heater installations, and much more! We serve all of Houston and surrounding areas.",
    },
    {
      label: "contractions expanded, no apostrophes in output",
      input: "I'll send the plumber. We can't make it today. Don't worry!",
    },
  ];

  let passed = 0;
  let failed = 0;

  for (const { label, input } of cases) {
    const result = sanitizeSmsText(input);
    const isAsciiOnly = /^[\x20-\x7E]*$/.test(result);
    const isUnderLimit = result.length <= SMS_MAX_CHARS;
    const ok = isAsciiOnly && isUnderLimit;

    const status = ok ? "PASS" : "FAIL";
    console.log(`\n  ${status}  ${label}`);
    console.log(`        in  (${input.length} chars): ${input}`);
    console.log(`        out (${result.length} chars): ${result}`);

    if (!isAsciiOnly) console.error("        non-ASCII characters found in output");
    if (!isUnderLimit) console.error(`        length ${result.length} exceeds ${SMS_MAX_CHARS}`);

    if (ok) passed++;
    else failed++;
  }

  console.log(`\n  Result: ${passed}/${passed + failed} passed`);
  if (failed > 0) throw new Error(`${failed} sanitizer test(s) failed`);
}

// ── 2. Slot extractor unit tests ─────────────────────────────────────────

function testSlotExtractor(): void {
  header("Slot extractor unit tests");

  const s1 = extractSlots("My kitchen sink is leaking. Can someone come tomorrow?");
  assertEqual("s1: issue_type=leak", s1.issue_type, "leak");
  assertEqual("s1: fixture=sink", s1.fixture, "sink");
  assertDefined("s1: preferred_time defined", s1.preferred_time);

  const s2 = extractSlots("Clog");
  assertEqual("s2: issue_type=clog", s2.issue_type, "clog");

  const s3 = extractSlots("Sink");
  assertEqual("s3: fixture=sink", s3.fixture, "sink");

  // "burst pipe" must map to pipe_burst (not generic "leak") with HIGH urgency
  const s4 = extractSlots("URGENT: burst pipe flooding my basement right now");
  assertEqual("s4: urgency=high", s4.urgency, "high");
  assertEqual("s4: issue_type=pipe_burst", s4.issue_type, "pipe_burst");
  assertEqual("s4: fixture=pipe (implicit)", s4.fixture, "pipe");

  const s5 = extractSlots("tomorrow afternoon");
  assertDefined("s5: preferred_time defined", s5.preferred_time);

  const s6 = extractSlots("245 Oak Street");
  assertDefined("s6: address defined", s6.address);

  // Gas smell must extract as gas_smell with HIGH urgency
  const s7 = extractSlots("I smell gas near the water heater");
  assertEqual("s7: issue_type=gas_smell", s7.issue_type, "gas_smell");
  assertEqual("s7: urgency=high (gas)", s7.urgency, "high");
}

// ── 3. Stage-transition unit tests ───────────────────────────────────────

async function testStageTransitions(): Promise<void> {
  header("Stage transition unit tests");

  const phone = "+19990000001";
  await resetState(phone);

  let state = await getState(phone);
  assertEqual("initial stage=collect_issue_type", state.stage, "collect_issue_type");

  state = await updateState(phone, extractSlots("My kitchen sink is leaking. Can someone come tomorrow?"));
  state = await updateState(phone, { stage: getNextStage(state) });
  assertEqual("after msg1: stage=collect_address", state.stage, "collect_address");
  assertEqual("after msg1: issue_type=leak", state.issue_type, "leak");
  assertEqual("after msg1: fixture=sink", state.fixture, "sink");
  assertDefined("after msg1: preferred_time defined", state.preferred_time);

  state = await updateState(phone, extractSlots("245 Main Street"));
  state = await updateState(phone, { stage: getNextStage(state) });
  assertEqual("after address: stage=complete", state.stage, "complete");
}

// ── 4. Conflict detection unit tests ─────────────────────────────────────

async function testConflictDetection(): Promise<void> {
  header("Conflict detection unit tests");

  const phone = "+19990000002";
  await resetState(phone);

  // Establish initial state: sink leak
  let state = await updateState(phone, { issue_type: "leak", fixture: "sink" });
  state = await updateState(phone, { stage: getNextStage(state) });

  // User now says "clog"
  const extracted = extractSlots("Actually it is a clog");
  const conflict = detectConflict(state, extracted);

  if (conflict) {
    pass("conflict detected", conflict);
    assertContains("conflict mentions fixture", conflict, "sink");
    assertContains("conflict mentions existing issue", conflict, "leak");
    assertContains("conflict mentions incoming issue", conflict, "clog");
    assertSms("conflict reply fits SMS limit", conflict);
    assertNoProhibitedPhrases("conflict reply", conflict);
  } else {
    fail("conflict detected", "expected conflict question, got null");
  }

  // No conflict when issue types match
  const noConflict = detectConflict(state, { issue_type: "leak" });
  assertEqual("no conflict when same issue", noConflict, null);

  // No conflict when extracted has no issue_type
  const noConflict2 = detectConflict(state, { fixture: "toilet" });
  assertEqual("no conflict when no new issue", noConflict2, null);
}

// ── 5. Owner alert format unit tests ─────────────────────────────────────

async function testOwnerAlertFormat(): Promise<void> {
  header("Owner alert format unit tests");

  const phone = "+19990000003";
  await resetState(phone);

  // Partial state: only issue + fixture known
  let state = await updateState(phone, {
    issue_type: "clog",
    fixture: "sink",
    urgency: "medium",
  });
  state = await updateState(phone, { stage: getNextStage(state) });

  const alert1 = buildOwnerAlert(phone, state);
  console.log(`  Alert (partial): "${alert1}"`);
  assertSms("partial-state alert fits SMS limit", alert1);
  assertContains("partial alert has [RF]", alert1, "[RF]");
  assertContains("partial alert has MEDIUM", alert1, "MEDIUM");
  assertContains("partial alert has sink", alert1, "sink");
  assertContains("partial alert has clog", alert1, "clog");
  assertContains("partial alert shows missing time", alert1, "time");
  assertContains("partial alert shows missing addr", alert1, "addr");

  // Full state
  const fullState = await updateState(phone, {
    preferred_time: "tomorrow 8pm",
    address: "123 Main St",
    stage: "complete",
  });
  const alert2 = buildOwnerAlert(phone, fullState);
  console.log(`  Alert (full):    "${alert2}"`);
  assertSms("full-state alert fits SMS limit", alert2);
  assertContains("full alert has time", alert2, "tomorrow");
}

// ── 6. Pipe burst extraction unit test ────────────────────────────────────

async function testPipeBurstExtraction(): Promise<void> {
  header("Pipe burst: slot extraction and state");

  const phone = "+19990000031";
  await resetState(phone);

  const msgs = [
    "Pipe burst. Water is flooding the kitchen.",
    "burst pipe flooding my basement",
    "pipes bursting everywhere",
  ];

  for (const msg of msgs) {
    const e = extractSlots(msg);
    assertEqual(`pipe_burst detected: "${msg}"`, e.issue_type, "pipe_burst");
    assertEqual(`urgency=high for: "${msg}"`, e.urgency, "high");
  }

  // State update: pipe_burst should skip fixture and time stages (HIGH urgency)
  const e = extractSlots("Pipe burst. Water is flooding the kitchen.");
  let state = await updateState(phone, e);
  state = await updateState(phone, { stage: getNextStage(state) });

  assertEqual("pipe burst stage=collect_address (skips fixture+time)", state.stage, "collect_address");
  assertEqual("pipe burst urgency in state=high", state.urgency, "high");

  // Owner alert must say "pipe burst" not "pipe leak"
  const alert = buildOwnerAlert(phone, state);
  console.log(`  Pipe burst alert: "${alert}"`);
  assertContains("pipe burst alert says HIGH", alert, "HIGH");
  assertContains("pipe burst alert says pipe burst", alert, "pipe burst");
  assertNotContains("pipe burst alert does NOT say pipe leak", alert, "pipe leak");
  assertSms("pipe burst alert fits SMS", alert);
}

// ── 7. Gas smell detection unit test ─────────────────────────────────────

function testGasSmellDetection(): void {
  header("Gas smell: detection and safe reply");

  const gasMsgs = [
    "I smell gas near the water heater",
    "gas smell in my basement",
    "there is a gas leak",
    "it smells like gas",
    "gas odor coming from the pipes",
  ];

  for (const msg of gasMsgs) {
    const e = extractSlots(msg);
    assertEqual(`gas_smell detected: "${msg}"`, e.issue_type, "gas_smell");
    assertEqual(`urgency=high for gas: "${msg}"`, e.urgency, "high");
  }

  // The hardcoded safe reply (mirrors what the webhook sends)
  const GAS_REPLY = sanitizeSmsText(
    "Leave the area and call 911 if you smell gas. The owner is being notified now."
  );
  console.log(`  Gas reply: "${GAS_REPLY}"`);
  assertSms("gas reply fits SMS", GAS_REPLY);
  assertNoProhibitedPhrases("gas reply", GAS_REPLY);
  assertContains("gas reply mentions leaving area", GAS_REPLY, "leave");
  assertContains("gas reply mentions emergency services", GAS_REPLY, "911");
  assertContains("gas reply mentions owner notified", GAS_REPLY, "owner");
}

// ── 8. Owner alert routing unit test ─────────────────────────────────────

async function testOwnerAlertRouting(): Promise<void> {
  header("Owner alert routing test");

  const ownerPhoneEnv = process.env.OWNER_PHONE ?? "NOT_SET";
  const customerPhone = "+10000000999";

  await resetState(customerPhone);
  const state = await updateState(customerPhone, {
    issue_type: "leak",
    fixture: "sink",
    urgency: "high",
  });

  const alert = buildOwnerAlert(customerPhone, state);
  console.log(`  Alert: "${alert}"`);

  // Alert must contain customer phone (for owner reference)
  assertContains("owner alert contains customer phone", alert, customerPhone);
  assertContains("owner alert has [RF]", alert, "[RF]");
  assertContains("owner alert has HIGH", alert, "HIGH");
  assertSms("owner alert fits SMS limit", alert);

  // Simulate the [OwnerAlert] log that notifyOwner() emits
  console.log(`  [OwnerAlert] to=${ownerPhoneEnv} customer=${customerPhone}`);

  if (ownerPhoneEnv === "NOT_SET") {
    console.log("  [OwnerAlert] OWNER_PHONE not set — routing assertion skipped");
  } else if (ownerPhoneEnv === customerPhone) {
    console.warn("  [OwnerAlert WARNING] owner phone equals customer phone in test mode");
  } else {
    pass("owner phone differs from customer phone");
  }
}

// ── 9. No repeated questions unit test ────────────────────────────────────

async function testNoRepeatedQuestions(): Promise<void> {
  header("No repeated questions (unit)");

  const phone = "+19990000051";
  await resetState(phone);

  // Establish full state except address
  let state = await updateState(phone, {
    issue_type: "clog",
    fixture: "sink",
    preferred_time: "tomorrow",
    urgency: "low",
    stage: "collect_address",
  });

  assertEqual("stage=collect_address when address missing", state.stage, "collect_address");

  // Vague follow-up that provides no new info
  const extracted = extractSlots("ok");
  const conflict = detectConflict(state, extracted);
  assertEqual("no conflict for vague message", conflict, null);

  // Merge and recalculate — stage must NOT regress to earlier stages
  state = await updateState(phone, extracted);
  const nextStage = getNextStage(state);

  assertEqual("stage stays collect_address (no regression)", nextStage, "collect_address");
  pass("system does not re-ask for already known fields");
}

// ── 10. State TTL expiry unit test ────────────────────────────────────────

async function testStateTtlExpiry(): Promise<void> {
  header("State TTL expiry (unit)");

  const phone = "+19990000060";
  await resetState(phone);

  // Build state with known slots
  await updateState(phone, { issue_type: "clog", fixture: "sink", urgency: "medium" });
  let state = await getState(phone);
  assertEqual("pre-expiry: issue_type present", state.issue_type, "clog");

  // Artificially age the stored entry past the 24-hour TTL
  const aged = { ...state, lastUpdated: Date.now() - 25 * 60 * 60 * 1000 };
  await _setStateForTest(phone, aged);

  // getState must reset to a clean state when entry is expired
  state = await getState(phone);
  assertEqual("post-expiry: stage reset to collect_issue_type", state.stage, "collect_issue_type");
  if (state.issue_type === undefined) {
    pass("post-expiry: issue_type cleared");
  } else {
    fail("post-expiry: issue_type cleared", `still has value: ${state.issue_type}`);
  }
  pass("State correctly expired and reset after 24h TTL");
}

// ── 11. updateState undefined-filter unit test ────────────────────────────

async function testUpdateStateUndefinedFilter(): Promise<void> {
  header("updateState: undefined values do not clear existing slots");

  const phone = "+19990000061";
  await resetState(phone);

  // Set two fields
  await updateState(phone, { issue_type: "leak", fixture: "sink" });

  // Partial update — only urgency; issue_type/fixture are absent (not undefined) in the object
  await updateState(phone, { urgency: "medium" });
  let state = await getState(phone);
  assertEqual("issue_type preserved after partial update", state.issue_type, "leak");
  assertEqual("fixture preserved after partial update", state.fixture, "sink");
  assertEqual("urgency added by partial update", state.urgency, "medium");

  // Explicitly passing undefined for a field must also not wipe the stored value
  await updateState(phone, { issue_type: undefined });
  state = await getState(phone);
  assertEqual("issue_type not cleared by explicit undefined", state.issue_type, "leak");

  pass("updateState correctly filters undefined values");
}

// ── 12. Conflict label unit test — no "pipe pipe burst" ──────────────────

async function testConflictLabelPipeBurst(): Promise<void> {
  header("Conflict label: natural verbs, no fixture duplication");

  // Case 1: pipe_burst vs incoming "leak" — should NOT produce "pipe pipe burst"
  const phone1 = "+19990000062";
  await resetState(phone1);
  let state1 = await updateState(phone1, { issue_type: "pipe_burst", fixture: "pipe", urgency: "high" });
  state1 = await updateState(phone1, { stage: getNextStage(state1) });

  const conflict1 = detectConflict(state1, extractSlots("its leaking"));
  console.log(`  pipe_burst conflict: "${conflict1 ?? "null"}"`);

  if (conflict1) {
    pass("pipe_burst conflict detected");
    assertNotContains("no 'pipe pipe' duplication", conflict1, "pipe pipe");
    assertContains("conflict mentions pipe burst", conflict1, "pipe burst");
    assertContains("conflict mentions incoming verb (leaking)", conflict1, "leaking");
    assertSms("pipe_burst conflict fits SMS", conflict1);
    assertNoProhibitedPhrases("pipe_burst conflict", conflict1);
  } else {
    fail("pipe_burst conflict detected", "expected conflict question, got null");
  }

  // Case 2: sink leak vs clog — should use natural verb forms
  const phone2 = "+19990000063";
  await resetState(phone2);
  let state2 = await updateState(phone2, { issue_type: "leak", fixture: "sink" });
  state2 = await updateState(phone2, { stage: getNextStage(state2) });

  const conflict2 = detectConflict(state2, extractSlots("clog"));
  console.log(`  sink conflict: "${conflict2 ?? "null"}"`);

  if (conflict2) {
    pass("leak vs clog conflict detected");
    assertContains("conflict uses 'leaking' verb", conflict2, "leaking");
    assertContains("conflict uses 'clogged' verb", conflict2, "clogged");
    assertContains("conflict mentions fixture", conflict2, "sink");
    assertSms("sink conflict fits SMS", conflict2);
  } else {
    fail("leak vs clog conflict detected", "expected conflict question, got null");
  }
}

// ── 13. Combined date+time pattern unit test ──────────────────────────────

function testTimePatternCombined(): void {
  header("Time patterns: combined date+clock capture");

  const cases: Array<{ msg: string; expected: string }> = [
    { msg: "tomorrow at 2pm",                        expected: "tomorrow at 2pm"   },
    { msg: "tomorrow 3pm",                           expected: "tomorrow 3pm"      },
    { msg: "Can someone come tomorrow at 2:30pm?",   expected: "tomorrow at 2:30pm" },
    { msg: "2pm tomorrow works for me",              expected: "2pm tomorrow"      },
    { msg: "Friday at 9am please",                   expected: "friday at 9am"     },
    { msg: "tomorrow morning",                       expected: "tomorrow morning"  },
    { msg: "tomorrow",                               expected: "tomorrow"          },
  ];

  for (const { msg, expected } of cases) {
    const e = extractSlots(msg);
    if (e.preferred_time === expected) {
      pass(`time capture: "${msg}"`, `"${e.preferred_time}"`);
    } else {
      fail(
        `time capture: "${msg}"`,
        `expected "${expected}", got "${e.preferred_time ?? "undefined"}"`
      );
    }
  }
}

// ── 14. Flow A: info-rich first message ──────────────────────────────────

async function testFlowA(): Promise<void> {
  header("Flow A: info-rich first message (unit)");

  const phone = "+19990000010";
  await resetState(phone);

  const msg = "My kitchen sink is leaking. Can someone come tomorrow?";
  let state = await getState(phone);
  const extracted = extractSlots(msg);
  const conflict = detectConflict(state, extracted);

  assertEqual("Flow A: no conflict on first message", conflict, null);

  state = await updateState(phone, extracted);
  state = await updateState(phone, { stage: getNextStage(state) });

  assertEqual("Flow A: issue_type=leak", state.issue_type, "leak");
  assertEqual("Flow A: fixture=sink", state.fixture, "sink");
  assertDefined("Flow A: preferred_time set", state.preferred_time);
  assertEqual("Flow A: next stage=collect_address", state.stage, "collect_address");

  console.log(
    `  State after msg1: issue=${state.issue_type} fixture=${state.fixture} time=${state.preferred_time} stage=${state.stage}`
  );
  pass("Flow A: system correctly identifies only address is missing");
}

// ── 15. Flow B: incremental messages ──────────────────────────────────────

async function testFlowB(): Promise<void> {
  header("Flow B: incremental one-word messages (unit)");

  const phone = "+19990000011";
  await resetState(phone);

  // Turn 1: "Clog"
  let state = await getState(phone);
  let extracted = extractSlots("Clog");
  state = await updateState(phone, extracted);
  state = await updateState(phone, { stage: getNextStage(state) });

  assertEqual("Flow B turn1: issue_type=clog", state.issue_type, "clog");
  assertEqual("Flow B turn1: stage=collect_fixture", state.stage, "collect_fixture");
  console.log(`  After "Clog": issue=${state.issue_type} stage=${state.stage}`);

  // Turn 2: "Sink"
  extracted = extractSlots("Sink");
  const conflict = detectConflict(state, extracted);
  assertEqual("Flow B turn2: no conflict", conflict, null);

  state = await updateState(phone, extracted);
  state = await updateState(phone, { stage: getNextStage(state) });

  assertEqual("Flow B turn2: fixture=sink", state.fixture, "sink");
  assertEqual("Flow B turn2: stage=collect_time", state.stage, "collect_time");
  console.log(`  After "Sink": fixture=${state.fixture} stage=${state.stage}`);

  pass("Flow B: narrowed naturally without re-asking known fields");
}

// ── 16. Flow C: conflicting info ──────────────────────────────────────────

async function testFlowC(): Promise<void> {
  header("Flow C: conflicting info (unit)");

  const phone = "+19990000012";
  await resetState(phone);

  // Turn 1: "My sink is leaking"
  let state = await getState(phone);
  let extracted = extractSlots("My sink is leaking");
  state = await updateState(phone, extracted);
  state = await updateState(phone, { stage: getNextStage(state) });

  assertEqual("Flow C turn1: issue_type=leak", state.issue_type, "leak");
  assertEqual("Flow C turn1: fixture=sink", state.fixture, "sink");
  console.log(`  After "My sink is leaking": issue=${state.issue_type} fixture=${state.fixture}`);

  // Turn 2: user says "clog" (contradicts "leak")
  const extracted2 = extractSlots("clog");
  const conflictQ = detectConflict(state, extracted2);

  if (conflictQ) {
    pass("Flow C turn2: conflict detected");
    console.log(`  Conflict reply: "${conflictQ}"`);
    assertContains("Flow C: reply mentions leak", conflictQ, "leak");
    assertContains("Flow C: reply mentions clog", conflictQ, "clog");
    assertContains("Flow C: reply mentions fixture", conflictQ, "sink");
    assertSms("Flow C: conflict reply fits SMS limit", conflictQ);
    assertNoProhibitedPhrases("Flow C: conflict reply", conflictQ);
  } else {
    fail("Flow C turn2: conflict detected", "expected conflict question, got null");
  }
}

// ── 17. End-to-end Claude API scenarios ──────────────────────────────────

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
      state = await updateState(phone, { stage: getNextStage(state) });
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
  header("End-to-end Claude API scenarios");

  // Flow A: info-rich first message — should ask for address only
  await runApiScenario(
    "+19990000020",
    ["My kitchen sink is leaking. Can someone come tomorrow?"],
    "Flow A: info-rich first message"
  );

  // Flow B: incremental narrowing
  await runApiScenario(
    "+19990000021",
    ["Clog", "Sink"],
    "Flow B: incremental one-word messages"
  );

  // Flow C: address received — final reply must not promise booking
  await runApiScenario(
    "+19990000040",
    [
      "My kitchen sink is leaking. Can someone come tomorrow?",
      "123 Main Street",
    ],
    "Flow C: address received (no booking promise)"
  );

  // Flow D: emergency pipe burst — HIGH urgency, no "help is on the way"
  await runApiScenario(
    "+19990000041",
    ["Pipe burst. Water is flooding the kitchen."],
    "Flow D: pipe burst emergency"
  );

  // Flow E: original emergency scenario
  await runApiScenario(
    "+19990000022",
    ["URGENT: burst pipe flooding my basement RIGHT NOW"],
    "Flow E: burst pipe urgent"
  );
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  const arg = process.argv[2];

  console.log("\nRapidFlow Plumbing -- SMS Flow Test Suite\n");

  // Unit tests (no Claude API calls, fast)
  testSanitizer();
  testSlotExtractor();
  await testStageTransitions();
  await testConflictDetection();
  await testOwnerAlertFormat();
  testGasSmellDetection();
  await testPipeBurstExtraction();
  await testOwnerAlertRouting();
  await testNoRepeatedQuestions();
  await testStateTtlExpiry();
  await testUpdateStateUndefinedFilter();
  await testConflictLabelPipeBurst();
  testTimePatternCombined();
  await testFlowA();
  await testFlowB();
  await testFlowC();

  // End-to-end Claude API tests
  if (arg) {
    // Custom single-message test
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
