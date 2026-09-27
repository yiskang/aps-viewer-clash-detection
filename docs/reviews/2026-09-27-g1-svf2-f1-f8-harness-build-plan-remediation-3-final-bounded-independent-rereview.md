# G1 SVF2 F1–F8 harness build plan — remediation-3 final bounded independent re-review

**Date:** 2026-09-27  
**Repository:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`  
**Branch / HEAD:** `main` / `feeb5b3149ace650598a7cb96a7efabb6360fe29`  
**Primary artifact:** `docs/research/2026-09-27-g1-svf2-f1-f8-harness-build-plan.md`  
**Governing prior review:** `docs/reviews/2026-09-27-g1-svf2-f1-f8-harness-build-plan-remediation-2-bounded-independent-rereview.md`  
**Scope:** §5h/§5i's verdict-precedence, F8 R1-domain, and F7 calibration remediations plus directly affected cross-references only.

## Verdict

**Ready for harness implementation authorization, subject to owner authorization.**

Findings: **0 Critical / 0 High / 1 Medium / 1 Low**. Neither finding blocks implementation because the executable evidence path, verdict ordering, relationship denominators, and acceptance outcomes are unambiguous. Both findings are bounded documentation corrections and must not be implemented as new Adapter/Core behavior.

Harness implementation is still unauthorized. Live F1–F8 execution remains a separate, unauthorized owner gate.

## Findings

### Medium 1 — §7.8 attributes per-fragment F1 ownership rows to the wrong existing API surface

**Affected text:** §7.8 at lines 1081–1084 and the R1 exclusion explanation at line 1094.

The corrected R1 domain is sound: `treeReachableCount`, with `loadedButUnreachableCount` retained as a named exclusion. But §7.8 says the whole-model Adapter (`createViewerElementEnumerator().resolveRoots`) “returns per-root, per-fragment ownership records” for reachable fragments. The actual public result does not:

- `ViewerElementEnumerator.rootRecord` returns `{dbId, fragmentCount, ownerDbIds, subtreeDigest}`.
- `resolveWhole` returns those aggregate root records plus aggregate `ownerMismatch` and `unreachable` diagnostics.
- It does not return the internal `owners` map or any per-fragment ownership rows.

The required per-fragment R1 evidence nevertheless already exists without an API change: F1 runs the existing collision-side `extractFragments(model, [root.dbId], ...)`, which returns a `Map<fragmentId, ExtractedFragmentRecord>` containing `ownerDbId`, and §7.1 already requires that map for each returned root. R1 can reuse those retained F1 maps and compare them with the F2 tree walk / direct fragment-list observations.

**Minimum correction:** state that R1's per-fragment ownership side comes from F1's existing `extractFragments` maps, while `resolveRoots` supplies the aggregate root contract against which F1 already reconciles them. Preserve the current `treeReachableCount` denominator and exclusions. Do not add a per-fragment field to `resolveRoots` and do not change Adapter/Core APIs.

### Low 1 — one §8 sentence still describes unavailable Viewer identity as an unconditional `BLOCKED`

**Affected text:** §8's `harnessIntegrity` prose at line 1200.

The machine-readable schema note at line 1160 correctly says `CAPTURE_UNAVAILABLE`/`PROVENANCE_AMBIGUOUS` reaches branch 4 only after Fi/control failures. The longer §8 prose later says those states “force `BLOCKED`” without that qualifier. Under the corrected six-branch precedence, they produce `BLOCKED` only if branches 1–3 found no fatal, classifier-stop, Fi, or mandatory-control failure.

**Minimum correction:** add “when branches 1–3 found no earlier failure” or cite branch 4. This is stale wording, not a verdict-logic defect.

## 1. Overall verdict precedence

The six branches are exhaustive and fail-closed over the declared states:

1. Fatal runtime state, unresolved cleanup ownership, Viewer-script mismatch/fetch failure, or invalid integrity enum → `FAIL`.
2. No branch-1 failure, but classifier is not `CONFIRMED_SVF2` → `BLOCKED`; Fi/controls did not become required.
3. Confirmed SVF2 plus any Fi `FAIL` or any mandatory control not `DETECTED_RESTORED` → `FAIL`.
4. No earlier failure, but Viewer identity is unavailable/ambiguous → `BLOCKED`.
5. Verified identity, every Fi PASS, every mandatory control restored, and no cleanup failure → `PASS`.
6. Remaining verified-runtime evidence gaps or resolved cleanup failures → `PARTIAL`.

Required combinations therefore resolve as follows:

| Combination | Verified result |
|---|---|
| Fi `FAIL` + unavailable/ambiguous Viewer identity | `FAIL` at branch 3 |
| mandatory-control failure + unavailable/ambiguous Viewer identity | `FAIL` at branch 3 |
| fatal runtime or unresolved-ownership cleanup failure + unavailable/ambiguous Viewer identity | `FAIL` at branch 1 |
| no earlier failure + unavailable/ambiguous Viewer identity | `BLOCKED` at branch 4 |

The plan distinguishes a **fatal cleanup failure** (`cleanupUnresolvedOwnership === true`) from a recorded cleanup step failure whose target state was independently confirmed resolved. The latter is not fatal by the existing contract: with verified identity it reaches `PARTIAL`; with unavailable identity it reaches branch-4 `BLOCKED`. That distinction is consistent with the request's governing rule that fatal cleanup failures force `FAIL`; it is not a new owner decision.

`MISMATCH`, `FETCH_FAILED`, and any missing/null/out-of-enum integrity state fail at branch 1. `PARTIAL` cannot contain an Fi/control failure or unidentified Viewer runtime. PASS remains reachable only under all positive conditions.

## 2. F8 R1 observable domain

The corrected relationship domains and population equations are mathematically sound:

- Top-level population: `classL + classN + classU === fragListCount`.
- Loaded-owner-resolved partition: `treeReachableCount + loadedButUnreachableCount === classL`.
- R1 ownership census: `censusedFragmentCount === treeReachableCount`.
- R2 tree census: `treeCheckedFragmentCount === treeReachableCount`.
- R3 root census: `censusedRootCount === rootsLength`.

`loadedButUnreachableCount` is explicitly outside both R1 and R2, retained as a counted exclusion, and never double-counted beside `classL`. R3's root denominator remains the Adapter's returned root count and is unaffected.

The actual Adapter source confirms the domain boundary: `resolveWhole` builds per-fragment ownership internally while walking roots, returns aggregate root records, and reduces loaded-but-unreachable fragments to aggregate count/distinct-owner diagnostics. The existing F1 collision extraction supplies R1's reachable per-fragment map. Medium 1 corrects only the prose naming that source; no API extension is needed or permitted.

## 3. F7 bounds tolerance

The remediation is sufficient:

- `T_pass = 16u·S_a` is explicitly a declared, provisional calibration assumption, not a proven Viewer guarantee.
- The live run must retain every `boundsResiduals` margin and may not tune thresholds against the same run.
- Any conclusion is limited to the tested SVF2 fixture(s), Viewer 7.124.2, and recorded browser/runtime envelope.
- The `bounds-beyond-tolerance` control applies a finite, well-ordered displacement beyond `T_gross` and must classify `disagrees`; it remains a non-vacuous proof that a materially wrong containment bound can fail.

The open calibration band continues to produce `NOT_EVIDENCED`, never PASS. No formula or architecture change is required.

## 4. Integration consistency and repository state

§5h accurately dispositions the prior two High findings and one Medium finding. §5i correctly confirms the six-branch ordering and revised F8 equations, but it missed the two documentation defects above. Historical sections remain historical; the only current normative stale statement found is Low 1.

Verified repository state remains `main` at `feeb5b3149ace650598a7cb96a7efabb6360fe29`, with the existing uncommitted G1 planning/research/review artifacts and modified handoff. This review adds only this review artifact and the handoff update. No harness, production code, test, Viewer Adapter, Core, Panel, M4, OQ-1, or host-integration file was modified. No F1–F8, G2/G3, or H1/H2 live work was run.

The codebase-memory graph was current for this HEAD. Graph lookup, outbound call tracing, exact snippets, and direct source reads agreed. Exact-path coverage reported no recorded gaps, subject to the graph's documented best-effort limitation.

## Authorization state

- **Harness plan:** technically ready for owner implementation authorization; Medium 1 and Low 1 are non-blocking documentation corrections.
- **Harness implementation:** unauthorized until the owner explicitly authorizes it.
- **Live F1–F8 execution:** unauthorized and remains a separate later owner gate.
- **Remaining technical decision:** none. Implement R1 from the already-planned F1 `extractFragments` evidence; do not extend Adapter/Core.
- **Remaining owner decision:** whether to authorize harness implementation after accepting this review. No production/Core/Adapter/host dependency has appeared.
