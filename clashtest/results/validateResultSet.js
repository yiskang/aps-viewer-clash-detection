// clashtest/results/validateResultSet.js
//
// Task P5.4 authored `captureResultSet`, `nodeCeilingError` and `applyMigration` (spec §13.6,
// capture-first detached reads). Task P5.5 (this pass) adds the structural/cross-field/linkage/
// order/digest walk (`validateResultSetSteps`, `validateResultSet`, `readResultSet`), per the
// controller's file-ownership ruling (.superpowers/sdd/p5-result-set/progress.md).
//
// Capture-first: nothing is ever read off the untrusted `raw` argument before the descriptor-based
// traversal in `util/capture.js` reads it. `runId` is an explicit diagnostic parameter for exactly
// that reason — never read off `raw` — so a hostile `runId` getter can never fire (see the
// 'accessors are rejected...' test).

import { captureData, deepFreezeSliced } from '../util/capture.js';
import { digestCanonical, DIGEST_VERSION } from '../util/canonical.js';
import { makeResultId, makePairId, comparePairIds } from '../identity/ids.js';
import { isOpenPath, UNKNOWN_FIELD_BYTES, MAX_UNIT_TAINTS, checkShapeAndUnknownFields } from './resultSetSchema.js';
import { RUN_OPTION_CEILINGS, ENGINE_LIMIT_CEILINGS, SCHEMA_MAX_NODES } from '../options.js';
import { CorruptResultSetError, ResultSetTooLargeError, UnsupportedSchemaVersionError } from '../errors.js';
import { SCHEMA_VERSION, pairSetDigestInput, ledgerDigestInput, ENVIRONMENT_CAUSES } from './resultSet.js';

export { SCHEMA_VERSION };
// §13.5: the closed `ResultSetSummary` shape for listings, co-located with the generic schema walk
// it reuses (`resultSetSchema.js`'s `TestRef`/`Digests` rows) but re-exported from here because
// this is the file the interface table names as its code home.
export { validateResultSetSummary } from './resultSetSchema.js';

const MAX_ISSUES = 20;               // §13.6: the first 20 {path, code}, never a value
const MAX_DEPTH = 64;                // §13.6 — a data-format property, not a §17.1 default
const MAX_STRING_LENGTH = 4096;      // §13.5.2 field caps: the largest of them
const MAX_KEY_LENGTH = 256;
const NO_MIGRATIONS = new Map();

// JSON-pointer shape -> §17.1.1 hard maximum. These are DATA-FORMAT ceilings: never the reading
// engine's configured run options (§13.6: "a valid set produced under a larger configuration must
// not become corrupt under a smaller one"), and never the set's self-reported options.
const ARRAY_CEILINGS = new Map([
  ['/results', RUN_OPTION_CEILINGS.maxResultsPerRun],
  ['/ledger/units', RUN_OPTION_CEILINGS.maxUnitsPerRun],
  // Controller ruling (taints[] ceiling): NOT a bare `maxElementTaintsPerUnit` — see
  // resultSetSchema.js's `MAX_UNIT_TAINTS` doc comment for the full derivation.
  ['/ledger/units/#/taints', MAX_UNIT_TAINTS],
  ['/diagnostics/diagnostics', RUN_OPTION_CEILINGS.maxRetainedDiagnostics],
  ['/provenance/models', 2 * ENGINE_LIMIT_CEILINGS.maxEntriesPerSelection],   // §13.5's 2x summary ceiling
]);
const DEFAULT_ARRAY_CEILING = RUN_OPTION_CEILINGS.maxLedgerRecords;
const pointerShape = (pointer) => pointer.replace(/\/\d+(?=\/|$)/g, '/#');
const arrayLimitFor = (pointer) => ARRAY_CEILINGS.get(pointerShape(pointer)) ?? DEFAULT_ARRAY_CEILING;

const corrupt = (runId, issues) => new CorruptResultSetError({ runId,
  issues: issues.slice(0, MAX_ISSUES).map(({ path, code }) => ({ path, code })) });   // drop `message`: it may quote a value

/** A well-formed, in-range OLDER schema version — regardless of whether a migration is actually
 *  registered for it. Kept separate from `migratableFrom` (review Important 1): a malformed value
 *  (0, negative, non-integer, non-number) is `invalid-schema-version` even if some caller mistakenly
 *  registers a migration under that exact key, while a well-formed older version with no migration
 *  registered is the distinct `migration-failed` case. */
const isValidOlderVersion = (v, currentVersion) => Number.isInteger(v) && v >= 1 && v < currentVersion;

/** Review Important 1: the RANGE decides admissibility; the table only decides whether an already
 *  admissible older version can actually be converted. Registering a migration under key `0` (or
 *  `1.5`, or `'1'`) must NOT make that version valid. `currentVersion` is injectable for the pure
 *  dispatcher test only — production always uses SCHEMA_VERSION. */
const migratableFrom = (v, migrations, currentVersion = SCHEMA_VERSION) =>
  isValidOlderVersion(v, currentVersion) && migrations.has(v);

function schemaVersionError(value, runId) {
  if (Number.isInteger(value) && value > SCHEMA_VERSION) {
    return new UnsupportedSchemaVersionError({ type: 'ResultSet', schemaVersion: value, supported: SCHEMA_VERSION });
  }
  const code = isValidOlderVersion(value, SCHEMA_VERSION)
    ? 'migration-failed'                              // a known older version with no registered migration
    : 'invalid-schema-version';                       // absent, non-integer, < 1, or not a number at all
  return corrupt(runId, [{ path: '/schemaVersion', code }]);
}

/**
 * codex-review finding (2026-09-22, fixed): P0's `captureData` rootGate only intercepts a
 * PRIMITIVE `schemaVersion` value (its own check is `value === null || typeof value !== 'object'`
 * — see `util/capture.js`); an ABSENT, object-valued or accessor-backed `schemaVersion` silently
 * passes the gate, so without this pre-check the reader would traverse and allocate up to
 * `maxCapturedNodes` of otherwise-legal sibling data before an eventual rejection — the exact
 * opposite of "rejected before any other property is read" (§13.6). This pre-check closes that gap
 * WITHOUT any P0 change: it inspects ONLY `schemaVersion`'s OWN property DESCRIPTOR — never its
 * value via `[[Get]]` — so a hostile getter still cannot fire, and no other property of `raw` is
 * ever touched. It returns `{defer: true}` when the real, full capture should decide instead (an
 * accessor, so behavior stays uniform with every other accessor field via the general `accessor`
 * code; `raw` itself not a plain object, so whatever structural code fits can run) or
 * `{defer: false, value}` with the offending value to classify when it already knows enough to
 * reject immediately.
 */
function checkSchemaVersionFirst(raw, migrations) {
  if (raw === null || typeof raw !== 'object') return { defer: true };
  let desc;
  try {
    desc = Reflect.getOwnPropertyDescriptor(raw, 'schemaVersion');
  } catch {
    return { defer: true };                           // a hostile trap: let the real capture report `unreadable`
  }
  if (desc !== undefined && ('get' in desc || 'set' in desc)) return { defer: true };   // let it report `accessor`
  const value = desc === undefined ? undefined : desc.value;
  if (value === SCHEMA_VERSION || migratableFrom(value, migrations)) return { defer: true };   // admissible
  return { defer: false, value };
}

/** Capture-first (§13.6). `runId` is an explicit DIAGNOSTIC parameter: nothing is ever read off
 *  `raw` before the descriptor-based traversal, so no accessor on untrusted input can fire. */
export function captureResultSet(raw, { limits, runId = null, migrations = NO_MIGRATIONS } = {}) {
  const pre = checkSchemaVersionFirst(raw, migrations);
  if (pre.defer === false) throw schemaVersionError(pre.value, runId);
  const result = captureData(raw, {
    maxNodes: Math.min(limits.maxCapturedNodes, SCHEMA_MAX_NODES),
    maxDepth: MAX_DEPTH,
    maxIssues: MAX_ISSUES,
    maxStringLength: MAX_STRING_LENGTH,
    maxKeyLength: MAX_KEY_LENGTH,
    maxArrayLength: DEFAULT_ARRAY_CEILING,
    arrayLimitFor,
    // §13.6's 64 KiB unknown-field budget, charged DURING the traversal and BEFORE the offending
    // value is copied. `isOpenPath` is derived from the one closed-open-type table this module
    // shares with resultSetSchema.js, so "what is unknown" has a single definition.
    openFieldBudget: { isOpenPath, maxBytes: limits.maxUnknownFieldBytes ?? UNKNOWN_FIELD_BYTES },
    // Fixed key order: `schemaVersion` is read FIRST and a value this build cannot handle stops
    // the capture before any other property is reached (P0 rootGate).
    rootGate: { key: 'schemaVersion',
                check: (v) => v === SCHEMA_VERSION || migratableFrom(v, migrations) },
  });
  if (result.gate !== undefined) throw schemaVersionError(result.gate.value, runId);
  if (result.ok === false) {
    if (result.issues.some((i) => i.code === 'too-many-nodes')) throw nodeCeilingError(limits, runId, result.issues);
    throw corrupt(runId, result.issues);               // incl. `unknown-field-bytes` (§13.6)
  }
  // Defensive backstop for the cases `checkSchemaVersionFirst` deliberately defers (`raw` not a
  // plain object at all; a race between the pre-check and the real traversal is not otherwise
  // possible in single-threaded JS, but costs nothing to guard here too) — checked on `result.value`,
  // our OWN already-captured, detached, trusted copy, never on `raw`, so this does not reopen the
  // capture-first boundary.
  const v = result.value.schemaVersion;
  if (v !== SCHEMA_VERSION && !migratableFrom(v, migrations)) throw schemaVersionError(v, runId);
  return result.value;
}

/** ONE ceiling, two meanings (P0 design note 2). At or above `SCHEMA_MAX_NODES` the DATA is out of
 *  format — no conforming writer can produce it — so it is corrupt; below it only this reader is
 *  too small, which §13.6 requires to be "valid, not corrupt". Pure, so both branches are testable
 *  without allocating a 16-million-node object. */
export function nodeCeilingError(limits, runId, issues) {
  return limits.maxCapturedNodes < SCHEMA_MAX_NODES
    ? new ResultSetTooLargeError({ runId })
    : corrupt(runId, issues);
}

/** Single-hop migration dispatch (§13.6, registered per fromVersion). One lookup; the entry must
 *  return a set already at `currentVersion`. A malformed source version is `invalid-schema-version`
 *  — never admissible, whether or not a migration happens to be registered under that exact key
 *  (review Important 1). Past that point, a missing, throwing or non-conforming migration is
 *  `migration-failed` (review question 3). The real table is empty while SCHEMA_VERSION === 1.
 *  `currentVersion` is injectable for the pure dispatcher test only. */
export function applyMigration(captured, migrations, { runId, currentVersion = SCHEMA_VERSION } = {}) {
  const failed = (code) => corrupt(runId, [{ path: '/schemaVersion', code }]);
  if (!isValidOlderVersion(captured.schemaVersion, currentVersion)) throw failed('invalid-schema-version');
  const migrate = migrations.get(captured.schemaVersion);
  if (typeof migrate !== 'function') throw failed('migration-failed');

  // codex-review finding (2026-09-22, fixed): a migration's RETURN VALUE is untrusted output too —
  // an array, a Proxy, an inherited or accessor-backed `schemaVersion`, or a throwing getter must
  // all become `migration-failed`, never a raw escaped exception and never silently accepted.
  // `getOwnPropertyDescriptor` (never `.schemaVersion` via `[[Get]]`) rules out an accessor and an
  // INHERITED value; requiring the plain-object shape rules out an array or other non-plain
  // container. This is a TOP-LEVEL shape check only (matching this function's own narrow contract:
  // dispatch and admit-or-reject on `schemaVersion`) — it does not recursively capture the rest of
  // `migrated`, so a nested accessor or a cycle elsewhere in a migration's output is NOT caught
  // here. That is Task P5.5's `readResultSet`, which re-validates migration output through
  // `validateResultSetSteps` next; see this task's report for the residual-scope note.
  let migrated;
  let versionDesc;
  try {
    migrated = migrate(captured);
    const plain = migrated !== null && typeof migrated === 'object' && !Array.isArray(migrated)
      && Object.getPrototypeOf(migrated) === Object.prototype;
    versionDesc = plain ? Reflect.getOwnPropertyDescriptor(migrated, 'schemaVersion') : undefined;
  } catch {
    throw failed('migration-failed');   // `migrate()` itself, or a hostile trap on its output, threw
  }
  if (versionDesc === undefined || !('value' in versionDesc) || versionDesc.value !== currentVersion) {
    throw failed('migration-failed');
  }
  return migrated;
}

// =================================================================================================
// Task P5.5: cross-field, linkage, order and digest validation, plus the public entry points.
// =================================================================================================

const FATAL_CAUSES = new Set(['world-disposed', 'internal-error', 'result-cap']);
const INPUT_CHANGE_CAUSES = new Set(['input-changed', 'scope-drift', 'cancel-requested']);

/** Review question 1, answered: `validateResultSet` is NOT an untrusted-input boundary. It reads
 *  properties directly, so a raw hostile object would invoke getters — the exact thing capture
 *  exists to prevent. `captureResultSet`/`readResultSet` are the one boundary; this is the cheap
 *  O(1) precondition that makes the rule enforced rather than merely documented. */
const UNCAPTURED = 'ERR_UNCAPTURED_INPUT';
function assertCaptured(set) {
  const ok = set !== null && typeof set === 'object' && !Array.isArray(set)
    && Object.getPrototypeOf(set) === Object.prototype
    && Object.values(Object.getOwnPropertyDescriptors(set)).every((d) => 'value' in d);
  if (ok) return;
  const err = new TypeError('validateResultSet: argument must be a captured copy (spec §13.6); '
    + 'call captureResultSet/readResultSet at the untrusted boundary');
  err.code = UNCAPTURED;
  throw err;
}

/** §13.6 R21-2: the leaves of a ledger are every unit that is not itself superseded by a split —
 *  VERBATIM the same filter `resultSet.js`'s `deriveRunOutcome` applies, because this predicate
 *  must be the writer's own (a reader that computed "full coverage" differently from the writer
 *  would reject sets the writer itself considers valid, or accept ones it does not). */
const leavesOf = (ledger) => ledger.units.filter((u) => u.outcome !== 'split');

/** Global, non-per-result cross-field rules: definition/testRef null-parity, the `coverage: 'full'`
 *  predicate (mirroring `deriveRunOutcome` exactly), `status: 'completed'` vs. a fatal/planning-gap
 *  cause, and the ledger's own pair-space arithmetic. None of these need a per-result scan. */
function checkCrossField(set, add) {
  const { definition, testRef, outcome, ledger, diagnostics, results } = set;

  if ((definition === null) !== (testRef.semanticDigest === null)) {
    add('/definition', 'definition-digest-mismatch');
  }

  const leaves = leavesOf(ledger);
  const derivedFull = ledger.planExists === true
    && ledger.planningGaps.length === 0
    && leaves.length > 0
    && leaves.every((u) => u.outcome === 'evaluated' && u.scopeProof === 'equal');
  if (outcome.coverage === 'full' && !derivedFull) add('/outcome/coverage', 'coverage-not-full');

  // Owner-authorized P5 remediation (docs/reviews/2026-09-22-federated-clash-test-core-p5-owner-
  // decision-brief.md, Item 1; owner ruling 2026-09-22: "Read-time validation must fail closed and
  // must not allow a forged or tampered Result Set to support a false no-clash claim when any
  // governing outcome axis is inconsistent"). Only `coverage` was re-derived above; `integrity` and
  // `environmentSensitive`(+Causes) were only shape-checked, so a set whose `outcome.integrity` or
  // `outcome.environmentSensitive(+Causes)` was altered (producer bug, or tampering) without changing
  // the diagnostics/results/ledger facts that determine the true value validated `{ok: true}`. This
  // mirrors `deriveRunOutcome` (resultSet.js) EXACTLY -- this reader's copy of the predicate must
  // never drift from the writer's, same as the `coverage` re-check above. NOTE (the brief's own
  // framing correction, carried forward so a future reader does not overclaim this): this closes an
  // internal self-consistency / accidental-corruption hole, NOT an authenticity/forgery boundary -- a
  // hostile fabricator who controls the whole set can always make both sides agree.
  const duplicateConflict = results.some((r) => r.flags?.duplicateEvidenceConflict === true);
  const derivedIntegrity = diagnostics.completenessAffectingUpperBound > 0 || duplicateConflict
    ? 'caveated' : 'clean';
  if (outcome.integrity !== derivedIntegrity) add('/outcome/integrity', 'integrity-not-derived');

  const envCauses = new Set();
  for (const u of leaves) {
    if (u.capacityKind === 'bucket-capacity') envCauses.add('bucket-capacity');
    if (u.outcome === 'failed' && u.cause === 'stale-placement') envCauses.add('placement-contention');
  }
  if (diagnostics.geometryReadinessOccurrences > 0 || diagnostics.unclassifiedOccurrences > 0) {
    envCauses.add('geometry-readiness');
  }
  const derivedEnvironmentSensitiveCauses = ENVIRONMENT_CAUSES.filter((c) => envCauses.has(c));
  const derivedEnvironmentSensitive = derivedEnvironmentSensitiveCauses.length > 0;
  // `deriveRunOutcome` always emits `environmentSensitiveCauses` in `ENVIRONMENT_CAUSES`'s own fixed
  // order (it is built via `ENVIRONMENT_CAUSES.filter(...)`), so a straightforward element-by-element
  // comparison against the recorded array is a valid equality check -- no sorting needed on either side.
  const causesMatch = outcome.environmentSensitiveCauses.length === derivedEnvironmentSensitiveCauses.length
    && outcome.environmentSensitiveCauses.every((c, i) => c === derivedEnvironmentSensitiveCauses[i]);
  if (outcome.environmentSensitive !== derivedEnvironmentSensitive || !causesMatch) {
    add('/outcome/environmentSensitive', 'environment-sensitive-mismatch');
  }

  const hasFatalOrGapCause = (u) => FATAL_CAUSES.has(u.cause) || INPUT_CHANGE_CAUSES.has(u.cause)
    || u.secondaryCauses.some((c) => FATAL_CAUSES.has(c) || INPUT_CHANGE_CAUSES.has(c));
  if (outcome.status === 'completed'
      && (ledger.planningGaps.length > 0 || ledger.units.some(hasFatalOrGapCause))) {
    add('/outcome/status', 'completed-with-fatal-cause');
  }

  if (ledger.emptyOperand === true && ledger.pairSpaceTotal > 0) {
    add('/ledger/pairSpaceTotal', 'pair-space-inconsistent');
  }
  const leafWeightSum = leaves.reduce((n, u) => n + u.pairSpaceWeight, 0);
  if (ledger.pairSpaceTotal !== leafWeightSum) add('/ledger/pairSpaceTotal', 'pair-space-inconsistent');
}

/** (modelKey, dbId) as a collision-free string key — local to this file's own linkage bookkeeping
 *  (never P1's `elementRefKey`, which VALIDATES its input; every ref reaching this function has
 *  already passed the structural phase, and this key is used only for local Map/Set membership). */
const refKey = (ref) => `${ref.modelKey}\u0000${ref.dbId}`;

/** True iff `{evaluatedAs.source, evaluatedAs.target}` names exactly the same two refs as
 *  `{pair.first, pair.second}` (order-independent — the pair's own order is a canonical-order
 *  artifact, not a claim about which physical element was the library's "source"). */
function sameRefSet(pair, evaluatedAs) {
  const pairKeys = new Set([refKey(pair.first), refKey(pair.second)]);
  const evalKeys = [refKey(evaluatedAs.source), refKey(evaluatedAs.target)];
  return evalKeys.length === pairKeys.size && evalKeys.every((k) => pairKeys.has(k));
}

/** Root ownership lookup: for a model, the rootDbId that "owns" a given dbId, per `rootOwners`.
 *  codex-review finding (2026-09-22, security, confirmed): the structural schema's own uniqueness
 *  rules (`RootOwners.owners` unique by `rootDbId`; `RootOwnerRow.ownerDbIds` unique WITHIN one
 *  root) do not stop the SAME ownerDbId from being listed under TWO DIFFERENT roots of the same
 *  model -- a cross-row inconsistency no single-array `uniqueBy` check can see. Left unchecked,
 *  `owners.set(...)` would silently keep whichever root happened to be visited last, letting a
 *  corrupt or forged set claim ambiguous root attribution while passing `owner-not-in-ledger` /
 *  `result-unit-coverage` -- reproduced by the reviewer directly against `validateResultSet`. */
function buildOwnerIndex(rootOwners, add) {
  const byModel = new Map();
  for (const row of rootOwners) {
    let owners = byModel.get(row.modelKey);
    if (owners === undefined) { owners = new Map(); byModel.set(row.modelKey, owners); }
    for (const owner of row.owners) {
      for (const ownerDbId of owner.ownerDbIds) {
        const claimedBy = owners.get(ownerDbId);
        if (claimedBy !== undefined && claimedBy !== owner.rootDbId) {
          add('/ledger/rootOwners', 'duplicate-owner-dbid');
        }
        owners.set(ownerDbId, owner.rootDbId);
      }
    }
  }
  return byModel;
}

/** True iff `ref` is a genuine root owner somewhere in `ownerIndex` (independent of any unit). */
function isRootOwner(ownerIndex, ref) {
  return ownerIndex.get(ref.modelKey)?.has(ref.dbId) === true;
}

/** True iff `ref`'s dbId is covered by `unit`'s declared SOURCE range. When the ref's owning root
 *  cannot be resolved (it is not a root owner at all), the check trusts `unreachableOwner` rather
 *  than failing closed a second time — `owner-not-in-ledger` is the check that owns "is this dbId
 *  known to the ledger at all"; this one asks only "does the covering unit's own declared range
 *  include it", which is unanswerable once ownership itself could not be resolved. */
function coveredBySource(unit, ref, ownerIndex, unreachableOwner) {
  if (ref.modelKey !== unit.sourceModelKey) return false;
  const rootDbId = ownerIndex.get(ref.modelKey)?.get(ref.dbId);
  if (rootDbId === undefined) return unreachableOwner === true;
  return unit.sourceRootDbIds.includes(rootDbId);
}

/** Same as `coveredBySource`, for the TARGET side: a `scope: 'model'` target covers the whole
 *  model regardless of root; a `scope: 'roots'` target needs the ref's owning root in its list. */
function coveredByTarget(unit, ref, ownerIndex, unreachableOwner) {
  for (const t of unit.targets) {
    if (t.modelKey !== ref.modelKey) continue;
    if (t.scope === 'model') return true;
    const rootDbId = ownerIndex.get(ref.modelKey)?.get(ref.dbId);
    if (rootDbId === undefined) return unreachableOwner === true;
    if ((t.rootDbIds ?? []).includes(rootDbId)) return true;
  }
  return false;
}

/** R21-4 linkage, plus the per-result cross-field rules that need the same maps/loop
 *  (`owner-not-in-ledger`, `unreachable-flag-invalid`, `result-id-mismatch`) and the ledger-mention
 *  half of `model-not-in-provenance`. One `Map<unitId, UnitRecord>` and one owner index are built
 *  once; every result is then checked in a single canonical-order pass. */
function checkResultLinkage(set, add) {
  const unitsById = new Map(set.ledger.units.map((u) => [u.unitId, u]));
  const ownerIndex = buildOwnerIndex(set.ledger.rootOwners, add);
  const unreachableIndex = new Map(
    set.ledger.unreachablePopulation.map((u) => [u.modelKey, new Set(u.ownerDbIds)]));
  const provenanceModelKeys = new Set(set.provenance.models.map((m) => m.modelKey));
  const mentioned = new Set();
  for (const u of set.ledger.units) {
    mentioned.add(u.sourceModelKey);
    for (const t of u.targets) mentioned.add(t.modelKey);
    // P5 final whole-branch review, CT-1 (fixed): `taints[].modelKey` (`TYPES.Taint`, nullable --
    // resultSetSchema.js) is a ledger-resident, schema-declared model-key field this collection was
    // missing, same pattern as the two P5.5 fix-round additions below. Deliberately NOT
    // `diagnostics.diagnostics[].fragment(s).modelKey` -- the review flagged that as arguably outside
    // this rule's literal "results or ledger" wording, and it is left for the milestone owner.
    for (const t of u.taints) if (t.modelKey !== null) mentioned.add(t.modelKey);
  }
  for (const row of set.ledger.rootOwners) mentioned.add(row.modelKey);
  for (const row of set.ledger.unreachablePopulation) mentioned.add(row.modelKey);
  for (const row of set.ledger.hierarchyInternal) mentioned.add(row.modelKey);
  // Task-review finding (2026-09-22, Important, confirmed): the rule row is "provenance.models
  // misses a modelKey the results OR LEDGER mention" -- `unresolvedSelections[].modelKey`
  // (nullable) and `warnings[].modelKey` (optional) are both ledger-resident, schema-declared
  // model-key fields this collection was missing. Reproduced by the reviewer: a re-sealed set with
  // either field set to a phantom modelKey validated `{ok: true}`.
  for (const row of set.ledger.unresolvedSelections) if (row.modelKey !== null) mentioned.add(row.modelKey);
  for (const row of set.ledger.warnings) if (Object.hasOwn(row, 'modelKey')) mentioned.add(row.modelKey);

  const semanticDigest = set.testRef.semanticDigest;
  const testId = set.testRef.testId;
  const definitionMode = set.definition !== null ? set.definition.mode : null;

  for (let i = 0; i < set.results.length; i += 1) {
    const r = set.results[i];
    const path = `/results/${i}`;
    mentioned.add(r.pair.first.modelKey);
    mentioned.add(r.pair.second.modelKey);

    const unreachableOwner = r.flags.unreachableOwner === true;
    let bothRootOwners = true;
    for (const ref of [r.pair.first, r.pair.second]) {
      const ownedByRoot = isRootOwner(ownerIndex, ref);
      if (!ownedByRoot) bothRootOwners = false;
      const inUnreachable = unreachableOwner && unreachableIndex.get(ref.modelKey)?.has(ref.dbId) === true;
      if (!ownedByRoot && !inUnreachable) add(`${path}/pair`, 'owner-not-in-ledger');
    }
    if (unreachableOwner && bothRootOwners) add(`${path}/flags/unreachableOwner`, 'unreachable-flag-invalid');

    if (semanticDigest !== null) {
      let expected;
      try { expected = makeResultId(testId, semanticDigest, r.pair); } catch { expected = null; }
      if (expected === null || expected !== r.resultId) add(`${path}/resultId`, 'result-id-mismatch');
    }

    // Owner-authorized P5 remediation (docs/reviews/2026-09-22-federated-clash-test-core-p5-owner-
    // decision-brief.md, Item 2; owner ruling 2026-09-22: "Stored pairs must satisfy the existing
    // canonical orientation invariant so one physical clash cannot be represented under duplicate
    // flipped identities"). `sameRefSet` (above) only checks that `pair` and `evaluatedAs` name the
    // same two elements as an unordered SET -- it never checks that `pair`'s own `{first, second}`
    // assignment is the CANONICAL one `makePairId` would produce. Without this check, a corrupted or
    // forged set could flip one result's `pair.first`/`pair.second`, recompute that result's
    // `resultId` to stay self-consistent with the flipped `pair`, and still validate `{ok: true}` --
    // silently letting one physical clash appear as two distinct results (two different `resultId`s
    // for the same pair, under opposite orientations). Runs unconditionally for every result (no
    // `unit` lookup needed), right after the `result-id-mismatch` check above.
    let expectedPair;
    try { expectedPair = makePairId(r.mode, r.evaluatedAs.source, r.evaluatedAs.target); } catch { expectedPair = null; }
    if (expectedPair === null
        || refKey(expectedPair.first) !== refKey(r.pair.first)
        || refKey(expectedPair.second) !== refKey(r.pair.second)) {
      add(`${path}/pair`, 'pair-orientation-invalid');
    }

    const unit = unitsById.get(r.unitId);
    if (unit === undefined || unit.outcome !== 'evaluated' || unit.scopeProof !== 'equal') {
      add(`${path}/unitId`, 'result-unit-invalid');
    } else {
      if (!coveredBySource(unit, r.evaluatedAs.source, ownerIndex, unreachableOwner)
          || !coveredByTarget(unit, r.evaluatedAs.target, ownerIndex, unreachableOwner)) {
        add(`${path}/evaluatedAs`, 'result-unit-coverage');
      }
      if (r.evaluatedAs.source.modelKey !== unit.sourceModelKey || !sameRefSet(r.pair, r.evaluatedAs)) {
        add(`${path}/evaluatedAs`, 'evaluated-as-mismatch');
      }
    }

    if (definitionMode !== null && r.mode !== definitionMode) add(`${path}/mode`, 'mode-mismatch');
  }

  for (const modelKey of mentioned) {
    if (!provenanceModelKeys.has(modelKey)) add('/provenance/models', 'model-not-in-provenance');
  }
}

/** Canonical order (§11.3): `results` must be strictly ascending by `PairId`. A duplicate
 *  `resultId` is already caught structurally (`ResultSet.results`'s own `uniqueBy`); an adjacent
 *  equal-or-descending pair here is `result-order`. */
function checkOrderAndUniqueness(set, add) {
  const { results } = set;
  for (let i = 1; i < results.length; i += 1) {
    if (comparePairIds(results[i - 1].pair, results[i].pair) >= 0) {
      add(`/results/${i}`, 'result-order');
    }
  }
}

/** Recomputed digests must match the recorded ones — UNLESS `digestVersion` is one this reader
 *  does not know, in which case §13.6 makes the set valid-but-unverifiable and this comparison is
 *  skipped entirely (never reported as a mismatch; the CLAIM predicate is what refuses it). */
function checkDigests(set, add) {
  if (set.digests.digestVersion !== DIGEST_VERSION) return;
  const expectedPairSet = digestCanonical(pairSetDigestInput(set.results));
  if (set.digests.pairSetDigest !== expectedPairSet) add('/digests/pairSetDigest', 'digest-mismatch');
  const expectedLedger = digestCanonical(ledgerDigestInput(set.ledger, set.provenance.runOptions));
  if (set.digests.ledgerDigest !== expectedLedger) add('/digests/ledgerDigest', 'digest-mismatch');
}

/**
 * The sliceable validation pipeline. The structural phase (review Critical 3) runs FIRST and in
 * full, establishing the shape every later phase assumes. An earlier draft SKIPPED every later
 * phase outright whenever any structural issue existed, which is simple but wrong: it would also
 * silently drop a genuinely INDEPENDENT cross-field finding on an otherwise well-shaped part of the
 * same set (codex-advisor finding, 2026-09-22 — a real, reachable case, not a hypothetical one: the
 * generated structural-schema suite's `mode` mutation on `ClashResult` produces BOTH a structural
 * `unknown-field-closed-type` on the now-mismatched `evidence` shape AND the independent cross-field
 * `mode-mismatch`, and only the second is meaningful to a caller trying to understand what is wrong
 * with `definition.mode` vs. `result.mode`). Each later phase therefore always RUNS, but is called
 * DEFENSIVELY (`guarded`, below): an exception it raises while traversing a shape the structural
 * phase already flagged is swallowed (that structural issue already makes `ok: false`; a phase that
 * cannot safely proceed given that shape has nothing more useful to add) but never propagates as an
 * uncaught throw — a validator that can throw on untrusted-shaped-but-captured input is itself a
 * defect this boundary exists to prevent (e.g. a mutation as simple as `ledger.units = null` would
 * otherwise crash `checkCrossField`'s own `ledger.units.filter(...)`).
 */
export function* validateResultSetSteps(set, { limits }) {
  assertCaptured(set);                                  // O(1): root descriptors only
  const issues = [];
  const add = (path, code) => { if (issues.length < MAX_ISSUES) issues.push({ path, code }); };

  yield; checkShapeAndUnknownFields(set, add, limits);
  const guarded = (fn) => { try { fn(set, add); } catch { /* the structural phase already covers it */ } };
  yield; guarded(checkCrossField);
  yield; guarded(checkResultLinkage);
  yield; guarded(checkOrderAndUniqueness);
  yield; guarded(checkDigests);
  return { ok: issues.length === 0, issues };
}

export function validateResultSet(set, options) {
  const it = validateResultSetSteps(set, options);
  let step = it.next();
  while (!step.done) step = it.next();
  return step.value;
}

/**
 * Capture -> version -> migrate -> re-validate -> freeze (§13.6). `runId` is the caller's
 * diagnostic id, never read off `raw`. Everything below is a rejected promise because this
 * function is async, but the capture/migrate/recapture step below is entirely synchronous, before
 * the first `await` (§13.6 R19-1).
 *
 * Ruling B (carried forward from Task P5.4's report and progress.md, "P5.5 must recapture
 * migration output before re-validation"): `applyMigration` only shape-checks its OWN return
 * value's TOP-LEVEL `schemaVersion` (by design — see its doc comment). A migration function's
 * return value is untrusted output like any other: a hostile accessor NESTED below the top level
 * would not be caught by `applyMigration`'s own check, nor by `validateResultSetSteps`'s
 * `assertCaptured` precondition (which only inspects the ROOT's own property descriptors, exactly
 * enough to make the O(1) "is this a captured copy" check cheap — it was never meant to recursively
 * prove every nested value is accessor-free). So `migrated` is run back through
 * `captureResultSet` — the SAME detached, descriptor-based, getter-safe capture used for the
 * initial raw read — before the structural walk ever touches it. `migrations` is DELIBERATELY
 * omitted from this second call: migration is single-hop (`applyMigration`'s own contract already
 * requires `migrated.schemaVersion === SCHEMA_VERSION` exactly), so the recapture's own schema-
 * version gate must accept ONLY the current version, never re-admit another older, migratable one
 * — omitting `migrations` here is what enforces that (`captureResultSet`'s default `NO_MIGRATIONS`
 * makes `migratableFrom` always false, so `v === SCHEMA_VERSION` is the only admissible value).
 * This also means a migration's return value is fully re-subjected to every OTHER capture-time
 * bound (node/array/string ceilings, the unknown-field byte budget, depth) a second time — the
 * cost of "capture twice on the rare migrated-read path" the ruling accepts as cheaper and more
 * correct than a permanent deferral record. Currently unreachable in practice (`SCHEMA_VERSION` is
 * 1, so `[1, SCHEMA_VERSION)` is empty and no real migration exists to exploit this today), but
 * built correctly now per R21-2, before the day a real migration is registered.
 */
export async function readResultSet(raw, { limits, migrations = NO_MIGRATIONS, slicer, runId = null }) {
  const captured = captureResultSet(raw, { limits, runId, migrations });
  const migrated = captured.schemaVersion === SCHEMA_VERSION
    ? captured
    : captureResultSet(applyMigration(captured, migrations, { runId }), { limits, runId });
  const it = validateResultSetSteps(migrated, { limits });
  let step = it.next();
  while (!step.done) {
    const p = slicer.tick('validate');                   // P0's yield point: undefined unless due
    if (p !== undefined) await p;
    step = it.next();
  }
  if (!step.value.ok) throw corrupt(runId, step.value.issues);
  await deepFreezeSliced(migrated, slicer);              // P0's helper; the slicer object itself
  return migrated;
}
