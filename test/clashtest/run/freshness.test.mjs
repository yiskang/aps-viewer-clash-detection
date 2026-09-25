// test/clashtest/run/freshness.test.mjs
//
// Task P6.7: `getFreshness` — two scope passes between three registry snapshots (spec §16.4).
//
// This test file follows the task brief's Step 1 almost verbatim, with three deviations forced by
// the REAL test-support code already in this repo (traced by hand, and independently confirmed by
// a codex-advisor consult before implementation — see the P6.7 report):
//
//  1. The brief's placeholder digests ('sha256:x', 'sha256:y', ...) are not well-formed
//     (clashtest/planning/ElementEnumerator.js: DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/). A
//     malformed WHOLE-scope expectation fails `expectationOk` in scopeDigest.js and is treated as
//     "not a usable expectation" -- `checkScopeBracket` never even calls the enumerator for it, and
//     folds it straight into `unverifiable`. That breaks the very first live-world test (it would
//     see `enumerator.calls.length` short by half, and `state: 'unverifiable'` instead of
//     `'current'`). Every digest here is a real sha256 hex digest instead (helper `D(label)`).
//  2. `createFakeEnumerator`'s call record field is `kind`, not `method`, and `checkScopeBracket`
//     only ever calls `enumerator.digestScope` -- so the brief's `method === 'digestScope'` guard is
//     rewritten as the equivalent `kind === 'digestScope'` (always true in this context; kept for
//     readability/documentation of intent rather than dropped outright).
//  3. `enumerator.onCall(fn)` is a single-hook SETTER (a second call replaces the first, it does not
//     queue) and `call.index` is a GLOBAL, monotonic call counter that never resets between passes.
//     The brief's "pass2" test relies on two independent onCall registrations and on `index === 0`
//     firing more than once; neither holds. It is rewritten as ONE hook that fires exactly once, the
//     first time index has moved past a full pass's worth of calls AND the model being digested is
//     Y -- i.e. "somewhere during pass 2's processing of Y" -- which is exactly what the test's own
//     name asserts. Two more tests relied on a `models.set(key, { throws })` field `fakeEnumerator`
//     never reads; both are rewritten using the SAME `onCall`-throws idiom this repo already uses
//     elsewhere (e.g. test/clashtest/execution/localExecutor.scope.test.mjs) to simulate "the
//     enumerator cannot read this model's tree".
//
// `provenance.models` itself stays exactly P5's real shape (`scopeDigests: {population, roots}`,
// no extra fields) -- `liveWorld` below projects it into the modelKey-keyed record
// `createFakeEnumerator` expects, rather than the sealed fixture smuggling in enumerator-only
// fields.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { getFreshness, sealedScopeExpect } from '../../../clashtest/run/freshness.js';
import { freshnessStateOf, canClaimNoClashes, assessNoClashClaim }           // P5 (A16/R3)
  from '../../../clashtest/results/claim.js';
import { createFakeEnumerator } from '../support/index.mjs';                 // P0 (A18)
import { createPlacementRegistry } from '../support/placementRegistry.mjs';  // P6, additive
import { createSealedSetFixture } from '../support/sealedSetFixture.mjs';    // P6, over P5's shape

const D = (label) => `sha256:${createHash('sha256').update(label).digest('hex')}`;   // spec 5.4

const twoModelSet = () => createSealedSetFixture({
  registrySessionId: 'sess-1',
  models: [
    { modelKey: 'X', modelVersion: 'v1', bindingGeneration: 1, placementGeneration: 1,
      population: { count: 2, digest: D('x-population') }, roots: [{ dbId: 1, subtreeDigest: D('x1') }] },
    { modelKey: 'Y', modelVersion: 'v1', bindingGeneration: 1, placementGeneration: 1,
      population: { count: 2, digest: D('y-population') }, roots: [{ dbId: 1, subtreeDigest: D('y1') }] },
  ],
});

/** Project the SEALED scope digests into a live world identical to what was sealed (a test then
 *  diverges it, via the returned enumerator's own `set(modelKey, patch)` / `onCall(fn)`). */
const liveWorld = (set) => createFakeEnumerator({
  models: Object.fromEntries(set.provenance.models.map((m) => [
    m.modelKey,
    {
      population: m.scopeDigests.population,
      roots: m.scopeDigests.roots.map((r) => ({ ...r, fragmentCount: 1, ownerDbIds: [r.dbId] })),
    },
  ])),
});

test('the read-time expectation is projected from the SEALED provenance, not from a plan', () => {
  const set = twoModelSet();
  const expect = sealedScopeExpect(set.provenance.models);
  assert.deepEqual(expect.map((e) => `${e.modelKey}/${e.scope}`),
    ['X/whole', 'X/roots', 'Y/whole', 'Y/roots']);
  assert.equal(Object.isFrozen(expect[0]), true);
  assert.equal(expect.every((e) => e.role === 'recorded'), true,
    'no planning role survives into a sealed set; the label is opaque to the comparator');
});

test('an unchanged world is current, and costs exactly two passes and three snapshots', async () => {
  const set = twoModelSet();
  const registry = createPlacementRegistry(set);
  const enumerator = liveWorld(set);
  const f = await getFreshness(set, { registry, enumerator });
  assert.deepEqual(f, { state: 'current', reasons: [] });
  assert.equal(Object.isFrozen(f), true);
  assert.equal(registry.snapshotCalls.length, 3, 'snapshot1, snapshot2, snapshot3');
  assert.equal(enumerator.calls.length, 2 * sealedScopeExpect(set.provenance.models).length,
    'exactly two passes over every recorded scope');
});

test('C4: a placement change COMPLETED BEFORE snapshot1 is stale, not current', async () => {
  const set = twoModelSet();
  const registry = createPlacementRegistry(set);
  registry.notifyPlacementChanged('X');                 // the host told us, then called us
  const f = await getFreshness(set, { registry, enumerator: liveWorld(set) });
  assert.equal(f.state, 'stale', 'all three live snapshots agree — only the SEALED value differs');
  assert.deepEqual(f.reasons, ['placement-changed:X']);
});

test('C4: a RELOAD completed before snapshot1 is stale, not current', async () => {
  const set = twoModelSet();
  const registry = createPlacementRegistry(set);
  registry.reload('X');                                  // bindingGeneration bump, same content
  const f = await getFreshness(set, { registry, enumerator: liveWorld(set) });
  assert.equal(f.state, 'stale');
  assert.deepEqual(f.reasons, ['model-reloaded:X']);
});

test('a model changed BETWEEN pass1 and pass2 is caught by the second pass', async () => {
  const set = twoModelSet();
  const registry = createPlacementRegistry(set);
  const enumerator = liveWorld(set);
  // X is digested first; mutate X while Y is being digested in pass 1 -> pass 2 disagrees.
  enumerator.onCall(({ modelKey, kind }) => {
    if (kind === 'digestScope' && modelKey === 'Y') {
      enumerator.set('X', { population: { count: 3, digest: D('x-grown') } });
    }
  });
  const f = await getFreshness(set, { registry, enumerator });
  assert.equal(f.state, 'stale');
  assert.deepEqual(f.reasons, ['scope-drift:X']);
});

test('a placement change landing DURING pass2 is caught only by snapshot3', async () => {
  const set = twoModelSet();
  const registry = createPlacementRegistry(set);
  const enumerator = liveWorld(set);
  const perPass = sealedScopeExpect(set.provenance.models).length;   // 4: X-whole,X-roots,Y-whole,Y-roots
  let fired = false;
  // Global call index runs 0..2*perPass-1 (pass1 then pass2, back to back, same 4 entries each).
  // The first call whose index is >= perPass is pass 2's first entry; firing on Y specifically lands
  // the change partway through pass 2 -- after snapshot2 (already taken) and before snapshot3.
  enumerator.onCall(({ modelKey, index }) => {
    if (!fired && index >= perPass && modelKey === 'Y') {
      fired = true;
      registry.notifyPlacementChanged('X');
    }
  });
  const f = await getFreshness(set, { registry, enumerator });
  assert.equal(f.state, 'stale');
  assert.deepEqual(f.reasons, ['placement-changed:X']);
  assert.equal(registry.snapshotCalls.length, 3);
});

test('an UNRELATED model registered between the snapshots leaves the result current', async () => {
  const set = twoModelSet();
  const registry = createPlacementRegistry(set);
  registry.onSnapshot(2, () => registry.register('Z', {}, { modelVersion: 'v1' }));
  const f = await getFreshness(set, { registry, enumerator: liveWorld(set) });
  assert.equal(f.state, 'current', 'only TOUCHED bindings matter (§16.4)');
});

test('a dead binding, a reload and a modelVersion conflict are each stale with their own reason', async () => {
  for (const [mutate, reason] of [
    [(r) => r.unregisterKey('X'), 'model-evicted:X'],     // null: dead, unregistered or lease-invalid
    [(r) => r.reload('X'), 'model-reloaded:X'],
    [(r) => r.setVersion('X', 'v2'), 'model-version-conflict:X'],
  ]) {
    const set = twoModelSet();
    const registry = createPlacementRegistry(set);
    mutate(registry);
    const f = await getFreshness(set, { registry, enumerator: liveWorld(set) });
    assert.equal(f.state, 'stale', reason);
    assert.ok(f.reasons.includes(reason), `${reason} not in ${f.reasons}`);
  }
});

test('no enumerator, or an uncomputable digest, is at best unverifiable — never current', async () => {
  const set = twoModelSet();
  assert.equal((await getFreshness(set, { registry: createPlacementRegistry(set) })).state, 'unverifiable');
  const broken = liveWorld(set);
  broken.onCall(({ modelKey }) => { if (modelKey === 'X') throw new Error('tree unavailable'); });
  const f = await getFreshness(set, { registry: createPlacementRegistry(set), enumerator: broken });
  assert.equal(f.state, 'unverifiable');
  assert.ok(f.reasons.includes('scope-unverifiable:X'));
});

test('a definite change BEATS "could not tell"', async () => {
  const set = twoModelSet();
  const registry = createPlacementRegistry(set);
  registry.notifyPlacementChanged('X');
  const broken = liveWorld(set);
  broken.onCall(({ modelKey }) => { if (modelKey === 'Y') throw new Error('tree unavailable'); });
  const f = await getFreshness(set, { registry, enumerator: broken });
  assert.equal(f.state, 'stale', 'stale wins over unverifiable when both are observed');
});

test('a set from a DIFFERENT registry session is unverifiable, but a version conflict still makes it stale', async () => {
  const set = twoModelSet();
  const other = createPlacementRegistry(set, { registrySessionId: 'some-other-session' });
  assert.equal((await getFreshness(set, { registry: other, enumerator: liveWorld(set) })).state, 'unverifiable');
  other.setVersion('X', 'v2');
  const f = await getFreshness(set, { registry: other, enumerator: liveWorld(set) });
  assert.equal(f.state, 'stale');
  assert.ok(f.reasons.includes('model-version-conflict:X'));
});

test('a cross-session set does NOT report a foreign generation as placement-changed', async () => {
  // Generation counters are session-local (§13.2 `placementVerified: false`); comparing them
  // across lifetimes would manufacture a reason rather than report one.
  const set = twoModelSet();
  const other = createPlacementRegistry(set, { registrySessionId: 'some-other-session' });
  other.notifyPlacementChanged('X');
  const f = await getFreshness(set, { registry: other, enumerator: liveWorld(set) });
  assert.equal(f.state, 'unverifiable');
  assert.deepEqual(f.reasons, ['registry-session-mismatch']);
});

test('the result is the OBJECT P5\'s claim helpers accept, and its state is what §8.3 digests', async () => {
  const set = twoModelSet();
  const registry = createPlacementRegistry(set);
  registry.notifyPlacementChanged('X');
  const f = await getFreshness(set, { registry, enumerator: liveWorld(set) });
  assert.deepEqual(Object.keys(f).sort(), ['reasons', 'state']);      // R3
  assert.equal(freshnessStateOf(f), 'stale');                         // A16, P5's one adapter
  assert.equal(canClaimNoClashes(set, f), false, 'not current ⇒ not claimable');
  assert.ok(assessNoClashClaim(set, f).qualifiers.some((q) => JSON.stringify(q).includes('placement-changed:X')),
    'the object form carries its reasons into the refusal (§16.4 "with reasons")');
});

test('DOCUMENTED LIMIT (OQ-19, §16.3 item 5): an A->B->A excursion between the two passes is NOT detected', async () => {
  // This asserts the ACCEPTED residual, not a defect: a population that changes and reverts wholly
  // between pass1 and pass2 is invisible to any caller-side mechanism (F18). If this test ever
  // fails because the result became `stale`, the proof got STRONGER — update the test and
  // provenance.scopeProof.method deliberately, do not weaken the check back.
  const set = twoModelSet();
  const registry = createPlacementRegistry(set);
  const enumerator = liveWorld(set);
  let fired = false;
  enumerator.onCall(({ modelKey }) => {
    if (modelKey === 'Y' && !fired) {
      fired = true;
      enumerator.set('X', { population: { count: 3, digest: D('x-B') } });          // A -> B
      enumerator.set('X', { population: { count: 2, digest: D('x-population') } }); // B -> A
    }
  });
  const f = await getFreshness(set, { registry, enumerator });
  assert.equal(f.state, 'current', 'accepted residual: the bracket is not continuous');
  assert.equal(set.provenance.scopeProof.method, 'bracketed-digest');
});
