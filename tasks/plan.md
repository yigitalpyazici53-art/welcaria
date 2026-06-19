# Plan: Fix 11 WhatsApp Flow Failures

**Branch:** add-agent-skills-workflow
**Approved decisions:** See SPEC.md (Option B for firstTimeLaser, opportunistic+guarded name fallback, location in alert)
**Do not modify code until a task is started.**

---

## Dependency order

```
Task 1 (buildOwnerAlert location)  ← independent, no deps
Task 2 (remove firstTimeLaser gate) ← independent, no deps
Task 3 (expand name fallback)       ← depends on Task 2 being applied first
                                       (after Task 2, W2 stage is collect_datetime,
                                        not collect_first_time; Task 3 must cover it)
```

Implement in order: 1 → 2 → 3. Verify after each.

---

## Task 1 — Add location to `buildOwnerAlert()`

**File:** `lib/twilio.ts`
**Lines affected:** insert after line 58, before line 60

Current block (lines 54–60):
```ts
  // Timing
  const timeParts: string[] = [];
  if (state.preferredDate) timeParts.push(state.preferredDate);
  if (state.preferredTime) timeParts.push(state.preferredTime);
  if (timeParts.length) lines.push(`Zaman: ${timeParts.join(" ")}`);

  if (score === "HOT") lines.push("Hizli donus yapilmali");
```

After change (insert one line between the timing block and the HOT line):
```ts
  // Timing
  const timeParts: string[] = [];
  if (state.preferredDate) timeParts.push(state.preferredDate);
  if (state.preferredTime) timeParts.push(state.preferredTime);
  if (timeParts.length) lines.push(`Zaman: ${timeParts.join(" ")}`);

  if (state.location) lines.push(`Konum: ${state.location}`);

  if (score === "HOT") lines.push("Hizli donus yapilmali");
```

**What this fixes:** `state.location` is extracted and stored in state but was never rendered in the alert string.

**Verify:**
```bash
npm run type-check        # must exit 0
npm run test-whatsapp     # expect 11 → 9 failures
                          # newly passing: T4: ownerAlert includes Kadıköy
                          #                W6: ownerAlert includes Kadıköy
npm run test-sms          # must not regress
npm run test-inbound      # must not regress
```

---

## Task 2 — Remove `firstTimeLaser` gate from `getNextStage()`

**File:** `lib/conversationState.ts`
**Line affected:** line 162 (delete it entirely)

Current `getNextStage()` (lines 160–166):
```ts
export function getNextStage(state: ConversationState): Stage {
  if (!state.treatmentArea && !state.service) return "collect_treatment_area";
  if (state.firstTimeLaser === undefined) return "collect_first_time";   // DELETE
  if (!state.preferredDate && !state.preferredTime) return "collect_datetime";
  if (!state.name) return "collect_name";
  return "complete";
}
```

After change:
```ts
export function getNextStage(state: ConversationState): Stage {
  if (!state.treatmentArea && !state.service) return "collect_treatment_area";
  if (!state.preferredDate && !state.preferredTime) return "collect_datetime";
  if (!state.name) return "collect_name";
  return "complete";
}
```

**Do not touch:**
- The `Stage` type definition — keep `"collect_first_time"` in the union (it remains a valid stage value even if `getNextStage()` no longer returns it).
- `STAGE_FALLBACK` in `inboundPipeline.ts` — keep the `collect_first_time` entry as a safe fallback.
- `extractSlots()` in `slotExtractor.ts` — still extracts `firstTimeLaser` when the user mentions first-time/returning info.

**New stage progression after this change:**
```
collect_treatment_area  (no service/area yet)
→ collect_datetime      (service known, no date/time)
→ collect_name          (date/time known, no name)
→ complete
```

**What this fixes:**
- Flow was unconditionally blocked at `collect_first_time` because test conversations (and many real users) never explicitly answer "ilk kez mi?".
- Removing the gate lets the flow advance to `collect_name` and `complete`.

**Verify:**
```bash
npm run type-check        # must exit 0
npm run test-whatsapp     # expect 9 → 6 failures
                          # newly passing: T4: stage = complete
                          #                W6: stage = complete
                          #                D1: isFirstComplete triggers before flag written
npm run test-sms          # must not regress
npm run test-inbound      # must not regress
npm run test-reset        # must not regress
```

---

## Task 3 — Expand name fallback to additional stages

**File:** `lib/inboundPipeline.ts`
**Lines affected:** 63–80 (the name fallback block)

**Context:** After Task 2, the stage at W2 ("ayşe") is `collect_datetime` (service was set at W1, no date/time yet). The current fallback only triggers in `collect_name`. It must also trigger in `collect_datetime` (and `collect_first_time` defensively). A guard ensures it only fires when the message produced no other extractable slots — preventing date/time strings or phone numbers from being mistaken for names.

Current block (lines 63–80):
```ts
  // Stage-aware name fallback: bare Turkish names like "ayşe" or "mehmet" aren't caught
  // by NAME_PATTERNS (which require explicit prefixes). When we're in collect_name stage
  // or the last assistant message asked for a name, try the heuristic fallback.
  if (!extractedSlots.name) {
    const needFallback =
      stateBefore.stage === "collect_name" ||
      stateBefore.history
        .slice(-2)
        .some(
          (h) =>
            h.role === "assistant" &&
            /isminizi|adınızı|adınız\b|adını/i.test(h.content)
        );
    if (needFallback) {
      const fallback = extractNameFallback(input);
      if (fallback) extractedSlots.name = fallback;
    }
  }
```

After change:
```ts
  // Stage-aware name fallback: bare Turkish names like "ayşe" or "mehmet" aren't caught
  // by NAME_PATTERNS (which require explicit prefixes). Try the heuristic fallback when
  // no other slots were extracted from this message (guard) and either the stage expects
  // a name or the user appears to be volunteering one early.
  if (!extractedSlots.name) {
    const noOtherSlots = Object.keys(extractedSlots).length === 0;
    const needFallback =
      noOtherSlots &&
      (stateBefore.stage === "collect_name" ||
        stateBefore.stage === "collect_first_time" ||
        stateBefore.stage === "collect_datetime" ||
        stateBefore.history
          .slice(-2)
          .some(
            (h) =>
              h.role === "assistant" &&
              /isminizi|adınızı|adınız\b|adını/i.test(h.content)
          ));
    if (needFallback) {
      const fallback = extractNameFallback(input);
      if (fallback) extractedSlots.name = fallback;
    }
  }
```

**Guard semantics:** `noOtherSlots` is `true` only when `extractSlots()` found zero slots. If the user sends "cumartesi öğleden sonra", `extractedSlots` will contain `{preferredDate, preferredTime}` → `noOtherSlots = false` → fallback skipped. If the user sends "ayşe", `extractedSlots` is `{}` → `noOtherSlots = true` → fallback runs.

**False-positive protection (already in `extractNameFallback`):**
- `BARE_NAME_RE` rejects strings that don't look like Turkish names.
- `NAME_BLOCKLIST` explicitly blocks common single-word replies like "evet", "hayır", "tamam", "merhaba", etc.
No changes needed to `slotExtractor.ts`.

**What this fixes:**
- W2 "ayşe" is extracted as "Ayşe" → W3/W4/W6 name assertions pass as side effect.
- W6: ownerAlert includes Ayşe → passes (name now in state).
- W6: shouldLogToSheet = true → passes (name fills the last required field).

**Verify:**
```bash
npm run type-check        # must exit 0
npm run test-whatsapp     # expect 6 → 0 failures
                          # newly passing: W2: name = Ayşe
                          #                W3: name still Ayşe
                          #                W4: name still Ayşe
                          #                W6: name = Ayşe
                          #                W6: ownerAlert includes Ayşe
                          #                W6: shouldLogToSheet = true
npm run test-sms          # must not regress
npm run test-inbound      # must not regress
npm run test-reset        # must not regress
```

---

## Final regression check (after all three tasks)

```bash
npm run type-check    # 0 errors
npm run test-whatsapp # 0 failures
npm run test-sms      # 0 failures
npm run test-inbound  # 0 failures
npm run test-reset    # 0 failures
```

---

## Files changed (complete list)

| File | Task | Change |
|---|---|---|
| `lib/twilio.ts` | 1 | Add `Konum:` line after timing block in `buildOwnerAlert()` |
| `lib/conversationState.ts` | 2 | Delete `firstTimeLaser === undefined` gate from `getNextStage()` |
| `lib/inboundPipeline.ts` | 3 | Extend `needFallback` stages + add `noOtherSlots` guard |

No test files, no schema files, no other lib files.

---

## Boundaries

| Rule | Detail |
|---|---|
| Stage type | Keep `"collect_first_time"` in the `Stage` union and in `STAGE_FALLBACK` |
| `firstTimeLaser` schema field | Keep in `ConversationState`; still extracted by `extractSlots()` |
| `extractNameFallback()` | Do not modify — `BARE_NAME_RE` and `NAME_BLOCKLIST` are correct |
| Scope | `lib/` only — no test file changes |
| New abstractions | None — three targeted edits |
