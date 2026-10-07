// test/fixtures/generate-clearance-legacy-golden.mjs
//
// SVF2 non-uniform fragment clearance design (docs/superpowers/specs/
// 2026-10-07-svf2-nonuniform-fragment-clearance-design.md) §8 T0: legacy golden baseline.
//
// Defines a fixed set of clearance scenarios whose operands are all inside M3's ALREADY-supported
// transform class (rigid x positive uniform scale), plus the two reflected cases owner decision O-1
// keeps unsupported (their diagnosed-unsupported behaviour must also be unchanged), and runs each
// through the real `CollisionWorld.findClashes` / `clearanceQuery` path. The captured output
// (`clearance-legacy-golden.json`, beside this file) was generated BEFORE any source change of that
// design; `test/CollisionWorld.clearanceLegacyGolden.test.mjs` re-runs the same scenarios at every
// later task and asserts exact (`Object.is`) equality, proving the legacy uniform-scale path stays
// bit-identical.
//
// Regenerate (only when a legacy-path change is intentional and reviewed):
//   node test/fixtures/generate-clearance-legacy-golden.mjs
//
// Importing this module never writes anything; only running it directly does.

import { writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import process from 'node:process';
import * as THREE from 'three';
import { CollisionWorld } from '../../collision/CollisionWorld.js';
import { clearanceQuery } from '../../collision/query/ClearanceQuery.js';
import { validateUniformScale, computeToleranceFloor } from '../../collision/query/ClearanceTransform.js';
import { surfaceEpsilonFactor } from '../../collision/constants.js';
import { build } from '../../collision/blas/ThreeMeshBvhBackend.js';
import { compactAndWeld } from '../../collision/geometry/activeRangeCompaction.js';
import { adaptViewerGeometry } from '../../collision/viewer/ViewerGeometryAdapter.js';
import { buildMockModel } from './mockInstanceTree.mjs';

export const GOLDEN_PATH = fileURLToPath(new URL('./clearance-legacy-golden.json', import.meta.url));

// ---- fixture plumbing --------------------------------------------------------------------------

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const sphere = (r, detail = 1) => new THREE.IcosahedronGeometry(r, detail);
const plane = (w, h) => new THREE.PlaneGeometry(w, h);

function composeMatrix({ at = [0, 0, 0], rotation = [0, 0, 0], scale = [1, 1, 1] } = {}) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...at),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),
    new THREE.Vector3(...scale),
  );
}

function worldBoundsOf(geometry, matrix) {
  const g = geometry.clone().applyMatrix4(matrix);
  g.computeBoundingBox();
  return { min: g.boundingBox.min.toArray(), max: g.boundingBox.max.toArray() };
}

function makeModelPart(id, rootNodes, fragSpecs) {
  const fragmentGeometry = new Map();
  const rawGeometryByFragId = new Map();
  for (const [fragIdKey, spec] of Object.entries(fragSpecs)) {
    const fragId = Number(fragIdKey);
    const matrix = spec.matrixArray ? new THREE.Matrix4().fromArray(spec.matrixArray) : composeMatrix(spec);
    fragmentGeometry.set(fragId, {
      geometryIndex: spec.geometryIndex,
      matrix: matrix.toArray(),
      bounds: spec.bounds || worldBoundsOf(spec.geometry, matrix),
    });
    rawGeometryByFragId.set(fragId, spec.geometry);
  }
  const { model: baseModel } = buildMockModel(rootNodes, fragmentGeometry);
  const model = { ...baseModel, id, getUnitScale: () => 1 };
  return { model, rawGeometryByFragId };
}

function makeScene(parts) {
  const built = parts.map(({ id, rootNodes, frags }) => makeModelPart(id, rootNodes, frags));
  const viewer = {
    impl: {
      getRenderProxy(queriedModel, fragId) {
        const part = built.find((p) => p.model === queriedModel);
        if (!part) throw new Error('getRenderProxy called with an unknown model');
        const geometry = part.rawGeometryByFragId.get(fragId);
        return geometry ? { geometry } : null;
      },
    },
  };
  return { models: built.map((p) => p.model), viewer };
}

// ---- scenario definitions (all operands rigid x positive uniform scale unless noted) -----------

const REFLECTED_UNIFORM = composeMatrix({ at: [2.5, 0, 0], scale: [-1, 1, 1] }).toArray();
const REFLECTED_ANISOTROPIC = composeMatrix({ at: [2.5, 0, 0], scale: [-1, 2, 1] }).toArray();

function oneModel(frags, rootNodes) { return [{ id: 1, rootNodes, frags }]; }

export const FIND_CLASHES_SCENARIOS = [
  {
    name: 'near-miss same-model linear',
    parts: oneModel(
      { 100: { geometryIndex: 0, geometry: box(2, 2, 2) }, 200: { geometryIndex: 1, geometry: box(2, 2, 2), at: [2.5, 0, 0] } },
      [{ dbId: 1, children: [{ dbId: 10, fragments: [100] }, { dbId: 20, fragments: [200] }] }],
    ),
    queries: [{ source: [0, [10]], target: [0, [20]], clearance: 1, broadPhase: 'linear' }],
  },
  {
    name: 'multi-fragment dbId minimum wins',
    parts: oneModel(
      {
        200: { geometryIndex: 0, geometry: box(2, 2, 2), at: [10, 0, 0] },
        100: { geometryIndex: 1, geometry: box(2, 2, 2), at: [7.2, 0, 0] },
        101: { geometryIndex: 2, geometry: box(2, 2, 2), at: [7.7, 0, 0] },
      },
      [{ dbId: 1, children: [{ dbId: 10, fragments: [100, 101] }, { dbId: 20, fragments: [200] }] }],
    ),
    queries: [{ source: [0, [10]], target: [0, [20]], clearance: 1, broadPhase: 'linear' }],
  },
  {
    name: 'pure hard clash excluded',
    parts: oneModel(
      { 100: { geometryIndex: 0, geometry: box(2, 2, 2) }, 200: { geometryIndex: 1, geometry: box(2, 2, 2), at: [1, 0, 0] } },
      [{ dbId: 1, children: [{ dbId: 10, fragments: [100] }, { dbId: 20, fragments: [200] }] }],
    ),
    queries: [{ source: [0, [10]], target: [0, [20]], clearance: 5, broadPhase: 'linear' }],
  },
  {
    name: 'federated scene linear and tlas',
    parts: [
      { id: 1, rootNodes: [{ dbId: 1, fragments: [100] }], frags: { 100: { geometryIndex: 0, geometry: box(2, 2, 2) } } },
      {
        id: 2,
        rootNodes: [
          { dbId: 1, fragments: [200] }, { dbId: 2, fragments: [201] }, { dbId: 3, fragments: [202] },
          { dbId: 4, fragments: [203] }, { dbId: 5, fragments: [204] },
        ],
        frags: {
          200: { geometryIndex: 0, geometry: box(2, 2, 2), at: [2.5, 0, 0] },
          201: { geometryIndex: 1, geometry: box(2, 2, 2), at: [-2.5, 0, 0] },
          202: { geometryIndex: 2, geometry: box(2, 2, 2), at: [0.5, 0, 0] },
          203: { geometryIndex: 3, geometry: box(2, 2, 2), at: [100, 0, 0] },
          204: { geometryIndex: 4, geometry: box(2, 2, 2), at: [4.5, 4.5, 0] },
        },
      },
    ],
    queries: [
      { source: [0, [1]], targets: [[1]], clearance: 3, broadPhase: 'linear' },
      { source: [0, [1]], targets: [[1]], clearance: 3, broadPhase: 'tlas' },
    ],
  },
  {
    name: 'legacy target shape linear and tlas',
    parts: oneModel(
      {
        100: { geometryIndex: 0, geometry: box(2, 2, 2) },
        200: { geometryIndex: 1, geometry: box(2, 2, 2), at: [2.5, 0, 0] },
        300: { geometryIndex: 2, geometry: box(2, 2, 2), at: [100, 0, 0] },
      },
      [{ dbId: 1, children: [{ dbId: 10, fragments: [100] }, { dbId: 20, fragments: [200] }, { dbId: 30, fragments: [300] }] }],
    ),
    queries: [
      { source: [0, [10]], target: [0, [20, 30]], clearance: 1, broadPhase: 'linear' },
      { source: [0, [10]], target: [0, [20, 30]], clearance: 1, broadPhase: 'tlas' },
    ],
  },
  {
    name: 'rotated uniformly-scaled operands (legacy uniform class)',
    parts: oneModel(
      {
        100: { geometryIndex: 0, geometry: box(1, 1, 1), scale: [2, 2, 2], rotation: [0, 0, Math.PI / 6] },
        200: { geometryIndex: 1, geometry: box(2, 2, 2), at: [3.4, 0.3, 0.1], rotation: [0.2, 0.4, 0.1], scale: [0.75, 0.75, 0.75] },
        300: { geometryIndex: 2, geometry: sphere(1), at: [-3, 0.5, 0], scale: [1.5, 1.5, 1.5] },
      },
      [{ dbId: 1, children: [{ dbId: 10, fragments: [100] }, { dbId: 20, fragments: [200] }, { dbId: 30, fragments: [300] }] }],
    ),
    queries: [
      { source: [0, [10]], target: [0, [20, 30]], clearance: 2, broadPhase: 'linear' },
      { source: [0, [10]], target: [0, [20, 30]], clearance: 2, broadPhase: 'tlas' },
    ],
  },
  {
    name: 'mixed small/large uniform scales (anchor rule)',
    parts: oneModel(
      {
        100: { geometryIndex: 0, geometry: sphere(1, 2), scale: [0.25, 0.25, 0.25] },
        200: { geometryIndex: 1, geometry: box(1, 1, 1), at: [2.2, 0.1, -0.2], scale: [3, 3, 3], rotation: [0, 0.3, 0] },
      },
      [{ dbId: 1, children: [{ dbId: 10, fragments: [100] }, { dbId: 20, fragments: [200] }] }],
    ),
    queries: [
      { source: [0, [10]], target: [0, [20]], clearance: 1.5, broadPhase: 'linear' },
      { source: [0, [20]], target: [0, [10]], clearance: 1.5, broadPhase: 'linear' },
    ],
  },
  {
    name: 'beyond threshold after broad phase (diagonal sphere)',
    parts: oneModel(
      { 100: { geometryIndex: 0, geometry: box(2, 2, 2) }, 200: { geometryIndex: 1, geometry: sphere(1, 2), at: [2.2, 2.2, 0] } },
      [{ dbId: 1, children: [{ dbId: 10, fragments: [100] }, { dbId: 20, fragments: [200] }] }],
    ),
    queries: [{ source: [0, [10]], target: [0, [20]], clearance: 0.5, broadPhase: 'linear' }],
  },
  {
    name: 'open plane near a box',
    parts: oneModel(
      { 100: { geometryIndex: 0, geometry: box(2, 2, 2) }, 200: { geometryIndex: 1, geometry: plane(3, 3), at: [0, 0, 1.4] } },
      [{ dbId: 1, children: [{ dbId: 10, fragments: [100] }, { dbId: 20, fragments: [200] }] }],
    ),
    queries: [{ source: [0, [10]], target: [0, [20]], clearance: 1, broadPhase: 'linear' }],
  },
  {
    name: 'reflected operands stay diagnosed unsupported (owner decision O-1)',
    parts: oneModel(
      {
        100: { geometryIndex: 0, geometry: box(2, 2, 2) },
        200: { geometryIndex: 1, geometry: box(2, 2, 2), matrixArray: REFLECTED_UNIFORM },
        300: { geometryIndex: 2, geometry: box(2, 2, 2), matrixArray: REFLECTED_ANISOTROPIC },
      },
      [{ dbId: 1, children: [{ dbId: 10, fragments: [100] }, { dbId: 20, fragments: [200] }, { dbId: 30, fragments: [300] }] }],
    ),
    queries: [{ source: [0, [10]], target: [0, [20, 30]], clearance: 1, broadPhase: 'linear' }],
  },
];

// Direct `clearanceQuery` fixtures (the pure query, below findClashes).
export const DIRECT_QUERY_SCENARIOS = [
  { name: 'boxes gap 0.5', a: { geometry: box(2, 2, 2) }, b: { geometry: box(2, 2, 2), at: [2.5, 0, 0] }, clearance: 1 },
  {
    name: 'rotated uniform scales',
    a: { geometry: box(1, 1, 1), scale: [2, 2, 2], rotation: [0.1, 0.2, 0.3] },
    b: { geometry: sphere(1, 2), at: [2.8, 0.4, -0.1], scale: [0.6, 0.6, 0.6] },
    clearance: 2,
  },
  { name: 'beyond clearance', a: { geometry: box(2, 2, 2) }, b: { geometry: box(2, 2, 2), at: [4, 0, 0] }, clearance: 1.5 },
  { name: 'touching below tolerance floor', a: { geometry: box(2, 2, 2) }, b: { geometry: box(2, 2, 2), at: [2, 0, 0] }, clearance: 1 },
];

// ---- runners -----------------------------------------------------------------------------------

function pairOut(p) {
  return {
    source: { modelId: p.source.modelId, dbId: p.source.dbId },
    target: { modelId: p.target.modelId, dbId: p.target.dbId },
    type: p.type, distance: p.distance, clearance: p.clearance, witness: p.witness,
  };
}

function statisticsOut(statistics) {
  const out = {};
  for (const key of Object.keys(statistics).sort()) {
    if (key === 'diagnostics' || /Ms$/.test(key)) continue; // timings are not part of the result
    out[key] = statistics[key];
  }
  return out;
}

export async function runFindClashesScenario(scenario) {
  const { models, viewer } = makeScene(scenario.parts);
  const world = await CollisionWorld.fromViewer(viewer, { narrowPhase: 'three-mesh-bvh', indexOwnership: 'clone', now: () => 0 });
  const results = [];
  for (const q of scenario.queries) {
    const query = {
      source: { model: models[q.source[0]], dbIds: q.source[1] },
      target: q.targets
        ? { targets: q.targets.map(([i]) => ({ model: models[i] })) }
        : { model: models[q.target[0]], dbIds: q.target[1] },
      mode: 'clearance', clearance: q.clearance, groupBy: 'dbId', broadPhase: q.broadPhase,
    };
    const { pairs, statistics } = await world.findClashes(query);
    results.push({ pairs: pairs.map(pairOut), statistics: statisticsOut(statistics), diagnostics: statistics.diagnostics });
  }
  return results;
}

function directInstance(spec) {
  const view = adaptViewerGeometry(spec.geometry);
  const built = build(compactAndWeld(view, { weldEpsilon: 1e-4 }));
  return { geometry: built.geometry, bvh: built.bvh, localDiagonal: built.localDiagonal, matrix: composeMatrix(spec) };
}

export function runDirectQueryScenario(scenario) {
  const a = directInstance(scenario.a);
  const b = directInstance(scenario.b);
  const sa = validateUniformScale(a.matrix);
  const sb = validateUniformScale(b.matrix);
  const toleranceFloor = computeToleranceFloor(
    { localDiagonal: a.localDiagonal, scaleFactor: sa.scaleFactor },
    { localDiagonal: b.localDiagonal, scaleFactor: sb.scaleFactor },
    surfaceEpsilonFactor,
  );
  return { toleranceFloor, result: clearanceQuery(a, b, { clearance: scenario.clearance, toleranceFloor }) };
}

export async function runAllGoldenScenarios() {
  const findClashes = {};
  for (const scenario of FIND_CLASHES_SCENARIOS) findClashes[scenario.name] = await runFindClashesScenario(scenario);
  const directQuery = {};
  for (const scenario of DIRECT_QUERY_SCENARIOS) directQuery[scenario.name] = runDirectQueryScenario(scenario);
  return { findClashes, directQuery };
}

// ---- exact (bit-preserving) JSON encoding -------------------------------------------------------
// JSON number text round-trips every finite double exactly; only -0 / NaN / +-Infinity need tagging.

export function encodeExact(value) {
  if (typeof value === 'number') {
    if (Object.is(value, -0)) return { $num: '-0' };
    if (!Number.isFinite(value)) return { $num: String(value) };
    return value;
  }
  if (Array.isArray(value)) return value.map(encodeExact);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = encodeExact(v);
    return out;
  }
  return value;
}

export function decodeExact(value) {
  if (Array.isArray(value)) return value.map(decodeExact);
  if (value && typeof value === 'object') {
    if (Object.keys(value).length === 1 && typeof value.$num === 'string') return Number(value.$num);
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = decodeExact(v);
    return out;
  }
  return value;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const golden = await runAllGoldenScenarios();
  writeFileSync(GOLDEN_PATH, `${JSON.stringify(encodeExact(golden), null, 1)}\n`);
  console.log(`wrote ${GOLDEN_PATH}`);
}
