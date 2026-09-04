// wwwroot/extensions/RoomLocatorExtension.js
//
// A thin CollisionWorld consumer: resolves the current model's "room" dbIds (cached per Model
// object, admit-before-search) and, given a selected element's dbId, uses
// CollisionWorld.findClashes({mode: 'containment'}) to find which room(s) contain it.
//
// Depends ONLY on CollisionWorld's public surface: fromViewer, findClashes, admitModel,
// isLeaseValid, evictModel, isModelLive, dispose. Never reaches into CollisionWorld internals.
// collision/index.js is the library's single public entry point (its own header states consumers
// import from there, never from the individual implementation modules) — CollisionWorld and the
// error classes all come from that one re-export.
import { CollisionWorld, WorldDisposedError, ModelEvictedError } from '../../collision/index.js';

// Exported so wwwroot/viewer.js registers/unregisters under the SAME id this extension uses for its
// context-menu callback — a duplicated string literal could silently drift and break both
// registerExtension matching and unregisterContextMenuCallback.
export const EXTENSION_ID = 'Autodesk.Sandbox.RoomLocator';

// `Autodesk` is a real browser global supplied by viewer3D.js (loaded via a <script> tag before any
// module code runs — see wwwroot/index.html) and is never imported. In a headless Node test process
// (this extension's own unit fixtures — no live Viewer, per this task's scope) that global does not
// exist at all, and `class X extends Autodesk.Viewing.Extension` would throw a ReferenceError at
// MODULE-EVALUATION time (the `extends` heritage clause is evaluated immediately when the class
// declaration runs, not lazily at instantiation). `typeof Autodesk` is the standard safe check for a
// possibly-undeclared global. In the browser this resolves to the real Extension base class and the
// real event-name constant; in Node it falls back to a minimal stand-in with identical behavior for
// what this extension actually uses, so the fixtures can construct and drive a real
// RoomLocatorExtension instance with no Viewer SDK loaded.
const ViewingNS = typeof Autodesk !== 'undefined' ? Autodesk.Viewing : undefined;
const ExtensionBase = ViewingNS?.Extension ?? class {
  constructor(viewer, options) {
    this.viewer = viewer;
    this.options = options;
  }
};
// Verified string value from node_modules/@types/forge-viewer/index.d.ts:324 (see task brief).
const BEFORE_MODEL_UNLOAD_EVENT = ViewingNS?.BEFORE_MODEL_UNLOAD_EVENT ?? 'beforeModelUnload';

export class RoomLocatorExtension extends ExtensionBase {
  constructor(viewer, options = {}) {
    super(viewer, options);
    // Stored explicitly under this class's own underscore-private convention (matching
    // CollisionWorld's own `_viewer` field) rather than relying on whatever the base Extension
    // class does with `this.viewer` — this is also the seam the test fixtures inject/inspect.
    this._viewer = viewer;
    this._roomCategoryName = options.roomCategoryName ?? 'Revit Rooms';
    this._roomCache = new Map(); // Model -> Promise<number[]>
    this._world = null;
    this._currentModel = null;
    this._onBeforeModelUnloadBound = (event) => this._onBeforeModelUnload(event);
    this._onContextMenuBound = (menu, status) => this.onContextMenu(menu, status);
  }

  // Step 1 of Data Flow: load() calls ONLY CollisionWorld.fromViewer, to completion, before
  // returning. No room resolution, no eager BLAS building.
  async load() {
    this._world = await CollisionWorld.fromViewer(this._viewer, this.options);
    // Registered only AFTER fromViewer() resolves, inside this same call — if fromViewer() had
    // rejected, this method's own returned promise already rejected with that same error before
    // either registration below ran.
    this._viewer.addEventListener(BEFORE_MODEL_UNLOAD_EVENT, this._onBeforeModelUnloadBound);
    this._viewer.registerContextMenuCallback(EXTENSION_ID, this._onContextMenuBound);
    // Best-effort snapshot only. In this app's real flow (wwwroot/main.js) the Viewer is constructed
    // and its extensions loaded BEFORE any model is loaded, so `this._viewer.model` is normally still
    // undefined here and this leaves `_currentModel` null. locateElementByRoom therefore resolves the
    // model at ACTION time rather than trusting this snapshot.
    this._currentModel = this._viewer.model ?? this._currentModel;
    return true;
  }

  // unload() ordering is deliberate and spec-documented as imperfect-but-accepted: dispose() first,
  // THEN listener/menu removal, THEN cache clear. A repeated unload() call re-throws
  // WorldDisposedError from the second dispose() before steps 2/3 run, stranding listener/menu
  // removal and the cache clear for that invocation — accepted because Viewer3D.tearDown wraps each
  // extension's own unload() in try/catch, so the throw is swallowed rather than propagating. This is
  // NOT silently "fixed" here beyond what the spec specifies; per-step isolation remains open/unsettled
  // per the spec.
  unload() {
    this._world.dispose();
    this._viewer.removeEventListener(BEFORE_MODEL_UNLOAD_EVENT, this._onBeforeModelUnloadBound);
    this._viewer.unregisterContextMenuCallback(EXTENSION_ID);
    this._roomCache.clear();
    return true;
  }

  // world.evictModel(event.model) — the exact object — AND drop that object's room-cache entry,
  // unconditionally and independent of evictModel (world.dispose() never touches the extension-owned
  // room cache). Typings declare `event: any`. Defensively verify `event.model` exists rather than
  // let a missing field surface as a cryptic downstream TypeError.
  _onBeforeModelUnload(event) {
    if (!event || !event.model) {
      throw new Error('RoomLocatorExtension: BEFORE_MODEL_UNLOAD_EVENT fired with no event.model — typings declare `event: any`; this handler cannot proceed without the model object.');
    }
    this._world.evictModel(event.model);
    this._roomCache.delete(event.model);
  }

  // Correct mechanism: admit the model BEFORE starting the search, so success/error callbacks always
  // validate a real lease rather than ambiguous "never seen" state.
  //
  // The resolve/reject pair is captured via the executor and the promise is cached BEFORE
  // model.search is invoked (deliberately NOT nesting the model.search call inside the Promise
  // executor itself) — a real Viewer's Model.search always calls back asynchronously, but this
  // extension's own unit fixtures deliberately invoke onSuccess/onError SYNCHRONOUSLY to exercise
  // the identity-guard logic directly. Calling model.search only after `thisPromise` is fully
  // constructed and cached avoids both a self-referential TDZ read of `thisPromise` and a window
  // where a synchronous callback would race the cache.set() below.
  async _resolveRoomDbIds(model) {
    if (this._roomCache.has(model)) return this._roomCache.get(model);
    const lease = this._world.admitModel(model); // throws synchronously if tombstoned/disposed
    let resolveFn, rejectFn;
    const thisPromise = new Promise((resolve, reject) => { resolveFn = resolve; rejectFn = reject; });
    this._roomCache.set(model, thisPromise);

    const settle = (fn, ...args) => {
      if (this._roomCache.get(model) === thisPromise) this._roomCache.delete(model); // unconditional, identity-guarded
      fn(...args);
    };
    const mapRejection = () => {
      if (!this._world.isLeaseValid(lease)) {
        try {
          this._world.isModelLive(model);
        } catch (err) {
          if (err instanceof WorldDisposedError) return err;
        }
        return new ModelEvictedError(model.id);
      }
      return null;
    };
    try {
      model.search(
        this._roomCategoryName,
        (dbIds) => {
          const rejection = mapRejection();
          if (rejection) { settle(rejectFn, rejection); return; }
          if (this._roomCache.get(model) === thisPromise) resolveFn(dbIds);
          else rejectFn(new ModelEvictedError(model.id)); // superseded by a fresher call for this model
        },
        (searchError) => {
          const rejection = mapRejection();
          settle(rejectFn, rejection ?? searchError);
        },
        ['Category'],
        { searchHidden: true },
      );
    } catch (searchError) {
      // model.search threw SYNCHRONOUSLY (e.g. "property database not loaded"). `thisPromise` is
      // already in the cache but no callback will ever settle it, so without this it would stay
      // permanently pending and every later call for this model would hit the cache-hit fast path and
      // hang forever. Settle it through the same identity-guarded `settle` helper the callbacks use,
      // so a pathological `search` that throws AND later calls back cannot double-settle the cache
      // slot. Returning the (now rejected) `thisPromise` rather than rethrowing gives the immediate
      // caller the same error while keeping this promise handled (no unhandled-rejection noise).
      settle(rejectFn, searchError);
      return thisPromise;
    }
    return thisPromise;
  }

  // Resolve the model at ACTION time. load() runs before any model exists in this app's real flow, so
  // a load()-time snapshot is null forever; `_currentModel` is kept only as a fallback for callers/
  // fixtures that set it explicitly.
  //
  // Unchanged public shape: `Promise<number[]>`. Callers that also need to know whether the answer
  // was COMPLETE use locateElementByRoomDetailed below.
  async locateElementByRoom(dbId) {
    const { roomDbIds } = await this.locateElementByRoomDetailed(dbId);
    return roomDbIds;
  }

  /**
   * The same query as locateElementByRoom, returning the clash statistics' diagnostics alongside the
   * room dbIds: `{ roomDbIds: number[], diagnostics: Array<Object> }`.
   *
   * This exists because a non-empty `statistics.diagnostics` means the answer may be INCOMPLETE — a
   * skipped fragment (oversized/unparseable/not-yet-loaded geometry) or an aborted, budget-exhausted
   * traversal — and an empty `roomDbIds` in that situation is emphatically NOT the same statement as
   * "this element is in no room". The spec requires the extension to surface a visible caveat rather
   * than silently report "no room found" whenever this array is non-empty (spec :3889-3891), which
   * locateElementByRoom's bare `number[]` cannot express at all.
   */
  async locateElementByRoomDetailed(dbId) {
    const model = this._viewer?.model ?? this._currentModel;
    if (!model) {
      throw new Error('RoomLocatorExtension: no model is loaded — locateElementByRoom needs a model on the viewer (viewer.model) or a previously cached one.');
    }
    this._currentModel = model;
    const roomDbIds = await this._resolveRoomDbIds(model);
    const result = await this._world.findClashes({
      source: { model, dbIds: [dbId] },
      target: { model, dbIds: roomDbIds },
      mode: 'containment',
      groupBy: 'dbId',
    });
    return {
      roomDbIds: result.pairs.map((pair) => pair.target.dbId),
      // Defensive `?? []`: `statistics` is part of findClashes's documented result shape, but this
      // value is fed straight to a `.length` check and a `.map` below, and a caveat mechanism that
      // itself throws would be worse than the silence it exists to replace.
      diagnostics: result.statistics?.diagnostics ?? [],
    };
  }

  // The one user-visible caveat channel this app has. wwwroot/viewer.js's own getAccessToken error
  // path already establishes `alert(...)` as this sandbox's convention for "the user must see this"
  // (there is no toast/notification framework here), with the detail going to the console alongside
  // it. console.warn alone is NOT a surface: it is exactly the silence the spec's caveat requirement
  // is written against. The typeof guard is for this extension's own headless Node fixtures, where
  // no `alert` global exists.
  _notifyUser(message) {
    if (typeof alert === 'function') alert(message);
    else console.warn(message);
  }

  // "3 diagnostic(s): geometry-too-large-for-sync-build, crossing-budget-exhausted" — informative
  // about WHAT was incomplete without enumerating every entry (a big query can produce many).
  static describeDiagnostics(diagnostics) {
    const reasons = [...new Set(diagnostics.map((d) => d?.reason ?? 'unknown'))];
    return `${diagnostics.length} diagnostic(s): ${reasons.join(', ')}`;
  }

  onContextMenu(menu, status) {
    if (!status.hasSelected) return;
    const selection = this._viewer.getSelection();
    if (!selection || selection.length === 0) return;
    const dbId = selection[0];
    menu.push({
      title: 'Locate Room',
      target: async () => {
        try {
          const { roomDbIds, diagnostics } = await this.locateElementByRoomDetailed(dbId);
          // The caveat is surfaced on BOTH outcomes, not only the empty one: a non-empty result can
          // also be incomplete (one room found, another skipped), and the user acting on a partial
          // isolate deserves to know that as much as the user told "no room found" does.
          const caveat = diagnostics.length > 0
            ? ` The result may be incomplete — ${RoomLocatorExtension.describeDiagnostics(diagnostics)}.`
            : '';
          if (diagnostics.length > 0) {
            console.warn('RoomLocatorExtension: findClashes reported diagnostics', diagnostics);
          }
          if (roomDbIds.length === 0) {
            // "No candidate rooms" contract — surface, do not throw. With diagnostics present this
            // must NOT read as a plain "no room found": that is the exact silent-negative the spec
            // forbids (:3889-3891).
            console.warn('RoomLocatorExtension: no containing room found for dbId', dbId);
            if (caveat) this._notifyUser(`No containing room was found for element ${dbId}.${caveat}`);
            return;
          }
          this._viewer.isolate(roomDbIds);
          this._viewer.fitToView(roomDbIds);
          if (caveat) this._notifyUser(`Located ${roomDbIds.length} room(s) for element ${dbId}.${caveat}`);
        } catch (err) {
          console.error('RoomLocatorExtension: locate failed', err);
        }
      },
    });
  }
}
