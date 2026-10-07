// test/acceptance/clashtest-viewer-adapter.acceptance.mjs
//
// Task 13 of the Federated Clash Test Viewer Adapter plan: the T3 LIVE acceptance script for the production
// ElementEnumerator (`createViewerElementEnumerator`) and the BEFORE_MODEL_UNLOAD wiring (`wireModelUnload`) of
// `clashtest/viewer/`, run against a REAL Autodesk Viewer over the REAL three-model Audubon fixture.
//
// ======================================================================================================
//  STATUS: AUTHORED ONLY. NOT EXECUTED. NOT PART OF `npm test`.
//
//  - `npm test` (scripts/run-tests.mjs) collects only `*.test.mjs`; this file's name does not match, and it is
//    not wired into any package.json script. It needs a live server, APS credentials (server side) and
//    Chromium, none of which `npm test` may use (spec 21.3/22).
//  - EXECUTING this script requires a SEPARATE, EXPLICIT OWNER AUTHORIZATION (as the OQ-4 live check did).
//    Authoring it authorizes nothing. Until an authorized run is recorded under docs/research/, the adapter's
//    gates G-VA-T3-EXEC and LIVE_UNLOAD_INTEGRATION_UNVERIFIED stay open (clashtest/viewer/README.md "Gates").
// ======================================================================================================
//
// --- Accepted envelope (verbatim; the only envelope this script characterizes) ----------------------------
//
//     Audubon / SVF non-OTG / Viewer 7.124.2 / Chromium 151
//
// Source: docs/research/2026-09-26-federated-clash-test-oq4-live-evidence-check.md (OQ-4). The script loads no new
// content and characterizes nothing about OTG/SVF2/2D. The environment (Viewer script version, Chromium major,
// isOTG/is3d of each model) is recorded AND checked: a run outside the envelope fails rather than silently
// broadening the evidence.
//
// --- What it covers (brief Step 1 (a)-(h), Step 2 controls) ------------------------------------------------
//
//   (a) AC-15 (a)/(c) ownership & reachability, whole-model resolveRoots per model: ownerMismatch 0, unreachable 0,
//       unattributable 0/0, population 5,435 / 543 / 1,496, roots 4,244 / 468 / 1,257 (OQ-4 values: a REGRESSION
//       check inside the evidenced envelope, not a broadened claim). D-V9: max(roots[].fragmentCount) recorded; a
//       rejection with EnumerationBoundExceededError / CapacityExceededError is reported as a FINDING (the
//       owner-approved fail-closed policy would refuse that model), never masked or retried.
//   (b) enumerator == library: per root, extractFragments size / owners / subtree digest; population digest
//       recomputed in-page from extractAllFragments with the same rules as test/clashtest/viewer/differential.test.mjs.
//   (c) digestScope == resolveRoots: whole population digest; per-root digests for a sample incl. explicit
//       Structure roots 2734 / 3965 (each = 1 fragment owned by itself, per OQ-4).
//   (d) readiness characterization (RECORDED, never asserted sufficient -- G-VA-READY): the OQ-4 sampler/event
//       timeline verbatim, plus an immediate whole-model resolveRoots inside MODEL_ADDED (outcome printed).
//   (e) AC-6 T3 reload arm (CHARACTERIZATION, not asserted): unload + same-URN reload of Mechanical; population and
//       per-root digests and fragment ids before/after are recorded.
//   (f) AC-12 characterization (G-CAL, NEVER asserted): elapsed time, ctx.checkpoint() call count and the maximum
//       span between consecutive checkpoints vs frameBudgetMs, for whole resolveRoots and digestScope on the largest
//       model (Architecture). No wall-clock value is asserted anywhere in this file.
//   (h) Production unload wiring against the REAL Viewer event (ASSERTED): steps 1-4, the seven-step guarded
//       cleanup with its `resources` record, primary-error / cleanupFailures reporting, cleanup acceptance (a)(b)(c)
//       and the fallback gate LIVE_UNLOAD_INTEGRATION_UNVERIFIED. Event-driven waits only (waitForFunction); no
//       fixed sleep anywhere in (h).
//   Step 2 negative controls (i)-(v) on Structure (each restored in a `finally`), and (h) negative controls per
//   assertion family (wiring never installed => step-1 assertions FAIL; plus step-3 / step-4 sensitivity and the
//   cleanup-acceptance controls). The script FAILS if any control is not detected.
//
// --- What it does NOT cover -------------------------------------------------------------------------------
//
//   (g) PairId role-symmetry half of AC-15 (g): NOT EVIDENCED / NOT COVERED by this script. It needs an engine run
//       over two live models with swapped selections; it is out of this script's automation unless the owner asks
//       for it. No reader may assume it is covered.
//   Also not covered: OTG/SVF2, 2D, non-Revit content, general readiness-gate sufficiency, cross-reload identity
//   (recorded only), any calibration/responsiveness claim.
//
// --- Source-vs-brief notes (verified by reading source; recorded, not papered over) ------------------------
//
//   - `extractFragments` / `extractAllFragments` are NOT exported by `/collision/index.js` (it exports CollisionWorld,
//     CapacityExceededError, the error classes and ExtractionLimitExceededError). They are imported test-only from
//     `/collision/viewer/ViewerModelAdapter.js`, exactly as the OQ-4 probe (Appendix A) and
//     test/clashtest/viewer/differential.test.mjs do.
//   - The in-page CollisionWorld is built exactly as wwwroot/extensions/ClashFinderExtension.js builds its own:
//     `CollisionWorld.fromViewer(viewer, options)` with that extension instance's own `options` object.
//   - `registry.bindingFor(K)` admits the model lazily (world.admitModel); the script therefore reads the binding
//     BEFORE asserting `world.isModelLive(..) === true` for a freshly registered model.
//   - Listener-removal postconditions use `viewer.hasEventListener(type, fn)` (declared by @types/forge-viewer, not an
//     official-docs claim); its presence is checked live and, if absent, the postcondition is recorded as
//     unverifiable (a failing link), never assumed.
//   - Recorded deviation (ctrl-no-wiring): with the wiring never installed, the step-1 PROBE assertions
//     (probeSawX / probeSawBindingPresent) must still PASS -- without the wiring the binding is present at dispatch
//     anyway. That control's detectable failures are the unregister/evict/binding-null assertions (evictCalledForX,
//     evictSawBindingNull, bindingNullAfterUnload, xNotLiveAfterUnload).
//
// --- Serving /clashtest to the page --------------------------------------------------------------------------
//
// server.js serves /collision (server.js:8) but not /clashtest, and server.js / wwwroot must not change. The script
// serves `/clashtest/**` itself with Playwright `page.route` from this repository's `clashtest/` directory
// (JavaScript files only, path-confined). Browser-loadability of clashtest/ (no `node:` imports; only
// globalThis.crypto) is CONFIRMED by the first in-page import below, not assumed; a failure is the recorded link.
//
// --- Running it (ONLY after the separate owner authorization) ----------------------------------------------
//
//   npm start &                                   # server on PORT (default 8080), owner's APS credentials in .env
//   node test/acceptance/clashtest-viewer-adapter.acceptance.mjs
//
// Report: test/acceptance/results/clashtest-viewer-adapter-run-report.json (git-ignored directory). Structure,
// env handling, proxy handling, launch args and check()/results conventions mirror
// test/acceptance/clash-finder.acceptance.mjs; fixture loading and the readiness sampler are the OQ-4 Appendix A
// code, verbatim.

import { chromium } from 'playwright';
import { mkdir, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = process.env.PORT || 8080;
const BASE_URL = `http://localhost:${PORT}`;
const URN_ARCH = 'dXJuOmFkc2sub2JqZWN0czpvcy5vYmplY3Q6dGVzdC1zYW5kYm94LWxrd2VqN3hwYmdwNjN4NGhsMzM1eTZtMjZvYWtnZ29mL0F1ZHVib25fQXJjaGl0ZWN0dXJlX2NsYXNoX3Rlc3QucnZ0';
const URN_STRUCT = 'dXJuOmFkc2sub2JqZWN0czpvcy5vYmplY3Q6dGVzdC1zYW5kYm94LWxrd2VqN3hwYmdwNjN4NGhsMzM1eTZtMjZvYWtnZ29mL0F1ZHVib25fU3RydWN0dXJlX2NsYXNoX3Rlc3QucnZ0';
const URN_MECH = 'dXJuOmFkc2sub2JqZWN0czpvcy5vYmplY3Q6dGVzdC1zYW5kYm94LWxrd2VqN3hwYmdwNjN4NGhsMzM1eTZtMjZvYWtnZ29mL0F1ZHVib25fTWVjaGFuaWNhbF9jbGFzaF90ZXN0LnJ2dA';
const URN_BY_WHICH = { arch: URN_ARCH, struct: URN_STRUCT, mech: URN_MECH };

const CLASH_FINDER_EXTENSION_ID = 'Autodesk.Sandbox.ClashFinder';
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLASHTEST_DIR = path.join(REPO_ROOT, 'clashtest');

// OQ-4-measured values (Appendix B.1) -- a regression check inside the evidenced envelope.
const EXPECTED = {
  arch: { population: 5435, roots: 4244 },
  struct: { population: 543, roots: 468 },
  mech: { population: 1496, roots: 1257 },
};
const EXPLICIT_STRUCT_ROOTS = [2734, 3965];
const ROOT_SAMPLE_EACH_END = 10;           // (c): first N and last N whole-model roots, plus the largest root
const ENVELOPE = { viewerVersion: '7.124.2', chromiumMajor: 151 };

// Load timeout as in OQ-4 Appendix A (180 s). The forced-timeout control waits for a model that was never
// requested, so its (short) timeout can only expire; it is a deterministic abort, not a sleep.
const LOAD_TIMEOUT_MS = 180_000;
const FORCED_RELOAD_TIMEOUT_MS = 5_000;
const H_MODEL_KEY = 't3-h-structure';

const RESULTS_DIR = path.join(process.cwd(), 'test/acceptance/results');
// Distinct filename: every acceptance script shares test/acceptance/results/.
const REPORT_FILE = 'clashtest-viewer-adapter-run-report.json';

const results = {
  script: 'clashtest-viewer-adapter.acceptance.mjs',
  acceptedEnvelope: 'Audubon / SVF non-OTG / Viewer 7.124.2 / Chromium 151',
  notCovered: ['(g) PairId role-symmetry half of AC-15 (g): not evidenced / not covered by this script'],
  phase: 'not-started',
  env: null, imports: null, readiness: null, measurements: {}, controls: {}, reload: null, profile: null,
  h: { runs: {}, controls: {} },
  gates: null,
  consoleErrors: [], pageErrors: [], checks: [],
};

function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}\n        expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
  results.checks.push({ name, ok, expected, actual });
  if (!ok) process.exitCode = 1;
  return ok;
}

// Identical to clash-finder.acceptance.mjs / room-locator.acceptance.mjs (Chromium does not honor HTTP(S)_PROXY).
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

const describeError = (e) => {
  if (e !== null && typeof e === 'object') {
    return { name: e.name, message: String(e.message ?? ''), link: e.link, failedAssertions: e.failedAssertions };
  }
  return { primitive: typeof e, value: String(e) };
};

// ================================================================================================================
// In-page functions. Each is serialized by page.evaluate: it may reference only its argument and page globals.
// ================================================================================================================

/** First in-page import (confirms /clashtest is browser-loadable) + shared in-page helpers. */
const INSTALL_T3 = async () => {
  const t3 = (window.__t3 = window.__t3 || {});
  t3.mod = t3.mod || {};
  t3.errOf = (e) => (e !== null && typeof e === 'object'
    ? { name: e.name, message: String(e.message ?? ''), reason: e.reason, bound: e.bound, kind: e.kind, detail: e.detail ?? e.details }
    : { primitive: typeof e, value: String(e) });
  // Own-property patch that restores exactly (own value back, or delete when the original came from the prototype).
  t3.patch = (obj, name, make) => {
    const hadOwn = Object.prototype.hasOwnProperty.call(obj, name);
    const orig = obj[name];
    obj[name] = make(orig);
    return () => { if (hadOwn) obj[name] = orig; else delete obj[name]; };
  };
  const out = {};
  // ORDER MATTERS: the adapter entry point is the FIRST import (browser-loadability confirmation).
  const specs = [
    '/clashtest/viewer/index.js',
    '/clashtest/index.js',
    '/collision/index.js',
    '/collision/viewer/ViewerModelAdapter.js',
    '/clashtest/planning/scopeDigest.js',
    '/collision/constants.js',
  ];
  const required = {
    '/clashtest/viewer/index.js': ['createViewerElementEnumerator', 'wireModelUnload'],
    '/clashtest/index.js': ['createClashTestEngine'],
    '/collision/index.js': ['CollisionWorld'],
    '/collision/viewer/ViewerModelAdapter.js': ['extractFragments', 'extractAllFragments'],
    '/clashtest/planning/scopeDigest.js': ['digestPopulation', 'digestSubtree'],
    '/collision/constants.js': ['frameBudgetMs'],
  };
  for (const spec of specs) {
    try {
      const m = await import(spec);
      t3.mod[spec] = m;
      const missing = required[spec].filter((n) => !(n in m));
      out[spec] = { ok: missing.length === 0, missing, exports: Object.keys(m).sort() };
    } catch (e) {
      out[spec] = { ok: false, error: t3.errOf(e) };
    }
  }
  return out;
};

/** (d): immediate whole-model resolveRoots inside MODEL_ADDED (read-only). Outcome recorded, never asserted. */
const INSTALL_READINESS_HOOK = () => {
  const t3 = window.__t3;
  const V = window.Autodesk.Viewing;
  const { createViewerElementEnumerator } = t3.mod['/clashtest/viewer/index.js'];
  const enumerator = createViewerElementEnumerator();
  t3.readiness = {
    outcomes: [], pending: 0, installedAt: performance.now(),
    modelsPresentAtInstall: window.viewer.getAllModels().map((m) => (m.getData() && m.getData().urn) || null),
  };
  t3.readinessListener = (ev) => {
    const m = ev && ev.model;
    const rec = { urn: (m && m.getData && m.getData() && m.getData().urn) || null, tEvent: performance.now(), atCall: null, outcome: 'pending' };
    t3.readiness.outcomes.push(rec);
    if (!m) { rec.outcome = 'no-model-on-event'; return; }
    try {
      rec.atCall = {
        isObjectTreeCreated: typeof m.isObjectTreeCreated === 'function' ? m.isObjectTreeCreated() : null,
        instanceTreeInData: !!(m.getData() && m.getData().instanceTree),
        isLoadDone: m.isLoadDone(),
      };
    } catch (e) { rec.atCall = { threw: t3.errOf(e) }; }
    t3.readiness.pending += 1;
    let p;
    try {
      p = enumerator.resolveRoots({ modelKey: `readiness-${rec.urn}`, model: m, modelVersion: 'live', lease: { epoch: 1 } }, 'whole', { checkpoint() {} });
    } catch (e) { p = Promise.reject(e); }
    Promise.resolve(p).then(
      (rr) => { rec.outcome = 'resolved'; rec.result = { roots: rr.roots.length, population: rr.population.count, ownerMismatch: rr.ownerMismatch.count, unreachable: rr.unreachable.count }; },
      (e) => { rec.outcome = 'rejected'; rec.error = t3.errOf(e); rec.isObjectTreeUnavailableError = !!(e && e.name === 'ObjectTreeUnavailableError'); },
    ).finally(() => { rec.tSettled = performance.now(); t3.readiness.pending -= 1; });
  };
  window.viewer.addEventListener(V.MODEL_ADDED_EVENT, t3.readinessListener);
  return { installed: true, modelsPresentAtInstall: t3.readiness.modelsPresentAtInstall };
};

const REMOVE_READINESS_HOOK = () => {
  const t3 = window.__t3;
  if (t3.readinessListener) window.viewer.removeEventListener(window.Autodesk.Viewing.MODEL_ADDED_EVENT, t3.readinessListener);
  t3.readinessListener = null;
  return t3.readiness;
};

/** (a) + (b) + (c) for one model. Read-only. */
const MEASURE_ADAPTER = async ({ which, explicit, sampleEachEnd }) => {
  const t3 = window.__t3;
  const model = t3.models[which];
  const errOf = t3.errOf;
  const { createViewerElementEnumerator } = t3.mod['/clashtest/viewer/index.js'];
  const { extractFragments, extractAllFragments } = t3.mod['/collision/viewer/ViewerModelAdapter.js'];
  const { digestPopulation, digestSubtree } = t3.mod['/clashtest/planning/scopeDigest.js'];
  const enumerator = createViewerElementEnumerator();
  const binding = { modelKey: which, model, modelVersion: 'live', lease: { epoch: 1 } };
  const ctx = { checkpoint() {} };
  const asc = (x, y) => x - y;
  const out = { which };

  // ---- (a)
  let rr;
  try { rr = await enumerator.resolveRoots(binding, 'whole', ctx); } catch (e) { out.a = { threw: errOf(e) }; return out; }
  out.a = {
    ownerMismatchCount: rr.ownerMismatch.count, ownerMismatchFirst20: rr.ownerMismatch.first20,
    unreachableCount: rr.unreachable.count, unreachableOwnerDbIdsCount: rr.unreachable.ownerDbIds.length,
    unattributable: rr.unreachable.unattributable,
    populationCount: rr.population.count, rootsLength: rr.roots.length, unresolvedLength: rr.unresolved.length,
    maxRootFragmentCount: rr.roots.reduce((m, r) => Math.max(m, r.fragmentCount), 0),
    sumRootFragmentCount: rr.roots.reduce((s, r) => s + r.fragmentCount, 0),
  };

  // ---- (b) enumerator == library (per root, then population)
  const fragList = model.getFragmentList();
  const THREE = window.THREE;
  const b = { rootsCompared: 0, sizeMismatch: 0, ownersMismatch: 0, subtreeDigestMismatch: 0, libraryThrew: 0, firstMismatches: [] };
  for (const root of rr.roots) {
    b.rootsCompared += 1;
    let lib;
    try { lib = await extractFragments(model, [root.dbId], 0, { checkpoint: undefined, THREE }); } catch (e) {
      b.libraryThrew += 1;
      if (b.firstMismatches.length < 20) b.firstMismatches.push({ dbId: root.dbId, libraryThrew: errOf(e) });
      continue;
    }
    const owners = [...new Set([...lib.values()].map((r) => r.ownerDbId))].sort(asc);
    const rows = [...lib.values()].map((r) => ({ fragId: r.fragmentId, ownerDbId: r.ownerDbId, geometryId: fragList.getGeometryId(r.fragmentId) }));
    const libDigest = (await digestSubtree(rows)).digest;
    const sizeOk = lib.size === root.fragmentCount;
    const ownersOk = JSON.stringify(owners) === JSON.stringify(root.ownerDbIds);
    const digestOk = libDigest === root.subtreeDigest;
    if (!sizeOk) b.sizeMismatch += 1;
    if (!ownersOk) b.ownersMismatch += 1;
    if (!digestOk) b.subtreeDigestMismatch += 1;
    if ((!sizeOk || !ownersOk || !digestOk) && b.firstMismatches.length < 20) {
      b.firstMismatches.push({ dbId: root.dbId, adapter: { fragmentCount: root.fragmentCount, ownerDbIds: root.ownerDbIds }, library: { size: lib.size, owners } });
    }
  }
  try {
    const { records, diagnostics } = await extractAllFragments(model, 0, { checkpoint: undefined, THREE });
    const dropped = new Map(diagnostics.map((d) => [d.fragment.fragId, (d.reason === 'fragment-not-loaded' || d.reason === 'fragment-null-geometry') ? 'N' : 'U']));
    const rows = [];
    let libOwnerDiffersFromFragList = 0;
    for (let f = 0; f < fragList.getCount(); f++) {
      if (dropped.has(f)) rows.push({ fragId: f, cls: dropped.get(f) });
      else {
        const r = records.get(f);
        if (r.ownerDbId !== fragList.getDbIds(f)) libOwnerDiffersFromFragList += 1;
        rows.push({ fragId: f, cls: 'L', ownerDbId: r.ownerDbId, geometryId: fragList.getGeometryId(f) });
      }
    }
    const expected = await digestPopulation({ count: fragList.getCount(), records: rows });
    b.population = {
      libraryRecords: records.size, libraryDiagnostics: diagnostics.length, libOwnerDiffersFromFragList,
      libraryCount: expected.count, adapterCount: rr.population.count,
      digestEqual: expected.digest === rr.population.digest,
    };
  } catch (e) { b.population = { threw: errOf(e) }; }
  out.b = b;

  // ---- (c) digestScope == resolveRoots
  const c = {};
  try {
    const ds = await enumerator.digestScope(binding, 'whole', ctx);
    c.whole = { kind: ds.kind, countEqual: ds.count === rr.population.count, digestEqual: ds.digest === rr.population.digest };
  } catch (e) { c.whole = { threw: errOf(e) }; }
  const byId = new Map(rr.roots.map((r) => [r.dbId, r]));
  const largest = rr.roots.reduce((m, r) => (m === null || r.fragmentCount > m.fragmentCount ? r : m), null);
  const sampleIds = [...new Set([
    ...rr.roots.slice(0, sampleEachEnd).map((r) => r.dbId),
    ...rr.roots.slice(-sampleEachEnd).map((r) => r.dbId),
    ...(largest ? [largest.dbId] : []),
  ])].sort(asc);
  c.sample = { ids: sampleIds, compared: 0, mismatches: 0, threw: 0, firstMismatches: [] };
  for (const dbId of sampleIds) {
    c.sample.compared += 1;
    try {
      const ds = await enumerator.digestScope(binding, { dbIds: [dbId] }, ctx);
      const w = byId.get(dbId);
      const ok = ds.kind === 'roots' && ds.roots.length === 1 && ds.roots[0].dbId === dbId
        && ds.roots[0].fragmentCount === w.fragmentCount && ds.roots[0].subtreeDigest === w.subtreeDigest;
      if (!ok) { c.sample.mismatches += 1; if (c.sample.firstMismatches.length < 10) c.sample.firstMismatches.push({ dbId, digestScope: ds.roots }); }
    } catch (e) { c.sample.threw += 1; if (c.sample.firstMismatches.length < 10) c.sample.firstMismatches.push({ dbId, threw: errOf(e) }); }
  }
  // One multi-root call: digestScope roots must equal resolveRoots roots for the SAME raw scope (D-V4).
  try {
    const scope = { dbIds: sampleIds };
    const [dsm, rrm] = [await enumerator.digestScope(binding, scope, ctx), await enumerator.resolveRoots(binding, scope, ctx)];
    const key = (rs) => JSON.stringify(rs.map((r) => [r.dbId, r.fragmentCount, r.subtreeDigest]));
    c.multiRoot = { equal: key(dsm.roots) === key(rrm.roots), roots: rrm.roots.length, unresolved: rrm.unresolved };
  } catch (e) { c.multiRoot = { threw: errOf(e) }; }
  c.explicit = [];
  for (const dbId of explicit) {
    const rec = { dbId, isWholeModelRoot: byId.has(dbId) };
    try {
      const rre = await enumerator.resolveRoots(binding, { dbIds: [dbId] }, ctx);
      const dse = await enumerator.digestScope(binding, { dbIds: [dbId] }, ctx);
      const r0 = rre.roots[0];
      rec.resolveRoots = { roots: rre.roots.length, fragmentCount: r0 && r0.fragmentCount, ownerDbIds: r0 && r0.ownerDbIds, unresolved: rre.unresolved };
      rec.digestEqualsResolveRoots = dse.roots.length === 1 && !!r0 && dse.roots[0].subtreeDigest === r0.subtreeDigest && dse.roots[0].fragmentCount === r0.fragmentCount;
      rec.digestEqualsWholeRoot = byId.has(dbId) && !!r0 ? byId.get(dbId).subtreeDigest === r0.subtreeDigest : null;
    } catch (e) { rec.threw = errOf(e); }
    c.explicit.push(rec);
  }
  out.c = c;
  return out;
};

/** (f): G-CAL characterization only. Every number here is RECORDED; none is asserted. */
const PROFILE = async ({ which }) => {
  const t3 = window.__t3;
  const model = t3.models[which];
  const errOf = t3.errOf;
  const { createViewerElementEnumerator } = t3.mod['/clashtest/viewer/index.js'];
  const { frameBudgetMs } = t3.mod['/collision/constants.js'];
  const enumerator = createViewerElementEnumerator();
  const binding = { modelKey: which, model, modelVersion: 'live', lease: { epoch: 1 } };
  const measure = async (fn) => {
    const s = { calls: 0, spans: [], last: 0 };
    const ctx = { checkpoint() { const now = performance.now(); s.spans.push(now - s.last); s.last = now; s.calls += 1; } };
    const t0 = performance.now();
    s.last = t0;
    let error = null;
    try { await fn(ctx); } catch (e) { error = errOf(e); }
    const t1 = performance.now();
    s.spans.push(t1 - s.last);
    return {
      elapsedMs: t1 - t0, checkpointCalls: s.calls,
      // Upper bound of a synchronous span: the interval between consecutive checkpoints also contains any awaits.
      maxSpanBetweenCheckpointsMs: s.spans.reduce((m, x) => Math.max(m, x), 0),
      spansOverFrameBudget: s.spans.filter((x) => x > frameBudgetMs).length,
      frameBudgetMs, error,
    };
  };
  const tree = model.getObjectTree();
  let nodeCount = 0;
  { const seen = new Set(); const st = [tree.getRootId()];
    while (st.length) { const n = st.pop(); if (seen.has(n)) continue; seen.add(n); tree.enumNodeChildren(n, (ch) => { st.push(ch); return false; }, false); }
    nodeCount = seen.size; }
  const firstRoot = (await enumerator.resolveRoots(binding, 'whole', { checkpoint() {} })).roots[0];
  return {
    which, treeNodeCount: nodeCount, fragListCount: model.getFragmentList().getCount(),
    resolveRootsWhole: await measure((ctx) => enumerator.resolveRoots(binding, 'whole', ctx)),
    digestScopeWhole: await measure((ctx) => enumerator.digestScope(binding, 'whole', ctx)),
    // D-V4 cost note: one explicit digestScope = one ids-only whole-tree parent pass + the named subtree.
    digestScopeExplicitOneRoot: firstRoot ? await measure((ctx) => enumerator.digestScope(binding, { dbIds: [firstRoot.dbId] }, ctx)) : null,
  };
};

/** Step 2 negative controls (i)-(v) on Structure. Each perturbation is restored in a `finally`. */
const CONTROL = async ({ which, control }) => {
  const t3 = window.__t3;
  const model = t3.models[which];
  const errOf = t3.errOf;
  const { createViewerElementEnumerator } = t3.mod['/clashtest/viewer/index.js'];
  const enumerator = createViewerElementEnumerator();
  const binding = { modelKey: which, model, modelVersion: 'live', lease: { epoch: 1 } };
  const ctx = { checkpoint() {} };
  const fl = model.getFragmentList();
  const tree = model.getObjectTree();
  const restores = [];
  const out = { control, sameFragListObject: null, sameTreeObject: null };
  try {
    if (control === 'i-wrong-owner') {
      restores.push(t3.patch(fl, 'getDbIds', (orig) => function (f) { const o = orig.call(this, f); return f === 0 && typeof o === 'number' ? o + 1000000 : o; }));
    } else if (control === 'ii-hidden-fragment') {
      restores.push(t3.patch(tree, 'enumNodeFragments', (orig) => function (n, cb, rec) { return orig.call(this, n, (f) => { if (f !== 1) return cb(f); return undefined; }, rec); }));
    } else if (control === 'iii-not-loaded') {
      restores.push(t3.patch(fl, 'isNotLoaded', (orig) => function (f) { return f === 2 ? true : orig.call(this, f); }));
    } else if (control === 'iv-tree-unavailable') {
      restores.push(t3.patch(model, 'isObjectTreeCreated', () => function () { return false; }));
      restores.push(t3.patch(model, 'getObjectTree', (orig) => function (onSuccess, onError) {
        if (typeof onError === 'function') { onError(new Error('T3 control (iv): stubbed getObjectTree onError')); return undefined; }
        return orig.apply(this, arguments);
      }));
    } else if (control === 'v-capacity') {
      out.calls = { enumNodeChildren: 0, enumNodeFragments: 0 };
      restores.push(t3.patch(fl, 'getCount', () => function () { return 20001; }));
      restores.push(t3.patch(tree, 'enumNodeChildren', (orig) => function () { out.calls.enumNodeChildren += 1; return orig.apply(this, arguments); }));
      restores.push(t3.patch(tree, 'enumNodeFragments', (orig) => function () { out.calls.enumNodeFragments += 1; return orig.apply(this, arguments); }));
    } else {
      throw new Error(`unknown control ${control}`);
    }
    out.sameFragListObject = model.getFragmentList() === fl;
    out.sameTreeObject = control === 'iv-tree-unavailable' ? null : model.getObjectTree() === tree;
    try {
      const rr = await enumerator.resolveRoots(binding, 'whole', ctx);
      out.resolved = { ownerMismatchCount: rr.ownerMismatch.count, ownerMismatchFirst: rr.ownerMismatch.first20.slice(0, 3), unreachableCount: rr.unreachable.count, populationCount: rr.population.count, roots: rr.roots.length };
    } catch (e) { out.threw = errOf(e); }
  } finally {
    for (const r of restores.reverse()) r();
  }
  return out;
};

const AFTER_RESTORE_CLEAN = async ({ which }) => {
  const t3 = window.__t3;
  const model = t3.models[which];
  const { createViewerElementEnumerator } = t3.mod['/clashtest/viewer/index.js'];
  const own = (o, n) => Object.prototype.hasOwnProperty.call(o, n);
  const fl = model.getFragmentList();
  const tree = model.getObjectTree();
  try {
    const rr = await createViewerElementEnumerator().resolveRoots({ modelKey: which, model, modelVersion: 'live', lease: { epoch: 1 } }, 'whole', { checkpoint() {} });
    return {
      ownerMismatch: rr.ownerMismatch.count, unreachable: rr.unreachable.count, population: rr.population.count, roots: rr.roots.length,
      leftoverOwnPatches: ['getDbIds', 'isNotLoaded', 'getCount'].filter((n) => own(fl, n))
        .concat(['enumNodeFragments', 'enumNodeChildren'].filter((n) => own(tree, n)).map((n) => `tree.${n}`))
        .concat(['isObjectTreeCreated', 'getObjectTree'].filter((n) => own(model, n)).map((n) => `model.${n}`)),
    };
  } catch (e) { return { threw: t3.errOf(e) }; }
};

/** (e): whole resolveRoots plus fragment ids per root (bounded, non-recursive walk). Read-only. */
const RECORD_WHOLE = async ({ which }) => {
  const t3 = window.__t3;
  const model = t3.models[which];
  const { createViewerElementEnumerator } = t3.mod['/clashtest/viewer/index.js'];
  try {
    const rr = await createViewerElementEnumerator().resolveRoots({ modelKey: which, model, modelVersion: 'live', lease: { epoch: 1 } }, 'whole', { checkpoint() {} });
    const tree = model.getObjectTree();
    const fragIdsOf = (root) => {
      const seen = new Set(); const st = [root]; const frags = [];
      while (st.length) {
        const n = st.pop(); if (seen.has(n)) continue; seen.add(n);
        tree.enumNodeFragments(n, (f) => { frags.push(f); }, false);
        tree.enumNodeChildren(n, (ch) => { st.push(ch); return false; }, false);
      }
      return [...new Set(frags)].sort((a, b) => a - b);
    };
    return {
      modelId: model.id,
      population: rr.population,
      roots: rr.roots.map((r) => ({ dbId: r.dbId, fragmentCount: r.fragmentCount, subtreeDigest: r.subtreeDigest, fragIds: fragIdsOf(r.dbId) })),
    };
  } catch (e) { return { threw: t3.errOf(e) }; }
};

// ---------------------------------------------------------------------------------------------------------------
// (h) in-page steps. State lives in window.__t3.h; every resource is recorded in h.resources, whose fields start
// as null and are set only once the resource really exists.
// ---------------------------------------------------------------------------------------------------------------

const H_SETUP = async ({ K, urn, noWiring, clashFinderId, label }) => {
  const t3 = window.__t3;
  const viewer = window.viewer;
  const h = (t3.h = {
    label, K, phase: 'setup:start', eventName: null, noWiring,
    resources: { probeListener: null, evictShim: null, wiring: null, X: null, Y: null, world: null, engine: null, registry: null },
    probe: [], evictCalls: [], captured: null, enumerator: null,
    initialModels: new Set(viewer.getAllModels()), siblings: null, flags: { yUnloadedInStep4: false, wiringDisposedInStep4: false },
  });
  const r = h.resources;
  const info = {};
  try {
    h.phase = 'setup:event-name';
    h.eventName = window.Autodesk && window.Autodesk.Viewing && window.Autodesk.Viewing.BEFORE_MODEL_UNLOAD_EVENT;
    if (typeof h.eventName !== 'string' || h.eventName === '') throw new Error('Autodesk.Viewing.BEFORE_MODEL_UNLOAD_EVENT is not a non-empty string');
    info.eventName = h.eventName;

    h.phase = 'setup:resolve-X';
    const xs = viewer.getAllModels().filter((m) => m.getData() && m.getData().urn === urn && m.isLoadDone());
    if (xs.length !== 1) throw new Error(`expected exactly one loaded model with the X URN, found ${xs.length}`);
    r.X = xs[0];

    h.phase = 'setup:import:/clashtest/index.js';
    const core = await import('/clashtest/index.js');
    h.phase = 'setup:import:/clashtest/viewer/index.js';
    const adapter = await import('/clashtest/viewer/index.js');
    h.phase = 'setup:import:/collision/index.js';
    const collision = await import('/collision/index.js');

    h.phase = 'setup:CollisionWorld.fromViewer (as ClashFinderExtension.load)';
    const ext = viewer.getExtension(clashFinderId);
    info.clashFinderExtensionLoaded = !!ext;
    // Falling back to default options would NOT be "exactly as the extension constructs it": a failing link.
    if (!ext) throw new Error(`ClashFinderExtension (${clashFinderId}) is not loaded: the world cannot be built exactly as the extension builds its own`);
    info.worldOptionsSource = 'ClashFinderExtension instance options';
    r.world = await collision.CollisionWorld.fromViewer(viewer, ext.options);

    h.phase = 'setup:createClashTestEngine';
    h.enumerator = adapter.createViewerElementEnumerator();
    r.engine = core.createClashTestEngine({ world: r.world, enumerator: h.enumerator });
    r.registry = r.engine.registry;

    h.phase = 'setup:registry.register(K, X)';
    r.registry.register(K, r.X, { modelVersion: 'live-1' });
    const pre = r.registry.bindingFor(K);        // admits X lazily (world.admitModel)
    info.preBindingPresent = pre !== null;
    info.preBindingModelIsX = pre !== null && pre.model === r.X;
    info.preXLive = r.world.isModelLive(r.X);
    if (!info.preBindingModelIsX || info.preXLive !== true) throw new Error('precondition: X is not bound/live after register + bindingFor');

    h.phase = 'setup:probe-listener';
    const probe = (ev) => {
      const m = ev && ev.model;
      let bindingPresent;
      try { bindingPresent = r.registry.bindingFor(K) !== null; } catch (e) { bindingPresent = { threw: t3.errOf(e) }; }
      h.probe.push({ modelIs: m === r.X ? 'X' : (m === r.Y && m !== null ? 'Y' : 'other'), bindingPresent, t: performance.now() });
    };
    viewer.addEventListener(h.eventName, probe);   // BEFORE the wiring: dispatch order = registration order
    r.probeListener = probe;

    h.phase = 'setup:evictModel-shim';
    const original = r.world.evictModel;
    const hadOwn = Object.prototype.hasOwnProperty.call(r.world, 'evictModel');
    r.world.evictModel = function (m) {
      let bindingNullAtCall;
      try { bindingNullAtCall = r.registry.bindingFor(K) === null; } catch (e) { bindingNullAtCall = { threw: t3.errOf(e) }; }
      h.evictCalls.push({ modelIs: m === r.X ? 'X' : (m === r.Y && m !== null ? 'Y' : 'other'), bindingNullAtCall });
      return original.call(this, m);
    };
    r.evictShim = { original, hadOwn };

    if (!noWiring) {
      h.phase = 'setup:wireModelUnload';
      const recorder = {
        addEventListener(n, f) { h.captured = f; viewer.addEventListener(n, f); },
        removeEventListener(n, f) { viewer.removeEventListener(n, f); },
      };
      r.wiring = adapter.wireModelUnload({ world: r.world, registry: r.registry, eventTarget: recorder, eventName: h.eventName });
      info.handlerCaptured = typeof h.captured === 'function';
      if (!info.handlerCaptured) throw new Error('wireModelUnload did not register a handler through the recorder');
    }
    h.phase = 'setup:done';
    return { ok: true, info };
  } catch (e) {
    return { ok: false, phase: h.phase, error: t3.errOf(e), info };
  }
};

const H_STEP1_UNLOAD = () => { const h = window.__t3.h; h.phase = 'step1:unloadModel(X)'; window.viewer.unloadModel(h.resources.X); };
const X_GONE = () => !window.viewer.getAllModels().includes(window.__t3.h.resources.X);

const H_STEP1_ASSERT = () => {
  const t3 = window.__t3; const h = t3.h; const r = h.resources;
  h.phase = 'step1:assert';
  h.siblings = new Set(window.viewer.getAllModels());   // expected-sibling snapshot, right after X disappeared
  const probeX = h.probe.filter((p) => p.modelIs === 'X');
  const evictX = h.evictCalls.filter((c) => c.modelIs === 'X');
  let bindingNull; let xLive;
  try { bindingNull = r.registry.bindingFor(h.K) === null; } catch (e) { bindingNull = { threw: t3.errOf(e) }; }
  try { xLive = r.world.isModelLive(r.X); } catch (e) { xLive = { threw: t3.errOf(e) }; }
  return {
    siblingCount: h.siblings.size,
    assertions: [
      ['probeSawX', 'probe listener saw event.model === X', probeX.length >= 1, { probeXEvents: probeX.length }],
      ['probeSawBindingPresent', 'probe saw the binding still present at dispatch', probeX.length >= 1 && probeX[0].bindingPresent === true, probeX[0] || null],
      ['evictCalledForX', 'world.evictModel shim was called for X', evictX.length >= 1, { evictXCalls: evictX.length }],
      ['evictSawBindingNull', 'evictModel shim saw registry.bindingFor(K) already null (unregister ran before evict)', evictX.length >= 1 && evictX[0].bindingNullAtCall === true, evictX[0] || null],
      ['bindingNullAfterUnload', 'registry.bindingFor(K) === null after the unload', bindingNull === true, bindingNull],
      ['xNotLiveAfterUnload', 'world.isModelLive(X) === false after the unload', xLive === false, xLive],
    ],
  };
};

const Y_APPEARED = (urn) => {
  const h = window.__t3.h;
  return window.viewer.getAllModels().some((m) => !h.siblings.has(m) && m !== h.resources.X && m.getData() && m.getData().urn === urn && m.isLoadDone());
};

const H_STEP2_ASSERT = ({ urn }) => {
  const t3 = window.__t3; const h = t3.h; const r = h.resources;
  h.phase = 'step2:select-Y';
  const candidates = window.viewer.getAllModels().filter((m) => !h.siblings.has(m) && m !== r.X && m.getData() && m.getData().urn === urn && m.isLoadDone());
  if (candidates.length !== 1) return { linkError: { phase: h.phase, message: `expected exactly one new model with the reloaded URN, found ${candidates.length}` } };
  r.Y = candidates[0];
  h.phase = 'step2:register(K, Y)';
  let registerOk = true; let registerError = null;
  try { r.registry.register(h.K, r.Y, { modelVersion: 'live-1' }); } catch (e) { registerOk = false; registerError = t3.errOf(e); }
  return {
    assertions: [
      ['yIsNotX', 'Y !== X', r.Y !== r.X, null],
      ['yAbsentFromSiblings', 'Y is absent from the expected-sibling snapshot', !h.siblings.has(r.Y), null],
      ['registerYSucceeds', "registry.register(K, Y, { modelVersion: 'live-1' }) succeeds (a ModelKeyVersionConflictError is a FAILURE)", registerOk, registerError],
    ],
  };
};

const H_STEP3 = async ({ step3Model }) => {
  const t3 = window.__t3; const h = t3.h; const r = h.resources;
  h.phase = 'step3:late-unload';
  if (typeof h.captured !== 'function') return { linkError: { phase: h.phase, message: 'no captured wiring handler (wiring not installed)' } };
  const target = step3Model === 'Y' ? r.Y : r.X;   // 'Y' is the sensitivity control only
  let handlerThrew = null;
  try { h.captured({ model: target }); } catch (e) { handlerThrew = t3.errOf(e); }
  let b = null; let bErr = null;
  try { b = r.registry.bindingFor(h.K); } catch (e) { bErr = t3.errOf(e); }
  let yLive;
  try { yLive = r.world.isModelLive(r.Y); } catch (e) { yLive = { threw: t3.errOf(e) }; }
  let rrOk = false; let rrActual = null;
  if (b !== null) {
    try {
      const rr = await h.enumerator.resolveRoots(b, 'whole', { checkpoint() {} });
      rrOk = rr.roots.length > 0 && rr.population.count > 0;
      rrActual = { roots: rr.roots.length, population: rr.population.count, ownerMismatch: rr.ownerMismatch.count, unreachable: rr.unreachable.count };
    } catch (e) { rrActual = { threw: t3.errOf(e) }; }
  } else rrActual = { skipped: 'no live binding for K', bindingError: bErr };
  return {
    assertions: [
      ['handlerNeverThrows', 'the wiring handler did not throw', handlerThrew === null, handlerThrew],
      ['bindingModelIsY', 'registry.bindingFor(K).model === Y after the late unload of X', b !== null && b.model === r.Y, bErr],
      ['yLive', 'world.isModelLive(Y) === true', yLive === true, yLive],
      ['resolveRootsOnY', "resolveRoots({ modelKey: K, model: Y, ... }, 'whole', ctx) succeeds", rrOk, rrActual],
    ],
  };
};

const H_STEP4_UNLOAD = ({ skipDispose }) => {
  const h = window.__t3.h; const r = h.resources;
  h.phase = 'step4:dispose+unloadModel(Y)';
  if (!skipDispose) { r.wiring.dispose(); h.flags.wiringDisposedInStep4 = true; }
  window.viewer.unloadModel(r.Y);
};
const Y_GONE = () => !window.viewer.getAllModels().includes(window.__t3.h.resources.Y);

const H_STEP4_ASSERT = () => {
  const t3 = window.__t3; const h = t3.h; const r = h.resources;
  h.phase = 'step4:assert';
  h.flags.yUnloadedInStep4 = true;
  let b = null; let bErr = null;
  try { b = r.registry.bindingFor(h.K); } catch (e) { bErr = t3.errOf(e); }
  let yLive;
  try { yLive = r.world.isModelLive(r.Y); } catch (e) { yLive = { threw: t3.errOf(e) }; }
  const evictY = h.evictCalls.filter((c) => c.modelIs === 'Y').length;
  return {
    assertions: [
      ['bindingSurvivesYUnload', 'registry.bindingFor(K) still non-null (model Y) after dispose + unload(Y)', b !== null && b.model === r.Y, bErr],
      ['yStillLive', 'world.isModelLive(Y) still true', yLive === true, yLive],
      ['noEvictForY', 'the disposed wiring did not evict Y', evictY === 0, { evictYCalls: evictY }],
    ],
  };
};

/** Seven-step guarded cleanup + postcondition (c). Never throws; failures are collected as { step, error }. */
const H_CLEANUP = async ({ inject }) => {
  const t3 = window.__t3;
  const h = t3 && t3.h;
  const viewer = window.viewer;
  const out = { hadState: !!h, done: {}, realCallMade: {}, failures: [], post: {} };
  if (!h) { out.post.ok = true; out.post.note = 'setup never created (h) state: nothing to release'; return out; }
  const r = h.resources;
  const errOf = t3.errOf;
  // (i) guarded on its own resource, (ii) own try/catch. An injected failure runs AFTER the real call (no leak).
  const step = async (name, guard, fn) => {
    try {
      if (!guard()) { out.done[name] = 'skipped'; return; }
      await fn();
      out.realCallMade[name] = true;
      if (inject === name) throw new Error(`T3 control: injected cleanup failure at ${name} (after the real call)`);
      out.done[name] = 'ran';
    } catch (e) {
      out.done[name] = 'threw';
      out.failures.push({ step: name, error: errOf(e) });
    }
  };
  await step('1.disposeWiring', () => r.wiring !== null, () => r.wiring.dispose());
  await step('2.removeProbeListener', () => r.probeListener !== null, () => viewer.removeEventListener(h.eventName, r.probeListener));
  await step('3.restoreEvictModel', () => r.world !== null && r.evictShim !== null, () => {
    if (r.evictShim.hadOwn) r.world.evictModel = r.evictShim.original; else delete r.world.evictModel;
  });
  await step('4a.unregisterX', () => r.registry !== null && r.X !== null, () => { r.registry.unregister(r.X); });
  await step('4b.unregisterY', () => r.registry !== null && r.Y !== null, () => { r.registry.unregister(r.Y); });
  try { out.post.bindingNullAfterUnregister = r.registry === null ? true : r.registry.bindingFor(h.K) === null; } catch (e) { out.post.bindingNullAfterUnregister = { threw: errOf(e) }; }
  // isModelLive throws once the world is disposed -- which is why eviction runs before step 7.
  await step('5a.evictX', () => r.world !== null && r.X !== null && r.world.isModelLive(r.X) === true, () => r.world.evictModel(r.X));
  await step('5b.evictY', () => r.world !== null && r.Y !== null && r.world.isModelLive(r.Y) === true, () => r.world.evictModel(r.Y));
  await step('6.disposeEngine', () => r.engine !== null, async () => { await r.engine.dispose(); });
  await step('7.disposeWorld', () => r.world !== null, () => r.world.dispose());   // once, and only here

  // ---- postcondition (c)
  const post = out.post;
  post.hasEventListenerAvailable = typeof viewer.hasEventListener === 'function';
  if (post.hasEventListenerAvailable) {
    post.probeListenerRemains = r.probeListener ? !!viewer.hasEventListener(h.eventName, r.probeListener) : false;
    post.wiringHandlerRemains = h.captured ? !!viewer.hasEventListener(h.eventName, h.captured) : false;
  }
  post.evictModelIsOriginal = r.world === null || r.evictShim === null
    ? true
    : r.world.evictModel === r.evictShim.original && Object.prototype.hasOwnProperty.call(r.world, 'evictModel') === r.evictShim.hadOwn;
  try { post.bindingNullPost = r.registry === null ? true : r.registry.bindingFor(h.K) === null; } catch (e) { post.bindingNullPost = { threw: errOf(e) }; }
  post.engineDisposed = r.engine === null || out.realCallMade['6.disposeEngine'] === true;
  if (r.world === null) post.worldDisposed = true;
  else { try { r.world.isModelLive({}); post.worldDisposed = false; } catch (e) { post.worldDisposed = !!(e && e.name === 'WorldDisposedError'); } }
  const now = viewer.getAllModels();
  const basis = h.siblings || h.initialModels;
  post.modelBasis = h.siblings ? 'expected-sibling snapshot (after X disappeared in step 1)' : 'pre-run snapshot (step 1 never completed)';
  const extra = now.filter((m) => !basis.has(m));
  post.extraModels = extra.map((m) => (m === r.Y ? 'Y' : m === r.X ? 'X' : 'other'));
  post.missingModels = [...basis].filter((m) => !now.includes(m)).length;
  post.yLoadedAndNotUnloaded = r.Y !== null && !h.flags.yUnloadedInStep4;
  post.modelsOk = post.missingModels === 0
    && (extra.length === 0 || (post.yLoadedAndNotUnloaded && extra.length === 1 && extra[0] === r.Y));
  post.ok = post.hasEventListenerAvailable === true && post.probeListenerRemains === false && post.wiringHandlerRemains === false
    && post.evictModelIsOriginal === true && post.bindingNullAfterUnregister === true && post.bindingNullPost === true
    && post.engineDisposed === true && post.worldDisposed === true && post.modelsOk === true;

  // Archive for the end-of-run behavioral check (the removed probe must never fire again), then drop state.
  t3.hArchive = t3.hArchive || {};
  t3.hArchive[h.label] = { probe: h.probe, probeLenAtCleanup: h.probe.length };
  t3.h = null;
  return out;
};

// ================================================================================================================
// Node-side (h) driver: primary failure first, cleanup always, exact primary re-thrown.
// ================================================================================================================

class HFailure extends Error {
  constructor(link, detail, failedAssertions = []) {
    super(`T3 (h) failed at ${link}${failedAssertions.length ? `: ${failedAssertions.join(', ')}` : ''}`);
    this.name = 'HFailure';
    this.link = link;
    this.detail = detail;
    this.failedAssertions = failedAssertions;
  }
}

function recordStep(rep, stepName, s) {
  rep.steps[stepName] = s;
  if (s && s.linkError) throw new HFailure(`${stepName}:${s.linkError.phase}`, s.linkError);
  for (const [key, description, ok, actual] of s.assertions) rep.assertions.push({ step: stepName, key, description, ok, actual });
  const failed = s.assertions.filter(([, , ok]) => !ok).map(([key]) => key);
  if (failed.length > 0) throw new HFailure(`${stepName}:assertion`, null, failed);
}

async function ensureStructLoaded(page) {
  const n = await page.evaluate((u) => window.viewer.getAllModels().filter((m) => m.getData() && m.getData().urn === u).length, URN_STRUCT);
  if (n === 0) await reloadViaUi(page, URN_STRUCT, 'harness:restore-structure');
  const after = await page.evaluate((u) => window.viewer.getAllModels().filter((m) => m.getData() && m.getData().urn === u && m.isLoadDone()).length, URN_STRUCT);
  if (after !== 1) throw new HFailure('harness:ensure-structure', { structureModels: after });
}

/** The evidenced UI path (#urn / #keep-current-models / #load); event-driven wait for a NEW model with that URN. */
async function reloadViaUi(page, urn, label) {
  results.phase = `${label}:reload`;
  await page.evaluate(() => { window.__t3.reloadBefore = new Set(window.viewer.getAllModels()); });
  await page.fill('#urn', urn);
  await page.check('#keep-current-models');
  await page.click('#load');
  await page.waitForFunction((u) => window.viewer.getAllModels().some((m) => !window.__t3.reloadBefore.has(m) && m.getData() && m.getData().urn === u && m.isLoadDone()), urn, { timeout: LOAD_TIMEOUT_MS });
  return page.evaluate((u) => {
    const ms = window.viewer.getAllModels().filter((m) => !window.__t3.reloadBefore.has(m) && m.getData() && m.getData().urn === u && m.isLoadDone());
    window.__t3.reloaded = ms.length === 1 ? ms[0] : null;
    return { candidates: ms.length };
  }, urn);
}

/**
 * One (h) run. opts: noWiring, forceReloadTimeout, injectCleanupFailure, step3Model ('X' | 'Y'), skipDisposeInStep4.
 * `observer.report` is set immediately; `observer.primary` is the exact primary failure value when there is one.
 */
async function runH(page, label, opts, observer) {
  const rep = { label, opts, phase: 'not-started', setup: null, steps: {}, assertions: [], cleanup: null, cleanupFailures: [], attachment: null, primary: null, failingLink: null };
  observer.report = rep;
  let primaryFailed = false;
  let primary;
  try {
    rep.phase = 'setup';
    rep.setup = await page.evaluate(H_SETUP, { K: H_MODEL_KEY, urn: URN_STRUCT, noWiring: !!opts.noWiring, clashFinderId: CLASH_FINDER_EXTENSION_ID, label });
    if (!rep.setup.ok) throw new HFailure(rep.setup.phase, rep.setup.error);

    rep.phase = 'step1:unloadModel(X)';
    await page.evaluate(H_STEP1_UNLOAD);
    rep.phase = 'step1:wait-X-gone';
    await page.waitForFunction(X_GONE, null, { timeout: LOAD_TIMEOUT_MS });
    rep.phase = 'step1:assert';
    recordStep(rep, 'step1', await page.evaluate(H_STEP1_ASSERT));

    rep.phase = 'step2:reload-wait';
    if (opts.forceReloadTimeout) {
      // Control: no reload is ever requested, so this event-driven wait can only time out (deterministic abort).
      await page.waitForFunction(Y_APPEARED, URN_STRUCT, { timeout: FORCED_RELOAD_TIMEOUT_MS });
    } else {
      await page.fill('#urn', URN_STRUCT);
      await page.check('#keep-current-models');
      await page.click('#load');
      await page.waitForFunction(Y_APPEARED, URN_STRUCT, { timeout: LOAD_TIMEOUT_MS });
    }
    rep.phase = 'step2:assert';
    recordStep(rep, 'step2', await page.evaluate(H_STEP2_ASSERT, { urn: URN_STRUCT }));

    rep.phase = 'step3';
    recordStep(rep, 'step3', await page.evaluate(H_STEP3, { step3Model: opts.step3Model || 'X' }));

    rep.phase = 'step4:dispose+unload(Y)';
    await page.evaluate(H_STEP4_UNLOAD, { skipDispose: !!opts.skipDisposeInStep4 });
    rep.phase = 'step4:wait-Y-gone';
    await page.waitForFunction(Y_GONE, null, { timeout: LOAD_TIMEOUT_MS });
    rep.phase = 'step4:assert';
    recordStep(rep, 'step4', await page.evaluate(H_STEP4_ASSERT));
    rep.phase = 'done';
  } catch (e) {
    primaryFailed = true;
    primary = e;
    observer.primary = e;
    rep.primary = describeError(e);
    rep.failingLink = rep.phase;
    throw e;                                  // after `finally`, this exact value propagates
  } finally {
    let cleanup;
    try {
      cleanup = await page.evaluate(H_CLEANUP, { inject: opts.injectCleanupFailure || null });
    } catch (e) {
      cleanup = { evaluateFailed: describeError(e), done: {}, failures: [{ step: 'cleanup-evaluate', error: describeError(e) }], post: { ok: false } };
    }
    rep.cleanup = cleanup;
    rep.cleanupFailures = cleanup.failures;
    if (primaryFailed) {
      if (rep.cleanupFailures.length > 0) {
        // Best effort: the primary may be a primitive or non-extensible (strict mode throws); never replaces it.
        try { primary.cleanupFailures = rep.cleanupFailures; rep.attachment = 'attached'; } catch (attachError) { rep.attachment = { failed: describeError(attachError) }; }
      } else {
        rep.attachment = 'not-needed';
      }
    } else if (rep.cleanupFailures.length > 0) {
      // A passing test with a failed cleanup is still a failed run; there is no primary to mask.
      const errors = rep.cleanupFailures.map((f) => Object.assign(new Error(`${f.step}: ${f.error && f.error.message}`), { step: f.step, detail: f.error }));
      throw new AggregateError(errors, `T3 (h) [${label}]: test passed but ${errors.length} cleanup step(s) failed`);
    }
  }
  return rep;
}

/** Runs a control; returns { thrown, observer } without letting its (expected) failure escape. */
async function runControl(page, label, opts) {
  results.phase = `h:${label}`;
  await ensureStructLoaded(page);
  const observer = {};
  let thrown = null; let threw = false;
  try { await runH(page, label, opts, observer); } catch (e) { threw = true; thrown = e; }
  results.h.runs[label] = observer.report;
  return { threw, thrown, observer, rep: observer.report };
}

const hasAll = (arr, keys) => keys.every((k) => (arr || []).includes(k));

// ================================================================================================================

let browser;

async function main() {
  await mkdir(RESULTS_DIR, { recursive: true });
  // ---- OQ-4 Appendix A launch (same args as clash-finder.acceptance.mjs)
  const t0 = Date.now();
  browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage', '--single-process', '--no-zygote'], proxy: resolveProxyFromEnv() });
  const page = await browser.newPage({ viewport: { width: 1280, height: 2000 } });
  page.on('console', (m) => { if (m.type() === 'error') { console.log(`  [console.error] ${m.text()}`); results.consoleErrors.push(m.text()); } });
  page.on('pageerror', (e) => { console.log(`  [pageerror] ${e}`); results.pageErrors.push(String(e)); });

  // ---- /clashtest/** served from this repository (server.js serves /collision only; server.js is not modified)
  await page.route('**/clashtest/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(BASE_URL).origin) return route.continue();
    const rel = decodeURIComponent(url.pathname).replace(/^\/clashtest\//, '');
    const abs = path.resolve(CLASHTEST_DIR, rel);
    if (!abs.startsWith(CLASHTEST_DIR + path.sep) || !abs.endsWith('.js')) return route.fulfill({ status: 404, body: 'not served by T3' });
    try { await stat(abs); } catch { return route.fulfill({ status: 404, body: 'not found' }); }
    return route.fulfill({ path: abs, contentType: 'text/javascript' });
  });

  // ---- OQ-4 Appendix A readiness sampler + fixture loading (verbatim)
  const timeline = [];
  const sample = async (label) => {
    const s = await page.evaluate(() => {
      const ms = window.viewer ? window.viewer.getAllModels() : [];
      return { models: ms.length, loadDone: ms.map((m) => m.isLoadDone()), tree: ms.map((m) => !!(m.getData() && m.getData().instanceTree)), events: window.__events || [] };
    });
    timeline.push({ label, tMs: Date.now() - t0, ...s });
    return s;
  };
  const installEvents = () => page.evaluate(() => {
    window.__events = window.__events || [];
    if (window.__eventsInstalled) return; window.__eventsInstalled = true;
    const V = window.Autodesk.Viewing;
    window.__ready = {}; window.__snaps = [];
    const snap = (name, model) => {
      const urn = model.getData().urn; const fl = model.getFragmentList(); const it = model.getData().instanceTree;
      const out = { name, urn, t: performance.now(), isLoadDone: model.isLoadDone(), fragListCount: fl.getCount(), notLoaded: 0, tree: !!it };
      for (let f = 0; f < out.fragListCount; f++) if (fl.isNotLoaded(f)) out.notLoaded++;
      if (it) {
        const seen = new Set(); const st = [it.getRootId()]; const frs = new Set(); let ownSum = 0;
        while (st.length) { const n = st.pop(); if (seen.has(n)) continue; seen.add(n);
          it.enumNodeFragments(n, (f) => { ownSum++; frs.add(f); }, false);
          it.enumNodeChildren(n, (c) => { st.push(c); return false; }, false); }
        out.nodeCount = seen.size; out.ownFragmentCallbacks = ownSum; out.distinctTreeFragments = frs.size;
      }
      window.__snaps.push(out);
    };
    setInterval(() => {
      for (const m of window.viewer.getAllModels()) {
        const u = m.getData() && m.getData().urn; if (!u) continue;
        const r = (window.__ready[u] = window.__ready[u] || { firstSeen: performance.now() });
        const done = m.isLoadDone(), tree = !!(m.getData() && m.getData().instanceTree), otc = typeof m.isObjectTreeCreated === 'function' ? m.isObjectTreeCreated() : null;
        if (done && r.loadDone === undefined) r.loadDone = performance.now();
        if (tree && r.instanceTreeInData === undefined) r.instanceTreeInData = performance.now();
        if (otc && r.isObjectTreeCreated === undefined) r.isObjectTreeCreated = performance.now();
      }
    }, 5);
    for (const name of ['OBJECT_TREE_CREATED_EVENT', 'GEOMETRY_LOADED_EVENT', 'MODEL_ADDED_EVENT']) {
      if (!V[name]) { window.__events.push({ name, missing: true }); continue; }
      window.viewer.addEventListener(V[name], (ev) => {
        window.__events.push({ name, t: performance.now(), hasModel: !!(ev && ev.model), urn: ev && ev.model && ev.model.getData && ev.model.getData().urn });
        if ((name === 'OBJECT_TREE_CREATED_EVENT' || name === 'GEOMETRY_LOADED_EVENT') && ev && ev.model) { try { snap(name, ev.model); } catch (e) { window.__snaps.push({ name, error: String(e) }); } }
      });
    }
  });

  results.phase = 'load:model-1';
  console.log('[T3] model 1 (Architecture)');
  await page.goto(`${BASE_URL}/#${URN_ARCH}`);
  await page.waitForFunction(() => window.viewer && window.viewer.getAllModels, null, { timeout: 120_000 });
  await installEvents();
  await sample('viewer-present');

  // ---- FIRST in-page import: confirms /clashtest is browser-loadable (the brief's "confirmed, not assumed").
  results.phase = 'import:/clashtest/viewer/index.js (first in-page import)';
  results.imports = await page.evaluate(INSTALL_T3);
  const importsOk = Object.values(results.imports).every((x) => x.ok);
  for (const [spec, r] of Object.entries(results.imports)) check(`[import] ${spec} loads in-page with the required exports`, r.ok, true);
  if (!importsOk) {
    const bad = Object.entries(results.imports).filter(([, r]) => !r.ok).map(([s, r]) => ({ spec: s, missing: r.missing, error: r.error }));
    throw Object.assign(new Error(`in-page import failed: ${JSON.stringify(bad)}`), { link: `import:${bad[0].spec}` });
  }
  results.phase = 'readiness:install-hook';
  results.readinessHookInstall = await page.evaluate(INSTALL_READINESS_HOOK);

  results.phase = 'load:model-1-wait';
  await page.waitForFunction(() => window.viewer.model && window.viewer.model.isLoadDone(), null, { timeout: 180_000 });
  await sample('m1-loadDone');
  results.phase = 'load:model-2';
  console.log('[T3] model 2 (Structure)');
  await page.fill('#urn', URN_STRUCT); await page.check('#keep-current-models'); await page.click('#load');
  await page.waitForFunction(() => window.viewer.getAllModels().length === 2 && window.viewer.getAllModels().every((m) => m.isLoadDone()), null, { timeout: 180_000 });
  await sample('m2-loadDone');
  results.phase = 'load:model-3';
  console.log('[T3] model 3 (Mechanical)');
  await page.fill('#urn', URN_MECH); await page.check('#keep-current-models'); await page.click('#load');
  await page.waitForFunction(() => window.viewer.getAllModels().length === 3 && window.viewer.getAllModels().every((m) => m.isLoadDone()), null, { timeout: 180_000 });
  await sample('m3-loadDone');
  // tree-readiness: poll until every model has its instance tree (records how long isLoadDone() alone was insufficient)
  let polls = 0; let s;
  do { s = await sample(`tree-poll-${polls}`); if (s.tree.every(Boolean)) break; await page.waitForTimeout(50); polls++; } while (polls < 400);
  const readinessSignals = await page.evaluate(({ urns }) => {
    const ms = window.viewer.getAllModels();
    return ms.map((m) => {
      const out = { urn: m.getData().urn, isLoadDone: m.isLoadDone(), hasInstanceTreeInData: !!m.getData().instanceTree,
        hasGetObjectTree: typeof m.getObjectTree === 'function', hasIsObjectTreeCreated: typeof m.isObjectTreeCreated === 'function' };
      try { out.isObjectTreeCreated = typeof m.isObjectTreeCreated === 'function' ? m.isObjectTreeCreated() : null; } catch (e) { out.isObjectTreeCreatedThrew = String(e); }
      try { const t = m.getObjectTree(); out.getObjectTreeSyncReturnsTree = !!t; } catch (e) { out.getObjectTreeThrew = String(e); }
      try { const t = m.getInstanceTree ? m.getInstanceTree() : undefined; out.getInstanceTreeReturnsTree = !!t; } catch (e) { out.getInstanceTreeThrew = String(e); }
      return out;
    });
  }, { urns: [] });

  // ---- models by URN (never by load order)
  const modelIdentities = await page.evaluate(({ a, s, m }) => {
    const ms = window.viewer.getAllModels();
    window.__t3.models = { arch: ms.find((x) => x.getData().urn === a), struct: ms.find((x) => x.getData().urn === s), mech: ms.find((x) => x.getData().urn === m) };
    return { count: ms.length, arch: !!window.__t3.models.arch, struct: !!window.__t3.models.struct, mech: !!window.__t3.models.mech };
  }, { a: URN_ARCH, s: URN_STRUCT, m: URN_MECH });
  check('[load] exactly three Model objects loaded', modelIdentities.count, 3);
  check('[load] all three models resolved by URN', [modelIdentities.arch, modelIdentities.struct, modelIdentities.mech], [true, true, true]);

  // ---- environment (OQ-4 Appendix A `env`, verbatim) + envelope checks
  results.phase = 'env';
  const env = await page.evaluate(() => ({
    userAgent: navigator.userAgent,
    viewerScripts: [...document.scripts].map((x) => x.src).filter((x) => /viewer3D/.test(x)),
    viewerVersion: (window.Autodesk && window.Autodesk.Viewing && (window.Autodesk.Viewing.getVersion ? window.Autodesk.Viewing.getVersion() : window.Autodesk.Viewing.Private && window.Autodesk.Viewing.Private.LMV_VIEWER_VERSION)) || null,
    threeRevision: window.THREE && window.THREE.REVISION,
    modelNames: window.viewer.getAllModels().map((m) => ({ urn: m.getData().urn, loadOptions: m.getData().loadOptions ? Object.keys(m.getData().loadOptions) : null, isOTG: typeof m.isOTG === 'function' ? m.isOTG() : null, is3d: typeof m.is3d === 'function' ? m.is3d() : null })),
  }));
  const browserVersion = browser.version();
  results.env = { ...env, chromium: browserVersion, node: process.version, baseUrl: BASE_URL };
  check('[env] Viewer script is the pinned 7.124.2 build', env.viewerScripts.some((src) => src.includes(`/${ENVELOPE.viewerVersion}/`)), true);
  check('[env] Chromium major version is 151 (accepted envelope)', Number(String(browserVersion).split('.')[0]), ENVELOPE.chromiumMajor);
  check('[env] every model is SVF (isOTG === false) and 3D', env.modelNames.map((m) => [m.isOTG, m.is3d]), [[false, true], [false, true], [false, true]]);

  // ---- (d) readiness: wait (event-driven) for every immediate MODEL_ADDED resolveRoots to settle, then record.
  results.phase = 'd:readiness-settle';
  await page.waitForFunction(() => window.__t3.readiness.pending === 0, null, { timeout: LOAD_TIMEOUT_MS });
  results.readiness = {
    note: 'RECORDED ONLY (G-VA-READY): no readiness-gate sufficiency is asserted.',
    readinessSignals,
    fineReadiness: await page.evaluate(() => window.__ready),
    events: await page.evaluate(() => window.__events),
    eventSnapshots: await page.evaluate(() => window.__snaps),
    treePollsBeforeAllTreesPresent: polls,
    timeline: timeline.filter((t) => !t.label.startsWith('tree-poll-') || t.label === 'tree-poll-0' || t.tree.every(Boolean)),
    immediateResolveRootsOnModelAdded: await page.evaluate(() => window.__t3.readiness),
  };
  console.log('\n=== (d) readiness: immediate whole resolveRoots inside MODEL_ADDED (recorded, not asserted) ===');
  for (const o of results.readiness.immediateResolveRootsOnModelAdded.outcomes) {
    const name = o.urn ? Buffer.from(o.urn, 'base64').toString().split('/').pop() : '(no urn)';
    console.log(`  ${name}: ${o.outcome}${o.error ? ` (${o.error.name}${o.error.reason ? `:${o.error.reason}` : ''})` : ''} atCall=${JSON.stringify(o.atCall)}`);
  }
  if (!results.readiness.immediateResolveRootsOnModelAdded.outcomes.some((o) => o.urn === URN_ARCH)) {
    console.log('  Architecture: MODEL_ADDED fired before the hook could be installed (recorded, as in OQ-4)');
  }

  // ---- (a) (b) (c)
  for (const which of ['arch', 'struct', 'mech']) {
    results.phase = `abc:${which}`;
    console.log(`\n=== (a)(b)(c) ${which} ===`);
    const m = await page.evaluate(MEASURE_ADAPTER, { which, explicit: which === 'struct' ? EXPLICIT_STRUCT_ROOTS : [], sampleEachEnd: ROOT_SAMPLE_EACH_END });
    results.measurements[which] = m;
    // D-V9: a rejection (EnumerationBoundExceededError / CapacityExceededError) is a FINDING, reported, never retried.
    if (!check(`[a][${which}] whole resolveRoots succeeds (a D-V9 bound/capacity rejection here is a finding: the model would be refused)`, m.a.threw ?? null, null)) continue;
    const ex = EXPECTED[which];
    check(`[a][${which}] ownerMismatch.count === 0`, m.a.ownerMismatchCount, 0);
    check(`[a][${which}] unreachable.count === 0`, m.a.unreachableCount, 0);
    check(`[a][${which}] unreachable.unattributable both 0`, m.a.unattributable, { notLoaded: 0, ownerUnresolvable: 0 });
    check(`[a][${which}] population.count equals the OQ-4 value`, m.a.populationCount, ex.population);
    check(`[a][${which}] roots.length equals the OQ-4 value`, m.a.rootsLength, ex.roots);
    console.log(`  D-V9 record: max(roots[].fragmentCount) = ${m.a.maxRootFragmentCount}`);
    check(`[b][${which}] every root compared against extractFragments`, m.b.rootsCompared, ex.roots);
    check(`[b][${which}] per-root mismatches (size / owners / subtree digest / library threw) all 0`, [m.b.sizeMismatch, m.b.ownersMismatch, m.b.subtreeDigestMismatch, m.b.libraryThrew], [0, 0, 0, 0]);
    check(`[b][${which}] population digest recomputed from extractAllFragments equals the adapter's`, m.b.population.digestEqual ?? m.b.population, true);
    check(`[b][${which}] extractAllFragments owner differs from fragList.getDbIds: 0`, m.b.population.libOwnerDiffersFromFragList, 0);
    check(`[c][${which}] digestScope('whole') equals resolveRoots population (count, digest)`, [m.c.whole.kind, m.c.whole.countEqual, m.c.whole.digestEqual], ['population', true, true]);
    check(`[c][${which}] sampled per-root digestScope == resolveRoots (mismatches, throws)`, [m.c.sample.mismatches, m.c.sample.threw], [0, 0]);
    check(`[c][${which}] one multi-root digestScope equals resolveRoots for the same scope`, m.c.multiRoot.equal ?? m.c.multiRoot, true);
    for (const e of m.c.explicit) {
      check(`[c][${which}] explicit root ${e.dbId}: exactly 1 fragment owned by itself, digestScope == resolveRoots`,
        e.threw ? { threw: e.threw } : [e.resolveRoots.roots, e.resolveRoots.fragmentCount, e.resolveRoots.ownerDbIds, e.resolveRoots.unresolved, e.digestEqualsResolveRoots],
        [1, 1, [e.dbId], [], true]);
    }
  }

  // ---- (f) G-CAL characterization on the largest model -- RECORDED, NEVER ASSERTED
  results.phase = 'f:profile';
  results.profile = { note: 'G-CAL characterization only; no value is asserted.', ...(await page.evaluate(PROFILE, { which: 'arch' })) };
  console.log(`\n=== (f) profile (recorded only) ===\n  ${JSON.stringify(results.profile)}`);

  // ---- Step 2 negative controls (i)-(v) on Structure; the script fails if any is not detected
  const ctrlDetected = {
    'i-wrong-owner': (c) => !!c.resolved && c.resolved.ownerMismatchCount >= 1 && c.sameFragListObject === true,
    'ii-hidden-fragment': (c) => !!c.resolved && c.resolved.unreachableCount >= 1 && c.sameTreeObject === true,
    'iii-not-loaded': (c) => !!c.threw && c.threw.name === 'EnumerationInconsistencyError',
    'iv-tree-unavailable': (c) => !!c.threw && c.threw.name === 'ObjectTreeUnavailableError',
    'v-capacity': (c) => !!c.threw && c.threw.name === 'CapacityExceededError' && c.calls.enumNodeChildren === 0 && c.calls.enumNodeFragments === 0,
  };
  for (const control of Object.keys(ctrlDetected)) {
    results.phase = `control:${control}`;
    const c = await page.evaluate(CONTROL, { which: 'struct', control });
    results.controls[control] = c;
    check(`[control ${control}] detected`, ctrlDetected[control](c), true);
  }
  results.phase = 'control:after-restore';
  const clean = await page.evaluate(AFTER_RESTORE_CLEAN, { which: 'struct' });
  results.controls.afterRestoreClean = clean;
  check('[control] after restore: Structure is clean again (no mismatch, no unreachable, OQ-4 counts, no leftover patch)',
    clean.threw ? { threw: clean.threw } : [clean.ownerMismatch, clean.unreachable, clean.population, clean.roots, clean.leftoverOwnPatches],
    [0, 0, EXPECTED.struct.population, EXPECTED.struct.roots, []]);

  // ---- (e) AC-6 T3 reload arm on Mechanical -- CHARACTERIZATION, NOT ASSERTED
  results.phase = 'e:before';
  const beforeE = await page.evaluate(RECORD_WHOLE, { which: 'mech' });
  results.phase = 'e:unload';
  await page.evaluate(() => { window.__t3.eOld = window.__t3.models.mech; window.viewer.unloadModel(window.__t3.eOld); });
  await page.waitForFunction(() => !window.viewer.getAllModels().includes(window.__t3.eOld), null, { timeout: LOAD_TIMEOUT_MS });
  const reloadE = await reloadViaUi(page, URN_MECH, 'e');
  await page.evaluate(() => { window.__t3.models.mech = window.__t3.reloaded; });
  results.phase = 'e:readiness-settle';
  await page.waitForFunction(() => window.__t3.readiness.pending === 0, null, { timeout: LOAD_TIMEOUT_MS });
  results.phase = 'e:after';
  const afterE = await page.evaluate(RECORD_WHOLE, { which: 'mech' });
  const eSummary = { note: 'CHARACTERIZATION ONLY: cross-reload identity is not evidenced and not asserted.', reloadCandidates: reloadE.candidates };
  if (beforeE.threw || afterE.threw) {
    eSummary.threw = { before: beforeE.threw ?? null, after: afterE.threw ?? null };
  } else {
    const afterById = new Map(afterE.roots.map((r) => [r.dbId, r]));
    const per = { compared: 0, missingAfter: 0, digestEqual: 0, digestDiffer: 0, fragIdsEqual: 0, fragIdsDiffer: 0 };
    for (const r of beforeE.roots) {
      const a = afterById.get(r.dbId);
      if (!a) { per.missingAfter += 1; continue; }
      per.compared += 1;
      if (a.subtreeDigest === r.subtreeDigest) per.digestEqual += 1; else per.digestDiffer += 1;
      if (JSON.stringify(a.fragIds) === JSON.stringify(r.fragIds)) per.fragIdsEqual += 1; else per.fragIdsDiffer += 1;
    }
    Object.assign(eSummary, {
      modelIdBefore: beforeE.modelId, modelIdAfter: afterE.modelId,
      populationBefore: beforeE.population, populationAfter: afterE.population,
      populationDigestEqual: beforeE.population.digest === afterE.population.digest,
      rootsBefore: beforeE.roots.length, rootsAfter: afterE.roots.length, perRoot: per,
    });
  }
  results.reload = eSummary;
  console.log(`\n=== (e) reload arm (recorded only) ===\n  ${JSON.stringify(eSummary)}`);
  results.readinessAfterReload = await page.evaluate(REMOVE_READINESS_HOOK);   // (d) hook off before (h)

  // ---- (h) production unload wiring against the REAL Viewer event -- ASSERTED
  const hFailingLinks = [];
  console.log('\n=== (h) main run ===');
  {
    results.phase = 'h:main';
    await ensureStructLoaded(page);
    const observer = {};
    let mainError = null;
    try { await runH(page, 'main', {}, observer); } catch (e) { mainError = e; }
    const rep = observer.report;
    results.h.runs.main = rep;
    for (const a of rep.assertions) check(`[h] ${a.step}: ${a.description}`, a.ok, true);
    if (!check('[h] main run completed with no primary failure and no cleanup failure', mainError === null ? null : describeError(mainError), null)) {
      hFailingLinks.push({ run: 'main', link: (mainError && mainError.link) || rep.failingLink || 'cleanup', error: describeError(mainError), cleanupFailures: rep.cleanupFailures });
    }
    const post = rep.cleanup && rep.cleanup.post;
    if (!check('[h] main run: cleanup postcondition (c) holds (no listener, evictModel original, binding null, disposed, models == expected siblings)',
      post && post.ok === true ? true : (post || null), true)) {
      hFailingLinks.push({
        run: 'main',
        link: post && post.hasEventListenerAvailable === false
          ? 'cleanup:postcondition(c): viewer.hasEventListener unavailable (listener removal unverifiable)'
          : 'cleanup:postcondition(c)',
        post: post || null,
      });
    }
    check('[h] main run: every step (1)-(4) executed', Object.keys(rep.steps), ['step1', 'step2', 'step3', 'step4']);
  }

  // ---- (h) negative controls per assertion family (a probe that cannot fail proves nothing)
  const hControl = async (label, opts, detect) => {
    let c;
    try { c = await runControl(page, label, opts); } catch (e) {
      results.h.controls[label] = { harnessError: describeError(e) };
      hFailingLinks.push({ run: label, link: e && e.link ? e.link : 'harness', error: describeError(e) });
      check(`[h control ${label}] detected`, false, true);
      return;
    }
    let verdict;
    try { verdict = detect(c); } catch (e) { verdict = { ok: false, why: { detectorError: describeError(e), primary: c.rep && c.rep.primary } }; }
    results.h.controls[label] = { detected: verdict.ok, why: verdict.why, thrown: describeError(c.thrown) };
    if (!check(`[h control ${label}] detected`, verdict.ok, true)) hFailingLinks.push({ run: label, link: c.rep && c.rep.failingLink, why: verdict.why });
  };

  // Family step (1): wiring never installed => the binding must SURVIVE the unload, so step-1 assertions FAIL.
  await hControl('ctrl-no-wiring', { noWiring: true }, (c) => {
    const f = c.thrown && c.thrown.failedAssertions;
    const ok = c.threw && c.thrown instanceof HFailure && c.thrown === c.observer.primary && c.rep.failingLink === 'step1:assert'
      && hasAll(f, ['evictCalledForX', 'evictSawBindingNull', 'bindingNullAfterUnload', 'xNotLiveAfterUnload'])
      && !f.includes('probeSawX') && !f.includes('probeSawBindingPresent')
      && c.rep.cleanupFailures.length === 0 && c.rep.cleanup.post.ok === true;
    return { ok, why: { failedAssertions: f, post: c.rep.cleanup && c.rep.cleanup.post } };
  });
  // Family step (3): late unload aimed at the NEW model must remove the Y binding => step-3 assertions FAIL.
  // Permitted postcondition delta (stated explicitly): exactly one extra model, Y (step 4 never ran).
  await hControl('ctrl-step3-sensitivity', { step3Model: 'Y' }, (c) => {
    const f = c.thrown && c.thrown.failedAssertions;
    const ok = c.threw && c.thrown instanceof HFailure && c.rep.failingLink === 'step3'
      && hasAll(f, ['bindingModelIsY', 'yLive', 'resolveRootsOnY'])
      && c.rep.cleanupFailures.length === 0 && c.rep.cleanup.post.ok === true
      && JSON.stringify(c.rep.cleanup.post.extraModels) === JSON.stringify(['Y']);
    return { ok, why: { failedAssertions: f, post: c.rep.cleanup && c.rep.cleanup.post } };
  });
  // Family step (4): wiring NOT disposed => unload(Y) must remove the binding => step-4 assertions FAIL.
  await hControl('ctrl-step4-sensitivity', { skipDisposeInStep4: true }, (c) => {
    const f = c.thrown && c.thrown.failedAssertions;
    const ok = c.threw && c.thrown instanceof HFailure && c.rep.failingLink === 'step4:assert'
      && hasAll(f, ['bindingSurvivesYUnload', 'yStillLive', 'noEvictForY'])
      && c.rep.cleanupFailures.length === 0 && c.rep.cleanup.post.ok === true;
    return { ok, why: { failedAssertions: f, post: c.rep.cleanup && c.rep.cleanup.post } };
  });
  // Cleanup acceptance (a) partial initialization: abort before Y exists (reload wait forced to time out).
  await hControl('ctrl-cleanup-a-partial-init', { forceReloadTimeout: true }, (c) => {
    const d = c.rep.cleanup.done;
    const ok = c.threw && c.thrown === c.observer.primary && c.thrown && c.thrown.name === 'TimeoutError'
      && c.rep.failingLink === 'step2:reload-wait' && c.rep.cleanupFailures.length === 0
      && d['4b.unregisterY'] === 'skipped' && d['5b.evictY'] === 'skipped'
      && d['1.disposeWiring'] === 'ran' && d['2.removeProbeListener'] === 'ran' && d['3.restoreEvictModel'] === 'ran'
      && d['6.disposeEngine'] === 'ran' && d['7.disposeWorld'] === 'ran'
      && c.rep.cleanup.post.ok === true && JSON.stringify(c.rep.cleanup.post.extraModels) === '[]';
    return { ok, why: { done: d, post: c.rep.cleanup.post, primary: c.rep.primary } };
  });
  // Cleanup acceptance (b) independence: a forced failure at step 2 (real removeEventListener first, then throw)
  // must not stop any later step, must be reported in cleanupFailures, and must not mask the primary.
  await hControl('ctrl-cleanup-b-independence', { forceReloadTimeout: true, injectCleanupFailure: '2.removeProbeListener' }, (c) => {
    const d = c.rep.cleanup.done;
    const later = ['3.restoreEvictModel', '4a.unregisterX', '4b.unregisterY', '5a.evictX', '5b.evictY', '6.disposeEngine', '7.disposeWorld'];
    const ok = c.threw && c.thrown === c.observer.primary && c.thrown && c.thrown.name === 'TimeoutError'
      && c.rep.cleanupFailures.length === 1 && c.rep.cleanupFailures[0].step === '2.removeProbeListener'
      && c.rep.cleanup.realCallMade['2.removeProbeListener'] === true
      && later.every((k) => d[k] === 'ran' || d[k] === 'skipped')
      && ['3.restoreEvictModel', '4a.unregisterX', '6.disposeEngine', '7.disposeWorld'].every((k) => d[k] === 'ran')
      && c.rep.attachment === 'attached' && c.thrown.cleanupFailures === c.rep.cleanupFailures
      && c.rep.cleanup.post.ok === true;
    return { ok, why: { done: d, cleanupFailures: c.rep.cleanupFailures, attachment: c.rep.attachment, post: c.rep.cleanup.post } };
  });
  // Reporting path: the test passes but one cleanup step fails => AggregateError naming ONLY the cleanup failure.
  await hControl('ctrl-cleanup-aggregate', { injectCleanupFailure: '3.restoreEvictModel' }, (c) => {
    const ok = c.threw && c.thrown instanceof AggregateError && c.observer.primary === undefined
      && c.thrown.errors.length === 1 && c.thrown.errors[0].step === '3.restoreEvictModel'
      && c.rep.assertions.length > 0 && c.rep.assertions.every((a) => a.ok)
      && c.rep.cleanup.done['7.disposeWorld'] === 'ran' && c.rep.cleanup.post.ok === true;
    return { ok, why: { thrown: describeError(c.thrown), post: c.rep.cleanup.post } };
  });

  // Behavioral backup for postcondition (c): no removed probe listener fired during any later unload.
  results.phase = 'h:probe-silence';
  const silence = await page.evaluate(() => Object.fromEntries(Object.entries(window.__t3.hArchive || {}).map(([k, v]) => [k, v.probe.length === v.probeLenAtCleanup])));
  results.h.probeSilentAfterCleanup = silence;
  check('[h] no removed probe listener fired after its cleanup (behavioral backup of postcondition (c))', Object.values(silence).every(Boolean), true);

  // ---- global
  check('zero console errors across the whole run', results.consoleErrors, []);
  check('zero uncaught page exceptions across the whole run', results.pageErrors, []);

  // ---- gates
  const hChecks = results.checks.filter((c) => c.name.startsWith('[h'));
  const hOk = hChecks.length > 0 && hChecks.every((c) => c.ok);
  // The envelope label may be claimed only when the run is provably inside the envelope: every [env] and [load]
  // check must pass too. A failing one is recorded as the failing link, and the result stays UNVERIFIED.
  const envelopeChecks = results.checks.filter((c) => c.name.startsWith('[env]') || c.name.startsWith('[load]'));
  const envelopeOk = envelopeChecks.length > 0 && envelopeChecks.every((c) => c.ok);
  for (const c of envelopeChecks.filter((x) => !x.ok)) hFailingLinks.push({ run: 'envelope', link: c.name, actual: c.actual, expected: c.expected });
  if (envelopeChecks.length === 0) hFailingLinks.push({ run: 'envelope', link: 'no [env]/[load] check was recorded' });
  const failed = results.checks.filter((c) => !c.ok).length;
  results.gates = {
    T3: failed === 0 ? 'PASS (inside the accepted envelope only)' : 'FAIL',
    liveUnloadIntegration: hOk && envelopeOk ? 'VERIFIED_IN_ACCEPTED_ENVELOPE' : 'LIVE_UNLOAD_INTEGRATION_UNVERIFIED',
    failingLinks: hFailingLinks,
    notCovered: results.notCovered,
    durationMs: Date.now() - t0,
  };
  results.phase = 'done';

  await browser.close();
  await writeFile(path.join(RESULTS_DIR, REPORT_FILE), JSON.stringify(results, null, 2));
  console.log(`\n${results.checks.length - failed}/${results.checks.length} checks passed.`);
  console.log(`Gates: ${JSON.stringify({ T3: results.gates.T3, liveUnloadIntegration: results.gates.liveUnloadIntegration })}`);
}

// Same guard as the sibling acceptance scripts (Node's `node --test` discovery sweeps .mjs files under `test/`).
const isMainModule = !process.env.NODE_TEST_CONTEXT
  && process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) {
  main().catch(async (err) => {
    console.error(err);
    process.exitCode = 1;
    await browser?.close().catch(() => {});
    // Fallback gate: an unexecutable link is recorded, never papered over.
    results.gates = {
      T3: 'FAIL',
      liveUnloadIntegration: 'LIVE_UNLOAD_INTEGRATION_UNVERIFIED',
      failingLinks: [{ run: 'script', link: (err && err.link) || results.phase, error: describeError(err) }],
      notCovered: results.notCovered,
    };
    await writeFile(path.join(RESULTS_DIR, REPORT_FILE), JSON.stringify({ ...results, fatalError: String(err) }, null, 2)).catch(() => {});
  });
}
