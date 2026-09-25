import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createContextInternal } from '../../../clashtest/derive/context.js';
import { changedFieldsOf } from '../../../clashtest/derive/compare.js';
import { getPairStatus } from '../../../clashtest/results/status.js';     // P5's (D4) — the reference implementation below classifies through it
import { COMPARE_TOLERANCE_DEFAULTS } from '../../../clashtest/options.js';   // P0's; the test never restates 1e-6
import { InvalidOptionsError, ComparisonTooLargeError, DerivationAbortedError, DerivationBusyError, CorruptResultSetError } from '../../../clashtest/errors.js';
import { makeResultSet } from './support/makeResultSet.mjs';
import { makeHarness } from './support/harness.mjs';

const roots = [100, 200, 300, 400, 500].map((d) => ({ dbId: d, ownerDbIds: [d] }));
const models = [{ modelKey: 'M', modelVersion: 'v1', roots }];
const cover = (targets, extra = {}) => ({ unitId: '1.0', source: { modelKey: 'M', roots: [100] }, targets: [{ modelKey: 'M', roots: targets }], ...extra });
const pr = (b, extra = {}) => ({ pair: [['M', 100], ['M', b]], ...extra });
const mk = (over) => makeResultSet({ models, ...over });
const ctx = (limits = {}, h = makeHarness()) => createContextInternal({ limits, now: h.now, yieldToScheduler: () => h.yieldToScheduler() }, {});
const cmp = (a, b, o) => ctx().compareResultSets(a, b, o);
const ids = (list) => list.map((e) => e.pairId.second.dbId);

test('class truth table: unchanged / changed / added / addedUnverifiedBase / resolved / removedUnverifiedNext', async () => {
  // base: results 200 (stays), 300 (evidence changes), 400 (resolved: gone in next, next covers it cleanly)
  //       base covers 200,300,400 but NOT 500 (unit targets exclude it)
  const base = mk({ units: [cover([200, 300, 400])], results: [pr(200), pr(300, { evidence: { witness: { kind: 'surface-crossing', point: [1, 1, 1] } } }), pr(400)] });
  // next: 200 same, 300 point moved, 500 new (base did NOT cover it => addedUnverifiedBase), 200..: next covers 200,300,400,500 cleanly
  const next = mk({ semanticDigest: 'sha256:bbb', units: [cover([200, 300, 400, 500])], results: [pr(200), pr(300, { evidence: { witness: { kind: 'surface-crossing', point: [1, 1, 2] } } }), pr(500)] });
  const c = await cmp(base, next);
  assert.equal(c.incomparable, null);
  assert.deepEqual(ids(c.unchanged), [200]);
  assert.deepEqual(c.changed.map((e) => [e.pairId.second.dbId, e.changedFields]), [[300, ['witnessPoint']]]);
  assert.deepEqual(ids(c.resolved), [400]);
  assert.deepEqual(ids(c.addedUnverifiedBase), [500]);
  assert.deepEqual(c.added, []); assert.deepEqual(c.removedUnverifiedNext, []);
  assert.equal(c.resolved[0].baseResultId, base.results.find((r) => r.pair.second.dbId === 400).resultId);
  assert.equal(c.unchanged[0].baseResultId === c.unchanged[0].nextResultId, false); // semanticDigest differs => different ResultIds, same PairId join
});

test('added (base covered cleanly) and removedUnverifiedNext (next did not cover cleanly)', async () => {
  const base = mk({ units: [cover([200, 300, 400])], results: [pr(300)] });
  const next = mk({ units: [cover([200, 300], { taints: [{ kind: 'unit', modelKey: null, reason: 'diagnostic-overflow', occurrences: 1 }] })], results: [pr(200)] });
  const c = await cmp(base, next);
  assert.deepEqual(ids(c.added), [200]);                    // base covered 200 cleanly
  assert.deepEqual(ids(c.removedUnverifiedNext), [300]);    // next's covering unit is tainted: absence proves nothing
  assert.deepEqual(c.resolved, []);
  const gapNext = mk({ units: [cover([200, 300], { outcome: 'failed', cause: 'unit-cap' })], results: [] });
  assert.deepEqual(ids((await cmp(base, gapNext)).removedUnverifiedNext), [300]);                       // gap => unverified
  const notCovered = mk({ units: [cover([200])], results: [] });
  assert.deepEqual(ids((await cmp(base, notCovered)).removedUnverifiedNext), [300]);                    // 300 never asked in next => gap => unverified
});

test('unattributable diagnostic / mixed owner never yields resolved or added', async () => {
  const base = mk({ units: [cover([200, 300])], results: [pr(300)] });
  const nextTaint = mk({ units: [{ ...cover([200, 300]), targets: [{ modelKey: 'M', whole: true }], taints: [{ kind: 'target-model', modelKey: 'M', reason: 'fragment-not-loaded', occurrences: 1 }] }], results: [] });
  const c = await cmp(base, nextTaint);
  assert.deepEqual(c.resolved, []); assert.deepEqual(ids(c.removedUnverifiedNext), [300]);
  const mixed = mk({ units: [cover([200, 300])], results: [], unreachable: [{ modelKey: 'M', ownerDbIds: [300], mixedOwnerDbIds: [300], unattributable: { notLoaded: 0, ownerUnresolvable: 0 } }] });
  assert.deepEqual((await cmp(base, mixed)).resolved, []);
});

test('pair-semantics gate: containment <-> volume-overlap is incomparable in BOTH directions; nothing is joined', async () => {
  const contain = mk({ mode: 'containment', semanticDigest: 'sha256:c', units: [cover([200])], results: [pr(200, { evidence: {} })] });
  const overlap = mk({ mode: 'volume-overlap', semanticDigest: 'sha256:v', units: [cover([200])], results: [pr(200)] });
  for (const [a, b, ba, bb] of [[contain, overlap, 'ordered', 'unordered'], [overlap, contain, 'unordered', 'ordered']]) {
    const c = await cmp(a, b);
    assert.deepEqual(c.incomparable, { reason: 'pair-semantics-changed', base: ba, next: bb });
    for (const k of ['unchanged', 'changed', 'added', 'addedUnverifiedBase', 'resolved', 'removedUnverifiedNext']) assert.deepEqual(c[k], [], k);
  }
});

test('gate still reports identityConflicts; a modelVersion mismatch is a conflict, classified nowhere else', async () => {
  const base = mk({ units: [cover([200])], results: [pr(200)] });
  const other = makeResultSet({ models: [{ ...models[0], modelVersion: 'v2' }], units: [cover([200])], results: [pr(200)] });
  const c = await cmp(base, other);
  assert.deepEqual(ids(c.identityConflicts), [200]);
  for (const k of ['unchanged', 'changed', 'added', 'resolved', 'addedUnverifiedBase', 'removedUnverifiedNext']) assert.deepEqual(c[k], [], k);
  assert.equal(c.comparability.sameModelVersions, false);
  const gated = await cmp(mk({ mode: 'containment', units: [cover([200])], results: [pr(200, { evidence: {} })] }), other);
  assert.deepEqual(ids(gated.identityConflicts), [200]);
});

test('ordered class: swapped selections keep the sets comparable and add the orientation note; unordered modes still join across a mode change', async () => {
  const sel = (id) => ({ entries: [{ kind: 'elements', modelKey: 'M', dbIds: [id] }] });
  const c1 = mk({ mode: 'containment', semanticDigest: 'sha256:1', definitionOverrides: { selectionA: sel(100), selectionB: sel(200) }, units: [cover([200])], results: [pr(200, { evidence: {} })] });
  // c2's selections are swapped, so its (only) unit is oriented to match: source 200 -> target 100. It asks ONLY the converse
  // ordered question "is 200 inside 100?", which says nothing about c1's pair (100 inside 200).
  const c2 = mk({ mode: 'containment', semanticDigest: 'sha256:2', definitionOverrides: { selectionA: sel(200), selectionB: sel(100) },
    units: [{ unitId: '1.0', source: { modelKey: 'M', roots: [200] }, targets: [{ modelKey: 'M', roots: [100] }] }], results: [] });
  const c = await cmp(c1, c2);
  assert.equal(c.incomparable, null);
  assert.ok(c.comparability.notes.includes('containment-orientation-reversed'));
  assert.deepEqual(c.resolved, []);                             // never a false `resolved`: c2 never asked (100 in 200)
  assert.deepEqual(ids(c.removedUnverifiedNext), [200]);        // the converse run is reported through the ordinary (unverified) class
  const vo = mk({ semanticDigest: 'sha256:vo', units: [cover([200])], results: [pr(200)] });
  const cl = mk({ mode: 'clearance', clearance: 0.05, semanticDigest: 'sha256:cl', units: [cover([200])], results: [pr(200)] });
  const j = await cmp(vo, cl);
  assert.equal(j.incomparable, null); assert.deepEqual(j.changed.map((e) => e.changedFields), [['mode']]);
});

test('ordered (containment) coverage is orientation-aware: a converse-oriented unit never proves resolved/added', async () => {
  const sel = (id) => ({ entries: [{ kind: 'elements', modelKey: 'M', dbIds: [id] }] });
  const unit = (src, tgt) => ({ unitId: '1.0', source: { modelKey: 'M', roots: [src] }, targets: [{ modelKey: 'M', roots: [tgt] }] });
  const cset = (a, b, over) => mk({ mode: 'containment', keepPairOrder: true, definitionOverrides: { selectionA: sel(a), selectionB: sel(b) }, ...over });
  const pairs = (list) => list.map((e) => [e.pairId.first.dbId, e.pairId.second.dbId]);
  // c1 holds (100 in 200); c3 (swapped selections, unit 200 -> 100) holds the converse (200 in 100)
  const c1 = cset(100, 200, { semanticDigest: 'sha256:1', units: [unit(100, 200)], results: [{ pair: [['M', 100], ['M', 200]], evidence: {} }] });
  const c3 = cset(200, 100, { semanticDigest: 'sha256:3', units: [unit(200, 100)], results: [{ pair: [['M', 200], ['M', 100]], evidence: {} }] });
  assert.deepEqual(pairs(c3.results.map((r) => ({ pairId: r.pair }))), [[200, 100]]);   // fixture kept the ordered orientation
  const c = await cmp(c1, c3);
  assert.deepEqual([c.resolved, c.added], [[], []]);
  assert.deepEqual(pairs(c.removedUnverifiedNext), [[100, 200]]);   // c3's unit answers only (200 in 100)
  assert.deepEqual(pairs(c.addedUnverifiedBase), [[200, 100]]);     // c1's unit answers only (100 in 200)
  // positive control: the other side's correctly oriented unit still proves resolved / added
  const clean = cset(100, 200, { semanticDigest: 'sha256:4', units: [unit(100, 200)], results: [] });
  const r = await cmp(c1, clean);
  assert.deepEqual([pairs(r.resolved), r.removedUnverifiedNext], [[[100, 200]], []]);
  const a = await cmp(clean, c1);
  assert.deepEqual([pairs(a.added), a.addedUnverifiedBase], [[[100, 200]], []]);
});

test('clearance 0.05 -> 0.10: same pair is changed(["clearance"]) carrying pairId and BOTH ResultIds, never added+removed', async () => {
  const a = mk({ mode: 'clearance', clearance: 0.05, semanticDigest: 'sha256:a', units: [cover([200])], results: [pr(200)] });
  const b = mk({ mode: 'clearance', clearance: 0.1, semanticDigest: 'sha256:b', units: [cover([200])], results: [{ ...pr(200), evidence: { distance: 0.04, clearance: 0.1, closestPoints: { first: [0, 0, 0], second: [0.04, 0, 0] } } }] });
  const c = await cmp(a, b);
  assert.equal(c.changed.length, 1); assert.deepEqual(c.changed[0].changedFields, ['clearance']);
  assert.notEqual(c.changed[0].baseResultId, c.changed[0].nextResultId);
  assert.deepEqual([c.added, c.resolved, c.addedUnverifiedBase, c.removedUnverifiedNext], [[], [], [], []]);
});

test('equal pairSetDigest does not hide evidence: 0.0417 vs 0.0470 is changed; tolerance boundary and extreme numerics', async () => {
  const d = (v) => ({ distance: v, clearance: 0.5, closestPoints: { first: [0, 0, 0], second: [0, 0, 0] } });
  const mkc = (v) => mk({ mode: 'clearance', clearance: 0.5, units: [cover([200])], results: [pr(200, { evidence: d(v) })] });
  assert.equal((await cmp(mkc(0.0417), mkc(0.047))).changed.length, 1);
  assert.equal((await cmp(mkc(1), mkc(1.5), { distanceTolerance: 0.5 })).unchanged.length, 1);   // |Δ| == tol is unchanged (<=)
  assert.equal((await cmp(mkc(1), mkc(1.5), { distanceTolerance: 0.25 })).changed.length, 1);
  const tol = { ...COMPARE_TOLERANCE_DEFAULTS };
  assert.deepEqual(changedFieldsOf(mkc(Number.MAX_VALUE).results[0], mkc(-Number.MAX_VALUE).results[0], null, null, tol), ['distance']); // a-b overflows to Infinity: still "changed"
  assert.deepEqual(changedFieldsOf(mkc(Number.MAX_VALUE).results[0], mkc(Number.MAX_VALUE).results[0], null, null, tol), []);
  assert.deepEqual(changedFieldsOf(mkc(0).results[0], mkc(-0).results[0], null, null, tol), []);
});

test('options are closed and validated; timeSensitive marking and both determinism classes recorded (weaker wins)', async () => {
  const a = mk({ units: [cover([200])], results: [pr(200)] }); const b = mk({ units: [cover([200])], results: [] });
  for (const bad of [{ bogus: 1 }, { distanceTolerance: -1 }, { pointTolerance: NaN }, { distanceTolerance: Infinity }, { signal: 3 }]) await assert.rejects(cmp(a, b, bad), InvalidOptionsError, JSON.stringify(bad));
  const ts = mk({ mode: 'surface-intersection', determinismClass: 'time-sensitive', semanticDigest: 'sha256:ts', units: [cover([200])], results: [] });
  const c = await cmp(a, ts);
  assert.deepEqual([c.comparability.baseDeterminismClass, c.comparability.nextDeterminismClass, c.comparability.determinismClass], ['deterministic', 'time-sensitive', 'time-sensitive']);
  assert.equal(c.resolved[0].timeSensitive, true);
  assert.ok(c.comparability.notes.includes('time-sensitive:next'));
  const c2 = await cmp(ts, a); assert.equal(c2.comparability.determinismClass, 'time-sensitive'); assert.ok(c2.comparability.notes.includes('time-sensitive:base'));
  assert.equal('timeSensitive' in (await cmp(a, b)).resolved[0], false);
});

test('comparability: sameDefinition/ModelVersions/Enumeration/LibraryVersion, placement, environment and scope notes', async () => {
  const same = await cmp(mk({ units: [cover([200])] }), mk({ units: [cover([200])] }));
  assert.deepEqual([same.comparability.sameDefinition, same.comparability.sameModelVersions, same.comparability.sameEnumeration, same.comparability.sameLibraryVersion, same.comparability.placement], [true, true, true, true, 'same-generation']);
  const diff = await cmp(mk({ registrySessionId: 's1', libraryVersion: null, environmentSensitive: true, scopeDigests: { M: { population: { count: 1, digest: 'x' }, roots: [] } } }),
    mk({ registrySessionId: 's2', libraryVersion: '1', scopeDigests: { M: { population: { count: 2, digest: 'y' }, roots: [] } } }));
  assert.equal(diff.comparability.sameLibraryVersion, null); assert.equal(diff.comparability.placement, 'unverifiable'); assert.equal(diff.comparability.sameEnumeration, false);
  for (const n of ['environment-sensitive:base', 'scope-digest-mismatch:M']) assert.ok(diff.comparability.notes.includes(n), n);
  const moved = await cmp(mk({ placementGeneration: 0 }), mk({ placementGeneration: 1 })); assert.equal(moved.comparability.placement, 'unverifiable');
});

test('placement is unverifiable whenever the model-key sets differ (disjoint, next-only key, base-only key)', async () => {
  const M = { modelKey: 'M', modelVersion: 'v1', roots };
  const N = { modelKey: 'N', modelVersion: 'v1', roots };
  const set = (ms) => makeResultSet({ models: ms });
  for (const [b, n, label] of [[[M], [N], 'disjoint'], [[M], [M, N], 'next-only key'], [[M, N], [M], 'base-only key']]) {
    assert.equal((await cmp(set(b), set(n))).comparability.placement, 'unverifiable', label);
  }
  // control: identical keys and generations stay 'same-generation'
  assert.equal((await cmp(set([M, N]), set([M, N]))).comparability.placement, 'same-generation');
});

test('bounds: ComparisonTooLargeError from the incremental count, no partial output; shared slots; abort; slicing; a raw unordered set is corrupt', async () => {
  const big = (n) => mk({ units: [cover([200, 300, 400, 500])], results: [200, 300, 400, 500].slice(0, n).map((b) => pr(b)) });
  await assert.rejects(ctx({ maxComparisonEntries: 3 }).compareResultSets(big(4), big(4)), (e) => e instanceof ComparisonTooLargeError && e.limit === 3 && e.observed === 4);
  const h = makeHarness(); const c = ctx({ maxConcurrentDerivations: 1, aggregationSliceMaxItems: 1 }, h);
  h.hold(); const first = c.compareResultSets(big(4), big(4));
  await assert.rejects(c.compareResultSets(big(1), big(1)), DerivationBusyError); h.releaseAll(); await first;
  const ac = new AbortController(); const start = h.yields; h.onYield = (n) => n === start + 2 && ac.abort();
  await assert.rejects(c.compareResultSets(big(4), big(4), { signal: ac.signal }), DerivationAbortedError); assert.ok(h.yields >= start + 2);
  const bad = big(4); bad.results.reverse();
  await assert.rejects(cmp(bad, big(4)), CorruptResultSetError);
});

test('matches a synchronous reference implementation on randomized set pairs (seeded), and is index-only (no per-pair ledger scan)', async () => {
  let seed = 7; const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  for (let round = 0; round < 25; round++) {
    const pick = () => [200, 300, 400, 500].filter(() => rnd() < 0.5);
    const covers = () => [200, 300, 400, 500].filter(() => rnd() < 0.75);
    const build = (dg) => { const found = pick(); return mk({ semanticDigest: dg, units: [cover(covers())], results: found.map((b) => pr(b)) }); };
    const A = build('sha256:x'); const B = build('sha256:y');
    const got = await cmp(A, B);   // reference below: classify with the public getPairStatus
    const inA = new Set(A.results.map((r) => r.pair.second.dbId)); const inB = new Set(B.results.map((r) => r.pair.second.dbId));
    const exp = { resolved: [], removedUnverifiedNext: [], added: [], addedUnverifiedBase: [] };
    for (const b of [200, 300, 400, 500]) {
      const pair = { first: { modelKey: 'M', dbId: 100 }, second: { modelKey: 'M', dbId: b } };
      if (inA.has(b) && !inB.has(b)) exp[getPairStatus(B, pair).verdict === 'covered-clean' ? 'resolved' : 'removedUnverifiedNext'].push(b);
      if (!inA.has(b) && inB.has(b)) exp[getPairStatus(A, pair).verdict === 'covered-clean' ? 'added' : 'addedUnverifiedBase'].push(b);
    }
    for (const k of Object.keys(exp)) assert.deepEqual(ids(got[k]), exp[k], `${k} round ${round}`);
  }
});

test('scope digests are compared independently of modelVersion: version mismatch + digest mismatch => sameEnumeration false, note present, identityConflicts populated', async () => {
  const dg = (digest) => ({ M: { population: { count: 1, digest }, roots: [] } });
  const v2 = { models: [{ ...models[0], modelVersion: 'v2' }] };
  const base = mk({ scopeDigests: dg('x'), units: [cover([200])], results: [pr(200)] });
  const next = makeResultSet({ ...v2, scopeDigests: dg('y'), units: [cover([200])], results: [pr(200)] });
  const c = await cmp(base, next);
  assert.equal(c.comparability.sameEnumeration, false);
  assert.equal(c.comparability.sameModelVersions, false);
  assert.deepEqual(ids(c.identityConflicts), [200]);
  assert.ok(c.comparability.notes.includes('scope-digest-mismatch:M'));
  // control: versions differ but digests are equal => enumeration still the same, no scope note
  const ctl = await cmp(mk({ scopeDigests: dg('x'), units: [cover([200])], results: [pr(200)] }), makeResultSet({ ...v2, scopeDigests: dg('x'), units: [cover([200])], results: [pr(200)] }));
  assert.equal(ctl.comparability.sameEnumeration, true);
  assert.equal(ctl.comparability.sameModelVersions, false);
  assert.ok(!ctl.comparability.notes.some((n) => n.startsWith('scope-digest-mismatch')));
});
