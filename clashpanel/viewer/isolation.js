// clashpanel/viewer/isolation.js
// Isolation model of spec §9.4/§9.5 (Tier B; proven against fakes only — live isolation semantics are
// gated G2/PG-1). Pure helpers + one small stateful session. Receives the ViewerApi facade by
// injection; names no Viewer global.
//
// Canonical normalization (§9.5): entries keyed by model OBJECT identity (never modelId), ids sorted and
// de-duplicated, an entry with empty ids ("show all of that model") is a state distinct from absence,
// entry order irrelevant. Anything that does not have that shape is NOT normalizable (null) — and an
// unnormalizable read disables isolation; it is never compensated with a clear-all.

export const ISOLATION_REASON = Object.freeze({
  UNREADABLE: 'Isolation is unavailable: the current isolation state could not be read',
  HIDDEN: 'Some elements are hidden — show all to enable isolation',
  HIDDEN_UNREADABLE: 'Isolation is unavailable: the hidden-element state could not be read',
  NOT_IN_SCENE: "Isolation skipped: an element's model is no longer in the scene",
});

// Notes attached to ClearOutcome.isolation === 'failed'.
export const ISOLATION_NOTE = Object.freeze({
  UNREADABLE_AT_RESTORE: 'Isolation could not be read; left unchanged.',
  RESTORE_FAILED: 'Isolation could not be restored (the Viewer reported an error).',
});

const isDbId = (v) => Number.isInteger(v) && v >= 0;
const isModel = (v) => v !== null && typeof v === 'object';

export function normalizeIsolation(list) {
  if (!Array.isArray(list)) return null;
  const seen = new Set();
  const out = [];
  for (const entry of list) {
    if (entry === null || typeof entry !== 'object' || !isModel(entry.model) || !Array.isArray(entry.ids)) return null;
    if (seen.has(entry.model)) return null;           // two entries for one model: ambiguous → not normalizable
    if (!entry.ids.every(isDbId)) return null;
    seen.add(entry.model);
    out.push(Object.freeze({ model: entry.model, ids: Object.freeze([...new Set(entry.ids)].sort((a, b) => a - b)) }));
  }
  return Object.freeze(out);
}

export function isolationEquals(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  const byModel = new Map(b.map((e) => [e.model, e.ids]));
  return a.every((e) => {
    const other = byModel.get(e.model);
    return other !== undefined && other.length === e.ids.length && other.every((id, i) => id === e.ids[i]);
  });
}

// One reconcile entry per model; never {model, ids:[]} (that would SHOW the whole model).
export function targetFor(sides) {
  if (!Array.isArray(sides) || sides.length === 0) throw new TypeError('targetFor: sides must be a non-empty array');
  const byModel = new Map();
  for (const side of sides) {
    if (!isModel(side?.model) || !isDbId(side?.dbId)) throw new TypeError('targetFor: each side needs {model, dbId}');
    if (!byModel.has(side.model)) byModel.set(side.model, []);
    byModel.get(side.model).push(side.dbId);
  }
  return normalizeIsolation([...byModel].map(([model, ids]) => ({ model, ids })));
}

export function readIsolation(viewerApi) {
  try {
    if (typeof viewerApi.getAggregateIsolation !== 'function') return null;
    return normalizeIsolation(viewerApi.getAggregateIsolation());
  } catch {
    return null;
  }
}

// §9.5 prerequisite: (a) isolation readable + normalizable; (b) no hidden nodes on any model in the scene.
export function isolationPrerequisite(viewerApi) {
  if (readIsolation(viewerApi) === null) return Object.freeze({ available: false, reason: ISOLATION_REASON.UNREADABLE });
  let hidden;
  let inScene;
  try {
    if (typeof viewerApi.getAggregateHiddenNodes !== 'function') throw new TypeError('no hidden-node reader');
    hidden = viewerApi.getAggregateHiddenNodes();
    inScene = viewerApi.getAllModels();
  } catch {
    return Object.freeze({ available: false, reason: ISOLATION_REASON.HIDDEN_UNREADABLE });
  }
  if (!Array.isArray(hidden) || !Array.isArray(inScene)) return Object.freeze({ available: false, reason: ISOLATION_REASON.HIDDEN_UNREADABLE });
  for (const entry of hidden) {
    if (entry === null || typeof entry !== 'object' || !Array.isArray(entry.ids)) {
      return Object.freeze({ available: false, reason: ISOLATION_REASON.HIDDEN_UNREADABLE });
    }
    if (inScene.includes(entry.model) && entry.ids.length > 0) return Object.freeze({ available: false, reason: ISOLATION_REASON.HIDDEN });
  }
  return Object.freeze({ available: true, reason: null });
}

const toViewerList = (normalized) => normalized.map((e) => ({ model: e.model, ids: [...e.ids] }));

// Session = the isolation half of the bridge's resource ledger. `record` is the WRITE-AHEAD entry:
// {preImage, target, prevTarget, confirmed}; restore() is the ownership-guarded undo. preImage is the state before the Panel's ownership began
// (captured, via a fresh read, immediately before the first isolating mutation of a session);
// prevTarget is the Panel's own previously displayed target while a replacement is in flight.
export function createIsolationSession(viewerApi) {
  let record = null;
  const ours = (cur, r) => isolationEquals(cur, r.target) || (r.prevTarget !== null && isolationEquals(cur, r.prevTarget));

  function apply(sides, { beforeMutation } = {}) {
    const target = targetFor(sides);
    let inScene;
    try { inScene = viewerApi.getAllModels(); } catch { inScene = null; }
    if (!Array.isArray(inScene) || !target.every((e) => inScene.includes(e.model))) {
      return { applied: false, reason: ISOLATION_REASON.NOT_IN_SCENE };
    }
    const cur = readIsolation(viewerApi);
    if (cur === null) return { applied: false, reason: ISOLATION_REASON.UNREADABLE };
    let preImage;
    let prevTarget = null;
    if (record !== null && ours(cur, record)) {
      preImage = record.preImage;                     // ownership continues: prior kept (§9.6 row 1)
      prevTarget = cur;
    } else {
      record = null;                                  // no ownership, or lost to a foreign change: new session
      const pre = isolationPrerequisite(viewerApi);
      if (!pre.available) return { applied: false, reason: pre.reason };
      // FINAL read immediately before the write-ahead record: a change made during the prerequisite reads
      // (e.g. by a listener) is the pre-image, never clobbered. Unreadable now ⇒ fail closed, no mutation.
      const fresh = readIsolation(viewerApi);
      if (fresh === null) return { applied: false, reason: ISOLATION_REASON.UNREADABLE };
      preImage = fresh;
    }
    record = { preImage, target, prevTarget, confirmed: false };   // write-ahead: intent + pre-image
    if (beforeMutation) beforeMutation();
    viewerApi.setAggregateIsolation(toViewerList(target));
    record.confirmed = true;
    record.prevTarget = null;
    return { applied: true, reason: null };
  }

  // One call + at most one retry, each followed by read-and-compare. 'failed' = the Viewer kept throwing
  // or became unreadable (the caller KEEPS the record so a later clear/dispose retries); 'skipped-external'
  // only when the state is now genuinely someone else's.
  function restoreTo(preImage, r) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        viewerApi.setAggregateIsolation(toViewerList(preImage));
        return { isolation: 'restored', notes: [] };
      } catch {
        const cur = readIsolation(viewerApi);
        if (cur === null) break;                                     // unreadable: never retry blind
        if (isolationEquals(cur, preImage)) return { isolation: 'restored', notes: [] };
        if (!ours(cur, r)) return { isolation: 'skipped-external', notes: [] };   // foreign now: leave it
      }
    }
    return { isolation: 'failed', notes: [ISOLATION_NOTE.RESTORE_FAILED] };
  }

  // Ownership-guarded release (§9.4): restore preImage ONLY if the current isolation is still the
  // Panel's own; otherwise leave it (foreign). Covers confirmed and pending (ambiguous) records. The record
  // (pre-image + ownership) is dropped ONLY on a confirmed outcome — restored, pre-image already in place, or
  // confirmed foreign state; an unreadable state or a failed restore KEEPS it for the next clear/dispose.
  function restore({ beforeMutation } = {}) {
    if (record === null) return { isolation: 'none', notes: [] };
    const r = record;
    const cur = readIsolation(viewerApi);
    if (cur === null) return { isolation: 'failed', notes: [ISOLATION_NOTE.UNREADABLE_AT_RESTORE] };
    if (!ours(cur, r)) {
      record = null;
      return { isolation: !r.confirmed && isolationEquals(cur, r.preImage) ? 'none' : 'skipped-external', notes: [] };
    }
    if (beforeMutation) beforeMutation();             // may throw: the record stays for the next cleanup
    const result = restoreTo(r.preImage, r);
    if (result.isolation !== 'failed' && record === r) record = null;
    return result;
  }

  return Object.freeze({
    apply,
    restore,
    owns: () => record !== null,
    record: () => (record === null ? null : Object.freeze({ ...record })),
  });
}
