# Clash Detection handoff

- **Repository:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`
- **Branch:** `feature/m4-performance-worker-decision-design`
- **HEAD:** `959a8a829f98d2111e743f184c12fb24f085e2b3` (`959a8a8`, "docs: add Claude agent handoff convention")
- **Working tree at handoff time:** the draft spec and independent review are untracked; this handoff is modified. No production code or tests changed. No commit was made.
- **Milestone context:** M4 — Performance / Worker Decision Gate (closed, Verdict D). Current work: **Federated Clash Test & Results design remediation** (specification only; no production code).
- **M4 status:** Closed with Verdict D, accepted by the milestone owner. Phase 4 was not started or authorized, and was not touched by the new spec.

## Governing documents

- **Draft spec:** [`docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md`](../superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md)
- **Current blocking review authority:** [`docs/reviews/2026-09-20-federated-clash-test-and-results-design-review.md`](../reviews/2026-09-20-federated-clash-test-and-results-design-review.md)
- M4 spec: [`docs/superpowers/specs/2026-09-08-collision-library-milestone4-performance-worker-decision-design.md`](../superpowers/specs/2026-09-08-collision-library-milestone4-performance-worker-decision-design.md)
- M4 plan: [`docs/superpowers/plans/2026-09-09-collision-library-milestone4-performance-worker-decision-implementation.md`](../superpowers/plans/2026-09-09-collision-library-milestone4-performance-worker-decision-implementation.md)
- Roadmap: [`docs/superpowers/specs/collision-library-roadmap.md`](../superpowers/specs/collision-library-roadmap.md)
- Latest M4 status authority: [`docs/research/m4-phase3-closeout-disposition.md`](../research/m4-phase3-closeout-disposition.md)

## Federated Clash Test & Results spec — review state

- **Verdict:** `revise spec before implementation planning`. The draft is **not ready for implementation planning**.
- The full independent review found **0 Critical, 7 High, 5 Medium, and 4 Low** findings. The **seven High findings are blocking**.
- Blocking subjects: mixed reachable/unreachable owner attribution; unbounded target fan-out; epoch-cache-dependent determinism; unaccepted hierarchy-internal exclusions; incompatible cross-mode pair identity; synchronous validation versus the 8 ms gate; and contradictory diagnostic overflow rules.
- The review also records acceptance gaps, trust boundaries that cannot currently be established mechanically, and confirmed sound design areas. Use the review rather than prior conversation context as the current review authority.

## Implementation and tests (unchanged by this task)

- Collision library: [`collision/`](../../collision/)
- Viewer integration: [`wwwroot/extensions/ClashFinderExtension.js`](../../wwwroot/extensions/ClashFinderExtension.js)
- Collision tests: [`test/`](../../test/)
- M4 performance harness and results: [`test/performance/`](../../test/performance/)
- Acceptance test: [`test/acceptance/clash-finder.acceptance.mjs`](../../test/acceptance/clash-finder.acceptance.mjs)

## Explicitly unresolved or deferred

- The seven High findings in the current blocking review must be resolved in the design before implementation planning.
- Spec open questions remain in §24. In particular, OQ-4, OQ-16, and OQ-17 intersect current review findings or trust boundaries and cannot be treated as harmless planning deferrals without the corrections required by the review.
- All sizing/cap defaults in spec §17.1 are **provisional and unmeasured**; no multi-process makespan or sustained-batch data exists (M4 measured single calls only).
- Carried over from M4 (unchanged): no external confirmation of the responsiveness target or device/browser scope; R6's ~10-instance workload still needs product confirmation; three non-blocking follow-ups remain tracked in the closeout (M4 T-c aggregation defect, M3 Criterion 6 regression, M1 gate structured-clone crash — the spec's result model excludes the last by construction).
- Phase 4 remains unstarted and unauthorized.

## Suggested next action

Remediate the design spec against [`docs/reviews/2026-09-20-federated-clash-test-and-results-design-review.md`](../reviews/2026-09-20-federated-clash-test-and-results-design-review.md), starting with all seven High findings. Do not begin implementation planning until a subsequent independent review returns no blocking findings. Do not reopen M4 or start Phase 4 unless explicitly authorized. No commit is authorized yet.
