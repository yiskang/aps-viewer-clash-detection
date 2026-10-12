# CTM-8 P0 v4 Correction — Package Final Report

Date: 2026-10-12 · Package: bounded docs-only correction of `CTM8-P0-v3` → **`CTM8-P0-v4`** (owner authorization: [prompt](../prompts/ctm8-p0-v4-bounded-docs-only-correction-prompt.md)). Older P0 reports and prior reviews are preserved unchanged as history.

## Repository state

`main` == `origin/main` == `ac5bcb42b00e668442ce3add9764cba96d883309` (0/0), verified before editing. Tree: docs only, uncommitted, unpushed (modified `docs/handoffs/latest.md`; untracked prompts, reviews, research artifacts incl. this report). CTM-7 closed; Addendum B checkpointed; no CTM-8 harness, generator, seam, instrumentation, evidence or calibration exists. No production code, tests, spec or plan changed. No commit, no push.

## Governing failed review and authorization

[P0-v3 targeted Independent Work Review](../reviews/2026-10-12-ctm-8-p0-v3-targeted-independent-work-review.md): FAIL — 0 Critical / 2 High / 2 Medium / 5 Low. Authorization limited to H-01, H-02, M-01, M-02 (+ strictly necessary same-paragraph consistency). Protocol (updated in place): [`2026-10-11-ctm-8-rebuild-cost-calibration-protocol.md`](2026-10-11-ctm-8-rebuild-cost-calibration-protocol.md), **`CTM8-P0-v4`**, sha256 `a6f7a61f1cae8b2aac7868277b67c26422537f88af3c27d908cbd054fc2634c3` (at report time).

## Dispositions

| Finding | Correction | Protocol |
| --- | --- | --- |
| **H-01** Family R `n_models=3` naming | Source re-verified (`controllerHarness.mjs:475–481`: `names` reaches only `mA`/`mB`; `extraModels` hard-wired to `${modelKey}-${dbId}`; `h.extraModels.mC` is the same mutable Model object the catalog and engine binding hold; labels read `getObjectTree().getNodeName` at call time, `labels.js:44–53`). Protocol now freezes one pure rule `NAME(modelKey, dbId)` for all models/`n`, the exact construction (`names.mA/mB` via the option; `mC` via `h.extraModels.mC.getObjectTree = …` immediately after `makeHarness`, before any dispatch/label read), the minimum **non-production** support-code requirement for the later package (new calibration-only fixture file; no edit to `controllerHarness.mjs`), and a per-cell name/count proof (object identity, per-element `NAME` check, exact counts, P-WARM references) before any timed sample. The 3-model mandatory matrix is **not** reduced. Counts (`W(T1)=N/2+5`, `W(T2)=N/10+9`, `S*=10`, `1.1N` groups) are stated as following from `NAME` and the generator for every `n`; they were recomputed by simulation during the v3 review for n=1,2,3. | §6.2, §7.3 wording, §17 item 2 |
| **H-02** subscriber timing | Family M subscriber is attached only **after** the build, Step 3 predicates and a final untimed settle (new Steps 3b/3c; reads only once at Step 3; no per-step VM reads); lifecycle: `unsubscribe()` → `manager.dispose()` → `controller.dispose()` per cell/launch. Rationale stated as static code-reading only (early attachment ⇒ repeated full VM rebuilds in setup, contaminates setup, large `N` impractical); **no complexity class or feasibility claim made**; 120 s setup timeout and `NOT EXECUTED — setup timeout` rule unchanged. Compatibility checked: M-BASE/M-REC/M-HIT all run subscribed during their timed windows; untimed setup/reset steps also run subscribed (intended, excluded from timing). | §5.1 common state, §6.1 Steps 0, 1, 3b, 3c, 4, §7.2 |
| **M-01** M-BASE window | One exact contract: fully synchronous window (`t0`; `catalog.fire()`; `manager.getViewModel()`; synchronous predicate; `t1` — no `await`), included = all synchronous work of both catalog listeners (controller then manager) and subscribed rebuilds they trigger; excluded = every async continuation (controller soft re-evaluation etc.), making the boundary `n`-independent; predicate not holding synchronously ⇒ `INVALID`; reversible mutation/API/payload unchanged; reset + a defined drain/quiescence rule (notification count stable across an extra settle; `INVALID_SETUP` after 5 extra rounds) before every sample; `notif_in_window` / `notif_after_window` covariates. Source-checked: names resolve synchronously once `fire()` returns (`derivedOf` on epoch bump; `fakeCatalog.addModel` already updated names). | §5.1 M-BASE row + bullets, §7.1 exception |
| **M-02** model-axis prose | Removed "per-test-record `modelsChangedOf` scale[s] with `n`" and the "full `derivedOf` recompute" attribution. Neutral framing: `n_models` = models referenced by each test-record (unchanged), exploratory controlled dimension; no run summaries exist in this fixture so the model-change check short-circuits; static inspection suggests cost may stay dominated by record count — hypothesis only; no effect size/direction assumed; catalog cardinality 2/2/3 still reported separately. | §5.1 M-REC bullet, §6.1 compatibility bullet |

## Consistency edits (necessary only)

Version line/revision history, `protocol-version.txt` and report-contract version strings, §19 flow text → v4; "name-only" wording corrected where the §6.2/§7.3 paragraphs were edited (cold pass matches on model display name + dbId; sentinels occur only in element names). The headed "name-only token" wording (§9.3, real data) is untouched.

## Deferred Low findings (not remediated; outside the edited paragraphs)

L-01 (1M+2L texts not durable; v2 correction report line 47 dangling), L-02 partly (`setup()` non-exported — must be copied; `until` is round-bounded — wall-clock wrapper needed: not added to protocol), L-03 (hash baseline: now recorded as `4053c28e…`, unchanged), L-04 §9.3 HM-REC "`n_models` models loaded" wording, L-05 spec AC-P11 citation line.

## Verification performed (docs only; no calibration, no tests)

Arithmetic text untouched and re-checked: 84 cells/launch, 252 executions, 7,020 measured, 1,080 warm-ups, 8,100 operations; UNIFORM-only, SKEWED/`-PULL` optional, §18 decisions unchanged; no private-state observability introduced (mC replacement is fixture construction, not controller-state reads); no support-code authorization added (§17 still lists everything as NOT authorized); `git diff --check` clean; every changed/untracked path under `docs/`; no `*.js/*.mjs` created. Re-read edited sections in full.

## Residual limitations

1. Family M build time at N=5,000/10,000 is still unmeasured; feasibility with subscriber-after-build is an expectation, not evidence. If it still exceeds the setup timeout, that is an owner decision for the execution package, not for this one.
2. The `mC` object-tree replacement relies on `h.extraModels.mC` being mutable and read lazily (source-verified, not executed).
3. Not independently reviewed after correction; internal read only.

## Next gate

**Targeted Independent Work re-review of `CTM8-P0-v4`.** No commit/push authorized. CTM-8 execution and execution-support code remain **unauthorized**; do not begin harness/generator/instrumentation, calibration, evidence, or another CTM-8 package.
