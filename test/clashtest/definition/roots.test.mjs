// test/clashtest/definition/roots.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertRootAntichain, checkCrossRoleNesting, hierarchyInternalCandidates }
  from '../../../clashtest/definition/normalize.js';

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
