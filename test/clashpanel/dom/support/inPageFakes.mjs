// test/clashpanel/dom/support/inPageFakes.mjs
//
// BROWSER-SIDE doubles for the end-to-end fake-port slice (Task 32). Deliberately NOT the Node fakes of Task 3
// (test/clashpanel/support/*.mjs): those are outside the harness's served roots and may use Node APIs. These
// import nothing. They model only the port surfaces of plan catalog §1/§3/§5:
//   * engine: EnginePort members + controllable RunHandle (events `{type,...payload}` as clashtest/run/emitter.js)
//     + AC-P20 tripwires (register/unregister/invalidateModelPlacement/wireModelUnload throw);
//   * catalog: ModelCatalog (list/displayNameFor/keyOfModel/onChange/measurementBasis) with listener counting;
//   * viewer: a Viewer3D-shaped object (public overlays API, MESH FIRST then scene name; aggregate isolation;
//     fitToView; aggregate selection; add/removeEventListener with counting; theming methods THROW and record);
//   * THREE: an r71-shaped subset (Vector3 has NO setScalar) with dispose counters.
// engine.options.holdCancel = true makes cancel() NOT settle the run (a slow engine); the test then calls finish().
// If T22/T26's viewerApi.js reads a Viewer member not modelled here, add that member HERE (read-only, recorded),
// mirroring test/clashpanel/support/fakeViewer.mjs — never loosen an assertion of the test instead.

export function createFakeThree() {
  const counters = { geometryDisposed: 0, materialDisposed: 0 };
  class Vector3 {
    constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
    set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
    copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
    clone() { return new Vector3(this.x, this.y, this.z); }
  }
  class BufferGeometry {
    constructor() { this.points = null; }
    setFromPoints(points) { this.points = points; return this; }
    dispose() { counters.geometryDisposed += 1; }
  }
  class SphereGeometry extends BufferGeometry { constructor(r, w, h) { super(); this.parameters = { r, w, h }; } }
  class BoxGeometry extends BufferGeometry { constructor(x, y, z) { super(); this.parameters = { x, y, z }; } }
  class EdgesGeometry extends BufferGeometry { constructor(g) { super(); this.source = g; } }
  class Material { constructor(opts = {}) { Object.assign(this, opts); } dispose() { counters.materialDisposed += 1; } }
  class MeshBasicMaterial extends Material {}
  class LineBasicMaterial extends Material {}
  class Object3D {
    constructor() { this.position = new Vector3(); this.scale = new Vector3(1, 1, 1); this.visible = true; this.renderOrder = 0; }
  }
  class Mesh extends Object3D { constructor(geometry, material) { super(); this.geometry = geometry; this.material = material; } }
  class Line extends Object3D { constructor(geometry, material) { super(); this.geometry = geometry; this.material = material; } }
  class LineSegments extends Line {}
  class Box3 { constructor(min = new Vector3(), max = new Vector3()) { this.min = min; this.max = max; } }
  return { counters, REVISION: '71', Vector3, BufferGeometry, SphereGeometry, BoxGeometry, EdgesGeometry, MeshBasicMaterial, LineBasicMaterial, Object3D, Mesh, Line, LineSegments, Box3 };
}

export function createFakeModel(modelKey) {
  const tree = {
    getRootId: () => 1,
    getNodeName: (dbId) => `${modelKey}-element-${dbId}`,
    getNodeBox: (dbId, out) => { out[0] = dbId; out[1] = 0; out[2] = 0; out[3] = dbId + 1; out[4] = 1; out[5] = 1; return out; },
  };
  return { modelKey, getObjectTree: () => tree, getInstanceTree: () => tree, isLoadDone: () => true, getData: () => ({}) };
}

export function createFakeViewer(models) {
  const container = document.createElement('div');
  container.id = 'fake-viewer-container';
  document.body.appendChild(container);
  const scenes = new Map();
  const listeners = new Map();
  const calls = [];
  let isolation = [];
  const themingCall = (name) => () => { calls.push([name]); throw new Error('theming forbidden'); };
  const viewer = {
    container,
    calls,
    getAllModels: () => models.slice(),
    getAggregateIsolation: () => isolation.map((e) => ({ model: e.model, ids: e.ids.slice() })),
    getAggregateHiddenNodes: () => [],
    setAggregateIsolation(list) { calls.push(['setAggregateIsolation', list.length]); isolation = list.map((e) => ({ model: e.model, ids: [...e.ids] })); },
    getAggregateSelection: () => [],
    fitToView(...args) { calls.push(['fitToView', Array.isArray(args[0]) ? args[0].length : null]); },
    overlays: {
      hasScene: (name) => scenes.has(name),
      addScene(name) { if (typeof name !== 'string') throw new TypeError('scene name'); if (!scenes.has(name)) scenes.set(name, new Set()); return true; },
      addMesh(mesh, sceneName) {
        if (typeof sceneName !== 'string') throw new TypeError('addMesh(mesh, sceneName): scene name must be a string');
        if (!scenes.has(sceneName)) return false;
        scenes.get(sceneName).add(mesh);
        calls.push(['addMesh', sceneName]);
        return true;
      },
      removeMesh(mesh, sceneName) {
        if (typeof sceneName !== 'string') throw new TypeError('removeMesh(mesh, sceneName): scene name must be a string');
        const set = scenes.get(sceneName);
        return set ? set.delete(mesh) : false;
      },
      removeScene(name) { return scenes.delete(name); },
    },
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
    fire(type, payload) { for (const fn of [...(listeners.get(type) ?? [])]) fn({ type, ...payload }); },
    listenerCount: () => [...listeners.values()].reduce((n, s) => n + s.size, 0),
    meshCount: () => [...scenes.values()].reduce((n, s) => n + s.size, 0),
    sceneMeshes: () => Object.fromEntries([...scenes].map(([name, s]) => [name, s.size])),
    setThemingColor: themingCall('setThemingColor'),
    clearThemingColors: themingCall('clearThemingColors'),
  };
  return viewer;
}

export function createFakeCatalog(entries) {
  const subscribers = new Set();
  const byModel = new Map(entries.map((e) => [e.model, e.modelKey]));
  return {
    list: () => entries.map((e) => ({ modelKey: e.modelKey, displayName: e.displayName, model: e.model, loaded: true })),
    displayNameFor: (key) => entries.find((e) => e.modelKey === key)?.displayName ?? null,
    keyOfModel: (model) => byModel.get(model) ?? null,
    onChange(cb) { subscribers.add(cb); return () => { subscribers.delete(cb); }; },
    measurementBasis: () => ({ state: 'unverified', reason: 'no verified measurement basis in this fake' }),
    listenerCount: () => subscribers.size,
  };
}

const RUN_OPTIONS = Object.freeze({ maxResultsPerRun: 100000 });

export function makeResultSet({ runId, definition, status = 'completed', results }) {
  return {
    schemaVersion: 1, runId,
    testRef: { testId: definition?.testId ?? 'fake-test', revision: definition?.revision ?? 1, semanticDigest: null },
    definition: definition ?? null, derivedFromRunId: null,
    outcome: { status, coverage: status === 'completed' ? 'full' : 'partial', integrity: 'clean', freshness: 'current', environmentSensitive: false, environmentSensitiveCauses: [], reasons: [] },
    provenance: {
      registrySessionId: 'fake-session', libraryVersion: 'fake', broadPhase: 'fake', determinismClass: 'deterministic',
      runOptions: RUN_OPTIONS,
      models: ['mA', 'mB'].map((modelKey) => ({ modelKey, modelVersion: 'v1', scopeKinds: ['model'], elementCount: 0, scopeDigests: {}, bindingGeneration: 1, placementGeneration: 1 })),
      scopeProof: null, admissionBaseline: null, hierarchyInternalAcceptance: null, libraryExclusions: [], placementVerified: true,
      startedAt: 0, finishedAt: 1,
    },
    ledger: {
      planExists: true, pairSpaceTotal: 4, emptyOperand: false, units: [], rootOwners: [], unresolvedSelections: [],
      unreachablePopulation: [], hierarchyInternal: [], planningGaps: [], exclusions: [], warnings: [], budgetExhausted: false, firstRefusalUnitId: null,
    },
    results,
    diagnostics: { diagnostics: [], truncated: false, total: 0, countsByReason: [] },
    statistics: {}, digests: {}, sealed: true,
  };
}

export function hardResults() {
  const r = (i, a, b, point) => ({
    resultId: `r${i}`, pair: { first: { modelKey: 'mA', dbId: a }, second: { modelKey: 'mB', dbId: b } },
    mode: 'volume-overlap', evaluatedAs: 'volume-overlap',
    evidence: { witness: point ? { kind: 'point', point } : null }, flags: point ? {} : { witnessUnavailable: true }, unitId: '1.0',
  });
  return [r(1, 1, 10, [1, 2, 3]), r(2, 2, 10, [4, 5, 6]), r(3, 2, 11, null)];
}

function createHandle(runId, definition, persistenceById, options) {
  const listeners = new Set();
  let seq = 0;
  let snapshot = {
    runId, status: 'queued', phase: 'queued', seq: 0, unitsTotal: 0, unitsEvaluated: 0, unitsFailedOrSkipped: 0,
    pairSpaceTotal: 0, pairSpaceEvaluated: 0, pairSpaceProcessed: 0, fractionEvaluated: 0, fractionProcessed: null,
    resultsFound: 0, caveatCount: 0, caveatUnclassified: 0, currentUnitId: null, elapsedMs: 0,
  };
  let settle;
  let settlePersisted;
  let settled = false;
  const done = new Promise((res) => { settle = res; });
  const persisted = new Promise((res) => { settlePersisted = res; });
  const emit = (type, payload) => {
    const event = Object.freeze({ type, ...payload });
    for (const fn of [...listeners]) { try { fn(event); } catch { /* swallowed, as the engine does */ } }
  };
  const control = {
    cancelReasons: [],
    listenerCount: () => listeners.size,
    // `pairSpace` (optional, Option E test): `{processed, total}` makes the pair-space fraction differ from the units
    // fraction, the way a same-model run's front-loaded unit weights do. Omitted: pair space mirrors units (as before).
    progress({ unitsEvaluated, unitsTotal, resultsFound, pairSpace }) {
      seq += 1;
      const ps = pairSpace ?? { processed: unitsEvaluated, total: unitsTotal };
      const f = ps.total > 0 ? ps.processed / ps.total : 0;
      snapshot = { ...snapshot, status: 'running', phase: 'executing', seq, unitsEvaluated, unitsTotal, pairSpaceTotal: ps.total, pairSpaceEvaluated: ps.processed, pairSpaceProcessed: ps.processed, fractionEvaluated: f, fractionProcessed: f, resultsFound };
      emit('state', { seq, status: 'running', phase: 'executing' });
    },
    finish({ status = 'completed', results = hardResults(), persistence = { state: 'saved', timedOut: false, attempt: 1 } } = {}) {
      if (settled) return;
      settled = true;
      seq += 1;
      const resultSet = makeResultSet({ runId, definition, status, results });
      persistenceById.set(runId, persistence);
      snapshot = { ...snapshot, status, phase: 'terminal', seq, resultsFound: results.length };
      emit('state', { seq, status, phase: 'terminal', terminal: true, persistence });
      settle({ runId, status, resultSet, persistence });
      settlePersisted(persistence.state === 'saved' ? { state: 'saved' } : { state: 'skipped', reason: persistence.reason ?? 'not-saved' });
    },
  };
  const handle = Object.freeze({
    runId,
    getSnapshot: () => ({ ...snapshot }),
    subscribe(fn) {
      if (typeof fn !== 'function') throw new TypeError('listener must be a function');
      const box = (e) => fn(e);
      listeners.add(box);
      return () => { listeners.delete(box); };
    },
    cancel(reason) {
      control.cancelReasons.push(reason ?? null);
      if (!settled) {
        seq += 1;
        if (options.holdCancel === true) {   // an engine that finishes the run LATER (the test calls finish())
          snapshot = { ...snapshot, status: 'cancelling', seq };
          emit('state', { seq, status: 'cancelling', phase: snapshot.phase });
          return done;
        }
        snapshot = { ...snapshot, status: 'cancelling', seq };
        emit('state', { seq, status: 'cancelling', phase: snapshot.phase });
        queueMicrotask(() => control.finish({ status: 'cancelled', results: [], persistence: { state: 'skipped', timedOut: false, attempt: 0, reason: 'cancelled' } }));
      }
      return done;
    },
    done,
    persisted,
  });
  control.handle = handle;
  return control;
}

export function createFakeEngine({ bindings }) {
  const calls = [];
  const handles = [];
  const persistenceById = new Map();
  const leases = new Set();
  let n = 0;
  const options = { holdCancel: false, failRelease: false };
  const forbidden = (name) => () => { calls.push([name]); throw new Error(`AC-P20: ${name} must never be called by the Panel`); };
  return {
    calls, handles, options,
    activeLeases: () => leases.size,
    validateTest(def) { calls.push(['validateTest']); return { issues: [], issuesTruncated: false }; },
    startRun(def) {
      n += 1;
      const control = createHandle(`run-${n}`, def, persistenceById, options);
      calls.push(['startRun', control.handle.runId]);
      handles.push(control);
      return control.handle;
    },
    retainResultSet(runId) {
      calls.push(['retainResultSet', runId]);
      const lease = { runId };
      leases.add(lease);
      let released = false;
      return { release() { if (released) return; released = true; leases.delete(lease); calls.push(['lease.release', runId]); } };
    },
    releaseResultSet(runId, opts) {
      calls.push(['releaseResultSet', runId, opts ?? null]);
      if (options.failRelease === true) throw new Error(`release failed for ${runId}`);
    },
    getPersistenceState: (runId) => persistenceById.get(runId) ?? null,
    getFreshness: async () => ({ state: 'current', reasons: [] }),
    assessNoClashClaim: async (set) => ({ allowed: false, unqualified: false, qualifiers: [], exclusions: [], proofMethod: null }),
    derivations: {
      async summarize(set) {
        calls.push(['summarize']);
        return {
          runId: set.runId, status: set.outcome.status, environmentSensitive: false,
          axes: { coverage: set.outcome.coverage, integrity: set.outcome.integrity, freshness: 'current', freshnessAtSeal: 'current' },
          totalResults: set.results.length, resultsByMode: [], resultsByPairModels: [], resultsByCrossModel: [], resultsCaveated: 0,
          unitOutcomes: [], planningGaps: [], gapWeight: 0,
          caveats: { total: 0, completenessAffectingUpperBound: 0, omittedReasonOccurrences: 0, unclassifiedOccurrences: 0, countsByReason: [] },
        };
      },
      async filter(set) { calls.push(['filter']); return { matches: [], count: 0, total: set.results.length, unavailable: [] }; },
      async groupBy(set) {
        calls.push(['groupBy']);
        const groups = new Map();
        for (const r of set.results) {
          for (const ref of [r.pair.first, r.pair.second]) {
            const id = `element:${ref.modelKey}:${ref.dbId}`;
            if (!groups.has(id)) groups.set(id, { groupId: id, path: [id], facetId: 'element', params: {}, value: { modelKey: ref.modelKey, dbId: ref.dbId }, count: 0, members: [] });
            const g = groups.get(id);
            g.count += 1;
            g.members.push(r.resultId);
          }
        }
        const list = [...groups.values()];
        return { facets: ['element'], unavailable: [], total: set.results.length, memberships: list.reduce((s, g) => s + g.count, 0), groups: list };
      },
    },
    registry: { bindingFor: (key) => bindings.get(key) ?? null },
    register: forbidden('register'),
    unregister: forbidden('unregister'),
    invalidateModelPlacement: forbidden('invalidateModelPlacement'),
    wireModelUnload: forbidden('wireModelUnload'),
  };
}

/** One call builds the whole fake world used by the E2E test. */
export function createWorld() {
  const modelA = createFakeModel('mA');
  const modelB = createFakeModel('mB');
  const entries = [
    { modelKey: 'mA', displayName: 'Architecture', model: modelA },
    { modelKey: 'mB', displayName: 'Structure', model: modelB },
  ];
  const bindings = new Map(entries.map((e) => [e.modelKey, Object.freeze({ modelKey: e.modelKey, model: e.model, modelVersion: 'v1', lease: null, bindingGeneration: 1, placementGeneration: 1 })]));
  return {
    THREE: createFakeThree(),
    viewer: createFakeViewer([modelA, modelB]),
    catalog: createFakeCatalog(entries),
    engine: createFakeEngine({ bindings }),
    events: { BEFORE_MODEL_UNLOAD: 'beforeModelUnload', MODEL_REMOVED: 'modelRemoved' },
  };
}
