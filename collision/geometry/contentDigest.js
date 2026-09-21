// collision/geometry/contentDigest.js
//
// Dependency-free content digest primitive. No imports, no Node-only globals -- this module
// must run unmodified in the browser (collision/ is served raw/unbundled -- see
// ThreeMeshBvhBackend.js's runtime-constraint note on the geometryDigest wiring).

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
// Four independent lanes: distinct starting seeds derived by XORing the standard FNV-1a-32 offset
// basis with four unrelated odd constants, so the four lanes do not degenerate into the same hash.
const LANE_SEEDS = [
  FNV_OFFSET_BASIS,
  FNV_OFFSET_BASIS ^ 0x9e3779b9,
  FNV_OFFSET_BASIS ^ 0x85ebca6b,
  FNV_OFFSET_BASIS ^ 0xc2b2ae35,
];

function toHex8(n) {
  return (n >>> 0).toString(16).padStart(8, '0');
}

/**
 * A dependency-free 128-bit content digest (four independently-seeded FNV-1a-32 lanes over the same
 * byte stream, concatenated). Not cryptographically strong -- this is a collision-AVOIDANCE mechanism
 * against accidental geometry-content ties (design doc §4.3 C-1), not a security boundary. No
 * Node-only globals: this module must run unmodified in the browser (collision/ is served raw --
 * see ThreeMeshBvhBackend.js's own runtime-constraint note).
 * @param {Uint8Array[]} byteViews - concatenated, in order, as the hash input
 * @returns {string} 32 lowercase hex characters (128 bits)
 */
export function computeContentDigest(byteViews) {
  let hex = '';
  for (const seed of LANE_SEEDS) {
    let hash = seed >>> 0;
    for (const view of byteViews) {
      for (let i = 0; i < view.length; i++) {
        hash ^= view[i];
        hash = Math.imul(hash, FNV_PRIME) >>> 0;
      }
    }
    hex += toHex8(hash);
  }
  return hex;
}
