// collision/viewer/ViewerModelAdapter.js
//
// Self-driven, non-recursive fragment extraction walk over a Viewer Model's instance tree.
// Collects every unique fragment under a set of requested dbIds, enforcing the two hard
// fanout/count ceilings (maxChildrenPerNode, maxFragmentsPerDbId) and capturing each fragment's
// true owning dbId via first-discovery-wins. spec:1080-1146 (ViewerModelAdapter), spec:2838-3013
// (Data Flow step 3 extraction).

import { maxChildrenPerNode, maxFragmentsPerDbId, maxCollisionInstancesPerEpoch } from '../constants.js';
import { createGeometryIdentity } from '../geometry/GeometryIdentity.js';
import { CapacityExceededError } from '../errors.js'; // Task 1's relocation -- NOT from CollisionWorld.js,
                                                        // which would create a circular import.

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

// Exported (Batch 3 whole-batch review, Minor finding #9) so Task 11's placement refresh
// (CollisionWorld.js's _refreshPlacementForEpoch) can reuse these verbatim instead of duplicating
// them -- both re-read the exact same FragmentList primitives into a caller-owned scratch object.
export function readWorldMatrix(fragList, fragId, scratchMatrix) {
  fragList.getWorldMatrix(fragId, scratchMatrix);
  return Float64Array.from(scratchMatrix.elements);
}

export function readWorldBounds(fragList, fragId, scratchBox) {
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
    // Branch on the return value rather than a bare `await checkpoint(...)` -- matches
    // GeometryRegistry._runPhase's own pattern and scheduler.js's documented contract
    // (checkpoint() returns undefined SYNCHRONOUSLY on the not-due fast path, a real Promise
    // only when a yield is actually due). A bare `await` on `undefined` still inserts one
    // microtask boundary before the continuation runs, which would otherwise widen the exact
    // window Item D's ordering (model-accessor reads deferred until after this call) exists to
    // close: on the synchronous fast path, this keeps "checkpoint validated liveness" and
    // "this code reads the model" in the SAME tick, with no gap for an eviction to land in.
    if (checkpoint) {
      const pending = checkpoint({ requestedDbId, label: 'extraction-node-visit' });
      if (pending) await pending;
    }

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

      if (checkpoint && stack.length > 0) {
        const pending = checkpoint({ requestedDbId, label: 'extraction-node-descend' });
        if (pending) await pending;
      }
    }
  }

  return results;
}

// Mirrors CollisionWorld.js's own private `modelIdOf` helper verbatim. Not imported from there --
// importing CollisionWorld.js here would create a circular import (CollisionWorld.js already
// imports extractFragments from this module), and this one-line helper is cheap enough to
// duplicate rather than restructure either module to share it.
function modelIdOf(model) {
  return model && model.id !== undefined ? model.id : model;
}

// The Viewer's reserved "no geometry" id (`Autodesk.Viewing.Private.INVALID_GEOM_ID === 0` in the
// pinned 7.124.2 build; GeometryList keeps index 0 reserved for it). Mirrored as a literal rather than
// read from the runtime global -- this module never reads Viewer globals other than the injected THREE.
const INVALID_GEOM_ID = 0;

// extractAllFragments: a whole-model enumeration primitive -- a DIFFERENT walk shape from
// extractFragments's per-dbId subtree walk above ("every live fragment this model holds," not a
// parameterization of it, design spec §3.3). A new sibling export; extractFragments itself is
// untouched by this addition.
//
// Accessor names and diagnostic policy below are binding per
// docs/superpowers/specs/m2-extractAllFragments-viewer-evidence.md's "Resolved for Task 5"
// section. In particular: the design spec's own candidate accessor
// (`instanceTree.findNodeForFragId(fragId)`) does NOT exist in the real Viewer build (confirmed
// absent from source and from a live prototype-chain scan) -- the real reverse lookup is
// `fragList.getDbIds(fragId)`. See that evidence note for the full citation trail.
//
// "Culled" fragments are deliberately NOT diagnosed: the evidence note confirms there is no
// stored per-fragment/per-node state for camera-frustum culling anywhere in this Viewer build, so
// inventing an unfireable 'fragment-culled' reason would fabricate a diagnostic with no
// verifiable backing state. Likewise 'fragment-index-hole' is not implemented as a reachable
// branch: every backing array (vizflags, boxes, fragments.fragId2dbId) is dense and pre-sized to
// getCount() in this build, so there is no structural index-range hole to detect.
//
// Hidden fragments are ELIGIBLE, not diagnosed or excluded (I-3 disposition, binding, see
// docs/superpowers/specs/collision-library-m2-i3-target-eligibility-disposition.md and design
// spec §3.3): a hidden fragment is enumerated exactly like any other structurally-valid fragment.
// Whole-model scope must not silently diverge from extractFragments's own (protected, unchanged)
// per-dbId subtree walk, which never checks hidden state at all and always includes a hidden
// fragment's fragments -- this primitive never reads `instanceTree.isNodeHidden` for that reason.
export async function extractAllFragments(model, loadEpoch, { checkpoint, THREE = globalThis.THREE } = {}) {
  // Preflight checkpoint, BEFORE any model read -- mirrors extractFragments's own "checkpoint
  // validates liveness before this code ever touches the model" discipline (see the comment above
  // extractFragments's own first `model.getObjectTree()` read). checkpoint()'s liveness validation
  // (WorldDisposedError/ModelEvictedError) is always synchronous on entry, whether or not a yield
  // follows (collision/scheduler.js's `validate()` call runs unconditionally before the fast-path
  // `undefined` return), so this costs nothing on the common fast path and closes a real gap that
  // reading fragList/instanceTree/getCount() before any checkpoint call would otherwise leave open:
  // touching a possibly-evicted model before any liveness check has run at all.
  if (checkpoint) {
    const pending = checkpoint({ label: 'whole-model-enumeration-start' });
    if (pending) await pending;
  }

  const fragList = model.getFragmentList();
  const count = fragList.getCount(); // dense range 0..count-1, no index-range holes in this build

  // Enumeration-capacity bound: maxCollisionInstancesPerEpoch also serves as a ceiling on
  // fragList.getCount() itself, checked BEFORE any fragment is visited -- not only checked against
  // successful record insertions. Without this, a model reporting a very large getCount() with most
  // fragments landing in one of the diagnostic branches below (not loaded / unresolvable owner)
  // could scan the entire range and accumulate an unbounded diagnostics array without ever tripping
  // a successful-insertion-count check.
  if (count > maxCollisionInstancesPerEpoch) {
    throw new CapacityExceededError('whole-model-enumeration', {
      loadEpoch,
      requested: count,
      limit: maxCollisionInstancesPerEpoch,
    });
  }

  const modelId = modelIdOf(model);
  const records = new Map(); // fragmentId -> ExtractedFragmentRecord, identical shape to extractFragments's own
  const diagnostics = []; // ClashDiagnostic[] -- same shape _runNarrowPhasePair's diagnoseFragmentOnce already
                           // produces (CollisionWorld.js:822-830): { scope, reason, role, fragment }.
  let scratchMatrix = null;
  let scratchBox = null;

  // role is always 'target' for this primitive -- whole-model extraction is only ever used for
  // target scope in M2 (per this task's own interface contract).
  const pushDiagnostic = (reason, dbId, fragId) => {
    diagnostics.push({ scope: 'fragment', reason, role: 'target', fragment: { modelId, dbId, fragId } });
  };

  for (let fragId = 0; fragId < count; fragId++) {
    if (checkpoint) {
      const pending = checkpoint({ fragId, label: 'whole-model-fragment-visit' });
      if (pending) await pending;
    }

    // 1. Excluded from loading, or unloaded -- checked BEFORE any owner lookup at all, so this
    // diagnostic's dbId is always null (never resolved).
    //
    // Split by geometry id (owner-authorized bounded contract change, 2026-10-07; evidence and rule:
    // docs/superpowers/specs/m2-extractAllFragments-viewer-evidence.md "OTG / SVF2: intentionally
    // omitted null-geometry fragments"): under OTG the Viewer's own loader marks a fragment whose
    // geometry id is INVALID_GEOM_ID (0) as MESH_NOTLOADED on purpose -- it has no geometry to load
    // (e.g. a zero-length 2D-symbol line), so there is nothing a clash query could have tested. That
    // case is reported as the INFORMATIONAL 'fragment-null-geometry' reason (carried, never silently
    // dropped, but not completeness-affecting -- see collision/README.md "Diagnostics"). Every other
    // not-loaded fragment (selective loading / dbId filter, mesh error, unload -- all of which keep a
    // real non-zero geometry id) stays the ordinary, completeness-affecting 'fragment-not-loaded'.
    // A still-streaming OTG fragment never reaches this branch: it is not flagged MESH_NOTLOADED.
    if (fragList.isNotLoaded(fragId)) {
      if (fragList.getGeometryId(fragId) === INVALID_GEOM_ID) pushDiagnostic('fragment-null-geometry', null, fragId);
      else pushDiagnostic('fragment-not-loaded', null, fragId);
      continue;
    }

    // 2. Owning dbId resolution. A plain number for a standard 3D/OTG load; `undefined` when
    // unresolvable; an ARRAY for a 2D-loaded model (2D support is explicitly out of scope for M2 --
    // routed into the SAME diagnostic reason as `undefined`, never picked-one-of/crashed/stored as
    // a number).
    const ownerDbId = fragList.getDbIds(fragId);
    if (ownerDbId === undefined || Array.isArray(ownerDbId)) {
      pushDiagnostic('fragment-owner-unresolvable', null, fragId);
      continue;
    }

    // 3. Build the record -- same readWorldMatrix/readWorldBounds helpers extractFragments already
    // uses (reused verbatim, never duplicated), plus the same geometry-identity construction.
    if (!scratchMatrix) {
      scratchMatrix = new THREE.Matrix4();
      scratchBox = new THREE.Box3();
    }
    const worldMatrix = readWorldMatrix(fragList, fragId, scratchMatrix);
    const worldBounds = readWorldBounds(fragList, fragId, scratchBox);
    const geometryIdentity = createGeometryIdentity(loadEpoch, fragList.getGeometryId(fragId));
    records.set(fragId, Object.freeze({ fragmentId: fragId, geometryIdentity, worldMatrix, worldBounds, ownerDbId }));
  }

  return { records, diagnostics };
}
