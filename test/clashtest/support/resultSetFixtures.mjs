// test/clashtest/support/resultSetFixtures.mjs
//
// Shared fixture builders for the Result Set phase (P5). Kept deliberately minimal: only the
// pieces the current tasks actually exercise. Grows with later P5 tasks (P5.3+ need
// `makeFakeRun`/`makeSealedSet`/`widePlan`/`fakeSlicer`; not added here because nothing in P5.1/P5.2
// consumes them yet).

import { DIGEST_VERSION } from '../../../clashtest/util/canonical.js';
import { RUN_OPTION_DEFAULTS } from '../../../clashtest/options.js';

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

/**
 * P0's `tick(label?)` slicer shape (`createSlicer`'s contract), test-only (P5.3): counts every
 * tick and, once every `yieldEvery` ticks (default 64, matching a real slicer's rough cadence),
 * returns a resolved Promise instead of `undefined` and counts that as a yield. Swapping in the
 * real `createSlicer` changes nothing at call sites, which all do `const p = slicer.tick(label);
 * if (p) await p;`.
 */
export function fakeSlicer({ yieldEvery = 64 } = {}) {
  let tickCount = 0;
  let yieldCount = 0;
  return {
    tick(_label) {
      tickCount += 1;
      if (tickCount % yieldEvery === 0) {
        yieldCount += 1;
        return Promise.resolve();
      }
      return undefined;
    },
    get ticks() { return tickCount; },
    get yields() { return yieldCount; },
  };
}

const MODEL_A = 'urn:adsk.wipprod:fs.file:vf.model-a?version=1';
const MODEL_B = 'urn:adsk.wipprod:fs.file:vf.model-b?version=1';

/** One `ClashResult` (§11.3 projected shape), deterministic and JSON-plain, for digest fixtures. */
function fakeClashResult(i, unitId) {
  const pair = { first: { modelKey: MODEL_A, dbId: 100 + i }, second: { modelKey: MODEL_B, dbId: 200 + i } };
  return {
    resultId: `r${i}`,
    pair,
    mode: 'volume-overlap',
    evaluatedAs: { source: pair.first, target: pair.second },
    evidence: { witness: { kind: 'vertex', point: [0, 0, 0] } },
    flags: {},
    unitId,
  };
}

/**
 * The raw material of a finished run (P5.3's `buildResultSet(parts)` input), plus the top-level
 * `runOptions` convenience the digest tests read directly (mirrored at `provenance.runOptions`,
 * per §13.6's `Provenance.runOptions` field). `kind`:
 *  - `'default'` (omitted): one evaluated leaf unit, one result, `coverage: 'full'`.
 *  - `'cancelled-pre-resolution'`: no plan, no units, no results, `definition: null`.
 *  - `'wide'`: the same one-unit ledger but ~2,000 results, so a sliced deep freeze ticks well
 *    past a fixed `yieldEvery` and yields at least once.
 * Every call returns freshly built, unshared objects: mutating one call's return never affects
 * another's.
 */
export function runParts(kind = 'default') {
  const runOptions = { ...RUN_OPTION_DEFAULTS };
  const provenance = {
    registrySessionId: 'session-1',
    libraryVersion: '1.0.0',
    broadPhase: runOptions.broadPhase,
    determinismClass: 'deterministic',
    runOptions,
    models: [],
    scopeProof: { method: 'bracketed-digest', digestVersion: DIGEST_VERSION },
    admissionBaseline: [],
    hierarchyInternalAcceptance: null,
    libraryExclusions: [],
    placementVerified: false,
    startedAt: '2026-09-22T00:00:00.000Z',
    finishedAt: '2026-09-22T00:00:01.000Z',
  };
  const base = {
    runId: 'run-1',
    testRef: { testId: 'T1', revision: 1, semanticDigest: `sha256:${'a'.repeat(64)}` },
    definition: { testId: 'T1', mode: 'volume-overlap' },
    derivedFromRunId: null,
    provenance,
    diagnostics: emptyDiagnostics(),
    statistics: {},
    runOptions,
  };

  if (kind === 'cancelled-pre-resolution') {
    return {
      ...base,
      testRef: { testId: 'T1', revision: null, semanticDigest: null },
      definition: null,
      outcome: {
        status: 'cancelled',
        coverage: 'partial',
        integrity: 'clean',
        freshness: 'unverifiable',
        environmentSensitive: false,
        environmentSensitiveCauses: [],
        reasons: ['planning:cancelled'],
      },
      ledger: ledgerWith({
        planExists: false, pairSpaceTotal: 0, units: [], rootOwners: [],
        planningGaps: [{ phase: 'planning', cause: 'cancelled' }],
      }),
      results: [],
    };
  }

  const resultCount = kind === 'wide' ? 2000 : 1;
  const units = [unit('u1', 'evaluated', {
    kind: 'leaf',
    parentUnitId: null,
    sourceModelKey: MODEL_A,
    sourceRootDbIds: [10],
    targets: [{ modelKey: MODEL_B, scope: 'model' }],
    pairSpaceWeight: 10,
  })];
  const results = [];
  for (let i = 0; i < resultCount; i++) results.push(fakeClashResult(i, units[0].unitId));

  return {
    ...base,
    outcome: {
      status: 'completed',
      coverage: 'full',
      integrity: 'clean',
      freshness: 'current',
      environmentSensitive: false,
      environmentSensitiveCauses: [],
      reasons: [],
    },
    ledger: ledgerWith({
      planExists: true,
      pairSpaceTotal: units.reduce((n, u) => n + u.pairSpaceWeight, 0),
      units,
      rootOwners: [{ modelKey: MODEL_A, owners: [{ rootDbId: 10, ownerDbIds: [10], cls: 'A' }] }],
    }),
    results,
  };
}
