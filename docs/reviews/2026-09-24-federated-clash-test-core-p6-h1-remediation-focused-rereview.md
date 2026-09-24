# Federated Clash Test core P6 H1 remediation — focused independent re-review

**Date:** 2026-09-24  
**Repository:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`  
**Branch:** `feature/federated-clash-test-core-engine`  
**Reviewed checkpoint:** `771dc27e36aefb33870e8b653e1ef6bcfaf4da34`  
**Parent checkpoint:** `01e5341ac0b14b4bb6c45b398d42d575a1bc37f0`  
**Scope:** the owner-authorized H1 remediation only: `clashtest/run/Run.js`, the directly affected lifecycle tests, and the corresponding P6 contract/documentation. This is not a new unrestricted P6 review and does not reopen the frozen core design.

## Verdict

**The H1 remediation passes the focused correctness review.** The one-line representation change closes the original durable-invalidity failure, preserves fail-closed claim behavior, and introduces no production-code regression found by this review.

Findings: **0 Critical / 0 High / 1 Medium / 0 Low**.

The Medium finding is documentation drift in the P6 phase plan, not a runtime correctness defect and not a blocker to the H1 remediation itself. P6 is still **not accepted** until this review receives the targeted adjudication required by `CLAUDE.md` and the non-blocking items are dispositioned.

## H1 verification — resolved

The original H1 was concrete: a post-plan R10 fallback stored `planExists: true` while carrying no plan-derived `rootOwners`, `units`, or pair-space facts. P5's accepted reader then rejected the engine-produced Result Set with `coverage-model-mismatch`.

At `771dc27`, `emptyLedgerRecord` now records:

```js
planExists: false, pairSpaceTotal: 0, emptyOperand: false, units: [],
rootOwners: [],
planningGaps: [{ phase: run.phase, cause: 'internal-error' }],
```

This is the minimum correction authorized by the owner. The fallback represents itself as non-plan-backed instead of claiming plan facts it does not carry. `terminalInternalError` is the only caller of `emptyLedgerRecord`, so every R10 retry that constructs a replacement set receives the corrected representation.

The directly affected contracts were independently checked:

- `validateResultSet`'s plan/definition coverage reconciliation returns immediately unless `ledger.planExists === true`; the corrected fallback therefore no longer compares an empty stand-in ledger with the resolved definition.
- The fallback still has one `internal-error` planning gap, so its derived coverage remains `partial` and its terminal status remains `failed`.
- `assessNoClashClaim` still rejects the set independently: `completed`, `full`, `clean`, and non-empty pair-space are all required. The fix cannot turn the fallback into a no-clash claim.
- The ledger value remains part of the normal digest input. The change does not bypass sealing, residency, persistence, or digesting.

The new healthy-plan regression is materially distinct from the earlier broken-plan reproducer: provenance retains real model rows while the fallback ledger truthfully says it contains no plan representation. The real validator reports no issues and both public claim predicates reject the set.

## Finding

### Medium M1 — the P6 phase plan still contains the invalid pre-remediation fallback

**Location:** `docs/superpowers/plans/federated-clash-test-core/p6-run-lifecycle.md`, `emptyLedgerRecord` example, currently line 3531.

The governing phase plan still says:

```js
planExists: run.plan !== undefined, pairSpaceTotal: 0, emptyOperand: false, units: [],
```

That is the exact representation H1 proved invalid. The committed implementation, adjudication record, tests, and handoff now say `planExists: false`, but the executable plan example says the opposite.

**Failure mode:** a later maintainer implementing from, reconciling against, or mechanically copying the phase plan can restore the invalid `planExists: true` / empty-plan-facts combination and reintroduce `coverage-model-mismatch` at the durable read boundary.

**Classification:** implementation-plan documentation drift. It does not make the current code incorrect and does not reopen the frozen design.

**Minimum correction:** after this review is adjudicated and the owner authorizes the bounded documentation update, change that single plan example to `planExists: false` and add one short sentence that the R10 fallback is non-plan-backed because it deliberately carries no plan-derived facts. No production-code, API, schema, or design-spec change is required.

## Prior non-blocking findings

The original P6 review's two informational findings remain unchanged and were not remediated by this checkpoint:

- `provenance.models[].elementCount` still lacks a governing one-line semantic definition. No current consumer depends on it.
- The literal P6 acceptance grep for `run/` still matches a compliant comment in `clashtest/execution/LocalUnitExecutor.js`; there is no prohibited production import.

Neither is a blocker to the H1 remediation. Their final disposition belongs in the targeted adjudication/P6 acceptance decision.

## Verification reproduced

| Check | Result |
| --- | --- |
| `git diff --check 01e5341..771dc27` | clean |
| `node --test test/clashtest/run/lifecycle.test.mjs` | **49/49 pass** |
| `node --test 'test/clashtest/run/*.test.mjs'` | **119/119 pass** |
| `node --test 'test/clashtest/**/*.test.mjs'` | **1,085/1,085 pass** |
| `node scripts/run-tests.mjs` | **2,211 total / 2,210 pass / 0 fail / 1 known unrelated todo** |

The sole todo is the pre-existing `ContainmentQuery.classifyPoint` extreme-aspect-ratio gap. It is unrelated to `clashtest/` and unchanged by this checkpoint.

## Scope and repository state

`771dc27` changes four tracked files: the one-line production correction plus explanatory comment in `Run.js`, two lifecycle-test changes, the prior independent-review adjudication record, and the operational handoff. No unrelated production file changed in the checkpoint.

Three older untracked review artifacts were present before this review and were not modified:

- `docs/reviews/2026-09-22-federated-clash-test-core-p4-remediation-focused-rereview.md`
- `docs/reviews/2026-09-23-federated-clash-test-core-p5-rem11-focused-rereview.md`
- `docs/reviews/2026-09-24-federated-clash-test-core-p6-independent-review.md`

## Gate conclusion

**Focused H1 remediation review: PASS.** H1 is resolved at the reviewed checkpoint, with no Critical or High finding. M1 is a bounded, non-blocking phase-plan synchronization item.

**Next authorized action:** perform a targeted adjudication of this review only: verify the H1 closure, commit boundary, reproduced test counts, Medium plan-drift finding, and PASS verdict. Do not modify production code during adjudication.

**Must not begin:** P7 or later phases, Viewer/OQ-4 integration, remote persistence, annotation/derivation follow-up, calibration-dependent claims, M4 Phase 4, or reopening the frozen core design. P6 acceptance and any bounded plan correction wait for the targeted adjudication and applicable owner disposition.
