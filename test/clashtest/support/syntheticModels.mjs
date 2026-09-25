// test/clashtest/support/syntheticModels.mjs
//
// Declarative model specs -> a conforming fake ElementEnumerator (spec 6.2), shared by every P3 test.
// Added to the P0 support dir per its extension rule 2 (a new file; fakeEnumerator.mjs is untouched).
// `createFakeEnumerator` stays the right double for a test that needs no model topology; this one is
// for tests that state a hierarchy or an unreachable population.
//
// modelSpec = {
//   modelKey: string,
//   roots: [{ dbId, owners: number[] /* ascending, incl. dbId when it owns fragments */,
//             fragments: [{ fragId, ownerDbId, geometryId }] }],        // ascending by dbId
//   unreachable: [{ fragId, cls: 'L'|'N'|'U', ownerDbId?: number, geometryId?: number }],
//   ancestorOf: { [descendantDbId]: ancestorRootDbId },  // explicit-list antichain reduction + non-root nodes
//   missingDbIds: number[],       // dbIds that are not nodes of the tree      -> 'not-found'
//   emptyDbIds: number[],         // real nodes whose subtree owns no fragment -> 'no-fragments'
//   ownerMismatchCount?: number,  // forced tree-owner vs fragList-owner disagreement
// }
// A node that is not a root (an `ancestorOf` key, or an owner listed under a root) is a leaf whose
// subtree is the fragments that root holds for that owner.
import { digestPopulation, digestSubtree } from '../../../clashtest/planning/scopeDigest.js';
import { normalizeDefinition, deepFreezeDefinition } from '../../../clashtest/definition/normalize.js';
import { makeDefinition } from './definitions.mjs';

const asc = (a, b) => a - b;
const clone = (v) => structuredClone(v);

/** A Binding-shaped plain object (identity/ModelRegistry.js): only `modelKey` is read by the fake. */
export function makeSyntheticBinding(modelKey) {
  const model = { modelKey };
  return Object.freeze({
    modelKey, model, modelVersion: 'v1',
    lease: Object.freeze({ model, epoch: 1 }), bindingGeneration: 1, placementGeneration: 1,
  });
}

/** One root's subtree records, in the shape the subtree digest covers. */
const subtreeRecords = (fragments) => fragments.map((f) => ({ fragId: f.fragId, ownerDbId: f.ownerDbId, geometryId: f.geometryId }));

async function rootRecord(dbId, fragments, owners) {
  const ownerDbIds = owners ?? [...new Set(fragments.map((f) => f.ownerDbId))].sort(asc);
  return { dbId, fragmentCount: fragments.length, ownerDbIds: [...ownerDbIds],
    subtreeDigest: (await digestSubtree(subtreeRecords(fragments))).digest };
}

/**
 * @param {object[]} modelSpecs
 * @param {{ ignoreCheckpoint?: boolean, driftOnCall?: number }} [opts]  ignoreCheckpoint: the non-cooperating
 *   enumerator of AC-7; driftOnCall: the Nth `resolveRoots` call of this enumerator (1-based, across all models)
 *   answers with every root's `subtreeDigest` changed, i.e. the model "changed during planning" (spec 6.2)
 * @returns {{ enumerator: object, binding: object, bindings: Map<string, object> }}
 *   `binding` is the first model's binding; `bindings` has one per model. The enumerator resolves the
 *   model from `binding.modelKey`, so one enumerator serves every model.
 */
export function makeSyntheticEnumerator(modelSpecs, { ignoreCheckpoint = false, driftOnCall = null } = {}) {
  const specs = new Map(modelSpecs.map((s) => [s.modelKey, clone(s)]));
  const bindings = new Map(modelSpecs.map((s) => [s.modelKey, makeSyntheticBinding(s.modelKey)]));
  const calls = [];
  let resolveRootsCalls = 0;

  const specOf = (binding) => {
    const spec = specs.get(binding?.modelKey);
    if (!spec) throw new Error(`synthetic enumerator: unknown model ${binding?.modelKey}`);
    return spec;
  };
  const rootsOf = (spec) => [...spec.roots].sort((a, b) => a.dbId - b.dbId);
  // The root that holds node `d` as a descendant, or null when `d` is not a nested node.
  const containerOf = (spec, d) => {
    const viaAncestor = spec.ancestorOf?.[d];
    if (viaAncestor !== undefined) return spec.roots.find((r) => r.dbId === viaAncestor) ?? null;
    return spec.roots.find((r) => r.dbId !== d && r.owners?.includes(d)) ?? null;
  };
  const isNode = (spec, d) => !(spec.missingDbIds ?? []).includes(d)
    && (spec.roots.some((r) => r.dbId === d) || spec.ancestorOf?.[d] !== undefined
        || spec.roots.some((r) => r.owners?.includes(d)) || (spec.emptyDbIds ?? []).includes(d));
  const nodeFragments = (spec, d) => {
    if ((spec.emptyDbIds ?? []).includes(d)) return [];
    const root = spec.roots.find((r) => r.dbId === d);
    if (root) return root.fragments;
    const holder = containerOf(spec, d);
    return holder ? holder.fragments.filter((f) => f.ownerDbId === d) : [];
  };

  /** The one root-resolution function both resolveRoots and digestScope use (explicit list). */
  async function resolveExplicit(spec, dbIds) {
    const listed = new Set(dbIds);
    const roots = [];
    const unresolved = [];
    for (const d of [...listed].sort(asc)) {
      if (!isNode(spec, d)) { unresolved.push({ dbId: d, reason: 'not-found' }); continue; }
      const ancestor = spec.ancestorOf?.[d];
      if (ancestor !== undefined && listed.has(ancestor)) continue; // antichain reduction: a listed ancestor wins
      const frags = nodeFragments(spec, d);
      if (frags.length === 0) { unresolved.push({ dbId: d, reason: 'no-fragments' }); continue; }
      const nested = spec.roots.find((r) => r.dbId === d) === undefined;
      roots.push(await rootRecord(d, frags, nested ? [d] : spec.roots.find((r) => r.dbId === d).owners));
    }
    return { roots, unresolved };
  }

  async function populationOf(spec) {
    const records = [];
    for (const r of spec.roots) for (const f of r.fragments) records.push({ fragId: f.fragId, cls: 'L', ownerDbId: f.ownerDbId, geometryId: f.geometryId });
    for (const u of spec.unreachable ?? []) records.push({ fragId: u.fragId, cls: u.cls ?? 'L', ownerDbId: u.ownerDbId, geometryId: u.geometryId });
    return digestPopulation({ count: records.length, records });
  }

  function unreachableOf(spec) {
    const list = spec.unreachable ?? [];
    const loaded = list.filter((u) => (u.cls ?? 'L') === 'L' && Number.isSafeInteger(u.ownerDbId));
    return {
      count: loaded.length,
      ownerDbIds: [...new Set(loaded.map((u) => u.ownerDbId))].sort(asc),
      unattributable: { notLoaded: list.filter((u) => u.cls === 'N').length, ownerUnresolvable: list.filter((u) => u.cls === 'U').length },
    };
  }

  // A drifted answer differs in every root's subtree digest and nothing else (a valid digest that no real
  // subtree can produce, so it never collides with an honest answer).
  const drifted = (answer) => ({ ...answer, roots: answer.roots.map((r) => ({ ...r, subtreeDigest: `sha256:${'d'.repeat(64)}` })) });

  async function run(kind, binding, scope, ctx) {
    calls.push({ index: calls.length, kind, modelKey: binding?.modelKey, scope: clone(scope) });
    if (kind === 'resolveRoots') resolveRootsCalls += 1;
    if (!ignoreCheckpoint && ctx) await ctx.checkpoint(); // once per model, awaited, before any answer
    const answer = await answerOf(kind, binding, scope);
    return kind === 'resolveRoots' && driftOnCall !== null && resolveRootsCalls === driftOnCall ? drifted(answer) : answer;
  }

  async function answerOf(kind, binding, scope) {
    const spec = specOf(binding);
    if (scope === 'whole') {
      if (kind === 'digestScope') {
        const p = await populationOf(spec);
        return { kind: 'population', count: p.count, digest: p.digest };
      }
      const p = await populationOf(spec);
      const roots = [];
      for (const r of rootsOf(spec)) roots.push(await rootRecord(r.dbId, r.fragments, r.owners));
      const mismatch = spec.ownerMismatchCount ?? 0;
      return {
        roots,
        population: { count: p.count, digest: p.digest },
        ownerMismatch: { count: mismatch, first20: Array.from({ length: Math.min(mismatch, 20) }, (_, i) => ({ fragId: i, treeOwner: 0, fragListOwner: 1 })) },
        unreachable: unreachableOf(spec),
        unresolved: [],
      };
    }
    const { roots, unresolved } = await resolveExplicit(spec, scope.dbIds);
    if (kind === 'digestScope') {
      return { kind: 'roots', roots: roots.map(({ dbId, fragmentCount, subtreeDigest }) => ({ dbId, fragmentCount, subtreeDigest })) };
    }
    return { roots, population: null, ownerMismatch: null, unreachable: null, unresolved };
  }

  return {
    binding: bindings.values().next().value,
    bindings,
    enumerator: {
      calls,
      resolveRoots: (binding, scope, ctx) => run('resolveRoots', binding, scope, ctx),
      digestScope: (binding, scope, ctx) => run('digestScope', binding, scope, ctx),
      /** Replace a model's content, simulating a change between planning and execution. */
      replaceModel(spec) { specs.set(spec.modelKey, clone(spec)); },
    },
  };
}

/**
 * The port-contract cases `checkEnumeratorConformance` runs against ONE model (`models[0]`): the
 * whole-model scope plus explicit lists that exercise antichain reduction, `not-found` and
 * `no-fragments`. Content-free by design; the Viewer adapter adds its own content cases later.
 */
export function conformanceCases() {
  const frag = (fragId, ownerDbId, geometryId = 1) => ({ fragId, ownerDbId, geometryId });
  return {
    models: [{
      modelKey: 'conf',
      roots: [
        { dbId: 10, owners: [10, 11], fragments: [frag(0, 10), frag(1, 11)] },
        { dbId: 20, owners: [20], fragments: [frag(2, 20)] },
        { dbId: 30, owners: [30], fragments: [frag(3, 30, 2)] },
      ],
      unreachable: [{ fragId: 4, cls: 'L', ownerDbId: 11, geometryId: 1 }, { fragId: 5, cls: 'N' }, { fragId: 6, cls: 'U' }],
      ancestorOf: { 11: 10 },
      missingDbIds: [777],
      emptyDbIds: [55],
    }],
    scopes: [
      { name: 'whole', scope: 'whole' },
      { name: 'roots', scope: { dbIds: [10, 30] } },
      { name: 'ancestor-and-descendant', scope: { dbIds: [10, 11] } },
      { name: 'nested-only', scope: { dbIds: [11] } },
      { name: 'not-found', scope: { dbIds: [20, 777] } },
      { name: 'no-fragments', scope: { dbIds: [20, 55] } },
    ],
  };
}

/**
 * The snapshot shape P1's `registry.snapshotBindings(keys)` returns: `{registryRevision, bindings}` with
 * `bindings` POSITIONAL (index i answers `modelKeys[i]`) and `null` = no live binding (never a `Map`, never a
 * `dead` flag). `source` is either one Binding (the fake resolves a model from `binding.modelKey` alone, so the
 * other keys get their own synthetic binding) or a `Map<modelKey, Binding|null>` (a key the map lacks, or maps to
 * `null`, is an unbound model: `null`).
 */
export function snapshotOf(source, modelKeys, { registryRevision = 1 } = {}) {
  const pick = (key) => {
    if (source instanceof Map) return source.get(key) ?? null;
    return source && source.modelKey === key ? source : makeSyntheticBinding(key);
  };
  return Object.freeze({ registryRevision, bindings: Object.freeze([...modelKeys].map(pick)) });
}

/**
 * A NORMALIZED, deep-frozen definition (what P2's `prepareDefinition` hands the planner) from role -> entries:
 * `defOf({ A: [{kind:'model', modelKey}], B: [{kind:'elements', modelKey, dbIds}] })`. Entries are normalized by
 * P2's own `normalizeDefinition` (ascending modelKey, one entry per model, model wins, dbIds ascending unique).
 * Any other key is a definition override (`mode`, `clearance`, ...).
 */
export function defOf({ A, B, mode = 'volume-overlap', ...overrides }) {
  const captured = makeDefinition({ selectionA: { entries: structuredClone(A) }, selectionB: { entries: structuredClone(B) }, mode, ...overrides });
  return deepFreezeDefinition(normalizeDefinition(captured));
}

/**
 * The same definition with every selection's entries and every dbId list in a seeded-random order. It is a
 * plain (unfrozen, non-normalized) copy, so it exercises "the plan does not depend on input order".
 * @param {object} definition
 * @param {() => number} rng returns a float in [0, 1)
 */
export function shuffleDefinition(definition, rng) {
  const shuffled = (list) => {
    const out = [...list];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };
  const side = (selection) => ({
    entries: shuffled(selection.entries.map((e) => (e.kind === 'elements' ? { ...e, dbIds: shuffled(e.dbIds) } : { ...e }))),
  });
  return { ...clone(definition), selectionA: side(definition.selectionA), selectionB: side(definition.selectionB) };
}

// ---------------------------------------------------------------------------------------------------------------
// Planning-layer fixtures (Task P3.7): a hand-built plan-table world plus one CellSpec, with no enumerator or
// definition in the way, so sizing tests state exactly the weights they care about.
// ---------------------------------------------------------------------------------------------------------------
import { buildRootTables } from '../../../clashtest/planning/planTables.js';
import { createRecordBudget } from '../../../clashtest/planning/ledger.js';

const generousBudget = () => createRecordBudget({ maxPlanReferences: 1e7, maxLedgerRecords: 3e7, maxUnitsPerRun: 1e5 });
const planRow = (dbId, fragmentCount) => ({ dbId, fragmentCount, ownerDbIds: [dbId], subtreeDigest: `sha256:${dbId}` });

/**
 * One explicit-root target's root weights: `rootWeights` (explicit), else one per `rootDbIds` entry, else `roots` roots,
 * of `weight` fragments each (`roots` defaults to 1, `weight` to 1).
 */
const targetRootWeights = (t) => t.rootWeights
  ?? Array.from({ length: t.rootDbIds?.length ?? t.roots ?? 1 }, () => t.weight ?? 1);

/**
 * The plan the sizer and the splitter read: buildRootTables' result (roots as `A'` for the source model and `B'`
 * for every target model) plus the per-model `models` map carrying the whole-model population count (spec 6.4
 * target weight of a sentinel). `sourceRoots` is a list of dbIds (weight 1 each) or use `sourceWeights`.
 */
export function makeTablePlan({ sourceModelKey = 'src', sourceWeights, sourceRoots, targets }) {
  const weights = sourceWeights ?? sourceRoots.map(() => 1);
  const ids = sourceRoots ? [...sourceRoots].sort(asc) : weights.map((_, i) => i + 1);
  const specs = [{ modelKey: sourceModelKey, classes: { "A'": ids.map((id, i) => planRow(id, weights[i])) } }];
  const populations = new Map([[sourceModelKey, weights.reduce((n, w) => n + w, 0)]]);
  for (const t of targets) {
    const rootWeights = targetRootWeights(t);
    const ids2 = t.rootDbIds ? [...t.rootDbIds].sort(asc) : rootWeights.map((_, i) => i + 1);
    specs.push({ modelKey: t.modelKey, classes: { "B'": ids2.map((id, i) => planRow(id, rootWeights[i])) } });
    populations.set(t.modelKey, t.population ?? rootWeights.reduce((n, w) => n + w, 0));
  }
  const built = buildRootTables({ models: specs, budget: generousBudget() });
  if (!built.ok) throw new Error(`makeTablePlan: ${built.cause}`);
  const models = new Map([...populations].map(([modelKey, count]) => [modelKey,
    { scopeDigests: { population: { count, digest: `sha256:pop-${modelKey}` }, roots: [] } }]));
  return { ...built, models };
}

/**
 * `makeSizingFixture({ sourceWeights: [fragmentCount per source root, ascending dbId], targets: [
 *   { modelKey, weight?, roots?, rootWeights?, whole?, population? } ] })` -> `{ cells, plan, expectedPairSpace }`.
 * One cell-1 spec: every target model in ascending modelKey order, `whole: true` naming the whole-model sentinel
 * (its population count defaults to the sum of its roots' fragment counts; `population` overrides it).
 */
export function makeSizingFixture({ sourceWeights, targets, cell = '1', sourceModelKey = 'src', orientationRole = 'A->B' }) {
  const plan = makeTablePlan({ sourceModelKey, sourceWeights, targets });
  const ordered = [...targets].sort((a, b) => (a.modelKey < b.modelKey ? -1 : a.modelKey > b.modelKey ? 1 : 0));
  const entries = ordered.map((t) => ({ modelKey: t.modelKey,
    scope: t.whole ? 'whole' : { ranges: [plan.rangeOfClass(t.modelKey, "B'")] } }));
  const cells = [{ cell, sourceModelKey, sourceRanges: [plan.rangeOfClass(sourceModelKey, "A'")], targets: entries, orientationRole }];
  const targetRoots = ordered.reduce((n, t) => n + targetRootWeights(t).length, 0);
  return { cells, plan, expectedPairSpace: sourceWeights.length * targetRoots };
}

// ---------------------------------------------------------------------------------------------------------------
// Task P3.8: a plan whose `plan.ledger` is the live, un-frozen coverage ledger `planSplit` admits through (R8), holding
// one planned unit `1.0` (the `unit` returned) plus optional filler unit records.
// ---------------------------------------------------------------------------------------------------------------
import { createLedger } from '../../../clashtest/planning/ledger.js';
import { RUN_OPTION_DEFAULTS } from '../../../clashtest/options.js';
import { rangeRecordCount, unitRecordFields, pairSpaceWeightOf, targetWeightOf } from '../../../clashtest/planning/sizing.js';

/**
 * `makeSplitFixture({ sourceRoots: [dbId], targets: [{modelKey, roots: [dbId]} | {modelKey, whole: true, roots?, weight?}],
 *   limits?, liveUnitRecords?, exhaustLedgerRecords? })` -> `{ plan, unit, ledger, budget, limits }`.
 *   limits                merged over RUN_OPTION_DEFAULTS before `createRecordBudget`
 *   liveUnitRecords       total unit records the ledger holds before the test (`unit` included), so the unit-record
 *                         cap is reachable without a real 10,000-unit plan
 *   exhaustLedgerRecords  true = drain `budget.discretionaryRemaining` and trip the exhaustion flag with one refused record
 *                         (so a before/after snapshot isolates what a split itself writes); 'silent' = drain only
 * Every root weighs 1 fragment; the source model is `src`. Unit records are charged to the budget as P3.9 does
 * (`unit-record` 1, `unit-range` per expanded id, erratum A14) and the overflow slots are reserved, as at the end of planning.
 */
export function makeSplitFixture({ sourceRoots, targets, limits = {}, liveUnitRecords = 1, exhaustLedgerRecords = false }) {
  const lim = { ...RUN_OPTION_DEFAULTS, ...limits };
  const tablePlan = makeTablePlan({ sourceRoots, targets: targets.map((t) => (t.whole
    ? { modelKey: t.modelKey, weight: t.weight ?? 1, rootDbIds: t.roots } : { modelKey: t.modelKey, rootDbIds: t.roots })) });
  const ordered = [...targets].sort((a, b) => (a.modelKey < b.modelKey ? -1 : a.modelKey > b.modelKey ? 1 : 0));
  const unitTargets = ordered.map((t) => ({ modelKey: t.modelKey,
    scope: t.whole ? 'whole' : { ranges: [tablePlan.rangeOfClass(t.modelKey, "B'")] } }));
  const sourceRanges = [tablePlan.rangeOfClass('src', "A'")];
  const unit = { unitId: '1.0', cell: '1', sourceModelKey: 'src', sourceRanges, targets: unitTargets, orientationRole: 'A->B',
    pairSpaceWeight: pairSpaceWeightOf(tablePlan, sourceRanges, unitTargets), targetWeight: targetWeightOf(tablePlan, unitTargets) };

  const budget = createRecordBudget(lim);
  const ledger = createLedger({ limits: lim, budget });
  const admitUnit = (u) => {
    if (!budget.admitPlan('unit-record', 1) || !budget.admitPlan('unit-range', rangeRecordCount(u))) throw new Error('fixture: plan budget too small');
  };
  admitUnit(unit);
  ledger.recordUnit(unitRecordFields(tablePlan, unit));
  for (let i = 1; i < liveUnitRecords; i++) {
    const filler = { ...unit, unitId: `filler.${i}` };
    admitUnit(filler);
    ledger.recordUnit(unitRecordFields(tablePlan, filler));
  }
  if (!budget.reserveUnitSlots()) throw new Error('fixture: the reserve does not fit');
  if (exhaustLedgerRecords) {
    budget.admitRuntime('element-taint', budget.discretionaryRemaining, 'fixture');
    if (exhaustLedgerRecords === true) budget.admitRuntime('element-taint', 1, 'fixture');   // the refusal that flags exhaustion
  }
  const plan = Object.freeze({ ...tablePlan, ledger });
  return { plan, unit, ledger, budget, limits: lim };
}
