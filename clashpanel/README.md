# clashpanel — Viewer Clash Panel (host-composition contract)

Governing design: `docs/superpowers/specs/2026-09-26-viewer-clash-panel-design.md` (the spec). This package is
the Panel only. It is **not integrated into any host yet**. Every live claim is gated (see "Gates").

## Layers

| Path | Role | May use |
|---|---|---|
| `core/` | headless controller + view-model (all workflow/domain state) | siblings, and optionally the public barrel `clashtest/index.js` (not imported today: Core errors are matched by `error.name`); no Autodesk, window, document, THREE |
| `viewer/` | `ViewerBridge`, the only code that changes the 3D scene (overlay markers/outlines, guarded isolation, fit) | the Viewer facade, `THREE` and event names, all injected |
| `ui/` | thin `DockingPanel` shell + DOM renderers of the view-model; text only through `textContent` | DOM, `Autodesk.Viewing.UI.DockingPanel` |
| `index.js` | `createClashPanel(...)` composition | the three layers above |

## Composition

```js
import { createClashPanel } from '/clashpanel/index.js';

const panel = createClashPanel({
  Autodesk,                    // the global namespace; the Panel uses only Autodesk.Viewing.UI.DockingPanel
  viewer,                      // a Viewer3D (GuiViewer3D) instance; the panel mounts into viewer.container
  THREE: window.THREE,         // the Viewer's own r71 THREE, never npm `three`
  engine,                      // the host-built clash-test engine (EnginePort below)
  catalog,                     // the host's read-only ModelCatalog (below)
  events: {
    BEFORE_MODEL_UNLOAD: Autodesk.Viewing.BEFORE_MODEL_UNLOAD_EVENT,
    MODEL_REMOVED: Autodesk.Viewing.MODEL_REMOVED_EVENT,
  },
  // scheduler?  { now, setTimeout, clearTimeout, yield }  default: global timers
  // doc?        Document used for rendering                default: the viewer container's document
});
panel.show(); panel.hide(); panel.toggle(); panel.isVisible();
await panel.dispose();         // shell → controller (cancels an active run 'panel-disposed', waits for its `done`,
                               // releases results, restores guarded isolation, removes Panel markers) → bridge
```

`dispose()` is idempotent (it returns the same promise). It resolves only after the active run's `done` has settled,
its result set is released and the bridge is disposed, so it stays pending while Core drains the in-flight work
unit. **Await `panel.dispose()` before `engine.dispose()`.** Both are bounded by Core's drain of the in-flight unit
and unbounded only by an executor that never returns (Core open item O9); `engine.dispose()` signals runs and then
awaits their drain, it does not force-resolve them, and there is no Panel-side escape hatch. Every step runs even
when an earlier one fails; the controller reports release problems as `{released, errors}` and those are folded in:
if any step failed or a set could not be released, `dispose()` rejects with an `AggregateError` **after** all
steps ran, so the host must `await` it inside `try/catch` (for example in the extension's `unload()`).

Several panels may share one viewer: each gets overlay scenes named after its `id`
(`clash-panel-markers:<id>`, `clash-panel-outlines:<id>`), so clearing or disposing one never touches another's
meshes. Give each panel a distinct `id` (default `clash-detection-panel`).

The toolbar button, the extension class and its registration are **host shell** code, not part of this package
(gate H1).

## Ports the host must supply

### EnginePort (a structural subset of the clash-test engine)

`validateTest`, `startRun`, `retainResultSet`, `releaseResultSet`, `getPersistenceState`, `getFreshness`,
`assessNoClashClaim`, `derivations.{summarize, groupBy, filter}`, `registry.bindingFor`. The Panel narrows whatever
it is given to exactly these members. It **never** calls `registry.register`, `registry.unregister`,
`invalidateModelPlacement`, `wireModelUnload`, or any model-identity derivation (PD-18).

### ModelCatalog (read-only, host-computed)

| Member | Contract |
|---|---|
| `list()` | the models currently in the scene: `[{ modelKey: string \| null, displayName: string, model, loaded: boolean }]`. `modelKey` is `null` when the host has not identified/registered that model. `loaded` means load complete **and** object tree available. |
| `displayNameFor(modelKey)` | `string \| null`; must survive unload (rows of unloaded models keep their name). |
| `keyOfModel(model)` | `string \| null`; a `WeakMap<Model, modelKey>` that survives unload/unregister. |
| `onChange(cb)` | returns an unsubscribe function; fires on model add/remove **and** readiness changes. |
| `measurementBasis(modelKeys)` | `BasisVerdict` or a promise of one: `{ state: 'verified', basisKey }` or `{ state: 'unverified' \| 'incompatible', reason }`. A missing method, a throw, a timeout or any other shape is treated as unverified. Soft (clearance) is available only for one model or a `verified` verdict (PD-17). |

### Host responsibilities (never done by the Panel)

* load the models as **SVF2** (PD-15);
* build the collision world, the engine and the element enumerator;
* register every model with `engine.registry.register(modelKey, model, { modelVersion })`, and register again
  after a reload; the `modelKey`/`modelVersion` derivation is **OQ-1**;
* wire unload with `wireModelUnload` from `clashtest/viewer/index.js`;
* call `invalidateModelPlacement` when a model moves (PR-OQ17);
* supply the measurement-basis evidence behind `measurementBasis` (PR-BASIS);
* serve `/clashtest/**` and `/clashpanel/**` as static JavaScript to the page (today `server.js` serves only
  `wwwroot/` and `/collision`, so nothing in this repository loads the Panel yet).

## What the Panel does and does not do in the 3D scene

It adds only its own overlay meshes (scenes `clash-panel-markers:<id>` and `clash-panel-outlines:<id>`), changes aggregate
isolation only when the Isolate toggle is on and the isolation prerequisite holds (restoring it only if nobody
else changed it since), and fits the camera best-effort. It never calls a theming method, never changes the
Viewer selection and never restores the camera.

## Gates (open; nothing here is live-verified)

Nothing in this package has run against a live Viewer, a live engine run or an SVF2 model. It does **not** claim
SVF2 support and is **not** production-ready. Plan gate ids (implementation plan, "Gated work") are given with the
spec's pending-research ids; each needs its own explicit owner authorization.

| Gate | What stays unproven until it closes |
|---|---|
| **G1** (PG-4) SVF2 verification of F1–F8 | every model-format-sensitive assumption; the offline and DOM suites use fakes only. Earlier SVF (non-OTG) evidence is not SVF2 evidence |
| **G2** (PG-1) live ViewerBridge / DockingPanel verification on SVF2 (overlays, isolation, fit, element bounds, DockingPanel lifecycle) | the bridge suites use a fake Viewer and the DOM suite uses a DockingPanel **stub** that mirrors source-observed semantics; the stub's lifecycle assumptions (constructor order, one visibility listener, `uninitialize()` behaviour) are unverified |
| **G3** (PG-2 / PG-3 / PG-5) Panel live acceptance | the first live engine run through the Panel; any claim about scale; page size stays a presentation constant, not a limit |
| **H1** (PR-HOST) host composition | model loading, engine/world construction, registration, unload wiring, static serving, the extension/toolbar class — none exists yet |
| **H2** OQ-1 / PR-OQ17 / PR-BASIS | `modelKey`/`modelVersion` derivation and reload identity; who calls `invalidateModelPlacement`; measurement-basis evidence (Soft for more than one model) |

## Tests

* `npm test` — the default gate: the offline suites (`npm run test:offline`) and then the DOM suite. Either half
  failing fails it; it needs Playwright's Chromium (`npx playwright install chromium`).
* `npm run test:offline` — the repository's offline Node suite, including the Panel's headless core and bridge
  suites (never launches a browser).
* `npm run test:clashpanel:dom` — the renderers, the shell and an end-to-end slice in headless Chromium over fake
  ports (`test/clashpanel/dom/`); part of `npm test`, available alone for targeted runs.
