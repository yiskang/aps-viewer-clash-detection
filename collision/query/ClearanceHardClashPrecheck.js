import { aabbMinDistance } from '../geometry/AabbDistance.js';
import { volumeOverlapQuery } from './VolumeOverlapQuery.js';

/**
 * Tri-state Hard-Clash exclusion precheck for a clearance candidate pair. Never collapses to boolean:
 * an inconclusive volumeOverlapQuery result must never be treated as "proven no overlap".
 *
 * @param {object} volumeOverlapOptions - {scheduler, compareCanonical}, threaded through to
 *   volumeOverlapQuery unchanged. Omit/pass {} to use volumeOverlapQuery's own defaults (standalone
 *   unit-test convenience only -- CollisionWorld always supplies the real call-scoped values).
 * @returns {
 *   {status: 'skip-precheck'} | {status: 'excluded'} | {status: 'proceed'} |
 *   {status: 'inconclusive', diagnostic: object}
 * }
 */
export async function classifyHardClashPrecheck(
  sourceInstance, targetInstance, sourceWorldBounds, targetWorldBounds, volumeOverlapOptions = {},
) {
  if (aabbMinDistance(sourceWorldBounds, targetWorldBounds) > 0) {
    return { status: 'skip-precheck' };
  }

  const overlapResult = await volumeOverlapQuery(sourceInstance, targetInstance, volumeOverlapOptions);

  if (overlapResult.overlap === true) {
    return { status: 'excluded' };
  }
  // overlapResult.overlap === false here. `conclusive` (Task 6) is the single authoritative signal --
  // never re-derive it from a diagnostic-reason allowlist.
  if (!overlapResult.conclusive) {
    return { status: 'inconclusive', diagnostic: { reason: 'clearance-hard-clash-precheck-inconclusive' } };
  }
  return { status: 'proceed' };
}
