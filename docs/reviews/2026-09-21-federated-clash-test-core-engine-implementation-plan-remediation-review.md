# Federated Clash Test core-engine implementation-plan remediation review

- **Plan reviewed:** `docs/superpowers/plans/2026-09-20-federated-clash-test-core-engine-implementation.md` and its P0–P8 phase files
- **Plan SHA-256:** `beef9dbccaad08c4f69bc256986f9e47d27179ffee8a4a85fabaeb179b550c13`
- **P7 SHA-256:** `c51f70aeceffaf5b1746f8c8473c6591a2df5b99abd26c2965b3e0ebe665b205`
- **Frozen design:** `docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md`
- **Design SHA-256:** `9bee6af5f206cbcb3a00d4c12545e8dba42b0bef33805ad9bc6e62a16d5ff29c`
- **Repository:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`
- **Branch:** `feature/m4-performance-worker-decision-design`
- **Reviewed at HEAD:** `e29efec23a407b002358f43d35d1a2a2704ab113`
- **Review date:** 2026-09-21

## Verdict

The original review's 1 Critical, 3 High, 3 Medium and 2 Low findings are materially resolved. The remediation is substantial and generally sound, but its acceptance sweep exposed three still-unresolved in-scope requirements: the AC-16 stored-reference issue record has no representable durable carrier, and AC-19(b′) and AC-19(d′) still have no complete planned verification.

The frozen core architecture does not need a general reopening. AC-16 is, however, a genuine narrow contradiction inside the frozen text: §5.5 requires bounded issues to be recorded in a sealed pre-resolution Result Set while §6.6.2 defines the only persisted planning-gap row as the closed pair `{phase, cause}`. That contradiction requires an explicit owner-authorized erratum or an explicit removal of the recording requirement before the plan can be accepted.

Findings: **0 Critical, 3 High, 2 Medium, 0 Low**.

## Verification of the prior findings

### Resolved blockers

1. **C1 — disposal:** resolved. P7 now signals every owned run before waiting, tests a controllably blocked in-flight unit, asserts that disposal remains pending while the unit is blocked, and releases it to drain and seal. It explicitly accepts executor non-return as an injected-port limit, matching frozen §10 and P6 O9.
2. **H1 — AC traceability paths:** resolved for the original defect. The table was regenerated against phase inventories; it contains 94 test-path citations (57 distinct paths), and P7.11 now defines path, ownership and named-assertion checks. No former nonexistent citation remains in the reviewed table.
3. **H2 — missing real-world families:** resolved for the five families originally identified. P7.8 Steps 11–19 now specify real-`CollisionWorld` cancellation, mixed-owner provenance, diagnostic fan-out, dirty-world/geometry-readiness and disposal/eviction coverage in two named integration files, with fixture seams, assertions and negative controls.
4. **H3 — uncalibrated wall-clock assertion:** resolved. P7.9 Step 6 tests deterministic slicing structure and records durations without a timing threshold; calibrated wall-clock acceptance is assigned to G-CAL.

### Resolved non-blockers

- **M1:** master §3 now has explicit task-level release edges and a safe strict `P3 → P4 → P5` fallback.
- **M2:** P7.8 now distinguishes exact, caveat-correlated and characterization-only oracles; deliberately caveated geometry readiness uses a separate clean reference and pair-local correlation.
- **M3:** master §6 now has a four-line, initially unchecked G-PLAN acceptance record; review recommendation is explicitly not authorization.
- **L1:** `RunHandle` is consistently six members.
- **L2:** tool-specific skills are optional and a repository-native execution workflow is stated.

## High findings

### H1 — AC-16 requires durable issue records that the frozen Result Set cannot represent

**Sections:** frozen design §5.5, §6.6.2 and §22 AC-16; P5 `Shapes this phase pins` (`PlanningGap`); P7 Task P7.4 Step 3a; P7 AC-16 traceability row; P7 `Open cross-phase items` item 1.

The design requires a stored-reference validation or migration failure to seal a failed pre-resolution set with the first 20 `{path, code}` issues recorded. The same design defines the persisted planning gap as `{phase, cause}` only. P5 correctly pins that closed shape and P7 correctly refuses to invent a field, but the plan then has no place to satisfy the AC.

The proposed alternative—treating an engine synchronous error as the record—is not compatible with the specified stored-reference path. Capacity admission succeeds synchronously, `startRun({testId})` returns a handle, and lookup/validation happens asynchronously; the required outcome is a sealed resident set, not a synchronous throw.

**Failure mode:** an implementation either drops required diagnostic evidence while claiming AC-16, widens a closed persisted schema without authorization, or changes the stored-reference API/lifecycle contract.

**Type:** genuine frozen-spec correctness contradiction exposed by the implementation plan; also an implementation-compatibility blocker.

**Minimum correction:** obtain explicit owner authorization for one narrow disposition, then make the plan and acceptance map executable. The smallest contract-preserving option is an optional bounded `issues: Array<{path, code}>` on the pre-resolution `PlanningGap`, with corresponding P5 schema/validation/digest treatment, P3/P6 writer plumbing and P7 assertions. The alternative is an explicit spec erratum removing the “recorded” requirement. Do not treat a nonexistent synchronous error as satisfaction.

### H2 — AC-19(b′) remains an in-scope criterion with no named test owner

**Sections:** frozen design §22 AC-19(b′); P7 AC-19 traceability row; P7.11 Step 3(c); P7 `Open cross-phase items` item 2.

The plan openly records that no phase tests two dirty worlds with identical admission counts but different cached membership. This conjunct has no comparison-only dependency on P8 and is not gated by Viewer integration, remote persistence, annotation, calibration or a product decision. It is part of the frozen T1/T2 core acceptance contract.

**Failure mode:** the engine can incorrectly infer outcome determinism from an equal observational baseline, yet P7.11 can reach completion with no test that distinguishes count from membership.

**Type:** verification gap and task-ownership defect.

**Minimum correction:** assign a named test to P6 or P7. A T1 test may use a controlled executor/world seam to give equal recorded baselines and membership-dependent capacity outcomes; a T2 test may use real collision-cache admission if practical. Assert the flag follows the capacity outcome, not baseline equality. This needs plan assignment, not a product decision.

### H3 — AC-19(d′) explicitly requires a T2 real-world placement-contention arm, but the plan stops at T1 fakes

**Sections:** frozen design §22 AC-19(d′); P4 error classification; P6 V17/V27; P7 Task P7.8 Steps 11–19; P7 AC-19 traceability row; P7 `Open cross-phase items` item 3.

P4 and P6 now test the retry and derived-environmental-cause protocol over fakes. The frozen AC separately requires T2 evidence that a real `CollisionWorld` placement revision changed by a direct caller on every attempt reaches that protocol. None of P7.8's five real-world families covers it.

The test is feasible with current repository seams: `CollisionWorld.invalidateModelPlacement` is public, `ModelPlacementChangedError` is exported, and existing `CollisionWorld.tlasTraversal.test.mjs` cases already demonstrate real mid-query foreign revision bumps.

**Failure mode:** unit retry behavior can be correct against scripted outcomes but incompatible with the real library's placement-revision timing, while the plan reports AC-19 satisfied.

**Type:** verification gap and implementation-plan incompleteness.

**Minimum correction:** add a sixth P7.8 real-world environment family that bumps a touched epoch on every attempt, verifies exhaustion at `maxPlacementRetries + 1`, `failed:stale-placement`, derived `placement-contention`, partial coverage and quiet-world/evaluated-unit controls. Deferral would require an explicit acceptance-scope change and named owner; it cannot be inferred from another gate.

## Medium findings

### M1 — The AC-16 traceability row simultaneously claims and disclaims the issue-list coverage

The AC-16 `In core` cell says P7 Step 3a covers “≤ 20 `{path, code}` issues,” while its `Deferred` cell and Step 3a itself say the issues list has no carrier and is not closed. P7.11's mechanical walk cannot adjudicate two opposite claims in one row.

**Minimum correction:** until H1 is resolved, remove the issue-list claim from `In core` and mark AC-16 incomplete. After the owner-authorized correction, cite the exact named test that inspects the durable list.

### M2 — The new blocking dispositions are not represented in the checkable G-PLAN record

Master §6 fixed the original review's authorization problem, but its four checkboxes cover the review result, core-only authorization, OPEN-1/OPEN-2 and seven earlier proposed errata. They do not capture the new AC-16 disposition or the assignment of AC-19(b′)/(d′), even though P7 calls all three “owner decisions.”

**Minimum correction:** after H1–H3 are resolved, make their disposition/evidence part of G-PLAN line (a)'s cited passing review or add a concise line that names the accepted AC-16 erratum and the two test owners. Do not leave them as prose outside the acceptance record.

## Adjudication of the other remediation questions

- **P7.4 Step 3a and master AC-16 ownership correction:** accepted. Stored-reference validation belongs to engine admission, not the definition-store phase. No separate owner ratification is needed beyond resolving the durable issue carrier and the ordinary G-PLAN review/authorization record.
- **Two real-world fixture builders:** acceptable implementation-plan duplication. P4's executor fixture and P7's assembled-engine fixture have different phase ownership and dependency timing; unifying them is optional and not an acceptance blocker.
- **AC-17 fixture ids 0–3 instead of illustrative 41/42/43:** acceptable. The identity values are not normative; the required owner classes and outcomes are. Avoiding irrelevant missing-owner diagnostics makes the test stronger.
- **P4 `hold` pass-through:** a valid test-support correction needed by the disposal test; it changes no production contract.

## Acceptance and scope assessment

### Sequencing and dependency correctness

The corrected master graph is implementable. It distinguishes phase completion from the two real early-release edges, records P3's ledger relationship to P5 as a contract rather than a false production import, and provides a conservative sequential fallback. P6 still waits for P3–P5; P7 waits for P0–P6. P8 remains deferrable.

### Frozen-design compatibility

P0–P8 remain feasible without Viewer-adapter work, OQ-4, remote persistence, annotation, calibration values or unresolved Host/product choices. No general design reopening is justified. H1 is the one narrow exception allowed by `CLAUDE.md`: the plan exposed a genuine contradiction between a required durable behavior and the frozen persisted shape.

### Gate isolation

G-OQ4, G-OQ1 and G-OQ17 block only Viewer/Host integration; G-OQ16 blocks enabling a qualified Host claim; G-REMOTE blocks remote persistence; G-CAL blocks calibrated thresholds/default promotion; G-RESP blocks responsiveness claims. None excuses H2 or H3, which are core acceptance tests. G-PLAN continues to block all implementation.

### Verification performed

- Frozen design hash remains `9bee6af5…`; the design file has no working-tree diff.
- Current master and P7 hashes are recorded above.
- The AC table contains 94 test-path citations (57 distinct); the original missing-path defect is corrected in plan text.
- `git diff --check` passes.
- `clashtest/` and `test/clashtest/` remain absent, so no implementation tests exist to run and no production claim is made.
- Current collision source and tests expose the real placement-invalidation/revision seams needed for H3; no collision-core change is required.

## Blocking revisions before authorization

1. Resolve the AC-16 durable issue-record contradiction through an explicitly authorized narrow spec disposition, then align P5/P6/P7 and the AC table.
2. Assign and specify a named AC-19(b′) core test.
3. Add or explicitly re-scope the required AC-19(d′) T2 real-`CollisionWorld` test; the current frozen AC requires it.

`revise implementation plan before authorization`
