# Viewer Clash Panel demo-ready package: internal review

Date: 2026-10-06 · Base: `main` @ `eeb356d` plus the uncommitted working tree · Reviewer: Claude (internal, read-only)
Package prompt: `docs/prompts/for-claude-viewer-clash-panel-demo-ready-product-facing-package.md` (§6, §11-§14, §17, §18)

Scope reviewed: `server.js`, `wwwroot/viewer.js`, `wwwroot/viewerOptions.js`, `wwwroot/main.js`, `wwwroot/main.css`,
`wwwroot/clashPanelDemo.js`, `wwwroot/extensions/{ClashPanelExtension,clashPanelHost,clashPanelNames}.js`,
`clashpanel/ui/ClashDockingPanel.js` (geometry diff), the edited tests `test/clashpanel/layering.test.mjs` and
`test/viewer.extensionIds.test.mjs`, the new tests that existed when the review ran, and the evidence in
`docs/research/2026-10-06-viewer-clash-panel-demo-ready/` (gap note, plus snapshots 06 and 08 viewed).
Live headed facts come from the controller and were **not** re-run here.

## Findings

### Critical
None.

### High
None.

### Medium

**M1. The default path now eagerly loads the whole clashtest + clashpanel module graph.**
`wwwroot/viewer.js:6` statically imports `ClashPanelExtension.js`. That file statically imports `clashPanelHost.js`
(`wwwroot/extensions/ClashPanelExtension.js:6`), which statically imports `../../clashtest/index.js`,
`../../clashtest/viewer/index.js` and `../../clashpanel/index.js` (`wwwroot/extensions/clashPanelHost.js:11-14`).
Behaviour on the default path is unchanged: SVF initializer, panel not in `config.extensions`, tests confirm.
The module graph, however, is not unchanged. Even without `?clashPanel=1`, every page load now fetches and
evaluates the clashtest and clashpanel trees.
- *Failure scenario:* Suppose any module in those trees fails to resolve or evaluate. Examples: a deployment or
  static host that serves only `wwwroot/` and `/collision` without the two new `server.js:9-10` routes, a stale
  cache, or a syntax feature unsupported by the browser. Then `main.js` never runs, so **Room Locator and Clash
  Finder break in default mode**, even though the user never asked for the panel. A module-graph failure is fatal to
  the whole entry point, unlike the extension's own `try/catch` + `alert`.
- *Fix (in scope, small):* in `ClashPanelExtension._ensureHost`, load the host with
  `await import('./clashPanelHost.js')` (keep `options.createHost` injection for tests). That keeps
  `registerExtension` cheap and confines a load failure to the panel's existing alert path.

**M2. Fit-to-view framing is often not useful for the dominant result shape (product / spec decision, not fixable in this package).**
- Fit frames the union of both elements (spec §9.2/§16, `clashpanel/viewer/ViewerBridge.js`). Many of the 491 results
  pair a small MEP part with the large Structure `Floor [401326]` (snapshot `06-result-selected.png`, rows #1-#4,
  #6). For those, the camera frames the whole floor and the clash is a speck. The marker radius (0.2 % of the
  union bounding sphere) is also tiny.
- Snapshot `08-markers.png` (beam × elbow) is acceptable, but the marker is still barely visible.
- Prompt §6 asks that the "camera lands in a useful framing". Prompt §8 says a visibly wrong framing is a product bug.
  Here the framing follows the accepted spec, so changing it (for example, fitting to the clash point or the
  smaller element, or using a minimum marker size) is a spec or product change. Under the prompt's §13 boundaries
  that belongs to the owner.
- *Disposition:* record it as a known product limitation with an owner decision. Do not silently mark §8 PASS for
  Floor-type clashes.

**M3. "Selecting corresponding Viewer objects" (prompt §4) is not implemented (product decision).**
- The panel never calls `viewer.select` (`clashpanel/README.md`: "never changes the Viewer selection", spec §9.2
  deferral). It shows the clash with markers, outlines, isolate and fit instead.
- *Failure scenario:* a demo viewer expects the two elements to be highlighted in the Viewer's selection color, or to
  appear in the Properties panel, and sees neither.
- Adding selection sync would be a scope change (§13), so this must go to the owner. It must not be closed in this
  package, and the evidence report must not claim §7 item 7 ("Viewer objects highlighted/selected") as PASS
  without this caveat.

### Low

- **L1. The toolbar button never reflects panel state.** `wwwroot/extensions/ClashPanelExtension.js:52-60` creates the
  button and never calls `setState`. The button is therefore never "active", not merely out of sync after the X
  close. A `host.isVisible()` read plus the panel's shown/hidden callback would fix it.
- **L2. A double click before the host exists leaves the panel closed.**
  - In `ClashPanelExtension.js:79-91`, two clicks during the first `_ensureHost()` share one promise, then each runs
    `host.toggle()`: show, then hide.
  - `CollisionWorld.fromViewer` makes the first creation non-trivial in time, so an impatient double click is
    plausible.
  - Fix: record the intent once (`_pendingToggle`) or call `host.show()` on the first creation.
- **L3. A rejected registration is retried and re-reported on every viewer event.**
  - In `clashPanelHost.js:66-75`, `loadSeq` is consumed before `registry.register`. On a throw, the model is not
    recorded in `keyByModel`, so each `MODEL_ADDED`, `GEOMETRY_LOADED` or `OBJECT_TREE_CREATED` event, and each
    `list()` call, retries it and reports again.
  - The keys stay unique (no correctness issue), but the console fills with noise and the numbering gaps grow.
- **L4. Catalog listeners outlive `engine.dispose()`.**
  - In `clashPanelHost.js:173-179`, the catalog is disposed after the engine. A `MODEL_ADDED` event fired while
    `engine.dispose()` drains makes the catalog call `registry.register` on a disposing engine.
  - The error is caught and reported (`safeReport`), so the effect is noise only.
  - Moving the catalog's listener removal before `engine.dispose()` would still honour the README rule (panel before
    engine).
- **L5. Async `unload()` keeps running after the viewer is torn down.**
  - The Viewer does not await an extension's `unload()` promise. On `viewer.finish()`, `panel.dispose()` and the
    later steps run against a dead viewer.
  - Failures land in the AggregateError and are only `console.warn`ed (`ClashPanelExtension.js:108-115`).
  - This is acceptable for a demo; document it.
- **L6. A non-secure context gives a hard creation failure.**
  - Served over plain `http://<LAN-IP>`, `globalThis.crypto.randomUUID` is undefined (`clashtest/engine.js:149`,
    `clashpanel/core/controller.js:37`).
  - Host creation then fails and the user gets the generic alert. It is recoverable but undiagnosed.
  - Only `localhost` and https work; note this in the launch instructions.
- **L7. The panel geometry is hard-coded in the frozen UI layer.**
  - `clashpanel/ui/ClashDockingPanel.js:34-54` sets fixed sizing: 460 px wide, `height: calc(100% - 80px)`,
    `resize: none`.
  - On a short or narrow viewer the panel covers most of the canvas.
  - The fit also ignores the occlusion: the left ~460 px of the canvas is behind the panel, so a framed target can
    land under it.
  - This also modifies a file that the G2 evidence was captured against. That is acceptable under fix policy §12
    (visible UI defect), but it should be noted in the handoff as a post-G2 change to `clashpanel/ui/`.
- **L8. The section headings are visibly numbered.** "3 FILTERS / GROUPING", "4 RESULTS" and "5 SELECTED CLASH" in
  snapshots 06/08 read like debug numbering. The "4 RESULTS" heading also looks like a result count ("4 results")
  next to a 10-page list. This could confuse a demo audience; it is cosmetic.
- **L9. Demo and hash interplay.**
  - In `?clashPanelDemo=1`, the initial hash is ignored (`main.js:68`). A later `hashchange` still loads through
    `request()` with the checkbox's `keepCurrentModels`, which can unload the demo pair.
  - This is consistent with the existing UX; document it.
- **L10. The `modelVersion` witness may carry a double prefix.** `clashPanelHost.js:69` builds `urn:${urn}`, and if
  `model.getData().urn` already starts with `urn:` the result is `urn:urn:...`. This is cosmetic, interim OQ-1 only.

## Verified OK

- **Teardown order** (`clashPanelHost.js:173-179`): panel (awaited), engine, wiring, catalog, world. Every step runs.
  A single AggregateError is thrown afterwards, and `dispose()` is idempotent through the memoised promise.
- **Partial construction** (`:160-171`): it unwinds whatever exists in the same order and rethrows the original
  error.
- **Extension lifecycle:**
  - Lazy creation produces one host per extension instance, so repeated toggles do not leak.
  - A failed creation clears `_hostPromise` so the user can retry (`:74`).
  - If `unload()` races creation, `unload()` awaits and disposes the host, and `toggle()` bails because
    `_unloaded` is set (`:89`).
  - Toolbar removal is synchronous and happens before the async disposal.
  - The `TOOLBAR_CREATED` listener is removed in both paths.
- **Catalog behaviour:**
  - `loaded` = `isLoadDone()` AND `getInstanceTree()` present, matching README "load complete and object tree
    available".
  - `keyOfModel` is a WeakMap that survives unload.
  - `displayNameFor` survives unload (strings only).
  - `onChange` returns an unsubscribe function.
  - The catalog fires on add, remove, geometry and tree events.
  - A reloaded model is a new object, so it gets a new never-reused key `urn#N`, which avoids
    `ModelKeyVersionConflictError` by construction. Unregistration on unload is done by `wireModelUnload`.
- **No `measurementBasis`**: Soft multi-model fails closed. The semantics are unchanged, so PD-17 is respected.
- **Demo loader** (`clashPanelDemo.js`):
  - Models load sequentially, the first with `keepCurrentModels:false` and the rest with `true`.
  - Readiness = geometry loaded + object tree. The listener is attached synchronously after the `isLoadDone` check,
    so there is no missed-event gap.
  - It has a 180 s timeout with cleanup, and errors surface through `main.js` `catch` + alert.
  - It never writes the hash.
- **Security:**
  - Query parameters are only booleans parsed against a fixed truthy set (`viewerOptions.js:11-15`). No URN or
    other value is read from the query.
  - The demo URNs are hard-coded constants copied from the acceptance test.
  - The new wwwroot files contain no `innerHTML`, `insertAdjacentHTML` or `outerHTML`.
  - `alert()` renders plain text.
  - The new static routes expose only `.js` files and READMEs (no secrets; dotfiles ignored by default).
- **Default path behaviour:**
  - The initializer is still `{env:'AutodeskProduction', getAccessToken}` with no `api`.
  - `config.extensions` = DocumentBrowser + Room Locator + Clash Finder only. The panel is registered but not
    auto-loaded (`viewer.js:30-40`).
  - All of this is asserted by the edited test. See M1 for the module-graph caveat.
- **Edited tests are legitimate and strengthen coverage:**
  - `layering.test.mjs` allow-lists exactly one file with exactly one import list (`../../clashpanel/index.js`). It
    also asserts that the file exists, so the allow-list cannot go stale or widen silently. Every other file under
    `clashtest/`, `collision/` and `wwwroot/` is still guarded.
  - `viewer.extensionIds.test.mjs` raises the registration count 2→3 to match the new registration.
  - It adds default-path assertions: no panel in `extensions`, legacy env, no `api`.
  - It adds opt-in assertions: `AutodeskProduction2`/`streamingV2`, with all three extensions present.
- **Scope discipline:**
  - `git status` shows no changes under `clashtest/`, `collision/`, `test/acceptance/`, the G2
    harness/authorization artifacts or `docs/handoffs/`.
  - The only `clashpanel/` change is the UI geometry (L7).
  - Nothing was committed.
- **Tests run (individual `node --test`, all green):**
  - `test/clashpanel/layering.test.mjs` 17/17
  - `test/viewer.extensionIds.test.mjs` 21/21 checks
  - `test/ClashPanelExtension.test.mjs` 6/6
  - `test/clashPanel.host.test.mjs` 9/9
  - `test/clashPanel.viewerOptions.test.mjs` 4/4
  - `test/clashpanel/hostStyles.test.mjs` 3/3
  - `test/clashpanel/scaffold.test.mjs` 2/2
  - Not run here: the full offline suite, the Playwright DOM suite, and any live or acceptance run.

## Verdict

**0 Critical / 0 High / 3 Medium / 10 Low.**

- **M1 is in scope and cheap to fix:** a dynamic `import()` of the host in `_ensureHost`. It should be fixed before
  the package is marked ready, because the package's own invariant is "default path unchanged".
- **M2 and M3 are not code defects within this package's authority.** They are product/spec decisions (fit target
  and marker scale; Viewer selection sync) and must be recorded as owner decisions and known limitations in the
  evidence report and handoff. They must not be presented as PASS.
- The Lows can be dispositioned as known limitations or polish. L1 (button state) and L2 (double-click) are trivial
  in-scope fixes if desired.

With M1 fixed and M2/M3 explicitly recorded, the package is fit to present for independent Work visual/product review.
It remains subject to the unchanged interim-OQ-1 and G2/C8 verification-debt caveats, which are correctly kept
separate.
