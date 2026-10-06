# Viewer Clash Panel — demo-ready implementation-gap note

Date: 2026-10-06 · Base: `main` @ `eeb356d` · Type: read-only investigation (no code changed, no live run).
Authority for the package: `docs/prompts/for-claude-viewer-clash-panel-demo-ready-product-facing-package.md` (untracked prompt).

Labels: **[V]** verified by reading source/evidence at the cited line; **[I]** inferred; **[U]** not verified.

## 0. Summary

- The Panel (`clashpanel/`) is complete over fakes and is a single composition call, `createClashPanel(...)`
  (`clashpanel/index.js:61`). **Nothing in the sample composes it**: `server.js:7-8` serves only `wwwroot/` and
  `/collision`, `wwwroot/viewer.js:23-29` registers only Room Locator and Clash Finder. [V]
- Every engine/world/enumerator part exists and **has been composed in a real browser before**. The T3 adapter
  acceptance does exactly `CollisionWorld.fromViewer` → `createViewerElementEnumerator()` → `createClashTestEngine({world, enumerator})` → `engine.registry.register(...)` → `wireModelUnload(...)`
  (`test/acceptance/clashtest-viewer-adapter.acceptance.mjs:545-600`). [V] What has never run is a **real engine run**
  (real `LocalUnitExecutor` over a real world) through the Panel (`clashtest/README.md`, "Verification status"; plan G3). [V]
- **SVF2 is a sample-config problem, not a code problem.** Translation already requests SVF2 (`services/aps.js:67-69`). The
  sample initializes with `env:'AutodeskProduction'` and no `api` (`wwwroot/viewer.js:23`), so models load through the
  legacy SVF path (`isOTG:false`). G1 shows that `env:'AutodeskProduction2', api:'streamingV2'` loads the same objects as
  confirmed SVF2 (`test/acceptance/g1-svf2-f1-f8-verification.mjs:2159`; screening doc table rows 14-19). No product
  code checks the format, so non-SVF2 models are neither refused nor flagged. [V]
- **OQ-1 has no helper anywhere.** The spec's interim policy is a fresh key per load plus a host-supplied version
  witness (panel spec §11.1 line 462, OD-8 line 660).
- **Fixture choice matters:** under SVF2, whole-model enumeration of Audubon **Architecture** fails closed
  (`EnumerationInconsistencyError` / `tree-reachable-fragment-unattributable`). **Mechanical + Structure** are the evidenced
  SVF2 pair (`docs/research/2026-09-29-g1-svf2-fixture-capacity-screening.md:14-18,52`). RAC exceeds `maxSyncTriangleCount`
  (21,845 > 12,000, line 19). [V]

## 1. What the host must build (H1 / PR-HOST)

Contract: `clashpanel/README.md:13-90`; plan "H1" (`docs/superpowers/plans/2026-09-26-viewer-clash-panel-implementation-plan.md:19539`).

| Port / duty | What to build | Reuse |
|---|---|---|
| `Autodesk`, `viewer`, `THREE` | `window.Autodesk`, the `GuiViewer3D`, `window.THREE` (the Viewer's r71, never npm `three`) | `wwwroot/viewer.js` |
| `events` | `{ BEFORE_MODEL_UNLOAD: Autodesk.Viewing.BEFORE_MODEL_UNLOAD_EVENT, MODEL_REMOVED: Autodesk.Viewing.MODEL_REMOVED_EVENT }`. These are required; otherwise `createClashPanel` throws a TypeError (`clashpanel/index.js:20-25`) | — |
| World | `await CollisionWorld.fromViewer(viewer, {})` (`collision/CollisionWorld.js:645`). The defaults `narrowPhase:'three-mesh-bvh'` and `indexOwnership:'clone'` are the only options it supports | `collision/index.js:10`. Clash Finder builds its own world the same way (`wwwroot/extensions/ClashFinderExtension.js:182`). The Panel needs its **own** world (spec line 401); reusing Clash Finder's world would share placement and contend on it (OQ-11) |
| Enumerator | `createViewerElementEnumerator()`. Optional args: `{scheduleTimeout, clearScheduled, readinessPollMs}` (`clashtest/viewer/ViewerElementEnumerator.js:80`) | `clashtest/viewer/index.js` |
| Engine | `createClashTestEngine({ world, enumerator })` (`clashtest/engine.js:475-516,1377`). Defaults: the registry comes from the world coordinator, `unitExecutor` is `createLocalUnitExecutor(...)`, and both stores are in-memory. `world` and `enumerator` are required. Pass no `registry` (a foreign one throws `registry-mismatch`) | `clashtest/index.js` |
| EnginePort | The Panel narrows to `validateTest, startRun, retainResultSet, releaseResultSet, getPersistenceState, getFreshness, assessNoClashClaim, derivations.{summarize,groupBy,filter}, registry.bindingFor` (`clashpanel/core/ports.js` ENGINE_METHODS). The real engine has all of them (`clashtest/engine.js:76-85,1359`). `test/clashpanel/core/realEngineContract.test.mjs` already drives the controller with the real engine, but with a **scripted** executor | pass `engine` as-is |
| Registration | `engine.registry.register(modelKey, model, { modelVersion })` for each loaded model, and again after every reload. `modelVersion` must be a non-empty string. Re-using a key with a different version throws `ModelKeyVersionConflictError` for the registry's whole lifetime (`clashtest/identity/ModelRegistry.js:67-103`) | none (OQ-1, §3) |
| Unload wiring | `wireModelUnload({ world, registry: engine.registry, eventTarget: viewer, eventName: Autodesk.Viewing.BEFORE_MODEL_UNLOAD_EVENT, report })`, then `.dispose()` on unload (`clashtest/viewer/unloadWiring.js:9-36`) | as-is |
| `invalidateModelPlacement` (PR-OQ17) | Not needed for a demo that never moves models; record as a limitation | — |
| ModelCatalog | `list()` → `[{modelKey|null, displayName, model, loaded}]`, where `loaded` means load done **and** object tree created. Also `displayNameFor(key)`, `keyOfModel(model)` (a WeakMap that survives unload), and `onChange(cb)` → unsubscribe (fire on MODEL_ADDED/REMOVED, GEOMETRY_LOADED, OBJECT_TREE_CREATED). `measurementBasis` is optional (`clashpanel/README.md:63-71`, `clashpanel/core/ports.js` `assertCatalogPort`) | new host code. The display name can come from `model.getData().loadOptions.bubbleNode.name()` or the URN [U] |
| `measurementBasis` (PR-BASIS) | **Omit it for the demo.** Omitted means "unverified", so Soft is unavailable for multi-model tests and Hard is unaffected; a single-model Soft test stays allowed (`ports.js` `readBasisVerdict`; spec line 232). Returning `verified` without evidence would change accepted semantics (PD-17) | — |
| Static serving | `server.js`: `app.use('/clashtest', express.static('clashtest'))` and `app.use('/clashpanel', express.static('clashpanel'))` | the `/collision` precedent at `server.js:8` |
| Extension / toolbar | `wwwroot/extensions/ClashPanelExtension.js`: in `onToolbarCreated`, add a `ControlGroup` + `Button` that toggles the panel. In `unload()`, `await panel.dispose()` **before** `engine.dispose()`, then wiring.dispose, world.dispose, inside try/catch because `dispose()` may reject with an AggregateError (`clashpanel/README.md:31-40`) | Room Locator / Clash Finder extension pattern; registration goes in `wwwroot/viewer.js:24-29` |

### Minimal composition recipe (real signatures)

```js
import { CollisionWorld } from '/collision/index.js';
import { createClashTestEngine } from '/clashtest/index.js';
import { createViewerElementEnumerator, wireModelUnload } from '/clashtest/viewer/index.js';
import { createClashPanel } from '/clashpanel/index.js';

const V = Autodesk.Viewing;
const world = await CollisionWorld.fromViewer(viewer, {});
const engine = createClashTestEngine({ world, enumerator: createViewerElementEnumerator() });
const wiring = wireModelUnload({ world, registry: engine.registry, eventTarget: viewer,
  eventName: V.BEFORE_MODEL_UNLOAD_EVENT, report: (stage, e) => console.warn('unload', stage, e) });
const catalog = createHostCatalog(viewer, engine.registry);   // new: list/displayNameFor/keyOfModel/onChange; registers on load (OQ-1 interim)
const panel = createClashPanel({ Autodesk, viewer, THREE: window.THREE, engine, catalog,
  events: { BEFORE_MODEL_UNLOAD: V.BEFORE_MODEL_UNLOAD_EVENT, MODEL_REMOVED: V.MODEL_REMOVED_EVENT } });
// unload: try { await panel.dispose(); } catch (e) {…} ; await engine.dispose(); wiring.dispose(); world.dispose();
```

[I] Disposal order after the Panel (engine, then wiring, then world) follows the README rule "panel before engine". The
order of the world relative to the wiring is not specified anywhere I read.

## 2. SVF vs SVF2 (PD-15)

- **Requirement:** PD-15 makes SVF2 the required v1 path (panel spec line 115; §2.1 lines 77-96, F1-F8). This is a
  design/evidence requirement. **No code enforces it:** there is no `isOTG`/`isSVF2` read in `clashpanel/`, `clashtest/`,
  `collision/` or `wwwroot/` (grep). Non-SVF2 models are neither refused nor flagged; they simply run on the SVF-evidenced
  path (Adapter envelope "SVF non-OTG", `clashtest/viewer/README.md`). An SVF2 inconsistency would fail closed as
  `enumeration-failed`. [V]
- **Current sample:** translation emits SVF2 (`services/aps.js:67-69`), but the initializer is
  `{ env: 'AutodeskProduction', getAccessToken }` (`wwwroot/viewer.js:23`). Seven models observed through it reported
  `isOTG:false` (`docs/research/2026-09-27-g1-svf2-agent-kit-and-initializer-diagnosis.md:68-110`). [V]
- **Way to load SVF2 in this sample:** change the initializer to `{ env: 'AutodeskProduction2', api: 'streamingV2', getAccessToken }`.
  `loadDocumentNode(doc, doc.getRoot().getDefaultGeometry(true), {keepCurrentModels})` stays unchanged. This is the exact
  pattern the G1 harness used, with `isOTG()/isSVF2()` both `true` (`CONFIRMED_SVF2`) on Mechanical, Structure,
  Architecture, RAC and two small models. A `useOTG` viewer config or a `search({outputType:'svf2'})` is **not needed**
  and was not used. [V for the pattern; U whether it changes Room Locator / Clash Finder behavior on SVF2, which only G1
  F-checks partially cover]
- **Is it a demo blocker?** No. It is a one-line, in-scope host change that **implements** PD-15 rather than changing
  semantics. Risks:
  - the existing extensions have only SVF evidence;
  - G1 closed `PARTIAL` (F7 `NOT_EVIDENCED`);
  - Architecture fails whole-model planning under SVF2.

  **Minimal in-scope approach:** switch the sample initializer to SVF2. Use **Structure + Mechanical** (URNs are literal
  constants at `test/acceptance/clashpanel-viewerbridge.acceptance.mjs:109,111`) as the demo pair. Optionally log or
  display `model.isOTG()` per model in the host catalog. If the owner wants the SVF path kept as default, a query flag
  (`?svf2=1`) is an alternative, but PD-15 says SVF2 *is* the v1 path. [I]

## 3. OQ-1 modelKey/modelVersion

- Core spec §24 OQ-1 (`docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:1530,1557`): settle
  it before **integration acceptance**. The example given is document URN + derivative version for the key, and a
  translation revision or content hash for `modelVersion`. A constant or label used as the version fails the gate.
  Lines 181-182: the engine does not choose the derivation.
- Adapter plan D-V8 / G-VA-OQ1 (`…viewer-adapter-implementation.md:73,81`): the adapter provides no derivation or
  default. Integration acceptance is blocked until there is a written derivation plus a test that a retranslation
  changes `modelVersion`.
- Panel spec §11.1 / OD-8: the interim policy for live acceptance only is **a fresh `modelKey` per load plus a
  host-supplied `modelVersion` witness**. Results are non-resumable across reload by construction.
- Existing helper: **none** (no `deriveModelKey`/`modelVersion` code; T3 used the literal `'live-1'`). [V]
- **Minimal demo derivation (interim, OD-8-aligned):**
  - `modelKey = \`${urn}#${loadSeq}\``, with a per-page counter that is never reused, so a reload never collides
    (`ModelKeyVersionConflictError` is avoided by construction).
  - `modelVersion` = a manifest-derived witness, for example the viewable node's GUID plus the derivative/manifest
    `version`/`modified` or `lastModifiedTime` [U which manifest field is reliably present]. Fall back to the URN, which
    names one OSS object version only if the object is never overwritten.
  - Label it "demo interim, OQ-1 not closed". It does not satisfy the G-VA-OQ1 acceptance test.

## 4. Panel UI features and ViewerBridge

Implemented (the renderers are in `clashpanel/ui/render/*`, the intents in `clashpanel/core/intents.js:16-37`):

- **Setup:** name, Hard/Soft, clearance, per-model Set A/B toggles, "Use selection", self-clash, new test, collapse.
- **Run:** Run, Stop, results clear (with confirmation), release-and-retry. Shows state, progress, counts,
  Coverage/Integrity/Freshness badges and banners.
- **Filters:** text, model, max gap, unverified, has location, element, clear.
- **Group:** None / **Element** (`filters.js:94-96`, `GROUP_MODE`). Sort is also available.
- **Results:** a paged list with Prev/Next/page navigation.
- **Selected clash:** Focus, Isolate, Markers, Focus-on-select, Back to all (`selected.js:57-67`).
- **Other:** panel shown/hidden handling, diagnostics copy, and empty/error/stale wording (spec §7.5, §13).

Scope facts:
- **Group by Element is in v1** (spec §10.2, plan Task 13), not deferred. Composite, level, category, model-pair and
  parent roll-ups are deferred (§18).
- **Markers-only emphasis is the intended v1** (PD-16, OD-5(a)). There is no theming.
- **The Panel does not change the Viewer selection** (§9.2 "Selection … Deferred"). The demo prompt's "selecting
  corresponding Viewer objects" therefore maps to markers, bounds outlines, isolate and fit. Adding selection would be a
  scope change → owner. [V]

ViewerBridge (`clashpanel/viewer/ViewerBridge.js:85,330`): `present({sides, point?, closestPoints?, options:{focus,isolate,marker}})`,
`clear`, `dispose`, `checkIsolationPrerequisite`, `readAggregateSelection`, `onModelLeft`, plus the diagnostics
`inspectLedger` and `inspectDisposal`. The Viewer facade (`clashpanel/viewer/viewerApi.js`) provides:
- isolation: `getAggregateIsolation`, `setAggregateIsolation`, `getAggregateHiddenNodes`;
- fit: per-model `fitToView`, plus the unpublished aggregate `fitToView([{model,selection}])`, which is **unverified**;
- overlays: add/remove scene and mesh;
- bounds: `getNodeBox` for world bounds;
- events: add/remove listener.

**Wired vs missing:** all of this is wired internally and tested over fakes and a DockingPanel stub. Missing is only the
host (§1). Live state:
- G2 ran once and is `FAIL (row 3)`;
- the C8 fit-frustum check failed with root cause unproven (likely stale camera sampling);
- C6 (fit) is `NOT_EVIDENCED`;
- C3 was a harness oracle defect (`docs/research/2026-10-04-g2-c3-c8-c6-remediation-plan.md` §0).

Fit correctness on a live Viewer is therefore unproven, and the headed visual check matters.

## 5. Browser loadability (static serving)

Non-relative specifiers across `clashpanel/`, `clashtest/` and `collision/`: only `three` (15 uses),
`three-mesh-bvh` (15) and `three/addons/utils/BufferGeometryUtils.js` (1). All are in `collision/`, and all are mapped
by the import map at `wwwroot/index.html:47`. [V]

- No `node:` imports, `require`, `process` or `Buffer` usage in product code. Crypto is `globalThis.crypto`
  (`randomUUID`, `getRandomValues`), which needs a **secure context**; `localhost` qualifies. [V]
- Every relative import ends in `.js` (grep found no extension-less import). [V]
- Cross-package imports: `clashtest/viewer/*` and the clashtest core import `../../collision/errors.js` and
  `../../collision/constants.js`. Served at `/clashtest/...`, these resolve to `/collision/...`, which is already served,
  so there is one module instance and `instanceof` is consistent. [V]
- `clashpanel/` imports nothing outside itself; the Core is matched by `error.name` (README).
- Evidence: the DOM suite imports `/clashpanel/index.js` in Chromium (`test/clashpanel/dom/support/harness.mjs:20-23`),
  and T3 imported `/clashtest/index.js`, `/clashtest/viewer/index.js` and `/collision/index.js` in-page
  (`clashtest-viewer-adapter.acceptance.mjs:545-551`). [V]
- **Problems found:** none, beyond adding the two static routes. Caveat: a page without the import map, such as a
  separate demo HTML, would break `collision/`. Reuse `wwwroot/index.html`.

## 6. Headless/headed browser tooling

- `scripts/run-dom-tests.mjs` dynamically imports `playwright` and probes
  `chromium.launch({args:['--no-sandbox','--disable-dev-shm-usage','--single-process','--no-zygote']})`. It then runs
  `node --test --test-concurrency=1` over `test/clashpanel/dom/*.dom.mjs`.
- Each test serves files through `page.route` on `https://panel.test` (no TCP server), confined to `clashpanel/` and the
  test support files. It uses a **stub** DockingPanel (`stubAutodesk.mjs`).
- Installed: `playwright` / `playwright-core` **1.62.1** (Node v22.23.1).
- `~/Library/Caches/ms-playwright` holds `chromium-1234`, a full "Google Chrome for Testing.app" (Chromium
  151.0.7922.34, mac-arm64, `INSTALLATION_COMPLETE`) that **can run headed**. It also holds
  `chromium_headless_shell-1234`, `ffmpeg-1011` and `mcp-chrome-c193a44`.
- **Playwright MCP is available and working.** A probe navigation launched its browser, got `ERR_CONNECTION_REFUSED` on
  `http://localhost:8080/` (no server was running), and closed cleanly. It is the natural driver for the headed
  Track A validation (navigate, click, screenshot, console). The alternative is a scripted `chromium.launch({headless:false})`.
- The live sample needs `npm start` with `.env` APS credentials (`config.js` exits without them); `.env` was not checked.

## 7. Recommended minimal file plan

1. `server.js` — add the static routes for `/clashtest` and `/clashpanel` (2 lines).
2. `wwwroot/viewer.js` — use the SVF2 initializer (`AutodeskProduction2` / `streamingV2`) and register
   `ClashPanelExtension`.
3. `wwwroot/extensions/clashPanelHost.js` (new) — the host composition: world, enumerator, engine, unload wiring,
   catalog (with OQ-1 interim registration on load and re-registration after reload) and teardown. Keep it a pure module
   so Node tests can inject a fake viewer.
4. `wwwroot/extensions/ClashPanelExtension.js` (new) — the toolbar button, a lazy `createClashPanel` on first open, and
   `unload()` ordering (panel, engine, wiring, world).
5. Tests:
   - `test/ClashPanelHost.test.mjs` (offline, fake viewer): catalog shape, `loaded` semantics, a unique key per load,
     re-registration after reload, unload wiring, dispose order;
   - an extension lifecycle test modelled on `test/ClashFinderExtension.test.mjs`;
   - optionally, an import-graph test asserting that `/clashtest` and `/clashpanel` modules have no bare specifiers
     outside the import map.
6. The headed evidence script or MCP session, with snapshots under
   `docs/research/2026-10-06-viewer-clash-panel-demo-ready/snapshots/`.

## Top risks

1. **First real engine run ever.** The real `LocalUnitExecutor` over a real world on SVF2 has never run; expect
   planning or execution surprises. D-V6 fail-closed planning, `enumeration-failed`, is likely on some models.
2. **Fixture:** Architecture fails SVF2 whole-model enumeration. Use Structure + Mechanical. RAC exceeds the triangle limit.
3. **Fit framing:** C8 failed and C6 is `NOT_EVIDENCED`. The aggregate two-model fit is unverified, and the fallback fits
   the first side.
4. **Init switch to SVF2** changes the load path for Room Locator and Clash Finder (SVF evidence only). There is also
   isolation clobber between extensions (OD-12, spec line 746).
5. **Isolation prerequisite:** Isolate stays disabled when the `getAggregateIsolation` read-and-compare is unavailable
   (§18), which may look like "isolate missing" in the demo.
6. **"Select objects"** in the demo prompt conflicts with spec §9.2 (no selection sync) → owner decision if required.
7. **OQ-1 interim** keys make results non-resumable across reload, which is by design. Disposal can hang if the executor
   never returns (O9).
