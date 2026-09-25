// Shared test fixture: builds a fake Autodesk.Viewing.Model-shaped object over a plain JS tree
// definition, for testing ViewerModelAdapter's self-driven walk without a live Viewer. Also reused by
// Task 18's CollisionInstance admission fixtures, since those need real ExtractedFragmentRecord input.
//
// Tree node shape: { dbId: number, fragments?: number[], children?: TreeNode[] }
// fragmentGeometry: Map<fragmentId, { geometryIndex: number, matrix?: number[16],
//                                     bounds?: { min: [x,y,z], max: [x,y,z] } }>

import * as THREE from 'three';

// ViewerModelAdapter's extractFragments defaults its injected `THREE` namespace param to
// `globalThis.THREE` (production: the Viewer's own r71 global, set by its script tag before
// any collision code runs). Every test in this repo runs headless under Node's test runner
// with no Viewer page at all, so this fixture simulates that global having already been set,
// using this repo's own vendored modern `three` package -- its Matrix4/Box3 method names and
// behavior (multiplyMatrices/copy/identity/applyMatrix4/fromArray) are stable across three.js
// versions including r71, so this is a faithful stand-in even though production never injects
// this exact package. Set once, on first import, in whichever process loads this fixture.
if (!globalThis.THREE) globalThis.THREE = THREE;

// Real Viewer FragmentList.getWorldMatrix/getWorldBounds call actual methods on the out-param
// they're given (dstMtx.multiplyMatrices(...); dstBox.copy(...)/applyMatrix4(...)) rather than
// writing fields directly -- a plain duck-typed carrier throws against the real Viewer (Item A
// regression, final whole-branch review of Batch 3). This fixture's fake FragmentList mirrors
// that shape deliberately, so every test that goes through it (not just a dedicated regression
// test) proves extractFragments passes a genuine THREE.Matrix4/THREE.Box3, never a shim.
const IDENTITY_MATRIX4 = new THREE.Matrix4();

/**
 * @param {Array} rootNodes
 * @param {Map} fragmentGeometry
 * @param {Object} [options]
 * @param {Object} [options.stats]  shared counter object (see below)
 * @param {boolean} [options.objectTreeReady=true]  what `model.isObjectTreeCreated()` reports.
 *   Defaults to true so every pre-existing fixture takes CollisionWorld.findClashes's
 *   readiness-wait fast path with no change of its own.
 * @param {(onSuccess: Function, onError: Function, instanceTree: Object) => void}
 *   [options.settleObjectTree]  how a `getObjectTree(onSuccess, onError)` call settles. Default:
 *   `onSuccess(instanceTree)` synchronously. Override to defer it (capture the callbacks and fire
 *   them later), or to drive the onError path.
 * @param {number} [options.fragmentCount]  what `fragList.getCount()` reports, for
 *   extractAllFragments's whole-model enumeration walk (Task 5). Defaults to one past the highest
 *   fragId owned by any node in `rootNodes` (or 0 if none) -- i.e. "exactly as many fragments as
 *   the tree describes." Set this explicitly higher than any fragId the tree actually owns to
 *   simulate a real Viewer's sparse `fragId2dbId` lookup miss (`fragList.getDbIds(fragId) ===
 *   undefined` for an in-range fragId nothing in the tree claims) -- see
 *   `options.ownerDbIdOverrides` below for a more direct way to force the same outcome, or set it
 *   far above `maxCollisionInstancesPerEpoch` to exercise the capacity precheck cheaply, with no
 *   need to materialize a huge tree.
 * @param {Iterable<number>} [options.hiddenDbIds]  dbIds for which `instanceTree.isNodeHidden`
 *   reports true. Deliberately keyed by dbId, not fragId: `isNodeHidden` is a per-dbId,
 *   `ObjectTree`-level accessor in the real Viewer (docs/superpowers/specs/
 *   m2-extractAllFragments-viewer-evidence.md), never a `FragmentList` one.
 * @param {Map<number, (number|number[]|undefined)>} [options.ownerDbIdOverrides]  per-fragId
 *   overrides for what `fragList.getDbIds(fragId)` returns, taking precedence over the tree-derived
 *   default. An explicit `undefined` value forces an unresolvable owner even for a fragId the tree
 *   otherwise assigns; an array value simulates a 2D-loaded model's multi-dbId return shape (out of
 *   scope for M2 -- extractAllFragments must diagnose it, never crash or store the array).
 * @param {Iterable<number>} [options.notLoadedFragIds]  fragIds for which `fragList.isNotLoaded`
 *   reports true (excluded from loading, or unloaded -- a real, distinct fragment lifecycle state,
 *   never a structural index-range hole; see the evidence note above).
 */
export function buildMockModel(rootNodes, fragmentGeometry, options = {}) {
  const stats = options.stats || {
    enumNodeChildrenCalls: 0,
    enumNodeChildrenCallbacks: 0,
    enumNodeFragmentsCalls: 0,
    enumNodeFragmentsCallbacks: 0,
    getChildCountCalls: 0,
  };
  // Counted separately from any plain `getObjectTree()` read: ViewerModelAdapter's extraction walk
  // calls the SAME method with no arguments to fetch the tree, so only a call carrying callbacks is
  // evidence of the readiness WAIT having run.
  if (stats.getObjectTreeWithCallbacksCalls === undefined) stats.getObjectTreeWithCallbacksCalls = 0;
  // Task 5 (extractAllFragments) counters -- guarded individually, exactly like
  // getObjectTreeWithCallbacksCalls above, so a caller-supplied custom `stats` object that predates
  // these fields gets them initialized to 0 rather than incrementing into NaN.
  if (stats.getCountCalls === undefined) stats.getCountCalls = 0;
  if (stats.getDbIdsCalls === undefined) stats.getDbIdsCalls = 0;
  if (stats.isNotLoadedCalls === undefined) stats.isNotLoadedCalls = 0;
  if (stats.isNodeHiddenCalls === undefined) stats.isNodeHiddenCalls = 0;
  const objectTreeReady = options.objectTreeReady ?? true;
  const settleObjectTree = options.settleObjectTree
    || ((onSuccess, _onError, tree) => onSuccess(tree));
  const hiddenDbIds = new Set(options.hiddenDbIds || []);
  const ownerDbIdOverrides = options.ownerDbIdOverrides || new Map();
  const notLoadedFragIds = new Set(options.notLoadedFragIds || []);

  const nodesById = new Map();
  // fragId -> owning dbId, derived from the WHOLE tree (every node, not just a requested subtree --
  // extractAllFragments enumerates every fragment the model holds, independent of which dbIds a
  // caller might separately request via extractFragments). First occurrence wins, mirroring
  // extractFragments's own first-discovery-wins convention, even though a well-formed tree should
  // never assign one fragId to two different owning nodes in the first place.
  const fragId2dbId = new Map();
  (function index(nodes) {
    for (const node of nodes) {
      nodesById.set(node.dbId, node);
      for (const fragId of node.fragments || []) {
        if (!fragId2dbId.has(fragId)) fragId2dbId.set(fragId, node.dbId);
      }
      if (node.children) index(node.children);
    }
  })(rootNodes);

  const fragmentCount = options.fragmentCount
    ?? (fragId2dbId.size > 0 ? Math.max(...fragId2dbId.keys()) + 1 : 0);

  function enumNodeFragmentsRecursive(node, cb) {
    for (const fragId of node.fragments || []) cb(fragId);
    for (const child of node.children || []) enumNodeFragmentsRecursive(child, cb);
  }

  const instanceTree = {
    enumNodeChildren(dbId, cb, recursive) {
      stats.enumNodeChildrenCalls++;
      if (recursive) {
        throw new Error('enumNodeChildren(recursive=true) must never be called by production code');
      }
      const node = nodesById.get(dbId);
      if (!node) return;
      for (const child of node.children || []) {
        stats.enumNodeChildrenCallbacks++;
        const abort = cb(child.dbId);
        if (abort === true) return;
      }
    },
    enumNodeFragments(dbId, cb, recursive) {
      stats.enumNodeFragmentsCalls++;
      const node = nodesById.get(dbId);
      if (!node) return;
      if (recursive) {
        // ONLY used by the round-18 coverage-equivalence fixture as independently-derived ground
        // truth to compare the self-driven walk's output against. ViewerModelAdapter itself never
        // passes recursive=true (spec:1083-1094, 2838-2907 -- "no code path in this design may
        // call the recursive form").
        enumNodeFragmentsRecursive(node, cb);
        return;
      }
      for (const fragId of node.fragments || []) {
        stats.enumNodeFragmentsCallbacks++;
        cb(fragId);
      }
    },
    // Deliberately no `getChildCount` -- proves ViewerModelAdapter never calls it (round-18
    // invariant-audit finding C-1, spec:2853-2929 "getChildCount preflight is REMOVED entirely").
    // Any accidental call throws instead of silently succeeding, so a regression trips loudly.
    getChildCount() {
      stats.getChildCountCalls++;
      throw new Error('getChildCount must never be called -- removed per invariant-audit finding C-1');
    },
    // Task 5 (extractAllFragments): the ObjectTree-level, officially-documented hidden check
    // (docs/superpowers/specs/m2-extractAllFragments-viewer-evidence.md, Evidence §3). Keyed by
    // dbId, checked only AFTER a fragment's owner has resolved -- never by fragId.
    isNodeHidden(dbId) {
      stats.isNodeHiddenCalls++;
      return hiddenDbIds.has(dbId);
    },
    // The real Viewer InstanceTree.getRootId(). The mock takes an array of root nodes, so it can answer
    // only when there is exactly one; a multi-root array has no honest single answer and must not get an
    // invented virtual root (whole-model root discovery in clashtest/viewer starts here).
    getRootId() {
      if (rootNodes.length !== 1) {
        throw new Error('mock getRootId requires a single-rooted tree (pass exactly one root node)');
      }
      return rootNodes[0].dbId;
    },
  };

  const fragmentList = {
    getWorldMatrix(fragId, dstMtx) {
      const g = fragmentGeometry.get(fragId);
      const matrix = (g && g.matrix) || [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
      const source = new THREE.Matrix4().fromArray(matrix);
      // Real method call on the carrier (dstMtx = source * identity = source), exactly like the
      // real Viewer's getWorldMatrix -- a duck-typed { elements: Float64Array(16) } shim has no
      // multiplyMatrices method and would throw here.
      dstMtx.multiplyMatrices(source, IDENTITY_MATRIX4);
    },
    getWorldBounds(fragId, dstBox) {
      const g = fragmentGeometry.get(fragId);
      const bounds = (g && g.bounds) || { min: [0, 0, 0], max: [1, 1, 1] };
      const source = new THREE.Box3(
        new THREE.Vector3(...bounds.min),
        new THREE.Vector3(...bounds.max),
      );
      // Real method calls on the carrier, exactly like the real Viewer's getWorldBounds -- a
      // duck-typed { min: {x,y,z}, max: {x,y,z} } shim has no copy/applyMatrix4 methods and
      // would throw here.
      dstBox.copy(source);
      dstBox.applyMatrix4(IDENTITY_MATRIX4);
    },
    getGeometryId(fragId) {
      const g = fragmentGeometry.get(fragId);
      return g ? g.geometryIndex : fragId;
    },
    // Task 5 (extractAllFragments) accessors below -- extractFragments's own per-dbId subtree walk
    // never calls any of these; they exist only for the whole-model enumeration primitive's tests.
    getCount() {
      stats.getCountCalls++;
      return fragmentCount;
    },
    // Real Viewer behavior: `this.fragments.fragId2dbId[fragId]`, a plain number for a standard
    // 3D/OTG load, `undefined` for an in-range fragId nothing claims. `options.ownerDbIdOverrides`
    // takes precedence so a single test can force any of the three shapes (number/array/undefined)
    // without needing a bespoke tree.
    getDbIds(fragId) {
      stats.getDbIdsCalls++;
      if (ownerDbIdOverrides.has(fragId)) return ownerDbIdOverrides.get(fragId);
      return fragId2dbId.get(fragId);
    },
    // Real Viewer behavior: true means excluded from loading or unloaded -- a genuine, distinct
    // lifecycle flag (`vizflags[frag] & MeshFlags.MESH_NOTLOADED`), never a structural index-range
    // hole (see the evidence note cited at the top of extractAllFragments's own module comment).
    isNotLoaded(fragId) {
      stats.isNotLoadedCalls++;
      return notLoadedFragIds.has(fragId);
    },
  };

  const model = {
    // getObjectTree is the non-deprecated accessor ViewerModelAdapter actually calls
    // (docs/superpowers/specs/instance-tree-readiness-decision.md); getInstanceTree is
    // kept alongside it, pointing at the same fake instanceTree, only because this
    // fixture's own round-18 ground-truth test (ViewerModelAdapter.test.mjs) still
    // calls it directly for an independently-derived comparison.
    getInstanceTree() { return instanceTree; },
    // Dual-shape, exactly like the real Viewer's Model.getObjectTree: called with NO arguments
    // (extraction's own read) it simply returns the tree; called WITH callbacks (findClashes's
    // readiness wait) it settles them per `options.settleObjectTree`. It still returns the tree in
    // both cases so neither caller shape has to special-case it.
    getObjectTree(onSuccess, onError) {
      if (typeof onSuccess === 'function') {
        stats.getObjectTreeWithCallbacksCalls++;
        settleObjectTree(onSuccess, onError, instanceTree);
      }
      return instanceTree;
    },
    // "Returns whether the frag-to-node-id mapping is done" -- the predicate
    // CollisionWorld.findClashes consults for its fast path.
    isObjectTreeCreated() { return objectTreeReady; },
    getFragmentList() { return fragmentList; },
  };

  // Return shape deliberately unchanged ({ model, stats }): a fixture that needs to drive the
  // readiness wait by hand does it entirely through `options.settleObjectTree`, which is handed the
  // real onSuccess/onError callbacks and the tree itself and can fire them whenever it likes.
  return { model, stats };
}
