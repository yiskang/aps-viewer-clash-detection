// SPIKE — replaces the spec's guessed budget constants with measured numbers.
// The spec picked maxSyncTriangleCount=20_000, maxCandidatePairsExamined=200_000
// by reasoning, not measurement, and flagged both as needing real data.

import { THREE, instance, volumeOverlap, connectivity, normalizeForCollision } from './geometry-core.mjs';

const ms = (f) => { const t = performance.now(); const r = f(); return [performance.now() - t, r]; };

console.log('\n=== BVH build cost vs triangle count (validates maxSyncTriangleCount) ===');
console.log('  Spec picked 20,000 triangles as the synchronous-build ceiling, unmeasured.\n');
for (const seg of [32, 64, 96, 128, 180]) {
  const g = new THREE.SphereGeometry(1, seg, seg);
  const tris = g.index.count / 3;
  const [buildMs] = ms(() => instance(g));
  const flag = tris >= 20000 ? '  <- at/over spec ceiling' : '';
  console.log(`  ${String(tris).padStart(6)} tris | build ${buildMs.toFixed(1).padStart(6)}ms${flag}`);
}

console.log('\n=== Raw candidate-pair cost (validates maxCandidatePairsExamined) ===');
console.log('  Spec picked 200,000 raw candidates as the abort threshold, unmeasured.');
console.log('  Worst case: heavy BVH-leaf overlap with ZERO triangle intersections.\n');

function comb(teeth, offset) {
  const parts = [];
  for (let i = 0; i < teeth; i++) {
    parts.push(new THREE.BoxGeometry(0.02, 4, 0.02).translate(i * 0.1 + offset, 0, 0));
  }
  const positions = [], indices = [];
  let base = 0;
  for (const p of parts) {
    positions.push(...p.attributes.position.array);
    for (const i of p.index.array) indices.push(i + base);
    base += p.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  out.setIndex(indices);
  return out;
}

let perPair = 0;
for (const teeth of [30, 60, 120, 240]) {
  const a = instance(comb(teeth, 0));
  const b = instance(comb(teeth, 0.05));
  const [t, r] = ms(() => volumeOverlap(a, b));
  perPair = t / r.stats.candidates;
  console.log(
    `  ${String(teeth).padStart(3)} teeth | ${String(a.geometry.index.count / 3).padStart(5)} tris | ` +
    `${t.toFixed(1).padStart(7)}ms | ${String(r.stats.candidates).padStart(8)} candidate pairs | ` +
    `${(t / r.stats.candidates * 1000).toFixed(2)}µs/pair`
  );
}
console.log(`\n  => at ~${(perPair * 1000).toFixed(2)}µs per candidate pair:`);
for (const budget of [50_000, 200_000, 1_000_000]) {
  const est = (perPair * budget).toFixed(0);
  const frames = (perPair * budget / 16.7).toFixed(1);
  const verdict = perPair * budget > 100 ? 'JANK' : 'acceptable';
  console.log(`     budget ${String(budget).padStart(9)} => ~${String(est).padStart(5)}ms blocking (~${frames} frames @60fps)  ${verdict}`);
}

console.log('\n=== Manifoldness: does welding actually rescue real tessellation? ===');
console.log('  The spec called vertex-welding an optional future "repair". The fixtures');
console.log('  showed it is mandatory. How universal is that?\n');

const shapes = {
  Box: new THREE.BoxGeometry(1, 1, 1),
  Sphere: new THREE.SphereGeometry(1, 24, 16),
  Cylinder: new THREE.CylinderGeometry(1, 1, 2, 24),
  Cone: new THREE.ConeGeometry(1, 2, 24),
  Torus: new THREE.TorusGeometry(2, 0.5, 12, 24),
  Plane: new THREE.PlaneGeometry(1, 1),
  Lathe: new THREE.LatheGeometry([new THREE.Vector2(0, -1), new THREE.Vector2(1, 0), new THREE.Vector2(0, 1)], 24),
};

console.log('  shape       | raw verts | welded | components | closed manifold');
console.log('  ' + '-'.repeat(62));
for (const [name, g] of Object.entries(shapes)) {
  const rawVerts = g.attributes.position.count;

  // Unwelded: index-based connectivity straight off the tessellator
  const unweldedGeom = new THREE.BufferGeometry();
  unweldedGeom.setAttribute('position', g.attributes.position.clone());
  unweldedGeom.setIndex(g.index ? g.index.clone() : [...Array(rawVerts).keys()]);
  const unwelded = connectivity(unweldedGeom);

  const welded = normalizeForCollision(g);
  const conn = connectivity(welded);

  console.log(
    `  ${name.padEnd(11)} | ${String(rawVerts).padStart(9)} | ${String(welded.attributes.position.count).padStart(6)} | ` +
    `${String(unwelded.componentCount).padStart(4)} -> ${String(conn.componentCount).padEnd(3)} | ` +
    `${String(unwelded.closedManifold).padStart(5)} -> ${conn.closedManifold}`
  );
}

console.log('\n  (Plane is genuinely open — false is correct there, not a welding failure.)');
console.log('\nNOTE: all synthetic. The load-bearing question — is real Model Derivative');
console.log('tessellation weldable into closed manifolds — needs the acceptance URN.\n');
