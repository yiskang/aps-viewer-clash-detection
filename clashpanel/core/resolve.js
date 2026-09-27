// clashpanel/core/resolve.js
// Spec §9.1 resolution contract (read-only; no Viewer mutation). A side is `live` iff the registry binding exists
// AND its bindingGeneration and modelVersion equal the sealed run's provenance row AND the bound Model object is
// currently in the scene (catalog.list(), by identity). Everything is recomputed at use time — nothing is cached
// and no Model is kept in Panel state — so an unload/reload shows up the next time a row or action resolves
// (AC-P7/AC-P8). The registry is only READ (bindingFor); the Panel never registers or repairs a binding (AC-P20).
import { modelDisplayName } from './labels.js';

function provenanceRow(provenance, modelKey) {
  const models = Array.isArray(provenance?.models) ? provenance.models : [];
  for (const row of models) if (row && row.modelKey === modelKey) return row;
  return null;
}

function readBinding(engine, modelKey) {
  try {
    const binding = engine.registry.bindingFor(modelKey);
    return binding ?? null;
  } catch {
    return null;
  }
}

function inScene(catalog, model) {
  let entries;
  try { entries = catalog.list(); } catch { return false; }
  if (!Array.isArray(entries)) return false;
  return entries.some((entry) => entry !== null && typeof entry === 'object' && entry.model === model);
}

const unavailable = (reason, modelKey, dbId) => Object.freeze({ state: 'unavailable', reason, modelKey, dbId });

/**
 * @returns {{state:'live', model, dbId, modelKey} | {state:'unavailable', reason:'not-registered'|'reloaded-since-run'|'version-mismatch'|'not-in-scene', modelKey, dbId}}
 * A missing provenance row (e.g. a planning-failed seal has `provenance.models: []`) is `not-registered`: the run
 * never bound that model, so no binding can be proven to be the one the run used.
 */
export function resolveSide({ ref, provenance, engine, catalog }) {
  const modelKey = ref?.modelKey;
  const dbId = ref?.dbId;
  const row = typeof modelKey === 'string' ? provenanceRow(provenance, modelKey) : null;
  const binding = row === null ? null : readBinding(engine, modelKey);
  if (row === null || binding === null) return unavailable('not-registered', modelKey, dbId);
  if (binding.bindingGeneration !== row.bindingGeneration) return unavailable('reloaded-since-run', modelKey, dbId);
  if (binding.modelVersion !== row.modelVersion) return unavailable('version-mismatch', modelKey, dbId);
  if (!inScene(catalog, binding.model)) return unavailable('not-in-scene', modelKey, dbId);
  return Object.freeze({ state: 'live', model: binding.model, dbId, modelKey });
}

/** Both sides of one result; `notes` carries "<Model name> is not loaded" when exactly one side is live (§9.3). */
export function resolveResult({ record, provenance, engine, catalog }) {
  const first = resolveSide({ ref: record.pair.first, provenance, engine, catalog });
  const second = resolveSide({ ref: record.pair.second, provenance, engine, catalog });
  const anyLive = first.state === 'live' || second.state === 'live';
  const allLive = first.state === 'live' && second.state === 'live';
  const notes = [];
  if (anyLive && !allLive) {
    const down = first.state === 'live' ? second : first;
    notes.push(`${modelDisplayName(catalog, down.modelKey)} is not loaded`);
  }
  return Object.freeze({ sides: Object.freeze([first, second]), anyLive, allLive, notes: Object.freeze(notes) });
}
