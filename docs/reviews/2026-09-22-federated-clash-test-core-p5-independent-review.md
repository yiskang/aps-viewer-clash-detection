# Federated Clash Test core — P5 independent implementation review

- **Date:** 2026-09-22
- **Branch:** `feature/federated-clash-test-core-engine`
- **Reviewed checkpoint:** `022a2f05e1065d626840a02514ada78ff8c2eed9` (`fix(clashtest): P5-REM — owner-authorized remediation of Items 1 & 2`)
- **Accepted phase base:** `2762906bb5bd8f90eecb72bbb8d334bd5fc20178` (P4 remediation, subsequently accepted)
- **Scope:** the complete P5 Result Set implementation and tests through the owner-authorized P5-REM checkpoint, checked against the frozen design's durable Result Set and claim contracts and the P5 plan. P0–P4 and the frozen design were not reopened.

## Verdict

**P5 is not ready for acceptance.** This review found **0 Critical, 2 High, 2 Medium, and 0 Low** findings.

Both High findings are at the untrusted Result Set read boundary. They permit internally contradictory data to pass `validateResultSet`, and the contradictory sets can satisfy `canClaimNoClashes(..., 'current')`. The P5-REM corrections at `022a2f0` are themselves sound, but they do not cover these adjacent identity and pre-resolution invariants.

This artifact is an independent review claim under `CLAUDE.md`. It requires targeted adjudication before remediation or P5 acceptance. P6 must not start.

## High findings

### H1 — the embedded definition is not linked to `testRef` identity or `semanticDigest`

**Code:** `clashtest/results/validateResultSet.js`, `checkCrossField`, lines 219–227 at the reviewed checkpoint.

**Contract:** frozen design §5.4 defines `semanticDigest` as the digest of the normalized semantic definition; §5.4 and §13.1 require a Result Set to reference `(testId, revision, semanticDigest)` and embed the full definition so it is self-describing; §13.6 requires cross-field self-consistency on untrusted reads.

**Failure mode:** the validator checks only null parity between `definition` and `testRef.semanticDigest`. It does not require:

- `definition.testId === testRef.testId`;
- `definition.revision === testRef.revision`; or
- `computeSemanticDigest(definition) === testRef.semanticDigest` for a resolved definition.

Direct probes against a sealed `completed-clean` fixture changed `definition.mode` to `containment`, and separately changed `definition.testId`/`revision` to `OTHER`/`99`, while leaving `testRef` unchanged. Both returned `{ok:true, issues:[]}` and both allowed an unqualified no-clash claim. Changing a selection or clearance has the same missing linkage. The Result Set can therefore describe one clash question while its durable identity and `ResultId` namespace describe another.

This is an **implementation-compatibility issue and verification gap**. It does not require reopening the frozen architecture; it enforces the existing self-describing identity contract.

**Minimum correction:** at read validation, require the embedded definition's `testId` and `revision` to equal `testRef`, require its normalized/canonical semantic digest to equal `testRef.semanticDigest`, and add negative read/claim tests for changes to identity, mode, clearance and either selection. The digest work belongs in the existing sliceable read pipeline.

### H2 — the unique pre-resolution representation is not enforced

**Code:** `clashtest/results/validateResultSet.js`, `checkCrossField`, lines 219–284; `clashtest/results/claim.js`, lines 39–64.

**Contract:** frozen design §13.1 defines exactly one pre-resolution shape: `definition:null`; `testRef.revision:null`; `testRef.semanticDigest:null`; terminal status `failed` or `cancelled`; `coverage:'partial'`; one planning gap; no unit ledger; zero results; and the corresponding zero pair space. AC-7 relies on that representation.

**Failure mode:** starting from a valid clean completed set, setting only `definition = null`, `testRef.revision = null`, and `testRef.semanticDigest = null` passes validation while retaining `status:'completed'`, `coverage:'full'`, a positive pair space, and an evaluated unit. With no results, `canClaimNoClashes(set, 'current')` returns `true`. The set has no resolved question but is accepted as proof that the absent question has no clashes.

This is an **implementation-compatibility issue and verification gap**. It is enforcement of an explicit frozen-design invariant, not a design change.

**Minimum correction:** when `definition`/`semanticDigest` are null, validate the complete §13.1 pre-resolution shape, including null revision, allowed terminal statuses, partial coverage, absent plan/unit ledger, required planning gap, zero pair space and zero results. Add corrupt-read tests for each forbidden residual field and a claim-blocking regression test.

## Medium findings

### M1 — coverage derivation is checked only in the unsafe direction

**Code:** `clashtest/results/validateResultSet.js`, lines 229–234.

`deriveRunOutcome` deterministically derives either `full` or `partial`, but the reader rejects only recorded `full` when the facts derive `partial`. A completed-clean set changed to `coverage:'partial'` validates successfully even though its plan and every leaf derive `full`.

This direction is fail-safe for no-clash claims, so it is not a High blocker by itself. It still violates writer/reader self-consistency and the owner-authorized P5-REM intent that governing outcome axes be re-derived. The minimum correction is exact equality with the derived coverage value, plus the inverse corruption test.

### M2 — the governing P5 plan no longer fully records the shipped contract

**Plan:** `docs/superpowers/plans/federated-clash-test-core/p5-result-set.md`, including Task P5.9 line 3556 and the validation rule/traceability tables around lines 1468–1485 and 3640–3660.

The plan still specifies a `JSON.stringify` equality assertion that fails solely because the canonical-JSON store reorders object keys; the shipped test correctly uses deep equality. It also does not record the post-plan validator rules/codes now implemented for duplicate owners, derived integrity/environment sensitivity, and canonical pair orientation, nor the `already-started` residency error. H1/H2 are also absent from its validation rule table.

This is a **documentation and traceability gap**, not a reason to undo the shipped corrections. After technical adjudication, reconcile the plan in one bounded errata pass so its executable acceptance text and issue-code matrix describe the implementation that is actually being accepted.

## Confirmed sound areas

- The owner-authorized P5-REM checks at `022a2f0` correctly re-derive integrity and environment sensitivity and reject non-canonical stored pair orientation.
- Structural capture is detached, getter-safe, bounded, migration-aware, and performed before semantic traversal; malformed shapes fail without escaping raw exceptions.
- Pair/result linkage, owner attribution, canonical result order, pair-set digest and ledger digest checks are implemented and covered by corruption tests.
- Result assembly/sealing, status lookup, in-memory persistence, residency accounting, one-shot leases and persistence-attempt state transitions are strongly covered by the focused P5 suite.
- No P5 production module imports Viewer code, Three.js, collision internals beyond the authorized public boundary, or unimplemented P6 lifecycle code.

## Verification evidence

- `node --test test/clashtest/results/*.test.mjs` — **152/152 passed**.
- `node --test 'test/clashtest/**/*.test.mjs'` — **938/938 passed**.
- `node scripts/run-tests.mjs` with local ephemeral-port access — **2,064 total / 2,063 passed / 0 failed / 1 todo**. The todo is the pre-existing documented extreme-aspect-ratio containment gap.
- A restricted first full-suite run produced three M4 spike-server `listen EPERM` failures; the unrestricted rerun passed them, confirming they were sandbox-only.
- Direct probes reproduced H1, H2 and M1 with `validateResultSet` returning `{ok:true, issues:[]}`. H1 and H2 also returned `true` from `canClaimNoClashes(..., 'current')`.
- The worktree before this review contained only the pre-existing untracked P4 focused re-review artifact. No production, test, spec or plan file was modified by this review.

## Gate result

`P5 requires targeted adjudication and remediation before acceptance.`

Blocking findings: **H1 and H2**. Do not start P6.
