// clashtest/results/validateResultSet.js
//
// Task P5.4: capture-first, detached reads of an untrusted Result Set (spec §13.6). This file owns
// ONLY `captureResultSet`, `nodeCeilingError` and `applyMigration` — the structural walk
// (`validateResultSetSteps`, `validateResultSet`, `readResultSet`) is Task P5.5's addition to this
// same file, per the controller's file-ownership ruling
// (.superpowers/sdd/p5-result-set/progress.md).
//
// Capture-first: nothing is ever read off the untrusted `raw` argument before the descriptor-based
// traversal in `util/capture.js` reads it. `runId` is an explicit diagnostic parameter for exactly
// that reason — never read off `raw` — so a hostile `runId` getter can never fire (see the
// 'accessors are rejected...' test).

import { captureData } from '../util/capture.js';
import { isOpenPath, UNKNOWN_FIELD_BYTES, MAX_UNIT_TAINTS } from './resultSetSchema.js';
import { RUN_OPTION_CEILINGS, ENGINE_LIMIT_CEILINGS, SCHEMA_MAX_NODES } from '../options.js';
import { CorruptResultSetError, ResultSetTooLargeError, UnsupportedSchemaVersionError } from '../errors.js';
import { SCHEMA_VERSION } from './resultSet.js';

export { SCHEMA_VERSION };

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
