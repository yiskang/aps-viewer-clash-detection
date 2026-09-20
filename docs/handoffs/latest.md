# Clash Detection handoff

- **Repository:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`
- **Branch:** `feature/m4-performance-worker-decision-design`
- **HEAD:** `017eb7d6e18dc2bc39031fa6cdc4e94bb40148e1` (`017eb7d`, "docs: add Federated Clash Test remediation review")
- **Working tree:** the spec is modified and **uncommitted** (round 8 plus round 9 remediation); this handoff is modified; the round 8 and round 9 independent reviews are untracked. No production code or tests changed. No commit was made this session.
- **Milestone context:** M4 — Performance / Worker Decision Gate (closed, Verdict D). Current work: **Federated Clash Test & Results design remediation** (specification only; no production code). Independent round 9 review found no remaining Critical/High issue, but two Medium cross-section defects require revision; the draft is **not ready for implementation planning**.
- **M4 status:** Closed with Verdict D, accepted by the milestone owner. Phase 4 was not started or authorized, and was not touched by the new spec.

## Governing documents

- **Draft spec:** [`docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md`](../superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md)
- **Current review authority:** [`docs/reviews/2026-09-20-federated-clash-test-and-results-round9-review.md`](../reviews/2026-09-20-federated-clash-test-and-results-round9-review.md)
- Prior round 8 review: [`docs/reviews/2026-09-20-federated-clash-test-and-results-round8-review.md`](../reviews/2026-09-20-federated-clash-test-and-results-round8-review.md)
- Prior remediation review: [`docs/reviews/2026-09-20-federated-clash-test-and-results-remediation-review.md`](../reviews/2026-09-20-federated-clash-test-and-results-remediation-review.md)
- Original review: [`docs/reviews/2026-09-20-federated-clash-test-and-results-design-review.md`](../reviews/2026-09-20-federated-clash-test-and-results-design-review.md)
- M4 spec: [`docs/superpowers/specs/2026-09-08-collision-library-milestone4-performance-worker-decision-design.md`](../superpowers/specs/2026-09-08-collision-library-milestone4-performance-worker-decision-design.md)
- M4 plan: [`docs/superpowers/plans/2026-09-09-collision-library-milestone4-performance-worker-decision-implementation.md`](../superpowers/plans/2026-09-09-collision-library-milestone4-performance-worker-decision-implementation.md)
- Roadmap: [`docs/superpowers/specs/collision-library-roadmap.md`](../superpowers/specs/collision-library-roadmap.md)
- Latest M4 status authority: [`docs/research/m4-phase3-closeout-disposition.md`](../research/m4-phase3-closeout-disposition.md)

## Federated Clash Test & Results spec — review state

- **Verdict:** `revise spec before implementation planning`. Current authority: [`docs/reviews/2026-09-20-federated-clash-test-and-results-round9-review.md`](../reviews/2026-09-20-federated-clash-test-and-results-round9-review.md). Reviewed spec SHA-256: `4960814b1f6c2bd0c5c655deba21888f93add110a85a1d0d3b632b9c1c158643`.
- **NH3 core design — resolved:** permanent `ResultStore.tombstoneTest`, atomic rejection in `put`, fail-closed engine admission, and result-store-first `engine.deleteTest` ordering close the direct-definition/embedded-rerun durable alias path. Store-level concurrency coverage is adequate.
- **M2 core boundedness — resolved:** every runtime allocation class has a pre-reserved, independently capped, atomic-refusal, or planning-failure path; exhaustion can only widen taint or turn a split into a gap.
- **Two Medium revisions remain:** **R9-M1** AC-1(b) calls `retryPersist` after `persist:false`, but §13.5.1 and §18 permit retry only from `failed`, while that set is `skipped`. **R9-M2** the claimed `D ≥ maxUnitsPerRun` proof treats `maxPlanReferences` as a bound on `planRecords`, although §6.5.1 counts several additional planning classes only under `maxLedgerRecords`; AC-16's minimum-budget runtime fixture may therefore fail during planning.
- **Verification performed:** independently checked the round 9 changes against the current persistence API, ledger accounting, acceptance criteria, architecture, roadmap, M4 closeout, and prior findings. `git diff --check` passes. No `npm test` run was needed because only documentation was reviewed. The spec was not modified.

## Implementation and tests (unchanged by this task)

- Collision library: [`collision/`](../../collision/)
- Viewer integration: [`wwwroot/extensions/ClashFinderExtension.js`](../../wwwroot/extensions/ClashFinderExtension.js)
- Collision tests: [`test/`](../../test/)
- M4 performance harness and results: [`test/performance/`](../../test/performance/)
- Acceptance test: [`test/acceptance/clash-finder.acceptance.mjs`](../../test/acceptance/clash-finder.acceptance.mjs)

## Explicitly unresolved or deferred

- **Required spec revision:** make AC-1(b)'s post-`persist:false` tombstone test use a legal persistence path, or redefine the retry contract consistently.
- **Required spec revision:** correct the `maxPlanReferences`/`planRecords` reserve proof and ensure AC-16 reaches runtime exhaustion under its configured budget.
- **Outstanding external gate:** live Viewer owner-mapping evidence (OQ-4 gate) has not been gathered and independently blocks Viewer-adapter implementation planning.
- **Open Low findings from the original review:** L2 (partly reworded) and L4 for AC-15(d)–(g). All new caps (`maxLedgerRecords` 4,000,000, target caps, lowered validation ceiling) are provisional.
- Spec open questions remain in §24. OQ-16 now has a fail-closed interim (claim blocked until product acceptance is recorded); OQ-4 and OQ-17 remain trust boundaries. OQ-16 acceptance itself is a product decision not yet made.
- All sizing/cap defaults in spec §17.1 are **provisional and unmeasured**; no multi-process makespan or sustained-batch data exists (M4 measured single calls only).
- Carried over from M4 (unchanged): no external confirmation of the responsiveness target or device/browser scope; R6's ~10-instance workload still needs product confirmation; three non-blocking follow-ups remain tracked in the closeout (M4 T-c aggregation defect, M3 Criterion 6 regression, M1 gate structured-clone crash — the spec's result model excludes the last by construction).
- Phase 4 remains unstarted and unauthorized.

## Suggested next action

Remediate R9-M1 and R9-M2 against the round 9 review, then perform another independent consistency review. Implementation planning remains unauthorized until the specification has no revision-required findings and the OQ-4 live feasibility artifact exists. Do not reopen M4 or start Phase 4 unless explicitly authorized. No commit is authorized yet.
