import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  UNIT_PRECEDENCE, classifyUnitSettlement, resolveRunStatus, collectReasons,
} from '../../../clashtest/run/settlement.js';

const FACTS = UNIT_PRECEDENCE.map((r) => r.fact);
const REAL = FACTS.filter((f) => f !== null);              // U9's fact IS null; `Boolean` would also drop ''
const rowOf = (f) => UNIT_PRECEDENCE.find((r) => r.fact === f);

test('table A ranks are non-decreasing and the DISTINCT ranks are dense 1..9', () => {
  // Six facts share rank 8 (§16.7 table A row U8), so the ranks are NOT one-per-row.
  const ranks = UNIT_PRECEDENCE.map((r) => r.rank);
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b), 'rows are in precedence order');
  assert.deepEqual([...new Set(ranks)], [1, 2, 3, 4, 5, 6, 7, 8, 9], 'U1..U9, no gaps');
  assert.equal(UNIT_PRECEDENCE.filter((r) => r.fact === null).length, 1, 'exactly one U9 row');
  assert.equal(new Set(REAL).size, REAL.length, 'no fact appears twice');
});

test('a single fact yields its own row and no secondary cause', () => {
  for (const row of UNIT_PRECEDENCE) {
    if (row.fact === null) continue;                       // U9 = "none of the above"
    const got = classifyUnitSettlement([row.fact], 'post');
    assert.equal(got.primaryFact, row.fact, `fact ${row.fact}`);
    assert.equal(got.cause, row.code);
    assert.deepEqual(got.secondaryCauses, []);
  }
});

test('no facts is U9 evaluated and is the only merging outcome', () => {
  const got = classifyUnitSettlement([], 'post');
  assert.deepEqual(
    { outcome: got.outcome, cause: got.cause, merges: got.merges },
    { outcome: 'evaluated', cause: null, merges: true },
  );
  for (const fact of REAL) {
    assert.equal(classifyUnitSettlement([fact], 'post').merges, false, fact);
  }
});

test('every PAIR resolves order-independently; EQUAL ranks break by ascending cause code', () => {
  for (const a of REAL) for (const b of REAL) {
    if (a === b) continue;
    const forward = classifyUnitSettlement([a, b], 'post');
    const backward = classifyUnitSettlement([b, a], 'post');
    assert.deepEqual(forward, backward, `${a} + ${b} must be order-independent`);
    const [ra, rb] = [rowOf(a), rowOf(b)];
    const expected = ra.rank !== rb.rank
      ? (ra.rank < rb.rank ? a : b)                        // lower rank wins
      : (ra.code < rb.code ? a : b);                       // same rank: lowest cause code wins
    assert.equal(forward.primaryFact, expected, `${a} + ${b}`);
    assert.deepEqual(forward.secondaryCauses, [rowOf(expected === a ? b : a).code]);
  }
});

test('two DIFFERENT U8 causes pick the same primary in both orders (the C3 case)', () => {
  for (const order of [['capacity-exceeded', 'stale-placement'], ['stale-placement', 'capacity-exceeded']]) {
    const got = classifyUnitSettlement(order, 'post');
    assert.equal(got.cause, 'capacity-exceeded', `order ${order.join('+')}`);
    assert.deepEqual(got.secondaryCauses, ['stale-placement']);
  }
});

test('the review triple: cancel + unload/re-register + WorldDisposedError + failed post-digest', () => {
  const got = classifyUnitSettlement(
    ['scope-unverifiable', 'model-evicted', 'world-disposed'], 'post',
  );
  assert.equal(got.cause, 'world-disposed');
  assert.equal(got.outcome, 'failed');
  assert.equal(got.merges, false);
  assert.deepEqual(got.secondaryCauses, ['model-evicted', 'scope-unverifiable']); // ascending
});

test('secondaryCauses is distinct, ascending, and capped at 8', () => {
  const got = classifyUnitSettlement([...REAL, ...REAL], 'post');
  assert.equal(got.cause, 'world-disposed');
  assert.equal(got.secondaryCauses.length, 8);             // 12 others, capped (C3 in the open items)
  assert.deepEqual(got.secondaryCauses, [...got.secondaryCauses].sort());
  assert.equal(new Set(got.secondaryCauses).size, 8);
  // S-P6-C3 / spec erratum A7 (owner-clarified Option A): the surviving 8 are the FIRST 8 DISTINCT
  // causes in CANONICAL order — the canonically lowest 8, never an arrival-order sample.
  assert.deepEqual(got.secondaryCauses,
    REAL.filter((f) => f !== got.primaryFact).map((f) => rowOf(f).code).sort().slice(0, 8));
  // ...and the truncated tail is NOT lost: `observedCauses` is uncapped, so `collectReasons` — and
  // through it `RunOutcome.reasons` — still lists every one of the 13 observed facts (A7, AC-21).
  assert.deepEqual(got.observedCauses, REAL.map((f) => rowOf(f).code).sort());
  assert.deepEqual(collectReasons({
    unitCauses: [...got.observedCauses], planningCause: null, planningGapCauses: [],
    placementChangedVsSnapshot: false, cancelRequested: null,
    disposeRequested: false, allLeafUnitsTerminal: true,
  }), REAL.map((f) => `unit:${rowOf(f).code}`).sort());
});

test('phase decides failed vs skipped vs discarded for the phase-sensitive causes', () => {
  assert.equal(classifyUnitSettlement(['scope-drift'], 'pre').outcome, 'skipped');
  assert.equal(classifyUnitSettlement(['scope-drift'], 'post').outcome, 'discarded');
  assert.equal(classifyUnitSettlement(['model-evicted'], 'pre').outcome, 'skipped');
  assert.equal(classifyUnitSettlement(['model-evicted'], 'call').outcome, 'failed');
  assert.equal(classifyUnitSettlement(['target-too-large'], 'pre').outcome, 'not-run');
});

test('order B: failed > invalidated > cancelled > completed', () => {
  const base = {
    unitCauses: [], planningCause: null, planningGapCauses: [], placementChangedVsSnapshot: false,
    cancelRequested: null, disposeRequested: false, allLeafUnitsTerminal: false,
  };
  assert.equal(resolveRunStatus({ ...base, unitCauses: ['internal-error'], cancelRequested: { reason: 'x' } }), 'failed');
  assert.equal(resolveRunStatus({ ...base, planningCause: 'world-disposed', cancelRequested: { reason: 'x' } }), 'failed');
  assert.equal(resolveRunStatus({ ...base, planningCause: 'cancelled', cancelRequested: { reason: 'x' } }), 'cancelled');
  assert.equal(resolveRunStatus({ ...base, unitCauses: ['scope-drift'], cancelRequested: { reason: 'x' } }), 'invalidated');
  assert.equal(resolveRunStatus({ ...base, placementChangedVsSnapshot: true, cancelRequested: { reason: 'x' } }), 'invalidated');
  assert.equal(resolveRunStatus({ ...base, cancelRequested: { reason: 'x' } }), 'cancelled');
  assert.equal(resolveRunStatus({ ...base, disposeRequested: true }), 'cancelled');
  assert.equal(resolveRunStatus({ ...base, allLeafUnitsTerminal: true }), 'completed');
  assert.equal(resolveRunStatus(base), null);
});

test('reasons record a cancel even when a higher-precedence status won', () => {
  const reasons = collectReasons({
    unitCauses: ['scope-drift'], planningCause: null, planningGapCauses: [],
    placementChangedVsSnapshot: false,
    cancelRequested: { reason: 'user' }, disposeRequested: true, allLeafUnitsTerminal: false,
  });
  assert.ok(reasons.includes('cancel-requested'));
  assert.ok(reasons.includes('engine-disposed'));
  assert.ok(reasons.includes('unit:scope-drift'));
  assert.deepEqual(reasons, [...reasons].sort());
});

test('EVERY planning gap reaches reasons, not just the one that decided the status (Q2)', () => {
  // Re-verification question 2. The status is resolved from ONE cause (order B), but §6.6.2 gaps
  // are coverage facts: dropping the others would silently hide a gap from every consumer that
  // reads `RunOutcome.reasons` as the caveat list.
  const state = {
    unitCauses: [], planningCause: 'enumeration-failed',
    planningGapCauses: ['cancelled', 'enumeration-failed', 'enumeration-failed'],
    placementChangedVsSnapshot: false, cancelRequested: { reason: 'user' },
    disposeRequested: false, allLeafUnitsTerminal: false,
  };
  const reasons = collectReasons(state);
  assert.deepEqual(reasons,
    ['cancel-requested', 'planning:cancelled', 'planning:enumeration-failed'],
    'distinct, ascending, and the primary cause is not privileged',
  );
  assert.equal(resolveRunStatus(state), 'failed', 'the STATUS still comes from planningCause alone');
});

test('a run with no cause at all has NO reasons (I5)', () => {
  // U9 has `cause: null`; a clean completed run must seal `reasons: []`. Pushing a placeholder
  // like 'evaluated' into `unitCauses` would put `unit:evaluated` into every clean run's reasons,
  // change its serialized output, and read as a caveat to consumers.
  assert.deepEqual(collectReasons({
    unitCauses: [], planningCause: null, planningGapCauses: [],
    placementChangedVsSnapshot: false, cancelRequested: null,
    disposeRequested: false, allLeafUnitsTerminal: true,
  }), []);
});
