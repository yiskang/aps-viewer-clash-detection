// test/performance/browser-probes-m4.mjs -- plain script, NOT an ES module (see
// browser-probes.mjs's own header for why: Playwright's addScriptTag({ path }) inlines this
// file's text as an inline <script> against the live page, and a same-repo relative `import`
// inside that inlined text would resolve against the PAGE's URL, not the local filesystem).
//
// M4 Task 3.2's live half: the rAF cadence recorder (frame-production observation) and the
// trusted-input-probe correlation registry (input-responsiveness observation) that
// run-gate-m4.mjs's CDP dispatch loop drives. Mirrors browser-probes.mjs's IIFE /
// window.__perfProbes shape, under its own window.__m4Probes namespace.
(function () {
  if (typeof window === 'undefined') return;
  window.__m4Probes = window.__m4Probes ?? {};

  window.__m4Probes.startRafRecorder = function () {
    const state = { frames: [], lastTs: null, running: true };
    function tick(ts) {
      if (!state.running) return;
      if (state.lastTs !== null) state.frames.push(ts - state.lastTs);
      state.lastTs = ts;
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
    return {
      stop() { state.running = false; return state.frames.slice(); },
    };
  };

  // Correlation registry for CDP-dispatched mousemove probes: each dispatch's unique coordinate
  // is looked up here by the in-page handler, so a coordinate that never appears was coalesced
  // away (§6.2's coalescing-detection rule).
  //
  // installInputProbeListener EXPLICITLY stores the registry under a fresh handle in
  // window.__m4Probes.registries (a page-global is the only option across the page.evaluate
  // boundary, since the live Map must keep receiving mousemove events between separate Node
  // round trips) and returns ONLY the handle string to Node -- never the live Map itself, which
  // would just be a dead structured-clone snapshot the instant it crosses the boundary. Every
  // later read goes through getInputProbeRegistry(handle); every later cleanup goes through
  // disposeInputProbeRegistry(handle). No code anywhere reads an undocumented global.
  window.__m4Probes.registries = window.__m4Probes.registries ?? new Map();
  let __m4RegistrySeq = 0;

  window.__m4Probes.installInputProbeListener = function (canvasEl) {
    const handledAt = new Map(); // "x,y" -> performance.now()
    const listener = (ev) => { handledAt.set(`${ev.clientX},${ev.clientY}`, performance.now()); };
    canvasEl.addEventListener('mousemove', listener);
    const handle = `input-probe-registry-${++__m4RegistrySeq}`;
    window.__m4Probes.registries.set(handle, { handledAt, canvasEl, listener });
    return handle;
  };

  window.__m4Probes.getInputProbeRegistry = function (handle) {
    const registry = window.__m4Probes.registries.get(handle);
    if (!registry) throw new Error(`getInputProbeRegistry: no registry installed for handle "${handle}"`);
    return registry;
  };

  // Removes the mousemove listener and drops the registry entry. Idempotent -- disposing an
  // already-disposed (or never-installed) handle is a no-op, so callers can always dispose
  // unconditionally in a `finally` without an extra existence check.
  window.__m4Probes.disposeInputProbeRegistry = function (handle) {
    const registry = window.__m4Probes.registries.get(handle);
    if (!registry) return;
    registry.canvasEl.removeEventListener('mousemove', registry.listener);
    window.__m4Probes.registries.delete(handle);
  };

  // M4 Task 3.3's live half: the §5.4 profiling pass -- unmeasured, run once per gate run to build
  // the low/typical/high density-stratified cohorts task 3.7's matrix scheduler feeds through
  // this task's own pure `selectCohort` (test/performance/m4/cohort-selection.mjs). Touches NO
  // `collision/` code (§5.4's own opening constraint) -- this is a duplicate, standalone
  // depth-first walk matching extractFragments's own shape (collision/viewer/ViewerModelAdapter.js,
  // enumNodeFragments at every visited node + enumNodeChildren to descend, first-discovery-wins).
  // The brief cites "verified-refs.md" for this cross-check; that file is not present anywhere in
  // this repo (an internal spec-authoring artifact, not a checked-in doc), so this task confirmed
  // the shape directly by reading ViewerModelAdapter.js:99-152 on disk -- the stack-based
  // enumNodeFragments-then-enumNodeChildren pattern matches exactly.
  window.__m4Probes.profileStructureCohortDensity = function (models, { proximityThreshold = 0.05 } = {}) {
    const structureModel = models[1];
    const tree = structureModel.getInstanceTree();
    const rootId = tree.getRootId();
    const allWorldBoxes = []; // [{modelIndex, fragId, min, max}] across all 3 models, for proximity scan
    const box = new window.THREE.Box3();
    for (let mi = 0; mi < models.length; mi++) {
      const fragList = models[mi].getFragmentList();
      const count = fragList.getCount();
      for (let f = 0; f < count; f++) {
        if (fragList.isNotLoaded && fragList.isNotLoaded(f)) continue;
        fragList.getWorldBounds(f, box);
        allWorldBoxes.push({ modelIndex: mi, fragId: f, min: box.min.toArray(), max: box.max.toArray() });
      }
    }
    function aabbNear(a, b, threshold) {
      for (let i = 0; i < 3; i++) {
        const gap = Math.max(a.min[i] - b.max[i], b.min[i] - a.max[i], 0);
        if (gap > threshold) return false;
      }
      return true;
    }
    function walkFragments(dbId, seen) {
      // Depth-first stack walk, enumNodeFragments at EVERY visited node, enumNodeChildren to
      // descend -- matching extractFragments's own rule (first-discovery-wins).
      //
      // Real, load-bearing bug found running this task's own manual verification: the brief's own
      // excerpt used `(child) => stack.push(child)` (an EXPRESSION-bodied arrow) as the
      // enumNodeChildren callback. Confirmed by reading the live Viewer's actual
      // InstanceTree.prototype.enumNodeChildren source (`.toString()`) against the real fixture:
      // its inner iteration treats ANY truthy callback return value as "stop enumerating
      // siblings" (the exact same explicit-`return true`-to-abort convention already used
      // correctly elsewhere in this codebase, collision/viewer/ViewerModelAdapter.js's own
      // extractFragments). `Array.prototype.push` returns the array's new length -- a positive,
      // therefore truthy, integer after the very first element -- so this callback silently
      // truncated enumeration to just the FIRST child at every single node, at every level, for
      // this entire walk (both here and in the root dbId enumeration below). Empirically
      // confirmed against the live Structure model: the unpatched walk visited only 5 dbIds
      // forming a degenerate linear chain (`[1, 2383, 2384, 2386, 2387]`) instead of the tree's
      // real ~547 dbIds, and completely missed dbId 3076 (SOURCE_DB_ID -- already proven to exist
      // with a real fragment via this same task's own identity check). Fixed by making the
      // callback a block-bodied function with no return statement, so it never returns anything
      // but `undefined` (falsy) and enumeration always continues through every sibling.
      const stack = [dbId];
      while (stack.length) {
        const node = stack.pop();
        tree.enumNodeFragments(node, (fragId) => { if (!seen.has(fragId)) seen.add(fragId); }, false);
        tree.enumNodeChildren(node, (child) => { stack.push(child); }, false);
      }
    }
    const profiles = [];
    const rootStack = [rootId];
    const visitedDbIds = new Set();
    while (rootStack.length) {
      const dbId = rootStack.pop();
      if (visitedDbIds.has(dbId)) continue;
      visitedDbIds.add(dbId);
      // Same enumNodeChildren truthy-return-aborts bug as walkFragments above -- same fix.
      tree.enumNodeChildren(dbId, (child) => { rootStack.push(child); }, false);
      const seen = new Set();
      walkFragments(dbId, seen);
      if (seen.size === 0) continue;
      const sourceBoxes = allWorldBoxes.filter((b) => b.modelIndex === 1 && seen.has(b.fragId));
      let proximity = 0;
      for (const s of sourceBoxes) for (const t of allWorldBoxes) if (aabbNear(s, t, proximityThreshold)) proximity++;
      // Real bug found running this task's own manual verification: the brief's own comment
      // claimed "Set objects -- Node side reconstructs via page.evaluate's structured clone (Sets
      // survive)". Empirically FALSE for Playwright's page.evaluate return-value serialization --
      // confirmed directly: a returned Set comes back on the Node side as `{}` (a plain object
      // with every member silently dropped), while a plain array of the same values survives
      // intact. Returning `seen` (a Set) here would have made every fragmentIds.size read 0 (or
      // throw "not iterable") on the Node side, silently corrupting every density/proximity
      // computation cohort-selection.mjs performs downstream. Fixed by crossing the boundary as a
      // plain array; the caller (run-gate-m4.mjs) reconstructs the real Set immediately after
      // page.evaluate returns, which is the first point a genuine Set can exist again.
      profiles.push({ dbId, proximity, fragmentIds: Array.from(seen) });
    }
    return profiles;
  };

  // M4 Task 3.4's live half: the S2T (target-population sweep) facade (§5.3.1 point 2). Wraps the
  // real Architecture model, extending its fragment list with a synthetic bystander tail so the
  // TARGET-side admitted-instance population can be swept (5,435 / 10,000 / 15,000 / 20,000)
  // without perturbing the real source (Structure dbId 3076) or the real near-source Architecture
  // cohort at all -- every real fragment index below `realCount` still delegates to the real
  // model's own FragmentList untouched; only indices >= realCount resolve into `bystanders`
  // (test/performance/m4/s2t-bystander-layout.mjs's pure output).
  //
  // Real, load-bearing bugs found running this task's own manual verification against the live
  // fixture (confirmed by reading the real Viewer's `viewer.impl.getRenderProxy.toString()` and by
  // directly probing `model`/`model.getFragmentList()` for the methods the brief's own excerpt
  // assumed, per this project's established "verify against the real fixture" discipline):
  //
  // 1. The brief's excerpt never gives `facadeFragList` a `getDbIds` method at all. The ONLY real
  //    collision-library call site for dbId resolution is
  //    `collision/viewer/ViewerModelAdapter.js`'s `extractAllFragments` (the whole-model walk this
  //    S2T target actually goes through), which calls `fragList.getDbIds(fragId)` --
  //    `model.getFragmentList().getDbIds(fragId)` -- never a top-level `model.getDbIds(...)`.
  //    Without this, the very first fragment extractAllFragments visits throws
  //    "fragList.getDbIds is not a function", and even if it existed only on the top-level facade
  //    (as the brief's excerpt has it), it would never be reached by the real extraction path at
  //    all -- so the whole target-population sweep would never get off the ground. Fixed by adding
  //    `getDbIds` to `facadeFragList`, delegating to the real FragmentList for real fragIds and
  //    returning a synthetic negative dbId (never a valid real-Viewer dbId, and never `undefined`/
  //    an array, both of which extractAllFragments treats as `fragment-owner-unresolvable` and
  //    silently DROPS the fragment -- which would defeat the whole sweep by excluding every
  //    bystander from the target's admitted population instead of inflating it) for bystanders.
  // 2. The brief's excerpt gives the top-level facade a `getRenderProxy(fragId)` method delegating
  //    to `realArchModel.getRenderProxy(fragId)`. Empirically, `model.getRenderProxy` does not
  //    exist on the real Viewer Model class at all (confirmed live: `typeof model.getRenderProxy
  //    === 'function'` is `false`), and no collision-library code path ever calls it that way in
  //    any case: `viewer.impl.getRenderProxy(model, fragId)` is the only real call site
  //    (`collision/CollisionWorld.js:2972`, `_resolveGeometryView`, the narrow-phase geometry read
  //    for a real Architecture candidate), and reading its own live source
  //    (`viewer.impl.getRenderProxy.toString()`) shows its ENTIRE body is
  //    `return model.getFragmentList()?.getVizmesh(fragId);` -- i.e. the real translation point is
  //    a `getVizmesh` method on the FRAGMENT LIST, not a `getRenderProxy` method on the model. Left
  //    as the brief wrote it, any real near-source Architecture fragment that survives broad phase
  //    and needs narrow-phase geometry would crash with "realArchModel.getRenderProxy is not a
  //    function" the first time `_resolveGeometryView` ran. Fixed by dropping the broken top-level
  //    `getRenderProxy` entirely and adding `getVizmesh` to `facadeFragList` instead, delegating to
  //    the real FragmentList for real fragIds and returning `undefined` for bystanders (matching
  //    the real Viewer's own "no live proxy" shape exactly, which `_resolveGeometryView` already
  //    turns into `RenderProxyUnavailableError` -- and per this sweep's own design, a bystander
  //    should never legitimately reach narrow phase in the first place, so that error firing would
  //    itself be a correct, loud signal of a broad-phase filtering bug, not a facade defect).
  //
  // §5.3.1 point 2's Viewer surface list (getFragmentList/getCount/isNotLoaded/getDbIds/
  // getGeometryId/getWorldMatrix/getWorldBounds/getUnitScale) is otherwise implemented exactly as
  // the brief describes; `id` is an addition beyond the brief's own excerpt (delegating the real
  // model's own numeric id) purely so any diagnostic/statistics object that carries a `modelId`
  // field never carries the WHOLE facade object (which holds `__realModel`, the live Autodesk
  // Model instance) into a later `JSON.stringify` -- with no `.id`, `modelIdOf`
  // (`collision/CollisionWorld.js`) falls back to the facade object itself, which is both a
  // needless divergence from what the real Architecture model's own diagnostics would carry and a
  // circular-structure risk the very first time a diagnostic gets printed.
  window.__m4Probes.buildS2TFacade = function (realArchModel, bystanders) {
    const realCount = realArchModel.getFragmentList().getCount();
    // Test-harness-local instrumentation (never touches `collision/`, so it stays within §5.3.1
    // point 2's "adds no library seam" constraint): counts every `getVizmesh` call the real
    // `viewer.impl.getRenderProxy(model, fragId)` path makes for a SYNTHETIC fragId. §5.3.1's
    // control rule (line 239) requires "zero getRenderProxy calls and zero geometry-resolve events
    // ... attributed to synthetic fragment ids" -- this counter is what makes that condition
    // actually VERIFIED rather than merely argued-safe-by-construction (a bystander that ever did
    // reach here would in any case already throw RenderProxyUnavailableError inside
    // CollisionWorld.js's `_resolveGeometryView`, since this returns `undefined`, matching the real
    // Viewer's own "no live proxy" shape -- so a real leak fails the whole run loudly either way;
    // this counter exists so the control rule can name the violation explicitly rather than relying
    // on an uncaught exception to say so).
    let syntheticVizmeshAccessCount = 0;
    const facadeFragList = {
      getCount: () => realCount + bystanders.length,
      isNotLoaded: (fragId) => (fragId < realCount ? realArchModel.getFragmentList().isNotLoaded(fragId) : false),
      getDbIds: (fragId) => (fragId < realCount ? realArchModel.getFragmentList().getDbIds(fragId) : -1 - (fragId - realCount)),
      getWorldBounds: (fragId, box) => {
        if (fragId < realCount) return realArchModel.getFragmentList().getWorldBounds(fragId, box);
        const b = bystanders[fragId - realCount];
        box.min.set(b.position[0], b.position[1], b.position[2]);
        box.max.set(b.position[0] + 1, b.position[1] + 1, b.position[2] + 1);
      },
      getWorldMatrix: (fragId, dst) => {
        if (fragId < realCount) return realArchModel.getFragmentList().getWorldMatrix(fragId, dst);
        dst.set(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1); // identity -- bystander position is baked into its AABB
      },
      getGeometryId: (fragId) => (fragId < realCount ? realArchModel.getFragmentList().getGeometryId(fragId) : bystanders[fragId - realCount].geometryId),
      // Real translation point for `viewer.impl.getRenderProxy(model, fragId)` -- see the bug note
      // above. `undefined` for a bystander matches the real Viewer's own "no live render proxy"
      // shape; a bystander is never expected to reach this call at all.
      getVizmesh: (fragId) => {
        if (fragId < realCount) return realArchModel.getFragmentList().getVizmesh(fragId);
        syntheticVizmeshAccessCount++;
        return undefined;
      },
    };
    return {
      getFragmentList: () => facadeFragList,
      getCount: () => facadeFragList.getCount(),
      isNotLoaded: (fragId) => facadeFragList.isNotLoaded(fragId),
      getDbIds: (fragId) => facadeFragList.getDbIds(fragId),
      getGeometryId: (fragId) => facadeFragList.getGeometryId(fragId),
      getUnitScale: () => realArchModel.getUnitScale(), // delegates -- it controls weld epsilon (§5.3.1 point 2)
      getSyntheticVizmeshAccessCount: () => syntheticVizmeshAccessCount,
      id: realArchModel.id,
      __isM4SyntheticFacade: true,
      __realModel: realArchModel,
      __realCount: realCount,
    };
  };

  // §5.3.1's level-to-level mechanical control rule (lines 232-239 of
  // docs/superpowers/specs/2026-09-08-collision-library-milestone4-performance-worker-decision-design.md,
  // the actual governing spec -- task-3.4-brief.md's own excerpt only implemented a SUBSET of this
  // contract: the two scalar counts below, plus a diagnostics-only leak check that mixed different
  // MODELS' fragId numbering spaces together; see the two review notes right below the six checks).
  // Returns { pass: true } or { pass: false, violated: [...] }.
  //
  // Every `lvl` entry this function is called with must carry: `level`, `realCount`,
  // `targetModelId` (the facade's own `.id`, used to scope a diagnostic's fragment reference to
  // "the S2T target" rather than trusting a bare fragId number, which is only meaningful WITHIN one
  // model), `statistics.{clearanceExactAabbSurvivors,narrowPhasePairs}`, `diagnostics` (the raw
  // array), `pairSignatures`/`pairDistances`/`pairWitnesses` (the final result set, keyed and
  // sorted exactly like run-gate-m3.mjs's own established TLAS-vs-linear comparator convention --
  // reused here across LEVELS instead of across broad-phase arms), and
  // `syntheticVizmeshAccessCount` (`facade.getSyntheticVizmeshAccessCount()`, read immediately
  // after the query).
  //
  // Two of §5.3.1's six required conditions are DELIBERATELY NOT checked here, because they are not
  // safely derivable from `findClashes`'s current PUBLIC contract without either new instrumentation
  // inside `collision/` (which line 232's own "no new instrumentation" rules out, and which is a
  // Global Constraint this task must not cross) or reverse-engineering undocumented internal
  // aggregation semantics this task cannot verify with confidence (e.g. `clearanceHardClashExclusions`
  // is accumulated via a deduplicating `hardClashExcludedKeys` Set inside `findClashes`, whose exact
  // per-pair-vs-per-key counting rule this task did not trace far enough to safely re-derive a
  // "four-way outcome mix" from):
  //   - line 234's "clearanceExactAabbSurvivors ... identical ... as a pair set" -- the broad-phase
  //     candidate pairs themselves (as opposed to their COUNT, which IS checked below) are never
  //     part of `findClashes`'s public return value, and two of the seven possible per-pair narrow-
  //     phase outcomes (`hard-clash-excluded`, `beyond-threshold`) push no diagnostic at all
  //     (CollisionWorld.js:2330's own documented "clean, conclusive negatives" rule), so their pair
  //     identity is not reconstructable from any existing observable;
  //   - line 236's "four-way outcome mix (early proven overlap / full negative traversal /
  //     inconclusive precheck / distance query) identical count-for-count" -- no existing statistic
  //     exposes these four buckets directly, and the mapping from `clearanceOverlapPrechecksRun` /
  //     `clearanceHardClashExclusions` / `clearanceDistanceQueriesRun` onto them is not spelled out
  //     by the spec text itself.
  // Flagged explicitly in this task's own report rather than approximated silently -- a wrong
  // approximation here would be worse than an honest gap, since it could either invalidate a
  // genuinely-good run or (worse) pass a genuinely-bad one under a false sense of full coverage.
  window.__m4Probes.checkS2TLevelToLevelControlRule = function (levelResults) {
    const violated = [];
    const base = levelResults[0];
    const isSyntheticTargetRef = (ref, lvl) => !!ref && ref.modelId === lvl.targetModelId && ref.fragId >= lvl.realCount;
    for (const lvl of levelResults.slice(1)) {
      // line 235: narrowPhasePairs identical in count.
      if (lvl.statistics.narrowPhasePairs !== base.statistics.narrowPhasePairs) violated.push(`narrowPhasePairs@${lvl.level}`);
      // line 234 (count half only -- see the note above for the pair-set half this cannot check).
      if (lvl.statistics.clearanceExactAabbSurvivors !== base.statistics.clearanceExactAabbSurvivors) violated.push(`clearanceExactAabbSurvivors@${lvl.level}`);

      // line 237: final pair set, distances, and witnesses identical, by §6.4's own field rules
      // (sorted signature-set equality; bit-identical distance/witness comparison -- no worker is
      // involved in S2T, so §6.4's relaxed worker-arm tolerance does not apply here).
      const sigEqual = (a, b) => Array.isArray(a) && Array.isArray(b) && JSON.stringify(a) === JSON.stringify(b);
      if (!sigEqual(lvl.pairSignatures, base.pairSignatures)) violated.push(`finalPairSetMismatch@${lvl.level}`);
      if (!sigEqual(lvl.pairDistances, base.pairDistances)) violated.push(`finalPairDistanceMismatch@${lvl.level}`);
      if (!sigEqual(lvl.pairWitnesses, base.pairWitnesses)) violated.push(`finalPairWitnessMismatch@${lvl.level}`);

      // line 238: no synthetic bystander fragment id in any diagnostic OR final-result record, at
      // any level -- correctly SCOPED to the S2T target model's own id (Codex-review-caught bug,
      // fixed here: the brief's own original excerpt compared every `sourceFragment`/`fragment`
      // fragId against `base.realCount` regardless of which MODEL it came from, so a legitimate
      // Structure-side diagnostic whose fragId happened to be numerically >= the ARCHITECTURE
      // model's own real fragment count would have been misclassified as a synthetic leak --
      // fragment ids are only meaningful WITHIN one model's own numbering space, never compared
      // across models).
      const anySyntheticFragmentReferenced = (lvl.diagnostics ?? []).some(
        (d) => isSyntheticTargetRef(d.fragment, lvl) || isSyntheticTargetRef(d.sourceFragment, lvl) || isSyntheticTargetRef(d.targetFragment, lvl),
      );
      const anySyntheticPairInResults = (lvl.pairSignatures ?? []).some((sig) => sig.includes(':synthetic:'));
      if (anySyntheticFragmentReferenced || anySyntheticPairInResults) violated.push(`syntheticFragmentLeak@${lvl.level}`);

      // line 239: zero getRenderProxy calls / geometry-resolve events attributed to synthetic
      // fragment ids, at any level -- verified via the facade's own `getSyntheticVizmeshAccessCount`
      // counter (see buildS2TFacade's comment above).
      if (lvl.syntheticVizmeshAccessCount) violated.push(`syntheticGeometryResolveLeak@${lvl.level}`);
    }
    return { pass: violated.length === 0, violated };
  };
})();
