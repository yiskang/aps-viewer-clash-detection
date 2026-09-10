// test/performance/m4/s2t-bystander-layout.mjs
//
// M4 Task 3.4: pure construction rules for S2T's synthetic bystander population (§5.3.1 points
// 3-4). The facade itself (a test-local object delegating Viewer surface calls to the real
// Architecture model for real fragments, and to this layout for synthetic ones) is live-only and
// lives in browser-probes-m4.mjs (this task's live half) -- it cannot be unit-tested without a
// real Viewer/Model object.

// §5.3.1's four population levels: 5,435 (baseline, real fragment count, zero bystanders) /
// 10,000 / 15,000 / 20,000 admitted Architecture instances.
export const S2T_LEVELS = [5435, 10000, 15000, 20000];

// §5.3.1 point 3: synthetic ids occupy a disjoint range strictly above the real model's own
// measured maximum (never overlapping -- a collision would let a real candidate resolve through
// a synthetic fragment, a silent correctness corruption, not a measurement error).
export function syntheticIdRangeAbove(realMeasuredMax) {
  return realMeasuredMax + 1;
}

// §5.3.1 point 4: bystander layout is deterministic, dispersed, nested, and recorded verbatim.
// Every bystander AABB lies outside the source's query region at every level; a single shared
// far AABB is forbidden (a degenerate BVH artifact). Nested: layout(N) is always a PREFIX of
// layout(M) for N < M, so larger levels retain the exact smaller-level prefix.
export function bystanderLayout(count, { farOffset = 1_000_000, spreadStep = 5, syntheticFragmentIdStart, syntheticGeometryIdStart }) {
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push({
      fragmentId: syntheticFragmentIdStart + i,
      geometryId: syntheticGeometryIdStart + i,
      position: [
        farOffset + (i % 100) * spreadStep,
        farOffset + (Math.floor(i / 100) % 100) * spreadStep,
        farOffset + Math.floor(i / 10_000) * spreadStep,
      ],
    });
  }
  return out;
}
