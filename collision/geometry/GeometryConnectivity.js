// collision/geometry/GeometryConnectivity.js
//
// Connected-component decomposition = EDGE-connectivity, not vertex-connectivity
// (spec:1789-1801) -- union-find over triangles sharing an edge (two vertex indices).
// Vertex-connectivity (round 3) was broken by review: two solids joined at a single
// shared vertex merge into one component, which defeats the containment guarantee.
// Ported from spike/geometry-core.mjs's connectivity(), reshaped to the canonical
// GeometryConnectivityResult: per-TRIANGLE componentOf (not per-component triangle
// lists) and per-COMPONENT closedManifold (not one geometry-wide boolean) -- round 7
// scoped manifoldness per-component specifically so one open shell does not condemn
// every closed component sharing the same geometry.

/**
 * @param {{ index: Uint32Array | number[] }} weldedGeometry - the resolved shape of
 *   GeometryRecord.weldPromise (only `index` is used -- topology-only decomposition).
 * @returns {{ componentCount: number, componentOf: Int32Array, closedManifold: boolean[] }}
 */
export function computeGeometryConnectivity({ index }) {
  const triangleCount = index.length / 3;
  const parent = new Int32Array(triangleCount);
  for (let i = 0; i < triangleCount; i++) parent[i] = i;

  const find = (x) => {
    while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
    return x;
  };
  const union = (a, b) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  const edgeMap = new Map();
  for (let t = 0; t < triangleCount; t++) {
    for (let e = 0; e < 3; e++) {
      const v0 = index[t * 3 + e];
      const v1 = index[t * 3 + ((e + 1) % 3)];
      const key = v0 < v1 ? `${v0}_${v1}` : `${v1}_${v0}`;
      let list = edgeMap.get(key);
      if (!list) { list = []; edgeMap.set(key, list); }
      list.push(t);
    }
  }
  for (const tris of edgeMap.values()) {
    for (let i = 1; i < tris.length; i++) union(tris[0], tris[i]);
  }

  // Assign dense, 0-based component ids in order of first-encountered root (stable
  // and deterministic given a fixed triangle order -- not itself a correctness
  // requirement, just reproducible test output).
  const rootToComponentId = new Map();
  const componentOf = new Int32Array(triangleCount);
  for (let t = 0; t < triangleCount; t++) {
    const root = find(t);
    let id = rootToComponentId.get(root);
    if (id === undefined) {
      id = rootToComponentId.size;
      rootToComponentId.set(root, id);
    }
    componentOf[t] = id;
  }
  const componentCount = rootToComponentId.size;

  // Manifold classification is a byproduct of the same edge map: a component is
  // manifold iff EVERY edge is shared by exactly 2 triangles (spec:1808-1812).
  // Boundary edges (shared by 1 -- open shell) and non-manifold edges (shared by 3+
  // -- junction geometry) both flag their OWNING component only, never the whole
  // geometry (round 7: a geometry-wide flag would condemn every closed component
  // sharing space with one open shell elsewhere in the same geometry).
  const closedManifold = new Array(componentCount).fill(true);
  for (const tris of edgeMap.values()) {
    if (tris.length !== 2) {
      closedManifold[componentOf[tris[0]]] = false;
    }
  }

  return { componentCount, componentOf, closedManifold };
}
