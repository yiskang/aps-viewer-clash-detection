# For Claude — G2 C3/C2 Bounded Harness-and-Test Correction Only

I explicitly authorize **one bounded C3/C2 harness-and-test correction only** based on the latest independent Work review.

This authorization is limited to the deterministic intent-name/value defects confirmed in C3 and C2.

It does **not** authorize:

- C8 implementation/instrumentation;
- C6/N2 implementation;
- T4 settle-rule changes;
- diagnostic live runs;
- another G2 acceptance retry;
- a new authorization record;
- attempt reset;
- procedure changes;
- production/Core/Viewer Adapter/Panel changes;
- G3 or downstream work;
- commit or push.

Use the repository as the source of truth.

## 1. Verify authoritative baseline first

Before editing, verify:

- repo: `aps-viewer-clash-detection`
- branch: `main`
- committed HEAD:
  `6f716bc0d0d2c1b1e61d26fe50b4dbe56266f7e4`
- `main == origin/main`
- immutable evidence snapshot exists and is unchanged:
  `docs/research/evidence/g2-live-20261004-75a3ccb9/`
- exactly-one live G2 remains closed at:
  `FAIL (row 3)`
- no retry occurred
- no new authorization record was issued
- no attempt state was reset
- harness SHA still matches the pre-remediation committed value
- procedure SHA unchanged

Read at minimum:

- `docs/research/2026-10-04-g2-c3-c8-c6-remediation-plan.md`
- `docs/reviews/2026-10-04-g2-c3-c8-c6-remediation-plan-independent-review.md`
- `docs/handoffs/latest.md`
- current harness code for C2/C3
- product intent constants/source
- preserved live evidence only as read-only context

If baseline differs materially, stop and report.

## 2. Authorized defect scope

Correct only the confirmed C3/C2 intent-name/value mismatch.

### C3

Current defect:

- harness compares dispatched intent values against:
  `PANEL_SHOWN`
  `PANEL_HIDDEN`
- product actually dispatches:
  `panel/shown`
  `panel/hidden`

Make the smallest safe correction so the oracle compares against the canonical **values**, not enum/property names.

### C2

Correct the same mismatch in C2's relevant `domainWrites` / clause-(viii) evidence path.

Do not change unrelated C2 semantics.

The latest Work review concluded:

- C2 contains the same latent mismatch;
- no other G2 intent-key name/value site was found in the reviewed scope;
- C2's defect is real even though clause (vii) already prevents an overall PASS if construction dispatches anything.

Preserve that broader logic.

## 3. Preferred implementation shape

Prefer a correction that is robust against future drift.

Evaluate in this order:

1. import/use the canonical product intent constant **values** if the harness architecture can do so safely without coupling problems;
2. otherwise use canonical literal values with a regression test that asserts they match the product intent constants;
3. avoid comparing symbolic property names.

Do not introduce a new abstraction unless needed.

Do not refactor unrelated intent logic.

## 4. Required regression tests

Add targeted offline tests proving both old defects are fixed.

At minimum:

### C3 regression
- exercise dispatched values:
  `panel/shown`
  `panel/hidden`
- prove the corrected oracle accepts them;
- include a mutation/regression case that would fail if the harness reverted to comparing against:
  `PANEL_SHOWN`
  `PANEL_HIDDEN`.

### C2 regression
- exercise the clause-(viii) / `domainWrites` path with real dispatched intent values;
- prove the evidence classification uses the canonical values;
- prove the old name/value mismatch would fail.

Do not alter unrelated acceptance expectations.

## 5. Bounded sibling audit

Re-run the exact bounded static audit for the same defect class:

- C1–C20 intent-key comparisons
- name-vs-value misuse only

Do not broaden into a general harness audit.

If another same-class defect is found:

- stop;
- report it;
- do not silently expand scope beyond C2/C3.

## 6. Procedure neutrality

This correction must not change:

- accepted G2 procedure;
- verdict rows;
- control states;
- attempt semantics;
- cleanup semantics;
- T4 settle rule;
- C6 `NOT_DISCRIMINATING` design;
- C8 frustum/settle behavior;
- C20 dependency behavior.

If the implementation would require any procedure change, stop and report.

## 7. Preserve immutable evidence

Do not modify:

`docs/research/evidence/g2-live-20261004-75a3ccb9/`

Do not reinterpret or rewrite the prior FAIL evidence.

The live attempt remains historically:

`FAIL (row 3)`

even after correcting the harness defect.

## 8. Verification

Run the strongest relevant offline verification.

At minimum:

- targeted C2/C3 oracle tests;
- focused G2 oracle suite;
- focused G2 acceptance suite if practical;
- offline aggregate if practical;
- `git diff --check`.

Report exact pass/fail/TODO counts.

No live harness execution is authorized.

## 9. Recompute harness identity

Because harness code changes are authorized:

- recompute harness SHA after final edits;
- confirm procedure SHA unchanged;
- record the new **uncommitted** harness SHA.

Do not issue a new authorization record.

The new harness SHA is for review/checkpoint purposes only.

## 10. Focused internal review

Perform one focused internal review over only:

- C3 correction;
- C2 correction;
- regression tests;
- sibling-audit result;
- procedure neutrality;
- accidental scope expansion.

Classify Critical / High / Medium / Low.

Fix genuine Critical/High issues within the authorized C2/C3 scope.

Persist under:

`docs/reviews/`

Update:

`docs/handoffs/latest.md`

## 11. Handoff requirements

Update the handoff to state:

- G2 exactly-one live attempt remains closed at `FAIL (row 3)`;
- immutable evidence checkpoint remains authoritative;
- C3 deterministic harness-oracle defect corrected in working tree;
- C2 latent same-class defect corrected in working tree;
- no other same-class intent-key mismatch found in bounded audit, if verified;
- new uncommitted harness SHA;
- procedure SHA unchanged;
- C8/C6 remain unresolved and unimplemented;
- T4 unchanged;
- no retry/new authorization record;
- next action:
  **independent Work review of the bounded C3/C2 correction**.

Do not imply retry readiness.

## 12. Commit policy

Do not commit or push.

Leave the C2/C3 code/test changes, internal review, and handoff update uncommitted for independent Work review.

## 13. Stop gate

Stop after:

- C3/C2 correction;
- targeted/offline verification;
- bounded sibling audit;
- harness SHA recomputation;
- internal review;
- handoff update.

Do not:

- implement C8 diagnostics;
- implement C6/N2 redesign;
- change T4;
- rerun live G2;
- issue a new authorization record;
- reset attempt state;
- start diagnostic live-run work;
- commit;
- push.

Next gate:

**Independent Work review of G2 C3/C2 bounded correction → owner decision on checkpoint commit/push and next bounded remediation phase**

## Final report

Report:

- branch / HEAD / origin relation;
- exact files changed;
- exact C3 correction;
- exact C2 correction;
- regression tests added;
- bounded sibling-audit result;
- verification results;
- new uncommitted harness SHA;
- procedure SHA;
- internal review findings;
- working-tree state;
- exact next gate.

Explicitly confirm:

- no C8/C6/T4 change;
- no live retry;
- no new authorization record;
- no attempt reset;
- immutable evidence unchanged;
- no commit;
- no push.
