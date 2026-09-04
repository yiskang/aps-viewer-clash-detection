// collision/viewer/ViewerModelAdapter.js
//
// Self-driven, non-recursive fragment extraction walk over a Viewer Model's instance tree.
// Collects every unique fragment under a set of requested dbIds, enforcing the two hard
// fanout/count ceilings (maxChildrenPerNode, maxFragmentsPerDbId) and capturing each fragment's
// true owning dbId via first-discovery-wins. spec:1080-1146 (ViewerModelAdapter), spec:2838-3013
// (Data Flow step 3 extraction).

import { maxChildrenPerNode, maxFragmentsPerDbId } from '../constants.js';
import { createGeometryIdentity } from '../geometry/GeometryIdentity.js';

export class ExtractionLimitExceededError extends Error {
  constructor(limit, requestedDbId, node, observedCount) {
    super(
      `Extraction limit '${limit}' exceeded while walking requested dbId ${requestedDbId} ` +
      `(node ${node}, observed count ${observedCount})`,
    );
    this.name = 'ExtractionLimitExceededError';
    this.limit = limit;
    this.requestedDbId = requestedDbId;
    this.node = node;
    this.observedCount = observedCount;
  }
}

// readWorldMatrix/readWorldBounds pass a REAL Viewer-side scratch object (a genuine
// THREE.Matrix4 / THREE.Box3 from the caller's injected THREE namespace, never a duck-typed
// shim) into FragmentList.getWorldMatrix/getWorldBounds. The real Viewer methods call actual
// methods on this out-parameter (dstMtx.multiplyMatrices(...); dstBox.applyMatrix4(...),
// .copy(...), .intersect(...), .isEmpty(), .makeEmpty()) -- a plain object with only field
// writes throws the moment a model has any model-level transform or a moved/exploded
// fragment. The scratch instance itself never escapes this module: its numbers are copied
// out into plain, owned data (a Float64Array / plain-number arrays) immediately after the
// FragmentList call returns and before anything else touches it, preserving the
// runtime-isolation rule (spec:979-983 -- "only numbers cross the Viewer/collision boundary").

function readWorldMatrix(fragList, fragId, scratchMatrix) {
  fragList.getWorldMatrix(fragId, scratchMatrix);
  return Float64Array.from(scratchMatrix.elements);
}

function readWorldBounds(fragList, fragId, scratchBox) {
  fragList.getWorldBounds(fragId, scratchBox);
  return {
    min: [scratchBox.min.x, scratchBox.min.y, scratchBox.min.z],
    max: [scratchBox.max.x, scratchBox.max.y, scratchBox.max.z],
  };
}

// Iterative (stack-based) depth-first walk rather than JS-recursive, so a checkpoint can be
// awaited cleanly between node visits without deep async call stacks.
//
// `THREE` is an injected constructor-like namespace (never a static import -- the Viewer's r71
// THREE is a runtime global its own script tag exposes, not an ES module) defaulting to
// `globalThis.THREE`, which is what a real Viewer page always has set by the time extraction
// runs (spike/FINDINGS.md:29 confirms r71 there).
export async function extractFragments(model, requestedDbIds, loadEpoch, { checkpoint, THREE = globalThis.THREE } = {}) {
  let instanceTree = null;
  let fragList = null;
  // Scratch Matrix4/Box3, allocated ONCE for this whole call (lazily, alongside instanceTree/
  // fragList below) and reused across every fragment -- safe because each one's numbers are
  // copied out (see readWorldMatrix/readWorldBounds above) immediately after the FragmentList
  // call and before the scratch object is reused for the next fragment. Lazy rather than
  // eager so a call with an empty requestedDbIds never has to dereference THREE at all --
  // matches instanceTree/fragList's own laziness immediately below.
  let scratchMatrix = null;
  let scratchBox = null;
  const results = new Map(); // fragmentId -> ExtractedFragmentRecord, unique across the WHOLE call

  for (const requestedDbId of requestedDbIds) {
    // NOTE for whoever threads in the real Viewer-readiness checkpoint (not yet implemented):
    // `checkpoint()` here is unconditionally awaited, unlike GeometryRegistry._runPhase's
    // branch-on-pending pattern (collision/geometry/GeometryRegistry.js, matching
    // scheduler.js's "returns undefined synchronously when nothing is due" contract). A bare
    // `await` still yields a microtask even when the call resolves synchronously, which is an
    // unnecessary extra window for eviction to race the very check Item D added this ordering
    // to protect against. Out of scope for this fix wave (this file's `checkpoint` today is
    // just a test-provided hook, not yet the real scheduler-backed port) -- worth revisiting
    // once the real checkpointPort is wired in here.
    if (checkpoint) await checkpoint({ requestedDbId });

    if (!instanceTree) {
      // Deferred until after the FIRST checkpoint call (never read before it) so a future
      // Viewer-readiness checkpoint's own liveness validation gets a chance to reject before
      // this module ever touches a possibly-evicted model. Read once here, on the first
      // requested-dbId iteration, and reused for every subsequent iteration.
      instanceTree = model.getObjectTree();
      fragList = model.getFragmentList();
      scratchMatrix = new THREE.Matrix4();
      scratchBox = new THREE.Box3();
    }

    let fragmentTally = 0; // per-REQUESTED-dbId tally (spec:2900-2903) -- resets for each root
    const stack = [requestedDbId];

    while (stack.length > 0) {
      const node = stack.pop();

      // Step 1: this node's OWN direct fragments. Not abortable mid-call (spec:2931-2960,
      // accepted non-preemptible risk) -- tally is checked only after the call returns.
      instanceTree.enumNodeFragments(node, (fragId) => {
        fragmentTally++;
        if (fragmentTally > maxFragmentsPerDbId) return; // stop recording; rejection below fires anyway
        if (!results.has(fragId)) {
          // First-discovery-wins (spec:1298-1310, 2969-2976): a fragment id rediscovered later
          // under a different node keeps its original ownerDbId/matrix/bounds untouched -- this
          // module makes no cross-call OR cross-node stability promise beyond "first write wins".
          const worldMatrix = readWorldMatrix(fragList, fragId, scratchMatrix);
          const worldBounds = readWorldBounds(fragList, fragId, scratchBox);
          const geometryIdentity = createGeometryIdentity(loadEpoch, fragList.getGeometryId(fragId));
          results.set(fragId, Object.freeze({ fragmentId: fragId, geometryIdentity, worldMatrix, worldBounds, ownerDbId: node }));
        }
      }, false);

      if (fragmentTally > maxFragmentsPerDbId) {
        throw new ExtractionLimitExceededError('maxFragmentsPerDbId', requestedDbId, node, fragmentTally);
      }

      // Step 2: this node's children, fanout-ceiling-guarded. spec:2853-2929 -- abort tracked via
      // a LOCAL boolean flag, never via the enumeration's/callback's own return-carried dbId value,
      // since a legitimate dbId of 0 is falsy and must not be mistaken for "no more children".
      let childCount = 0;
      let fanoutExceeded = false;
      const children = [];
      instanceTree.enumNodeChildren(node, (childId) => {
        childCount++;
        if (childCount > maxChildrenPerNode) {
          fanoutExceeded = true;
          return true; // abort enumeration -- costs exactly maxChildrenPerNode + 1 callbacks total
        }
        children.push(childId);
        return false;
      }, false);

      if (fanoutExceeded) {
        throw new ExtractionLimitExceededError('maxChildrenPerNode', requestedDbId, node, childCount);
      }

      // Push in reverse so pop() yields children in original left-to-right order (depth-first).
      for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);

      if (checkpoint && stack.length > 0) await checkpoint({ requestedDbId });
    }
  }

  return results;
}
