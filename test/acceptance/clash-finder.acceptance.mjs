// test/acceptance/clash-finder.acceptance.mjs
//
// Task 20 (M2 milestone): the final live-Viewer verification of every "Find Clashes" API assumption
// made throughout this plan -- a REAL federated set of Model objects, loaded into a REAL Autodesk
// Viewer instance via Playwright, driven through the REAL "Find Clashes" context-menu path
// ClashFinderExtension.js registers. There is no mock/stub Viewer or CollisionWorld anywhere in this
// file, sibling to test/acceptance/room-locator.acceptance.mjs and mirroring its structure, launch
// args, proxy handling, and check()/results-writing conventions.
//
// --- The fixture: three genuinely separate, independently-translated discipline models -----------
//
// This is a real, properly-coordinated Revit multi-discipline link setup -- an Architecture host file
// plus its Structure and Mechanical links, each independently translated to its OWN Model Derivative
// manifest/URN (not a single merged package, and not the same URN loaded more than once -- both of
// those were substitutions this file used in earlier iterations before this fixture was sourced; see
// git history for that trail if it matters). All three share the same real-world coordinate system --
// their bounding boxes genuinely overlap (roughly +/-138/+/-75 in X/Y, with each discipline's own Z
// extent, all nested within the same coordinated envelope) -- because they are exactly what a real
// federated Revit clash-detection workflow looks like: three real buildings-worth of geometry that
// happen to be the SAME building, modeled by three different disciplines, meant to be viewed and
// clash-checked together.
//
//   - Model 1 (Architecture), loaded FIRST, normally: Audubon_Architecture_clash_test.rvt --
//     5,435 fragments. Its own translation succeeded with a benign, expected warning ("Missing link
//     files: Audubon_Mechanical.rvt, Audubon_Structure.rvt") -- the same warning any Revit host file
//     produces when Model Derivative translates it without its linked files physically present; it
//     does not affect this model's OWN geometry, and this file loads the Structure/Mechanical
//     geometry as their own independently-translated models regardless, achieving genuine federation
//     without needing those links resolved at translation time.
//   - Model 2 (Structure), loaded SECOND, via the real "Load as additional model" checkbox
//     (#keep-current-models) + Load button: Audubon_Structure_clash_test.rvt -- 543 fragments. This
//     model is also this fixture's SOURCE model for both cases below.
//   - Model 3 (Mechanical), loaded THIRD, same checkbox (left checked) + Load button:
//     Audubon_Mechanical_clash_test.rvt -- 1,496 fragments.
//
// Total ~7,474 fragments across three real, distinct Model objects -- the strongest, most
// representative federated fixture this file has used, and the one the milestone's own spec actually
// asks for ("a real two-or-more-model federated fixture").
//
// --- Ground truth, independently re-verified against this live server before being hardcoded here -
//
// Every number below was independently re-derived against THIS session's own live Playwright run
// (loading all three real models exactly as this script itself does) before being trusted, using the
// exact production `CollisionWorld.findClashes` call -- never a bespoke helper:
//
//   - Source dbId 2734 (Structure model, "SMBH-W-Wide Flange [272782]", a wide-flange steel beam)
//     directly owns exactly one real fragment -- confirmed via the SAME `extractFragments` helper
//     CollisionWorld.findClashes itself uses (collision/viewer/ViewerModelAdapter.js). Queried against
//     all three loaded models: exactly 2 pairs -- ONE cross-model (Architecture model, dbId 3686) and
//     ONE same-model (Structure model, dbId 3663) -- a single query that genuinely demonstrates BOTH
//     same-model and cross-model classification together. Diagnostics: 12 (non-zero, so its alert is
//     expected to carry the usual incompleteness caveat -- asserted as a prefix/substring match below,
//     never a bare exact-string match, for the same reason as every prior round of this fixture).
//     Mechanical (model 3) has zero involvement in this query -- it is never isolated/fit for this
//     case, and this file asserts that explicitly (see the mixed case's own model-3 checks below).
//   - dbId 3965 (Structure model, "HSS-Hollow Structural Section-Column [681589]", a real column)
//     directly owns exactly one real fragment (genuinely real, non-degenerate geometry -- bounding box
//     [134.031, 20.814, 0.212] to [134.615, 21.397, 7.545], a real ~0.58 x 0.58 x 7.33 unit element).
//     Queried against all three loaded models: 0 pairs, 0 diagnostics -- a genuinely clean, real
//     geometric negative (the collision pipeline actually ran real broad/narrow-phase work against
//     real geometry and correctly found nothing), asserted below as an EXACT alert-text match with no
//     caveat appended, since this negative is confirmed genuinely diagnostic-free.
//
// Both source dbIds resolve to themselves (no promotion) via viewer.select() -- confirmed live -- and
// this fixture is simple enough (two single-fragment leaf elements, no group/leaf-owner divergence)
// that this file covers the full Task 20 checklist -- extension-loaded precondition, real right-click
// "Find Clashes" flow, exact expected pairs, same/cross-model provenance, isolate/fitToView, no
// duplicates, source exclusion, and a genuine negative -- with just these two cases, rather than the
// extra secondary/trivial negative case an earlier, weaker fixture needed for the same coverage.
//
// --- Instrumentation: assertions bound to the REAL production invocation, not a second query -------
//
// The source element is selected via the real Viewer API (viewer.select), a real right-click opens
// the real context menu ClashFinderExtension.js registers, and a real click on its "Find Clashes"
// item exercises the exact production onContextMenu -> target() path end to end -- the same approach
// room-locator.acceptance.mjs uses for its own "Locate Room" item. Rather than also issuing a SECOND,
// independently-issued CollisionWorld.findClashes call to check exact pairs (an earlier draft of this
// file did that, and a codex-advisor review correctly identified it as a real gap: the test could
// still pass even if the production callback itself passed the wrong arguments or mishandled its
// result, provided the alert text and isolated-dbId union happened to still match by coincidence),
// this file WRAPS (never replaces) the three real methods the production callback itself calls --
// ext._world.findClashes, viewer.isolate, viewer.fitToView -- each wrapper calling straight through to
// the original implementation and simply recording its arguments/result before returning it
// unchanged. Every exact-pair, no-duplicate, source-exclusion, same/cross-model-provenance, and
// isolate/fitToView assertion below is checked against THAT captured real invocation. The wrappers are
// installed once and the capture arrays are reset immediately before each case's own right-click, so
// this test's OWN setup calls (select/fitToView for camera framing, isolate([]) for the pre-case
// visual reset) never pollute what gets attributed to the production callback.
//
// --- Viewer API assumptions confirmed live, before/while writing this file -------------------------
//   - viewer.getIsolatedNodes(model): the @types/forge-viewer typings declare this as
//     getIsolatedNodes(): number[] with NO model parameter -- STALE. Empirically confirmed (by
//     printing the real bundle's own function source live) that the real runtime signature is
//     function(model) { model = model || this.model; ...; return this.impl.visibilityManager.
//     getIsolatedNodes(model); } -- it DOES accept a model argument and behaves exactly as this task
//     assumed, defaulting only to viewer.model (the FIRST loaded model) when omitted. This script
//     always passes an explicit model, never relying on that default.
//   - viewer.select(dbIds, model) and viewer.isolate(dbIds, model): both typed with an optional model
//     parameter and both confirmed working per-model live in this three-model federated scene.
//   - A freshly-loaded additional model's isolate/select/instanceTree-dependent APIs are NOT safe to
//     use the instant model.isLoadDone() is true: model.getData().instanceTree can still be
//     momentarily absent right after the "Load as additional model" flow resolves (confirmed
//     empirically). This script waits for both conditions, for ALL THREE models, before touching any
//     model's instance tree.
//   - InstanceTree.enumNodeChildren's callback follows the same "truthy return value stops
//     enumeration" convention as CollisionInstanceBVH.queryBox's 'stop' (Task 13 prereq, this same
//     branch) -- confirmed the hard way while investigating an earlier fixture's own structure: `(id)
//     => arr.push(id)` (Array.push's return value, the new length, is always truthy) silently
//     truncates every enumeration to its first child.
//   - A REAL, reproducible layout defect: the "Find Clashes" context-menu item can render fully BEHIND
//     the Viewer's own docked toolbar (#settingsTools) at certain natural fitToView-centered screen
//     positions in a standard-height viewport -- confirmed via document.elementFromPoint() at the
//     menu item's own bounding-box center returning the toolbar div, not the menu item, silently
//     swallowing the click. Worked around here with a taller-than-default Playwright viewport, but
//     this is a genuine product-level UI defect worth tracking as its own issue at a standard viewport
//     size, separate from this acceptance test's own stabilization workaround.
//   - fitToView's own camera-transition ANIMATION does not always settle within a short fixed wait: a
//     case whose camera has to travel far from wherever a PRIOR case's own wide isolate/fitToView left
//     it can still be mid-transition well past a naive ~500ms wait, producing a projected screen
//     position that is genuinely off-canvas (confirmed empirically, in an earlier round of this
//     fixture, at x=1959 on a 1280px-wide canvas). selectAndRightClick() below polls until the
//     projected position actually settles within the canvas bounds instead of trusting a fixed wait,
//     with an explicit check surfacing the failure immediately if it never does.
//   - A dialog handler registered via page.once('dialog', ...) BEFORE the triggering click, not
//     page.waitForEvent('dialog') awaited AFTER it, is required for a case whose findClashes resolves
//     near-instantly (confirmed with an earlier, empty-geometry negative case): the resulting alert()
//     can fire synchronously enough to block the page's main thread while Playwright's own click() is
//     still performing its post-click stability checks, hanging until click()'s own actionability
//     timeout. A persistent page.once handler auto-responds to the CDP dialog-opening event
//     immediately, unblocking the main thread regardless of how fast the alert fires relative to the
//     click.
//
// No Task 21 work (the performance gate) is attempted here -- see this task's own final report for
// the exact dbId/model pairing to reuse there (source dbId 2734, negative dbId 3965, both in the
// Structure model of this three-model federated scene).

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = process.env.PORT || 8080;
const BASE_URL = `http://localhost:${PORT}`;
const URN_ARCH = 'dXJuOmFkc2sub2JqZWN0czpvcy5vYmplY3Q6dGVzdC1zYW5kYm94LWxrd2VqN3hwYmdwNjN4NGhsMzM1eTZtMjZvYWtnZ29mL0F1ZHVib25fQXJjaGl0ZWN0dXJlX2NsYXNoX3Rlc3QucnZ0';
const URN_STRUCT = 'dXJuOmFkc2sub2JqZWN0czpvcy5vYmplY3Q6dGVzdC1zYW5kYm94LWxrd2VqN3hwYmdwNjN4NGhsMzM1eTZtMjZvYWtnZ29mL0F1ZHVib25fU3RydWN0dXJlX2NsYXNoX3Rlc3QucnZ0';
const URN_MECH = 'dXJuOmFkc2sub2JqZWN0czpvcy5vYmplY3Q6dGVzdC1zYW5kYm94LWxrd2VqN3hwYmdwNjN4NGhsMzM1eTZtMjZvYWtnZ29mL0F1ZHVib25fTWVjaGFuaWNhbF9jbGFzaF90ZXN0LnJ2dA';

// Confirmed against wwwroot/extensions/ClashFinderExtension.js:21 (EXTENSION_ID) -- copied here
// rather than imported, matching room-locator.acceptance.mjs's own precedent of never importing
// production browser-only modules into this Node-side Playwright script.
const CLASH_FINDER_EXTENSION_ID = 'Autodesk.Sandbox.ClashFinder';

// Ground truth per this file's own header comment -- independently re-derived and verified against
// this live server in THIS session's own Playwright run before being hardcoded here. Source model is
// always the Structure model for both cases.
const MIXED_CASE = {
  name: 'mixed same+cross-model (Structure dbId 2734)',
  sourceDbId: 2734,
  expectedNameIncludes: 'SMBH-W-Wide Flange',
  expectedTotal: 2,
  expectedSameModelCount: 1,
  expectedCrossModelCount: 1,
  // Exact {targetModelKey, targetDbId} pairs -- source.dbId is always 2734 itself (it directly owns
  // its own single fragment; no group/leaf-owner divergence in this fixture).
  expectedPairs: [
    { targetModelKey: 'arch', targetDbId: 3686 },
    { targetModelKey: 'struct', targetDbId: 3663 },
  ],
  // Structure: {selected source dbId} union {same-model target}. Architecture: {cross-model target}.
  // Mechanical: untouched entirely -- no isolate/fitToView call for it at all (asserted explicitly).
  expectedIsolatedStruct: [2734, 3663],
  expectedIsolatedArch: [3686],
};
const NEGATIVE_CASE = {
  name: 'negative (Structure dbId 3965)',
  sourceDbId: 3965,
  expectedNameIncludes: 'HSS-Hollow Structural Section-Column',
  hasGeometry: true,
};

const RESULTS_DIR = path.join(process.cwd(), 'test/acceptance/results');
// Deliberately a DIFFERENT filename from room-locator.acceptance.mjs's own run-report.json -- both
// scripts share test/acceptance/results/ and must never clobber each other's report when run
// back-to-back.
const REPORT_FILE = 'clash-finder-run-report.json';

const results = { extensionLoaded: null, cases: {}, checks: [] };

function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}\n        expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
  results.checks.push({ name, ok, expected, actual });
  if (!ok) process.exitCode = 1;
  return ok;
}

// Identical to room-locator.acceptance.mjs's own helper -- see that file's inline comment for the
// full rationale (Chromium does not honor HTTP_PROXY/HTTPS_PROXY the way Node's own fetch/curl do).
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

// Hoisted so the top-level catch (below) can close it on a thrown assertion, same rationale as
// room-locator.acceptance.mjs.
let browser;

async function main() {
  await mkdir(RESULTS_DIR, { recursive: true });
  browser = await chromium.launch({
    // Same sandboxed-dev-environment args as room-locator.acceptance.mjs -- see that file's own
    // inline comment for the full rationale (--single-process/--no-zygote required in this repo's
    // own dev sandbox, harmless elsewhere).
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--single-process', '--no-zygote'],
    proxy: resolveProxyFromEnv(),
  });
  // A taller-than-default viewport: see header comment on the "Find Clashes" menu item's own
  // toolbar-overlap defect. This workaround stabilizes THIS test; it does not fix or hide the
  // underlying product issue, which is worth tracking separately at a standard viewport size.
  const page = await browser.newPage({ viewport: { width: 1280, height: 2000 } });

  console.log('\n=== Loading model 1 (Architecture) ===');
  await page.goto(`${BASE_URL}/#${URN_ARCH}`);
  await page.waitForFunction(() => window.viewer && window.viewer.model && window.viewer.model.isLoadDone(), null, { timeout: 120_000 });

  console.log('\n=== Loading model 2 (Structure) as additional ===');
  await page.fill('#urn', URN_STRUCT);
  await page.check('#keep-current-models');
  await page.click('#load');
  await page.waitForFunction(() => window.viewer.getAllModels().length === 2 && window.viewer.getAllModels().every((m) => m.isLoadDone()), null, { timeout: 120_000 });

  console.log('\n=== Loading model 3 (Mechanical) as additional ===');
  await page.fill('#urn', URN_MECH);
  await page.check('#keep-current-models'); // already checked; re-asserting is harmless and explicit
  await page.click('#load');
  await page.waitForFunction(() => window.viewer.getAllModels().length === 3 && window.viewer.getAllModels().every((m) => m.isLoadDone()), null, { timeout: 120_000 });
  // See this file's header comment: isLoadDone() alone is NOT sufficient for a freshly-loaded
  // additional model -- instanceTree can still be momentarily absent right after.
  await page.waitForFunction(() => window.viewer.getAllModels().every((m) => m.getData() && m.getData().instanceTree), null, { timeout: 120_000 });

  // Resolve all three models by their own URN (never by load order/array index alone, though order is
  // also asserted below as a secondary sanity check) and stash them on a page-global so every later
  // page.evaluate call can refer to the SAME live Model objects without re-resolving them each time.
  const modelIdentities = await page.evaluate(({ urnArch, urnStruct, urnMech }) => {
    window.__test = window.__test ?? {};
    const models = window.viewer.getAllModels();
    window.__test.modelArch = models.find((m) => m.getData()?.urn === urnArch);
    window.__test.modelStruct = models.find((m) => m.getData()?.urn === urnStruct);
    window.__test.modelMech = models.find((m) => m.getData()?.urn === urnMech);
    return {
      modelCount: models.length,
      hasArch: !!window.__test.modelArch,
      hasStruct: !!window.__test.modelStruct,
      hasMech: !!window.__test.modelMech,
    };
  }, { urnArch: URN_ARCH, urnStruct: URN_STRUCT, urnMech: URN_MECH });
  check('exactly three Model objects loaded', modelIdentities.modelCount, 3);
  check('Architecture model resolved by URN', modelIdentities.hasArch, true);
  check('Structure model resolved by URN', modelIdentities.hasStruct, true);
  check('Mechanical model resolved by URN', modelIdentities.hasMech, true);

  // --- Task 16 Step 0's own explicit acceptance precondition: the regression check for the exact
  // bug (extension never registered) Task 16 was created to fix. ---
  const extensionLoaded = await page.evaluate((id) => !!window.viewer.getExtension(id), CLASH_FINDER_EXTENSION_ID);
  results.extensionLoaded = extensionLoaded;
  check('viewer.getExtension("Autodesk.Sandbox.ClashFinder") returns a loaded instance', extensionLoaded, true);

  // --- Instrumentation: wrap (never replace) the exact three methods the REAL production
  // onContextMenu -> target() callback itself calls -- see header comment for the full rationale.
  // Each wrapper calls the original method through unchanged and returns its real result. Installed
  // ONCE; resetSpyCapture() clears the capture arrays before each case's own real click so this test's
  // OWN setup calls never pollute the captured data.
  await page.evaluate((extensionId) => {
    const ext = window.viewer.getExtension(extensionId);
    window.__test.spy = { findClashesCalls: [], isolateCalls: [], fitToViewCalls: [] };

    const modelKeyOf = (model) => {
      if (model === window.__test.modelArch) return 'arch';
      if (model === window.__test.modelStruct) return 'struct';
      if (model === window.__test.modelMech) return 'mech';
      return 'unknown';
    };

    const originalFindClashes = ext._world.findClashes.bind(ext._world);
    ext._world.findClashes = async (query) => {
      const result = await originalFindClashes(query);
      window.__test.spy.findClashesCalls.push({
        sourceModelKey: modelKeyOf(query.source.model),
        sourceDbIds: [...query.source.dbIds],
        mode: query.mode,
        groupBy: query.groupBy,
        pairs: result.pairs.map((p) => ({
          sourceModelKey: modelKeyOf(p.source.model),
          sourceDbId: p.source.dbId,
          targetModelKey: modelKeyOf(p.target.model),
          targetDbId: p.target.dbId,
          type: p.type,
        })),
        diagnosticsCount: result.statistics?.diagnostics?.length ?? 0,
      });
      return result;
    };

    const originalIsolate = window.viewer.isolate.bind(window.viewer);
    window.viewer.isolate = (dbIds, model) => {
      window.__test.spy.isolateCalls.push({
        dbIds: Array.isArray(dbIds) ? [...dbIds] : (dbIds == null ? [] : [dbIds]),
        modelKey: modelKeyOf(model),
      });
      return originalIsolate(dbIds, model);
    };

    const originalFitToView = window.viewer.fitToView.bind(window.viewer);
    window.viewer.fitToView = (dbIds, model, immediate) => {
      window.__test.spy.fitToViewCalls.push({
        dbIds: Array.isArray(dbIds) ? [...dbIds] : (dbIds == null ? [] : [dbIds]),
        modelKey: modelKeyOf(model),
      });
      return originalFitToView(dbIds, model, immediate);
    };
  }, CLASH_FINDER_EXTENSION_ID);

  async function resetSpyCapture() {
    await page.evaluate(() => {
      window.__test.spy.findClashesCalls.length = 0;
      window.__test.spy.isolateCalls.length = 0;
      window.__test.spy.fitToViewCalls.length = 0;
    });
  }

  async function readSpyCapture() {
    return page.evaluate(() => window.__test.spy);
  }

  // Clears BOTH selection and per-model isolation (for all three models) before a case's own
  // select+right-click -- necessary because a PRIOR case's own "Find Clashes" isolates the scene down
  // to just the found elements, which would otherwise hide the NEXT case's own source element and
  // make its projected screen position miss it entirely on right-click (an off-target right-click
  // clears selection instead of opening the menu on it -- the same hazard room-locator.acceptance.mjs's
  // own comments call out). Calling isolate([], model) per model explicitly, rather than isolate()
  // with no model argument, sidesteps relying on that call's own undocumented single-model default.
  async function resetVisualState() {
    await page.evaluate(() => {
      window.viewer.clearSelection();
      window.viewer.isolate([], window.__test.modelArch);
      window.viewer.isolate([], window.__test.modelStruct);
      window.viewer.isolate([], window.__test.modelMech);
    });
    // Settle gap: isolate()/clearSelection() can kick off their own re-render/visibility-manager
    // work; proceeding immediately into the next case's own select()+fitToView() risks a race where
    // the context menu ends up rendered from a not-fully-settled prior state.
    await page.waitForTimeout(300);
  }

  // Selects sourceDbId on the Structure model via the real Viewer API, fits the camera to it, then
  // right-clicks at its projected screen position -- mirroring room-locator.acceptance.mjs's own
  // getNodeBox/worldToClient screen-projection approach, but POLLING for the projection to settle
  // within the canvas bounds rather than trusting a single fixed wait (see header comment on
  // fitToView's own camera-transition timing).
  async function selectAndRightClick(sourceDbId) {
    await page.evaluate((sourceDbId) => {
      const model = window.__test.modelStruct;
      window.viewer.select([sourceDbId], model);
      window.viewer.fitToView([sourceDbId], model);
    }, sourceDbId);

    const canvasBox = await page.locator('#preview canvas').first().boundingBox();
    let clickX, clickY;
    const maxAttempts = 20;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await page.waitForTimeout(150);
      const { x, y } = await page.evaluate((sourceDbId) => {
        const model = window.__test.modelStruct;
        const bbox = new Float32Array(6);
        model.getInstanceTree().getNodeBox(sourceDbId, bbox);
        const center = new window.THREE.Vector3(
          (bbox[0] + bbox[3]) / 2, (bbox[1] + bbox[4]) / 2, (bbox[2] + bbox[5]) / 2,
        );
        return window.viewer.worldToClient(center);
      }, sourceDbId);
      clickX = canvasBox.x + x;
      clickY = canvasBox.y + y;
      const withinCanvas = x >= 0 && x <= canvasBox.width && y >= 0 && y <= canvasBox.height;
      if (withinCanvas) break;
    }
    // Explicit, immediate diagnostic (rather than letting an off-canvas click silently fail to open
    // any context menu, surfacing only as a confusing downstream "menu item never appeared" timeout).
    const projectionWithinCanvas = clickX >= canvasBox.x && clickX <= canvasBox.x + canvasBox.width
      && clickY >= canvasBox.y && clickY <= canvasBox.y + canvasBox.height;
    check(`projected screen position for Structure dbId ${sourceDbId} settled within the canvas`, projectionWithinCanvas, true);

    await page.mouse.click(clickX, clickY, { button: 'right' });

    // Diagnostic, matching room-locator.acceptance.mjs's own precedent: confirms the right-click
    // actually preserved the intended selection before proceeding, turning a mis-projected click
    // into an immediate, legible failure instead of a confusing downstream timeout. Computed ENTIRELY
    // inside page.evaluate and reduced to a boolean -- getAggregateSelection()'s entries carry live
    // Model object references, which are not structured-cloneable across the Node<->page boundary.
    const landedOnTarget = await page.evaluate((sourceDbId) => {
      const model = window.__test.modelStruct;
      const agg = window.viewer.getAggregateSelection();
      return agg.length === 1 && agg[0].model === model && agg[0].selection.length === 1 && agg[0].selection[0] === sourceDbId;
    }, sourceDbId);
    check(`right-click landed on Structure dbId ${sourceDbId} (selection preserved)`, landedOnTarget, true);
  }

  // Clicks the real "Find Clashes" context-menu item ClashFinderExtension.js itself registers, and
  // waits for the resulting alert() -- ClashFinderExtension's own one user-visible caveat/report
  // channel (_notifyUser) -- dismissing it and returning its message text.
  async function clickFindClashesAndCaptureAlert() {
    const menuItem = page.locator('.menu-item', { hasText: 'Find Clashes' });
    await menuItem.waitFor({ timeout: 10_000 });
    // See header comment: the dialog handler MUST be registered (via page.once, not
    // page.waitForEvent AFTER the click) before menuItem.click() runs -- a fast-resolving findClashes
    // call can fire its alert() synchronously enough to block the main thread while click() is still
    // performing its own post-click stability checks.
    const messagePromise = new Promise((resolve) => {
      page.once('dialog', async (dialog) => {
        const message = dialog.message();
        console.log(`  [alert] ${message}`);
        await dialog.dismiss();
        resolve(message);
      });
    });
    await menuItem.click();
    const message = await Promise.race([
      messagePromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timed out waiting for the Find Clashes alert')), 120_000)),
    ]);
    return message;
  }

  async function getIsolatedNodesFor(modelKey) {
    const modelPropertyByKey = { arch: 'modelArch', struct: 'modelStruct', mech: 'modelMech' };
    return page.evaluate((prop) => window.viewer.getIsolatedNodes(window.__test[prop]), modelPropertyByKey[modelKey]);
  }

  const sortNums = (arr) => [...arr].sort((a, b) => a - b);
  const isolateCallFor = (spy, modelKey) => spy.isolateCalls.find((c) => c.modelKey === modelKey);
  const fitToViewCallFor = (spy, modelKey) => spy.fitToViewCalls.find((c) => c.modelKey === modelKey);

  // === Positive case: mixed same+cross-model, Structure dbId 2734 =================================
  console.log(`\n=== Case: ${MIXED_CASE.name} ===`);

  // Fixture-identity guard: confirms the live model still matches what this fixture assumes before
  // trusting any of the hardcoded numbers below.
  const mixedIdentity = await page.evaluate(async (sourceDbId) => {
    const it = window.__test.modelStruct.getInstanceTree();
    const name = it.getNodeName ? it.getNodeName(sourceDbId) : undefined;
    const { extractFragments } = await import('/collision/viewer/ViewerModelAdapter.js');
    const fragments = await extractFragments(window.__test.modelStruct, [sourceDbId], 0, { checkpoint: undefined, THREE: window.THREE });
    return { name, fragmentCount: fragments.size };
  }, MIXED_CASE.sourceDbId);
  check(`[mixed] fixture identity: dbId ${MIXED_CASE.sourceDbId}'s name includes "${MIXED_CASE.expectedNameIncludes}"`,
    typeof mixedIdentity.name === 'string' && mixedIdentity.name.includes(MIXED_CASE.expectedNameIncludes), true);
  check(`[mixed] fixture identity: dbId ${MIXED_CASE.sourceDbId} owns exactly one real fragment`, mixedIdentity.fragmentCount, 1);

  await resetVisualState();
  await selectAndRightClick(MIXED_CASE.sourceDbId);
  await resetSpyCapture(); // clear this test's OWN setup calls before the real production action fires
  const mixedMessage = await clickFindClashesAndCaptureAlert();
  const mixedSpy = await readSpyCapture();
  results.cases[MIXED_CASE.name] = { tier1AlertMessage: mixedMessage, spy: mixedSpy };

  const expectedPrefix = `${MIXED_CASE.expectedTotal} clashes found (${MIXED_CASE.expectedSameModelCount} in this model, ${MIXED_CASE.expectedCrossModelCount} in other models)`;
  check('[mixed] alert message starts with the expected summary', mixedMessage.startsWith(expectedPrefix), true);
  // See header comment: this fixture's mixed case carries a (non-zero, 12-diagnostic) incompleteness
  // caveat -- the exact diagnostic count/reasons are NOT asserted, only that the caveat is present.
  check('[mixed] alert message includes the incompleteness caveat', mixedMessage.includes('may be incomplete'), true);

  await page.screenshot({ path: path.join(RESULTS_DIR, `clash-finder-${MIXED_CASE.sourceDbId}-result.png`), fullPage: false });

  // --- exact-pair assertions on the REAL captured findClashes invocation (not a second, separately
  // issued query -- see header comment) ---
  check('[mixed] exactly one findClashes call made by the real click', mixedSpy.findClashesCalls.length, 1);
  const mixedCall = mixedSpy.findClashesCalls[0];
  check('[mixed] captured call: source is the Structure model', mixedCall.sourceModelKey, 'struct');
  check('[mixed] captured call: source.dbIds is exactly the selected dbId', mixedCall.sourceDbIds, [MIXED_CASE.sourceDbId]);
  check('[mixed] captured call: mode is volume-overlap', mixedCall.mode, 'volume-overlap');
  check('[mixed] captured call: groupBy is dbId', mixedCall.groupBy, 'dbId');
  check('[mixed] captured call: every pair uses volume-overlap mode', mixedCall.pairs.every((p) => p.type === 'volume-overlap'), true);
  check('[mixed] captured call: every pair\'s source really is Structure dbId 2734', mixedCall.pairs.every((p) => p.sourceModelKey === 'struct' && p.sourceDbId === MIXED_CASE.sourceDbId), true);

  const tupleKey = (p) => `${p.targetModelKey}:${p.targetDbId}`;
  const actualTupleKeys = mixedCall.pairs.map(tupleKey).sort();
  const expectedTupleKeys = MIXED_CASE.expectedPairs.map(tupleKey).sort();
  check('[mixed] captured call: exact {targetModel, targetDbId} pair set matches this regression\'s expected set', actualTupleKeys, expectedTupleKeys);

  const actualSameModelCount = mixedCall.pairs.filter((p) => p.targetModelKey === 'struct').length;
  const actualCrossModelCount = mixedCall.pairs.filter((p) => p.targetModelKey !== 'struct').length;
  check('[mixed] captured call: same-model pair count (correct provenance labeling)', actualSameModelCount, MIXED_CASE.expectedSameModelCount);
  check('[mixed] captured call: cross-model pair count (correct provenance labeling)', actualCrossModelCount, MIXED_CASE.expectedCrossModelCount);
  check('[mixed] captured call: the one cross-model pair is correctly attributed to the Architecture model',
    mixedCall.pairs.some((p) => p.targetModelKey === 'arch' && p.targetDbId === 3686), true);
  const pairKey = (p) => `${p.sourceModelKey}:${p.sourceDbId}:${p.targetModelKey}:${p.targetDbId}`;
  check('[mixed] captured call: no duplicate pairs', new Set(mixedCall.pairs.map(pairKey)).size, mixedCall.pairs.length);

  // Source excluded from its own results within its OWN model (same-model self-clash): dbId 2734
  // must never appear as its own same-model target.
  const sameModelTargetDbIds = mixedCall.pairs.filter((p) => p.targetModelKey === 'struct').map((p) => p.targetDbId);
  check('[mixed] captured call: source dbId excluded from its OWN model\'s results (same-model self-clash)',
    sameModelTargetDbIds.includes(MIXED_CASE.sourceDbId), false);

  // --- isolate/fitToView visualization check, bound to the REAL isolate()/fitToView() calls the
  // production callback made (not just the observable end-state) ---
  check('[mixed] real isolate() called for Structure with {selected dbId}+{same-model target}',
    sortNums(isolateCallFor(mixedSpy, 'struct')?.dbIds ?? []), sortNums(MIXED_CASE.expectedIsolatedStruct));
  check('[mixed] real isolate() called for Architecture with exactly the cross-model target',
    sortNums(isolateCallFor(mixedSpy, 'arch')?.dbIds ?? []), sortNums(MIXED_CASE.expectedIsolatedArch));
  check('[mixed] real fitToView() called for Structure with the SAME dbId set as isolate()',
    sortNums(fitToViewCallFor(mixedSpy, 'struct')?.dbIds ?? []), sortNums(MIXED_CASE.expectedIsolatedStruct));
  check('[mixed] real fitToView() called for Architecture with the SAME dbId set as isolate()',
    sortNums(fitToViewCallFor(mixedSpy, 'arch')?.dbIds ?? []), sortNums(MIXED_CASE.expectedIsolatedArch));
  // Mechanical has zero involvement in this query -- no isolate/fitToView call for it at all.
  check('[mixed] Mechanical model never isolated (no pairs involve it)', isolateCallFor(mixedSpy, 'mech'), undefined);
  check('[mixed] Mechanical model never fitToView\'d (no pairs involve it)', fitToViewCallFor(mixedSpy, 'mech'), undefined);

  // Corroborating end-state check (secondary to the call-level assertions above, which are the ones
  // that actually prove the production code path ran with the right arguments).
  const isolatedStruct = await getIsolatedNodesFor('struct');
  const isolatedArch = await getIsolatedNodesFor('arch');
  const isolatedMech = await getIsolatedNodesFor('mech');
  check('[mixed] end-state: Structure isolated set matches', sortNums(isolatedStruct), sortNums(MIXED_CASE.expectedIsolatedStruct));
  check('[mixed] end-state: Architecture isolated set matches', sortNums(isolatedArch), sortNums(MIXED_CASE.expectedIsolatedArch));
  check('[mixed] end-state: Mechanical isolated set is empty', isolatedMech, []);

  // === Negative case: Structure dbId 3965, real geometry, zero clashes ============================
  console.log(`\n=== Case: ${NEGATIVE_CASE.name} ===`);

  const negativeIdentity = await page.evaluate(async (sourceDbId) => {
    const it = window.__test.modelStruct.getInstanceTree();
    const name = it.getNodeName ? it.getNodeName(sourceDbId) : undefined;
    const { extractFragments } = await import('/collision/viewer/ViewerModelAdapter.js');
    const fragments = await extractFragments(window.__test.modelStruct, [sourceDbId], 0, { checkpoint: undefined, THREE: window.THREE });
    return { name, fragmentCount: fragments.size };
  }, NEGATIVE_CASE.sourceDbId);
  check(`[negative] fixture identity: dbId ${NEGATIVE_CASE.sourceDbId}'s name includes "${NEGATIVE_CASE.expectedNameIncludes}"`,
    typeof negativeIdentity.name === 'string' && negativeIdentity.name.includes(NEGATIVE_CASE.expectedNameIncludes), true);
  check(`[negative] fixture identity: dbId ${NEGATIVE_CASE.sourceDbId} owns exactly one real fragment (genuinely real geometry)`,
    negativeIdentity.fragmentCount, 1);

  await resetVisualState();
  await selectAndRightClick(NEGATIVE_CASE.sourceDbId);
  await resetSpyCapture();
  const negativeMessage = await clickFindClashesAndCaptureAlert();
  const negativeSpy = await readSpyCapture();
  results.cases[NEGATIVE_CASE.name] = { tier1AlertMessage: negativeMessage, spy: negativeSpy };
  // dbId 3965 is confirmed genuinely diagnostic-free (0/0, full three-model scope -- see header
  // comment), so this asserts an EXACT match with no caveat appended, not just a prefix.
  check('[negative] alert message is exactly "No clashes found." with no caveat', negativeMessage, 'No clashes found.');
  check('[negative] captured call: zero pairs', negativeSpy.findClashesCalls[0]?.pairs.length, 0);
  await page.screenshot({ path: path.join(RESULTS_DIR, `clash-finder-${NEGATIVE_CASE.sourceDbId}-result.png`), fullPage: false });

  // --- restore-visualization check, bound to the REAL isolate() calls _clearIsolation() made ---
  // (an end-state-only check here would be trivially true regardless of whether _clearIsolation() ran
  // at all, since resetVisualState() above already cleared the VISUAL state before this case's own
  // select+right-click. The extension's OWN _isolatedModels bookkeeping is independent of this test's
  // raw isolate([], model) calls -- only the extension's own isolate() calls update it -- so it still
  // holds {Structure, Architecture} left over from the mixed case above; asserting that the REAL
  // _clearIsolation() issued isolate([], model) calls for BOTH of those models during THIS click
  // proves the clearing code path genuinely executed, regardless of what the visual end-state already
  // was.) ---
  const isolateCallForNegative = (modelKey) => negativeSpy.isolateCalls.find((c) => c.modelKey === modelKey && c.dbIds.length === 0);
  check('[negative] real isolate([], Structure) called (proves _clearIsolation() iterated the prior case\'s own isolated models)', !!isolateCallForNegative('struct'), true);
  check('[negative] real isolate([], Architecture) called (same proof, for Architecture)', !!isolateCallForNegative('arch'), true);
  check('[negative] no fitToView() calls on the zero-pairs early-return branch', negativeSpy.fitToViewCalls.length, 0);

  // Corroborating end-state check.
  const isolatedStructAfterNegative = await getIsolatedNodesFor('struct');
  const isolatedArchAfterNegative = await getIsolatedNodesFor('arch');
  const isolatedMechAfterNegative = await getIsolatedNodesFor('mech');
  check('[negative] end-state: Structure isolation cleared', isolatedStructAfterNegative, []);
  check('[negative] end-state: Architecture isolation cleared', isolatedArchAfterNegative, []);
  check('[negative] end-state: Mechanical isolation still empty', isolatedMechAfterNegative, []);

  await browser.close();
  await writeFile(path.join(RESULTS_DIR, REPORT_FILE), JSON.stringify(results, null, 2));

  const failed = results.checks.filter((c) => !c.ok).length;
  console.log(`\n${results.checks.length - failed}/${results.checks.length} checks passed.`);
}

// Same guard as room-locator.acceptance.mjs, for the same reason (Node's `node --test` default
// discovery sweeps in every .js/.mjs file under a directory literally named `test`).
const isMainModule = !process.env.NODE_TEST_CONTEXT
  && process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) {
  main().catch(async (err) => {
    console.error(err);
    process.exitCode = 1;
    await browser?.close().catch(() => {});
    await writeFile(path.join(RESULTS_DIR, REPORT_FILE), JSON.stringify({ ...results, fatalError: String(err) }, null, 2)).catch(() => {});
  });
}
