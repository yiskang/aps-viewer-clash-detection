// clashpanel/core/resultIndex.js
//
// Spec §8.1: built ONCE per displayed set. It holds REFERENCES to the frozen `results[]` records
// (never copies) plus the Panel's own Map<resultId, canonicalIndex> (Core exports no `getResult`
// and no id helpers, spec §19-11). Soft/Hard comes from the sealed `definition.mode`; a
// pre-resolution seal has `definition: null` (and no results) ⇒ not Soft, no clearance.
// `provenance.models[].elementCount` is deliberately NOT read (G-EC, AC-P12).

export function buildResultIndex(resultSet) {
  if (resultSet === null || typeof resultSet !== 'object' || !Array.isArray(resultSet.results)) {
    throw new TypeError('buildResultIndex: a sealed ResultSet with a results array is required');
  }
  const results = resultSet.results;
  const count = results.length;
  const byId = new Map();
  for (let i = 0; i < count; i += 1) {
    const id = results[i].resultId;
    if (!byId.has(id)) byId.set(id, i);                   // resultIds are unique in a sealed set; first wins defensively
  }
  const definition = resultSet.definition ?? null;
  const mode = typeof definition?.mode === 'string' ? definition.mode : null;
  const isSoft = mode === 'clearance';
  const clearance = isSoft && Number.isFinite(definition.clearance) ? definition.clearance : null;
  const models = Object.freeze((resultSet.provenance?.models ?? []).map((m) => Object.freeze({
    modelKey: m.modelKey, modelVersion: m.modelVersion, bindingGeneration: m.bindingGeneration,
  })));
  return Object.freeze({
    resultSet,
    count,
    at(i) { return Number.isInteger(i) && i >= 0 && i < count ? results[i] : undefined; },
    indexOfResultId(resultId) { const i = byId.get(resultId); return i === undefined ? -1 : i; },
    models,
    mode,
    clearance,
    isSoft,
  });
}
