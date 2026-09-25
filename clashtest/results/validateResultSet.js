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
import { canonicalJson, Sha256, DIGEST_PREFIX, DIGEST_VERSION } from '../util/canonical.js';
import { computeSemanticDigest, normalizeDefinition } from '../definition/normalize.js';
import { makeResultId, makePairId, comparePairIds, pairSemanticsOf } from '../identity/ids.js';
import { isOpenPath, UNKNOWN_FIELD_BYTES, TYPES, EVIDENCE_BY_MODE, checkShapeAndUnknownFieldsSteps } from './resultSetSchema.js';
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
//
// Owner-authorized P5-REM5 remediation (item 4; P5-REM3's codex-review, "capture-time array
// ceilings cover only 5 paths"; owner ruling 2026-09-23: "Replace the generic fallback behavior
// wherever a stricter schema ceiling is defined. Capture-time validation must fail closed against
// each path's actual governing schema ceiling, consistent with frozen spec §13.6"). This map used to
// be 5 hand-listed entries, so every OTHER schema-declared array (e.g. `environmentSensitiveCauses`,
// max 3; `ledger.units[].targets`, max 64; every `point3`, exactly 3) was checked during capture
// only against the generic 20,000,000 fallback and copied in full before the structural phase ever
// rejected it -- not §13.6's "every array's length against its schema ceiling ... at the moment it
// is reached". It is now DERIVED at module load from `resultSetSchema.js`'s `TYPES` table itself --
// the one schema of record -- so capture and the structural phase cannot drift (design-checked with
// codex-advisor, 2026-09-23; derivation preferred over hand-extension for exactly that reason). The
// 5 old entries are reproduced unchanged, because each one's schema row declares the identical
// value (`/ledger/units/#/taints` now reads `MAX_UNIT_TAINTS` through its schema row, the controller
// taints[] ruling's single source; asserted in validateResultSet.arrayCeilings.test.mjs). Rules:
//  - every `arr()` row MUST declare `max` or `exact` (`exact` for `point3`); a row with neither is a
//    module-load error, never silently the fallback;
//  - `ClashResult.evidence` is `free()` with a per-mode `custom` shape: the union of every mode's
//    evidence type is walked, keeping the LARGEST ceiling if two variants ever share a path (a smaller
//    one could reject a valid mode before the structural phase can discriminate it);
//  - the delegated `definition` gets P2's two array paths (`definition/validate.js` ENTRIES_PATH /
//    DBIDS_PATH) at their HARD `ENGINE_LIMIT_CEILINGS` values -- never the reader's configured limits,
//    per the §13.6 rule above;
//  - a pointer where the schema declares no array (a free-form field -- `statistics`, `runOptions`,
//    `countsByReason` rows -- an open-type unknown field, or a wrong-container value under a closed
//    type) keeps `DEFAULT_ARRAY_CEILING`: no schema ceiling exists there (the node budget and, for
//    unknown fields, the 64 KiB byte budget still bound it), and a wrong container stays the
//    structural phase's `container-invalid`/`unknown-field-closed-type` finding;
//  - `pointerShape` folds every all-digit segment to `#`, so a schema field name must never be all
//    digits (asserted at load) -- otherwise an object key and an array index could collide.
const DEFAULT_ARRAY_CEILING = RUN_OPTION_CEILINGS.maxLedgerRecords;
function deriveArrayCeilings() {
  const ceilings = new Map();
  const put = (shape, ceiling) => {
    if (!Number.isSafeInteger(ceiling) || ceiling < 0) {
      throw new Error(`validateResultSet: schema array ${shape} declares no usable ceiling`);
    }
    ceilings.set(shape, Math.max(ceilings.get(shape) ?? 0, ceiling));
  };
  const visitType = (typeName, shape, active) => {
    if (active.has(typeName)) throw new Error(`validateResultSet: recursive schema type ${typeName}`);
    const def = TYPES.get(typeName);
    const next = new Set(active).add(typeName);
    for (const [field, spec] of Object.entries(def.fields)) {
      if (/^\d+$/.test(field)) throw new Error(`validateResultSet: all-digit schema field ${typeName}.${field}`);
      visitSpec(spec, `${shape}/${field}`, next);
    }
    if (def.custom === 'evidenceByMode') {
      for (const evidenceType of new Set(Object.values(EVIDENCE_BY_MODE))) visitType(evidenceType, `${shape}/evidence`, next);
    }
  };
  const visitSpec = (spec, shape, active) => {
    const s = typeof spec === 'string' ? { kind: 'object', of: spec } : spec;
    if (s.kind === 'array') {
      put(shape, s.exact ?? s.max);
      visitSpec(s.of, `${shape}/#`, active);
    } else if (s.kind === 'object' && s.free !== true && s.delegated !== true) {
      visitType(s.of, shape, active);
    }
  };
  visitType('ResultSet', '', new Set());
  for (const side of ['selectionA', 'selectionB']) {
    put(`/definition/${side}/entries`, ENGINE_LIMIT_CEILINGS.maxEntriesPerSelection);
    put(`/definition/${side}/entries/#/dbIds`, ENGINE_LIMIT_CEILINGS.maxExplicitElementsPerSelection);
  }
  return ceilings;
}
const ARRAY_CEILINGS = deriveArrayCeilings();
const pointerShape = (pointer) => pointer.replace(/\/\d+(?=\/|$)/g, '/#');
/** The capture-time array ceiling for one concrete JSON pointer (exported for the exhaustive
 *  schema-parity test only; `captureResultSet` is its one production caller). */
export const arrayLimitFor = (pointer) => ARRAY_CEILINGS.get(pointerShape(pointer)) ?? DEFAULT_ARRAY_CEILING;

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
// P5-REM5 item 5: the per-phase step labels `validateResultSetSteps` yields (one per item of every
// size-dependent loop); `readResultSet` hands each to P0's `slicer.tick(label)`.
const CROSS_STEP = 'validate:cross-field';
const LINKAGE_STEP = 'validate:linkage';
const ORDER_STEP = 'validate:order';
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
// P5-REM5 item 5: formerly `const leavesOf = (ledger) => ledger.units.filter((u) => u.outcome !==
// 'split')`, applied as one synchronous filter; the IDENTICAL predicate is now applied unit by unit
// inside `checkCrossFieldSteps` so the pass can yield (the comments below that say `leavesOf` mean
// exactly this predicate, which is deliberately unchanged -- Finding A did not alter it).
const isLeaf = (u) => u.outcome !== 'split';

/** Global, non-per-result cross-field rules: definition/testRef null-parity, identity and semantic-
 *  digest reconciliation (H1) plus the full pre-resolution shape (H2), the bidirectional
 *  `coverage: 'full'` predicate (M1, mirroring `deriveRunOutcome` exactly), `status: 'completed'` vs.
 *  a fatal/planning-gap cause, and the ledger's own pair-space arithmetic. None of these need a
 *  per-result scan. */
function* checkCrossFieldSteps(set, add) {
  const { definition, testRef, outcome, ledger, diagnostics, results } = set;

  // Owner-authorized P5-REM2 remediation (independent review docs/reviews/2026-09-22-federated-
  // clash-test-core-p5-independent-review.md, H1 and H2; adjudication docs/reviews/2026-09-22-
  // federated-clash-test-core-p5-independent-review-adjudication.md, both CONFIRMED/blocking; owner
  // ruling 2026-09-22, verbatim in .superpowers/sdd/p5-result-set/task-P5-REM2-brief.md). Before
  // this fix the ONLY check tying `definition` to `testRef` was null-parity -- nothing checked that a
  // non-null `definition`'s own `testId`/`revision` matched `testRef`, that `testRef.semanticDigest`
  // was actually the semantic digest of the embedded `definition` (H1), or that a null `definition`
  // carried the REST of design spec §13.1's unique pre-resolution shape rather than an arbitrary
  // post-resolution one (H2). Both were reproduced directly by the independent review: mutating only
  // `definition.mode`/`testId`/`revision` (H1), or nulling `definition`/`testRef.revision`/
  // `testRef.semanticDigest` while leaving `status: 'completed'`/`coverage: 'full'`/a positive pair
  // space/an evaluated unit untouched (H2), both validated `{ok: true, issues: []}` and both let
  // `canClaimNoClashes` return `true` -- a tampered or contradictory Result Set supporting a false
  // clean no-clash claim.
  if (definition === null) {
    if (testRef.semanticDigest !== null) add('/definition', 'definition-digest-mismatch');
    // H2: design spec §13.1 "Pre-resolution seal (R11-4)" names EXACTLY one shape for a run sealed
    // before its definition was resolved -- `testRef.revision: null` (the third field of the same
    // null-parity triad as `semanticDigest`, checked above), a `failed`/`cancelled` terminal status
    // (never `completed`/`invalidated`), `coverage: 'partial'`, no plan, no unit ledger, exactly one
    // planning gap, zero pair space, and zero results. Each sub-condition is its own `add()` call at
    // the specific path that is wrong, all under one `pre-resolution-shape-invalid` code (matching
    // this file's existing one-code-many-paths convention, e.g. `pair-space-inconsistent`).
    if (testRef.revision !== null) add('/testRef/revision', 'pre-resolution-shape-invalid');
    if (outcome.status !== 'failed' && outcome.status !== 'cancelled') {
      add('/outcome/status', 'pre-resolution-shape-invalid');
    }
    if (outcome.coverage !== 'partial') add('/outcome/coverage', 'pre-resolution-shape-invalid');
    if (ledger.planExists !== false) add('/ledger/planExists', 'pre-resolution-shape-invalid');
    if (ledger.units.length !== 0) add('/ledger/units', 'pre-resolution-shape-invalid');
    if (ledger.planningGaps.length !== 1) add('/ledger/planningGaps', 'pre-resolution-shape-invalid');
    if (ledger.pairSpaceTotal !== 0) add('/ledger/pairSpaceTotal', 'pre-resolution-shape-invalid');
    if (results.length !== 0) add('/results', 'pre-resolution-shape-invalid');
  } else {
    // H1: `definition`'s own identity must agree with `testRef` (one code covers both fields, matching
    // this file's existing pattern of one code per logical rule).
    if (definition.testId !== testRef.testId || definition.revision !== testRef.revision) {
      add('/definition', 'definition-identity-mismatch');
    }
    // `computeSemanticDigest` (definition/normalize.js) is the SAME pure function P2 uses to produce
    // `semanticDigest` in the first place -- reused here, never reimplemented. A malformed embedded
    // `definition` must not crash the validator (structural phase already ran first; this is a
    // backstop inside `guarded(...)`), so a throw is treated as "cannot possibly match", following
    // this file's existing `makeResultId`/`makePairId` try/catch precedent.
    let expectedSemanticDigest;
    try { expectedSemanticDigest = computeSemanticDigest(definition); } catch { expectedSemanticDigest = null; }
    if (expectedSemanticDigest === null || expectedSemanticDigest !== testRef.semanticDigest) {
      add('/testRef/semanticDigest', 'semantic-digest-mismatch');
    }

    // Owner-authorized P5-REM3 remediation (owner disposition item 1 of the P5-REM2 follow-up
    // findings surfaced by that task's own `codex-review` pass; adjudication docs/reviews/2026-09-22-
    // federated-clash-test-core-p5-independent-review-adjudication.md, "Remediation result" section;
    // owner ruling 2026-09-22, verbatim in .superpowers/sdd/p5-result-set/task-P5-REM3-brief.md:
    // "Enforce the existing canonical/normalized definition invariant at the persisted Result Set
    // validation boundary so a tampered-but-self-consistent non-normalized definition cannot mint a
    // distinct semantic identity for the same logical definition"). The `semantic-digest-mismatch`
    // check just above only proves SELF-CONSISTENCY -- that the recorded digest matches hashing the
    // embedded `definition` -- never that `definition.selectionA`/`selectionB` is itself in
    // NORMALIZED/canonical form (design spec §5.4: `semanticDigest` is defined as the digest of the
    // CANONICAL form, and "two revisions with equal semanticDigest ask the same question" assumes
    // normalization actually ran). A definition with, say, a duplicated `dbIds` entry, or two
    // separate `selectionA.entries` rows for the same `modelKey` that a real normalization pass would
    // merge into one, can still self-consistently digest to its OWN (different) `semanticDigest`,
    // minting a distinct semantic identity for what is logically the same selection.
    //
    // The check: a genuinely canonical `definition` is a FIXED POINT of `normalizeDefinition` (the
    // SAME pure function P2 applies when a definition is first prepared -- reused here, never
    // reimplemented) -- normalizing it again must reproduce it exactly. Compared via `canonicalJson`
    // (key-order-insensitive by construction), NEVER `JSON.stringify` -- this session's own
    // P5-REM2/M2 fix just corrected a plan erratum caused by exactly that mistake (a key-order-
    // sensitive `JSON.stringify` comparison breaking after a canonical-JSON store round-trip reorders
    // keys). Narrowly scoped to validation/canonical identity, per the owner's explicit "do not
    // change claim semantics": `claim.js`'s `assessNoClashClaim`/`canClaimNoClashes` never read
    // `resultSet.definition` at all, so this gap cannot by itself produce a false no-clash claim --
    // confirmed by the prior task's own review and not re-litigated here. Wrapped in the same local
    // try/catch precedent as the `computeSemanticDigest` call above: a malformed embedded `definition`
    // must not crash the validator (the structural phase already ran first, and this sits inside the
    // existing `guarded(...)` backstop too).
    //
    // Performance note (transparency, not a new decision): this adds one more synchronous, unsliced
    // computation to `checkCrossField` -- a second full re-run of `normalizeDefinition`'s generator
    // via `runSync`, on the same call path already flagged and deferred to the G-CAL calibration gate
    // by the owner's disposition of P5-REM2 follow-up item 3 (the `computeSemanticDigest` span
    // above). This is not a new problem: it is that same already-acknowledged one growing slightly,
    // and it falls under item 3's own disposition ("must be resolved before any applicable frame-
    // budget/responsiveness claim is closed"), not a new gate.
    let renormalized;
    try { renormalized = normalizeDefinition(definition); } catch { renormalized = null; }
    if (renormalized === null || canonicalJson(renormalized) !== canonicalJson(definition)) {
      add('/definition', 'definition-not-normalized');
    }
  }

  // Owner-authorized P5-REM4 remediation (item 1; codex-review finding, .superpowers/sdd/
  // p5-result-set/task-P5-REM3-report.md, "UnitTarget.rootDbIds not validated against scope,
  // enabling a false coverage:'full' via an empty-range unit"; owner ruling 2026-09-23: "fix in P5
  // now. Validation must fail closed when persisted unit targets cannot support the claimed
  // scope/coverage. A malformed or empty-range unit must not permit a false coverage:'full'
  // result"). Neither this file's own `derivedFull` (below, computed purely from `outcome`/
  // `scopeProof`) nor `resultSetSchema.js`'s structural `UnitTarget` row (`rootDbIds` is `optional`
  // regardless of `scope`, and its `ids()` array type has no minimum length) ever checked that a
  // unit's declared source/target range can actually support what it claims to have evaluated. The
  // writer's own construction (`planning/ledger.js`'s `normalizeUnitFields`) already rejects
  // `rootDbIds` on a `scope: 'model'` target, and `planning/sizing.js`'s `packSource`/`unit.targets`
  // packing never emits an empty root range for a genuine planned unit -- but nothing re-verifies
  // either rule at the untrusted read boundary, so a corrupted or forged unit record could declare
  // an empty-range target (or an empty `sourceRootDbIds`, or zero targets at all) while still being
  // marked `outcome: 'evaluated'`/`scopeProof: 'equal'`, letting it count toward `derivedFull`
  // below despite representing zero actual coverage. Checked unconditionally over EVERY persisted
  // unit (not only leaves the coverage predicate counts): this is a structural range-self-
  // consistency defect independent of outcome, and design-sanity-checked (codex-advisor, 2026-09-23)
  // against `planning/sizing.js`'s real planner paths, which never legitimately produce an
  // empty-range unit of any outcome. One shared code covers all four sub-conditions, matching this
  // file's own established "one code, many `add()` calls" convention (e.g. `pre-resolution-shape-
  // invalid`, `pair-space-inconsistent`).
  for (let i = 0; i < ledger.units.length; i += 1) {
    const u = ledger.units[i];
    const unitPath = `/ledger/units/${i}`;
    if (u.sourceRootDbIds.length === 0) add(`${unitPath}/sourceRootDbIds`, 'unit-range-invalid');
    if (u.targets.length === 0) add(`${unitPath}/targets`, 'unit-range-invalid');
    for (let j = 0; j < u.targets.length; j += 1) {
      const t = u.targets[j];
      const targetPath = `${unitPath}/targets/${j}/rootDbIds`;
      if (t.scope === 'roots' && (t.rootDbIds === undefined || t.rootDbIds.length === 0)) {
        add(targetPath, 'unit-range-invalid');
      } else if (t.scope === 'model' && t.rootDbIds !== undefined) {
        add(targetPath, 'unit-range-invalid');
      }
      yield CROSS_STEP;
    }
    yield CROSS_STEP;
  }

  // Owner-authorized P5-REM5 remediation (Finding A; P5-REM4's own codex-review, .superpowers/sdd/
  // p5-result-set/task-P5-REM4-report.md, "zero-result forged-kind bypass"; owner ruling 2026-09-23:
  // "Validation must reject an outcome:'evaluated' unit that is not kind:'leaf' even when no result
  // row links to it. The invariant applies to the evaluated leaf set itself, not only result-linked
  // units"). REM4's `result-unit-not-leaf` (checkResultLinkage) only runs per RESULT, so a zero-
  // result set never reaches it, while `leavesOf` below classifies a leaf by `outcome !== 'split'`
  // alone -- a forged `kind: 'split'` / `outcome: 'evaluated'` unit still counted toward
  // `derivedFull`. The writer (`planning/ledger.js` `recordOutcome`) only ever settles `evaluated` on
  // a `kind: 'leaf'` record. Checked here over EVERY unit, unconditionally; `leavesOf` and the M1
  // coverage predicate are deliberately UNCHANGED (a validation-boundary check, not a change to what
  // counts as coverage -- the same narrow scoping REM4 used). A NEW code rather than a reuse of
  // `result-unit-not-leaf`: that code (and its `/results/{i}/unitId` path) means "a result links a
  // non-leaf unit"; this is a unit-level self-inconsistency reported at the unit's own `kind`, and it
  // fires whether or not any result exists. Only the owner-named direction is enforced; the reverse
  // half of the writer's biconditional (`kind: 'leaf'` with `outcome: 'split'`) is recorded for owner
  // disposition in .superpowers/sdd/p5-result-set/task-P5-REM5-report.md, not enforced here.
  for (let i = 0; i < ledger.units.length; i += 1) {
    const u = ledger.units[i];
    if (u.outcome === 'evaluated' && u.kind !== 'leaf') add(`/ledger/units/${i}/kind`, 'evaluated-unit-not-leaf');
    yield CROSS_STEP;
  }

  // Owner-authorized P5-REM6 remediation (Finding C; P5-REM5's own codex-review, .superpowers/sdd/
  // p5-result-set/task-P5-REM5-report.md, "reverse kind/outcome direction"; owner ruling 2026-09-23:
  // "Enforce the persisted unit topology invariant in both directions. A unit with outcome:'split'
  // must have the required split-kind representation; malformed leaf/split combinations must fail
  // closed regardless of whether coverage derivation happens to observe them"). The writer
  // (`planning/ledger.js`) guarantees `kind === 'split' <=> outcome === 'split'`: `tryRecordSplit`
  // sets both together, `recordOutcome` admits only `SETTLED_OUTCOMES` (which exclude 'split') on a
  // leaf and keeps a split parent's outcome at 'split'. `isLeaf` classifies by `outcome` alone, so a
  // `kind: 'leaf'` / `outcome: 'split'` unit silently left the leaf set (its weight dropping out of
  // coverage and pair space), and a `kind: 'split'` unit with a settled outcome counted as a leaf.
  // The full biconditional is checked here over EVERY unit; the one overlapping combination
  // (`kind: 'split'` / `outcome: 'evaluated'`) stays reported ONLY by Finding A's unchanged
  // `evaluated-unit-not-leaf` above, so one defect yields one code (design-checked with
  // codex-advisor, 2026-09-23). `kind` is a closed `'leaf' | 'split'` enum structurally, so every
  // other mismatch is exactly this code, reported at the unit's `outcome`. `isLeaf` and the M1
  // coverage predicate stay UNCHANGED (validation boundary only, as for Finding A).
  for (let i = 0; i < ledger.units.length; i += 1) {
    const u = ledger.units[i];
    const alreadyReported = u.outcome === 'evaluated' && u.kind !== 'leaf';
    if (!alreadyReported && (u.kind === 'split') !== (u.outcome === 'split')) {
      add(`/ledger/units/${i}/outcome`, 'unit-kind-outcome-mismatch');
    }
    yield CROSS_STEP;
  }

  // Owner-authorized P5-REM6 remediation (Finding D; same codex-review, "split-parent topology
  // unvalidated"; owner ruling 2026-09-23: "A persisted split unit must reference a valid non-empty
  // child structure according to the existing execution/result-set contract. Childless or
  // structurally invalid split units must fail validation"). The existing contract, NOT a new
  // representation: a persisted `UnitRecord` has no children field (`ledger.js` `UNIT_RECORD_KEYS`;
  // its `children` list is private bookkeeping never projected), so a split's children are exactly
  // the units whose `parentUnitId` names it. `tryRecordSplit` -- the ONLY writer of a non-null
  // `parentUnitId` (`recordUnit`/`newLeaf` reject one) -- admits EXACTLY two children with the ids
  // `${unitId}.0` and `${unitId}.1` whose `pairSpaceWeight`s partition the parent's exactly, turning
  // the parent `kind`/`outcome` 'split' in the same step (frozen spec §6.4: "children: [`${unitId}.0`,
  // `${unitId}.1`] ... the children's weights sum to the parent's"). Checked in BOTH directions
  // (codex-advisor design consult, 2026-09-23 -- the recorded finding names "a child's parentUnitId
  // resolves to an actual split parent" too), under ONE code for the one topology invariant, one
  // `add()` per offending unit:
  //  - parent side, at `/ledger/units/{i}`: every split-marked unit (`kind` OR `outcome` 'split' --
  //    the union, so this holds independently of the Finding C check above) has exactly the two
  //    children `${id}.0`/`${id}.1` and their weights sum to its own;
  //  - child side, at `/ledger/units/{i}/parentUnitId`: every non-null `parentUnitId` resolves to a
  //    split-marked unit and the child's own id is `${parentUnitId}.0` or `.1`. (The suffix rule
  //    also makes a parent cycle impossible: a child id is strictly longer than its parent's.)
  // Deliberately NOT checked (outside this finding): the pre-order placement of units (a projection
  // convention of `toLedgerRecord`, not topology) and whether the children's source/target ranges
  // partition the parent's (a separate semantic-partition rule, recorded for the owner in
  // .superpowers/sdd/p5-result-set/task-P5-REM6-report.md). A non-string id (already a structural
  // finding) is guarded so it can never abort the rest of this phase.
  {
    const isSplitMarked = (u) => u.kind === 'split' || u.outcome === 'split';
    const unitById = new Map();
    const childrenOf = new Map();                       // parentUnitId -> [child unit, ...]
    for (const u of ledger.units) {
      unitById.set(u.unitId, u);
      if (u.parentUnitId !== null) {
        let list = childrenOf.get(u.parentUnitId);
        if (list === undefined) { list = []; childrenOf.set(u.parentUnitId, list); }
        list.push(u);
      }
      yield CROSS_STEP;
    }
    for (let i = 0; i < ledger.units.length; i += 1) {
      const u = ledger.units[i];
      if (isSplitMarked(u)) {
        // Length first, so a forged parent with a huge child list is never scanned in one span.
        const kids = childrenOf.get(u.unitId) ?? [];
        const partitioned = kids.length === 2 && typeof u.unitId === 'string'
          && new Set([kids[0].unitId, kids[1].unitId]).size === 2
          && [kids[0].unitId, kids[1].unitId].every((id) => id === `${u.unitId}.0` || id === `${u.unitId}.1`)
          && kids[0].pairSpaceWeight + kids[1].pairSpaceWeight === u.pairSpaceWeight;
        if (!partitioned) add(`/ledger/units/${i}`, 'split-topology-invalid');
      }
      if (u.parentUnitId !== null) {
        const parent = unitById.get(u.parentUnitId);
        const validChild = parent !== undefined && isSplitMarked(parent)
          && typeof u.parentUnitId === 'string'
          && (u.unitId === `${u.parentUnitId}.0` || u.unitId === `${u.parentUnitId}.1`);
        if (!validChild) add(`/ledger/units/${i}/parentUnitId`, 'split-topology-invalid');
      }
      yield CROSS_STEP;
    }
  }

  // Owner-authorized P5-REM5 remediation (Finding B; same codex-review, "unowned root ID bypass";
  // owner ruling 2026-09-23: "Cross-validate unit target root IDs against ledger.rootOwners so
  // unowned or inconsistent roots cannot contribute to a valid coverage/full clean claim"). REM4's
  // `unit-range-invalid` only proves a range is non-empty and shaped for its `scope`; nothing tied
  // the root IDs themselves to the plan's own root table. The real planner builds `rootOwners` from
  // every resolved model's roots (`planner.js` `rootOwnerRowsOfSliced`) and expands every unit's
  // roots from those same plan tables (`sizing.js`), so every explicit unit root is a `rootDbId` in
  // the `rootOwners` group of the SAME model. "Traceable" is exactly that (design-checked with
  // codex-advisor, 2026-09-23): each `sourceRootDbIds` id must be a `rootDbId` under the group whose
  // `modelKey === unit.sourceModelKey`, and each `scope: 'roots'` target id a `rootDbId` under the
  // group for `target.modelKey`. `ownerDbIds` and `cls` are NOT consulted (orientation can flip and
  // class-C roots are shared, so role/class is not a sound per-unit constraint), and a `scope:
  // 'model'` target carries no root IDs, so it is not checked. A separate `modelKey -> Set<rootDbId>`
  // index is built here: `buildOwnerIndex` (below) maps ownerDbId -> rootDbId and cannot answer this.
  // P5-REM7: this is the ONE rootOwners index, `modelKey -> Map<rootDbId, {cls, asSource, asTarget}>`
  // -- Finding B's ownership test reads its keys; the F/G coverage reconciliation
  // (`reconcileEvaluatedCoverageSteps`, below) reads each owned root's class from it and records that
  // root's evaluated coverage in the same record. (Formerly `Map<modelKey, Set<rootDbId>>`; widened,
  // not duplicated, so the two checks can never disagree about which roots a model owns.)
  const rootsByModel = new Map();
  const mayProvePairs = outcome?.coverage === 'full' && ledger.planExists === true;  // necessary, never throws
  for (const row of ledger.rootOwners) {
    let roots = rootsByModel.get(row.modelKey);
    if (roots === undefined) { roots = new Map(); rootsByModel.set(row.modelKey, roots); }
    // `rank` (P5-REM9's canonical rank, assigned only by `provePairExactCoverSteps`) is declared here,
    // unset, so assigning it later reuses an in-object slot instead of growing every record by a
    // property backing store (P5-REM10: measured ~40 B -> ~8 B of JS heap per owned root) -- only
    // when that proof can run at all (its gate needs a recorded 'full' and a plan), so a partial or
    // plan-less set pays nothing for it.
    for (const owner of row.owners) {
      roots.set(owner.rootDbId, mayProvePairs ? { cls: owner.cls, asSource: 0, asTarget: 0, rank: undefined }
        : { cls: owner.cls, asSource: 0, asTarget: 0 });
      yield CROSS_STEP;
    }
    yield CROSS_STEP;
  }
  const rootOwned = (modelKey, rootDbId) => rootsByModel.get(modelKey)?.has(rootDbId) === true;
  for (let i = 0; i < ledger.units.length; i += 1) {
    const u = ledger.units[i];
    for (let k = 0; k < u.sourceRootDbIds.length; k += 1) {
      if (!rootOwned(u.sourceModelKey, u.sourceRootDbIds[k])) add(`/ledger/units/${i}/sourceRootDbIds/${k}`, 'unit-root-not-owned');
      yield CROSS_STEP;
    }
    for (let j = 0; j < u.targets.length; j += 1) {
      const t = u.targets[j];
      if (t.scope !== 'roots' || t.rootDbIds === undefined) continue;
      for (let k = 0; k < t.rootDbIds.length; k += 1) {
        if (!rootOwned(t.modelKey, t.rootDbIds[k])) add(`/ledger/units/${i}/targets/${j}/rootDbIds/${k}`, 'unit-root-not-owned');
        yield CROSS_STEP;
      }
    }
    yield CROSS_STEP;
  }

  // `leavesOf` applied item by item (P5-REM5 item 5 slicing), with the SAME `isLeaf` predicate, and
  // `leaves.every(...)` likewise -- identical results, one step per unit.
  const leaves = [];
  for (const u of ledger.units) { if (isLeaf(u)) leaves.push(u); yield CROSS_STEP; }
  let allLeavesEvaluatedEqual = true;
  // P5-REM11 (codex-review finding on the countsByReason fix above, same narrow bug class): `break`
  // must not skip the triggering item's own `yield` either -- yield for the item BEFORE deciding
  // whether to stop, so this loop truly yields "one step per unit" (the comment above it) up to and
  // including the unit that ends the scan, not only for units strictly before it.
  for (const u of leaves) {
    if (!(u.outcome === 'evaluated' && u.scopeProof === 'equal')) allLeavesEvaluatedEqual = false;
    yield CROSS_STEP;
    if (!allLeavesEvaluatedEqual) break;
  }
  const derivedFull = ledger.planExists === true
    && ledger.planningGaps.length === 0
    && leaves.length > 0
    && allLeavesEvaluatedEqual;
  // M1 (same independent review/adjudication/authorization as H1/H2 above): previously only a false
  // recorded `'full'` was rejected; a false recorded `'partial'` (facts derive `'full'`) validated
  // `{ok: true}` -- fail-safe for a no-clash claim but still a writer/reader self-consistency gap.
  // Exact equality in both directions closes it, reusing the SAME existing code.
  if ((outcome.coverage === 'full') !== derivedFull) add('/outcome/coverage', 'coverage-not-full');

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
  // Owner-authorized P5-REM4 remediation (item 2; codex-review finding, same report as item 1
  // above, "diagnostics-counter accounting invariants ... not cross-checked, enabling a false
  // integrity:'clean'"; owner ruling 2026-09-23: "fix in P5 now. Reconcile the persisted diagnostic
  // counters with the governing diagnostic facts so a tampered Result Set cannot produce a false
  // integrity:'clean' result"). The `integrity-not-derived` check just below trusts
  // `diagnostics.completenessAffectingUpperBound` as ground truth; it never confirms that counter
  // is itself an honest summary of the diagnostics data it claims to describe. `execution/
  // diagnostics.js`'s `createDiagnosticAggregator.snapshot()` -- the ONE writer of this object --
  // enforces two invariants before a Result Set is ever sealed (an internal engine defect throws
  // rather than persisting a violation of either): a "Sigma invariant", Σ countsByReason[].count +
  // omittedReasonOccurrences + unclassifiedOccurrences === total, and completenessAffectingUpperBound
  // === completenessAffectingCount + unclassifiedOccurrences exactly. Re-deriving only those two
  // formulas is NECESSARY but not SUFFICIENT (codex-advisor finding during this task's own design
  // review, 2026-09-23): `completenessAffectingCount` and `completenessAffectingUpperBound` can be
  // zeroed TOGETHER, self-consistently, while the retained `diagnostics[]` array still carries a
  // genuinely `completenessAffecting: true` entry -- both formulas above stay satisfied, yet
  // `integrity-not-derived` would still see a false `'clean'`. A third check closes this: every
  // diagnostic instance the aggregator examines is deduplicated into exactly one retained entry
  // (each carrying its own true `occurrences` count) in lockstep with `completenessAffectingCount`,
  // UNLESS `snapshot()` truncates the retained list to `maxRetainedDiagnostics` -- so the sum of
  // `occurrences` over every retained `completenessAffecting: true` entry must equal
  // `completenessAffectingCount` exactly when `truncated === false`, and can only be <= it when
  // `truncated === true` (truncation can drop completeness-affecting entries, never invent one).
  // `diagnostics.diagnostics[]` rows are the CLOSED, structurally validated `NormalizedDiagnostic`
  // type (resultSetSchema.js), so `d.completenessAffecting`/`d.occurrences` are safe to read
  // directly once the structural phase has run; `countsByReason` rows are declared `free()`
  // (undeclared inner shape) precisely because the real engine shape has no closed row type, so
  // each row's own `count` is validated as a safe non-negative integer here before being summed --
  // a malformed row (including `null`) fails the check without ever being read via `c.count`
  // (never a throw, so this cannot abort the rest of `checkCrossField`, matching the local
  // try/catch precedent used elsewhere in this function for the same reason).
  {
    let countsSum = 0;
    let countsRowsValid = true;
    for (const c of diagnostics.countsByReason) {
      // P5-REM11: `yield CROSS_STEP` unconditionally, exactly once per row, on BOTH branches (the
      // established per-item-yield convention this file uses everywhere else, e.g. the sibling
      // `retainedAffectingSum` loop just below) -- a `continue` here must never skip the checkpoint.
      if (c === null || typeof c !== 'object' || !Number.isSafeInteger(c.count) || c.count < 0) {
        countsRowsValid = false;
      } else {
        countsSum += c.count;
      }
      yield CROSS_STEP;
    }
    const sigmaOk = countsRowsValid
      && countsSum + diagnostics.omittedReasonOccurrences + diagnostics.unclassifiedOccurrences === diagnostics.total;
    if (!sigmaOk) add('/diagnostics/total', 'diagnostics-counts-inconsistent');

    if (diagnostics.completenessAffectingUpperBound
        !== diagnostics.completenessAffectingCount + diagnostics.unclassifiedOccurrences) {
      add('/diagnostics/completenessAffectingUpperBound', 'diagnostics-counts-inconsistent');
    }

    let retainedAffectingSum = 0;
    for (const d of diagnostics.diagnostics) {
      if (d.completenessAffecting === true) retainedAffectingSum += d.occurrences;
      yield CROSS_STEP;
    }
    const retainedOk = diagnostics.truncated === true
      ? retainedAffectingSum <= diagnostics.completenessAffectingCount
      : retainedAffectingSum === diagnostics.completenessAffectingCount;
    if (!retainedOk) add('/diagnostics/completenessAffectingCount', 'diagnostics-counts-inconsistent');
  }

  let duplicateConflict = false;
  // P5-REM11 (codex-review finding, same narrow bug class): yield for the triggering result BEFORE
  // breaking, not only for results strictly before it.
  for (const r of results) {
    if (r.flags?.duplicateEvidenceConflict === true) duplicateConflict = true;
    yield CROSS_STEP;
    if (duplicateConflict) break;
  }
  const derivedIntegrity = diagnostics.completenessAffectingUpperBound > 0 || duplicateConflict
    ? 'caveated' : 'clean';
  if (outcome.integrity !== derivedIntegrity) add('/outcome/integrity', 'integrity-not-derived');

  const envCauses = new Set();
  for (const u of leaves) {
    if (u.capacityKind === 'bucket-capacity') envCauses.add('bucket-capacity');
    if (u.outcome === 'failed' && u.cause === 'stale-placement') envCauses.add('placement-contention');
    yield CROSS_STEP;
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

  const isFatalOrGap = (c) => FATAL_CAUSES.has(c) || INPUT_CHANGE_CAUSES.has(c);
  // Same short-circuit order as the former `status === 'completed' && (gaps || units.some(...))`,
  // with each unit and each secondary cause one step.
  if (outcome.status === 'completed') {
    let fatalOrGap = ledger.planningGaps.length > 0;
    for (let i = 0; !fatalOrGap && i < ledger.units.length; i += 1) {
      const u = ledger.units[i];
      if (isFatalOrGap(u.cause)) fatalOrGap = true;
      for (let k = 0; !fatalOrGap && k < u.secondaryCauses.length; k += 1) {
        if (isFatalOrGap(u.secondaryCauses[k])) fatalOrGap = true;
        yield CROSS_STEP;
      }
      yield CROSS_STEP;
    }
    if (fatalOrGap) add('/outcome/status', 'completed-with-fatal-cause');
  }

  if (ledger.emptyOperand === true && ledger.pairSpaceTotal > 0) {
    add('/ledger/pairSpaceTotal', 'pair-space-inconsistent');
  }
  let leafWeightSum = 0;
  for (const u of leaves) { leafWeightSum += u.pairSpaceWeight; yield CROSS_STEP; }
  if (ledger.pairSpaceTotal !== leafWeightSum) add('/ledger/pairSpaceTotal', 'pair-space-inconsistent');

  // P5-REM7 (Findings F + G): LAST in this phase, so a malformed input that makes it throw (every
  // such shape is already a structural finding) can never starve the checks above.
  yield* reconcileEvaluatedCoverageSteps(set, rootsByModel, derivedFull, add);
}

/**
 * Owner-authorized P5-REM7 remediation (Findings F and G, ruled TOGETHER; P5-REM6's own codex-review,
 * refined by independent verification -- docs/reviews/2026-09-23-federated-clash-test-core-p5-
 * remediation-focused-rereview-adjudication.md, "P5-REM6 remediation"; owner ruling 2026-09-23: "Fix
 * together in P5 as one evaluated-coverage reconciliation invariant. Validation must prove that the
 * persisted evaluated domain exactly satisfies the required question derived from the resolved
 * definition ... Implement this as a coherent coverage-reconciliation check, not as two unrelated
 * point fixes"). Before this, nothing tied the embedded `definition`'s question to what the ledger
 * evaluated: a definition could name a phantom (or an extra phantom) model (F), and an evaluated leaf
 * set could simply omit an owned root -- through a split whose children re-evaluate the same range, or
 * through an ordinary leaf with a narrowed range (G) -- and a recorded `coverage: 'full'` still
 * validated and was claimable. ONE mechanism over ONE rootOwners index (Finding B's `rootsByModel`,
 * built once in `checkCrossFieldSteps`), in three steps (design-checked with codex-advisor,
 * 2026-09-23, which also supplied the unit-side role rules and the class-C partner counterexample):
 *
 *  1. THE REQUIRED QUESTION (§6.1), from the resolved definition: `RA`/`RB` = the models the
 *     normalized `selectionA`/`selectionB` name, with each entry's kind. The planner resolves EVERY one
 *     of them and emits exactly one rootOwners row per model, even a rootless one (`rootResolution.js`
 *     `resolveSelectionRoots`; `ledger.js` `rootOwnerRowsOfSteps`), labelling each root A (A only),
 *     B (B only) or C (both) (`rootResolution.js` step 6), and plans units only over those models.
 *       - `coverage-model-mismatch`: the definition's model set and the ledger's disagree -- a
 *         definition model with no rootOwners row (F: a phantom model, or a required model omitted
 *         from the evaluated domain), or a rootOwners row / unit source / unit target naming a model
 *         the definition does not (Finding B skips `scope: 'model'` targets, so this is also what
 *         catches a phantom whole-model target).
 *       - `coverage-root-role-invalid`: a root whose `cls` contradicts the definition (A needs the
 *         model in RA and not named whole by B; B the mirror; C needs both), or a unit that puts a root
 *         in a role §6.3 never gives it: a SOURCE root that is not A/C, an explicit TARGET root that is
 *         not B/C, the same root as both source and target of one unit, or a whole-model target on a
 *         model that is not named whole by B or still holds an A-role root (`decompose.js`
 *         `targetScopeFor`). This is what makes step 3 SOUND: relabelling every B root 'A' would
 *         otherwise empty the B role and make every obligation vacuous. (For an explicit `elements`
 *         selection the A/B/C split itself is enumeration-derived and cannot be re-proven here; only
 *         contradictions with the definition and with §6.3 are.)
 *     These two are structural and are checked whenever a resolved definition and a plan exist.
 *  2. THE EVALUATED DOMAIN: every valid evaluated leaf -- `kind: 'leaf'`, not `split`, `outcome:
 *     'evaluated'`, `scopeProof: 'equal'` (the `derivedFull` predicate's own "evaluated": a failed/
 *     discarded/skipped/not-run leaf covers nothing; a split parent covers nothing itself, its leaves
 *     are simply leaves, Finding D already proves the tree) -- records, on each of its roots, WHICH
 *     root classes it met on the opposite side (`asSource` |= classes of its targets; `asTarget` |=
 *     classes of its sources). A UNION of bits, so duplicated or overlapping ranges add nothing. A
 *     whole-model target is recorded once per model, never fanned out per root.
 *  3. RECONCILE (only when the set records `coverage: 'full'` and its own leaves derive it): every
 *     owned root must have met every partner CLASS it has a required pair with (§6.1: distinct roots,
 *     one in A, one in B), in the position the §6.3 cells give that pair, else `coverage-root-uncovered`
 *     at that root. Unordered modes: an A' root is a source against C and B' (cell 1); a B' root a
 *     target of A' (cell 1) and C (cell 2); a C root a source against B' (cell 2), a target of A'
 *     (cell 1), and -- the canonically-oriented cells 3a/3b -- paired with another C root on either
 *     side. Ordered (`containment`): every A-role root is a source against every B-role class it has a
 *     partner in, and every B-role root a target of every A-role class (3a/3b run both orientations).
 *     §6.4 splits keep every root in its role (they bisect sources, partition target entries, or
 *     bisect an explicit target list), so this holds for split and non-split ledgers alike -- asserted
 *     against real planner/splitter output in validateResultSet.invariants.test.mjs.
 *
 * `derivedFull` and `coverage-not-full` (M1) are UNCHANGED: they still mirror `resultSet.js`'s
 * `deriveRunOutcome` exactly, as that check's own comment requires, and step 3 is a strengthening of
 * what a recorded `'full'` may mean. A `'partial'` set already cannot claim. `claim.js` is unchanged.
 *
 * NOT proven (recorded for the owner, never claimed here): root x partner-class reconciliation is
 * necessary, not sufficient, for §6.1's PAIR-level exact cover -- with every root meeting every
 * partner class, a forged leaf family can still omit an individual cross pair (a1->b1 and a2->b2
 * only). Proving the leaf rectangles cover the pair set exactly needs pairwise disjointness of
 * arbitrary leaf rectangles or a re-run of the planner; neither is an O(ledger) read-time check.
 */
const CLASS_BIT = Object.freeze({ A: 1, B: 2, C: 4 });
function* reconcileEvaluatedCoverageSteps({ definition, outcome, ledger }, rootsByModel, derivedFull, add) {
  if (definition === null || ledger.planExists !== true) return;
  const bitOf = (cls) => (Object.hasOwn(CLASS_BIT, cls) ? CLASS_BIT[cls] : 0);

  // 1a. The required question: RA / RB with each entry's kind (entries are normalized: one per model).
  const kindsA = new Map();
  const kindsB = new Map();
  for (const [side, kinds] of [['selectionA', kindsA], ['selectionB', kindsB]]) {
    for (const entry of definition[side].entries) { kinds.set(entry.modelKey, entry.kind); yield CROSS_STEP; }
  }
  const named = (modelKey) => kindsA.has(modelKey) || kindsB.has(modelKey);
  for (const kinds of [kindsA, kindsB]) {
    for (const modelKey of kinds.keys()) {
      const alreadySeen = kinds === kindsB && kindsA.has(modelKey);
      if (!alreadySeen && !rootsByModel.has(modelKey)) add('/ledger/rootOwners', 'coverage-model-mismatch');
      yield CROSS_STEP;
    }
  }
  // 1b. Every owned root's class against the definition; per-model class presence; global counts.
  const counts = { A: 0, B: 0, C: 0 };
  const classesOfModel = new Map();                      // modelKey -> OR of its roots' class bits
  for (let r = 0; r < ledger.rootOwners.length; r += 1) {
    const row = ledger.rootOwners[r];
    const a = kindsA.get(row.modelKey);
    const b = kindsB.get(row.modelKey);
    if (!named(row.modelKey)) add(`/ledger/rootOwners/${r}/modelKey`, 'coverage-model-mismatch');
    let bits = 0;
    for (let k = 0; k < row.owners.length; k += 1) {
      const { cls } = row.owners[k];
      const consistent = cls === 'A' ? a !== undefined && b !== 'model'
        : cls === 'B' ? b !== undefined && a !== 'model'
          : cls === 'C' && a !== undefined && b !== undefined;
      if (named(row.modelKey) && !consistent) add(`/ledger/rootOwners/${r}/owners/${k}/cls`, 'coverage-root-role-invalid');
      if (Object.hasOwn(counts, cls)) counts[cls] += 1;
      bits |= bitOf(cls);
      yield CROSS_STEP;
    }
    classesOfModel.set(row.modelKey, (classesOfModel.get(row.modelKey) ?? 0) | bits);
    yield CROSS_STEP;
  }
  const A_ROLE = CLASS_BIT.A | CLASS_BIT.C;
  const B_ROLE = CLASS_BIT.B | CLASS_BIT.C;
  const rootRecord = (modelKey, rootDbId) => rootsByModel.get(modelKey)?.get(rootDbId);

  // 1c + 2. Every unit's models and roles (structural, all units); every valid evaluated leaf's
  //         partner classes onto its roots (a union of bits).
  const wholeTargetSources = new Map();                  // modelKey -> OR of source classes that targeted it whole
  for (let i = 0; i < ledger.units.length; i += 1) {
    const u = ledger.units[i];
    const unitPath = `/ledger/units/${i}`;
    if (!named(u.sourceModelKey)) add(`${unitPath}/sourceModelKey`, 'coverage-model-mismatch');
    let sourceBits = 0;
    const sourceIds = new Set();
    for (let k = 0; k < u.sourceRootDbIds.length; k += 1) {
      const id = u.sourceRootDbIds[k];
      sourceIds.add(id);
      const rec = rootRecord(u.sourceModelKey, id);
      if (rec !== undefined) {                           // an unowned root is Finding B's `unit-root-not-owned`
        if ((bitOf(rec.cls) & A_ROLE) === 0) add(`${unitPath}/sourceRootDbIds/${k}`, 'coverage-root-role-invalid');
        sourceBits |= bitOf(rec.cls);
      }
      yield CROSS_STEP;
    }
    let targetBits = 0;
    for (let j = 0; j < u.targets.length; j += 1) {
      const t = u.targets[j];
      const targetPath = `${unitPath}/targets/${j}`;
      if (!named(t.modelKey)) add(`${targetPath}/modelKey`, 'coverage-model-mismatch');
      if (t.scope === 'model') {
        // (An unnamed model is already `coverage-model-mismatch`; its sentinel is not re-reported.)
        if (named(t.modelKey)
            && (kindsB.get(t.modelKey) !== 'model' || ((classesOfModel.get(t.modelKey) ?? 0) & A_ROLE) !== 0)) {
          add(`${targetPath}/scope`, 'coverage-root-role-invalid');
        }
        targetBits |= classesOfModel.get(t.modelKey) ?? 0;
      } else if (Array.isArray(t.rootDbIds)) {
        for (let k = 0; k < t.rootDbIds.length; k += 1) {
          const id = t.rootDbIds[k];
          const rec = rootRecord(t.modelKey, id);
          if (rec !== undefined) {
            if ((bitOf(rec.cls) & B_ROLE) === 0
                || (t.modelKey === u.sourceModelKey && sourceIds.has(id))) {
              add(`${targetPath}/rootDbIds/${k}`, 'coverage-root-role-invalid');
            }
            targetBits |= bitOf(rec.cls);
          }
          yield CROSS_STEP;
        }
      }
      yield CROSS_STEP;
    }
    yield CROSS_STEP;
    if (u.kind !== 'leaf' || !isLeaf(u) || u.outcome !== 'evaluated' || u.scopeProof !== 'equal') continue;
    for (const id of u.sourceRootDbIds) {
      const rec = rootRecord(u.sourceModelKey, id);
      if (rec !== undefined) rec.asSource |= targetBits;
      yield CROSS_STEP;
    }
    for (const t of u.targets) {
      if (t.scope === 'model') {
        wholeTargetSources.set(t.modelKey, (wholeTargetSources.get(t.modelKey) ?? 0) | sourceBits);
      } else if (Array.isArray(t.rootDbIds)) {
        for (const id of t.rootDbIds) {
          const rec = rootRecord(t.modelKey, id);
          if (rec !== undefined) rec.asTarget |= sourceBits;
          yield CROSS_STEP;
        }
      }
      yield CROSS_STEP;
    }
  }

  // 3. Reconcile (a recorded, derivable 'full' only): every owned root must have met every partner
  //    class it has a required pair with, in its §6.3 position.
  if (outcome.coverage !== 'full' || !derivedFull) return;
  const ordered = pairSemanticsOf(definition.mode) === 'ordered';
  // Per class, the partner classes a root of that class must have met as a source / as a target /
  // on either side -- only classes with a partner OTHER than the root itself (a C root's C partner
  // needs a second C root). Computed once; the per-root loop is then O(1).
  const present = (cls, self) => counts[cls] - (self === cls ? 1 : 0) > 0;
  const partners = (classes, self) => classes.reduce((bits, c) => (present(c, self) ? bits | CLASS_BIT[c] : bits), 0);
  const NEEDS = ordered
    ? { A: { source: partners(['B', 'C'], 'A'), target: 0, either: 0 },
        B: { source: 0, target: partners(['A', 'C'], 'B'), either: 0 },
        C: { source: partners(['B', 'C'], 'C'), target: partners(['A', 'C'], 'C'), either: 0 } }
    : { A: { source: partners(['B', 'C'], 'A'), target: 0, either: 0 },
        B: { source: 0, target: partners(['A', 'C'], 'B'), either: 0 },
        C: { source: partners(['B'], 'C'), target: partners(['A'], 'C'), either: partners(['C'], 'C') } };
  let rootUncovered = false;
  for (let r = 0; r < ledger.rootOwners.length; r += 1) {
    const row = ledger.rootOwners[r];
    const whole = wholeTargetSources.get(row.modelKey) ?? 0;
    for (let k = 0; k < row.owners.length; k += 1) {
      const { rootDbId, cls } = row.owners[k];
      if (!Object.hasOwn(NEEDS, cls)) { yield CROSS_STEP; continue; }   // an invalid cls is `root-cls-invalid`
      const rec = rootRecord(row.modelKey, rootDbId);
      const asSource = rec?.asSource ?? 0;
      const asTarget = (rec?.asTarget ?? 0) | whole;
      const { source: needSource, target: needTarget, either: needEither } = NEEDS[cls];
      if ((asSource & needSource) !== needSource || (asTarget & needTarget) !== needTarget
          || ((asSource | asTarget) & needEither) !== needEither) {
        add(`/ledger/rootOwners/${r}/owners/${k}/rootDbId`, 'coverage-root-uncovered');
        rootUncovered = true;
      }
      yield CROSS_STEP;
    }
    yield CROSS_STEP;
  }

  // 4. P5-REM9: pair-level exact cover (same gate). Skipped when step 3 already found a root-level
  //    gap: a root that missed a partner class is already a missing pair, and the set is already
  //    rejected (one defect, one code). `guarded(...)` in `validateResultSetSteps` SWALLOWS a throw, so
  //    an exception here (e.g. an allocation RangeError) would silently skip the proof and fail OPEN; a
  //    set whose pair cover cannot be proven is rejected instead (fail closed).
  if (rootUncovered) return;
  try {
    yield* provePairExactCoverSteps(definition, ledger, rootsByModel, ordered, add);
  } catch {
    add('/ledger/units', 'coverage-pair-uncovered');
  }
}

/**
 * Owner-authorized P5-REM9 remediation (candidate finding I; owner rulings 2026-09-23: "The intended
 * P5 invariant is pair-level coverage ... Pursue option (e): a closed-form pair-count plus
 * rectangle-union coverage proof, with no schema change", then "Choose e1. For §6.3 cell-3b, the
 * intended legal block-triangular substitute uses contiguous blocks under the chosen canonical/
 * data-driven root ordering. Arbitrary-subset blocks are not part of the intended legal persisted
 * layout"). Design: .superpowers/sdd/p5-result-set/task-P5-REM8-report.md + task-P5-REM9-report.md
 * (codex-advisor high design review: SOUND WITH REVISIONS, both revisions folded in). Runs only under
 * step 3's gate (a recorded AND derivable `coverage: 'full'`), so an honest `partial` set -- including
 * one whose evaluated target slice legitimately skips an oversize `target-too-large` root -- is never
 * examined.
 *
 *  1. CANONICAL RANK (the writer's own plan-table order, `planTables.js` TABLE_CLASSES): models in
 *     code-unit `modelKey` order; within a model, class A' < C < B', then ascending `rootDbId`. Rebuilt
 *     from the persisted `(cls, rootDbId)` -- never from `rootOwners` row order, which is the
 *     enumeration walk (classes interleaved) -- with a yielding merge sort. Per model the A-role block
 *     is `[A'|C]` and the B-role block `[C|B']`, each ONE interval (`bStart = modelStart + #A'`).
 *  2. LEGALITY (§6.3/§6.4 + e1), per valid evaluated leaf: its owned, A-role source roots are ONE run
 *     of ONE class table (A' for cell 1, C for cells 2/3a/3b -- no §6.3 cell mixes them); each explicit
 *     target entry's owned, B-role roots are ONE run (cell 1's `[C, B']` may cross that boundary); a
 *     whole-model entry is the model's B-role block. Packing, slicing, 3b bisection and every §6.4 split
 *     only ever cut these runs, and a contiguous block-triangular 3b substitute is runs too; an
 *     arbitrary-subset block is not -> `coverage-layout-noncontiguous` at the offending list, and the
 *     count is skipped (its bound rests on legality). Unowned / out-of-role / invalid-cls ids are
 *     ignored here (they keep their own codes: `unit-root-not-owned`, `coverage-root-role-invalid`,
 *     `root-cls-invalid`), which also clips every rectangle into A-role x B-role.
 *  3. EXACT COUNT: each leaf contributes one rectangle `[s1,s2) x [t1,t2)` per non-empty target entry
 *     (plus its transpose for unordered modes: a C-C pair may be evaluated in either orientation). The
 *     union area (a sweep over x with a cover-count segment tree over compressed y) counts every
 *     covered cell ONCE however many leaves overlap or duplicate it, minus the distinct diagonal cells
 *     `(x, x)` (never a pair). Every counted cell is in the required set P (§6.1) by construction, so
 *     `covered === |P|` (closed form, BigInt: ordered `alpha*beta - c`, unordered symmetric image
 *     `2*alpha*beta - c^2 - c`, alpha = #A-role, beta = #B-role, c = #C) iff every required pair was
 *     evaluated by at least one leaf; otherwise `coverage-pair-uncovered` (once, at `/ledger/units`).
 *     A duplicate or overlapping leaf can never pay for a missing pair (the weight-arithmetic failure).
 *
 * Cost: legal input has one source run and one run per target entry, so the rectangle count
 * R0 <= sum of target entries <= the captured unit id lists (no separate budget or "unbounded"
 * outcome is needed). Time O(n log n + N + R log R), every loop yielding per item; memory O(n + R)
 * typed arrays (peak inventory in the REM9/REM10 reports, folded into the §17.1 R11-7/G-CAL memory
 * item). P5-REM10 (codex-review "release or scope buffers" item): this sweep phase's own working set
 * lives in typed arrays only (no per-list JS `Set`), the one n-sized buffer is reused by every phase
 * (it also holds `ys` and, when it fits, the tree's `cover`), and the segment tree uses the exact
 * 2w-1-node layout. The byte formula below accounts only for this sweep phase's typed-array backing
 * storage; it excludes the earlier ranking phase's plain-JS allocations (`mergeSortSteps`'s `dst`, the
 * per-model `roots[]` array, and one `{rootDbId, rec}` wrapper object per ranked root), so it is NOT a
 * total proof-memory bound (P5-REM11 G-CAL correction). Every sweep buffer is live to the end, so its
 * own peak does not depend on garbage collection:
 * 16C + 4(n+2) + 8T + 4(2w-1) x (1, or 2 when `cover` does not fit in the n-buffer's tail), in
 * bytes, C = capacity >= R0, T = rectangles swept (R0, or 2*R0 unordered), m = distinct y endpoints
 * <= min(n+1, 2*R0 [+ 2 x units, unordered]), w = max(m-1, 1).
 * NOT proven (unchanged trust boundary): that `rootOwners`/`cls` is itself the true enumeration.
 */
const CLASS_RANK = Object.freeze({ A: 0, C: 1, B: 2 });
const byValue = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Stable bottom-up merge sort of an array this function owns, one yield per element moved. */
function* mergeSortSteps(items, compare) {
  let src = items;
  let dst = new Array(src.length);
  for (let width = 1; width < src.length; width *= 2) {
    for (let lo = 0; lo < src.length; lo += 2 * width) {
      const mid = Math.min(lo + width, src.length);
      const hi = Math.min(lo + 2 * width, src.length);
      let i = lo;
      let j = mid;
      for (let k = lo; k < hi; k += 1) {
        dst[k] = j >= hi || (i < mid && compare(src[i], src[j]) <= 0) ? src[i++] : src[j++];
        yield CROSS_STEP;
      }
    }
    [src, dst] = [dst, src];
  }
  return src;
}

function* provePairExactCoverSteps(definition, ledger, rootsByModel, ordered, add) {
  // 1. Canonical ranks.
  const modelKeys = [];
  for (const mk of rootsByModel.keys()) { modelKeys.push(mk); yield CROSS_STEP; }
  const sortedModels = yield* mergeSortSteps(modelKeys, byValue);
  const blocks = new Map();                               // modelKey -> {bStart, end}: the B-role block
  let n = 0;                                              // ranked roots so far (the next rank)
  let nA = 0;
  let nB = 0;
  let nC = 0;
  for (const mk of sortedModels) {
    const roots = [];
    for (const [rootDbId, rec] of rootsByModel.get(mk)) {
      if (Object.hasOwn(CLASS_RANK, rec.cls)) roots.push({ rootDbId, rec });
      yield CROSS_STEP;
    }
    const sorted = yield* mergeSortSteps(roots, (x, y) =>
      CLASS_RANK[x.rec.cls] - CLASS_RANK[y.rec.cls] || byValue(x.rootDbId, y.rootDbId));
    const start = n;
    let modelA = 0;
    for (const { rec } of sorted) {
      rec.rank = n;
      n += 1;
      if (rec.cls === 'A') { nA += 1; modelA += 1; } else if (rec.cls === 'B') nB += 1; else nC += 1;
      yield CROSS_STEP;
    }
    blocks.set(mk, { bStart: start + modelA, end: n });
  }

  // The one n-sized Int32Array of the proof: a per-list stamp during the legality pass (below), then
  // the diagonal difference array, then the x buckets, then the y marks, then `ys` (and, when it
  // fits, the tree's `cover`) for the sweep -- held to the end, never re-allocated.
  const scratch = new Int32Array(n + 2);
  let listId = 0;                                         // <= units x (1 + 64 targets) < 2^31
  // The one run a root list forms, or null (no owned in-role root), or false (not one run / mixed class).
  // Distinct ranks are counted with the stamp `scratch[rank] === listId` (P5-REM10: exactly the former
  // per-list `Set` of ranks, without a list-sized JS-heap allocation).
  function* runOf(modelKey, ids, inRole, singleClass) {
    const roots = rootsByModel.get(modelKey);
    if (roots === undefined) return null;
    listId += 1;
    let distinct = 0;
    let lo = Infinity;
    let hi = -Infinity;
    let firstCls = null;
    let mixed = false;
    for (const id of ids) {
      const rec = roots.get(id);
      if (rec !== undefined && rec.rank !== undefined && inRole(rec.cls) && scratch[rec.rank] !== listId) {
        scratch[rec.rank] = listId;
        distinct += 1;
        if (rec.rank < lo) lo = rec.rank;
        if (rec.rank > hi) hi = rec.rank;
        if (firstCls === null) firstCls = rec.cls; else if (rec.cls !== firstCls) mixed = true;
      }
      yield CROSS_STEP;
    }
    if (distinct === 0) return null;
    if (hi - lo + 1 !== distinct || (singleClass && mixed)) return false;
    return { lo, hi: hi + 1 };
  }
  const sourceRole = (cls) => cls === 'A' || cls === 'C';
  const targetRole = (cls) => cls === 'B' || cls === 'C';

  // 2. Legality, collecting rectangles (x = source rank, y = target rank) into a typed array sized by
  //    the evaluated leaves' target-entry count (the bound on R0).
  //    Memory (codex-review, P5-REM9/REM10): no per-rank class array, no n-sized y index, no per-list
  //    Set, and the one n-sized Int32Array (`scratch`) is reused phase by phase.
  let capacity = 0;
  for (const u of ledger.units) {
    if (u.kind === 'leaf' && isLeaf(u) && u.outcome === 'evaluated' && u.scopeProof === 'equal') capacity += u.targets.length;
    yield CROSS_STEP;
  }
  const rects = new Int32Array(4 * capacity);             // x1, x2, y1, y2 per rectangle
  let base = 0;                                           // rectangles stored
  let legal = true;
  for (let i = 0; i < ledger.units.length; i += 1) {
    const u = ledger.units[i];
    yield CROSS_STEP;
    if (u.kind !== 'leaf' || !isLeaf(u) || u.outcome !== 'evaluated' || u.scopeProof !== 'equal') continue;
    const src = yield* runOf(u.sourceModelKey, u.sourceRootDbIds, sourceRole, true);
    if (src === false) { add(`/ledger/units/${i}/sourceRootDbIds`, 'coverage-layout-noncontiguous'); legal = false; }
    for (let j = 0; j < u.targets.length; j += 1) {
      const t = u.targets[j];
      let tgt = null;
      if (t.scope === 'model') {
        const b = blocks.get(t.modelKey);
        if (b !== undefined && b.end > b.bStart) tgt = { lo: b.bStart, hi: b.end };
      } else if (Array.isArray(t.rootDbIds)) {
        tgt = yield* runOf(t.modelKey, t.rootDbIds, targetRole, false);
        if (tgt === false) { add(`/ledger/units/${i}/targets/${j}/rootDbIds`, 'coverage-layout-noncontiguous'); legal = false; }
      }
      if (legal && src && tgt) {
        rects[4 * base] = src.lo; rects[4 * base + 1] = src.hi; rects[4 * base + 2] = tgt.lo; rects[4 * base + 3] = tgt.hi;
        base += 1;
      }
      yield CROSS_STEP;
    }
  }
  if (!legal) return;

  // 3a. |P| in closed form.
  const alpha = BigInt(nA + nC);
  const beta = BigInt(nB + nC);
  const c = BigInt(nC);
  const required = ordered ? alpha * beta - c : 2n * alpha * beta - c * c - c;

  // 3b. Distinct diagonal cells (x, x) -- never a pair: each stored rectangle's same-root interval
  //     marked into a difference array over the rank space, then counted; then free it for reuse.
  scratch.fill(0);                                        // clear the legality pass's list stamps
  for (let k = 0; k < base; k += 1) {
    const dLo = Math.max(rects[4 * k], rects[4 * k + 2]);
    const dHi = Math.min(rects[4 * k + 1], rects[4 * k + 3]);
    if (dLo < dHi) { scratch[dLo] += 1; scratch[dHi] -= 1; }
    yield CROSS_STEP;
  }
  let running = 0;
  let diagonal = 0;
  for (let v = 0; v < n; v += 1) { running += scratch[v]; if (running > 0) diagonal += 1; yield CROSS_STEP; }
  scratch.fill(0);

  // 3c. Union area. Rectangle k < base is rects[4k..4k+3]; k >= base is the transpose of k - base.
  const total = ordered ? base : 2 * base;
  const rect = (k, f) => {                                // f: 0 x1, 1 x2, 2 y1, 3 y2
    if (k < base) return rects[4 * k + f];
    return rects[4 * (k - base) + (f ^ 2)];               // transpose swaps x <-> y
  };
  // Events e = 2k (open at x1) / 2k+1 (close at x2), bucketed by x with a counting sort over [0, n].
  for (let e = 0; e < 2 * total; e += 1) { scratch[rect(e >> 1, e & 1) + 1] += 1; yield CROSS_STEP; }
  for (let x = 1; x < n + 2; x += 1) { scratch[x] += scratch[x - 1]; yield CROSS_STEP; }
  const order = new Int32Array(2 * total);
  for (let e = 0; e < 2 * total; e += 1) { order[scratch[rect(e >> 1, e & 1)]++] = e; yield CROSS_STEP; }
  // y compression: the distinct rectangle y endpoints, ascending (marked into the same buffer).
  scratch.fill(0);
  for (let k = 0; k < total; k += 1) { scratch[rect(k, 2)] = 1; scratch[rect(k, 3)] = 1; yield CROSS_STEP; }
  // P5-REM10: compacted IN PLACE to the front of the same buffer (slot m <= v, so each mark is read
  // before its slot is reused) and viewed as `ys` -- no allocation, and no reliance on the garbage
  // collector reclaiming a dropped buffer before the tree's own arrays are allocated.
  let m = 0;
  for (let v = 0; v <= n; v += 1) { if (scratch[v] === 1) { scratch[m] = v; m += 1; } yield CROSS_STEP; }
  const ys = scratch.subarray(0, m);
  const yIndex = (y) => {                                 // ys is ascending and holds every endpoint
    let lo = 0;
    let hi = m - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (ys[mid] < y) lo = mid + 1; else hi = mid; }
    return lo;
  };
  // Segment tree over the m-1 elementary y segments: cover count + covered length (no push-down).
  // P5-REM10: pre-order layout, exactly 2w-1 nodes (was 4w): the node over [l, r) has its left child
  // [l, mid) at node + 1 and its right child [mid, r) at node + 2(mid - l), since a subtree over w'
  // segments occupies exactly 2w'-1 consecutive slots. Root 0.
  // `cover` takes the buffer's free tail (after `ys`) when it fits, else its own array.
  const segs = Math.max(m - 1, 1);
  const cover = n + 2 - m >= 2 * segs - 1 ? scratch.subarray(m, m + 2 * segs - 1).fill(0) : new Int32Array(2 * segs - 1);
  const len = new Int32Array(2 * segs - 1);               // covered length <= n < 2^31 (SCHEMA_MAX_NODES)
  const update = (node, l, r, ql, qr, delta) => {         // segments [l, r), query [ql, qr)
    if (qr <= l || r <= ql) return;
    const mid = (l + r) >> 1;
    const right = node + 2 * (mid - l);
    if (ql <= l && r <= qr) {
      cover[node] += delta;
    } else {
      update(node + 1, l, mid, ql, qr, delta);
      update(right, mid, r, ql, qr, delta);
    }
    if (cover[node] > 0) len[node] = ys[r] - ys[l];
    else len[node] = r - l === 1 ? 0 : len[node + 1] + len[right];
  };
  let area = 0n;
  let prevX = 0;
  for (let p = 0; p < 2 * total; p += 1) {
    const e = order[p];
    const k = e >> 1;
    const x = rect(k, e & 1);
    if (x !== prevX) { area += BigInt(len[0]) * BigInt(x - prevX); prevX = x; }
    const yl = yIndex(rect(k, 2));
    const yh = yIndex(rect(k, 3));
    if (m > 1) update(0, 0, m - 1, yl, yh, (e & 1) === 0 ? 1 : -1);
    yield CROSS_STEP;
  }

  if (area - BigInt(diagonal) !== required) add('/ledger/units', 'coverage-pair-uncovered');
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
function* buildOwnerIndexSteps(rootOwners, add) {
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
        yield LINKAGE_STEP;
      }
      yield LINKAGE_STEP;
    }
    yield LINKAGE_STEP;
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
function* coveredBySourceSteps(unit, ref, ownerIndex, unreachableOwner, rootSets) {
  if (ref.modelKey !== unit.sourceModelKey) return false;
  const rootDbId = ownerIndex.get(ref.modelKey)?.get(ref.dbId);
  if (rootDbId === undefined) return unreachableOwner === true;
  return yield* rootListHasSteps(unit.sourceRootDbIds, rootDbId, rootSets);
}

/** P5-REM5 item 5 (codex-review finding, 2026-09-23): `list.includes(rootDbId)` ran once per RESULT
 *  over a unit's whole root list (up to the `ids()` ceiling) -- an unsliced scan inside the sliced
 *  per-result loop, and O(results x roots) overall. Each distinct root list is now indexed ONCE into
 *  a `Set` (one step per root; `Set#has` and `Array#includes` share SameValueZero equality, so the
 *  answer is identical) and cached for the rest of the pass. A non-array value (malformed, already a
 *  structural finding) keeps the former `includes` call verbatim, so its behavior -- including a
 *  throw that abandons this phase -- is unchanged. */
function* rootListHasSteps(list, rootDbId, rootSets) {
  if (!Array.isArray(list)) return list.includes(rootDbId);
  let index = rootSets.get(list);
  if (index === undefined) {
    index = new Set();
    for (const id of list) { index.add(id); yield LINKAGE_STEP; }
    rootSets.set(list, index);
  }
  return index.has(rootDbId);
}

/** Same as `coveredBySource`, for the TARGET side: a `scope: 'model'` target covers the whole
 *  model regardless of root; a `scope: 'roots'` target needs the ref's owning root in its list. */
function* coveredByTargetSteps(unit, ref, ownerIndex, unreachableOwner, rootSets) {
  for (const t of unit.targets) {
    if (t.modelKey !== ref.modelKey) continue;
    if (t.scope === 'model') return true;
    const rootDbId = ownerIndex.get(ref.modelKey)?.get(ref.dbId);
    if (rootDbId === undefined) return unreachableOwner === true;
    if (yield* rootListHasSteps(t.rootDbIds ?? [], rootDbId, rootSets)) return true;
  }
  return false;
}

/** R21-4 linkage, plus the per-result cross-field rules that need the same maps/loop
 *  (`owner-not-in-ledger`, `unreachable-flag-invalid`, `result-id-mismatch`) and the ledger-mention
 *  half of `model-not-in-provenance`. One `Map<unitId, UnitRecord>` and one owner index are built
 *  once; every result is then checked in a single canonical-order pass. */
function* checkResultLinkageSteps(set, add) {
  // P5-REM5 item 5: every index build and every size-dependent loop below is one step per item
  // (same order, same Map/Set contents as the former one-shot `.map()`/`new Set(array)` forms).
  const unitsById = new Map();
  for (const u of set.ledger.units) { unitsById.set(u.unitId, u); yield LINKAGE_STEP; }
  const rootSets = new Map();                             // root list -> Set, built on first use

  const ownerIndex = yield* buildOwnerIndexSteps(set.ledger.rootOwners, add);
  const unreachableIndex = new Map();
  for (const u of set.ledger.unreachablePopulation) {
    const ownerSet = new Set();
    // `new Set(null | undefined)` is an empty set (no throw); preserved exactly for a malformed row.
    if (u.ownerDbIds !== undefined && u.ownerDbIds !== null) {
      for (const id of u.ownerDbIds) { ownerSet.add(id); yield LINKAGE_STEP; }
    }
    unreachableIndex.set(u.modelKey, ownerSet);
    yield LINKAGE_STEP;
  }
  const provenanceModelKeys = new Set();
  for (const m of set.provenance.models) { provenanceModelKeys.add(m.modelKey); yield LINKAGE_STEP; }
  const mentioned = new Set();
  for (const u of set.ledger.units) {
    yield LINKAGE_STEP;
    mentioned.add(u.sourceModelKey);
    for (const t of u.targets) mentioned.add(t.modelKey);
    // P5 final whole-branch review, CT-1 (fixed): `taints[].modelKey` (`TYPES.Taint`, nullable --
    // resultSetSchema.js) is a ledger-resident, schema-declared model-key field this collection was
    // missing, same pattern as the two P5.5 fix-round additions below. Deliberately NOT
    // `diagnostics.diagnostics[].fragment(s).modelKey` -- the review flagged that as arguably outside
    // this rule's literal "results or ledger" wording, and it is left for the milestone owner.
    for (const t of u.taints) { if (t.modelKey !== null) mentioned.add(t.modelKey); yield LINKAGE_STEP; }
  }
  for (const row of set.ledger.rootOwners) { mentioned.add(row.modelKey); yield LINKAGE_STEP; }
  for (const row of set.ledger.unreachablePopulation) { mentioned.add(row.modelKey); yield LINKAGE_STEP; }
  for (const row of set.ledger.hierarchyInternal) { mentioned.add(row.modelKey); yield LINKAGE_STEP; }
  // Task-review finding (2026-09-22, Important, confirmed): the rule row is "provenance.models
  // misses a modelKey the results OR LEDGER mention" -- `unresolvedSelections[].modelKey`
  // (nullable) and `warnings[].modelKey` (optional) are both ledger-resident, schema-declared
  // model-key fields this collection was missing. Reproduced by the reviewer: a re-sealed set with
  // either field set to a phantom modelKey validated `{ok: true}`.
  for (const row of set.ledger.unresolvedSelections) { if (row.modelKey !== null) mentioned.add(row.modelKey); yield LINKAGE_STEP; }
  for (const row of set.ledger.warnings) { if (Object.hasOwn(row, 'modelKey')) mentioned.add(row.modelKey); yield LINKAGE_STEP; }

  const semanticDigest = set.testRef.semanticDigest;
  const testId = set.testRef.testId;
  const definitionMode = set.definition !== null ? set.definition.mode : null;

  for (let i = 0; i < set.results.length; i += 1) {
    yield LINKAGE_STEP;
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
    } else if (unit.kind !== 'leaf') {
      // Owner-authorized P5-REM4 remediation (item 3; codex-review finding, same report as items 1
      // and 2 above, "checkResultLinkage accepts a result whose unit has outcome:'evaluated' without
      // requiring kind:'leaf'"; owner ruling 2026-09-23: "fix in P5 now. Enforce the existing
      // linkage invariant that an evaluated result references the required leaf-kind unit. Keep
      // this narrowly scoped to validation/linkage"). `planning/ledger.js`'s own `recordOutcome`
      // enforces `kind: 'split' <=> outcome: 'split'` on the writer side -- a `kind: 'split'`
      // record's outcome is always exactly `'split'`, both when first set and on every later patch,
      // and a `kind: 'leaf'` record's outcome is one of `SETTLED_OUTCOMES`, which excludes `'split'`
      // -- so `outcome: 'evaluated'` can only ever legitimately occur on a `kind: 'leaf'` unit.
      // Nothing previously re-checked that at the untrusted read boundary: a forged/corrupted unit
      // record with `kind: 'split'` but `outcome: 'evaluated'` (contradicting its own writer-side
      // invariant) would otherwise let a result "validly" link to it and proceed into the coverage/
      // evaluated-as checks below. Deliberately narrow (codex-advisor confirmed this scoping,
      // 2026-09-23): `leavesOf` above (which drives the M1 `derivedFull` coverage predicate) is
      // UNCHANGED here, per the owner's explicit "keep this narrowly scoped to validation/linkage"
      // -- it already filters by `outcome !== 'split'`, mirroring `resultSet.js`'s own
      // `deriveRunOutcome` VERBATIM, and altering only the validator's copy would make reader and
      // writer coverage derivations diverge, which is its own documented anti-goal above.
      add(`${path}/unitId`, 'result-unit-not-leaf');
    } else {
      if (!(yield* coveredBySourceSteps(unit, r.evaluatedAs.source, ownerIndex, unreachableOwner, rootSets))
          || !(yield* coveredByTargetSteps(unit, r.evaluatedAs.target, ownerIndex, unreachableOwner, rootSets))) {
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
    yield LINKAGE_STEP;
  }
}

/** Canonical order (§11.3): `results` must be strictly ascending by `PairId`. A duplicate
 *  `resultId` is already caught structurally (`ResultSet.results`'s own `uniqueBy`); an adjacent
 *  equal-or-descending pair here is `result-order`. */
function* checkOrderAndUniquenessSteps(set, add) {
  const { results } = set;
  for (let i = 1; i < results.length; i += 1) {
    if (comparePairIds(results[i - 1].pair, results[i].pair) >= 0) {
      add(`/results/${i}`, 'result-order');
    }
    yield ORDER_STEP;
  }
}

/**
 * P5-REM5 item 5: the canonical-JSON SHA-256 of `value`, as a step generator -- one `yield` per array
 * element / object property, so a projection of up to 956,824 results (the maxResultsPerRun ceiling, erratum A11) is hashed in §17.3-bounded steps.
 * Byte-identical to P0's `digestCanonical` (asserted in validateResultSet.slicing.test.mjs, and by
 * every sealed fixture's recorded digest still matching): primitives and keys are serialised by P0's
 * own `canonicalJson`, keys are sorted in the same UTF-16 code-unit order, and text is hashed in
 * whole-token batches of >= 8 KiB with P0's exported `Sha256` (the `digestCanonicalSliced` cadence).
 * P0's `canonicalChunks` is NOT used directly: it reads every own key of a container (for an
 * array, a full `Reflect.ownKeys` + index-key scan) synchronously before its first token, which for
 * a million-element array is itself an unbounded span. That scan is a plain-data proof this input
 * no longer needs -- it is a detached `captureResultSet` copy (dense arrays, own enumerable data
 * properties only, no symbols, depth <= 64; `assertCaptured` guards the root). `expand` maps a
 * sentinel array to `{source, project}`: the sentinel is serialised as the array
 * `source.map(project)` WITHOUT materialising it, so `resultSet.js`'s own digest-projection
 * functions (`pairSetDigestInput`, `ledgerDigestInput`) are reused item by item rather than as one
 * synchronous `.map()` over every result/unit (and never re-implemented here).
 */
const DIGEST_STEP = 'validate:digest';
const DIGEST_BATCH_CHARS = 8192;
const utf8 = new TextEncoder();
const byCodeUnit = (x, y) => (x < y ? -1 : x > y ? 1 : 0);
export function* digestCanonicalSteps(value, expand = null) {
  const sha = new Sha256();
  let pending = '';
  const emit = (text) => {
    pending += text;
    if (pending.length >= DIGEST_BATCH_CHARS) { sha.update(utf8.encode(pending)); pending = ''; }
  };
  function* walk(v) {
    if (v === null || typeof v !== 'object') { emit(canonicalJson(v)); return; }
    const lazy = expand === null ? undefined : expand.get(v);
    const list = lazy === undefined ? v : lazy.source;
    if (lazy !== undefined || Array.isArray(v)) {
      emit('[');
      for (let i = 0; i < list.length; i += 1) {
        if (i > 0) emit(',');
        yield* walk(lazy === undefined ? list[i] : lazy.project(list[i]));
        yield DIGEST_STEP;
      }
      emit(']');
      return;
    }
    const keys = Object.keys(v).sort(byCodeUnit);
    emit('{');
    for (let i = 0; i < keys.length; i += 1) {
      if (i > 0) emit(',');
      emit(canonicalJson(keys[i]));
      emit(':');
      yield* walk(v[keys[i]]);
      yield DIGEST_STEP;
    }
    emit('}');
  }
  yield* walk(value);
  if (pending.length > 0) sha.update(utf8.encode(pending));
  return DIGEST_PREFIX + sha.digestHex();
}

/** Recomputed digests must match the recorded ones — UNLESS `digestVersion` is one this reader
 *  does not know, in which case §13.6 makes the set valid-but-unverifiable and this comparison is
 *  skipped entirely (never reported as a mismatch; the CLAIM predicate is what refuses it). */
function* checkDigestsSteps(set, add) {
  if (set.digests.digestVersion !== DIGEST_VERSION) return;
  // `pairSetDigestInput(set.results)` / `ledgerDigestInput(set.ledger, runOptions)`, streamed: the
  // top-level results / units arrays are projected one element at a time through the SAME functions.
  // A non-array `results`/`units` made the former one-shot `.map()` throw (abandoning this phase);
  // the streamed form fails the same way rather than silently hashing an empty list.
  const requireArray = (a) => { if (!Array.isArray(a)) throw new TypeError('validateResultSet: digest input is not an array'); };
  requireArray(set.results);
  const pairSkeleton = pairSetDigestInput([]);
  const expectedPairSet = yield* digestCanonicalSteps(pairSkeleton, new Map([[pairSkeleton,
    { source: set.results, project: (r) => pairSetDigestInput([r])[0] }]]));
  if (set.digests.pairSetDigest !== expectedPairSet) add('/digests/pairSetDigest', 'digest-mismatch');
  requireArray(set.ledger.units);
  const ledgerSkeleton = ledgerDigestInput({ ...set.ledger, units: [] }, set.provenance.runOptions);
  const expectedLedger = yield* digestCanonicalSteps(ledgerSkeleton, new Map([[ledgerSkeleton.units,
    { source: set.ledger.units, project: (u) => ledgerDigestInput({ units: [u] }, {}).units[0] }]]));
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

  yield 'validate:shape'; yield* checkShapeAndUnknownFieldsSteps(set, add, limits);
  // P5-REM5 item 5: a phase that throws part-way is abandoned exactly as before -- its issues so far
  // stand, the rest of THAT phase is skipped, the next phase still runs.
  function* guarded(steps) { try { yield* steps(set, add); } catch { /* the structural phase already covers it */ } }
  yield CROSS_STEP; yield* guarded(checkCrossFieldSteps);
  yield LINKAGE_STEP; yield* guarded(checkResultLinkageSteps);
  yield ORDER_STEP; yield* guarded(checkOrderAndUniquenessSteps);
  yield DIGEST_STEP; yield* guarded(checkDigestsSteps);
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
    const p = slicer.tick(step.value);                   // P0's yield point: undefined unless due (label: `validate:<phase>`)
    if (p !== undefined) await p;
    step = it.next();
  }
  if (!step.value.ok) throw corrupt(runId, step.value.issues);
  await deepFreezeSliced(migrated, slicer);              // P0's helper; the slicer object itself
  return migrated;
}
