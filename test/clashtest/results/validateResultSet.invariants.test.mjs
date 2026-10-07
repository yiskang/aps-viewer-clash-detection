// test/clashtest/results/validateResultSet.invariants.test.mjs
//
// Task P5.5: `validateResultSet` -- unknown fields, cross-field invariants, order, digests. The
// untrusted-input validation boundary of the sealed Result Set (spec §13.6).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateResultSet, validateResultSetSteps, readResultSet, captureResultSet, SCHEMA_VERSION,
} from '../../../clashtest/results/validateResultSet.js';
import { SCHEMA_ROWS, UNKNOWN_FIELD_BYTES } from '../../../clashtest/results/resultSetSchema.js';
// NOTE: fixed from the plan's own literal `'../../support/schemaMutations.mjs'` (the same
// known plan-authoring typo pattern already fixed in Task P5.2 -- every sibling test dir's real
// convention is `../support/...`, one level up, not two).
import { schemaMutations } from '../support/schemaMutations.mjs';
import { canClaimNoClashes } from '../../../clashtest/results/claim.js';
import { deriveRunOutcome } from '../../../clashtest/results/resultSet.js';
import { makeResultId } from '../../../clashtest/identity/ids.js';
import { computeSemanticDigest, normalizeDefinition } from '../../../clashtest/definition/normalize.js';
import { CorruptResultSetError, ResultSetTooLargeError } from '../../../clashtest/errors.js';
import { ENGINE_LIMIT_DEFAULTS, ENGINE_LIMIT_CEILINGS, resolveEngineLimits } from '../../../clashtest/options.js';
import { canonicalJson } from '../../../clashtest/util/canonical.js';
import { sealedSet, fakeSlicer, resealed, sharedRootPlan, widePlan, MODEL_A, MODEL_B } from '../support/resultSetFixtures.mjs';
import { planSplit } from '../../../clashtest/planning/splitting.js';
import { makeSplitFixture, makeSyntheticEnumerator, defOf, snapshotOf } from '../support/syntheticModels.mjs';
import { createPlan } from '../../../clashtest/planning/planner.js';
import { RUN_OPTION_DEFAULTS } from '../../../clashtest/options.js';

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
  // P5-REM (Item 1, docs/reviews/2026-09-22-federated-clash-test-core-p5-owner-decision-brief.md):
  // before this fix, altering `outcome.integrity` without changing the diagnostics/results that
  // determine its true value validated `{ok: true}` -- the false-negative the owner brief
  // demonstrated. `positives`' baseline `integrity` is correctly `'clean'`
  // (`completenessAffectingUpperBound: 0`, no `duplicateEvidenceConflict` flag); bumping the upper
  // bound to a positive number without touching `outcome.integrity` reproduces that exact failure
  // mode literally.
  ['integrity-not-derived',  (s) => { s.diagnostics.completenessAffectingUpperBound = 1; }],
  // Two independent corruptions for the ONE `environment-sensitive-mismatch` code (matching how
  // `coverage-not-full` is the one code for the whole `coverage` axis): the boolean disagreeing with
  // the derived causes, and -- separately, with the boolean left alone -- the causes array itself
  // disagreeing. `positives`' baseline correctly derives `environmentSensitive: true,
  // environmentSensitiveCauses: ['bucket-capacity']` (unit `u2`'s `capacityKind: 'bucket-capacity'`).
  ['environment-sensitive-mismatch', (s) => { s.outcome.environmentSensitive = false; }],
  ['environment-sensitive-mismatch', (s) => { s.outcome.environmentSensitiveCauses = []; }],
  // P5-REM (Item 2, docs/reviews/2026-09-22-federated-clash-test-core-p5-owner-decision-brief.md):
  // before this fix, flipping a result's stored `pair.first`/`pair.second` and recomputing its
  // `resultId` to stay self-consistent with the flipped `pair` validated `{ok: true}` -- silently
  // letting one physical clash be represented under two different (opposite-orientation) identities.
  // `result-id-mismatch` does not also fire here because the `resultId` is deliberately recomputed
  // against the flipped pair.
  ['pair-orientation-invalid', (s) => {
    const flipped = { first: s.results[0].pair.second, second: s.results[0].pair.first };
    s.results[0].pair = flipped;
    s.results[0].resultId = makeResultId(s.testRef.testId, s.testRef.semanticDigest, flipped);
  }],
  // P5-REM2 (H1, docs/reviews/2026-09-22-federated-clash-test-core-p5-independent-review.md;
  // adjudication docs/reviews/2026-09-22-federated-clash-test-core-p5-independent-review-
  // adjudication.md, CONFIRMED/blocking; owner ruling 2026-09-22): before this fix, mutating only
  // `definition.mode` -- leaving `testRef` untouched -- validated `{ok: true, issues: []}`,
  // reproduced by the independent review directly against a sealed `completed-clean` fixture.
  ['semantic-digest-mismatch', (s) => { s.definition.mode = 'containment'; }],
  // P5-REM2 (H1, same review/adjudication/authorization): before this fix, mutating only
  // `definition.testId` -- leaving `testRef` untouched -- validated `{ok: true, issues: []}` too.
  ['definition-identity-mismatch', (s) => { s.definition.testId = 'OTHER'; }],
  // P5-REM2 (H2, same review/adjudication/authorization): before this fix, nulling
  // `definition`/`testRef.revision`/`testRef.semanticDigest` while leaving every OTHER field
  // (`status`, `coverage`, ledger, `results`) at its ordinary post-resolution ('positives') value
  // validated `{ok: true, issues: []}` and returned `true` from `canClaimNoClashes` -- reproduced by
  // the independent review directly. `positives`' own baseline already disagrees with the §13.1
  // pre-resolution shape on several independent axes at once (status: 'completed' not
  // failed/cancelled; `ledger.planExists`/`units`/`planningGaps`/`pairSpaceTotal` all non-pre-
  // resolution; non-empty `results`), so this one mutation alone covers more than the required two
  // distinct sub-conditions.
  ['pre-resolution-shape-invalid', (s) => {
    s.definition = null; s.testRef.revision = null; s.testRef.semanticDigest = null;
  }],
  // P5-REM2 (M1, same review/adjudication/authorization): the missing reverse direction --
  // `outcome.coverage: 'partial'` recorded while the ledger's own facts derive `'full'`. `positives`'
  // own `u2` is `failed` (so its baseline facts derive `'partial'`, not `'full'`); flipping `u2` to
  // `evaluated`/`scopeProof: 'equal'` (capacityKind/cause left untouched, so `environmentSensitive`
  // stays correctly derived) makes every leaf evaluated, so the facts now derive `'full'` while
  // `coverage` stays the fixture's own already-`'partial'` value -- a real (`!==` reversed)
  // mismatch, not merely restating an already-true derivation.
  ['coverage-not-full', (s) => {
    s.ledger.units[1] = { ...s.ledger.units[1], outcome: 'evaluated', scopeProof: 'equal' };
    s.outcome.coverage = 'partial';
  }],
  // P5-REM3 (owner disposition item 1 of the P5-REM2 follow-up findings; owner ruling 2026-09-22,
  // verbatim in .superpowers/sdd/p5-result-set/task-P5-REM3-brief.md): `semantic-digest-mismatch`
  // only proves the recorded digest matches HASHING the embedded `definition` -- it never proves
  // `definition.selectionA`/`selectionB` is itself in normalized/canonical form. A duplicated `dbIds`
  // entry within one `selectionA` "elements" entry is exactly the kind of tampering a real
  // normalization pass would dedupe (`normalizeSelectionSteps`'s `unionInto`); the tampered,
  // undeduplicated form self-consistently digests to its OWN (different) `semanticDigest`, so
  // `testRef.semanticDigest` is recomputed from the tampered `definition` here to keep
  // `semantic-digest-mismatch` from ALSO firing and diluting this test's focus on the new check.
  ['definition-not-normalized', (s) => {
    s.definition.selectionA = { entries: [{ kind: 'elements', modelKey: MODEL_A, dbIds: [100, 100, 101] }] };
    s.testRef.semanticDigest = computeSemanticDigest(s.definition);
  }],
  // P5-REM3 (same authorization): two separate `entries` rows for the SAME `modelKey` in one
  // selection -- a real normalization pass merges same-model "elements" entries into one
  // (`normalizeSelectionSteps`'s `byModel` map keyed by `modelKey`); the tampered, unmerged form is
  // not a fixed point of `normalizeDefinition` even though it digests self-consistently.
  ['definition-not-normalized', (s) => {
    s.definition.selectionB = { entries: [
      { kind: 'elements', modelKey: MODEL_B, dbIds: [200] },
      { kind: 'elements', modelKey: MODEL_B, dbIds: [201] },
    ] };
    s.testRef.semanticDigest = computeSemanticDigest(s.definition);
  }],
  // P5-REM4 (item 1; codex-review finding, .superpowers/sdd/p5-result-set/task-P5-REM3-report.md,
  // "UnitTarget.rootDbIds not validated against scope, enabling a false coverage:'full' via an
  // empty-range unit"; owner ruling 2026-09-23: "Validation must fail closed when persisted unit
  // targets cannot support the claimed scope/coverage. A malformed or empty-range unit must not
  // permit a false coverage:'full' result"). `positives`' u2 ('u2', 'failed') has no results of its
  // own referencing it, so mutating its range shape cannot also trip any result-linkage check --
  // isolating these four sub-conditions of the new `unit-range-invalid` rule from every other code.
  // (a) an empty `rootDbIds` under `scope: 'roots'`:
  ['unit-range-invalid', (s) => { s.ledger.units[1].targets = [{ modelKey: MODEL_B, scope: 'roots', rootDbIds: [] }]; }],
  // (b) `rootDbIds` present under `scope: 'model'` (the writer's own construction rule --
  // `planning/ledger.js`'s `normalizeUnitFields` -- throws on this shape, but nothing at the
  // untrusted read boundary re-checks it):
  ['unit-range-invalid', (s) => { s.ledger.units[1].targets = [{ modelKey: MODEL_B, scope: 'model', rootDbIds: [40] }]; }],
  // (c) an empty `sourceRootDbIds` -- a unit that declares zero source roots:
  ['unit-range-invalid', (s) => { s.ledger.units[1].sourceRootDbIds = []; }],
  // (d) an empty `targets` array (codex-advisor finding during this task's own design review,
  // 2026-09-23: without this fourth sub-condition, a unit with non-empty source roots but NO
  // targets at all could still be `evaluated`/`scopeProof: 'equal'`/zero `pairSpaceWeight` and count
  // toward `derivedFull` above):
  ['unit-range-invalid', (s) => { s.ledger.units[1].targets = []; }],
  // P5-REM4 (item 2; codex-review finding, "diagnostics-counter accounting invariants ...
  // enabling a false integrity:'clean'"; owner ruling 2026-09-23: "Reconcile the persisted
  // diagnostic counters with the governing diagnostic facts so a tampered Result Set cannot produce
  // a false integrity:'clean' result"). `positives`' baseline diagnostics is `emptyDiagnostics()`
  // (every counter 0), so each mutation below breaks exactly one of the three reconciliation
  // sub-checks in isolation, without also touching `outcome.integrity` (still correctly 'clean') or
  // `completenessAffectingUpperBound` (still 0), so `integrity-not-derived` does not also fire.
  // (a) the Sigma invariant (Σ countsByReason[].count + omittedReasonOccurrences +
  // unclassifiedOccurrences === total), mirroring `execution/diagnostics.js`'s own
  // `createDiagnosticAggregator.snapshot()` internal assertion, re-checked here because nothing at
  // the untrusted read boundary previously did:
  ['diagnostics-counts-inconsistent', (s) => { s.diagnostics.total = 5; }],
  // (b) the upper-bound formula (completenessAffectingUpperBound === completenessAffectingCount +
  // unclassifiedOccurrences), also mirroring `snapshot()` exactly:
  ['diagnostics-counts-inconsistent', (s) => { s.diagnostics.completenessAffectingCount = 3; }],
  // (c) the retained-diagnostics reconciliation (codex-advisor finding during this task's own
  // design review, 2026-09-23: the two formulas above alone are NOT sufficient -- an attacker can
  // zero `completenessAffectingCount` and `completenessAffectingUpperBound` TOGETHER, self-
  // consistently, while the retained `diagnostics[]` array still carries a genuinely
  // completeness-affecting entry, producing a false `integrity: 'clean'` that neither (a) nor (b)
  // catches). This mutation adds one real, structurally valid, `completenessAffecting: true`
  // retained diagnostic while leaving every counter (`total`, `countsByReason`,
  // `completenessAffectingCount`, `completenessAffectingUpperBound`, `omittedReasonOccurrences`,
  // `unclassifiedOccurrences`) at its untouched baseline-zero value -- exactly the counterexample
  // that must now be rejected.
  ['diagnostics-counts-inconsistent', (s) => {
    s.diagnostics.diagnostics = [
      { scope: 'fragment', reason: 'fragment-not-loaded', completenessAffecting: true, attribution: 'element',
        fragment: { modelKey: MODEL_A, dbId: 100, fragId: 1, role: 'source' },
        occurrences: 1, unitIds: ['u1'] },
    ];
  }],
  // P5-REM4 (item 3; codex-review finding, "checkResultLinkage accepts a result whose unit has
  // outcome:'evaluated' without requiring kind:'leaf'"; owner ruling 2026-09-23: "Enforce the
  // existing linkage invariant that an evaluated result references the required leaf-kind unit.
  // Keep this narrowly scoped to validation/linkage"). `planning/ledger.js`'s own `recordOutcome`
  // enforces `kind: 'split' <=> outcome: 'split'` on the writer side (a split-kind record's outcome
  // is always exactly 'split', never settled to 'evaluated'), so `outcome: 'evaluated'` can only
  // legitimately occur on a `kind: 'leaf'` unit -- but nothing at the untrusted read boundary
  // re-checked that before this fix. `u1` stays `outcome: 'evaluated'` / `scopeProof: 'equal'`
  // (unchanged), so only `kind` is now inconsistent with it.
  ['result-unit-not-leaf', (s) => { s.ledger.units[0].kind = 'split'; }],
  // P5-REM5 (Finding A; owner ruling 2026-09-23: "Validation must reject an outcome:'evaluated'
  // unit that is not kind:'leaf' even when no result row links to it. The invariant applies to the
  // evaluated leaf set itself, not only result-linked units"). `u2` has NO linked result, so REM4's
  // per-result `result-unit-not-leaf` can never fire here -- only the new unconditional unit-level
  // check can. `scopeProof` stays 'not-checked', so coverage still derives 'partial' (unchanged).
  ['evaluated-unit-not-leaf', (s) => { s.ledger.units[1].kind = 'split'; s.ledger.units[1].outcome = 'evaluated'; }],
  // P5-REM5 (Finding B; owner ruling 2026-09-23: "Cross-validate unit target root IDs against
  // ledger.rootOwners so unowned or inconsistent roots cannot contribute to a valid coverage/full
  // clean claim"). All three mutate `u2` (no linked result, so no result-linkage code can fire):
  // (a) an unknown source root,
  ['unit-root-not-owned', (s) => { s.ledger.units[1].sourceRootDbIds = [999]; }],
  // (b) a source root that IS owned -- but under a DIFFERENT model's group (20 is MODEL_B's root;
  // u2's sourceModelKey is MODEL_A), so presence must be checked per model, not globally,
  ['unit-root-not-owned', (s) => { s.ledger.units[1].sourceRootDbIds = [20]; }],
  // (c) an unknown root in a `scope: 'roots'` target.
  ['unit-root-not-owned', (s) => { s.ledger.units[1].targets = [{ modelKey: MODEL_B, scope: 'roots', rootDbIds: [999] }]; }],
  // P5-REM6 (Findings C and D): defined as SPLIT_TOPOLOGY_CORRUPTIONS below and pushed onto this
  // array, so the shared loop also asserts each one alongside every earlier code.
];

// P5-REM6 (Findings C and D; owner rulings 2026-09-23). Every case rewrites `positives`' `u2` (the
// failed leaf with NO linked result, weight 5, bucket-capacity) and then `refreshDerived` re-derives
// every outcome axis the writer derives from the ledger (`pairSpaceTotal` over non-`split` units,
// coverage/integrity/environment via the real `deriveRunOutcome`) -- i.e. exactly what a forger
// with the writer's own code would do -- so NO pre-existing check (pair-space, coverage-not-full,
// environment-sensitive-mismatch, integrity-not-derived) can fire and each case is rejected by
// its new code ALONE. Before P5-REM6 every one of these validated `{ok: true, issues: []}`.
function refreshDerived(s) {
  s.ledger.pairSpaceTotal = s.ledger.units.filter((u) => u.outcome !== 'split')
    .reduce((n, u) => n + u.pairSpaceWeight, 0);
  const derived = deriveRunOutcome({ status: s.outcome.status, freshness: s.outcome.freshness,
    ledger: s.ledger, diagnostics: s.diagnostics, results: s.results, reasons: s.outcome.reasons });
  for (const k of ['coverage', 'integrity', 'environmentSensitive', 'environmentSensitiveCauses']) s.outcome[k] = derived[k];
}
// A child record copied from the ORIGINAL failed `u2` (same model, owned root 11, bucket-capacity),
// so root ownership and the environment-sensitive derivation are unaffected by the split itself.
const childOf = (u2, unitId, parentUnitId, pairSpaceWeight) =>
  ({ ...structuredClone(u2), kind: 'leaf', unitId, parentUnitId, pairSpaceWeight });
// `u2` rewritten as a split-marked parent (`kind`/`outcome` given), with `children` appended.
function splitU2(s, { kind = 'split', outcome = 'split', children = [] }) {
  const u2 = s.ledger.units[1];
  const made = children.map(([id, parent, w]) => childOf(u2, id, parent, w));
  s.ledger.units[1] = { ...u2, kind, outcome,
    ...(outcome === 'split' ? { cause: null, capacityKind: null, scopeProof: 'not-checked' } : {}) };
  s.ledger.units.push(...made);
  refreshDerived(s);
}
const SPLIT_TOPOLOGY_CORRUPTIONS = [
  // Finding C: the reverse of Finding A -- `kind: 'leaf'` with `outcome: 'split'`, children valid.
  ['unit-kind-outcome-mismatch', (s) => splitU2(s, { kind: 'leaf', children: [['u2.0', 'u2', 2], ['u2.1', 'u2', 3]] })],
  // Finding C, the rest of the biconditional: `kind: 'split'` with a settled non-evaluated outcome.
  ['unit-kind-outcome-mismatch', (s) => splitU2(s, { outcome: 'failed', children: [['u2.0', 'u2', 2], ['u2.1', 'u2', 3]] })],
  // Finding D (parent side): childless -- the recorded reproduction; its weight silently leaves
  // coverage and pair space, and refreshDerived makes the set derive `coverage: 'full'`.
  ['split-topology-invalid', (s) => splitU2(s, {})],
  // only one child (its weight alone does partition the parent's -- the COUNT is what is wrong)
  ['split-topology-invalid', (s) => splitU2(s, { children: [['u2.0', 'u2', 5]] })],
  // two children whose weights do not partition the parent's (2 + 2 != 5)
  ['split-topology-invalid', (s) => splitU2(s, { children: [['u2.0', 'u2', 2], ['u2.1', 'u2', 2]] })],
  // two children, but not the deterministic `${unitId}.0` / `${unitId}.1` ids
  ['split-topology-invalid', (s) => splitU2(s, { children: [['u2.a', 'u2', 2], ['u2.b', 'u2', 3]] })],
  // a third child
  ['split-topology-invalid', (s) => splitU2(s, { children: [['u2.0', 'u2', 2], ['u2.1', 'u2', 3], ['u2.2', 'u2', 0]] })],
  // Finding D (child side): an orphan whose parentUnitId resolves to no unit at all ...
  ['split-topology-invalid', (s) => { s.ledger.units.push(childOf(s.ledger.units[1], 'ghost.0', 'ghost', 0)); refreshDerived(s); }],
  // ... and a child whose parent exists but is an ordinary (evaluated) leaf, not a split.
  ['split-topology-invalid', (s) => { s.ledger.units.push(childOf(s.ledger.units[1], 'u1.0', 'u1', 0)); refreshDerived(s); }],
];
CORRUPTIONS.push(...SPLIT_TOPOLOGY_CORRUPTIONS);

// P5-REM7 (Findings F and G, ruled together; owner ruling 2026-09-23: "Fix together in P5 as one
// evaluated-coverage reconciliation invariant. Validation must prove that the persisted evaluated
// domain exactly satisfies the required question derived from the resolved definition ..."). Every
// mutation first makes EVERY leaf `evaluated`/`equal` (so the writer's own `deriveRunOutcome` derives
// `coverage: 'full'` -- the claim the reconciliation strengthens), then breaks exactly one link
// between the definition's question and the evaluated domain, then re-syncs everything a forger
// holding the writer's code would re-derive (`semanticDigest`, every `resultId`, `pairSpaceTotal`,
// coverage/integrity/environment) so no pre-existing check can be what rejects it. Each mutation is
// written against "the last unit" / "MODEL_A's root group" so it applies unchanged to both
// `positives` (the shared CORRUPTIONS loop) and the zero-result, claimable `completed-clean`.
// Before P5-REM7 every one of these validated `{ok: true, issues: []}` with `coverage: 'full'`.
const PHANTOM_MODEL = 'urn:phantom-model';
function allLeavesEvaluated(s) {
  s.ledger.units = s.ledger.units.map((u) => (u.outcome === 'split' ? u
    : { ...u, outcome: 'evaluated', scopeProof: 'equal', cause: null, capacityKind: null }));
}
function resyncDefinition(s) {
  s.testRef.semanticDigest = computeSemanticDigest(s.definition);
  for (const r of s.results) r.resultId = makeResultId(s.testRef.testId, s.testRef.semanticDigest, r.pair);
}
const ownersOf = (s, modelKey) => s.ledger.rootOwners.find((row) => row.modelKey === modelKey).owners;
const reconcile = (mutate) => (s) => { allLeavesEvaluated(s); mutate(s); resyncDefinition(s); refreshDerived(s); };
const COVERAGE_RECONCILIATION_CORRUPTIONS = [
  // F: a phantom EXTRA model added to a selection (the realistic variant: the real models are kept),
  // so the set evaluates only part of the question it now claims to answer in full.
  ['coverage-model-mismatch', reconcile((s) => { s.definition.selectionB.entries.push({ kind: 'model', modelKey: PHANTOM_MODEL }); })],
  // F, the recorded reproduction: both selections rewritten to phantom models (the definition's
  // models are unrepresented AND the ledger's real models are ones it no longer names).
  ['coverage-model-mismatch', reconcile((s) => {
    s.definition.selectionA = { entries: [{ kind: 'model', modelKey: `${PHANTOM_MODEL}-a` }] };
    s.definition.selectionB = { entries: [{ kind: 'model', modelKey: `${PHANTOM_MODEL}-b` }] };
  })],
  // A required model entirely omitted from the evaluated domain: MODEL_B (selectionB) has no
  // rootOwners row at all -- the planner emits one for every definition model, even a rootless one.
  ['coverage-model-mismatch', reconcile((s) => { s.ledger.rootOwners = s.ledger.rootOwners.filter((row) => row.modelKey !== MODEL_B); })],
  // ... and the reverse: a leaf evaluating a model the definition never asked about, through a
  // whole-model target (Finding B deliberately skips `scope: 'model'` targets; codex-advisor design
  // consult, 2026-09-23).
  ['coverage-model-mismatch', reconcile((s) => {
    s.ledger.units[s.ledger.units.length - 1].targets.push({ modelKey: PHANTOM_MODEL, scope: 'model' });
    s.provenance.models.push({ ...structuredClone(s.provenance.models[0]), modelKey: PHANTOM_MODEL });
  })],
  // G, the independently-refined reproduction: a split whose two children are topologically valid
  // (Finding D: ids `.0`/`.1`, weights partition the parent's) but BOTH re-evaluate the parent's first
  // source root, so the parent's second owned root (12) is never evaluated by any leaf.
  ['coverage-root-uncovered', reconcile((s) => {
    ownersOf(s, MODEL_A).push({ rootDbId: 12, ownerDbIds: [], cls: 'A' });
    const i = s.ledger.units.length - 1;
    const leaf = s.ledger.units[i];
    const w0 = Math.floor(leaf.pairSpaceWeight / 2);
    const child = (suffix, w) => ({ ...structuredClone(leaf), unitId: `${leaf.unitId}.${suffix}`, parentUnitId: leaf.unitId, pairSpaceWeight: w });
    s.ledger.units[i] = { ...leaf, kind: 'split', outcome: 'split', scopeProof: 'not-checked',
      sourceRootDbIds: [...leaf.sourceRootDbIds, 12] };
    s.ledger.units.push(child(0, w0), child(1, leaf.pairSpaceWeight - w0));
  })],
  // G, not split-specific: an ordinary leaf set that simply never evaluates one owned root (12).
  ['coverage-root-uncovered', reconcile((s) => { ownersOf(s, MODEL_A).push({ rootDbId: 12, ownerDbIds: [], cls: 'A' }); })],
  // Duplicated/overlapping ranges do not substitute for the missing root: a SECOND leaf repeating the
  // last leaf's exact range (with its own fabricated weight, re-summed into pairSpaceTotal) while
  // owned root 12 is still never evaluated.
  ['coverage-root-uncovered', reconcile((s) => {
    ownersOf(s, MODEL_A).push({ rootDbId: 12, ownerDbIds: [], cls: 'A' });
    const last = s.ledger.units[s.ledger.units.length - 1];
    s.ledger.units.push({ ...structuredClone(last), unitId: 'dup', pairSpaceWeight: 12 });
  })],
  // ... and the same on the TARGET side: B roots 20 and 21, every leaf targets only [20] (twice over).
  ['coverage-root-uncovered', reconcile((s) => {
    ownersOf(s, MODEL_B).push({ rootDbId: 21, ownerDbIds: [], cls: 'B' });
    for (const u of s.ledger.units) u.targets = [{ modelKey: MODEL_B, scope: 'roots', rootDbIds: [20] }];
  })],
  // Soundness of the reconciliation itself: relabelling MODEL_B's root as 'A' would empty the
  // B-role root set and make every root obligation vacuous -- a cls that contradicts the definition
  // (MODEL_B is named only by selectionB, kind 'model') is rejected.
  ['coverage-root-role-invalid', reconcile((s) => { ownersOf(s, MODEL_B)[0].cls = 'A'; })],
  // ... and a rootOwners model the definition does not name at all.
  ['coverage-model-mismatch', reconcile((s) => {
    s.ledger.rootOwners.push({ modelKey: PHANTOM_MODEL, owners: [] });
    s.provenance.models.push({ ...structuredClone(s.provenance.models[0]), modelKey: PHANTOM_MODEL });
  })],
  // A unit that puts a root in a role §6.3 never gives it: MODEL_B's B-only root 20 as a SOURCE
  // (a leaf evaluating B'->A' would satisfy nothing it claims to).
  ['coverage-root-role-invalid', reconcile((s) => {
    s.ledger.units.push({ ...structuredClone(s.ledger.units[s.ledger.units.length - 1]), unitId: 'rev',
      sourceModelKey: MODEL_B, sourceRootDbIds: [20], targets: [{ modelKey: MODEL_A, scope: 'roots', rootDbIds: [10] }] });
  })],
  // The class-C partner counterexample (codex-advisor design consult, 2026-09-23): same-model overlap,
  // A' = {10}, C = {30, 31}, B' = {20 of MODEL_B} -- every leaf of cells 1 and 2 is present (each C root
  // is a source against B' and a target of A'), plus a duplicate, but the C-C pair {30, 31} (cell 3b)
  // is never evaluated. A per-root "appeared somewhere" bit would accept it; per-partner-class
  // coverage does not.
  ['coverage-root-uncovered', reconcile((s) => {
    s.definition.selectionB.entries.unshift({ kind: 'elements', modelKey: MODEL_A, dbIds: [30, 31] });
    ownersOf(s, MODEL_A).push({ rootDbId: 30, ownerDbIds: [], cls: 'C' }, { rootDbId: 31, ownerDbIds: [], cls: 'C' });
    const base = s.ledger.units[s.ledger.units.length - 1];
    const leaf = (unitId, sourceRootDbIds, targets) => ({ ...structuredClone(base), unitId, sourceRootDbIds, targets });
    s.ledger.units = [...s.ledger.units.filter((u) => u.sourceRootDbIds.every((id) => id !== 10)),
      leaf('c1', [10], [{ modelKey: MODEL_A, scope: 'roots', rootDbIds: [30, 31] }, { modelKey: MODEL_B, scope: 'model' }]),
      leaf('c2', [30, 31], [{ modelKey: MODEL_B, scope: 'model' }]),
      leaf('c2dup', [30, 31], [{ modelKey: MODEL_B, scope: 'model' }])];
  })],
  // Ordered (`containment`) pairs: A = B = {MODEL_A}, C = {10, 11}; the single leaf 10 -> 11 covers
  // the unordered pair but not the ordered pair (11, 10) (§6.3: 3b runs both directions when
  // ordered), so both roots miss one required position.
  ['coverage-root-uncovered', reconcile((s) => {
    s.definition.mode = 'containment';
    s.definition.selectionB = { entries: [{ kind: 'model', modelKey: MODEL_A }] };
    s.ledger.rootOwners = [{ modelKey: MODEL_A, owners: [{ rootDbId: 10, ownerDbIds: [], cls: 'C' }, { rootDbId: 11, ownerDbIds: [], cls: 'C' }] }];
    const base = s.ledger.units[0];
    s.ledger.units = [{ ...structuredClone(base), unitId: 'o1', sourceRootDbIds: [10],
      targets: [{ modelKey: MODEL_A, scope: 'roots', rootDbIds: [11] }] }];
  })],
];
CORRUPTIONS.push(...COVERAGE_RECONCILIATION_CORRUPTIONS);

// P5-REM9 (candidate finding I, pair-level exact cover; owner rulings 2026-09-23: "pair-level coverage
// is the intended P5 invariant" and "Choose e1 ... arbitrary-subset blocks are not part of the intended
// legal persisted layout"). Every case below passes P5-REM7's root/partner-class reconciliation (every
// root meets every partner class) -- before P5-REM9 each validated `{ok: true}`, `coverage: 'full'`,
// claimable. The 2x2 question: A' = {1, 2} (MODEL_A) vs B' = {7, 8} (MODEL_B); same-model questions use
// C = {1, 2, 3, 4} of MODEL_A (selectionA = selectionB = MODEL_A whole).
const leafOf = (base, unitId, sourceModelKey, sourceRootDbIds, targets, pairSpaceWeight = 1, over = {}) =>
  ({ ...structuredClone(base), unitId, parentUnitId: null, kind: 'leaf', sourceModelKey,
    // cloned: a shared array would be a (legitimately rejected) aliased node for capture
    sourceRootDbIds: [...sourceRootDbIds], targets: structuredClone(targets), pairSpaceWeight, ...over });
const rootsB = (ids) => ({ modelKey: MODEL_B, scope: 'roots', rootDbIds: ids });
const rootsA = (ids) => ({ modelKey: MODEL_A, scope: 'roots', rootDbIds: ids });
const ownerRows = (ids, cls) => ids.map((rootDbId) => ({ rootDbId, ownerDbIds: [], cls }));
// The 2x2 cross-model question with `leaves` (each [id, sources, targetIds]) as the evaluated layout.
const twoByTwo = (leaves, mode = 'volume-overlap') => reconcile((s) => {
  s.definition.mode = mode;
  s.ledger.rootOwners = [{ modelKey: MODEL_A, owners: ownerRows([1, 2], 'A') }, { modelKey: MODEL_B, owners: ownerRows([7, 8], 'B') }];
  const base = s.ledger.units[0];
  s.ledger.units = leaves.map(([id, src, tgt]) => leafOf(base, id, MODEL_A, src, [rootsB(tgt)], src.length * tgt.length));
});
// The same-model question C = {1..4} with `leaves` (each [id, sources, targetIds]) as the evaluated layout.
const sameModelC = (leaves, mode = 'volume-overlap') => reconcile((s) => {
  s.definition.mode = mode;
  s.definition.selectionA = { entries: [{ kind: 'model', modelKey: MODEL_A }] };
  s.definition.selectionB = { entries: [{ kind: 'model', modelKey: MODEL_A }] };
  s.ledger.rootOwners = [{ modelKey: MODEL_A, owners: ownerRows([1, 2, 3, 4], 'C') }];
  const base = s.ledger.units[0];
  s.ledger.units = leaves.map(([id, src, tgt]) => leafOf(base, id, MODEL_A, src, [rootsA(tgt)], src.length * tgt.length));
});
// Every ordered pair of a same-model layout, reversed (containment runs 3b both ways).
const withReversed = (leaves) => [...leaves, ...leaves.map(([id, src, tgt]) => [`${id}r`, tgt, src])];
const PAIR_COVER_CORRUPTIONS = [
  // Diagonal-only 2x2: 1->7 and 2->8; pairs (1,8) and (2,7) never evaluated. Both modes.
  ['coverage-pair-uncovered', twoByTwo([['d1', [1], [7]], ['d2', [2], [8]]])],
  ['coverage-pair-uncovered', twoByTwo([['d1', [1], [7]], ['d2', [2], [8]]], 'containment')],
  // Duplicate masking one missing pair: weights sum to 2 + 1 + 1 = 4 = |P| (so weight arithmetic would
  // pass), but (2, 8) is never evaluated -- the duplicate 2->7 pays for nothing.
  ['coverage-pair-uncovered', twoByTwo([['m1', [1], [7, 8]], ['m2', [2], [7]], ['m3', [2], [7]]])],
  // Overlap masking omission: a strictly overlapping (not identical) rectangle {1,2}->{7} over 1->{7,8},
  // weights 2 + 2 = 4 = |P|, and (2, 8) is still never evaluated.
  ['coverage-pair-uncovered', twoByTwo([['o1', [1], [7, 8]], ['o2', [1, 2], [7]]])],
  // Missing required pair, non-split layout.
  ['coverage-pair-uncovered', twoByTwo([['n1', [1], [7, 8]], ['n2', [2], [7]]])],
  // Missing required pair, SPLIT layout: parent {1,2}->{7,8} split into children whose weights partition
  // it (Finding D holds) and whose roots each meet their partner class (REM7 holds), but (2, 8) is lost.
  ['coverage-pair-uncovered', reconcile((s) => {
    s.ledger.rootOwners = [{ modelKey: MODEL_A, owners: ownerRows([1, 2], 'A') }, { modelKey: MODEL_B, owners: ownerRows([7, 8], 'B') }];
    const base = s.ledger.units[0];
    s.ledger.units = [
      leafOf(base, 'p', MODEL_A, [1, 2], [rootsB([7, 8])], 3, { kind: 'split', outcome: 'split', scopeProof: 'not-checked' }),
      leafOf(base, 'p.0', MODEL_A, [1], [rootsB([7, 8])], 2, { parentUnitId: 'p' }),
      leafOf(base, 'p.1', MODEL_A, [2], [rootsB([7])], 1, { parentUnitId: 'p' }),
    ];
  })],
  // Arbitrary-subset cell-3b blocks (e1): blocks {1,3} and {2,4} of C = {1..4} -- a COMPLETE cover of
  // all six unordered pairs ({1,3}x{2,4} + 1->3 + 2->4), but the blocks are not runs of the canonical
  // (class, dbId) order, so the layout is illegal.
  ['coverage-layout-noncontiguous', sameModelC([['b1', [1, 3], [2, 4]], ['b2', [1], [3]], ['b3', [2], [4]]])],
  // ... and the R5 odd/even shape as ordered pairs (every ordered pair covered, fragmented blocks).
  ['coverage-layout-noncontiguous', sameModelC(withReversed([['b1', [1, 3], [2, 4]], ['b2', [1], [3]], ['b3', [2], [4]]]), 'containment')],
  // A fragmented explicit TARGET entry only (sources are single roots): 1 -> {2, 4}, complete cover.
  ['coverage-layout-noncontiguous', sameModelC([['t1', [1], [2, 4]], ['t2', [1], [3]], ['t3', [2], [3, 4]], ['t4', [3], [4]]])],
  // A source spanning the A'|C boundary (contiguous, but no §6.3 cell has a mixed-class source):
  // A' = {1}, C = {2}, B' = {7}; the leaf {1,2} -> {7} plus the C-partner leaf 1 -> 2 cover every pair.
  ['coverage-layout-noncontiguous', reconcile((s) => {
    s.definition.selectionB = { entries: [{ kind: 'elements', modelKey: MODEL_A, dbIds: [2] }, { kind: 'model', modelKey: MODEL_B }] };
    s.ledger.rootOwners = [{ modelKey: MODEL_A, owners: [...ownerRows([1], 'A'), ...ownerRows([2], 'C')] },
      { modelKey: MODEL_B, owners: ownerRows([7], 'B') }];
    const base = s.ledger.units[0];
    s.ledger.units = [leafOf(base, 'x1', MODEL_A, [1, 2], [rootsB([7])], 2), leafOf(base, 'x2', MODEL_A, [1], [rootsA([2])], 1)];
  })],
];
CORRUPTIONS.push(...PAIR_COVER_CORRUPTIONS);

test('P5-REM9: each pair-level exact-cover corruption is rejected by its own code alone, before any clean claim', async () => {
  for (const [code, mutate] of PAIR_COVER_CORRUPTIONS) {
    const forged = await resealed(mutate, 'completed-clean');
    assert.equal(forged.outcome.coverage, 'full', `${code}: the forgery derives full`);
    const { ok, issues } = validateResultSet(forged, { limits });
    assert.equal(ok, false, code);
    assert.deepEqual([...new Set(issues.map((i) => i.code))], [code], `${code}: got ${JSON.stringify(issues)}`);
    await assert.rejects(readResultSet(structuredClone(forged), { limits, slicer: fakeSlicer() }),
      (e) => e instanceof CorruptResultSetError && e.issues.some((i) => i.code === code));
  }
});

// Positive controls: legal layouts -- including overlap, an alternate legal layout, and contiguous
// block-triangular cell-3b substitutes (the e1 reading) -- validate clean and stay claimable.
const PAIR_COVER_POSITIVES = [
  ['full 2x2', twoByTwo([['f', [1, 2], [7, 8]]])],
  ['full 2x2, ordered', twoByTwo([['f', [1, 2], [7, 8]]], 'containment')],
  ['overlap without omission', twoByTwo([['f', [1, 2], [7, 8]], ['dup', [1], [7]], ['dup2', [1, 2], [8]]])],
  ['alternate layout (per-source rows)', twoByTwo([['r1', [1], [7, 8]], ['r2', [2], [7, 8]]])],
  ['alternate layout (per-target columns)', twoByTwo([['c1', [1, 2], [7]], ['c2', [1, 2], [8]]])],
  ['contiguous 3b blocks {1,2},{3,4}', sameModelC([['k1', [1, 2], [3, 4]], ['k2', [1], [2]], ['k3', [3], [4]]])],
  ['contiguous 3b blocks {1},{2,3},{4}', sameModelC([['k1', [1], [2, 3, 4]], ['k2', [2, 3], [4]], ['k3', [2], [3]]])],
  ['contiguous 3b blocks, ordered', sameModelC(withReversed([['k1', [1, 2], [3, 4]], ['k2', [1], [2]], ['k3', [3], [4]]]), 'containment')],
  ['reference 3b bisection', sameModelC([['L', [1, 2], [3, 4]], ['LL', [1], [2]], ['RR', [3], [4]]])],
];
test('P5-REM9: legal layouts (overlap, alternates, contiguous block-triangular 3b) validate clean and stay claimable', async () => {
  for (const [label, mutate] of PAIR_COVER_POSITIVES) {
    const set = await resealed(mutate, 'completed-clean');
    assert.equal(set.outcome.coverage, 'full', `${label}: derives full`);
    assert.deepEqual(validateResultSet(set, { limits }), { ok: true, issues: [] }, label);
    assert.equal(canClaimNoClashes(set, 'current'), true, label);
  }
});

// P5-REM10: `sharedRootPlan` (task P5.6's status-reader fixture, `test/support/resultSetFixtures.mjs`)
// had the same class of defect `widePlan` had (P5-REM9 correction on that builder): with
// `unrelatedUnits > 0` it gave each "unrelated" leaf its OWN distinct MODEL_B target root, so
// `provePairExactCoverSteps`'s required count (the GLOBAL `nA * nB` cross product over every
// recorded root, not partitioned by "island") outgrew what was actually evaluated, while the
// fixture still recorded `coverage: 'full'`. This is a genuine regression test, not a corruption
// probe on an already-valid layout: it directly exercises the FIXTURE BUILDER itself (an async
// function, not the `reconcile`/`resealed` mutation pattern the `PAIR_COVER_*` tables above use),
// so it is a standalone node per the task's own convention for builder-level fixture regressions.
// (codex-review, 2026-09-23, Low, accepted: `fanOut: 0` is out of scope -- no real caller ever
// passes it (`status.test.mjs` uses 20/50/400) and it is not part of this task's diagnosed bug, so
// this table is scoped to `fanOut >= 1`, matching every case the fixture is actually exercised at.)
test('P5-REM10: sharedRootPlan claims full coverage honestly for any fanOut >= 1 / unrelatedUnits combination', async () => {
  for (const [fanOut, unrelatedUnits] of [[5, 0], [5, 2], [1, 1], [3, 1], [50, 2000]]) {
    const set = await sharedRootPlan({ fanOut, unrelatedUnits });
    assert.equal(set.outcome.coverage, 'full', `fanOut=${fanOut} unrelatedUnits=${unrelatedUnits}: recorded coverage`);
    assert.deepEqual(validateResultSet(set, { limits }), { ok: true, issues: [] },
      `fanOut=${fanOut} unrelatedUnits=${unrelatedUnits}`);
    await assert.doesNotReject(readResultSet(structuredClone(set), { limits, slicer: fakeSlicer() }),
      `fanOut=${fanOut} unrelatedUnits=${unrelatedUnits}: readResultSet`);
  }
});

// Brute-force oracle (codex-review of P5-REM9, testing gap): seeded random LEGAL (canonical-contiguous)
// layouts over MODEL_A's A' = {1..a} and C = {101..} and MODEL_B's B' = {201..}, with explicit and
// whole-model targets, duplicates and overlaps, in both modes. The verifier must accept exactly the
// layouts whose leaves cover every required pair (enumerated here, §6.1) and reject the rest with a
// coverage code -- never anything else.
test('P5-REM9: the pair-cover verdict agrees with brute-force pair enumeration on random legal layouts', async () => {
  let seed = 20260923;
  const rnd = (k) => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return (seed >>> 16) % k; };
  const key = (r) => `${r.m}#${r.id}`;
  const tally = { full: 0, missing: 0, pairOnly: 0 };
  for (let iter = 0; iter < 600 && tally.full + tally.missing < 240; iter += 1) {
    const [a, c, b] = [rnd(4), rnd(4), rnd(4)];
    if (a + c === 0 || b + c === 0) continue;
    const ordered = rnd(2) === 1;
    const roots = (m, n0, count, cls) => Array.from({ length: count }, (_, i) => ({ m, id: n0 + i, cls }));
    const [Ap, C, Bp] = [roots(MODEL_A, 1, a, 'A'), roots(MODEL_A, 101, c, 'C'), roots(MODEL_B, 201, b, 'B')];
    const pairKey = (x, y) => (ordered ? `${key(x)}>${key(y)}` : [key(x), key(y)].sort().join('|'));
    const required = new Set();
    for (const x of [...Ap, ...C]) for (const y of [...C, ...Bp]) if (key(x) !== key(y)) required.add(pairKey(x, y));
    if (required.size === 0) continue;
    const covered = new Set();
    const leaves = [];
    const run = (t) => { const s0 = rnd(t.length); return t.slice(s0, s0 + 1 + rnd(t.length - s0)); };
    for (let l = 0, nl = 2 + rnd(8); l < nl; l += 1) {
      const pool = [Ap, C].filter((t) => t.length > 0);
      const src = run(pool[rnd(pool.length)]);
      const targets = [];
      if (C.length > 0 && rnd(3) > 0) {                   // same-model C run, never overlapping the source
        const tg = run(C);
        if (!tg.some((y) => src.some((x) => key(x) === key(y)))) targets.push({ modelKey: MODEL_A, scope: 'roots', rootDbIds: tg.map((r) => r.id), tg });
      }
      if (Bp.length > 0 && rnd(3) > 0) {                  // MODEL_B: whole-model sentinel or an explicit run
        const whole = rnd(2) === 1;
        const tg = whole ? Bp : run(Bp);
        targets.push(whole ? { modelKey: MODEL_B, scope: 'model', tg } : { modelKey: MODEL_B, scope: 'roots', rootDbIds: tg.map((r) => r.id), tg });
      }
      if (targets.length === 0) continue;
      for (const { tg } of targets) for (const x of src) for (const y of tg) covered.add(pairKey(x, y));
      leaves.push({ src, targets: targets.map(({ tg, ...t }) => t) });
    }
    if (leaves.length === 0) continue;
    const full = [...required].every((p) => covered.has(p));
    const set = await resealed(reconcile((s) => {
      s.definition.mode = ordered ? 'containment' : 'volume-overlap';
      s.definition.selectionB = { entries: [...(c > 0 ? [{ kind: 'elements', modelKey: MODEL_A, dbIds: C.map((r) => r.id) }] : []),
        { kind: 'model', modelKey: MODEL_B }] };
      s.ledger.rootOwners = [{ modelKey: MODEL_A, owners: [...Ap, ...C].map((r) => ({ rootDbId: r.id, ownerDbIds: [], cls: r.cls })) },
        { modelKey: MODEL_B, owners: ownerRows(Bp.map((r) => r.id), 'B') }];
      const base = s.ledger.units[0];
      s.ledger.units = leaves.map((L, i) => leafOf(base, `L${i}`, MODEL_A, L.src.map((r) => r.id), L.targets));
    }), 'completed-clean');
    const { ok, issues } = validateResultSet(set, { limits });
    const codes = [...new Set(issues.map((i) => i.code))];
    const label = JSON.stringify({ ordered, a, c, b, leaves: leaves.map((L) => [L.src.map((r) => r.id), L.targets]) });
    if (full) {
      assert.deepEqual({ ok, codes }, { ok: true, codes: [] }, `complete cover rejected: ${label}`);
      tally.full += 1;
    } else {
      assert.equal(ok, false, `missing pair accepted: ${label}`);
      assert.ok(codes.every((code) => code === 'coverage-pair-uncovered' || code === 'coverage-root-uncovered'), `${codes}: ${label}`);
      tally.missing += 1;
      if (!codes.includes('coverage-root-uncovered')) tally.pairOnly += 1;   // root-level check alone would pass it
    }
  }
  assert.ok(tally.full >= 20 && tally.missing >= 20 && tally.pairOnly >= 10, `every verdict exercised: ${JSON.stringify(tally)}`);
});

// P5-REM10 (peak-memory remediation of the pair-cover sweep; semantics-preserving). Pins what the
// buffer changes must preserve: (1) the exact 2w-1-node pre-order segment tree over MANY elementary y
// segments, w not a power of two, deep enough that every child-index rule is exercised; (2) the typed
// per-list stamp that replaced the per-list Set of ranks counts DISTINCT ranks, so a duplicated id is
// only ever the structural phase's finding -- never a layout one -- and the proof still runs past it.
const crossModel = (aIds, bIds, leaves, mode) => reconcile((s) => {
  s.definition.mode = mode;
  s.ledger.rootOwners = [{ modelKey: MODEL_A, owners: ownerRows(aIds, 'A') }, { modelKey: MODEL_B, owners: ownerRows(bIds, 'B') }];
  const base = s.ledger.units[0];
  s.ledger.units = leaves.map(([id, src, tgt]) => leafOf(base, id, MODEL_A, src, [rootsB(tgt)], src.length * tgt.length));
});
const REM10_A = Array.from({ length: 23 }, (_, i) => 1 + i);
const REM10_B = Array.from({ length: 59 }, (_, i) => 201 + i);
// Each source root's target row cut at its own points (so nearly every B rank is a y endpoint), plus
// an overlapping multi-source block (legal overlap). `dropAt` removes ONE single-root piece.
const rem10Layout = (dropAt) => {
  const [A, B] = [REM10_A, REM10_B];
  const leaves = [['blk', A.slice(3, 11), B.slice(5, 40)]];
  for (const a of A) {
    const cuts = [0, ...new Set([(a * 7) % 59, (a * 13) % 59, (a * 29) % 59, 30, 31].filter((c) => c > 0))].sort((x, y) => x - y);
    for (let j = 0; j < cuts.length; j += 1) {
      const piece = B.slice(cuts[j], cuts[j + 1] ?? B.length);
      if (!(a === dropAt && cuts[j] === 30)) leaves.push([`r${a}.${j}`, [a], piece]);   // piece [30, 31) = root 231
    }
  }
  return leaves;
};
test('P5-REM10: many non-power-of-two y segments -- full cover validates clean, one lost pair is caught alone, both modes', async () => {
  const [A, B, layout] = [REM10_A, REM10_B, rem10Layout];
  for (const mode of ['volume-overlap', 'containment']) {
    const full = await resealed(crossModel(A, B, layout(null), mode), 'completed-clean');
    assert.equal(full.outcome.coverage, 'full', mode);
    assert.deepEqual(validateResultSet(full, { limits }), { ok: true, issues: [] }, `${mode}: complete cover`);
    // Root 1 (outside the overlapping block) loses exactly (1, 231); both roots still meet their
    // partner class, so only the pair-level proof can see it.
    const missing = await resealed(crossModel(A, B, layout(1), mode), 'completed-clean');
    assert.equal(missing.outcome.coverage, 'full', mode);
    const { ok, issues } = validateResultSet(missing, { limits });
    assert.equal(ok, false, mode);
    assert.deepEqual([...new Set(issues.map((i) => i.code))], ['coverage-pair-uncovered'], `${mode}: ${JSON.stringify(issues)}`);
  }
});
// The proof's typed-array working set is a deterministic budget -- every buffer it allocates stays live
// to the end, so the peak IS the sum and does not depend on the collector reclaiming a dropped buffer.
// Exactly: one rank-space Int32Array(n+2) (stamps, diagonal, x buckets, y marks, then `ys` and -- when
// n+2-m >= 2w-1 -- the tree's `cover`, as views), `rects` Int32Array(4C), `order` Int32Array(2T), the
// tree's `len` Int32Array(2w-1), and `cover` Int32Array(2w-1) only when it does not fit (C target
// entries, T = C or 2C rectangles swept, m distinct y endpoints, w = max(m-1, 1)). Every typed-array
// constructor on `globalThis` (and ArrayBuffer / SharedArrayBuffer) is intercepted, and every
// construction from inside `provePairExactCoverSteps` that allocates backing storage -- any form except
// a view over an existing buffer (`subarray`, `new T(buffer, ...)`) -- is charged its `byteLength`.
const TYPED_ARRAYS = Object.getOwnPropertyNames(globalThis).filter((name) => /^[A-Z]\w*Array$/.test(name)
  && typeof globalThis[name] === 'function' && Object.getPrototypeOf(globalThis[name]) === Object.getPrototypeOf(Int8Array));
const BUFFERS = ['ArrayBuffer', 'SharedArrayBuffer'].filter((name) => typeof globalThis[name] === 'function');
function typedAllocationsOf(run) {
  const originals = [...TYPED_ARRAYS, ...BUFFERS].map((name) => [name, globalThis[name]]);
  const bufferTypes = BUFFERS.map((name) => globalThis[name]);   // the ORIGINALS, captured before replacement
  const isBuffer = (x) => bufferTypes.some((B) => x instanceof B);
  const inProof = () => /provePairExactCoverSteps/.test(new Error().stack);
  const allocations = [];
  const stackTraceLimit = Error.stackTraceLimit;
  Error.stackTraceLimit = Infinity;                       // attribution must not depend on frame depth
  for (const [name, Original] of originals) {
    const buffer = BUFFERS.includes(name);
    globalThis[name] = class extends Original {
      constructor(...args) {
        super(...args);
        if ((buffer || !isBuffer(args[0])) && inProof()) allocations.push({ name, length: buffer ? this.byteLength : this.length, bytes: this.byteLength });
      }
    };
  }
  try { return { value: run(), allocations }; } finally {
    for (const [name, Original] of originals) globalThis[name] = Original;
    Error.stackTraceLimit = stackTraceLimit;
  }
}
test('P5-REM10: the pair-cover proof allocates exactly its deterministic typed-array budget (cover aliased or owned)', async () => {
  const wideB = Array.from({ length: 100 }, (_, i) => 201 + i);
  const FIXTURES = [
    // Many y endpoints (m close to n): `cover` cannot fit in the rank buffer's tail -> its own array.
    ['cover owned', REM10_A, REM10_B, rem10Layout(null), false],
    // Few y endpoints over many roots (m << n): `cover` is carved from the rank buffer's tail.
    ['cover aliased', [1, 2, 3], wideB, [1, 2, 3].map((a) => [`w${a}`, [a], wideB]), true],
  ];
  for (const [label, A, B, leaves, fits] of FIXTURES) {
    // Canonical ranks: MODEL_A (code-unit smaller) first, A' by dbId; then MODEL_B's B' by dbId.
    const rank = new Map([...A.map((id, i) => [`a${id}`, i]), ...B.map((id, i) => [`b${id}`, A.length + i])]);
    const n = A.length + B.length;
    for (const mode of ['volume-overlap', 'containment']) {
      const unordered = mode !== 'containment';
      const ys = new Set();
      for (const [, src, tgt] of leaves) {
        ys.add(rank.get(`b${tgt[0]}`)); ys.add(rank.get(`b${tgt.at(-1)}`) + 1);
        if (unordered) { ys.add(rank.get(`a${src[0]}`)); ys.add(rank.get(`a${src.at(-1)}`) + 1); }
      }
      const C = leaves.length;
      const T = unordered ? 2 * C : C;
      const w = Math.max(ys.size - 1, 1);
      assert.equal(n + 2 - ys.size >= 2 * w - 1, fits, `${label}/${mode}: the fixture exercises its branch`);
      const expected = [n + 2, 4 * C, 2 * T, 2 * w - 1, ...(fits ? [] : [2 * w - 1])].sort((x, y) => x - y);
      const set = await resealed(crossModel(A, B, leaves, mode), 'completed-clean');
      const { value: verdict, allocations } = typedAllocationsOf(() => validateResultSet(set, { limits }));
      assert.deepEqual(verdict, { ok: true, issues: [] }, `${label}/${mode}`);
      assert.deepEqual(allocations.map((a) => a.name).filter((name) => name !== 'Int32Array'), [], `${label}/${mode}: ${JSON.stringify(allocations)}`);
      assert.deepEqual(allocations.map((a) => a.length).sort((x, y) => x - y), expected, `${label}/${mode}: ${JSON.stringify(allocations)}`);
      const budget = 16 * C + 4 * (n + 2) + 8 * T + 4 * (2 * w - 1) * (fits ? 1 : 2);
      assert.equal(allocations.reduce((sum, a) => sum + a.bytes, 0), budget, `${label}/${mode}: bytes == budget`);
    }
  }
});
test('P5-REM10: a duplicated id inside a run is counted once by the layout check (never coverage-layout-noncontiguous)', async () => {
  const codesOf = async (leaves) => {
    const set = await resealed(twoByTwo(leaves), 'completed-clean');
    const { ok, issues } = validateResultSet(set, { limits });
    return { ok, codes: new Set(issues.map((i) => i.code)) };
  };
  // Complete cover with a duplicated source id and a duplicated target id: the proof accepts the cover.
  const dupFull = await codesOf([['f', [1, 2, 1], [7, 8, 8]]]);
  assert.equal(dupFull.ok, false, 'the duplicate itself is still a structural finding');
  for (const code of ['coverage-layout-noncontiguous', 'coverage-pair-uncovered', 'coverage-root-uncovered']) {
    assert.equal(dupFull.codes.has(code), false, `${code}: ${[...dupFull.codes]}`);
  }
  // ... and the proof still RUNS past a duplicated list: (2, 8) is missing and is caught at pair level.
  const dupMissing = await codesOf([['d1', [1, 1], [7, 8]], ['d2', [2], [7, 7]]]);
  assert.equal(dupMissing.codes.has('coverage-pair-uncovered'), true, [...dupMissing.codes].join());
  assert.equal(dupMissing.codes.has('coverage-layout-noncontiguous'), false, [...dupMissing.codes].join());
});

// The owner-listed regression cases on the ZERO-RESULT, claimable `completed-clean` fixture: each is
// rejected by its reconciliation code ALONE (nothing else can explain the rejection), at the
// `readResultSet` trust boundary too -- where before P5-REM7 each validated `{ok: true}` and
// `canClaimNoClashes` returned `true`.
test('P5-REM7: each coverage-reconciliation corruption is rejected by its own code alone, before any clean claim', async () => {
  const clean = await sealedSet('completed-clean');
  assert.equal(canClaimNoClashes(clean, 'current'), true, 'baseline is claimable');
  for (const [code, mutate, expected = [code]] of COVERAGE_RECONCILIATION_CORRUPTIONS) {
    const forged = await resealed(mutate, 'completed-clean');
    assert.equal(forged.outcome.coverage, 'full', `${code}: the forgery derives full`);
    const { ok, issues } = validateResultSet(forged, { limits });
    assert.equal(ok, false, code);
    assert.deepEqual([...new Set(issues.map((i) => i.code))], expected, `${code}: got ${JSON.stringify(issues)}`);
    await assert.rejects(readResultSet(structuredClone(forged), { limits, slicer: fakeSlicer() }),
      (e) => e instanceof CorruptResultSetError && e.issues.some((i) => i.code === code));
  }
});

test('P5-REM6: each split-topology corruption is rejected by its own new code alone', async () => {
  for (const [code, mutate] of SPLIT_TOPOLOGY_CORRUPTIONS) {
    const set = await resealed(mutate, 'positives');
    const { ok, issues } = validateResultSet(set, { limits });
    assert.equal(ok, false, code);
    // P5-REM7: the CHILDLESS split is the one case here that derives `coverage: 'full'` (its weight and
    // its only leaf -- the one evaluating owned root 11 -- both vanish), so the F/G reconciliation now
    // ALSO, truthfully, reports root 11 as never evaluated. Exactly that one extra code, on exactly
    // that one case; every other case still reports its own code alone.
    const expected = set.outcome.coverage === 'full' ? [code, 'coverage-root-uncovered'] : [code];
    assert.deepEqual([...new Set(issues.map((i) => i.code))], expected, `${code}: got ${JSON.stringify(issues)}`);
  }
  // Finding A's case keeps its own code only: the new C check does not double-report it.
  const a = await resealed((s) => { s.ledger.units[1].kind = 'split'; s.ledger.units[1].outcome = 'evaluated'; }, 'positives');
  assert.ok(!validateResultSet(a, { limits }).issues.some((i) => i.code === 'unit-kind-outcome-mismatch'));
});

// The recorded reproductions of C and D (P5-REM5 adjudication, "Three new candidate findings"): an
// extra unit on the zero-result `completed-clean` fixture, its weight excluded from pairSpaceTotal,
// validated `{ok: true}` with `canClaimNoClashes === true`. Now rejected, including at readResultSet.
test('P5-REM6: zero-result leaf/split and childless-split forgeries are rejected before any clean claim', async () => {
  const extra = (over) => (s) => {
    s.ledger.units.push({ ...structuredClone(s.ledger.units[0]), unitId: 'u9', pairSpaceWeight: 7,
      scopeProof: 'not-checked', ...over });
  };
  const cases = [
    ['unit-kind-outcome-mismatch', extra({ kind: 'leaf', outcome: 'split' })],
    ['split-topology-invalid', extra({ kind: 'split', outcome: 'split' })],
  ];
  for (const [code, mutate] of cases) {
    const forged = await resealed(mutate, 'completed-clean');
    const { ok, issues } = validateResultSet(forged, { limits });
    assert.equal(ok, false, code);
    assert.ok(issues.some((i) => i.code === code), `${code}: ${JSON.stringify(issues)}`);
    await assert.rejects(readResultSet(structuredClone(forged), { limits, slicer: fakeSlicer() }),
      (e) => e instanceof CorruptResultSetError && e.issues.some((i) => i.code === code));
  }
});

// Positive controls: a legitimate split tree must keep validating (the new checks must not reject
// genuine writer output). (1) hand-built on `completed-clean`: `u1` split into `u1.0`/`u1.1`, a
// nested split under `u1.1`, all leaves evaluated -- still `{ok: true}` and still claimable.
test('P5-REM6: a well-formed (nested) split tree still validates and stays claimable', async () => {
  const set = await resealed((s) => {
    const u1 = s.ledger.units[0];
    const leaf = (unitId, parentUnitId, roots, w) => ({ ...structuredClone(u1), unitId, parentUnitId,
      sourceRootDbIds: roots, pairSpaceWeight: w });
    s.ledger.rootOwners[0].owners.push({ rootDbId: 11, ownerDbIds: [], cls: 'A' }, { rootDbId: 12, ownerDbIds: [], cls: 'A' });
    s.ledger.units = [
      { ...u1, kind: 'split', outcome: 'split', scopeProof: 'not-checked', sourceRootDbIds: [10, 11, 12], pairSpaceWeight: 10 },
      leaf('u1.0', 'u1', [10], 4),
      { ...leaf('u1.1', 'u1', [11, 12], 6), kind: 'split', outcome: 'split', scopeProof: 'not-checked' },
      leaf('u1.1.0', 'u1.1', [11], 3),
      leaf('u1.1.1', 'u1.1', [12], 3),
    ];
  }, 'completed-clean');
  assert.deepEqual(validateResultSet(set, { limits }), { ok: true, issues: [] });
  assert.equal(canClaimNoClashes(set, 'current'), true);
});

// (2) the REAL writer: `planning/ledger.js`'s `tryRecordSplit` via `planSplit`, split to the bottom,
// every leaf settled through `recordOutcome`, projected by `toLedgerRecord()` -- then embedded in
// `completed-clean` (model keys remapped onto the fixture's two models) and validated.
test('P5-REM6: a real ledger split tree (tryRecordSplit / toLedgerRecord) validates', async () => {
  const { plan, unit: root, ledger } = makeSplitFixture({ sourceRoots: [1, 2, 3], targets: [{ modelKey: 'a', roots: [4, 5] }],
    limits: { maxUnitsPerRun: 200, maxLedgerRecords: 1e6 } });
  const leaves = [];
  const walk = (u) => { const r = planSplit(plan, u); if (r.reason === 'unsplittable') leaves.push(u); else r.children.forEach(walk); };
  walk(root);
  for (const l of leaves) ledger.recordOutcome(l.unitId, { outcome: 'evaluated', scopeProof: 'equal' });
  const rec = ledger.toLedgerRecord();
  assert.ok(rec.units.some((u) => u.kind === 'split') && rec.units.some((u) => u.parentUnitId !== null && u.kind === 'split'),
    'the tree has nested splits');
  const remap = (k) => (k === 'src' ? MODEL_A : MODEL_B);
  const set = await resealed((s) => {
    s.ledger.units = rec.units.map((u) => ({ ...u, sourceModelKey: remap(u.sourceModelKey),
      targets: u.targets.map((t) => ({ ...t, modelKey: remap(t.modelKey) })) }));
    s.ledger.pairSpaceTotal = rec.pairSpaceTotal;
    s.ledger.rootOwners = [
      { modelKey: MODEL_A, owners: [1, 2, 3].map((r) => ({ rootDbId: r, ownerDbIds: [], cls: 'A' })) },
      // P5-REM7: MODEL_B is named only by selectionB, so a real planner labels its roots 'B', never
      // 'A' (`rootResolution.js` step 6) -- corrected so the F/G role check sees a real labelling.
      { modelKey: MODEL_B, owners: [4, 5].map((r) => ({ rootDbId: r, ownerDbIds: [], cls: 'B' })) },
    ];
  }, 'completed-clean');
  assert.deepEqual(validateResultSet(set, { limits }), { ok: true, issues: [] });
});

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

// P5-REM2 (H1/H2, docs/reviews/2026-09-22-federated-clash-test-core-p5-independent-review.md): the
// review's own direct probes asserted `canClaimNoClashes(set, 'current') === true` on exactly these
// two mutations against a sealed `completed-clean` fixture -- a tampered/contradictory Result Set
// supporting a false clean no-clash claim. This test exercises the TRUSTED-READ boundary
// (`readResultSet`) rather than `canClaimNoClashes` directly: both mutations are now rejected by
// `validateResultSet` before a claim would ever be assessed on a trusted read, which is the
// boundary this repository's read pipeline actually relies on (`canClaimNoClashes` itself is
// documented as not validating its argument -- the validator is the boundary, not the claim helper).
test('H1 and H2 mutations that used to let canClaimNoClashes return true are now rejected before any claim is assessed', async () => {
  const h1 = await resealed((s) => { s.definition.mode = 'containment'; }, 'completed-clean');
  await assert.rejects(
    readResultSet(structuredClone(h1), { limits, slicer: fakeSlicer() }),
    (e) => e instanceof CorruptResultSetError && e.issues.some((i) => i.code === 'semantic-digest-mismatch'),
  );

  const h2 = await resealed((s) => {
    s.definition = null; s.testRef.revision = null; s.testRef.semanticDigest = null;
  }, 'completed-clean');
  await assert.rejects(
    readResultSet(structuredClone(h2), { limits, slicer: fakeSlicer() }),
    (e) => e instanceof CorruptResultSetError && e.issues.some((i) => i.code === 'pre-resolution-shape-invalid'),
  );
});

// P5-REM5 (Findings A and B): the exact zero-result scenarios P5-REM4's own codex-review reproduced
// against `completed-clean` (the ONE claimable fixture shape) -- before this fix both validated
// `{ok: true}` and `canClaimNoClashes` returned `true`. Asserted at the trusted-read boundary too.
test('zero-result forged kind and unowned root are rejected before any clean claim is assessed', async () => {
  const clean = await sealedSet('completed-clean');
  assert.deepEqual(clean.results, []);
  assert.equal(canClaimNoClashes(clean, 'current'), true, 'baseline is claimable');
  const cases = [
    ['evaluated-unit-not-leaf', (s) => { s.ledger.units[0].kind = 'split'; }],
    ['unit-root-not-owned', (s) => { s.ledger.units[0].sourceRootDbIds = [999]; }],
  ];
  for (const [code, mutate] of cases) {
    const forged = await resealed(mutate, 'completed-clean');
    const { ok, issues } = validateResultSet(forged, { limits });
    assert.equal(ok, false, code);
    assert.ok(issues.some((i) => i.code === code), `${code}: ${JSON.stringify(issues)}`);
    await assert.rejects(readResultSet(structuredClone(forged), { limits, slicer: fakeSlicer() }),
      (e) => e instanceof CorruptResultSetError && e.issues.some((i) => i.code === code));
  }
});

// P5-REM3: a direct sanity check (not a CORRUPTIONS mutation) that every base fixture with a
// non-null `definition` is itself already a fixed point of `normalizeDefinition` -- i.e. genuinely
// canonical -- so the new `definition-not-normalized` check never fires on an untampered set. Per
// the task brief's own instruction, this is a spot-check by construction: if any of these fixtures
// were not already normalized, this assertion (not a weakening of the production check) is what
// would need to change.
test('every base fixture with a non-null definition is already a fixed point of normalizeDefinition', async () => {
  for (const kind of ['positives', 'schema-corpus', 'completed-with-gaps', 'completed-clean', 'unreachable-positive']) {
    const set = await sealedSet(kind);
    const renormalized = normalizeDefinition(set.definition);
    assert.deepEqual(renormalized, set.definition, `${kind}: definition is not already canonical`);
    assert.deepEqual(validateResultSet(set, { limits }), { ok: true, issues: [] }, kind);
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
    const set = await resealed((s) => {
      s.ledger.units[1] = { ...s.ledger.units[1], outcome, cause, scopeProof: 'not-checked' };
      s.outcome.coverage = 'partial';
      // P5-REM (Item 1): `units[1]`'s `capacityKind` (`'bucket-capacity'`, preserved by the spread
      // above) always contributes an environment-sensitive cause, and the `['failed',
      // 'stale-placement']` row ALSO contributes `placement-contention` -- so, since P5-REM's
      // `checkCrossField` now re-derives `environmentSensitive`/`environmentSensitiveCauses` and
      // rejects a stale recorded value, this fixture's own declared outcome must be refreshed to the
      // real `deriveRunOutcome` output for the mutated ledger, per row, rather than staying pinned to
      // whatever the un-mutated base fixture declared. Only the two environment-sensitive fields are
      // taken from the recompute -- status/coverage/integrity/freshness/reasons stay exactly as this
      // test already sets/expects them.
      const derived = deriveRunOutcome({
        status: s.outcome.status, freshness: s.outcome.freshness,
        ledger: s.ledger, diagnostics: s.diagnostics, results: s.results, reasons: s.outcome.reasons,
      });
      s.outcome.environmentSensitive = derived.environmentSensitive;
      s.outcome.environmentSensitiveCauses = derived.environmentSensitiveCauses;
    }, 'completed-with-gaps');
    assert.deepEqual(validateResultSet(set, { limits }), { ok: true, issues: [] }, `${outcome}:${cause}`);
  }
});

test('unreachableOwner positives stay valid on readback', async () => {
  const set = await sealedSet('unreachable-positive');
  assert.equal(validateResultSet(set, { limits }).ok, true);
  const broken = await resealed((s) => { s.ledger.unreachablePopulation[0].ownerDbIds = []; }, 'unreachable-positive');
  assert.ok(validateResultSet(broken, { limits }).issues.some((i) => i.code === 'owner-not-in-ledger'));
});

// D-A (owner-authorized P5 fix, 2026-09-24): spec §6.2 records each `unreachablePopulation` row as
// `{modelKey, count, ownerDbIds, mixedOwnerDbIds, unattributable}` and P3 always writes `count` (the
// number of loaded, owner-resolvable fragments in no root subtree; 0 is legal when only
// `unattributable` is non-zero). The closed persisted type must therefore require it and bound it as a
// non-negative safe integer -- before the fix it rejected every P3-written row as an unknown field.
test('D-A: unreachablePopulation[].count is a required non-negative safe integer (spec §6.2)', async () => {
  const path = '/ledger/unreachablePopulation/0/count';
  for (const count of [1, 3, Number.MAX_SAFE_INTEGER]) {
    const set = await resealed((s) => { s.ledger.unreachablePopulation[0].count = count; }, 'unreachable-positive');
    assert.deepEqual(validateResultSet(set, { limits }), { ok: true, issues: [] }, `count ${count} is accepted`);
    const read = await readResultSet(structuredClone(set), { limits, slicer: fakeSlicer() });
    assert.equal(read.ledger.unreachablePopulation[0].count, count, 'and survives read-back verbatim');
  }
  const base = await sealedSet('unreachable-positive');
  const rejections = [
    ['missing', (row) => { delete row.count; }, 'missing-field'],
    ['null', (row) => { row.count = null; }, 'null-not-allowed'],
    ['string', (row) => { row.count = '1'; }, 'type-invalid'],
    ['NaN', (row) => { row.count = Number.NaN; }, 'type-invalid'],
    ['negative', (row) => { row.count = -1; }, 'number-out-of-range'],
    ['fractional', (row) => { row.count = 1.5; }, 'number-out-of-range'],
    ['unsafe', (row) => { row.count = Number.MAX_SAFE_INTEGER + 2; }, 'number-out-of-range'],
  ];
  for (const [name, mutate, code] of rejections) {
    const broken = structuredClone(base);
    mutate(broken.ledger.unreachablePopulation[0]);
    const { ok, issues } = validateResultSet(broken, { limits });
    assert.equal(ok, false, name);
    assert.ok(issues.some((i) => i.path === path && i.code === code), `${name}: expected ${code} at ${path}, got ${JSON.stringify(issues)}`);
  }
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
// P5-REM2 (H1) NOTE: `checkCrossField`'s new definition/testRef reconciliation runs unconditionally
// whenever `definition !== null` (structural validity is not its job -- that is the phase above),
// so a primitive/array `definition` ALSO legitimately fails `definition-identity-mismatch` (its
// non-existent `.testId`/`.revision` read `undefined`, which disagrees with `testRef`) and
// `semantic-digest-mismatch` (`computeSemanticDigest` on such a value never equals the recorded
// digest) -- deterministically, for every one of the four bad values below. This does not weaken or
// bypass the container-shape check this test exists to prove (`container-invalid` still fires
// first, from the structural phase); the assertion below was tightened from an exact single-issue
// match to `.some(...)` because H1 legitimately adds more true findings on top, not fewer.
test('a delegated field (definition) still gets a container-shape check before validateTest ever runs', async () => {
  for (const bad of [42, 'x', true, []]) {
    const set = structuredClone(await sealedSet('completed-clean'));
    set.definition = bad;
    const { ok, issues } = validateResultSet(set, { limits });
    assert.equal(ok, false, JSON.stringify(bad));
    assert.ok(issues.some((i) => i.path === '/definition' && i.code === 'container-invalid'),
      `${JSON.stringify(bad)}: expected container-invalid, got ${JSON.stringify(issues)}`);
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

// P5-REM7 (Finding E; owner ruling 2026-09-23: "Result Set validity for the embedded resolved
// definition must be deterministic for identical persisted bytes and must use the governing fixed
// schema/spec ceilings rather than reader-configured limits. Reader-specific limits may still protect
// resource usage, but they must not change the normative persisted-data validity result"). A
// CONSISTENCY test, not only a rejection test: the SAME persisted bytes (a set whose embedded
// definition carries one more explicit dbId than the default `maxExplicitElementsPerSelection`, but
// far below its hard §17.1.1 ceiling) are validated under three different, LEGAL reader limit
// configurations (each passed through the real `resolveEngineLimits`), and every configuration must
// reach the identical verdict -- both via `validateResultSet` and at the `readResultSet` trust
// boundary. Before the fix the default and the smallest configuration rejected it
// (`definition-invalid`) while the largest accepted it.
test('P5-REM7 (E): identical persisted bytes validate identically under different legal reader limits', async () => {
  const count = ENGINE_LIMIT_DEFAULTS.maxExplicitElementsPerSelection + 1;
  const set = await resealed((s) => {
    s.definition.selectionA = { entries: [{ kind: 'elements', modelKey: MODEL_A,
      dbIds: Array.from({ length: count }, (_, i) => i) }] };
    s.testRef.semanticDigest = computeSemanticDigest(s.definition);
    for (const r of s.results) r.resultId = makeResultId(s.testRef.testId, s.testRef.semanticDigest, r.pair);
  }, 'positives');
  const bytes = canonicalJson(set);
  const configs = [
    resolveEngineLimits(undefined),                                           // the defaults
    resolveEngineLimits({ maxExplicitElementsPerSelection: 1 }),               // the legal minimum
    resolveEngineLimits({ maxExplicitElementsPerSelection: ENGINE_LIMIT_CEILINGS.maxExplicitElementsPerSelection }),
  ];
  const verdicts = [];
  for (const readerLimits of configs) {
    const direct = validateResultSet(JSON.parse(bytes), { limits: readerLimits });
    let read;
    try {
      await readResultSet(JSON.parse(bytes), { limits: readerLimits, slicer: fakeSlicer() });
      read = { ok: true, codes: [] };
    } catch (e) {
      read = { ok: false, codes: (e.issues ?? []).map((i) => i.code) };
    }
    verdicts.push({ direct, read });
  }
  for (const v of verdicts.slice(1)) assert.deepEqual(v, verdicts[0], 'every legal reader configuration agrees');
  assert.deepEqual(verdicts[0].direct, { ok: true, issues: [] }, 'and the set is valid under the fixed ceilings');
});

// P5-REM7 positive control for the F/G coverage reconciliation: REAL writer output. Each scenario is
// planned by the real `createPlan` (P3: root resolution -> class tables -> the §6.3 cell decomposition
// -> §6.4 sizing) over a synthetic enumerator, optionally split to the bottom through the real
// `planSplit` -> `tryRecordSplit` (§6.4), every leaf settled `evaluated`/`equal` through the real
// `recordOutcome`, projected by the real `toLedgerRecord()`, and embedded (with its own normalized
// definition, zero results, and re-derived outcome) into `completed-clean`. Every scenario must validate
// `{ok: true}` and stay claimable: the reconciliation must never reject genuine writer output --
// cross-model (cell 1 with whole-model targets), same-model (3b bisection), A/B overlap (cells 1 and 2
// with explicit-root and whole targets, one C root), multi-model C (3a both model orders + 3b), mixed
// roles, and the ordered (containment) mode of each.
const frag = (fragId, ownerDbId) => ({ fragId, ownerDbId, geometryId: 1 });
const synthRoots = (dbIds, fragBase) => dbIds.map((dbId, i) => ({ dbId, owners: [dbId], fragments: [frag(fragBase + i, dbId)] }));
const REAL_PLAN_SCENARIOS = [
  ['cross-model', [{ modelKey: 'arch', roots: synthRoots([1, 2, 3], 0) }, { modelKey: 'struct', roots: synthRoots([7, 8], 10) }],
    { A: [{ kind: 'model', modelKey: 'arch' }], B: [{ kind: 'model', modelKey: 'struct' }] }],
  ['same-model 3b', [{ modelKey: 'arch', roots: synthRoots([1, 2, 3, 4, 5], 0) }],
    { A: [{ kind: 'model', modelKey: 'arch' }], B: [{ kind: 'model', modelKey: 'arch' }] }],
  ['A/B overlap', [{ modelKey: 'arch', roots: synthRoots([1, 2, 3], 0) }, { modelKey: 'struct', roots: synthRoots([7], 10) }],
    { A: [{ kind: 'elements', modelKey: 'arch', dbIds: [1, 2] }],
      B: [{ kind: 'elements', modelKey: 'arch', dbIds: [2, 3] }, { kind: 'model', modelKey: 'struct' }] }],
  ['multi-model C', [{ modelKey: 'arch', roots: synthRoots([1, 2, 3], 0) }, { modelKey: 'mep', roots: synthRoots([4, 5], 10) },
    { modelKey: 'struct', roots: synthRoots([7, 8], 20) }],
    { A: ['arch', 'mep', 'struct'].map((modelKey) => ({ kind: 'model', modelKey })),
      B: ['arch', 'mep', 'struct'].map((modelKey) => ({ kind: 'model', modelKey })) }],
  ['mixed roles', [{ modelKey: 'arch', roots: synthRoots([1, 2, 3], 0) }, { modelKey: 'mep', roots: synthRoots([4, 5], 10) },
    { modelKey: 'struct', roots: synthRoots([7, 8], 20) }],
    { A: [{ kind: 'model', modelKey: 'arch' }, { kind: 'model', modelKey: 'mep' }],
      B: [{ kind: 'model', modelKey: 'arch' }, { kind: 'model', modelKey: 'struct' }] }],
];
// P5-REM9: a third sizing setting -- one source root per chunk, target slices of at most one model and
// 2 fragments -- so the real writer's source PACKING and target SLICING (sizing.js, §6.4) produce many
// chunk x slice units per cell. Every one of those real layouts must be canonical-contiguous and must
// cover the pair set exactly (the pair-level exact-cover proof must never reject genuine writer output).
const SMALL_CAPS = { ...RUN_OPTION_DEFAULTS, maxSourceDbIdsPerUnit: 1, maxTargetModelsPerUnit: 1, maxTargetFragmentsPerUnit: 2 };
async function realPlanSet({ models, A, B, mode, splitAll, options = RUN_OPTION_DEFAULTS }) {
  const { enumerator, binding } = makeSyntheticEnumerator(models);
  const definition = structuredClone(defOf({ A, B, mode, testId: 'T4', name: 'completed-clean' }));
  const keys = [...new Set([...A, ...B].map((e) => e.modelKey))].sort();
  const { plan, ledger } = await createPlan({ definition: defOf({ A, B, mode, testId: 'T4', name: 'completed-clean' }),
    snapshot: snapshotOf(binding, keys), enumerator, options, checkpoint: () => {} });
  const leaves = [];
  const walk = (u) => {
    const r = splitAll ? planSplit(plan, u) : { reason: 'unsplittable' };
    if (r.reason === 'unsplittable') leaves.push(u); else r.children.forEach(walk);
  };
  plan.units.forEach(walk);
  for (const l of leaves) ledger.recordOutcome(l.unitId, { outcome: 'evaluated', scopeProof: 'equal' });
  const rec = ledger.toLedgerRecord();
  return resealed((s) => {
    s.definition = definition;
    s.testRef.semanticDigest = computeSemanticDigest(definition);
    s.ledger = rec;
    s.provenance.models = keys.map((modelKey) => ({ ...structuredClone(s.provenance.models[0]), modelKey }));
    refreshDerived(s);
  }, 'completed-clean');
}

test('P5-REM7/REM9: real planner/splitter ledgers (every leaf evaluated) validate clean and stay claimable', async () => {
  let checked = 0;
  for (const [name, models, { A, B }] of REAL_PLAN_SCENARIOS) {
    for (const mode of ['volume-overlap', 'containment']) {
      for (const [splitAll, options, setting] of [[false, RUN_OPTION_DEFAULTS, 'as planned'],
        [true, RUN_OPTION_DEFAULTS, 'split to the bottom'], [false, SMALL_CAPS, 'packed/sliced small']]) {
        const set = await realPlanSet({ models, A, B, mode, splitAll, options });
        const label = `${name} / ${mode} / ${setting}`;
        assert.equal(set.outcome.coverage, 'full', `${label}: the writer derives full`);
        if (splitAll) assert.ok(set.ledger.units.some((u) => u.kind === 'split'), `${label}: real splits present`);
        assert.deepEqual(validateResultSet(set, { limits }), { ok: true, issues: [] }, label);
        assert.equal(canClaimNoClashes(set, 'current'), true, label);
        checked += 1;
      }
    }
  }
  assert.equal(checked, REAL_PLAN_SCENARIOS.length * 6);
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

// P5-REM11 (independent Work review adjudication, docs/reviews/2026-09-23-federated-clash-test-core-
// p5-remediation-focused-rereview-adjudication.md; confirmed by codex-advisor consult + direct source
// read): the `diagnostics.countsByReason` reconciliation loop inside `checkCrossField` used to
// `continue` on a malformed row WITHOUT reaching its own `yield CROSS_STEP` at the end of the loop
// body -- unlike every sibling loop in this file (e.g. the `retainedAffectingSum` loop a few lines
// below it, which yields unconditionally on every iteration regardless of branch). `countsByReason`
// rows are declared `free()` (resultSetSchema.js: no structural inner-shape check), so up to
// `maxDistinctReasons` (1,024, options.js) malformed rows could be processed by this ONE loop with
// ZERO slicer checkpoints -- a slicing-granularity defect, not a correctness one: the malformed branch
// already set `countsRowsValid = false` (and so still fails closed) before the `continue` that skipped
// the yield.
// Each call is a FRESH shape (never a shared object reference): `captureResultSet`'s cycle guard
// tracks visited objects by identity across the whole traversal (`clashtest/util/capture.js`), so
// repeating the SAME object reference at several array positions is itself rejected as `cyclic` --
// a distraction from what this test is actually about. Repeated several times over so there are
// dozens of malformed rows, not just one of each kind -- large enough that a per-item-yield
// regression is unmissable in the granularity test below.
const oneOfEachMalformedCountsByReasonRow = () => [
  null,               // not-an-object (also a structural null-not-allowed on the free() row itself)
  'not-an-object',    // wrong type entirely (structural container-invalid)
  42,                 // wrong type entirely (structural container-invalid)
  {},                 // missing `count`
  { count: 'x' },     // wrong type for `count`
  { count: -1 },      // negative
  { count: 1.5 },     // not a safe integer
];
const manyMalformedCountsByReasonRows = () => Array.from({ length: 6 }, oneOfEachMalformedCountsByReasonRow).flat();

// Shared by every P5-REM11 yield-granularity test below: the count of 'validate:cross-field' steps a
// full `validateResultSetSteps` drain emits for one Result Set.
const crossFieldStepCount = (set) => {
  const it = validateResultSetSteps(set, { limits });
  let step = it.next();
  let count = 0;
  while (!step.done) {
    if (step.value === 'validate:cross-field') count += 1;
    step = it.next();
  }
  return count;
};

test('P5-REM11: a countsByReason array with dozens of malformed rows is still rejected '
  + 'diagnostics-counts-inconsistent (fail-closed behavior preserved)', async () => {
  const manyMalformed = manyMalformedCountsByReasonRows();
  assert.ok(manyMalformed.length >= 24, `expected dozens of malformed rows, got ${manyMalformed.length}`);
  const forged = await resealed((s) => { s.diagnostics.countsByReason = manyMalformed; }, 'positives');
  const { ok, issues } = validateResultSet(forged, { limits });
  assert.equal(ok, false);
  assert.ok(issues.some((i) => i.code === 'diagnostics-counts-inconsistent'),
    `expected diagnostics-counts-inconsistent, got ${JSON.stringify(issues)}`);
  await assert.rejects(
    readResultSet(structuredClone(forged), { limits, slicer: fakeSlicer() }),
    (e) => e instanceof CorruptResultSetError && e.issues.some((i) => i.code === 'diagnostics-counts-inconsistent'),
  );
});

test('P5-REM11: the countsByReason cross-field loop checkpoints once per row, including malformed '
  + 'rows (yield granularity)', async () => {
  const wellFormed = Array.from({ length: 20 }, (_, i) => ({ scope: 'fragment', reason: `reason-${i}`, count: 1 }));
  const manyMalformed = manyMalformedCountsByReasonRows();
  assert.ok(manyMalformed.length >= 24, `expected dozens of malformed rows, got ${manyMalformed.length}`);

  const base = structuredClone(await sealedSet('positives'));
  base.diagnostics.countsByReason = wellFormed;
  const variant = structuredClone(base);
  variant.diagnostics.countsByReason = [...wellFormed, ...manyMalformed];

  // Pre-fix, the malformed rows' `continue` skipped their own `yield`, so appending
  // `manyMalformed.length` malformed rows to `wellFormed` added ZERO cross-field checkpoints (only
  // well-formed rows yielded, distinguishing "yields only for well-formed rows" from "yields for every
  // row"). Post-fix, every appended row -- well-formed or malformed -- yields exactly once, so the
  // delta equals the count of appended rows exactly.
  const delta = crossFieldStepCount(variant) - crossFieldStepCount(base);
  assert.equal(delta, manyMalformed.length, `expected one cross-field checkpoint per appended `
    + `malformed row (${manyMalformed.length}), got a delta of ${delta}`);
});

// P5-REM11 follow-up (codex-review finding on the countsByReason fix above, Low severity, same
// narrow bug class): two OTHER loops in this same cross-field phase used `break` to short-circuit
// once their answer was already known, but the branch that triggers the `break` skipped that one
// item's own `yield` -- unlike the item's own `yield` on every other path through the same loop.
// Both are now fixed to yield the triggering item too, before breaking. Each bypass was bounded to
// exactly ONE skipped checkpoint (not the up-to-1,024 of the primary countsByReason bug above), so
// codex-review correctly rated this Low, but it is the identical class of defect and a mechanical,
// narrow fix, so it is fixed here rather than merely flagged.

test('P5-REM11 follow-up: the allLeavesEvaluatedEqual loop checkpoints for the leaf that ends its '
  + 'own short-circuit, not only for leaves strictly before it', async () => {
  const N = 5;
  const wide = structuredClone(await widePlan(N));
  // `ledger.planningGaps` is forced non-empty in BOTH variants so `derivedFull` (which this loop's
  // own outcome feeds into) is `false` in both regardless -- this keeps
  // `reconcileEvaluatedCoverageSteps`'s large `derivedFull`-gated tail from running in either variant.
  wide.ledger.planningGaps = [{ phase: 'planning', cause: 'cancelled' }];
  // The LAST unit's own source/target ranges are emptied in BOTH variants too (codex-review
  // round-2 finding): `reconcileEvaluatedCoverageSteps` has its OWN separate, already-correct
  // per-leaf loop that nests extra checkpoints only for a leaf's non-empty sourceRootDbIds/targets --
  // emptying them makes that loop's contribution for this one unit exactly 0 regardless of the
  // unit's validity, so it can no longer add an incidental, reconciliation-shape-dependent offset to
  // the delta this test measures. What remains isolates ONLY the `allLeavesEvaluatedEqual` loop
  // under test: the breaking unit's own checkpoint is the ONLY thing that can now differ.
  wide.ledger.units[N - 1].sourceRootDbIds = [];
  wide.ledger.units[N - 1].targets = [];
  const allValid = structuredClone(wide);
  const lastInvalid = structuredClone(wide);
  lastInvalid.ledger.units[N - 1].scopeProof = 'not-checked';   // the LAST leaf now fails the loop's check

  // Empirically confirmed (temporarily reverting just this loop's fix, then restoring it): delta is
  // 1 with the bug present (the breaking leaf's own checkpoint never fires) and 0 fixed (it does).
  const delta = crossFieldStepCount(allValid) - crossFieldStepCount(lastInvalid);
  assert.equal(delta, 0, `expected the breaking leaf's own checkpoint to still fire (delta 0), got ${delta}`);
});

test('P5-REM11 follow-up: the duplicateConflict loop checkpoints for the result that ends its own '
  + 'short-circuit, not only for results strictly before it', async () => {
  const N = 5;
  const wide = structuredClone(await widePlan(N));
  const noConflict = structuredClone(wide);
  const lastConflict = structuredClone(wide);
  lastConflict.results[lastConflict.results.length - 1].flags = { duplicateEvidenceConflict: true };

  // No confound here (this loop is independent of `ledger`/`derivedFull`): the delta is exactly the
  // one checkpoint this fix restores -- empirically 1 with the bug present, 0 fixed.
  const delta = crossFieldStepCount(noConflict) - crossFieldStepCount(lastConflict);
  assert.equal(delta, 0, `expected the breaking result's own checkpoint to still fire (delta 0), got ${delta}`);
});

// 2026-10-07 (owner-authorized informational `fragment-null-geometry`; codex-advisor finding): read-back now
// re-derives each retained diagnostic's `completenessAffecting` from the ONE predicate, so a flag that disagrees
// with its reason is rejected even when every counter agrees with it.
test('a retained diagnostic whose completenessAffecting flag disagrees with the ONE predicate is rejected', async () => {
  const nullGeom = (affecting) => (s) => {
    s.diagnostics = {
      ...s.diagnostics,
      diagnostics: [{ scope: 'fragment', reason: 'fragment-null-geometry', completenessAffecting: affecting,
        attribution: 'target-model', fragment: { modelKey: MODEL_B, dbId: null, fragId: 4600, role: 'target' },
        occurrences: 1, unitIds: ['u1'] }],
      total: 1,
      countsByReason: [{ scope: 'fragment', reason: 'fragment-null-geometry', count: 1 }],
      completenessAffectingCount: affecting ? 1 : 0,
      completenessAffectingUpperBound: affecting ? 1 : 0,
    };
    s.outcome.integrity = affecting ? 'caveated' : 'clean';
  };
  // Correct (informational) flag: valid, and integrity stays clean.
  const good = await resealed(nullGeom(false), 'positives');
  assert.deepEqual(validateResultSet(good, { limits }), { ok: true, issues: [] });
  // Same row flagged completeness-affecting, every counter self-consistent with that flag: rejected.
  const forged = await resealed(nullGeom(true), 'positives');
  const { ok, issues } = validateResultSet(forged, { limits });
  assert.equal(ok, false);
  assert.ok(issues.some((i) => i.code === 'diagnostics-counts-inconsistent'
    && i.path === '/diagnostics/diagnostics/0/completenessAffecting'), JSON.stringify(issues));
});
