# Federated Clash Test core — P3 remediation focused re-review: targeted adjudication

- **Date:** 2026-09-22
- **Adjudicated artifact:** [`2026-09-21-federated-clash-test-core-p3-remediation-focused-rereview.md`](2026-09-21-federated-clash-test-core-p3-remediation-focused-rereview.md) (0 Critical, 0 High, 0 Medium, 1 Low; verdict "P3 remediation passes focused independent re-review with one non-blocking Low disposition; targeted adjudication is required before P3 acceptance").
- **Repository state adjudicated:** branch `feature/federated-clash-test-core-engine`, remediation checkpoint and HEAD `75b4a8b59cd58174a85f4564126bbdce9a2faeae`; working tree at review time carried only the review artifact and the handoff.
- **Method:** `CLAUDE.md` "Independent review adjudication". Scope limited to the review's six resolution claims (H1–H4, M1, L1), its one new Low finding (L-R1), the commit boundary, test evidence and gate verdict — not a new unrestricted P3 review. **Read-only: no production code, test, plan or spec was modified.**

## Result

**Work review and adjudication AGREE on the gate verdict.** All six adjudicated findings (H1, H2, H3, H4, M1, L1) are confirmed resolved at `75b4a8b`. The new L-R1 (Low) is confirmed and correctly dispositioned as non-blocking. No disagreement to persist; no owner-decision escalation required.

## Verification of the six resolution claims

| Finding | Review claim | Adjudication |
| --- | --- | --- |
| H1 | `createPlan` consumes `decomposeCellsLazy` directly; limit-exhaustion stops the generator at `limit + 1`; byte-identical to the old eager output | **CONFIRMED.** `decompose.js:60` is a generator (`decomposeCellsLazy`); `decompose.js:128-129` `decomposeCells` is `[...decomposeCellsLazy(args)]`, an explicit eager wrapper, not the production path. Verified `planner.js` sizing consumes the generator (not an array) and `sizing.js:247` maps each `WorkUnit.targets` through `entries.map(toTarget)` — a **fresh array**, so no aliased CellSpec array ever reaches a `WorkUnit` or the frozen `Plan`. `test/clashtest/planning/decompose.test.mjs` and `planner.test.mjs` still pass (311/311 planning). |
| H2 | Sliced table/sizing/assembly/freeze steps; `stagePlanned` builds without mutating; `commitPlanned` is one O(1) post-checkpoint swap; cancellation before commit leaves the ledger unchanged; stale/foreign commits rejected | **CONFIRMED** by the prior remediation's own mutation checks (stale-commit guard, cancellation-untouched, commit-last tests) re-run green here; not re-derived independently in this adjudication pass (already adjudicated in the prior H1/H2/L1 record with direct repros). No new evidence contradicts it. |
| H3 | Both digest paths validate/project through yielded steps, use `sortSliced`, byte-identical to sync | **CONFIRMED** (carried from the prior adjudication's H3 finding disposition and the remediation's own byte-identity tests; `scopeDigest.test.mjs` green). |
| H4 | `unresolved` validated strictly ascending/unique; `rootResolution` defensively canonicalizes | **CONFIRMED.** `ElementEnumerator.test.mjs`/`rootResolution.test.mjs` green; matches the prior adjudication's repro of the fix. |
| M1 | Malformed whole observation/expectation → `unverifiable/malformed-observation`, not `mismatch` | **CONFIRMED** (`scopeDigest.test.mjs` symmetric whole/roots tests green; matches the prior adjudication's repro). |
| L1 | Wall-clock assertion replaced by a deterministic counter seam | **CONFIRMED.** `planner.test.mjs` no longer asserts `elapsed < 500`; asserts `plan-too-large`/`unit-record` plus `units + gaps === limit + 1`. |

## Verification of the new Low finding (L-R1)

**CONFIRMED by direct repro, disposition AGREED (non-blocking).**

Built a 3-model fixture (`m1: A=[1]`, `m2: A=[2]`, `t: B=[9]`) through `buildRootTables` + `decomposeCells`:
```
cell1 count 2
same targets ref: true
frozen: false
sibling length before/after mutation: 1 0
```
Confirms `decomposeCellsLazy`'s cell-1/cell-2 `targets` array is shared by reference across every cell of that id (the `once()` memoization at `decompose.js:69-70`), is not frozen, and mutating one cell's `targets` mutates its sibling's. This is the same object `decomposeCells` (the eager oracle/test wrapper) returns un-cloned.

**Production-path safety independently verified:** `sizing.js:247` (`targets: entries.map(toTarget)`) always builds a **new** array for every `WorkUnit.targets`; the shared CellSpec-level array is read (`sliceTargets`, `pairSpaceWeightOf`, `targetWeightOf`) but never stored by reference into a unit, and the final `Plan` is deep-frozen by `planner.js` after assembly. No aliasing therefore reaches `createPlan`'s output or any P4/P6-facing structure. The review's "not a P3 acceptance blocker" claim holds under this independent check, and no regression test currently pins the aliasing contract (confirmed absent from `decompose.test.mjs`), consistent with the review's own statement.

## Boundary and test evidence

- **Boundary — CONFIRMED.** `git show --stat --format= 75b4a8b` → 21 files changed, +1,630/−277 — matches the remediation record and this review exactly. No `collision/`, `wwwroot/`, `package*.json`, spec, or P0/P1/P2 file in the diff; `grep collision clashtest/planning` shows one code comment ("collision-eligible fragment"), no import.
- **Tests — CONFIRMED.** `node --test test/clashtest/planning/*.test.mjs` → **311/311**. `node --test $(find test/clashtest -name '*.test.mjs')` → **628/628**.
- **Full runner — RECONCILED, not a discrepancy.** This adjudication's environment: `node scripts/run-tests.mjs` → **1,754 total / 1,753 pass / 0 fail / 1 todo**, exit 0 — matching the remediation record's own "unrestricted run" figure that the review already cites as a cross-check, not the review's own restricted-environment run (1,749 pass / 4 fail: 3 pre-existing sandbox `EPERM` M4 spike-server tests + 1 `ContainmentModeQuery` real-time-budget assertion). Both the review and this adjudication agree these four are environment-dependent and outside `clashtest/`; no P3 or Clash Test failure occurred in either environment. `git diff --check` clean.

## Gate verdict

`P3 remediation checkpoint (75b4a8b) ACCEPTED. All six adjudicated findings (H1, H2, H3, H4, M1, L1) are confirmed resolved; the new Low (L-R1, shared/unfrozen target array in the eager decompose oracle) is confirmed and correctly dispositioned as non-blocking, with production-path aliasing safety independently verified.` The Work review and this adjudication **agree**; no disagreement to persist, no owner-decision escalation.

**P3 is accepted, subject to disposition of L-R1** (recommended, not authorized: freeze the shared target list, or detach it in the eager wrapper, with a regression test pinning the chosen contract — deferred, non-blocking, may be picked up in a later pass or left as a documented eager-wrapper caveat).

P4 does **not** begin from this adjudication. `CLAUDE.md` transition rules and the handoff still require the milestone owner's separate, explicit go-ahead.

## Not adjudicated / unchanged

The prior H1–H4/M1/L1 remediation repros are not re-derived here (already adjudicated with direct evidence in [`2026-09-21-federated-clash-test-core-p3-independent-review-adjudication.md`](2026-09-21-federated-clash-test-core-p3-independent-review-adjudication.md)); this pass verified the review's *resolution claims* against the committed code and added an independent repro only for the new L-R1 finding, per the focused-review scope. P0.8 remains G-CAL-blocked. The P6 `stagePlanned`/`commitPlanned` interface carry-forward, the AC-12/G-CAL `structuredClone` item, the P5 `taints[]` ceiling item, and the roots-observation row-shape gap are unchanged carry-forwards. No spec, plan, or acceptance mapping was altered.
