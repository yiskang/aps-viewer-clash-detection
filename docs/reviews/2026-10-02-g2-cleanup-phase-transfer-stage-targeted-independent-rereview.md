# G2 cleanup phase / transfer-stage targeted independent re-review

Date: 2026-10-02  
Repository: `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`  
Branch / reviewed HEAD: `main` / `b33b7a94eaaefd4b3c7f097a4c743a5bb5abf80a`  
Baseline: `main == origin/main`  
Accepted procedure SHA-256: `5f9c4c7e124751d09406f07eab63f844fec53add006bd12ad676ecaca3732abb` (unchanged)

## Verdict

**0 Critical / 0 High / 4 Medium / 8 Low.**

The cleanup phase / transfer-stage correction is sound. Cleanup provenance is fully closed, and H1 is technically closed. The single Node sequence allocator remains authoritative; page ordinals remain source identities only. A run-transfer record can qualify as cleanup evidence only when its retained semantic phase is `cleanup`, the unique identity-bound cleanup marker is proven, and its authoritative sequence follows that marker.

`G2_DUAL_COUNTER_GATE.resolved=false` is technically ready for an owner-authorized flip, but no flip is authorized by this review. The dormant tree is ready for a checkpoint commit after explicit owner authorization. H1 no longer blocks live planning, but live planning remains unauthorized. Four retained Medium hardening items and several Low conformance/diagnostic items must be completed before live execution.

## Repository and scope verification

- `main == origin/main == b33b7a94eaaefd4b3c7f097a4c743a5bb5abf80a`.
- The procedure file and its accepted SHA are unchanged. `G2_DUAL_COUNTER_GATE.resolved=false`; `LIVE_PATH_WIRED=false`.
- No G2 live attempt/result/evidence exists. No Viewer, Core, Adapter, M4, Panel production, OQ-1, host-integration, G3, H1-milestone, or H2-milestone work was introduced.
- The working tree remains intentionally dirty with the dormant G2 harness/test remediation and its documentation. This review changes only this review file and the handoff.

## Findings

### Critical

None.

### High

None.

### Medium — retained before live execution

1. **Final `eventLog` snapshot precedes the final run-transfer drain.** `runChecksInPhaseOrder()` snapshots `eventLog` after `mark('cleanup')`, while `g2RunPhases()` subsequently performs the final fence/drain. An event allocated during that drain is ingested and lies at or below the run high-water, but is absent from the frozen run `eventLog` and cannot later arrive in the cleanup delta. Bidirectional provenance detects the omission and forces FAIL, so this cannot false-PASS or invalidate H1. It can conservatively consume an otherwise valid exactly-one live attempt and leaves the failure artifact without that event payload. Refresh/finalize the run `eventLog` after the final drain, or carry the drained event into the authoritative run result, before live execution.
2. **Failed-phase cleanup retention remains incomplete.** If a phase run throws before the normal transfer, cleanup-created page evidence is not fully retained in the failure artifact. Verdict safety is already FAIL; evidence completeness should be hardened before live execution.
3. **Operation-refusal detail is not fully durable.** Exact operation-begin refusal detail can remain only in page `phaseLog`, while the durable Node failure may be generic. This does not permit the refused operation or a PASS, but should be retained before live execution.
4. **Static guards cannot exclude every future consumer-local authoritative counter.** The current implementation has one authoritative Node allocator, and no second counter was found. Broader static enforcement remains before-live hardening.

### Low — retained dispositions

1. The eight-round stabilization ceiling is a provisional operational bound, not a measured threshold. It is safe and fail-closed: sustained activity yields one drain-refused fatal, never PASS. No H1 or gate-flip blocker.
2. Active-control values are enum-validated but not fully tied to owning phases. Complete before live execution.
3. The teardown C-e proxy remains indirect. Complete before live execution.
4. `T_iso` evidence authority remains less explicit than the principal state ledger. Complete before live execution.
5. A refused `ops.end` can leave an operation record unsettled. Complete before live execution.
6. C15(e) does not route directly to its preferred primary FAIL row in every diagnostic path. Optional; verdict remains fail-closed.
7. A thrown drain RPC does not durably retain the exact error name. Optional diagnostic hardening.
8. `mergeCleanupDelta` counts non-object entries as duplicates. This conservatively fails and cannot false-PASS; optional schema-label precision.

## Targeted adjudication

### 1. Semantic phase versus transport stage — closed

Transport stage is derived only from the ordinal range: `run` at or below the run boundary and `cleanup` inside the cleanup-drain range. Semantic phase is retained independently on the source ordinal.

Forward and reverse provenance accept a run-carried cleanup event only when its source is an event ordinal with semantic `phase:'cleanup'`. A rewritten or ordinary run-stage event does not qualify. This correctly models the real await window after `mark('cleanup')` without treating transport stage as execution phase.

### 2. Cleanup marker proof — closed

The proof requires exactly one authoritative marker named `cleanup`. Its source must be a run-stage page ordinal with:

- `kind:'alloc'`;
- `label:'marker:cleanup'`;
- `phase:'cleanup'`;
- an authoritative Node sequence allocated during ingestion.

A run-carried cleanup event is legal only when `event.seq > marker.seq`. That order is meaningful because both sequences come from the same Node allocator in ingestion order. Missing, duplicate, substituted, mislabeled, wrong-phase, or cleanup-stage marker sources make the boundary unproven. Pre-marker events fail as before-boundary. The full-flow and mutation tests prove that removing the marker qualifier or boundary checks lets corrupt cases pass, so the tests are non-vacuous.

### 3. Identity and bidirectional provenance — closed

Every event ordinal now requires a non-empty label. Event identity is always compared to the retained source label; there is no null-label exemption. Phase, kind, label, ordinal, sequence, and stage mismatches fail closed. The same event reappearing in a cleanup delta is a duplicate merge, not a silent deduplication.

Source-to-state and state-to-source checks cover run-carried semantic-cleanup events and cleanup-drain events. Missing, duplicate, unsourced, leaked, rewritten, or repeated-drain records cannot PASS.

### 4. Bounded stabilization — accepted

`g2CleanupDrain()` takes a snapshot above the previous high-water, awaits the cross-realm drain fence, and returns only when the post-fence high-water equals the snapshot high-water. If the page allocates during the await, the next round includes the new ordinal. After eight non-stable rounds it returns `ok:false`; Node records exactly one `cleanup-evidence:drain-refused:cleanup drain did not stabilize` fatal.

The final equality check and return are synchronous in the browser realm, so no page task can allocate between them. A mutation test that removes the stability requirement loses a late event and would have passed before this fix. Eight rounds are sufficient for a bounded fail-closed gate, although the number is not calibrated and may conservatively fail under sustained callbacks.

### 5. Deferred snapshot timing — before-live, not an H1 blocker

The retained snapshot race cannot produce PASS: the source ordinal is ingested, the authoritative event payload is absent, and bidirectional provenance records a fatal integrity failure. Therefore it does not contradict the accepted single-authority or cleanup-completeness contract for successful evidence and does not block H1 closure or the technical gate flip.

It should still be corrected before live execution because it can turn a valid run into a conservative FAIL and make an already-failing artifact less complete. The procedure's evidence-retention goal favors retaining the payload even on failure paths; the present implementation at least preserves the exact missing-source integrity diagnosis and never hides the omission.

## Regression and test assessment

- Focused G2 suite: **693/693 pass**.
- Aggregate offline suite: **4,939 total / 4,938 pass / 0 fail / 1 existing todo**.
- Real local Playwright binding gate: **8/8 pass**.
- `git diff --check`: clean before this documentation update; rechecked after persistence.

The new tests exercise real boundary failures rather than repeating the implementation: pre-marker/post-marker transfer, zero/duplicate/substituted marker, rewritten identity/phase, duplicate transfer, event-during-fence convergence, and never-stable refusal. Mutation/static guards demonstrate that removing the corresponding conditions would admit the corrupt cases. The one Node allocator, real binding gate, operation-refusal block, authoritative fatal ledger, and item-24 pending-response finalization did not regress.

## Readiness and authorization

- **Cleanup provenance:** fully closed.
- **H1:** technically fully closed.
- **Dual-counter gate:** technically ready for an explicit owner-authorized flip; it remains `false`.
- **Checkpoint commit:** technically ready as a dormant checkpoint, after explicit owner authorization. Keep both live gates false unless separately authorized.
- **Live planning:** technically unblocked by H1, but currently unauthorized.
- **Live execution:** not ready. Resolve the four Medium items, the before-live Low items, retained M1/M2 pre-link/closeout static hardening, then commit a clean tree, recompute binding digests, and obtain a fresh single-use owner authorization record.

## Exact next action

Obtain explicit owner authorization to commit the dormant H1 remediation, tests, review records, and handoff as a checkpoint **without** flipping `G2_DUAL_COUNTER_GATE` or `LIVE_PATH_WIRED`. No harness edit, gate flip, live planning, authorization-record issuance, or live G2 execution is authorized by this review.
