// test/clashtest/integration/differential.test.mjs
//
// Task P7.8 Steps 1-10 (master Definition of Done item 4): four modes x four selection shapes, the
// assembled engine's result vs a brute-force reference built from the SAME real `CollisionWorld`, so
// the suite tests the engine's DECOMPOSITION, not the library's geometry. Every run goes through the
// engine's DEFAULT executor (`createLocalUnitExecutor`) over a real world -- no scripted executor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClashTestEngine } from '../../../clashtest/index.js';
// `createStatusReader` is not on the §18 public surface (index.js re-exports only the one-shot
// `getPairStatus`/`getElementStatus`), so the suite imports P5's module directly -- still P5's
// reader, never a P7-local one (duplicate-ownership D4).
import { createStatusReader } from '../../../clashtest/results/status.js';
import { RUN_OPTION_DEFAULTS } from '../../../clashtest/options.js';
import { canonicalJson } from '../../../clashtest/util/canonical.js';
import { makeRealWorldFixture, recordFindClashes } from '../support/realWorld.mjs';
import { bruteForceReference, pairIdKey } from '../support/bruteForce.mjs';
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

// `expect` is the arm's ORACLE STRENGTH, not the mode's: see assertPairSets. Every fixture in this
// file is built to run clean, so every arm here is 'exact' -- 'correlated' and
// 'characterization-only' exist for the deliberately caveated arms of Steps 11-19 (P7.8b).
const MODES = [
  { mode: 'volume-overlap', expect: 'exact' },
  { mode: 'clearance', clearance: 0.05, expect: 'exact' },
  { mode: 'surface-intersection', expect: 'exact' },
  { mode: 'containment', expect: 'exact' },
];

// The differential oracle. Review finding M2: EXACT by default, and a difference is admissible only on
// an arm that declares why (see the brief's oracle-strength table).
function assertPairSets(actual, reference, { mode, resultSet, expect, caveatReasons = [], record }) {
  const { outcome, diagnostics } = resultSet;
  // A CLEAN run: nothing the engine recorded can license a difference. §15.1 scopes its
  // no-repeatability licence to caveated runs, never to a mode.
  const clean = outcome.environmentSensitive === false
    && diagnostics.completenessAffectingUpperBound === 0
    && diagnostics.unclassifiedOccurrences === 0;
  if (expect === 'exact' || clean) {
    assert.deepEqual(actual, reference, `${mode}: a clean run must equal the brute-force reference `
      + `(environmentSensitive=${outcome.environmentSensitive}, `
      + `completenessAffectingUpperBound=${diagnostics.completenessAffectingUpperBound}, `
      + `unclassifiedOccurrences=${diagnostics.unclassifiedOccurrences})`);
    return;
  }
  const symmetricDifference = [
    ...actual.filter((p) => !reference.includes(p)),
    ...reference.filter((p) => !actual.includes(p)),
  ];
  if (symmetricDifference.length === 0) return;          // equality is always acceptable
  if (expect === 'correlated') {
    // A deliberately caveated fixture: EACH differing pair must be inside the run's own caveated
    // scope, read from the sealed set through P5's status reader.
    const reader = createStatusReader(resultSet);
    for (const key of symmetricDifference) {
      const status = reader.pairStatus(JSON.parse(key));  // pairIdKey is canonicalJson(pairId)
      assert.notEqual(status.verdict, 'covered-clean',
        `${mode}: ${key} differs from the reference yet the sealed set calls it covered-clean`);
      assert.ok(status.caveats.some((c) => caveatReasons.includes(c.reason)),
        `${mode}: ${key} differs with no caveat drawn from ${JSON.stringify(caveatReasons)} `
        + `(caveats: ${JSON.stringify(status.caveats)})`);
    }
    return;
  }
  // A MEASUREMENT, not a proof: only an arm that says so in its own name may use it.
  assert.equal(expect, 'characterization-only');
  record(`${mode}: CHARACTERIZATION ONLY -- ${symmetricDifference.length} pair(s) differ under `
    + `${JSON.stringify(outcome.environmentSensitiveCauses)}; this arm does NOT prove decomposition `
    + `equivalence: ${JSON.stringify(symmetricDifference)}`);
}

// ---- harness -----------------------------------------------------------------------------------

const definitionOf = ({ testId, mode, clearance, selectionA, selectionB }) => ({
  schemaVersion: 1, testId, revision: 1, name: testId, mode,
  ...(mode === 'clearance' ? { clearance } : {}),
  selectionA: { entries: selectionA }, selectionB: { entries: selectionB },
});

const ownersOf = (spec, modelKey) => Object.keys(spec[modelKey]).map(Number).sort((x, y) => x - y);
const pairKeysOf = (resultSet) => resultSet.results.map((r) => pairIdKey(r.pair)).sort();
const macrotask = () => new Promise((resolve) => { setImmediate(resolve); });

/** Counting own-property overrides of the world's lifecycle methods (delegating to the real ones). */
function countLifecycleCalls(world) {
  const counts = { evictModel: 0, dispose: 0, invalidateModelPlacement: 0 };
  for (const name of Object.keys(counts)) {
    const real = Object.getPrototypeOf(world)[name];
    Object.defineProperty(world, name, {
      configurable: true, writable: true, enumerable: false,
      value(...args) { counts[name] += 1; return real.apply(world, args); },
    });
  }
  return counts;
}

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
  const lifecycle = countLifecycleCalls(fx.world);
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

// Two more target models so `maxTargetModelsPerUnit` genuinely slices (the SPEC shapes have ONE
// target model, where that cap cannot change anything). `a` and `b` are SPEC's own.
const INVARIANCE_SPEC = {
  ...SPEC,
  c: { 100: [[0.75, 0, 0]], 200: [[10.25, 0, 0]] },
  d: { 100: [[20, 0, 0]], 300: [[0.1, 0, 0]] },
};
const invarianceDef = (mode, clearance) => definitionOf({
  testId: `invariance-${mode}`, mode, clearance,
  selectionA: [{ kind: 'model', modelKey: 'a' }],
  selectionB: [{ kind: 'model', modelKey: 'b' }, { kind: 'model', modelKey: 'c' }, { kind: 'model', modelKey: 'd' }],
});
// Sizing arms. The third is NON-default on both caps (the brief's 500/4 equals RUN_OPTION_DEFAULTS
// and would duplicate the `{}` arm); the premise assertion below pins that.
const SLICED = { maxSourceDbIdsPerUnit: 2, maxTargetModelsPerUnit: 2 };
const INVARIANCE_ARMS = [
  { maxSourceDbIdsPerUnit: 1, maxTargetModelsPerUnit: 1, broadPhase: 'tlas' },
  { broadPhase: 'tlas' },                                                 // defaults
  { ...SLICED, broadPhase: 'tlas' },
  { maxSourceDbIdsPerUnit: 1, broadPhase: 'linear' },
  { broadPhase: 'linear' },
];

for (const { mode, clearance } of MODES.filter((m) => m.mode === 'volume-overlap' || m.mode === 'clearance')) {
  test(`partition and broad-phase independence (AC-4), ${mode}`, async () => {
    assert.notEqual(SLICED.maxSourceDbIdsPerUnit, RUN_OPTION_DEFAULTS.maxSourceDbIdsPerUnit);
    assert.notEqual(SLICED.maxTargetModelsPerUnit, RUN_OPTION_DEFAULTS.maxTargetModelsPerUnit);
    const digests = [];
    const unitCounts = [];
    let reference = null;
    for (const runOptions of INVARIANCE_ARMS) {
      const h = await harness(INVARIANCE_SPEC);
      const resultSet = await h.run(invarianceDef(mode, clearance), runOptions);
      assertCleanFull(resultSet);
      assert.equal(resultSet.provenance.broadPhase, runOptions.broadPhase);
      digests.push(resultSet.digests.pairSetDigest);
      unitCounts.push(resultSet.ledger.units.length);
      reference ??= await bruteForceReference(h.fx, { mode, clearance,
        sources: ownersOf(INVARIANCE_SPEC, 'a').map((d) => ['a', d]), targets: [['b', null], ['c', null], ['d', null]] });
      assert.ok(reference.pairIds.length > 0, 'premise: a non-empty reference');
      assertPairSets(pairKeysOf(resultSet), reference.pairIds, { mode, resultSet, expect: 'exact' });
    }
    assert.equal(new Set(digests).size, 1, 'pairSetDigest must not depend on chunking or broad phase');
    // Premise: the three tlas sizing arms really decompose differently (4 source owners x 3 target
    // models; measured at c1ff642: 1/1 -> 12 units, 2/2 -> 6, defaults -> 3), so the digest equality
    // is not vacuous. Only distinctness is asserted -- the exact counts are the planner's (P3) business.
    assert.equal(new Set(unitCounts.slice(0, 3)).size, 3, `distinct plans per sizing arm: ${unitCounts}`);
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
