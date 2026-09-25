// clashtest/viewer/ViewerElementEnumerator.js
// The production ElementEnumerator over a Viewer Model (spec 6.2). Stateless: every call re-reads the LIVE model
// (spec 6.2 "never cached"). Digests are produced by the CORE's own producers so bytes equal what the planner folds.
import { digestPopulation, digestSubtree } from '../planning/scopeDigest.js';
import { createSlicer } from '../util/slicer.js';
import { CHECK_EVERY, checkpointNow } from './checkpoint.js';
import { EnumerationInconsistencyError } from './errors.js';
import { awaitObjectTree } from './readiness.js';
import { indexNodeParents, walkSubtree, hasListedAncestor } from './treeWalk.js';
import { scanPopulation } from './populationScan.js';

const asc = (a, b) => a - b;
const uniqueAscending = (ids) => [...new Set(ids)].sort(asc);

/** A P0 slicer whose yield IS the engine's checkpoint: every CHECK_EVERY items the engine validates liveness/cancellation. */
const digestSlicer = (ctx) => createSlicer({ yieldToScheduler: () => ctx.checkpoint(), maxItemsPerSlice: CHECK_EVERY });

async function subtreeRecords(owners, fragList, ctx) {
  const rows = [];
  let i = 0;
  for (const [fragId, ownerDbId] of owners) {
    rows.push({ fragId, ownerDbId, geometryId: fragList.getGeometryId(fragId) });
    if (++i % CHECK_EVERY === 0) { const p = checkpointNow(ctx); if (p) await p; }
  }
  return rows;
}

async function rootRecord(dbId, owners, fragList, ctx) {
  const { digest } = await digestSubtree(await subtreeRecords(owners, fragList, ctx), { slicer: digestSlicer(ctx) });
  return { dbId, fragmentCount: owners.size, ownerDbIds: [...new Set(owners.values())].sort(asc), subtreeDigest: digest };
}

function claimFragments(claimed, owners, rootDbId) {
  for (const fragId of owners.keys()) {
    const prior = claimed.get(fragId);
    if (prior !== undefined && prior !== rootDbId) {
      throw new EnumerationInconsistencyError('fragment-under-multiple-roots', { fragId, roots: [prior, rootDbId] });
    }
    claimed.set(fragId, rootDbId);
  }
}

/**
 * Explicit-scope normalization: ONE implementation shared by resolveRoots and digestScope (D-V4), so the frozen
 * conformance equivalence cannot drift. BOUNDED (D-V9): one parent-index pass (ids + parents only, fanout-bounded,
 * no fragment read) answers existence (`not-found`) and ancestry; the surviving roots are then walked one by one
 * under `maxFragmentsPerDbId` / `maxChildrenPerNode` (at least one fragment, else `no-fragments`; no fragment
 * claimed by two roots, else a defect). Nothing is retained across a throw (all locals).
 * @returns {Promise<{ roots: Array<{dbId:number, owners:Map<number,number>}>, unresolved: Array<{dbId:number, reason:string}> }>}
 */
async function normalizeExplicit(tree, dbIds, ctx) {
  const index = await indexNodeParents(tree, ctx);
  const unresolved = [];
  const found = new Set();
  for (const dbId of uniqueAscending(dbIds)) {
    if (index.parents.has(dbId)) found.add(dbId);
    else unresolved.push({ dbId, reason: 'not-found' });
  }
  const roots = [];
  const claimed = new Map();
  for (const dbId of found) {                       // a Set keeps the ascending insertion order
    if (hasListedAncestor(index, dbId, found)) continue;
    const owners = await walkSubtree(tree, dbId, ctx);   // bounded per root (D-V9)
    if (owners.size === 0) { unresolved.push({ dbId, reason: 'no-fragments' }); continue; }
    claimFragments(claimed, owners, dbId);
    roots.push({ dbId, owners });
  }
  unresolved.sort((a, b) => a.dbId - b.dbId);
  return { roots, unresolved };
}

const requireCall = (binding, ctx) => {
  if (binding === null || typeof binding !== 'object' || binding.model === null || typeof binding.model !== 'object') {
    throw new TypeError('ElementEnumerator: binding.model is required');
  }
  if (ctx === null || typeof ctx !== 'object' || typeof ctx.checkpoint !== 'function') {
    throw new TypeError('ElementEnumerator: ctx.checkpoint is required');
  }
};

export function createViewerElementEnumerator({ scheduleTimeout, clearScheduled, readinessPollMs } = {}) {
  const readiness = {
    ...(scheduleTimeout ? { scheduleTimeout } : {}), ...(clearScheduled ? { clearScheduled } : {}),
    ...(readinessPollMs ? { pollMs: readinessPollMs } : {}),
  };

  async function digestScope(binding, scope, ctx) {
    requireCall(binding, ctx);
    { const p = checkpointNow(ctx); if (p) await p; } // liveness before the first model read
    const model = binding.model;
    if (scope === 'whole') {
      const { count, records } = await scanPopulation(model.getFragmentList(), ctx, { loadEpoch: binding.lease?.epoch });
      const d = await digestPopulation({ count, records }, { slicer: digestSlicer(ctx) });
      return { kind: 'population', count: d.count, digest: d.digest };
    }
    const { tree, fragList } = await awaitObjectTree(model, ctx, readiness);
    const { roots: normalized } = await normalizeExplicit(tree, scope.dbIds, ctx);   // SAME code as resolveRoots (D-V4)
    const roots = [];
    for (const { dbId, owners } of normalized) {
      const { digest } = await digestSubtree(await subtreeRecords(owners, fragList, ctx), { slicer: digestSlicer(ctx) });
      roots.push({ dbId, fragmentCount: owners.size, subtreeDigest: digest });
    }
    return { kind: 'roots', roots };
  }

  async function resolveRoots() { throw new Error('resolveRoots: implemented in Task 7/8'); }

  return Object.freeze({ resolveRoots, digestScope });
}
