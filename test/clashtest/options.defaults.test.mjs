// test/clashtest/options.defaults.test.mjs
//
// Provisional-defaults conformance (spec 17.1 / 17.1.1 / 13.6). Reads every number from
// clashtest/options.js; the only external sources are the spec's own table (parsed) and, for the
// drift guard, collision/constants.js. Nothing here hard-codes a default.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as opts from '../../clashtest/options.js';
import { InvalidOptionsError } from '../../clashtest/errors.js';
import { maxCollisionInstancesPerEpoch, maxFragmentsPerDbId, frameBudgetMs } from '../../collision/constants.js';

const {
  RUN_OPTION_DEFAULTS, ENGINE_LIMIT_DEFAULTS, RUN_OPTION_KEYS, ENGINE_LIMIT_KEYS, RUN_OPTION_CEILINGS, ENGINE_LIMIT_CEILINGS,
  SCHEMA_MAX_NODES, SCHEMA_NODE_FACTORS, BYTES_PER_NODE, DEFAULTS_STATUS,
  worstCaseCapturedNodes, producerReaderIssues, resolveRunOptions, resolveEngineLimits,
} = opts;

// Names only, transcribed from spec 18 (RunOptions list and the constructor `limits` list).
const SPEC_18_RUN_OPTIONS = ['broadPhase', 'maxSourceFragmentsPerUnit', 'maxSourceDbIdsPerUnit', 'maxTargetModelsPerUnit',
  'maxTargetFragmentsPerUnit', 'maxUnitsPerRun', 'maxResultsPerRun', 'maxRetainedDiagnostics', 'maxPlacementRetries',
  'progressMinIntervalMs', 'interUnitYield', 'persist', 'maxPlanReferences', 'maxLedgerRecords', 'maxPairsPerOutcome',
  'maxDiagnosticsPerOutcome', 'maxDistinctReasons', 'maxElementTaintsPerUnit', 'maxUnitIdsPerDiagnostic'];
const SPEC_18_ENGINE_LIMITS = ['maxResidentResultSets', 'maxQueuedRuns', 'persistTimeoutMs', 'maxAnnotatedNames',
  'maxAnnotationBytes', 'sliceBudgetMs', 'aggregationSliceMaxItems', 'maxEntriesPerSelection',
  'maxExplicitElementsPerSelection', 'maxValidationIssues', 'maxConcurrentStoreReads', 'maxQueuedStoreReads',
  'reconcileTimeoutMs', 'maxCapturedNodes', 'maxStoredResultBytes', 'maxConcurrentAnnotations',
  'maxConcurrentDerivations', 'maxFacetsPerGroupBy', 'maxFilterClauses', 'maxGroupMemberships', 'maxComparisonEntries'];

test('ownership split: RunOption keys and engine-limit keys are exactly the spec 18 lists and are disjoint', () => {
  assert.deepEqual([...RUN_OPTION_KEYS].sort(), [...SPEC_18_RUN_OPTIONS].sort());
  assert.deepEqual([...ENGINE_LIMIT_KEYS].sort(), [...SPEC_18_ENGINE_LIMITS].sort());
  assert.deepEqual(RUN_OPTION_KEYS.filter((k) => ENGINE_LIMIT_KEYS.includes(k)), []);
  assert.deepEqual(Object.keys(RUN_OPTION_DEFAULTS), RUN_OPTION_KEYS);
  assert.deepEqual(Object.keys(ENGINE_LIMIT_DEFAULTS), ENGINE_LIMIT_KEYS);
});

test('every default is flagged provisional pending G-CAL', () => {
  assert.equal(DEFAULTS_STATUS.provisional, true);
  assert.equal(DEFAULTS_STATUS.gate, 'G-CAL');
  assert.ok(Object.isFrozen(DEFAULTS_STATUS) && Object.isFrozen(RUN_OPTION_DEFAULTS) && Object.isFrozen(ENGINE_LIMIT_DEFAULTS));
});

test('every default is inside [min, ceiling] and satisfies every cross-field rule (the defaults resolve cleanly)', () => {
  for (const [specs, defaults] of [[opts.RUN_OPTION_SPECS, RUN_OPTION_DEFAULTS], [opts.ENGINE_LIMIT_SPECS, ENGINE_LIMIT_DEFAULTS]]) {
    for (const [key, spec] of Object.entries(specs)) {
      if (spec.kind !== 'int') continue;
      assert.ok(defaults[key] >= spec.min, `${key} >= min`);
      if (spec.ceiling !== null) assert.ok(defaults[key] <= spec.ceiling, `${key} <= ceiling`);
    }
  }
  assert.deepEqual(resolveRunOptions(RUN_OPTION_DEFAULTS), RUN_OPTION_DEFAULTS);      // idempotent round trip
  assert.deepEqual(resolveEngineLimits(ENGINE_LIMIT_DEFAULTS), ENGINE_LIMIT_DEFAULTS);
});

test('derived defaults: maxPairsPerOutcome == maxResultsPerRun; maxQueuedRuns == maxResidentResultSets - 1', () => {
  assert.equal(RUN_OPTION_DEFAULTS.maxPairsPerOutcome, RUN_OPTION_DEFAULTS.maxResultsPerRun);
  assert.equal(ENGINE_LIMIT_DEFAULTS.maxQueuedRuns, ENGINE_LIMIT_DEFAULTS.maxResidentResultSets - 1);
});

test('maxLedgerRecords default >= maxPlanReferences + 2 x maxUnitsPerRun (reserves maxUnitsPerRun overflow slots and >= maxUnitsPerRun discretionary records)', () => {
  const d = RUN_OPTION_DEFAULTS;
  assert.ok(d.maxLedgerRecords >= d.maxPlanReferences + 2 * d.maxUnitsPerRun);
});

test('SCHEMA_MAX_NODES is 35 x maxResults + 12 x maxLedger + (24 + maxUnitIdsPerDiagnostic) x maxDiagnostics ceilings + 65,536 (spec 13.6, A13) and bounds maxCapturedNodes', () => {
  assert.equal(SCHEMA_MAX_NODES,
    SCHEMA_NODE_FACTORS.result * RUN_OPTION_CEILINGS.maxResultsPerRun
    + SCHEMA_NODE_FACTORS.ledger * RUN_OPTION_CEILINGS.maxLedgerRecords
    + (SCHEMA_NODE_FACTORS.diagnostic + RUN_OPTION_CEILINGS.maxUnitIdsPerDiagnostic) * RUN_OPTION_CEILINGS.maxRetainedDiagnostics
    + SCHEMA_NODE_FACTORS.slack);
  assert.equal(ENGINE_LIMIT_CEILINGS.maxCapturedNodes, SCHEMA_MAX_NODES);
  assert.ok(ENGINE_LIMIT_DEFAULTS.maxCapturedNodes <= SCHEMA_MAX_NODES);
});

test('PRODUCER/READER INVARIANT at the defaults: an engine never produces a set it cannot read (spec 13.6, R21-2)', () => {
  const worst = worstCaseCapturedNodes(RUN_OPTION_DEFAULTS);
  assert.equal(worst,
    35 * RUN_OPTION_DEFAULTS.maxResultsPerRun + 12 * RUN_OPTION_DEFAULTS.maxLedgerRecords
    + (24 + RUN_OPTION_DEFAULTS.maxUnitIdsPerDiagnostic) * RUN_OPTION_DEFAULTS.maxRetainedDiagnostics + 65_536);
  assert.ok(worst <= ENGINE_LIMIT_DEFAULTS.maxCapturedNodes, 'worst-case nodes fit maxCapturedNodes');
  assert.ok(ENGINE_LIMIT_DEFAULTS.maxCapturedNodes * BYTES_PER_NODE <= ENGINE_LIMIT_DEFAULTS.maxStoredResultBytes, 'nodes x bytesPerNode fit maxStoredResultBytes');
  assert.deepEqual(producerReaderIssues(RUN_OPTION_DEFAULTS, ENGINE_LIMIT_DEFAULTS), []);
});

test('hard ceilings that mirror the library are aligned with collision/constants.js (drift guard; the ONLY collision import, test-side)', () => {
  assert.equal(RUN_OPTION_CEILINGS.maxSourceFragmentsPerUnit, maxCollisionInstancesPerEpoch);
  assert.equal(RUN_OPTION_CEILINGS.maxSourceDbIdsPerUnit, maxFragmentsPerDbId);
  assert.equal(RUN_OPTION_DEFAULTS.maxTargetFragmentsPerUnit, maxCollisionInstancesPerEpoch);
  assert.equal(ENGINE_LIMIT_CEILINGS.sliceBudgetMs, frameBudgetMs);
});

// ---- spec-table drift: parse the spec's own 17.1 table and compare with options.js -------------------------
const SPEC_PATH = new URL('../../docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md', import.meta.url);

function parseSpecDefaultsTable(markdown) {
  const start = markdown.indexOf('### 17.1 Provisional caps');
  const end = markdown.indexOf('**Memory-ceiling calibration gate', start);
  assert.ok(start > 0 && end > start, 'spec 17.1 table located');
  const rows = [];
  for (const line of markdown.slice(start, end).split('\n')) {
    const m = /^\| (`[^|]+?`(?: \/ `[^|]+?`)*) \| ([^|]+) \|/.exec(line);
    if (!m) continue;
    const names = [...m[1].matchAll(/`([A-Za-z]+)`/g)].map((x) => x[1]);
    const cell = m[2].replace(/\*\*/g, '').replace(/\s*\(.*$/, '').trim();   // drop "(was ...)" / "(512 MiB)" notes
    const tokens = cell.split(' / ').map((t) => t.trim());
    rows.push({ names, tokens });
  }
  return rows;
}

const parseToken = (t) => {
  let m;
  if (/^[\d,]+$/.test(t)) return Number(t.replace(/,/g, ''));
  if ((m = /^([\d,]+) MiB$/.exec(t))) return Number(m[1].replace(/,/g, '')) * 1024 * 1024;
  if (t === '`true`') return true;
  if (t === '`false`') return false;
  if ((m = /^`'([a-z-]+)'`$/.exec(t))) return m[1];
  return undefined; // symbolic default (derived); checked by its own test
};

test('spec 17.1 drift: every numeric/enum default in the spec table equals options.js (symbolic rows are the two derived defaults)', () => {
  const rows = parseSpecDefaultsTable(readFileSync(SPEC_PATH, 'utf8'));
  assert.ok(rows.length >= 35, `parsed ${rows.length} rows`);
  const all = { ...RUN_OPTION_DEFAULTS, ...ENGINE_LIMIT_DEFAULTS };
  const symbolic = [];
  const seen = new Set();
  for (const { names, tokens } of rows) {
    assert.equal(tokens.length, names.length, `row ${names.join('/')} has ${tokens.length} default tokens`);
    names.forEach((name, i) => {
      assert.ok(name in all, `spec parameter ${name} exists in options.js`);
      seen.add(name);
      const want = parseToken(tokens[i]);
      if (want === undefined) { symbolic.push(name); return; }
      assert.strictEqual(all[name], want, `${name}: options.js ${all[name]} vs spec ${want}`);
    });
  }
  assert.deepEqual(symbolic.sort(), ['maxPairsPerOutcome', 'maxQueuedRuns']);
  // every option this file owns is documented in the spec table
  for (const key of [...RUN_OPTION_KEYS, ...ENGINE_LIMIT_KEYS]) assert.ok(seen.has(key), `${key} appears in spec 17.1`);
});

test('COMPARE_TOLERANCE_DEFAULTS (spec 15.4, OPEN-4 strict reading): frozen, two finite non-negative keys, equal to the spec\'s provisional default, in NEITHER option set, flagged provisional', () => {
  const { COMPARE_TOLERANCE_DEFAULTS } = opts;
  assert.ok(Object.isFrozen(COMPARE_TOLERANCE_DEFAULTS));
  assert.deepEqual(Object.keys(COMPARE_TOLERANCE_DEFAULTS), ['distanceTolerance', 'pointTolerance']);
  for (const v of Object.values(COMPARE_TOLERANCE_DEFAULTS)) assert.ok(Number.isFinite(v) && v >= 0);
  const md = readFileSync(SPEC_PATH, 'utf8');
  const m = /`distanceTolerance`, `pointTolerance`: finite numbers ≥ 0, provisional defaults `([0-9.eE+-]+)` world units/.exec(md);
  assert.ok(m, 'spec 15.4 tolerance sentence located');
  assert.strictEqual(COMPARE_TOLERANCE_DEFAULTS.distanceTolerance, Number(m[1]));
  assert.strictEqual(COMPARE_TOLERANCE_DEFAULTS.pointTolerance, Number(m[1]));
  for (const key of Object.keys(COMPARE_TOLERANCE_DEFAULTS)) {
    assert.ok(!RUN_OPTION_KEYS.includes(key) && !ENGINE_LIMIT_KEYS.includes(key), `${key} is not a RunOption or an engine limit`);
    for (const resolve of [resolveRunOptions, resolveEngineLimits]) {
      assert.throws(() => resolve({ [key]: 1 }), (e) => e instanceof InvalidOptionsError && e.issues[0].code === 'unknown-key' && e.issues[0].path === `/${key}`);
    }
  }
  assert.equal(DEFAULTS_STATUS.provisional, true);                                  // the G-CAL flag covers it
});

test('single-defaults rule: no file under clashtest/ except options.js restates a compare-tolerance literal (P8 must import COMPARE_TOLERANCE_DEFAULTS)', () => {
  const root = fileURLToPath(new URL('../../clashtest/', import.meta.url));
  const optionsFile = fileURLToPath(new URL('../../clashtest/options.js', import.meta.url));
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith('.js') && full !== optionsFile) files.push(full);
    }
  };
  walk(root);
  assert.ok(files.length > 0);
  for (const file of files) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /\b1e-6\b|\b0\.000001\b/, `${file} restates the compare tolerance`);
  }
});

test('spec 17.1.1 drift: hard ceilings in the spec table equal options.js', () => {
  const md = readFileSync(SPEC_PATH, 'utf8');
  const start = md.indexOf('### 17.1.1 Option validation');
  const end = md.indexOf('Ceilings exist so a caller cannot defeat a bound', start);
  const ceilings = { ...RUN_OPTION_CEILINGS, ...ENGINE_LIMIT_CEILINGS };
  let checked = 0;
  for (const line of md.slice(start, end).split('\n')) {
    const m = /^\| (`[^|]+?`(?:, `[^|]+?`)*) \| [^|]+ \| ([^|]+) \|/.exec(line);
    if (!m) continue;
    const names = [...m[1].matchAll(/`([A-Za-z]+)`/g)].map((x) => x[1]);
    const cell = m[2].replace(/\s*\(.*$/, '').trim();
    const tokens = cell.split(' / ').map((t) => t.trim());
    const parsed = tokens.map((t) => {
      let mm;
      if (/^[\d,]+$/.test(t)) return Number(t.replace(/,/g, ''));
      if ((mm = /^(\d+) MiB$/.exec(t))) return Number(mm[1]) * 1024 * 1024;
      if (t === '1 GiB') return 1024 * 1024 * 1024;
      if (t === '`SCHEMA_MAX_NODES`') return SCHEMA_MAX_NODES;
      if (t === '`frameBudgetMs` (8)' || t.startsWith('`frameBudgetMs`')) return frameBudgetMs;
      return undefined;
    });
    if (parsed.some((p) => p === undefined)) continue; // cross-field / "-" rows
    // rows like `a`, `b` | ... | 20,000 / 5,000 map positionally; single-ceiling rows share one value
    names.forEach((name, i) => {
      const want = parsed.length === names.length ? parsed[i] : parsed[0];
      assert.strictEqual(ceilings[name], want, `${name} ceiling`);
      checked++;
    });
  }
  assert.ok(checked >= 25, `checked ${checked} ceilings`);
});
