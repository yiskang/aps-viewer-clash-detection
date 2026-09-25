# Federated Clash Test core P5 remediation — focused independent re-review

**Date:** 2026-09-23  
**Repository:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`  
**Branch:** `feature/federated-clash-test-core-engine`  
**Reviewed commit:** `eb48d5cbb20df3da23b97a36e17ca9908510794a`  
**Remediation base:** `022a2f05e1065d626840a02514ada78ff8c2eed9`

## Verdict

**PASS — the committed P5-REM2/REM3 checkpoint resolves H1, H2, M1, M2 and the owner-authorized normalization follow-up within the authorized boundary.**

Finding counts: **0 Critical / 0 High / 0 Medium / 0 Low**.

This is a focused remediation review under `CLAUDE.md`, not a new unrestricted P5 review. The five unrelated concerns recorded by the implementer's review were not adjudicated here. This review is itself an independent-review claim and requires targeted adjudication before P5 acceptance. P6 remains unauthorized and must not start.

## Review boundary

This pass reviewed only commit `eb48d5c`'s changed areas and directly affected invariants:

- H1: embedded-definition identity and semantic-digest reconciliation.
- H2: the authorized eight-part pre-resolution representation check.
- M1: bidirectional coverage derivation.
- M2: P5 plan/traceability reconciliation.
- REM3 follow-up item 1: normalized-definition fixed-point enforcement.

The frozen design, accepted P0–P4 phases, the rest of P5, P6, and the five unrelated findings listed in the P5-REM3 task report were not reopened.

## Finding verification

### H1 — resolved

For a resolved set, `checkCrossField` now independently requires the embedded definition's `testId` and `revision` to match `testRef`, and recomputes the semantic digest with P2's existing `computeSemanticDigest`. A mismatch is rejected under `definition-identity-mismatch` or `semantic-digest-mismatch`.

Direct probes repeated the original review's mode and identity mutations. Both `validateResultSet` and the full `readResultSet` boundary now reject them with the expected codes. The fixtures changed by the commit now derive their recorded semantic digests from their actual definitions rather than weakening the validator.

### H2 — resolved within the owner-authorized boundary

When `definition === null`, validation now checks the authorized §13.1 conditions: null revision, `failed`/`cancelled` status, partial coverage, no plan, no units, exactly one planning gap, zero pair space, and zero results. The original nulled-but-completed probe is rejected at the read boundary with `pre-resolution-shape-invalid` on every inconsistent path.

The separately identified question about additional pre-resolution ledger fields remains explicitly owner-deferred. This commit does not claim to resolve it and the focused review does not reopen that disposition.

### M1 — resolved

The reader now compares recorded coverage to the derived boolean in both directions. A set whose facts derive full while recording partial is rejected with `coverage-not-full`. The direct inverse probe and committed regression both pass.

### M2 — resolved

The P5 plan now uses semantic deep equality rather than key-order-sensitive `JSON.stringify` for the canonical-JSON round trip. Its validation rule table records the remediation codes and the previously shipped validation additions. The change is bounded to the P5 plan; the frozen design is untouched.

### REM3 normalization follow-up — resolved

A resolved embedded definition must now be a fixed point of P2's existing `normalizeDefinition`, compared with canonical JSON so object-key insertion order is irrelevant. Self-consistent definitions containing duplicate dbIds or duplicate same-model selection entries are rejected as `definition-not-normalized`. Untampered fixtures remain valid and canonical.

The additional synchronous normalization/digest cost is accurately recorded under the existing G-CAL disposition. This review did not treat calibration as a correctness defect or authorize an interface change.

## Verification evidence

- Direct probes: H1 mode, H1 identity, H2 pre-resolution, M1 inverse coverage, and REM3 duplicate-selection identity all rejected with their intended issue codes by both validation and the trusted read boundary.
- `node --test test/clashtest/results/*.test.mjs` — **154/154 passed**.
- `node --test 'test/clashtest/**/*.test.mjs'` — **940/940 passed**.
- `node scripts/run-tests.mjs` final unrestricted rerun — **2,066 total / 2,065 passed / 0 failed / 1 todo**. The todo is the pre-existing documented extreme-aspect-ratio containment gap.
- Two preceding full-suite attempts each exposed one unrelated intermittent failure: the wall-clock telemetry threshold test, then the previously documented placement-invalidation test. Each passed immediately in isolation; the final full suite passed. No P5 or Clash Test test failed in any run.
- `git diff --check 022a2f0..eb48d5c` passed.
- Before this review artifact and handoff update, the worktree contained only the pre-existing untracked P4 focused re-review artifact.

## Remaining gates

- The synchronous definition digest/normalization span remains under G-CAL, as already owner-dispositioned.
- Additional pre-resolution ledger-field constraints remain an owner-deferred bounded carry-forward.
- The five unrelated concerns recorded in `.superpowers/sdd/p5-result-set/task-P5-REM3-report.md` remain outside this focused review and still require explicit owner disposition.
- This focused PASS requires targeted adjudication before it can close the remediation gate.

## Gate assessment

The P5-REM2/REM3 remediation is technically ready to clear its scoped gate: no Critical, High, Medium or Low finding remains in the reviewed changes or their directly affected invariants.

**Independent focused re-review verdict: P5 remediation PASS.**

**Next authorized action:** targeted adjudication of this focused re-review. Do not start P6.
