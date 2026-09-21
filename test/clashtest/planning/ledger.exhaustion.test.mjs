// test/clashtest/planning/ledger.exhaustion.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createRecordBudget, createLedger, rootOwnerRowsOf, LEDGER_RECORD_CLASSES, ROOT_CLASS, UNIT_RECORD_KEYS, LEDGER_KEYS,
} from '../../../clashtest/planning/ledger.js';

const limits = { maxPlanReferences: 20, maxLedgerRecords: 20 + 2 * 4, maxUnitsPerRun: 4, maxElementTaintsPerUnit: 2000 };

function seeded(n) { let s = n >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }

// P5's pinned self-describing record. There is no `cell` field: the cell is the unitId prefix. `ranges` is the
// unit's range-record count (budget accounting only; it is not part of the persisted shape).
const leafUnit = (unitId, pairSpaceWeight, over = {}) => ({
  unitId, kind: 'leaf', parentUnitId: null, sourceModelKey: 'm', sourceRootDbIds: [1],
  targets: [{ modelKey: 'm', scope: 'roots', rootDbIds: [2] }], pairSpaceWeight, ranges: 1, ...over,
});
const childOf = (unitId, pairSpaceWeight, ranges = 1) => ({
  unitId, ranges, sourceModelKey: 'm', sourceRootDbIds: [1], targets: [{ modelKey: 'm', scope: 'roots', rootDbIds: [2] }], pairSpaceWeight,
});
const elementTaint = (dbId, reason = 'r', modelKey = 'm') => ({ kind: 'element', modelKey, dbId, reason });

function fresh(over = {}, { planRefs = 0, reserve = true, units = [] } = {}) {
  const lim = { ...limits, ...over };
  const budget = createRecordBudget(lim);
  const ledger = createLedger({ limits: lim, budget });
  if (planRefs > 0) assert.equal(budget.admitPlan('root-table', planRefs), true);
  if (reserve) assert.equal(budget.reserveUnitSlots(), true);
  for (const u of units) ledger.recordUnit(leafUnit(u, 1));
  return { budget, ledger, lim };
}

// ---- P3.8 Step 2 (AC-16 planner parts) ------------------------------------------------------------------------------

test('every runtime record class is exercised and none exceeds maxLedgerRecords', () => {
  const budget = createRecordBudget(limits);
  const ledger = createLedger({ limits, budget });
  budget.admitPlan('root-table', limits.maxPlanReferences);
  budget.reserveUnitSlots();
  for (let i = 0; i < limits.maxUnitsPerRun; i++) ledger.recordUnit(leafUnit(`1.${i}`, 1));
  const rnd = seeded(7);
  const classes = ['element', 'target-model', 'unit'];   // P5's persisted taint.kind vocabulary
  for (let i = 0; i < 500; i++) {
    const unitId = `1.${i % limits.maxUnitsPerRun}`;
    ledger.addTaint(unitId, { kind: classes[Math.floor(rnd() * classes.length)], modelKey: 'm', dbId: i, reason: `r${i % 7}` });
    assert.ok(budget.used <= limits.maxLedgerRecords, `overrun at ${i}`);
  }
  for (const cls of LEDGER_RECORD_CLASSES) assert.ok(typeof cls === 'string');
  // The persisted taint vocabulary never leaks a budget class id.
  for (const u of ledger.toLedgerRecord().units) for (const t of u.taints) assert.ok(classes.includes(t.kind), t.kind);
});

test('a unit whose taints collapsed always gets its taint-overflow, in place', () => {
  const { budget, ledger } = fresh({}, { planRefs: limits.maxPlanReferences, units: ['1.0'] });
  const usedAtStart = budget.used;
  for (let i = 0; i < 100; i++) ledger.addTaint('1.0', elementTaint(i));
  const rec = ledger.unitRecord('1.0');
  assert.ok(rec.taints.some((t) => t.kind === 'unit' && t.reason === 'taint-overflow' && t.occurrences === 1));
  assert.equal(rec.taints.filter((t) => t.reason === 'taint-overflow').length, 1);   // exactly one, however many collapsed
  assert.equal(budget.budgetExhausted, true);
  assert.ok(budget.used <= limits.maxLedgerRecords);
  // D (4 here) admitted 4 element taints; the overflow took its reserved slot: no extra `used`.
  assert.equal(budget.used, usedAtStart + 4);
  assert.equal(rec.taints.filter((t) => t.kind === 'element').length, 4);
});

test('taint-overflow is ALWAYS admitted, even when the discretionary budget is already zero', () => {
  const { budget, ledger } = fresh({}, { planRefs: limits.maxPlanReferences, units: ['1.0', '1.1', '1.2', '1.3'] });
  budget.admitRuntime('element-taint', budget.discretionaryRemaining, '1.0');    // exhaust D
  assert.equal(budget.discretionaryRemaining, 0);
  for (const u of ['1.0', '1.1', '1.2', '1.3']) {
    ledger.addTaint(u, elementTaint(1));
    assert.ok(ledger.unitRecord(u).taints.some((t) => t.reason === 'taint-overflow'), u);
    assert.equal(ledger.unitRecord(u).taints.length, 1, `${u}: the detail collapsed, only the overflow remains`);
  }
  assert.equal(budget.used, limits.maxLedgerRecords);
});

test('a collapsed unit absorbs later taints (the overflow already covers every pair) and never re-consumes its slot', () => {
  const { budget, ledger } = fresh({}, { planRefs: limits.maxPlanReferences, units: ['1.0'] });
  budget.admitRuntime('element-taint', budget.discretionaryRemaining, 'x');
  ledger.addTaint('1.0', elementTaint(1));
  ledger.addTaint('1.0', elementTaint(2));
  ledger.addTaint('1.0', { kind: 'target-model', modelKey: 'm', reason: 'r' });
  ledger.addTaint('1.0', { kind: 'unit', modelKey: null, reason: 'diagnostic-overflow' });
  assert.deepEqual(ledger.unitRecord('1.0').taints.map((t) => t.reason), ['taint-overflow']);
});

test('taint kinds map to the persisted vocabulary and each admitted DISTINCT entry costs exactly 1 of D', () => {
  const { budget, ledger } = fresh({ maxLedgerRecords: 60 }, { units: ['1.0'] });
  const d0 = budget.discretionaryRemaining;
  ledger.addTaint('1.0', elementTaint(5));
  assert.equal(budget.discretionaryRemaining, d0 - 1);
  ledger.addTaint('1.0', { kind: 'target-model', modelKey: 'n', dbId: 99, reason: 'r' });
  assert.equal(budget.discretionaryRemaining, d0 - 2);
  ledger.addTaint('1.0', { kind: 'unit', modelKey: null, reason: 'diagnostic-overflow' });
  assert.equal(budget.discretionaryRemaining, d0 - 3);
  assert.deepEqual(ledger.unitRecord('1.0').taints, [
    { kind: 'element', modelKey: 'm', dbId: 5, reason: 'r', occurrences: 1 },
    { kind: 'target-model', modelKey: 'n', dbId: null, reason: 'r', occurrences: 1 },   // dbId is meaningless off `element`
    { kind: 'unit', modelKey: null, dbId: null, reason: 'diagnostic-overflow', occurrences: 1 },
  ]);
});

test('a repeated taint (same kind/model/dbId/reason) adds occurrences and allocates nothing', () => {
  const { budget, ledger } = fresh({ maxLedgerRecords: 60 }, { units: ['1.0'] });
  ledger.addTaint('1.0', elementTaint(5));
  const used = budget.used;
  ledger.addTaint('1.0', { ...elementTaint(5), occurrences: 3 });
  ledger.addTaint('1.0', elementTaint(5));
  assert.equal(budget.used, used);
  assert.deepEqual(ledger.unitRecord('1.0').taints, [{ kind: 'element', modelKey: 'm', dbId: 5, reason: 'r', occurrences: 5 }]);
  ledger.addTaint('1.0', elementTaint(5, 'other-reason'));           // a different reason IS a different entry
  assert.equal(ledger.unitRecord('1.0').taints.length, 2);
});

test('maxElementTaintsPerUnit collapses the surplus without touching the budget flags', () => {
  const { budget, ledger } = fresh({ maxLedgerRecords: 200, maxElementTaintsPerUnit: 3 }, { units: ['1.0', '1.1'] });
  for (let i = 1; i <= 5; i++) ledger.addTaint('1.0', elementTaint(i));
  const rec = ledger.unitRecord('1.0');
  assert.deepEqual(rec.taints.filter((t) => t.kind === 'element').map((t) => t.dbId), [1, 2, 3]);
  assert.ok(rec.taints.some((t) => t.reason === 'taint-overflow'));
  assert.equal(budget.budgetExhausted, false);                         // a per-unit cap is not budget exhaustion
  ledger.addTaint('1.1', elementTaint(1));                             // another unit is unaffected
  assert.equal(ledger.unitRecord('1.1').taints.length, 1);
  assert.equal(ledger.unitRecord('1.1').taints[0].kind, 'element');
});

test('taints are admitted in CANONICAL order (kind, modelKey, dbId, reason), whatever order they arrive in', () => {
  const batch = [elementTaint(9, 'b'), elementTaint(2, 'z'), elementTaint(2, 'a'), { kind: 'unit', modelKey: null, reason: 'x' },
    { kind: 'target-model', modelKey: 'm', reason: 'r' }, elementTaint(1, 'a', 'k')];
  const survivors = (list) => {
    // D = 27 - 20 - 4 = 3 after the reserve: exactly three entries fit, the rest collapse.
    const { ledger } = fresh({ maxLedgerRecords: 27 }, { planRefs: 20, units: ['1.0'] });
    ledger.addTaint('1.0', list);
    return ledger.unitRecord('1.0').taints.map((t) => `${t.kind}|${t.modelKey}|${t.dbId}|${t.reason}`);
  };
  const a = survivors(batch);
  const b = survivors([...batch].reverse());
  assert.deepEqual(a, b);
  assert.deepEqual(a, ['element|k|1|a', 'element|m|2|a', 'element|m|2|z', 'unit|null|null|taint-overflow']);
});

test('a taint for a unit the ledger does not hold is a programming error, never a silent orphan', () => {
  const { ledger } = fresh();
  assert.throws(() => ledger.addTaint('9.9', elementTaint(1)), RangeError);
});

test('an overflow with no reserve made breaks the reserve proof loudly (never an unaccounted record)', () => {
  const { budget, ledger } = fresh({}, { planRefs: limits.maxPlanReferences, reserve: false, units: ['1.0'] });
  assert.equal(budget.discretionaryRemaining, 8);
  ledger.addTaint('1.0', elementTaint(1));   // fits: no overflow needed
  budget.admitRuntime('element-taint', budget.discretionaryRemaining, 'x');
  assert.throws(() => ledger.addTaint('1.0', elementTaint(2)), RangeError);
});

test('a split that no longer fits is NOT performed; the unit becomes failed:unit-cap', () => {
  const { budget, ledger } = fresh({}, { planRefs: limits.maxPlanReferences, units: [] });
  ledger.recordUnit(leafUnit('1.0', 4));
  budget.admitRuntime('element-taint', budget.discretionaryRemaining, '1.0');    // exhaust D
  // A refusal flags exhaustion (spec 6.5.1), so trip the flag BEFORE the snapshot: what is compared is then exactly the
  // split's own writes. (That the split's refusal itself flags exhaustion is pinned in its own test below.)
  assert.equal(budget.admitRuntime('element-taint', 1, '1.0'), false);
  const before = JSON.stringify(ledger.toLedgerRecord());
  const r = ledger.tryRecordSplit('1.0', [childOf('1.0.0', 2, 2), childOf('1.0.1', 2, 2)]);
  assert.equal(r.ok, false);
  assert.equal(r.capDetail, 'ledger-records');
  assert.equal(JSON.stringify(ledger.toLedgerRecord()), before);   // no half-recorded split
});

test('the unit-record cap refuses a split with capDetail unit-records', () => {
  const lim = { ...limits, maxUnitsPerRun: 1, maxLedgerRecords: 40 };
  const budget = createRecordBudget(lim);
  const ledger = createLedger({ limits: lim, budget });
  budget.reserveUnitSlots();
  ledger.recordUnit(leafUnit('1.0', 4));
  const r = ledger.tryRecordSplit('1.0', [childOf('1.0.0', 2), childOf('1.0.1', 2)]);
  assert.equal(r.ok, false);
  assert.equal(r.capDetail, 'unit-records');
});

test('the unit-record cap is exact: unitRecords + 2 <= maxUnitsPerRun splits, one more does not', () => {
  for (const [live, ok] of [[8, true], [9, false]]) {          // maxUnitsPerRun = 10: 8 + 2 = 10 fits, 9 + 2 = 11 does not
    const lim = { ...limits, maxUnitsPerRun: 10, maxLedgerRecords: 200 };
    const budget = createRecordBudget(lim);
    const ledger = createLedger({ limits: lim, budget });
    budget.reserveUnitSlots();
    for (let i = 0; i < live; i++) ledger.recordUnit(leafUnit(`1.${i}`, 4));
    const r = ledger.tryRecordSplit('1.0', [childOf('1.0.0', 2), childOf('1.0.1', 2)]);
    assert.equal(r.ok, ok, `live=${live}`);
    assert.equal(ledger.unitRecordCount, ok ? live + 2 : live);
    if (!ok) assert.equal(r.capDetail, 'unit-records');
  }
});

test('an admitted split charges exactly 2 + child ranges to the discretionary capacity, as one block', () => {
  const { budget, ledger } = fresh({ maxLedgerRecords: 60 }, { units: [] });
  ledger.recordUnit(leafUnit('1.0', 4));
  const d0 = budget.discretionaryRemaining;
  assert.deepEqual(ledger.tryRecordSplit('1.0', [childOf('1.0.0', 2, 3), childOf('1.0.1', 2, 5)]), { ok: true });
  assert.equal(budget.discretionaryRemaining, d0 - (2 + 3 + 5));
});

test('the ledger-records refusal is boundary-exact: a block of exactly D fits, D + 1 does not', () => {
  for (const [ranges, ok] of [[2, true], [3, false]]) {                 // 2 + 2 ranges... block = 2 + ranges
    const { budget, ledger } = fresh({ maxLedgerRecords: 20 + 2 * 4 }, { planRefs: 20, units: [] });
    ledger.recordUnit(leafUnit('1.0', 4));
    assert.equal(budget.discretionaryRemaining, 4);                       // D = 4: the block 2 + 2 fits, 2 + 3 does not
    const r = ledger.tryRecordSplit('1.0', [childOf('1.0.0', 2, ranges - 1), childOf('1.0.1', 2, 1)]);
    assert.equal(r.ok, ok, `ranges=${ranges}`);
  }
});

test('a ledger-cap refusal flags exhaustion at the parent; a unit-cap refusal does not', () => {
  const a = fresh({}, { planRefs: limits.maxPlanReferences, units: [] });
  a.ledger.recordUnit(leafUnit('1.0', 4));
  a.budget.admitRuntime('element-taint', a.budget.discretionaryRemaining, 'seed');
  assert.equal(a.budget.budgetExhausted, false);
  assert.equal(a.ledger.tryRecordSplit('1.0', [childOf('1.0.0', 2), childOf('1.0.1', 2)]).capDetail, 'ledger-records');
  assert.equal(a.ledger.toLedgerRecord().budgetExhausted, true);
  assert.equal(a.ledger.toLedgerRecord().firstRefusalUnitId, '1.0');
  const lim = { ...limits, maxUnitsPerRun: 1, maxLedgerRecords: 40 };
  const budget = createRecordBudget(lim);
  const ledger = createLedger({ limits: lim, budget });
  budget.reserveUnitSlots();
  ledger.recordUnit(leafUnit('1.0', 4));
  ledger.tryRecordSplit('1.0', [childOf('1.0.0', 2), childOf('1.0.1', 2)]);
  assert.equal(ledger.toLedgerRecord().budgetExhausted, false);
});

test('an admitted split supersedes the parent: kind/parentUnitId, and only LEAVES carry the weight', () => {
  const { ledger } = fresh({}, { units: [] });
  ledger.recordUnit(leafUnit('1.0', 4));
  assert.equal(ledger.tryRecordSplit('1.0', [childOf('1.0.0', 2), childOf('1.0.1', 2)]).ok, true);
  const rec = ledger.toLedgerRecord();
  const byId = new Map(rec.units.map((u) => [u.unitId, u]));
  assert.equal(byId.get('1.0').kind, 'split');
  assert.equal(byId.get('1.0').outcome, 'split');
  assert.deepEqual([byId.get('1.0.0').kind, byId.get('1.0.0').parentUnitId], ['leaf', '1.0']);
  assert.deepEqual([byId.get('1.0.1').kind, byId.get('1.0.1').parentUnitId], ['leaf', '1.0']);
  assert.equal(rec.units.filter((u) => u.kind === 'leaf').reduce((n, u) => n + u.pairSpaceWeight, 0), rec.pairSpaceTotal);
  assert.equal(rec.pairSpaceTotal, 4);            // the parent's weight moved to its leaves exactly once: 4, not 4 + 4
});

test('a split whose children do not partition the parent weight is an internal error, recording nothing', () => {
  const { ledger } = fresh({}, { units: [] });
  ledger.recordUnit(leafUnit('1.0', 4));
  const before = JSON.stringify(ledger.toLedgerRecord());
  assert.throws(() => ledger.tryRecordSplit('1.0', [childOf('1.0.0', 2), childOf('1.0.1', 3)]), /partition/);
  assert.equal(JSON.stringify(ledger.toLedgerRecord()), before);
});

test('tryRecordSplit refuses malformed calls loudly: unknown/split parent, wrong child ids, existing ids', () => {
  const { ledger } = fresh({}, { units: [] });
  ledger.recordUnit(leafUnit('1.0', 4));
  const ok = () => [childOf('1.0.0', 2), childOf('1.0.1', 2)];
  assert.throws(() => ledger.tryRecordSplit('7.7', ok()), RangeError);
  assert.throws(() => ledger.tryRecordSplit('1.0', [childOf('1.0.0', 2)]), TypeError);
  assert.throws(() => ledger.tryRecordSplit('1.0', [childOf('1.0.1', 2), childOf('1.0.0', 2)]), TypeError);
  assert.throws(() => ledger.tryRecordSplit('1.0', [{ ...childOf('1.0.0', 2), targets: undefined }, childOf('1.0.1', 2)]), TypeError);
  assert.equal(ledger.unitRecordCount, 1);
  assert.equal(ledger.tryRecordSplit('1.0', ok()).ok, true);
  assert.throws(() => ledger.tryRecordSplit('1.0', ok()), RangeError);        // already a split parent
  ledger.recordUnit(leafUnit('2.0', 1));
  ledger.recordOutcome('2.0', { outcome: 'evaluated', attempts: 1, scopeProof: 'equal' });
  assert.throws(() => ledger.tryRecordSplit('2.0', [childOf('2.0.0', 1), childOf('2.0.1', 0)]), RangeError);   // settled: not splittable
});

test('inline fields still update after exhaustion (they allocate nothing)', () => {
  const { budget, ledger } = fresh({}, { planRefs: limits.maxPlanReferences, units: ['1.0'] });
  budget.admitRuntime('element-taint', budget.discretionaryRemaining, '1.0');
  const used = budget.used;
  ledger.recordOutcome('1.0', { outcome: 'failed', cause: 'capacity-exceeded', attempts: 2,
    capacityKind: 'tlas-candidate-budget',
    secondaryCauses: ['stale-placement', 'model-evicted'], scopeProof: 'equal' });
  assert.equal(ledger.unitRecord('1.0').attempts, 2);
  assert.equal(ledger.unitRecord('1.0').cause, 'capacity-exceeded');
  assert.equal(ledger.unitRecord('1.0').capacityKind, 'tlas-candidate-budget');
  assert.equal(ledger.unitRecord('1.0').outcome, 'failed');
  assert.equal(ledger.unitRecord('1.0').scopeProof, 'equal');
  assert.equal(budget.used, used);
});

test('recordOutcome merges: omitted fields keep their value; capDetail and durationMs are inline too', () => {
  const { ledger } = fresh({}, { units: ['1.0'] });
  ledger.recordOutcome('1.0', { attempts: 1, durationMs: 12.4 });
  ledger.recordOutcome('1.0', { outcome: 'failed', cause: 'unit-cap', capDetail: 'unit-records' });
  const r = ledger.unitRecord('1.0');
  assert.deepEqual([r.attempts, r.durationMs, r.outcome, r.cause, r.capDetail], [1, 12, 'failed', 'unit-cap', 'unit-records']);
});

test('recordOutcome validates every field against P5\'s closed vocabularies', () => {
  const { ledger } = fresh({}, { units: ['1.0'] });
  const bad = [{ outcome: 'pending' }, { outcome: 'split' }, { scopeProof: 'maybe' }, { capDetail: 'nope' },
    { attempts: -1 }, { attempts: 1.5 }, { durationMs: -1 }, { durationMs: NaN }, { cause: 7 }, { capacityKind: 7 },
    { secondaryCauses: 'x' }, { secondaryCauses: [''] }];
  for (const patch of bad) assert.throws(() => ledger.recordOutcome('1.0', patch), TypeError, JSON.stringify(patch));
  assert.throws(() => ledger.recordOutcome('nope', { attempts: 1 }), RangeError);
  assert.equal(ledger.unitRecord('1.0').outcome, null);          // nothing partial was written
});

test('a split parent accepts inline diagnostics but never a different outcome', () => {
  const { ledger } = fresh({}, { units: [] });
  ledger.recordUnit(leafUnit('1.0', 4));
  ledger.tryRecordSplit('1.0', [childOf('1.0.0', 2), childOf('1.0.1', 2)]);
  ledger.recordOutcome('1.0', { attempts: 3, capacityKind: 'tlas-candidate-budget' });
  assert.equal(ledger.unitRecord('1.0').attempts, 3);
  assert.equal(ledger.unitRecord('1.0').capacityKind, 'tlas-candidate-budget');
  assert.throws(() => ledger.recordOutcome('1.0', { outcome: 'evaluated' }), TypeError);
});

test('R4: secondaryCauses are stored ascending by cause code and capped at 8', () => {
  const { ledger } = fresh({}, { units: ['1.0'] });
  ledger.recordOutcome('1.0', { outcome: 'failed', cause: 'capacity-exceeded', attempts: 1,
    scopeProof: 'equal',
    secondaryCauses: ['stale-placement', 'model-evicted', 'extraction-limit', 'unit-cap',
      'object-tree-unavailable', 'scope-drift', 'input-changed', 'result-cap',
      'internal-error', 'world-disposed'] });
  const got = ledger.unitRecord('1.0').secondaryCauses;
  assert.equal(got.length, 8);
  assert.deepEqual(got, [...got].sort());                      // canonical tie-break: ascending cause code
  // The cap keeps the FIRST 8 in canonical order: the two code-unit-greatest causes are the ones dropped.
  assert.deepEqual(got, ['extraction-limit', 'input-changed', 'internal-error', 'model-evicted',
    'object-tree-unavailable', 'result-cap', 'scope-drift', 'stale-placement']);
  // Same fact set, different observation order => byte-identical record.
  const b = fresh({}, { units: ['1.0'] }).ledger;
  b.recordOutcome('1.0', { outcome: 'failed', cause: 'capacity-exceeded', attempts: 1, scopeProof: 'equal',
    secondaryCauses: ['world-disposed', 'result-cap', 'scope-drift', 'internal-error', 'input-changed',
      'object-tree-unavailable', 'unit-cap', 'extraction-limit', 'model-evicted', 'stale-placement'] });
  assert.deepEqual(b.unitRecord('1.0').secondaryCauses, got);
});

test('R4: secondaryCauses are distinct (a repeated cause is one entry, ahead of the cap)', () => {
  const { ledger } = fresh({}, { units: ['1.0'] });
  ledger.recordOutcome('1.0', { secondaryCauses: ['b', 'a', 'b', 'a', 'c'] });
  assert.deepEqual(ledger.unitRecord('1.0').secondaryCauses, ['a', 'b', 'c']);
});

test('budgetExhausted and the first refusing unit id are recorded', () => {
  const { budget, ledger } = fresh({}, { planRefs: limits.maxPlanReferences, units: ['1.0', '1.2'] });
  budget.admitRuntime('element-taint', budget.discretionaryRemaining, '1.0');
  assert.equal(ledger.budgetExhausted, false);
  ledger.addTaint('1.2', elementTaint(1));
  ledger.addTaint('1.0', elementTaint(2));                     // a LATER refusal does not move the first-refusal id
  const rec = ledger.toLedgerRecord();
  assert.equal(rec.budgetExhausted, true);
  assert.equal(rec.firstRefusalUnitId, '1.2');
  assert.equal(ledger.budgetExhausted, true);
  assert.equal(ledger.firstRefusalUnitId, '1.2');
});

// ---- units, gaps, planning gaps and the P5-shaped projection -------------------------------------------------------

test('recordUnit allocates nothing itself: the planner admits unit-record/unit-range through the budget', () => {
  const { budget, ledger } = fresh({}, { planRefs: limits.maxPlanReferences });   // plan refs FULL, reserve made
  const used = budget.used;
  ledger.recordUnit(leafUnit('1.0', 1));
  assert.equal(budget.used, used);
  assert.equal(budget.planRecords, limits.maxPlanReferences);
});

test('recordUnit refuses a duplicate id, a split/non-root record, a malformed record and one past maxUnitsPerRun', () => {
  const { ledger } = fresh({}, { units: [] });
  ledger.recordUnit(leafUnit('1.0', 1));
  assert.throws(() => ledger.recordUnit(leafUnit('1.0', 1)), RangeError);
  assert.throws(() => ledger.recordUnit(leafUnit('1.1', 1, { kind: 'split' })), TypeError);
  assert.throws(() => ledger.recordUnit(leafUnit('1.1', 1, { parentUnitId: '1.0' })), TypeError);
  for (const patch of [{ unitId: '' }, { sourceModelKey: 7 }, { sourceRootDbIds: [-1] }, { sourceRootDbIds: 'x' },
    { targets: [{ modelKey: 'm', scope: 'roots' }] }, { targets: [{ modelKey: 'm', scope: 'whole' }] },
    { targets: [{ modelKey: 'm', scope: 'model', rootDbIds: [1] }] }, { pairSpaceWeight: -1 }, { pairSpaceWeight: 1.5 }, { ranges: -1 }]) {
    assert.throws(() => ledger.recordUnit(leafUnit('1.1', 1, patch)), TypeError, JSON.stringify(patch));
  }
  assert.equal(ledger.unitRecordCount, 1);
  for (let i = 1; i < limits.maxUnitsPerRun; i++) ledger.recordUnit(leafUnit(`1.${i}`, 1));
  assert.throws(() => ledger.recordUnit(leafUnit('9.9', 1)), RangeError);       // the cap is an invariant, not a refusal
});

test('a fresh unit projects EXACTLY P5\'s UnitRecord keys, with no extras and every default', () => {
  const { ledger } = fresh({}, { units: [] });
  ledger.recordUnit(leafUnit('1.0', 6, { sourceRootDbIds: [3, 1, 2], targets: [
    { modelKey: 'b', scope: 'model' }, { modelKey: 'a', scope: 'roots', rootDbIds: [9, 7] }] }));
  const [u] = ledger.toLedgerRecord().units;
  assert.deepEqual(Object.keys(u).sort(), [...UNIT_RECORD_KEYS].sort());
  assert.deepEqual(Object.keys(u).sort(), ['attempts', 'capDetail', 'capacityKind', 'cause', 'durationMs', 'kind', 'outcome',
    'pairSpaceWeight', 'parentUnitId', 'scopeProof', 'secondaryCauses', 'sourceModelKey', 'sourceRootDbIds', 'taints', 'targets', 'unitId']);
  assert.deepEqual(u, {
    unitId: '1.0', kind: 'leaf', parentUnitId: null, sourceModelKey: 'm', sourceRootDbIds: [1, 2, 3],      // ascending, unique
    targets: [{ modelKey: 'a', scope: 'roots', rootDbIds: [7, 9] }, { modelKey: 'b', scope: 'model' }],    // by modelKey; `model` has no rootDbIds
    outcome: null, cause: null, secondaryCauses: [], capacityKind: null, capDetail: null,
    scopeProof: 'not-checked', pairSpaceWeight: 6, taints: [], attempts: 0, durationMs: 0 });
});

test('recordGap writes a unit-level not-run leaf with its weight; recordPlanningGap is the run-level writer', () => {
  const { budget, ledger } = fresh({}, { units: [] });
  ledger.recordUnit(leafUnit('1.0', 3));
  ledger.recordGap('1.1', { ...leafUnit('1.1', 4), unitId: undefined, cause: 'target-too-large' });
  const rec = ledger.toLedgerRecord();
  const gap = rec.units.find((u) => u.unitId === '1.1');
  assert.deepEqual([gap.kind, gap.outcome, gap.cause, gap.pairSpaceWeight], ['leaf', 'not-run', 'target-too-large', 4]);
  assert.equal(rec.pairSpaceTotal, 7);
  assert.deepEqual(rec.planningGaps, []);                       // a unit gap is NOT a planning gap
  assert.throws(() => ledger.recordGap('1.2', { ...leafUnit('1.2', 1) }), TypeError);     // a gap names its cause
  assert.throws(() => ledger.recordGap('1.3', { ...leafUnit('other', 1), cause: 'target-too-large' }), TypeError);   // unitId mismatch
  assert.ok(budget.used <= limits.maxLedgerRecords);
});

test('recordPlanningGap appends {phase, cause} only, de-duplicated, in call order, charging nothing and never refused', () => {
  const budget = createRecordBudget(limits);
  const ledger = createLedger({ limits, budget });
  budget.admitPlan('root-table', limits.maxPlanReferences);            // plan refs full, NO reserve, NO units
  const used = budget.used;
  ledger.recordPlanningGap({ phase: 'planning', cause: 'plan-too-large' });
  ledger.recordPlanningGap({ phase: 'planning', cause: 'cancelled' });
  ledger.recordPlanningGap({ phase: 'planning', cause: 'plan-too-large' });          // duplicate
  ledger.recordPlanningGap({ phase: 'execution', cause: 'plan-too-large' });         // same cause, other phase: kept
  ledger.recordPlanningGap({ phase: 'planning', cause: 'cancelled', detail: { x: 1 } });   // a detail never reaches the row
  const rec = ledger.toLedgerRecord();
  assert.deepEqual(rec.planningGaps, [{ phase: 'planning', cause: 'plan-too-large' }, { phase: 'planning', cause: 'cancelled' },
    { phase: 'execution', cause: 'plan-too-large' }]);
  assert.deepEqual(rec.units, []);
  assert.equal(budget.used, used);
  assert.throws(() => ledger.recordPlanningGap({ phase: '', cause: 'x' }), TypeError);
  assert.throws(() => ledger.recordPlanningGap({ phase: 'planning' }), TypeError);
});

test('toLedgerRecord is exactly P5\'s Ledger: key set, arrays-only, JSON round-trip identical, detached', () => {
  const { ledger } = fresh({}, { units: ['1.0'] });
  ledger.recordPlanning({
    planExists: true, emptyOperand: false,
    rootOwners: [{ modelKey: 'm', owners: [{ rootDbId: 1, ownerDbIds: [1, 2], cls: ROOT_CLASS.BOTH }] }],
    unresolvedSelections: [{ selectionRole: 'A', modelKey: 'm', cause: 'no-fragments', dbIds: [5] }],
    unreachablePopulation: [{ modelKey: 'm', ownerDbIds: [8], mixedOwnerDbIds: [], unattributable: { notLoaded: 0, ownerUnresolvable: 0 } }],
    hierarchyInternal: [{ modelKey: 'm', rootCount: 1, ownerCount: 2, examples: [{ rootDbId: 1, ownerDbIds: [1, 2] }] }],
    exclusions: ['tree-unreachable-population'], warnings: [{ code: 'w', modelKey: 'm' }],
  });
  const rec = ledger.toLedgerRecord();
  assert.deepEqual(Object.keys(rec).sort(), [...LEDGER_KEYS].sort());
  assert.deepEqual(Object.keys(rec).sort(), ['budgetExhausted', 'emptyOperand', 'exclusions', 'firstRefusalUnitId', 'hierarchyInternal',
    'pairSpaceTotal', 'planExists', 'planningGaps', 'rootOwners', 'units', 'unreachablePopulation', 'unresolvedSelections', 'warnings']);
  assert.deepEqual(JSON.parse(JSON.stringify(rec)), rec);
  assert.equal(rec.planExists, true);
  assert.deepEqual(rec.rootOwners[0].owners[0], { rootDbId: 1, ownerDbIds: [1, 2], cls: 'C' });
  rec.units[0].targets[0].rootDbIds.push(999);
  rec.rootOwners[0].owners[0].ownerDbIds.push(999);
  assert.deepEqual(ledger.toLedgerRecord(), JSON.parse(JSON.stringify(ledger.toLedgerRecord())));
  assert.deepEqual(ledger.unitRecord('1.0').targets[0].rootDbIds, [2]);
  assert.deepEqual(ledger.toLedgerRecord().rootOwners[0].owners[0].ownerDbIds, [1, 2]);
});

test('an empty ledger projects the pre-plan shape', () => {
  const { ledger } = fresh({}, { reserve: false });
  assert.deepEqual(ledger.toLedgerRecord(), { planExists: false, pairSpaceTotal: 0, emptyOperand: false, units: [], rootOwners: [],
    unresolvedSelections: [], unreachablePopulation: [], hierarchyInternal: [], planningGaps: [], exclusions: [], warnings: [],
    budgetExhausted: false, firstRefusalUnitId: null });
});

test('R2: rootOwners rows carry cls, and only the three ROOT_CLASS literals are accepted (never A\' / B\')', () => {
  assert.deepEqual(ROOT_CLASS, { A_ONLY: 'A', B_ONLY: 'B', BOTH: 'C' });
  const { ledger } = fresh({}, { reserve: false });
  for (const cls of ["A'", "B'", 'X', undefined]) {
    assert.throws(() => ledger.recordPlanning({ rootOwners: [{ modelKey: 'm', owners: [{ rootDbId: 1, ownerDbIds: [1], cls }] }] }), TypeError, String(cls));
  }
  // rootOwnerRowsOf turns resolveSelectionRoots' per-model entries into P5's rows: models ascending, cls carried.
  const models = new Map([['z', { rootOwners: [{ rootDbId: 4, ownerDbIds: [4], cls: 'B' }] }],
    ['a', { rootOwners: [{ rootDbId: 1, ownerDbIds: [1, 2], cls: 'A' }, { rootDbId: 3, ownerDbIds: [3], cls: 'C' }] }]]);
  assert.deepEqual(rootOwnerRowsOf(models), [
    { modelKey: 'a', owners: [{ rootDbId: 1, ownerDbIds: [1, 2], cls: 'A' }, { rootDbId: 3, ownerDbIds: [3], cls: 'C' }] },
    { modelKey: 'z', owners: [{ rootDbId: 4, ownerDbIds: [4], cls: 'B' }] }]);
  ledger.recordPlanning({ rootOwners: rootOwnerRowsOf(models) });
  assert.deepEqual(ledger.toLedgerRecord().rootOwners.map((r) => r.owners.map((o) => o.cls)), [['A', 'C'], ['B']]);
});

test('units project in planPath order: initial units in record order, each split parent followed by its subtree', () => {
  const { ledger } = fresh({ maxUnitsPerRun: 20, maxLedgerRecords: 200 }, { units: ['1.0', '1.1', '2.0'] });
  // Split the LATER unit first: the projection must not depend on the order splits happened in.
  ledger.tryRecordSplit('1.1', [childOf('1.1.0', 0), childOf('1.1.1', 1)]);
  ledger.tryRecordSplit('1.0', [childOf('1.0.0', 0), childOf('1.0.1', 1)]);
  ledger.tryRecordSplit('1.0.0', [childOf('1.0.0.0', 0), childOf('1.0.0.1', 0)]);
  assert.deepEqual(ledger.toLedgerRecord().units.map((u) => u.unitId),
    ['1.0', '1.0.0', '1.0.0.0', '1.0.0.1', '1.0.1', '1.1', '1.1.0', '1.1.1', '2.0']);
});

test('a leaf that is the child of a split has no `ranges` leak and a zero-weight child is legal (a split can hand 0 to one side)', () => {
  const { ledger } = fresh({}, { units: [] });
  ledger.recordUnit(leafUnit('1.0', 4));
  ledger.tryRecordSplit('1.0', [childOf('1.0.0', 4), childOf('1.0.1', 0)]);
  for (const u of ledger.toLedgerRecord().units) assert.equal('ranges' in u, false);
});

// ---- writer-side conformance with P5's uniqueness / safe-integer rows (codex-advisor review) -----------------------

test('recordPlanning refuses schema-invalid duplicates: P5 pins uniqueness by modelKey (and by rootDbId per model)', () => {
  const { ledger } = fresh({}, { reserve: false });
  const owner = (rootDbId) => ({ rootDbId, ownerDbIds: [rootDbId], cls: 'A' });
  assert.throws(() => ledger.recordPlanning({ rootOwners: [{ modelKey: 'm', owners: [owner(1)] }, { modelKey: 'm', owners: [owner(2)] }] }), TypeError);
  assert.throws(() => ledger.recordPlanning({ rootOwners: [{ modelKey: 'm', owners: [owner(1), owner(1)] }] }), TypeError);
  assert.throws(() => ledger.recordPlanning({ unreachablePopulation: [{ modelKey: 'm' }, { modelKey: 'm' }] }), TypeError);
  assert.throws(() => ledger.recordPlanning({ hierarchyInternal: [{ modelKey: 'm' }, { modelKey: 'm' }] }), TypeError);
  assert.throws(() => ledger.recordPlanning({ unreachablePopulation: [{ count: 1 }] }), TypeError);      // a row names its model
  assert.deepEqual(ledger.toLedgerRecord().rootOwners, []);                                              // nothing partial was adopted
});

test('durationMs and taint occurrences stay safe integers (P5 int rows), never rounding or summing past 2^53', () => {
  const { ledger } = fresh({ maxLedgerRecords: 60 }, { units: ['1.0'] });
  assert.throws(() => ledger.recordOutcome('1.0', { durationMs: 1e300 }), TypeError);
  assert.throws(() => ledger.recordOutcome('1.0', { durationMs: Number.MAX_SAFE_INTEGER + 0.5 * 2 ** 3 }), TypeError);
  ledger.addTaint('1.0', { ...elementTaint(1), occurrences: Number.MAX_SAFE_INTEGER });
  assert.throws(() => ledger.addTaint('1.0', elementTaint(1)), RangeError);
  assert.equal(ledger.unitRecord('1.0').taints[0].occurrences, Number.MAX_SAFE_INTEGER);
});
