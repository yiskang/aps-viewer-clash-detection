// test/clashtest/engine/claim.test.mjs
//
// Task P7.6: the engine's freshness and claim surface — `getFreshness`, `canClaimNoClashes`,
// `assessNoClashClaim` (spec §18, §8.3, §16.4, AC-8, AC-20), the raw-set / by-id entry rules they
// share (§13.5.2 read slots, §13.6 capture first), and `invalidateModelPlacement` (§16.2).
//
// Deviations from the brief's excerpt, each pinned where it applies (preflight scan / rulings):
//   - `makeRealWorldFixture` / `cleanModel` / `nestedOwnerModel` are not used: every claim-positive
//     arm needs a COMPLETED CLEAN run, which only the P7 engine world (support/engineWorld.mjs, scan
//     S3, R-P7-2) produces in a T1 test. `nestedModelSpec` below is the map-entry form of the brief's
//     `nestedOwnerModel` (scan row P7.3/P7.6 ⇄ P7.8): one root whose subtree has two fragment owners.
//   - By-id reads are RESIDENT FIRST (scan row P7.4 ⇄ P7.6, R-P7-9), then a store read-through under
//     a queued read slot; with neither, the claim/freshness methods reject `ResultNotResidentError`
//     (§13.5.2 nonresident table), never `StoreNotConfiguredError`.
//   - A claim/freshness read of a RESIDENT set does NOT refresh its LRU position: §13.5.2 names
//     `getResultSet` as the only read that refreshes it ("LRU by seal time, refreshed by
//     getResultSet"), and the same reasoning P5 records for `retentionReport` applies — a panel that
//     polls freshness must not pin whatever it looked at last. Pinned below.
//   - `maxQueuedStoreReads: 8` (the §17.1 default) is the named, non-default `QUEUE_DEPTH` (G-CAL).
//   - `recordRef` values stay within 256 code units (owner item D-3, R-P7-7).
//
// C-P7-3 / G-EC: nothing here reads `testIdOfInput` or `provenance.models[].elementCount`. G-CAL: no
// §17.1 default is written as a literal; time is a fake clock; no wall-clock assertion.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClashTestEngine, createEngineCore } from '../../../clashtest/engine.js';
import {
  CorruptResultSetError, EngineDisposedError, ModelBindingError, ReadCapacityError, ResultNotResidentError,
} from '../../../clashtest/errors.js';
import { getFreshness as p6Freshness } from '../../../clashtest/run/freshness.js';
import { createInMemoryResultStore } from '../../../clashtest/results/InMemoryResultStore.js';
import { DIGEST_VERSION } from '../../../clashtest/util/canonical.js';
import { ENGINE_LIMIT_DEFAULTS } from '../../../clashtest/options.js';
import { createEngineWorld, defaultEngineModelSpecs } from '../support/engineWorld.mjs';
import { createScriptedExecutor } from '../support/scriptedExecutor.mjs';
import { createFakeClock } from '../support/fakeClock.mjs';
import { makeDefinition } from '../support/definitions.mjs';

/** Named, NON-default limits (G-CAL). */
const ONE_READ = 1;
const QUEUE_DEPTH = 2;
const SLOT_CAP = 3;
const RECORD_REF = 'REC-1';

// ---- helpers --------------------------------------------------------------------------------------

function deferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

const frag = (fragId, ownerDbId, geometryId = 1) => ({ fragId, ownerDbId, geometryId });

/** Model `x`: root 20's subtree holds fragments of TWO owners (20, 21) — a hierarchy-internal root
 *  under a whole-model self-test (§5.6.3) — and root 30 a single-owner one. */
const nestedModelSpec = () => ({
  modelKey: 'x',
  roots: [
    { dbId: 20, owners: [20, 21], fragments: [frag(0, 20), frag(1, 21)] },
    { dbId: 30, owners: [30], fragments: [frag(2, 30)] },
  ],
});
const selfTestDef = (modelKey) => makeDefinition({
  testId: 'S',
  selectionA: { entries: [{ kind: 'model', modelKey }] },
  selectionB: { entries: [{ kind: 'model', modelKey }] },
});
const cleanDef = (over = {}) => makeDefinition({ testId: 'T', ...over });

/**
 * The engine world (default mA + mB) with a fake clock, and an enumerator whose `digestScope` can be
 * switched to report DRIFT (every digest changed) or to fail (unverifiable) after the run sealed.
 * Planning is untouched by the switch because it is flipped only after the run is done.
 */
function base({ modelSpecs, ...extra } = {}) {
  const world = createEngineWorld(modelSpecs === undefined ? {} : { modelSpecs });
  const clock = createFakeClock({ start: Date.UTC(2026, 8, 24) });
  const probe = { mode: 'live', hold: null, entered: deferred() };
  const inner = world.enumerator;
  const enumerator = {
    ...inner,
    async digestScope(binding, scope, ctx) {
      if (probe.mode === 'fail') throw new Error('enumeration unavailable');
      if (probe.hold) { probe.entered.resolve(); await probe.hold; }
      const observed = await inner.digestScope(binding, scope, ctx);
      return probe.mode === 'drift' ? redigested(observed) : observed;
    },
  };
  const cfg = world.config({ enumerator, now: clock.now, yieldToScheduler: clock.yieldToScheduler, ...extra });
  return Object.assign(cfg, { probe, engineWorld: world });
}

/** Every digest string of an enumerator answer replaced by a different, well-formed one. */
function redigested(observed) {
  return JSON.parse(JSON.stringify(observed), (key, value) => (
    (key === 'digest' || key === 'subtreeDigest') && typeof value === 'string' ? `sha256:${'e'.repeat(64)}` : value));
}

async function cleanRun(engine, def = cleanDef()) {
  const h = engine.startRun(def);
  const summary = await h.done;
  return { h, set: summary.resultSet };
}

// ================================================================================================
// Live freshness, never the sealed value (AC-8)
// ================================================================================================

test('getFreshness returns P6\'s frozen Freshness object unchanged, for a resident set and a raw one', async () => {
  const cfg = base();
  const engine = createClashTestEngine(cfg);
  const { h, set } = await cleanRun(engine);
  const byId = await engine.getFreshness(h.runId);
  assert.deepEqual(byId, { state: 'current', reasons: [] });
  assert.ok(Object.isFrozen(byId) && Object.isFrozen(byId.reasons));
  assert.deepEqual(await engine.getFreshness(structuredClone(set)), byId);
  // The same object P6 computes for the set against the engine's registry and enumerator.
  assert.deepEqual(byId, await p6Freshness(set, { registry: engine.registry, enumerator: cfg.enumerator }));
});

test('engine-bound claim uses LIVE freshness, never the sealed value', async () => {
  const engine = createClashTestEngine(base());
  const { h, set } = await cleanRun(engine);
  assert.equal(set.outcome.freshness, 'current');
  assert.equal(await engine.canClaimNoClashes(h.runId), true);
  const before = await engine.assessNoClashClaim(h.runId);
  assert.deepEqual(before, { allowed: true, unqualified: true, qualifiers: [], exclusions: [], proofMethod: 'bracketed-digest' });

  assert.equal(engine.invalidateModelPlacement('mA'), undefined);   // post-seal placement change, synchronous
  assert.equal(set.outcome.freshness, 'current');                    // the SEALED value is unchanged
  assert.deepEqual(await engine.getFreshness(h.runId), { state: 'stale', reasons: ['placement-changed:mA'] });
  assert.equal(await engine.canClaimNoClashes(h.runId), false);
  const after = await engine.assessNoClashClaim(h.runId);
  assert.equal(after.allowed, false);
  assert.equal(after.unqualified, false);
  // §16.4's reasons reach the qualifiers: the Freshness OBJECT was passed through, not its state.
  assert.deepEqual(after.qualifiers, [{ kind: 'freshness', state: 'stale', reason: 'placement-changed:mA' }]);
  // A raw copy of the same set is judged by the same live registry.
  assert.equal(await engine.canClaimNoClashes(structuredClone(set)), false);
});

test('an unsignalled scope drift after seal makes the claim false (stale, scope-drift reasons)', async () => {
  const cfg = base();
  const engine = createClashTestEngine(cfg);
  const { h } = await cleanRun(engine);
  assert.equal(await engine.canClaimNoClashes(h.runId), true);
  cfg.probe.mode = 'drift';
  const f = await engine.getFreshness(h.runId);
  assert.equal(f.state, 'stale');
  assert.ok(f.reasons.includes('scope-drift:mA') && f.reasons.includes('scope-drift:mB'));
  assert.equal(await engine.canClaimNoClashes(h.runId), false);
  const a = await engine.assessNoClashClaim(h.runId);
  assert.equal(a.allowed, false);
  assert.deepEqual(a.qualifiers.map((q) => `${q.kind}:${q.state}:${q.reason}`),
    f.reasons.map((r) => `freshness:stale:${r}`));
});

test('an unverifiable live scope is never claimable, and the qualifiers say why', async () => {
  const cfg = base();
  const engine = createClashTestEngine(cfg);
  const { h } = await cleanRun(engine);
  cfg.probe.mode = 'fail';
  const f = await engine.getFreshness(h.runId);
  assert.deepEqual(f, { state: 'unverifiable', reasons: ['scope-unverifiable:mA', 'scope-unverifiable:mB'] });
  assert.equal(await engine.canClaimNoClashes(h.runId), false);
  const a = await engine.assessNoClashClaim(h.runId);
  assert.equal(a.allowed, false);
  assert.deepEqual(a.qualifiers, f.reasons.map((reason) => ({ kind: 'freshness', state: 'unverifiable', reason })));
});

test('a set sealed under another registry session is unverifiable through the engine', async () => {
  const engine = createClashTestEngine(base());
  const { set } = await cleanRun(engine);
  const foreign = structuredClone(set);
  foreign.provenance.registrySessionId = 'regsess-another-session';
  assert.deepEqual(await engine.getFreshness(foreign), { state: 'unverifiable', reasons: ['registry-session-mismatch'] });
  assert.equal(await engine.canClaimNoClashes(foreign), false);
});

// ================================================================================================
// invalidateModelPlacement — §16.2's single call
// ================================================================================================

test('invalidateModelPlacement bumps placementGeneration AND invalidates the world placement, synchronously', () => {
  const cfg = base();
  const engine = createClashTestEngine(cfg);
  const { registry, models, world } = cfg.engineWorld;
  const before = registry.bindingFor('mA').placementGeneration;
  const worldCalls = [];
  const original = world.invalidateModelPlacement.bind(world);
  world.invalidateModelPlacement = (model) => { worldCalls.push(model); return original(model); };
  engine.invalidateModelPlacement('mA');
  assert.equal(registry.bindingFor('mA').placementGeneration, before + 1);
  assert.deepEqual(worldCalls, [models.get('mA')]);
  // An unbound key is P1's synchronous ModelBindingError, thrown (the method is synchronous).
  assert.throws(() => engine.invalidateModelPlacement('nope'),
    (err) => err instanceof ModelBindingError && err.reason === 'model-not-bound');
});

// ================================================================================================
// Hierarchy-internal acceptance (AC-20) — per SEALED set, never retroactive
// ================================================================================================

test('a hierarchy-accepted run is allowed-but-qualified, and the boolean stays false', async () => {
  const cfg = base({ modelSpecs: [nestedModelSpec()] });
  const plain = createClashTestEngine(cfg);
  const accepting = createClashTestEngine({ ...cfg, hierarchyInternalAcceptance: { recordRef: RECORD_REF } });
  const { h, set } = await cleanRun(accepting, selfTestDef('x'));
  assert.deepEqual(set.results, []);
  assert.equal(set.outcome.status, 'completed');
  assert.equal(set.outcome.coverage, 'full');
  assert.equal(set.outcome.integrity, 'clean');
  assert.equal(set.ledger.hierarchyInternal.length, 1);
  const a = await accepting.assessNoClashClaim(h.runId);
  assert.equal(a.allowed, true);
  assert.equal(a.unqualified, false);
  assert.equal(a.proofMethod, 'bracketed-digest');
  assert.deepEqual(a.qualifiers, [{ kind: 'hierarchy-internal-accepted', recordRef: RECORD_REF, rootCount: 1, ownerCount: 2 }]);
  assert.equal(await accepting.canClaimNoClashes(h.runId), false);

  // Acceptance is per SEALED set: the set records its own acceptance, whichever engine reads it.
  const viaPlain = await plain.assessNoClashClaim(structuredClone(set));
  assert.equal(viaPlain.allowed, true);
  assert.equal(viaPlain.unqualified, false);
  // ...and an engine's acceptance never reaches back to a set sealed without one.
  const { set: unaccepted } = await cleanRun(plain, selfTestDef('x'));
  assert.equal(unaccepted.provenance.hierarchyInternalAcceptance, null);
  const refused = await accepting.assessNoClashClaim(structuredClone(unaccepted));
  assert.equal(refused.allowed, false);
  assert.deepEqual(refused.qualifiers, []);
  assert.equal(await accepting.canClaimNoClashes(structuredClone(unaccepted)), false);
  assert.equal((await plain.assessNoClashClaim(unaccepted.runId)).allowed, false);

  // A post-seal placement change revokes the accepted claim too.
  accepting.invalidateModelPlacement('x');
  const stale = await accepting.assessNoClashClaim(h.runId);
  assert.equal(stale.allowed, false);
  assert.deepEqual(stale.qualifiers, [{ kind: 'freshness', state: 'stale', reason: 'placement-changed:x' }]);
});

// ================================================================================================
// Not-clean sets are never claimable through the engine (§8.3 conjuncts)
// ================================================================================================

test('a run with positives, a failed run, and an unresolved selection are never claimable', async () => {
  const positives = createClashTestEngine(base({
    unitExecutor: createScriptedExecutor({}, { unscripted: { facts: [], pairs: 1 } }),
  }));
  const { h: withPairs, set: pairSet } = await cleanRun(positives);
  assert.ok(pairSet.results.length > 0);
  assert.equal(pairSet.outcome.integrity, 'clean');
  assert.equal(await positives.canClaimNoClashes(withPairs.runId), false);
  assert.equal((await positives.assessNoClashClaim(withPairs.runId)).allowed, false);
  assert.deepEqual(await positives.getFreshness(withPairs.runId), { state: 'current', reasons: [] });

  const engine = createClashTestEngine(base());
  const { h: failed, set: failedSet } = await cleanRun(engine, cleanDef({
    selectionB: { entries: [{ kind: 'model', modelKey: 'unbound' }] },
  }));
  assert.equal(failedSet.outcome.status, 'failed');
  assert.equal(await engine.canClaimNoClashes(failed.runId), false);
  assert.equal((await engine.assessNoClashClaim(failed.runId)).allowed, false);

  // A missing element is a hard planning failure (`element-unresolvable`), never claimable either.
  const { h: missing, set: missingSet } = await cleanRun(engine, cleanDef({
    selectionA: { entries: [{ kind: 'elements', modelKey: 'mA', dbIds: [1, 999] }] },
  }));
  assert.equal(missingSet.outcome.status, 'failed');
  assert.equal(await engine.canClaimNoClashes(missing.runId), false);

  // A SOFT unresolved selection (a real node with no fragments) completes, and is still refused.
  const [specA, specB] = defaultEngineModelSpecs();
  const soft = createClashTestEngine(base({ modelSpecs: [{ ...specA, emptyDbIds: [3] }, specB] }));
  const { h: unresolved, set: unresolvedSet } = await cleanRun(soft, cleanDef({
    selectionA: { entries: [{ kind: 'elements', modelKey: 'mA', dbIds: [1, 3] }] },
  }));
  assert.ok(unresolvedSet.ledger.unresolvedSelections.length > 0);
  assert.equal(await soft.canClaimNoClashes(unresolved.runId), false);
  assert.equal((await soft.assessNoClashClaim(unresolved.runId)).allowed, false);
});

test('an unknown digestVersion is never claimable through the ENGINE-bound path', async () => {
  // P5 re-verification finding 2: the NORMATIVE owner is the claim predicate's digest-version
  // conjunct, so the fixture is an EMPTY-RESULTS, otherwise-claimable set and the assertion is on
  // the predicate's own qualifier, not on a freshness state.
  const engine = createClashTestEngine(base());
  const { h, set: clean } = await cleanRun(engine);
  assert.deepEqual(clean.results, []);                                // the control IS claimable
  assert.equal(await engine.canClaimNoClashes(h.runId), true);
  assert.equal(await engine.canClaimNoClashes(structuredClone(clean)), true);

  // The ONLY difference is the digest version (both digests replaced: an unknown version is not compared).
  const unknown = structuredClone(clean);
  unknown.digests = { digestVersion: DIGEST_VERSION + 98, pairSetDigest: `sha256:${'0'.repeat(64)}`,
    ledgerDigest: `sha256:${'1'.repeat(64)}` };

  assert.equal(await engine.canClaimNoClashes(unknown), false);
  const a = await engine.assessNoClashClaim(unknown);
  assert.equal(a.allowed, false);
  assert.equal(a.unqualified, false);
  assert.ok(a.qualifiers.some((q) => q.kind === 'digest-version' && q.reason === 'unknown-digest-version'));
});

// ================================================================================================
// Raw sets: capture first, one read slot, never queued (§13.5.2, §13.6)
// ================================================================================================

test('an engine-bound assessment of a RAW set captures before the first await', async () => {
  const engine = createClashTestEngine(base());
  const { set } = await cleanRun(engine);
  for (const method of ['assessNoClashClaim', 'canClaimNoClashes', 'getFreshness']) {
    const mutable = structuredClone(set);
    const p = engine[method](mutable);
    mutable.outcome.coverage = 'partial';                            // synchronous post-call mutation
    mutable.results.push({ bogus: true });
    const got = await p;                                             // (the default engine has ONE read slot)
    assert.deepEqual(got, await engine[method](structuredClone(set)), method);
  }
  assert.equal(await engine.canClaimNoClashes(structuredClone(set)), true);
});

test('raw-set calls are never queued: the surplus rejects ReadCapacityError immediately', async () => {
  const cfg = base({ limits: { maxConcurrentStoreReads: ONE_READ, maxQueuedStoreReads: QUEUE_DEPTH } });
  const engine = createClashTestEngine(cfg);
  const { h, set } = await cleanRun(engine);
  const first = engine.getFreshness(structuredClone(set));           // holds the only read slot
  assert.equal(engine.retentionReport().readSlotsInUse, ONE_READ);
  for (const method of ['canClaimNoClashes', 'assessNoClashClaim', 'getFreshness']) {
    const p = engine[method](structuredClone(set));                  // a Promise, never a sync throw
    assert.ok(p instanceof Promise);
    await assert.rejects(p, (e) => e instanceof ReadCapacityError && e.limit === ONE_READ);
  }
  // A RESIDENT by-id read is not a store read: it needs no slot and is not queued behind the raw read.
  assert.equal(await engine.canClaimNoClashes(h.runId), true);
  assert.deepEqual(await first, { state: 'current', reasons: [] });
  assert.equal(engine.retentionReport().readSlotsInUse, 0, 'the slot is released when the read settles');
});

test('capture/validation failures REJECT, never throw synchronously, and release the slot', async () => {
  const engine = createClashTestEngine(base());
  const cyclic = { schemaVersion: 1 };
  cyclic.self = cyclic;
  let getterCalls = 0;
  const hostile = { schemaVersion: 1, get outcome() { getterCalls += 1; return {}; } };
  for (const method of ['getFreshness', 'canClaimNoClashes', 'assessNoClashClaim']) {
    for (const bad of [cyclic, hostile]) {
      const p = engine[method](bad);                                  // must not throw here
      assert.ok(p instanceof Promise);
      await assert.rejects(p, CorruptResultSetError);
    }
    // Not a Result Set at all: still a rejection, never a synchronous throw.
    for (const bad of [42, [], undefined, null]) {
      const p = engine[method](bad);
      assert.ok(p instanceof Promise);
      await assert.rejects(p);
    }
  }
  assert.equal(getterCalls, 0, 'capture never invokes a getter');
  assert.equal(engine.retentionReport().readSlotsInUse, 0);
});

test('a raw set that fails validation after capture rejects CorruptResultSetError and frees the slot', async () => {
  const engine = createClashTestEngine(base({ limits: { maxConcurrentStoreReads: ONE_READ } }));
  const { set } = await cleanRun(engine);
  const tampered = structuredClone(set);
  tampered.ledger.pairSpaceTotal += 1;                              // the recomputed ledgerDigest no longer matches
  await assert.rejects(engine.canClaimNoClashes(tampered), CorruptResultSetError);
  assert.equal(engine.retentionReport().readSlotsInUse, 0);
  assert.equal(await engine.canClaimNoClashes(structuredClone(set)), true, 'the one slot is usable again');
});

test('a read slot is held until the freshness passes finish, not just until validation', async () => {
  const cfg = base();
  const engine = createClashTestEngine(cfg);
  const { set } = await cleanRun(engine);
  const release = deferred();
  cfg.probe.hold = release.promise;
  const p = engine.canClaimNoClashes(structuredClone(set));
  await cfg.probe.entered.promise;                                  // inside the first digest pass
  assert.equal(engine.retentionReport().readSlotsInUse, ENGINE_LIMIT_DEFAULTS.maxConcurrentStoreReads);
  cfg.probe.hold = null;
  release.resolve();
  assert.equal(await p, true);
  assert.equal(engine.retentionReport().readSlotsInUse, 0);
});

test('withReadSet (internal, reused by rerun): routes, never throws, and hands fn a frozen set or null', async () => {
  const core = createEngineCore(base({ resultStore: null }));
  const { withReadSet } = core.internals;
  const { engine } = core;
  const { h, set } = await cleanRun(engine);
  const seen = [];
  const fn = async (s) => { seen.push(s); return 'ok'; };
  assert.equal(await withReadSet(h.runId, fn), 'ok');               // resident: the sealed set itself
  assert.equal(seen[0], set);
  assert.equal(await withReadSet(structuredClone(set), fn), 'ok');  // raw: a validated, frozen copy
  assert.notEqual(seen[1], set);
  assert.ok(Object.isFrozen(seen[1]) && Object.isFrozen(seen[1].outcome));
  assert.deepEqual(seen[1], set);
  assert.equal(await withReadSet('unknown-run', fn), 'ok');         // a miss is fn(null): the caller decides
  assert.equal(seen[2], null);
  const cyclic = { schemaVersion: 1 };
  cyclic.self = cyclic;
  let called = false;
  const p = withReadSet(cyclic, () => { called = true; });          // never a synchronous throw
  assert.ok(p instanceof Promise);
  await assert.rejects(p, CorruptResultSetError);
  assert.equal(called, false);
  const fnError = new Error('fn failed');
  await assert.rejects(withReadSet(structuredClone(set), () => { throw fnError; }), (e) => e === fnError);
  assert.equal(engine.retentionReport().readSlotsInUse, 0, 'every exit released its slot');
  await engine.dispose();
  const afterDispose = withReadSet(h.runId, fn);
  assert.ok(afterDispose instanceof Promise);
  await assert.rejects(afterDispose, EngineDisposedError);
});

// ================================================================================================
// By-id reads: resident first (non-touching), then store read-through, else ResultNotResidentError
// ================================================================================================

test('by-id: a nonresident saved set is read through the store under a queued read slot', async () => {
  const resultStore = createInMemoryResultStore();
  const gate = deferred();
  const gatedStore = { ...resultStore, get: async (...args) => { await gate.promise; return resultStore.get(...args); } };
  const engine = createClashTestEngine(base({
    resultStore: gatedStore, limits: { maxConcurrentStoreReads: ONE_READ, maxQueuedStoreReads: QUEUE_DEPTH },
  }));
  const h = engine.startRun(cleanDef());
  await h.persisted;
  await h.done;
  engine.releaseResultSet(h.runId);                                 // drops the resident copy only
  assert.equal(engine.getRun(h.runId), null);

  const reads = [engine.canClaimNoClashes(h.runId), engine.assessNoClashClaim(h.runId)];
  for (let i = 0; i < QUEUE_DEPTH - 1; i += 1) reads.push(engine.getFreshness(h.runId));
  assert.equal(engine.retentionReport().readSlotsInUse, ONE_READ);
  // One in flight + QUEUE_DEPTH waiting: the next by-id read is refused, as a rejection.
  await assert.rejects(engine.getFreshness(h.runId), (e) => e instanceof ReadCapacityError && e.limit === QUEUE_DEPTH);
  gate.resolve();
  const [can, assessment, ...fresh] = await Promise.all(reads);
  assert.equal(can, true);
  assert.equal(assessment.allowed, true);
  for (const f of fresh) assert.deepEqual(f, { state: 'current', reasons: [] });
  assert.equal(engine.retentionReport().readSlotsInUse, 0);
  assert.equal(engine.getPersistenceState(h.runId), null, 'a read-through never makes the set resident');
});

test('by-id: a set neither resident nor stored rejects ResultNotResidentError (store or no store)', async () => {
  const noStore = createClashTestEngine(base({ resultStore: null }));
  const h = noStore.startRun(cleanDef());
  await h.done;
  assert.equal(await noStore.canClaimNoClashes(h.runId), true);     // resident: no store needed
  noStore.releaseResultSet(h.runId, { acknowledgeUnsaved: true });
  const withStore = createClashTestEngine(base());
  for (const [engine, runId] of [[noStore, h.runId], [withStore, 'never-admitted']]) {
    for (const method of ['getFreshness', 'canClaimNoClashes', 'assessNoClashClaim']) {
      const p = engine[method](runId);
      assert.ok(p instanceof Promise);
      await assert.rejects(p, (e) => e instanceof ResultNotResidentError && e.runId === runId);
    }
    assert.equal(await engine.getResultSet(runId), null, 'getResultSet keeps its null contract');
    assert.equal(engine.retentionReport().readSlotsInUse, 0);
  }
});

test('by-id: a corrupt stored set rejects CorruptResultSetError and frees the read slot', async () => {
  const inner = createInMemoryResultStore();
  const engine = createClashTestEngine(base({
    resultStore: { ...inner, get: async () => ({ schemaVersion: 1, bogus: true }) },
  }));
  for (const method of ['getFreshness', 'canClaimNoClashes', 'assessNoClashClaim']) {
    await assert.rejects(engine[method]('stored-elsewhere'),
      (e) => e instanceof CorruptResultSetError && e.runId === 'stored-elsewhere');
  }
  assert.equal(engine.retentionReport().readSlotsInUse, 0);
});

test('a claim or freshness read of a RESIDENT set does not refresh its LRU position (§13.5.2)', async () => {
  const engine = createClashTestEngine(base({ limits: { maxResidentResultSets: SLOT_CAP } }));
  const runs = [];
  for (let i = 0; i < SLOT_CAP; i += 1) {
    const h = engine.startRun(cleanDef());
    await h.persisted;
    await h.done;
    runs.push(h);
  }
  const [oldest, second] = runs;
  assert.equal(await engine.canClaimNoClashes(oldest.runId), true);
  assert.equal((await engine.assessNoClashClaim(oldest.runId)).allowed, true);
  assert.equal((await engine.getFreshness(oldest.runId)).state, 'current');
  const next = engine.startRun(cleanDef());
  assert.equal(engine.getRun(oldest.runId), null, 'the least-recently-SEALED set was still the victim');
  assert.equal(engine.getRun(second.runId), second);
  await next.done;
});

test('the resident read is the sealed set itself (no store read, no capture)', async () => {
  let gets = 0;
  const inner = createInMemoryResultStore();
  const core = createEngineCore(base({ resultStore: { ...inner, get: async (...a) => { gets += 1; return inner.get(...a); } } }));
  const { engine } = core;
  const { h } = await cleanRun(engine);
  assert.equal(await engine.canClaimNoClashes(h.runId), true);
  assert.equal((await engine.getFreshness(h.runId)).state, 'current');
  assert.equal(gets, 0);
});

// ================================================================================================
// The R1 gate
// ================================================================================================

test('after dispose the claim surface rejects, and invalidateModelPlacement throws, EngineDisposedError', async () => {
  const engine = createClashTestEngine(base());
  const { h, set } = await cleanRun(engine);
  await engine.dispose();
  for (const method of ['getFreshness', 'canClaimNoClashes', 'assessNoClashClaim']) {
    for (const input of [h.runId, structuredClone(set)]) {
      const p = engine[method](input);
      assert.ok(p instanceof Promise);
      await assert.rejects(p, EngineDisposedError);
    }
  }
  assert.throws(() => engine.invalidateModelPlacement('mA'), EngineDisposedError);
});
