# CTM-7 H capture schema (`ctm7-h-capture/1`)

Evidence-support artifact. Produced by `capture-helper.js` (same directory). **Not executed by the package that wrote it.**
Reconstructed from the prior capture shape in `docs/research/evidence/2026-10-11-ctm-7-headed-svf2/state-H.json` and the source files cited below; the original `window.__cap/__snap` helper was never retained, so this is a faithful re-expression, not the original. Fields marked (new) did not exist in the prior captures; (renamed/derived) are re-derived from the VM.

One snapshot = one JSON object. `window.__ctmCapture(label)` settles (PROTOCOL.md section 2), then returns it and appends it to `window.__ctmSnaps`. A scenario file is a JSON array of snapshots (same as the prior `state-*.json`).

## Top-level
| Field | Meaning |
|---|---|
| `schema` | constant `ctm7-h-capture/1` (new) |
| `label` | caller-supplied step id, e.g. `H4-hideModel-structure` |
| `at` | ISO time of the read |
| `scenario` | `"H"` |
| `href` | page URL with the hash URN redacted (new) |
| `settle` | `{stable, timedOut, waitedMs, minWaitMs}` (new). `timedOut:true` means the evidence is NOT settled; do not cite it as a stable state |
| `problems` | array of `no-viewer`/`no-host`/`no-panel-root`/`no-editor-vm`; must be `[]` for usable evidence (new) |

## `manager` (DOM only; the manager VM is not reachable from the console)
Source: `clashpanel/ui/render/manager.js` (`renderManagedPanel` L365-, `renderHeader`, `item` L226-, banner L135-, `data-confirm-op` L179).
| Field | Source selector / meaning |
|---|---|
| `view` | `list` if `.clash-manager-list` is not `hidden`, else `editor` (manager.js L376-377) (replaces prior `panelTitleView`) |
| `headerActive` | `.clash-manager-header .clash-manager-active` ("Test: <name>") |
| `count`, `items[]` | `li.clash-manager-item`; `id`=`data-test-id`, `active`=`aria-current="true"` |
| `items[].name/mode/status` | `.clash-manager-name` / `-mode` / `-status` text |
| `items[].setA/setB` | first/second `.clash-manager-set-value` |
| `items[].readiness` | `.clash-manager-readiness` text. **F-1 field**: values per `clashpanel/core/testReadiness.js` (`READINESS_TEXT` L12; `"<name> is not loaded"` L39) |
| `items[].reasons` | `.clash-manager-reason-row` text (per-action disabled reasons; also where "Models changed since this run" may appear - confirm against `testReadiness.js` `modelsChangedOf` L43) |
| `items[].disabledActions` | `data-key` of disabled buttons in `.clash-manager-actions` |
| `confirm` / `confirmOp` | `[data-banner-id="manager-confirm"]` text; header `data-confirm-op` |
| `notice`, `fault` | `.clash-manager-notice`; `[data-banner-id="manager-fault"]` |
| `liveManager` / `liveEditor` | `.clash-status` (aria-live) in header / editor host. `liveEditor` is "Ready to run." etc. (editor live is silenced, `silenceEditorLive`, but text remains) |
| `activeElementBanner` | `data-banner-id` of `document.activeElement` (focus check) |

## `editor` (ViewModel)
Source: `viewer.getExtension('Autodesk.Sandbox.ClashPanel')._host.panel.controller.getViewModel()` (`wwwroot/extensions/ClashPanelExtension.js` L31/L120 `_host`; `clashpanel/index.js` L25-31 managed facade returns the **editor** VM; shape in `clashpanel/core/viewModel.js` L1-14 and `buildViewModel` L~508). Mapping:
`testId`<-`vm.test.testId`; `name,mode`<-`vm.setup`; `setA,setB`<-`vm.setup.scope.A/B`; `runState,doneKind,headline,counts,canRun`<-`vm.run` (`buildRunRegion` L~316); `runActive,heldUnsaved,pendingConfirm,lastRun`<-`vm.test`; `resultsState,resultsMsg,rows`<-`vm.results`; `selected`<-`vm.selected.ordinal`; `validation`<-`vm.setup.validation.state`; `firstRowTestId`<-first `.clash-row[data-key]` (`results.js` L23, key embeds testId); `revision` best-effort `vm.test.draft.revision` (**unconfirmed field name; null if absent**).
- **`setupModels[]` (new, F-1 field)**: `vm.setup.models[]` = `{modelKey, displayName, ready, registered, inA, inB, note}` (`viewModel.js` L174-181). `ready`=catalog `loaded`; `registered`=`registry.bindingFor(key) !== null` (`controller.js` `setupInput` L~1213-1222).
- `validationMessages[]`: texts of `vm.setup.validation.messages` (setup findings; see `setupValidation.js` `modelFindings` L50-72).

## `catalog` (new)
`host.catalog.list()` projection `{modelKey, displayName, loaded}` (`wwwroot/extensions/clashPanelHost.js` `list()` L~158-168). Raw catalog truth, independent of the VM.

## `viewer` (public getters, plus one internal read)
| Field | Source |
|---|---|
| `models` | ids from `viewer.getAllModels()` (renamed; prior `models` may have used the visible list - the prior H4 capture showed `[1,3]` with Structure hidden) |
| `visibleModels` | ids from `viewer.getVisibleModels()` (new; this is what drops on `hideModel`) |
| `modelKeysBySelf[]` | per model `{id, urn, isLoadDone, isOTG, hasInstanceTree}` (new) |
| `isolatedNodeCounts`, `hiddenNodeCounts` | per model id: `getIsolatedNodes(m).length`, `getHiddenNodes(m).length` |
| `isolatedAny` | any isolated count > 0 |
| `selection` | `getSelection().length` |
| `overlays` | **internal**: `viewer.impl.overlayScenes[name].scene.children.length` (read-only; no public getter exists; a Viewer-version-dependent field - record Viewer version in the evidence) |
| `panelOverlayScenes`, `panelOverlayChildren` | overlay names matching `clash-panel-(markers|outlines):*` (names from `clashpanel/viewer/ViewerBridge.js` L82) and their child counts, sorted by name (markers first) |

## F-1 invariant (hidden model stays runnable; owner Option B)
Pass requires, in every snapshot taken after `hideModel` (model still in `getAllModels()`, absent from `getVisibleModels()`) and before any `unloadModel`:
1. `manager.items[*].readiness` does NOT contain `is not loaded` and `manager.items[*].reasons` / `status` do NOT contain `Models changed` for tests whose models are only hidden (same modelKey, same Model object).
2. `editor.canRun === true`, `editor.validation === "ready"`, `editor.headline` is "Ready to run" (agreement with Manager), and `editor.setupModels[*].registered === true` for the hidden model.
3. `catalog[*].modelKey` of the hidden model unchanged vs the pre-hide snapshot (same key; no `#n` increment).
4. Positive control (must still hold): after `unloadModel`, affected tests DO show `not loaded`, and the reload gets a NEW key with no rebind (`items[*].setA/setB` keep the old key's name with `(not loaded)`); and after `showModel` nothing needs manual action.
5. `problems == []` and `settle.timedOut == false` on every cited snapshot.
Comparison is by snapshot label pair (H0 vs H4 etc.), never by eye.

## Internal reads and caveats
`viewer.impl.overlayScenes` is Viewer-internal; `ext._host` is a Panel host private field. Both read-only, version-pinned (Viewer 7.124.2). Original selectors in the DOM branch were inferred from source, not run in this package.
