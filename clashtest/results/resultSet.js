// clashtest/results/resultSet.js
//
// P5.1: `ClashResult` projection, canonical order, and cross-unit reconciliation (spec §11.3, §11.4).
// This file consumes ONLY P1's real `identity/ids.js` exports (reconciliation rows N12-N14: producer
// wins) and never re-derives a mode -> pair-semantics mapping, an ElementRef key encoding, or the
// canonical PairId order itself -- P1 is the one code home for all three.
//
// `ctx.unreachableOwners` / `ctx.mixedOwners` are `Map<modelKey, Set<dbId>>` built from PLAN data
// (never from the unit) so `flags.unreachableOwner` / `flags.mixedOwnerProvenance` reflect the
// engine's own owner classification (§6.2), not anything the executor could spoof.

import { comparePairIds, elementRefFrom, makePairId, makeResultId } from '../identity/ids.js';

export const SCHEMA_VERSION = 1;
const UNRANKED = Number.MAX_SAFE_INTEGER; // an unplanned unit sorts last, deterministically

const zero = (n) => (n === 0 ? 0 : n); // -0 -> 0 (§13.4)
const point = (p) => [zero(p[0]), zero(p[1]), zero(p[2])];
const sameRef = (a, b) => a.modelKey === b.modelKey && a.dbId === b.dbId;
const has = (index, ref) => index.get(ref.modelKey)?.has(ref.dbId) === true;

/** Canonical total order of §11.3, lives in P1 (comparePairIds); this is the one call site. */
export function compareResults(a, b) {
  return comparePairIds(a.pair, b.pair);
}

function projectEvidence(mode, p, pairId) {
  switch (mode) {
    case 'volume-overlap':
      return { witness: p.witness ? { kind: p.witness.kind, point: point(p.witness.point) } : null };
    case 'clearance': {
      const sp = point(p.witness.sourcePoint);
      const tp = point(p.witness.targetPoint);
      const sourceIsFirst = sameRef(p.source, pairId.first);
      return {
        distance: zero(p.distance),
        clearance: zero(p.clearance),
        closestPoints: sourceIsFirst ? { first: sp, second: tp } : { first: tp, second: sp },
      };
    }
    default: // surface-intersection, containment
      return {};
  }
}

/** Projects one `UnitOutcome.pairs[]` (library orientation, `type`) into canonical-ordered `ClashResult[]`. */
export function projectUnitPairs(unitOutcome, ctx) {
  const out = [];
  for (const p of unitOutcome.pairs) {
    // Normalized ONCE, through P1's own `elementRefFrom` (which normalizes -0 -> 0 and returns a
    // frozen, detached copy, never the executor's own live pair object -- §13.4 plain-data safety).
    // `makePairId` would re-normalize internally anyway; doing it here once lets `evaluatedAs` share
    // the exact same normalized refs `pair` is built from, so the two ElementRef-shaped fields of one
    // ClashResult can never disagree on a -0 vs 0 dbId (codex-advisor finding, 2026-09-22).
    const source = elementRefFrom(p.source);
    const target = elementRefFrom(p.target);
    // P1 row N13: mode FIRST, arity 3. P5 never computes or passes a pairSemantics value.
    const pair = makePairId(ctx.mode, source, target);
    const evidence = projectEvidence(ctx.mode, p, pair);
    const flags = {};
    if (ctx.mode === 'volume-overlap' && evidence.witness === null) flags.witnessUnavailable = true;
    if (has(ctx.unreachableOwners, pair.first) || has(ctx.unreachableOwners, pair.second)) flags.unreachableOwner = true;
    if (has(ctx.mixedOwners, pair.first) || has(ctx.mixedOwners, pair.second)) flags.mixedOwnerProvenance = true;
    out.push({
      resultId: makeResultId(ctx.testId, ctx.semanticDigest, pair),
      pair,
      mode: ctx.mode,
      evaluatedAs: { source, target },
      evidence,
      flags,
      unitId: unitOutcome.unitId,
    });
  }
  out.sort(compareResults);
  return out;
}

// §11.4 rule 2: canonical orientation wins, else the lowest unit IN PLAN ORDER.
// Plan order is the supplied rank index, NEVER a lexical unitId compare ('1.10' < '1.2' is wrong).
const planRankOf = (ctx, unitId) => ctx.unitPlanRank?.get(unitId) ?? UNRANKED;

function evidenceAgrees(mode, a, b) {
  if (mode === 'clearance') return a.distance === b.distance;
  if (mode === 'volume-overlap') return (a.witness?.kind ?? null) === (b.witness?.kind ?? null);
  return true; // surface-intersection / containment carry no evidence
}

function reconcile(kept, incoming, ctx) {
  const keptCanonical = sameRef(kept.evaluatedAs.source, kept.pair.first);
  const incomingCanonical = sameRef(incoming.evaluatedAs.source, incoming.pair.first);
  // STICKY (codex-advisor finding, 2026-09-22): with 3+ duplicates this fold runs pairwise (current
  // front vs. the next incoming record only), so a round that happens to AGREE must never erase a
  // conflict an EARLIER round already found. Example: front=u1(0.5); u2(0.25) disagrees, wins on
  // rank, gets flagged -- front is now u2(0.25, flagged); u3(0.25) AGREES with that front and also
  // wins on rank. The u2-vs-u3 comparison alone finds nothing new, but the real u1/u2 disagreement
  // must still be reported. Carrying the flag forward from either side of the CURRENT comparison
  // fixes this: it was reproduced and verified missing before this OR was added.
  const conflict = !evidenceAgrees(ctx.mode, kept.evidence, incoming.evidence)
    || kept.flags.duplicateEvidenceConflict === true
    || incoming.flags.duplicateEvidenceConflict === true;
  let winner = kept;
  if (!keptCanonical && incomingCanonical) winner = incoming;
  else if (keptCanonical === incomingCanonical
           && planRankOf(ctx, incoming.unitId) < planRankOf(ctx, kept.unitId)) winner = incoming;
  if (conflict) winner = { ...winner, flags: { ...winner.flags, duplicateEvidenceConflict: true } };
  return winner;
}

/**
 * Cross-unit merge with the whole-unit `maxResultsPerRun` boundary rule (§17.1) and the §11.4
 * reconciliation rules. `addUnit` is transactional: a refusal has NO side effect of any kind.
 * `canAdmitUnit` is the same admission test with no mutation at all (P6 re-verification Critical 4).
 */
export function createResultAccumulator(ctx) {
  const byResultId = new Map();
  let merged = [];

  /** Projection plus the cap test, with NO mutation of any accumulator state. Both entry points
   *  below go through it, so `canAdmitUnit` and `addUnit` can never disagree about admissibility. */
  function project(unitOutcome) {
    const produced = projectUnitPairs(unitOutcome, ctx);
    const additions = [];
    const replacements = [];
    for (const r of produced) {
      const prev = byResultId.get(r.resultId);
      if (prev === undefined) additions.push(r);
      else replacements.push(reconcile(prev, r, ctx));
    }
    // Whole-unit boundary rule (§17.1 maxResultsPerRun): refuse the unit entirely, merge nothing.
    const admissible = merged.length + additions.length <= ctx.maxResultsPerRun;
    return { admissible, additions, replacements };
  }

  return {
    /** P6 re-verification Critical 4: P6 must know whether a unit will be admitted BEFORE it
     *  commits that unit to the diagnostic aggregator and the statistics accumulator, because
     *  neither of those can be rolled back. Pure: it mutates nothing, here or downstream. */
    canAdmitUnit(unitOutcome) {
      const { admissible } = project(unitOutcome);
      return admissible ? { admissible: true } : { admissible: false, reason: 'result-cap' };
    },

    /** TRANSACTIONAL: a refusal has no side effect of any kind -- `size()`, the merged array and
     *  every already-merged result's flags are exactly as they were. */
    addUnit(unitOutcome) {
      const { admissible, additions, replacements } = project(unitOutcome);
      if (!admissible) return { accepted: false, reason: 'result-cap' };
      for (const r of replacements) byResultId.set(r.resultId, r);
      for (const r of additions) byResultId.set(r.resultId, r);
      merged = [...byResultId.values()].sort(compareResults);
      return { accepted: true, added: additions.length };
    },
    size: () => merged.length,
    toArray: () => merged,
  };
}
