// clashtest/definition/normalize.js
//
// Definition normalization and the roots contract. This file is built in sections; later sections
// (normalizeDefinition, canonicalSemanticForm, computeSemanticDigest, prepareDefinition,
// deepFreezeDefinition) are appended below the P2.9 section.

import { digestCanonical, digestCanonicalSliced } from '../util/canonical.js';
import { deepFreeze, deepFreezeSliced } from '../util/capture.js';
import { createSlicer } from '../util/slicer.js';
import { ENGINE_LIMIT_DEFAULTS } from '../options.js';

// ---- P2.9 roots contract ----------------------------------------------------------------------------
// Pure rule INPUTS for spec 5.6, computed from the {dbId, ownerDbIds} fields of ElementEnumerator.resolveRoots
// records. No tree access; P3 owns the planning consequences.

const MAX_OFFENDERS = 20;
/**
 * 5.6.2: the returned roots must form an antichain (no root's subtree contains another's).
 *
 * Violation semantics (unchanged): for each ordered pair (i, j), i != j, in (i asc, j asc) order --
 *   same dbId: only i < j is reported, as {ancestor: dbId, descendant: dbId};
 *   different dbId: j is a descendant of i iff ownerDbIds(j) is a subset of ownerDbIds(i), so a root whose
 *   ownerDbIds is EMPTY is a descendant of every root with a different dbId. At most 20 are returned.
 * Implementation: an inverted index owner -> root indices is built once (each ownerDbIds read exactly once).
 * For root i, incrementing a counter over the index lists of i's distinct owners finds every j sharing an owner
 * with i; j is a descendant iff the counter reaches j's distinct-owner count. Empty-owner roots and same-dbId
 * duplicates are added directly. Candidates are emitted j-ascending and the scan stops at the 20th violation.
 * A valid antichain (disjoint owner sets) therefore costs O(total owners).
 */
export function assertRootAntichain(roots) {
  const n = roots.length;
  const distinct = new Array(n);            // per root: its ownerDbIds without repeats
  const index = new Map();                  // owner dbId -> ascending root indices that own it
  const empty = [];                         // roots with no owners
  const byDbId = new Map();                 // root dbId -> ascending root indices
  for (let r = 0; r < n; r += 1) {
    const list = roots[r].ownerDbIds;
    const len = list.length;
    const mine = [];
    for (let k = 0; k < len; k += 1) {
      const owner = list[k];
      let bucket = index.get(owner);
      if (bucket === undefined) { bucket = []; index.set(owner, bucket); }
      if (bucket[bucket.length - 1] !== r) { bucket.push(r); mine.push(owner); }
    }
    distinct[r] = mine;
    if (mine.length === 0) empty.push(r);
    const same = byDbId.get(roots[r].dbId);
    if (same === undefined) byDbId.set(roots[r].dbId, [r]); else same.push(r);
  }

  const violations = [];
  const shared = new Int32Array(n);         // shared[j] = |distinct owners of j that i also owns|, reset per i
  const touched = [];
  for (let i = 0; i < n; i += 1) {
    const dbId = roots[i].dbId;
    touched.length = 0;
    for (const owner of distinct[i]) {
      for (const j of index.get(owner)) {
        if (j === i) continue;
        if (shared[j] === 0) touched.push(j);
        shared[j] += 1;
      }
    }
    const candidates = [];
    for (const j of touched) {
      if (shared[j] === distinct[j].length && roots[j].dbId !== dbId) candidates.push(j);
      shared[j] = 0;
    }
    for (const j of empty) if (j !== i && roots[j].dbId !== dbId) candidates.push(j);
    for (const j of byDbId.get(dbId)) if (j > i) candidates.push(j);
    if (candidates.length > 1) candidates.sort((x, y) => x - y);
    for (const j of candidates) {
      violations.push({ ancestor: dbId, descendant: roots[j].dbId });
      if (violations.length >= MAX_OFFENDERS) return { ok: false, violations };
    }
  }
  return { ok: violations.length === 0, violations };
}

/** 5.6.5 rule INPUT: supported iff RU = RA u RB as dbId sets. The planner's use of it is P3. */
export function checkCrossRoleNesting({ rootsA, rootsB, rootsUnion }) {
  const roleRoots = new Map();
  for (const r of [...rootsA, ...rootsB]) if (!roleRoots.has(r.dbId)) roleRoots.set(r.dbId, r);
  const unionIds = new Set(rootsUnion.map((r) => r.dbId));
  const enumeratorInconsistent = rootsUnion.some((r) => !roleRoots.has(r.dbId));

  const dropped = [...roleRoots.keys()].filter((id) => !unionIds.has(id)).sort((a, b) => a - b);
  const unionOwnerSets = new Array(rootsUnion.length);   // built lazily, once per union root (not per descendant)
  const ownerSetOf = (k) => (unionOwnerSets[k] ??= new Set(rootsUnion[k].ownerDbIds));
  const offenders = [];
  for (const descendant of dropped) {
    if (offenders.length >= MAX_OFFENDERS) break;
    const owners = roleRoots.get(descendant).ownerDbIds;
    let ancestor;                                          // the smallest containing union root dbId
    for (let k = 0; k < rootsUnion.length; k += 1) {
      const u = rootsUnion[k];
      if (u.dbId === descendant || (ancestor !== undefined && u.dbId >= ancestor)) continue;
      const set = ownerSetOf(k);
      if (owners.every((o) => set.has(o))) ancestor = u.dbId;
    }
    offenders.push({ ancestor: ancestor === undefined ? null : ancestor, descendant });
  }
  return {
    supported: offenders.length === 0 && dropped.length === 0 && !enumeratorInconsistent,
    offenders,
    enumeratorInconsistent,
  };
}

/** 5.6.3 rule INPUT: a root in A n B whose subtree owns two or more fragment-owning nodes. */
export function hierarchyInternalCandidates({ rootsA, rootsB }) {
  const inB = new Set(rootsB.map((r) => r.dbId));
  return rootsA
    .filter((r) => inB.has(r.dbId) && r.ownerDbIds.length >= 2)
    .map((r) => ({ dbId: r.dbId, ownerCount: r.ownerDbIds.length }))
    .sort((a, b) => a.dbId - b.dbId);
}

// ---- P2.4 normalization, canonical form and semanticDigest ------------------------------------------

const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const SIDES = ['selectionA', 'selectionB'];

/**
 * ONE normalization body, written as a generator so the synchronous `normalizeDefinition` and the sliced
 * `prepareDefinition` cannot drift: the sync driver ignores the yields, the sliced driver turns each one
 * into `slicer.tick()`. It reads only the `captured` value it is handed.
 */
function* normalizeSteps(captured) {
  const definition = {
    schemaVersion: 1,
    testId: captured.testId,
    revision: captured.revision,
    name: captured.name,
    selectionA: null,
    selectionB: null,
    mode: captured.mode,
  };
  if ('description' in captured) definition.description = captured.description;
  if (captured.mode === 'clearance') definition.clearance = captured.clearance;
  for (const side of SIDES) definition[side] = yield* normalizeSelectionSteps(captured[side]);
  return definition;
}

/** Appends every not-yet-seen id to `acc.list`, yielding after each id (spec 17.3: a checkpoint at least every 64 items). */
function* unionInto(acc, ids) {
  for (let i = 0; i < ids.length; i += 1) {
    const id = ids[i];
    if (!acc.seen.has(id)) { acc.seen.add(id); acc.list.push(id); }
    yield;
  }
}

/**
 * Ascending numeric merge sort as a generator (bottom-up, one yield per element written), so a 100,000-id list
 * never runs as one native `.sort()` span. The input holds unique numbers (it comes out of `unionInto`), so
 * the result is exactly `[...values].sort((a, b) => a - b)`. Sorts `values` in place / into a scratch array
 * and returns whichever holds the result.
 */
function* sortAscending(values) {
  const n = values.length;
  let src = values;
  if (n < 2) return src;
  let dst = new Array(n);
  for (let width = 1; width < n; width *= 2) {
    for (let lo = 0; lo < n; lo += 2 * width) {
      const mid = Math.min(lo + width, n);
      const hi = Math.min(lo + 2 * width, n);
      let i = lo; let j = mid;
      for (let k = lo; k < hi; k += 1) {
        dst[k] = (i < mid && (j >= hi || src[i] <= src[j])) ? src[i++] : src[j++];
        yield;
      }
    }
    [src, dst] = [dst, src];
  }
  return src;
}

function* normalizeSelectionSteps(selection) {
  /** @type {Map<string, {kind: 'model'} | {kind: 'elements', acc: {seen: Set<number>, list: number[]}}>} */
  const byModel = new Map();
  for (const entry of selection.entries) {
    yield;
    const current = byModel.get(entry.modelKey);
    if (entry.kind === 'model') { byModel.set(entry.modelKey, { kind: 'model' }); continue; }
    if (current && current.kind === 'model') continue; // 5.2: model wins
    if (current) { yield* unionInto(current.acc, entry.dbIds); continue; }
    const acc = { seen: new Set(), list: [] };
    byModel.set(entry.modelKey, { kind: 'elements', acc });
    yield* unionInto(acc, entry.dbIds);
  }
  const entries = [];
  for (const modelKey of [...byModel.keys()].sort(byCodeUnit)) {
    yield;
    const v = byModel.get(modelKey);
    entries.push(v.kind === 'model'
      ? { kind: 'model', modelKey }
      : { kind: 'elements', modelKey, dbIds: yield* sortAscending(v.acc.list) });
  }
  return { entries };
}

/** Pure, synchronous; input MUST be a `captured` value from captureAndValidate (already V-valid). */
export function normalizeDefinition(captured) {
  const steps = normalizeSteps(captured);
  let r = steps.next();
  while (!r.done) r = steps.next();
  return r.value;
}

/** 5.4: role-tagged by the keys themselves; name/description/revision/testId excluded. */
export function canonicalSemanticForm(normalized) {
  const form = { mode: normalized.mode, selectionA: normalized.selectionA, selectionB: normalized.selectionB };
  if (normalized.mode === 'clearance') form.clearance = normalized.clearance;
  return form;
}

/** `'sha256:' + hex` over the canonical JSON of the canonical form -- P0's value-taking `digestCanonical`. */
export function computeSemanticDigest(normalized) {
  return digestCanonical(canonicalSemanticForm(normalized));
}

// ---- P2.5 deep freeze and sliced prepareDefinition --------------------------------------------------

/** Idempotent deep freeze of the closed definition shape (P0's iterative `deepFreeze`). */
export function deepFreezeDefinition(def) {
  return deepFreeze(def);
}

/**
 * The sliced post-validation body of 5.3: normalize -> digest -> deep-freeze, over the CAPTURED copy only.
 * It never touches the caller's object, so a mutation made at any yield is inert. `limits` (resolved engine
 * limits; missing keys fall back to P0's defaults) supply `sliceBudgetMs` / `aggregationSliceMaxItems`.
 */
export async function prepareDefinition(captured, { yieldToScheduler, now, sliceBudgetMs, limits } = {}) {
  const slicer = createSlicer({ now, yieldToScheduler, limits: { ...ENGINE_LIMIT_DEFAULTS, ...limits }, sliceBudgetMs });
  const steps = normalizeSteps(captured);
  let definition;
  for (let r = steps.next(); ; r = steps.next()) {
    if (r.done) { definition = r.value; break; }
    const pending = slicer.tick('normalize');
    if (pending) await pending;
  }
  const semanticDigest = await digestCanonicalSliced(canonicalSemanticForm(definition), slicer, { label: 'digest' });
  await deepFreezeSliced(definition, slicer);
  return { definition, semanticDigest };
}
