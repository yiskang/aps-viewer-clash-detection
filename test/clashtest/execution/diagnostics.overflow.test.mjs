// test/clashtest/execution/diagnostics.overflow.test.mjs
//
// P4.3: §7.1 H7's rejection/overflow split, enforced *while projecting*, so an oversized array
// never crosses the port — plus the closed numeric statistics schema (§12.6).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectDiagnostics, projectStatistics, createUnitBindingTable } from '../../../clashtest/execution/diagnostics.js';
import { createSlicer } from '../../../clashtest/util/slicer.js';

const table = createUnitBindingTable([{ modelKey: 'mk-a', modelId: 1 }]);
const slicer = () => createSlicer({ now: () => 0, yieldToScheduler: async () => {}, sliceBudgetMs: 4 });
const frag = (reason, fragId) => ({ scope: 'fragment', reason, role: 'target', fragment: { modelId: 1, dbId: fragId, fragId } });
const project = (raw, maxDiagnosticsPerOutcome, s = slicer()) =>
  projectDiagnostics(raw, { table, limits: { maxDiagnosticsPerOutcome }, slicer: s });

test('an oversized array is NOT iterated; only its length crosses the port', async () => {
  let reads = 0;
  const spied = new Proxy(new Array(300_000).fill(null).map((_, i) => frag('geometry-not-yet-available', i)), {
    get(t, p, r) { if (typeof p === 'string' && /^\d+$/.test(p)) reads++; return Reflect.get(t, p, r); },
  });
  const out = await project(spied, 20_000);
  assert.equal(out.ok, true);
  assert.deepEqual(out.diagnostics, []);
  assert.equal(out.diagnosticOverflowLength, 300_000);
  assert.equal(reads, 0, 'the executor must not read a single element of an over-cap array');
});

test('an at-cap array is projected in full with no marker', async () => {
  const out = await project(new Array(1_000).fill(null).map((_, i) => frag('inconclusive-crossing', i)), 1_000);
  assert.equal(out.diagnostics.length, 1_000);
  assert.equal('diagnosticOverflowLength' in out, false);
});

test('100,000 distinct legal reasons are all projected — many and varied is never a rejection', async () => {
  const out = await project(new Array(100_000).fill(null).map((_, i) => frag(`r${String(i).padStart(6, '0')}`, i)), 200_000);
  assert.equal(out.diagnostics.length, 100_000);
  assert.equal(new Set(out.diagnostics.map((d) => d.reason)).size, 100_000);
});

test('one illegal diagnostic rejects the WHOLE array', async () => {
  const out = await project([frag('inconclusive-crossing', 1), frag('z'.repeat(129), 2)], 10);
  assert.equal(out.ok, false);
  assert.equal(out.issue.code, 'diagnostic-reason-too-long');
});

test('a non-array diagnostics value is rejected', async () => {
  for (const raw of [undefined, null, {}, 'x', new Set()]) assert.equal((await project(raw, 10)).ok, false);
});

test('projection yields to the scheduler when the slice budget is spent', async () => {
  let t = 0; let yields = 0;
  // `checkEvery: 1` — P0's slicer only consults the clock every `checkEvery` ticks (default 64), so a
  // 50-item pass would never be due at the default.
  const s = createSlicer({ now: () => (t += 1), yieldToScheduler: async () => { yields++; }, sliceBudgetMs: 4, checkEvery: 1 });
  await project(new Array(50).fill(null).map((_, i) => frag('non-manifold-component', i)), 100, s);
  assert.ok(yields > 0, 'a long projection pass must not be one synchronous span');
});

test('statistics: the closed numeric schema', () => {
  assert.equal(projectStatistics({ broadPhasePairs: 1, narrowPhasePairs: 2, totalMs: 3 }).ok, true);
  assert.equal(projectStatistics({ broadPhasePairs: 1, somethingNew: 2 }).ok, false);
  assert.equal(projectStatistics({ broadPhasePairs: Infinity }).ok, false);
  assert.equal(projectStatistics({ broadPhasePairs: '1' }).ok, false);
  assert.equal(projectStatistics({ diagnostics: [] }).ok, false, 'diagnostics is not a statistic');
  const negZero = projectStatistics({ broadPhaseMs: -0 });
  assert.ok(Object.is(negZero.statistics.broadPhaseMs, 0), '-0 normalizes to 0');
});
