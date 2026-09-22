// test/clashtest/results/resultSet.outcome.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveRunOutcome } from '../../../clashtest/results/resultSet.js';
import { emptyDiagnostics, ledgerWith, unit } from '../support/resultSetFixtures.mjs';

const base = { status: 'completed', freshness: 'current', results: [], reasons: [] };

test('coverage is full only for a plan with no planning gap and all leaves evaluated AND scope-equal', () => {
  const full = deriveRunOutcome({ ...base, diagnostics: emptyDiagnostics(),
    ledger: ledgerWith({ units: [unit('u1', 'evaluated'), unit('u0', 'split'), unit('u1a', 'evaluated')] }) });
  assert.equal(full.coverage, 'full');
  const gapped = deriveRunOutcome({ ...base, diagnostics: emptyDiagnostics(),
    ledger: ledgerWith({ units: [unit('u1', 'evaluated'), unit('u2', 'failed', { cause: 'capacity-exceeded' })] }) });
  assert.equal(gapped.coverage, 'partial');
  const preplan = deriveRunOutcome({ ...base, status: 'failed', diagnostics: emptyDiagnostics(),
    ledger: ledgerWith({ planExists: false, units: [], planningGaps: [{ phase: 'queued', cause: 'test-unavailable' }] }) });
  assert.equal(preplan.coverage, 'partial');                       // never vacuously full
});

// R21-2: the writer's `full` predicate must be the reader's. `validateResultSet` rejects
// `coverage: 'full'` unless every leaf is BOTH `evaluated` and `scopeProof: 'equal'`.
test('an evaluated leaf whose scope was not proven equal is never full coverage', () => {
  for (const proof of ['drift', 'unverifiable', 'not-checked']) {
    const o = deriveRunOutcome({ ...base, diagnostics: emptyDiagnostics(),
      ledger: ledgerWith({ units: [unit('u1', 'evaluated'), unit('u2', 'evaluated', { scopeProof: proof })] }) });
    assert.equal(o.coverage, 'partial', proof);
  }
  // a `split` parent is superseded by its leaves and is not checked at all
  const ok = deriveRunOutcome({ ...base, diagnostics: emptyDiagnostics(),
    ledger: ledgerWith({ units: [unit('u0', 'split', { scopeProof: 'not-checked' }), unit('u0a', 'evaluated')] }) });
  assert.equal(ok.coverage, 'full');
});

test('integrity is caveated by the upper bound or a duplicate-evidence conflict', () => {
  const diag = { ...emptyDiagnostics(), unclassifiedOccurrences: 3, completenessAffectingUpperBound: 3 };
  assert.equal(deriveRunOutcome({ ...base, diagnostics: diag, ledger: ledgerWith({}) }).integrity, 'caveated');
  const dup = deriveRunOutcome({ ...base, diagnostics: emptyDiagnostics(), ledger: ledgerWith({}),
    results: [{ flags: { duplicateEvidenceConflict: true } }] });
  assert.equal(dup.integrity, 'caveated');
});

test('environmentSensitiveCauses are exact, ascending, and drive the boolean', () => {
  const o = deriveRunOutcome({ ...base, diagnostics: { ...emptyDiagnostics(), geometryReadinessOccurrences: 1 },
    ledger: ledgerWith({ units: [
      unit('u1', 'failed', { cause: 'capacity-exceeded', capacityKind: 'bucket-capacity' }),
      unit('u2', 'failed', { cause: 'stale-placement' })] }) });
  assert.deepEqual(o.environmentSensitiveCauses, ['bucket-capacity', 'geometry-readiness', 'placement-contention']);
  assert.equal(o.environmentSensitive, true);
  const clean = deriveRunOutcome({ ...base, diagnostics: emptyDiagnostics(), ledger: ledgerWith({}) });
  assert.deepEqual(clean.environmentSensitiveCauses, []);
  assert.equal(clean.environmentSensitive, false);
});
