# Independent Re-review — G2 Cleanup Event Provenance

**Date:** 2026-10-02  
**Repository state reviewed:** `main == origin/main == b33b7a94eaaefd4b3c7f097a4c743a5bb5abf80a`; working tree dirty with the uncommitted harness/test remediation and documentation records.  
**Governing procedure:** `docs/research/2026-09-30-g2-viewerbridge-dockingpanel-live-verification-procedure.md`, SHA-256 `5f9c4c7e124751d09406f07eab63f844fec53add006bd12ad676ecaca3732abb` (unchanged).  
**Gate state:** `G2_DUAL_COUNTER_GATE.resolved=false`; `LIVE_PATH_WIRED=false`; no G2 live attempt/evidence and no production/Core/Adapter/M4/Panel/OQ-1/host change.

## Verdict

**0 Critical / 0 High / 4 Medium / 7 Low.**

The original cleanup-event provenance gap is closed: the implementation now binds each ingested page ordinal to its Node-assigned authoritative `seq`, source ordinal, realm, record kind, event label, attribution, and transfer stage. It proves source-to-state and state-to-source completeness for cleanup events and fails closed for missing, duplicated, unsourced, wrongly attributed, substituted, leaked, repeated-drain, and duplicate-merge evidence.

One Medium live-readiness defect remains. A genuine event recorded after the runner has entered the normative `cleanup` phase but before `g2RunPhases()` returns is carried in the run transfer. The current stage rule rejects it solely because it did not arrive in the later cleanup-drain transfer. Transfer stage is not the semantic phase. This creates a realizable false `FAIL` during the single-attempt live gate and keeps H1, the dual-counter gate flip, checkpoint closeout, and live planning open.

## Cleanup provenance model

`createRunAuthority()` retains one row per ingested page ordinal as `{seq, ord, realm:'page', kind, label, phase, activeCheck, activeControl}`; `provenance()` adds the derived transfer `stage`. `seq` is allocated only by the Node `createRunSeqAllocator()`. Page ordinals remain non-authoritative and are rewritten before reaching authoritative state.

The transfer boundaries are mechanically fixed by the two explicit callers:

- `rewritePageRun(runOut.value, {stage:'run'})` fixes the phase-result high-water.
- `rewritePageRun(cleanupDelta, {stage:'cleanup'})` fixes `(runBoundary, cleanupHighwater]`; a second cleanup rewrite records `cleanup-drain-repeated`.

The event identity label is registered by `createCallRecorder.logEvent(kind)` at ordinal allocation and survives ingestion. Real recorder-created events are therefore label-bound; the unlabeled-source exemption exists only for direct/custom source use and is not the real recorder path.

## Bidirectional completeness

The following required cases are detected:

| Defect | Mechanical result |
|---|---|
| Ingested cleanup event absent from authoritative state | `page-evidence-missing:event:<seq>` and `cleanup-event-missing:<seq>` |
| Authoritative cleanup event has no ingested page-event source | `cleanup-event-unsourced:<seq>` |
| Duplicate authoritative event / duplicate merge | `page-evidence-duplicate` or `cleanup-event-duplicate`; merge returns `duplicates > 0` and closeout records fatal `cleanup-evidence:merge-duplicate:<n>` |
| Source outside the accepted transfer range | `cleanup-event-outside-drain:<seq>` |
| Source/event attribution is not cleanup | `cleanup-event-phase-mismatch:<seq>` |
| Event kind differs from the page-registered label | `cleanup-event-identity-mismatch:<seq>` |
| Page-local ordinal leaks into authoritative state | `cleanup-event-leaked-ordinal:<ord>` plus the existing ordinal-leak checks |
| Cleanup transfer repeated | `cleanup-drain-repeated` authority violation |

The mutation tests are non-vacuous: they remove the provenance block or identity check from a dynamically loaded harness copy and demonstrate that the same corrupted worlds pass the pre-fix logic but fail the real logic. Full-`main()` tests independently corrupt the cleanup delta and exercise the fatal closeout path. They do not merely restate the implementation predicates.

**Disposition:** the original cleanup-evidence High is fully closed.

## Medium findings

### M1 — cleanup phase is incorrectly constrained to cleanup-drain transfer stage

`runChecksInPhaseOrder()` performs `await mark('cleanup')` before it returns. `mark()` first changes recorder attribution to `phase:'cleanup'`, allocates the marker, and then awaits the Node attribution fence. `g2RunPhases()` subsequently awaits another final drain before taking `g.runResultHw` and returning the run result. A page callback can therefore legally record an event with `phase:'cleanup'` in either await window. That event is completely ingested, label-bound, and present exactly once in the run result, but `stageOfOrdinal()` classifies it as `run` because the transfer high-water includes it. `pageEvidenceProblems()` then reports `cleanup-event-outside-drain` solely from the transfer stage.

The accepted procedure defines the semantic order `P11 → cleanup → closeout`, permits passive cleanup records, and uses `phase` for attribution. It does not define “cleanup” as “only bytes delivered by the later cleanup-drain RPC.” The implementation's own test constructs this exact legal event and calls it a conservative false `FAIL`. The false `FAIL` cannot create a false PASS, but it can consume the future exactly-one live attempt without testing G2.

**Disposition:** a cleanup-phase event may legally originate from the run transfer when its source ordinal is ingested exactly once, its source and event both have `phase:'cleanup'`, its identity label matches, and it lies after the authoritative cleanup marker/fence. The minimum correction belongs in the **harness and tests**, not the procedure: provenance should distinguish semantic phase from transport stage and accept this narrow, ordered run-transfer case while continuing to reject pre-cleanup run events relabelled as cleanup. Required before the dual-counter gate flip, checkpoint closeout, or live planning.

### M2 — failed/timed-out phase runs do not retain cleanup evidence

`drainCleanup()` returns when `cleanupEvidence.runApplied` is false. Cleanup still executes after a thrown or timed-out phase run, but its page-origin records are omitted from the durable failure artifact. PASS is already impossible, so this is not a false-PASS path.

**Disposition:** before live execution; not a gate-flip blocker after M1 is fixed.

### M3 — exact operation-begin failure detail is not durable

A thrown/malformed/refused operation-begin blocks the mutation correctly, but the detailed page-side failure remains only in `phaseLog`; `applyPhaseRunToState()` does not retain that log. Verdict correctness and Node refusal evidence remain fail-closed.

**Disposition:** before live execution; not a gate-flip blocker.

### M4 — static guards cannot prove absence of every future local allocator

The current implementation, runtime collision checks, mutation controls, and real Playwright binding tests establish one Node allocator for all inspected consumers. A future consumer could still introduce a local counter outside the static guards' patterns.

**Disposition:** strengthen before live execution; not a gate-flip blocker for the current code.

## Low findings

| Item | Disposition |
|---|---|
| Active-control phase ownership is enum-checked but not matched against `CONTROL_OWNING_PHASE` during ingestion/sync | Before live execution |
| Teardown request classifier C-e still uses the cleanup marker as a proxy for all terminal check records | Before live execution |
| C15(e) `T_iso` is not reconciled to the retained Viewer-call argument | Before live execution |
| C15(e) direct FAIL routing relies on later schema/R1 contradiction handling | Optional conformance hardening |
| Refused/throwing `ops.end` leaves a mutation record unsettled; PASS is prevented | Before live execution |
| Thrown cleanup-drain RPC retains a fatal generic branch but not the exact thrown error name | Optional diagnostic hardening |
| `mergeCleanupDelta` counts non-object entries as duplicates; the label is imprecise but fail-closed, and within-delta duplicates are caught by completeness validation | Optional diagnostic hardening |

## Regression assessment

- **Single allocator:** preserved. Page ordinals are non-authoritative; all retained `seq` values come from the one Node allocator.
- **Binding/refusal:** preserved. The real Playwright binding gate still proves awaited ordering and refusal-before-mutation behavior.
- **Fatal ledger and item 24:** preserved. Required network failures remain correlated through the authoritative Node fatal ledger, and pending responses are finalized before gate/closeout decisions.
- **Duplicate handling:** no silent dedup remains. Non-object classification is diagnostically coarse but cannot produce PASS.
- **Scope:** both live gates remain false; no live APS/Viewer activity, authorization record, G3/H1/H2/OQ-1/host work, or production change occurred.

## Verification

- Focused G2 suite: **652/652 PASS**.
- Aggregate offline suite: **4,898 total / 4,897 pass / 0 fail / 1 existing todo**.
- Real local Playwright binding gate: **8/8 PASS**.
- `git diff --check`: clean.

## Readiness decisions

- **Cleanup provenance High fully closed:** Yes.
- **H1 fully closed:** No; M1 is a realizable phase/stage inconsistency.
- **`G2_DUAL_COUNTER_GATE.resolved` ready to flip:** No.
- **Current tree ready for checkpoint commit:** No for an H1 closeout checkpoint. A WIP commit would preserve a known live-readiness defect and is not recommended.
- **Ready for live planning:** No. After M1 is corrected and independently re-reviewed, live planning may proceed while M2–M4 and the before-live Lows remain explicit execution prerequisites.
- **Before live execution:** M2–M4; active-control phase ownership; teardown C-e; `T_iso`; unsettled `ops.end`; existing pre-link/closeout static-guard hardening; clean-tree commit/digest rebinding; and a fresh owner-issued single-use authorization record.

## Exact next authorized action

No harness edit, procedure edit, gate flip, commit, push, authorization-record issuance, live planning, or live execution is authorized by this review. The next candidate action is explicit owner authorization for a bounded **harness/test-only** correction of M1, followed by a targeted independent re-review.
