// test/clashtest/support/realWorldFixture.mjs
//
// P4 File structure row: `makeTwoModelFixture` / `box` for the T2 tests (a real `CollisionWorld`
// exercised end-to-end through `LocalUnitExecutor`). COPIED from
// `test/CollisionWorld.findClashes.crossModel.test.mjs`'s own fixture plumbing, not imported across
// the collision/clashtest test trees (P4 ships before P7, whose own `support/realWorld.mjs` this is
// deliberately distinct from -- see the plan's File structure row for `realWorldFixture.mjs` and its
// checked reconciliation against duplicate-ownership decisions D1-D4). Only what P4's T2 tests need
// is copied: `makeTwoModelFixture` and `box`, plus their private plumbing. The collision test file's
// own `openBox` / `freshWorld` / `frozenClock` / `OPTIONS` helpers are not needed here -- P4's T2
// tests build the `CollisionWorld` themselves via `CollisionWorld.fromViewer`.
import * as THREE from 'three';
import { buildMockModel } from '../../fixtures/mockInstanceTree.mjs';

function boundsOf(geometry, [x, y, z]) {
  const g = geometry.clone().applyMatrix4(new THREE.Matrix4().makeTranslation(x, y, z));
  g.computeBoundingBox();
  return { min: g.boundingBox.min.toArray(), max: g.boundingBox.max.toArray() };
}

const translationMatrix = ([x, y, z]) => new THREE.Matrix4().makeTranslation(x, y, z).toArray();

/**
 * Builds ONE model (with a fresh, fully independent instance tree / fragment list) plus the raw
 * per-fragment geometry map `makeTwoModelFixture`'s shared viewer needs to serve THIS model's own
 * fragments.
 */
function makeModelPart(id, rootNodes, fragSpecs = {}, modelOptions = {}) {
  const fragmentGeometry = new Map();
  const rawGeometryByFragId = new Map();
  for (const [fragIdKey, spec] of Object.entries(fragSpecs)) {
    const fragId = Number(fragIdKey);
    const at = spec.at || [0, 0, 0];
    fragmentGeometry.set(fragId, {
      geometryIndex: spec.geometryIndex,
      matrix: translationMatrix(at),
      bounds: spec.bounds || (spec.geometry ? boundsOf(spec.geometry, at) : { min: at, max: at }),
    });
    if (spec.geometry) rawGeometryByFragId.set(fragId, spec.geometry);
  }
  const { model: baseModel, stats } = buildMockModel(rootNodes, fragmentGeometry, modelOptions);
  const model = { ...baseModel, id, getUnitScale: () => 1 };
  return { model, rawGeometryByFragId, stats };
}

/**
 * @param {Object} [opts]
 * @param {Array} [opts.rootNodesA]  modelA's tree, default a trivial single dbId with no fragments.
 * @param {Object} [opts.fragSpecsA]
 * @param {Object} [opts.modelOptionsA]
 * @param {Array} [opts.rootNodesB]
 * @param {Object} [opts.fragSpecsB]
 * @param {Object} [opts.modelOptionsB]
 * @returns {{modelA, modelB, viewer, statsA, statsB}}
 */
export function makeTwoModelFixture(opts = {}) {
  const {
    rootNodesA = [{ dbId: 1, fragments: [] }],
    fragSpecsA = {},
    modelOptionsA = {},
    rootNodesB = [{ dbId: 1, fragments: [] }],
    fragSpecsB = {},
    modelOptionsB = {},
  } = opts;
  const a = makeModelPart(1, rootNodesA, fragSpecsA, modelOptionsA);
  const b = makeModelPart(2, rootNodesB, fragSpecsB, modelOptionsB);

  // ONE shared viewer.impl.getRenderProxy -- CollisionWorld has exactly one `_viewer` reference (set
  // once by fromViewer), so a cross-model fixture needs one viewer object able to serve BOTH models'
  // fake render proxies, dispatching by model IDENTITY.
  const viewer = {
    impl: {
      getRenderProxy(queriedModel, fragId) {
        let part;
        if (queriedModel === a.model) part = a;
        else if (queriedModel === b.model) part = b;
        else throw new Error('getRenderProxy called with a Model object neither fixture model produced');
        const geometry = part.rawGeometryByFragId.get(fragId);
        return geometry ? { geometry } : null;
      },
    },
  };
  return {
    modelA: a.model, modelB: b.model, viewer, statsA: a.stats, statsB: b.stats,
  };
}

export const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
