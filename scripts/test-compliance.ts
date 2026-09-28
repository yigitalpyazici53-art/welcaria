/**
 * Meta compliance layer test suite — ban-protection gate regression tests.
 *
 * Usage:
 *   npm run test-compliance
 *
 * Exercises the deterministic compliance gate (lib/compliance.ts) and the
 * single outbound send path (lib/outboundSend.ts). Does NOT hit the network,
 * Redis, Twilio, or Meta — everything runs on the in-memory fallback store
 * with an injected clock and a stub transport.
 */

// Deterministic defaults for the whole suite (individual sections override).
process.env.COMPLIANCE_THREAD_MIN_GAP_SECONDS = "0";
process.env.COMPLIANCE_TENANT_RATE_PER_SECOND = "1000";
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;
delete process.env.COMPLIANCE_FORCE_CIRCUIT_OPEN;
// Template tests must never reach the real Meta API: with no token the transport
// throws before any fetch, which is exactly the boundary we want to test up to.
delete process.env.META_WHATSAPP_TOKEN;
delete process.env.META_WHATSAPP_PHONE_NUMBER_ID;
delete process.env.TEMPLATE_NAME_FOLLOWUP;

import {
  windowStatus,
  takeToken,
  applyQualityEvent,
  complianceGate,
  recordInboundMessage,
  getQualityState,
  setQualityState,
  setManualBreaker,
  isCircuitOpen,
  getEffectiveRatePerSecond,
  getLastActivityAt,
  checkInactivityNudges,
  recordActivity,
  getFollowupTemplateSentAt,
  getTemplateMaxAgeDays,
  getInboundRetentionMs,
  getThreadMinGapMs,
  followupTemplateTtlSeconds,
  deleteComplianceForThread,
  _resetComplianceForTest,
  type TokenBucketState,
} from "../lib/compliance";
import { sendOutbound, sendTemplate } from "../lib/outboundSend";
import { MetaWhatsAppError } from "../lib/metaWhatsApp";

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

const HOUR = 60 * 60 * 1000;
const WINDOW = 24 * HOUR;
const NOW = 1_800_000_000_000; // fixed epoch ms
const noSleep = async () => {};

/** Stub transport that records calls instead of hitting Meta/Twilio. */
function makeTransport() {
  const calls: Array<{ to: string; body: string }> = [];
  return {
    calls,
    fn: async (to: string, body: string) => {
      calls.push({ to, body });
    },
  };
}

async function main() {
  // ── 1. Window math (pure) ───────────────────────────────────────────────────
  console.log("\n1. 24h window math");
  assertEqual("missing lastInboundAt → no_history", windowStatus(null, NOW, WINDOW), "no_history");
  assertEqual("inbound just now → open", windowStatus(NOW, NOW, WINDOW), "open");
  assertEqual("inbound 23h59m ago → open", windowStatus(NOW - (WINDOW - 60_000), NOW, WINDOW), "open");
  assertEqual("inbound 1ms under 24h → open", windowStatus(NOW - (WINDOW - 1), NOW, WINDOW), "open");
  assertEqual("inbound exactly 24h ago → closed", windowStatus(NOW - WINDOW, NOW, WINDOW), "closed");
  assertEqual("inbound 25h ago → closed", windowStatus(NOW - 25 * HOUR, NOW, WINDOW), "closed");

  // ── 2. Token bucket (pure) ──────────────────────────────────────────────────
  console.log("\n2. Per-tenant token bucket");
  {
    const rate = 5;
    let state: TokenBucketState | null = null;
    let allowedCount = 0;
    for (let i = 0; i < 7; i++) {
      const r = takeToken(state, NOW, rate);
      state = r.state;
      if (r.allowed) allowedCount++;
    }
    assertEqual("fresh bucket allows exactly `rate` sends in one instant", allowedCount, rate);
    assertTrue("empty bucket denies", !takeToken(state, NOW, rate).allowed);
    const afterRefill = takeToken(state, NOW + 1000, rate);
    assertTrue("refills after 1s", afterRefill.allowed);
    const partial = takeToken(state, NOW + 200, rate); // 0.2s → 1 token at 5/s
    assertTrue("partial refill grants a token once >= 1 accumulates", partial.allowed);
    const full = takeToken({ tokens: 0, refilledAt: NOW }, NOW + 60_000, rate);
    assertEqual("refill caps at capacity", full.state.tokens, rate - 1);
  }

  // ── 3. Quality event mapping (pure) ─────────────────────────────────────────
  console.log("\n3. Quality webhook event mapping");
  assertEqual("quality FLAGGED → RED", applyQualityEvent("phone_number_quality_update", { event: "FLAGGED" }), "RED");
  assertEqual("quality DOWNGRADE → YELLOW", applyQualityEvent("phone_number_quality_update", { event: "DOWNGRADE" }), "YELLOW");
  assertEqual("quality UNFLAGGED → GREEN", applyQualityEvent("phone_number_quality_update", { event: "UNFLAGGED" }), "GREEN");
  assertEqual("quality UPGRADE → GREEN", applyQualityEvent("phone_number_quality_update", { event: "UPGRADE" }), "GREEN");
  assertEqual("unknown quality event → no change", applyQualityEvent("phone_number_quality_update", { event: "SOMETHING_NEW" }), null);
  assertEqual("account DISABLED_UPDATE → RED", applyQualityEvent("account_update", { event: "DISABLED_UPDATE" }), "RED");
  assertEqual("account ACCOUNT_RESTRICTION → RED", applyQualityEvent("account_update", { event: "ACCOUNT_RESTRICTION" }), "RED");
  assertEqual("account VERIFIED_ACCOUNT → no change", applyQualityEvent("account_update", { event: "VERIFIED_ACCOUNT" }), null);
  assertEqual("unrelated field → no change", applyQualityEvent("message_template_status_update", { event: "APPROVED" }), null);

  // ── 4. Circuit breaker state machine ────────────────────────────────────────
  console.log("\n4. Circuit breaker transitions");
  await _resetComplianceForTest();
  {
    const t = "tenant-breaker";
    assertEqual("default quality is GREEN", await getQualityState(t), "GREEN");
    assertTrue("GREEN → breaker closed", !(await isCircuitOpen(t)));
    assertEqual("GREEN → full rate", await getEffectiveRatePerSecond(t), 1000);

    await setQualityState(t, "YELLOW", "test");
    assertTrue("YELLOW → breaker still closed", !(await isCircuitOpen(t)));
    assertEqual("YELLOW → rate halved", await getEffectiveRatePerSecond(t), 500);

    await setQualityState(t, "RED", "test");
    assertTrue("RED → breaker OPEN", await isCircuitOpen(t));

    await setQualityState(t, "GREEN", "test");
    assertTrue("recovery to GREEN closes breaker", !(await isCircuitOpen(t)));

    await setManualBreaker(t, true);
    assertTrue("manual Redis flag trips breaker even when GREEN", await isCircuitOpen(t));
    await setManualBreaker(t, false);
    assertTrue("clearing manual flag closes breaker", !(await isCircuitOpen(t)));

    process.env.COMPLIANCE_FORCE_CIRCUIT_OPEN = "true";
    assertTrue("env kill switch trips breaker", await isCircuitOpen(t));
    delete process.env.COMPLIANCE_FORCE_CIRCUIT_OPEN;
    assertTrue("unsetting env kill switch closes breaker", !(await isCircuitOpen(t)));
  }

  // ── 5. End-to-end: free-form send on CLOSED window is blocked ───────────────
  console.log("\n5. E2E window enforcement via sendOutbound");
  await _resetComplianceForTest();
  {
    const transport = makeTransport();
    const deps = { transport: transport.fn, now: NOW, sleep: noSleep };

    // No inbound history at all → structurally forbidden.
    const noHistory = await sendOutbound(
      { to: "+905550000001", body: "hi", kind: "bot_reply", channel: "meta", tenantId: "t-e2e" },
      deps
    );
    assertEqual("no inbound history → BLOCKED_NO_INBOUND_HISTORY", noHistory.decision, "BLOCKED_NO_INBOUND_HISTORY");
    assertTrue("no inbound history → transport never called", transport.calls.length === 0);

    // Inbound 25h ago → window closed.
    await recordInboundMessage("+905550000002", "t-e2e", NOW - 25 * HOUR);
    const closed = await sendOutbound(
      { to: "+905550000002", body: "hi", kind: "bot_reply", channel: "meta", tenantId: "t-e2e" },
      deps
    );
    assertEqual("closed window → BLOCKED_WINDOW_CLOSED", closed.decision, "BLOCKED_WINDOW_CLOSED");
    assertTrue("closed window → transport never called", transport.calls.length === 0);

    // Inbound exactly 24h ago → closed (boundary is conservative).
    await recordInboundMessage("+905550000003", "t-e2e", NOW - WINDOW);
    const edge = await sendOutbound(
      { to: "+905550000003", body: "hi", kind: "bot_reply", channel: "meta", tenantId: "t-e2e" },
      deps
    );
    assertEqual("exactly-24h edge → BLOCKED_WINDOW_CLOSED", edge.decision, "BLOCKED_WINDOW_CLOSED");

    // Inbound just now → open, send goes out.
    await recordInboundMessage("+905550000004", "t-e2e", NOW);
    const open = await sendOutbound(
      { to: "+905550000004", body: "merhaba", kind: "bot_reply", channel: "meta", tenantId: "t-e2e" },
      deps
    );
    assertEqual("open window → ALLOWED", open.decision, "ALLOWED");
    assertTrue("open window → sent", open.sent);
    assertEqual("open window → transport called once", transport.calls.length, 1);
    assertEqual("transport got the right recipient", transport.calls[0]?.to, "+905550000004");
  }

  // ── 6. Per-thread reply caps ────────────────────────────────────────────────
  console.log("\n6. Per-thread caps (1 bot reply / inbound, total cap)");
  await _resetComplianceForTest();
  {
    const transport = makeTransport();
    const deps = { transport: transport.fn, now: NOW, sleep: noSleep };
    const thread = "+905550000010";
    await recordInboundMessage(thread, "t-caps", NOW);

    const first = await sendOutbound(
      { to: thread, body: "reply", kind: "bot_reply", channel: "meta", tenantId: "t-caps" },
      deps
    );
    assertTrue("first bot reply allowed", first.sent);

    const second = await sendOutbound(
      { to: thread, body: "reply 2", kind: "bot_reply", channel: "meta", tenantId: "t-caps" },
      deps
    );
    assertEqual("second bot reply for same inbound → RATE_LIMITED", second.decision, "RATE_LIMITED");

    const handoff = await sendOutbound(
      { to: thread, body: "booking link", kind: "booking_handoff", channel: "meta", tenantId: "t-caps" },
      deps
    );
    assertTrue("booking handoff still allowed after the reply", handoff.sent);

    const third = await sendOutbound(
      { to: thread, body: "extra", kind: "booking_handoff", channel: "meta", tenantId: "t-caps" },
      deps
    );
    assertEqual("third send hits per-inbound total cap → RATE_LIMITED", third.decision, "RATE_LIMITED");
    assertEqual("exactly 2 sends reached the transport", transport.calls.length, 2);

    // A new inbound message resets the counters.
    await recordInboundMessage(thread, "t-caps", NOW + 1000);
    const afterNewInbound = await sendOutbound(
      { to: thread, body: "new reply", kind: "bot_reply", channel: "meta", tenantId: "t-caps" },
      { ...deps, now: NOW + 1000 }
    );
    assertTrue("new inbound resets caps — reply allowed again", afterNewInbound.sent);
  }

  // ── 7. Pacing floor between consecutive sends ───────────────────────────────
  console.log("\n7. Per-thread pacing floor");
  await _resetComplianceForTest();
  {
    process.env.COMPLIANCE_THREAD_MIN_GAP_SECONDS = "5";
    process.env.COMPLIANCE_MAX_SENDS_PER_INBOUND = "10";
    const sleeps: number[] = [];
    const transport = makeTransport();
    const deps = {
      transport: transport.fn,
      now: NOW,
      sleep: async (ms: number) => {
        sleeps.push(ms);
      },
    };
    const thread = "+905550000020";
    await recordInboundMessage(thread, "t-gap", NOW);

    await sendOutbound({ to: thread, body: "a", kind: "bot_reply", channel: "meta", tenantId: "t-gap" }, deps);
    assertEqual("first send waits for no gap", sleeps.length, 0);

    await sendOutbound({ to: thread, body: "b", kind: "booking_handoff", channel: "meta", tenantId: "t-gap" }, deps);
    assertTrue("second send waits out the 5s floor", sleeps.length === 1 && sleeps[0] === 5000);

    process.env.COMPLIANCE_THREAD_MIN_GAP_SECONDS = "0";
    process.env.COMPLIANCE_MAX_SENDS_PER_INBOUND = "2";
  }

  // ── 8. Per-tenant rate limit end-to-end ─────────────────────────────────────
  console.log("\n8. Per-tenant token bucket via sendOutbound");
  await _resetComplianceForTest();
  {
    process.env.COMPLIANCE_TENANT_RATE_PER_SECOND = "2";
    process.env.COMPLIANCE_MAX_SENDS_PER_INBOUND = "10";
    const transport = makeTransport();
    const deps = { transport: transport.fn, now: NOW, sleep: noSleep };
    const tenant = "t-bucket";

    const decisions: string[] = [];
    for (let i = 0; i < 3; i++) {
      const thread = `+9055500003${i}`;
      await recordInboundMessage(thread, tenant, NOW);
      const r = await sendOutbound(
        { to: thread, body: "x", kind: "system", channel: "meta", tenantId: tenant },
        deps
      );
      decisions.push(r.decision);
    }
    assertEqual("sends 1-2 allowed at rate 2/s", decisions.slice(0, 2).join(","), "ALLOWED,ALLOWED");
    assertEqual("send 3 in the same instant → RATE_LIMITED (dropped, not burst)", decisions[2], "RATE_LIMITED");
    assertEqual("only 2 sends reached the transport", transport.calls.length, 2);

    process.env.COMPLIANCE_TENANT_RATE_PER_SECOND = "1000";
    process.env.COMPLIANCE_MAX_SENDS_PER_INBOUND = "2";
  }

  // ── 9. Circuit breaker blocks sends end-to-end ──────────────────────────────
  console.log("\n9. E2E circuit breaker");
  await _resetComplianceForTest();
  {
    const transport = makeTransport();
    const deps = { transport: transport.fn, now: NOW, sleep: noSleep };
    const tenant = "t-red";
    const thread = "+905550000040";
    await recordInboundMessage(thread, tenant, NOW);
    await setQualityState(tenant, "RED", "test");

    const blocked = await sendOutbound(
      { to: thread, body: "x", kind: "bot_reply", channel: "meta", tenantId: tenant },
      deps
    );
    assertEqual("RED quality → CIRCUIT_OPEN", blocked.decision, "CIRCUIT_OPEN");
    assertTrue("breaker open → transport never called", transport.calls.length === 0);

    await setQualityState(tenant, "GREEN", "test");
    const recovered = await sendOutbound(
      { to: thread, body: "x", kind: "bot_reply", channel: "meta", tenantId: tenant },
      deps
    );
    assertTrue("recovery to GREEN → send allowed again", recovered.sent);
  }

  // ── 10. Plain SMS skips WhatsApp-only rules, still audited/paced ────────────
  console.log("\n10. SMS channel behavior");
  await _resetComplianceForTest();
  {
    const transport = makeTransport();
    const deps = { transport: transport.fn, now: NOW, sleep: noSleep };
    const sms = await sendOutbound(
      { to: "+905550000050", body: "missed call", kind: "system", channel: "twilio", tenantId: "t-sms" },
      deps
    );
    assertTrue("plain SMS with no inbound history is allowed (no 24h rule)", sms.sent);

    const waPrefixed = await sendOutbound(
      { to: "whatsapp:+905550000051", body: "hi", kind: "bot_reply", channel: "twilio", tenantId: "t-sms" },
      deps
    );
    assertEqual(
      "Twilio whatsapp:-prefixed recipient IS window-gated",
      waPrefixed.decision,
      "BLOCKED_NO_INBOUND_HISTORY"
    );
  }

  // ── 11. Template path ───────────────────────────────────────────────────────
  console.log("\n11. Template send");
  await _resetComplianceForTest();
  {
    // 11a. No template name configured → refused as a CONFIG state, not a compliance one.
    const unconfigured = await sendTemplate("+905551110011", "", { tenantId: "t-tmpl" });
    assertTrue("no template name configured → refused", !unconfigured.sent);
    assertEqual(
      "unconfigured template reports the config decision",
      unconfigured.decision,
      "BLOCKED_TEMPLATE_NOT_CONFIGURED"
    );

    // 11b. Inbound-only guarantee still applies to templates. A thread that never
    //      wrote to us can NOT be reached with a template.
    const noHistory = await sendTemplate("+905551110022", "welcaria_followup", {
      tenantId: "t-tmpl",
    });
    assertTrue("template to a thread with no inbound history → refused", !noHistory.sent);
    assertEqual(
      "template still obeys the inbound-only guarantee",
      noHistory.decision,
      "BLOCKED_NO_INBOUND_HISTORY"
    );

    // 11c. Window CLOSED + real inbound history → the gate ALLOWS the template
    //      (this is the whole point of templates), while a free-form send on the very
    //      same thread stays blocked. Transport is stubbed: no test reaches Meta.
    const thread = "+905551110033";
    const tmplCalls: Array<{ name: string; lang: string; params: string[] }> = [];
    const tmplTransport = async (
      _to: string,
      name: string,
      lang: string,
      params: string[]
    ): Promise<void> => {
      tmplCalls.push({ name, lang, params });
    };

    await recordInboundMessage(thread, "t-tmpl", NOW - 48 * HOUR);
    const freeform = await sendOutbound(
      {
        to: thread,
        body: "free-form outside the window",
        kind: "bot_reply",
        channel: "meta",
        tenantId: "t-tmpl",
      },
      { now: NOW, transport: async () => {}, sleep: async () => {} }
    );
    assertEqual(
      "free-form send outside the window is still blocked",
      freeform.decision,
      "BLOCKED_WINDOW_CLOSED"
    );

    const tmpl = await sendTemplate(thread, "welcaria_followup", {
      tenantId: "t-tmpl",
      bodyParams: ["Aurea"],
      now: NOW,
      sleep: async () => {},
      transport: tmplTransport,
    });
    assertEqual("template passes the closed window", tmpl.decision, "ALLOWED");
    assertTrue("template sent through the closed window", tmpl.sent);
    assertTrue("template transport was invoked exactly once", tmplCalls.length === 1);
    assertEqual("template name reached the transport", tmplCalls[0]?.name, "welcaria_followup");
    assertEqual("template language defaults to tr", tmplCalls[0]?.lang, "tr");
    assertEqual("template body params passed through", tmplCalls[0]?.params.join(","), "Aurea");
    assertTrue("template never claims bodyIntact", !tmpl.bodyIntact);

    // 11d. Circuit breaker outranks templates — and a gate refusal gives the
    //      one-template claim back, so the thread is not burned by a block.
    const brThread = "+905551110044";
    await recordInboundMessage(brThread, "t-tmpl", NOW - 48 * HOUR);
    await setManualBreaker("t-tmpl", true);
    const breakered = await sendTemplate(brThread, "welcaria_followup", {
      tenantId: "t-tmpl",
      now: NOW,
      sleep: async () => {},
      transport: tmplTransport,
    });
    assertEqual("circuit breaker blocks templates too", breakered.decision, "CIRCUIT_OPEN");
    assertTrue("circuit-open template never reached the transport", tmplCalls.length === 1);
    assertTrue(
      "gate refusal releases the one-template claim",
      (await getFollowupTemplateSentAt(brThread)) === null
    );
    await setManualBreaker("t-tmpl", false);

    // 11e. One template per thread: the thread from 11c already got one.
    const second = await sendTemplate(thread, "welcaria_followup", {
      tenantId: "t-tmpl",
      now: NOW + HOUR,
      sleep: async () => {},
      transport: tmplTransport,
    });
    assertEqual("second template to the same thread → refused", second.decision, "BLOCKED_TEMPLATE_ALREADY_SENT");
    assertTrue("second template never reached the transport", tmplCalls.length === 1);
    assertTrue("followupTemplateSentAt recorded", (await getFollowupTemplateSentAt(thread)) === NOW);

    // 11f. Patient writes again → flag cleared → the NEXT silence may get one follow-up.
    await recordInboundMessage(thread, "t-tmpl", NOW + 2 * HOUR);
    assertTrue("new inbound clears followupTemplateSentAt", (await getFollowupTemplateSentAt(thread)) === null);
    const afterReply = await sendTemplate(thread, "welcaria_followup", {
      tenantId: "t-tmpl",
      now: NOW + 30 * HOUR,
      sleep: async () => {},
      transport: tmplTransport,
    });
    assertEqual("template allowed again after a new inbound + silence", afterReply.decision, "ALLOWED");
    assertTrue("post-reset template reached the transport", tmplCalls.length === 2);
  }

  // ── 11b. Template concurrency, age limit, release, erasure ─────────────────
  console.log("\n11b. Template concurrency / age limit / erasure");
  await _resetComplianceForTest();
  {
    const tmplOpts = (calls: string[]) => ({
      tenantId: "t-tmpl2",
      now: NOW,
      sleep: async () => {},
      transport: async (to: string) => {
        calls.push(to);
      },
    });

    // Concurrency: two simultaneous calls → exactly one template goes out.
    const cThread = "+905551110055";
    const cCalls: string[] = [];
    await recordInboundMessage(cThread, "t-tmpl2", NOW - 48 * HOUR);
    const [a, b] = await Promise.all([
      sendTemplate(cThread, "welcaria_followup", tmplOpts(cCalls)),
      sendTemplate(cThread, "welcaria_followup", tmplOpts(cCalls)),
    ]);
    assertEqual("concurrent template calls → exactly one sent", [a, b].filter((r) => r.sent).length, 1);
    assertTrue(
      "the other concurrent call is BLOCKED_TEMPLATE_ALREADY_SENT",
      [a.decision, b.decision].includes("BLOCKED_TEMPLATE_ALREADY_SENT")
    );
    assertEqual("concurrent calls → one transport invocation", cCalls.length, 1);

    // Age limit: default 30 days.
    const oldThread = "+905551110066";
    const oCalls: string[] = [];
    await recordInboundMessage(oldThread, "t-tmpl2", NOW - 31 * 24 * HOUR);
    const tooOld = await sendTemplate(oldThread, "welcaria_followup", tmplOpts(oCalls));
    assertEqual("last inbound 31 days ago → BLOCKED_TEMPLATE_TOO_OLD", tooOld.decision, "BLOCKED_TEMPLATE_TOO_OLD");
    assertTrue("too-old template never reached the transport", oCalls.length === 0);
    assertTrue("too-old refusal takes no claim", (await getFollowupTemplateSentAt(oldThread)) === null);

    const okThread = "+905551110067";
    await recordInboundMessage(okThread, "t-tmpl2", NOW - 29 * 24 * HOUR);
    const withinAge = await sendTemplate(okThread, "welcaria_followup", tmplOpts(oCalls));
    assertEqual("last inbound 29 days ago → allowed", withinAge.decision, "ALLOWED");

    // Invalid / empty TEMPLATE_MAX_AGE_DAYS → default 30; a valid value is honoured.
    const savedAge = process.env.TEMPLATE_MAX_AGE_DAYS;
    for (const bad of ["", "   ", "abc", "0", "-5", "NaN"]) {
      process.env.TEMPLATE_MAX_AGE_DAYS = bad;
      assertEqual(`TEMPLATE_MAX_AGE_DAYS=${JSON.stringify(bad)} → default 30`, getTemplateMaxAgeDays(), 30);
    }
    process.env.TEMPLATE_MAX_AGE_DAYS = "7";
    assertEqual("TEMPLATE_MAX_AGE_DAYS=7 honoured", getTemplateMaxAgeDays(), 7);
    const weekThread = "+905551110068";
    await recordInboundMessage(weekThread, "t-tmpl2", NOW - 10 * 24 * HOUR);
    const pastWeek = await sendTemplate(weekThread, "welcaria_followup", tmplOpts(oCalls));
    assertEqual("10-day-old inbound with limit 7 → TOO_OLD", pastWeek.decision, "BLOCKED_TEMPLATE_TOO_OLD");
    if (savedAge === undefined) delete process.env.TEMPLATE_MAX_AGE_DAYS;
    else process.env.TEMPLATE_MAX_AGE_DAYS = savedAge;

    // Meta rejected the request → provably not sent → claim released.
    const rejThread = "+905551110077";
    await recordInboundMessage(rejThread, "t-tmpl2", NOW - 48 * HOUR);
    const rejected = await sendTemplate(rejThread, "welcaria_followup", {
      ...tmplOpts([]),
      transport: async () => {
        throw new MetaWhatsAppError(400, { message: "template name does not exist", code: 132001 });
      },
    });
    assertTrue("Meta rejection → not sent", !rejected.sent);
    assertTrue("Meta rejection releases the claim", (await getFollowupTemplateSentAt(rejThread)) === null);

    // Ambiguous failure (network/timeout) → claim KEPT: prefer a missed follow-up
    // over a possible duplicate.
    const ambThread = "+905551110078";
    await recordInboundMessage(ambThread, "t-tmpl2", NOW - 48 * HOUR);
    const ambiguous = await sendTemplate(ambThread, "welcaria_followup", {
      ...tmplOpts([]),
      transport: async () => {
        throw new Error("fetch failed: socket hang up");
      },
    });
    assertTrue("ambiguous failure → reported not sent", !ambiguous.sent);
    assertTrue("ambiguous failure keeps the claim", (await getFollowupTemplateSentAt(ambThread)) !== null);

    // Flag retention is aligned with the last-inbound record: it expires together with
    // that record (+1h margin), and moves when the window setting moves.
    assertEqual("inbound retention = 3× window (72h)", getInboundRetentionMs(), 72 * HOUR);
    assertEqual(
      "flag TTL = remaining inbound retention + 1h (inbound 48h ago → 25h)",
      followupTemplateTtlSeconds(NOW - 48 * HOUR, NOW),
      25 * 60 * 60
    );
    assertEqual(
      "flag TTL with no inbound record = margin only (1h)",
      followupTemplateTtlSeconds(null, NOW),
      60 * 60
    );
    assertEqual(
      "flag TTL never negative past the retention (margin only)",
      followupTemplateTtlSeconds(NOW - 29 * 24 * HOUR, NOW),
      60 * 60
    );
    const savedWindow = process.env.COMPLIANCE_WINDOW_HOURS;
    process.env.COMPLIANCE_WINDOW_HOURS = "12";
    assertEqual("retention follows the window (12h → 36h)", getInboundRetentionMs(), 36 * HOUR);
    assertEqual(
      "flag TTL follows the window (inbound 10h ago → 26h + 1h)",
      followupTemplateTtlSeconds(NOW - 10 * HOUR, NOW),
      27 * 60 * 60
    );
    if (savedWindow === undefined) delete process.env.COMPLIANCE_WINDOW_HOURS;
    else process.env.COMPLIANCE_WINDOW_HOURS = savedWindow;

    // Numeric thresholds: whitespace-only is unset (default), not 0.
    const savedGap = process.env.COMPLIANCE_THREAD_MIN_GAP_SECONDS;
    process.env.COMPLIANCE_THREAD_MIN_GAP_SECONDS = "   ";
    assertEqual("whitespace COMPLIANCE_THREAD_MIN_GAP_SECONDS → default 3s", getThreadMinGapMs(), 3000);
    if (savedGap === undefined) delete process.env.COMPLIANCE_THREAD_MIN_GAP_SECONDS;
    else process.env.COMPLIANCE_THREAD_MIN_GAP_SECONDS = savedGap;

    // KVKK erasure removes the flag — for any spelling of the number.
    assertTrue("flag present before erasure", (await getFollowupTemplateSentAt(cThread)) !== null);
    const erased = await deleteComplianceForThread("905551110055");
    assertTrue(
      "erasure targets the followupTemplateSentAt key",
      erased.keys.includes(`compliance:followupTemplateSentAt:${cThread}`)
    );
    assertTrue("erasure deletes followupTemplateSentAt", (await getFollowupTemplateSentAt(cThread)) === null);
  }

  // ── 12. Inactivity nudge (day-10 keepalive) ─────────────────────────────────
  console.log("\n12. Coexistence inactivity nudge");
  await _resetComplianceForTest();
  {
    const now = NOW;
    const day = 24 * HOUR;
    await recordActivity("t-idle", now - 11 * day);
    await recordActivity("t-active", now - 2 * day);

    assertEqual("activity timestamp persisted", await getLastActivityAt("t-active"), now - 2 * day);

    const flagged = await checkInactivityNudges(now);
    assertEqual("exactly one tenant flagged", flagged.length, 1);
    assertEqual("idle tenant is flagged", flagged[0]?.tenantId, "t-idle");
    assertEqual("idle days computed", flagged[0]?.idleDays, 11);
  }

  // ── Summary ─────────────────────────────────────────────────────────────────
  console.log(`\n${failures === 0 ? "ALL TESTS PASSED" : `${failures} TEST(S) FAILED`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Test suite crashed:", err);
  process.exit(1);
});
