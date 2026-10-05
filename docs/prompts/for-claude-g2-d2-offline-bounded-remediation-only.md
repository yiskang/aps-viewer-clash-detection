# For Claude — G2 D2-OFFLINE Bounded Remediation Only

I explicitly authorize **one bounded D2-OFFLINE remediation task only**.

This task exists solely to fix the two Medium blockers from the latest independent Work review and, within the same bounded pass, clean up the three non-blocking Low findings if they can be corrected without changing the accepted D2 specification or expanding implementation scope.

This authorization does **not** include:

- D2 spec changes;
- harness/product/procedure changes;
- T4/C6/C8 runtime changes;
- Viewer/browser/live execution;
- G2 retry;
- new authorization-record issuance;
- attempt reset;
- diagnostic/live instrumentation;
- checkpoint commit/push;
- downstream work.

Use the repository and latest independent Work review as the source of truth.

---

## 1. Verify baseline

Before editing, verify:

- repo: `aps-viewer-clash-detection`
- branch: `main`
- HEAD:
  `53ea0a74b215b4a3c7463b8fe7da4bf783b8c8fb`
- `main == origin/main`
- committed harness SHA unchanged
- accepted procedure SHA unchanged
- immutable evidence unchanged
- historical G2 remains `FAIL (row 3)`
- historical C6 remains `NOT_EVIDENCED`
- historical C8 remains unresolved
- T4 remains unchanged
- no Viewer/browser/live run occurred
- no retry/new authorization record/attempt reset occurred

Current accepted D2 verification baseline:

- D2 tests: `46/46`
- offline suite: `5,155 total / 5,154 pass / 0 fail / 1 existing todo`
- exhaustive schedules: `52,308`
- D=30 characterization schedules: `36`
- current retained output digest:
  `48bb1f81f5af97129b2098068f17582101d510edb572f0fefc726b5ce34ce82b`
- two prior simulator runs were byte-identical

Read:

- latest Work independent D2-OFFLINE review;
- accepted D2 spec;
- current simulator implementation/results/tests;
- current internal review;
- latest handoff.

If baseline differs materially, stop and report.

---

# Medium blocker 1 — D=30 model-invalid characterization

## 2. Correct D=30 interpretation

Work found:

- all `36` D=30 schedules violate `V5`;
- `12` are `INVALID_AMBIGUOUS`;
- current output wording incorrectly says these are “not model defects.”

Correct the implementation/reporting so the D=30 characterization set is described accurately as:

**model-invalid characterization outside the exhaustive D2 cell space**

Required semantics:

- D=30 remains characterization-only;
- all 36 V5 violations are explicitly recorded;
- the 12 `INVALID_AMBIGUOUS` cases are explicitly recorded;
- these results do not enter:
  - exhaustive cell counts;
  - A–E exhaustive outcome aggregates;
  - H2/H5 support/rejection evidence;
  - exhaustive invariant pass/fail status;
  - simulator success exit status, unless the accepted spec explicitly requires otherwise;
- wording must not claim these invalid characterization cases are “not model defects.”

Use precise wording such as:

> The D=30 characterization branch is outside the valid exhaustive model domain. All 36 schedules violate V5, and 12 are INVALID_AMBIGUOUS. These are model-invalid characterization results and are excluded from exhaustive H2/H5 inference.

Do not change the D=30 schedule definitions merely to make them valid.

Do not alter the accepted exhaustive domains.

Add/adjust regression tests for the reporting/classification boundary.

---

# Medium blocker 2 — retain deterministic M-GAP witness

## 3. Ensure M-GAP is represented in retained traces

Work found:

- M-GAP occurs in all four cells;
- none of the current `100` retained traces demonstrates M-GAP.

Correct deterministic witness retention so at least one retained trace explicitly demonstrates M-GAP.

Requirements:

- retain at least one deterministic M-GAP witness;
- preferably retain enough to prove coverage without displacing required witnesses for other mechanisms/outcomes;
- preserve deterministic witness selection;
- preserve stable witness IDs;
- preserve output caps:
  - retained trace cap `154`;
  - per-output cap `2.5 MiB`;
  - total cap `3.5 MiB`;
- do not inflate trace retention unnecessarily;
- do not alter the schedule enumeration or mechanism predicates just to create a witness.

Add a regression test that fails if:
- M-GAP occurs in the run but no retained trace carries M-GAP.

If shared witnesses satisfy multiple required mechanism slots, preserve all diagnostic/mechanism reasons after deduplication.

---

# Low findings — bounded cleanup allowed

## 4. Provenance labels

Correct any provenance labels identified by Work as misleading or incomplete.

Maintain the accepted historical/synthetic boundary:

Historical-derived:
- U
- A:104
- retained historical camera/frustum values where used

Synthetic:
- B:111
- A:135
- home geometry
- transition timing/order
- tail stalls
- calibration inputs

Do not relabel synthetic data as historical reconstruction.

---

## 5. Multi-reason regression test

Work found one multi-reason regression test is vacuous.

Replace or strengthen it so it actually exercises a shared witness / multi-reason case.

The test must prove that deduplication preserves all expected diagnostic/mechanism reasons.

Do not add synthetic production behavior solely to make the test pass.

---

## 6. Stale internal-review/input-pin wording

Correct stale wording in:

- internal review;
- input-pin descriptions;
- related D2 docs/results if necessary.

The already-ratified pins remain accepted:

- committed D2 spec digest;
- `fixtures.json` digest.

Do not change pin semantics unless an actual mismatch is discovered.

---

# Preserve accepted results

## 7. Do not alter accepted D2 mechanics

These independently accepted items must remain unchanged unless a real defect is discovered:

- exhaustive count:
  `52,308`
- cell split:
  - CL-primary `4,104`
  - CL-tail `4,788`
  - OP-primary `18,144`
  - OP-tail `25,272`
- D=30 count:
  `36`
- state machine
- numeric T4
- ownership oracle
- classifier
- tail branch
- H2 mechanically supported in every exhaustive cell
- H5 mechanically supported in every exhaustive cell
- C6/N2 outcome E
- no accepted C6 margin
- historical C8 unresolved
- spec/fixture digest pins ratified

If remediation changes any of these unexpectedly, stop and report instead of normalizing the result.

---

# Verification

## 8. Re-run local D2 tests

Run:

`node --test docs/research/2026-10-04-g2-d2-synthetic-transition/*.d2-test.mjs`

Expected baseline before adding tests was `46/46`.

Report the new exact count.

All tests must pass.

---

## 9. Re-run offline repository suite

Run:

`npm run test:offline`

Expected baseline:

- `5,155 total`
- `5,154 pass`
- `0 fail`
- `1 existing todo`

Report exact result.

No unrelated regression is acceptable.

---

## 10. Run simulator twice

Run the corrected D2 simulator twice from clean output directories.

Verify:

- exhaustive schedule count remains `52,308`;
- D=30 count remains `36`;
- all four exhaustive cell counts unchanged;
- H2/H5 results unchanged;
- C6/N2 result unchanged;
- D=30 is now reported as model-invalid characterization;
- M-GAP has at least one retained witness;
- retained trace count remains within cap;
- outputs remain deterministic.

Compare the two runs byte-for-byte.

Record the new output digest if remediation legitimately changes output bytes.

Do not attempt to preserve the old digest artificially.

---

## 11. Output checks

Confirm:

- no required witness class is missing;
- M-PRE retained;
- M-GAP retained;
- M-RST retained;
- M-TAIL retained;
- diagnostic reasons survive deduplication;
- D=30 invalid characterization is clearly separated;
- no historical-causality overclaim appears;
- size caps remain satisfied.

---

## 12. diff/scope verification

Run:

- `git diff --check`
- repository status inspection

Confirm no changes to:

- real G2 harness;
- `test/acceptance/`;
- production tests;
- `src/`;
- `wwwroot/`;
- accepted procedure;
- immutable evidence;
- T4/C6/C8 runtime logic.

---

# Internal review

## 13. Focused internal review

Perform one focused internal review after remediation.

This review **must use explicit classification**:

- Critical
- High
- Medium
- Low

Review at minimum:

1. D=30 characterization semantics;
2. V5/INVALID_AMBIGUOUS reporting;
3. exclusion from exhaustive H2/H5 inference;
4. M-GAP retained-witness coverage;
5. deterministic witness selection;
6. output caps;
7. multi-reason dedup regression test;
8. provenance labels;
9. input-pin wording;
10. schedule-count preservation;
11. determinism;
12. historical/synthetic boundary;
13. scope discipline.

Fix genuine Critical/High defects within this authorized remediation scope.

Persist under:

`docs/reviews/`

Do not commit.

---

# Handoff

## 14. Update handoff

Update `docs/handoffs/latest.md` with:

- baseline HEAD `53ea0a7...`;
- D2-OFFLINE remediation status;
- D=30 now explicitly model-invalid characterization;
- count of V5 violations / INVALID_AMBIGUOUS;
- M-GAP retained-witness status;
- new D2 test count;
- offline-suite result;
- deterministic rerun status;
- new output digest;
- exhaustive schedule/result invariants unchanged;
- C6/N2 unchanged;
- historical C8 unresolved;
- no real-system/live changes;
- next action:
  **targeted independent Work re-review of bounded D2-OFFLINE remediation**.

---

# Commit policy

## 15. Do not commit or push

Leave remediation code/results/tests/docs, review, and handoff update uncommitted.

No checkpoint is authorized yet.

---

# Stop gate

## 16. Stop after bounded remediation

Do not:

- alter D2 spec;
- modify real harness/product/procedure;
- change T4/C6/C8 runtime behavior;
- run Viewer/browser/live G2;
- retry G2;
- issue new authorization record;
- reset attempt state;
- commit;
- push.

Next gate:

**Targeted independent Work re-review of bounded D2-OFFLINE remediation → owner decision on checkpoint commit/push and any later diagnostic-instrumentation gate**

---

# Final report

Report:

- branch / HEAD / origin relation;
- exact files changed;
- Medium blocker 1 fix;
- Medium blocker 2 fix;
- Low-finding cleanup;
- new D2 test count/result;
- offline suite result;
- exhaustive schedule count;
- D=30 characterization result;
- M-GAP witness ID(s);
- H2/H5 result;
- C6/N2 result;
- retained trace count;
- output sizes;
- deterministic rerun digest;
- internal review C/H/M/L findings;
- working-tree state;
- exact next gate.

Explicitly confirm:

- no spec change;
- no real harness/test/product/procedure change;
- no T4/C6/C8 runtime change;
- no Viewer/browser/live run;
- no G2 retry;
- no new authorization record;
- no attempt reset;
- immutable evidence unchanged;
- no commit;
- no push.
