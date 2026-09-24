// test/clashtest/integration/realWorldProvenance.test.mjs
//
// Task P7.8 Steps 12-13 (P7.8b-1): the two real-`CollisionWorld` PROVENANCE families.
//   F2 -- mixed reachable/unreachable owner, both orientations (AC-17 b, f)
//   F3 -- diagnostic stress and the un-sliced negative control (AC-18 d)
// What they prove, and what they do not: AC-17 and AC-18 each have a T1 owner (P3/P5) that pins the
// full classification / sizing tables over fakes. These arms prove only that the REAL library raises
// the facts those tables assume (an owner-level result that hides fragment identity; whole-model
// extraction diagnostics proportional to the targets of one call) and that the assembled engine's
// sealed set records them. Every run goes through the engine's DEFAULT executor
// (`createLocalUnitExecutor`) over a real world, directly or via the recording wrapper of the same
// function; no wall clock enters any arm (G-CAL), and `provenance.models[].elementCount` is never read
// (G-EC).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClashTestEngine, getPairStatus } from '../../../clashtest/index.js';
import { RUN_OPTION_DEFAULTS, RUN_OPTION_CEILINGS } from '../../../clashtest/options.js';
import { makePairId, makeElementRef } from '../../../clashtest/identity/ids.js';
import { ledgerDigestInput } from '../../../clashtest/results/resultSet.js';
import { validateResultSet } from '../../../clashtest/results/validateResultSet.js';
import { ENGINE_LIMIT_DEFAULTS } from '../../../clashtest/options.js';
import { digestCanonical } from '../../../clashtest/util/canonical.js';
import { makeRealWorldFixture, recordFindClashes, countWorldLifecycleCalls, createRecordingUnitExecutor } from '../support/realWorld.mjs';
import { pairIdKey } from '../support/bruteForce.mjs';
import { createFakeClock } from '../support/fakeClock.mjs';

// ---- harness -----------------------------------------------------------------------------------

const MODE = 'volume-overlap';
const definitionOf = ({ testId, selectionA, selectionB }) => ({
  schemaVersion: 1, testId, revision: 1, name: testId, mode: MODE,
  selectionA: { entries: selectionA }, selectionB: { entries: selectionB },
});
const model = (modelKey) => ({ kind: 'model', modelKey });
const pairOf = (x, y) => makePairId(MODE, makeElementRef(...x), makeElementRef(...y));
const hasOwner = (pair, modelKey, dbId) => [pair.first, pair.second].some((e) => e.modelKey === modelKey && e.dbId === dbId);
const macrotask = () => new Promise((resolve) => { setImmediate(resolve); });

/**
 * The assembled engine over one fixture, with the Step 8 recorders. `run` returns the sealed set, its
 * runId, the calls this run made and (with `recordOutcomes`) the executor outcomes, and asserts the
 * engine made no call after the seal, never had two calls in flight and never touched the world's
 * lifecycle methods.
 */
function engineOver(fx, { recordOutcomes = false } = {}) {
  const recorder = recordFindClashes(fx.world);
  const lifecycle = countWorldLifecycleCalls(fx.world);
  const clock = createFakeClock({ start: Date.UTC(2026, 8, 24) });
  const executor = recordOutcomes ? createRecordingUnitExecutor(fx, { now: clock.now, yieldToScheduler: clock.yieldToScheduler }) : null;
  const engine = createClashTestEngine({
    world: fx.world, enumerator: fx.enumerator, now: clock.now, yieldToScheduler: clock.yieldToScheduler,
    scheduleTimeout: () => () => {}, ...(executor ? { unitExecutor: executor.unitExecutor } : {}),
  });
  async function run(def, runOptions) {
    const firstCall = recorder.calls.length;
    const firstOutcome = executor?.outcomes.length ?? 0;
    const handle = engine.startRun(def, runOptions);
    const { resultSet } = await handle.done;
    const atSeal = recorder.calls.length;
    for (let i = 0; i < 3; i++) await macrotask();
    assert.equal(recorder.calls.length, atSeal, 'no findClashes call after the terminal seal');
    assert.equal(recorder.peakInFlight, 1, 'peak concurrent in-flight findClashes calls is 1');
    assert.deepEqual({ ...lifecycle }, { evictModel: 0, dispose: 0, invalidateModelPlacement: 0 },
      'the engine calls neither evictModel, dispose nor invalidateModelPlacement');
    return { resultSet, runId: handle.runId, calls: recorder.calls.slice(firstCall, atSeal),
      outcomes: executor ? executor.outcomes.slice(firstOutcome) : null };
  }
  return { engine, run };
}

// ---- Step 12: F2 -- mixed reachable/unreachable owner (AC-17 b, f) ------------------------------

// AC-17's four owner ROLES over model `m`, built entirely from `buildMockModel`'s documented knobs:
//   fragment 0 -- root 200's own fragment                      => 200 is ROOT-ONLY
//   fragment 1 -- nested node 900 under root 100 (reachable)   => 900 is MIXED, together with ...
//   fragment 2 -- loaded, fragList owner 900 (override), in NO root subtree
//   fragment 3 -- fragList owner 950, in no root subtree       => 950 is UNREACHABLE-ONLY
// Why fragIds 0-3 and not the spec's 41/42/43: `buildMockModel`'s whole-model walk enumerates
// 0..fragmentCount-1, and every in-range fragId the tree does not claim is itself a
// `fragment-owner-unresolvable` diagnostic -- a gap from 0 to 41 would inject 40 unrelated
// diagnostics and caveat the arm for the wrong reason. AC-17 fixes the four owner ROLES, not the
// literal fragment numbers.
// Model `x` has one root 700 overlapping fragments 2 and 3 and NOT fragment 1, so `900<->700` is a pair
// only the tree-UNREACHABLE fragment can produce. Unit cubes; positions are centres.
const P = [0, 0, 0];                   // where the overlapping geometry sits
const NEAR = [0.25, 0, 0];             // x:700 -- overlaps anything at P or at NEAR
const FAR = [50, 0, 0];
const FAR2 = [80, 0, 0];
const OFF_AXIS = [0, 5, 0];            // 200's fragment: never overlaps 700

/**
 * @param {object} o
 * @param {boolean} [o.mixed=true]  fragment 2 in no root subtree (900 mixed) vs moved into 900's own
 *   node under root 100 (900 root-only) -- the ONE variable the negative control flips
 * @param {boolean} [o.withUnreachableOnly=true]  keep 950's fragment 3
 * @param {object} [o.at]  positions of fragments 1 and 2
 */
function ownerClassFixture({ mixed = true, withUnreachableOnly = true, at = { 1: FAR, 2: P } } = {}) {
  const positions = { 0: OFF_AXIS, 1: at[1], 2: at[2], ...(withUnreachableOnly ? { 3: NEAR } : {}) };
  const overrides = new Map([...(mixed ? [[2, 900]] : []), ...(withUnreachableOnly ? [[3, 950]] : [])]);
  return makeRealWorldFixture({
    models: {
      m: { tree: [{ dbId: 100, children: [{ dbId: 900, fragments: mixed ? [1] : [1, 2] }] }, { dbId: 200, fragments: [0] }],
           positions },
      x: { 700: [NEAR] },
    },
    fragments: { m: { fragmentCount: withUnreachableOnly ? 4 : 3, ownerDbIdOverrides: overrides } },
  });
}

const ORIENTATIONS = [
  { name: 'm as whole-model SOURCE', mRole: 'source', selectionA: [model('m')], selectionB: [model('x')] },
  { name: 'm as whole-model TARGET', mRole: 'target', selectionA: [model('x')], selectionB: [model('m')] },
];
const PAIR_900 = pairOf(['m', 900], ['x', 700]);
const PAIR_950 = pairOf(['m', 950], ['x', 700]);
const PAIR_200 = pairOf(['m', 200], ['x', 700]);
const resultFor = (resultSet, pair) => resultSet.results.find((r) => pairIdKey(r.pair) === pairIdKey(pair));
const unreachableRowOf = (resultSet, modelKey) => resultSet.ledger.unreachablePopulation.find((u) => u.modelKey === modelKey);

test('mixed-owner orientations over a real CollisionWorld (AC-17 b)', async () => {
  for (const { name, mRole, selectionA, selectionB } of ORIENTATIONS) {
    const fx = await ownerClassFixture();
    const { engine, run } = engineOver(fx);
    const { resultSet, runId, calls } = await run(definitionOf({ testId: `f2-${mRole}`, selectionA, selectionB }));
    assert.equal(resultSet.outcome.status, 'completed', `${name}: ${JSON.stringify(resultSet.outcome)}`);
    assert.equal(resultSet.outcome.coverage, 'full', name);

    // (a) classification, from the sealed ledger: 900 mixed, 950 unreachable-only.
    const row = unreachableRowOf(resultSet, 'm');
    assert.ok(row, `${name}: unreachablePopulation lists m`);
    assert.deepEqual(row.mixedOwnerDbIds, [900], name);
    assert.deepEqual(row.ownerDbIds, [900, 950], name);

    // (b) every pair with 900 on either side -- the required one (m x x has one x owner) and any
    // retained result -- is covered-caveated for mixed-owner provenance: never clean, never not-required.
    const pairs900 = [PAIR_900, ...resultSet.results.map((r) => r.pair).filter((p) => hasOwner(p, 'm', 900))];
    for (const pair of pairs900) {
      const status = getPairStatus(resultSet, pair);
      assert.equal(status.verdict, 'covered-caveated', `${name}: ${pairIdKey(pair)} -> ${JSON.stringify(status)}`);
      assert.ok(status.caveats.some((c) => c.reason === 'mixed-owner-provenance'), `${name}: ${JSON.stringify(status.caveats)}`);
    }
    const r900 = resultFor(resultSet, PAIR_900);
    const r950 = resultFor(resultSet, PAIR_950);
    if (mRole === 'target') {
      // Only the whole-model TARGET extraction (fragList owners) sees fragment 2: the result is
      // retained, not dropped, and flagged.
      assert.ok(r900, `${name}: the 900<->700 result only fragment 2 can produce is retained`);
      assert.equal(r900.flags.mixedOwnerProvenance, true, `${name}: ${JSON.stringify(r900.flags)}`);
      // NOT asserted here, deliberately (T2 rule -- reported, not patched): spec §11.1 defines
      // `flags.unreachableOwner` as "an owner of the pair is unreachable-only", so this MIXED-owner
      // result should not carry it; at HEAD it does (clashtest/run/Run.js builds the accumulator's
      // `unreachableOwners` from the ledger's full `ownerDbIds`, mixed owners included), and P5's
      // own validateResultSet then rejects the sealed set on read-back ('unreachable-flag-invalid').
      // Tracked in docs/handoffs/latest.md (owner items D-A, D-B); standing reproducers: the two
      // `test.todo` arms at the end of the F2 section of this file.
      assert.ok(r950, `${name}: 950's clash is reported`);
      assert.equal(r950.flags.unreachableOwner, true, `${name}: ${JSON.stringify(r950.flags)}`);
    } else {
      // As a SOURCE the library walks the tree only (root 100 -> 900 -> fragment 1, far away), so the
      // pair is ABSENT -- and that absence is exactly what the covered-caveated verdict above withholds
      // as a proven negative. 950 is never a source (sources are tree roots): unevaluated.
      assert.equal(r900, undefined, `${name}: the tree walk cannot see fragment 2`);
      assert.equal(r950, undefined, `${name}: 950 is never evaluated as a source`);
      for (const { query } of calls) {
        if (query.source.model === fx.modelFor('m')) assert.ok(!query.source.dbIds.includes(950), `${name}: 950 was a source`);
      }
    }
    assert.equal(getPairStatus(resultSet, PAIR_950).verdict, 'not-required', name);
    const status200 = getPairStatus(resultSet, PAIR_200);
    assert.equal(status200.verdict, 'covered-clean', `${name}: root-only 200 is unaffected -> ${JSON.stringify(status200)}`);
    // (c) the ENGINE-BOUND claim (P5's standalone predicate is T1-covered).
    assert.equal(await engine.canClaimNoClashes(runId), false, name);
  }
});

test('mixed-owner classification is stable across broad phases and a reordered selection (AC-17 a, T2 half)', async () => {
  const stabilityDef = (selectionA) => definitionOf({ testId: 'f2-stability', selectionA, selectionB: [model('x')] });
  const arms = [
    { name: 'tlas [m, x]', selectionA: [model('m'), model('x')], runOptions: { broadPhase: 'tlas' } },
    { name: 'linear [m, x]', selectionA: [model('m'), model('x')], runOptions: { broadPhase: 'linear' } },
    { name: 'tlas [x, m]', selectionA: [model('x'), model('m')], runOptions: { broadPhase: 'tlas' } },
  ];
  const sets = new Map();
  for (const { name, selectionA, runOptions } of arms) {
    const fx = await ownerClassFixture();
    const { resultSet, calls } = await engineOver(fx).run(stabilityDef(selectionA), runOptions);
    assert.equal(resultSet.outcome.status, 'completed', name);
    for (const { query } of calls) assert.equal(query.broadPhase, runOptions.broadPhase, name);
    assert.deepEqual(unreachableRowOf(resultSet, 'm').mixedOwnerDbIds, [900], name);
    sets.set(name, resultSet);
  }
  // Input order: the whole ledgerDigest is identical.
  assert.equal(sets.get('tlas [x, m]').digests.ledgerDigest, sets.get('tlas [m, x]').digests.ledgerDigest);
  // Broad phase: P5's `ledgerDigestInput` deliberately pins `broadPhase` into the digested sizing
  // options (clashtest/results/resultSet.js SIZING_OPTION_KEYS), so the two ledgerDigests differ BY
  // DESIGN. What must not differ is every ledger FACT: the digest input with `sizingOptions` removed is
  // identical, and `sizingOptions` differs in `broadPhase` alone.
  const [tlas, linear] = ['tlas [m, x]', 'linear [m, x]'].map((name) => {
    const set = sets.get(name);
    return ledgerDigestInput(set.ledger, set.provenance.runOptions);
  });
  const facts = ({ sizingOptions, ...rest }) => digestCanonical(rest);
  assert.equal(facts(linear), facts(tlas), 'the digested ledger facts do not depend on the broad phase');
  assert.deepEqual({ ...linear.sizingOptions, broadPhase: 'tlas' }, tlas.sizingOptions, 'only broadPhase differs');
});

test('negative control: the same fixture with fragment 2 tree-reachable has no mixed-owner caveat (AC-17 b)', async () => {
  // The ONE variable flipped: fragment 2 moves into 900's own node under root 100, so 900 is root-only.
  // Without this arm the mixed-owner test above passes on a build that caveats every pair.
  for (const { name, mRole, selectionA, selectionB } of ORIENTATIONS) {
    const fx = await ownerClassFixture({ mixed: false });
    const { resultSet } = await engineOver(fx).run(definitionOf({ testId: `f2-control-${mRole}`, selectionA, selectionB }));
    assert.equal(resultSet.outcome.status, 'completed', name);
    assert.equal(resultSet.outcome.coverage, 'full', name);
    const row = unreachableRowOf(resultSet, 'm');
    assert.deepEqual(row.mixedOwnerDbIds, [], `${name}: 900 is root-only now`);
    assert.deepEqual(row.ownerDbIds, [950], `${name}: only 950 stays unreachable`);
    assert.ok(resultSet.results.every((r) => r.flags.mixedOwnerProvenance !== true), `${name}: no mixedOwnerProvenance flag anywhere`);
    // Fragment 2 is now tree-reachable, so BOTH orientations produce the 900<->700 clash, clean.
    const r900 = resultFor(resultSet, PAIR_900);
    assert.ok(r900, `${name}: 900<->700 is found through the tree walk too`);
    assert.deepEqual(r900.flags, {}, name);
    const status = getPairStatus(resultSet, PAIR_900);
    assert.equal(status.verdict, 'covered-clean', `${name}: ${JSON.stringify(status)}`);
    assert.equal(getPairStatus(resultSet, PAIR_200).verdict, 'covered-clean', name);
  }
});

test('negative control: the claim is withheld for a mixed owner and allowed once it is root-only (AC-17 b, c)', async () => {
  // Claim-level mirror of the control above. `canClaimNoClashes` also requires EMPTY results and NO
  // unreachable population at all (§8.3), so this pair of fixtures drops 950's fragment and places
  // fragments 1 and 2 away from x:700: both runs find nothing, and they differ ONLY in whether fragment
  // 2 is tree-reachable.
  const at = { 1: FAR, 2: FAR2 };
  const outcomes = {};
  for (const mixed of [true, false]) {
    for (const { mRole, selectionA, selectionB } of ORIENTATIONS) {
      const fx = await ownerClassFixture({ mixed, withUnreachableOnly: false, at });
      const { engine, run } = engineOver(fx);
      const { resultSet, runId } = await run(definitionOf({ testId: `f2-claim-${mixed}-${mRole}`, selectionA, selectionB }));
      assert.equal(resultSet.outcome.status, 'completed');
      assert.equal(resultSet.outcome.coverage, 'full');
      assert.equal(resultSet.outcome.integrity, 'clean');
      assert.deepEqual(resultSet.results, [], 'premise: nothing clashes, so only the owner class can block the claim');
      outcomes[`${mixed ? 'mixed' : 'root-only'}/${mRole}`] = {
        unreachable: resultSet.ledger.unreachablePopulation.map((u) => [u.modelKey, u.mixedOwnerDbIds]),
        claim: await engine.canClaimNoClashes(runId),
      };
    }
  }
  assert.deepEqual(outcomes, {
    'mixed/source': { unreachable: [['m', [900]]], claim: false },
    'mixed/target': { unreachable: [['m', [900]]], claim: false },
    'root-only/source': { unreachable: [], claim: true },
    'root-only/target': { unreachable: [], claim: true },
  });
});

/** A plain, Model-free copy of library pairs (the `model` field is the live Model object). */
const withoutModels = (value) => JSON.parse(JSON.stringify(value, (key, v) => (key === 'model' ? undefined : v)));
const keysDeep = (value, out = new Set()) => {
  if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) { out.add(k); keysDeep(v, out); }
  return out;
};

test('a mixed owner\'s library result is identical whichever of its fragments produced the hit (AC-17 f)', async () => {
  // Two fixtures differing ONLY in which of 900's fragments carries the overlapping geometry: the
  // tree-reachable fragment 1, or the tree-unreachable fragment 2. One direct call each, x:700 against
  // the whole of m -- the direction in which the library can see BOTH fragments (whole-model target
  // extraction reads fragList owners; a source call walks the tree and never visits fragment 2).
  const byFragment = {};
  for (const [label, at] of [['fragment 1 (tree-reachable)', { 1: P, 2: FAR }], ['fragment 2 (tree-unreachable)', { 1: FAR, 2: P }]]) {
    const fx = await ownerClassFixture({ at });
    const { pairs, statistics } = await fx.world.findClashes({
      source: { model: fx.modelFor('x'), dbIds: [700] }, target: { targets: [{ model: fx.modelFor('m') }] },
      mode: MODE, groupBy: 'dbId',
    });
    assert.deepEqual(statistics.diagnostics, [], label);
    assert.ok(pairs.some((p) => p.target.dbId === 900), `premise (${label}): the 700<->900 hit exists`);
    byFragment[label] = withoutModels(pairs);
    // Documentation of the orientation asymmetry the taint exists for: as a SOURCE, 900 reaches only
    // fragment 1 through the tree.
    const asSource = await fx.world.findClashes({ source: { model: fx.modelFor('m'), dbIds: [900] },
      target: { targets: [{ model: fx.modelFor('x') }] }, mode: MODE, groupBy: 'dbId' });
    assert.equal(asSource.pairs.length, at[1] === P ? 1 : 0, `${label}: source-side hits`);
  }
  const [a, b] = Object.values(byFragment);
  // THE assertion: the owner-level record is identical, so no fragment identity is recoverable from it.
  // EXPECTED FAILURE MODE: if this ever fails, the library has started reporting fragment identity.
  // That is a SPEC consequence (§12.5 rule 6's taint could become precise), not a test to loosen.
  assert.deepEqual(a, b);
  for (const key of keysDeep(a)) assert.ok(!/frag/i.test(key), `the pair record carries no fragment key (${key})`);
});

// ---- standing reproducers of two owner-phase defects the real stack surfaced (R-P7-24) ------------
//
// Precedent: the D-8 standing `test.todo` in maximumShape.test.mjs (R-P7-22). Each body FAILS today for
// exactly the stated reason (verified by running it once as a plain `test`), and is kept executable
// so the fix is observable. Tracked in docs/handoffs/latest.md (owner items D-A, D-B). Production code
// is not patched from P7 (Task P7.11's reopen rule). FLIP EACH TO `test()` WHEN THE OWNING PHASE IS FIXED.

/** Seal one run over the fixture, then read the persisted set back after releasing the resident copy. */
async function sealAndReadBack(fx, def) {
  const { engine, run } = engineOver(fx);
  const { resultSet, runId } = await run(def);
  assert.equal(resultSet.outcome.status, 'completed', JSON.stringify(resultSet.outcome));
  engine.releaseResultSet(runId);
  let readBack = null;
  let readError = null;
  try { readBack = await engine.getResultSet(runId); } catch (error) { readError = error; }
  return { resultSet, readBack, readError };
}

// D-A -- owning phase P5: clashtest/results/resultSetSchema.js:206 (closed `UnreachablePopulation` type
// lacks `count`). P3 writes `count` (clashtest/planning/rootResolution.js:234-235), as spec §6.2 requires
// (`{modelKey, count, ownerDbIds, mixedOwnerDbIds, unattributable}`), so every engine-sealed set with a
// non-empty `unreachablePopulation` fails §13.6 read-back ('/ledger/unreachablePopulation/0/count
// unknown-field-closed-type'). Isolated from D-B: 900 is root-only here, so no owner is mixed and the
// only unreachable owner (950) is genuinely unreachable-only.
test('D-A (P5): an engine-sealed set with a non-empty unreachablePopulation validates and reads back (spec §6.2, §13.6)', async () => {
  const fx = await ownerClassFixture({ mixed: false });
  const { selectionA, selectionB } = ORIENTATIONS.find((o) => o.mRole === 'target');
  const { resultSet, readBack, readError } = await sealAndReadBack(fx, definitionOf({ testId: 'd-a', selectionA, selectionB }));
  assert.deepEqual(unreachableRowOf(resultSet, 'm').ownerDbIds, [950], 'premise: a non-empty unreachable population');
  assert.deepEqual(unreachableRowOf(resultSet, 'm').mixedOwnerDbIds, [], 'premise: no mixed owner (D-B out of play)');
  assert.deepEqual(validateResultSet(resultSet, { limits: ENGINE_LIMIT_DEFAULTS }).issues, []);
  assert.equal(readError, null, `read-back rejected: ${readError?.name} ${JSON.stringify(readError?.issues)}`);
  assert.equal(readBack.digests.pairSetDigest, resultSet.digests.pairSetDigest);
  assert.equal(readBack.digests.ledgerDigest, resultSet.digests.ledgerDigest);
});

// D-B -- owning phase P6: clashtest/run/Run.js:355 passes the ledger row's FULL `ownerDbIds` (mixed owners
// included) as the accumulator's `unreachableOwners`, so clashtest/results/resultSet.js:64 flags a MIXED
// owner's result `unreachableOwner`. Spec §11.1 (flags: "`unreachableOwner`: an owner of the pair is
// *unreachable-only*") and §6.2 owner classes; P5's validateResultSet.js:1398 then rejects the set
// ('unreachable-flag-invalid'). Only that issue code is checked here, so D-A cannot mask or fake it.
// Flip to test() when P6 is fixed.
test.todo('D-B (P6): a mixed owner\'s result carries mixedOwnerProvenance but NOT unreachableOwner (spec §11.1, §6.2)', async () => {
  const fx = await ownerClassFixture();
  const { selectionA, selectionB } = ORIENTATIONS.find((o) => o.mRole === 'target');
  const { resultSet } = await sealAndReadBack(fx, definitionOf({ testId: 'd-b', selectionA, selectionB }));
  const r900 = resultFor(resultSet, PAIR_900);
  assert.ok(r900, 'premise: the mixed owner\'s 900<->700 result is retained');
  assert.equal(r900.flags.mixedOwnerProvenance, true, 'premise');
  assert.equal(r900.flags.unreachableOwner, undefined, `a mixed owner is not unreachable-only: ${JSON.stringify(r900.flags)}`);
  const issues = validateResultSet(resultSet, { limits: ENGINE_LIMIT_DEFAULTS }).issues;
  assert.deepEqual(issues.filter((i) => i.code === 'unreachable-flag-invalid'), []);
});

// ---- Step 13: F3 -- diagnostic stress and the un-sliced negative control (AC-18 d) --------------

// One source model `s` (one root, one fragment) and six target models, each built so its whole-model
// extraction emits 800 diagnostics with no geometry cost: root 1 owns fragIds 0..400 of which only 0
// has geometry and 1..400 are not loaded (=> `fragment-not-loaded`), and `fragmentCount: 801` leaves
// 401..800 unclaimed (=> `fragment-owner-unresolvable`). 4,800 diagnostics across the federation, and
// each target model still costs exactly one narrow-phase pair.
const TARGET_KEYS = ['t1', 't2', 't3', 't4', 't5', 't6'];
const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const STRESS_MODELS = { s: { 10: [P] } };
const STRESS_FRAGMENTS = {};
for (const key of TARGET_KEYS) {
  STRESS_MODELS[key] = { tree: [{ dbId: 1, fragments: range(0, 400) }], positions: { 0: NEAR } };
  STRESS_FRAGMENTS[key] = { fragmentCount: 801, notLoadedFragIds: range(1, 400) };
}
const SOURCE_WEIGHT = { 10: 1 };                                  // s:10 owns one fragment
const stressDef = definitionOf({ testId: 'f3-stress', selectionA: [model('s')], selectionB: TARGET_KEYS.map(model) });
// Above each model's own weight (801), so no unit becomes not-run:target-too-large -- that conjunct
// is AC-18(b) and belongs to P3.
const SLICED = { maxTargetModelsPerUnit: 1, maxTargetFragmentsPerUnit: 1_000 };
const AT_CEILINGS = { maxTargetModelsPerUnit: RUN_OPTION_CEILINGS.maxTargetModelsPerUnit,
  maxTargetFragmentsPerUnit: RUN_OPTION_CEILINGS.maxTargetFragmentsPerUnit };

const byScope = (diagnostics) => ({
  fragment: diagnostics.filter((d) => d.scope === 'fragment'),
  other: diagnostics.filter((d) => d.scope !== 'fragment'),
});

async function stressRun(runOptions) {
  const fx = await makeRealWorldFixture({ models: STRESS_MODELS, fragments: STRESS_FRAGMENTS });
  const modelKeyById = new Map([...fx.models].map(([key, m]) => [m.id, key]));
  const out = await engineOver(fx, { recordOutcomes: true }).run(stressDef, runOptions);
  assert.equal(out.resultSet.outcome.status, 'completed', JSON.stringify(out.resultSet.outcome));
  assert.equal(out.resultSet.outcome.coverage, 'full');
  assert.equal(out.resultSet.results.length, TARGET_KEYS.length, 'premise: one clash per target model');
  // Calls and executor outcomes pair up one-to-one, in order: one findClashes per unit, never two in flight.
  assert.equal(out.calls.length, out.outcomes.length);
  out.calls.forEach((call, i) => {
    assert.deepEqual(call.query.target.targets.map((t) => modelKeyById.get(t.model.id)),
      out.outcomes[i].request.materialized.targets.map((t) => t.modelKey), 'call i is unit i');
  });
  return { ...out, fx };
}

test('sliced target fan-out bounds every call\'s diagnostic volume (AC-18 d)', async (t) => {
  const { resultSet, calls, outcomes } = await stressRun(SLICED);
  const maxDiagnosticsPerOutcome = RUN_OPTION_DEFAULTS.maxDiagnosticsPerOutcome;
  assert.ok(resultSet.ledger.units.every((u) => u.outcome === 'evaluated'), 'no unit is not-run:target-too-large');
  const expectedCounts = new Map();
  const dedupKeys = new Set();
  let rawTotal = 0;
  calls.forEach(({ query, statistics }, i) => {
    const { request, outcome } = outcomes[i];
    const unitId = request.unit.unitId;
    // Every call is within the unit caps (the caps are applied BEFORE the first call).
    assert.ok(query.target.targets.length <= SLICED.maxTargetModelsPerUnit, `${unitId}: target models`);
    assert.ok(request.unit.targetWeight <= SLICED.maxTargetFragmentsPerUnit, `${unitId}: target weight ${request.unit.targetWeight}`);
    // Fragment-scoped diagnostics are deduped per fragment per call by the library, so they are bounded
    // by the unit's own (source + target) fragment weight.
    const raw = statistics.diagnostics;
    const { fragment, other } = byScope(raw);
    const sourceWeight = request.materialized.sourceDbIds.reduce((n, d) => n + SOURCE_WEIGHT[d], 0);
    assert.ok(fragment.length > 0, `premise (${unitId}): the storm reached this call`);
    assert.ok(fragment.length <= sourceWeight + request.unit.targetWeight,
      `${unitId}: ${fragment.length} fragment diagnostics > ${sourceWeight} + ${request.unit.targetWeight}`);
    // Any other scope is bounded by the reason vocabulary, not by fan-out (none arise in this fixture).
    assert.ok(other.length <= new Set(other.map((d) => d.reason)).size, `${unitId}: call-scoped diagnostics`);
    // The projection stays inside the per-outcome cap, and nothing was dropped on the way.
    assert.ok(outcome.diagnostics.length <= maxDiagnosticsPerOutcome, `${unitId}: projected count`);
    assert.equal(outcome.diagnosticOverflowLength, undefined, unitId);
    assert.equal(outcome.diagnostics.length, raw.length, `${unitId}: projection is exact`);
    rawTotal += raw.length;
    for (const d of raw) {
      const key = `${d.scope}\u0000${d.reason}`;
      expectedCounts.set(key, (expectedCounts.get(key) ?? 0) + 1);
      // Whole-model target diagnostics carry `dbId: null`, so the run-level dedup key includes the unit.
      dedupKeys.add(JSON.stringify([unitId, d.scope, d.reason, d.fragment?.modelId ?? null, d.fragment?.fragId ?? null]));
    }
    t.diagnostic(`${unitId}: raw ${raw.length} (fragment ${fragment.length}), projected ${outcome.diagnostics.length}, `
      + `weight ${sourceWeight}+${request.unit.targetWeight}`);
  });
  assert.equal(calls.length, TARGET_KEYS.length, 'premise: one unit per target model');
  // The sealed accounting is exact against the recorded raw totals.
  const sealed = resultSet.diagnostics;
  assert.equal(sealed.total, rawTotal);
  assert.deepEqual(new Map(sealed.countsByReason.map((c) => [`${c.scope}\u0000${c.reason}`, c.count])), expectedCounts);
  assert.equal(sealed.omittedReasonOccurrences, 0, 'two distinct reasons, far below maxDistinctReasons');
  assert.equal(sealed.truncated, dedupKeys.size > RUN_OPTION_DEFAULTS.maxRetainedDiagnostics);
  assert.equal(sealed.diagnostics.length, Math.min(dedupKeys.size, RUN_OPTION_DEFAULTS.maxRetainedDiagnostics));
});

test('negative control: one un-sliced call receives the whole federation\'s diagnostic volume (AC-18 d)', async (t) => {
  const sliced = await stressRun(SLICED);
  const slicedCounts = sliced.calls.map(({ statistics }) => byScope(statistics.diagnostics).fragment.length);
  const slicedSum = slicedCounts.reduce((n, c) => n + c, 0);

  // (i) The engine at the CEILINGS. Every target entry here is a whole-model sentinel, which §6.4
  // item 3 places ALONE in a slice whatever the caps ("not partitionable ... it is placed alone in a
  // slice"), so the planner still issues one call per target model: the six-model call the brief's
  // control names cannot be planned by this engine at all. Measured, not assumed.
  const ceilings = await stressRun(AT_CEILINGS);
  assert.equal(ceilings.calls.length, TARGET_KEYS.length);
  assert.ok(ceilings.calls.every(({ query }) => query.target.targets.length === 1), 'a whole-model sentinel is alone in its slice');
  // Changing only the target caps never changes coverage (AC-18 a, T2 half; here the chunking is
  // unchanged too -- differential.test.mjs's target-only AC-4 arms carry the "chunking changes" half).
  assert.equal(ceilings.resultSet.digests.pairSetDigest, sliced.resultSet.digests.pairSetDigest);
  assert.equal(ceilings.resultSet.diagnostics.total, sliced.resultSet.diagnostics.total);

  // (ii) The un-sliced call itself, issued DIRECTLY against a fresh real world -- the call the caps and
  // the sentinel rule prevent the engine from ever making: one source against all six whole models.
  const fx = await makeRealWorldFixture({ models: STRESS_MODELS, fragments: STRESS_FRAGMENTS });
  const { pairs, statistics } = await fx.world.findClashes({
    source: { model: fx.modelFor('s'), dbIds: [10] },
    target: { targets: TARGET_KEYS.map((key) => ({ model: fx.modelFor(key) })) },
    mode: MODE, groupBy: 'dbId',
  });
  assert.equal(pairs.length, TARGET_KEYS.length);
  const unsliced = byScope(statistics.diagnostics).fragment.length;
  t.diagnostic(`un-sliced call: ${unsliced} fragment diagnostics; sliced calls: ${JSON.stringify(slicedCounts)} (sum ${slicedSum})`);
  // Measured against the sliced arm, not against an absolute bound (the spec states none): the one call
  // receives at least the whole federation's volume, i.e. far more than any sliced call.
  assert.ok(unsliced >= slicedSum, `${unsliced} < ${slicedSum}`);
  assert.ok(unsliced > Math.max(...slicedCounts));
});
