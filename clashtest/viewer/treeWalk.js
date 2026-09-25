// clashtest/viewer/treeWalk.js
// Instance-tree traversal for the ElementEnumerator (spec 6.2, 5.6.2). Iterative (no JS recursion) so a
// checkpoint can be awaited between node visits. Uses ONLY getRootId / enumNodeChildren / enumNodeFragments,
// always non-recursive (recursive=false) and never getChildCount (D-V4, Global Constraint 4). BOUNDED (D-V9):
// the limits are the collision library's own, read from collision/constants.js and never changed.
import { maxChildrenPerNode, maxFragmentsPerDbId, maxCollisionInstancesPerEpoch } from '../../collision/constants.js';
import { CapacityExceededError } from '../../collision/errors.js';
import { EnumerationInconsistencyError, EnumerationBoundExceededError } from './errors.js';
import { CHECK_EVERY, checkpointNow } from './checkpoint.js';

const isDbId = (n) => Number.isSafeInteger(n) && n >= 0;
const ascending = (a, b) => a - b;

/** One node's children, fanout-bounded exactly like extractFragments: abort at limit + 1 callbacks; a LOCAL flag (dbId 0 is falsy). */
function boundedChildren(tree, id, root) {
  const out = [];
  let count = 0;
  let exceeded = false;
  tree.enumNodeChildren(id, (c) => {
    count += 1;
    if (count > maxChildrenPerNode) { exceeded = true; return true; }
    out.push(c);
    return false;
  }, false);
  if (exceeded) throw new EnumerationBoundExceededError('maxChildrenPerNode', { dbId: id, root, count });
  return out;
}

/** One node's own fragments. The Viewer call is not abortable; RECORDING stops at `room`, so retention stays bounded. */
function boundedOwn(tree, id, room) {
  const own = [];
  let tally = 0;
  tree.enumNodeFragments(id, (f) => { tally += 1; if (tally <= room) own.push(f); }, false);
  return { own, tally };
}

/** Explicit-scope existence/ancestor index: ids and parents only; no fragment is ever requested. */
export async function indexNodeParents(tree, ctx) {
  const rootId = tree.getRootId();
  if (!isDbId(rootId)) throw new EnumerationInconsistencyError('root-id-invalid', { rootId });
  const parents = new Map();
  const stack = [{ id: rootId, parent: null }];
  let visited = 0;
  while (stack.length > 0) {
    const { id, parent } = stack.pop();
    if (parents.has(id)) throw new EnumerationInconsistencyError('node-visited-twice', { dbId: id });
    parents.set(id, parent);
    const children = boundedChildren(tree, id, null);
    for (let i = children.length - 1; i >= 0; i--) stack.push({ id: children[i], parent: id });
    if (++visited % CHECK_EVERY === 0) { const p = checkpointNow(ctx); if (p) await p; }
  }
  return { rootId, parents };
}

/** Whole-model index, budgeted: every fragment and child list is charged to an existing limit BEFORE it is retained. */
export async function indexInstanceTree(tree, ctx, { loadEpoch } = {}) {
  const rootId = tree.getRootId();
  if (!isDbId(rootId)) throw new EnumerationInconsistencyError('root-id-invalid', { rootId });
  const nodes = new Map();
  const stack = [{ id: rootId, parent: null }];
  let visited = 0;
  let reachable = 0;                                  // tree-reachable own-fragment callbacks so far (rediscoveries count)
  while (stack.length > 0) {
    const { id, parent } = stack.pop();
    if (nodes.has(id)) throw new EnumerationInconsistencyError('node-visited-twice', { dbId: id });
    const { own, tally } = boundedOwn(tree, id, maxFragmentsPerDbId);
    if (tally > maxFragmentsPerDbId) throw new EnumerationBoundExceededError('maxFragmentsPerDbId', { dbId: id, tally });
    reachable += tally;
    if (reachable > maxCollisionInstancesPerEpoch) {
      throw new CapacityExceededError('whole-model-enumeration', { loadEpoch, requested: reachable, limit: maxCollisionInstancesPerEpoch });
    }
    const children = boundedChildren(tree, id, null);
    nodes.set(id, { parent, own, children });
    for (let i = children.length - 1; i >= 0; i--) stack.push({ id: children[i], parent: id });
    if (++visited % CHECK_EVERY === 0) { const p = checkpointNow(ctx); if (p) await p; }
  }
  return { rootId, nodes };
}

/** The extractFragments rule: pre-order (own fragments, then children L->R), first discovery wins; ONE tally per requested root. */
export async function walkSubtree(tree, rootDbId, ctx) {
  const owners = new Map();
  const seen = new Set();
  const stack = [rootDbId];
  let tally = 0;
  let visited = 0;
  while (stack.length > 0) {
    const node = stack.pop();
    if (seen.has(node)) throw new EnumerationInconsistencyError('node-visited-twice', { dbId: node, root: rootDbId });
    seen.add(node);
    tree.enumNodeFragments(node, (f) => {
      tally += 1;                                     // library semantics: rediscovered fragments count too
      if (tally <= maxFragmentsPerDbId && !owners.has(f)) owners.set(f, node);   // stop recording past the limit
    }, false);
    if (tally > maxFragmentsPerDbId) {                // checked BEFORE this node's children are read (as extractFragments does)
      throw new EnumerationBoundExceededError('maxFragmentsPerDbId', { root: rootDbId, dbId: node, tally });
    }
    const children = boundedChildren(tree, node, rootDbId);
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
    if (++visited % CHECK_EVERY === 0) { const p = checkpointNow(ctx); if (p) await p; }
  }
  return owners;
}

/** Spec 5.6.2 / OQ-4 probe step 3: the first node on each path from the tree root that itself owns fragments. */
export async function topmostFragmentOwningRoots(index, ctx) {
  const roots = [];
  const stack = [index.rootId];
  let visited = 0;
  while (stack.length > 0) {
    const id = stack.pop();
    const node = index.nodes.get(id);
    if (node.own.length > 0) roots.push(id);
    else for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]);
    if (++visited % CHECK_EVERY === 0) { const p = checkpointNow(ctx); if (p) await p; }
  }
  return roots.sort(ascending);
}

export function hasListedAncestor(index, dbId, listedSet) {
  let p = index.parents.get(dbId) ?? null;
  while (p !== null) {
    if (listedSet.has(p)) return true;
    p = index.parents.get(p) ?? null;
  }
  return false;
}
