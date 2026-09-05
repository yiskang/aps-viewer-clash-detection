# Room-locator acceptance test

`room-locator.acceptance.mjs` is the milestone's primary acceptance criterion: it drives a real,
live Autodesk Viewer instance (via Playwright + Chromium) against the app's own acceptance model
and proves the whole collision library correct end-to-end, using the spike's known-in-advance
answer as ground truth. It is a real Playwright script, not a mock/stub harness -- there is no fake
Viewer anywhere in this file.

## Credentials needed

`APS_CLIENT_ID` / `APS_CLIENT_SECRET` in a `.env` file at the repo root (see `config.js:6-10`) --
the server needs these to mint viewer access tokens and to query Model Derivative for the
acceptance model's translation status.

## Running it

```bash
npm start &          # starts the server on PORT (default 8080)
npm run test:acceptance
```

The script assumes a server is already listening at `http://localhost:${PORT:-8080}`; it does not
start one itself. Kill the `npm start` process when done (check `lsof -ti tcp:8080` doesn't leave a
stray process behind).

**First-time setup**: after `npm install`, Playwright needs its own browser binary:
`npx playwright install chromium`. In a sandboxed/offline dev environment with no write access to
`~/Library/Caches/ms-playwright/` (or no egress to Playwright's browser CDN), that command fails --
if a compatible Chromium build happens to already be cached there from a different `playwright-core`
version, pin this repo's `playwright` devDependency to whichever exact version's `browsers.json`
matches that cached revision (`npm install --save-dev playwright@<version>`) rather than fighting
the download. This repo's own dev sandbox needed `playwright@1.62.1` for exactly this reason (cached
Chromium revision 1234) -- a normal environment with network access does not need this pin and can
use any current `^1` release.

**Chromium launch args**: this script passes `--no-sandbox --disable-dev-shm-usage --single-process
--no-zygote` to `chromium.launch()`. The first two are standard CI/Docker hardening; the latter two
were required in this repo's own dev sandbox, where Chromium's normal multi-process startup (Mach
port rendezvous, on macOS) is denied by an outer process sandbox and crashes immediately even with
`--no-sandbox` already applied (`Check failed: kr == KERN_SUCCESS. bootstrap_check_in ...:
Permission denied`). These flags are harmless in a normal environment -- a single serial page in one
test run needs no multi-process isolation -- so they are left in unconditionally rather than gated
behind an environment check.

Console output prints one `PASS`/`FAIL` line per assertion with `expected=... actual=...`, matching
this repo's existing `spike/fixtures.mjs`-style reporting convention. `test/acceptance/results/`
(gitignored -- not committed) holds:
- `run-report.json` -- every individual assertion's name/expected/actual/ok, written even on a
  thrown/failed run (Tier 2's room-count guard, or any other unexpected error, still produces a
  report via the top-level `.catch()`).
- `locate-room-result.png` -- a screenshot of the resolved isolation state, for manual visual
  sign-off.
- `urn-status.json` -- the raw `/api/models/:urn/status` response captured during environment
  verification.

## What the two tiers of assertion mean

- **Tier 1** (the spec's literal acceptance criterion): drives the actual UI -- name search for the
  bathtub element (asserting exactly one match) -> select -> fit-to-view -> right-click at the
  element's projected screen position -> click the real "Locate Room" context-menu item -> asserts
  the isolated node set includes dbId `3885` (Master Bath 207). Also re-asserts
  `window.THREE.REVISION === '71'` both before and after the query (the two-runtime-isolation
  design's central invariant), and that `/vendor/BufferGeometryUtils.js` was both requested and
  resolved successfully, plus zero failed `/vendor/` responses or network-level failed requests.

  **Visual-contract note**: `RESULT_CHECK_MODE = 'isolation'` (checked via
  `viewer.getIsolatedNodes()`) is not a guess -- `wwwroot/extensions/RoomLocatorExtension.js`'s
  `onContextMenu` target was read directly from source before writing this test and confirmed to
  call `this._viewer.isolate(roomDbIds); this._viewer.fitToView(roomDbIds);` on a successful
  locate. If a future change to `RoomLocatorExtension` switches this to a selection-only outcome,
  change `RESULT_CHECK_MODE` to `'selection'` in the script.

- **Tier 2** (the spec's "known-in-advance answer" as an exact regression check): `CollisionWorld
  .findClashes`'s public `ClashResult` shape carries no per-vertex tally -- only `pairs[]` and
  aggregate `statistics` -- and its production `containment` mode uses `anyComponentInside`'s
  bounded, early-exit sampling (`maxContainmentSamples = 512`), which is not guaranteed to classify
  every one of the bathtub's 1003 vertices before returning a positive result. So this tier
  reproduces the spike's own brute-force, exhaustive-classification methodology directly against
  the shipped `collision/` primitives instead:
  `extractFragments` (`collision/viewer/ViewerModelAdapter.js`) ->
  `viewer.impl.getRenderProxy(model, fragmentId).geometry` ->
  `adaptViewerGeometry` (`collision/viewer/ViewerGeometryAdapter.js`) ->
  `compactAndWeld` (`collision/geometry/activeRangeCompaction.js`) ->
  `build` (`collision/blas/ThreeMeshBvhBackend.js`) ->
  `classifyPoint` (`collision/query/ContainmentQuery.js`).

  Every bathtub vertex is transformed from the bathtub's own world space into **each room's own
  local frame** (via that room's `worldMatrix` inverse) before being classified against that room's
  BVH -- `classifyPoint`'s target BVH is always built in the target geometry's own local space, so
  classifying raw world-space points against it would silently produce meaningless results for any
  room whose placement is not the identity transform. This is the single most important
  implementation detail this test encodes; see the script's own inline comments for the derivation.

  Expected numbers (from `spike/FINDINGS.md`): 1003 total bathtub vertices post-weld, 907 of them
  inside Master Bath 207 (dbId 3885), all 13 other rooms in the model at exactly 0.

  Room resolution for both tiers uses the identical predicate `RoomLocatorExtension`'s own private
  `_resolveRoomDbIds` uses (`model.search('Revit Rooms', ..., ['Category'], {searchHidden: true})`),
  asserted to return exactly 14 rooms before any vertex is classified -- so Tier 2's room set can
  never silently drift from what the real UI flow actually searches.

  No parallel run against the old CSG extension is included anywhere in this test (deliberately out
  of scope for this milestone).

## Status as of the last run recorded here: PASS (the milestone's primary acceptance criterion is met)

Re-verified end to end against a live server and a live Viewer instance (2026-09-05, Batch-5 final
review fix wave): both tiers pass cleanly, 13/13 assertions.

**Tier 1**: bathtub name search resolves to exactly one dbId; the right-click lands on it; the real
"Locate Room" context-menu item isolates exactly `[3885]` (Master Bath 207); `window.THREE.REVISION`
stays `'71'` before and after the query; zero failed `/vendor/` responses/requests;
`BufferGeometryUtils.js` requested and resolved successfully.

**Tier 2**: the bathtub has exactly 1003 world-space vertices post-weld; Master Bath 207 (dbId 3885)
classifies exactly 907 of them inside; exactly 13 other rooms are present, every one scoring exactly
0 -- matching `spike/FINDINGS.md`'s known-in-advance ground truth precisely.

**History**: an earlier run of this same script (predating this fix wave) found `Tier 1`/`Tier 2`
both genuinely failing with `unsupported-geometry-layout` for the bathtub fragment --
`collision/viewer/ViewerGeometryAdapter.js`'s `resolvePositions()` did not yet recognize the geometry
shape the real Autodesk Viewer 7.124.2 bundle's `LeanBufferGeometry` class produces for a plain
(non-mobile/non-F2D) interleaved 3D mesh (full root-cause detail, confirmed against the decompiled
`viewer3D.js` bundle, is preserved in the coordinator's Task 22 report,
`.superpowers/sdd/2026-09-03-collision-library-milestone1-implementation/task-22-report.md`). That
was a genuine coverage gap in `ViewerGeometryAdapter.js`, not a bug in this test -- it was fixed by
adding a fourth branch to `resolvePositions()` recognizing this shape (commits `c498ea5`/`adb88e0`,
same batch as this fix wave), and this re-run confirms the fix holds against the real acceptance
model end to end.
