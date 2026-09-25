// clashtest/derive/attributeSeam.js
// The single seam for the excluded annotation layer (§14.5). A follow-up replaces this body with the four compatibility
// checks (runId, semanticDigest, every provenance.models[*].modelVersion, referenced names) and returns {available:true, get}.
export function resolveAttributes(_resultSet, annotations, _names) {
  if (annotations === undefined || annotations === null) return { available: false, reason: 'annotation-absent' };
  return { available: false, reason: 'annotation-layer-not-implemented' };
}
