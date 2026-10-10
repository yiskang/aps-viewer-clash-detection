// clashpanel/core/testReadiness.js
// Spec §26.6: per-record readiness and "models changed since this run", computed for EVERY record from data the
// Panel already has — the catalog snapshot and registry.bindingFor — with no engine call that needs a held set.
// Readiness is advisory: the editor's validateSetup remains the only Run gate, and the Soft basis is NOT evaluated
// here (it is async and host-supplied; the editor evaluates it on activation, §23). "Models changed" is a Panel-local
// liveness fact (the §9.1 check), never Core freshness. Pure.
import { buildDefinition, participantKeysOf } from './draft.js';
import { resolveSide } from './resolve.js';

export const READINESS = Object.freeze({ COMPLETE: 'setup-complete', LOADING: 'models-loading', MISSING: 'models-missing', INCOMPLETE: 'incomplete' });
export const READINESS_TEXT = Object.freeze({
  'setup-complete': 'Setup complete — readiness to run is checked when opened',
  'models-loading': 'Models are still loading',
  incomplete: 'Setup incomplete',
});
const INCOMPLETE_CONTROLS = new Set(['setA', 'setB', 'clearance']);

export function referencedModelKeys(draft) {
  return participantKeysOf(draft);
}

export function readinessOf({ draft, entries, bindingFor, modelName }) {
  const byKey = new Map();
  for (const e of Array.isArray(entries) ? entries : []) if (typeof e?.modelKey === 'string') byKey.set(e.modelKey, e);
  const models = referencedModelKeys(draft).map((modelKey) => {
    const entry = byKey.get(modelKey);
    let binding = null;
    try { binding = bindingFor(modelKey) ?? null; } catch { binding = null; }
    const state = entry === undefined || binding === null ? 'missing' : entry.loaded === true ? 'loaded' : 'loading';
    return { modelKey, name: modelName(modelKey), state };
  });
  const { problems } = buildDefinition(draft, { verifiedBasis: true });
  const incomplete = problems.some((p) => INCOMPLETE_CONTROLS.has(p.control));
  const missing = models.filter((m) => m.state === 'missing');
  let state = READINESS.COMPLETE;
  if (missing.length > 0) state = READINESS.MISSING;
  else if (models.some((m) => m.state === 'loading')) state = READINESS.LOADING;
  else if (incomplete) state = READINESS.INCOMPLETE;
  const text = state === READINESS.MISSING ? missing.map((m) => `${m.name} is not loaded`).join('; ') : READINESS_TEXT[state];
  return { state, text, models };
}

export function modelsChangedOf({ summary, bindingFor, catalog }) {
  const rows = Array.isArray(summary?.models) ? summary.models : [];
  if (rows.length === 0) return false;
  const provenance = { models: rows };
  const engine = { registry: { bindingFor } };
  return rows.some((row) => resolveSide({ ref: { modelKey: row.modelKey, dbId: 0 }, provenance, engine, catalog }).state !== 'live');
}
