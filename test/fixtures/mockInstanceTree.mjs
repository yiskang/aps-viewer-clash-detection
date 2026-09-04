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

export function buildMockModel(rootNodes, fragmentGeometry, options = {}) {
  const stats = options.stats || {
    enumNodeChildrenCalls: 0,
    enumNodeChildrenCallbacks: 0,
    enumNodeFragmentsCalls: 0,
    enumNodeFragmentsCallbacks: 0,
    getChildCountCalls: 0,
  };

  const nodesById = new Map();
  (function index(nodes) {
    for (const node of nodes) {
      nodesById.set(node.dbId, node);
      if (node.children) index(node.children);
    }
  })(rootNodes);

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
  };

  const model = {
    // getObjectTree is the non-deprecated accessor ViewerModelAdapter actually calls
    // (docs/superpowers/specs/instance-tree-readiness-decision.md); getInstanceTree is
    // kept alongside it, pointing at the same fake instanceTree, only because this
    // fixture's own round-18 ground-truth test (ViewerModelAdapter.test.mjs) still
    // calls it directly for an independently-derived comparison.
    getInstanceTree() { return instanceTree; },
    getObjectTree() { return instanceTree; },
    getFragmentList() { return fragmentList; },
  };

  return { model, stats };
}
