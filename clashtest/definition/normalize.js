// clashtest/definition/normalize.js
//
// Definition normalization and the roots contract. This file is built in sections; later sections
// (normalizeDefinition, canonicalSemanticForm, computeSemanticDigest, prepareDefinition,
// deepFreezeDefinition) are appended below the P2.9 section.

import { digestCanonical, digestCanonicalSliced } from '../util/canonical.js';
import { deepFreeze, deepFreezeSliced } from '../util/capture.js';
import { createSlicer } from '../util/slicer.js';
import { ENGINE_LIMIT_DEFAULTS } from '../options.js';

// ---- shared generator drivers and the yielding merge sort ---------------------------------------------
// Convention: every helper below that does size-dependent work is ONE generator body in which each `yield` marks a
// unit of work. The synchronous driver ignores the yields; the sliced driver turns each into `tick(label)` and
// awaits a returned Promise (the P0 slicer decides when to actually yield; spec 17.3: a clock check at least every
// 64 items). The sync and sliced forms therefore share their rule semantics and cannot drift.

const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const numericAscending = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function runSync(steps) {
  let r = steps.next();
  while (!r.done) r = steps.next();
  return r.value;
}

async function runSliced(steps, tick, label) {
  for (let r = steps.next(); ; r = steps.next()) {
    if (r.done) return r.value;
    const pending = tick(label);
    if (pending) await pending;
  }
}

/**
 * Stable bottom-up merge sort as a generator (one yield per element written), so a 100,000-item list never runs as
 * one native `.sort()` span. `compare` is as `Array#sort` (default: numeric ascending, for dbIds). Uses `values`
 * as scratch and returns whichever array holds the result; pass a fresh array. Equal elements keep input order,
 * so the result equals the native stable sort with the same comparator.
 */
function* sortAscending(values, compare = numericAscending) {
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
        // take the right run's head only when it is STRICTLY smaller: keeps the sort stable
        dst[k] = (i < mid && (j >= hi || !(compare(src[j], src[i]) < 0))) ? src[i++] : src[j++];
        yield;
      }
    }
    [src, dst] = [dst, src];
  }
  return src;
}

// ---- P2.9 roots contract ----------------------------------------------------------------------------
// Pure rule INPUTS for spec 5.6, computed from the {dbId, ownerDbIds} fields of ElementEnumerator.resolveRoots
// records. No tree access; P3 owns the planning consequences.
//
// Each rule has a synchronous form (small-input oracle / tests) and a `*Sliced` form for planning-sized data
// (P3 calls the sliced forms with its checkpoint adapter). The sliced form takes `{ tick }` with the contract
// `tick(label?) -> void | Promise<void>`; it is called once per unit of size-dependent work (every root scanned,
// owner traversed, index insert, sort step ...), and the caller's slicer decides when that becomes a real yield.

const MAX_OFFENDERS = 20;
const ROOT_RULE_LABEL = 'plan';

function* antichainSteps(roots) {
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
      yield;
    }
    distinct[r] = mine;
    if (mine.length === 0) empty.push(r);
    const same = byDbId.get(roots[r].dbId);
    if (same === undefined) byDbId.set(roots[r].dbId, [r]); else same.push(r);
    yield;
  }

  const violations = [];
  const shared = new Int32Array(n);         // shared[j] = |distinct owners of j that i also owns|, reset per i
  const touched = [];
  for (let i = 0; i < n; i += 1) {
    yield;
    const dbId = roots[i].dbId;
    touched.length = 0;
    for (const owner of distinct[i]) {
      for (const j of index.get(owner)) {
        yield;
        if (j === i) continue;
        if (shared[j] === 0) touched.push(j);
        shared[j] += 1;
      }
    }
    let candidates = [];
    for (const j of touched) {
      if (shared[j] === distinct[j].length && roots[j].dbId !== dbId) candidates.push(j);
      shared[j] = 0;
      yield;
    }
    for (const j of empty) { if (j !== i && roots[j].dbId !== dbId) candidates.push(j); yield; }
    for (const j of byDbId.get(dbId)) { if (j > i) candidates.push(j); yield; }
    if (candidates.length > 1) candidates = yield* sortAscending(candidates);
    for (const j of candidates) {
      violations.push({ ancestor: dbId, descendant: roots[j].dbId });
      if (violations.length >= MAX_OFFENDERS) return { ok: false, violations };
      yield;
    }
  }
  return { ok: violations.length === 0, violations };
}

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
  return runSync(antichainSteps(roots));
}

/** `assertRootAntichain` in deadline-aware slices: same generator body, one `tick` per unit of work. */
export function assertRootAntichainSliced(roots, { tick }) {
  return runSliced(antichainSteps(roots), tick, ROOT_RULE_LABEL);
}

function* crossRoleNestingSteps({ rootsA, rootsB, rootsUnion }) {
  const roleRoots = new Map();
  for (const list of [rootsA, rootsB]) {
    for (let k = 0; k < list.length; k += 1) {
      const r = list[k];
      if (!roleRoots.has(r.dbId)) roleRoots.set(r.dbId, r);
      yield;
    }
  }
  const unionIds = new Set();
  let enumeratorInconsistent = false;
  for (let k = 0; k < rootsUnion.length; k += 1) {
    const id = rootsUnion[k].dbId;
    unionIds.add(id);
    if (!roleRoots.has(id)) enumeratorInconsistent = true;
    yield;
  }

  const droppedIds = [];
  for (const id of roleRoots.keys()) { if (!unionIds.has(id)) droppedIds.push(id); yield; }
  const dropped = yield* sortAscending(droppedIds);
  const unionOwnerSets = new Array(rootsUnion.length);   // built lazily, once per union root (not per descendant)
  const offenders = [];
  for (const descendant of dropped) {
    if (offenders.length >= MAX_OFFENDERS) break;
    yield;
    const owners = roleRoots.get(descendant).ownerDbIds;
    let ancestor;                                          // the smallest containing union root dbId
    for (let k = 0; k < rootsUnion.length; k += 1) {
      yield;
      const u = rootsUnion[k];
      if (u.dbId === descendant || (ancestor !== undefined && u.dbId >= ancestor)) continue;
      let set = unionOwnerSets[k];
      if (set === undefined) {
        set = new Set();
        const unionOwners = u.ownerDbIds;
        for (let m = 0; m < unionOwners.length; m += 1) { set.add(unionOwners[m]); yield; }
        unionOwnerSets[k] = set;
      }
      let contained = true;
      for (let m = 0; m < owners.length; m += 1) {
        if (!set.has(owners[m])) { contained = false; break; }
        yield;
      }
      if (contained) ancestor = u.dbId;
    }
    offenders.push({ ancestor: ancestor === undefined ? null : ancestor, descendant });
  }
  return {
    supported: offenders.length === 0 && dropped.length === 0 && !enumeratorInconsistent,
    offenders,
    enumeratorInconsistent,
  };
}

/** 5.6.5 rule INPUT: supported iff RU = RA u RB as dbId sets. The planner's use of it is P3. */
export function checkCrossRoleNesting(input) {
  return runSync(crossRoleNestingSteps(input));
}

/** `checkCrossRoleNesting` in deadline-aware slices: same generator body, one `tick` per unit of work. */
export function checkCrossRoleNestingSliced(input, { tick }) {
  return runSliced(crossRoleNestingSteps(input), tick, ROOT_RULE_LABEL);
}

function* hierarchyInternalSteps({ rootsA, rootsB }) {
  const inB = new Set();
  for (let k = 0; k < rootsB.length; k += 1) { inB.add(rootsB[k].dbId); yield; }
  const candidates = [];
  for (let k = 0; k < rootsA.length; k += 1) {
    const r = rootsA[k];
    if (inB.has(r.dbId) && r.ownerDbIds.length >= 2) candidates.push({ dbId: r.dbId, ownerCount: r.ownerDbIds.length });
    yield;
  }
  return yield* sortAscending(candidates, (a, b) => a.dbId - b.dbId);
}

/** 5.6.3 rule INPUT: a root in A n B whose subtree owns two or more fragment-owning nodes. */
export function hierarchyInternalCandidates(input) {
  return runSync(hierarchyInternalSteps(input));
}

/** `hierarchyInternalCandidates` in deadline-aware slices: same generator body, one `tick` per unit of work. */
export function hierarchyInternalCandidatesSliced(input, { tick }) {
  return runSliced(hierarchyInternalSteps(input), tick, ROOT_RULE_LABEL);
}

// ---- P2.4 normalization, canonical form and semanticDigest ------------------------------------------

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
  const keys = [];
  for (const modelKey of byModel.keys()) { keys.push(modelKey); yield; }
  const entries = [];
  for (const modelKey of yield* sortAscending(keys, byCodeUnit)) {   // code-unit order; sliced like the dbId sort
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
  return runSync(normalizeSteps(captured));
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
 * `spanRecorder(label, ms)` (optional) receives the slice spans, labelled 'normalize' / 'semanticDigest' (spec 17.3).
 */
export async function prepareDefinition(captured, { yieldToScheduler, now, sliceBudgetMs, limits, spanRecorder } = {}) {
  const slicer = createSlicer({
    now, yieldToScheduler, limits: { ...ENGINE_LIMIT_DEFAULTS, ...limits }, sliceBudgetMs, spanRecorder: spanRecorder ?? null,
  });
  const definition = await runSliced(normalizeSteps(captured), slicer.tick, 'normalize');
  const semanticDigest = await digestCanonicalSliced(canonicalSemanticForm(definition), slicer, { label: 'semanticDigest' });
  await deepFreezeSliced(definition, slicer);
  return { definition, semanticDigest };
}
