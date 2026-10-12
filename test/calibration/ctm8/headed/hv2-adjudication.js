/* CTM-8 HV-2 (Focus) headed evidence-only adjudication tooling. RUNTIME-INJECTED. NOT PRODUCT CODE.
 *
 * Classic (non-module) self-contained script. Inject its full text into the page after the viewer and the Clash
 * Panel exist, e.g. `await page.evaluate(src)`. Defines window.__hv2.
 *
 * What it does (read-only, except ONE explicit evidence-tooling mutation):
 *   - listens (count + timestamp only) to the public Viewer events AGGREGATE_FIT_TO_VIEW_EVENT, FIT_TO_VIEW_EVENT,
 *     CAMERA_TRANSITION_COMPLETED and CAMERA_CHANGE_EVENT. Timestamps exist only to order events relative to a
 *     click; they are NOT a latency result and must not be reported as one.
 *   - reads the camera through public Navigation getters: getPosition, getTarget, getCameraUpVector, getWorldUpVector,
 *     getVerticalFov, getIsPerspective (and viewer.getCamera().isPerspective as a cross-check).
 *   - reads getAggregateIsolation / getAggregateSelection (public Viewer3D) and the panel ViewModel (getViewModel only,
 *     through the same extension handle as instrument.js; never dispatch, never private controller state).
 *   - participant ids: getAggregateSelection, else getAggregateIsolation, else the last AGGREGATE_FIT_TO_VIEW_EVENT payload.
 *   - participant world bounds (containment proxy): model.getInstanceTree().getNodeBox(dbId, Float32Array(6)) — the
 *     public InstanceTree API — and viewer.worldToClient() to project the union box corners. If unavailable, says so.
 *   - settled: rounded (1e-3) camera + aggregate state + selected group unchanged across consecutive 250 ms samples
 *     for >= 500 ms, max 10 s (CTM8-P0-v4 §9.4 rule).
 *   - moveAway(): THE ONLY MUTATION. Calls the public viewer.navigation.setView(position, target) to put the camera in
 *     a non-fitted pose. This is evidence tooling, not part of the product path; every call is recorded.
 * Nothing here clicks UI; clicks are performed by the Playwright driver on the real buttons.
 */
(function () {
  'use strict';
  const VERSION = 'ctm8-hv2-adjudication/2';
  if (window.__hv2 && window.__hv2.VERSION === VERSION) return;
  const now = () => performance.now();
  const safe = (fn, d = null) => { try { const v = fn(); return v === undefined ? d : v; } catch { return d; } };
  const viewer = () => window.NOP_VIEWER || window.viewer || null;
  const ctl = () => safe(() => viewer().getExtension('Autodesk.Sandbox.ClashPanel')._host.panel.controller, null);
  const vm = () => { const c = ctl(); return c ? c.getViewModel() : null; };
  const r = (x, d = 3) => (Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : x);
  const v3 = (p, d) => (p ? [r(p.x, d), r(p.y, d), r(p.z, d)] : null);
  const AV = () => window.Autodesk.Viewing;

  // ── events ──────────────────────────────────────────────────────────────────────────────────────────────────
  const events = [];
  const counts = {};
  let installed = false;
  let lastFitSelection = null;
  function install() {
    if (installed) return { installed: true, already: true };
    const vw = viewer();
    const names = ['AGGREGATE_FIT_TO_VIEW_EVENT', 'FIT_TO_VIEW_EVENT', 'CAMERA_TRANSITION_COMPLETED', 'CAMERA_CHANGE_EVENT'];
    const out = {};
    for (const n of names) {
      const type = AV()[n];
      out[n] = typeof type === 'string' ? type : null;
      if (typeof type !== 'string') continue;
      counts[n] = 0;
      vw.addEventListener(type, (e) => {
        counts[n] += 1;
        if (n === 'CAMERA_CHANGE_EVENT') return;            // counted only (high frequency)
        const rec = { type: n, t: r(now(), 1), seq: events.length };
        if (n === 'AGGREGATE_FIT_TO_VIEW_EVENT') {
          rec.selectionModels = safe(() => (e.selection || []).map((s) => ({ modelId: s.model && s.model.id, n: (s.selection || []).length })), null);
          lastFitSelection = safe(() => (e.selection || []).map((s) => ({ model: s.model, ids: [...(s.selection || [])] })), null);   // ids the fit was asked to frame (public event payload)
        }
        if (n === 'FIT_TO_VIEW_EVENT') rec.nodeIdCount = safe(() => (e.nodeIdArray || []).length, null), rec.modelId = safe(() => e.model.id, null);
        rec.immediate = safe(() => e.immediate, null);
        events.push(rec);
      });
    }
    installed = true;
    return { installed: true, eventTypes: out };
  }
  const mark = () => ({ idx: events.length, t: r(now(), 1), counts: { ...counts } });
  const since = (m) => ({ events: events.slice(m.idx), countsDelta: Object.fromEntries(Object.keys(counts).map((k) => [k, counts[k] - (m.counts[k] || 0)])) });
  async function waitEvent(m, type, timeoutMs = 5000) {
    const start = now();
    for (;;) {
      const hit = events.slice(m.idx).find((e) => e.type === type);
      if (hit) return { seen: true, event: hit };
      if (now() - start >= timeoutMs) return { seen: false, timeoutMs };
      await new Promise((res) => setTimeout(res, 20));
    }
  }

  // ── camera / viewer state ───────────────────────────────────────────────────────────────────────────────────
  function camera(d = 6) {
    const vw = viewer(); const nav = vw.navigation;
    return {
      position: v3(safe(() => nav.getPosition()), d),
      target: v3(safe(() => nav.getTarget()), d),
      up: v3(safe(() => nav.getCameraUpVector()), d),
      worldUp: v3(safe(() => nav.getWorldUpVector()), d),
      fovDeg: r(safe(() => nav.getVerticalFov()), d),
      isPerspective: safe(() => nav.getIsPerspective(), safe(() => vw.getCamera().isPerspective)),
    };
  }
  function viewport() {
    const vw = viewer();
    return { container: [vw.container.clientWidth, vw.container.clientHeight], window: [window.innerWidth, window.innerHeight], dpr: window.devicePixelRatio };
  }
  function aggregate() {
    const vw = viewer();
    const iso = safe(() => vw.getAggregateIsolation(), []) || [];
    const sel = safe(() => vw.getAggregateSelection(), []) || [];
    return {
      isolation: iso.map((e) => ({ modelId: safe(() => e.model.id), n: (e.ids || []).length })),
      selection: sel.map((e) => ({ modelId: safe(() => e.model.id), n: (e.selection || []).length })),
    };
  }
  function selected() {
    const v = vm(); const s = v && v.selected;
    if (!s) return null;
    return { kind: s.kind, groupId: s.groupId ?? null, label: s.label ?? null, clashCount: s.clashCount ?? null, participants: s.participants ?? null,
      unavailableNote: s.unavailableNote ?? null, notes: s.notes ?? null,
      actions: s.actions ? { focus: s.actions.focus, focusOnSelect: s.actions.focusOnSelect, isolate: s.actions.isolate } : null };
  }
  function runBrief() {
    const v = vm();
    return v ? { run: v.run ? { state: v.run.state, headline: v.run.headline, counts: v.run.counts } : null,
      filters: v.filters ? { text: v.filters.text, groupBy: v.filters.groupBy, sort: v.filters.sort } : null,
      results: v.results ? { state: v.results.state, view: v.results.view, page: v.results.page } : null,
      modelOptions: safe(() => v.filters.modelOptions.map((o) => o.label ?? o.name ?? o), null) } : null;
  }
  function state(label) { return { label, t: r(now(), 1), camera: camera(), aggregate: aggregate(), selected: selected(), viewport: viewport() }; }

  const fp = () => JSON.stringify([camera(3), aggregate(), safe(() => selected().groupId)]);
  async function settle({ intervalMs = 250, stableMs = 500, maxMs = 10000 } = {}) {
    const start = now(); let prev = fp(); let stableSince = now();
    for (;;) {
      await new Promise((res) => setTimeout(res, intervalMs));
      const cur = fp();
      if (cur !== prev) { prev = cur; stableSince = now(); }
      if (now() - stableSince >= stableMs) return { settled: true };
      if (now() - start >= maxMs) return { settled: false, verdict: 'INCONCLUSIVE' };
    }
  }

  // ── participants + containment proxy ────────────────────────────────────────────────────────────────────────
  // Participant ids come from the Viewer's aggregate selection (or isolation if selection is empty) — whatever the
  // product put there for the selected group; the source used is recorded.
  function participantIds() {
    const vw = viewer();
    const sel = safe(() => vw.getAggregateSelection(), []) || [];
    const iso = safe(() => vw.getAggregateIsolation(), []) || [];
    const pick = (list, key) => list.filter((e) => (e[key] || []).length > 0).map((e) => ({ model: e.model, ids: [...e[key]] }));
    const s = pick(sel, 'selection');
    if (s.length) return { source: 'getAggregateSelection', list: s };
    const i = pick(iso, 'ids');
    if (i.length) return { source: 'getAggregateIsolation', list: i };
    if (lastFitSelection && lastFitSelection.length) return { source: 'last AGGREGATE_FIT_TO_VIEW_EVENT.selection', list: lastFitSelection.filter((e) => e.ids.length) };
    return { source: 'none', list: [] };
  }
  function containment() {
    const vw = viewer(); const THREE = window.THREE;
    const p = participantIds();
    if (!p.list.length) return { available: false, reason: 'no participant ids in public aggregate selection/isolation', source: p.source };
    const box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    let boxed = 0; let missing = 0; const perModel = [];
    for (const { model, ids } of p.list) {
      const it = safe(() => model.getInstanceTree());
      if (!it || typeof it.getNodeBox !== 'function') { perModel.push({ modelId: model.id, available: false }); missing += ids.length; continue; }
      let n = 0;
      for (const id of ids) {
        const b = new Float32Array(6);
        const ok = safe(() => { it.getNodeBox(id, b); return true; }, false);
        if (!ok || !b.every(Number.isFinite) || (b[0] > b[3])) { missing += 1; continue; }
        for (let k = 0; k < 3; k += 1) { box.min[k] = Math.min(box.min[k], b[k]); box.max[k] = Math.max(box.max[k], b[k + 3]); }
        n += 1;
      }
      boxed += n; perModel.push({ modelId: model.id, ids: ids.length, boxed: n });
    }
    if (!boxed) return { available: false, reason: 'InstanceTree.getNodeBox gave no finite box', source: p.source, perModel };
    const W = vw.container.clientWidth; const H = vw.container.clientHeight;
    const corners = [];
    for (const x of [box.min[0], box.max[0]]) for (const y of [box.min[1], box.max[1]]) for (const z of [box.min[2], box.max[2]]) corners.push([x, y, z]);
    const cam = vw.getCamera(); const pos = vw.navigation.getPosition(); const tgt = vw.navigation.getTarget();
    const dir = new THREE.Vector3().subVectors(tgt, pos).normalize();
    const proj = corners.map((c) => {
      const w = new THREE.Vector3(c[0], c[1], c[2]);
      const inFront = new THREE.Vector3().subVectors(w, pos).dot(dir) > 0;
      const s = vw.worldToClient(w);
      return { world: c.map((x) => r(x, 3)), client: [r(s.x, 1), r(s.y, 1)], inFront, inViewport: inFront && s.x >= 0 && s.x <= W && s.y >= 0 && s.y <= H };
    });
    const center = [0, 1, 2].map((k) => (box.min[k] + box.max[k]) / 2);
    const cs = vw.worldToClient(new THREE.Vector3(...center));
    const centerInFront = new THREE.Vector3(...center).sub(pos).dot(dir) > 0;
    void cam;
    return {
      available: true, source: p.source, boxApi: 'InstanceTree.getNodeBox (public) + Viewer3D.worldToClient (public)',
      caveat: 'node boxes are fragment-derived world boxes as exposed by the public InstanceTree; a proxy, not a pixel coverage measure',
      participantsBoxed: boxed, participantsMissingBox: missing, perModel,
      unionBox: { min: box.min.map((x) => r(x, 3)), max: box.max.map((x) => r(x, 3)) },
      viewportPx: [W, H], corners: proj,
      allCornersInViewport: proj.every((q) => q.inViewport), cornersInViewport: proj.filter((q) => q.inViewport).length,
      center: { world: center.map((x) => r(x, 3)), client: [r(cs.x, 1), r(cs.y, 1)], inFront: centerInFront, inViewport: centerInFront && cs.x >= 0 && cs.x <= W && cs.y >= 0 && cs.y <= H },
    };
  }

  // ── evidence-tooling mutation ───────────────────────────────────────────────────────────────────────────────
  const moves = [];
  /** Lateral translation of the CURRENT camera (position and target by the same vector), so the view direction, up
   *  and fov are unchanged but the group leaves the frame. factor × eye distance along camera-right (+ some world-up). */
  function moveAway({ factor = 4 } = {}) {
    const vw = viewer(); const THREE = window.THREE; const nav = vw.navigation;
    const pos = nav.getPosition().clone(); const tgt = nav.getTarget().clone();
    const dir = new THREE.Vector3().subVectors(tgt, pos); const dist = dir.length(); dir.normalize();
    const up = nav.getCameraUpVector().clone().normalize();
    const right = new THREE.Vector3().crossVectors(dir, up).normalize();
    const d = right.multiplyScalar(dist * factor).add(up.clone().multiplyScalar(dist * factor * 0.5));
    const newPos = pos.clone().add(d); const newTgt = tgt.clone().add(d);
    const call = { api: 'viewer.navigation.setView(position, target)', factor, eyeDistance: r(dist, 3), offset: v3(d, 3), position: v3(newPos, 6), target: v3(newTgt, 6), from: { position: v3(pos, 6), target: v3(tgt, 6) } };
    nav.setView(newPos, newTgt);
    moves.push(call);
    return call;
  }

  // ── comparison ──────────────────────────────────────────────────────────────────────────────────────────────
  function compare(a, b, tol = 1e-3) {
    const keys = ['position', 'target', 'up'];
    const diff = {};
    let equal = true;
    for (const k of keys) {
      const d = a[k] && b[k] ? Math.max(...a[k].map((x, i) => Math.abs(x - b[k][i]))) : null;
      diff[k] = d === null ? null : r(d, 6);
      if (d === null || d > tol) equal = false;
    }
    const fovD = Math.abs((a.fovDeg ?? NaN) - (b.fovDeg ?? NaN));
    diff.fovDeg = r(fovD, 6);
    if (!(fovD <= tol)) equal = false;
    return { equalWithinTol: equal, tol, maxAbsDiff: diff };
  }
  const finiteCam = (c) => ['position', 'target', 'up'].every((k) => Array.isArray(c[k]) && c[k].every(Number.isFinite)) && Number.isFinite(c.fovDeg);

  window.__hv2 = Object.freeze({ VERSION, install, mark, since, waitEvent, camera, viewport, aggregate, selected, runBrief, state, settle, containment, participantIds: () => { const p = participantIds(); return { source: p.source, list: p.list.map((e) => ({ modelId: e.model.id, n: e.ids.length })) }; }, moveAway, moves: () => moves.slice(), compare, finiteCam, events: () => events.slice(), counts: () => ({ ...counts }) });
})();
