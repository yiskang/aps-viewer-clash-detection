// test/clashtest/results/resultSet.merge.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectUnitPairs, compareResults, createResultAccumulator } from '../../../clashtest/results/resultSet.js';
import { RUN_OPTION_DEFAULTS } from '../../../clashtest/options.js';

const ref = (modelKey, dbId) => ({ modelKey, dbId });
// Plan order is EXPLICIT (§11.4 rule 2): never a lexical unitId compare.
const rank = (...unitIds) => new Map(unitIds.map((id, i) => [id, i]));
// P1's real makeResultId enforces the "sha256:" + 64 lowercase hex format (identity/ids.js
// SEMANTIC_DIGEST_PATTERN); the brief's illustrative 'sha256:abc' does not pass it, so this fixture
// uses a format-valid digest instead (this is exactly what "verify against P1's real code" catches).
const FAKE_DIGEST = `sha256:${'a'.repeat(64)}`;
const ctx = (over = {}) => ({
  mode: 'volume-overlap', testId: 'T1', semanticDigest: FAKE_DIGEST,
  maxResultsPerRun: RUN_OPTION_DEFAULTS.maxResultsPerRun,
  unitPlanRank: rank('u1', 'u2', 'u3'),
  unreachableOwners: new Map(), mixedOwners: new Map(), ...over,
});

test('projection carries mode, never type, and normalizes -0', () => {
  const out = projectUnitPairs({
    unitId: 'u1', pairs: [{ source: ref('MB', 9), target: ref('MA', 1), type: 'volume-overlap',
      witness: { kind: 'surface-crossing', point: [-0, 1, 2] } }],
  }, ctx());
  assert.equal(out.length, 1);
  assert.equal(out[0].mode, 'volume-overlap');
  assert.equal('type' in out[0], false);
  assert.deepEqual(out[0].pair, { first: ref('MA', 1), second: ref('MB', 9) });   // unordered: lesser first
  assert.deepEqual(out[0].evaluatedAs, { source: ref('MB', 9), target: ref('MA', 1) });
  assert.equal(Object.is(out[0].evidence.witness.point[0], 0), true);             // -0 → 0
  assert.equal(out[0].unitId, 'u1');
});

test('clearance evidence is re-keyed to first/second by PairId, not by library role', () => {
  const [r] = projectUnitPairs({
    unitId: 'u1', pairs: [{ source: ref('MB', 9), target: ref('MA', 1), type: 'clearance',
      distance: 0.25, clearance: 1, witness: { sourcePoint: [9, 9, 9], targetPoint: [1, 1, 1] } }],
  }, ctx({ mode: 'clearance' }));
  assert.deepEqual(r.evidence.closestPoints, { first: [1, 1, 1], second: [9, 9, 9] });
  assert.equal(r.evidence.distance, 0.25);
});

test('containment keeps library orientation (ordered semantics) and empty evidence', () => {
  const [r] = projectUnitPairs({
    unitId: 'u1', pairs: [{ source: ref('MB', 9), target: ref('MA', 1), type: 'containment' }],
  }, ctx({ mode: 'containment' }));
  assert.deepEqual(r.pair, { first: ref('MB', 9), second: ref('MA', 1) });        // contained first
  assert.deepEqual(r.evidence, {});
});

test('accumulator sorts across units and applies the whole-unit result cap', () => {
  const acc = createResultAccumulator(ctx({ maxResultsPerRun: 2 }));
  assert.deepEqual(acc.addUnit({ unitId: 'u2', pairs: [
    { source: ref('MB', 9), target: ref('MA', 2), type: 'volume-overlap', witness: null }] }),
    { accepted: true, added: 1 });
  assert.deepEqual(acc.addUnit({ unitId: 'u1', pairs: [
    { source: ref('MA', 1), target: ref('MB', 7), type: 'volume-overlap', witness: null },
    { source: ref('MA', 1), target: ref('MB', 9), type: 'volume-overlap', witness: null }] }),
    { accepted: false, reason: 'result-cap' });                                   // whole unit refused
  assert.deepEqual(acc.toArray().map((r) => r.unitId), ['u2']);                   // nothing partially merged
  assert.equal(acc.toArray()[0].flags.witnessUnavailable, true);
});

// P6 re-verification Critical 4: P6 needs to know BEFORE it commits a unit to the diagnostic
// aggregator and statistics accumulator, neither of which can be rolled back.
test('canAdmitUnit answers the same as addUnit and mutates nothing', () => {
  const acc = createResultAccumulator(ctx({ maxResultsPerRun: 2 }));
  const fits = { unitId: 'u2', pairs: [
    { source: ref('MB', 9), target: ref('MA', 2), type: 'volume-overlap', witness: null }] };
  const overflows = { unitId: 'u1', pairs: [
    { source: ref('MA', 1), target: ref('MB', 7), type: 'volume-overlap', witness: null },
    { source: ref('MA', 1), target: ref('MB', 9), type: 'volume-overlap', witness: null }] };

  assert.deepEqual(acc.canAdmitUnit(fits), { admissible: true });
  assert.equal(acc.size(), 0, 'the probe merged nothing');
  acc.addUnit(fits);
  assert.equal(acc.size(), 1);

  // Repeated probes are idempotent and never mutate — P6 may call it as often as it likes.
  const before = JSON.stringify(acc.toArray());
  for (let i = 0; i < 3; i += 1) {
    assert.deepEqual(acc.canAdmitUnit(overflows), { admissible: false, reason: 'result-cap' });
  }
  assert.equal(acc.size(), 1);
  assert.equal(JSON.stringify(acc.toArray()), before, 'no flag, no result, nothing changed');

  // …and the refusal from addUnit itself is equally side-effect-free (transactional).
  assert.deepEqual(acc.addUnit(overflows), { accepted: false, reason: 'result-cap' });
  assert.equal(acc.size(), 1);
  assert.equal(JSON.stringify(acc.toArray()), before);

  // The two always agree, including on a unit whose pairs are all DUPLICATES (no additions, so it
  // is admissible even at the cap) — the case where a "count the pairs" shortcut would diverge.
  const dupes = createResultAccumulator(ctx({ maxResultsPerRun: 1 }));
  dupes.addUnit(fits);
  assert.deepEqual(dupes.canAdmitUnit({ ...fits, unitId: 'u3' }), { admissible: true });
  assert.deepEqual(dupes.addUnit({ ...fits, unitId: 'u3' }), { accepted: true, added: 0 });
});

test('canonical order is by PairId only and duplicates reconcile to canonical orientation', () => {
  const acc = createResultAccumulator(ctx());
  acc.addUnit({ unitId: 'u1', pairs: [{ source: ref('MA', 1), target: ref('MB', 7),
    type: 'volume-overlap', witness: { kind: 'containment', point: [0, 0, 0] } }] });
  acc.addUnit({ unitId: 'u2', pairs: [{ source: ref('MB', 7), target: ref('MA', 1),
    type: 'volume-overlap', witness: { kind: 'containment', point: [0, 0, 0] } }] });
  const [only] = acc.toArray();
  assert.equal(acc.size(), 1);
  assert.deepEqual(only.evaluatedAs.source, ref('MA', 1));                        // rule 2: source === pair.first
  assert.equal(only.flags.duplicateEvidenceConflict, undefined);
  assert.equal(compareResults(only, only), 0);
});

test('a duplicate whose evidence disagrees is flagged', () => {
  const acc = createResultAccumulator(ctx({ mode: 'clearance' }));
  const p = (d) => ({ source: ref('MA', 1), target: ref('MB', 7), type: 'clearance',
    distance: d, clearance: 1, witness: { sourcePoint: [0, 0, 0], targetPoint: [d, 0, 0] } });
  acc.addUnit({ unitId: 'u1', pairs: [p(0.25)] });
  acc.addUnit({ unitId: 'u2', pairs: [p(0.5)] });
  assert.equal(acc.toArray()[0].flags.duplicateEvidenceConflict, true);
});

test('flags record unreachable and mixed owners from plan data, never from the unit', () => {
  const [r] = projectUnitPairs({ unitId: 'u1', pairs: [
    { source: ref('MA', 1), target: ref('MB', 950), type: 'volume-overlap', witness: null }] },
    ctx({ unreachableOwners: new Map([['MB', new Set([950])]]),
          mixedOwners: new Map([['MA', new Set([1])]]) }));
  assert.equal(r.flags.unreachableOwner, true);
  assert.equal(r.flags.mixedOwnerProvenance, true);
});

test('duplicate reconciliation uses the supplied plan rank, not a lexical unitId compare', () => {
  // '1.10' < '1.2' lexically but is LATER in plan order: the rank map is the only authority.
  const pairs = [{ source: ref('MA', 1), target: ref('MB', 7), type: 'volume-overlap', witness: null }];
  const order = [['1.2', '1.10'], ['1.10', '1.2']];               // both settlement orders, same answer
  for (const [firstSettled, secondSettled] of order) {
    const acc = createResultAccumulator(ctx({ unitPlanRank: rank('1.2', '1.10') }));
    acc.addUnit({ unitId: firstSettled, pairs });
    acc.addUnit({ unitId: secondSettled, pairs });
    assert.equal(acc.size(), 1);
    assert.equal(acc.toArray()[0].unitId, '1.2', `${firstSettled} then ${secondSettled}`);
  }
});

test('an unranked unit loses to every ranked one and ties break deterministically', () => {
  const pairs = [{ source: ref('MA', 1), target: ref('MB', 7), type: 'volume-overlap', witness: null }];
  const acc = createResultAccumulator(ctx({ unitPlanRank: rank('u5') }));
  acc.addUnit({ unitId: 'unknown-unit', pairs });
  acc.addUnit({ unitId: 'u5', pairs });
  assert.equal(acc.toArray()[0].unitId, 'u5');
});

// codex-advisor finding (2026-09-22): `evaluatedAs.source`/`.target` must be normalized through
// P1's own `elementRefFrom` exactly like `pair.first`/`pair.second`, not copied verbatim from the
// executor's pair. Otherwise a -0 dbId (legal per P1's isValidDbId: Number.isSafeInteger(-0) &&
// -0 >= 0) normalizes in `pair` but survives in `evaluatedAs`, so the two ElementRef-shaped fields
// of one ClashResult disagree under Object.is, and a JSON round-trip (which collapses -0 -> 0) would
// silently change `evaluatedAs` while leaving `pair` untouched.
test('evaluatedAs is normalized exactly like pair: a -0 dbId becomes 0, detached from the input', () => {
  const inputSource = { modelKey: 'MA', dbId: -0 };
  const inputTarget = { modelKey: 'MB', dbId: 1 };
  const [r] = projectUnitPairs({
    unitId: 'u1', pairs: [{ source: inputSource, target: inputTarget, type: 'volume-overlap', witness: null }],
  }, ctx());
  assert.equal(Object.is(r.evaluatedAs.source.dbId, -0), false, 'evaluatedAs.source.dbId must normalize -0 to 0');
  assert.equal(Object.is(r.evaluatedAs.source.dbId, 0), true);
  assert.equal(r.evaluatedAs.source.dbId, r.pair.first.dbId, 'pair and evaluatedAs must agree bit-for-bit');
  assert.notEqual(r.evaluatedAs.source, inputSource, 'evaluatedAs must be a detached copy, never the executor\'s own object');
  const roundTripped = JSON.parse(JSON.stringify(r));
  assert.deepEqual(roundTripped, r, 'a JSON round-trip must be a no-op once -0 is normalized at projection');
});

// codex-advisor finding (2026-09-22): the pairwise reconciliation fold compares only the CURRENT
// front against each newly-arriving duplicate, so a later record that happens to pairwise-AGREE
// with the current front -- even though an earlier round already found a real disagreement -- must
// not silently erase the flag. Sequence: u1(0.5) establishes the front; u2(0.25) disagrees, wins on
// rank, and gets flagged; u3(0.25) agrees with u2 (the current front, NOT with u1) and wins on rank
// too. The u2-vs-u3 comparison alone finds no new mismatch, so without carrying the flag forward the
// final winner would report no conflict at all, silently forgetting the real one between u1 and u2.
test('duplicateEvidenceConflict is sticky across 3+ duplicates regardless of settlement order', () => {
  const p = (d) => ({ source: ref('MA', 1), target: ref('MB', 7), type: 'clearance',
    distance: d, clearance: 1, witness: { sourcePoint: [0, 0, 0], targetPoint: [d, 0, 0] } });
  const acc = createResultAccumulator(ctx({ mode: 'clearance', unitPlanRank: rank('u3', 'u2', 'u1') }));
  acc.addUnit({ unitId: 'u1', pairs: [p(0.5)] });   // rank 2 (last): establishes the front
  acc.addUnit({ unitId: 'u2', pairs: [p(0.25)] });  // rank 1: disagrees with u1, wins on rank -> flagged
  acc.addUnit({ unitId: 'u3', pairs: [p(0.25)] });  // rank 0: AGREES with u2 (the current front), wins
                                                     // on rank too -- the u1/u2 conflict must still survive
  assert.equal(acc.size(), 1);
  assert.equal(acc.toArray()[0].unitId, 'u3');
  assert.equal(acc.toArray()[0].flags.duplicateEvidenceConflict, true,
    'a conflict detected against an earlier front must not be forgotten once a later, agreeing record wins by rank');
});
