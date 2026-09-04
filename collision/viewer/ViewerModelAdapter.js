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

function readWorldMatrix(fragList, fragId) {
  // Duck-typed matrix carrier, never a Viewer-side THREE.Matrix4 instance -- the runtime-isolation
  // rule (spec:980-983) forbids sharing class instances across the Viewer/collision boundary;
  // only the raw Float64Array of numbers crosses.
  const carrier = { elements: new Float64Array(16) };
  fragList.getWorldMatrix(fragId, carrier);
  return carrier.elements;
}

function readWorldBounds(fragList, fragId) {
  const carrier = { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } };
  fragList.getWorldBounds(fragId, carrier);
  return {
    min: [carrier.min.x, carrier.min.y, carrier.min.z],
    max: [carrier.max.x, carrier.max.y, carrier.max.z],
  };
}

// Iterative (stack-based) depth-first walk rather than JS-recursive, so a checkpoint can be
// awaited cleanly between node visits without deep async call stacks.
export async function extractFragments(model, requestedDbIds, loadEpoch, { checkpoint } = {}) {
  const instanceTree = model.getInstanceTree();
  const fragList = model.getFragmentList();
  const results = new Map(); // fragmentId -> ExtractedFragmentRecord, unique across the WHOLE call

  for (const requestedDbId of requestedDbIds) {
    if (checkpoint) await checkpoint({ requestedDbId });

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
          const worldMatrix = readWorldMatrix(fragList, fragId);
          const worldBounds = readWorldBounds(fragList, fragId);
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
