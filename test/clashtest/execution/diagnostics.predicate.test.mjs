// test/clashtest/execution/diagnostics.predicate.test.mjs
//
// P4.1: the ONE completeness predicate (spec §12.3) plus the AC-10 drift guard against `collision/`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isCompletenessAffecting, KNOWN_DIAGNOSTIC_REASONS, NON_COMPLETENESS_AFFECTING_REASONS,
} from '../../../clashtest/execution/diagnostics.js';

test('exactly two known reasons are non-completeness-affecting (informational)', () => {
  const informational = ['witness-unavailable', 'fragment-null-geometry'];
  assert.deepEqual([...NON_COMPLETENESS_AFFECTING_REASONS], informational);
  for (const reason of KNOWN_DIAGNOSTIC_REASONS) {
    assert.equal(isCompletenessAffecting(reason), !informational.includes(reason), reason);
  }
});

test('fragment-null-geometry is informational; the ordinary fragment-not-loaded still counts', () => {
  assert.ok(KNOWN_DIAGNOSTIC_REASONS.has('fragment-null-geometry'));
  assert.equal(isCompletenessAffecting('fragment-null-geometry'), false);
  assert.equal(isCompletenessAffecting('fragment-not-loaded'), true);
  assert.equal(isCompletenessAffecting('fragment-owner-unresolvable'), true);
});

test('all four clearance reasons count (the M2.1 carve-out does not transfer)', () => {
  for (const reason of ['clearance-invalid-transform', 'clearance-anisotropic-scale-unsupported',
    'clearance-hard-clash-precheck-inconclusive', 'clearance-distance-unavailable']) {
    assert.equal(isCompletenessAffecting(reason), true);
    assert.ok(KNOWN_DIAGNOSTIC_REASONS.has(reason));
  }
});

test('an unknown or non-string reason fails safe to true and never throws', () => {
  for (const reason of ['a-future-library-reason', '', 'witness-unavailable ', 'WITNESS-UNAVAILABLE',
    undefined, null, 0, {}, [], Symbol.iterator]) {
    assert.equal(isCompletenessAffecting(reason), true);
  }
});

const COLLISION_DIR = fileURLToPath(new URL('../../../collision/', import.meta.url));
function* jsFilesUnder(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* jsFilesUnder(full);
    else if (entry.endsWith('.js')) yield full;
  }
}

test('collision/ gains no reason literal the known-reason table lacks (AC-10 drift guard)', () => {
  // Matches a `reason: 'literal'` property in library source. A computed `reason: d.reason`
  // forwards an already-listed literal and is deliberately not matched.
  //
  // DEVIATION FROM PLAN SKETCH: the plan's original matcher covered only this object-literal
  // shape, but a large share of `collision/query/*.js` and `collision/viewer/*.js` instead emit
  // diagnostics through small call-site helpers (`pushDiagnostic('reason', ...)`,
  // `addDiagnostic('reason', ...)`) whose first positional argument IS the reason literal — e.g.
  // `collision/viewer/ViewerModelAdapter.js:245` (`pushDiagnostic('fragment-not-loaded', ...)`) and
  // `collision/query/ContainmentQuery.js:346` (`addDiagnostic('non-manifold-component')`). Against
  // the real `collision/` tree the plan's matcher finds only 12 literals post-`kind`-filtering,
  // tripping its own `found.size >= 15` sanity floor ("the matcher is broken") on legitimate,
  // already-classified reasons — a provable failure of the sketch, not of this table. Broadened to
  // also match the call-site-helper shape so the guard covers both ways the library writes a reason.
  const found = new Set();
  for (const file of jsFilesUnder(COLLISION_DIR)) {
    const text = readFileSync(file, 'utf8');
    for (const [, , lit] of text.matchAll(/\breason:\s*(['"])([a-z0-9-]+)\1/g)) found.add(lit);
    for (const [, , lit] of text.matchAll(/\b[a-zA-Z]*[Dd]iagnostic\(\s*(['"])([a-z0-9-]+)\1/g)) found.add(lit);
  }
  // CapacityExceededError `kind`s share the property name but are not diagnostics.
  for (const kind of ['bucket-capacity', 'call-wide-unique-fragment-precheck',
    'whole-model-enumeration', 'tlas-candidate-budget', 'clearance-narrow-phase-budget']) found.delete(kind);
  assert.ok(found.size >= 15, `the scan found only ${found.size} literals — the matcher is broken`);
  assert.deepEqual([...found].filter((r) => !KNOWN_DIAGNOSTIC_REASONS.has(r)).sort(), [],
    'classify each new reason in KNOWN_DIAGNOSTIC_REASONS deliberately');
});
