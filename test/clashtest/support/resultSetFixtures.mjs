// test/clashtest/support/resultSetFixtures.mjs
//
// Shared fixture builders for the Result Set phase (P5). `runParts`/`sealedSet`'s original kinds
// ('default', 'cancelled-pre-resolution', 'wide') are UNCHANGED (P5.1-P5.4's own tests build on
// them, unvalidated by `validateResultSet`). Task P5.5 adds new kinds that are full, self-consistent,
// `validateResultSet`-clean sets (built through the real `buildResultSet`/`sealResultSet` pipeline,
// never hand-assembled): 'positives' (volume-overlap), 'schema-corpus' (clearance, reaching every
// remaining OPTIONAL/branch schema row the WAIVED set in the invariants test does not waive),
// 'completed-with-gaps', 'completed-clean', 'unreachable-positive', 'many-results' (an alias of
// 'wide', used only for the node-ceiling rejection path, which never reaches validation) -- plus
// `resealed`, which mutates a fresh draft of a named kind and reseals it so its digests stay
// self-consistent.

import { DIGEST_VERSION } from '../../../clashtest/util/canonical.js';
import { RUN_OPTION_DEFAULTS } from '../../../clashtest/options.js';
import { buildResultSet, sealResultSet } from '../../../clashtest/results/resultSet.js';
import { makeResultId, makePairId } from '../../../clashtest/identity/ids.js';

/** P4's `DiagnosticsSummary` (`snapshot()` shape) with every counter at 0. `countsByReason` is an
 *  ARRAY (the real, shipped `execution/diagnostics.js` shape -- see resultSetSchema.js's own note),
 *  which an empty array already satisfies. */
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
const digestOf = (ch) => `sha256:${ch.repeat(64)}`;

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

// Exported (Task P5.6): `status.test.mjs` builds its own probe `PairId`s (via `pairOf`) and
// bespoke fixtures (`widePlan`, `sharedRootPlan`) against these SAME model keys, rather than
// inventing a second pair of placeholder keys that could silently drift from the ones every other
// P5.5 fixture in this file already uses.
export const MODEL_A = 'urn:adsk.wipprod:fs.file:vf.model-a?version=1';
export const MODEL_B = 'urn:adsk.wipprod:fs.file:vf.model-b?version=1';

/** One `ClashResult` (§11.3 projected shape), deterministic and JSON-plain, for digest fixtures.
 *  Placeholder `resultId` (`r${i}`) -- fine ONLY for the 'wide'/'many-results' kind, which is never
 *  run through `validateResultSet` (it exists solely to trip the node-ceiling rejection path of
 *  `captureResultSet`, well before any schema check). */
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
 *  - `'wide'` / `'many-results'`: the same one-unit ledger but ~2,000 results, so a sliced deep
 *    freeze ticks well past a fixed `yieldEvery` and yields at least once, and a tiny
 *    `maxCapturedNodes` rejects it long before validation. NOT `validateResultSet`-clean (see
 *    `fakeClashResult`'s own note) -- never pass this kind to anything but `sealResultSet` or
 *    `readResultSet`'s node-ceiling path.
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

  const resultCount = (kind === 'wide' || kind === 'many-results') ? 2000 : 1;
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

/**
 * A real, fully sealed, self-consistent `ResultSet` (Task P5.4): `sealResultSet(buildResultSet(
 * runParts(kind)), ...)` -- the exact same production pipeline P5.1-P5.3's own tests already use
 * (see `resultSet.seal.test.mjs`), not a hand-built/fake object. Every call is freshly built and
 * unshared (per `runParts`'s own contract), so mutating one call's result never affects another's.
 * `kind` is `runParts`'s own kind switch for the ORIGINAL three kinds, plus (Task P5.5)
 * `validParts`'s kinds below.
 */
export async function sealedSet(kind = 'default') {
  const parts = ['default', 'cancelled-pre-resolution', 'wide', 'many-results'].includes(kind)
    ? runParts(kind)
    : validParts(kind);
  return sealResultSet(buildResultSet(parts), { slicer: fakeSlicer() });
}

/**
 * Mutates a FRESH draft of `sealedSet(kind)` and reseals it, so the mutation's digests are
 * recomputed and self-consistent (never a stale digest left over from the original seal). The
 * intermediate value passed to `sealResultSet` is always a genuinely fresh object (via
 * `structuredClone`, reset to draft shape), satisfying `sealResultSet`'s own fresh-draft identity
 * requirement (spec §13.3) even though it started life as an already-sealed set.
 */
export async function resealed(mutate, kind = 'positives') {
  const sealed = await sealedSet(kind);
  const draft = structuredClone(sealed);
  draft.digests = null;
  draft.sealed = false;
  mutate(draft);
  return sealResultSet(draft, { slicer: fakeSlicer() });
}

// =================================================================================================
// Task P5.7: `InMemoryResultStore` fixtures. Both are thin wrappers over `resealed` -- neither
// touches `results`/`ledger`/`provenance.runOptions` (the only inputs `sealResultSet`'s digests
// depend on), so overriding `runId` or `provenance.models` is always digest-safe and produces a
// genuinely fresh, resealed, self-consistent set (never a hand-patched already-sealed object).
// =================================================================================================

/** A fresh `sealedSet(kind)` with `runId` overridden to the given value; everything else
 *  (`testRef.testId`, `provenance.models`, `ledger`, `results`) is the named kind's own content
 *  unchanged, so several calls with the SAME `kind` but DIFFERENT `runId`s share one identity
 *  (`modelKey -> modelVersion`) and one `testRef.testId`, which is exactly what the store tests
 *  need to probe the identity index and the tombstone index across many runIds of one test. */
export async function withRunId(runId, kind = 'positives') {
  return resealed((draft) => { draft.runId = runId; }, kind);
}

let withModelsCounter = 0;

/**
 * A fresh `sealedSet(kind)` with `provenance.models` REPLACED by the given `[modelKey,
 * modelVersion]` pairs (each built through the same `provenanceModel` helper every other P5.5+
 * fixture in this file uses, so the row shape never drifts) and a freshly minted, globally unique
 * `runId` (this file's own counter -- never the kind's default literal `runId`, and never derived
 * from the model list) so that two `withModels` calls, even with overlapping model pairs, are always
 * two independent runs the identity index can be probed against one at a time. `kind`'s own
 * `ledger`/`results` content is otherwise unchanged (the identity-index tests below only ever read
 * `provenance.models` and `runId`/`testRef.testId` off the returned set).
 */
export async function withModels(modelPairs, kind = 'positives') {
  withModelsCounter += 1;
  const runId = `run-with-models-${withModelsCounter}`;
  return resealed((draft) => {
    draft.runId = runId;
    draft.provenance.models = modelPairs.map(([modelKey, modelVersion]) => provenanceModel(modelKey, { modelVersion }));
  }, kind);
}

// =================================================================================================
// Task P5.5: full, `validateResultSet`-clean base fixtures.
//
// `positives` (volume-overlap) and `schema-corpus` (clearance) TOGETHER reach every declared
// schema row except the anti-drift test's own WAIVED set (`ResultSet.definition` -- delegated to
// P2; `ResultSet.statistics` / `Provenance.runOptions` / `Diagnostics.countsByReason` -- documented,
// undeclared-inner-shape fields; `ClashResult.evidence` -- shape is per-mode, checked by the
// `custom` hook instead). `completed-with-gaps`, `completed-clean` and `unreachable-positive` are
// separate, narrower base fixtures each dispatch's own targeted test asks for by name; they are NOT
// part of the {positives, schema-corpus} anti-drift corpus.
// =================================================================================================

// A fresh `{modelKey, dbId}` object every call -- deliberately NOT shared with any other reference
// to the same element. The real, shipped `projectUnitPairs` (resultSet.js) makes `evaluatedAs.
// source === pair.first` the SAME object on purpose (so the two can never disagree on a -0 vs 0
// dbId); P0's `captureData` correctly treats that live sharing as `cyclic` on a revisited object
// (verified: `validateResultSet.capture.test.mjs`'s own `rawSet()` helper JSON-round-trips a real
// sealed set for exactly this reason before capturing it). This test file's own fixtures are fed to
// `readResultSet`/`captureResultSet` via plain `structuredClone` (matching the brief's own literal
// test code), and `structuredClone` PRESERVES internal reference identity -- so a hand-built fixture
// that reused the same object for `pair.first` and `evaluatedAs.source` would falsely report
// `cyclic` the moment it was captured. Every fixture below therefore builds `pair` and `evaluatedAs`
// from INDEPENDENT (value-equal, reference-distinct) ref objects.
const ref = (modelKey, dbId) => ({ modelKey, dbId });

const DIGEST_T1 = digestOf('a');
const DIGEST_T2 = digestOf('b');
const DIGEST_T3 = digestOf('c');
const DIGEST_T4 = digestOf('d');
const DIGEST_T5 = digestOf('e');

function baseProvenance(over = {}) {
  const runOptions = { ...RUN_OPTION_DEFAULTS };
  return {
    registrySessionId: 'session-p5.5',
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
    ...over,
  };
}

function provenanceModel(modelKey, over = {}) {
  return {
    modelKey, modelVersion: 'v1',
    scopeKinds: ['model'],
    elementCount: 1,
    scopeDigests: { population: null, roots: [{ dbId: 1, subtreeDigest: ZERO_DIGEST }] },
    bindingGeneration: 0, placementGeneration: 0,
    ...over,
  };
}

/** The 'positives' base: volume-overlap, 2 results on 1 evaluated leaf unit (`u1`), plus a SECOND
 *  unit (`u2`) with a non-fatal gap and no results of its own -- so `coverage` genuinely derives
 *  `'partial'` at baseline (a real, structural gap, not merely a declared value), which is what
 *  makes the `coverage-not-full` CORRUPTION mutation (`s.outcome.coverage = 'full'`) an actual
 *  violation rather than a no-op restating an already-true derivation. Also reaches
 *  `Flags.witnessUnavailable` (result[1]'s witness is unavailable) on top of the normal happy path. */
function positivesParts() {
  const pair0 = { first: ref(MODEL_A, 100), second: ref(MODEL_B, 200) };
  const pair1 = { first: ref(MODEL_A, 101), second: ref(MODEL_B, 201) };
  const testId = 'T1';
  const semanticDigest = DIGEST_T1;
  const unit1 = unit('u1', 'evaluated', {
    kind: 'leaf', parentUnitId: null,
    sourceModelKey: MODEL_A, sourceRootDbIds: [10],
    targets: [{ modelKey: MODEL_B, scope: 'model' }],
    pairSpaceWeight: 10,
  });
  const unit2 = unit('u2', 'failed', {
    kind: 'leaf', parentUnitId: null,
    sourceModelKey: MODEL_A, sourceRootDbIds: [11],
    targets: [{ modelKey: MODEL_B, scope: 'model' }],
    pairSpaceWeight: 5,
    cause: 'capacity-exceeded', capacityKind: 'bucket-capacity', scopeProof: 'not-checked',
  });
  const results = [
    {
      resultId: makeResultId(testId, semanticDigest, pair0), pair: pair0, mode: 'volume-overlap',
      evaluatedAs: { source: ref(MODEL_A, 100), target: ref(MODEL_B, 200) },
      evidence: { witness: { kind: 'vertex', point: [0, 0, 0] } }, flags: {}, unitId: 'u1',
    },
    {
      resultId: makeResultId(testId, semanticDigest, pair1), pair: pair1, mode: 'volume-overlap',
      evaluatedAs: { source: ref(MODEL_A, 101), target: ref(MODEL_B, 201) },
      evidence: { witness: null }, flags: { witnessUnavailable: true }, unitId: 'u1',
    },
  ];
  return {
    runId: 'run-positives',
    testRef: { testId, revision: 1, semanticDigest },
    definition: {
      schemaVersion: 1, testId, revision: 1, name: 'positives',
      selectionA: { entries: [{ kind: 'model', modelKey: MODEL_A }] },
      selectionB: { entries: [{ kind: 'model', modelKey: MODEL_B }] },
      mode: 'volume-overlap',
    },
    derivedFromRunId: null,
    outcome: {
      status: 'completed', coverage: 'partial', integrity: 'clean', freshness: 'current',
      environmentSensitive: false, environmentSensitiveCauses: [], reasons: [],
    },
    provenance: baseProvenance({
      models: [
        provenanceModel(MODEL_A, { scopeDigests: { population: null, roots: [{ dbId: 10, subtreeDigest: ZERO_DIGEST }] } }),
        provenanceModel(MODEL_B, { scopeDigests: { population: { count: 1, digest: ZERO_DIGEST }, roots: [] } }),
      ],
      admissionBaseline: [{ modelKey: MODEL_A, epochInstanceCount: 1 }],
    }),
    ledger: ledgerWith({
      pairSpaceTotal: 15,
      units: [unit1, unit2],
      rootOwners: [
        { modelKey: MODEL_A, owners: [{ rootDbId: 10, ownerDbIds: [100, 101], cls: 'A' }] },
        { modelKey: MODEL_B, owners: [{ rootDbId: 20, ownerDbIds: [200, 201], cls: 'A' }] },
      ],
    }),
    results,
    diagnostics: emptyDiagnostics(),
    statistics: {},
  };
}

/** The 'schema-corpus' base: a clearance-mode set (never mixed-mode with 'positives' -- mode-
 *  mismatch is a real, enforced cross-field rule) built specifically to reach every OPTIONAL/branch
 *  schema row 'positives' does not: `ClearanceEvidence`, `UnitTarget.rootDbIds`, non-empty
 *  `Taint`/`PlanningGap`/`Warning`/`UnresolvedSelection`/`UnreachablePopulation`/`HierarchyInternal`,
 *  a non-null `Acceptance`/`Environment`, a non-empty `diagnostics.diagnostics` (both `fragment` and
 *  `fragments` branches of `NormalizedDiagnostic`), and the `Flags.mixedOwnerProvenance` /
 *  `.duplicateEvidenceConflict` / `.unreachableOwner` literals. `status: 'failed'` (not
 *  `'completed'`) is deliberate: it is what makes a non-empty `planningGaps` structurally
 *  admissible here without tripping `completed-with-fatal-cause`. */
function schemaCorpusParts() {
  const testId = 'T2';
  const semanticDigest = DIGEST_T2;
  const unit2 = unit('u2', 'evaluated', {
    kind: 'leaf', parentUnitId: null,
    sourceModelKey: MODEL_A, sourceRootDbIds: [30],
    targets: [{ modelKey: MODEL_B, scope: 'roots', rootDbIds: [40] }],
    pairSpaceWeight: 3,
    taints: [{ kind: 'unit', modelKey: null, dbId: null, reason: 'r1', occurrences: 1 }],
  });
  const clearanceResult = (first, second, flags) => {
    const pair = { first: ref(MODEL_A, first), second: ref(MODEL_B, second) };
    return {
      resultId: makeResultId(testId, semanticDigest, pair), pair, mode: 'clearance',
      evaluatedAs: { source: ref(MODEL_A, first), target: ref(MODEL_B, second) },
      evidence: { distance: 1.5, clearance: 5, closestPoints: { first: [0, 0, 0], second: [1, 0, 0] } },
      flags, unitId: 'u2',
    };
  };
  const results = [
    clearanceResult(300, 400, {}),
    clearanceResult(301, 401, { mixedOwnerProvenance: true }),
    clearanceResult(302, 402, { duplicateEvidenceConflict: true }),
    clearanceResult(303, 499, { unreachableOwner: true }),   // 499 is NOT a root owner -- see below
  ];
  return {
    runId: 'run-schema-corpus',
    testRef: { testId, revision: 1, semanticDigest },
    definition: {
      schemaVersion: 1, testId, revision: 1, name: 'schema-corpus',
      selectionA: { entries: [{ kind: 'elements', modelKey: MODEL_A, dbIds: [300, 301, 302, 303] }] },
      selectionB: { entries: [{ kind: 'model', modelKey: MODEL_B }] },
      mode: 'clearance', clearance: 5,
    },
    derivedFromRunId: null,
    outcome: {
      status: 'failed', coverage: 'partial', integrity: 'caveated', freshness: 'unverifiable',
      environmentSensitive: true, environmentSensitiveCauses: ['bucket-capacity'],
      reasons: ['schema-corpus-fixture'],
    },
    provenance: baseProvenance({
      registrySessionId: 'session-schema-corpus',
      libraryVersion: null,                                    // reaches the nullable branch
      determinismClass: 'time-sensitive',
      models: [
        provenanceModel(MODEL_A, {
          modelVersion: 'v2', scopeKinds: ['elements'], elementCount: 4,
          scopeDigests: { population: { count: 4, digest: ZERO_DIGEST }, roots: [{ dbId: 30, subtreeDigest: ZERO_DIGEST }] },
          bindingGeneration: 1, placementGeneration: 1,
        }),
        provenanceModel(MODEL_B, {
          modelVersion: 'v2',
          scopeDigests: { population: null, roots: [{ dbId: 40, subtreeDigest: ZERO_DIGEST }] },
          bindingGeneration: 1, placementGeneration: 1,
        }),
      ],
      admissionBaseline: [{ modelKey: MODEL_A, epochInstanceCount: 2 }],
      hierarchyInternalAcceptance: { recordRef: 'rec-1' },      // reaches `Acceptance`
      libraryExclusions: ['hierarchy-internal'],
      environment: { viewerVersion: '25.0.0', userAgent: 'test-agent' },   // reaches `Environment`
    }),
    ledger: ledgerWith({
      pairSpaceTotal: 3,
      units: [unit2],
      rootOwners: [
        { modelKey: MODEL_A, owners: [{ rootDbId: 30, ownerDbIds: [300, 301, 302, 303], cls: 'B' }] },
        { modelKey: MODEL_B, owners: [{ rootDbId: 40, ownerDbIds: [400, 401, 402], cls: 'C' }] },   // NOT 499
      ],
      unresolvedSelections: [{ selectionRole: 'A', modelKey: MODEL_A, cause: 'element-unresolvable', dbIds: [999] }],
      unreachablePopulation: [{ modelKey: MODEL_B, ownerDbIds: [499], mixedOwnerDbIds: [498],
        unattributable: { notLoaded: 1, ownerUnresolvable: 0 } }],
      hierarchyInternal: [{ modelKey: MODEL_A, rootCount: 1, ownerCount: 2,
        examples: [{ rootDbId: 30, ownerDbIds: [300, 301] }] }],
      planningGaps: [{ phase: 'planning', cause: 'test-unavailable' }],
      warnings: [{ code: 'w1', modelKey: MODEL_A }],
    }),
    results,
    diagnostics: {
      diagnostics: [
        { scope: 'fragment', reason: 'fragment-not-loaded', completenessAffecting: true, attribution: 'element',
          fragment: { modelKey: MODEL_A, dbId: 300, fragId: 1, role: 'source' },
          ambiguousModelId: false, occurrences: 1, unitIds: ['u2'] },
        { scope: 'pair', reason: 'inconclusive-crossing', completenessAffecting: true, attribution: 'unit',
          fragments: { first: { modelKey: MODEL_A, dbId: 300, fragId: 1 }, second: { modelKey: MODEL_B, dbId: 400, fragId: 2 } },
          occurrences: 1, unitIds: ['u2'] },
      ],
      truncated: false,
      total: 2,
      completenessAffectingCount: 2,
      unclassifiedOccurrences: 0,
      completenessAffectingUpperBound: 2,
      countsByReason: [{ scope: 'fragment', reason: 'fragment-not-loaded', count: 1 },
        { scope: 'pair', reason: 'inconclusive-crossing', count: 1 }],
      omittedReasonOccurrences: 0,
      geometryReadinessOccurrences: 0,
    },
    statistics: { note: 'schema-corpus' },
  };
}

/** 'completed-with-gaps': 2 units -- `u1` evaluated (1 result), `u2` with a non-fatal gap and no
 *  results of its own -- so `coverage` derives `'partial'` at baseline, matching the declared
 *  value, and `u2` can be freely re-shaped by the GAPS-list test (`ledger.units[1] = {...}`). */
function completedWithGapsParts() {
  const testId = 'T3';
  const semanticDigest = DIGEST_T3;
  const pair0 = { first: { modelKey: MODEL_A, dbId: 100 }, second: { modelKey: MODEL_B, dbId: 200 } };
  const unit1 = unit('u1', 'evaluated', {
    kind: 'leaf', parentUnitId: null, sourceModelKey: MODEL_A, sourceRootDbIds: [10],
    targets: [{ modelKey: MODEL_B, scope: 'model' }], pairSpaceWeight: 10,
  });
  const unit2 = unit('u2', 'failed', {
    kind: 'leaf', parentUnitId: null, sourceModelKey: MODEL_A, sourceRootDbIds: [11],
    targets: [{ modelKey: MODEL_B, scope: 'model' }], pairSpaceWeight: 5,
    cause: 'capacity-exceeded', capacityKind: 'bucket-capacity', scopeProof: 'not-checked',
  });
  return {
    runId: 'run-completed-with-gaps',
    testRef: { testId, revision: 1, semanticDigest },
    definition: {
      schemaVersion: 1, testId, revision: 1, name: 'completed-with-gaps',
      selectionA: { entries: [{ kind: 'model', modelKey: MODEL_A }] },
      selectionB: { entries: [{ kind: 'model', modelKey: MODEL_B }] },
      mode: 'volume-overlap',
    },
    derivedFromRunId: null,
    outcome: {
      status: 'completed', coverage: 'partial', integrity: 'clean', freshness: 'current',
      environmentSensitive: false, environmentSensitiveCauses: [], reasons: [],
    },
    provenance: baseProvenance({
      models: [provenanceModel(MODEL_A), provenanceModel(MODEL_B)],
    }),
    ledger: ledgerWith({
      pairSpaceTotal: 15,
      units: [unit1, unit2],
      rootOwners: [
        { modelKey: MODEL_A, owners: [{ rootDbId: 10, ownerDbIds: [100], cls: 'A' }] },
        { modelKey: MODEL_B, owners: [{ rootDbId: 20, ownerDbIds: [200], cls: 'A' }] },
      ],
    }),
    results: [{
      resultId: makeResultId(testId, semanticDigest, pair0), pair: pair0, mode: 'volume-overlap',
      evaluatedAs: { source: ref(MODEL_A, 100), target: ref(MODEL_B, 200) },
      evidence: { witness: { kind: 'vertex', point: [0, 0, 0] } }, flags: {}, unitId: 'u1',
    }],
    diagnostics: emptyDiagnostics(),
    statistics: {},
  };
}

/** 'completed-clean': the full pipeline's own "no clashes found" shape -- one evaluated leaf,
 *  zero results. Distinct from `claimableSet()` (which is a hand-built §8.3-conjunct fixture, not
 *  put through `buildResultSet`/`sealResultSet`). */
function completedCleanParts() {
  const testId = 'T4';
  const semanticDigest = DIGEST_T4;
  const unit1 = unit('u1', 'evaluated', {
    kind: 'leaf', parentUnitId: null, sourceModelKey: MODEL_A, sourceRootDbIds: [10],
    targets: [{ modelKey: MODEL_B, scope: 'model' }], pairSpaceWeight: 10,
  });
  return {
    runId: 'run-completed-clean',
    testRef: { testId, revision: 1, semanticDigest },
    definition: {
      schemaVersion: 1, testId, revision: 1, name: 'completed-clean',
      selectionA: { entries: [{ kind: 'model', modelKey: MODEL_A }] },
      selectionB: { entries: [{ kind: 'model', modelKey: MODEL_B }] },
      mode: 'volume-overlap',
    },
    derivedFromRunId: null,
    outcome: {
      status: 'completed', coverage: 'full', integrity: 'clean', freshness: 'current',
      environmentSensitive: false, environmentSensitiveCauses: [], reasons: [],
    },
    provenance: baseProvenance({
      models: [provenanceModel(MODEL_A), provenanceModel(MODEL_B)],
    }),
    ledger: ledgerWith({
      pairSpaceTotal: 10,
      units: [unit1],
      rootOwners: [
        { modelKey: MODEL_A, owners: [{ rootDbId: 10, ownerDbIds: [], cls: 'A' }] },
        { modelKey: MODEL_B, owners: [{ rootDbId: 20, ownerDbIds: [], cls: 'A' }] },
      ],
    }),
    results: [],
    diagnostics: emptyDiagnostics(),
    statistics: {},
  };
}

/** 'unreachable-positive': a result whose second element (dbId 999 of MODEL_B) is not a root
 *  owner anywhere but IS listed in `ledger.unreachablePopulation`, with `flags.unreachableOwner`
 *  correctly set -- the one legitimate way `owner-not-in-ledger` is NOT raised for an unresolved
 *  owner. */
function unreachablePositiveParts() {
  const testId = 'T5';
  const semanticDigest = DIGEST_T5;
  const pair0 = { first: { modelKey: MODEL_A, dbId: 100 }, second: { modelKey: MODEL_B, dbId: 999 } };
  const unit1 = unit('u1', 'evaluated', {
    kind: 'leaf', parentUnitId: null, sourceModelKey: MODEL_A, sourceRootDbIds: [10],
    targets: [{ modelKey: MODEL_B, scope: 'model' }], pairSpaceWeight: 10,
  });
  return {
    runId: 'run-unreachable-positive',
    testRef: { testId, revision: 1, semanticDigest },
    definition: {
      schemaVersion: 1, testId, revision: 1, name: 'unreachable-positive',
      selectionA: { entries: [{ kind: 'model', modelKey: MODEL_A }] },
      selectionB: { entries: [{ kind: 'model', modelKey: MODEL_B }] },
      mode: 'volume-overlap',
    },
    derivedFromRunId: null,
    outcome: {
      status: 'completed', coverage: 'full', integrity: 'clean', freshness: 'current',
      environmentSensitive: false, environmentSensitiveCauses: [], reasons: [],
    },
    provenance: baseProvenance({
      models: [provenanceModel(MODEL_A), provenanceModel(MODEL_B)],
    }),
    ledger: ledgerWith({
      pairSpaceTotal: 10,
      units: [unit1],
      rootOwners: [{ modelKey: MODEL_A, owners: [{ rootDbId: 10, ownerDbIds: [100], cls: 'A' }] }],
      unreachablePopulation: [{ modelKey: MODEL_B, ownerDbIds: [999], mixedOwnerDbIds: [],
        unattributable: { notLoaded: 0, ownerUnresolvable: 0 } }],
    }),
    results: [{
      resultId: makeResultId(testId, semanticDigest, pair0), pair: pair0, mode: 'volume-overlap',
      evaluatedAs: { source: ref(MODEL_A, 100), target: ref(MODEL_B, 999) },
      evidence: { witness: { kind: 'vertex', point: [0, 0, 0] } },
      flags: { unreachableOwner: true }, unitId: 'u1',
    }],
    diagnostics: emptyDiagnostics(),
    statistics: {},
  };
}

const DIGEST_T6 = digestOf('f');

/** 'hierarchy-internal' (Task P5.6): one normal evaluated pair (MODEL_A/50 <-> MODEL_B/60) for a
 *  non-trivial baseline, PLUS a SECOND MODEL_A root (100, cls 'C' -- R2's A n B marker) owned by
 *  TWO owners (101, 102) -- the AC-20(c) fixture: two elements under the SAME root, in the SAME
 *  model, are never a required pair regardless of taints. `ledger.hierarchyInternal` carries the
 *  matching (bounded, capped-at-20) examples row so both the `cls`-based and `examples`-based
 *  reading can be told apart by a test that empties `examples` (R2's own point). */
function hierarchyInternalParts() {
  const testId = 'T6';
  const semanticDigest = DIGEST_T6;
  const pair0 = { first: ref(MODEL_A, 50), second: ref(MODEL_B, 60) };
  const unit1 = unit('u1', 'evaluated', {
    kind: 'leaf', parentUnitId: null, sourceModelKey: MODEL_A, sourceRootDbIds: [10],
    targets: [{ modelKey: MODEL_B, scope: 'model' }], pairSpaceWeight: 10,
  });
  return {
    runId: 'run-hierarchy-internal',
    testRef: { testId, revision: 1, semanticDigest },
    definition: {
      schemaVersion: 1, testId, revision: 1, name: 'hierarchy-internal',
      selectionA: { entries: [{ kind: 'model', modelKey: MODEL_A }] },
      selectionB: { entries: [{ kind: 'model', modelKey: MODEL_B }] },
      mode: 'volume-overlap',
    },
    derivedFromRunId: null,
    outcome: {
      status: 'completed', coverage: 'full', integrity: 'clean', freshness: 'current',
      environmentSensitive: false, environmentSensitiveCauses: [], reasons: [],
    },
    provenance: baseProvenance({
      models: [provenanceModel(MODEL_A), provenanceModel(MODEL_B)],
    }),
    ledger: ledgerWith({
      pairSpaceTotal: 10,
      units: [unit1],
      rootOwners: [
        { modelKey: MODEL_A, owners: [
          { rootDbId: 10, ownerDbIds: [50], cls: 'A' },
          { rootDbId: 100, ownerDbIds: [101, 102], cls: 'C' },
        ] },
        { modelKey: MODEL_B, owners: [{ rootDbId: 20, ownerDbIds: [60], cls: 'A' }] },
      ],
      hierarchyInternal: [{ modelKey: MODEL_A, rootCount: 1, ownerCount: 2,
        examples: [{ rootDbId: 100, ownerDbIds: [101, 102] }] }],
    }),
    results: [{
      resultId: makeResultId(testId, semanticDigest, pair0), pair: pair0, mode: 'volume-overlap',
      evaluatedAs: { source: ref(MODEL_A, 50), target: ref(MODEL_B, 60) },
      evidence: { witness: { kind: 'vertex', point: [0, 0, 0] } }, flags: {}, unitId: 'u1',
    }],
    diagnostics: emptyDiagnostics(),
    statistics: {},
  };
}

/** Dispatch for every Task P5.5/P5.6 fixture kind (never called for the original three -- see `sealedSet`). */
function validParts(kind) {
  switch (kind) {
    case 'positives': return positivesParts();
    case 'schema-corpus': return schemaCorpusParts();
    case 'completed-with-gaps': return completedWithGapsParts();
    case 'completed-clean': return completedCleanParts();
    case 'unreachable-positive': return unreachablePositiveParts();
    case 'hierarchy-internal': return hierarchyInternalParts();
    default: throw new Error(`resultSetFixtures: unknown kind ${kind}`);
  }
}

// =================================================================================================
// Task P5.6: `status.js` reader fixtures.
// =================================================================================================

/** A raw `PairId` `{first, second}` for a `getPairStatus`/`getElementStatus` probe, canonicalized
 *  through P1's OWN `makePairId` (never a hand-rolled `{first,second}` object) -- `makePairId` owns
 *  validation, -0/0 normalization and unordered-pair canonical order (row N13); a raw builder could
 *  silently disagree with a `ClashResult.pair` built the production way and make
 *  `status.js`'s own order-sensitive `pairKey` look up the wrong (or no) result. */
export const pairOf = (modelKeyA, dbIdA, modelKeyB, dbIdB) => makePairId(
  'volume-overlap', { modelKey: modelKeyA, dbId: dbIdA }, { modelKey: modelKeyB, dbId: dbIdB });

/**
 * Task P5.6's status-reader complexity acceptance fixture: `unitCount` leaf units, each owning a
 * DISTINCT root pair -- source root `1000+i` in MODEL_A, target root `2000+i` in MODEL_B via
 * `scope: 'roots'` (an exact cover, one leaf per root pair, per spec 6.3) -- plus exactly `min(50,
 * unitCount)` results spread across the FIRST units, so a complexity probe run at two different
 * `unitCount`s issues IDENTICAL lookups while only the build's own input size changes. Built
 * through the real `buildResultSet`/`sealResultSet` pipeline (never hand-assembled as an
 * already-sealed object), like every other kind in this file.
 */
export async function widePlan(unitCount) {
  const probeCount = Math.min(50, unitCount);
  const units = [];
  const ownersA = [];
  const ownersB = [];
  const results = [];
  for (let i = 0; i < unitCount; i++) {
    const rootA = 1000 + i;
    const rootB = 2000 + i;
    units.push(unit(`u${i}`, 'evaluated', {
      kind: 'leaf', parentUnitId: null, sourceModelKey: MODEL_A, sourceRootDbIds: [rootA],
      targets: [{ modelKey: MODEL_B, scope: 'roots', rootDbIds: [rootB] }], pairSpaceWeight: 1,
    }));
    ownersA.push({ rootDbId: rootA, ownerDbIds: [rootA], cls: 'A' });
    ownersB.push({ rootDbId: rootB, ownerDbIds: [rootB], cls: 'B' });
  }
  const testId = 'TW';
  const semanticDigest = digestOf('9');
  for (let i = 0; i < probeCount; i++) {
    const pair = { first: ref(MODEL_A, 1000 + i), second: ref(MODEL_B, 2000 + i) };
    results.push({
      resultId: makeResultId(testId, semanticDigest, pair), pair, mode: 'volume-overlap',
      evaluatedAs: { source: ref(MODEL_A, 1000 + i), target: ref(MODEL_B, 2000 + i) },
      evidence: { witness: { kind: 'vertex', point: [0, 0, 0] } }, flags: {}, unitId: `u${i}`,
    });
  }
  const parts = {
    runId: 'run-wide-plan',
    testRef: { testId, revision: 1, semanticDigest },
    definition: {
      schemaVersion: 1, testId, revision: 1, name: 'wide-plan',
      selectionA: { entries: [{ kind: 'model', modelKey: MODEL_A }] },
      selectionB: { entries: [{ kind: 'model', modelKey: MODEL_B }] },
      mode: 'volume-overlap',
    },
    derivedFromRunId: null,
    outcome: {
      status: 'completed', coverage: 'full', integrity: 'clean', freshness: 'current',
      environmentSensitive: false, environmentSensitiveCauses: [], reasons: [],
    },
    provenance: baseProvenance({
      models: [provenanceModel(MODEL_A, { elementCount: unitCount }),
        provenanceModel(MODEL_B, { elementCount: unitCount })],
    }),
    ledger: ledgerWith({
      pairSpaceTotal: unitCount,
      units,
      rootOwners: [{ modelKey: MODEL_A, owners: ownersA }, { modelKey: MODEL_B, owners: ownersB }],
    }),
    results,
    diagnostics: emptyDiagnostics(),
    statistics: {},
  };
  return sealResultSet(buildResultSet(parts), { slicer: fakeSlicer() });
}

/**
 * Task P5.6 (codex-advisor finding, 2026-09-22): `widePlan`'s exact-cover design (one leaf per
 * root pair) can never exercise `findCoveringUnit`'s OWN worst case -- a source root shared by
 * MANY leaf units (real split fan-out that keeps the same source root while partitioning only the
 * target side, per `planning/splitting.test.mjs`), where the candidate list at
 * `sourceRoots[modelKey][rootDbId]` has more than one entry and a probe landing on the LAST one
 * scans every entry before it. `sharedRootPlan({fanOut, unrelatedUnits})` isolates exactly that
 * shape: `fanOut` leaf units all sourcing ONE shared root (5000) in MODEL_A, each targeting its
 * OWN distinct root in MODEL_B, PLUS `unrelatedUnits` leaf units sourcing their OWN distinct,
 * unrelated MODEL_A roots (9000+i) that never touch the shared root at all -- so a test can tell
 * apart "cost grows with `unrelatedUnits`" (would mean the index is not scoped by root -- a real
 * regression) from "cost grows with `fanOut`" (the known, bounded-by-split-fan-out property this
 * task's own status-reader contract already names, not a defect introduced here).
 */
export async function sharedRootPlan({ fanOut, unrelatedUnits = 0 }) {
  const SHARED_ROOT = 5000;
  const units = [];
  const ownersA = [{ rootDbId: SHARED_ROOT, ownerDbIds: [SHARED_ROOT], cls: 'A' }];
  const ownersB = [];
  for (let i = 0; i < fanOut; i++) {
    const rootB = 6000 + i;
    units.push(unit(`shared-${i}`, 'evaluated', {
      kind: 'leaf', parentUnitId: null, sourceModelKey: MODEL_A, sourceRootDbIds: [SHARED_ROOT],
      targets: [{ modelKey: MODEL_B, scope: 'roots', rootDbIds: [rootB] }], pairSpaceWeight: 1,
    }));
    ownersB.push({ rootDbId: rootB, ownerDbIds: [rootB], cls: 'B' });
  }
  for (let i = 0; i < unrelatedUnits; i++) {
    const rootA = 9000 + i;
    const rootB = 8000 + i;
    units.push(unit(`unrelated-${i}`, 'evaluated', {
      kind: 'leaf', parentUnitId: null, sourceModelKey: MODEL_A, sourceRootDbIds: [rootA],
      targets: [{ modelKey: MODEL_B, scope: 'roots', rootDbIds: [rootB] }], pairSpaceWeight: 1,
    }));
    ownersA.push({ rootDbId: rootA, ownerDbIds: [rootA], cls: 'A' });
    ownersB.push({ rootDbId: rootB, ownerDbIds: [rootB], cls: 'B' });
  }
  const testId = 'TSR';
  const semanticDigest = digestOf('8');
  const parts = {
    runId: 'run-shared-root-plan',
    testRef: { testId, revision: 1, semanticDigest },
    definition: {
      schemaVersion: 1, testId, revision: 1, name: 'shared-root-plan',
      selectionA: { entries: [{ kind: 'model', modelKey: MODEL_A }] },
      selectionB: { entries: [{ kind: 'model', modelKey: MODEL_B }] },
      mode: 'volume-overlap',
    },
    derivedFromRunId: null,
    outcome: {
      status: 'completed', coverage: 'full', integrity: 'clean', freshness: 'current',
      environmentSensitive: false, environmentSensitiveCauses: [], reasons: [],
    },
    provenance: baseProvenance({
      models: [provenanceModel(MODEL_A), provenanceModel(MODEL_B)],
    }),
    ledger: ledgerWith({
      pairSpaceTotal: units.length,
      units,
      rootOwners: [{ modelKey: MODEL_A, owners: ownersA }, { modelKey: MODEL_B, owners: ownersB }],
    }),
    results: [],
    diagnostics: emptyDiagnostics(),
    statistics: {},
  };
  return sealResultSet(buildResultSet(parts), { slicer: fakeSlicer() });
}
