// test/acceptance/room-locator.acceptance.mjs
//
// Milestone-1 acceptance criterion (docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md:4631-4642).
// Known-in-advance ground truth (spike/FINDINGS.md): Bathtub-TOTO-Nexus-FBF794S [420270] (dbId 2530,
// NOT the bracketed Revit ElementId 420270 -- the UI flow below sidesteps this by selecting through
// the Viewer's own name search, never hardcoding 2530 as an input) resolves to Master Bath 207
// [857194] (dbId 3885): 907 of the bathtub's 1003 world-space vertices classify inside; all 13 other
// rooms score exactly 0. This is a regression check, not an open algorithm question.
//
// This script drives a REAL npm-start server and a REAL Autodesk Viewer instance via Playwright --
// there is no mock/stub Viewer anywhere in this file. Two tiers of verification, both against that
// live Viewer:
//
//   Tier 1 -- the spec's literal acceptance criterion: select the bathtub through the Viewer's own
//   UI (name search -> select -> fit-to-view -> right-click -> "Locate Room" context-menu item),
//   confirm the resulting isolated node set is Master Bath 207 (dbId 3885), and screenshot the
//   result for manual visual sign-off. Also re-asserts the two structural invariants the spec calls
//   out by name: window.THREE.REVISION === '71' unchanged across a real collision-runtime query, and
//   that /vendor/BufferGeometryUtils.js was both requested AND resolved successfully (not merely "no
//   failure observed", which would also be true if it were simply never requested).
//
//   Tier 2 -- an exact-number regression check reproducing the spike's own brute-force methodology
//   directly against the shipped collision/ primitives (NOT via CollisionWorld.findClashes, whose
//   public ClashResult carries no per-vertex tally, and whose production `containment` mode uses
//   anyComponentInside's bounded, early-exit sampling -- not guaranteed to classify every one of the
//   bathtub's 1003 vertices before returning positive). This uses the real
//   extractFragments -> viewer.impl.getRenderProxy -> adaptViewerGeometry -> compactAndWeld -> build
//   -> classifyPoint pipeline (collision/viewer/ViewerModelAdapter.js,
//   collision/viewer/ViewerGeometryAdapter.js, collision/geometry/activeRangeCompaction.js,
//   collision/blas/ThreeMeshBvhBackend.js, collision/query/ContainmentQuery.js -- there is no single
//   helper function that does this end to end; CollisionWorld's own equivalent,
//   _resolveGeometryView, is private and not used here), classifying every bathtub vertex in EACH
//   room's own local frame (never world-space points against a local-frame BVH -- classifyPoint's
//   BVH is always built in the target geometry's own local space, per
//   collision/query/ContainmentQuery.js's own doc comment).
//
// CONFIRMED CONTRACTS this script depends on (verified directly against source on this branch,
// commit 01ef420, before writing this file -- see
// .superpowers/sdd/2026-09-03-collision-library-milestone1-implementation/batch5-landed-interfaces-inventory.md
// for the full verification trail):
//   - The collision library is served at browser path /collision (repo-root collision/, mounted by
//     server.js), not /wwwroot/collision.
//   - RoomLocatorExtension's "Locate Room" outcome is expressed via
//     `this._viewer.isolate(roomDbIds); this._viewer.fitToView(roomDbIds);` (wwwroot/extensions/
//     RoomLocatorExtension.js) -- RESULT_CHECK_MODE = 'isolation' (viewer.getIsolatedNodes()) is
//     therefore correct, not an open assumption.
//   - There is NO ViewerModelAdapter.getPlacedGeometry / ViewerGeometryAdapter.buildGeometryRecord
//     anywhere in this codebase. Tier 2 below re-derives the real pipeline instead (see above),
//     matching CollisionWorld.js's own private _resolveGeometryView method and its
//     resolveWeldEpsilon(model) helper line for line.
//   - extractFragments's worldMatrix is a flat Float64Array(16), reconstructed into a THREE.Matrix4
//     via .fromArray() -- never a THREE.Matrix4 instance already.
//   - Room resolution uses the identical predicate RoomLocatorExtension's own private
//     _resolveRoomDbIds uses: model.search('Revit Rooms', ..., ['Category'], {searchHidden: true}).

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = process.env.PORT || 8080;
const BASE_URL = `http://localhost:${PORT}`;
const URN = 'dXJuOmFkc2sub2JqZWN0czpvcy5vYmplY3Q6dGVzdC1zYW5kYm94LWxrd2VqN3hwYmdwNjN4NGhsMzM1eTZtMjZvYWtnZ29mL3JhY2Jhc2ljc2FtcGxlcHJvamVjdC5ydnQ';
const EXPECTED_ROOM_DBID = 3885;          // Master Bath 207 [857194]
const EXPECTED_VERTS_INSIDE = 907;
const EXPECTED_VERTS_TOTAL = 1003;
const OTHER_ROOM_COUNT = 13;
const RESULT_CHECK_MODE = 'isolation';    // confirmed against RoomLocatorExtension.js's onContextMenu
const RESULTS_DIR = path.join(process.cwd(), 'test/acceptance/results');

const results = { tier1: {}, tier2: {}, vendorFailures: [], vendorRequestFailedEvents: [], revisionCheck: {}, checks: [] };

function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}\n        expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
  results.checks.push({ name, ok, expected, actual });
  if (!ok) process.exitCode = 1;
  return ok;
}

// Chromium does not automatically honor the shell's HTTP_PROXY/HTTPS_PROXY env vars the way Node's
// own fetch/curl do -- a corporate-proxy or sandboxed CI environment that requires one otherwise
// makes every external request (viewer3D.js and everything else Autodesk-hosted) fail with
// net::ERR_NAME_NOT_RESOLVED / ERR_PROXY_CONNECTION_FAILED with no indication why. Reading it
// explicitly and passing it through Playwright's own `proxy` launch option is the documented fix,
// and a no-op (undefined) when no such proxy is configured -- never hardcodes a credential.
function resolveProxyFromEnv() {
  const raw = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    const proxy = { server: `${url.protocol}//${url.host}` };
    if (url.username) proxy.username = decodeURIComponent(url.username);
    if (url.password) proxy.password = decodeURIComponent(url.password);
    const bypass = process.env.NO_PROXY || process.env.no_proxy;
    if (bypass) proxy.bypass = bypass;
    return proxy;
  } catch {
    return undefined;
  }
}

// Hoisted so the top-level catch (below) can close it on a thrown assertion -- browser.close() is
// otherwise only reached on the success path, and a leaked Chromium subprocess is exactly the kind
// of stray process this task's own instructions warn against.
let browser;

async function main() {
  await mkdir(RESULTS_DIR, { recursive: true });
  browser = await chromium.launch({
    // --single-process/--no-zygote: required in some sandboxed/CI environments where Chromium's
    // normal multi-process startup (Mach port rendezvous, on macOS) is denied by an outer process
    // sandbox -- verified necessary in this repo's own CI-equivalent dev sandbox, where the default
    // launch args (which already include --no-sandbox) still crash with
    // "Check failed: kr == KERN_SUCCESS. bootstrap_check_in ...: Permission denied". Harmless
    // elsewhere: a single serial page in one test run does not need multi-process isolation.
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--single-process', '--no-zygote'],
    proxy: resolveProxyFromEnv(),
  });
  const page = await browser.newPage();

  // --- vendor-loading acceptance check: every /vendor/ request must resolve, and
  // BufferGeometryUtils.js specifically must be requested AND succeed. ---
  page.on('response', (resp) => {
    if (resp.url().includes('/vendor/') && !resp.ok()) {
      results.vendorFailures.push({ url: resp.url(), status: resp.status() });
    }
  });
  page.on('requestfailed', (req) => {
    if (req.url().includes('/vendor/')) {
      results.vendorRequestFailedEvents.push({ url: req.url(), failure: req.failure()?.errorText });
    }
  });
  let bufferGeometryUtilsOk = false;
  page.on('response', (resp) => {
    if (resp.url().endsWith('BufferGeometryUtils.js') && resp.ok()) bufferGeometryUtilsOk = true;
  });

  // RoomLocatorExtension's own caveat channel is a browser `alert()` (see its `_notifyUser`) --
  // captured here so a "no containing room found" outcome (with its diagnostics reason) lands in
  // run-report.json instead of only ever being visible as an opaque downstream waitForFunction
  // timeout. Also captures console.warn's own diagnostics dump for the same reason.
  page.on('dialog', async (dialog) => {
    results.tier1.alertMessage = dialog.message();
    console.log(`  [alert] ${dialog.message()}`);
    await dialog.dismiss();
  });
  page.on('console', (msg) => {
    if (msg.type() === 'warning' && msg.text().includes('RoomLocatorExtension')) {
      results.tier1.consoleWarnings = results.tier1.consoleWarnings ?? [];
      results.tier1.consoleWarnings.push(msg.text());
    }
  });

  console.log('\n=== Loading acceptance model ===');
  // main.js's hashchange listener auto-loads whatever URN is in the location hash (wwwroot/urn.js,
  // wwwroot/main.js) -- no need to drive the #urn input/#load button separately.
  await page.goto(`${BASE_URL}/#${URN}`);
  // `window.viewer.model` exists as soon as the document node begins loading, well BEFORE all
  // fragment geometry has actually streamed in (verified empirically: model.isLoadDone() reads
  // false immediately after `model` first appears). Proceeding on `model` alone races real fragment
  // streaming and produces spurious `unsupported-geometry-layout` diagnostics from
  // adaptViewerGeometry for whichever room/element fragment hadn't finished loading yet -- not a
  // collision-library defect, a load-completion race in this test's own setup. isLoadDone() is the
  // correct real-Viewer readiness signal.
  await page.waitForFunction(() => window.viewer && window.viewer.model && window.viewer.model.isLoadDone(), null, { timeout: 120_000 });

  const revisionBefore = await page.evaluate(() => window.THREE.REVISION);

  // --- Tier 1: drive the real UI flow ---
  console.log('\n=== Tier 1: UI-driven "Locate Room" flow ===');
  // DIVERGENCE FROM THE BRIEF, verified empirically against the real acceptance model: the bare
  // family name 'Bathtub-TOTO-Nexus-FBF794S' matches FOUR dbIds, not one -- three placed instances
  // (dbIds 2280, 2296, 2530, each disambiguated only by its own bracketed Revit ElementId suffix)
  // plus the family TYPE node itself (dbId 2527, no geometry/bbox of its own). The brief's assumption
  // of "exactly one match" does not hold for this model. Searching the FULL display name INCLUDING
  // the bracketed ElementId -- exactly the string a user would see and could type/pick from the model
  // browser to disambiguate a duplicate-named element -- resolves to precisely dbId 2530 (spike/
  // FINDINGS.md's known target). This still resolves the dbId via viewer.search() like a real user's
  // selection would, and still never hardcodes 2530 itself as an input anywhere in this script --
  // consistent with this test's own "protected invariant" against hardcoding the dbId directly.
  const bathtubDbIds = await page.evaluate(() => new Promise((resolve, reject) => {
    // Viewer3D.search (confirmed in node_modules/@types/forge-viewer/index.d.ts) -- distinct from
    // Model.search used for room resolution below (which needs the searchHidden option Viewer3D's
    // own search does not expose).
    window.viewer.search(
      'Bathtub-TOTO-Nexus-FBF794S [420270]',
      resolve,
      reject,
      ['name'],
    );
  }));
  check('bathtub name search (full bracketed display name) returns exactly one dbId', bathtubDbIds.length, 1);
  const bathtubDbId = bathtubDbIds[0];

  await page.evaluate((dbId) => window.viewer.select([dbId]), bathtubDbId);
  // Fit the camera to the selection and let it settle before computing a screen position -- an
  // off-screen or still-animating-camera projection would make the right-click land nowhere.
  await page.evaluate((dbId) => window.viewer.fitToView([dbId]), bathtubDbId);
  await page.waitForTimeout(500); // camera-transition settle; no reliable "camera stopped" event on this API surface

  const { x, y } = await page.evaluate((dbId) => {
    // getNodeBox is an OUT-PARAMETER API (confirmed in node_modules/@types/forge-viewer/index.d.ts:
    // `getNodeBox(dbId, nodeBox): void`) -- it mutates the passed Float32Array and returns nothing;
    // an earlier draft of this script wrongly used its (undefined) return value.
    const bbox = new Float32Array(6);
    window.viewer.model.getInstanceTree().getNodeBox(dbId, bbox);
    const center = new window.THREE.Vector3(
      (bbox[0] + bbox[3]) / 2, (bbox[1] + bbox[4]) / 2, (bbox[2] + bbox[5]) / 2,
    );
    return window.viewer.worldToClient(center);
  }, bathtubDbId);
  const canvasBox = await page.locator('#preview canvas').first().boundingBox();
  await page.mouse.click(canvasBox.x + x, canvasBox.y + y, { button: 'right' });

  // Diagnostic, not a completion criterion: RoomLocatorExtension.onContextMenu bails silently on
  // !status.hasSelected, and a right-click that lands off the bathtub (a mis-projected screen
  // position, most likely a stale/animating camera) clears the selection instead of preserving it --
  // which would otherwise surface only as a confusing 5s "Locate Room" locator timeout below with no
  // clue why. Checking this first turns that failure mode into an immediate, legible diagnosis.
  const selectionAfterRightClick = await page.evaluate(() => window.viewer.getSelection());
  check('selection still contains the bathtub after right-click (context menu landed on it)', selectionAfterRightClick.includes(bathtubDbId), true);

  // RoomLocatorExtension.onContextMenu registers a "Locate Room" item (confirmed in source). The
  // real DOM structure (verified against a live render, not guessed) is `.menu-item` containing a
  // `.menu-item-text` child with the item's label -- NOT `.context-menu-item`, which does not exist
  // anywhere in this Viewer version's rendered context menu.
  const locateRoomItem = page.locator('.menu-item', { hasText: 'Locate Room' });
  await locateRoomItem.waitFor({ timeout: 5_000 });
  await locateRoomItem.click();

  await page.waitForFunction(
    ({ expected, mode }) => {
      const nodes = mode === 'isolation'
        ? (window.viewer.getIsolatedNodes ? window.viewer.getIsolatedNodes() : [])
        : window.viewer.getSelection();
      return nodes && nodes.includes(expected);
    },
    { expected: EXPECTED_ROOM_DBID, mode: RESULT_CHECK_MODE },
    { timeout: 15_000 },
  );
  const highlightedNodes = await page.evaluate((mode) =>
    mode === 'isolation'
      ? (window.viewer.getIsolatedNodes ? window.viewer.getIsolatedNodes() : [])
      : window.viewer.getSelection(),
  RESULT_CHECK_MODE,
  );
  results.tier1.highlightedNodes = highlightedNodes;
  check(`highlighted/isolated room is Master Bath 207 [857194] (mode: ${RESULT_CHECK_MODE})`, highlightedNodes.includes(EXPECTED_ROOM_DBID), true);

  await page.screenshot({ path: path.join(RESULTS_DIR, 'locate-room-result.png'), fullPage: false });
  console.log(`  Screenshot saved for manual visual sign-off: ${path.join(RESULTS_DIR, 'locate-room-result.png')}`);

  // --- runtime-isolation invariant, re-checked AFTER a real query has run ---
  const revisionAfter = await page.evaluate(() => window.THREE.REVISION);
  results.revisionCheck = { before: revisionBefore, after: revisionAfter };
  check("window.THREE.REVISION === '71' before the query", revisionBefore, '71');
  check("window.THREE.REVISION === '71' unchanged after the query", revisionAfter, '71');
  check('no failed /vendor/ responses', results.vendorFailures, []);
  check('no failed /vendor/ network-level requests', results.vendorRequestFailedEvents, []);
  check('BufferGeometryUtils.js was requested and resolved successfully', bufferGeometryUtilsOk, true);

  // --- Tier 2: exact-number regression check via the shipped primitives directly, in the target's
  // own local frame ---
  console.log('\n=== Tier 2: exact vertex-count regression (spike ground truth) ===');
  const tier2 = await page.evaluate(async ({ bathtubDbId }) => {
    const { extractFragments } = await import('/collision/viewer/ViewerModelAdapter.js');
    const { adaptViewerGeometry } = await import('/collision/viewer/ViewerGeometryAdapter.js');
    const { compactAndWeld } = await import('/collision/geometry/activeRangeCompaction.js');
    const { build } = await import('/collision/blas/ThreeMeshBvhBackend.js');
    const { classifyPoint } = await import('/collision/query/ContainmentQuery.js');
    const { weldEpsilonMeters } = await import('/collision/constants.js');
    // Resolves via the page's own import map (wwwroot/index.html) to /vendor/three/build/
    // three.module.js -- the SAME r185 `three` instance every collision/ module itself imports
    // (`import * as THREE from 'three'`), and the one whose full modern API (.invert() included)
    // the BVH-space math below needs. window.THREE is the VIEWER's own bundled r71 global (the
    // whole point of the REVISION invariant asserted above) -- it predates .invert() entirely
    // (r71's equivalent is .getInverse()) and must never be used for this library's own math.
    // window.THREE is used ONLY for extractFragments's `THREE` option below, per
    // ViewerModelAdapter.js's own contract that the extraction scratch Matrix4/Box3 passed into
    // FragmentList.getWorldMatrix/getWorldBounds must be a genuine Viewer-side object.
    const THREE = await import('three');

    const model = window.viewer.model;
    // Throwaway measurement script, run against a live already-loaded model with checkpoint:
    // undefined (no scheduler/liveness validation needed here) -- any stable placeholder works.
    const LOAD_EPOCH = 0;

    // Re-derives CollisionWorld.js's own private _resolveGeometryView + resolveWeldEpsilon(model)
    // logic using only the library's PUBLIC exports (extractFragments, adaptViewerGeometry,
    // compactAndWeld, build) -- there is no single exported helper that does this end to end.
    async function getLocalGeometry(dbId) {
      const fragments = await extractFragments(model, [dbId], LOAD_EPOCH, { checkpoint: undefined, THREE: window.THREE });
      if (fragments.size !== 1) {
        throw new Error(`Expected exactly 1 fragment for dbId ${dbId} (spike/FINDINGS.md B3/B4 one-fragment assumption), got ${fragments.size}`);
      }
      const fragmentRecord = [...fragments.values()][0];

      const proxy = window.viewer.impl?.getRenderProxy(model, fragmentRecord.fragmentId);
      if (!proxy || !proxy.geometry) {
        throw new Error(`dbId ${dbId}: no live render proxy for fragment ${fragmentRecord.fragmentId}`);
      }
      const view = adaptViewerGeometry(proxy.geometry);
      if (view.unsupported) {
        throw new Error(`dbId ${dbId}: unsupported geometry layout (${view.reason})`);
      }

      const unitScale = typeof model.getUnitScale === 'function' ? model.getUnitScale() : undefined;
      const weldEpsilon = (typeof unitScale === 'number' && Number.isFinite(unitScale) && unitScale > 0)
        ? weldEpsilonMeters / unitScale
        : weldEpsilonMeters;
      const welded = compactAndWeld(view, { weldEpsilon });
      if (welded.oversized) {
        throw new Error(`dbId ${dbId}: geometry too large for sync build (${welded.reason})`);
      }

      const { bvh, localDiagonal } = build(welded);
      const worldMatrix = new THREE.Matrix4().fromArray(fragmentRecord.worldMatrix);
      return { position: welded.position, worldMatrix, bvh, localDiagonal };
    }

    // Category-based lookup, matching the standard Model Derivative convention rooms are published
    // under ("Revit Rooms"), with hidden elements included -- this MUST use the identical predicate
    // RoomLocatorExtension's own private _resolveRoomDbIds uses, so Tier 2's room set can never
    // silently drift from what the UI flow actually searched.
    const roomDbIds = await new Promise((resolve, reject) => {
      model.search('Revit Rooms', resolve, reject, ['Category'], { searchHidden: true });
    });
    if (roomDbIds.length !== 14) {
      throw new Error(`Expected exactly 14 rooms in the acceptance model, found ${roomDbIds.length}: ${JSON.stringify(roomDbIds)}`);
    }

    const bathtub = await getLocalGeometry(bathtubDbId);
    const totalVerts = bathtub.position.length / 3;

    const perRoom = {};
    for (const roomDbId of roomDbIds) {
      const room = await getLocalGeometry(roomDbId);
      const roomInverse = new THREE.Matrix4().copy(room.worldMatrix).invert();
      // bathtub-local -> world -> room-local, so classifyPoint always receives a point in the SAME
      // frame its target BVH was built in, regardless of either object's own placement.
      const toRoomLocal = new THREE.Matrix4().multiplyMatrices(roomInverse, bathtub.worldMatrix);

      let inside = 0;
      const p = new THREE.Vector3();
      for (let i = 0; i < bathtub.position.length; i += 3) {
        p.set(bathtub.position[i], bathtub.position[i + 1], bathtub.position[i + 2]).applyMatrix4(toRoomLocal);
        if (classifyPoint(p, room.bvh, room.localDiagonal) === 'inside') inside++;
      }
      perRoom[roomDbId] = inside;
    }
    return { totalVerts, perRoom };
  }, { bathtubDbId });

  results.tier2 = tier2;
  check('bathtub has 1003 world-space vertices post-weld', tier2.totalVerts, EXPECTED_VERTS_TOTAL);
  check('Master Bath 207 [857194] has 907 vertices inside', tier2.perRoom[EXPECTED_ROOM_DBID], EXPECTED_VERTS_INSIDE);
  const otherRooms = Object.entries(tier2.perRoom).filter(([dbId]) => Number(dbId) !== EXPECTED_ROOM_DBID);
  check('exactly 13 other rooms present', otherRooms.length, OTHER_ROOM_COUNT);
  check('every other room scores exactly 0', otherRooms.every(([, n]) => n === 0), true);

  await browser.close();
  await writeFile(path.join(RESULTS_DIR, 'run-report.json'), JSON.stringify(results, null, 2));
}

// Guard against Node's `node --test` default discovery, which sweeps in every .js/.mjs file under
// any directory literally named `test` (confirmed by the Batch-5 final review, finding I-1) -- this
// file previously ran main() unconditionally at module top level, meaning a bare `npm test` (`node
// --test` with no path filter) would launch a real Chromium and drive a real live-server acceptance
// run as a side effect of the unit-test command, hitting a possibly-absent localhost:8080 server and
// clobbering this script's own run-report.json with a spurious connection-refused failure. Run
// main() only when this file is the actual entry point (`node test/acceptance/room-locator.
// acceptance.mjs`): `argv[1]`-based detection alone is NOT sufficient, since Node's `--test` sweep
// sets `process.argv[1]` to this file's own path when it imports it as a candidate, identical to a
// direct invocation -- the real discriminator is `process.env.NODE_TEST_CONTEXT`, which Node sets to
// `'child-v8'` for every file `--test` sweeps in and leaves unset otherwise. `package.json`'s `test`
// script (`scripts/run-tests.mjs`) now passes `node --test` an explicit list of only this repo's own
// `*.test.mjs` files (this file does not match that suffix), which already prevents the sweep from
// reaching this file at all -- this env-var check is defense-in-depth in case a future change
// reintroduces a bare, unscoped `node --test`.
const isMainModule = !process.env.NODE_TEST_CONTEXT
  && process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) {
  // main()'s own promise rejection handler, not a `finally` inside main, guarantees run-report.json
  // is written and the browser doesn't leak on a thrown assertion (e.g. Tier 2's room-count guard) --
  // browser.close() is called before the success-path write above, and this catch handler writes
  // whatever was accumulated in `results` even when main() never reaches that line.
  main().catch(async (err) => {
    console.error(err);
    process.exitCode = 1;
    await browser?.close().catch(() => {});
    await writeFile(path.join(RESULTS_DIR, 'run-report.json'), JSON.stringify({ ...results, fatalError: String(err) }, null, 2)).catch(() => {});
  });
}
