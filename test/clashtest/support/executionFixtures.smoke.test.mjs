// test/clashtest/support/executionFixtures.smoke.test.mjs
//
// P4 test-support smoke check for the three new fixture files (executionWorld.mjs,
// executionRequests.mjs, realWorldFixture.mjs). Confirms every export exists, is callable, and
// produces the documented shape -- NOT full behavioral coverage of P4's executor/diagnostics, which
// lands with the P4.5-P4.8 tasks that actually consume these fixtures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createExecutionWorld, makeRequest, makeExecutorDeps } from './index.mjs';
import { makeTwoModelFixture, box } from './realWorldFixture.mjs';
import { checkScopeBracket } from '../../../clashtest/planning/scopeDigest.js';
import { CollisionWorld } from '../../../collision/index.js';

test('createExecutionWorld passes the P0 fake-world surface through verbatim and adds the P1 lease surface', async () => {
  const world = createExecutionWorld();
  for (const k of ['calls', 'script', 'hold', 'inFlight', 'maxInFlight', 'disposed', 'findClashes',
    'admitModel', 'isLeaseValid', 'evictModel', 'invalidateModelPlacement', 'dispose']) {
    assert.ok(k in world, `createExecutionWorld must expose ${k}`);
  }
  assert.equal(world.inFlight, 0);
  assert.equal(world.maxInFlight, 0);
  assert.equal(world.disposed, false);
  assert.deepEqual(world.calls, []);

  // P0's own recording/scripting surface still works through the composition.
  world.script({ pairs: [], statistics: { diagnostics: [] } });
  const result = await world.findClashes({
    source: { model: {}, dbIds: [] }, target: { targets: [{ model: {} }] }, mode: 'volume-overlap', groupBy: 'dbId',
  });
  assert.deepEqual(result, { pairs: [], statistics: { diagnostics: [] } });
  assert.equal(world.calls.length, 1);
  assert.equal(world.maxInFlight, 1);

  // P1's lease surface still works through the composition.
  const model = {};
  const lease = world.admitModel(model);
  assert.equal(world.isLeaseValid(lease), true);
  world.evictModel(model);
  assert.equal(world.isLeaseValid(lease), false);
});

test('createExecutionWorld().hold() parks a call until released (the P7 disposal seam)', async () => {
  const world = createExecutionWorld();
  const { started, release } = world.hold();
  const pending = world.findClashes({
    source: { model: {}, dbIds: [] }, target: { targets: [{ model: {} }] }, mode: 'volume-overlap', groupBy: 'dbId',
  });
  await started;
  assert.equal(world.inFlight, 1, 'the call must be in flight while parked');
  release();
  await pending;
  assert.equal(world.inFlight, 0);
});

test('createExecutionWorld().dispose() disposes both the fake-world and lease halves', () => {
  const world = createExecutionWorld();
  world.dispose();
  assert.equal(world.disposed, true);
  assert.throws(() => world.admitModel({}), { name: 'WorldDisposedError' });
});

test('makeRequest({}) builds a well-shaped ExecutionRequest over the mk-a/mk-b fixture', () => {
  const request = makeRequest({});
  assert.equal(request.unit.unitId, '1.0');
  assert.equal(request.unit.sourceModelKey, 'mk-a');
  assert.deepEqual(request.materialized.sourceDbIds, [10, 11]);
  assert.deepEqual(request.materialized.targets, [{ modelKey: 'mk-b', scope: 'roots', dbIds: [20] }]);
  assert.equal(request.materialized.scopeExpect.length, 2);
  assert.equal(request.mode, 'volume-overlap');
  assert.equal(request.broadPhase, 'tlas');
  assert.equal(request.runId, 'run-1');
  assert.equal(request.attempt, 0);
  assert.deepEqual(request.limits, { maxPairsPerOutcome: 1_000, maxDiagnosticsPerOutcome: 2_000, maxDistinctReasons: 64 });
  assert.equal(request.snapshot.length, 2);
});

test('makeRequest shorthand keys merge into materialized independently of each other and of other top-level overrides', () => {
  const request = makeRequest({
    mode: 'clearance', clearance: 0.05, sourceDbIds: [1],
    targets: [{ modelKey: 'mk-b', scope: 'roots', dbIds: [2] }],
  });
  assert.equal(request.mode, 'clearance');
  assert.equal(request.clearance, 0.05);
  assert.deepEqual(request.materialized.sourceDbIds, [1]);
  assert.deepEqual(request.materialized.targets, [{ modelKey: 'mk-b', scope: 'roots', dbIds: [2] }]);
  // scopeExpect was not named in `over`, so it stays at its default -- deliberately decoupled from
  // sourceDbIds/targets (the bracket reads only request.materialized.scopeExpect).
  assert.deepEqual(request.materialized.scopeExpect, makeRequest({}).materialized.scopeExpect);
});

test('makeRequest results are independent: mutating one does not leak into the next default request', () => {
  const first = makeRequest({});
  first.materialized.targets[0].dbIds.push(999);
  first.unit.sourceRanges.push('leaked');
  const second = makeRequest({});
  assert.deepEqual(second.materialized.targets[0].dbIds, [20], 'a mutated default target dbIds array must not leak');
  assert.deepEqual(second.unit.sourceRanges, [], 'a mutated default sourceRanges array must not leak');
});

test('makeExecutorDeps({}) wires a real ModelRegistry that lazily admits the fixture models', () => {
  const deps = makeExecutorDeps({});
  for (const k of ['world', 'registry', 'enumerator', 'models', 'now', 'yieldToScheduler', 'sliceBudgetMs']) {
    assert.ok(k in deps, `makeExecutorDeps must return ${k}`);
  }
  assert.deepEqual(Object.keys(deps.models).sort(), ['mk-a', 'mk-b']);
  assert.equal(typeof deps.now, 'function');
  assert.equal(typeof deps.yieldToScheduler, 'function');
  assert.equal(typeof deps.sliceBudgetMs, 'number');

  const bindingA = deps.registry.bindingFor('mk-a');
  assert.ok(bindingA, 'mk-a must resolve to a live binding (lazy admission via world.admitModel)');
  assert.equal(bindingA.model, deps.models['mk-a']);
  assert.equal(bindingA.modelVersion, 'v1');
});

test('the default two-model fixture reaches scopeProof: equal through checkScopeBracket', async () => {
  const deps = makeExecutorDeps({});
  const request = makeRequest({});
  const bindings = new Map(Object.keys(deps.models).map((k) => [k, deps.registry.bindingFor(k)]));
  const ctx = { checkpoint: async () => {} };
  const { proof } = await checkScopeBracket(request.materialized.scopeExpect, { enumerator: deps.enumerator, bindings, ctx });
  assert.equal(proof, 'equal', 'the default enumerator config and the default scopeExpect must be matched to each other');
});

test('makeExecutorDeps({registry: null}) behaves the same as an omitted registry', () => {
  const deps = makeExecutorDeps({ registry: null });
  assert.ok(deps.registry.bindingFor('mk-a'), 'a null registry override must still register the fixture models');
  assert.ok(deps.registry.bindingFor('mk-b'));
});

test('makeExecutorDeps accepts an injected real world/models (the T2 reuse path)', () => {
  const { modelA, modelB } = makeTwoModelFixture();
  const deps = makeExecutorDeps({ world: createExecutionWorld(), models: { 'mk-a': modelA, 'mk-b': modelB } });
  assert.equal(deps.models['mk-a'], modelA);
  assert.equal(deps.models['mk-b'], modelB);
  assert.ok(deps.registry.bindingFor('mk-a'), 'an injected model must still be registered and resolvable');
});

test('realWorldFixture: makeTwoModelFixture + box build a real CollisionWorld that finds a cross-model clash', async () => {
  const fixture = makeTwoModelFixture({
    rootNodesA: [{ dbId: 100, fragments: [1] }],
    fragSpecsA: { 1: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] } },
    rootNodesB: [{ dbId: 200, fragments: [2] }],
    fragSpecsB: { 2: { geometryIndex: 0, geometry: box(2, 2, 2), at: [1, 0, 0] } },
  });
  const world = await CollisionWorld.fromViewer(fixture.viewer, { now: () => 0 });
  const result = await world.findClashes({
    source: { model: fixture.modelA, dbIds: [100] },
    target: { targets: [{ model: fixture.modelB, dbIds: [200] }] },
    mode: 'volume-overlap', groupBy: 'dbId',
  });
  assert.equal(result.pairs.length, 1);
  assert.equal(result.pairs[0].source.dbId, 100);
  assert.equal(result.pairs[0].target.dbId, 200);
});
