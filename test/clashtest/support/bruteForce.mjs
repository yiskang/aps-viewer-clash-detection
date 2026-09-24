// test/clashtest/support/bruteForce.mjs
//
// P7 (Task P7.8): the per-pair differential reference. One `findClashes` per (source owner dbId,
// target model) against the SAME real `CollisionWorld` the engine ran on, unioned into canonical
// PairId keys.
import { makePairId, makeElementRef } from '../../../clashtest/identity/ids.js';
import { canonicalJson } from '../../../clashtest/util/canonical.js';

// A `PairId` is the closed frozen record {first, second} (P1) -- it carries no string key of its own,
// so the suite compares canonical JSON rather than inventing a second encoding. Named `pairIdKey`,
// not `pairKey`: P3's `bruteForcePairs.mjs` exports `pairKey(first, second, ordered)`, and two
// same-named star exports in the support barrel would be silently dropped as ambiguous.
export const pairIdKey = (pairId) => canonicalJson(pairId);

/**
 * @param {{world: object, modelFor: (modelKey: string) => object}} fx  the `makeRealWorldFixture`
 *   façade (`modelFor` is the fixture's lookup, not a `CollisionWorld` method)
 * @param {object} args
 * @param {Array<[string, number]>} args.sources  [modelKey, owner dbId], one library call each
 * @param {Array<[string, number[] | null]>} args.targets  [modelKey, dbIds | null]; null = the
 *   whole-model sentinel (`dbIds` omitted, §19.2)
 * @param {string} args.mode
 * @param {number} [args.clearance]  sent iff `mode === 'clearance'`
 * @param {'tlas'|'linear'} [args.broadPhase='tlas']
 * @returns {Promise<{pairIds: string[], calls: number}>} sorted, distinct `pairIdKey`s
 */
export async function bruteForceReference(fx, { sources, targets, mode, clearance, broadPhase = 'tlas' }) {
  const pairIds = new Set();
  let calls = 0;
  for (const [sourceKey, sourceDbId] of sources) {
    for (const [targetKey, targetDbIds] of targets) {
      const query = {
        source: { model: fx.modelFor(sourceKey), dbIds: [sourceDbId] },
        target: { targets: [targetDbIds === null
          ? { model: fx.modelFor(targetKey) }                    // whole-model sentinel
          : { model: fx.modelFor(targetKey), dbIds: targetDbIds }] },
        mode, groupBy: 'dbId', broadPhase,
        ...(mode === 'clearance' ? { clearance } : {}),
      };
      calls++;
      const { pairs } = await fx.world.findClashes(query);
      for (const p of pairs) {
        // makePairId is arity 3, MODE FIRST (N13). It derives the ordered/unordered semantics itself
        // from `mode`, so nothing here computes or forwards that value (§4.5: "derived, never supplied").
        pairIds.add(pairIdKey(makePairId(
          mode,
          makeElementRef(sourceKey, p.source.dbId),
          makeElementRef(targetKey, p.target.dbId),
        )));
      }
    }
  }
  return { pairIds: [...pairIds].sort(), calls };
}
