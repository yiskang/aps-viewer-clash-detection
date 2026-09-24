// clashtest/planning/sizing.js
//
// Unit sizing of spec 6.4 (Task P3.7): turn the range-valued CellSpecs of decompose.js into WorkUnits by packing the
// SOURCE side and slicing the TARGET side independently, then taking their cross product (item 4). Source chunks
// partition the source roots and target slices partition the target roots, so the required pair space is still
// covered exactly once (spec 6.3) -- sizing options change chunking, never coverage.
//
// The two sides are deliberately asymmetric (spec 6.4, M7):
//   source  maxSourceFragmentsPerUnit / maxSourceDbIdsPerUnit are PACKING TARGETS: a single root heavier than the cap
//           forms a unit of its own (source size drives latency, an operational lever).
//   target  maxTargetModelsPerUnit / maxTargetFragmentsPerUnit are HARD per-unit bounds (target size drives the
//           library's whole-target extraction/diagnostic fan-out). A target entry that cannot be cut small enough --
//           a whole-model sentinel, or one root -- is never issued: every unit that would carry it is created here as
//           a `not-run:target-too-large` gap, a deterministic pre-call outcome.
//
// Everything is a range into the run's root tables (spec 6.5: no dbId arrays). `plan` is the buildRootTables result
// widened with `models` (the per-model entries carrying `scopeDigests.population.count`, the weight of a whole-model
// sentinel). A cell's target ranges are ordered [C, B'] per class, so the flattened root order is NOT globally
// ascending in dbId: every cut here is by RANGE order, between roots, never inside one.
//
// WorkUnit = { unitId, cell, sourceModelKey, sourceRanges, targets, orientationRole, pairSpaceWeight, targetWeight }
// (`targetWeight` is the non-durable per-unit target fragment weight sizing and splitting share). A gap is a WorkUnit
// plus { outcome: 'not-run', cause: 'target-too-large' }: P5 persists it as a leaf unit record.

import { rangeRootCount, readRange } from './planTables.js';
import { runSync, runSliced } from './steps.js';

/** The unit id of the `seq`-th unit (zero-based) of a cell: `${cell}.${seq}`; split children append `.0` / `.1`. */
export const unitIdFor = (cell, seq) => `${cell}.${seq}`;

const positive = (options, key) => {
  const v = options?.[key];
  if (!Number.isSafeInteger(v) || v < 1) throw new TypeError(`sizeUnits: ${key} must be a positive safe integer`);
  return v;
};

// A range that does not name a real slice of a real table is a caller bug: refuse, never read out of bounds.
function checkedRows(plan, { table, start, end }) {
  const t = plan.tableById.get(table);
  if (!t || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > t.rows.length) {
    throw new RangeError(`sizing: invalid range {table: ${String(table)}, start: ${String(start)}, end: ${String(end)}}`);
  }
  return t.rows;
}

// `plan.models` is a Map (the planner's own); the P6 alias `modelsByKey` is read as an own-property object as well.
function populationCount(plan, modelKey) {
  const models = plan.models;
  const entry = models instanceof Map ? models.get(modelKey)
    : models !== null && typeof models === 'object' && Object.hasOwn(models, modelKey) ? models[modelKey] : undefined;
  const count = entry?.scopeDigests?.population?.count;
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new TypeError(`sizing: the plan holds no whole-model population for ${String(modelKey)}`);
  }
  return count;
}

/** Roots a whole-model sentinel stands for: the model's run-start B' roots (a sentinel is legal only with no A role, so C is empty). */
function wholeRootCount(plan, modelKey) {
  const range = plan.rangeOfClass(modelKey, "B'");
  if (range === null) throw new TypeError(`sizing: whole-model target ${modelKey} has no roots`);
  return rangeRootCount(range);
}

/** Number of roots in a range list. */
export const sourceRootCount = (ranges) => ranges.reduce((n, r) => n + rangeRootCount(r), 0);

/** Number of roots one target entry stands for (a whole-model sentinel: the model's run-start root count, spec 6.5). */
export const targetEntryRootCount = (plan, target) => (target.scope === 'whole'
  ? wholeRootCount(plan, target.modelKey) : sourceRootCount(target.scope.ranges));

/**
 * Target weight in FRAGMENTS (spec 6.4 item 1): a whole-model sentinel weighs its `population.count` (every fragId,
 * a conservative upper bound on what extraction visits); an explicit entry weighs the sum of its roots' `fragmentCount`.
 */
export function targetEntryWeight(plan, target) {
  if (target.scope === 'whole') return populationCount(plan, target.modelKey);
  let w = 0;
  for (const range of target.scope.ranges) {
    const rows = checkedRows(plan, range);
    for (let i = range.start; i < range.end; i++) w += rows[i].fragmentCount;
  }
  return w;
}

/** `|source roots| x |target roots|` (spec 6.5), for progress; a whole-model target contributes its run-start root count. */
export const pairSpaceWeightOf = (plan, sourceRanges, targets) =>
  sourceRootCount(sourceRanges) * targets.reduce((n, t) => n + targetEntryRootCount(plan, t), 0);

/** Sum of the entries' target weights. */
export const targetWeightOf = (plan, targets) => targets.reduce((n, t) => n + targetEntryWeight(plan, t), 0);

/**
 * How many range records a unit costs the record budget (spec 6.5.1, class `unit-range`, erratum A14): one per
 * EXPANDED root id the unit record persists -- every source root id and every explicit target root id -- and one per
 * whole-model sentinel entry (persisted as `{modelKey, scope: 'model'}`). The charge follows the persisted form (the
 * sealed `UnitRecord` stores expanded ids, `unitRecordFields`), never the number of `{table, start, end}` ranges, so
 * a unit record costs at most `SCHEMA_NODE_FACTORS.ledger` nodes per charged record (D-8b). The same count is charged
 * for initial units, `target-too-large` gaps and split children (whose copied targets are charged again).
 */
export const rangeRecordCount = (unit) => sourceRootCount(unit.sourceRanges)
  + unit.targets.reduce((n, t) => n + (t.scope === 'whole' ? 1 : sourceRootCount(t.scope.ranges)), 0);

/**
 * A unit in the ledger's self-describing form (P5's `UnitRecord` fields: the sealed ledger is read without a plan, so
 * the root ids are expanded here from the ranges and the whole-model sentinel is spelled `model`), plus the `ranges`
 * count the planner charges to the budget's `unit-range` class. It is what `ledger.recordUnit` / `recordGap` take.
 */
export function unitRecordFields(plan, unit) {
  return {
    unitId: unit.unitId,
    sourceModelKey: unit.sourceModelKey,
    sourceRootDbIds: unit.sourceRanges.flatMap((r) => readRange(plan, r)),
    targets: unit.targets.map((t) => (t.scope === 'whole' ? { modelKey: t.modelKey, scope: 'model' }
      : { modelKey: t.modelKey, scope: 'roots', rootDbIds: t.scope.ranges.flatMap((r) => readRange(plan, r)) })),
    pairSpaceWeight: unit.pairSpaceWeight,
    ranges: rangeRecordCount(unit),
  };
}

/** Append `[start, end)` of `table` to a range list, extending the last range when it is exactly contiguous. */
function appendRoot(ranges, table, i) {
  const last = ranges[ranges.length - 1];
  if (last !== undefined && last.table === table && last.end === i) last.end = i + 1;
  else ranges.push({ table, start: i, end: i + 1 });
}

// The size-dependent loops below are step generators (see steps.js): one `yield` per root row / unit, so the sliced form
// can checkpoint at least every 64 items while the synchronous form shares every line of the logic.

/** Greedy packing of the source roots in range order. A packing TARGET, not a bound: an overweight root stands alone. */
function* packSource(plan, ranges, { maxSourceFragmentsPerUnit, maxSourceDbIdsPerUnit }) {
  const chunks = [];
  let cur = [];
  let curRoots = 0;
  let curFrags = 0;
  for (const range of ranges) {
    const rows = checkedRows(plan, range);
    for (let i = range.start; i < range.end; i++) {
      const w = rows[i].fragmentCount;
      if (curRoots > 0 && (curRoots + 1 > maxSourceDbIdsPerUnit || curFrags + w > maxSourceFragmentsPerUnit)) {
        chunks.push(cur);
        cur = [];
        curRoots = 0;
        curFrags = 0;
      }
      appendRoot(cur, range.table, i);
      curRoots++;
      curFrags += w;
      yield 'sizing:source-root';
    }
  }
  if (curRoots > 0) chunks.push(cur);
  return chunks;
}

/**
 * Target slicing (spec 6.4 item 3). Entries arrive ascending by modelKey. Returns the slices (each an array of
 * `{modelKey, whole, ranges, roots, weight}` entries within both hard caps) and the OVERSIZE entries: a whole
 * sentinel above the fragment cap, and the roots above it of each explicit entry, grouped per model. Oversize
 * entries are taken out of packing entirely (they can never be issued), so they do not disturb the slices.
 */
function* sliceTargets(plan, targets, { maxTargetModelsPerUnit, maxTargetFragmentsPerUnit }) {
  const slices = [];
  const oversize = [];
  let cur = [];
  let curModels = 0;
  let curWeight = 0;
  const flush = () => {
    if (cur.length > 0) { slices.push(cur); cur = []; curModels = 0; curWeight = 0; }
  };
  for (const t of targets) {
    if (t.scope === 'whole') {
      const weight = populationCount(plan, t.modelKey);
      const entry = { modelKey: t.modelKey, whole: true, ranges: null, roots: wholeRootCount(plan, t.modelKey), weight };
      yield 'sizing:target-entry';
      if (weight > maxTargetFragmentsPerUnit) { oversize.push(entry); continue; }   // M7: never issued
      flush();                                                                      // not partitionable: alone in a slice
      slices.push([entry]);
      continue;
    }
    let over = null;   // this model's oversize roots, one gap group per model
    for (const range of t.scope.ranges) {
      const rows = checkedRows(plan, range);
      for (let i = range.start; i < range.end; i++) {
        const w = rows[i].fragmentCount;
        if (w > maxTargetFragmentsPerUnit) {                                        // M7: a single root that cannot be cut
          if (over === null) { over = { modelKey: t.modelKey, whole: false, ranges: [], roots: 0, weight: 0 }; oversize.push(over); }
          appendRoot(over.ranges, range.table, i);
          over.roots++;
          over.weight += w;
          yield 'sizing:target-root';
          continue;
        }
        const sameModel = cur.length > 0 && cur[cur.length - 1].modelKey === t.modelKey;
        if ((!sameModel && curModels + 1 > maxTargetModelsPerUnit) || curWeight + w > maxTargetFragmentsPerUnit) flush();
        const open = cur.length > 0 && cur[cur.length - 1].modelKey === t.modelKey;   // re-read: a flush emptied `cur`
        if (!open) { cur.push({ modelKey: t.modelKey, whole: false, ranges: [], roots: 0, weight: 0 }); curModels++; }
        const entry = cur[cur.length - 1];
        appendRoot(entry.ranges, range.table, i);
        entry.roots++;
        entry.weight += w;
        curWeight += w;
        yield 'sizing:target-root';
      }
    }
  }
  flush();
  return { slices, oversize };
}

const toTarget = (e) => ({ modelKey: e.modelKey, scope: e.whole ? 'whole' : { ranges: e.ranges.map((r) => ({ ...r })) } });

/** The label a sizing step yields when a cell id's batch is complete (the planner checkpoints there unconditionally). */
export const SIZING_BATCH_LABEL = 'sizing:batch';

/**
 * `sizeUnits` as a step generator (steps.js): yields at every root row, target entry, unit and cell, and at the end of
 * each cell id's batch (`SIZING_BATCH_LABEL`); returns the `sizeUnits` result. `cells` is ANY iterable of CellSpecs, so a
 * lazy `decomposeCellsLazy` generator is consumed cell by cell and each CellSpec is released once its units exist.
 */
export function* sizeUnitSteps({ cells, plan, options, limit = Infinity }) {
  if (limit !== Infinity && (!Number.isSafeInteger(limit) || limit < 0)) throw new TypeError('sizeUnits: limit must be a non-negative safe integer');
  const caps = {
    maxSourceFragmentsPerUnit: positive(options, 'maxSourceFragmentsPerUnit'),
    maxSourceDbIdsPerUnit: positive(options, 'maxSourceDbIdsPerUnit'),
    maxTargetModelsPerUnit: positive(options, 'maxTargetModelsPerUnit'),
    maxTargetFragmentsPerUnit: positive(options, 'maxTargetFragmentsPerUnit'),
  };
  const units = [];
  const gaps = [];
  const seqByCell = new Map();
  const nextId = (cell) => {
    const seq = seqByCell.get(cell) ?? 0;
    seqByCell.set(cell, seq + 1);
    return unitIdFor(cell, seq);
  };
  let batchCell = null;
  for (const cell of cells) {
    if (batchCell !== null && cell.cell !== batchCell) yield SIZING_BATCH_LABEL;
    batchCell = cell.cell;
    const chunks = yield* packSource(plan, cell.sourceRanges, caps);
    const { slices, oversize } = yield* sliceTargets(plan, cell.targets, caps);
    for (const chunk of chunks) {
      const sourceRoots = sourceRootCount(chunk);
      const make = (entries) => ({
        unitId: nextId(cell.cell),
        cell: cell.cell,
        sourceModelKey: cell.sourceModelKey,
        sourceRanges: chunk.map((r) => ({ ...r })),
        targets: entries.map(toTarget),
        orientationRole: cell.orientationRole,
        pairSpaceWeight: sourceRoots * entries.reduce((n, e) => n + e.roots, 0),
        targetWeight: entries.reduce((n, e) => n + e.weight, 0),
      });
      for (const slice of slices) {
        units.push(make(slice));
        if (units.length + gaps.length > limit) return { units, gaps, exceeded: true };
        yield 'sizing:unit';
      }
      for (const entry of oversize) {
        gaps.push({ ...make([entry]), outcome: 'not-run', cause: 'target-too-large' });
        if (units.length + gaps.length > limit) return { units, gaps, exceeded: true };
        yield 'sizing:unit';
      }
    }
    yield 'sizing:cell';
  }
  if (batchCell !== null) yield SIZING_BATCH_LABEL;
  return { units, gaps, exceeded: false };
}

/**
 * @param {object} args
 * @param {Iterable<object>} args.cells  decomposeCells output (or the lazy `decomposeCellsLazy` generator), canonical order
 * @param {object} args.plan     buildRootTables' result widened with `models` (whole-model population counts)
 * @param {object} args.options  resolved run options; the four sizing caps are read
 * @param {number} [args.limit]  stop as soon as units + gaps EXCEED this many (default: no limit). The planner passes its
 *   remaining `maxUnitsPerRun`, so an oversized plan is refused after `limit + 1` units, never after the whole cross product
 *   of source chunks x target slices has been built (spec 6.5.1 "checked incrementally, before allocation"); and, because
 *   `cells` is consumed lazily, never after the whole cell list has been built either.
 * @returns {{units: object[], gaps: object[], exceeded: boolean}} `exceeded` is true when the limit tripped (the lists then
 *   hold the first `limit + 1` records only); `units` are issuable WorkUnits; `gaps` are the pre-terminal
 *   `not-run:target-too-large` unit records (same shape plus `outcome` and `cause`). Unit ids come from ONE per-cell
 *   counter shared by both, in emission order (source chunk outer; slices, then that chunk's gaps, inner).
 */
export function sizeUnits(args) {
  return runSync(sizeUnitSteps(args));
}

/**
 * `sizeUnits` for planning-sized inputs (spec 17.3): the same result, but `tick(label)` is awaited at every step, so the
 * caller checkpoints inside packing, slicing and unit construction and not only between cells. `tick` returns undefined
 * (not due) or a Promise; a throw (cancellation) abandons the sizing and releases the cell generator.
 * @param {object} args  as `sizeUnits`
 * @param {{tick: (label: string) => (void | Promise<void>)}} hooks
 */
export function sizeUnitsSliced(args, { tick }) {
  return runSliced(sizeUnitSteps(args), tick);
}
