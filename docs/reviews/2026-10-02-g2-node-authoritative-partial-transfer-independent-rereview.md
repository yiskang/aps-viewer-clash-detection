# G2 Node-authoritative partial-result transfer — independent re-review

**Date:** 2026-10-02  
**Repository:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`  
**Branch / baseline:** `main` @ `c0f877aee82c078564efdb504bcbe695522b4ed4`; `main == origin/main`  
**Procedure SHA-256:** `59c27e186911074393323816532ddc5da3c35267e07408700844c5d4cc9d7b34` (verified; provisional, not owner-accepted)  
**Scope:** the uncommitted Node-authoritative partial-result transfer, its failed-run artifacts, the disclosed retained-evidence limitations, and the newly observed C13 phase ownership issue. No procedure or harness source was modified by this review.

## Verdict

**0 Critical / 1 High / 1 Medium / 6 Low.**

The original completed-history High is closed. A completed phase is merged before its clear fence, synchronously retained by Node through the existing page-ordinal-to-Node-seq authority, and recovered from that Node-owned snapshot if both the later attribution fence and cleanup-entry transfer refuse. The focused mutation tests show that the previous implementation and a Node path that ignores the snapshot both lose the history, while the corrected implementation preserves it.

The current procedure/harness set is not ready for owner acceptance, checkpoint closeout, or live planning. C13 is executed in P8 because it consumes C15 outcomes, but both the procedure and the Node attribution validator still own C13 in P7. A real P8 `beginCheck('C13')` therefore fails closed at the Node sync fence on every otherwise-reaching live run.

## Findings

### Critical

None.

### High H1 — C13 has an impossible live phase assignment

**Evidence**

- Procedure §5 assigns C13 to P7 (`P7 isolation (C9–C13, N4, N5)`) and §9.2's active-check ownership rule also maps C13 to P7.
- The harness mirrors that ownership in `CHECK_OWNING_PHASES.C13 = ['P7']` and the static `PHASE_ORDER` P7 list.
- The executable planner deliberately defers C13 to P8 (`DEFERRED_UNITS.C13 = 'P8'`) because C13 consumes C15(b), C15(c), and C15(e) outcomes that are generated in P8. The P8 live driver then calls `beginCheck('C13')`.
- A direct call through the real Node authority for `{phase:'P8', activeCheck:'C13'}` returns `{ok:false, reason:'sync-activeCheck-phase-inconsistent'}`. The page-side `beginCheck` awaits that fence, so C13 cannot execute and the phase becomes a harness exception/taint rather than a valid C13 result.

**Impact:** deterministic live-run failure before G2 can satisfy C13. This is not an SVF2, ViewerBridge, production, Core, Adapter, OQ-1, or host dependency; it is a procedure/harness phase-metadata contradiction.

**Minimum correction:** make one phase authoritative for C13. Because the C13 oracle requires P8's C15 outcomes, the bounded correction is to assign C13 to P8 consistently in procedure §5, §9.2 ownership text, `PHASE_ORDER`/ownership metadata, dependency/static guards, and targeted tests; remove the deferred phase contradiction. This changes the procedure bytes and requires a new SHA and independent re-review.

**Gate:** blocks procedure-SHA acceptance, final checkpoint closeout, live planning, activation, authorization-record issuance, and live execution.

### Medium M1 — Node-retained page evidence is not completeness-checked on the transport fallback

`retainPageSnapshot` validates the snapshot container, ingests pending ordinals, verifies the high-water, and rejects unmapped ordinals. On the non-transferred failure branch it copies the retained `eventLog`, `spyLedger`, and `stateSnapshots` into R1. However, `authority.pageEvidenceProblems(state)` is called only when `cleanupEvidence.runApplied === true`; that flag remains false on the transport fallback. A malformed-but-remappable retained snapshot could therefore omit an ingested event/spy/snapshot while still producing a schema-valid terminal FAIL chain.

This cannot create PASS, PARTIAL, or BLOCKED: `phaseRunFailure` forces FAIL, R1/R2/R3/K remain mutually hashed, and the reader reconstructs FAIL. It can weaken the independent auditability of the already-failed run and is inconsistent with the procedure's claim that Node validates retained page evidence as of the last accepted retain fence.

**Disposition:** required before live execution, preferably in the same bounded C13 follow-up. It is not by itself a checkpoint or live-planning blocker, but it must add a retained-snapshot completeness check (or an equivalent explicit partial-evidence validity rule) without inventing later, unacknowledged evidence.

### Low

1. **Baseline snapshot timing.** The phase baseline is recorded after that phase's retain. If the next fence fails before another retain, the last Node snapshot omits a baseline that may have run. The retained artifact truthfully claims only the last accepted retain boundary, so verdict/provenance remain sound; diagnostic chronology is reduced.
2. **Driver-catch/fatal-skip retention.** Those early returns can bypass a same-phase retain. A later untransferred failure can replace their specific blocked reasons with the generic phase-run failure reason. No completed PASS/control record is fabricated or erased.
3. **P1/finalize ordering.** P1 retain precedes C1 finalization and the authoritative gate. A failure before the first post-gate retain can be `post-c1-untransferred`. This is conservative and truthful, but less informative.
4. **Cumulative retain payload.** The full bounded snapshot is resent after each phase. It is bounded by the attempt deadline and evidence limits; this is a performance cost, not an ordering defect.
5. **Transport-phase fidelity.** A failure only in final transfer can retain `phase:'cleanup'`; this pre-existing representation is fail-safe and does not change the verdict.
6. **Late authority activity.** The retain authority is not separately sealed after the decision. A late retain can add a violation entry but cannot modify the already-cut R1/K result. This is non-blocking hardening.

## Node-authoritative transfer verification

The corrected path satisfies the requested properties:

- Driver results are validated and merged into the runner maps before `sync.retain()` and before the clear fence.
- `g2RetainSnapshot` captures partial history and evidence in the same synchronous tick as the retain report; `retainPageSnapshot` ingests through the existing allocator and remaps every page ordinal to the authoritative Node seq namespace.
- Node deep-copies the latest accepted retained snapshot. The non-transferred failure branch uses it only for `node-phase-run-transport`; a successful page failure transfer wins instead, preventing duplicate history.
- Completed records remain terminal, not-started items are synthesized only as blocked/not-started, and `failureSeq` is allocated after retained history. R1/R2/R3/K validate and the reader derives FAIL.
- The exact blocked path is covered: C2/C3/N1 complete, attribution-clear refuses, cleanup-entry refuses, and the completed records remain present in failed-run R1. Mutating away either retain side reproduces the previous loss and fails the truthfulness assertions.

## Retained evidence and baseline disposition

The retained check/control history is authoritative enough for verdict and reader reconstruction. The missing completeness pass over the retained evidence arrays is narrower: it can omit diagnostic support for a record but cannot alter the failed-run outcome. Treat it as before-live-execution hardening, not as a reason to reject the Node-transfer mechanism.

The post-retain baseline timing does not falsify chronology because the procedure defines the non-transferred evidence boundary as the last accepted retain fence and claims nothing later. It remains a Low diagnostic limitation. If the follow-up moves baseline before retain, it must preserve the rule that a completed result is retained before any fence capable of refusing it.

## Artifact and reader validity

For the exercised transfer/refusal cases:

- R1 is schema-valid and retains completed history.
- R2 represents the failed run.
- R3 hashes the retained R1/R2 bytes.
- K commits terminal FAIL and the reader reconstructs FAIL.
- The PASS path remains unchanged in the dedicated comparison test.

No duplicate history was observed; later work is blocked/not-started rather than fabricated. `failureSeq` remains after the retained completed records in the single Node seq namespace.

## Verification

- Focused G2: **797/797 pass**.
- Canonical `npm run test:offline`: **5,043 total / 5,042 pass / 0 fail / 1 existing todo**.
- Real Playwright binding: **8/8 pass**.
- `git diff --check`: clean.
- Direct C13 authority probe: P8 + C13 is refused with `sync-activeCheck-phase-inconsistent`.
- Branch/remote: `main == origin/main == c0f877aee82c078564efdb504bcbe695522b4ed4`.
- `G2_DUAL_COUNTER_GATE.resolved=true`; `LIVE_PATH_WIRED=false`.
- No G2 result/attempt artifact or authorization record exists; no live G2 was run.

The aggregate suite was invoked once with an extra reporter argument and once as the exact canonical command. Both completed with the same **5,042 pass / 0 fail / 1 todo** result; the todo's assertion stack is expected Node test-runner output and is not a failure.

## Readiness and authorization

- **Original partial-history High:** closed.
- **Procedure SHA `59c27e…d7b34`:** byte-verified but **not ready for owner acceptance**; the C13 correction will change the procedure and require a new digest.
- **Checkpoint commit:** not ready as a final accepted checkpoint. An intermediate preservation commit would require explicit owner authorization and would still carry H1; none is authorized.
- **Live planning:** not ready. Planning/authorization must bind a procedure whose C13 phase is executable.
- **Before live execution:** close H1, add retained-evidence completeness validation, independently re-review, commit to a clean tree, recompute/accept the procedure and harness digests, and keep `LIVE_PATH_WIRED=false` until a separate live authorization.

## Exact next action

Obtain explicit owner authorization for one bounded procedure/harness/test correction that makes C13 a P8-owned check everywhere and closes retained-snapshot evidence completeness, followed by independent re-review. Commit, push, live activation, authorization-record issuance, and live G2 remain unauthorized.
