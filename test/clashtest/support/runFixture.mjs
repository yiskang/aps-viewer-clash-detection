// test/clashtest/support/runFixture.mjs
//
// P6's minimal fixture: wires P0's `createFakeClock` into a `RunSpec` complete enough for
// `createRun`'s CONSTRUCTOR (not `begin()`, which Task P6.3 does not exercise). Every collaborator
// field is a `null`/no-op placeholder unless a Task-P6.3 test actually reaches it.
//
// The MUCH fuller version described by the master plan (definition-lookup racing, cancel-timing
// scripts, a shared coordinator, executor/residency recording, `reached`/`afterUnit`/`sealed`/
// `release`/`requestDispose` helpers, `realSealing`, etc.) is Task P6.4's job. That task EXTENDS
// this file — per this directory's own extension rules (support/index.mjs): never change the
// signature or default behaviour of `createRunFixture`, only add options with defaults that
// preserve today's behaviour.

import { createFakeClock } from './fakeClock.mjs';
import { createFakePlan } from './fakePlanner.mjs';

export function createRunFixture(opts = {}) {
  const clock = createFakeClock(opts.clockOptions);
  // `Object.hasOwn` (not `??`) so an explicit `plan: null` (P6.4 models failed/absent planning
  // with it) is preserved instead of being silently replaced by an empty successful plan
  // (codex-advisor review, P6.3).
  const plan = Object.hasOwn(opts, 'plan') ? opts.plan : createFakePlan([]);

  const spec = {
    runId: opts.runId ?? 'run-1',
    engineId: opts.engineId ?? 'engine-1',
    coordinator: null,
    world: null,
    testIdOfInput: () => 'test-1',
    derivedFromRunId: opts.derivedFromRunId ?? null,
    resolveDefinition: () => Promise.resolve(null),
    modelKeysOf: () => [],
    planningCauseOf: () => null,
    enumerator: null,
    executor: null,
    validateUnitOutcome: null,
    internalErrorOutcome: null,
    diagnosticAggregator: null,
    statisticsAccumulator: null,
    deriveUnitTaints: null,
    plannerPort: null,
    resultPort: null,
    runOptions: { progressMinIntervalMs: 100, ...opts.runOptions },
    limits: {},
    provenanceBase: {},
    now: clock.now,
    yieldToScheduler: async () => {},
    scheduleTimeout: () => () => {},
    ...opts.specOverrides,
  };

  // `plan` is exposed but not yet wired into `spec` — Task P6.3's own run construction never
  // touches planning, and pre-planning progress state (pairSpaceTotal etc.) is 0 by contract until
  // a later task's planning stage commits it. Task P6.4 is expected to wire this fixture's `plan`
  // through `spec.plannerPort`/`resolveDefinition` once that stage exists.
  return { spec, clock, plan };
}
