// clashtest/planning/planTables.js
//
// Run-scoped, normalized plan tables of spec 6.5 (Task P3.4). Per model and per class (A', C, B') the planner builds
// ONE immutable, ascending root table once; every unit, split child and ledger record refers to it by half-open
// `{table, start, end}` ranges, and a split produces sub-ranges, never copies (plan memory is O(roots + owners +
// unit records), not O(units x targets)). Table ids are positional (`t0`, `t1`, ...) in canonical build order, so no
// modelKey ever needs escaping inside a range and the ids are a pure function of the input set.
//
// Every allocation is charged to the run's RecordBudget BEFORE it is made (spec 6.5.1). Plain data throughout,
// except the Maps used for O(1) lookup, which never cross a durable boundary.
//
// The build is written once as a step generator (steps.js): `buildRootTables` runs it synchronously (small inputs,
// oracles, tests) and `buildRootTablesSliced` awaits a `tick` at every root row and every fragment owner (spec 17.3), so
// a 100,000-root model never runs as one uncheckpointed span.

import { runSync, runSliced } from './steps.js';

/** The table classes, in canonical build order. */
export const TABLE_CLASSES = Object.freeze(["A'", 'C', "B'"]);

const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const isId = (v) => Number.isSafeInteger(v) && v >= 0;

// A structurally bad enumeration is an ENUMERATOR defect (spec 6.2): planning fails `enumeration-failed`.
const defect = (modelKey, code) => ({ ok: false, cause: 'enumeration-failed', detail: { modelKey, code } });

/**
 * The step generator behind `buildRootTables` / `buildRootTablesSliced`: yields a label per root row and per owner.
 * @param {{models: Array<{modelKey: string, classes: Record<string, Array<{dbId: number, fragmentCount: number,
 *   ownerDbIds: number[], subtreeDigest: string}>>}>, budget: object}} args each class list is ascending by dbId
 * @returns {{ok: true, tables: object[], tableById: Map, ownersByModel: Map<string, number[]>,
 *   ownerRootByModel: Map<string, Map<number, number>>, rangeOfClass: (modelKey: string, cls: string) => object | null}
 *   | {ok: false, cause: 'plan-too-large', overflowClass: string}
 *   | {ok: false, cause: 'enumeration-failed', detail: {modelKey: string, code: string}}}
 */
function* buildRootTablesSteps({ models, budget }) {
  const ordered = [...models].sort((a, b) => byCodeUnit(a.modelKey, b.modelKey));
  for (let i = 1; i < ordered.length; i++) {
    if (ordered[i].modelKey === ordered[i - 1].modelKey) throw new TypeError(`buildRootTables: modelKey ${ordered[i].modelKey} listed twice`);
  }

  const tables = [];
  const tableById = new Map();
  const ownersByModel = new Map();
  const ownerRootByModel = new Map();
  const rangesByModel = new Map();   // modelKey -> class -> the full range of that table (absent = empty class)

  for (const { modelKey, classes } of ordered) {
    for (const key of Object.keys(classes)) {
      if (!TABLE_CLASSES.includes(key)) throw new TypeError(`buildRootTables: unknown class ${key}`);
    }
    const perClass = TABLE_CLASSES.map((cls) => classes[cls] ?? []);
    if (!perClass.every(Array.isArray)) throw new TypeError('buildRootTables: every class must be an array of root rows');

    // Charge the model's rows, then its owner entries, each as one block BEFORE anything is allocated.
    let rowCount = 0;
    let ownerCount = 0;
    for (const rows of perClass) {
      rowCount += rows.length;
      for (const r of rows) {
        if (!Array.isArray(r?.ownerDbIds)) return defect(modelKey, 'owners-not-an-array');
        ownerCount += r.ownerDbIds.length;
        yield 'planTables:count';
      }
    }
    if (!budget.admitPlanBlock([['root-table', rowCount], ['root-owner', ownerCount]])) {
      return { ok: false, cause: 'plan-too-large', overflowClass: budget.planOverflowClass };
    }

    const owners = [];
    const ownerRoot = new Map();
    const classRanges = new Map();
    const seenRoots = new Set();
    let bad = null;   // first structural defect of this model, if any
    for (let ci = 0; ci < TABLE_CLASSES.length && bad === null; ci++) {
      if (perClass[ci].length === 0) continue;   // an empty class has no table (and takes no id)
      let previous = -1;
      const rows = [];
      for (const r of perClass[ci]) {
        // A root owns at least one collision-eligible fragment (a subtree owning none is `unresolved: no-fragments`, spec 6.2),
        // and every fragment has an owner: a zero-weight or ownerless root is phantom pair space.
        if (!isId(r.dbId) || !isId(r.fragmentCount) || r.fragmentCount === 0 || r.ownerDbIds.length === 0
          || typeof r.subtreeDigest !== 'string') { bad = 'malformed-root'; break; }
        // Roots are a subtree-disjoint antichain: strictly ascending within a class, unique across the model's classes.
        if (r.dbId <= previous || seenRoots.has(r.dbId)) { bad = 'roots-not-ascending-or-repeated'; break; }
        previous = r.dbId;
        seenRoots.add(r.dbId);
        const ownerStart = owners.length;
        let previousOwner = -1;
        for (const o of r.ownerDbIds) {
          // A fragment owner under two roots (or repeated / unordered under one) is an enumerator defect (spec 6.2).
          if (!isId(o) || o <= previousOwner || ownerRoot.has(o)) { bad = 'owner-repeated-or-unordered'; break; }
          previousOwner = o;
          ownerRoot.set(o, r.dbId);
          owners.push(o);
          yield 'planTables:owner';
        }
        if (bad !== null) break;
        rows.push(Object.freeze({
          dbId: r.dbId, fragmentCount: r.fragmentCount, subtreeDigest: r.subtreeDigest, ownerStart, ownerEnd: owners.length,
        }));
        yield 'planTables:row';
      }
      if (bad === null) {
        const table = Object.freeze({ id: `t${tables.length}`, modelKey, cls: TABLE_CLASSES[ci], rows: Object.freeze(rows) });
        tables.push(table);
        tableById.set(table.id, table);
        classRanges.set(TABLE_CLASSES[ci], Object.freeze({ table: table.id, start: 0, end: rows.length }));
      }
    }
    if (bad !== null) return defect(modelKey, bad);
    ownersByModel.set(modelKey, Object.freeze(owners));
    ownerRootByModel.set(modelKey, ownerRoot);
    rangesByModel.set(modelKey, classRanges);
  }

  /**
   * The full half-open range of one (model, class) table, or null when that class is empty (an empty class has no
   * table). A fresh plain object per call, so a caller can never alias the plan's own. A model the plan does not
   * hold, or a class that does not exist, is a caller bug and throws.
   */
  function rangeOfClass(modelKey, cls) {
    if (!TABLE_CLASSES.includes(cls)) throw new TypeError(`rangeOfClass: unknown class ${String(cls)}`);
    const classRanges = rangesByModel.get(modelKey);
    if (classRanges === undefined) throw new RangeError(`rangeOfClass: the plan holds no model ${String(modelKey)}`);
    const r = classRanges.get(cls);
    return r === undefined ? null : { table: r.table, start: r.start, end: r.end };
  }

  return { ok: true, tables: Object.freeze(tables), tableById, ownersByModel, ownerRootByModel, rangeOfClass };
}

/** The root tables of one run, built synchronously (small inputs, oracles, tests). Planning uses `buildRootTablesSliced`. */
export function buildRootTables(args) {
  return runSync(buildRootTablesSteps(args));
}

/**
 * `buildRootTables` for planning-sized inputs: the same result, with `tick(label)` awaited at every root row and owner
 * (returns undefined when no yield is due, else a Promise; a throw, e.g. cancellation, aborts the build).
 * @param {object} args  as `buildRootTables`
 * @param {{tick: (label: string) => (void | Promise<void>)}} hooks
 */
export function buildRootTablesSliced(args, { tick }) {
  return runSliced(buildRootTablesSteps(args), tick);
}

/** A range that does not name a real slice of a real table is a caller bug: refuse, never read out of bounds. */
function rowsOfRange(plan, { table, start, end }) {
  const t = plan.tableById.get(table);
  if (!t || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > t.rows.length) {
    throw new RangeError(`invalid range {table: ${String(table)}, start: ${String(start)}, end: ${String(end)}}`);
  }
  return t.rows;
}

export function rangeRootCount(range) { return range.end - range.start; }

/** The root dbIds of one range, ascending. */
export function readRange(plan, range) {
  const rows = rowsOfRange(plan, range);
  const out = [];
  for (let i = range.start; i < range.end; i++) out.push(rows[i].dbId);
  return out;
}

/** The range's target/source weight in FRAGMENTS (never `pairSpaceWeight`, which is a root product). */
export function rangeFragmentWeight(plan, range) {
  const rows = rowsOfRange(plan, range);
  let w = 0;
  for (let i = range.start; i < range.end; i++) w += rows[i].fragmentCount;
  return w;
}

/**
 * Deterministic bisection of an ORDERED range list by root count: the left half gets floor(total / 2) roots, so a
 * single root goes entirely right. It cuts only between roots (a range boundary or an interior row index), so the two
 * halves are an exact, order-preserving partition of the input and no root is ever split.
 */
export function bisectRanges(plan, ranges) {
  for (const r of ranges) rowsOfRange(plan, r);
  const total = ranges.reduce((n, r) => n + rangeRootCount(r), 0);
  const half = Math.floor(total / 2);
  const left = [];
  const right = [];
  let seen = 0;
  for (const r of ranges) {
    const n = rangeRootCount(r);
    if (n === 0) continue;
    if (seen + n <= half) {
      left.push({ table: r.table, start: r.start, end: r.end });
    } else if (seen >= half) {
      right.push({ table: r.table, start: r.start, end: r.end });
    } else {
      const cut = r.start + (half - seen);
      left.push({ table: r.table, start: r.start, end: cut });
      right.push({ table: r.table, start: cut, end: r.end });
    }
    seen += n;
  }
  return [left, right];
}
