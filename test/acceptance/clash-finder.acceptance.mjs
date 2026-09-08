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
//
// =================================================================================================
// M2.1 Task 10: witness markers, added on top of everything above
// =================================================================================================
//
// --- Discovery spike result (M2.1 Task 10 Step 1/2), re-derived live against THIS fixture ---------
//
// The M2 fixture above predates witness support, so nothing recorded which branch of
// volume-overlap(A,B) := crossing OR containment(A in B) OR containment(B in A) each MIXED_CASE pair
// actually resolved through. Re-derived live (a throwaway Playwright spike issuing the exact
// production `ext._world.findClashes` call against this same three-model scene) before any assertion
// below was written:
//
//   - struct 2734 -> arch   3686 : witness.kind === 'surface-crossing', point ~[37.1876, 22.1075, 12.1733]
//   - struct 2734 -> struct 3663 : witness.kind === 'containment',      point ~[51.9688, 22.1577, 12.1028]
//
// So this ONE existing fixture case already covers BOTH witness branches, crossing AND containment
// -- Task 10 Step 2's "if no containment case exists, find or build one" contingency never fires,
// and no additional purpose-built fixture model is needed. Both kinds are asserted explicitly below
// (MIXED_CASE.expectedPairs carries the expected `witnessKind` per pair), so a regression that
// silently collapses both pairs onto one branch, or drops a witness entirely, fails immediately.
//
// `via` ('crossing' | 'containment(A in B)' | 'containment(B in A)') is INTERNAL to
// collision/query/VolumeOverlapQuery.js and deliberately never reaches the public ClashPair --
// `witness.kind` ('surface-crossing' | 'containment') is the public observable, one-to-one with which
// branch fired, and is what this file asserts.
//
// --- Enclosed-witness visibility: how "visible THROUGH opaque geometry" is actually proven ---------
//
// The containment witness (struct 3663) is by construction a point INSIDE a solid, so proving the
// marker "remains visible through opaque geometry" needs more than an object-presence check on
// _activeMarkers or the overlay scene. This file proves it with four independent, live observations
// at the SAME screen pixel, with the camera aimed deliberately at the witness point (see the
// enclosedWitnessViewDirection constant, and the paragraph below it, for why the direction is
// fixture ground truth rather than an arbitrary choice):
//   1. OCCLUSION IS REAL: viewer.impl.hitTest(x, y, /*ignoreTransparent*/ true) at the witness point's
//      own projected position returns a real hit, on one of the elements THIS query isolated (so a
//      known, named, opaque element -- not just whatever happened to be under that pixel), whose
//      VIEW-AXIS DEPTH is smaller than the witness point's own by more than the marker's own radius.
//      Live: Architecture dbId 3686, 1.439 world units in front of the witness, against a 1.045
//      marker radius -- so the whole marker sphere along the centre ray is behind it.
//   2. THE MARKER IS WHAT RENDERS THERE: the composited pixels at that same position are sampled --
//      the exact centre pixel AND the whole 3x3 block centred on it must be marker-orange, and the
//      7x7 neighbourhood must be majority marker-orange.
//   3. THAT COLOUR IS ATTRIBUTABLE TO THIS MARKER MESH: the containment pair's own marker mesh is
//      detached from the overlay scene, the frame forced and re-sampled (the orange must be gone and
//      the occluding geometry must be what shows through instead), then re-attached and sampled again
//      (the orange must come back). This also doubles as the colour band's discrimination control,
//      and a better one than a sample taken elsewhere on screen: it is the SAME pixel.
//   4. IT IS VISIBLE *BECAUSE OF* depthTest:false: the production material's own depthTest is flipped
//      to true (and only that), which must make the occluder win at that exact pixel -- rendering
//      identically to the marker not being there at all -- and flipping it back must restore the
//      marker. This is the one place this file mutates production state; it is restored immediately
//      and the restoration is asserted.
// Together those facts are exactly the spec's regression-catcher. No one of them alone would be.
//
// Three measurement details that are easy to get wrong, all three established the hard way here:
//   - HitTestResult.distance is NOT a camera-to-hit-point distance. Live, at a camera 38.56 world
//     units from the hit point, it reported 212.22. Its origin/normalization is undocumented in the
//     pinned typings, and comparing it against a Euclidean camera-to-witness distance is not even
//     well posed under an orthographic camera. An earlier draft of this check did exactly that and
//     PASSED VACUOUSLY -- it looked like ~68 units of occlusion where the truth was ~0.13. Depth is
//     therefore measured for both points as (P - eye) . forward, from
//     viewer.navigation.getPosition()/getTarget() and HitTestResult.intersectPoint.
//   - Requiring the gap to EXCEED the marker radius is not pedantry. This witness sits only shallowly
//     inside the solid enclosing it, so from most directions the marker sphere protrudes in FRONT of
//     the occluding surface -- where "the marker is visible" would prove nothing at all about
//     rendering through geometry. A 62-direction live sweep found the deepest genuine occlusion this
//     fixture offers is the 1.439 units used above.
//   - viewer.impl.hitTest raycasts against the camera state of the LAST RENDERED FRAME. Probing in
//     the same tick as a camera move returns readings for the PREVIOUS camera (confirmed live: a
//     sweep that probed without waiting produced hit points sitting exactly at the eye and hit depths
//     that disagreed with the true camera-to-hit distance; re-running the identical directions with a
//     frame wait made every reading self-consistent and exactly reproducible). lookAtFrom() below
//     therefore always invalidates and waits real animation frames before anything probes.
//
// Pixel sampling deliberately avoids building any generic screenshot-diff infrastructure (the task's
// own explicit ban): page.screenshot({clip}) grabs one small square, which is then handed straight
// BACK into the page as a base64 data: URL and decoded with the browser's own Image + 2D-canvas
// getImageData. That round-trip exists because (a) Node has no built-in PNG decoder, and (b) reading
// the WebGL canvas directly in-page (drawImage/readPixels) is unreliable without
// preserveDrawingBuffer, whereas Playwright's screenshot captures the real composited surface.
//
// The tolerance band is coarse ON PURPOSE and is NOT an exact color match: MARKER_COLOR is 0xff6a00
// = rgb(255,106,0), but the Viewer's own gamma/sRGB output encoding renders it as rgb(255,164,0) on
// screen (confirmed live -- the green channel is raised by ~58). isMarkerOrange() below therefore
// asserts orange DOMINANCE, not equality. What shows the band actually DISCRIMINATES is observation 3
// above, not a separate reference sample taken elsewhere on screen: the very same pixel, sampled with
// this marker mesh detached, must fail the band. That is a strictly stronger control -- it holds the
// pixel, the camera and the frame fixed and changes only the one thing under test.
//
// --- Alignment (Task 10 Step 7): how one real model-alignment operation is performed ---------------
//
// There is no Model-Alignment UI extension in this repo (wwwroot/extensions/ has none), and no prior
// acceptance script has ever driven `invalidateModelPlacement` -- so the alignment step is performed
// through the real, typed Viewer API that live-mutates a loaded model's placement:
// viewer.impl.setPlacementTransform(model, matrix) (@types/forge-viewer/index.d.ts:2317), followed by
// the production CollisionWorld.invalidateModelPlacement(model) call an alignment tool would itself
// have to make. The Structure model is translated +3 in X and MIXED_CASE is re-run through the SAME
// real right-click path; the transform is then restored and the whole thing re-run once more.
//
// The two pairs are asserted DIFFERENTLY on purpose. The same-model containment pair (struct 2734 ->
// struct 3663) has both operands inside the model that just moved, so its witness must translate by
// exactly the alignment delta and nothing else -- a genuine rigid-motion invariant, asserted exactly
// (1e-6). The cross-model crossing pair (struct 2734 -> arch 3686) has no such invariant: only the
// Structure model moved, so where its surface crosses the STATIONARY Architecture element can change
// non-rigidly. This fixture happens to produce exactly +3 there too, but asserting that would
// overconstrain the test, so only MATERIAL movement is asserted and the observed delta is recorded in
// the run report instead. Every marker is separately asserted to sit on a witness point from the
// RE-RUN's own result (matched as a multiset, never by _activeMarkers order), which is what actually
// proves the markers tracked the alignment rather than merely being redrawn somewhere.
//
// Viewer API behavior confirmed live while writing this, because it changes how the click position
// must be computed: InstanceTree.getNodeBox() returns the model's OWN, placement-INDEPENDENT box --
// a live setPlacementTransform translation does NOT change what getNodeBox writes (verified: the
// identical 6 numbers before, during, and after a +3 X placement translation). The model's global
// offset, by contrast, IS already baked into that box (this model's getGlobalOffset() is a non-zero
// [-8.92, -56.06, 98.79] and the raw getNodeBox -> worldToClient projection has always landed
// correctly), so the offset must NOT be applied a second time. So selectAndRightClick() below adds
// the CHANGE in the placement's translation column, measured against the baseline placement captured
// right after the models load -- not the whole current column, which is only coincidentally the same
// number when the baseline happens to be identity (it is, here) -- and explicitly guards that the
// placement's other 13 elements are unchanged from that baseline. A pure translation is the only
// alignment this file performs, and it is the only case for which adding a translation delta is
// exactly correct; for a rotation/scale, or a non-identity baseline composed with one, neither this
// nor a naive global-offset adjustment would be sound and the click point would have to come from
// placed fragment bounds instead.

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
// M2.1 Task 10. Confirmed against wwwroot/extensions/ClashFinderExtension.js:49 (MARKER_OVERLAY_NAME)
// -- copied, not imported, for the same reason as CLASH_FINDER_EXTENSION_ID above.
const MARKER_OVERLAY_NAME = 'clash-finder-markers';
// Mirrors ClashFinderExtension.js:51-52 (MIN/MAX_MARKER_RADIUS, also exposed as static class fields).
// Copied for the same never-import-a-browser-module reason; only used to assert the clamp holds
// against the real fixture, so a drift here weakens nothing that is asserted elsewhere.
const EXPECTED_MIN_MARKER_RADIUS = 0.05;
const EXPECTED_MAX_MARKER_RADIUS = 2.0;

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
  // M2.1 Task 10: `witnessKind` per pair, from this task's own live discovery spike (see the header
  // comment's own "Discovery spike result" section) -- this one fixture case covers BOTH branches.
  expectedPairs: [
    { targetModelKey: 'arch', targetDbId: 3686, witnessKind: 'surface-crossing' },
    { targetModelKey: 'struct', targetDbId: 3663, witnessKind: 'containment' },
  ],
  // Structure: {selected source dbId} union {same-model target}. Architecture: {cross-model target}.
  // Mechanical: untouched entirely -- no isolate/fitToView call for it at all (asserted explicitly).
  expectedIsolatedStruct: [2734, 3663],
  expectedIsolatedArch: [3686],
  // M2.1 Task 10: the containment (enclosed) witness's own world point, live-derived in this task's
  // discovery spike, and the dbId of the element it is enclosed by -- the camera is fitted to that
  // element for the through-opaque-geometry visibility check. Asserted with a tolerance band (not an
  // exact match): this is real floating-point geometry output, and the check exists to catch the
  // witness relocating to a meaningfully different place, not to pin its last bit.
  containmentTargetDbId: 3663,
  expectedContainmentWitnessPoint: [51.96875238418579, 22.157734554260948, 12.102793365716934],
  containmentWitnessTolerance: 0.01,
  // The viewing direction used for the enclosed-witness visibility check, and the camera's distance
  // from the witness along it. Both are live-derived fixture ground truth, NOT arbitrary: this
  // witness turns out to sit only shallowly inside the solid that encloses it, so most viewing
  // directions leave the marker sphere (radius ~1.045) partly protruding in FRONT of the occluding
  // surface -- which would make "the marker is visible" prove nothing about rendering THROUGH
  // geometry. A 62-direction live sweep (see the header comment) found this direction gives the
  // largest genuine gap: the nearest opaque, ISOLATED geometry along this ray sits 1.439 world units
  // in front of the witness, so the whole marker sphere along the centre ray is behind it.
  enclosedWitnessViewDirection: [0.433, -0.75, -0.5],
  enclosedWitnessViewDistance: 40,
  // M3 Task 17: the SURFACE-CROSSING target of the two expectedPairs above, named explicitly so the
  // Soft Clash Hard-Clash-exclusion case below can reference it by intent rather than by array index.
  // The crossing target is the correct one to use there, NOT the containment target (struct 3663): a
  // crossing pair's true surface distance is exactly 0, i.e. the two elements are genuinely TOUCHING,
  // so its absence from a clearance result is a claim about the Hard-Clash exclusion rule itself --
  // whereas a merely far-apart target would be absent from a `clearance: 5` result for the wholly
  // unrelated reason that it is more than 5 units away.
  hardClashTargetDbId: 3686,
  hardClashTargetModelKey: 'arch',
};

// M2.1 Task 10. The one alignment operation this file performs (see the header comment's own
// "Alignment" section): a pure +3-unit translation in X of the Structure model's placement transform.
// Large enough that both marker positions move unambiguously, small enough that both MIXED_CASE pairs
// still clash afterwards (confirmed live -- the same 2 pairs, same targets, same witness kinds).
const ALIGNMENT_DELTA_X = 3;
const NEGATIVE_CASE = {
  name: 'negative (Structure dbId 3965)',
  sourceDbId: 3965,
  expectedNameIncludes: 'HSS-Hollow Structural Section-Column',
  hasGeometry: true,
};

// =================================================================================================
// M3 Task 17: Soft Clash (clearance mode) live acceptance, added on top of everything above
// =================================================================================================
//
// --- Bounded near-miss discovery spike (Task 17 Step 1), run live against THIS fixture -----------
//
// Per the M2.1 Task-10 bounded-spike precedent, a throwaway Playwright spike issued the exact
// production `CollisionWorld.findClashes({mode:'clearance', ...})` call against this same
// three-model scene, with an explicitly CAPPED iteration count, before a single assertion below was
// written. Starting source: NEGATIVE_CASE's own dbId 3965 (this fixture's known Hard-Clash negative
// -- exactly the element whose "no clashes" verdict a clearance query is most likely to refine).
// Sweep: clearance in {0.01, 0.05, 0.1, 0.25, 0.5, 1.0, 2.0}, stopping at the first value that finds
// anything -- at most 7 calls, with a further hard cap of 4 geometric neighbours x 3 clearances
// prepared as the fallback if 3965 alone found nothing. That fallback never fired: the sweep's
// SECOND value already found a real near-miss, so the whole spike cost 2 calls.
//
//   clearance 0.01 -> 0 pairs (0 broad-phase candidates, 0 distance queries)
//   clearance 0.05 -> 2 pairs:
//     struct 3965 -> struct 3976  distance 0.04166616338460325
//     struct 3965 -> struct 4135  distance 0.04166616338460503
//
// A follow-up fine sweep bracketed the true minimum tightly -- 0.02, 0.03, 0.04 and 0.0416 all
// return 0 pairs; 0.042 and 0.05 both return exactly the 2 pairs above -- so
// **3965's true minimum surface-to-surface distance to anything in the whole federated scene is
// 0.0416661633846**, and any clearance strictly below that is a genuinely, provably empty query
// rather than a vacuously empty one. That measurement is what the known-negative case's own
// clearance value below is derived from; the brief's own placeholder (0.001) was NOT used, because
// nothing had been measured yet when it was written.
//
// The discovered pair is real, ordinary building geometry, not a curiosity: 3965 is
// "HSS-Hollow Structural Section-Column [681589]" and 3976/4135 are two
// "SMBH-HSS-Hollow Structural Section" members that stop just short of it. The near-miss is a clean
// Y-axis gap, independently derivable from the InstanceTree's own node boxes with no help from the
// collision pipeline at all: 3965's box min-Y is 20.81414794921875 and both targets' box max-Y is
// 20.772480010986328, a gap of 0.041667938 -- agreeing with the measured surface distance to within
// 1.8e-6 (the residual is Float32 node-box quantization). The positive case below asserts exactly
// that cross-check, so the measured distance is corroborated by a completely independent data
// source, not merely by the pipeline that produced it.
//
// Because 0.0416661633846 < DEFAULT_CLEARANCE (0.05, ClashFinderExtension.js:60), the REAL "Find
// Soft Clashes" context-menu action finds this pair at its own production default clearance, with
// no override of any kind -- so the positive case below goes through the genuine production path
// end to end.
//
// --- Why the two always-run cases each need their own clearance, and how it is supplied ----------
//
// There is no UI to set a per-call clearance: the "Find Soft Clashes" action always issues
// `clearance: this._clearance`, resolved once in load() from `options.defaultClearance ??
// DEFAULT_CLEARANCE`. Both always-run cases below deliberately need a clearance that is NOT the
// default (one far below it, one far above it), so runFindSoftClashesCase() assigns `ext._clearance`
// directly for exactly those two cases and restores the original value immediately afterwards --
// keeping every case on the REAL menu-driven production path (an acceptance test's whole point)
// rather than dropping to a direct API call for two of the three. The restoration is asserted, and
// the positive case deliberately passes NO override at all, so the one case that matters most runs
// against wholly untouched production state.
//
// --- Witness shape: genuinely different from Hard Clash's, not a variant of it -------------------
//
// A volume-overlap pair's witness is `{kind, point}`; a clearance pair's is
// `{sourcePoint, targetPoint}` -- the two ends of the closest approach, with no `kind` and no
// `point` at all. The findClashes spy below therefore reads both shapes defensively (see its own
// comment): the pre-existing `[...p.witness.point]` would have thrown a TypeError on the very first
// clearance pair it ever saw.
const EXPECTED_DEFAULT_CLEARANCE = 0.05; // ClashFinderExtension.js:60 (DEFAULT_CLEARANCE)
// ClashFinderExtension.js:67-68 and :75-76 -- copied, never imported, for the same reason as
// MARKER_OVERLAY_NAME above.
const SOFT_CLASH_OVERLAY_NAME = 'clash-finder-soft-markers';
const EXPECTED_SOFT_CLASH_COLOR = 0x2b8fff;
const EXPECTED_HARD_CLASH_COLOR = 0xff6a00;
const EXPECTED_SOFT_MIN_MARKER_RADIUS = 0.05;
const EXPECTED_SOFT_MAX_MARKER_RADIUS = 2.0;

const SOFT_CLASH_POSITIVE_CASE = {
  name: 'soft clash positive: discovered near-miss (Structure dbId 3965, production default clearance)',
  sourceDbId: NEGATIVE_CASE.sourceDbId, // 3965 -- this fixture's Hard-Clash negative, and a real Soft Clash positive
  // No override: this is DEFAULT_CLEARANCE itself, asserted to still be what the live extension
  // resolved, so this case exercises the untouched production action.
  clearance: EXPECTED_DEFAULT_CLEARANCE,
  expectedPairs: [
    { targetModelKey: 'struct', targetDbId: 3976 },
    { targetModelKey: 'struct', targetDbId: 4135 },
  ],
  // Both pairs measure the same gap to within ~2e-15; which of the two carries the ...325 and which
  // the ...503 last bits is NOT stable across runs (observed swapping between a baseline and an
  // alignment re-run), so the distance is asserted per-pair against this ONE value with a tolerance,
  // never as an exact per-target mapping.
  expectedDistance: 0.04166616338460325,
  distanceTolerance: 1e-6,
  // The same gap, re-derived from the InstanceTree's own Float32 node boxes -- see the header
  // comment above. The tolerance covers Float32 node-box quantization, nothing else.
  expectedNodeBoxGap: 0.041667938232421875,
  nodeBoxGapTolerance: 1e-4,
  // Soft Clash's own isolation contribution: the source plus both targets, all in the Structure model.
  expectedSoftIsolatedStruct: [3965, 3976, 4135],
  expectedAlertMessage: '2 clashes found (2 in this model, 0 in other models)',
};

// Provably below SOFT_CLASH_POSITIVE_CASE.expectedDistance (0.04166616...), the measured true
// minimum distance from dbId 3965 to ANY element in the whole three-model scene -- so a zero-pair
// result here is a real geometric negative, not a threshold artifact. Deliberately NOT the brief's
// own placeholder 0.001 and not the sweep's own 0.01 either: at 0.02 the value is still less than
// half the true minimum (so the negative is unambiguous) while being 20x larger than 0.001, which
// makes it a far less trivially-satisfied query. The pairing with the positive case above is what
// makes this negative non-vacuous: the SAME source element, through the SAME production action,
// finds exactly 2 pairs at 0.05 and exactly 0 at 0.02.
const SOFT_CLASH_NEGATIVE_CLEARANCE = 0.02;

// Deliberately huge (100x the default, and ~20x the largest distance the Hard-Clash-excluded pair
// could plausibly be at), so the two known Hard Clash targets are absent for exactly one reason:
// the Hard-Clash exclusion rule. Live: this query returns 33 clearance pairs spanning distances
// 0.0417 to 4.82, and neither Hard Clash target is among them.
const SOFT_CLASH_HARD_CLASH_EXCLUSION_CLEARANCE = 5;

const RESULTS_DIR = path.join(process.cwd(), 'test/acceptance/results');
// Deliberately a DIFFERENT filename from room-locator.acceptance.mjs's own run-report.json -- both
// scripts share test/acceptance/results/ and must never clobber each other's report when run
// back-to-back.
const REPORT_FILE = 'clash-finder-run-report.json';

// M2.1 Task 10: `consoleErrors` collects every console.error the page emits across the WHOLE run
// (installed before the first model even starts loading -- see main()), and is asserted empty at the
// very end. Neither this file nor room-locator.acceptance.mjs had any generic console-error
// collector before this task; room-locator's only console listener is a narrow console.warn filter
// for one extension name.
// `pageErrors` is collected alongside it because an UNCAUGHT page exception is not guaranteed to
// surface as a console.error event at all (codex-advisor, Task 10) -- a marker-rendering path that
// threw would otherwise be invisible to a console-only collector.
const results = { extensionLoaded: null, cases: {}, consoleErrors: [], pageErrors: [], checks: [] };

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

  // M2.1 Task 10 Step 9: installed HERE, before any model load begins, so it captures errors from
  // the entire run -- viewer bootstrap, all three model loads, every Find Clashes invocation, the
  // alignment step, and the model unload. Unlike this file's per-case page.once('dialog', ...)
  // handlers (deliberately per-case, see clickFindClashesAndCaptureAlert's own comment), this one is
  // persistent for the whole session. Asserted empty at the very end of main().
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      console.log(`  [console.error] ${msg.text()}`);
      // msg.location() is recorded too, so that if genuine infrastructure noise ever does appear,
      // any future allowlist can be pinned to an exact observed signature rather than a substring.
      results.consoleErrors.push(msg.text());
      results.consoleErrorDetails = results.consoleErrorDetails ?? [];
      results.consoleErrorDetails.push({ text: msg.text(), location: msg.location() });
    }
  });
  page.on('pageerror', (err) => {
    console.log(`  [pageerror] ${err}`);
    results.pageErrors.push(String(err));
  });

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
  // M2.1 Task 10: the Structure model's BASELINE placement transform, captured before this file ever
  // touches it, kept as the reference selectAndRightClick's own projection correction measures its
  // delta against (codex-advisor: adding the whole current translation column is correct only if the
  // baseline placement happens to be identity -- measuring the delta from the recorded baseline is
  // correct regardless, and is asserted to be restored exactly at the end of the alignment step).
  await page.evaluate(() => {
    window.__test.structBaselinePlacement = Array.from(
      window.__test.modelStruct.getPlacementTransform()?.elements ?? new window.THREE.Matrix4().elements,
    );
  });
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
        // M3 Task 17: the clearance threshold this call was actually issued with. `undefined` for
        // every volume-overlap call (which carries no `clearance` key at all) -- normalized to null
        // so it crosses the page<->Node boundary as structured-cloneable data rather than being
        // dropped by JSON serialization. No pre-existing Hard Clash assertion reads this field.
        clearance: query.clearance ?? null,
        pairs: result.pairs.map((p) => ({
          sourceModelKey: modelKeyOf(p.source.model),
          sourceDbId: p.source.dbId,
          targetModelKey: modelKeyOf(p.target.model),
          targetDbId: p.target.dbId,
          type: p.type,
          // M2.1 Task 10: the witness itself, captured off the REAL production result (not a second,
          // separately issued query). `witness.point` is a plain [x,y,z] array by Global Constraint
          // -- never a THREE.Vector3 of either revision -- so it crosses the page<->Node boundary as
          // structured-cloneable plain data with no conversion. `witnessKind` is null exactly when
          // the pair carried no witness at all, which is what Step 3 asserts never happens here.
          //
          // M3 Task 17: BOTH witness shapes are now read, each guarded, because a clearance pair's
          // witness is genuinely a different shape and not a variant of the volume-overlap one --
          // `{sourcePoint, targetPoint}`, with NO `kind` and NO `point`. The pre-existing
          // `[...p.witness.point]` was therefore not merely inapplicable to clearance pairs but
          // actively fatal: spreading `undefined` throws a TypeError, so this one wrapper would have
          // thrown inside the production callback on the very first Soft Clash pair it ever saw.
          // For a volume-overlap pair every field below evaluates to EXACTLY what it evaluated to
          // before this task (`kind` is a real string, `point` a real array, and the three new
          // fields are all null), so every pre-existing Hard Clash assertion is untouched.
          witnessKind: p.witness ? (p.witness.kind ?? null) : null,
          witnessPoint: p.witness && Array.isArray(p.witness.point) ? [...p.witness.point] : null,
          witnessSourcePoint: p.witness && Array.isArray(p.witness.sourcePoint) ? [...p.witness.sourcePoint] : null,
          witnessTargetPoint: p.witness && Array.isArray(p.witness.targetPoint) ? [...p.witness.targetPoint] : null,
          distance: typeof p.distance === 'number' ? p.distance : null,
          clearance: typeof p.clearance === 'number' ? p.clearance : null,
        })),
        diagnosticsCount: result.statistics?.diagnostics?.length ?? 0,
        // M3 Task 17: a small, explicitly-picked set of the clearance statistics -- picked field by
        // field rather than cloning `result.statistics` wholesale, so nothing non-cloneable can ever
        // leak across the page<->Node boundary through this wrapper. Every one of these is
        // already-shipped M3 Batch 1-2 surface, present (as 0) on EVERY findClashes result including
        // volume-overlap ones, so this adds no mode-specific branching. `clearanceHardClashExclusions`
        // in particular is the mechanism-specific proof the Hard-Clash-exclusion case below needs:
        // it can only be nonzero if the tri-state precheck actually ran and PROVED overlap.
        clearanceStatistics: {
          clearanceExpandedCandidatePairs: result.statistics?.clearanceExpandedCandidatePairs ?? null,
          clearanceExactAabbSurvivors: result.statistics?.clearanceExactAabbSurvivors ?? null,
          clearanceOverlapPrechecksRun: result.statistics?.clearanceOverlapPrechecksRun ?? null,
          clearanceHardClashExclusions: result.statistics?.clearanceHardClashExclusions ?? null,
          clearanceDistanceQueriesRun: result.statistics?.clearanceDistanceQueriesRun ?? null,
          clearanceHits: result.statistics?.clearanceHits ?? null,
          narrowPhasePairs: result.statistics?.narrowPhasePairs ?? null,
        },
        diagnosticReasons: [...new Set((result.statistics?.diagnostics ?? []).map((d) => d?.reason ?? 'unknown'))],
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
    let placementIsPureTranslation = true;
    const maxAttempts = 20;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await page.waitForTimeout(150);
      const { x, y, pureTranslation } = await page.evaluate((sourceDbId) => {
        const model = window.__test.modelStruct;
        const bbox = new Float32Array(6);
        model.getInstanceTree().getNodeBox(sourceDbId, bbox);
        const center = new window.THREE.Vector3(
          (bbox[0] + bbox[3]) / 2, (bbox[1] + bbox[4]) / 2, (bbox[2] + bbox[5]) / 2,
        );
        // M2.1 Task 10: getNodeBox returns the model's OWN, placement-INDEPENDENT box -- verified
        // live that a setPlacementTransform translation leaves those 6 numbers byte-identical, while
        // the model's global offset IS already baked into them (so the offset must NOT be applied
        // again here). Before Task 10 this file only ever ran with the model's baseline placement, so
        // projecting the raw centre was correct; the alignment step below deliberately changes that
        // placement, so what is added here is the DELTA of the placement's translation column
        // (elements[12..14], column-major) relative to the baseline captured at load time -- not the
        // whole current column, which would only coincidentally be the same thing when the baseline
        // happens to be identity. `pureTranslation` reports whether the CHANGE is still a pure
        // translation (the placement's own 3x3 rotation/scale block unchanged from baseline): adding
        // a translation delta is exactly correct ONLY then, and a pure translation is the only
        // alignment this file ever performs, so it is checked rather than assumed.
        const placement = model.getPlacementTransform();
        const e = placement ? placement.elements : null;
        const base = window.__test.structBaselinePlacement;
        let pureTranslation = true;
        if (e && base) {
          center.x += e[12] - base[12];
          center.y += e[13] - base[13];
          center.z += e[14] - base[14];
          pureTranslation = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 15]
            .every((i) => e[i] === base[i]);
        }
        const client = window.viewer.worldToClient(center);
        return { x: client.x, y: client.y, pureTranslation };
      }, sourceDbId);
      placementIsPureTranslation = pureTranslation;
      clickX = canvasBox.x + x;
      clickY = canvasBox.y + y;
      const withinCanvas = x >= 0 && x <= canvasBox.width && y >= 0 && y <= canvasBox.height;
      if (withinCanvas) break;
    }
    check(`Structure model's placement change is still a pure translation when projecting dbId ${sourceDbId}`,
      placementIsPureTranslation, true);
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

  // === M2.1 Task 10 helpers ======================================================================

  // Reads the live marker state straight off the real extension instance. Everything returned is
  // plain, structured-cloneable data (mesh.position/scale are read component-wise; the Mesh objects
  // themselves never cross the page<->Node boundary). `overlaySceneMeshCount` reads
  // viewer.impl.overlayScenes -- the one INTERNAL accessor used here, purely as corroboration, since
  // the public OverlayManager exposes no "how many meshes are in this scene" query at all; the
  // load-bearing per-mesh check is `hasMeshFlags`, which uses the PUBLIC viewer.overlays.hasMesh.
  // That per-mesh check matters specifically because Batch 2's review found a silent-failure bug
  // class here (addMesh/removeMesh called with swapped arguments returns false with no throw, so
  // _activeMarkers can look perfectly correct while the overlay scene is actually empty) -- an
  // _activeMarkers.length assertion alone would NOT catch it.
  async function readMarkerState() {
    return page.evaluate(({ extensionId, overlayName }) => {
      const ext = window.viewer.getExtension(extensionId);
      return {
        activeMarkerCount: ext._activeMarkers.length,
        positions: ext._activeMarkers.map((m) => [m.position.x, m.position.y, m.position.z]),
        radii: ext._activeMarkers.map((m) => m.scale.x),
        uniformScale: ext._activeMarkers.every((m) => m.scale.x === m.scale.y && m.scale.y === m.scale.z),
        hasScene: window.viewer.overlays.hasScene(overlayName),
        hasMeshFlags: ext._activeMarkers.map((m) => window.viewer.overlays.hasMesh(m, overlayName)),
        overlaySceneMeshCount: window.viewer.impl.overlayScenes?.[overlayName]?.scene?.children?.length ?? null,
      };
    }, { extensionId: CLASH_FINDER_EXTENSION_ID, overlayName: MARKER_OVERLAY_NAME });
  }

  // Keeps a reference to the CURRENT marker meshes on a page-global so a later "were they really
  // removed from the overlay scene?" check can still ask viewer.overlays.hasMesh about the exact
  // same objects after _activeMarkers has been emptied. Without this, every post-clear check would
  // reduce to "the array is empty", which is exactly the assertion the silent-failure bug above
  // would have passed.
  async function stashMarkerMeshes() {
    await page.evaluate((extensionId) => {
      window.__test.stashedMarkers = [...window.viewer.getExtension(extensionId)._activeMarkers];
    }, CLASH_FINDER_EXTENSION_ID);
  }
  async function stashedMarkersStillInOverlay() {
    return page.evaluate((overlayName) => (window.__test.stashedMarkers ?? [])
      .map((m) => window.viewer.overlays.hasMesh(m, overlayName)), MARKER_OVERLAY_NAME);
  }

  // Projects a world point to canvas-relative client coordinates and reports whether real, OPAQUE
  // model geometry sits between the camera and that point along the same ray (see the header
  // comment's own "Enclosed-witness visibility" section for why both halves are needed).
  //
  // Depth is measured as the projection onto the camera's own view direction -- (P - eye) . forward
  // -- for BOTH the hit and the witness point, rather than by reading HitTestResult.distance and
  // comparing it against a Euclidean camera-to-point distance. Two reasons (codex-advisor, Task 10):
  // HitTestResult.distance's exact origin/normalization is undocumented in the pinned typings, and a
  // Euclidean-vs-whatever comparison is not even well posed under an orthographic camera. A view-axis
  // depth comparison is correct under both projections and depends on nothing undocumented.
  // viewer.navigation.getPosition()/getTarget() are both public, typed Navigation APIs.
  async function projectAndProbeOcclusion(worldPoint) {
    return page.evaluate((pt) => {
      const THREE = window.THREE; // Viewer's own r71 global -- never the imported `three` package
      const witness = new THREE.Vector3(pt[0], pt[1], pt[2]);
      const client = window.viewer.worldToClient(witness.clone());
      const eye = window.viewer.navigation.getPosition();
      const target = window.viewer.navigation.getTarget();
      const forward = new THREE.Vector3(target.x - eye.x, target.y - eye.y, target.z - eye.z).normalize();
      const depthOf = (p) => (p.x - eye.x) * forward.x + (p.y - eye.y) * forward.y + (p.z - eye.z) * forward.z;
      // ignoreTransparent: true -- after "Find Clashes" isolates, every non-isolated element renders
      // ghosted/transparent, and only an OPAQUE occluder honestly proves "visible through opaque
      // geometry". hitTest never sees overlay scenes, so whatever it reports is always real model
      // geometry, never the marker itself.
      const hit = window.viewer.impl.hitTest(client.x, client.y, true);
      const modelKeyOf = (model) => {
        if (model === window.__test.modelArch) return 'arch';
        if (model === window.__test.modelStruct) return 'struct';
        if (model === window.__test.modelMech) return 'mech';
        return 'unknown';
      };
      return {
        client: { x: client.x, y: client.y },
        witnessDepth: depthOf(witness),
        hit: hit ? {
          dbId: hit.dbId,
          modelKey: modelKeyOf(hit.model),
          depth: depthOf(hit.intersectPoint ?? hit.point),
        } : null,
        canvas: { width: window.viewer.canvas.clientWidth, height: window.viewer.canvas.clientHeight },
      };
    }, worldPoint);
  }

  // Points the camera at `worldPoint` from `worldPoint + direction * distance`, then repaints and
  // waits. Both halves matter: viewer.navigation.setView is a public, typed Navigation API, but
  // viewer.impl.hitTest raycasts against the camera state of the LAST RENDERED FRAME -- probing in
  // the same tick as setView returns readings for the PREVIOUS camera (confirmed live: an earlier
  // sweep that probed without waiting produced hit points sitting exactly at the eye, and hit depths
  // that disagreed with the true camera-to-hit distance; re-running the identical directions with a
  // frame wait made every reading self-consistent and exactly reproducible).
  //
  // The camera placement is RE-ISSUED until it actually sticks, and the achieved eye position is
  // returned so the caller can assert it. This is not defensive padding: the production Find Clashes
  // callback ends in viewer.fitToView(), which starts a camera TRANSITION, and a setView issued while
  // that transition is still animating is simply overwritten by it moments later (confirmed live --
  // a single setView left the camera at the fitToView pose, and every downstream occlusion/pixel
  // assertion then measured that pose instead of the requested one).
  async function lookAtFrom(worldPoint, direction, distance) {
    const expectedEye = worldPoint.map((v, i) => v + direction[i] * distance);
    let eye = null;
    for (let attempt = 0; attempt < 20; attempt++) {
      eye = await page.evaluate(({ pt, dir, dist }) => {
        const THREE = window.THREE; // Viewer's own r71 global -- never the imported `three` package
        const target = new THREE.Vector3(pt[0], pt[1], pt[2]);
        const position = new THREE.Vector3(
          pt[0] + dir[0] * dist, pt[1] + dir[1] * dist, pt[2] + dir[2] * dist,
        );
        window.viewer.navigation.setView(position, target);
        window.viewer.impl.invalidate(true, true, true);
        const p = window.viewer.navigation.getPosition();
        return [p.x, p.y, p.z];
      }, { pt: worldPoint, dir: direction, dist: distance });
      await waitForFrames();
      eye = await page.evaluate(() => {
        const p = window.viewer.navigation.getPosition();
        return [p.x, p.y, p.z];
      });
      if (maxAbsDelta(eye, expectedEye) <= 1e-3) break;
    }
    return { eye, expectedEye, settled: maxAbsDelta(eye, expectedEye) <= 1e-3 };
  }

  // Waits for the page to actually paint before pixels are sampled: a settled projection alone does
  // not guarantee the frame on screen reflects the latest overlay state (codex-advisor, Task 10).
  async function waitForFrames(count = 5) {
    await page.evaluate((n) => new Promise((resolve) => {
      let remaining = n;
      const tick = () => { if (--remaining <= 0) resolve(); else requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    }), count);
    await page.waitForTimeout(400); // plus a settle gap for the Viewer's own progressive rendering
  }

  // Detaches / re-attaches ONE specific marker mesh from the overlay scene and forces a repaint, so
  // the same pixel can be sampled with the marker present and absent. This is what actually
  // ATTRIBUTES the sampled colour to the production-created mesh (codex-advisor, Task 10). An earlier
  // draft instead sampled a reference point 150px away; that was dropped and no such sample is taken
  // anywhere in this file, because it can only show that the colour band discriminates SOMEWHERE --
  // never that THIS marker is what painted THIS pixel. The detach/re-attach differential below shows
  // both at once, holding the pixel, camera and frame fixed. Uses the same public
  // viewer.overlays.addMesh/removeMesh the production code itself uses, with the same
  // (mesh, sceneName) argument order.
  async function setContainmentMarkerAttached(attached) {
    await page.evaluate(({ overlayName, attached }) => {
      const mesh = window.__test.containmentMarker;
      if (attached) window.viewer.overlays.addMesh(mesh, overlayName);
      else window.viewer.overlays.removeMesh(mesh, overlayName);
      window.viewer.impl.invalidate(true, true, true);
    }, { overlayName: MARKER_OVERLAY_NAME, attached });
    await waitForFrames();
  }

  // One small screenshot square, decoded back inside the page (see the header comment for why the
  // round-trip, and why this is deliberately not generic screenshot-diff infrastructure). Returns a
  // flat array of [r,g,b] triples, row-major.
  async function samplePixelBlock(clientX, clientY, half) {
    const canvasBox = await page.locator('#preview canvas').first().boundingBox();
    const png = await page.screenshot({
      clip: {
        x: Math.round(canvasBox.x + clientX) - half,
        y: Math.round(canvasBox.y + clientY) - half,
        width: half * 2 + 1,
        height: half * 2 + 1,
      },
    });
    return page.evaluate(async (base64) => {
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(new Error('failed to decode the sampled screenshot region'));
        img.src = `data:image/png;base64,${base64}`;
      });
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const pixels = [];
      for (let i = 0; i < data.length; i += 4) pixels.push([data[i], data[i + 1], data[i + 2]]);
      return pixels;
    }, png.toString('base64'));
  }

  // Coarse orange-DOMINANCE band, never an exact color match -- MARKER_COLOR 0xff6a00 is
  // rgb(255,106,0) in source but renders as rgb(255,164,0) through the Viewer's gamma/sRGB output
  // encoding (confirmed live). The band is wide on the green channel for exactly that reason and
  // still comfortably excludes this fixture's own rendered materials: the occluding geometry at the
  // sampled pixel measures rgb(131,136,143) -- the value this run's own report records as
  // markerDetachedCentre -- a blue-grey that fails on every clause.
  const isMarkerOrange = ([r, g, b]) => r >= 200 && b <= 80 && (r - b) >= 140 && (r - g) >= 40;
  const orangeFraction = (pixels) => pixels.filter(isMarkerOrange).length / pixels.length;

  const maxAbsDelta = (actual, expected) => Math.max(...actual.map((v, i) => Math.abs(v - expected[i])));
  const pointsWithin = (actual, expected, tolerance) => actual.length === expected.length
    && maxAbsDelta(actual, expected) <= tolerance;

  // Applies/reads the Structure model's placement transform. The original transform's 16 elements are
  // captured as a PLAIN array (never the live Matrix4 object, which is not structured-cloneable) and
  // written back element-by-element on restore -- Matrix4#set()'s row-major argument order is an easy
  // silent transposition, and elements[] is column-major, so a direct element copy is the
  // unambiguous form here.
  async function readStructPlacementElements() {
    return page.evaluate(() => Array.from(
      window.__test.modelStruct.getPlacementTransform()?.elements ?? new window.THREE.Matrix4().elements,
    ));
  }
  // Translates the Structure model's placement by (dx,0,0) in world space and tells CollisionWorld
  // its cached placements for that model are now stale -- the exact pair of calls a real
  // model-alignment tool has to make. viewer.impl.setPlacementTransform(model, matrix) is a real,
  // typed Viewer API (@types/forge-viewer/index.d.ts:2317). window.THREE (r71) is used for the
  // matrices, never the imported `three` package -- the same runtime-isolation discipline every other
  // Viewer-side object in this file follows.
  async function translateStructPlacement(dx) {
    await page.evaluate(({ extensionId, dx }) => {
      const model = window.__test.modelStruct;
      const moved = (model.getPlacementTransform() ?? new window.THREE.Matrix4()).clone();
      moved.multiplyMatrices(new window.THREE.Matrix4().makeTranslation(dx, 0, 0), moved);
      window.viewer.impl.setPlacementTransform(model, moved);
      window.viewer.getExtension(extensionId)._world.invalidateModelPlacement(model);
      // Autodesk's own dynamic-model-placement guidance invalidates after changing a placement;
      // harmless if setPlacementTransform already schedules a frame, and it removes any doubt that
      // what is on screen afterwards reflects the new placement.
      window.viewer.impl.invalidate(true, true, true);
    }, { extensionId: CLASH_FINDER_EXTENSION_ID, dx });
    await waitForFrames();
  }
  async function restoreStructPlacement(elements) {
    await page.evaluate(({ extensionId, elements }) => {
      const model = window.__test.modelStruct;
      const restored = new window.THREE.Matrix4();
      for (let i = 0; i < 16; i++) restored.elements[i] = elements[i];
      window.viewer.impl.setPlacementTransform(model, restored);
      window.viewer.getExtension(extensionId)._world.invalidateModelPlacement(model);
      window.viewer.impl.invalidate(true, true, true);
    }, { extensionId: CLASH_FINDER_EXTENSION_ID, elements });
    await waitForFrames();
  }

  // The full real production path for one case: reset visuals, select, right-click, click the real
  // "Find Clashes" item, and hand back both the alert text and the captured spy data. Extracted at
  // Task 10 because the alignment step re-runs MIXED_CASE twice more and must go through the exact
  // same real path, not a shortcut.
  async function runFindClashesCase(sourceDbId) {
    await resetVisualState();
    await selectAndRightClick(sourceDbId);
    await resetSpyCapture();
    const message = await clickFindClashesAndCaptureAlert();
    return { message, spy: await readSpyCapture() };
  }

  // Sorted, stable {target, witnessKind} description of a captured call's pairs, so two runs can be
  // compared directly.
  const witnessTupleKeys = (call) => call.pairs
    .map((p) => `${p.targetModelKey}:${p.targetDbId}:${p.witnessKind}`).sort();
  const expectedWitnessTupleKeys = MIXED_CASE.expectedPairs
    .map((p) => `${p.targetModelKey}:${p.targetDbId}:${p.witnessKind}`).sort();

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

  // runFindClashesCase resets the visual state, selects + right-clicks, resets the spy capture (so
  // this test's OWN setup calls never pollute what gets attributed to the production callback), then
  // clicks the real "Find Clashes" item.
  const { message: mixedMessage, spy: mixedSpy } = await runFindClashesCase(MIXED_CASE.sourceDbId);
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

  // --- M2.1 Task 10 Step 3: every normal positive volume-overlap pair carries a real witness ------
  check('[mixed] captured call: every pair has a non-null witness',
    mixedCall.pairs.every((p) => p.witnessKind !== null), true);
  check('[mixed] captured call: every witness point is 3 finite numbers (plain array, never a Vector3)',
    mixedCall.pairs.every((p) => Array.isArray(p.witnessPoint) && p.witnessPoint.length === 3
      && p.witnessPoint.every(Number.isFinite)), true);
  // The discovery-spike ground truth: this one case genuinely exercises BOTH witness branches.
  check('[mixed] captured call: exact {targetModel, targetDbId, witnessKind} set -- covers BOTH the crossing and containment branches',
    witnessTupleKeys(mixedCall), expectedWitnessTupleKeys);
  check('[mixed] captured call: zero pairs left without a witness',
    mixedCall.pairs.filter((p) => p.witnessKind === null).length, 0);

  const containmentPair = mixedCall.pairs.find((p) => p.witnessKind === 'containment');
  check('[mixed] the containment witness belongs to the expected same-model pair',
    containmentPair ? { targetModelKey: containmentPair.targetModelKey, targetDbId: containmentPair.targetDbId } : null,
    { targetModelKey: 'struct', targetDbId: MIXED_CASE.containmentTargetDbId });
  check(`[mixed] the containment witness point is within ${MIXED_CASE.containmentWitnessTolerance} of this fixture's recorded ground truth`,
    pointsWithin(containmentPair.witnessPoint, MIXED_CASE.expectedContainmentWitnessPoint, MIXED_CASE.containmentWitnessTolerance), true);

  // --- M2.1 Task 10 Step 4: a real marker mesh really is in the real overlay scene, per witness ----
  const mixedMarkers = await readMarkerState();
  results.cases[MIXED_CASE.name].markers = mixedMarkers;
  const witnessBearingCount = mixedCall.pairs.filter((p) => p.witnessKind !== null).length;
  check('[mixed] one active marker per witness-bearing pair', mixedMarkers.activeMarkerCount, witnessBearingCount);
  check('[mixed] the marker overlay scene is registered', mixedMarkers.hasScene, true);
  // The load-bearing check (see readMarkerState's own comment): every marker mesh is REALLY in the
  // real overlay scene, via the public viewer.overlays.hasMesh -- not merely present in _activeMarkers.
  check('[mixed] every active marker mesh is really in the overlay scene (public overlays.hasMesh)',
    mixedMarkers.hasMeshFlags, new Array(witnessBearingCount).fill(true));
  check('[mixed] the overlay scene holds exactly that many meshes (internal corroboration)',
    mixedMarkers.overlaySceneMeshCount, witnessBearingCount);
  check('[mixed] every marker is uniformly scaled', mixedMarkers.uniformScale, true);
  // Radius clamp (Task 8's Global Constraint) against the REAL federated fixture, not a unit fixture.
  check('[mixed] every marker radius is inside the clamped [MIN, MAX] band',
    mixedMarkers.radii.every((r) => r >= EXPECTED_MIN_MARKER_RADIUS && r <= EXPECTED_MAX_MARKER_RADIUS), true);
  // Each marker sits exactly on its own pair's witness point -- the marker positions and the witness
  // points are matched as SETS (marker creation order follows the pairs array, but asserting the set
  // makes this independent of that ordering).
  const sortedPointKeys = (points) => points.map((p) => p.map((v) => v.toFixed(6)).join(',')).sort();
  check('[mixed] every marker mesh sits exactly on its pair\'s own witness point',
    sortedPointKeys(mixedMarkers.positions), sortedPointKeys(mixedCall.pairs.map((p) => p.witnessPoint)));

  // --- M2.1 Task 10 Step 5: the ENCLOSED witness is visible THROUGH opaque geometry ---------------
  // See the header comment's own "Enclosed-witness visibility" section for the full rationale of
  // this two-part proof and of the coarse color band.
  console.log('\n=== Enclosed-witness visibility (containment witness, through opaque geometry) ===');
  // The camera is aimed deliberately rather than left wherever fitToView put it -- see this
  // constant's own comment in MIXED_CASE for why the direction is fixture ground truth and not an
  // arbitrary choice. Aiming at the witness point also puts its projection exactly at the canvas
  // centre by construction, so no settling poll is needed for the projection itself (lookAtFrom's
  // own frame wait is what makes the subsequent hitTest read the CURRENT camera).
  const cameraPlacement = await lookAtFrom(
    containmentPair.witnessPoint,
    MIXED_CASE.enclosedWitnessViewDirection,
    MIXED_CASE.enclosedWitnessViewDistance,
  );
  results.cases[MIXED_CASE.name].enclosedWitnessCamera = cameraPlacement;
  // Asserted, not assumed: everything below measures the camera that is actually in effect, so a
  // camera that never reached the requested pose must fail HERE rather than as a confusing cascade of
  // occlusion/pixel failures measuring some other viewpoint.
  check('[enclosed] the camera really reached the requested viewpoint (not overridden by fitToView\'s own transition)',
    cameraPlacement.settled, true);
  const occlusion = await projectAndProbeOcclusion(containmentPair.witnessPoint);
  results.cases[MIXED_CASE.name].enclosedWitnessOcclusion = occlusion;
  check('[enclosed] the containment witness projects inside the canvas',
    occlusion.client.x >= 0 && occlusion.client.x <= occlusion.canvas.width
      && occlusion.client.y >= 0 && occlusion.client.y <= occlusion.canvas.height, true);

  // --- Part 1 of the proof: the witness point is genuinely BEHIND opaque model geometry -----------
  check('[enclosed] opaque model geometry is hit at the witness point\'s own projected position',
    occlusion.hit !== null, true);
  // Not merely "some dbId": the occluder is one of the elements this very query isolated, so it is a
  // known, named, opaque piece of the fixture rather than whatever happened to be under the cursor.
  const occluderKey = occlusion.hit ? `${occlusion.hit.modelKey}:${occlusion.hit.dbId}` : null;
  const isolatedKeys = [
    ...MIXED_CASE.expectedIsolatedStruct.map((d) => `struct:${d}`),
    ...MIXED_CASE.expectedIsolatedArch.map((d) => `arch:${d}`),
  ];
  check('[enclosed] the occluder is one of the elements this query isolated (a known opaque element, not just any hit)',
    isolatedKeys.includes(occluderKey), true);
  const occlusionGap = occlusion.hit ? occlusion.witnessDepth - occlusion.hit.depth : null;
  const markerRadius = Math.max(...mixedMarkers.radii);
  console.log(`  [occlusion] occluder=${occluderKey} viewDepthGap=${occlusionGap?.toFixed(3)} markerRadius=${markerRadius.toFixed(3)}`);
  // The gap must exceed the marker's own radius: a sphere centred only marginally behind the
  // occluding surface could otherwise poke through it and be "visible" without ever being occluded
  // (codex-advisor, Task 10) -- and this witness genuinely IS shallowly enclosed, so this is not a
  // theoretical concern: live, the gap is 1.439 world units against a 1.045 radius, and most other
  // viewing directions leave the sphere protruding. An earlier draft that compared
  // HitTestResult.distance against a Euclidean camera distance reported a fictitious ~68-unit gap
  // and passed vacuously; see this file's header comment for that whole trap.
  check('[enclosed] the opaque occluder is in front of the witness by MORE than the marker\'s own radius (the sphere cannot merely be poking through)',
    occlusionGap !== null && occlusionGap > markerRadius, true);

  // --- Part 2 of the proof: the pixels rendered there are THIS marker's, not the occluder's -------
  const centreOf = (pixels) => pixels[Math.floor(pixels.length / 2)];
  const centre3x3Of = (pixels) => {
    const width = Math.round(Math.sqrt(pixels.length));
    const mid = (width - 1) / 2;
    const block = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) block.push(pixels[(mid + dy) * width + (mid + dx)]);
    return block;
  };
  const markerPixels = await samplePixelBlock(occlusion.client.x, occlusion.client.y, 3); // 7x7
  const markerOrangeFraction = orangeFraction(markerPixels);
  console.log(`  [pixels] marker centre=${JSON.stringify(centreOf(markerPixels))} orangeFraction=${markerOrangeFraction.toFixed(3)}`);
  check('[enclosed] the pixel at the occluded witness point\'s exact projected position is the MARKER colour',
    isMarkerOrange(centreOf(markerPixels)), true);
  check('[enclosed] the whole 3x3 block centred on that exact position is marker-coloured',
    centre3x3Of(markerPixels).every(isMarkerOrange), true);
  check('[enclosed] the marker dominates its own 7x7 pixel neighbourhood (>=50% marker-coloured)',
    markerOrangeFraction >= 0.5, true);
  await page.screenshot({ path: path.join(RESULTS_DIR, 'clash-finder-enclosed-witness-marker.png'), fullPage: false });

  // --- Part 3: attribute those pixels to THIS marker mesh, by taking it away and putting it back ---
  // The decisive check (codex-advisor, Task 10): Parts 1 and 2 together would still pass if the
  // orange came from anywhere other than the production marker. Detaching exactly this one mesh from
  // the overlay scene must make the colour disappear at that pixel, and re-attaching it must bring it
  // back. Both halves are asserted, so a failure to restore cannot silently pass as a success.
  const containmentMarkerFound = await page.evaluate(({ extensionId, point }) => {
    const ext = window.viewer.getExtension(extensionId);
    window.__test.containmentMarker = ext._activeMarkers.find((m) => Math.abs(m.position.x - point[0]) < 1e-9
      && Math.abs(m.position.y - point[1]) < 1e-9 && Math.abs(m.position.z - point[2]) < 1e-9) ?? null;
    return !!window.__test.containmentMarker;
  }, { extensionId: CLASH_FINDER_EXTENSION_ID, point: containmentPair.witnessPoint });
  check('[enclosed] the containment witness\'s own marker mesh is identifiable in _activeMarkers', containmentMarkerFound, true);

  await setContainmentMarkerAttached(false);
  const markerOffPixels = await samplePixelBlock(occlusion.client.x, occlusion.client.y, 3);
  await setContainmentMarkerAttached(true);
  const markerBackOnPixels = await samplePixelBlock(occlusion.client.x, occlusion.client.y, 3);
  const offOrangeFraction = orangeFraction(markerOffPixels);
  const backOnOrangeFraction = orangeFraction(markerBackOnPixels);
  console.log(`  [pixels] marker DETACHED centre=${JSON.stringify(centreOf(markerOffPixels))} orangeFraction=${offOrangeFraction.toFixed(3)}`);
  console.log(`  [pixels] marker RE-ATTACHED centre=${JSON.stringify(centreOf(markerBackOnPixels))} orangeFraction=${backOnOrangeFraction.toFixed(3)}`);
  check('[enclosed] detaching THIS marker mesh removes the marker colour from that exact pixel (the marker is what painted it)',
    isMarkerOrange(centreOf(markerOffPixels)), false);
  // Doubles as the colour band's discrimination control, and a better one than a sample taken
  // somewhere else on screen would be: this is the SAME pixel, showing the occluding geometry.
  check('[enclosed] with the marker detached, the occluding geometry is what shows through instead',
    offOrangeFraction, 0);
  check('[enclosed] re-attaching the marker mesh restores the marker colour at that exact pixel',
    isMarkerOrange(centreOf(markerBackOnPixels)), true);

  // --- Part 4: the marker is visible there BECAUSE of depthTest:false, not by accident ------------
  // The decisive proof that this is genuinely "rendered through opaque geometry": flipping the
  // production material's own depthTest to true (and only that) must make the occluder win at this
  // exact pixel, and flipping it back must restore the marker. This is the one place this file
  // mutates production state; it is restored immediately and the restoration is asserted, and it is
  // only meaningful at all because Part 1 established the whole marker sphere along this ray really
  // is behind the occluder.
  const setMarkerDepthTest = async (enabled) => {
    await page.evaluate(({ extensionId, enabled }) => {
      const material = window.viewer.getExtension(extensionId)._markerMaterial;
      material.depthTest = enabled;
      material.needsUpdate = true;
      window.viewer.impl.invalidate(true, true, true);
    }, { extensionId: CLASH_FINDER_EXTENSION_ID, enabled });
    await waitForFrames();
  };
  await setMarkerDepthTest(true);
  const depthTestedPixels = await samplePixelBlock(occlusion.client.x, occlusion.client.y, 3);
  await setMarkerDepthTest(false);
  const depthTestRestoredPixels = await samplePixelBlock(occlusion.client.x, occlusion.client.y, 3);
  console.log(`  [pixels] depthTest=true centre=${JSON.stringify(centreOf(depthTestedPixels))} orangeFraction=${orangeFraction(depthTestedPixels).toFixed(3)}`);
  check('[enclosed] with depthTest:true the occluder wins at that pixel -- so depthTest:false is what makes the marker show through',
    orangeFraction(depthTestedPixels), 0);
  check('[enclosed] restoring depthTest:false brings the marker back at that pixel',
    isMarkerOrange(centreOf(depthTestRestoredPixels)), true);
  // The occluder's own colour must be what the depth-tested frame shows -- identical to the frame
  // with the marker mesh removed entirely. Anything else would mean something ELSE changed too.
  check('[enclosed] the depth-tested frame shows exactly what the marker-less frame showed',
    centreOf(depthTestedPixels), centreOf(markerOffPixels));

  results.cases[MIXED_CASE.name].enclosedWitnessPixels = {
    occluder: occluderKey,
    occlusionGap,
    markerRadius,
    markerCentre: centreOf(markerPixels),
    markerOrangeFraction,
    markerDetachedCentre: centreOf(markerOffPixels),
    markerDetachedOrangeFraction: offOrangeFraction,
    markerReattachedCentre: centreOf(markerBackOnPixels),
    markerReattachedOrangeFraction: backOnOrangeFraction,
    depthTestedCentre: centreOf(depthTestedPixels),
    depthTestRestoredCentre: centreOf(depthTestRestoredPixels),
  };

  // Keep references to THESE exact meshes so the negative case below can prove they were genuinely
  // removed from the overlay scene, not just dropped from _activeMarkers.
  await stashMarkerMeshes();

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

  const { message: negativeMessage, spy: negativeSpy } = await runFindClashesCase(NEGATIVE_CASE.sourceDbId);
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

  // --- M2.1 Task 10 Step 6: a negative result clears the markers too, not just the isolation -------
  const negativeMarkers = await readMarkerState();
  results.cases[NEGATIVE_CASE.name].markers = negativeMarkers;
  check('[negative] no active markers remain', negativeMarkers.activeMarkerCount, 0);
  check('[negative] the overlay scene holds zero meshes', negativeMarkers.overlaySceneMeshCount, 0);
  // The strong form: the mixed case's OWN mesh objects are really gone from the overlay scene. An
  // _activeMarkers.length check alone would still pass if removeMesh had silently no-op'd.
  check('[negative] the mixed case\'s own marker meshes were really removed from the overlay scene',
    await stashedMarkersStillInOverlay(), new Array(mixedMarkers.activeMarkerCount).fill(false));
  // The overlay SCENE itself deliberately survives a clear -- only unload-time teardown removes it
  // (ClashFinderExtension._clearMarkers's own documented contract).
  check('[negative] the overlay scene itself still exists (only unload removes it)', negativeMarkers.hasScene, true);

  // === M2.1 Task 10 Step 7: one real model-alignment operation moves the markers ==================
  // See the header comment's own "Alignment" section. This is a real placement mutation through the
  // real Viewer API plus the real CollisionWorld.invalidateModelPlacement call an alignment tool
  // would make, then the SAME real right-click path re-run -- not a shortcut.
  console.log(`\n=== Case: alignment (+${ALIGNMENT_DELTA_X} X on the Structure model) ===`);
  const originalStructPlacement = await readStructPlacementElements();
  results.alignment = { originalStructPlacement };
  await translateStructPlacement(ALIGNMENT_DELTA_X);
  const movedStructPlacement = await readStructPlacementElements();
  check('[alignment] the Structure model\'s placement transform really moved by the expected delta in X',
    Math.abs((movedStructPlacement[12] - originalStructPlacement[12]) - ALIGNMENT_DELTA_X) <= 1e-6, true);

  const { message: alignedMessage, spy: alignedSpy } = await runFindClashesCase(MIXED_CASE.sourceDbId);
  const alignedCall = alignedSpy.findClashesCalls[0];
  const alignedMarkers = await readMarkerState();
  results.alignment.aligned = { message: alignedMessage, spy: alignedSpy, markers: alignedMarkers };
  check('[alignment] exactly one findClashes call made by the re-run\'s real click', alignedSpy.findClashesCalls.length, 1);
  // The same pairs with the same witness kinds still resolve after the alignment -- so the position
  // comparison below is genuinely comparing like with like, not two different result sets.
  check('[alignment] the same {targetModel, targetDbId, witnessKind} set still resolves after the alignment',
    witnessTupleKeys(alignedCall), expectedWitnessTupleKeys);
  check('[alignment] the same number of markers is drawn', alignedMarkers.activeMarkerCount, mixedMarkers.activeMarkerCount);
  // Markers are bound to the FRESH witnesses this re-run produced -- matched as a multiset, never by
  // _activeMarkers order. This is what actually proves the markers tracked the alignment rather than
  // merely being redrawn somewhere.
  check('[alignment] every marker sits exactly on a witness point from the RE-RUN\'s own result',
    sortedPointKeys(alignedMarkers.positions), sortedPointKeys(alignedCall.pairs.map((p) => p.witnessPoint)));

  // Per-pair comparison, matched by pair IDENTITY ({targetModel,targetDbId}), never by array order.
  const witnessByPairKey = (call) => Object.fromEntries(
    call.pairs.map((p) => [`${p.targetModelKey}:${p.targetDbId}`, p.witnessPoint]),
  );
  const witnessBefore = witnessByPairKey(mixedCall);
  const witnessAfter = witnessByPairKey(alignedCall);
  const containmentKey = `struct:${MIXED_CASE.containmentTargetDbId}`;
  const crossingKey = `arch:${MIXED_CASE.expectedIsolatedArch[0]}`;
  const deltaOf = (key) => witnessAfter[key].map((v, i) => v - witnessBefore[key][i]);
  const containmentDelta = deltaOf(containmentKey);
  const crossingDelta = deltaOf(crossingKey);
  results.alignment.witnessDeltas = { [containmentKey]: containmentDelta, [crossingKey]: crossingDelta };
  console.log(`  [alignment] witness delta ${containmentKey} = ${JSON.stringify(containmentDelta)}`);
  console.log(`  [alignment] witness delta ${crossingKey}    = ${JSON.stringify(crossingDelta)}`);
  // The SAME-model (containment) pair is a genuine rigid-motion invariant: both its operands live in
  // the model that just moved, so its witness must translate by exactly the alignment delta and by
  // nothing else. Asserted exactly (1e-6).
  check(`[alignment] the same-model containment witness moved by exactly (+${ALIGNMENT_DELTA_X}, 0, 0) -- a rigid-motion invariant`,
    pointsWithin(containmentDelta, [ALIGNMENT_DELTA_X, 0, 0], 1e-6), true);
  // The CROSS-model (crossing) pair has no such invariant: only the Structure model moved, so where
  // its surface crosses the stationary Architecture element can change non-rigidly. Asserting an
  // exact +3 here would overconstrain the test (codex-advisor, Task 10) even though this fixture
  // happens to produce exactly that today -- the observed delta is recorded in the run report
  // instead, and only MATERIAL movement is asserted.
  check('[alignment] the cross-model crossing witness moved materially (no rigid-motion invariant applies to it)',
    Math.max(...crossingDelta.map(Math.abs)) > 1e-3, true);

  // Restore the placement and re-run: the markers must come back to exactly where they started.
  await restoreStructPlacement(originalStructPlacement);
  const restoredStructPlacement = await readStructPlacementElements();
  check('[alignment] the Structure model\'s placement transform was restored exactly',
    restoredStructPlacement, originalStructPlacement);
  const { spy: restoredSpy } = await runFindClashesCase(MIXED_CASE.sourceDbId);
  const restoredCall = restoredSpy.findClashesCalls[0];
  const restoredMarkers = await readMarkerState();
  results.alignment.restored = { spy: restoredSpy, markers: restoredMarkers };
  check('[alignment] after restoring the placement, the same pair/witness set resolves again',
    witnessTupleKeys(restoredCall), expectedWitnessTupleKeys);
  const witnessRestored = witnessByPairKey(restoredCall);
  check('[alignment] after restoring the placement, EVERY pair\'s witness returns to its original world point (matched by pair identity)',
    Object.keys(witnessBefore).every((key) => pointsWithin(witnessRestored[key], witnessBefore[key], 1e-6)), true);
  check('[alignment] after restoring the placement, every marker sits on a restored witness point',
    sortedPointKeys(restoredMarkers.positions), sortedPointKeys(restoredCall.pairs.map((p) => p.witnessPoint)));

  // =================================================================================================
  // === M3 Task 17: Soft Clash (clearance mode) live acceptance =====================================
  // =================================================================================================
  //
  // Deliberately positioned HERE -- after the alignment step has restored the Structure model's own
  // placement, and BEFORE the model-unload step below. Two independent reasons, both load-bearing:
  //
  //   1. The Hard-Clash-exclusion case needs the Architecture model LOADED. Its whole claim is that
  //      arch dbId 3686 -- a target the Hard Clash query above genuinely DID return -- is absent
  //      from a clearance result. After the unload step, that absence would be trivially true for
  //      the unrelated reason that the model is gone, and the case would pass vacuously.
  //   2. A Soft Clash query leaves its own isolation contribution applied (unioned with Hard
  //      Clash's, per ClashFinderExtension._reconcileIsolation). Running this section BEFORE any of
  //      the Hard Clash cases above would therefore change what THEIR own end-state isolation
  //      assertions observe. Nothing after this point re-runs a Hard Clash case, and the unload step
  //      reads isolation only AFTER _clearIsolation() has emptied both contributions, so this
  //      position is the one place in main() where neither hazard applies.
  //
  // Nothing above this line is modified by this task: the entire Hard Clash flow, its cases, and its
  // helpers run exactly as before, and the two Hard Clash marker/isolation states left behind by the
  // alignment step are used here as a live fixture -- Soft Clash must coexist with them, never
  // clobber them.
  console.log('\n=== M3 Task 17: Soft Clash (clearance mode) ===');

  // Baselines captured immediately before the first Soft Clash action, so the "zero console errors"
  // claim for THIS section is about errors this section introduced, not about the two pre-existing
  // ones this sandboxed environment produces during viewer bootstrap (a blocked
  // https://cdn.autodesk.io/logo/black/stacked.png fetch -- see this run's own report). The
  // whole-run assertion at the very end of main() is unchanged and still asserts emptiness outright.
  const softClashConsoleErrorsBefore = results.consoleErrors.length;
  const softClashPageErrorsBefore = results.pageErrors.length;
  // The Hard Clash visualization state this section must leave completely alone.
  const hardMarkersBeforeSoftClash = await readMarkerState();

  results.softClash = {
    discoverySpike: {
      // Recorded verbatim from the live bounded spike described in this file's own M3 Task 17 header
      // comment -- the honest record of what Step 1 actually did and found (Task 17 Step 4).
      sourceDbIdsProbed: [NEGATIVE_CASE.sourceDbId],
      clearanceSweep: [0.01, 0.05, 0.1, 0.25, 0.5, 1.0, 2.0],
      cappedIterations: { clearanceValues: 7, fallbackNeighbourDbIds: 4, fallbackClearancesPerNeighbour: 3 },
      callsActuallyIssued: 2,
      neighbourFallbackFired: false,
      nearMissFound: true,
      nearMissPairs: [
        { targetModelKey: 'struct', targetDbId: 3976, distance: 0.04166616338460325 },
        { targetModelKey: 'struct', targetDbId: 4135, distance: 0.04166616338460503 },
      ],
      measuredTrueMinimumDistance: 0.04166616338460325,
      fineBracket: { emptyAt: [0.02, 0.03, 0.04, 0.0416], nonEmptyAt: [0.042, 0.05] },
    },
    cases: {},
  };

  // Reads the live Soft Clash visualization state straight off the real extension instance, plus
  // enough of the Hard Clash overlay state alongside it to prove the two coexist independently.
  // Everything returned is plain, structured-cloneable data.
  //
  // `_activeSoftClashObjects` is a SINGLE array MIXING both object families in creation order --
  // per witness-bearing pair: [sourceMesh, targetMesh, line] -- not two separate arrays (verified
  // against _addSoftClashVisualization directly, not assumed). Meshes are identified by their own
  // THREE `.type` string ('Mesh' / 'Line'); `constructor.name` is NOT usable here (the Viewer's own
  // bundle is minified, and it comes back as the empty string live).
  //
  // The line endpoints are read out of each line's own per-pair BufferGeometry position attribute,
  // which is a Float32Array -- so those two points are QUANTIZED copies of the Float64 witness
  // points, and are compared below with a Float32-sized tolerance, never exactly. The sphere
  // positions, by contrast, are exact Float64 copies and ARE compared exactly.
  //
  // `hasMeshFlags` (public viewer.overlays.hasMesh) is the load-bearing per-object check, for the
  // same reason readMarkerState's own version of it is: addMesh/removeMesh with swapped arguments
  // returns false with no throw, so an `_activeSoftClashObjects.length` assertion alone would pass
  // while the overlay scene was actually empty.
  async function readSoftClashState() {
    return page.evaluate(({ extensionId, softOverlayName, hardOverlayName }) => {
      const ext = window.viewer.getExtension(extensionId);
      const objects = ext._activeSoftClashObjects;
      const readLineEndpoints = (obj) => {
        const attr = obj.geometry?.attributes?.position;
        if (!attr || !attr.array) return null;
        const a = Array.from(attr.array);
        return a.length === 6 ? [a.slice(0, 3), a.slice(3, 6)] : null;
      };
      return {
        objectCount: objects.length,
        types: objects.map((o) => o.type),
        meshPositions: objects.filter((o) => o.type === 'Mesh').map((m) => [m.position.x, m.position.y, m.position.z]),
        meshRadii: objects.filter((o) => o.type === 'Mesh').map((m) => m.scale.x),
        meshUniformScale: objects.filter((o) => o.type === 'Mesh')
          .every((m) => m.scale.x === m.scale.y && m.scale.y === m.scale.z),
        lineEndpoints: objects.filter((o) => o.type === 'Line').map(readLineEndpoints),
        // Global Constraint: ONE shared sphere geometry/material and ONE shared line material across
        // every Soft Clash object this extension ever creates; only the per-pair line geometry is
        // per-object (and must therefore be distinct from the shared sphere geometry).
        meshesShareGeometry: objects.filter((o) => o.type === 'Mesh').every((m) => m.geometry === ext._softClashGeometry),
        meshesShareMaterial: objects.filter((o) => o.type === 'Mesh').every((m) => m.material === ext._softClashMaterial),
        linesShareMaterial: objects.filter((o) => o.type === 'Line').every((l) => l.material === ext._softClashLineMaterial),
        lineGeometriesAreDistinct: (() => {
          const lines = objects.filter((o) => o.type === 'Line');
          const geometries = lines.map((l) => l.geometry);
          return geometries.every((g) => g && g !== ext._softClashGeometry)
            && new Set(geometries).size === geometries.length;
        })(),
        softColor: ext._softClashMaterial?.color?.getHex?.() ?? null,
        softLineColor: ext._softClashLineMaterial?.color?.getHex?.() ?? null,
        softDepthTest: ext._softClashMaterial?.depthTest ?? null,
        hasScene: window.viewer.overlays.hasScene(softOverlayName),
        hasMeshFlags: objects.map((o) => window.viewer.overlays.hasMesh(o, softOverlayName)),
        overlaySceneMeshCount: window.viewer.impl.overlayScenes?.[softOverlayName]?.scene?.children?.length ?? null,
        // --- Hard Clash's own, entirely separate overlay, read at the same instant ---
        hardMarkerCount: ext._activeMarkers.length,
        hardOverlaySceneMeshCount: window.viewer.impl.overlayScenes?.[hardOverlayName]?.scene?.children?.length ?? null,
        hardColor: ext._markerMaterial?.color?.getHex?.() ?? null,
        overlayScenesAreDistinct: softOverlayName !== hardOverlayName
          && window.viewer.overlays.hasScene(softOverlayName) && window.viewer.overlays.hasScene(hardOverlayName),
      };
    }, {
      extensionId: CLASH_FINDER_EXTENSION_ID,
      softOverlayName: SOFT_CLASH_OVERLAY_NAME,
      hardOverlayName: MARKER_OVERLAY_NAME,
    });
  }

  // A deliberate SIBLING of clickFindClashesAndCaptureAlert (which is left byte-for-byte unchanged),
  // not a parameterization of it: "Find Soft Clashes" is a second, independent production action,
  // and keeping its driver separate means nothing this task adds can alter how the 106 pre-existing
  // Hard Clash checks are driven. The dialog-handler-before-click discipline, the timeout, and the
  // locator shape are identical, and for the same reasons -- see that function's own comment.
  //
  // The two menu titles do not overlap as substrings ("Find Soft Clashes" does not contain "Find
  // Clashes"), so hasText matching stays unambiguous now that both entries exist in the same menu.
  async function clickFindSoftClashesAndCaptureAlert() {
    const menuItem = page.locator('.menu-item', { hasText: 'Find Soft Clashes' });
    await menuItem.waitFor({ timeout: 10_000 });
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
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timed out waiting for the Find Soft Clashes alert')), 120_000)),
    ]);
    return message;
  }

  // The full real production path for one Soft Clash case, mirroring runFindClashesCase exactly but
  // clicking the OTHER menu item. `clearanceOverride` is null for the positive case (which runs
  // against the extension's own untouched, load()-resolved default) and a number for the two
  // always-run cases, which need a clearance the UI has no way to supply; it is assigned directly on
  // the live extension instance and restored immediately after the click, before anything is
  // asserted, and the restoration itself is asserted at the end of this section.
  async function runFindSoftClashesCase(sourceDbId, clearanceOverride = null) {
    const clearanceBefore = await page.evaluate((id) => window.viewer.getExtension(id)._clearance, CLASH_FINDER_EXTENSION_ID);
    if (clearanceOverride !== null) {
      await page.evaluate(({ id, value }) => { window.viewer.getExtension(id)._clearance = value; },
        { id: CLASH_FINDER_EXTENSION_ID, value: clearanceOverride });
    }
    try {
      await resetVisualState();
      await selectAndRightClick(sourceDbId);
      // Captured while the real context menu is open: both production entries must be present and
      // distinct, which is what makes "we clicked the Soft Clash one" a meaningful statement.
      const menuTitles = await page.locator('.menu-item').allTextContents();
      await resetSpyCapture();
      const message = await clickFindSoftClashesAndCaptureAlert();
      return { message, spy: await readSpyCapture(), menuTitles, clearanceUsed: clearanceOverride ?? clearanceBefore };
    } finally {
      if (clearanceOverride !== null) {
        await page.evaluate(({ id, value }) => { window.viewer.getExtension(id)._clearance = value; },
          { id: CLASH_FINDER_EXTENSION_ID, value: clearanceBefore });
      }
    }
  }

  // Shared per-pair structural checks every clearance result must satisfy, whatever the case.
  // `witnessSeparation` recomputes each pair's own reported distance straight from its own two
  // witness points -- a genuine independent cross-check of the distance against the witness, since
  // the two are produced by different parts of the query and a regression that desynchronized them
  // would otherwise be invisible.
  const witnessSeparationOf = (p) => Math.hypot(
    p.witnessSourcePoint[0] - p.witnessTargetPoint[0],
    p.witnessSourcePoint[1] - p.witnessTargetPoint[1],
    p.witnessSourcePoint[2] - p.witnessTargetPoint[2],
  );
  const isPoint3 = (v) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
  const softTupleKey = (p) => `${p.targetModelKey}:${p.targetDbId}`;
  // Tolerance-based multiset comparison for the Float32-quantized line endpoints.
  const matchesSomePointPair = (endpoints, pairs, tolerance) => pairs.some(([a, b]) =>
    maxAbsDelta(endpoints[0], a) <= tolerance && maxAbsDelta(endpoints[1], b) <= tolerance);

  function checkClearancePairInvariants(label, call, expectedClearance) {
    check(`[soft][${label}] captured call: mode is clearance`, call.mode, 'clearance');
    check(`[soft][${label}] captured call: groupBy is dbId`, call.groupBy, 'dbId');
    check(`[soft][${label}] captured call: the clearance threshold the production action actually issued`,
      call.clearance, expectedClearance);
    check(`[soft][${label}] captured call: every pair's type is 'clearance' (never 'volume-overlap')`,
      call.pairs.every((p) => p.type === 'clearance'), true);
    check(`[soft][${label}] captured call: every pair echoes the query's own clearance threshold`,
      call.pairs.every((p) => p.clearance === expectedClearance), true);
    // The documented public contract is the half-open band (toleranceFloor, clearance]: a distance of
    // exactly 0 means the two elements are TOUCHING, which is a Hard Clash, not a clearance result.
    check(`[soft][${label}] captured call: every distance is a finite number strictly greater than 0`,
      call.pairs.every((p) => typeof p.distance === 'number' && Number.isFinite(p.distance) && p.distance > 0), true);
    check(`[soft][${label}] captured call: no distance exceeds the queried clearance threshold`,
      call.pairs.every((p) => p.distance <= expectedClearance), true);
    check(`[soft][${label}] captured call: every pair carries the CLEARANCE witness shape {sourcePoint, targetPoint}`,
      call.pairs.every((p) => isPoint3(p.witnessSourcePoint) && isPoint3(p.witnessTargetPoint)), true);
    check(`[soft][${label}] captured call: no pair carries Hard Clash's own {kind, point} witness shape`,
      call.pairs.every((p) => p.witnessKind === null && p.witnessPoint === null), true);
    // Guarded to the pairs that actually carry both witness points -- the check just above is what
    // asserts that is ALL of them; check() records a failure without aborting, so this must not go
    // on to throw a TypeError on a null point and take the rest of the run down with it.
    const measurable = call.pairs.filter((p) => isPoint3(p.witnessSourcePoint) && isPoint3(p.witnessTargetPoint));
    // Scaled by the distance itself: this compares an exact triangle-triangle distance against a
    // Euclidean recomputation from the two witness points, so the meaningful bound is relative, not
    // absolute (this fixture's clearance-5 case reaches distances of ~4.8). The observed maximum is
    // recorded in the run report either way.
    const maxSeparationError = measurable.length === 0 ? 0
      : Math.max(...measurable.map((p) => Math.abs(witnessSeparationOf(p) - p.distance) / Math.max(1, p.distance)));
    check(`[soft][${label}] captured call: every pair's reported distance equals the separation of its OWN two witness points`,
      measurable.length === call.pairs.length && maxSeparationError <= 1e-5, true);
    check(`[soft][${label}] captured call: no duplicate {targetModel, targetDbId} pairs`,
      new Set(call.pairs.map(softTupleKey)).size, call.pairs.length);
    check(`[soft][${label}] captured call: statistics.clearanceHits agrees with the emitted pair count`,
      call.clearanceStatistics.clearanceHits, call.pairs.length);
    return { maxSeparationError };
  }

  const softClearanceAtSectionStart = await page.evaluate((id) => window.viewer.getExtension(id)._clearance, CLASH_FINDER_EXTENSION_ID);
  check('[soft] the live extension resolved its clearance to the production DEFAULT_CLEARANCE',
    softClearanceAtSectionStart, EXPECTED_DEFAULT_CLEARANCE);
  check('[soft] the discovery spike\'s measured true minimum distance from dbId 3965 exceeds the known-negative clearance (so that negative is real, not a threshold artifact)',
    SOFT_CLASH_NEGATIVE_CLEARANCE < SOFT_CLASH_POSITIVE_CASE.expectedDistance, true);

  // === Always run 1: known-negative, no false positive ===========================================
  // Same source element as this file's own Hard Clash negative case (dbId 3965), at a clearance
  // provably below its measured true minimum distance to anything in the scene.
  console.log(`\n=== Soft Clash case: known-negative-no-false-positive (dbId ${NEGATIVE_CASE.sourceDbId} @ clearance ${SOFT_CLASH_NEGATIVE_CLEARANCE}) ===`);
  const negativeSoft = await runFindSoftClashesCase(NEGATIVE_CASE.sourceDbId, SOFT_CLASH_NEGATIVE_CLEARANCE);
  const negativeSoftCall = negativeSoft.spy.findClashesCalls[0];
  const negativeSoftViz = await readSoftClashState();
  results.softClash.cases['known-negative-no-false-positive'] = {
    clearance: SOFT_CLASH_NEGATIVE_CLEARANCE,
    sourceDbId: NEGATIVE_CASE.sourceDbId,
    alertMessage: negativeSoft.message,
    menuTitles: negativeSoft.menuTitles,
    spy: negativeSoft.spy,
    visualization: negativeSoftViz,
  };
  // The real Viewer context menu also carries its own built-in .menu-item entries (Isolate, Hide,
  // Show All Objects, ...), so this asserts PRESENCE of both production entries among them, matched
  // on trimmed exact text -- never that the menu contains only these two.
  check('[soft] the real context menu offers BOTH production actions as distinct entries',
    ['Find Clashes', 'Find Soft Clashes'].every((t) => negativeSoft.menuTitles.some((x) => x.trim() === t)), true);
  check('[soft][known-negative] exactly one findClashes call made by the real "Find Soft Clashes" click',
    negativeSoft.spy.findClashesCalls.length, 1);
  check('[soft][known-negative] captured call: source is the Structure model',
    negativeSoftCall.sourceModelKey, 'struct');
  check('[soft][known-negative] captured call: source.dbIds is exactly the selected dbId',
    negativeSoftCall.sourceDbIds, [NEGATIVE_CASE.sourceDbId]);
  checkClearancePairInvariants('known-negative', negativeSoftCall, SOFT_CLASH_NEGATIVE_CLEARANCE);
  check('[soft][known-negative] ZERO clearance pairs -- no false positive below the measured true minimum distance',
    negativeSoftCall.pairs.length, 0);
  check('[soft][known-negative] alert message is exactly "No clashes found." with no caveat',
    negativeSoft.message, 'No clashes found.');
  check('[soft][known-negative] the query really ran against real geometry (zero diagnostics, nothing skipped or aborted)',
    negativeSoftCall.diagnosticsCount, 0);
  check('[soft][known-negative] no Hard Clash exclusion fired here (this negative is a genuine distance verdict, not an exclusion)',
    negativeSoftCall.clearanceStatistics.clearanceHardClashExclusions, 0);
  // Soft Clash's own visualization is empty on a zero-result run. This is also the FIRST Soft Clash
  // invocation of the whole session, which makes the check stronger than a bare "zero objects":
  // _addSoftClashVisualization (the only caller of _ensureSoftClashOverlay) is never reached on the
  // zero-pairs early-return path, so a Soft Clash query that finds nothing must leave NO overlay
  // trace whatsoever -- the overlay scene unregistered rather than merely empty, and the lazily
  // created shared geometry/material never allocated at all. That mirrors Hard Clash's own
  // documented _addMarkers contract exactly, and is asserted here rather than assumed. (Live, the
  // first draft of this check expected an empty-but-registered scene and correctly failed:
  // overlaySceneMeshCount came back null, i.e. no such scene, which is the better behavior.)
  check('[soft][known-negative] no Soft Clash overlay objects remain', negativeSoftViz.objectCount, 0);
  check('[soft][known-negative] a zero-result Soft Clash leaves NO overlay trace at all -- the scene is never even registered, and the shared geometry/material are never allocated',
    [negativeSoftViz.hasScene, negativeSoftViz.overlaySceneMeshCount, negativeSoftViz.softColor], [false, null, null]);
  // ...and, critically, Hard Clash's own overlay and isolation are completely untouched by it. This
  // is the live regression check for the Batch-3 defect where one action clobbered the other's state.
  check('[soft][known-negative] Hard Clash\'s own markers survive a zero-result Soft Clash run',
    negativeSoftViz.hardMarkerCount, hardMarkersBeforeSoftClash.activeMarkerCount);
  check('[soft][known-negative] Hard Clash\'s own overlay scene still holds its own meshes',
    negativeSoftViz.hardOverlaySceneMeshCount, hardMarkersBeforeSoftClash.overlaySceneMeshCount);
  const negativeIsolatedStruct = await getIsolatedNodesFor('struct');
  const negativeIsolatedArch = await getIsolatedNodesFor('arch');
  const negativeIsolatedMech = await getIsolatedNodesFor('mech');
  check('[soft][known-negative] Hard Clash\'s Structure isolation survives a zero-result Soft Clash run',
    sortNums(negativeIsolatedStruct), sortNums(MIXED_CASE.expectedIsolatedStruct));
  check('[soft][known-negative] Hard Clash\'s Architecture isolation survives a zero-result Soft Clash run',
    sortNums(negativeIsolatedArch), sortNums(MIXED_CASE.expectedIsolatedArch));
  check('[soft][known-negative] Mechanical is still not isolated', negativeIsolatedMech, []);
  check('[soft][known-negative] no fitToView() calls on the zero-pairs early-return branch',
    negativeSoft.spy.fitToViewCalls.length, 0);

  // === Always run 2: a proven Hard Clash is NEVER reported as a clearance result =================
  // Absence alone would not prove the tri-state precheck is what excluded arch 3686: that pair's
  // true surface distance is exactly 0 (the elements are genuinely touching -- this file's own
  // MIXED_CASE asserts it as a 'surface-crossing' volume-overlap pair above), and the clearance
  // query's own tolerance floor rejects a zero distance anyway, for the unrelated reason that
  // touching is not clearance. A completely DISABLED precheck would therefore produce the identical
  // absence. So absence is asserted alongside the mechanism-specific statistic
  // `clearanceHardClashExclusions`, which can only be nonzero if the precheck actually ran AND
  // proved overlap -- a positive proof of the mechanism, not an inference from an absence.
  console.log(`\n=== Soft Clash case: hard-clash-never-in-clearance-results (dbId ${MIXED_CASE.sourceDbId} @ clearance ${SOFT_CLASH_HARD_CLASH_EXCLUSION_CLEARANCE}) ===`);
  const exclusionSoft = await runFindSoftClashesCase(MIXED_CASE.sourceDbId, SOFT_CLASH_HARD_CLASH_EXCLUSION_CLEARANCE);
  const exclusionSoftCall = exclusionSoft.spy.findClashesCalls[0];
  const exclusionTargetKeys = exclusionSoftCall.pairs.map(softTupleKey);
  results.softClash.cases['hard-clash-never-in-clearance-results'] = {
    clearance: SOFT_CLASH_HARD_CLASH_EXCLUSION_CLEARANCE,
    sourceDbId: MIXED_CASE.sourceDbId,
    alertMessage: exclusionSoft.message,
    pairCount: exclusionSoftCall.pairs.length,
    targetKeys: [...exclusionTargetKeys].sort(),
    clearanceStatistics: exclusionSoftCall.clearanceStatistics,
    diagnosticReasons: exclusionSoftCall.diagnosticReasons,
    distanceRange: exclusionSoftCall.pairs.length
      ? [Math.min(...exclusionSoftCall.pairs.map((p) => p.distance)), Math.max(...exclusionSoftCall.pairs.map((p) => p.distance))]
      : null,
  };
  check('[soft][hard-clash-exclusion] exactly one findClashes call made by the real "Find Soft Clashes" click',
    exclusionSoft.spy.findClashesCalls.length, 1);
  check('[soft][hard-clash-exclusion] captured call: source.dbIds is exactly the selected dbId',
    exclusionSoftCall.sourceDbIds, [MIXED_CASE.sourceDbId]);
  checkClearancePairInvariants('hard-clash-exclusion', exclusionSoftCall, SOFT_CLASH_HARD_CLASH_EXCLUSION_CLEARANCE);
  // Non-vacuity: this query really did produce clearance results, so the absences below are absences
  // from a genuinely populated result set. The exact count (33 live, stable across 10 observed runs)
  // is RECORDED rather than asserted: the Hard-Clash precheck's own crossing term carries a
  // wall-clock frame budget, so how many candidate pairs come back 'inconclusive' -- and therefore
  // how many pairs survive -- is in principle load-dependent, and pinning it would buy nothing this
  // case actually needs.
  check('[soft][hard-clash-exclusion] the query produced a genuinely populated clearance result set (so the absences below are meaningful)',
    exclusionSoftCall.pairs.length > 0, true);
  // The tie-in that makes this a real claim rather than a bare absence: the Hard Clash query run
  // EARLIER IN THIS SAME SESSION, from the SAME source element, against the SAME loaded models, did
  // return this exact target.
  check('[soft][hard-clash-exclusion] precondition: the Hard Clash query above genuinely DID return the crossing target arch 3686',
    mixedCall.pairs.some((p) => p.targetModelKey === MIXED_CASE.hardClashTargetModelKey
      && p.targetDbId === MIXED_CASE.hardClashTargetDbId && p.witnessKind === 'surface-crossing'), true);
  check(`[soft][hard-clash-exclusion] that proven Hard Clash target (${MIXED_CASE.hardClashTargetModelKey} ${MIXED_CASE.hardClashTargetDbId}, surface-crossing) is ABSENT from the clearance result`,
    exclusionTargetKeys.includes(`${MIXED_CASE.hardClashTargetModelKey}:${MIXED_CASE.hardClashTargetDbId}`), false);
  check(`[soft][hard-clash-exclusion] the other proven Hard Clash target (struct ${MIXED_CASE.containmentTargetDbId}, containment) is ABSENT too`,
    exclusionTargetKeys.includes(`struct:${MIXED_CASE.containmentTargetDbId}`), false);
  // THE mechanism-specific proof (Important #5). Nonzero is only reachable through
  // classifyHardClashPrecheck returning 'excluded', i.e. volumeOverlapQuery PROVING overlap for a
  // contributing fragment pair. A disabled/short-circuited precheck cannot produce it.
  check('[soft][hard-clash-exclusion] statistics.clearanceHardClashExclusions >= 1 -- the tri-state precheck genuinely RAN and PROVED overlap',
    exclusionSoftCall.clearanceStatistics.clearanceHardClashExclusions >= 1, true);
  check('[soft][hard-clash-exclusion] the precheck was actually exercised (clearanceOverlapPrechecksRun >= clearanceHardClashExclusions >= 1)',
    exclusionSoftCall.clearanceStatistics.clearanceOverlapPrechecksRun
      >= exclusionSoftCall.clearanceStatistics.clearanceHardClashExclusions, true);
  check('[soft][hard-clash-exclusion] the source dbId is excluded from its OWN model\'s clearance results (same-model self-clash)',
    exclusionTargetKeys.includes(`struct:${MIXED_CASE.sourceDbId}`), false);
  // The user-visible report stays self-consistent with the real result even at this large clearance.
  const exclusionSameModel = exclusionSoftCall.pairs.filter((p) => p.targetModelKey === 'struct').length;
  const exclusionCrossModel = exclusionSoftCall.pairs.length - exclusionSameModel;
  check('[soft][hard-clash-exclusion] the alert\'s own summary matches the captured result exactly',
    exclusionSoft.message.startsWith(`${exclusionSoftCall.pairs.length} clashes found (${exclusionSameModel} in this model, ${exclusionCrossModel} in other models)`), true);
  // This query DOES carry completeness-affecting diagnostics (live: 3 x
  // 'clearance-hard-clash-precheck-inconclusive'), so its alert must carry the caveat -- the exact
  // count/reasons are recorded, not asserted, for the same wall-clock-budget reason as above.
  check('[soft][hard-clash-exclusion] the alert carries the incompleteness caveat its own diagnostics require',
    exclusionSoftCall.diagnosticsCount > 0 ? exclusionSoft.message.includes('may be incomplete') : true, true);

  // === Positive case: the discovered near-miss, through the untouched production action ==========
  // Runs because the bounded spike genuinely found one. Nothing here is synthetic: the clearance is
  // the extension's OWN load()-resolved default, with no override at all.
  console.log(`\n=== Soft Clash case: ${SOFT_CLASH_POSITIVE_CASE.name} ===`);
  const positiveSoft = await runFindSoftClashesCase(SOFT_CLASH_POSITIVE_CASE.sourceDbId, null);
  const positiveSoftCall = positiveSoft.spy.findClashesCalls[0];
  const positiveSoftViz = await readSoftClashState();
  results.softClash.cases['discovered-near-miss-positive'] = {
    clearance: SOFT_CLASH_POSITIVE_CASE.clearance,
    clearanceWasOverridden: false,
    sourceDbId: SOFT_CLASH_POSITIVE_CASE.sourceDbId,
    alertMessage: positiveSoft.message,
    spy: positiveSoft.spy,
    visualization: positiveSoftViz,
  };
  check('[soft][near-miss] exactly one findClashes call made by the real "Find Soft Clashes" click',
    positiveSoft.spy.findClashesCalls.length, 1);
  check('[soft][near-miss] captured call: source is the Structure model', positiveSoftCall.sourceModelKey, 'struct');
  check('[soft][near-miss] captured call: source.dbIds is exactly the selected dbId',
    positiveSoftCall.sourceDbIds, [SOFT_CLASH_POSITIVE_CASE.sourceDbId]);
  checkClearancePairInvariants('near-miss', positiveSoftCall, SOFT_CLASH_POSITIVE_CASE.clearance);
  check('[soft][near-miss] captured call: the clearance used is the production DEFAULT, never an override from this test',
    positiveSoftCall.clearance, EXPECTED_DEFAULT_CLEARANCE);
  check('[soft][near-miss] captured call: exact {targetModel, targetDbId} pair set matches the discovery spike\'s own finding',
    positiveSoftCall.pairs.map(softTupleKey).sort(),
    SOFT_CLASH_POSITIVE_CASE.expectedPairs.map(softTupleKey).sort());
  check('[soft][near-miss] captured call: every pair\'s source really is Structure dbId 3965',
    positiveSoftCall.pairs.every((p) => p.sourceModelKey === 'struct' && p.sourceDbId === SOFT_CLASH_POSITIVE_CASE.sourceDbId), true);
  // Model provenance: this near-miss is entirely same-model, and the query really did span all three
  // models (whole-model scope for every loaded model), so "no cross-model pair" is a real finding.
  check('[soft][near-miss] captured call: same-model pair count (correct provenance labeling)',
    positiveSoftCall.pairs.filter((p) => p.targetModelKey === 'struct').length, 2);
  check('[soft][near-miss] captured call: cross-model pair count (correct provenance labeling)',
    positiveSoftCall.pairs.filter((p) => p.targetModelKey !== 'struct').length, 0);
  check('[soft][near-miss] captured call: source dbId excluded from its OWN model\'s results (same-model self-clash)',
    positiveSoftCall.pairs.some((p) => p.targetModelKey === 'struct' && p.targetDbId === SOFT_CLASH_POSITIVE_CASE.sourceDbId), false);
  // --- the measured distance itself ---
  check(`[soft][near-miss] every measured distance is within ${SOFT_CLASH_POSITIVE_CASE.distanceTolerance} of this fixture's recorded ground truth (${SOFT_CLASH_POSITIVE_CASE.expectedDistance})`,
    positiveSoftCall.pairs.every((p) => Math.abs(p.distance - SOFT_CLASH_POSITIVE_CASE.expectedDistance) <= SOFT_CLASH_POSITIVE_CASE.distanceTolerance), true);
  check('[soft][near-miss] every measured distance sits strictly inside the queried clearance band (a genuine near-miss, not a touch)',
    positiveSoftCall.pairs.every((p) => p.distance > 0 && p.distance < SOFT_CLASH_POSITIVE_CASE.clearance), true);
  // Independent corroboration from a wholly different data source: the InstanceTree's own node
  // boxes, which the collision pipeline plays no part in producing. 3965's box min-Y minus each
  // target's box max-Y is the same gap the clearance query measured (to within Float32 node-box
  // quantization) -- so this distance is not merely self-consistent, it is externally confirmed.
  const nodeBoxGaps = await page.evaluate(({ sourceDbId, targetDbIds }) => {
    const it = window.__test.modelStruct.getInstanceTree();
    const boxOf = (dbId) => { const b = new Float32Array(6); it.getNodeBox(dbId, b); return Array.from(b); };
    const source = boxOf(sourceDbId);
    return targetDbIds.map((dbId) => {
      const t = boxOf(dbId);
      return { dbId, gapY: source[1] - t[4], sourceBox: source, targetBox: t };
    });
  }, { sourceDbId: SOFT_CLASH_POSITIVE_CASE.sourceDbId, targetDbIds: SOFT_CLASH_POSITIVE_CASE.expectedPairs.map((p) => p.targetDbId) });
  results.softClash.cases['discovered-near-miss-positive'].nodeBoxGaps = nodeBoxGaps;
  console.log(`  [near-miss] independent node-box Y gaps: ${JSON.stringify(nodeBoxGaps.map((g) => g.gapY))}`);
  check(`[soft][near-miss] the measured surface distance is independently corroborated by the InstanceTree's own node boxes (within ${SOFT_CLASH_POSITIVE_CASE.nodeBoxGapTolerance})`,
    nodeBoxGaps.every((g) => Math.abs(g.gapY - SOFT_CLASH_POSITIVE_CASE.expectedDistance) <= SOFT_CLASH_POSITIVE_CASE.nodeBoxGapTolerance), true);
  check('[soft][near-miss] alert message reports the near-miss exactly, with no incompleteness caveat',
    positiveSoft.message, SOFT_CLASH_POSITIVE_CASE.expectedAlertMessage);
  await page.screenshot({ path: path.join(RESULTS_DIR, `clash-finder-soft-${SOFT_CLASH_POSITIVE_CASE.sourceDbId}-result.png`), fullPage: false });

  // --- world-space closest-point visualization, bound to the REAL overlay objects ----------------
  const positiveWitnessPointPairs = positiveSoftCall.pairs.map((p) => [p.witnessSourcePoint, p.witnessTargetPoint]);
  const positiveWitnessPointsFlat = positiveWitnessPointPairs.flat();
  check('[soft][near-miss] the Soft Clash overlay holds exactly two endpoint spheres + one connecting line per pair',
    positiveSoftViz.objectCount, positiveSoftCall.pairs.length * 3);
  check('[soft][near-miss] the object families are exactly {2 x Mesh, 1 x Line} per pair',
    [positiveSoftViz.types.filter((t) => t === 'Mesh').length, positiveSoftViz.types.filter((t) => t === 'Line').length],
    [positiveSoftCall.pairs.length * 2, positiveSoftCall.pairs.length]);
  check('[soft][near-miss] every endpoint sphere sits exactly on one of the pairs\' own world-space closest points',
    sortedPointKeys(positiveSoftViz.meshPositions), sortedPointKeys(positiveWitnessPointsFlat));
  check('[soft][near-miss] every connecting line spans its own pair\'s two closest points',
    positiveSoftViz.lineEndpoints.length === positiveSoftCall.pairs.length
      && positiveSoftViz.lineEndpoints.every((e) => e !== null && matchesSomePointPair(e, positiveWitnessPointPairs, 1e-4)), true);
  check('[soft][near-miss] the Soft Clash overlay scene is registered', positiveSoftViz.hasScene, true);
  check('[soft][near-miss] every Soft Clash object is really in the overlay scene (public overlays.hasMesh)',
    positiveSoftViz.hasMeshFlags, new Array(positiveSoftCall.pairs.length * 3).fill(true));
  check('[soft][near-miss] the Soft Clash overlay scene holds exactly that many objects (internal corroboration)',
    positiveSoftViz.overlaySceneMeshCount, positiveSoftCall.pairs.length * 3);
  check('[soft][near-miss] every endpoint sphere is uniformly scaled', positiveSoftViz.meshUniformScale, true);
  check('[soft][near-miss] every endpoint sphere radius is inside Soft Clash\'s own clamped [MIN, MAX] band',
    positiveSoftViz.meshRadii.every((r) => r >= EXPECTED_SOFT_MIN_MARKER_RADIUS && r <= EXPECTED_SOFT_MAX_MARKER_RADIUS), true);
  // Global Constraint: one shared sphere geometry/material and one shared line material, with only
  // the per-pair line geometry created per object.
  check('[soft][near-miss] every sphere reuses the ONE shared Soft Clash geometry', positiveSoftViz.meshesShareGeometry, true);
  check('[soft][near-miss] every sphere reuses the ONE shared Soft Clash material', positiveSoftViz.meshesShareMaterial, true);
  check('[soft][near-miss] every line reuses the ONE shared Soft Clash line material', positiveSoftViz.linesShareMaterial, true);
  check('[soft][near-miss] each line owns its OWN distinct geometry (never the shared sphere geometry, never a shared one)',
    positiveSoftViz.lineGeometriesAreDistinct, true);
  check('[soft][near-miss] the Soft Clash colour is its own SOFT_CLASH_COLOR, visually distinct from Hard Clash\'s',
    [positiveSoftViz.softColor, positiveSoftViz.softLineColor, positiveSoftViz.hardColor],
    [EXPECTED_SOFT_CLASH_COLOR, EXPECTED_SOFT_CLASH_COLOR, EXPECTED_HARD_CLASH_COLOR]);
  check('[soft][near-miss] Soft Clash markers render through opaque geometry too (depthTest:false, same as Hard Clash\'s)',
    positiveSoftViz.softDepthTest, false);
  // --- the two visualizations genuinely coexist -------------------------------------------------
  check('[soft][near-miss] the two overlay scenes are separate and both registered at once',
    positiveSoftViz.overlayScenesAreDistinct, true);
  check('[soft][near-miss] Hard Clash\'s own markers are still on screen, untouched by the Soft Clash run',
    [positiveSoftViz.hardMarkerCount, positiveSoftViz.hardOverlaySceneMeshCount],
    [hardMarkersBeforeSoftClash.activeMarkerCount, hardMarkersBeforeSoftClash.overlaySceneMeshCount]);

  // --- isolation: Soft Clash's own contribution is UNIONED with Hard Clash's, never a replacement -
  const expectedUnionStruct = sortNums([...new Set([
    ...MIXED_CASE.expectedIsolatedStruct, ...SOFT_CLASH_POSITIVE_CASE.expectedSoftIsolatedStruct,
  ])]);
  check('[soft][near-miss] real isolate() for Structure is the UNION of Hard Clash\'s and Soft Clash\'s own contributions',
    sortNums(isolateCallFor(positiveSoft.spy, 'struct')?.dbIds ?? []), expectedUnionStruct);
  check('[soft][near-miss] real isolate() for Architecture re-applies Hard Clash\'s own contribution unchanged (Soft Clash never touched that model)',
    sortNums(isolateCallFor(positiveSoft.spy, 'arch')?.dbIds ?? []), sortNums(MIXED_CASE.expectedIsolatedArch));
  check('[soft][near-miss] Mechanical is never isolated (no pair involves it)',
    isolateCallFor(positiveSoft.spy, 'mech'), undefined);
  // fitToView, by contrast, is per-action camera framing scoped to exactly what THIS action found --
  // deliberately NOT the union.
  check('[soft][near-miss] exactly one real fitToView() call, for the Structure model only',
    positiveSoft.spy.fitToViewCalls.map((c) => c.modelKey), ['struct']);
  check('[soft][near-miss] real fitToView() frames only what THIS action found, never the isolation union',
    sortNums(fitToViewCallFor(positiveSoft.spy, 'struct')?.dbIds ?? []),
    sortNums(SOFT_CLASH_POSITIVE_CASE.expectedSoftIsolatedStruct));
  const positiveIsolatedStruct = await getIsolatedNodesFor('struct');
  const positiveIsolatedArch = await getIsolatedNodesFor('arch');
  const positiveIsolatedMech = await getIsolatedNodesFor('mech');
  check('[soft][near-miss] end-state: Structure isolation really is the union', sortNums(positiveIsolatedStruct), expectedUnionStruct);
  check('[soft][near-miss] end-state: Architecture isolation is unchanged', sortNums(positiveIsolatedArch), sortNums(MIXED_CASE.expectedIsolatedArch));
  check('[soft][near-miss] end-state: Mechanical isolation is still empty', positiveIsolatedMech, []);

  // --- the same near-miss, re-run after ONE real model-alignment operation -----------------------
  // Both operands of both pairs live in the Structure model, so a pure +3 X translation of that
  // model's placement is a RIGID MOTION for this pair set: the measured distances must be unchanged
  // and both witness points of every pair must translate by exactly (+3, 0, 0). That exactness is
  // the point -- it is a genuine invariant, not a tolerance-padded approximation, and it is what
  // proves the closest-point visualization actually tracked the alignment.
  console.log(`\n=== Soft Clash case: alignment (+${ALIGNMENT_DELTA_X} X on the Structure model), near-miss re-run ===`);
  const softAlignmentOriginalPlacement = await readStructPlacementElements();
  await translateStructPlacement(ALIGNMENT_DELTA_X);
  const softMovedPlacement = await readStructPlacementElements();
  check('[soft][alignment] the Structure model\'s placement transform really moved by the expected delta in X',
    Math.abs((softMovedPlacement[12] - softAlignmentOriginalPlacement[12]) - ALIGNMENT_DELTA_X) <= 1e-6, true);

  const alignedSoft = await runFindSoftClashesCase(SOFT_CLASH_POSITIVE_CASE.sourceDbId, null);
  const alignedSoftCall = alignedSoft.spy.findClashesCalls[0];
  const alignedSoftViz = await readSoftClashState();
  const witnessPairByKey = (call) => Object.fromEntries(
    call.pairs.map((p) => [softTupleKey(p), [p.witnessSourcePoint, p.witnessTargetPoint]]),
  );
  const softWitnessBefore = witnessPairByKey(positiveSoftCall);
  const softWitnessAfter = witnessPairByKey(alignedSoftCall);
  const softWitnessDeltas = Object.fromEntries(Object.keys(softWitnessBefore).map((key) => [key,
    (softWitnessAfter[key] ?? [[NaN, NaN, NaN], [NaN, NaN, NaN]]).map((pt, i) => pt.map((v, j) => v - softWitnessBefore[key][i][j])),
  ]));
  results.softClash.cases['discovered-near-miss-positive'].alignment = {
    deltaX: ALIGNMENT_DELTA_X,
    alertMessage: alignedSoft.message,
    witnessDeltas: softWitnessDeltas,
    visualization: alignedSoftViz,
  };
  console.log(`  [soft][alignment] witness deltas = ${JSON.stringify(softWitnessDeltas)}`);
  check('[soft][alignment] exactly one findClashes call made by the re-run\'s real click',
    alignedSoft.spy.findClashesCalls.length, 1);
  check('[soft][alignment] the same {targetModel, targetDbId} pair set still resolves after the alignment',
    [...alignedSoftCall.pairs.map(softTupleKey)].sort(), SOFT_CLASH_POSITIVE_CASE.expectedPairs.map(softTupleKey).sort());
  check('[soft][alignment] every measured distance is unchanged (a rigid motion cannot change a distance between two operands that both moved with it)',
    alignedSoftCall.pairs.every((p) => Math.abs(p.distance - SOFT_CLASH_POSITIVE_CASE.expectedDistance) <= SOFT_CLASH_POSITIVE_CASE.distanceTolerance), true);
  check(`[soft][alignment] BOTH witness points of every pair moved by exactly (+${ALIGNMENT_DELTA_X}, 0, 0) -- a rigid-motion invariant, matched by pair identity`,
    Object.values(softWitnessDeltas).every((pts) => pts.every((d) => pointsWithin(d, [ALIGNMENT_DELTA_X, 0, 0], 1e-6))), true);
  const alignedWitnessPointPairs = alignedSoftCall.pairs.map((p) => [p.witnessSourcePoint, p.witnessTargetPoint]);
  check('[soft][alignment] every endpoint sphere sits on a closest point from the RE-RUN\'s own result (matched as a multiset, never by array order)',
    sortedPointKeys(alignedSoftViz.meshPositions), sortedPointKeys(alignedWitnessPointPairs.flat()));
  check('[soft][alignment] every connecting line spans a RE-RUN closest-point pair',
    alignedSoftViz.lineEndpoints.every((e) => e !== null && matchesSomePointPair(e, alignedWitnessPointPairs, 1e-4)), true);
  check('[soft][alignment] the same number of Soft Clash overlay objects is drawn',
    alignedSoftViz.objectCount, positiveSoftViz.objectCount);

  // Restore the placement and re-run: everything must come back to exactly where it started.
  await restoreStructPlacement(softAlignmentOriginalPlacement);
  const softRestoredPlacement = await readStructPlacementElements();
  check('[soft][alignment] the Structure model\'s placement transform was restored exactly',
    softRestoredPlacement, softAlignmentOriginalPlacement);
  const restoredSoft = await runFindSoftClashesCase(SOFT_CLASH_POSITIVE_CASE.sourceDbId, null);
  const restoredSoftCall = restoredSoft.spy.findClashesCalls[0];
  const restoredSoftViz = await readSoftClashState();
  const softWitnessRestored = witnessPairByKey(restoredSoftCall);
  results.softClash.cases['discovered-near-miss-positive'].restored = {
    alertMessage: restoredSoft.message, visualization: restoredSoftViz,
  };
  check('[soft][alignment] after restoring the placement, the same pair set resolves again',
    [...restoredSoftCall.pairs.map(softTupleKey)].sort(), SOFT_CLASH_POSITIVE_CASE.expectedPairs.map(softTupleKey).sort());
  check('[soft][alignment] after restoring the placement, BOTH witness points of every pair return to their original world positions (matched by pair identity)',
    Object.keys(softWitnessBefore).every((key) => softWitnessRestored[key]
      && softWitnessRestored[key].every((pt, i) => pointsWithin(pt, softWitnessBefore[key][i], 1e-6))), true);
  check('[soft][alignment] after restoring the placement, every endpoint sphere sits on a restored closest point',
    sortedPointKeys(restoredSoftViz.meshPositions),
    sortedPointKeys(restoredSoftCall.pairs.flatMap((p) => [p.witnessSourcePoint, p.witnessTargetPoint])));

  // --- section-level guarantees -----------------------------------------------------------------
  const softClearanceAtSectionEnd = await page.evaluate((id) => window.viewer.getExtension(id)._clearance, CLASH_FINDER_EXTENSION_ID);
  check('[soft] the extension\'s own clearance was restored to the production default after every override',
    softClearanceAtSectionEnd, EXPECTED_DEFAULT_CLEARANCE);
  // Scoped to THIS section, unlike the whole-run assertion at the end of main(): what matters here
  // is that nothing Soft Clash did produced a new console error or an uncaught page exception.
  check('[soft] the whole Soft Clash section introduced ZERO new console errors',
    results.consoleErrors.slice(softClashConsoleErrorsBefore), []);
  check('[soft] the whole Soft Clash section introduced ZERO new uncaught page exceptions',
    results.pageErrors.slice(softClashPageErrorsBefore), []);

  // === M2.1 Task 10 Step 8: unloading a participating model clears the whole visualization ========
  // The Architecture model is a genuine participant here (it owns the cross-model target, dbId 3686,
  // and is currently isolated). Its unload must clear EVERY marker and ALL isolation -- not just its
  // own -- per ClashFinderExtension._onBeforeModelUnload's own documented full-clear policy.
  console.log('\n=== Case: unloading a participating model (Architecture) ===');
  await stashMarkerMeshes();
  const markersBeforeUnload = await readMarkerState();
  check('[unload] markers really are on screen before the unload (the precondition this step needs)',
    markersBeforeUnload.activeMarkerCount > 0, true);
  await page.evaluate(() => window.viewer.unloadModel(window.__test.modelArch));
  await page.waitForFunction(() => window.viewer.getAllModels().length === 2, null, { timeout: 30_000 });
  await page.waitForTimeout(500); // let the BEFORE_MODEL_UNLOAD handler's own work settle

  const unloadState = await page.evaluate((extensionId) => {
    const ext = window.viewer.getExtension(extensionId);
    return {
      modelCount: window.viewer.getAllModels().length,
      isolatedModelsSize: ext._isolatedModels.size,
      isolatedStruct: window.viewer.getIsolatedNodes(window.__test.modelStruct),
      isolatedMech: window.viewer.getIsolatedNodes(window.__test.modelMech),
    };
  }, CLASH_FINDER_EXTENSION_ID);
  const markersAfterUnload = await readMarkerState();
  results.unload = { unloadState, markers: markersAfterUnload };
  check('[unload] the Architecture model really is gone', unloadState.modelCount, 2);
  check('[unload] no active markers remain', markersAfterUnload.activeMarkerCount, 0);
  check('[unload] the overlay scene holds zero meshes', markersAfterUnload.overlaySceneMeshCount, 0);
  check('[unload] the pre-unload marker meshes were really removed from the overlay scene',
    await stashedMarkersStillInOverlay(), new Array(markersBeforeUnload.activeMarkerCount).fill(false));
  check('[unload] the extension\'s own isolated-models bookkeeping was cleared', unloadState.isolatedModelsSize, 0);
  check('[unload] Structure isolation cleared', unloadState.isolatedStruct, []);
  check('[unload] Mechanical isolation still empty', unloadState.isolatedMech, []);

  // M3 Task 17, added as a sibling check rather than folded into the block above: the Soft Clash
  // section left its OWN overlay populated (the restored near-miss re-run's 6 objects), so this
  // unload must clear that visualization too -- _onBeforeModelUnload's Soft Clash cleanup rung is
  // unconditional and whole-visualization, exactly like Hard Clash's own. Its overlay SCENE, like
  // Hard Clash's, deliberately survives (only unload() removes it).
  const softStateAfterUnload = await readSoftClashState();
  results.unload.softClash = softStateAfterUnload;
  check('[unload] no Soft Clash overlay objects remain either', softStateAfterUnload.objectCount, 0);
  check('[unload] the Soft Clash overlay scene holds zero objects', softStateAfterUnload.overlaySceneMeshCount, 0);
  check('[unload] the Soft Clash overlay scene itself still exists (only unload() removes it)',
    softStateAfterUnload.hasScene, true);

  // === M2.1 Task 10 Step 9: zero console errors across the ENTIRE run =============================
  // M3 Task 17 touched ONLY this check's description, to keep it accurate now that the run also
  // performs 4 "Find Soft Clashes" invocations and a second alignment cycle -- the assertion itself
  // (results.consoleErrors must be empty) is unchanged.
  check('zero console errors across the whole run (viewer bootstrap, 3 model loads, 4 Find Clashes runs, 4 Find Soft Clashes runs, 2 alignment cycles, unload)',
    results.consoleErrors, []);
  check('zero uncaught page exceptions across the whole run', results.pageErrors, []);

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
