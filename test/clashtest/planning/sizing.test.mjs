// test/clashtest/planning/sizing.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sizeUnits, sizeUnitsSliced, SIZING_BATCH_LABEL, unitIdFor, rangeRecordCount, pairSpaceWeightOf, targetEntryWeight, targetEntryRootCount, targetWeightOf, unitRecordFields } from '../../../clashtest/planning/sizing.js';
import { decomposeCells } from '../../../clashtest/planning/decompose.js';
import { buildRootTables, readRange } from '../../../clashtest/planning/planTables.js';
import { createRecordBudget } from '../../../clashtest/planning/ledger.js';
import { RUN_OPTION_DEFAULTS } from '../../../clashtest/options.js';
import { makeSizingFixture } from '../support/syntheticModels.mjs';

const rootsIn = (ranges) => ranges.reduce((n, r) => n + (r.end - r.start), 0);
const opts = (over = {}) => ({ ...RUN_OPTION_DEFAULTS, ...over });

test('source side is a PACKING TARGET: one root heavier than the cap forms its own unit', () => {
  const { cells, plan } = makeSizingFixture({ sourceWeights: [1, 1, 500, 1], targets: [{ modelKey: 'y', weight: 10 }] });
  const { units } = sizeUnits({ cells, plan, options: opts({ maxSourceFragmentsPerUnit: 10 }) });
  const sizes = units.map((u) => rootsIn(u.sourceRanges));
  assert.deepEqual(sizes, [2, 1, 1]);          // [1,1] packed, then 500 alone, then 1
});

test('source packing also honors maxSourceDbIdsPerUnit', () => {
  const { cells, plan } = makeSizingFixture({ sourceWeights: [1, 1, 1, 1, 1], targets: [{ modelKey: 'y' }] });
  const { units } = sizeUnits({ cells, plan, options: opts({ maxSourceDbIdsPerUnit: 2 }) });
  assert.deepEqual(units.map((u) => rootsIn(u.sourceRanges)), [2, 2, 1]);
});

test('target caps are HARD: no unit exceeds maxTargetModelsPerUnit or maxTargetFragmentsPerUnit', () => {
  const { cells, plan } = makeSizingFixture({ sourceWeights: [1],
    targets: ['a', 'b', 'c', 'd', 'e'].map((modelKey) => ({ modelKey, weight: 1 })) });
  const o = opts({ maxTargetModelsPerUnit: 2, maxTargetFragmentsPerUnit: 12 });
  const { units } = sizeUnits({ cells, plan, options: o });
  assert.ok(units.length >= 3);
  for (const u of units) {
    assert.ok(u.targets.length <= o.maxTargetModelsPerUnit);
    assert.ok(u.targetWeight <= o.maxTargetFragmentsPerUnit);
  }
  // 5 single-root models of weight 1: [a,b] [c,d] [e]: the model cap, not the weight cap, binds.
  assert.deepEqual(units.map((u) => u.targets.map((t) => t.modelKey)), [['a', 'b'], ['c', 'd'], ['e']]);
});

test('the target FRAGMENT cap is hard even when the model cap has room (weight, not just count)', () => {
  const { cells, plan } = makeSizingFixture({ sourceWeights: [1],
    targets: [{ modelKey: 'a', weight: 9 }, { modelKey: 'b', weight: 9 }] });
  const { units } = sizeUnits({ cells, plan, options: opts({ maxTargetModelsPerUnit: 4, maxTargetFragmentsPerUnit: 12 }) });
  assert.deepEqual(units.map((u) => u.targets.map((t) => t.modelKey)), [['a'], ['b']]);
  assert.deepEqual(units.map((u) => u.targetWeight), [9, 9]);
});

test('an explicit-root target entry is cut BETWEEN roots, never inside one', () => {
  const { cells, plan } = makeSizingFixture({ sourceWeights: [1], targets: [{ modelKey: 'a', rootWeights: [7, 7, 7] }] });
  const { units } = sizeUnits({ cells, plan, options: opts({ maxTargetFragmentsPerUnit: 14, maxTargetModelsPerUnit: 4 }) });
  assert.equal(units.length, 2);
  assert.deepEqual(units.map((u) => u.targetWeight), [14, 7]);
  // Every cut is a whole-root boundary: the two units' target ranges tile the model's roots exactly.
  const covered = units.flatMap((u) => u.targets.flatMap((t) => t.scope.ranges.flatMap((r) => readRange(plan, r))));
  assert.deepEqual(covered, [1, 2, 3]);
});

test('an unsplittable over-cap target entry becomes a not-run:target-too-large gap, never a call (M7)', () => {
  for (const spec of [{ modelKey: 'a', whole: true, weight: 50 }, { modelKey: 'a', rootWeights: [50] }]) {
    const { cells, plan } = makeSizingFixture({ sourceWeights: [1, 1], targets: [spec] });
    const { units, gaps } = sizeUnits({ cells, plan, options: opts({ maxTargetFragmentsPerUnit: 20 }) });
    assert.deepEqual(units, []);
    assert.equal(gaps.length, 1);
    assert.equal(gaps[0].outcome, 'not-run');
    assert.equal(gaps[0].cause, 'target-too-large');
    assert.equal(gaps[0].pairSpaceWeight, 2 * 1);
  }
});

test('a gap is a unit-shaped record: unit id, cell, source and target scope, weight (P5 records it as a leaf unit)', () => {
  const { cells, plan } = makeSizingFixture({ sourceWeights: [1, 1], targets: [{ modelKey: 'a', rootWeights: [50] }, { modelKey: 'b', whole: true, weight: 60 }] });
  const { units, gaps } = sizeUnits({ cells, plan, options: opts({ maxTargetFragmentsPerUnit: 20 }) });
  assert.deepEqual(units, []);
  assert.deepEqual(gaps.map((g) => g.unitId), ['1.0', '1.1']);
  assert.deepEqual(gaps.map((g) => g.targets), [
    [{ modelKey: 'a', scope: { ranges: [{ table: 't0', start: 0, end: 1 }] } }],
    [{ modelKey: 'b', scope: 'whole' }],
  ]);
  for (const g of gaps) {
    assert.equal(g.cell, '1');
    assert.equal(g.sourceModelKey, 'src');
    assert.deepEqual(g.sourceRanges, [{ table: 't2', start: 0, end: 2 }]);   // tables are positional in modelKey order: a, b, src
    assert.equal(g.orientationRole, 'A->B');
  }
});

test('only the OVERSIZE roots of a mixed entry become gaps; its fitting roots still run', () => {
  const { cells, plan } = makeSizingFixture({ sourceWeights: [1], targets: [{ modelKey: 'a', rootWeights: [7, 50, 7] }] });
  const { units, gaps } = sizeUnits({ cells, plan, options: opts({ maxTargetFragmentsPerUnit: 14 }) });
  assert.deepEqual(units.map((u) => u.targetWeight), [14]);
  assert.deepEqual(units.flatMap((u) => u.targets.flatMap((t) => t.scope.ranges.flatMap((r) => readRange(plan, r)))), [1, 3]);
  assert.equal(gaps.length, 1);
  assert.deepEqual(gaps[0].targets[0].scope.ranges.flatMap((r) => readRange(plan, r)), [2]);
  assert.equal(gaps[0].pairSpaceWeight, 1);
  assert.equal(units.reduce((n, u) => n + u.pairSpaceWeight, 0) + gaps.reduce((n, g) => n + g.pairSpaceWeight, 0), 3);
});

test('a whole-model sentinel weighs its POPULATION count (every fragId), not its roots\' fragment sum', () => {
  // One root of 3 fragments, but the population holds 50 (unreachable / dropped fragments): over the cap of 20.
  const { cells, plan } = makeSizingFixture({ sourceWeights: [1], targets: [{ modelKey: 'a', whole: true, rootWeights: [3], population: 50 }] });
  const { units, gaps } = sizeUnits({ cells, plan, options: opts({ maxTargetFragmentsPerUnit: 20 }) });
  assert.deepEqual(units, []);
  assert.equal(gaps.length, 1);
  const fits = makeSizingFixture({ sourceWeights: [1], targets: [{ modelKey: 'a', whole: true, rootWeights: [3], population: 20 }] });
  const ok = sizeUnits({ cells: fits.cells, plan: fits.plan, options: opts({ maxTargetFragmentsPerUnit: 20 }) });
  assert.equal(ok.gaps.length, 0);
  assert.equal(ok.units[0].targetWeight, 20);      // exactly the cap is legal: the bound is `weight <= cap`
});

test('the cap boundary is inclusive: weight === maxTargetFragmentsPerUnit fits, +1 is a gap', () => {
  for (const [w, gapCount, unitCount] of [[20, 0, 1], [21, 1, 0]]) {
    const { cells, plan } = makeSizingFixture({ sourceWeights: [1], targets: [{ modelKey: 'a', rootWeights: [w] }] });
    const r = sizeUnits({ cells, plan, options: opts({ maxTargetFragmentsPerUnit: 20 }) });
    assert.deepEqual([r.gaps.length, r.units.length], [gapCount, unitCount]);
  }
});

test('a whole-model sentinel is never partitioned: it is placed alone in its slice', () => {
  const { cells, plan } = makeSizingFixture({ sourceWeights: [1],
    targets: [{ modelKey: 'a', weight: 5 }, { modelKey: 'b', whole: true, weight: 5 }, { modelKey: 'c', weight: 5 }] });
  const { units } = sizeUnits({ cells, plan, options: opts({ maxTargetModelsPerUnit: 4, maxTargetFragmentsPerUnit: 100 }) });
  assert.deepEqual(units.map((u) => u.targets.map((t) => [t.modelKey, t.scope === 'whole'])),
    [[['a', false]], [['b', true]], [['c', false]]]);
});

test('a whole sentinel with many roots contributes its run-start ROOT count to pairSpaceWeight', () => {
  const { cells, plan } = makeSizingFixture({ sourceWeights: [1, 1, 1], targets: [{ modelKey: 'a', whole: true, roots: 4, weight: 2 }] });
  const { units } = sizeUnits({ cells, plan, options: opts() });
  assert.equal(units.length, 1);
  assert.equal(units[0].pairSpaceWeight, 3 * 4);
  assert.equal(units[0].targetWeight, 8);                  // 4 roots x 2 fragments = the population
  assert.deepEqual(units[0].targets, [{ modelKey: 'a', scope: 'whole' }]);
});

test('unit ids are `${cell}.${seq}` in canonical plan order and weights sum to the pair space', () => {
  const { cells, plan, expectedPairSpace } = makeSizingFixture({ sourceWeights: [1, 1], targets: [{ modelKey: 'y', weight: 2, roots: 2 }] });
  const { units } = sizeUnits({ cells, plan, options: RUN_OPTION_DEFAULTS });
  assert.ok(units.every((u) => /^(1|2|3a|3b)\.\d+$/.test(u.unitId)));
  assert.equal(units.reduce((n, u) => n + u.pairSpaceWeight, 0), expectedPairSpace);
});

test('the unit id sequence is per cell, zero-based, in emission order (source chunk outer, target slice inner)', () => {
  const { cells, plan } = makeSizingFixture({ sourceWeights: [1, 1], targets: [{ modelKey: 'a', rootWeights: [1, 1] }] });
  const { units } = sizeUnits({ cells, plan, options: opts({ maxSourceDbIdsPerUnit: 1, maxTargetFragmentsPerUnit: 1 }) });
  assert.deepEqual(units.map((u) => u.unitId), ['1.0', '1.1', '1.2', '1.3']);
  assert.deepEqual(units.map((u) => [rootsIn(u.sourceRanges), u.sourceRanges[0].start]), [[1, 0], [1, 0], [1, 1], [1, 1]]);
  assert.equal(unitIdFor('3a', 7), '3a.7');
});

test('a unit carries exactly the WorkUnit keys, ranges only (spec 6.5), and its inputs are never mutated', () => {
  const { cells, plan } = makeSizingFixture({ sourceWeights: [1, 1], targets: [{ modelKey: 'y', roots: 2 }] });
  const frozen = structuredClone(cells);
  const { units } = sizeUnits({ cells, plan, options: RUN_OPTION_DEFAULTS });
  assert.deepEqual(Object.keys(units[0]).sort(),
    ['cell', 'orientationRole', 'pairSpaceWeight', 'sourceModelKey', 'sourceRanges', 'targetWeight', 'targets', 'unitId']);
  assert.equal(JSON.stringify(units).includes('dbIds'), false);
  assert.deepEqual(cells, frozen);
  // A unit never aliases a cell's own range objects.
  assert.notEqual(units[0].sourceRanges[0], cells[0].sourceRanges[0]);
});

test('changing sizing options changes chunking, never coverage', () => {
  const { cells, plan } = makeSizingFixture({ sourceWeights: [1, 1, 1, 1], targets: [{ modelKey: 'y', rootWeights: [1, 1, 1] }] });
  const total = (o) => sizeUnits({ cells, plan, options: opts(o) }).units.reduce((n, u) => n + u.pairSpaceWeight, 0);
  assert.equal(total({ maxSourceDbIdsPerUnit: 1 }), total({}));
  assert.equal(total({ maxTargetModelsPerUnit: 1, maxTargetFragmentsPerUnit: 1 }), total({}));
  assert.equal(total({}), 4 * 3);
});

test('sizing packs targets in the order the cell lists them: canonical ordering is decompose.js\'s job, not a silent re-sort here', () => {
  // (Codex P3 review: the previous version of this test called makeSizingFixture, which sorts targets, so it could not
  // fail whatever sizeUnits did. Order independence of the whole PLAN is pinned by planner.property.test.mjs, which
  // shuffles the enumerator answers and checks byte-identity, and by decompose.test.mjs canonical emission order.)
  const targets = ['d', 'a', 'c', 'b'].map((modelKey) => ({ modelKey, rootWeights: [3, 4] }));
  const o = opts({ maxTargetModelsPerUnit: 4, maxTargetFragmentsPerUnit: 100 });
  const { cells, plan } = makeSizingFixture({ sourceWeights: [1], targets });
  const reversed = [{ ...cells[0], targets: [...cells[0].targets].reverse() }];
  const first = sizeUnits({ cells, plan, options: o }).units[0].targets.map((t) => t.modelKey);
  const second = sizeUnits({ cells: reversed, plan, options: o }).units[0].targets.map((t) => t.modelKey);
  assert.deepEqual(first, ['a', 'b', 'c', 'd']);   // the fixture lists canonical (ascending) order
  assert.deepEqual(second, ['d', 'c', 'b', 'a']);  // sizing follows the cell's order; it must not reorder
});

test('an invalid sizing option is a caller bug: fail closed, never NaN comparisons that read as "fits"', () => {
  const { cells, plan } = makeSizingFixture({ sourceWeights: [1], targets: [{ modelKey: 'y' }] });
  for (const key of ['maxSourceFragmentsPerUnit', 'maxSourceDbIdsPerUnit', 'maxTargetModelsPerUnit', 'maxTargetFragmentsPerUnit']) {
    for (const bad of [0, -1, NaN, 1.5, undefined]) {
      assert.throws(() => sizeUnits({ cells, plan, options: opts({ [key]: bad }) }), TypeError, `${key}=${bad}`);
    }
  }
});

test('a whole target the plan holds no population for is a caller bug, never a guessed weight', () => {
  const { cells, plan } = makeSizingFixture({ sourceWeights: [1], targets: [{ modelKey: 'a', whole: true, weight: 5 }] });
  assert.throws(() => sizeUnits({ cells, plan: { ...plan, models: new Map() }, options: opts() }), TypeError);
});

test('the exported weight helpers agree with the sizer: whole = population/root count, explicit = fragment/root sums', () => {
  const { plan, cells } = makeSizingFixture({ sourceWeights: [1],
    targets: [{ modelKey: 'a', rootWeights: [3, 4] }, { modelKey: 'b', whole: true, rootWeights: [2, 2], population: 9 }] });
  const [a, b] = cells[0].targets;
  assert.deepEqual([targetEntryWeight(plan, a), targetEntryRootCount(plan, a)], [7, 2]);
  assert.deepEqual([targetEntryWeight(plan, b), targetEntryRootCount(plan, b)], [9, 2]);
  assert.equal(targetWeightOf(plan, [a, b]), 16);
  assert.equal(pairSpaceWeightOf(plan, cells[0].sourceRanges, [a, b]), 1 * 4);
});

test('unitRecordFields is the P5 self-describing form of a unit: ids expanded from ranges, the sentinel spelled `model`', () => {
  const { plan, cells } = makeSizingFixture({ sourceWeights: [1, 1, 1],
    targets: [{ modelKey: 'a', rootWeights: [1, 1] }, { modelKey: 'b', whole: true, rootWeights: [2] }] });
  const { units } = sizeUnits({ cells, plan, options: opts({ maxSourceDbIdsPerUnit: 2 }) });
  const f = unitRecordFields(plan, units[0]);
  assert.deepEqual(f, { unitId: '1.0', sourceModelKey: 'src', sourceRootDbIds: [1, 2],
    targets: [{ modelKey: 'a', scope: 'roots', rootDbIds: [1, 2] }], pairSpaceWeight: 4, ranges: 4 });   // A14: 2 + 2 ids
  assert.deepEqual(unitRecordFields(plan, units[1]).targets, [{ modelKey: 'b', scope: 'model' }]);
  assert.equal(unitRecordFields(plan, units[1]).ranges, 3);          // A14: two source ids + the sentinel entry
});

// ---- through decomposeCells, on real class tables (C then B' ranges; cell 3b multi-range sources) ------------------

function realPlan(defs) {   // defs: [{modelKey, A: [dbId], B: [dbId]}] -> {models, plan}
  const row = (dbId) => ({ dbId, fragmentCount: 1, ownerDbIds: [dbId], subtreeDigest: `sha256:${dbId}` });
  const models = new Map(defs.map((d) => {
    const A = new Set(d.A); const B = new Set(d.B);
    const all = [...new Set([...d.A, ...d.B])].sort((a, b) => a - b);
    return [d.modelKey, { A: d.A, B: d.B, wholeA: false, wholeB: !!d.wholeB, classes: {
      "A'": all.filter((x) => A.has(x) && !B.has(x)).map(row),
      C: all.filter((x) => A.has(x) && B.has(x)).map(row),
      "B'": all.filter((x) => !A.has(x) && B.has(x)).map(row) } }];
  }));
  const built = buildRootTables({ models: [...models].map(([modelKey, m]) => ({ modelKey, classes: m.classes })),
    budget: createRootBudget() });
  const pops = new Map([...models].map(([k, m]) => [k, { scopeDigests: { population: { count: m.A.length + m.B.length, digest: 'sha256:p' }, roots: [] } }]));
  return { models, plan: { ...built, models: pops } };
}
function createRootBudget() { return createRecordBudget({ maxPlanReferences: 1e6, maxLedgerRecords: 3e6, maxUnitsPerRun: 1e4 }); }

test('a target listed as [C, B\'] ranges is sliced by RANGE order, so a cut can fall between the two tables', () => {
  // Model m: A = {1,2,3}, B = {2,3,4,5}: A'={1}, C={2,3}, B'={4,5}. Cell 1 sources {1}; its target is m's B = C then B'.
  const { models, plan } = realPlan([{ modelKey: 'm', A: [1, 2, 3], B: [2, 3, 4, 5] }]);
  const cells = decomposeCells({ models, plan, ordered: false }).filter((c) => c.cell === '1');
  assert.equal(cells.length, 1);
  const { units } = sizeUnits({ cells, plan, options: opts({ maxTargetFragmentsPerUnit: 3 }) });
  const targetIds = units.map((u) => u.targets.flatMap((t) => t.scope.ranges.flatMap((r) => readRange(plan, r))));
  assert.deepEqual(targetIds, [[2, 3, 4], [5]]);                 // 3 then 1: [C] + first of [B'], then the rest of [B']
  assert.deepEqual(units[0].targets[0].scope.ranges.map((r) => plan.tableById.get(r.table).cls), ['C', "B'"]);
});

test('over a full decomposition: every cell sizes, ids are unique per cell, and weights sum to the cover', () => {
  const { models, plan } = realPlan([
    { modelKey: 'a', A: [1, 2, 3, 4], B: [3, 4, 5] }, { modelKey: 'b', A: [7, 8], B: [7, 8, 9] }]);
  const cells = decomposeCells({ models, plan, ordered: true });
  const cellPairs = cells.reduce((n, c) => n + rootsIn(c.sourceRanges) * c.targets.reduce((m, t) => m + rootsIn(t.scope === 'whole' ? [plan.rangeOfClass(t.modelKey, "B'")] : t.scope.ranges), 0), 0);
  for (const o of [opts(), opts({ maxSourceDbIdsPerUnit: 1, maxTargetFragmentsPerUnit: 1, maxTargetModelsPerUnit: 1 })]) {
    const { units, gaps } = sizeUnits({ cells, plan, options: o });
    assert.deepEqual(gaps, []);
    assert.equal(units.reduce((n, u) => n + u.pairSpaceWeight, 0), cellPairs);
    assert.equal(new Set(units.map((u) => u.unitId)).size, units.length);
    for (const u of units) assert.equal(u.pairSpaceWeight, pairSpaceWeightOf(plan, u.sourceRanges, u.targets));
    assert.ok(units.every((u) => rangeRecordCount(u) >= 2));
  }
});

test('an optional `limit` stops sizing as soon as units + gaps exceed it: no cross product is built past the cap (spec 6.5.1)', () => {
  const { cells, plan } = makeSizingFixture({ sourceWeights: Array(50).fill(1), targets: [{ modelKey: 't', roots: 50 }] });
  const tight = opts({ maxSourceDbIdsPerUnit: 1, maxTargetFragmentsPerUnit: 1 });     // 50 x 50 = 2,500 units unbounded
  const full = sizeUnits({ cells, plan, options: tight });
  assert.equal(full.units.length, 2500);
  assert.equal(full.exceeded, false);
  const capped = sizeUnits({ cells, plan, options: tight, limit: 7 });
  assert.equal(capped.exceeded, true);
  assert.equal(capped.units.length + capped.gaps.length, 8);                         // limit + the one that tripped it
  const exact = sizeUnits({ cells, plan, options: tight, limit: 2500 });
  assert.equal(exact.exceeded, false);                                               // inclusive: exactly the limit fits
  assert.equal(exact.units.length, 2500);
  for (const bad of [-1, 1.5, NaN, '3']) assert.throws(() => sizeUnits({ cells, plan, options: tight, limit: bad }), TypeError);
});

test('`limit` counts gaps too', () => {
  const { cells, plan } = makeSizingFixture({ sourceWeights: [1, 1], targets: [{ modelKey: 'w', whole: true, population: 9 }] });
  const r = sizeUnits({ cells, plan, options: opts({ maxTargetFragmentsPerUnit: 4, maxSourceDbIdsPerUnit: 1 }), limit: 1 });   // two source chunks -> two gaps
  assert.equal(r.exceeded, true);
  assert.equal(r.units.length + r.gaps.length, 2);
});

// ---- H1/H2: sizing consumes any iterable lazily and has a sliced form sharing the synchronous logic ---------------------

test('sizeUnitsSliced returns exactly what sizeUnits returns, ticking inside packing, slicing and unit construction and once per cell batch', async () => {
  const { cells, plan } = makeSizingFixture({ sourceWeights: [1, 1, 1, 1, 1, 1, 1], targets: [{ modelKey: 'a', roots: 5 }, { modelKey: 'b', roots: 4 }, { modelKey: 'w', whole: true }] });
  const o = opts({ maxSourceDbIdsPerUnit: 2, maxTargetFragmentsPerUnit: 3, maxTargetModelsPerUnit: 2 });
  const twoCells = [...cells, { ...cells[0], cell: '2' }];
  const labels = [];
  const sliced = await sizeUnitsSliced({ cells: twoCells, plan, options: o }, { tick: (label) => { labels.push(label); } });
  assert.deepEqual(sliced, sizeUnits({ cells: twoCells, plan, options: o }));
  assert.equal(labels.filter((l) => l === SIZING_BATCH_LABEL).length, 2);                // one per cell id
  for (const kind of ['sizing:source-root', 'sizing:target-root', 'sizing:target-entry', 'sizing:unit']) assert.ok(labels.includes(kind), kind);
  // The limit behaves identically in the sliced form.
  const capped = await sizeUnitsSliced({ cells: twoCells, plan, options: o, limit: 3 }, { tick() {} });
  assert.deepEqual(capped, sizeUnits({ cells: twoCells, plan, options: o, limit: 3 }));
  assert.equal(capped.exceeded, true);
});

test('sizing releases a lazy cell generator as soon as it stops, and a cancelling tick abandons it (H1, H2)', async () => {
  const { cells, plan } = makeSizingFixture({ sourceWeights: [1, 1, 1, 1], targets: [{ modelKey: 'y', roots: 4 }] });
  let closed = 0;
  function* lazyCells() { try { for (let i = 0; i < 100; i++) yield cells[0]; } finally { closed += 1; } }
  const o = opts({ maxSourceDbIdsPerUnit: 1, maxTargetFragmentsPerUnit: 1 });
  assert.equal(sizeUnits({ cells: lazyCells(), plan, options: o, limit: 2 }).exceeded, true);
  assert.equal(closed, 1);
  const boom = new Error('cancelled');
  let n = 0;
  await assert.rejects(sizeUnitsSliced({ cells: lazyCells(), plan, options: o }, { tick: () => { if (++n === 5) throw boom; } }), (e) => e === boom);
  assert.equal(closed, 2);
});
