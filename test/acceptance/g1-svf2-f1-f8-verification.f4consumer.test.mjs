// test/acceptance/g1-svf2-f1-f8-verification.f4consumer.test.mjs
//
// Offline regression tests for the bounded post-live-run (baseline 3312ae1) remediation of F4's
// browser-realm consumer path. The live run returned F4 FAIL with weldConsumerFailures 348/348
// and weldConsumerSuccessCount 0 while render-proxy and adapter failures were both 0. Root cause
// (confirmed by source read): observeF4 reads compactAndWeld from
// window.__g1.mod['/collision/geometry/activeRangeCompaction.js'], but installG1Modules only
// populates window.__g1.mod for SERVED_MODULE_ENTRY_POINTS, which never listed that module (it
// was only reachable transitively, so it appeared in servedModuleManifest yet never in g.mod).
// Every in-page `weld(...)` call was therefore `undefined(...)` -> TypeError -> counted as a
// generic weld-consumer failure. Earlier offline tests hand-injected the real module into
// g.mod, which is exactly what hid the gap.
//
// These tests build window.__g1.mod ONLY from SERVED_MODULE_ENTRY_POINTS (mirroring
// installG1Modules: one real module namespace per entry-point spec) and use the REAL
// adaptViewerGeometry/compactAndWeld; only viewer.impl.getRenderProxy is faked.
//
// NEVER launches a browser, imports playwright, or executes main().

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compactAndWeld as realCompactAndWeld } from '../../collision/geometry/activeRangeCompaction.js';
import { createGeometryIdentity } from '../../collision/geometry/GeometryIdentity.js';
import { maxSyncTriangleCount } from '../../collision/constants.js';
import {
  CHECK_VERDICT,
  IN_PAGE_FUNCTION_REGISTRY,
  SERVED_MODULE_ENTRY_POINTS,
  observeF4,
  scoreF4,
  scoreF5,
  buildF4CheckRecord,
  readPlaywrightVersion,
} from './g1-svf2-f1-f8-verification.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const COMPACT_SPEC = '/collision/geometry/activeRangeCompaction.js';
const ADAPTER_SPEC = '/collision/viewer/ViewerGeometryAdapter.js';

function createPageRealm(initialWindow = {}) {
  const context = vm.createContext({ window: initialWindow, performance, setTimeout, clearTimeout, console });
  for (const [name, fn] of Object.entries(IN_PAGE_FUNCTION_REGISTRY)) {
    vm.runInContext(`globalThis.${name} = (${fn.toString()})`, context);
  }
  return { window: initialWindow, call: (fn, ...args) => vm.runInContext(fn.name, context)(...args) };
}

/** The `mod['/...']` specifiers an in-page function reads (literal lookups only). */
function modSpecifiersReadBy(fn) {
  return [...new Set([...fn.toString().matchAll(/mod\['(\/[^']+)'\]/g)].map((m) => m[1]))];
}

/** Mirrors installG1Modules: g.mod[spec] = the REAL module namespace, ONLY for specs that are
 * actually served entry points (so a spec missing from SERVED_MODULE_ENTRY_POINTS is missing
 * here too, exactly as on a real page). */
async function servedModFor(fn) {
  const mod = {};
  for (const spec of modSpecifiersReadBy(fn)) {
    if (!SERVED_MODULE_ENTRY_POINTS.includes(spec)) continue;
    mod[spec] = await import(pathToFileURL(path.join(REPO_ROOT, spec.slice(1))).href);
  }
  return mod;
}

function buildF4Session(entries, { getUnitScale = () => 1 } = {}) {
  const records = new Map(entries.map(([fragId, geometryIndex, ownerDbId = 100]) => [fragId, {
    fragmentId: fragId, geometryIdentity: createGeometryIdentity(0, geometryIndex),
    worldMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], ownerDbId,
  }]));
  const model = {
    getUnitScale,
    getFragmentList: () => ({
      getGeometryId: (f) => records.get(f).geometryIdentity.geometryIndex,
      getDbIds: (f) => records.get(f).ownerDbId,
    }),
  };
  return { model, artifacts: { f1PopulationRecords: records } };
}

const proxyOf = (positions, index) => ({
  geometry: {
    attributes: { position: { array: new Float32Array(positions), itemSize: 3 } },
    index: index ? { array: new Uint32Array(index) } : undefined,
  },
});
const TRI = [0, 0, 0, 10, 0, 0, 0, 10, 0];

function realmFor(session, mod, getRenderProxy) {
  return createPageRealm({ __g1: { sessions: { s1: session }, mod }, __viewer: { impl: { getRenderProxy } } });
}

// ---- 1. the real consumer is served and invoked -----------------------------------------------

test('every window.__g1.mod[spec] an in-page function reads is a SERVED_MODULE_ENTRY_POINT (so installG1Modules populates it)', () => {
  for (const [name, fn] of Object.entries(IN_PAGE_FUNCTION_REGISTRY)) {
    if (typeof fn !== 'function') continue;
    for (const spec of modSpecifiersReadBy(fn)) {
      assert.ok(SERVED_MODULE_ENTRY_POINTS.includes(spec), `${name} reads mod['${spec}'] but it is not a served entry point`);
    }
  }
  assert.ok(modSpecifiersReadBy(observeF4).includes(COMPACT_SPEC));
  assert.ok(SERVED_MODULE_ENTRY_POINTS.includes(COMPACT_SPEC));
});

test('observeF4 with g.mod built ONLY from served entry points invokes the REAL compactAndWeld (weld success, PASS)', async () => {
  const mod = await servedModFor(observeF4);
  assert.equal(mod[COMPACT_SPEC] && mod[COMPACT_SPEC].compactAndWeld, realCompactAndWeld, 'the served module must be the real production compactAndWeld (same module instance)');
  const session = buildF4Session([[0, 1, 10]]);
  const r = await realmFor(session, mod, () => proxyOf(TRI, [0, 1, 2])).call(observeF4, 's1');
  assert.equal(r.ok, true);
  assert.equal(r.fields.weldConsumerFailures, 0);
  assert.equal(r.fields.weldConsumerSuccessCount, 1);
  assert.equal(scoreF4(r.fields).verdict, CHECK_VERDICT.PASS);
  // The trace shows the full getRenderProxy -> adaptViewerGeometry -> compactAndWeld chain ran.
  const trace = r.sampleGeometryTraces[0];
  assert.equal(trace.geometryId, 1);
  assert.equal(trace.fragId, 0);
  assert.equal(trace.dbId, 10);
  assert.equal(trace.renderProxy.returned, true);
  assert.equal(trace.adaptation.unsupported, false);
  assert.equal(trace.adaptation.activeTriangleCount, 1);
  assert.equal(trace.consumer.outcome, 'success');
  assert.equal(trace.consumer.triangleCount, 1);
});

// ---- 2. missing browser-realm compactAndWeld is detected distinctly --------------------------

test('observeF4: compactAndWeld missing from window.__g1.mod -> distinct not-ok reason, never 348x generic weld failures', async () => {
  let proxyCalls = 0;
  const mod = { [ADAPTER_SPEC]: await import(pathToFileURL(path.join(REPO_ROOT, ADAPTER_SPEC.slice(1))).href) };
  const r = await realmFor(buildF4Session([[0, 1], [1, 2]]), mod, () => { proxyCalls += 1; return proxyOf(TRI, [0, 1, 2]); }).call(observeF4, 's1');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'f4-compactAndWeld-missing-in-browser-realm');
  assert.equal(r.consumerAvailability.compactAndWeld, 'undefined');
  assert.equal(r.consumerAvailability.adaptViewerGeometry, 'function');
  assert.equal(r.consumerAvailability.modulePresent[COMPACT_SPEC], false);
  assert.equal(proxyCalls, 0, 'no geometry is census-read when the consumer is known to be missing');
  const rec = buildF4CheckRecord(JSON.parse(JSON.stringify(r)));
  assert.equal(rec.verdict, CHECK_VERDICT.BLOCKED);
  assert.equal(rec.reason, 'f4-compactAndWeld-missing-in-browser-realm');
  assert.equal(rec.evidence.details.consumerAvailability.compactAndWeld, 'undefined');
});

// ---- 3. ordinary consumer failure retained as F4 evidence ------------------------------------

test('observeF4: a real consumer REJECTION (index-references-invalid-vertex) stays an F4 FAIL with durable per-geometry details', async () => {
  const mod = await servedModFor(observeF4);
  const r = await realmFor(buildF4Session([[0, 1, 10]]), mod, () => proxyOf(TRI, [0, 1, 99])).call(observeF4, 's1');
  assert.equal(r.fields.weldConsumerFailures, 1);
  assert.equal(r.fields.weldConsumerExceptionCount, 0);
  const rec = buildF4CheckRecord(JSON.parse(JSON.stringify(r)));
  assert.equal(rec.verdict, CHECK_VERDICT.FAIL);
  assert.equal(rec.reason, 'f4-render-proxy-adapter-or-weld-consumer-failure');
  const d = rec.evidence.details.first20WeldConsumerFailures[0];
  assert.equal(d.geometryId, 1);
  assert.equal(d.fragId, 0);
  assert.equal(d.dbId, 10);
  assert.equal(d.stage, 'consumer');
  assert.equal(d.consumer.outcome, 'index-references-invalid-vertex');
  assert.equal(d.consumer.oversized, true);
  assert.equal(d.adaptation.activeTriangleCount, 1);
  assert.equal(d.renderProxy.returned, true);
  assert.equal(d.error, null);
});

test('observeF4: a real consumer EXCEPTION is its own reason with the bounded/redacted error persisted (never a generic F4 failure)', async () => {
  const mod = await servedModFor(observeF4);
  const session = buildF4Session([[0, 1, 10]], {
    getUnitScale: () => { throw new Error(`unit scale boom Authorization: Bearer abc.def.ghi ${'x'.repeat(20_000)}`); },
  });
  const r = await realmFor(session, mod, () => proxyOf(TRI, [0, 1, 2])).call(observeF4, 's1');
  assert.equal(r.fields.weldConsumerFailures, 1);
  assert.equal(r.fields.weldConsumerExceptionCount, 1);
  const rec = buildF4CheckRecord(JSON.parse(JSON.stringify(r)));
  assert.equal(rec.verdict, CHECK_VERDICT.FAIL);
  assert.equal(rec.reason, 'f4-weld-consumer-exception');
  const d = rec.evidence.details.first20WeldConsumerFailures[0];
  assert.equal(d.consumer.outcome, 'threw');
  assert.equal(d.error.name, 'Error');
  assert.match(d.error.message, /unit scale boom/);
  assert.ok(!d.error.message.includes('abc.def.ghi'), 'bearer token must be redacted by describeError');
  assert.ok(d.error.redactions.length > 0);
  assert.ok(d.error.message.length <= 4096, 'an oversized message is clipped in-page before crossing the realm boundary');
  assert.ok(typeof d.error.stack === 'string' && d.error.stack.length <= 2048 + 64, 'stack bounded by describeError');
  assert.ok(JSON.stringify(d.error).length < 12_000);
  assert.equal(rec.evidence.details.failureBreakdown.consumerException, 1);
});

// ---- 4. oversized geometry routes to F5, never F4 ---------------------------------------------

test('observeF4: geometry-too-large-for-sync-build via the REAL consumer -> F4 PASS with an oversized marker; F5 owns the FAIL', async () => {
  const vertexCount = (maxSyncTriangleCount + 1) * 3;
  const positions = new Float32Array(vertexCount * 3);
  for (let i = 0; i < vertexCount; i += 1) positions[i * 3] = i;
  const mod = await servedModFor(observeF4);
  const r = await realmFor(buildF4Session([[0, 1, 10]]), mod, () => ({ geometry: { attributes: { position: { array: positions, itemSize: 3 } } } })).call(observeF4, 's1');
  assert.equal(r.fields.oversizedGeometryCount, 1);
  assert.equal(r.fields.weldConsumerFailures, 0);
  const rec = buildF4CheckRecord(JSON.parse(JSON.stringify(r)));
  assert.equal(rec.verdict, CHECK_VERDICT.PASS, 'oversized-for-sync-build is never an F4 geometry incompatibility');
  const o = rec.evidence.details.first20OversizedGeometries[0];
  assert.equal(o.geometryId, 1);
  assert.equal(o.dbId, 10);
  assert.equal(o.consumer.reason, 'geometry-too-large-for-sync-build');
  assert.equal(o.consumer.activeTriangleCount, maxSyncTriangleCount + 1);
  const f5 = scoreF5({
    f1Result: { ok: true, fields: { populationCount: 1, maxRootFragmentCount: 1, maxPerDbIdFragmentCount: 1 } },
    f2Fields: { accountingBalanced: true, maxChildrenPerNode: 0 },
    f4Fields: rec.fields,
  });
  assert.equal(f5.verdict, CHECK_VERDICT.FAIL);
  assert.equal(f5.reason, 'oversized-geometry-present');
});

// ---- 5. bounded failure details persist -------------------------------------------------------

test('observeF4/buildF4CheckRecord: failure counts stay true while persisted details are bounded to the first 20', async () => {
  const mod = await servedModFor(observeF4);
  const entries = Array.from({ length: 25 }, (_, i) => [i, i + 1, 1000 + i]);
  const r = await realmFor(buildF4Session(entries), mod, () => proxyOf(TRI, [0, 1, 99])).call(observeF4, 's1');
  assert.equal(r.fields.weldConsumerFailures, 25);
  const rec = buildF4CheckRecord(JSON.parse(JSON.stringify(r)));
  assert.equal(rec.fields.weldConsumerFailures, 25);
  assert.equal(rec.evidence.details.first20WeldConsumerFailures.length, 20);
  assert.equal(rec.evidence.details.first20WeldConsumerFailures[19].dbId, 1019);
  assert.ok(rec.evidence.details.sampleGeometryTraces.length <= 5);
  assert.equal(rec.evidence.details.failureBreakdown.consumerRejected, 25);
});

test('buildF4CheckRecord tolerates an older/minimal observeF4 result shape (fields only)', () => {
  const rec = buildF4CheckRecord({ ok: true, fields: { renderProxyFailures: 0, geometryAdapterFailures: 0, weldConsumerFailures: 0, weldConsumerSuccessCount: 1, maxActiveTriangleCount: 1, oversizedGeometryCount: 0 } });
  assert.equal(rec.verdict, CHECK_VERDICT.PASS);
  assert.deepEqual(rec.evidence.details.first20WeldConsumerFailures, []);
});

// ---- 6. Playwright version for the durable runtimeEnvelope ------------------------------------

test('readPlaywrightVersion returns the installed playwright package version without importing playwright', () => {
  const expected = JSON.parse(readFileSync(path.join(REPO_ROOT, 'node_modules', 'playwright', 'package.json'), 'utf8')).version;
  assert.equal(readPlaywrightVersion(), expected);
  assert.equal(readPlaywrightVersion({ readPackageJson: () => { throw new Error('nope'); } }), null);
  assert.equal(readPlaywrightVersion({ readPackageJson: () => ({ version: 42 }) }), null);
});
