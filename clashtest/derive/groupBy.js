// clashtest/derive/groupBy.js
import { GroupingTooLargeError } from '../errors.js';
import { canonicalJson } from '../util/canonical.js';
import { parseFacetSpec, compareFacetValues } from './facets.js';
import { resolveAttributes } from './attributeSeam.js';
import { buildStatusReaderSteps } from '../results/status.js';   // P5 (D4)
import { drive, assertCanonicalResultOrder } from './steps.js';
import { captureArray, invalid } from './validate.js';

const uniqueValues = (list) => { const seen = new Map(); for (const v of list) { const key = canonicalJson(v); if (!seen.has(key)) seen.set(key, { key, value: v }); } return [...seen.values()]; };

function place(container, li, lists, levels, resultId, idx, path, probe) {
  const last = li === levels.length - 1;
  for (const { key, value } of lists[li]) {
    let node = container.get(key);
    if (!node) {
      const groupId = canonicalJson([levels[li].facetId, levels[li].params, value]);
      node = { value, groupId, path: [...path, groupId], count: 0, seen: -1, kids: last ? null : new Map(), members: last ? [] : null };
      container.set(key, node);
    }
    if (node.seen !== idx) { node.seen = idx; node.count += 1; }   // an inner node reached by several paths counts the result once
    if (last) { node.members.push(resultId); probe?.onMembership(); } else place(node.kids, li + 1, lists, levels, resultId, idx, node.path, probe);
  }
}
function finalize(container, levels, depth) {
  return [...container.values()].sort((a, b) => compareFacetValues(a.value, b.value)).map((n) => {
    const out = { groupId: n.groupId, path: n.path, facetId: levels[depth].facetId, params: levels[depth].params, value: n.value, count: n.count };
    if (n.members) out.members = n.members; else out.children = finalize(n.kids, levels, depth + 1);
    return out;
  });
}

export async function runGroupBy({ set, parsed, attrs, env, probe = null }) {
  const { gate, limits } = env;
  await drive(assertCanonicalResultOrder(set.results, set.runId), gate);
  const unavailable = []; const levels = [];
  for (const f of parsed) (f.attr && !attrs.available ? unavailable.push({ facetId: f.facetId, reason: attrs.reason }) : levels.push(f));
  const fenv = { attrs, reader: levels.some((l) => l.needsReader) ? await drive(buildStatusReaderSteps(set), gate) : null };
  const root = new Map(); let memberships = 0;
  for (let i = 0; i < set.results.length && levels.length; i++) {
    const r = set.results[i];
    const lists = levels.map((l) => uniqueValues(l.values(r, fenv)));       // FacetRangeError propagates: no partial grouping
    const product = lists.reduce((n, l) => n * l.length, 1);                // derived membership records for this result
    if (memberships + product > limits.maxGroupMemberships) throw new GroupingTooLargeError({ limit: limits.maxGroupMemberships, observed: memberships + product });
    memberships += product;                                                  // counted BEFORE allocating them
    place(root, 0, lists, levels, r.resultId, i, [], probe);
    const p = gate.tick(); if (p !== undefined) await p;
  }
  return { facets: levels.map(({ facetId, params, multiValued }) => ({ facetId, params, multiValued })), unavailable, total: set.results.length, memberships,
    groups: levels.length ? finalize(root, levels, 0) : [] };
}

export const attrNames = (parsed) => parsed.filter((f) => f.attr).map((f) => f.attr.name);
export const groupByRunner = {
  optionKeys: ['annotations', 'signal'],
  prepare({ facets: raw }, _opts, limits) {
    const facets = captureArray(raw, 'facets', 'facets-required', (n) => {   // M1: guarded, once; bounds checked before any element is read
      if (n < 1) throw invalid('facets-required', 'facets');
      if (n > limits.maxFacetsPerGroupBy) throw invalid('too-many-facets', 'facets');
    });
    const parsed = facets.map((f, i) => parseFacetSpec(f, `facets[${i}]`));
    const seen = new Set();
    for (const p of parsed) { const k = canonicalJson([p.facetId, p.params]); if (seen.has(k)) throw invalid('redundant-facet', 'facets'); seen.add(k); }
    return { parsed };
  },
  run: ({ parsed }, [set], env) => runGroupBy({ set, parsed, attrs: resolveAttributes(set, env.annotations, attrNames(parsed)), env }),
};
