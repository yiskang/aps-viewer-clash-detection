// test/clashtest/support/resultSetFixtures.mjs
//
// Shared fixture builders for the Result Set phase (P5). Kept deliberately minimal: only the
// pieces the current tasks actually exercise. Grows with later P5 tasks (P5.3+ need
// `makeFakeRun`/`makeSealedSet`/`widePlan`/`fakeSlicer`; not added here because nothing in P5.1/P5.2
// consumes them yet).

import { DIGEST_VERSION } from '../../../clashtest/util/canonical.js';

/** P4's `DiagnosticsSummary` (`snapshot()` shape) with every counter at 0. */
export function emptyDiagnostics() {
  return {
    diagnostics: [],
    truncated: false,
    total: 0,
    completenessAffectingCount: 0,
    unclassifiedOccurrences: 0,
    completenessAffectingUpperBound: 0,
    countsByReason: [],
    omittedReasonOccurrences: 0,
    geometryReadinessOccurrences: 0,
  };
}

/** The pinned `Ledger` shape (plan "Shapes this phase pins"), with `planExists: true`,
 *  `pairSpaceTotal: 10` and every table empty by default. */
export function ledgerWith(over = {}) {
  return {
    planExists: true,
    pairSpaceTotal: 10,
    emptyOperand: false,
    units: [],
    rootOwners: [],
    unresolvedSelections: [],
    unreachablePopulation: [],
    hierarchyInternal: [],
    planningGaps: [],
    exclusions: [],
    warnings: [],
    budgetExhausted: false,
    firstRefusalUnitId: null,
    ...over,
  };
}

/** One `UnitRecord`. A `split` record defaults `scopeProof: 'not-checked'` (superseded by its
 *  leaves and never itself checked); every other outcome defaults `scopeProof: 'equal'`. */
export function unit(unitId, outcome, over = {}) {
  return {
    unitId,
    outcome,
    cause: null,
    secondaryCauses: [],
    capacityKind: null,
    capDetail: null,
    scopeProof: outcome === 'split' ? 'not-checked' : 'equal',
    pairSpaceWeight: 1,
    taints: [],
    attempts: 1,
    durationMs: 0,
    ...over,
  };
}

const ZERO_DIGEST = `sha256:${'0'.repeat(64)}`;

/**
 * The empty-results, `completed`/`full`/`clean`/no-caveats shape the §8.3 claim truth table flips
 * one conjunct at a time (P5.2). Every field the predicate reads is present and claimable; the
 * FLIPS table in claim.test.mjs mutates exactly one of them per row.
 */
export function claimableSet() {
  return {
    outcome: {
      status: 'completed',
      coverage: 'full',
      integrity: 'clean',
      freshness: 'current',
      environmentSensitive: false,
      environmentSensitiveCauses: [],
      reasons: [],
    },
    ledger: {
      pairSpaceTotal: 10,
      emptyOperand: false,
      unresolvedSelections: [],
      unreachablePopulation: [],
      hierarchyInternal: [],
    },
    provenance: {
      libraryExclusions: [],
      hierarchyInternalAcceptance: null,
      scopeProof: { method: 'bracketed-digest', digestVersion: DIGEST_VERSION },
    },
    results: [],
    digests: {
      digestVersion: DIGEST_VERSION,
      pairSetDigest: ZERO_DIGEST,
      ledgerDigest: ZERO_DIGEST,
    },
  };
}
