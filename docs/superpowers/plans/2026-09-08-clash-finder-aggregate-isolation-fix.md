# Clash Finder: switch isolation reconciliation to the Viewer aggregate-isolation API

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development,
> dispatched by the controller directly in the current working tree (no worktree isolation for
> this fix — narrow, single-file production change). Steps use checkbox (`- [ ]`) syntax.

**Goal:** `ClashFinderExtension._reconcileIsolation()` currently applies the Hard∪Soft isolation
union to the Viewer with **one `viewer.isolate(dbIds, model)` call per model**, plus one
`viewer.isolate([], model)` call per model that drops out of the union. This is wrong for a
federated (multi-model) scene: `isolate()` only ever touches the model(s) it's explicitly called
on, so a loaded model with nothing in the union is left completely untouched (fully visible,
un-isolated) instead of being hidden — the isolation view is only correct by accident, when every
loaded model happens to be mentioned. The Viewer has a purpose-built public API for exactly this,
`viewer.setAggregateIsolation(isolation)`, which replaces the isolation state of **every** loaded
model in a single call. Switch `_reconcileIsolation()` to use it.

**Not in scope:** collision-core (`collision/**`), any result-set abstraction, M4 work, the
independent Hard/Soft action-token mechanism (untouched), the two overlay scenes (untouched, still
Hard Clash markers + Soft Clash markers/lines, independently).

## Verified Viewer API evidence (APS Viewer 7.124.2, pinned via `wwwroot/index.html:46`)

Retrieved 2026-09-08 from
`https://developer.api.autodesk.com/modelderivative/v2/viewers/7.124.2/viewer3D.js` (gzip
transport; decoded sha256 `12b9fe49f41dc99ccec62535e5c887da915980829da2e941cfe4da3d7197c02e`).
Cross-checked against the official Reference Guide (`Viewing.Viewer3D` / `Viewing.GuiViewer3D`,
inherited).

- **Public, documented method**, on `Viewer3D.prototype` (inherited by `GuiViewer3D`):
  ```
  Viewer3D.prototype.setAggregateIsolation = function (isolation) {
    this.impl.visibilityManager.aggregateIsolate(isolation);
  };
  ```
  Reference Guide: *"Isolate ids from different models. Choose this api instead of isolate() when
  isolating across many models. It will hide all other models."*
- **Signature:** `setAggregateIsolation(isolation)` where `isolation` is
  `Array<{ model: Autodesk.Viewing.Model, ids: number[] | number }>` — one object per model that
  should have isolated ids; a model with no entry is NOT left alone, it is hidden entirely (see
  below). This is a deliberate behavior difference from `isolate(dbIds, model)`, not a bug to work
  around.
- **Clear-all:** pass `[]`. Confirmed via the Viewer's own public `showAll()`
  (*"Ensures everything is visible. Clears all node isolation"*), which itself calls
  `this.impl.visibilityManager.aggregateIsolate([])`. `aggregateIsolate([])` sets every loaded
  model fully visible.
- **Full-replace, not incremental — read `VisibilityManager.prototype.aggregateIsolate` directly**
  (source-verified, `viewer3D.js` decoded ~line 95003):
  ```
  aggregateIsolate(isolation, options) {
    if (!isolation || isolation.length === 0) {
      for (const model of this.models) model.visibilityManager.setAllVisibility(true);
    } else {
      const hideOthers = options?.hideLoadedModels ?? true;
      for (const model of this.models) {
        const item = isolation.find((i) => i.model == model);
        if (item) {
          const ids = item.ids || item.selection;
          model.visibilityManager.isolate(ids);
        } else if (hideOthers) {
          model.visibilityManager.setAllVisibility(false);
        }
      }
    }
    this.#fireAggregateIsolationChangedEvent();
  }
  ```
  `setAggregateIsolation` never passes `options`, so `hideOthers` defaults to `true`: every call
  is evaluated against **every currently loaded model**, not just the ones mentioned in
  `isolation`. A loaded model absent from the array is fully hidden. This is exactly the desired
  "federated multi-model isolation" behavior (see docstring above) and is why this task exists —
  do not try to preserve the old "untouched models are left alone" behavior.
- **Not internal:** this is a plain public prototype method with a Reference Guide entry, not
  `viewer.impl.*` or `Autodesk.Viewing.Private.*`.

## Current code (read before editing)

`wwwroot/extensions/ClashFinderExtension.js`:
- `_reconcileIsolation()` (~line 382-429): builds the Hard∪Soft union `Map<model, Set<dbId>>`
  (keep this part, unchanged), then does two per-model loops calling
  `this._viewer.isolate([...dbIdSet], model)` and `this._viewer.isolate([], model)`.
- `_setHardIsolation`/`_setSoftIsolation`/`_clearIsolation` (~line 435-455): unchanged, they only
  ever call `_reconcileIsolation()`. Do not touch their bodies.
- `this._isolatedModels` (constructor, ~line 122-132): a `Set<Model>` the OLD per-model-loop
  design needed to know which models to explicitly un-isolate when they fell out of the union.
  Under one-call `setAggregateIsolation`, the Viewer itself already handles "hide every model not
  in the array" — `_isolatedModels` is no longer needed for that purpose, but many existing tests
  use it as a convenient introspection seam for "which models currently have active isolation".
  **Keep the field**, but simplify its maintenance: after the single `setAggregateIsolation(...)`
  call returns without throwing, set `this._isolatedModels = new Set(union.keys())`. If the call
  throws, leave `_isolatedModels` at its prior value and let the exception propagate uncaught
  (same "no try/catch, no swallow" discipline the current code already documents — it's simpler
  now because there is exactly one call, not N, so there is no partial-per-model state to reason
  about).
- `_onBeforeModelUnload` (~line 279-357): calls `_clearIsolation()` then, in the finally,
  `this._hardIsolationByModel.delete(event.model)` / `this._softIsolationByModel.delete(event.model)`
  / `this._isolatedModels.delete(event.model)` as a defensive fallback. Leave this fallback as-is
  — it's harmless bookkeeping hygiene, unrelated to which Viewer API is called.

## Task 1: Switch `_reconcileIsolation()` to `setAggregateIsolation`, update tests, add regression coverage

- [ ] In `wwwroot/extensions/ClashFinderExtension.js`, rewrite `_reconcileIsolation()`'s body after
      the union is built: replace the two per-model `this._viewer.isolate(...)` loops with
      exactly one call:
      ```js
      const isolation = [];
      for (const [model, dbIdSet] of union) {
        isolation.push({ model, ids: [...dbIdSet] });
      }
      this._viewer.setAggregateIsolation(isolation);
      this._isolatedModels = new Set(union.keys());
      ```
      Rewrite the method's own comment block to describe the new one-call design and cite the
      evidence above (exact method name, the "full replace / hides every other loaded model"
      semantics, the `[]` clear-all case) instead of the old per-model-loop rationale. Remove
      comment text that no longer applies (e.g. references to "one isolate() call per model",
      "the merge-base's own fail-safe... incremental commit" reasoning that was about surviving a
      partial-loop throw — there is no loop to partially fail anymore).
  - [ ] Update every other comment in the file that describes the old per-model `viewer.isolate(...)`
      reconciliation mechanism (constructor comment on `_isolatedModels`, `_setHardIsolation`/
      `_setSoftIsolation`/`_clearIsolation`'s own comments, `_onBeforeModelUnload`'s comments about
      "one of its internal viewer.isolate([], model) calls") so nothing in the file misdescribes
      the mechanism that's actually running. Do not touch unrelated comments/logic (Soft Clash
      visualization, markers, action tokens, overlay scenes).
  - [ ] `test/ClashFinderExtension.test.mjs` and `test/ClashFinderExtension.softClash.test.mjs`
      both define their own `makeMockViewer()` with `isolate() {}`. Add `setAggregateIsolation() {}`
      as a default no-op stub alongside it in both files (the extension no longer calls
      `viewer.isolate` at all after this change, so leaving its stub in place is harmless but no
      test should assert against it going forward — every isolation assertion in both files must
      move to `setAggregateIsolation`).
  - [ ] Update every existing test in both files that currently does
      `viewer.isolate = (dbIds, model) => isolateCalls.push({ dbIds: [...dbIds], model })` (or
      equivalent) and asserts on per-model `isolateCalls`: replace with
      `viewer.setAggregateIsolation = (isolation) => aggCalls.push(isolation.map((e) => ({ model: e.model, ids: [...e.ids] })))`
      (or equivalent capturing pattern) and rewrite the assertions against the captured array-of-
      `{model, ids}` shape. Where a test currently inspects "the isolate call for modelB" via a
      `lastCallForModel(model)` helper, rewrite it to find the entry for that model inside the
      most recent (or relevant) `setAggregateIsolation` array instead. Where a test currently
      counts "isolate called N times" to mean "N models isolated", that becomes "the
      `setAggregateIsolation` array has N entries" in a single call (this is a real semantic
      change worth preserving as a comment: one aggregate call replaces what used to be N calls).
      This applies file-wide — do not leave any test still assigning to `viewer.isolate` as its
      isolation-observation mechanism. `_isolatedModels`-based assertions (`.size`, `.has(model)`)
      keep working unchanged in the happy-path cases, since that field is still maintained (see
      above) — only the isolate-call-shaped assertions need rewriting.
  - [ ] **Remove the obsolete partial-mid-loop-throw test block** in
      `test/ClashFinderExtension.softClash.test.mjs`, roughly lines 1153-1254 (the block headed
      `=== [final fix wave, whole-branch review Important #1] _reconcileIsolation() commits its
      "_isolatedModels" bookkeeping INCREMENTALLY...` through the `(c) Happy path unchanged` test,
      ending right before the `=== r71/r185 isolation...` section). These three tests
      ((a) first-loop throw, (b) second-loop throw, (c) happy path) exist specifically to prove
      the old N-calls-with-partial-failure bookkeeping was correct. That failure mode is gone:
      `_reconcileIsolation()` now makes exactly one `setAggregateIsolation()` call, which either
      throws (nothing was committed — `_isolatedModels` stays at its PRIOR value, propagate
      uncaught) or succeeds (everything was committed — `_isolatedModels` becomes the union's key
      set). Replace the removed block with two small tests covering exactly that:
      1. Happy path: after `_reconcileIsolation()` with a non-empty union, `_isolatedModels`
         equals the union's key set (keep this assertion shape — the equivalent of old test (c)).
      2. Throw path: stub `viewer.setAggregateIsolation` to throw; call `_reconcileIsolation()`
         directly (same direct-call pattern the removed tests used — set
         `ext._hardIsolationByModel`/`ext._softIsolationByModel` then call
         `ext._reconcileIsolation()`); assert the throw propagates uncaught AND `_isolatedModels`
         is unchanged from whatever it was before the call (e.g. seed it with a prior successful
         reconcile first, then prove the failing call didn't touch it).
  - [ ] Add these four regression tests (new test blocks, either file is fine — prefer
      `test/ClashFinderExtension.test.mjs` near the other direct `_reconcileIsolation()`/
      `_setHardIsolation()`/`_setSoftIsolation()`/`_clearIsolation()` tests, following this file's
      existing bare `check()` harness style, no new test framework):
      1. **Multi-model Hard + Soft union applied as one aggregate operation.** Hard isolates
         `{modelA: [10]}`, Soft isolates `{modelB: [20]}` (or a shared-model union case like the
         existing Task 15 test in the softClash file) — after both actions run, assert
         `setAggregateIsolation` was called exactly once for that reconcile (or: the relevant
         call's array has exactly the expected entries) with an array containing one `{model,
         ids}` entry per model in the union, each `ids` array holding the correctly-unioned dbIds.
      2. **Clearing one mode preserves the other mode's model/dbId isolation.** With Hard and Soft
         both active (e.g. Hard on modelA, Soft on modelB, or both on a shared model with distinct
         dbIds), clear Hard only (`_setHardIsolation(new Map())` or the zero-result/clear
         context-menu path) and assert the resulting `setAggregateIsolation` call's array still
         contains Soft's own untouched model/dbIds, with Hard's contribution gone.
      3. **Clearing both restores the full aggregate view.** With Hard and Soft both active, clear
         both (`_clearIsolation()`), and assert the resulting `setAggregateIsolation` call was
         made with an empty array (`[]`) — the documented clear-all case.
      4. **No per-model `viewer.isolate(...)` calls remain in the reconciliation path.** A
         source-text regression guard mirroring this file's own existing "never imports the npm
         `three` package" pattern (`readFile` the extension source, assert on its content): read
         `wwwroot/extensions/ClashFinderExtension.js` and assert it contains no
         `this._viewer.isolate(` call site (a plain substring/regex check is fine — the existing
         r71/r185 guard tests use the same style). Comments mentioning `isolate(` in prose are
         fine to remain; this guard is specifically about `this._viewer.isolate(` as a call.
  - [ ] Run `node --test test/ClashFinderExtension.test.mjs test/ClashFinderExtension.softClash.test.mjs`
      until fully green, then run the full suite (`npm test`) and confirm no unrelated regressions.
  - [ ] Commit this task's changes as one commit (production file + both test files together —
      they are one coherent, indivisible change). Do not commit unrelated files.

### Global Constraints (binding on this task, copy into the reviewer dispatch)

- Preserve existing per-action isolation UNION semantics (Hard ∪ Soft, per model) — only the
  Viewer call mechanism changes, not the union computation.
- Preserve independent Hard Clash / Soft Clash action tokens — do not touch
  `_latestActionToken`/`_latestSoftClashActionToken` logic.
- Preserve both overlay scenes (`MARKER_OVERLAY_NAME`, `SOFT_CLASH_OVERLAY_NAME`) and their
  independent marker/line visualization code — untouched.
- No changes under `collision/**` (collision-core).
- No result-set abstraction of any kind.
- No M4 work — this is a narrow M3-adjacent correctness fix only.
- After this task, zero call sites of `this._viewer.isolate(` remain in
  `wwwroot/extensions/ClashFinderExtension.js` (production code) — enforced by regression test 4
  above.
- `setAggregateIsolation`'s exact argument shape is `Array<{ model, ids }>` where `ids` is a plain
  array of numbers (not a `Set`) — the production code and every test mock must agree on this
  shape.
