// test/clashtest/support/realWorld.mjs
//
// P7 (Task P7.8): the real-`CollisionWorld` fixture of the differential suite and of the six
// real-world integration families (Steps 11-19). A federation of mock Viewer models
// (`buildMockModel`) sharing ONE viewer, a real world built over it, the models registered on the
// world coordinator's own registry (the only registry the engine accepts, §4.3), and a faithful
// `ElementEnumerator` derived from the SAME tree definition the mock models were built from --
// translated into a `makeSyntheticEnumerator` model spec, so there is no third enumerator
// implementation and no Viewer (gate G-OQ4 stays out of the way, master §4).
//
// Deliberately distinct from P4's `realWorldFixture.mjs` (a two-model executor fixture; duplicate-
// ownership D1-D4): this one is N models, map-form input, async, and owns the engine-facing façade.
// The multi-model viewer plumbing mirrors `test/CollisionWorld.findClashes.crossModel.test.mjs`'s
// `makeTwoModelFixture` (one shared `viewer.impl.getRenderProxy` dispatching by model identity).
//
// Task P7.8 Step 11 (P7.8b-1) widened `makeRealWorldFixture` with OPTIONS whose defaults preserve
// the Steps 1-10 behaviour byte-for-byte (support-barrel extension rule 1): a tree-form model input,
// `fragments`, `renderProxy`, `worldOptions`, `register`, plus the returned `setRenderProxyAvailable`.
// Also added, for the later families: `countWorldLifecycleCalls` and `createRecordingUnitExecutor`.
// Nothing here reaches a `_`-prefixed member of `CollisionWorld` (§19.1), and nothing the engine
// does is simulated.
//
// Counted library yields (Step 11's `worldOptions` rule) need no helper of their own: pass P0's
// `createFakeClock({tickMs: frameBudgetMs})` (`collision/constants.js`) as
// `worldOptions: {now: clock.now, yieldToScheduler: clock.yieldToScheduler}`. Every `now()` read then
// advances by a whole frame budget, so every library checkpoint is due and yields -- a COUNTED,
// deterministic event (`clock.yieldCount`, `clock.onYield(fn)`) rather than a timing race. An arm that
// installs such a hook must assert it fired.
import { CollisionWorld } from '../../../collision/index.js';
import { buildMockModel } from '../../fixtures/mockInstanceTree.mjs';
import { THREE } from '../../fixtures/geometry.mjs';
import { makeSyntheticEnumerator } from './syntheticModels.mjs';
import { getWorldCoordinator } from '../../../clashtest/run/coordinator.js';
import { createLocalUnitExecutor } from '../../../clashtest/execution/LocalUnitExecutor.js';
import { ENGINE_LIMIT_DEFAULTS } from '../../../clashtest/options.js';

const asc = (x, y) => x - y;
const byCodeUnit = (x, y) => (x < y ? -1 : x > y ? 1 : 0);

/**
 * The world-space AABB of a `boxSize` cube centred at `position`. Computed arithmetically rather than
 * by transforming a cloned `BoxGeometry`: the two are bit-identical for a pure translation (each
 * vertex coordinate is `±boxSize/2` plus the offset, and three's `applyMatrix4` divides by `w = 1`),
 * and the arithmetic form keeps a 20,000-fragment fixture (Step 17a) from allocating a geometry per
 * fragment just to read its bounds.
 */
function boundsOf(boxSize, [x, y, z]) {
  const h = boxSize / 2;
  return { min: [x - h, y - h, z - h], max: [x + h, y + h, z + h] };
}

const isOwnerMapForm = (input) => !Object.hasOwn(input, 'tree');

/**
 * The map form (Steps 1-10) as a tree form: every owner dbId is a ROOT with one fragment per listed
 * position; the fragIds are consecutive from 0 in ascending (dbId, position) order, so
 * `buildMockModel`'s default `fragmentCount` covers exactly the fragments the tree claims (an
 * unclaimed in-range fragId would be a `fragment-owner-unresolvable` diagnostic and caveat the run).
 */
function treeFormOf(ownerSpec) {
  const tree = [];
  const positions = {};
  let nextFragId = 0;
  for (const dbId of Object.keys(ownerSpec).map(Number).sort(asc)) {
    const fragments = [];
    for (const position of ownerSpec[dbId]) {
      positions[nextFragId] = position;
      fragments.push(nextFragId++);
    }
    tree.push({ dbId, fragments });
  }
  return { tree, positions };
}

/**
 * The `makeSyntheticEnumerator` model spec for one mock model, derived from the SAME tree and the
 * SAME `buildMockModel` options, with the library's own rules:
 *   - roots: the top-level tree nodes whose subtree holds at least one fragment; each root's
 *     fragments are its subtree in `extractFragments`' walk order with first-discovery-wins owners
 *     (the node that enumerated it), `geometryId` = the fragment's geometryIndex (= its fragId);
 *     a nested node is recorded in `ancestorOf` (the synthetic enumerator's leaf semantics: an
 *     explicit list naming it resolves to that node's OWN fragments);
 *   - unreachable: every fragId in `0..fragmentCount-1` in no root subtree, classified exactly as the
 *     population digest does (§6.2.1): `N` if `notLoadedFragIds` has it, else `U` when its fragList
 *     owner (`ownerDbIdOverrides`, else the tree index) is not a number, else `L` with that owner;
 *   - ownerMismatchCount: reachable, loaded fragments whose numeric fragList owner differs from the
 *     tree owner (§6.2's role-specific ownership check).
 */
function syntheticSpecOf(modelKey, tree, { fragmentCount, notLoadedFragIds, ownerDbIdOverrides } = {}) {
  const notLoaded = new Set(notLoadedFragIds ?? []);
  const overrides = ownerDbIdOverrides ?? new Map();
  // The mock's own fragId -> owner index (first occurrence, pre-order: a node's fragments, then its
  // children), i.e. what `fragList.getDbIds` answers absent an override.
  const indexOwner = new Map();
  (function index(nodes) {
    for (const node of nodes) {
      for (const fragId of node.fragments ?? []) if (!indexOwner.has(fragId)) indexOwner.set(fragId, node.dbId);
      if (node.children) index(node.children);
    }
  })(tree);
  const count = fragmentCount ?? (indexOwner.size > 0 ? Math.max(...indexOwner.keys()) + 1 : 0);
  const fragListOwner = (fragId) => (overrides.has(fragId) ? overrides.get(fragId) : indexOwner.get(fragId));

  const reachable = new Set();
  const roots = [];
  const ancestorOf = {};
  let ownerMismatchCount = 0;
  for (const top of tree) {
    const fragments = [];
    const nested = [];
    const stack = [top];
    while (stack.length > 0) {
      const node = stack.pop();
      if (node !== top) nested.push(node.dbId);
      for (const fragId of node.fragments ?? []) {
        if (reachable.has(fragId)) continue;                 // first discovery wins
        reachable.add(fragId);
        fragments.push({ fragId, ownerDbId: node.dbId, geometryId: fragId });
        const listed = fragListOwner(fragId);
        if (!notLoaded.has(fragId) && Number.isSafeInteger(listed) && listed !== node.dbId) ownerMismatchCount += 1;
      }
      const children = node.children ?? [];
      for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
    }
    if (fragments.length === 0) continue;
    fragments.sort((x, y) => x.fragId - y.fragId);
    roots.push({ dbId: top.dbId, owners: [...new Set(fragments.map((f) => f.ownerDbId))].sort(asc), fragments });
    for (const d of nested) ancestorOf[d] = top.dbId;
  }

  const unreachable = [];
  for (let fragId = 0; fragId < count; fragId++) {
    if (reachable.has(fragId)) continue;
    if (notLoaded.has(fragId)) { unreachable.push({ fragId, cls: 'N' }); continue; }
    const owner = fragListOwner(fragId);
    if (!Number.isSafeInteger(owner)) { unreachable.push({ fragId, cls: 'U' }); continue; }
    unreachable.push({ fragId, cls: 'L', ownerDbId: owner, geometryId: fragId });
  }
  return { modelKey, roots: roots.sort((x, y) => x.dbId - y.dbId), unreachable, ancestorOf,
    ...(ownerMismatchCount > 0 ? { ownerMismatchCount } : {}) };
}

/**
 * One model of the federation. Each fragment with a position is a `boxSize` cube there and has its
 * OWN `geometryIndex` (= its fragId): the library's geometry registry is keyed by (loadEpoch,
 * geometryIndex), so a shared index would let one fragment's entry stand in for another's. The raw
 * `BoxGeometry` a render proxy serves is built lazily, once per fragment, on the first proxy read.
 */
function buildPart(modelKey, input, id, boxSize, fragmentOptions) {
  const { tree, positions } = isOwnerMapForm(input) ? treeFormOf(input) : input;
  const fragmentGeometry = new Map();
  for (const [fragIdKey, position] of Object.entries(positions ?? {})) {
    const fragId = Number(fragIdKey);
    fragmentGeometry.set(fragId, {
      geometryIndex: fragId,
      matrix: new THREE.Matrix4().makeTranslation(...position).toArray(),
      bounds: boundsOf(boxSize, position),
    });
  }
  const { model: baseModel } = buildMockModel(tree, fragmentGeometry, fragmentOptions);
  const model = { ...baseModel, id, getUnitScale: () => 1 };
  const rawGeometryByFragId = new Map();
  const geometryOf = (fragId) => {
    if (!fragmentGeometry.has(fragId)) return null;
    let geometry = rawGeometryByFragId.get(fragId);
    if (!geometry) {
      geometry = new THREE.BoxGeometry(boxSize, boxSize, boxSize);
      rawGeometryByFragId.set(fragId, geometry);
    }
    return geometry;
  };
  return { modelKey, model, geometryOf, syntheticSpec: syntheticSpecOf(modelKey, tree, fragmentOptions) };
}

/**
 * @param {object} args
 * @param {Record<string, Record<number, Array<[number, number, number]>> | {tree: object[],
 *   positions?: Record<number, [number, number, number]>}>} args.models
 *   modelKey -> EITHER the owner map (owner dbId -> positions of that owner's fragments, one root per
 *   owner, consecutive fragIds) OR the tree form `{tree, positions}`: `tree` is `buildMockModel`'s
 *   own `{dbId, fragments?, children?}[]` and `positions` places a `boxSize` cube per fragId (a fragId
 *   without a position has no geometry -- fine for one the library never narrow-phases).
 * @param {number} [args.boxSize=1]
 * @param {Record<string, {fragmentCount?: number, notLoadedFragIds?: Iterable<number>,
 *   ownerDbIdOverrides?: Map<number, number|number[]|undefined>, hiddenDbIds?: Iterable<number>}>}
 *   [args.fragments={}]  per-modelKey pass-through to `buildMockModel`'s documented options; the
 *   enumerator is derived under the same options (unreachable population, owner classes)
 * @param {(modelKey: string, fragId: number) => boolean} [args.renderProxy=() => true]  `false` =>
 *   the shared `getRenderProxy` returns `undefined` for that fragment, so the REAL world raises its own
 *   `RenderProxyUnavailableError` (-> `geometry-not-yet-available`)
 * @param {object} [args.worldOptions={}]  spread into `CollisionWorld.fromViewer` over the default
 *   frozen clock -- only the library's documented `now`/`yieldToScheduler` seams, injected together
 * @param {string[]} [args.register]  which modelKeys the registry binds (default: every model)
 * @returns {Promise<{world, viewer, models: Map<string, object>, modelFor: (key: string) => object,
 *   enumerator: object, registry: object,
 *   setRenderProxyAvailable: (modelKey: string, fragId: number, available: boolean) => void}>}
 */
export async function makeRealWorldFixture({
  models, boxSize = 1, fragments = {}, renderProxy = () => true, worldOptions = {}, register,
} = {}) {
  if (models === null || typeof models !== 'object') throw new TypeError('makeRealWorldFixture: `models` is required');
  const keys = Object.keys(models).sort(byCodeUnit);
  for (const key of Object.keys(fragments)) {
    if (!keys.includes(key)) throw new Error(`makeRealWorldFixture: \`fragments\` names unknown modelKey ${key}`);
  }
  const registered = register ?? keys;
  for (const key of registered) {
    if (!keys.includes(key)) throw new Error(`makeRealWorldFixture: \`register\` names unknown modelKey ${key}`);
  }
  const parts = keys.map((modelKey, i) => buildPart(modelKey, models[modelKey], i + 1, boxSize, fragments[modelKey] ?? {}));
  const partByModel = new Map(parts.map((p) => [p.model, p]));

  // The render-proxy gate: a per-fragment override set by `setRenderProxyAvailable`, else the
  // `renderProxy` option. The GATE is the fixture's; what happens when it is closed is production's.
  const proxyOverrides = new Map();
  const gateKey = (modelKey, fragId) => JSON.stringify([modelKey, fragId]);
  const proxyAvailable = (modelKey, fragId) => {
    const key = gateKey(modelKey, fragId);
    return proxyOverrides.has(key) ? proxyOverrides.get(key) : renderProxy(modelKey, fragId) !== false;
  };

  // ONE shared viewer: CollisionWorld holds exactly one `_viewer`, so it serves every model's render
  // proxies, dispatching by model IDENTITY.
  const viewer = {
    impl: {
      getRenderProxy(queriedModel, fragId) {
        const part = partByModel.get(queriedModel);
        if (!part) throw new Error('getRenderProxy called with a Model object no fixture model produced');
        if (!proxyAvailable(part.modelKey, fragId)) return undefined;
        const geometry = part.geometryOf(fragId);
        return geometry ? { geometry } : null;
      },
    },
  };
  // `now: () => 0` is the library's documented test seam: a frozen clock, so the library's own
  // checkpoint port never yields (no timing enters the arms) unless `worldOptions` replaces it.
  const world = await CollisionWorld.fromViewer(viewer, { now: () => 0, ...worldOptions });
  const { registry } = getWorldCoordinator(world);
  const modelMap = new Map(parts.map((p) => [p.modelKey, p.model]));
  for (const { modelKey, model } of parts) {
    if (registered.includes(modelKey)) registry.register(modelKey, model, { modelVersion: 'v1' });
  }
  const { enumerator } = makeSyntheticEnumerator(parts.map((p) => p.syntheticSpec));

  const modelFor = (modelKey) => {
    const model = modelMap.get(modelKey);
    if (!model) throw new Error(`makeRealWorldFixture: unknown modelKey ${modelKey}`);
    return model;
  };
  const setRenderProxyAvailable = (modelKey, fragId, available) => {
    modelFor(modelKey);
    if (typeof available !== 'boolean') throw new TypeError('setRenderProxyAvailable: `available` must be a boolean');
    proxyOverrides.set(gateKey(modelKey, fragId), available);
  };
  return { world, viewer, models: modelMap, modelFor, enumerator, registry, setRenderProxyAvailable };
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

/**
 * Counting OWN-PROPERTY overrides of the world's three lifecycle methods, each delegating to the real
 * prototype method (AC-7/AC-21: the engine calls none of them; a test's own calls are counted too, so
 * an arm compares the count with exactly its own calls). `restore()` deletes the overrides.
 * @returns {{evictModel: number, dispose: number, invalidateModelPlacement: number, restore: () => void}}
 */
export function countWorldLifecycleCalls(world) {
  const names = ['evictModel', 'dispose', 'invalidateModelPlacement'];
  const counts = { evictModel: 0, dispose: 0, invalidateModelPlacement: 0 };
  for (const name of names) {
    if (Object.hasOwn(world, name)) throw new Error(`countWorldLifecycleCalls: world.${name} is already overridden`);
    const real = Object.getPrototypeOf(world)[name];
    Object.defineProperty(world, name, {
      configurable: true, writable: true, enumerable: false,
      value(...args) { counts[name] += 1; return real.apply(world, args); },
    });
  }
  Object.defineProperty(counts, 'restore', {
    enumerable: false,
    value() { for (const name of names) delete world[name]; },
  });
  return counts;
}

/**
 * The engine's DEFAULT executor -- `createLocalUnitExecutor` over the fixture's real world, the
 * coordinator's registry and the fixture's enumerator, exactly as `createClashTestEngine` builds it --
 * wrapped to record every `(request, outcome)` it returns, for facts the sealed `UnitRecord` does not
 * carry (preflight S5: the projected `diagnostics` array, `failure.capacityDetails`). Pass the SAME
 * `now`/`yieldToScheduler` as the engine, and `unitExecutor` as the engine's `unitExecutor`. The
 * wrapper changes nothing: it awaits the real executor and returns its outcome object unchanged.
 * @returns {{unitExecutor: (request: object) => Promise<object>, outcomes: Array<{request: object, outcome: object}>}}
 */
export function createRecordingUnitExecutor(fx, { now, yieldToScheduler, sliceBudgetMs = ENGINE_LIMIT_DEFAULTS.sliceBudgetMs }) {
  const execute = createLocalUnitExecutor({
    world: fx.world, registry: getWorldCoordinator(fx.world).registry, enumerator: fx.enumerator,
    now, yieldToScheduler, sliceBudgetMs,
  });
  const outcomes = [];
  async function unitExecutor(request) {
    const outcome = await execute(request);
    outcomes.push({ request, outcome });
    return outcome;
  }
  return { unitExecutor, outcomes };
}
