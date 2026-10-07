// test/clashtest/execution/diagnosticCounters.e2e.test.mjs
//
// Option D end to end (owner-authorized 2026-10-07): real engine + real `CollisionWorld` + PRODUCTION
// Viewer enumerator (`createViewerElementEnumerator`), a same-model (cell 3b) run — the shape of the
// Architecture self-clash — whose units really produce library diagnostics (fragments whose render
// proxy is unavailable → `geometry-not-yet-available`, completeness-affecting).
//
// The reference is the pre-D read, replayed independently: every outcome the production executor
// returned is fed, in settlement order, into a fresh aggregator that takes a FULL `snapshot()` after
// every unit (exactly what Run.js did before Option D). Pinned:
//   - before each unit starts, the engine's committed progress (`caveatCount`, `caveatUnclassified`)
//     equals the reference's per-unit snapshot after the units settled so far;
//   - the sealed `resultSet.diagnostics` is deep- and byte-identical to the reference's final snapshot;
//   - the same for a run stopped (cancelled) mid-way: the partial set carries the full final snapshot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeClock } from '../support/fakeClock.mjs';
import { createLocalUnitExecutor } from '../../../clashtest/execution/LocalUnitExecutor.js';
import { createDiagnosticAggregator } from '../../../clashtest/execution/diagnostics.js';
import { RUN_OPTION_DEFAULTS } from '../../../clashtest/options.js';
import { createSlicer } from '../../../clashtest/util/slicer.js';
import { createClashTestEngine } from '../../../clashtest/index.js';
import { createViewerElementEnumerator } from '../../../clashtest/viewer/ViewerElementEnumerator.js';
import { getWorldCoordinator } from '../../../clashtest/run/coordinator.js';
import { makeRealWorldFixture } from '../support/realWorld.mjs';

const N = 12;
const SELF_MODEL = {
  tree: [{ dbId: 1, children: Array.from({ length: N }, (_, i) => ({ dbId: 100 + i, fragments: [i] })) }],
  positions: Object.fromEntries(Array.from({ length: N }, (_, i) => [i, [i < 8 ? i * 0.5 : 10 * i, 0, 0]])),
};
const NO_PROXY = new Set([1, 4, 6]);                       // these fragments' render proxies are unavailable
const SELF_DEFINITION = {
  schemaVersion: 1, testId: 'self', revision: 1, name: 'self', mode: 'volume-overlap',
  selectionA: { entries: [{ kind: 'model', modelKey: 'a' }] },
  selectionB: { entries: [{ kind: 'model', modelKey: 'a' }] },
};

async function run({ cancelAtUnit = null } = {}) {
  const fx = await makeRealWorldFixture({ models: { a: SELF_MODEL }, renderProxy: (_m, fragId) => !NO_PROXY.has(fragId) });
  const clock = createFakeClock({ start: Date.UTC(2026, 9, 7) });
  const enumerator = createViewerElementEnumerator();
  const execute = createLocalUnitExecutor({
    world: fx.world, registry: getWorldCoordinator(fx.world).registry, enumerator,
    now: clock.now, yieldToScheduler: clock.yieldToScheduler, sliceBudgetMs: 4,
  });
  const settled = [];          // outcomes in settlement order
  const beforeUnit = [];       // committed progress observed as each unit starts
  let handle = null;
  const unitExecutor = async (request) => {
    const s = handle.getSnapshot();
    beforeUnit.push({ settledSoFar: settled.length, caveatCount: s.caveatCount, caveatUnclassified: s.caveatUnclassified });
    if (cancelAtUnit !== null && settled.length === cancelAtUnit) handle.cancel('user');
    const outcome = await execute(request);
    settled.push({ unitId: request.unit.unitId, outcome });
    return outcome;
  };
  const engine = createClashTestEngine({
    world: fx.world, enumerator, unitExecutor, now: clock.now,
    yieldToScheduler: clock.yieldToScheduler, scheduleTimeout: () => () => {},
  });
  handle = engine.startRun(SELF_DEFINITION);
  const { resultSet } = await handle.done;
  return { resultSet, settled, beforeUnit, final: handle.getSnapshot() };
}

/** Pre-D reference: full snapshot() after every merged unit. */
function replay(settled, resultSet) {
  const evaluated = new Set(resultSet.ledger.units.filter((u) => u.outcome === 'evaluated').map((u) => u.unitId));
  const ref = createDiagnosticAggregator({
    maxRetainedDiagnostics: RUN_OPTION_DEFAULTS.maxRetainedDiagnostics,
    maxDistinctReasons: RUN_OPTION_DEFAULTS.maxDistinctReasons,
    maxUnitIdsPerDiagnostic: RUN_OPTION_DEFAULTS.maxUnitIdsPerDiagnostic,
    slicer: createSlicer({ now: () => 0, yieldToScheduler: async () => {} }),
  });
  const after = [{ caveatCount: 0, caveatUnclassified: 0 }];
  return (async () => {
    for (const { unitId, outcome } of settled) {
      if (evaluated.has(unitId)) await ref.addUnit(unitId, outcome);
      const s = ref.snapshot();
      after.push({ caveatCount: s.completenessAffectingCount, caveatUnclassified: s.unclassifiedOccurrences });
    }
    return { after, final: ref.snapshot() };
  })();
}

for (const [name, args] of [['completed', {}], ['stopped mid-run', { cancelAtUnit: 3 }]]) {
  test(`D e2e (${name}): per-unit caveat progress and the sealed diagnostics equal the pre-D full-snapshot reference`, async () => {
    const r = await run(args);
    const expectStatus = args.cancelAtUnit === undefined ? 'completed' : 'cancelled';
    assert.equal(r.resultSet.outcome.status, expectStatus, JSON.stringify(r.resultSet.outcome));
    assert.ok(r.settled.length > 1, `premise: several units settled (${r.settled.length})`);
    const ref = await replay(r.settled, r.resultSet);
    assert.ok(ref.final.completenessAffectingCount > 0, 'premise: the real library produced completeness-affecting diagnostics');
    for (const b of r.beforeUnit) {
      assert.deepEqual({ caveatCount: b.caveatCount, caveatUnclassified: b.caveatUnclassified }, ref.after[b.settledSoFar],
        `progress before unit #${b.settledSoFar}`);
    }
    assert.deepEqual({ caveatCount: r.final.caveatCount, caveatUnclassified: r.final.caveatUnclassified }, ref.after[r.settled.length]);
    assert.deepEqual(r.resultSet.diagnostics, ref.final, 'sealed diagnostics == reference final snapshot');
    assert.equal(JSON.stringify(r.resultSet.diagnostics), JSON.stringify(ref.final), 'byte-identical');
  });
}
