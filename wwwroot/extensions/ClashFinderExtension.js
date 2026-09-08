// wwwroot/extensions/ClashFinderExtension.js
//
// A thin CollisionWorld consumer, sibling to RoomLocatorExtension.js: given a single selected
// source element (spanning any one loaded model), uses CollisionWorld.findClashes({mode:
// 'volume-overlap'}) -- the fixed, only "Hard Clash" mode this workflow ever uses -- against every
// currently loaded model (source's own model included; CollisionWorld's own source self-exclusion
// already keeps the source element out of its own results, so this extension must never manually
// filter it out) and isolates/highlights whatever it finds.
//
// Depends ONLY on CollisionWorld's public surface: fromViewer, findClashes, evictModel, dispose.
// Never reaches into CollisionWorld internals. collision/index.js is the library's single public
// entry point (its own header states consumers import from there, never from the individual
// implementation modules) -- CollisionWorld and the error classes all come from that one re-export.
import { CollisionWorld } from '../../collision/index.js';

// Exported so wwwroot/viewer.js registers/unregisters under the SAME id this extension uses for its
// context-menu callback -- a duplicated string literal could silently drift and break both
// registerExtension matching and unregisterContextMenuCallback. Deliberately a DISTINCT literal
// from RoomLocatorExtension's own EXTENSION_ID -- these are two separate, independently
// loaded/unloaded extensions (spec 11.1: different UX shape, different default query mode).
export const EXTENSION_ID = 'Autodesk.Sandbox.ClashFinder';

// Same headless-Node guard as RoomLocatorExtension.js: `Autodesk` is a real browser global supplied
// by viewer3D.js (loaded via a <script> tag -- see wwwroot/index.html) and is never imported. In a
// headless Node test process (this extension's own unit fixtures) that global does not exist at
// all, and `class X extends Autodesk.Viewing.Extension` would throw a ReferenceError at
// MODULE-EVALUATION time (the `extends` heritage clause runs immediately, not lazily at
// instantiation). `typeof Autodesk` is the standard safe check for a possibly-undeclared global.
const ViewingNS = typeof Autodesk !== 'undefined' ? Autodesk.Viewing : undefined;
const ExtensionBase = ViewingNS?.Extension ?? class {
  constructor(viewer, options) {
    this.viewer = viewer;
    this.options = options;
  }
};
// Verified string value from node_modules/@types/forge-viewer/index.d.ts:324 (same constant
// RoomLocatorExtension.js already verified and uses).
const BEFORE_MODEL_UNLOAD_EVENT = ViewingNS?.BEFORE_MODEL_UNLOAD_EVENT ?? 'beforeModelUnload';

// Task 8 (M2.1): witness marker overlay constants. MARKER_OVERLAY_NAME is the Viewer overlay-scene
// namespace every viewer.overlays.{addScene,hasScene,addMesh,removeMesh,clearScene,removeScene}
// call below keys off (Task 7 finding 1: the public viewer.overlays.* facade, not the internal
// viewer.impl.* path -- functionally identical render path, but the public addScene additionally
// guards against duplicate-name registration, which the internal createOverlayScene does not).
// MARKER_RADIUS_FRACTION/MIN/MAX_MARKER_RADIUS are Task 10's own tuning knobs against the real
// fixture -- these are starting defaults, not final values (Task 7's "Open items" section defers
// exact tuning to live acceptance). MARKER_COLOR is a placeholder with the same caveat -- Task 10
// also confirms on-screen color fidelity through the overlay gamma/compositing path.
const MARKER_OVERLAY_NAME = 'clash-finder-markers';
const MARKER_RADIUS_FRACTION = 0.002;
const MIN_MARKER_RADIUS = 0.05; // world units — tune during Task 10 live acceptance against the real fixture
const MAX_MARKER_RADIUS = 2.0; // world units — tune during Task 10 live acceptance against the real fixture
const MARKER_COLOR = 0xff6a00; // distinct from the Viewer's default selection theme — confirm visually in Task 10

// Task 14 (M3 Batch 3): "Find Soft Clashes" default clearance, in world units, used whenever
// options.defaultClearance is not supplied to the constructor. Provisional value -- Task 18's
// performance gate (live acceptance against the real fixture) may retune this, exactly like
// MARKER_RADIUS_FRACTION/MIN/MAX_MARKER_RADIUS above are already flagged as provisional.
const DEFAULT_CLEARANCE = 0.05;

// Task 15 (M3 Batch 3): "Find Soft Clashes" own overlay constants, mirroring Hard Clash's own
// MARKER_OVERLAY_NAME/MARKER_COLOR constants above but kept as SEPARATE, DISTINCT values (never
// reused) so both result types can be visualized in the same session without confusion --
// SOFT_CLASH_OVERLAY_NAME is a completely separate overlay scene from MARKER_OVERLAY_NAME, and
// SOFT_CLASH_COLOR (blue) is visually distinct from MARKER_COLOR (orange).
const SOFT_CLASH_OVERLAY_NAME = 'clash-finder-soft-markers';
const SOFT_CLASH_COLOR = 0x2b8fff; // blue -- distinct from Hard Clash's MARKER_COLOR (orange)
// Documentary only: _computeMarkerRadius's own refactor below (Task 15) parameterizes min/max
// radius, but NOT MARKER_RADIUS_FRACTION -- Soft Clash intentionally reuses that same shared
// internal fraction rather than threading a second one through, since Task 10's tuning already
// applies to both marker families identically. This constant records that the SAME fraction value
// is deliberately reused, in case a future change ever DOES need to parameterize the fraction too.
const SOFT_CLASH_MARKER_RADIUS_FRACTION = MARKER_RADIUS_FRACTION;
const SOFT_CLASH_MIN_MARKER_RADIUS = 0.05; // world units — same provisional-tuning caveat as MIN_MARKER_RADIUS
const SOFT_CLASH_MAX_MARKER_RADIUS = 2.0; // world units — same provisional-tuning caveat as MAX_MARKER_RADIUS

export class ClashFinderExtension extends ExtensionBase {
  // Exposed as static class fields too (not just the module-level consts above) so callers/tests
  // can reference the live values off the class itself (e.g. ClashFinderExtension.MIN_MARKER_RADIUS)
  // rather than re-declaring the same magic numbers a second time.
  static MIN_MARKER_RADIUS = MIN_MARKER_RADIUS;
  static MAX_MARKER_RADIUS = MAX_MARKER_RADIUS;
  static DEFAULT_CLEARANCE = DEFAULT_CLEARANCE;

  constructor(viewer, options = {}) {
    super(viewer, options);
    // Underscore-private convention matching CollisionWorld's own `_viewer` field and
    // RoomLocatorExtension's own `_viewer` -- also the seam the test fixtures inject/inspect.
    this._viewer = viewer;
    this._world = null;
    // Monotonically increasing per-invocation action token (codex-review Question #2): each
    // onContextMenu target() callback captures the token AT CLICK TIME, before findClashes ever
    // starts, and only applies isolate/fitToView/notify if that token is still the latest one when
    // the (possibly slow) async findClashes call resolves. A right-click on a second element before
    // the first Find Clashes call resolves must never let the SLOWER, now-superseded call overwrite
    // the newer one's visualization -- the superseded result is discarded silently (no error, no
    // notify, no isolate/fitToView), since being superseded is not a failure.
    this._latestActionToken = 0;
    // Every Model this extension currently has isolated, so a later call (a fresh Find Clashes, or a
    // "No clashes found" outcome) can correctly clear prior isolation state before applying (or
    // omitting) new isolation -- spec 11.2 "Clearing/restoring visualization".
    this._isolatedModels = new Set();
    // Task 8 (M2.1): witness marker overlay state. _activeMarkers is deliberately an ARRAY, not a
    // Set like _isolatedModels above -- an ordered list of individual THREE.Mesh instances to
    // remove one at a time in _clearMarkers, not a dedup-by-identity collection (a documented
    // pattern deviation, not a copy-paste of the Set precedent). _markerGeometry/_markerMaterial
    // are lazily created (see _ensureMarkerOverlay) and shared across every marker mesh -- Task 7
    // finding 5's teardown gotcha (removeScene/clearScene never dispose materials, clearScene only
    // conditionally disposes geometry) is exactly why disposing these two fields is a LATER task's
    // (Task 9's unload-time teardown) job, not this one's.
    this._activeMarkers = [];
    this._markerGeometry = null;
    this._markerMaterial = null;
    // Task 14 (M3 Batch 3): "Find Soft Clashes" own visualization-tracking state, kept SEPARATE from
    // _activeMarkers above -- Hard Clash's witness-marker overlay and Soft Clash's own visualization
    // (Task 15 fills in real geometry; this task only tracks the pairs it was last given) are
    // independent, never sharing state, matching the same "separate, independent action" framing as
    // the two action tokens below.
    this._activeSoftClashObjects = [];
    // Task 15 (M3 Batch 3): lazily created (see _ensureSoftClashOverlay), shared across every
    // Soft Clash marker/line this extension ever creates -- same "one shared geometry/material
    // pair, never per-instance duplication" discipline as _markerGeometry/_markerMaterial above,
    // but its OWN separate objects (never shared with Hard Clash's).
    this._softClashGeometry = null;
    this._softClashMaterial = null;
    this._softClashLineMaterial = null;
    this._onBeforeModelUnloadBound = (event) => this._onBeforeModelUnload(event);
    this._onContextMenuBound = (menu, status) => this.onContextMenu(menu, status);
  }

  // Task 14 (M3 Batch 3) fix, post-review: `defaultClearance` resolution/validation runs as the VERY
  // FIRST statement in load(), before CollisionWorld.fromViewer and before any listener/menu
  // registration below. The first draft validated it AFTER that existing setup -- a thrown
  // validation error would then leave a world constructed and callbacks attached despite load()
  // itself having failed, and a caller retrying load() could double-register. Validating first means
  // a bad `defaultClearance` throws before any of that setup ever runs, leaving nothing to unwind.
  //
  // Same ordering discipline as RoomLocatorExtension.load() for everything AFTER this validation:
  // CollisionWorld.fromViewer runs to completion first; the listener/menu-callback registrations
  // only happen after that promise resolves, inside this same call. If fromViewer() had rejected,
  // load()'s own returned promise already rejected with that same error before either registration
  // below ran.
  async load() {
    this._clearance = this.options.defaultClearance ?? DEFAULT_CLEARANCE;
    if (typeof this._clearance !== 'number' || !Number.isFinite(this._clearance) || this._clearance <= 0) {
      throw new Error(`ClashFinderExtension: options.defaultClearance must be a finite, positive number, got ${this.options.defaultClearance}`);
    }
    // Task 14: Soft Clash's own monotonic action token, SEPARATE from _latestActionToken (Hard
    // Clash's own, declared in the constructor above and unchanged by this task) -- see the "Find
    // Soft Clashes" menu entry below for why these two counters must never interact.
    this._latestSoftClashActionToken = 0;
    this._world = await CollisionWorld.fromViewer(this._viewer, this.options);
    this._viewer.addEventListener(BEFORE_MODEL_UNLOAD_EVENT, this._onBeforeModelUnloadBound);
    this._viewer.registerContextMenuCallback(EXTENSION_ID, this._onContextMenuBound);
    return true;
  }

  // Same ordering as RoomLocatorExtension.unload() -- dispose() first, then listener/menu removal.
  // Unlike Room Locator, there is no per-model cache to clear here: this extension holds no
  // per-model resolved state, only the transient `_isolatedModels` visualization bookkeeping, which
  // BEFORE_MODEL_UNLOAD_EVENT already prunes per-model as models unload (see below).
  // [review fix, codex-review Important #3] Invalidate the action token FIRST, before dispose/
  // listener removal: a findClashes promise that already RESOLVED but whose `target()` continuation
  // has not yet run (a pending microtask at the moment unload() is called) must see a now-stale
  // token when that continuation finally runs and no-op entirely -- without this, isolate/
  // fitToView/notify could fire AFTER this extension has torn down. Listener/context-menu removal is
  // then wrapped so it still happens even if `dispose()` throws (e.g. a repeated unload() call
  // re-throwing WorldDisposedError, per RoomLocatorExtension's own documented "accepted, imperfect"
  // ordering) -- hardened here so a failed/duplicate unload() never leaves this extension's own
  // context-menu callback or event listener stranded. Isolation is cleared LAST so unload() never
  // leaves a stale highlight from a prior query on screen.
  // Task 9 (M2.1): a new OUTER finally wraps the dispose/listener-removal try/finally so BOTH
  // _clearIsolation() and marker teardown run no matter what -- whether dispose() throws (as
  // documented above) or _clearIsolation() itself throws.
  // [Task 9 review fix, Batch 2 reviewer + codex-advisor] _clearIsolation() originally sat INSIDE the
  // inner try, alongside dispose(): when dispose() throws, the exception propagated past
  // _clearIsolation() before it ever ran, leaving _isolatedModels populated while the outer finally's
  // unconditional _clearMarkers() still ran -- markers vanish but isolation/highlighting remains, a
  // direct violation of this task's own protected invariant that isolation and markers can never
  // visually disagree. Fixed by nesting _clearIsolation() into its OWN try/finally inside the outer
  // finally, immediately ahead of marker teardown: this guarantees _clearIsolation() runs even when
  // dispose() throws, AND guarantees marker teardown runs even when _clearIsolation() ITSELF throws --
  // neither cleanup step can be skipped by the other one failing. Order inside this innermost finally
  // still matters: _clearMarkers() (remove every mesh from the overlay scene) MUST run before disposing
  // the shared geometry/material below it, so those two objects are disposed exactly once, strictly
  // after every mesh referencing them has already been detached -- disposing them first would leave
  // dangling meshes pointing at disposed GL resources for whatever render tick still sees them.
  // removeScene (not clearScene) fully unregisters the overlay namespace itself, matching Task 7
  // finding 5: neither removeScene nor clearScene ever disposes geometry/material on their own, which
  // is exactly why those two disposals are spelled out explicitly here rather than assumed.
  unload() {
    this._latestActionToken += 1;
    try {
      try {
        this._world.dispose();
      } finally {
        this._viewer.removeEventListener(BEFORE_MODEL_UNLOAD_EVENT, this._onBeforeModelUnloadBound);
        this._viewer.unregisterContextMenuCallback(EXTENSION_ID);
      }
    } finally {
      try {
        this._clearIsolation();
      } finally {
        this._clearMarkers();
        if (this._viewer.overlays.hasScene(MARKER_OVERLAY_NAME)) {
          this._viewer.overlays.removeScene(MARKER_OVERLAY_NAME);
        }
        if (this._markerGeometry) { this._markerGeometry.dispose(); this._markerGeometry = null; }
        if (this._markerMaterial) { this._markerMaterial.dispose(); this._markerMaterial = null; }
      }
    }
    return true;
  }

  // world.evictModel(event.model) -- the exact object -- AND drop it from the isolated-models
  // bookkeeping (an unloaded model can no longer be meaningfully cleared via viewer.isolate([],
  // model), and holding a stale reference forever would only leak). Typings declare `event: any`;
  // defensively verify `event.model` exists rather than let a missing field surface as a cryptic
  // downstream TypeError.
  _onBeforeModelUnload(event) {
    if (!event || !event.model) {
      throw new Error('ClashFinderExtension: BEFORE_MODEL_UNLOAD_EVENT fired with no event.model — typings declare `event: any`; this handler cannot proceed without the model object.');
    }
    // [Task 9 review fix, codex-advisor] Invalidate the action token FIRST, before anything else --
    // the EXACT same race unload() itself already guards against (see unload()'s own comment above):
    // a findClashes promise that already RESOLVED but whose target() continuation has not yet run (a
    // pending microtask at the moment this model-unload fires) must see a now-stale token when that
    // continuation finally runs. Without this, that continuation's `token !== this._latestActionToken`
    // check would still pass (nothing bumped the token), so it would re-apply isolate/fitToView/
    // addMarkers referencing a model that was JUST evicted below -- silently resurrecting stale
    // isolation/markers moments after this handler cleared them, exactly the "isolation and markers
    // must never visually disagree" invariant this task exists to protect.
    this._latestActionToken += 1;
    // [Batch 2 whole-batch review Finding 6 fix] wrap evictModel so cleanup still runs even if it
    // throws (e.g. a WorldDisposedError) -- the SAME defect class unload() itself was already fixed
    // for in the prior fix round (see unload()'s own structure above for the pattern this mirrors).
    // Without this, evictModel throwing would skip _clearIsolation()/_clearMarkers()/
    // _isolatedModels.delete() entirely and let the throw escape into a Viewer event dispatch --
    // leaving this extension holding isolation/markers referencing a model that's now unloaded, and
    // later trying viewer.isolate([], <unloaded model>).
    try {
      this._world.evictModel(event.model);
    } finally {
      // Task 9 (M2.1): the ENTIRE visualization clears on ANY participating-model unload -- not just
      // the unloaded model's own isolation/markers. A partial-preservation policy (leave OTHER
      // models' isolation and markers alone) was shown unsound: those surviving models could be left
      // isolated with a marker referencing a witness point that, after this unload, no longer has any
      // meaningful relationship to what's still on screen. _clearIsolation() already iterates ALL of
      // this._isolatedModels unconditionally, so calling it here already achieves "clear for every
      // model", matching _clearMarkers()'s own unconditional full-scene clear.
      //
      // [Batch 2 fix-round follow-up, codex-review + coordinator tightening] _clearIsolation() is
      // nested in its OWN try/finally here -- the SAME "one throw skips the rest of cleanup" defect
      // class this Finding-6 fix already guards against at the evictModel call site above, one layer
      // deeper: if _clearIsolation() itself throws (e.g. one of its internal viewer.isolate([], model)
      // calls throws), _clearMarkers() and _isolatedModels.delete() below must still run, exactly
      // mirroring unload()'s own existing structure (see unload()'s own comment above the equivalent
      // nesting there). Making _clearIsolation()'s OWN internal per-model loop resilient to a SINGLE
      // failing isolate() call (continue clearing the remaining models rather than aborting the whole
      // loop) is a separate, broader change intentionally left out of this fix -- see this task's own
      // report for that out-of-scope finding.
      try {
        this._clearIsolation();
      } finally {
        this._clearMarkers();
        this._isolatedModels.delete(event.model);
      }
    }
  }

  // Identical to RoomLocatorExtension's own helper: wwwroot/viewer.js's getAccessToken error path
  // already establishes `alert(...)` as this sandbox's one user-visible caveat channel (there is no
  // toast/notification framework here). The typeof guard is for this extension's own headless Node
  // fixtures, where no `alert` global exists.
  _notifyUser(message) {
    if (typeof alert === 'function') alert(message);
    else console.warn(message);
  }

  // Identical logic to RoomLocatorExtension.describeDiagnostics -- count + distinct reasons, without
  // enumerating every entry (a big federated query can produce many).
  static describeDiagnostics(diagnostics) {
    const reasons = [...new Set(diagnostics.map((d) => d?.reason ?? 'unknown'))];
    return `${diagnostics.length} diagnostic(s): ${reasons.join(', ')}`;
  }

  // Spec 11.2 "Clearing/restoring visualization": viewer.isolate([], model) per model this
  // extension previously isolated -- called unconditionally before applying (or omitting) new
  // isolation, so a "No clashes found" outcome or a fresh Find Clashes call both correctly clear
  // prior isolation state rather than leaving a stale highlight from an earlier query on screen.
  _clearIsolation() {
    for (const model of this._isolatedModels) {
      this._viewer.isolate([], model);
    }
    this._isolatedModels.clear();
  }

  // Task 8 (M2.1). Lazily creates the ONE shared SphereGeometry/MeshBasicMaterial pair (Global
  // Constraint: no per-marker geometry/material duplication -- every marker mesh this extension
  // ever creates reuses these same two objects) and the overlay scene itself, both on first use
  // rather than at construction (a Clash Finder query that never finds a witness-bearing pair
  // should never register an overlay scene at all -- see _addMarkers's own early-return below).
  // `hasScene` is checked before calling `addScene`, per Task 7 finding 1: the public addScene
  // guards against duplicate names itself, but calling it unconditionally on every _addMarkers
  // invocation would still be wasteful and untidy against the same underlying registry.
  _ensureMarkerOverlay() {
    const THREE = window.THREE; // Viewer's own r71 global -- never import 'three' in this file
    if (!this._markerGeometry) {
      this._markerGeometry = new THREE.SphereGeometry(1, 12, 8); // unit sphere — scaled per-instance below
      this._markerMaterial = new THREE.MeshBasicMaterial({
        color: MARKER_COLOR,
        transparent: true,
        opacity: 0.65,
        // Task 7 finding 2: depthTest:false genuinely renders a marker through occluding model
        // geometry (sourced from the render pipeline's RenderContext.renderOverlays plus the
        // shipped OverlayManager's own JSDoc). depthWrite:false pairs with it, matching LMV's own
        // selection-overlay convention, so this marker never pollutes a depth buffer other draws
        // still read.
        depthTest: false,
        depthWrite: false,
      });
    }
    if (!this._viewer.overlays.hasScene(MARKER_OVERLAY_NAME)) {
      this._viewer.overlays.addScene(MARKER_OVERLAY_NAME);
    }
  }

  // Derives a marker radius from the combined bounding sphere of every isolated dbId, always
  // clamped between minRadius and maxRadius (Global Constraint) -- an unbounded fraction of a huge
  // federated model's bounding sphere would produce a marker the size of a building; an unbounded
  // fraction of a tiny model (or of an empty box: see below) would produce one invisibly small or,
  // worse, an Infinity-derived one that clamps to maxRadius and reads as a real measurement it
  // never was.
  //
  // Task 15 (M3 Batch 3) refactor: `minRadius`/`maxRadius` were previously read directly off the
  // module-level MIN_MARKER_RADIUS/MAX_MARKER_RADIUS consts inside this method's body, with no way
  // for a caller to supply different clamp bounds. Soft Clash's own visualization (Task 15) needs
  // its own SOFT_CLASH_MIN_MARKER_RADIUS/SOFT_CLASH_MAX_MARKER_RADIUS bounds rather than Hard
  // Clash's -- parameterizing here (defaulting to the ORIGINAL module-level consts) is a
  // behavior-preserving refactor: Hard Clash's own call site below (`_addMarkers`, unchanged) omits
  // both new arguments and gets IDENTICAL behavior to before via these defaults. Proven by
  // `test/ClashFinderExtension.test.mjs` passing unmodified.
  //
  // InstanceTree.getNodeBox(dbId, dst) -- source-verified against the pinned Viewer 7.124.2 bundle
  // (ObjectTree.prototype.getNodeBox / InstanceTreeAccess.prototype.getNodeBox) -- writes a FLAT
  // 6-number array into `dst` (min-x,min-y,min-z,max-x,max-y,max-z), never a THREE.Box3 directly.
  // This corrects Task 7's own recorded finding 6, which assumed the latter shape; passing a
  // THREE.Box3 straight through as `dst` would silently set numeric-string properties '0'..'5' on
  // it and never touch its real .min/.max, making every union below a silent no-op. `Float32Array`
  // matches getNodeBox's own documented @param type exactly; THREE.Box3#setFromArray(array, offset)
  // is the public conversion API (Autodesk.Viewing.Math.Box3#setFromArray) back into a Box3.
  _computeMarkerRadius(dbIdsByModel = new Map(), minRadius = MIN_MARKER_RADIUS, maxRadius = MAX_MARKER_RADIUS) {
    const THREE = window.THREE;
    const box = new THREE.Box3();
    const rawNodeBox = new Float32Array(6);
    const nodeBox = new THREE.Box3();
    for (const [model, dbIdSet] of dbIdsByModel) {
      const instanceTree = model.getInstanceTree();
      // [Batch 2 whole-batch review Finding 4 fix] model.getInstanceTree() returns undefined until
      // that model's object tree has loaded (or for a model whose object tree failed to load) --
      // this is the ONLY getInstanceTree() call in this repo, so a findClashes call can fully succeed
      // while getInstanceTree() is still falsy on some model. Skip that model's dbIds defensively
      // (this is a normal, expected condition -- not an error -- so no console noise): the marker
      // radius still computes from whatever OTHER models/dbIds are present, or falls back to
      // MIN_MARKER_RADIUS below if this was the only one.
      if (!instanceTree) continue;
      for (const dbId of dbIdSet) {
        instanceTree.getNodeBox(dbId, rawNodeBox);
        nodeBox.setFromArray(rawNodeBox, 0);
        box.union(nodeBox);
      }
    }
    // An empty box (no dbIds passed, or every dbId's own box came back empty) has no meaningful
    // bounds to derive a fraction of. getBoundingSphere on an untouched Box3 (min=+Infinity,
    // max=-Infinity) computes an Infinity-magnitude radius that Math.min/Math.max below would
    // silently clamp down to maxRadius -- indistinguishable from a genuinely huge model.
    // minRadius is the more honest fallback here: smallest marker, not a building-sized guess.
    if (box.isEmpty()) return minRadius;
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    // [Batch 2 whole-batch review Finding 4 fix] A dbId not tracked in a model's nodeBoxes (a
    // stale/inconsistent InstanceTree) can make getNodeBox write NaNs into rawNodeBox. NaN poisons
    // min/max such that box.isEmpty() above returns false (every NaN comparison is false, so neither
    // `max.x < min.x` etc. is ever true) -- the empty-box guard does NOT catch this case, so it needs
    // its own explicit check here: a non-finite sphere.radius falls back to the same honest
    // minRadius rather than propagating NaN into the marker's scale.
    if (!Number.isFinite(sphere.radius)) return minRadius;
    const raw = sphere.radius * MARKER_RADIUS_FRACTION;
    return Math.min(Math.max(raw, minRadius), maxRadius);
  }

  // One THREE.Mesh per witness-bearing ClashPair, all sharing the one geometry/material pair from
  // _ensureMarkerOverlay. If EVERY pair's witness is null, this returns before ever calling
  // _ensureMarkerOverlay -- the overlay scene itself must stay unregistered, not merely empty, so a
  // Clash Finder query with no witnesses at all leaves no overlay trace whatsoever. `dbIdsByModel`
  // defaults to an empty Map (see _computeMarkerRadius's own empty-box fallback) so a caller that
  // omits it still gets correctly-clamped (if minimally-sized) markers rather than a thrown error.
  // Task 9 wires the real call site, which already has `dbIdsByModel` in scope in onContextMenu.
  _addMarkers(pairs, dbIdsByModel = new Map()) {
    const THREE = window.THREE;
    const witnessBearing = pairs.filter((pair) => pair.witness);
    if (witnessBearing.length === 0) return;
    this._ensureMarkerOverlay();
    const radius = this._computeMarkerRadius(dbIdsByModel);
    for (const pair of witnessBearing) {
      const mesh = new THREE.Mesh(this._markerGeometry, this._markerMaterial);
      // [Batch 2 whole-batch review Finding 2 fix] `setScalar` does not exist anywhere in the pinned
      // Viewer 7.124.2 bundle's THREE (r71) -- `grep -c setScalar viewer3D.js` -> 0. The real
      // `window.THREE.Vector3` here is LmvVector3 (viewer3D.js:199820); its prototype has `set`
      // (viewer3D.js:144243) but no `setScalar` (added to upstream three.js only after r71). Using
      // `.set(radius, radius, radius)` here also matches the `mesh.position.set(...)` call two lines
      // below it, rather than mixing two different vector-mutation styles for no reason.
      mesh.scale.set(radius, radius, radius);
      mesh.position.set(pair.witness.point[0], pair.witness.point[1], pair.witness.point[2]);
      mesh.updateMatrixWorld(true);
      // [Batch 2 whole-batch review Finding 1 fix] The real viewer.overlays.addMesh/removeMesh
      // signature is mesh FIRST, scene name SECOND (viewer3D.js:20650 `addMesh(mesh, sceneName) {`,
      // whose own JSDoc example is `addMesh([mesh], 'my_scene')`; node_modules/@types/forge-viewer/
      // index.d.ts:1470 agrees). The old (name, mesh) call order here failed SILENTLY in production:
      // addMesh's own guard stringifies the swapped Mesh-as-sceneName to "[object Object]", the scene
      // lookup fails, and it returns false with no throw/console output -- every marker was silently
      // dropped while _activeMarkers still filled up, making internal state look correct while
      // nothing rendered.
      this._viewer.overlays.addMesh(mesh, MARKER_OVERLAY_NAME);
      this._activeMarkers.push(mesh);
    }
  }

  // Removes every currently-active marker mesh from the overlay scene one at a time (removeMesh,
  // not clearScene -- this always happens to remove every mesh in the scene today, but staying
  // symmetric with _activeMarkers being an ordered list of individual meshes rather than treating
  // this as a blanket "wipe the whole scene" operation). Does NOT dispose the shared geometry/
  // material, and does NOT call removeScene -- both outlive individual clear/re-add cycles across
  // repeated Find Clashes queries; only unload-time teardown (a later task) owns disposing them,
  // per Task 7 finding 5's gotcha (removeScene/clearScene never dispose materials).
  _clearMarkers() {
    for (const mesh of this._activeMarkers) {
      // [Batch 2 whole-batch review Finding 1 fix] Same mesh-first, scene-name-second argument order
      // as addMesh above (viewer3D.js:20670 `removeMesh(mesh, sceneName) {`) -- the old (name, mesh)
      // order here was the same silent-failure bug: removeMesh's own guard would stringify the
      // swapped mesh-as-sceneName, fail its scene lookup, and return false with no error, leaving
      // stale meshes never actually removed from the real overlay scene.
      this._viewer.overlays.removeMesh(mesh, MARKER_OVERLAY_NAME);
    }
    this._activeMarkers.length = 0;
  }

  // Task 15 (M3 Batch 3): lazily creates the shared SphereGeometry/MeshBasicMaterial/
  // LineBasicMaterial trio (Global Constraint: no per-marker/per-line geometry or material
  // duplication -- every Soft Clash mesh/line this extension ever creates reuses these same
  // objects, EXCEPT each pair's own connecting-line BufferGeometry, which is inherently per-pair
  // since it encodes that pair's own two endpoint positions) and the overlay scene itself, both on
  // first use -- same lazy-creation discipline as _ensureMarkerOverlay, but its OWN separate scene
  // name/objects, never shared with Hard Clash's. `hasScene` is checked before calling `addScene`
  // for the same reason _ensureMarkerOverlay checks it (Task 7 finding 1).
  _ensureSoftClashOverlay() {
    const THREE = window.THREE; // Viewer's own r71 global -- never import 'three' in this file.
    if (!this._softClashGeometry) {
      this._softClashGeometry = new THREE.SphereGeometry(1, 12, 8); // unit sphere — scaled per-instance below
      this._softClashMaterial = new THREE.MeshBasicMaterial({
        color: SOFT_CLASH_COLOR,
        transparent: true,
        opacity: 0.65,
        // Same depthTest/depthWrite rationale as Hard Clash's own _ensureMarkerOverlay above.
        depthTest: false,
        depthWrite: false,
      });
      this._softClashLineMaterial = new THREE.LineBasicMaterial({
        color: SOFT_CLASH_COLOR,
        transparent: true,
        opacity: 0.65,
        depthTest: false,
      });
    }
    if (!this._viewer.overlays.hasScene(SOFT_CLASH_OVERLAY_NAME)) {
      this._viewer.overlays.addScene(SOFT_CLASH_OVERLAY_NAME);
    }
  }

  // Task 15 (M3 Batch 3): renders TWO endpoint marker spheres (one at pair.witness.sourcePoint, one
  // at pair.witness.targetPoint) plus ONE connecting THREE.Line per witness-bearing clearance pair
  // -- new visual code, not a drop-in reuse of Hard Clash's own single-sphere-per-pair _addMarkers
  // (the M2.1 inventory confirmed that method renders exactly one sphere at a single
  // witness.point). A pair without a witness is skipped: per the clearance query's own documented
  // contract, a clearance pair is only ever emitted with a real witness, but this guard keeps the
  // method defensively correct if that ever changes. `dbIdsByModel` defaults to an empty Map,
  // matching `_addMarkers`'s own default -- see `_computeMarkerRadius`'s own empty-box fallback.
  _addSoftClashVisualization(pairs, dbIdsByModel = new Map()) {
    const THREE = window.THREE;
    this._ensureSoftClashOverlay();
    const radius = this._computeMarkerRadius(dbIdsByModel, SOFT_CLASH_MIN_MARKER_RADIUS, SOFT_CLASH_MAX_MARKER_RADIUS);
    for (const pair of pairs) {
      if (!pair.witness) continue; // per spec, a clearance pair is only ever emitted with a real witness
      const sourceMesh = new THREE.Mesh(this._softClashGeometry, this._softClashMaterial);
      sourceMesh.scale.set(radius, radius, radius);
      sourceMesh.position.set(...pair.witness.sourcePoint);
      this._viewer.overlays.addMesh(sourceMesh, SOFT_CLASH_OVERLAY_NAME);
      this._activeSoftClashObjects.push(sourceMesh);

      const targetMesh = new THREE.Mesh(this._softClashGeometry, this._softClashMaterial);
      targetMesh.scale.set(radius, radius, radius);
      targetMesh.position.set(...pair.witness.targetPoint);
      this._viewer.overlays.addMesh(targetMesh, SOFT_CLASH_OVERLAY_NAME);
      this._activeSoftClashObjects.push(targetMesh);

      // Per-pair BufferGeometry (encodes this pair's own two endpoint positions) -- unlike
      // _softClashGeometry/_softClashMaterial/_softClashLineMaterial above, this is NOT shared
      // across pairs, and is disposed per-object in _clearSoftClashVisualization below.
      const lineGeometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(...pair.witness.sourcePoint), new THREE.Vector3(...pair.witness.targetPoint),
      ]);
      const line = new THREE.Line(lineGeometry, this._softClashLineMaterial);
      this._viewer.overlays.addMesh(line, SOFT_CLASH_OVERLAY_NAME);
      this._activeSoftClashObjects.push(line);
    }
  }

  // Removes every currently-active Soft Clash mesh/line from the overlay scene one at a time
  // (removeMesh, not clearScene -- same rationale as _clearMarkers above), and disposes each
  // object's own per-pair line BufferGeometry (the ONLY per-object geometry this extension ever
  // creates for Soft Clash -- the shared sphere geometry, by contrast, outlives this call, exactly
  // like _clearMarkers leaves _markerGeometry/_markerMaterial alone). Does NOT dispose
  // _softClashGeometry/_softClashMaterial/_softClashLineMaterial or call removeScene -- those
  // outlive individual clear/re-add cycles across repeated Find Soft Clashes queries, matching
  // _clearMarkers's own documented teardown-ownership split (Task 7 finding 5).
  _clearSoftClashVisualization() {
    for (const obj of this._activeSoftClashObjects) {
      this._viewer.overlays.removeMesh(obj, SOFT_CLASH_OVERLAY_NAME);
      if (obj.geometry && obj.geometry !== this._softClashGeometry) obj.geometry.dispose(); // per-pair line geometry
    }
    this._activeSoftClashObjects = [];
  }

  // Spec 11.2, verbatim rule: the "Find Clashes" entry appears ONLY when viewer.getAggregateSelection()
  // -- never viewer.getSelection(), which returns dbIds with no model provenance -- has EXACTLY one
  // entry whose `selection` array has EXACTLY one dbId. Any other shape (no selection, multiple
  // models, or one model with multiple dbIds) is unsupported in M2 and the entry does not appear;
  // this also directly yields the source's own Model object (entry.model) with no further
  // resolution step, unlike RoomLocatorExtension's own single-model getSelection() shortcut.
  onContextMenu(menu, status) {
    const aggregate = this._viewer.getAggregateSelection();
    if (!aggregate || aggregate.length !== 1) return;
    const entry = aggregate[0];
    if (!entry || !entry.selection || entry.selection.length !== 1) return;
    const sourceModel = entry.model;
    const sourceDbId = entry.selection[0];
    menu.push({
      title: 'Find Clashes',
      target: async () => {
        // Captured BEFORE findClashes ever starts -- the very top of the callback, per the task's
        // own concurrency requirement. Any onContextMenu target() invoked after this one bumps
        // _latestActionToken again, so this call's own captured `token` stops matching once a newer
        // action exists, regardless of resolution order.
        this._latestActionToken += 1;
        const token = this._latestActionToken;
        let result;
        try {
          result = await this._world.findClashes({
            source: { model: sourceModel, dbIds: [sourceDbId] },
            target: {
              // Whole-model scope (dbIds omitted) for EVERY currently loaded model, including the
              // source's own -- CollisionWorld's own source self-exclusion (already implemented
              // internally) is what keeps the source element out of its own results. This extension
              // must NOT pre-filter sourceModel out of this list nor post-filter sourceDbId out of
              // any result set itself -- doing either here would duplicate logic CollisionWorld
              // already owns and risk silently diverging from it.
              targets: this._viewer.getAllModels().map((model) => ({ model })),
            },
            mode: 'volume-overlap', // the fixed, only Hard Clash mode this workflow ever uses
            groupBy: 'dbId',
            // broadPhase intentionally omitted -- let CollisionWorld choose its own default.
          });
        } catch (err) {
          // A newer action already superseded this one: discard silently, no error surfaced for a
          // merely-superseded (not failed) request.
          if (token !== this._latestActionToken) return;
          // [review fix, codex-review Important #2] This IS still the current action -- a genuine
          // failure, not a supersession. Leaving the PRIOR query's isolation on screen here would
          // make it look like this (failed) query's own result. Clear it and surface a visible
          // failure, matching the same _notifyUser channel every other outcome of this workflow uses
          // -- console.error alone is not a surface (see _notifyUser's own rationale above).
          console.error('ClashFinderExtension: find clashes failed', err);
          this._clearIsolation();
          this._clearMarkers(); // Task 9: markers and isolation are always cleared together, never left disagreeing
          this._notifyUser(`Find Clashes failed for element ${sourceDbId}: ${err?.message ?? err}`);
          return;
        }
        // Re-check AFTER findClashes resolves (success path): a newer action may have started and
        // even finished while this one was in flight. Discard this now-stale result completely --
        // no isolate/fitToView/notify call of any kind.
        if (token !== this._latestActionToken) return;

        // Defensive `?? []`, matching RoomLocatorExtension's own precedent: statistics is part of
        // findClashes's documented result shape, but this value is fed straight into a `.length`
        // check below, and a caveat mechanism that itself throws would be worse than the silence it
        // exists to replace.
        const diagnostics = result.statistics?.diagnostics ?? [];
        // Task 9 (M2.1) diagnostics partition: CollisionWorld.findClashes emits a
        // {scope:'pair', reason:'witness-unavailable'} diagnostic whenever a volume-overlap pair's
        // clash verdict is completely valid and correct but its witness point (marker location)
        // simply couldn't be captured. That diagnostic rides the SAME statistics.diagnostics channel
        // as every genuine completeness signal (e.g. 'bucket-capacity', a real
        // "the pair/boolean result itself may be incomplete" warning) -- so a naive
        // `diagnostics.length > 0` check would incorrectly tell the user "the result may be
        // incomplete" for a fully complete, correctly-evaluated clash result that merely lacks ONE
        // marker. That directly contradicts the Global Constraint that a clash is never
        // suppressed/downgraded on account of witness/marker capture failing. Partition into two
        // buckets: `completenessAffecting` (everything else) alone drives the caveat text below;
        // `witness-unavailable` entries are presentation-only (no marker drawn for that one pair --
        // already visually self-evident, no marker at that location) and must never contribute to it.
        // [Task 9 review fix, codex-advisor] Matches BOTH scope:'pair' AND reason:'witness-unavailable'
        // -- the full shape CollisionWorld.js's sole production emitter actually produces -- rather
        // than reason alone, so a hypothetical future (or malformed) diagnostic that reuses the same
        // reason string under a different scope is never silently swallowed into the presentation-only
        // bucket it wasn't shown to belong to.
        const completenessAffecting = diagnostics.filter((d) => !(d?.scope === 'pair' && d?.reason === 'witness-unavailable'));
        // The caveat is surfaced on BOTH outcomes below, not only the empty one -- a non-empty
        // result can also be incomplete (one real clash found, another skipped), and the user acting
        // on a partial isolate deserves to know that as much as the user told "no clashes found"
        // does. This mirrors RoomLocatorExtension's own onContextMenu handling exactly.
        const caveat = completenessAffecting.length > 0
          ? ` The result may be incomplete — ${ClashFinderExtension.describeDiagnostics(completenessAffecting)}.`
          : '';
        if (diagnostics.length > 0) {
          // Unpartitioned on purpose: this is a dev-facing console log, not the user-facing caveat --
          // every diagnostic, witness-unavailable included, is still worth a developer's attention.
          console.warn('ClashFinderExtension: findClashes reported diagnostics', diagnostics);
        }

        // Clear whatever this extension isolated/marked on a PRIOR call before applying (or omitting)
        // new isolation/markers -- unconditional, so a "No clashes found" outcome still restores the
        // viewer to an unisolated, marker-free state rather than leaving a stale highlight or marker
        // from an earlier query on screen. Isolation and markers are cleared together, at this one
        // call site, so they can never visually disagree (Global Constraint).
        this._clearIsolation();
        this._clearMarkers();

        const pairs = result.pairs;
        if (pairs.length === 0) {
          // Spec §2 step 11: "UI reports ... 'No clashes found'" is UNCONDITIONAL, part of every
          // Find Clashes invocation -- unlike RoomLocatorExtension's own quieter success path (which
          // stays silent absent diagnostics, isolation alone being feedback enough there), this
          // workflow's own spec requires an explicit report every time. Step 12's diagnostics caveat
          // is ADDITIVE to that report, never a replacement for it, and with diagnostics present this
          // must NOT read as a plain negative: that is the exact silent-incomplete-result the spec
          // forbids.
          console.warn('ClashFinderExtension: no clashes found for dbId', sourceDbId);
          this._notifyUser(`No clashes found.${caveat}`);
          return;
        }

        // Group every involved dbId by its own Model OBJECT (never modelId -- modelId is documented
        // as reused-under-collision-prone and non-load-bearing) so isolate/fitToView can be called
        // once per involved Model with that Model's own dbIds, always passing `model` explicitly
        // (Critical #4: RoomLocatorExtension's own single-model omission of the `model` arg does
        // NOT carry over here -- this extension is federated by design).
        const dbIdsByModel = new Map();
        const addDbId = (model, dbId) => {
          if (!dbIdsByModel.has(model)) dbIdsByModel.set(model, new Set());
          dbIdsByModel.get(model).add(dbId);
        };
        // The source element itself is isolated alongside every clashing element found (Clash
        // Finder's own equivalent of Room Locator's "isolate what was found, source included
        // implicitly via room selection" spirit).
        addDbId(sourceModel, sourceDbId);

        let sameModelCount = 0, crossModelCount = 0;
        for (const pair of pairs) {
          addDbId(pair.source.model, pair.source.dbId);
          addDbId(pair.target.model, pair.target.dbId);
          // Same-model vs. cross-model classification, by strict object identity (===), never
          // modelId. The source operand's dbIds is always a singleton (this extension only ever
          // queries one source element), so pair.target is always the "other" element for every
          // pair this call can produce -- comparing pair.target.model against sourceModel is
          // therefore sufficient and matches the spec's own worked example exactly.
          if (pair.target.model === sourceModel) sameModelCount += 1;
          else crossModelCount += 1;
        }

        for (const [model, dbIdSet] of dbIdsByModel) {
          const dbIds = [...dbIdSet];
          this._viewer.isolate(dbIds, model);
          this._viewer.fitToView(dbIds, model);
          this._isolatedModels.add(model);
        }

        // Task 9 (M2.1): apply new markers alongside the new isolation just applied above, using the
        // SAME dbIdsByModel (radius derives from the combined bounding sphere of everything just
        // isolated). `pairs` -- not `witnessBearing` -- is passed straight through; _addMarkers itself
        // owns filtering to witness-bearing pairs (a pair whose witness is null, e.g. from a
        // witness-unavailable diagnostic above, contributes no marker but is still isolated normally).
        this._addMarkers(pairs, dbIdsByModel);

        // Spec §2 step 11: this report is UNCONDITIONAL, every successful call -- not gated on
        // diagnostics (contrast RoomLocatorExtension's own silent-on-clean-success convention).
        const summary = `${pairs.length} clashes found (${sameModelCount} in this model, ${crossModelCount} in other models)`;
        this._notifyUser(`${summary}${caveat}`);
      },
    });

    // Task 14 (M3 Batch 3): "Find Soft Clashes", a SECOND, independent context-menu entry -- same
    // aggregate-selection gate above, same sourceModel/sourceDbId already resolved for "Find
    // Clashes". Mirrors that entry's own shape (token capture, try/catch, diagnostics partition,
    // clear/isolate/fitToView/notify) but against findClashes({mode:'clearance', clearance:
    // this._clearance}) instead, and using its OWN `_latestSoftClashActionToken` -- Global Constraint
    // (binding): Hard Clash and Soft Clash use SEPARATE, INDEPENDENT action tokens, so firing one
    // must never cancel or be affected by an in-flight run of the other. This code path must never
    // read or write `_latestActionToken` (Hard Clash's own), and the "Find Clashes" entry above must
    // never read or write `_latestSoftClashActionToken`.
    menu.push({
      title: 'Find Soft Clashes',
      target: async () => {
        // Captured BEFORE findClashes ever starts, exactly like "Find Clashes" above -- but against
        // this action's OWN token, so a later "Find Clashes" invocation can never supersede this one
        // (and vice versa).
        this._latestSoftClashActionToken += 1;
        const token = this._latestSoftClashActionToken;
        let result;
        try {
          result = await this._world.findClashes({
            source: { model: sourceModel, dbIds: [sourceDbId] },
            target: {
              // Same whole-model, source-not-filtered-out scope as "Find Clashes" -- see that
              // entry's own comment above for why this extension must never pre/post-filter the
              // source element itself.
              targets: this._viewer.getAllModels().map((model) => ({ model })),
            },
            mode: 'clearance', // the fixed mode this "Find Soft Clashes" workflow always uses
            clearance: this._clearance, // resolved once, in load(), from options.defaultClearance
            groupBy: 'dbId',
          });
        } catch (err) {
          // A newer Soft Clash action already superseded this one: discard silently -- being
          // superseded by ANOTHER Soft Clash action is not a failure. (A Hard Clash action running
          // in between never affects `_latestSoftClashActionToken` at all, so it cannot supersede
          // this check either way.)
          if (token !== this._latestSoftClashActionToken) return;
          // A genuine failure, not a supersession: clear the prior query's isolation/visualization
          // and surface it visibly, mirroring "Find Clashes"'s own genuine-failure handling exactly.
          console.error('ClashFinderExtension: find soft clashes failed', err);
          this._clearIsolation();
          this._clearSoftClashVisualization();
          this._notifyUser(`Find Soft Clashes failed for element ${sourceDbId}: ${err?.message ?? err}`);
          return;
        }
        // Re-check AFTER findClashes resolves (success path), same discipline as "Find Clashes".
        if (token !== this._latestSoftClashActionToken) return;

        // Same diagnostics partition as "Find Clashes" -- `witness-unavailable` is presentation-only
        // (no visualization drawn for that one pair) and must never contribute to the user-facing
        // completeness caveat, even though it is still worth a developer's attention below.
        const diagnostics = result.statistics?.diagnostics ?? [];
        const completenessAffecting = diagnostics.filter((d) => !(d?.scope === 'pair' && d?.reason === 'witness-unavailable'));
        const caveat = completenessAffecting.length > 0
          ? ` The result may be incomplete — ${ClashFinderExtension.describeDiagnostics(completenessAffecting)}.`
          : '';
        if (diagnostics.length > 0) {
          console.warn('ClashFinderExtension: findClashes (soft clash) reported diagnostics', diagnostics);
        }

        // Isolation is shared visual state (not overlay-specific) -- reuse _clearIsolation()/isolate/
        // fitToView exactly as "Find Clashes" does. Only the visualization call differs.
        this._clearIsolation();
        this._clearSoftClashVisualization();

        const pairs = result.pairs;
        if (pairs.length === 0) {
          // Spec §2 step 11's "UI reports ... 'No clashes found'" applies identically here --
          // unconditional on every Find Soft Clashes invocation, not just Find Clashes.
          console.warn('ClashFinderExtension: no soft clashes found for dbId', sourceDbId);
          this._notifyUser(`No clashes found.${caveat}`);
          return;
        }

        // Same per-Model-object grouping as "Find Clashes" -- never modelId, always an explicit
        // `model` arg to isolate/fitToView.
        const dbIdsByModel = new Map();
        const addDbId = (model, dbId) => {
          if (!dbIdsByModel.has(model)) dbIdsByModel.set(model, new Set());
          dbIdsByModel.get(model).add(dbId);
        };
        addDbId(sourceModel, sourceDbId);

        let sameModelCount = 0, crossModelCount = 0;
        for (const pair of pairs) {
          addDbId(pair.source.model, pair.source.dbId);
          addDbId(pair.target.model, pair.target.dbId);
          if (pair.target.model === sourceModel) sameModelCount += 1;
          else crossModelCount += 1;
        }

        for (const [model, dbIdSet] of dbIdsByModel) {
          const dbIds = [...dbIdSet];
          this._viewer.isolate(dbIds, model);
          this._viewer.fitToView(dbIds, model);
          this._isolatedModels.add(model);
        }

        // Task 15 fills in real overlay geometry here; for now this call site is wired and tracks
        // the pairs it was given (see _addSoftClashVisualization's own comment above).
        this._addSoftClashVisualization(pairs, dbIdsByModel);

        const summary = `${pairs.length} clashes found (${sameModelCount} in this model, ${crossModelCount} in other models)`;
        this._notifyUser(`${summary}${caveat}`);
      },
    });
  }
}
