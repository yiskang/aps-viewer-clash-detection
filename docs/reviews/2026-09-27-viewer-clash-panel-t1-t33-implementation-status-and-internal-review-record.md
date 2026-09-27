# Viewer Clash Panel — T1–T33 implementation status and internal review record

- **Date:** 2026-09-27
- **Role of this document:** operational status + *internal* review record for the implementation. It is **not** an independent gate. The next gate is the **independent ChatGPT Work implementation review**.
- **Authorization:** `docs/prompts/viewer-clash-panel-t1-t33-implementation-authorization.md` (Viewer Clash Panel Tasks **T1–T33 only**; G1–G3, H1–H2, SVF2 verification, OQ-1, host integration, Viewer Adapter/Core/M4 changes and any next milestone are NOT authorized).
- **Governing spec / plan:** `docs/superpowers/specs/2026-09-26-viewer-clash-panel-design.md`; `docs/superpowers/plans/2026-09-26-viewer-clash-panel-implementation-plan.md` (both unchanged during implementation; verified frozen).
- **Branch:** `feature/viewer-clash-panel-t1-t33` (created in place from `main`; no worktree, per owner instruction). Planning baseline `main` = `origin/main` = `e302b39`. `BASE0` (first branch commit, persisting the owner authorization prompt) = `a0134bb`. Implementation HEAD at the time of this record = `d381e58`. Nothing pushed.
- **Commit range for review:** `a0134bb..d381e58` (39 commits; every commit ends with `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`, none carries a `Claude-Session:` trailer).

## 1. Final state and test results (T33 gate, run on `d381e58`)

| Check | Result |
|---|---|
| `node --test test/clashpanel/scaffold.test.mjs` | 2/2 pass; `EXPECTED_MODULES` = the 36 `clashpanel/**/*.js` modules |
| `npm test` (THE default gate = `npm run test:offline && npm run test:clashpanel:dom`) | exit 0, exactly two `# tests` lines |
| — offline suite | `# tests 3587`, `# pass 3586`, `# fail 0`, `# cancelled 0`, `# skipped 0`, `# todo 1` (the pre-existing known-gap todo) — baseline at branch start 2,972 |
| — DOM suite (real Chromium, fakes only) | `# tests 77`, `# pass 77`, `# fail 0`, `# todo 0` |
| `git status --short` after `npm test` | empty |
| Out-of-scope paths in `git diff --name-only a0134bb..HEAD` | none |
| Frozen docs (`docs/superpowers/specs`, `docs/superpowers/plans`) | untouched |
| Frozen code (`package-lock.json clashtest collision wwwroot server.js routes CHANGELOG.md scripts/run-tests.mjs test/clashtest test/fixtures`) | untouched |
| `package.json` | exactly one edited line (`test`) and two added lines (`test:offline`, `test:clashpanel:dom`) |
| README markers | `test/README.md` "requires the installed" = 1; `test/acceptance/README.md` "Which browser tests are in" = 1 |
| `innerHTML|outerHTML|insertAdjacentHTML|document.write` in `clashpanel/ui` | no match |
| `setThemingColor|clearThemingColors|getThemingColor|viewer.impl|Private.` in `clashpanel` | no match |
| `isOTG` in `clashpanel` | no match |
| Owner stashes (`git stash list`) | 2, untouched |

Notes: the plan text says the DOM suite has 75 tests; the actual count is 76 at T32 (plan off-by-one at T29) and **77** after the final fix wave (+1 composition test). The offline total = 2,972 baseline + tests added by T1–T26 + `domIsolation` + fix-wave tests (+8). The T33 *negative controls* of Step 4 were not re-run by the controller; the T27 implementer ran two of them (`PLAYWRIGHT_BROWSERS_PATH=/nonexistent` ⇒ `npm test` exits 1 after the offline half; a deliberately false DOM assertion ⇒ exit 1).

## 2. Task → commit map

| Task | Commit(s) |
|---|---|
| T1 layering guard, scaffold, constants | `3e30c0a` |
| T2 scheduler, generation, ports | `cd26015` |
| T3 test-support fakes | `146fa35`, fix `a546594` |
| T4 draft model | `7a938fc` |
| T5 setup validation | `6a10f46` |
| T6 Soft availability | `6cede5d` |
| T7 derivation queue | `b1790f4` |
| T8 run state machine | `77499f3` |
| T9 result-set residency | `70a3ed9` |
| T10 result index | `1526ae6` |
| T11 run report (no-clash claim gate) | `0f04257` |
| T12 filters | `f4ee894`, fix `00b2212` |
| T13 grouping | `6a642a2` |
| T14 ordered list | `e746bcd` |
| T15 resolver/labels/rows | `d846b01` |
| T16 controller I | `eaa9122` |
| T17 controller II | `f0fa60d`, fix `054ece9` |
| T18 controller III | `5a71a2b` |
| T19 ViewModel + core barrel | `7c0b231` |
| T20 real-engine contract test | `e2ec2cd` |
| T21 large-result bounds | `8c11d9d` |
| T22 ViewerBridge skeleton | `83436e1` |
| T23 markers/outlines | `6891603` |
| T24 isolation model | `a96e24a` |
| T25 presentation transaction | `af047b2`, fix `c4f76b6` |
| T26 fit/facade/selection/model-left | `4971e42` |
| T27 DOM harness + default gate | `95bcea9` |
| T28 Setup + Run renderers | `6bad6eb` |
| T29 Filters + Results renderers | `249407c` |
| T30 Selected Clash + panel + a11y | `f21538f` |
| T31 DockingPanel shell | `97805af` |
| T32 `createClashPanel` + README | `5d02623` |
| T33 verification gate | no commit (verification only) |
| Final-review fix wave | `50b0ac0` (A-1), `9f3bcb1` (B-1), `d381e58` (C-M1/B-2) |

## 3. Review process

Subagent-driven execution: one fresh implementer per task, a task reviewer (spec compliance + quality) after each, a fix loop for findings (max 5 rounds; none needed more than 1), then a broad whole-branch review by three parallel opus reviewers (A core, B ViewerBridge, C UI/docs/scope) and ONE fix wave with one scoped re-review. Every review, ruling and deferred minor is in the Appendix (the controller ledger, verbatim). Full final-review reports: `2026-09-27-viewer-clash-panel-t1-t33-final-review-{A-core,B-bridge,C-ui-docs-scope}.md`; fix wave: `…-final-fix-wave-report.md`.

**Findings fixed during implementation (each with a failing-first regression test):**
- T3 (Important): `summaryFor` fixture `planningGaps` shape diverged from real Core → aligned (`a546594`).
- T12 (Important, plan-mandated): the AC-P4 test was vacuous → replaced with a real static/signature guard (`00b2212`).
- T17 (**Critical**, defect in the plan's own claim-gate code): a re-check could re-publish the pre-event "no clashes" claim (and an old `current` freshness) because the previous check was aborted a microtask late → previous check now superseded synchronously (`054ece9`).
- T25 (Important, defect in the plan's own code): an isolating replacement present whose isolation did not apply left the previous isolation on screen → guarded restore + notes (`c4f76b6`).
- Final whole-branch review (3 MUST-FIX): **A-1** a stuck release of the Panel's own result set blocked Run permanently with the wrong error (`50b0ac0`); **B-1 (High)** after a model left the scene the Panel's own isolation was stranded and reported "changed externally" (`9f3bcb1`); **C-M1/B-2** `createClashPanel().dispose()` did not reject with the documented `AggregateError` for ViewerBridge teardown failures (`d381e58`).

## 4. Deviations from the reviewed plan (all recorded as controller rulings; see Appendix)

- **C-1** scaffold list: every new `clashpanel/**/*.js` is appended to `EXPECTED_MODULES` in its own task (T22/23/24/26 briefs omitted the viewer modules).
- **C-2** badge labels rendered exactly as returned by `describeAxes` (no double prefix) — T28.
- **C-3** one assertion added to the composition `boot:` test (exports exactly `['createClashPanel']`, no name shared with `core/constants.js`) — T32.
- **C-4** fake Viewer aggregate fit call shape `fitToView(list, undefined, immediate)` — T3/T26.
- **C-5** the owner authorization prompt was committed as the first branch commit (`a0134bb`); T33 scope checks use `BASE=a0134bb`.
- The plan restates several files across tasks; implementers built on HEAD and did not paste restated whole-files over later fixes (verified by reviewers for T18/T19/T25/T26).
- Small additions with tests: T18 (`navScope` dropped on cross-group whole-list step; `labels.reset()` on model-left), T26 (`inspectDisposal()` diagnostic; frozen `[]` selection read on failure), T17 tail `.catch` hardening.
- The plan file itself was never edited or ticked.

## 5. Explicitly NOT done (authorization boundary)

G1 (SVF2 verification F1–F8), G2 (live ViewerBridge/DockingPanel), G3 (Panel live acceptance), H1 (host composition/routes/toolbar), H2 (OQ-1/PR-OQ17/PR-BASIS host evidence) were **not** executed or started; no SVF2/live verification was run; no model registration/unload wiring exists; no Viewer Adapter/Core/M4 change; no theming calls; nothing pushed; no next milestone started. SVF2/OTG is the required v1 loading path but **nothing here is SVF2-verified** (all tests use fakes or SVF-agnostic real Core over synthetic worlds; historical Viewer Adapter T3 evidence is SVF non-OTG only).

## 6. Recorded known follow-ups (not fixed; owner/Work-review triage)

Deferred minors per task are in the Appendix (search `minor (deferred`). The notable ones:
- **Results-list ARIA** (T29, plan-mandated): group header rows are `li role=presentation` holding a `<button aria-expanded>` inside `role=listbox` (invalid ARIA); keyboard reach/Enter selection work. Least-churn fix: `role=tree`/`treeitem` (changes `results.dom.mjs` and `panel.dom.mjs` assertions) — needs an owner/Work decision.
- Focus falls to `body` when the focused control becomes disabled (Run, Prev/Next); a long name inside the closed model `<select>` hides the disambiguating suffix (add `title`).
- No-clash claim-gate hardening minors (T11/A-review; each needs a Core value outside its published contract): qualified branch does not require `unqualified === false`; badge accepts an unvalidated freshness state; a malformed live freshness read leaves no stale banner; bare-string freshness accepted (mirrors Core). Optional single validation at `controller.js` commit point.
- `dispose()` does not report that unsaved results were dropped (spec §7.6; `{released, errors}` shape is plan-mandated); the "discard unsaved results?" confirmation survives later setup edits (A-5).
- Tail `.catch(()=>{})` on 7 chains (T17) lost fail-loud sensitivity — consider a counted internal-error sink.
- Bridge: B-3 an owned isolation session never re-checks user-hidden nodes (spec-allowed; G2 residual); throws from `markers.removeAll`/`disposeShared` are swallowed in `bridge.dispose`; `ViewerBridge.js` comment near lines 115–117 overclaims a retry after dispose; B-1 degenerate projection when every Panel-target model left and the user then "shows all" (G2).
- `controller.js:70-71` `catalog.onChange` disposer leaks if `bridge.onModelLeft` throws during construction.
- Spurious dispose error when a dispose-time `REMOVE_FAILED` note is later resolved by `markers.removeAll()`.

## 7. G2 live-DockingPanel/Viewer assumptions (none verified live)

Base `DockingPanel` constructor order create→append→`initialize()`→`setVisible(false)`; `initialize()` fully replaced (assumes the base constructor builds no title bar/close/footer/resizer outside `initialize()`; the shell does not check for an existing `.docking-panel-title`; passes `{}` options); `createTitleBar`/`createCloseButton`/`initializeMoveHandlers` exist with the stub's signatures; live CSS class names may differ; `setVisible(bool)` fires callbacks on every call with the boolean even when unchanged (a test expects a redundant `panel/hidden` after a close click); `addVisibilityListener` has no remove counterpart; live instance own-property names differ from the stub allow-list; `uninitialize()` removes the container and does not throw on the first call; the live constructor appends only its own container to `parentContainer` synchronously; `this.titleLabel` holds the title when `initialize()` runs; live `uninitialize()` cleans up `initializeMoveHandlers` handlers. Also unverified: aggregate `fitToView` framing, `getNodeBox` world-space correctness, `BufferGeometry#setFromPoints` in the page's r71 THREE, real `BEFORE_MODEL_UNLOAD`/`MODEL_REMOVED` ordering, whether `getAggregateHiddenNodes()` reports nodes hidden by the Panel's own isolation.

## 8. Post-independent-review remediation (M1/M2) — added 2026-09-27

- **M1 grouped-Results ARIA:** remediated (uncommitted) — group toggle buttons now sit outside any `listbox`; each group's option rows form their own labelled `listbox`. This supersedes the "Explicitly unresolved" ARIA item in §6 (fix was the container/listbox split rather than `tree`/`treeitem`, to keep the native button and existing keyboard/pointer behavior). +5 DOM tests (DOM suite now 82; the §1 "77" is the pre-remediation count).
- **Canonical gate after the fix (one run):** `npm test` exit 0 — offline 3587 / 3586 pass / 0 fail / 1 todo; DOM 82/82. The M2 test passed (16.6 ms). Baseline comparison not needed/performed; the reviewer's earlier red remains unexplained by this single green run.
- **Details / evidence / full log:** [`2026-09-27-viewer-clash-panel-t1-t33-m1-m2-remediation-evidence.md`](2026-09-27-viewer-clash-panel-t1-t33-m1-m2-remediation-evidence.md).
- Scope unchanged: T1–T33 only; G1–G3 and H1–H2 remain unauthorized; awaiting independent Work re-review.

## Appendix — controller ledger (verbatim)

The ledger below is the controller's progress record for the whole run (dispatches, per-task review verdicts, fix rounds, `Ruling:` lines, deferred minors). It was kept in a git-ignored scratch workspace and is reproduced here so the record survives.

```text
# SDD ledger — plan: docs/superpowers/plans/2026-09-26-viewer-clash-panel-implementation-plan.md

Authorization: docs/prompts/viewer-clash-panel-t1-t33-implementation-authorization.md (T1–T33 ONLY; no G1–G3/H1–H2/SVF2/OQ-1/host/Core/Adapter/M4).
Spec (binding): docs/superpowers/specs/2026-09-26-viewer-clash-panel-design.md
Start: main @ e302b39 (= origin/main). Branch: feature/viewer-clash-panel-t1-t33 (in place, NO worktree per owner).
Ruling: created local feature branch in-place instead of committing on main — skill forbids implementing on main without consent; prior milestones used feature branches; owner said no worktree, not no branch — costs a trivial branch rename if wrong.
Ruling: untracked docs/prompts/viewer-clash-panel-t1-t33-implementation-authorization.md left untouched until the final handoff commit — keeps task commits scoped.
Baseline (main e302b39, node scripts/run-tests.mjs, exit 0): 2972 tests / 2971 pass / 0 fail / 0 cancelled / 0 skipped / 1 todo — matches plan. Pre-flight scan dispatched (opus, read-only) -> preflight-scan.md
Pre-flight scan complete (preflight-scan.md: 33 task rows + 32 pair rows; section D = reviewer-flag list). Baseline for T33 scope checks: BASE0=a0134bbd58ba620fedc1050c161cdad985f31c34 (commit persisting the authorization prompt; first commit on branch).
Ruling C-5: committed docs/prompts/viewer-clash-panel-t1-t33-implementation-authorization.md as first branch commit (BASE0); T33 Step 5 uses BASE=BASE0 (plan allows "recorded start SHA") so the docs/prompts path is outside the checked range and 'git status --short' is empty — costs: one extra docs-only commit; revert-able.
Ruling C-1: T22/T23/T24/T26 implementers must append viewer modules to EXPECTED_MODULES in the same task (T22 'viewer/ViewerBridge.js'; T23 'viewer/markers.js'; T24 'viewer/isolation.js'; T26 'viewer/fit.js','viewer/viewerApi.js') — plan GC-12/T1 scope note mandates it, task text omits it; mechanical correction, recorded deviation.
Ruling C-2: T28 run.js renders badge labels as returned by T11 describeAxes (already prefixed; incl. pending-freshness label 'Freshness: <value> (at seal) — checking freshness…'); T28 fixtures use prefixed labels — mechanical, fixes double prefix.
Ruling C-3: T32 adds one assertion in an existing composition test: clashpanel/index.js exports == ['createClashPanel'] and share no name with core/constants.js (T1 scope note mandate); DOM test total stays 75.
Ruling C-4: T3 fakeViewer/fake viewer API uses fitToView(list, undefined, immediate) (list first slot) per amendment table + T22/T26 — mechanical.
Ruling: plan file docs/superpowers/plans/... is frozen (T33 check) — implementers must NOT tick its - [ ] boxes or edit it; progress lives in this ledger.
Ruling: section-D 'reviewer might flag' items are plan-mandated; task reviewers are not told to ignore them (no pre-judging) — any finding on them is adjudicated per the plan-mandated rule.
Model plan: implementers sonnet (opus for T16–T18, T25 controller/ledger heavy); reviewers sonnet (opus for T16–T18,T25,T31); final whole-branch review opus.
Task 1: dispatched (sonnet, agent a766d7c27ee820029), BASE=a0134bb
Task 1: implementer DONE (3e30c0a, 25 new tests; full suite 2997/2996/0 fail/1 todo); task review dispatched (sonnet a05aba96182e0b355)
Task 1: minor (deferred): layering.mjs:404 dynamic import pattern lacks \s* before '(' (`import ('x')` evades)
Task 1: minor (deferred): layering.mjs:402-403 static import anchors miss `} import … from` same-line form
Task 1: minor (deferred): layering.mjs:395-397 stripComments not string-aware (`'a//b'`)
Task 1: minor (deferred): layering.mjs:369 window/document bans over-broad (may false-positive later; watch); omits self/top/eval/Function
Task 1: minor (deferred): layering.test.mjs:110 walk skips dirs named vendor/node_modules/.git even under clashpanel/ (scaffold test still catches)
Task 1: complete (commits a0134bb..3e30c0a, review clean; 6 minors deferred — plan-mandated verbatim guard code)
Task 2: dispatched (sonnet a89b497795a1bc1bd), BASE=3e30c0a
Task 2: implementer DONE (cd26015; full 3026/3025/0/1 todo); review dispatched
Task 2: minor (deferred): ports.js:106-111 settleWithTimeout sets done before scheduler.clearTimeout — a throwing injected clearTimeout would hang readBasisVerdict (plan-mandated verbatim)
Task 2: minor (deferred): ports.js:127-128 host basis `reason` unbounded — UI task (T28) should wrap/truncate visually (textContent only)
Task 2: minor (deferred): ports.test late-answer assertion weak (plan-mandated)
Task 2: complete (commits 3e30c0a..cd26015, review clean; 3 minors deferred)
Task 3: dispatched (sonnet a05bc197989c40c94), BASE=cd26015
Task 3: implementer DONE (146fa35; full 3071/3070/0/1 todo; C-4 applied); review dispatched
Task 3: review (a3f4bee2a106fd85f) = Important: resultFixtures.summaryFor planningGaps shape ≠ real Core ([{cause,count}]), agreement test misses it; Minor: fitToViewAggregate C-4 order untested. Ruling: real Core authoritative over brief snippet (verified no plan code consumes summaryFor().planningGaps — T11/T16 read ledger.planningGaps from the sealed set); resultsBy*/caveats fields NOT added (Panel doesn't read them; doc-comment scope only) — costs: a later task needing them adds them.
Task 3: fix round 1/5 dispatched (resume implementer a05bc197989c40c94), FIX_BASE=146fa35
Task 3: fix round 1/5 implemented (a546594; full 3071/3070/0/1 todo); scoped re-review dispatched (ab0a74f882f757ae6)
Task 3: fix round 1/5 (2 addressed, 0 open; commits 146fa35..a546594)
Task 3: complete (commits cd26015..a546594, review clean after 1 fix round)
Task 4: dispatched (sonnet a641bb76788f53f1c), BASE=a546594
Task 4: implementer DONE (7a938fc; full 3092/3091/0/1 todo; stash slip recovered — stash list verified); review dispatched
Task 4: minor (deferred): draft.js:40-51 freezeSide re-copies element arrays on model toggle (O(n) on big selections; perf only)
Task 4: minor (deferred): draft.test.mjs:344 self-clash deep-copy asserted weakly (top-level notEqual only)
Task 4: minor (deferred): draft.js:174 `void revision` lint workaround; createDraft doesn't validate testNumber
Task 4: complete (commits a546594..7a938fc, review clean; 3 minors deferred; implementer stash slip recovered, owner stashes intact)
Task 5: dispatched (sonnet a36292129c197afcf), BASE=7a938fc
Task 5: implementer DONE (6a10f46; full 3114/3113/0/1 todo); review dispatched
Task 5: minor (deferred): setupValidation.js:89-92 binding-stale wording slightly off in registry-ahead direction; shared model reported once (Set A only) — T28 must not assume a Set B badge; dedup covers Core issues only
Task 5: complete (commits 7a938fc..6a10f46, review clean; minors deferred)
Task 6: dispatched (sonnet a5b63bf594c27f726), BASE=6a10f46
Task 6: implementer DONE (6cede5d; full 3125/3124/0/1 todo); review dispatched
Task 6: minor (deferred): softAvailability.js:35-36 unreachable defensive reason fallback
Task 6: complete (commits 6a10f46..6cede5d, review clean)
Task 7: dispatched (sonnet ac89e4572c0b6d32d), BASE=6cede5d
Task 7: implementer DONE (b1790f4; full 3140/3139/0/1 todo); review dispatched
Task 7: minor (deferred): derivationQueue.js:59/152/157 scheduler.clearTimeout unguarded in supersede (implausible); :78-79 consumers (T16/T17) must still apply own generation guard after await (constraint 8); stats().cached name misleading; missing tests: dup submit joining running entry, abort-listener-throws
Task 7: complete (commits 6cede5d..b1790f4, review clean)
Task 8: dispatched (sonnet a86b78a8712fa3f52), BASE=b1790f4
Task 8: implementer DONE (77499f3; full 3153/3152/0/1 todo); review dispatched
Task 8: minor (deferred; carry to T16 dispatch): runMachine has no runId cross-check — T16 must test that a superseded run's late events/done never reach reduceRun; 'admitted' resets unconditionally — T16 must gate on canRun (assert it). Also cosmetic: let polled→const, no tests for unknown status/no seq.
Task 8: complete (commits b1790f4..77499f3, review clean)
Task 9: dispatched (sonnet a1ccdf047989927bf), BASE=77499f3
Task 9: implementer DONE (70a3ed9; full 3169/3168/0/1 todo); review dispatched
Task 9: minor (deferred; carry to T16): residency.js:87-88/381-386 onPersisted saved-but-retain-refused returns held-unsaved with notice null vs adopt (:68) returns HELD_IN_MEMORY_NOTICE — inconsistent; :146 droppedUnsaved true even when release failed→stuck (T16 must read as 'user chose discard'); releaseSuperseded no stuck dedup (theoretical)
Task 9: complete (commits 77499f3..70a3ed9, review clean)
Task 10: dispatched (sonnet), BASE=70a3ed9
Task 10: implementer DONE (1526ae6; full 3176/3175/0/1 todo); review dispatched
Task 10: minor (deferred): resultIndex.js:35 null results entry untyped TypeError; duplicate-resultId first-wins branch untested
Task 10: complete (commits 70a3ed9..1526ae6, review clean)
Task 11: dispatched (sonnet implementer; opus reviewer planned — claim-gate H1 critical), BASE=1526ae6
Task 11: implementer DONE (0f04257; full 3188/3187/0/1 todo); opus review dispatched
Task 11: minor (deferred; FINAL REVIEW TO TRIAGE — safety-adjacent hardening, all plan-mandated verbatim): runReport.js:159-162 qualified branch doesn't require explicit unqualified===false (malformed {allowed:true} gets QUALIFIED wording); :57 describeAxes badge accepts unvalidated freshness state (badge 'current' while gate withholds); :362-363 malformed live freshness read falls back to at-seal value → stale banner not shown (fails open for banner only; gate unaffected); bare-string freshness accepted (mirrors Core N19); explainNoClashGaps list() vs (x??[]).length nuance; first differential test doesn't assert both verdicts occur. Claim gate itself verified correct by opus reviewer.
Task 11: complete (commits 1526ae6..0f04257, review clean)
Task 12: dispatched (sonnet), BASE=0f04257
Task 12: implementer DONE (f4ee894; full 3196/3195/0/1 todo); review dispatched
Task 12: review (ad118d00ec8152552) = Important (plan-mandated): filters.test.mjs:216-228 AC-P4 test vacuous (spied engine never passed to runFilterPass). Ruling: fix via option (a) — retitle + static token guard on filters.js + signature check, must be demonstrably failable — plan-mandated vacuous tests are defects; costs one extra small test-only commit. T17/T19 must carry the real AC-P4 (no getPairStatus/getElementStatus) coverage via fakeEngine forbidden-member recording — verify at T17 review.
Task 12: minor (deferred): filters.js:70 bare '#' needle near-no-op active filter; test gaps (final-isCurrent-only supersession, yield supersession, soft.length>0 hardening)
Task 12: fix round 1/5 dispatched (resume implementer a680349c59c4d669a), FIX_BASE=f4ee894
Task 12: fix round 1 implemented (00b2212; full 3197/3196/0/1 todo); scoped re-review dispatched
Task 12: fix round 1/5 (1 addressed, 0 open; commits f4ee894..00b2212)
Task 12: complete (commits 0f04257..00b2212, review clean after 1 fix round)
Task 13: dispatched (sonnet), BASE=00b2212
Task 13: implementer DONE (6a642a2; full 3204/3203/0/1 todo; implementer flagged some weak brief assertions); review dispatched
Task 13: minor (deferred): grouping.test.mjs:168-176 weak assertions beside real ones (notEqual on fixture arithmetic; MULTI_VALUED_NOTE / too-large regexps; .error text untested); grouping.js:34 priority=3 magic default (reconcile with T17 priorities); :44-51 new frozen table object per call (identity churn); :45 non-empty unavailable→'error' untested; :55-58 matchIdsFrom out-of-range mask → TypeError (defensive); :85 undefined label sorts as "undefined"; caller (T17) must re-check generation after submit (constraint 8)
Task 13: complete (commits 00b2212..6a642a2, review clean)
Task 14: dispatched (sonnet), BASE=6a642a2
Task 14: implementer DONE (e746bcd; full 3212/3211/0/1 todo); review dispatched
Task 14: minor (deferred; T18 dispatch pointer): orderedList.js:284-286 scoped navNeighbor matches selection by resultId only, ignores occ.groupId (T18 must always set navScope to the selected occurrence's own group); :241 memberOrders built/sorted for collapsed groups too (wasteful, PG-3); :227 flat canonical is caller's `matching` (T17/T18 must never mutate it / must pass Uint32Array); :315-323 clampPage no pageSize<=0 guard; untested: grouped+gap-asc, non-finite distance sort-last
Task 14: complete (commits 6a642a2..e746bcd, review clean)
Task 15: dispatched (sonnet), BASE=e746bcd
Task 15: implementer DONE (d846b01; full 3239/3238/0/1 todo); review dispatched
Task 15: minor (deferred; carry-forward): resolve.js unloaded note uses non-disambiguated modelDisplayName (T28-30 render via labels.modelName); labels.forgetModel doesn't bump warmSeq (in-flight warm may commit unloaded model names — controller must reset()/tie isCurrent to unload gen; T18); labels searchIndex keyed by modelKey, names refreshed only via invalidateNames() (controller must call on catalog onChange + new displayed run; T16-T18); warm() promise may reject on malformed record (caller must .catch); long unbroken names: suffix at END hidden by ellipsis — T28/T30 must wrap (overflow-wrap:anywhere/title) & test; test gaps warm-vs-warm/reset supersession
Task 15: complete (commits e746bcd..d846b01, review clean)
Task 16: dispatched (opus implementer; carry-forward.md provided), BASE=d846b01
Task 16: implementer DONE_WITH_CONCERNS (eaa9122; full 3262/3261/0/1 todo; concerns: T8 carry-forward (a) tested only via dispose, (b) canRun by construction only) ; opus review dispatched
Task 16: minor (deferred; T17/T18 pointers + FINAL REVIEW triage): no test for retired run's late `persisted`; generation/handle half of the stale guard only exercised via dispose (worth pinning once T17/T18 add non-dispose supersession e.g. model-unload); no runtime assert that `admitted` only when canRun (by construction); controller.js:339 adoptHandle silent .catch swallows onRunDone/onPersisted throws; :174 startSoftEvaluation and :113 clearViewer chains have no .catch (unhandled rejection only on builder bug); :308 retireDisplayed ignores needsAcknowledgement (unreachable, fragile); dispose doesn't bump setupGen/cancel pending Soft eval (timer hygiene); support barrel not extended with controllerHarness (per brief)
Task 16: complete (commits d846b01..eaa9122, review clean)
Task 17: dispatched (opus implementer), BASE=eaa9122
Task 17: implementer DONE_WITH_CONCERNS (f0fa60d; full 3282/3281/0/1 todo; added tail .catch on 7 new chains (carry-forward) + 1 extra test); opus review dispatched
Task 17: review (a327238293671c007, opus) = CRITICAL: claim-gate race in brief's own code — recheckFreshness clears claim synchronously but aborts the previous check only in a later microtask (startFreshnessCheck); previous check's queued commit can re-publish the pre-event `allowed` claim (and old `current` freshness) while the re-check is outstanding; reproduced with real harness. Ruling: fix via synchronous supersession in recheckFreshness (mechanical correction serving plan's own H1 rule; a plan defect) + regression tests (catalog.fire k-hop loop, PANEL_SHOWN, non-empty variant) with RED evidence — costs: small deviation from brief code in controller.js; no architecture change.
Task 17: minor (deferred; FINAL REVIEW triage): 7 tail .catch(()=>{}) (declared deviation; lost fail-loud sensitivity — suggest counted internal-error sink); commit swallows any ReadAbortedError even when own signal not aborted (stuck 'checking', fails closed); AC-P4 runtime assertion largely re-confirms narrowEnginePort; no PANEL_SHOWN-triggered H1 test (added in fix round)
Task 17: fix round 1/5 dispatched (resume implementer ae863174a9abeb9a5), FIX_BASE=f0fa60d
Task 17: fix round 1/5 implemented (054ece9; full 3285/3284/0/1 todo); scoped opus re-review dispatched
Task 17: fix round 1/5 (1 addressed, 0 open; commits f0fa60d..054ece9); out-of-scope: controller.js:604-605 dead after fix; pipe reset to null doesn't abort in-flight check (blocked by current())
Task 17: complete (commits eaa9122..054ece9, review clean after 1 fix round; Critical claim-gate race fixed)
Task 18: dispatched (opus implementer; warned: build on HEAD controller.js, don't overwrite 054ece9 fix), BASE=054ece9
Task 18: implementer DONE_WITH_CONCERNS (5a71a2b; full 3307/3306/0/1 todo; deviations: navScope dropped on cross-group whole-list step; onModelLeft uses labels.reset()+rebuild instead of forgetModel — both with new failing-first tests; brief tests 17-19 pass pre-implementation); opus review dispatched
Task 18: minor (deferred): navScope stale label after group-mode→none/scope filtered out (self-corrects next step; clear in onGroupMode or gate suffix on grouped view); label index reset+rebuild on every model-left event (PG-3 item; brief-version never refreshed); brief tests 17/18 fireModelLeft ingredient vacuous (test 11 pins behavior); dead abort/detach lines at controller.js startFreshnessCheck (post-054ece9). CARRY TO T22-T26: AC-P16 test — clear() issued during an in-flight present() must leave none of that present's resources; bridge must leave newest surviving token's resources (or none).
Task 18: complete (commits 054ece9..5a71a2b, review clean; 2 deviations w/ failing-first tests accepted)
Task 19: dispatched (opus implementer), BASE=5a71a2b
Task 19: implementer DONE_WITH_CONCERNS (7c0b231; full 3325/3324/0/1 todo; 2 brief tests can't fail (same-function compare); deviations: ViewInput comment lists extra fields; 'details' as one-line insert not paste); review dispatched
Task 19: minor (deferred): viewModel.test.mjs:142 AC-P2 matrix expected uses same runHeadline() as builder (self-referential, plan-mandated; literals pinned in runReport.test); :266 statusLive self-referential (not vacuous); error-banner/filtered!==total branches only via hand-built run
Task 19: complete (commits 5a71a2b..7c0b231, review clean)
Tier [A] (T1–T19) done; next T20 (real-engine contract test), T21 (large-result bounds)
Task 20: dispatched (sonnet), BASE=7c0b231
Task 20: implementer DONE (e2ec2cd; full 3338/3337/0/1 todo; test-only, negative control run); review dispatched
Task 20: minor (deferred): test 13 AC-P9 tautological compare (pinned by literals in runReport.test + test 3); test 11 RF-3 doneKind only membership; test 12 title claims same definitionKey/revision but asserts resultId equality only; STATEMENTS.CLAIM pinned by reference; spied() hands full registry (controller narrows); no try/finally around controller.dispose; constraint-8 superseded-run late done not exercised against real engine
Task 20: complete (commits 7c0b231..e2ec2cd, review clean)
Task 21: dispatched (sonnet), BASE=e2ec2cd
Task 21: implementer DONE (8c11d9d; full 3344/3343/0/1 todo; test-only; mutation-controlled slicing tests); review dispatched
Task 21: minor (deferred): largeResults.test.mjs:126-138 test 6 title overclaims ('entries produced per page only' — only page length/first canonicalIndex asserted); :89 test 3 loose upper bound (<2*(slices-1)); tests 1,4,5,6 have no mutation control
Task 21: complete (commits e2ec2cd..8c11d9d, review clean)
TIER [A] COMPLETE (T1–T21). Suite: 3344 total / 3343 pass / 0 fail / 1 todo at 8c11d9d. Next: bridge track T22–T26 (T25 restates T22's queue/listener registry/validateRequest — build on HEAD).
Task 22: dispatched (sonnet), BASE=8c11d9d
Task 22: implementer DONE (83436e1; full 3355/3354/0/1 todo; C-1 applied; AC-P16 resource pin deferred to T25); review dispatched
Task 22: minor (deferred; T25/T26 pointers): 'throwing Viewer call' test never exercises present() catch fallback (sceneModels has local try/catch) — T25 should pin the fallback; missing tests: dispose during in-flight present, dispose invalidates mid-flight token, removeAll returns errors, malformed request doesn't invalidate in-flight; ViewerBridge.js:146-148 dispose discards removeAll() errors (T26 adds listeners → surface errors); disposed check precedes validation (document in T25); fakeViewer.onCall doesn't validate method name (typo silently never fires); viewerFaults.addForeignMesh clears callLog; AC-P16 resource-survival pin MUST be added in T25
Task 22: complete (commits 8c11d9d..83436e1, review clean)
Task 23: dispatched (sonnet), BASE=83436e1
Task 23: implementer DONE (6891603; full 3365/3364/0/1 todo; test 1 self-check can't fail on markers.js); review dispatched
Task 23: minor (deferred): markers.js:125-129 lineThrough adds geometry to perObject before Line ctor (leak if ctor throws); :191-211 disposeShared try/finally without catch (partial dispose failure leaves shared set); :259-271 ensureShared ctor throw leaks earlier objects; :217-221 validBox accepts zero-size box (invisible outline); :203-209 removeScene even if foreign mesh added to that scene; test 1 harness self-check belongs in support tests; no test for 12 edges / color index when side omitted / beforeScene throw
Task 23: complete (commits 83436e1..6891603, review clean)
Task 24: dispatched (sonnet), BASE=6891603
Task 24: implementer DONE (a96e24a; full 3379/3378/0/1 todo); review dispatched
Task 24: minor (deferred): isolation.js:119/132-134 prevTarget mechanism unproven by brief tests (add: replacement apply throws before state change then restore()→'restored'); :184 restore({beforeMutation}) throw path untested; :164-165 restoreTo equals-pre-image-after-throw branch untested; :182 confirmed record already back at pre-image reports skipped-external not none (design nuance for T25)
Task 24: complete (commits 6891603..a96e24a, review clean)
Task 25: dispatched (opus implementer; carry-forward AC-P16 etc.), BASE=a96e24a
Task 25: implementer DONE_WITH_CONCERNS (af047b2; full 3545/3544/0/1 todo; 137-case matrix, 7 carry-forward tests added, kept T22 names TypeError guard); opus review dispatched
Task 25: review (af9d224de4a4a3392, opus) = IMPORTANT (plan-code defect): ViewerBridge.js release step skips guarded restore when the present will isolate; if isolation.apply then returns applied:false, previous token's isolation stays on screen under new markers while outcome says isolated:false (probe: A isolates m1:[1]; B isolate:true with one getAggregateIsolation fault → viewer still [{m1,[1]}]); related: non-isolating path discards restore() failed/skipped-external notes. Ruling: fix in T25 — guarded restore after non-applied apply (if owns()), push restore notes; tests for both apply-fault kinds + non-isolating restore-note — breaks AC-P16 'newest surviving token's resources or none'; costs a small deviation from brief code.
Task 25: minor (deferred; FINAL REVIEW triage): ViewerBridge.js:805-808 stale present whose Viewer call throws reports superseded:false (inner catch only Superseded; use `|| !isLive(t)`; controller drops by viewerSeq so no wrong state); presentationMatrix.test.mjs:470 'only newest token's meshes' vacuous outside present-then-present, and some steps reach final state via the later clear alone (carry-forward sweep covers); :736 inspectLedger null while isolation record still held; :846-861 dispose discards removeAll() errors and releaseHeld() result (T26 to surface); mid-file import in transaction test (:319); stale 'aggregate form' comment until T26; T22 names TypeError guard kept (deviation, safe)
Task 25: fix round 1/5 dispatched (resume implementer a929450d7d9105c36), FIX_BASE=af047b2
Task 25: fix round 1/5 implemented (c4f76b6; full 3547/3546/0/1 todo; skipped-external gives no note — isolation.js unchanged); scoped opus re-review dispatched
Task 25: fix round 1/5 (1 addressed, 0 open; commits af047b2..c4f76b6); out-of-scope: releaseHeld unguarded restore for stale token by design; apply doesn't re-check §9.5 prerequisite when ownership continues (pre-existing); skipped-external restore has no note (isolation.js UX gap; outcome states nothing false)
Task 25: complete (commits a96e24a..c4f76b6, review clean after 1 fix round)
Task 26: dispatched (opus implementer), BASE=c4f76b6
Task 26: implementer DONE_WITH_CONCERNS (4971e42; full 3572/3571/0/1 todo; deviations: dispose keeps removeAll errors+cleanup notes via new inspectDisposal() (carry-forward), +2 tests; readAggregateSelection frozen [] on failure); opus review dispatched
Task 26: minor (deferred; FINAL REVIEW triage): ViewerBridge.js ~267-275 subscribeOnce sets subscribed=true before both adds (partial subscription if 2nd addEventListener throws; controller.js:70-71 catalog.onChange disposer leaks if bridge.onModelLeft throws during construction — pre-existing controller-side); relay delivers model-left events between dispose() call and queued dispose task (add `if (disposed) return`); inspectDisposal() reports disposed:true/empty before dispose task ran (add settled flag); hasAggregateFit presence-only (G2/PG-1); 2 tests exercise only the fake (plan-mandated); 'The panel is closed' inline literal; static layering test scans only clashpanel/viewer/ (repo-wide grep clean)
Task 26: complete (commits c4f76b6..4971e42, review clean; deviations: dispose surfaces errors via inspectDisposal, readAggregateSelection frozen [])
TIER [B-bridge] COMPLETE (T22–T26). Suite at 4971e42: 3572 total / 3571 pass / 0 fail / 1 todo. Next: UI track T27–T33 (T27 wires default gate `npm test` = offline + DOM; needs Playwright Chromium).
Task 27: dispatched (sonnet; Chromium present), BASE=4971e42
Task 27: implementer DONE (95bcea9; npm test exit 0: offline 3579/3578/0/1 todo + DOM 7/7; negative controls run); review dispatched
Task 27: minor (deferred): run-dom-tests.mjs:98 LAUNCH_ARGS duplicated literal vs harness.mjs (drift risk); runner passes if a *.dom.mjs has zero test() calls; harness.dom.mjs:246 %2e%2e case normalised by browser (Node-side resolveServedPath test covers decode path); domIsolation `invoked` doesn't parse `npm --silent test`/`-s` or implicit pre/posttest hooks; README 'fake Viewer/engine/catalog' wording accurate only from T28; harness mountRenderer/rerender/intents/snapshot + mount.mjs untested until T28
Task 27: complete (commits 4971e42..95bcea9, review clean). npm test now = offline + DOM (verified by implementer: exit 0, two '# tests' lines)
Task 28: dispatched (sonnet), BASE=95bcea9
Task 28: implementer DONE_WITH_CONCERNS (6bad6eb; npm test exit 0: offline 3579/3578/0/1 todo + DOM 28/28; C-2 applied + 1 extra test); review dispatched
Task 28: minor (deferred; FINAL REVIEW triage): no renderer-level hostile-text test for setup/run (HOSTILE/HOSTILE2 fixtures unused; T30 owns hostile-text — check it covers setup+run regions too); ui/dom.js:42-44 `props` bypasses on*/innerHTML guard (belt-and-braces); focus dropped to body when focused button becomes disabled (Run click) — T31 polish; dispatch rejections unhandled (no shared .catch); copyDiagnostics result silent; a11y polish (aria-describedby/role=alert on clearance error; duplicate validation listing; model state text outside label); unitsEvaluated/unitsTotal/resultsFound unguarded ('undefined'); run.dom.mjs Copy-null-reply uses setTimeout(0) barrier, no run-region idempotency snapshot; no 'Save' control in T28 brief (accepted UX region 1 mentions Run/Save?) — verify against spec at final review; long-name/host-reason wrapping is CSS (no CSS in T28) → T30/T31
Task 28: complete (commits 95bcea9..6bad6eb, review clean; C-2 applied)
Task 29: dispatched (sonnet), BASE=6bad6eb
Task 29: implementer DONE_WITH_CONCERNS (249407c; npm test exit 0: offline 3579/3578/0/1 todo + DOM 43/43 (brief said 42, actual 28+15); 2 weak assertions kept verbatim); review dispatched
Task 29: minor (deferred; FINAL REVIEW triage + T30/T31 a11y pointers): results.js:416 li[role=presentation] wrapping interactive group-header button inside role=listbox (invalid ARIA required-children; plan-mandated; a11y polish); :406 aria-label on plain span ignored; :409 badges run together for SR; :428-456 focus lost when focused Prev/Next becomes disabled (untested; same as T28 Run-button); all rows tabindex=0 (no roving tabindex/arrow keys; plan-mandated); filters.js:334-336 max-gap bound shown without unit + error not aria-describedby; :303-304 select.value for absent option → blank; tests: doesNotMatch(/^No clashes$/) unfailable (AC-P2 covered at VM level), bounded-DOM test near-tautological (controller slices), no scroll-preservation assertion; brief text says DOM 42 (actual 43 — plan off-by-one, T30+ counts shift by +1)
Task 29: complete (commits 6bad6eb..249407c, review clean)
Task 30: dispatched (sonnet), BASE=249407c
Task 30: implementer DONE_WITH_CONCERNS (f21538f; npm test exit 0: offline 3579/3578/0/1 todo + DOM 57/57; brief code verbatim; ARIA listbox issue + focus-to-body untouched; PANEL_CSS overflow-x hidden on root); review dispatched
Task 30: minor (deferred; FINAL REVIEW triage): results list ARIA invalid (T29 code; plan-mandated; panel.dom.mjs pins li[data-key] role=option; least-churn fix = role=tree/treeitem or move group toggles out of listbox — decision at final review); long names inside <select> (closed native select can't wrap; suffix hidden; add title = selected label); repeated visible reason x3 when no model live; Focus visible-reason untested (title only); keyboard test skips <summary>; implementer concern 3 (overflow-x hidden) judged incorrect/harmless by reviewer
Task 30: complete (commits 249407c..f21538f, review clean). DOM suite 57/57.
Task 31: dispatched (sonnet implementer; opus review planned), BASE=f21538f
Task 31: implementer DONE (97805af; npm test exit 0: offline 3579/3578/0/1 todo + DOM 66/66; implementer wrote impl before RED then moved aside); opus review dispatched
Task 31: minor (deferred; FINAL REVIEW triage): ClashDockingPanel.js:111-120 dispose can throw (unsubscribe error escapes) and has no fallback container removal if uninitialize() throws partway; :77-80 visibility listener dispatch without .catch (unhandled rejection / sync throw through setVisible); shell.dom.mjs:347 `listeners: 0` assertions check nothing (plan-mandated); :98-102 rollback sweep removes ANY child appended during construction (G2); impl written before RED (process, informational)
G2 ASSUMPTIONS (T31 reviewer; for handoff — none verified live): base DockingPanel ctor order create→append→initialize()→setVisible(false); initialize() fully replaced (assumes base ctor builds no title bar/close/footer/resizer outside initialize(); shell doesn't check for existing .docking-panel-title; passes {} options); createTitleBar/createCloseButton/initializeMoveHandlers exist with stub signatures; live CSS class names may differ; setVisible(bool) fires callbacks every call with the boolean even when unchanged (test expects redundant panel/hidden after close click); addVisibilityListener has no remove counterpart; live instance own-property names differ from stub allow-list; uninitialize() removes container and doesn't throw on first call; live ctor appends only its own container to parentContainer synchronously; this.titleLabel holds title when initialize() runs; live uninitialize() cleans up initializeMoveHandlers handlers.
Task 31: complete (commits f21538f..97805af, review clean). DOM suite 66/66.
Task 32: dispatched (opus implementer), BASE=97805af
Task 32: implementer DONE_WITH_CONCERNS (5d02623; npm test exit 0: offline 3579/3578/0/1 todo + DOM 76/76; C-3 applied; README accuracy edits vs brief text; scaffold now 36 modules); opus review dispatched
Task 32: minor (deferred; FINAL REVIEW triage): index.js:37-39 id validated after createViewerApi (order only); rollback `.catch(()=>{})` drops teardown errors on failed construction (could attach as error.cause); Autodesk injected through index.js to shell (allowed by T1 index-subtree rule; log only); composition.dom.mjs E2E Copy diagnostics asserts only non-null JSON object; no test for failing bridge.dispose() inside createClashPanel.dispose; bridge.dispose() called twice on normal path (idempotent); README accuracy edits vs brief verified factual (gates by plan ids, no SVF2/production claims)
Task 32: complete (commits 97805af..5d02623, review clean; C-3 applied; scaffold = 36 modules; DOM 76/76)
ALL T1–T32 COMPLETE. Next: T33 verification gate + final whole-branch review (parallel opus reviewers by area), then handoff + review/status artifacts. BASE0=a0134bb for scope checks.
FINAL WHOLE-BRANCH REVIEW: 3 parallel opus reviewers dispatched (A core, B bridge, C ui/docs/scope) over BASE0 a0134bb..HEAD 5d02623; reports final-review-{A-core,B-bridge,C-ui-docs-scope}.md
Final review C (a57091da3e4ae87fb): 0 Critical/0 High/2 Medium (1 MUST-FIX C-M1: panel.dispose() promises AggregateError incl. bridge teardown failures but bridge.dispose() always resolves undefined; failures only in inspectDisposal() — fold into AggregateError + composition test, or correct docs; 1 RECORD C-R1 results-list ARIA)/10 Low RECORD. All T33 scope checks PASS (status empty; no out-of-scope paths; frozen docs/paths untouched; package.json exactly 1 edited + 2 added lines). C-R7: copy T31 G2 assumptions into handoff. DOM suite actual 76 (plan says 75).
Final review A (a0695937552b70a61): 0 Critical/0 High/2 Medium/5 Low/1 Info. MUST-FIX A-1 (Medium): a stuck release of the Panel's own result set blocks Run permanently and error blames 'other runs' — controller.js:296 mapAdmissionError only checks displayed set's runId; residency.js:122-126 stuck entry leaves held (retried only by release()/disposeAll()); reproduced with capacity:1 harness; breaks spec §7.6 (offer release-and-retry when capacity error is caused by Panel's own set) — fix: expose stuck runIds from residency, treat any Panel-owned runId among blockers as own set (existing onReleaseAndRetry retries stuck release before startRun) + test capacity 1 with stuck lease. RECORD: A-6 dispose never reports droppedUnsaved (spec §7.6; shape plan-mandated); T11 claim-gate hardening minors (4) — RECORD (need Core value outside published contract; optional single validation at commit point controller.js:640/:644); Low A-2..A-5; Info A-7. All T1-T21 deferred minors: none MUST-FIX.
Final review B (a0eccac2d96e4cba1, incl. an independent codex-advisor confirmation): 0 Critical/1 High/2 Medium/16 Low. MUST-FIX B-1 (High): after a model leaves the scene the Panel's own isolation is stranded — isolation.js:101 ours() and :160-165 restore() compare current isolation against a target still including the departed model → clear() returns 'skipped-external', viewer stays [{m1,[1]}], record dropped, next isolating present records the leftover as its pre-image; breaks spec §9.6 last row + AC-P6; test gap: ViewerBridge.transaction.test.mjs:208-211 fires unload event but never removes the model. Fix: compare current/target/prevTarget/saved prior only for models still in ONE successful getAllModels() read; read failure ⇒ 'failed' + keep record; current==saved prior ⇒ no write; restore only prior part for still-loaded models; any diff on a still-loaded model stays foreign/skipped; never clear-all; same comparison at isolation.js:114 in apply(); regression tests removeModel() then awaited clear() for single- and two-model cases. RECORD: B-2 (Medium) dispose isolation-restore failure only reaches inspectDisposal() → createClashPanel.dispose resolves cleanly (same root as C-M1 → fold into AggregateError); B-3 (Medium) owned session never re-checks user-hidden nodes (spec-allowed; G2 residual); B-8 controller.js:70-71 disposer leak if bridge.onModelLeft throws in construction; rest triaged in final-review-B-bridge.md.
FINAL-REVIEW MUST-FIX SET (ONE fix dispatch): A-1 (controller.js:296/residency.js:122-126 stuck own-set release blocks Run), B-1 (isolation.js departed-model comparison), C-M1/B-2 (createClashPanel.dispose must fold ViewerBridge inspectDisposal() listener errors + failed isolation restore notes into the AggregateError; add composition DOM test). Ruling: fix all three in ONE fix wave (skill: one fix dispatch, one scoped re-review, no second wave); all others RECORD in handoff. Costs: 3 small deviations in reviewed modules; extra tests.
Final fix wave dispatched (opus, ONE dispatch: A-1, B-1, C-M1), BASE=5d02623
Final fix wave DONE (50b0ac0 A-1, 9f3bcb1 B-1, d381e58 C-M1; npm test exit 0: offline 3587/…/0 fail/1 todo (+8), DOM 77 (+1)); scoped opus re-review dispatched
Final fix wave re-review (a5211b10a72ef5879, opus): A-1, B-1, C-M1/B-2 ALL ADDRESSED; no new Critical/High/Medium; out-of-scope Low: B-1 degenerate projection (all Panel-target models departed + user 'show all' before clear → restores original prior; G2), spurious dispose error when REMOVE_FAILED later succeeds, markers.removeAll/disposeShared throws still swallowed in bridge.dispose, ViewerBridge.js:115-117 comment overclaim. Reviewer ran npm test: offline 3587/3586/0 fail/1 todo; DOM 77/77.
T33 gate PASS at d381e58: scaffold 2/2; npm test exit 0: offline 3587/3586 pass/0 fail/1 todo + DOM 77/77, exactly two '# tests' lines; git status empty; no out-of-scope paths; frozen docs/paths untouched; package.json exactly 1 edited + 2 added lines; README markers 1/1; no innerHTML/theming/viewer.impl/Private./isOTG in clashpanel; 36 clashpanel .js modules; 39 commits BASE0..HEAD each with exact trailer, 0 Claude-Session; owner stashes (2) intact; T33 negative controls NOT re-run by controller (T27 implementer ran PLAYWRIGHT_BROWSERS_PATH and false-DOM-assertion controls)
```
