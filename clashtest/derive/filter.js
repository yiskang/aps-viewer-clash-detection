// clashtest/derive/filter.js
import { canonicalJson } from '../util/canonical.js';
import { resolveEngineLimits } from '../options.js';
import { parseFacetSpec } from './facets.js';
import { resolveAttributes } from './attributeSeam.js';
import { attrNames } from './groupBy.js';
import { buildStatusReaderSteps } from '../results/status.js';   // P5 (D4)
import { drive, assertCanonicalResultOrder } from './steps.js';
import { captureArray, captureClosed, captureJsonOperand, invalid } from './validate.js';

let DEFAULT_NODES;   // §17.1 default maxCapturedNodes, for a direct `prepare` call without context bounds
const defaultMaxCapturedNodes = () => (DEFAULT_NODES ??= resolveEngineLimits({}).maxCapturedNodes);

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

/** eq/in comparison keys, precomputed ONCE from the OWNED operand: the same canonical JSON `clauseHolds` would compute per result.
 *  The owned copy is plain data within depth 64 and the node budget, so `canonicalJson` cannot refuse it; the one failure left is
 *  the host's string-length limit (a RangeError, e.g. huge caller strings shared many times), which is a bounded-resource
 *  refusal and is reported explicitly as InvalidOptionsError — never a silent non-match. Anything else propagates (a bug). */
function keyOf(v, path) {
  try { return canonicalJson(v); } catch (e) { if (e instanceof RangeError) throw invalid('operand-too-large', path); throw e; }
}
function operandKeys(op, value, path) {
  if (op === 'eq') return value === null ? null : keyOf(value, path);
  const ks = new Set(); for (const s of value) if (s !== null) ks.add(keyOf(s, path)); return ks;
}
/** `clauseHolds` over a prepared clause: identical truth rules, but eq/in use the precomputed owned keys. */
function preparedHolds(c, values) {
  if (c.op === 'eq') { if (c.keys === null) return false; return values.some((x) => x !== null && canonicalJson(x) === c.keys); }
  if (c.op === 'in') return values.some((x) => x !== null && c.keys.has(canonicalJson(x)));
  return clauseHolds(c.op, values, c.value);
}

function parseClause(raw, i, budget) {
  const path = `clauses[${i}]`;
  const c = captureClosed(raw, ['facet', 'op', 'value'], path);   // M1: detached copy; `raw` is never re-read
  if (c.facet === undefined) throw invalid('facet-required', `${path}.facet`);
  if (!OPS.includes(c.op)) throw invalid('bad-op', `${path}.op`);
  const facet = parseFacetSpec(c.facet, `${path}.facet`);
  const has = Object.hasOwn(c, 'value');
  let value = c.value; let keys;
  if (c.op === 'isNull' || c.op === 'notNull') { if (has) throw invalid('value-forbidden', `${path}.value`); }
  else if (!has) throw invalid('value-required', `${path}.value`);
  else if (c.op === 'eq' || c.op === 'in') {
    // M2: OWN the operand now (sync, before any await) as detached JSON-safe data; only the owned copy is used by `run`.
    // M2 refinement: every operand of this call is charged, by its EXPANDED node count, against ONE shared budget.
    const owned = captureJsonOperand(c.value, `${path}.value`, budget.remaining);
    if (c.op === 'in' && !Array.isArray(owned.value)) throw invalid('bad-value', `${path}.value`);
    budget.remaining -= owned.nodes;
    value = owned.value; keys = operandKeys(c.op, owned.value, `${path}.value`);
  } else if (ORDERING.includes(c.op)) {
    if (!facet.numeric) throw invalid('ordering-on-non-numeric-facet', `${path}.op`);
    if (!Number.isFinite(c.value)) throw invalid('bad-value', `${path}.value`);
  }
  return { facet, op: c.op, value, keys };
}

export const filterRunner = {
  optionKeys: ['annotations', 'signal'],
  /** `bounds.maxCapturedNodes` (internal, from the context's resolved engine limits — not a derivation option) is the §13.6
   *  captured-node budget shared by all eq/in operands of this call. */
  prepare({ clauses }, _opts, limits, bounds) {
    const own = captureArray(clauses, 'clauses', 'clauses-required', (n) => {   // M1: guarded, once; bound checked before any element is read
      if (n > limits.maxFilterClauses) throw invalid('too-many-clauses', 'clauses');
    });
    const budget = { remaining: bounds?.maxCapturedNodes ?? defaultMaxCapturedNodes() };
    return { clauses: own.map((c, i) => parseClause(c, i, budget)) };
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
        if (clauses.every((c) => preparedHolds(c, c.facet.values(r, fenv)))) matches.push(r.resultId);
        const p = gate.tick(); if (p !== undefined) await p;
      }
    }
    return { matches, count: matches.length, total: set.results.length, unavailable };
  },
};
