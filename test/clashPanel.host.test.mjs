import test from 'node:test';
import assert from 'node:assert/strict';
import { createHostCatalog, createClashPanelHost, viewerEventNames, makeFallbackUuid, ensureRandomUUID } from '../wwwroot/extensions/clashPanelHost.js';
import { declareModelDisplayName, clearDeclaredDisplayNames } from '../wwwroot/extensions/clashPanelNames.js';
import { loadDemoModels, waitForModelReady, DEMO_MODELS } from '../wwwroot/clashPanelDemo.js';

const EV = viewerEventNames(undefined);

class FakeViewer {
  constructor() { this.models = []; this.listeners = new Map(); }
  getAllModels() { return [...this.models]; }
  addEventListener(n, f) { if (!this.listeners.has(n)) this.listeners.set(n, new Set()); this.listeners.get(n).add(f); }
  removeEventListener(n, f) { this.listeners.get(n)?.delete(f); }
  count(n) { return this.listeners.get(n)?.size ?? 0; }
  emit(n, ev = {}) { for (const f of [...(this.listeners.get(n) ?? [])]) f(ev); }
  add(model) { this.models.push(model); this.emit(EV.MODEL_ADDED, { model }); }
  remove(model) {
    this.emit(EV.BEFORE_MODEL_UNLOAD, { model });
    this.models = this.models.filter((m) => m !== model);
    this.emit(EV.MODEL_REMOVED, { model });
  }
}
const fakeModel = (urn, { done = true, tree = true } = {}) => ({
  _done: done, _tree: tree,
  getData() { return urn ? { urn } : undefined; },
  isLoadDone() { return this._done; },
  getInstanceTree() { return this._tree ? {} : undefined; },
});
const fakeRegistry = () => ({ calls: [], register(k, m, o) { this.calls.push([k, m, o]); } });

test('catalog: list/keyOfModel/displayNameFor, unique keys per load, URN-derived version', () => {
  clearDeclaredDisplayNames();
  const v = new FakeViewer(); const reg = fakeRegistry();
  const cat = createHostCatalog({ viewer: v, registry: reg, events: EV });
  const a = fakeModel('urn:AAA'); v.add(a);
  const [row] = cat.list();
  assert.equal(row.model, a);
  assert.match(row.modelKey, /^urn:AAA#\d+$/);
  assert.equal(cat.keyOfModel(a), row.modelKey);
  assert.equal(reg.calls.length, 1);
  assert.equal(reg.calls[0][2].modelVersion, 'urn:AAA');
  cat.list(); assert.equal(reg.calls.length, 1, 'registered once');
  // same URN reloaded as a new Model object gets a fresh key
  v.remove(a); const a2 = fakeModel('urn:AAA'); v.add(a2);
  assert.notEqual(cat.keyOfModel(a2), row.modelKey);
  assert.equal(cat.keyOfModel(a), row.modelKey, 'WeakMap survives unload');
  assert.equal(cat.keyOfModel(null), null);
  cat.dispose();
});

test('catalog: loaded == load done AND object tree; onChange fires and unsubscribes; names survive unload', () => {
  clearDeclaredDisplayNames();
  const v = new FakeViewer(); const cat = createHostCatalog({ viewer: v, registry: fakeRegistry(), events: EV });
  let fired = 0; const off = cat.onChange(() => { fired++; });
  const m = fakeModel('urn:BBB', { done: false, tree: false }); v.add(m);
  assert.equal(cat.list()[0].loaded, false);
  m._done = true; assert.equal(cat.list()[0].loaded, false, 'done but no tree');
  m._tree = true; v.emit(EV.OBJECT_TREE_CREATED, { model: m });
  assert.equal(cat.list()[0].loaded, true);
  assert.ok(fired >= 2);
  declareModelDisplayName('BBB', 'Structure'); // declared after creation, 'urn:' prefix normalised
  const key = cat.keyOfModel(m);
  assert.equal(cat.displayNameFor(key), 'Structure');
  assert.equal(cat.list()[0].displayName, 'Structure');
  v.remove(m);
  assert.deepEqual(cat.list(), []);
  assert.equal(cat.displayNameFor(key), 'Structure', 'survives unload');
  assert.equal(cat.displayNameFor('nope'), null);
  const before = fired; off(); v.add(fakeModel('urn:CCC')); assert.equal(fired, before);
  cat.dispose();
  for (const n of [EV.MODEL_ADDED, EV.MODEL_REMOVED, EV.GEOMETRY_LOADED, EV.OBJECT_TREE_CREATED]) assert.equal(v.count(n), 0);
});

test('catalog: model without URN is unkeyed until identifiable', () => {
  clearDeclaredDisplayNames();
  const v = new FakeViewer(); const reg = fakeRegistry(); const cat = createHostCatalog({ viewer: v, registry: reg, events: EV });
  const m = fakeModel(null); v.add(m);
  assert.equal(cat.list()[0].modelKey, null);
  m.getData = () => ({ urn: 'urn:LATE' }); v.emit(EV.GEOMETRY_LOADED, { model: m });
  assert.ok(cat.keyOfModel(m));
  cat.dispose();
});

function fakeDeps(order, { failPanel = false, failEngine = false } = {}) {
  const registry = fakeRegistry();
  return {
    CollisionWorld: { fromViewer: async () => ({ dispose() { order.push('world'); } }) },
    createViewerElementEnumerator: () => ({}),
    createClashTestEngine: () => ({ registry, dispose: async () => { order.push('engine'); if (failEngine) throw new Error('engine boom'); } }),
    wireModelUnload: () => ({ dispose() { order.push('wiring'); } }),
    createClashPanel: () => ({
      show() {}, hide() {}, toggle() { order.push('toggle'); }, isVisible: () => true,
      dispose: async () => { await Promise.resolve(); order.push('panel'); if (failPanel) throw new Error('panel boom'); },
    }),
  };
}

test('host teardown: panel awaited before engine, then wiring, catalog, world; idempotent', async () => {
  const order = []; const v = new FakeViewer();
  const host = await createClashPanelHost({ viewer: v, deps: fakeDeps(order) });
  assert.ok(v.count(EV.MODEL_ADDED) > 0);
  const p1 = host.dispose(); const p2 = host.dispose();
  assert.equal(p1, p2);
  await p1; await host.dispose();
  assert.deepEqual(order, ['panel', 'engine', 'wiring', 'world']);
  assert.equal(v.count(EV.MODEL_ADDED), 0, 'catalog listeners removed');
});

test('host teardown: every step runs when earlier ones fail; AggregateError after all', async () => {
  const order = []; const v = new FakeViewer();
  const host = await createClashPanelHost({ viewer: v, deps: fakeDeps(order, { failPanel: true, failEngine: true }) });
  await assert.rejects(host.dispose(), (e) => e instanceof AggregateError && e.errors.length === 2);
  assert.deepEqual(order, ['panel', 'engine', 'wiring', 'world']);
  assert.equal(v.count(EV.MODEL_ADDED), 0);
});

test('host: construction failure unwinds what was built and rethrows', async () => {
  const order = []; const deps = fakeDeps(order);
  deps.createClashPanel = () => { throw new Error('ctor boom'); };
  await assert.rejects(createClashPanelHost({ viewer: new FakeViewer(), deps }), /ctor boom/);
  assert.deepEqual(order, ['engine', 'wiring', 'world']);
});

test('host: models added after creation are registered and removed models are tolerated', async () => {
  clearDeclaredDisplayNames();
  const order = []; const v = new FakeViewer();
  const deps = fakeDeps(order); const host = await createClashPanelHost({ viewer: v, deps });
  const m = fakeModel('urn:LATE2'); v.add(m);
  assert.ok(host.catalog.keyOfModel(m));
  assert.equal(host.engine.registry.calls.length, 1);
  v.remove(m);
  await host.dispose();
});

test('demo loader: sequential Structure then Mechanical, second keepCurrentModels:true, names declared', async () => {
  clearDeclaredDisplayNames();
  const calls = []; const declared = [];
  const loadModel = async (viewer, urn, opts) => { calls.push([urn, opts.keepCurrentModels]); return { urn }; };
  const out = await loadDemoModels({}, { loadModel, wait: async (_v, m) => m, declareName: (u, n) => declared.push([u, n]) });
  assert.deepEqual(calls, [[DEMO_MODELS[0].urn, false], [DEMO_MODELS[1].urn, true]]);
  assert.deepEqual(declared.map((d) => d[1]), ['Structure', 'Mechanical']);
  assert.equal(out.length, 2);
});

test('waitForModelReady: waits for geometry then object tree', async () => {
  const v = new FakeViewer();
  const model = { _d: false, isLoadDone() { return this._d; }, getObjectTree(ok) { ok({}); } };
  let settled = false;
  const p = waitForModelReady(v, model, { geometryLoadedEvent: 'g', timeoutMs: 5000 }).then(() => { settled = true; });
  await Promise.resolve(); assert.equal(settled, false);
  model._d = true; v.emit('g', { model });
  await p; assert.equal(settled, true); assert.equal(v.count('g'), 0);
});

test('L3: failed registration warns once and is not retried on later events', () => {
  clearDeclaredDisplayNames();
  const v = new FakeViewer(); const reports = [];
  const reg = { n: 0, register() { this.n++; throw new Error('reg boom'); } };
  const cat = createHostCatalog({ viewer: v, registry: reg, events: EV, report: (s) => reports.push(s) });
  const m = fakeModel('urn:BAD'); v.add(m);
  v.emit(EV.GEOMETRY_LOADED, { model: m }); v.emit(EV.OBJECT_TREE_CREATED, { model: m }); cat.list();
  assert.equal(reg.n, 1); assert.equal(reports.filter((s) => s === 'register').length, 1);
  cat.dispose();
});

test('L4: catalog listeners are removed before engine disposal begins; all steps still run if catalog throws', async () => {
  const order = []; const v = new FakeViewer(); const deps = fakeDeps(order);
  let countAtEngine = null;
  const baseEngine = deps.createClashTestEngine;
  deps.createClashTestEngine = (a) => { const e = baseEngine(a); const d0 = e.dispose; e.dispose = async () => { countAtEngine = v.count(EV.MODEL_ADDED); return d0(); }; return e; };
  const host = await createClashPanelHost({ viewer: v, deps });
  await host.dispose();
  assert.equal(countAtEngine, 0);
  const order2 = []; const v2 = new FakeViewer();
  const host2 = await createClashPanelHost({ viewer: v2, deps: fakeDeps(order2) });
  host2.catalog.dispose = () => { throw new Error('cat boom'); };
  await assert.rejects(host2.dispose(), (e) => e instanceof AggregateError && e.errors.length === 1);
  assert.deepEqual(order2, ['panel', 'engine', 'wiring', 'world']);
});

test('L6: fallback uuid is v4-shaped and unique; ensureRandomUUID only fills when missing', () => {
  for (const c of [{ getRandomValues: (a) => { for (let i = 0; i < a.length; i++) a[i] = (i * 37 + Math.random() * 255) & 255; return a; } }, {}]) {
    const gen = makeFallbackUuid(c);
    const a = gen(); const b = gen();
    assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.notEqual(a, b);
  }
  const g = { crypto: {} }; ensureRandomUUID(g);
  assert.equal(typeof g.crypto.randomUUID(), 'string');
  const own = () => 'x'; const g2 = { crypto: { randomUUID: own } }; ensureRandomUUID(g2);
  assert.equal(g2.crypto.randomUUID, own);
});

test('L10: modelVersion never double-prefixes urn:', () => {
  clearDeclaredDisplayNames();
  const v = new FakeViewer(); const reg = fakeRegistry(); const cat = createHostCatalog({ viewer: v, registry: reg, events: EV });
  v.add(fakeModel('urn:AAA')); v.add(fakeModel('BBB'));
  assert.equal(reg.calls[0][2].modelVersion, 'urn:AAA');
  assert.equal(reg.calls[1][2].modelVersion, 'urn:BBB');
  cat.dispose();
});
