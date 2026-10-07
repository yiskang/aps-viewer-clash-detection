// test/clashtest/execution/diagnostics.aggregate.test.mjs
//
// P4.9: cross-unit aggregation — the one bridge between `ProjectedDiagnostic` and
// `NormalizedDiagnostic` (§11.2, §12.4), with the exactness invariant as an assertion rather than a
// comment — plus the §12.6 statistics passthrough.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createDiagnosticAggregator, createStatisticsAccumulator, isCompletenessAffecting, attributionOf,
} from '../../../clashtest/execution/diagnostics.js';
import { RUN_OPTION_DEFAULTS } from '../../../clashtest/options.js';   // never hard-code the numbers
import { createSlicer } from '../../../clashtest/util/slicer.js';      // P0 — the only slicer factory

/** A never-due slicer: a constant clock means `tick()` always returns `undefined` (P0, row N6). */
const neverYields = () => createSlicer({ now: () => 0, yieldToScheduler: async () => {} });

const agg = (over = {}) => createDiagnosticAggregator({
  maxRetainedDiagnostics: RUN_OPTION_DEFAULTS.maxRetainedDiagnostics,
  maxDistinctReasons: RUN_OPTION_DEFAULTS.maxDistinctReasons,
  maxUnitIdsPerDiagnostic: RUN_OPTION_DEFAULTS.maxUnitIdsPerDiagnostic,
  slicer: neverYields(), ...over,
});

// Test helpers not spelled out verbatim by the plan (its P4.9 code sample uses `projected(...)` and
// `outcomeWith(...)` without defining them) — built to the shapes P4.2 already established:
// `projected` produces a fragment-scope ProjectedDiagnostic directly from an already-resolved
// operand (bypassing the raw-modelId binding-table step, which P4.2's own tests already cover), and
// `outcomeWith` builds the minimal `UnitOutcome`-shaped object the aggregator actually reads
// (`diagnostics`, optionally overridden with `diagnosticOverflowLength` by the caller).
function projected(reason, operand, attributionOverride) {
  const fragment = { modelKey: operand.modelKey, dbId: operand.dbId, fragId: operand.fragId };
  const base = { scope: 'fragment', reason, completenessAffecting: isCompletenessAffecting(reason), fragment };
  base.attribution = attributionOverride ?? attributionOf(base);
  return base;
}
const outcomeWith = (diagnostics) => ({ diagnostics });

const many = (n, reason, from = 0) => Array.from({ length: n },
  (_, i) => projected(typeof reason === 'function' ? reason(i) : reason, { modelKey: 'mk-a', dbId: from + i, fragId: from + i }));

test('the projection is the identity on shared fields; only occurrences and unitIds are added', async () => {
  const a = agg();
  const d = projected('geometry-not-yet-available', { modelKey: 'mk-a', dbId: 5, fragId: 1 });
  await a.addUnit('1.0', outcomeWith([d]));
  await a.addUnit('1.1', outcomeWith([d]));
  const [n] = a.snapshot().diagnostics;
  assert.deepEqual(Object.fromEntries(Object.entries(n).filter(([k]) => k !== 'occurrences' && k !== 'unitIds')), d);
  assert.equal(n.occurrences, 2);
  assert.deepEqual(n.unitIds, ['1.0', '1.1']);
});

test('unitIds are capped but occurrences are not', async () => {
  const a = agg();
  const d = projected('non-manifold-component', { modelKey: 'mk-a', dbId: 5, fragId: 1 });
  for (let i = 0; i < 20; i++) await a.addUnit(`1.${i}`, outcomeWith([d]));
  const [n] = a.snapshot().diagnostics;
  assert.equal(n.occurrences, 20);
  assert.equal(n.unitIds.length, RUN_OPTION_DEFAULTS.maxUnitIdsPerDiagnostic);
});

test('a null-modelKey diagnostic is NEVER merged across units', async () => {
  const a = agg();
  const d = projected('fragment-owner-unresolvable', { modelKey: null, dbId: null, fragId: 3 }, 'unit');
  await a.addUnit('1.0', outcomeWith([d]));
  await a.addUnit('1.1', outcomeWith([d]));
  assert.equal(a.snapshot().diagnostics.length, 2, 'its unit attribution is per unit');
});

test('a whole-array overflow marker keeps totals exact, never inflates the affecting count, and taints', async () => {
  const a = agg();
  const { unitTaints } = await a.addUnit('1.0', { ...outcomeWith([]), diagnosticOverflowLength: 300_000 });
  const s = a.snapshot();
  assert.equal(s.total, 300_000);
  assert.equal(s.unclassifiedOccurrences, 300_000);
  assert.equal(s.completenessAffectingCount, 0, 'never inflated to look exact');
  assert.equal(s.completenessAffectingUpperBound, 300_000);
  assert.deepEqual(s.countsByReason, []);
  assert.deepEqual(unitTaints, [{ kind: 'unit', modelKey: null, reason: 'diagnostic-overflow', occurrences: 300_000 }]);
});

test('100,000 distinct reasons: retained keys are capped, totals stay exact, Σ invariant holds', async () => {
  const a = agg();
  const { unitTaints } = await a.addUnit('1.0', outcomeWith(many(100_000, (i) => `r${String(i).padStart(6, '0')}`)));
  const s = a.snapshot();
  assert.equal(s.total, 100_000);
  assert.equal(s.completenessAffectingCount, 100_000, 'all examined');
  assert.equal(s.unclassifiedOccurrences, 0);
  assert.ok(s.countsByReason.length <= RUN_OPTION_DEFAULTS.maxDistinctReasons);
  assert.equal(s.countsByReason.reduce((n, c) => n + c.count, 0) + s.omittedReasonOccurrences + s.unclassifiedOccurrences,
    s.total, 'Σ invariant (§12.4)');
  assert.deepEqual(unitTaints.map((t) => t.reason), ['diagnostic-reason-overflow']);
});

test('only BENIGN omissions add no overflow taint', async () => {
  const a = agg({ maxDistinctReasons: 1 });
  const { unitTaints } = await a.addUnit('1.0', outcomeWith(many(200, 'witness-unavailable')));
  assert.deepEqual(unitTaints, []);
  assert.equal(a.snapshot().completenessAffectingCount, 0);
});

test('the retained key set is identical for shuffled diagnostic order', async () => {
  const keys = async (ds) => { const a = agg({ maxDistinctReasons: 4 }); await a.addUnit('1.0', outcomeWith(ds)); return a.snapshot().countsByReason.map((c) => `${c.scope}|${c.reason}`); };
  const base = ['e', 'b', 'a', 'd', 'c', 'f'].map((r) => projected(`reason-${r}`, { modelKey: 'mk-a', dbId: 1, fragId: 1 }));
  assert.deepEqual(await keys(base), await keys([...base].reverse()));
});

test('the retained-diagnostic cap truncates detail in canonical order but never a total', async () => {
  const a = agg({ maxRetainedDiagnostics: 10 });
  await a.addUnit('1.0', outcomeWith(many(50, 'inconclusive-crossing')));
  const s = a.snapshot();
  assert.equal(s.diagnostics.length, 10);
  assert.equal(s.truncated, true);
  assert.equal(s.total, 50);
  assert.deepEqual(s.diagnostics.map((x) => x.fragment.dbId), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test('geometryReadinessOccurrences is an exact independent counter', async () => {
  const a = agg({ maxDistinctReasons: 1 });
  await a.addUnit('1.0', outcomeWith([...many(7, 'geometry-not-yet-available'), ...many(3, 'non-manifold-component', 100)]));
  assert.equal(a.snapshot().geometryReadinessOccurrences, 7, 'independent of countsByReason retention');
});

test('library statistics aggregate as sums plus libraryMsTotal and maxUnitMs (§12.6)', () => {
  const acc = createStatisticsAccumulator();
  acc.add({ broadPhasePairs: 3, totalMs: 10 }, 12);   // (statistics, unit durationMs)
  acc.add({ broadPhasePairs: 4, totalMs: 20 }, 30);
  const s = acc.snapshot();
  assert.equal(s.broadPhasePairs, 7);
  assert.equal(s.libraryMsTotal, 30, 'Σ of the library\'s own in-call totalMs, not of unit durations');
  assert.equal(s.maxUnitMs, 30, 'max unit durationMs');
});

// 2026-10-07 (owner-authorized): the library's informational whole-model-target `fragment-null-geometry`, projected
// through the real projectDiagnostic, is carried (retained + counted by reason) but never completeness-affecting.
test('fragment-null-geometry is carried in the aggregate but excluded from the completeness-affecting counters', async () => {
  const { projectDiagnostic, createUnitBindingTable } = await import('../../../clashtest/execution/diagnostics.js');
  const table = createUnitBindingTable([{ modelKey: 'mk-arch', modelId: 7 }]);
  const raw = (reason, fragId) => ({ scope: 'fragment', reason, role: 'target', fragment: { modelId: 7, dbId: null, fragId } });
  const p1 = projectDiagnostic(raw('fragment-null-geometry', 4600), table);
  const p2 = projectDiagnostic(raw('fragment-null-geometry', 4601), table);
  assert.equal(p1.ok, true);
  assert.equal(p1.diagnostic.completenessAffecting, false);
  assert.equal(p1.diagnostic.attribution, 'target-model');
  const a = agg();
  await a.addUnit('u1', outcomeWith([p1.diagnostic, p2.diagnostic]));
  const snap = a.snapshot();
  assert.equal(snap.total, 2);
  assert.equal(snap.completenessAffectingCount, 0);
  assert.equal(snap.completenessAffectingUpperBound, 0);
  assert.deepEqual(snap.countsByReason, [{ scope: 'fragment', reason: 'fragment-null-geometry', count: 2 }]);
  assert.equal(snap.diagnostics.length, 2);
  // The ordinary fragment-not-loaded still counts.
  const b = agg();
  await b.addUnit('u1', outcomeWith([projectDiagnostic(raw('fragment-not-loaded', 9), table).diagnostic]));
  assert.equal(b.snapshot().completenessAffectingUpperBound, 1);
});
