// test/clashtest/results/validateResultSet.invariants.test.mjs
//
// Task P5.5: `validateResultSet` -- unknown fields, cross-field invariants, order, digests. The
// untrusted-input validation boundary of the sealed Result Set (spec §13.6).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateResultSet, readResultSet, captureResultSet, SCHEMA_VERSION } from '../../../clashtest/results/validateResultSet.js';
import { SCHEMA_ROWS, UNKNOWN_FIELD_BYTES } from '../../../clashtest/results/resultSetSchema.js';
// NOTE: fixed from the plan's own literal `'../../support/schemaMutations.mjs'` (the same
// known plan-authoring typo pattern already fixed in Task P5.2 -- every sibling test dir's real
// convention is `../support/...`, one level up, not two).
import { schemaMutations } from '../support/schemaMutations.mjs';
import { canClaimNoClashes } from '../../../clashtest/results/claim.js';
import { CorruptResultSetError, ResultSetTooLargeError } from '../../../clashtest/errors.js';
import { ENGINE_LIMIT_DEFAULTS } from '../../../clashtest/options.js';
import { sealedSet, fakeSlicer, resealed } from '../support/resultSetFixtures.mjs';

const limits = ENGINE_LIMIT_DEFAULTS;

test('an engine-produced set validates unchanged', async () => {
  assert.deepEqual(validateResultSet(await sealedSet('completed-with-gaps'), { limits }), { ok: true, issues: [] });
});

// --- review Critical 3: EVERY structural-schema row gets a negative test, generated from the
// --- table itself, so a new field cannot be added without its negative test appearing. ---------
test('every reachable structural-schema row rejects its own violation', async () => {
  for (const kind of ['positives', 'schema-corpus']) {
    const valid = structuredClone(await sealedSet(kind));
    assert.equal(validateResultSet(valid, { limits }).ok, true, `${kind} must start valid`);

    const mutations = [...schemaMutations(valid)];
    assert.ok(mutations.length > 0);
    for (const { path, code, apply } of mutations) {
      const broken = apply(structuredClone(valid));
      const { ok, issues } = validateResultSet(broken, { limits });
      assert.equal(ok, false, `${kind} ${path} -> ${code} must be rejected`);
      assert.ok(issues.some((i) => i.code === code),
        `${kind} ${path}: expected ${code}, got ${JSON.stringify(issues)}`);
      assert.ok(issues.every((i) => Object.keys(i).sort().join() === 'code,path'), 'no values in issues');
      assert.ok(issues.length <= 20);
    }
  }
});

// The anti-drift assertion: a declared field that no fixture reaches is a field no negative test
// covers, so it must be named here deliberately rather than discovered later by an attacker.
// `schema-corpus` exists solely to carry every OPTIONAL branch (see the fixture table in P5.9).
test('every declared schema field is reachable in the fixture corpus, or explicitly waived', async () => {
  const corpus = await Promise.all(['positives', 'schema-corpus'].map((k) => sealedSet(k)));
  for (const set of corpus) {
    assert.deepEqual(validateResultSet(set, { limits }), { ok: true, issues: [] }, 'the corpus must be valid');
  }
  const reached = new Set(corpus.flatMap((s) => [...schemaMutations(s)].map((m) => `${m.type}.${m.field}`)));
  // Waived, each with a reason: `definition` is delegated to P2's `validateTest`; the other four
  // are documented fields with no declared inner shape, so there is no row to violate.
  const WAIVED = new Set(['ResultSet.definition', 'ResultSet.statistics', 'Provenance.runOptions',
    'Diagnostics.countsByReason', 'ClashResult.evidence']);
  const missing = SCHEMA_ROWS
    .map((r) => `${r.type}.${r.field}`)
    .filter((k) => !reached.has(k) && !WAIVED.has(k));
  assert.deepEqual(missing, [], `unreachable schema rows: ${missing.join(', ')}`);
});

// The five examples the review named, asserted by hand as a readability anchor on the generator.
test('the named malformed-value examples each get their own code', async () => {
  const CASES = [
    ['not-sealed',          (s) => { s.sealed = false; }],
    ['type-invalid',        (s) => { s.outcome.status = 42; }],
    ['number-out-of-range', (s) => { s.results[0].pair.first.dbId = -1; }],
    ['duplicate-model-key', (s) => { s.provenance.models.push({ ...s.provenance.models[0] }); }],
    ['null-not-allowed',    (s) => { s.ledger.units = null; }],
    ['container-invalid',   (s) => { s.ledger.units = { 0: s.ledger.units[0] }; }],
    ['missing-field',       (s) => { delete s.outcome.coverage; }],
    ['enum-invalid',        (s) => { s.ledger.units[0].scopeProof = 'maybe'; }],
    ['digest-syntax-invalid', (s) => { s.digests.pairSetDigest = 'sha256:nope'; }],
    ['array-length-invalid', (s) => { s.results[0].evidence.witness.point = [0, 1]; }],
    ['string-too-long',     (s) => { s.provenance.models[0].modelKey = 'm'.repeat(2048); }],
    ['literal-invalid',     (s) => { s.provenance.placementVerified = true; }],
  ];
  for (const [code, mutate] of CASES) {
    const set = structuredClone(await sealedSet('positives'));
    mutate(set);
    assert.ok(validateResultSet(set, { limits }).issues.some((i) => i.code === code),
      `${code}: ${JSON.stringify(validateResultSet(set, { limits }).issues)}`);
  }
});

// Review question 1: the validator is not the untrusted boundary, and says so loudly.
test('validateResultSet refuses an uncaptured object instead of traversing it', async () => {
  const captured = structuredClone(await sealedSet('positives'));
  let invoked = 0;
  const hostile = { ...captured };
  Object.defineProperty(hostile, 'ledger', { get() { invoked += 1; return {}; }, enumerable: true, configurable: true });
  assert.throws(() => validateResultSet(hostile, { limits }),
    (e) => e instanceof TypeError && e.code === 'ERR_UNCAPTURED_INPUT');
  assert.equal(invoked, 0, 'the getter was never invoked');
  for (const bad of [null, undefined, [], 'set', Object.create({ ledger: {} })]) {
    assert.throws(() => validateResultSet(bad, { limits }),
      (e) => e instanceof TypeError && e.code === 'ERR_UNCAPTURED_INPUT', String(bad));
  }
  assert.equal(validateResultSet(captured, { limits }).ok, true);   // a captured copy passes
});

const CORRUPTIONS = [
  ['coverage-not-full',        (s) => { s.outcome.coverage = 'full'; }],
  ['completed-with-fatal-cause', (s) => { s.ledger.units[0].cause = 'internal-error'; }],
  ['definition-digest-mismatch', (s) => { s.definition = null; }],
  ['owner-not-in-ledger',      (s) => { s.results[0].pair.second.dbId = 424242; }],
  ['result-order',             (s) => { s.results.reverse(); }],
  ['duplicate-result-id',      (s) => { s.results.push({ ...s.results[0] }); }],
  ['result-unit-invalid',      (s) => { s.results[0].unitId = 'no-such-unit'; }],
  ['evaluated-as-mismatch',    (s) => { s.results[0].evaluatedAs = { source: s.results[0].pair.second, target: s.results[0].pair.first }; }],
  ['mode-mismatch',            (s) => { s.results[0].mode = 'containment'; }],
  ['unknown-field-closed-type', (s) => { s.results[0].type = 'volume-overlap'; }],   // errata E1: `type` is unknown
  ['unreachable-flag-invalid', (s) => { s.results[0].flags = { unreachableOwner: true }; }],
  // NOTE: fixed from the plan's own literal draft, which used the nonexistent
  // `definition.selections.A.entries` -- the real, shipped P2 `ClashTestDefinition` schema
  // (`clashtest/definition/validate.js`) uses flat `selectionA`/`selectionB` keys, never a nested
  // `selections: {A, B}` object (verified directly against `DEFINITION_KEYS` and `checkDefinition`).
  ['definition-invalid',      (s) => { s.definition.selectionA.entries = []; }],          // fails P2 validateTest
  ['result-id-mismatch',      (s) => { s.results[0].resultId = `${s.results[0].resultId}x`; }],
  // --- rows the earlier draft claimed but never exercised (review Important 4) ------------------
  ['pair-space-inconsistent', (s) => { s.ledger.emptyOperand = true; }],                  // emptyOperand with pairSpaceTotal > 0
  ['pair-space-inconsistent', (s) => { s.ledger.pairSpaceTotal += 1; }],                  // != sum of leaf pairSpaceWeight
  ['result-unit-coverage',    (s) => { s.ledger.units[0].sourceRootDbIds = [999]; }],     // unit no longer covers its own result
  ['result-unit-coverage',    (s) => { s.ledger.units[0].targets = [{ modelKey: 'MB', scope: 'roots', rootDbIds: [4242] }]; }],
  ['model-not-in-provenance', (s) => { s.provenance.models = s.provenance.models.filter((m) => m.modelKey !== s.provenance.models[1].modelKey); }],
  // Task-review finding (2026-09-22, Important, confirmed): `model-not-in-provenance`'s model-key
  // collection was missing two ledger-resident, schema-declared sources -- `unresolvedSelections[].
  // modelKey` (nullable) and `warnings[].modelKey` (optional). Both validated `{ok: true}` before
  // the fix, with a phantom modelKey mentioned nowhere in `provenance.models`.
  ['model-not-in-provenance', (s) => { s.ledger.unresolvedSelections = [{ selectionRole: 'A', modelKey: 'urn:ghost', cause: 'element-unresolvable', dbIds: [1] }]; }],
  ['model-not-in-provenance', (s) => { s.ledger.warnings = [{ code: 'w', modelKey: 'urn:ghost' }]; }],
  // P5 final whole-branch review, CT-1 (fixed): `model-not-in-provenance`'s model-key collection
  // was also missing `ledger.units[].taints[].modelKey` (nullable) -- a phantom modelKey injected
  // via a unit's taints[] array validated `{ok: true}` before the fix.
  ['model-not-in-provenance', (s) => { s.ledger.units[0].taints = [{ kind: 'unit', modelKey: 'urn:ghost', dbId: null, reason: 'r', occurrences: 1 }]; }],
  ['coverage-not-full',       (s) => { s.outcome.coverage = 'full'; s.ledger.units = s.ledger.units.filter((u) => u.kind === 'split'); }],
  ['root-cls-invalid',        (s) => { delete s.ledger.rootOwners[0].owners[0].cls; }],
  ['root-cls-invalid',        (s) => { s.ledger.rootOwners[0].owners[0].cls = 'X'; }],
  // the DEFENSIVE re-check (capture owns the real enforcement -- P5.4); no literal budget here
  ['unknown-field-bytes',     (s) => { s.ledger.futureField = 'x'.repeat((limits.maxUnknownFieldBytes ?? UNKNOWN_FIELD_BYTES) + 1); }],
  // codex-review finding (2026-09-22, security, confirmed): the SAME ownerDbId claimed by two
  // DIFFERENT roots of the same model is a cross-row inconsistency no single array's own `uniqueBy`
  // can see (`RootOwners.owners` is unique by rootDbId; `RootOwnerRow.ownerDbIds` is unique only
  // WITHIN one root). Reproduced directly against `validateResultSet` before the fix (silently
  // accepted, `{ok: true, issues: []}`).
  ['duplicate-owner-dbid',    (s) => { s.ledger.rootOwners[0].owners.push({ rootDbId: 999999, ownerDbIds: [100], cls: 'A' }); }],
];

test('each corruption is rejected with its own code, even when digests are recomputed consistently', async () => {
  for (const [code, mutate] of CORRUPTIONS) {
    const set = await resealed(mutate, 'positives');          // re-digested so digests agree
    const { ok, issues } = validateResultSet(set, { limits });
    assert.equal(ok, false, code);
    assert.ok(issues.some((i) => i.code === code), `${code}: got ${JSON.stringify(issues)}`);
    assert.ok(issues.every((i) => !('value' in i)), 'no values in issues');
    assert.ok(issues.length <= 20);
  }
});

test('a tampered digest is caught', async () => {
  const set = structuredClone(await sealedSet('positives'));
  set.results[0].flags = { witnessUnavailable: true };
  assert.ok(validateResultSet(set, { limits }).issues.some((i) => i.code === 'digest-mismatch'));
});

test('an unknown digestVersion is NOT compared and never reported as a mismatch', async () => {
  // §13.6: "a digestVersion the engine does not know is not compared and the set is treated as
  // unverifiable for comparison, never current-claimable" -- it is not a corruption finding.
  const set = structuredClone(await sealedSet('positives'));
  set.digests = { ...set.digests, digestVersion: 99, pairSetDigest: 'sha256:' + '0'.repeat(64) };
  const { ok, issues } = validateResultSet(set, { limits });
  assert.equal(ok, true, 'valid-but-unverifiable is NOT a corruption finding');
  assert.deepEqual(issues, []);
  // The refusal is the CLAIM PREDICATE's, not the validator's (review Critical 2). The conjunct
  // itself is proven on an empty-results claimable set in `claim.test.mjs`; asserting it here on
  // `positives` would prove nothing, because its non-empty results already block the claim.
  const clean = structuredClone(await sealedSet('completed-clean'));
  assert.deepEqual(clean.results, []);
  assert.equal(canClaimNoClashes(clean, 'current'), true);
  clean.digests = { ...clean.digests, digestVersion: 99 };
  assert.equal(canClaimNoClashes(clean, 'current'), false, 'an unverifiable digest is never claimable');
  assert.equal(validateResultSet(clean, { limits }).ok, true, 'and still not corrupt');
});

test('the defensive unknown-field re-check is charged over ALL open types together, not per field', async () => {
  // Enforcement lives in CAPTURE (P5.4, review Critical 1). This asserts only that the validator's
  // backstop sums the same way -- one budget across every open type, never one budget per field.
  const third = Math.floor((limits.maxUnknownFieldBytes ?? UNKNOWN_FIELD_BYTES) / 3) - 64;
  const under = await resealed((s) => {
    s.ledger.a = 'x'.repeat(third); s.provenance.b = 'y'.repeat(third);
  }, 'positives');
  assert.equal(validateResultSet(under, { limits }).ok, true);
  const over = await resealed((s) => {
    s.ledger.a = 'x'.repeat(third); s.provenance.b = 'y'.repeat(third); s.outcome.c = 'z'.repeat(third + 256);
  }, 'positives');
  assert.ok(validateResultSet(over, { limits }).issues.some((i) => i.code === 'unknown-field-bytes'));
});

test('completed-with-gaps keeps its non-fatal causes and reasons on read-back', async () => {
  const GAPS = [['failed', 'capacity-exceeded'], ['failed', 'extraction-limit'], ['failed', 'object-tree-unavailable'],
    ['failed', 'stale-placement'], ['failed', 'unit-cap'], ['not-run', 'target-too-large'],
    ['failed', 'model-evicted'], ['skipped', 'model-evicted'], ['discarded', 'scope-unverifiable']];
  for (const [outcome, cause] of GAPS) {
    const set = await resealed((s) => { s.ledger.units[1] = { ...s.ledger.units[1], outcome, cause, scopeProof: 'not-checked' }; s.outcome.coverage = 'partial'; }, 'completed-with-gaps');
    assert.deepEqual(validateResultSet(set, { limits }), { ok: true, issues: [] }, `${outcome}:${cause}`);
  }
});

test('unreachableOwner positives stay valid on readback', async () => {
  const set = await sealedSet('unreachable-positive');
  assert.equal(validateResultSet(set, { limits }).ok, true);
  const broken = await resealed((s) => { s.ledger.unreachablePopulation[0].ownerDbIds = []; }, 'unreachable-positive');
  assert.ok(validateResultSet(broken, { limits }).issues.some((i) => i.code === 'owner-not-in-ledger'));
});

test('an open-type unknown field survives verbatim with equal digests', async () => {
  const set = await resealed((s) => { s.ledger.futureField = { a: 1 }; s.vendorNote = 'ok'; }, 'positives');
  assert.equal(validateResultSet(set, { limits }).ok, true);
  const read = await readResultSet(structuredClone(set), { limits, slicer: fakeSlicer() });
  assert.deepEqual(read.ledger.futureField, { a: 1 });
  assert.equal(read.vendorNote, 'ok');
  assert.equal(read.digests.ledgerDigest, set.digests.ledgerDigest);
});

test('readResultSet rejects (never throws synchronously) and freezes what it returns', async () => {
  const bad = structuredClone(await sealedSet('positives'));
  bad.results.reverse();
  const p = readResultSet(bad, { limits, slicer: fakeSlicer() });
  assert.ok(p instanceof Promise);
  await assert.rejects(p, CorruptResultSetError);
  const big = structuredClone(await sealedSet('many-results'));
  await assert.rejects(readResultSet(big, { limits: { ...limits, maxCapturedNodes: 16 }, slicer: fakeSlicer() }), ResultSetTooLargeError);
  const good = await readResultSet(structuredClone(await sealedSet('positives')), { limits, slicer: fakeSlicer() });
  assert.equal(Object.isFrozen(good.results[0]), true);
});

test('a forged but self-consistent set is accepted (documented limit)', async () => {
  const forged = await resealed((s) => { s.provenance.libraryVersion = 'forged'; }, 'positives');
  assert.equal(validateResultSet(forged, { limits }).ok, true);
});

// Ruling B (P5.5 dispatch / progress.md, "P5.5 must recapture migration output before
// re-validation"): `applyMigration` only shape-checks the TOP-LEVEL `schemaVersion` of its own
// migration function's return value (P5.4, by design). A hostile accessor NESTED below the top
// level of that same return value must still never fire -- `readResultSet`'s own pipeline now runs
// migration output back through `captureResultSet` (never `assertCaptured` alone, which only
// inspects the ROOT's own descriptors) before the structural walk ever touches it.
//
// This is asserted directly on `captureResultSet`, the exact function `readResultSet` calls for
// the recapture, given a value SHAPED like a migration's return (its own `schemaVersion` already
// at the real `SCHEMA_VERSION`, matching `applyMigration`'s own postcondition) with a hostile
// accessor nested below the top level -- NOT driven through the full `readResultSet`/
// `applyMigration` pipeline end to end, because `SCHEMA_VERSION` is 1 today, so `[1,
// SCHEMA_VERSION)` is empty and that pipeline's migration branch is unreachable in practice (the
// same limitation Task P5.4's own pure-dispatcher tests document and work around with an injected
// `currentVersion` -- not usable here, since `captureResultSet`'s own schema-version gate is NOT
// injectable and always checks against the real `SCHEMA_VERSION`).
// codex-review finding (2026-09-22, code review of resultSetSchema.js, Critical, confirmed): the
// `definition` field is marked `delegated` (P2's `validateTest` owns its deep shape), but the
// generic walk used to `continue` UNCONDITIONALLY for a delegated field -- so a primitive or array
// `definition` received NO check at all (`checkShapeAndUnknownFields` itself only called
// `validateTest` when `typeof set.definition === 'object'`, which a plain-old `definition = 42`
// never reaches, and an ARRAY does — worse, `validateTest` would then run on an array too).
// Reproduced directly before the fix: `set.definition = 42` on an otherwise-valid set validated as
// `{ok: true, issues: []}`.
test('a delegated field (definition) still gets a container-shape check before validateTest ever runs', async () => {
  for (const bad of [42, 'x', true, []]) {
    const set = structuredClone(await sealedSet('completed-clean'));
    set.definition = bad;
    const { ok, issues } = validateResultSet(set, { limits });
    assert.equal(ok, false, JSON.stringify(bad));
    assert.deepEqual(issues, [{ path: '/definition', code: 'container-invalid' }], JSON.stringify(bad));
  }
});

// codex-review finding (2026-09-22, code review of resultSetSchema.js, High, confirmed): `name in
// fields` (the closed-type unknown-field check) and `name in value` (the required-field presence
// check) both walk the PROTOTYPE chain, not just own properties -- so an own, enumerable key
// literally named `constructor`, `toString`, `hasOwnProperty` or `__proto__` was treated as "already
// a declared field", silently bypassing `unknown-field-closed-type` on every closed type in the
// schema. Fixed with `Object.hasOwn` throughout. Reproduced directly before the fix: an own
// `constructor` key on a closed `ElementRef` validated with an empty issues array.
test('a key colliding with an inherited Object.prototype member is still unknown-field-closed-type', async () => {
  const set = structuredClone(await sealedSet('positives'));
  set.results[0].pair.first.constructor = 'smuggled';
  const { ok, issues } = validateResultSet(set, { limits });
  assert.equal(ok, false);
  assert.ok(issues.some((i) => i.code === 'unknown-field-closed-type' && i.path.endsWith('/constructor')),
    JSON.stringify(issues));
});

test('captureResultSet (the recapture readResultSet performs on migration output) rejects a NESTED hostile accessor without invoking it', () => {
  let invoked = 0;
  const migrationOutputShaped = {
    schemaVersion: SCHEMA_VERSION,
    ledger: Object.defineProperty({}, 'poison',
      { get() { invoked += 1; return 'x'; }, enumerable: true, configurable: true }),
  };
  assert.throws(() => captureResultSet(migrationOutputShaped, { limits }),
    (e) => e instanceof CorruptResultSetError && e.issues.some((i) => i.code === 'accessor'));
  assert.equal(invoked, 0, 'the nested getter was never invoked by the recapture');
});
