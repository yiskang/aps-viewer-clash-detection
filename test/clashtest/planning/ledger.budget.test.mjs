// test/clashtest/planning/ledger.budget.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRecordBudget, PLAN_RECORD_CLASSES, LEDGER_RECORD_CLASSES, ROOT_CLASS }
  from '../../../clashtest/planning/ledger.js';
import { RUN_OPTION_DEFAULTS } from '../../../clashtest/options.js';

const limits = { maxPlanReferences: 100, maxLedgerRecords: 100 + 2 * 10, maxUnitsPerRun: 10 };

test('planning admission is refused at maxPlanReferences, before allocation', () => {
  const b = createRecordBudget(limits);
  assert.equal(b.admitPlan('root-table', 100), true);
  assert.equal(b.planRecords, 100);
  assert.equal(b.admitPlan('planning-gap', 1), false);   // refused
  assert.equal(b.planRecords, 100);                       // and nothing was counted
  assert.equal(b.planOverflowClass, 'planning-gap');
});

test('a refused plan block is atomic: nothing of it is counted, and the overflow class names the refuser', () => {
  const b = createRecordBudget(limits);
  b.admitPlan('root-table', 90);
  assert.equal(b.admitPlan('root-owner', 11), false);
  assert.equal(b.planRecords, 90);
  assert.equal(b.planOverflowClass, 'root-owner');
  assert.equal(b.admitPlan('root-owner', 10), true);      // the block that does fit is still admitted
  assert.equal(b.planRecords, 100);
  assert.equal(b.planOverflowClass, 'root-owner');        // sticky: the first refusal is what plan-too-large reports
});

test('the reserve always fits and consumes no discretionary capacity', () => {
  const b = createRecordBudget(limits);
  b.admitPlan('root-table', limits.maxPlanReferences);
  assert.equal(b.reserveUnitSlots(), true);
  assert.equal(b.used, limits.maxPlanReferences + limits.maxUnitsPerRun);
  assert.equal(b.discretionaryRemaining, limits.maxUnitsPerRun);   // ≥ maxUnitsPerRun, per §6.5.1 proof
  const before = b.used;
  assert.equal(b.consumeReservedSlot('u.0'), true);
  assert.equal(b.used, before);                                     // consumed IN PLACE
  assert.equal(b.discretionaryRemaining, limits.maxUnitsPerRun);
});

test('reserveUnitSlots is idempotent: a second call never reserves twice', () => {
  const b = createRecordBudget(limits);
  assert.equal(b.reserveUnitSlots(), true);
  const used = b.used;
  assert.equal(b.reserveUnitSlots(), true);
  assert.equal(b.used, used);
});

test('the reserve proof holds at the provisional defaults (options.js), with the plan at its bound', () => {
  const b = createRecordBudget(RUN_OPTION_DEFAULTS);
  assert.equal(b.admitPlan('root-table', RUN_OPTION_DEFAULTS.maxPlanReferences), true);
  assert.equal(b.reserveUnitSlots(), true);
  assert.ok(b.discretionaryRemaining >= RUN_OPTION_DEFAULTS.maxUnitsPerRun);
  assert.ok(b.used <= RUN_OPTION_DEFAULTS.maxLedgerRecords);
});

test('reserveUnitSlots reports (does not paper over) a budget that cannot hold the reserve', () => {
  const b = createRecordBudget({ maxPlanReferences: 10, maxLedgerRecords: 12, maxUnitsPerRun: 5 });
  b.admitPlan('root-table', 10);
  assert.equal(b.reserveUnitSlots(), false);      // internal invariant, unreachable under validated options
  assert.equal(b.used, 10);                        // and nothing was reserved
});

test('a unit may consume its reserved overflow slot exactly once', () => {
  const b = createRecordBudget(limits);
  b.reserveUnitSlots();
  assert.equal(b.consumeReservedSlot('1.0'), true);
  assert.equal(b.consumeReservedSlot('1.0'), false);   // already taken; caller reuses the existing taint
});

test('consuming a reserved slot without a reserve, or past the reserve, is an invariant violation (never silent)', () => {
  const noReserve = createRecordBudget(limits);
  assert.throws(() => noReserve.consumeReservedSlot('1.0'), RangeError);
  const tiny = createRecordBudget({ maxPlanReferences: 1, maxLedgerRecords: 3, maxUnitsPerRun: 1 });
  tiny.reserveUnitSlots();
  assert.equal(tiny.consumeReservedSlot('1.0'), true);
  assert.throws(() => tiny.consumeReservedSlot('1.1'), RangeError);   // more distinct units than the reserve holds
  assert.equal(tiny.consumeReservedSlot('1.0'), false);               // a repeat is still just "already taken"
});

test('reserved slots are keyed by a real unit id: a missing or non-string id can never alias another unit', () => {
  const b = createRecordBudget(limits);
  b.reserveUnitSlots();
  for (const bad of [undefined, null, '', 7, {}]) assert.throws(() => b.consumeReservedSlot(bad), TypeError, String(bad));
  assert.throws(() => b.admitRuntime('element-taint', 1, 7), TypeError);
  assert.throws(() => b.admitRuntime('element-taint', 1, ''), TypeError);
  assert.equal(b.consumeReservedSlot('1.0'), true);   // and nothing above consumed a slot
});

test('the first refusal is sticky even when it carried no unit id', () => {
  const b = createRecordBudget(limits);
  b.reserveUnitSlots();
  b.admitRuntime('element-taint', b.discretionaryRemaining);
  assert.equal(b.admitRuntime('element-taint', 1), false);          // first refusal: no id known
  assert.equal(b.admitRuntime('element-taint', 1, '1.5'), false);   // a later refusal must not overwrite it
  assert.equal(b.budgetExhausted, true);
  assert.equal(b.firstRefusalUnitId, null);
});

test('runtime admission refuses past the budget, flags exhaustion and names the first unit', () => {
  const b = createRecordBudget(limits);
  b.admitPlan('root-table', 100);
  b.reserveUnitSlots();
  assert.equal(b.admitRuntime('element-taint', limits.maxUnitsPerRun, '1.0'), true);
  assert.equal(b.budgetExhausted, false);
  assert.equal(b.admitRuntime('element-taint', 1, '1.1'), false);
  assert.equal(b.budgetExhausted, true);
  assert.equal(b.firstRefusalUnitId, '1.1');
  assert.equal(b.admitRuntime('element-taint', 1, '1.2'), false);
  assert.equal(b.firstRefusalUnitId, '1.1');          // the FIRST refusal is kept
  assert.ok(b.used <= limits.maxLedgerRecords);
});

test('a multi-record block is admitted atomically or not at all', () => {
  const b = createRecordBudget(limits);
  b.admitPlan('root-table', 100); b.reserveUnitSlots();
  assert.equal(b.admitRuntime('split', limits.maxUnitsPerRun + 1, '2.0'), false);
  assert.equal(b.discretionaryRemaining, limits.maxUnitsPerRun);   // no partial block
  assert.equal(b.admitRuntime('split', limits.maxUnitsPerRun, '2.1'), true);
  assert.equal(b.discretionaryRemaining, 0);
});

test('used never exceeds maxLedgerRecords, even if planning admission is (mis)used after the reserve', () => {
  const b = createRecordBudget(limits);
  b.reserveUnitSlots();
  b.admitRuntime('element-taint', b.discretionaryRemaining, '1.0');
  assert.equal(b.used, limits.maxLedgerRecords);
  assert.equal(b.admitPlan('planning-gap', 1), false);   // under maxPlanReferences, but the ledger is full
  assert.equal(b.planRecords, 0);
  assert.ok(b.used <= limits.maxLedgerRecords);
});

test('admission fails closed on malformed sizes and limits (a NaN must never read as "fits")', () => {
  const b = createRecordBudget(limits);
  for (const bad of [Number.NaN, -1, 1.5, Infinity, '3', null, undefined]) {
    assert.throws(() => b.admitPlan('root-table', bad), TypeError, `admitPlan(${String(bad)})`);
    assert.throws(() => b.admitRuntime('element-taint', bad, '1.0'), TypeError, `admitRuntime(${String(bad)})`);
  }
  assert.equal(b.planRecords, 0);
  assert.equal(b.used, 0);
  assert.throws(() => b.admitPlan('element-taint', 1), TypeError);   // a runtime-only class is not a planning class
  assert.throws(() => b.admitPlan('nonsense', 1), TypeError);
  assert.throws(() => b.admitRuntime('nonsense', 1, '1.0'), TypeError);
  for (const key of Object.keys(limits)) {
    for (const bad of [Number.NaN, -1, 1.5, Infinity, undefined]) {
      assert.throws(() => createRecordBudget({ ...limits, [key]: bad }), TypeError, `${key}=${String(bad)}`);
    }
  }
});

test('the budget state is read-only to callers', () => {
  const b = createRecordBudget(limits);
  for (const key of ['planRecords', 'used', 'discretionaryRemaining', 'budgetExhausted', 'firstRefusalUnitId', 'planOverflowClass']) {
    assert.throws(() => { b[key] = 0; }, TypeError, key);       // ESM is strict: writing a getter-only property throws
  }
  assert.equal(Object.isFrozen(b), true);
});

test('every §6.5.1 record class is named', () => {
  for (const c of PLAN_RECORD_CLASSES) assert.ok(LEDGER_RECORD_CLASSES.includes(c));
  assert.deepEqual([...LEDGER_RECORD_CLASSES].sort(), [
    'element-taint', 'hierarchy-internal', 'planning-gap', 'root-owner', 'root-table',
    'scope-digest', 'split', 'target-model-taint', 'unit-range', 'unit-record',
    'unit-taint', 'unreachable-population', 'unresolved-selection',
  ]);
  assert.equal(Object.isFrozen(PLAN_RECORD_CLASSES), true);
  assert.equal(Object.isFrozen(LEDGER_RECORD_CLASSES), true);
});

test('ROOT_CLASS is the frozen persisted per-root class marker (R2)', () => {
  assert.deepEqual({ ...ROOT_CLASS }, { A_ONLY: 'A', B_ONLY: 'B', BOTH: 'C' });
  assert.equal(Object.isFrozen(ROOT_CLASS), true);
});

test('admitPlanBlock is all-or-nothing: a refused multi-class block leaves planRecords untouched and names the first refusing class', () => {
  const budget = createRecordBudget({ maxPlanReferences: 5, maxLedgerRecords: 100, maxUnitsPerRun: 1 });
  assert.equal(budget.admitPlanBlock([['root-table', 2], ['root-owner', 2]]), true);
  assert.equal(budget.planRecords, 4);
  assert.equal(budget.admitPlanBlock([['unit-record', 1], ['unit-range', 1]]), false);   // 4 + 1 fits, 4 + 2 does not
  assert.equal(budget.planRecords, 4);                       // the first block member was NOT retained
  assert.equal(budget.planOverflowClass, 'unit-range');
  assert.equal(budget.admitPlanBlock([['unit-record', 1]]), true);   // the refusal is not sticky for smaller blocks
  assert.equal(budget.planRecords, 5);
});

test('admitPlanBlock rejects malformed blocks loudly', () => {
  const budget = createRecordBudget({ maxPlanReferences: 5, maxLedgerRecords: 100, maxUnitsPerRun: 1 });
  assert.throws(() => budget.admitPlanBlock('x'), TypeError);
  assert.throws(() => budget.admitPlanBlock([['split', 1]]), TypeError);
  assert.throws(() => budget.admitPlanBlock([['root-table', -1]]), TypeError);
  assert.throws(() => budget.admitPlanBlock([['root-table']]), TypeError);
  assert.equal(budget.planRecords, 0);
});
