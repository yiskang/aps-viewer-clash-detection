// clashpanel/core/labels.js
// Spec §8.2/§10.1/§12.4. Model names come from the host ModelCatalog (they survive unload); element names come
// from the LIVE model's object tree (`getObjectTree()?.getNodeName(dbId)`, never the deprecated instance tree).
// Every name is untrusted external text: it is returned as a raw string and the UI inserts it with textContent
// only (AC-P13). Display labels use a bounded LRU (LABEL_CACHE_MAX, a presentation constant, not a limit); the
// text-filter search index is a separate, per-result-set map built lazily in LIST_CHUNK_SIZE slices by warm().
import { LABEL_CACHE_MAX, LIST_CHUNK_SIZE } from './constants.js';

/** `Model <first 8 chars of modelKey>` — used when the host has no display name for a key. */
export function fallbackModelName(modelKey) {
  const key = String(modelKey ?? '');
  return `Model ${key.length > 8 ? key.slice(0, 8) : key}`;
}

/** The host display name for `modelKey`, or the fallback (also for an empty/blank name). Never throws. */
export function modelDisplayName(catalog, modelKey) {
  let name = null;
  try { name = catalog.displayNameFor(modelKey); } catch { name = null; }
  return typeof name === 'string' && name.trim().length > 0 ? name : fallbackModelName(modelKey);
}

/** Short stable suffix for disambiguation: the whole key when short, else its last 4 characters. */
const keySuffix = (modelKey) => (modelKey.length <= 6 ? modelKey : modelKey.slice(-4));

/**
 * Display names for a set of model keys, made distinguishable: a name shared by two or more keys gets
 * ` · …<suffix>` (the full key if two suffixes still collide); unique names are unchanged. Deterministic.
 */
export function disambiguatedNames(catalog, modelKeys) {
  const base = new Map(modelKeys.map((key) => [key, modelDisplayName(catalog, key)]));
  const byName = new Map();
  for (const [key, name] of base) byName.set(name, [...(byName.get(name) ?? []), key]);
  const out = new Map();
  for (const [name, keys] of byName) {
    if (keys.length === 1) { out.set(keys[0], name); continue; }
    const suffixes = keys.map(keySuffix);
    const clash = new Set(suffixes).size !== suffixes.length;
    keys.forEach((key, i) => out.set(key, `${name} · …${clash ? key : suffixes[i]}`));
  }
  return out;
}

/** Reads one node name from a live model; null when the tree is absent, the call throws or the name is empty. */
export function readNodeName(model, dbId) {
  try {
    const tree = typeof model?.getObjectTree === 'function' ? model.getObjectTree() : null;
    if (!tree || typeof tree.getNodeName !== 'function') return null;
    const name = tree.getNodeName(dbId);
    return typeof name === 'string' && name.length > 0 ? name : null;
  } catch {
    return null;
  }
}

export function createLabelResolver({ catalog, resolveLiveModel, scheduler, knownModelKeys = () => [] }) {
  // LRU keys use a per-Model-object id, so a reloaded model (a new object) never reuses an old model's names.
  const modelIds = new WeakMap();
  let nextModelId = 1;
  const idOf = (model) => {
    let id = modelIds.get(model);
    if (id === undefined) { id = nextModelId; nextModelId += 1; modelIds.set(model, id); }
    return id;
  };
  const lru = new Map();                 // `${modelId}:${dbId}` -> name
  let searchIndex = new Map();           // modelKey -> Map<dbId, lowercased name>
  let warmSeq = 0;
  let names = null;                      // Map<modelKey, disambiguated name>, rebuilt lazily after invalidateNames()

  const liveModel = (modelKey) => {
    try {
      const model = resolveLiveModel(modelKey);
      return model !== null && typeof model === 'object' ? model : null;
    } catch {
      return null;
    }
  };

  function cachedName(model, dbId) {
    const key = `${idOf(model)}:${dbId}`;
    if (lru.has(key)) {
      const hit = lru.get(key);
      lru.delete(key);
      lru.set(key, hit);                 // refresh recency
      return hit;
    }
    const name = readNodeName(model, dbId);
    if (name !== null) {                 // only successes are cached: a tree that becomes ready later is re-read
      lru.set(key, name);
      if (lru.size > LABEL_CACHE_MAX) lru.delete(lru.keys().next().value);
    }
    return name;
  }

  function knownKeys() {
    const keys = new Set();
    try { for (const e of catalog.list() ?? []) if (typeof e?.modelKey === 'string') keys.add(e.modelKey); } catch { /* none */ }
    try { for (const k of knownModelKeys() ?? []) if (typeof k === 'string') keys.add(k); } catch { /* none */ }
    return keys;
  }

  /** Host display name, disambiguated against every other KNOWN model (catalog + displayed run) sharing it. */
  function modelName(modelKey) {
    if (names === null || !names.has(modelKey)) {
      const keys = knownKeys();
      keys.add(modelKey);
      names = disambiguatedNames(catalog, [...keys].sort());
    }
    return names.get(modelKey);
  }

  /** The known-model set or a host name changed (catalog change, new displayed run): recompute names lazily. */
  function invalidateNames() {
    names = null;
  }

  /** Element name when the side's model is live and names it; otherwise `#dbId`. */
  function elementLabel(ref) {
    const model = liveModel(ref.modelKey);
    const name = model === null ? null : cachedName(model, ref.dbId);
    return name ?? `#${ref.dbId}`;
  }

  /** Lowercased searchable text: model name + element name if indexed by warm() + dbId (spec §10.1). */
  function searchText(ref) {
    const name = searchIndex.get(ref.modelKey)?.get(ref.dbId) ?? '';
    return `${modelName(ref.modelKey)} ${name} ${ref.dbId}`.toLowerCase();
  }

  /**
   * Sliced label-index build for the text filter: LIST_CHUNK_SIZE records per slice, scheduler.yield() between
   * slices, isCurrent() checked per slice. Swaps the finished index in atomically; resolves true when it
   * committed, false when superseded (a newer warm() or !isCurrent()).
   */
  async function warm(index, { isCurrent = () => true } = {}) {
    warmSeq += 1;
    const seq = warmSeq;
    const next = new Map();
    const live = new Map();                // one resolveLiveModel per modelKey per pass
    const modelFor = (key) => {
      if (!live.has(key)) live.set(key, liveModel(key));
      return live.get(key);
    };
    const add = (ref) => {
      const model = modelFor(ref.modelKey);
      if (model === null) return;          // unloaded: matching is by model name / dbId only (spec §10.1)
      let perModel = next.get(ref.modelKey);
      if (perModel === undefined) { perModel = new Map(); next.set(ref.modelKey, perModel); }
      if (perModel.has(ref.dbId)) return;
      const name = readNodeName(model, ref.dbId);
      if (name !== null) perModel.set(ref.dbId, name.toLowerCase());
    };
    for (let start = 0; start < index.count; start += LIST_CHUNK_SIZE) {
      if (seq !== warmSeq || !isCurrent()) return false;
      const end = Math.min(index.count, start + LIST_CHUNK_SIZE);
      for (let i = start; i < end; i += 1) {
        const record = index.at(i);
        add(record.pair.first);
        add(record.pair.second);
      }
      await scheduler.yield();
    }
    if (seq !== warmSeq || !isCurrent()) return false;
    searchIndex = next;
    return true;
  }

  /** Drops the search-index names of a model that left the scene (spec §10.1: unloaded ⇒ dbId/model only). */
  function forgetModel(modelKey) {
    searchIndex.delete(modelKey);
  }

  /** Forgets the search index (a new result set is displayed) and cancels an in-flight warm(). */
  function reset() {
    warmSeq += 1;
    searchIndex = new Map();
    names = null;
  }

  return Object.freeze({ modelName, elementLabel, searchText, warm, forgetModel, reset, invalidateNames });
}
