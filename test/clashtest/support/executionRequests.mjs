// test/clashtest/support/executionRequests.mjs
//
// P4 File structure row: `makeRequest(over)` builds a valid `ExecutionRequest` (spec §7.1) over a
// two-model fixture (source `mk-a`, target `mk-b`), where the shorthand keys `sourceDbIds` /
// `targets` / `scopeExpect` merge into `materialized`; `makeExecutorDeps(over)` wires P1's real
// `createModelRegistry({world})` over `executionWorld.mjs`'s composed world and P0's
// `createFakeEnumerator` / `createFakeClock`. Both compose ONLY shipped P0/P1 support APIs verbatim
// (Gates and open items, "Implementation-level items deliberately left to implementers" #4) -- no
// new knobs are invented on `createExecutionWorld`, `createFakeWorld`, `createFakeEnumerator`,
// `createFakeClock` or `createModelRegistry` themselves.
//
// `scopeExpect`'s digests are DECOUPLED from `sourceDbIds` / `targets`: the pre/post bracket
// (`checkScopeBracket`, clashtest/planning/scopeDigest.js) reads ONLY `request.materialized.scopeExpect`
// and re-digests it through the enumerator -- it never looks at `sourceDbIds` / `targets`, which only
// shape the `findClashes` QUERY. So the default two-model enumerator fixture below (dbIds 10, 11 for
// `mk-a`; dbId 20 for `mk-b`) and the default `scopeExpect` are matched to each other, independently
// of whatever dbIds a caller's `sourceDbIds` / `targets` override names for the actual call -- exactly
// the shape of Task P4.5's own worked `ExecutionRequest` example and Task P4.7's real-world
// capacity-ceiling test (`sourceDbIds: [1]`, default untouched `scopeExpect`, still `scopeProof: 'equal'`).
import { createExecutionWorld } from './executionWorld.mjs';
import { createFakeModel } from './fakeWorld.mjs';
import { createFakeEnumerator } from './fakeEnumerator.mjs';
import { createFakeClock } from './fakeClock.mjs';
import { createModelRegistry } from '../../../clashtest/identity/ModelRegistry.js';

// Every DEFAULT_* below is a FACTORY, not a shared literal: `makeRequest` is shared test-support
// code called from many independent tests, and a plain shared array/object (even one `Object.freeze`
// only shallow-froze) would let one test's `request.materialized.targets[0].dbIds.push(...)` or
// `request.unit.sourceRanges.push(...)` corrupt every other test's "default" request (codex-review
// finding, 2026-09-22). Each factory returns a fresh, independently mutable tree on every call.
const defaultUnit = () => ({
  unitId: '1.0', cell: '1', sourceModelKey: 'mk-a', sourceRanges: [], targets: [], orientationRole: 'A->B', pairSpaceWeight: 4,
});

const defaultSourceDbIds = () => [10, 11];
const defaultTargets = () => [{ modelKey: 'mk-b', scope: 'roots', dbIds: [20] }];
const defaultScopeExpect = () => [
  { modelKey: 'mk-a', role: 'source', scope: 'roots', roots: [{ dbId: 10, subtreeDigest: 'sha256:a' }, { dbId: 11, subtreeDigest: 'sha256:b' }] },
  { modelKey: 'mk-b', role: 'target', scope: 'roots', roots: [{ dbId: 20, subtreeDigest: 'sha256:c' }] },
];

// `bindingGeneration: 1`, NOT 0: P1's `createModelRegistry` assigns `bindingGeneration: 1` to a
// key's FIRST registration ("any revival of a known key is a new binding generation"), so a run
// snapshot taken over `makeExecutorDeps`' registry necessarily reads 1. The previous default of 0
// meant the request's run-start generations disagreed with the registry's real ones in every single
// test, and nothing noticed — the executor never compared them. It does now (the §16.1
// "never re-binds mid-run" guard), so the fixture has to state the truth (internal holistic review,
// 2026-09-22).
const gen = (modelKey, bindingGeneration = 1, placementGeneration = 0) => ({ modelKey, bindingGeneration, placementGeneration });
const defaultSnapshot = () => [
  { ...gen('mk-a'), modelVersion: 'v1' },
  { ...gen('mk-b'), modelVersion: 'v1' },
];

// Task P4.5's own worked ExecutionRequest example (docs/superpowers/plans/federated-clash-test-core/
// p4-executor-diagnostics.md, ~line 780) hardcodes exactly these three numbers, and other P4 tasks'
// tests (e.g. the maxPairsPerOutcome overflow test) are written assuming this exact default -- this
// is a deliberately small test-fixture cap, not `clashtest/options.js`'s `RUN_OPTION_DEFAULTS`
// (100,000+/200,000), which would make overflow tests slow and unwieldy to construct.
const defaultLimits = () => ({ maxPairsPerOutcome: 1_000, maxDiagnosticsPerOutcome: 2_000, maxDistinctReasons: 64 });

// The default fake enumerator content, matched byte-for-byte with defaultScopeExpect() above so the
// default request's pre/post scope bracket reaches `proof: 'equal'` out of the box.
const DEFAULT_ENUMERATOR_MODELS = Object.freeze({
  'mk-a': {
    roots: [
      { dbId: 10, fragmentCount: 1, ownerDbIds: [10], subtreeDigest: 'sha256:a' },
      { dbId: 11, fragmentCount: 1, ownerDbIds: [11], subtreeDigest: 'sha256:b' },
    ],
  },
  'mk-b': {
    roots: [{ dbId: 20, fragmentCount: 1, ownerDbIds: [20], subtreeDigest: 'sha256:c' }],
  },
});

const DEFAULT_MODEL_VERSION = 'v1';

/**
 * A valid `ExecutionRequest` (spec §7.1) over the two-model fixture (source `mk-a`, target `mk-b`).
 * The shorthand keys `sourceDbIds` / `targets` / `scopeExpect` merge into `materialized`; any other
 * key (`mode`, `clearance`, `broadPhase`, `runId`, `attempt`, `snapshot`, `limits`, `unit`,
 * `materialized`) overrides the corresponding top-level field directly.
 * @param {object} [over]
 * @returns {object} ExecutionRequest
 */
export function makeRequest(over = {}) {
  const { sourceDbIds, targets, scopeExpect, unit, materialized, ...rest } = over;

  const materializedBase = { sourceDbIds: defaultSourceDbIds(), targets: defaultTargets(), scopeExpect: defaultScopeExpect(), ...materialized };
  if (sourceDbIds !== undefined) materializedBase.sourceDbIds = sourceDbIds;
  if (targets !== undefined) materializedBase.targets = targets;
  if (scopeExpect !== undefined) materializedBase.scopeExpect = scopeExpect;

  return {
    unit: { ...defaultUnit(), ...unit },
    materialized: materializedBase,
    runId: 'run-1',
    attempt: 0,
    mode: 'volume-overlap',
    broadPhase: 'tlas',
    snapshot: defaultSnapshot(),
    limits: defaultLimits(),
    ...rest,
  };
}

/**
 * `{world, registry, enumerator, models, now, yieldToScheduler, sliceBudgetMs}` for
 * `createLocalUnitExecutor` (`models` = `modelKey -> model`). Defaults to the same two-model
 * fixture as `makeRequest`'s default (`mk-a`, `mk-b`), built over `executionWorld.mjs`'s composed
 * fake world, P1's real `createModelRegistry({world})` and P0's `createFakeEnumerator` /
 * `createFakeClock`. `over.world` / `over.models` inject a real `CollisionWorld` and real models
 * (the T2 tests reuse this same builder); `over.registry` / `over.enumerator` / `over.now` /
 * `over.yieldToScheduler` / `over.sliceBudgetMs` override the corresponding piece directly.
 * @param {object} [over]
 * @returns {{world: object, registry: object, enumerator: object, models: Record<string, object>,
 *   now: Function, yieldToScheduler: Function, sliceBudgetMs: number}}
 */
export function makeExecutorDeps(over = {}) {
  const world = over.world ?? createExecutionWorld();
  const models = over.models ?? { 'mk-a': createFakeModel('mk-a'), 'mk-b': createFakeModel('mk-b') };

  // `== null` (not `=== undefined`) so `{registry: null}` and an omitted `registry` behave
  // identically on BOTH branches -- a mismatched pair here (codex-review finding, 2026-09-22) would
  // build a registry over the composed world but skip registering the fixture models into it,
  // leaving every `bindingFor` call reporting the model as evicted.
  const registry = over.registry ?? createModelRegistry({ world });
  if (over.registry == null) {
    for (const [modelKey, model] of Object.entries(models)) {
      registry.register(modelKey, model, { modelVersion: DEFAULT_MODEL_VERSION });
    }
  }

  const enumerator = over.enumerator ?? createFakeEnumerator({ models: DEFAULT_ENUMERATOR_MODELS });

  const clock = createFakeClock({ start: 0 });
  const now = over.now ?? clock.now;
  const yieldToScheduler = over.yieldToScheduler ?? clock.yieldToScheduler;
  const sliceBudgetMs = over.sliceBudgetMs ?? 8;

  return { world, registry, enumerator, models, now, yieldToScheduler, sliceBudgetMs };
}
