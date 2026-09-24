// clashtest/execution/UnitExecutor.js
//
// The engine's execution port boundary (spec §7.1): the closed `ExecutionRequest` / `UnitOutcome`
// DTO schemas, the untrusting boundary validator `validateUnitOutcome`, the request-side closed-schema
// check `validateExecutionRequest`, and the canonical `internal-error` outcome constructor P6
// substitutes for a rejected outcome. This file never touches a live `Model`, `CollisionWorld`, or the
// planner's own table representation -- it validates plain data against the two closed schemas only.
//
// Reconciliation note. The plan's Phase interface summary (top of
// docs/superpowers/plans/federated-clash-test-core/p4-executor-diagnostics.md) lists `LIBRARY_STATISTICS_KEYS`
// as an export of THIS file, but Task P4.3's own code sample defines and exports it from
// `clashtest/execution/diagnostics.js` (§12.6), and Task P4.5's own "Interfaces" section says this file
// CONSUMES it from there; Task P4.5's own enum code block (step 3) does not redefine it either. That is a
// genuine cross-section contradiction in the plan text (flagged during implementation). Resolved per the
// "consume, don't redefine" reading, which every detailed section but the summary table agrees with:
// diagnostics.js is the sole owner (it is the module that actually validates a statistics OBJECT via
// `projectStatistics`), and this file imports the frozen list rather than keeping a second copy.

// Same "consume, don't redefine" resolution applies to `MAX_NESTED_STRING_CODE_UNITS`, which was
// separately defined as a private `128` in `diagnostics.js` and an exported `128` here — producer and
// validator of the same capped field, with two sources of truth (internal holistic review,
// 2026-09-22). `diagnostics.js` owns it; this file re-exports it so the public spelling
// `UnitExecutor.MAX_NESTED_STRING_CODE_UNITS` that the plan's interface summary pins is unchanged.
import {
  LIBRARY_STATISTICS_KEYS, MAX_NESTED_STRING_CODE_UNITS, isCompletenessAffecting, attributionOf,
  pairOperandsAreCanonical,
} from './diagnostics.js';

export { MAX_NESTED_STRING_CODE_UNITS };

// ---- closed enums, verbatim from the spec (Task P4.5 step 3) --------------------------------------------

export const EXECUTION_MODES = Object.freeze(['volume-overlap', 'surface-intersection', 'containment', 'clearance']);
export const UNIT_OUTCOME_KINDS = Object.freeze(['evaluated', 'failed', 'skipped', 'discarded']);
export const SCOPE_PROOF_VALUES = Object.freeze(['equal', 'drift', 'unverifiable', 'not-checked']);
export const UNIT_CAUSES = Object.freeze([   // §8.3, exhaustive
  'model-evicted', 'world-disposed', 'stale-placement', 'capacity-exceeded', 'extraction-limit',
  'object-tree-unavailable', 'internal-error', 'cancelled', 'result-cap', 'run-failed',
  'input-changed', 'scope-drift', 'scope-unverifiable', 'unit-cap', 'target-too-large',
]);
export const LIBRARY_CAPACITY_KINDS = Object.freeze([   // F8
  'call-wide-unique-fragment-precheck', 'bucket-capacity', 'tlas-candidate-budget',
  'whole-model-enumeration', 'clearance-narrow-phase-budget',
]);
export const MAX_FAILURE_MESSAGE_CODE_UNITS = 512;

/**
 * Per-mode legal pair keys, library orientation (§11.1, §11.2). Presence is exact: a key outside the
 * mode's list, or a missing required key, is a malformed outcome.
 *   volume-overlap       : witness = {kind:'surface-crossing'|'containment', point:[x,y,z]} | null
 *   surface-intersection : no evidence keys
 *   containment          : no evidence keys
 *   clearance            : distance (finite >= 0), clearance (finite > 0), witness object
 */
export const EVIDENCE_KEYS_BY_MODE = Object.freeze({
  'volume-overlap': Object.freeze(['witness']),
  'surface-intersection': Object.freeze([]),
  containment: Object.freeze([]),
  clearance: Object.freeze(['distance', 'clearance', 'witness']),
});

// ---- closed key sets, private ------------------------------------------------------------------------

const REQUEST_KEYS = new Set(['unit', 'materialized', 'runId', 'attempt', 'mode', 'clearance', 'broadPhase', 'snapshot', 'limits']);
const LIMITS_KEYS = Object.freeze(['maxPairsPerOutcome', 'maxDiagnosticsPerOutcome', 'maxDistinctReasons']);
const BROAD_PHASE_VALUES = Object.freeze(['tlas', 'linear']);
/**
 * FIX-D4 (owner-authorized cross-phase remediation): P3's planned WorkUnit carries a NON-DURABLE
 * `targetWeight` (its target fragment weight, shared by sizing and splitting; sizing.js). The engine
 * hands the planned unit to the executor unfiltered (Run.js `request.unit`), so the closed unit key
 * set has to accept it or every real planned unit fails `request-unit-unknown-key:unit.targetWeight`.
 * It is OPTIONAL here (hand-built units omit it) and, when present, a non-negative safe integer. It
 * is never read by the executor and never reaches an outcome or the ledger (`unitRecordFields` copies
 * an explicit field list).
 */
const UNIT_KEYS = Object.freeze(['unitId', 'cell', 'sourceModelKey', 'sourceRanges', 'targets', 'orientationRole', 'pairSpaceWeight', 'targetWeight']);
const ORIENTATION_ROLES = Object.freeze(['A->B', 'B->A', 'canonical']);
const MATERIALIZED_KEYS = Object.freeze(['sourceDbIds', 'targets', 'scopeExpect']);
const MATERIALIZED_TARGET_KEYS = Object.freeze(['modelKey', 'scope', 'dbIds']);
const SCOPE_EXPECT_KEYS = Object.freeze(['modelKey', 'role', 'scope', 'population', 'roots']);
const ROOT_ENTRY_KEYS = Object.freeze(['dbId', 'subtreeDigest']);
const POPULATION_KEYS = Object.freeze(['count', 'digest']);
const SNAPSHOT_ENTRY_KEYS = Object.freeze(['modelKey', 'modelVersion', 'bindingGeneration', 'placementGeneration']);
const SCOPE_VALUES = Object.freeze(['whole', 'roots']);
const ROLE_VALUES = Object.freeze(['source', 'target']);

const OUTCOME_KEYS = new Set([
  'unitId', 'attempt', 'outcome', 'scopeProof', 'failure', 'generations',
  'pairs', 'diagnostics', 'pairsOverflowLength', 'diagnosticOverflowLength',
  'statistics', 'durationMs',
]);
const FAILURE_KEYS = Object.freeze(['code', 'errorName', 'message', 'capacityKind', 'capacityDetails', 'modelKeys', 'retryable']);
/**
 * The closed key set of `failure.capacityDetails` (F8).
 *
 * FIX (internal holistic review, 2026-09-22): `LocalUnitExecutor.js` carried its own independent copy
 * of this exact list under the near-identical name `CAPACITY_DETAIL_KEYS` (no `S`), and it is the
 * PRODUCER of the very field this list validates. Two lists, one letter apart, producer and
 * validator — the same duplicate-then-drift pattern as `LIBRARY_STATISTICS_KEYS`, with a worse
 * failure mode: if they ever diverge the executor emits a key the validator rejects, the whole
 * outcome is rejected, and per §16.7 Table A U2 that is `failed:internal-error`, which fails the
 * entire RUN. Exported so the producer consumes this one list.
 */
export const CAPACITY_DETAILS_KEYS = Object.freeze(['currentSize', 'missing', 'requested', 'limit']);
const DIAGNOSTIC_KEYS = new Set(['scope', 'reason', 'completenessAffecting', 'attribution', 'fragment', 'fragments', 'ambiguousModelId']);
const FRAGMENT_KEYS = Object.freeze(['modelKey', 'dbId', 'fragId', 'role']);
/**
 * FIX (independent review, M1, owner-authorized remediation 2026-09-22): a pair-scoped operand
 * (`ProjectedDiagnostic.fragments.first`/`.second`) was validated through the SAME `FRAGMENT_KEYS`
 * as a singular fragment-scope operand, so it illegally accepted `role` -- present only on the
 * singular fragment shape (§11.2/§12.2), never on a pair operand, per the P4 plan's own explicit
 * statement that pair-scoped `role` is dropped at projection ("the DTO is closed"). Verified: a pair
 * diagnostic with `role` on both operands returned `{ok: true, issues: []}` and the aggregator then
 * stored the extra field into `NormalizedDiagnostic` detail. `checkFragment` now takes the operand's
 * own legal key set instead of assuming `FRAGMENT_KEYS`.
 */
const PAIR_FRAGMENT_KEYS = Object.freeze(['modelKey', 'dbId', 'fragId']);
const FRAGMENTS_PAIR_KEYS = Object.freeze(['first', 'second']);
const DIAGNOSTIC_ATTRIBUTIONS = Object.freeze(['element', 'target-model', 'unit']);
const DIAGNOSTIC_SCOPES = Object.freeze(['fragment', 'pair']);

// ---- generic guards, private --------------------------------------------------------------------------

/**
 * A `String(detail)` that cannot itself throw.
 *
 * FIX (internal holistic review, 2026-09-22 — codex-review `code` high on this file, reproduced):
 * both validators document and pin "never throws" (row **N8**; P6's substitution path is written
 * against a returned `{ok, issues}` and has no catch of its own). They did throw. Every `add(...)`
 * ran `String(detail)` on an untrusted value, which throws for a Symbol or a hostile
 * `toString`/`Symbol.toPrimitive`; the outer `catch (err)` then formatted `err.message`, so a value
 * whose coercion throws an object whose `message` GETTER also throws escaped the function entirely —
 * verified: both `validateUnitOutcome` and `validateExecutionRequest` propagated `Error: boom2`
 * instead of returning `{ok: false, issues}`. Detail formatting is now total, and the outer catch
 * below no longer reads a property off the caught value unguarded.
 */
const safeDetail = (v) => {
  try {
    return String(v).slice(0, MAX_FAILURE_MESSAGE_CODE_UNITS);
  } catch {
    return '<detail could not be stringified>';
  }
};

/** The caught value's message, read without ever letting a hostile getter escape. */
const safeThrownMessage = (err) => {
  try {
    return safeDetail(err && err.message);
  } catch {
    return '<thrown value could not be described>';
  }
};

const isPlainObject = (v) => v !== null && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype;
const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);
const isSafeNonNegInt = (v) => Number.isSafeInteger(v) && v >= 0;
const has = (o, k) => Object.hasOwn(o, k);

// ================================================================================================
// validateExecutionRequest -- closed-schema check of §7.1's ExecutionRequest, including `limits`.
// ================================================================================================

function checkUnit(unit, add) {
  if (!isPlainObject(unit)) { add('request-unit-not-plain', 'unit', typeof unit); return; }
  for (const key of Object.keys(unit)) if (!UNIT_KEYS.includes(key)) add('request-unit-unknown-key', `unit.${key}`, key);
  if (typeof unit.unitId !== 'string' || unit.unitId.length < 1) add('request-unit-invalid-unitid', 'unit.unitId', unit.unitId);
  if (typeof unit.cell !== 'string' || unit.cell.length < 1) add('request-unit-invalid-cell', 'unit.cell', unit.cell);
  if (typeof unit.sourceModelKey !== 'string' || unit.sourceModelKey.length < 1) {
    add('request-unit-invalid-sourcemodelkey', 'unit.sourceModelKey', unit.sourceModelKey);
  }
  if (!Array.isArray(unit.sourceRanges)) add('request-unit-invalid-sourceranges', 'unit.sourceRanges', typeof unit.sourceRanges);
  if (!Array.isArray(unit.targets)) add('request-unit-invalid-targets', 'unit.targets', typeof unit.targets);
  if (!ORIENTATION_ROLES.includes(unit.orientationRole)) add('request-unit-invalid-orientationrole', 'unit.orientationRole', unit.orientationRole);
  if (!Number.isInteger(unit.pairSpaceWeight) || unit.pairSpaceWeight < 0) {
    add('request-unit-invalid-pairspaceweight', 'unit.pairSpaceWeight', unit.pairSpaceWeight);
  }
  if (has(unit, 'targetWeight') && !isSafeNonNegInt(unit.targetWeight)) {
    add('request-unit-invalid-targetweight', 'unit.targetWeight', unit.targetWeight);
  }
}

function checkRootEntry(r, path, add) {
  if (!isPlainObject(r)) { add('request-root-not-plain', path, typeof r); return; }
  for (const key of Object.keys(r)) if (!ROOT_ENTRY_KEYS.includes(key)) add('request-root-unknown-key', `${path}.${key}`, key);
  if (!isSafeNonNegInt(r.dbId)) add('request-root-invalid-dbid', `${path}.dbId`, r.dbId);
  if (typeof r.subtreeDigest !== 'string' || r.subtreeDigest.length < 1) add('request-root-invalid-digest', `${path}.subtreeDigest`, r.subtreeDigest);
}

function checkPopulation(pop, path, add) {
  if (!isPlainObject(pop)) { add('request-population-not-plain', path, typeof pop); return; }
  for (const key of Object.keys(pop)) if (!POPULATION_KEYS.includes(key)) add('request-population-unknown-key', `${path}.${key}`, key);
  if (!isSafeNonNegInt(pop.count)) add('request-population-invalid-count', `${path}.count`, pop.count);
  if (typeof pop.digest !== 'string' || pop.digest.length < 1) add('request-population-invalid-digest', `${path}.digest`, pop.digest);
}

function checkMaterializedTarget(t, path, add) {
  if (!isPlainObject(t)) { add('request-target-not-plain', path, typeof t); return; }
  for (const key of Object.keys(t)) if (!MATERIALIZED_TARGET_KEYS.includes(key)) add('request-target-unknown-key', `${path}.${key}`, key);
  if (typeof t.modelKey !== 'string' || t.modelKey.length < 1) add('request-target-invalid-modelkey', `${path}.modelKey`, t.modelKey);
  if (!SCOPE_VALUES.includes(t.scope)) add('request-target-invalid-scope', `${path}.scope`, t.scope);
  if (t.scope === 'roots') {
    if (!Array.isArray(t.dbIds)) add('request-target-missing-dbids', `${path}.dbIds`, 'roots scope requires dbIds');
    else t.dbIds.forEach((v, i) => { if (!isSafeNonNegInt(v)) add('request-target-invalid-dbid', `${path}.dbIds[${i}]`, v); });
  } else if (has(t, 'dbIds')) {
    add('request-target-unexpected-dbids', `${path}.dbIds`, 'whole scope forbids dbIds');
  }
}

function checkScopeExpectEntry(s, path, add) {
  if (!isPlainObject(s)) { add('request-scopeexpect-not-plain', path, typeof s); return; }
  for (const key of Object.keys(s)) if (!SCOPE_EXPECT_KEYS.includes(key)) add('request-scopeexpect-unknown-key', `${path}.${key}`, key);
  if (typeof s.modelKey !== 'string' || s.modelKey.length < 1) add('request-scopeexpect-invalid-modelkey', `${path}.modelKey`, s.modelKey);
  if (!ROLE_VALUES.includes(s.role)) add('request-scopeexpect-invalid-role', `${path}.role`, s.role);
  if (!SCOPE_VALUES.includes(s.scope)) add('request-scopeexpect-invalid-scope', `${path}.scope`, s.scope);
  if (s.scope === 'roots') {
    if (!Array.isArray(s.roots)) add('request-scopeexpect-missing-roots', `${path}.roots`, 'roots scope requires roots');
    else s.roots.forEach((r, i) => checkRootEntry(r, `${path}.roots[${i}]`, add));
    if (has(s, 'population')) add('request-scopeexpect-unexpected-population', `${path}.population`, 'roots scope forbids population');
  } else if (s.scope === 'whole') {
    if (has(s, 'population')) checkPopulation(s.population, `${path}.population`, add);
    if (has(s, 'roots')) add('request-scopeexpect-unexpected-roots', `${path}.roots`, 'whole scope forbids roots');
  }
}

function checkMaterialized(materialized, add) {
  if (!isPlainObject(materialized)) { add('request-materialized-not-plain', 'materialized', typeof materialized); return; }
  for (const key of Object.keys(materialized)) if (!MATERIALIZED_KEYS.includes(key)) add('request-materialized-unknown-key', `materialized.${key}`, key);
  if (!Array.isArray(materialized.sourceDbIds)) {
    add('request-materialized-invalid-sourcedbids', 'materialized.sourceDbIds', typeof materialized.sourceDbIds);
  } else {
    materialized.sourceDbIds.forEach((v, i) => {
      if (!isSafeNonNegInt(v)) add('request-materialized-invalid-sourcedbid', `materialized.sourceDbIds[${i}]`, v);
    });
  }
  if (!Array.isArray(materialized.targets)) {
    add('request-materialized-invalid-targets', 'materialized.targets', typeof materialized.targets);
  } else {
    materialized.targets.forEach((t, i) => checkMaterializedTarget(t, `materialized.targets[${i}]`, add));
  }
  if (!Array.isArray(materialized.scopeExpect)) {
    add('request-materialized-invalid-scopeexpect', 'materialized.scopeExpect', typeof materialized.scopeExpect);
  } else {
    materialized.scopeExpect.forEach((s, i) => checkScopeExpectEntry(s, `materialized.scopeExpect[${i}]`, add));
  }
}

function checkSnapshot(snapshot, add) {
  if (!Array.isArray(snapshot) || snapshot.length < 1) {
    add('request-invalid-snapshot', 'snapshot', Array.isArray(snapshot) ? snapshot.length : typeof snapshot);
    return;
  }
  const seen = new Set();
  snapshot.forEach((entry, i) => {
    const path = `snapshot[${i}]`;
    if (!isPlainObject(entry)) { add('request-snapshot-entry-not-plain', path, typeof entry); return; }
    for (const key of Object.keys(entry)) if (!SNAPSHOT_ENTRY_KEYS.includes(key)) add('request-snapshot-unknown-key', `${path}.${key}`, key);
    if (typeof entry.modelKey !== 'string' || entry.modelKey.length < 1) {
      add('request-snapshot-invalid-modelkey', `${path}.modelKey`, entry.modelKey);
    } else if (seen.has(entry.modelKey)) {
      add('request-snapshot-duplicate-modelkey', `${path}.modelKey`, entry.modelKey);
    } else {
      seen.add(entry.modelKey);
    }
    if (typeof entry.modelVersion !== 'string' || entry.modelVersion.length < 1) {
      add('request-snapshot-invalid-modelversion', `${path}.modelVersion`, entry.modelVersion);
    }
    if (!isSafeNonNegInt(entry.bindingGeneration)) add('request-snapshot-invalid-bindinggeneration', `${path}.bindingGeneration`, entry.bindingGeneration);
    if (!isSafeNonNegInt(entry.placementGeneration)) add('request-snapshot-invalid-placementgeneration', `${path}.placementGeneration`, entry.placementGeneration);
  });
}

function checkLimits(limits, add) {
  if (!isPlainObject(limits)) { add('request-limits-not-plain', 'limits', typeof limits); return; }
  for (const key of Object.keys(limits)) if (!LIMITS_KEYS.includes(key)) add('request-limits-unknown-key', `limits.${key}`, key);
  // Every key of the closed 3-key set must resolve to a positive integer -- an absent key fails
  // `Number.isInteger(undefined)` the same way a present-but-wrong-typed one does, so "limits is
  // closed" (missing a required key) needs no separate presence sweep.
  for (const key of LIMITS_KEYS) {
    if (!Number.isInteger(limits[key]) || limits[key] < 1) add('request-limits-invalid', `limits.${key}`, limits[key]);
  }
}

/**
 * Pure. Closed-schema check of §7.1's `ExecutionRequest` (incl. `limits`); used by the executor at
 * entry and by P6 before issue.
 * @param {object} request
 * @returns {{ok: boolean, issues: Array<{code: string, path: string, detail: string}>}}
 */
export function validateExecutionRequest(request) {
  const issues = [];
  const add = (code, path, detail) => issues.push({ code, path, detail: safeDetail(detail) });
  const done = () => ({ ok: issues.length === 0, issues });
  try {
    if (!isPlainObject(request)) { add('request-not-plain', '', typeof request); return done(); }
    for (const key of Object.keys(request)) if (!REQUEST_KEYS.has(key)) add('request-unknown-key', key, key);

    if (typeof request.runId !== 'string' || request.runId.length < 1) add('request-invalid-runid', 'runId', request.runId);
    if (!Number.isInteger(request.attempt) || request.attempt < 0) add('request-invalid-attempt', 'attempt', request.attempt);

    const modeOk = EXECUTION_MODES.includes(request.mode);
    if (!modeOk) add('request-invalid-mode', 'mode', request.mode);
    const hasClearance = has(request, 'clearance');
    if (modeOk && request.mode === 'clearance') {
      if (!hasClearance) add('request-clearance-required', 'clearance', 'clearance mode requires a clearance');
      else if (!isFiniteNumber(request.clearance) || !(request.clearance > 0)) add('request-invalid-clearance', 'clearance', request.clearance);
    } else if (hasClearance) {
      add('request-clearance-forbidden', 'clearance', 'clearance is only legal in clearance mode');
    }

    if (!BROAD_PHASE_VALUES.includes(request.broadPhase)) add('request-invalid-broadphase', 'broadPhase', request.broadPhase);

    checkUnit(request.unit, add);
    checkMaterialized(request.materialized, add);
    checkSnapshot(request.snapshot, add);
    checkLimits(request.limits, add);
  } catch (err) {
    add('request-threw-on-read', '', safeThrownMessage(err));
  }
  return done();
}

// ================================================================================================
// validateUnitOutcome -- the engine's untrusting boundary check of §7.1.
// ================================================================================================

function checkOverflowMarker(outcome, arrKey, markerKey, cap, add) {
  if (!has(outcome, markerKey)) return;
  const marker = outcome[markerKey];
  if (!Number.isSafeInteger(marker) || !(marker > cap)) add(`${markerKey}-invalid`, markerKey, marker);
  const arr = outcome[arrKey];
  if (Array.isArray(arr) && arr.length > 0) add(`${markerKey}-with-nonempty-array`, markerKey, arr.length);
  if (outcome.outcome !== 'evaluated') add(`${markerKey}-on-non-evaluated`, markerKey, outcome.outcome);
}

function checkGenerationsSide(arr, label, participants, add) {
  if (!Array.isArray(arr)) { add('generations-not-array', label, typeof arr); return; }
  const seen = new Set();
  for (let i = 0; i < arr.length; i++) {
    const entry = arr[i];
    const path = `${label}[${i}]`;
    if (!isPlainObject(entry)) { add('generations-entry-not-plain', path, typeof entry); continue; }
    for (const key of Object.keys(entry)) {
      if (key !== 'modelKey' && key !== 'bindingGeneration' && key !== 'placementGeneration') {
        add('generations-entry-unknown-key', `${path}.${key}`, key);
      }
    }
    const mk = entry.modelKey;
    if (typeof mk !== 'string' || !participants.has(mk)) {
      add('generations-entry-unknown-model', `${path}.modelKey`, mk);
    } else if (seen.has(mk)) {
      add('generations-entry-duplicate', `${path}.modelKey`, mk);
    } else {
      seen.add(mk);
    }
    if (!isSafeNonNegInt(entry.bindingGeneration)) add('generations-entry-invalid-binding', `${path}.bindingGeneration`, entry.bindingGeneration);
    if (!isSafeNonNegInt(entry.placementGeneration)) add('generations-entry-invalid-placement', `${path}.placementGeneration`, entry.placementGeneration);
  }
  if (seen.size !== participants.size) add('generations-missing-participant', label, `${seen.size} of ${participants.size}`);
}

function checkFailure(f, participants, add) {
  if (!isPlainObject(f)) { add('failure-not-plain', 'failure', typeof f); return; }
  for (const key of Object.keys(f)) if (!FAILURE_KEYS.includes(key)) add('failure-unknown-key', `failure.${key}`, key);
  if (!UNIT_CAUSES.includes(f.code)) add('failure-invalid-code', 'failure.code', f.code);
  if (has(f, 'errorName') && (typeof f.errorName !== 'string' || f.errorName.length > MAX_NESTED_STRING_CODE_UNITS)) {
    add('failure-invalid-errorname', 'failure.errorName', typeof f.errorName === 'string' ? f.errorName.length : typeof f.errorName);
  }
  if (has(f, 'message') && (typeof f.message !== 'string' || f.message.length > MAX_FAILURE_MESSAGE_CODE_UNITS)) {
    add('failure-invalid-message', 'failure.message', typeof f.message === 'string' ? f.message.length : typeof f.message);
  }
  if (has(f, 'capacityKind') && !LIBRARY_CAPACITY_KINDS.includes(f.capacityKind)) {
    add('failure-invalid-capacitykind', 'failure.capacityKind', f.capacityKind);
  }
  if (has(f, 'capacityDetails')) {
    const cd = f.capacityDetails;
    if (!isPlainObject(cd)) {
      add('failure-capacitydetails-not-plain', 'failure.capacityDetails', typeof cd);
    } else {
      for (const key of Object.keys(cd)) {
        if (!CAPACITY_DETAILS_KEYS.includes(key)) add('failure-capacitydetails-unknown-key', `failure.capacityDetails.${key}`, key);
        else if (!isFiniteNumber(cd[key])) add('failure-capacitydetails-invalid', `failure.capacityDetails.${key}`, cd[key]);
      }
    }
  }
  if (has(f, 'modelKeys')) {
    const mk = f.modelKeys;
    if (!Array.isArray(mk)) {
      add('failure-modelkeys-not-array', 'failure.modelKeys', typeof mk);
    } else if (mk.length > participants.size) {
      // O(1) size gate: a distinct subset of the unit's participants can never be longer than the
      // participant set itself, so an oversized (or hugely duplicated) array is rejected without
      // ever building a Set over it.
      add('failure-modelkeys-invalid', 'failure.modelKeys', mk.length);
    } else {
      const seen = new Set();
      for (const key of mk) {
        if (typeof key !== 'string' || !participants.has(key)) { add('failure-modelkeys-unknown', 'failure.modelKeys', key); break; }
        if (seen.has(key)) { add('failure-modelkeys-duplicate', 'failure.modelKeys', key); break; }
        seen.add(key);
      }
    }
  }
  if (has(f, 'retryable') && typeof f.retryable !== 'boolean') add('failure-invalid-retryable', 'failure.retryable', typeof f.retryable);
}

function checkPoint3(pt, path, add) {
  if (!Array.isArray(pt) || pt.length !== 3) { add('point-invalid-shape', path, pt); return; }
  for (let i = 0; i < 3; i++) if (!isFiniteNumber(pt[i])) add('point-non-finite', `${path}[${i}]`, pt[i]);
}

function checkVolumeWitness(w, path, add) {
  if (w === null) return;
  if (!isPlainObject(w)) { add('witness-not-plain', path, typeof w); return; }
  for (const key of Object.keys(w)) if (key !== 'kind' && key !== 'point') add('witness-unknown-key', `${path}.${key}`, key);
  if (w.kind !== 'surface-crossing' && w.kind !== 'containment') add('witness-invalid-kind', `${path}.kind`, w.kind);
  checkPoint3(w.point, `${path}.point`, add);
}

function checkClearanceWitness(w, path, add) {
  if (!isPlainObject(w)) { add('witness-not-plain', path, typeof w); return; }
  for (const key of Object.keys(w)) if (key !== 'sourcePoint' && key !== 'targetPoint') add('witness-unknown-key', `${path}.${key}`, key);
  checkPoint3(w.sourcePoint, `${path}.sourcePoint`, add);
  checkPoint3(w.targetPoint, `${path}.targetPoint`, add);
}

function checkElementRef(ref, path, side, ctx, add) {
  if (!isPlainObject(ref)) { add('elementref-not-plain', path, typeof ref); return; }
  for (const key of Object.keys(ref)) if (key !== 'modelKey' && key !== 'dbId') add('elementref-unknown-key', `${path}.${key}`, key);
  if (typeof ref.modelKey !== 'string' || !ctx.participants.has(ref.modelKey)) add('elementref-unknown-model', `${path}.modelKey`, ref.modelKey);
  if (!isSafeNonNegInt(ref.dbId)) {
    add('elementref-invalid-dbid', `${path}.dbId`, ref.dbId);
  } else if (typeof ctx.isLegalOwner === 'function' && !ctx.isLegalOwner({ modelKey: ref.modelKey, dbId: ref.dbId, side })) {
    add('elementref-illegal-owner', path, `${ref.modelKey}:${ref.dbId}`);
  }
}

function checkPair(pair, idx, ctx, add) {
  const base = `pairs[${idx}]`;
  if (!isPlainObject(pair)) { add('pair-not-plain', base, typeof pair); return; }
  const evidenceKeys = EVIDENCE_KEYS_BY_MODE[ctx.mode] ?? [];
  const allowed = new Set(['source', 'target', 'type', ...evidenceKeys]);
  for (const key of Object.keys(pair)) if (!allowed.has(key)) add('pair-unknown-key', `${base}.${key}`, key);
  checkElementRef(pair.source, `${base}.source`, 'source', ctx, add);
  checkElementRef(pair.target, `${base}.target`, 'target', ctx, add);
  if (pair.type !== ctx.mode) add('pair-invalid-type', `${base}.type`, pair.type);
  if (evidenceKeys.includes('witness')) {
    if (ctx.mode === 'clearance') checkClearanceWitness(pair.witness, `${base}.witness`, add);
    else checkVolumeWitness(pair.witness, `${base}.witness`, add);
  }
  if (evidenceKeys.includes('distance') && (!isFiniteNumber(pair.distance) || pair.distance < 0)) {
    add('pair-invalid-distance', `${base}.distance`, pair.distance);
  }
  if (evidenceKeys.includes('clearance') && (!isFiniteNumber(pair.clearance) || !(pair.clearance > 0))) {
    add('pair-invalid-clearance', `${base}.clearance`, pair.clearance);
  }
}

function checkFragment(f, path, participants, add, allowedKeys = FRAGMENT_KEYS) {
  if (!isPlainObject(f)) { add('fragment-not-plain', path, typeof f); return; }
  for (const key of Object.keys(f)) if (!allowedKeys.includes(key)) add('fragment-unknown-key', `${path}.${key}`, key);
  if (f.modelKey !== null && (typeof f.modelKey !== 'string' || !participants.has(f.modelKey))) {
    add('fragment-invalid-modelkey', `${path}.modelKey`, f.modelKey);
  }
  if (f.dbId !== null && !isSafeNonNegInt(f.dbId)) add('fragment-invalid-dbid', `${path}.dbId`, f.dbId);
  if (!isSafeNonNegInt(f.fragId)) add('fragment-invalid-fragid', `${path}.fragId`, f.fragId);
  if (allowedKeys.includes('role') && has(f, 'role') && f.role !== 'source' && f.role !== 'target') {
    add('fragment-invalid-role', `${path}.role`, f.role);
  }
}

/**
 * FIX (internal holistic review, 2026-09-22): a PAIR-scoped diagnostic's two operands were not
 * validated at all — this function checked only that `first`/`second` were present and plain, and
 * never received the `participants` set, while the fragment-scope path ran the full `checkFragment`.
 * A pair-scope diagnostic carrying `{first: {modelKey: 'NOT-A-PARTICIPANT', dbId: -7, fragId: 'x',
 * junkKey: 1}, second: {modelKey: 42, dbId: {}, fragId: -1}}` returned `{ok: true, issues: []}`, while
 * the IDENTICAL garbage in fragment scope returned four issues — verified. That is a hole straight
 * through the one check §7.1 exists for ("the engine never trusts an executor to be structurally
 * well-formed"), and it is not academic: P5/P6 read `fragments.first/second`'s `modelKey` and `fragId`
 * to build §12.4's cross-unit de-duplication key and §12.2.1's per-unit taint table, so an unbounded
 * string, a non-participant modelKey, or a garbage fragId flowed straight into the ledger and the
 * sealed Result Set — attributing findings to a model the unit never touched. Both operands now go
 * through the same `checkFragment` as a fragment-scope operand (which subsumes the old
 * `fragments-entry-not-plain` check via its own `fragment-not-plain`).
 */
function checkFragmentsPair(fr, path, participants, add) {
  if (!isPlainObject(fr)) { add('fragments-not-plain', path, typeof fr); return; }
  for (const key of Object.keys(fr)) if (!FRAGMENTS_PAIR_KEYS.includes(key)) add('fragments-unknown-key', `${path}.${key}`, key);
  for (const key of FRAGMENTS_PAIR_KEYS) {
    if (!has(fr, key)) add('fragments-missing-key', `${path}.${key}`, 'required');
    else checkFragment(fr[key], `${path}.${key}`, participants, add, PAIR_FRAGMENT_KEYS);
  }
}

function checkDiagnostic(diag, idx, participants, add) {
  const base = `diagnostics[${idx}]`;
  if (!isPlainObject(diag)) { add('diagnostic-not-plain', base, typeof diag); return; }
  for (const key of Object.keys(diag)) if (!DIAGNOSTIC_KEYS.has(key)) add('diagnostic-unknown-key', `${base}.${key}`, key);
  if (!DIAGNOSTIC_SCOPES.includes(diag.scope)) add('diagnostic-invalid-scope', `${base}.scope`, diag.scope);
  if (typeof diag.reason !== 'string' || diag.reason.length > MAX_NESTED_STRING_CODE_UNITS) {
    add('diagnostic-invalid-reason', `${base}.reason`, typeof diag.reason === 'string' ? diag.reason.length : typeof diag.reason);
  }
  if (typeof diag.completenessAffecting !== 'boolean') {
    add('diagnostic-invalid-completenessaffecting', `${base}.completenessAffecting`, typeof diag.completenessAffecting);
  }
  if (!DIAGNOSTIC_ATTRIBUTIONS.includes(diag.attribution)) add('diagnostic-invalid-attribution', `${base}.attribution`, diag.attribution);
  if (diag.scope === 'fragment') {
    checkFragment(diag.fragment, `${base}.fragment`, participants, add);
    if (has(diag, 'fragments')) add('diagnostic-unexpected-fragments', `${base}.fragments`, 'not legal for fragment scope');
  } else if (diag.scope === 'pair') {
    checkFragmentsPair(diag.fragments, `${base}.fragments`, participants, add);
    if (has(diag, 'fragment')) add('diagnostic-unexpected-fragment', `${base}.fragment`, 'not legal for pair scope');
  }
  if (has(diag, 'ambiguousModelId') && typeof diag.ambiguousModelId !== 'boolean') {
    add('diagnostic-invalid-ambiguousmodelid', `${base}.ambiguousModelId`, typeof diag.ambiguousModelId);
  }
}

/**
 * The two DERIVED diagnostic fields, re-computed rather than believed.
 *
 * FIX (internal holistic review, 2026-09-22 — codex-review `code` high on this file, reproduced):
 * `completenessAffecting` and `attribution` were checked only for type/enum membership, so an
 * executor could simply lie about them and `validateUnitOutcome` returned `{ok: true, issues: []}` —
 * verified with a `geometry-not-yet-available` diagnostic declaring `completenessAffecting: false`
 * and a null-model/null-dbId fragment declaring `attribution: 'element'`. Neither is an unverifiable
 * executor judgement: both are PURE functions of `reason` and the operand structure, and
 * `diagnostics.js` owns both derivations (duplicate-ownership **D3**). The first is the more serious:
 * §12.3's predicate is the engine's single fail-safe for "may be incomplete", so believing a false
 * claim lets a run report clean coverage it never established. This also closes a plan-conformance
 * gap — Task P4.5's own *Interfaces* section lists `isCompletenessAffecting` among the names this
 * file CONSUMES from `diagnostics.js`, and the shipped code imported only `LIBRARY_STATISTICS_KEYS`.
 *
 * Only reached for a diagnostic that already passed every structural check, so `attributionOf`
 * (which dereferences the operands) cannot throw here.
 */
function checkDerivedDiagnosticFields(diag, idx, add) {
  const base = `diagnostics[${idx}]`;
  const expectedAffecting = isCompletenessAffecting(diag.reason);
  if (diag.completenessAffecting !== expectedAffecting) {
    add('diagnostic-completenessaffecting-mismatch', `${base}.completenessAffecting`,
      `declared ${diag.completenessAffecting}, derived ${expectedAffecting}`);
  }
  const expectedAttribution = attributionOf(diag);
  if (diag.attribution !== expectedAttribution) {
    add('diagnostic-attribution-mismatch', `${base}.attribution`,
      `declared ${diag.attribution}, derived ${expectedAttribution}`);
  }
  // A pair's operands must ALREADY be canonical: §12.4's cross-unit de-duplication key is built from
  // `first`/`second` in order, so a reversed pair de-duplicates against nothing and the same physical
  // pair survives twice as two retained diagnostics. `projectDiagnostic` canonicalizes everything it
  // builds; this is the check for an executor that did not (internal holistic review, 2026-09-22 --
  // `codex-advisor`, which confirmed a reversed pair returned `{ok: true}`).
  if (diag.scope === 'pair' && !pairOperandsAreCanonical(diag.fragments.first, diag.fragments.second)) {
    add('diagnostic-pair-not-canonical', `${base}.fragments`, 'first/second are not in canonical order');
  }
}

function checkStatistics(statistics, add) {
  if (!isPlainObject(statistics)) { add('statistics-not-plain', 'statistics', typeof statistics); return; }
  for (const key of Object.keys(statistics)) {
    if (!LIBRARY_STATISTICS_KEYS.includes(key)) { add('statistics-unknown-key', `statistics.${key}`, key); continue; }
    if (!isFiniteNumber(statistics[key])) add('statistics-invalid-value', `statistics.${key}`, statistics[key]);
  }
}

/**
 * Pure, never throws, synchronous. The result is always exactly `{ok, issues}` (row N8) -- `ok:true`
 * still carries `issues: []`, and nothing else is ever added. The engine's untrusting boundary check
 * of §7.1: `ok:false` => P6 substitutes `internalErrorOutcome(request, issues)` and fails the run.
 * `opts.isLegalOwner({modelKey, dbId, side}) => boolean` is the optional owner-scope oracle P6 builds
 * over P3's `ownerClassOf` / `rootOfOwner`; omitted, the owner-scope checks are skipped.
 * @param {object} request a validated ExecutionRequest
 * @param {unknown} outcome untrusted candidate UnitOutcome
 * @param {{isLegalOwner?: (ref: {modelKey: string, dbId: number, side: 'source'|'target'}) => boolean}} [opts]
 * @returns {{ok: boolean, issues: Array<{code: string, path: string, detail: string}>}}
 */
export function validateUnitOutcome(request, outcome, { isLegalOwner } = {}) {
  const issues = [];
  const add = (code, path, detail) => issues.push({ code, path, detail: safeDetail(detail) });
  const done = () => ({ ok: issues.length === 0, issues });
  try {
    if (!isPlainObject(outcome)) { add('outcome-not-plain', '', typeof outcome); return done(); }

    // 1. identity
    if (outcome.unitId !== request.unit.unitId) add('unit-id-mismatch', 'unitId', outcome.unitId);
    if (outcome.attempt !== request.attempt) add('attempt-mismatch', 'attempt', outcome.attempt);

    // 2. closed key set
    for (const key of Object.keys(outcome)) if (!OUTCOME_KEYS.has(key)) add('outcome-unknown-key', key, key);

    // 3. enums + the evaluated invariant (I-scope)
    if (!UNIT_OUTCOME_KINDS.includes(outcome.outcome)) add('outcome-invalid-enum', 'outcome', outcome.outcome);
    if (!SCOPE_PROOF_VALUES.includes(outcome.scopeProof)) add('scopeproof-invalid-enum', 'scopeProof', outcome.scopeProof);
    const isEvaluated = outcome.outcome === 'evaluated';
    if (isEvaluated !== (outcome.failure === null)) add('outcome-failure-invariant', 'failure', outcome.failure);
    if (isEvaluated && outcome.scopeProof !== 'equal') add('outcome-scope-invariant', 'scopeProof', outcome.scopeProof);

    const participants = new Set(request.snapshot.map((s) => s.modelKey));

    // 4. O(1) size gates BEFORE any deep processing
    let pairsOk = Array.isArray(outcome.pairs);
    if (!pairsOk) add('pairs-not-array', 'pairs', typeof outcome.pairs);
    else if (outcome.pairs.length > request.limits.maxPairsPerOutcome) {
      add('pairs-over-cap', 'pairs', outcome.pairs.length);   // P6 maps this to failed:result-cap, not internal-error
      pairsOk = false;
    }
    checkOverflowMarker(outcome, 'pairs', 'pairsOverflowLength', request.limits.maxPairsPerOutcome, add);

    let diagnosticsOk = Array.isArray(outcome.diagnostics);
    if (!diagnosticsOk) add('diagnostics-not-array', 'diagnostics', typeof outcome.diagnostics);
    else if (outcome.diagnostics.length > request.limits.maxDiagnosticsPerOutcome) {
      add('diagnostics-over-cap', 'diagnostics', outcome.diagnostics.length);
      diagnosticsOk = false;
    }
    checkOverflowMarker(outcome, 'diagnostics', 'diagnosticOverflowLength', request.limits.maxDiagnosticsPerOutcome, add);

    // 5. deep walk: plainness, finiteness, -0 tolerance, string lengths, participant membership,
    //    owner membership via isLegalOwner, evidence shape by mode, statistics schema.
    if (isPlainObject(outcome.generations)) {
      for (const key of Object.keys(outcome.generations)) {
        if (key !== 'start' && key !== 'end') add('generations-unknown-key', `generations.${key}`, key);
      }
      checkGenerationsSide(outcome.generations.start, 'generations.start', participants, add);
      checkGenerationsSide(outcome.generations.end, 'generations.end', participants, add);
    } else {
      add('generations-not-plain', 'generations', typeof outcome.generations);
    }

    if (outcome.failure !== null) checkFailure(outcome.failure, participants, add);

    if (pairsOk) {
      const ctx = { mode: request.mode, participants, isLegalOwner };
      for (let i = 0; i < outcome.pairs.length; i++) checkPair(outcome.pairs[i], i, ctx, add);
    }
    if (diagnosticsOk) {
      for (let i = 0; i < outcome.diagnostics.length; i++) {
        const before = issues.length;
        checkDiagnostic(outcome.diagnostics[i], i, participants, add);
        // Derived fields are only re-checked once the diagnostic is structurally sound, so the
        // derivation never has to defend against the shapes the structural pass already rejected.
        if (issues.length === before) checkDerivedDiagnosticFields(outcome.diagnostics[i], i, add);
      }
    }

    checkStatistics(outcome.statistics, add);

    if (!isFiniteNumber(outcome.durationMs) || outcome.durationMs < 0) add('durationms-invalid', 'durationMs', outcome.durationMs);
  } catch (err) {
    add('outcome-threw-on-read', '', safeThrownMessage(err));
  }
  // Exactly two fields, always (row N8): P6 reads `{ok, issues}` and nothing else.
  return done();
}

// ================================================================================================
// internalErrorOutcome -- the canonical failed:internal-error outcome (§7.5).
// ================================================================================================

/**
 * Canonical `failed:internal-error` outcome, synchronous. P6 substitutes it for a rejected outcome
 * (`validateUnitOutcome(...).ok === false`); the reference executor uses it for its own
 * malformed-request and projection failures. `generations.start`/`.end` are both taken from the
 * request's own snapshot (stripped of `modelVersion`, which is not a generations field) because no
 * attempt actually progressed when this is called -- there is nothing else to read them from.
 * @param {object} request
 * @param {Array<{code: string, path: string, detail: string}>} issues
 * @returns {object} a plain UnitOutcome
 */
export function internalErrorOutcome(request, issues) {
  const list = Array.isArray(issues) ? issues : [];
  const snapshot = Array.isArray(request?.snapshot) ? request.snapshot : [];
  const toGeneration = ({ modelKey, bindingGeneration, placementGeneration }) => ({ modelKey, bindingGeneration, placementGeneration });
  const validEntries = snapshot.filter((s) => isPlainObject(s) && typeof s.modelKey === 'string');
  const summary = list.map((i) => `${i.code}:${i.path}`).join('; ') || 'validation rejected the outcome';
  return {
    unitId: typeof request?.unit?.unitId === 'string' ? request.unit.unitId : '',
    attempt: Number.isInteger(request?.attempt) ? request.attempt : 0,
    outcome: 'failed',
    scopeProof: 'not-checked',
    failure: { code: 'internal-error', message: summary.slice(0, MAX_FAILURE_MESSAGE_CODE_UNITS) },
    generations: { start: validEntries.map(toGeneration), end: validEntries.map(toGeneration) },
    pairs: [],
    diagnostics: [],
    statistics: {},
    durationMs: 0,
  };
}
