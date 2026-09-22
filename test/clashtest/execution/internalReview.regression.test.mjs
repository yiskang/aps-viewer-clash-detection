// test/clashtest/execution/internalReview.regression.test.mjs
//
// Regression tests for the P4 internal holistic review (2026-09-22).
// Record: docs/reviews/2026-09-22-federated-clash-test-core-p4-internal-codex-review.md
//
// Every test below FAILS against the code as it stood at the start of that review. None of the 752
// tests the five implementer agents shipped covered any of these cases -- which is precisely why the
// defects survived per-file TDD and per-file codex-review. They are cross-file invariants: a
// producer in one module and the validator of the same field in another, or a contract pinned by the
// interface-reconciliation register rather than by either file alone.
//
// Deliberately a NEW file: the implementers' own ten test files are left untouched, so a later
// reader can tell review-driven coverage from phase-driven coverage at a glance.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  validateUnitOutcome, validateExecutionRequest, CAPACITY_DETAILS_KEYS,
  MAX_NESTED_STRING_CODE_UNITS as MAX_NESTED_FROM_UNIT_EXECUTOR,
} from '../../../clashtest/execution/UnitExecutor.js';
import {
  NON_COMPLETENESS_AFFECTING_REASONS, isCompletenessAffecting, deriveUnitTaints, projectDiagnostic,
  createUnitBindingTable, MAX_NESTED_STRING_CODE_UNITS as MAX_NESTED_FROM_DIAGNOSTICS,
} from '../../../clashtest/execution/diagnostics.js';
import { createLocalUnitExecutor } from '../../../clashtest/execution/LocalUnitExecutor.js';
import { makeRequest, makeExecutorDeps } from '../support/executionRequests.mjs';

const gens = () => [
  { modelKey: 'mk-a', bindingGeneration: 1, placementGeneration: 0 },
  { modelKey: 'mk-b', bindingGeneration: 1, placementGeneration: 0 },
];
const baseOutcome = (over = {}) => ({
  unitId: '1.0', attempt: 0, outcome: 'evaluated', scopeProof: 'equal', failure: null,
  generations: { start: gens(), end: gens() },
  pairs: [], diagnostics: [], statistics: {}, durationMs: 1, ...over,
});

// ---- F1: LocalUnitExecutor.projectPairs -- structured-clone safety of dbId/type (F4) -------------

test('F1: a non-cloneable library dbId never reaches the outcome (F4 clone safety)', async () => {
  const deps = makeExecutorDeps({});
  deps.world.script(() => ({
    pairs: [{ source: { modelId: 'mk-a', dbId: () => 1 }, target: { modelId: 'mk-b', dbId: 20 },
      type: 'volume-overlap', witness: null }],
    statistics: {},
  }));
  const outcome = await createLocalUnitExecutor(deps)(makeRequest({}));
  // The whole point: a worker-hosted executor clones on postMessage, BEFORE any validation runs.
  assert.doesNotThrow(() => structuredClone(outcome), 'the outcome must always be clone-safe');
  assert.equal(outcome.pairs[0].source.dbId, null, 'an illegal dbId normalizes to null, never a sentinel');
  // Still illegal, so the boundary validator rejects it rather than the engine silently believing it.
  assert.equal(validateUnitOutcome(makeRequest({}), outcome).ok, false);
});

test('F1: a non-string library pair `type` normalizes to null and is rejected, not copied through', async () => {
  const deps = makeExecutorDeps({});
  deps.world.script(() => ({
    pairs: [{ source: { modelId: 'mk-a', dbId: 10 }, target: { modelId: 'mk-b', dbId: 20 },
      type: { evil: true }, witness: null }],
    statistics: {},
  }));
  const outcome = await createLocalUnitExecutor(deps)(makeRequest({}));
  assert.equal(outcome.pairs[0].type, null);
  assert.doesNotThrow(() => structuredClone(outcome));
});

// ---- F2: LocalUnitExecutor -- the post-check must see the bindings the unit STILL holds ----------

test('F2: a participant evicted DURING findClashes discards the unit instead of evaluating it', async () => {
  const deps = makeExecutorDeps({});
  deps.world.script(() => {
    deps.world.evictModel(deps.models['mk-b']);   // the lease dies while the call is in flight
    return {
      pairs: [{ source: { modelId: 'mk-a', dbId: 10 }, target: { modelId: 'mk-b', dbId: 20 },
        type: 'volume-overlap', witness: null }],
      statistics: {},
    };
  });
  const outcome = await createLocalUnitExecutor(deps)(makeRequest({}));
  // Spec 16.3 item 1: "if it had already finished, discarded:scope-unverifiable (the post-check
  // cannot digest a dead binding)". Previously this returned evaluated/equal with the pair merged,
  // because the post-check re-used the pre-call binding map and a dead Model stays readable.
  assert.deepEqual([outcome.outcome, outcome.scopeProof, outcome.failure.code],
    ['discarded', 'unverifiable', 'scope-unverifiable']);
  assert.deepEqual(outcome.pairs, [], 'nothing from a unit whose input died may be merged');
});

test('F2: a participant RE-REGISTERED during the call is also not silently accepted', async () => {
  const deps = makeExecutorDeps({});
  deps.world.script(() => {
    // A reload: same modelKey, a DIFFERENT Model object, a fresh valid lease, bumped
    // bindingGeneration. `unregister` takes the Model, not the key. P1 refuses a same-key rebind to a
    // different modelVersion while the entry is still alive (the §4.2 identity contract), so the
    // reachable sequence is unregister-then-register -- which is exactly what a host reload does.
    // Spec §16.1: "the engine never re-binds mid-run"; §16.7 Table A U6 names a re-registered binding.
    deps.registry.unregister(deps.models['mk-b']);
    deps.registry.register('mk-b', { id: 'mk-b-reloaded' }, { modelVersion: 'v1' });
    return { pairs: [], statistics: {} };
  });
  const outcome = await createLocalUnitExecutor(deps)(makeRequest({}));
  assert.notEqual(outcome.outcome, 'evaluated', 'a unit must not settle evaluated against a re-bound model');
  assert.equal(outcome.scopeProof, 'unverifiable');
});

test('F2: the happy path is untouched -- a stable binding still reaches evaluated/equal', async () => {
  const deps = makeExecutorDeps({});
  deps.world.script(() => ({ pairs: [], statistics: {} }));
  const outcome = await createLocalUnitExecutor(deps)(makeRequest({}));
  assert.deepEqual([outcome.outcome, outcome.scopeProof], ['evaluated', 'equal']);
});

// ---- F11: the run never re-binds mid-run (16.1) -- a PRE-call reload is not executed against -----

test('F11: a model reloaded before the unit runs is skipped:model-evicted with NO library call', async () => {
  const deps = makeExecutorDeps({});
  const request = makeRequest({});
  // A host reload between the run snapshot and this unit: same modelKey, new Model, fresh valid
  // lease, bindingGeneration 1 -> 2. Spec 16.1: "the engine never re-binds mid-run"; 16.7 Table A U6
  // names a re-registered binding. Previously this ran findClashes against the replacement Model --
  // and no downstream rejection can un-issue a call that already happened.
  deps.registry.unregister(deps.models['mk-b']);
  deps.registry.register('mk-b', { id: 'mk-b-reloaded' }, { modelVersion: 'v1' });
  assert.equal(deps.registry.bindingFor('mk-b').bindingGeneration, 2, 'precondition: the generation moved');

  const outcome = await createLocalUnitExecutor(deps)(request);
  assert.deepEqual([outcome.outcome, outcome.failure.code, outcome.scopeProof],
    ['skipped', 'model-evicted', 'not-checked']);
  assert.deepEqual(outcome.failure.modelKeys, ['mk-b']);
  assert.equal(deps.world.calls.length, 0, 'the replacement Model must never reach findClashes');
});

test('F11: the fixture\'s run-start generations now match what P1\'s registry actually assigns', () => {
  const deps = makeExecutorDeps({});
  for (const entry of makeRequest({}).snapshot) {
    assert.equal(entry.bindingGeneration, deps.registry.bindingFor(entry.modelKey).bindingGeneration,
      `${entry.modelKey}: a fixture whose generations disagree with the registry tests nothing`);
  }
});

// ---- F12: pair-diagnostic operands must already be canonical (12.4's dedup key assumes it) -------

test('F12: a reversed pair-scope diagnostic is rejected as non-canonical', () => {
  const reversed = validateUnitOutcome(makeRequest({}), baseOutcome({ diagnostics: [{
    scope: 'pair', reason: 'inconclusive-crossing', completenessAffecting: true, attribution: 'element',
    // 'mk-b' sorts after 'mk-a', so first/second here are the wrong way round.
    fragments: { first: { modelKey: 'mk-b', dbId: 2, fragId: 2 }, second: { modelKey: 'mk-a', dbId: 1, fragId: 1 } },
  }] }));
  assert.equal(reversed.ok, false);
  assert.ok(reversed.issues.some((i) => i.code === 'diagnostic-pair-not-canonical'));
});

// ---- F3: validateUnitOutcome -- pair-scope diagnostic operands are validated ---------------------

test('F3: a pair-scope diagnostic\'s operands are validated exactly like a fragment-scope one', () => {
  const request = makeRequest({});
  const garbage = { modelKey: 'NOT-A-PARTICIPANT', dbId: -7, fragId: 'not-a-number', junkKey: 1 };
  const pairScoped = validateUnitOutcome(request, baseOutcome({ diagnostics: [{
    scope: 'pair', reason: 'inconclusive-crossing', completenessAffecting: true, attribution: 'element',
    fragments: { first: garbage, second: { modelKey: 42, dbId: {}, fragId: -1 } },
  }] }));
  assert.equal(pairScoped.ok, false, 'a pair-scope operand must not bypass the untrusting boundary');
  const codes = new Set(pairScoped.issues.map((i) => i.code));
  for (const code of ['fragment-unknown-key', 'fragment-invalid-modelkey', 'fragment-invalid-dbid', 'fragment-invalid-fragid']) {
    assert.ok(codes.has(code), `expected ${code}`);
  }
  assert.ok(pairScoped.issues.some((i) => i.path.startsWith('diagnostics[0].fragments.second')),
    'BOTH operands are walked, not just the first');
});

test('F3: a well-formed pair-scope diagnostic is still accepted', () => {
  const request = makeRequest({});
  const r = validateUnitOutcome(request, baseOutcome({ diagnostics: [{
    scope: 'pair', reason: 'inconclusive-crossing', completenessAffecting: true, attribution: 'element',
    fragments: { first: { modelKey: 'mk-a', dbId: 1, fragId: 1 }, second: { modelKey: 'mk-b', dbId: 2, fragId: 2 } },
  }] }));
  assert.deepEqual(r, { ok: true, issues: [] });
});

// ---- F4: validateUnitOutcome / validateExecutionRequest really never throw (row N8) --------------

test('F4: neither validator throws, even on a value whose stringification throws a hostile error', () => {
  const nastyError = { get message() { throw new Error('boom2'); } };
  const nasty = { toString() { throw nastyError; }, [Symbol.toPrimitive]() { throw nastyError; } };
  const request = makeRequest({});
  const outcome = validateUnitOutcome(request, baseOutcome({ outcome: nasty }));
  assert.equal(outcome.ok, false);
  assert.deepEqual(Object.keys(outcome).sort(), ['issues', 'ok'], 'row N8: exactly two fields, always');
  const req = validateExecutionRequest({ ...request, runId: nasty });
  assert.equal(req.ok, false);
  for (const issue of [...outcome.issues, ...req.issues]) assert.equal(typeof issue.detail, 'string');
});

test('F4: a Symbol in a validated position is described, not thrown on', () => {
  const r = validateUnitOutcome(makeRequest({}), baseOutcome({ scopeProof: Symbol('nope') }));
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => i.code === 'scopeproof-invalid-enum'));
});

// ---- F5: derived diagnostic fields are re-computed, not believed ---------------------------------

test('F5: a lying `completenessAffecting` is rejected (12.3 is the engine\'s fail-safe)', () => {
  const r = validateUnitOutcome(makeRequest({}), baseOutcome({ diagnostics: [{
    scope: 'fragment', reason: 'geometry-not-yet-available', completenessAffecting: false,
    attribution: 'element', fragment: { modelKey: 'mk-a', dbId: 1, fragId: 1 },
  }] }));
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => i.code === 'diagnostic-completenessaffecting-mismatch'));
});

test('F5: a lying `attribution` is rejected (it drives the taint table\'s kind)', () => {
  const r = validateUnitOutcome(makeRequest({}), baseOutcome({ diagnostics: [{
    scope: 'fragment', reason: 'inconclusive-crossing', completenessAffecting: true,
    attribution: 'element', fragment: { modelKey: null, dbId: null, fragId: 1 },
  }] }));
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => i.code === 'diagnostic-attribution-mismatch'));
});

// ---- F6: deriveUnitTaints -- row N9's documented `admit` default ---------------------------------

test('F6: `admit` defaults to () => true when omitted (register row N9)', () => {
  const d = { scope: 'fragment', reason: 'inconclusive-crossing', attribution: 'unit',
    fragment: { modelKey: 'mk-a', dbId: null, fragId: 1 } };
  const r = deriveUnitTaints([d], { maxElementTaintsPerUnit: 10 });
  assert.equal(r.overflowed, false);
  assert.equal(r.taints.length, 1);
});

// ---- F7: deriveUnitTaints -- one diagnostic implicates one owner exactly once --------------------

test('F7: a pair diagnostic whose two fragments share an owner counts that owner once', () => {
  const d = { scope: 'pair', reason: 'inconclusive-crossing', attribution: 'element',
    fragments: { first: { modelKey: 'm', dbId: 7, fragId: 1 }, second: { modelKey: 'm', dbId: 7, fragId: 2 } } };
  const r = deriveUnitTaints([d], { maxElementTaintsPerUnit: 2_000, admit: () => true });
  assert.deepEqual(r.taints, [{ kind: 'element', modelKey: 'm', dbId: 7, reason: 'inconclusive-crossing', occurrences: 1 }]);
});

test('F7: a pair diagnostic spanning two owners still implicates both', () => {
  const d = { scope: 'pair', reason: 'inconclusive-crossing', attribution: 'element',
    fragments: { first: { modelKey: 'm', dbId: 7, fragId: 1 }, second: { modelKey: 'm', dbId: 8, fragId: 2 } } };
  const r = deriveUnitTaints([d], { maxElementTaintsPerUnit: 2_000, admit: () => true });
  assert.deepEqual(r.taints.map((t) => t.dbId).sort(), [7, 8]);
  assert.deepEqual(r.taints.map((t) => t.occurrences), [1, 1]);
});

// ---- F8: the immutable reason sets cannot be mutated through forEach's third argument -------------

test('F8: `forEach` does not leak the underlying Set (the ONE predicate stays fixed)', () => {
  assert.equal(isCompletenessAffecting('inconclusive-crossing'), true);
  assert.throws(
    () => NON_COMPLETENESS_AFFECTING_REASONS.forEach((_v, _k, set) => set.add('inconclusive-crossing')),
    TypeError,
  );
  assert.equal(isCompletenessAffecting('inconclusive-crossing'), true, 'the predicate must be unchanged');
  assert.equal(NON_COMPLETENESS_AFFECTING_REASONS.has('witness-unavailable'), true, 'and still usable');
  assert.deepEqual([...NON_COMPLETENESS_AFFECTING_REASONS], ['witness-unavailable'], 'iteration still works');
});

// ---- F9: canonical pair order does not alias a legal '\uffff' modelKey ---------------------------

test('F9: a legal \'\\uffff\' modelKey no longer ties with an unresolved operand', () => {
  const table = createUnitBindingTable([{ modelKey: '\uffff', modelId: 1 }]);
  const project = (sourceId, targetId) => projectDiagnostic({
    scope: 'pair', reason: 'r',
    sourceFragment: { modelId: sourceId, dbId: 1, fragId: 5 },
    targetFragment: { modelId: targetId, dbId: 1, fragId: 5 },
  }, table).diagnostic;
  // Same pair, presented in both orientations: canonicalization must produce the same first/second.
  assert.deepEqual(project(1, 999).fragments, project(999, 1).fragments);
  assert.equal(project(1, 999).fragments.first.modelKey, '\uffff', 'a resolved operand sorts before a null one');
  assert.equal(project(1, 999).fragments.second.modelKey, null);
});

// ---- F10: the duplicated constants now have one owner each ---------------------------------------

test('F10: MAX_NESTED_STRING_CODE_UNITS is one value, re-exported, not two copies', () => {
  assert.equal(MAX_NESTED_FROM_UNIT_EXECUTOR, MAX_NESTED_FROM_DIAGNOSTICS);
  assert.equal(MAX_NESTED_FROM_UNIT_EXECUTOR, 128);
});

test('F10: the capacityDetails key list is shared by its producer and its validator', () => {
  // The producer (`classifyLibraryError`) now imports this exact frozen list, so a key it can emit is
  // by construction a key `checkFailure` accepts -- they can no longer drift apart.
  assert.deepEqual([...CAPACITY_DETAILS_KEYS], ['currentSize', 'missing', 'requested', 'limit']);
  assert.ok(Object.isFrozen(CAPACITY_DETAILS_KEYS));
});
