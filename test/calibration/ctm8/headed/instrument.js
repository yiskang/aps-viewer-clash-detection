/* CTM-8 headed corroboration instrumentation (CTM8-P0-v4 §9.1, §9.3, §9.4). RUNTIME-INJECTED, READ-ONLY.
 *
 * Classic (non-module) self-contained script. Inject its full text into the page AFTER the viewer exists, e.g.
 *   await page.evaluate(src)            // src = file contents
 * It defines:
 *   globalThis.__ctm8Pure  — pure, DOM-free helpers (completion tracker, stats, list compare); Node-testable.
 *   window.__ctm8          — in-page API (only when window/document exist).
 *
 * Read-only contract (§9.1): the controller is reached ONLY through the existing extension handle
 *   viewer.getExtension('Autodesk.Sandbox.ClashPanel')._host.panel.controller
 * and ONLY getViewModel() / subscribe() are called on it (never dispatch, never private state). With the Tests
 * Manager hosted that handle is the public editor facade (clashpanel/index.js publicController): getViewModel()
 * returns the EDITOR ViewModel; subscribe() is notified on every manager notification. Viewer reads use public getters
 * only: getAggregateIsolation(), getIsolatedNodes(model), getAllModels(), navigation.getPosition()/getTarget().
 * DOM: capture-phase listeners (record performance.now() of the triggering event), MutationObserver on the measured
 * region, PerformanceObserver('longtask'). Nothing here clicks, fills, dispatches or mutates app/Viewer state.
 *
 * Completion (§9.3): tD = first time the semantic predicate AND the DOM predicate hold; confirmed by a 250 ms quiet
 * window (no childList/characterData/attributes mutation in the region); a mutation inside the window moves tD to the
 * next time both predicates hold. The quiet window is NOT added to the duration. 10 s from t0 => TIMEOUT.
 * Mutation timestamps are the MutationObserver callback time (end of the mutating task's microtask checkpoint).
 */
(function () {
  'use strict';
  const VERSION = 'ctm8-headed-instrument/1';

  // ── pure part ──────────────────────────────────────────────────────────────────────────────────────────────────
  /**
   * Completion tracker. Feed observations in time order:
   *   observe(t, holds, {mutation})  — holds = semantic ∧ DOM predicate evaluated at t (after the mutation, if any)
   *   poll(t)                         — advances time; returns the final status once decided
   * Status: {done:false} | {done:true, status:'OK', tD} | {done:true, status:'TIMEOUT', elapsed}
   */
  function createCompletionTracker({ t0, quietMs = 250, timeoutMs = 10000 }) {
    if (!Number.isFinite(t0)) throw new TypeError('createCompletionTracker: t0 required');
    let candidate = null;     // time both predicates (re)started to hold with no later mutation
    let lastMutation = -Infinity;
    let final = null;
    const decide = (t) => {
      if (final) return final;
      if (candidate !== null && t - Math.max(candidate, lastMutation) >= quietMs) {
        final = { done: true, status: 'OK', tD: candidate, durationMs: candidate - t0 };
      } else if (t - t0 >= timeoutMs) {
        final = { done: true, status: 'TIMEOUT', elapsedMs: t - t0 };
      }
      return final ?? { done: false };
    };
    return {
      observe(t, holds, { mutation = false } = {}) {
        if (final) return final;
        if (mutation) {
          lastMutation = t;
          candidate = holds ? t : null;          // a mutation inside the window moves tD to the next hold
        } else if (holds) {
          if (candidate === null) candidate = t;
        } else {
          candidate = null;
        }
        return decide(t);
      },
      poll(t) { return decide(t); },
      get candidate() { return candidate; },
    };
  }

  function sortedNums(xs) { return xs.filter((x) => Number.isFinite(x)).slice().sort((a, b) => a - b); }
  /** Median/min/max only (§9.2: no p95 headed). */
  function summarize(values) {
    const s = sortedNums(values);
    if (s.length === 0) return { n: 0, median: null, min: null, max: null };
    const mid = s.length >> 1;
    const median = s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
    return { n: s.length, median, min: s[0], max: s[s.length - 1] };
  }
  const sameList = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]);
  const round = (x, d = 3) => (Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : x);

  const pure = Object.freeze({ VERSION, createCompletionTracker, summarize, sameList, round });
  globalThis.__ctm8Pure = pure;
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  // ── in-page part ───────────────────────────────────────────────────────────────────────────────────────────────
  if (window.__ctm8 && window.__ctm8.VERSION === VERSION) return;   // idempotent re-injection
  const now = () => performance.now();
  const safe = (fn, d = null) => { try { const v = fn(); return v === undefined ? d : v; } catch { return d; } };
  const viewer = () => window.NOP_VIEWER || window.viewer || null;
  const ctl = () => safe(() => viewer().getExtension('Autodesk.Sandbox.ClashPanel')._host.panel.controller, null);
  const vm = () => { const c = ctl(); return c ? c.getViewModel() : null; };
  const RESULTS = 'section[data-region="results"]';

  // long tasks: one global buffer, sliced per scenario window
  const longtasks = [];
  try {
    const po = new PerformanceObserver((list) => { for (const e of list.getEntries()) longtasks.push({ start: e.startTime, dur: e.duration }); });
    po.observe({ type: 'longtask', buffered: true });
  } catch (e) { longtasks.unavailable = String(e); }

  // VM helpers (public ViewModel fields only)
  const pageRows = (v) => (v && v.results && Array.isArray(v.results.rows) ? v.results.rows : []);
  const vmGroupKeys = (v) => pageRows(v).filter((r) => r.kind === 'group').map((r) => r.key);
  const domGroupKeys = () => [...document.querySelectorAll(`${RESULTS} button.clash-group-body[data-key]`)]
    .map((b) => b.getAttribute('data-key').replace(/\|present$/, ''));
  const domRowCount = () => document.querySelectorAll(`${RESULTS} button.clash-group-body, ${RESULTS} li.clash-row`).length;
  const vmRowCount = (v) => pageRows(v).length;
  function vmBrief(v) {
    if (!v) return null;
    return {
      filters: v.filters ? { text: v.filters.text, active: v.filters.active, busy: v.filters.busy, sort: v.filters.sort, groupBy: v.filters.groupBy } : null,
      results: v.results ? { state: v.results.state, view: v.results.view, groupBy: v.results.groupBy, page: v.results.page, rows: pageRows(v).length } : null,
      run: v.run ? { state: v.run.state, doneKind: v.run.doneKind, headline: v.run.headline, counts: v.run.counts } : null,
      selected: v.selected ? { kind: v.selected.kind, groupId: v.selected.groupId ?? null, label: v.selected.label ?? null, clashCount: v.selected.clashCount ?? null, ordinal: v.selected.ordinal ?? null } : null,
      test: v.test ? { testId: v.test.testId } : null,
      setupName: v.setup ? v.setup.name : null,
      firstPageGroupKeys: vmGroupKeys(v),
    };
  }

  // Viewer public getters (HV checks, "Viewer settled")
  function viewerState() {
    const vw = viewer();
    if (!vw) return null;
    const models = safe(() => vw.getAllModels(), []) || [];
    const agg = safe(() => vw.getAggregateIsolation(), []) || [];
    const pos = safe(() => vw.navigation.getPosition(), null);
    const tgt = safe(() => vw.navigation.getTarget(), null);
    const r3 = (p) => (p ? [round(p.x, 3), round(p.y, 3), round(p.z, 3)] : null);
    return {
      aggregateIsolation: agg.map((e) => ({ modelId: safe(() => e.model.id, null), ids: (e.ids || []).length })),
      isolatedNodes: models.map((m) => ({ modelId: m.id, n: safe(() => (vw.getIsolatedNodes(m) || []).length, null) })),
      camera: { position: r3(pos), target: r3(tgt) },
    };
  }
  const settledFingerprint = () => JSON.stringify([viewerState(), safe(() => vmBrief(vm()).selected, null)]);
  /** §9.4 Viewer settled: unchanged across consecutive 250 ms samples for >= 500 ms; 10 s max => INCONCLUSIVE. */
  async function viewerSettled({ intervalMs = 250, stableMs = 500, maxMs = 10000 } = {}) {
    const start = now(); let prev = settledFingerprint(); let stableSince = now();
    for (;;) {
      await new Promise((r) => setTimeout(r, intervalMs));
      const cur = settledFingerprint();
      if (cur !== prev) { prev = cur; stableSince = now(); }
      if (now() - stableSince >= stableMs) return { settled: true, waitedMs: round(now() - start, 1), state: viewerState(), selected: safe(() => vmBrief(vm()).selected, null) };
      if (now() - start >= maxMs) return { settled: false, verdict: 'INCONCLUSIVE', waitedMs: round(now() - start, 1), state: viewerState() };
    }
  }

  // Semantic / DOM predicates by scenario kind
  const SEM = {
    'HB-BASE': (v, p) => !!v && v.filters.sort === 'group-count' && v.filters.busy === false && v.results.state === 'list'
      && (p.refKeys ? pure.sameList(vmGroupKeys(v), p.refKeys) : true),
    'HB-BASE-RESET': (v, p) => !!v && v.filters.sort === 'group-label' && v.filters.busy === false && v.results.state === 'list'
      && (p.refKeys ? pure.sameList(vmGroupKeys(v), p.refKeys) : true),
    'P-WARM-H': (v, p) => !!v && v.filters.text === p.T && v.filters.active === true && v.filters.busy === false
      && v.results.state === 'list' && v.run.counts.filtered === p.C,
    'HB-GROUP': (v, p) => SEM['P-WARM-H'](v, p) && !!v.selected && v.selected.kind === 'group'
      && v.selected.groupId === p.groupId && v.selected.clashCount === p.clashCount,
    'HM-REC': (v, p) => !!v && !!v.test && v.test.testId === p.idK && v.setup.name === p.name,
  };
  const DOM = {
    groupKeysEqualVm: (v) => pure.sameList(domGroupKeys(), vmGroupKeys(v)),
    rowCountEqualsVm: (v) => domRowCount() === vmRowCount(v),
    // Tests Manager header (rendered from the manager VM: activeName, count) — see README protocol note on HM-REC.
    managerHeader: (v, p) => {
      const active = safe(() => document.querySelector('.clash-manager-header .clash-manager-active').textContent.trim(), null);
      const all = safe(() => document.querySelector('.clash-manager-header [data-key="manager-view-list"]').textContent.trim(), null);
      return active === `Test: ${p.name}` && all === `All tests (${p.count})`;
    },
  };

  const runs = {};
  let seq = 0;
  /**
   * Arm one timed sample BEFORE the Playwright action. spec:
   *   {scenario, label, eventType:'input'|'change', targetSelector, regionSelectors:[...], semantic, dom, params,
   *    quietMs?, timeoutMs?}
   * Returns the sample id; await __ctm8.result(id).
   */
  function arm(spec) {
    const id = `s${++seq}`;
    const quietMs = spec.quietMs ?? 250; const timeoutMs = spec.timeoutMs ?? 10000;
    const rec = {
      id, scenario: spec.scenario, label: spec.label ?? null, params: spec.params ?? {}, armedAt: now(),
      t0: null, eventType: spec.eventType, transitions: [], mutations: 0, mutationTimes: [], notifications: 0,
      status: 'ARMED', tD: null, durationMs: null, firstBusyAt: null,
    };
    const sem = SEM[spec.semantic]; const dom = DOM[spec.dom];
    if (!sem || !dom) throw new Error(`arm: unknown predicate ${spec.semantic}/${spec.dom}`);
    const holds = () => { const v = vm(); return !!(sem(v, rec.params) && dom(v, rec.params)); };
    let tracker = null; let resolve; const done = new Promise((r) => { resolve = r; });
    const regions = (spec.regionSelectors || [RESULTS]).map((s) => document.querySelector(s)).filter(Boolean);
    rec.regions = (spec.regionSelectors || [RESULTS]);
    rec.regionsFound = regions.length;
    let mo = null; let unsub = null; let timer = null;
    const finish = (out) => {
      if (rec.status !== 'ARMED' && rec.status !== 'RUNNING') return;
      Object.assign(rec, { status: out.status, tD: out.tD ?? null, durationMs: out.durationMs ?? null, elapsedMs: out.elapsedMs ?? null });
      if (out.status === 'OK' && rec.firstBusyAt !== null) rec.afterFirstBusyMs = out.tD - rec.firstBusyAt;
      if (out.status === 'OK' && rec.eventType === 'input') rec.afterDebounceNominalMs = out.durationMs - 150;
      const end = (out.tD ?? now()) + quietMs;
      const lt = longtasks.filter((e) => e.start + e.dur >= rec.t0 && e.start <= end);
      rec.longtasks = { count: lt.length, maxMs: lt.reduce((m, e) => Math.max(m, e.dur), 0), totalMs: lt.reduce((s, e) => s + e.dur, 0), entries: lt.map((e) => ({ start: round(e.start - rec.t0, 1), dur: round(e.dur, 1) })) };
      rec.mutationTimes = rec.mutationTimes.map((t) => round(t - rec.t0, 2));
      rec.finalVm = vmBrief(vm());
      cleanup(); resolve(rec);
    };
    const cleanup = () => {
      document.removeEventListener(spec.eventType, onEvent, true);
      if (mo) mo.disconnect(); if (unsub) { try { unsub(); } catch { /* ignore */ } } if (timer) clearInterval(timer);
    };
    const onEvent = (e) => {
      if (rec.t0 !== null) return;
      const t = e.target;
      if (!t || typeof t.matches !== 'function' || !t.matches(spec.targetSelector)) return;
      rec.t0 = now(); rec.status = 'RUNNING';
      rec.eventValue = 'value' in t ? t.value : null;
      tracker = pure.createCompletionTracker({ t0: rec.t0, quietMs, timeoutMs });
      timer = setInterval(() => {
        const t1 = now(); const h = holds();
        const out = tracker.observe(t1, h);   // polling observation (not a mutation)
        if (out.done) finish(out);
      }, 10);
    };
    document.addEventListener(spec.eventType, onEvent, true);   // capture phase, before the app's own listener
    mo = new MutationObserver((list) => {
      if (rec.t0 === null || !tracker) return;
      const t = now(); rec.mutations += list.length; rec.mutationTimes.push(t);
      const out = tracker.observe(t, holds(), { mutation: true });
      if (out.done) finish(out);
    });
    for (const r of regions) mo.observe(r, { childList: true, characterData: true, attributes: true, subtree: true });
    const c = ctl();
    if (c) unsub = c.subscribe((v) => {
      if (rec.t0 === null) return;
      const t = now(); rec.notifications += 1;
      const tr = { t: round(t - rec.t0, 2), busy: v.filters ? v.filters.busy : null, filtered: v.run && v.run.counts ? v.run.counts.filtered : null, state: v.results ? v.results.state : null };
      rec.transitions.push(tr);
      if (rec.firstBusyAt === null && tr.busy === true) rec.firstBusyAt = t;
    });
    runs[id] = { rec, done };
    return id;
  }
  /** Await a sample's outcome; if the trigger event never arrives within guardMs the sample is NO_EVENT. */
  async function result(id, guardMs = 15000) {
    const r = runs[id]; if (!r) throw new Error(`no sample ${id}`);
    const guard = new Promise((res) => setTimeout(() => res(null), guardMs));
    const out = await Promise.race([r.done, guard]);
    if (out) return JSON.parse(JSON.stringify(out));
    if (r.rec.t0 === null) { r.rec.status = 'NO_EVENT'; }
    return JSON.parse(JSON.stringify(r.rec));
  }
  /** Untimed wait for a named predicate pair (preparation / reset). */
  async function waitFor(semantic, dom, params, { timeoutMs = 120000, quietMs = 250 } = {}) {
    const start = now(); let since = null;
    for (;;) {
      const v = vm(); const ok = !!(SEM[semantic](v, params) && DOM[dom](v, params));
      if (ok) { if (since === null) since = now(); if (now() - since >= quietMs) return { ok: true, waitedMs: round(now() - start, 1), vm: vmBrief(v) }; } else since = null;
      if (now() - start > timeoutMs) return { ok: false, waitedMs: round(now() - start, 1), vm: vmBrief(v) };
      await new Promise((r) => setTimeout(r, 20));
    }
  }
  /** Untimed transition log (e.g. while a run completes). */
  function startLog() {
    const log = []; const t0 = now(); const c = ctl();
    const un = c ? c.subscribe((v) => log.push({ t: round(now() - t0, 2), busy: v.filters ? v.filters.busy : null, filtered: v.run && v.run.counts ? v.run.counts.filtered : null, total: v.run && v.run.counts ? v.run.counts.total : null, state: v.results ? v.results.state : null, run: v.run ? v.run.state : null })) : () => {};
    return { stop: () => { un(); return log; } };
  }

  window.__ctm8 = Object.freeze({
    VERSION, pure, arm, result, waitFor, startLog, viewerState, viewerSettled,
    vm: () => vmBrief(vm()), rawVm: () => JSON.parse(JSON.stringify(vm())),
    groupKeys: () => vmGroupKeys(vm()), domGroupKeys, longtasks: () => longtasks.slice(),
    hasController: () => !!ctl(),
  });
})();
