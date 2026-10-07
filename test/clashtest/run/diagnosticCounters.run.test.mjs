// test/clashtest/run/diagnosticCounters.run.test.mjs
//
// Option D (owner-authorized 2026-10-07): the per-unit progress commit (`applyUnitResult`) reads the
// aggregator's O(1) `counters()` instead of a full sorted `snapshot()` after every unit; the full
// `snapshot()` is taken exactly ONCE, at seal (A11/N20: "snapshot() once at seal").
//
// Old-vs-new at Run level: the SAME run is driven twice — once through an aggregator whose `counters()`
// is computed from a full `snapshot()` (exactly the pre-D per-unit read) and once through the real one —
// and every per-unit progress snapshot and the sealed Result Set must be identical, for completed,
// cancelled (Stop) and failed-unit runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRun } from '../../../clashtest/run/Run.js';
import { createRunFixture } from '../support/runFixture.mjs';
import { createFakePlan } from '../support/fakePlanner.mjs';
import { createScriptedExecutor } from '../support/scriptedExecutor.mjs';

const UNITS = 12;
const REASONS = ['fragment-not-loaded', 'witness-unavailable', 'inconclusive-crossing', 'fragment-null-geometry', 'non-manifold-component'];

/** Explicit pairs (the scripted executor's numeric `pairs` shorthand numbers dbIds from module state). */
const pairsOf = (u) => Array.from({ length: u % 3 }, (_, k) => ({
  source: { modelKey: 'mk-a', dbId: 10 * u + k }, target: { modelKey: 'mk-a', dbId: 500 + 10 * u + k }, type: 'volume-overlap', witness: null,
}));

/** Each unit carries a few diagnostics, with cross-unit repeats (dedup), non-affecting reasons and one failing unit. */
function script({ withFailure = false } = {}) {
  const s = {};
  for (let u = 0; u < UNITS; u++) {
    const diagnostics = [];
    for (let i = 0; i <= u % 4; i++) {
      diagnostics.push({ reason: REASONS[(u + i) % REASONS.length], dbId: (u * 3 + i) % 7, fragId: (u * 2 + i) % 7 });
    }
    s[`1.${u}`] = withFailure && u === 5 ? [{ facts: ['library-error'] }] : [{ facts: [], pairs: pairsOf(u), diagnostics }];
  }
  return s;
}

function fixture(opts) {
  return createRunFixture({
    plan: createFakePlan(Array.from({ length: UNITS }, (_, u) => ({ unitId: `1.${u}`, weight: u === 0 ? 50 : 1 }))),
    runOptions: { maxRetainedDiagnostics: 6, maxUnitIdsPerDiagnostic: 2 },   // truncation exercised
    executor: createScriptedExecutor(script(opts)),
  });
}

/** Pre-D behaviour: the per-unit counters come from a full `snapshot()`. */
function legacy(real) {
  return {
    addUnit: (unitId, outcome) => real.addUnit(unitId, outcome),
    snapshot: () => real.snapshot(),
    counters: () => {
      const s = real.snapshot();
      return { total: s.total, completenessAffectingCount: s.completenessAffectingCount, unclassifiedOccurrences: s.unclassifiedOccurrences };
    },
  };
}

/** Counts `snapshot()` calls on the aggregator the run is given. */
function counted(aggregator) {
  const calls = { snapshot: 0, counters: 0 };
  return {
    calls,
    aggregator: {
      ...aggregator,
      addUnit: (unitId, outcome) => aggregator.addUnit(unitId, outcome),
      snapshot: () => { calls.snapshot += 1; return aggregator.snapshot(); },
      counters: () => { calls.counters += 1; return aggregator.counters(); },
    },
  };
}

const strip = ({ elapsedMs, ...rest }) => rest;

async function drive({ mode, opts = {}, cancelAfter = null }) {
  const fx = fixture(opts);
  const base = mode === 'legacy' ? legacy(fx.spec.diagnosticAggregator) : fx.spec.diagnosticAggregator;
  const { calls, aggregator } = counted(base);
  const { handle, begin } = createRun({ ...fx.spec, diagnosticAggregator: aggregator });
  const perUnit = [];
  handle.subscribe((event) => { if (event.type === 'unit') perUnit.push(strip(handle.getSnapshot())); });
  if (cancelAfter !== null) void fx.afterUnit(cancelAfter, () => handle.cancel('user'));
  begin();
  const summary = await handle.done;
  return { summary, perUnit, calls, final: strip(handle.getSnapshot()) };
}

for (const [name, args] of [
  ['completed run', {}],
  ['cancelled (Stop) run', { cancelAfter: '1.6' }],
  ['run with a failing unit', { opts: { withFailure: true } }],
]) {
  test(`D old-vs-new (${name}): identical per-unit progress and identical sealed Result Set`, async () => {
    const old = await drive({ mode: 'legacy', ...args });
    const now = await drive({ mode: 'current', ...args });
    assert.ok(old.perUnit.length >= 2, 'premise: several unit events');
    assert.ok(old.perUnit.some((s) => s.caveatCount > 0), 'premise: caveats move during the run');
    assert.deepEqual(now.perUnit, old.perUnit, 'every per-unit snapshot (caveatCount, caveatUnclassified, …) identical');
    assert.deepEqual(now.final, old.final);
    assert.equal(now.summary.status, old.summary.status);
    assert.deepEqual(now.summary.resultSet, old.summary.resultSet, 'sealed Result Set identical');
    assert.equal(JSON.stringify(now.summary.resultSet), JSON.stringify(old.summary.resultSet), 'sealed Result Set byte-identical');
    assert.equal(now.summary.resultSet.diagnostics.truncated, true, 'premise: truncation exercised');
    if (args.cancelAfter) assert.equal(now.summary.status, 'cancelled');
  });
}

for (const [name, args] of [
  ['completed', {}],
  ['cancelled', { cancelAfter: '1.6' }],
  ['failing unit', { opts: { withFailure: true } }],
]) {
  test(`D: the full snapshot() is taken exactly once, at seal (${name}); per unit only counters()`, async () => {
    const now = await drive({ mode: 'current', ...args });
    assert.equal(now.calls.snapshot, 1, 'one full snapshot per run, for the sealed set');
    assert.equal(now.calls.counters, now.perUnit.length, 'one O(1) counters() read per settled unit');
    const d = now.summary.resultSet.diagnostics;
    assert.equal(now.final.caveatCount, d.completenessAffectingCount, 'final progress agrees with the sealed summary');
    assert.equal(now.final.caveatUnclassified, d.unclassifiedOccurrences);
  });
}

test('D compatibility: an N20 aggregator without counters() still runs, and identically (per-unit read falls back to snapshot())', async () => {
  const old = await drive({ mode: 'legacy' });
  const fx = fixture({});
  const real = fx.spec.diagnosticAggregator;
  const n20Only = { addUnit: (unitId, outcome) => real.addUnit(unitId, outcome), snapshot: () => real.snapshot() };
  const { handle, begin } = createRun({ ...fx.spec, diagnosticAggregator: n20Only });
  const perUnit = [];
  handle.subscribe((event) => { if (event.type === 'unit') perUnit.push(strip(handle.getSnapshot())); });
  begin();
  const summary = await handle.done;
  assert.equal(summary.status, 'completed', JSON.stringify(summary.resultSet.outcome));
  assert.deepEqual(perUnit, old.perUnit);
  assert.equal(JSON.stringify(summary.resultSet), JSON.stringify(old.summary.resultSet));
});
