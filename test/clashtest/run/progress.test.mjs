// test/clashtest/run/progress.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEmitter } from '../../../clashtest/run/emitter.js';
import { createFakeClock } from '../support/index.mjs';            // P0 (A18)
import { createRun } from '../../../clashtest/run/Run.js';
import { createFakePlan } from '../support/fakePlanner.mjs';
import { createRunFixture } from '../support/runFixture.mjs';   // wires clock + fakes into createRun
// Not in the brief's Step 1 listing, which uses `createScriptedExecutor` without importing it (P6.4
// convention, same as lifecycle.test.mjs).
import { createScriptedExecutor } from '../support/scriptedExecutor.mjs';

test('progress events are throttled; state, unit and persistence events never are', () => {
  const clock = createFakeClock();
  const e = createEmitter({ now: clock.now, progressMinIntervalMs: 100 });
  const seen = [];
  e.subscribe((ev) => seen.push(`${ev.type}@${clock.now()}`));

  e.emit('progress', { seq: 1 });                    // t=0   -> delivered (first is never throttled)
  clock.advance(40);
  e.emit('progress', { seq: 2 });                    // t=40  -> suppressed
  e.emit('state', { seq: 3, status: 'running' });    // t=40  -> delivered
  e.emit('unit', { seq: 4 });                        // t=40  -> delivered
  clock.advance(61);
  e.emit('progress', { seq: 5 });                    // t=101 -> delivered
  assert.deepEqual(seen, ['progress@0', 'state@40', 'unit@40', 'progress@101']);
});

test('a listener that throws is isolated, counted, and cannot stop other listeners (16.6)', () => {
  const clock = createFakeClock();
  const e = createEmitter({ now: clock.now, progressMinIntervalMs: 0 });
  const seen = [];
  e.subscribe(() => { throw new Error('bad subscriber'); });
  e.subscribe((ev) => seen.push(ev.type));
  assert.doesNotThrow(() => e.emit('state', { seq: 1 }));
  assert.doesNotThrow(() => e.emit('state', { seq: 2 }));
  assert.deepEqual(seen, ['state', 'state']);
  assert.equal(e.listenerErrors, 2);
});

test('a listener that unsubscribes (or subscribes) during delivery does not corrupt the pass', () => {
  const clock = createFakeClock();
  const e = createEmitter({ now: clock.now, progressMinIntervalMs: 0 });
  const seen = [];
  const off = e.subscribe(() => { off(); e.subscribe(() => seen.push('late')); });
  e.subscribe(() => seen.push('stable'));
  e.emit('state', { seq: 1 });
  e.emit('state', { seq: 2 });
  assert.deepEqual(seen, ['stable', 'stable', 'late']);   // the late one joins from the NEXT emit
  assert.equal(e.listenerErrors, 0);
});

test('unsubscribe is idempotent and removes exactly one listener', () => {
  const e = createEmitter({ now: () => 0, progressMinIntervalMs: 0 });
  let n = 0;
  const off = e.subscribe(() => { n += 1; });
  e.subscribe(() => { n += 1; });
  off(); off();
  e.emit('state', { seq: 1 });
  assert.equal(n, 1);
  assert.equal(e.listenerCount, 1);
});

test('a snapshot is never torn: seq only advances at a commit, and repeated reads are identical', async () => {
  const fx = createRunFixture({ plan: createFakePlan([{ unitId: '1.0', weight: 10 }]) });
  const { handle } = createRun(fx.spec);
  const a = handle.getSnapshot();
  const b = handle.getSnapshot();
  assert.deepEqual(a, b);
  assert.equal(a.seq, b.seq);
  assert.equal(a.status, 'queued');
  assert.equal(a.phase, 'queued');
  assert.equal(a.fractionProcessed, null, 'null while pairSpaceTotal is 0');
});

// ================================================================================================
// Task P6.5 — the unit loop: requests, retries, splits, progress growth, main-thread discipline
// (§7.3, §7.5, §9, §17.3). Brief: .superpowers/sdd/p6-run-lifecycle/task-P6.5-brief.md, Step 1.
// ================================================================================================

test('progress never regresses when unitsTotal GROWS through a split', async () => {
  const fx = createRunFixture({
    plan: createFakePlan([{ unitId: '1.0', weight: 100 }, { unitId: '1.1', weight: 100 }]),
    executor: createScriptedExecutor({
      '1.0': [{ facts: ['capacity-exceeded'], capacityKind: 'tlas-candidate-budget' }],
      '1.0.0': [{ facts: [] }],
      '1.0.1': [{ facts: [] }],
      '1.1': [{ facts: [] }],
    }),
    // §6.4 child ids are `${unitId}.0` / `${unitId}.1`, and their weights PARTITION the parent's.
    splits: { '1.0': [{ unitId: '1.0.0', weight: 50 }, { unitId: '1.0.1', weight: 50 }] },
  });
  const { handle, begin } = createRun(fx.spec);
  const seen = [];
  handle.subscribe((ev) => { if (ev.type !== 'persistence') seen.push(handle.getSnapshot()); });
  begin();
  await handle.done;

  const totals = seen.map((s) => s.unitsTotal);
  assert.ok(totals.includes(2) && totals.includes(3), 'unitsTotal grew by one leaf');
  for (let i = 1; i < seen.length; i += 1) {
    for (const key of ['seq', 'unitsEvaluated', 'pairSpaceEvaluated', 'pairSpaceProcessed',
                       'resultsFound', 'caveatCount', 'caveatUnclassified']) {
      assert.ok(seen[i][key] >= seen[i - 1][key], `${key} regressed at ${i}`);
    }
    assert.ok(seen[i].unitsTotal >= seen[i - 1].unitsTotal, 'unitsTotal shrank');
    const f = (s) => (s.fractionProcessed === null ? 0 : s.fractionProcessed);
    assert.ok(f(seen[i]) >= f(seen[i - 1]), 'fractionProcessed regressed');
    assert.equal(seen[i].pairSpaceTotal, 200, 'a split CONSERVES pairSpaceTotal');
  }
  const last = handle.getSnapshot();
  assert.equal(last.fractionProcessed, 1);
  assert.equal(last.fractionEvaluated, 1);
  assert.equal(last.status, 'completed');
});

test('the engine yields between units and never starts two units at once', async () => {
  const fx = createRunFixture({
    plan: createFakePlan([{ unitId: '1.0', weight: 1 }, { unitId: '1.1', weight: 1 }, { unitId: '1.2', weight: 1 }]),
    executor: createScriptedExecutor({ '1.0': [{ facts: [] }], '1.1': [{ facts: [] }], '1.2': [{ facts: [] }] }),
  });
  const { handle, begin } = createRun(fx.spec);
  begin();
  await handle.done;
  assert.equal(fx.executor.maxConcurrent, 1);
  assert.equal(fx.yields.interUnit, 2, 'one yield between each pair of units');
  assert.equal(fx.clock.longestSyncSpanMs <= fx.limits.sliceBudgetMs, true);
});

// --- The placement-retry protocol, driven by P4's ACTUAL outcome shape (re-verification C1) ---
//
// P4's executor never emits a fact called `placement-contention`. `ModelPlacementChangedError`
// with the engine's own generation UNCHANGED is `{outcome:'failed', failure:{code:'stale-placement',
// retryable:true}}`; with the generation CHANGED it is `{outcome:'discarded',
// failure:{code:'input-changed', retryable:false}}` (P4 Task P4.7, `classifyLibraryError`).
// `placement-contention` is the ENVIRONMENTAL cause the *run* records once retries are exhausted
// (spec §7.5, §8.3, §15.1), and P5 derives it from the sealed `failed:stale-placement` unit record
// — P6 never names it as an executor-level fact. Every test below scripts the P4 shape.
const stalePlacement = (retryable = true) => ({
  outcome: 'failed',
  failure: { code: 'stale-placement', retryable, errorName: 'ModelPlacementChangedError' },
});

test('C1: a retryable stale-placement outcome with an UNCHANGED generation re-issues up to the cap', async () => {
  const fx = createRunFixture({
    plan: createFakePlan([{ unitId: '1.0', weight: 1 }]),
    runOptions: { maxPlacementRetries: 2 },
    executor: createScriptedExecutor({
      '1.0': [
        stalePlacement(),
        stalePlacement(),
        { facts: [] },                                     // succeeds on attempt 3
      ],
    }),
  });
  const { handle, begin } = createRun(fx.spec);
  begin();
  const summary = await handle.done;
  assert.equal(summary.status, 'completed');
  assert.deepEqual(fx.executor.attemptsFor('1.0'), [1, 2, 3]);
  assert.equal(summary.resultSet.ledger.units[0].outcome, 'evaluated');
  assert.deepEqual(summary.resultSet.outcome.environmentSensitiveCauses, [],
    'a retry that SUCCEEDS adds no cause');
});

test('C1: `retryable: false` on the same code is NOT retried', async () => {
  // The whole point of reading P4's field rather than an invented fact: eligibility is the
  // producer's statement about its own failure, not P6's guess from a code string.
  const fx = createRunFixture({
    plan: createFakePlan([{ unitId: '1.0', weight: 1 }]),
    runOptions: { maxPlacementRetries: 2 },
    executor: createScriptedExecutor({ '1.0': [stalePlacement(false), { facts: [] }] }),
  });
  const { handle, begin } = createRun(fx.spec);
  begin();
  const summary = await handle.done;
  assert.deepEqual(fx.executor.attemptsFor('1.0'), [1], 'exactly one attempt');
  assert.equal(summary.resultSet.ledger.units[0].cause, 'stale-placement');
  assert.equal(summary.resultSet.ledger.units[0].attempts, 1);
});

test('C1: a placement generation that MOVED against the run snapshot is never retried', async () => {
  // §7.5 row 2 vs row 3: a host-signalled placement change is `input-changed` and INVALIDATES the
  // run; retrying it would re-issue a unit whose inputs the engine already knows have changed.
  // P6 re-checks the generation itself, so a third-party executor that wrongly answered
  // `retryable: true` cannot talk P6 into a retry.
  const fx = createRunFixture({
    plan: createFakePlan([{ unitId: '1.0', weight: 1, models: ['mk-a'] }]),
    runOptions: { maxPlacementRetries: 2 },
    executor: createScriptedExecutor({ '1.0': [stalePlacement(), { facts: [] }] }),
    beforeUnit: { '1.0': () => fx.registry.notifyPlacementChanged('mk-a') },
  });
  const { handle, begin } = createRun(fx.spec);
  begin();
  const summary = await handle.done;
  assert.deepEqual(fx.executor.attemptsFor('1.0'), [1], 'no retry once the generation moved');
  assert.equal(summary.status, 'invalidated');
  assert.equal(summary.resultSet.ledger.units[0].cause, 'input-changed');
  assert.deepEqual(summary.resultSet.outcome.environmentSensitiveCauses, [],
    'a host-signalled change is never placement-contention (§7.5)');
});

test('C1: a retryable stale-placement alongside a higher-precedence fact settles, never retries', async () => {
  const fx = createRunFixture({
    plan: createFakePlan([{ unitId: '1.0', weight: 1 }]),
    runOptions: { maxPlacementRetries: 2 },
    executor: createScriptedExecutor({
      '1.0': [{ ...stalePlacement(), scopeProof: 'drift' }, { facts: [] }],
    }),
  });
  const { handle, begin } = createRun(fx.spec);
  begin();
  const summary = await handle.done;
  assert.deepEqual(fx.executor.attemptsFor('1.0'), [1]);
  assert.equal(summary.resultSet.ledger.units[0].cause, 'scope-drift', 'table A, not the retry');
  assert.equal(summary.status, 'invalidated');
});

test('retries exhausted is a stale-placement gap and marks the run environmentSensitive', async () => {
  const fx = createRunFixture({
    plan: createFakePlan([{ unitId: '1.0', weight: 1 }]),
    runOptions: { maxPlacementRetries: 2 },
    executor: createScriptedExecutor({ '1.0': Array(3).fill(stalePlacement()) }),
  });
  const { handle, begin } = createRun(fx.spec);
  begin();
  const summary = await handle.done;
  assert.equal(summary.status, 'completed');
  assert.equal(summary.resultSet.ledger.units[0].cause, 'stale-placement');
  assert.equal(summary.resultSet.ledger.units[0].attempts, 3);          // maxPlacementRetries + 1
  assert.equal(summary.resultSet.outcome.coverage, 'partial');
  // §8.3: P5 DERIVES the environmental cause from the sealed `failed:stale-placement` record.
  // P6 wrote no `placement-contention` anywhere — not as a fact, not as a unit cause (A13).
  assert.deepEqual(summary.resultSet.outcome.environmentSensitiveCauses, ['placement-contention']);
  assert.equal(summary.resultSet.outcome.environmentSensitive, true);
  assert.ok(summary.resultSet.outcome.reasons.includes('unit:stale-placement'));
  assert.ok(!summary.resultSet.outcome.reasons.includes('unit:placement-contention'));
});

test('a malformed outcome becomes P4\'s internalErrorOutcome and FAILS the run (fail fast)', async () => {
  const fx = createRunFixture({
    plan: createFakePlan([{ unitId: '1.0', weight: 1 }, { unitId: '1.1', weight: 1 }]),
    executor: createScriptedExecutor({ '1.0': [{ malformed: true }], '1.1': [{ facts: [] }] }),
  });
  const { handle, begin } = createRun(fx.spec);
  begin();
  const summary = await handle.done;
  assert.equal(summary.status, 'failed');
  assert.equal(summary.resultSet.ledger.units[0].cause, 'internal-error');
  assert.equal(summary.resultSet.ledger.units[1].outcome, 'not-run');
  assert.equal(summary.resultSet.results.length, 0, 'nothing from a malformed outcome is merged');
  assert.equal(fx.executor.attemptsFor('1.1').length, 0, 'no unit starts after the fatal one');
  // A10/N8: `issues` are {code, path, detail} OBJECTS and the substitute outcome is P4's, not a
  // hand-built one — a `string[]` assumption would have written "[object Object]" into the ledger.
  assert.deepEqual(fx.substitutedOutcomes.map((o) => o.source), ['internalErrorOutcome']);
  for (const issue of fx.lastValidationIssues) {
    assert.deepEqual(Object.keys(issue).sort(), ['code', 'detail', 'path']);
  }
});

test('C5: a split is admitted ATOMICALLY against both caps; nested splits stay inside them', async () => {
  // The old guard read `run.plan.units.length`, which never changes as runtime children are
  // created, so repeated nested splits could pass forever. R8 moves admission into P3's
  // `splitUnit`, which counts unit records (parent + 2 children) and their ledger records.
  const fx = createRunFixture({
    plan: createFakePlan([{ unitId: '1.0', weight: 8 }]),
    limits: { maxUnitsPerRun: 4 },
    // every leaf keeps failing on capacity, so the run splits until admission refuses
    executor: createScriptedExecutor.capacityAlways({ capacityKind: 'tlas-candidate-budget' }),
  });
  const { handle, begin } = createRun(fx.spec);
  begin();
  const summary = await handle.done;
  const units = summary.resultSet.ledger.units;
  assert.ok(units.length <= 4, `unit records ${units.length} must not exceed maxUnitsPerRun`);
  const capped = units.filter((u) => u.cause === 'unit-cap');
  assert.ok(capped.length > 0, 'the refusal surfaced as failed:unit-cap');
  assert.equal(capped[0].capDetail, 'unit-records');
  assert.equal(summary.status, 'completed', 'a budget refusal never FAILS the run (§6.5.1)');
  assert.equal(summary.resultSet.outcome.coverage, 'partial');
  assert.equal(handle.getSnapshot().pairSpaceTotal, 8, 'every split CONSERVES the weight');
  assert.equal(handle.getSnapshot().fractionProcessed, 1);
});

test('C5: a ledger-record refusal is failed:unit-cap with capDetail ledger-records', async () => {
  const fx = createRunFixture({
    plan: createFakePlan([{ unitId: '1.0', weight: 4 }]),
    limits: { maxLedgerRecords: 'exhausted' },             // the fixture pre-spends the discretionary pool
    executor: createScriptedExecutor({
      '1.0': [{ facts: ['capacity-exceeded'], capacityKind: 'tlas-candidate-budget' }],
    }),
  });
  const { handle, begin } = createRun(fx.spec);
  begin();
  const summary = await handle.done;
  assert.deepEqual(
    summary.resultSet.ledger.units.map((u) => [u.outcome, u.cause, u.capDetail]),
    [['failed', 'unit-cap', 'ledger-records']],
  );
  assert.equal(fx.ledger.halfRecordedSplits, 0, 'no half-recorded split exists');
});

test('C5: an UNSPLITTABLE unit keeps its capacity-exceeded cause and is never called unit-cap', async () => {
  // §6.4 item 4: one source root against one explicit target root (or a whole-model sentinel) is
  // fundamentally indivisible. The capacity failure itself is the gap; `unit-cap` would misreport
  // a budget refusal that never happened.
  const fx = createRunFixture({
    plan: createFakePlan([{ unitId: '1.0', weight: 1, splittable: false }]),
    executor: createScriptedExecutor({
      '1.0': [{ facts: ['capacity-exceeded'], capacityKind: 'tlas-candidate-budget' }],
    }),
  });
  const { handle, begin } = createRun(fx.spec);
  begin();
  const summary = await handle.done;
  const [record] = summary.resultSet.ledger.units;
  assert.equal(record.cause, 'capacity-exceeded');
  assert.equal(record.capacityKind, 'tlas-candidate-budget');
  assert.equal(record.capDetail, null);
  assert.equal(fx.plannerCalls.splitUnit, 1, 'the refusal came from splitUnit, not from a P6 guard');
});

test('C5: a refusal wrapper is never mistaken for a successful split', async () => {
  // N17, the single most dangerous mismatch of the reconciliation: `{reason:'unsplittable'}` is
  // TRUTHY, so `result !== null` would have produced two `undefined` children.
  const fx = createRunFixture({
    plan: createFakePlan([{ unitId: '1.0', weight: 2, splittable: false }]),
    executor: createScriptedExecutor({
      '1.0': [{ facts: ['capacity-exceeded'], capacityKind: 'clearance-narrow-phase-budget' }],
    }),
  });
  const { handle, begin } = createRun(fx.spec);
  begin();
  const summary = await handle.done;
  assert.equal(summary.resultSet.ledger.units.length, 1, 'no phantom children were queued');
  assert.equal(summary.resultSet.ledger.units[0].outcome, 'failed');
  assert.deepEqual(fx.executor.startedUnits, ['1.0']);
});

test('a NON-splittable capacity kind is not split at all', async () => {
  const fx = createRunFixture({
    plan: createFakePlan([{ unitId: '1.0', weight: 2 }]),
    executor: createScriptedExecutor({
      '1.0': [{ facts: ['capacity-exceeded'], capacityKind: 'bucket-capacity' }],
    }),
  });
  const { handle, begin } = createRun(fx.spec);
  begin();
  const summary = await handle.done;
  assert.equal(fx.plannerCalls.splitUnit, 0, '§6.4 splits only the two per-call budget kinds');
  assert.equal(summary.resultSet.ledger.units[0].cause, 'capacity-exceeded');
  assert.deepEqual(summary.resultSet.outcome.environmentSensitiveCauses, ['bucket-capacity']);
});

test('C4: a result-cap REFUSAL merges nothing at all — not results, diagnostics, statistics, taints or progress', async () => {
  // The refused unit carries pairs (over the cap), a completeness-affecting diagnostic, real
  // statistics and an element taint. The plan says a refused unit merges nothing; the sealed set
  // must agree on EVERY channel, because a leaked diagnostic can downgrade `integrity` and a
  // leaked taint can add caveats to a run that claims the unit was never merged.
  //
  // NOTE (codex-advisor, 2026-09-23): the brief's own literal descriptor scripts unit `1.1` with
  // `pairs: 5`, which trips `validateUnitOutcome`'s independent per-outcome `maxPairsPerOutcome`
  // cap (it defaults to the overridden `maxResultsPerRun` here) BEFORE the outcome ever reaches the
  // accumulator's own whole-unit `maxResultsPerRun` refusal this test means to exercise — turning
  // the unit `internal-error` instead of `result-cap`. Using a single valid pair keeps the refusal on
  // the accumulator's own admission gate, which is what "REFUSAL merges nothing" is actually testing.
  // The brief's `diagnostics.total` expectation (`before.total + 0 + 1`) was also checked against the
  // brief's own prose ("A DISCARDED or SKIPPED unit contributes NOTHING — not its results and not its
  // diagnostics") and confirmed a typo: the refused unit's diagnostic never reaches the aggregator,
  // and the accepted unit carries none, so the total does not move at all (`+ 0`). Same family of
  // typo a second time: the brief gives unit `1.0` (the ACCEPTED unit) no `statistics` field at all,
  // so `summary.resultSet.statistics.broadPhasePairs` would be `undefined`, and `undefined < 40` is
  // `false` in JS (NaN coercion) — not the `true` the test's own comment ("the refused unit's
  // statistics are absent from the sealed totals") clearly intends. Unit `1.0` is given its own small
  // `broadPhasePairs` so the comparison is a real, meaningful "sealed total omits the refused unit's
  // 40, keeps only the accepted unit's own small number" check, not an accidental `NaN` comparison.
  const fx = createRunFixture({
    plan: createFakePlan([{ unitId: '1.0', weight: 1 }, { unitId: '1.1', weight: 1 }]),
    runOptions: { maxResultsPerRun: 2 },
    executor: createScriptedExecutor({
      '1.0': [{ facts: [], pairs: 2, statistics: { broadPhasePairs: 3 } }],  // accepted: fills the cap
      '1.1': [{ facts: [], pairs: 1,                                      // refused: whole unit
               diagnostics: [{ reason: 'fragment-not-loaded', dbId: 7, modelId: 1 }],
               statistics: { broadPhasePairs: 40 } }],
    }),
  });
  const { handle, begin } = createRun(fx.spec);
  begin();
  const before = { ...fx.diagnosticAggregator.snapshot(), calls: fx.diagnosticAggregator.addUnitCalls };
  const summary = await handle.done;
  const snap = handle.getSnapshot();

  assert.equal(summary.resultSet.results.length, 2, 'only the accepted unit merged');
  assert.deepEqual(fx.diagnosticAggregator.addUnitCalls, ['1.0'],
    'the refused unit was never handed to the aggregator');
  assert.deepEqual(fx.statisticsAccumulator.addCalls.length, 1, 'and never to the statistics');
  assert.equal(summary.resultSet.statistics.broadPhasePairs < 40, true,
    'the refused unit\'s statistics are absent from the sealed totals');
  assert.equal(summary.resultSet.diagnostics.total, before.total + 0,
    'exactly the accepted unit\'s diagnostics');
  const refused = summary.resultSet.ledger.units.find((u) => u.unitId === '1.1');
  assert.equal(refused.cause, 'result-cap');
  assert.deepEqual(refused.taints, [], 'no taint was derived or charged for a refused unit');
  assert.equal(snap.unitsEvaluated, 1, 'a refused unit is not evaluated');
  assert.equal(snap.pairSpaceEvaluated, 1);
  assert.equal(snap.resultsFound, 2);
  assert.equal(snap.unitsFailedOrSkipped, 1);
  assert.equal(snap.pairSpaceProcessed, 2, 'but it IS processed — it is a gap, not a hole');
  assert.equal(summary.status, 'failed', '§16.7: result-cap is a failing unit cause');
});

test('I5: a clean run seals with EMPTY reasons', async () => {
  const fx = createRunFixture({
    plan: createFakePlan([{ unitId: '1.0', weight: 1 }, { unitId: '1.1', weight: 1 }]),
    executor: createScriptedExecutor({ '1.0': [{ facts: [], pairs: 1 }], '1.1': [{ facts: [] }] }),
  });
  const { handle, begin } = createRun(fx.spec);
  begin();
  const summary = await handle.done;
  assert.equal(summary.status, 'completed');
  assert.deepEqual(summary.resultSet.outcome.reasons, [],
    'no cancel, no gap, no drift ⇒ nothing to report; `unit:evaluated` is not a reason');
  assert.equal(summary.resultSet.outcome.coverage, 'full');
  assert.deepEqual(summary.resultSet.ledger.units.map((u) => u.cause), [null, null]);
});

// --- Plan order over runtime split descendants (re-verification I6) ---

test('I6: a split CHILD outranks a later initial unit in the duplicate-reconciliation order', async () => {
  // §11.4 rule 2 resolves a duplicate pair in favour of the lowest unit *in plan order*. A child of
  // initial unit 1 is logically earlier than initial unit 2; with only `plan.units` in the oracle
  // the child is unranked (`Number.MAX_SAFE_INTEGER`) and LOSES to unit 2 — or ties, and is then
  // decided by settlement arrival, which is not an order at all.
  const fx = createRunFixture({
    plan: createFakePlan([{ unitId: '1.0', weight: 2 }, { unitId: '1.1', weight: 2 }]),
    splits: { '1.0': [{ unitId: '1.0.0', weight: 1 }, { unitId: '1.0.1', weight: 1 }] },
    executor: createScriptedExecutor({
      '1.0': [{ facts: ['capacity-exceeded'], capacityKind: 'tlas-candidate-budget' }],
      '1.0.0': [{ facts: [] }], '1.0.1': [{ facts: [] }], '1.1': [{ facts: [] }],
    }),
  });
  const { handle, begin } = createRun(fx.spec);
  begin();
  await handle.done;
  const rank = fx.resultPort.lastAccumulatorCtx.unitPlanRank;
  const r = (id) => rank.get(id);
  assert.ok(Number.isInteger(r('1.0.0')) && Number.isInteger(r('1.1')), 'every live unit is ranked');
  assert.ok(r('1.0.0') < r('1.1'), 'a descendant of unit 1 precedes initial unit 2');
  assert.ok(r('1.0.1') < r('1.1'));
  assert.ok(r('1.0.0') < r('1.0.1'), 'siblings keep the §6.4 split order');
  assert.ok(r('1.0') < r('1.0.0'), 'the superseded parent still precedes its own children');
  assert.notEqual(r('1.1'), Number.MAX_SAFE_INTEGER, 'nothing fell back to the unranked sentinel');
});

test('I6: NESTED children stay in order, and the order is a strict total order', async () => {
  const fx = createRunFixture({
    plan: createFakePlan([{ unitId: '1.0', weight: 8 }, { unitId: '1.1', weight: 1 }]),
    splits: {
      '1.0': [{ unitId: '1.0.0', weight: 4 }, { unitId: '1.0.1', weight: 4 }],
      '1.0.1': [{ unitId: '1.0.1.0', weight: 2 }, { unitId: '1.0.1.1', weight: 2 }],
    },
    executor: createScriptedExecutor({
      '1.0': [{ facts: ['capacity-exceeded'], capacityKind: 'tlas-candidate-budget' }],
      '1.0.1': [{ facts: ['capacity-exceeded'], capacityKind: 'tlas-candidate-budget' }],
      '1.0.0': [{ facts: [] }], '1.0.1.0': [{ facts: [] }], '1.0.1.1': [{ facts: [] }],
      '1.1': [{ facts: [] }],
    }),
  });
  const { handle, begin } = createRun(fx.spec);
  begin();
  await handle.done;
  const rank = fx.resultPort.lastAccumulatorCtx.unitPlanRank;
  const ids = ['1.0', '1.0.0', '1.0.1', '1.0.1.0', '1.0.1.1', '1.1'];
  const ranks = ids.map((id) => rank.get(id));
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b), 'the documented order, exactly');
  assert.equal(new Set(ranks).size, ranks.length, 'strict: no two live units share a rank');
  assert.equal(rank.get('nope'), undefined, 'an unknown id is still unranked (P5 fails it last)');
  // The lexicographic path order is what produces this; string order does NOT. With ten children
  // the string comparison '1.0.10' < '1.0.2' would invert two siblings.
  assert.ok(rank.get('1.0.1.1') < rank.get('1.1'));
});

test('the unit request carries P3\'s scopeExpect through untouched (A7, D1)', async () => {
  const fx = createRunFixture({
    plan: createFakePlan([{ unitId: '1.0', weight: 1 }]),
    executor: createScriptedExecutor({ '1.0': [{ facts: [] }] }),
  });
  const { handle, begin } = createRun(fx.spec);
  begin();
  await handle.done;
  const [request] = fx.executor.requests;
  const expected = fx.plan.materializeUnit(fx.plan, fx.plan.units[0]).scopeExpect;
  assert.deepEqual(request.materialized.scopeExpect, expected,
    'P6 passes the planner\'s expectation through; it builds none of its own');
  assert.equal(Object.isFrozen(request), true);
});
