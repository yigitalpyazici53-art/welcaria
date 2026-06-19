# SPEC: Fix WhatsApp Flow Failures (11 Tests)

**Status:** Awaiting approval
**Scope:** `lib/inboundPipeline.ts`, `lib/conversationState.ts`, `lib/twilio.ts` — and possibly `scripts/test-whatsapp-webhook.ts`
**Goal:** Fix 11 failing assertions in `npm run test-whatsapp` without making assumptions about whether tests or production logic are wrong

---

## Context

RandevuFlow is a Turkish laser/aesthetic intake system. WhatsApp inbound messages flow through `processInboundMessage()` in `lib/inboundPipeline.ts`, which drives a multi-stage state machine defined in `lib/conversationState.ts`. `npm run test-whatsapp` currently fails with **11 failures across 3 sections**.

---

## Failure Map (11 failures → 3 root causes)

### Root Cause A — Stage stuck at `collect_first_time`

`getNextStage()` (`conversationState.ts:161`) contains this gate:

```ts
if (state.firstTimeLaser === undefined) return "collect_first_time";
```

None of the test conversations ever set `firstTimeLaser`. The bot replies "Daha once lazer epilasyon yaptirdiniz mi?" indefinitely. Nothing downstream (collect_name, complete) is ever reached.

**Failures caused by this:**
- `T4: stage = complete` — got `collect_first_time`
- `W6: stage = complete` — got `collect_first_time`
- `D1: isFirstComplete triggers before flag written` — PHONE_MT is stuck at `collect_first_time` after Section 2, so `stage === "complete"` is false and the deduplication assertion fails

---

### Root Cause B — Bare-word name "ayşe" not extracted

`inboundPipeline.ts:66–80` runs the name fallback only when:
- `stateBefore.stage === "collect_name"`, OR
- the last assistant message matches `/isminizi|adınızı|adınız\b|adını/i`

Because of Root Cause A, the stage is stuck at `collect_first_time`. The assistant reply is "Daha once lazer epilasyon yaptirdiniz mi?" which does NOT match the name-asking regex. So when the user sends `"ayşe"` at W2, the fallback never fires.

**Failures caused by this (all cascade from W2 not capturing the name):**
- `W2: name = Ayşe` — got `undefined`
- `W3: name still Ayşe` — never set, so not persisted
- `W4: name still Ayşe` — never set, so not persisted
- `W6: name = Ayşe` — never set
- `W6: ownerAlert includes Ayşe` — name absent from state
- `W6: shouldLogToSheet = true` — `shouldLogToSheet` requires `stateAfter.name`; got `false`

---

### Root Cause C — `buildOwnerAlert()` does not render location

`lib/twilio.ts:25–63` builds the owner alert line by line. There is no line for `state.location`. The location slot IS extracted and stored in state, but is silently omitted from the alert string.

**Failures caused by this:**
- `T4: ownerAlert includes Kadıköy` — "Kadıköy" not found in alert
- `W6: ownerAlert includes Kadıköy` — "Kadıköy" not found in alert

---

## Ambiguities — Decisions Required Before Implementation

### Ambiguity 1: Should `firstTimeLaser` gate stage progression?

**The question:** `getNextStage()` currently returns `collect_first_time` until `firstTimeLaser` is explicitly set. Test conversations never set it. Is this:

**(A) A test gap** — the test messages should include an answer like "evet" / "hayır" / "ilk kez değil" so the pipeline correctly advances. Do not touch `getNextStage()`.

**(B) A pipeline design issue** — `firstTimeLaser` is a useful data point but should NOT block stage progression. Remove the gate; collect it opportunistically when the user mentions it.

**Evidence for (A):**
- `collect_first_time` stage and its fallback reply exist intentionally.
- `buildOwnerAlert()` already renders `firstTimeLaser` when set.
- Adding one line to each test scenario would fix the stage failures without touching production logic.

**Evidence for (B):**
- All 6-turn and 4-turn test conversations were written WITHOUT first-time info, suggesting the author expected the flow to complete without it.
- Real WhatsApp users may not answer "Daha once yaptirdiniz mi?" explicitly before providing a name/date.
- Making it a hard gate means the flow never completes unless the user answers that specific question — degraded UX.
- `shouldLogToSheet` and lead scoring do not require `firstTimeLaser`.

**Recommendation:** Option (B). Remove the gate. Collect `firstTimeLaser` opportunistically. The owner can ask during the actual appointment call. **This is a product decision — confirm before implementing.**

---

### Ambiguity 2: Should bare-word names be extracted outside `collect_name` stage?

**The question:** When a user sends just `"ayşe"` (no phone, no service, no date), should it be captured as a name regardless of the current stage?

**(A) Stage-gated (current design):** Only extract bare names when in `collect_name` or when history contains an explicit name question. This avoids false positives.

**(B) Opportunistic:** If the message contains no other extractable slots and looks like a Turkish name, store it regardless of stage.

**Evidence for (A):**
- `slotExtractor.ts:197` comment: "Call ONLY when extractSlots() found no name and current stage is collect_name or the assistant just asked for a name."
- Without a stage gate, certain single-word replies could be misidentified as names (though `NAME_BLOCKLIST` and `BARE_NAME_RE` guard against common false positives).

**Evidence for (B):**
- The W2 test sends `"ayşe"` in turn 2 (right after service inquiry) and expects `name = "Ayşe"` extracted.
- Even if Ambiguity 1 is resolved as (B) and the gate is removed, the stage at W2 would be `collect_datetime` — still not `collect_name`. Name still would not be extracted.
- The only way W2 works as written is if the pipeline extracts bare names at any stage (when no other slots are present).

**Note:** If Ambiguity 1 is resolved as (A) (add first-time info to tests), the stage at W2 would depend on what turn provides the first-time answer and what the new stage sequence looks like. In that case, re-analyze W2 before fixing this.

**Recommendation:** Extend the fallback to also trigger when `stateBefore.stage` is `"collect_first_time"` or `"collect_datetime"` AND `Object.keys(extractedSlots).length === 0` (nothing else was extracted from the message). This is narrow enough to avoid false positives. **Confirm scope before implementing.**

---

### Ambiguity 3: Should `buildOwnerAlert()` include location? *(No ambiguity — yes)*

`state.location` is stored in `ConversationState`, is checked by `shouldLogToSheet`, and the tests explicitly assert it appears in the alert. This is a straightforward omission.

**No decision needed.** Add a location line to `buildOwnerAlert()`.

---

## Implementation Plan (contingent on ambiguity resolution)

### Fix C — Add location to `buildOwnerAlert()` (safe, no dependencies)

**File:** `lib/twilio.ts`, inside `buildOwnerAlert()`, after the timing block

```ts
if (state.location) lines.push(`Konum: ${state.location}`);
```

**Acceptance criteria:**
- `T4: ownerAlert includes Kadıköy` → PASS
- `W6: ownerAlert includes Kadıköy` → PASS
- No other alert assertions break

---

### Fix A — `firstTimeLaser` gate (choose Option A or B from Ambiguity 1)

**If Option B chosen (remove gate from pipeline):**

**File:** `lib/conversationState.ts`, `getNextStage()`

Remove:
```ts
if (state.firstTimeLaser === undefined) return "collect_first_time";
```

Keep `collect_first_time` as a valid `Stage` type — it may still appear in state when set directly. Only remove it from mandatory progression.

**Acceptance criteria:**
- `T4: stage = complete` → PASS
- `W6: stage = complete` → PASS
- `D1: isFirstComplete triggers before flag written` → PASS (cascades from T4 fix)
- Single-turn test (Section 1) still returns a useful first reply
- `firstTimeLaser` still captured via `extractSlots()` when user mentions it

**If Option A chosen (add first-time signals to tests):**

**File:** `scripts/test-whatsapp-webhook.ts`

- Add "ilk kez yaptırıyorum" or "hayır, daha önce yaptırmadım" to an appropriate test message body
- Identify which turn in the 4-turn and 6-turn flows should carry this signal
- Do NOT change `getNextStage()`

---

### Fix B — Bare-word name extraction scope (choose scope from Ambiguity 2)

**File:** `lib/inboundPipeline.ts`, name fallback block (lines 66–80)

Extend `needFallback` condition:

```ts
const needFallback =
  stateBefore.stage === "collect_name" ||
  stateBefore.stage === "collect_first_time" ||
  stateBefore.stage === "collect_datetime" ||
  stateBefore.history
    .slice(-2)
    .some(
      (h) =>
        h.role === "assistant" &&
        /isminizi|adınızı|adınız\b|adını/i.test(h.content)
    );
```

Also add a guard: only invoke `extractNameFallback` when `Object.keys(extractedSlots).length === 0`, so a message like "cumartesi öğleden sonra" that already yielded date/time slots is never mistaken for a name.

**Acceptance criteria:**
- `W2: name = Ayşe` — "ayşe" extracted and title-cased → PASS
- `W3: name still Ayşe` → PASS (persisted across turns)
- `W4: name still Ayşe` → PASS
- `W6: name = Ayşe` → PASS
- `W6: ownerAlert includes Ayşe` → PASS
- `W6: shouldLogToSheet = true` → PASS
- Single-word messages "evet", "hayır", "tamam" are NOT extracted as names (covered by existing `NAME_BLOCKLIST` and `BARE_NAME_RE`)

---

## Boundaries

| Category | Rule |
|---|---|
| **Always safe** | Fix `buildOwnerAlert()` — additive only, no behavioral change |
| **Confirm first** | Remove `firstTimeLaser` gate from `getNextStage()` — changes prod conversation flow |
| **Confirm first** | Expand name fallback to additional stages — changes when names are captured |
| **Never** | Change `ConversationState` schema without regression-testing all 4 test scripts |
| **Never** | Touch `test-sms.ts` or `test-inbound-endpoint.ts` — out of scope |
| **Never** | Assume test messages are wrong without a product decision |
| **Never** | Add error handling for scenarios that can't happen |

---

## Expected Outcome

Resolving all three root causes brings failures from 11 → 0:

| Root Cause | Failures Fixed |
|---|---|
| C — location in alert | 2 |
| A — `firstTimeLaser` gate | 3 (T4 stage, W6 stage, D1 cascade) |
| B — name extraction scope | 6 (W2–W6 name assertions + sheet log) |
| **Total** | **11** |

---

## Open Questions for Product Owner

1. **Is `firstTimeLaser` a required intake field?** If required, add it to test messages (Option A). If advisory, remove the gate (Option B).
2. **Should users be able to volunteer their name at any point**, or only when explicitly asked?
3. **Is there a `collect_location` stage missing from `getNextStage()`?** Currently location is captured if mentioned and defaulted to "Ümraniye" if absent at complete. Should this be a gated stage?
