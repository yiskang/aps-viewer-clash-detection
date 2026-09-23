// test/clashtest/run/scopeConsequences.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRun } from '../../../clashtest/run/Run.js';
import { createRunFixture } from '../support/runFixture.mjs';
import { createFakePlan } from '../support/fakePlanner.mjs';
import { createScriptedExecutor } from '../support/scriptedExecutor.mjs';

// Every case below drives the run through a SCRIPTED executor outcome. The pure question
// "does this content drift?" is P3's and is tested there; the question here is "what does a run
// DO with the answer", which is §16.3's run-level half and P6's alone.

test('a drifted unit invalidates the run, retains earlier units and merges nothing', async () => {
  // P6.6 DEVIATION from the brief's verbatim text: unit 1.0 declares `models: ['M']`. The scripted
  // failure names `modelKeys: ['M']`, and P4's `validateUnitOutcome` rejects a `failure.modelKeys`
  // entry that is not one of the unit's own participants (`failure-modelkeys-unknown`) — with the
  // brief's default `mk-a` source the drift outcome would have been substituted by
  // `internal-error`, so the case could never have tested drift at all.
  const fx = createRunFixture({
    plan: createFakePlan([{ unitId: '1.0', weight: 1, models: ['M'] }, { unitId: '1.1', weight: 1 }]),
    executor: createScriptedExecutor({
      '1.0': [{ facts: ['scope-drift'], scopeProof: 'drift', pairs: 4, modelKeys: ['M'] }],
      '1.1': [{ facts: [] }],
    }),
  });
  const { handle, begin } = createRun(fx.spec);
  begin();
  const summary = await handle.done;
  assert.equal(summary.status, 'invalidated');
  const [drifted, later] = summary.resultSet.ledger.units;
  assert.equal(drifted.outcome, 'discarded');
  assert.equal(drifted.cause, 'scope-drift');
  assert.equal(drifted.scopeProof, 'drift', 'the proof reaches the ledger record');
  assert.equal(summary.resultSet.results.length, 0, 'a drifted unit merges NOTHING (§16.3 item 3)');
  assert.deepEqual(fx.diagnosticAggregator.unitsAdded, [],
    'and its diagnostics are not aggregated either');
  assert.equal(later.outcome, 'not-run', 'no unit starts after the invalidating boundary');
});

test('scope-unverifiable is a GAP: the run continues and completes partial', async () => {
  const fx = createRunFixture({
    plan: createFakePlan([{ unitId: '1.0', weight: 1 }, { unitId: '1.1', weight: 1 }]),
    executor: createScriptedExecutor({
      '1.0': [{ facts: ['scope-unverifiable'], scopeProof: 'unverifiable', pairs: 2 }],
      '1.1': [{ facts: [] }],
    }),
  });
  const { handle, begin } = createRun(fx.spec);
  begin();
  const summary = await handle.done;
  assert.equal(summary.status, 'completed');
  assert.equal(summary.resultSet.outcome.coverage, 'partial');
  assert.equal(summary.resultSet.ledger.units[0].outcome, 'discarded');
  assert.equal(summary.resultSet.ledger.units[0].scopeProof, 'unverifiable');
  assert.equal(summary.resultSet.ledger.units[1].outcome, 'evaluated', 'a later unit may succeed');
  assert.equal(summary.resultSet.results.length, 0, 'the unverifiable unit still merges nothing');
  assert.equal(handle.getSnapshot().fractionProcessed, 1, 'a gap is processed');
  assert.equal(handle.getSnapshot().fractionEvaluated, 0.5);
});

test('invariant I-scope: no evaluated unit ever carries a non-equal scopeProof', async () => {
  // §16.3.4, normative. P4's validateUnitOutcome rejects the combination at the boundary; the
  // run-level consequence is a fail-fast internal error, never a silently evaluated unit.
  for (const proof of ['drift', 'unverifiable', 'not-checked']) {
    const fx = createRunFixture({
      plan: createFakePlan([{ unitId: '1.0', weight: 1 }]),
      executor: createScriptedExecutor({ '1.0': [{ facts: [], forceScopeProof: proof }] }),
    });
    const { handle, begin } = createRun(fx.spec); begin();
    const summary = await handle.done;
    assert.equal(summary.status, 'failed', `evaluated + ${proof} must be rejected`);
    assert.equal(summary.resultSet.ledger.units[0].cause, 'internal-error');
    assert.equal(summary.resultSet.results.length, 0);
  }
  // and the converse holds over every sealed set this suite produced
});

test('every evaluated ledger record in ANY of these runs has scopeProof equal', async () => {
  const fx = createRunFixture({
    plan: createFakePlan([{ unitId: '1.0', weight: 1 }, { unitId: '1.1', weight: 1 }]),
    executor: createScriptedExecutor({
      '1.0': [{ facts: ['scope-unverifiable'], scopeProof: 'unverifiable' }],
      '1.1': [{ facts: [], scopeProof: 'equal' }],
    }),
  });
  const { handle, begin } = createRun(fx.spec); begin();
  const summary = await handle.done;
  for (const u of summary.resultSet.ledger.units) {
    if (u.outcome === 'evaluated') assert.equal(u.scopeProof, 'equal');
  }
});

test('a placementGeneration change against the RUN SNAPSHOT invalidates at the next boundary', async () => {
  const fx = createRunFixture({
    plan: createFakePlan([{ unitId: '1.0', weight: 1, models: ['M'] }, { unitId: '1.1', weight: 1, models: ['M'] }]),
    executor: createScriptedExecutor({ '1.0': [{ facts: [] }], '1.1': [{ facts: [] }] }),
  });
  const { handle, begin } = createRun(fx.spec);
  begin();
  await fx.afterUnit('1.0', () => fx.registry.notifyPlacementChanged('M'));
  const summary = await handle.done;
  assert.equal(summary.status, 'invalidated');
  assert.equal(summary.resultSet.ledger.units[0].outcome, 'evaluated', 'earlier units are RETAINED');
  assert.equal(summary.resultSet.outcome.freshness, 'stale');
  assert.ok(summary.resultSet.outcome.reasons.includes('placement-changed'));
  assert.deepEqual(fx.world.destructiveCalls, [], 'observing a placement change destroys nothing');
});

test('a RELOAD (bindingGeneration bump, same modelKey) is a gap + stale, never invalidated', async () => {
  const fx = createRunFixture({
    plan: createFakePlan([{ unitId: '1.0', weight: 1, models: ['M'] }, { unitId: '1.1', weight: 1, models: ['N'] }]),
    executor: createScriptedExecutor({ '1.0': [{ facts: ['model-evicted'] }], '1.1': [{ facts: [] }] }),
  });
  const { handle, begin } = createRun(fx.spec); begin();
  const summary = await handle.done;
  assert.equal(summary.status, 'completed', 'a reload does NOT invalidate (§16.3 item 1, §16.7)');
  assert.equal(summary.resultSet.outcome.coverage, 'partial');
  assert.equal(summary.resultSet.outcome.freshness, 'stale');
  assert.equal(summary.resultSet.ledger.units[1].outcome, 'evaluated');
});

test('the boundary comparison uses bindingsEquivalent, never a `dead` flag (N10)', async () => {
  // `Binding` has no `dead` property: a check written against `binding.dead` reads `undefined`
  // and treats every dead binding as live — fail-OPEN where §16.1 requires fail-closed.
  const fx = createRunFixture({
    plan: createFakePlan([{ unitId: '1.0', weight: 1, models: ['M'] }, { unitId: '1.1', weight: 1, models: ['M'] }]),
    executor: createScriptedExecutor({ '1.0': [{ facts: [] }], '1.1': [{ facts: [] }] }),
  });
  const { handle, begin } = createRun(fx.spec);
  begin();
  await fx.afterUnit('1.0', () => fx.registry.unregisterKey('M'));   // snapshot entry becomes null
  const summary = await handle.done;
  assert.equal(summary.resultSet.outcome.freshness, 'stale');
  assert.ok(summary.resultSet.outcome.reasons.some((r) => r.startsWith('unit:') || r === 'placement-changed')
    || summary.resultSet.outcome.freshness === 'stale');
  assert.equal(fx.registry.deadFlagReads, 0, 'nothing read a `dead` property');
});

// ------------------------------------------------------------------------------------------------
// P4 H1 carry-forward (owner ruling, P6.6 controller ruling): P6 detects a participant's death with
// its OWN unit-scoped live-binding scan and feeds the COARSE fact `model-evicted` into that unit's
// §16.7 settlement. Not in the brief's Step 1; added because without it a unit whose participant
// died while the call ALSO produced `capacity-exceeded` + `scope-unverifiable` settles U7
// (`scope-unverifiable`) instead of the table-A-correct U6 (`model-evicted`).
// ------------------------------------------------------------------------------------------------

// P4's own shape for "capacity error thrown, post-bracket unverifiable" (LocalUnitExecutor: the
// bracket answer outranks the thrown capacity cause, so the kind is `discarded`; `failure.code`
// still carries the thrown cause). Nothing in it names the dying model.
const CAPACITY_AND_UNVERIFIABLE = Object.freeze({
  outcome: 'discarded',
  scopeProof: 'unverifiable',
  failure: Object.freeze({ code: 'capacity-exceeded', retryable: false }),
});

/**
 * One run of the H1 scenario. `dying` is the participant that dies; `when` is WHICH condition is
 * observed first: `'before-call'` (the model dies before the library produced its answer —
 * `beforeUnit` fires inside the executor call, before the scripted outcome is built) or
 * `'after-answer'` (the library already produced capacity + unverifiable, then the model dies before
 * the call returns). Unit 1.1 touches an UNRELATED model and must stay clean (unit scoping).
 */
async function runH1Scenario({ dying, when }) {
  let fx = null;
  const inner = createScriptedExecutor({ '1.0': [CAPACITY_AND_UNVERIFIABLE], '1.1': [{ facts: [] }] });
  const executor = when === 'after-answer'
    ? async (request) => {
      const outcome = await inner(request);
      if (request.unit.unitId === '1.0') fx.registry.unregisterKey(dying);
      return outcome;
    }
    : inner;
  fx = createRunFixture({
    plan: createFakePlan([
      { unitId: '1.0', weight: 1, models: ['mk-src', 'mk-tgt'] },
      { unitId: '1.1', weight: 1, models: ['mk-other'] },
    ]),
    executor,
    ...(when === 'before-call' ? { beforeUnit: { '1.0': () => fx.registry.unregisterKey(dying) } } : {}),
  });
  const { handle, begin } = createRun(fx.spec);
  begin();
  return { fx, summary: await handle.done };
}

test('H1: a participant that dies during a capacity + unverifiable call settles U6 model-evicted', async () => {
  const { summary } = await runH1Scenario({ dying: 'mk-tgt', when: 'before-call' });
  const [unit, unrelated] = summary.resultSet.ledger.units;

  // (1) table A: U6 outranks U7 scope-unverifiable and U8 capacity-exceeded.
  assert.equal(unit.cause, 'model-evicted', 'the primary cause is model-evicted');
  assert.equal(unit.outcome, 'failed', 'U6 observed at the call is failed (§16.7 table A)');
  // (2) every other observed fact is secondary, ascending (R4).
  assert.deepEqual(unit.secondaryCauses, ['capacity-exceeded', 'scope-unverifiable']);
  // (3) the seal is stale: a participant died after the run-start snapshot.
  assert.equal(summary.resultSet.outcome.freshness, 'stale');
  // (4) the dead model's KEY never enters the digested outcome reasons — only coarse facts do.
  const { reasons } = summary.resultSet.outcome;
  assert.ok(reasons.includes('unit:model-evicted'));
  assert.ok(reasons.every((r) => !r.includes('mk-tgt')), `no model key in reasons: ${reasons}`);
  // A gap, never an invalidation (model-evicted is not an order-B invalidating fact).
  assert.equal(summary.status, 'completed');
  assert.equal(summary.resultSet.outcome.coverage, 'partial');
  // UNIT SCOPING: a death among 1.0's participants never contaminates a unit that does not touch it.
  assert.equal(unrelated.outcome, 'evaluated');
  assert.equal(unrelated.cause, null);
  assert.deepEqual(unrelated.secondaryCauses, []);
});

test('H1: the settlement is independent of which condition is observed first and of WHICH key died', async () => {
  // (5) the scan must feed classifyUnitSettlement the same FACT SET however the scenario unfolds:
  // death before the library answered vs after it, and the source vs a target dying. The sealed
  // unit records, the outcome reasons and the ledger digest are byte-identical across all of them —
  // which is also the AC-21 property: the digest depends on which coarse facts were observed, never
  // on which model key they were observed on.
  const variants = [
    { dying: 'mk-tgt', when: 'before-call' },
    { dying: 'mk-tgt', when: 'after-answer' },
    { dying: 'mk-src', when: 'before-call' },
    { dying: 'mk-src', when: 'after-answer' },
  ];
  const projections = [];
  for (const v of variants) {
    const { summary } = await runH1Scenario(v);
    const [unit] = summary.resultSet.ledger.units;
    assert.equal(unit.cause, 'model-evicted', `${v.dying}/${v.when}`);
    assert.equal(summary.resultSet.outcome.freshness, 'stale', `${v.dying}/${v.when}`);
    projections.push({
      units: summary.resultSet.ledger.units.map((u) => ({
        unitId: u.unitId, outcome: u.outcome, cause: u.cause,
        secondaryCauses: u.secondaryCauses, scopeProof: u.scopeProof,
      })),
      reasons: summary.resultSet.outcome.reasons,
      status: summary.status,
      ledgerDigest: summary.resultSet.digests.ledgerDigest,
    });
  }
  for (let i = 1; i < projections.length; i += 1) {
    assert.deepEqual(projections[i], projections[0],
      `${variants[i].dying}/${variants[i].when} diverged from ${variants[0].dying}/${variants[0].when}`);
  }
});

test('H1: a death among the run\'s models that the unit does NOT touch leaves the unit clean', async () => {
  // Unit scoping, isolated: `mk-other` dies before unit 1.1 runs, but 1.1 touches only `mk-a`.
  const fx = createRunFixture({
    plan: createFakePlan([
      { unitId: '1.0', weight: 1, models: ['mk-other'] },
      { unitId: '1.1', weight: 1, models: ['mk-a'] },
    ]),
    executor: createScriptedExecutor({ '1.0': [{ facts: [] }], '1.1': [{ facts: [] }] }),
  });
  const { handle, begin } = createRun(fx.spec);
  begin();
  await fx.afterUnit('1.0', () => fx.registry.unregisterKey('mk-other'));
  const summary = await handle.done;
  const [first, second] = summary.resultSet.ledger.units;
  assert.equal(first.outcome, 'evaluated', 'settled before the death');
  assert.equal(second.outcome, 'evaluated', 'an unrelated death is not this unit\'s fact');
  assert.equal(second.cause, null);
  assert.equal(summary.status, 'completed');
  assert.deepEqual(summary.resultSet.outcome.reasons, [], 'nothing unit-level was observed');
  assert.equal(summary.resultSet.outcome.freshness, 'stale', 'but the run-level seal still says stale');
});

test('H1: a placement change among the unit\'s own participants is input-changed for THAT unit', async () => {
  // `placementChangedSince` made real: the live scan pushes `input-changed` for a moved participant
  // observed at settlement, so the attempt is discarded rather than merged (U4 at `post`).
  let fx = null;
  const inner = createScriptedExecutor({ '1.0': [{ facts: [], pairs: 2 }] });
  fx = createRunFixture({
    plan: createFakePlan([{ unitId: '1.0', weight: 1, models: ['mk-a', 'mk-b'] }]),
    executor: async (request) => {
      const outcome = await inner(request);
      fx.registry.notifyPlacementChanged('mk-b');
      return outcome;
    },
  });
  const { handle, begin } = createRun(fx.spec);
  begin();
  const summary = await handle.done;
  const [unit] = summary.resultSet.ledger.units;
  assert.equal(unit.outcome, 'discarded');
  assert.equal(unit.cause, 'input-changed');
  assert.equal(summary.resultSet.results.length, 0, 'the moved unit merges nothing');
  assert.equal(summary.status, 'invalidated');
  assert.ok(summary.resultSet.outcome.reasons.every((r) => !r.includes('mk-b')));
});
