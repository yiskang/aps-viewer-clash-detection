# Federated Clash Test core — P6 independent implementation review

- **Date:** 2026-09-24
- **Branch:** `feature/federated-clash-test-core-engine`
- **Reviewed checkpoint:** `01e5341ac0b14b4bb6c45b398d42d575a1bc37f0` (`docs(clashtest): P6 closeout — handoff update and whole-branch review record`)
- **Implementation range:** `50bfcb5..8a8e6cc` (P6.1–P6.8 plus the internal whole-branch fix wave); `01e5341` adds only the P6 closeout documentation.
- **Scope:** the complete P6 run-lifecycle implementation and tests, checked against the frozen design, the accepted P0–P5 interfaces, and the P6 verification/acceptance list. P0–P5 and the frozen core design were not reopened.

## Verdict

**P6 is not ready for acceptance.** This review found **0 Critical, 1 High, 1 Medium, and 1 Low** finding.

The lifecycle, cancellation, deterministic settlement, scope-consequence, freshness, progress, and normal sealing paths are strongly implemented and their suites pass. One producer/read-back contradiction remains blocking: after a plan exists, the R10 sealing-failure path can return, admit, and persist a sealed Result Set that the repository's own `validateResultSet` rejects.

This artifact is an independent Work review claim under `CLAUDE.md`. It requires targeted adjudication before remediation or phase acceptance. P7 must not start.

## High finding

### H1 — post-plan R10 fallback sets are durably corrupt by the current schema

**Code:** `clashtest/run/Run.js`, `terminalInternalError` and `emptyLedgerRecord`, lines 1200–1242 and 1293–1298 at the reviewed checkpoint. **Committed reproducer:** `test/clashtest/run/lifecycle.test.mjs`, lines 485–518.

**Contract:** frozen design §13.4 requires every sealed Result Set to round-trip through structured clone and JSON with semantic equality; §13.6 requires engine-produced data to satisfy the same cross-field invariants enforced on read. P6's goal is to turn a plan into a sealed Result Set, and P6 verification row V12 requires a build/seal/admission failure to settle once as a failed internal-error Result Set.

**Failure mode:** once `run.plan` exists, the R10 fallback constructs:

```text
planExists: true
rootOwners: []
planningGaps: [{ phase, cause: 'internal-error' }]
```

while retaining the resolved definition and its model selections. P5's cross-field validator therefore reports one `coverage-model-mismatch` per selected model. The committed test explicitly expects those two issues instead of requiring an empty issue list.

This is already an observable P6 failure, not only a future P7 read-through concern. `done` returns the invalid object; the fallback admits it to residency; and, when persistence is enabled, `persistAndFinalize` writes it through the configured store. A later read correctly rejects the engine's own durable output as corrupt. The object is non-claimable, so this is not a false-clean path, but it breaks the durable Result Set and producer/reader contracts at the phase that creates the artifact.

**Classification:** implementation-compatibility issue and verification gap.

**Minimum correction:** make the minimal fallback ledger internally consistent without reusing the records that caused sealing to fail. The smallest candidate is to represent the fallback as having no usable plan (`planExists: false`, empty pair space/root owners, one internal-error planning gap), provided the full validator confirms that shape. Add real-planner tests for one-shot `buildResultSet`, `sealResultSet`, and `admitSealedSet` failures; every non-null fallback must return zero validation issues and survive the P5 read/round-trip path. Preserve the existing exactly-once `done`, failed/non-claimable outcome, slot accounting, and persistence-window behavior.

## Medium finding

### M1 — `provenance.models[].elementCount` has a shipped value but no governing semantic definition

**Code:** `clashtest/run/Run.js`, `planProvenanceOf`, lines 1014–1048. **Contract locations:** frozen design §13.2/Result Set typedef names the field; P5 pins only `int >= 0` in its schema.

P6 defines `elementCount` as the sum of `ownerDbIds.length` across a model's planned `rootOwners`. That is deterministic and currently harmless: the field is not part of either durable digest, freshness, claim assessment, status derivation, or result-store identity. But it is durable public provenance, and the repository does not state whether it means selected roots, distinct fragment owners, reachable elements, or whole-model population. A later consumer can therefore assign a different meaning to already-written data.

**Minimum correction:** record the implementation's exact meaning in the governing P6/P5 contract before any consumer relies on the field. This does not require changing the frozen architecture or blocking the H1 remediation.

## Low finding

### L1 — one acceptance command is phrased as a literal zero-hit scan but matches a compliant comment

The P6 acceptance checklist says `grep -Rn "run/" clashtest/execution/` must be empty. It currently matches only `clashtest/execution/LocalUnitExecutor.js:14`, a comment saying the module imports from `planning/`, never `run/`. Production imports satisfy the dependency rule; the literal command does not satisfy its stated zero-hit result.

**Minimum correction:** make the acceptance check import-aware, or exclude comments. No production change is needed.

## Confirmed sound areas

- The world-scoped coordinator provides one shared registry, one in-flight slot, FIFO execution, per-engine admission stopping, and non-wedging failure behavior.
- Settlement is deterministic across fact order; complete observed causes reach run reasons while unit secondary causes remain bounded.
- Cancellation and disposal preserve the cooperative boundary model, drain in-flight units, keep terminal publication ordered, and settle `done` exactly once on the covered paths.
- Normal resolved seals now carry complete provenance and validate with zero issues; the out-of-vocabulary non-evaluated outcome case fails closed instead of producing a clean claim.
- Scope drift, reload/death, placement movement, retry exhaustion, read-time freshness, result-cap refusal, split accounting, and progress monotonicity are covered without Viewer or collision-internal dependencies.

## Verification evidence

- `git diff --check 50bfcb5..HEAD` — clean.
- `node --test test/clashtest/run/*.test.mjs` — **118/118 passed**.
- `node --test 'test/clashtest/**/*.test.mjs'` — **1,084/1,084 passed**.
- `node scripts/run-tests.mjs` with local ephemeral-port access — **2,210 total / 2,209 passed / 0 failed / 1 todo**. The todo is the pre-existing documented extreme-aspect-ratio containment gap.
- Layering scan found no production import from `clashtest/run/**` to Viewer, Three.js, or collision internals, and no execution-module import of `run/**`; L1 is comment-only.
- The working tree before this review contained only two pre-existing untracked review artifacts: the P4 focused re-review and the P5-REM11 focused re-review.

## Gate result

`P6 requires targeted adjudication and remediation before acceptance.`

Blocking finding: **H1**. Do not start P7.
