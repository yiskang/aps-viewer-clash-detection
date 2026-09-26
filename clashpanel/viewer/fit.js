// clashpanel/viewer/fit.js
// Focus/fit (spec §9.2 "Focus / fit", §16 Framing). Best-effort, last, never rolled back: a failure
// only adds a note. Tier B: proven against fakes only; whether the aggregate (cross-model) form frames
// the true world-space union is a live gate (G2 / PG-1).
//   one model  -> public per-model fitToView(ids, model)
//   two models -> aggregate fit [{model, selection:[dbId]}, …] (unpublished; key MUST be `selection`)
//                 behind hasAggregateFit() + try/catch; fallback: fit the first side + note.

export const FIT_NOTE = Object.freeze({
  FIRST_ONLY: 'Framing first element only',
  FAILED: 'Could not frame the clash',
});

// isCurrent() is re-checked IMMEDIATELY before every camera call (aggregate, per-model and fallback): a
// stale presentation never moves the camera. Not current ⇒ no call, {fitted:false, superseded:true}; a camera
// move that already happened is never rolled back (OD-6).
export function fitSides(viewerApi, sides, isCurrent = () => true) {
  const notes = [];
  if (!Array.isArray(sides) || sides.length === 0) return { fitted: false, notes };
  const byModel = new Map();
  for (const s of sides) {
    if (!byModel.has(s.model)) byModel.set(s.model, new Set());
    byModel.get(s.model).add(s.dbId);
  }
  const perModel = [...byModel].map(([model, ids]) => ({ model, ids: [...ids].sort((a, b) => a - b) }));
  const stale = () => ({ fitted: false, notes, superseded: true });
  const fitOne = (entry) => {
    if (!isCurrent()) return stale();
    try { viewerApi.fitToView([...entry.ids], entry.model); return { fitted: true, notes }; } catch { notes.push(FIT_NOTE.FAILED); return { fitted: false, notes }; }
  };

  if (perModel.length === 1) return fitOne(perModel[0]);
  let aggregate = false;
  try { aggregate = viewerApi.hasAggregateFit() === true; } catch { aggregate = false; }
  if (aggregate) {
    if (!isCurrent()) return stale();
    try {
      viewerApi.fitToViewAggregate(perModel.map((e) => ({ model: e.model, selection: [...e.ids] })));
      return { fitted: true, notes };
    } catch { /* fall through to the per-model fallback (guarded again) */ }
  }
  notes.push(FIT_NOTE.FIRST_ONLY);
  return fitOne({ model: sides[0].model, ids: [sides[0].dbId] });
}
