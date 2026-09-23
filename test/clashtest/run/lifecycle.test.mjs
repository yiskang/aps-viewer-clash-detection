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

const issuesOf = (set) => validateResultSet(set, { limits: resolveEngineLimits() }).issues;
// The paths the stage-failure fix is about. Other issues on RESOLVED sets are known, separately
// tracked fixture/provenance artefacts (fake semantic digest, fake unit ranges, the plan-derived
// provenance.models columns P6.6/P6.7 project) — see the P6.4 report.
const ledgerShapeIssues = (set) => issuesOf(set)
  .filter((i) => /^\/ledger\/(planningGaps|units\/\d+\/outcome)/.test(i.path));

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
  const fx = createRunFixture({
    plan: createFakePlan([{ unitId: '1.0', weight: 1 }]),
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
  assert.deepEqual(ledgerShapeIssues(summary.resultSet), []);
  assert.deepEqual(fx.executor.startedUnits, []);
});

test('an unexpected error MID-EXECUTION leaves no unsettled (null-outcome) unit in the sealed ledger', async () => {
  const fx = createRunFixture({
    plan: createFakePlan([{ unitId: '1.0', weight: 1 }, { unitId: '1.1', weight: 1 }]),
    specOverrides: { deriveUnitTaints: () => { throw new Error('taint derivation exploded'); } },
  });
  const { handle, begin } = createRun(fx.spec);
  begin();
  const summary = await handle.done;
  assert.equal(summary.status, 'failed');
  assert.ok(summary.resultSet.outcome.reasons.includes('unit:internal-error'));
  assert.deepEqual(summary.resultSet.ledger.units.map((u) => `${u.unitId}:${u.outcome}:${u.cause}`),
    ['1.0:evaluated:null', '1.1:not-run:run-failed'], 'the queued unit is closed as a run-failed gap');
  assert.deepEqual(summary.resultSet.ledger.planningGaps, []);
  assert.deepEqual(ledgerShapeIssues(summary.resultSet), []);
  assert.deepEqual(fx.executor.startedUnits, ['1.0'], 'no unit starts after the failure');
});
