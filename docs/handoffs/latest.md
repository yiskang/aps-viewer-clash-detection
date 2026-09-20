# Clash Detection handoff

- **Repository:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`
- **Branch:** `feature/m4-performance-worker-decision-design`
- **HEAD:** `256b09277ed43a453e78b666ac8bb8130323ebbe` (`256b092`, "docs: remediate Federated Clash Test spec rounds 8-9 and add review records")
- **Working tree:** the spec (round 10 remediation of R9-M1/R9-M2) and this handoff are modified and **uncommitted**; everything through round 9, including the round 8 and round 9 review records, is committed at HEAD. No production code or tests changed.
- **Milestone context:** M4 — Performance / Worker Decision Gate (closed, Verdict D). Current work: **Federated Clash Test & Results design remediation** (specification only; no production code). The two Medium findings left by the round 9 review (R9-M1, R9-M2) have been remediated in the spec (round 10) but are **not yet independently re-verified**; the draft is **not cleared for implementation planning**.
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

- **Verdict authority:** [`docs/reviews/2026-09-20-federated-clash-test-and-results-round9-review.md`](../reviews/2026-09-20-federated-clash-test-and-results-round9-review.md) (reviewed spec SHA-256 `4960814b…`) said `revise spec before implementation planning`; it judged the NH3 and M2 designs resolved (no Critical/High) and left two Medium defects. Round 10 edits are unreviewed, so the spec is still **not cleared for implementation planning**.
- **R9-M1 — remediated (spec §25 Round 10).** AC-1(b) required `retryPersist` from a `persist:false` (`skipped`) set, which §13.5.1/§18 forbid (`failed` only). Kept the API contract; fixed the acceptance case: AC-1(b) now retrieves the sealed set with `getResultSet(runId)` and calls the configured `ResultStore.put` directly (expects `TestDeletedError`, nothing inserted, no `modelKey` claimed), and exercises the *legal* `retryPersist` path with a persisting run whose `put` first failed for an unrelated injected reason and is retried after `deleteTest`. §5.5 layers 1/2 no longer list `retryPersist` as an entry point for a `skipped` set. `retryPersist` was deliberately **not** broadened.
- **R9-M2 — remediated.** The proof `D ≥ maxUnitsPerRun` assumed `planRecords ≤ maxPlanReferences`, but `maxPlanReferences` counted only table entries and range records. `maxPlanReferences` now bounds **every** planning-time record class (`planRecords`), so the bound holds by construction and the proof (`planRecords + maxUnitsPerRun ≤ maxLedgerRecords − maxUnitsPerRun`) is sound; the end-of-planning check stays as an asserted internal invariant (unreachable under validated options; violation ⇒ `failed:internal-error`). AC-16's fixture is now specified so planning succeeds and runtime exhaustion is reached (`maxUnitsPerRun = N`, `maxLedgerRecords = maxPlanReferences + 2N`, plan within `maxPlanReferences` counting all classes, `N/2` initial units); the option-level `plan-too-large` case is the `maxPlanReferences` overrun. Affected text: §5.5 (layers 1/2), §6.5.1 (guard definition, proof), §17.1 (`maxPlanReferences` row), AC-1(b), AC-16. The 2,000,000 default now covers more record classes and stays provisional/unmeasured.
- **Unchanged this session:** NH3 design (`ResultStore` tombstone, admission check, `deleteTest` order), M2 exhaustion table and reserved slots, all earlier-round decisions.
- **Verification performed:** every `§` reference and AC/OQ id in the spec resolves; edited markdown table rows have consistent column counts; `git diff --check` passed; spec SHA-256 `22bb434a42c499ea1dd60a32bf802440d5f8414311ca54d3f11a4c46bd31ea55`; grep confirmed `retryPersist` is described as `failed`-only everywhere and no remaining statement bounds `planRecords` by a narrower counter. **No independent re-review since the round 10 edits; no `npm test` run** (docs only, no production code touched).

## Implementation and tests (unchanged by this task)

- Collision library: [`collision/`](../../collision/)
- Viewer integration: [`wwwroot/extensions/ClashFinderExtension.js`](../../wwwroot/extensions/ClashFinderExtension.js)
- Collision tests: [`test/`](../../test/)
- M4 performance harness and results: [`test/performance/`](../../test/performance/)
- Acceptance test: [`test/acceptance/clash-finder.acceptance.mjs`](../../test/acceptance/clash-finder.acceptance.mjs)

## Explicitly unresolved or deferred

- **Pending verification:** the round 10 remediations of R9-M1 and R9-M2 need a fresh independent review; no revision-required finding is currently known, but none has been re-verified.
- **Outstanding external gate:** live Viewer owner-mapping evidence (OQ-4 gate) has not been gathered and independently blocks Viewer-adapter implementation planning.
- **Open Low findings from the original review:** L2 (partly reworded) and L4 for AC-15(d)–(g). All new caps (`maxLedgerRecords` 4,000,000, target caps, lowered validation ceiling) are provisional.
- Spec open questions remain in §24. OQ-16 now has a fail-closed interim (claim blocked until product acceptance is recorded); OQ-4 and OQ-17 remain trust boundaries. OQ-16 acceptance itself is a product decision not yet made.
- All sizing/cap defaults in spec §17.1 are **provisional and unmeasured**; no multi-process makespan or sustained-batch data exists (M4 measured single calls only).
- Carried over from M4 (unchanged): no external confirmation of the responsiveness target or device/browser scope; R6's ~10-instance workload still needs product confirmation; three non-blocking follow-ups remain tracked in the closeout (M4 T-c aggregation defect, M3 Criterion 6 regression, M1 gate structured-clone crash — the spec's result model excludes the last by construction).
- Phase 4 remains unstarted and unauthorized.

## Suggested next action

Commission another independent consistency review of the round 10 spec against the round 9 review's criteria (AC-1(b) legality against §13.5.1/§18; the `planRecords`/`maxPlanReferences` reserve proof and AC-16 reachability), e.g. `codex-review spec docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md medium` or the independent-review process used for earlier verification reviews. Implementation planning remains unauthorized until no revision-required findings remain and the OQ-4 live feasibility artifact exists. Do not reopen M4 or start Phase 4 unless explicitly authorized. No further commit is authorized yet.
