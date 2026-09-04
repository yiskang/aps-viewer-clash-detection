// Shared test fixture: builds a fake Autodesk.Viewing.Model-shaped object over a plain JS tree
// definition, for testing ViewerModelAdapter's self-driven walk without a live Viewer. Also reused by
// Task 18's CollisionInstance admission fixtures, since those need real ExtractedFragmentRecord input.
//
// Tree node shape: { dbId: number, fragments?: number[], children?: TreeNode[] }
// fragmentGeometry: Map<fragmentId, { geometryIndex: number, matrix?: number[16],
//                                     bounds?: { min: [x,y,z], max: [x,y,z] } }>

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
    getWorldMatrix(fragId, m) {
      const g = fragmentGeometry.get(fragId);
      const matrix = (g && g.matrix) || [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
      m.elements.set(matrix);
    },
    getWorldBounds(fragId, b) {
      const g = fragmentGeometry.get(fragId);
      const bounds = (g && g.bounds) || { min: [0, 0, 0], max: [1, 1, 1] };
      b.min.x = bounds.min[0]; b.min.y = bounds.min[1]; b.min.z = bounds.min[2];
      b.max.x = bounds.max[0]; b.max.y = bounds.max[1]; b.max.z = bounds.max[2];
    },
    getGeometryId(fragId) {
      const g = fragmentGeometry.get(fragId);
      return g ? g.geometryIndex : fragId;
    },
  };

  const model = {
    getInstanceTree() { return instanceTree; },
    getFragmentList() { return fragmentList; },
  };

  return { model, stats };
}
