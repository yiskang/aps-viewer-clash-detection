// test/clashtest/viewer/engineIntegration.test.mjs  (T2: the adapter through the REAL engine + CollisionWorld)
//
// The Viewer adapter (`createViewerElementEnumerator`) swapped into the assembled engine over a real
// `CollisionWorld` (`makeRealWorldFixture`), mirroring `engineOver` in
// `test/clashtest/integration/realWorldEnvironment.test.mjs`. The fixture's own synthetic enumerator
// (`fx.enumerator`) is deliberately NOT used: whole-model roots here follow D-V3 (topmost
// fragment-owning nodes), so the oracle is the brute-force reference over the same world.
// No wall clock is asserted (G-CAL); `provenance.models[].elementCount` is never read (G-EC).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClashTestEngine } from '../../../clashtest/index.js';
import { ENGINE_LIMIT_DEFAULTS } from '../../../clashtest/options.js';
import { validateResultSet } from '../../../clashtest/results/validateResultSet.js';
import { createViewerElementEnumerator } from '../../../clashtest/viewer/ViewerElementEnumerator.js';
import { makeRealWorldFixture } from '../support/realWorld.mjs';
import { bruteForceReference, pairIdKey } from '../support/bruteForce.mjs';
import { assertPairSets } from '../support/pairSets.mjs';
import { createFakeClock } from '../support/fakeClock.mjs';

const MODE = 'volume-overlap';
const definitionOf = (testId) => ({
  schemaVersion: 1, testId, revision: 1, name: testId, mode: MODE,
  selectionA: { entries: [{ kind: 'model', modelKey: 'a' }] },
  selectionB: { entries: [{ kind: 'model', modelKey: 'b' }] },
});
const pairKeysOf = (resultSet) => resultSet.results.map((r) => pairIdKey(r.pair)).sort();
const range = (from, to) => Array.from({ length: to - from }, (_, i) => from + i);

/** The assembled engine over one fixture with the ADAPTER as its enumerator (default executor). */
function engineOver(fx, { clock = createFakeClock({ start: Date.UTC(2026, 8, 24) }) } = {}) {
  return createClashTestEngine({
    world: fx.world, enumerator: createViewerElementEnumerator(), now: clock.now,
    yieldToScheduler: clock.yieldToScheduler, scheduleTimeout: () => () => {},
  });
}

// Whole-model roots (D-V3): a -> 100, 200; b -> 100, 300 (the tree root 1 owns nothing).
// b/100 (at x=0.5) overlaps a/100 (at x=0); every other pair is apart.
const treeA = (children = [{ dbId: 100, fragments: [0] }, { dbId: 200, fragments: [1] }]) => ({
  tree: [{ dbId: 1, children }], positions: { 0: [0, 0, 0], 1: [10, 0, 0] },
});
const MODEL_B = {
  tree: [{ dbId: 1, children: [{ dbId: 100, fragments: [0] }, { dbId: 300, fragments: [1] }] }],
  positions: { 0: [0.5, 0, 0], 1: [20, 0, 0] },
};
const fixtureOf = ({ a = treeA(), fragments } = {}) => makeRealWorldFixture({
  models: { a, b: MODEL_B }, ...(fragments ? { fragments } : {}),
});
const runOnce = async (engine, testId) => (await engine.startRun(definitionOf(testId)).done).resultSet;

test('adapter through the real engine: completed/full/clean, brute-force parity, root-owner ledger (1-3)', async () => {
  const fx = await fixtureOf();
  const resultSet = await runOnce(engineOver(fx), 'e2e');

  // (1)
  assert.equal(resultSet.outcome.status, 'completed', JSON.stringify(resultSet.outcome));
  assert.equal(resultSet.outcome.coverage, 'full');
  assert.equal(resultSet.outcome.integrity, 'clean');
  assert.deepEqual(resultSet.ledger.planningGaps, []);
  assert.deepEqual(validateResultSet(resultSet, { limits: ENGINE_LIMIT_DEFAULTS }).issues, []);

  // (2)
  const ref = await bruteForceReference(fx, { mode: MODE, sources: [['a', 100], ['a', 200]], targets: [['b', null]] });
  assert.ok(ref.pairIds.length > 0, 'premise: the reference is non-empty (a/100 x b/100)');
  assertPairSets(pairKeysOf(resultSet), ref.pairIds, { mode: MODE, resultSet, expect: 'exact' });

  // (3)
  assert.deepEqual(resultSet.ledger.rootOwners, [
    { modelKey: 'a', owners: [{ rootDbId: 100, ownerDbIds: [100], cls: 'A' }, { rootDbId: 200, ownerDbIds: [200], cls: 'A' }] },
    { modelKey: 'b', owners: [{ rootDbId: 100, ownerDbIds: [100], cls: 'B' }, { rootDbId: 300, ownerDbIds: [300], cls: 'B' }] },
  ]);
});

// (4) Negative controls: every one fails planning with the stated cause, no results, a valid sealed set.
// Planning-gap ROWS as the real engine records them. A THROWN enumerator error (every
// `enumeration-failed` control) is recorded once by `failPlanning` at the current phase
// ('enumerating'). A planner-RETURNED gap (`owner-mapping-mismatch`, from `rootResolution.js`) is
// recorded twice by the core, not by the adapter: once by the planner on the ledger
// (phase 'planning'), then again by `failPlanning` (`clashtest/run/Run.js`, `run.ledger.recordPlanningGap
// ({ phase: run.phase, cause })`, phase 'enumerating'); the ledger de-duplicates by (phase, cause) only.
// Existing real-engine pins of planner-returned gaps read them the same way
// (`test/clashtest/integration/rootCap.producerReader.test.mjs`, `nodeFactor.ledgerDiagnostic.test.mjs`).
const THROWN = [{ phase: 'enumerating', cause: 'enumeration-failed' }];
const RETURNED = (cause) => [{ phase: 'planning', cause }, { phase: 'enumerating', cause }];
const NEGATIVE_CONTROLS = [
  ['(i) owner mismatch: fragId 1 listed as 999, tree owner 200', 'owner-mapping-mismatch',
    () => fixtureOf({ fragments: { a: { ownerDbIdOverrides: new Map([[1, 999]]) } } })],
  ['(ii) object tree errors', 'enumeration-failed',
    () => fixtureOf({ fragments: { a: { objectTreeReady: false, settleObjectTree: (_ok, err) => err(new Error('x')) } } })],
  ['(iii) D-V6 N: tree-reachable fragment 1 not loaded', 'enumeration-failed',
    () => fixtureOf({ fragments: { a: { notLoadedFragIds: [1] } } })],
  ['(iii) D-V6 U-undefined: fragment 1 owner unresolvable', 'enumeration-failed',
    () => fixtureOf({ fragments: { a: { ownerDbIdOverrides: new Map([[1, undefined]]) } } })],
  ['(iii) D-V6 U-array: fragment 1 owner is an array', 'enumeration-failed',
    () => fixtureOf({ fragments: { a: { ownerDbIdOverrides: new Map([[1, [200, 201]]]) } } })],
  ['(iii) D-V6 out-of-range: tree names fragment 1, fragmentCount 1', 'enumeration-failed',
    () => fixtureOf({ fragments: { a: { fragmentCount: 1 } } })],
  ['(iv) D-V9 population: fragmentCount 20,001 > maxCollisionInstancesPerEpoch', 'enumeration-failed',
    () => fixtureOf({ fragments: { a: { fragmentCount: 20_001 } } })],
  ['(iv) D-V9 fanout: node 100 has 10,001 children > maxChildrenPerNode', 'enumeration-failed',
    () => fixtureOf({ a: treeA([
      { dbId: 100, fragments: [0], children: Array.from({ length: 10_001 }, (_, i) => ({ dbId: 1_000 + i })) },
      { dbId: 200, fragments: [1] }]) })],
  ['(iv) D-V9 per-root tally: root 100 subtree holds 5,001 fragments > maxFragmentsPerDbId', 'enumeration-failed',
    () => fixtureOf({ a: { ...treeA([
      { dbId: 100, fragments: range(0, 2_500), children: [{ dbId: 101, fragments: range(2_500, 5_001) }] },
      { dbId: 200, fragments: [5_001] }]), positions: { 0: [0, 0, 0], 5001: [10, 0, 0] } } })],
  ['(v) fragment 0 claimed by two roots (100 and 200)', 'enumeration-failed',
    () => fixtureOf({ a: treeA([{ dbId: 100, fragments: [0] }, { dbId: 200, fragments: [0, 1] }]) })],
];

for (const [name, cause, build] of NEGATIVE_CONTROLS) {
  test(`negative control ${name} => failed/partial, planning gap ${cause}, no results`, async () => {
    const fx = await build();
    const resultSet = await runOnce(engineOver(fx), 'neg');
    assert.equal(resultSet.outcome.status, 'failed', JSON.stringify(resultSet.outcome));
    assert.equal(resultSet.outcome.coverage, 'partial');
    // Every recorded cause is the stated one, and the rows are exactly the engine's recording of it.
    assert.deepEqual([...new Set(resultSet.ledger.planningGaps.map((g) => g.cause))], [cause]);
    assert.deepEqual(resultSet.ledger.planningGaps, cause === 'enumeration-failed' ? THROWN : RETURNED(cause));
    assert.equal(resultSet.results.length, 0);
    assert.deepEqual(validateResultSet(resultSet, { limits: ENGINE_LIMIT_DEFAULTS }).issues, []);
  });
}

test('(5) determinism: two sequential runs over unchanged models agree on root owners, scope digests, pair-set and ledger digests', async () => {
  const fx = await fixtureOf();
  const engine = engineOver(fx);
  const first = await runOnce(engine, 'det');
  const second = await runOnce(engine, 'det');
  for (const rs of [first, second]) assert.equal(rs.outcome.status, 'completed', JSON.stringify(rs.outcome));
  assert.deepEqual(second.ledger.rootOwners, first.ledger.rootOwners);
  const scopeDigestsOf = (rs) => rs.provenance.models.map((m) => [m.modelKey, m.scopeDigests]);
  assert.ok(scopeDigestsOf(first).length === 2, 'premise: both models recorded');
  assert.deepEqual(scopeDigestsOf(second), scopeDigestsOf(first));
  assert.equal(second.digests.pairSetDigest, first.digests.pairSetDigest);
  assert.equal(second.digests.ledgerDigest, first.digests.ledgerDigest);
});
