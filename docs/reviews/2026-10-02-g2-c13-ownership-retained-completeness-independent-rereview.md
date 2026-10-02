# G2 C13 ownership and retained-snapshot completeness — independent re-review

**Date:** 2026-10-02  
**Repository:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`  
**Branch / baseline:** `main` @ `c0f877aee82c078564efdb504bcbe695522b4ed4`; `main == origin/main`  
**Procedure SHA-256:** `d1ccfde224b8ae76fe74b06c93abc532e6df9612933cafaa045053c8e2e45a75` (byte-verified; provisional, not yet owner-accepted)  
**Scope:** the uncommitted C13 ownership correction, retained-snapshot completeness admission, their directly affected procedure text/tests, and the disclosed audit limitations. The procedure and harness were not modified by this review.

## Verdict

**0 Critical / 0 High / 0 Medium / 4 Low.**

The prior live-blocking C13 phase contradiction is closed. C13 is P8-owned consistently in executable phase metadata, Node attribution enforcement, procedure §5, and procedure §9.2. The real Node authority accepts `beginCheck('C13')` in P8 and rejects it in every other phase; no unrelated check ownership changed.

The prior retained-evidence completeness Medium is also closed for the evidence classes promised by the corrected procedure. A Node-retained fallback is admitted only after the same `pageEvidenceProblems` implementation checks the accepted retained prefix. The scope is fixed to the accepted retain high-water; later ordinals are excluded rather than falsely required. A problem adds a fatal while retaining the original phase failure and validated completed history, so PASS remains impossible. The normal transferred path is unchanged.

The procedure now truthfully states the validator's pre-existing boundary: it does not independently source non-cleanup `eventLog` records. That limitation and three related audit/diagnostic gaps are Low because none can convert the already-failed transport path into PASS, erase the authoritative root failure, or alter reader reconstruction of FAIL.

## Findings

### Critical

None.

### High

None.

### Medium

None.

### Low

#### L1 — non-cleanup `eventLog` has no reverse source check

`pageEvidenceProblems` performs forward completeness for every ingested event ordinal, but its reverse source/identity checks cover `spyLedger`, `stateSnapshots`, and cleanup events. A non-cleanup Node-style `eventLog` record that is not one of those mandatory ingested events is not independently rejected by this validator. The procedure now discloses this exact boundary instead of promising universal event sourcing.

This is an evidence-audit limitation shared by the retained and normal transferred paths. On the retained transport fallback, `phaseRunFailure` already forces FAIL; an extra diagnostic event cannot grant PASS or change the reader's terminal result. No further correction is required before checkpoint or live planning. Strengthening all non-cleanup event provenance may remain optional hardening if the owner later requires hostile-source auditability beyond the accepted trust model.

#### L2 — retained-scope lower bound lacks a direct unit assertion

The implementation rejects malformed scopes at or below `PAGE_LOCAL_BASE` and selects every ingested ordinal `<= throughOrdinal`; accepted retain ingestion is contiguous and the end-to-end missing-record mutation exercises the practical lower-bound behavior. The focused tests directly pin the upper bound and out-of-scope later ordinals, but do not include a dedicated `PAGE_LOCAL_BASE + 1` lower-edge assertion.

This is test precision only. The implemented predicate has no lower-bound omission and fails closed for an invalid scope.

#### L3 — closeout collision can collapse the specific retained diagnostic

If retained-evidence tampering also makes R1 fail its closeout verification, no authoritative K is produced and the failure witness retains the original phase-run failure plus the `r1-verify` closeout cause. It may not preserve the more specific in-memory `retained-evidence:*` label in F.

The reader still reconstructs FAIL, the root failure survives, and no invalid artifact becomes authoritative. This is diagnostic degradation, not an evidence-contract or verdict defect.

#### L4 — non-cleanup attribution is not correlated back to the source ordinal

Outside cleanup provenance, the validator checks kind/seq sourcing for spies and snapshots but does not compare every record's `phase`/`activeCheck`/`activeControl` fields with the corresponding ingested ordinal. Swapping same-kind authoritative seqs can therefore reduce attribution audit fidelity where independent schema rules do not otherwise reject the combination.

The issue is pre-existing on both transfer paths and cannot produce PASS on a failed fallback. It is optional audit hardening, not a checkpoint or live-planning blocker.

## C13 ownership verification

- `CHECK_OWNING_PHASES.C13` is exactly `['P8']`.
- `PHASE_ORDER` has C9–C12 in P7 and C14, C15, C13 in P8; C13 runs after the C15 outcomes it consumes.
- Procedure §5 and §9.2 both assign C13 to P8.
- The real `syncPage` authority accepts P8/C13 and refuses P7/C13 and every other phase/C13 combination.
- The full ownership-map snapshot confirms no unrelated check ownership changed.
- Source mutations that restore P7 ownership, restore P7 phase placement, or reintroduce stale procedure wording fail the targeted assertions.

**Disposition:** the prior C13 High is fully closed.

## Retained-snapshot completeness verification

- An accepted retain records `retainedThroughOrd` only after pending ordinals are ingested, the page high-water matches, and every retained ordinal is remapped through the single Node allocator.
- The fallback calls the same `authority.pageEvidenceProblems` implementation as the normal path, with only the retained high-water scope added.
- Within that scope, missing/duplicate mandatory events, unsourced spies, snapshot provenance mismatch, leaked page ordinals, and cleanup-provenance violations fail closed.
- Out-of-scope later ordinals are legitimately absent; removing the scope produces the expected conservative missing-evidence failure.
- A completeness problem records one `retained-evidence:*` fatal without replacing the original `phaseRunFailure` or erasing retained C2/C3/N1 history.
- A successful page failure transfer still wins over the retained copy, avoiding duplicate history; normal PASS behavior is unchanged.
- Mutation tests that bypass the completeness call admit the defects silently and fail the review assertions, so the tests are non-vacuous.

**Disposition:** the prior retained-completeness Medium is fully closed within the procedure's stated evidence classes. The retained scope changes which ingested ordinals are applicable, not the semantics applied to those ordinals. The lack of a dedicated lower-edge unit test is Low.

## Procedure truthfulness and SHA

The corrected retained-evidence clause exactly describes what the implementation checks and explicitly records the non-cleanup-event limitation. It does not use wording to conceal a verdict-integrity defect: the limitation concerns reverse sourcing of diagnostic events on a path already locked to FAIL.

The current procedure bytes hash to:

`d1ccfde224b8ae76fe74b06c93abc532e6df9612933cafaa045053c8e2e45a75`

This provisional SHA is technically ready for owner acceptance. All earlier provisional procedure SHAs are stale. A future live authorization must bind final committed, clean-tree bytes and cannot reuse an earlier digest.

## Verification

- Focused G2: **818/818 pass**.
- Canonical `npm run test:offline`: **5,064 total / 5,063 pass / 0 fail / 1 existing todo**.
- Real Playwright binding: **8/8 pass**.
- `git diff --check`: clean.
- Branch/remote: `main == origin/main == c0f877aee82c078564efdb504bcbe695522b4ed4`.
- `G2_DUAL_COUNTER_GATE.resolved=true`; `LIVE_PATH_WIRED=false`.
- No live G2 result/evidence or authorization record exists.

The first focused invocation was sandbox-blocked only where mutation tests attempted repository-local temporary files; the approved rerun completed 818/818. No live path was reachable or executed.

## Readiness and authorization

- **C13 blocker:** fully closed.
- **Retained completeness:** fully closed for the accepted contract; four Low audit/diagnostic limitations remain non-blocking.
- **Procedure:** ready for owner acceptance at provisional SHA `d1ccfde…e45a75`.
- **Checkpoint:** the current procedure/harness/test/review set is technically ready for an owner-authorized commit after this review and handoff update are included; no commit is authorized by this review.
- **Live planning:** technically ready only after owner acceptance and a committed clean-tree checkpoint establishes final binding inputs. It is not currently authorized.
- **Before live execution:** recompute and record final procedure/harness digests from the committed clean tree, obtain a separate explicit authorization record, and separately authorize activation. `LIVE_PATH_WIRED` remains false.

## Exact next action

The milestone owner should accept or reject procedure SHA `d1ccfde224b8ae76fe74b06c93abc532e6df9612933cafaa045053c8e2e45a75` and, if accepted, explicitly authorize the checkpoint commit. Until then, no further repository action, live planning, activation, authorization-record issuance, or live G2 execution is authorized.
