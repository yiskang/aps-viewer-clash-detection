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
import { DIGEST_VERSION, digestCanonical } from '../util/canonical.js';
import { deepFreezeSliced } from '../util/capture.js';          // P0 owns the one sliced deep freeze (N4)

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

// P5.2: `RunOutcome` derivation (spec §8.3, §12.5, §13.6 R21-2).
const ENVIRONMENT_CAUSES = ['bucket-capacity', 'geometry-readiness', 'placement-contention'];

/**
 * Derives `coverage`, `integrity` and `environmentSensitive(+Causes)` from a finished run's raw
 * material; `status`/`freshness`/`reasons` are supplied verbatim by the caller (P6). `coverage:
 * 'full'` requires a plan to exist, no planning gap, and EVERY leaf (a unit whose `outcome` is not
 * `'split'` -- a split parent is superseded by its leaves and is never itself checked) to be BOTH
 * `evaluated` AND `scopeProof: 'equal'`. This is verbatim the predicate `validateResultSet`
 * re-checks (R21-2: an engine never produces a set it cannot read) -- it must never drift from that
 * reader's copy.
 */
export function deriveRunOutcome({ status, freshness, ledger, diagnostics, results = [], reasons = [] }) {
  const leaves = ledger.units.filter((u) => u.outcome !== 'split');
  const coverage = ledger.planExists === true
    && ledger.planningGaps.length === 0
    && leaves.length > 0
    && leaves.every((u) => u.outcome === 'evaluated' && u.scopeProof === 'equal')
    ? 'full' : 'partial';
  const duplicateConflict = results.some((r) => r.flags?.duplicateEvidenceConflict === true);
  const integrity = diagnostics.completenessAffectingUpperBound > 0 || duplicateConflict ? 'caveated' : 'clean';
  const causes = new Set();
  for (const u of leaves) {
    if (u.capacityKind === 'bucket-capacity') causes.add('bucket-capacity');
    if (u.outcome === 'failed' && u.cause === 'stale-placement') causes.add('placement-contention');
  }
  if (diagnostics.geometryReadinessOccurrences > 0 || diagnostics.unclassifiedOccurrences > 0) causes.add('geometry-readiness');
  const environmentSensitiveCauses = ENVIRONMENT_CAUSES.filter((c) => causes.has(c));
  return {
    status, coverage, integrity, freshness,
    environmentSensitive: environmentSensitiveCauses.length > 0,
    environmentSensitiveCauses,
    reasons: [...reasons].sort(),
  };
}

// P5.3: draft assembly, digests, sealing and deep freeze (spec §13.1, §13.3, §13.4, §16.7, erratum A9).
const SIZING_OPTION_KEYS = ['broadPhase', 'maxSourceFragmentsPerUnit', 'maxSourceDbIdsPerUnit',
  'maxTargetModelsPerUnit', 'maxTargetFragmentsPerUnit', 'maxUnitsPerRun', 'maxResultsPerRun',
  'maxPlacementRetries', 'maxPlanReferences', 'maxLedgerRecords', 'maxPairsPerOutcome',
  'maxDiagnosticsPerOutcome', 'maxDistinctReasons', 'maxElementTaintsPerUnit'];

// Excludes `attempts` and `durationMs` (§13.1: timings are wall-clock and load-dependent) and
// `secondaryCauses` (§16.7: "diagnostic and excluded from ledgerDigest" -- which of them a real
// timing race exposes varies, so including them would break AC-21's digest equality across
// callback schedulings; the primary `cause` is a pure function of the recorded facts).
const DIGESTED_UNIT_KEYS = ['unitId', 'kind', 'parentUnitId', 'sourceModelKey', 'sourceRootDbIds',
  'targets', 'outcome', 'cause', 'capacityKind', 'capDetail', 'scopeProof',
  'pairSpaceWeight', 'taints'];

const pick = (o, keys) => Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]));
const flagNames = (flags) => Object.keys(flags).filter((k) => flags[k] === true).sort();

/** §13.1: the digested projection of `results[]` -- `(resultId, flags)` only, never evidence. */
export const pairSetDigestInput = (results) => results.map((r) => [r.resultId, flagNames(r.flags)]);

/** §13.1 / §16.7: the digested projection of the ledger. `rootOwners` (incl. its `cls` marker,
 *  erratum A9) is digested verbatim; `sizingOptions` pins the run's sizing configuration into the
 *  digest so a set produced under a different ceiling set cannot silently collide with one that
 *  used the same facts under a different configuration. */
export function ledgerDigestInput(ledger, runOptions) {
  return {
    planExists: ledger.planExists, pairSpaceTotal: ledger.pairSpaceTotal,
    emptyOperand: ledger.emptyOperand,
    units: ledger.units.map((u) => pick(u, DIGESTED_UNIT_KEYS)),
    rootOwners: ledger.rootOwners, unresolvedSelections: ledger.unresolvedSelections,
    unreachablePopulation: ledger.unreachablePopulation, hierarchyInternal: ledger.hierarchyInternal,
    planningGaps: ledger.planningGaps, exclusions: ledger.exclusions, warnings: ledger.warnings,
    budgetExhausted: ledger.budgetExhausted, firstRefusalUnitId: ledger.firstRefusalUnitId,
    sizingOptions: pick(runOptions, SIZING_OPTION_KEYS),
  };
}

/** Assembles the §13.1 `ResultSet` structure as an unsealed draft: `digests: null`, `sealed:
 *  false`. Plain data, no validation -- P5.4/P5.5 own capture and schema validation. */
export function buildResultSet(parts) {
  const { runId, testRef, definition, derivedFromRunId = null, outcome, provenance, ledger,
          results, diagnostics, statistics } = parts;
  return { schemaVersion: SCHEMA_VERSION, runId, testRef, definition, derivedFromRunId,
           outcome, provenance, ledger, results, diagnostics, statistics,
           digests: null, sealed: false };
}

/** §13.3: "sealed exactly once ... enforced, not merely promised". A non-draft is an engine bug,
 *  not a data error, so it is a plain programmer error with a stable code -- never a §18 class
 *  (no spec error names this case, and giving it one would invite callers to handle it).
 *
 *  Field shape (`sealed`/`digests`) alone cannot detect a draft object being handed to
 *  `sealResultSet` a SECOND time (concurrently or sequentially): `sealResultSet` never mutates the
 *  original draft's own `sealed`/`digests` fields -- it builds a new object -- so a reused draft
 *  looks field-identical to a fresh one. `CONSUMED_DRAFTS` closes that gap by object IDENTITY
 *  (codex-advisor finding, 2026-09-22): once a draft has been claimed by `sealResultSet`, it can
 *  never be claimed again, whether or not that first attempt went on to succeed. */
const NOT_A_DRAFT = 'ERR_RESULT_SET_NOT_DRAFT';
const CONSUMED_DRAFTS = new WeakSet();
function assertDraft(draft) {
  const bad = draft === null || typeof draft !== 'object' ? 'not an object'
    : draft.sealed !== false ? 'already sealed'
    : draft.digests !== null ? 'already carries digests'
    : CONSUMED_DRAFTS.has(draft) ? 'already consumed by a previous seal (same draft object reused)'
    : null;
  if (bad === null) return;
  const err = new TypeError(`sealResultSet: ${bad}; a Result Set is sealed exactly once (spec §13.3)`);
  err.code = NOT_A_DRAFT;
  throw err;
}

/**
 * Deep-freezes the draft, computes `digests` from the now-frozen content, and returns the sealed,
 * frozen `ResultSet`. Rejects a value that is not a fresh draft with
 * `TypeError{code: ERR_RESULT_SET_NOT_DRAFT}` (§13.3).
 *
 * Order matters (codex-advisor finding, 2026-09-22): `deepFreezeSliced` yields across ticks, so
 * digesting the draft BEFORE it is frozen leaves a window in which a mutation to a not-yet-frozen
 * subtree would reach the final frozen set while the recorded digest still reflected the
 * pre-mutation content -- a sealed set whose own digest does not match its own content. Freezing
 * FIRST and digesting the already-frozen draft afterward makes the digest correct by construction:
 * whatever the draft's content is by the time every node is frozen (raced or not) is exactly what
 * gets digested, because nothing can change after `deepFreezeSliced` resolves. The two small,
 * freshly-created objects built after that point (`digests` and the returned `set` itself) need no
 * slicing -- both are frozen synchronously, since everything they reference is already frozen.
 *
 * The draft is claimed (added to `CONSUMED_DRAFTS`) synchronously, before the first `await`, so two
 * calls issued back-to-back for the SAME draft (e.g. `Promise.all([sealResultSet(d, o), sealResultSet(d,
 * o)])`) can never both proceed: JS runs each call's synchronous prefix to completion before the next
 * call starts, so exactly the first-issued call claims the draft and every other rejects immediately
 * with `ERR_RESULT_SET_NOT_DRAFT`. A draft is claimed even when the seal goes on to fail (e.g. the
 * slicer rejects mid-freeze): a draft that started sealing and did not finish may be partially frozen
 * and is never safely resealable -- recovery means building a fresh draft via `buildResultSet`, not
 * retrying the same object.
 */
export async function sealResultSet(draft, { slicer }) {
  assertDraft(draft);
  CONSUMED_DRAFTS.add(draft);
  await deepFreezeSliced(draft, slicer);            // P0's helper; the slicer object, not {slicer}
  const digests = { digestVersion: DIGEST_VERSION,
    pairSetDigest: digestCanonical(pairSetDigestInput(draft.results)),
    ledgerDigest: digestCanonical(ledgerDigestInput(draft.ledger, draft.provenance.runOptions)) };
  Object.freeze(digests);
  return Object.freeze({ ...draft, digests, sealed: true });
}
