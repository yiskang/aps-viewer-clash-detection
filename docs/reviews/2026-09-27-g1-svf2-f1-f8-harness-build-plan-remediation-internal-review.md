# Internal re-review — G1 SVF2 F1–F8 harness build plan (remediation round)

- **Date:** 2026-09-27
- **Authorization:** pasted bounded-remediation authorization, "Perform a bounded remediation of the G1 SVF2 F1–F8 harness build plan based on the latest independent Work review. This is plan remediation only." Does not authorize implementing the harness, creating `test/acceptance/g1-svf2-f1-f8-verification.mjs`, running F1–F8, changing production Viewer initialization, uploading/retranslating, starting G2/G3/H1/H2/OQ-1/host integration, or modifying Viewer Adapter/Core/M4/Viewer Clash Panel production code.
- **Artifact reviewed:** [`docs/research/2026-09-27-g1-svf2-f1-f8-harness-build-plan.md`](../research/2026-09-27-g1-svf2-f1-f8-harness-build-plan.md), after applying every fix mandated by [`docs/reviews/2026-09-27-g1-svf2-f1-f8-harness-build-plan-independent-review.md`](2026-09-27-g1-svf2-f1-f8-harness-build-plan-independent-review.md) (1 Critical / 7 High / 4 Medium / 2 Low, all accepted per that review's own adjudications).
- **Method:** `codex-review` (type `spec`, effort `medium`), scoped per the remediation authorization's own item 12 to exactly the areas the independent Work review's fixes touched — C1, H1–H7, the affected verdict/evidence schema and phase ordering — not an unrestricted full-artifact pass. Every finding was verified directly against repository source before being accepted, per this repo's `codex-review` skill discipline ("do not assume Codex is correct").
- **Verdict from Codex:** "Requires major revision" (4 Critical, 5 High, 4 clarifying questions).
- **Disposition:** **all 9 findings accepted; none rejected.** The plan document has been corrected in place — §6.1, §6.1a, §6.3, §6.4, §6.4a, §6.5, §7.4, §7.5, §7.6, §7.7, §4.2, and §8 now reflect the fixed design.

---

## Verification method

Before accepting, the cited repository files were read directly:

- `clashtest/identity/ModelRegistry.js:46-58,251-256` — confirmed `createModelRegistry(options)` requires `{ world }` and its constructor throws `ModelBindingError{reason:'invalid-world'}` when absent; the plan's `createModelRegistry()` (no argument) would have thrown before F1 ever ran.
- `clashtest/viewer/ViewerElementEnumerator.js:100-135` (`resolveWhole`) — confirmed the whole-scope capacity gate (`scanPopulation`, which throws `CapacityExceededError` above `maxCollisionInstancesPerEpoch`) runs **before** tree traversal, per the function's own "D-V9 order" comment — confirming I5's claim that an organically-over-limit fixture would fail F1 (and cascade to F2/F4 `BLOCKED`) before F5 ever received usable counts.
- `collision/viewer/ViewerGeometryAdapter.js:203-249` (`adaptViewerGeometry`) — confirmed the exact return contract (`ranges`, `index`, the `positions[i*positionStride+positionOffset]` accessor invariant) needed to write a deterministic independent bounds-oracle algorithm for F7 (I3).
- The plan's own prior text for C2, C3, C4, I1, I2, I4 — each confirmed as a genuine self-contradiction or design gap by direct re-reading (e.g. C4: F6's success criteria required the reload probe to resolve, while its failure criteria excluded the exact rejection type — `ObjectTreeUnavailableError` — that would prevent that resolution; C3: the mandatory-control manifest text omitted `late-completion-after-timeout` even though §6.5's own table and the JSON schema both declared it mandatory).

All 4 Critical findings and all 5 High findings were confirmed as real defects, not misreadings of an unstated intent.

---

## Findings, acceptance, and the fix applied

| # | Sev | Finding | Verified? | Accepted? | Fix applied |
|---|---|---|---|---|---|
| C1 | Critical | `createModelRegistry()` called with no argument; the real factory requires `{ world }` | Yes — `ModelRegistry.js:46-58,251-256` | **Accepted** | §6.1a: `createModelRegistry({ world })`, plus explicit setup postconditions (`registry.world===world`, `binding.model===model`, `world.isModelLive(model)===true`); clarified no `engine` is constructed. |
| C2 | Critical | Sensitivity controls ran in a standalone post-F6 phase, against a model F6 had already replaced | Yes — a genuine architectural contradiction in the plan's own phase ordering | **Accepted** | §6.1's phase table restructured: each control now runs immediately after the specific check it guards (Phases 3c/4c/5c/7c/8c), against the same model instance/baseline, before F6 ever runs. `stale-old-model-event` stays F6's own step 6 (unchanged, per L1). §6.5's table rewritten to match. |
| C3 | Critical | `late-completion-after-timeout` omitted from §6.3's mandatory-control manifest; `computeOverall()` checked the classifier before fatal-error status; an unschematized `HARNESS_ERROR` value had no home in any enum | Yes — self-contradictions in the plan's own §6.3/§6.4 | **Accepted** | §6.3: manifest now lists all 7 controls; precedence rewritten to a 5-branch table checking harness/runtime fatality (branch 1) before the classifier question (branch 2). §6.4: `INIT_TIMEOUT_MS` now sets `fatalErrorObserved` instead of a separate `HARNESS_ERROR` value. |
| C4 | Critical | F6's failure criteria excluded `ObjectTreeUnavailableError` from failing the reload probe, contradicting F6's own success criteria | Yes — a direct self-contradiction | **Accepted** | §7.6: any reload-probe rejection, including `ObjectTreeUnavailableError`, is now F6 `FAIL`, matching F3's own corrected treatment of the identical error shape. |
| I1 | High | The single global generation counter was internally inconsistent and too coarse | Yes — the plan's own §6.4a said both "increments exactly twice" and "increments on every timeout" | **Accepted** | §6.4a rewritten: per-operation tokens (`active/timed-out/completed/disposed`), one per distinct async operation, replacing the single global counter. |
| I2 | High | F4's full geometry census ran under the generic 30s timeout, risking a false `FAIL` on a merely-slow large fixture | Yes — a real design gap, no existing performance contract justifies a 30s ceiling for an exhaustive census | **Accepted** | §6.4/§7.4: F4 moved to the 120s `CENSUS_TIMEOUT_MS` tier alongside F7/F8; a timeout there is `NOT_EVIDENCED`, not `FAIL`. |
| I3 | High | F7's independent bounds oracle didn't define which vertices to use (all/indexed/active-range-only) | Yes — `ViewerGeometryAdapter.js:203-249`'s own `ranges`/`index` contract | **Accepted** | §7.7: exact deterministic 7-step algorithm added, iterating only `adaptViewerGeometry`'s own active `ranges`, resolving through `index` when present, skipping unsupported/zero-triangle geometries explicitly (`no-reference-geometry`, never a degenerate zero-box). |
| I4 | High | `uncommittedDependencyHashes` named a short, hand-picked list, omitting transitively-imported modules | Yes — a real coverage gap in the plan's own §8 | **Accepted** | §8: replaced with `servedModuleManifest`, a generated manifest of every module actually served/imported at run time; external Viewer script/style bytes recorded as `remoteAssets` (URL/status/length) with the byte-hashing limitation stated explicitly. |
| I5 | High | F5's strict dependency on F2/F4 success left the organic-breach case undefined, since the capacity gate fires before traversal | Yes — `ViewerElementEnumerator.js:118-128`'s own "D-V9 order" comment | **Accepted** | §7.5: F5 now consumes F1's own outcome directly — a typed `CapacityExceededError` from F1 is itself conclusive F5 `PASS` evidence for the named limit, independent of F2/F4's own (cascaded) failure. |
| Q1 | — | What plausibility range for `getUnitScale()`/`getUnitString()`? | N/A (clarifying) | Answered in §7.7 (finite-positive for scale; non-empty-string-or-null for string). |
| Q2 | — | Which event constants does `createViewerApi(viewer,{events})` need? | Yes — `viewerApi.js:10` throws unless both are non-empty strings | Answered in §7.7 (the real `BEFORE_MODEL_UNLOAD_EVENT`/`MODEL_REMOVED_EVENT` constants, shared with F6's own use of the same facade). |
| Q3 | — | Does F7 require every censused dbId to be visible? | N/A (clarifying) | Answered in §7.7 — no; only a valid, non-throwing API shape is required, visibility state is recorded as observation. |
| Q4 | — | Does an initial load rejection yield `FAIL` or `BLOCKED`? | N/A (clarifying) | Answered in §4.2 — a structured rejection is `BLOCKED` (classifier-level) unless its own cause independently matches a §6.6 fatal category, in which case §6.3's branch 1 (`FAIL`) already caught it first. |

No finding was rejected.

---

## What this review does NOT do

- It does not implement the harness, run F1–F8, or touch any production file — this remains a documentation-only correction of the planning artifact.
- It does not itself constitute the "independent verification (mirroring the T3 pattern)" the implementation plan's G1 exit criteria call for — that applies to a future *executed* run, not to this plan.
- It does not authorize building the harness. Per the remediation authorization's own closing instruction, the next required gate is **a bounded independent Work re-review** of this now twice-remediated plan.
