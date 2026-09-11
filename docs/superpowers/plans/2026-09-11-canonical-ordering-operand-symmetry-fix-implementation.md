# Canonical Ordering / Operand Symmetry Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove reload-unstable identity (`geometryIndex`) from correctness-bearing geometric
ordering in `collision/`, replacing it with a canonical `volumeOverlapQuery` wrapper over the
directional `properCrossingQuery` kernel, so semantic clash/clearance results become deterministic
across Viewer reloads, TLAS/linear arms, and operand order — then return the branch to a valid M4
Phase 3 canonical checkpoint.

**Architecture:** `properCrossingQuery` becomes a documented **directional kernel** with no symmetry
contract. `volumeOverlapQuery` becomes the **canonical wrapper**: it ranks the two operands by a
total geometric order (`orientForCrossing`: world-space diagonal → triangle count → vertex count →
world-matrix elements → cached geometry-content digest → public role) and always hands the kernel
the same physical operand as `A`. `comparePlacedCanonically` is renamed `compareAggregationIdentity`,
loses its `geometryIndex` term, and survives only as a narrow dbId-level tie-break. The coplanarity
epsilon is tightened to a symmetric `min`. A hard **Phase B′ recalibration checkpoint** gates the
already-landed ProperCrossing deterministic-budget fix's validation, which was previously confounded
by this same defect.

**Tech Stack:** Node.js (`node --test`), `three-mesh-bvh`, Playwright (`test/performance/run-gate-m4.mjs`),
no new npm dependencies — the one new primitive this plan introduces (a cached geometry-content
digest) uses Node's built-in `node:crypto`.

**Spec:** `docs/superpowers/specs/2026-09-11-canonical-ordering-operand-symmetry-fix-design.md`
(primary). Also load-bearing: `docs/research/m4-effect-b-precheck-diagnostic-nondeterminism-investigation.md`,
`docs/superpowers/specs/2026-09-11-proper-crossing-query-deterministic-budget-fix-design.md`,
`docs/superpowers/specs/2026-09-08-collision-library-milestone4-performance-worker-decision-design.md`
(current M4 design, §6.4 at lines 388-404 — **read-only, never edited**),
`docs/superpowers/plans/2026-09-09-collision-library-milestone4-performance-worker-decision-implementation.md`
(current M4 plan — **read-only except Task 4.5's replica-justification text, P4**).

## Global Constraints

These apply to every task below; do not re-derive them per task.

- **`geometryIndex` is forbidden as correctness-bearing semantic ordering.** Permitted only as a
  runtime cache/lookup key (`GeometryRegistry`, `_representativeFragmentByGeometry`).
- **Runtime identity/cache keys stay separate from semantic geometric ordering.** No `Instance` field
  used for orientation may be an identifier; every field must be geometry- or placement-derived.
- **Canonical ordering lives at the `volumeOverlapQuery` wrapper boundary only.** `properCrossingQuery`
  stays directional and untouched except for the coplanarity-epsilon change in Task A2.3.
- **Aggregation/tie-breaking (`compareAggregationIdentity`) is separate from geometric semantics** and
  reachable only from `compareWitnessCandidates`/`compareClearanceCandidates`, never from a geometric
  call site.
- **Semantic results must be stable across Viewer reloads even when `geometryIndex` changes.**
- **Operand swap must not change symmetric geometric truth/completeness classification** at the
  `volumeOverlapQuery` boundary (kernel-level directionality is a documented, permitted exception —
  see A2.1).
- **§6.4 remains strict** — `docs/superpowers/specs/2026-09-08-...design.md:388-404`. Do not edit it,
  do not loosen its comparator, do not expand the `TIME_BUDGET_DIAGNOSTIC_DIVERGENCE` carve-out
  (`:402`).
- **No Worker / postMessage / production worker path.** Nothing under `spike/m4/` for Phase-4-gated
  work, nothing new under `collision/` that implements a worker boundary.
- **The M4 verdict reducer (`test/performance/m4/verdict-reducer.mjs`, planned at M4 plan
  `:4193-4372`) does not exist as code and is not created by this plan.** Where a task below needs a
  "provisional reducer result," it means a manually-documented application of the M4 design's own
  decision rules (§7.3-§7.5) to the fresh evidence, not a code invocation — see Task E4.
- **Do not implement anything in this plan yet. Do not commit anything in this plan yet.** This
  document is the plan; execution is a separate, later activity.

---

# Phase A — Canonical ordering infrastructure + focused correctness regressions

### Task A1.1: Cached `geometryDigest` in `ThreeMeshBvhBackend.build()`

**Files:**
- Modify: `collision/blas/ThreeMeshBvhBackend.js:37-83` (the `build(weldedGeometry)` function; current
  return at `:82` is `{ bvh, localDiagonal, aspectRatio, aspectRatioExceeded, geometry }`)
- Create: `collision/geometry/contentDigest.js` (new pure module — the dependency-free digest primitive;
  see "Algorithm" below)
- Test: `test/blas/ThreeMeshBvhBackend.test.mjs` — **this file already exists** (confirmed: ~60 lines,
  four tests, with its own local welded-box fixture helper `rawBoxWelded`). Extend it; do not create a
  new file or invent a different fixture helper.

**Interfaces:**
- Consumes: `weldedGeometry` — the same `{ position, index, triangleCount }`-shaped object `build()`
  already receives (per its current JSDoc). **Confirmed against actual source and the existing test
  fixture helper: `position`/`index` are bare typed arrays (`Float32Array`/`Uint32Array`) directly —
  NOT `BufferAttribute`-wrapper objects.** There is no `.array`/`.count` indirection to go through;
  read `position.length`, `position.buffer`, `position.byteOffset`, `position.byteLength` straight off
  the typed array itself.
- Produces: `build()`'s return object gains one new field: `geometryDigest: string` — a 32-character
  lowercase hex string (128 bits), computed once per call. Every other field in the return object is
  unchanged. This is what Task A1.2's `orientForCrossing` and Task A2.1's wrapper consume as rank 5.

**Runtime constraint — read before writing any code in this task:** `collision/` is served **raw,
unbundled** to the browser (`server.js`: `app.use('/collision', express.static('collision'))`) and is
imported directly by `wwwroot/extensions/ClashFinderExtension.js` and `RoomLocatorExtension.js`, and
loaded in-page by Playwright harnesses (e.g. `test/acceptance/room-locator.acceptance.mjs` does
`await import('/collision/blas/ThreeMeshBvhBackend.js')` inside the page). `collision/` currently has
**zero** `node:`-prefixed imports anywhere. **`node:crypto`, `Buffer`, and every other Node-only global
are forbidden in this task's code** — they would resolve under `node --test` and pass Step 4, then break
every browser-side consumer (both extensions, plus every Playwright-driven harness later phases of this
plan depend on: Phase B′'s calibration harness, `run-gate-m4.mjs`, both acceptance suites), surfacing
the failure several tasks downstream from its actual cause. Use only `DataView`/`Uint8Array`/`ArrayBuffer`
below.

**Design basis:** design doc §4.3 C-1 rank 5 (lines 308-325), F17 (`ThreeMeshBvhBackend.js:64,82` is
"the natural, once-per-geometry-per-epoch hook"), and the "Implementation details that must be
explicit — 1. Content digest lifecycle" section.

**Concretizing the design doc's open parameters (the design doc says "128-bit digest" but does not
pin an algorithm — this task fixes that choice for the plan):**

- **Algorithm:** a dependency-free, runtime-neutral 128-bit digest — **not** `node:crypto` (forbidden,
  see the runtime constraint above). Four independently-seeded FNV-1a-32 lanes run over the same byte
  stream, each emitted as 8 lowercase hex chars, concatenated to 32 hex chars (128 bits) total. FNV-1a is
  non-cryptographic-strength but this is a collision-*avoidance* mechanism against accidental
  geometry-content ties (design doc §4.3 C-1 explicitly rejects bytewise collision resolution as
  "over-engineering"), not a security boundary. Lives in its own pure module,
  `collision/geometry/contentDigest.js`, so it has no dependency on `ThreeMeshBvhBackend.js` and can be
  unit-tested in isolation.
- **Exact input bytes, in this fixed order:**
  1. An 8-byte header, built with `DataView`/`ArrayBuffer` (not `Buffer`):
     `header.setUint32(0, vertexCount, true)` then `header.setUint32(4, triangleCount, true)` — both
     little-endian, read from `weldedGeometry.position.length / 3` and
     `weldedGeometry.triangleCount ?? (weldedGeometry.index.length / 3)` respectively. This disambiguates
     a position/index split that could otherwise hash identically under a different vertex/triangle
     count with coincidentally identical concatenated bytes.
  2. The raw bytes of `weldedGeometry.position` itself (it **is** the typed array — see the Interfaces
     note above), viewed as `new Uint8Array(position.buffer, position.byteOffset, position.byteLength)`
     (do not hash the whole backing `ArrayBuffer` if it's a view into a larger shared buffer).
  3. The raw bytes of `weldedGeometry.index` itself, same `Uint8Array` view technique.
- **Compute timing:** synchronously inside `build()`, once per call — `build()` is already the
  once-per-geometry-per-epoch hook (F17), so no separate caching layer is needed inside this function;
  the caching *lifecycle* comes from the caller only calling `build()` once per geometry per epoch.
- **Cache location/key:** the digest lives as a field on the same object `GeometryRegistry` already
  caches per `geometryIndex` per epoch (the existing `getOrBuildGeometry` record). No new cache map.
- **Invalidation/eviction:** identical to the existing record's lifecycle — when the registry entry for
  a `(loadEpoch, geometryIndex)` is evicted, the digest is discarded with it. No separate invalidation
  path to write.
- **Memory overhead:** 32 bytes (hex string) per geometry per epoch — negligible next to the BVH.
- **Unsupported geometry:** zero-triangle or zero-vertex geometry still gets a well-defined digest
  (MD5 of the 8-byte header alone, or header + empty buffers) — no special case needed.

- [ ] **Step 1: Write the failing test**

Extend `test/blas/ThreeMeshBvhBackend.test.mjs` (it already exists — read it first and reuse its
existing `rawBoxWelded`-style local fixture helper rather than importing from a `test/helpers/` module
that does not exist in this repo):

```js
test('build() returns a 32-hex-char geometryDigest', () => {
  const geo = rawBoxWelded(1, 1, 1); // reuse the file's own existing fixture helper, adapt args to
                                       // its real signature
  const result = build(geo);
  assert.equal(typeof result.geometryDigest, 'string');
  assert.match(result.geometryDigest, /^[0-9a-f]{32}$/);
});

test('build() geometryDigest is identical for byte-identical geometry across two calls', () => {
  const geoA = rawBoxWelded(2, 3, 4);
  const geoB = rawBoxWelded(2, 3, 4);
  const a = build(geoA);
  const b = build(geoB);
  assert.equal(a.geometryDigest, b.geometryDigest);
});

test('build() geometryDigest differs for geometrically distinct meshes', () => {
  const a = build(rawBoxWelded(2, 3, 4));
  const b = build(rawBoxWelded(2, 3, 5));
  assert.notEqual(a.geometryDigest, b.geometryDigest);
});

test('build() geometryDigest ignores vertex/index count coincidence via the header', () => {
  // Two geometries with the same vertexCount/triangleCount but different bytes must not collide.
  // Build this fixture inline here (do not invent a new shared helper): take rawBoxWelded(1,1,1)'s
  // position array, clone it, and perturb one coordinate by a value large enough to move the digest
  // while keeping vertexCount/triangleCount identical -- e.g. add 1.0 to position[0].
  const geoA = rawBoxWelded(1, 1, 1);
  const geoB = rawBoxWelded(1, 1, 1);
  geoB.position[0] += 1.0;
  const a = build(geoA);
  const b = build(geoB);
  assert.notEqual(a.geometryDigest, b.geometryDigest);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/blas/ThreeMeshBvhBackend.test.mjs`
Expected: FAIL — `result.geometryDigest` is `undefined`, `typeof undefined !== 'string'`.

- [ ] **Step 3: Implement the pure digest primitive**

Create `collision/geometry/contentDigest.js` — **no imports, no Node-only globals**:

```js
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
```

- [ ] **Step 4: Write the failing test for the digest primitive**

Add `test/geometry/contentDigest.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeContentDigest } from '../../collision/geometry/contentDigest.js';

test('computeContentDigest returns 32 lowercase hex chars', () => {
  const digest = computeContentDigest([new Uint8Array([1, 2, 3])]);
  assert.match(digest, /^[0-9a-f]{32}$/);
});

test('computeContentDigest is deterministic and byte-sensitive', () => {
  const a = computeContentDigest([new Uint8Array([1, 2, 3])]);
  const b = computeContentDigest([new Uint8Array([1, 2, 3])]);
  const c = computeContentDigest([new Uint8Array([1, 2, 4])]);
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test('computeContentDigest treats multiple views as one concatenated stream', () => {
  const split = computeContentDigest([new Uint8Array([1, 2]), new Uint8Array([3])]);
  const whole = computeContentDigest([new Uint8Array([1, 2, 3])]);
  assert.equal(split, whole);
});
```

Run: `node --test test/geometry/contentDigest.test.mjs` — expect FAIL (module does not exist), then
implement Step 3 and re-run — expect PASS, all three tests.

- [ ] **Step 5: Wire `geometryDigest` into `build()`**

In `collision/blas/ThreeMeshBvhBackend.js`, near the existing `localDiagonal` computation (current
line ~64) and before the `return` (current line ~82):

```js
import { computeContentDigest } from '../geometry/contentDigest.js';

// ... inside build(weldedGeometry), after localDiagonal/aspectRatio are computed:

function computeGeometryDigest(weldedGeometry) {
  const positionArray = weldedGeometry.position; // bare Float32Array -- see this task's Interfaces note
  const indexArray = weldedGeometry.index;       // bare Uint32Array/Uint16Array, same note
  const vertexCount = positionArray.length / 3;
  const triangleCount = weldedGeometry.triangleCount ?? (indexArray.length / 3);

  const header = new DataView(new ArrayBuffer(8));
  header.setUint32(0, vertexCount >>> 0, true);
  header.setUint32(4, triangleCount >>> 0, true);

  const headerBytes = new Uint8Array(header.buffer);
  const positionBytes = new Uint8Array(positionArray.buffer, positionArray.byteOffset, positionArray.byteLength);
  const indexBytes = new Uint8Array(indexArray.buffer, indexArray.byteOffset, indexArray.byteLength);

  return computeContentDigest([headerBytes, positionBytes, indexBytes]);
}

// ...
const geometryDigest = computeGeometryDigest(weldedGeometry);

return { bvh, localDiagonal, aspectRatio, aspectRatioExceeded, geometry, geometryDigest };
```

Confirm `weldedGeometry.position`/`.index` are exactly the bare typed arrays described in this task's
Interfaces section by reading the current `build()` body once more immediately before writing this —
if they turn out not to be (e.g. a future refactor wraps them), adjust the byte-extraction lines only;
do not reintroduce `node:crypto`/`Buffer` to work around a shape mismatch.

- [ ] **Step 6: Run test to verify it passes**

Run: `node --test test/blas/ThreeMeshBvhBackend.test.mjs`
Expected: PASS, all four tests (the pre-existing ones plus the four from Step 1).

- [ ] **Step 7: Confirm the digest runs in the browser, not just under `node --test`**

This is the check that actually catches a Node-only-global regression — `node --test` alone cannot,
since Node resolves `node:crypto` fine. Load `/collision/blas/ThreeMeshBvhBackend.js` in a page the same
way `test/acceptance/room-locator.acceptance.mjs:270` already does
(`await import('/collision/blas/ThreeMeshBvhBackend.js')` inside `page.evaluate`), and confirm the
module resolves and `build()` can be called without a `ReferenceError`/`TypeError` on any Node-only
global. If a full acceptance run is expensive, a minimal Playwright script that just imports the module
in-page is sufficient for this check.

- [ ] **Step 8: Run the full BLAS/collision unit suite to confirm no regression**

Run: `node --test test/blas/ test/query/ test/CollisionWorld*.test.mjs test/geometry/`
Expected: PASS, unchanged pass count aside from the new tests added in this task (adding a field to a
return object should not break any existing consumer that doesn't already destructure-and-validate the
full shape — if any test does exhaustive key-count assertions on `build()`'s return object, update it
here, in this same task).

- [ ] **Step 9: Commit**

```bash
git add collision/blas/ThreeMeshBvhBackend.js collision/geometry/contentDigest.js test/blas/ThreeMeshBvhBackend.test.mjs test/geometry/contentDigest.test.mjs
git commit -m "feat(collision): add dependency-free geometryDigest (FNV-1a x4) to ThreeMeshBvhBackend.build()"
```

---

### Task A1.2: `toInstance` forwards `geometryDigest`; `orientForCrossing` pure ranker

**Files:**
- Modify: `collision/CollisionWorld.js:385-387` region — `toInstance` (confirm exact current function
  name/signature by reading the file; the design doc's "what is deliberately NOT here: any identity
  field" comment at `:385-387` is confirmed verbatim-present by research)
- Create: `collision/query/orientForCrossing.js` (new pure module — no dependency on `CollisionWorld.js`
  or Viewer state)
- Test: `test/query/orientForCrossing.test.mjs` (new)

**Interfaces:**
- Consumes: from Task A1.1, `build()`'s `geometryDigest` field, forwarded onto each `Instance` object
  `toInstance` produces (alongside the existing `localDiagonal`, `geometry`, `matrix` fields it already
  carries — confirm the exact current `Instance` shape by reading `toInstance`'s body before editing).
- Produces: `orientForCrossing(x, y) -> { first, second, rank: 1|2|3|4|5|6 }` — a pure function over two
  `Instance` operands. `first`/`second` are the two input objects, reordered. `rank` records which
  ranking criterion decided (for Task A2.4's telemetry). **`canonicalFirstIsSource` is NOT part of this
  return shape** — it is derived by the caller as `first === source` (Task A2.1 does this). Also
  exports `worldDiagonal(instance)` (the `localDiagonal * stretch(matrix)` helper defined below) as a
  named export, not module-private — Task A2.4's telemetry imports and calls it directly rather than
  recomputing it inline.

**Design basis:** design doc §4.3 C-1 (lines 282-326), the exact ranking order (lines 289-298), §4.0's
dead-rung theorem (world-space diagonal must be rank 1, descending — lines 165-256), and the
"Implementation details — 2. World-matrix ordering" / "3. Equal-key fallback" sections (lines 300-315).

**Concretizing the design doc's open parameters:**

- **`stretch(M)`:** the maximum column norm of `M`'s 3×3 linear part. Given a `THREE.Matrix4`-shaped
  `.elements` array `[m0..m15]` in column-major order, the three columns of the linear part are
  `(m0,m1,m2)`, `(m4,m5,m6)`, `(m8,m9,m10)`. `stretch(M) = max(norm(col0), norm(col1), norm(col2))`.
- **World-space diagonal:** `D_X = instance.localDiagonal * stretch(instance.matrix)`.
- **World-matrix lexicographic ordering (rank 4):** compare `instance.matrix.elements[0..15]` in that
  index order, ascending, using plain `<`/`>` (which already treats `-0` and `0` as equal — no special
  casing needed there). **NaN guard:** if either matrix contains any `NaN` element, that operand sorts
  *after* every finite-matrix operand at this rank (deterministic, does not throw); if *both* contain a
  `NaN` at the same first-differing index, treat as equal at rank 4 and fall through to rank 5. This is
  a defensive fallback only — well-formed operands reaching this function should never carry a `NaN`
  matrix (upstream validation is expected to have already gated that); the guard exists so
  `orientForCrossing` never throws or silently returns a non-deterministic order if it ever does.
- **Equal-key fallback (rank 6):** if ranks 1-5 all compare equal (including a rank-5 digest match —
  L-3's declared residue), fall back to the caller's public `source` role: `source` is always ordered
  first. This is deterministic (caller-supplied, not reload-unstable) but is the one documented residue
  where wrapper swap-invariance degrades to the kernel's directional behavior (L-3). Never fall back to
  `fragmentId`, `geometryIndex`, or any other identity field here — those are forbidden at this layer
  per the Global Constraints.

- [ ] **Step 1: Write the failing test**

Create `test/query/orientForCrossing.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { orientForCrossing } from '../../collision/query/orientForCrossing.js';
import { Matrix4 } from 'three';

function makeInstance({ localDiagonal, matrix = new Matrix4(), triangleCount = 12, vertexCount = 8, geometryDigest = 'a'.repeat(32) }) {
  return {
    localDiagonal,
    matrix,
    geometryDigest,
    geometry: { index: { count: triangleCount * 3 }, attributes: { position: { count: vertexCount } } },
  };
}

test('rank 1: larger world-space diagonal orients first, regardless of argument order', () => {
  const small = makeInstance({ localDiagonal: 3.918 });
  const large = makeInstance({ localDiagonal: 290.969 });
  const r1 = orientForCrossing(small, large);
  const r2 = orientForCrossing(large, small);
  assert.equal(r1.first, large);
  assert.equal(r2.first, large);
  assert.equal(r1.rank, 1);
});

test('rank 1 uses WORLD diagonal (localDiagonal * stretch), not local diagonal alone', () => {
  // local diagonal disagrees with world diagonal once scale is applied — this is regression A.2's
  // pinning case, exercised at the unit level here.
  const stretched = new Matrix4().makeScale(100, 100, 100);
  const a = makeInstance({ localDiagonal: 1, matrix: stretched }); // world diagonal 100
  const b = makeInstance({ localDiagonal: 10, matrix: new Matrix4() }); // world diagonal 10
  const r = orientForCrossing(a, b);
  assert.equal(r.first, a);
  assert.equal(r.rank, 1);
});

test('rank 2: equal world diagonal falls to triangle count, descending', () => {
  const a = makeInstance({ localDiagonal: 5, triangleCount: 10 });
  const b = makeInstance({ localDiagonal: 5, triangleCount: 20 });
  const r = orientForCrossing(a, b);
  assert.equal(r.first, b);
  assert.equal(r.rank, 2);
});

test('rank 3: equal diagonal and triangle count falls to vertex count, descending', () => {
  const a = makeInstance({ localDiagonal: 5, triangleCount: 10, vertexCount: 6 });
  const b = makeInstance({ localDiagonal: 5, triangleCount: 10, vertexCount: 9 });
  const r = orientForCrossing(a, b);
  assert.equal(r.first, b);
  assert.equal(r.rank, 3);
});

test('rank 4: equal counts falls to world-matrix lexicographic order, ascending', () => {
  const matA = new Matrix4(); matA.elements[0] = 1;
  const matB = new Matrix4(); matB.elements[0] = 2;
  const a = makeInstance({ localDiagonal: 5, matrix: matA });
  const b = makeInstance({ localDiagonal: 5, matrix: matB });
  const r = orientForCrossing(a, b);
  assert.equal(r.first, a); // 1 < 2, ascending means a sorts first
  assert.equal(r.rank, 4);
});

test('rank 4 treats -0 and 0 as equal (falls through to rank 5)', () => {
  const matA = new Matrix4(); matA.elements[0] = -0;
  const matB = new Matrix4(); matB.elements[0] = 0;
  const a = makeInstance({ localDiagonal: 5, matrix: matA, geometryDigest: 'a'.repeat(32) });
  const b = makeInstance({ localDiagonal: 5, matrix: matB, geometryDigest: 'b'.repeat(32) });
  const r = orientForCrossing(a, b);
  assert.equal(r.rank, 5); // did not decide at rank 4
});

test('rank 4 NaN guard: a NaN-bearing matrix sorts after a finite one, never throws', () => {
  const matA = new Matrix4(); matA.elements[0] = NaN;
  const matB = new Matrix4();
  const a = makeInstance({ localDiagonal: 5, matrix: matA });
  const b = makeInstance({ localDiagonal: 5, matrix: matB });
  assert.doesNotThrow(() => orientForCrossing(a, b));
  const r = orientForCrossing(a, b);
  assert.equal(r.first, b);
});

test('rank 5: equal ranks 1-4 falls to geometryDigest, lexicographic ascending', () => {
  const a = makeInstance({ localDiagonal: 5, geometryDigest: '11'.repeat(16) });
  const b = makeInstance({ localDiagonal: 5, geometryDigest: '22'.repeat(16) });
  const r = orientForCrossing(a, b);
  assert.equal(r.first, a);
  assert.equal(r.rank, 5);
});

test('rank 6: identical digest falls back to the caller\'s public source role', () => {
  const a = makeInstance({ localDiagonal: 5, geometryDigest: 'a'.repeat(32) });
  const b = makeInstance({ localDiagonal: 5, geometryDigest: 'a'.repeat(32) });
  const r1 = orientForCrossing(a, b); // a is the public "source" (first positional arg)
  const r2 = orientForCrossing(b, a); // b is the public "source" here
  assert.equal(r1.first, a);
  assert.equal(r2.first, b);
  assert.equal(r1.rank, 6);
});

test('total order: antisymmetric and transitive over a random equal-triangle-count fixture set', () => {
  // Regression A.1's antisymmetry/transitivity requirement, exercised directly on the helper.
  const instances = [
    makeInstance({ localDiagonal: 5, geometryDigest: '01'.repeat(16) }),
    makeInstance({ localDiagonal: 5, geometryDigest: '02'.repeat(16) }),
    makeInstance({ localDiagonal: 5, geometryDigest: '03'.repeat(16) }),
  ];
  for (const x of instances) for (const y of instances) {
    const fwd = orientForCrossing(x, y);
    const bwd = orientForCrossing(y, x);
    if (x !== y) assert.notEqual(fwd.first, bwd.first, 'antisymmetric for distinct operands');
  }
  // transitivity: a < b < c implies a < c
  const [a, b, c] = instances; // digests already ascending: 01 < 02 < 03
  assert.equal(orientForCrossing(a, b).first, a);
  assert.equal(orientForCrossing(b, c).first, b);
  assert.equal(orientForCrossing(a, c).first, a);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/query/orientForCrossing.test.mjs`
Expected: FAIL — module `collision/query/orientForCrossing.js` does not exist.

- [ ] **Step 3: Implement `orientForCrossing`**

Create `collision/query/orientForCrossing.js`:

```js
function stretch(matrix) {
  const e = matrix.elements;
  const col0 = Math.hypot(e[0], e[1], e[2]);
  const col1 = Math.hypot(e[4], e[5], e[6]);
  const col2 = Math.hypot(e[8], e[9], e[10]);
  return Math.max(col0, col1, col2);
}

export function worldDiagonal(instance) {
  return instance.localDiagonal * stretch(instance.matrix);
}

function compareWorldMatrixLexicographic(a, b) {
  const ea = a.matrix.elements;
  const eb = b.matrix.elements;
  let aHasNaN = false;
  let bHasNaN = false;
  for (let i = 0; i < 16; i++) {
    const va = ea[i];
    const vb = eb[i];
    const aNaN = Number.isNaN(va);
    const bNaN = Number.isNaN(vb);
    if (aNaN || bNaN) {
      aHasNaN = aHasNaN || aNaN;
      bHasNaN = bHasNaN || bNaN;
      if (aNaN && !bNaN) return 1; // NaN sorts after finite
      if (!aNaN && bNaN) return -1;
      continue; // both NaN at this index, keep scanning
    }
    if (va !== vb) return va < vb ? -1 : 1;
  }
  return 0;
}

function compareDigest(a, b) {
  if (a.geometryDigest === b.geometryDigest) return 0;
  return a.geometryDigest < b.geometryDigest ? -1 : 1;
}

/**
 * Total geometric order over two Instance operands. No identity field participates at any rank.
 * Returns which operand becomes the kernel's `A` (`first`) and which rank decided.
 */
export function orientForCrossing(x, y) {
  const dx = worldDiagonal(x);
  const dy = worldDiagonal(y);
  if (dx !== dy) {
    return dx > dy
      ? { first: x, second: y, rank: 1 }
      : { first: y, second: x, rank: 1 };
  }

  const tx = x.geometry.index.count;
  const ty = y.geometry.index.count;
  if (tx !== ty) {
    return tx > ty
      ? { first: x, second: y, rank: 2 }
      : { first: y, second: x, rank: 2 };
  }

  const vx = x.geometry.attributes.position.count;
  const vy = y.geometry.attributes.position.count;
  if (vx !== vy) {
    return vx > vy
      ? { first: x, second: y, rank: 3 }
      : { first: y, second: x, rank: 3 };
  }

  const matrixCmp = compareWorldMatrixLexicographic(x, y);
  if (matrixCmp !== 0) {
    return matrixCmp < 0
      ? { first: x, second: y, rank: 4 }
      : { first: y, second: x, rank: 4 };
  }

  const digestCmp = compareDigest(x, y);
  if (digestCmp !== 0) {
    return digestCmp < 0
      ? { first: x, second: y, rank: 5 }
      : { first: y, second: x, rank: 5 };
  }

  // Rank 6 — declared residue (L-3): fall back to the caller's public source role. `x` is always the
  // caller's "source" by this function's own calling convention (Task A2.1 always calls
  // orientForCrossing(source, target)).
  return { first: x, second: y, rank: 6 };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/query/orientForCrossing.test.mjs`
Expected: PASS, all 10 tests.

- [ ] **Step 5: Forward `geometryDigest` through `toInstance` — AND through the test operand factory**

Read `collision/CollisionWorld.js`'s `toInstance` function (defined at lines 388-398, confirmed against
current source; its "no identity field" comment is at `:385-387`) and add `geometryDigest` to the
object it returns, sourced from the same `GeometryRegistry` record Task A1.1 extended (confirmed current
return shape: `{ geometry, bvh, localDiagonal, connectivity, closedManifold, aspectRatioExceeded, matrix }`
— add `geometryDigest` alongside these, do not add any identity field). Add one assertion to whatever
existing test currently checks `toInstance`'s return shape (grep `toInstance` in `test/` to find it)
confirming `geometryDigest` is present and is a 32-hex-char string.

**This alone is not sufficient — it only fixes the production path.** `test/fixtures/geometry.mjs`'s
`testInstance` helper (lines ~95-105) — the operand factory **every unit test in this plan uses**,
including Phase B′'s calibration harness — destructures `build()`'s return **field-by-field**:
```js
const { bvh, geometry: builtGeometry, localDiagonal, aspectRatio, aspectRatioExceeded } = buildBvh(raw);
```
This silently drops `geometryDigest` (it is not in the destructured field list), so without an explicit
fix here every test-constructed `Instance` carries `geometryDigest === undefined`, and rank 5 of
`orientForCrossing` never fires in any test that uses `testInstance` — including regression A.5
(Task A4.1), whose entire purpose is proving rank 5 works. Add `geometryDigest` to this destructuring
and to whatever object `testInstance` builds from it, so the returned test `Instance` carries a real
digest, not `undefined`. Add an assertion in `test/fixtures/geometry.mjs`'s own test (or add one if none
exists) confirming `testInstance(...)`'s return has a 32-hex-char `geometryDigest`.

- [ ] **Step 6: Run the full CollisionWorld unit suite**

Run: `node --test test/CollisionWorld*.test.mjs test/query/ test/blas/`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add collision/query/orientForCrossing.js test/query/orientForCrossing.test.mjs collision/CollisionWorld.js
git commit -m "feat(collision): add orientForCrossing total geometric order, forward geometryDigest through toInstance"
```

---

### Task A2.1: Canonical `volumeOverlapQuery` wrapper — delete `compareCanonical`, use `orientForCrossing`

**Files:**
- Modify: `collision/query/VolumeOverlapQuery.js` — `defaultCompareCanonical` (current `:18`), the
  `options.compareCanonical` read (current `:67-68`), the `canonicalFirst` witness-frame mapping
  (current `:176-181`)
- Modify: `collision/CollisionWorld.js:2273` (C1, `_runNarrowPhasePair` mode `'volume-overlap'`) and
  `:2409` (C2, `_runClearanceNarrowPhasePair` / Hard-Clash precheck) — remove `canonicalOrder` /
  `compareCanonical` computation and passing
- Test: `test/query/VolumeOverlapQuery.test.mjs` (modify the two tests at current lines 133, 429 — see
  Task A3.3; this task only needs a *new* test proving the fail-loud guard)

**Interfaces:**
- Consumes: `orientForCrossing` from Task A1.2.
- Produces: `volumeOverlapQuery(source, target, options)` keeps its exact current public signature and
  return shape (it is declared `async function volumeOverlapQuery(...)` — confirmed at
  `VolumeOverlapQuery.js:48`). `options.compareCanonical`, if supplied, causes the returned promise to
  **reject** (fail-loud guard, per design doc §4.3 C-3 / §9.6(b)) rather than being silently ignored or
  used. **Not a synchronous throw** — a `throw` inside an `async function` always surfaces as a rejected
  promise, never a synchronous exception; callers must `await`/`.catch()` it.

**Design basis:** design doc §4.3 C-1/C-3 (lines 282-370), §3.1 layer contract (lines 113-131), §14
finding #1 and #5 dispositions (lines 990, 994).

- [ ] **Step 1: Write the failing test — fail-loud guard**

Add to `test/query/VolumeOverlapQuery.test.mjs`:

```js
test('volumeOverlapQuery rejects if compareCanonical is supplied (async function -- throw surfaces as rejection, not a sync throw)', async () => {
  const duct = testInstance(box(20, 0.4, 0.4));
  const beam = testInstance(box(0.4, 0.4, 20));
  await assert.rejects(
    () => volumeOverlapQuery(duct, beam, { compareCanonical: () => -1 }),
    /compareCanonical/
  );
});

test('volumeOverlapQuery orients the larger-world-diagonal operand as canonical first, regardless of public source/target role', async () => {
  const duct = testInstance(box(20, 0.4, 0.4));   // larger
  const beam = testInstance(box(0.4, 0.4, 2));    // smaller
  const forward = await volumeOverlapQuery(duct, beam);
  const backward = await volumeOverlapQuery(beam, duct);
  // Both calls make the same kernel call internally; wrapper-level crossing-term fields must be
  // bit-identical regardless of which operand the caller labeled "source". NOTE: `inconclusiveCauses`
  // exists only on the negative-result shape (VolumeOverlapQuery.js:372) -- these fixtures may take
  // either the positive or negative path depending on whether they actually cross, so default to an
  // empty array rather than assuming the field is present.
  assert.equal(forward.overlap, backward.overlap);
  assert.equal(forward.conclusive, backward.conclusive);
  assert.deepEqual(
    [...(forward.inconclusiveCauses ?? [])].sort(),
    [...(backward.inconclusiveCauses ?? [])].sort()
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/query/VolumeOverlapQuery.test.mjs`
Expected: FAIL — `compareCanonical` is still silently accepted (no rejection); the swap-invariance test
may already coincidentally pass or fail depending on current identity-based ordering — either way, the
rejection assertion is the RED signal for this step.

- [ ] **Step 3: Implement the wrapper rewrite**

In `collision/query/VolumeOverlapQuery.js`:

1. Delete `defaultCompareCanonical` (current `:18`) entirely.
2. Where `options.compareCanonical` is currently read (current `:67-68`), replace with a fail-loud
   guard:

```js
if (options.compareCanonical !== undefined) {
  throw new TypeError(
    'volumeOverlapQuery: options.compareCanonical was removed — operand orientation is now decided ' +
    'internally by orientForCrossing (a total geometric order), and can no longer be supplied by the ' +
    'caller. Remove this option.'
  );
}
```

3. Where orientation was previously decided by the injected comparator, call `orientForCrossing`
   directly:

```js
import { orientForCrossing } from './orientForCrossing.js';

// ... inside volumeOverlapQuery, replacing the old compareCanonical-driven branch:
const { first: canonicalFirst, second: canonicalSecond, rank: orientationRank } = orientForCrossing(source, target);
const canonicalFirstIsSource = canonicalFirst === source;
```

4. Confirm the existing witness-frame mapping at current `:176-181` (`canonicalFirstIsSource`,
   `worldMatrix`, `toFiniteWorldArray(crossing.witnessPoint, worldMatrix)`) is unchanged — it already
   consumes exactly the `canonicalFirstIsSource` boolean this rewrite still produces, just now sourced
   from `orientForCrossing`'s return instead of the deleted injected comparator. Do not alter this
   mapping's logic, only its input.
5. Everywhere the old code passed `canonicalFirst`/`canonicalSecond` onward to `properCrossingQuery`
   (the kernel call — confirm exact current call site by reading the file, expected near where
   `crossing = properCrossingQuery(...)` is invoked), pass the new `canonicalFirst`/`canonicalSecond`
   values through unchanged in shape.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/query/VolumeOverlapQuery.test.mjs`
Expected: the two new tests PASS. Other existing tests in this file may now FAIL if they relied on
`compareCanonical` — that is expected and is fixed in Task A3.3, not here. Confirm the failures are
*only* the two tests at current lines 133 and 429 (the ones Task A3.3 re-expresses) — if any other test
in this file fails, stop and investigate before proceeding; this task must not break unrelated
assertions.

- [ ] **Step 5: Commit**

```bash
git add collision/query/VolumeOverlapQuery.js test/query/VolumeOverlapQuery.test.mjs
git commit -m "feat(collision): volumeOverlapQuery orients operands via orientForCrossing, throws on compareCanonical"
```

(Note: `test/query/VolumeOverlapQuery.test.mjs:133,429` remain red after this commit — Task A3.3 fixes
them. This is an intentional, documented intermediate state within Phase A, not a plan violation, since
Phase A's own gate (Task A5) requires the full suite green only at the *end* of Phase A.)

---

### Task A2.2: Remove `canonicalOrder` from call sites C1 and C2

**Files:**
- Modify: `collision/CollisionWorld.js:2273` (C1) and `:2409` (C2)

**Interfaces:**
- Consumes: nothing new — this task deletes code.
- Produces: `_runNarrowPhasePair` (mode `'volume-overlap'`) and `_runClearanceNarrowPhasePair` no longer
  compute `canonicalOrder` via `comparePlacedCanonically`, and no longer pass `compareCanonical` into
  `volumeOverlapQuery` (which would now throw per Task A2.1 — this task removes the caller side of that
  now-forbidden call shape).

- [ ] **Step 1: Confirm the current call shape**

Read `collision/CollisionWorld.js:2260-2290` (around C1) and `:2395-2425` (around C2) to see the exact
current lines computing `canonicalOrder = comparePlacedCanonically(sourcePlaced, targetPlaced)` and the
`compareCanonical: (a, b) => ...` option passed into the `volumeOverlapQuery`/`classifyHardClashPrecheck`
call at each site.

- [ ] **Step 2: Remove the dead computation and the option**

At both C1 and C2, delete the `canonicalOrder` line and the `compareCanonical` option key from the
options object passed onward. Leave every other option (`scheduler`, `crossing`, etc.) untouched.

- [ ] **Step 3: Run the CollisionWorld unit suite**

Run: `node --test test/CollisionWorld*.test.mjs`
Expected: any test that stubbed/asserted on `compareCanonical` being passed at these two call sites
will now fail — this is expected (Task A3.3 covers `ClearanceHardClashPrecheck.test.mjs:111`, the C2
threading test; confirm there is no equivalent C1-side threading test — research found none, but
re-check). Everything else should be unaffected, since `orientForCrossing` (called from inside
`volumeOverlapQuery` per Task A2.1) now makes the geometric decision these sites used to inject.

- [ ] **Step 4: Commit**

```bash
git add collision/CollisionWorld.js
git commit -m "refactor(collision): remove canonicalOrder computation from C1/C2 call sites (orientForCrossing decides internally now)"
```

---

### Task A2.3: Tighten coplanarity epsilon to the symmetric `min` (design doc C-2)

**Files:**
- Modify: `collision/query/ProperCrossingQuery.js` — the `surfaceEpsilon` computation (current `:115`)
  and its use in the coplanar branch (current `:180`, `:182-188`)
- Test: `test/query/ProperCrossingQuery.test.mjs` (extend)

**Interfaces:**
- Consumes: `matrixBtoA` (already a kernel parameter — no new parameter needed), `localDiagonalA`,
  `localDiagonalB`.
- Produces: `surfaceEpsilon` becomes `surfaceEpsilonFactor * min(localDiagonalA, localDiagonalB * stretch(matrixBtoA))`,
  computed once per traversal — monotonically `≤` both of the two values the pre-fix code could
  produce, per design doc §4.3 C-2 (lines 327-360). This must land **before** Phase B′'s recalibration
  (it is design doc's P3, which Phase B′ measures against).

**This is a kernel change, and the kernel stays directional per the layer contract — this change is
symmetric in itself (a `min` of two already-symmetric-computed quantities) but does not make the kernel
swap-invariant; swap-invariance is still delivered entirely by the wrapper (Task A2.1).**

- [ ] **Step 1: Write the failing test**

Add to `test/query/ProperCrossingQuery.test.mjs`:

```js
test('surfaceEpsilon is the min of both operands\' world-scaled tolerance, monotonically tighter than either pre-fix value', () => {
  // A pair where localDiagonalA and localDiagonalB*stretch(matrixBtoA) disagree, pinning `min` over
  // either single-operand value the pre-fix code could have produced.
  const { bvhA, bvhB, matrixBtoA, localDiagonalA, localDiagonalB } = extremeRatioCoplanarFixture(); // add
    // this fixture helper alongside the file's existing fixtures if one does not already exist for
    // an extreme-ratio pair; base it on the class-B pair geometry (290.969 / 3.918) already used
    // elsewhere in this file/suite
  const result = properCrossingQuery(bvhA, bvhB, matrixBtoA, localDiagonalA, localDiagonalB, {});
  // Assert indirectly via observable behavior: no pair the pre-fix (max-based) epsilon would have
  // probed is now discarded by the coplanar gate. Concretely: construct a near-coplanar pair whose
  // offset sits between the tightened min-epsilon and the old max-epsilon, and assert it is NOT
  // discarded (i.e. still reaches the probe ladder / produces a crossing determination rather than
  // being silently dropped by the coplanar branch).
  assert.notEqual(result.inconclusive, undefined); // replace with the fixture's precise expected outcome
});
```

Adapt this to the file's existing fixture-construction idioms (read the file first — it likely already
has helpers for building `bvhA`/`bvhB`/`matrixBtoA` triples). The concrete assertion should pin a
specific before/after outcome using the class-B-style extreme-ratio pair, matching design doc §4.3 C-2's
worked example (a pair that passes the angle test, has one vertex within the *old* epsilon, but forms a
genuine crossing at its far end — must now be probed, not discarded).

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/query/ProperCrossingQuery.test.mjs`
Expected: FAIL against the current `max`-based (or single-operand) epsilon.

- [ ] **Step 3: Implement the tightened epsilon**

In `collision/query/ProperCrossingQuery.js`, replace the current `surfaceEpsilon` computation (current
`:115`) with:

```js
function stretch(matrix) {
  const e = matrix.elements;
  return Math.max(
    Math.hypot(e[0], e[1], e[2]),
    Math.hypot(e[4], e[5], e[6]),
    Math.hypot(e[8], e[9], e[10])
  );
}

// ... inside the traversal setup, once per call:
const surfaceEpsilon = surfaceEpsilonFactor * Math.min(
  localDiagonalA,
  localDiagonalB * stretch(matrixBtoA)
);
```

If `stretch` already exists as a shared helper after Task A1.2 (it is structurally identical to
`orientForCrossing.js`'s internal `stretch`), factor it into a small shared module
(`collision/query/geometryScale.js` or similar) and import it in both `orientForCrossing.js` and
`ProperCrossingQuery.js` rather than duplicating the function. Use judgment on the exact module name;
keep it a pure, dependency-free helper.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/query/ProperCrossingQuery.test.mjs`
Expected: PASS.

- [ ] **Step 5: Run the pinned-counter tests and confirm they are unaffected**

Run: `node --test test/query/ProperCrossingQuery.test.mjs test/query/ProperCrossingQuery.instrumentation.test.mjs test/query/ProperCrossingQuery.deterministic.test.mjs`

Per design doc §9.6 ("Tests that must change" table): the pinned-counter assertions in this glob use
equal-diagonal boxes where `min == max`, so they are **expected unchanged**. Confirm this is still true
against the actual current pins — research found the doc's cited `=== 26`/`=== 5` literal assertions do
not currently exist verbatim; the actual pin found is `CAP = 7` at `test/query/ProperCrossingQuery.test.mjs:259,269,278,280`
(a `maxCrossingPointClassifications` override, not a coplanarity-epsilon-sensitive count). Re-verify
against whatever pinned assertions actually exist at execution time and record in this task's PR
description whether each one is unaffected (expected) or moved (which would need its own justification
per the design doc's rule against loosening pins to inequalities).

- [ ] **Step 6: Commit**

```bash
git add collision/query/ProperCrossingQuery.js test/query/ProperCrossingQuery.test.mjs
git commit -m "fix(collision): tighten coplanarity epsilon to symmetric min(D_A, D_B) — design doc C-2"
```

---

### Task A2.4: Orientation provenance telemetry (design doc C-4)

**Files:**
- Modify: `collision/query/VolumeOverlapQuery.js` — the recorder-gated `hard-clash-precheck`
  `stage:'crossing'` event construction (current `:132-157`)

**Interfaces:**
- Consumes: `orientationRank` from Task A2.1's `orientForCrossing` call, plus the two world-diagonal
  proxies. **`worldDiagonal` is imported directly from `./orientForCrossing.js`** (Task A1.2 exports it
  as a named export for exactly this reason) — `import { worldDiagonal } from './orientForCrossing.js';`
  — do not recompute it inline and do not depend on `stretch` being separately factored out (Task A2.3's
  shared-module extraction of `stretch` is optional/judgment-call; `worldDiagonal` is not — it is a
  required, guaranteed-exported symbol from Task A1.2).
- Produces: three new fields on the existing event, constructed **only** when `diagnosticPairContext`
  is present (same gating as every other field there — zero cost when no recorder is installed):

```js
orientedFirstRole: canonicalFirstIsSource ? 'source' : 'target',
orientationRank,
sourceWorldDiagonal: worldDiagonal(source),
targetWorldDiagonal: worldDiagonal(target),
```

This is telemetry on an opt-in event — not a public result field, not a §6.4-compared field.

- [ ] **Step 1: Write the failing test**

Extend whichever existing test exercises the recorder-gated `hard-clash-precheck` `stage:'crossing'`
event (grep `stage:'crossing'` and `'hard-clash-precheck'` in `test/query/`, likely in
`VolumeOverlapQuery.test.mjs` or `ClearanceHardClashPrecheck.test.mjs`) with:

```js
test('hard-clash-precheck stage:crossing event carries orientation provenance when a recorder is installed', async () => {
  const events = [];
  setDiagnosticEventRecorder((evt) => events.push(evt));
  try {
    const duct = testInstance(box(20, 0.4, 0.4));
    const beam = testInstance(box(0.4, 0.4, 2));
    await volumeOverlapQuery(duct, beam, { diagnosticPairContext: { /* whatever shape this option already requires */ } });
  } finally {
    clearDiagnosticEventRecorder();
  }
  const crossingEvent = events.find((e) => e.stage === 'crossing');
  assert.ok(crossingEvent);
  assert.equal(crossingEvent.orientedFirstRole, 'source'); // duct is larger, and duct is the public source here
  assert.equal(crossingEvent.orientationRank, 1);
  assert.equal(typeof crossingEvent.sourceWorldDiagonal, 'number');
  assert.equal(typeof crossingEvent.targetWorldDiagonal, 'number');
});
```

Adapt to this repo's actual recorder-installation API (`setDiagnosticEventRecorder`/
`clearDiagnosticEventRecorder`, or whatever the real exported names are — confirm by reading
`collision/scheduler.js` or wherever the recorder is defined) and to `diagnosticPairContext`'s real
required shape (read an existing test that already supplies one).

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/query/VolumeOverlapQuery.test.mjs`
Expected: FAIL — the three new fields are `undefined` on the captured event.

- [ ] **Step 3: Implement**

In `collision/query/VolumeOverlapQuery.js`, inside the existing `if (diagnosticPairContext) { reportDiagnosticEvent(...) }`
block (current `:132-157`), add the three fields shown above to the event payload object, alongside the
existing fields (`timeBudgetExceeded`, `crossingElapsedMs`, the three counters, `exhaustedBudget`).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/query/VolumeOverlapQuery.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add collision/query/VolumeOverlapQuery.js test/query/VolumeOverlapQuery.test.mjs
git commit -m "feat(collision): add orientation provenance fields to hard-clash-precheck stage:crossing event (C-4)"
```

---

### Task A3.1: Rename `comparePlacedCanonically` → `compareAggregationIdentity`, drop `geometryIndex`

**Files:**
- Modify: `collision/CollisionWorld.js:162-198` (the function itself), `:244-245` (C3,
  `compareWitnessCandidates`), `:259-260` (C4, `compareClearanceCandidates`)
- Test: `test/CollisionWorld.findClashes.test.mjs` (the order-independence tests at `:1102-1199+`,
  confirm they still pass unmodified — they assert winner order-independence, not a specific key, per
  design doc)

**Interfaces:**
- Consumes: nothing new.
- Produces: a renamed function `compareAggregationIdentity(a, b)` with the middle term
  (`geometryIndex`) removed from its comparator chain: `(loadEpoch, fragmentId)` only. `loadEpoch` is
  retained for totality but is provably non-discriminating within any one call (design doc §6.3, lines
  497-505) since both candidates under one aggregation key already share both epochs by construction.

- [ ] **Step 1: Write the failing test — cross-reload aggregation determinism (part a of regression F)**

This is a genuinely new behavior (dropping `geometryIndex` changes which candidate wins a tie when
`geometryIndex` used to discriminate two otherwise-tied candidates), so it needs its own RED test before
the rename. Add to `test/CollisionWorld.findClashes.test.mjs`:

```js
test('compareAggregationIdentity no longer discriminates on geometryIndex — only fragmentId decides among equal-epoch candidates', () => {
  // Construct two PlacedInstance-shaped candidates (compareAggregationIdentity is called as
  // compareAggregationIdentity(a.sourcePlaced, b.sourcePlaced), CollisionWorld.js:244-245, so its
  // arguments are placed-instance-shaped, not bare instances). `fragmentId` lives directly on
  // `.instance`, NOT nested under `.instance.geometryIdentity` -- confirmed against current source
  // (CollisionWorld.js:194-195: `const fragA = a.instance.fragmentId;`). geometryIndex DOES live
  // under `.instance.geometryIdentity`. Differ ONLY in geometryIndex (one smaller, one larger) and in
  // fragmentId (opposite order from geometryIndex, to prove geometryIndex is no longer consulted).
  const a = { instance: { geometryIdentity: { loadEpoch: 0, geometryIndex: 5 }, fragmentId: 100 } };
  const b = { instance: { geometryIdentity: { loadEpoch: 0, geometryIndex: 1 }, fragmentId: 200 } };
  // Pre-fix: geometryIndex 1 < 5 would make b sort first. Post-fix: fragmentId 100 < 200 makes a sort first.
  const result = compareAggregationIdentity(a, b);
  assert.ok(result < 0, 'a (lower fragmentId) must sort first once geometryIndex is removed from the chain');
});
```

Import `compareAggregationIdentity` — since it is not currently exported, either export it for testing
(check whether `comparePlacedCanonically` is already exported/testable today; if it's module-private,
add a named export solely for test use, matching whatever pattern this file already uses for other
module-private-but-tested helpers) or test it indirectly through `compareWitnessCandidates`'s exported
surface if that's the existing convention. Prefer matching the existing pattern over introducing a new
one.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/CollisionWorld.findClashes.test.mjs`
Expected: FAIL against the current `(loadEpoch, geometryIndex, fragmentId)` chain (geometryIndex 1 < 5
would currently make `b` sort first, opposite of this test's expectation).

- [ ] **Step 3: Implement the rename and field drop**

In `collision/CollisionWorld.js`, rename `comparePlacedCanonically` to `compareAggregationIdentity` at
its definition (current `:162-198`) and at both call sites (current `:244-245`, `:259-260`). Remove the
middle `geometryIndex` comparison branch, leaving:

```js
function compareAggregationIdentity(a, b) {
  const idA = a.instance.geometryIdentity;
  const idB = b.instance.geometryIdentity;
  if (idA.loadEpoch !== idB.loadEpoch) return idA.loadEpoch < idB.loadEpoch ? -1 : 1;
  const fragA = a.instance.fragmentId; // confirm exact current accessor path by reading the file
  const fragB = b.instance.fragmentId;
  if (fragA !== fragB) return fragA < fragB ? -1 : 1;
  return 0;
}
```

Update the function's header comment to describe its new, narrower role: a dbId-level aggregation
tie-break only, never reachable from a geometric call site (per Decision 1/5, design doc §2.2, §6).
Reference §5.1's named fallback (witness-point → world-matrix → digest → `fragmentId`) as a documented
follow-up if `fragmentId`'s empirical-only stability (L-4) ever needs strengthening — do not implement
that fallback now, just note it in the comment as future work.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/CollisionWorld.findClashes.test.mjs`
Expected: PASS, including the pre-existing order-independence tests at `:1102-1199+` (these assert
winner order-independence, not a specific key, so they should be unaffected by the rename/field-drop —
confirm this explicitly).

- [ ] **Step 5: Commit**

```bash
git add collision/CollisionWorld.js test/CollisionWorld.findClashes.test.mjs
git commit -m "refactor(collision): rename comparePlacedCanonically to compareAggregationIdentity, drop geometryIndex term"
```

---

### Task A3.2: Re-express the 3 tests that force order via the deleted `compareCanonical` option

**Files:**
- Modify: `test/query/VolumeOverlapQuery.test.mjs:133` and `:429`
- Modify: `test/query/ClearanceHardClashPrecheck.test.mjs:111`

**Design basis:** design doc §9.6 "Tests that must change" table (lines 804-812).

- [ ] **Step 1: Re-express `VolumeOverlapQuery.test.mjs:133`**

Read the current test (`'compareCanonical decouples canonical order from public roles'`). It currently
forces order via `{ compareCanonical: forceTargetFirst }`. Replace it with a test asserting the public
role is still the diagnostic role and the witness-frame contract still holds, **without** an injected
comparator — construct two instances where rank 2-5 (not rank 1, to keep this test distinct from the
rank-1-specific tests in Task A1.2/A2.1) decides orientation, e.g. equal-diagonal boxes differing in
triangle count:

```js
test('public source/target roles stay stable in diagnostics regardless of which operand orientForCrossing selects as canonical-first', async () => {
  const equalDiagonalHighTriCount = testInstance(subdividedBox(1, 1, 1, /* more triangles */));
  const equalDiagonalLowTriCount = testInstance(box(1, 1, 1));
  const forward = await volumeOverlapQuery(equalDiagonalLowTriCount, equalDiagonalHighTriCount);
  const backward = await volumeOverlapQuery(equalDiagonalHighTriCount, equalDiagonalLowTriCount);
  // orientForCrossing always picks the higher-triangle-count operand first (rank 2) regardless of
  // which one the caller labeled "source" — but the PUBLIC source/target role in the result must
  // still track the caller's own labeling, not the internal canonical order.
  assert.equal(forward.diagnostics?.[0]?.role ?? undefined, /* whatever the existing test asserted about role attribution */ undefined);
});
```

Adapt the exact assertions to whatever the original test actually checked about role/diagnostics
attribution (read it fully before rewriting) — the goal is to keep testing the same *contract*
(public-role stability under internal reorientation) while removing the now-forbidden
`compareCanonical` injection, per design doc's explicit instruction: "Both fixtures use equal-diagonal
boxes, so the orientation outcome is decided by ranks 2–5 and must be asserted explicitly."

- [ ] **Step 2: Re-express `VolumeOverlapQuery.test.mjs:429`**

Same pattern for the witness-frame test (`'crossing witness uses canonicalFirst's real matrix...'`).
Replace the `forceTargetFirst` injection with a natural rank-2-5 tie (equal diagonal, differing
triangle/vertex count or matrix), and assert the witness point is still expressed in the *actual*
canonical-first operand's frame — which `orientForCrossing` now decides, not an injected function.

- [ ] **Step 3: Re-express `ClearanceHardClashPrecheck.test.mjs:111`**

Read the current test (`'threads a caller-supplied scheduler/compareCanonical into volumeOverlapQuery'`).
Split it: keep the `scheduler` threading assertion (still valid — `scheduler` is untouched by this fix),
remove the `compareCanonical` threading assertion entirely (there is nothing left to thread — the
option no longer exists on the caller side after Task A2.2). Rename the test to
`'threads a caller-supplied scheduler into volumeOverlapQuery'` and drop the `compareCanonical`
half of the assertion and its `sawCompareCanonical` tracking variable.

- [ ] **Step 4: Run the full suite for these three files**

Run: `node --test test/query/VolumeOverlapQuery.test.mjs test/query/ClearanceHardClashPrecheck.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add test/query/VolumeOverlapQuery.test.mjs test/query/ClearanceHardClashPrecheck.test.mjs
git commit -m "test(collision): re-express VolumeOverlapQuery/ClearanceHardClashPrecheck tests without deleted compareCanonical option"
```

---

### Task A3.3: Rewrite the `ductThroughBeamFixture` (707:1) test comment

**Files:**
- Modify: `test/CollisionWorld.findClashes.dispatch.test.mjs:266-323`

**Design basis:** design doc §9.6 table (line 810): "Kept green, comment rewritten... the test becomes
stronger, no longer depending on the fixture's `geometryIndex` assignment."

- [ ] **Step 1: Confirm the test still passes unmodified in code**

Run: `node --test test/CollisionWorld.findClashes.dispatch.test.mjs`
Expected: PASS (this test's *assertions* do not change — only its comment is wrong now).

- [ ] **Step 2: Rewrite the comment**

Replace the current comment (research-confirmed verbatim):

```js
// With the identity-based comparator wired in, canonical order is fixed by
// (loadEpoch, geometryIndex, fragmentId) -- the duct (geometryIndex 0) always sorts first -- so both
// call directions agree. Without it, this fixture reports 1 pair one way and 0 the other.
```

with:

```js
// orientForCrossing orients the duct (world diagonal ~3000) first regardless of caller-supplied
// operand order or which fragment/geometryIndex the Viewer happened to assign it on this load --
// world-space diagonal is rank 1 of a total geometric order (design doc
// docs/superpowers/specs/2026-09-11-canonical-ordering-operand-symmetry-fix-design.md §4.3 C-1), so
// both call directions agree without reading any identity field. This regression is the repository's
// strongest evidence for the dead-rung theorem (§4.0): pre-fix, the small-operand orientation made
// every probe rung classify `boundary` and silently lost this crossing.
```

- [ ] **Step 3: Commit**

```bash
git add test/CollisionWorld.findClashes.dispatch.test.mjs
git commit -m "docs(collision): rewrite ductThroughBeamFixture comment to attribute correctness to orientForCrossing, not geometryIndex"
```

---

### Task A4.1: Regression A — reload stability (A.1 base, A.2 world-vs-local diagonal, A.3 thin-solid, A.4 near-parallel epsilon monotonicity, A.5 rank-5 digest collision)

**Files:**
- Create: `test/query/VolumeOverlapQuery.reloadStability.test.mjs`

**Design basis:** design doc §11 regression A (lines 838-857).

- [ ] **Step 1: Write regression A.1 — base reload-stability proxy**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { volumeOverlapQuery } from '../../collision/query/VolumeOverlapQuery.js';
import { testInstance, box } from './helpers/instanceFixtures.mjs'; // reuse whatever this suite's
                                                                      // existing test files already use

test('A.1 — operand order exchange (in-process stand-in for reload-induced geometryIndex permutation) does not change overlap/conclusive/inconclusiveCauses/diagnostics reason multiset', async () => {
  const pairs = [
    [testInstance(box(290.969, 1, 1)), testInstance(box(3.918, 1, 1))], // class-B ratio, F6
    [testInstance(box(3000, 1, 1)), testInstance(box(4.243, 1, 1))],    // ductThroughBeam ratio, F12
  ];
  for (const [a, b] of pairs) {
    const forward = await volumeOverlapQuery(a, b);
    const backward = await volumeOverlapQuery(b, a);
    assert.equal(forward.overlap, backward.overlap);
    assert.equal(forward.conclusive, backward.conclusive);
    assert.deepEqual([...forward.inconclusiveCauses].sort(), [...backward.inconclusiveCauses].sort());
    assert.deepEqual(
      forward.diagnostics?.map((d) => d.reason).sort(),
      backward.diagnostics?.map((d) => d.reason).sort()
    );
  }
});
```

- [ ] **Step 2: Write regression A.2 — world-space diagonal ranking, not local**

```js
test('A.2 — rank 1 uses WORLD diagonal: a scaled small-local-diagonal operand still orients first when its world diagonal is larger', async () => {
  const scaleMatrix = /* build a THREE.Matrix4 uniform scale of, e.g., 200 */;
  const smallLocalLargeWorld = testInstance(box(1, 1, 1), scaleMatrix); // local diag ~1.7, world diag ~346
  const largeLocalSmallWorld = testInstance(box(100, 1, 1));            // local diag ~100, no scale
  // Swap-equality alone is a TAUTOLOGY here: after Phase A, forward/backward always make the same
  // kernel call regardless of which rank decided orientation, so it cannot distinguish "rank 1 used
  // world diagonal" from "rank 1 used local diagonal" (or any other rank). Pin the ABSOLUTE outcome
  // the world-diagonal rule requires instead, via C-4's telemetry (Task A2.4): the small-local/
  // large-world operand must be selected as canonical-first at rank 1.
  const events = [];
  setDiagnosticEventRecorder((kind, payload) => events.push({ kind, payload })); // match this repo's
    // actual recorder arity — confirm against test/query/VolumeOverlapQuery.diagnosticEvents.test.mjs
  try {
    await volumeOverlapQuery(smallLocalLargeWorld, largeLocalSmallWorld, {
      diagnosticPairContext: { /* whatever shape this option already requires — read an existing test
                                  that supplies one */ },
    });
  } finally {
    clearDiagnosticEventRecorder();
  }
  const crossingEvent = events.find((e) => e.payload?.stage === 'crossing')?.payload;
  assert.ok(crossingEvent, 'expected a hard-clash-precheck stage:crossing event');
  assert.equal(crossingEvent.orientationRank, 1);
  assert.equal(crossingEvent.orientedFirstRole, 'source'); // smallLocalLargeWorld is the public source
    // here, and it must win rank 1 on WORLD diagonal (346 > 100) despite losing on LOCAL diagonal
    // (1.7 < 100) — this is the assertion that would have caught a local-diagonal-only ranking bug.
});
```

- [ ] **Step 3: Write regression A.3 — thin-solid, extreme ratio (1e3-1e5)**

```js
test('A.3 — a thin plate crossing a very large member at an extreme diagonal ratio is still detected under the large-first ladder', async () => {
  const largeMember = testInstance(box(100000, 10, 10)); // ratio ~1e4 against the plate below
  const thinPlate = testInstance(box(10, 10, 0.5), /* positioned to genuinely cross largeMember */);
  const forward = await volumeOverlapQuery(largeMember, thinPlate);
  const backward = await volumeOverlapQuery(thinPlate, largeMember);
  assert.equal(forward.overlap, true, 'a genuine crossing at extreme ratio must not be lost under large-first orientation');
  assert.equal(backward.overlap, true);
});
```

This is a genuinely new fixture the design doc says "none exists today" (line 850) — construct it
carefully so the plate provably crosses the member's surface (not just AABB-overlaps it), following the
same fixture-construction idiom as `ductThroughBeamFixture` in
`test/CollisionWorld.findClashes.dispatch.test.mjs`.

- [ ] **Step 4: Write regression A.4 — near-parallel thin-overlap, tightened-epsilon monotonicity**

```js
test('A.4 — no crossing detectable under either pre-fix orientation is lost under the tightened coplanarity epsilon', async () => {
  // Construct a near-parallel, thin-overlap pair at an extreme ratio, positioned so the offset between
  // the two triangles' planes sits BETWEEN the tightened min-epsilon band (1e-6 * min(D_A, D_B)) and
  // the looser of the two pre-fix single-operand bands (1e-6 * D_A or 1e-6 * D_B, whichever the old
  // identity order would have picked) -- i.e. a pair the pre-fix code could have probed under ONE
  // orientation but not the other, and the post-fix `min` must now probe it regardless of orientation.
  // Swap equality alone is NOT the requirement here (the design doc's monotonicity claim is about
  // completeness, not symmetry) -- pin the ABSOLUTE outcome: the crossing must be found.
  const a = testInstance(/* ... */);
  const b = testInstance(/* ... */);
  const forward = await volumeOverlapQuery(a, b);
  const backward = await volumeOverlapQuery(b, a);
  assert.equal(forward.overlap, true, 'the crossing beyond the tightened epsilon band must be found, not discarded as coplanar');
  assert.equal(backward.overlap, true);
});
```

- [ ] **Step 5: Write regression A.5 — rank-5 digest collision fixture**

```js
test('A.5 — two geometrically distinct meshes sharing diagonal/triangle-count/vertex-count/world-matrix are disambiguated by geometryDigest, and swapping them is bit-identical', async () => {
  const meshA = testInstance(distinctMeshWithMatchingCountsA()); // helper: build two meshes that
  const meshB = testInstance(distinctMeshWithMatchingCountsB()); // share bounding diagonal, triangle
                                                                   // count, vertex count, and an
                                                                   // identical world matrix, but whose
                                                                   // actual vertex coordinates differ
  // Sanity-check the fixture itself BEFORE testing the wrapper: if geometryDigest is undefined (see
  // Task A1.2 Step 5's testInstance-forwarding fix -- required, not optional, for this test to mean
  // anything) this test would silently fall through to rank 6 and pass for the wrong reason.
  assert.match(meshA.geometryDigest, /^[0-9a-f]{32}$/);
  assert.match(meshB.geometryDigest, /^[0-9a-f]{32}$/);
  assert.notEqual(meshA.geometryDigest, meshB.geometryDigest);

  const forward = await volumeOverlapQuery(meshA, meshB);
  const backward = await volumeOverlapQuery(meshB, meshA);
  assert.equal(forward.overlap, backward.overlap);
  assert.equal(forward.conclusive, backward.conclusive);
  // Without rank 5 (geometryDigest) this test is RED — ranks 1-4 cannot discriminate this pair, and it
  // falls to rank 6 (public source role), which the digest assertions above rule out.
});
```

- [ ] **Step 6: Run all of regression A, verify RED on the pre-Phase-A baseline reasoning**

Run: `node --test test/query/VolumeOverlapQuery.reloadStability.test.mjs`
Expected at this point in the plan (after A1-A3 have already landed): PASS. To satisfy the design doc's
"RED today" framing, confirm by inspection (not by literally reverting) that A.1/A.5 would have failed
against the pre-Phase-A `comparePlacedCanonically`-driven code — A.1 because pre-fix swap changes
`inconclusive` on 66/106 real pairs (F5) and this fixture is chosen to be sensitive to the same defect
class; A.5 because ranks 1-4 alone cannot discriminate its fixture by construction. Record this
reasoning in the task's commit message or PR description rather than re-running against reverted code.

- [ ] **Step 7: Commit**

```bash
git add test/query/VolumeOverlapQuery.reloadStability.test.mjs
git commit -m "test(collision): add regression A (A.1-A.5) — reload/operand-order stability, world-diagonal ranking, thin-solid detection, epsilon monotonicity, digest disambiguation"
```

---

### Task A4.2: Regression B — operand-swap invariance at the wrapper (106-pair replay)

**Files:**
- Create: `test/query/VolumeOverlapQuery.operandSwapReplay.test.mjs`
- Retention: `test/performance/results/` (per-session JSON, per design doc, closing research doc
  limitation 9)

**Design basis:** design doc §11 regression B (lines 859-870); the pre-fix baseline is 66/106 flips on
`inconclusive` (F5), sourced from `docs/research/m4-effect-b-precheck-diagnostic-nondeterminism-investigation.md`
§6.5a.

- [ ] **Step 1: Locate and reuse the 106-pair harness**

Read `docs/research/m4-effect-b-precheck-diagnostic-nondeterminism-investigation.md` §6.5a to find how
the 106-pair replay set was originally built (`world._registry.getOrBuildGeometry` +
`world._placementByEpoch`, per design doc line 861). This is a **live-Viewer-derived** fixture set —
confirm whether it was captured to a static JSON fixture file anywhere in `test/` or
`docs/research/`; if so, reuse that file directly. If not, this regression may need to run against the
Playwright gate harness instead of as a pure `node --test` unit test — in that case, write it as an
addition to `test/performance/run-gate-m4.mjs`'s scenario set rather than a standalone `node --test`
file, and update this task's Files section accordingly before implementing.

**Return-shape ground truth (verified against current `collision/query/VolumeOverlapQuery.js` source —
do not use any other field names):**

```
positive result: { overlap, conclusive, via, diagnostics, containmentSamplesUsed, stats: { crossing }, witness }
negative result: { overlap, conclusive, diagnostics, inconclusiveCauses, containmentSamplesUsed, stats }
```
The three crossing counters, `exhaustedBudget`, `elapsedMs` and `timeBudgetExceeded` live at
`result.stats.crossing.*` (`createCrossingStats`, `ProperCrossingQuery.js:47-57`). `crossing`,
`aborted`, `inconclusive` and the raw `witnessPoint` are **kernel-record fields — they are never
surfaced on the wrapper's public return at all.** `witnessPoint` is consumed into `witness.point` at
`VolumeOverlapQuery.js:180-181`. **A previous draft of this test asserted directly on `forward.crossing`,
`forward.aborted`, `forward.candidatePairsExamined`, `forward.witnessPoint`, etc. — none of those exist
on the return object, so every such assertion silently compares `undefined === undefined` and passes
regardless of whether the fix works. This is the plan's single most important regression (design doc
§11 calls it "a strictly stronger assertion than the earlier draft's" and it is what pins the entire
106-pair replay evidence, F5's 66/106 baseline) — it must not go green vacuously.**

- [ ] **Step 2: Write the failing test**

```js
test('B — every replayed pair is bit-identical at the wrapper under both public-role orders', async () => {
  const pairs = loadOperandSwapReplaySet(); // from Step 1's fixture source
  const results = [];
  for (const { source, target } of pairs) {
    const forward = await volumeOverlapQuery(source, target);
    const backward = await volumeOverlapQuery(target, source);
    const fc = forward.stats.crossing;
    const bc = backward.stats.crossing;
    assert.equal(fc.candidatePairsExamined, bc.candidatePairsExamined);
    assert.equal(fc.crossingPairsExamined, bc.crossingPairsExamined);
    assert.equal(fc.pointClassifications, bc.pointClassifications);
    assert.equal(fc.exhaustedBudget, bc.exhaustedBudget);
    assert.deepEqual(forward.diagnostics, backward.diagnostics);
    assert.deepEqual(forward.witness, backward.witness); // witnessPoint is exposed only via witness.point
    assert.equal(forward.overlap, backward.overlap);
    assert.equal(forward.conclusive, backward.conclusive);
    assert.equal(forward.via ?? null, backward.via ?? null);
    assert.deepEqual(
      [...(forward.inconclusiveCauses ?? [])].sort(),
      [...(backward.inconclusiveCauses ?? [])].sort()
    );
    results.push({ pair: source.id ?? null, matched: true });
  }
  writeFileSync(
    `test/performance/results/operand-swap-replay-${Date.now()}.json`,
    JSON.stringify({ totalPairs: pairs.length, results }, null, 2)
  );
});

test('B — the same kernel call is made either way (crossing/aborted/inconclusive are kernel-only fields, not on the wrapper return)', () => {
  // design doc §11 B also requires crossing/aborted/inconclusive bit-identity. Those fields do not
  // exist on volumeOverlapQuery's return, so assert them at the layer that actually carries them: call
  // orientForCrossing both ways, confirm it selects the SAME physical operand as `first` regardless of
  // caller order, then confirm a single properCrossingQuery call with that selection is what both
  // wrapper directions are provably equivalent to (this is the "same kernel call either way" claim).
  const pairs = loadOperandSwapReplaySet();
  for (const { source, target } of pairs) {
    const fwd = orientForCrossing(source, target);
    const bwd = orientForCrossing(target, source);
    assert.equal(fwd.first, bwd.first, 'orientForCrossing must select the same physical operand regardless of caller order');
    assert.equal(fwd.rank, bwd.rank);
  }
});

test('B (kernel-level characterization, NOT a contract) — properCrossingQuery remains directional under a forced A/B swap', () => {
  // Documents that the kernel IS directional (design doc §3.1) — retained as characterization only,
  // never as an invariance assertion. Uses one concrete fixture from the 106-pair set (not a made-up
  // helper) so this test is actually runnable.
  const [{ source, target }] = loadOperandSwapReplaySet();
  const matrixBtoA = source.matrix.clone().invert().multiply(target.matrix);
  const ab = properCrossingQuery(source.bvh, target.bvh, matrixBtoA, source.localDiagonal, target.localDiagonal, {});
  const ba = properCrossingQuery(target.bvh, source.bvh, matrixBtoA.clone().invert(), target.localDiagonal, source.localDiagonal, {});
  // No assertion of equality here — this test exists to be read, documenting expected divergence. `ab`
  // and `ba` are computed so the test is exercisable and does not throw, not to assert anything about them.
  assert.ok(ab && ba);
});
```

- [ ] **Step 3: Run test to verify it fails (against pre-Phase-A reasoning) and passes now**

Run: `node --test test/query/VolumeOverlapQuery.operandSwapReplay.test.mjs`
Expected: PASS (Phase A's implementation, Tasks A1-A3, already landed). Confirm the pre-fix baseline
(66/106 flips) is documented in this task's commit message as the "would have been RED" evidence, per
F5.

- [ ] **Step 4: Commit**

```bash
git add test/query/VolumeOverlapQuery.operandSwapReplay.test.mjs test/performance/results/
git commit -m "test(collision): add regression B — 106-pair operand-swap invariance replay at the wrapper boundary"
```

---

### Task A4.3: Regression C — exact known-unstable pairs, pinned (single-page-load scope)

**Files:**
- Extend: `test/query/VolumeOverlapQuery.operandSwapReplay.test.mjs` or a new
  `test/query/VolumeOverlapQuery.knownUnstablePairs.test.mjs`

**Design basis:** design doc §11 regression C (lines 872-877): the class-B pair (structure frag 537 →
structure frag 427) plus a sample of the 36 unstable `inconclusive-crossing` target fragments.

**Scope note:** the design doc's regression C describes running this "across ≥ 5 independent page
loads" — that is a Viewer/reload capability this plan's unit-test layer cannot exercise directly. This
task covers the **in-process** pinning only (single load, deterministic result for the exact pair, at
the `volumeOverlapQuery` boundary). **The cross-load half is NOT automatically covered by Task D3's
generic cross-reload harness — D3 must be given an explicit step naming this exact pair and its
required per-pair fields, or it silently never runs.** Task D3 (below, Phase D) has been given that
explicit step (Step 3b); confirm it is present before treating this task's deferral as satisfied.

- [ ] **Step 1: Write the failing test**

```js
test('C — the class-B pair (structure frag 537 -> structure frag 427, F6) resolves to a single deterministic disposition, both operand orders', async () => {
  const { source, target } = classB2PairFixture(); // build from the same geometry the research doc
                                                      // cites (F6): L_source=290.969, L_target=3.918
  const forward = await volumeOverlapQuery(source, target);
  const backward = await volumeOverlapQuery(target, source);
  assert.equal(forward.overlap, backward.overlap);
  assert.equal(forward.conclusive, backward.conclusive);
  // Pre-fix, this pair took BOTH values across 14 sessions (F6) -- pin the fixed, single value here.
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `node --test test/query/VolumeOverlapQuery.knownUnstablePairs.test.mjs`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add test/query/VolumeOverlapQuery.knownUnstablePairs.test.mjs
git commit -m "test(collision): pin regression C — class-B pair deterministic disposition (single-load scope)"
```

---

### Task A4.4: Regression F(a) — aggregation determinism under reversed broad-phase visit order

**Files:**
- Confirm/extend: `test/CollisionWorld.findClashes.test.mjs:1117-1199+`

**Design basis:** design doc §11 regression F (lines 892-897), part (a) only — reversed visit order.
Part (b) (cross-reload) is covered by Task D3.

- [ ] **Step 1: Confirm existing tests still pass**

Run: `node --test test/CollisionWorld.findClashes.test.mjs`
Expected: the existing order-independence tests at `:1117-1199+` PASS unmodified (already confirmed by
Task A3.1's Step 4).

- [ ] **Step 2: No new code needed for part (a)** — this sub-item is satisfied by Task A3.1. Record
  that explicitly here so Phase A's gate (Task A5) has a single place confirming full regression-F(a)
  coverage.

- [ ] **Step 3: Commit** — only if any incidental cleanup was needed in Step 1; otherwise this task
  produces no diff and can be marked done without a commit.

---

### Task A5: Phase A gate — full unit suite green

**Files:** none (verification only)

- [ ] **Step 1: Run the full unit suite**

Run: `node --test`
Expected: PASS, in full — this is Phase A's gate per design doc §10 ("Regressions A, B RED→GREEN;
`ductThroughBeamFixture` green without `geometryIndex`").

- [ ] **Step 2: Confirm no direct `properCrossingQuery(` callers were missed**

Run: `grep -rn "properCrossingQuery(" collision/ test/ --include=*.mjs --include=*.js | grep -v "ProperCrossingQuery.js"`

Confirm the only direct-call sites are: `collision/query/VolumeOverlapQuery.js` (production, now
orientation-wrapped per Task A2.1), `test/query/VolumeOverlapQuery.test.mjs:414,437` (legitimate
kernel-level tests), `test/performance/m4/proper-crossing-budget-calibration.mjs:228` (the calibration
harness — **do not touch it in Phase A**, Task B′.1 handles it), and
`test/performance/browser-probes.mjs:229` (the timing probe — Task B′.2 handles it). No other
production call site should exist.

- [ ] **Step 3: Confirm `collision/index.js` is untouched**

Run: `git diff main...HEAD -- collision/index.js` (or the appropriate base ref) — expect no diff. Per
design doc F16/§9.6(b), this fix changes no public export.

- [ ] **Step 4: Stop.** Phase A is complete. Do not proceed to Phase B′ automatically if this plan is
  being executed inline — Phase B′ is a measurement phase that can only run against the real Phase A + A2.3
  (P3) commit, and its own disposition rule is a hard checkpoint (Task B′.4). If subagent-driven
  execution is in use, this is a natural human-review point before continuing.

---

# Phase B′ — Production-path recalibration checkpoint

**This is a hard execution checkpoint. Do not proceed to Phase C until Task B′.4's disposition is
CONFORMANT or CAUTION.** If the disposition is "stop and escalate," this plan's Phase C onward does not
execute until the milestone owner has chosen explicitly among the three named options (design doc §9.4).

### Task B′.1: Route the calibration harness through the production orientation policy

**Files:**
- Modify: `test/performance/m4/proper-crossing-budget-calibration.mjs:228` (the direct
  `properCrossingQuery(...)` call inside the catalogue loop)

**Design basis:** design doc §9.4 "Phase B′ — the required recalibration" table, "Call seam —
CORRECTED" row (lines 737), and §14 finding #7 (lines 996).

- [ ] **Step 1: Read the current catalogue loop in full**

Read `test/performance/m4/proper-crossing-budget-calibration.mjs:206-246` (confirmed by research to be
the `MEASURE_SYNTHETIC` template-literal block evaluated in-page via `page.evaluate`) to understand
exactly how `a`/`b` (the two `testInstance`-shaped operands) are constructed and how the record is
pushed.

- [ ] **Step 2: Replace the direct kernel call with the production seam**

Change the measurement call from:

```js
const t0 = performance.now();
const r = properCrossingQuery(a.bvh, b.bvh, matrixBtoA, a.localDiagonal, b.localDiagonal, { frameBudgetMs: Infinity });
const spanMs = performance.now() - t0;
```

to a two-part measurement that reports both the kernel span and the end-to-end wrapper span, going
through `orientForCrossing` first exactly as production does:

```js
const wrapperT0 = performance.now();
const { first: canonicalFirst, second: canonicalSecond, rank: orientationRank } = orientForCrossing(a, b);
const canonicalFirstIsA = canonicalFirst === a;
const matrixSecondToFirst = canonicalFirstIsA
  ? matrixBtoA
  : matrixBtoA.clone().invert();
const kernelT0 = performance.now();
const r = properCrossingQuery(
  canonicalFirst.bvh, canonicalSecond.bvh, matrixSecondToFirst,
  canonicalFirst.localDiagonal, canonicalSecond.localDiagonal,
  { frameBudgetMs: Infinity }
);
const kernelSpanMs = performance.now() - kernelT0;
const wrapperSpanMs = performance.now() - wrapperT0;
```

Record `kernelSpanMs`, `wrapperSpanMs`, `orientationRank`, and `canonicalFirstIsA` in the pushed record
object alongside the existing fields — do not remove any existing recorded field, since the calibration
doc's cross-comparison (Step 3, Task B′.3) needs both old-shaped and new-shaped fields available.
**State plainly in the harness's own header comment that results are not byte-comparable with Phase B**,
per the design doc's explicit instruction (line 737).

Confirm the exact relative-matrix inversion convention (`matrixBtoA` vs. `matrixSecondToFirst`) against
how `VolumeOverlapQuery.js`'s own production call (Task A2.1) computes its kernel-facing matrix — reuse
that exact logic rather than re-deriving it, to guarantee the harness genuinely exercises "the
production orientation policy" and not merely a parallel reimplementation of it.

- [ ] **Step 3: Confirm the harness still runs standalone (manual verification, not `node --test`)**

Per the file's own header, this harness is not part of `node --test` — it runs manually against a live
dev server. Confirm it still executes without throwing by running whatever manual invocation command
the file's header documents (grep the header comment for the exact command), against a small subset of
the catalogue if a full run is expensive, before Task B′.3's full run.

- [ ] **Step 4: Commit**

```bash
git add test/performance/m4/proper-crossing-budget-calibration.mjs
git commit -m "fix(m4-calibration): route Phase B' calibration harness through orientForCrossing (production seam), report kernel and wrapper spans separately"
```

---

### Task B′.2: Address the second bypass site found during research

**Files:**
- Modify or annotate: `test/performance/browser-probes.mjs:229`

**Design basis:** this site was not cited by the design doc; it was found during this plan's own
research pass. It computes a smallest-call timing probe using a self-pair (`bvh, bvh, identityMatrix,
localDiagonal, localDiagonal, {}`) — i.e. it measures raw kernel call overhead in isolation, not a
realistic operand pair, and does not go through any orientation decision (a self-pair has no meaningful
"canonical order").

- [ ] **Step 1: Confirm this site does not need the production seam**

Read `test/performance/browser-probes.mjs:220-235` in full. Confirm this probe measures constant
per-call overhead (function call + minimal traversal on a self-pair), not a representative workload —
if so, it is **out of scope** for "production call flow" per §9.4, since there is no orientation
decision to make on a self-pair.

- [ ] **Step 2: Add a one-line comment recording the decision**

```js
// This is a self-pair (bvh, bvh) smallest-call overhead probe — it deliberately bypasses
// volumeOverlapQuery/orientForCrossing because there is no meaningful canonical order for an operand
// against itself. Not in scope for Phase B' recalibration (docs/superpowers/specs/
// 2026-09-11-canonical-ordering-operand-symmetry-fix-design.md §9.4).
```

- [ ] **Step 3: Commit**

```bash
git add test/performance/browser-probes.mjs
git commit -m "docs(m4-calibration): record why the self-pair timing probe is out of scope for Phase B' orientation seam"
```

---

### Task B′.3: Run the five case families, append results to the calibration doc

**Files:**
- Modify: `docs/research/proper-crossing-query-deterministic-budget-calibration.md` (append a new
  section; do not edit the existing Phase B results)

**Design basis:** design doc §9.4 "Scope — five case families" row (lines 739): (a) boundary-heavy
pairs, (b) real-model pairs including the pinned Effect B pairs, (c) candidate-saturation cases
(`H1-combs-1500`, the family that produced 15.5ms), (d) early-exit co-occurrence cases, (e) an aggregate
million-candidate pass including per-pair orientation and digest cost end-to-end.

- [ ] **Step 1: Run the harness against both pre-registered runtime tiers**

Execute `test/performance/m4/proper-crossing-budget-calibration.mjs` (per its documented manual
invocation) against both `multiProcess` (authoritative) and `historical` runtime configs, covering all
five case families (a)-(e). Case (e) requires an additional aggregate pass — extend the catalogue loop
or add a dedicated bulk-pass mode if one does not already exist, explicitly measuring per-pair
`orientForCrossing` + digest-comparison overhead in aggregate (not just per-call, since the design doc's
finding #7 requires "measure per-pair orientation cost in aggregate rather than declaring it negligible
from operation counts").

- [ ] **Step 2: Append the results section**

Append a new top-level section to `docs/research/proper-crossing-query-deterministic-budget-calibration.md`
(after the existing Phase B content, do not modify it) titled `## Phase B′ — Post-Orientation-Fix
Recalibration (Corrected Call Seam)`, containing:

- The Phase-A(-of-this-fix)-plus-P3 commit SHA this measurement was taken against.
- `S_worst` (worst single observed synchronous span, wrapper-level), and separately the worst
  kernel-level span, both flagged as **not byte-comparable with Phase B** (different call seam).
- Real-model worst, pathological synthetic worst.
- Count over 8ms, count over 24.8ms, per tier.
- Deterministic cap max/percentile (reuse Phase B's `M_legit` methodology, now against the
  orientation-wrapped call path).
- Digest computation vs. reuse counts (from Task A1.1's cache — confirm the digest is computed once per
  geometry per epoch, not once per pair, by instrumenting a counter for this run only if the existing
  telemetry doesn't already expose it).
- A side-by-side comparison table against Phase B's own headline numbers (15.5ms synthetic worst /
  10.8ms real-model worst), with the seam difference stated plainly next to the numbers.

- [ ] **Step 3: Commit**

```bash
git add docs/research/proper-crossing-query-deterministic-budget-calibration.md
git commit -m "docs(m4-calibration): append Phase B' recalibration results (production orientation seam)"
```

---

### Task B′.4: Apply the disposition rule — hard stop

**Files:** none (decision only)

**Design basis:** calibration doc §14.4, reused verbatim per design doc §9.4: `S_worst ≤ 8ms` →
CONFORMANT; `8 < S_worst ≤ 24.8ms` → CAUTION (status quo, proceed); `S_worst > 24.8ms` → **stop and
escalate to the milestone owner**, who chooses explicitly among (a) accept and proceed, (b) proceed and
treat as direct M4 worker-boundary evidence, (c) authorize a separately-classified search-envelope
reduction. **"The implementer must not choose."**

- [ ] **Step 1: Read Task B′.3's `S_worst` result and classify it**

- [ ] **Step 2a: If CONFORMANT or CAUTION** — record the classification in the same appended section
  from Task B′.3, and proceed to Step 3.

- [ ] **Step 2b: If `S_worst > 24.8ms`** — **STOP.** Do not proceed to Step 3 with a decision line other
  than `PENDING`. Report the three named options to the milestone owner for an explicit decision. This
  plan's remaining phases do not execute until that decision is made and, if it changes any of §4.3's
  ladder/epsilon choices, this plan is revised accordingly before continuing.

- [ ] **Step 3: Write the checkpoint artifact — this is the mechanism that actually enforces the gate**

The prose "STOP" above, by itself, is not an enforcement mechanism — a subagent-driven executor
dispatches Task C1 as an isolated unit with no visibility into this phase's narrative framing. The gate
must be a file a later task is required to read. Create `docs/research/phase-b-prime-checkpoint.md`
containing exactly:

```markdown
# Phase B′ Checkpoint

- P3 commit SHA measured: <sha>
- S_worst (wrapper): <value> ms
- S_worst (kernel):  <value> ms
- Classification: CONFORMANT | CAUTION | BLOCKED_ON_RECALIBRATION
- Milestone-owner decision: PENDING | <verbatim decision text> (<date>)
```

On CONFORMANT or CAUTION, fill in a real decision line only if one was actually sought (CAUTION does not
require owner sign-off per §14.4 branch 2 — leave the line `Milestone-owner decision: N/A (CAUTION is
status quo, proceeds without escalation)`). On `BLOCKED_ON_RECALIBRATION`, the decision line **must**
read `PENDING` until the milestone owner has actually decided — do not write a placeholder decision to
unblock yourself. Commit this file.

```bash
git add docs/research/phase-b-prime-checkpoint.md
git commit -m "docs(m4-calibration): Phase B' checkpoint artifact (<classification>)"
```

---

# Phase C — ProperCrossing deterministic semantic correction (validation only — code already landed)

**Only after B′ approval.** The deterministic-budget fix's *code* (wall-clock-as-telemetry-only, the
three deterministic terminators, the `aborted ⟺ exhaustedBudget !== null` invariant) is **already
landed** at commit `db64324` and verified unchanged by this plan's research pass — see Global
Constraints. **No `frameBudgetMs` retuning happens in this phase.** This phase's job is to run the
budget-fix design's own regression matrix (§13) now that Effect B is fixed and cross-load comparisons
are no longer confounded (design doc §9.5: "Effect B currently forces every Phase C comparison to be
confined to a single page load... Removing Effect B removes that confound").

### Task C1: Confirm the landed invariant is unchanged by Phase A/B′

**Files:** none (verification only)

- [ ] **Step 0 (mandatory, run first, every time this task is dispatched): Verify the Phase B′ gate.**
  Read `docs/research/phase-b-prime-checkpoint.md`. If the file does not exist, if its `Classification`
  line reads `BLOCKED_ON_RECALIBRATION`, or if its `Milestone-owner decision` line reads `PENDING`,
  **abort this task immediately, take no further action in this task or in any later task in Phase C,
  D, or E, and report "Phase B′ gate not satisfied."** Do not substitute your own judgment about
  whether the recalibration result is "probably fine" — design doc §9.4 states explicitly "the
  implementer must not choose." Only proceed to Step 1 below if the file exists with `Classification:
  CONFORMANT` or `Classification: CAUTION`.

- [ ] **Step 1: Diff-check `ProperCrossingQuery.js`'s budget-termination code**

Run: `git diff <commit-before-Phase-A>..HEAD -- collision/query/ProperCrossingQuery.js`

Confirm the only changes in this file across Phases A-B′ are Task A2.3's `surfaceEpsilon` change (C-2)
— the three terminator checks (`candidatePairsExamined > 50_000`, `crossingPairsExamined > 64`,
`pointClassifications >= 1536`), the `exhaustedBudget` single-scalar invariant, and the fault-isolated
telemetry (`elapsedMs`/`timeBudgetExceeded`) must be byte-identical to their pre-Phase-A state.

- [ ] **Step 2: Record the confirmation** in this task's notes — no commit needed if the diff is
  exactly as expected (Task A2.3's change only).

---

### Task C2: Original hard-clash-precheck blocker pair — cross-reload, N≥10

**Files:**
- Extend: `test/performance/run-gate-m4.mjs` (this needs the Playwright/Viewer harness — it is not a
  pure unit test) or wherever the existing single-page-load version of this test lives (budget-fix
  design §13 regression A, lines 932-946) — locate and extend it.

**Design basis:** budget-fix design §13 regression A: pair `structure:3547/frag363 →
architecture:3551/frag30`, federated Audubon fixture, both arms; assert `conclusive===true`,
`excluded`, `inconclusiveCauses===[]`, stable across N≥10 runs. This is the same pair Task A4.3 pinned
at single-load scope — this task extends it across genuine reloads.

- [ ] **Step 1: Locate the existing single-load version of this test**

Grep for `3547` and `frag363` across `test/` to find where this exact pair is already exercised (the
budget-fix design's own Phase C landed this as part of `db64324` — confirm whether a cross-load variant
already exists or only a single-load one).

- [ ] **Step 2: Write or extend the cross-reload variant**

If only a single-load version exists, extend it (or add a sibling test in the same file) to reload the
page between comparable runs (reuse `run-gate-m4.mjs`'s `page.reload()` + `loadFixtureAndReconfirm()`
pattern from `:3143-3144`), asserting `conclusive`, `excluded`/disposition, and `inconclusiveCauses` are
identical across ≥10 loads. Note this genuinely depends on Phase A already having landed — before Phase
A this pair's disposition was the entire subject of the Effect B investigation and was expected to be
unstable.

- [ ] **Step 3: Run and confirm stability**

Run the extended harness (via whatever command invokes `run-gate-m4.mjs` scenarios, or a scoped
sub-invocation if one exists) and confirm N≥10 identical dispositions.

- [ ] **Step 4: Commit**

```bash
git add test/performance/run-gate-m4.mjs # or the actual file modified
git commit -m "test(m4): confirm hard-clash-precheck blocker pair stable across >=10 reloads, now unconfounded by Effect B"
```

---

### Task C3: Same-arm repeat stability (kernel/CollisionWorld level)

**Files:**
- Extend: wherever budget-fix design §13 regression F ("Same-arm repeated stability") currently lives,
  or add alongside Task C2's harness.

**Design basis:** budget-fix design §13: N≥10 runs each under TLAS-only and linear-only; assert zero
semantic/statistics drift within each arm.

- [ ] **Step 1: Confirm or add the N≥10 same-arm repetition test**, scoped to `properCrossingQuery`/
  `volumeOverlapQuery`-level output (distinct from Task D2's broader gate-level same-arm repetition,
  which exercises the full `CollisionWorld` clash-finding pipeline — this task stays at the narrower
  kernel/wrapper level per the budget-fix design's own scope).

- [ ] **Step 2: Run and confirm zero drift.**

- [ ] **Step 3: Commit.**

---

### Task C3b: Budget-fix §13 B — arm-order independence (live gate, declared gap in the landed tests)

**Files:**
- Extend: `test/performance/run-gate-m4.mjs`

**Design basis:** budget-fix design §13 B (lines 948-955): same operands, varying predecessor/candidate
order, both arms/broad-phases; assert identical disposition, `conclusive`, `inconclusiveCauses`, all
three crossing counters, `exhaustedBudget`.

**Why this needs its own task rather than being assumed covered:** the *unit-level* half of §13 B
(predecessor/warm-up order) is already landed at
`test/query/ProperCrossingQuery.deterministic.test.mjs:131-188`. That file's own header
(`:20-28`) **explicitly declares the arm-order half (TLAS-first vs. linear-first, both broad phases) out
of scope and live-gate-only** — it is not reachable from a unit test. Phase C's whole purpose is
validating budget-fix §13 now that Effect B is fixed and cross-arm comparisons are unconfounded; this is
the one piece of §13 with no task anywhere in this plan unless added explicitly here.

- [ ] **Step 1: Confirm the declared gap** — read `test/query/ProperCrossingQuery.deterministic.test.mjs:20-28`
  and confirm it still states the arm-order half is live-gate-only (if a future change has closed this
  gap at the unit level, skip to Step 3 and just confirm the existing coverage).

- [ ] **Step 2: Close it via `run-gate-m4.mjs`** — run the same operand pair under both arm orders
  (`tlas>linear`, `linear>tlas`) and both broad phases, asserting identical precheck disposition,
  `conclusive`, `inconclusiveCauses`, `containmentSamplesUsed`, all three crossing counters, and
  `exhaustedBudget`.

- [ ] **Step 3: Run and confirm stability.**

- [ ] **Step 4: Commit**

```bash
git add test/performance/run-gate-m4.mjs
git commit -m "test(m4): close budget-fix §13 B's declared arm-order gap via the live gate"
```

---

### Task C4: Fake/frozen-clock independence — confirm unchanged

**Files:**
- Confirm: existing clock-injection tests (budget-fix design §13 regression C: four injected clocks —
  frozen, real, `1e9`-on-first-read, +10s/read)

- [ ] **Step 1: Locate the existing test** (grep for clock-injection patterns in
  `test/query/ProperCrossingQuery.instrumentation.test.mjs` or `.deterministic.test.mjs`).

- [ ] **Step 2: Run it and confirm PASS, unchanged** — this test should be entirely unaffected by
  Phase A (which touches orientation and coplanarity epsilon, not clock handling). If it does not exist
  yet despite the budget-fix design specifying it, write it now, matching budget-fix design §13's exact
  four-clock specification, and confirm `crossing`/`aborted`/`inconclusive`/`diagnostics`/`witnessPoint`/
  counters are identical across all four clocks, with only `timeBudgetExceeded`/`elapsedMs` differing.

- [ ] **Step 3: Commit only if new code was added.**

---

### Task C5: Deterministic cap exhaustion — confirm D1/D2/D3 coverage

**Files:**
- Confirm/extend: `test/query/ProperCrossingQuery.test.mjs` (the `CAP = 7` test at `:259-280` covers
  D3 — `maxCrossingPointClassifications`)

**Design basis:** budget-fix design §13 regression D: D1 (lower `maxCandidatePairsExamined` →
`exhaustedBudget === 'candidate-pairs'`), D2 (lower `maxCrossingPairsExamined` →
`'crossing-pairs'`), D3 (lower `maxCrossingPointClassifications` → `'point-classifications'`,
already covered by the `CAP = 7` test per research). Each: N≥10 runs, no clock injected, identical
counters/diagnostics/`exhaustedBudget` every run.

- [ ] **Step 1: Confirm D3 coverage** — read `test/query/ProperCrossingQuery.test.mjs:259-280` and
  confirm it asserts `exhaustedBudget === 'point-classifications'` (not just the raw count) and repeats
  N≥10 times, or extend it to add the repetition/exhaustedBudget assertions if missing.

- [ ] **Step 2: Check for D1/D2 coverage** — grep for `maxCandidatePairsExamined` and
  `maxCrossingPairsExamined` overrides in the same file/glob. If either is missing, add it, mirroring
  the `CAP = 7` test's structure exactly but overriding the other constant.

- [ ] **Step 3: Run and confirm all three pass, N≥10 each.**

- [ ] **Step 4: Commit any additions.**

---

### Task C6: Telemetry threshold crossing with unchanged semantics — confirm coverage

**Files:**
- Confirm/extend: wherever the existing `timeBudgetExceeded` assertion lives.

**Design basis:** budget-fix design §13 regression H(iii) / this design doc's regression H(iii): inject
a slow `now()`, require `timeBudgetExceeded: true` to change no semantic field.

- [ ] **Step 1: Locate and run the existing test.** If missing, add it: inject a `now()` that reports
  elapsed time past `frameBudgetMs`, and assert `crossing`/`aborted`/`inconclusive`/counters/witness are
  identical to a run with a fast clock — only `timeBudgetExceeded`/`elapsedMs` differ.

- [ ] **Step 2: Commit any additions.**

---

### Task C7: Phase C gate

**Files:** none (verification only)

- [ ] **Step 1: Run the full budget-fix regression set**

Run: `node --test test/query/ProperCrossingQuery*.test.mjs`
Expected: PASS in full.

- [ ] **Step 2: Confirm no `frameBudgetMs` value was retuned anywhere in Phase C** — `git diff` across
  Tasks C1-C6, C3b should show zero changes to any `frameBudgetMs`/`maxCandidatePairsExamined`/
  `maxCrossingPairsExamined`/`maxCrossingPointClassifications` **default value** in
  `collision/constants.js`. Test-local overrides (as in the `CAP = 7` pattern) are expected and fine.

- [ ] **Step 3: Confirm every budget-fix design §13 item (A through H) maps to a completed task or a
  recorded, justified deferral** — A→C2, B→C3b, C→C4, D→C5, E→D1 (Phase D, not duplicated here), F→C3/D2,
  G→ (folded into Phase D's regression G, Task D4), H→ folded into C7 Step 1's glob run plus Task D7
  (Phase D). If any letter has neither a task nor a recorded deferral, stop and add one before
  proceeding to Phase D.

---

# Phase D — Composition regressions and compatibility

### Task D1: S2 k=100 focused parity re-run

**Files:** none (execution only — this exercises `test/performance/run-gate-m4.mjs`'s existing S2
scenario matrix, defined at `S2_INSTANCE_LEVELS` line 1779 and the `case 'S2':` block at `:1803-1817+`)

**Design basis:** design doc §11 regression D: re-run `S2[k=100:typical:clearance]` under the full,
unrelaxed §6.4 comparator, N≥10 clean runs.

- [ ] **Step 0 (mandatory, run first): Verify the Phase B′ gate is still satisfied.** Re-read
  `docs/research/phase-b-prime-checkpoint.md` (Task B′.4 Step 3). If a resumed session is entering Phase
  D directly (skipping Phase C in this dispatch), this check must still run — do not assume an earlier
  session already verified it. Abort per Task C1 Step 0's exact rule if not satisfied.

- [ ] **Step 1: Run the gate**

Run: `npm run test:performance:gate:m4` (there is no CLI flag to select only the `k=100:typical:clearance`
tuple — it runs as part of the full case matrix per runtime, per research). Run this N≥10 times, or
confirm the harness already loops N≥10 internally for this tuple (check `S2_INSTANCE_LEVELS`/the case
matrix's repetition config).

- [ ] **Step 2: Assert full §6.4 parity, unrelaxed**

Confirm, per §6.4 (`docs/superpowers/specs/2026-09-08-...design.md:388-404`, do not edit): pair set
equality, bit-identical `distance` for TLAS-vs-linear, witness tolerance `1e-9 × max(sourceWorldDiagonal,
targetWorldDiagonal)`, statistics field equality (including `clearanceDistanceQueriesRun`,
`clearanceHardClashExclusions`), diagnostics multiset equality — **and confirm
`TIME_BUDGET_DIAGNOSTIC_DIVERGENCE` does not fire**. If it fires, that is a finding to report, not a
pass condition to work around (§6.4 is not edited by this plan).

- [ ] **Step 3: Record the result** in a new file under `docs/research/` (e.g.
  `m4-s2-k100-post-canonical-ordering-fix-parity.md`) or append to an existing tracking doc if this
  repo already has a convention for gate-result write-ups — check `docs/research/` for a precedent
  before creating a new file.

- [ ] **Step 4: Commit** (results doc only; no production code changes in this task).

---

### Task D2: Same-arm repeated stability (gate-level, TLAS-only and linear-only)

**Files:** none (execution only)

**Design basis:** design doc §11, and the prompt's Phase D2: "Run focused workload repeatedly under
TLAS-only and linear-only. Require semantic/statistical stability." This is the broader, full-pipeline
counterpart to Task C3's narrower kernel-level same-arm check.

- [ ] **Step 1: Run the gate's focused workload N≥10 times under each arm forced independently**

Use whatever CLI/env mechanism `run-gate-m4.mjs` already exposes to force TLAS-only vs. linear-only
(check the file for an existing flag/env var — do not invent a new one if one already exists).

- [ ] **Step 2: Assert zero semantic/statistical drift within each arm** across the N≥10 runs.

- [ ] **Step 3: Record and commit results**, same convention as Task D1.

---

### Task D3: Cross-reload parity (regression E) + aggregation determinism across reload (regression F part b)

**Files:**
- Extend: `test/performance/run-gate-m4.mjs` (reuse the `attributionPoisoned` recovery pattern at
  `:3143-3144` — `page.reload()` + `loadFixtureAndReconfirm(page)` — as the reload mechanism, not as a
  literal reuse of that recovery *codepath*, just its reload-and-reconfirm idiom)

**Design basis:** design doc §11 regression E (lines 884-890) and regression F part (b) (line 896):
both require a genuine Viewer reload, which is why they're grouped here rather than in Phase A/C.

- [ ] **Step 1: Write the cross-reload harness**

Run the identical query in two independent page loads, and separately across a mid-run
`page.reload()` + `loadFixtureAndReconfirm()`. Require §6.4-field equality **between loads**. Pre-fix
this was RED by `clearanceDistanceQueriesRun` oscillating 129 ↔ 130 and by 56 entering/leaving
diagnostic entries (per design doc).

- [ ] **Step 3b: Regression C's cross-load half — pin the exact pair, do not rely on the generic
  harness alone.** Task A4.3 pinned the class-B pair (`structure frag 537 → structure frag 427`,
  `L_source = 290.969` / `L_target = 3.918`, design §11 C, lines 872-877) at single-load scope and
  explicitly deferred its cross-load half to this step. Within the same reload harness built in Step 1,
  replay this exact pair plus a sample of ≥ 5 of the 36 unstable `inconclusive-crossing` target
  fragments named in the research doc §6.5a, across ≥ 5 independent page loads (not just the 2-load
  comparison Step 1 otherwise does — regression C specifically requires ≥ 5). For each, assert a
  **single** value across all loads for: precheck disposition, `conclusive`, `inconclusiveCauses`,
  whether it contributed to `clearanceHardClashExclusions`, and whether the distance query ran. Pre-fix
  the class-B pair took **both** values across 14 sessions (F6) — this is the regression that pins the
  exact case the Effect B investigation was opened for; do not treat it as satisfied by the generic
  2-load harness above.

- [ ] **Step 2: Add the two pending §9.2 measurements**

Per design doc line 888-890: assert the `fragId → (worldMatrixHash, ownerDbId)` maps are identical
across loads, and report (not assert — this is informational, per the design doc's own framing) how
many fragment pairs share a world matrix (rank 4's real discriminating power, previously unmeasured per
finding #1).

- [ ] **Step 3: Add regression F part (b)**

Within the same reload harness, additionally verify: two candidate fragment pairs collapsing onto one
dbId key with bit-identical `distance` and same-kind witnesses select the same winner **across two page
loads with different `geometryIndex` assignments** — compare the full **witness payload**, not just
presence (closing research doc limitation 3, per design doc line 897).

- [ ] **Step 4: Run and confirm all assertions pass**

- [ ] **Step 5: Commit**

```bash
git add test/performance/run-gate-m4.mjs
git commit -m "test(m4): add regression E (cross-reload M4 parity) and regression F(b) (cross-reload aggregation determinism)"
```

---

### Task D4: M1/M2/M2.1/M3 compatibility (regression G)

**Files:** none (execution + classification only)

**Design basis:** design doc §11 regression G (lines 899-904).

- [ ] **Step 1: Run the full compatibility suite**

Run, in order:
```bash
node --test
npm run test:acceptance:clash-finder
npm run test:performance:gate      # M1
npm run test:performance:gate:m2   # M2 (M2.1 rides along per research — no separate script)
npm run test:performance:gate:m3   # M3
```

- [ ] **Step 2: Classify every changed result or diagnostic**

For each difference from the pre-Phase-A baseline, classify as exactly one of:
- (i) a borderline pair whose verdict changed in the direction §4.0 predicts (small-operand orientation
  previously lost a crossing; large-first orientation now finds it);
- (ii) a counter shift explained by the tightened coplanarity epsilon (more candidate pairs admitted to
  the probe ladder);
- (iii) an aggregation winner or witness-payload change explained by Decision 5
  (`compareAggregationIdentity` dropping `geometryIndex`);
- (iv) **unexplained — which blocks.**

Do not silently accept a changed gate result. Do not silently update golden/expected fixtures without
this classification recorded per changed item.

- [ ] **Step 3: Record the classification** in `docs/research/m4-final-focused-review.md` (if this is
  the repo's existing convention for such write-ups — confirm) or a new dedicated doc, listing every
  changed item with its classification and evidence.

- [ ] **Step 4: If any item is classified (iv) unexplained, STOP** — investigate before proceeding to
  Phase E. Do not proceed with an unexplained gate change outstanding.

- [ ] **Step 5: Commit the classification doc.**

---

### Task D5: Aggregation determinism (regression F, consolidated)

**Files:** none (verification only — this consolidates Tasks A4.4 and D3's Step 3)

- [ ] **Step 1: Confirm both halves of regression F are green**: part (a) reversed broad-phase visit
  order (Task A4.4, already green) and part (b) cross-reload (Task D3 Step 3, already green). No new
  work — this task exists only to record the consolidated gate status before Phase E.

---

### Task D6: Documentation updates (design doc P4)

**Files:**
- Modify: M1 design spec's Tolerances table and "Canonical operand order" paragraph (locate in
  `docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md` — confirm exact section by
  grepping "Canonical operand order" and "Tolerances" in that file)
- Modify: `collision/README.md` (if it exists — check first)
- Modify: `CHANGELOG.md`
- Modify: the M4 implementation plan's Task 4.5 replica-justification text
  (`docs/superpowers/plans/2026-09-09-...implementation.md:11007-11018`, `:10531-10543`)

**Design basis:** design doc §9.6 table (line 796) and §10 P4 (line 828).

- [ ] **Step 1: Update M1's Tolerances table**

`minPenetrationDepth = 1e-5 × L_canonical` keeps its formula text but its definition of `L_canonical`
moves to "the larger of the two operands' world diagonals" — update the prose to state this is now
well-defined and achievable per pair (per design doc §9.6, this was previously unachievable —
`1e-5 × D_min` was never the actual formula in effect). Update the "Canonical operand order" paragraph
to describe `orientForCrossing`'s total order instead of the deleted identity comparator.

- [ ] **Step 2: Update `collision/README.md`** (if present) to describe the kernel/wrapper layer
  contract (design doc §3.1) — `properCrossingQuery` is directional, `volumeOverlapQuery` is canonical.

- [ ] **Step 3: Add a `CHANGELOG.md` entry**

Per design doc line 816: "Observable results will change for borderline pairs, in the direction of
recovering crossings the small-operand orientation silently lost." State this plainly as a behavioral
change, not preserved for backward compatibility, and note the internal API migration
(`options.compareCanonical` removed, now throws).

- [ ] **Step 4: Rewrite the M4 plan's Task 4.5 replica text**

The `compareIdentityCanonically` function at M4 plan `:11007-11018` and its "Critical #3" justification
at `:10531-10543` are both justified by "fidelity to production's `compareCanonical` option" — that
option no longer exists after this fix (Task A2.1). Since Task 4.5 is a Phase-4-conditional, currently
unbuilt spike (confirmed by research — `spike/m4/s7-precheck/` does not exist), rewrite its planning
text to either (a) reference `compareAggregationIdentity`'s narrow role instead, noting that the S7′
precheck vertical's fidelity concern about tolerance/traversal-order sensitivity is now moot at the
identity-comparator level (orientation is no longer identity-driven at all) but may still need its own
fidelity check against `orientForCrossing` if/when Task 4.5 is ever activated, or (b) mark the passage
as superseded and point to this fix's design doc for the current orientation mechanism. Do not implement
Task 4.5 itself — this is a documentation-only edit to planning text for unbuilt, conditionally-gated
work.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md collision/README.md CHANGELOG.md docs/superpowers/plans/2026-09-09-collision-library-milestone4-performance-worker-decision-implementation.md
git commit -m "docs(collision): update M1 tolerances/canonical-order docs, CHANGELOG, and M4 Task 4.5 replica text for the operand-symmetry fix"
```

---

### Task D7: Regression H — composition with the deterministic budget

**Files:**
- Create: `test/query/VolumeOverlapQuery.budgetComposition.test.mjs`

**Design basis:** design doc §11 regression H (lines 906-912).

- [ ] **Step 1: Write the three regimes, at the wrapper**

**Field paths (same ground truth as Task A4.2 — reuse it, do not re-derive):** `exhaustedBudget`,
`timeBudgetExceeded`, `elapsedMs` and the three crossing counters live at `result.stats.crossing.*`.
`crossing` and `aborted` are kernel-record fields not present on the wrapper's public return at all —
assert them via the same `orientForCrossing` + direct `properCrossingQuery` pattern Task A4.2's second
test uses, not directly on the wrapper's result.

```js
test('H(i) — normal completion is bit-identical under both public-role orders', async () => { /* ... */ });

test('H(ii) — deterministic budget exhaustion (each exhaustedBudget value, including a deliberately binding lowered maxCrossingPointClassifications) is bit-identical under both public-role orders', async () => {
  const duct = testInstance(box(20, 0.4, 0.4));
  const beam = testInstance(box(0.4, 0.4, 20));
  const forward = await volumeOverlapQuery(duct, beam, { crossing: { maxCrossingPointClassifications: 4 } });
  const backward = await volumeOverlapQuery(beam, duct, { crossing: { maxCrossingPointClassifications: 4 } });
  assert.equal(forward.stats.crossing.exhaustedBudget, backward.stats.crossing.exhaustedBudget);
  assert.equal(forward.overlap, backward.overlap);
  assert.equal(forward.conclusive, backward.conclusive);
  // repeat for maxCandidatePairsExamined and maxCrossingPairsExamined overrides
});

test('H(iii) — wall-clock telemetry threshold crossing changes no semantic field', async () => {
  const duct = testInstance(box(20, 0.4, 0.4));
  const beam = testInstance(box(0.4, 0.4, 20));
  const slowNow = () => /* injected clock past frameBudgetMs */;
  const fastNow = () => /* real/fast clock */;
  const slow = await volumeOverlapQuery(duct, beam, { crossing: { now: slowNow } });
  const fast = await volumeOverlapQuery(duct, beam, { crossing: { now: fastNow } });
  assert.notEqual(
    slow.stats.crossing.timeBudgetExceeded,
    fast.stats.crossing.timeBudgetExceeded
  ); // the ONE field allowed to differ
  assert.equal(slow.stats.crossing.exhaustedBudget, fast.stats.crossing.exhaustedBudget);
  assert.equal(slow.overlap, fast.overlap);
  assert.equal(slow.conclusive, fast.conclusive);
});
```

- [ ] **Step 2: Run and confirm PASS.**

- [ ] **Step 3: Commit**

```bash
git add test/query/VolumeOverlapQuery.budgetComposition.test.mjs
git commit -m "test(collision): add regression H — deterministic-budget composition at the wrapper boundary"
```

---

### Task D8: Phase D gate

- [ ] **Step 1: Confirm Tasks D1-D7 all produced a green result or a fully-classified (i)/(ii)/(iii)
  change** — no (iv) unexplained items outstanding (Task D4 Step 4's stop condition).

- [ ] **Step 2: Stop.** Phase D is complete. Proceed to Phase E only once every item above is
  confirmed.

---

# Phase E — Return to M4 Phase 3 canonical matrix

**Only after Phase D's focused validation is green** (Task D8).

### Task E1: Full Phase 3 canonical matrix

**Files:** none (execution only)

- [ ] **Step 0 (mandatory, run first): Verify the Phase B′ gate is still satisfied.** Same check as Task
  C1 Step 0 and Task D1 Step 0 — re-read `docs/research/phase-b-prime-checkpoint.md`, abort per the same
  rule if not `CONFORMANT`/`CAUTION`. Re-verify here even if an earlier phase in the same dispatch chain
  already checked it — a resumed or re-entrant session must not assume state from a prior, possibly
  different, execution context.

- [ ] **Step 1: Run the full baseline gate on both runtime configs**

Run `npm run test:performance:gate:m4` end-to-end (both `multiProcess` and `historical` tiers per M4
plan File 2's Phase 3 baseline harness), covering the complete case matrix (not just S2 k=100 — the full
Phase 3 matrix M4's own plan defines).

- [ ] **Step 2: Confirm §6.4 validation** across the complete matrix (not just Task D1's focused S2
  k=100 slice) — every scenario's pair set, distance, witness, statistics, diagnostics comparator per
  `docs/superpowers/specs/2026-09-08-...design.md:388-404`.

---

### Task E2: Valid population only; recompute checkpoint evidence from scratch

**Files:** none (execution + analysis only)

- [ ] **Step 1: Discard previous failed/provisional runs** — per the prompt's Phase E instructions,
  "Previous failed runs and provisional D remain diagnostic-only." Do not merge stale evidence from
  before this fix landed into the fresh evidence vector.

- [ ] **Step 2: Recompute from the fresh, valid population only.**

---

### Task E3: Checkpoint report — scoped correctly against the actual M4 checkpoint artifacts

**Files:**
- Create: a checkpoint report doc (e.g.
  `docs/research/m4-phase3-checkpoint-post-canonical-ordering-fix.md`)

**Important scoping note, found during this plan's own research (Task D4-equivalent research pass,
agent 5):** the M4 implementation plan's actual Phase 3→4 decision checkpoint
(`docs/superpowers/plans/2026-09-09-...implementation.md:8700-8741`) produces a **narrower** field set
than the prompt's requested report list — it reads only the §6.3 main-only/transferable partition and
the §7.2 target evaluation to decide Phase 4 spike activation. The richer field set (mandatory-D
conditions, T-a-failing tuples, T-b/T-c-only failures, a reducer result) belongs to Task 5.3's §26
**final evidence report** (M4 plan `:12264-12363`), which only runs after Phase 5's reducer invocation —
and **the reducer itself (`test/performance/m4/verdict-reducer.mjs`) does not exist as code** (M4 plan
Task 2.5, `:4193-4372`, is unbuilt).

This plan's own Phase E checkpoint report is therefore a **bespoke document for this fix's own
purposes** — it borrows M4's vocabulary to stay legible to the M4 restart sequence, but does not (and
cannot) literally invoke Task 5.3's artifact or Task 2.5's reducer. Produce it as follows:

- [ ] **Step 1: Fixture/runtime validity** — report which scenarios in Task E1's run were valid
  (completed, no harness failure) vs. invalid, per runtime tier.

- [ ] **Step 2: §6.4 status** — pass/fail per scenario from Task E1 Step 2, plus a count of any
  `TIME_BUDGET_DIAGNOSTIC_DIVERGENCE` findings (expected zero, per design doc §7's stated expectation
  that this carve-out should have "nothing left to excuse" post-fix).

- [ ] **Step 3: R-case T-a/T-b/T-c** — read the emitted §7.2 target evaluation
  (`{Ta,Tb1,Tb2,Tc}`, per the evidence-record schema at M4 plan `:8793-8794`) from Task E1's gate output,
  per R-case (R1-R6, defined at M4 design `:178-205`).

- [ ] **Step 4: main-only/transferable attribution** — read the §6.3 partition
  (M4 design `:368-387`) from Task E1's gate output.

- [ ] **Step 5: Active mandatory-D conditions** — manually evaluate the ten conditions enumerated at
  M4 design `:527-556` against the fresh evidence vector (this is the "manually-documented application"
  the Global Constraints section calls for, since Task 2.5's reducer code doesn't exist to automate
  it). Report which conditions are active.

- [ ] **Step 6: T-a-failing tuples; T-b/T-c-only failures** — enumerate directly from Task E1's raw
  per-tuple results, filtering for tuples failing T-a specifically vs. tuples failing only T-b/T-c.

- [ ] **Step 7: Authorized Phase 4 spikes** — apply the M4 plan's own activation conditions
  (`:8716-8735`) to the fresh evidence to determine which of Tasks 4.1/4.2/4.3-4.7/4.8 would be
  authorized. **Do not build any of them** — this is a reporting step only, per the Global Constraints'
  "no production worker architecture" rule.

- [ ] **Step 8: Provisional reducer result from the new VALID population only** — since Task 2.5's
  reducer does not exist as code, produce this by manually walking the fresh evidence vector through
  the M4 design's own §7.3 evidence→verdict mapping and §7.5 mandatory-D precedence rules
  (`docs/superpowers/specs/2026-09-08-...design.md:435-556`) by hand, documenting each rule applied and
  its input evidence. Label this section explicitly: **"Manually derived — Task 2.5's automated reducer
  does not exist yet; this is not a code-invocation result."**

- [ ] **Step 9: Commit the checkpoint report**

```bash
git add docs/research/m4-phase3-checkpoint-post-canonical-ordering-fix.md
git commit -m "docs(m4): Phase 3 canonical checkpoint report post-canonical-ordering-fix (VALID population only)"
```

---

### Task E4: Stop

**Files:** none.

- [ ] **Step 1: Confirm the checkpoint report (Task E3) is complete and committed.**

- [ ] **Step 2: STOP.** Do not start M4 Phase 4 automatically. Do not evaluate Phase 4 authorization
  beyond Task E3 Step 7's reporting. Hand the checkpoint report to the milestone owner for the M4
  restart sequence's own next decision (M4 restart sequence item 9: "Only then evaluate Phase 4
  authorization").

---

# Self-review notes (recorded per the writing-plans skill's Self-Review step)

**Spec coverage:** every numbered goal in the source prompt
(`docs/prompts/canonical-ordering-operand-symmetry-implementation-plan-prompt.md`) maps to a phase
above: (1)-(4) → Phase A; (5) → Phase B′; (6) → Phases A2.3 (epsilon) + C (validation) + D3
(cross-reload); (7) → Phase E; (8) → enforced throughout via Global Constraints (no worker
architecture created anywhere in this plan).

**Drift found during research and corrected in this plan, rather than silently inherited from the
design doc's citations:**
- `ClearanceQuery.js:3` also imports from `VolumeOverlapQuery.js` (just `toFiniteWorldArray`) —
  flagged for awareness in Task A2.1's file list; no action needed since it doesn't touch
  `compareCanonical`.
- The design doc's cited pinned counters `=== 26`/`=== 5` do not currently exist verbatim; the actual
  pin is `CAP = 7` at `ProperCrossingQuery.test.mjs:259-280` — Task A2.3 Step 5 re-verifies against
  actual pins at execution time rather than assuming the doc's citation.
- `test/performance/browser-probes.mjs:229` is a second direct `properCrossingQuery` bypass site the
  design doc did not cite — addressed explicitly in Task B′.2.
- The M4 plan's actual Phase 3→4 decision checkpoint produces a narrower field set than the prompt's
  requested Phase E report, and the M4 verdict reducer does not exist as code — both addressed
  explicitly in Task E3's scoping note rather than silently promising something this plan cannot
  deliver.

**Placeholder scan:** no task above defers content to "TBD"/"similar to Task N"/"add appropriate
handling." Where exact production code cannot be pinned without reading the file at execution time
(e.g., exact current accessor names in `toInstance`, exact `weldedGeometry` field shapes), the task
says explicitly what to confirm and why, rather than asserting an unverified line number as fact — this
reflects the research agents' own confirmed current-line-number findings everywhere those were
available, and flags the few remaining execution-time confirmations explicitly rather than guessing.

**Type/interface consistency:** `orientForCrossing`'s return shape (`{ first, second, rank }`) is
defined once in Task A1.2 and consumed identically in Tasks A2.1, A2.4, and B′.1 — no renamed field
across tasks. `geometryDigest` is produced once in Task A1.1, forwarded once in Task A1.2 Step 5, and
consumed by name (never renamed) in Task A1.2's `orientForCrossing` and Task A4.1's regression A.5.

**Implementation-plan-specific review pass (post-write, two independent agents — one on plan structure,
one re-verifying Phase A's source citations against actual current code):** found and fixed 3 Critical
and 8 High findings.

Critical, fixed:
1. Task A1.1 originally used `node:crypto`/`Buffer` inside `collision/blas/ThreeMeshBvhBackend.js` —
   `collision/` is served raw to the browser with zero `node:` imports today; this would have broken
   both Viewer extensions and every Playwright harness later phases depend on. Replaced with a
   dependency-free FNV-1a-32×4-lane digest (`collision/geometry/contentDigest.js`) using only
   `DataView`/`Uint8Array`, plus a browser-load verification step.
2. Task B′.4's "hard stop" was prose only, with nothing in Task C1 that actually checked it — a
   subagent dispatched Task C1 in isolation would never see it. Added a required checkpoint artifact
   (`docs/research/phase-b-prime-checkpoint.md`, Task B′.4 Step 3) and a mandatory Step 0 gate-check,
   repeated in Tasks C1, D1, and E1, that aborts if the file is missing, blocked, or pending.
3. Task A4.2's regression B (and Task D7's regression H) asserted directly on `forward.crossing`,
   `.aborted`, `.candidatePairsExamined`, `.witnessPoint`, etc. — none of these exist on
   `volumeOverlapQuery`'s actual return shape (verified against source: they live under
   `result.stats.crossing.*`, or not on the wrapper at all). Every such assertion was comparing
   `undefined === undefined` and passing vacuously — on the plan's single strongest regression, the one
   pinning the entire 106-pair fix evidence. Corrected to the verified field paths in both tasks.

High, fixed: `inconclusiveCauses` accessed without a `?? []` guard (throws on the positive-result path,
Tasks A2.1/A4.1); `assert.throws` used on an `async` function that can only reject, never throw
synchronously (Task A2.1); a RED-test fixture whose `fragmentId` nesting contradicted the task's own
implementation code, so the test would stay red after a correct fix (Task A3.1); `geometryDigest` never
reaching `test/fixtures/geometry.mjs`'s `testInstance` (the operand factory every test in the plan uses),
so rank 5 — and regression A.5, whose entire purpose is proving rank 5 — was dead in every test (Task
A1.2 Step 5, Task A4.1); `orientForCrossing`'s documented return shape included a field
(`canonicalFirstIsSource`) the implementation never returns, and `worldDiagonal` was consumed by Task
A2.4 without being exported anywhere (Task A1.2); regressions A.2/A.4/A.5 were written as swap-equality
comparisons that are tautologies once the fix lands, rather than the absolute assertions the design doc
actually requires (Task A4.1); regression C's cross-load half (the exact pair the Effect B investigation
was opened for) was deferred to Task D3 with no matching step actually written there (Task A4.3 scope
note + new Task D3 Step 3b); budget-fix design §13 B's arm-order half — explicitly declared out-of-scope
in the landed test file's own header — had no task anywhere in Phase C (new Task C3b).

Not fixed (Medium/Low, out of scope per review instructions — recorded by the review agent, not
re-litigated here): a commit-ordering gap where `CollisionWorld` tests are broadly red between Tasks
A2.1 and A2.2; the plan's phase-A task order runs P2/P3 before P1 relative to the design doc's own
sequencing, losing P1's isolated behaviour-preserving gate; a diagnostic-event-recorder test snippet
using the wrong callback arity; `test/performance/results/` being gitignored, so Task A4.2's `git add`
on that path is a no-op; a few stale line-number citations and one unwritten test-helper stub. None of
these affect correctness of the fix itself or block execution — an executor will surface them in the
normal course of following each task's own "confirm by reading" instructions.

No design decision was reopened — every fix above corrects the PLAN's implementation of an already-
settled design decision (wrong field paths, wrong runtime assumptions, missing enforcement mechanism),
never the decision itself.

---

**Ready for execution**
