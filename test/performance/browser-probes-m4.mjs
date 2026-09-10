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
})();
