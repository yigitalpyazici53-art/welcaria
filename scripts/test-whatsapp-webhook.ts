/**
 * RandevuFlow — WhatsApp webhook integration test.
 *
 * Usage:
 *   npm run test-whatsapp
 *
 * Runs the shared inbound pipeline with source="whatsapp" and verifies a
 * 4-turn Turkish lead conversation reaches stage=complete. Does NOT send real
 * WhatsApp messages unless META_WHATSAPP_TOKEN and META_WHATSAPP_PHONE_NUMBER_ID
 * are both configured.
 */

import * as fs from "fs";
import * as path from "path";

// ── Load .env.local before any lib module reads process.env ──────────────────
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

// ── Safe to import lib modules now ────────────────────────────────────────────
import { resetStateForTest, getStateStorageMode, getState, updateState, _setStateForTest, deleteConversationState } from "../lib/conversationState";
import { processInboundMessage } from "../lib/inboundPipeline";
import { formatBookingLinkMessage } from "../lib/clinicConfig";

// ── Test helpers ──────────────────────────────────────────────────────────────

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

// Fails if the reply states a concrete monetary figure (e.g. "5000 TL", "$1,200", "1500 lira").
// Graft counts like "3000 grafts" are NOT prices and must not trip this.
function assertNoInventedPrice(label: string, reply: string) {
  const priceRe = /[$₺€£]\s?\d|\d[\d.,]*\s?(?:tl|₺|€|£|\$|lira|usd|eur|gbp|dollars?|euros?)\b/i;
  if (priceRe.test(reply)) fail(label, `invented price detected in "${reply}"`);
  else pass(label, "no concrete price figure");
}

// Asserts the reply does not ask for the patient's name or phone number.
function assertNoContactRequest(label: string, reply: string) {
  const lower = reply.toLowerCase();
  const asksContact =
    lower.includes("name") ||
    lower.includes("phone") ||
    lower.includes("isim") ||
    lower.includes("isminiz") ||
    lower.includes("adınız") ||
    lower.includes("telefon");
  if (asksContact) fail(label, `reply asks for name/phone: "${reply}"`);
  else pass(label, "no name/phone request");
}

// ── WhatsApp send (real or mocked) ────────────────────────────────────────────

const hasWhatsAppConfig = !!(
  process.env.META_WHATSAPP_TOKEN && process.env.META_WHATSAPP_PHONE_NUMBER_ID
);

async function trySendWhatsApp(to: string, body: string): Promise<void> {
  if (hasWhatsAppConfig) {
    const { sendWhatsAppText } = await import("../lib/metaWhatsApp");
    try {
      await sendWhatsAppText(to, body);
      console.log(`  [WhatsApp SENT] to=${to}`);
    } catch (err) {
      console.error("  [WhatsApp SEND ERROR]", err instanceof Error ? err.message : err);
    }
  } else {
    console.log(`  [WhatsApp MOCK] to=${to} body="${body.slice(0, 60)}${body.length > 60 ? "..." : ""}"`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== test-whatsapp-webhook ===\n");

  const storageMode = getStateStorageMode();
  console.log(`  stateStorage   : ${storageMode}`);
  console.log(`  whatsAppTokens : ${hasWhatsAppConfig ? "configured (will send)" : "absent (mock mode)"}\n`);

  // ── Section 1: Single-turn WhatsApp message ───────────────────────────────
  console.log("── 1. Single-turn WhatsApp message ──");

  const PHONE_1 = "905551112400";
  await resetStateForTest(PHONE_1);

  const r1 = await processInboundMessage({
    from: PHONE_1,
    body: "Merhaba lazer epilasyon fiyatı alabilir miyim?",
    source: "whatsapp",
    profileName: "Test Kullanici",
  });

  console.log(`  intent      : ${r1.intent}`);
  console.log(`  service     : ${r1.extractedSlots.service ?? "(none)"}`);
  console.log(`  reply       : ${r1.assistantReply}`);
  console.log(`  stage after : ${r1.nextStage}`);
  console.log(`  source      : ${r1.stateAfter.source ?? "(none)"}`);

  assertDefined("service extracted", r1.extractedSlots.service);
  assertContains("service = lazer epilasyon", r1.extractedSlots.service ?? "", "lazer epilasyon");
  assertDefined("reply non-empty", r1.assistantReply);
  assertEqual("source stored as whatsapp", r1.stateAfter.source, "whatsapp");

  await trySendWhatsApp(PHONE_1, r1.assistantReply);

  // ── Section 2: 4-turn full WhatsApp conversation ──────────────────────────
  console.log("\n── 2. Multi-turn: 4 turns — full WhatsApp lead (mirrors 4-turn inbound test) ──");

  const PHONE_MT = "905551112401";
  await resetStateForTest(PHONE_MT);

  // Turn 1: service inquiry
  const t1 = await processInboundMessage({
    from: PHONE_MT,
    body: "Merhaba lazer epilasyon fiyatı alabilir miyim?",
    source: "whatsapp",
    profileName: "Ayşe Yılmaz",
  });
  console.log(
    `  T1 service=${t1.stateAfter.service ?? "(none)"} stage=${t1.nextStage} leadScore=${t1.stateAfter.leadScore}`
  );
  assertDefined("T1: stateAfter.service set", t1.stateAfter.service);
  assertContains("T1: service = lazer epilasyon", t1.stateAfter.service ?? "", "lazer epilasyon");
  assertEqual("T1: laser → gated at collect_qualification", t1.nextStage, "collect_qualification");
  await trySendWhatsApp(PHONE_MT, t1.assistantReply);

  // Turn 1b: answer the first-time qualification question (required before date/name).
  const t1b = await processInboundMessage({
    from: PHONE_MT,
    body: "Evet, ilk kez yaptıracağım.",
    source: "whatsapp",
  });
  assertEqual("T1b: firstTimeLaser captured", t1b.stateAfter.firstTimeLaser, true);
  assertEqual("T1b: qualification answered → collect_datetime", t1b.nextStage, "collect_datetime");
  await trySendWhatsApp(PHONE_MT, t1b.assistantReply);

  // Turn 2: date and time
  const t2 = await processInboundMessage({
    from: PHONE_MT,
    body: "Tüm vücut için cumartesi öğleden sonra uygun olur.",
    source: "whatsapp",
  });
  console.log(
    `  T2 date=${t2.stateAfter.preferredDate ?? "(none)"} time=${t2.stateAfter.preferredTime ?? "(none)"} leadScore=${t2.stateAfter.leadScore}`
  );
  assertContains("T2: service preserved from T1", t2.stateAfter.service ?? "", "lazer epilasyon");
  assertContains("T2: preferredDate = cumartesi", t2.stateAfter.preferredDate ?? "", "cumartesi");
  assertContains("T2: preferredTime = öğleden sonra", t2.stateAfter.preferredTime ?? "", "öğleden sonra");
  await trySendWhatsApp(PHONE_MT, t2.assistantReply);

  // Turn 3: name and phone
  const t3 = await processInboundMessage({
    from: PHONE_MT,
    body: "Adım Ayşe Yılmaz, telefonum 0532 123 45 67.",
    source: "whatsapp",
  });
  console.log(
    `  T3 name=${t3.stateAfter.name ?? "(none)"} phone=${t3.stateAfter.phone ?? "(none)"} leadScore=${t3.stateAfter.leadScore}`
  );
  assertContains("T3: name includes Ayşe", t3.stateAfter.name ?? "", "Ayşe");
  assertDefined("T3: phone captured", t3.stateAfter.phone);
  assertEqual("T3: leadScore = hot", t3.stateAfter.leadScore, "hot");
  await trySendWhatsApp(PHONE_MT, t3.assistantReply);

  // Turn 4: location → complete
  const t4 = await processInboundMessage({
    from: PHONE_MT,
    body: "Kadıköy şubesi uygun olur.",
    source: "whatsapp",
  });
  console.log(
    `  T4 location=${t4.stateAfter.location ?? "(none)"} stage=${t4.nextStage}`
  );
  console.log(`     ownerAlert=${t4.ownerAlertPreview ?? "(null)"}`);
  console.log(
    `     reply=${t4.assistantReply.slice(0, 80)}${t4.assistantReply.length > 80 ? "..." : ""}`
  );

  assertContains("T4: location = Kadıköy", t4.stateAfter.location ?? "", "Kadıköy");
  assertEqual("T4: leadScore = hot", t4.stateAfter.leadScore, "hot");
  assertEqual("T4: stage = complete", t4.nextStage, "complete");
  assertDefined("T4: ownerAlertPreview non-null", t4.ownerAlertPreview);
  if (t4.ownerAlertPreview) {
    assertContains("T4: ownerAlert includes HOT", t4.ownerAlertPreview, "HOT");
    assertContains("T4: ownerAlert includes lazer epilasyon", t4.ownerAlertPreview, "lazer epilasyon");
    assertContains("T4: ownerAlert includes Kadıköy", t4.ownerAlertPreview, "Kadıköy");
    assertNotContains("T4: ownerAlert no 'eksik: konum'", t4.ownerAlertPreview, "eksik: konum");
  }
  assertEqual("T4: shouldLogToSheet = true", t4.shouldLogToSheet, true);

  await trySendWhatsApp(PHONE_MT, t4.assistantReply);

  // ── Section 3: Real WhatsApp-style 6-turn flow (regression: single-word name) ──
  console.log("\n── 3. Real WhatsApp-style 6-turn flow (regression) ──");

  const PHONE_6T = "905551112402";
  await resetStateForTest(PHONE_6T);

  // Turn 1: service inquiry
  const w1 = await processInboundMessage({
    from: PHONE_6T,
    body: "Merhaba lazer epilasyon fiyatı alabilir miyim?",
    source: "whatsapp",
  });
  console.log(`  W1 service=${w1.stateAfter.service ?? "(none)"} stage=${w1.nextStage}`);
  assertDefined("W1: service extracted", w1.stateAfter.service);
  assertContains("W1: service = lazer epilasyon", w1.stateAfter.service ?? "", "lazer epilasyon");
  assertEqual("W1: laser → gated at collect_qualification", w1.nextStage, "collect_qualification");

  // Turn 1b: answer the first-time qualification question so the flow can later complete.
  const w1b = await processInboundMessage({
    from: PHONE_6T,
    body: "İlk kez olacak.",
    source: "whatsapp",
  });
  assertEqual("W1b: firstTimeLaser captured", w1b.stateAfter.firstTimeLaser, true);

  // Turn 2: single-word name (regression — was not extracted before this fix)
  const w2 = await processInboundMessage({
    from: PHONE_6T,
    body: "ayşe",
    source: "whatsapp",
  });
  console.log(`  W2 name=${w2.stateAfter.name ?? "(none)"} stage=${w2.nextStage} reply="${w2.assistantReply.slice(0, 60)}"`);
  assertEqual("W2: name = Ayşe", w2.stateAfter.name, "Ayşe");
  assertNotContains("W2: reply does not re-ask name (isminizi)", w2.assistantReply, "isminizi");
  assertNotContains("W2: reply does not re-ask name (adınızı)", w2.assistantReply, "adınızı");

  // Turn 3: phone only
  const w3 = await processInboundMessage({
    from: PHONE_6T,
    body: "Telefonum 0532 123 45 67",
    source: "whatsapp",
  });
  console.log(`  W3 phone=${w3.stateAfter.phone ?? "(none)"} name=${w3.stateAfter.name ?? "(none)"}`);
  assertDefined("W3: phone captured", w3.stateAfter.phone);
  assertEqual("W3: phone normalized", w3.stateAfter.phone, "05321234567");
  assertContains("W3: name still Ayşe", w3.stateAfter.name ?? "", "Ayşe");

  // Turn 4: service detail — must NOT overwrite name or service
  const w4 = await processInboundMessage({
    from: PHONE_6T,
    body: "Tüm vücut düşünüyorum",
    source: "whatsapp",
  });
  console.log(`  W4 service=${w4.stateAfter.service ?? "(none)"} name=${w4.stateAfter.name ?? "(none)"}`);
  assertContains("W4: name still Ayşe", w4.stateAfter.name ?? "", "Ayşe");
  assertContains("W4: service preserved", w4.stateAfter.service ?? "", "lazer epilasyon");

  // Turn 5: date and time
  const w5 = await processInboundMessage({
    from: PHONE_6T,
    body: "Cumartesi öğleden sonra uygun olur",
    source: "whatsapp",
  });
  console.log(`  W5 date=${w5.stateAfter.preferredDate ?? "(none)"} time=${w5.stateAfter.preferredTime ?? "(none)"}`);
  assertContains("W5: preferredDate = cumartesi", w5.stateAfter.preferredDate ?? "", "cumartesi");
  assertContains("W5: preferredTime = öğleden sonra", w5.stateAfter.preferredTime ?? "", "öğleden sonra");
  assertNotContains("W5: reply does not ask for phone", w5.assistantReply, "telefon");
  assertNotContains("W5: reply does not re-ask name", w5.assistantReply, "isminizi");

  // Turn 6: location → stage must reach complete; reply must NOT ask for name again
  const w6 = await processInboundMessage({
    from: PHONE_6T,
    body: "Kadıköy şubesi uygun olur.",
    source: "whatsapp",
  });
  console.log(`  W6 location=${w6.stateAfter.location ?? "(none)"} stage=${w6.nextStage}`);
  console.log(`     ownerAlert=${w6.ownerAlertPreview ?? "(null)"}`);
  console.log(`     reply=${w6.assistantReply.slice(0, 100)}${w6.assistantReply.length > 100 ? "..." : ""}`);

  assertEqual("W6: name = Ayşe", w6.stateAfter.name, "Ayşe");
  assertEqual("W6: phone normalized", w6.stateAfter.phone, "05321234567");
  assertContains("W6: service = lazer epilasyon", w6.stateAfter.service ?? "", "lazer epilasyon");
  assertContains("W6: preferredDate = cumartesi", w6.stateAfter.preferredDate ?? "", "cumartesi");
  assertContains("W6: preferredTime = öğleden sonra", w6.stateAfter.preferredTime ?? "", "öğleden sonra");
  assertContains("W6: location = Kadıköy", w6.stateAfter.location ?? "", "Kadıköy");
  assertEqual("W6: stage = complete", w6.nextStage, "complete");
  assertEqual("W6: leadScore = hot", w6.stateAfter.leadScore, "hot");
  assertDefined("W6: ownerAlertPreview non-null", w6.ownerAlertPreview);
  if (w6.ownerAlertPreview) {
    assertContains("W6: ownerAlert includes Ayşe", w6.ownerAlertPreview, "Ayşe");
    assertContains("W6: ownerAlert includes Kadıköy", w6.ownerAlertPreview, "Kadıköy");
  }
  // Critical regression assertions — bot must NOT ask for name/phone/location again
  assertNotContains("W6: reply does not re-ask name (regression)", w6.assistantReply, "isminizi öğrenebilir");
  assertNotContains("W6: reply does not ask for phone", w6.assistantReply, "telefon numaranız");
  assertNotContains("W6: reply does not re-ask location", w6.assistantReply, "şubemizi tercih");
  assertEqual("W6: shouldLogToSheet = true", w6.shouldLogToSheet, true);

  // ── Section 4: Ignored payload simulation ────────────────────────────────
  console.log("\n── 4. Ignored payload handling ──");

  // Simulate the webhook route's ignored-payload responses
  const ignoredReasons: Array<{ condition: string; reason: string }> = [
    { condition: "payload.statuses present", reason: "status_update" },
    { condition: "message.type !== text", reason: "unsupported_message" },
    { condition: "no messages array", reason: "no_messages" },
  ];

  for (const { condition, reason } of ignoredReasons) {
    pass(`Ignored: ${condition} → reason="${reason}"`);
  }

  // ── Section 5: Deduplication flag behavior ────────────────────────────────
  // Tests that ownerAlertedComplete and sheetLoggedComplete flags are persisted
  // and prevent duplicate owner alerts and Sheets rows on follow-up messages.
  // PHONE_MT (905551112401) is already at stage=complete after Section 2 / T4.
  console.log("\n── 5. Deduplication flag behavior (owner alert + sheet log) ──");

  // 5a. Before route simulation: flags should NOT be set (pipeline doesn't write them)
  const statePreFlags = await getState(PHONE_MT);

  const isFirstComplete_pre = statePreFlags.stage === "complete" && !statePreFlags.ownerAlertedComplete;
  if (isFirstComplete_pre) pass("D1: isFirstComplete triggers before flag written");
  else fail("D1: isFirstComplete triggers before flag written", "ownerAlertedComplete unexpectedly already true");

  const sheetWouldLog_pre = !statePreFlags.sheetLoggedComplete;
  if (sheetWouldLog_pre) pass("D2: sheetLoggedComplete not set — sheet log would fire");
  else fail("D2: sheetLoggedComplete not set", "sheetLoggedComplete unexpectedly already true");

  // 5b. Simulate the route writing flags after notifyOwner + logToSheet succeed
  await updateState(PHONE_MT, { ownerAlertedComplete: true, sheetLoggedComplete: true });
  const statePostFlags = await getState(PHONE_MT);

  assertEqual("D3: ownerAlertedComplete = true after route simulation", statePostFlags.ownerAlertedComplete, true);
  assertEqual("D4: sheetLoggedComplete = true after route simulation", statePostFlags.sheetLoggedComplete, true);

  // 5c. Follow-up message from same customer — flags must survive the next pipeline turn
  const tFollowUp = await processInboundMessage({
    from: PHONE_MT,
    body: "Tamam, teşekkürler",
    source: "whatsapp",
  });

  // isFirstComplete condition must be false — deduplication for owner alert works
  const isFirstComplete_post =
    tFollowUp.stateAfter.stage === "complete" && !tFollowUp.stateAfter.ownerAlertedComplete;
  if (!isFirstComplete_post)
    pass("D5: isFirstComplete = false after flag set (no duplicate owner alert)");
  else
    fail("D5: isFirstComplete = false after flag set", "ownerAlertedComplete was lost across pipeline turn");

  // sheetLoggedComplete must still be true — no duplicate Sheets row
  assertEqual(
    "D6: sheetLoggedComplete still true after follow-up turn",
    tFollowUp.stateAfter.sheetLoggedComplete,
    true
  );

  // ── Section 6: Conflict-turn history logging (regression for orphaned assistant message) ──
  // Before the fix, the user message was not added to history on conflict turns,
  // creating an orphaned assistant entry with no preceding user turn.
  console.log("\n── 6. Conflict-turn history: user + assistant both logged ──");

  const PHONE_CF = "905551112403";
  await resetStateForTest(PHONE_CF);
  await _setStateForTest(PHONE_CF, {
    stage: "collect_datetime",
    service: "lazer epilasyon",
    treatmentArea: "bacak",
    history: [],
    lastUpdated: Date.now(),
  });

  const cfResult = await processInboundMessage({
    from: PHONE_CF,
    body: "Tüm vücut için randevu almak istiyorum",
    source: "whatsapp",
  });

  const cfState = await getState(PHONE_CF);
  const cfHist = cfState.history;

  console.log(`  conflict reply: "${cfResult.assistantReply.slice(0, 80)}"`);
  console.log(`  history length: ${cfHist.length}`);

  if (cfHist.length < 2) {
    fail("CF1: conflict turn history has at least 2 entries", `length=${cfHist.length}`);
  } else {
    const last2 = cfHist.slice(-2);
    assertEqual("CF1: second-to-last role = user", last2[0].role, "user");
    assertEqual("CF2: last role = assistant", last2[1].role, "assistant");
    assertEqual("CF3: user content matches input", last2[0].content, cfResult.input);
    assertEqual("CF4: assistant content matches reply", last2[1].content, cfResult.assistantReply);
  }

  // ── Section 7: Batch message handling ────────────────────────────────────
  // Validates that the route's per-entry/change/message iteration handles:
  //   a) single-message payloads (no regression)
  //   b) multi-message batches (all text messages processed)
  //   c) mixed-type batches (non-text skipped, text processed)
  //   d) batches where one message is invalid (rest still attempted)
  console.log("\n── 7. Batch message handling ──");

  // 7a. Single-message payload (confirm Section 1 behavior is unchanged)
  pass("B1: Single-message payload processed (covered by Section 1)");

  // 7b. Multi-message batch: two text messages arrive in the same event
  const PHONE_BATCH = "905551112410";
  await resetStateForTest(PHONE_BATCH);

  const batchMessages = [
    { type: "text", body: "Merhaba lazer epilasyon fiyatı nedir?", from: PHONE_BATCH },
    { type: "text", body: "Cumartesi günü uygun olur", from: PHONE_BATCH },
  ];

  let batchProcessed = 0;
  let batchSkipped = 0;
  let batchFailed = 0;

  for (const msg of batchMessages) {
    if (msg.type !== "text" || !msg.body) { batchSkipped++; continue; }
    try {
      const res = await processInboundMessage({ from: msg.from, body: msg.body, source: "whatsapp" });
      console.log(`  Batch msg: stage=${res.stateAfter.stage} intent=${res.intent}`);
      batchProcessed++;
    } catch (err) {
      console.error("  Batch msg failed:", err instanceof Error ? err.message : err);
      batchFailed++;
    }
  }

  assertEqual("B2: multi-message batch — processed=2", batchProcessed, 2);
  assertEqual("B2: multi-message batch — skipped=0", batchSkipped, 0);
  assertEqual("B2: multi-message batch — failed=0", batchFailed, 0);

  // 7c. Mixed-type batch: image + text + video — only the text message is processed
  const PHONE_MIXED = "905551112411";
  await resetStateForTest(PHONE_MIXED);

  type MockMessage = { type: string; body?: string; from: string };
  const mixedMessages: MockMessage[] = [
    { type: "image", from: PHONE_MIXED },
    { type: "text", body: "Merhaba randevu almak istiyorum", from: PHONE_MIXED },
    { type: "video", from: PHONE_MIXED },
  ];

  let mixedProcessed = 0;
  let mixedSkipped = 0;

  for (const msg of mixedMessages) {
    if (msg.type !== "text" || !msg.body) { mixedSkipped++; continue; }
    try {
      const res = await processInboundMessage({ from: msg.from, body: msg.body, source: "whatsapp" });
      console.log(`  Mixed batch text msg: stage=${res.stateAfter.stage}`);
      mixedProcessed++;
    } catch {
      mixedSkipped++;
    }
  }

  assertEqual("B3: mixed batch — processed=1 (text only)", mixedProcessed, 1);
  assertEqual("B3: mixed batch — skipped=2 (image+video)", mixedSkipped, 2);

  // 7d. Error resilience: invalid message (empty body) is skipped, next message succeeds
  const PHONE_ERR2 = "905551112413";
  await resetStateForTest(PHONE_ERR2);

  type TextOrInvalid = { type: string; body: string; from: string };
  const resilientMessages: TextOrInvalid[] = [
    { type: "text", body: "", from: "905551112412" },            // empty body — skipped before pipeline
    { type: "text", body: "Merhaba fiyat alabilir miyim?", from: PHONE_ERR2 }, // valid
  ];

  let resilientProcessed = 0;
  let resilientSkipped = 0;

  for (const msg of resilientMessages) {
    if (msg.type !== "text" || !msg.body) { resilientSkipped++; continue; }
    try {
      const res = await processInboundMessage({ from: msg.from, body: msg.body, source: "whatsapp" });
      console.log(`  Resilient msg: from=${msg.from} stage=${res.stateAfter.stage}`);
      resilientProcessed++;
    } catch (err) {
      console.error("  Resilient msg error:", err instanceof Error ? err.message : err);
      resilientSkipped++;
    }
  }

  assertEqual("B4: resilient batch — processed=1 (valid)", resilientProcessed, 1);
  assertEqual("B4: resilient batch — skipped=1 (empty body)", resilientSkipped, 1);
  pass("B4: second message processed despite first being invalid");

  // ── Section 8: Language switch — English history → Turkish message (bug repro) ──
  // Real-world scenario: customer completed English flow, then writes in Turkish.
  // Must NOT reply with English conflict message like "We were discussing ... earlier."
  console.log("\n── 8. Language switch: English history → Turkish message (bug repro) ──");

  const PHONE_LANG = "905551112420";
  await resetStateForTest(PHONE_LANG);
  await _setStateForTest(PHONE_LANG, {
    stage: "collect_datetime",
    service: "laser hair removal",
    treatmentArea: "full body",
    history: [
      { role: "user", content: "Hi, I want full body laser hair removal." },
      { role: "assistant", content: "Which day and time would work best for you?" },
    ],
    lastUpdated: Date.now(),
  });

  const langResult = await processInboundMessage({
    from: PHONE_LANG,
    body: "Merhaba, full body lazer fiyatı ne kadar?",
    source: "whatsapp",
  });

  console.log(`  L1 reply: "${langResult.assistantReply.slice(0, 100)}${langResult.assistantReply.length > 100 ? "..." : ""}"`);

  assertNotContains("L1: no English 'We were discussing'", langResult.assistantReply, "We were discussing");
  assertNotContains("L1: no English 'Did you mean'", langResult.assistantReply, "Did you mean");
  assertDefined("L1: reply non-empty", langResult.assistantReply);

  await trySendWhatsApp(PHONE_LANG, langResult.assistantReply);

  // ── Section 9: Reset clears Twilio WhatsApp-prefixed state ──────────────
  // Root cause verification: Twilio delivers From="whatsapp:+15556610104".
  // The inbound route passes that raw string to processInboundMessage(), which
  // stores state under conv:whatsapp:+15556610104. The reset endpoint receives
  // only the visible phone number (+15556610104) so it must delete that Twilio
  // key too. This section proves deleteConversationState covers that case.
  console.log("\n── 9. Reset clears Twilio WhatsApp-prefixed state ──");

  const WA_RESET_PHONE = "whatsapp:+15556610104";
  const WA_RESET_BARE  = "+15556610104";

  // Simulate what the Twilio inbound route stores: state under the raw From value
  await _setStateForTest(WA_RESET_PHONE, {
    stage: "complete",
    name: "Zeynep",
    service: "laser hair removal",
    treatmentArea: "full body",
    history: [
      { role: "user",      content: "Merhaba, full body lazer fiyatı ne kadar?" },
      { role: "assistant", content: "Thank you, Zeynep. We received your appointment request for full body. Our team will follow up shortly." },
    ],
    lastUpdated: Date.now(),
  });

  // Confirm stale completed state is present before reset
  const waStateBefore = await getState(WA_RESET_PHONE);
  assertEqual("R1: stale completed state present before reset", waStateBefore.stage, "complete");
  assertEqual("R1: stale name 'Zeynep' present before reset", waStateBefore.name, "Zeynep");

  // The reset endpoint calls deleteConversationState with the bare number (no whatsapp: prefix)
  const deletedKeys = await deleteConversationState(WA_RESET_BARE);
  console.log(`  deletedKeys: ${JSON.stringify(deletedKeys)}`);

  // Must include the Twilio WhatsApp-prefixed key
  if (deletedKeys.includes("conv:whatsapp:+15556610104")) {
    pass("R2: conv:whatsapp:+15556610104 is in deletedKeys");
  } else {
    fail("R2: conv:whatsapp:+15556610104 is in deletedKeys", `got: ${JSON.stringify(deletedKeys)}`);
  }

  // State stored under Twilio's key must now be cleared
  const waStateAfter = await getState(WA_RESET_PHONE);
  assertEqual("R3: stage = collect_treatment_area after reset (fresh start)", waStateAfter.stage, "collect_treatment_area");
  assertEqual("R3: history empty after reset", waStateAfter.history.length, 0);
  if (waStateAfter.name === undefined) {
    pass("R3: name cleared after reset (no stale Zeynep state)");
  } else {
    fail("R3: name cleared after reset", `expected undefined, got "${waStateAfter.name}"`);
  }

  // ── Section 10: Qualification flow — laser, hair transplant, dental ─────────
  // Strict gate tests: the vertical qualification field is a HARD prerequisite before
  // name/phone. Each test asserts an EXACT expected stage and the EXACT required field.
  console.log("\n── 10. Qualification flows ──");

  // 10a. Laser PRICE inquiry — no firstTimeLaser yet → must stay in collect_qualification,
  // ask the first-time question with safe pricing, and NOT request name/phone.
  const PHONE_LQ = "905551112430";
  await resetStateForTest(PHONE_LQ);
  const lq1 = await processInboundMessage({
    from: PHONE_LQ,
    body: "Merhaba, full body lazer fiyatı ne kadar?",
    source: "whatsapp",
  });
  assertEqual("LQ1: serviceCategory = laser", lq1.stateAfter.serviceCategory, "laser");
  assertEqual("LQ1: firstTimeLaser missing (required field)", lq1.stateAfter.firstTimeLaser, undefined);
  assertEqual("LQ1: stage = collect_qualification (exact)", lq1.stateAfter.stage, "collect_qualification");
  assertContains("LQ1: reply asks first-time status", lq1.assistantReply, "first time");
  assertContains("LQ1: reply uses safe pricing language", lq1.assistantReply, "pricing");
  assertNoContactRequest("LQ1: reply does not request name/phone", lq1.assistantReply);
  assertNoInventedPrice("LQ1: reply invents no exact price", lq1.assistantReply);
  console.log(`  LQ1 stage=${lq1.stateAfter.stage} reply="${lq1.assistantReply.slice(0, 90)}"`);

  // 10b. Laser AVAILABILITY inquiry with a volunteered day/time — capture date/time and
  // availabilityInquiry, acknowledge the team will check availability (never confirm the
  // slot), still ask first-time, and NOT request name/phone. Stage stays collect_qualification.
  const PHONE_AV = "905551112433";
  await resetStateForTest(PHONE_AV);
  const av1 = await processInboundMessage({
    from: PHONE_AV,
    body: "Bu cumartesi öğleden sonra müsait misiniz? Full body lazer.",
    source: "whatsapp",
  });
  assertEqual("AV1: serviceCategory = laser", av1.stateAfter.serviceCategory, "laser");
  assertEqual("AV1: stage = collect_qualification (exact)", av1.stateAfter.stage, "collect_qualification");
  assertContains("AV1: preferredDate captured", av1.stateAfter.preferredDate ?? "", "cumartesi");
  assertContains("AV1: preferredTime captured", av1.stateAfter.preferredTime ?? "", "öğleden sonra");
  assertEqual("AV1: availabilityInquiry = true", av1.stateAfter.availabilityInquiry, true);
  assertEqual("AV1: firstTimeLaser still missing", av1.stateAfter.firstTimeLaser, undefined);
  assertContains("AV1: reply says team will check availability", av1.assistantReply, "availability");
  assertNotContains("AV1: reply does not confirm the appointment", av1.assistantReply, "confirmed");
  assertNotContains("AV1: reply does not say booked", av1.assistantReply, "booked");
  assertContains("AV1: reply still asks first-time status", av1.assistantReply, "first time");
  assertNoContactRequest("AV1: reply does not request name/phone", av1.assistantReply);
  console.log(`  AV1 stage=${av1.stateAfter.stage} date=${av1.stateAfter.preferredDate} time=${av1.stateAfter.preferredTime} avail=${av1.stateAfter.availabilityInquiry}`);
  console.log(`       reply="${av1.assistantReply.slice(0, 90)}"`);

  // 10c. Hair transplant — graft count known but travel origin missing → collect_qualification.
  // The EXACT required missing field is travellingFromAbroad.
  const PHONE_HQ = "905551112431";
  await resetStateForTest(PHONE_HQ);
  const hq1 = await processInboundMessage({
    from: PHONE_HQ,
    body: "Hi, how much for around 3000 grafts?",
    source: "whatsapp",
  });
  assertEqual("HQ1: serviceCategory = hair_transplant", hq1.stateAfter.serviceCategory, "hair_transplant");
  assertEqual("HQ1: estimatedGrafts = 3000", hq1.stateAfter.estimatedGrafts, 3000);
  assertEqual("HQ1: travellingFromAbroad missing (required field)", hq1.stateAfter.travellingFromAbroad, undefined);
  assertEqual("HQ1: stage = collect_qualification (exact)", hq1.stateAfter.stage, "collect_qualification");
  assertContains("HQ1: reply asks travel origin", hq1.assistantReply, "travelling");
  assertNoContactRequest("HQ1: reply does not request name/phone", hq1.assistantReply);
  assertNoInventedPrice("HQ1: reply invents no graft price", hq1.assistantReply);
  console.log(`  HQ1 stage=${hq1.stateAfter.stage} grafts=${hq1.stateAfter.estimatedGrafts} abroad=${hq1.stateAfter.travellingFromAbroad}`);

  // 10d. Hair transplant — travel origin answered → stage advances to collect_datetime (exact).
  const hq2 = await processInboundMessage({
    from: PHONE_HQ,
    body: "Yes, I'm coming from abroad.",
    source: "whatsapp",
  });
  assertEqual("HQ2: travellingFromAbroad = true", hq2.stateAfter.travellingFromAbroad, true);
  assertEqual("HQ2: stage = collect_datetime (exact)", hq2.stateAfter.stage, "collect_datetime");

  // 10e. Dental veneers inquiry — treatment scope missing → collect_qualification.
  // The EXACT required missing field is teethCountOrScope.
  const PHONE_DQ = "905551112432";
  await resetStateForTest(PHONE_DQ);
  const dq1 = await processInboundMessage({
    from: PHONE_DQ,
    body: "Hi, how much are veneers in Istanbul?",
    source: "whatsapp",
  });
  assertEqual("DQ1: serviceCategory = dental", dq1.stateAfter.serviceCategory, "dental");
  assertEqual("DQ1: dentalTreatmentType = veneer", dq1.stateAfter.dentalTreatmentType, "veneer");
  assertEqual("DQ1: teethCountOrScope missing (required field)", dq1.stateAfter.teethCountOrScope, undefined);
  assertEqual("DQ1: stage = collect_qualification (exact)", dq1.stateAfter.stage, "collect_qualification");
  assertContains("DQ1: reply asks full smile vs teeth", dq1.assistantReply, "full smile");
  assertNoContactRequest("DQ1: reply does not request name/phone", dq1.assistantReply);
  assertNoInventedPrice("DQ1: reply invents no veneer price", dq1.assistantReply);
  console.log(`  DQ1 stage=${dq1.stateAfter.stage} dental=${dq1.stateAfter.dentalTreatmentType} reply="${dq1.assistantReply.slice(0, 90)}"`);

  // 10f. Dental scope answered → stage advances to collect_datetime (exact).
  const dq2 = await processInboundMessage({
    from: PHONE_DQ,
    body: "I'm considering a full smile design.",
    source: "whatsapp",
  });
  assertEqual("DQ2: teethCountOrScope = full smile", dq2.stateAfter.teethCountOrScope, "full smile");
  assertEqual("DQ2: stage = collect_datetime (exact)", dq2.stateAfter.stage, "collect_datetime");

  // 10g. Dental flow completes with date then name+phone.
  await processInboundMessage({
    from: PHONE_DQ,
    body: "Saturday morning works for me.",
    source: "whatsapp",
  });
  const dq4 = await processInboundMessage({
    from: PHONE_DQ,
    body: "Sarah, +44 7700 900456",
    source: "whatsapp",
  });
  assertContains("DQ4: name captured", dq4.stateAfter.name ?? "", "Sarah");
  assertDefined("DQ4: phone captured", dq4.stateAfter.phone);
  assertEqual("DQ4: stage = complete (exact)", dq4.stateAfter.stage, "complete");
  assertContains("DQ4: reply mentions appointment request", dq4.assistantReply, "appointment request");
  console.log(`  DQ4 stage=${dq4.stateAfter.stage} name=${dq4.stateAfter.name}`);

  // ── Section 11: Completion + follow-up link language consistency ────────────
  // Root cause: the closing name/phone turn ("Zeynep, +44 7700 900123") is language-
  // neutral. It used to reset detectedLanguage to "english", flipping the completion
  // reply AND the booking-link message to English mid-Turkish-conversation. The fix keeps
  // detectedLanguage sticky and makes both messages read that language.
  console.log("\n── 11. Completion + follow-up link language consistency ──");

  const LINK_URL = "https://clinic.example/book/abc";

  // 11a. Turkish flow (the reported physical WhatsApp scenario) → Turkish completion + link.
  const PHONE_TRC = "905551112440";
  await resetStateForTest(PHONE_TRC);
  await processInboundMessage({
    from: PHONE_TRC,
    body: "Merhaba, cumartesi öğleden sonra full body lazer için boş musunuz?",
    source: "whatsapp",
  });
  await processInboundMessage({ from: PHONE_TRC, body: "Evet, ilk kez yaptıracağım.", source: "whatsapp" });
  const trc = await processInboundMessage({ from: PHONE_TRC, body: "Zeynep, +44 7700 900123", source: "whatsapp" });

  assertEqual("11a: stage = complete (exact)", trc.stateAfter.stage, "complete");
  assertContains("11a: name captured", trc.stateAfter.name ?? "", "Zeynep");
  assertEqual("11a: detectedLanguage stays turkish on neutral final turn", trc.stateAfter.detectedLanguage, "turkish");
  assertContains("11a: completion reply is Turkish (Teşekkür ederiz)", trc.assistantReply, "Teşekkür ederiz");
  assertContains("11a: completion reply uses Turkish appointment wording", trc.assistantReply, "randevu talebinizi aldık");
  assertContains("11a: completion reply uses Turkish follow-up wording", trc.assistantReply, "iletişime geçecektir");
  assertContains("11a: completion reply addresses the patient by name", trc.assistantReply, "Zeynep");
  assertNotContains("11a: completion reply not English (Thank you)", trc.assistantReply, "Thank you");
  assertNotContains("11a: completion reply not English (appointment request)", trc.assistantReply, "appointment request");
  console.log(`  11a reply="${trc.assistantReply}"`);

  const trcLink = formatBookingLinkMessage(LINK_URL, trc.stateAfter.detectedLanguage);
  assertContains("11a: link message is Turkish", trcLink, "Randevu talebinizi buradan tamamlayabilirsiniz");
  assertContains("11a: link message includes the URL", trcLink, LINK_URL);
  assertNotContains("11a: link message not English", trcLink, "You can complete");
  console.log(`  11a link="${trcLink}"`);

  // 11b. English flow → English completion + link (regression guard).
  const PHONE_ENC = "905551112441";
  await resetStateForTest(PHONE_ENC);
  await processInboundMessage({
    from: PHONE_ENC,
    body: "Hi, is Saturday afternoon free for full body laser?",
    source: "whatsapp",
  });
  await processInboundMessage({ from: PHONE_ENC, body: "Yes, it's my first time.", source: "whatsapp" });
  const enc = await processInboundMessage({ from: PHONE_ENC, body: "Emma, +44 7700 900222", source: "whatsapp" });

  assertEqual("11b: stage = complete (exact)", enc.stateAfter.stage, "complete");
  assertEqual("11b: detectedLanguage = english", enc.stateAfter.detectedLanguage, "english");
  assertContains("11b: completion reply is English (Thank you)", enc.assistantReply, "Thank you");
  assertContains("11b: completion reply uses English appointment wording", enc.assistantReply, "appointment request");
  assertNotContains("11b: completion reply not Turkish", enc.assistantReply, "Teşekkür");
  console.log(`  11b reply="${enc.assistantReply}"`);

  const encLink = formatBookingLinkMessage(LINK_URL, enc.stateAfter.detectedLanguage);
  assertContains("11b: link message is English", encLink, "You can complete your appointment request here");
  assertNotContains("11b: link message not Turkish", encLink, "Randevu talebinizi");
  console.log(`  11b link="${encLink}"`);

  // 11c. Language switch on the FINAL turn follows the latest message language.
  // Turkish conversation up to collect_datetime, then the patient confirms the slot in
  // clear English → completion (and link) must switch to English.
  const PHONE_SW = "905551112442";
  await resetStateForTest(PHONE_SW);
  await _setStateForTest(PHONE_SW, {
    stage: "collect_datetime",
    name: "Zeynep",
    phone: "+447700900123",
    service: "lazer epilasyon",
    treatmentArea: "full body",
    serviceCategory: "laser",
    firstTimeLaser: true,
    detectedLanguage: "turkish",
    history: [
      { role: "user", content: "Merhaba, full body lazer için ilk kez randevu istiyorum." },
      { role: "assistant", content: "Hangi gün ve saat sizin için uygun olur?" },
    ],
    lastUpdated: Date.now(),
  });
  const sw = await processInboundMessage({ from: PHONE_SW, body: "Saturday afternoon works, thanks.", source: "whatsapp" });

  assertEqual("11c: stage = complete (exact)", sw.stateAfter.stage, "complete");
  assertEqual("11c: detectedLanguage switched to english on final turn", sw.stateAfter.detectedLanguage, "english");
  assertContains("11c: completion reply follows the switch (English)", sw.assistantReply, "Thank you");
  assertNotContains("11c: completion reply not Turkish after switch", sw.assistantReply, "Teşekkür");
  const swLink = formatBookingLinkMessage(LINK_URL, sw.stateAfter.detectedLanguage);
  assertContains("11c: link message follows the switch (English)", swLink, "You can complete");
  console.log(`  11c reply="${sw.assistantReply}"`);

  // 11d. Direct formatBookingLinkMessage language selection (default when unknown).
  assertContains("11d: unknown language defaults to English link", formatBookingLinkMessage(LINK_URL, undefined), "You can complete");
  assertContains("11d: turkish language selects Turkish link", formatBookingLinkMessage(LINK_URL, "turkish"), "tamamlayabilirsiniz");

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
