// test/clashtest/planning/planner.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlan, planRun, materializeUnit, rootsForRanges } from '../../../clashtest/planning/planner.js';
import { planSplit, splitUnit } from '../../../clashtest/planning/splitting.js';
import { createRecordBudget, createLedger } from '../../../clashtest/planning/ledger.js';
import { RUN_OPTION_DEFAULTS } from '../../../clashtest/options.js';
import { EnumerationCancelledError } from '../../../clashtest/errors.js';
import { makeSyntheticEnumerator, defOf, snapshotOf } from '../support/syntheticModels.mjs';

const frag = (fragId, ownerDbId, geometryId = 1) => ({ fragId, ownerDbId, geometryId });
const rootOf = (dbId, fragId) => ({ dbId, owners: [dbId], fragments: [frag(fragId, dbId)] });

const twoModels = () => ([
  { modelKey: 'arch', roots: [{ dbId: 1, owners: [1], fragments: [{ fragId: 0, ownerDbId: 1, geometryId: 1 }] },
                              { dbId: 2, owners: [2], fragments: [{ fragId: 1, ownerDbId: 2, geometryId: 1 }] }] },
  { modelKey: 'struct', roots: [{ dbId: 7, owners: [7], fragments: [{ fragId: 0, ownerDbId: 7, geometryId: 1 }] }] },
]);

const plan2 = async ({ A, B, models = twoModels(), keys = ['arch', 'struct'], options = RUN_OPTION_DEFAULTS, ...rest }) => {
  const { enumerator, binding } = makeSyntheticEnumerator(models);
  return createPlan({ definition: defOf({ A, B, ...rest }), snapshot: snapshotOf(binding, keys), enumerator,
    options, checkpoint: () => {} });
};

test('a whole-model TARGET unit carries a population scopeExpect (§16.3.2)', async () => {
  const { plan } = await plan2({ A: [{ kind: 'elements', modelKey: 'arch', dbIds: [1, 2] }],
    B: [{ kind: 'model', modelKey: 'struct' }] });
  const m = materializeUnit(plan, plan.units[0]);
  assert.deepEqual(m.targets, [{ modelKey: 'struct', scope: 'whole' }]);
  const tgt = m.scopeExpect.find((s) => s.role === 'target' && s.modelKey === 'struct');
  assert.equal(tgt.scope, 'whole');
  assert.ok(tgt.population.digest.startsWith('sha256:'));
  assert.equal(typeof tgt.population.count, 'number');
});

test('a whole-model SOURCE unit brackets BOTH its source roots and the model population (R20-1)', async () => {
  const { plan } = await plan2({ A: [{ kind: 'model', modelKey: 'arch' }],
    B: [{ kind: 'elements', modelKey: 'struct', dbIds: [7] }] });
  const m = materializeUnit(plan, plan.units[0]);
  const src = m.scopeExpect.filter((s) => s.role === 'source' && s.modelKey === 'arch');
  assert.deepEqual(src.map((s) => s.scope).sort(), ['roots', 'whole']);
  assert.deepEqual(src.find((s) => s.scope === 'roots').roots.map((r) => r.dbId), [1, 2]);
  assert.ok(src.find((s) => s.scope === 'whole').population.digest.startsWith('sha256:'));
  assert.deepEqual(m.sourceDbIds, [1, 2]);          // materialized ids, never held in the unit
});

test('R20-1: the source population entry is exactly the planning-time population digest of that model', async () => {
  const { enumerator, binding } = makeSyntheticEnumerator(twoModels());
  const { plan } = await createPlan({ definition: defOf({ A: [{ kind: 'model', modelKey: 'arch' }],
    B: [{ kind: 'elements', modelKey: 'struct', dbIds: [7] }] }),
  snapshot: snapshotOf(binding, ['arch', 'struct']), enumerator, options: RUN_OPTION_DEFAULTS, checkpoint: () => {} });
  const live = await enumerator.digestScope(binding, 'whole', { checkpoint: () => {} });
  const m = materializeUnit(plan, plan.units[0]);
  const whole = m.scopeExpect.find((s) => s.role === 'source' && s.scope === 'whole');
  assert.deepEqual(whole.population, { count: live.count, digest: live.digest });
  // ... and every subtree digest is what a live per-root digest returns.
  const rootsLive = await enumerator.digestScope(binding, { dbIds: [1, 2] }, { checkpoint: () => {} });
  const rootsExpect = m.scopeExpect.find((s) => s.role === 'source' && s.scope === 'roots').roots;
  assert.deepEqual(rootsExpect, rootsLive.roots.map(({ dbId, subtreeDigest }) => ({ dbId, subtreeDigest })));
});

test('an explicit-root TARGET unit brackets each root subtree digest', async () => {
  const { plan } = await plan2({ A: [{ kind: 'elements', modelKey: 'struct', dbIds: [7] }],
    B: [{ kind: 'elements', modelKey: 'arch', dbIds: [1, 2] }] });
  const m = materializeUnit(plan, plan.units[0]);
  const tgt = m.scopeExpect.find((s) => s.role === 'target' && s.modelKey === 'arch');
  assert.equal(tgt.scope, 'roots');
  assert.deepEqual(tgt.roots.map((r) => r.dbId), [1, 2]);
  assert.ok(tgt.roots.every((r) => r.subtreeDigest.startsWith('sha256:')));
  assert.deepEqual(m.targets, [{ modelKey: 'arch', scope: 'roots', dbIds: [1, 2] }]);
});

test('an explicit-list SOURCE emits NO population entry, and scopeExpect is canonically ordered (D1)', async () => {
  const { plan } = await plan2({ A: [{ kind: 'elements', modelKey: 'arch', dbIds: [1, 2] }],
    B: [{ kind: 'elements', modelKey: 'struct', dbIds: [7] }] });
  const m = materializeUnit(plan, plan.units[0]);
  assert.equal(m.scopeExpect.filter((s) => s.scope === 'whole').length, 0);
  assert.deepEqual(m.scopeExpect.map((s) => `${s.modelKey}/${s.role}/${s.scope}`),
    ['arch/source/roots', 'struct/target/roots']);
  const key = (s) => [s.modelKey, s.role, s.scope].join('\u0000');
  assert.deepEqual(m.scopeExpect.map(key), [...m.scopeExpect.map(key)].sort());   // canonical (modelKey, role, scope)
});

test('scopeExpect ordering is canonical: the source entries interleave with the target entries by modelKey', async () => {
  const models = [...twoModels(), { modelKey: 'aaa', roots: [rootOf(3, 0), rootOf(4, 1)] }];
  const { plan } = await plan2({ models, keys: ['aaa', 'arch', 'struct'],
    A: [{ kind: 'model', modelKey: 'struct' }],
    B: [{ kind: 'elements', modelKey: 'aaa', dbIds: [3, 4] }, { kind: 'elements', modelKey: 'arch', dbIds: [1, 2] }] });
  assert.equal(plan.units.length, 1);
  const m = materializeUnit(plan, plan.units[0]);
  assert.deepEqual(m.scopeExpect.map((s) => `${s.modelKey}/${s.role}/${s.scope}`),
    ['aaa/target/roots', 'arch/target/roots', 'struct/source/roots', 'struct/source/whole']);
});

test('a whole-model sentinel target stands alone in its unit, alongside an explicit target in another (scopeExpect per unit)', async () => {
  const models = [...twoModels(), { modelKey: 'aaa', roots: [rootOf(3, 0), rootOf(4, 1)] }];
  const { plan } = await plan2({ models, keys: ['aaa', 'arch', 'struct'],
    A: [{ kind: 'model', modelKey: 'struct' }],
    B: [{ kind: 'elements', modelKey: 'aaa', dbIds: [3, 4] }, { kind: 'model', modelKey: 'arch' }] });
  assert.equal(plan.units.length, 2);
  assert.deepEqual(materializeUnit(plan, plan.units[0]).scopeExpect.map((s) => `${s.modelKey}/${s.role}/${s.scope}`),
    ['aaa/target/roots', 'struct/source/roots', 'struct/source/whole']);
  assert.deepEqual(materializeUnit(plan, plan.units[1]).scopeExpect.map((s) => `${s.modelKey}/${s.role}/${s.scope}`),
    ['arch/target/whole', 'struct/source/roots', 'struct/source/whole']);
});

test('the same-model self test (cell 3b) brackets the source and the target roots of ONE model separately', async () => {
  const models = [{ modelKey: 'm', roots: [rootOf(10, 0), rootOf(20, 1), rootOf(30, 2)] }];
  const { plan } = await plan2({ models, keys: ['m'], A: [{ kind: 'model', modelKey: 'm' }], B: [{ kind: 'model', modelKey: 'm' }] });
  const m = materializeUnit(plan, plan.units[0]);
  assert.deepEqual(m.scopeExpect.map((s) => `${s.modelKey}/${s.role}/${s.scope}`),
    ['m/source/roots', 'm/source/whole', 'm/target/roots']);
  const src = m.scopeExpect[0].roots.map((r) => r.dbId);
  const tgt = m.scopeExpect[2].roots.map((r) => r.dbId);
  assert.equal(src.some((d) => tgt.includes(d)), false);
});

test('an initial plan above maxUnitsPerRun fails plan-too-large with no units', async () => {
  const many = [{ modelKey: 'm', roots: Array.from({ length: 40 }, (_, i) => rootOf(i + 1, i)) }];
  const res = await plan2({ models: many, keys: ['m'], A: [{ kind: 'model', modelKey: 'm' }], B: [{ kind: 'model', modelKey: 'm' }],
    options: { ...RUN_OPTION_DEFAULTS, maxUnitsPerRun: 5 } });
  assert.equal(res.status, 'failed');
  assert.deepEqual(res.planningGaps.map((g) => g.cause), ['plan-too-large']);
  assert.equal(res.plan, null);
  assert.equal(res.preTerminalGapWeight, 0);
  const rec = res.ledger.toLedgerRecord();
  assert.equal(rec.units.length, 0);                                           // nothing recorded past the cap
  assert.deepEqual(rec.planningGaps, [{ phase: 'planning', cause: 'plan-too-large' }]);
  assert.equal(rec.planExists, false);
});

test('maxUnitsPerRun is an inclusive bound: exactly the cap plans, one over fails', async () => {
  const models = [{ modelKey: 'm', roots: Array.from({ length: 4 }, (_, i) => rootOf(i + 1, i)) }];   // C=4: cell 3b = 3 units
  const args = { models, keys: ['m'], A: [{ kind: 'model', modelKey: 'm' }], B: [{ kind: 'model', modelKey: 'm' }] };
  const ok = await plan2({ ...args, options: { ...RUN_OPTION_DEFAULTS, maxUnitsPerRun: 3 } });
  assert.equal(ok.status, 'planned');
  assert.equal(ok.plan.units.length, 3);
  const over = await plan2({ ...args, options: { ...RUN_OPTION_DEFAULTS, maxUnitsPerRun: 2 } });
  assert.equal(over.status, 'failed');
  assert.deepEqual(over.planningGaps.map((g) => g.cause), ['plan-too-large']);
  assert.equal(over.planningGaps[0].detail.overflowClass, 'unit-record');
});

test('a pre-planned gap counts against maxUnitsPerRun too', async () => {
  // Two whole-model targets, each heavier than the target-fragment cap: zero issuable units, two gap unit records.
  const heavy = (dbId) => ({ dbId, owners: [dbId], fragments: [frag(0, dbId), frag(1, dbId), frag(2, dbId)] });
  const models = [{ modelKey: 'arch', roots: [rootOf(1, 0), rootOf(2, 1)] },
    { modelKey: 'struct', roots: [heavy(7)] }, { modelKey: 'zzz', roots: [heavy(70)] }];
  const args = { models, keys: ['arch', 'struct', 'zzz'], A: [{ kind: 'elements', modelKey: 'arch', dbIds: [1, 2] }],
    B: [{ kind: 'model', modelKey: 'struct' }, { kind: 'model', modelKey: 'zzz' }] };
  const options = { ...RUN_OPTION_DEFAULTS, maxTargetFragmentsPerUnit: 1 };
  const fits = await plan2({ ...args, options: { ...options, maxUnitsPerRun: 2 } });
  assert.equal(fits.status, 'planned');
  assert.equal(fits.plan.units.length, 0);
  assert.equal(fits.plan.gaps.length, 2);
  const over = await plan2({ ...args, options: { ...options, maxUnitsPerRun: 1 } });
  assert.equal(over.status, 'failed');
  assert.deepEqual(over.planningGaps.map((g) => g.cause), ['plan-too-large']);
});

test('a planning record budget refusal fails plan-too-large naming the overflow class', async () => {
  const res = await plan2({ A: [{ kind: 'model', modelKey: 'arch' }], B: [{ kind: 'model', modelKey: 'struct' }],
    options: { ...RUN_OPTION_DEFAULTS, maxPlanReferences: 3 } });
  assert.equal(res.status, 'failed');
  assert.deepEqual(res.planningGaps.map((g) => g.cause), ['plan-too-large']);
  assert.equal(typeof res.planningGaps[0].detail.overflowClass, 'string');
  assert.equal(res.plan, null);
});

test('a budget refusal at UNIT admission (tables and rows fit) is plan-too-large and records no unit', async () => {
  const args = { A: [{ kind: 'model', modelKey: 'arch' }], B: [{ kind: 'model', modelKey: 'struct' }] };
  const full = await plan2(args);
  // the unit-range block is the last thing charged, so one record short refuses exactly that block
  const res = await plan2({ ...args, options: { ...RUN_OPTION_DEFAULTS, maxPlanReferences: full.plan.planRecords - 1 } });
  assert.equal(res.status, 'failed');
  assert.deepEqual(res.planningGaps.map((g) => g.cause), ['plan-too-large']);
  assert.equal(res.planningGaps[0].detail.overflowClass, 'unit-range');
  assert.equal(res.ledger.toLedgerRecord().units.length, 0);            // nothing partial was recorded
  assert.equal(res.ledger.unitRecordCount, 0);
});

test('units hold ranges only — never copied dbId arrays or Model references (§6.5)', async () => {
  const { plan } = await plan2({ A: [{ kind: 'model', modelKey: 'arch' }], B: [{ kind: 'model', modelKey: 'struct' }] });
  const json = JSON.stringify(plan.units);
  assert.equal(json.includes('dbIds'), false);
  assert.deepEqual(Object.keys(plan.units[0]).sort(),
    ['cell', 'orientationRole', 'pairSpaceWeight', 'sourceModelKey', 'sourceRanges', 'targetWeight', 'targets', 'unitId']);
});

test('R11: preTerminalGapWeight is exposed and equals the ledger it summarizes', async () => {
  const args = { A: [{ kind: 'elements', modelKey: 'arch', dbIds: [1, 2] }], B: [{ kind: 'model', modelKey: 'struct' }] };
  // A whole-model target of 3 fragments above maxTargetFragmentsPerUnit 1: a pre-planned, never-executed
  // not-run:target-too-large gap (M7 -- it is never issued as a call).
  const heavy = [{ modelKey: 'arch', roots: [rootOf(1, 0), rootOf(2, 1)] },
    { modelKey: 'struct', roots: [{ dbId: 7, owners: [7], fragments: [frag(0, 7), frag(1, 7), frag(2, 7)] }] }];
  const gap = await plan2({ ...args, models: heavy, options: { ...RUN_OPTION_DEFAULTS, maxTargetFragmentsPerUnit: 1 } });
  assert.equal(gap.status, 'planned');
  assert.equal(gap.preTerminalGapWeight, 2);
  const units = gap.ledger.toLedgerRecord().units;
  const fromLedger = units.filter((u) => u.kind === 'leaf' && u.outcome === 'not-run').reduce((n, u) => n + u.pairSpaceWeight, 0);
  assert.equal(gap.preTerminalGapWeight, fromLedger);
  assert.deepEqual([...new Set(units.filter((u) => u.outcome === 'not-run').map((u) => u.cause))], ['target-too-large']);
  assert.equal(gap.plan.units.length, 0);
  assert.equal(gap.plan.pairSpaceTotal, gap.preTerminalGapWeight);
  assert.equal(gap.ledger.toLedgerRecord().pairSpaceTotal, gap.preTerminalGapWeight);
  // A plan with no such gap reports 0, and a failed plan reports 0.
  const clean = await plan2(args);
  assert.equal(clean.status, 'planned');
  assert.equal(clean.preTerminalGapWeight, 0);
  const failed = await plan2({ ...args, options: { ...RUN_OPTION_DEFAULTS, maxPlanReferences: 1 } });
  assert.equal(failed.status, 'failed');
  assert.equal(failed.preTerminalGapWeight, 0);
});

test('R11: gaps and issuable units share one id sequence and both are unit records in the ledger', async () => {
  // Source root 1 vs whole-model struct (3 fragments > cap 2) plus a light explicit model: 1 gap + 1 unit in cell 1.
  const models = [{ modelKey: 'arch', roots: [rootOf(1, 0)] },
    { modelKey: 'light', roots: [rootOf(5, 0)] },
    { modelKey: 'struct', roots: [{ dbId: 7, owners: [7], fragments: [frag(0, 7), frag(1, 7), frag(2, 7)] }] }];
  const res = await plan2({ models, keys: ['arch', 'light', 'struct'],
    A: [{ kind: 'elements', modelKey: 'arch', dbIds: [1] }],
    B: [{ kind: 'elements', modelKey: 'light', dbIds: [5] }, { kind: 'model', modelKey: 'struct' }],
    options: { ...RUN_OPTION_DEFAULTS, maxTargetFragmentsPerUnit: 2 } });
  assert.equal(res.status, 'planned');
  const rec = res.ledger.toLedgerRecord();
  assert.deepEqual(rec.units.map((u) => [u.unitId, u.outcome, u.cause]), [['1.0', null, null], ['1.1', 'not-run', 'target-too-large']]);
  assert.deepEqual(res.plan.units.map((u) => u.unitId), ['1.0']);
  assert.equal(res.plan.gaps.length, 1);
  assert.equal(res.plan.gaps[0].unitId, '1.1');
  assert.equal(res.preTerminalGapWeight, 1);
  assert.equal(rec.pairSpaceTotal, 2);
});

test('R2: a hierarchy-internal (A∩B) root is recoverable from the PERSISTED ledger alone', async () => {
  const spec = [{ modelKey: 'm', roots: [
    { dbId: 10, owners: [10], fragments: [{ fragId: 0, ownerDbId: 10, geometryId: 1 }] },
    { dbId: 20, owners: [20, 21], fragments: [{ fragId: 1, ownerDbId: 20, geometryId: 1 },
      { fragId: 2, ownerDbId: 21, geometryId: 1 }] }] }];
  const { enumerator, binding } = makeSyntheticEnumerator(spec);
  const res = await createPlan({
    definition: defOf({ A: [{ kind: 'model', modelKey: 'm' }], B: [{ kind: 'model', modelKey: 'm' }] }),
    snapshot: snapshotOf(binding, ['m']), enumerator, options: RUN_OPTION_DEFAULTS, checkpoint: () => {} });
  const record = JSON.parse(JSON.stringify(res.ledger.toLedgerRecord()));   // persisted form only
  const rows = record.rootOwners.find((r) => r.modelKey === 'm').owners;
  assert.deepEqual(rows.map((r) => [r.rootDbId, r.cls]), [[10, 'C'], [20, 'C']]);
  const internal = rows.filter((r) => r.cls === 'C' && r.ownerDbIds.length >= 2).map((r) => r.rootDbId);
  assert.deepEqual(internal, [20]);
  assert.equal(record.hierarchyInternal[0].rootCount, internal.length);
  const res2 = await createPlan({
    definition: defOf({ A: [{ kind: 'elements', modelKey: 'm', dbIds: [10] }],
      B: [{ kind: 'elements', modelKey: 'm', dbIds: [20] }] }),
    snapshot: snapshotOf(binding, ['m']), enumerator, options: RUN_OPTION_DEFAULTS, checkpoint: () => {} });
  assert.deepEqual(res2.ledger.toLedgerRecord().rootOwners[0].owners.map((r) => [r.rootDbId, r.cls]),
    [[10, 'A'], [20, 'B']]);
});

test('the persisted ledger carries the planning sections: planExists, exclusions, rows, unit records', async () => {
  const spec = [{ modelKey: 'm', roots: [rootOf(10, 0)], unreachable: [{ fragId: 5, cls: 'L', ownerDbId: 99, geometryId: 1 }] },
    { modelKey: 'n', roots: [rootOf(3, 0)], emptyDbIds: [55] }];
  const res = await plan2({ models: spec, keys: ['m', 'n'],
    A: [{ kind: 'model', modelKey: 'm' }], B: [{ kind: 'model', modelKey: 'n' }, { kind: 'elements', modelKey: 'n', dbIds: [55] }] });
  const rec = res.ledger.toLedgerRecord();
  assert.equal(rec.planExists, true);
  assert.equal(rec.emptyOperand, false);
  assert.deepEqual(rec.exclusions, ['tree-unreachable-population']);
  assert.equal(rec.unreachablePopulation.length, 1);
  assert.equal(rec.unreachablePopulation[0].modelKey, 'm');
  assert.equal(rec.units.length, res.plan.units.length);
  assert.deepEqual(rec.planningGaps, []);
  // The resolved-roots row is the ledger's copy, not an alias of the plan's.
  assert.notEqual(rec.rootOwners, res.plan.models.get('m').rootOwners);
});

test('the planner yields: checkpoint is awaited at least once per model', async () => {
  const { enumerator, binding } = makeSyntheticEnumerator(twoModels());
  let n = 0;
  await createPlan({ definition: defOf({ A: [{ kind: 'model', modelKey: 'arch' }], B: [{ kind: 'model', modelKey: 'struct' }] }),
    snapshot: snapshotOf(binding, ['arch', 'struct']), enumerator,
    options: RUN_OPTION_DEFAULTS, checkpoint: async () => { n++; } });
  assert.ok(n >= 2);
});

test('the planner yields once per cell batch after resolution (§17.3), not only per model', async () => {
  // Post-resolution checkpoints = every checkpoint after the last enumerator answer. A plan with four cell batches
  // (1, 2, 3a, 3b) must yield at least three more times than a plan with one (3b only).
  const postResolution = async (models, A, B) => {
    const { enumerator, binding } = makeSyntheticEnumerator(models);
    let ticks = 0;
    let atLastEnumeration = 0;
    const wrapped = { ...enumerator, resolveRoots: async (...a) => { const r = await enumerator.resolveRoots(...a); atLastEnumeration = ticks; return r; } };
    const res = await createPlan({ definition: defOf({ A, B }), snapshot: snapshotOf(binding, models.map((m) => m.modelKey)),
      enumerator: wrapped, options: RUN_OPTION_DEFAULTS, checkpoint: async () => { ticks++; } });
    return { extra: ticks - atLastEnumeration, cells: new Set(res.plan.units.map((u) => u.cell)).size };
  };
  const one = await postResolution([{ modelKey: 'm', roots: [rootOf(1, 0), rootOf(2, 1), rootOf(3, 2)] }],
    [{ kind: 'model', modelKey: 'm' }], [{ kind: 'model', modelKey: 'm' }]);
  const four4 = () => Array.from({ length: 4 }, (_, i) => rootOf(i + 1, i));
  const four = await postResolution([{ modelKey: 'a', roots: four4() }, { modelKey: 'b', roots: four4() }],
    [{ kind: 'elements', modelKey: 'a', dbIds: [1, 2, 3] }, { kind: 'elements', modelKey: 'b', dbIds: [1, 2, 3] }],
    [{ kind: 'elements', modelKey: 'a', dbIds: [2, 3, 4] }, { kind: 'elements', modelKey: 'b', dbIds: [2, 3, 4] }]);
  assert.equal(one.cells, 1);
  assert.equal(four.cells, 4);
  assert.ok(four.extra - one.extra >= 3, `one batch ${one.extra} vs four batches ${four.extra}`);
});

test('a cancelling checkpoint rejects with the enumeration error, unwrapped (never a synchronous throw)', async () => {
  const { enumerator, binding } = makeSyntheticEnumerator(twoModels());
  const promise = createPlan({ definition: defOf({ A: [{ kind: 'model', modelKey: 'arch' }], B: [{ kind: 'model', modelKey: 'struct' }] }),
    snapshot: snapshotOf(binding, ['arch', 'struct']), enumerator, options: RUN_OPTION_DEFAULTS,
    checkpoint: () => { throw new EnumerationCancelledError({ reason: 'test' }); } });
  assert.ok(promise instanceof Promise);
  await assert.rejects(promise, (e) => e.name === 'EnumerationCancelledError');
});

test('R1: a malformed call is a rejected promise, never a synchronous throw', async () => {
  let promise;
  assert.doesNotThrow(() => { promise = createPlan({}); });
  assert.ok(promise instanceof Promise);
  await assert.rejects(promise, TypeError);
  assert.doesNotThrow(() => { promise = createPlan(undefined); });
  await assert.rejects(promise, TypeError);
});

test('an unbound model fails planning model-not-bound with a failed result and no plan', async () => {
  const { enumerator } = makeSyntheticEnumerator(twoModels());
  const res = await createPlan({ definition: defOf({ A: [{ kind: 'model', modelKey: 'arch' }], B: [{ kind: 'model', modelKey: 'struct' }] }),
    snapshot: snapshotOf(new Map([['arch', null]]), ['arch', 'struct']), enumerator, options: RUN_OPTION_DEFAULTS, checkpoint: () => {} });
  assert.equal(res.status, 'failed');
  assert.equal(res.plan, null);
  assert.deepEqual(res.planningGaps.map((g) => [g.phase, g.cause]), [['planning', 'model-not-bound']]);
  assert.deepEqual(res.ledger.toLedgerRecord().planningGaps, [{ phase: 'planning', cause: 'model-not-bound' }]);   // detail is run-scoped
  assert.equal(enumerator.calls.length, 0);
});

test('a root that owns no fragment (fragmentCount 0) fails planning enumeration-failed, never phantom pair space', async () => {
  const models = [{ modelKey: 'm', roots: [{ dbId: 1, owners: [1], fragments: [] }, rootOf(2, 0)] }];
  const res = await plan2({ models, keys: ['m'], A: [{ kind: 'model', modelKey: 'm' }], B: [{ kind: 'model', modelKey: 'm' }] });
  assert.equal(res.status, 'failed');
  assert.deepEqual(res.planningGaps.map((g) => g.cause), ['enumeration-failed']);
  assert.equal(res.plan, null);
});

test('(d-unit) hierarchy-overlap surfaces the first offenders as run-scoped detail and records only {phase, cause}', async () => {
  const models = [{ modelKey: 'm', roots: [{ dbId: 100, owners: [100, 105],
    fragments: [frag(0, 100), frag(1, 105)] }], ancestorOf: { 105: 100 } }];
  const res = await plan2({ models, keys: ['m'], A: [{ kind: 'elements', modelKey: 'm', dbIds: [100] }],
    B: [{ kind: 'elements', modelKey: 'm', dbIds: [105] }] });
  assert.equal(res.status, 'failed');
  assert.equal(res.planningGaps[0].cause, 'hierarchy-overlap');
  assert.deepEqual(res.planningGaps[0].detail.offenders, [{ ancestor: 100, descendant: 105 }]);
  assert.deepEqual(res.ledger.toLedgerRecord().planningGaps, [{ phase: 'planning', cause: 'hierarchy-overlap' }]);
});

test('empty operands (§6.6 item 4): zero units, emptyOperand, a warning, status planned', async () => {
  const models = [{ modelKey: 'm', roots: [rootOf(1, 0)], emptyDbIds: [55] }];
  const res = await plan2({ models, keys: ['m'], A: [{ kind: 'elements', modelKey: 'm', dbIds: [55] }],
    B: [{ kind: 'model', modelKey: 'm' }] });
  assert.equal(res.status, 'planned');
  assert.deepEqual(res.plan.units, []);
  assert.equal(res.plan.pairSpaceTotal, 0);
  const rec = res.ledger.toLedgerRecord();
  assert.equal(rec.emptyOperand, true);
  assert.equal(rec.pairSpaceTotal, 0);
  assert.deepEqual(rec.warnings, [{ code: 'empty-operand' }]);
  assert.equal(rec.planExists, true);
  assert.equal(rec.unresolvedSelections.length, 1);           // the no-fragments record stays visible
});

test('a single-root self test has no required pair: zero units, but NOT an empty operand', async () => {
  const models = [{ modelKey: 'm', roots: [rootOf(1, 0)] }];
  const res = await plan2({ models, keys: ['m'], A: [{ kind: 'model', modelKey: 'm' }], B: [{ kind: 'model', modelKey: 'm' }] });
  assert.equal(res.status, 'planned');
  assert.equal(res.plan.units.length, 0);
  assert.equal(res.ledger.toLedgerRecord().emptyOperand, false);
  assert.equal(res.ledger.toLedgerRecord().pairSpaceTotal, 0);
});

test('the plan is deep-frozen EXCEPT plan.ledger (D10), and the ledger is the very object PlanResult.ledger names', async () => {
  const res = await plan2({ A: [{ kind: 'model', modelKey: 'arch' }], B: [{ kind: 'model', modelKey: 'struct' }] });
  const { plan } = res;
  assert.equal(plan.ledger, res.ledger);
  assert.equal(Object.isFrozen(plan), true);
  assert.equal(Object.isFrozen(res.ledger), false);
  assert.equal(Object.isFrozen(plan.units), true);
  assert.equal(Object.isFrozen(plan.units[0]), true);
  assert.equal(Object.isFrozen(plan.units[0].sourceRanges[0]), true);
  assert.equal(Object.isFrozen(plan.units[0].targets[0]), true);
  assert.equal(Object.isFrozen(plan.tables), true);
  assert.equal(Object.isFrozen(plan.models.get('arch')), true);
  assert.equal(Object.isFrozen(plan.models.get('arch').classes["A'"]), true);
  assert.equal(Object.isFrozen(plan.models.get('arch').classes["A'"][0]), true);
  assert.equal(Object.isFrozen(plan.models.get('arch').scopeDigests.roots[0]), true);
  assert.equal(Object.isFrozen(plan.selectionKindByRole), true);
  assert.equal(Object.isFrozen(plan.sizing), true);
  assert.throws(() => { plan.units.push({}); }, TypeError);
  assert.throws(() => { plan.units[0].pairSpaceWeight = 0; }, TypeError);
  assert.throws(() => { plan.models.set('x', {}); });
  assert.throws(() => { plan.ownersByModel.delete('arch'); });
  // the live ledger keeps accumulating (a runtime split writes through it):
  const split = planSplit(plan, plan.units[0]);
  assert.ok(split.children, JSON.stringify(split));
  assert.equal(res.ledger.unitRecord(plan.units[0].unitId).kind, 'split');
});

test('the Plan shape: aliases, tables, weights, records, sizing', async () => {
  const res = await plan2({ A: [{ kind: 'model', modelKey: 'arch' }], B: [{ kind: 'model', modelKey: 'struct' }] });
  const { plan } = res;
  assert.equal(createPlan, planRun);
  assert.equal(splitUnit, planSplit);
  assert.equal(plan.modelsByKey, plan.models);
  assert.deepEqual(plan.selectionKindByRole, { A: [{ modelKey: 'arch', kind: 'model' }], B: [{ modelKey: 'struct', kind: 'model' }] });
  assert.deepEqual([...plan.models.keys()], ['arch', 'struct']);
  assert.equal(plan.unitsById.get(plan.units[0].unitId), plan.units[0]);
  assert.equal(plan.pairSpaceTotal, plan.units.reduce((n, u) => n + u.pairSpaceWeight, 0));
  assert.equal(plan.planRecords > 0, true);
  assert.equal(plan.planRecords <= RUN_OPTION_DEFAULTS.maxPlanReferences, true);
  assert.deepEqual(plan.sizing, {
    maxSourceFragmentsPerUnit: RUN_OPTION_DEFAULTS.maxSourceFragmentsPerUnit,
    maxSourceDbIdsPerUnit: RUN_OPTION_DEFAULTS.maxSourceDbIdsPerUnit,
    maxTargetModelsPerUnit: RUN_OPTION_DEFAULTS.maxTargetModelsPerUnit,
    maxTargetFragmentsPerUnit: RUN_OPTION_DEFAULTS.maxTargetFragmentsPerUnit,
  });
  assert.equal(plan.rangeOfClass('arch', "A'").end, 2);
  assert.equal(res.planningGaps.length, 0);
});

test('plan entries are detached from the enumerator: freezing the plan never freezes an enumerator-owned array', async () => {
  const { enumerator, binding } = makeSyntheticEnumerator(twoModels());
  const answers = [];
  const spy = { ...enumerator, resolveRoots: async (...a) => { const r = await enumerator.resolveRoots(...a); answers.push(r); return r; } };
  await createPlan({ definition: defOf({ A: [{ kind: 'model', modelKey: 'arch' }], B: [{ kind: 'model', modelKey: 'struct' }] }),
    snapshot: snapshotOf(binding, ['arch', 'struct']), enumerator: spy, options: RUN_OPTION_DEFAULTS, checkpoint: () => {} });
  for (const a of answers) for (const r of a.roots) assert.equal(Object.isFrozen(r.ownerDbIds), false);
});

test('rootsForRanges returns ascending root dbIds behind a range list (a [C, B\'] target is not globally ascending)', async () => {
  const models = [{ modelKey: 'm', roots: [rootOf(30, 0), rootOf(10, 1), rootOf(20, 2), rootOf(5, 3)] }];
  const res = await plan2({ models, keys: ['m'],
    A: [{ kind: 'elements', modelKey: 'm', dbIds: [10, 30] }], B: [{ kind: 'elements', modelKey: 'm', dbIds: [5, 20, 30] }] });
  // C = {30}, A' = {10}, B' = {5, 20}. Cell 1 target ranges are ordered [C, B'] = [30, 5, 20].
  const cell1 = res.plan.units.find((u) => u.cell === '1');
  const flat = cell1.targets[0].scope.ranges.flatMap((r) => rootsForRanges(res.plan, [r]));
  assert.deepEqual(flat, [30, 5, 20]);
  assert.deepEqual(rootsForRanges(res.plan, cell1.targets[0].scope.ranges), [5, 20, 30]);
  assert.deepEqual(materializeUnit(res.plan, cell1).targets[0].dbIds, [5, 20, 30]);
});

test('materializeUnit is a pure read: it never mutates the plan, and its output is detached from it', async () => {
  const res = await plan2({ A: [{ kind: 'model', modelKey: 'arch' }], B: [{ kind: 'model', modelKey: 'struct' }] });
  const before = JSON.stringify(res.plan.units);
  const a = materializeUnit(res.plan, res.plan.units[0]);
  a.sourceDbIds.push(999);
  a.scopeExpect[0].roots.push({ dbId: 1, subtreeDigest: 'x' });
  const b = materializeUnit(res.plan, res.plan.units[0]);
  assert.deepEqual(b.sourceDbIds, [1, 2]);
  assert.equal(b.scopeExpect[0].roots.length, 2);
  assert.equal(JSON.stringify(res.plan.units), before);
  const pop = b.scopeExpect.find((s) => s.scope === 'whole');
  assert.equal(Object.isFrozen(pop.population), false);          // a copy, so a caller can never poke the plan's own
});

test('materializeUnit reaches split children too (they are plain, unfrozen units)', async () => {
  const models = [{ modelKey: 'm', roots: Array.from({ length: 4 }, (_, i) => rootOf(i + 1, i)) }];
  const res = await plan2({ models, keys: ['m'], A: [{ kind: 'model', modelKey: 'm' }], B: [{ kind: 'model', modelKey: 'm' }] });
  const parent = res.plan.units[0];
  const split = planSplit(res.plan, parent);
  const [left, right] = split.children;
  const ids = [left, right].flatMap((c) => materializeUnit(res.plan, c).sourceDbIds);
  assert.deepEqual(ids.sort((a, b) => a - b), materializeUnit(res.plan, parent).sourceDbIds.sort((a, b) => a - b));
});

test('a caller-supplied ledger is planned into and returned (P6 A17): planning gaps and units land in the one object', async () => {
  const { enumerator, binding } = makeSyntheticEnumerator(twoModels());
  const budget = createRecordBudget(RUN_OPTION_DEFAULTS);
  const ledger = createLedger({ limits: RUN_OPTION_DEFAULTS, budget });
  const res = await createPlan({ definition: defOf({ A: [{ kind: 'model', modelKey: 'arch' }], B: [{ kind: 'model', modelKey: 'struct' }] }),
    snapshot: snapshotOf(binding, ['arch', 'struct']), enumerator, options: RUN_OPTION_DEFAULTS, checkpoint: () => {}, ledger });
  assert.equal(res.ledger, ledger);
  assert.equal(res.plan.ledger, ledger);
  assert.equal(ledger.unitRecordCount, res.plan.units.length);
  assert.equal(budget.planRecords, res.plan.planRecords);
  assert.equal(budget.reserveUnitSlots(), true);                 // idempotent: the planner already reserved
  // the reserve was taken by the planner: a taint-overflow slot is consumable for a planned unit
  assert.equal(budget.consumeReservedSlot(res.plan.units[0].unitId), true);
});

test('a caller-supplied ledger whose budget the planner cannot reach is a caller bug (rejected)', async () => {
  const { enumerator, binding } = makeSyntheticEnumerator(twoModels());
  await assert.rejects(createPlan({ definition: defOf({ A: [{ kind: 'model', modelKey: 'arch' }], B: [{ kind: 'model', modelKey: 'struct' }] }),
    snapshot: snapshotOf(binding, ['arch', 'struct']), enumerator, options: RUN_OPTION_DEFAULTS, checkpoint: () => {},
    ledger: { recordUnit() {} } }), TypeError);
});

test('planning reserves the overflow slots and asserts the budget identity (step 7)', async () => {
  const res = await plan2({ A: [{ kind: 'model', modelKey: 'arch' }], B: [{ kind: 'model', modelKey: 'struct' }] });
  const budget = res.ledger.budget;
  const { maxLedgerRecords, maxUnitsPerRun } = RUN_OPTION_DEFAULTS;
  assert.equal(budget.used, budget.planRecords + maxUnitsPerRun);
  assert.equal(budget.planRecords + maxUnitsPerRun <= maxLedgerRecords, true);
});

test('a budget that cannot hold the overflow reserve is an internal error (rejected), never a silent overrun', async () => {
  const args = { A: [{ kind: 'model', modelKey: 'arch' }], B: [{ kind: 'model', modelKey: 'struct' }] };
  const need = (await plan2(args)).plan.planRecords;
  // planning fits (need <= maxLedgerRecords) but need + maxUnitsPerRun does not: the cross-field rule of options.js is violated
  const options = { ...RUN_OPTION_DEFAULTS, maxUnitsPerRun: 50, maxPlanReferences: need, maxLedgerRecords: need + 10 };
  await assert.rejects(plan2({ ...args, options }), /internal-error/);
});

test('unit records and ranges are charged as blocks: planRecords covers tables, rows, and every unit and range record', async () => {
  const res = await plan2({ A: [{ kind: 'model', modelKey: 'arch' }], B: [{ kind: 'model', modelKey: 'struct' }] });
  // arch: 2 roots (A'), 2 owners; struct: 1 root (B'), 1 owner; scope-digest: 2 populations + 3 root rows;
  // units: 1 unit record + (1 source range + 1 whole target entry) ranges.
  const expected = 3 + 3 + (2 + 3) + 1 + 2;
  assert.equal(res.plan.planRecords, expected);
});

test('sizing options change chunking, never coverage: tight caps plan the same required pair space', async () => {
  const models = [{ modelKey: 'arch', roots: Array.from({ length: 6 }, (_, i) => rootOf(i + 1, i)) },
    { modelKey: 'struct', roots: Array.from({ length: 5 }, (_, i) => rootOf(i + 21, i)) }];
  const args = { models, A: [{ kind: 'model', modelKey: 'arch' }], B: [{ kind: 'elements', modelKey: 'struct', dbIds: [21, 22, 23, 24, 25] }] };
  const loose = await plan2(args);
  const tight = await plan2({ ...args, options: { ...RUN_OPTION_DEFAULTS, maxSourceDbIdsPerUnit: 2, maxTargetFragmentsPerUnit: 2 } });
  assert.equal(loose.plan.units.length, 1);
  assert.equal(tight.plan.units.length, 3 * 3);
  assert.equal(tight.plan.pairSpaceTotal, loose.plan.pairSpaceTotal);
  assert.equal(tight.plan.pairSpaceTotal, 30);
});

test('an oversized plan is refused after limit+1 units, never after building the whole cross product (spec 6.5.1)', async () => {
  // 1500 source roots x 1500 target roots at one root per unit is 2.25M units unbounded; with maxUnitsPerRun 10 the
  // sizer must stop at 11. (Time is a proxy: the bounded path is milliseconds, the unbounded one seconds and ~1 GB.)
  const N = 1500;
  const models = [{ modelKey: 'a', roots: Array.from({ length: N }, (_, i) => rootOf(i + 1, i)) },
    { modelKey: 'b', roots: Array.from({ length: N }, (_, i) => rootOf(i + 1, i)) }];
  const started = performance.now();
  const res = await plan2({ models, keys: ['a', 'b'], A: [{ kind: 'model', modelKey: 'a' }], B: [{ kind: 'elements', modelKey: 'b', dbIds: Array.from({ length: N }, (_, i) => i + 1) }],
    options: { ...RUN_OPTION_DEFAULTS, maxUnitsPerRun: 10, maxSourceDbIdsPerUnit: 1, maxTargetFragmentsPerUnit: 1 } });
  const elapsed = performance.now() - started;
  assert.equal(res.status, 'failed');
  assert.deepEqual(res.planningGaps.map((g) => g.cause), ['plan-too-large']);
  assert.equal(res.planningGaps[0].detail.overflowClass, 'unit-record');
  assert.ok(elapsed < 500, `planning took ${Math.round(elapsed)} ms: the unit cap is not applied while sizing`);
});

// R20-1 is "every model the unit uses as a SOURCE through a kind:'model' selection" (spec 16.3.2; AC-8: an explicit-list
// source has no population digest). The role a unit's source occupies follows its orientation: A->B is selection A,
// B->A is selection B, and the unordered canonical pairs (source in both roles) count either.
const sourceWholeOf = (plan, unit) => materializeUnit(plan, unit).scopeExpect.filter((s) => s.role === 'source' && s.scope === 'whole');

test('R20-1 is per source ROLE: an A-explicit source of a model that B names whole has NO population entry', async () => {
  const args = { A: [{ kind: 'elements', modelKey: 'arch', dbIds: [1, 2] }],
    B: [{ kind: 'model', modelKey: 'arch' }, { kind: 'model', modelKey: 'struct' }] };
  const { plan } = await plan2({ ...args });
  const cell2 = plan.units.find((u) => u.cell === '2');
  assert.ok(cell2, 'C_arch -> B\'_struct');
  assert.equal(cell2.orientationRole, 'A->B');
  assert.deepEqual(sourceWholeOf(plan, cell2), []);
  assert.equal(materializeUnit(plan, cell2).scopeExpect.some((s) => s.role === 'target' && s.modelKey === 'struct' && s.scope === 'whole'), true);
});

test('R20-1 in ordered mode: the A->B call of a self test has no source population, its B->A call (source in whole-model B) has one', async () => {
  const { plan } = await plan2({ mode: 'containment', keys: ['arch'], A: [{ kind: 'elements', modelKey: 'arch', dbIds: [1, 2] }],
    B: [{ kind: 'model', modelKey: 'arch' }] });
  const forward = plan.units.find((u) => u.cell === '3b' && u.orientationRole === 'A->B');
  const backward = plan.units.find((u) => u.cell === '3b' && u.orientationRole === 'B->A');
  assert.deepEqual(sourceWholeOf(plan, forward), []);
  assert.equal(sourceWholeOf(plan, backward).length, 1);
});

test('R20-1 for the unordered canonical pair: either role naming the model whole brackets its population', async () => {
  const { plan } = await plan2({ keys: ['arch'], A: [{ kind: 'elements', modelKey: 'arch', dbIds: [1, 2] }], B: [{ kind: 'model', modelKey: 'arch' }] });
  const u = plan.units.find((x) => x.cell === '3b');
  assert.equal(u.orientationRole, 'canonical');
  assert.equal(sourceWholeOf(plan, u).length, 1);
});
