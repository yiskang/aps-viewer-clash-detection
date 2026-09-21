// test/clashtest/definition/roots.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertRootAntichain, checkCrossRoleNesting, hierarchyInternalCandidates,
  assertRootAntichainSliced, checkCrossRoleNestingSliced, hierarchyInternalCandidatesSliced,
} from '../../../clashtest/definition/normalize.js';

const root = (dbId, ownerDbIds) => ({ dbId, ownerDbIds });

test('an antichain of roots passes; an owner-set containment is a violation', () => {
  assert.deepEqual(assertRootAntichain([root(10, [11, 12]), root(20, [21])]), { ok: true, violations: [] });
  assert.deepEqual(
    assertRootAntichain([root(10, [11, 12]), root(11, [11])]),
    { ok: false, violations: [{ ancestor: 10, descendant: 11 }] },
  );
  assert.deepEqual(assertRootAntichain([root(10, [11]), root(10, [11])]),
    { ok: false, violations: [{ ancestor: 10, descendant: 10 }] });   // duplicate dbId
});

test('identical roots in both roles are supported (5.6.5)', () => {
  const rootsA = [root(10, [11, 12])];
  const rootsB = [root(10, [11, 12]), root(20, [21])];
  const rootsUnion = [root(10, [11, 12]), root(20, [21])];
  assert.deepEqual(checkCrossRoleNesting({ rootsA, rootsB, rootsUnion }),
    { supported: true, offenders: [], enumeratorInconsistent: false });
});

test('cross-role nesting is unsupported and names the offending pairs', () => {
  const rootsA = [root(10, [11, 12, 13])];      // A selects the parent
  const rootsB = [root(12, [12])];              // B selects a descendant of it
  const rootsUnion = [root(10, [11, 12, 13])];  // the union collapses to the ancestor
  assert.deepEqual(checkCrossRoleNesting({ rootsA, rootsB, rootsUnion }), {
    supported: false, offenders: [{ ancestor: 10, descendant: 12 }], enumeratorInconsistent: false,
  });
});

test('offenders are capped at 20 and ascending by descendant dbId', () => {
  const owners = Array.from({ length: 30 }, (_, i) => 100 + i);
  const rootsA = [root(10, owners)];
  const rootsB = owners.map((o) => root(o, [o]));
  const r = checkCrossRoleNesting({ rootsA, rootsB, rootsUnion: [root(10, owners)] });
  assert.equal(r.supported, false);
  assert.equal(r.offenders.length, 20);
  assert.deepEqual(r.offenders.map((o) => o.descendant), owners.slice(0, 20));
  assert.ok(r.offenders.every((o) => o.ancestor === 10));
});

test('a union root belonging to neither role is an enumerator inconsistency, not a nesting failure', () => {
  const r = checkCrossRoleNesting({
    rootsA: [root(10, [11])], rootsB: [root(20, [21])],
    rootsUnion: [root(10, [11]), root(20, [21]), root(30, [31])],
  });
  assert.equal(r.enumeratorInconsistent, true);
  assert.equal(r.supported, false);
});

test('hierarchyInternalCandidates lists A-and-B roots with two or more owners (5.6.3)', () => {
  const rootsA = [root(10, [11, 12]), root(20, [20]), root(30, [31, 32, 33])];
  const rootsB = [root(10, [11, 12]), root(20, [20]), root(40, [41, 42])];
  // 10 is in both and has 2 owners -> claim-blocking candidate.
  // 20 is in both but has ONE owner -> no internal pair exists.
  // 30 is A-only and 40 is B-only -> the question asks no internal pair about them.
  assert.deepEqual(hierarchyInternalCandidates({ rootsA, rootsB }), [{ dbId: 10, ownerCount: 2 }]);
});

test('hierarchyInternalCandidates is empty for disjoint selections', () => {
  assert.deepEqual(hierarchyInternalCandidates({
    rootsA: [root(10, [11, 12])], rootsB: [root(20, [21, 22])],
  }), []);
});

// Added beyond the plan block (mutation-check gap): the offending ancestor must be the union root that
// actually contains the dropped root, not merely any union root.
test('the offending ancestor is the containing union root, chosen among several', () => {
  const r = checkCrossRoleNesting({
    rootsA: [root(5, [6]), root(10, [11, 12])],
    rootsB: [root(12, [12])],
    rootsUnion: [root(5, [6]), root(10, [11, 12])],
  });
  assert.deepEqual(r, { supported: false, offenders: [{ ancestor: 10, descendant: 12 }], enumeratorInconsistent: false });
});

// ---- P2 review remediation: assertRootAntichain is near-linear and stops at the 20th violation ---------

// A counting stand-in for `ownerDbIds`: every element read goes through the proxy.
const counted = (owners, counter) => new Proxy(owners, {
  get(t, k, r) { if (typeof k === 'string' && /^\d+$/.test(k)) counter.reads += 1; return Reflect.get(t, k, r); },
});

// The pre-fix O(n^2) implementation, verbatim, as the oracle for ordering and semantics.
const referenceOwnersSubset = (a, b) => { const s = new Set(b); return a.every((o) => s.has(o)); };
function referenceAntichain(roots) {
  const violations = [];
  for (let i = 0; i < roots.length; i += 1) {
    for (let j = 0; j < roots.length; j += 1) {
      if (i === j) continue;
      if (roots[i].dbId === roots[j].dbId && i < j) { violations.push({ ancestor: roots[i].dbId, descendant: roots[j].dbId }); continue; }
      if (roots[i].dbId !== roots[j].dbId && referenceOwnersSubset(roots[j].ownerDbIds, roots[i].ownerDbIds)) {
        violations.push({ ancestor: roots[i].dbId, descendant: roots[j].dbId });
      }
    }
  }
  return { ok: violations.length === 0, violations: violations.slice(0, 20) };
}

test('20,000 disjoint roots are an antichain and every owner is read a bounded number of times', () => {
  const counter = { reads: 0 };
  const N = 20_000;
  const roots = Array.from({ length: N }, (_, i) => root(i, counted([N + 3 * i, N + 3 * i + 1, N + 3 * i + 2], counter)));
  const r = assertRootAntichain(roots);
  assert.deepEqual(r, { ok: true, violations: [] });
  assert.ok(counter.reads <= 10 * 3 * N, `read ${counter.reads} owner elements for ${3 * N} owners`);
});

test('5,000 roots nested under one root: exactly 20 violations, ok=false, found without scanning every pair', () => {
  const N = 5_000;
  for (const bigFirst of [true, false]) {
    const counter = { reads: 0 };
    const small = Array.from({ length: N }, (_, k) => root(100 + k, counted([100 + k], counter)));
    const big = root(1, counted(small.map((s) => s.dbId), counter));
    const roots = bigFirst ? [big, ...small] : [...small, big];
    const r = assertRootAntichain(roots);
    assert.equal(r.ok, false);
    assert.equal(r.violations.length, 20);
    assert.ok(r.violations.every((v) => v.ancestor === 1));
    assert.deepEqual(r.violations.map((v) => v.descendant), Array.from({ length: 20 }, (_, k) => 100 + k));
    assert.ok(counter.reads <= 10 * 2 * N, `read ${counter.reads} owner elements`);
  }
});

test('the early stop is real: the antichain scan touches only the roots it needs before the 20th violation', () => {
  // 20 empty-owner roots are descendants of the first root; every later root would add more violations.
  let dbIdReads = 0;
  const N = 3_000;
  const mk = (dbId, owners) => ({ get dbId() { dbIdReads += 1; return dbId; }, ownerDbIds: owners });
  const roots = [mk(1, [5]), ...Array.from({ length: N }, (_, k) => mk(10 + k, []))];
  const r = assertRootAntichain(roots);
  assert.equal(r.violations.length, 20);
  assert.ok(dbIdReads <= 4 * roots.length, `read dbId ${dbIdReads} times`);
});

test('assertRootAntichain equals the reference O(n^2) implementation on 300 random small root sets', () => {
  let seed = 12345;
  const rand = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 4294967296; };
  const pick = (n) => Math.floor(rand() * n);
  let withViolations = 0;
  for (let round = 0; round < 300; round += 1) {
    const roots = Array.from({ length: pick(9) }, () => root(1 + pick(6), Array.from({ length: pick(5) }, () => 1 + pick(8))));
    const expected = referenceAntichain(roots);
    assert.deepEqual(assertRootAntichain(roots), expected, JSON.stringify(roots));
    if (!expected.ok) withViolations += 1;
  }
  assert.ok(withViolations > 30, 'the generator must produce many violating sets');
  // a larger set that exceeds the 20 cap, with duplicates, nesting and empty owners
  const big = Array.from({ length: 40 }, (_, k) => root(1 + (k % 7), Array.from({ length: k % 4 }, (__, m) => 1 + ((k + m) % 9))));
  assert.equal(referenceAntichain(big).violations.length, 20);
  assert.deepEqual(assertRootAntichain(big), referenceAntichain(big));
});

test('an empty-owner root is a descendant of every root with a different dbId (and only i<j for equal dbIds)', () => {
  assert.deepEqual(assertRootAntichain([root(1, [2]), root(3, [])]).violations, [{ ancestor: 1, descendant: 3 }]);
  assert.deepEqual(assertRootAntichain([root(4, []), root(4, [])]).violations, [{ ancestor: 4, descendant: 4 }]);
});

test('checkCrossRoleNesting equals the pre-fix implementation on random inputs (cached owner sets change no result)', () => {
  const reference = ({ rootsA, rootsB, rootsUnion }) => {
    const roleRoots = new Map();
    for (const r of [...rootsA, ...rootsB]) if (!roleRoots.has(r.dbId)) roleRoots.set(r.dbId, r);
    const unionIds = new Set(rootsUnion.map((r) => r.dbId));
    const enumeratorInconsistent = rootsUnion.some((r) => !roleRoots.has(r.dbId));
    const dropped = [...roleRoots.keys()].filter((id) => !unionIds.has(id)).sort((a, b) => a - b);
    const offenders = [];
    for (const descendant of dropped) {
      if (offenders.length >= 20) break;
      const owners = roleRoots.get(descendant).ownerDbIds;
      const ancestor = rootsUnion.filter((u) => u.dbId !== descendant && referenceOwnersSubset(owners, u.ownerDbIds))
        .map((u) => u.dbId).sort((a, b) => a - b)[0];
      offenders.push({ ancestor: ancestor === undefined ? null : ancestor, descendant });
    }
    return { supported: offenders.length === 0 && dropped.length === 0 && !enumeratorInconsistent, offenders, enumeratorInconsistent };
  };
  let seed = 777;
  const rand = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 4294967296; };
  const pick = (n) => Math.floor(rand() * n);
  const mk = () => Array.from({ length: pick(6) }, () => root(1 + pick(10), Array.from({ length: pick(4) }, () => 1 + pick(8))));
  for (let round = 0; round < 300; round += 1) {
    const input = { rootsA: mk(), rootsB: mk(), rootsUnion: mk() };
    assert.deepEqual(checkCrossRoleNesting(input), reference(input), JSON.stringify(input));
  }
});

// ---- P2 review remediation H1: the deadline-aware *Sliced forms (spec 5.3 / 17.3, checkpoint at least every 64 items) ----

// Every read of a root's dbId / ownerDbIds / an owner element counts as one unit of work.
const instrumented = (counter, dbId, owners) => ({
  get dbId() { counter.reads += 1; return dbId; },
  get ownerDbIds() { counter.reads += 1; return counted(owners, counter); },
});

// A `{ tick }` contract stand-in: counts ticks, records the largest number of work reads between two ticks, and
// (asyncEvery > 0) returns a Promise on every asyncEvery-th tick and checks that NO work ran until it resolved.
function makeTicker(counter = { reads: 0 }, { asyncEvery = 0 } = {}) {
  const t = { ticks: 0, maxSpan: 0, unawaited: 0, labels: new Set() };
  let last = 0;
  t.tick = (label) => {
    t.ticks += 1;
    t.labels.add(label);
    t.maxSpan = Math.max(t.maxSpan, counter.reads - last);
    last = counter.reads;
    if (asyncEvery > 0 && t.ticks % asyncEvery === 0) {
      const at = counter.reads;
      return Promise.resolve().then(() => { if (counter.reads !== at) t.unawaited += 1; });
    }
    return undefined;
  };
  return t;
}
const passesOf = (n) => Math.ceil(Math.log2(n));

test('assertRootAntichainSliced: 20,000 disjoint roots plus one 6,000-owner root tick at least every 64 work reads', async () => {
  const counter = { reads: 0 };
  const N = 20_000;
  const wide = instrumented(counter, 1_000_000, Array.from({ length: 6_000 }, (_, k) => 2_000_000 + k));
  const roots = [wide, ...Array.from({ length: N }, (_, i) => instrumented(counter, i, [N + 3 * i, N + 3 * i + 1, N + 3 * i + 2]))];
  const t = makeTicker(counter, { asyncEvery: 50 });
  const r = await assertRootAntichainSliced(roots, t);
  assert.deepEqual(r, { ok: true, violations: [] });
  assert.ok(t.ticks >= N / 64, `${t.ticks} ticks`);
  assert.ok(t.ticks >= 3 * N + 6_000, `one tick per owner read expected, saw ${t.ticks}`);
  assert.ok(t.maxSpan <= 64, `${t.maxSpan} work reads between two ticks`);
  assert.equal(t.unawaited, 0, 'a Promise returned by tick must be awaited before more work');
  assert.deepEqual(r, assertRootAntichain(roots));
});

test('assertRootAntichainSliced: the scan phase (index buckets, candidates) also ticks at least every 64 work reads', async () => {
  const N = 5_000;
  for (const bigFirst of [true, false]) {
    const counter = { reads: 0 };
    const small = Array.from({ length: N }, (_, k) => instrumented(counter, 100 + k, [100 + k]));
    const big = instrumented(counter, 1, Array.from({ length: N }, (_, k) => 100 + k));
    const roots = bigFirst ? [big, ...small] : [...small, big];
    const t = makeTicker(counter);
    const r = await assertRootAntichainSliced(roots, t);
    assert.equal(r.ok, false);
    assert.equal(r.violations.length, 20);
    assert.deepEqual(r.violations.map((v) => v.descendant), Array.from({ length: 20 }, (_, k) => 100 + k));
    assert.ok(t.maxSpan <= 64, `bigFirst=${bigFirst}: ${t.maxSpan} work reads between two ticks`);
    assert.ok(t.ticks <= 30 * N, `early stop must keep ticks near-linear: ${t.ticks} ticks for ${N} nested roots`);
    assert.deepEqual(r, assertRootAntichain(roots.map((x) => ({ dbId: x.dbId, ownerDbIds: [...x.ownerDbIds] }))));
  }
});

test('assertRootAntichainSliced: the candidate sort is sliced (5,000 empty-owner descendants cost >= n*ceil(log2 n) sort ticks)', async () => {
  const N = 5_000;
  const roots = [root(1, [5]), ...Array.from({ length: N }, (_, k) => root(10 + k, []))];
  const t = makeTicker();
  const r = await assertRootAntichainSliced(roots, t);
  assert.equal(r.violations.length, 20);
  assert.ok(t.ticks >= N * (2 + passesOf(N)), `saw ${t.ticks} ticks`);
});

test('checkCrossRoleNestingSliced: 12,000 role roots / 3,000 union roots / 9,000 dropped: bounded cadence, sorted, equals sync', async () => {
  const counter = { reads: 0 };
  const mk = (id) => instrumented(counter, id, [1_000_000 + id]);
  const rootsA = Array.from({ length: 6_000 }, (_, k) => mk(5_999 - k));            // descending: the dropped-id sort has real work
  const rootsB = Array.from({ length: 6_000 }, (_, k) => mk(11_999 - k));
  const rootsUnion = Array.from({ length: 3_000 }, (_, k) => mk(k));
  const t = makeTicker(counter, { asyncEvery: 64 });
  const r = await checkCrossRoleNestingSliced({ rootsA, rootsB, rootsUnion }, t);
  assert.equal(r.supported, false);
  assert.equal(r.offenders.length, 20);
  assert.deepEqual(r.offenders.map((o) => o.descendant), Array.from({ length: 20 }, (_, k) => 3_000 + k));
  assert.ok(r.offenders.every((o) => o.ancestor === null));
  assert.ok(t.ticks >= 9_000 * passesOf(9_000) + 12_000 + 3_000 + 12_000, `saw ${t.ticks} ticks`);   // the dropped-id sort is included
  assert.ok(t.ticks >= 20 * 3_000, 'the offender scan over the union roots ticks per union root');
  assert.ok(t.maxSpan <= 64, `${t.maxSpan} work reads between two ticks`);
  assert.equal(t.unawaited, 0);
  const plain = (x) => ({ dbId: x.dbId, ownerDbIds: [...x.ownerDbIds] });
  assert.deepEqual(r, checkCrossRoleNesting({ rootsA: rootsA.map(plain), rootsB: rootsB.map(plain), rootsUnion: rootsUnion.map(plain) }));
});

test('checkCrossRoleNestingSliced: a single wide owner list (cached owner sets) ticks per owner', async () => {
  const counter = { reads: 0 };
  const owners = Array.from({ length: 8_000 }, (_, k) => k);
  const rootsUnion = [instrumented(counter, 1, owners)];
  const rootsA = [instrumented(counter, 1, owners), instrumented(counter, 2, owners.slice(0, 3_000))];
  const t = makeTicker(counter);
  const r = await checkCrossRoleNestingSliced({ rootsA, rootsB: [], rootsUnion }, t);
  assert.deepEqual(r, { supported: false, offenders: [{ ancestor: 1, descendant: 2 }], enumeratorInconsistent: false });
  assert.ok(t.ticks >= 8_000 + 3_000, `saw ${t.ticks} ticks`);
  assert.ok(t.maxSpan <= 64, `${t.maxSpan} work reads between two ticks`);
});

test('hierarchyInternalCandidatesSliced: 10,000 shared roots cost >= 2n + n*ceil(log2 n) ticks (the dbId sort is sliced)', async () => {
  const counter = { reads: 0 };
  const n = 10_000;
  const mk = () => Array.from({ length: n }, (_, k) => instrumented(counter, n - k, [1, 2]));   // dbIds descending
  const rootsA = mk();
  const rootsB = mk();
  const t = makeTicker(counter, { asyncEvery: 100 });
  const r = await hierarchyInternalCandidatesSliced({ rootsA, rootsB }, t);
  assert.deepEqual(r.slice(0, 3), [{ dbId: 1, ownerCount: 2 }, { dbId: 2, ownerCount: 2 }, { dbId: 3, ownerCount: 2 }]);
  assert.equal(r.length, n);
  assert.ok(t.ticks >= 2 * n + n * passesOf(n), `saw ${t.ticks} ticks`);
  assert.ok(t.maxSpan <= 64, `${t.maxSpan} work reads between two ticks`);
  assert.equal(t.unawaited, 0);
  const plain = (x) => ({ dbId: x.dbId, ownerDbIds: [...x.ownerDbIds] });
  assert.deepEqual(r, hierarchyInternalCandidates({ rootsA: rootsA.map(plain), rootsB: rootsB.map(plain) }));
});

test('every Sliced form labels its ticks and works with a tick that never yields a Promise', async () => {
  const t = makeTicker();
  await assertRootAntichainSliced([root(1, [2]), root(3, [4])], t);
  await checkCrossRoleNestingSliced({ rootsA: [root(1, [2])], rootsB: [], rootsUnion: [root(1, [2])] }, t);
  await hierarchyInternalCandidatesSliced({ rootsA: [root(1, [2, 3])], rootsB: [root(1, [2, 3])] }, t);
  assert.ok(t.ticks > 0);
  assert.deepEqual([...t.labels], ['plan']);
});

test('the Sliced forms equal the sync forms (and the pre-fix references) on the 300-round random corpora, with async ticks', async () => {
  const asyncTick = (() => { let n = 0; return () => ((n += 1) % 5 === 0 ? Promise.resolve() : undefined); })();
  const tickSeam = { tick: asyncTick };

  let seed = 12345;
  const rand = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 4294967296; };
  const pick = (n) => Math.floor(rand() * n);
  for (let round = 0; round < 300; round += 1) {
    const roots = Array.from({ length: pick(9) }, () => root(1 + pick(6), Array.from({ length: pick(5) }, () => 1 + pick(8))));
    const expected = referenceAntichain(roots);
    assert.deepEqual(await assertRootAntichainSliced(roots, tickSeam), expected, JSON.stringify(roots));
    assert.deepEqual(assertRootAntichain(roots), expected);
  }
  const big = Array.from({ length: 40 }, (_, k) => root(1 + (k % 7), Array.from({ length: k % 4 }, (__, m) => 1 + ((k + m) % 9))));
  assert.deepEqual(await assertRootAntichainSliced(big, tickSeam), referenceAntichain(big));

  seed = 777;
  const mk = () => Array.from({ length: pick(6) }, () => root(1 + pick(10), Array.from({ length: pick(4) }, () => 1 + pick(8))));
  let unsupported = 0;
  for (let round = 0; round < 300; round += 1) {
    const input = { rootsA: mk(), rootsB: mk(), rootsUnion: mk() };
    const sync = checkCrossRoleNesting(input);
    assert.deepEqual(await checkCrossRoleNestingSliced(input, tickSeam), sync, JSON.stringify(input));
    if (!sync.supported) unsupported += 1;
  }
  assert.ok(unsupported > 30);

  // pre-fix hierarchyInternalCandidates, verbatim (filter -> map -> stable native sort), incl. duplicate dbIds
  const referenceHierarchy = ({ rootsA, rootsB }) => {
    const inB = new Set(rootsB.map((r) => r.dbId));
    return rootsA.filter((r) => inB.has(r.dbId) && r.ownerDbIds.length >= 2)
      .map((r) => ({ dbId: r.dbId, ownerCount: r.ownerDbIds.length })).sort((a, b) => a.dbId - b.dbId);
  };
  seed = 4242;
  let nonEmpty = 0;
  for (let round = 0; round < 300; round += 1) {
    const mkH = () => Array.from({ length: pick(12) }, () => root(1 + pick(9), Array.from({ length: pick(5) }, () => 1 + pick(8))));
    const input = { rootsA: mkH(), rootsB: mkH() };
    const expected = referenceHierarchy(input);
    assert.deepEqual(hierarchyInternalCandidates(input), expected, JSON.stringify(input));
    assert.deepEqual(await hierarchyInternalCandidatesSliced(input, tickSeam), expected, JSON.stringify(input));
    if (expected.length > 1) nonEmpty += 1;
  }
  assert.ok(nonEmpty > 30, 'the generator must produce multi-element results');
});
