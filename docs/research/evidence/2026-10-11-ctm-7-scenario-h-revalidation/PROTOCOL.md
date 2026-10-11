# CTM-7 H revalidation: capture protocol

**Status: this package did NOT run any of this.** It only retains the helper, schema and protocol so a future, separately authorized headed H revalidation (see the independent review `docs/reviews/2026-10-11-clash-tests-manager-ctm-7-headed-svf2-validation-independent-work-review.md`, Medium M1) is reproducible. Running it requires explicit owner authorization (F-1 decision + remediation + re-review first).

## 1. Setup
1. Clean checkout at the authorized HEAD; record `git rev-parse HEAD`, `git status --short`.
2. `PORT=8080 node server.js` (background; stop at the end). Open `http://localhost:8080/#<hash-URN>` in **headed Chrome**, normal app (not `?clashPanelDemo=1`).
3. Load Audubon Architecture (hash URN), then Structure and Mechanical via the host Load UI with "Load as additional model" ticked. All three must be SVF2/OTG (`model.isOTG() === true`); Viewer version recorded (`Autodesk.Viewing.getVersion?.()`/`runtime-identity.json` as before).
4. Click `#clash-panel-toolbar-button` (`wwwroot/extensions/ClashPanelExtension.js` L10). Wait for the panel root `.clash-panel-root` to exist.
5. Paste `capture-helper.js` into the page (console or playwright `evaluate`). Hash the file and record the hash BEFORE capture. Smoke: `await __ctmCapture('H-smoke')` must have `problems == []`.

## 2. Settle conditions (built into `__ctmCapture`)
Capture only after: (a) two `requestAnimationFrame` ticks; (b) optional `{minWaitMs}` (use 6000 after hide/show/run to match prior H4/H6 6 s waits); (c) editor `runActive === false` and the manager+editor+viewer-model fingerprint identical across two consecutive 250 ms reads; cap 8 s. If the cap is hit the snapshot has `settle.timedOut:true` and must be re-taken, not cited. For a Run, additionally wait until `editor.runState === 'done'` (poll `__ctmCapture.sync()`), then capture. Take screenshots only after the capture settles.

## 3. Scenario H command sequence
Resolve model ids from `viewer.getAllModels()` (match by the label shown in `__ctmCapture().catalog`/`modelKeysBySelf`); ids in the prior run: Arch 1, Structure 2, Mechanical 3 (reloaded 4). Record the ids actually observed; the prior run called `viewer.hideModel(2)` with a numeric model id (SCENARIO-LOG F-1); `unloadModel` takes a Model object (`viewer.unloadModel(model)`) - confirm both signatures for 7.124.2 before use.
1. Create the two tests as in prior scenario A (Test 1 Arch x Struct Hard; Test 2 Struct x Mech Soft with user-supplied `ft` clearance 0.1; optional Duplicate). Open Test 1 in the editor, run it to completion once (prior: 2277 clashes), return to the Manager. `await __ctmCapture('H0-before-hide')`.
2. Normal UI: Model Browser root eye on Mechanical; `H1-mechanical-hidden-via-model-browser` (node visibility only; expect no readiness change); restore.
3. `viewer.hideModel(<mechId>)`; `await __ctmCapture('H2-hideModel-mechanical',{minWaitMs:6000})`.
4. `viewer.showModel(<mechId>)`; capture `H3-showModel-mechanical-reentry`.
5. `viewer.hideModel(<structId>)`; capture `H4-hideModel-structure`. Open Test 1 (Manager Open); capture `H6-editor-view-structure-hidden`. Click Run; wait for `runState==='done'`; capture `H7-run-with-structure-hidden`. Back to Manager; capture `H7b-manager-after-hidden-run`. **F-1 checks apply to H4, H6, H7, H7b.**
6. `viewer.showModel(<structId>)`; capture `H5-showModel-structure` / `H8-structure-shown-after-run`.
7. `viewer.unloadModel(<mechId>)`; capture `H9-unloadModel-mechanical` (positive control: `not loaded`).
8. Reload the Mechanical URN through the host Load UI (new key `...#4`); capture `H10-mechanical-reloaded-new-key` (no rebind).
9. Take a screenshot after each capture, named `CT-NN-H-<step>.png`. Save the capture array to `state-H.json`. Dump console to `console.log` (expect 0 errors; the known `Model#getInstanceTree` deprecation warning is the only prior warning).
`hideModel/showModel/unloadModel` are public console API calls used because the normal Viewer UI has no per-model equivalent; this does not prove an end-user UI path.

## 4. Hashing and manifest
Retained files: `capture-helper.js` (as pasted, unmodified), `CAPTURE-SCHEMA.md`, `PROTOCOL.md`, `state-H.json`, `runtime-identity.json`, `console.log`, `SCENARIO-LOG.md`, screenshots. From inside the evidence directory:
```
for f in $(ls | grep -v '^MANIFEST.sha256$'); do shasum -a 256 "$f"; done > MANIFEST.sha256
shasum -a 256 -c MANIFEST.sha256
```
Format matches the existing `docs/research/evidence/2026-10-11-ctm-7-headed-svf2/MANIFEST.sha256`: one line per file, `<64-hex sha256>`, two spaces, bare filename (no path), MANIFEST excluded from itself. Copy `capture-helper.js`, `CAPTURE-SCHEMA.md`, `PROTOCOL.md` into the new evidence directory so the manifest covers the exact helper used, and report `N/N OK`.

## 5. Boundaries
No production/test/spec/plan edits; no commit/push unless authorized; no CTM-8, no fault injection, no scenarios other than H (and the bounded F-1 invariant); do not edit prior evidence.
