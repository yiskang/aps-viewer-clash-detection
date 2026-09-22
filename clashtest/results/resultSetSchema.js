// clashtest/results/resultSetSchema.js — the CLOSED structural schema of the sealed Result Set.
//
// Task P5.4 authored the minimal REAL pieces its own capture-time code (`validateResultSet.js`)
// calls -- `isOpenPath`, `UNKNOWN_FIELD_BYTES` and `MAX_UNIT_TAINTS` -- per a controller
// file-ownership ruling (`.superpowers/sdd/p5-result-set/progress.md`). Task P5.5 (this pass) adds
// the FULL closed structural schema: `TYPES`, `SCHEMA_ROWS`, `STRING_CAPS`,
// `checkShapeAndUnknownFields`, and `validateResultSetSummary` (co-located here because it reuses
// this module's `TestRef`/`Digests` rows and its generic `checkValue`/`checkObject` walk). P5.4's
// `isOpenPath` is RE-DERIVED below from `TYPES`'s own field lists (its hardcoded field-name Sets
// are replaced), per this file's own original header note: "there is never a second copy of the
// same field-name list drifting from the first." `MAX_UNIT_TAINTS` and `UNKNOWN_FIELD_BYTES` are
// untouched (P5.4 already derived them correctly; Ruling A requires REUSE, never recomputation).

import { RUN_OPTION_CEILINGS, ENGINE_LIMIT_CEILINGS } from '../options.js';
import { DIGEST_VERSION } from '../util/canonical.js';
import { CLASH_MODES } from '../identity/ids.js';                 // P1 is the sole home of the mode list
import { SCHEMA_VERSION, ENVIRONMENT_CAUSES } from './resultSet.js';
import { validateTest } from '../definition/validate.js';

// §13.6's 64 KiB unknown-field budget. A DATA-FORMAT constant, like MAX_DEPTH = 64 in
// validateResultSet.js, not a G-CAL-gated §17.1 default -- which is why it lives here rather than
// in options.js. `captureResultSet` reads `limits.maxUnknownFieldBytes ?? UNKNOWN_FIELD_BYTES`, so
// this is picked up with no code change if P0 ever adds that engine-limit key.
export const UNKNOWN_FIELD_BYTES = 64 * 1024;

/**
 * Controller ruling ("P5.4/P5.5 taints[] ceiling formula", progress.md), CORRECTED (2026-09-22,
 * "Correction to the taints[] ceiling ruling", same progress.md): the plan's own draft code bounded
 * the WHOLE per-unit `ledger.units[].taints[]` array by `RUN_OPTION_CEILINGS.maxElementTaintsPerUnit`
 * alone. The real, shipped `clashtest/planning/ledger.js` (`addTaint`/`collapse`) only applies that
 * ceiling to **element**-kind taint entries; **target-model**- and **unit**-kind entries are kept
 * EXACT, deduplicated only by `(kind, modelKey, dbId, reason)` (`taintKey`), until the run-wide
 * discretionary ledger budget refuses admission (`budget.admitRuntime(...)`), at which point the
 * WHOLE unit collapses to one `taint-overflow` entry.
 *
 * An earlier version of this constant derived a formula from `KNOWN_DIAGNOSTIC_REASONS.size` (the
 * closed table of reasons the *collision library* is known to report today), reasoning that a
 * taint's `reason` could only be one of those. An independent codex-review pass (and the
 * controller's own direct re-verification) found this false: `clashtest/planning/ledger.js`'s own
 * `normalizeTaint` accepts ANY non-empty string for `reason` (`nonEmptyString(t.reason, ...)`), with
 * no membership check against `KNOWN_DIAGNOSTIC_REASONS` or any other closed table -- and that table
 * is itself documented, in its own file, as "informative, NOT normative" (§12.3). The true per-unit
 * worst case is therefore bounded ONLY by the run-wide discretionary ledger budget a single unit
 * could consume via `admitRuntime(...)` before its own admission fails and it collapses -- exactly
 * the same reasoning the schema's own `TYPES` table already applies to `Ledger.unresolvedSelections`,
 * `Ledger.planningGaps`, `Ledger.warnings` and `UnitRecord.secondaryCauses`, every one of which is
 * `max: RUN_OPTION_CEILINGS.maxLedgerRecords` for the identical reason (bounded by the run's own
 * ledger-record budget, not by any fixed per-item/per-reason combinatorial count). Consumed at BOTH
 * ceiling sites (this export, and this file's own `TYPES.UnitRecord.fields.taints` row below --
 * Ruling A) so the two cannot drift apart.
 */
export const MAX_UNIT_TAINTS = RUN_OPTION_CEILINGS.maxLedgerRecords;

// Per-field string caps (§13.5.2). P0's summary assigns this table to P5 ("there is no
// schema-wide string-length ceiling in the spec"), so it lives beside the fields it caps.
// Data-format constants, like MAX_DEPTH and MAX_ISSUES -- NOT G-CAL-gated §17.1 defaults.
export const STRING_CAPS = Object.freeze({
  modelKey: 1024, modelVersion: 1024, libraryVersion: 256, environmentField: 512,
  id: 256, reason: 256, timestamp: 64, digest: 128, default: 1024,
});
export const HIERARCHY_EXAMPLES_CAP = 20;                          // §13.1: the bounded examples list

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;                    // §5.4 digest format
const MAX_SAFE = Number.MAX_SAFE_INTEGER;

// --- declaration helpers -----------------------------------------------------------------------
const str = (cap = 'default', o = {}) => ({ kind: 'string', cap, ...o });
const enm = (values, o = {}) => ({ kind: 'string', cap: 'reason', values: new Set(values), ...o });
const int = (o = {}) => ({ kind: 'number', integer: true, min: 0, max: MAX_SAFE, ...o });
const num = (o = {}) => ({ kind: 'number', ...o });
const bool = (o = {}) => ({ kind: 'boolean', ...o });
const obj = (of, o = {}) => ({ kind: 'object', of, ...o });
const arr = (of, o = {}) => ({ kind: 'array', of, ...o });
const lit = (value, o = {}) => ({ kind: 'literal', value, ...o });
const free = (o = {}) => ({ kind: 'object', free: true, ...o });   // documented, contents open-ended
const digest = (o = {}) => ({ kind: 'string', cap: 'digest', pattern: DIGEST_PATTERN,
  code: 'digest-syntax-invalid', ...o });
const dbId = (o = {}) => int({ min: 0, ...o });
const point3 = () => arr(num(), { exact: 3 });
const ids = (o = {}) => arr(dbId(), { max: RUN_OPTION_CEILINGS.maxPlanReferences, unique: true, ...o });

/** Every durable type of the sealed Result Set. `open: true` is exactly §13.6's five open types. */
export const TYPES = new Map(Object.entries({
  ResultSet: { open: true, fields: {
    schemaVersion: lit(SCHEMA_VERSION),
    runId: str('id'),
    testRef: obj('TestRef'),
    definition: obj('Definition', { nullable: true, delegated: true }),   // P2's validateTest owns it
    derivedFromRunId: str('id', { nullable: true }),
    outcome: obj('RunOutcome'),
    provenance: obj('Provenance'),
    ledger: obj('Ledger'),
    results: arr('ClashResult', { max: RUN_OPTION_CEILINGS.maxResultsPerRun,
      uniqueBy: (r) => r.resultId, uniqueCode: 'duplicate-result-id' }),
    diagnostics: obj('Diagnostics'),
    statistics: free(),                                             // §12.6 informational
    digests: obj('Digests'),
    sealed: lit(true, { code: 'not-sealed' }),                      // §13.3
  } },
  TestRef: { fields: {
    testId: str('id'),
    revision: int({ min: 1, nullable: true }),
    semanticDigest: digest({ nullable: true }),
  } },
  RunOutcome: { open: true, fields: {
    status: enm(['completed', 'failed', 'cancelled', 'invalidated']),   // terminal statuses only
    coverage: enm(['full', 'partial']),
    integrity: enm(['clean', 'caveated']),
    freshness: enm(['current', 'stale', 'unverifiable']),
    environmentSensitive: bool(),
    environmentSensitiveCauses: arr(enm(ENVIRONMENT_CAUSES), { max: ENVIRONMENT_CAUSES.length,
      uniqueBy: (c) => c }),
    reasons: arr(str('reason'), { max: RUN_OPTION_CEILINGS.maxLedgerRecords, uniqueBy: (r) => r }),
  } },
  Provenance: { open: true, fields: {
    registrySessionId: str('id'),
    libraryVersion: str('libraryVersion', { nullable: true }),
    broadPhase: enm(['tlas', 'linear']),
    determinismClass: enm(['deterministic', 'time-sensitive']),
    runOptions: free(),
    models: arr('ProvenanceModel', { max: 2 * ENGINE_LIMIT_CEILINGS.maxEntriesPerSelection,
      uniqueBy: (m) => m.modelKey, uniqueCode: 'duplicate-model-key' }),
    scopeProof: obj('ScopeProof'),
    admissionBaseline: arr('AdmissionBaseline', { max: 2 * ENGINE_LIMIT_CEILINGS.maxEntriesPerSelection,
      uniqueBy: (a) => a.modelKey, uniqueCode: 'duplicate-model-key' }),
    hierarchyInternalAcceptance: obj('Acceptance', { nullable: true }),
    libraryExclusions: arr(str('reason'), { max: STRING_CAPS.id, uniqueBy: (e) => e }),
    placementVerified: lit(false),                                  // §13.2: deliberate and permanent
    environment: obj('Environment', { optional: true }),
    startedAt: str('timestamp'),
    finishedAt: str('timestamp'),
  } },
  ProvenanceModel: { fields: {
    modelKey: str('modelKey'), modelVersion: str('modelVersion'),
    scopeKinds: arr(enm(['model', 'elements']), { max: 2, uniqueBy: (k) => k }),
    elementCount: int(),
    scopeDigests: obj('ScopeDigests'),
    bindingGeneration: int(), placementGeneration: int(),
  } },
  ScopeDigests: { fields: {
    population: obj('Population', { nullable: true }),
    roots: arr('RootDigest', { max: ENGINE_LIMIT_CEILINGS.maxEntriesPerSelection,
      uniqueBy: (r) => r.dbId, uniqueCode: 'duplicate-root-dbid' }),
  } },
  Population: { fields: { count: int(), digest: digest() } },
  RootDigest: { fields: { dbId: dbId(), subtreeDigest: digest() } },
  ScopeProof: { fields: { method: lit('bracketed-digest'), digestVersion: lit(DIGEST_VERSION) } },
  AdmissionBaseline: { fields: { modelKey: str('modelKey'), epochInstanceCount: int() } },
  Acceptance: { fields: { recordRef: str('id') } },
  Environment: { fields: { viewerVersion: str('environmentField', { optional: true }),
    userAgent: str('environmentField', { optional: true }) } },
  Ledger: { open: true, fields: {
    planExists: bool(), pairSpaceTotal: int(), emptyOperand: bool(),
    units: arr('UnitRecord', { max: RUN_OPTION_CEILINGS.maxUnitsPerRun,
      uniqueBy: (u) => u.unitId, uniqueCode: 'duplicate-unit-id' }),
    rootOwners: arr('RootOwners', { max: 2 * ENGINE_LIMIT_CEILINGS.maxEntriesPerSelection,
      uniqueBy: (e) => e.modelKey, uniqueCode: 'duplicate-model-key' }),
    unresolvedSelections: arr('UnresolvedSelection', { max: RUN_OPTION_CEILINGS.maxLedgerRecords }),
    unreachablePopulation: arr('UnreachablePopulation', { max: 2 * ENGINE_LIMIT_CEILINGS.maxEntriesPerSelection,
      uniqueBy: (u) => u.modelKey, uniqueCode: 'duplicate-model-key' }),
    hierarchyInternal: arr('HierarchyInternal', { max: 2 * ENGINE_LIMIT_CEILINGS.maxEntriesPerSelection,
      uniqueBy: (h) => h.modelKey, uniqueCode: 'duplicate-model-key' }),
    planningGaps: arr('PlanningGap', { max: RUN_OPTION_CEILINGS.maxLedgerRecords }),
    exclusions: arr(str('reason'), { max: RUN_OPTION_CEILINGS.maxLedgerRecords, uniqueBy: (e) => e }),
    warnings: arr('Warning', { max: RUN_OPTION_CEILINGS.maxLedgerRecords }),
    budgetExhausted: bool(),
    firstRefusalUnitId: str('id', { nullable: true }),
  } },
  UnitRecord: { fields: {
    unitId: str('id'), kind: enm(['leaf', 'split']), parentUnitId: str('id', { nullable: true }),
    sourceModelKey: str('modelKey'), sourceRootDbIds: ids(),
    targets: arr('UnitTarget', { max: RUN_OPTION_CEILINGS.maxTargetModelsPerUnit,
      uniqueBy: (t) => t.modelKey, uniqueCode: 'duplicate-model-key' }),
    outcome: enm(['evaluated', 'failed', 'skipped', 'discarded', 'not-run', 'split']),
    cause: str('reason', { nullable: true }),
    secondaryCauses: arr(str('reason'), { max: RUN_OPTION_CEILINGS.maxLedgerRecords, uniqueBy: (c) => c }),
    capacityKind: str('reason', { nullable: true }),
    capDetail: enm(['ledger-records', 'unit-records'], { nullable: true }),
    scopeProof: enm(['equal', 'drift', 'unverifiable', 'not-checked']),
    pairSpaceWeight: int(),
    // Ruling A (task-P5.5 dispatch, carried from progress.md): NOT the plan's own literal
    // `RUN_OPTION_CEILINGS.maxElementTaintsPerUnit` -- that bare ceiling only bounds element-kind
    // taint entries; target-model/unit-kind entries are kept exact on top (see `MAX_UNIT_TAINTS`'s
    // own doc comment above). Reuses the SAME exported constant P5.4 already wired at the
    // capture-time `ARRAY_CEILINGS['/ledger/units/#/taints']` site, so the two ceilings cannot
    // drift apart.
    taints: arr('Taint', { max: MAX_UNIT_TAINTS }),
    attempts: int(), durationMs: int(),
  } },
  UnitTarget: { fields: { modelKey: str('modelKey'), scope: enm(['model', 'roots']),
    rootDbIds: ids({ optional: true }) } },
  Taint: { fields: { kind: enm(['element', 'target-model', 'unit']),
    modelKey: str('modelKey', { nullable: true }), dbId: dbId({ nullable: true }),
    reason: str('reason'), occurrences: int({ min: 1 }) } },
  RootOwners: { fields: { modelKey: str('modelKey'),
    owners: arr('RootOwnerRow', { max: ENGINE_LIMIT_CEILINGS.maxEntriesPerSelection,
      uniqueBy: (r) => r.rootDbId, uniqueCode: 'duplicate-root-dbid' }) } },
  // R2: `cls` reports its OWN code for an ABSENT field too (`missingCode`), because the rule
  // table says "absent or not 'A'/'B'/'C' => root-cls-invalid" -- a generic `missing-field` there
  // would silently retire a documented code.
  RootOwnerRow: { fields: { rootDbId: dbId(), ownerDbIds: ids(),
    cls: enm(['A', 'B', 'C'], { code: 'root-cls-invalid', missingCode: 'root-cls-invalid' }) } },
  UnresolvedSelection: { fields: { selectionRole: enm(['A', 'B']),
    modelKey: str('modelKey', { nullable: true }),
    cause: str('reason'), dbIds: ids() } },
  UnreachablePopulation: { fields: { modelKey: str('modelKey'), ownerDbIds: ids(),
    mixedOwnerDbIds: ids(), unattributable: obj('Unattributable') } },
  Unattributable: { fields: { notLoaded: int(), ownerUnresolvable: int() } },
  HierarchyInternal: { fields: { modelKey: str('modelKey'), rootCount: int(), ownerCount: int(),
    examples: arr('HierarchyExample', { max: HIERARCHY_EXAMPLES_CAP }) } },
  HierarchyExample: { fields: { rootDbId: dbId(), ownerDbIds: ids() } },
  PlanningGap: { fields: { phase: str('reason'), cause: str('reason') } },
  Warning: { fields: { code: str('reason'), modelKey: str('modelKey', { optional: true }) } },
  ClashResult: { custom: 'evidenceByMode', fields: {
    resultId: str('id'), pair: obj('PairId'), mode: enm(CLASH_MODES),
    evaluatedAs: obj('EvaluatedAs'),
    evidence: free(),                                  // shape is per-mode; `custom` checks it
    flags: obj('Flags'), unitId: str('id'),
  } },
  PairId: { fields: { first: obj('ElementRef'), second: obj('ElementRef') } },
  EvaluatedAs: { fields: { source: obj('ElementRef'), target: obj('ElementRef') } },
  ElementRef: { fields: { modelKey: str('modelKey'), dbId: dbId() } },
  Flags: { fields: { witnessUnavailable: lit(true, { optional: true }),
    unreachableOwner: lit(true, { optional: true }),
    mixedOwnerProvenance: lit(true, { optional: true }),
    duplicateEvidenceConflict: lit(true, { optional: true }) } },
  VolumeEvidence: { fields: { witness: obj('Witness', { nullable: true }) } },
  Witness: { fields: { kind: str('reason'), point: point3() } },
  ClearanceEvidence: { fields: { distance: num(), clearance: num(),
    closestPoints: obj('ClosestPoints') } },
  ClosestPoints: { fields: { first: point3(), second: point3() } },
  EmptyEvidence: { fields: {} },                       // containment / surface-intersection
  Diagnostics: { open: true, fields: {
    diagnostics: arr('NormalizedDiagnostic', { max: RUN_OPTION_CEILINGS.maxRetainedDiagnostics }),
    // NOT a count-map object: the real, shipped `execution/diagnostics.js` `snapshot()` produces
    // `countsByReason` as an ARRAY of `{scope, reason, count}` rows (`countsByReasonArr`), never a
    // plain object keyed by reason. The plan's own literal draft declared this field as a free-form
    // OBJECT ("checked ... as a bounded count-map"), which would reject every real engine output --
    // including the empty-diagnostics baseline (`[]` is not a plain object) -- a Critical-class
    // producer/reader defect (R21-2) caught by cross-checking the real P4 shape, not guessed.
    // Declared as an array of free-form (undeclared-inner-shape) rows, capped exactly like the
    // plan's own stated bound (`maxDistinctReasons`), so it is still "documented field, undocumented
    // contents" (waived below) while matching what a conforming engine actually writes.
    countsByReason: arr(free(), { max: RUN_OPTION_CEILINGS.maxDistinctReasons }),
    total: int(), completenessAffectingCount: int(), omittedReasonOccurrences: int(),
    unclassifiedOccurrences: int(), completenessAffectingUpperBound: int(),
    geometryReadinessOccurrences: int(), truncated: bool(),
  } },
  NormalizedDiagnostic: { fields: {                    // §12.2
    scope: enm(['fragment', 'pair']), reason: str('reason'), completenessAffecting: bool(),
    attribution: enm(['element', 'target-model', 'unit']),
    fragment: obj('DiagFragment', { optional: true }),
    fragments: obj('DiagFragmentPair', { optional: true }),
    ambiguousModelId: bool({ optional: true }),
    occurrences: int({ min: 1 }),
    unitIds: arr(str('id'), { max: RUN_OPTION_CEILINGS.maxUnitIdsPerDiagnostic, uniqueBy: (u) => u }),
  } },
  DiagFragmentPair: { fields: { first: obj('DiagFragment'), second: obj('DiagFragment') } },
  DiagFragment: { fields: { modelKey: str('modelKey', { nullable: true }), dbId: dbId({ nullable: true }),
    fragId: int(), role: enm(['source', 'target'], { optional: true }) } },
  Digests: { fields: {
    // NOT pinned to DIGEST_VERSION: §13.6 makes an unknown version valid-but-unverifiable. The
    // CLAIM predicate refuses it (review Critical 2); the validator must not call it corrupt.
    digestVersion: int({ min: 1 }),
    pairSetDigest: digest(), ledgerDigest: digest(),
  } },
}));

export const EVIDENCE_BY_MODE = Object.freeze({
  'volume-overlap': 'VolumeEvidence', clearance: 'ClearanceEvidence',
  'surface-intersection': 'EmptyEvidence', containment: 'EmptyEvidence',
});

// --- the two derived views ---------------------------------------------------------------------
const fieldNames = (typeName) => new Set(Object.keys(TYPES.get(typeName).fields));

/** §13.6's five OPEN types, keyed by their JSON-pointer parent path ('' = the ResultSet root).
 *  Derived from `TYPES` itself (not a second, hand-maintained field-name list) so this and the
 *  structural schema above can never drift apart. */
export const OPEN_TYPE_FIELDS = new Map([
  ['', fieldNames('ResultSet')], ['ledger', fieldNames('Ledger')],
  ['provenance', fieldNames('Provenance')], ['outcome', fieldNames('RunOutcome')],
  ['diagnostics', fieldNames('Diagnostics')],
]);

/**
 * A path is OPEN when its parent is one of those five types and its last segment is not a
 * documented field of that type. Everything BELOW an open path is in budget scope too (P0 applies
 * that half, and does not consult this predicate there). Inside a documented-but-free-form field
 * (`statistics`, `runOptions`, `countsByReason`) this is false: those are documented fields, not
 * unknown ones -- their cost is bounded by the capture node ceiling instead. The ROOT is never
 * open. Without this the ResultSet itself would enter budget scope and every conforming set would
 * be refused -- P0 passes `[]` for the root.
 */
export function isOpenPath(pathSegments) {
  if (pathSegments.length === 0) return false;
  const parent = pathSegments.slice(0, -1).join('/');
  const known = OPEN_TYPE_FIELDS.get(parent);
  return known !== undefined && !known.has(pathSegments[pathSegments.length - 1]);
}

/** Flattened for the negative tests: one row per declared field. A new row here without a matching
 *  generated mutation is a test failure, which is what keeps schema and tests from drifting. */
export const SCHEMA_ROWS = Object.freeze([...TYPES].flatMap(([type, def]) =>
  Object.entries(def.fields).map(([field, spec]) => Object.freeze({ type, field, spec }))));

// --- the generic walk ----------------------------------------------------------------------------
const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const specOf = (of) => (typeof of === 'string' ? { kind: 'object', of } : of);

function checkValue(value, spec, path, ctx) {
  if (value === null) { if (spec.nullable !== true) ctx.add(path, 'null-not-allowed'); return; }
  switch (spec.kind) {
    case 'literal':
      if (value !== spec.value) ctx.add(path, spec.code ?? 'literal-invalid');
      return;
    case 'boolean':
      if (typeof value !== 'boolean') ctx.add(path, 'type-invalid');
      return;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) { ctx.add(path, 'type-invalid'); return; }
      if (spec.integer === true && !Number.isSafeInteger(value)) { ctx.add(path, 'number-out-of-range'); return; }
      if (value < (spec.min ?? -Infinity) || value > (spec.max ?? Infinity)) ctx.add(path, 'number-out-of-range');
      return;
    case 'string':
      if (typeof value !== 'string') { ctx.add(path, 'type-invalid'); return; }
      if (spec.values !== undefined && !spec.values.has(value)) { ctx.add(path, spec.code ?? 'enum-invalid'); return; }
      if (spec.pattern !== undefined && !spec.pattern.test(value)) { ctx.add(path, spec.code ?? 'digest-syntax-invalid'); return; }
      if (value.length > STRING_CAPS[spec.cap]) ctx.add(path, 'string-too-long');
      return;
    case 'object':
      if (!isPlain(value)) { ctx.add(path, 'container-invalid'); return; }
      if (spec.free === true) return;                   // documented, undeclared-inner-shape field
      checkObject(value, spec.of, path, ctx);
      return;
    case 'array': {
      if (!Array.isArray(value)) { ctx.add(path, 'container-invalid'); return; }
      if (spec.exact !== undefined && value.length !== spec.exact) { ctx.add(path, 'array-length-invalid'); return; }
      if (spec.max !== undefined && value.length > spec.max) { ctx.add(path, 'array-too-long'); return; }
      const item = specOf(spec.of);
      const key = spec.uniqueBy ?? (spec.unique === true ? (v) => v : null);
      const seen = key === null ? null : new Set();
      for (let i = 0; i < value.length; i += 1) {
        const at = `${path}/${i}`;
        checkValue(value[i], item, at, ctx);
        if (seen === null || value[i] === null || value[i] === undefined) continue;
        const k = key(value[i]);
        if (seen.has(k)) ctx.add(at, spec.uniqueCode ?? 'duplicate-key'); else seen.add(k);
      }
      return;
    }
    default:
      ctx.add(path, 'type-invalid');
  }
}

function checkObject(value, typeName, path, ctx) {
  const type = TYPES.get(typeName);
  const fields = type.fields;
  for (const [name, spec] of Object.entries(fields)) {
    const at = `${path}/${name}`;
    // codex-review finding (2026-09-22, confirmed): `Object.hasOwn`, never `name in value` -- `in`
    // walks the PROTOTYPE chain too, so an own, enumerable property named `constructor` (or
    // `toString`, `hasOwnProperty`, `__proto__`, ...) would otherwise be silently treated as
    // "already a declared field of `value`" and skip the required-field check entirely.
    if (!Object.hasOwn(value, name)) { if (spec.optional !== true) ctx.add(at, spec.missingCode ?? 'missing-field'); continue; }
    // codex-review finding (2026-09-22, confirmed): `spec.delegated === true` used to `continue`
    // UNCONDITIONALLY here, so a PRIMITIVE or array `definition` (P2 owns the deep shape, but not
    // "is this even a container at all") passed through with no check of any kind -- reproduced
    // directly: `definition = 42` on an otherwise-valid set validated as `{ok: true, issues: []}`.
    // The container-shape half belongs HERE (co-located with every other container/type check);
    // the deep `validateTest` delegation itself still runs separately in
    // `checkShapeAndUnknownFields` (it needs `limits`, which this generic walk does not carry).
    if (spec.delegated === true) {
      if (value[name] !== null && !isPlain(value[name])) ctx.add(at, 'container-invalid');
      continue;
    }
    checkValue(value[name], spec, at, ctx);
  }
  for (const name of Object.keys(value)) {
    // Same `Object.hasOwn` fix as above, applied to the CLOSED-TYPE unknown-field check: `name in
    // fields` is true for `'constructor'`/`'toString'`/etc. purely via `Object.prototype`, even
    // though `fields` (a plain field-name -> spec map) never declares such a field itself -- an
    // attacker-chosen key colliding with a JS built-in would otherwise silently bypass
    // `unknown-field-closed-type` on every closed type in this schema.
    if (Object.hasOwn(fields, name)) continue;
    if (type.open === true) { ctx.openBytes += unknownFieldBytes(name, value[name]); continue; }
    ctx.add(`${path}/${name}`, 'unknown-field-closed-type');
  }
  if (type.custom === 'evidenceByMode') {
    const evidenceType = EVIDENCE_BY_MODE[value.mode];  // an unknown mode is already `enum-invalid`
    if (evidenceType !== undefined) {
      checkValue(value.evidence, { kind: 'object', of: evidenceType }, `${path}/evidence`, ctx);
    }
  }
}

/** UTF-8 byte length by code-unit scan -- the same measure P0's capture charges, and deliberately
 *  NOT `Buffer.byteLength` (P5 runs in the browser too; `Buffer` is Node-only). A lone surrogate
 *  counts as 3, matching P0's stated rule. P0 keeps this internal, so P5 has its own copy of the
 *  four-line function rather than an invented import; a divergence is caught by the shared
 *  budget-boundary test below. */
function utf8Length(s) {
  let bytes = 0;
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length
             && s.charCodeAt(i + 1) >= 0xdc00 && s.charCodeAt(i + 1) <= 0xdfff) { bytes += 4; i += 1; }
    else bytes += 3;
  }
  return bytes;
}

/** The SAME accounting P0 applies during capture -- key + container/primitive/string -- so the
 *  defensive re-check and the capture-time charge can never disagree about what a field costs.
 *  (A `canonicalJson`-based sum would have been a different, larger number.) */
function unknownFieldBytes(key, value) {
  let bytes = utf8Length(key);
  const stack = [value];
  while (stack.length > 0) {
    const v = stack.pop();
    if (typeof v === 'string') { bytes += utf8Length(v); continue; }
    if (v === null || typeof v !== 'object') { bytes += 8; continue; }   // number, boolean, null
    bytes += 8;                                                          // the container itself
    if (Array.isArray(v)) { for (const item of v) stack.push(item); continue; }
    for (const k of Object.keys(v)) { bytes += utf8Length(k); stack.push(v[k]); }
  }
  return bytes;
}

/** The FIRST phase of validation (review Critical 3). It establishes the shape every later phase
 *  assumes, so it runs in full before any cross-field check traverses an array or an object.
 *  Also resolves the "open/closed" table row that the generic walk cannot: `definition` is marked
 *  `delegated` above precisely so the walk skips it, and P2's `validateTest` -- the schema of
 *  record for a `ClashTestDefinition` -- is run on it here instead (never re-declared as a second
 *  copy of that closed schema). */
export function checkShapeAndUnknownFields(set, add, limits) {
  const ctx = { add, openBytes: 0 };
  checkObject(set, 'ResultSet', '', ctx);
  // `checkObject`'s own delegated-field branch (above) already reports `container-invalid` for a
  // present, non-null, non-plain `definition` (a number, string, boolean or array) and
  // `missing-field` for an absent one -- P2's `validateTest` is only meaningful, and only run, on a
  // genuinely plain-object value here, so a malformed container never gets a confusing SECOND,
  // unrelated `definition-invalid` on top of its real `container-invalid`.
  if (Object.hasOwn(set, 'definition') && set.definition !== null && isPlain(set.definition)) {
    const { issues } = validateTest(set.definition, { limits });
    if (issues.length > 0) add('/definition', 'definition-invalid');
  }
  // DEFENSIVE re-check only: capture already charged this budget mid-traversal and refused before
  // copying the offending value (P5.4). Reaching it here means capture did not run.
  if (ctx.openBytes > (limits.maxUnknownFieldBytes ?? UNKNOWN_FIELD_BYTES)) add('', 'unknown-field-bytes');
}

// --- ResultSetSummary (§13.5): the closed listing-page row shape --------------------------------
// A SEPARATE root schema, deliberately NOT folded into `TYPES`/`SCHEMA_ROWS`: this task's own
// anti-drift reachability test walks fixtures built from `TYPES.ResultSet`'s own field graph only,
// so a `ResultSetSummary`/model-row type added to that same map would report every one of its own
// fields as permanently "unreachable" (they are never visited from a `ResultSet` fixture) and fail
// that test outright. `TestRef` and `Digests` sub-objects ARE reused (via `checkValue`/`checkObject`
// against the SAME already-declared `TYPES` rows), so those two shapes stay single-sourced.
//
// Provenance note: this function's own schema and rule text are not authored anywhere in Task
// P5.5's own brief text despite `validateResultSetSummary` being declared as one of this task's
// four `Produces` -- verified by reading the FULL extracted Task P5.5 section (the brief file) end
// to end. Implemented here from the master design specification's own normative shape (§13.5,
// "Listings are untrusted data too": `ResultSetSummary = {runId, testRef, status, coverage,
// integrity, environmentSensitive, counts: {results, units, pairSpaceTotal}, serializedBytes,
// digests, models: [{modelKey, modelVersion}], startedAt, finishedAt}`, ..., "models <= 20,000
// entries (= 2 x maxEntriesPerSelection ceiling) with no duplicate modelKey, enums exact, unknown
// keys rejected, plain data only") and cross-checked against the one real consumer already present
// in this repository's OWN plan text (`InMemoryResultStore.js`'s `summarize()`), not guessed. This
// task's own acceptance test file never exercises it either way.
const SUMMARY_MAX_MODELS = 2 * ENGINE_LIMIT_CEILINGS.maxEntriesPerSelection;   // §13.5's own 2x rule
const SUMMARY_KEYS = Object.freeze(['runId', 'testRef', 'status', 'coverage', 'integrity',
  'environmentSensitive', 'counts', 'serializedBytes', 'digests', 'models', 'startedAt', 'finishedAt']);
const COUNTS_KEYS = Object.freeze(['results', 'units', 'pairSpaceTotal']);
const SUMMARY_MODEL_KEYS = Object.freeze(['modelKey', 'modelVersion']);
const MAX_SUMMARY_ISSUES = 20;

/**
 * Task-review finding (2026-09-22, Important, confirmed): `validateResultSetSummary` shipped
 * without the exact precondition `validateResultSet.js`'s own `assertCaptured` was hardened with
 * in THIS task -- reproduced empirically: `Object.create(validSummary)` (zero own properties, every
 * field read via the PROTOTYPE chain through a plain `in`/property read) validated `{ok: true,
 * issues: []}`, and a summary with an accessor-backed own `counts` property validated `{ok: true}`
 * while invoking the getter. §13.5 says "Listings are untrusted data too" -- the same rule that
 * motivated this task's own hardening of the main validator applies here. This is a SEPARATE,
 * local copy of `assertCaptured` (not an import of `validateResultSet.js`'s own), because
 * `validateResultSet.js` already imports FROM this file (`checkShapeAndUnknownFields`); importing
 * the other way would be circular. Matches this file's own established precedent for `utf8Length`
 * (P0's own copy kept local rather than an invented cross-module import).
 */
const SUMMARY_UNCAPTURED = 'ERR_UNCAPTURED_INPUT';
function assertSummaryCaptured(value) {
  const ok = value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype
    && Object.values(Object.getOwnPropertyDescriptors(value)).every((d) => 'value' in d);
  if (ok) return;
  const err = new TypeError('validateResultSetSummary: argument must be a captured copy (spec '
    + '§13.5); the caller must capture the whole listing PAGE as one detached copy before '
    + 'validating its rows');
  err.code = SUMMARY_UNCAPTURED;
  throw err;
}

/**
 * §13.5's closed `ResultSetSummary` shape for one listing-page row. `(summary, {limits}) ->
 * {ok, issues}` per the interface table. Like `validateResultSet` itself, this is NOT the
 * untrusted-input boundary (`assertSummaryCaptured` is the same cheap O(1) root-descriptor sanity
 * check, not a recursive capture) -- the caller is responsible for capturing the whole PAGE as one
 * detached copy before iterating rows through this function (see this task's report for the
 * residual page-level atomicity note this implementation surfaced). Every presence check below uses
 * `Object.hasOwn`, never `in`, so a nested object reached from an already-captured row still cannot
 * spoof "field present" through the prototype chain.
 */
export function validateResultSetSummary(summary, { limits } = {}) {   // eslint-disable-line no-unused-vars
  // `limits` is accepted (per the interface table's `(summary, {limits}) => {ok, issues}` and the
  // one real call site already in this plan, `InMemoryResultStore.list()`'s
  // `validateResultSetSummary(s, {})`) but not consulted: every bound this closed shape needs
  // (`SUMMARY_MAX_MODELS`, the §13.5.2 string caps) is a fixed structural CEILING, not a
  // reader-configured `limits` value -- the same "never the reading engine's configured options"
  // rule §13.6 applies to the main schema.
  assertSummaryCaptured(summary);
  const issues = [];
  const add = (path, code) => { if (issues.length < MAX_SUMMARY_ISSUES) issues.push({ path, code }); };
  for (const k of Object.keys(summary)) {
    if (!SUMMARY_KEYS.includes(k)) add(`/${k}`, 'unknown-field-closed-type');
  }
  const ctx = { add, openBytes: 0 };   // no open type here; openBytes is unused but required by checkValue

  const requireField = (key, spec) => {
    if (!Object.hasOwn(summary, key)) { add(`/${key}`, 'missing-field'); return; }
    checkValue(summary[key], spec, `/${key}`, ctx);
  };
  requireField('runId', str('id'));
  requireField('testRef', obj('TestRef'));
  requireField('status', TYPES.get('RunOutcome').fields.status);
  requireField('coverage', TYPES.get('RunOutcome').fields.coverage);
  requireField('integrity', TYPES.get('RunOutcome').fields.integrity);
  requireField('environmentSensitive', bool());
  requireField('serializedBytes', int());
  requireField('digests', obj('Digests'));
  requireField('startedAt', str('timestamp'));
  requireField('finishedAt', str('timestamp'));

  if (!Object.hasOwn(summary, 'counts')) add('/counts', 'missing-field');
  else if (!isPlain(summary.counts)) add('/counts', 'container-invalid');
  else {
    for (const k of Object.keys(summary.counts)) {
      if (!COUNTS_KEYS.includes(k)) add(`/counts/${k}`, 'unknown-field-closed-type');
    }
    for (const k of COUNTS_KEYS) {
      if (!Object.hasOwn(summary.counts, k)) add(`/counts/${k}`, 'missing-field');
      else checkValue(summary.counts[k], int(), `/counts/${k}`, ctx);
    }
  }

  if (!Object.hasOwn(summary, 'models')) add('/models', 'missing-field');
  else if (!Array.isArray(summary.models)) add('/models', 'container-invalid');
  else {
    if (summary.models.length > SUMMARY_MAX_MODELS) add('/models', 'array-too-long');
    const seen = new Set();
    for (let i = 0; i < summary.models.length; i += 1) {
      const row = summary.models[i];
      const at = `/models/${i}`;
      if (!isPlain(row)) { add(at, 'container-invalid'); continue; }
      for (const k of Object.keys(row)) {
        if (!SUMMARY_MODEL_KEYS.includes(k)) add(`${at}/${k}`, 'unknown-field-closed-type');
      }
      if (!Object.hasOwn(row, 'modelKey')) add(`${at}/modelKey`, 'missing-field');
      else checkValue(row.modelKey, str('modelKey'), `${at}/modelKey`, ctx);
      if (!Object.hasOwn(row, 'modelVersion')) add(`${at}/modelVersion`, 'missing-field');
      else checkValue(row.modelVersion, str('modelVersion'), `${at}/modelVersion`, ctx);
      if (isPlain(row) && typeof row.modelKey === 'string') {
        if (seen.has(row.modelKey)) add(`${at}/modelKey`, 'duplicate-model-key'); else seen.add(row.modelKey);
      }
    }
  }

  return { ok: issues.length === 0, issues };
}
