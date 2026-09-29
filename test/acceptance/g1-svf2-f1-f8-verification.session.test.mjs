// test/acceptance/g1-svf2-f1-f8-verification.session.test.mjs
//
// Offline, browser-free unit tests for Stage 4 (Phase 2.5's real shared session-state
// construction -- the FROZEN contract F4/F5/F7/F8/F6 reuse verbatim -- plus F1, F2, and their
// two immediate mandatory controls) AND Stage 5 (F4, F5, and their two mandatory controls) of
// test/acceptance/g1-svf2-f1-f8-verification.mjs. Stage 5 extends this file rather than adding
// a new sibling: observeF4 needs to run in the SAME node:vm page-realm harness this file
// already built, and genuinely benefits from building on a real F1-produced session (it reads
// session.artifacts.f1PopulationRecords, which only observeF1 populates) -- splitting F4's
// tests into a separate file would mean either duplicating this harness or awkwardly importing
// across test files. Auto-discovered by scripts/run-tests.mjs (`*.test.mjs`).
//
// AUTHORIZATION BOUNDARY: this file NEVER launches a real Chromium browser, NEVER imports
// playwright, and NEVER executes main(). Per the codex-advisor consults for both stages, the
// in-page functions here (setupSharedSessionResources, observeF1, observeF2, observeF4) are
// tested by reconstructing them from their own source text inside an isolated node:vm context
// -- reusing Stage 2's own createPageRealm pattern -- rather than a plain `globalThis.window`
// fake, so an accidental Node-module closure reference would surface as a ReferenceError here
// exactly as it would if handed to a real page.evaluate. Per Stage 5's own codex-advisor
// consult, observeF4's own tests populate window.__g1.mod with the REAL, actually-imported
// `adaptViewerGeometry`/`compactAndWeld` (never fakes for these two -- both are pure,
// already-tested production functions with no live-Viewer dependency, confirmed by direct
// source read) alongside a FAKE `viewer.impl.getRenderProxy` -- the one piece that genuinely
// needs a live browser.

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { adaptViewerGeometry } from '../../collision/viewer/ViewerGeometryAdapter.js';
import { compactAndWeld as realCompactAndWeld } from '../../collision/geometry/activeRangeCompaction.js';
import { createGeometryIdentity } from '../../collision/geometry/GeometryIdentity.js';
import { createViewerApi } from '../../clashpanel/viewer/viewerApi.js';
import {
  CONTROL_STATE,
  CONTROL_RESTORATION_REQUIRED,
  CHECK_VERDICT,
  SESSION_K,
  SESSION_MODEL_VERSION,
  IN_PAGE_FUNCTION_REGISTRY,
  sessionErrOf,
  setupSharedSessionResources,
  observeF1,
  scoreF1,
  observeF2,
  scoreF2,
  runWrongOwnerControl,
  runHiddenFragmentControl,
  classifyWeldResult,
  observeF4,
  scoreF4,
  deriveOrganicBreach,
  scoreF5,
  jsonDeepEqual,
  runInvalidGeometryConsumerControl,
  runCapacityBreachControl,
  F7_TOLERANCE_CONSTANTS,
  observeF7,
  scoreF7,
  selectBoundsBeyondToleranceTarget,
  runInvalidBoundsControl,
  runBoundsBeyondToleranceControl,
  observeF8,
  scoreF8,
} from './g1-svf2-f1-f8-verification.mjs';

// ============================================================================================
// Page-realm test harness (node:vm-backed) -- see file banner above.
//
// Fix wave (final whole-branch review, Important I2): this file's own `IN_PAGE_FUNCTIONS`
// bundle previously hand-listed a subset of what a real page bootstrap installs, which is
// exactly why a genuine gap (`sessionErrOf` missing from the REAL `IN_PAGE_FUNCTION_REGISTRY`)
// went uncaught -- this test realm silently provided something the real bootstrap didn't.
// Derived directly from `IN_PAGE_FUNCTION_REGISTRY` (the production file's own single source of
// truth for "every function a real page bootstrap installs") rather than a second, independently
// -maintained list, so the two can never again silently diverge -- a missing/renamed production
// registry entry now surfaces here automatically, the next time any test in this file exercises
// it, rather than being masked by a hand-picked subset that happened to include it.
// ============================================================================================

const IN_PAGE_FUNCTIONS = IN_PAGE_FUNCTION_REGISTRY;

function createPageRealm(initialWindow = {}) {
  const context = vm.createContext({ window: initialWindow, performance, setTimeout, clearTimeout, console });
  for (const [name, fn] of Object.entries(IN_PAGE_FUNCTIONS)) {
    vm.runInContext(`globalThis.${name} = (${fn.toString()})`, context);
  }
  return {
    window: initialWindow,
    call(fn, ...args) {
      return vm.runInContext(fn.name, context)(...args);
    },
  };
}

function fakeWorld(overrides = {}) {
  return {
    isModelLive: () => true,
    evictModel: () => {},
    dispose: () => {},
    ...overrides,
  };
}

function fakeRegistry(world, overrides = {}) {
  let boundModel = null;
  return {
    world,
    registrySessionId: overrides.sessionId || 'regsess-fake1',
    register: overrides.register || ((K, model) => { boundModel = model; }),
    bindingFor: overrides.bindingFor || (() => (boundModel ? { model: boundModel } : null)),
    unregister: overrides.unregister || (() => {}),
  };
}

function buildFakeModules({ world, registry, enumerator } = {}) {
  return {
    '/collision/index.js': { CollisionWorld: { fromViewer: world || (async (viewer, opts) => fakeWorld()) } },
    '/clashtest/index.js': { createModelRegistry: registry || (({ world: w }) => fakeRegistry(w)) },
    '/clashtest/viewer/index.js': { createViewerElementEnumerator: enumerator || (() => ({ resolveRoots: async () => ({}) })) },
  };
}

function realmWithLoadedModel(model, mod) {
  const window_ = {
    __g1: {
      loads: { tok: { gen: 1, status: 'completed', api: 'loadDocumentNode' } },
      models: { tok: model },
      mod,
    },
    __viewer: {},
  };
  return createPageRealm(window_);
}

// ============================================================================================
// setupSharedSessionResources -- Phase 2.5's real construction, the frozen contract
// ============================================================================================

test('SESSION_K / SESSION_MODEL_VERSION match the plan\'s own fixed harness-local values', () => {
  assert.equal(SESSION_K, 'g1-f1f8-verification');
  assert.equal(SESSION_MODEL_VERSION, 'g1-live-1');
});

test('setupSharedSessionResources: success -- publishes exactly one session, returns a JSON-safe receipt with no live objects', () => {
  const model = { id: 'M' };
  const mod = buildFakeModules();
  const realm = realmWithLoadedModel(model, mod);

  const receipt = realm.call(setupSharedSessionResources, 'tok');

  return receipt.then((r) => {
    assert.equal(r.ok, true);
    assert.equal(typeof r.sessionId, 'string');
    // r.postconditions was built by code running INSIDE the vm realm, so it is a plain object
    // from a DIFFERENT realm's Object.prototype -- assert.deepEqual's cross-realm prototype
    // check would spuriously fail despite matching shape/values (same issue documented in the
    // async/shell test files). Compare fields individually instead.
    assert.equal(r.postconditions.registryWorldMatches, true);
    assert.equal(r.postconditions.bindingModelMatches, true);
    assert.equal(r.postconditions.worldModelIsLive, true);
    assert.equal(r.error, null);
    assert.equal(r.cleanup, null);
    // The receipt itself must never carry a live object.
    assert.equal('world' in r, false);
    assert.equal('registry' in r, false);
    assert.equal('model' in r, false);

    const g = realm.window.__g1;
    assert.equal(Object.keys(g.sessions).length, 1, 'exactly one session published');
    const session = g.sessions[r.sessionId];
    assert.equal(session.model, model);
    // Cross-checks the in-page function's own literal strings (required -- it cannot reference
    // the module-level SESSION_K/SESSION_MODEL_VERSION constants, an in-page-only constraint)
    // against those exported constants directly, so the two can never silently drift apart.
    assert.equal(session.K, SESSION_K);
    assert.equal(session.modelVersion, SESSION_MODEL_VERSION);
    // `instanceof Map` fails here even for a genuine Map: it was constructed by code running
    // INSIDE the vm realm, so it is an instance of THAT realm's own Map constructor, not
    // Node's. Object.prototype.toString's internal-slot tag is realm-agnostic.
    assert.equal(Object.prototype.toString.call(session.artifacts.f1FragmentMapsByRoot), '[object Map]', 'artifacts.f1FragmentMapsByRoot is a real page-owned Map');
  });
});

test('setupSharedSessionResources: world construction throws -- no session published, no cleanup attempted (nothing was built yet)', async () => {
  const model = { id: 'M' };
  const mod = buildFakeModules({ world: async () => { throw new Error('CollisionWorld.fromViewer failed'); } });
  const realm = realmWithLoadedModel(model, mod);

  const r = await realm.call(setupSharedSessionResources, 'tok');

  assert.equal(r.ok, false);
  assert.equal(r.sessionId, null);
  assert.equal(r.error.phase, 'world');
  assert.equal(r.error.message, 'CollisionWorld.fromViewer failed');
  assert.equal(r.cleanup, null, 'nothing was constructed yet, so there is nothing to best-effort clean up');
  assert.equal(Object.keys(realm.window.__g1.sessions || {}).length, 0);
});

test('setupSharedSessionResources: registry construction throws ModelBindingError{reason:"invalid-world"} -- best-effort world cleanup runs', async () => {
  const model = { id: 'M' };
  let disposeCalled = false;
  const world = fakeWorld({ dispose: () => { disposeCalled = true; } });
  const mod = buildFakeModules({
    world: async () => world,
    registry: () => {
      const err = new Error('world lacks admitModel()');
      err.name = 'ModelBindingError';
      err.reason = 'invalid-world';
      throw err;
    },
  });
  const realm = realmWithLoadedModel(model, mod);

  const r = await realm.call(setupSharedSessionResources, 'tok');

  assert.equal(r.ok, false);
  assert.equal(r.error.phase, 'registry');
  assert.equal(r.error.name, 'ModelBindingError');
  assert.equal(r.error.reason, 'invalid-world');
  assert.equal(disposeCalled, true, 'world.dispose() must be attempted -- world was already constructed before registry failed');
  assert.ok(r.cleanup.attempted.includes('world.dispose'));
  assert.equal(Object.keys(realm.window.__g1.sessions || {}).length, 0);
});

test('setupSharedSessionResources: a postcondition assertion fails -- best-effort registry.unregister + world.evictModel + world.dispose all run', async () => {
  const model = { id: 'M' };
  let unregisterCalled = false;
  let evictCalled = false;
  let disposeCalled = false;
  const world = fakeWorld({
    isModelLive: () => false, // the failing postcondition
    evictModel: () => { evictCalled = true; },
    dispose: () => { disposeCalled = true; },
  });
  const mod = buildFakeModules({
    world: async () => world,
    registry: ({ world: w }) => fakeRegistry(w, { unregister: () => { unregisterCalled = true; } }),
  });
  const realm = realmWithLoadedModel(model, mod);

  const r = await realm.call(setupSharedSessionResources, 'tok');

  assert.equal(r.ok, false);
  assert.equal(r.error.phase, 'postconditions');
  // Cross-realm plain object (see the "success" test above) -- compare fields individually.
  assert.equal(r.postconditions.registryWorldMatches, true);
  assert.equal(r.postconditions.bindingModelMatches, true);
  assert.equal(r.postconditions.worldModelIsLive, false);
  assert.equal(unregisterCalled, true);
  assert.equal(evictCalled, true);
  assert.equal(disposeCalled, true);
  assert.equal(Object.keys(realm.window.__g1.sessions || {}).length, 0, 'no partial session is ever published');
});

test('setupSharedSessionResources: an existing session id is never silently overwritten -- rejected, with cleanup', async () => {
  const model = { id: 'M' };
  const mod = buildFakeModules({ registry: ({ world: w }) => fakeRegistry(w, { sessionId: 'duplicate-id' }) });
  const realm = realmWithLoadedModel(model, mod);
  realm.window.__g1.sessions = { 'duplicate-id': { preexisting: true } };

  const r = await realm.call(setupSharedSessionResources, 'tok');

  assert.equal(r.ok, false);
  assert.equal(r.error.phase, 'publish');
  assert.deepEqual(realm.window.__g1.sessions['duplicate-id'], { preexisting: true }, 'the pre-existing session must never be overwritten');
});

test('setupSharedSessionResources: no completed loadDocumentNode record -- fails at precondition, before touching any module', async () => {
  const realm = createPageRealm({ __g1: { loads: {}, models: {}, mod: buildFakeModules() }, __viewer: {} });
  const r = await realm.call(setupSharedSessionResources, 'missing-tok');
  assert.equal(r.ok, false);
  assert.equal(r.error.phase, 'precondition');
});

// ============================================================================================
// F1 -- fragment->owner mapping
// ============================================================================================

function fakeRoot(dbId, { fragmentCount = 2, ownerDbIds = [dbId], subtreeDigest = `digest-${dbId}` } = {}) {
  return { dbId, fragmentCount, ownerDbIds, subtreeDigest };
}

function fakeFragmentMap(entries) {
  const m = new Map();
  for (const e of entries) m.set(e.fragmentId, e);
  return m;
}

function buildF1Session({ roots, extractFragmentsImpl, extractAllFragmentsImpl, populationDigest = 'pop-digest', ownerMismatchCount = 0, unreachableCount = 0 }) {
  const model = {
    getFragmentList: () => ({ getCount: () => roots.length * 2 }),
  };
  const enumerator = {
    resolveRoots: async () => ({
      roots,
      ownerMismatch: { count: ownerMismatchCount },
      unreachable: { count: unreachableCount },
      population: { count: roots.length * 2, digest: populationDigest },
    }),
  };
  const session = {
    binding: { model }, model, enumerator,
    artifacts: { f1FragmentMapsByRoot: new Map() },
  };
  const mod = {
    '/collision/viewer/ViewerModelAdapter.js': {
      extractFragments: extractFragmentsImpl,
      extractAllFragments: extractAllFragmentsImpl,
    },
    '/clashtest/planning/scopeDigest.js': {
      digestSubtree: async (rows) => ({ digest: `subtree-${JSON.stringify(rows.map((r) => r.fragId))}` }),
      digestPopulation: async () => ({ digest: populationDigest }),
    },
  };
  return { model, enumerator, session, mod };
}

test('observeF1: a fully matching model -> zero mismatches, populationDigestEqual true, per-root Maps stored for F8 reuse', async () => {
  const root = fakeRoot(10, { fragmentCount: 2, ownerDbIds: [10], subtreeDigest: 'subtree-[0,1]' });
  const { session, mod } = buildF1Session({
    roots: [root],
    extractFragmentsImpl: async () => fakeFragmentMap([{ fragmentId: 0, ownerDbId: 10 }, { fragmentId: 1, ownerDbId: 10 }]),
    extractAllFragmentsImpl: async () => ({ records: fakeFragmentMap([{ fragmentId: 0, ownerDbId: 10 }, { fragmentId: 1, ownerDbId: 10 }]), diagnostics: [] }),
  });
  const realm = createPageRealm({ __g1: { sessions: { s1: session }, mod }, __viewer: {} });

  const result = await realm.call(observeF1, 's1');

  assert.equal(result.ok, true);
  assert.equal(result.fields.ownerMismatchCount, 0);
  assert.equal(result.fields.unreachableCount, 0);
  assert.equal(result.fields.sizeMismatch, 0);
  assert.equal(result.fields.ownersMismatch, 0);
  assert.equal(result.fields.subtreeDigestMismatch, 0);
  assert.equal(result.fields.populationDigestEqual, true);
  assert.equal(session.artifacts.f1FragmentMapsByRoot.has(10), true, 'the per-root extractFragments Map is retained in harness memory for F8');
  assert.equal(scoreF1(result.fields).verdict, CHECK_VERDICT.PASS);
});

test('observeF1: a root with the WRONG fragment count -> sizeMismatch, FAIL', async () => {
  const root = fakeRoot(10, { fragmentCount: 3 }); // adapter claims 3, library will return 2
  const { session, mod } = buildF1Session({
    roots: [root],
    extractFragmentsImpl: async () => fakeFragmentMap([{ fragmentId: 0, ownerDbId: 10 }, { fragmentId: 1, ownerDbId: 10 }]),
    extractAllFragmentsImpl: async () => ({ records: fakeFragmentMap([{ fragmentId: 0, ownerDbId: 10 }, { fragmentId: 1, ownerDbId: 10 }]), diagnostics: [] }),
  });
  const realm = createPageRealm({ __g1: { sessions: { s1: session }, mod }, __viewer: {} });

  const result = await realm.call(observeF1, 's1');
  assert.equal(result.fields.sizeMismatch, 1);
  assert.equal(scoreF1(result.fields).verdict, CHECK_VERDICT.FAIL);
});

test('observeF1: a root with mismatched owners -> ownersMismatch, FAIL', async () => {
  const root = fakeRoot(10, { fragmentCount: 2, ownerDbIds: [10] });
  const { session, mod } = buildF1Session({
    roots: [root],
    extractFragmentsImpl: async () => fakeFragmentMap([{ fragmentId: 0, ownerDbId: 999 }, { fragmentId: 1, ownerDbId: 999 }]),
    extractAllFragmentsImpl: async () => ({ records: fakeFragmentMap([{ fragmentId: 0, ownerDbId: 999 }, { fragmentId: 1, ownerDbId: 999 }]), diagnostics: [] }),
  });
  const realm = createPageRealm({ __g1: { sessions: { s1: session }, mod }, __viewer: {} });

  const result = await realm.call(observeF1, 's1');
  assert.equal(result.fields.ownersMismatch, 1);
  assert.equal(scoreF1(result.fields).verdict, CHECK_VERDICT.FAIL);
});

test('observeF1: a root whose library subtree digest disagrees -> subtreeDigestMismatch, FAIL', async () => {
  const root = fakeRoot(10, { fragmentCount: 2, ownerDbIds: [10], subtreeDigest: 'expected-digest-that-will-never-match' });
  const { session, mod } = buildF1Session({
    roots: [root],
    extractFragmentsImpl: async () => fakeFragmentMap([{ fragmentId: 0, ownerDbId: 10 }, { fragmentId: 1, ownerDbId: 10 }]),
    extractAllFragmentsImpl: async () => ({ records: fakeFragmentMap([{ fragmentId: 0, ownerDbId: 10 }, { fragmentId: 1, ownerDbId: 10 }]), diagnostics: [] }),
  });
  const realm = createPageRealm({ __g1: { sessions: { s1: session }, mod }, __viewer: {} });

  const result = await realm.call(observeF1, 's1');
  assert.equal(result.fields.subtreeDigestMismatch, 1);
  assert.equal(scoreF1(result.fields).verdict, CHECK_VERDICT.FAIL);
});

test('observeF1: resolveRoots itself reporting a non-zero ownerMismatch/unreachable count -> FAIL regardless of per-root comparison', async () => {
  const root = fakeRoot(10, { fragmentCount: 2, ownerDbIds: [10], subtreeDigest: 'subtree-[0,1]' });
  const { session, mod } = buildF1Session({
    roots: [root], ownerMismatchCount: 1, unreachableCount: 0,
    extractFragmentsImpl: async () => fakeFragmentMap([{ fragmentId: 0, ownerDbId: 10 }, { fragmentId: 1, ownerDbId: 10 }]),
    extractAllFragmentsImpl: async () => ({ records: fakeFragmentMap([{ fragmentId: 0, ownerDbId: 10 }, { fragmentId: 1, ownerDbId: 10 }]), diagnostics: [] }),
  });
  const realm = createPageRealm({ __g1: { sessions: { s1: session }, mod }, __viewer: {} });

  const result = await realm.call(observeF1, 's1');
  assert.equal(scoreF1(result.fields).verdict, CHECK_VERDICT.FAIL);
});

test('observeF1: population digest disagreement (independently recomputed vs resolveRoots) -> FAIL', async () => {
  const root = fakeRoot(10, { fragmentCount: 2, ownerDbIds: [10], subtreeDigest: 'subtree-[0,1]' });
  const { session, mod } = buildF1Session({
    roots: [root], populationDigest: 'adapter-digest',
    extractFragmentsImpl: async () => fakeFragmentMap([{ fragmentId: 0, ownerDbId: 10 }, { fragmentId: 1, ownerDbId: 10 }]),
    extractAllFragmentsImpl: async () => ({ records: fakeFragmentMap([{ fragmentId: 0, ownerDbId: 10 }, { fragmentId: 1, ownerDbId: 10 }]), diagnostics: [] }),
  });
  // Override digestPopulation to return something that will never equal 'adapter-digest'.
  mod['/clashtest/planning/scopeDigest.js'].digestPopulation = async () => ({ digest: 'library-digest-does-not-match' });
  const realm = createPageRealm({ __g1: { sessions: { s1: session }, mod }, __viewer: {} });

  const result = await realm.call(observeF1, 's1');
  assert.equal(result.fields.populationDigestEqual, false);
  assert.equal(scoreF1(result.fields).verdict, CHECK_VERDICT.FAIL);
});

test('observeF1: N/U dropped-fragment classes alone never count as a mismatch (digest still matches)', async () => {
  const root = fakeRoot(10, { fragmentCount: 1, ownerDbIds: [10], subtreeDigest: 'subtree-[0]' });
  const { session, mod } = buildF1Session({
    roots: [root],
    extractFragmentsImpl: async () => fakeFragmentMap([{ fragmentId: 0, ownerDbId: 10 }]),
    extractAllFragmentsImpl: async () => ({
      records: fakeFragmentMap([{ fragmentId: 0, ownerDbId: 10 }]),
      diagnostics: [{ fragment: { fragId: 1 }, reason: 'fragment-not-loaded' }], // fragId 1 is class N
    }),
  });
  const realm = createPageRealm({ __g1: { sessions: { s1: session }, mod }, __viewer: {} });

  const result = await realm.call(observeF1, 's1');
  assert.equal(scoreF1(result.fields).verdict, CHECK_VERDICT.PASS, 'a dropped N/U fragment must never itself cause an F1 failure');
});

test('scoreF1: fail-closed on missing/undefined fields', () => {
  assert.equal(scoreF1({}).verdict, CHECK_VERDICT.FAIL);
  assert.equal(scoreF1(undefined).verdict, CHECK_VERDICT.FAIL);
});

// ============================================================================================
// F2 -- tree/fragment population and whole-model roots
// ============================================================================================

function buildF2Session({ isObjectTreeCreated = true, treeThrows = false, walkFn, populationClasses, rootsLength = 1, fragListCount }) {
  const model = {
    isObjectTreeCreated: () => isObjectTreeCreated,
    getFragmentList: () => ({ getCount: () => fragListCount }),
  };
  if (treeThrows) {
    model.getObjectTree = () => { throw new Error('tree unavailable'); };
  } else if (walkFn) {
    model.getObjectTree = walkFn;
  }
  const session = {
    model,
    artifacts: { f1PopulationClasses: populationClasses, f1RootsLength: rootsLength },
  };
  return session;
}

// A minimal fake tree: root=0; children map; fragments per node.
function fakeTree({ children, fragmentsByNode }) {
  return {
    getRootId: () => 0,
    enumNodeChildren: (n, cb) => { for (const c of (children.get(n) || [])) cb(c); },
    enumNodeFragments: (n, cb) => { for (const f of (fragmentsByNode.get(n) || [])) cb(f); },
  };
}

test('observeF2: tree not accessible (isObjectTreeCreated false) -> accountingBalanced false, FAIL', () => {
  const session = buildF2Session({ isObjectTreeCreated: false, populationClasses: [], fragListCount: 0 });
  const realm = createPageRealm({ __g1: { sessions: { s1: session } } });
  const result = realm.call(observeF2, 's1');
  assert.equal(result.fields.isObjectTreeCreated, false);
  assert.equal(scoreF2(result.fields).verdict, CHECK_VERDICT.FAIL);
  assert.equal(scoreF2(result.fields).reason, 'tree-not-accessible');
});

test('observeF2: getObjectTree() throws -> accountingBalanced false, FAIL', () => {
  const session = buildF2Session({ treeThrows: true, populationClasses: [], fragListCount: 0 });
  const realm = createPageRealm({ __g1: { sessions: { s1: session } } });
  const result = realm.call(observeF2, 's1');
  assert.equal(scoreF2(result.fields).verdict, CHECK_VERDICT.FAIL);
});

test('observeF2: a fully reconciled tree (every L id reachable) -> accountingBalanced true, PASS', () => {
  // Population: fragIds 0,1 are L (owned by node 0's fragments); fragId 2 is N.
  const tree = fakeTree({
    children: new Map([[0, []]]),
    fragmentsByNode: new Map([[0, [0, 1]]]),
  });
  const session = buildF2Session({
    walkFn: () => tree,
    populationClasses: [{ fragId: 0, cls: 'L' }, { fragId: 1, cls: 'L' }, { fragId: 2, cls: 'N' }],
    fragListCount: 3,
  });
  const realm = createPageRealm({ __g1: { sessions: { s1: session } } });

  const result = realm.call(observeF2, 's1');
  assert.equal(result.fields.treeReachableCount, 2);
  assert.equal(result.fields.classL, 2);
  assert.equal(result.fields.classN, 1);
  assert.equal(result.fields.loadedButUnreachableCount, 0);
  assert.equal(result.fields.accountingBalanced, true);
  assert.equal(scoreF2(result.fields).verdict, CHECK_VERDICT.PASS);
});

test('observeF2: an L fragment not reachable by the tree walk -> loadedButUnreachableCount > 0, still balanced (not itself a failure)', () => {
  // fragId 1 is L per population, but the tree never reports it (hidden/never-attached).
  const tree = fakeTree({
    children: new Map([[0, []]]),
    fragmentsByNode: new Map([[0, [0]]]), // only fragId 0 is tree-reachable
  });
  const session = buildF2Session({
    walkFn: () => tree,
    populationClasses: [{ fragId: 0, cls: 'L' }, { fragId: 1, cls: 'L' }],
    fragListCount: 2,
  });
  const realm = createPageRealm({ __g1: { sessions: { s1: session } } });

  const result = realm.call(observeF2, 's1');
  assert.equal(result.fields.loadedButUnreachableCount, 1);
  assert.equal(result.fields.accountingBalanced, true, 'loaded-but-unreachable is a named bucket, never a failure by itself');
  assert.equal(scoreF2(result.fields).verdict, CHECK_VERDICT.PASS);
});

test('observeF2: a tree-reachable id that is NOT in class L (a genuine inconsistency) -> accountingBalanced false, FAIL', () => {
  // fragId 5 is tree-reachable but was classified N/U by F1's population scan -- a real defect.
  const tree = fakeTree({
    children: new Map([[0, []]]),
    fragmentsByNode: new Map([[0, [0, 5]]]),
  });
  const session = buildF2Session({
    walkFn: () => tree,
    populationClasses: [{ fragId: 0, cls: 'L' }, { fragId: 5, cls: 'N' }],
    fragListCount: 2,
  });
  const realm = createPageRealm({ __g1: { sessions: { s1: session } } });

  const result = realm.call(observeF2, 's1');
  assert.equal(result.fields.accountingBalanced, false);
  assert.equal(scoreF2(result.fields).verdict, CHECK_VERDICT.FAIL);
  assert.equal(scoreF2(result.fields).reason, 'accounting-not-balanced');
});

test('observeF2: rootsLength is reused from F1, never recomputed', () => {
  const tree = fakeTree({ children: new Map([[0, []]]), fragmentsByNode: new Map([[0, [0]]]) });
  const session = buildF2Session({ walkFn: () => tree, populationClasses: [{ fragId: 0, cls: 'L' }], rootsLength: 7, fragListCount: 1 });
  const realm = createPageRealm({ __g1: { sessions: { s1: session } } });
  const result = realm.call(observeF2, 's1');
  assert.equal(result.fields.rootsLength, 7);
});

test('observeF2: refuses to run before F1 has populated session.artifacts.f1PopulationClasses', () => {
  const session = { model: {}, artifacts: {} };
  const realm = createPageRealm({ __g1: { sessions: { s1: session } } });
  const result = realm.call(observeF2, 's1');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'f1-population-classes-not-available-run-observeF1-first');
});

// ============================================================================================
// wrong-owner / hidden-fragment controls
// ============================================================================================

test('CONTROL_RESTORATION_REQUIRED cross-check: wrong-owner and hidden-fragment are both true (plan lines 844-845)', () => {
  assert.equal(CONTROL_RESTORATION_REQUIRED['wrong-owner'], true);
  assert.equal(CONTROL_RESTORATION_REQUIRED['hidden-fragment'], true);
});

function fakeModelForOwnerControl() {
  return { fragList: { getDbIds: (id) => 42 } };
}

test('wrong-owner control: DETECTED_RESTORED', async () => {
  const model = fakeModelForOwnerControl();
  const result = await runWrongOwnerControl({
    modelBefore: model, world: { isModelLive: () => true }, registry: { bindingFor: () => ({ model }) }, registryKey: 'K',
    checkF1: async (m) => ({ ownerMismatchDetected: m.fragList.getDbIds(0) === -999999 }),
  });
  assert.equal(result.state, CONTROL_STATE.DETECTED_RESTORED);
  assert.equal(result.restorationRequired, true);
  assert.equal(model.fragList.getDbIds(0), 42, 'restored to the original after the control');
});

test('wrong-owner control: NOT_DETECTED', async () => {
  const model = fakeModelForOwnerControl();
  const result = await runWrongOwnerControl({
    modelBefore: model, world: { isModelLive: () => true }, registry: { bindingFor: () => ({ model }) }, registryKey: 'K',
    checkF1: async () => ({ ownerMismatchDetected: false }),
  });
  assert.equal(result.state, CONTROL_STATE.NOT_DETECTED);
});

test('wrong-owner control: RESTORE_FAILED', async () => {
  const model = fakeModelForOwnerControl();
  const result = await runWrongOwnerControl({
    modelBefore: model, world: { isModelLive: () => false }, registry: { bindingFor: () => ({ model }) }, registryKey: 'K',
    checkF1: async () => ({ ownerMismatchDetected: true }),
  });
  assert.equal(result.state, CONTROL_STATE.RESTORE_FAILED);
});

test('wrong-owner control: TIMED_OUT', async () => {
  const model = fakeModelForOwnerControl();
  const result = await runWrongOwnerControl({
    modelBefore: model, world: { isModelLive: () => true }, registry: { bindingFor: () => ({ model }) }, registryKey: 'K',
    checkF1: () => new Promise(() => {}),
    controlTimeoutMs: 20,
  });
  assert.equal(result.state, CONTROL_STATE.TIMED_OUT);
});

test('wrong-owner control: NOT_EXECUTABLE', async () => {
  const result = await runWrongOwnerControl({ modelBefore: null, checkF1: async () => ({ ownerMismatchDetected: true }) });
  assert.equal(result.state, CONTROL_STATE.NOT_EXECUTABLE);
});

function fakeModelForHiddenFragmentControl() {
  return { tree: { enumNodeFragments: (n, cb) => { cb(1); cb(2); } } };
}

test('hidden-fragment control: DETECTED_RESTORED', async () => {
  const model = fakeModelForHiddenFragmentControl();
  const seenByGate = [];
  const result = await runHiddenFragmentControl({
    modelBefore: model, world: { isModelLive: () => true }, registry: { bindingFor: () => ({ model }) }, registryKey: 'K',
    checkF2: async (m) => {
      m.tree.enumNodeFragments(0, (f) => seenByGate.push(f));
      return { hiddenFragmentDetected: !seenByGate.includes(1) }; // fragment 1 was patched out
    },
  });
  assert.equal(result.state, CONTROL_STATE.DETECTED_RESTORED);
  assert.equal(result.restorationRequired, true);
  const restoredSeen = [];
  model.tree.enumNodeFragments(0, (f) => restoredSeen.push(f));
  assert.deepEqual(restoredSeen, [1, 2], 'restored to the original after the control');
});

test('hidden-fragment control: NOT_DETECTED', async () => {
  const model = fakeModelForHiddenFragmentControl();
  const result = await runHiddenFragmentControl({
    modelBefore: model, world: { isModelLive: () => true }, registry: { bindingFor: () => ({ model }) }, registryKey: 'K',
    checkF2: async () => ({ hiddenFragmentDetected: false }),
  });
  assert.equal(result.state, CONTROL_STATE.NOT_DETECTED);
});

test('hidden-fragment control: RESTORE_FAILED', async () => {
  const model = fakeModelForHiddenFragmentControl();
  const result = await runHiddenFragmentControl({
    modelBefore: model, world: { isModelLive: () => false }, registry: { bindingFor: () => ({ model }) }, registryKey: 'K',
    checkF2: async () => ({ hiddenFragmentDetected: true }),
  });
  assert.equal(result.state, CONTROL_STATE.RESTORE_FAILED);
});

test('hidden-fragment control: TIMED_OUT', async () => {
  const model = fakeModelForHiddenFragmentControl();
  const result = await runHiddenFragmentControl({
    modelBefore: model, world: { isModelLive: () => true }, registry: { bindingFor: () => ({ model }) }, registryKey: 'K',
    checkF2: () => new Promise(() => {}),
    controlTimeoutMs: 20,
  });
  assert.equal(result.state, CONTROL_STATE.TIMED_OUT);
});

test('hidden-fragment control: NOT_EXECUTABLE', async () => {
  const result = await runHiddenFragmentControl({ modelBefore: null, checkF2: async () => ({ hiddenFragmentDetected: true }) });
  assert.equal(result.state, CONTROL_STATE.NOT_EXECUTABLE);
});

test('createControlResult validates both controls\' produced records', async () => {
  const model = fakeModelForOwnerControl();
  const ownerResult = await runWrongOwnerControl({
    modelBefore: model, world: { isModelLive: () => true }, registry: { bindingFor: () => ({ model }) }, registryKey: 'K',
    checkF1: async () => ({ ownerMismatchDetected: true }),
  });
  assert.equal(ownerResult.restorationRequired, CONTROL_RESTORATION_REQUIRED['wrong-owner']);

  const fragModel = fakeModelForHiddenFragmentControl();
  const hiddenResult = await runHiddenFragmentControl({
    modelBefore: fragModel, world: { isModelLive: () => true }, registry: { bindingFor: () => ({ model: fragModel }) }, registryKey: 'K',
    checkF2: async () => ({ hiddenFragmentDetected: true }),
  });
  assert.equal(hiddenResult.restorationRequired, CONTROL_RESTORATION_REQUIRED['hidden-fragment']);
});

// ============================================================================================
// Stage 5 -- F4 (observeF4/scoreF4), F5 (scoreF5), and their two controls
// ============================================================================================

function fakeF4Mod() {
  return {
    '/collision/viewer/ViewerGeometryAdapter.js': { adaptViewerGeometry },
    '/collision/geometry/activeRangeCompaction.js': { compactAndWeld: realCompactAndWeld },
  };
}

function fakePopulationRecord(fragId, geometryIndex, { worldMatrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], ownerDbId = 100 } = {}) {
  return [fragId, { fragmentId: fragId, geometryIdentity: createGeometryIdentity(0, geometryIndex), worldMatrix, ownerDbId }];
}

function buildF4Session(populationRecordsEntries, { getUnitScale = () => 1, getGeometryId, getDbIds } = {}) {
  const records = new Map(populationRecordsEntries);
  // Defaults: a fresh fragList.getGeometryId()/getDbIds() that AGREES with each record's own
  // already-cached geometryIdentity/ownerDbId -- the "fully healthy" case. Individual tests
  // override getGeometryId/getDbIds to exercise the fix-round-1 re-verification pass (throws,
  // undefined, or a disagreeing value).
  const defaultGetGeometryId = (fragId) => {
    const record = records.get(fragId);
    return record && record.geometryIdentity ? record.geometryIdentity.geometryIndex : undefined;
  };
  const defaultGetDbIds = (fragId) => {
    const record = records.get(fragId);
    return record ? record.ownerDbId : undefined;
  };
  const model = {
    getUnitScale,
    getFragmentList: () => ({
      getGeometryId: getGeometryId || defaultGetGeometryId,
      getDbIds: getDbIds || defaultGetDbIds,
    }),
  };
  return {
    model,
    artifacts: { f1PopulationRecords: records },
  };
}

// Standard non-interleaved BufferAttribute shape (adaptViewerGeometry's own Priority 3) --
// simplest well-supported geometry layout, matching this repo's own existing offline test
// convention (test/geometry/activeRangeCompaction.test.mjs).
function fakeGeometryProxy(positionsArray, indexArray) {
  return {
    geometry: {
      attributes: { position: { array: new Float32Array(positionsArray), itemSize: 3 } },
      index: indexArray ? { array: new Uint32Array(indexArray) } : undefined,
    },
  };
}

// A small, valid, weldable-with-nothing-to-weld triangle (three distinct vertices).
const VALID_TRIANGLE_POSITIONS = [0, 0, 0, 10, 0, 0, 0, 10, 0];
const VALID_TRIANGLE_INDEX = [0, 1, 2];

test('observeF4: a fully healthy census -- one geometry, render proxy/adapter/weld all succeed', async () => {
  const session = buildF4Session([fakePopulationRecord(0, 1)]);
  const realm = createPageRealm({
    __g1: { sessions: { s1: session }, mod: fakeF4Mod() },
    __viewer: { impl: { getRenderProxy: () => fakeGeometryProxy(VALID_TRIANGLE_POSITIONS, VALID_TRIANGLE_INDEX) } },
  });

  const result = await realm.call(observeF4, 's1');

  assert.equal(result.ok, true);
  assert.equal(result.fields.distinctGeometryCount, 1);
  assert.equal(result.fields.renderProxyFailures, 0);
  assert.equal(result.fields.geometryAdapterFailures, 0);
  assert.equal(result.fields.weldConsumerFailures, 0);
  assert.equal(result.fields.weldConsumerSuccessCount, 1);
  assert.equal(result.fields.geometriesWithNullIndex, 0);
  assert.equal(result.fields.oversizedGeometryCount, 0);
  assert.equal(scoreF4(result.fields).verdict, CHECK_VERDICT.PASS);

  // F7 reuse artifacts.
  const g = realm.window.__g1;
  const session2 = g.sessions.s1;
  assert.equal(Object.prototype.toString.call(session2.artifacts.f4Geometry), '[object Map]');
  assert.equal(session2.artifacts.f4Geometry.size, 1);
  const snapshot = session2.artifacts.f4Geometry.get(1);
  assert.equal(snapshot.unsupported, false);
  assert.equal(snapshot.activeTriangleCount, 1);
  assert.equal(session2.artifacts.f4FragmentGeometryId.get(0), 1);
  assert.deepEqual(session2.artifacts.f4WorldMatricesByFragId.get(0), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
});

test('observeF4: many fragments sharing ONE geometry id -> distinctGeometryCount stays 1, getRenderProxy called once', async () => {
  let getRenderProxyCalls = 0;
  const session = buildF4Session([
    fakePopulationRecord(0, 1),
    fakePopulationRecord(1, 1),
    fakePopulationRecord(2, 1),
  ]);
  const realm = createPageRealm({
    __g1: { sessions: { s1: session }, mod: fakeF4Mod() },
    __viewer: { impl: { getRenderProxy: () => { getRenderProxyCalls += 1; return fakeGeometryProxy(VALID_TRIANGLE_POSITIONS, VALID_TRIANGLE_INDEX); } } },
  });

  const result = await realm.call(observeF4, 's1');

  assert.equal(result.fields.distinctGeometryCount, 1);
  assert.equal(getRenderProxyCalls, 1, 'only one representative fragment per distinct geometry id is ever proxied');
});

test('observeF4: getRenderProxy throws -> renderProxyFailures, FAIL', async () => {
  const session = buildF4Session([fakePopulationRecord(0, 1)]);
  const realm = createPageRealm({
    __g1: { sessions: { s1: session }, mod: fakeF4Mod() },
    __viewer: { impl: { getRenderProxy: () => { throw new Error('getRenderProxy failed'); } } },
  });
  const result = await realm.call(observeF4, 's1');
  assert.equal(result.fields.renderProxyFailures, 1);
  assert.equal(scoreF4(result.fields).verdict, CHECK_VERDICT.FAIL);
});

test('observeF4: adaptViewerGeometry returns unsupported:true -> geometryAdapterFailures, FAIL', async () => {
  const session = buildF4Session([fakePopulationRecord(0, 1)]);
  const realm = createPageRealm({
    __g1: { sessions: { s1: session }, mod: fakeF4Mod() },
    // offsets-shaped layout is explicitly rejected by the REAL adaptViewerGeometry.
    __viewer: { impl: { getRenderProxy: () => ({ geometry: { offsets: [{ start: 0, count: 3, index: 0 }] } }) } },
  });
  const result = await realm.call(observeF4, 's1');
  assert.equal(result.fields.geometryAdapterFailures, 1);
  assert.equal(scoreF4(result.fields).verdict, CHECK_VERDICT.FAIL);
});

test('observeF4: a null index on an otherwise unsupported:false result is a PASS for that geometry, never a failure', async () => {
  const session = buildF4Session([fakePopulationRecord(0, 1)]);
  const realm = createPageRealm({
    __g1: { sessions: { s1: session }, mod: fakeF4Mod() },
    __viewer: { impl: { getRenderProxy: () => fakeGeometryProxy(VALID_TRIANGLE_POSITIONS, null) } }, // non-indexed
  });
  const result = await realm.call(observeF4, 's1');
  assert.equal(result.fields.geometriesWithNullIndex, 1);
  assert.equal(result.fields.geometryAdapterFailures, 0);
  assert.equal(result.fields.weldConsumerFailures, 0);
  assert.equal(scoreF4(result.fields).verdict, CHECK_VERDICT.PASS, 'a null index must never fail F4');
});

test('observeF4: compactAndWeld index-references-invalid-vertex -> weldConsumerFailures, FAIL (real production function, no fake)', async () => {
  const session = buildF4Session([fakePopulationRecord(0, 1)]);
  const realm = createPageRealm({
    __g1: { sessions: { s1: session }, mod: fakeF4Mod() },
    __viewer: { impl: { getRenderProxy: () => fakeGeometryProxy(VALID_TRIANGLE_POSITIONS, [0, 1, 99]) } }, // 99 out of range
  });
  const result = await realm.call(observeF4, 's1');
  assert.equal(result.fields.weldConsumerFailures, 1);
  assert.equal(result.first20WeldConsumerFailures[0].reason, 'index-references-invalid-vertex');
  assert.equal(scoreF4(result.fields).verdict, CHECK_VERDICT.FAIL);
});

test('observeF4: geometry-too-large-for-sync-build is informational only, never an F4 failure', async () => {
  // A triangleCount well above maxSyncTriangleCount (12_000), non-indexed so the streaming
  // vertex count matches the range directly.
  const bigCount = 12_001 * 3;
  const positions = new Float32Array(bigCount * 3);
  for (let i = 0; i < bigCount; i += 1) { positions[i * 3] = i; positions[i * 3 + 1] = 0; positions[i * 3 + 2] = 0; }
  const session = buildF4Session([fakePopulationRecord(0, 1)]);
  const realm = createPageRealm({
    __g1: { sessions: { s1: session }, mod: fakeF4Mod() },
    __viewer: {
      impl: {
        getRenderProxy: () => ({
          geometry: { attributes: { position: { array: positions, itemSize: 3 } } }, // non-indexed
        }),
      },
    },
  });
  const result = await realm.call(observeF4, 's1');
  assert.equal(result.fields.oversizedGeometryCount, 1);
  assert.equal(result.fields.weldConsumerFailures, 0, 'oversized-for-sync-build must never be counted as a weld-consumer failure');
  assert.equal(scoreF4(result.fields).verdict, CHECK_VERDICT.PASS, 'F4 itself must never fail on an oversized-for-sync-build geometry -- that is F5\'s own finding');
});

test('observeF4: refuses to run before F1 has populated f1PopulationRecords', async () => {
  const realm = createPageRealm({ __g1: { sessions: { s1: { model: {}, artifacts: {} } }, mod: fakeF4Mod() }, __viewer: {} });
  const result = await realm.call(observeF4, 's1');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'f1-population-records-not-available-run-observeF1-first');
});

// -- F4's ownership-metadata observation (fix round 1, Stage 5 review: plan §7.4 line 946 --
// "additionally record whether getGeometryId returns a usable id for every fragment in the
// tested population (no undefined/throw)") --

test('observeF4: a fragment with a usable geometry id contributes zero to libraryThrew/droppedDiagnosticsCount/libOwnerDiffersFromFragList', async () => {
  const session = buildF4Session([fakePopulationRecord(0, 1)]); // default fragList agrees with the record
  const realm = createPageRealm({
    __g1: { sessions: { s1: session }, mod: fakeF4Mod() },
    __viewer: { impl: { getRenderProxy: () => fakeGeometryProxy(VALID_TRIANGLE_POSITIONS, VALID_TRIANGLE_INDEX) } },
  });

  const result = await realm.call(observeF4, 's1');

  assert.equal(result.fields.libraryThrew, 0);
  assert.equal(result.fields.libOwnerDiffersFromFragList, 0);
  // droppedDiagnosticsCount was built by code running INSIDE the vm realm -- a cross-realm
  // plain object (same issue documented elsewhere in this file) -- compare fields individually.
  assert.equal(result.fields.droppedDiagnosticsCount['geometry-id-undefined'], 0);
  assert.equal(result.fields.droppedDiagnosticsCount['geometry-id-threw'], 0);
  assert.equal(scoreF4(result.fields).verdict, CHECK_VERDICT.PASS);
});

test('observeF4: getGeometryId THROWING for a fragment -- libraryThrew reflects it, droppedDiagnosticsCount[\'geometry-id-threw\'] increments, fragment excluded from the census, FAIL', async () => {
  const session = buildF4Session([fakePopulationRecord(0, 1), fakePopulationRecord(1, 1)], {
    getGeometryId: (fragId) => { if (fragId === 0) throw new Error('getGeometryId blew up'); return 1; },
  });
  let getRenderProxyCalls = 0;
  const realm = createPageRealm({
    __g1: { sessions: { s1: session }, mod: fakeF4Mod() },
    __viewer: { impl: { getRenderProxy: () => { getRenderProxyCalls += 1; return fakeGeometryProxy(VALID_TRIANGLE_POSITIONS, VALID_TRIANGLE_INDEX); } } },
  });

  const result = await realm.call(observeF4, 's1');

  assert.equal(result.fields.libraryThrew, 1);
  assert.equal(result.fields.droppedDiagnosticsCount['geometry-id-threw'], 1);
  assert.equal(result.fields.droppedDiagnosticsCount['geometry-id-undefined'], 0);
  // Fragment 0's failure never prevents fragment 1 (same geometry id, still usable) from being
  // censused -- this is F4's own observation running per-fragment, not aborting the whole pass.
  assert.equal(getRenderProxyCalls, 1);
  assert.equal(scoreF4(result.fields).verdict, CHECK_VERDICT.FAIL);
  assert.equal(scoreF4(result.fields).reason, 'f4-ownership-metadata-failure');
});

test('observeF4: getGeometryId returning undefined (unusable, no throw) -- droppedDiagnosticsCount[\'geometry-id-undefined\'] increments, never silently skipped, FAIL', async () => {
  const session = buildF4Session([fakePopulationRecord(0, 1)], {
    getGeometryId: () => undefined,
  });
  const realm = createPageRealm({
    __g1: { sessions: { s1: session }, mod: fakeF4Mod() },
    __viewer: { impl: { getRenderProxy: () => fakeGeometryProxy(VALID_TRIANGLE_POSITIONS, VALID_TRIANGLE_INDEX) } },
  });

  const result = await realm.call(observeF4, 's1');

  assert.equal(result.fields.libraryThrew, 0, 'undefined without a throw must never be counted as a throw');
  assert.equal(result.fields.droppedDiagnosticsCount['geometry-id-undefined'], 1);
  assert.equal(result.fields.distinctGeometryCount, 0, 'the fragment is excluded from the census, not silently included with an undefined id');
  assert.equal(scoreF4(result.fields).verdict, CHECK_VERDICT.FAIL);
  assert.equal(scoreF4(result.fields).reason, 'f4-ownership-metadata-failure');
});

test('observeF4: libOwnerDiffersFromFragList increments when a fresh fragList.getDbIds() disagrees with F1\'s already-cached ownerDbId, FAIL', async () => {
  const session = buildF4Session([fakePopulationRecord(0, 1, { ownerDbId: 100 })], {
    getDbIds: () => 999, // disagrees with the cached record's ownerDbId (100)
  });
  const realm = createPageRealm({
    __g1: { sessions: { s1: session }, mod: fakeF4Mod() },
    __viewer: { impl: { getRenderProxy: () => fakeGeometryProxy(VALID_TRIANGLE_POSITIONS, VALID_TRIANGLE_INDEX) } },
  });

  const result = await realm.call(observeF4, 's1');

  assert.equal(result.fields.libOwnerDiffersFromFragList, 1);
  // A disagreeing owner does not itself make the geometry id unusable -- the fragment is still
  // censused (this mirrors T3's own libOwnerDiffersFromFragList convention: a distinct,
  // independently-reported metric, not a census-exclusion condition).
  assert.equal(result.fields.distinctGeometryCount, 1);
  assert.equal(scoreF4(result.fields).verdict, CHECK_VERDICT.FAIL);
  assert.equal(scoreF4(result.fields).reason, 'f4-ownership-metadata-failure');
});

test('scoreF4: the ownership-metadata half alone (zero render-proxy/adapter/weld failures) still fails F4', () => {
  const result = scoreF4({
    libraryThrew: 1, libOwnerDiffersFromFragList: 0, droppedDiagnosticsCount: { 'geometry-id-undefined': 0, 'geometry-id-threw': 1 },
    distinctGeometryCount: 0, renderProxyFailures: 0, geometryAdapterFailures: 0, geometriesWithNullIndex: 0,
    weldConsumerFailures: 0, weldConsumerSuccessCount: 0, maxActiveTriangleCount: 0, oversizedGeometryCount: 0,
  });
  assert.equal(result.verdict, CHECK_VERDICT.FAIL);
  assert.equal(result.reason, 'f4-ownership-metadata-failure');
});

// -- classifyWeldResult (Node-side, shared by scoreF4's own evidence and the control) --

test('classifyWeldResult: classifies all documented outcomes correctly', () => {
  assert.equal(classifyWeldResult({ oversized: true, reason: 'geometry-too-large-for-sync-build' }).outcome, 'oversized-informational');
  assert.equal(classifyWeldResult({ oversized: true, reason: 'index-references-invalid-vertex' }).outcome, 'index-references-invalid-vertex');
  assert.equal(classifyWeldResult({ position: new Float32Array([1, 2, 3]), index: new Uint32Array([0]), triangleCount: 1 }).outcome, 'success');
  assert.equal(classifyWeldResult({ position: new Float32Array([1, NaN, 3]), index: new Uint32Array([0]), triangleCount: 1 }).outcome, 'non-finite-position');
  assert.equal(classifyWeldResult(null).outcome, 'threw');
});

// ============================================================================================
// F5 -- existing limits under SVF2
// ============================================================================================

test('deriveOrganicBreach: CapacityExceededError reads limit/requested directly', () => {
  const err = { name: 'CapacityExceededError', limit: 20000, requested: 25000 };
  const breach = deriveOrganicBreach(err);
  assert.deepEqual(breach, { limit: 20000, requested: 25000 });
});

test('deriveOrganicBreach: EnumerationBoundExceededError(maxFragmentsPerDbId) maps detail.tally to requested', () => {
  const err = { name: 'EnumerationBoundExceededError', bound: 'maxFragmentsPerDbId', detail: { dbId: 7, tally: 6000 } };
  const breach = deriveOrganicBreach(err);
  assert.equal(breach.requested, 6000);
  assert.equal(typeof breach.limit, 'number');
});

test('deriveOrganicBreach: EnumerationBoundExceededError(maxChildrenPerNode) maps detail.count to requested', () => {
  const err = { name: 'EnumerationBoundExceededError', bound: 'maxChildrenPerNode', detail: { dbId: 7, root: 1, count: 11000 } };
  const breach = deriveOrganicBreach(err);
  assert.equal(breach.requested, 11000);
  assert.equal(typeof breach.limit, 'number');
});

test('deriveOrganicBreach: an unrecognized error name returns null', () => {
  assert.equal(deriveOrganicBreach({ name: 'SomeOtherError' }), null);
  assert.equal(deriveOrganicBreach(null), null);
});

test('scoreF5: F1 succeeded, F2 balanced, F4 no oversized geometry -> PASS', () => {
  const result = scoreF5({
    f1Result: { ok: true, fields: { maxRootFragmentCount: 5, sumRootFragmentCount: 10, maxPerDbIdFragmentCount: 3, populationCount: 20 } },
    f2Fields: { accountingBalanced: true, maxChildrenPerNode: 4 },
    f4Fields: { maxActiveTriangleCount: 100, oversizedGeometryCount: 0 },
  });
  assert.equal(result.verdict, CHECK_VERDICT.PASS);
  assert.equal(result.fields.withinLimits, true);
  assert.equal(result.fields.enforcementObserved, false);
});

test('scoreF5: F1 succeeded but F2 did not balance -> FAIL, reason not-fully-enumerated', () => {
  const result = scoreF5({
    f1Result: { ok: true, fields: { populationCount: 20, maxRootFragmentCount: 2, maxPerDbIdFragmentCount: 2 } },
    f2Fields: { accountingBalanced: false },
    f4Fields: { maxActiveTriangleCount: 10, oversizedGeometryCount: 0 },
  });
  assert.equal(result.verdict, CHECK_VERDICT.FAIL);
  assert.equal(result.reason, 'not-fully-enumerated');
});

test('scoreF5: F1 succeeded, F2 balanced, but F4 reports an oversized geometry -> FAIL, reason oversized-geometry-present', () => {
  const result = scoreF5({
    f1Result: { ok: true, fields: { populationCount: 20, maxRootFragmentCount: 2, maxPerDbIdFragmentCount: 2 } },
    f2Fields: { accountingBalanced: true, maxChildrenPerNode: 3 },
    f4Fields: { maxActiveTriangleCount: 10, oversizedGeometryCount: 1 },
  });
  assert.equal(result.verdict, CHECK_VERDICT.FAIL);
  assert.equal(result.reason, 'oversized-geometry-present');
});

test('scoreF5: F1 failed with a typed CapacityExceededError -> FAIL, never PASS, even though enforcement fired correctly', () => {
  const result = scoreF5({
    f1Result: { ok: false, error: { name: 'CapacityExceededError', limit: 20000, requested: 25000 } },
  });
  assert.equal(result.verdict, CHECK_VERDICT.FAIL);
  assert.equal(result.fields.withinLimits, false);
  assert.equal(result.fields.enforcementObserved, true, 'enforcement firing is recorded, but never lets this become PASS');
  assert.deepEqual(result.fields.organicBreach, { limit: 20000, requested: 25000 });
});

test('scoreF5: F1 failed with a typed EnumerationBoundExceededError -> FAIL, enforcementObserved true', () => {
  const result = scoreF5({
    f1Result: { ok: false, error: { name: 'EnumerationBoundExceededError', bound: 'maxFragmentsPerDbId', detail: { tally: 6000 } } },
  });
  assert.equal(result.verdict, CHECK_VERDICT.FAIL);
  assert.equal(result.fields.enforcementObserved, true);
});

test('scoreF5: F1 failed with a non-capacity error -> BLOCKED, reason F1-failed-non-capacity', () => {
  const result = scoreF5({
    f1Result: { ok: false, error: { name: 'TypeError', message: 'boom' } },
  });
  assert.equal(result.verdict, CHECK_VERDICT.BLOCKED);
  assert.equal(result.reason, 'F1-failed-non-capacity');
  assert.equal(result.fields.enforcementObserved, false);
});

// ============================================================================================
// invalid-geometry-consumer / capacity-breach controls
// ============================================================================================

test('CONTROL_RESTORATION_REQUIRED cross-check: invalid-geometry-consumer is false, capacity-breach is true (plan lines 846, 851)', () => {
  assert.equal(CONTROL_RESTORATION_REQUIRED['invalid-geometry-consumer'], false);
  assert.equal(CONTROL_RESTORATION_REQUIRED['capacity-breach'], true);
});

test('jsonDeepEqual: structural equality regardless of key order', () => {
  assert.equal(jsonDeepEqual({ a: 1, b: 2 }, { b: 2, a: 1 }), true);
  assert.equal(jsonDeepEqual({ a: 1 }, { a: 2 }), false);
});

test('invalid-geometry-consumer control: DETECTED_RESTORED -- both synthetic cases correctly rejected, checks.F4 unchanged (uses the REAL compactAndWeld, no fake)', async () => {
  const f4Snapshot = { verdict: 'PASS', fields: { weldConsumerFailures: 0 } };
  const result = await runInvalidGeometryConsumerControl({
    f4SnapshotBefore: f4Snapshot,
    readCurrentF4: async () => ({ verdict: 'PASS', fields: { weldConsumerFailures: 0 } }), // structurally identical, fresh object
  });
  assert.equal(result.state, CONTROL_STATE.DETECTED_RESTORED);
  assert.equal(result.restorationRequired, false);
});

test('invalid-geometry-consumer control: RESTORE_FAILED -- checks.F4 diverged from its snapshot (leakage)', async () => {
  const result = await runInvalidGeometryConsumerControl({
    f4SnapshotBefore: { verdict: 'PASS' },
    readCurrentF4: async () => ({ verdict: 'FAIL' }), // leaked/mutated
  });
  assert.equal(result.state, CONTROL_STATE.RESTORE_FAILED);
});

test('invalid-geometry-consumer control: NOT_EXECUTABLE -- no readCurrentF4 dependency', async () => {
  const result = await runInvalidGeometryConsumerControl({ f4SnapshotBefore: {} });
  assert.equal(result.state, CONTROL_STATE.NOT_EXECUTABLE);
});

test('invalid-geometry-consumer control: TIMED_OUT -- the synthetic compactAndWeld pass does not settle inside the deadline', async () => {
  // withControlTimeout races an already-started synchronous IIFE against the timeout; to
  // reliably trigger TIMED_OUT here we pass an absurdly small timeout instead of trying to
  // make compactAndWeld itself hang (it never does -- it's synchronous).
  const result = await runInvalidGeometryConsumerControl({
    f4SnapshotBefore: {},
    readCurrentF4: async () => ({}),
    controlTimeoutMs: -1,
  });
  // A negative timeout fires the timer on the very next tick, racing the synchronous work --
  // assert it resolves to one of the two legitimate terminal outcomes for this race, never an
  // exception escaping the control itself.
  assert.ok([CONTROL_STATE.TIMED_OUT, CONTROL_STATE.DETECTED_RESTORED].includes(result.state));
});

function fakeModelForCapacityControl() {
  return { fragList: { getCount: () => 100 } };
}

test('capacity-breach control: DETECTED_RESTORED -- getCount patched over the limit, enforcement observed', async () => {
  const model = fakeModelForCapacityControl();
  const result = await runCapacityBreachControl({
    modelBefore: model, world: { isModelLive: () => true }, registry: { bindingFor: () => ({ model }) }, registryKey: 'K',
    checkCapacity: async (m) => ({ capacityExceededDetected: m.fragList.getCount() > 20000 }),
  });
  assert.equal(result.state, CONTROL_STATE.DETECTED_RESTORED);
  assert.equal(result.restorationRequired, true);
  assert.equal(model.fragList.getCount(), 100, 'restored to the original after the control');
});

test('capacity-breach control: NOT_DETECTED -- enforcement never fires', async () => {
  const model = fakeModelForCapacityControl();
  const result = await runCapacityBreachControl({
    modelBefore: model, world: { isModelLive: () => true }, registry: { bindingFor: () => ({ model }) }, registryKey: 'K',
    checkCapacity: async () => ({ capacityExceededDetected: false }),
  });
  assert.equal(result.state, CONTROL_STATE.NOT_DETECTED);
});

test('capacity-breach control: RESTORE_FAILED -- detected, but post-restoration liveness check fails', async () => {
  const model = fakeModelForCapacityControl();
  const result = await runCapacityBreachControl({
    modelBefore: model, world: { isModelLive: () => false }, registry: { bindingFor: () => ({ model }) }, registryKey: 'K',
    checkCapacity: async () => ({ capacityExceededDetected: true }),
  });
  assert.equal(result.state, CONTROL_STATE.RESTORE_FAILED);
});

test('capacity-breach control: TIMED_OUT', async () => {
  const model = fakeModelForCapacityControl();
  const result = await runCapacityBreachControl({
    modelBefore: model, world: { isModelLive: () => true }, registry: { bindingFor: () => ({ model }) }, registryKey: 'K',
    checkCapacity: () => new Promise(() => {}),
    controlTimeoutMs: 20,
  });
  assert.equal(result.state, CONTROL_STATE.TIMED_OUT);
});

test('capacity-breach control: NOT_EXECUTABLE -- no modelBefore', async () => {
  const result = await runCapacityBreachControl({ modelBefore: null, checkCapacity: async () => ({ capacityExceededDetected: true }) });
  assert.equal(result.state, CONTROL_STATE.NOT_EXECUTABLE);
});

test('capacity-breach control: restorationRequired cross-checked against Stage 1\'s own constant', async () => {
  const model = fakeModelForCapacityControl();
  const result = await runCapacityBreachControl({
    modelBefore: model, world: { isModelLive: () => true }, registry: { bindingFor: () => ({ model }) }, registryKey: 'K',
    checkCapacity: async () => ({ capacityExceededDetected: true }),
  });
  assert.equal(result.restorationRequired, CONTROL_RESTORATION_REQUIRED['capacity-breach']);
});

// ============================================================================================
// Stage 6 -- F7 (observeF7/scoreF7), selectBoundsBeyondToleranceTarget, and its two controls
// (invalid-bounds, bounds-beyond-tolerance). `observeF7` is in-page (added to IN_PAGE_FUNCTIONS
// above) and uses the REAL `createViewerApi` from clashpanel/viewer/viewerApi.js (never a fake
// for it -- same "reuse the real production function" convention F1/F4 already established for
// extractFragments/adaptViewerGeometry/compactAndWeld), wired into window.__g1.mod exactly like
// those. `scoreF7`, `selectBoundsBeyondToleranceTarget`, and both controls are pure/plain
// Node-side functions (never touch `window`), so their own tests need no vm page-realm at all --
// mirroring how runCapacityBreachControl's own tests use plain fake objects.
// ============================================================================================

function fakeF7Mod() {
  return { '/clashpanel/viewer/viewerApi.js': { createViewerApi } };
}

const FAKE_AUTODESK_EVENTS = { Viewing: { BEFORE_MODEL_UNLOAD_EVENT: 'beforeModelUnload', MODEL_REMOVED_EVENT: 'modelRemoved' } };

const IDENTITY_MATRIX = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function fakeF7Viewer(overrides = {}) {
  return { overlays: {}, getAggregateHiddenNodes: () => [], ...overrides };
}

// One simple non-indexed triangle geometry entry (F4's own frozen per-geometry snapshot shape)
// -- vertices (0,0,0),(10,0,0),(0,10,0), so under an identity world matrix its own local AABB
// and world-space bounds are both exactly [0,0,0,10,10,0].
function triangleGeometryEntry({ activeTriangleCount = 1 } = {}) {
  return {
    unsupported: false,
    positions: new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0]),
    positionStride: 3,
    positionOffset: 0,
    index: null,
    ranges: [{ start: 0, count: 3 }],
    activeTriangleCount,
    representativeFragId: 0,
  };
}

function nodeBoxFiller(box) {
  return (dbId, buffer) => { for (let i = 0; i < 6; i += 1) buffer[i] = box[i]; };
}

function buildF7Session({
  rootFragments, f4Geometry, f4FragmentGeometryId, f4WorldMatricesByFragId, getNodeBoxImpl,
  getUnitScale = () => 1, getUnitString = () => null,
  getGlobalOffset = () => [0, 0, 0], getPlacementTransform = () => null,
} = {}) {
  const model = {
    getUnitScale,
    getUnitString,
    getGlobalOffset,
    getPlacementTransform,
    getFragmentList: () => ({}),
    getObjectTree: () => ({ getNodeBox: getNodeBoxImpl }),
  };
  return {
    model,
    artifacts: { f1FragmentMapsByRoot: rootFragments, f4Geometry, f4FragmentGeometryId, f4WorldMatricesByFragId },
  };
}

// Cross-realm gotcha (documented elsewhere in this file, Stage 5's fix round): any array/object
// LITERAL constructed inside observeF7's own source text (reconstructed via vm.runInContext,
// per this file's own createPageRealm) carries that vm realm's own Array/Object prototype, so
// this file's strict `assert.deepEqual` spuriously fails on an otherwise-identical value even
// though every element/field matches (e.g. censusedDbIds, fragmentBoundsUnion[dbId],
// conservativeEnvelopeUnion[dbId], boundsToleranceConstants, modelPlacementTransform, every
// skippedFragments[dbId] entry). A value returned by a REAL, already-imported Node-realm
// function called FROM INSIDE observeF7 (e.g. viewerApi.js's own `Array.from(box)` inside
// getElementWorldBounds) keeps that function's OWN closure realm and is unaffected, but these
// two helpers are used uniformly below rather than tracking that distinction per field.
function assertArrEq(actual, expected, message) {
  assert.equal(actual.length, expected.length, message);
  for (let i = 0; i < expected.length; i += 1) assert.equal(actual[i], expected[i], message);
}
function assertObjEq(actual, expected, message) {
  assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), message);
  for (const k of Object.keys(expected)) assert.equal(actual[k], expected[k], `${message || ''} key=${k}`);
}

test('observeF7: session-not-found', async () => {
  const realm = createPageRealm({ __g1: { sessions: {}, mod: fakeF7Mod() }, __viewer: fakeF7Viewer(), Autodesk: FAKE_AUTODESK_EVENTS });
  const result = await realm.call(observeF7, 'missing');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'session-not-found');
});

test('observeF7: refuses to run before F1 has populated f1FragmentMapsByRoot', async () => {
  const realm = createPageRealm({
    __g1: { sessions: { s1: { model: {}, artifacts: {} } }, mod: fakeF7Mod() },
    __viewer: fakeF7Viewer(),
    Autodesk: FAKE_AUTODESK_EVENTS,
  });
  const result = await realm.call(observeF7, 's1');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'f1-fragment-maps-by-root-not-available-run-observeF1-first');
});

test('observeF7: refuses to run before F4 has populated its retained artifacts', async () => {
  const realm = createPageRealm({
    __g1: { sessions: { s1: { model: {}, artifacts: { f1FragmentMapsByRoot: new Map() } } }, mod: fakeF7Mod() },
    __viewer: fakeF7Viewer(),
    Autodesk: FAKE_AUTODESK_EVENTS,
  });
  const result = await realm.call(observeF7, 's1');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'f4-artifacts-not-available-run-observeF4-first');
});

test('observeF7: single dbId, single healthy fragment, node box exactly matches the independent computation -> agrees', async () => {
  const rootFragments = new Map([[100, new Map([[0, {}]])]]);
  const f4Geometry = new Map([[1, triangleGeometryEntry()]]);
  const f4FragmentGeometryId = new Map([[0, 1]]);
  const f4WorldMatricesByFragId = new Map([[0, IDENTITY_MATRIX]]);
  const session = buildF7Session({ rootFragments, f4Geometry, f4FragmentGeometryId, f4WorldMatricesByFragId, getNodeBoxImpl: nodeBoxFiller([0, 0, 0, 10, 10, 0]) });
  const realm = createPageRealm({ __g1: { sessions: { s1: session }, mod: fakeF7Mod() }, __viewer: fakeF7Viewer(), Autodesk: FAKE_AUTODESK_EVENTS });

  const result = await realm.call(observeF7, 's1');

  assert.equal(result.ok, true);
  assertArrEq(result.fields.censusedDbIds, [100]);
  assert.equal(result.fields.censusCount, 1);
  assert.equal(result.fields.boundsAgreement[100], 'agrees');
  assertArrEq(result.fields.elementWorldBounds[100], [0, 0, 0, 10, 10, 0]);
  assertArrEq(result.fields.fragmentBoundsUnion[100], [0, 0, 0, 10, 10, 0]);
  assertArrEq(result.fields.conservativeEnvelopeUnion[100], [0, 0, 0, 10, 10, 0]);
  assert.equal(result.fields.skippedFragments[100].length, 0);
  assert.equal(result.fields.placementIsIdentity, true);
  assertObjEq(result.fields.boundsToleranceConstants, F7_TOLERANCE_CONSTANTS);
  assert.equal(scoreF7(result.fields).verdict, CHECK_VERDICT.PASS);
});

test('observeF7: censusedDbIds is the sorted list of F1 root dbIds (f1FragmentMapsByRoot keys)', async () => {
  const rootFragments = new Map([[300, new Map([[2, {}]])], [100, new Map([[0, {}]])], [200, new Map([[1, {}]])]]);
  const f4Geometry = new Map([[1, triangleGeometryEntry()]]);
  const f4FragmentGeometryId = new Map([[0, 1], [1, 1], [2, 1]]);
  const f4WorldMatricesByFragId = new Map([[0, IDENTITY_MATRIX], [1, IDENTITY_MATRIX], [2, IDENTITY_MATRIX]]);
  const session = buildF7Session({ rootFragments, f4Geometry, f4FragmentGeometryId, f4WorldMatricesByFragId, getNodeBoxImpl: nodeBoxFiller([0, 0, 0, 10, 10, 0]) });
  const realm = createPageRealm({ __g1: { sessions: { s1: session }, mod: fakeF7Mod() }, __viewer: fakeF7Viewer(), Autodesk: FAKE_AUTODESK_EVENTS });

  const result = await realm.call(observeF7, 's1');

  assertArrEq(result.fields.censusedDbIds, [100, 200, 300]);
  assert.equal(result.fields.censusCount, 3);
});

test('observeF7: node box misses containment by more than T_gross -> disagrees, F7 FAIL', async () => {
  const rootFragments = new Map([[100, new Map([[0, {}]])]]);
  const f4Geometry = new Map([[1, triangleGeometryEntry()]]);
  const f4FragmentGeometryId = new Map([[0, 1]]);
  const f4WorldMatricesByFragId = new Map([[0, IDENTITY_MATRIX]]);
  const session = buildF7Session({ rootFragments, f4Geometry, f4FragmentGeometryId, f4WorldMatricesByFragId, getNodeBoxImpl: nodeBoxFiller([1, 0, 0, 10, 10, 0]) });
  const realm = createPageRealm({ __g1: { sessions: { s1: session }, mod: fakeF7Mod() }, __viewer: fakeF7Viewer(), Autodesk: FAKE_AUTODESK_EVENTS });

  const result = await realm.call(observeF7, 's1');

  assert.equal(result.fields.boundsAgreement[100], 'disagrees');
  assert.equal(scoreF7(result.fields).verdict, CHECK_VERDICT.FAIL);
  assert.equal(scoreF7(result.fields).reason, 'f7-bounds-disagrees');
});

test('observeF7: node box misses containment by a residual inside (T_pass, T_gross] -> near-tolerance, F7 NOT_EVIDENCED', async () => {
  const rootFragments = new Map([[100, new Map([[0, {}]])]]);
  const f4Geometry = new Map([[1, triangleGeometryEntry()]]);
  const f4FragmentGeometryId = new Map([[0, 1]]);
  const f4WorldMatricesByFragId = new Map([[0, IDENTITY_MATRIX]]);
  const session = buildF7Session({ rootFragments, f4Geometry, f4FragmentGeometryId, f4WorldMatricesByFragId, getNodeBoxImpl: nodeBoxFiller([2 ** -10, 0, 0, 10, 10, 0]) });
  const realm = createPageRealm({ __g1: { sessions: { s1: session }, mod: fakeF7Mod() }, __viewer: fakeF7Viewer(), Autodesk: FAKE_AUTODESK_EVENTS });

  const result = await realm.call(observeF7, 's1');

  assert.equal(result.fields.boundsAgreement[100], 'near-tolerance');
  assert.equal(scoreF7(result.fields).verdict, CHECK_VERDICT.NOT_EVIDENCED);
});

test('observeF7: containment holds but node box exceeds the conservative envelope beyond T_pass -> exceeds-envelope, F7 NOT_EVIDENCED', async () => {
  const rootFragments = new Map([[100, new Map([[0, {}]])]]);
  const f4Geometry = new Map([[1, triangleGeometryEntry()]]);
  const f4FragmentGeometryId = new Map([[0, 1]]);
  const f4WorldMatricesByFragId = new Map([[0, IDENTITY_MATRIX]]);
  const session = buildF7Session({ rootFragments, f4Geometry, f4FragmentGeometryId, f4WorldMatricesByFragId, getNodeBoxImpl: nodeBoxFiller([0, 0, 0, 10 + 2 ** -10, 10, 0]) });
  const realm = createPageRealm({ __g1: { sessions: { s1: session }, mod: fakeF7Mod() }, __viewer: fakeF7Viewer(), Autodesk: FAKE_AUTODESK_EVENTS });

  const result = await realm.call(observeF7, 's1');

  assert.equal(result.fields.boundsAgreement[100], 'exceeds-envelope');
  assert.equal(scoreF7(result.fields).verdict, CHECK_VERDICT.NOT_EVIDENCED);
});

test('observeF7: getElementWorldBounds returning null (via the non-finite-box guard) for a dbId with valid reference geometry -> viewerApiNull, F7 FAIL', async () => {
  const rootFragments = new Map([[100, new Map([[0, {}]])]]);
  const f4Geometry = new Map([[1, triangleGeometryEntry()]]);
  const f4FragmentGeometryId = new Map([[0, 1]]);
  const f4WorldMatricesByFragId = new Map([[0, IDENTITY_MATRIX]]);
  const session = buildF7Session({ rootFragments, f4Geometry, f4FragmentGeometryId, f4WorldMatricesByFragId, getNodeBoxImpl: () => {} });
  const realm = createPageRealm({ __g1: { sessions: { s1: session }, mod: fakeF7Mod() }, __viewer: fakeF7Viewer(), Autodesk: FAKE_AUTODESK_EVENTS });

  const result = await realm.call(observeF7, 's1');

  assert.equal(result.fields.elementWorldBounds[100], null);
  assert.equal(result.fields.boundsAgreement[100], 'viewerApiNull');
  assert.equal(scoreF7(result.fields).verdict, CHECK_VERDICT.FAIL);
  assert.equal(scoreF7(result.fields).reason, 'f7-viewer-api-returned-null-for-valid-geometry');
});

test('observeF7: a fragment with no f4FragmentGeometryId mapping is skipped (unsupported/missing-fragment-geometry-mapping), marks envelope-incomplete', async () => {
  const rootFragments = new Map([[100, new Map([[0, {}], [1, {}]])]]);
  const f4Geometry = new Map([[1, triangleGeometryEntry()]]);
  const f4FragmentGeometryId = new Map([[0, 1]]); // fragId 1 deliberately missing
  const f4WorldMatricesByFragId = new Map([[0, IDENTITY_MATRIX]]);
  const session = buildF7Session({ rootFragments, f4Geometry, f4FragmentGeometryId, f4WorldMatricesByFragId, getNodeBoxImpl: nodeBoxFiller([0, 0, 0, 10, 10, 0]) });
  const realm = createPageRealm({ __g1: { sessions: { s1: session }, mod: fakeF7Mod() }, __viewer: fakeF7Viewer(), Autodesk: FAKE_AUTODESK_EVENTS });

  const result = await realm.call(observeF7, 's1');

  assert.equal(result.fields.boundsAgreement[100], 'envelope-incomplete');
  assert.equal(result.fields.skippedFragments[100].length, 1);
  assert.equal(result.fields.skippedFragments[100][0].fragmentId, 1);
  assert.equal(result.fields.skippedFragments[100][0].reason, 'unsupported');
  assert.equal(result.fields.skippedFragments[100][0].origin, 'missing-fragment-geometry-mapping');
  assert.equal(scoreF7(result.fields).verdict, CHECK_VERDICT.NOT_EVIDENCED);
});

test('observeF7: a fragment whose geometryId has no f4Geometry snapshot is skipped (unsupported/missing-geometry-snapshot)', async () => {
  const rootFragments = new Map([[100, new Map([[0, {}]])]]);
  const f4Geometry = new Map(); // deliberately empty -- geometryId 1 has no snapshot
  const f4FragmentGeometryId = new Map([[0, 1]]);
  const f4WorldMatricesByFragId = new Map([[0, IDENTITY_MATRIX]]);
  const session = buildF7Session({ rootFragments, f4Geometry, f4FragmentGeometryId, f4WorldMatricesByFragId, getNodeBoxImpl: nodeBoxFiller([0, 0, 0, 10, 10, 0]) });
  const realm = createPageRealm({ __g1: { sessions: { s1: session }, mod: fakeF7Mod() }, __viewer: fakeF7Viewer(), Autodesk: FAKE_AUTODESK_EVENTS });

  const result = await realm.call(observeF7, 's1');

  assert.equal(result.fields.skippedFragments[100][0].origin, 'missing-geometry-snapshot');
  assert.equal(result.fields.boundsAgreement[100], 'no-reference-geometry');
});

test('observeF7: a non-affine world matrix (e[15] !== 1) is skipped (non-affine-world-matrix)', async () => {
  const rootFragments = new Map([[100, new Map([[0, {}]])]]);
  const f4Geometry = new Map([[1, triangleGeometryEntry()]]);
  const f4FragmentGeometryId = new Map([[0, 1]]);
  const badMatrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0]; // e[15] = 0, not 1
  const f4WorldMatricesByFragId = new Map([[0, badMatrix]]);
  const session = buildF7Session({ rootFragments, f4Geometry, f4FragmentGeometryId, f4WorldMatricesByFragId, getNodeBoxImpl: nodeBoxFiller([0, 0, 0, 10, 10, 0]) });
  const realm = createPageRealm({ __g1: { sessions: { s1: session }, mod: fakeF7Mod() }, __viewer: fakeF7Viewer(), Autodesk: FAKE_AUTODESK_EVENTS });

  const result = await realm.call(observeF7, 's1');

  assert.equal(result.fields.skippedFragments[100][0].reason, 'non-affine-world-matrix');
  assert.equal(result.fields.boundsAgreement[100], 'no-reference-geometry');
});

test('observeF7: positions that are neither Float32Array nor Float64Array are skipped (non-float-positions)', async () => {
  const rootFragments = new Map([[100, new Map([[0, {}]])]]);
  const badGeom = { ...triangleGeometryEntry(), positions: [0, 0, 0, 10, 0, 0, 0, 10, 0] }; // plain Array
  const f4Geometry = new Map([[1, badGeom]]);
  const f4FragmentGeometryId = new Map([[0, 1]]);
  const f4WorldMatricesByFragId = new Map([[0, IDENTITY_MATRIX]]);
  const session = buildF7Session({ rootFragments, f4Geometry, f4FragmentGeometryId, f4WorldMatricesByFragId, getNodeBoxImpl: nodeBoxFiller([0, 0, 0, 10, 10, 0]) });
  const realm = createPageRealm({ __g1: { sessions: { s1: session }, mod: fakeF7Mod() }, __viewer: fakeF7Viewer(), Autodesk: FAKE_AUTODESK_EVENTS });

  const result = await realm.call(observeF7, 's1');

  assert.equal(result.fields.skippedFragments[100][0].reason, 'non-float-positions');
});

test('observeF7: activeTriangleCount === 0 excludes the fragment from the tight reference only -- the only fragment -> no-reference-geometry (envelope still populated), F7 PASS', async () => {
  const rootFragments = new Map([[100, new Map([[0, {}]])]]);
  const f4Geometry = new Map([[1, triangleGeometryEntry({ activeTriangleCount: 0 })]]);
  const f4FragmentGeometryId = new Map([[0, 1]]);
  const f4WorldMatricesByFragId = new Map([[0, IDENTITY_MATRIX]]);
  const session = buildF7Session({ rootFragments, f4Geometry, f4FragmentGeometryId, f4WorldMatricesByFragId, getNodeBoxImpl: nodeBoxFiller([0, 0, 0, 10, 10, 0]) });
  const realm = createPageRealm({ __g1: { sessions: { s1: session }, mod: fakeF7Mod() }, __viewer: fakeF7Viewer(), Autodesk: FAKE_AUTODESK_EVENTS });

  const result = await realm.call(observeF7, 's1');

  assert.equal(result.fields.boundsAgreement[100], 'no-reference-geometry');
  assert.equal(result.fields.fragmentBoundsUnion[100], null);
  assertArrEq(result.fields.conservativeEnvelopeUnion[100], [0, 0, 0, 10, 10, 0]);
  assert.equal(result.fields.skippedFragments[100].length, 1);
  assert.equal(result.fields.skippedFragments[100][0].reason, 'no-active-triangles');
  // no-reference-geometry excludes this dbId from comparison entirely -- never counted as
  // agree/disagree (plan step 7) -- so F7 as a whole still PASSes.
  assert.equal(scoreF7(result.fields).verdict, CHECK_VERDICT.PASS);
});

test('observeF7: non-identity placement (pure 2x scale on X) -- the S_a substitution path computes without crashing, agrees when the node box matches', async () => {
  const rootFragments = new Map([[100, new Map([[0, {}]])]]);
  const f4Geometry = new Map([[1, triangleGeometryEntry()]]);
  const f4FragmentGeometryId = new Map([[0, 1]]);
  const scaledMatrix = [2, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const f4WorldMatricesByFragId = new Map([[0, scaledMatrix]]);
  const fakePlacement = { elements: scaledMatrix };
  const session = buildF7Session({
    rootFragments, f4Geometry, f4FragmentGeometryId, f4WorldMatricesByFragId,
    getNodeBoxImpl: nodeBoxFiller([0, 0, 0, 20, 10, 0]),
    getPlacementTransform: () => fakePlacement,
  });
  const realm = createPageRealm({ __g1: { sessions: { s1: session }, mod: fakeF7Mod() }, __viewer: fakeF7Viewer(), Autodesk: FAKE_AUTODESK_EVENTS });

  const result = await realm.call(observeF7, 's1');

  assert.equal(result.fields.placementIsIdentity, false);
  assertArrEq(result.fields.modelPlacementTransform, scaledMatrix);
  assert.equal(result.fields.boundsAgreement[100], 'agrees');
  assert.equal(Number.isFinite(result.fields.boundsScalePerDbId[100].x.S_a), true);
  assert.equal(scoreF7(result.fields).verdict, CHECK_VERDICT.PASS);
});

test('observeF7: getUnitScale throwing -> unitScalePlausible false, F7 FAIL even with a fully agreeing bounds census', async () => {
  const rootFragments = new Map([[100, new Map([[0, {}]])]]);
  const f4Geometry = new Map([[1, triangleGeometryEntry()]]);
  const f4FragmentGeometryId = new Map([[0, 1]]);
  const f4WorldMatricesByFragId = new Map([[0, IDENTITY_MATRIX]]);
  const session = buildF7Session({
    rootFragments, f4Geometry, f4FragmentGeometryId, f4WorldMatricesByFragId,
    getNodeBoxImpl: nodeBoxFiller([0, 0, 0, 10, 10, 0]),
    getUnitScale: () => { throw new Error('boom'); },
  });
  const realm = createPageRealm({ __g1: { sessions: { s1: session }, mod: fakeF7Mod() }, __viewer: fakeF7Viewer(), Autodesk: FAKE_AUTODESK_EVENTS });

  const result = await realm.call(observeF7, 's1');

  assert.equal(result.fields.unitScalePlausible, false);
  assert.equal(result.fields.boundsAgreement[100], 'agrees'); // bounds oracle itself unaffected
  assert.equal(scoreF7(result.fields).verdict, CHECK_VERDICT.FAIL);
  assert.equal(scoreF7(result.fields).reason, 'f7-unit-or-visibility-subcheck-implausible');
});

test('observeF7: getUnitScale() === 1 (the documented "unity if unknown" default) is plausible, never a failure', async () => {
  const rootFragments = new Map([[100, new Map([[0, {}]])]]);
  const f4Geometry = new Map([[1, triangleGeometryEntry()]]);
  const f4FragmentGeometryId = new Map([[0, 1]]);
  const f4WorldMatricesByFragId = new Map([[0, IDENTITY_MATRIX]]);
  const session = buildF7Session({ rootFragments, f4Geometry, f4FragmentGeometryId, f4WorldMatricesByFragId, getNodeBoxImpl: nodeBoxFiller([0, 0, 0, 10, 10, 0]), getUnitScale: () => 1 });
  const realm = createPageRealm({ __g1: { sessions: { s1: session }, mod: fakeF7Mod() }, __viewer: fakeF7Viewer(), Autodesk: FAKE_AUTODESK_EVENTS });

  const result = await realm.call(observeF7, 's1');

  assert.equal(result.fields.unitScalePlausible, true);
  assert.equal(scoreF7(result.fields).verdict, CHECK_VERDICT.PASS);
});

test('observeF7: getUnitString() === null (the documented "null if unknown" default) is plausible', async () => {
  const rootFragments = new Map([[100, new Map([[0, {}]])]]);
  const f4Geometry = new Map([[1, triangleGeometryEntry()]]);
  const f4FragmentGeometryId = new Map([[0, 1]]);
  const f4WorldMatricesByFragId = new Map([[0, IDENTITY_MATRIX]]);
  const session = buildF7Session({ rootFragments, f4Geometry, f4FragmentGeometryId, f4WorldMatricesByFragId, getNodeBoxImpl: nodeBoxFiller([0, 0, 0, 10, 10, 0]), getUnitString: () => null });
  const realm = createPageRealm({ __g1: { sessions: { s1: session }, mod: fakeF7Mod() }, __viewer: fakeF7Viewer(), Autodesk: FAKE_AUTODESK_EVENTS });

  const result = await realm.call(observeF7, 's1');

  assert.equal(result.fields.unitStringPlausible, true);
  assert.equal(scoreF7(result.fields).verdict, CHECK_VERDICT.PASS);
});

test('observeF7: getAggregateHiddenNodes returning a non-array -> hiddenNodesPlausible false, F7 FAIL', async () => {
  const rootFragments = new Map([[100, new Map([[0, {}]])]]);
  const f4Geometry = new Map([[1, triangleGeometryEntry()]]);
  const f4FragmentGeometryId = new Map([[0, 1]]);
  const f4WorldMatricesByFragId = new Map([[0, IDENTITY_MATRIX]]);
  const session = buildF7Session({ rootFragments, f4Geometry, f4FragmentGeometryId, f4WorldMatricesByFragId, getNodeBoxImpl: nodeBoxFiller([0, 0, 0, 10, 10, 0]) });
  const realm = createPageRealm({
    __g1: { sessions: { s1: session }, mod: fakeF7Mod() },
    __viewer: fakeF7Viewer({ getAggregateHiddenNodes: () => 'not-an-array' }),
    Autodesk: FAKE_AUTODESK_EVENTS,
  });

  const result = await realm.call(observeF7, 's1');

  assert.equal(result.fields.hiddenNodesPlausible, false);
  assert.equal(scoreF7(result.fields).verdict, CHECK_VERDICT.FAIL);
});

test('observeF7: a censused dbId appearing in getAggregateHiddenNodes is recorded as hiddenByDefault -- never itself a failure', async () => {
  const rootFragments = new Map([[100, new Map([[0, {}]])]]);
  const f4Geometry = new Map([[1, triangleGeometryEntry()]]);
  const f4FragmentGeometryId = new Map([[0, 1]]);
  const f4WorldMatricesByFragId = new Map([[0, IDENTITY_MATRIX]]);
  const session = buildF7Session({ rootFragments, f4Geometry, f4FragmentGeometryId, f4WorldMatricesByFragId, getNodeBoxImpl: nodeBoxFiller([0, 0, 0, 10, 10, 0]) });
  const { model } = session;
  const realm = createPageRealm({
    __g1: { sessions: { s1: session }, mod: fakeF7Mod() },
    __viewer: fakeF7Viewer({ getAggregateHiddenNodes: () => [{ model, ids: [100] }] }),
    Autodesk: FAKE_AUTODESK_EVENTS,
  });

  const result = await realm.call(observeF7, 's1');

  assert.equal(result.fields.visibilityResults[100].hiddenByDefault, true);
  assert.equal(scoreF7(result.fields).verdict, CHECK_VERDICT.PASS, 'hidden-by-default is never itself a failure');
});

test('observeF7: visibilityBranch characterization -- FragmentList detected via db2ThemingColor, never gates the verdict', async () => {
  const rootFragments = new Map([[100, new Map([[0, {}]])]]);
  const f4Geometry = new Map([[1, triangleGeometryEntry()]]);
  const f4FragmentGeometryId = new Map([[0, 1]]);
  const f4WorldMatricesByFragId = new Map([[0, IDENTITY_MATRIX]]);
  const session = buildF7Session({ rootFragments, f4Geometry, f4FragmentGeometryId, f4WorldMatricesByFragId, getNodeBoxImpl: nodeBoxFiller([0, 0, 0, 10, 10, 0]) });
  session.model.getFragmentList = () => ({ db2ThemingColor: {} });
  const realm = createPageRealm({ __g1: { sessions: { s1: session }, mod: fakeF7Mod() }, __viewer: fakeF7Viewer(), Autodesk: FAKE_AUTODESK_EVENTS });

  const result = await realm.call(observeF7, 's1');

  assert.equal(result.fields.visibilityBranch, 'FragmentList');
  assert.equal(scoreF7(result.fields).verdict, CHECK_VERDICT.PASS);
});

test('scoreF7: placementNotInvertible forces NOT_EVIDENCED even when every censused dbId agrees', () => {
  const fields = {
    boundsAgreement: { 100: 'agrees' },
    unitScalePlausible: true, unitStringPlausible: true, hiddenNodesPlausible: true,
    placementNotInvertible: true, nonFiniteAxisDbIds: [],
  };
  assert.equal(scoreF7(fields).verdict, CHECK_VERDICT.NOT_EVIDENCED);
  assert.equal(scoreF7(fields).reason, 'f7-placement-not-invertible-or-non-finite-scale');
});

test('scoreF7: nonFiniteAxisDbIds non-empty forces NOT_EVIDENCED, never a silent PASS', () => {
  const fields = {
    boundsAgreement: { 100: 'agrees' },
    unitScalePlausible: true, unitStringPlausible: true, hiddenNodesPlausible: true,
    placementNotInvertible: false, nonFiniteAxisDbIds: [100],
  };
  assert.equal(scoreF7(fields).verdict, CHECK_VERDICT.NOT_EVIDENCED);
});

test('scoreF7: PASS requires every subcheck plausible and every dbId agrees (no-reference-geometry dbIds excluded from the requirement)', () => {
  const fields = {
    boundsAgreement: { 100: 'agrees', 200: 'no-reference-geometry' },
    unitScalePlausible: true, unitStringPlausible: true, hiddenNodesPlausible: true,
    placementNotInvertible: false, nonFiniteAxisDbIds: [],
  };
  assert.equal(scoreF7(fields).verdict, CHECK_VERDICT.PASS);
});

test('selectBoundsBeyondToleranceTarget: picks the lowest sorted dbId whose primary result was agrees, first qualifying axis', () => {
  const fields = {
    boundsAgreement: { 300: 'agrees', 100: 'disagrees', 200: 'agrees' },
    boundsScalePerDbId: {
      100: { x: { S_a: 5 }, y: { S_a: 5 }, z: { S_a: 5 } },
      200: { x: { S_a: 0 }, y: { S_a: 7 }, z: { S_a: 7 } }, // x disqualified (S_a === 0, not > 0)
      300: { x: { S_a: 9 }, y: { S_a: 9 }, z: { S_a: 9 } },
    },
  };
  const target = selectBoundsBeyondToleranceTarget(fields);
  assert.deepEqual(target, { dbId: 200, axis: 'y' });
});

test('selectBoundsBeyondToleranceTarget: returns null when no dbId agrees', () => {
  const fields = { boundsAgreement: { 100: 'disagrees' }, boundsScalePerDbId: { 100: { x: { S_a: 5 } } } };
  assert.equal(selectBoundsBeyondToleranceTarget(fields), null);
});

test('selectBoundsBeyondToleranceTarget: returns null when the only agreeing dbId has no finite/normal/positive S_a on any axis', () => {
  const fields = {
    boundsAgreement: { 100: 'agrees' },
    boundsScalePerDbId: { 100: { x: { S_a: NaN }, y: { S_a: 0 }, z: { S_a: -1 } } },
  };
  assert.equal(selectBoundsBeyondToleranceTarget(fields), null);
});

function fakeModelForBoundsControl(getNodeBoxImpl) {
  // getObjectTree() must return the SAME tree object every call (as a real Model's cached
  // InstanceTree would) -- both the control's own patch and a later checkBoundsForDbId/
  // viewerApiGetElementWorldBounds re-read must observe the SAME patched (or restored)
  // getNodeBox, never a fresh unpatched object each call.
  const tree = { getNodeBox: getNodeBoxImpl };
  return { getObjectTree: () => tree };
}

test('invalid-bounds control: DETECTED_RESTORED -- F7 (fake) correctly reports viewerApiNull for the NaN-filled box, restored after', async () => {
  const stored = [0, 0, 0, 10, 10, 0];
  const model = fakeModelForBoundsControl((dbId, buffer) => { for (let i = 0; i < 6; i += 1) buffer[i] = stored[i]; });
  const result = await runInvalidBoundsControl({
    modelBefore: model, world: { isModelLive: () => true }, registry: { bindingFor: () => ({ model }) }, registryKey: 'K',
    targetDbId: 100,
    checkBoundsForDbId: async (m, dbId) => {
      const buffer = new Float32Array(6).fill(Number.NaN);
      model.getObjectTree().getNodeBox(dbId, buffer);
      const finite = Array.from(buffer).every(Number.isFinite);
      return { boundsAgreement: finite ? 'agrees' : 'viewerApiNull' };
    },
  });
  assert.equal(result.state, CONTROL_STATE.DETECTED_RESTORED);
  assert.equal(result.restorationRequired, CONTROL_RESTORATION_REQUIRED['invalid-bounds']);

  const freshBuffer = new Float32Array(6);
  model.getObjectTree().getNodeBox(100, freshBuffer);
  assert.deepEqual(Array.from(freshBuffer), stored, 'restored to the original after the control');
});

test('invalid-bounds control: NOT_DETECTED -- F7 (fake) fails to reject the NaN box', async () => {
  const model = fakeModelForBoundsControl(() => {});
  const result = await runInvalidBoundsControl({
    modelBefore: model, world: { isModelLive: () => true }, registry: { bindingFor: () => ({ model }) }, registryKey: 'K',
    targetDbId: 100,
    checkBoundsForDbId: async () => ({ boundsAgreement: 'agrees' }), // wrong -- should have been viewerApiNull
  });
  assert.equal(result.state, CONTROL_STATE.NOT_DETECTED);
});

test('invalid-bounds control: RESTORE_FAILED -- detected, but post-restoration liveness check fails', async () => {
  const model = fakeModelForBoundsControl((dbId, buffer) => { buffer[0] = 0; });
  const result = await runInvalidBoundsControl({
    modelBefore: model, world: { isModelLive: () => false }, registry: { bindingFor: () => ({ model }) }, registryKey: 'K',
    targetDbId: 100,
    checkBoundsForDbId: async () => ({ boundsAgreement: 'viewerApiNull' }),
  });
  assert.equal(result.state, CONTROL_STATE.RESTORE_FAILED);
});

test('invalid-bounds control: TIMED_OUT', async () => {
  const model = fakeModelForBoundsControl(() => {});
  const result = await runInvalidBoundsControl({
    modelBefore: model, world: { isModelLive: () => true }, registry: { bindingFor: () => ({ model }) }, registryKey: 'K',
    targetDbId: 100,
    checkBoundsForDbId: () => new Promise(() => {}),
    controlTimeoutMs: 20,
  });
  assert.equal(result.state, CONTROL_STATE.TIMED_OUT);
});

test('invalid-bounds control: NOT_EXECUTABLE -- no modelBefore', async () => {
  const result = await runInvalidBoundsControl({ modelBefore: null, checkBoundsForDbId: async () => ({}), targetDbId: 100 });
  assert.equal(result.state, CONTROL_STATE.NOT_EXECUTABLE);
});

function boundsCheckerFromRefAndScale(model, refBox, sA, tGross, tPass) {
  return async (m, dbId) => {
    const buffer = new Float32Array(6);
    model.getObjectTree().getNodeBox(dbId, buffer);
    const rMin = buffer[0] - refBox[0];
    const rMax = refBox[3] - buffer[3];
    const maxResidual = Math.max(rMin, rMax);
    const state = maxResidual > tGross ? 'disagrees' : (maxResidual > tPass ? 'near-tolerance' : 'agrees');
    return { boundsAgreement: state };
  };
}

test('bounds-beyond-tolerance control: DETECTED_RESTORED -- perturbed dbId reports disagrees, restoration is bit-exact', async () => {
  const current = [0, 0, 0, 10, 10, 0];
  const model = fakeModelForBoundsControl((dbId, buffer) => { for (let i = 0; i < 6; i += 1) buffer[i] = current[i]; });
  const S_a = 10;
  const primaryF7Fields = {
    boundsAgreement: { 100: 'agrees' },
    boundsScalePerDbId: { 100: { x: { S_a }, y: { S_a }, z: { S_a } } },
    fragmentBoundsUnion: { 100: [0, 0, 0, 10, 10, 0] },
    elementWorldBounds: { 100: [0, 0, 0, 10, 10, 0] },
  };
  const viewerApiGetElementWorldBounds = (m, dbId) => {
    const buf = new Float32Array(6);
    model.getObjectTree().getNodeBox(dbId, buf);
    return Array.from(buf);
  };

  const result = await runBoundsBeyondToleranceControl({
    modelBefore: model, world: { isModelLive: () => true }, registry: { bindingFor: () => ({ model }) }, registryKey: 'K',
    primaryF7Fields,
    checkBoundsForDbId: boundsCheckerFromRefAndScale(model, [0, 0, 0, 10, 10, 0], S_a, (2 ** -10) * S_a, 16 * (2 ** -24) * S_a),
    viewerApiGetElementWorldBounds,
    model,
  });

  assert.equal(result.state, CONTROL_STATE.DETECTED_RESTORED);
  assert.equal(result.restorationRequired, CONTROL_RESTORATION_REQUIRED['bounds-beyond-tolerance']);

  const freshBuffer = new Float32Array(6);
  model.getObjectTree().getNodeBox(100, freshBuffer);
  assert.deepEqual(Array.from(freshBuffer), [0, 0, 0, 10, 10, 0], 'getNodeBox restored, unwrapped, after the control');
});

test('bounds-beyond-tolerance control: NOT_EXECUTABLE -- no dbId agreed in the primary pass', async () => {
  const model = fakeModelForBoundsControl(() => {});
  const result = await runBoundsBeyondToleranceControl({
    modelBefore: model,
    primaryF7Fields: { boundsAgreement: { 100: 'disagrees' }, boundsScalePerDbId: {} },
    checkBoundsForDbId: async () => ({ boundsAgreement: 'disagrees' }),
  });
  assert.equal(result.state, CONTROL_STATE.NOT_EXECUTABLE);
  assert.equal(result.reason, 'perturbation-not-representable');
});

test('bounds-beyond-tolerance control: NOT_DETECTED -- perturbed dbId reports a weaker state than disagrees', async () => {
  const current = [0, 0, 0, 10, 10, 0];
  const model = fakeModelForBoundsControl((dbId, buffer) => { for (let i = 0; i < 6; i += 1) buffer[i] = current[i]; });
  const primaryF7Fields = {
    boundsAgreement: { 100: 'agrees' },
    boundsScalePerDbId: { 100: { x: { S_a: 10 } } },
    fragmentBoundsUnion: { 100: [0, 0, 0, 10, 10, 0] },
    elementWorldBounds: { 100: [0, 0, 0, 10, 10, 0] },
  };
  const result = await runBoundsBeyondToleranceControl({
    modelBefore: model, world: { isModelLive: () => true }, registry: { bindingFor: () => ({ model }) }, registryKey: 'K',
    primaryF7Fields,
    checkBoundsForDbId: async () => ({ boundsAgreement: 'near-tolerance' }), // wrong -- expected disagrees
  });
  assert.equal(result.state, CONTROL_STATE.NOT_DETECTED);
});

// ============================================================================================
// Stage 7 -- F8 (observeF8/scoreF8), read-only, built entirely from F1/F2's already-frozen data.
// `observeF8` is in-page (added to IN_PAGE_FUNCTIONS above); `scoreF8` is pure Node-side.
// ============================================================================================

function buildF8Session({ f1FragmentMapsByRoot, f2TreeOwnerByFragId, getDbIds }) {
  return {
    model: { getFragmentList: () => ({ getDbIds }) },
    artifacts: { f1FragmentMapsByRoot, f2TreeOwnerByFragId },
  };
}

test('observeF8: session-not-found', async () => {
  const realm = createPageRealm({ __g1: { sessions: {}, mod: {} } });
  const result = await realm.call(observeF8, { sessionId: 'missing', f1Fields: {}, f2Fields: {} });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'session-not-found');
});

test('observeF8: refuses to run before F1 has populated f1FragmentMapsByRoot', async () => {
  const realm = createPageRealm({ __g1: { sessions: { s1: { model: {}, artifacts: {} } }, mod: {} } });
  const result = await realm.call(observeF8, { sessionId: 's1', f1Fields: {}, f2Fields: {} });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'f1-fragment-maps-by-root-not-available-run-observeF1-first');
});

test('observeF8: refuses to run before F2 has populated f2TreeOwnerByFragId', async () => {
  const session = buildF8Session({
    f1FragmentMapsByRoot: new Map([[100, new Map([[0, { ownerDbId: 100 }]])]]),
    f2TreeOwnerByFragId: undefined,
    getDbIds: () => 100,
  });
  const realm = createPageRealm({ __g1: { sessions: { s1: session }, mod: {} } });
  const result = await realm.call(observeF8, { sessionId: 's1', f1Fields: { rootsLength: 1 }, f2Fields: {} });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'f2-tree-owner-by-frag-id-not-available-run-observeF2-first');
});

test('observeF8: refuses to run without f1Fields/f2Fields supplied', async () => {
  const session = buildF8Session({
    f1FragmentMapsByRoot: new Map([[100, new Map([[0, { ownerDbId: 100 }]])]]),
    f2TreeOwnerByFragId: new Map([[0, { ownerDbId: 100, conflictingOwnerDbId: null }]]),
    getDbIds: () => 100,
  });
  const realm = createPageRealm({ __g1: { sessions: { s1: session }, mod: {} } });
  const result = await realm.call(observeF8, { sessionId: 's1' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'f1Fields-and-f2Fields-required');
});

test('observeF8: healthy census -- R1/R2 agree, all five coverage equations close, PASS', async () => {
  const f1FragmentMapsByRoot = new Map([
    [100, new Map([[0, { ownerDbId: 100 }]])],
    [200, new Map([[1, { ownerDbId: 200 }]])],
  ]);
  const f2TreeOwnerByFragId = new Map([
    [0, { ownerDbId: 100, conflictingOwnerDbId: null }],
    [1, { ownerDbId: 200, conflictingOwnerDbId: null }],
  ]);
  const session = buildF8Session({ f1FragmentMapsByRoot, f2TreeOwnerByFragId, getDbIds: (fragId) => (fragId === 0 ? 100 : 200) });
  const realm = createPageRealm({ __g1: { sessions: { s1: session }, mod: {} } });
  const f1Fields = { rootsLength: 2 };
  const f2Fields = { fragListCount: 3, classL: 2, classN: 1, classU: 0, treeReachableCount: 2, loadedButUnreachableCount: 0 };

  const result = await realm.call(observeF8, { sessionId: 's1', f1Fields, f2Fields });

  assert.equal(result.ok, true);
  assert.equal(result.fields.censusedRootCount, 2);
  assert.equal(result.fields.censusedFragmentCount, 2);
  assert.equal(result.fields.treeCheckedFragmentCount, 2);
  assert.equal(result.fields.ownershipDivergenceCount, 0);
  assert.equal(result.fields.treeDivergenceCount, 0);
  assert.equal(result.fields.divergenceCount, 0);
  assert.equal(result.fields.coverageEquationsClosed, true);
  assert.equal(scoreF8(result.fields).verdict, CHECK_VERDICT.PASS);
});

test('observeF8: R1 divergence -- a fresh getDbIds() disagrees with F1\'s own recorded ownerDbId, FAIL', async () => {
  const f1FragmentMapsByRoot = new Map([[100, new Map([[0, { ownerDbId: 100 }]])]]);
  const f2TreeOwnerByFragId = new Map([[0, { ownerDbId: 100, conflictingOwnerDbId: null }]]);
  const session = buildF8Session({ f1FragmentMapsByRoot, f2TreeOwnerByFragId, getDbIds: () => 999 }); // disagrees
  const realm = createPageRealm({ __g1: { sessions: { s1: session }, mod: {} } });
  const f1Fields = { rootsLength: 1 };
  const f2Fields = { fragListCount: 1, classL: 1, classN: 0, classU: 0, treeReachableCount: 1, loadedButUnreachableCount: 0 };

  const result = await realm.call(observeF8, { sessionId: 's1', f1Fields, f2Fields });

  assert.equal(result.fields.ownershipDivergenceCount, 1);
  assert.equal(result.fields.divergenceCount, 1);
  assert.equal(result.firstDivergences[0].relation, 'R1');
  assert.equal(result.firstDivergences[0].fragId, 0);
  assert.equal(scoreF8(result.fields).verdict, CHECK_VERDICT.FAIL);
  assert.equal(scoreF8(result.fields).reason, 'f8-dbid-divergence');
});

test('observeF8: R1 -- getDbIds() throwing counts as a divergence, never silently skipped', async () => {
  const f1FragmentMapsByRoot = new Map([[100, new Map([[0, { ownerDbId: 100 }]])]]);
  const f2TreeOwnerByFragId = new Map([[0, { ownerDbId: 100, conflictingOwnerDbId: null }]]);
  const session = buildF8Session({ f1FragmentMapsByRoot, f2TreeOwnerByFragId, getDbIds: () => { throw new Error('boom'); } });
  const realm = createPageRealm({ __g1: { sessions: { s1: session }, mod: {} } });
  const f1Fields = { rootsLength: 1 };
  const f2Fields = { fragListCount: 1, classL: 1, classN: 0, classU: 0, treeReachableCount: 1, loadedButUnreachableCount: 0 };

  const result = await realm.call(observeF8, { sessionId: 's1', f1Fields, f2Fields });

  assert.equal(result.fields.ownershipDivergenceCount, 1);
  assert.equal(scoreF8(result.fields).verdict, CHECK_VERDICT.FAIL);
});

test('observeF8: R2 divergence -- fragId missing from f2TreeOwnerByFragId (F2 never discovered it), FAIL', async () => {
  const f1FragmentMapsByRoot = new Map([[100, new Map([[0, { ownerDbId: 100 }]])]]);
  const f2TreeOwnerByFragId = new Map(); // deliberately empty
  const session = buildF8Session({ f1FragmentMapsByRoot, f2TreeOwnerByFragId, getDbIds: () => 100 });
  const realm = createPageRealm({ __g1: { sessions: { s1: session }, mod: {} } });
  const f1Fields = { rootsLength: 1 };
  const f2Fields = { fragListCount: 1, classL: 1, classN: 0, classU: 0, treeReachableCount: 1, loadedButUnreachableCount: 0 };

  const result = await realm.call(observeF8, { sessionId: 's1', f1Fields, f2Fields });

  assert.equal(result.fields.treeDivergenceCount, 1);
  assert.equal(result.firstDivergences.some((d) => d.relation === 'R2'), true);
  assert.equal(scoreF8(result.fields).verdict, CHECK_VERDICT.FAIL);
});

test('observeF8: R2 divergence -- a recorded conflictingOwnerDbId (F2\'s walk found the fragment under two nodes) always counts as divergent, even if ownerDbId itself agrees with F1', async () => {
  const f1FragmentMapsByRoot = new Map([[100, new Map([[0, { ownerDbId: 100 }]])]]);
  const f2TreeOwnerByFragId = new Map([[0, { ownerDbId: 100, conflictingOwnerDbId: 200 }]]); // ambiguous
  const session = buildF8Session({ f1FragmentMapsByRoot, f2TreeOwnerByFragId, getDbIds: () => 100 });
  const realm = createPageRealm({ __g1: { sessions: { s1: session }, mod: {} } });
  const f1Fields = { rootsLength: 1 };
  const f2Fields = { fragListCount: 1, classL: 1, classN: 0, classU: 0, treeReachableCount: 1, loadedButUnreachableCount: 0 };

  const result = await realm.call(observeF8, { sessionId: 's1', f1Fields, f2Fields });

  assert.equal(result.fields.treeDivergenceCount, 1);
  assert.equal(result.fields.ownershipDivergenceCount, 0, 'R1 itself still agrees -- only R2 is flagged');
  assert.equal(scoreF8(result.fields).verdict, CHECK_VERDICT.FAIL);
});

test('observeF8: coverage equation 1 fails (classL+classN+classU !== fragListCount) -- coverageEquationsClosed false, FAIL, even with zero divergences', async () => {
  const f1FragmentMapsByRoot = new Map([[100, new Map([[0, { ownerDbId: 100 }]])]]);
  const f2TreeOwnerByFragId = new Map([[0, { ownerDbId: 100, conflictingOwnerDbId: null }]]);
  const session = buildF8Session({ f1FragmentMapsByRoot, f2TreeOwnerByFragId, getDbIds: () => 100 });
  const realm = createPageRealm({ __g1: { sessions: { s1: session }, mod: {} } });
  const f1Fields = { rootsLength: 1 };
  // classL+classN+classU = 1+0+0 = 1, but fragListCount claims 5 -- a silent population drop.
  const f2Fields = { fragListCount: 5, classL: 1, classN: 0, classU: 0, treeReachableCount: 1, loadedButUnreachableCount: 0 };

  const result = await realm.call(observeF8, { sessionId: 's1', f1Fields, f2Fields });

  assert.equal(result.fields.ownershipDivergenceCount, 0);
  assert.equal(result.fields.treeDivergenceCount, 0);
  assert.equal(result.fields.coverageEquationsClosed, false);
  assert.equal(scoreF8(result.fields).verdict, CHECK_VERDICT.FAIL);
  assert.equal(scoreF8(result.fields).reason, 'f8-coverage-equations-not-closed');
});

test('observeF8: coverage equation 5 fails (censusedRootCount !== rootsLength) -- an F1 root missing its own extractFragments map', async () => {
  // Only ONE root's map survived (e.g. the other F1 root's extractFragments call threw and was
  // never stored) -- censusedRootCount (1) must disagree with the reference rootsLength (2).
  const f1FragmentMapsByRoot = new Map([[100, new Map([[0, { ownerDbId: 100 }]])]]);
  const f2TreeOwnerByFragId = new Map([[0, { ownerDbId: 100, conflictingOwnerDbId: null }]]);
  const session = buildF8Session({ f1FragmentMapsByRoot, f2TreeOwnerByFragId, getDbIds: () => 100 });
  const realm = createPageRealm({ __g1: { sessions: { s1: session }, mod: {} } });
  const f1Fields = { rootsLength: 2 };
  const f2Fields = { fragListCount: 1, classL: 1, classN: 0, classU: 0, treeReachableCount: 1, loadedButUnreachableCount: 0 };

  const result = await realm.call(observeF8, { sessionId: 's1', f1Fields, f2Fields });

  assert.equal(result.fields.censusedRootCount, 1);
  assert.equal(result.fields.rootsLengthReference, 2);
  assert.equal(result.fields.coverageEquationsClosed, false);
  assert.equal(scoreF8(result.fields).verdict, CHECK_VERDICT.FAIL);
});

test('observeF8: a loaded-but-unreachable class-L fragment is a named exclusion -- never discovered by any F1 root, never a false R1/R2 divergence, coverage still closes via equation 2', async () => {
  // classL=2 total, but only 1 fragment is tree-reachable (the census domain) -- the other is
  // loadedButUnreachableCount=1, retained via equation 2, never iterated by R1/R2 at all.
  const f1FragmentMapsByRoot = new Map([[100, new Map([[0, { ownerDbId: 100 }]])]]);
  const f2TreeOwnerByFragId = new Map([[0, { ownerDbId: 100, conflictingOwnerDbId: null }]]);
  const session = buildF8Session({ f1FragmentMapsByRoot, f2TreeOwnerByFragId, getDbIds: () => 100 });
  const realm = createPageRealm({ __g1: { sessions: { s1: session }, mod: {} } });
  const f1Fields = { rootsLength: 1 };
  const f2Fields = { fragListCount: 2, classL: 2, classN: 0, classU: 0, treeReachableCount: 1, loadedButUnreachableCount: 1 };

  const result = await realm.call(observeF8, { sessionId: 's1', f1Fields, f2Fields });

  assert.equal(result.fields.censusedFragmentCount, 1, 'only the tree-reachable fragment is censused');
  assert.equal(result.fields.ownershipDivergenceCount, 0);
  assert.equal(result.fields.treeDivergenceCount, 0);
  assert.equal(result.fields.coverageEquationsClosed, true);
  assert.equal(scoreF8(result.fields).verdict, CHECK_VERDICT.PASS);
});

test('scoreF8: fails closed on missing coverageEquationsClosed evidence (undefined, never silently PASS)', () => {
  const fields = { ownershipDivergenceCount: 0, treeDivergenceCount: 0 };
  assert.equal(scoreF8(fields).verdict, CHECK_VERDICT.FAIL);
});
