# G1 SVF2 F1–F8 harness build plan — remediation-2 bounded independent re-review

**Date:** 2026-09-27  
**Repository:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`  
**Branch / HEAD:** `main` / `feeb5b3149ace650598a7cb96a7efabb6360fe29`  
**Primary artifact:** `docs/research/2026-09-27-g1-svf2-f1-f8-harness-build-plan.md`  
**Scope:** the six §5f remediation areas (H1/H2/M1/M2/M3/L1), §5g's directly affected follow-up corrections, and integrated verdict/evidence logic only.

## Verdict

**Revise the harness plan before implementation authorization.**

Findings: **0 Critical / 2 High / 1 Medium / 0 Low**.

The realm-safe load state machine, Viewer-script digest classification, control schema, restoration/non-interference split, and nine-control reconciliation are materially improved and internally coherent. Two bounded contradictions remain. First, `computeOverall()` can report `BLOCKED` when a real Fi failure or mandatory-control failure was already observed. Second, F8 requires an R1 ownership comparison for loaded-but-unreachable class-`L` fragments even though the current Adapter result exposes no per-fragment F1 ownership record for that population.

No owner/product decision is needed to fix either issue. Both are plan-level technical corrections. Harness implementation and live F1–F8 execution remain unauthorized.

## Findings

### High 1 — Viewer identity `BLOCKED` precedence masks observed Fi and mandatory-control failures

**Plan sections:** §6.3, especially branches 2–3 (`docs/research/2026-09-27-g1-svf2-f1-f8-harness-build-plan.md:691-715`) and the explanatory text at lines 699–707 and 734.

`computeOverall()` evaluates `viewerScriptIntegrity in {CAPTURE_UNAVAILABLE, PROVENANCE_AMBIGUOUS}` in branch 2 before it evaluates `any Fi == FAIL or any mandatory control != DETECTED_RESTORED` in branch 3. Therefore a run can observe a genuine Fi contract violation, or a mandatory sensitivity control can be `NOT_DETECTED`, `RESTORE_FAILED`, `TIMED_OUT`, or `NOT_EXECUTABLE`, yet the aggregate result is `BLOCKED` rather than `FAIL` whenever Viewer-script identity is unavailable or ambiguous.

That contradicts the remediation's own normative rules:

- §6.3 says every non-`DETECTED_RESTORED` mandatory-control state forces overall `FAIL` once the SVF2 classifier has confirmed the fixture.
- §6.3a assigns `FAIL` to all four adverse control states.
- The bounded review gate requires any Fi `FAIL` and any mandatory-control detection/restoration failure to force `FAIL`; only evidence incompleteness with no failure may produce `PARTIAL` or `BLOCKED`.

Retaining and narrating the buried failure does not correct the aggregate verdict. It still weakens a positive defect signal into an identity precondition failure.

**Minimum correction:** keep fatal/runtime/schema failures first and keep a non-confirmed SVF2 classifier as `BLOCKED`, but, after `CONFIRMED_SVF2`, evaluate Fi and mandatory-control failures before the Viewer-identity unavailable/ambiguous branch. A Viewer digest mismatch/fetch failure remains `FAIL`; unavailable/ambiguous identity remains `BLOCKED` only when no Fi/control failure was observed. Add offline precedence cases for both an Fi `FAIL` and each adverse control state combined with `CAPTURE_UNAVAILABLE` and `PROVENANCE_AMBIGUOUS`.

### High 2 — F8 R1 cannot census all `classL` fragments from the stated F1 evidence source

**Plan section:** §7.8, especially the evidence source and observation sequence at lines 1039–1041, R1 at line 1051, and equations/fields at lines 1055–1062.

R1 defines its denominator as all of F2's `classL`, explicitly including `loadedButUnreachableCount`, and requires `censusedFragmentCount === classL`. But the observation sequence iterates fragments that F1 attributed to an F1 root. The current whole-model Adapter exposes per-root records only for tree-reachable fragments. For loaded-but-unreachable class-`L` fragments it exposes only aggregate `unreachable.count` and distinct `unreachable.ownerDbIds`; it does not expose a per-fragment F1 ownership record that R1 can compare with `fragList.getDbIds(fragId)`.

This is confirmed by the current implementation:

- `clashtest/viewer/ViewerElementEnumerator.js:125-177` marks reachable ids while walking roots, then returns only aggregate unreachable count/owner ids.
- `clashtest/viewer/populationScan.js:10-30` has the dense class-`L` records, but those records are the F2/population surface itself; comparing `getDbIds` to that same record is not the stated F1-vs-F2 cross-surface oracle.

The five equations are algebraically disjoint, but R1's claimed numerator is not mechanically obtainable from the named evidence. In the common successful-F1 path this is hidden because F1 requires `unreachable.count === 0`; the plan nevertheless explicitly defines loaded-but-unreachable fragments as part of R1 and claims full class-`L` census behavior. An implementer would have to invent an extra ownership source, silently weaken the relationship, or depart from the plan.

**Minimum correction:** define R1 over the F1-attributed/tree-reachable population and make `loadedButUnreachableCount` a named exclusion for R1 as it already is for R2; require `censusedFragmentCount === treeReachableCount`, with `treeReachableCount + loadedButUnreachableCount === classL` preserving the full-population accounting. Alternatively, explicitly state that F8 is `BLOCKED` whenever F1 reports any unreachable fragment, and remove claims that R1 directly verifies those fragments. No Adapter/Core API extension is warranted for G1.

### Medium 1 — F7 PASS allowance remains a declared calibration assumption, not a proven Viewer-path bound

**Plan section:** §7.7, especially lines 970–1002.

The remediation correctly withdraws the unrelated clearance-anisotropy precedent, uses the actual exposed numeric surfaces (`Float32Array(6)` from `getNodeBox`; float64 arithmetic over copied world matrices), accounts for cancellation through an operand-scale term, classifies the open band as `NOT_EVIDENCED`, and adds a non-vacuous supra-`T_gross` control. The repository does not establish the internal arithmetic/rounding chain used by Viewer 7.124.2 to produce `getNodeBox`, however, so `16u·S_a` remains exactly what the plan calls it: a provisional PASS allowance rather than a mechanically proven end-to-end bound.

This is not an additional plan blocker because the uncertainty is explicit, the intermediate band cannot pass, all residuals are retained, the constants cannot be tuned against the same run, and `bounds-beyond-tolerance` proves the failure path. It remains a verification/calibration gate and must not be described later as source-proven Viewer behavior.

## Bounded verification by remediation area

### H1 — realm-safe timeout/load state machine: closed

- Browser-owned load records live only under `window.__g1`; Node receives JSON-safe snapshots and never receives a live `Document` or `Model`.
- In-page callbacks no longer call Node/Playwright APIs. `page.isClosed()` is used only in the Node-side post-teardown abandonment step.
- The four terminal cases cover early timeout, late document, late model/rejection, and an unrecoverable/contaminated page. Untrusted sessions stop normal phases and are torn down rather than reused.
- Absolute-deadline checks and sealed generations prevent a late document/model from publishing into Phase 2.5 or later Fi evidence.

### H2 — Viewer-script identity gate: closed except for High 1's aggregate precedence

- The captured decoded `viewer3D.js` response body is hashed and compared with the known decoded-bundle SHA-256.
- `MISMATCH` and `FETCH_FAILED` force `FAIL`; missing/out-of-enum integrity state also fails closed.
- `CAPTURE_UNAVAILABLE` and `PROVENANCE_AMBIGUOUS` prevent `PASS`; URL, status, redirects, transport length, and cache/service-worker provenance cannot substitute for a matching digest.
- Only `VERIFIED` is PASS-eligible. The remaining defect is not the identity classifier itself, but its precedence over already-observed Fi/control failures.

### M1 — F8 partition math: not closed

`L ⊎ N ⊎ U = fragListCount` and `treeReachable ⊎ loadedButUnreachable = classL` are valid disjoint partitions. The operational R1 census does not have the F1-side per-fragment data required for the loaded-but-unreachable portion of `classL`; High 2 must reconcile the denominator with the actual Adapter contract.

### M2 / M3 / L1: closed with one recorded calibration residual

- F7's componentwise bracket, `T_pass`/`T_gross` split, retained residuals, and `bounds-beyond-tolerance` control are internally consistent; Medium 1 remains a declared calibration limitation.
- Classifier-stop controls now use the same exhaustive `ControlResult` enum, with `NOT_EXECUTABLE` rather than stale `not-run` wording. Missing/out-of-enum states cannot reach `PASS` or `PARTIAL`.
- Shared-state controls require restoration; the two isolated synthetic controls require non-interference and terminal-state proof. No shared-state mutation can produce `DETECTED_RESTORED` without verified restoration.

## Integrated result

- The plan consistently enumerates **nine** mandatory controls: `tree-unavailable`, `wrong-owner`, `late-completion-after-timeout`, `hidden-fragment`, `invalid-geometry-consumer`, `capacity-breach`, `invalid-bounds`, `bounds-beyond-tolerance`, and the copied F6 `stale-old-model-event` result.
- §5g's stale `not-run` wording and missing/null/out-of-enum `viewerScriptIntegrity` fail-open path are fixed.
- PASS still requires confirmed SVF2, verified Viewer-script bytes, every Fi PASS, all nine controls `DETECTED_RESTORED`, no fatal/unresolved cleanup state, and no cleanup failure.
- The aggregate model is not yet fully fail-closed because High 1 downgrades observed Fi/control failures when script identity is unavailable/ambiguous.

## API and scope verification

The current source confirms the API shapes relied on by the changed sections: `getElementWorldBounds` supplies a `Float32Array(6)` to `getNodeBox`; `extractFragments` obtains real Viewer world matrices/bounds and returns copied numeric data; `scanPopulation` performs the dense `L/N/U` partition under the existing epoch capacity limit; and `resolveWhole` returns per-root reachable records plus aggregate unreachable diagnostics. Codebase-memory graph lookup, call tracing, and direct source reads agreed; exact-path coverage reported no recorded gaps, with the graph's documented best-effort caveat.

No production initializer, Viewer Adapter, Core, Panel, M4, OQ-1, host integration, G2/G3, or H1/H2 dependency has appeared. The required corrections are confined to this harness plan and its future offline verdict tests.

## Authorization state

- **Harness plan:** not ready for implementation authorization.
- **Harness implementation:** unauthorized.
- **Live F1–F8 execution:** unauthorized and remains a separate future owner gate.
- **Remaining owner decision:** none. The next action is bounded plan remediation of High 1 and High 2, followed by a bounded independent re-review.
