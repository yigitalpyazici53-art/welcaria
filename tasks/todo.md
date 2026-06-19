# TODO: test-reset-endpoint.ts — Turkish schema alignment

File: `scripts/test-reset-endpoint.ts`

## Tasks

- [x] **Task 1 — Change A** — Replace `"collect_service"` with `"collect_treatment_area"` in `updateState()` calls
  - Line 154 (Section 3 — bare phone reset)
  - Line 176 (Section 4 — plus-prefixed phone reset)
  - Verify: `npm run type-check` exits 0

- [x] **Checkpoint A** — `npm run type-check` ✅

- [x] **Task 2 — Change B** — Fix post-reset `assertEqual` assertions from `"collect_name"` to `"collect_treatment_area"`
  - Line 168 (Section 3 — stateAfterReset)
  - Line 190 (Section 4 — stateAfterReset2)
  - Update both the label string and the expected value
  - Verify: `npm run test-reset` exits 0

- [x] **Checkpoint B — Regression suite**
  - [x] `npm run test-reset`    — primary
  - [x] `npm run test-sms`      — no regression
  - [x] `npm run test-inbound`  — no regression
  - [ ] `npm run test-whatsapp` — 11 pre-existing failures, out of scope for this change (see follow-up note below)

## Done when

All five commands exit 0 and no file outside `scripts/test-reset-endpoint.ts` is modified.

## Follow-up

`npm run test-whatsapp` has 11 failures that pre-date this branch (confirmed by stash test on unmodified commit `d0b8e7f`). Root causes: stage stuck at `collect_first_time` because test conversations never provide `firstTimeLaser`; name not extracted as a result; `location` missing from `buildOwnerAlert()`. Requires a separate spec and PR.
