// node offline-pre-vs-post-d.mjs <repoRoot>   -- offline end-to-end Option D equivalence probe (real engine + real CollisionWorld +
// production Viewer enumerator, 12-fragment same-model fixture, render proxies of fragIds 1,4,6 unavailable so the library
// emits diagnostics). Prints, per scenario (completed / cancel before the 4th unit), hashes of the sealed Result Set
// (durationMs and the random runId / registrySessionId stripped), of resultSet.diagnostics, and of the committed progress (caveatCount, caveatUnclassified,
// unitsEvaluated) observed before every unit. Run once against a scratch tree holding HEAD dcdab38 Run.js + diagnostics.js
// (pre-D) and once against the working tree (post-D); see offline-pre-vs-post-d.txt.
import { createHash } from 'node:crypto';
const root = process.argv[2];
const { createFakeClock } = await import(`${root}/test/clashtest/support/fakeClock.mjs`);
const { createLocalUnitExecutor } = await import(`${root}/clashtest/execution/LocalUnitExecutor.js`);
const { createClashTestEngine } = await import(`${root}/clashtest/index.js`);
const { createViewerElementEnumerator } = await import(`${root}/clashtest/viewer/ViewerElementEnumerator.js`);
const { getWorldCoordinator } = await import(`${root}/clashtest/run/coordinator.js`);
const { makeRealWorldFixture } = await import(`${root}/test/clashtest/support/realWorld.mjs`);
const N = 12;
const SELF_MODEL = { tree: [{ dbId: 1, children: Array.from({ length: N }, (_, i) => ({ dbId: 100 + i, fragments: [i] })) }],
  positions: Object.fromEntries(Array.from({ length: N }, (_, i) => [i, [i < 8 ? i * 0.5 : 10 * i, 0, 0]])) };
const NO_PROXY = new Set([1, 4, 6]);
const DEF = { schemaVersion: 1, testId: 'self', revision: 1, name: 'self', mode: 'volume-overlap',
  selectionA: { entries: [{ kind: 'model', modelKey: 'a' }] }, selectionB: { entries: [{ kind: 'model', modelKey: 'a' }] } };
for (const cancelAt of [null, 3]) {
  const fx = await makeRealWorldFixture({ models: { a: SELF_MODEL }, renderProxy: (_m, f) => !NO_PROXY.has(f) });
  const clock = createFakeClock({ start: Date.UTC(2026, 9, 7) });
  const enumerator = createViewerElementEnumerator();
  const execute = createLocalUnitExecutor({ world: fx.world, registry: getWorldCoordinator(fx.world).registry, enumerator, now: clock.now, yieldToScheduler: clock.yieldToScheduler, sliceBudgetMs: 4 });
  let handle; let n = 0; const prog = [];
  const unitExecutor = async (req) => { const s = handle.getSnapshot(); prog.push([s.caveatCount, s.caveatUnclassified, s.unitsEvaluated]); if (cancelAt !== null && n === cancelAt) handle.cancel('user'); n++; return execute(req); };
  const engine = createClashTestEngine({ world: fx.world, enumerator, unitExecutor, now: clock.now, yieldToScheduler: clock.yieldToScheduler, scheduleTimeout: () => () => {} });
  handle = engine.startRun(DEF);
  const { resultSet } = await handle.done;
  const j = JSON.stringify(resultSet, (k, v) => (k === 'durationMs' || k === 'runId' || k === 'registrySessionId' ? undefined : v));
  const h = (x) => createHash('sha256').update(x).digest('hex');

  console.log(JSON.stringify({ cancelAt, status: resultSet.outcome.status, units: resultSet.ledger.units.length, results: resultSet.results.length,
    diag: { total: resultSet.diagnostics.total, ca: resultSet.diagnostics.completenessAffectingCount, retained: resultSet.diagnostics.diagnostics.length },
    resultSetSha: h(j), diagnosticsSha: h(JSON.stringify(resultSet.diagnostics)), progressSha: h(JSON.stringify(prog)), prog: prog.map((p) => p[0]).join(',') }));
}
