// clashtest/derive/facets.js
import { FacetRangeError } from '../errors.js';
import { compareElementRefs } from '../identity/ids.js';
import { assertClosed, invalid, isPlainObject } from './validate.js';

function safeBucket(x, size, facetId) {
  const q = Math.floor(x / size);
  if (!Number.isSafeInteger(q)) throw new FacetRangeError({ facetId }); // covers Infinity/NaN and > 2^53
  return q + 0;                                                        // -0 -> 0
}
function locationPoint(r) {
  const ev = r.evidence;
  if (r.mode === 'volume-overlap') return ev?.witness?.point ?? null;
  if (r.mode === 'clearance' && ev?.closestPoints) { const { first: a, second: b } = ev.closestPoints; return [0, 1, 2].map((i) => a[i] / 2 + b[i] / 2); }
  return null;
}
const pos = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;

const single = (facetId, fn, extra = {}) => ({ facetId, params: {}, multiValued: false, numeric: false, attr: null, needsReader: false, values: (r, env) => [fn(r, env)], ...extra });
const BUILTIN = {
  mode: () => single('mode', (r) => r.mode),
  pairModels: () => single('pairModels', (r) => [r.pair.first.modelKey, r.pair.second.modelKey]),
  crossModel: () => single('crossModel', (r) => r.pair.first.modelKey !== r.pair.second.modelKey),
  elementFirst: () => single('elementFirst', (r) => r.pair.first),
  elementSecond: () => single('elementSecond', (r) => r.pair.second),
  element: () => ({ ...single('element', null), multiValued: true, values: (r) => [r.pair.first, r.pair.second] }),
  caveated: () => single('caveated', (r, env) => env.reader.pairStatus(r.pair).verdict === 'covered-caveated', { needsReader: true }),
};
const PARAM = {
  locationCell: { key: 'size', make: (size) => single('locationCell', (r) => { const p = locationPoint(r); return p === null ? null : p.map((c) => safeBucket(c, size, 'locationCell')); }, { params: { size } }) },
  distanceBucket: { key: 'width', make: (width) => single('distanceBucket', (r) => (r.mode === 'clearance' ? safeBucket(r.evidence.distance, width, 'distanceBucket') : null), { params: { width }, numeric: true }) },
};

function attrFacet(which, name, path) {
  if (name.length === 0 || name.length > 128) throw invalid('bad-attribute-name', path);
  const facetId = `attr${which[0].toUpperCase()}${which.slice(1)}:${name}`;
  const get = (ref, env) => env.attrs.get(ref, name) ?? null;
  const values = which === 'first' ? (r, env) => [get(r.pair.first, env)] : which === 'second' ? (r, env) => [get(r.pair.second, env)]
    : (r, env) => [get(r.pair.first, env), get(r.pair.second, env)];
  return { facetId, params: {}, multiValued: which === 'either', numeric: true, attr: { which, name }, needsReader: false, values };
}

export function parseFacetSpec(spec, path = 'facet') {
  if (typeof spec === 'string') {
    const m = /^attr(First|Second|Either):([\s\S]+)$/.exec(spec);
    if (m) return attrFacet(m[1].toLowerCase(), m[2], path);
    if (Object.hasOwn(BUILTIN, spec)) return BUILTIN[spec]();
    throw invalid(Object.hasOwn(PARAM, spec) ? 'missing-param' : 'unknown-facet', path);
  }
  if (!isPlainObject(spec) || typeof spec.facet !== 'string') throw invalid('bad-facet', path);
  const p = PARAM[spec.facet];
  if (p) { assertClosed(spec, ['facet', p.key], path); if (!pos(spec[p.key])) throw invalid('bad-param', `${path}.${p.key}`); return p.make(spec[p.key]); }
  assertClosed(spec, ['facet'], path);
  return parseFacetSpec(spec.facet, path);
}

export function compareFacetValues(a, b) {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  if (Array.isArray(a)) { const n = Math.min(a.length, b.length); for (let i = 0; i < n; i++) { const c = compareFacetValues(a[i], b[i]); if (c) return c; } return a.length - b.length; }
  if (typeof a === 'object') return compareElementRefs(a, b);
  if (typeof a === 'boolean') return a === b ? 0 : a ? 1 : -1;
  return a < b ? -1 : a > b ? 1 : 0;
}
