import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createContextInternal } from '../../../clashtest/derive/context.js';
import { runGroupBy } from '../../../clashtest/derive/groupBy.js';
import { parseFacetSpec } from '../../../clashtest/derive/facets.js';
import { InvalidOptionsError, GroupingTooLargeError, FacetRangeError, DerivationAbortedError, DerivationBusyError, CorruptResultSetError } from '../../../clashtest/errors.js';
import { makeResultSet } from './support/makeResultSet.mjs';
import { makeHarness } from './support/harness.mjs';

const models = [{ modelKey: 'A', modelVersion: 'v', roots: [1, 2, 3, 4].map((d) => ({ dbId: d, ownerDbIds: [d] })) },
  { modelKey: 'B', modelVersion: 'v', roots: [1, 2].map((d) => ({ dbId: d, ownerDbIds: [d] })) }];
const unit = { unitId: 'u', source: { modelKey: 'A', roots: [1, 2, 3, 4] }, targets: [{ modelKey: 'B', whole: true }, { modelKey: 'A', roots: [1, 2, 3, 4] }] };
const P = (a, b) => ({ pair: [a, b] });
const pairs = [P(['A', 1], ['B', 1]), P(['A', 1], ['B', 2]), P(['A', 2], ['B', 1]), P(['A', 3], ['A', 4])];
const mk = (over = {}) => makeResultSet({ models, units: [unit], results: pairs, ...over });
const ctx = (h = makeHarness(), limits = {}) => createContextInternal({ limits, now: h.now, yieldToScheduler: () => h.yieldToScheduler() });
// (context.js resolves DEFAULT_RUNNERS; this task registers groupBy there — see Step 3.)
const gb = (set, facets, o) => ctx().groupBy(set, facets, o);

test('single-valued facets PARTITION; multi-valued facets COVER (counts asserted accordingly)', async () => {
  const set = mk();
  const byCross = await gb(set, ['crossModel']);
  assert.equal(byCross.groups.reduce((n, g) => n + g.count, 0), set.results.length);
  const byEl = await gb(set, ['element']);
  assert.equal(byEl.facets[0].multiValued, true);
  assert.equal(byEl.groups.reduce((n, g) => n + g.count, 0), 2 * set.results.length); // covers, not partitions
  assert.equal(byEl.memberships, 2 * set.results.length);
});

test('groups are ordered by value, members in canonical result order, null last', async () => {
  const set = mk();
  const g = await gb(set, ['crossModel']);
  assert.deepEqual(g.groups.map((x) => x.value), [false, true]);
  assert.deepEqual(g.groups[1].members, set.results.filter((r) => r.pair.first.modelKey !== r.pair.second.modelKey).map((r) => r.resultId));
  const loc = await gb(mk({ results: [{ pair: [['A', 1], ['B', 1]], evidence: { witness: null } }, { pair: [['A', 3], ['A', 4]], evidence: { witness: { kind: 'surface-crossing', point: [5, 0, 0] } } }] }), [{ facet: 'locationCell', size: 1 }]);
  assert.deepEqual(loc.groups.map((x) => x.value), [[5, 0, 0], null]);
});

test('GroupId is canonical JSON of [facetId, params, value], stable across contexts and reruns; nested identity is the path', async () => {
  const set = mk();
  const a = await gb(set, ['mode', 'crossModel']); const b = await gb(structuredClone(set), ['mode', 'crossModel']);
  assert.deepEqual(a, b);
  const top = a.groups[0]; const leaf = top.children[0];
  assert.equal(top.groupId, JSON.stringify(['mode', {}, 'volume-overlap']));
  assert.deepEqual(leaf.path, [top.groupId, leaf.groupId]);
});

test('determinism: the same logical set built from a shuffled construction order groups identically', async () => {
  const shuffled = mk({ results: [pairs[3], pairs[1], pairs[0], pairs[2]] });
  assert.deepEqual(await gb(shuffled, ['element']), await gb(mk(), ['element']));
});

test('a raw set whose results are NOT in canonical order is refused, never silently reordered', async () => {
  const set = mk(); set.results.reverse();
  await assert.rejects(gb(set, ['mode']), CorruptResultSetError);
});

test('element-ref collision vectors never alias: group ids embed values via canonical JSON, never by delimiter concatenation', async () => {
  const set = makeResultSet({ models: [{ modelKey: 'a:1', modelVersion: 'v', roots: [{ dbId: 2, ownerDbIds: [2] }] }, { modelKey: 'a', modelVersion: 'v', roots: [{ dbId: 1, ownerDbIds: [1] }, { dbId: 9, ownerDbIds: [9] }] }],
    units: [{ unitId: 'u', source: { modelKey: 'a', roots: [1] }, targets: [{ modelKey: 'a:1', whole: true }, { modelKey: 'a', roots: [9] }] }],
    results: [P(['a', 1], ['a:1', 2]), P(['a', 9], ['a', 1])] });
  const g = await gb(set, ['element']);
  const ids = g.groups.map((x) => x.groupId);
  assert.equal(g.groups.length, 3);                       // {a,1}, {a,9}, {a:1,2} stay three distinct groups
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.includes(JSON.stringify(['element', {}, { dbId: 2, modelKey: 'a:1' }])));   // ids embed values via canonical JSON, never by delimiter concatenation
});

test('unavailable attribute facets: omitted from the levels and listed; built-ins unaffected; never an error', async () => {
  const g = await gb(mk(), ['mode', 'attrEither:level', 'attrFirst:cat']);
  assert.deepEqual(g.facets.map((f) => f.facetId), ['mode']);
  assert.deepEqual(g.unavailable.map((u) => u.facetId), ['attrEither:level', 'attrFirst:cat']);
  assert.equal(g.unavailable[0].reason, 'annotation-absent');
  assert.equal(g.groups.length, 1);
});

test('attribute facets when a resolver IS available (internal path; the seam replacement is the follow-up)', async () => {
  const set = mk(); const attrs = { available: true, get: (ref, name) => (ref.modelKey === 'A' ? 'L1' : 'L2') };
  const parsed = ['attrEither:level'].map((f) => parseFacetSpec(f));
  const env = { limits: { maxGroupMemberships: 1000 }, gate: { tick() {}, check() {} } };
  const g = await runGroupBy({ set, parsed, attrs, env });
  assert.deepEqual(g.groups.map((x) => [x.value, x.count]), [['L1', 4], ['L2', 3]]); // {L1} for AA, {L1,L2} for AB: dedup within a result
});

test('range safety: FacetRangeError, no partial grouping', async () => {
  const set = mk({ results: [{ pair: [['A', 1], ['B', 1]], evidence: { witness: { kind: 'surface-crossing', point: [1e30, 0, 0] } } }] });
  await assert.rejects(gb(set, [{ facet: 'locationCell', size: 1e-300 }]), FacetRangeError);
});

test('bounds: facets > max, repeated facet, no facets => InvalidOptionsError', async () => {
  const c = ctx(makeHarness(), { maxFacetsPerGroupBy: 2 });
  await assert.rejects(c.groupBy(mk(), ['mode', 'crossModel', 'element']), InvalidOptionsError);
  await assert.rejects(c.groupBy(mk(), ['mode', 'mode']), InvalidOptionsError);
  await assert.rejects(c.groupBy(mk(), []), InvalidOptionsError);
  await assert.rejects(c.groupBy(mk(), ['mode'], { extra: 1 }), InvalidOptionsError);
});

test('GroupingTooLargeError comes from the incremental count BEFORE allocation, with no partial grouping', async () => {
  const probe = { allocated: 0, onMembership() { this.allocated += 1; } };
  const parsed = ['element', 'attrEither:x'].map((f) => parseFacetSpec(f)); // two DISTINCT multi-valued facets
  const attrs = { available: true, get: (ref) => `v${ref.dbId}` };
  const env = { limits: { maxGroupMemberships: 10 }, gate: { tick() {}, check() {} } };
  const big = mk();                                                       // 4 results x 4 facet paths (2 elements x 2 attribute values) = 16 > 10
  await assert.rejects(runGroupBy({ set: big, parsed, attrs, env, probe }), (e) => e instanceof GroupingTooLargeError && e.limit === 10 && e.observed > 10);
  assert.ok(probe.allocated <= 10, `allocated ${probe.allocated} <= limit`);
  const single = await runGroupBy({ set: big, parsed: [parseFacetSpec('mode')], attrs, env });   // same size, single-valued: succeeds
  assert.equal(single.memberships, big.results.length);
});

test('sliced + abort + busy through the context', async () => {
  const h = makeHarness(); const many = mk({ results: Array.from({ length: 4 }, (_, i) => P(['A', i + 1], ['B', 1])) });
  const c = ctx(h, { aggregationSliceMaxItems: 1, maxConcurrentDerivations: 2 });
  await c.groupBy(many, ['mode']); assert.ok(h.yields >= 3);
  const ac = new AbortController(); const start = h.yields; h.onYield = (n) => n === start + 1 && ac.abort();
  await assert.rejects(c.groupBy(many, ['mode'], { signal: ac.signal }), DerivationAbortedError);
  h.onYield = null; h.hold(); const t = [c.groupBy(many, ['mode']), c.groupBy(many, ['mode'])];
  await assert.rejects(c.groupBy(many, ['mode']), DerivationBusyError);
  h.releaseAll(); await Promise.all(t);
});
