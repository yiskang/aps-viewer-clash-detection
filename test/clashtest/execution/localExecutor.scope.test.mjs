// test/clashtest/execution/localExecutor.scope.test.mjs
//
// Task P4.8: §7.4 lease handling and §16.3.2's bracketed scope-digest protocol.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyClashResult } from '../support/index.mjs';                          // P0
import { makeRequest, makeExecutorDeps } from '../support/executionRequests.mjs';  // P4-local
import { createLocalUnitExecutor } from '../../../clashtest/execution/LocalUnitExecutor.js';
import { validateUnitOutcome } from '../../../clashtest/execution/UnitExecutor.js';

const ok = emptyClashResult;
const exec = (deps) => createLocalUnitExecutor(deps);
const digestCalls = (enumerator) => enumerator.calls.filter((c) => c.kind === 'digestScope');

test('an invalid lease skips the unit WITHOUT calling findClashes', async () => {
  const deps = makeExecutorDeps({});
  deps.world.evictModel(deps.models['mk-b']);   // P1's lease world: the real eviction path
  const outcome = await exec(deps)(makeRequest({}));
  assert.deepEqual([outcome.outcome, outcome.failure.code, outcome.scopeProof], ['skipped', 'model-evicted', 'not-checked']);
  assert.deepEqual(outcome.failure.modelKeys, ['mk-b']);
  assert.equal(deps.world.calls.length, 0, 'avoids a ModelEvictedError from admitModel and wasted work (F5)');
});

test('a lease that dies DURING the pre-check bracket (not before it) still skips, never calls findClashes', async () => {
  // The pre-check bracket is itself async (`ctx.checkpoint` -> `yieldToScheduler`), so the initial
  // lease read (`unheld`, taken before the bracket) can go stale while the bracket runs. Fixed by a
  // second, synchronous re-check immediately before the call (internal review 2026-09-22, pre-existing
  // gap, not a C1 regression -- the window was identical before that remediation).
  const deps = makeExecutorDeps({});
  deps.enumerator.onCall(() => { deps.world.evictModel(deps.models['mk-b']); });
  const outcome = await exec(deps)(makeRequest({}));
  assert.deepEqual([outcome.outcome, outcome.failure.code, outcome.scopeProof], ['skipped', 'model-evicted', 'not-checked']);
  assert.deepEqual(outcome.failure.modelKeys, ['mk-b']);
  assert.equal(deps.world.calls.length, 0, 'the call must never be issued once the second check catches the death');
  assert.deepEqual(validateUnitOutcome(makeRequest({}), outcome), { ok: true, issues: [] });
});

test('a lease that dies DURING the post-check bracket settles unverifiable, never equal, and merges nothing (H1.4)', async () => {
  // The post-check bracket is itself async, so the pre-bracket `bindingsStillHeld` snapshot (taken
  // synchronously as the bracket's own argument) can go stale while the bracket runs -- the identical
  // TOCTOU shape the pre-check race fix above closes, but never applied to the post-check side until
  // this fix (independent-review adjudication, H1.4, owner-authorized remediation 2026-09-22).
  // Without the fix this settled `evaluated`/`equal` with a pair MERGED from the dead model.
  const deps = makeExecutorDeps({});
  let findClashesCalled = false;
  deps.world.script(() => { findClashesCalled = true; return ok(); });
  deps.enumerator.onCall(() => { if (findClashesCalled) deps.world.evictModel(deps.models['mk-b']); });
  const outcome = await exec(deps)(makeRequest({}));
  assert.deepEqual([outcome.outcome, outcome.failure.code, outcome.scopeProof], ['discarded', 'scope-unverifiable', 'unverifiable']);
  assert.deepEqual(outcome.failure.modelKeys, ['mk-b']);
  assert.deepEqual(outcome.pairs, [], 'nothing from the dead model may be merged');
  assert.equal(deps.world.calls.length, 1, 'the call was already issued before the death -- this is a post-check settlement, not a skip');
  assert.deepEqual(validateUnitOutcome(makeRequest({}), outcome), { ok: true, issues: [] });
});

test('a pre-check digest mismatch is skipped:scope-drift and issues no call', async () => {
  const deps = makeExecutorDeps({});
  // P0's fake enumerator: `set(modelKey, patch)` mutates the configured content, which is exactly
  // "the model changed between planning and execution".
  deps.enumerator.set('mk-b', { roots: [{ dbId: 20, fragmentCount: 1, ownerDbIds: [20], subtreeDigest: 'sha256:CHANGED' }] });
  const outcome = await exec(deps)(makeRequest({}));
  assert.deepEqual([outcome.outcome, outcome.failure.code, outcome.scopeProof], ['skipped', 'scope-drift', 'drift']);
  assert.deepEqual(outcome.failure.modelKeys, ['mk-b']);
  assert.equal(deps.world.calls.length, 0);
});

test('a post-check mismatch DISCARDS: pairs and diagnostics are not merged', async () => {
  const deps = makeExecutorDeps({});
  deps.world.script((query, call) => {
    deps.enumerator.set('mk-b', { roots: [{ dbId: 20, fragmentCount: 1, ownerDbIds: [20], subtreeDigest: 'sha256:CHANGED' }] });
    return {
      pairs: [{ source: { modelId: 1, dbId: 10, model: {} }, target: { modelId: 2, dbId: 20, model: {} }, type: 'volume-overlap', witness: null }],
      statistics: { diagnostics: [{ scope: 'fragment', reason: 'inconclusive-crossing', role: 'source', fragment: { modelId: 1, dbId: 10, fragId: 1 } }] },
    };
  });
  const outcome = await exec(deps)(makeRequest({}));
  assert.deepEqual([outcome.outcome, outcome.failure.code, outcome.scopeProof], ['discarded', 'scope-drift', 'drift']);
  assert.deepEqual(outcome.pairs, []);
  assert.deepEqual(outcome.diagnostics, []);
});

test('a digest that cannot be computed fails CLOSED to scope-unverifiable, pre and post', async () => {
  for (const [firstFailingCall, expected] of [[1, 'skipped'], [3, 'discarded']]) {
    const deps = makeExecutorDeps({});
    deps.world.script(ok);
    // P0's `onCall(fn)` runs inside every enumerator call: the 1st digestScope is the pre-check's
    // first scope, the 3rd is the post-check's first (two scopes per bracket).
    deps.enumerator.onCall((call) => { if (call.index + 1 >= firstFailingCall) throw new Error('digest unavailable'); });
    const outcome = await exec(deps)(makeRequest({}));
    assert.deepEqual([outcome.outcome, outcome.failure.code, outcome.scopeProof], [expected, 'scope-unverifiable', 'unverifiable']);
  }
});

test('every scope of the unit is re-digested twice, bracketing the call', async () => {
  // The CONTENT of the expectation — including R20-1's whole-model-source population entry — is
  // P3's (`materializeUnit`), and its rule is tested there. What P4 owns, and what this pins, is
  // that the executor brackets the call with the unit's WHOLE `scopeExpect`, pre and post.
  //
  // DEVIATION FROM PLAN SKETCH (verified by running the plan's own literal digest string):
  // `'sha256:p'` does not match `planning/ElementEnumerator.js`'s durable digest pattern
  // (`/^sha256:[0-9a-f]{64}$/`, spec 5.4), so `scopeDigest.js`'s `isWholePopulation` rejects the
  // expectation itself as malformed BEFORE any comparison; `checkScopeBracket` then never calls
  // `enumerator.digestScope` for that entry at all (a malformed expectation is `unverifiable` by
  // construction), which makes the whole pre-check bracket `unverifiable` and short-circuits the
  // unit to `skipped` before `world.findClashes` -- so only mk-b's ONE pre-check call is ever
  // recorded, not the four this test exists to pin (confirmed by running the plan's own literal
  // code). Fixed with a well-formed 64-hex-digit digest, and the fake enumerator's `mk-a` content is
  // set to match it so the pre-check actually reaches `proof: 'equal'` and execution proceeds to the
  // library call and the post-check, exercising all four digestScope calls this test asserts.
  const deps = makeExecutorDeps({});
  deps.world.script(ok);
  const validDigest = `sha256:${'0'.repeat(64)}`;
  deps.enumerator.set('mk-a', { population: { count: 3, digest: validDigest } });
  await exec(deps)(makeRequest({ scopeExpect: [
    { modelKey: 'mk-a', role: 'source', scope: 'whole', population: { count: 3, digest: validDigest } },
    { modelKey: 'mk-b', role: 'target', scope: 'roots', roots: [{ dbId: 20, subtreeDigest: 'sha256:c' }] },
  ] }));
  assert.deepEqual(digestCalls(deps.enumerator).map((c) => `${c.modelKey}:${c.scope === 'whole' ? 'whole' : 'roots'}`),
    ['mk-a:whole', 'mk-b:roots', 'mk-a:whole', 'mk-b:roots']);
});

// ---- 'scopeProof equal is the ONLY path to evaluated' (invariant I-scope) ------------------------
//
// The plan describes this test's data (a cross-product of {pre ok/drift/unverifiable} x
// {post ok/drift/unverifiable} x {call resolves/throws}) in prose only, with no literal
// SCOPE_SCENARIOS/runScenario code sample. This is this file's own construction of that intent.
//
// A pre-check that is not 'equal' short-circuits BEFORE `world.findClashes` is ever called, so the
// post-check is structurally unreachable whenever `pre !== 'ok'` -- the meaningful matrix is
// {pre: drift, unverifiable} (each a single terminal case) union {pre: ok} x {post: ok/drift/
// unverifiable} x {call: resolves/throws one of §7.5's signals}.
const CALL_OK = Symbol('call-ok');
const DRIFTED_MK_B = { roots: [{ dbId: 20, fragmentCount: 1, ownerDbIds: [20], subtreeDigest: 'sha256:CHANGED' }] };

function scenarioError(kind) {
  const e = new Error(`${kind} happened`);
  e.name = kind;
  return e;
}

async function runScenario({ pre, post, call }) {
  const deps = makeExecutorDeps({});
  if (pre !== 'ok') {
    if (pre === 'drift') deps.enumerator.set('mk-b', DRIFTED_MK_B);
    else deps.enumerator.onCall((c) => { if (c.index === 0) throw new Error('digest unavailable'); });
    deps.world.script(ok);   // never reached; harmless if it were
    return exec(deps)(makeRequest({}));
  }
  if (post === 'unverifiable') {
    deps.enumerator.onCall((c) => { if (c.index >= 2) throw new Error('digest unavailable'); });
  }
  const step = () => {
    if (post === 'drift') deps.enumerator.set('mk-b', DRIFTED_MK_B);
    if (call === CALL_OK) return ok();
    throw scenarioError(call);
  };
  deps.world.script(step);
  return exec(deps)(makeRequest({}));
}

const SCOPE_SCENARIOS = [
  { pre: 'drift', post: 'ok', call: CALL_OK },
  { pre: 'unverifiable', post: 'ok', call: CALL_OK },
  { pre: 'ok', post: 'ok', call: CALL_OK },
  { pre: 'ok', post: 'drift', call: CALL_OK },
  { pre: 'ok', post: 'unverifiable', call: CALL_OK },
  { pre: 'ok', post: 'ok', call: 'WorldDisposedError' },
  { pre: 'ok', post: 'ok', call: 'ModelEvictedError' },
  { pre: 'ok', post: 'ok', call: 'Error' },
  { pre: 'ok', post: 'drift', call: 'WorldDisposedError' },
  { pre: 'ok', post: 'unverifiable', call: 'Error' },
];

test('scopeProof equal is the ONLY path to evaluated (invariant I-scope)', async () => {
  for (const o of await Promise.all(SCOPE_SCENARIOS.map(runScenario))) {
    if (o.outcome === 'evaluated') assert.equal(o.scopeProof, 'equal');
    if (o.scopeProof !== 'equal') assert.notEqual(o.outcome, 'evaluated');
  }
});

test('generations are read at attempt start and end and list every participant exactly once', async () => {
  const deps = makeExecutorDeps({});
  deps.world.script(ok);
  const outcome = await exec(deps)(makeRequest({}));
  for (const side of ['start', 'end']) assert.deepEqual(outcome.generations[side].map((g) => g.modelKey), ['mk-a', 'mk-b']);
});

// ================================================================================================
// §16.7 Table A settlement precedence -- C1 remediation (owner-authorized 2026-09-22, Option B).
//
// Regression suite for the three violations recorded in
// docs/reviews/2026-09-22-federated-clash-test-core-p4-internal-codex-review.md § "C1".
//
// The frozen spec's §16.7 Table A part A is NORMATIVE and orders the facts of one attempt:
//   U1 world-disposed > U2 internal-error > U3 result-cap > U4 input-changed >
//   U5 scope-drift    > U6 model-evicted  > U7 scope-unverifiable > U8 everything else.
//
// Option (B) is fact-preserving and changes NO schema: the executor always reports BOTH facts --
// `failure.code` is always the classified thrown cause, `scopeProof` is always the true bracket
// answer -- and only the coarse outcome KIND is chosen by comparing Table-A ranks. P6's accepted
// `factsFromOutcome` resolver reads the two independently, so nothing is destroyed at the boundary.
// Every case below therefore asserts the FULL triple, not just the outcome kind, and every one of
// them is put through `validateUnitOutcome`: a legally-shaped closed-schema outcome is the bar.
// ================================================================================================

/** Bumps `mk-b`'s placementGeneration through P1's real registry (§16.2), so `generations.end` moves. */
const movePlacement = (deps) => { deps.registry.notifyPlacementChanged('mk-b'); };

/**
 * Runs one post-check collision: the library call throws `throws()` while, in the same step, the
 * world/registry/enumerator is mutated so the POST bracket answers `post`.
 *   - `post: 'drift'`         -- `mk-b`'s content changes under the enumerator.
 *   - `post: 'unverifiable'`  -- the participant named by `evict` really dies mid-call, so
 *     `bindingsStillHeld` maps it to `null` and `checkScopeBracket` can only answer 'unverifiable'.
 */
async function runPostCollision({ post, throws, evict = null, during = null }) {
  const deps = makeExecutorDeps({});
  const request = makeRequest({});
  deps.world.script(() => {
    if (post === 'drift') deps.enumerator.set('mk-b', DRIFTED_MK_B);
    if (evict !== null) deps.world.evictModel(deps.models[evict]);
    if (during !== null) during(deps);
    throw throws();
  });
  return { outcome: await exec(deps)(request), request, deps };
}

const POST_COLLISIONS = [
  // --- C1 violation 1: U1-U4 were masked by U5 drift, flipping run status `failed` -> `invalidated`.
  { name: 'U1 world-disposed beats U5 scope-drift',
    args: { post: 'drift', throws: () => scenarioError('WorldDisposedError') },
    expect: ['failed', 'world-disposed', 'drift'] },
  { name: 'U2 internal-error (an unmapped throw) beats U5 scope-drift',
    args: { post: 'drift', throws: () => new Error('something unmapped') },
    expect: ['failed', 'internal-error', 'drift'] },
  { name: 'U4 input-changed (placement generation MOVED) beats U5 scope-drift',
    args: { post: 'drift', throws: () => scenarioError('ModelPlacementChangedError'), during: movePlacement },
    expect: ['discarded', 'input-changed', 'drift'] },
  // --- C1 violation 2: U7 unverifiable returned before classification, so it masked U6 too.
  { name: 'U6 model-evicted beats U7 scope-unverifiable (previously masked)',
    args: { post: 'unverifiable', evict: 'mk-b', throws: () => scenarioError('ModelEvictedError') },
    expect: ['failed', 'model-evicted', 'unverifiable'] },
  // --- The fact-preserving direction: the scope fact legitimately wins the KIND, and the thrown
  //     cause survives in `failure.code` instead of being destroyed.
  { name: 'U5 scope-drift beats U6 model-evicted, and the model-evicted fact survives',
    args: { post: 'drift', evict: 'mk-a', throws: () => scenarioError('ModelEvictedError') },
    expect: ['discarded', 'model-evicted', 'drift'] },
  { name: 'U5 scope-drift beats the U8 bucket, and the capacity fact survives (the recorded residual)',
    args: { post: 'drift', throws: () => scenarioError('CapacityExceededError') },
    expect: ['discarded', 'capacity-exceeded', 'drift'] },
];

test('§16.7 Table A: a thrown cause and a non-equal bracket are BOTH reported (C1, Option B)', async () => {
  for (const { name, args, expect } of POST_COLLISIONS) {
    const { outcome, request } = await runPostCollision(args);
    assert.deepEqual([outcome.outcome, outcome.failure.code, outcome.scopeProof], expect, name);
    // Neither fact may be silently dropped, and a non-evaluated outcome never merges anything.
    assert.deepEqual([outcome.pairs, outcome.diagnostics], [[], []], name);
    assert.deepEqual(validateUnitOutcome(request, outcome), { ok: true, issues: [] }, name);
  }
});

test('§16.7 Table A: U4 input-changed is proved by a real generation move, not by the error alone', async () => {
  // The U4 row above only outranks drift because the placement generation genuinely MOVED. Without
  // the move the same error is U8 `stale-placement`, and then drift wins the kind -- pinning that
  // the rank comparison reads the classified cause, never the error's name.
  const { outcome } = await runPostCollision({ post: 'drift', throws: () => scenarioError('ModelPlacementChangedError'), during: movePlacement });
  const moved = outcome.generations.start.find((g) => g.modelKey === 'mk-b').placementGeneration
    !== outcome.generations.end.find((g) => g.modelKey === 'mk-b').placementGeneration;
  assert.equal(moved, true);

  const stale = await runPostCollision({ post: 'drift', throws: () => scenarioError('ModelPlacementChangedError') });
  assert.deepEqual([stale.outcome.outcome, stale.outcome.failure.code, stale.outcome.scopeProof],
    ['discarded', 'stale-placement', 'drift']);
  assert.deepEqual(validateUnitOutcome(stale.request, stale.outcome), { ok: true, issues: [] });
});

test('C1 violation 3: a live participant\'s pre-check drift (U5) beats another\'s dead lease (U6)', async () => {
  // Reproduces the review's exact two-participant shape: `mk-a`'s lease is dead AND `mk-b`'s scope
  // changed. The gate used to return `skipped:model-evicted` / `not-checked` with ZERO digest calls.
  const deps = makeExecutorDeps({});
  const request = makeRequest({});
  deps.world.evictModel(deps.models['mk-a']);
  deps.enumerator.set('mk-b', DRIFTED_MK_B);

  const outcome = await exec(deps)(request);
  assert.deepEqual([outcome.outcome, outcome.failure.code, outcome.scopeProof], ['skipped', 'scope-drift', 'drift']);
  assert.deepEqual(outcome.failure.modelKeys, ['mk-b'], 'the DRIFTED model, not the dead one');
  assert.equal(deps.world.calls.length, 0, 'still not issued: the unit is skipped either way');
  assert.ok(digestCalls(deps.enumerator).length > 0, 'the pre-check bracket now actually runs');
  assert.deepEqual(validateUnitOutcome(request, outcome), { ok: true, issues: [] });
});

test('the re-bound (H5) participant is never digested even though the bracket now always runs', async () => {
  // The pre-check bracket runs against a COPY of `resolved.byKey` with every unheld participant
  // forced to `null`. For a RE-REGISTERED model `bindingFor` hands back a live binding for the WRONG
  // model, and digesting it would be the §16.1 "never re-binds mid-run" violation H5 exists to stop.
  const deps = makeExecutorDeps({});
  const request = makeRequest({});
  deps.registry.unregister(deps.models['mk-b']);
  deps.registry.register('mk-b', { id: 'mk-b-reloaded' }, { modelVersion: 'v1' });

  const outcome = await exec(deps)(request);
  assert.deepEqual([outcome.outcome, outcome.failure.code, outcome.scopeProof], ['skipped', 'model-evicted', 'not-checked']);
  assert.deepEqual(outcome.failure.modelKeys, ['mk-b']);
  assert.equal(deps.world.calls.length, 0);
  assert.equal(digestCalls(deps.enumerator).filter((c) => c.modelKey === 'mk-b').length, 0,
    'the re-registered model is never handed to the enumerator');
  assert.deepEqual(validateUnitOutcome(request, outcome), { ok: true, issues: [] });
});

test('the no-throw settlements and the happy path are unchanged by the Table A ordering', async () => {
  // The fix must not move a single case where there is no thrown cause to weigh.
  const NO_THROW = [
    { scenario: { pre: 'drift', post: 'ok', call: CALL_OK }, expect: ['skipped', 'scope-drift', 'drift'] },
    { scenario: { pre: 'unverifiable', post: 'ok', call: CALL_OK }, expect: ['skipped', 'scope-unverifiable', 'unverifiable'] },
    { scenario: { pre: 'ok', post: 'drift', call: CALL_OK }, expect: ['discarded', 'scope-drift', 'drift'] },
    { scenario: { pre: 'ok', post: 'unverifiable', call: CALL_OK }, expect: ['discarded', 'scope-unverifiable', 'unverifiable'] },
  ];
  const request = makeRequest({});
  for (const { scenario, expect } of NO_THROW) {
    const outcome = await runScenario(scenario);
    assert.deepEqual([outcome.outcome, outcome.failure.code, outcome.scopeProof], expect, JSON.stringify(scenario));
    assert.deepEqual(validateUnitOutcome(request, outcome), { ok: true, issues: [] }, JSON.stringify(scenario));
  }

  const happy = await runScenario({ pre: 'ok', post: 'ok', call: CALL_OK });
  assert.deepEqual([happy.outcome, happy.failure, happy.scopeProof], ['evaluated', null, 'equal']);
  assert.deepEqual(validateUnitOutcome(request, happy), { ok: true, issues: [] });

  // A thrown cause with an EQUAL bracket keeps its own kind and reports `scopeProof: 'equal'`, which
  // is byte-for-byte what the pre-fix code did on this path.
  for (const [call, expect] of [['WorldDisposedError', ['failed', 'world-disposed', 'equal']],
    ['ModelEvictedError', ['failed', 'model-evicted', 'equal']],
    ['Error', ['failed', 'internal-error', 'equal']]]) {
    const outcome = await runScenario({ pre: 'ok', post: 'ok', call });
    assert.deepEqual([outcome.outcome, outcome.failure.code, outcome.scopeProof], expect, call);
    assert.deepEqual(validateUnitOutcome(request, outcome), { ok: true, issues: [] }, call);
  }
});
