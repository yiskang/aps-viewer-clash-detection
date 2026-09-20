# Clash Detection handoff

- **Repository:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`
- **Branch:** `feature/m4-performance-worker-decision-design`
- **HEAD:** `ec5f50f7d79cad81ab9baa92836791bb845400dd` (`ec5f50f`, "docs: add Federated Clash Test design review")
- **Review baseline:** the remediated spec remains modified and uncommitted. This handoff and the follow-up remediation review form the review documentation change. No production code or tests changed.
- **Milestone context:** M4 — Performance / Worker Decision Gate (closed, Verdict D). Current work: **Federated Clash Test & Results design remediation review** (specification only; no production code). The seven original High findings are substantively resolved, but three new High findings block implementation planning.
- **M4 status:** Closed with Verdict D, accepted by the milestone owner. Phase 4 was not started or authorized, and was not touched by the new spec.

## Governing documents

- **Draft spec:** [`docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md`](../superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md)
- **Current blocking review authority:** [`docs/reviews/2026-09-20-federated-clash-test-and-results-remediation-review.md`](../reviews/2026-09-20-federated-clash-test-and-results-remediation-review.md)
- Original review: [`docs/reviews/2026-09-20-federated-clash-test-and-results-design-review.md`](../reviews/2026-09-20-federated-clash-test-and-results-design-review.md)
- M4 spec: [`docs/superpowers/specs/2026-09-08-collision-library-milestone4-performance-worker-decision-design.md`](../superpowers/specs/2026-09-08-collision-library-milestone4-performance-worker-decision-design.md)
- M4 plan: [`docs/superpowers/plans/2026-09-09-collision-library-milestone4-performance-worker-decision-implementation.md`](../superpowers/plans/2026-09-09-collision-library-milestone4-performance-worker-decision-implementation.md)
- Roadmap: [`docs/superpowers/specs/collision-library-roadmap.md`](../superpowers/specs/collision-library-roadmap.md)
- Latest M4 status authority: [`docs/research/m4-phase3-closeout-disposition.md`](../research/m4-phase3-closeout-disposition.md)

## Federated Clash Test & Results spec — review state

- **Verdict:** `revise spec before implementation planning`. The draft remains **not ready for implementation planning**.
- **Original seven High findings:** independently re-verified as substantively resolved. AC-17–AC-20 provide direct coverage for mixed owners, target fan-out, epoch-cache sensitivity, and hierarchy-claim behavior.
- **Current follow-up review:** 0 Critical, **3 High (blocking)**, 8 Medium, 0 Low.
- **Blocking findings:** (1) `ResultStore.put` does not require the permanent `modelKey→modelVersion` claim and result insertion to be one transaction; (2) terminal precedence is undefined for cancellation/disposal/fatal-error/input-drift races; (3) hard deletion allows `testId` reuse to alias old durable `ResultId`s.
- **Codex adjudication:** its geometry-readiness finding is valid but Medium because `geometry-not-yet-available` already makes integrity caveated and prevents a clean absence. Its five Medium findings are accepted. Independent review also found contradictory explicit-root target-cap semantics and an inexact completeness count labeled exact in the whole-array diagnostic overflow path.
- **Verification performed:** current spec SHA-256 `81b43dcddf0d9509b73850071b9a76d06acf12c82cffd74e5c428c7ba11078ee`; all seven original remediations checked against their normative sections and acceptance criteria; collision implementation re-checked for owner-level aggregation, per-target diagnostic accumulation, cumulative epoch admission, and transient render-proxy behavior; `git diff --check` passed before the review/handoff edit. **No `npm test` run** because no implementation or tests changed.

## Implementation and tests (unchanged by this task)

- Collision library: [`collision/`](../../collision/)
- Viewer integration: [`wwwroot/extensions/ClashFinderExtension.js`](../../wwwroot/extensions/ClashFinderExtension.js)
- Collision tests: [`test/`](../../test/)
- M4 performance harness and results: [`test/performance/`](../../test/performance/)
- Acceptance test: [`test/acceptance/clash-finder.acceptance.mjs`](../../test/acceptance/clash-finder.acceptance.mjs)

## Explicitly unresolved or deferred

- The three High findings in the current remediation review must be resolved before implementation planning.
- Eight Medium findings require correction or explicit disposition: transient geometry readiness; global ledger memory accounting; annotation compatibility; Viewer-adapter feasibility timing; stored-reference failure causes; schema-evolution ambiguity; explicit-root target-cap semantics; and diagnostic-overflow exactness.
- Spec open questions remain in §24. OQ-16 now has a fail-closed interim (claim blocked until product acceptance is recorded); OQ-4 and OQ-17 remain trust boundaries. OQ-16 acceptance itself is a product decision not yet made.
- All sizing/cap defaults in spec §17.1 are **provisional and unmeasured**; no multi-process makespan or sustained-batch data exists (M4 measured single calls only).
- Carried over from M4 (unchanged): no external confirmation of the responsiveness target or device/browser scope; R6's ~10-instance workload still needs product confirmation; three non-blocking follow-ups remain tracked in the closeout (M4 T-c aggregation defect, M3 Criterion 6 regression, M1 gate structured-clone crash — the spec's result model excludes the last by construction).
- Phase 4 remains unstarted and unauthorized.

## Suggested next action

Remediate the three High findings against [`docs/reviews/2026-09-20-federated-clash-test-and-results-remediation-review.md`](../reviews/2026-09-20-federated-clash-test-and-results-remediation-review.md), then disposition the eight Medium findings and run another independent review. Do not begin implementation planning until that review returns no blocking findings. Do not reopen M4 or start Phase 4 unless explicitly authorized. No commit is authorized yet.
