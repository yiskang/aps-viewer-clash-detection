// test/clashtest/integration/realWorldEnvironment.test.mjs
//
// Task P7.8 Steps 14-17b (P7.8b-2): the real-`CollisionWorld` ENVIRONMENT families.
//   F1  -- cancellation mid-plan, evaluated-subset comparison (AC-7 tail)
//   F4a -- dirty world: an unrelated direct-caller admission changes only admissionBaseline (AC-19 a)
//   F4b -- geometry readiness: an unavailable render proxy is caveated, never silently missing (AC-19 e)
//   F5  -- model eviction / world disposal mid-run (AC-21)
//   F4c -- equal admissionBaseline, different membership (AC-19 b')
//   F6  -- foreign placement contention over the real world (AC-19 d' at T2)
// What they prove, and what they do not: every one of these ACs has a T1 owner (P3/P4/P5/P6) that pins
// the full table or matrix over fakes. These arms prove only that the REAL library raises the facts
// those tables assume and that the assembled engine's sealed set records them; no arm re-derives a T1
// table. Every run goes through the engine's DEFAULT executor (`createLocalUnitExecutor`) over a real
// world, directly or via the recording wrapper of that same function. No wall clock enters any arm
// (G-CAL): every "mid-call" event is a COUNTED yield of an injected fake clock, and every arm that
// installs such a hook asserts it fired. `provenance.models[].elementCount` is never read (G-EC).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClashTestEngine, getPairStatus, getElementStatus } from '../../../clashtest/index.js';
import { ENGINE_LIMIT_DEFAULTS, RUN_OPTION_DEFAULTS } from '../../../clashtest/options.js';
import { makePairId, makeElementRef } from '../../../clashtest/identity/ids.js';
import { canonicalJson, DIGEST_VERSION } from '../../../clashtest/util/canonical.js';
import { validateResultSet } from '../../../clashtest/results/validateResultSet.js';
import { frameBudgetMs, maxCollisionInstancesPerEpoch } from '../../../collision/constants.js';
import {
  makeRealWorldFixture, recordFindClashes, countWorldLifecycleCalls, createRecordingUnitExecutor,
} from '../support/realWorld.mjs';
import { bruteForceReference, pairIdKey } from '../support/bruteForce.mjs';
import { assertPairSets } from '../support/pairSets.mjs';
import { createFakeClock } from '../support/fakeClock.mjs';

// ---- harness -----------------------------------------------------------------------------------

const MODE = 'volume-overlap';
const definitionOf = ({ testId, selectionA, selectionB }) => ({
  schemaVersion: 1, testId, revision: 1, name: testId, mode: MODE,
  selectionA: { entries: selectionA }, selectionB: { entries: selectionB },
});
const elements = (modelKey, dbIds) => ({ kind: 'elements', modelKey, dbIds: [...dbIds] });   // never a shared array (capture rejects aliasing)
const pairOf = (x, y) => makePairId(MODE, makeElementRef(...x), makeElementRef(...y));
const pairKeysOf = (resultSet) => resultSet.results.map((r) => pairIdKey(r.pair)).sort();
const pairKeysOfUnit = (resultSet, unitId) => resultSet.results
  .filter((r) => r.unitId === unitId).map((r) => pairIdKey(r.pair)).sort();
const unitIdsOf = (resultSet) => resultSet.ledger.units.map((u) => u.unitId);
const unitOf = (resultSet, unitId) => resultSet.ledger.units.find((u) => u.unitId === unitId);
const macrotask = () => new Promise((resolve) => { setImmediate(resolve); });
const settle = async () => { for (let i = 0; i < 3; i++) await macrotask(); };

/** The assembled engine over one fixture (DEFAULT executor unless `unitExecutor` is given), with a
 *  fake ENGINE clock -- distinct from any library clock the fixture injected through `worldOptions`. */
function engineOver(fx, { clock = createFakeClock({ start: Date.UTC(2026, 8, 24) }), unitExecutor } = {}) {
  const engine = createClashTestEngine({
    world: fx.world, enumerator: fx.enumerator, now: clock.now, yieldToScheduler: clock.yieldToScheduler,
    scheduleTimeout: () => () => {}, ...(unitExecutor ? { unitExecutor } : {}),
  });
  return { engine, clock };
}

/** A library clock for `worldOptions` (Step 11's pairing rule): every `now()` read advances a whole
 *  `frameBudgetMs`, so every library checkpoint is due and yields -- a counted event, not a race. */
function libraryClock() {
  const clock = createFakeClock({ tickMs: frameBudgetMs });
  return { clock, worldOptions: { now: clock.now, yieldToScheduler: clock.yieldToScheduler } };
}

// A source model `a` of four owners and a target model `b` of four owners, each `a:N` overlapping
// `b:N` only (a 5-unit stride keeps every other pair apart). With `maxSourceDbIdsPerUnit: 1` the plan
// is exactly four units in canonical order, one per source owner -- the unit count F1 and F5 need.
const OWNERS = [100, 200, 300, 400];
const FOUR_BY_FOUR = {
  a: Object.fromEntries(OWNERS.map((d, i) => [d, [[5 * i, 0, 0]]])),
  b: Object.fromEntries(OWNERS.map((d, i) => [d, [[5 * i + 0.25, 0, 0]]])),
};
const fourByFourDef = (testId) => definitionOf({ testId, selectionA: [elements('a', OWNERS)], selectionB: [elements('b', OWNERS)] });
const ONE_SOURCE_PER_UNIT = { maxSourceDbIdsPerUnit: 1 };

// ---- Step 14: F1 -- cancellation mid-plan (AC-7 tail) ---------------------------------------------

test('a real-world run cancelled mid-plan has an evaluated subset identical to the uncancelled run (AC-7)', async () => {
  const K = 2;                                        // cancel from the 2nd `unit` event
  const def = fourByFourDef('f1');

  // The control: same definition, same options, fresh fixture, never cancelled.
  const controlFx = await makeRealWorldFixture({ models: FOUR_BY_FOUR });
  const control = (await engineOver(controlFx).engine.startRun(def, ONE_SOURCE_PER_UNIT).done).resultSet;
  assert.equal(control.outcome.status, 'completed', JSON.stringify(control.outcome));
  assert.equal(control.outcome.coverage, 'full');
  assert.equal(control.ledger.units.length, OWNERS.length, 'premise: one unit per source owner');

  const fx = await makeRealWorldFixture({ models: FOUR_BY_FOUR });
  const recorder = recordFindClashes(fx.world);
  const { engine } = engineOver(fx);
  const handle = engine.startRun(def, ONE_SOURCE_PER_UNIT);
  let unitEvents = 0;
  let callsAtCancel = null;
  // The public §9 event seam only: no timer, no wall clock.
  handle.subscribe((event) => {
    if (event.type !== 'unit' || ++unitEvents !== K) return;
    callsAtCancel = recorder.calls.length;
    handle.cancel();
  });
  const summary = await handle.done;                 // `done` RESOLVES on a cancel, never rejects
  await settle();
  const { resultSet } = summary;
  assert.notEqual(callsAtCancel, null, 'premise: the cancel hook fired');
  assert.equal(resultSet.outcome.status, 'cancelled');
  assert.equal(resultSet.outcome.coverage, 'partial');
  assert.equal(recorder.calls.length, callsAtCancel, 'no findClashes call after the cancel');

  // Invariant P1: unitId is a pure function of (definition, sorted enumerations, sizing options) --
  // identical here -- so ids are comparable across the two runs. Pinned FIRST, so a plan-determinism
  // regression fails loudly instead of making the comparison below vacuous.
  assert.deepEqual(unitIdsOf(resultSet), unitIdsOf(control), 'the two plans agree on unit ids');

  const evaluated = resultSet.ledger.units.filter((u) => u.outcome === 'evaluated');
  const unstarted = resultSet.ledger.units.filter((u) => u.outcome === 'not-run');
  // Negative control (mandatory): a NON-EMPTY STRICT subset, so the cancel neither landed before any
  // unit (nothing compared) nor after all of them (no cancellation exercised).
  assert.ok(evaluated.length > 0 && evaluated.length < control.ledger.units.length,
    `evaluated ${evaluated.length} of ${control.ledger.units.length}`);
  assert.ok(unstarted.length >= 2, `premise: at least two units were still unstarted (${unstarted.length})`);
  for (const u of unstarted) assert.equal(u.cause, 'cancelled', `${u.unitId} is not-run:cancelled`);
  assert.equal(evaluated.length + unstarted.length, resultSet.ledger.units.length, 'no other outcome');

  // The AC's content: every evaluated unit's pair set equals the same unit's pair set uncancelled.
  for (const u of evaluated) {
    assert.deepEqual(pairKeysOfUnit(resultSet, u.unitId), pairKeysOfUnit(control, u.unitId), u.unitId);
    assert.ok(pairKeysOfUnit(control, u.unitId).length > 0, `premise: ${u.unitId} has pairs to compare`);
  }
});

// D-D -- owning phase P6 (FIXED; this is its regression). The planner's last cancellation check
// (`enumerationCheckpoint`) runs BEFORE its slicer tick yields at `plan:built`
// (clashtest/planning/planner.js), and `commitPlanned` then writes the plan's unit records into the
// ledger. A cancel landing during that final yield is first seen by `planStage` AFTER `planRun`
// resolved `planned`; before the fix its `settlePlanning` sealed the ALREADY-COMMITTED ledger: unit
// records with `outcome: null`, and no provenance model rows (`run.plan` was never adopted), which
// failed `validateResultSet` (`/ledger/units/N/outcome null-not-allowed`, `/provenance/models
// model-not-in-provenance`) -- so a STORED read-back rejected `CorruptResultSetError`. That violated
// R21-2 ("an engine never produces a set it cannot read") and AC-7 ("a cancel during enumeration
// seals with planning gap `cancelled` and no unit ledger"). Surfaced while calibrating this file's
// F5 (ii) planning-slice hook (P7.8b-2). The whole timing class (a cancel at EVERY planning yield) is
// pinned at T1 in test/clashtest/run/lifecycle.test.mjs (D-D).
test('D-D (P6): a cancel landing in the final planning slice seals a valid set with no unit ledger (AC-7, R21-2)', async () => {
  const def = fourByFourDef('d-d');
  // Calibrate: the engine yields this many times before its first executor call, on this fixture.
  const planningYields = async (cancelAtYield) => {
    const fx = await makeRealWorldFixture({ models: FOUR_BY_FOUR });
    const clock = createFakeClock({ start: Date.UTC(2026, 8, 24), tickMs: ENGINE_LIMIT_DEFAULTS.sliceBudgetMs });
    const inner = createRecordingUnitExecutor(fx, { now: clock.now, yieldToScheduler: clock.yieldToScheduler });
    const box = { handle: null, yieldsBeforeFirstUnit: null };
    const unitExecutor = (request) => { box.yieldsBeforeFirstUnit ??= clock.yieldCount; return inner.unitExecutor(request); };
    clock.onYield((n) => { if (n === cancelAtYield) box.handle.cancel(); });
    const { engine } = engineOver(fx, { clock, unitExecutor });
    box.handle = engine.startRun(def, ONE_SOURCE_PER_UNIT);
    const { resultSet } = await box.handle.done;
    return { resultSet, yieldsBeforeFirstUnit: box.yieldsBeforeFirstUnit, clock };
  };
  const calibration = await planningYields(null);
  const lastPlanningYield = calibration.yieldsBeforeFirstUnit;
  assert.ok(lastPlanningYield > 0, 'premise: planning yields at least once');
  const { resultSet, clock } = await planningYields(lastPlanningYield);
  assert.ok(clock.yieldCount >= lastPlanningYield, 'premise: the cancel hook fired');
  assert.equal(resultSet.outcome.status, 'cancelled');
  assert.deepEqual(resultSet.ledger.planningGaps.map((g) => g.cause), ['cancelled']);
  assert.deepEqual(validateResultSet(resultSet, { limits: ENGINE_LIMIT_DEFAULTS }).issues, [],
    'the engine sealed a set it cannot read back');
  assert.deepEqual(resultSet.ledger.units, [], 'AC-7: a cancel during enumeration leaves no unit ledger');
});

// ---- Step 15: F4a -- the dirty world (AC-19 a) ---------------------------------------------------

// The definition covers owners 100/200 of `a` and `b`; the priming call uses owner 300 of each --
// genuinely UNRELATED (different source, different targets) yet admitted into the SAME touched epochs.
const DIRTY_MODELS = {
  a: { 100: [[0, 0, 0]], 200: [[5, 0, 0]], 300: [[30, 0, 0]] },
  b: { 100: [[0.25, 0, 0]], 200: [[5.25, 0, 0]], 300: [[30.25, 0, 0], [30.5, 0, 0]] },
};
const dirtyDef = () => definitionOf({ testId: 'f4a', selectionA: [elements('a', [100, 200])], selectionB: [elements('b', [100, 200])] });

test('dirty world: an unrelated direct-caller admission changes only admissionBaseline (AC-19 a)', async () => {
  const runOn = async (prime) => {
    const fx = await makeRealWorldFixture({ models: DIRTY_MODELS });
    let priming = null;
    if (prime) {
      // §1.3.5: another caller pre-populated the epoch buckets -- a plain DIRECT world call.
      priming = await fx.world.findClashes({
        source: { model: fx.modelFor('a'), dbIds: [300] }, target: { targets: [{ model: fx.modelFor('b'), dbIds: [300] }] },
        mode: MODE, groupBy: 'dbId',
      });
    }
    const { resultSet } = await engineOver(fx).engine.startRun(dirtyDef()).done;
    const reference = await bruteForceReference(fx, { mode: MODE, sources: [['a', 100], ['a', 200]], targets: [['b', [100, 200]]] });
    return { resultSet, reference, priming };
  };
  const fresh = await runOn(false);
  const primed = await runOn(true);

  // Negative control: the priming call genuinely ran and admitted something.
  assert.ok(primed.priming.pairs.length > 0, 'premise: the priming call ran (and found its own unrelated pair)');
  const baseline = (set) => new Map(set.provenance.admissionBaseline.map((b) => [b.modelKey, b.epochInstanceCount]));
  for (const modelKey of ['a', 'b']) {
    assert.ok(baseline(primed.resultSet).get(modelKey) > baseline(fresh.resultSet).get(modelKey),
      `${modelKey}: the primed run's epochInstanceCount is strictly greater `
      + `(${JSON.stringify(primed.resultSet.provenance.admissionBaseline)} vs ${JSON.stringify(fresh.resultSet.provenance.admissionBaseline)})`);
  }
  for (const { resultSet, reference } of [fresh, primed]) {
    assert.equal(resultSet.outcome.status, 'completed');
    assert.equal(resultSet.outcome.coverage, 'full');
    assert.equal(resultSet.outcome.integrity, 'clean');
    assert.equal(resultSet.outcome.environmentSensitive, false);
    // Capacity pressure is deliberately absent, so this arm cannot silently become the (b) arm.
    assert.ok(resultSet.ledger.units.every((u) => u.cause !== 'capacity-exceeded'));
    assert.ok(reference.pairIds.length > 0, 'premise: a non-empty reference');
    assertPairSets(pairKeysOf(resultSet), reference.pairIds, { mode: MODE, resultSet, expect: 'exact' });
  }
  // §13.1: admissionBaseline contributes to NEITHER digest. A difference here is epoch-cache state
  // leaking into a digested field -- the H3 defect AC-19 was written for.
  assert.equal(primed.resultSet.digests.pairSetDigest, fresh.resultSet.digests.pairSetDigest);
  assert.equal(primed.resultSet.digests.ledgerDigest, fresh.resultSet.digests.ledgerDigest);
});

// ---- Step 16: F4b -- geometry readiness (AC-19 e) --------------------------------------------------

// Map form: `b`'s fragIds are 0 (owner 100) and 1 (owner 200), each with its OWN geometryIndex (the
// library's geometry registry is keyed by (loadEpoch, geometryIndex); a shared index would let a
// sibling's successful entry mask the miss). The gated fragment is b:100's fragId 0.
const READINESS_MODELS = {
  a: { 100: [[0, 0, 0]], 200: [[5, 0, 0]] },
  b: { 100: [[0.25, 0, 0]], 200: [[5.25, 0, 0]] },
};
const GATED = { modelKey: 'b', fragId: 0, dbId: 100 };
const GATED_PAIR = pairOf(['a', 100], ['b', 100]);
const readinessDef = () => definitionOf({ testId: 'f4b', selectionA: [elements('a', [100, 200])], selectionB: [elements('b', [100, 200])] });
const READINESS_REFERENCE_ARGS = { mode: MODE, sources: [['a', 100], ['a', 200]], targets: [['b', [100, 200]]] };
const scopeDigestsOf = (set) => set.provenance.models.map((m) => [m.modelKey, m.scopeDigests]);   // never elementCount (G-EC)

test('geometry readiness: an unavailable render proxy is caveated, never silently missing (AC-19 e)', async () => {
  // The reference comes from a SEPARATE clean fixture (gate open): one computed in the gated world
  // would miss the same pair, and the comparison would be circular.
  const cleanFx = await makeRealWorldFixture({ models: READINESS_MODELS });
  const reference = await bruteForceReference(cleanFx, READINESS_REFERENCE_ARGS);
  assert.ok(reference.pairIds.includes(pairIdKey(GATED_PAIR)), 'premise: the reference has the gated pair');

  // GATED FIRST (review M-5: once a fragment's BVH has settled, closing its gate has no effect).
  const fx = await makeRealWorldFixture({
    models: READINESS_MODELS,
    renderProxy: (modelKey, fragId) => !(modelKey === GATED.modelKey && fragId === GATED.fragId),
  });
  const { engine } = engineOver(fx);
  const h1 = engine.startRun(readinessDef());
  const run1 = (await h1.done).resultSet;

  assert.ok(run1.diagnostics.geometryReadinessOccurrences >= 1);
  const readiness = run1.diagnostics.diagnostics.filter((d) => d.reason === 'geometry-not-yet-available');
  assert.ok(readiness.some((d) => d.fragment?.modelKey === GATED.modelKey && d.fragment?.fragId === GATED.fragId
    && d.fragment?.dbId === GATED.dbId), `a diagnostic names the gated fragment: ${JSON.stringify(readiness)}`);
  assert.ok(run1.outcome.environmentSensitiveCauses.includes('geometry-readiness'));
  assert.equal(run1.outcome.environmentSensitive, true);
  assert.equal(run1.outcome.integrity, 'caveated');
  const element = getElementStatus(run1, makeElementRef(GATED.modelKey, GATED.dbId));
  assert.equal(element.coverage, 'full', JSON.stringify(element));
  assert.ok(element.caveats.some((c) => c.reason === 'geometry-not-yet-available'), JSON.stringify(element));
  assert.equal(getPairStatus(run1, GATED_PAIR).verdict, 'covered-caveated');
  assert.equal(await engine.canClaimNoClashes(h1.runId), false);
  // The uncomfortable truth the spec insists on (§16.4, §1.3.6): `current` means no scope input changed
  // -- NOT that a rerun would match. Run 2 below, on the unchanged model, finds one more pair.
  assert.equal((await engine.getFreshness(h1.runId)).state, 'current');
  // The M2 oracle's 'correlated' branch: every differing pair is caveated for THIS reason ...
  assertPairSets(pairKeysOf(run1), reference.pairIds,
    { mode: MODE, resultSet: run1, expect: 'correlated', caveatReasons: ['geometry-not-yet-available'] });
  // ... and the difference is EXACTLY the gated fragment's pair, so a build that drops unrelated pairs
  // fails here instead of being absorbed by the caveat.
  const symmetricDifference = [
    ...pairKeysOf(run1).filter((k) => !reference.pairIds.includes(k)),
    ...reference.pairIds.filter((k) => !pairKeysOf(run1).includes(k)),
  ];
  assert.deepEqual(symmetricDifference, [pairIdKey(GATED_PAIR)]);

  // Run 2: gate open, SAME world. Nothing about the model changed, so every scope digest is identical;
  // that the run succeeds here is the assertion that the transient path settled no persistent state
  // (collision/errors.js: RenderProxyUnavailableError "must settle NO persistent GeometryRegistry state").
  fx.setRenderProxyAvailable(GATED.modelKey, GATED.fragId, true);
  const run2 = (await engine.startRun(readinessDef()).done).resultSet;
  assert.deepEqual(scopeDigestsOf(run2), scopeDigestsOf(run1), 'no scope check could have predicted the caveat');
  assert.ok(pairKeysOf(run2).includes(pairIdKey(GATED_PAIR)), 'run 2 finds the pair');
  assert.equal(run2.outcome.environmentSensitiveCauses.includes('geometry-readiness'), false);
  assert.equal(run2.outcome.integrity, 'clean');
  assertPairSets(pairKeysOf(run2), reference.pairIds, { mode: MODE, resultSet: run2, expect: 'exact' });

  // Negative control (mandatory): gate open from the start.
  const openFx = await makeRealWorldFixture({ models: READINESS_MODELS });
  const { engine: openEngine } = engineOver(openFx);
  const h3 = openEngine.startRun(readinessDef());
  const run3 = (await h3.done).resultSet;
  assert.equal(run3.diagnostics.geometryReadinessOccurrences, 0);
  assert.deepEqual(run3.outcome.environmentSensitiveCauses, []);
  assert.equal(run3.outcome.integrity, 'clean');
  assert.equal(getPairStatus(run3, GATED_PAIR).verdict, 'covered-clean');
  assertPairSets(pairKeysOf(run3), reference.pairIds, { mode: MODE, resultSet: run3, expect: 'exact' });
  // The brief's `canClaimNoClashes === true` conjunct cannot hold on THIS fixture: run 3 retains the
  // a:100<->b:100 clash, and a clash blocks the claim (§8.3 `noResults`, R19-2). It is asserted by the
  // claim-level control test below instead (a one-variable gate flip over a fixture with no clash).
  assert.ok(run3.results.length > 0);
  // The comparison surface is P8's: AC-19(e)'s `compareResultSets` conjunct is deferred -> P8.
  assert.equal(engine.compareResultSets, undefined);
});

// The claim half of F4b's negative control (reported deviation: split out, like F2's control (ii)),
// because the brief's run 3 reuses a CLASHING fixture on which the claim can never be true. A gated
// fragment that is narrow-phased yet yields NO clash when its proxy is available: `clearance` mode
// over two OVERLAPPING cubes (an overlap is not a clearance pair -- measured: 0 pairs, 0 diagnostics
// with the gate open; `geometry-not-yet-available` with it closed). The two runs differ ONLY in the
// gate, and every §8.3 claim conjunct (clashtest/results/claim.js) other than `clean` is asserted to
// hold in BOTH, so the gated run's false claim is shown to be BECAUSE of readiness.
test('geometry readiness, claim control: the gate alone decides canClaimNoClashes on a no-clash fixture (AC-19 e)', async () => {
  const models = { a: { 100: [[0, 0, 0]] }, b: { 100: [[0.25, 0, 0]] } };
  const def = { ...definitionOf({ testId: 'f4b-claim', selectionA: [elements('a', [100])], selectionB: [elements('b', [100])] }),
    mode: 'clearance', clearance: 0.05 };
  const claimRun = async (gated) => {
    const fx = await makeRealWorldFixture({ models, renderProxy: (modelKey) => !(gated && modelKey === 'b') });
    const { engine } = engineOver(fx);
    const handle = engine.startRun(def);
    const { resultSet } = await handle.done;
    return { resultSet, claim: await engine.canClaimNoClashes(handle.runId), freshness: (await engine.getFreshness(handle.runId)).state };
  };
  const gated = await claimRun(true);
  const open = await claimRun(false);
  // Every §8.3 conjunct EXCEPT `clean` holds in both runs (claim.js:51-63), so `clean` -- driven here by
  // the readiness diagnostic alone -- is the only one that can decide the claim.
  for (const [name, { resultSet, freshness }] of [['gated', gated], ['open', open]]) {
    const { outcome, ledger, provenance } = resultSet;
    assert.equal(outcome.status, 'completed', name);
    assert.equal(outcome.coverage, 'full', name);
    assert.equal(freshness, 'current', name);
    assert.equal(resultSet.digests.digestVersion, DIGEST_VERSION, name);
    assert.ok(ledger.pairSpaceTotal > 0, name);
    assert.equal(ledger.emptyOperand, false, name);
    assert.deepEqual(ledger.unresolvedSelections, [], name);
    assert.deepEqual(ledger.unreachablePopulation, [], name);
    assert.deepEqual(ledger.hierarchyInternal, [], name);
    assert.equal(provenance.hierarchyInternalAcceptance, null, name);
    assert.deepEqual(resultSet.results, [], `${name}: no clash either way`);
  }
  // Gated: the pair was narrow-phased and its proxy was unavailable -> caveated -> no claim.
  assert.ok(gated.resultSet.diagnostics.geometryReadinessOccurrences >= 1, 'premise: the pair was narrow-phased and gated');
  assert.ok(gated.resultSet.outcome.environmentSensitiveCauses.includes('geometry-readiness'));
  assert.equal(gated.resultSet.outcome.integrity, 'caveated', 'the ONE failing conjunct, from readiness alone');
  assert.equal(gated.claim, false, 'a readiness-caveated empty result is never a no-clash claim');
  // Open: nothing caveats it -> the claim is allowed. A build whose claim is always false fails here.
  assert.equal(open.resultSet.diagnostics.geometryReadinessOccurrences, 0);
  assert.deepEqual(open.resultSet.outcome.environmentSensitiveCauses, []);
  assert.equal(open.resultSet.outcome.integrity, 'clean');
  assert.equal(open.claim, true);
});

// ---- Step 17: F5 -- model eviction and world disposal mid-run (AC-21) -----------------------------

/**
 * FOUR_BY_FOUR over a counted library clock, with the Step 8 recorder and lifecycle counters. `onCall`
 * fires `action(fx)` on the FIRST library yield inside the `callIndex`-th (1-based) engine
 * `findClashes` call -- a genuinely MID-CALL event, not a between-units one.
 */
async function midCallFixture({ callIndex, action }) {
  const { clock, worldOptions } = libraryClock();
  const fx = await makeRealWorldFixture({ models: FOUR_BY_FOUR, worldOptions });
  const recorder = recordFindClashes(fx.world);
  const lifecycle = countWorldLifecycleCalls(fx.world);
  const hook = { firedAtYield: null, callsAtFire: null };
  clock.onYield((n) => {
    if (action === null || hook.firedAtYield !== null) return;
    if (recorder.inFlight !== 1 || recorder.calls.length !== callIndex) return;
    hook.firedAtYield = n;
    hook.callsAtFire = recorder.calls.length;
    action(fx);
  });
  return { fx, recorder, lifecycle, hook, clock };
}

/** The unit whose call was in flight when the hook fired. `units[callsAtFire - 1]` is that unit only
 *  while every earlier unit made exactly ONE call (no retry); pinned here, call by call, rather than
 *  assumed (review M-3): with one source owner per unit, call i's source is unit i's source root. */
function unitInFlightAtFire(resultSet, { recorder, hook }) {
  for (let i = 0; i < hook.callsAtFire; i++) {
    assert.deepEqual(recorder.calls[i].query.source.dbIds, resultSet.ledger.units[i].sourceRootDbIds,
      `call ${i + 1} belongs to unit ${resultSet.ledger.units[i].unitId}`);
  }
  return resultSet.ledger.units[hook.callsAtFire - 1];
}

test('model eviction mid-run settles the unit model-evicted and the engine never evicts or disposes (AC-21)', async () => {
  const def = fourByFourDef('f5-evict');
  const quiet = await midCallFixture({ callIndex: 2, action: null });
  const quietSet = (await engineOver(quiet.fx).engine.startRun(def, ONE_SOURCE_PER_UNIT).done).resultSet;
  assert.equal(quietSet.outcome.status, 'completed');
  assert.equal(quietSet.outcome.coverage, 'full');

  const m = await midCallFixture({ callIndex: 2, action: (fx) => fx.world.evictModel(fx.modelFor('b')) });
  const { engine } = engineOver(m.fx);
  const handle = engine.startRun(def, ONE_SOURCE_PER_UNIT);
  const { resultSet } = await handle.done;
  await settle();
  assert.notEqual(m.hook.firedAtYield, null, 'premise: the counted yield hook fired (mid-call eviction)');
  assert.ok(m.clock.yieldCount > 0);

  assert.deepEqual(unitIdsOf(resultSet), unitIdsOf(quietSet), 'invariant P1: the plans agree on unit ids');
  const affected = unitInFlightAtFire(resultSet, m);
  // Table A row U6 (the matrix's prediction for this row): `failed:model-evicted` for the in-flight unit.
  assert.equal(affected.outcome, 'failed', JSON.stringify(affected));
  assert.equal(affected.cause, 'model-evicted');
  assert.equal(m.recorder.calls[m.hook.callsAtFire - 1].error?.name, 'ModelEvictedError', 'the REAL world raised it');
  // Every other observed fact is kept as a secondary cause. The matrix's prediction for this row: the
  // eviction also left the post-check scope digest uncomputable (U7), recorded as secondary (review M-1).
  assert.deepEqual(affected.secondaryCauses, ['scope-unverifiable']);
  // And each `unit:*` reason of the run is some unit's primary cause or one of those secondary causes.
  const primaries = new Set(resultSet.ledger.units.map((u) => u.cause).filter((c) => c !== null));
  for (const reason of resultSet.outcome.reasons.filter((r) => r.startsWith('unit:'))) {
    const fact = reason.slice('unit:'.length);
    assert.ok(primaries.has(fact) || affected.secondaryCauses.includes(fact),
      `${reason} is neither a primary cause nor in ${JSON.stringify(affected.secondaryCauses)}`);
  }
  // Order B: U6 is neither F (U1-U3) nor I (U4/U5) and no cancel is pending => `completed`; the
  // binding death is a gap + `stale` (§16.3.1), never `invalidated`.
  assert.equal(resultSet.outcome.status, 'completed', JSON.stringify(resultSet.outcome));
  assert.equal(resultSet.outcome.coverage, 'partial');
  assert.equal(resultSet.outcome.freshness, 'stale');
  assert.equal(await engine.canClaimNoClashes(handle.runId), false);

  // Every unit evaluated in BOTH runs has identical pairs.
  const bothEvaluated = resultSet.ledger.units.filter((u) => u.outcome === 'evaluated'
    && unitOf(quietSet, u.unitId).outcome === 'evaluated');
  assert.ok(bothEvaluated.length > 0, 'premise: something to compare');
  for (const u of bothEvaluated) assert.deepEqual(pairKeysOfUnit(resultSet, u.unitId), pairKeysOfUnit(quietSet, u.unitId), u.unitId);

  // Conformance (AC-7 "never calls evict/dispose/invalidate", against the REAL world): the recorded
  // lifecycle calls are exactly the test's own one eviction.
  assert.deepEqual({ ...m.lifecycle }, { evictModel: 1, dispose: 0, invalidateModelPlacement: 0 });
  assert.equal(m.recorder.peakInFlight, 1);
});

test('world disposal mid-run seals failed, and the engine makes no further library call (AC-21 (i))', async () => {
  const def = fourByFourDef('f5-dispose');
  const d = await midCallFixture({ callIndex: 2, action: (fx) => fx.world.dispose() });
  const { engine } = engineOver(d.fx);
  const summary = await engine.startRun(def, ONE_SOURCE_PER_UNIT).done;   // resolves, never rejects
  await settle();
  assert.notEqual(d.hook.firedAtYield, null, 'premise: the counted yield hook fired (mid-call disposal)');
  const { resultSet } = summary;
  assert.equal(summary.status, 'failed', 'done resolves WITH the failed summary');
  const affected = unitInFlightAtFire(resultSet, d);
  assert.equal(affected.outcome, 'failed', JSON.stringify(affected));
  assert.equal(affected.cause, 'world-disposed');
  assert.equal(d.recorder.calls[d.hook.callsAtFire - 1].error?.name, 'WorldDisposedError', 'the REAL world raised it');
  assert.equal(resultSet.outcome.status, 'failed');
  assert.ok(resultSet.outcome.reasons.includes('unit:world-disposed'), JSON.stringify(resultSet.outcome.reasons));
  assert.equal(d.recorder.calls.length, d.hook.callsAtFire, 'no findClashes call after the disposal');
  assert.deepEqual({ ...d.lifecycle }, { evictModel: 0, dispose: 1, invalidateModelPlacement: 0 },
    'the only lifecycle call is the test\'s own disposal');
});

// D-C -- owning phase P6 (FIXED; this is its regression). Owner ruling 2026-09-24: PRESERVE AC-21 (ii)
// ("world disposal ... together with a cancel seals `failed`, not `cancelled`") and fix P6. The
// CollisionWorld surface has no disposal query -- disposal is observable only as a WorldDisposedError
// thrown by a world call (collision/CollisionWorld.js) -- and during planning (with an
// `ElementEnumerator` that does not call the world, as the test-local one and the P2 contract allow)
// the only world call, `getEpochCollisionInstanceCount` for the admission baseline, precedes
// enumeration; so before the fix a cancel + dispose inside a planning slice sealed `cancelled` with no
// `world-disposed` anywhere. P6 now probes the world with that same read-only call when planning
// observes a cancel, and a WorldDisposedError settles the planning gap `world-disposed` (§16.7 B rule
// 1: failed > cancelled; T1: test/clashtest/run/lifecycle.test.mjs D-C).
test('D-C (P6): world disposal with a cancel pending inside a planning slice seals failed, not cancelled (AC-21 (ii))', async () => {
  const fx = await makeRealWorldFixture({ models: FOUR_BY_FOUR });
  const recorder = recordFindClashes(fx.world);
  // The ENGINE's own {now, yieldToScheduler}, paired (P0's slicer yields on its own frame budget, so
  // the engine clock advances a whole slice per read). A mutable box: the hook is supplied at
  // construction, while `handle` does not exist yet.
  const clock = createFakeClock({ start: Date.UTC(2026, 8, 24), tickMs: ENGINE_LIMIT_DEFAULTS.sliceBudgetMs });
  const inner = createRecordingUnitExecutor(fx, { now: clock.now, yieldToScheduler: clock.yieldToScheduler });
  const box = { handle: null, firedAtYield: null, executorStarted: false };
  const unitExecutor = (request) => { box.executorStarted = true; return inner.unitExecutor(request); };
  // The first engine yield before any unit executes is a planning slice (enumeration/planning).
  clock.onYield((n) => {
    if (box.firedAtYield !== null || box.executorStarted || box.handle === null) return;
    box.firedAtYield = n;
    box.handle.cancel();
    fx.world.dispose();
  });
  const { engine } = engineOver(fx, { clock, unitExecutor });
  box.handle = engine.startRun(fourByFourDef('d-c'), ONE_SOURCE_PER_UNIT);
  const { resultSet } = await box.handle.done;
  assert.notEqual(box.firedAtYield, null, 'premise: the hook fired inside a planning slice');
  assert.equal(recorder.calls.length, 0, 'premise: no unit reached the library');
  assert.ok(resultSet.outcome.reasons.includes('cancel-requested'), JSON.stringify(resultSet.outcome.reasons));
  // "Seals failed" is only meaningful against the outcome it outranks: the cancelled shape is absent.
  assert.notEqual(resultSet.outcome.status, 'cancelled', `sealed cancelled: ${JSON.stringify(resultSet.outcome)}`);
  assert.equal(resultSet.outcome.status, 'failed');
  assert.ok(resultSet.outcome.reasons.includes('planning:world-disposed'), JSON.stringify(resultSet.outcome.reasons));
  assert.deepEqual(resultSet.ledger.planningGaps.map((g) => g.cause), ['world-disposed']);
  assert.deepEqual(resultSet.ledger.units, [], 'planning abandoned: no unit ledger');
  assert.deepEqual(validateResultSet(resultSet, { limits: ENGINE_LIMIT_DEFAULTS }).issues, []);
});

// ---- Step 17a: F4c -- equal admissionBaseline, different membership (AC-19 b') --------------------

// One model layout for all three worlds. `b`: the unit's own owner 200 (20 fragments overlapping
// a:100), twenty filler owners 901-920 of 999 far-away fragments each (19,980), and a spare far-away
// owner 921 of 20. `a`: owner 100 (the source) and a far-away owner 300 used only for priming. Every
// filler/spare fragment is far from every priming source box, so each priming call forms ZERO
// candidate pairs and builds no geometry-registry entry and no BVH: the bucket is filled by
// EXTRACTION alone. Each filler owner stays under maxFragmentsPerDbId (5,000).
const UNIT_FRAGMENTS = 20;
const FILLER_OWNERS = Array.from({ length: 20 }, (_, i) => 901 + i);
const FILLER_FRAGMENTS = 999;
const SPARE_OWNER = 921;
const FAR_AWAY = [5000, 0, 0];
const CAPACITY_MODELS = {
  a: { 100: [[0, 0, 0]], 300: [[-5000, 0, 0]] },
  b: {
    200: Array.from({ length: UNIT_FRAGMENTS }, (_, i) => [0.25 + 0.01 * i, 0, 0]),
    ...Object.fromEntries(FILLER_OWNERS.map((d) => [d, Array.from({ length: FILLER_FRAGMENTS }, () => FAR_AWAY)])),
    [SPARE_OWNER]: Array.from({ length: UNIT_FRAGMENTS }, () => FAR_AWAY),
  },
};
// Explicit dbIds on both sides (never kind:'model'): every scope digest covers only a:100 and b:200,
// identical in all three worlds.
const capacityDef = () => definitionOf({ testId: 'f4c', selectionA: [elements('a', [100])], selectionB: [elements('b', [200])] });
// 'linear' deliberately: a cached TLAS would rebuild over the whole epoch's 20,000 primed records for
// nothing, and admission happens BEFORE the broad phase either way (all three runs use the same option).
const CAPACITY_OPTIONS = { broadPhase: 'linear', maxSourceDbIdsPerUnit: 1 };

test('equal admissionBaseline, different membership: the flag follows the outcome, not the baseline (AC-19 b\')', async () => {
  assert.equal(FILLER_OWNERS.length * FILLER_FRAGMENTS + UNIT_FRAGMENTS, maxCollisionInstancesPerEpoch,
    'premise: filler + one 20-id priming call fill the bucket exactly to the library ceiling');
  // The unit's target weight fits the default caps, so the definition is exactly ONE unit.
  assert.ok(UNIT_FRAGMENTS <= RUN_OPTION_DEFAULTS.maxTargetFragmentsPerUnit && RUN_OPTION_DEFAULTS.maxTargetModelsPerUnit >= 1);

  const runIn = async (secondPrimingOwner) => {
    const fx = await makeRealWorldFixture({ models: CAPACITY_MODELS });
    const epochOf = (modelKey) => fx.registry.bindingFor(modelKey).lease.epoch;
    const prime = (dbIds) => fx.world.findClashes({
      source: { model: fx.modelFor('a'), dbIds: [300] }, target: { targets: [{ model: fx.modelFor('b'), dbIds }] },
      mode: MODE, groupBy: 'dbId', broadPhase: 'linear',
    });
    if (secondPrimingOwner !== null) {
      for (const priming of [await prime(FILLER_OWNERS), await prime([secondPrimingOwner])]) {
        assert.deepEqual(priming.pairs, [], 'premise: a priming call forms no pair');
        assert.deepEqual(priming.statistics.diagnostics, [], 'premise: a clean priming call');
      }
    }
    // Pinned BEFORE startRun, so a fixture that drifted off the ceiling fails as a fixture bug instead
    // of silently becoming F4a.
    const bucket = fx.world.getEpochCollisionInstanceCount(epochOf('b'));
    assert.equal(bucket, secondPrimingOwner === null ? 0 : maxCollisionInstancesPerEpoch, 'b\'s epoch bucket before the run');
    const clock = createFakeClock({ start: Date.UTC(2026, 8, 24) });
    const recording = createRecordingUnitExecutor(fx, { now: clock.now, yieldToScheduler: clock.yieldToScheduler });
    const { engine } = engineOver(fx, { clock, unitExecutor: recording.unitExecutor });
    const handle = engine.startRun(capacityDef(), CAPACITY_OPTIONS);
    const { resultSet } = await handle.done;
    assert.equal(resultSet.ledger.units.length, 1, 'premise: exactly one unit');
    return { fx, engine, runId: handle.runId, resultSet, outcomes: recording.outcomes };
  };
  const fresh = await runIn(null);
  const run1 = await runIn(200);           // bucket 20,000, and the unit's 20 ids are IN it
  const run2 = await runIn(SPARE_OWNER);   // bucket 20,000, and the unit's 20 ids are NOT in it

  const expectedBaseline = [{ modelKey: 'a', epochInstanceCount: 1 }, { modelKey: 'b', epochInstanceCount: maxCollisionInstancesPerEpoch }];
  assert.deepEqual(run1.resultSet.provenance.admissionBaseline, expectedBaseline);
  assert.deepEqual(run2.resultSet.provenance.admissionBaseline, expectedBaseline);

  // Fresh world: the control, held exact against the reference.
  assert.equal(fresh.resultSet.outcome.status, 'completed');
  assert.equal(fresh.resultSet.outcome.coverage, 'full');
  assert.equal(fresh.resultSet.outcome.environmentSensitive, false);
  const reference = await bruteForceReference(fresh.fx, { mode: MODE, sources: [['a', 100]], targets: [['b', [200]]], broadPhase: 'linear' });
  assert.ok(reference.pairIds.length > 0, 'premise: a non-empty reference');
  assertPairSets(pairKeysOf(fresh.resultSet), reference.pairIds, { mode: MODE, resultSet: fresh.resultSet, expect: 'exact' });

  // Run 1: the bucket sits AT the limit (maximum apparent pressure) and the run is still clean --
  // "reproduces the fresh-world pair set and ledger" (§13.1 excludes admissionBaseline from every digest).
  const s1 = run1.resultSet;
  assert.equal(s1.outcome.status, 'completed');
  assert.equal(s1.outcome.coverage, 'full');
  assert.equal(s1.outcome.environmentSensitive, false);
  assert.deepEqual(s1.outcome.environmentSensitiveCauses, []);
  assert.ok(s1.ledger.units.every((u) => u.cause !== 'capacity-exceeded'), 'run 1 did not fail on capacity');
  assert.equal(s1.digests.pairSetDigest, fresh.resultSet.digests.pairSetDigest);
  assert.equal(s1.digests.ledgerDigest, fresh.resultSet.digests.ledgerDigest);

  // Run 2: the same baseline, and the unit overflows on MEMBERSHIP (currentSize + genuinely-new ids).
  const s2 = run2.resultSet;
  const [unit] = s2.ledger.units;
  assert.equal(unit.outcome, 'failed');
  assert.equal(unit.cause, 'capacity-exceeded');
  assert.equal(unit.capacityKind, 'bucket-capacity');
  // `capacityDetails` is not on the sealed UnitRecord (preflight S5): read from the recorded outcome.
  assert.equal(run2.outcomes.length, 1);
  const { failure } = run2.outcomes[0].outcome;
  assert.deepEqual(failure.capacityDetails,
    { currentSize: maxCollisionInstancesPerEpoch, missing: UNIT_FRAGMENTS, limit: maxCollisionInstancesPerEpoch });
  assert.equal('epoch' in failure.capacityDetails || 'loadEpoch' in failure.capacityDetails, false, '§16.5: no epoch key');
  assert.deepEqual(s2.outcome.environmentSensitiveCauses, ['bucket-capacity']);
  assert.equal(s2.outcome.environmentSensitive, true);
  assert.equal(s2.outcome.coverage, 'partial');
  assert.equal(await run2.engine.canClaimNoClashes(run2.runId), false);

  // Negative control (mandatory) -- the actual point of (b'). A predicate that is a function of the
  // baseline ALONE returns the same verdict for a clean run and a capacity-failed run, i.e. it is wrong
  // for one of them. That is why §1.3.5 (a) calls the baseline an observational witness, not a
  // reproduction key, and why `environmentSensitive` follows the OUTCOME (R11-2).
  const fromBaselineAlone = (set) => canonicalJson(set.provenance.admissionBaseline);
  assert.equal(fromBaselineAlone(s1), fromBaselineAlone(s2));
  assert.notEqual(s1.outcome.environmentSensitive, s2.outcome.environmentSensitive);
});

// ---- Step 17b: F6 -- foreign placement contention over the real world (AC-19 d') ------------------

// Source `a`: owner 100, plus a far-away owner 399 used only as the nested growth query's TARGET.
// Targets `b` and `c`: owner 200 of each overlaps a:100. On `c`, spare owners 391.. of one far-away
// fragment each -- outside the definition, outside every digested subtree: the growth fuel.
const CONTENTION_OPTIONS = { broadPhase: 'tlas', maxTargetModelsPerUnit: 1, maxPlacementRetries: 2 };
const contentionModels = (spares) => ({
  a: { 100: [[0, 0, 0]], 399: [[-500, 0, 0]] },
  b: { 200: [[0.3, 0, 0]] },
  c: { 200: [[0.25, 0, 0]], ...Object.fromEntries(spares.map((d, i) => [d, [[200 + 10 * i, 0, 0]]])) },
});
const sparesOf = (n) => Array.from({ length: n }, (_, i) => 391 + i);
// Both selections are EXPLICIT dbIds lists: a whole-model selection would put the spare owners inside
// a digested subtree and legitimately yield `scope-drift` instead of contention -- the mistake a later
// editor would make.
const contentionDef = (targets) => definitionOf({ testId: 'f6', selectionA: [elements('a', [100])],
  selectionB: targets.map((modelKey) => elements(modelKey, [200])) });

/**
 * The contention fixture: a counted library clock whose yield hook, while ARMED and while an engine
 * `findClashes` call is in flight, acts at most ONCE per outer call (`recordFindClashes`'s call index
 * is the call token). `foreign` is one of:
 *   'growth'      -- a nested DIRECT `findClashes` over the next spare owner of `c` (source c:[spare] ->
 *                    target a:[399], 'linear', so it arms no revalidation and cannot abort itself).
 *                    It goes through the PROTOTYPE method, so the recorder does not see it (review
 *                    M-4); the hook disarms itself around it, so its own yields cannot recurse.
 *   'invalidate'  -- `world.invalidateModelPlacement(c)` during every outer call that targets `c`.
 *   'engine'      -- `engine.invalidateModelPlacement('c')` once (the host-signalled §16.2 form).
 *   null          -- the quiet control: the hook never acts.
 */
async function contentionFixture({ spares, foreign }) {
  const { clock, worldOptions } = libraryClock();
  const fx = await makeRealWorldFixture({ models: contentionModels(spares), worldOptions });
  const recorder = recordFindClashes(fx.world);
  const lifecycle = countWorldLifecycleCalls(fx.world);
  const proto = Object.getPrototypeOf(fx.world);
  const box = { engine: null, armed: foreign !== null, growths: 0, acts: 0, pool: [...spares], actedOn: new Set() };
  clock.onYield(async () => {
    if (!box.armed || recorder.inFlight === 0) return;
    // The in-flight outer call. Valid only while engine calls are SERIAL (one in flight at a time, the
    // Step 8 conformance fact); each arm asserts `peakInFlight === 1` (review M-2).
    const token = recorder.calls.length - 1;
    if (box.actedOn.has(token)) return;
    if (foreign === 'growth') {
      if (box.pool.length === 0) return;
      box.actedOn.add(token);
      const spare = box.pool.shift();
      box.armed = false;
      try {
        await proto.findClashes.call(fx.world, {
          source: { model: fx.modelFor('c'), dbIds: [spare] }, target: { targets: [{ model: fx.modelFor('a'), dbIds: [399] }] },
          mode: MODE, groupBy: 'dbId', broadPhase: 'linear',
        });
        box.growths += 1;
      } finally { box.armed = true; }
    } else if (foreign === 'invalidate') {
      if (!recorder.calls[token].query.target.targets.some((t) => t.model === fx.modelFor('c'))) return;
      box.actedOn.add(token);
      fx.world.invalidateModelPlacement(fx.modelFor('c'));
      box.acts += 1;
    } else if (foreign === 'engine') {
      if (box.acts > 0) return;
      box.actedOn.add(token);
      box.engine.invalidateModelPlacement('c');
      box.acts += 1;
    }
  });
  const { engine } = engineOver(fx);
  box.engine = engine;
  return { fx, recorder, lifecycle, box, engine };
}

async function runContention(fixture, targets) {
  const generationBefore = fixture.fx.registry.bindingFor('c').placementGeneration;
  const handle = fixture.engine.startRun(contentionDef(targets), CONTENTION_OPTIONS);
  const { resultSet } = await handle.done;
  await settle();
  assert.equal(fixture.recorder.peakInFlight, 1, 'serial engine calls (the growth token relies on it)');
  return { resultSet, runId: handle.runId, generationBefore, generationAfter: fixture.fx.registry.bindingFor('c').placementGeneration };
}

function assertQuietControl({ resultSet }) {
  assert.equal(resultSet.outcome.status, 'completed', JSON.stringify(resultSet.outcome));
  assert.equal(resultSet.outcome.coverage, 'full');
  assert.equal(resultSet.outcome.environmentSensitive, false);
}

test('foreign placement contention: a direct-caller growth bump on every attempt exhausts maxPlacementRetries (AC-19 d\')', async () => {
  const spares = sparesOf(8);
  const quiet = await contentionFixture({ spares, foreign: null });
  const quietRun = await runContention(quiet, ['b', 'c']);
  assertQuietControl(quietRun);
  const reference = await bruteForceReference(quiet.fx, { mode: MODE, sources: [['a', 100]], targets: [['b', [200]], ['c', [200]]] });
  assert.ok(reference.pairIds.length > 0);
  assertPairSets(pairKeysOf(quietRun.resultSet), reference.pairIds, { mode: MODE, resultSet: quietRun.resultSet, expect: 'exact' });

  const contended = await contentionFixture({ spares, foreign: 'growth' });
  const run = await runContention(contended, ['b', 'c']);
  const set = run.resultSet;
  // The hook fired as designed: one growth during b's call (invisible to it: b's call arms only b's
  // epoch) and one per attempt of c -- and the pool did not run dry, so "bumped on every attempt" is a
  // fact, not an artifact.
  const attemptsAllowed = CONTENTION_OPTIONS.maxPlacementRetries + 1;
  assert.equal(contended.box.growths, 1 + attemptsAllowed);
  assert.ok(contended.box.growths < spares.length);
  assert.equal(run.generationAfter, run.generationBefore, 'the engine-owned placementGeneration stayed put');

  // Two units in canonical plan order (b then c), pinned before anything is compared (invariant P1).
  assert.deepEqual(unitIdsOf(set), unitIdsOf(quietRun.resultSet));
  assert.deepEqual(set.ledger.units.map((u) => u.targets.map((t) => t.modelKey)), [['b'], ['c']]);
  const [unitB, unitC] = set.ledger.units;
  assert.equal(unitC.outcome, 'failed', JSON.stringify(unitC));
  assert.equal(unitC.cause, 'stale-placement');
  assert.equal(unitC.attempts, attemptsAllowed);
  assert.equal(contended.recorder.calls.length, 1 + attemptsAllowed, 'one call for b, one per attempt of c');
  assert.equal(contended.recorder.peakInFlight, 1, 'serial calls: the per-call growth token is sound');
  assert.equal(contended.recorder.calls[0].error, null, 'b\'s call was not aborted by the growth in c\'s epoch');
  assert.ok(contended.recorder.calls.slice(1).every((c) => c.error?.name === 'ModelPlacementChangedError'),
    'the REAL world raised ModelPlacementChangedError on every attempt of c');
  assert.ok(set.outcome.environmentSensitiveCauses.includes('placement-contention'));
  assert.equal(set.outcome.environmentSensitive, true);
  assert.equal(set.outcome.coverage, 'partial');
  assert.equal(await contended.engine.canClaimNoClashes(run.runId), false);

  // The comparison-free half: b evaluated in BOTH runs, with identical pairs.
  const quietEvaluated = quietRun.resultSet.ledger.units.filter((u) => u.outcome === 'evaluated');
  const evaluated = set.ledger.units.filter((u) => u.outcome === 'evaluated');
  // Vacuity guard (mandatory): at least one evaluated unit AND at least one stale-placement gap.
  assert.ok(evaluated.length > 0 && evaluated.length < quietEvaluated.length, `${evaluated.length} of ${quietEvaluated.length}`);
  assert.equal(unitB.outcome, 'evaluated');
  assert.deepEqual(pairKeysOfUnit(set, unitB.unitId), pairKeysOfUnit(quietRun.resultSet, unitB.unitId));
  assert.ok(pairKeysOfUnit(set, unitB.unitId).length > 0, 'premise: b has pairs to compare');
  // No engine lifecycle call: the growth is another caller's extraction, never an invalidation.
  assert.deepEqual({ ...contended.lifecycle }, { evictModel: 0, dispose: 0, invalidateModelPlacement: 0 });
});

test('a foreign growth bump that clears on a retry adds no cause and equals the quiet run (AC-19 d\')', async () => {
  const spares = sparesOf(1);                         // attempt 1 aborts; attempt 2 has nothing to grow
  const quiet = await contentionFixture({ spares, foreign: null });
  const quietRun = await runContention(quiet, ['c']);
  assertQuietControl(quietRun);
  const contended = await contentionFixture({ spares, foreign: 'growth' });
  const run = await runContention(contended, ['c']);
  assert.equal(contended.box.growths, 1);
  assert.equal(contended.recorder.calls[0].error?.name, 'ModelPlacementChangedError', 'premise: attempt 1 was aborted');
  const [unit] = run.resultSet.ledger.units;
  assert.equal(unit.outcome, 'evaluated');
  assert.ok(unit.attempts > 1, 'premise: it took a retry');
  assert.deepEqual(run.resultSet.outcome.environmentSensitiveCauses, []);
  assert.equal(run.resultSet.outcome.environmentSensitive, false);
  assert.equal(run.resultSet.outcome.status, 'completed');
  assert.equal(run.resultSet.outcome.coverage, 'full');
  // Legal precisely because §13.1 excludes ATTEMPT COUNTS from ledgerDigest.
  assert.equal(run.resultSet.digests.pairSetDigest, quietRun.resultSet.digests.pairSetDigest);
  assert.equal(run.resultSet.digests.ledgerDigest, quietRun.resultSet.digests.ledgerDigest);
});

test('a direct-caller invalidateModelPlacement is the same foreign fact as a growth bump (AC-19 d\')', async () => {
  // The second origin §7.5 folds into one row. This form also records the library's
  // `_placementInvalidatedAtRevision` (arming its staged placement refresh); nothing is asserted about
  // that path -- if a library change made the refresh swallow the abort, the unit would come back
  // `evaluated` and this arm fails loudly, which is the correct signal.
  const fixture = await contentionFixture({ spares: [], foreign: 'invalidate' });
  const run = await runContention(fixture, ['c']);
  const attemptsAllowed = CONTENTION_OPTIONS.maxPlacementRetries + 1;
  assert.equal(fixture.box.acts, attemptsAllowed, 'one foreign invalidation per attempt');
  const [unit] = run.resultSet.ledger.units;
  assert.equal(unit.outcome, 'failed', JSON.stringify(unit));
  assert.equal(unit.cause, 'stale-placement');
  assert.equal(unit.attempts, attemptsAllowed);
  assert.ok(run.resultSet.outcome.environmentSensitiveCauses.includes('placement-contention'));
  assert.equal(run.resultSet.outcome.coverage, 'partial');
  assert.equal(run.generationAfter, run.generationBefore, 'the engine-owned placementGeneration stayed put');
  assert.equal(fixture.lifecycle.invalidateModelPlacement, attemptsAllowed, 'exactly the test\'s own calls');
});

test('negative control: a host-signalled placement change is discarded:input-changed, never placement-contention (AC-19 d\')', async () => {
  // The §16.2 single call bumps placementGeneration FIRST and then calls the very same
  // world.invalidateModelPlacement (P1.7): the IDENTICAL library call as the arm above, differing only
  // in the engine-owned generation. A build that classified every abort as contention passes the
  // contention arms and fails here.
  const fixture = await contentionFixture({ spares: [], foreign: 'engine' });
  const run = await runContention(fixture, ['c']);
  assert.equal(fixture.box.acts, 1);
  const [unit] = run.resultSet.ledger.units;
  assert.equal(unit.outcome, 'discarded', JSON.stringify(unit));
  assert.equal(unit.cause, 'input-changed');
  assert.equal(fixture.recorder.calls.length, 1, 'no retry: the unit ran exactly once');
  assert.equal(fixture.recorder.calls[0].error?.name, 'ModelPlacementChangedError', 'the same library fact');
  assert.equal(run.resultSet.outcome.status, 'invalidated');
  assert.equal(run.resultSet.outcome.environmentSensitiveCauses.includes('placement-contention'), false);
  assert.ok(run.generationAfter > run.generationBefore, 'the engine-owned placementGeneration moved');
  assert.equal(fixture.lifecycle.invalidateModelPlacement, 1, 'reached the world through the registry, once');
});
