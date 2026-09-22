// clashtest/results/resultSetSchema.js — the CLOSED structural schema of the sealed Result Set.
//
// Controller ruling (file-ownership split, .superpowers/sdd/p5-result-set/progress.md): Task P5.4
// owns ONLY the minimal REAL pieces its own capture-time code (`validateResultSet.js`) actually
// calls — `isOpenPath` (the fixed five-open-type field-name lists of spec §13.6) and
// `UNKNOWN_FIELD_BYTES` (the §13.6 64 KiB budget) — plus `MAX_UNIT_TAINTS` (the taints[] ceiling
// ruling, below). Task P5.5 owns the FULL closed structural schema (`TYPES`, `SCHEMA_ROWS`,
// `STRING_CAPS`, `checkShapeAndUnknownFields`, `validateResultSet`) and MODIFIES this file to add
// them. The five field-name Sets below are the exact field lists of P5.5's own (already-reviewed)
// `TYPES.ResultSet/.Ledger/.Provenance/.RunOutcome/.Diagnostics` rows — P5.5 should fold these into
// its `TYPES.<Type>.fields` keys rather than re-deriving them, so there is never a second copy of
// the same field-name list drifting from the first.

import { RUN_OPTION_CEILINGS } from '../options.js';
import { KNOWN_DIAGNOSTIC_REASONS } from '../execution/diagnostics.js';

// §13.6's 64 KiB unknown-field budget. A DATA-FORMAT constant, like MAX_DEPTH = 64 in
// validateResultSet.js, not a G-CAL-gated §17.1 default — which is why it lives here rather than
// in options.js. `captureResultSet` reads `limits.maxUnknownFieldBytes ?? UNKNOWN_FIELD_BYTES`, so
// this is picked up with no code change if P0 ever adds that engine-limit key.
export const UNKNOWN_FIELD_BYTES = 64 * 1024;

/**
 * Controller ruling ("P5.4/P5.5 taints[] ceiling formula", progress.md): the plan's own draft code
 * bounded the WHOLE per-unit `ledger.units[].taints[]` array by
 * `RUN_OPTION_CEILINGS.maxElementTaintsPerUnit` alone. The real, shipped
 * `clashtest/planning/ledger.js` (`addTaint`/`collapse`) only applies that ceiling to
 * **element**-kind taint entries; **target-model**- and **unit**-kind entries are kept EXACT,
 * deduplicated only by `(kind, modelKey, reason)` (`taintKey`), until the run-wide discretionary
 * ledger budget refuses admission, at which point the WHOLE unit collapses to one `taint-overflow`
 * entry. A legitimate, uncollapsed unit can therefore legally hold more than
 * `maxElementTaintsPerUnit` taints, and validating against that ceiling alone would reject a set a
 * conforming engine can legitimately produce (R21-2: "an engine never produces a set it cannot
 * read").
 *
 * `MAX_UNIT_TAINTS` is the true worst-case bound, derived — never a bare literal — as:
 *   - `RUN_OPTION_CEILINGS.maxElementTaintsPerUnit`: the element-kind ceiling, unchanged.
 *   - `+ (RUN_OPTION_CEILINGS.maxTargetModelsPerUnit + 2) * KNOWN_DIAGNOSTIC_REASONS.size`: for a
 *     target-model OR a unit-kind taint the dedup key is `(kind, modelKey, reason)`
 *     (`clashtest/execution/diagnostics.js` `deriveUnitTaints`, `taintKey`), and `modelKey` can be
 *     any one of the unit's target models, the unit's own `sourceModelKey`, or `null` — the `+ 2`
 *     accounts for the source model and the null case on top of `maxTargetModelsPerUnit` target
 *     models — times every known diagnostic reason that can attribute to `target-model` or `unit`
 *     (`KNOWN_DIAGNOSTIC_REASONS`; §12.3 calls it "informative, not normative", but it is the one
 *     closed, named table this derivation can read rather than guess a count).
 *   - `+ 1`: defensive slack for the `taint-overflow` sentinel entry itself.
 * Deliberately generous rather than tight — the ceiling only needs to never reject a legitimate
 * unit, not be minimal. Consumed at BOTH ceiling sites (this export, and P5.5's
 * `TYPES.UnitRecord.fields.taints` row) so the two cannot drift apart.
 */
export const MAX_UNIT_TAINTS = RUN_OPTION_CEILINGS.maxElementTaintsPerUnit
  + (RUN_OPTION_CEILINGS.maxTargetModelsPerUnit + 2) * KNOWN_DIAGNOSTIC_REASONS.size
  + 1;

// §13.6's five OPEN types, by their documented field names (matching P5.5's own already-reviewed
// `TYPES` table field-for-field). A field NOT in the matching list, directly under one of these
// five paths, is an unknown/open field: preserved and budgeted, never rejected outright. Everything
// BELOW an open path is open too — P0's `captureData` applies that half on its own.
const RESULT_SET_FIELDS = new Set(['schemaVersion', 'runId', 'testRef', 'definition',
  'derivedFromRunId', 'outcome', 'provenance', 'ledger', 'results', 'diagnostics', 'statistics',
  'digests', 'sealed']);
const LEDGER_FIELDS = new Set(['planExists', 'pairSpaceTotal', 'emptyOperand', 'units',
  'rootOwners', 'unresolvedSelections', 'unreachablePopulation', 'hierarchyInternal',
  'planningGaps', 'exclusions', 'warnings', 'budgetExhausted', 'firstRefusalUnitId']);
const PROVENANCE_FIELDS = new Set(['registrySessionId', 'libraryVersion', 'broadPhase',
  'determinismClass', 'runOptions', 'models', 'scopeProof', 'admissionBaseline',
  'hierarchyInternalAcceptance', 'libraryExclusions', 'placementVerified', 'environment',
  'startedAt', 'finishedAt']);
const RUN_OUTCOME_FIELDS = new Set(['status', 'coverage', 'integrity', 'freshness',
  'environmentSensitive', 'environmentSensitiveCauses', 'reasons']);
const DIAGNOSTICS_FIELDS = new Set(['diagnostics', 'countsByReason', 'total',
  'completenessAffectingCount', 'omittedReasonOccurrences', 'unclassifiedOccurrences',
  'completenessAffectingUpperBound', 'geometryReadinessOccurrences', 'truncated']);

/** Keyed by the JSON-pointer path of the PARENT container ('' = the ResultSet root itself). */
const OPEN_TYPE_FIELDS = new Map([
  ['', RESULT_SET_FIELDS], ['ledger', LEDGER_FIELDS], ['provenance', PROVENANCE_FIELDS],
  ['outcome', RUN_OUTCOME_FIELDS], ['diagnostics', DIAGNOSTICS_FIELDS],
]);

/**
 * §13.6: a path is OPEN when its parent is one of the five open types above and its own last
 * segment is not a documented field of that type. The root itself is never open — without this
 * guard the whole ResultSet would be inside budget scope and every conforming set would be refused
 * (P0's `captureData` passes `[]` for the root value's own path).
 */
export function isOpenPath(pathSegments) {
  if (pathSegments.length === 0) return false;
  const parent = pathSegments.slice(0, -1).join('/');
  const known = OPEN_TYPE_FIELDS.get(parent);
  return known !== undefined && !known.has(pathSegments[pathSegments.length - 1]);
}
