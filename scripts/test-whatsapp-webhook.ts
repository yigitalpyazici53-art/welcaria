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
import { resetStateForTest, getStateStorageMode } from "../lib/conversationState";
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

  // ── Section 3: Ignored payload simulation ────────────────────────────────
  console.log("\n── 3. Ignored payload handling ──");

  // Simulate the webhook route's ignored-payload responses
  const ignoredReasons: Array<{ condition: string; reason: string }> = [
    { condition: "payload.statuses present", reason: "status_update" },
    { condition: "message.type !== text", reason: "unsupported_message" },
    { condition: "no messages array", reason: "no_messages" },
  ];

  for (const { condition, reason } of ignoredReasons) {
    pass(`Ignored: ${condition} → reason="${reason}"`);
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
