// test/clashpanel/core/orderedList.test.mjs — Task 14 (spec §10.3, §12.1-§12.3, AC-P5, AC-P17)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOrderedIndex, pageSlice, pageOfPosition, clampPage } from '../../../clashpanel/core/orderedList.js';
import { buildResultIndex } from '../../../clashpanel/core/resultIndex.js';
import { filterGroups, sortGroups, matchIdsFrom } from '../../../clashpanel/core/grouping.js';

const ref = (modelKey, dbId) => ({ modelKey, dbId });
const hard = (id, a, b) => ({ resultId: id, pair: { first: a, second: b }, mode: 'volume-overlap', evidence: { witness: null }, flags: {}, unitId: 'u' });
const soft = (id, distance) => ({ resultId: id, pair: { first: ref('A', 1), second: ref('B', 1) }, mode: 'clearance', evidence: { distance, clearance: 5, closestPoints: { first: [0, 0, 0], second: [1, 0, 0] } }, flags: {}, unitId: 'u' });
const idx = (results, mode = 'volume-overlap') => buildResultIndex({ results, definition: { mode, clearance: mode === 'clearance' ? 5 : undefined }, provenance: { models: [] } });
const all = (n) => Uint32Array.from({ length: n }, (_, i) => i);
const ids = (ordered, index) => Array.from({ length: ordered.length }, (_, i) => {
  const e = ordered.entryAt(i);
  return e.kind === 'group' ? `[${e.groupId}]` : `${e.groupId ?? '-'}:${index.at(e.canonicalIndex).resultId}`;
});

// Grouped fixture: r0 (A1–B9), r1 (A2–B9), r2 (A1–B8) → groups gA1{r0,r2} gA2{r1} gB8{r2} gB9{r0,r1}
const GSET = [hard('r0', ref('A', 1), ref('B', 9)), hard('r1', ref('A', 2), ref('B', 9)), hard('r2', ref('A', 1), ref('B', 8))];
const TABLE = { groups: [
  { groupId: 'gA1', ref: ref('A', 1), count: 2, memberIds: ['r0', 'r2'] }, { groupId: 'gA2', ref: ref('A', 2), count: 1, memberIds: ['r1'] },
  { groupId: 'gB8', ref: ref('B', 8), count: 1, memberIds: ['r2'] }, { groupId: 'gB9', ref: ref('B', 9), count: 2, memberIds: ['r0', 'r1'] },
], memberships: 6 };

test('flat default = matching order (canonical); gap-asc = stable permutation, ties by canonical index; Hard ignores gap-asc', () => {
  const s = idx([soft('s0', 2), soft('s1', 1), soft('s2', 2), soft('s3', 0.5)], 'clearance');
  assert.deepEqual(ids(buildOrderedIndex({ view: 'flat', matching: all(4), index: s }), s), ['-:s0', '-:s1', '-:s2', '-:s3']);
  const g = buildOrderedIndex({ view: 'flat', matching: all(4), index: s, sortKey: 'gap-asc' });
  assert.deepEqual(ids(g, s), ['-:s3', '-:s1', '-:s0', '-:s2'], 's0/s2 tie keeps canonical order');
  const h = idx(GSET);
  assert.deepEqual(ids(buildOrderedIndex({ view: 'flat', matching: all(3), index: h, sortKey: 'gap-asc' }), h), ['-:r0', '-:r1', '-:r2']);
  const matching = Uint32Array.from([0, 2, 3]);
  const m = buildOrderedIndex({ view: 'flat', matching, index: s, sortKey: 'gap-asc' });
  assert.deepEqual(ids(m, s), ['-:s3', '-:s0', '-:s2']);
  assert.deepEqual([...matching], [0, 2, 3], 'input not mutated');
});

test('grouped view flattens [header, members if expanded]; occurrences carry their group id', () => {
  const index = idx(GSET);
  const groups = filterGroups(TABLE, { matchIds: null, index });
  const collapsed = buildOrderedIndex({ view: 'grouped', matching: all(3), index, groups, expanded: new Set() });
  assert.deepEqual(ids(collapsed, index), ['[gA1]', '[gA2]', '[gB8]', '[gB9]']);
  assert.equal(collapsed.resultCount, 0);
  const open = buildOrderedIndex({ view: 'grouped', matching: all(3), index, groups, expanded: new Set(['gA1', 'gB9']) });
  assert.deepEqual(ids(open, index), ['[gA1]', 'gA1:r0', 'gA1:r2', '[gA2]', '[gB8]', '[gB9]', 'gB9:r0', 'gB9:r1']);
  assert.equal(open.resultCount, 4);
  assert.equal(open.positionOf({ groupId: 'gB9', resultId: 'r0' }), 6, 'THAT occurrence, not the first r0');
  assert.equal(open.positionOf({ groupId: 'gA1', resultId: 'r0' }), 1);
  assert.equal(open.positionOf({ groupId: null, resultId: 'r0' }), 1, 'flat-view selection ⇒ first rendered occurrence');
  assert.equal(open.positionOf({ groupId: 'gA2', resultId: 'r1' }), -1, 'collapsed group ⇒ not rendered');
  assert.equal(open.positionOf({ groupId: 'gB8', resultId: 'r0' }), -1, 'not a member of that group');
});

test('navNeighbor: flat Prev/Next, no wrap, selection outside the list ⇒ first/last, null selection ⇒ first/last', () => {
  const index = idx(GSET);
  const flat = buildOrderedIndex({ view: 'flat', matching: Uint32Array.from([0, 2]), index });
  assert.deepEqual(flat.navNeighbor({ groupId: null, resultId: 'r0' }, 1), { groupId: null, resultId: 'r2' });
  assert.equal(flat.navNeighbor({ groupId: null, resultId: 'r2' }, 1), null, 'end: no wrap');
  assert.equal(flat.navNeighbor({ groupId: null, resultId: 'r0' }, -1), null, 'start: no wrap');
  assert.deepEqual(flat.navNeighbor({ groupId: null, resultId: 'r1' }, 1), { groupId: null, resultId: 'r0' }, 'hidden by filters ⇒ first');
  assert.deepEqual(flat.navNeighbor({ groupId: null, resultId: 'r1' }, -1), { groupId: null, resultId: 'r2' }, 'hidden by filters ⇒ last');
  assert.deepEqual(flat.navNeighbor(null, 1), { groupId: null, resultId: 'r0' });
  assert.equal(buildOrderedIndex({ view: 'flat', matching: new Uint32Array(0), index }).navNeighbor(null, 1), null);
});

test('navNeighbor: grouped whole list skips headers; navScope keeps Prev/Next inside the chosen group', () => {
  const index = idx(GSET);
  const groups = filterGroups(TABLE, { matchIds: null, index });
  const open = buildOrderedIndex({ view: 'grouped', matching: all(3), index, groups, expanded: new Set(['gA1', 'gB9']) });
  assert.deepEqual(open.navNeighbor({ groupId: 'gA1', resultId: 'r2' }, 1), { groupId: 'gB9', resultId: 'r0' }, 'skips [gA2] [gB8] [gB9] headers');
  assert.deepEqual(open.navNeighbor({ groupId: 'gB9', resultId: 'r0' }, 1, 'gB9'), { groupId: 'gB9', resultId: 'r1' });
  assert.equal(open.navNeighbor({ groupId: 'gB9', resultId: 'r1' }, 1, 'gB9'), null, 'scope end: no wrap');
  assert.deepEqual(open.navNeighbor({ groupId: 'gA1', resultId: 'r2' }, -1, 'gB9'), { groupId: 'gB9', resultId: 'r1' }, 'selection not in scope ⇒ last of scope');
  assert.deepEqual(open.navNeighbor({ groupId: 'gA1', resultId: 'r0' }, 1, 'gone'), { groupId: 'gA1', resultId: 'r2' }, 'unknown scope ⇒ whole list');
});

test('navNeighbor: a collapsed navScope is ignored — the answer is always a RENDERED occurrence', () => {
  const index = idx(GSET);
  const groups = filterGroups(TABLE, { matchIds: null, index });
  const selected = { groupId: 'gB9', resultId: 'r0' };
  const collapsed = buildOrderedIndex({ view: 'grouped', matching: all(3), index, groups, expanded: new Set(['gA1']) });  // gB9 collapsed
  assert.equal(collapsed.positionOf(selected), -1);
  for (const [occ, dir] of [[selected, 1], [selected, -1], [null, 1], [null, -1]]) {
    const next = collapsed.navNeighbor(occ, dir, 'gB9');
    assert.ok(next !== null && collapsed.positionOf(next) >= 0, `rendered: ${JSON.stringify(next)}`);
  }
  assert.deepEqual(collapsed.navNeighbor(selected, 1, 'gB9'), { groupId: 'gA1', resultId: 'r0' }, 'not in list ⇒ first rendered result');
  assert.deepEqual(collapsed.navNeighbor(null, -1, 'gB9'), { groupId: 'gA1', resultId: 'r2' }, 'null ⇒ last rendered result');
  const none = buildOrderedIndex({ view: 'grouped', matching: all(3), index, groups, expanded: new Set() });
  assert.equal(none.navNeighbor(selected, 1, 'gB9'), null, 'nothing rendered ⇒ null, never an unrendered occurrence');
});

test('AC-P17: the SECOND occurrence of a multi-valued result keeps its position/page/navScope after re-sort and filter change', () => {
  const index = idx(GSET);
  const selected = { groupId: 'gB9', resultId: 'r0' };                          // r0 is also under gA1
  const expanded = new Set(['gA1', 'gB9']);
  const pageSize = 2;
  const build = (groups) => buildOrderedIndex({ view: 'grouped', matching: all(3), index, groups, expanded });
  const core = build(filterGroups(TABLE, { matchIds: null, index }));
  const resorted = build(sortGroups(filterGroups(TABLE, { matchIds: null, index }), 'count-desc', () => ''));
  const filtered = build(filterGroups(TABLE, { matchIds: matchIdsFrom(Uint32Array.from([0, 1]), index), index }));
  for (const [label, ordered] of [['core', core], ['count-desc', resorted], ['filtered', filtered]]) {
    const pos = ordered.positionOf(selected);
    assert.ok(pos >= 0, label);
    assert.deepEqual(ordered.entryAt(pos), { kind: 'result', canonicalIndex: 0, groupId: 'gB9' }, `${label}: still the gB9 occurrence`);
    assert.equal(pageOfPosition(pos, pageSize), Math.floor(pos / pageSize));
    assert.deepEqual(ordered.navNeighbor(selected, 1, 'gB9'), { groupId: 'gB9', resultId: 'r1' }, `${label}: navScope intact`);
  }
  assert.notEqual(core.positionOf(selected), resorted.positionOf(selected), 're-sort really moved it');
});

test('pagination: pageSlice / pageOfPosition / clampPage (AC-P5: hidden selection ⇒ page does not jump)', () => {
  const index = idx(Array.from({ length: 7 }, (_, i) => hard(`r${i}`, ref('A', i), ref('B', i))));
  const flat = buildOrderedIndex({ view: 'flat', matching: all(7), index });
  assert.deepEqual(pageSlice(flat, 1, 3).map((e) => e.canonicalIndex), [3, 4, 5]);
  assert.deepEqual(pageSlice(flat, 2, 3).map((e) => e.canonicalIndex), [6]);
  assert.deepEqual(pageSlice(flat, 99, 3).map((e) => e.canonicalIndex), [6], 'clamped to the last page');
  assert.deepEqual([clampPage(-4, 7, 3), clampPage(2.7, 7, 3), clampPage(NaN, 7, 3), clampPage(5, 0, 3)], [0, 2, 0, 0]);
  assert.equal(pageOfPosition(flat.positionOf({ groupId: null, resultId: 'r6' }), 3), 2);
  assert.equal(pageOfPosition(-1, 3), -1);
  assert.equal(flat.entryAt(7), undefined);
});

test('200k bounded-memory smoke: typed-array storage, entries allocated only on demand', () => {
  const N = 200_000;
  const results = new Array(N);
  for (let i = 0; i < N; i += 1) results[i] = soft(`s${i}`, (i * 7919) % 1000);
  const index = idx(results, 'clearance');
  const flat = buildOrderedIndex({ view: 'flat', matching: all(N), index, sortKey: 'gap-asc' });
  assert.ok(flat.storage.canonical instanceof Uint32Array);
  assert.equal(flat.length, N);
  assert.notEqual(flat.entryAt(5), flat.entryAt(5), 'no per-entry object cache');
  let prev = -1;
  for (let i = 0; i < N; i += 997) { const d = index.at(flat.entryAt(i).canonicalIndex).evidence.distance; assert.ok(d >= prev); prev = d; }
  assert.equal(flat.positionOf({ groupId: null, resultId: `s${N - 1}` }) >= 0, true);
  const groups = [{ groupId: 'g', ref: ref('A', 1), count: N, filteredCount: N, memberIndexes: Array.from({ length: N }, (_, i) => i) }];
  const grouped = buildOrderedIndex({ view: 'grouped', matching: all(N), index, groups, expanded: new Set(['g']) });
  assert.ok(grouped.storage.kinds instanceof Uint8Array && grouped.storage.canonical instanceof Uint32Array && grouped.storage.groupOrdinals instanceof Uint32Array);
  assert.equal(grouped.length, N + 1);
  assert.equal(pageSlice(grouped, 0, 50).length, 50);
});
