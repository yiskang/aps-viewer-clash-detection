// clashpanel/core/elementProperties.js
//
// The Panel's ONLY element-property read path (package brief §4, §5, §11): the metadata behind the Category and Level
// group modes. Same seam as element names (labels.js readNodeName): the live Model of a side is resolved through the
// controller's host/model lookup (engine registry binding validated against the displayed run's provenance and the
// catalog's scene list — resolve.js), and only that Model object's own read method is called. Nothing here touches
// the Viewer3D, the DOM or any global; tests inject Model-shaped fakes.
//
// Read contract (Viewer 7.124.2, SVF2, live-probed by the owner; a PINNED-BUILD assumption, not re-verified here):
//   model.getBulkProperties2(dbIds, {propFilter}, onSuccess(rows), onError)   rows = [{dbId, name, properties:[
//     {displayName, attributeName, displayCategory, displayValue, …}]}]; with a propFilter only matching properties
//   come back (matched by displayName / attributeName) and `name` is undefined; an UNFILTERED call carries `name`.
//   Fallback when getBulkProperties2 is absent: the legacy model.getBulkProperties(dbIds, options, onSuccess, onError).
//   Neither present ⇒ 'properties-unsupported'; onError / a throw / a non-array answer ⇒ 'properties-error'.
// The read is chunked (≤ PROPERTY_CHUNK_SIZE ids per call, one scheduler.yield() per chunk), generation-guarded
// (isCurrent() before and after every call; a stale answer is dropped as 'superseded') and cached: ONE filtered read
// per loaded model per result generation, for ONLY the distinct dbIds that appear in the displayed result set (both
// sides), plus ONE unfiltered read of the referenced Revit Level elements (Level mode only). The source object lives in
// the controller's per-generation pipe, so a new run / clear drops it; a model unload calls invalidate().
// A participating model that is not live ⇒ 'model-not-loaded': the Panel never labels an unreadable element
// "Unknown" (that label means "the element reports no such metadata").
// There is no read timeout: a host read that never answers leaves that mode pending (busy, flat list) until the
// next generation / unload (recorded limitation).

export const PROPERTY_CHUNK_SIZE = 2000;

/** The attributes the element read asks for: Category, and every Level-precedence source (both 'Level' attributes —
 *  the __internalref__ reference and the Constraints string — share the name and are told apart by displayCategory). */
export const ELEMENT_PROP_FILTER = Object.freeze(['Category', 'Level', 'Reference Level', 'Base Level', 'Base Constraint']);

const SUPERSEDED = Object.freeze({ status: 'superseded' });
const unavailable = (reason) => Object.freeze({ status: 'unavailable', reason });
const isFn = (v) => typeof v === 'function';

function callBulk(model, ids, options) {
  const read = isFn(model?.getBulkProperties2) ? 'getBulkProperties2' : isFn(model?.getBulkProperties) ? 'getBulkProperties' : null;
  if (read === null) return Promise.resolve({ kind: 'unsupported' });
  return new Promise((resolve) => {
    try {
      model[read](ids, options, (rows) => resolve({ kind: 'rows', rows }), () => resolve({ kind: 'error' }));
    } catch {
      resolve({ kind: 'error' });
    }
  });
}

/**
 * Chunked bulk read of `dbIds` from one live Model. `propFilter` null ⇒ unfiltered.
 * @returns {Promise<{status:'ok', rows:object[]} | {status:'unavailable', reason:'properties-unsupported'|'properties-error'} | {status:'superseded'}>}
 */
export async function readBulkProperties({ model, dbIds, propFilter, scheduler, isCurrent }) {
  const options = Array.isArray(propFilter) ? { propFilter: [...propFilter] } : {};
  const rows = [];
  for (let start = 0; start < dbIds.length; start += PROPERTY_CHUNK_SIZE) {
    if (!isCurrent()) return SUPERSEDED;
    const answer = await callBulk(model, dbIds.slice(start, start + PROPERTY_CHUNK_SIZE), options);
    if (!isCurrent()) return SUPERSEDED;
    if (answer.kind === 'unsupported') return unavailable('properties-unsupported');
    if (answer.kind !== 'rows' || !Array.isArray(answer.rows)) return unavailable('properties-error');
    for (const row of answer.rows) rows.push(row);
    await scheduler.yield();
  }
  return isCurrent() ? Object.freeze({ status: 'ok', rows }) : SUPERSEDED;
}

const nonEmpty = (v) => typeof v === 'string' && v.trim().length > 0;
const named = (p, name) => p?.displayName === name || p?.attributeName === name;
const isInternal = (p) => typeof p?.displayCategory === 'string' && p.displayCategory.startsWith('__');
const LEVEL_STRING_SOURCES = Object.freeze([
  (p) => named(p, 'Level') && p.displayCategory === 'Constraints',      // (2) the Constraints "Level" string
  (p) => named(p, 'Reference Level') && !isInternal(p),                  // (3)
  (p) => named(p, 'Base Level') && !isInternal(p),                       // (4)
  (p) => named(p, 'Base Constraint') && !isInternal(p),                  // (5)
]);

/**
 * The grouping facts of one element row: {category, levelRef, levelStrings:[constraintsLevel, referenceLevel,
 * baseLevel, baseConstraint]}. category = the '__category__' 'Category' string (missing / empty / non-string ⇒ null;
 * the RAW string is kept — trimming is only the emptiness test). levelRef = the '__internalref__' 'Level' value when
 * it is an integer (the dbId of a Revit Level element in the SAME model). Within one source the first matching
 * property wins. Never derived from dbId or geometry.
 */
export function elementFactsOf(row) {
  const properties = Array.isArray(row?.properties) ? row.properties : [];
  let category = null;
  let levelRef = null;
  const levelStrings = [null, null, null, null];
  for (const p of properties) {
    if (category === null && named(p, 'Category') && p.displayCategory === '__category__' && nonEmpty(p.displayValue)) category = p.displayValue;
    if (levelRef === null && named(p, 'Level') && p.displayCategory === '__internalref__' && Number.isInteger(p.displayValue)) levelRef = p.displayValue;
    LEVEL_STRING_SOURCES.forEach((matches, i) => {
      if (levelStrings[i] === null && matches(p) && nonEmpty(p.displayValue)) levelStrings[i] = p.displayValue;
    });
  }
  return Object.freeze({ category, levelRef, levelStrings: Object.freeze(levelStrings) });
}

const LEVEL_ID_SUFFIX = / \[\d+\]$/;

/** A Revit Level element's name from an UNFILTERED row: `name` (else a 'Name' property), trailing " [<digits>]"
 *  (the element-id suffix the pinned build appends, e.g. 'FIRST FLOOR [30]') stripped; empty ⇒ null. */
export function levelNameOf(row) {
  let raw = typeof row?.name === 'string' ? row.name : null;
  if (raw === null && Array.isArray(row?.properties)) {
    const p = row.properties.find((q) => (q?.displayName === 'Name' || q?.attributeName === 'name') && typeof q.displayValue === 'string');
    raw = p ? p.displayValue : null;
  }
  if (raw === null) return null;
  const name = raw.replace(LEVEL_ID_SUFFIX, '');
  return nonEmpty(name) ? name : null;
}

/** Distinct dbIds per modelKey over both sides of every result, ascending; modelKeys in sorted order. */
function idsByModel(resultSet) {
  const byModel = new Map();
  for (const r of resultSet.results) {
    for (const ref of [r.pair.first, r.pair.second]) {
      let ids = byModel.get(ref.modelKey);
      if (ids === undefined) { ids = new Set(); byModel.set(ref.modelKey, ids); }
      ids.add(ref.dbId);
    }
  }
  return [...byModel.keys()].sort().map((key) => [key, [...byModel.get(key)].sort((a, b) => a - b)]);
}

/**
 * The per-generation, cached property source the property group modes read through.
 *   facts()  → {status:'ok', facts: Map<modelKey, Map<dbId, elementFacts>>} | unavailable | superseded
 *   levels() → {status:'ok', facts, levelNames: Map<modelKey, Map<levelDbId, name>>} | unavailable | superseded
 *   invalidate() — a model left the scene: drop the cache and supersede in-flight reads.
 * `resolveModel(modelKey)` → the live Model or null. Each outcome promise is memoized until invalidate().
 */
export function createElementPropertySource({ resultSet, resolveModel, scheduler, isCurrent }) {
  let epoch = 0;
  let factsPromise = null;
  let levelsPromise = null;

  const liveModel = (key) => {
    try { const m = resolveModel(key); return m !== null && typeof m === 'object' ? m : null; } catch { return null; }
  };

  async function readFacts(myEpoch) {
    const current = () => myEpoch === epoch && isCurrent();
    const facts = new Map();
    for (const [modelKey, ids] of idsByModel(resultSet)) {
      const model = liveModel(modelKey);
      if (model === null) return unavailable('model-not-loaded');
      const out = await readBulkProperties({ model, dbIds: ids, propFilter: ELEMENT_PROP_FILTER, scheduler, isCurrent: current });
      if (out.status !== 'ok') return out;
      const perModel = new Map();
      for (const row of out.rows) if (Number.isInteger(row?.dbId) && !perModel.has(row.dbId)) perModel.set(row.dbId, elementFactsOf(row));
      facts.set(modelKey, perModel);
    }
    return current() ? Object.freeze({ status: 'ok', facts }) : SUPERSEDED;
  }

  async function readLevels(myEpoch) {
    const current = () => myEpoch === epoch && isCurrent();
    const base = await facts();
    if (base.status !== 'ok') return base;
    const levelNames = new Map();
    for (const modelKey of [...base.facts.keys()].sort()) {
      const refs = new Set();
      for (const f of base.facts.get(modelKey).values()) if (f.levelRef !== null) refs.add(f.levelRef);
      if (refs.size === 0) continue;
      const model = liveModel(modelKey);
      if (model === null) return unavailable('model-not-loaded');
      const out = await readBulkProperties({ model, dbIds: [...refs].sort((a, b) => a - b), propFilter: null, scheduler, isCurrent: current });
      if (out.status !== 'ok') return out;
      const names = new Map();
      for (const row of out.rows) {
        const name = levelNameOf(row);
        if (Number.isInteger(row?.dbId) && name !== null && !names.has(row.dbId)) names.set(row.dbId, name);
      }
      levelNames.set(modelKey, names);
    }
    return current() ? Object.freeze({ status: 'ok', facts: base.facts, levelNames }) : SUPERSEDED;
  }

  // A TRANSIENT outcome ('properties-error', 'model-not-loaded') is not kept: once settled, its promise is dropped so the
  // next request (the user re-selecting the mode; never an automatic retry) reads again. 'properties-unsupported' and
  // 'ok' stay cached. A promise that was already replaced by invalidate() is left alone.
  const TRANSIENT = new Set(['properties-error', 'model-not-loaded']);
  const isTransient = (r) => r?.status === 'unavailable' && TRANSIENT.has(r.reason);
  const settleSafely = (p) => p.then((r) => r, () => unavailable('properties-error'));

  function facts() {
    if (factsPromise === null) {
      const mine = settleSafely(readFacts(epoch));
      factsPromise = mine;
      mine.then((r) => { if (isTransient(r) && factsPromise === mine) factsPromise = null; });
    }
    return factsPromise;
  }
  function levels() {
    if (levelsPromise === null) {
      const mine = settleSafely(readLevels(epoch));
      levelsPromise = mine;
      mine.then((r) => { if (isTransient(r) && levelsPromise === mine) levelsPromise = null; });
    }
    return levelsPromise;
  }
  function invalidate() {
    epoch += 1;
    factsPromise = null;
    levelsPromise = null;
  }
  return Object.freeze({ facts, levels, invalidate });
}
