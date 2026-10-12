# CTM-8 Rebuild-Cost Calibration Protocol (P0, remediated)

Protocol version: **CTM8-P0-v4** — the post-v3-targeted-review corrected protocol. It supersedes `CTM8-P0-v3` (which failed the [P0-v3 targeted Independent Work Review](../reviews/2026-10-12-ctm-8-p0-v3-targeted-independent-work-review.md): FAIL — 0 Critical / 2 High / 2 Medium / 5 Low: H-01 Family R `n_models=3` element-name contract not executable, H-02 Family M subscriber attached before the fixture build, M-01 M-BASE timing window under-specified, M-02 Family M model-axis cost prose; the 5 Low items are deferred except where they sit in a corrected paragraph), `CTM8-P0-v2` (which failed the [P0 v2 targeted Independent Work Review](../reviews/2026-10-11-ctm-8-p0-v2-targeted-independent-work-review.md): FAIL — 0 Critical / 2 High / 1 Medium: H-01 mandatory scope vs. final owner decision, H-02 inexact Family M fixture, M-01 falsely open owner decisions) and `CTM8-P0-v1` (failed the [P0 Independent Work Review](../reviews/2026-10-11-ctm-8-p0-calibration-protocol-independent-work-review.md): FAIL — 0 Critical / 5 High / 3 Medium / 1 Low) · Date: 2026-10-11 · Status: **design only — no measurement has been run, no harness exists, nothing here is evidence. CTM-8 execution is not authorized.**
Governing: spec gate table (`docs/superpowers/specs/2026-09-26-viewer-clash-panel-design.md` :986, PD-14, AC-P11) · plan G-PERF (`docs/superpowers/plans/2026-10-10-clash-tests-manager-implementation-plan.md` :4675, :4678) · [CTM-8 entry review](../reviews/2026-10-11-ctm-8-entry-gate-independent-work-review.md) · owner P0 authorization ([prompt](../prompts/ctm-8-p0-calibration-protocol-design-prompt.md)) · owner remediation authorization and decisions ([prompt](../prompts/ctm-8-p0-docs-only-remediation-prompt.md)) · owner v2 correction authorization and final decisions ([prompt](../prompts/ctm8-p0-v2-bounded-docs-only-correction-prompt.md)).
Baseline checkpoint: `main` == `origin/main` == `ac5bcb42b00e668442ce3add9764cba96d883309`.

This document is the single P0 protocol. Revision history is limited to the version line above, the [remediation final report](2026-10-11-ctm-8-p0-calibration-protocol-remediation-final-report.md) (v2, historical) the [v2 correction final report](2026-10-11-ctm-8-p0-v2-correction-final-report.md) (v3, historical) and the [v4 correction final report](2026-10-12-ctm-8-p0-v4-correction-final-report.md) (v4).

## 1. Purpose and non-goals

CTM-8 is a **rebuild-cost calibration gate**: empirical, controlled measurement of Clash Tests Manager and Viewer Clash Panel rebuild and interaction costs across exploratory scale points. Its output is a set of *observations* plus a recommendation on what review/decision comes next.

This protocol and its later execution **do not**: define a supported test-record, clash-result or model limit; define a frame-time budget; define a pass/fail threshold; claim scalability or production readiness at any scale; modify production code; remediate any deferred finding. Presentation constants (`clashpanel/core/constants.js`: `PAGE_SIZE=50`, `FILTER_DEBOUNCE_MS=150`, `LIST_CHUNK_SIZE=2000`, `LABEL_CACHE_MAX=5000`, …) remain provisional and uncalibrated (PD-14, AC-P11); the execution report must not describe them as calibrated or approved, and the harness must not assert wall-clock against them.

**Primary vs corroborating evidence.** The primary scaling curves come from the repeatable **headless** campaign (§4–§8). **Headed** runs (§9) corroborate real-product behavior and responsiveness at practical points; they never replace headless calibration and are not required to cover the full headless matrix.

## 2. Terminology and owner decisions (final for this protocol)

The repository has two distinct populations; they are never pooled and never share an unlabeled axis. Every evidence field and table column uses the explicit names below.

| Name | Meaning | Values |
| --- | --- | --- |
| `M.N_tests` | Family M: number of **manager test-records** (`clashpanel/core/testsManager.js`) | 100 · 1,000 · 5,000 · 10,000 |
| `R.N_results` | Family R: number of **clash-result records** in the active sealed result set (`clashpanel/core/controller.js`) | 100 · 1,000 · 5,000 · 10,000 |
| `n_models` | models: Family M = models **referenced by every test-record** (Set A ∪ Set B); the harness catalog holds 2 / 2 / 3 models for `n_models` = 1 / 2 / 3 and is not itself the axis (§6.1); Family R = distinct models participating in the result set | 1 · 2 · 3 |

Owner decisions applied (from the remediation authorization; not reinterpreted):

- **Both families.** Family M measures manager test-record rebuild behavior (the original CTM-8 gate wording: manager ViewModel rebuild). Family R measures active sealed-set clash-result behavior: baseline rebuild, selected-group path, cold-label path, warm-label path. Both use the full exploratory headless 4 × 3 matrix for their mandatory scenarios (§4).
- **`-PULL` variants are excluded from the mandatory campaign.** They may be documented only as optional follow-up refinements (§4.3). They appear in no cell count, required execution, acceptance language or headed coverage.
- **Repetition / launch policy:** 3 independent process launches; **30** measured repetitions for warm scenarios; **15** for cold scenarios.
- **Observability boundary:** only public-observable, sentinel-based cold/warm classification (§7.3). No private controller state, no test-only label-index observation seam, no production observation hook. Consequently the exact **label-index commit sub-phase is UNAVAILABLE**; `R-COLD total` remains valid (§8).
- **Headed reachability:** practical real-product corroboration points only; unreachable points are recorded, never forced with synthetic data (§9.2).

## 3. Measurement questions (not pre-answered)

Q1 How does rebuild cost change with `M.N_tests` / `R.N_results`? Q2 With `n_models`? Q3 Is the observed curve approximately linear, superlinear, or does it show a visible knee over the tested range? Q4 What is the cost difference between the cold-label and warm-label paths? Q5 What is the incremental cost of selected-group state? Q6 Does headed Viewer responsiveness materially diverge from headless measurement? Q7 Does any scenario produce a visible UI stall, delayed presentation, or inconsistent state transition?

Note on Q6: headed timings exclude Viewer-side presentation work (§9.4), so Q6 is answered from headed UI-render timings, long-task observations and Viewer correctness checks, not from a Viewer-inclusive duration.

## 4. Frozen mandatory campaign (headless)

### 4.1 Mandatory scenarios

All mandatory scenarios run across the full 4 × 3 grid (4 scale points × 3 model counts = 12 points). Reduction is allowed only where a point is **infeasible**; it is then recorded `NOT EXECUTED — reason`, never omitted, and the cell still counts toward the mandatory total.

| Family | Scenario | Kind | Fixture profile | Cells |
| --- | --- | --- | --- | --- |
| M | M-BASE (catalog-epoch rebuild) | warm | 1 | 12 |
| M | M-REC (single test-record edit rebuild, incl. forwarded editor work) | warm | 1 | 12 |
| M | M-HIT (cached-read control) | warm | 1 | 12 |
| R | R-BASE (sort rebuild, element grouping, no selection) | warm | UNIFORM only | 12 |
| R | R-WARM (warm-label text filter change) | warm | UNIFORM only | 12 |
| R | R-GROUP-WARM (R-WARM with the primary selected group; primary paired comparator vs R-WARM) | warm | UNIFORM only | 12 |
| R | R-COLD (cold-label total) | **cold** | UNIFORM only | 12 |

**Fixture profile (closed owner decision).** Mandatory Family R is **UNIFORM only**. SKEWED is an optional targeted refinement only (§4.3): it appears in no mandatory cell count, required execution, acceptance/completeness denominator or headed mandatory scope. Family M has a single fixture (§6.1).

### 4.2 Exact mandatory campaign size (computed)

- Scenario cells per launch: Family M 3 scenarios × 4 `M.N_tests` points × 3 `n_models` points = **36**; Family R 4 scenarios × 4 `R.N_results` points × 3 `n_models` points × 1 profile (UNIFORM) = **48**; total **84** (warm cells: M 36 + R 36 = **72**; cold cells: R-COLD **12**).
- Launches: **3** → cell executions **252** (M 108 + R 144).
- Measured samples per launch: warm 72 × 30 = 2,160; cold 12 × 15 = 180; **2,340** (M 1,080 + R-warm 1,080 + R-cold 180). Over 3 launches: warm 6,480 + cold 540 = **7,020** measured samples (cold fresh generations: 12 × 15 × 3 = 540).
- Warm-up iterations (excluded from statistics, recorded): warm cells 5 each → 72 × 5 = 360 per launch; cold cells 0. Over 3 launches: **1,080**.
- Total timed-or-warm-up operations: 7,020 + 1,080 = **8,100** (2,700 per launch).
- The campaign size is frozen here (all methodology choices are closed owner decisions, §18); the execution package may not reduce or extend it without a separately recorded owner decision. Added points are allowed only under the §4.4 refinement rule and are labelled and excluded from the mandatory counts.

### 4.3 Optional refinements (not mandatory; not counted; not executed unless the owner later adds them)

the **SKEWED** fixture profile for any Family R scenario (targeted refinement; definition retained in §6.2; requires separate owner authorization and is excluded from current mandatory completeness criteria); R-FLAT (flat-grouping sort, grouping-mode observation only); R-GROUP (R-BASE sort with the primary group selected; pairs with R-BASE); an unpaired **R-GROUP-MEMBERSHIP** scenario (membership-changing selected-group behavior, defined only if later authorized; never mixed into the primary paired delta, §5.2); `-PULL` variants (R-BASE/R-WARM/R-COLD/R-GROUP-WARM/M-BASE pull-only, no subscriber); a Family-M variant where the catalog is larger than the set of models each test-record references (e.g. catalog of 3, every test-record referencing one model); **M-REC-MGRONLY** (manager-only invalidation without forwarded editor work), which is **UNAVAILABLE** — no public behavior expresses it and no seam is authorized (§5.1).

### 4.4 Refinement rule

The execution package may add intermediate or larger points only if a measured knee justifies it, recording the reason; added points are labelled `refinement` and never merged into mandatory summaries.

## 5. Scenario contracts (normative)

Every scenario runs under one fixed fixture per cell (§6; Family R mandatory = UNIFORM) and the primary subscribed topology (§7.2). Operation under test is exercised through the real manager/controller public surface with fake ports.

### 5.1 Family M (manager test-records) — over the real controller

Family M is built on the integration route validated by `test/clashpanel/core/testsManager.integration.test.mjs` (`setup(opts)`, lines 14–27, and the local helper `selectAB`, lines 28–31): `makeHarness({extraModels})` (real controller, `test/clashpanel/support/controllerHarness.mjs`) wrapped by `createTestsManager`, with `mintId` returning `new-1`, `new-2`, …, and every intent sent as `m.do(intent)` = `await manager.dispatch(intent)` then `await h.settle()`. The `fakeEditor.mjs` editor is **not** used because its `dispatch` treats `INTENT.SETUP_NAME` as a no-op. `selectAB` toggles only A=`mA`, B=`mB`; it is **not** the fixture contract — §6.1 is. Intents use the exported constants (`MANAGER_INTENT.CREATE` = `manager/create`, `OPEN` = `manager/open`, `VIEW_LIST` = `manager/viewList`; `INTENT.SETUP_NAME` = `setup/name`, `INTENT.SETUP_TOGGLE_MODEL` = `setup/toggleModel`).

Common M fixture state (untimed), built **once per cell per launch** by the exact §6.1 sequence on a fresh harness: the catalog contains the harness models `mA` "Architecture" and `mB` "Structure" plus, for `n_models = 3` only, `mC` "Mechanical" (`extraModels`); all `loaded: true` and bound (the harness cannot omit `mB`, so for `n_models = 1` it is present but unreferenced); `M.N_tests` test-records exist; all derived caches warm; one no-op manager subscriber attached **only after** the §6.1 build, predicates and untimed settle (§6.1 Step 3b) and before any warm-up; manager view = list (`MANAGER_INTENT.VIEW_LIST` dispatched at the end of §6.1; verified via `manager.getViewModel().manager.view`), except M-REC, which opens its target (editor view) in its untimed setup.

| ID | Pre-state | Untimed setup | Timed mutation (exact) | Completion predicate | Reset |
| --- | --- | --- | --- | --- | --- |
| **M-BASE** | common; `catalog.displayNameFor('mA') === 'Architecture'`; `manager.tests[0].setA === 'Architecture'` and `manager.tests[M.N_tests−1].setA === 'Architecture'` | record `c0 = catalog.calls.list` and `s0` = subscriber notification count; call `catalog.addModel({modelKey:'mA', displayName:'Architecture-R', model: catalog.modelOf('mA'), loaded:true})` (replaces the entry; **fires nothing** — fakeCatalog mutators do not notify); no await between this call and `t0` is required, but the fixture must be quiescent (see Reset) | **fully synchronous window, no `await` between `t0` and `t1`:** `t0 = performance.now()`; `catalog.fire()` (runs every catalog listener synchronously in registration order: first the real controller's `onCatalogChange`, then the manager's `onCatalogChange` → `invalidate` → `catalogEpoch += 1` → `changed`); `vm = manager.getViewModel()`; evaluate the completion predicate synchronously on `vm`; `t1 = performance.now()` | evaluated synchronously on `vm`: `vm.manager.tests[0].setA === 'Architecture-R'` **and** `vm.manager.tests[M.N_tests−1].setA === 'Architecture-R'` **and** `catalog.calls.list > c0`. If it does not hold synchronously the sample is `INVALID` (recorded; the harness never waits or retries inside the window). | untimed, in this order: `addModel` with `displayName:'Architecture'`; `fire()`; `getViewModel()`; verify `setA === 'Architecture'` on tests[0] and tests[M.N_tests−1]; then the **drain** below |
| **M-REC** | common; target `k = floor(M.N_tests / 2)` (0-based index into `manager.tests`; `k` = 50 / 500 / 2,500 / 5,000), `idK = tests[k].testId`, `nameK = 'CTM8-M-<M.N_tests>-<n_models>-<k+1>'` (the §6.1 name of that test-record); every test-record's Set A = `[mA]` | `dispatch({type: MANAGER_INTENT.OPEN, testId: idK})` (no confirmation is expected in this fixture, §6.1; if `vm.confirm !== null` appears the sample is `INVALID_SETUP`); verify `manager.activeTestId === idK`; `dispatch({type: INTENT.SETUP_NAME, value: '<nameK>-A'})`; settle; verify `tests[k].name === '<nameK>-A'` | `t0`; `dispatch({type: INTENT.SETUP_NAME, value: '<nameK>-B'})` (forwarded by the manager to the active real editor → `applySetup` → notification → `syncFrom` → `recordsVersion += 1`); `await until(predicate)`; `getViewModel()`; `t1` | `tests[k].name === '<nameK>-B'` **and** `tests[k].testId === idK` **and** `manager.activeTestId === idK` **and** `manager.count === M.N_tests` | untimed: `SETUP_NAME` `'<nameK>-A'`, settle, verify |
| **M-HIT** | derived cache warm (no pending epoch/version change); two consecutive `getViewModel()` calls return the **same frozen object** (`===`) | none | **no trigger.** One sample = one batch: `t0`; 1,000 consecutive `manager.getViewModel()` calls; `t1`. Recorded: raw batch duration and `duration / 1000` per call | the final call returned an object `===` the previous one | none |

Statements required by the contract:

- **M-REC measured workload (intentional).** M-REC includes the forwarded **editor work** (real controller `applySetup` = draft reduce + revalidate + notify) **together with** manager-side `syncFrom` and the manager-side recomputation and subscribed ViewModel rebuild that the `recordsVersion` bump forces over all `M.N_tests` test-records (derived-data recompute and ViewModel build are not separately measurable, §11). It is an end-to-end single-test-record edit through the public surface, not a manager-only measurement. A manager-only invalidation cannot be expressed with existing public behavior (no manager intent edits a non-active test-record's draft); that narrower variant is **UNAVAILABLE** unless a future owner authorization adds a test-only seam.
- M-BASE changes **catalog content** (a display name), not load state or catalog membership; the choice of object, values, API and payload is frozen above and may not be varied by an implementation.
- M-HIT's batch design exists only because one cached read is below timer resolution; it is a control and expected near-zero.
- **M-BASE window (exact; v4).** Included: every **synchronous** effect of `catalog.fire()` — the real controller's catalog listener (label invalidation, readiness revalidation, the synchronous start of its forced soft re-evaluation, its notification to subscribers/editor-sync into the manager) **and** the manager's listener (epoch bump, `changed`, the subscribed ViewModel rebuild(s) that those synchronous notifications trigger) — plus the final `manager.getViewModel()` read. Excluded: any **asynchronous continuation** (the controller soft re-evaluation's later notifications and any microtask/macrotask that runs after `t1`). Because no `await` occurs between `t0` and `t1`, no async continuation can execute inside the window; this makes the boundary independent of `n_models` (the soft re-evaluation's continuation differs by `n` but is excluded for every `n`). Observed from source: the new display name is visible on `manager.getViewModel()` synchronously once `fire()` returns (the epoch bump is synchronous, `fakeCatalog.addModel` has already updated `displayNameFor`). `catalog.calls.list` delta is an informational covariate only (it is not a recompute counter); the subscriber notification count inside the window (`notif_in_window` = count at `t1` − `s0`) is recorded, and the count of notifications that arrive during the drain (`notif_after_window`) is recorded separately as an informational covariate.
- **Drain / quiescence (untimed; applies before every M-BASE sample and after every M-BASE reset).** After the post-`t1` recording and after the reset's `fire()`+verify: `await h.settle()`, then record subscriber notification count `a`, `await h.settle()` again, and require the count still equals `a` (no notification arrived across a full extra settle). If not quiescent after 5 such extra rounds, the sample is `INVALID_SETUP`. The drain is a state-preparation step, never a stop criterion for a timed window.

### 5.2 Family R (clash-result records)

Family R uses `controllerHarness.makeHarness({extraModels})` and `makeSet` (read-only reuse) with the deterministic generator of §6.2, the recording bridge, and the fake scheduler. Common pre-state for all R scenarios (untimed): results loaded and sealed; one no-op subscriber registered before warm-up; `INTENT.GROUP_MODE` `{value:'element'}` dispatched and landed (`results.view === 'grouped'`, `filters.busy === false`); sort `S1 = 'group-label'`; text filter empty (`filters.active === false`); no selection unless stated. `S2 = 'group-count'`. Sentinel strings `T1 = 'tagq'`, `T2 = 'tagr'` (§6.2, §7.3). `G*` = element group `{modelKey:'mA', dbId:1000}` (§6.2).

| ID | Pre-state | Timed trigger | Completion predicate | Reset (untimed) |
| --- | --- | --- | --- | --- |
| **R-BASE** | common | `t0`; `dispatch({type: INTENT.SORT_SET, value:'group-count'})` | `filters.sort === 'group-count'` ∧ `filters.busy === false` ∧ `results.state === 'list'` ∧ first-page group/row identity list `===` the **S2 reference list** (below) | `SORT_SET 'group-label'`; verify first-page list `===` the S1 reference list |
| **R-WARM** | common ∧ P-WARM(`T1`) holds (§7.3; label index proven committed) | text draft set to `T2` via `dispatch({type: INTENT.FILTER_TEXT, value:'tagr'})` and verified (`filters.text === 'tagr'`) **outside** the window; `t0`; `await scheduler.advance(FILTER_DEBOUNCE_MS)` | P-WARM(`T2`) | `FILTER_TEXT 'tagq'`, `advance(FILTER_DEBOUNCE_MS)`, wait for P-WARM(`T1`) |
| **R-GROUP-WARM** | R-WARM pre-state ∧ `dispatch({type: INTENT.GROUP_PRESENT, groupId: <G* id>})` landed against the recording bridge ∧ `selected.kind === 'group'` ∧ `selected.groupId === <G* id>` ∧ `selected.clashCount === S*` (§6.2); `p0 = ` number of recorded `bridge.presentGroup` calls | identical to R-WARM | P-WARM(`T2`) ∧ `selected.groupId === <G* id>` ∧ `selected.clashCount === S*` ∧ recorded `presentGroup` call count `=== p0` | as R-WARM, then re-verify the pre-state selection and `p0` |
| **R-COLD** | **fresh harness/controller per sample**; results loaded and sealed; grouping `element` landed; label index never built (no text filter in this generation); text empty; no selection | text draft `T1` set and verified outside the window; `t0`; `await scheduler.advance(FILTER_DEBOUNCE_MS)` | P-WARM(`T1`) | discard the controller/harness (never reused) |

Rules:

- **S1/S2 reference lists (R-BASE); P-WARM references (§7.3).** The first-page identity list for each sort is recorded in the same kind of untimed preparatory pass (a throwaway harness run before the cell's first sample) and frozen as the reference; every later sample must reproduce it exactly (else the sample is invalid, §7.6). The pre-state check compares to the S1 reference. This avoids guessing tie-break order among equal-size groups.
- **R-BASE headless transition = headed HB-BASE transition:** `S1 'group-label' → S2 'group-count'` under element grouping with no selection (§9.3).
- **Primary paired comparator (selected-group cost): `R-GROUP-WARM − R-WARM`.** Validity requires, asserted on every sample: identical selected group (`G*`); identical `memberIndexes` across T1 and T2 (`selected.clashCount === S*` before and after); no group-membership change in the timed window; **no `bridge.presentGroup` call scheduled in the timed window** (recorded-call count unchanged). `T1`/`T2` are constructed (§6.2) so every `G*` member matches both strings. A sample violating any assertion is invalid. Per-VM-build `groupSelectedInput` → `resolveGroupMembership` re-resolution is the cost this pair isolates.
- Membership-changing selected-group behavior is the separately named, unpaired, **optional** R-GROUP-MEMBERSHIP (§4.3); it is excluded from the paired delta.
- `presentGroup()` is excluded from every headless boundary (recording bridge).

## 6. Fixtures and provenance (deterministic)

No PRNG is used for fixture content: all fixtures are closed-form functions of `(M.N_tests | (R profile, R.N_results), n_models)`. The only PRNG is cell-order shuffling (§7.5). A fixture manifest (parameters, expected counts below, SHA-256 of the canonical-JSON **initial** generated data, taken before any sample) is saved per cell; reruns must be byte-identical. Samples restore the pre-state through the reset column, so the post-reset state equals the manifest state. Real production distributions are not available; representativeness is **not claimed**.

### 6.1 Family M fixture (exact executable construction)

One fixture construction is frozen per `n_models`. A harness author implements it; the author does not choose it. Notation: `N = M.N_tests`, `n = n_models`; `m.do(intent)` = `await manager.dispatch(intent)` then `await h.settle()`; logical aliases `m0 = 'mA'`, `m1 = 'mB'`, `m2 = 'mC'` (catalog keys; display names `Architecture`, `Structure`, `Mechanical`).

**Step 0 — harness and catalog.** `{h, m} = setup(opts)` exactly as in `test/clashpanel/core/testsManager.integration.test.mjs:14–27` with `opts = {}` for `n ∈ {1, 2}` and `opts = {extraModels: [{modelKey: 'mC', displayName: 'Mechanical'}]}` for `n = 3`. The harness catalog therefore always contains `mA` and `mB`, plus `mC` when `n = 3`, all `loaded: true` and bound. **No subscriber of any kind is registered during Steps 0–3** (v4): with a manager subscriber attached, every manager mutation synchronously rebuilds the full manager ViewModel, so attaching early would cause repeated full ViewModel rebuilds during every fixture-creation step, contaminate untimed setup and make large `N` setup impractical (static code-reading observation, not a measurement; no complexity class is claimed). The calibration subscriber is attached only at Step 3b. Initial state: one record `test-1` (controller-minted, default name `Clash test 1`, both sides empty, active).

**Per-record model assignment (identical for every test-record; no rotation):**

| `n` | Set A | Set B | `selfClash` |
| --- | --- | --- | --- |
| 1 | `[m0]` = `[mA]` | `[m0]` = `[mA]` (same model on both sides, via toggle) | `false` (never toggled) |
| 2 | `[mA]` | `[m1]` = `[mB]` | `false` |
| 3 | `[mA]` | `[m1, m2]` = `[mB, mC]` (Set B holds multiple models directly; stored sorted) | `false` |

`setup/toggleModel` is a **toggle** (adds the key if absent, removes it if present; both sides start empty; `clashpanel/core/draft.js:36–41, 83–90`), so each key is dispatched exactly once per record, in the order below.

**Step 1 — ordered public sequence.** For `i = 1 … N` (1-based; creation order = list order = `manager.tests[i−1]`):

1. if `i > 1`: `m.do({type: 'manager/create'})` — no payload. Creates a fresh test-record (draft default `Clash test <counter>`) with id `new-(i−1)` from the harness `mintId`, and makes it the **active** record; the previous record is retained with its draft snapshotted. No confirmation is ever required in this fixture (no run, nothing held-unsaved: `request()` prompts only when the active record holds an unsaved held result set). The build issues **no `getViewModel()` read and no confirm check between steps** (each read would itself rebuild the full ViewModel when the cache is dirty); a create that nevertheless blocked on a confirm prompt would leave fewer than `N` records or wrong names/active id, and is detected by the Step 3 predicates (`vm.confirm === null`, `vm.count === N`, names) as `INVALID_SETUP`, never auto-confirmed.
2. `m.do({type: 'setup/name', value: 'CTM8-M-' + N + '-' + n + '-' + i})` — forwarded by the manager to the active real editor.
3. `m.do({type: 'setup/toggleModel', side: 'A', modelKey: 'mA'})`.
4. Set B, by `n`: `n = 1`: `m.do({type: 'setup/toggleModel', side: 'B', modelKey: 'mA'})`; `n = 2`: `… side: 'B', modelKey: 'mB'`; `n = 3`: `… side: 'B', modelKey: 'mB'` then `… side: 'B', modelKey: 'mC'`.

No other intent is dispatched (no `setup/selfClash`, no run, no confirm/apply: editor drafts sync into the manager record on every editor notification, so no explicit save/apply action exists or is needed). After step 1 the **last** record (`i = N`) is active (`activeTestId === 'new-' + (N−1)`; for `N = 1`, `'test-1'`).

**Step 2 — return to list view.** `m.do({type: 'manager/viewList'})`.

**Step 3 — readiness predicates (all must hold; failure ⇒ `INVALID_SETUP`, the cell is not run).** With `vm = m.manager.getViewModel().manager`:
`vm.count === N`; `vm.view === 'list'`; for every `i`: `vm.tests[i−1].name === 'CTM8-M-' + N + '-' + n + '-' + i`; `vm.tests[i−1].setA === 'Architecture'`; `vm.tests[i−1].setB` equals `'Architecture'` (`n = 1`) / `'Structure'` (`n = 2`) / `'Structure; Mechanical'` (`n = 3`); `vm.tests[i−1].readiness.state === 'setup-complete'`; `vm.activeTestId` as above; `vm.confirm === null` (no pending confirmation). Setup-name, scope text and readiness strings are as produced by `describeScope`/`testReadiness` and are recorded in the fixture manifest.

**Step 3b — attach the calibration subscriber (only after Step 3 passed).** `const unsubscribe = m.manager.subscribe((vm) => { notificationCount += 1; })` — a no-op subscriber (no DOM rendering) that only counts notifications. Then **Step 3c — final untimed settle:** `await h.settle()`; verify `m.manager.getViewModel()` returns the same frozen object on two consecutive reads (`===`) and the subscriber count is unchanged across one further `await h.settle()`; failure ⇒ `INVALID_SETUP`. Warm-up and measured samples begin only after Step 3c. This order is the §7.2 topology: the timed scenario runs with the subscriber attached (production-like eager ViewModel materialization), while fixture construction does not. Scenario untimed setup/reset steps that mutate state (M-REC `OPEN`/`SETUP_NAME`, M-BASE `addModel`+`fire`) therefore run subscribed; that is intended and they are excluded from timing.

**Step 4 — reset / disposal.** Within a cell, samples restore pre-state via the scenario reset column (§5.1). Between cells and between launches the fixture is **never reused**: `unsubscribe()` (the Step 3b subscriber), then `m.manager.dispose()`, then `await h.controller.dispose()`, then a fresh `setup(opts)` for the next cell (there is no reset API; the harness `mintId` counter restarts with each `setup`). Build time is untimed setup subject to the §7.6 setup timeout (120,000 ms ⇒ `INVALID_SETUP`; at the largest `N` the cell may therefore be recorded `NOT EXECUTED — setup timeout`, never omitted).

**Compatibility with the frozen transitions (verified against source, no transition redefined).**
- **M-BASE:** every record has Set A `[mA]`, so the `mA` rename changes `tests[i].setA` from `'Architecture'` to `'Architecture-R'` for all `i` (for `n = 1` it also changes `setB`, which is not asserted); `catalog.addModel` must pass `model: catalog.modelOf('mA')` and `loaded: true` (so readiness stays `setup-complete`), and `catalog.fire()` is required for the epoch bump.
- **M-REC:** `OPEN` of a non-active record requires no confirmation in this fixture; the previously active record keeps its draft; a later `setup/name` is forwarded to the editor and synced into record `k` only; `manager.activeTestId === idK` after the OPEN.
- **M-HIT:** needs no run or confirmation; the derived cache is warm after Step 3's reads.
- Every test-record references all `n` models through Set A ∪ Set B, so the per-record reference, readiness and key-scope state differ across `n` (catalog cardinality is 2 / 2 / 3, a harness constraint, reported separately). **Model-axis framing (v4, neutral):** `n_models` is an exploratory controlled dimension, defined as the number of models referenced by each test-record (not catalog cardinality). In this fixture no test-record has a run summary (nothing is run), so the model-change check short-circuits for every record, and static source inspection suggests manager rebuild cost may remain dominated by the test-record count; that is a hypothesis from reading code, not a result. The calibration measures whether the model axis has a material effect; no effect size, direction or slope is assumed. Held constant across `N`.

### 6.2 Family R generator (UNIFORM mandatory; SKEWED optional refinement only)

Model keys: `mA`, `mB`, `mC` (display names `Architecture`, `Structure`, `Mechanical`; `mC` supplied as an `extraModels` entry and passed in `makeSet({models})` so provenance exists). `n_models = 1` → results reference only `mA`. Pair table `PAIRS(n_models)`: 1 → `[(mA,mA)]`; 2 → `[(mA,mB)]`; 3 → `[(mA,mB),(mA,mC),(mB,mC)]`. `P = |PAIRS|`. For `N = R.N_results`, result `i = 0 … N−1`, id `r<i>` (`makeSet` default), `pairIdx(i)` from the profile, `(X,Y) = PAIRS[pairIdx(i)]`:

- **b-side (both profiles; only UNIFORM is mandatory):** `b = (Y, 2000000 + i)` — one distinct element per result (never shared).
- **UNIFORM** (every a-element appears in exactly 10 results): `pairIdx(i) = floor(i/10) mod P`; `a = (X, 1000 + floor(i/10))`.
- **SKEWED — optional targeted refinement, not part of the mandatory campaign** (4 hot a-elements, each in `N/5` results; 20% of results have a singleton a-element): let `q = i mod 5`. If `q < 4` (hot): `pairIdx = q mod P`, `a = (X, 1000 + q)`. If `q = 4` (cold): `pairIdx = floor(i/5) mod P`, `a = (X, 1100 + floor(i/5))`.
- `a` and `b` are passed unreordered (`makeSet` does not reorder). No two distinct elements share `(modelKey, dbId)` (a-ids < 4000, b-ids ≥ 2,000,000). Every N in the matrix is a multiple of 10.
- **Element names — single pure rule `NAME(modelKey, dbId)` (v4; identical for all models and all `n_models`).** If `dbId ≥ 2000000` (a b-element; `i = dbId − 2000000`): `'Pipe-<i>'` + `' tagq'` if `i` is even + `' tagr'` if `i mod 10 = 0`. Else if `modelKey = 'mA'` and `dbId = 1000`: `'Wall-1000 tagq tagr'` (this is `G*`). Else: `'Wall-<dbId>'`. The rule depends only on `(modelKey, dbId)`; it is the only source of element names. No element name, model display name or dbId contains `tagq`/`tagr` except as produced by the rule, so the cold pass (index not yet committed: match text is model display name + dbId only) matches nothing and the committed pass matches only through element names.
- **How the harness receives `NAME` (exact; source-verified, `test/clashpanel/support/controllerHarness.mjs:475–481`).** `makeHarness` accepts `names.mA` / `names.mB` (a function or map) but wires every `extraModels` entry to a fixed `${modelKey}-${dbId}` object tree, ignoring any caller-supplied `model`. The existing support file is **not** changed. Frozen construction, performed immediately after `makeHarness` returns and **before** any dispatch, sealing, label read or manifest hashing: (1) `makeHarness({ names: { mA: (d) => NAME('mA', d), mB: (d) => NAME('mB', d) }, extraModels })` with `extraModels = []` for `n_models ∈ {1, 2}` and `[{modelKey: 'mC', displayName: 'Mechanical'}]` for `n_models = 3`; (2) for `n_models = 3` only: `h.extraModels.mC.getObjectTree = () => ({ getNodeName: (d) => NAME('mC', d) })` (`h.extraModels.mC` is the same Model object the catalog entry (`h.catalog.modelOf('mC')`) and the engine binding hold; its `getObjectTree` is a plain mutable property; the label resolver reads names lazily through `getObjectTree().getNodeName(dbId)` when it builds the label index, so replacement before the first label read is effective). `mA`, `mB` and `mC` therefore all resolve names through the one rule `NAME`.
- **Minimum non-production support-code requirement (for the later, separately authorized execution-support package).** The calibration-only fixture code (a new file under a non-production support path such as `test/`) must perform step (2) above (the `mC` object-tree replacement) and the name proof below. No change to `controllerHarness.mjs`, production code or existing tests is required by this protocol. (Adding `names.mC` support to the shared harness would be an alternative, but it is an edit to an existing test-support file and is **not** specified or authorized here.)
- **Name/count proof before any timed sample (per cell, untimed, recorded in the fixture manifest).** (i) `h.extraModels.mC === h.catalog.modelOf('mC')` for `n_models = 3`; (ii) for every distinct `(modelKey, dbId)` element in the generated set (a- and b-elements), `model.getObjectTree().getNodeName(dbId) === NAME(modelKey, dbId)`, where `model` is `h.modelA` / `h.modelB` / `h.extraModels.mC` for `mA` / `mB` / `mC`; (iii) the exact §6.2 expected counts below are asserted on the first VM; (iv) P-WARM(`T1`) and P-WARM(`T2`) references are recorded in the untimed preparatory pass (§7.3). Any failure ⇒ the cell is `INVALID_SETUP` and not run. The counts below follow from `NAME` and the generator alone and are the same for `n_models` = 1, 2 and 3: `G*`'s results are `i = 0…9` (`pairIdx = 0`, a-element `(mA,1000)`); all other matches arise from b-element names or other a-elements per `NAME`; elements under `mB`/`mC` with dbId < 4000 are named `'Wall-<dbId>'` and carry no sentinel.
- **Primary selected group** `G* = {modelKey:'mA', dbId:1000}` (group id `JSON.stringify(['element',{},{dbId:1000,modelKey:'mA'}])`). A clash is listed under both its elements; de-duplication by `(modelKey, dbId)` is performed by production code, not the fixture.

**Exact expected counts** (asserted against the first VM of each cell; any mismatch invalidates the cell):

| Quantity | UNIFORM (mandatory) | SKEWED (optional only) |
| --- | --- | --- |
| element groups | `1.1·N` | `4 + N/5 + N` |
| max group size / `S*` (= `|G*|`) | 10 | `N/5` |
| unique participants overall | `N/10 + N` | `4 + N/5 + N` |
| participants in `G*` after de-dup | `S* + 1 = 11` | `S* + 1 = N/5 + 1` |
| warm count `W(T1)` (`'tagq'`) | `N/2 + 5` | `0.6·N` |
| warm count `W(T2)` (`'tagr'`) | `N/10 + 9` | `N/5` |
| cold count (either string) | 0 | 0 |

By N = 100 / 1,000 / 5,000 / 10,000: UNIFORM `W(T1)` = 55 / 505 / 2,505 / 5,005; `W(T2)` = 19 / 109 / 509 / 1,009; SKEWED `S*` = 20 / 200 / 1,000 / 2,000; `W(T1)` = 60 / 600 / 3,000 / 6,000; `W(T2)` = 20 / 200 / 1,000 / 2,000. `W(T1) ≠ W(T2) ≠ 0` at every point, and all `G*` members match both strings (so `memberIndexes` of `G*` is identical under T1 and T2).

Label index: names come from each model's `getObjectTree().getNodeName(dbId)`, which the §6.2 construction binds to `NAME` for `mA`, `mB` and (via the object-tree replacement) `mC`. Name length/charset recorded in the manifest.

## 7. Headless protocol (primary, repeatable)

### 7.1 Timing source, boundary, setup

**Timing source:** real wall-clock `performance.now()` (Node). The fake scheduler's virtual `now()` is never used for durations. Because `fakeScheduler.yield()` is microtask-only, headless numbers measure *pure compute plus microtask scheduling*, **not** real yielding, task slicing or main-thread contention — a stated limitation and the reason headed corroboration exists. Cumulative `scheduler.yieldCount` is read before/after each sample and the delta recorded (slice-count covariate).

**Per-sample boundary (executable):**
```
prestate-verify(); [untimed setup: draft text / selection / catalog mutation set up and verified]
t0 = performance.now()
trigger()               // advance(FILTER_DEBOUNCE_MS) | dispatch(intent) | catalog.fire() | getViewModel() batch
await until(predicate)  // public-observable, with 30 s timeout => TIMEOUT sample (§7.6)
vm = getViewModel()     // included
t1 = performance.now()
record(t1 - t0, notificationCount, yieldCount delta, catalog.calls.list delta [Family M])
```
**Debounce (normative).** For text-filter scenarios the intent that sets the draft text is dispatched and verified **outside** the window; `t0` is taken **immediately before** `await scheduler.advance(FILTER_DEBOUNCE_MS)`, which fires the debounced callback and synchronously starts `refreshList`. The virtual 150 ms adds nothing to `performance.now()`; the timer firing and all resulting computation do. Non-text scenarios take `t0` immediately before the trigger. Fixed-round `settle(30)` is not used for stop conditions; predicate-based `until` with the §7.6 timeout is.

**M-BASE exception (v4):** M-BASE's window is fully synchronous (no `await` between `t0` and `t1`; completion predicate evaluated synchronously, §5.1), so the `until` wrapper and 30 s timeout do not apply to it; every other scenario is as stated above.

**Setup excluded:** fixture generation, harness construction, sealing, model registration, initial run completion, catalog/selection/draft preparation and (warm) label-index commit. **Included:** only the triggered work through the stop predicate, including the VM build.

### 7.2 Subscription topology (normative)

Every mandatory scenario registers **one no-op subscriber** (no DOM rendering) on the controller/manager **before warm-up** (Family M: attached at §6.1 Step 3b, strictly after the fixture build and its predicates, never during construction), reproducing production eager VM materialization (`touch()` builds the VM when subscribers exist). Per sample: notification count recorded. No pull-only (`-PULL`) measurement is part of the mandatory campaign (§4.3). A VM-build counter does not exist in the public surface and is not required; `getViewModel().version` (state-change count) and the notification count are recorded instead.

### 7.3 Public sentinel predicate and cold/warm classification (single canonical definition)

Harness code uses `dispatch()`, `subscribe()` and `getViewModel()` (and test-support exports). It does **not** read private controller fields; no private-state value (`textIndexed`, `labelsPending`, committed-filter internals) is a normative dependency anywhere in this protocol. The committed text filter value is not public; only the draft (`filters.text`), the committed-filter-active flag (`filters.active`) and results are.

**Canonical warm-state predicate** `P-WARM(T)` (T ∈ {`T1`,`T2`}), evaluated on a VM read:

> `vm.filters.text === T` ∧ `vm.filters.active === true` ∧ `vm.filters.busy === false` ∧ `vm.results.state === 'list'` ∧ `vm.run.counts.filtered === W(T)` (exact value from §6.2) ∧ the first-page identity list equals the **reference list for `T`**. The reference is recorded once per `(profile, R.N_results, n_models, T)` in an **untimed preparatory pass** (a separate throwaway harness run before the cell's first sample, never counted as a sample), frozen, and compared in every later sample including every R-COLD sample; a mismatch invalidates the sample.

Why it proves a committed index: `W(T)` is non-zero and **cannot** be produced by the cold pass (cold count is exactly 0 and `results.state === 'empty-filtered'`, because the query tokens occur only in element names; the pre-commit match text is model display name + dbId); the count `W(T)` appears only after the label index has committed and the post-commit filter pass has landed.

**Warm preparation (R-WARM, R-GROUP-WARM):** after sealing and grouping, issue `FILTER_TEXT 'tagq'` (draft), `advance(FILTER_DEBOUNCE_MS)`, wait with `until` for P-WARM(`T1`). **If P-WARM(`T1`) cannot be proven within the timeout, R-WARM and R-GROUP-WARM for that cell are `UNAVAILABLE — warm state not proven`; warmth is never inferred from elapsed time, fixed settle rounds, or a guess.** R-COLD is unaffected by that failure except that its own stop predicate (the same P-WARM(`T1`)) governs its sample validity.

**Cold preparation (R-COLD):** a fresh harness/controller per sample; no text filter ever issued in that generation (index never built). The first text change is the trigger.

### 7.4 Cold-label observation boundary

R-COLD is measured as one **total**: `t0` before the debounce advance to P-WARM(`T1`). The subscriber additionally logs, per notification, `(performance.now(), filters.busy, run.counts.filtered, results.state)`. The **observable result transitions** — e.g. `busy` true→false with `filtered === 0` / `'empty-filtered'` (provisional cold pass; the known ≈4 ms false "No clashes match" flash, an observation only), then `busy` true→false with `filtered === W(T1)` — are reported as an *informational transition log*; coalesced notifications may hide a transition and that is recorded, not an error. The **exact label-index commit sub-phase is UNAVAILABLE**: no public notification marks it, and no observation seam is authorized. No sub-phase duration is estimated from the transition log; only the total is a statistic.

### 7.5 Reset, repetition, launches, ordering

- **Reset between samples.** Warm: restore the stated pre-state via the reset column and verify the pre-state predicate before every sample. Cold: new harness/controller. A sample whose pre-state check or validity assertion fails is recorded invalid, never retried silently.
- **Repetition.** Warm-up (excluded from statistics, recorded): 5 untimed iterations per warm cell; 0 for cold. Measured: **30** per warm cell, **15** per cold cell. No silent reduction (§7.6).
- **Launches (mandatory).** The complete matrix is executed in **3 independent Node process launches** (`launchIndex` 0, 1, 2). Randomization unit = cell (scenario × scale point × model point; Family R profile is UNIFORM); cell order is shuffled per launch with `mulberry32(20261011 + launchIndex)` and a Fisher–Yates shuffle (both recorded); within a cell the warm-up block precedes its measured block and repetitions run consecutively.
- **Authoritative summaries** are fixed in §11.

### 7.6 Per-sample timeout and failure handling (execution safety bound, not a performance threshold)

- Timed-window timeout: **30,000 ms** from `t0`. Untimed setup/reset timeout: **120,000 ms**.
- Exceeding the timed timeout: the sample is **retained** with `status: "TIMEOUT"` and its elapsed value (`≥ 30000`); it is excluded from timing statistics, listed, and counted. Exceeding the setup/reset timeout: `status: "INVALID_SETUP"`, retained, excluded.
- Repetitions **continue**; the per-cell repetition count is never reduced silently. The cell reports `n_valid`, `n_timeout`, `n_invalid`. If **3 consecutive** samples in one cell are TIMEOUT or INVALID_SETUP, the cell is aborted and recorded `ABORTED — consecutive failures` (all samples so far retained), and counts as an executed-but-inconclusive mandatory cell. The abort is **cell-local**: remaining repetitions of that cell only are stopped, collected samples are retained, the cell is marked failed/inconclusive as appropriate, and the rest of the campaign continues. A true **global harness/runtime failure** (e.g. process crash, fixture-generator defect affecting all cells) may stop the overall run and is recorded distinctly as `GLOBAL_FAILURE`, never as a cell result.
- The previous v1 rule allowing the count to fall to 10 at 10,000 is **withdrawn**.

### 7.7 Outliers and GC

Every sample is retained in the raw data. No silent deletion. **Natural garbage collection is part of the measured cost and never grounds for exclusion**; GC event count/duration (`PerformanceObserver` `gc` entries) is recorded as a covariate. Exclusion is allowed only for: failed pre-state check/validity assertion, TIMEOUT, INVALID_SETUP, a GC *explicitly invoked by the harness* inside the window, or a documented external interruption (e.g. OS sleep); each excluded sample is listed with its reason.

## 8. Cold/warm label policy

Cold-label and warm-label are separate, named scenarios (R-COLD, R-WARM). R-COLD is reported as **total** only (§7.4). Warm scenarios start only after P-WARM(`T1`) is proven. Reports label every number with its scenario ID and **must not** present a combined headline. Cold sample objects are never reused for warm statistics. Index-commit sub-phase: **UNAVAILABLE**.

## 9. Headed Viewer protocol (corroboration only)

Headed results corroborate; they never replace headless calibration; the headed subset (§9.2) is a deliberate reduction and is **not** the full headless Cartesian matrix. Headed timings and headless timings measure different boundaries (§10).

### 9.1 Setup / environment

Normal app (`PORT=… node server.js`, `.env` present), headed Chromium via Playwright MCP, viewport recorded (prior evidence 1600×1000), APS Viewer version recorded (prior evidence 7.124.2), real **SVF2** models (prior evidence: Audubon Architecture / Structure / Mechanical; names and URN hashes recorded per run). Dev-server state, `NODE_ENV`, browser cache state and background workload recorded. Instrumentation is **runtime-injected** (no production edit) and read-only: it reaches the controller through the existing extension handle (`viewer.getExtension('Autodesk.Sandbox.ClashPanel')._host.panel.controller`) only to call `getViewModel()`/`subscribe()`, and reads public Viewer getters (`getAggregateIsolation()`, `getIsolatedNodes()`, camera). (That handle's underscore-prefixed path is an instrumentation-access route only; no private controller **state** is read, and predicates use only the public ViewModel.) It installs capture-phase DOM event listeners, a `MutationObserver` on the results region and a `PerformanceObserver` for `longtask`.

### 9.2 Reachability and the headed corroboration subset (bounded)

- **No synthetic population.** Headed `R.N_results` comes only from real result sets produced by real engine runs; headed `M.N_tests` only from test-records created through the real UI. Injecting or seeding fake records and calling them real headed evidence is forbidden.
- **10,000 is an exploratory target, not a cap.** The repository default `maxResultsPerRun` is 100,000 (`clashtest/options.js:58`, `int(1, 956_824, 100_000)`; ceiling 956,824). Each run records `provenance.runOptions.maxResultsPerRun` (**configured**), the engine's **produced** count, the **retained** count and **truncation** semantics. Reaching any target in the real product is empirical: attempt a target only where a real test can naturally produce it; otherwise record the actual produced/retained counts and mark the requested point **`NOT REACHABLE HEADED`**, optionally using the nearest naturally reachable point labelled `NEAREST-REACHABLE (requested T, actual A)`. Headless coverage at the requested scale is retained where valid.
- **Family R headed subset.** For each model count (1, 2, 3 where the real models allow): up to three real result sets chosen from what the product naturally produces — **low** (nearest to 100), **middle** (nearest to 1,000), **high** (the largest naturally reachable, with 5,000 and 10,000 attempted only if natural). Scenarios per reachable point: HB-BASE, HB-WARM, HB-COLD, HB-GROUP (timed UI-render corroboration, §9.3) plus the correctness-only Viewer checks HV-1…HV-4. Upper bound: 3 model counts × 3 points = 9 points → 36 timed cells + 9 HV blocks. This is a ceiling, not a requirement; unreachable points shrink it.
- **Family M headed subset.** One scenario, **HM-REC** (real single-test-record edit through the UI; exact contract in the §9.3 table), at the **final owner-decided** corroboration points: `M.N_tests ∈ {5, 25, 100}` built by real create/duplicate UI actions, each at `n_models ∈ {1, 3}` (ceiling 6 cells; corroboration only, §18.1). A point that proves impractical in the real product is marked `NOT REACHABLE HEADED`; the list itself is not reopened. No headed `M.N_tests` of 1,000 or more is attempted unless naturally practical, and 10,000 is never created through artificial UI seeding. **M-BASE has no headed counterpart** (a catalog display-name change is not naturally producible in the real product); it is headless-only.
- Repetitions (headed, informal, no p95): warm scenarios 2 untimed warm-ups + 5 measured; cold 3 fresh generations. Median/min/max only.

### 9.3 Exact headed scenarios

Common to all timed headed scenarios (HB-*, and HM-REC with the manager list as its region): **Start (`t0`)** = `performance.now()` read inside a capture-phase listener for the exact triggering DOM event (`input` for text, `change` for the sort select), installed before the Playwright action; the Playwright call's return time is not used. **Completion** = time `tD` at which the *semantic predicate* **and** the *DOM predicate* first hold, confirmed by a **250 ms quiet window** with no mutation (childList/characterData/attributes) in `section[data-region="results"]` (excluding the Viewer canvas and other regions); the quiet window verifies stability and is **not added** to the reported duration; if a mutation arrives inside it, the completion time moves to when both predicates next hold. Maximum 10 s → `TIMEOUT` sample. A provisional `'empty-filtered'` ("No clashes match") state never satisfies a predicate. Reported duration = `tD − t0` and includes the real 150 ms debounce for text actions (time-after-debounce is also reported where separable). Viewer work is governed by §9.4.

| ID | Pre-state | Action and payload | Post-state / completion predicate | Included | Excluded |
| --- | --- | --- | --- | --- | --- |
| **HB-BASE** | real result set loaded; element grouping radio `[data-key="group-element"]` selected and landed; sort `group-label`; no filter; no selected group | `selectOption` on `select[data-key="sort"]` value `group-count` (event: `change`) | VM: `filters.sort === 'group-count'` ∧ `filters.busy === false` ∧ `results.state === 'list'`; DOM: first-page `button.clash-group-body[data-key]` sequence equals the VM first-page group keys (VM keys equal the S2 reference recorded in an untimed preparatory pass of the same set) | VM rebuild, list render | any Viewer work (none is triggered) |
| **HB-WARM** | HB-BASE pre-state; label index proven committed: sentinel `T1` fill performed untimed and P-WARM-H(`T1`) holds | `fill` `input[type=search][data-key="filter-text"]` with the second sentinel `T2` (event: `input`) | P-WARM-H(`T2`) (below) ∧ DOM: results-region group/row count equals the VM | debounce, filter pass, VM rebuild, render | Viewer work |
| **HB-COLD** | freshly displayed real sealed set (new run completion or page reload + reopen), label index never built in this generation, filter empty | `fill` `T1` | P-WARM-H(`T1`) and the transition log (`busy`, `filtered`, `state` with timestamps from the in-page subscriber) | debounce, cold pass, label warm-up, post-commit pass, render (**total only**) | Viewer work; index-commit sub-phase (UNAVAILABLE) |
| **HB-GROUP** | HB-WARM pre-state **plus** primary group `G†` (the group with the largest `selected.clashCount` among groups matching both `T1` and `T2`) selected by clicking `button.clash-group-body[data-key="group:<id>|present"]` **and the Viewer settled** (below); `selected.clashCount` recorded | `fill` `T2` (same as HB-WARM) | HB-WARM predicate ∧ `selected.groupId === G†` ∧ `selected.clashCount` unchanged ∧ Viewer isolation/camera getters unchanged from the settled pre-state (proves no Viewer mutation occurred in the window) | as HB-WARM with a selected group; selected-region render | Viewer work (asserted absent) |
| **HM-REC** (Family M, headed) | real app, `n_models` models loaded, `M.N_tests` test-records created through real create/duplicate UI actions; manager list view; target `k = floor(M.N_tests / 2)` opened via its list item `li.clash-manager-item[data-test-id]` (editor view, `manager.activeTestId === idK`); setup name field currently `'CTM8-HM-A'` (set untimed through the real UI and verified in the manager VM) | the editor's setup-name text input (real UI) `fill` with `'CTM8-HM-B'` (event: `input`) | VM: `manager.tests[k].name === 'CTM8-HM-B'` ∧ `tests[k].testId === idK` ∧ `manager.count === M.N_tests`; DOM: the list item for `idK` shows the new name; results-region-equivalent quiet = no mutation in `.clash-manager-list` for 250 ms (10 s timeout) | forwarded editor work, manager sync, derived recompute, list render | Viewer work; any run/result presentation |

`P-WARM-H(T)` (headed, real data): `filters.text === T` ∧ `filters.active === true` ∧ `filters.busy === false` ∧ `results.state === 'list'` ∧ `run.counts.filtered === C(T)`, where `C(T)` is recorded for the same real result set in an **untimed preparatory pass** (a never-reused name-only token pair chosen from real element names and verified not to occur in model names or dbIds; the cold count is expected to differ, and if the cold count equals `C(T)` the sentinel is rejected and another token chosen). If no valid sentinel exists for a real set, HB-WARM/HB-COLD/HB-GROUP for that point are `UNAVAILABLE — sentinel not provable`.

### 9.4 Viewer work: timing exclusion and correctness-only checks

The only completion signal for Viewer mutations is the controller `dispatch()` promise (resolves after `bridge.presentGroup`/`present` returns its outcome); the dispatch path is internal to the panel, no DOM attribute proves isolation or fit finished, and the runtime instrumentation cannot reliably intercept the panel's own dispatch. The protocol therefore does **not** claim Viewer completion is inside any timing boundary: **all Viewer work (`presentGroup`, Focus, Isolate, restore / Back to all, fit) is excluded from headed timing** and checked for correctness only.

**Viewer settled** (used wherever a pre-state or post-check requires it): the public Viewer getters (`getAggregateIsolation()`, `getIsolatedNodes()`, rounded camera) and `vm.selected` are unchanged across consecutive 250 ms samples for ≥ 500 ms, with a 10 s maximum (failure → the check is `INCONCLUSIVE`, recorded).

| ID | Action (exact) | Expected post-state (correctness only; Addendum B semantics verified, not reopened) |
| --- | --- | --- |
| **HV-1 select group** | click `button.clash-group-body[data-key="group:<G†id>|present"]` | after settled: `vm.selected.kind === 'group'`, `groupId === G†`; `.clash-group-row-selected` present; Markers checkbox `[data-key="action-markers"]` disabled; no `clash-panel-markers:`/`clash-panel-outlines:` overlay scenes |
| **HV-2 Focus** | click `button[data-key="action-focus"]` | after settled: rounded camera differs from the pre-state and is finite |
| **HV-3 Isolate** | check `input[data-key="action-isolate"]` | after settled: checkbox checked; `getAggregateIsolation()` reports the group participants |
| **HV-4 Back to all** | click `button[data-key="action-back-to-all"]` | after settled: no group selection in `vm.selected`; isolation restored (no isolated nodes) |

Responsiveness capture (informational, answers Q6/Q7): across every headed action record `longtask` entries (count, max duration), results-region mutation timestamps, intermediate states, screenshots, serialized VM snapshots, console logs and the observed counts; optional Playwright trace. Where timing cannot be captured reliably, record a qualitative class (responsive / visibly stalled / delayed presentation) with evidence. No Viewer-inclusive duration is reported.

### 9.5 Evidence per headed scenario

Screenshot(s), serialized VM/state snapshot, console log, observed timings and transition log, exact actions taken, actual model/produced/retained/configured/truncated counts, and the `NOT REACHABLE HEADED` / `NEAREST-REACHABLE` label where applicable. Existing read-only capture helper to reuse as a base: `docs/research/evidence-support/ctm-7-h-revalidation/capture-helper.js` (it has no timing/MutationObserver/longtask recorder; those are added by the runtime-injected instrumentation).

## 10. Timing boundaries (summary)

| Aspect | Headless | Headed |
| --- | --- | --- |
| Start | immediately before trigger | in-page capture-phase listener timestamp for the triggering event (§9.3) |
| Stop | predicate satisfied + `getViewModel()` read (the `until` predicate is the only drain criterion) | semantic ∧ DOM predicate first holding, confirmed by 250 ms results-region quiet window; 10 s timeout = failed sample |
| Setup excluded | fixtures, harness, sealing, run, catalog/selection/draft preparation, warm-up index (warm) | model load, run completion, navigation, preparatory passes, warm-up (warm) |
| Debounce | virtual 150 ms adds nothing; `advance()` compute is **inside** | real 150 ms debounce **included** (time-after-debounce also reported) |
| Task slicing / yielding | microtask-only, **not representative** | real |
| Viewer render/presentation | excluded (recording bridge) | **excluded from timing** (§9.4); correctness-only HV checks; UI list render included |

Headless and headed timings measure different boundaries and must not be compared as if identical (§15).

## 11. Metrics and statistics (fixed)

Per sample: elapsed duration (ms, ≤ 0.1 ms resolution reported, timer resolution stated); `status` (`OK`/`TIMEOUT`/`INVALID_SETUP`/`INVALID`); notification count; `yieldCount` delta; `catalog.calls.list` delta (Family M); `n_models`; `M.N_tests` **or** `R.N_results` (exactly one, by family; there is no unlabeled generic count field); fixture profile (Family R; `UNIFORM` in the mandatory campaign); `G*` size `S*` (R-GROUP-WARM). R-COLD additionally the informational transition log.

**Quantile estimator (single, fixed): nearest-rank.** For `n_valid` ascending values `x(1) ≤ … ≤ x(n)`, `p95 = x(⌈0.95·n⌉)`. Warm per-launch (`n = 30`): rank 29. Pooled warm (`n = 90`): rank 86. Pooled cold (`n = 45`): rank 43.

**Authoritative vs secondary summaries** (decided here, not at execution):

- **Per-launch summaries are authoritative** for every statistic: n_valid, min, median, max, and (warm only) p95 — p95 reported only when per-launch `n_valid ≥ 20`, otherwise `p95 n/a`. **Cold per-launch p95 is always `n/a`** (n = 15).
- **Headline per cell = median of the three per-launch medians** ("median-of-launch-medians"), with the three per-launch medians shown so process variance is visible.
- **Pooled summaries are secondary** and must be labelled `POOLED` (median/min/max over all valid samples from the three launches; pooled p95 by the estimator above, only when pooled `n_valid ≥ 30`). A pooled cold p95 is permitted only under that label with raw samples retained.
- **Paired selected-group delta** (R-GROUP-WARM − R-WARM, same `R.N_results`, `n_models` and fixture profile): computed as three per-launch differences of medians; headline = median of the three; all three shown with the per-launch spreads. Not a single pooled subtraction.
- Cold-minus-warm is shown as separate columns, never a blended average. Differences under measured run-to-run variance are "indistinguishable". Knee detection is descriptive (ratio of per-unit cost between successive points); no automatic criterion triggers a gate. **No threshold, budget or pass/fail is derived.**
- Outliers are never silently removed (§7.7).

**UNAVAILABLE (must be marked, not estimated):** R-COLD label-index commit sub-phase; time spent in `buildViewModel` vs `rebuildOrdered` inside one operation; per-test-record cost inside `derivedOf`; M-REC-MGRONLY. Instrumentation for these would require a separate authorized package; none is requested.

## 12. Environment control

Record for every run (`environment.json`): machine model/CPU/core count/RAM, OS version, Node version and flags, battery/AC, repository commit and tree state, `npm` lockfile hash, browser name/version (headed), APS Viewer version, model names/URNs/loading mode (SVF2), dev-server/build state, `NODE_ENV`, other heavy processes (ask for a quiet machine), time and date, timer source. Goal is repeatability, not normalization; cross-environment comparisons are out of scope.

## 13. Evidence layout

`docs/research/evidence/<date>-ctm-8-rebuild-cost-calibration/` containing: `MANIFEST.md` + `checksums.sha256`; `protocol-version.txt` (`CTM8-P0-v4`); `environment.json`; `fixtures/` (generator parameters, expected-count tables, manifests, checksums — not bulk data unless small); `raw/headless-*.jsonl` (one line per sample incl. warm-ups, invalid, excluded, TIMEOUT); `summary/headless-matrix.md|json` (per-launch, headline and `POOLED` sections kept separate); `headed/` (per scenario: screenshots, state snapshots, console logs, long-task/mutation timing JSON, transition logs, trace if captured, action log, reachability table with configured/produced/retained/truncated); `anomalies.md`; `commands.md`; `README.md`. P0 creates none of this.

## 14. Execution report contract

The later execution package's `docs/research/<date>-ctm-8-calibration-execution-final-report.md` must contain (beyond the standard `CLAUDE.md` final-report contents): protocol version `CTM8-P0-v4`; commit/branch/tree/environment; exact cells executed vs `NOT EXECUTED`/`NOT REACHABLE HEADED`/`UNAVAILABLE`/`ABORTED` with reasons, against the §4.2 mandatory counts; raw and summary measurements (link to evidence); cold/warm separation; paired selected-group results; headed corroboration and its limits; anomalies; inconclusive cases; the unavailable index-commit sub-phase; the statement "tested points are calibration observations, not product limits"; and the next-gate recommendation. No unsupported extrapolation.

## 15. Interpretation rules

The execution package and its reviewers must not: extrapolate a supported maximum beyond measured points; convert a measured knee into a product limit without a separate reviewed owner decision; claim a frame-budget guarantee from a small sample; merge cold and warm; compare headed and headless timings as identical boundaries; hide failed, timed-out or inconclusive points; describe provisional presentation constants as calibrated; treat 10,000 as an engine cap or as a supported/required scale; describe headless numbers as including real yielding or Viewer work. If results show a knee, timeout, material responsiveness degradation or headed/headless divergence, the next gate is a **review/owner decision** on whether to refine points, add instrumentation, or open a design/implementation package; the execution package does not make that choice.

## 16. Protected boundaries (unchanged by P0 and by execution unless separately authorized)

No production implementation; no change to existing tests (new calibration-only support code, if later authorized, is separate); no Core/collision/Viewer Adapter/host change; no Viewer theming/selection change; no public limits or resource/performance limits; no CTM-7 L1–L8, Addendum B L1/L2, hide/departure (O-1…O-4), neighbouring single-clash navScope remediation, GP-F1 polish; no grouping-semantics change; no persistence/history. Observing the Addendum B L1 flash in cold runs is allowed and reported as an observation only.

## 17. Execution-support authorization boundary (all currently NOT authorized)

P0 authorizes none of the following. The next execution package requires a **separate owner authorization** for, at minimum:

1. a **calibration-only headless harness** (support path such as `test/…`, never production);
2. a **deterministic fixture generator** (§6), including the exact §6.2 `mC` object-tree naming step and name proof, under a non-production support path such as `test/` (a new calibration-only file; no edit to `controllerHarness.mjs`), independently reviewed before use;
3. **runtime-injected headed evidence instrumentation** (no production edits; §9.1);
4. **execution of the accepted mandatory matrix** (§4.2) and headed corroboration (§9.2);
5. **evidence and execution final-report writes** (§13–§14).

Separately from the above: an **observation seam** (test-only or production) is **not required** for the minimum campaign, **not recommended** and **not authorized**; without one the exact label-index commit sub-phase remains UNAVAILABLE. No production observation hook is required or recommended.

## 18. Owner decisions

### 18.1 Resolved (closed; not to be reopened by this protocol, its review, or the execution package)

1. Both families: Family M (`M.N_tests`) and Family R (`R.N_results`); full 4 × 3 headless matrix for mandatory scenarios.
2. **Mandatory Family R fixture profile = UNIFORM only.** SKEWED is optional targeted refinement only (§4.3).
3. `-PULL` variants optional and outside the mandatory campaign.
4. 3 independent launches; 30 measured warm repetitions; 15 measured cold repetitions; 5 warm-ups per warm cell.
5. **Per-sample timeout 30 s** (execution safety bound only, not a performance budget or pass/fail threshold); **cell-local abort after 3 consecutive failures/timeouts** (retain samples, continue the campaign); a true global harness/runtime failure may stop the run and is recorded distinctly (§7.6).
6. **Headed Family M corroboration points are final:** `M.N_tests ∈ {5, 25, 100}` × `n_models ∈ {1, 3}`; corroboration only (§9.2).
7. **Unreachable/unavailable dispositions are valid:** `NOT REACHABLE HEADED`, `NEAREST-REACHABLE` (labelled) and `UNAVAILABLE` outcomes (§9.2).
8. **Observability:** public sentinel-based cold/warm classification only; no observation seam; no production hook; the exact label-index commit sub-phase is UNAVAILABLE; R-COLD total retained (§2, §7.3–§7.4).

### 18.2 Next owner decision (the only one remaining)

Whether to authorize the CTM-8 execution/support-code package (§17: harness, deterministic fixture generator, runtime-injected headed instrumentation, execution of the mandatory matrix, evidence and execution-report writes) — decidable only **after a clean targeted Independent Work re-review** of this protocol. No methodology choice remains open.

## 19. Exact execution gate

Flow: (1) corrected P0 protocol `CTM8-P0-v4` (this document) with the v4 correction final report and handoff → (2) **targeted Independent Work re-review of the corrected P0 protocol** → (3) owner decides whether to authorize CTM-8 calibration execution-support work and execution (§17) → (4) only then may the harness/evidence package begin. **CTM-8 execution is not authorized by this document.**
