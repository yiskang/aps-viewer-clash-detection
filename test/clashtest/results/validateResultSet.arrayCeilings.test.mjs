// test/clashtest/results/validateResultSet.arrayCeilings.test.mjs
//
// P5-REM5 item 4 (owner ruling 2026-09-23: "Replace the generic fallback behavior wherever a
// stricter schema ceiling is defined. Capture-time validation must fail closed against each path's
// actual governing schema ceiling, consistent with frozen spec §13.6"). Before this fix only 5 hand-
// listed paths had a capture-time ceiling; every other schema-declared array was checked during
// capture against the generic 20,000,000 fallback and only rejected later, by the structural phase,
// after the whole over-long array had already been copied.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as V from '../../../clashtest/results/validateResultSet.js';
import { TYPES, EVIDENCE_BY_MODE, MAX_UNIT_TAINTS } from '../../../clashtest/results/resultSetSchema.js';
import { CorruptResultSetError } from '../../../clashtest/errors.js';
import { ENGINE_LIMIT_DEFAULTS, RUN_OPTION_CEILINGS, ENGINE_LIMIT_CEILINGS } from '../../../clashtest/options.js';
import { sealedSet } from '../support/resultSetFixtures.mjs';

const limits = ENGINE_LIMIT_DEFAULTS;
const rawSet = async (kind = 'positives') => JSON.parse(JSON.stringify(await sealedSet(kind)));
const rejectsAt = (path) => (e) => e instanceof CorruptResultSetError
  && e.issues.some((i) => i.code === 'array-too-long' && i.path === path);

// Independent oracle: every array a Result Set schema row declares, as a CONCRETE pointer (index 0
// for every array hop) -> the row's own `max` (or `exact`). Walked here from `TYPES` directly, not
// via any helper of the module under test.
function schemaArrayPaths() {
  const out = [];
  const visitType = (name, path) => {
    const def = TYPES.get(name);
    for (const [field, spec] of Object.entries(def.fields)) visitSpec(spec, `${path}/${field}`);
    if (def.custom === 'evidenceByMode') {
      for (const t of new Set(Object.values(EVIDENCE_BY_MODE))) visitType(t, `${path}/evidence`);
    }
  };
  const visitSpec = (spec, path) => {
    const s = typeof spec === 'string' ? { kind: 'object', of: spec } : spec;
    if (s.kind === 'array') { out.push([path, s.exact ?? s.max]); visitSpec(s.of, `${path}/0`); }
    else if (s.kind === 'object' && s.free !== true && s.delegated !== true) visitType(s.of, path);
  };
  visitType('ResultSet', '');
  return out;
}

test('every schema-declared array path is capture-checked against its own schema ceiling', () => {
  assert.equal(typeof V.arrayLimitFor, 'function', 'arrayLimitFor is exported for this check');
  const paths = schemaArrayPaths();
  assert.ok(paths.length > 30, `walked ${paths.length} array paths`);
  for (const [path, ceiling] of paths) {
    assert.ok(Number.isSafeInteger(ceiling), `${path} declares a ceiling`);
    assert.equal(V.arrayLimitFor(path), ceiling, path);
    assert.equal(V.arrayLimitFor(path.replace(/\/0(?=\/|$)/g, '/7')), ceiling, `${path} at another index`);
  }
  // The 5 pre-REM5 hand entries keep exactly their old values (they coincide with the schema rows).
  assert.equal(V.arrayLimitFor('/results'), RUN_OPTION_CEILINGS.maxResultsPerRun);
  assert.equal(V.arrayLimitFor('/ledger/units'), RUN_OPTION_CEILINGS.maxUnitsPerRun);
  assert.equal(V.arrayLimitFor('/ledger/units/3/taints'), MAX_UNIT_TAINTS);
  assert.equal(V.arrayLimitFor('/diagnostics/diagnostics'), RUN_OPTION_CEILINGS.maxRetainedDiagnostics);
  assert.equal(V.arrayLimitFor('/provenance/models'), 2 * ENGINE_LIMIT_CEILINGS.maxEntriesPerSelection);
  // The delegated `definition`: P2's two arrays, at their HARD ceilings (never the reader's limits).
  assert.equal(V.arrayLimitFor('/definition/selectionA/entries'), ENGINE_LIMIT_CEILINGS.maxEntriesPerSelection);
  assert.equal(V.arrayLimitFor('/definition/selectionB/entries/2/dbIds'), ENGINE_LIMIT_CEILINGS.maxExplicitElementsPerSelection);
  // No schema ceiling exists inside free-form / unknown fields: the generic fallback still applies.
  assert.equal(V.arrayLimitFor('/statistics/anything'), RUN_OPTION_CEILINGS.maxLedgerRecords);
  assert.equal(V.arrayLimitFor('/ledger/futureField'), RUN_OPTION_CEILINGS.maxLedgerRecords);
});

test('a stricter-than-fallback schema ceiling is enforced DURING capture, at the offending path', async () => {
  const CASES = [
    ['/outcome/environmentSensitiveCauses', (r) => { r.outcome.environmentSensitiveCauses = ['a', 'b', 'c', 'd']; }],
    ['/ledger/units/0/targets', (r) => {
      r.ledger.units[0].targets = Array.from({ length: RUN_OPTION_CEILINGS.maxTargetModelsPerUnit + 1 },
        (_, i) => ({ modelKey: `m${i}`, scope: 'model' }));
    }],
    ['/results/0/evidence/witness/point', (r) => { r.results[0].evidence.witness.point = [0, 0, 0, 0]; }],
    ['/provenance/models/0/scopeKinds', (r) => { r.provenance.models[0].scopeKinds = ['model', 'elements', 'model']; }],
    ['/definition/selectionA/entries', (r) => {
      r.definition.selectionA.entries = Array.from({ length: ENGINE_LIMIT_CEILINGS.maxEntriesPerSelection + 1 }, () => 0);
    }],
  ];
  for (const [path, mutate] of CASES) {
    const raw = await rawSet();
    mutate(raw);
    assert.throws(() => V.captureResultSet(raw, { limits }), rejectsAt(path), path);
  }
  // ...and exactly AT the ceiling capture still admits the array (the structural phase owns the rest).
  const atCeiling = await rawSet();
  atCeiling.outcome.environmentSensitiveCauses = ['a', 'b', 'c'];
  assert.doesNotThrow(() => V.captureResultSet(atCeiling, { limits }));
});
