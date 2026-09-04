// collision/query/ContainmentQuery.js
//
// Internal point-classification primitive (classifyPoint) plus, added by a LATER task
// (Task 9), anyComponentInside -- this task exports ONLY classifyPoint; leave room
// alongside it for that export, do not assume it exists in this task's own tests.
//
// Ported near-verbatim from spike/geometry-core.mjs's classifyPoint/nearTriangleEdge/
// RAY_DIRECTIONS -- the spike's algorithm already matches the spec's declared solid
// model exactly (spec:2253-2310). The only change here is sourcing tolerances from
// collision/constants.js instead of local hardcoded literals, and taking the target's
// precomputed L_X (localDiagonal, from ThreeMeshBvhBackend#build, Task 5) as an
// explicit parameter instead of recomputing it per call.

import * as THREE from 'three';
import { build as buildScopedBvh } from '../blas/ThreeMeshBvhBackend.js';
import {
  barycentricEpsilon, mergeDistanceFactor, surfaceEpsilonFactor,
  maxContainmentSamples, samplesPerComponent, maxWitnessTriangles, witnessLadderFactors,
} from '../constants.js';

// SPIKE FINDING (spec:2286-2296): the naive "local +X first, +Y on retry" rule is
// pathological for BIM. A ray along a local axis from a symmetric point inside an
// axis-aligned box hits the exact CENTRE of a face -- precisely where BoxGeometry
// splits its two triangles -- so every axis-aligned probe grazes a diagonal, every
// retry grazes too, and the point misclassifies `boundary`. Generic, non-axis-aligned,
// mutually unrelated directions avoid systematic alignment with mesh features.
const RAY_DIRECTIONS = [
  new THREE.Vector3(1, 0.3178, 0.1234).normalize(),
  new THREE.Vector3(0.2189, 1, 0.4567).normalize(),
  new THREE.Vector3(0.4321, 0.1357, 1).normalize(),
];

function nearTriangleEdge(hit) {
  const b = hit.barycoord;
  if (!b) return false;
  return b.x < barycentricEpsilon || b.y < barycentricEpsilon || b.z < barycentricEpsilon;
}

/**
 * Three-valued point classification against a target's ENTIRE triangle set, using
 * even-odd (parity) ray casting entirely in the target BVH's own local space
 * (spec:2267-2310). `boundary` is load-bearing, not a convenience third case: it is
 * what fixes round-3's boolean-classifier defect (a point exactly on a face gets a
 * near-zero-distance ray hit that naive parity would wrongly count as `inside`).
 *
 * @param {THREE.Vector3} point - in targetBvh's own local space.
 * @param {import('three-mesh-bvh').MeshBVH} targetBvh
 * @param {number} targetLocalDiagonal - L_target := diagonal(localBounds(target)).
 * @returns {'inside' | 'outside' | 'boundary'}
 */
export function classifyPoint(point, targetBvh, targetLocalDiagonal) {
  // KNOWN GAP -- NOT a declared spec limitation, tracked separately, out of Task 6's
  // scope to fix (a proper fix needs geometric evidence beyond a single scalar --
  // hit positions/normals/local feature scale -- i.e. a spec-revision-level redesign
  // of this tolerance model, not a transcription concern):
  //
  // Both tolerances below scale off the target's single GLOBAL bounding-box diagonal
  // (targetLocalDiagonal), not off any local/per-feature thickness. For extreme
  // single-geometry aspect ratios (one dimension enormously larger than another, on
  // the SAME target -- distinct from the spec's existing "anisotropic scale" passage,
  // which covers cross-instance transform anisotropy, a different mechanism), this
  // produces two failure modes, both reproduced on the same box(0.5, 1_000_000,
  // 1_000_000) fixture (max/min local extent = 2,000,000:1 -- real BIM/MEP elements do not
  // realistically approach this):
  //   (a) merge-collapse: mergeDistance (~1.41 on that fixture) can exceed the box's
  //       actual 0.5 thickness, so the entry and exit crossings through the thin
  //       dimension merge into one -- flipping parity and misclassifying a genuinely
  //       OUTSIDE point (e.g. (-10, 0, 0)) as `inside`.
  //   (b) boundary-expansion: surfaceEpsilon uses the same global-diagonal scale, so
  //       once it approaches half the thin dimension, a genuinely INTERIOR point
  //       (e.g. the centre (0,0,0)) gets caught by the Stage-1 proximity pre-check
  //       and classified `boundary` before parity casting is even attempted, instead
  //       of `inside`.
  // See test/query/ContainmentQuery.classifyPoint.test.mjs's `{ todo: true }` fixture
  // for the exact reproducer and the desired (currently failing) correct answers.
  const surfaceEpsilon = surfaceEpsilonFactor * targetLocalDiagonal;
  const mergeDistance = mergeDistanceFactor * targetLocalDiagonal;

  // Stage 1: surface-proximity pre-check. Guarantees the parity ray below can never
  // meet a distance-zero hit, so that degenerate case cannot arise at all.
  const closest = targetBvh.closestPointToPoint(point);
  if (closest && closest.distance <= surfaceEpsilon) return 'boundary';

  const ray = new THREE.Ray();
  for (const direction of RAY_DIRECTIONS) {
    ray.origin.copy(point);
    ray.direction.copy(direction);

    // THREE.DoubleSide is mandatory: the default FrontSide drops back-facing
    // crossings and silently breaks parity (thin-shell fixture).
    const hits = targetBvh.raycast(ray, THREE.DoubleSide);

    let grazed = false;
    for (const hit of hits) {
      if (nearTriangleEdge(hit)) { grazed = true; break; }
    }
    if (grazed) continue; // retry along the next generic direction

    // Sort by distance THEN merge coincident hits -- MeshBVH.raycast does not
    // guarantee ordered hits.
    const distances = hits.map((h) => h.distance).sort((a, b) => a - b);
    let crossings = 0;
    let last = -Infinity;
    for (const d of distances) {
      if (d - last > mergeDistance) { crossings++; last = d; }
    }
    // Even-odd parity across the target's ENTIRE triangle set (spec:1658-1667) -- the
    // declared solid model, not incidental to MeshBVH.raycast.
    return crossings % 2 === 1 ? 'inside' : 'outside';
  }

  return 'boundary'; // every direction grazed -- genuinely cannot say
}

// anyComponentInside samples per connected component, not against a global cap
// (docs/...:2312-2497). Guarantee: for a closed manifold component, one conclusive
// sample decides it exactly, because crossing B's boundary would BE a proper
// crossing. Non-manifold/open components are best-effort and flagged.

const noopScheduler = { elapsedMs: () => 0, checkpointIfDue: async () => {} };

const _point = new THREE.Vector3();
const _wa = new THREE.Vector3();
const _wb = new THREE.Vector3();
const _wc = new THREE.Vector3();
const _wCentroid = new THREE.Vector3();
const _wNormal = new THREE.Vector3();
const _wEdge1 = new THREE.Vector3();
const _wEdge2 = new THREE.Vector3();
const _wProbe = new THREE.Vector3();
const _wProbeInTarget = new THREE.Vector3();

/**
 * @param {import('three').BufferGeometry} sourceGeometry - already welded
 * @param {import('three-mesh-bvh').MeshBVH} sourceBvh
 * @param {number} sourceLocalDiagonal
 * @param {{ componentCount: number, componentOf: Int32Array, closedManifold: boolean[] }} sourceConnectivity
 * @param {import('three-mesh-bvh').MeshBVH} targetBvh
 * @param {number} targetLocalDiagonal
 * @param {boolean} targetClosedManifold
 * @param {import('three').Matrix4} sourceToTargetMatrix
 * @param {{
 *   mode: 'containment' | 'volume-overlap',
 *   containerRole?: 'source' | 'target',
 *   sampledRole?: 'source' | 'target',
 *   maxContainmentSamples?: number,
 *   samplesPerComponent?: number,
 *   maxWitnessTriangles?: number,
 *   witnessLadderFactors?: number[],
 *   scheduler?: { elapsedMs(): number, checkpointIfDue(): Promise<void> },
 *   targetAspectRatioExceeded?: boolean,
 * }} options
 */
export async function anyComponentInside(
  // sourceBvh/sourceLocalDiagonal are accepted for signature stability (the canonical
  // reference's documented shape, and callers like VolumeOverlapQuery pass them
  // unconditionally) but are NOT used in this function's own body: stages 1-2 only
  // ever classify against `targetBvh`, and stage 3 (see constructedInteriorWitness
  // below) builds and uses its own component-scoped BVH instead of the full
  // multi-component `sourceBvh` -- that is precisely the Critical fix a Codex
  // spec-review of an earlier draft required (see below).
  sourceGeometry, sourceBvh, sourceLocalDiagonal, sourceConnectivity,
  targetBvh, targetLocalDiagonal, targetClosedManifold,
  sourceToTargetMatrix, options
) {
  const mode = options?.mode;
  if (mode !== 'containment' && mode !== 'volume-overlap') {
    throw new TypeError("anyComponentInside: options.mode must be 'containment' or 'volume-overlap'");
  }
  const containerRole = options.containerRole ?? 'target';
  const sampledRole = options.sampledRole ?? 'source';
  const sampleBudget = options.maxContainmentSamples ?? maxContainmentSamples;
  const perComponentTarget = options.samplesPerComponent ?? samplesPerComponent;
  const witnessTriangleBudget = options.maxWitnessTriangles ?? maxWitnessTriangles;
  const ladderFactors = options.witnessLadderFactors ?? witnessLadderFactors;
  const scheduler = options.scheduler ?? noopScheduler;
  const targetAspectRatioExceeded = options.targetAspectRatioExceeded ?? false;

  const diagnostics = [];
  const addDiagnostic = (reason, role) => {
    if (!diagnostics.some((d) => d.reason === reason && d.role === role)) {
      diagnostics.push(role ? { reason, role } : { reason });
    }
  };

  // Target-side precondition, checked once regardless of mode or outcome
  // (docs/...:2367-2389): every operand parity is evaluated against must be a
  // certified closed manifold, or every result (positive AND negative) is tainted.
  // Orthogonal to the aspect-ratio gate below -- both diagnostics can and should
  // coexist when both conditions are true.
  if (!targetClosedManifold) addDiagnostic('unverified-parity-operand', containerRole);

  // M1 aspect-ratio disposition guard (spec Tolerances section, "Single-geometry
  // aspect ratio"; this task and Task 12's containment-mode target role are the ONLY
  // two spec-assigned gate sites, per the batch's reconciliation ledger). When the
  // TARGET's own aspectRatioExceeded signal is set, classifyPoint's tolerance model
  // cannot make a trustworthy call against it at all -- short-circuit BEFORE the
  // per-component sampling loop below, and before stage 3's constructedInteriorWitness
  // (which also classifies its constructed probe against targetBvh) ever runs.
  if (targetAspectRatioExceeded) {
    addDiagnostic('geometry-aspect-ratio-exceeds-tolerance-model', containerRole);
    return {
      inside: false,
      decidingComponentClosed: null,
      decidingComponentIndex: null,
      diagnostics,
      unresolvedComponentCount: sourceConnectivity.componentCount,
      samplesUsed: 0,
      budgetExhausted: false,
    };
  }

  const index = sourceGeometry.index.array;
  const position = sourceGeometry.attributes.position;
  const componentOf = sourceConnectivity.componentOf;
  const triCount = componentOf.length;

  const trianglesByComponent = new Map();
  for (let t = 0; t < triCount; t++) {
    const c = componentOf[t];
    if (!trianglesByComponent.has(c)) trianglesByComponent.set(c, []);
    trianglesByComponent.get(c).push(t);
  }

  let samplesUsed = 0;
  let budgetExhausted = false;
  // Determined up front from sourceConnectivity.closedManifold, NOT incrementally
  // inside the loop below -- a component's flagged-ness must be known regardless of
  // whether the sampling budget ever actually reaches that component (final
  // whole-branch review, Finding 4: the old incremental `if (!closed)
  // anyFlaggedComponentInvolved = true;`, set only for components actually visited,
  // let a flagged component skipped entirely by budget exhaustion leave this false,
  // silently omitting the non-manifold-component diagnostic on a negative result).
  const anyFlaggedComponentInvolved = sourceConnectivity.closedManifold.some((closed) => !closed);
  let anyClassifiedInside = false;
  let decidingComponentClosed = null;
  let decidingComponentIndex = null;
  let unresolvedComponentCount = 0;

  componentLoop:
  for (const [componentId, tris] of trianglesByComponent) {
    if (anyClassifiedInside) break;
    if (budgetExhausted) { unresolvedComponentCount++; continue; }

    const closed = sourceConnectivity.closedManifold[componentId];

    // Derive the component's referenced vertex list, then order it as: stride bucket
    // 0 (spatially-spread stride picks, "stage 1"), then bucket 1, etc. -- so the
    // FIRST `perComponentTarget` entries are spread across the whole component
    // (stage 1), and if all of those read `boundary`, the walk naturally continues
    // through the rest (stage 2) without a separate code path (docs/...:2409-2417).
    const vertexSet = new Set();
    for (const t of tris) {
      vertexSet.add(index[t * 3]);
      vertexSet.add(index[t * 3 + 1]);
      vertexSet.add(index[t * 3 + 2]);
    }
    const vertices = [...vertexSet];
    const stride = Math.max(1, Math.ceil(vertices.length / perComponentTarget));
    const order = [];
    for (let s = 0; s < stride; s++) {
      for (let i = s; i < vertices.length; i += stride) order.push(vertices[i]);
    }

    let componentResolved = false;
    for (const v of order) {
      if (samplesUsed >= sampleBudget) { budgetExhausted = true; break; }

      // Intra-loop checkpoint, called before EVERY individual classifyPoint call
      // (docs/...:2465-2496, round-11 fix for round-10's too-coarse
      // deadlineCheckInterval=256). checkpointIfDue() itself decides whether elapsed
      // time actually warrants yielding -- a call that isn't due yet resolves
      // immediately without yielding, so calling it every iteration is correct, not
      // merely tolerated. On an actual yield: two-part revalidation
      // (disposed-first-then-epoch) is the scheduler's own job; this loop just awaits
      // it and lets a rejection propagate, then resumes sampling from exactly the
      // next unsampled vertex -- it does NOT restart or truncate the search.
      await scheduler.checkpointIfDue();

      _point.fromBufferAttribute(position, v).applyMatrix4(sourceToTargetMatrix);
      const c = classifyPoint(_point, targetBvh, targetLocalDiagonal);
      samplesUsed++;

      if (c === 'inside') {
        anyClassifiedInside = true;
        decidingComponentClosed = closed;
        decidingComponentIndex = componentId;
        componentResolved = true;
        break;
      }
      if (c === 'outside') { componentResolved = true; break; }
      // 'boundary': keep walking the rest of `order`.
    }

    if (anyClassifiedInside) break;

    // Stage 3: constructed interior witness, volume-overlap only (docs/...:2418-2443,
    // 2547-2553 for why containment stops after stage 2).
    if (!componentResolved && !budgetExhausted && mode === 'volume-overlap') {
      const witness = await constructedInteriorWitness(
        sourceGeometry, tris,
        targetBvh, targetLocalDiagonal, sourceToTargetMatrix,
        witnessTriangleBudget, ladderFactors, scheduler,
        samplesUsed, sampleBudget
      );
      samplesUsed = witness.samplesUsed;
      if (witness.budgetExhausted) budgetExhausted = true;
      if (witness.inside) {
        anyClassifiedInside = true;
        decidingComponentClosed = closed;
        decidingComponentIndex = componentId;
        break;
      }
    }

    if (!anyClassifiedInside && !componentResolved) unresolvedComponentCount++;
  }

  if (anyClassifiedInside) {
    // Positive result whose deciding component is not certified closed: containment
    // is real, the VOLUME is not certified (docs/...:2340-2359). Only meaningful in
    // volume-overlap; containment's contract handles open sources by design.
    if (mode === 'volume-overlap' && decidingComponentClosed === false) {
      addDiagnostic('unverified-open-component', sampledRole);
    }
  } else if (mode === 'volume-overlap' && anyFlaggedComponentInvolved) {
    // A negative result involving ANY flagged component is degraded to unverified,
    // regardless of whether that component's own sample happened to resolve cleanly
    // (docs/...:2360; the guarantee itself is what's uncertain for such a component,
    // not merely this run's sampling outcome).
    addDiagnostic('non-manifold-component');
  }

  if (budgetExhausted) addDiagnostic('incomplete-component-coverage');

  return {
    inside: anyClassifiedInside,
    decidingComponentClosed,
    decidingComponentIndex,
    diagnostics,
    unresolvedComponentCount,
    samplesUsed,
    budgetExhausted,
  };
}

// Stage 3 helper: constructs a point in the component's own interior (never relying
// on its surface), validates it against the component's OWN geometry first, then
// classifies it against target.
//
// A Codex spec-review of an earlier draft caught a Critical bug here: that draft
// validated the constructed probe against the FULL `sourceBvh` (every component of
// the source geometry), not just the deciding component's own triangles. Even-odd
// parity is evaluated over whatever triangle set it's asked to classify against
// (docs/...:1658, "over the target's ENTIRE triangle set") -- so classifying against
// the WHOLE source lets an unrelated or nested sibling component change the verdict
// (concrete counterexample: two nested closed shells sharing this source geometry,
// where a probe just inside the INNER shell is also enclosed by the OUTER shell, so
// whole-source parity reads it `outside` via the same even-odd cancellation
// docs/...:1662-1665 describes for a hollow pipe -- silently rejecting a valid
// witness for a real, containable component). The fix: build a BVH scoped to ONLY
// `componentTriangles`, and classify the probe against THAT, never the full source.
//
// This also settles what "the component's own local frame" (docs/...:2426-2433)
// means precisely: this plan takes it to mean the DECIDING COMPONENT's own local
// scale, not the whole source geometry's cached `L_source` -- consistent with round
// 5's own reasoning (never borrow a scale from a larger/unrelated context) applied
// one level deeper than the spec's literal wording resolves on its own. Flagged for
// the spec owner to confirm during assembly if a different reading was intended.
async function constructedInteriorWitness(
  sourceGeometry, componentTriangles,
  targetBvh, targetLocalDiagonal, sourceToTargetMatrix,
  witnessTriangleBudget, ladderFactors, scheduler,
  samplesUsedIn, sampleBudget
) {
  const position = sourceGeometry.attributes.position;
  const index = sourceGeometry.index.array;

  // Build a triangle set containing ONLY this component's own triangles, remapped to
  // a dense local vertex range, and a fresh BVH over just that subset. Batch-2
  // reconciliation adaptation #1: ThreeMeshBvhBackend.build() takes raw
  // {position, index, triangleCount} arrays directly, not a THREE.BufferGeometry --
  // componentPositions/componentIndex are already plain arrays in that raw shape, so
  // no intermediate BufferGeometry is constructed for this call at all.
  const localIndexOf = new Map();
  const componentPositions = [];
  const componentIndex = [];
  for (const t of componentTriangles) {
    for (let e = 0; e < 3; e++) {
      const globalIndex = index[t * 3 + e];
      if (!localIndexOf.has(globalIndex)) {
        localIndexOf.set(globalIndex, componentPositions.length / 3);
        componentPositions.push(
          position.getX(globalIndex), position.getY(globalIndex), position.getZ(globalIndex)
        );
      }
      componentIndex.push(localIndexOf.get(globalIndex));
    }
  }
  // KNOWN GAP, flagged not silently patched (codex-advisor medium review of this
  // task's finished draft, cross-checked against the batch ledger's own scoping
  // language): `buildScopedBvh` also returns `aspectRatioExceeded` for this
  // component-scoped BVH, discarded here. This module's M1 aspect-ratio gate
  // (`options.targetAspectRatioExceeded`, above) is scoped by the ledger's ruling to
  // "this task's targetBvh parameter -- never the source, which is sampled, not
  // parity-tested"; the classifyPoint call below against `componentBvh` validates the
  // constructed probe against the SOURCE component's own geometry (the "own-class"
  // check), not against a target, so it falls on the source side of that same
  // ruling's explicit exclusion, not a silently-skipped instance of the gate this
  // task was asked to add. An extreme-aspect-ratio source component could therefore
  // still misclassify its own witness probe via the same underlying tolerance-model
  // limitation classifyPoint documents elsewhere in this file. Same disposition as
  // ProperCrossingQuery's analogous, already-flagged gap (batch ledger, "Explicitly
  // OUT of this ruling's scope") -- a genuine open question for the spec owner, not a
  // defect in this task's own implementation of the spec as scoped. Also unbudgeted:
  // this synchronous BVH build has no checkpoint before it and is not itself counted
  // against the sample budget, inherited unchanged from this task's own brief.
  const componentIndexArray = Uint32Array.from(componentIndex);
  const { bvh: componentBvh, localDiagonal: componentLocalDiagonal } = buildScopedBvh({
    position: Float32Array.from(componentPositions),
    index: componentIndexArray,
    triangleCount: componentIndexArray.length / 3,
  });

  const ladder = ladderFactors.map((f) => f * componentLocalDiagonal);

  let samplesUsed = samplesUsedIn;
  let budgetExhausted = false;

  for (let attempt = 0; attempt < Math.min(witnessTriangleBudget, componentTriangles.length); attempt++) {
    if (samplesUsed >= sampleBudget) { budgetExhausted = true; break; }

    // Checked before each witness-triangle attempt (docs/...:2492-2494), same
    // yield-and-resume pattern as the vertex-sampling loop above.
    await scheduler.checkpointIfDue();

    const t = componentTriangles[attempt];
    const ia = index[t * 3], ib = index[t * 3 + 1], ic = index[t * 3 + 2];
    _wa.fromBufferAttribute(position, ia);
    _wb.fromBufferAttribute(position, ib);
    _wc.fromBufferAttribute(position, ic);
    _wCentroid.copy(_wa).add(_wb).add(_wc).multiplyScalar(1 / 3);
    _wEdge1.subVectors(_wb, _wa);
    _wEdge2.subVectors(_wc, _wa);
    _wNormal.crossVectors(_wEdge1, _wEdge2).normalize();

    for (const sign of [1, -1]) {
      for (const delta of ladder) {
        if (samplesUsed >= sampleBudget) { budgetExhausted = true; break; }
        samplesUsed++;
        _wProbe.copy(_wCentroid).addScaledVector(_wNormal, sign * delta);
        // Must actually land inside the DECIDING COMPONENT's own geometry first --
        // only then does classifying it against target mean anything
        // (docs/...:2418-2424) -- classified against the component-scoped BVH above,
        // never the full multi-component sourceBvh.
        const ownClass = classifyPoint(_wProbe, componentBvh, componentLocalDiagonal);
        if (ownClass !== 'inside') continue;
        _wProbeInTarget.copy(_wProbe).applyMatrix4(sourceToTargetMatrix);
        const targetClass = classifyPoint(_wProbeInTarget, targetBvh, targetLocalDiagonal);
        if (targetClass === 'inside') return { inside: true, samplesUsed, budgetExhausted };
      }
      if (budgetExhausted) break;
    }
    if (budgetExhausted) break;
  }

  return { inside: false, samplesUsed, budgetExhausted };
}
