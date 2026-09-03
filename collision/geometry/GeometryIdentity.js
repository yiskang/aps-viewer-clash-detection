// collision/geometry/GeometryIdentity.js
//
// Plain identity value type, no behavior. Two GeometryIdentity values are the same
// identity iff both fields ===. Keyed by (loadEpoch, geometryIndex), never modelId
// (spec:1137-1146) -- loadEpoch is global/monotonic/assigned exactly once per admitted
// Model object, which is what makes this key immune to modelId-reuse aliasing.

export function createGeometryIdentity(loadEpoch, geometryIndex) {
  if (!Number.isInteger(loadEpoch) || loadEpoch < 0) {
    throw new TypeError(`GeometryIdentity: loadEpoch must be a non-negative integer, got ${loadEpoch}`);
  }
  if (!Number.isInteger(geometryIndex) || geometryIndex < 0) {
    throw new TypeError(`GeometryIdentity: geometryIndex must be a non-negative integer, got ${geometryIndex}`);
  }
  return Object.freeze({ loadEpoch, geometryIndex });
}

export function sameGeometryIdentity(a, b) {
  return a.loadEpoch === b.loadEpoch && a.geometryIndex === b.geometryIndex;
}
