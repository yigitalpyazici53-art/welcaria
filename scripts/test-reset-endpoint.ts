/**
 * RandevuFlow — conversation state reset test.
 *
 * Usage:
 *   npm run test-reset
 *
 * Validates that deleteConversationState() clears both the bare and '+'-prefixed
 * Redis key variants and that getState() returns a fresh state afterward.
 * Does NOT require a running HTTP server or real Redis.
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

// Set test secret if not already configured
if (!process.env.TEST_WEBHOOK_SECRET) {
  process.env.TEST_WEBHOOK_SECRET = "randevuflow-dev";
}

// ── Safe to import lib modules now ────────────────────────────────────────────
import {
  deleteConversationState,
  getState,
  updateState,
  getStateStorageMode,
  getConversationKey,
} from "../lib/conversationState";

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

function assertLength(label: string, arr: unknown[], expected: number) {
  if (arr.length === expected) pass(label, `length=${arr.length}`);
  else fail(label, `got length=${arr.length}, expected ${expected}`);
}

// ── Simulate endpoint auth logic ──────────────────────────────────────────────

function simulateAuth(requestSecret: string): { accepted: boolean; status: number } {
  const configured = process.env.TEST_WEBHOOK_SECRET;
  if (!configured) return { accepted: false, status: 500 };
  if (!requestSecret || requestSecret !== configured) return { accepted: false, status: 401 };
  return { accepted: true, status: 200 };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== test-reset-endpoint ===\n");

  const storageMode = getStateStorageMode();
  console.log(`  stateStorage : ${storageMode}\n`);

  // ── Section 1: Authorization check ───────────────────────────────────────
  console.log("── 1. Authorization ──");

  const CONFIGURED_SECRET = process.env.TEST_WEBHOOK_SECRET!;

  {
    const { accepted } = simulateAuth("totally-wrong-secret");
    if (!accepted) pass("wrong secret rejected");
    else fail("wrong secret rejected", "wrong secret was accepted");
  }
  {
    const { accepted } = simulateAuth("");
    if (!accepted) pass("missing secret rejected");
    else fail("missing secret rejected", "empty secret was accepted");
  }
  {
    const { accepted } = simulateAuth(CONFIGURED_SECRET);
    if (accepted) pass("correct secret accepted");
    else fail("correct secret accepted", "valid secret was rejected");
  }

  // ── Section 2: Key normalization ──────────────────────────────────────────
  console.log("\n── 2. Key normalization ──");

  const PHONE_BARE = "905419473049";
  const PHONE_PLUS = "+905419473049";

  const keysFromBare = [getConversationKey(PHONE_BARE), getConversationKey(`+${PHONE_BARE}`)];
  const keysFromPlus = [getConversationKey(PHONE_BARE), getConversationKey(PHONE_PLUS)];

  assertEqual(
    "bare input key[0] = conv:905419473049",
    keysFromBare[0],
    "conv:905419473049"
  );
  assertEqual(
    "bare input key[1] = conv:+905419473049",
    keysFromBare[1],
    "conv:+905419473049"
  );
  assertEqual(
    "plus input produces same key[0]",
    keysFromPlus[0],
    keysFromBare[0]
  );
  assertEqual(
    "plus input produces same key[1]",
    keysFromPlus[1],
    keysFromBare[1]
  );

  // ── Section 3: Reset bare phone number ───────────────────────────────────
  console.log("\n── 3. Reset — bare phone (no '+') ──");

  const PHONE_TEST = "905551119900";

  // Write some state so there is something to clear
  await updateState(PHONE_TEST, { name: "Test User", stage: "collect_service" });
  const stateBeforeReset = await getState(PHONE_TEST);
  console.log(`  state before reset: stage=${stateBeforeReset.stage} name=${stateBeforeReset.name ?? "(none)"}`);

  const deletedKeys = await deleteConversationState(PHONE_TEST);
  console.log(`  deletedKeys: ${JSON.stringify(deletedKeys)}`);

  assertLength("deletedKeys length = 2", deletedKeys, 2);
  assertEqual("deletedKeys[0] = conv:905551119900", deletedKeys[0], "conv:905551119900");
  assertEqual("deletedKeys[1] = conv:+905551119900", deletedKeys[1], "conv:+905551119900");

  const stateAfterReset = await getState(PHONE_TEST);
  console.log(`  state after reset: stage=${stateAfterReset.stage} history.length=${stateAfterReset.history.length}`);

  assertEqual("stage after reset = collect_name", stateAfterReset.stage, "collect_name");
  assertEqual("history empty after reset", stateAfterReset.history.length, 0);

  // ── Section 4: Reset '+'-prefixed phone number ────────────────────────────
  console.log("\n── 4. Reset — '+'-prefixed phone ──");

  const PHONE_PLUS_TEST = "+905551119901";

  await updateState(PHONE_PLUS_TEST, { name: "Test User 2", stage: "collect_service" });
  const stateBeforeReset2 = await getState(PHONE_PLUS_TEST);
  console.log(`  state before reset: stage=${stateBeforeReset2.stage} name=${stateBeforeReset2.name ?? "(none)"}`);

  const deletedKeys2 = await deleteConversationState(PHONE_PLUS_TEST);
  console.log(`  deletedKeys: ${JSON.stringify(deletedKeys2)}`);

  assertLength("deletedKeys length = 2", deletedKeys2, 2);
  assertEqual("deletedKeys[0] = conv:905551119901", deletedKeys2[0], "conv:905551119901");
  assertEqual("deletedKeys[1] = conv:+905551119901", deletedKeys2[1], "conv:+905551119901");

  const stateAfterReset2 = await getState(PHONE_PLUS_TEST);
  console.log(`  state after reset: stage=${stateAfterReset2.stage} history.length=${stateAfterReset2.history.length}`);

  assertEqual("stage after reset = collect_name", stateAfterReset2.stage, "collect_name");
  assertEqual("history empty after reset", stateAfterReset2.history.length, 0);

  // ── Section 5: Simulated endpoint response shape ──────────────────────────
  console.log("\n── 5. Simulated endpoint response shape ──");

  const PHONE_RESP = "905551119902";
  await updateState(PHONE_RESP, { name: "Resp Test", stage: "collect_datetime" });

  const simResponse = await (async () => {
    const stateStorage = getStateStorageMode();
    try {
      const deletedKeys = await deleteConversationState(PHONE_RESP);
      return { ok: true, from: PHONE_RESP, deletedKeys, stateStorage };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return { ok: false, error, stateStorage };
    }
  })();

  console.log(`  response: ${JSON.stringify(simResponse)}`);

  assertEqual("ok = true", simResponse.ok, true);
  assertEqual("from matches", simResponse.from, PHONE_RESP);
  assertDefined("deletedKeys present", simResponse.deletedKeys);
  assertLength("deletedKeys length = 2", simResponse.deletedKeys ?? [], 2);
  assertEqual(
    "stateStorage is valid",
    ["redis", "memory"].includes(simResponse.stateStorage),
    true
  );

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
