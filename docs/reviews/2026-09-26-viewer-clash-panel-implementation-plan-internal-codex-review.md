# Viewer Clash Panel implementation plan — internal Codex review record

- **Review date:** 2026-09-26
- **Repository / branch / HEAD:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection` · `main` @ `6a55b5040369d07b67f09fe31153c55eadf5694f` (= `origin/main`); nothing committed.
- **Artifact reviewed:** `docs/superpowers/plans/2026-09-26-viewer-clash-panel-implementation-plan.md` (33 executable tasks + 5 gated items; ~19,200 lines with embedded test/implementation code).
- **Governing design:** `docs/superpowers/specs/2026-09-26-viewer-clash-panel-design.md` (owner-accepted 2026-09-26; not re-litigated by this review).
- **Nature:** **internal** review (a convergence tool, **not** an independent gate). It does not authorize implementation. The next gate is the independent ChatGPT Work plan review → owner decision.
- **Authorization:** owner instruction *"I explicitly authorize Viewer Clash Panel implementation planning only. This authorization does NOT include implementation."*
- **Outcome:** 1 Critical / 11 High / 8 Medium reported across six Codex passes (20 findings + 5 targeted corrections); every finding was checked against the plan text and, where it cited Core, against `clashtest/*` before acceptance; all accepted findings were remediated in the plan; **0 known Critical / High remain**. The last targeted pass's five corrections were applied and verified by reading the plan, **not** by a further Codex pass (convergence rule, below).
- **Review input note:** the plan is ~1 MB, larger than one reviewer pass can hold, so it was reviewed as (a) a *skeleton* (all prose, Files/Interfaces/step text, gates and coverage; code blocks stubbed) and (b) four *slices* of the highest-risk code-bearing tasks. Slice/skeleton inputs were derived copies staged under the git-ignored `.codex-worker/review-inputs/` (not repo files). **Not code-reviewed by Codex (prose/interfaces only, via the skeleton):** Tasks 1–10, 15 and 19–21; they rely on the authors' scratch-tree execution and the mutation/negative controls recorded in the tasks. Code-reviewed slices: T11–T14, T16–T18, T22–T26, T27–T33.

## Round 1 — `codex-review spec` (medium) on the plan skeleton, request `20260926-195719-54535-24616`

Result: **1 Critical / 3 High / 1 Medium** as reported (verdict "Requires major revision"). Each finding was re-checked against the plan text before acceptance.

| ID | Sev. | Finding | Verified | Disposition |
|---|---|---|---|---|
| R1-C1 | Critical | `fitSides` (T26) has no token/guard parameter, so a superseded presentation can issue the per-model fallback camera call after invalidation (camera moves cannot be rolled back) | **Yes** (T26 `fit.js`: no guard; fallback after a throwing aggregate call) | **Accepted.** `fitSides(viewerApi, sides, isCurrent)` guards every camera call; the bridge re-checks after fit and returns `superseded:true`; matrix asserts no fallback camera call (T25/T26). |
| R1-H1 | High | "Stale binding disables Run" has no operational definition in `validateSetup` (only null vs non-null) | **Yes** (T5) | **Accepted.** Blocking `binding-stale` finding when `binding.model !== catalogEntry.model`, both directions, read-only registry use (T5). |
| R1-H2 | High | `controller.dispose()` has no completion point for the cancelled run's set release | **Yes** (T18 released via late `done`); severity mitigated but the contract was undefined | **Accepted.** `dispose()` resolves only after the run's `done` settled, its set was released and the bridge disposed; never rejects; idempotent (T16/T18/T20/T32). |
| R1-H3 | High | fixed overlay scene names are unsafe for several panel instances | **Yes** | **Accepted.** Per-instance scene names (bridge default unique; `createClashPanel` derives from panel id); two-instance tests (T22/T23/T32). |
| R1-M1 | Medium | a failed lease release drops the only retry state (`held = null` before the steps) | **Yes** (T9 `release`) | **Accepted.** `stuck` ledger retried by later `release()`/`disposeAll()`; `stuckCount` (T9/T16). |
| R1-Q1 | Question | one Panel per Viewer? | — | **Answered:** several panels are supported; overlay names are instance-scoped (R1-H3). |
| R1-Q2 | Question | does `dispose()` mean "all Core and Viewer ownership released"? | — | **Answered:** yes, bounded only by Core's drain of the in-flight unit (Core open item O9); see Round 6. |
| R1-Q3 | Question | header names `superpowers:*` sub-skills not "repository-defined" | — | **Rejected:** the skills are installed and were used by the prior accepted plans; no plan change. |

## Round 2 — `codex-review code` (medium) on Tasks 22–26 (ViewerBridge), request `20260926-195719-54558-6207`

Result: **0 Critical / 3 High / 2 Medium** ("Request changes"). Theme: cleanup failures destroy the state needed to recover; stale work touches the Viewer.

| ID | Sev. | Finding | Disposition |
|---|---|---|---|
| R2-H1 | High | failed isolation restore loses its record (`record = null` before `restoreTo`) | **Accepted.** Record kept until a confirmed restore / confirmed pre-image / confirmed foreign state; recovery test (T24/T25). |
| R2-H2 | High | failed marker removal is detached from the bridge ledger | **Accepted.** Failed meshes stay in the ledger; later clear/present/dispose retry them (T23/T25). |
| R2-H3 | High | isolation pre-image is stale (read before the prerequisite's extra Viewer reads) | **Accepted.** A final `readIsolation()` immediately before the write-ahead record; unreadable ⇒ fail closed; test with a foreign change inside `getAggregateHiddenNodes` (T24/T25). |
| R2-M1 | Medium | invalidation during fit returns a non-superseded success | **Accepted** (merged with R1-C1): re-check after fit, `superseded:true`. |
| R2-M2 | Medium | overlay-scene ownership not write-ahead; scene removal can delete foreign meshes | **Accepted (reduced form).** Scene-creation intent recorded before `addScene`; a scene is never removed while a Panel mesh remains; foreign-mesh risk mitigated by instance-scoped names (R1-H3). A reliable emptiness check does not exist on the port, so no such check was added. |

## Round 3 — `codex-review code` (medium) on Tasks 16–18 (controller), request `20260926-200417-67004-19540`

Result: **0 Critical / 1 High / 2 Medium.**

| ID | Sev. | Finding | Disposition |
|---|---|---|---|
| R3-H1 | High | after an explicit "discard unsaved" confirmation, `engine.startRun` still runs before the release, so Core admission refuses when the unsaved set holds the last slot (`maxResidentResultSets: 1`); tests used a scripted engine without Core admission rules | **Accepted.** After an *explicit* confirmation (`RESULTS_CLEAR_CONFIRMED` / `RUN_RELEASE_AND_RETRY`) the old set is released **before** `startRun`; ordinary replacement stays admission-first (spec §7.6); Core-exact single-slot harness + real-engine test (T16/T20). |
| R3-M1 | Medium | selecting an unavailable clash can leave subscribers with the previous clash's notes | **Accepted.** Notes cleared before the first notification; clear-only outcomes always notify; subscriber-attached tests (T18). |
| R3-M2 | Medium | repeated freshness triggers accumulate obsolete full checks | **Accepted.** Coalesced per tick; per-refresh `AbortController` aborts the previous freshness/claim pair; aborts never shown as `unverifiable` (T17). |

## Round 4 — `codex-review code` (medium) on Tasks 11–14 (report, filters, grouping, ordered list), request `20260926-200417-67026-834`

Result: **0 Critical / 2 High / 1 Medium.**

| ID | Sev. | Finding | Disposition |
|---|---|---|---|
| R4-H1 | High | a failed/pending caveated-mask derivation silently becomes "zero matches" | **Accepted.** Mask states `pending | ready | unavailable`; `runFilterPass` returns `'mask-missing'` (never an empty set); controller shows `FILTER_MASK_UNAVAILABLE_TEXT`; tests (T12/T17). |
| R4-M1 | Medium | `navNeighbor` honours a collapsed group's scope and can select an unrendered occurrence | **Accepted.** Scope honoured only while expanded; collapse resets `navScope` (T14/T18). |
| R4-H2 | High | ordered/grouped index construction and sorts are synchronous, contradicting the plan's "all O(n) passes sliced" constraint | **Accepted in part.** The redundant `memberIndexes.sort()` was removed and **Global Constraint 7 was corrected** (predicate/label passes are sliced; index fills are linear; gap/group sorts are comparison sorts; all are synchronous one-shot passes recorded as PG-3 measurement items; spec §10.1 makes no "never blocks" guarantee). **Rejected:** rewriting index construction as async chunked passes — over-engineering against an unmeasured cost (PG-3). |

## Round 5 — `codex-review code` (medium) on Tasks 27–33 (DOM harness, renderers, shell, composition), request `20260926-200417-67048-16085`

Result: **0 Critical / 2 High / 2 Medium.**

| ID | Sev. | Finding | Disposition |
|---|---|---|---|
| R5-H1 | High | `dispose()` does not wait for active-run cancellation | **Already remediated** (duplicate of R1-H2; the reviewed slice predated that fix). |
| R5-H2 | High | DockingPanel construction failures before subscription leave an orphaned container | **Accepted.** Transactional construction; injected failures from `initialize()` / `addVisibilityListener` leave no container/subscription; composition rollback test (T31/T32). |
| R5-M1 | Medium | radio-group names are document-global across panel instances | **Accepted.** Per-panel radio names; two-shell test (T28/T29). |
| R5-M2 | Medium | multi-model filter state renders as "All models" | **Accepted.** Honest disabled "Multiple models (n)" option; test (T29). |

## Round 6 — targeted `codex-advisor` (medium) on the remediated areas only, request `20260926-201841-97803-845`

Scope per project `CLAUDE.md` review boundary: verify R1–R12 remediation items and two cross-cutting items; no new unrestricted discovery. **Verified:** R1–R6, R10, R12, X2. **Five corrections requested, all accepted and applied:**

| ID | Correction | Verified | Disposition |
|---|---|---|---|
| R6-1 (R7) | no controller-level test induced a failed release and asserted the `release-error` banner | **Yes** | **Applied** — T16 test (stuck lease + failing release, recovery on next Clear/Run). |
| R6-2 (R8) | dispose ignored `releaseSuperseded()` failures and ran `disposeAll()` before the late set was released; no terminal policy | **Yes** | **Applied** — `releaseSuperseded` failures join the `stuck` ledger (T9); final `disposeAll()` runs after `done`; `controller.dispose()` resolves `{released, errors}` (never rejects; `released:false` only after one retry); `createClashPanel.dispose` folds them into its `AggregateError` (T16/T18/T20/T32). |
| R6-3 (R8) | the plan claimed `engine.dispose()` "force-resolves" an active run | **Yes — verified against Core** (`clashtest/engine.js:1030-1050`, `Run.js:1470-1490`: signal then await drain; pending until the executor returns, accepted open item O9) | **Applied** — JSDoc/README now state the drain semantics and that the Panel has no escape hatch. |
| R6-4 (R9) | a T16 test comment said "confirmation → admission → release", contradicting the code | **Yes** | **Applied** — comment states confirm → release → `startRun`; unconfirmed replacement stays admission → release. |
| R6-5 (R11, X1) | freshness-burst test never invoked `assessNoClashClaim` (non-empty set); "linear" sort claim unsupported | **Yes** | **Applied** — empty-set abort-pair test (T17); "linear" claim replaced by "fills are linear, sorts are comparison sorts" (Global Constraint 7, T14). |

## Verification performed by the controller (not by Codex)

* Repository verification: `main` == `origin/main` == `6a55b50`, clean tree, accepted design committed and pushed, no newer Panel artifact; baseline full suite **2,972 total / 2,971 pass / 0 fail / 0 cancelled / 0 skipped / 1 todo** reproduced before planning.
* Cross-part consistency: 35 `INTENT` constants defined = 35 used; every production module imported by a task is created by a task; all 21 AC-P criteria are named by at least one task's tests; no `TBD`/placeholder patterns.
* Authors' scratch-tree execution (outside the repo, `clashtest/` symlinked read-only) against the *final text* of every earlier part: non-DOM core/support/layering/scaffold suite **358/358**; ViewerBridge suite incl. the **137-case** failure-injection matrix and mutation controls; real-browser DOM suite **75/75** including the end-to-end slice over the real controller/bridge/facade. This validates snippet consistency only and is **not** implementation; nothing was written to the repo except this record, the plan and the handoff.

## Classification of remaining concerns (project `CLAUDE.md` categories)

| Concern | Class |
|---|---|
| None known Critical/High in the plan's intended abstraction | — |
| OD-1, OD-7, OD-10, OD-12, OD-13 Part 2 plan-assumed recommendations awaiting owner confirmation (gate G-OD) | product/integration decision (owner) |
| OD-8 / OQ-1, PR-OQ17, PR-BASIS | dependencies gating integration acceptance (H1, H2) |
| SVF2 verification F1–F8 (PG-4), live ViewerBridge/DockingPanel behaviour (PG-1), first live engine run and scale (PG-2/PG-3), Soft basis evidence (PG-5) | verification/calibration gates (G1–G3) |
| hidden-nodes-during-owned-isolation reveal on restore; `getAggregateHiddenNodes` semantics under Panel isolation; `getNodeBox` world-space; aggregate `fitToView` union; base `DockingPanel.initialize()`; `BEFORE_MODEL_UNLOAD`/`MODEL_REMOVED` ordering | verification gate (G2) |
| index construction/sort cost on 100k results | verification/calibration gate (PG-3) |
| Task 26's edit blocks and Task 9/22's fake edits are prose/insertion-style, not whole-file blocks | implementation-plan note (apply exactly as written; each task's own tests prove the result) |
| `waitingForOtherRun` is a hedge; `enumeration-failed` is opaque | deferred/non-goal (wording never asserts it) |

## Convergence and stop

The loop stops under the project convergence rule. Round 6 (the only re-review of remediated areas) returned **no original-architecture defect**: its findings concerned machinery introduced by earlier remediation (the dispose completion point and the residency `stuck` ledger), which were corrected; no unrestricted full-plan re-review was started. **Ready for independent gate:** no known Critical/High correctness blocker remains at the plan's abstraction level; Medium/Low findings are dispositioned above; unresolved research, measurement, product and integration questions are recorded as gates rather than guessed closed. The internal review itself did **not** re-verify the Round 6 corrections with a further Codex pass.

**Not authorized by this record:** implementation (any of T1–T33), a Panel branch, any `clashpanel/` code or test, SVF2 live verification (G1–G3), OQ-1/host integration (H1, H2), changes to the Viewer Adapter / Core / M4, another milestone, committing or pushing.
