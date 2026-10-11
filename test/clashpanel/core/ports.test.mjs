// test/clashpanel/core/ports.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BASIS_FAILURE_REASONS, assertBridgePort, assertCatalogPort, narrowEnginePort, readBasisVerdict,
} from '../../../clashpanel/core/ports.js';
import { BASIS_VERDICT_TIMEOUT_MS } from '../../../clashpanel/core/constants.js';
import { createClashTestEngine } from '../../../clashtest/index.js';
import { createEngineWorld } from '../../clashtest/support/index.mjs';

// ---- inline stubs (Task 3 provides the shared fakes) -----------------------------------------------------------------
function manualScheduler() {
  let nextId = 1;
  const timers = new Map();
  const delays = [];
  return {
    now: () => 0,
    setTimeout(fn, ms) { const id = nextId; nextId += 1; timers.set(id, fn); delays.push(ms); return id; },
    clearTimeout(id) { timers.delete(id); },
    yield: async () => {},
    fire() { const fns = [...timers.values()]; timers.clear(); for (const fn of fns) fn(); },
    pending: () => timers.size,
    delays,
  };
}
const catalogWith = (measurementBasis) => ({ measurementBasis });
const read = (catalog, keys = ['a', 'b'], opts = {}) => readBasisVerdict(catalog, keys, { scheduler: manualScheduler(), ...opts });

const PORT_METHODS = ['validateTest', 'startRun', 'retainResultSet', 'releaseResultSet', 'getPersistenceState', 'getFreshness', 'assessNoClashClaim'];
function stubEngine(over = {}) {
  const calls = [];
  const spy = (name, ret) => function spyFn(...args) { calls.push({ name, args, self: this }); return ret; };
  const engine = {
    calls,
    validateTest: spy('validateTest', { issues: [], issuesTruncated: false }),
    startRun: spy('startRun', { runId: 'r1' }),
    retainResultSet: spy('retainResultSet', { release() {} }),
    releaseResultSet: spy('releaseResultSet', undefined),
    getPersistenceState: spy('getPersistenceState', null),
    getFreshness: spy('getFreshness', Promise.resolve({ state: 'current', reasons: [] })),
    assessNoClashClaim: spy('assessNoClashClaim', Promise.resolve({ allowed: false })),
    derivations: { summarize: spy('summarize', 1), groupBy: spy('groupBy', 2), filter: spy('filter', 3) },
    registry: { bindingFor: spy('bindingFor', null) },
    ...over,
  };
  return engine;
}

// ---- narrowEnginePort (AC-P20, structural half) ------------------------------------------------------------------------
test('narrowEnginePort: exposes EXACTLY the catalog members and is deeply frozen', () => {
  const port = narrowEnginePort(stubEngine());
  assert.deepEqual(Object.keys(port).sort(), [...PORT_METHODS, 'derivations', 'registry'].sort());
  assert.deepEqual(Object.keys(port.derivations).sort(), ['filter', 'groupBy', 'summarize']);
  assert.deepEqual(Object.keys(port.registry), ['bindingFor']);
  for (const o of [port, port.derivations, port.registry]) assert.ok(Object.isFrozen(o));
});

test('narrowEnginePort: forwards arguments and results unchanged and keeps the engine as `this`', () => {
  const engine = stubEngine();
  const port = narrowEnginePort(engine);
  const def = { testId: 't' };
  assert.deepEqual(port.startRun(def, { persist: false }), { runId: 'r1' });
  port.registry.bindingFor('mA');
  port.derivations.groupBy({ set: 1 }, ['element'], { signal: null });
  assert.deepEqual(engine.calls.map((c) => c.name), ['startRun', 'bindingFor', 'groupBy']);
  assert.deepEqual(engine.calls[0].args, [def, { persist: false }]);
  assert.equal(engine.calls[0].self, engine);
  assert.equal(engine.calls[1].self, engine.registry);
  assert.equal(engine.calls[2].self, engine.derivations);
});

test('narrowEnginePort: a synchronous engine throw propagates unchanged (startRun failures are typed errors)', () => {
  const boom = Object.assign(new Error('capacity'), { name: 'ResultCapacityError' });
  const port = narrowEnginePort(stubEngine({ startRun() { throw boom; } }));
  assert.throws(() => port.startRun({}), (e) => e === boom);
});

test('narrowEnginePort: a missing member throws TypeError naming it', () => {
  for (const name of PORT_METHODS) {
    const engine = stubEngine();
    delete engine[name];
    assert.throws(() => narrowEnginePort(engine), (e) => e instanceof TypeError && e.message.includes(`engine.${name}`), name);
  }
  for (const name of ['summarize', 'groupBy', 'filter']) {
    const engine = stubEngine();
    delete engine.derivations[name];
    assert.throws(() => narrowEnginePort(engine), (e) => e instanceof TypeError && e.message.includes(`derivations.${name}`), name);
  }
  assert.throws(() => narrowEnginePort(stubEngine({ registry: {} })), /registry\.bindingFor/);
  assert.throws(() => narrowEnginePort(stubEngine({ registry: undefined })), /registry\.bindingFor/);
  assert.throws(() => narrowEnginePort(null), TypeError);
  assert.throws(() => narrowEnginePort(undefined), TypeError);
});

test('AC-P20: a Proxy engine that throws on register/unregister/keyOf/invalidateModelPlacement/dispose proves the narrow port never touches them', () => {
  const FORBIDDEN = new Set(['register', 'unregister', 'keyOf', 'notifyPlacementChanged', 'invalidateModelPlacement', 'dispose', 'retryPersist', 'rerun', 'getResultSet', 'saveTest']);
  const touched = [];
  const guard = (target, owner) => new Proxy(target, {
    get(t, prop, receiver) {
      touched.push(`${owner}.${String(prop)}`);
      if (FORBIDDEN.has(prop)) throw new Error(`forbidden access: ${owner}.${String(prop)}`);
      return Reflect.get(t, prop, receiver);
    },
  });
  const engine = stubEngine();
  const raw = guard({ ...engine, derivations: guard(engine.derivations, 'derivations'), registry: guard(engine.registry, 'registry') }, 'engine');
  const port = narrowEnginePort(raw);
  for (const m of PORT_METHODS) port[m]({});
  port.registry.bindingFor('k');
  for (const m of ['summarize', 'groupBy', 'filter']) port.derivations[m]({});
  assert.deepEqual([...new Set(touched)].filter((t) => FORBIDDEN.has(t.split('.')[1])), []);
  assert.deepEqual(new Set(touched.filter((t) => t.startsWith('registry.'))), new Set(['registry.bindingFor']));
  assert.deepEqual(new Set(touched.filter((t) => t.startsWith('derivations.'))), new Set(['derivations.summarize', 'derivations.groupBy', 'derivations.filter']));
});

test('narrowEnginePort: works over the REAL engine and never exposes its dispose/registry write surface', async () => {
  const engine = createClashTestEngine(createEngineWorld().config());
  try {
    const port = narrowEnginePort(engine);
    assert.equal(port.registry.bindingFor('unknown-key'), null);
    assert.equal(port.registry.bindingFor('mA').modelKey, 'mA');
    assert.ok(port.validateTest({}).issues.length > 0);
    assert.equal(port.dispose, undefined);
    assert.equal(port.invalidateModelPlacement, undefined);
    assert.equal(port.registry.register, undefined);
    assert.equal(port.registry.unregister, undefined);
    assert.equal(port.registry.keyOf, undefined);
  } finally {
    await engine.dispose();
  }
});

// ---- readBasisVerdict (PD-17 / AC-P18 reader, fail closed) -----------------------------------------------------------
test('readBasisVerdict: verified passes through as a frozen {state, basisKey}; the host receives a private copy of the keys', async () => {
  const seen = [];
  const keys = ['b', 'a'];
  const v = await read(catalogWith((k) => { seen.push(k); k.push('mutated'); return { state: 'verified', basisKey: 'basis-1', extra: '<b>x</b>' }; }), keys);
  assert.deepEqual(v, { state: 'verified', basisKey: 'basis-1' });
  assert.ok(Object.isFrozen(v));
  assert.deepEqual(seen, [['b', 'a', 'mutated']]);
  assert.deepEqual(keys, ['b', 'a']);
});

test('readBasisVerdict: unverified and incompatible pass through with the host reason kept as PLAIN text', async () => {
  const hostile = '<img src=x onerror=alert(1)> & "quotes"';
  for (const state of ['unverified', 'incompatible']) {
    const v = await read(catalogWith(() => ({ state, reason: hostile, html: '<b>x</b>' })));
    assert.deepEqual(v, { state, reason: hostile });
    assert.equal(typeof v.reason, 'string');
  }
});

test('readBasisVerdict: synchronous and promised verdicts both work and no timer is left pending', async () => {
  const sched = manualScheduler();
  const sync = await readBasisVerdict(catalogWith(() => ({ state: 'verified', basisKey: 'k' })), ['a'], { scheduler: sched });
  const later = await readBasisVerdict(catalogWith(async () => ({ state: 'unverified', reason: 'r' })), ['a'], { scheduler: sched });
  assert.equal(sync.state, 'verified');
  assert.deepEqual(later, { state: 'unverified', reason: 'r' });
  assert.equal(sched.pending(), 0);
});

test('readBasisVerdict: a missing method (or a missing catalog) fails closed as unverified', async () => {
  for (const catalog of [{}, null, undefined, { measurementBasis: 'not a function' }]) {
    assert.deepEqual(await read(catalog), { state: 'unverified', reason: BASIS_FAILURE_REASONS.missing });
  }
});

test('readBasisVerdict: a synchronous throw and a rejection fail closed with DIFFERENT fixed reasons (error text is never leaked)', async () => {
  const threw = await read(catalogWith(() => { throw new Error('secret <b>detail</b>'); }));
  const rejected = await read(catalogWith(() => Promise.reject(new Error('secret <b>detail</b>'))));
  assert.deepEqual(threw, { state: 'unverified', reason: BASIS_FAILURE_REASONS.threw });
  assert.deepEqual(rejected, { state: 'unverified', reason: BASIS_FAILURE_REASONS.rejected });
  assert.notEqual(threw.reason, rejected.reason);
});

test('readBasisVerdict: a verdict that never arrives times out via the scheduler (default and custom delay), then a late answer is ignored', async () => {
  const sched = manualScheduler();
  let lateResolve;
  const never = new Promise((resolve) => { lateResolve = resolve; });
  const p = readBasisVerdict(catalogWith(() => never), ['a'], { scheduler: sched });
  await Promise.resolve();
  assert.deepEqual(sched.delays, [BASIS_VERDICT_TIMEOUT_MS]);
  assert.equal(sched.pending(), 1);
  sched.fire();
  assert.deepEqual(await p, { state: 'unverified', reason: BASIS_FAILURE_REASONS.timeout });
  lateResolve({ state: 'verified', basisKey: 'too-late' });
  await Promise.resolve();
  const custom = manualScheduler();
  const q = readBasisVerdict(catalogWith(() => new Promise(() => {})), ['a'], { scheduler: custom, timeoutMs: 7 });
  await Promise.resolve();
  assert.deepEqual(custom.delays, [7]);
  custom.fire();
  assert.equal((await q).reason, BASIS_FAILURE_REASONS.timeout);
});

test('readBasisVerdict: a rejection that arrives after the timeout is swallowed (no unhandled rejection)', async () => {
  const sched = manualScheduler();
  let lateReject;
  const p = readBasisVerdict(catalogWith(() => new Promise((_, reject) => { lateReject = reject; })), ['a'], { scheduler: sched });
  await Promise.resolve();
  sched.fire();
  assert.equal((await p).reason, BASIS_FAILURE_REASONS.timeout);
  lateReject(new Error('late'));
  await new Promise((resolve) => setImmediate(resolve));
});

test('readBasisVerdict: every malformed shape fails closed as unverified/malformed', async () => {
  const hostile = { get state() { throw new Error('getter'); } };
  const shapes = [
    null, undefined, 'verified', 42, true, [], {}, { state: 'verified' }, { state: 'verified', basisKey: '' },
    { state: 'verified', basisKey: 7 }, { state: 'weird', reason: 'x' }, { state: 'unverified' },
    { state: 'incompatible', reason: '' }, { state: 'unverified', reason: { html: 'x' } }, { state: 'incompatible', reason: 5 }, hostile,
  ];
  for (const [i, shape] of shapes.entries()) {
    const v = await read(catalogWith(() => shape));
    assert.deepEqual(v, { state: 'unverified', reason: BASIS_FAILURE_REASONS.malformed }, `shape #${i}`);
  }
});

test('readBasisVerdict: a hostile thenable is treated as a rejection and the five failure reasons are pairwise distinct', async () => {
  const thenable = { get then() { throw new Error('then getter'); } };
  assert.equal((await read(catalogWith(() => thenable))).reason, BASIS_FAILURE_REASONS.rejected);
  const reasons = Object.values(BASIS_FAILURE_REASONS);
  assert.equal(reasons.length, 5);
  assert.equal(new Set(reasons).size, 5);
  assert.ok(Object.isFrozen(BASIS_FAILURE_REASONS));
});

test('readBasisVerdict: programmer errors reject with TypeError (not host behavior)', async () => {
  await assert.rejects(readBasisVerdict(catalogWith(() => ({})), 'not-an-array', { scheduler: manualScheduler() }), TypeError);
  await assert.rejects(readBasisVerdict(catalogWith(() => ({})), ['a'], {}), TypeError);
  await assert.rejects(readBasisVerdict(catalogWith(() => ({})), ['a']), TypeError);
});

// ---- structural asserts --------------------------------------------------------------------------------------------------
test('assertCatalogPort: requires list/displayNameFor/keyOfModel/onChange, returns the catalog, tolerates a missing measurementBasis', () => {
  const ok = { list() {}, displayNameFor() {}, keyOfModel() {}, onChange() {} };
  assert.equal(assertCatalogPort(ok), ok);
  for (const name of ['list', 'displayNameFor', 'keyOfModel', 'onChange']) {
    const c = { ...ok };
    delete c[name];
    assert.throws(() => assertCatalogPort(c), (e) => e instanceof TypeError && e.message.includes(`catalog.${name}`), name);
  }
  assert.throws(() => assertCatalogPort(null), TypeError);
});

test('assertBridgePort: requires the seven bridge methods (incl. Addendum B presentGroup) and returns the bridge', () => {
  const names = ['present', 'presentGroup', 'clear', 'dispose', 'checkIsolationPrerequisite', 'readAggregateSelection', 'onModelLeft'];
  const ok = Object.fromEntries(names.map((n) => [n, () => {}]));
  assert.equal(assertBridgePort(ok), ok);
  for (const name of names) {
    const b = { ...ok };
    delete b[name];
    assert.throws(() => assertBridgePort(b), (e) => e instanceof TypeError && e.message.includes(`bridge.${name}`), name);
  }
  assert.throws(() => assertBridgePort(undefined), TypeError);
});
