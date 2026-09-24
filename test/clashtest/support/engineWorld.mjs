// test/clashtest/support/engineWorld.mjs
//
// P7 (Task P7.2, controller ruling R-P7-2): the engine's unit-test world. It is what a P7 T1 test
// needs to drive a COMPLETED, CLEAN run through the real P0-P6 stack, which none of the earlier
// doubles can do on its own:
//   - `createExecutionWorld()` has no `getEpochCollisionInstanceCount`, so planning would throw and
//     the run would seal `failed:internal-error` (Run.js reads it once per bound model);
//   - a bare registry has no models, so the run-start snapshot reads `null` => `model-not-bound`;
//   - `createFakeEnumerator()` knows no model, so enumeration throws "unknown model".
// This file only COMPOSES existing doubles (P0 extension rule 2): `createExecutionWorld` for the
// world, `makeSyntheticEnumerator` for the enumerator (no third enumerator implementation), and the
// world coordinator's own registry for the model bindings (the one registry the engine accepts).
//
// EXECUTOR. `config()` injects P6's scripted executor (every unit evaluates clean) as `unitExecutor`
// rather than the engine's default `createLocalUnitExecutor`. Reason (Task P7.2 finding, reported to
// the controller): the REAL planner's work units carry a non-durable `targetWeight` (sizing.js), the
// real run hands them to the executor unfiltered (Run.js `request.unit`), and P4's closed unit schema
// rejects it (`request-unit-unknown-key:unit.targetWeight`), so through the real stack every unit fails
// `internal-error`. Engine T1 tests are about the ENGINE's wiring, so they use a deterministic
// executor; a test that wants the real one passes `unitExecutor: undefined` (and will see that
// defect until it is fixed in the owning phase).
import { createExecutionWorld } from './executionWorld.mjs';
import { makeSyntheticEnumerator } from './syntheticModels.mjs';
import { makeDefinition } from './definitions.mjs';
import { createScriptedExecutor } from './scriptedExecutor.mjs';
import { getWorldCoordinator } from '../../../clashtest/run/coordinator.js';
import { captureAndValidate } from '../../../clashtest/definition/validate.js';
import { prepareDefinition } from '../../../clashtest/definition/normalize.js';

const frag = (fragId, ownerDbId, geometryId = 1) => ({ fragId, ownerDbId, geometryId });

/** Two flat models matching `makeDefinition()`'s default selections (mA elements 1/2, all of mB). */
export function defaultEngineModelSpecs() {
  return [
    { modelKey: 'mA', roots: [
      { dbId: 1, owners: [1], fragments: [frag(0, 1)] },
      { dbId: 2, owners: [2], fragments: [frag(1, 2)] },
    ] },
    { modelKey: 'mB', roots: [{ dbId: 10, owners: [10], fragments: [frag(2, 10)] }] },
  ];
}

/**
 * A stand-in for P7.4's per-engine stored-definition resolver, for DIRECT definitions only: real P2
 * capture + `prepareDefinition`, so the run receives exactly the `{definition, testRef}` shape
 * Run.js requires (the definition is the prepared, deep-frozen value).
 */
export function createDirectResolver() {
  return {
    async resolveDefinition(source) {
      const { issues, captured } = captureAndValidate(source.value);
      if (issues.length > 0) throw new Error(`createDirectResolver: invalid definition (${issues[0].code})`);
      const { definition, semanticDigest } = await prepareDefinition(captured);
      return { definition, testRef: { testId: definition.testId, revision: definition.revision, semanticDigest } };
    },
    planningCauseOf: () => 'enumeration-failed',
  };
}

/** A resolver whose lookup never settles: the run parks in its resolution stage until cancelled. */
export function createHungResolver() {
  return {
    resolveDefinition: () => new Promise(() => {}),
    planningCauseOf: () => 'enumeration-failed',
  };
}

/**
 * @param {object} [options]
 * @param {object[]} [options.modelSpecs]  `makeSyntheticEnumerator` model specs (default: mA + mB)
 * @param {boolean} [options.register=true] register every spec'd model on the coordinator's registry
 * @param {Function} [options.defaultResult] forwarded to the fake world's `findClashes`
 * @returns {{world, enumerator, registry, coordinator, models: Map<string, object>,
 *            config: (extra?: object) => object, definition: typeof makeDefinition}}
 */
export function createEngineWorld({ modelSpecs = defaultEngineModelSpecs(), register = true, defaultResult } = {}) {
  const world = createExecutionWorld(defaultResult === undefined ? undefined : { defaultResult });
  world.getEpochCollisionInstanceCount = () => 0;          // the admission baseline; nothing else reads it
  const { enumerator } = makeSyntheticEnumerator(modelSpecs);
  const coordinator = getWorldCoordinator(world);
  const models = new Map();
  if (register) {
    for (const { modelKey } of modelSpecs) {
      const model = { fakeModel: modelKey };
      models.set(modelKey, model);
      coordinator.registry.register(modelKey, model, { modelVersion: 'v1' });
    }
  }
  return {
    world,
    enumerator,
    registry: coordinator.registry,
    coordinator,
    models,
    /** The engine config for this world; `extra` overrides or adds (`limits`, `resultStore`, ...). */
    config: (extra = {}) => ({
      world, enumerator, unitExecutor: createScriptedExecutor({}, { unscripted: { facts: [] } }), ...extra,
    }),
    definition: makeDefinition,
  };
}
