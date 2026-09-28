// test/acceptance/g1-svf2-f1-f8-verification.session.test.mjs
//
// Offline, browser-free unit tests for Stage 4 of test/acceptance/g1-svf2-f1-f8-verification.mjs
// (Phase 2.5's real shared session-state construction -- the FROZEN contract F4/F5/F7/F8/F6
// reuse verbatim -- plus F1, F2, and their two immediate mandatory controls). New sibling file,
// same rationale as Stages 2/3's own splits: this stage's concerns (session construction,
// fragment/tree observation, two more controls) are independent enough to warrant their own
// file. Auto-discovered by scripts/run-tests.mjs (`*.test.mjs`).
//
// AUTHORIZATION BOUNDARY: this file NEVER launches a real Chromium browser, NEVER imports
// playwright, and NEVER executes main(). Per the codex-advisor consult (see the main module's
// own Stage 4 banner comment), the in-page functions here (setupSharedSessionResources,
// observeF1, observeF2) are tested by reconstructing them from their own source text inside an
// isolated node:vm context -- reusing Stage 2's own createPageRealm pattern -- rather than a
// plain `globalThis.window` fake, so an accidental Node-module closure reference would surface
// as a ReferenceError here exactly as it would if handed to a real page.evaluate.

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {
  CONTROL_STATE,
  CONTROL_RESTORATION_REQUIRED,
  CHECK_VERDICT,
  SESSION_K,
  SESSION_MODEL_VERSION,
  sessionErrOf,
  setupSharedSessionResources,
  observeF1,
  scoreF1,
  observeF2,
  scoreF2,
  runWrongOwnerControl,
  runHiddenFragmentControl,
} from './g1-svf2-f1-f8-verification.mjs';

// ============================================================================================
// Page-realm test harness (node:vm-backed) -- see file banner above. `sessionErrOf` is a
// sibling helper `setupSharedSessionResources`/`observeF1` both call -- bundled here exactly
// like Stage 2's own IN_PAGE_FUNCTIONS bundling note describes (page.evaluate only serializes
// the one function it's given, never a function that function calls).
// ============================================================================================

const IN_PAGE_FUNCTIONS = { sessionErrOf, setupSharedSessionResources, observeF1, observeF2 };

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
