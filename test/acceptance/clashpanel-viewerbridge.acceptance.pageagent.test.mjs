// test/acceptance/clashpanel-viewerbridge.acceptance.pageagent.test.mjs
//
// Offline tests for the G2 page-side agent (harness Section 37) and its bundle builder
// (Section 38 `buildPageAgentSource`): the bundle is built from the harness's own bytes and loads
// in a node:vm context that has NO Node globals (no Buffer, process, require), proving the recorder,
// spies, runner and drivers can run in the page realm; the realm shims (SHA-256, Buffer) agree
// byte-for-byte with node:crypto / Buffer; the dormancy gates travel into the page; and the in-page
// load starters / readiness / facts / targets / cleanup functions behave as specified against
// in-vm fakes. Never imports playwright, never launches a browser, never touches the network.

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createHash, randomUUID, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as H from './clashpanel-viewerbridge.acceptance.mjs';
import * as G1 from './g1-svf2-f1-f8-verification.mjs';

const HARNESS_FILE = fileURLToPath(new URL('./clashpanel-viewerbridge.acceptance.mjs', import.meta.url));
const SOURCE = readFileSync(HARNESS_FILE, 'utf8');
const nodeSha = (b) => createHash('sha256').update(b).digest('hex');
/** Cross-realm values (vm arrays/objects) -> main-realm plain JSON for deepStrictEqual. */
const plain = (x) => JSON.parse(JSON.stringify(x));

const EXPOSE = ['sha256HexPortable', 'sha256Hex', 'Buffer', 'truncateUtf8', 'canonicalJson', 'redactEvidenceText', 'createCallRecorder',
  'createWrapperRegistry', 'installSpySet', 'runSpySelfTestN1', 'runChecksInPhaseOrder', 'createFailureInjectionController',
  'G2RefusalError', 'classifyFormatSignals', 'g2JsonSafe', 'LIVE_PATH_WIRED', 'planChecks', 'enumerateCandidates'];

/** A fresh browser-like vm realm (standard JS + a few web globals, NO Node globals) with the agent loaded. */
function loadAgent({ expose = true, extraGlobals = {} } = {}) {
  const built = H.buildPageAgentSource(SOURCE);
  let src = built.source;
  if (expose) {
    const reg = 'window.__g2HarnessFns = Object.freeze(';
    assert.equal(src.split(reg).length - 1, 1);
    src = src.replace(reg, `window.__t = { ${EXPOSE.join(', ')} };\n${reg}`);
  }
  const window = {};
  const ctx = vm.createContext({ window, TextEncoder, TextDecoder, URL, performance, setTimeout, clearTimeout, setInterval, clearInterval, crypto: { randomUUID }, console, ...extraGlobals });
  vm.runInContext(src, ctx);
  return { ctx, window, built };
}

// ------------------------------------------------------------------------------------------
// Bundle construction and realm independence
// ------------------------------------------------------------------------------------------

test('bundle: built from the harness bytes, deterministic, loads without Node globals, exposes exactly the registry', () => {
  const a = H.buildPageAgentSource(SOURCE);
  const b = H.buildPageAgentSource(SOURCE);
  assert.equal(a.source, b.source);
  assert.equal(a.sha256, nodeSha(a.source));
  const { window, ctx } = loadAgent({ expose: false });
  assert.deepEqual(Object.keys(window.__g2HarnessFns), [...H.G2_IN_PAGE_FUNCTION_NAMES]);
  assert.ok(Object.isFrozen(window.__g2HarnessFns));
  for (const g of ['Buffer', 'process', 'require', 'module', '__dirname']) assert.equal(vm.runInContext(`typeof ${g}`, ctx), 'undefined', g);
  // Sections 17..37 are shipped verbatim (the bound bytes), bracketed by the two markers.
  const begin = SOURCE.indexOf('\n// Section 17 -- Table T rev-2') + 1;
  const end = SOURCE.indexOf('\n// ==== G2 PAGE-AGENT END ====') + 1;
  assert.ok(a.source.includes(SOURCE.slice(begin, end)));
  assert.equal(a.source.includes('async function runPostReservation('), false, 'Node orchestration never enters the page');
  assert.equal(a.source.includes('async function main('), false);
});

test('bundle prelude: only earlier-section declarations actually referenced, never a Node-only name; LIVE_PATH_WIRED copied as bound', () => {
  const { preludeNames } = H.buildPageAgentSource(SOURCE);
  for (const n of preludeNames) assert.equal(H.PAGE_AGENT_NODE_ONLY_NAMES.includes(n), false, n);
  for (const n of ['LIVE_PATH_WIRED', 'CHECK_NAMES', 'CONTROL_NAMES', 'canonicalJson', 'defaultClock', 'checkVerdictBase']) assert.ok(preludeNames.includes(n), n);
  for (const n of ['createNodeFsLayer', 'main', 'reserveAttempt', 'closeoutProtocol', 'commitCriticalSection']) assert.equal(preludeNames.includes(n), false, n);
  const { window } = loadAgent();
  assert.equal(window.__t.LIVE_PATH_WIRED, H.LIVE_PATH_WIRED);
  assert.equal(window.__t.LIVE_PATH_WIRED, false);
});

test('bundle builder refuses a source without the page-agent markers; declaration scanner basics', () => {
  assert.throws(() => H.buildPageAgentSource('const x = 1;\n'), /markers/);
  const decls = H.topLevelDeclarations("import a from 'b';\nconst X = { y: [1, 2] };\nasync function f(p = { q: 1 }) { return `${p.q}`; }\nclass C extends Error { m() { return 1; } }\nfunction g() {}\n");
  assert.deepEqual(decls.map((d) => [d.name, d.kind]), [['X', 'const'], ['f', 'function'], ['C', 'class'], ['g', 'function']]);
  const free = H.freeIdentifierNames(H.tokenizeJs('a.b(c, d?.e, `${f}`)'));
  assert.ok(free.has('a') && free.has('c') && free.has('d') && free.has('f'));
  assert.equal(free.has('b') || free.has('e'), false);
});

test('Section 37 references no Node API (static, token-level)', () => {
  const begin = SOURCE.indexOf('\n// Section 37 -- PAGE-SIDE AGENT');
  const end = SOURCE.indexOf('\n// ==== G2 PAGE-AGENT END ====');
  assert.ok(begin > 0 && end > begin);
  const free = H.freeIdentifierNames(H.tokenizeJs(SOURCE.slice(begin, end)));
  for (const n of ['process', 'require', 'nodeFsModule', 'execFileSync', 'createHash', 'realpathSync', 'nodeReadFileSync', 'REPO_ROOT', 'toBuffer']) assert.equal(free.has(n), false, n);
});

// ------------------------------------------------------------------------------------------
// Realm shims agree with Node
// ------------------------------------------------------------------------------------------

test('sha256HexPortable == node:crypto (vectors, block boundaries, views, random), in Node and in the vm realm', () => {
  const { window } = loadAgent();
  const vmSha = window.__t.sha256HexPortable;
  assert.equal(H.sha256HexPortable(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(H.sha256HexPortable('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  for (let n = 0; n <= 200; n += 1) {
    const buf = randomBytes(n);
    assert.equal(H.sha256HexPortable(buf), nodeSha(buf), `len ${n}`);
    assert.equal(vmSha(new Uint8Array(buf)), nodeSha(buf), `vm len ${n}`);
  }
  const big = randomBytes(1024 * 1024 + 3);
  assert.equal(vmSha(new Uint8Array(big)), nodeSha(big));
  const s = 'héllo ✓ 𝄞 \u0000 end';
  assert.equal(vmSha(s), nodeSha(Buffer.from(s, 'utf8')));
  const backing = randomBytes(64);
  const view = new Uint8Array(backing.buffer, backing.byteOffset + 5, 40);
  assert.equal(H.sha256HexPortable(view), nodeSha(Buffer.from(backing.buffer, backing.byteOffset + 5, 40)));
  assert.equal(H.sha256HexPortable(view.buffer.slice(view.byteOffset, view.byteOffset + 40)), nodeSha(Buffer.from(view)));
  assert.throws(() => H.sha256HexPortable(42), TypeError);
});

test('PageBuffer / truncateUtf8 in the vm realm == Node Buffer semantics (multi-byte safe)', () => {
  const { window } = loadAgent();
  for (const str of ['plain', 'é'.repeat(300), '✓'.repeat(100), `${'a'.repeat(255)}𝄞tail`, '']) {
    for (const cap of [0, 1, 2, 3, 4, 255, 256, 257, 4096]) {
      assert.deepEqual({ ...window.__t.truncateUtf8(str, cap) }, H.truncateUtf8(str, cap), `${str.slice(0, 8)} cap ${cap}`);
    }
  }
  assert.equal(window.__t.Buffer.byteLength('é✓'), Buffer.byteLength('é✓'));
  const pb = H.PageBuffer.from('héllo');
  assert.equal(pb.subarray(0, 3).toString('utf8'), Buffer.from('héllo').subarray(0, 3).toString('utf8'));
  const ab = new Uint8Array([1, 2, 3, 4]).buffer;
  assert.deepEqual(Array.from(H.PageBuffer.from(ab, 1, 2)), [2, 3]);
  assert.throws(() => pb.toString('hex'), TypeError);
});

test('vm realm: canonical JSON, redaction and the recorder digest equal the Node realm', () => {
  const { window } = loadAgent();
  const t = window.__t;
  const v = { b: [1, { z: 'x', a: null }], a: 'Bearer abc.def' };
  assert.equal(t.canonicalJson(v), H.canonicalJson(v));
  assert.equal(t.redactEvidenceText('Authorization: Bearer xyz').value, H.redactEvidenceText('Authorization: Bearer xyz').value);
  const rv = t.createCallRecorder();
  const rn = H.createCallRecorder();
  rv.withOrigin('harness', () => rv.record('m', ['https://h/x?token=1', 3, [1, 2]]));
  rn.withOrigin('harness', () => rn.record('m', ['https://h/x?token=1', 3, [1, 2]]));
  assert.equal(rv.records[0].argsDigest, rn.records[0].argsDigest);
  assert.equal(rv.records[0].origin, 'harness');
});

test('vm realm: spy install + N1 self-test run in the page realm; the live gates travel with the bundle', async () => {
  const { window, ctx } = loadAgent();
  const t = window.__t;
  const viewer = vm.runInContext('({ fitToView() { return 1; }, getAggregateIsolation() { return []; }, overlays: { addMesh() {} } })', ctx);
  const recorder = t.createCallRecorder();
  const registry = t.createWrapperRegistry();
  const spies = t.installSpySet({ viewer, recorder, registry });
  assert.ok(spies.installed.includes('viewer.fitToView'));
  recorder.withOrigin('bridge', () => viewer.fitToView([1]));
  assert.equal(recorder.records.at(-1).method, 'viewer.fitToView');
  assert.equal(t.runSpySelfTestN1({ recorder }).state, 'DETECTED');
  assert.equal(registry.restoreAll().ok, true);
  await assert.rejects(t.runChecksInPhaseOrder({ drivers: {}, mode: 'live' }), (e) => e.name === 'G2RefusalError' && e.reason === 'live-path-not-wired');
  const ctl = t.createFailureInjectionController({ registry });
  assert.throws(() => ctl.install('a', { overlays: viewer.overlays, viewer }), (e) => e.reason === 'failure-injection-dormant');
  assert.equal(t.planChecks().every((p) => p.units.every((u) => u.status === 'pending live execution')), true);
});

// ------------------------------------------------------------------------------------------
// In-page functions against in-vm fakes (same realm, as in a real page)
// ------------------------------------------------------------------------------------------

/** In-vm fake Autodesk.Viewing + viewer + models; `cfg` steers load outcomes/timing. */
const FAKE_PAGE = `
window.__cfg = window.__cfg || {};
window.__calls = [];
function makeModel(label, o) {
  return {
    label, id: label === 'A' ? 1 : 2,
    isOTG: o.otg === 'absent' ? undefined : (o.otgThrows ? () => { throw new Error('boom'); } : () => o.otg),
    isSVF2: o.svf2 === 'absent' ? undefined : () => o.svf2,
    getUnitScale: () => 0.3048, getUnitString: () => 'ft',
    isObjectTreeCreated: () => o.treeReady !== false,
    getObjectTree(ok, fail) { if (ok) { if (o.treeFails) fail(new Error('no tree')); else ok(); } return window.__tree; },
    isLoadDone: () => o.loadDone === true,
    getFragmentList: () => ({ getWorldBounds(f, box) { box.min = { x: f, y: 0, z: 0 }; box.max = { x: f + 1, y: 1, z: 1 }; } }),
  };
}
const listeners = {};
window.Autodesk = { Viewing: {
  GEOMETRY_LOADED_EVENT: 'geometryLoaded', BEFORE_MODEL_UNLOAD_EVENT: 'beforeModelUnload', MODEL_REMOVED_EVENT: 'modelRemoved',
  Document: { load(urn, ok, fail) {
    window.__calls.push(['Document.load', urn]);
    const c = window.__cfg.doc || 'ok';
    const doc = { urn, getRoot: () => ({ getDefaultGeometry: (b) => ({ geometry: true, arg: b }) }) };
    if (c === 'ok') setTimeout(() => ok(doc), 1);
    else if (c === 'fail') setTimeout(() => fail(404, 'not found ?token=SECRET'), 1);
    else if (c === 'late') setTimeout(() => ok(doc), 60);
  } },
} };
window.THREE = { Box3: function Box3() { this.min = null; this.max = null; } };
const models = [];
window.__viewer = {
  models,
  canvas: null,
  getAllModels: () => models.slice(),
  unloadModel(m) { window.__calls.push(['unloadModel', m.label]); const i = models.indexOf(m); if (i >= 0) models.splice(i, 1); return true; },
  loadDocumentNode(doc, node, opts) {
    window.__calls.push(['loadDocumentNode', doc.urn, JSON.stringify(opts), node.arg]);
    const label = doc.urn.includes(window.__cfg.urnA) ? 'A' : 'B';
    const m = makeModel(label, (window.__cfg.models || {})[label] || { otg: true, svf2: true, loadDone: true });
    const c = window.__cfg.node || 'ok';
    if (c === 'late') return new Promise((res) => setTimeout(() => { models.push(m); res(m); }, 60));
    if (c === 'reject') return Promise.reject(new Error('load rejected'));
    models.push(m);
    return Promise.resolve(m);
  },
  addEventListener(n, fn) { (listeners[n] = listeners[n] || []).push(fn); },
  removeEventListener(n, fn) { const l = listeners[n] || []; const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); },
  fire(n, ev) { for (const fn of (listeners[n] || []).slice()) fn(ev); },
  listenerCount(n) { return (listeners[n] || []).length; },
};
`;

function pageRealm(cfg = {}) {
  const r = loadAgent();
  r.window.__cfg = { urnA: 'URN-A', ...cfg };
  vm.runInContext(FAKE_PAGE, r.ctx);
  const fns = r.window.__g2HarnessFns;
  const call = (key, arg) => fns[key](arg);
  return { ...r, call };
}

test('g2DocumentLoad: completed / failed (redacted) / timed-out with the late arrival quarantined', async () => {
  let p = pageRealm();
  let s = await p.call('g2DocumentLoad', { label: 'A', urn: 'URN-A', timeoutMs: 1000 });
  assert.equal(s.status, 'completed');
  assert.deepEqual(plain(p.window.__calls[0]), ['Document.load', 'urn:URN-A']);
  p = pageRealm({ doc: 'fail' });
  s = await p.call('g2DocumentLoad', { label: 'A', urn: 'URN-A', timeoutMs: 1000 });
  assert.equal(s.status, 'failed');
  assert.equal(s.error.code, '404');
  assert.doesNotMatch(s.error.message, /SECRET/);
  p = pageRealm({ doc: 'late' });
  s = await p.call('g2DocumentLoad', { label: 'A', urn: 'URN-A', timeoutMs: 10 });
  assert.equal(s.status, 'timed-out');
  await new Promise((res) => setTimeout(res, 80));
  assert.equal(p.window.__g2.loads['doc:A'].late, 'completed');
  assert.equal(p.window.__g2.docs.A, undefined, 'a late Document is never delivered');
});

test('g2LoadDocumentNode: keepCurrentModels:true with getDefaultGeometry(true); a late model is quarantined AND unloaded', async () => {
  let p = pageRealm();
  await p.call('g2DocumentLoad', { label: 'A', urn: 'URN-A', timeoutMs: 1000 });
  let s = await p.call('g2LoadDocumentNode', { label: 'A', timeoutMs: 1000 });
  assert.equal(s.status, 'completed');
  const call = p.window.__calls.find((c) => c[0] === 'loadDocumentNode');
  assert.deepEqual(plain(call), ['loadDocumentNode', 'urn:URN-A', JSON.stringify({ keepCurrentModels: true }), true]);
  assert.ok(p.window.__g2.models.A);
  p = pageRealm({ node: 'late' });
  await p.call('g2DocumentLoad', { label: 'B', urn: 'URN-B', timeoutMs: 1000 });
  s = await p.call('g2LoadDocumentNode', { label: 'B', timeoutMs: 10 });
  assert.equal(s.status, 'timed-out');
  await new Promise((res) => setTimeout(res, 90));
  const rec = p.window.__g2.loads['node:B'];
  assert.equal(rec.late, 'completed');
  assert.equal(rec.lateUnloaded, true);
  assert.deepEqual(plain(p.window.__calls.filter((c) => c[0] === 'unloadModel')), [['unloadModel', 'B']]);
  assert.equal(p.window.__g2.models.B, undefined);
  p = pageRealm();
  s = await p.call('g2LoadDocumentNode', { label: 'A', timeoutMs: 100 });
  assert.equal(s.status, 'failed', 'no Document => never calls loadDocumentNode');
  assert.equal(p.window.__calls.some((c) => c[0] === 'loadDocumentNode'), false);
});

test('g2AwaitModelReady: GEOMETRY_LOADED_EVENT path, isLoadDone poll fallback, tree failure and timeout; listener removed', async () => {
  let p = pageRealm({ models: { A: { otg: true, svf2: true, loadDone: false } } });
  await p.call('g2DocumentLoad', { label: 'A', urn: 'URN-A', timeoutMs: 1000 });
  await p.call('g2LoadDocumentNode', { label: 'A', timeoutMs: 1000 });
  const pending = p.call('g2AwaitModelReady', { label: 'A', timeoutMs: 1000 });
  setTimeout(() => p.window.__viewer.fire('geometryLoaded', { model: p.window.__g2.models.A }), 5);
  let s = await pending;
  assert.deepEqual([s.status, s.tree, s.geometry, s.geometryPath], ['ready', true, true, 'GEOMETRY_LOADED_EVENT']);
  assert.equal(p.window.__viewer.listenerCount('geometryLoaded'), 0);
  p = pageRealm();
  await p.call('g2DocumentLoad', { label: 'A', urn: 'URN-A', timeoutMs: 1000 });
  await p.call('g2LoadDocumentNode', { label: 'A', timeoutMs: 1000 });
  s = await p.call('g2AwaitModelReady', { label: 'A', timeoutMs: 1000 });
  assert.deepEqual([s.status, s.geometryPath], ['ready', 'isLoadDone-poll']);
  p = pageRealm({ models: { A: { otg: true, svf2: true, loadDone: false } } });
  await p.call('g2DocumentLoad', { label: 'A', urn: 'URN-A', timeoutMs: 1000 });
  await p.call('g2LoadDocumentNode', { label: 'A', timeoutMs: 1000 });
  s = await p.call('g2AwaitModelReady', { label: 'A', timeoutMs: 30 });
  assert.equal(s.status, 'timed-out');
  p = pageRealm({ models: { A: { otg: true, svf2: true, loadDone: true, treeReady: false, treeFails: true } } });
  await p.call('g2DocumentLoad', { label: 'A', urn: 'URN-A', timeoutMs: 1000 });
  await p.call('g2LoadDocumentNode', { label: 'A', timeoutMs: 1000 });
  s = await p.call('g2AwaitModelReady', { label: 'A', timeoutMs: 1000 });
  assert.equal(s.status, 'tree-failed');
  assert.equal((await p.call('g2AwaitModelReady', { label: 'B', timeoutMs: 10 })).status, 'no-model');
});

test('g2CollectModelFacts: G1 classifier per model, raw signals kept, a throwing signal is never coerced; membership by identity', async () => {
  const p = pageRealm({ models: { A: { otg: true, svf2: true, loadDone: true }, B: { otg: true, svf2: 'absent', loadDone: true } } });
  for (const [label, urn] of [['A', 'URN-A'], ['B', 'URN-B']]) {
    await p.call('g2DocumentLoad', { label, urn, timeoutMs: 1000 });
    await p.call('g2LoadDocumentNode', { label, timeoutMs: 1000 });
    await p.call('g2AwaitModelReady', { label, timeoutMs: 1000 });
  }
  let f = p.call('g2CollectModelFacts', null);
  assert.equal(f.loadedCount, 2);
  assert.equal(f.A.classification, 'CONFIRMED_SVF2');
  assert.equal(f.B.classification, 'INDETERMINATE_PARTIAL');
  assert.equal(f.A.inAllModels, true);
  assert.equal(f.A.loaded, true);
  assert.equal(f.A.unitString, 'ft');
  const q = pageRealm({ models: { A: { otg: true, otgThrows: true, svf2: true, loadDone: true } } });
  await q.call('g2DocumentLoad', { label: 'A', urn: 'URN-A', timeoutMs: 1000 });
  await q.call('g2LoadDocumentNode', { label: 'A', timeoutMs: 1000 });
  f = q.call('g2CollectModelFacts', null);
  assert.equal(f.A.classification, null);
  assert.equal(f.A.otg.threw, true);
  assert.equal(f.A.loaded, false, 'readiness never reached => not loaded');
  assert.equal(f.B.loaded, false);
});

test('classifyFormatSignals == G1 readFormat for every signal combination (drift test)', () => {
  const vals = [true, false, H.FORMAT_SIGNAL_UNAVAILABLE];
  for (const otg of vals) {
    for (const svf2 of vals) {
      const model = {};
      if (otg !== H.FORMAT_SIGNAL_UNAVAILABLE) model.isOTG = () => otg;
      if (svf2 !== H.FORMAT_SIGNAL_UNAVAILABLE) model.isSVF2 = () => svf2;
      assert.equal(H.classifyFormatSignals(otg, svf2), G1.readFormat(model).classifier, `${otg}/${svf2}`);
    }
  }
  assert.ok(Object.values(G1.CLASSIFIER).includes(H.classifyFormatSignals(true, true)));
});

test('g2PrepareTargets: §4.4 selection in the page (leaf walk, fragment counts, bridge bounds path) -> targets summary + candidate lists', async () => {
  const p = pageRealm();
  vm.runInContext(`
    window.__tree = {
      getRootId: () => 1,
      enumNodeChildren(n, cb) { const kids = { 1: [2, 3], 2: [4, 5], 3: [6] }[n] || []; for (const k of kids) if (cb(k)) break; },
      enumNodeFragments(n, cb) { const f = { 4: [40], 5: [], 6: [60, 61] }[n] || []; for (const x of f) cb(x); },
      getNodeBox(dbId, box) { box[0] = dbId; box[1] = 0; box[2] = 0; box[3] = dbId + 1; box[4] = 1; box[5] = 1; },
    };
    window.__g2 = window.__g2 || undefined;
  `, p.ctx);
  for (const [label, urn] of [['A', 'URN-A'], ['B', 'URN-B']]) {
    await p.call('g2DocumentLoad', { label, urn, timeoutMs: 1000 });
    await p.call('g2LoadDocumentNode', { label, timeoutMs: 1000 });
  }
  const viewerApi = await import('../../clashpanel/viewer/viewerApi.js');
  p.window.__g2.mod['/clashpanel/viewer/viewerApi.js'] = viewerApi;
  p.window.__viewer.overlays = {};
  const summary = p.call('g2PrepareTargets', null);
  assert.equal(summary.a1, 4);
  assert.equal(summary.b1, 4);
  assert.deepEqual(plain(summary.candidateCounts), { A: { leaves: 3, candidates: 2 }, B: { leaves: 3, candidates: 2 } });
  assert.deepEqual(plain(p.window.__g2.targets.candidatesA.map((c) => c.dbId)), [4, 6]);
  assert.ok(p.window.__g2.targets.fitPair);
});

test('g2CleanupStep / g2MarkFatal / g2AgentReady: unknown steps refused, fatal latch, readiness without a viewer', async () => {
  const p = pageRealm();
  const r = await p.call('g2CleanupStep', { name: 'closeBrowser' });
  assert.equal(r.ok, false, 'Node-owned steps are not page steps');
  assert.equal(r.ownershipRemains, null);
  assert.deepEqual([...H.G2_PAGE_CLEANUP_STEPS, 'closePage', 'closeContext', 'closeBrowser', 'httpServerOwnership'], [...H.CLEANUP_STEP_NAMES]);
  assert.deepEqual({ ...p.call('g2MarkFatal', { kind: 'x', abort: true }) }, { flag: true, abort: true });
  const q = loadAgent();
  q.window.document = { createElement: () => ({ getContext: () => null }) };
  const winListeners = [];
  q.window.addEventListener = (name) => { winListeners.push(name); };
  const ready = q.window.__g2HarnessFns.g2AgentReady(null);
  assert.equal(ready.ok, false);
  assert.equal(ready.viewerPresent, false);
  assert.deepEqual(winListeners, ['unhandledrejection'], 'page-side fatal forwarding installed once');
  q.window.__g2HarnessFns.g2AgentReady(null);
  assert.deepEqual(winListeners, ['unhandledrejection']);
});

test('g2JsonSafe: plain JSON copy; non-plain values become explicit markers (never silently dropped)', () => {
  class K {}
  const out = H.g2JsonSafe({ a: 1, b: undefined, c: Number.NaN, d: new Uint8Array([1, 2]), e: new K(), f: () => 1, g: [null, 'x'] });
  assert.deepEqual(out, { a: 1, b: null, c: 'NaN', d: [1, 2], e: { nonPlainEvidence: 'K' }, f: { nonPlainEvidence: 'function' }, g: [null, 'x'] });
});

test('attachShellArgumentCapture: keeps the raw visibility callback, records unchanged, composes with the model tagger, detach restores', () => {
  const recorder = H.createCallRecorder();
  const original = recorder.record;
  const cap = H.attachShellArgumentCapture(recorder);
  const tagger = H.attachModelArgumentTagger(recorder, { labelOf: () => null });
  const cb = () => {};
  const rec = recorder.record('DockingPanel.prototype.addVisibilityListener', [cb]);
  recorder.record('DockingPanel.prototype.setVisible', [false]);
  assert.deepEqual(cap.visibilityCallbacks, [cb]);
  assert.equal(rec.argSummaries[0].kind, 'function');
  assert.throws(() => H.attachShellArgumentCapture(recorder), /already attached/);
  tagger.detach();
  cap.detach();
  assert.equal(recorder.record, original);
});

// ------------------------------------------------------------------------------------------
// Node-side helpers: page HTML, base URL, integrity capture (G1 copy), RPC refusal
// ------------------------------------------------------------------------------------------

test('synthetic page: pinned 7.124.2 assets, §3 envelope, token endpoint, no import map / wwwroot', () => {
  const html = H.G2_BARE_PAGE_HTML;
  assert.ok(html.includes('<script src="https://developer.api.autodesk.com/modelderivative/v2/viewers/7.124.2/viewer3D.js"></script>'));
  assert.ok(html.includes('viewers/7.124.2/style.css'));
  assert.ok(html.includes("env: 'AutodeskProduction2', api: 'streamingV2'"));
  assert.ok(html.includes("fetch('/api/auth/token')"));
  assert.ok(html.includes('window.__g2Bootstrap.ready = true'));
  assert.doesNotMatch(html, /importmap|wwwroot|\/vendor\//);
  assert.equal(H.g2BaseUrl({}), 'http://localhost:8080');
  assert.equal(H.g2BaseUrl({ PORT: '9090' }), 'http://localhost:9090');
  assert.equal(H.g2BaseUrl({ PORT: '80; rm -rf' }), 'http://localhost:8080');
});

test('walkRedirectRootUrl == G1 copy; integrity capture classifies VERIFIED-shaped / MISMATCH / FETCH_FAILED / pending bodies', async () => {
  const mkReq = (url, from = null) => ({ url: () => url, redirectedFrom: () => from, resourceType: () => 'script' });
  const hop = mkReq('https://cdn.invalid/final.js', mkReq(H.G2_VIEWER_SCRIPT_URL));
  assert.equal(H.walkRedirectRootUrl(hop), G1.walkRedirectRootUrl(hop));
  const resp = (req, status, body) => ({ request: () => req, status: () => status, fromServiceWorker: () => false, body });
  let cap = H.createViewerScriptIntegrityCapture();
  cap.onResponse(resp(mkReq(H.G2_VIEWER_SCRIPT_URL), 200, async () => Buffer.from('not the pinned bundle')));
  cap.onResponse(resp(mkReq('https://other.invalid/x.js'), 200, async () => Buffer.from('ignored')));
  cap.onResponse(resp(mkReq(H.G2_VIEWER_SCRIPT_URL), 302, async () => Buffer.from('')));
  cap.markViewingDefined();
  let rec = await cap.capture();
  assert.equal(rec.attributableResponses.length, 1);
  assert.equal(H.classifyViewerScriptIntegrity(rec).integrityResult, 'MISMATCH');
  cap = H.createViewerScriptIntegrityCapture();
  cap.onRequestFailed(mkReq(H.G2_VIEWER_SCRIPT_URL));
  assert.equal(H.classifyViewerScriptIntegrity(await cap.capture()).integrityResult, 'FETCH_FAILED');
  cap = H.createViewerScriptIntegrityCapture({ bodyTimeoutMs: 5 });
  cap.onResponse(resp(mkReq(H.G2_VIEWER_SCRIPT_URL), 200, () => new Promise(() => {})));
  cap.markViewingDefined();
  rec = await cap.capture();
  assert.equal(rec.attributableResponses[0].bodyOutcome, 'pending-at-close');
  assert.equal(H.classifyViewerScriptIntegrity(rec).integrityResult, 'CAPTURE_UNAVAILABLE');
});

test('createPageRpc refuses unregistered keys before any page call; dispatch goes through the one dispatcher', async () => {
  const calls = [];
  const rpc = H.createPageRpc({ evaluate: async (fn, payload) => { calls.push([fn, payload]); return 'ok'; } });
  await assert.rejects(rpc.call('eval', 'x'), /unregistered/);
  assert.equal(calls.length, 0);
  assert.equal(await rpc.call('g2MarkFatal', { kind: 'k' }), 'ok');
  assert.equal(calls[0][0], H.G2_PAGE_DISPATCH);
  assert.deepEqual(calls[0][1], { key: 'g2MarkFatal', arg: { kind: 'k' } });
  assert.equal(await rpc.call('g2AgentReady'), 'ok');
  assert.deepEqual(calls[1][1], { key: 'g2AgentReady', arg: null });
});
