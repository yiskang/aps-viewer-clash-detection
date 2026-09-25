# Federated Clash Test core — P3 remediation focused independent re-review

- **Date:** 2026-09-21
- **Branch:** `feature/federated-clash-test-core-engine`
- **HEAD / committed boundary:** `75b4a8b` (`fix(clashtest): P3 review remediation (lazy decomposition, sliced planning spans, atomic ledger tail)`)
- **Reviewed checkpoint:** the committed P3 remediation of the adjudicated H1–H4, M1, and L1 findings.
- **Review authority:** the original [P3 independent review](2026-09-21-federated-clash-test-core-p3-independent-review.md) and its [targeted adjudication/remediation record](2026-09-21-federated-clash-test-core-p3-independent-review-adjudication.md).
- **Scope:** only the six remediated findings and their directly affected planning, cancellation, ledger-atomicity, and P6-facing invariants. This is not a new unrestricted P3 review and does not reopen accepted P0–P2 or the frozen design.

## Verdict

**All six adjudicated findings are resolved at the reviewed boundary. This focused re-review found 0 Critical, 0 High, 0 Medium, and 1 Low non-blocking finding in scope.** The Low finding is confined to the eager oracle/test helper and does not affect `createPlan` or the production lazy planning path.

This document is an independent review claim under `CLAUDE.md`. P3 is not accepted until a targeted adjudication verifies the resolution claims, commit boundary, test evidence, Low disposition, and gate verdict. P4 remains blocked and also requires separate explicit owner authorization after the P3 gate clears.

## Resolution verification

### H1 — eager pair-space materialization: resolved

`createPlan` now consumes `decomposeCellsLazy` directly through sliced sizing. Cell 1 and cell 2 each construct their source-independent target list once, cell 3a walks only models with a C table, and cell 3b remains recursively generated. Limit-exhaustion tests prove the generator is stopped after the first `limit + 1` units instead of materializing the remaining pair space; randomized fixtures preserve the old eager output bytes and order.

### H2 — unsliced planning spans and post-checkpoint ledger writes: resolved

Root-table construction, sizing, unit assembly, root-owner rows, staging/index work, and the deep-freeze traversal now expose sliced steps consumed through the planning checkpoint. Planning ledger mutations are prepared by `stagePlanned`, which does not mutate live ledger state, then applied after the last checkpoint by one O(1) `commitPlanned` swap. Cancellation or validation failure before commit leaves the ledger unchanged; stale and foreign commits are rejected before mutation.

The remediation does not claim that every bounded helper operation is independently sliceable. The remaining per-model `structuredClone`, bounded per-unit id sort, root-resolution gaps, and whole-helper timing are already assigned to AC-12/G-CAL. They are verification/calibration carry-forwards, not a P3 correctness blocker.

### H3 — digest preprocessing outside the slicer: resolved

Both expectation and observation digest paths now validate/project records through yielded steps, use `sortSliced`, and digest canonicalized records through the sliced helper. Tests cover byte-equivalence with the synchronous form, labels, large inputs, and cancellation during preprocessing.

### H4 — unresolved-id identity instability: resolved

`ElementEnumerator` now validates `unresolved` as strictly ascending and unique. `rootResolution` defensively canonicalizes unresolved ids with ascending uniqueness before it creates the enumerator result. The direct duplicate-id probe is rejected with `unresolved-not-ascending`, and the committed tests pin stable counter behavior.

### M1 — malformed whole-population observations: resolved

Whole-population expectation and observation rows now pass through `validateDigestScopeResult`. A malformed whole observation produces `unverifiable` with `malformed-observation`, rather than a false `mismatch`. The previously recorded roots-observation row-shape gap is unchanged and remains a separate carry-forward outside this remediation boundary.

### L1 — wall-clock-only counter assertion: resolved

The test now uses a deterministic counter seam to prove the bounded planning walk and early cutoff. It no longer relies on elapsed wall-clock time as its correctness oracle.

## Low finding

### L-R1 — the eager helper exposes a shared mutable target list

`decomposeCellsLazy` intentionally shares one target array among same-cell source rows to meet H1's memory bound. `decomposeCells`, documented as the eager oracle/test wrapper, returns those same aliased arrays without freezing or cloning them. A direct probe showed `cell1[0].targets === cell1[1].targets`, `Object.isFrozen(...) === false`, and that popping one cell's targets changes its sibling.

This does not affect production planning: `createPlan` consumes the lazy stream and all downstream code treats targets as read-only. It is therefore not a P3 acceptance blocker. The minimum later correction is either to freeze the shared list (and the intended immutable members) or make the eager compatibility wrapper detach target lists; a regression test should pin the selected contract. Do not expand the remediation loop solely for this Low concern without adjudication.

## Interface and scope checks

- The planner now requires supplied ledgers to implement `stagePlanned` and `commitPlanned`; P6 fakes/ports must be reconciled before P6 execution.
- `checkpoint(label)` still receives an inert extra label argument, matching the existing owner disposition.
- No collision-library, Viewer, `wwwroot`, package, frozen-specification, P0, P1, or P2 file changed in the remediation commit.
- Viewer/OQ-4, remote persistence, annotation/derivation follow-up, calibrated defaults, P8, and M4 Phase 4 remain outside this checkpoint.

## Verification

- P3 planning suite: `node --test test/clashtest/planning/*.test.mjs` → **311 passed, 0 failed**.
- All implemented Clash Test suites: `node --test test/clashtest/**/*.test.mjs` → **628 passed, 0 failed**.
- Direct probes: duplicate unresolved ids are rejected; malformed whole observations are `unverifiable`; the roots-row validation carry-forward remains reproducible; eager target-list aliasing is reproducible.
- Repository runner in this restricted review environment: `node scripts/run-tests.mjs` → **1,754 total; 1,749 passed; 4 failed; 1 todo**. Three failures are the pre-existing M4 spike-server tests blocked by sandbox `listen EPERM`; the fourth is the unrelated `ContainmentModeQuery` real-time budget assertion, which also failed when rerun alone. No P3 or Clash Test test failed. The remediation record separately reports an unrestricted run with 1,753 passed / 0 failed / 1 todo.
- `git diff --check`: clean before this review artifact and handoff update. The focused layering scan found no collision, Viewer, Three.js, or Autodesk import in P3 planning source/tests.

## Gate result

`P3 remediation passes focused independent re-review with one non-blocking Low disposition; targeted adjudication is required before P3 acceptance.`

Do not start P4. After targeted adjudication agrees with this review, update the handoff to accept P3; P4 still requires a separate explicit owner go-ahead.
