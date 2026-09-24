// test/clashtest/support/realWorld.mjs
//
// P7 (Task P7.8): the real-`CollisionWorld` fixture of the differential suite. A federation of mock
// Viewer models (`buildMockModel`) sharing ONE viewer, a real world built over it, the models
// registered on the world coordinator's own registry (the only registry the engine accepts, §4.3),
// and a faithful `ElementEnumerator` derived from the SAME tree definition the mock models were built
// from -- translated into a `makeSyntheticEnumerator` model spec, so there is no third enumerator
// implementation and no Viewer (gate G-OQ4 stays out of the way, master §4).
//
// Deliberately distinct from P4's `realWorldFixture.mjs` (a two-model executor fixture; duplicate-
// ownership D1-D4): this one is N models, map-form input, async, and owns the engine-facing façade.
// The multi-model viewer plumbing mirrors `test/CollisionWorld.findClashes.crossModel.test.mjs`'s
// `makeTwoModelFixture` (one shared `viewer.impl.getRenderProxy` dispatching by model identity).
//
// EXTENSION (Task P7.8 Step 11, P7.8b): later options are added to `makeRealWorldFixture`'s option
// bag with behaviour-preserving defaults (support-barrel extension rule 1); the per-model build below
// is one function (`buildPart`) and the render-proxy lookup one closure, which is where those seams
// attach. Nothing here reaches a `_`-prefixed member of `CollisionWorld` (§19.1).
import { CollisionWorld } from '../../../collision/index.js';
import { buildMockModel } from '../../fixtures/mockInstanceTree.mjs';
import { THREE } from '../../fixtures/geometry.mjs';
import { makeSyntheticEnumerator } from './syntheticModels.mjs';
import { getWorldCoordinator } from '../../../clashtest/run/coordinator.js';

const asc = (x, y) => x - y;
const byCodeUnit = (x, y) => (x < y ? -1 : x > y ? 1 : 0);

function boundsOf(geometry, [x, y, z]) {
  const g = geometry.clone().applyMatrix4(new THREE.Matrix4().makeTranslation(x, y, z));
  g.computeBoundingBox();
  return { min: g.boundingBox.min.toArray(), max: g.boundingBox.max.toArray() };
}

/**
 * One model of the federation. Every owner dbId is a ROOT with one fragment per listed position; the
 * fragIds are consecutive from 0 in ascending (dbId, position) order, so `buildMockModel`'s default
 * `fragmentCount` covers exactly the fragments the tree claims (an unclaimed in-range fragId would be
 * a `fragment-owner-unresolvable` diagnostic and caveat the run). Each fragment has its OWN
 * `geometryIndex` (= its fragId): the library's geometry registry is keyed by (loadEpoch,
 * geometryIndex), so a shared index would let one fragment's entry stand in for another's.
 */
function buildPart(modelKey, ownerSpec, id, boxSize) {
  const rootNodes = [];
  const fragmentGeometry = new Map();
  const rawGeometryByFragId = new Map();
  const syntheticRoots = [];
  let nextFragId = 0;
  for (const dbId of Object.keys(ownerSpec).map(Number).sort(asc)) {
    const fragments = [];
    for (const position of ownerSpec[dbId]) {
      const fragId = nextFragId++;
      const geometry = new THREE.BoxGeometry(boxSize, boxSize, boxSize);
      fragmentGeometry.set(fragId, {
        geometryIndex: fragId,
        matrix: new THREE.Matrix4().makeTranslation(...position).toArray(),
        bounds: boundsOf(geometry, position),
      });
      rawGeometryByFragId.set(fragId, geometry);
      fragments.push(fragId);
    }
    rootNodes.push({ dbId, fragments });
    syntheticRoots.push({ dbId, owners: [dbId],
      fragments: fragments.map((fragId) => ({ fragId, ownerDbId: dbId, geometryId: fragId })) });
  }
  const { model: baseModel } = buildMockModel(rootNodes, fragmentGeometry);
  const model = { ...baseModel, id, getUnitScale: () => 1 };
  return { modelKey, model, rawGeometryByFragId, syntheticSpec: { modelKey, roots: syntheticRoots } };
}

/**
 * @param {object} args
 * @param {Record<string, Record<number, Array<[number, number, number]>>>} args.models
 *   modelKey -> owner dbId -> the positions of that owner's fragments (one `boxSize` cube each)
 * @param {number} [args.boxSize=1]
 * @returns {Promise<{world, viewer, models: Map<string, object>, modelFor: (key: string) => object,
 *   enumerator: object, registry: object}>}
 */
export async function makeRealWorldFixture({ models, boxSize = 1 } = {}) {
  if (models === null || typeof models !== 'object') throw new TypeError('makeRealWorldFixture: `models` is required');
  const keys = Object.keys(models).sort(byCodeUnit);
  const parts = keys.map((modelKey, i) => buildPart(modelKey, models[modelKey], i + 1, boxSize));
  const partByModel = new Map(parts.map((p) => [p.model, p]));

  // ONE shared viewer: CollisionWorld holds exactly one `_viewer`, so it serves every model's render
  // proxies, dispatching by model IDENTITY.
  const viewer = {
    impl: {
      getRenderProxy(queriedModel, fragId) {
        const part = partByModel.get(queriedModel);
        if (!part) throw new Error('getRenderProxy called with a Model object no fixture model produced');
        const geometry = part.rawGeometryByFragId.get(fragId);
        return geometry ? { geometry } : null;
      },
    },
  };
  // `now: () => 0` is the library's documented test seam: a frozen clock, so the library's own
  // checkpoint port never yields (no timing enters the arms).
  const world = await CollisionWorld.fromViewer(viewer, { now: () => 0 });
  const { registry } = getWorldCoordinator(world);
  const modelMap = new Map(parts.map((p) => [p.modelKey, p.model]));
  for (const { modelKey, model } of parts) registry.register(modelKey, model, { modelVersion: 'v1' });
  const { enumerator } = makeSyntheticEnumerator(parts.map((p) => p.syntheticSpec));

  const modelFor = (modelKey) => {
    const model = modelMap.get(modelKey);
    if (!model) throw new Error(`makeRealWorldFixture: unknown modelKey ${modelKey}`);
    return model;
  };
  return { world, viewer, models: modelMap, modelFor, enumerator, registry };
}

/**
 * The one recording seam (Task P7.8 Step 8): an OWN-PROPERTY override of `world.findClashes` on the
 * instance that awaits the real prototype method and records `{query, pairs, statistics}` per call
 * (`error` instead, when the call rejects). Never a substitute world: `getWorldCoordinator(world)` and
 * `assertRegistryBelongsToWorld` key on world identity, so the engine must still see the genuine
 * `CollisionWorld`. A call is recorded when it STARTS (so "no call after X" counts attempts, not
 * completions). `restore()` deletes the override.
 * @returns {{calls: object[], readonly inFlight: number, readonly peakInFlight: number, restore: () => void}}
 */
export function recordFindClashes(world) {
  if (Object.hasOwn(world, 'findClashes')) throw new Error('recordFindClashes: world.findClashes is already overridden');
  const real = Object.getPrototypeOf(world).findClashes;
  const calls = [];
  let inFlight = 0;
  let peakInFlight = 0;
  Object.defineProperty(world, 'findClashes', {
    configurable: true, writable: true, enumerable: false,
    value: async function recordedFindClashes(query) {
      const entry = { query, pairs: null, statistics: null, error: null };
      calls.push(entry);
      inFlight += 1;
      peakInFlight = Math.max(peakInFlight, inFlight);
      try {
        const result = await real.call(world, query);
        entry.pairs = result.pairs;
        entry.statistics = result.statistics;
        return result;
      } catch (error) {
        entry.error = error;
        throw error;
      } finally {
        inFlight -= 1;
      }
    },
  });
  return {
    calls,
    get inFlight() { return inFlight; },
    get peakInFlight() { return peakInFlight; },
    restore() { delete world.findClashes; },
  };
}
