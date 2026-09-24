// clashtest/options.js
//
// THE single code home of every default, hard ceiling and cross-field rule of spec 17.1 / 17.1.1
// (convergence errata item 3). Nothing else in clashtest/ or in the tests may restate a number
// from this file: import it.
//
// EVERY DEFAULT BELOW IS PROVISIONAL pending gate G-CAL (AC-12 memory / synchronous-capture /
// stall calibration, spec 17.1 "Memory-ceiling calibration gate"). They ship as overridable
// defaults, never as frozen constants of the design; `DEFAULTS_STATUS` says so machine-readably.
//
// Ownership split (spec 17.1.1): a key is EITHER a RunOption (per run, recorded in provenance) OR
// an engine limit (constructor `limits`, fixed per engine, never recorded). A key in the wrong
// place is an unknown key.

import { InvalidOptionsError } from './errors.js';
import { captureData } from './util/capture.js';

const MiB = 1024 * 1024;

export const DEFAULTS_STATUS = Object.freeze({
  provisional: true,
  gate: 'G-CAL',
  note: 'Provisional until AC-12 calibration closes gate G-CAL (spec 17.1); do not treat as frozen.',
});

/** `bytesPerNode` for the producer/reader invariant (spec 13.6): provisional, calibrated by AC-12. */
export const BYTES_PER_NODE = 32;

/**
 * Spec 15.4 provisional defaults for `compareResultSets`' `changed` tolerances (world units; overridable via the
 * call's `opts`, finite and >= 0). PROVISIONAL like every default here (gate G-CAL). Deliberately in neither
 * RUN_OPTION_SPECS nor ENGINE_LIMIT_SPECS: they are per-call options of a derivation, not run options or engine
 * limits, so the ownership split of 17.1.1 (and its unknown-key rule) is untouched. P8's derive/compare.js
 * IMPORTS this object; the single-defaults rule forbids restating the number anywhere else.
 */
export const COMPARE_TOLERANCE_DEFAULTS = Object.freeze({ distanceTolerance: 1e-6, pointTolerance: 1e-6 });

/** Closed-shape node bounds of spec 13.6 (one ClashResult <= 35 nodes, erratum A11 / D-8: a clearance result with all
 *  four flags, every object, array and primitive one node; one ledger/diagnostic record <= 12). */
export const SCHEMA_NODE_FACTORS = Object.freeze({ result: 35, ledger: 12, diagnostic: 12, slack: 65_536 });

const int = (min, ceiling, dflt, extra = {}) => ({ kind: 'int', min, ceiling, default: dflt, ...extra });

// ---- RunOptions (spec 17.1.1 first list; 18 RunOptions) ---------------------------------------------
// Order matters only for derived defaults (a derived default reads an EARLIER key).
export const RUN_OPTION_SPECS = Object.freeze({
  broadPhase: { kind: 'enum', values: ['tlas', 'linear'], default: 'tlas' },
  maxSourceFragmentsPerUnit: int(1, 20_000, 200),
  maxSourceDbIdsPerUnit: int(1, 5_000, 500),
  maxTargetModelsPerUnit: int(1, 64, 4),
  maxTargetFragmentsPerUnit: int(1, 100_000, 20_000),
  maxUnitsPerRun: int(1, 100_000, 10_000),
  // Ceiling 956,824 (erratum A11 / D-8; was 1,000,000): the largest value any engine can accept under the byte half of
  // R21-2, floor((floor(1 GiB / BYTES_PER_NODE) - 12 x 3 - 65,536) / 35) with the smallest legal ledger and no diagnostics.
  maxResultsPerRun: int(1, 956_824, 100_000),
  maxRetainedDiagnostics: int(0, 100_000, 10_000),
  maxPlacementRetries: int(0, 10, 2),
  progressMinIntervalMs: int(0, 60_000, 100),
  interUnitYield: { kind: 'enum', values: ['animation-frame', 'macrotask'], default: 'animation-frame' },
  persist: { kind: 'bool', default: true },
  maxPlanReferences: int(1, 10_000_000, 500_000),
  maxLedgerRecords: int(1, 20_000_000, 1_000_000),
  maxPairsPerOutcome: int(1, null, null, { derivedFrom: 'maxResultsPerRun' }), // default = maxResultsPerRun; <= it
  maxDiagnosticsPerOutcome: int(1, 1_000_000, 200_000),
  maxDistinctReasons: int(1, 1_024, 64),
  maxElementTaintsPerUnit: int(1, 100_000, 2_000),
  maxUnitIdsPerDiagnostic: int(1, 64, 8),
});

// ---- Engine limits (spec 17.1.1 second list; 18 `limits`) ---------------------------------------------
// SCHEMA_MAX_NODES is a data-format property (spec 13.6): every `_ceiling` below is a 17.1.1 hard maximum.
export const SCHEMA_MAX_NODES = SCHEMA_NODE_FACTORS.result * RUN_OPTION_SPECS.maxResultsPerRun.ceiling
  + SCHEMA_NODE_FACTORS.ledger * RUN_OPTION_SPECS.maxLedgerRecords.ceiling
  + SCHEMA_NODE_FACTORS.diagnostic * RUN_OPTION_SPECS.maxRetainedDiagnostics.ceiling
  + SCHEMA_NODE_FACTORS.slack;

export const ENGINE_LIMIT_SPECS = Object.freeze({
  maxResidentResultSets: int(1, 64, 4),
  maxQueuedRuns: int(0, null, null, { derivedFrom: 'maxResidentResultSets', derivedOffset: -1 }), // default = maxResident - 1; <= it
  persistTimeoutMs: int(0, 60_000, 5_000),
  maxAnnotatedNames: int(1, 256, 16),
  maxAnnotationBytes: int(1, 64 * MiB, 8 * MiB),
  sliceBudgetMs: int(1, 8, 4), // ceiling == collision frameBudgetMs (guarded by a drift test)
  aggregationSliceMaxItems: int(1, 100_000, 2_000),
  maxEntriesPerSelection: int(1, 10_000, 1_024),
  maxExplicitElementsPerSelection: int(1, 100_000, 10_000),
  maxValidationIssues: int(1, 1_000, 100),
  maxConcurrentStoreReads: int(1, 4, 1),
  maxQueuedStoreReads: int(0, 64, 8),
  reconcileTimeoutMs: int(1, 60_000, 10_000),
  maxCapturedNodes: int(1, SCHEMA_MAX_NODES, 16_000_000),
  maxStoredResultBytes: int(1, 1_024 * MiB, 512 * MiB),
  maxConcurrentAnnotations: int(1, 8, 2),
  maxConcurrentDerivations: int(1, 8, 2),
  maxFacetsPerGroupBy: int(1, 16, 4),
  maxFilterClauses: int(1, 128, 32),
  maxGroupMemberships: int(1, 10_000_000, 1_000_000),
  maxComparisonEntries: int(1, 10_000_000, 2_000_000),
});

// ---- cross-field rules (spec 17.1.1) -------------------------------------------------------------------
const RUN_CROSS_RULES = [
  { path: '/maxLedgerRecords', needs: ['maxLedgerRecords', 'maxPlanReferences', 'maxUnitsPerRun'],
    ok: (v) => v.maxLedgerRecords >= v.maxPlanReferences + 2 * v.maxUnitsPerRun,
    message: 'maxLedgerRecords must be >= maxPlanReferences + 2 x maxUnitsPerRun' },
  { path: '/maxPairsPerOutcome', needs: ['maxPairsPerOutcome', 'maxResultsPerRun'],
    ok: (v) => v.maxPairsPerOutcome <= v.maxResultsPerRun,
    message: 'maxPairsPerOutcome must be <= maxResultsPerRun' },
];
const LIMIT_CROSS_RULES = [
  { path: '/maxQueuedRuns', needs: ['maxQueuedRuns', 'maxResidentResultSets'],
    ok: (v) => v.maxQueuedRuns <= v.maxResidentResultSets - 1,
    message: 'maxQueuedRuns must be <= maxResidentResultSets - 1' },
];

const issue = (path, code, message) => ({ path, code, message });

function resolveAgainst(specs, crossRules, input, otherSpecs) {
  const issues = [];
  let provided = {};
  if (input !== undefined) {
    // O(constant) detached copy: an options bag is caller data like any other (spec 5.3 scope (i)).
    const cap = captureData(input, { maxNodes: 512, maxDepth: 2, maxIssues: 100, maxKeyLength: 64, maxStringLength: 32 });
    if (!cap.ok) {
      for (const i of cap.issues) issues.push(issue(i.path, 'bad-shape', `options must be a plain object of plain values (${i.code})`));
      return { issues, values: null };
    }
    if (cap.value === null || typeof cap.value !== 'object' || Array.isArray(cap.value)) {
      return { issues: [issue('', 'bad-shape', 'options must be a plain object')], values: null };
    }
    provided = cap.value;
  }

  const values = {};
  const bad = new Set();
  for (const key of Object.keys(provided)) {
    const path = `/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`; // RFC 6901: an unknown key may contain / or ~
    const spec = Object.hasOwn(specs, key) ? specs[key] : undefined;
    if (!spec) {
      issues.push(issue(path, 'unknown-key', Object.hasOwn(otherSpecs, key)
        ? `${key} belongs to the other option set (RunOptions vs engine limits) and is not accepted here`
        : `unknown option ${key}`));
      bad.add(key);
      continue;
    }
    const v = provided[key];
    if (spec.kind === 'bool') {
      if (typeof v !== 'boolean') { issues.push(issue(path, 'not-a-boolean', `${key} must be a boolean`)); bad.add(key); continue; }
    } else if (spec.kind === 'enum') {
      if (!spec.values.includes(v)) { issues.push(issue(path, 'bad-enum', `${key} must be one of ${spec.values.join(' | ')}`)); bad.add(key); continue; }
    } else if (!Number.isSafeInteger(v)) {
      issues.push(issue(path, 'not-an-integer', `${key} must be a finite integer`)); bad.add(key); continue;
    } else if (v < spec.min) {
      issues.push(issue(path, 'below-minimum', `${key} must be >= ${spec.min}`)); bad.add(key); continue;
    } else if (spec.ceiling !== null && v > spec.ceiling) {
      issues.push(issue(path, 'above-ceiling', `${key} must be <= ${spec.ceiling}`)); bad.add(key); continue;
    }
    values[key] = spec.kind === 'int' && v === 0 ? 0 : v; // normalise -0
  }

  // Fill defaults in table order so a derived default sees the resolved earlier key.
  for (const [key, spec] of Object.entries(specs)) {
    if (Object.hasOwn(values, key) || bad.has(key)) continue; // own only: an inherited name is not a resolved option
    if (spec.derivedFrom) {
      if (bad.has(spec.derivedFrom)) { bad.add(key); continue; }
      values[key] = values[spec.derivedFrom] + (spec.derivedOffset ?? 0);
    } else {
      values[key] = spec.default;
    }
  }

  for (const rule of crossRules) {
    if (rule.needs.some((k) => bad.has(k))) continue; // never cascade a second issue off a bad key
    if (!rule.ok(values)) issues.push(issue(rule.path, 'cross-field', rule.message));
  }
  return { issues, values };
}

// The spec tables are the hard-ceiling authority: freeze the whole graph (nested specs and enum arrays), not just the
// outer record, so no importer can raise a ceiling or change a default for every later validation.
// (`deepFreeze` would skip these roots: they are already shallow-frozen.)
for (const table of [RUN_OPTION_SPECS, ENGINE_LIMIT_SPECS]) {
  for (const spec of Object.values(table)) {
    if (spec.values) Object.freeze(spec.values);
    Object.freeze(spec);
  }
}

const defaultsOf = (specs, crossRules, otherSpecs) => {
  const { issues, values } = resolveAgainst(specs, crossRules, undefined, otherSpecs);
  if (issues.length) throw new Error(`options.js defaults are internally inconsistent: ${JSON.stringify(issues)}`);
  return Object.freeze(values);
};

/** Provisional (G-CAL) defaults. Derived keys (`maxPairsPerOutcome`, `maxQueuedRuns`) are materialised here. */
export const RUN_OPTION_DEFAULTS = defaultsOf(RUN_OPTION_SPECS, RUN_CROSS_RULES, ENGINE_LIMIT_SPECS);
export const ENGINE_LIMIT_DEFAULTS = defaultsOf(ENGINE_LIMIT_SPECS, LIMIT_CROSS_RULES, RUN_OPTION_SPECS);

export const RUN_OPTION_KEYS = Object.freeze(Object.keys(RUN_OPTION_SPECS));
export const ENGINE_LIMIT_KEYS = Object.freeze(Object.keys(ENGINE_LIMIT_SPECS));

/** Hard ceilings, as plain `{ key: number | null }` tables (null = cross-field only). */
export const RUN_OPTION_CEILINGS = Object.freeze(Object.fromEntries(
  Object.entries(RUN_OPTION_SPECS).filter(([, s]) => s.kind === 'int').map(([k, s]) => [k, s.ceiling])));
export const ENGINE_LIMIT_CEILINGS = Object.freeze(Object.fromEntries(
  Object.entries(ENGINE_LIMIT_SPECS).filter(([, s]) => s.kind === 'int').map(([k, s]) => [k, s.ceiling])));

// ---- public resolvers ------------------------------------------------------------------------------------
/**
 * Validate `input` (an engine `limits` object; `undefined` = all defaults) and return the frozen, fully
 * resolved limits. Collects EVERY issue, then throws InvalidOptionsError{issues} (spec 17.1.1).
 */
export function resolveEngineLimits(input) {
  const { issues, values } = resolveAgainst(ENGINE_LIMIT_SPECS, LIMIT_CROSS_RULES, input, RUN_OPTION_SPECS);
  if (issues.length) throw new InvalidOptionsError({ issues });
  return Object.freeze(values);
}

/** Worst-case captured-node count of a Result Set the given run options may legally produce (spec 13.6). */
export function worstCaseCapturedNodes(runOptions) {
  return SCHEMA_NODE_FACTORS.result * runOptions.maxResultsPerRun
    + SCHEMA_NODE_FACTORS.ledger * runOptions.maxLedgerRecords
    + SCHEMA_NODE_FACTORS.diagnostic * runOptions.maxRetainedDiagnostics
    + SCHEMA_NODE_FACTORS.slack;
}

/** Issues (possibly empty) of the producer/reader invariant. Pure. */
export function producerReaderIssues(runOptions, limits) {
  const out = [];
  const worst = worstCaseCapturedNodes(runOptions);
  if (worst > limits.maxCapturedNodes) {
    out.push(issue('/maxResultsPerRun', 'result-unreadable-nodes',
      `worst-case ${worst} captured nodes exceeds this engine's maxCapturedNodes ${limits.maxCapturedNodes}`));
  }
  if (limits.maxCapturedNodes * BYTES_PER_NODE > limits.maxStoredResultBytes) {
    out.push(issue('/maxCapturedNodes', 'result-unreadable-bytes',
      `maxCapturedNodes x ${BYTES_PER_NODE} bytes exceeds maxStoredResultBytes ${limits.maxStoredResultBytes}`));
  }
  return out;
}

/** "An engine never produces a set it cannot read" (spec 13.6, R21-2). Throws InvalidOptionsError('result-unreadable'). */
export function assertProducerReaderInvariant(runOptions, limits) {
  const issues = producerReaderIssues(runOptions, limits);
  if (issues.length) throw new InvalidOptionsError({ reason: 'result-unreadable', issues });
}

let defaultLimits = null;
/**
 * Validate `input` (`RunOptions`; `undefined` = all defaults), fill defaults, enforce the cross-field
 * rules and the producer/reader invariant against `limits` (the engine's resolved limits), and return
 * the frozen resolved RunOptions to record in provenance. Throws InvalidOptionsError synchronously.
 */
export function resolveRunOptions(input, limits) {
  const { issues, values } = resolveAgainst(RUN_OPTION_SPECS, RUN_CROSS_RULES, input, ENGINE_LIMIT_SPECS);
  if (issues.length) throw new InvalidOptionsError({ issues });
  const resolved = Object.freeze(values);
  // A supplied `limits` is re-resolved (idempotent for already-resolved limits): a partial or malformed object must not
  // make the invariant's comparisons vacuously false.
  assertProducerReaderInvariant(resolved, limits == null ? (defaultLimits ??= resolveEngineLimits(undefined)) : resolveEngineLimits(limits));
  return resolved;
}
