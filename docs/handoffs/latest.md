# Clash Detection handoff

- **Repository:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`
- **Branch:** `feature/m4-performance-worker-decision-design`
- **HEAD:** `81510de202db96d29b2496f6a735c995677e1f08`
- **Working tree before this handoff:** clean
- **Milestone context:** M4 — Performance / Worker Decision Gate (closed)
- **M4 status:** Closed with Verdict D, accepted by the milestone owner. Phase 4 was not started or authorized.

## Governing documents

- Spec: [`docs/superpowers/specs/2026-09-08-collision-library-milestone4-performance-worker-decision-design.md`](../superpowers/specs/2026-09-08-collision-library-milestone4-performance-worker-decision-design.md)
- Plan: [`docs/superpowers/plans/2026-09-09-collision-library-milestone4-performance-worker-decision-implementation.md`](../superpowers/plans/2026-09-09-collision-library-milestone4-performance-worker-decision-implementation.md)
- Roadmap: [`docs/superpowers/specs/collision-library-roadmap.md`](../superpowers/specs/collision-library-roadmap.md)
- Latest status authority: [`docs/research/m4-phase3-closeout-disposition.md`](../research/m4-phase3-closeout-disposition.md)

## Implementation and tests

- Collision library: [`collision/`](../../collision/)
- Viewer integration: [`wwwroot/extensions/ClashFinderExtension.js`](../../wwwroot/extensions/ClashFinderExtension.js)
- Collision tests: [`test/`](../../test/)
- M4 performance harness and results: [`test/performance/`](../../test/performance/)
- Acceptance test: [`test/acceptance/clash-finder.acceptance.mjs`](../../test/acceptance/clash-finder.acceptance.mjs)

## Latest meaningful commits

- `81510de` — remove stale final-review wording from the closed M4 Phase 3 report.
- `c73c5a8` — record and clarify the terminal M4 Phase 3 closeout.
- `b6a0787` — correct `orientForCrossing` handling of positive infinity and update regressions.
- `e44c393` — expose the live regression harnesses in documentation and package scripts.
- `10cd072` — correct stale canonical-ordering references in collision query source and tests.

## Explicitly unresolved or deferred

- External product confirmation remains absent for the responsiveness target and representative device/browser scope.
- R6's approximately 10-instance workload still requires product confirmation before its conditional no-boundary finding can become verdict-bearing.
- Three non-blocking follow-ups remain tracked in the closeout: the M4 T-c aggregation defect, the M3 Criterion 6 performance regression, and the M1 gate structured-clone crash.
- Phase 4 remains unstarted and unauthorized; the roadmap identifies **Federated Clash Test & Results** as the next major specification after M4.

## Suggested next action

Treat M4 as closed with Verdict D. Before starting new implementation work, confirm the next authorized scope against the roadmap and current project direction. The roadmap currently identifies **Federated Clash Test & Results** as the next major specification after M4. Do not reopen M4 or start Phase 4 unless explicitly authorized.
