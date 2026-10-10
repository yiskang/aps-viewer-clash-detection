# Clash Tests Manager spec §26 — Independent Work Review

Date: 2026-10-10  
Repository: `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`  
Branch / HEAD: `main` / `ea533997dc62543aac47c28628e095e62a7b90ea`  
Origin relation: `HEAD == origin/main`  
Working tree at review start: dirty, uncommitted and unpushed — modified `docs/handoffs/latest.md` and `docs/superpowers/specs/2026-09-26-viewer-clash-panel-design.md`; untracked owner brief and upstream final report. No implementation-plan, production-code or test change was present.

## Scope and reviewed authority

This review covers the complete Clash Tests Manager design in [Panel design §26](../superpowers/specs/2026-09-26-viewer-clash-panel-design.md), its reconciled pointer edits in §§0, 5, 6, 7, 9, 18, 23 and 25, the read-only upstream [package final report](../research/2026-10-10-clash-tests-manager-spec-final-report.md), the [owner brief](for-claude-clash-tests-manager.md), the current handoff, and the implementation contracts the design cites.

Implementation source checked independently: `clashpanel/core/controller.js`, `draft.js`, `residency.js`, `generation.js`, `viewModel.js`, `ports.js`, `labels.js`, `resolve.js`, and `clashpanel/viewer/ViewerBridge.js`. The codebase-memory graph was used for structural discovery and source snippets, followed by direct source reads. Coverage checks reported current metadata and no recorded issue for all nine relied-on source files; that result is a best-effort index signal, not a substitute for the direct reads.

The upstream final report remained unchanged. No implementation plan was written and no production/spec text was modified by this review.

## Verdict

**Ready for owner authorization to write the implementation plan.**

The §26 architecture is coherent with the current implementation: a headless manager owns session records while exactly one existing controller continues to own the active draft, run, residency, result pipeline and ViewerBridge. The design preserves the one-displayed-set invariant, does not widen the EnginePort, and keeps persistence, history, background runs, re-binding, G2/C6/C8/G3, Core, Adapter and collision work outside this package.

The final previously un-re-reviewed High concerning unexpected `testId` activation is **closed at design level**. Two non-blocking implementation-plan/reconciliation requirements remain. They do not require reopening the manager architecture or block authorization to draft the plan, but the eventual plan must make them executable and testable before implementation authorization.

Finding totals: **0 Critical / 0 High / 2 Medium / 0 Low**.

## Findings

### Medium M1 — the closed activation High still needs one explicit implementation transaction

**Affected sections:** §26.2 additive load seam, §26.2a activation/divergence recovery, §26.9 fault ViewModel, AC-M16, CTM-1.

The design now prevents a mismatched editor identity from being committed:

- the supplied draft is validated before mutation;
- a refused load has zero mutation and no notification;
- `activeTestId` commits only after an `ok` result whose `testId` equals `targetTestId`;
- a mismatched result or notification suspends draft sync;
- exactly one compensating load targets the committed source record;
- failed compensation enters a terminal manager fault and keeps destructive/run/edit actions disabled.

That closes the prior architectural failure mode: an unexpected editor `testId` can no longer silently make the manager record and editor disagree or sync the wrong draft.

The implementation plan must nevertheless make two details mechanical rather than implicit:

1. define the load contract's authoritative expected identity (for example an explicit `testId` paired with `draft`, or an equivalent validated invariant that `record.testId === draft.testId`); the current prose says the intent carries `{draft, acknowledgeUnsaved}` while also referring to an “unknown” id, but the editor has no manager record registry;
2. coalesce a mismatched synchronous notification and the later mismatched dispatch result into the same recovery token/state so they cannot launch two compensating loads. Recovery notifications must be evaluated against the committed source id, not the abandoned target id.

**Failure if omitted:** a literal implementation could treat the same bad activation as two divergence events or leave “unknown id” validation split ambiguously between manager and editor. The design's commit guard still prevents a false successful activation, but recovery behavior and AC-M16 would not be mechanically deterministic.

**Minimum correction:** the implementation plan must specify the load-intent input invariant, the manager-side record-existence check, one recovery state/token, and tests covering notification-first, result-first, duplicate mismatch signals, compensation success, compensation failure, Create rollback and the prohibition on syncing a disagreeing id. This is implementation-plan detail, not a reason to reopen §26.

### Medium M2 — CTM-11 is non-blocking, but its authority must be reconciled before plan acceptance

**Affected sections:** §23.1–23.7 versus stale Soft summaries in §§6/14/17/18/21; §19 item 8 versus §7.5 and AC-P4; §26.6, AC-M19, CTM-11.

The two contradictions are pre-existing and do **not** invalidate the manager design:

1. **Soft basis.** The later owner addendum §23 explicitly changes Soft from “host-verified or unavailable” to “host-verified, user-supplied, raw-model-units, or unavailable until a choice is made.” §26.6 and AC-M19 correctly depend on that later rule. The stale fail-closed wording in §§18/21—and related older summaries such as §6.2/PR-BASIS/§14—does not change the manager record, activation, residency or Viewer-ownership architecture.
2. **Per-row status.** §7.5 and AC-P4 clearly prohibit interactive `getPairStatus`/`getElementStatus` calls and require the cached async `caveated` facet. §19 item 8 is stale descriptive text. §26 stores only a terminal summary for inactive tests and introduces no per-row status-reader dependency.

They are therefore correctly treated as **non-blocking to §26 design acceptance**. However, CTM-11's current class “deferred to owner / adjudication” is looser than necessary: neither item needs a new product choice to implement the manager. Both need bounded document/plan reconciliation so later tasks and tests cannot select the stale branch.

**Failure if omitted:** an implementation plan could write mutually incompatible Soft tests or introduce a forbidden synchronous status-reader call even though the governing later contracts are already clear.

**Minimum correction:** before the implementation plan is accepted, it must record §23/§23.7 as authoritative for Soft and §7.5/AC-P4 as authoritative for row verification, and include a bounded documentation-reconciliation task for the stale statements. That task must not alter Soft math, Core APIs or the manager architecture.

## Full-design adjudication

### Architecture and lifecycle — sound

- One controller for the Panel lifetime matches the current controller's ownership of draft, run handle, residency, generation guards, listeners and bridge disposal.
- Only the active test can run, hold a result set or own Viewer presentation. Non-active records keep plain draft/summary data only, preserving the current one-slot Panel residency contract.
- Switch/delete teardown reuses `retireDisplayed`: generation/read abort, listener/poll teardown, queued `bridge.clear()`, residency release and result-view reset. The bridge's single-flight queue makes a later presentation follow the clear.
- Seal notification precedes a later retiring intent because controller notifications are synchronous. The synchronous pre-retirement re-read is a valid second guard for summary capture.
- Disposal has one owner: the manager drops records/listeners, then the existing controller disposes the active run, residency and ViewerBridge.

### Identity, drafts and summaries — sound

- Each record retains its frozen draft, so `testId`, monotone revision and `lastRun.definitionKey` survive switches; Duplicate intentionally starts a new identity at revision 1.
- Planning-stage failure/cancellation with `resultSet:null` is explicitly represented without fabricating counts, coverage, provenance or a “models changed” state.
- Admission failure preserves the previous summary, matching the controller's admission-first behavior.
- Zero-result inactive summaries use “0 clashes reported,” not an unevidenced no-clash claim.

### Readiness, Viewer ownership and scope — sound

- Inactive readiness uses catalog load state and `registry.bindingFor`, not held-set APIs. “Setup complete” is advisory and does not claim Run readiness; Soft is evaluated on activation.
- “Models changed” compares retained provenance identity triples to the current binding and scene membership without claiming Core freshness.
- No manager path calls Viewer mutation methods; the active editor remains the sole ViewerBridge owner.
- The pointer edits correctly reconcile the newly authorized session manager with prior manager non-goals while keeping persistence, suites, run history and cross-reload recovery deferred.

### Acceptance and feasibility — sufficient for planning

AC-M1…M19 cover creation, one-set residency, active-run refusal, async supersession, inactive summaries, revision continuity, duplication, delete/reset, readiness, labels, disposal, standalone-editor compatibility, draft sync, seal-before-retire, activation failure/divergence, null-set runs and confirmation races. The design is implementable through additive controller seams plus a new headless manager and UI composition; no unplanned Core, Viewer Adapter, collision, host-identity or persistence architecture is required.

CTM-7 and CTM-8 are correctly classified as later verification/calibration gates. CTM-9 and CTM-10 remain valid non-goals. CTM-3…CTM-6 are recorded product defaults; implementation authorization should confirm them, but they do not create technical contradictions.

## Verification performed and gaps

- Verified `main == origin/main == ea533997dc62543aac47c28628e095e62a7b90ea` before writing this review.
- Read all of §26 and every changed pointer hunk.
- Read the owner brief and upstream final report as review inputs; neither was modified.
- Verified current source behavior for synchronous notification, dispatch completion, New test, admission ordering, seal handling, retirement, one-slot residency, bridge clearing/disposal, model-left subscriptions, model-name disambiguation and binding-generation/version resolution.
- Confirmed no Clash Tests Manager implementation plan exists and no production/test files are changed in this package.
- `git diff --check` was clean before this report/handoff update. No test suite was run: this package changes design documentation only, and the review did not alter executable code.

## Authorization and next gate

**Exact next authorized action:** none after this review unless the owner authorizes implementation-plan drafting. The recommended next gate is owner authorization for a Clash Tests Manager implementation plan that incorporates M1 and M2 as plan-acceptance requirements.

**Must not begin without explicit owner authorization:** the implementation plan; manager/controller/UI implementation; production or test changes; commit/push; CTM-7 live verification; persistence, run history, New/Existing/Resolved lifecycle, background runs, cross-reload re-binding, G2/C6/C8/G3, reflected fragments, R20-1, or any Core/Adapter/collision change.
