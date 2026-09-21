// clashtest/planning/rootResolution.js
//
// Planning stage 1 (spec 6.2, 5.6, 6.6; Task P3.5): for every model a definition names, ask the ElementEnumerator
// port for the roots of selection A, selection B and their union, prove the three answers agree, apply the
// plan-time rules (owner-mapping mismatch, unresolved selections, the cross-role hierarchy-overlap rule F16) and
// produce, per model, the three root classes A' = RA \ RB, C = RA n RB, B' = RB \ RA -- each root carrying its
// durable class marker `cls` (ruling R2 / D9, assigned HERE, once) -- plus the declared exclusions the coverage
// ledger records (unresolved selections, tree-unreachable population, hierarchy-internal candidates).
//
// Pure planning over the port: no Viewer, no registry (the run-start leases arrive as the already-taken
// `snapshot`), no wall-clock. A failure is a returned `{ok: false, cause}` (a spec 6.6.2 planning cause) with a
// run-scoped `detail`; anything the enumerator THROWS (EnumerationCancelledError, ObjectTreeUnavailableError, ...)
// propagates unwrapped, for the run layer to map (spec 6.2).

import { ENUMERATION_SCOPE_WHOLE, validateResolveRootsResult } from './ElementEnumerator.js';
import { classifyOwners } from './owners.js';
import { ROOT_CLASS } from './ledger.js';
import {
  assertRootAntichainSliced, checkCrossRoleNestingSliced, hierarchyInternalCandidatesSliced,
} from '../definition/normalize.js';

// Spec 6.5.1 / 6.6 bounds on what a failure or a row carries. They are bounds on the RECORDED detail, never on
// what is checked.
const MAX_OFFENDERS = 20;
const MAX_EXAMPLE_OWNERS = 8;
// Spec 17.3: a checkpoint at least every 64 items of an engine-controlled span (the slicer's own cadence).
const CHECK_EVERY = 64;

const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const ascending = (a, b) => a - b;

const fail = (cause, detail) => ({ ok: false, cause, detail });
const enumerationFailed = (modelKey, code, extra = {}) => fail('enumeration-failed', { modelKey, code, ...extra });

const isStrictlyAscending = (list) => {
  for (let i = 1; i < list.length; i++) if (list[i] <= list[i - 1]) return false;
  return true;
};

/** Ascending-unique copy of an id list (a normalized definition already is; anything else is repaired, never trusted). */
const ascendingUnique = (list) => (isStrictlyAscending(list) ? list : [...new Set(list)].sort(ascending));

/** Union of two ascending-unique id lists, ascending-unique. */
function mergeAscending(a, b) {
  const out = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    const next = j >= b.length || (i < a.length && a[i] <= b[j]) ? a[i++] : b[j++];
    if (out.length === 0 || out[out.length - 1] !== next) out.push(next);
  }
  return out;
}

const sameList = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const sameScope = (a, b) => (a === ENUMERATION_SCOPE_WHOLE || b === ENUMERATION_SCOPE_WHOLE ? a === b : sameList(a.dbIds, b.dbIds));
const sameRoot = (a, b) => a.fragmentCount === b.fragmentCount && a.subtreeDigest === b.subtreeDigest && sameList(a.ownerDbIds, b.ownerDbIds);

const samePopulation = (a, b) => a.count === b.count && a.digest === b.digest;
const sameUnreachable = (a, b) => a.count === b.count && sameList(a.ownerDbIds, b.ownerDbIds)
  && a.unattributable.notLoaded === b.unattributable.notLoaded
  && a.unattributable.ownerUnresolvable === b.unattributable.ownerUnresolvable;

/**
 * @param {object} args
 * @param {object} args.definition  the NORMALIZED definition (P2 prepareDefinition): entries ascending by modelKey,
 *   one entry per model, `dbIds` ascending. Nothing is re-derived from it except the model-key union.
 * @param {{bindings: ReadonlyArray<object|null>}} args.snapshot  P1 `snapshotBindings(keys)`: POSITIONAL, index i
 *   answers the i-th key of the ascending union of the definition's model keys; `null` = no live binding.
 * @param {object} args.enumerator  the ElementEnumerator port
 * @param {() => (void | Promise<void>)} args.checkpoint  the planning checkpoint; awaited between models and inside the P2 rules
 * @param {object} [args.budget]  the run's RecordBudget: when given, every row this stage records is admitted
 *   through it BEFORE it is built (spec 6.5.1), and a refusal fails planning `plan-too-large`
 * @returns {Promise<{
 *   ok: true, models: Map<string, object>, unresolvedSelections: object[], unreachablePopulation: object[],
 *   libraryExclusions: string[], hierarchyInternal: object[],
 * } | { ok: false, cause: string, detail?: object, overflowClass?: string }>}
 */
export async function resolveSelectionRoots({ definition, snapshot, enumerator, checkpoint, budget = null }) {
  if (typeof checkpoint !== 'function') throw new TypeError('resolveSelectionRoots: checkpoint must be a function');
  const tick = () => checkpoint();
  const ctx = Object.freeze({ checkpoint: tick });

  const entriesOf = (selection) => new Map(selection.entries.map((e) => [e.modelKey, e]));
  const entriesA = entriesOf(definition.selectionA);
  const entriesB = entriesOf(definition.selectionB);
  const modelKeys = [...new Set([...entriesA.keys(), ...entriesB.keys()])].sort(byCodeUnit);

  // Spec 6.6.2 model-not-bound: a null lease fails planning before ANY enumeration. The snapshot is positional, so
  // a snapshot that does not line up with the key list is a caller defect, never something to guess around.
  const bindings = snapshot?.bindings;
  if (!Array.isArray(bindings) || bindings.length !== modelKeys.length) {
    throw new TypeError('resolveSelectionRoots: snapshot.bindings must be positional over the definition\'s ascending model keys');
  }
  const unbound = [];
  modelKeys.forEach((key, i) => {
    const b = bindings[i];
    if (b === null) unbound.push(key);
    else if (b?.modelKey !== key) throw new TypeError(`resolveSelectionRoots: snapshot.bindings[${i}] is not the binding of ${key}`);
  });
  if (unbound.length > 0) return fail('model-not-bound', { modelKeys: unbound });

  // Runs `visit` over a list with a checkpoint at least every CHECK_EVERY items.
  const walk = async (list, visit) => {
    for (let i = 0; i < list.length; i++) {
      visit(list[i], i);
      if ((i + 1) % CHECK_EVERY === 0) await checkpoint();
    }
  };
  const tooLarge = () => ({ ok: false, cause: 'plan-too-large', overflowClass: budget.planOverflowClass });

  const models = new Map();
  const unresolvedSelections = [];
  const unreachablePopulation = [];
  const hierarchyInternal = [];

  for (let mi = 0; mi < modelKeys.length; mi++) {
    const modelKey = modelKeys[mi];
    const binding = bindings[mi];
    await checkpoint();

    const entryA = entriesA.get(modelKey) ?? null;
    const entryB = entriesB.get(modelKey) ?? null;
    const scopeOf = (entry) => (entry === null ? null : entry.kind === 'model' ? ENUMERATION_SCOPE_WHOLE : { dbIds: ascendingUnique(entry.dbIds) });
    const scopeA = scopeOf(entryA);
    const scopeB = scopeOf(entryB);
    // scopeU = whole if either role is whole, else the ascending-unique merge of the two explicit lists.
    const scopeU = scopeA === ENUMERATION_SCOPE_WHOLE || scopeB === ENUMERATION_SCOPE_WHOLE ? ENUMERATION_SCOPE_WHOLE
      : { dbIds: mergeAscending(scopeA?.dbIds ?? [], scopeB?.dbIds ?? []) };

    // 1. The three answers (A, B where named, and the union), each validated at the port boundary. Sequential: the
    //    enumerator awaits, so the answers can differ if the model changes mid-planning -- that is what step 2 catches.
    const answers = [];
    for (const [label, scope] of [['A', scopeA], ['B', scopeB], ['union', scopeU]]) {
      if (scope === null) { answers.push(null); continue; }
      const answer = await enumerator.resolveRoots(binding, scope, ctx);
      const verdict = validateResolveRootsResult(answer, { scope });
      if (!verdict.ok) return enumerationFailed(modelKey, 'invalid-answer', { scope: label, issues: verdict.issues.slice(0, MAX_OFFENDERS) });
      answers.push(answer);
    }
    const [answerA, answerB, answerU] = answers;
    const roleAnswers = [['A', answerA], ['B', answerB]].filter(([, a]) => a !== null);

    // 2. Agreement (spec 6.2): every root shared by two answers is the same root, and the population (and the
    //    unreachable record) is the same wherever two answers report one. Otherwise the model changed during planning.
    let disagreement = null;
    const compare = (x, y, identicalScope) => {
      if (disagreement !== null) return;
      // Two answers to the SAME scope have the same roots, not merely equal shared roots: otherwise a model that
      // changed mid-planning would surface as a cross-role nesting below (or pass it), instead of enumeration-failed.
      if (identicalScope && !sameList(x.roots.map((r) => r.dbId), y.roots.map((r) => r.dbId))) { disagreement = { code: 'root-set-disagreement' }; return; }
      const byId = new Map(y.roots.map((r) => [r.dbId, r]));
      for (const r of x.roots) {
        const other = byId.get(r.dbId);
        if (other !== undefined && !sameRoot(r, other)) { disagreement = { code: 'root-disagreement', dbId: r.dbId }; return; }
      }
      if (x.population && y.population && !samePopulation(x.population, y.population)) disagreement = { code: 'population-disagreement' };
      else if (x.unreachable && y.unreachable && !sameUnreachable(x.unreachable, y.unreachable)) disagreement = { code: 'unreachable-disagreement' };
    };
    if (answerA !== null) { compare(answerA, answerU, sameScope(scopeA, scopeU)); await checkpoint(); }
    if (answerB !== null) { compare(answerB, answerU, sameScope(scopeB, scopeU)); await checkpoint(); }
    if (answerA !== null && answerB !== null) compare(answerA, answerB, sameScope(scopeA, scopeB));
    if (disagreement !== null) return enumerationFailed(modelKey, disagreement.code, disagreement.dbId === undefined ? {} : { dbId: disagreement.dbId });

    // The roots each answer returns must be a subtree-disjoint antichain; a violation is an enumerator defect (spec 5.6.2).
    for (const a of answers) {
      if (a === null) continue;
      const antichain = await assertRootAntichainSliced(a.roots, { tick });
      if (!antichain.ok) return enumerationFailed(modelKey, 'roots-not-an-antichain', { violations: antichain.violations.slice(0, MAX_OFFENDERS) });
    }

    // 3. ownerMismatch > 0 on any whole-scope answer fails planning closed (spec 6.2).
    for (const a of answers) {
      if (a !== null && a.ownerMismatch !== null && a.ownerMismatch.count > 0) {
        return fail('owner-mapping-mismatch', { modelKey, count: a.ownerMismatch.count, first20: a.ownerMismatch.first20.slice(0, MAX_OFFENDERS) });
      }
    }

    // 4. Unresolved explicit dbIds: `not-found` fails planning; `no-fragments` is a claim-blocking record.
    const notFound = [];
    const softRows = [];
    for (const [role, a] of roleAnswers) {
      const noFragments = [];
      for (const u of a.unresolved) {
        if (u.reason === 'not-found') notFound.push({ selectionRole: role, modelKey, dbId: u.dbId });
        else noFragments.push(u.dbId);
      }
      // P5's pinned `UnresolvedSelection.dbIds` is `dbId[] unique`. validateResolveRootsResult already refuses a repeated or
      // misordered `unresolved` list (H4), so this is a defensive canonicalization: the row never carries a duplicate.
      if (noFragments.length > 0) softRows.push({ selectionRole: role, modelKey, cause: 'no-fragments', dbIds: ascendingUnique(noFragments) });
    }
    if (notFound.length > 0) {
      notFound.sort((x, y) => byCodeUnit(x.selectionRole, y.selectionRole) || x.dbId - y.dbId);
      return fail('element-unresolvable', { offenders: notFound.slice(0, MAX_OFFENDERS) });
    }

    // 5. Hierarchy overlap (F16, spec 5.6.5): supported iff RU = RA u RB as dbId sets. P2 supplies the rule input
    //    (the first 20 {ancestor, descendant} offenders); the consequence -- failing planning before any unit exists -- is ours.
    const rootsA = answerA?.roots ?? [];
    const rootsB = answerB?.roots ?? [];
    const nesting = await checkCrossRoleNestingSliced({ rootsA, rootsB, rootsUnion: answerU.roots }, { tick });
    if (!nesting.supported) {
      const offenders = nesting.offenders.slice(0, MAX_OFFENDERS);
      // A union that names a root neither role has, or a dropped root no union root contains, is not nesting: the enumerator is inconsistent.
      if (nesting.enumeratorInconsistent || offenders.some((o) => o.ancestor === null)) {
        return enumerationFailed(modelKey, 'root-union-inconsistent', { offenders });
      }
      return fail('hierarchy-overlap', { modelKey, offenders });
    }

    // 6. Classes, from the RU answer's row objects so every class shares one digest/owner source. `cls` is assigned here, once.
    const idsA = new Set(rootsA.map((r) => r.dbId));
    const idsB = new Set(rootsB.map((r) => r.dbId));
    const classes = { "A'": [], C: [], "B'": [] };
    const rootOwners = [];
    const scopeRoots = [];
    await walk(answerU.roots, (r) => {
      const inA = idsA.has(r.dbId);
      const inB = idsB.has(r.dbId);
      const [key, cls] = inA && inB ? ['C', ROOT_CLASS.BOTH] : inA ? ["A'", ROOT_CLASS.A_ONLY] : ["B'", ROOT_CLASS.B_ONLY];
      classes[key].push({ dbId: r.dbId, fragmentCount: r.fragmentCount, ownerDbIds: r.ownerDbIds, subtreeDigest: r.subtreeDigest, cls });
      rootOwners.push({ rootDbId: r.dbId, ownerDbIds: r.ownerDbIds, cls });
      scopeRoots.push({ dbId: r.dbId, subtreeDigest: r.subtreeDigest });
    });

    // 7. Declared exclusions, from the whole-scope union answer only: the tree-unreachable population and the owner
    //    classes over it (spec 6.2, H1). Orientation-independent: nothing here reads a role.
    let unreachable = null;
    if (scopeU === ENUMERATION_SCOPE_WHOLE) {
      const u = answerU.unreachable;
      if (u.count > 0 || u.unattributable.notLoaded > 0 || u.unattributable.ownerUnresolvable > 0) {
        const { mixedOwnerDbIds } = classifyOwners({
          rootOwnerDbIds: answerU.roots.flatMap((r) => r.ownerDbIds), unreachableOwnerDbIds: u.ownerDbIds,
        });
        unreachable = {
          modelKey, count: u.count, ownerDbIds: [...u.ownerDbIds], mixedOwnerDbIds,
          unattributable: { notLoaded: u.unattributable.notLoaded, ownerUnresolvable: u.unattributable.ownerUnresolvable },
        };
      }
    }

    // 8. Hierarchy-internal candidates (spec 5.6.3, 6.6 item 3): P2's rule input, our row (D4): exact counts,
    //    bounded examples. Only roots in A n B with >= 2 fragment owners qualify.
    const candidates = await hierarchyInternalCandidatesSliced({ rootsA, rootsB }, { tick });
    let internalRow = null;
    if (candidates.length > 0) {
      const ownersOf = new Map(answerU.roots.map((r) => [r.dbId, r.ownerDbIds]));
      internalRow = {
        modelKey,
        rootCount: candidates.length,
        ownerCount: candidates.reduce((n, c) => n + c.ownerCount, 0),
        examples: candidates.slice(0, MAX_OFFENDERS).map((c) => ({ rootDbId: c.dbId, ownerDbIds: ownersOf.get(c.dbId).slice(0, MAX_EXAMPLE_OWNERS) })),
      };
    }

    // 9. Every row this model adds is admitted through the budget before it is recorded (spec 6.5.1).
    const population = answerU.population === null ? null : { count: answerU.population.count, digest: answerU.population.digest };
    const admitted = budget === null || budget.admitPlanBlock([
      ['scope-digest', (population === null ? 0 : 1) + scopeRoots.length],
      ['unresolved-selection', softRows.reduce((n, r) => n + 1 + r.dbIds.length, 0)],
      ['unreachable-population', unreachable === null ? 0 : 1 + unreachable.ownerDbIds.length + unreachable.mixedOwnerDbIds.length],
      ['hierarchy-internal', internalRow === null ? 0 : 1 + internalRow.examples.length],
    ]);
    if (!admitted) return tooLarge();

    unresolvedSelections.push(...softRows);
    if (unreachable !== null) unreachablePopulation.push(unreachable);
    if (internalRow !== null) hierarchyInternal.push(internalRow);
    models.set(modelKey, {
      classes,
      // The selection kind per role; null where the role does not name the model (spec 6.2 residual limit).
      scopeKinds: { A: entryA?.kind ?? null, B: entryB?.kind ?? null },
      wholeA: entryA?.kind === 'model',
      wholeB: entryB?.kind === 'model',
      scopeDigests: { population, roots: scopeRoots },
      rootOwners,
      unreachable,
    });
  }

  return {
    ok: true,
    models,
    unresolvedSelections,
    unreachablePopulation,
    // spec 6.6 item 3: `hierarchy-internal` iff the table is non-empty; canonical (code-unit) order.
    libraryExclusions: [...(hierarchyInternal.length > 0 ? ['hierarchy-internal'] : []), ...(unreachablePopulation.length > 0 ? ['tree-unreachable-population'] : [])],
    hierarchyInternal,
  };
}
