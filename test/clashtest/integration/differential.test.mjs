// test/clashtest/integration/differential.test.mjs
//
// Task P7.8 Steps 1-10 (master Definition of Done item 4): four modes x four selection shapes, the
// assembled engine's result vs a brute-force reference built from the SAME real `CollisionWorld`, so
// the suite tests the engine's DECOMPOSITION, not the library's geometry. Every run goes through the
// engine's DEFAULT executor (`createLocalUnitExecutor`) over a real world -- no scripted executor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClashTestEngine } from '../../../clashtest/index.js';
import { RUN_OPTION_DEFAULTS } from '../../../clashtest/options.js';
import { canonicalJson } from '../../../clashtest/util/canonical.js';
import { makeRealWorldFixture, recordFindClashes, countWorldLifecycleCalls } from '../support/realWorld.mjs';
import { bruteForceReference, pairIdKey } from '../support/bruteForce.mjs';
import { assertPairSets } from '../support/pairSets.mjs';
import { createFakeClock } from '../support/fakeClock.mjs';

// Two models, deliberately overlapping across and within a model (unit cubes; positions are centres).
// The brief's five owners are kept verbatim; two NEAR-MISS additions (gap 0.03 < clearance 0.05) are
// added because, measured, the brief's layout gives `clearance` an EMPTY reference in all four
// shapes (overlapping boxes are not clearance pairs), so every clearance arm would have compared
// [] with [] and proved nothing:
//   a:400 at x=1.53    -- 0.03 from a:200 (same-model clearance pair)
//   b:200's second fragment at x=-1.03 -- 0.03 from a:100 (cross-model clearance pair)
// Every shape x mode reference is non-empty with this layout, and each arm asserts it.
const SPEC = {
  a: { 100: [[0, 0, 0]], 200: [[0.5, 0, 0]], 300: [[10, 0, 0]], 400: [[1.53, 0, 0]] },
  b: { 100: [[0.25, 0, 0]], 200: [[9.75, 0, 0], [-1.03, 0, 0]] },
};

// `expect` is the arm's ORACLE STRENGTH, not the mode's: see support/pairSets.mjs. Every fixture in this
// file is built to run clean, so every arm here is 'exact' -- 'correlated' and
// 'characterization-only' exist for the deliberately caveated arms of Steps 11-19 (P7.8b).
const MODES = [
  { mode: 'volume-overlap', expect: 'exact' },
  { mode: 'clearance', clearance: 0.05, expect: 'exact' },
  { mode: 'surface-intersection', expect: 'exact' },
  { mode: 'containment', expect: 'exact' },
];

// ---- harness -----------------------------------------------------------------------------------

const definitionOf = ({ testId, mode, clearance, selectionA, selectionB }) => ({
  schemaVersion: 1, testId, revision: 1, name: testId, mode,
  ...(mode === 'clearance' ? { clearance } : {}),
  selectionA: { entries: selectionA }, selectionB: { entries: selectionB },
});

const ownersOf = (spec, modelKey) => Object.keys(spec[modelKey]).map(Number).sort((x, y) => x - y);
const pairKeysOf = (resultSet) => resultSet.results.map((r) => pairIdKey(r.pair)).sort();
const macrotask = () => new Promise((resolve) => { setImmediate(resolve); });

/**
 * Step 8 (AC-3 tail): the library-call conformance of ONE run's recorded calls. Every call uses the
 * `targets` shape, `groupBy: 'dbId'`, exactly the definition's one `mode`, `clearance` present iff the
 * mode is `clearance`; the engine never has two calls in flight.
 */
function assertLibraryConformance(calls, { mode, clearance }) {
  assert.ok(calls.length > 0, 'premise: the run made library calls');
  for (const { query } of calls) {
    assert.ok(Array.isArray(query.target?.targets) && query.target.targets.length > 0, 'the `targets` shape');
    assert.equal(Object.hasOwn(query.target, 'model'), false, 'no legacy single-target `target.model`');
    assert.equal(Object.hasOwn(query.target, 'dbIds'), false, 'no legacy single-target `target.dbIds`');
    assert.equal(query.groupBy, 'dbId');
    assert.equal(query.mode, mode, 'exactly the definition\'s mode');
    assert.equal(Object.hasOwn(query, 'clearance'), mode === 'clearance', 'clearance iff the mode is clearance');
    if (mode === 'clearance') assert.equal(query.clearance, clearance);
  }
}

/**
 * A real-world fixture + the assembled engine (DEFAULT executor: `createLocalUnitExecutor`) + the
 * Step 8 recorders. `run(def, options)` runs to the seal and asserts the conformance arm on that run:
 * the call shapes, peak in-flight 1, ZERO calls after the terminal seal, and no evict/dispose/
 * invalidate from the engine.
 */
async function harness(spec = SPEC) {
  const fx = await makeRealWorldFixture({ models: spec });
  const recorder = recordFindClashes(fx.world);
  const lifecycle = countWorldLifecycleCalls(fx.world);
  const clock = createFakeClock({ start: Date.UTC(2026, 8, 24) });
  const engine = createClashTestEngine({
    world: fx.world, enumerator: fx.enumerator,
    now: clock.now, yieldToScheduler: clock.yieldToScheduler, scheduleTimeout: () => () => {},
  });
  async function run(def, runOptions) {
    const first = recorder.calls.length;
    const { resultSet } = await engine.startRun(def, runOptions).done;
    const atSeal = recorder.calls.length;
    for (let i = 0; i < 3; i++) await macrotask();
    assert.equal(recorder.calls.length, atSeal, 'no findClashes call after the terminal seal');
    assertLibraryConformance(recorder.calls.slice(first, atSeal), def);
    assert.equal(recorder.peakInFlight, 1, 'peak concurrent in-flight findClashes calls is 1');
    assert.deepEqual(lifecycle, { evictModel: 0, dispose: 0, invalidateModelPlacement: 0 },
      'the engine calls neither evictModel, dispose nor invalidateModelPlacement');
    return resultSet;
  }
  return { fx, engine, recorder, lifecycle, run };
}

function assertCleanFull(resultSet) {
  assert.equal(resultSet.outcome.status, 'completed', JSON.stringify(resultSet.outcome));
  assert.equal(resultSet.outcome.coverage, 'full');
  // The fixtures in THIS file are built to run clean, so every arm also asserts that it IS clean --
  // otherwise `expect: 'exact'` would be silently weakened by a fixture that started caveating.
  assert.equal(resultSet.outcome.integrity, 'clean');
  assert.equal(resultSet.outcome.environmentSensitive, false);
}

// ---- Steps 1 + 5: four selection shapes x four modes --------------------------------------------

const SHAPES = [
  // cell-1 bisection (3b), self-exclusion, F2 (the naive negative control is its own test below)
  { shape: 'same-model',
    selectionA: [{ kind: 'model', modelKey: 'a' }], selectionB: [{ kind: 'model', modelKey: 'a' }],
    sources: ownersOf(SPEC, 'a').map((d) => ['a', d]), targets: [['a', null]] },
  // cell-2 cross product over explicit lists
  { shape: 'cross-model explicit',
    selectionA: [{ kind: 'elements', modelKey: 'a', dbIds: [100, 200] }],
    selectionB: [{ kind: 'elements', modelKey: 'b', dbIds: [100, 200] }],
    sources: [['a', 100], ['a', 200]], targets: [['b', [100, 200]]] },
  // the `targets` entry with `dbIds` omitted (§19.2)
  { shape: 'whole-model target',
    selectionA: [{ kind: 'elements', modelKey: 'a', dbIds: [100] }], selectionB: [{ kind: 'model', modelKey: 'b' }],
    sources: [['a', 100]], targets: [['b', null]] },
  // enumerator-driven source expansion (F15)
  { shape: 'whole-model source',
    selectionA: [{ kind: 'model', modelKey: 'a' }], selectionB: [{ kind: 'model', modelKey: 'b' }],
    sources: ownersOf(SPEC, 'a').map((d) => ['a', d]), targets: [['b', null]] },
];

for (const { shape, selectionA, selectionB, sources, targets } of SHAPES) {
  for (const { mode, clearance, expect } of MODES) {
    test(`differential: ${shape}, ${mode}`, async () => {
      const h = await harness();
      const def = definitionOf({ testId: `${shape.replace(/\W+/g, '-')}-${mode}`, mode, clearance, selectionA, selectionB });
      const resultSet = await h.run(def);
      assertCleanFull(resultSet);
      const ref = await bruteForceReference(h.fx, { sources, targets, mode, clearance });
      assert.ok(ref.pairIds.length > 0, `premise: the ${shape}/${mode} reference is non-empty (not a vacuous [] === [])`);
      assertPairSets(pairKeysOf(resultSet), ref.pairIds, { mode, resultSet, expect });
    });
  }
}

test('negative control: a naive whole-set-vs-itself findClashes finds no same-model pairs (F2)', async () => {
  const h = await harness();
  const all = ownersOf(SPEC, 'a');
  // The library's fragment-membership self-exclusion (F2): a source fragment is never its own target,
  // so one call over the whole set against itself drops every same-model pair.
  const { pairs } = await h.fx.world.findClashes({
    source: { model: h.fx.modelFor('a'), dbIds: all },
    target: { targets: [{ model: h.fx.modelFor('a'), dbIds: all }] },
    mode: 'volume-overlap', groupBy: 'dbId',
  });
  assert.deepEqual(pairs, []);
  const resultSet = await h.run(definitionOf({ testId: 'self-a', mode: 'volume-overlap',
    selectionA: [{ kind: 'model', modelKey: 'a' }], selectionB: [{ kind: 'model', modelKey: 'a' }] }));
  assertCleanFull(resultSet);
  assert.ok(resultSet.results.length > 0, 'the engine finds the pairs the naive call cannot');
});

// ---- Step 5: partition and broad-phase independence (AC-4) ---------------------------------------

// Two more target models, and selection B as EXPLICIT `elements` entries across b, c and d, so
// `maxTargetModelsPerUnit` genuinely slices. (Review I1: whole-model `kind:'model'` target entries are
// the whole-model sentinel, which sizing.js treats as non-partitionable -- alone in a slice -- so the
// target cap is inert over them; measured: defaults/2/1 all plan the same units.) The lists cover
// every owner of b, c and d, so the pair space equals the whole-model one. `a` and `b` are SPEC's own;
// the whole-model TARGET form stays covered by the shape arms above.
const INVARIANCE_SPEC = {
  ...SPEC,
  c: { 100: [[0.75, 0, 0]], 200: [[10.25, 0, 0]] },
  d: { 100: [[20, 0, 0]], 300: [[0.1, 0, 0]] },
};
const INVARIANCE_TARGETS = ['b', 'c', 'd'].map((modelKey) => [modelKey, ownersOf(INVARIANCE_SPEC, modelKey)]);
const invarianceDef = (mode, clearance) => definitionOf({
  testId: `invariance-${mode}`, mode, clearance,
  selectionA: [{ kind: 'model', modelKey: 'a' }],
  selectionB: INVARIANCE_TARGETS.map(([modelKey, dbIds]) => ({ kind: 'elements', modelKey, dbIds })),
});
// Sizing arms. SLICED is NON-default on both caps (the brief's 500/4 equals RUN_OPTION_DEFAULTS and
// would duplicate the defaults arm); the two TARGET-ONLY arms vary nothing but maxTargetModelsPerUnit.
// The premise assertions below pin all of that.
const SLICED = { maxSourceDbIdsPerUnit: 2, maxTargetModelsPerUnit: 2 };
const INVARIANCE_ARMS = [
  { name: 'defaults', runOptions: { broadPhase: 'tlas' } },
  { name: 'source1-target1', runOptions: { maxSourceDbIdsPerUnit: 1, maxTargetModelsPerUnit: 1, broadPhase: 'tlas' } },
  { name: 'sliced', runOptions: { ...SLICED, broadPhase: 'tlas' } },
  { name: 'target-only-2', runOptions: { maxTargetModelsPerUnit: 2, broadPhase: 'tlas' } },
  { name: 'target-only-1', runOptions: { maxTargetModelsPerUnit: 1, broadPhase: 'tlas' } },
  { name: 'source1-linear', runOptions: { maxSourceDbIdsPerUnit: 1, broadPhase: 'linear' } },
  { name: 'linear', runOptions: { broadPhase: 'linear' } },
];

for (const { mode, clearance } of MODES.filter((m) => m.mode === 'volume-overlap' || m.mode === 'clearance')) {
  test(`partition and broad-phase independence (AC-4), ${mode}`, async () => {
    assert.notEqual(SLICED.maxSourceDbIdsPerUnit, RUN_OPTION_DEFAULTS.maxSourceDbIdsPerUnit);
    assert.notEqual(SLICED.maxTargetModelsPerUnit, RUN_OPTION_DEFAULTS.maxTargetModelsPerUnit);
    const digests = [];
    const units = new Map();
    let reference = null;
    for (const { name, runOptions } of INVARIANCE_ARMS) {
      const h = await harness(INVARIANCE_SPEC);
      const before = h.recorder.calls.length;
      const resultSet = await h.run(invarianceDef(mode, clearance), runOptions);
      assertCleanFull(resultSet);
      assert.equal(resultSet.provenance.broadPhase, runOptions.broadPhase);
      // Review M1: the library calls themselves carried the arm's broad phase (not just provenance).
      for (const { query } of h.recorder.calls.slice(before)) assert.equal(query.broadPhase, runOptions.broadPhase, name);
      const cap = runOptions.maxTargetModelsPerUnit ?? RUN_OPTION_DEFAULTS.maxTargetModelsPerUnit;
      for (const u of resultSet.ledger.units) assert.ok(u.targets.length <= cap, `${name}: unit ${u.unitId} exceeds the target cap`);
      digests.push(resultSet.digests.pairSetDigest);
      units.set(name, resultSet.ledger.units.length);
      reference ??= await bruteForceReference(h.fx, { mode, clearance,
        sources: ownersOf(INVARIANCE_SPEC, 'a').map((d) => ['a', d]), targets: INVARIANCE_TARGETS });
      assert.ok(reference.pairIds.length > 0, 'premise: a non-empty reference');
      assertPairSets(pairKeysOf(resultSet), reference.pairIds, { mode, resultSet, expect: 'exact' });
    }
    assert.equal(new Set(digests).size, 1, 'pairSetDigest must not depend on chunking or broad phase');
    // Premises, so the digest equality is not vacuous. Only DISTINCTNESS is asserted -- exact unit
    // counts are the planner's (P3) business. (Measured at 4c5476f: defaults 1, 1/1 12, 2/2 4,
    // target-only-2 2, target-only-1 3.)
    const count = (name) => units.get(name);
    assert.equal(new Set(['defaults', 'source1-target1', 'sliced'].map(count)).size, 3,
      `the tlas sizing arms plan distinctly: ${JSON.stringify([...units])}`);
    assert.equal(new Set(['defaults', 'target-only-2', 'target-only-1'].map(count)).size, 3,
      `maxTargetModelsPerUnit ALONE changes the plan: ${JSON.stringify([...units])}`);
  });
}

// ---- Step 7: determinism (AC-6, T2) ---------------------------------------------------------------

const DETERMINISM_RUNS = 10;
const DIAGNOSTIC_FIELDS = ['total', 'completenessAffectingCount', 'unclassifiedOccurrences', 'countsByReason',
  'omittedReasonOccurrences', 'geometryReadinessOccurrences'];
const wholeSourceDef = (mode, clearance) => definitionOf({ testId: `determinism-${mode}`, mode, clearance,
  selectionA: [{ kind: 'model', modelKey: 'a' }], selectionB: [{ kind: 'model', modelKey: 'b' }] });

/** The fields the determinism promise covers. Never `provenance.models[].elementCount` (gate G-EC). */
function determinismFingerprint(resultSet) {
  // The promise is scoped to environmentSensitive === false (§15.1, AC-19(c)): asserted FIRST.
  assert.equal(resultSet.outcome.environmentSensitive, false);
  assert.ok(resultSet.results.length > 0, 'premise: the run has results (review M2: not a vacuous empty fingerprint)');
  return canonicalJson({
    pairSetDigest: resultSet.digests.pairSetDigest,
    ledgerDigest: resultSet.digests.ledgerDigest,
    diagnostics: Object.fromEntries(DIAGNOSTIC_FIELDS.map((f) => [f, resultSet.diagnostics[f]])),
    taints: resultSet.ledger.units.map((u) => [u.unitId, u.taints]),
  });
}

// All four modes: §15.1 withholds repeatability from CAVEATED runs, not from surface-intersection or
// containment, and every fixture here asserts itself clean -- so a rerun that differs is a defect
// (review finding M2). The §15.1 licence is exercised by the caveated arms of Steps 14-17 (P7.8b).
for (const { mode, clearance } of MODES) {
  test(`determinism: ${DETERMINISM_RUNS} runs on one world and ${DETERMINISM_RUNS} on fresh worlds agree (AC-6), ${mode}`, async () => {
    const def = wholeSourceDef(mode, clearance);
    const fingerprints = [];
    const shared = await harness();
    for (let i = 0; i < DETERMINISM_RUNS; i++) fingerprints.push(determinismFingerprint(await shared.run(def)));
    for (let i = 0; i < DETERMINISM_RUNS; i++) fingerprints.push(determinismFingerprint(await (await harness()).run(def)));
    assert.equal(new Set(fingerprints).size, 1, 'identical digests, diagnostics accounting and unit taints');
  });
}

// ---- Step 8: zero calls after a cancel (AC-3 tail) ---------------------------------------------

test('library-call conformance: no findClashes call after a cancel', async () => {
  const h = await harness();
  const def = wholeSourceDef('volume-overlap');
  const handle = h.engine.startRun(def, { maxSourceDbIdsPerUnit: 1 });   // one unit per source owner
  let callsAtCancel = null;
  handle.subscribe((event) => {
    if (event.type === 'unit' && callsAtCancel === null) {
      callsAtCancel = h.recorder.calls.length;
      handle.cancel();
    }
  });
  const { resultSet } = await handle.done;
  for (let i = 0; i < 3; i++) await macrotask();
  assert.notEqual(callsAtCancel, null, 'premise: a unit settled, so the cancel landed mid-plan');
  assert.equal(resultSet.outcome.status, 'cancelled');
  assert.equal(h.recorder.calls.length, callsAtCancel, 'no findClashes call after the cancel');
  assert.ok(resultSet.ledger.units.some((u) => u.outcome === 'not-run'), 'premise: units were left unstarted');
  assertLibraryConformance(h.recorder.calls, def);
  assert.equal(h.recorder.peakInFlight, 1);
  assert.deepEqual(h.lifecycle, { evictModel: 0, dispose: 0, invalidateModelPlacement: 0 });
});

// ---- the recording seam's own contract (review M5) ----------------------------------------------

test('recordFindClashes: restore() removes the override and the prototype method is used again', async () => {
  const fx = await makeRealWorldFixture({ models: SPEC });
  const proto = Object.getPrototypeOf(fx.world).findClashes;
  const recorder = recordFindClashes(fx.world);
  assert.equal(Object.hasOwn(fx.world, 'findClashes'), true, 'premise: an own-property override is installed');
  assert.notEqual(fx.world.findClashes, proto);
  const query = { source: { model: fx.modelFor('a'), dbIds: [100] },
    target: { targets: [{ model: fx.modelFor('b') }] }, mode: 'volume-overlap', groupBy: 'dbId' };
  const recorded = await fx.world.findClashes(query);
  assert.equal(recorder.calls.length, 1);
  assert.deepEqual(recorder.calls[0].pairs, recorded.pairs);
  recorder.restore();
  assert.equal(Object.hasOwn(fx.world, 'findClashes'), false, 'no own property left behind');
  assert.equal(fx.world.findClashes, proto, 'the prototype method is back');
  const plain = await fx.world.findClashes(query);
  assert.equal(recorder.calls.length, 1, 'a call after restore() is not recorded');
  assert.equal(plain.pairs.length, recorded.pairs.length);
  assert.doesNotThrow(() => recordFindClashes(fx.world).restore(), 'the world can be recorded again');
});
