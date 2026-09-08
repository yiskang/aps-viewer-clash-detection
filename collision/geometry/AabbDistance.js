/**
 * Exact, unpadded AABB-to-AABB minimum-distance lower bound, in world units. Every collision surface
 * is entirely contained within its own AABB, so this is a valid, conservative necessary condition for
 * "true surface-to-surface distance <= threshold" — no true positive is ever missed. Reused verbatim
 * by the clearance linear oracle, the TLAS post-candidate exact retest, and the Hard-Clash-precheck
 * branch decision — by design the *same* predicate at all three call sites.
 */
export function aabbMinDistance(boundsA, boundsB) {
  let dx = 0, dy = 0, dz = 0;
  if (boundsA.max[0] < boundsB.min[0]) dx = boundsB.min[0] - boundsA.max[0];
  else if (boundsB.max[0] < boundsA.min[0]) dx = boundsA.min[0] - boundsB.max[0];
  if (boundsA.max[1] < boundsB.min[1]) dy = boundsB.min[1] - boundsA.max[1];
  else if (boundsB.max[1] < boundsA.min[1]) dy = boundsA.min[1] - boundsB.max[1];
  if (boundsA.max[2] < boundsB.min[2]) dz = boundsB.min[2] - boundsA.max[2];
  else if (boundsB.max[2] < boundsA.min[2]) dz = boundsA.min[2] - boundsB.max[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
