// test/clashtest/execution/diagnostics.taints.test.mjs
//
// P4.4: the exact per-unit taint table (§12.2.1) — computed from the unit's own diagnostics before
// any de-duplication or retained-diagnostic cap, so retained-list truncation can never lose a taint.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveUnitTaints, projectDiagnostic, createUnitBindingTable, TAINT_OVERFLOW_REASON,
} from '../../../clashtest/execution/diagnostics.js';

const table = createUnitBindingTable([{ modelKey: 'mk-a', modelId: 1 }, { modelKey: 'mk-b', modelId: 2 }]);
const project = (raw) => { const r = projectDiagnostic(raw, table); assert.equal(r.ok, true); return r.diagnostic; };
const alwaysAdmit = () => true;
const elem = (dbId, reason = 'inconclusive-crossing', modelId = 1) =>
  project({ scope: 'fragment', reason, role: 'source', fragment: { modelId, dbId, fragId: dbId } });

const derive = (ds, over = {}) => deriveUnitTaints(ds, { maxElementTaintsPerUnit: 2_000, admit: alwaysAdmit, ...over });
const pair = (reason, a, b) => project({ scope: 'pair', reason,
  sourceFragment: { modelId: 1, dbId: a, fragId: a }, targetFragment: { modelId: 2, dbId: b, fragId: b } });
const nulled = (reason, role, modelId) => project({ scope: 'fragment', reason, role,
  fragment: { modelId, dbId: null, fragId: 5 } });

test('element diagnostics produce one entry per (modelKey, dbId, reason) with exact occurrences', () => {
  const { taints, overflowed } = derive([elem(10), elem(10), elem(11), elem(10, 'non-manifold-component')]);
  assert.equal(overflowed, false);
  assert.deepEqual(taints, [
    { kind: 'element', modelKey: 'mk-a', dbId: 10, reason: 'inconclusive-crossing', occurrences: 2 },
    { kind: 'element', modelKey: 'mk-a', dbId: 10, reason: 'non-manifold-component', occurrences: 1 },
    { kind: 'element', modelKey: 'mk-a', dbId: 11, reason: 'inconclusive-crossing', occurrences: 1 },
  ]);
});

test('a pair-scoped element diagnostic implicates BOTH owner elements', () => {
  const { taints } = derive([pair('unverified-parity-operand', 10, 20)]);
  assert.deepEqual(taints.map((t) => [t.modelKey, t.dbId]), [['mk-a', 10], ['mk-b', 20]]);
});

test('target-model and unit diagnostics get their own exact entry kinds', () => {
  const tm = nulled('fragment-not-loaded', 'target', 2);
  const { taints } = derive([tm, tm, nulled('fragment-owner-unresolvable', 'source', 1)]);
  assert.deepEqual(taints, [
    { kind: 'target-model', modelKey: 'mk-b', reason: 'fragment-not-loaded', occurrences: 2 },
    { kind: 'unit', modelKey: 'mk-a', reason: 'fragment-owner-unresolvable', occurrences: 1 },
  ]);
});

test('exceeding maxElementTaintsPerUnit collapses the WHOLE unit, losing nothing', () => {
  const { taints, overflowed } = derive(Array.from({ length: 12 }, (_, i) => elem(i)), { maxElementTaintsPerUnit: 10 });
  assert.equal(overflowed, true);
  assert.deepEqual(taints, [{ kind: 'unit', modelKey: null, reason: TAINT_OVERFLOW_REASON, occurrences: 12 }]);
});

test('a refusing ledger budget collapses the same way, for ANY taint kind', () => {
  const { taints, overflowed } = derive([elem(1), nulled('fragment-not-loaded', 'target', 2)], { admit: () => false });
  assert.equal(overflowed, true);
  assert.deepEqual(taints, [{ kind: 'unit', modelKey: null, reason: TAINT_OVERFLOW_REASON, occurrences: 2 }]);
});

test('taint entries are admitted in canonical order, independent of diagnostic order', () => {
  const order = (ds) => derive(ds).taints.map((t) => `${t.kind}|${t.modelKey}|${t.dbId}|${t.reason}`);
  assert.deepEqual(order([elem(2), elem(1, 'a-reason'), elem(1)]),
    order([elem(1), elem(2), elem(1, 'a-reason')]));
});

test('benign witness-unavailable still taints — taints are not filtered by the predicate', () => {
  assert.equal(derive([pair('witness-unavailable', 3, 4)]).taints.length, 2,
    'the taint table records what was observed; §12.5 decides what it means');
});
