// SPIKE — runs the fixtures the spec names, including every regression case the
// six review rounds produced. Prints PASS/FAIL per case; exits nonzero on failure.

import {
  THREE, classifyPoint, properCrossing, connectivity, volumeOverlap, instance,
  containment, surfaceIntersection,
} from './geometry-core.mjs';

let passes = 0, failures = 0;
const results = [];

function check(name, actual, expected, note = '') {
  const ok = actual === expected;
  ok ? passes++ : failures++;
  results.push({ ok, name, actual, expected, note });
  console.log(
    `${ok ? '  PASS' : '  FAIL'}  ${name}\n` +
    `        expected=${expected} actual=${actual}${note ? `  (${note})` : ''}`
  );
}

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const at = (x, y, z) => new THREE.Matrix4().makeTranslation(x, y, z);

console.log('\n=== classifyPoint: three-valued classification ===');
{
  const b = instance(box(2, 2, 2));
  check('point at centre', classifyPoint(new THREE.Vector3(0, 0, 0), b.bvh, b.L), 'inside');
  check('point far outside', classifyPoint(new THREE.Vector3(5, 0, 0), b.bvh, b.L), 'outside');

  // ROUND 4 REGRESSION: a point on the interior of a face must be `boundary`,
  // not `inside`. This is what re-promoted face contact to volume-overlap.
  check(
    'point ON face interior', classifyPoint(new THREE.Vector3(0, 1, 0), b.bvh, b.L), 'boundary',
    'round-4 regression: was classified inside'
  );
  check('point ON edge', classifyPoint(new THREE.Vector3(1, 1, 0), b.bvh, b.L), 'boundary');
  check('point ON vertex', classifyPoint(new THREE.Vector3(1, 1, 1), b.bvh, b.L), 'boundary');
}

console.log('\n=== classifyPoint: even-odd solid model (round 6) ===');
{
  // Two nested closed shells in ONE geometry. Declared model says a point inside
  // both reads `outside` — correct for a hollow pipe/container.
  const outer = box(4, 4, 4);
  const inner = box(2, 2, 2);
  const merged = mergeGeometries([outer, inner]);
  const m = instance(merged);

  check(
    'point inside BOTH nested shells', classifyPoint(new THREE.Vector3(0, 0, 0), m.bvh, m.L),
    'outside', 'even-odd: correct for a hollow container, stated limit for nested solids'
  );
  check(
    'point between the two shells', classifyPoint(new THREE.Vector3(1.5, 0, 0), m.bvh, m.L),
    'inside', 'the material region'
  );
}

console.log('\n=== GeometryConnectivity: edge-based, manifold detection ===');
{
  const single = connectivity(instance(box(1, 1, 1)).geometry);
  check('closed box: component count', single.componentCount, 1);
  check('closed box: closedManifold', single.closedManifold, true);

  const two = connectivity(instance(mergeGeometries([
    box(1, 1, 1), box(1, 1, 1).translate(10, 0, 0),
  ])).geometry);
  check('two disjoint boxes: components', two.componentCount, 2);

  const open = new THREE.BufferGeometry();
  open.setAttribute('position', new THREE.Float32BufferAttribute(
    [0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  open.setIndex([0, 1, 2]);
  const openConn = connectivity(open);
  check('single open triangle: closedManifold', openConn.closedManifold, false,
    '3 boundary edges');
}

console.log('\n=== volume-overlap: the headline behaviours ===');
{
  // ROUND 3 HEADLINE: pure face contact is NOT volume overlap. The CSG code this
  // replaces excluded it (a BSP intersect of face-touching solids yields no polygons).
  const a = instance(box(2, 2, 2));
  const b = instance(box(2, 2, 2), at(0, 2, 0)); // resting exactly on top
  const r = volumeOverlap(a, b);
  check('flush face-to-face touching', r.overlap, false,
    'round-3 headline: touching must not be overlap');

  const sep = volumeOverlap(instance(box(2, 2, 2)), instance(box(2, 2, 2), at(10, 0, 0)));
  check('clearly separated', sep.overlap, false);

  const pen = volumeOverlap(instance(box(2, 2, 2)), instance(box(2, 2, 2), at(1, 0, 0)));
  check('genuine interpenetration', pen.overlap, true);

  const contained = volumeOverlap(instance(box(1, 1, 1)), instance(box(6, 6, 6)));
  check('small solid fully inside large', contained.overlap, true);
}

console.log('\n=== volume-overlap: duct through beam (round 2 regression) ===');
{
  // Two thin perpendicular boxes crossing mid-span. NEITHER has a vertex inside
  // the other, so pure vertex sampling cannot detect this at any sample count.
  const duct = instance(box(20, 0.4, 0.4));
  const beam = instance(box(0.4, 0.4, 20), at(0, 0, 0));
  const r = volumeOverlap(duct, beam);
  check('perpendicular thin boxes crossing', r.overlap, true,
    'round-2 regression: needs the crossing test, vertex sampling alone fails');
}

console.log('\n=== volume-overlap: torus hole (round 1 regression) ===');
{
  // A bbox-centre approach reported overlap here: the torus centre sits in its hole.
  const torus = instance(new THREE.TorusGeometry(3, 0.6, 12, 32));
  const bead = instance(box(0.5, 0.5, 0.5));
  const r = volumeOverlap(torus, bead);
  check('small solid in torus hole', r.overlap, false,
    'round-1 regression: bbox-centre reported a false positive');
}

console.log('\n=== volume-overlap: open component (round 6 regression) ===');
{
  // An open triangle has ZERO volume so cannot overlap anything, but its vertices
  // classify inside. Must report the containment AND flag it as unverified.
  const tri = new THREE.BufferGeometry();
  tri.setAttribute('position', new THREE.Float32BufferAttribute(
    [-0.5, 0, 0, 0.5, 0, 0, 0, 0.5, 0], 3));
  tri.setIndex([0, 1, 2]);
  const r = volumeOverlap(instance(tri), instance(box(4, 4, 4)));
  check('open triangle inside closed box: reported', r.overlap, true);
  check('open triangle inside closed box: flagged', r.openComponent === true, true,
    'round-6 regression: was a CLEAN false positive');
}

console.log('\n=== ROUND 7: the diagnostic is mode-scoped, not degeneracy-scoped ===');
{
  // Round 7's draft tried to tell a nearly-closed bathtub apart from a zero-volume
  // sheet by measuring volume, and no threshold in the spec could do it. The fix
  // is the mode split: both take the SAME path, and the mode decides the contract.
  const tri = new THREE.BufferGeometry();
  tri.setAttribute('position', new THREE.Float32BufferAttribute(
    [-0.5, 0, 0, 0.5, 0, 0, 0, 0.5, 0], 3));
  tri.setIndex([0, 1, 2]);

  const room = instance(box(4, 4, 4));

  // The acceptance-model bathtub in miniature: open-bottomed box. Nearly closed
  // (4 boundary edges), definitely not a sheet -- the exact case round 7 could
  // not distinguish and no longer has to.
  const openBox = openBottomedBox(1);
  const ob = connectivity(openBox);
  check('open-bottomed box: not closed', ob.closedManifold, false, `${ob.boundaryEdges} boundary edges`);
  check('open-bottomed box: single component', ob.componentCount, 1);

  for (const [name, g] of [['zero-volume triangle', tri], ['nearly-closed shell', openBox]]) {
    const vo = volumeOverlap(instance(g), room);
    const co = containment(instance(g), room);
    check(`${name}: volume-overlap positive`, vo.overlap, true);
    check(`${name}: volume-overlap DIAGNOSED`, vo.openComponent === true, true,
      'open source cannot certify shared volume');
    check(`${name}: containment positive`, co.contained, true);
    check(`${name}: containment CLEAN`, co.unverifiedTarget === false, true,
      'round-7: asserting ABSENCE is what pins the mode split');
  }
}

console.log('\n=== ROUND 7: an open TARGET taints every result ===');
{
  // Rounds 6 and 7 both named target openness as the thing that breaks parity,
  // then wrote flagging rules that only ever inspected the source. A closed source
  // against an open target came back CLEAN on meaningless parity reads.
  const openTarget = instance(openBottomedBox(4));
  const closedTarget = instance(box(4, 4, 4));

  const inside = instance(box(1, 1, 1));           // arranged positive
  const outside = instance(box(1, 1, 1), at(20, 0, 0)); // arranged negative

  check('closed source in OPEN target: flagged (positive)',
    containment(inside, openTarget).unverifiedTarget, true,
    'round-7 blind spot: was clean');
  check('closed source vs OPEN target: flagged (negative)',
    containment(outside, openTarget).unverifiedTarget, true,
    'a rule firing only on negatives repeats round 5s asymmetry');
  check('closed source in CLOSED target: not flagged',
    containment(inside, closedTarget).unverifiedTarget, false);
  check('volume-overlap inherits the target precondition',
    volumeOverlap(inside, openTarget).unverifiedTarget, true);
}

console.log('\n=== ROUND 7: surface-intersection is bounded ===');
{
  // The spec defined this mode as MeshBVH.intersectsGeometry, which takes no
  // budget and offers no abort hook -- so the same input the crossing budget
  // bounds to ~15ms would freeze the Viewer through this mode instead.
  const a = instance(box(2, 2, 2));
  const b = instance(box(2, 2, 2), at(0, 2, 0)); // flush face contact

  const touch = surfaceIntersection(a, b);
  check('flush touching IS surface intersection', touch.intersects, true,
    'contrast with volume-overlap, which is false on the same input');
  check('separated is not', surfaceIntersection(a, instance(box(2, 2, 2), at(10, 0, 0))).intersects, false);

  // Same interleaved-comb pair the crossing budget fixture uses: heavy leaf
  // overlap, zero triangle intersections. Sharing the input is deliberate -- it
  // fails the moment the two modes stop sharing a traversal.
  const combs = [comb(0), comb(0.05)].map((g) => instance(g));
  const t0 = performance.now();
  const budgeted = surfaceIntersection(combs[0], combs[1], 500);
  const elapsed = performance.now() - t0;
  check('budget exhausted -> aborted', budgeted.aborted, true);
  check('aborted must NOT read as a hit', budgeted.intersects, false,
    'bvhcast returns true on abort; reading it as a hit fabricates a result');
  check('abort is fast', elapsed < 100, true, `${elapsed.toFixed(1)}ms`);
}

console.log('\n=== cost at realistic triangle counts ===');
{
  for (const seg of [16, 32, 48]) {
    const g = new THREE.SphereGeometry(1, seg, seg);
    const tris = g.index.count / 3;
    let t = performance.now();
    const inst = instance(g);
    const buildMs = performance.now() - t;

    const other = instance(new THREE.SphereGeometry(1, seg, seg), at(1.2, 0, 0));
    t = performance.now();
    const r = volumeOverlap(inst, other);
    const queryMs = performance.now() - t;

    console.log(
      `  ${String(tris).padStart(5)} tris/mesh | BVH build ${buildMs.toFixed(1)}ms | ` +
      `overlap query ${queryMs.toFixed(1)}ms | overlap=${r.overlap} | ` +
      `candidates=${r.stats.candidates} intersecting=${r.stats.intersecting} probes=${r.stats.probes}`
    );
  }
}

console.log('\n=== raw candidate volume: overlapping leaves, zero intersections ===');
{
  // Round 6 finding 4: heavy leaf overlap with NO triangle intersections. Nothing
  // bounded this before maxCandidatePairsExamined. Measure how bad it gets.
  const comb = (offset) => {
    const parts = [];
    for (let i = 0; i < 60; i++) {
      parts.push(box(0.02, 4, 0.02).translate(i * 0.1 + offset, 0, 0));
    }
    return mergeGeometries(parts);
  };
  const a = instance(comb(0));
  const b = instance(comb(0.05)); // interleaved, never touching
  const t = performance.now();
  const r = volumeOverlap(a, b);
  const ms = performance.now() - t;
  console.log(
    `  interleaved combs | ${a.geometry.index.count / 3} tris each | ${ms.toFixed(1)}ms | ` +
    `overlap=${r.overlap} | candidate pairs=${r.stats.candidates} ` +
    `intersecting=${r.stats.intersecting}`
  );
  check('interleaved combs do not overlap', r.overlap, false);
}

// ------------------------------------------------------------------- summary

console.log(`\n${'='.repeat(60)}`);
console.log(`  ${passes} passed, ${failures} failed`);
console.log('='.repeat(60));
if (failures) {
  console.log('\nFailures:');
  for (const r of results.filter((x) => !x.ok)) {
    console.log(`  - ${r.name}: expected ${r.expected}, got ${r.actual}`);
  }
}
process.exit(failures ? 1 : 0);

// -------------------------------------------------------------------- utils

// A cube missing its bottom face: 10 triangles, ALREADY welded (shared indices),
// 1 component, exactly 4 boundary edges. The acceptance-model bathtub in miniature
// -- open, but nothing like a zero-volume sheet.
function openBottomedBox(size) {
  const h = size / 2;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([
    -h, -h, -h,   h, -h, -h,   h, -h, h,   -h, -h, h,   // 0..3 bottom ring
    -h,  h, -h,   h,  h, -h,   h,  h, h,   -h,  h, h,   // 4..7 top ring
  ], 3));
  g.setIndex([
    4, 5, 6,  4, 6, 7,   // top
    3, 2, 6,  3, 6, 7,   // +z
    1, 0, 4,  1, 4, 5,   // -z
    2, 1, 5,  2, 5, 6,   // +x
    0, 3, 7,  0, 7, 4,   // -x
                         // bottom deliberately omitted
  ]);
  return g;
}

// Interleaved teeth: heavy BVH-leaf overlap, zero triangle intersections.
function comb(offset, teeth = 60) {
  const parts = [];
  for (let i = 0; i < teeth; i++) {
    parts.push(new THREE.BoxGeometry(0.02, 4, 0.02).translate(i * 0.1 + offset, 0, 0));
  }
  return mergeGeometries(parts);
}

function mergeGeometries(geoms) {
  const positions = [];
  const indices = [];
  let offset = 0;
  for (const g of geoms) {
    const gi = g.index ? g.index.array : [...Array(g.attributes.position.count).keys()];
    const p = g.attributes.position.array;
    positions.push(...p);
    for (const i of gi) indices.push(i + offset);
    offset += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  out.setIndex(indices);
  return out;
}
