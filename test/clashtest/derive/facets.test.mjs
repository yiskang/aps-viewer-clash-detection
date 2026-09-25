import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFacetSpec, compareFacetValues } from '../../../clashtest/derive/facets.js';
import { resolveAttributes } from '../../../clashtest/derive/attributeSeam.js';
import { InvalidOptionsError, FacetRangeError } from '../../../clashtest/errors.js';
import { canonicalJson } from '../../../clashtest/util/canonical.js';
import { makeResultSet, U1 } from './support/makeResultSet.mjs';

const R = (over = {}) => makeResultSet({ units: [U1], results: [{ pair: [['M', 100], ['M', 200]], ...over }] }).results[0];
const clr = (distance, p1 = [0, 0, 0], p2 = [0, 0, 0]) => ({ distance, clearance: 0.5, closestPoints: { first: p1, second: p2 } });
const vals = (spec, r, env = {}) => parseFacetSpec(spec).values(r, env);

test('facet specs are closed and validated', () => {
  for (const bad of ['nope', 'locationCell', { facet: 'locationCell' }, { facet: 'locationCell', size: 0 }, { facet: 'locationCell', size: NaN },
    { facet: 'locationCell', size: Infinity }, { facet: 'distanceBucket', width: -1 }, { facet: 'mode', extra: 1 }, { facet: 'locationCell', size: 1, width: 1 }, 42, null]) {
    assert.throws(() => parseFacetSpec(bad), InvalidOptionsError, JSON.stringify(bad));
  }
  const f = parseFacetSpec({ facet: 'locationCell', size: 2 });
  assert.deepEqual([f.facetId, f.params, f.multiValued, f.numeric], ['locationCell', { size: 2 }, false, false]);
  assert.equal(parseFacetSpec('element').multiValued, true);
  assert.equal(parseFacetSpec('attrEither:level').multiValued, true);
  assert.equal(parseFacetSpec({ facet: 'distanceBucket', width: 1 }).numeric, true);
});

test('single- and multi-valued built-ins', () => {
  const r = R();
  assert.deepEqual(vals('mode', r), ['volume-overlap']);
  assert.deepEqual(vals('pairModels', r), [['M', 'M']]);
  assert.deepEqual(vals('crossModel', r), [false]);
  assert.deepEqual(vals('elementFirst', r), [{ modelKey: 'M', dbId: 100 }]);
  assert.deepEqual(vals('element', r), [{ modelKey: 'M', dbId: 100 }, { modelKey: 'M', dbId: 200 }]);
  assert.deepEqual(vals('caveated', r, { reader: { pairStatus: () => ({ verdict: 'covered-caveated' }) } }), [true]);
});

test('locationCell: negative and boundary coordinates floor; -0 normalizes; no location is null', () => {
  const at = (p) => R({ evidence: { witness: { kind: 'surface-crossing', point: p } } });
  const cell = (r, size = 1) => vals({ facet: 'locationCell', size }, r)[0];
  assert.deepEqual(cell(at([-0.5, 1, -1])), [-1, 1, -1]);
  assert.deepEqual(cell(at([-0, 0, 0.999999])), [0, 0, 0]);
  assert.deepEqual(cell(at([2, 4, 6]), 2), [1, 2, 3]);
  assert.equal(Object.is(cell(at([-0, 0, 0]))[0], 0), true);
  assert.equal(cell(R({ evidence: { witness: null } })), null);
  const clrR = makeResultSet({ mode: 'clearance', clearance: 0.5, units: [U1], results: [{ pair: [['M', 100], ['M', 200]], evidence: clr(1, [0, 0, 0], [2, 2, 2]) }] }).results[0];
  assert.deepEqual(cell(clrR), [1, 1, 1]); // midpoint
  assert.notEqual(canonicalJson(['locationCell', { size: 1 }, null]), canonicalJson(['locationCell', { size: 1 }, [0, 0, 0]]));
});

test('R15-5: unsafe / non-finite buckets are FacetRangeError, never null or saturated', () => {
  const far = R({ evidence: { witness: { kind: 'surface-crossing', point: [1e30, 0, 0] } } });
  assert.throws(() => vals({ facet: 'locationCell', size: 1e-300 }, far), (e) => e instanceof FacetRangeError && e.facetId === 'locationCell');
  assert.throws(() => vals({ facet: 'locationCell', size: 1 }, far), FacetRangeError); // 1e30 is finite but not a safe integer
  const d = makeResultSet({ mode: 'clearance', clearance: 0.5, units: [U1], results: [{ pair: [['M', 100], ['M', 200]], evidence: clr(Number.MAX_VALUE) }] }).results[0];
  assert.throws(() => vals({ facet: 'distanceBucket', width: 1e-300 }, d), FacetRangeError);
});

test('distanceBucket is clearance-only', () => {
  const d = makeResultSet({ mode: 'clearance', clearance: 0.5, units: [U1], results: [{ pair: [['M', 100], ['M', 200]], evidence: clr(0.26) }] }).results[0];
  assert.deepEqual(vals({ facet: 'distanceBucket', width: 0.1 }, d), [2]);
  assert.deepEqual(vals({ facet: 'distanceBucket', width: 0.1 }, R()), [null]);
});

test('compareFacetValues: numbers numeric, strings by code unit, arrays lexicographic, refs by element order, null last', () => {
  const sorted = (xs) => [...xs].sort(compareFacetValues);
  assert.deepEqual(sorted([10, 9, -1, null, 2]), [-1, 2, 9, 10, null]);
  assert.deepEqual(sorted(['b', 'B', 'a', null]), ['B', 'a', 'b', null]);
  assert.deepEqual(sorted([[1, 2, 3], [1, 2], [0, 9, 9], null]), [[0, 9, 9], [1, 2], [1, 2, 3], null]);
  assert.deepEqual(sorted([{ modelKey: 'b', dbId: 1 }, { modelKey: 'a', dbId: 2 }, { modelKey: 'a', dbId: 1 }]).map((r) => `${r.modelKey}${r.dbId}`), ['a1', 'a2', 'b1']);
  assert.deepEqual(sorted([true, false]), [false, true]);
});

test('attribute facets: unavailable (not an error) with no snapshot; the seam is the single replacement point', () => {
  const set = makeResultSet({ units: [U1] });
  assert.deepEqual(resolveAttributes(set, undefined, ['level']), { available: false, reason: 'annotation-absent' });
  assert.equal(resolveAttributes(set, { any: 'snapshot' }, ['level']).available, false); // annotation layer is out of P8 scope
  const f = parseFacetSpec('attrFirst:level');
  assert.equal(f.attr.name, 'level');
  const attrs = { available: true, get: (ref, name) => (ref.dbId === 100 ? `L-${name}` : null) };
  assert.deepEqual(f.values(R(), { attrs }), ['L-level']);
  assert.deepEqual(parseFacetSpec('attrEither:level').values(R(), { attrs }), ['L-level', null]);
});

test('object-form facet names are own-property lookups: inherited names are unknown-facet, same as the string form', () => {
  const codeOf = (spec) => { try { parseFacetSpec(spec); } catch (e) { assert.ok(e instanceof InvalidOptionsError); return e.issues.map((i) => [i.code, i.path]); } assert.fail('no throw'); };
  for (const name of ['constructor', 'toString', 'hasOwnProperty', '__proto__']) {
    assert.deepEqual(codeOf({ facet: name }), [['unknown-facet', 'facet']], name);
    assert.deepEqual(codeOf({ facet: name }), codeOf(name), `${name}: object form == string form`);
  }
});
