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

export class ClashFinderExtension extends ExtensionBase {
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
    this._onBeforeModelUnloadBound = (event) => this._onBeforeModelUnload(event);
    this._onContextMenuBound = (menu, status) => this.onContextMenu(menu, status);
  }

  // Same ordering discipline as RoomLocatorExtension.load(): CollisionWorld.fromViewer runs to
  // completion FIRST; the listener/menu-callback registrations only happen after that promise
  // resolves, inside this same call. If fromViewer() had rejected, load()'s own returned promise
  // already rejected with that same error before either registration below ran.
  async load() {
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
  unload() {
    this._latestActionToken += 1;
    try {
      this._world.dispose();
    } finally {
      this._viewer.removeEventListener(BEFORE_MODEL_UNLOAD_EVENT, this._onBeforeModelUnloadBound);
      this._viewer.unregisterContextMenuCallback(EXTENSION_ID);
    }
    this._clearIsolation();
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
    this._world.evictModel(event.model);
    this._isolatedModels.delete(event.model);
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
        // The caveat is surfaced on BOTH outcomes below, not only the empty one -- a non-empty
        // result can also be incomplete (one real clash found, another skipped), and the user acting
        // on a partial isolate deserves to know that as much as the user told "no clashes found"
        // does. This mirrors RoomLocatorExtension's own onContextMenu handling exactly.
        const caveat = diagnostics.length > 0
          ? ` The result may be incomplete — ${ClashFinderExtension.describeDiagnostics(diagnostics)}.`
          : '';
        if (diagnostics.length > 0) {
          console.warn('ClashFinderExtension: findClashes reported diagnostics', diagnostics);
        }

        // Clear whatever this extension isolated on a PRIOR call before applying (or omitting) new
        // isolation -- unconditional, so a "No clashes found" outcome still restores the viewer to
        // an unisolated state rather than leaving a stale highlight on screen.
        this._clearIsolation();

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

        // Spec §2 step 11: this report is UNCONDITIONAL, every successful call -- not gated on
        // diagnostics (contrast RoomLocatorExtension's own silent-on-clean-success convention).
        const summary = `${pairs.length} clashes found (${sameModelCount} in this model, ${crossModelCount} in other models)`;
        this._notifyUser(`${summary}${caveat}`);
      },
    });
  }
}
