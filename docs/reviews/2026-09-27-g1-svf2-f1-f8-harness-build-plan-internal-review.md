# Internal review — G1 SVF2 F1–F8 harness build plan

- **Date:** 2026-09-27
- **Artifact reviewed:** [`docs/research/2026-09-27-g1-svf2-f1-f8-harness-build-plan.md`](../research/2026-09-27-g1-svf2-f1-f8-harness-build-plan.md) (planning/design only — this task did not write harness code, run F1–F8, or touch production).
- **Method:** `codex-review` (type `spec`, effort `medium`) via the repository's shared `codex-worker` queue, per `CLAUDE.md`'s "Internal review loop" section — this is the convergence tool, not an independent gate. Every finding below was additionally verified directly against repository source before being accepted, per the `codex-review` skill's "do not assume Codex is correct" instruction.
- **Verdict from Codex:** "Requires major revision" (5 Critical, 5 High, 1 Medium, plus 4 clarifying questions).
- **Disposition:** **all 11 findings accepted**; none rejected. The plan document has been corrected in place — §6–§8 and the affected F1/F2/F3/F4/F6/F7 subsections now reflect the fixed design; nothing in the pre-review draft survives uncorrected. This review record exists to show what was wrong, how it was verified, and exactly what changed — not as a list of open items.

---

## Verification method

For each Critical/High finding, before accepting it, the cited repository file(s) were read directly and the claim checked against actual source (not against the plan's own prose or Codex's paraphrase):

- `clashtest/viewer/readiness.js`, `clashtest/viewer/ViewerElementEnumerator.js` — for C1 (F3's actual readiness gate).
- `docs/superpowers/specs/2026-09-26-viewer-clash-panel-design.md` §2.1 (the F1–F8 table) and `collision/CollisionWorld.js` — for C2 (F4's design-mandated render-proxy/geometry-buffer scope).
- The plan's own §6.3/§8 draft text — for C3 (a genuine self-contradiction, not a Codex misreading).
- `clashtest/viewer/index.js`, `clashtest/index.js` — for C4 (the actual export locations of `createViewerElementEnumerator`/`wireModelUnload` vs. `createModelRegistry`).
- `clashpanel/viewer/viewerApi.js` — for C5 (`getElementWorldBounds`'s own source comment naming world-space correctness as the unresolved PG-1/F7 gap).
- `clashtest/viewer/populationScan.js` — for I1 (the `L`/`N`/`U` population-class scheme F2's raw-count criterion ignored).
- The plan's own §7.1/§7.3/§7.6 draft text — for I2/I3 (missing shared-resource contract; a self-contradiction between F3's cleanup phase and its "not attached across F6" claim).

All five Critical findings and all five High findings were confirmed as real defects in the plan (not misunderstandings of an unstated intent). The one Medium finding (I5, no negative controls) was confirmed as a real design gap relative to the accepted T3 precedent this plan explicitly claims to follow.

---

## Findings, acceptance, and the fix applied

| # | Sev | Finding (Codex's claim) | Verified? | Accepted? | Fix applied |
|---|---|---|---|---|---|
| C1 | Critical | F3 says the Adapter gates on `isLoadDone()`; it actually gates on `awaitObjectTree()` (`isObjectTreeCreated`/`getObjectTree` callback) | Yes — `readiness.js`, `ViewerElementEnumerator.js:89-130` | **Accepted** | Plan build-plan §7.3 rewritten: F3 now probes `resolveRoots` directly from `MODEL_ADDED_EVENT`, characterizing the real `awaitObjectTree` gap instead of a gate the Adapter never uses. |
| C2 | Critical | F4 omits render-proxy/geometry-buffer access, which the governing design's own F4 row requires | Yes — design spec §2.1 F4 row; `CollisionWorld.js` uses `getRenderProxy` | **Accepted** | Plan §7.4 rewritten: adds a sampled `getRenderProxy`/geometry-buffer-adaptation check via the shared `CollisionWorld`, alongside the original metadata-only checks. |
| C3 | Critical | The verdict schema can report overall `PASS` while a check is only "not evidenced" | Yes — the plan's own §6.3/§8 draft used an undefined `N/A-per-authorization` state and a 3-state JSON enum that couldn't encode it | **Accepted** | Plan §6.3 and §8 rewritten: exhaustive 4-state per-check enum (`PASS\|FAIL\|BLOCKED\|NOT_EVIDENCED`); overall `PASS` now requires every check `== PASS`; any `BLOCKED`/`NOT_EVIDENCED` without a `FAIL` yields `PARTIAL`. F5 specifically now reports "within limits" and "enforcement exercised" as two separate fields. |
| C4 | Critical | F6 cites a non-existent `ModelRegistry` export from `/clashtest/viewer/index.js`; its stale-event check doesn't test the real invariant | Yes — `clashtest/viewer/index.js` exports only `createViewerElementEnumerator`/`wireModelUnload`; `createModelRegistry` is in `/clashtest/index.js` | **Accepted** | Plan §7.6 rewritten: corrected import source; replaced the vacuous "distinct object" check with T3's own late-unload-control pattern (`H_STEP3`), which actually proves a late event for the old model cannot disturb the new model's binding/liveness. |
| C5 | Critical | F7 accepts any well-shaped bounds box instead of testing world-space correctness | Yes — `viewerApi.js`'s own comment: "WORLD-SPACE CORRECTNESS IS UNVERIFIED (PG-1/F7, gate G2)" | **Accepted** | Plan §7.7 rewritten: adds an independent correctness oracle (union of F4's per-fragment world bounds) compared against `getElementWorldBounds`'s output within an explicit tolerance; separates visibility/unit-metadata into their own named (and honestly-absent-if-absent) subchecks. |
| I1 | High | F2's raw fragment-count-equality criterion is wrong; population includes `N`/`U` classes a tree walk can't reach | Yes — `populationScan.js`'s `L`/`N`/`U` classification | **Accepted** | Plan §7.2 rewritten: reconciliation accounting across `L`/`N`/`U`/loaded-but-unreachable buckets, replacing raw count equality; `unresolved.length` removed from whole-scope criteria (always empty for `'whole'` scope). |
| I2 | High | F1's setup doesn't define the binding/lease/checkpoint/world contract | Yes — `ViewerElementEnumerator.js:72`'s binding shape requirement | **Accepted** | New plan §6.1a defines one shared Phase-2.5 `world`/`registry`/`enumerator`/`binding`/`ctx`, reused by F1/F2/F4/F5/F7/F8 and extended (not rebuilt) by F6. |
| I3 | High | F3's cleanup-at-Phase-10 claim contradicts its own "not attached across F6 (Phase 9)" statement | Yes — a genuine internal contradiction in the pre-review draft | **Accepted** | Phase order renumbered (§6.1): a new "F3 finalize" phase removes the F3 listener immediately after the initial load settles, before any other check runs; Phase 12 (final cleanup) performs an idempotent fallback removal only. |
| I4 | High | No timeout/indeterminate-state policy for any async step; a hang could prevent cleanup and evidence durability | N/A — a genuine design gap, not a factual claim to verify against source | **Accepted** | New plan §6.4: named timeout constants and explicit on-timeout outcomes for every async step (init, load, readiness, each Fi, unload, reload); partial evidence always retained; cleanup always still runs. |
| I5 | Medium | No reversible negative/sensitivity controls, unlike the accepted T3 precedent | Yes — `clashtest-viewer-adapter.acceptance.mjs` Step-2 controls (i)–(v) | **Accepted** | New plan §6.5: six named, reversible controls (wrong-owner, hidden-fragment, tree-unavailable, capacity-breach, stale-old-model-event, invalid-bounds), each guarding one primary check family, run after primary evidence capture and restored in `finally`. |
| Q1–4 | — | Clarifying questions: F5 scope (within-limits vs. enforcement-exercised); F7/F8 sampling rule; console/page-error disposition; run+review authorization boundary | N/A — genuine open questions, not defects | **Folded into §10** (Open Question 5–7) rather than answered unilaterally — these are legitimately for the owner/eventual independent Work review to decide, not for this planning pass to resolve on its own authority. | — |

No finding was rejected. None required a "needs clarification" disposition beyond the four questions already folded into the plan's own §10.

---

## What this review does NOT do

- It does not implement the harness, run F1–F8, or touch any production file — this remains a documentation-only correction of the planning artifact.
- It does not itself constitute the "independent verification (mirroring the T3 pattern)" the implementation plan's G1 exit criteria call for — that applies to a future *executed* run, not to this plan.
- It does not authorize building the harness. The next required gate, per the governing authorization, remains **independent ChatGPT Work review of this (now-corrected) G1 F1–F8 harness plan**, followed by explicit owner authorization before any implementation begins.
