// clashtest/viewer/populationScan.js
// The population `extractAllFragments` enumerates, INCLUDING its two dropped classes (spec 6.2.1, F17):
// N = fragList.isNotLoaded (checked BEFORE the owner lookup), U = getDbIds undefined or an array,
// L = loaded with a numeric owner and a geometry id. Dense: records[fragId] for every fragId in 0..count-1.
// An N record whose geometry id is INVALID_GEOM_ID (0) additionally carries `nullGeometry: true` (owner-authorized,
// 2026-10-07): the library reports it as the informational `fragment-null-geometry`, not `fragment-not-loaded`.
import { maxCollisionInstancesPerEpoch } from '../../collision/constants.js';
import { CapacityExceededError } from '../../collision/errors.js';
import { EnumerationInconsistencyError } from './errors.js';
import { CHECK_EVERY, checkpointNow } from './checkpoint.js';

const INVALID_GEOM_ID = 0; // the Viewer's reserved "no geometry" id; mirrors collision/viewer/ViewerModelAdapter.js

export async function scanPopulation(fragList, ctx, { loadEpoch } = {}) {
  const count = fragList.getCount();
  if (!Number.isSafeInteger(count) || count < 0) throw new EnumerationInconsistencyError('fragment-count-invalid', { count });
  // spec 6.2.1 "Cost": above the library's own per-epoch ceiling enumeration fails, matching `whole-model-enumeration`.
  if (count > maxCollisionInstancesPerEpoch) {
    throw new CapacityExceededError('whole-model-enumeration', { loadEpoch, requested: count, limit: maxCollisionInstancesPerEpoch });
  }
  const records = new Array(count);
  for (let fragId = 0; fragId < count; fragId++) {
    if (fragList.isNotLoaded(fragId)) {
      // Same discriminator as the library's extractAllFragments (geometry id === INVALID_GEOM_ID, 0):
      // an intentionally omitted null-geometry fragment keeps the digest class 'N' (population/scope
      // digests stay byte-identical -- scopeDigest.js reads only fragId/cls for an N record) but is
      // flagged so the whole-model unreachable accounting can treat it as informational, not as an
      // unattributable (completeness-affecting) fragment.
      records[fragId] = fragList.getGeometryId(fragId) === INVALID_GEOM_ID
        ? { fragId, cls: 'N', nullGeometry: true }
        : { fragId, cls: 'N' };
    } else {
      const owner = fragList.getDbIds(fragId);
      if (owner === undefined || Array.isArray(owner)) records[fragId] = { fragId, cls: 'U' };
      else if (typeof owner !== 'number') throw new EnumerationInconsistencyError('owner-not-a-number', { fragId, type: typeof owner });
      else records[fragId] = { fragId, cls: 'L', ownerDbId: owner, geometryId: fragList.getGeometryId(fragId) };
    }
    if ((fragId + 1) % CHECK_EVERY === 0) { const p = checkpointNow(ctx); if (p) await p; }
  }
  return { count, records };
}
