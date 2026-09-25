// test/clashtest/run/lifecycle.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRun } from '../../../clashtest/run/Run.js';
import { createRunFixture } from '../support/runFixture.mjs';
import { createFakePlan } from '../support/fakePlanner.mjs';
// Not in the brief's Step 1 listing, which uses `createScriptedExecutor` without importing it (P6.4).
import { createScriptedExecutor } from '../support/scriptedExecutor.mjs';

test('cancel BEFORE resolution seals the pre-resolution representation', async () => {
  // The definition lookup NEVER settles. The cancel must still bound `cancel()` and `done`
  // (review C2): resolution is RACED against cancellation and the loser is abandoned (R5).
  const fx = createRunFixture({
    resolveDefinition: () => new Promise(() => {}),        // never settles
    plan: createFakePlan([]),
  });
  const { handle, begin } = createRun(fx.spec);
  begin();
  const summary = await handle.cancel('user');             // must not hang
  assert.equal(summary.status, 'cancelled');
  const set = summary.resultSet;
  assert.equal(set.definition, null);
  assert.deepEqual(set.testRef, { testId: fx.testId, revision: null, semanticDigest: null });
  assert.equal(set.ledger.units.length, 0);
  assert.equal(set.results.length, 0);
  assert.equal(set.outcome.coverage, 'partial');
  assert.ok(set.outcome.reasons.includes('planning:cancelled'));
  assert.deepEqual(handle.getSnapshot().unitsTotal, 0);
  assert.equal(handle.getSnapshot().pairSpaceTotal, 0);
  assert.equal(structuredClone(set).runId, set.runId, 'the set is structured-clone safe');
  assert.equal(fx.residency.admitted.includes(handle.runId), true,
    'the reserved slot became an ordinary resident set, never leaked (§13.1)');
});

test('a definition that resolves AFTER the cancel won is abandoned, and changes nothing', async () => {
  let settleLookup;
  const fx = createRunFixture({
    resolveDefinition: () => new Promise((r) => { settleLookup = r; }),
    plan: createFakePlan([{ unitId: '1.0', weight: 1 }]),
  });
  const { handle, begin } = createRun(fx.spec);
  begin();
  const summary = await handle.cancel('user');
  settleLookup({ definition: fx.definition, testRef: fx.testRef });   // the loser arrives late
  await Promise.resolve();
  assert.equal(summary.resultSet.definition, null, 'the late winner is discarded, not embedded');
  assert.equal(await handle.done, summary, 'done still settles exactly once');
  assert.deepEqual(fx.executor.startedUnits, [], 'planning and execution never began');
});

test('a definition lookup that REJECTS after the cancel won does not reject done', async () => {
  let failLookup;
  const fx = createRunFixture({
    resolveDefinition: () => new Promise((_, reject) => { failLookup = reject; }),
    plan: createFakePlan([]),
  });
  const { handle, begin } = createRun(fx.spec);
  begin();
  const summary = await handle.cancel('user');
  failLookup(new Error('store exploded'));                 // abandoned, and HANDLED
  await Promise.resolve();
  assert.equal(summary.status, 'cancelled');
  assert.equal(await handle.done, summary);
});

test('cancel while QUEUED behind another run still seals and still releases the slot (R5)', async () => {
  // The withdrawn job's `run` function is never invoked, so nothing inside the loop can seal it.
  // The withdrawal winner owes it the pre-resolution cancelled seal.
  const shared = createRunFixture.sharedWorld();
  const head = createRunFixture({ shared, plan: createFakePlan([{ unitId: '1.0', weight: 1 }]),
    executor: createScriptedExecutor({ '1.0': [{ facts: [], hold: true }] }) });
  const waiting = createRunFixture({ shared, plan: createFakePlan([{ unitId: '1.0', weight: 1 }]) });

  const a = createRun(head.spec); a.begin();
  await head.executor.inFlight('1.0');
  const b = createRun(waiting.spec); b.begin();
  assert.equal(shared.coordinator.queueDepth(waiting.engineId), 1, 'b is WAITING, not in flight');

  const summary = await b.handle.cancel('user');           // must not hang
  assert.equal(summary.status, 'cancelled');
  assert.equal(summary.resultSet.definition, null, 'pre-resolution representation');
  assert.equal(summary.resultSet.ledger.units.length, 0);
  assert.ok(summary.resultSet.outcome.reasons.includes('planning:cancelled'));
  assert.equal(shared.coordinator.queueDepth(waiting.engineId), 0, 'withdrawn from the queue');
  assert.deepEqual(waiting.executor.startedUnits, [], 'a withdrawn run never executes');
  assert.equal(waiting.residency.admitted.includes(b.handle.runId), true, 'slot converted, not leaked');
  assert.equal(waiting.residency.released.includes(b.handle.runId), false, 'and not double-freed');

  head.executor.release('1.0');
  assert.equal((await a.handle.done).status, 'completed', 'the head run is unaffected');
});

test('a cancel that LOSES the withdrawal race is handled by the boundary, not sealed twice', async () => {
  // withdraw() returns false once the job has started; the run then reaches its own first
  // boundary and settles there. Exactly one of the two paths seals.
  const fx = createRunFixture({
    plan: createFakePlan([{ unitId: '1.0', weight: 1 }]),
    executor: createScriptedExecutor({ '1.0': [{ facts: [] }] }),
    cancelAt: 'job-started',                               // fires after withdraw() can succeed
  });
  const { handle, begin } = createRun(fx.spec);
  begin();
  const summary = await handle.done;
  assert.equal(summary.status, 'cancelled');
  assert.equal(fx.residency.admitted.filter((id) => id === handle.runId).length, 1, 'sealed once');
});

test('cancel AFTER resolution but during enumeration embeds the resolved definition', async () => {
  const fx = createRunFixture({ stallAt: 'enumerating', plan: createFakePlan([{ unitId: '1.0', weight: 5 }]) });
  const { handle, begin } = createRun(fx.spec);
  begin();
  await fx.reached('enumerating');
  const summary = await handle.cancel('user');
  assert.equal(summary.status, 'cancelled');
  assert.notEqual(summary.resultSet.definition, null);
  assert.equal(summary.resultSet.testRef.semanticDigest, fx.semanticDigest);
  assert.equal(summary.resultSet.ledger.units.length, 0, 'planning is abandoned; no unit ledger');
});

test('a planning gap other than `cancelled` fails the run, and beats a coincident cancel', async () => {
  for (const cause of ['model-not-bound', 'enumeration-failed', 'plan-too-large', 'world-disposed']) {
    const fx = createRunFixture({ planningGap: cause, plan: null });
    const { handle, begin } = createRun(fx.spec);
    begin();
    handle.cancel('user');                                  // same slice
    const summary = await handle.done;
    assert.equal(summary.status, 'failed', cause);
    assert.equal(summary.resultSet.outcome.coverage, 'partial');
    assert.equal(summary.resultSet.ledger.units.length, 0);
    assert.ok(summary.resultSet.outcome.reasons.includes(`planning:${cause}`));
    assert.ok(summary.resultSet.outcome.reasons.includes('cancel-requested'));
  }
});

test('the run-start leases are P1\'s snapshot leases; P6 admits nothing and mutates nothing (R7)', async () => {
  const fx = createRunFixture({ plan: createFakePlan([{ unitId: '1.0', weight: 1, models: ['mk-a', 'mk-b'] }]) });
  const { handle, begin } = createRun(fx.spec);
  begin();
  const summary = await handle.done;
  assert.equal(summary.status, 'completed');
  assert.equal(fx.world.calls.admitModel, 0,
    'P6 runs NO second admitModel loop — the registry admitted lazily inside snapshotBindings');
  assert.deepEqual(fx.registry.admittedKeys.sort(), ['mk-a', 'mk-b'],
    'the registry took exactly one lease per touched model');
  for (const binding of fx.registry.lastSnapshot.bindings) {
    assert.equal(Object.isFrozen(binding), true, 'P1 hands back FROZEN bindings');
    assert.notEqual(binding.lease, null, 'each carries its valid cached lease');
  }
});

test('a frozen binding is never written to: the run keeps P1\'s objects as-is', async () => {
  'use strict';
  const fx = createRunFixture({ plan: createFakePlan([{ unitId: '1.0', weight: 1, models: ['mk-a'] }]) });
  const { handle, begin } = createRun(fx.spec);
  begin();
  await handle.done;
  const [binding] = fx.registry.lastSnapshot.bindings;
  assert.equal(fx.registry.mutationAttempts, 0, 'no write was attempted on a frozen binding');
  assert.throws(() => { binding.lease = null; }, TypeError,
    'proof the object would have thrown had the old second-admission loop survived');
});

test('a null in the run-start snapshot is the model-not-bound planning gap (no `dead` flag)', async () => {
  const fx = createRunFixture({ plan: createFakePlan([{ unitId: '1.0', weight: 1, models: ['mk-a', 'gone'] }]) });
  fx.registry.unregisterKey('gone');                       // dead, unregistered and lease-invalid all read as null
  const { handle, begin } = createRun(fx.spec);
  begin();
  const summary = await handle.done;
  assert.equal(summary.status, 'failed');
  assert.ok(summary.resultSet.outcome.reasons.includes('planning:model-not-bound'));
  assert.equal(summary.resultSet.ledger.units.length, 0);
});

test('C2: every PRE-RESOLUTION seal produces a real, non-null Result Set', async () => {
  // Re-verification C2. These three runs seal before `createResultAccumulator` could ever have been
  // called, and they go through the REAL sealing sketch (`sealAs` -> `resultParts` ->
  // `buildResultSet` -> `sealResultSet` -> `admitSealedSet`) with P5's real assembly, not a stub.
  // With `run.results` left `undefined` until plan completion, `resultParts` throws, the R10
  // fallback calls `resultParts` again and throws again, and `RunSummary.resultSet` is `null` —
  // exactly the §13.1 guarantee ("a valid, empty, pre-resolution set") that is being tested here.
  const cases = [
    ['cancel during resolution', { resolveDefinition: () => new Promise(() => {}) },
      { cancel: true }, 'cancelled', 'planning:cancelled'],
    ['definition lookup failure', { resolveDefinition: () => Promise.reject(new Error('store exploded')) },
      {}, 'failed', 'planning:enumeration-failed'],
    ['model-not-bound', { unbindKeys: ['gone'], models: ['mk-a', 'gone'] },
      {}, 'failed', 'planning:model-not-bound'],
  ];
  for (const [label, opts, how, status, reason] of cases) {
    const fx = createRunFixture({ plan: createFakePlan([]), realSealing: true, ...opts });
    const { handle, begin } = createRun(fx.spec);
    begin();
    if (how.cancel) await handle.cancel('user');           // must not hang
    const settled = await handle.done;
    assert.notEqual(settled.resultSet, null, `${label}: a pre-resolution set is REQUIRED (§13.1)`);
    assert.equal(settled.status, status, label);
    assert.deepEqual(settled.resultSet.results, [], `${label}: empty, not absent`);
    assert.equal(settled.resultSet.ledger.units.length, 0, label);
    assert.equal(settled.resultSet.sealed, true, `${label}: sealed exactly once`);
    assert.ok(settled.resultSet.outcome.reasons.includes(reason), label);
    assert.equal(settled.resultSet.outcome.coverage, 'partial', label);
    assert.ok(!settled.resultSet.outcome.reasons.includes('unit:internal-error'),
      `${label}: this must be the PLANNED seal, never the R10 seal-failure fallback`);
    assert.equal(fx.residency.admitted.includes(handle.runId), true, label);
  }
});

test('Q2: every planning gap P3 reported reaches RunOutcome.reasons', async () => {
  const fx = createRunFixture({
    plan: null,
    planningGaps: [{ phase: 'enumerating', cause: 'cancelled' },
                   { phase: 'enumerating', cause: 'enumeration-failed' },
                   { phase: 'planning', cause: 'plan-too-large' }],
  });
  const { handle, begin } = createRun(fx.spec);
  begin();
  const summary = await handle.done;
  assert.equal(summary.status, 'failed',
    'a non-cancelled gap decides the status even when a `cancelled` gap came first (order B)');
  for (const cause of ['cancelled', 'enumeration-failed', 'plan-too-large']) {
    assert.ok(summary.resultSet.outcome.reasons.includes(`planning:${cause}`), cause);
  }
  assert.deepEqual(summary.resultSet.outcome.reasons,
    [...summary.resultSet.outcome.reasons].sort(), 'ascending and distinct');
});

test('I7: derivedFromRunId is part of the RunSpec, validated, and reaches the sealed set', async () => {
  const fx = createRunFixture({
    plan: createFakePlan([{ unitId: '1.0', weight: 1 }]),
    executor: createScriptedExecutor({ '1.0': [{ facts: [] }] }),
    derivedFromRunId: 'run-base-7',
  });
  const { handle, begin } = createRun(fx.spec);
  begin();
  const summary = await handle.done;
  assert.equal(summary.resultSet.derivedFromRunId, 'run-base-7', 'rerun lineage survives the seal');

  const plain = createRunFixture({ plan: createFakePlan([]) });          // no field at all
  assert.equal(createRun(plain.spec).handle.runId, plain.spec.runId, 'absent is legal');
  assert.equal(
    createRun({ ...plain.spec, derivedFromRunId: null }).handle.runId, plain.spec.runId,
    'explicit null is legal');
  for (const bad of ['', 7, {}, ['run-1']]) {
    assert.throws(() => createRun({ ...plain.spec, derivedFromRunId: bad }), TypeError,
      `a malformed RunSpec is a programmer error: ${JSON.stringify(bad)}`);
  }
});

test('provenance.admissionBaseline is recorded at the snapshot instant (§13.2)', async () => {
  const fx = createRunFixture({ plan: createFakePlan([{ unitId: '1.0', weight: 1, models: ['mk-a'] }]) });
  const { handle, begin } = createRun(fx.spec);
  begin();
  const summary = await handle.done;
  assert.deepEqual(summary.resultSet.provenance.admissionBaseline.map((e) => e.modelKey), ['mk-a']);
  assert.equal(typeof summary.resultSet.provenance.admissionBaseline[0].epochInstanceCount, 'number');
});

test('a preplanned target-too-large gap is adopted into progress; the run seals FULLY processed (R11)', async () => {
  // P3 records `not-run:target-too-large` gap records at planning and creates NO executable unit
  // for them, yet their weight IS part of pairSpaceTotal (AC-18(b)). Without adoption the run
  // would seal `completed` at fractionProcessed 0.5 (review I3).
  const fx = createRunFixture({
    plan: createFakePlan([{ unitId: '1.0', weight: 5 }],
      { gaps: [{ unitId: '1.1', pairSpaceWeight: 5, cause: 'target-too-large' }] }),
    executor: createScriptedExecutor({ '1.0': [{ facts: [] }] }),
  });
  const { handle, begin } = createRun(fx.spec);
  begin();
  const summary = await handle.done;
  const snap = handle.getSnapshot();
  assert.equal(summary.status, 'completed');
  assert.equal(snap.pairSpaceTotal, 10, 'the gap weight is part of the total');
  assert.equal(snap.fractionProcessed, 1, 'processed = evaluated + gaps');
  assert.equal(snap.fractionEvaluated, 0.5, 'a gap is processed but never evaluated');
  assert.equal(snap.unitsTotal, 2);
  assert.equal(snap.unitsEvaluated, 1);
  assert.equal(snap.unitsFailedOrSkipped, 1);
  assert.equal(summary.resultSet.outcome.coverage, 'partial');
  assert.deepEqual(fx.executor.startedUnits, ['1.0'], 'a preplanned gap is never issued');
  assert.deepEqual(
    summary.resultSet.ledger.units.map((u) => `${u.outcome}:${u.cause}`),
    ['evaluated:null', 'not-run:target-too-large'],
  );
});

test('the adoption is idempotent: a mid-run snapshot never counts a gap twice', async () => {
  const fx = createRunFixture({
    plan: createFakePlan([{ unitId: '1.0', weight: 2 }, { unitId: '1.1', weight: 2 }],
      { gaps: [{ unitId: '1.2', pairSpaceWeight: 4, cause: 'target-too-large' }] }),
    executor: createScriptedExecutor({ '1.0': [{ facts: [] }], '1.1': [{ facts: [] }] }),
  });
  const { handle, begin } = createRun(fx.spec);
  const seen = [];
  handle.subscribe(() => seen.push(handle.getSnapshot()));
  begin();
  await handle.done;
  const processed = seen.map((s) => s.pairSpaceProcessed);
  assert.deepEqual(processed, [...processed].sort((a, b) => a - b), 'monotone');
  assert.equal(processed.at(-1), 8);
  assert.ok(processed.every((p) => p >= 4), 'the gap weight is adopted once, at plan completion');
});

test('the queued->planning binding snapshot is ONE snapshotBindings call', async () => {
  const fx = createRunFixture({ plan: createFakePlan([{ unitId: '1.0', weight: 1, models: ['mk-a', 'mk-b'] }]) });
  const { handle, begin } = createRun(fx.spec);
  begin();
  await handle.done;
  const planningSnapshots = fx.registry.snapshotCalls.filter((c) => c.at === 'queued->planning');
  assert.equal(planningSnapshots.length, 1);
  assert.deepEqual(planningSnapshots[0].keys, ['mk-a', 'mk-b']);
});

test('a model registered AFTER the snapshot does not join the run', async () => {
  const fx = createRunFixture({ plan: createFakePlan([{ unitId: '1.0', weight: 1, models: ['mk-a'] }]) });
  const { handle, begin } = createRun(fx.spec);
  begin();
  await fx.reached('planning');
  fx.registry.register('mk-late', {}, { modelVersion: 'v1' });
  const summary = await handle.done;
  assert.deepEqual(summary.resultSet.provenance.models.map((m) => m.modelKey), ['mk-a']);
});

// --- P6.4 task-review fix: an unexpected STAGE failure still seals a set P5's reader accepts ---
// (not in the brief's Step 1; added for the task review's Important finding). `sealResultSet` does
// not validate, so a malformed set would be admitted and only rejected later, on read.
import { validateResultSet } from '../../../clashtest/results/validateResultSet.js';
import { resolveEngineLimits } from '../../../clashtest/options.js';
import { createPlan, materializeUnit, rootsForRanges } from '../../../clashtest/planning/planner.js';
import { splitUnit } from '../../../clashtest/planning/splitting.js';
import { createRecordBudget, createLedger } from '../../../clashtest/planning/ledger.js';
import { computeSemanticDigest } from '../../../clashtest/definition/normalize.js';
import { getFreshness } from '../../../clashtest/run/freshness.js';
import { assessNoClashClaim, canClaimNoClashes } from '../../../clashtest/results/claim.js';
import { makeSyntheticEnumerator, defOf } from '../support/syntheticModels.mjs';

// P6 whole-branch review (C1 + the filter fix): NO issue-code filtering. The old `ledgerShapeIssues`
// filter kept only `/ledger/planningGaps` and `/ledger/units/N/outcome` paths and waved everything else
// through as "separately tracked fixture artefacts" — which is how the missing `provenance.models`
// columns (C1) survived every task review. A test that needs a set `validateResultSet` accepts now
// builds a GENUINE one (`realPlannerFixture`, below) and asserts the WHOLE issue list is empty.
const issuesOf = (set) => validateResultSet(set, { limits: resolveEngineLimits() }).issues;

/**
 * A run over P3's REAL planner (`createPlan`, `materializeUnit`, `splitUnit`, real budget/ledger) and a
 * synthetic enumerator, with a normalized definition and its REAL `semanticDigest`, sealed through P5's
 * bare functions (`realSealing`). Everything that made the fake-plan fixture's sets unreadable (fake
 * digest, empty unit ranges, no `rootOwners`, empty plan-time scope evidence) is real here, so a sealed
 * set must validate with ZERO issues. Two cross-model models, `mk-a` (roots 1, 2, 3) × `mk-b` (7, 8);
 * `runOptions.maxSourceDbIdsPerUnit: 1` gives one unit per source root (`1.0`..`1.2`).
 */
const synthRoots = (dbIds, fragBase) => dbIds.map((dbId, i) => ({
  dbId, owners: [dbId], fragments: [{ fragId: fragBase + i, ownerDbId: dbId, geometryId: 1 }],
}));
function realPlannerFixture(opts = {}) {
  const { enumerator } = makeSyntheticEnumerator([
    { modelKey: 'mk-a', roots: synthRoots([1, 2, 3], 0) },
    { modelKey: 'mk-b', roots: synthRoots([7, 8], 10) },
  ]);
  const definition = defOf({
    A: [{ kind: 'model', modelKey: 'mk-a' }], B: [{ kind: 'model', modelKey: 'mk-b' }], testId: 'test-1',
  });
  const testRef = { testId: 'test-1', revision: definition.revision, semanticDigest: computeSemanticDigest(definition) };
  const fx = createRunFixture({
    realSealing: true,
    models: ['mk-a', 'mk-b'],
    resolveDefinition: () => Promise.resolve({ definition, testRef }),
    ...opts,
    specOverrides: {
      enumerator,
      plannerPort: {
        planRun: createPlan, materializeUnit, splitUnit, rootsForRanges,
        createRecordBudget, createLedger, checkScopeBracket: null,
      },
      ...opts.specOverrides,
    },
  });
  return { ...fx, enumerator };
}

test('a SYNCHRONOUSLY throwing definition lookup seals the valid pre-resolution shape', async () => {
  const fx = createRunFixture({ resolveDefinition: () => { throw new Error('store exploded synchronously'); } });
  const { handle, begin } = createRun(fx.spec);
  begin();
  const summary = await handle.done;
  assert.equal(summary.status, 'failed');
  assert.equal(summary.resultSet.definition, null, 'pre-resolution');
  assert.deepEqual(summary.resultSet.ledger.planningGaps.map((g) => g.cause), ['enumeration-failed'],
    'exactly ONE planning gap (§13.1), mapped like an async rejection');
  assert.deepEqual(summary.resultSet.ledger.units, []);
  assert.deepEqual(issuesOf(summary.resultSet), [], 'validateResultSet accepts it outright');
  assert.equal(fx.residency.admitted.includes(handle.runId), true);
});

test('an unexpected error BEFORE a plan exists is ONE internal-error planning gap, not a bare unit cause', async () => {
  const fx = realPlannerFixture({
    specOverrides: { modelKeysOf: () => { throw new Error('boom'); } },
  });
  const { handle, begin } = createRun(fx.spec);
  begin();
  const summary = await handle.done;
  assert.equal(summary.status, 'failed');
  assert.deepEqual(summary.resultSet.ledger.planningGaps.map((g) => g.cause), ['internal-error']);
  assert.deepEqual(summary.resultSet.ledger.units, []);
  assert.ok(summary.resultSet.outcome.reasons.includes('planning:internal-error'));
  assert.ok(!summary.resultSet.outcome.reasons.includes('unit:internal-error'));
  assert.deepEqual(issuesOf(summary.resultSet), [], 'validateResultSet accepts it outright (no filter)');
  assert.deepEqual(fx.executor.startedUnits, []);
});

test('an unexpected error MID-EXECUTION leaves no unsettled (null-outcome) unit in the sealed ledger', async () => {
  const fx = realPlannerFixture({
    runOptions: { maxSourceDbIdsPerUnit: 1 },
    specOverrides: { deriveUnitTaints: () => { throw new Error('taint derivation exploded'); } },
  });
  const { handle, begin } = createRun(fx.spec);
  begin();
  const summary = await handle.done;
  assert.equal(summary.status, 'failed');
  assert.ok(summary.resultSet.outcome.reasons.includes('unit:internal-error'));
  assert.deepEqual(summary.resultSet.ledger.units.map((u) => `${u.unitId}:${u.outcome}:${u.cause}`),
    ['1.0:evaluated:null', '1.1:not-run:run-failed', '1.2:not-run:run-failed'],
    'the queued units are closed as run-failed gaps');
  assert.deepEqual(summary.resultSet.ledger.planningGaps, []);
  assert.deepEqual(issuesOf(summary.resultSet), [], 'validateResultSet accepts it outright (no filter)');
  assert.deepEqual(fx.executor.startedUnits, ['1.0'], 'no unit starts after the failure');
});

// --- P6 whole-branch review C1: sealed provenance carries P5's COMPLETE ProvenanceModel ----------
test('C1: a normal, resolved, engine-sealed run validates with ZERO issues (complete provenance.models)', async () => {
  const fx = realPlannerFixture();
  const { handle, begin } = createRun(fx.spec);
  begin();
  const summary = await handle.done;
  assert.equal(summary.status, 'completed');
  assert.equal(summary.resultSet.outcome.coverage, 'full');
  assert.deepEqual(issuesOf(summary.resultSet), [], 'no issue of ANY code — nothing is filtered');
  const [a, b] = summary.resultSet.provenance.models;
  assert.deepEqual(summary.resultSet.provenance.models.map((m) => m.modelKey), ['mk-a', 'mk-b']);
  assert.deepEqual(a.scopeKinds, ['model']);
  assert.equal(a.elementCount, 3, 'mk-a: three fragment-owning elements (one owner per root)');
  assert.equal(b.elementCount, 2);
  assert.deepEqual(a.scopeDigests.roots.map((r) => r.dbId), [1, 2, 3], 'the plan-time root digests');
  assert.equal(a.scopeDigests.population.count, 3, 'whole-model scope: the population digest');
  for (const m of summary.resultSet.provenance.models) {
    assert.equal(typeof m.bindingGeneration, 'number');
    assert.equal(typeof m.placementGeneration, 'number');
    assert.equal(m.modelVersion, 'v1');
  }
});

test('C1: getFreshness runs over an ENGINE-sealed set (not a hand-built one) without throwing', async () => {
  const fx = realPlannerFixture();
  const { handle, begin } = createRun(fx.spec);
  begin();
  const { resultSet } = await handle.done;
  const fresh = await getFreshness(resultSet, { registry: fx.registry, enumerator: fx.enumerator });
  assert.deepEqual(fresh, { state: 'current', reasons: [] },
    'nothing moved: the bracket re-digests the sealed scopeDigests and agrees');
  fx.registry.notifyPlacementChanged('mk-b');
  const moved = await getFreshness(resultSet, { registry: fx.registry, enumerator: fx.enumerator });
  assert.equal(moved.state, 'stale');
  assert.deepEqual(moved.reasons, ['placement-changed:mk-b']);

  // The fake-plan fixture's engine-sealed set (empty plan-time scope evidence) is readable too.
  const plain = createRunFixture({ plan: createFakePlan([{ unitId: '1.0', weight: 1, models: ['mk-a', 'mk-b'] }]) });
  const run2 = createRun(plain.spec);
  run2.begin();
  const plainSet = (await run2.handle.done).resultSet;
  const plainFresh = await getFreshness(plainSet, { registry: plain.registry, enumerator: null });
  assert.equal(plainFresh.state, 'unverifiable');
  assert.deepEqual(plainFresh.reasons, ['no-enumerator']);
});

test('C1: a run sealed before a plan exists records no provenance model rows (nothing fabricated)', async () => {
  // A resolved run whose snapshot exists (mk-a is bound) but whose planning fails (mk-b is not).
  const fx = realPlannerFixture({ unbindKeys: ['mk-b'] });
  const { handle, begin } = createRun(fx.spec);
  begin();
  const summary = await handle.done;
  assert.equal(summary.status, 'failed');
  assert.ok(summary.resultSet.outcome.reasons.includes('planning:model-not-bound'));
  assert.deepEqual(summary.resultSet.provenance.models, [], 'no plan => no plan-time scope evidence');
  assert.deepEqual(issuesOf(summary.resultSet), []);
});

test('C1: a plan missing a snapshot model record fails closed into a READABLE, VALID R10 fallback set', async () => {
  // P3 contract violation: the plan holds no record for `mk-b`. The normal seal throws in
  // `provenanceOf`; the R10 fallback must not re-read the same broken plan and lose its set (O7).
  let realPlan = null;
  const fx = realPlannerFixture({
    specOverrides: {
      plannerPort: {
        async planRun(args) {
          const result = await createPlan(args);
          realPlan = result.plan;
          const models = new Map([...result.plan.models].filter(([k]) => k !== 'mk-b'));
          return { ...result, plan: { ...result.plan, models } };
        },
        materializeUnit: (_plan, unit) => materializeUnit(realPlan, unit),
        splitUnit, rootsForRanges, createRecordBudget, createLedger, checkScopeBracket: null,
      },
    },
  });
  const { handle, begin } = createRun(fx.spec);
  begin();
  const summary = await handle.done;
  assert.equal(summary.status, 'failed');
  assert.notEqual(summary.resultSet, null, 'the fallback set survives the broken plan');
  assert.ok(summary.resultSet.outcome.reasons.includes('unit:internal-error'));
  assert.deepEqual(summary.resultSet.provenance.models, [], 'no fabricated model rows');
  assert.equal(summary.resultSet.ledger.planExists, false,
    'H1 fix: the fallback ledger never carries real plan facts, so it must not claim a plan exists');
  // H1 fix (P6 independent review + adjudication, 2026-09-24): this previously validated with exactly
  // two `coverage-model-mismatch` issues (documented as a known, pre-existing R10 defect) because
  // `emptyLedgerRecord` wrote `planExists: true` with an empty `rootOwners`, which P5's
  // `reconcileEvaluatedCoverageSteps` rejects. `planExists` is now unconditionally `false` in that
  // record, so the whole coverage-reconciliation check is skipped and the fallback validates clean.
  assert.deepEqual(issuesOf(summary.resultSet), []);
});

test('H1 fix: a post-plan seal failure over a HEALTHY plan also validates clean and cannot claim clean', async () => {
  // Distinct from the test above: here the PLAN and SNAPSHOT are entirely healthy (no missing model
  // record), and `run.provenance()` succeeds with real, non-empty model rows — the seal failure is
  // injected one level later, in `sealResultSet` itself (the class of failure Run.js's own P6.8
  // deviation comment documents: "an observer hook, a report callback" throwing after a good plan
  // exists). `emptyLedgerRecord` is still called unconditionally for the retry inside
  // `terminalInternalError`, so this reproduces H1 independently of the "broken plan" framing above.
  const fx = realPlannerFixture({ failSeal: 'sealResultSet' });
  const { handle, begin } = createRun(fx.spec);
  begin();
  const summary = await handle.done;
  assert.equal(summary.status, 'failed');
  assert.notEqual(summary.resultSet, null, 'the R10 retry still produces a readable set over a healthy plan');
  assert.ok(summary.resultSet.outcome.reasons.includes('unit:internal-error'));
  assert.ok(summary.resultSet.provenance.models.length > 0,
    'unlike the broken-plan scenario, provenance still carries the real, healthy plan-time model rows');
  assert.equal(summary.resultSet.ledger.planExists, false,
    'the fallback ledger holds none of those real plan facts, so it must not claim a plan exists');
  assert.deepEqual(issuesOf(summary.resultSet), [],
    'validates cleanly — no coverage-model-mismatch, no model-not-in-provenance, no other issue');
  const claim = assessNoClashClaim(summary.resultSet, { state: 'current', reasons: [] });
  assert.equal(claim.allowed, false, 'a failed run can never support a no-clash claim');
  assert.equal(canClaimNoClashes(summary.resultSet, { state: 'current', reasons: [] }), false);
});

// --- P6 whole-branch review C2: an out-of-vocabulary failure.code must never merge as clean -------
test('C2: a self-reported non-evaluated outcome whose failure.code is not a table-A fact seals failed:internal-error', async () => {
  for (const code of ['cancelled', 'run-failed']) {
    for (const [kind, scopeProof] of [['failed', 'equal'], ['failed', 'not-checked'], ['skipped', 'not-checked'], ['discarded', 'equal']]) {
      const label = `${kind}/${scopeProof}/${code}`;
      const fx = realPlannerFixture({
        executor: createScriptedExecutor({ '1.0': [{
          outcome: kind, scopeProof, failure: { code, message: 'executor says so', retryable: false },
          pairs: [{ source: { modelKey: 'mk-a', dbId: 1 }, target: { modelKey: 'mk-b', dbId: 7 },
            type: 'volume-overlap', witness: null }],
        }] }),
      });
      const { handle, begin } = createRun(fx.spec);
      begin();
      const summary = await handle.done;
      assert.equal(fx.substitutedOutcomes.length, 0, `${label}: the outcome VALIDATED (structurally legal)`);
      const [unit] = summary.resultSet.ledger.units;
      assert.equal(`${unit.outcome}:${unit.cause}`, 'failed:internal-error', label);
      assert.equal(summary.status, 'failed', `${label}: never completed`);
      assert.ok(summary.resultSet.outcome.reasons.includes('unit:internal-error'), label);
      assert.deepEqual(summary.resultSet.results, [], `${label}: nothing merged`);
      assert.equal(summary.resultSet.outcome.coverage, 'partial', label);
      assert.deepEqual(issuesOf(summary.resultSet), [], label);
    }
  }
});

test('C2 guard does not misfire: every legitimate non-evaluated outcome keeps its own table-A cause', async () => {
  const rows = [
    [{ facts: ['capacity-exceeded'], capacityKind: 'bucket-capacity' }, 'failed:capacity-exceeded', 'completed'],
    [{ facts: ['scope-unverifiable'] }, 'discarded:scope-unverifiable', 'completed'],
    [{ facts: ['scope-drift'] }, 'discarded:scope-drift', 'invalidated'],
    // `cancelled` code, but a drift scope proof: the drift fact is collected, so the guard stays out.
    [{ outcome: 'discarded', scopeProof: 'drift', failure: { code: 'cancelled', message: 'x', retryable: false } },
      'discarded:scope-drift', 'invalidated'],
    [{ facts: [] }, 'evaluated:null', 'completed'],
  ];
  for (const [descriptor, expected, status] of rows) {
    const fx = realPlannerFixture({ executor: createScriptedExecutor({ '1.0': [descriptor] }) });
    const { handle, begin } = createRun(fx.spec);
    begin();
    const summary = await handle.done;
    const [unit] = summary.resultSet.ledger.units;
    assert.equal(`${unit.outcome}:${unit.cause}`, expected, expected);
    assert.equal(summary.status, status, expected);
    assert.ok(!summary.resultSet.outcome.reasons.includes('unit:internal-error'), expected);
  }
});

// --- P6 whole-branch review I2: results and the record that justifies them are one commit --------
test('I2: a diagnostic aggregator or statistics accumulator that throws AFTER the merge still seals a readable set', async () => {
  const pair = { source: { modelKey: 'mk-a', dbId: 1 }, target: { modelKey: 'mk-b', dbId: 7 },
    type: 'volume-overlap', witness: null };
  for (const which of ['diagnosticAggregator', 'diagnosticAggregator-after-mutating', 'statisticsAccumulator']) {
    const fx = realPlannerFixture({
      runOptions: { maxSourceDbIdsPerUnit: 1 },
      executor: createScriptedExecutor({ '1.0': [{ facts: [], pairs: [pair],
        diagnostics: [{ reason: 'fragment-not-loaded', dbId: 1 }] }] }),
    });
    const real = fx.spec.diagnosticAggregator;
    const spec = which.startsWith('diagnosticAggregator')
      ? { ...fx.spec, diagnosticAggregator: { ...real,
          // `-after-mutating`: the aggregator ABSORBS the unit, then throws (the partial-sidecar
          // residual documented in `applyUnitResult`); the set must still be readable.
          addUnit: async (unitId, outcome) => {
            if (which.endsWith('after-mutating')) await real.addUnit(unitId, outcome);
            throw new Error('aggregator exploded');
          },
          snapshot: () => real.snapshot() } }
      : { ...fx.spec, statisticsAccumulator: { ...fx.spec.statisticsAccumulator,
          add: () => { throw new Error('statistics exploded'); },
          snapshot: () => fx.spec.statisticsAccumulator.snapshot() } };
    const { handle, begin } = createRun(spec);
    begin();
    const summary = await handle.done;
    assert.equal(summary.status, 'failed', which);
    assert.ok(summary.resultSet.outcome.reasons.includes('unit:internal-error'), which);
    assert.equal(summary.resultSet.results.length, 1, `${which}: the merged result is kept`);
    assert.deepEqual(summary.resultSet.ledger.units.map((u) => `${u.unitId}:${u.outcome}:${u.cause}`),
      ['1.0:evaluated:null', '1.1:not-run:run-failed', '1.2:not-run:run-failed'],
      `${which}: the merged unit keeps its evaluated record; only never-merged units are swept`);
    assert.deepEqual(issuesOf(summary.resultSet), [], `${which}: no result-unit-invalid (or any other) issue`);
    const snap = handle.getSnapshot();
    assert.equal(snap.unitsEvaluated + snap.unitsFailedOrSkipped, snap.unitsTotal, `${which}: every unit counted once`);
    assert.equal(snap.pairSpaceProcessed, snap.pairSpaceTotal, `${which}: processed = evaluated + gaps`);
  }
});

// --- Task P6.8: sealing, the done/persisted window, the cancellation matrix and dispose (brief Step 1) ---
// appended to test/clashtest/run/lifecycle.test.mjs
test('cancel BETWEEN units: no unit starts after the request; unstarted units are not-run:cancelled', async () => {
  const fx = createRunFixture({
    plan: createFakePlan([{ unitId: '1.0', weight: 1 }, { unitId: '1.1', weight: 1 }, { unitId: '1.2', weight: 1 }]),
    executor: createScriptedExecutor({ '1.0': [{ facts: [] }], '1.1': [{ facts: [] }], '1.2': [{ facts: [] }] }),
  });
  const { handle, begin } = createRun(fx.spec);
  begin();
  await fx.afterUnit('1.0', () => handle.cancel('user'));
  const summary = await handle.done;
  assert.equal(summary.status, 'cancelled');
  assert.deepEqual(fx.executor.startedUnits, ['1.0']);
  assert.equal(summary.resultSet.ledger.units[0].outcome, 'evaluated');
  assert.deepEqual(summary.resultSet.ledger.units.slice(1).map((u) => `${u.outcome}:${u.cause}`),
    ['not-run:cancelled', 'not-run:cancelled']);
  assert.equal(summary.resultSet.outcome.coverage, 'partial');
  assert.deepEqual(fx.world.destructiveCalls, [], 'cancel never evicts, disposes or invalidates');
});

test('cancel DURING an in-flight unit: the unit is DRAINED and merged', async () => {
  const fx = createRunFixture({
    plan: createFakePlan([{ unitId: '1.0', weight: 1 }, { unitId: '1.1', weight: 1 }]),
    executor: createScriptedExecutor({ '1.0': [{ facts: [], pairs: 3, hold: true }], '1.1': [{ facts: [] }] }),
  });
  const { handle, begin } = createRun(fx.spec);
  begin();
  await fx.executor.inFlight('1.0');
  const cancelPromise = handle.cancel('user');
  assert.equal(handle.getSnapshot().status, 'cancelling');
  fx.executor.release('1.0');
  const summary = await cancelPromise;
  assert.equal(summary.status, 'cancelled');
  assert.equal(summary.resultSet.results.length, 3, 'the drained unit IS merged');
  assert.deepEqual(fx.executor.startedUnits, ['1.0']);
});

test('cancel is idempotent, first reason wins, and terminal cancel is a no-op', async () => {
  const fx = createRunFixture({ plan: createFakePlan([{ unitId: '1.0', weight: 1 }]),
    executor: createScriptedExecutor({ '1.0': [{ facts: [] }] }) });
  const { handle, begin } = createRun(fx.spec);
  begin();
  const first = handle.cancel('first');
  const second = handle.cancel('second');
  const a = await first; const b = await second;
  assert.equal(a, b, 'the same summary object');
  assert.ok(a.resultSet.outcome.reasons.includes('cancel-requested'));
  assert.equal((await handle.cancel('third')), a);
});

test('matrix C: an in-flight unit settling under a pending cancel follows the fixed order', async () => {
  const rows = [
    { facts: [], merges: true, unit: 'evaluated', status: 'cancelled' },
    { facts: ['capacity-exceeded'], merges: false, unit: 'failed', status: 'cancelled' },
    { facts: ['scope-unverifiable'], merges: false, unit: 'discarded', status: 'cancelled' },
    { facts: ['model-evicted'], merges: false, unit: 'failed', status: 'cancelled' },
    { facts: ['scope-drift'], merges: false, unit: 'discarded', status: 'invalidated' },
    { facts: ['input-changed'], merges: false, unit: 'discarded', status: 'invalidated' },
    { facts: ['result-cap'], merges: false, unit: 'failed', status: 'failed' },
    { facts: ['internal-error'], merges: false, unit: 'failed', status: 'failed' },
    { facts: ['world-disposed'], merges: false, unit: 'failed', status: 'failed' },
  ];
  for (const requester of ['cancel', 'dispose']) {
    for (const row of rows) {
      const fx = createRunFixture({
        plan: createFakePlan([{ unitId: '1.0', weight: 1 }]),
        executor: createScriptedExecutor({ '1.0': [{ facts: row.facts, pairs: 2, hold: true }] }),
      });
      const { handle, controller, begin } = createRun(fx.spec);
      begin();
      await fx.executor.inFlight('1.0');
      // C3: dispose reaches the run through the ENGINE-ONLY controller, never through the handle.
      if (requester === 'cancel') handle.cancel('user'); else fx.requestDispose(controller);
      fx.executor.release('1.0');
      const summary = await handle.done;
      const label = `${requester} + ${row.facts.join('+') || 'evaluated'}`;
      assert.equal(summary.status, row.status, label);
      assert.equal(summary.resultSet.ledger.units[0].outcome, row.unit, label);
      assert.equal(summary.resultSet.results.length, row.merges ? 2 : 0, label);
      assert.ok(summary.resultSet.outcome.reasons.includes(
        requester === 'cancel' ? 'cancel-requested' : 'engine-disposed'), label);
    }
  }
});

/** Every ordering of a fact list — the fake executor delivers the facts in each of them. */
function* permutations(items) {
  if (items.length <= 1) { yield [...items]; return; }
  for (let i = 0; i < items.length; i += 1) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const tail of permutations(rest)) yield [items[i], ...tail];
  }
}

test('the same facts, however the fixture scripts their delivery order, still seal a byte-identical Result Set', async () => {
  // SCOPE (P6.8 task review, Finding 2): this proves the RUN PIPELINE is deterministic end to end
  // for one fact set — executor, live registry scan, ledger, seal and digests — across every scripted
  // delivery order. It does NOT by itself prove §16.7 / AC-21 order-independence of the classifier:
  // `factsFromOutcome` assembles the facts in a FIXED order (scope proof, failure code, live scan,
  // world), so the scripted order never reaches `classifyUnitSettlement` in a different order (the
  // six permutations collapse to two distinguishable fixture schedules: model death early or late in
  // the call). `classifyUnitSettlement`'s order-independence over the raw fact SET is verified in
  // `settlement.test.mjs` — 'every PAIR resolves order-independently…' and 'secondaryCauses is
  // distinct, ascending, and capped at 8'.
  const facts = ['model-evicted', 'scope-unverifiable', 'world-disposed'];
  const seals = [];
  for (const order of permutations(facts)) {
    // P6.8 DEVIATION from the brief's literal text (reported): the brief cancelled in the same slice
    // as `begin()`, which the run observes BEFORE resolution (the `resolveStage` race / its post-race
    // check) and seals the §13.1 pre-resolution shape with NO unit — `ledger.units[0]` is then
    // `undefined` and the test cannot assert anything about the unit's facts. The cancel is issued
    // while the unit is in flight instead, so the unit settles its facts under a pending cancel.
    const fx = createRunFixture({
      plan: createFakePlan([{ unitId: '1.0', weight: 1 }]),
      executor: createScriptedExecutor({ '1.0': [{ facts: order, shuffleFacts: true, hold: true }] }),
    });
    const { handle, begin } = createRun(fx.spec);
    begin();
    await fx.executor.inFlight('1.0');
    handle.cancel('user');
    fx.executor.release('1.0');
    seals.push((await handle.done).resultSet);
  }
  for (const set of seals) {
    assert.equal(set.outcome.status, seals[0].outcome.status);
    assert.equal(set.ledger.units[0].cause, seals[0].ledger.units[0].cause);
    // R4: the tie-break makes even the secondary list order-independent, so this is a stronger
    // assertion than "the digest ignores it" — and it is the property AC-21 actually needs.
    assert.deepEqual(set.ledger.units[0].secondaryCauses, seals[0].ledger.units[0].secondaryCauses);
    assert.equal(set.digests.ledgerDigest, seals[0].digests.ledgerDigest);
    assert.equal(set.digests.pairSetDigest, seals[0].digests.pairSetDigest);
  }
});

test('done resolves at first persistence settle, exactly once, never rejecting', async () => {
  const fx = createRunFixture({ plan: createFakePlan([{ unitId: '1.0', weight: 1 }]),
    executor: createScriptedExecutor({ '1.0': [{ facts: [] }] }),
    // A15: the store is bound into P5's residency manager, not carried on the RunSpec.
    resultStore: { put: async () => { throw new Error('backend exploded'); } } });
  const { handle, begin } = createRun(fx.spec);
  begin();
  const summary = await handle.done;                       // resolves, does NOT reject
  assert.equal(summary.status, 'completed');
  assert.equal(summary.persistence.state, 'failed');
  assert.equal(summary.persistence.timedOut, false);
  assert.deepEqual(await handle.persisted, { state: 'failed', error: summary.persistence.error });
  assert.equal(await handle.done, summary, 'settles exactly once');
  assert.deepEqual(fx.residency.beginPersistCalls, [{ runId: handle.runId, persist: true }],
    'the attempt is driven through residency.beginPersist, never a free startPersistence');
});

test('R10: a failure while BUILDING or SEALING the set still settles done, exactly once', async () => {
  for (const failAt of ['buildResultSet', 'sealResultSet', 'admitSealedSet']) {
    const fx = createRunFixture({
      plan: createFakePlan([{ unitId: '1.0', weight: 1 }]),
      executor: createScriptedExecutor({ '1.0': [{ facts: [] }] }),
      failSeal: failAt,                                    // the fixture throws from that P5 call
    });
    const { handle, begin } = createRun(fx.spec);
    begin();
    const summary = await handle.done;                     // must NOT hang and must NOT reject
    assert.equal(summary.status, 'failed', failAt);
    assert.ok(summary.resultSet === null || summary.resultSet.outcome.status === 'failed', failAt);
    assert.ok(summary.resultSet === null
      || summary.resultSet.outcome.reasons.includes('unit:internal-error'), failAt);
    assert.equal(await handle.done, summary, 'still exactly once');
    assert.equal(handle.getSnapshot().status, 'failed');
    assert.equal(handle.getSnapshot().phase, 'terminal');
    // R10: the slot is freed on every path that ends without an admitted set.
    const admitted = fx.residency.admitted.includes(handle.runId);
    assert.equal(admitted || fx.residency.released.includes(handle.runId), true, failAt);
  }
});

test('R10: a build failure does not leave a half-sealed run that a later cancel can re-seal', async () => {
  const fx = createRunFixture({
    plan: createFakePlan([{ unitId: '1.0', weight: 1 }]),
    executor: createScriptedExecutor({ '1.0': [{ facts: [] }] }),
    failSeal: 'sealResultSet',
  });
  const { handle, begin } = createRun(fx.spec);
  begin();
  const first = await handle.done;
  const second = await handle.cancel('too late');
  assert.equal(second, first, 'terminal is absorbing even after a seal failure');
  assert.equal(fx.residency.released.filter((id) => id === handle.runId).length <= 1, true,
    'the slot is released at most once');
});

test('a hanging store times out the WAIT, never the write; persisted still settles later', async () => {
  let settle;
  const fx = createRunFixture({
    plan: createFakePlan([{ unitId: '1.0', weight: 1 }]),
    executor: createScriptedExecutor({ '1.0': [{ facts: [] }] }),
    limits: { persistTimeoutMs: 5000 },
    resultStore: { put: () => new Promise((r) => { settle = r; }) },
  });
  const { handle, begin } = createRun(fx.spec);
  begin();
  await fx.sealed();
  assert.equal(handle.getSnapshot().phase, 'finalizing');
  assert.equal(handle.getSnapshot().status, 'completed');
  fx.clock.advance(5000); await fx.clock.drainTimers();
  const summary = await handle.done;
  assert.deepEqual(
    { state: summary.persistence.state, timedOut: summary.persistence.timedOut },
    { state: 'pending', timedOut: true },
  );
  assert.equal(handle.getSnapshot().phase, 'terminal');
  settle();
  assert.deepEqual(await handle.persisted, { state: 'saved' });
});

test('the terminal state event is emitted EXACTLY ONCE, after seal, before done resolves', async () => {
  const fx = createRunFixture({ plan: createFakePlan([{ unitId: '1.0', weight: 1 }]),
    executor: createScriptedExecutor({ '1.0': [{ facts: [] }] }) });
  const { handle, begin } = createRun(fx.spec);
  const order = [];
  handle.subscribe((ev) => { if (ev.type === 'state' && ev.terminal) order.push('terminal-event'); });
  handle.done.then(() => order.push('done'));
  begin();
  await handle.done; await Promise.resolve();
  assert.deepEqual(order, ['terminal-event', 'done']);
});

test('environmentSensitiveCauses is ascending, exact, and drives the boolean', async () => {
  const fx = createRunFixture({
    plan: createFakePlan([{ unitId: '1.0', weight: 1 }, { unitId: '1.1', weight: 1 }]),
    runOptions: { maxPlacementRetries: 0 },
    executor: createScriptedExecutor({
      '1.0': [{ facts: ['capacity-exceeded'], capacityKind: 'bucket-capacity' }],
      // C1: with `maxPlacementRetries: 0` the first attempt IS the last, so P4's retryable
      // `stale-placement` outcome settles immediately as the `failed:stale-placement` gap that
      // P5 derives the environmental cause from. P6 writes no `placement-contention` anywhere.
      '1.1': [{ outcome: 'failed', failure: { code: 'stale-placement', retryable: true } }],
    }),
  });
  const { handle, begin } = createRun(fx.spec);
  begin();
  const summary = await handle.done;
  assert.deepEqual(summary.resultSet.ledger.units.map((u) => u.cause),
    ['capacity-exceeded', 'stale-placement'], 'the LEDGER carries the unit causes …');
  assert.deepEqual(summary.resultSet.outcome.environmentSensitiveCauses,
    ['bucket-capacity', 'placement-contention'], '… and P5 derives the environmental causes');
  assert.equal(summary.resultSet.outcome.environmentSensitive, true);
});

test('dispose forces the finalizing window closed and reports the in-flight write, never dropping the set', async () => {
  const fx = createRunFixture({
    plan: createFakePlan([{ unitId: '1.0', weight: 1 }]),
    executor: createScriptedExecutor({ '1.0': [{ facts: [], hold: true }] }),
    resultStore: { put: () => new Promise(() => {}) },        // never settles
  });
  const { handle, controller, begin } = createRun(fx.spec);
  begin();
  await fx.executor.inFlight('1.0');
  const disposeSummary = fx.requestDispose(controller);
  fx.executor.release('1.0');                                 // drain, then seal
  const summary = await handle.done;                          // forced closed, NOT after 5s
  assert.equal(summary.status, 'cancelled');
  assert.deepEqual(
    { state: summary.persistence.state, timedOut: summary.persistence.timedOut },
    { state: 'pending', timedOut: true },
  );
  const disposed = await disposeSummary;
  // P6.8 DEVIATION from the brief's literal text (reported): the brief expected the run in BOTH
  // `droppedUnsaved` and `persistenceInFlight`. P5's real `drainForDispose` (A14) reports a set
  // whose write is still in flight in `persistenceInFlight` ONLY — the write continues detached and
  // may still save it — and §10.2 / AC-16 say the same ("in `droppedUnsaved`, OR in
  // `persistenceInFlight` if a write is pending"). The set is sealed and accounted for either way.
  assert.deepEqual(disposed.droppedUnsaved, []);
  assert.deepEqual(disposed.persistenceInFlight, [handle.runId]);
  assert.equal(summary.resultSet.sealed, true);
  assert.equal(fx.emitter.listenerReleaseOrder[0], 'terminal-event',
    'no listener is released before the terminal event');
});

test('C3: the dispose control surface is engine-only and NOT reachable from RunHandle', async () => {
  const fx = createRunFixture({ plan: createFakePlan([{ unitId: '1.0', weight: 1 }]),
    executor: createScriptedExecutor({ '1.0': [{ facts: [] }] }) });
  const { handle, controller } = createRun(fx.spec);
  assert.deepEqual(Object.keys(handle).sort(),
    ['cancel', 'done', 'getSnapshot', 'persisted', 'runId', 'subscribe'],
    'exactly the §18 members');
  assert.equal(Reflect.ownKeys(handle).includes('requestDispose'), false,
    'not there even as a non-enumerable property');
  assert.equal(handle.requestDispose, undefined);
  assert.equal(typeof controller.requestDispose, 'function');
  assert.equal(Object.isFrozen(handle) && Object.isFrozen(controller), true);
});

test('C3: requestDispose settles a run whose executor is BLOCKED, once the unit drains', async () => {
  // The review's scenario: an engine disposing while a unit is in flight and persistence never
  // settles. Without the controller the run never learns `disposeRequested`, never stops issuing
  // the remaining units, and `dispose()` waits for `persistTimeoutMs` — or forever, if the store
  // hangs and nothing forces the window.
  const fx = createRunFixture({
    plan: createFakePlan([{ unitId: '1.0', weight: 1 }, { unitId: '1.1', weight: 1 }]),
    executor: createScriptedExecutor({ '1.0': [{ facts: [], hold: true }], '1.1': [{ facts: [] }] }),
    resultStore: { put: () => new Promise(() => {}) },        // never settles
  });
  const { handle, controller, begin } = createRun(fx.spec);
  begin();
  await fx.executor.inFlight('1.0');
  const disposed = controller.requestDispose();
  assert.equal(await Promise.race([disposed, Promise.resolve('pending')]), 'pending',
    'an in-flight unit is DRAINED, never abandoned (§10.1, F6)');
  fx.executor.release('1.0');
  const summary = await disposed;
  assert.equal(summary, await handle.done, 'the controller resolves with the run\'s own summary');
  assert.equal(summary.status, 'cancelled');
  assert.ok(summary.resultSet.outcome.reasons.includes('engine-disposed'));
  assert.deepEqual(fx.executor.startedUnits, ['1.0'], 'no unit started after the dispose');
  assert.deepEqual(
    { state: summary.persistence.state, timedOut: summary.persistence.timedOut },
    { state: 'pending', timedOut: true }, 'the window was FORCED, not timed out by the clock');
  assert.equal(fx.clock.now(), fx.clock.peek(), 'and no timer had to fire to get there');
  assert.equal(await controller.requestDispose(), summary, 'idempotent');
});

test('C3: a dispose that lands DURING the seal still closes the window', async () => {
  // The interval the review names: `sealStarted` is true, `forceFinalize` does not exist yet.
  const fx = createRunFixture({
    plan: createFakePlan([{ unitId: '1.0', weight: 1 }]),
    executor: createScriptedExecutor({ '1.0': [{ facts: [] }] }),
    resultStore: { put: () => new Promise(() => {}) },
    holdAt: 'sealResultSet',                                  // the fixture parks inside the seal
  });
  const { handle, controller, begin } = createRun(fx.spec);
  begin();
  await fx.reached('sealing');
  const disposed = controller.requestDispose();
  fx.release('sealResultSet');
  const summary = await disposed;
  assert.equal(summary.status, 'completed', 'the seal had already decided the status');
  assert.deepEqual(
    { state: summary.persistence.state, timedOut: summary.persistence.timedOut },
    { state: 'pending', timedOut: true }, 'the window closed at once, not after persistTimeoutMs');
  assert.equal(await handle.done, summary);
  assert.equal(handle.getSnapshot().phase, 'terminal');
});

test('I8: an admitSealedSet that throws BEFORE mutating releases the slot exactly once', async () => {
  const fx = createRunFixture({
    plan: createFakePlan([{ unitId: '1.0', weight: 1 }]),
    executor: createScriptedExecutor({ '1.0': [{ facts: [] }] }),
    admitSealedSet: 'throws-before',        // fake residency: throws, getResident stays null
  });
  const { handle, begin } = createRun(fx.spec);
  begin();
  const summary = await handle.done;
  assert.equal(summary.status, 'failed');
  assert.deepEqual(fx.residency.released.filter((id) => id === handle.runId).length, 1,
    'released once — never leaked, never double-freed');
  assert.deepEqual(fx.residency.admitted, [], 'nothing was admitted under this id');
  assert.equal(summary.resultSet, null, 'O7: the fallback could not admit either');
});

test('I8: an admitSealedSet that throws AFTER converting keeps the resident set and releases nothing', async () => {
  // Residency converted the reservation and then an observer callback threw. Releasing here would
  // free a live resident set; re-admitting a fallback set under the same id would be a second
  // admission. P6 asks `getResident(runId)` and adopts the answer.
  const fx = createRunFixture({
    plan: createFakePlan([{ unitId: '1.0', weight: 1 }]),
    executor: createScriptedExecutor({ '1.0': [{ facts: [] }] }),
    admitSealedSet: 'throws-after',        // converts, then throws from an observer
  });
  const { handle, begin } = createRun(fx.spec);
  begin();
  const summary = await handle.done;
  assert.equal(summary.status, 'failed');
  assert.deepEqual(fx.residency.released, [], 'the converted slot is NEVER released here');
  assert.deepEqual(fx.residency.admitted, [handle.runId], 'admitted exactly once');
  assert.equal(summary.resultSet, fx.residency.getResident(handle.runId),
    'the summary carries the set residency actually holds');
  assert.equal(summary.resultSet.sealed, true);
  assert.equal(await handle.done, summary, 'still settles exactly once');
});

test('I9: a listener on the terminal event already sees the terminal snapshot', async () => {
  for (const failSeal of [undefined, 'sealResultSet']) {      // normal close AND the R10 fallback
    const fx = createRunFixture({
      plan: createFakePlan([{ unitId: '1.0', weight: 1 }]),
      executor: createScriptedExecutor({ '1.0': [{ facts: [] }] }),
      failSeal,
    });
    const { handle, begin } = createRun(fx.spec);
    const seen = [];
    handle.subscribe((ev) => {
      if (ev.type === 'state' && ev.terminal) seen.push({ ev, snap: handle.getSnapshot() });
    });
    begin();
    const summary = await handle.done;
    assert.equal(seen.length, 1, `${failSeal ?? 'normal'}: exactly one terminal event`);
    const [{ ev, snap }] = seen;
    assert.equal(snap.phase, 'terminal',
      `${failSeal ?? 'normal'}: a UI reading the snapshot from the event must not see 'finalizing'`);
    assert.equal(snap.status, summary.status);
    assert.equal(ev.status, snap.status, 'the event and the committed snapshot agree');
    assert.equal(Object.hasOwn(snap, 'persistence'), false,
      '§9.1 RunProgress is a closed shape: persistence rides on the event and the summary');
    assert.deepEqual(ev.persistence, summary.persistence,
      'the final persistence state is announced with the terminal event');
    assert.equal(snap.seq, ev.seq, 'the commit IS the state change the event reports');
  }
});

// --- P6.8 fix (task review, Finding 1 / controller Ruling A after P6.5): `pairs-over-cap` ---
test('a unit whose outcome exceeds maxPairsPerOutcome seals failed:result-cap, merging nothing (§17.1)', async () => {
  // P4's `validateUnitOutcome` rejects an outcome with more than `maxPairsPerOutcome` pairs with the
  // issue code `pairs-over-cap`. That is the per-outcome result cap (§17.1), not an executor defect:
  // the unit must seal `failed:result-cap` — the same settlement the accumulator's whole-unit
  // `maxResultsPerRun` refusal produces — and never `failed:internal-error`.
  const fx = createRunFixture({
    plan: createFakePlan([{ unitId: '1.0', weight: 1 }, { unitId: '1.1', weight: 1 }]),
    runOptions: { maxResultsPerRun: 10, maxPairsPerOutcome: 2 },
    executor: createScriptedExecutor({
      '1.0': [{ facts: [], pairs: 1 }],                                    // within the cap: merges
      '1.1': [{ facts: [], pairs: 3,                                       // over it: refused whole
               diagnostics: [{ reason: 'fragment-not-loaded', dbId: 7 }],
               statistics: { broadPhasePairs: 40 } }],
    }),
  });
  const { handle, begin } = createRun(fx.spec);
  begin();
  const summary = await handle.done;
  const refused = summary.resultSet.ledger.units.find((u) => u.unitId === '1.1');
  assert.equal(`${refused.outcome}:${refused.cause}`, 'failed:result-cap');
  assert.equal(summary.status, 'failed', '§16.7: result-cap is a failing unit cause');
  assert.ok(summary.resultSet.outcome.reasons.includes('unit:result-cap'));
  assert.ok(!summary.resultSet.outcome.reasons.includes('unit:internal-error'), 'not an executor defect');
  // Whole-unit refusal, the same atomicity the accumulator's own result-cap refusal guarantees.
  assert.equal(summary.resultSet.results.length, 1, 'only the within-cap unit merged');
  assert.deepEqual(fx.diagnosticAggregator.addUnitCalls, ['1.0'], 'the refused unit\'s diagnostics never merged');
  assert.equal(fx.statisticsAccumulator.addCalls.length, 1, 'nor its statistics');
  assert.deepEqual(refused.taints, [], 'nor any taint');
  const snap = handle.getSnapshot();
  assert.equal(snap.unitsEvaluated, 1);
  assert.equal(snap.unitsFailedOrSkipped, 1);
  assert.equal(snap.resultsFound, 1);
  assert.equal(snap.pairSpaceProcessed, 2, 'a gap is still processed');
});

// --- P6.8 fix round 2 (re-review, Critical): the pairsOverflowLength MARKER is the result cap too ---
test('an evaluated outcome carrying the pairsOverflowLength marker seals failed:result-cap, never a false clean', async () => {
  // Spec §7.1/§17.1 (design line 470): over-cap is "whether `pairs.length` exceeds it OR the executor
  // reports `pairsOverflowLength > limits.maxPairsPerOutcome` with `pairs: []`" — a whole-unit
  // `failed:result-cap`. P4's real `LocalUnitExecutor.projectPairs` ALWAYS uses this marker form
  // (it never returns an oversized array), and the marker VALIDATES (`valid.ok === true`), so without
  // this rule every real over-cap unit sealed `evaluated` / `completed` / `reasons: []` — a false
  // "no clashes here".
  const fx = createRunFixture({
    plan: createFakePlan([{ unitId: '1.0', weight: 1 }, { unitId: '1.1', weight: 1 }]),
    runOptions: { maxResultsPerRun: 10, maxPairsPerOutcome: 2 },
    executor: createScriptedExecutor({
      '1.0': [{ facts: [], pairs: 1 }],                                    // within the cap: merges
      '1.1': [{ pairsOverflowLength: 500,                                  // the real marker form
               diagnostics: [{ reason: 'fragment-not-loaded', dbId: 7 }],
               statistics: { broadPhasePairs: 40 } }],
    }),
  });
  const { handle, begin } = createRun(fx.spec);
  begin();
  const summary = await handle.done;
  assert.equal(fx.substitutedOutcomes.length, 0, 'the marker outcome VALIDATED: this is not the pairs-over-cap issue path');
  const refused = summary.resultSet.ledger.units.find((u) => u.unitId === '1.1');
  assert.equal(`${refused.outcome}:${refused.cause}`, 'failed:result-cap');
  assert.equal(summary.status, 'failed', '§16.7: result-cap is a failing unit cause');
  assert.ok(summary.resultSet.outcome.reasons.includes('unit:result-cap'));
  assert.equal(summary.resultSet.outcome.coverage, 'partial');
  // Whole-unit refusal: nothing of the refused unit merged, on any channel.
  assert.equal(summary.resultSet.results.length, 1, 'only the within-cap unit merged');
  assert.deepEqual(fx.diagnosticAggregator.addUnitCalls, ['1.0']);
  assert.equal(fx.statisticsAccumulator.addCalls.length, 1);
  assert.deepEqual(refused.taints, []);
  const snap = handle.getSnapshot();
  assert.equal(snap.unitsEvaluated, 1);
  assert.equal(snap.unitsFailedOrSkipped, 1);
  assert.equal(snap.pairSpaceProcessed, 2);

  // Negative control: the same plan WITHOUT the marker still seals completed / evaluated / clean.
  const clean = createRunFixture({
    plan: createFakePlan([{ unitId: '1.0', weight: 1 }, { unitId: '1.1', weight: 1 }]),
    runOptions: { maxResultsPerRun: 10, maxPairsPerOutcome: 2 },
    executor: createScriptedExecutor({ '1.0': [{ facts: [], pairs: 1 }], '1.1': [{ facts: [], pairs: 2 }] }),
  });
  const run2 = createRun(clean.spec);
  run2.begin();
  const ok = await run2.handle.done;
  assert.equal(ok.status, 'completed');
  assert.deepEqual(ok.resultSet.ledger.units.map((u) => `${u.outcome}:${u.cause}`), ['evaluated:null', 'evaluated:null']);
  assert.deepEqual(ok.resultSet.outcome.reasons, []);
  assert.equal(ok.resultSet.results.length, 3);
});

// D-B (owner-authorized P6 fix, 2026-09-24). Spec §6.2 owner classes and §11.1 (`flags.unreachableOwner`:
// "an owner of the pair is *unreachable-only*"): P3's `unreachablePopulation[].ownerDbIds` lists EVERY
// owner with a tree-unreachable fragment, MIXED owners included (`mixedOwnerDbIds` is its subset that
// some root also owns). The accumulator's `unreachableOwners` must therefore be ownerDbIds MINUS
// mixedOwnerDbIds -- before the fix a mixed owner's result was flagged `unreachableOwner`, which P5's
// validateResultSet rejects ('unreachable-flag-invalid') and which feeds pairSetDigest.
test('D-B: the accumulator ctx classifies owners from plan data: unreachable-only excludes mixed owners (spec §6.2, §11.1)', async () => {
  const fx = createRunFixture({ plan: createFakePlan([{ unitId: '1.0', weight: 1 }]) });
  const planRun = fx.spec.plannerPort.planRun;
  fx.spec.plannerPort.planRun = async (args) => {
    args.ledger.recordPlanning({ unreachablePopulation: [
      // 900 mixed, 950 unreachable-only
      { modelKey: 'mk-a', count: 3, ownerDbIds: [900, 950], mixedOwnerDbIds: [900], unattributable: { notLoaded: 0, ownerUnresolvable: 0 } },
      // every unreachable owner is mixed: no unreachable-only owner at all for this model
      { modelKey: 'mk-b', count: 1, ownerDbIds: [700], mixedOwnerDbIds: [700], unattributable: { notLoaded: 0, ownerUnresolvable: 0 } },
      // unattributable only: no owners of either class
      { modelKey: 'mk-c', count: 0, ownerDbIds: [], mixedOwnerDbIds: [], unattributable: { notLoaded: 2, ownerUnresolvable: 0 } },
    ] });
    return planRun(args);
  };
  const { handle, begin } = createRun(fx.spec);
  begin();
  await handle.done;
  const ctx = fx.resultPort.lastAccumulatorCtx;
  const plain = (m) => Object.fromEntries([...m].map(([k, s]) => [k, [...s].sort((a, b) => a - b)]));
  assert.deepEqual(plain(ctx.unreachableOwners), { 'mk-a': [950] }, 'unreachable-only owners: mixed 900 and 700 are excluded');
  assert.deepEqual(plain(ctx.mixedOwners), { 'mk-a': [900], 'mk-b': [700] }, 'mixed owners, unchanged');
});

// D-D (owner-authorized P6 fix, 2026-09-24). AC-7: "a cancel during enumeration seals with planning gap
// `cancelled` and no unit ledger ... and the set passes the §13.1/§13.4 schema"; R21-2: the engine never
// seals a set it cannot read. P3's planner checks for cancellation in `checkpoint('plan:built')` BEFORE
// that checkpoint's slicer tick yields, then `commitPlanned`s its unit records into the ledger. A cancel
// landing DURING that final yield was first seen by `planStage` after `planRun` resolved `planned`, and
// sealed the already-committed ledger (units with `outcome: null`, no provenance models) -- a set
// `validateResultSet` rejects. This closes the whole TIMING CLASS, not one index: calibrate how many
// times the run yields before its first unit starts, then cancel at EVERY one of those yields and
// require each sealed set to be the no-unit-ledger `cancelled` shape, validate with ZERO issues, and
// read back through P5's stored-read path (`readResultSet`).
import { readResultSet } from '../../../clashtest/results/validateResultSet.js';
import { createSlicer } from '../../../clashtest/util/slicer.js';

test('D-D: a cancel at EVERY planning yield seals a valid, readable set with no unit ledger (AC-7, R21-2)', async () => {
  const limits = resolveEngineLimits();
  const runWithCancelAt = async (cancelAtYield) => {
    // `aggregationSliceMaxItems: 1` makes EVERY slicer tick a yield (the item ceiling, not the clock),
    // so the loop below visits every point planning can yield at: counted events, never a race.
    const fx = realPlannerFixture({ runOptions: { maxSourceDbIdsPerUnit: 1 }, limits: { aggregationSliceMaxItems: 1 } });
    const { handle, begin } = createRun(fx.spec);
    const box = { yieldsBeforeFirstUnit: null, fired: false };
    const inner = fx.spec.executor;
    fx.spec.executor = (...args) => { box.yieldsBeforeFirstUnit ??= fx.clock.yieldCount; return inner(...args); };
    fx.clock.onYield((n) => {
      if (n !== cancelAtYield) return;
      box.fired = true;
      void handle.cancel('user');                          // never awaited inside the yield
    });
    begin();
    const summary = await handle.done;
    return { fx, summary, box };
  };
  const calibration = await runWithCancelAt(null);
  assert.equal(calibration.summary.status, 'completed', 'premise: the uncancelled run completes');
  const planningYields = calibration.box.yieldsBeforeFirstUnit;
  assert.ok(planningYields >= 3, `premise: planning yields several times (${planningYields})`);

  const readSlicer = () => createSlicer({ now: () => 0, yieldToScheduler: async () => {}, limits });
  for (let k = 1; k <= planningYields; k++) {
    const { fx, summary, box } = await runWithCancelAt(k);
    const set = summary.resultSet;
    assert.ok(box.fired, `yield ${k}: premise: the cancel hook fired`);
    assert.deepEqual(fx.executor.startedUnits, [], `yield ${k}: no unit started`);
    assert.equal(summary.status, 'cancelled', `yield ${k}`);
    assert.equal(set.outcome.coverage, 'partial', `yield ${k}`);
    assert.deepEqual(set.ledger.planningGaps.map((g) => g.cause), ['cancelled'], `yield ${k}`);
    assert.deepEqual(set.ledger.units, [], `yield ${k}: AC-7: no unit ledger`);
    assert.deepEqual(set.results, [], `yield ${k}`);
    assert.deepEqual(issuesOf(set), [], `yield ${k}: validateResultSet accepts it outright`);
    await assert.doesNotReject(readResultSet(structuredClone(set), { limits, slicer: readSlicer() }),
      `yield ${k}: the stored read-back path accepts it`);
  }
});

// D-C (owner-authorized P6 fix, 2026-09-24; owner ruling: PRESERVE AC-21 (ii), fix P6). AC-21 (ii) /
// §16.7 B rule 1: world disposal together with a cancel pending inside a planning slice seals `failed`
// (disposal wins), not `cancelled`. The CollisionWorld surface has no disposal query -- every public
// method throws `WorldDisposedError` once disposed -- so when planning observes a cancel, P6 probes the
// world ONCE with a call it already makes (`getEpochCollisionInstanceCount`, read-only, O(1)) and, on
// `WorldDisposedError`, settles the planning gap `world-disposed` instead of `cancelled`.
import { WorldDisposedError } from '../../../collision/errors.js';

async function cancelInsidePlanningSlice(configureWorld) {
  const fx = createRunFixture({ stallAt: 'enumerating', plan: createFakePlan([{ unitId: '1.0', weight: 5 }]) });
  const { handle, begin } = createRun(fx.spec);
  begin();
  await fx.reached('enumerating');                         // parked in planRun's checkpoint loop
  const probes = { calls: 0 };
  configureWorld(fx.world, probes);                        // after the admission baseline was read
  const summary = await handle.cancel('user');
  return { fx, summary, probes };
}

test('D-C: a disposed world with a cancel pending inside a planning slice seals failed:world-disposed (AC-21 (ii))', async () => {
  const { fx, summary, probes } = await cancelInsidePlanningSlice((world, p) => {
    world.getEpochCollisionInstanceCount = () => { p.calls += 1; throw new WorldDisposedError(); };
  });
  assert.equal(probes.calls, 1, 'premise: the boundary probe ran once');
  assert.equal(summary.status, 'failed', 'disposal outranks the cancel (§16.7 B rule 1)');
  assert.equal(summary.resultSet.outcome.coverage, 'partial');
  assert.deepEqual(summary.resultSet.ledger.planningGaps.map((g) => g.cause), ['world-disposed']);
  assert.deepEqual(summary.resultSet.ledger.units, [], 'planning is abandoned; no unit ledger');
  assert.ok(summary.resultSet.outcome.reasons.includes('planning:world-disposed'), JSON.stringify(summary.resultSet.outcome.reasons));
  assert.ok(summary.resultSet.outcome.reasons.includes('cancel-requested'), 'the cancel is still recorded');
  assert.ok(!summary.resultSet.outcome.reasons.includes('planning:cancelled'));
  assert.deepEqual(fx.executor.startedUnits, []);
  assert.deepEqual(fx.world.destructiveCalls, [], 'P6 never evicts, disposes or invalidates');
});

test('D-C: a LIVE world with a cancel pending inside a planning slice still seals cancelled', async () => {
  const { summary, probes } = await cancelInsidePlanningSlice((world, p) => {
    const read = world.getEpochCollisionInstanceCount.bind(world);
    world.getEpochCollisionInstanceCount = (epoch) => { p.calls += 1; return read(epoch); };
  });
  assert.equal(probes.calls, 1, 'premise: the boundary probe ran once');
  assert.equal(summary.status, 'cancelled');
  assert.deepEqual(summary.resultSet.ledger.planningGaps.map((g) => g.cause), ['cancelled']);
  assert.ok(!summary.resultSet.outcome.reasons.includes('planning:world-disposed'));
});

test('D-C: a probe error OTHER than WorldDisposedError, or a world double without the method, does not misclassify', async () => {
  for (const [label, configure] of [
    ['probe throws TypeError', (world, p) => { world.getEpochCollisionInstanceCount = () => { p.calls += 1; throw new TypeError('boom'); }; }],
    ['probe throws a different named library error', (world, p) => {
      world.getEpochCollisionInstanceCount = () => { p.calls += 1; throw Object.assign(new Error('x'), { name: 'ModelEvictedError' }); };
    }],
    ['method absent on the double', (world) => { delete world.getEpochCollisionInstanceCount; }],
  ]) {
    const { summary } = await cancelInsidePlanningSlice(configure);
    assert.equal(summary.status, 'cancelled', label);
    assert.deepEqual(summary.resultSet.ledger.planningGaps.map((g) => g.cause), ['cancelled'], label);
    assert.ok(!summary.resultSet.outcome.reasons.includes('planning:world-disposed'), label);
  }
});

test('D-C x D-D: a cancel + disposal at the planner\'s FINAL yield seals failed:world-disposed with no unit ledger, valid and readable', async () => {
  const limits = resolveEngineLimits();
  const runAt = async (cancelAtYield, dispose) => {
    const fx = realPlannerFixture({ runOptions: { maxSourceDbIdsPerUnit: 1 }, limits: { aggregationSliceMaxItems: 1 } });
    const { handle, begin } = createRun(fx.spec);
    const box = { yieldsBeforeFirstUnit: null };
    const inner = fx.spec.executor;
    fx.spec.executor = (...args) => { box.yieldsBeforeFirstUnit ??= fx.clock.yieldCount; return inner(...args); };
    fx.clock.onYield((n) => {
      if (n !== cancelAtYield) return;
      if (dispose) fx.world.getEpochCollisionInstanceCount = () => { throw new WorldDisposedError(); };
      void handle.cancel('user');
    });
    begin();
    return { fx, summary: await handle.done, box };
  };
  const last = (await runAt(null, false)).box.yieldsBeforeFirstUnit;   // the plan:built yield (the D-D window)
  const { fx, summary } = await runAt(last, true);
  assert.deepEqual(fx.executor.startedUnits, []);
  assert.equal(summary.status, 'failed');
  assert.deepEqual(summary.resultSet.ledger.planningGaps.map((g) => g.cause), ['world-disposed']);
  assert.deepEqual(summary.resultSet.ledger.units, [], 'no unit ledger');
  assert.ok(summary.resultSet.outcome.reasons.includes('cancel-requested'));
  assert.deepEqual(issuesOf(summary.resultSet), []);
  await assert.doesNotReject(readResultSet(structuredClone(summary.resultSet), {
    limits, slicer: createSlicer({ now: () => 0, yieldToScheduler: async () => {}, limits }),
  }));
});

test('D-C: a planner-REPORTED `cancelled` gap over a disposed world also seals failed; P3\'s own gap stays recorded (Q2)', async () => {
  // Only a planner port can reach this branch (P3's real planner THROWS EnumerationCancelledError);
  // the gap P3 recorded is kept, like every other gap P3 reports (Q2), and the disposal P6 observed
  // is added and decides the status (§16.7 B rule 1).
  const fx = createRunFixture({ plan: null, planningGaps: [{ phase: 'enumerating', cause: 'cancelled' }] });
  fx.world.getEpochCollisionInstanceCount = (() => {
    let reads = 0;                                         // the 1st read is the admission baseline
    return () => { reads += 1; if (reads > 1) throw new WorldDisposedError(); return 1; };
  })();
  const { handle, begin } = createRun(fx.spec);
  begin();
  const summary = await handle.done;
  assert.equal(summary.status, 'failed');
  assert.deepEqual(summary.resultSet.ledger.planningGaps.map((g) => g.cause), ['cancelled', 'world-disposed']);
  assert.ok(summary.resultSet.outcome.reasons.includes('planning:world-disposed'));
  assert.ok(summary.resultSet.outcome.reasons.includes('planning:cancelled'));
});
