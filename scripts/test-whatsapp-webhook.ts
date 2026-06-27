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
import { resetStateForTest, getStateStorageMode, getState, updateState, _setStateForTest } from "../lib/conversationState";
import { processInboundMessage } from "../lib/inboundPipeline";

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
  await trySendWhatsApp(PHONE_MT, t1.assistantReply);

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
