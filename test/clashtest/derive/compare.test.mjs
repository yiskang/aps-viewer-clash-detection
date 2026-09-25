import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createContextInternal } from '../../../clashtest/derive/context.js';
import { changedFieldsOf, cleanProof } from '../../../clashtest/derive/compare.js';
import { comparePairIds } from '../../../clashtest/identity/ids.js';
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

test('matches a synchronous reference implementation on randomized set pairs (seeded)', async () => {
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

test('AC-13 R15-4: O(n + m + ledger) operation count — ledger reads and scheduler yields grow linearly, never per pair x ledger', async () => {
  // Every ledger property read (either side) is counted through a Proxy installed by the capture hook; aggregationSliceMaxItems: 1
  // makes every gate tick a yield. Every pair is base-only or next-only, so each one is classified through the status reader.
  const instrument = (obj, counter, cache) => {
    if (obj === null || typeof obj !== 'object') return obj;
    if (cache.has(obj)) return cache.get(obj);
    const px = new Proxy(obj, { get(t, k, r) { counter.n += 1; return instrument(Reflect.get(t, k, r), counter, cache); } });
    cache.set(obj, px); return px;
  };
  const build = (mode, k, L, parity, dg) => makeResultSet({ mode, keepPairOrder: mode === 'containment', semanticDigest: dg,
    models: [{ modelKey: 'M', modelVersion: 'v1', roots: [100, ...Array.from({ length: 2 * k }, (_, i) => 1000 + i)].map((d) => ({ dbId: d, ownerDbIds: [d] })) }],
    units: [{ unitId: '1.0', source: { modelKey: 'M', roots: [100] }, targets: [{ modelKey: 'M', whole: true }] },
      ...Array.from({ length: L }, (_, i) => ({ unitId: `x.${i}`, source: { modelKey: 'M', roots: [5000 + i] }, targets: [{ modelKey: 'M', roots: [6000 + i] }] }))],
    results: Array.from({ length: k }, (_, i) => ({ pair: [['M', 100], ['M', 1000 + 2 * i + parity]], ...(mode === 'containment' ? { evidence: {} } : {}) })) });
  const measure = async (mode, k, L) => {
    const counter = { n: 0 }; const cache = new WeakMap(); const h = makeHarness();
    const c = createContextInternal({ limits: { aggregationSliceMaxItems: 1 }, now: h.now, yieldToScheduler: () => h.yieldToScheduler() },
      { capture: (raw) => { const s = structuredClone(raw); s.ledger = instrument(s.ledger, counter, cache); return s; } });
    const out = await c.compareResultSets(build(mode, k, L, 0, 'sha256:a'), build(mode, k, L, 1, 'sha256:b'));
    assert.deepEqual([out.resolved.length, out.added.length], [k, k], `${mode} k=${k} L=${L}: every pair classified clean`);
    // work units: n + m results, plus each side's ledger records (rootOwners rows 2k+1, units L+1)
    return { reads: counter.n, yields: h.yields, work: 2 * k + 2 * ((2 * k + 1) + (L + 1)) };
  };
  for (const mode of ['volume-overlap', 'containment']) {   // unordered, and ordered (exercises the orientation guard)
    const K = 50; const L = 50;
    const base = await measure(mode, K, L);
    for (const [k, l, what] of [[2 * K, L, 'results doubled'], [K, 2 * L, 'ledger units doubled, results fixed'], [2 * K, 2 * L, 'both doubled']]) {
      const m = await measure(mode, k, l);
      for (const metric of ['reads', 'yields']) {
        assert.ok(m[metric] <= 32 * m.work, `${mode} ${what}: ${metric}=${m[metric]} exceeds 32 x work=${m.work}`);
        assert.ok(m[metric] / base[metric] <= 2.2, `${mode} ${what}: ${metric} grew ${(m[metric] / base[metric]).toFixed(2)}x for a 2x input (quadratic would be ~4x)`);
      }
    }
  }
});

test('identical sets (a set vs a structuredClone of itself): every pair unchanged, every other class empty', async () => {
  const set = mk({ units: [cover([200, 300, 400])], results: [pr(200), pr(300), pr(400)] });
  const c = await cmp(set, structuredClone(set));
  assert.deepEqual(ids(c.unchanged), [200, 300, 400]);
  for (const k of ['changed', 'added', 'addedUnverifiedBase', 'resolved', 'removedUnverifiedNext', 'identityConflicts']) assert.deepEqual(c[k], [], k);
  assert.equal(c.incomparable, null);
});

test('pointTolerance boundary: |Δ| == tolerance is unchanged, just above is changed (default and override)', async () => {
  const at = (x) => mk({ units: [cover([200])], results: [pr(200, { evidence: { witness: { kind: 'surface-crossing', point: [x, 0, 0] } } })] });
  const tol = COMPARE_TOLERANCE_DEFAULTS.pointTolerance;
  assert.equal((await cmp(at(0), at(tol))).unchanged.length, 1);                                  // default: |Δ| == tol
  assert.deepEqual((await cmp(at(0), at(tol * 1.01))).changed.map((e) => e.changedFields), [['witnessPoint']]);
  assert.equal((await cmp(at(1), at(1.5), { pointTolerance: 0.5 })).unchanged.length, 1);          // override: |Δ| == tol
  assert.deepEqual((await cmp(at(1), at(1.5), { pointTolerance: 0.4999 })).changed.map((e) => e.changedFields), [['witnessPoint']]);
});

// ---------------------------------------------------------------------------------------------------------------
// H1 (owner-authorized P8 remediation): a `covered-clean` verdict proves an absent pair only if its covering unit
// actually evaluated that pair: first root in the unit's SOURCE domain, second root in its TARGET domain, and -- on
// the source model -- the second root NOT also a source root (the library self-excludes target fragments that are
// also source). Ordered (containment) sets require that direct orientation; unordered sets accept either one.
// ---------------------------------------------------------------------------------------------------------------
const H1_MODES = [['containment', true], ['volume-overlap', false]];
const h1Pairs = (list) => list.map((e) => `${e.pairId.first.modelKey}:${e.pairId.first.dbId}->${e.pairId.second.modelKey}:${e.pairId.second.dbId}`);
const h1Set = (mode, ordered, over) => makeResultSet({ models, mode, keepPairOrder: ordered, ...over });
const h1Unit = (src, target, srcModel = 'M') => ({ unitId: '1.0', source: { modelKey: srcModel, roots: src }, targets: [target] });
const h1Result = (ordered, a, b) => ({ pair: [a, b], ...(ordered ? { evidence: {} } : {}) });
/** Base holds result `pair`; `probe` holds none and only `unit`. Returns [resolve-path compare, added-path compare]. */
async function h1Both(mode, ordered, unit, pair, extra = {}) {
  const found = h1Set(mode, ordered, { semanticDigest: 'sha256:f', units: [unit], results: [h1Result(ordered, ...pair)], ...extra });
  const probe = h1Set(mode, ordered, { semanticDigest: 'sha256:p', units: [unit], results: [], ...extra });
  return [await cmp(found, probe), await cmp(probe, found)];
}

for (const [mode, ordered] of H1_MODES) {
  for (const [label, unit] of [
    ['source [100,200] target [100]', h1Unit([100, 200], { modelKey: 'M', roots: [100] })],
    ['source [100,200] target [200]', h1Unit([100, 200], { modelKey: 'M', roots: [200] })],
    ['source [100,200] target [100,200]', h1Unit([100, 200], { modelKey: 'M', roots: [100, 200] })],
    ['source [100,200] target whole model M', h1Unit([100, 200], { modelKey: 'M', whole: true })],
  ]) {
    test(`H1 ${mode}: forged overlapping unit (${label}) never proves (100,200) resolved/added -- fail-closed to the unverified class`, async () => {
      const [r, a] = await h1Both(mode, ordered, unit, [['M', 100], ['M', 200]]);
      assert.deepEqual([h1Pairs(r.resolved), h1Pairs(r.removedUnverifiedNext)], [[], ['M:100->M:200']], 'base-only pair');
      assert.deepEqual([h1Pairs(a.added), h1Pairs(a.addedUnverifiedBase)], [[], ['M:100->M:200']], 'next-only pair');
    });
  }

  test(`H1 ${mode}: positive controls stay resolved/added (disjoint single-root, whole-model target, multi-root disjoint, cross-model)`, async () => {
    const N = { modelKey: 'N', modelVersion: 'v1', roots };
    for (const [label, unit, pair, extra] of [
      ['source [100] target [200]', h1Unit([100], { modelKey: 'M', roots: [200] }), [['M', 100], ['M', 200]]],
      ['source [100] target whole model M', h1Unit([100], { modelKey: 'M', whole: true }), [['M', 100], ['M', 200]]],
      ['multi-root disjoint source [100,300] target [200,400]', h1Unit([100, 300], { modelKey: 'M', roots: [200, 400] }), [['M', 300], ['M', 400]]],
      ['cross-model source M:100 -> target N:200', h1Unit([100], { modelKey: 'N', roots: [200] }), [['M', 100], ['N', 200]], { models: [models[0], N] }],
      ['cross-model same dbId source M:100 -> target N:100', h1Unit([100], { modelKey: 'N', roots: [100] }), [['M', 100], ['N', 100]], { models: [models[0], N] }],
      ['cross-model whole target source M:100 -> whole N', h1Unit([100], { modelKey: 'N', whole: true }), [['M', 100], ['N', 300]], { models: [models[0], N] }],
    ]) {
      const [r, a] = await h1Both(mode, ordered, unit, pair, extra);
      const id = `${pair[0][0]}:${pair[0][1]}->${pair[1][0]}:${pair[1][1]}`;
      assert.deepEqual([h1Pairs(r.resolved), r.removedUnverifiedNext], [[id], []], `${label}: resolved`);
      assert.deepEqual([h1Pairs(a.added), a.addedUnverifiedBase], [[id], []], `${label}: added`);
    }
  });
}

test('H1 unordered: a legitimately converse-oriented unit still proves the pair (either orientation); ordered: it never does', async () => {
  const N = { modelKey: 'N', modelVersion: 'v1', roots };
  // multi-root disjoint unit source [100,300] -> target [200,400]: the ascending pair (200,300) is evaluated as 300 x 200
  const multi = h1Unit([100, 300], { modelKey: 'M', roots: [200, 400] });
  // cross-model unit source N:200 -> target M:100: the ascending pair (M:100, N:200) is evaluated as N:200 x M:100
  const cross = h1Unit([200], { modelKey: 'M', roots: [100] }, 'N');
  for (const [unit, pair, extra] of [[multi, [['M', 200], ['M', 300]]], [cross, [['M', 100], ['N', 200]], { models: [models[0], N] }]]) {
    const id = `${pair[0][0]}:${pair[0][1]}->${pair[1][0]}:${pair[1][1]}`;
    const [r, a] = await h1Both('volume-overlap', false, unit, pair, extra);
    assert.deepEqual([h1Pairs(r.resolved), h1Pairs(a.added)], [[id], [id]], `unordered ${id}`);
    const [ro, ao] = await h1Both('containment', true, unit, pair, extra);
    assert.deepEqual([ro.resolved, h1Pairs(ro.removedUnverifiedNext)], [[], [id]], `ordered converse ${id}: resolve path`);
    assert.deepEqual([ao.added, h1Pairs(ao.addedUnverifiedBase)], [[], [id]], `ordered converse ${id}: added path`);
  }
});

test('H1: valid planner-produced layouts are unchanged -- real createPlan/planSplit ledgers (class-C roots in both selections) prove exactly the selection-required pairs', async () => {
  const { createPlan } = await import('../../../clashtest/planning/planner.js');
  const { planSplit } = await import('../../../clashtest/planning/splitting.js');
  const { RUN_OPTION_DEFAULTS } = await import('../../../clashtest/options.js');
  const { makeSyntheticEnumerator, defOf, snapshotOf } = await import('../support/syntheticModels.mjs');
  const synth = (dbIds, fragBase) => dbIds.map((dbId, i) => ({ dbId, owners: [dbId], fragments: [{ fragId: fragBase + i, ownerDbId: dbId, geometryId: 1 }] }));
  const model = (modelKey) => ({ kind: 'model', modelKey });
  const SCENARIOS = [
    ['same model, A = B (all class C)', [{ modelKey: 'arch', roots: synth([1, 2, 3, 4, 5], 0) }], { A: [model('arch')], B: [model('arch')] }],
    ['partial overlap on one model + whole B-only model', [{ modelKey: 'arch', roots: synth([1, 2, 3, 4, 5], 0) }, { modelKey: 'struct', roots: synth([7, 8], 10) }],
      { A: [{ kind: 'elements', modelKey: 'arch', dbIds: [1, 2, 3] }], B: [{ kind: 'elements', modelKey: 'arch', dbIds: [2, 3, 4, 5] }, model('struct')] }],
    ['A whole model, B elements of the same model', [{ modelKey: 'arch', roots: synth([1, 2, 3, 4], 0) }], { A: [model('arch')], B: [{ kind: 'elements', modelKey: 'arch', dbIds: [2, 3] }] }],
    ['mixed roles across three models', [{ modelKey: 'arch', roots: synth([1, 2, 3], 0) }, { modelKey: 'mep', roots: synth([4, 5], 10) }, { modelKey: 'struct', roots: synth([7, 8], 20) }],
      { A: [model('arch'), model('mep')], B: [model('arch'), model('struct')] }],
  ];
  const SMALL = { ...RUN_OPTION_DEFAULTS, maxSourceDbIdsPerUnit: 1, maxTargetModelsPerUnit: 1, maxTargetFragmentsPerUnit: 2 };
  let leavesChecked = 0;
  for (const [name, synthModels, { A, B }] of SCENARIOS) {
    const members = (entries) => new Set(entries.flatMap((e) => (e.kind === 'model' ? synthModels.find((m) => m.modelKey === e.modelKey).roots.map((r) => r.dbId) : e.dbIds)
      .map((d) => `${e.modelKey}:${d}`)));
    const inA = members(A); const inB = members(B);
    const elems = synthModels.flatMap((m) => m.roots.map((r) => [m.modelKey, r.dbId]));
    for (const [mode, ordered] of H1_MODES) {
      // independent oracle: the definition's pair space (spec: ordered = A x B oriented; unordered = either role assignment), never the ledger
      const key = ([mk, d]) => `${mk}:${d}`;
      const required = (p, q) => (ordered ? inA.has(key(p)) && inB.has(key(q)) : (inA.has(key(p)) && inB.has(key(q))) || (inA.has(key(q)) && inB.has(key(p))));
      const candidates = [];
      for (const p of elems) for (const q of elems) {
        if (key(p) === key(q)) continue;
        if (!ordered && comparePairIds({ first: { modelKey: p[0], dbId: p[1] }, second: { modelKey: q[0], dbId: q[1] } }, { first: { modelKey: q[0], dbId: q[1] }, second: { modelKey: p[0], dbId: p[1] } }) > 0) continue;
        candidates.push([p, q]);
      }
      for (const [splitAll, options] of [[false, RUN_OPTION_DEFAULTS], [true, RUN_OPTION_DEFAULTS], [false, SMALL], [true, SMALL]]) {
        const { enumerator, binding } = makeSyntheticEnumerator(synthModels);
        const keys = [...new Set([...A, ...B].map((e) => e.modelKey))].sort();
        const definition = defOf({ A, B, mode, testId: 'T4', name: 'completed-clean' });
        const { plan, ledger } = await createPlan({ definition, snapshot: snapshotOf(binding, keys), enumerator, options, checkpoint: () => {} });
        const leaves = [];
        const walk = (u) => { const r = splitAll ? planSplit(plan, u) : { reason: 'unsplittable' }; if (r.reason === 'unsplittable') leaves.push(u); else r.children.forEach(walk); };
        plan.units.forEach(walk);
        for (const l of leaves) ledger.recordOutcome(l.unitId, { outcome: 'evaluated', scopeProof: 'equal' });
        const rec = ledger.toLedgerRecord();
        const label = `${name} / ${mode} / split=${splitAll} / ${options === SMALL ? 'small caps' : 'default caps'}`;
        for (const u of rec.units.filter((x) => x.kind === 'leaf')) {   // the planner never emits the forged H1 shape
          leavesChecked += 1;
          const src = new Set(u.sourceRootDbIds);
          for (const t of u.targets) if (t.modelKey === u.sourceModelKey) {
            assert.notEqual(t.scope, 'model', `${label}: whole-model target on the source model (unit ${u.unitId})`);
            assert.ok(!t.rootDbIds.some((id) => src.has(id)), `${label}: same-model source/target overlap (unit ${u.unitId})`);
          }
        }
        const setOf = (dg, results) => {
          const s = makeResultSet({ models: synthModels.map((m) => ({ modelKey: m.modelKey, modelVersion: 'v1', roots: m.roots.map((r) => ({ dbId: r.dbId, ownerDbIds: [r.dbId] })) })),
            mode, keepPairOrder: ordered, semanticDigest: dg, results: results.map(([p, q]) => h1Result(ordered, p, q)) });
          s.definition = structuredClone(definition); s.ledger = structuredClone(rec);
          return s;
        };
        const all = setOf('sha256:all', candidates); const none = setOf('sha256:none', []);
        const expected = candidates.filter(([p, q]) => required(p, q)).map(([p, q]) => `${p[0]}:${p[1]}->${q[0]}:${q[1]}`).sort();
        const unproven = candidates.filter(([p, q]) => !required(p, q)).map(([p, q]) => `${p[0]}:${p[1]}->${q[0]}:${q[1]}`).sort();
        const r = await cmp(all, none); const a = await cmp(none, all);
        assert.ok(expected.length > 0, `${label}: scenario has required pairs`);
        assert.deepEqual([h1Pairs(r.resolved).sort(), h1Pairs(r.removedUnverifiedNext).sort()], [expected, unproven], `${label}: resolve path`);
        assert.deepEqual([h1Pairs(a.added).sort(), h1Pairs(a.addedUnverifiedBase).sort()], [expected, unproven], `${label}: added path`);
      }
    }
  }
  assert.ok(leavesChecked > 100, `planner leaves checked: ${leavesChecked}`);
});

test('H1 cleanProof unit level: every clause is checked against the covering unit itself, not inferred from the reader verdict', () => {
  // A stub reader that answers `covered-clean` for any pair with the given covering unit: the proof must still test the
  // unit's own scope (defense-in-depth against a reader whose unit lookup disagrees with the pair).
  const readerOf = (unit, verdict = 'covered-clean') => ({
    pairStatus: (p) => ({ verdict, coveringUnitId: unit.unitId, roots: { first: p.first.dbId, second: p.second.dbId } }),
    ledger: { unitsById: new Map([[unit.unitId, unit]]) } });
  const leaf = (sourceModelKey, sourceRootDbIds, targets) => ({ unitId: 'u', sourceModelKey, sourceRootDbIds, targets });
  const P = (fm, f, sm, sd) => ({ first: { modelKey: fm, dbId: f }, second: { modelKey: sm, dbId: sd } });
  const roots = (modelKey, rootDbIds) => ({ modelKey, scope: 'roots', rootDbIds });
  const whole = (modelKey) => ({ modelKey, scope: 'model' });
  const cases = [   // [label, unit, pair, ordered-expected, unordered-expected]
    ['direct disjoint', leaf('M', [100], [roots('M', [200])]), P('M', 100, 'M', 200), true, true],
    ['(i) first root not in source', leaf('M', [300], [roots('M', [200])]), P('M', 100, 'M', 200), false, false],
    ['(i) source on another model', leaf('N', [100], [roots('M', [200])]), P('M', 100, 'M', 200), false, false],
    ['(ii) second root not in target', leaf('M', [100], [roots('M', [300])]), P('M', 100, 'M', 200), false, false],
    ['(ii) no target entry for that model', leaf('M', [100], [roots('N', [200])]), P('M', 100, 'M', 200), false, false],
    ['(ii) whole-model target', leaf('M', [100], [whole('M')]), P('M', 100, 'M', 200), true, true],
    ['(iii) second root also source (same model)', leaf('M', [100, 200], [roots('M', [200])]), P('M', 100, 'M', 200), false, false],
    ['(iii) whole-model target, second root is source', leaf('M', [100, 200], [whole('M')]), P('M', 100, 'M', 200), false, false],
    ['(iii) not applied across models', leaf('M', [100], [roots('N', [100])]), P('M', 100, 'N', 100), true, true],
    ['converse orientation', leaf('M', [200], [roots('M', [100])]), P('M', 100, 'M', 200), false, true],
    ['converse, (iii) on the converse', leaf('M', [100, 200], [roots('M', [100])]), P('M', 100, 'M', 200), false, false],
    ['repeated target entries for one model are a union', leaf('M', [100], [roots('M', [300]), roots('M', [200])]), P('M', 100, 'M', 200), true, true],
  ];
  for (const [label, unit, pair, ord, unord] of cases) {
    assert.equal(cleanProof(readerOf(unit), true)(pair), ord, `ordered: ${label}`);
    assert.equal(cleanProof(readerOf(unit), false)(pair), unord, `unordered: ${label}`);
  }
  const ok = leaf('M', [100], [roots('M', [200])]);
  assert.equal(cleanProof(readerOf(ok, 'covered-caveated'), false)(P('M', 100, 'M', 200)), false, 'non-clean verdict unchanged');
  assert.equal(cleanProof({ ...readerOf(ok), ledger: { unitsById: new Map() } }, false)(P('M', 100, 'M', 200)), false, 'unknown covering unit');
  // the unit's scope is materialized once per unit, not per pair
  let reads = 0; const counted = { ...ok, get sourceRootDbIds() { reads += 1; return [100]; } };
  const proof = cleanProof(readerOf(counted), true);
  for (let i = 0; i < 5; i++) proof(P('M', 100, 'M', 200));
  assert.equal(reads, 1);
});
