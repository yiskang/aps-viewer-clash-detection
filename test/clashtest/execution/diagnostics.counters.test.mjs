// test/clashtest/execution/diagnostics.counters.test.mjs
//
// Option D (owner-authorized 2026-10-07, docs/research/2026-10-07-architecture-self-clash-post-d-e-profile.md):
// the run's per-unit progress commit needs only three EXACT counters of the aggregator, not the whole
// sorted/truncated `DiagnosticsSummary`. `counters()` reads them in O(1) — no sort, no copy of the
// de-duplication map — while `snapshot()` (the seal-time read P5 stores verbatim) is unchanged.
//
// These tests pin that:
//   (1) for a seeded, representative diagnostic stream (fragment + pair scopes, known/unknown/
//       non-affecting reasons, cross-unit duplicates, null-modelKey operands, whole-array overflow
//       units, a small `maxDistinctReasons` so reasons are omitted, a small `maxRetainedDiagnostics`
//       so the retained list truncates), the per-unit `counters()` equal the per-unit `snapshot()`
//       fields the pre-D Run read, and an aggregator read with `counters()` per unit ends in a final
//       `snapshot()` deep-equal to one read with `snapshot()` per unit (retained set, order, dedup,
//       occurrences, unitIds, truncation, countsByReason, every count) — and `addUnit` returns the
//       same `unitTaints` either way;
//   (2) `counters()` sorts nothing and copies nothing, whatever the retained size (not O(retained));
//   (3) `counters()` keeps the Σ-invariant guard `snapshot()` has.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createDiagnosticAggregator, isCompletenessAffecting, attributionOf, KNOWN_DIAGNOSTIC_REASONS,
} from '../../../clashtest/execution/diagnostics.js';
import { createSlicer } from '../../../clashtest/util/slicer.js';

const neverYields = () => createSlicer({ now: () => 0, yieldToScheduler: async () => {} });
const agg = (over = {}) => createDiagnosticAggregator({
  maxRetainedDiagnostics: 40, maxDistinctReasons: 9, maxUnitIdsPerDiagnostic: 3, slicer: neverYields(), ...over,
});

/** mulberry32: a tiny deterministic PRNG so the stream is reproducible. */
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const REASONS = [...KNOWN_DIAGNOSTIC_REASONS, 'future-unknown-reason'];
const MODEL_KEYS = ['mk-a', 'mk-b', null];

function operand(rand) {
  const modelKey = MODEL_KEYS[Math.floor(rand() * MODEL_KEYS.length)];
  const fragId = Math.floor(rand() * 30);
  const dbId = rand() < 0.2 ? null : 100 + fragId;
  return { modelKey, dbId, fragId };
}
const order = (a, b) => {
  const na = a.modelKey === null ? 1 : 0; const nb = b.modelKey === null ? 1 : 0;
  if (na !== nb) return na - nb;
  const ka = a.modelKey ?? ''; const kb = b.modelKey ?? '';
  return ka !== kb ? (ka < kb ? -1 : 1) : a.fragId - b.fragId;
};
function diagnostic(rand) {
  const reason = REASONS[Math.floor(rand() * REASONS.length)];
  const base = { reason, completenessAffecting: isCompletenessAffecting(reason) };
  let d;
  if (rand() < 0.6) {
    d = { scope: 'fragment', ...base, fragment: operand(rand) };
  } else {
    const [first, second] = [operand(rand), operand(rand)].sort(order);
    d = { scope: 'pair', ...base, fragments: { first, second } };
  }
  d.attribution = attributionOf(d);
  return d;
}
/** A unit stream: mostly arrays of 0..25 diagnostics (with deliberate repeats), sometimes a whole-array overflow. */
function stream(seed, units) {
  const rand = prng(seed);
  const out = [];
  for (let u = 0; u < units; u++) {
    if (rand() < 0.08) { out.push({ unitId: `3b.${u}`, outcome: { diagnosticOverflowLength: 1 + Math.floor(rand() * 500) } }); continue; }
    const n = Math.floor(rand() * 26);
    const ds = [];
    for (let i = 0; i < n; i++) ds.push(rand() < 0.15 && ds.length > 0 ? ds[Math.floor(rand() * ds.length)] : diagnostic(rand));
    out.push({ unitId: `3b.${u}`, outcome: { diagnostics: ds } });
  }
  return out;
}

const COUNTER_FIELDS = ['total', 'completenessAffectingCount', 'unclassifiedOccurrences'];
const pick = (s) => Object.fromEntries(COUNTER_FIELDS.map((k) => [k, s[k]]));

for (const [seed, unitCount, over] of [
  [1, 300, {}],
  [7, 300, { maxDistinctReasons: 3 }],                                   // many omitted reasons
  [42, 200, { maxRetainedDiagnostics: 5, maxUnitIdsPerDiagnostic: 0 }],  // heavy truncation, no unitIds
  [2026, 400, { maxRetainedDiagnostics: 100000, maxDistinctReasons: 64 }], // nothing truncated / omitted
]) {
  test(`D equivalence (seed ${seed}): per-unit counters() == per-unit snapshot() fields; final snapshot identical`, async () => {
    const units = stream(seed, unitCount);
    const legacy = agg(over);    // pre-D: full snapshot() after EVERY unit
    const current = agg(over);   // post-D: counters() after every unit, snapshot() once at seal
    let sawOverflow = false;
    let sawAffecting = false;
    for (const { unitId, outcome } of units) {
      const a = await legacy.addUnit(unitId, outcome);
      const b = await current.addUnit(unitId, outcome);
      assert.deepEqual(b, a, `${unitId}: identical unitTaints`);
      const old = legacy.snapshot();
      const now = current.counters();
      assert.deepEqual(now, pick(old), `${unitId}: identical per-unit counters`);
      if (outcome.diagnosticOverflowLength !== undefined) sawOverflow = true;
      if (old.completenessAffectingCount > 0) sawAffecting = true;
    }
    const finalLegacy = legacy.snapshot();
    const finalCurrent = current.snapshot();
    assert.deepEqual(finalCurrent, finalLegacy, 'identical sealed DiagnosticsSummary');
    assert.equal(JSON.stringify(finalCurrent), JSON.stringify(finalLegacy), 'byte-identical, including key and element order');
    assert.ok(sawOverflow && sawAffecting, 'premise: the stream exercises overflow and completeness-affecting diagnostics');
    if (over.maxRetainedDiagnostics === 5) assert.equal(finalCurrent.truncated, true, 'premise: truncation exercised');
    if (over.maxDistinctReasons === 3) assert.ok(finalCurrent.omittedReasonOccurrences > 0, 'premise: omission exercised');
  });
}

test('D: counters() returns exactly the three exact counters, as a fresh plain object', async () => {
  const a = agg();
  assert.deepEqual(a.counters(), { total: 0, completenessAffectingCount: 0, unclassifiedOccurrences: 0 });
  const [{ outcome }] = stream(3, 1).filter((u) => u.outcome.diagnostics?.length > 0);
  await a.addUnit('1.0', outcome);
  const c = a.counters();
  assert.deepEqual(Object.keys(c), COUNTER_FIELDS);
  c.total = -1;                                         // a caller's mutation never reaches the aggregator
  assert.deepEqual(a.counters(), pick(a.snapshot()));
});

/** Counts calls to the copy/sort primitives `snapshot()` uses, while `fn` runs. */
function countCopySort(fn) {
  const saved = { sort: Array.prototype.sort, values: Map.prototype.values, slice: Array.prototype.slice };
  const calls = { sort: 0, values: 0, slice: 0 };
  Array.prototype.sort = function sort(...args) { calls.sort += 1; return saved.sort.apply(this, args); };
  Map.prototype.values = function values(...args) { calls.values += 1; return saved.values.apply(this, args); };
  Array.prototype.slice = function slice(...args) { calls.slice += 1; return saved.slice.apply(this, args); };
  try { fn(); } finally {
    Array.prototype.sort = saved.sort; Map.prototype.values = saved.values; Array.prototype.slice = saved.slice;
  }
  return calls;
}

test('D: counters() neither sorts nor copies the retained set, at any size (snapshot() does)', async () => {
  for (const size of [10, 20000]) {
    const a = agg({ maxRetainedDiagnostics: 50000, maxDistinctReasons: 64 });
    const ds = Array.from({ length: size }, (_, i) => {
      const d = { scope: 'fragment', reason: 'inconclusive-crossing', completenessAffecting: true, fragment: { modelKey: 'mk-a', dbId: i, fragId: i } };
      d.attribution = attributionOf(d);
      return d;
    });
    await a.addUnit('1.0', { diagnostics: ds });
    const viaCounters = countCopySort(() => a.counters());
    assert.deepEqual(viaCounters, { sort: 0, values: 0, slice: 0 }, `size ${size}: counters() touches no retained entry`);
    const viaSnapshot = countCopySort(() => a.snapshot());
    assert.ok(viaSnapshot.sort >= 1 && viaSnapshot.values >= 1, `size ${size}: premise — the spy sees snapshot()'s sort/copy`);
    assert.equal(a.counters().total, size);
  }
});

test('D: counters() cost does not grow with the retained set (fixed small work per call)', async () => {
  // Deterministic stand-in for "not O(retained)": the comparator snapshot() sorts with is invoked
  // O(n log n) times; counters() must invoke no comparator and read no entry at either size. Timing is
  // deliberately NOT asserted (machine-dependent); the call counts are.
  const sizes = [100, 30000];
  const iterations = [];
  for (const size of sizes) {
    const a = agg({ maxRetainedDiagnostics: 50000, maxDistinctReasons: 64 });
    const ds = Array.from({ length: size }, (_, i) => {
      const d = { scope: 'fragment', reason: 'fragment-not-loaded', completenessAffecting: true, fragment: { modelKey: 'mk-b', dbId: i, fragId: i } };
      d.attribution = attributionOf(d);
      return d;
    });
    await a.addUnit('1.0', { diagnostics: ds });
    let iterated = 0;
    const realIter = Map.prototype[Symbol.iterator];
    const realForEach = Map.prototype.forEach;
    Map.prototype[Symbol.iterator] = function it(...args) { iterated += 1; return realIter.apply(this, args); };
    Map.prototype.forEach = function fe(...args) { iterated += 1; return realForEach.apply(this, args); };
    try {
      for (let i = 0; i < 1000; i++) a.counters();
    } finally {
      Map.prototype[Symbol.iterator] = realIter;
      Map.prototype.forEach = realForEach;
    }
    iterations.push(iterated);
  }
  assert.deepEqual(iterations, [0, 0], 'no Map iteration from counters() at either size');
});

test('D: counters() keeps snapshot()\'s Σ-invariant guard (an engine defect is still surfaced, not a wrong number)', async () => {
  const a = agg();
  const d = { scope: 'fragment', reason: 'fragment-not-loaded', completenessAffecting: true, fragment: { modelKey: 'mk-a', dbId: 1, fragId: 1 } };
  d.attribution = attributionOf(d);
  await a.addUnit('1.0', { diagnostics: [d] });
  // The only way to break Σ from outside is to mutate a countsByReason bucket handed out by snapshot().
  a.snapshot().countsByReason[0].count += 1;
  assert.throws(() => a.snapshot(), /Sigma invariant violated/);
  assert.throws(() => a.counters(), /Sigma invariant violated/);
});
