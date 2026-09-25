# Federated Clash Test core — P7 remediation focused independent re-review

**Date:** 2026-09-25  
**Repository:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`  
**Branch:** `feature/federated-clash-test-core-engine`  
**Checkpoint:** `62395b21c85ef2a1c0b63fdf678c018b392abfd6`  
**Remediation boundary:** `c598ad3..62395b2`

## Verdict

**PASS for the P7 remediation checkpoint.** The original H1, M1, M2, M3, L1 and L2 findings are resolved in the reviewed boundary. This focused re-review found **0 Critical / 0 High / 0 Medium / 1 Low**. The Low is a previously recorded compatibility limitation and does not reopen the six remediations.

This is an independent-review result, not P7 acceptance. Under `CLAUDE.md`, the next gate is targeted adjudication of this review. P8 remains unauthorized.

## Scope

Per the repository's review-convergence rule, this pass reviewed only:

- the six findings in `docs/reviews/2026-09-24-federated-clash-test-core-p7-independent-review.md`;
- the owner dispositions and claimed remediation in `docs/reviews/2026-09-25-federated-clash-test-core-p7-independent-review-adjudication.md`;
- the changed code, tests, spec errata A16/A17, phase-plan reconciliation and directly affected invariants in `c598ad3..62395b2`;
- the claimed focused and full-suite verification results.

It did not restart an unrestricted P7 or frozen-design review.

## Finding

### Low — cross-realm `AbortSignal` values are rejected

`clashtest/engine.js:182-214` validates with `v instanceof AbortSignal`. An `AbortSignal` created by another browser realm (for example, a same-origin iframe) fails that check and is rejected as `InvalidOptionsError`, although A17 and the public signatures say `AbortSignal` without a same-realm restriction.

This is an implementation-compatibility limitation, not a cancellation-correctness failure for the supported same-realm engine path. Minimum correction, if cross-realm callers are supported, is a bounded signal-brand/behavior check plus one cross-realm contract test. Do not change this without an owner ruling on whether cross-realm signals are supported.

## Adjudication of the six remediations

| Prior finding | Result | Evidence |
| --- | --- | --- |
| H1 — `recordRef` 512 producer/reader mismatch | **Resolved** | `STRING_CAPS.recordRef = 512` and `Acceptance.recordRef` uses the dedicated cap. Boundary and real-engine round-trip tests cover 512 acceptance, 513 rejection, raw reads and persisted read-through. |
| M1 — durable `libraryExclusions` stayed empty | **Resolved for the writer contract** | `resultParts` creates one ledger record and passes it to provenance; `provenanceOf` copies that ledger's exclusions. Normal, hierarchy-internal, tree-unreachable, combined, empty, pre-plan and R10 fallback paths are covered. The already-recorded optional read-time provenance↔ledger cross-check remains a separate hardening question. |
| M2 — size predicate had no valid read-time referent | **Resolved** | Owner-authorized A16 makes predicate (ii) a by-id `rerun` admission check against that rerun's resolved options. Resident and read-through bases are checked; raw bases and non-rerun reads are exempt. The implementation already matched this and the new tests pin all four cases. |
| M3 — public read cancellation had no implementation owner | **Resolved** | P5's coordinator removes aborted queued waiters without disturbing FIFO; P7 validates the closed options, checks before capture/store work, propagates cancellation through validation/freeze and freshness, holds slots through non-abortable store calls, and checks before rerun admission. Listing pre-abort ordering is corrected. |
| L1 — `discardRun` could corrupt finalizing persistence observables | **Resolved** | An owned sealed-but-not-terminal run shares one deferred discard that starts after `done`; dispose wins before the deferred discard starts. The V1–V10-style tests cover no-store, `persist:false`, pending/hung writes, event-listener reentrancy, duplicate discard and dispose. |
| L2 — traceability/documentation drift | **Resolved in the checkpoint artifacts** | The plan/spec/interface references, cap wording, root-count rows, A14 terminology, regression citations and acceptance record were reconciled. The canonical handoff still retained a superseded historical “still-open D-2…D-7” paragraph; this review's handoff update removes that operational contradiction without changing code, plan or spec. |

## Direct invariant checks

- The read coordinator remains one-shot and FIFO. A queued abort removes only its waiter; a granted slot is released only by its holder.
- Read abort never becomes a resolved `unverifiable` freshness result. `EnumerationCancelledError` is mapped to `ReadAbortedError`, and a final signal check covers a non-cooperating enumerator.
- A by-id rerun checks A16 only after the set has passed the normal untrusted-read validation and before admission; an aborted read starts no run.
- The sealed provenance and ledger receive the same exclusion source. The R10 fallback uses its fallback ledger, not the live broken ledger.
- Deferred discard does not block a synchronous event listener and does not delete or release after dispose wins the race.

## Verification

Independently run on `62395b2`:

- focused remediation plus directly affected P7 tests: **119/119 passed**;
- full `npm test`: **2,587 total / 2,586 passed / 0 failed / 1 todo**;
- the todo is the pre-existing `ContainmentQuery.classifyPoint` extreme-aspect-ratio gap;
- final repository check before persistence: branch `feature/federated-clash-test-core-engine`, HEAD `62395b21c85ef2a1c0b63fdf678c018b392abfd6`; no production/spec change was made by this review.

## Gate result

The consolidated P7 remediation checkpoint is ready for the repository's targeted adjudication step. P7 is not accepted by this review alone, and P8 must not begin.
