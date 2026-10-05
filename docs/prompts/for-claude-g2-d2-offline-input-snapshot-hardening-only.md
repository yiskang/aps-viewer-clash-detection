# For Claude — G2 D2-OFFLINE Input-Snapshot Hardening Only

Authorize one bounded D2-OFFLINE hardening pass to close the remaining Medium checkpoint blocker from the latest Work re-review.

## Baseline to verify

- repo: `aps-viewer-clash-detection`
- branch: `main`
- `main == origin/main == 53ea0a74b215b4a3c7463b8fe7da4bf783b8c8fb`
- harness SHA unchanged: `cc8868cd68b9c2c3382297070289a2aa165c74249c6d82896d76bacc6c6ef09b`
- procedure SHA unchanged: `d1ccfde224b8ae76fe74b06c93abc532e6df9612933cafaa045053c8e2e45a75`
- immutable evidence unchanged
- historical G2 remains `FAIL (row 3)`
- historical C6 remains `NOT_EVIDENCED`
- historical C8 unresolved
- T4 unchanged
- no live retry / new authorization record / attempt reset
- nothing committed or pushed

Accepted D2 baseline:
- D2 tests: `49/49`
- offline suite: `5,155 total / 5,154 pass / 0 fail / 1 existing todo`
- exhaustive schedules: `52,308`
- D=30 characterization: `36`
- retained traces: `104`
- output digest: `e1d1b815ed351e6feba3e34822ba9895e54035158e685bfbe7f628f6d10bbb06`
- D=30 remediation accepted
- M-GAP witness remediation accepted
- provenance/dedup/pin wording accepted

If baseline differs materially, stop.

## Medium blocker — owned input snapshots

Current defect: `fixtures.json` and R1 are hashed, then reopened for parsing. A concurrent replacement could make validated bytes differ from consumed bytes.

Fix this so each validated input is read once into one owned byte snapshot.

For each relevant input:
1. read the file once;
2. store exact bytes in memory;
3. compute SHA-256 from those bytes;
4. validate against expected digest;
5. parse/consume those same bytes;
6. never reopen the path for semantic consumption during that run.

At minimum apply this to:
- `fixtures.json`
- retained R1 input

Preserve fail-closed behavior:
- digest mismatch fails before enumeration;
- unvalidated bytes are not consumed;
- pins are not silently changed.

The already ratified spec/fixture/input digest semantics remain unchanged.

A helper such as `readValidatedSnapshot(...)` is fine if useful, but keep changes D2-local.

## Required regression tests

Add focused D2-local tests for:

1. Valid snapshot:
   - one read;
   - digest matches;
   - parser consumes exactly those bytes.

2. Digest mismatch:
   - fails before enumeration;
   - invalid bytes are not trusted/consumed.

3. Replacement after read:
   - capture bytes A;
   - mutate/replace backing file with bytes B;
   - parser still consumes A;
   - reported digest corresponds to A;
   - no second semantic read occurs.

4. Independent snapshots:
   - fixtures and R1 each own independent bytes/digests.

## Low — 128-byte row-cap boundary test

Work verified the 128-byte trace-row cap is enforced on the only insertion path; the remaining gap is exact boundary testing.

Add tests for:
- exactly 128 B: accepted if current semantics are inclusive;
- 129 B: rejected/fail-closed;
- optionally 127 B control.

Do not change the cap or its existing semantics.

## Preserve accepted results

Do not change:
- exhaustive count `52,308`
- cell split `4,104 / 4,788 / 18,144 / 25,272`
- D=30 count `36`
- D=30 `modelValid:false`, 36 V5 violations, 12 `INVALID_AMBIGUOUS`
- all four exhaustive cells `A`
- H2 `SUPPORTED` in all exhaustive cells
- H5 `SUPPORTED` in all exhaustive cells
- C6/N2 outcome `E`
- `d_min = none`
- failing pair `P_C6 ~ L_home`
- retained M-GAP witnesses
- no selected C6 margin
- historical C8 unresolved

If any mechanical result changes, stop and investigate.

## Verification

Run:
`node --test docs/research/2026-10-04-g2-d2-synthetic-transition/*.d2-test.mjs`

Baseline was 49/49; report new count and require all pass.

Run:
`npm run test:offline`

Expected:
`5,155 total / 5,154 pass / 0 fail / 1 existing todo`

Run simulator twice from clean output directories. Verify:
- schedule counts unchanged;
- H2/H5 unchanged;
- C6/N2 unchanged;
- D=30 reporting unchanged;
- mechanism coverage unchanged;
- outputs byte-identical across both runs.

If output digest changes only because metadata changes, explain why.

Run `git diff --check`.

Confirm no changes to:
- accepted D2 spec
- real G2 harness
- `test/acceptance/`
- `src/`
- `wwwroot/`
- procedure
- immutable evidence
- T4/C6/C8 runtime logic

## Internal review

Perform one focused internal review with explicit:
- Critical
- High
- Medium
- Low

Review:
- owned snapshot semantics
- hash == consumed bytes
- no path reopen
- fail-closed mismatch behavior
- replacement-after-read regression
- independent fixtures/R1 snapshots
- exact 128 B boundary tests
- result preservation
- determinism
- scope discipline

Fix genuine Critical/High defects within this bounded scope.

Persist under `docs/reviews/`.

## Handoff

Update `docs/handoffs/latest.md` with:
- baseline `53ea0a7...`
- snapshot hardening status
- fixtures/R1 validated and consumed from one owned byte snapshot
- new D2 test count
- offline suite result
- deterministic rerun status
- output digest
- schedule/results unchanged
- 128-byte boundary-test status
- no live/system changes
- next action: targeted independent Work re-review of input-snapshot hardening

## Prohibited

Do not:
- alter D2 spec
- modify real harness/product/procedure
- change T4/C6/C8 runtime behavior
- run Viewer/browser/live G2
- retry G2
- issue new authorization record
- reset attempt state
- commit
- push

## Stop gate

Stop after hardening, tests, two deterministic runs, internal review, and handoff update.

Next gate:

**Targeted independent Work re-review of D2-OFFLINE input-snapshot hardening → owner decision on checkpoint commit/push and any later diagnostic-instrumentation gate**
