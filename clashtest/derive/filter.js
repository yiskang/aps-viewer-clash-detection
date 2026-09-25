// clashtest/derive/filter.js
import { canonicalJson } from '../util/canonical.js';
import { parseFacetSpec } from './facets.js';
import { resolveAttributes } from './attributeSeam.js';
import { attrNames } from './groupBy.js';
import { buildStatusReaderSteps } from '../results/status.js';   // P5 (D4)
import { drive, assertCanonicalResultOrder } from './steps.js';
import { assertClosed, invalid, isJsonValue } from './validate.js';

const OPS = ['eq', 'in', 'lt', 'lte', 'gt', 'gte', 'isNull', 'notNull'];
const ORDERING = ['lt', 'lte', 'gt', 'gte'];
const num = (x) => typeof x === 'number';

/** §14.4 (R16 Q2): existential over the facet's value list; a null value never satisfies eq/in/ordering. */
export function clauseHolds(op, values, operand) {
  const nonNull = values.filter((x) => x !== null);
  switch (op) {
    case 'eq': { if (operand === null) return false; const k = canonicalJson(operand); return nonNull.some((x) => canonicalJson(x) === k); }
    case 'in': { const ks = new Set(operand.filter((s) => s !== null).map((s) => canonicalJson(s))); return nonNull.some((x) => ks.has(canonicalJson(x))); }
    case 'lt': return nonNull.some((x) => num(x) && x < operand);
    case 'lte': return nonNull.some((x) => num(x) && x <= operand);
    case 'gt': return nonNull.some((x) => num(x) && x > operand);
    case 'gte': return nonNull.some((x) => num(x) && x >= operand);
    case 'isNull': return nonNull.length === 0;
    case 'notNull': return nonNull.length > 0;
    default: throw new Error(`unreachable op ${op}`);
  }
}

function parseClause(c, i) {
  const path = `clauses[${i}]`;
  assertClosed(c, ['facet', 'op', 'value'], path);
  if (c.facet === undefined) throw invalid('facet-required', `${path}.facet`);
  if (!OPS.includes(c.op)) throw invalid('bad-op', `${path}.op`);
  const facet = parseFacetSpec(c.facet, `${path}.facet`);
  const has = Object.hasOwn(c, 'value');
  if (c.op === 'isNull' || c.op === 'notNull') { if (has) throw invalid('value-forbidden', `${path}.value`); }
  else if (!has) throw invalid('value-required', `${path}.value`);
  else if (c.op === 'eq' && !isJsonValue(c.value)) throw invalid('bad-value', `${path}.value`);
  else if (c.op === 'in' && !(Array.isArray(c.value) && isJsonValue(c.value))) throw invalid('bad-value', `${path}.value`);
  else if (ORDERING.includes(c.op)) {
    if (!facet.numeric) throw invalid('ordering-on-non-numeric-facet', `${path}.op`);
    if (!Number.isFinite(c.value)) throw invalid('bad-value', `${path}.value`);
  }
  return { facet, op: c.op, value: c.value };
}

export const filterRunner = {
  optionKeys: ['annotations', 'signal'],
  prepare({ clauses }, _opts, limits) {
    if (!Array.isArray(clauses)) throw invalid('clauses-required', 'clauses');
    if (clauses.length > limits.maxFilterClauses) throw invalid('too-many-clauses', 'clauses');
    return { clauses: clauses.map(parseClause) };
  },
  async run({ clauses }, [set], env) {
    const { gate } = env;
    await drive(assertCanonicalResultOrder(set.results, set.runId), gate);
    const attrs = resolveAttributes(set, env.annotations, attrNames(clauses.map((c) => c.facet)));
    const dead = clauses.filter((c) => c.facet.attr && !attrs.available);
    const unavailable = [...new Map(dead.map((c) => [c.facet.facetId, { facetId: c.facet.facetId, reason: attrs.reason }])).values()];
    const matches = [];
    if (dead.length === 0) {
      const fenv = { attrs, reader: clauses.some((c) => c.facet.needsReader) ? await drive(buildStatusReaderSteps(set), gate) : null };
      for (const r of set.results) {
        if (clauses.every((c) => clauseHolds(c.op, c.facet.values(r, fenv), c.value))) matches.push(r.resultId);
        const p = gate.tick(); if (p !== undefined) await p;
      }
    }
    return { matches, count: matches.length, total: set.results.length, unavailable };
  },
};
