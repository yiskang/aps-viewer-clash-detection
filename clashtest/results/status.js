// clashtest/results/status.js — the ONE §12.5 taint rule and the ONE sealed-ledger reader (D4)
//
// Task P5.6. `getPairStatus`, `getElementStatus`, `createStatusReader`, `buildStatusReaderSteps` and
// `readLedger` are ALL owned here (duplicate-ownership D4): P8 re-exports these, it never
// re-implements the taint rule or the ledger-layout reader.
//
// These views read ONLY the sealed ledger and are purely synchronous (spec §13.6: "the purely
// synchronous helpers (`getPairStatus`, `getElementStatus` …) yield nowhere and need no capture").
//
// Three readings this task pins (each would otherwise be decided twice, or not at all):
//   1. `required: null` for `undetermined` -- §12.5 declares `required: boolean` but defines no
//      value for the `undetermined` verdict (register S-P8-4). `null` is "we cannot say"; `false`
//      would assert the pair is NOT required, a claim the ledger does not support.
//   2. Hierarchy-internal element status comes from the persisted, digested `rootOwners[].owners[].cls`
//      marker (R2), never from the bounded `hierarchyInternal[].examples` list (capped at 20 rows,
//      per resultSetSchema.js's `HIERARCHY_EXAMPLES_CAP`) -- deriving from `examples` would silently
//      under-report caveats on a large model.
//   3. A benign `witness-unavailable` taint is REPORTED in `caveats[]` but does not, by itself,
//      downgrade `covered-clean` to `covered-caveated` (register S-P4-4, spec §12.3 erratum A5).
//      `execution/diagnostics.js` records the table unfiltered (it is the evidence base AND the
//      ledger); the filter lives only here, at taint rules 1 and 2 (rule 2 since 2026-10-07, for the
//      informational target-model-attributed `fragment-null-geometry`; rule 3 stays unconditional).

import { elementRefKey } from '../identity/ids.js';                    // P1 row N12: one key encoding
import { isCompletenessAffecting } from '../execution/diagnostics.js'; // P4: the ONE completeness predicate

const ROOT_CLASSES = new Set(['A', 'B', 'C']);   // P3's ROOT_CLASS literals (R2): A = A' \ B, B = B' \ A, C = A n B
const caveat = (reason, attribution, count = 1) => ({ reason, count, attribution });
const pairKey = (pair) => `${elementRefKey(pair.first)}|${elementRefKey(pair.second)}`;

/**
 * The ONLY function that knows the sealed ledger's physical layout. One `yield` per indexed
 * record so a derivation can slice it; `createStatusReader` drains it synchronously.
 */
export function* readLedger(resultSet) {
  const ledger = resultSet.ledger ?? {};
  const byModel = new Map();
  const model = (modelKey) => {
    let m = byModel.get(modelKey);
    if (m === undefined) {
      m = { ownerToRoot: new Map(), rootCls: new Map(), unreachable: null,
            unreachableOwnerSet: null, mixedOwnerSet: null, hierarchy: null };
      byModel.set(modelKey, m);
    }
    return m;
  };
  for (const entry of ledger.rootOwners ?? []) {
    const m = model(entry.modelKey);
    for (const row of entry.owners) {
      m.rootCls.set(row.rootDbId, ROOT_CLASSES.has(row.cls) ? row.cls : null);   // R2 per-root class
      // codex-review finding (2026-09-22, High, confirmed against the real `positives` fixture,
      // root 10 / owners [100, 101]): a root does NOT own itself by construction -- an explicit-
      // scope root can be a non-owning ancestor (spec §6.2: "an owner such as a non-listed
      // descendant 105 of explicit root 100"). Membership comes ONLY from `ownerDbIds`; when a
      // root genuinely owns a fragment directly, the planner already lists the root's own dbId in
      // its own `ownerDbIds` (whole-model roots are, by definition, "topmost fragment-owning
      // nodes"), so the loop below covers that case on its own -- no separate self-mapping line is
      // needed, and unconditionally adding one wrongly made every non-owning root itself query as
      // a valid, coverable owner element (`getPairStatus`/`getElementStatus` on the bare root dbId
      // returned `covered-clean`/`coverage: 'full'` instead of `undetermined`).
      for (const dbId of row.ownerDbIds) m.ownerToRoot.set(dbId, row.rootDbId);
      yield;
    }
  }
  for (const u of ledger.unreachablePopulation ?? []) {
    const m = model(u.modelKey);
    m.unreachable = u;
    // codex-review finding (2026-09-22, Medium, confirmed): `ownerDbIds`/`mixedOwnerDbIds` are
    // bounded only by the run's own ledger-record ceilings (potentially very large), so a taint
    // rule 6/"unreachable-only-owner" check that scanned them with `Array.prototype.includes` on
    // every `pairStatus`/`elementStatus` call would violate this reader's own O(1)/bounded lookup
    // contract for a model with a large unreachable population. Built once, here, and read with
    // `Set.has` at every call site below instead.
    m.unreachableOwnerSet = new Set(u.ownerDbIds);
    m.mixedOwnerSet = new Set(u.mixedOwnerDbIds);
    yield;
  }
  for (const h of ledger.hierarchyInternal ?? []) { model(h.modelKey).hierarchy = h; yield; }
  const unitsById = new Map();
  const leaves = [];
  for (const u of ledger.units ?? []) {
    unitsById.set(u.unitId, u);
    if (u.outcome !== 'split') leaves.push(u);                  // a split parent is superseded by its leaves
    yield;
  }
  return { units: ledger.units ?? [], leaves, unitsById, byModel,
           planningGaps: ledger.planningGaps ?? [], pairSpaceTotal: ledger.pairSpaceTotal ?? 0,
           emptyOperand: ledger.emptyOperand === true };
}

export function* buildStatusReaderSteps(resultSet) {
  const ledger = yield* readLedger(resultSet);
  const index = yield* indexUnitsSteps(ledger.leaves);        // O(units + target rows), once
  const resultByPair = new Map();
  for (const r of resultSet.results ?? []) { resultByPair.set(pairKey(r.pair), r); yield; }
  return makeReader(resultSet, ledger, resultByPair, index);  // total build: O(units + rows + results)
}

export function createStatusReader(resultSet) {
  const it = buildStatusReaderSteps(resultSet);
  let step = it.next();
  while (!step.done) step = it.next();
  return step.value;
}

// Index reuse: only a genuinely SEALED, frozen set may be cached -- a mutable one must be re-read
// every call, or a reader could answer from a stale index (a correctness bug, not a performance
// one). `Object.isFrozen` alone only proves the ROOT is frozen (codex-review finding, 2026-09-22,
// Medium): a caller that shallow-freezes a still-mutable draft (never sealed through
// `sealResultSet`, so its nested `ledger`/`results` stay mutable) would otherwise be cached too.
// `resultSet.sealed === true` is a cheap (O(1)) second signal that this went through the real
// sealing pipeline (which always deep-freezes, §13.3) rather than a hand-frozen approximation of
// one; it does not, and cannot, prove a DEEP freeze without an O(n) walk of the whole set on every
// call -- exactly the cost this reader's own complexity contract exists to remove. A caller that
// hand-builds an object with `sealed: true` set but leaves nested content mutable is outside this
// module's documented precondition (callers pass a set produced by `sealResultSet`), the same way
// `validateResultSet.js`, not this reader, is this layer's untrusted-input boundary (§13.6).
const READER_CACHE = new WeakMap();
function readerFor(resultSet) {
  if (!Object.isFrozen(resultSet) || resultSet.sealed !== true) return createStatusReader(resultSet);
  let reader = READER_CACHE.get(resultSet);
  if (reader === undefined) { reader = createStatusReader(resultSet); READER_CACHE.set(resultSet, reader); }
  return reader;
}

export const getPairStatus = (resultSet, pairId) => readerFor(resultSet).pairStatus(pairId);
export const getElementStatus = (resultSet, elementRef) => readerFor(resultSet).elementStatus(elementRef);

// --- the unit indexes (status-reader complexity contract) ---------------------------------------
// Built ONCE, in O(units + target rows). After this, no lookup ever scans the unit list, the
// `sourceRootDbIds` array or the `targets` array again.
const EMPTY = Object.freeze([]);
const push1 = (map, k, v) => { const l = map.get(k); if (l === undefined) map.set(k, [v]); else l.push(v); };
const push2 = (map, k1, k2, v) => {
  let inner = map.get(k1);
  if (inner === undefined) { inner = new Map(); map.set(k1, inner); }
  push1(inner, k2, v);
};
const listAt = (map, k1, k2) => map.get(k1)?.get(k2) ?? EMPTY;

export function* indexUnitsSteps(leaves) {
  const sourceRoots = new Map(), targetRoots = new Map(), wholeModelTargets = new Map();
  const unitScope = new Map();
  for (const u of leaves) {
    for (const root of u.sourceRootDbIds) push2(sourceRoots, u.sourceModelKey, root, u);
    const targets = new Map();
    for (const t of u.targets) {
      const whole = t.scope === 'model';
      targets.set(t.modelKey, { whole, roots: new Set(whole ? [] : t.rootDbIds ?? []) });
      if (whole) push1(wholeModelTargets, t.modelKey, u);
      else for (const root of t.rootDbIds ?? []) push2(targetRoots, t.modelKey, root, u);
    }
    unitScope.set(u.unitId, { sourceRoots: new Set(u.sourceRootDbIds), targets });
    yield;
  }
  return { sourceRoots, targetRoots, wholeModelTargets, unitScope };
}

/** Both O(1): one Map lookup plus one Set membership test. */
const coversSource = (index, unit, modelKey, root) =>
  unit.sourceModelKey === modelKey && index.unitScope.get(unit.unitId).sourceRoots.has(root);
const targetScope = (index, unit, modelKey) => index.unitScope.get(unit.unitId).targets.get(modelKey);
const coversTarget = (index, unit, modelKey, root) => {
  const s = targetScope(index, unit, modelKey);
  return s !== undefined && (s.whole || s.roots.has(root));
};
/** Which side of `unit` this (modelKey, root) is on -- `null` when the unit does not touch it. */
const sideOf = (index, unit, modelKey, root) =>
  coversSource(index, unit, modelKey, root) ? 'source'
  : coversTarget(index, unit, modelKey, root) ? 'target' : null;
const wholeModelTarget = (index, unit, modelKey) => targetScope(index, unit, modelKey)?.whole === true;

/**
 * The covering leaf unit, without scanning the unit list. Candidates are the units that carry
 * (mA, rA) on their SOURCE side -- a bounded list, because §6.3's decomposition is an exact cover
 * (at most one leaf covers a given root pair) -- and each candidate's target side is tested in
 * O(1). The candidate list's own length is bounded by how many leaves ever shared that exact
 * source root (split fan-out on the target side only); it is never a scan of every leaf in the run.
 */
function findCoveringUnit(index, mA, rA, mB, rB) {
  for (const u of listAt(index.sourceRoots, mA, rA)) if (coversTarget(index, u, mB, rB)) return u;
  for (const u of listAt(index.sourceRoots, mB, rB)) if (coversTarget(index, u, mA, rA)) return u;
  return undefined;
}

/** Only the units that actually touch this (modelKey, root) -- never all leaves. */
function unitsTouching(index, modelKey, root) {
  const seen = new Set();
  const out = [];
  for (const u of listAt(index.sourceRoots, modelKey, root)) { seen.add(u.unitId); out.push(u); }
  for (const list of [listAt(index.targetRoots, modelKey, root),
                      index.wholeModelTargets.get(modelKey) ?? EMPTY]) {
    for (const u of list) { if (seen.has(u.unitId)) continue; seen.add(u.unitId); out.push(u); }
  }
  return out;
}

function makeReader(resultSet, ledger, resultByPair, index) {
  const outcome = resultSet.outcome ?? {};
  const of = (modelKey) => ledger.byModel.get(modelKey) ?? null;
  const rootOf = (ref) => of(ref.modelKey)?.ownerToRoot.get(ref.dbId) ?? null;

  function pairStatus(pairId) {
    const roots = { first: rootOf(pairId.first), second: rootOf(pairId.second) };
    const base = { required: false, coveringUnitId: null, unitOutcome: null, roots, caveats: [] };

    for (const side of ['first', 'second']) {                   // unreachable-only owner => outside P
      const ref = pairId[side];
      if (roots[side] === null && of(ref.modelKey)?.unreachableOwnerSet?.has(ref.dbId) === true) {
        return { ...base, caveats: [caveat('unreachable-only-owner', 'element')],
                 verdict: 'not-required', reason: 'unreachable-only-owner' };
      }
    }
    // §12.5: `undetermined` ONLY when an owner is absent from `rootOwners`. `required` is `null`
    // here -- the spec defines no boolean for this verdict, and "not required" would be a claim.
    if (roots.first === null || roots.second === null) {
      return { ...base, required: null, verdict: 'undetermined', reason: 'owner-not-in-ledger' };
    }
    if (pairId.first.modelKey === pairId.second.modelKey && roots.first === roots.second) {
      return { ...base, caveats: [caveat('hierarchy-internal', 'element')],
               verdict: 'not-required', reason: 'hierarchy-internal' };
    }

    const unit = findCoveringUnit(index, pairId.first.modelKey, roots.first,
                                  pairId.second.modelKey, roots.second);   // bounded, never O(units)
    if (unit === undefined) return { ...base, required: true, verdict: 'gap', reason: 'unit-not-found' };
    if (unit.outcome !== 'evaluated') {
      return { ...base, required: true, coveringUnitId: unit.unitId, unitOutcome: unit.outcome,
               verdict: 'gap', reason: unit.cause ?? unit.outcome };
    }

    const targetModelKey = coversSource(index, unit, pairId.first.modelKey, roots.first)
      ? pairId.second.modelKey : pairId.first.modelKey;
    const caveats = [];
    let affecting = 0;                                          // caveats that actually downgrade
    const note = (c, downgrades) => { caveats.push(c); if (downgrades) affecting += 1; };

    for (const t of unit.taints) {
      if (t.kind === 'element'
          && [pairId.first, pairId.second].some((r) => r.modelKey === t.modelKey && r.dbId === t.dbId)) {
        // rule 1 -- ALWAYS reported; only a completeness-affecting reason downgrades (S-P4-4).
        note(caveat(t.reason, 'element', t.occurrences), isCompletenessAffecting(t.reason));
      }
      if (t.kind === 'target-model' && t.modelKey === targetModelKey
          && wholeModelTarget(index, unit, targetModelKey)) {
        // rule 2 -- ALWAYS reported; only a completeness-affecting reason downgrades. Before 2026-10-07
        // this was an unconditional `true`, which was equivalent: the only informational reason then
        // (`witness-unavailable`) is pair-scoped and can never be target-model-attributed. The
        // owner-authorized `fragment-null-geometry` reason IS (whole-model target, dbId null), so the
        // ONE predicate is now consulted here exactly as rule 1 already does.
        note(caveat(t.reason, 'target-model', t.occurrences), isCompletenessAffecting(t.reason));
      }
      if (t.kind === 'unit') note(caveat(t.reason, 'unit', t.occurrences), true);            // rule 3
    }
    if (resultByPair.get(pairKey(pairId))?.flags?.duplicateEvidenceConflict === true) {
      note(caveat('duplicate-evidence-conflict', 'element'), true);                          // rule 4
    }
    if (outcome.freshness !== 'current') note(caveat('stale-at-seal', 'unit'), true);        // rule 5
    const seenModels = new Set();
    for (const side of ['first', 'second']) {                                            // rules 6, 7
      const ref = pairId[side];
      const m = of(ref.modelKey);
      if (m?.mixedOwnerSet?.has(ref.dbId) === true) {
        note(caveat('mixed-owner-provenance', 'element'), true);
      }
      if (!seenModels.has(ref.modelKey)) {                      // rule 7 is per MODEL, not per side
        seenModels.add(ref.modelKey);
        const u = m?.unreachable?.unattributable ?? null;
        if (u !== null && u.notLoaded + u.ownerUnresolvable > 0) {
          note(caveat('unattributable-unreachable-population', 'target-model'), true);
        }
      }
    }
    return { required: true, coveringUnitId: unit.unitId, unitOutcome: unit.outcome, roots, caveats,
             verdict: affecting === 0 ? 'covered-clean' : 'covered-caveated' };
  }

  function elementStatus(elementRef) {
    const root = rootOf(elementRef);
    const m = of(elementRef.modelKey);
    const caveats = [];
    const gapCauses = new Set();
    let inUnits = 0;
    let evaluated = 0;
    // Only the units that touch this element -- bounded by the answer, never O(leaves).
    for (const u of root === null ? EMPTY : unitsTouching(index, elementRef.modelKey, root)) {
      const side = sideOf(index, u, elementRef.modelKey, root);
      if (side === null) continue;
      inUnits += 1;
      if (u.outcome === 'evaluated') evaluated += 1;
      else if (u.cause !== null) gapCauses.add(u.cause);
      for (const t of u.taints) {
        if (t.kind === 'element' && t.modelKey === elementRef.modelKey && t.dbId === elementRef.dbId) {
          caveats.push(caveat(t.reason, 'element', t.occurrences));
        }
        if (t.kind === 'unit' && side === 'source') caveats.push(caveat(t.reason, 'unit', t.occurrences));
        if (t.kind === 'target-model' && side === 'target' && t.modelKey === elementRef.modelKey
            && wholeModelTarget(index, u, elementRef.modelKey)) {
          caveats.push(caveat(t.reason, 'target-model', t.occurrences));
        }
      }
    }
    if (m?.mixedOwnerSet?.has(elementRef.dbId) === true) {
      caveats.push(caveat('mixed-owner-provenance', 'element'));
    }
    // R2: complete for EVERY element, from the digested per-root class -- never from the bounded
    // `hierarchyInternal.examples` list, which is capped at 20 rows and would under-report.
    if (root !== null && m?.rootCls.get(root) === 'C') {
      caveats.push(caveat('hierarchy-internal', 'element'));
    }
    const coverage = inUnits === 0 ? 'none' : evaluated === inUnits ? 'full' : 'partial';
    return { inRequiredPairSpace: root !== null, coverage, caveats, gapCauses: [...gapCauses].sort() };
  }

  return { pairStatus, elementStatus, ledger };
}
