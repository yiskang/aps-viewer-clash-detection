// Tests for CTM8-P0-v4 enumeration and arithmetic (§4.2, §7.5).
import test from 'node:test';
import assert from 'node:assert/strict';
import { enumerateCells, shuffleCells, arithmetic, mulberry32, OPTIONAL_NOT_MANDATORY } from '../lib/enumeration.mjs';

test('arithmetic matches the frozen spec numbers', () => {
  assert.deepEqual(arithmetic(), {
    cellsPerLaunch: 84, familyM: 36, familyR: 48, warmCells: 72, coldCells: 12, launches: 3,
    cellExecutions: 252, measured: 7020, warmMeasured: 6480, coldMeasured: 540, warmups: 1080, totalOps: 8100,
  });
});

test('enumerateCells yields 84 unique cells with no SKEWED / -PULL', () => {
  const cells = enumerateCells();
  assert.equal(cells.length, 84);
  assert.equal(new Set(cells.map((c) => c.cellId)).size, 84);
  assert.ok(!JSON.stringify(cells).match(/SKEWED|-PULL/));
  assert.ok(cells.filter((c) => c.family === 'R').every((c) => c.profile === 'UNIFORM'));
  assert.ok(cells.filter((c) => c.family === 'M').every((c) => c.profile === null));
  assert.equal(cells.filter((c) => c.kind === 'cold').length, 12);
  assert.ok(OPTIONAL_NOT_MANDATORY.length > 0);
});

test('shuffle is deterministic per launch, differs across launches, and is a permutation', () => {
  const cells = enumerateCells();
  const a = shuffleCells(cells, 0);
  const b = shuffleCells(cells, 0);
  assert.deepEqual(a.order.map((c) => c.cellId), b.order.map((c) => c.cellId));
  assert.equal(a.seed, 20261011);
  assert.equal(shuffleCells(cells, 2).seed, 20261013);
  assert.match(a.algorithm, /Fisher-Yates/);
  assert.notDeepEqual(a.order.map((c) => c.cellId), shuffleCells(cells, 1).order.map((c) => c.cellId));
  for (const l of [0, 1, 2]) {
    const ids = shuffleCells(cells, l).order.map((c) => c.cellId).sort();
    assert.deepEqual(ids, cells.map((c) => c.cellId).sort());
  }
  assert.equal(cells[0].cellId, 'M-BASE/100/1'); // input not mutated
});

test('mulberry32 is deterministic and in [0,1)', () => {
  const r1 = mulberry32(1); const r2 = mulberry32(1);
  for (let i = 0; i < 100; i++) { const v = r1(); assert.equal(v, r2()); assert.ok(v >= 0 && v < 1); }
});
