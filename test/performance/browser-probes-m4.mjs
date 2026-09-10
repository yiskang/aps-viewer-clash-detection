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
})();
