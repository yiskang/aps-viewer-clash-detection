// clashtest/planning/ElementEnumerator.js
//
// The ElementEnumerator PORT (spec 6.2): the whole Viewer seam of the planner. This module holds the
// contract as JSDoc typedefs, two pure boundary validators, the planning-cause vocabulary and the
// conformance helper every implementation (the test fake, later the Viewer adapter) must pass.
// It imports only ../errors.js: no Viewer, no `three`, no collision/.

import { EnumerationCancelledError } from '../errors.js';

/**
 * @typedef {'whole' | { dbIds: number[] }} EnumerationScope
 *
 * @typedef {{ checkpoint(): void | Promise<void> }} EnumerationContext
 *   Supplied by the engine to both methods. The enumerator calls `checkpoint()` at least once per
 *   slice and AWAITS its result; it yields to the scheduler and throws `EnumerationCancelledError`
 *   (cancelled / lease dead / disposed), which the enumerator must propagate unwrapped (spec 6.2).
 *
 * @typedef {{ dbId: number, fragmentCount: number, ownerDbIds: number[], subtreeDigest: string }} RootRecord
 *   Ascending by `dbId`; `ownerDbIds` are the ascending, distinct fragment-owning dbIds of the
 *   root's subtree (the owner -> root map, spec 5.6.4).
 *
 * @typedef {{
 *   roots: RootRecord[],
 *   population: { count: number, digest: string } | null,
 *   ownerMismatch: { count: number, first20: Array<{ fragId: number, treeOwner: number, fragListOwner: number }> } | null,
 *   unreachable: { count: number, ownerDbIds: number[], unattributable: { notLoaded: number, ownerUnresolvable: number } } | null,
 *   unresolved: Array<{ dbId: number, reason: 'not-found' | 'no-fragments' }>,
 * }} ResolveRootsResult
 *   `population` / `ownerMismatch` / `unreachable` exist for scope 'whole' only (null for explicit
 *   lists); `unresolved` for explicit lists only (always [] for 'whole').
 *
 * @typedef {{ kind: 'population', count: number, digest: string }
 *   | { kind: 'roots', roots: Array<{ dbId: number, fragmentCount: number, subtreeDigest: string }> }} DigestScopeResult
 *
 * @typedef {object} ElementEnumerator
 * @property {(binding: object, scope: EnumerationScope, ctx: EnumerationContext) => Promise<ResolveRootsResult>} resolveRoots
 * @property {(binding: object, scope: EnumerationScope, ctx: EnumerationContext) => Promise<DigestScopeResult>} digestScope
 *   Re-reads the LIVE model now, with exactly the function resolveRoots used at planning; never cached.
 */

/** The whole-model scope sentinel used in port calls. */
export const ENUMERATION_SCOPE_WHOLE = 'whole';

/** The exhaustive planning-cause enum of spec 6.6 item 2. */
export const PLANNING_CAUSES = Object.freeze([
  'test-unavailable', 'definition-invalid', 'schema-unsupported', 'migration-failed',
  'model-not-bound', 'enumeration-failed', 'element-unresolvable', 'owner-mapping-mismatch',
  'hierarchy-overlap', 'plan-too-large', 'cancelled', 'world-disposed',
]);

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/; // the durable digest format (spec 5.4); scopeDigest.js owns producing it
const isWhole = (scope) => scope === ENUMERATION_SCOPE_WHOLE;
const isSafeNonNegInt = (n) => Number.isSafeInteger(n) && n >= 0;
const isDigest = (d) => typeof d === 'string' && DIGEST_PATTERN.test(d);
const isObject = (v) => v !== null && typeof v === 'object';

/** Strictly ascending safe-integer dbIds. Adds at most one issue for the whole list. */
function checkAscendingDbIds(list, path, add) {
  let prev = -1;
  for (const o of list) {
    if (!isSafeNonNegInt(o)) { add(path, 'not-a-dbid'); return; }
    if (o <= prev) { add(path, 'owners-not-ascending'); return; }
    prev = o;
  }
}

/**
 * Pure boundary validation of one `resolveRoots` answer: shape, strict ascending order (which also
 * rules out duplicate roots and owners) and the whole-only / explicit-only field rules.
 * @param {unknown} result
 * @param {{ scope: EnumerationScope }} opts
 * @returns {{ ok: boolean, issues: Array<{ path: string, code: string }> }}
 */
export function validateResolveRootsResult(result, { scope }) {
  const issues = [];
  const add = (path, code) => { issues.push({ path, code }); };
  if (!isObject(result) || Array.isArray(result)) { add('/', 'not-an-object'); return { ok: false, issues }; }
  if (!Array.isArray(result.roots)) add('/roots', 'not-an-array');
  else {
    let prev = -1;
    let unordered = false; // report the ordering defect once, not once per following root
    for (let i = 0; i < result.roots.length; i++) {
      const r = result.roots[i];
      if (!isObject(r)) { add(`/roots/${i}`, 'not-an-object'); continue; }
      if (!isSafeNonNegInt(r.dbId)) add(`/roots/${i}/dbId`, 'not-a-dbid');
      else if (r.dbId <= prev) { if (!unordered) add('/roots', 'roots-not-ascending'); unordered = true; }
      else prev = r.dbId;
      if (!isSafeNonNegInt(r.fragmentCount)) add(`/roots/${i}/fragmentCount`, 'not-a-count');
      if (!isDigest(r.subtreeDigest)) add(`/roots/${i}/subtreeDigest`, 'not-a-digest');
      if (!Array.isArray(r.ownerDbIds)) add(`/roots/${i}/ownerDbIds`, 'not-an-array');
      else checkAscendingDbIds(r.ownerDbIds, `/roots/${i}/ownerDbIds`, add);
    }
  }
  if (isWhole(scope)) {
    if (!isObject(result.population)) add('/population', 'population-required');
    else {
      if (!isSafeNonNegInt(result.population.count)) add('/population/count', 'not-a-count');
      if (!isDigest(result.population.digest)) add('/population/digest', 'not-a-digest');
    }
    if (!isObject(result.ownerMismatch)) add('/ownerMismatch', 'required');
    else {
      if (!isSafeNonNegInt(result.ownerMismatch.count)) add('/ownerMismatch/count', 'not-a-count');
      if (!Array.isArray(result.ownerMismatch.first20) || result.ownerMismatch.first20.length > 20
          || (isSafeNonNegInt(result.ownerMismatch.count) && result.ownerMismatch.first20.length > result.ownerMismatch.count))
        add('/ownerMismatch/first20', 'malformed');
    }
    if (!isObject(result.unreachable)) add('/unreachable', 'required');
    else {
      const u = result.unreachable;
      if (!isSafeNonNegInt(u.count)) add('/unreachable/count', 'not-a-count');
      if (!Array.isArray(u.ownerDbIds)) add('/unreachable/ownerDbIds', 'not-an-array');
      else {
        checkAscendingDbIds(u.ownerDbIds, '/unreachable/ownerDbIds', add);
        // Every attributed unreachable owner holds at least one counted fragment: owners without a count is a
        // self-contradicting answer that would otherwise read as "nothing unreachable" downstream.
        if (isSafeNonNegInt(u.count) && u.ownerDbIds.length > u.count) add('/unreachable/ownerDbIds', 'owners-exceed-count');
      }
      if (!isObject(u.unattributable) || !isSafeNonNegInt(u.unattributable.notLoaded)
          || !isSafeNonNegInt(u.unattributable.ownerUnresolvable))
        add('/unreachable/unattributable', 'malformed');
    }
    if (!Array.isArray(result.unresolved) || result.unresolved.length !== 0)
      add('/unresolved', 'unresolved-forbidden');
  } else {
    if (result.population !== null) add('/population', 'population-forbidden');
    if (result.ownerMismatch !== null) add('/ownerMismatch', 'owner-mismatch-forbidden');
    if (result.unreachable !== null) add('/unreachable', 'unreachable-forbidden');
    if (!Array.isArray(result.unresolved)) add('/unresolved', 'not-an-array');
    else for (let i = 0; i < result.unresolved.length; i++) {
      const u = result.unresolved[i];
      if (!isObject(u) || !isSafeNonNegInt(u.dbId)) add(`/unresolved/${i}/dbId`, 'not-a-dbid');
      if (!isObject(u) || (u.reason !== 'not-found' && u.reason !== 'no-fragments'))
        add(`/unresolved/${i}/reason`, 'unknown-reason');
    }
    // An explicit answer is about the requested dbIds and nothing else: a root or unresolved id that was never
    // asked for, or one id reported both resolved and unresolved, plans the wrong element set (false-clean).
    if (isObject(scope) && Array.isArray(scope.dbIds) && Array.isArray(result.roots) && Array.isArray(result.unresolved)) {
      const requested = new Set(scope.dbIds);
      const resolved = new Set();
      for (let i = 0; i < result.roots.length; i++) {
        const id = result.roots[i]?.dbId;
        if (!isSafeNonNegInt(id)) continue;   // already reported as not-a-dbid
        if (!requested.has(id)) add(`/roots/${i}/dbId`, 'root-not-requested');
        resolved.add(id);
      }
      for (let i = 0; i < result.unresolved.length; i++) {
        const id = result.unresolved[i]?.dbId;
        if (!isSafeNonNegInt(id)) continue;
        if (!requested.has(id)) add(`/unresolved/${i}/dbId`, 'unresolved-not-requested');
        else if (resolved.has(id)) add(`/unresolved/${i}/dbId`, 'resolved-and-unresolved');
      }
    }
  }
  return { ok: issues.length === 0, issues };
}

/**
 * Pure boundary validation of one `digestScope` answer against the scope it was asked for
 * (`{kind:'population', count, digest}` for 'whole'; `{kind:'roots', roots}` ascending by dbId for an
 * explicit list). Extra fields (e.g. `digestVersion`) are tolerated.
 * @param {unknown} result
 * @param {{ scope: EnumerationScope }} opts
 * @returns {{ ok: boolean, issues: Array<{ path: string, code: string }> }}
 */
export function validateDigestScopeResult(result, { scope }) {
  const issues = [];
  const add = (path, code) => { issues.push({ path, code }); };
  if (!isObject(result) || Array.isArray(result)) { add('/', 'not-an-object'); return { ok: false, issues }; }
  if (isWhole(scope)) {
    if (result.kind !== 'population') add('/kind', 'kind-mismatch');
    else {
      if (!isSafeNonNegInt(result.count)) add('/count', 'not-a-count');
      if (!isDigest(result.digest)) add('/digest', 'not-a-digest');
    }
  } else if (result.kind !== 'roots') add('/kind', 'kind-mismatch');
  else if (!Array.isArray(result.roots)) add('/roots', 'not-an-array');
  else {
    let prev = -1;
    let unordered = false;
    for (let i = 0; i < result.roots.length; i++) {
      const r = result.roots[i];
      if (!isObject(r)) { add(`/roots/${i}`, 'not-an-object'); continue; }
      if (!isSafeNonNegInt(r.dbId)) add(`/roots/${i}/dbId`, 'not-a-dbid');
      else if (r.dbId <= prev) { if (!unordered) add('/roots', 'roots-not-ascending'); unordered = true; }
      else prev = r.dbId;
      if (!isSafeNonNegInt(r.fragmentCount)) add(`/roots/${i}/fragmentCount`, 'not-a-count');
      if (!isDigest(r.subtreeDigest)) add(`/roots/${i}/subtreeDigest`, 'not-a-digest');
    }
  }
  return { ok: issues.length === 0, issues };
}

const describeIssues = (v) => v.issues.map((i) => `${i.path}:${i.code}`).join(',');
const nameOf = (e) => (e && e.name) || typeof e;

/**
 * The conformance suite every ElementEnumerator implementation must pass. It asserts the PORT
 * contract only (shape, stability, digestScope agreement, checkpoint cooperation and unwrapped
 * cancellation), never a particular model's content. A defect is REPORTED as a failure string, never
 * thrown, so one broken case cannot hide the others.
 *
 * @param {object} args
 * @param {ElementEnumerator} args.enumerator
 * @param {object} args.binding    a binding the enumerator accepts (only read by the enumerator itself)
 * @param {{ scopes: Array<{ name: string, scope: EnumerationScope }> }} args.cases
 * @param {() => (void | Promise<void>)} [args.checkpoint]  optional hook run (and awaited by the
 *   enumerator) inside every counted checkpoint, e.g. to yield to a scheduler
 * @returns {Promise<{ failures: string[] }>}
 */
export async function checkEnumeratorConformance({ enumerator, binding, cases, checkpoint }) {
  const failures = [];
  const fail = (m) => { failures.push(m); };
  if (!enumerator || typeof enumerator.resolveRoots !== 'function' || typeof enumerator.digestScope !== 'function') {
    fail('enumerator must implement resolveRoots and digestScope');
    return { failures };
  }
  if (!cases || !Array.isArray(cases.scopes)) { fail('cases.scopes must be an array'); return { failures }; }
  const quietCtx = { checkpoint() {} };
  // Run one port call, turning a throw into a failure string (the helper itself never throws).
  const call = async (method, name, scope, ctx) => {
    try { return { ok: true, value: await enumerator[method](binding, scope, ctx) }; }
    catch (e) { fail(`${method}(${name}) threw ${nameOf(e)}`); return { ok: false }; }
  };

  for (const c of cases.scopes) {
    let checkpoints = 0;
    const ctx = { checkpoint() { checkpoints++; return checkpoint ? checkpoint() : undefined; } };
    const first = await call('resolveRoots', c.name, c.scope, ctx);
    if (!first.ok) continue;
    const res = first.value;
    const v = validateResolveRootsResult(res, { scope: c.scope });
    if (!v.ok) fail(`resolveRoots(${c.name}) shape: ${describeIssues(v)}`);
    if (checkpoints < 1) fail(`resolveRoots(${c.name}) did not call ctx.checkpoint() at least once per slice`);
    if (v.ok && !isWhole(c.scope)) {
      const asked = new Set(c.scope.dbIds);
      if (res.roots.some((r) => !asked.has(r.dbId))) fail(`resolveRoots(${c.name}) returned a root that was not requested`);
      const rootIds = new Set(res.roots.map((r) => r.dbId));
      if (res.unresolved.some((u) => !asked.has(u.dbId) || rootIds.has(u.dbId)))
        fail(`resolveRoots(${c.name}) unresolved lists an unrequested dbId or one that also resolved`);
    }

    // C1 stability: two calls with no intervening mutation must be deeply equal.
    const again = await call('resolveRoots', c.name, c.scope, quietCtx);
    if (again.ok && JSON.stringify(again.value) !== JSON.stringify(res))
      fail(`resolveRoots(${c.name}) is not stable across calls`);

    // C2 digestScope agrees with resolveRoots for the same scope: same function, no cache.
    const dig = await call('digestScope', c.name, c.scope, quietCtx);
    if (dig.ok) {
      const d = dig.value;
      const dv = validateDigestScopeResult(d, { scope: c.scope });
      if (!dv.ok) fail(`digestScope(${c.name}) shape: ${describeIssues(dv)}`);
      else if (v.ok) {
        if (isWhole(c.scope)) {
          if (d.digest !== res.population.digest || d.count !== res.population.count)
            fail(`digestScope(${c.name}) disagrees with resolveRoots population`);
        } else {
          const project = (r) => [r.dbId, r.fragmentCount, r.subtreeDigest];
          if (JSON.stringify(d.roots.map(project)) !== JSON.stringify(res.roots.map(project))) {
            const byDbId = new Map(res.roots.map((r) => [r.dbId, r.subtreeDigest]));
            for (const r of d.roots) if (byDbId.get(r.dbId) !== r.subtreeDigest)
              fail(`digestScope(${c.name}) subtreeDigest differs for root ${r.dbId}`);
            fail(`digestScope(${c.name}) roots differ from resolveRoots roots`);
          }
        }
      }
    }

    // C3 cancellation propagates unwrapped from BOTH methods, whether checkpoint() throws
    // synchronously or rejects (spec 6.2: the enumerator awaits the result of checkpoint()).
    for (const method of ['resolveRoots', 'digestScope']) {
      for (const [how, makeCtx] of [
        ['sync throw', (boom) => ({ checkpoint() { throw boom; } })],
        ['async rejection', (boom) => ({ checkpoint: async () => { throw boom; } })],
      ]) {
        const boom = new EnumerationCancelledError({ reason: 'cancelled' });
        let propagated = false;
        try { await enumerator[method](binding, c.scope, makeCtx(boom)); }
        catch (e) { propagated = e === boom; }
        if (!propagated) fail(`${method}(${c.name}) swallowed EnumerationCancelledError from checkpoint (${how}; not propagated unwrapped)`);
      }
    }
  }
  return { failures };
}
