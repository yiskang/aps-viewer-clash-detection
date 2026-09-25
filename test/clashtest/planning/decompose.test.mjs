// test/clashtest/planning/decompose.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decomposeCells, decomposeCellsLazy, targetScopeFor, CELL_IDS } from '../../../clashtest/planning/decompose.js';
import { buildRootTables, readRange, rangeRootCount, bisectRanges } from '../../../clashtest/planning/planTables.js';
import { sizeUnits } from '../../../clashtest/planning/sizing.js';
import { RUN_OPTION_DEFAULTS } from '../../../clashtest/options.js';
import { createRecordBudget } from '../../../clashtest/planning/ledger.js';

const budget = () => createRecordBudget({ maxPlanReferences: 1e6, maxLedgerRecords: 3e6, maxUnitsPerRun: 1e4 });
const row = (dbId) => ({ dbId, fragmentCount: 1, ownerDbIds: [dbId], subtreeDigest: `sha256:${dbId}` });

// Reference: the required pair space of §6.1, straight from the definition of A and B.
function requiredPairs(models, ordered) {
  const out = new Set();
  for (const [mk, m] of models) for (const x of m.A) for (const [nk, n] of models) for (const y of n.B) {
    if (mk === nk && x === y) continue;
    out.add(ordered ? `${mk}:${x}>${nk}:${y}` : [`${mk}:${x}`, `${nk}:${y}`].sort().join('|'));
  }
  return out;
}
// The roots a target entry stands for. A whole-model sentinel is B_n: the model's C and B' roots (its A' roots are
// not in B, and the sentinel is only legal for a model that has none).
function targetRoots(plan, t) {
  if (t.scope === 'whole') return ['C', "B'"].map((cls) => plan.rangeOfClass(t.modelKey, cls)).filter(Boolean).flatMap((r) => readRange(plan, r));
  return t.scope.ranges.flatMap((r) => readRange(plan, r));
}
function coveredPairs(plan, cells, ordered) {
  const out = [];
  for (const c of cells) for (const s of c.sourceRanges.flatMap(r => readRange(plan, r)))
    for (const t of c.targets) {
      for (const y of targetRoots(plan, t)) {
        if (c.sourceModelKey === t.modelKey && s === y) continue;
        out.push(ordered ? `${c.sourceModelKey}:${s}>${t.modelKey}:${y}`
                         : [`${c.sourceModelKey}:${s}`, `${t.modelKey}:${y}`].sort().join('|'));
      }
    }
  return out;
}

function fixture(defs) {   // defs: [{modelKey, A:[dbId], B:[dbId], wholeA, wholeB}]
  const models = new Map(defs.map(d => {
    const A = new Set(d.A), B = new Set(d.B), all = [...new Set([...d.A, ...d.B])].sort((a, b) => a - b);
    return [d.modelKey, {
      A: d.A, B: d.B, wholeA: !!d.wholeA, wholeB: !!d.wholeB,
      classes: { "A'": all.filter(x => A.has(x) && !B.has(x)).map(row),
                 C:    all.filter(x => A.has(x) && B.has(x)).map(row),
                 "B'": all.filter(x => !A.has(x) && B.has(x)).map(row) },
    }];
  }));
  const plan = buildRootTables({ models: [...models].map(([modelKey, m]) => ({ modelKey, classes: m.classes })),
                                budget: budget() });
  return { models, plan };
}

test('cross-model disjoint selections collapse to cell 1 only', () => {
  const { models, plan } = fixture([{ modelKey: 'x', A: [1, 2], B: [] }, { modelKey: 'y', A: [], B: [7, 8] }]);
  const cells = decomposeCells({ models, plan, ordered: false });
  assert.deepEqual([...new Set(cells.map(c => c.cell))], ['1']);
  const got = coveredPairs(plan, cells, false);
  assert.deepEqual(new Set(got), requiredPairs(models, false));
  assert.equal(got.length, new Set(got).size);           // exactly once
});

test('A = B in one model collapses to cell 3b and covers every unordered pair exactly once (F2)', () => {
  const { models, plan } = fixture([{ modelKey: 'm', A: [1, 2, 3, 4, 5], B: [1, 2, 3, 4, 5] }]);
  const cells = decomposeCells({ models, plan, ordered: false });
  assert.deepEqual([...new Set(cells.map(c => c.cell))], ['3b']);
  const got = coveredPairs(plan, cells, false);
  assert.deepEqual(new Set(got), requiredPairs(models, false));
  assert.equal(got.length, new Set(got).size);
  assert.equal(got.length, (5 * 4) / 2);
  // F2: every same-model cell has disjoint source/target root sets.
  for (const c of cells) for (const t of c.targets) {
    if (t.modelKey !== c.sourceModelKey) continue;
    const s = new Set(c.sourceRanges.flatMap(r => readRange(plan, r)));
    for (const y of t.scope.ranges.flatMap(r => readRange(plan, r))) assert.equal(s.has(y), false);
  }
});

test('partial same-model overlap uses all four cells and still covers exactly once', () => {
  const { models, plan } = fixture([
    { modelKey: 'a', A: [1, 2, 3], B: [2, 3, 4] },
    { modelKey: 'b', A: [5, 6], B: [6, 7] },
  ]);
  const cells = decomposeCells({ models, plan, ordered: false });
  assert.deepEqual([...new Set(cells.map(c => c.cell))].sort(), ['1', '2', '3a', '3b']);
  const got = coveredPairs(plan, cells, false);
  assert.deepEqual(new Set(got), requiredPairs(models, false));
  assert.equal(got.length, new Set(got).size);
});

test('ordered mode (containment) covers each ordered pair exactly once', () => {
  const { models, plan } = fixture([{ modelKey: 'a', A: [1, 2, 3], B: [2, 3] },
                                    { modelKey: 'b', A: [4], B: [4, 5] }]);
  const cells = decomposeCells({ models, plan, ordered: true });
  const got = coveredPairs(plan, cells, true);
  assert.deepEqual(new Set(got), requiredPairs(models, true));
  assert.equal(got.length, new Set(got).size);
  assert.deepEqual([...new Set(cells.map(c => c.orientationRole))].sort(), ['A->B', 'B->A']);
});

test('the whole-model sentinel is used only when the model carries no source-role root', () => {
  const { models, plan } = fixture([{ modelKey: 'x', A: [1], B: [] },
                                    { modelKey: 'y', A: [], B: [7, 8], wholeB: true }]);
  const cells = decomposeCells({ models, plan, ordered: false });
  assert.deepEqual(cells[0].targets.map(t => t.scope), ['whole']);
  const { models: m2, plan: p2 } = fixture([{ modelKey: 'x', A: [1], B: [], },
                                            { modelKey: 'y', A: [9], B: [7, 8], wholeB: true }]);
  const cells2 = decomposeCells({ models: m2, plan: p2, ordered: false });
  for (const c of cells2) for (const t of c.targets) assert.notEqual(t.scope, 'whole');
});

test('cells are emitted in canonical order and are byte-identical under model reordering', () => {
  const f1 = fixture([{ modelKey: 'a', A: [1], B: [2] }, { modelKey: 'b', A: [3], B: [4] }]);
  const f2 = fixture([{ modelKey: 'b', A: [3], B: [4] }, { modelKey: 'a', A: [1], B: [2] }]);
  const norm = (f) => JSON.stringify(decomposeCells({ models: f.models, plan: f.plan, ordered: false })
    .map(c => ({ ...c, sourceRanges: c.sourceRanges.map(r => readRange(f.plan, r)),
                 targets: c.targets.map(t => ({ modelKey: t.modelKey,
                   scope: t.scope === 'whole' ? 'whole' : t.scope.ranges.map(r => readRange(f.plan, r)) })) })));
  assert.equal(norm(f1), norm(f2));
});

// ---- beyond the plan's excerpt --------------------------------------------------------------------------------

// Small deterministic PRNG (the property suite of P3.9 owns the big seeded run; this one pins decompose alone).
const seeded = (seed) => () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };

function randomDefs(rng) {
  const modelCount = 1 + Math.floor(rng() * 3);
  let nextId = 1;
  return Array.from({ length: modelCount }, (_, i) => {
    const roots = Array.from({ length: Math.floor(rng() * 7) }, () => nextId++);
    const wholeB = rng() < 0.35;
    const A = [], B = [];
    for (const r of roots) {
      const inB = wholeB || rng() < 0.5;
      if (rng() < 0.55) A.push(r);
      if (inB) B.push(r);
    }
    return { modelKey: `m${i}`, A, B, wholeB };
  });
}

test('exact cover against the brute-force pair space over seeded random universes, unordered AND ordered', () => {
  const rng = seeded(20260921);
  let sawWhole = 0;
  for (let round = 0; round < 250; round++) {
    const { models, plan } = fixture(randomDefs(rng));
    for (const ordered of [false, true]) {
      const cells = decomposeCells({ models, plan, ordered });
      const got = coveredPairs(plan, cells, ordered);
      assert.deepEqual(new Set(got), requiredPairs(models, ordered), `round ${round} ordered=${ordered}: coverage`);
      assert.equal(got.length, new Set(got).size, `round ${round} ordered=${ordered}: exactly once`);
      for (const c of cells) {
        assert.ok(CELL_IDS.includes(c.cell));
        const src = new Set(c.sourceRanges.flatMap((r) => readRange(plan, r)));
        assert.ok(src.size > 0, 'a cell never has an empty source');
        assert.ok(c.targets.length > 0, 'a cell never has an empty target list');
        for (const t of c.targets) {
          const ys = targetRoots(plan, t);
          assert.ok(ys.length > 0);
          // Same-model safety: a source root is never in its own model's target population, so the library's
          // fragment-membership self-exclusion (F2) has nothing to suppress.
          if (t.modelKey === c.sourceModelKey) for (const y of ys) assert.equal(src.has(y), false, `round ${round}: source root ${y} in own target`);
          if (t.scope === 'whole') {
            sawWhole += 1;
            const m = models.get(t.modelKey);
            assert.ok(m.wholeB && m.A.length === 0, 'a whole sentinel needs kind:model B and an empty A_n');
          }
        }
      }
    }
  }
  assert.ok(sawWhole > 20, 'the property run must actually exercise whole-model targets');
});

test('sentinel eligibility (D3): whole iff B is kind:model AND A_n is empty, in cell 1 and in cell 2 alike', () => {
  const model = (A, wholeB, roots = 2) => ({ A, wholeB, classes: { "A'": A.map(row), C: [], "B'": Array.from({ length: roots }, (_, i) => row(100 + i)) } });
  assert.equal(targetScopeFor(model([], true), []), 'whole');
  assert.deepEqual(targetScopeFor(model([], false), ['r']), { ranges: ['r'] });     // B is an explicit list: never whole
  assert.deepEqual(targetScopeFor(model([1], true), ['r']), { ranges: ['r'] });     // A_n non-empty: never whole
  // The condition reads the class tables, so it holds for the real resolveSelectionRoots entries (no `A` array there).
  assert.equal(targetScopeFor({ wholeB: true, classes: { "A'": [], C: [], "B'": [row(1)] } }, []), 'whole');
  assert.deepEqual(targetScopeFor({ wholeB: true, classes: { "A'": [], C: [row(1)], "B'": [] } }, ['r']), { ranges: ['r'] });
  assert.deepEqual(targetScopeFor({ wholeB: true, classes: { "A'": [row(1)], C: [], "B'": [] } }, ['r']), { ranges: ['r'] });

  // Cell 1 AND cell 2: a whole-B model with no source roots is a sentinel in both; with an A root, in neither.
  const { models, plan } = fixture([
    { modelKey: 'a', A: [1], B: [1] },                       // has C: sources for cell 2 and 3
    { modelKey: 'x', A: [5], B: [], },                       // has A': source for cell 1
    { modelKey: 'w', A: [], B: [9, 10], wholeB: true },      // eligible sentinel
    { modelKey: 'v', A: [11], B: [11, 12], wholeB: true },   // whole B but A_n non-empty: explicit
  ]);
  const cells = decomposeCells({ models, plan, ordered: false });
  const scopeIn = (cell, source, target) => cells.find((c) => c.cell === cell && c.sourceModelKey === source).targets.find((t) => t.modelKey === target).scope;
  assert.equal(scopeIn('1', 'x', 'w'), 'whole');
  assert.equal(scopeIn('2', 'a', 'w'), 'whole');
  assert.notEqual(scopeIn('1', 'x', 'v'), 'whole');
  assert.notEqual(scopeIn('2', 'a', 'v'), 'whole');
  assert.equal(coveredPairs(plan, cells, false).length, new Set(coveredPairs(plan, cells, false)).size);
});

test('cell 3b bisects C_m to n - 1 nodes (2 x (n - 1) ordered) and never splits a root', () => {
  for (const n of [1, 2, 3, 5, 8]) {
    const roots = Array.from({ length: n }, (_, i) => i + 1);
    const { models, plan } = fixture([{ modelKey: 'm', A: roots, B: roots }]);
    const unordered = decomposeCells({ models, plan, ordered: false });
    const ordered = decomposeCells({ models, plan, ordered: true });
    assert.equal(unordered.length, n - 1);
    assert.equal(ordered.length, 2 * (n - 1));
    for (const c of ordered) assert.ok(c.sourceRanges.every((r) => r.end > r.start));
  }
  // The reference order: the root cut first (left half = floor(n / 2)), then recursion into L, then R.
  const { models, plan } = fixture([{ modelKey: 'm', A: [1, 2, 3, 4, 5], B: [1, 2, 3, 4, 5] }]);
  const shape = decomposeCells({ models, plan, ordered: false })
    .map((c) => [c.sourceRanges.flatMap((r) => readRange(plan, r)), c.targets[0].scope.ranges.flatMap((r) => readRange(plan, r))]);
  assert.deepEqual(shape, [[[1, 2], [3, 4, 5]], [[1], [2]], [[3], [4, 5]], [[4], [5]]]);
});

test('canonical emission order: cell 1, cell 2, cell 3a, cell 3b; source models ascending within a cell; 3a pairs m < n', () => {
  const { models, plan } = fixture([
    { modelKey: 'c', A: [30, 31, 33], B: [31, 32, 33] }, { modelKey: 'a', A: [10, 11, 13], B: [11, 12, 13] },
    { modelKey: 'b', A: [20, 21, 23], B: [21, 22, 23] },
  ]);
  const cells = decomposeCells({ models, plan, ordered: false });
  assert.deepEqual(cells.map((c) => `${c.cell}:${c.sourceModelKey}`), [
    '1:a', '1:b', '1:c', '2:a', '2:b', '2:c', '3a:a', '3a:a', '3a:b', '3b:a', '3b:b', '3b:c',
  ]);
  assert.deepEqual(cells.filter((c) => c.cell === '3a').map((c) => [c.sourceModelKey, c.targets[0].modelKey]), [['a', 'b'], ['a', 'c'], ['b', 'c']]);
  const ord = decomposeCells({ models, plan, ordered: true });
  assert.deepEqual(ord.filter((c) => c.cell === '3a').map((c) => `${c.sourceModelKey}>${c.targets[0].modelKey}:${c.orientationRole}`),
    ['a>b:A->B', 'b>a:B->A', 'a>c:A->B', 'c>a:B->A', 'b>c:A->B', 'c>b:B->A']);
});

test('orientationRole: cells 1 and 2 are A->B; unordered 3a/3b are canonical; ordered 3a/3b carry both orientations', () => {
  const { models, plan } = fixture([{ modelKey: 'a', A: [1, 2, 3], B: [2, 3, 4] }, { modelKey: 'b', A: [5, 6], B: [6, 7] }]);
  const roles = (ordered) => {
    const byCell = {};
    for (const c of decomposeCells({ models, plan, ordered })) (byCell[c.cell] ??= new Set()).add(c.orientationRole);
    return Object.fromEntries(Object.entries(byCell).map(([k, v]) => [k, [...v].sort()]));
  };
  assert.deepEqual(roles(false), { 1: ['A->B'], 2: ['A->B'], '3a': ['canonical'], '3b': ['canonical'] });
  assert.deepEqual(roles(true), { 1: ['A->B'], 2: ['A->B'], '3a': ['A->B', 'B->A'], '3b': ['A->B', 'B->A'] });
});

test('cells carry ranges and model keys only: no copied dbId array, no Model object (§6.5)', () => {
  const { models, plan } = fixture([{ modelKey: 'a', A: [1, 2], B: [2, 3] }, { modelKey: 'w', A: [], B: [9], wholeB: true }]);
  for (const c of decomposeCells({ models, plan, ordered: true })) {
    assert.deepEqual(Object.keys(c).sort(), ['cell', 'orientationRole', 'sourceModelKey', 'sourceRanges', 'targets']);
    for (const r of c.sourceRanges) assert.deepEqual(Object.keys(r).sort(), ['end', 'start', 'table']);
    for (const t of c.targets) {
      assert.deepEqual(Object.keys(t).sort(), ['modelKey', 'scope']);
      if (t.scope !== 'whole') for (const r of t.scope.ranges) assert.deepEqual(Object.keys(r).sort(), ['end', 'start', 'table']);
    }
  }
});

test('empty operands decompose to no cells; a model with no roots is skipped', () => {
  const { models, plan } = fixture([{ modelKey: 'a', A: [], B: [] }, { modelKey: 'b', A: [1], B: [] }]);
  assert.deepEqual(decomposeCells({ models, plan, ordered: false }), []);
  assert.deepEqual(decomposeCells({ models: new Map(), plan: fixture([]).plan, ordered: true }), []);
});

test('the cell list depends only on the class tables: a fresh decomposition is identical, and ranges are fresh objects', () => {
  const { models, plan } = fixture([{ modelKey: 'a', A: [1, 2, 3], B: [2, 3, 4] }]);
  const one = decomposeCells({ models, plan, ordered: true });
  const two = decomposeCells({ models, plan, ordered: true });
  assert.deepEqual(one, two);
  one[0].sourceRanges[0].start = 99;                       // mutating a returned range must not reach the plan or a later call
  assert.deepEqual(decomposeCells({ models, plan, ordered: true }), two);
});

// ---- H1: lazy decomposition (spec 6.5.1 plan memory O(roots + owners + unit records), spec 17.3) ------------------------

// The pre-remediation EAGER implementation, kept verbatim as the byte-identity oracle: the lazy generator must emit
// exactly what it did, in the same order, for every case that completes.
function referenceDecomposeCells({ models, plan, ordered }) {
  const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const keys = [...models.keys()].sort(byCodeUnit);
  const cells = [];
  const rangeOf = (modelKey, cls) => plan.rangeOfClass(modelKey, cls);
  const targetsOf = (classes) => keys.flatMap((nk) => {
    const ranges = classes.map((cls) => rangeOf(nk, cls)).filter(Boolean);
    return ranges.length === 0 ? [] : [{ modelKey: nk, scope: targetScopeFor(models.get(nk), ranges) }];
  });
  for (const mk of keys) {
    const source = rangeOf(mk, "A'");
    if (!source) continue;
    const targets = targetsOf(['C', "B'"]);
    if (targets.length > 0) cells.push({ cell: '1', sourceModelKey: mk, sourceRanges: [source], targets, orientationRole: 'A->B' });
  }
  for (const mk of keys) {
    const source = rangeOf(mk, 'C');
    if (!source) continue;
    const targets = targetsOf(["B'"]);
    if (targets.length > 0) cells.push({ cell: '2', sourceModelKey: mk, sourceRanges: [source], targets, orientationRole: 'A->B' });
  }
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const a = rangeOf(keys[i], 'C');
      const b = rangeOf(keys[j], 'C');
      if (!a || !b) continue;
      cells.push({ cell: '3a', sourceModelKey: keys[i], sourceRanges: [a], targets: [{ modelKey: keys[j], scope: { ranges: [b] } }],
        orientationRole: ordered ? 'A->B' : 'canonical' });
      if (ordered) {
        cells.push({ cell: '3a', sourceModelKey: keys[j], sourceRanges: [b], targets: [{ modelKey: keys[i], scope: { ranges: [a] } }],
          orientationRole: 'B->A' });
      }
    }
  }
  for (const mk of keys) {
    const c = rangeOf(mk, 'C');
    if (!c) continue;
    const bisect = (ranges) => {
      if (ranges.reduce((n, r) => n + rangeRootCount(r), 0) <= 1) return;
      const [left, right] = bisectRanges(plan, ranges);
      cells.push({ cell: '3b', sourceModelKey: mk, sourceRanges: left, targets: [{ modelKey: mk, scope: { ranges: right } }],
        orientationRole: ordered ? 'A->B' : 'canonical' });
      if (ordered) {
        cells.push({ cell: '3b', sourceModelKey: mk, sourceRanges: right, targets: [{ modelKey: mk, scope: { ranges: left } }],
          orientationRole: 'B->A' });
      }
      bisect(left);
      bisect(right);
    };
    bisect([c]);
  }
  return cells;
}

test('the lazy generator emits byte-identically what the eager decomposition emitted, unordered and ordered (H1)', () => {
  const rng = seeded(7742);
  for (let round = 0; round < 250; round++) {
    const { models, plan } = fixture(randomDefs(rng));
    for (const ordered of [false, true]) {
      const lazy = [...decomposeCellsLazy({ models, plan, ordered })];
      assert.equal(JSON.stringify(lazy), JSON.stringify(referenceDecomposeCells({ models, plan, ordered })), `round ${round} ordered=${ordered}`);
      assert.equal(JSON.stringify(decomposeCells({ models, plan, ordered })), JSON.stringify(lazy));
    }
  }
});

// A model per index, one row per class (dbId 1 / 2), with `wholeB: false` so every target is an explicit range.
const manyModels = (count, classesOf) => {
  const models = new Map(Array.from({ length: count }, (_, i) => [`m${String(i).padStart(5, '0')}`, { wholeB: false, classes: classesOf() }]));
  const plan = buildRootTables({ models: [...models].map(([modelKey, m]) => ({ modelKey, classes: m.classes })), budget: budget() });
  assert.equal(plan.ok, true);
  return { models, plan };
};
// The counting seams: every plan lookup the generator makes, and every cell the consumer pulls from it.
const counted = (plan) => {
  const stats = { rangeOfCalls: 0 };
  return { stats, plan: { ...plan, rangeOfClass: (modelKey, cls) => { stats.rangeOfCalls += 1; return plan.rangeOfClass(modelKey, cls); } } };
};
function* pulled(cells, stats) { for (const cell of cells) { stats.pulled += 1; yield cell; } }

for (const ordered of [false, true]) {
  test(`many-model class-C case (ordered=${ordered}): the unit cap stops decomposition after limit+1 units, not after all M(M-1)/2 pair cells (H1)`, () => {
    const M = 1024;
    const limit = 10;
    const { models, plan } = manyModels(M, () => ({ C: [row(1)] }));
    const { plan: seen, stats } = counted(plan);
    const pulls = { pulled: 0 };
    const res = sizeUnits({ cells: pulled(decomposeCellsLazy({ models, plan: seen, ordered }), pulls), plan: seen, options: RUN_OPTION_DEFAULTS, limit });
    assert.equal(res.exceeded, true);
    assert.equal(res.units.length + res.gaps.length, limit + 1);
    assert.ok(pulls.pulled >= 1 && pulls.pulled <= limit + 1, `cells generated: ${pulls.pulled}`);
    // O(M) prefilter of the class tables + O(1) per generated cell; the eager form did ~ M^2 lookups (and built 523,776 cells).
    assert.ok(stats.rangeOfCalls <= 6 * M + 4 * (limit + 1), `plan lookups: ${stats.rangeOfCalls}`);
  });
}

test('many-model A\'/B\' case: the per-cell target list is built once, so target entries are O(M), not O(M^2) (H1)', () => {
  const M = 1024;
  const limit = 10;
  const { models, plan } = manyModels(M, () => ({ "A'": [row(1)], "B'": [row(2)] }));
  // (a) capped consumption: bounded cells AND bounded lookups.
  const { plan: seen, stats } = counted(plan);
  const pulls = { pulled: 0 };
  const res = sizeUnits({ cells: pulled(decomposeCellsLazy({ models, plan: seen, ordered: false }), pulls), plan: seen, options: RUN_OPTION_DEFAULTS, limit });
  assert.equal(res.exceeded, true);
  assert.equal(res.units.length + res.gaps.length, limit + 1);
  assert.ok(pulls.pulled >= 1 && pulls.pulled <= limit + 1, `cells generated: ${pulls.pulled}`);
  assert.ok(stats.rangeOfCalls <= 8 * M, `plan lookups: ${stats.rangeOfCalls}`);   // the eager form: ~ M^2 lookups
  // (b) a full run of the generator: 1,024 cells, but the distinct target-entry lists total O(M) entries, not M x M.
  const all = [...decomposeCellsLazy({ models, plan, ordered: false })];
  assert.equal(all.length, M);
  const distinct = new Set(all.map((c) => c.targets));
  const retained = [...distinct].reduce((n, targets) => n + targets.length, 0);
  assert.ok(retained <= 2 * M, `target entries retained: ${retained}`);
  assert.equal(all[0].targets.length, M);
});
