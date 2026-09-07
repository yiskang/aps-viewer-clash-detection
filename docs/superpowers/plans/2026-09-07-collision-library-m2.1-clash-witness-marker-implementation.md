# M2.1 — Clash Witness Marker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a non-null `witness: {kind, point} | null` field to every `volume-overlap` `ClashPair`, and render a visible Viewer overlay marker at that witness location in `ClashFinderExtension`, without changing Hard Clash truth semantics.

**Architecture:** Retain (don't recompute) a proven-interior point already sitting in a local variable at the exact success statement inside `properCrossingQuery` and `anyComponentInside`/`constructedInteriorWitness`; clone it to escape module-level scratch reuse; transform it to Viewer scene coordinates inside `volumeOverlapQuery` (the one place that has both the point and both operands' world matrices); thread it through `_runNarrowPhasePair` as a structured `{hit, witness}` result (volume-overlap only); pick one witness per dbId-pair via a deterministic total-order comparator during aggregation; render it as a small always-visible-through-occlusion sphere in a Viewer-native (`window.THREE`, r71) overlay scene, lifecycle-locked to the extension's existing isolation clear/apply and stale-action-token discipline.

**Tech Stack:** Plain Node `node:test` + `node:assert/strict` (no Jest/Vitest — this repo's own convention), `three@0.185.1` (r185, collision-library-internal only), Viewer 7.124.2's bundled r71 three.js (`window.THREE`, Viewer-marker-only), Playwright for live acceptance (`test/acceptance/*.acceptance.mjs`).

**Spec:** `docs/superpowers/specs/2026-09-07-collision-library-m2.1-clash-witness-marker-design.md` (reviewed via `codex-review`, verdict: ready for implementation planning). This plan argues from that spec; read both.

**Prompt:** `docs/prompts/collision-library-m2.1-clash-witness-marker-implementation-plan-prompt.md`

## Research basis

This plan was written after independently re-verifying every code claim in the spec against the actual source on `feature/collision-library-m2` (HEAD `ec87afe`, no code changes since the spec's cited `57ad8c9`) via five parallel research passes, plus a sourced Viewer-API evidence investigation against the pinned `viewer3D.js` 7.124.2 bundle (SHA-256 `12b9fe49f41dc99ccec62535e5c887da915980829da2e941cfe4da3d7197c02e`, matching this Agent Kit's existing provenance record). All line numbers below are current-source-verified, not copied from the spec; where they drifted from the spec's citations (0–4 lines in a few spots), the current number is used. One evidence-based deviation from the spec's assumption is called out explicitly in Task 8.

## Global Constraints

- Additive only: `source`, `target`, `type` on `ClashPair` are untouched; `witness` is a new key, present (possibly `null`) only for `type: 'volume-overlap'`.
- `witness.point` is a plain `[x, y, z]` array of finite numbers — never a `THREE.Vector3` of either revision — crossing the collision-library ↔ Viewer boundary.
- `witness: null` is a fault-tolerance contract, not an ordinary success outcome. A normal, well-formed, complete `volume-overlap` Hard Clash must produce `witness !== null`. `null` always carries exactly one corresponding `statistics.diagnostics` entry.
- Hard Clash truth semantics, tolerance, and BLAS/TLAS candidate semantics are unchanged. A clash is never suppressed or downgraded because witness capture failed.
- `ClashFinderExtension.js` must never import the npm `three` package. All overlay-layer objects (`Vector3`, `SphereGeometry`, `MeshBasicMaterial`, `Mesh`) must come from `window.THREE` (Viewer's own r71 global), never from the collision library's r185 `three` dependency.
- No `containment`/`surface-intersection` ClashPair gets a `witness` key in M2.1. No M3/Soft Clash/clearance scope. No unrelated M1/M2 architecture reopened.
- Test framework: `node:test` + `node:assert/strict` only. Run the full suite with `npm test`; run one file with `node --test path/to/file.test.mjs`. Live acceptance: `npm run test:acceptance:clash-finder` (requires `npm start &` first).
- TDD: write the failing test, watch it fail, implement the minimal code, watch it pass, commit.

---

## Task 1: Surface-crossing witness capture (`properCrossingQuery`)

**Objective:** `properCrossingQuery` additively returns an owned-clone `witnessPoint` (in `canonicalFirst`'s / `bvhA`'s local frame) whenever `crossing: true`, without touching any existing field or consumer.

**Files:**
- Modify: `collision/query/ProperCrossingQuery.js`
- Test: `test/query/ProperCrossingQuery.test.mjs`

**Prerequisites:** None — this is the first leaf task.

**Interfaces:**
- Consumes: nothing new.
- Produces: `properCrossingQuery(bvhA, bvhB, matrixBtoA, localDiagonalA, localDiagonalB, options = {})` now returns `{ crossing, aborted, inconclusive, diagnostics, stats, witnessPoint }` where `witnessPoint` is `undefined` unless `crossing === true`, in which case it is an **owned** `THREE.Vector3` clone (r185, collision-internal — this function never crosses the Viewer boundary) in `bvhA`'s local frame. Task 3 consumes `witnessPoint`.

**Current landed state (verified):**
- Module-level scratch: `_mid` (line 21), `_probe` (line 23), `_probeInB` (line 24).
- `_mid` set via `_line.getCenter(_mid)` at **line 117**.
- `_probe.copy(_mid).addScaledVector(_dir, delta)` at **line 135**, classified via `classifyPoint(_probe, bvhA, localDiagonalA)` at **line 137**. `_probe` is in `bvhA`'s local frame (the first BVH argument).
- `_probeInB.copy(_probe).applyMatrix4(matrixAtoB)` at **line 141** (variable name in source may read `matrixBtoA` per the signature — read the exact current line before editing), classified via `classifyPoint(_probeInB, bvhB, localDiagonalB)` at **line 142**.
- `crossing = true` set at **line 145**, `return true;` (early exit of the inner search loop, not the function) at **line 146**.
- Final return statement, **lines 171–177**:
  ```js
  return {
    crossing: finalCrossing,
    aborted,
    inconclusive,
    diagnostics,
    stats: { candidatePairsExamined, crossingPairsExamined },
  };
  ```
- `_probe` is currently discarded — never placed on the return object.
- Confirmed zero existing consumers destructure a point/witness field from this return object (production: `VolumeOverlapQuery.js:84-87`; tests: `test/query/ProperCrossingQuery.test.mjs`, `test/query/VolumeOverlapQuery.test.mjs`; perf harness: `test/performance/{run-gate,browser-probes}.mjs`) — an additive field is safe.

**Implementation steps:**

- [ ] **Step 1: Write the failing test — positive crossing returns a witness point**

  In `test/query/ProperCrossingQuery.test.mjs`, add:
  ```js
  test('positive crossing returns an owned witnessPoint classifying inside both operands', () => {
    const duct = testInstance(box(20, 0.4, 0.4));
    const beam = testInstance(box(0.4, 0.4, 20));
    const r = crossOf(duct, beam);
    assert.equal(r.crossing, true);
    assert.ok(r.witnessPoint, 'witnessPoint must be present on a positive crossing');
    assert.equal(typeof r.witnessPoint.x, 'number');
    assert.equal(classifyPoint(r.witnessPoint, duct.bvh, duct.localDiagonal), 'inside');
    // r.witnessPoint is in duct's (bvhA's) local frame — classify against bvhB via the same
    // matrix the function itself used internally is covered by the crossing-verdict test below;
    // here we only assert it classifies inside the frame it's documented to be in.
  });
  ```
  Import `classifyPoint` from `../../collision/query/ContainmentQuery.js` (or wherever it's exported from) at the top of the file if not already imported — check the existing import list first.

- [ ] **Step 2: Run test to verify it fails**

  Run: `node --test test/query/ProperCrossingQuery.test.mjs`
  Expected: FAIL — `r.witnessPoint` is `undefined`.

- [ ] **Step 3: Write the failing test — scratch ownership**

  ```js
  test('a returned witnessPoint is an owned clone, immune to later scratch mutation', () => {
    const duct = testInstance(box(20, 0.4, 0.4));
    const beam = testInstance(box(0.4, 0.4, 20));
    const r1 = crossOf(duct, beam);
    const captured = r1.witnessPoint.clone();
    // Force the module-level scratch to be reused and mutated by a second, unrelated call.
    const other = testInstance(box(5, 5, 5));
    const another = testInstance(box(5, 5, 5));
    crossOf(other, another); // may or may not cross; irrelevant — only exercises scratch reuse
    assert.deepEqual(
      [r1.witnessPoint.x, r1.witnessPoint.y, r1.witnessPoint.z],
      [captured.x, captured.y, captured.z],
      'first call\'s witnessPoint must not change after a later call reuses module-level scratch',
    );
  });
  ```

- [ ] **Step 4: Run to verify it fails (or passes vacuously) — confirm intent, don't rely on it alone**

  Run: `node --test test/query/ProperCrossingQuery.test.mjs`
  Expected: FAILs alongside Step 2's test since `witnessPoint` doesn't exist yet (`undefined.clone is not a function` or similar). This is fine — Step 3's test only becomes meaningful once Step 1's implementation exists; both are written now so the implementation in Step 5 must satisfy both at once.

- [ ] **Step 5: Implement — clone `_probe` at the exact success statement**

  At line 145 (where `crossing = true` is set today), capture an owned clone. Do not alter the scratch-object pattern anywhere else in the file — this is a one-line addition at the capture site plus one field on the final return object.

  ```js
  // at the crossing = true statement (existing line ~145):
  crossing = true;
  witnessPoint = _probe.clone(); // owned clone — _probe is module-level scratch, reused on every call
  ```
  Declare `let witnessPoint;` alongside the other result-accumulator locals near the top of the function (wherever `finalCrossing`/`aborted`/`inconclusive` are declared — read the current declarations before adding).

  Update the final return statement (lines 171–177):
  ```js
  return {
    crossing: finalCrossing,
    aborted,
    inconclusive,
    diagnostics,
    stats: { candidatePairsExamined, crossingPairsExamined },
    witnessPoint,
  };
  ```
  `witnessPoint` remains `undefined` on every non-crossing path — do not default it to `null`, matching the spec's "no partial-success case" framing (a caller checks `crossing === true` first).

- [ ] **Step 6: Run tests to verify they pass**

  Run: `node --test test/query/ProperCrossingQuery.test.mjs`
  Expected: PASS, all existing tests in the file still pass (regression check).

- [ ] **Step 7: Run the full existing crossing-verdict regression suite**

  Run: `node --test test/query/ProperCrossingQuery.test.mjs test/query/VolumeOverlapQuery.test.mjs`
  Expected: PASS — confirms the additive field doesn't perturb any existing crossing-verdict assertion (none of them read `witnessPoint` yet).

- [ ] **Step 8: Commit**

  ```bash
  git add collision/query/ProperCrossingQuery.js test/query/ProperCrossingQuery.test.mjs
  git commit -m "M2.1: properCrossingQuery additively returns an owned witnessPoint on crossing:true"
  ```

**Tests introduced/updated:** `test/query/ProperCrossingQuery.test.mjs` — positive-crossing witness presence + frame check, scratch-ownership regression.

**Completion criteria:** Both new tests pass; every pre-existing test in `ProperCrossingQuery.test.mjs` and `VolumeOverlapQuery.test.mjs` still passes unmodified.

**Protected invariants:** `crossing`/`aborted`/`inconclusive`/`diagnostics`/`stats` unchanged in meaning or shape. No consumer of the old shape is affected (verified zero existing destructuring of a point field).

**Viewer/API evidence needed before coding:** None — pure collision-library-internal change, r185 `THREE.Vector3` only, never crosses the Viewer boundary.

---

## Task 2: Containment witness capture (`anyComponentInside` / `constructedInteriorWitness`)

**Objective:** `anyComponentInside` additively returns an owned-clone `witnessPoint` (container-local frame) and an internal-only `witnessMethod` (`'vertex-sample' | 'constructed-interior'`) whenever `inside: true`, sourced from whichever of the two stages actually resolved it.

**Files:**
- Modify: `collision/query/ContainmentQuery.js`
- Test: `test/query/ContainmentQuery.anyComponentInside.test.mjs`

**Prerequisites:** None (independent of Task 1; both feed Task 3).

**Interfaces:**
- Consumes: nothing new.
- Produces: `anyComponentInside(...)` (signature unchanged: `sourceGeometry, sourceBvh, sourceLocalDiagonal, sourceConnectivity, targetBvh, targetLocalDiagonal, targetClosedManifold, sourceToTargetMatrix, options`) now returns `{ inside, decidingComponentClosed, decidingComponentIndex, diagnostics, unresolvedComponentCount, samplesUsed, budgetExhausted, witnessPoint, witnessMethod }` where `witnessPoint`/`witnessMethod` are `undefined` unless `inside === true`. `witnessPoint` is an owned `THREE.Vector3` clone in the **container's** (`targetBvh`'s) local frame. Task 3 consumes `witnessPoint` (never `witnessMethod` — that stays internal-diagnostic-only, per spec §4B).

**Current landed state (verified):**
- `anyComponentInside` spans **lines 154–354**. Module-level scratch `_point` at **line 122**.
- Stage 1/2 success path: **line 289** — `_point.fromBufferAttribute(position, v).applyMatrix4(sourceToTargetMatrix);` (matrix applied **before** classification); **line 290** — `const c = classifyPoint(_point, targetBvh, targetLocalDiagonal);`; success gate **line 293** — `if (c === 'inside') {`. At this statement `_point` is proven in the container's local frame.
- Stage 3, `constructedInteriorWitness` (**lines 379–477**, `async`, signature: `(sourceGeometry, componentTriangles, targetBvh, targetLocalDiagonal, sourceToTargetMatrix, witnessTriangleBudget, ladderFactors, scheduler, samplesUsedIn, sampleBudget)`), called from `anyComponentInside` at **lines 309–314** exactly when `!componentResolved && !budgetExhausted && mode === 'volume-overlap'` (line 308) — i.e. stages 1/2 were inconclusive for this component, budget remains, and mode is `'volume-overlap'` (never for standalone `containment` mode).
  - Inside `constructedInteriorWitness`: `_wProbe.copy(_wCentroid).addScaledVector(_wNormal, sign * delta);` at **line 460** (component's own local frame); own-geometry validation `classifyPoint(_wProbe, componentBvh, componentLocalDiagonal)` at **line 465**, gated `if (ownClass !== 'inside') continue;` at line 466; transform into container frame `_wProbeInTarget.copy(_wProbe).applyMatrix4(sourceToTargetMatrix);` at **line 467**; container classification `classifyPoint(_wProbeInTarget, targetBvh, targetLocalDiagonal)` at **line 468**; success/return **line 469** — `if (targetClass === 'inside') return { inside: true, samplesUsed, budgetExhausted };`. `constructedInteriorWitness`'s own local return shape has no point field either — same discard pattern as Task 1's leaf.
- `anyComponentInside` has two return sites, both same shape today: an early aspect-ratio-gated return (**lines 211–219**, always `inside: false` — never needs a witness) and the normal return (**lines 345–353**).
- Zero existing consumers destructure a point field from `anyComponentInside`'s or `constructedInteriorWitness`'s return objects (production call sites: `VolumeOverlapQuery.js:117-133` and `:149-163`, `ContainmentModeQuery.js:43-61`; tests as listed in the research above) — additive fields are safe.

**Implementation steps:**

- [ ] **Step 1: Write the failing test — stage 1/2 vertex-sample witness**

  In `test/query/ContainmentQuery.anyComponentInside.test.mjs`, find (or add near) an existing fixture that resolves `inside: true` via ordinary vertex sampling (stage 1/2, no stage-3 fallback needed) and add:
  ```js
  test('stage 1/2 conclusive containment returns a container-local witnessPoint with witnessMethod "vertex-sample"', () => {
    // reuse whichever existing small-object-fully-inside-large-object fixture already
    // proves inside:true via vertex sampling in this file — read the file first and
    // adapt the exact fixture builder call rather than re-deriving one from scratch.
    const r = /* existing call pattern from this file, e.g. */ containmentOf(smallBox, bigBox);
    assert.equal(r.inside, true);
    assert.ok(r.witnessPoint, 'witnessPoint must be present when inside:true');
    assert.equal(r.witnessMethod, 'vertex-sample');
    assert.equal(classifyPoint(r.witnessPoint, bigBox.bvh, bigBox.localDiagonal), 'inside');
  });
  ```

- [ ] **Step 2: Write the failing test — stage 3 constructed-interior witness**

  Find (or add) a fixture in the same file that is only resolved via stage 3 (vertex sampling inconclusive — e.g. a component whose vertices all land on/near the container boundary but whose interior is genuinely inside). If no such fixture currently exists in this file, check `ContainmentQuery.classifyPoint.test.mjs` and the file's own stage-3-specific tests (if any) for a reusable geometry construction; adapt it rather than inventing new geometry blindly.
  ```js
  test('stage 3 constructed-interior fallback returns a container-local witnessPoint with witnessMethod "constructed-interior"', () => {
    const r = containmentOf(inconclusiveComponent, container);
    assert.equal(r.inside, true);
    assert.ok(r.witnessPoint);
    assert.equal(r.witnessMethod, 'constructed-interior');
    assert.equal(classifyPoint(r.witnessPoint, container.bvh, container.localDiagonal), 'inside');
  });
  ```

- [ ] **Step 3: Run tests to verify they fail**

  Run: `node --test test/query/ContainmentQuery.anyComponentInside.test.mjs`
  Expected: FAIL — `witnessPoint`/`witnessMethod` are `undefined`.

- [ ] **Step 4: Implement — capture at the stage 1/2 success statement (line ~293)**

  ```js
  // at the stage 1/2 success gate (existing line ~293):
  if (c === 'inside') {
    witnessPoint = _point.clone();
    witnessMethod = 'vertex-sample';
    // ...existing success-path logic (decidingComponentClosed/decidingComponentIndex assignment) unchanged
  }
  ```
  Declare `let witnessPoint;` and `let witnessMethod;` alongside the function's other result-accumulator locals (near where `anyClassifiedInside`, `decidingComponentClosed`, etc. are declared).

- [ ] **Step 5: Implement — capture at the stage 3 call site (lines ~309-314)**

  `constructedInteriorWitness` itself doesn't return a point (Task 2's own leaf discard, confirmed above) — so the clone must happen **inside** `constructedInteriorWitness`, at its own success statement (line 469), and that point must be returned up to `anyComponentInside`. Additively change `constructedInteriorWitness`'s own return:
  ```js
  // constructedInteriorWitness, line ~469:
  if (targetClass === 'inside') return { inside: true, samplesUsed, budgetExhausted, witnessPoint: _wProbeInTarget.clone() };
  ```
  Then in `anyComponentInside`, at the stage-3 call site (lines 309–314), capture it:
  ```js
  if (!componentResolved && !budgetExhausted && mode === 'volume-overlap') {
    const witness = await constructedInteriorWitness(/* unchanged args */);
    if (witness.inside) {
      witnessPoint = witness.witnessPoint;
      witnessMethod = 'constructed-interior';
    }
    // ...existing componentResolved/budgetExhausted bookkeeping unchanged
  }
  ```
  Read the exact surrounding code first — do not guess variable names beyond what's confirmed above; match the existing local-variable style in that block exactly.

- [ ] **Step 6: Update `anyComponentInside`'s normal return statement (lines 345-353)**

  ```js
  return {
    inside: anyClassifiedInside,
    decidingComponentClosed,
    decidingComponentIndex,
    diagnostics,
    unresolvedComponentCount,
    samplesUsed,
    budgetExhausted,
    witnessPoint,
    witnessMethod,
  };
  ```
  Both fields remain `undefined` when `inside === false` (the early-return path at lines 211–219 needs no change — it's always `inside: false`).

- [ ] **Step 7: Run tests to verify they pass**

  Run: `node --test test/query/ContainmentQuery.anyComponentInside.test.mjs`
  Expected: PASS, all pre-existing tests in the file still pass.

- [ ] **Step 8: Run cross-file regression**

  Run: `node --test test/query/ContainmentQuery.anyComponentInside.test.mjs test/query/ContainmentModeQuery.test.mjs test/query/VolumeOverlapQuery.test.mjs`
  Expected: PASS — confirms `ContainmentModeQuery.js`'s standalone `containment`-mode consumer (which destructures `.diagnostics`/`.inside`/`.unresolvedComponentCount` only, per the research) is unaffected by the additive fields.

- [ ] **Step 9: Commit**

  ```bash
  git add collision/query/ContainmentQuery.js test/query/ContainmentQuery.anyComponentInside.test.mjs
  git commit -m "M2.1: anyComponentInside/constructedInteriorWitness additively return a container-local witnessPoint on inside:true"
  ```

**Tests introduced/updated:** `test/query/ContainmentQuery.anyComponentInside.test.mjs` — stage 1/2 witness + `witnessMethod`, stage 3 witness + `witnessMethod`.

**Completion criteria:** Both new tests pass; all pre-existing tests in `ContainmentQuery.anyComponentInside.test.mjs`, `ContainmentModeQuery.test.mjs`, `VolumeOverlapQuery.test.mjs` still pass unmodified.

**Protected invariants:** `inside`/`decidingComponentClosed`/`decidingComponentIndex`/`diagnostics`/`unresolvedComponentCount`/`samplesUsed`/`budgetExhausted` unchanged in meaning or shape. `witnessMethod` never appears on the public `ClashPair.witness` (enforced structurally in Task 3 — only `kind` crosses that boundary).

**Viewer/API evidence needed before coding:** None — r185-internal only.

---

## Task 3: `volumeOverlapQuery` world-space witness propagation

**Objective:** `volumeOverlapQuery` transforms each leaf's local-frame `witnessPoint` into Viewer scene coordinates using the correct operand's world matrix, validates finiteness, and additively returns `witness: { kind, point } | null` on its own result — this is the **required composition layer**; witness data cannot reach `CollisionWorld` without it.

**Files:**
- Modify: `collision/query/VolumeOverlapQuery.js`
- Test: `test/query/VolumeOverlapQuery.test.mjs`

**Prerequisites:** Task 1 and Task 2 complete (this task consumes their `witnessPoint` fields).

**Interfaces:**
- Consumes: `properCrossingQuery(...).witnessPoint` (Task 1, canonicalFirst-local), `anyComponentInside(...).witnessPoint` (Task 2, container-local).
- Produces: `volumeOverlapQuery(source, target, options)` now returns `{ overlap, via, diagnostics, stats, witness }` where `witness` is `{ kind: 'surface-crossing' | 'containment', point: [x, y, z] } | null`. **`witness` is only meaningful when `overlap === true`** — on the negative path it is not read by anyone and may be omitted or left `undefined` (do not fabricate a value). Task 4 consumes `witness`.

**Current landed state (verified):**
- Canonical resolution: **line 44** — `const [canonicalFirst, canonicalSecond] = compareCanonical(source, target) <= 0 ? [source, target] : [target, source];`
- `properCrossingQuery` call: **lines 84–87** — `crossing = properCrossingQuery(canonicalFirst.bvh, canonicalSecond.bvh, canonicalSecondToFirst, canonicalFirst.localDiagonal, canonicalSecond.localDiagonal, options.crossing);`
- Crossing positive branch: **lines 97–107** — `if (crossing.crossing) { ... return { overlap: true, via: 'crossing', diagnostics, stats: { crossing: crossing.stats } }; }` (return statement at line 106).
- `anyComponentInside` "A in B" call (target is container): **lines 117–120**; positive branch **line 141** `if (aInB.inside)`, return **line 143** `{ overlap: true, via: 'containment(A in B)', diagnostics, stats: { crossing: crossing.stats, aInB } };`
- `anyComponentInside` "B in A" call (source is container): **lines 149–152**; positive branch **line 171** `if (bInA.inside)`, return **line 173** `{ overlap: true, via: 'containment(B in A)', diagnostics, stats: { crossing: crossing.stats, aInB, bInA } };`
- Negative fallthrough: **lines 193–197** — `{ overlap: false, diagnostics, stats: { crossing: crossing.stats, aInB, bInA } };`
- `Instance` shape (via `toInstance`, `CollisionWorld.js:136-146`): `{ geometry, bvh, localDiagonal, connectivity, closedManifold, aspectRatioExceeded, matrix }` where `matrix` is a real `THREE.Matrix4` built from that operand's own world-matrix array — **`source.matrix` and `target.matrix` are already in scope inside `volumeOverlapQuery`**, no new parameter needed.
- Per-branch world-matrix ownership (spec §0.3, confirmed by the call sites above): crossing branch → transform by whichever physical operand (`source` or `target`) resolved to `canonicalFirst`; "A in B" branch → `target.matrix` (target was the container in that call); "B in A" branch → `source.matrix` (source was the container in that call).

**Implementation steps:**

- [ ] **Step 1: Write the failing test — crossing branch produces a world-space witness**

  In `test/query/VolumeOverlapQuery.test.mjs`, find the existing test(s) that assert `overlap: true, via: 'crossing'` and add:
  ```js
  test('crossing overlap additively returns a world-space surface-crossing witness', () => {
    const duct = /* existing fixture builder from this file, positioned with a known non-identity world matrix */;
    const beam = /* existing fixture builder, likewise */;
    const r = volumeOverlapQuery(duct, beam, {});
    assert.equal(r.overlap, true);
    assert.equal(r.via, 'crossing');
    assert.ok(r.witness, 'witness must be present on a positive crossing overlap');
    assert.equal(r.witness.kind, 'surface-crossing');
    assert.equal(r.witness.point.length, 3);
    assert.ok(r.witness.point.every(Number.isFinite), 'witness.point must be 3 finite numbers');
    // Oracle: transform the point back and confirm it still classifies inside both operands'
    // own local BVHs via the operands' own matrices — do not assert an exact coordinate.
  });
  ```

- [ ] **Step 2: Write the failing test — "A in B" and "B in A" branches produce world-space witnesses**

  ```js
  test('"A in B" containment overlap returns a witness transformed by the container\'s (target\'s) matrix', () => {
    const small = /* fixture fully inside big, both with distinct known world matrices */;
    const big = /* ... */;
    const r = volumeOverlapQuery(small, big, {});
    assert.equal(r.overlap, true);
    assert.equal(r.via, 'containment(A in B)');
    assert.equal(r.witness.kind, 'containment');
    assert.ok(r.witness.point.every(Number.isFinite));
  });

  test('"B in A" containment overlap returns a witness transformed by the container\'s (source\'s) matrix', () => {
    const big = /* ... */;
    const small = /* fully inside big */;
    const r = volumeOverlapQuery(big, small, {}); // source=big, target=small -> forces B-in-A branch
    assert.equal(r.overlap, true);
    assert.equal(r.via, 'containment(B in A)');
    assert.equal(r.witness.kind, 'containment');
  });
  ```
  Read the file's existing fixture builders first (`test/fixtures/geometry.mjs`'s `testInstance()`) to see how a non-identity `matrix` is currently supplied to an `Instance` in this test file, and reuse that exact pattern rather than constructing `Instance` objects ad hoc.

- [ ] **Step 3: Write the failing test — negative overlap is unaffected**

  ```js
  test('negative overlap result shape is unchanged by witness support', () => {
    const a = /* two non-overlapping fixtures from existing tests */;
    const b = /* ... */;
    const r = volumeOverlapQuery(a, b, {});
    assert.equal(r.overlap, false);
    assert.equal(r.via, undefined);
    // witness is not read on the negative path by any consumer — assert it's not a truthy
    // object that a careless caller could mistake for a positive witness, but don't over-specify:
    assert.ok(!r.witness, 'a negative overlap result must not carry a truthy witness');
  });
  ```

- [ ] **Step 4: Write the failing test — non-finite transform degrades to `witness: null`, overlap unaffected**

  ```js
  test('a non-finite transformed witness degrades to witness:null without affecting the overlap verdict', () => {
    const duct = /* known-crossing fixture */;
    const beam = /* known-crossing fixture */;
    // Inject a degenerate matrix on one operand AFTER the verdict-relevant BVH/localDiagonal
    // are built, so the crossing verdict itself is computed from valid local geometry but the
    // world-space transform step receives a matrix that produces non-finite output.
    duct.matrix = new THREE.Matrix4().set(
      NaN, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    );
    const r = volumeOverlapQuery(duct, beam, {});
    assert.equal(r.overlap, true, 'the clash verdict must still be reported');
    assert.equal(r.witness, null, 'a non-finite transform must degrade to witness:null, not throw');
  });
  ```
  Import `THREE` from the same `three` package this test file already imports (r185 — this is collision-library-internal test code, not Viewer-boundary code).

- [ ] **Step 5: Run tests to verify they fail**

  Run: `node --test test/query/VolumeOverlapQuery.test.mjs`
  Expected: FAIL — `r.witness` is `undefined` everywhere.

- [ ] **Step 6: Implement — a small local helper for the transform+validate step**

  Add near the top of `VolumeOverlapQuery.js` (module scope, alongside other local helpers — check the file's existing helper-placement convention first):
  ```js
  const _worldPoint = new THREE.Vector3(); // module-level scratch, cloned to a plain array before return — never escapes this module as an object

  function toFiniteWorldArray(localPoint, worldMatrix) {
    _worldPoint.copy(localPoint).applyMatrix4(worldMatrix);
    const point = [_worldPoint.x, _worldPoint.y, _worldPoint.z];
    return point.every(Number.isFinite) ? point : null;
  }
  ```

- [ ] **Step 7: Implement — crossing branch (lines ~97-107)**

  ```js
  if (crossing.crossing) {
    const canonicalFirstIsSource = canonicalFirst === source;
    const worldMatrix = canonicalFirstIsSource ? source.matrix : target.matrix;
    const point = toFiniteWorldArray(crossing.witnessPoint, worldMatrix);
    return {
      overlap: true,
      via: 'crossing',
      diagnostics,
      stats: { crossing: crossing.stats },
      witness: point ? { kind: 'surface-crossing', point } : null,
    };
  }
  ```
  Confirm `canonicalFirst === source` is a valid identity check against the actual variables in scope at this line — if the existing code instead tracks "which physical operand is canonicalFirst" via a boolean/flag rather than object identity, use that flag instead (read the exact surrounding code from line 44 onward before finalizing this line).

- [ ] **Step 8: Implement — "A in B" branch (lines ~141-143)**

  ```js
  if (aInB.inside) {
    const point = toFiniteWorldArray(aInB.witnessPoint, target.matrix); // target was the container
    return {
      overlap: true,
      via: 'containment(A in B)',
      diagnostics,
      stats: { crossing: crossing.stats, aInB },
      witness: point ? { kind: 'containment', point } : null,
    };
  }
  ```

- [ ] **Step 9: Implement — "B in A" branch (lines ~171-173)**

  ```js
  if (bInA.inside) {
    const point = toFiniteWorldArray(bInA.witnessPoint, source.matrix); // source was the container
    return {
      overlap: true,
      via: 'containment(B in A)',
      diagnostics,
      stats: { crossing: crossing.stats, aInB, bInA },
      witness: point ? { kind: 'containment', point } : null,
    };
  }
  ```

- [ ] **Step 10: Leave the negative fallthrough (lines ~193-197) untouched**

  Do not add a `witness` key to the negative return — Step 3's test only requires it be falsy, and omitting the key entirely satisfies that while keeping the diff minimal.

- [ ] **Step 11: Run tests to verify they pass**

  Run: `node --test test/query/VolumeOverlapQuery.test.mjs`
  Expected: PASS, including all pre-existing tests in the file.

- [ ] **Step 12: Run leaf-task regression**

  Run: `node --test test/query/ProperCrossingQuery.test.mjs test/query/ContainmentQuery.anyComponentInside.test.mjs test/query/VolumeOverlapQuery.test.mjs`
  Expected: PASS.

- [ ] **Step 13: Commit**

  ```bash
  git add collision/query/VolumeOverlapQuery.js test/query/VolumeOverlapQuery.test.mjs
  git commit -m "M2.1: volumeOverlapQuery transforms leaf witness points to world space and validates finiteness"
  ```

**Tests introduced/updated:** `test/query/VolumeOverlapQuery.test.mjs` — crossing witness, both containment-direction witnesses, negative-path non-regression, non-finite-transform degradation.

**Completion criteria:** All 4 new tests pass; every pre-existing test in the file still passes.

**Protected invariants:** `overlap`/`via`/`diagnostics`/`stats` unchanged. Negative `overlap: false` never carries a meaningful `witness`. A non-finite transform never throws and never suppresses the `overlap: true` verdict.

**Viewer/API evidence needed before coding:** None — this task never touches the Viewer boundary; `witness.point` is a plain array by the time it leaves this function.

---

## Task 4: `_runNarrowPhasePair` result-shape integration + aggregation gate fix

**Objective:** `CollisionWorld._runNarrowPhasePair` returns `{ hit: result.overlap, witness: result.witness }` for `volume-overlap` (instead of a bare boolean); `containment`/`surface-intersection` keep returning bare booleans. The one caller (the aggregation loop) is updated in the same change to normalize both shapes explicitly — with a regression test proving a negative structured result (`{ hit: false, witness: null }`) is never mistaken for a truthy hit.

**Files:**
- Modify: `collision/CollisionWorld.js`
- Test: `test/CollisionWorld.findClashes.dispatch.test.mjs`, `test/CollisionWorld.findClashes.test.mjs`

**Prerequisites:** Task 3 complete (this task consumes `volumeOverlapQuery`'s `witness` field).

**Interfaces:**
- Consumes: `volumeOverlapQuery(...).witness` (Task 3).
- Produces: `_runNarrowPhasePair(...)` returns `{ hit: boolean, witness: {kind,point}|null }` when `mode === 'volume-overlap'`, a bare `boolean` for `containment`/`surface-intersection`, and a bare `false` on the existing `buildOne`-failure early-outs (lines 1571, 1573 — unchanged, still boolean). A new local helper `normalizeNarrowPhaseHit(mode, result)` returning `{ isHit, witness }` is introduced at the aggregation-loop call site. Task 5 consumes both `isHit` and `witness` from this normalization.

**Current landed state (verified):**
- `_runNarrowPhasePair` spans **lines 1493–1653**. Three branches:
  - `surface-intersection` (**1603–1621**): `const result = surfaceIntersectionQuery(...); attach(result.diagnostics); return result.intersects;`
  - `containment` (**1630–1635**): `const result = await containmentModeQuery(...); attach(result.diagnostics); return result.contained;`
  - `volume-overlap` (**1636–1652**): builds `sourceInstance`/`targetInstance` via `toInstance` (**1626–1627**, shared prep before the mode branches), builds `scheduler`, computes `canonicalOrder` via `comparePlacedCanonically(sourcePlaced, targetPlaced)` (**1646**), calls `volumeOverlapQuery(sourceInstance, targetInstance, { scheduler, compareCanonical })` (**1647–1650**), `attach(result.diagnostics)` (**1651**), `return result.overlap;` (**1652**, the line to change).
- Two earlier `buildOne`-failure early-outs at **lines 1571 and 1573** both `return false;` — unchanged by this task (both modes' geometry-unavailable paths, not volume-overlap-specific).
- The aggregation loop (**lines 1380–1403**) calls `_runNarrowPhasePair` at **line 1385** — this is the **only** production call site in the entire repo; one test-side spy exists (`test/CollisionWorld.findClashes.test.mjs:621-622`, forwards to the original via `bind`, return-shape-agnostic, needs no change).
- Today's gate: **line 1390** — `if (!hit) continue;` — on a plain boolean. If `hit` becomes `{ hit: false, witness: null }` for volume-overlap without changing this line, `!hit` is `false` for *any* object (even `{hit:false}`), so every candidate pair would silently pass — this is the exact truthy-object bug the spec (and prompt) call out.

**Implementation steps:**

- [ ] **Step 1: Write the failing regression test — truthy-object bug**

  In `test/CollisionWorld.findClashes.dispatch.test.mjs`, add:
  ```js
  test('a negative volume-overlap structured result {hit:false, witness:null} does not become a truthy hit', async () => {
    const world = /* existing fixture setup from this file */;
    const originalRun = world._runNarrowPhasePair.bind(world);
    world._runNarrowPhasePair = async (...args) => {
      const result = await originalRun(...args);
      // Force a structured-but-negative shape regardless of the real verdict, to prove the
      // AGGREGATION LOOP's gate reads `.hit`, not object truthiness.
      return { hit: false, witness: null };
    };
    const result = await world.findClashes({ mode: 'volume-overlap', /* existing source/target selection from this file */ });
    assert.equal(result.pairs.length, 0, 'a stubbed {hit:false,...} must never produce a ClashPair');
  });
  ```

- [ ] **Step 2: Run test to verify it fails**

  Run: `node --test test/CollisionWorld.findClashes.dispatch.test.mjs`
  Expected: FAIL — with today's `if (!hit) continue;` gate, `!{hit:false,witness:null}` is `false`, so the loop does NOT skip, and a spurious `ClashPair` is emitted.

- [ ] **Step 3: Write the failing test — `_runNarrowPhasePair` volume-overlap return shape**

  In `test/CollisionWorld.findClashes.dispatch.test.mjs` (or wherever `_runNarrowPhasePair` is exercised directly — check the file first), add:
  ```js
  test('_runNarrowPhasePair returns {hit, witness} for volume-overlap and a bare boolean for containment/surface-intersection', async () => {
    const world = /* existing fixture */;
    const volumeOverlapResult = await world._runNarrowPhasePair(/* known-crossing args, mode: 'volume-overlap' */);
    assert.equal(typeof volumeOverlapResult, 'object');
    assert.equal(typeof volumeOverlapResult.hit, 'boolean');
    assert.ok(volumeOverlapResult.witness === null || typeof volumeOverlapResult.witness === 'object');

    const containmentResult = await world._runNarrowPhasePair(/* args, mode: 'containment' */);
    assert.equal(typeof containmentResult, 'boolean', 'containment mode must keep its existing bare-boolean shape');
  });
  ```

- [ ] **Step 4: Run to verify it fails**

  Run: `node --test test/CollisionWorld.findClashes.dispatch.test.mjs`
  Expected: FAIL — `volumeOverlapResult` is currently a bare boolean.

- [ ] **Step 5: Implement — `_runNarrowPhasePair`'s volume-overlap branch (lines ~1636-1652)**

  Change only line 1652:
  ```js
  // before: return result.overlap;
  return { hit: result.overlap, witness: result.witness ?? null };
  ```
  `containment` (line ~1635: `return result.contained;`) and `surface-intersection` (line ~1621: `return result.intersects;`) are **not** touched.

- [ ] **Step 6: Implement — explicit caller normalization at the aggregation-loop call site**

  Add a small local helper near the top of the file (module scope, alongside other small free functions like `comparePlacedCanonically`):
  ```js
  function normalizeNarrowPhaseHit(mode, result) {
    if (mode === 'volume-overlap') {
      return { isHit: Boolean(result && result.hit), witness: (result && result.witness) ?? null };
    }
    return { isHit: Boolean(result), witness: undefined }; // witness is not a concept for these modes
  }
  ```
  At the aggregation loop (line ~1385-1390):
  ```js
  const rawHit = await this._runNarrowPhasePair(
    sourcePlaced, targetPlaced, query.mode, sourceOperand, targetOperand,
    statistics, oversizedDiagnosedFragments, checkpoint,
  );
  statistics.narrowPhasePairs++;
  const { isHit, witness } = normalizeNarrowPhaseHit(query.mode, rawHit);
  if (!isHit) continue;
  ```
  `witness` here is passed into Task 5's aggregation logic (not yet consumed in this task — Task 5 wires it into `pairsByKey`). For this task, it's enough that `isHit` is the only thing gating `continue`, closing the truthy-object hole.

- [ ] **Step 7: Run tests to verify they pass**

  Run: `node --test test/CollisionWorld.findClashes.dispatch.test.mjs`
  Expected: PASS.

- [ ] **Step 8: Run the full `findClashes` regression suite**

  Run: `node --test test/CollisionWorld.findClashes.test.mjs test/CollisionWorld.findClashes.crossModel.test.mjs test/CollisionWorld.findClashes.dispatch.test.mjs test/CollisionWorld.tlasTraversal.test.mjs`
  Expected: PASS — the test-side spy at `test/CollisionWorld.findClashes.test.mjs:621-622` continues to work unmodified since it forwards to the original method and doesn't inspect the return shape itself.

- [ ] **Step 9: Commit**

  ```bash
  git add collision/CollisionWorld.js test/CollisionWorld.findClashes.dispatch.test.mjs
  git commit -m "M2.1: _runNarrowPhasePair returns {hit,witness} for volume-overlap; aggregation gate reads .hit explicitly"
  ```

**Tests introduced/updated:** `test/CollisionWorld.findClashes.dispatch.test.mjs` — truthy-object regression, return-shape-per-mode assertion.

**Completion criteria:** Both new tests pass; the full `findClashes`/dispatch/TLAS-traversal regression suite passes unmodified.

**Protected invariants:** `containment` and `surface-intersection` narrow-phase return shapes are byte-for-byte unchanged (bare boolean). The aggregation gate never treats a structured negative result as a hit. No pair-dedup identity semantics change (the `key` computation itself, line 1391, is untouched by this task).

**Viewer/API evidence needed before coding:** None.

---

## Task 5: Deterministic dbId-level aggregation + witness-unavailable diagnostics

**Objective:** Replace the insert-only `pairsByKey.set` with insert-or-replace-by-total-order using `compareWitnessCandidates`, so the final witness on each dbId-level `ClashPair` is independent of candidate arrival order (and therefore independent of `linear` vs `tlas` broad-phase traversal order). Emit exactly one `witness-unavailable` diagnostic per dbId pair whose *final* aggregated witness is `null`, after full aggregation — never per individual fragment-pair miss.

**Files:**
- Modify: `collision/CollisionWorld.js`
- Test: `test/CollisionWorld.findClashes.test.mjs`, `test/CollisionWorld.tlasTraversal.test.mjs`

**Prerequisites:** Task 4 complete (consumes the normalized `{isHit, witness}` from the aggregation loop).

**Interfaces:**
- Consumes: `witness` from Task 4's `normalizeNarrowPhaseHit` at the aggregation loop, `sourcePlaced`/`targetPlaced` (already in scope in the loop), `comparePlacedCanonically` (existing, `CollisionWorld.js:102-111`).
- Produces: a new module-level `compareWitnessCandidates(a, b)` comparator (`CollisionWorld.js`, alongside `comparePlacedCanonically`); `findClashes`'s returned `ClashPair`s for `type: 'volume-overlap'` now carry a `witness: {kind,point}|null` key; `statistics.diagnostics` may carry a new `{ scope: 'pair', reason: 'witness-unavailable', sourceFragment, targetFragment }`-shaped entry (matching the existing pair-scoped diagnostic shape from `attach`, `CollisionWorld.js:1588-1601`) per dbId pair whose final witness is `null`. Task 6's tests consume the public `witness` field and the diagnostics entry shape.

**Current landed state (verified):**
- `comparePlacedCanonically` (**lines 102–111**) — module-level free function, `(a, b) => number`, ordering on `a.instance.geometryIdentity.{loadEpoch, geometryIndex}` then `a.instance.fragmentId`. Currently used only inside `_runNarrowPhasePair` (line 1646) for `volumeOverlapQuery`'s internal canonical resolution — **not currently used by the `pairsByKey` aggregation loop**. Directly reusable for the new comparator's tie-break, per spec §5.
- Aggregation loop (**lines 1380–1403**): `pairsByKey` Map, keyed by `` `${sourceOperand.epoch}:${sourcePlaced.ownerDbId}:${targetOperand.epoch}:${targetPlaced.ownerDbId}` `` (line 1391), insert-only via `if (!pairsByKey.has(key))` (line 1392), inserting `{ source: {...}, target: {...}, type: query.mode }` (no witness field today).
- `statistics.diagnostics` is initialized as `[]` (line 267). The pair-scoped push shape (inside `attach`, lines 1588–1601, push call line 1593) is `{ scope: 'pair', reason: d.reason, ...(d.role !== undefined ? { role: d.role } : {}), sourceFragment, targetFragment }` — the new `witness-unavailable` diagnostic should match this shape (it is necessarily pair-scoped, both operands known).
- A pre-existing test helper worth reusing: `test/CollisionWorld.findClashes.dispatch.test.mjs:125-158` defines `reasonsOf(result)` (`result.statistics.diagnostics.map(d => d.reason)`) and a list of diagnostic reasons that must never ride along on a positive result — extend that list's spirit for `witness-unavailable` (it MUST ride along exactly when, and only when, the final witness is null).

**Implementation steps:**

- [ ] **Step 1: Write the failing test — valid-over-null aggregation rule**

  In `test/CollisionWorld.findClashes.test.mjs`, construct (or reuse) a two-model fixture where two distinct fragment pairs both map to the same dbId-level key, one producing a valid witness and one producing `witness: null` (e.g. by stubbing `_runNarrowPhasePair` for one specific fragment pair to return `{hit: true, witness: null}` while the other resolves normally with a real witness — reuse the monkeypatch pattern from `test/CollisionWorld.findClashes.test.mjs:621-622`).
  ```js
  test('a valid witness from one fragment pair outranks a null witness from a sibling fragment pair for the same dbId pair', async () => {
    const world = /* fixture with two fragment pairs -> one dbId pair */;
    const original = world._runNarrowPhasePair.bind(world);
    let call = 0;
    world._runNarrowPhasePair = async (...args) => {
      const result = await original(...args);
      call += 1;
      if (call === 1 && result && typeof result === 'object') return { hit: result.hit, witness: null }; // force first fragment-pair's witness to fail
      return result;
    };
    const { pairs } = await world.findClashes({ mode: 'volume-overlap', /* ... */ });
    assert.equal(pairs.length, 1);
    assert.notEqual(pairs[0].witness, null, 'the sibling fragment pair\'s valid witness must survive aggregation');
  });
  ```

- [ ] **Step 2: Write the failing test — surface-crossing outranks containment**

  ```js
  test('when both a surface-crossing and a containment witness are available for the same dbId pair, surface-crossing wins', async () => {
    const world = /* fixture with two fragment pairs for one dbId pair: one resolves via crossing, one via containment */;
    const { pairs } = await world.findClashes({ mode: 'volume-overlap', /* ... */ });
    assert.equal(pairs.length, 1);
    assert.equal(pairs[0].witness.kind, 'surface-crossing');
  });
  ```

- [ ] **Step 3: Write the failing test — traversal-order independence**

  In `test/CollisionWorld.tlasTraversal.test.mjs`, extend the existing `key()` helper (lines ~189-217) or add a parallel assertion:
  ```js
  test('linear and tlas broadPhase produce the SAME witness kind and point for equivalent inputs', async () => {
    const linearResult = await runQuery('linear');
    const tlasResult = await runQuery('tlas');
    const byKey = (result) => new Map(result.pairs.map((p) => [key(p), p]));
    const linearByKey = byKey(linearResult);
    const tlasByKey = byKey(tlasResult);
    for (const [k, linearPair] of linearByKey) {
      const tlasPair = tlasByKey.get(k);
      assert.ok(tlasPair, `tlas must produce a pair for ${k}`);
      assert.equal(linearPair.witness?.kind, tlasPair.witness?.kind, `witness kind must match for ${k}`);
      if (linearPair.witness && tlasPair.witness) {
        for (let i = 0; i < 3; i += 1) {
          assert.ok(
            Math.abs(linearPair.witness.point[i] - tlasPair.witness.point[i]) < 1e-6,
            `witness point[${i}] must match within tolerance for ${k}`,
          );
        }
      }
    }
  });
  ```

- [ ] **Step 4: Write the failing test — repeated identical queries are stable**

  ```js
  test('repeated identical queries never change the witness point', async () => {
    const world = /* known-positive fixture */;
    const r1 = await world.findClashes({ mode: 'volume-overlap', /* ... */ });
    const r2 = await world.findClashes({ mode: 'volume-overlap', /* ... */ });
    assert.deepEqual(r1.pairs[0].witness, r2.pairs[0].witness);
  });
  ```

- [ ] **Step 5: Write the failing test — witness-unavailable diagnostic emitted once, only when the final result is null**

  ```js
  test('a dbId pair with no valid witness after full aggregation gets exactly one witness-unavailable diagnostic', async () => {
    const world = /* fixture, all contributing fragment pairs stubbed to return witness:null while hit:true */;
    const { pairs, statistics } = await world.findClashes({ mode: 'volume-overlap', /* ... */ });
    assert.equal(pairs.length, 1);
    assert.equal(pairs[0].witness, null);
    const witnessDiagnostics = statistics.diagnostics.filter((d) => d.reason === 'witness-unavailable');
    assert.equal(witnessDiagnostics.length, 1, 'exactly one diagnostic for this dbId pair, not one per fragment-pair miss');
  });

  test('a witness-unavailable diagnostic never fires when a sibling fragment pair supplied a valid witness', async () => {
    // reuse Step 1's fixture/stub
    const { statistics } = await world.findClashes({ mode: 'volume-overlap', /* ... */ });
    assert.equal(statistics.diagnostics.some((d) => d.reason === 'witness-unavailable'), false);
  });
  ```

- [ ] **Step 6: Run tests to verify they fail**

  Run: `node --test test/CollisionWorld.findClashes.test.mjs test/CollisionWorld.tlasTraversal.test.mjs`
  Expected: FAIL — `pairsByKey` is still insert-only and carries no `witness` key.

- [ ] **Step 7: Implement `compareWitnessCandidates`**

  Add near `comparePlacedCanonically` (module scope):
  ```js
  function compareWitnessCandidates(a, b) {
    // a, b: { witness: {kind,point}|null, sourcePlaced, targetPlaced } | undefined
    const aw = a && a.witness;
    const bw = b && b.witness;
    if (!aw && !bw) return 0;
    if (!aw) return 1;
    if (!bw) return -1;
    if (aw.kind !== bw.kind) return aw.kind === 'surface-crossing' ? -1 : 1;
    return (
      comparePlacedCanonically(a.sourcePlaced, b.sourcePlaced) ||
      comparePlacedCanonically(a.targetPlaced, b.targetPlaced)
    );
  }
  ```

- [ ] **Step 8: Implement insert-or-replace aggregation**

  Replace the insert-only block (lines ~1391-1401) with a side-table approach so internal tie-break provenance (`sourcePlaced`/`targetPlaced`) never leaks onto the public `ClashPair`:
  ```js
  const witnessCandidateByKey = new Map(); // internal only — never exposed publicly

  // ...inside the loop, after computing `isHit`/`witness` (Task 4) and `key`:
  if (!pairsByKey.has(key)) {
    pairsByKey.set(key, {
      source: { modelId: modelIdOf(sourceOperand.model), dbId: sourcePlaced.ownerDbId, model: sourceOperand.model },
      target: { modelId: modelIdOf(targetOperand.model), dbId: targetPlaced.ownerDbId, model: targetOperand.model },
      type: query.mode,
      ...(query.mode === 'volume-overlap' ? { witness: null } : {}),
    });
  }
  if (query.mode === 'volume-overlap') {
    const candidate = { witness, sourcePlaced, targetPlaced };
    const existing = witnessCandidateByKey.get(key);
    if (!existing || compareWitnessCandidates(candidate, existing) < 0) {
      witnessCandidateByKey.set(key, candidate);
      pairsByKey.get(key).witness = witness;
    }
  }
  ```
  Note: the pair's `source`/`target`/`type` fields are still first-discovery-wins (unchanged M2 identity semantics, per the prompt's "do not alter pair dedup identity semantics from M2") — only the `witness` field is subject to the total-order replace.

- [ ] **Step 9: Implement the final witness-unavailable diagnostic pass**

  After the aggregation loop completes (i.e., after all candidates have been processed, before `findClashes` returns `{ pairs, statistics }`), add:
  ```js
  for (const pair of pairsByKey.values()) {
    if (pair.type === 'volume-overlap' && pair.witness === null) {
      const candidate = witnessCandidateByKey.get(/* the key for this pair — see note below */);
      statistics.diagnostics.push({
        scope: 'pair',
        reason: 'witness-unavailable',
        sourceFragment: fragmentRef(candidate.sourcePlaced.instance.model ?? sourceOperand.model, candidate.sourcePlaced),
        targetFragment: fragmentRef(candidate.targetPlaced.instance.model ?? targetOperand.model, candidate.targetPlaced),
      });
    }
  }
  ```
  Since `pairsByKey` and `witnessCandidateByKey` share the same `key` string, iterate both Maps' entries together (e.g. `for (const [key, pair] of pairsByKey)`) rather than re-deriving the key from `pair`. Read the existing `fragmentRef` helper's exact signature (used at the `attach` diagnostic site, lines 1588-1601) before finalizing this call — match its argument shape exactly rather than guessing.

- [ ] **Step 10: Run tests to verify they pass**

  Run: `node --test test/CollisionWorld.findClashes.test.mjs test/CollisionWorld.tlasTraversal.test.mjs`
  Expected: PASS.

- [ ] **Step 11: Run full collision-library regression**

  Run: `npm test`
  Expected: PASS — full suite, confirming no other test asserts on the old insert-only ordering behavior or the old two-argument `pairsByKey.set` shape.

- [ ] **Step 12: Commit**

  ```bash
  git add collision/CollisionWorld.js test/CollisionWorld.findClashes.test.mjs test/CollisionWorld.tlasTraversal.test.mjs
  git commit -m "M2.1: deterministic dbId-level witness aggregation, independent of broad-phase traversal order"
  ```

**Tests introduced/updated:** `test/CollisionWorld.findClashes.test.mjs` — valid-over-null, crossing-over-containment, repeated-query stability, witness-unavailable diagnostic (fires once / never-when-sibling-succeeds). `test/CollisionWorld.tlasTraversal.test.mjs` — linear/tlas witness-kind-and-point equivalence.

**Completion criteria:** All new tests pass; `npm test` (full suite) passes.

**Protected invariants:** Pair dedup identity (`source`/`target`/`type`, the `key` string) is unchanged — only `witness` selection is order-independent. A `witness: null` never appears without exactly one accompanying diagnostic, and a diagnostic never fires for a dbId pair whose final witness is non-null.

**Viewer/API evidence needed before coding:** None.

---

## Task 6: Alignment/`invalidateModelPlacement` witness-tracking fixture

**Objective:** Extend the existing M2 alignment fixture to prove a witness point moves to the newly-aligned location after `invalidateModelPlacement`, since witness computation reuses the exact same `worldMatrix` values the verdict itself already depends on (no separate invalidation path needed).

**Files:**
- Modify: `test/CollisionWorld.placementInvalidation.test.mjs`

**Prerequisites:** Task 5 complete.

**Interfaces:** Consumes: `findClashes(...).pairs[].witness` (Task 5).

**Current landed state (verified):** The existing fixture at `test/CollisionWorld.placementInvalidation.test.mjs:380-441` ("align -> invalidateModelPlacement -> next TLAS query rebuilds -> TLAS and linear oracle agree after alignment") already simulates a moved fragment via `fragmentGeometryB.set(...)`, calls `world.invalidateModelPlacement(modelB)`, and asserts `tlasBuilds === 1` plus linear/tlas agreement.

**Implementation steps:**

- [ ] **Step 1: Write the failing test**

  In the same file, extend the existing fixture (don't duplicate its setup — add assertions to the existing test or a new test sharing its fixture builder):
  ```js
  test('witness point moves to the newly-aligned location after invalidateModelPlacement', async () => {
    // reuse this file's existing align -> invalidateModelPlacement fixture setup
    const beforeResult = await world.findClashes({ mode: 'volume-overlap', broadPhase: 'tlas', /* ... */ });
    const beforeWitness = beforeResult.pairs[0].witness;
    // ...apply the existing fixture's alignment/fragmentGeometryB.set(...) + invalidateModelPlacement(modelB)
    const afterResult = await world.findClashes({ mode: 'volume-overlap', broadPhase: 'tlas', /* ... */ });
    const afterWitness = afterResult.pairs[0].witness;
    assert.ok(afterWitness, 'a witness must still be present after alignment');
    assert.notDeepEqual(afterWitness.point, beforeWitness.point, 'witness must move when the model is realigned');
  });
  ```

- [ ] **Step 2: Run test to verify it fails**

  Run: `node --test test/CollisionWorld.placementInvalidation.test.mjs`
  Expected: FAIL — witness support doesn't exist until Tasks 1–5 land (this task assumes they're already merged, matching Batch 1's dependency order); if run standalone before those tasks, it fails with `witness` being `undefined`.

- [ ] **Step 3: Confirm it passes with no additional implementation code**

  Since Tasks 1–5 already make witness placement-fresh by construction (witness is computed from the same `worldMatrix` the verdict uses, no separate cache), this test requires **no new production code** — only the test itself. Run: `node --test test/CollisionWorld.placementInvalidation.test.mjs`. Expected: PASS once Tasks 1–5 are merged.

- [ ] **Step 4: Commit**

  ```bash
  git add test/CollisionWorld.placementInvalidation.test.mjs
  git commit -m "M2.1: extend alignment fixture to assert witness moves with invalidateModelPlacement"
  ```

**Tests introduced/updated:** `test/CollisionWorld.placementInvalidation.test.mjs` — witness-moves-with-alignment.

**Completion criteria:** Test passes; no production code changes required (validates Task 5's design, doesn't add new behavior).

**Protected invariants:** None new — this task is a proof, not a feature.

**Viewer/API evidence needed before coding:** None.

---

# Batch 1 checkpoint

At this point `findClashes` for `type: 'volume-overlap'` returns a fully populated, deterministic, order-independent `witness` field, backward compatible in every dimension, with `witness: null` behaving strictly as the fault-tolerance contract. Run `npm test` (full suite) once more before starting Batch 2. This is a natural review boundary — Batch 2 is independent Viewer/UI work and can be reviewed separately from the geometry pipeline.

---

## Task 7: Viewer overlay API evidence (already resolved by planning-stage research — recorded here for the record)

**Objective:** Pin the exact Viewer 7.124.2 overlay API surface, material/occlusion behavior, and runtime-global evidence needed before writing any marker code — required by the prompt as a bounded, sourced verification step, not a guess.

**Status:** **Complete.** A dedicated Viewer-API-evidence research pass was run as part of this plan's preparation, against the exact pinned bundle this repo loads (`wwwroot/index.html`, Viewer 7.124.2, decoded SHA-256 `12b9fe49f41dc99ccec62535e5c887da915980829da2e941cfe4da3d7197c02e` — matches this Agent Kit's existing provenance record, no drift). No implementation task should re-derive this from memory; the findings below are the source of truth for Task 8.

**Findings (source-observed against `viewer3D.js` 7.124.2, cross-checked against official docs):**

1. **Recommended API: the public `viewer.overlays.*` facade, not the internal `viewer.impl.*` path the spec assumed.**
   `viewer.overlays.addScene(name)` / `.hasScene(name)` / `.addMesh(name, mesh)` / `.removeMesh(name, mesh)` / `.clearScene(name)` / `.removeScene(name)` are all `public`, documented (Reference Guide + "Adding Custom Geometry" Developer's Guide, reconfirmed live 2026-09-07), and route to the exact same internal render path as `viewer.impl.createOverlayScene`/`addOverlay`/`removeOverlay`/`removeOverlayScene`. The public `addScene` additionally **guards against duplicate names** (the internal `createOverlayScene` does not — calling it twice with the same name silently overwrites the registry entry, orphaning existing meshes and leaking previously-registered override materials). M2.1 needs no raw `THREE.Scene` handle, no custom render-to-target pass, and no GPU picking — none of the reasons that would justify reaching for the internal path. **Decision: Task 8 uses the public `viewer.overlays.*` facade.** This is a deliberate, evidence-based deviation from the spec's own §9.1 wording (which named `viewer.impl.createOverlayScene`/`addOverlay`/`removeOverlay`) — functionally equivalent, strictly safer (duplicate-name guard), and a `public` (not `undocumented`) surface. No spec contradiction requiring spec re-approval: the spec's own §17 flagged "exact overlay-scene Viewer API call signatures... should be pinned against Viewer 7.124.2 during implementation planning" as a non-blocking open item — this finding is that pinning.

2. **`depthTest: false` genuinely renders a marker through occluding model geometry**, confirmed via the render pipeline (`RenderContext.renderOverlays`, overlay target's depth buffer always bound to or copied from the main pass's depth in every configuration branch) and via the shipped `OverlayManager` class's own JSDoc: *"the overlay scenes use the main scene depth buffer for the depth testing, to allow the overlay to appear in the main scene."* **Pair it with `depthWrite: false`** (LMV's own convention for its selection-overlay materials) to avoid polluting a depth buffer other draws still read.

3. **No explicit `invalidate()` call is needed.** `addOverlay`/`removeOverlay`/`removeOverlayScene`/`clearOverlay` (and their public wrappers) all internally call `this.invalidate(false, false, true)`, which sets `_overlayDirty = true` — sufficient by itself to trigger a redraw on the render loop's very next iteration (LMV's `MainLoop` runs continuously regardless of camera movement).

4. **`window.THREE` is a genuine global** (`av.getGlobal().THREE = LMV.THREE`, resolving to `window` in this repo's plain-browser deployment), and `window.THREE.Vector3` / `SphereGeometry` / `MeshBasicMaterial` / `Mesh` are all real, directly usable constructors — independently corroborated by the shipped `OverlayManager#addMesh` JSDoc example, which constructs exactly this shape (`new THREE.SphereGeometry(...)`, `new THREE.MeshBasicMaterial({color})`, `new THREE.Mesh(geometry, material)`).

5. **Teardown gotcha:** `removeOverlayScene`/`removeScene` unregister the scene entry and any override materials passed to `createOverlayScene`, but do **not** dispose meshes still in the scene or their geometries/materials. `clearOverlay`/`clearScene(name)` removes every mesh from a scene and optionally disposes geometry (`disposeGeometry` param) — but **never disposes materials** either way. Task 8/9's teardown must explicitly dispose the shared geometry and material itself; do not rely on `removeScene`/`clearScene` for that.

6. **Marker sizing input:** to compute `sceneBoundingSphereRadius` "the same bounds already computed for `fitToView`" (spec §9.1), use the public `InstanceTree.getNodeBox(dbId, box)` per isolated dbId (union the boxes across all isolated dbIds/models), then derive a bounding-sphere radius from the resulting `THREE.Box3` — this is the same primitive `fitToView` itself is built on, is fully public, and requires no new evidence-gathering.

**Open items requiring a live-Viewer runtime check during Task 8/10 (not resolvable from static evidence):**
- Marker color fidelity through the overlay gamma/compositing path (visibility through occlusion is settled; whether the on-screen color exactly matches the authored hex is not) — check this live at the same time as the enclosed-witness visibility check (Task 10), one combined observation.
- Exact `minRadius`/`maxRadius`/`radiusFraction` constants — the spec explicitly defers these to implementation-time tuning against the real fixture; Task 8 ships defaults, Task 10's live acceptance pass tunes them.

**Completion criteria:** This task requires no code changes — it is complete as recorded above. Task 8 must cite this section rather than re-deriving Viewer API signatures from memory.

---

## Task 8: Marker overlay implementation

**Objective:** `ClashFinderExtension` gains a lazily-created overlay scene, one shared `SphereGeometry`/`MeshBasicMaterial` pair, and one `Mesh` per witness-bearing `ClashPair`, built exclusively from `window.THREE`, sized via a clamped radius derived from the isolated dbIds' combined bounding sphere.

**Files:**
- Modify: `wwwroot/extensions/ClashFinderExtension.js`
- Test: a new `test/extensions/ClashFinderExtension.markers.test.mjs` (headless/mocked Viewer — check whether `test/fixtures/mockInstanceTree.mjs` or a sibling mock-viewer fixture already exists for extension-level tests; if `ClashFinderExtension.js` has no existing unit-test file, this is the first one — mirror the mock-Viewer construction pattern used by `RoomLocatorExtension`'s tests if one exists, otherwise build a minimal mock `viewer` object exposing `.overlays.{addScene,hasScene,addMesh,removeMesh,clearScene,removeScene}`, `.model`/`.getInstanceTree()`, and the existing hooks this file already calls)

**Prerequisites:** Task 5 complete (consumes `ClashPair.witness`), Task 7 (evidence) read.

**Interfaces:**
- Consumes: `ClashPair.witness` (`{kind, point: [x,y,z]} | null`), Task 7's evidence findings.
- Produces: `ClashFinderExtension` gains `this._markerOverlayName` (a string constant, e.g. `'clash-finder-markers'`), `this._markerGeometry`/`this._markerMaterial` (lazily created, shared), `this._activeMarkers` (array of `THREE.Mesh`), `_ensureMarkerOverlay()`, `_computeMarkerRadius(dbIdsByModel)`, `_addMarkers(pairs)`, `_clearMarkers()`. Task 9 consumes `_addMarkers`/`_clearMarkers`/`_activeMarkers` and wires them into the lifecycle.

**Current landed state (verified):** No overlay/marker mechanism exists anywhere in this repo (confirmed by repo-wide grep for `createOverlayScene`/`addOverlay`/`removeOverlay` — zero hits; `RoomLocatorExtension.js` has zero "Overlay"/"THREE"/"Mesh" references). `ClashFinderExtension.js` imports only `CollisionWorld` from `'../../collision/index.js'` (line 14) and never imports `three` or references `window.THREE` today. `this._isolatedModels` is a `Set` (line 58) — `_activeMarkers` is deliberately an **array** instead (ordered list of individual `Mesh` instances to remove one at a time), a documented pattern deviation, not a copy-paste of the `Set` precedent. `dbIdsByModel` (built at lines 238-242, applied at lines 261-266) is the exact per-model dbId grouping to reuse for the bounding-sphere computation.

**Implementation steps:**

- [ ] **Step 1: Write the failing test — lazy overlay creation and shared resources**

  ```js
  test('the marker overlay scene and shared geometry/material are created lazily on first marker, not at construction', () => {
    const { extension, mockViewer } = buildExtensionWithMockViewer();
    assert.equal(mockViewer.overlays.hasScene('clash-finder-markers'), false);
    extension._addMarkers([{ witness: { kind: 'surface-crossing', point: [1, 2, 3] } }]);
    assert.equal(mockViewer.overlays.hasScene('clash-finder-markers'), true);
    assert.equal(extension._activeMarkers.length, 1);
  });

  test('multiple markers share one geometry and one material instance', () => {
    const { extension } = buildExtensionWithMockViewer();
    extension._addMarkers([
      { witness: { kind: 'surface-crossing', point: [0, 0, 0] } },
      { witness: { kind: 'containment', point: [1, 1, 1] } },
    ]);
    assert.equal(extension._activeMarkers.length, 2);
    assert.equal(extension._activeMarkers[0].geometry, extension._activeMarkers[1].geometry);
    assert.equal(extension._activeMarkers[0].material, extension._activeMarkers[1].material);
  });
  ```

- [ ] **Step 2: Write the failing test — null-witness pairs produce no marker**

  ```js
  test('a null-witness ClashPair produces no marker', () => {
    const { extension } = buildExtensionWithMockViewer();
    extension._addMarkers([{ witness: null }, { witness: { kind: 'containment', point: [1, 1, 1] } }]);
    assert.equal(extension._activeMarkers.length, 1);
  });
  ```

- [ ] **Step 3: Write the failing test — no `three` import**

  ```js
  test('ClashFinderExtension.js does not import the npm three package', async () => {
    const source = await fs.readFile(new URL('../../wwwroot/extensions/ClashFinderExtension.js', import.meta.url), 'utf8');
    assert.ok(!/from\s+['"]three['"]/.test(source), 'must never import the collision library\'s r185 three package');
    assert.ok(!/require\(['"]three['"]\)/.test(source));
  });
  ```

- [ ] **Step 4: Write the failing test — marker radius is clamped**

  ```js
  test('marker radius is clamped between MIN_MARKER_RADIUS and MAX_MARKER_RADIUS regardless of scene scale', () => {
    const { extension } = buildExtensionWithMockViewer({ sceneBoundingSphereRadius: 0.001 }); // tiny fixture
    const tinyRadius = extension._computeMarkerRadius();
    assert.ok(tinyRadius >= extension.constructor.MIN_MARKER_RADIUS);

    const { extension: bigExtension } = buildExtensionWithMockViewer({ sceneBoundingSphereRadius: 100000 }); // km-scale
    const bigRadius = bigExtension._computeMarkerRadius();
    assert.ok(bigRadius <= bigExtension.constructor.MAX_MARKER_RADIUS);
  });
  ```

- [ ] **Step 5: Run tests to verify they fail**

  Run: `node --test test/extensions/ClashFinderExtension.markers.test.mjs`
  Expected: FAIL — none of this exists yet. (Step 3's test can be written and will pass immediately, since the import genuinely doesn't exist yet — keep it as a permanent regression guard, not a TDD-red step.)

- [ ] **Step 6: Implement — overlay scene name, lazy resource creation**

  Add near the top of the file (module scope, alongside `EXTENSION_ID`):
  ```js
  const MARKER_OVERLAY_NAME = 'clash-finder-markers';
  const MARKER_RADIUS_FRACTION = 0.01;
  const MIN_MARKER_RADIUS = 0.05; // world units — tune during Task 10 live acceptance against the real fixture
  const MAX_MARKER_RADIUS = 2.0; // world units — tune during Task 10 live acceptance against the real fixture
  const MARKER_COLOR = 0xff6a00; // distinct from the Viewer's default selection theme — confirm visually in Task 10
  ```
  In the constructor, add `this._activeMarkers = []; this._markerGeometry = null; this._markerMaterial = null;` alongside the existing `this._isolatedModels = new Set();`.

  Add a private helper:
  ```js
  _ensureMarkerOverlay() {
    const THREE = window.THREE; // Viewer's own r71 global — never import 'three' in this file
    if (!this._markerGeometry) {
      this._markerGeometry = new THREE.SphereGeometry(1, 12, 8); // unit sphere — scaled per-instance below
      this._markerMaterial = new THREE.MeshBasicMaterial({
        color: MARKER_COLOR,
        depthTest: false,
        depthWrite: false,
      });
    }
    if (!this._viewer.overlays.hasScene(MARKER_OVERLAY_NAME)) {
      this._viewer.overlays.addScene(MARKER_OVERLAY_NAME);
    }
  }
  ```

- [ ] **Step 7: Implement — `_computeMarkerRadius`**

  ```js
  _computeMarkerRadius(dbIdsByModel) {
    const THREE = window.THREE;
    const box = new THREE.Box3();
    for (const [model, dbIdSet] of dbIdsByModel) {
      const instanceTree = model.getInstanceTree();
      const nodeBox = new THREE.Box3();
      for (const dbId of dbIdSet) {
        instanceTree.getNodeBox(dbId, nodeBox); // public InstanceTree API, same primitive fitToView uses
        box.union(nodeBox);
      }
    }
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const raw = sphere.radius * MARKER_RADIUS_FRACTION;
    return Math.min(Math.max(raw, MIN_MARKER_RADIUS), MAX_MARKER_RADIUS);
  }
  ```
  Confirm `Box3.getBoundingSphere`'s exact signature against `window.THREE` at implementation time (it may take an optional target sphere, or return a new one — the r71 fork's exact signature should be spot-checked in the live/mock environment during Step 9's manual check, not assumed identical to a stock three.js release, per Task 7 finding 6's caveat).

- [ ] **Step 8: Implement — `_addMarkers(pairs)` and `_clearMarkers()`**

  ```js
  _addMarkers(pairs, dbIdsByModel) {
    const THREE = window.THREE;
    const witnessBearing = pairs.filter((p) => p.witness);
    if (witnessBearing.length === 0) return;
    this._ensureMarkerOverlay();
    const radius = this._computeMarkerRadius(dbIdsByModel);
    for (const pair of witnessBearing) {
      const mesh = new THREE.Mesh(this._markerGeometry, this._markerMaterial);
      mesh.scale.setScalar(radius);
      mesh.position.set(pair.witness.point[0], pair.witness.point[1], pair.witness.point[2]);
      mesh.updateMatrixWorld(true);
      this._viewer.overlays.addMesh(MARKER_OVERLAY_NAME, mesh);
      this._activeMarkers.push(mesh);
    }
  }

  _clearMarkers() {
    for (const mesh of this._activeMarkers) {
      this._viewer.overlays.removeMesh(MARKER_OVERLAY_NAME, mesh);
    }
    this._activeMarkers.length = 0;
  }
  ```
  Note `_addMarkers` takes `dbIdsByModel` as a parameter (needed for radius computation) rather than reading extension state directly — Task 9 wires the actual call site, which already has `dbIdsByModel` in scope at that point in `onContextMenu`.

- [ ] **Step 9: Run tests to verify they pass**

  Run: `node --test test/extensions/ClashFinderExtension.markers.test.mjs`
  Expected: PASS.

- [ ] **Step 10: Commit**

  ```bash
  git add wwwroot/extensions/ClashFinderExtension.js test/extensions/ClashFinderExtension.markers.test.mjs
  git commit -m "M2.1: add Viewer-native overlay marker rendering (window.THREE only, shared geometry/material)"
  ```

**Tests introduced/updated:** `test/extensions/ClashFinderExtension.markers.test.mjs` — lazy creation, shared resources, null-witness skip, no-`three`-import regression, radius clamping.

**Completion criteria:** All new tests pass. `ClashFinderExtension.js` still imports nothing from `three`.

**Protected invariants:** No per-marker geometry/material duplication. Marker radius is always clamped, never an unbounded fraction. `MeshBasicMaterial`/`SphereGeometry`/`Mesh`/point come exclusively from `window.THREE`.

**Viewer/API evidence needed before coding:** Already satisfied by Task 7 — reuse those findings; do not re-research.

---

## Task 9: Marker lifecycle integration (stale-token, isolation clear/apply, model-unload, extension-unload)

**Objective:** Wire `_addMarkers`/`_clearMarkers` into every existing isolation-lifecycle touchpoint in `ClashFinderExtension`, exactly mirroring `_clearIsolation()`'s discipline, with marker teardown surviving a throwing `_world.dispose()`.

**Files:**
- Modify: `wwwroot/extensions/ClashFinderExtension.js`
- Test: `test/extensions/ClashFinderExtension.markers.test.mjs` (extend), a new lifecycle-focused test file or section if the mock-Viewer fixture from Task 8 needs extending for model-unload/context-menu simulation

**Prerequisites:** Task 8 complete.

**Interfaces:** Consumes: `_addMarkers`, `_clearMarkers`, `_activeMarkers` (Task 8). No new public interface — this task only rewires existing private call sites.

**Current landed state (verified), exact call sites to extend:**
- `_latestActionToken`: init line 54, bumped in `unload()` line 89 and context-menu `target()` line 160, captured as `token` line 161, checked catch-path line 182 and success-path line 196.
- `_clearIsolation()` (lines 133-138): failure-path call **line 189**, success-path call **line 217** (before applying new isolation).
- `_onBeforeModelUnload` (lines 105-111): currently `this._world.evictModel(event.model); this._isolatedModels.delete(event.model);` — no marker awareness today.
- `unload()` (lines 88-98): `this._latestActionToken += 1;` (89) → `try { this._world.dispose(); } finally { removeEventListener; unregisterContextMenuCallback; }` (90-95) → `this._clearIsolation();` (96) → `return true;` (97). **The existing inner `finally` covers only the two listener/menu-callback removals — nothing currently guarantees code after `dispose()` runs if `dispose()` throws.** This is exactly why marker teardown needs a **new outer `finally`**.
- `dbIdsByModel` built lines 238-242, applied lines 261-266 (isolate + fitToView + `_isolatedModels.add`) — this is where `_addMarkers` needs to be called, since it needs the same `dbIdsByModel` for radius computation.

**Implementation steps:**

- [ ] **Step 1: Write the failing test — successful Find Clashes clears old and adds new markers**

  ```js
  test('a successful Find Clashes clears previous markers before adding new ones', async () => {
    const { extension, triggerFindClashes } = buildExtensionWithMockViewer();
    await triggerFindClashes({ pairsWithWitness: 2 });
    assert.equal(extension._activeMarkers.length, 2);
    await triggerFindClashes({ pairsWithWitness: 1 });
    assert.equal(extension._activeMarkers.length, 1, 'old markers must be cleared, not accumulated');
  });
  ```

- [ ] **Step 2: Write the failing test — zero-clash result clears previous markers, adds none**

  ```js
  test('a zero-clash result clears previous markers and adds none', async () => {
    const { extension, triggerFindClashes } = buildExtensionWithMockViewer();
    await triggerFindClashes({ pairsWithWitness: 2 });
    await triggerFindClashes({ pairsWithWitness: 0 });
    assert.equal(extension._activeMarkers.length, 0);
  });
  ```

- [ ] **Step 3: Write the failing test — query failure clears previous markers, no stale markers survive**

  ```js
  test('a failed query clears previous markers instead of leaving stale ones', async () => {
    const { extension, triggerFindClashes, triggerFindClashesFailure } = buildExtensionWithMockViewer();
    await triggerFindClashes({ pairsWithWitness: 2 });
    await triggerFindClashesFailure();
    assert.equal(extension._activeMarkers.length, 0);
  });
  ```

- [ ] **Step 4: Write the failing test — stale action token supersedes, never touches markers**

  ```js
  test('a superseded stale action token never restores or clears markers on the losing continuation', async () => {
    const { extension, triggerTwoOverlappingFindClashes } = buildExtensionWithMockViewer();
    const finalMarkerCount = await triggerTwoOverlappingFindClashes(); // second call fires before first resolves
    assert.equal(extension._activeMarkers.length, finalMarkerCount, 'only the LATEST action\'s result should be reflected');
  });
  ```
  Mirror this file's/existing test suite's pattern for simulating overlapping async context-menu invocations if one already exists for isolation (`ClashFinderExtension` itself has no existing unit tests per the research — check `test/CollisionWorld.findClashes.test.mjs`'s async-ordering patterns for a technique to adapt, e.g. controlling promise resolution order via deferred promises).

- [ ] **Step 5: Write the failing test — model unload clears the entire visualization**

  ```js
  test('unloading any participating model clears both isolation and markers for every model', async () => {
    const { extension, triggerFindClashes, unloadModel, modelA } = buildExtensionWithMockViewer({ federated: true });
    await triggerFindClashes({ pairsWithWitness: 2 });
    unloadModel(modelA);
    assert.equal(extension._activeMarkers.length, 0, 'the ENTIRE visualization clears, not just markers referencing modelA');
    assert.equal(extension._isolatedModels.size, 0);
  });
  ```

- [ ] **Step 6: Write the failing test — extension unload tears down markers even when `_world.dispose()` throws**

  ```js
  test('unload() disposes markers/overlay scene even if _world.dispose() throws', () => {
    const { extension, mockViewer } = buildExtensionWithMockViewer();
    extension._addMarkers([{ witness: { kind: 'containment', point: [1, 1, 1] } }]);
    extension._world.dispose = () => { throw new Error('boom'); };
    assert.throws(() => extension.unload(), /boom/);
    assert.equal(extension._activeMarkers.length, 0, 'markers must be torn down even though dispose() threw');
    assert.equal(mockViewer.overlays.hasScene('clash-finder-markers'), false, 'the overlay scene itself must be removed too');
  });
  ```

- [ ] **Step 7: Write the failing test — shared geometry/material disposed exactly once, after every mesh is removed**

  ```js
  test('shared geometry and material are disposed exactly once on unload, after marker meshes are removed', () => {
    const { extension } = buildExtensionWithMockViewer();
    extension._addMarkers([{ witness: { kind: 'containment', point: [1, 1, 1] } }]);
    const geometry = extension._markerGeometry;
    const material = extension._markerMaterial;
    let geometryDisposed = 0;
    let materialDisposed = 0;
    geometry.dispose = () => { geometryDisposed += 1; };
    material.dispose = () => { materialDisposed += 1; };
    extension.unload();
    assert.equal(geometryDisposed, 1);
    assert.equal(materialDisposed, 1);
  });
  ```

- [ ] **Step 8: Run tests to verify they fail**

  Run: `node --test test/extensions/ClashFinderExtension.markers.test.mjs`
  Expected: FAIL.

- [ ] **Step 9: Implement — success/failure/zero-clash paths in `onContextMenu`'s `target()` callback**

  At the failure path (line ~189, alongside the existing `this._clearIsolation();`):
  ```js
  this._clearIsolation();
  this._clearMarkers();
  ```
  At the success path (line ~217, alongside the existing `this._clearIsolation();`, still before applying new isolation):
  ```js
  this._clearIsolation();
  this._clearMarkers();
  ```
  After the existing apply loop (lines 261-266, which builds `dbIdsByModel` and applies isolation), add the marker call — still inside the same token-guarded success block:
  ```js
  this._addMarkers(pairs, dbIdsByModel); // `pairs` is the findClashes result already in scope in this block
  ```
  Read the exact local variable name for the `findClashes` result's `pairs` array at this point in the function before finalizing — it's already in scope since the existing isolation-apply loop iterates it.

- [ ] **Step 10: Implement — `_onBeforeModelUnload`**

  ```js
  _onBeforeModelUnload(event) {
    if (!event || !event.model) {
      throw new Error('ClashFinderExtension: BEFORE_MODEL_UNLOAD_EVENT fired with no event.model — typings declare `event: any`; this handler cannot proceed without the model object.');
    }
    this._world.evictModel(event.model);
    this._clearIsolation(); // entire visualization clears on ANY participating-model unload — not per-model filtering
    this._clearMarkers();
    this._isolatedModels.delete(event.model);
  }
  ```
  Per spec §9.2: this deliberately clears the **entire** visualization (all models), not just the unloaded model's markers — a partial-preservation policy was shown unsound (surviving models could be left isolated with no marker). `_clearIsolation()` already iterates `this._isolatedModels` unconditionally, so calling it here already achieves "clear for every model."

- [ ] **Step 11: Implement — `unload()` with a new outer `finally` for marker teardown**

  ```js
  unload() {
    this._latestActionToken += 1;
    try {
      try {
        this._world.dispose();
      } finally {
        this._viewer.removeEventListener(BEFORE_MODEL_UNLOAD_EVENT, this._onBeforeModelUnloadBound);
        this._viewer.unregisterContextMenuCallback(EXTENSION_ID);
      }
      this._clearIsolation();
    } finally {
      this._clearMarkers();
      if (this._viewer.overlays.hasScene(MARKER_OVERLAY_NAME)) {
        this._viewer.overlays.removeScene(MARKER_OVERLAY_NAME);
      }
      if (this._markerGeometry) { this._markerGeometry.dispose(); this._markerGeometry = null; }
      if (this._markerMaterial) { this._markerMaterial.dispose(); this._markerMaterial = null; }
    }
    return true;
  }
  ```
  The new outer `finally` wraps the **entire existing body** (the original try/finally plus `_clearIsolation()`), so marker teardown runs regardless of whether `dispose()` throws, and regardless of whether `_clearIsolation()` itself throws. `_clearMarkers()` runs before disposing the shared geometry/material, satisfying "disposed once, after every mesh referencing them has already been removed." Confirm `return true;` after a `try/finally` with no `return` inside the `finally` still returns `true` as expected (it does — a `finally` without its own `return`/`throw` doesn't override the outer return value); if `unload()` is expected to still return `true` even when `dispose()` threw, that's an existing behavior question outside this task's scope — the test in Step 6 only asserts the throw propagates and teardown still ran, matching the spec's requirement.

- [ ] **Step 12: Run tests to verify they pass**

  Run: `node --test test/extensions/ClashFinderExtension.markers.test.mjs`
  Expected: PASS.

- [ ] **Step 13: Commit**

  ```bash
  git add wwwroot/extensions/ClashFinderExtension.js test/extensions/ClashFinderExtension.markers.test.mjs
  git commit -m "M2.1: wire marker lifecycle into existing isolation clear/apply, stale-token, and unload discipline"
  ```

**Tests introduced/updated:** `test/extensions/ClashFinderExtension.markers.test.mjs` — success/zero-clash/failure/stale-token/model-unload/exceptional-unload/dispose-ordering.

**Completion criteria:** All new tests pass; full suite (`npm test`) passes.

**Protected invariants:** Isolation and markers are always cleared/applied together, at the same call sites — they can never visually disagree. Marker teardown runs even when `_world.dispose()` throws. Model unload clears the entire visualization, not per-model.

**Viewer/API evidence needed before coding:** Task 7's findings (overlay API, teardown gotcha).

---

# Batch 2 checkpoint

Marker rendering and lifecycle are now fully wired and unit-tested against a mock Viewer. Run `npm test` (full suite). This is the natural boundary before live-Viewer acceptance work, which needs a running dev server and cannot be exercised by `node --test` alone.

---

## Task 10: Live federated marker acceptance

**Objective:** Extend `test/acceptance/clash-finder.acceptance.mjs` to prove, against the real translated Architecture/Structure/Mechanical fixture in a real Viewer 7.124.2 instance, that every normal positive `volume-overlap` pair has `witness !== null`, a marker renders at each witness location (including at least one enclosed/containment witness visible through opaque geometry), markers track alignment and clear on model unload, and zero console errors occur.

**Files:**
- Modify: `test/acceptance/clash-finder.acceptance.mjs`

**Prerequisites:** Tasks 1–9 complete. Dev server running (`npm start &`, per this repo's acceptance-test convention).

**Interfaces:** Consumes the full witness pipeline end-to-end; no new interfaces produced.

**Current landed state (verified) — acceptance fixture gap to resolve first:**
- The existing fixture uses three real federated models (Architecture `Audubon_Architecture_clash_test.rvt`, Structure `Audubon_Structure_clash_test.rvt` — always the source, Mechanical `Audubon_Mechanical_clash_test.rvt`), with a known positive `MIXED_CASE` (source dbId `2734`, 2 resulting pairs: one cross-model to Architecture dbId `3686`, one same-model to Structure dbId `3663`) and a known clean `NEGATIVE_CASE` (source dbId `3965`, 0 pairs).
- **`ClashFinderExtension` hardcodes `mode: 'volume-overlap'`** — both `MIXED_CASE` pairs are `volume-overlap` results, but it is currently unknown whether either resolves via the crossing branch or a containment branch (the fixture predates witness support; nothing recorded which `via` value fired).
- **No known containment/enclosed-witness case currently exists in this three-model fixture.** The only production code exercising standalone `containment` mode end-to-end is `RoomLocatorExtension`, against a *different* fixture (Room Locator's own bathtub-in-bathroom case, dbId `2530` inside dbId `3885`) — not directly usable here since `ClashFinderExtension` never runs `mode: 'containment'`, only `volume-overlap` (whose containment *branch* is a different code path than standalone containment mode, though it uses the same `anyComponentInside` leaf).

**Implementation steps:**

- [ ] **Step 1: Discovery spike — determine `MIXED_CASE`'s actual witness kinds**

  With Tasks 1–9 merged, run the existing `MIXED_CASE` query once (e.g. via a throwaway Node script using this repo's existing geometry-extraction test harness against the same translated URNs, or by adding a temporary `console.log(pairs.map(p => p.witness?.kind))` to the acceptance script and running it once) and record which `via`/`witness.kind` each of the two known pairs actually produced. This determines whether `MIXED_CASE` already covers a `surface-crossing` case, a `containment` case, both, or neither.

- [ ] **Step 2: If `MIXED_CASE` yields no containment/enclosed witness, find or construct one**

  If Step 1 shows both `MIXED_CASE` pairs resolve via `crossing`, a separate enclosed/containment case is still required per the spec's acceptance workflow (item 5: "at least one enclosed witness remains visible through opaque geometry"). Options, in order of preference:
  1. Search the same three loaded models for another real dbId pair whose `volume-overlap` result resolves via a containment branch — e.g. write a small bounded discovery script that runs `findClashes({mode: 'volume-overlap'})` against a broader (but still bounded — do not brute-force the entire federation) set of Structure/Mechanical source dbIds already known to be geometrically embedded (e.g. an MEP fitting or conduit run known to pass fully inside a wall or floor slab in this fixture) and inspect `witness.kind` on the results.
  2. If no natural containment pair is found within a reasonable bounded search, document this explicitly as a fixture limitation in the acceptance test's own header comment (matching this file's existing convention of documenting known quirks) and use a **separate, minimal, purpose-built test model** containing one small object fully embedded in a larger solid, loaded as an additional acceptance fixture solely for the enclosed-witness visibility check — do not skip this acceptance criterion; the spec treats it as required (§9.1, §11, §12).
  Record the final decision and the resulting dbId(s)/model(s) directly in this task's implementation before writing Step 3's assertions — do not leave a placeholder.

- [ ] **Step 3: Extend the acceptance script — witness presence on the known positive case**

  ```js
  // after the existing MIXED_CASE assertions on pairs.length/dbIds:
  for (const pair of pairs) {
    assert.notEqual(pair.witness, null, `pair ${pair.source.dbId}->${pair.target.dbId} must have a non-null witness`);
  }
  ```

- [ ] **Step 4: Extend the acceptance script — marker DOM/scene presence**

  Use Playwright to evaluate in-page that the overlay scene exists and holds the expected mesh count after Find Clashes runs:
  ```js
  const markerCount = await page.evaluate(() => {
    const ext = window.NOP_VIEWER.getExtension('ClashFinderExtension'); // confirm actual extension-lookup pattern used elsewhere in this file
    return ext._activeMarkers.length;
  });
  assert.equal(markerCount, pairs.filter((p) => p.witness).length);
  ```
  Read this file's existing convention for reaching into the live extension/viewer instance (it already does this for isolation checks) and match it exactly rather than inventing a new access pattern.

- [ ] **Step 5: Extend the acceptance script — enclosed witness is visually visible, not merely present**

  For the containment/enclosed case identified in Step 2: position the camera to look through the occluding geometry toward the known marker world position (reuse this file's existing camera-fit/positioning helpers), then take a screenshot region or sample pixel color at the marker's projected screen position and assert it matches the marker color (not the occluding geometry's color) — per the prompt's explicit ban on pixel-perfect screenshot comparison, use a coarse check (e.g., sample a small pixel neighborhood and assert the dominant color is closer to `MARKER_COLOR` than to the wall/duct material's typical rendered color) rather than an exact-image diff. If this repo's existing acceptance infrastructure has no precedent for pixel sampling, keep this check narrowly scoped (one sample point, one tolerance band) rather than building new generic screenshot infrastructure.

- [ ] **Step 6: Extend the acceptance script — negative case clears markers**

  ```js
  // after running NEGATIVE_CASE:
  const markerCountAfterNegative = await page.evaluate(() => window.NOP_VIEWER.getExtension('ClashFinderExtension')._activeMarkers.length);
  assert.equal(markerCountAfterNegative, 0);
  ```

- [ ] **Step 7: Extend the acceptance script — alignment moves the marker**

  Perform one real model-alignment operation on one of the three federated models (reuse whatever alignment mechanism this repo's live acceptance already has access to — check `test/acceptance/room-locator.acceptance.mjs` for the established alignment-trigger pattern, since Room Locator's own fixture already exercises `invalidateModelPlacement`), call `invalidateModelPlacement`, rerun `MIXED_CASE`, and assert the marker's world position (read back via `_activeMarkers[i].position`) differs from its pre-alignment position.

- [ ] **Step 8: Extend the acceptance script — model unload clears the entire visualization**

  ```js
  // unload one participating model mid-session
  assert.equal(await page.evaluate(() => window.NOP_VIEWER.getExtension('ClashFinderExtension')._activeMarkers.length), 0);
  ```

- [ ] **Step 9: Extend the acceptance script — zero console errors**

  Confirm this file's existing console-error-collection pattern (if one exists — check the file/`room-locator.acceptance.mjs` for a precedent) already covers the new marker-rendering code path; if not, add the same pattern used elsewhere in this repo's acceptance tests, asserting the collected error list is empty at the end of the run.

- [ ] **Step 10: Run the live acceptance suite**

  Run: `npm start &` then `npm run test:acceptance:clash-finder`
  Expected: PASS, including the new marker/witness assertions. **Use this run to also visually confirm and tune `MIN_MARKER_RADIUS`/`MAX_MARKER_RADIUS`/`MARKER_COLOR` (Task 8) against the real fixture** — per the spec, exact constants are an implementation-time decision; adjust the constants in `ClashFinderExtension.js` if the default values from Task 8 render markers imperceptibly small, room-sized, or visually indistinguishable from the Viewer's selection highlight, then re-run this suite to confirm.

- [ ] **Step 11: Commit**

  ```bash
  git add test/acceptance/clash-finder.acceptance.mjs wwwroot/extensions/ClashFinderExtension.js
  git commit -m "M2.1: live federated acceptance for witness markers, including enclosed-witness visibility"
  ```

**Tests introduced/updated:** `test/acceptance/clash-finder.acceptance.mjs` — witness presence, marker count/position, enclosed-witness visibility, negative-case marker clearing, alignment-driven marker movement, model-unload full clear, zero console errors.

**Completion criteria:** `npm run test:acceptance:clash-finder` passes end-to-end against the real dev server and real translated models, including a verified visual observation (not just object-presence) for the enclosed witness.

**Protected invariants:** Existing isolation/highlight acceptance behavior (already covered by this file) is unchanged and still passes.

**Viewer/API evidence needed before coding:** Task 7's findings; Step 1–2's discovery-spike results (recorded, not guessed).

---

## Task 11: README/CHANGELOG closeout

**Objective:** Document the shipped M2.1 surface without editing the existing M2 section in place.

**Files:**
- Modify: `collision/README.md`
- Modify: `CHANGELOG.md`

**Prerequisites:** Tasks 1–10 complete and passing.

**Implementation steps:**

- [ ] **Step 1: Update `collision/README.md`'s `ClashPair` shape documentation**

  In the section documenting `findClashes(query) -> Promise<{ pairs: ClashPair[], statistics: Statistics }>` (currently lines ~95-129), add the `witness` field to the documented `pairs` shape for `type: 'volume-overlap'`, matching exactly the public contract from Task 5 — copy the field description from the spec's §1, not from memory.

- [ ] **Step 2: Add a "Known M2.1 limitations" note**

  Alongside the existing "Known M2 limitations" section (lines ~457-488), add a parallel note: one marker per witness-bearing pair, no density cap, no interaction/tooltip/dashboard — matching spec §9.3/§9.4/§10 verbatim in spirit, not scope-expanding.

- [ ] **Step 3: Add a new `CHANGELOG.md` section**

  Following the exact subsection structure already used for `## v0.2.0 — Collision Library Milestone 2` (Capabilities / Compatibility notes / Live Viewer acceptance result / Known limitations), add a new `## v0.2.1 — Clash Witness Marker` section (or the version number appropriate at merge time) summarizing: additive `witness` field, deterministic aggregation, Viewer-native marker rendering, live acceptance result from Task 10.

- [ ] **Step 4: Commit**

  ```bash
  git add collision/README.md CHANGELOG.md
  git commit -m "M2.1 closeout: document the shipped witness/marker surface in README and CHANGELOG"
  ```

**Tests introduced/updated:** None (documentation only).

**Completion criteria:** `collision/README.md` and `CHANGELOG.md` accurately describe the shipped M2.1 surface with no invented claims.

**Protected invariants:** The existing M2 CHANGELOG section is not edited in place.

**Viewer/API evidence needed before coding:** None.

---

# Batch 3 checkpoint / M2.1 final review boundary

---

## Performance

No new performance-gate task is included, per the spec's §13 and the prompt's instruction that "no new broad performance gate is required unless implementation evidence shows a measurable regression." The additive cost is bounded by construction, not by a new benchmark:

- Witness capture (Tasks 1–2) is a single `.clone()` at a statement that already executes on every positive verdict — no new geometric search, no new BVH traversal.
- World-space transform (Task 3) is one `Vector3.applyMatrix4` per confirmed positive branch — only paid by fragment pairs that already confirm a hit.
- Aggregation (Task 5) replaces a `Map.has()` check with one `compareWitnessCandidates` call per fragment-pair hit — same asymptotic complexity as today's aggregation loop, since both are O(1) per candidate.
- Marker rendering (Task 8) allocates one `Mesh` per witness-bearing dbId-level pair (not per fragment pair), reusing one shared `SphereGeometry`/`MeshBasicMaterial` pair per extension instance.

Task 10's live acceptance run against the real three-model fixture is sufficient as the "small timing sanity check" the spec allows for — no dedicated `test/performance/*` gate file is added for M2.1. If Task 10 or `npm test` surfaces a measurable regression, add a targeted timing assertion at that point rather than pre-building speculative infrastructure now.

---

## Cross-task interface reconciliation

| Interface | Defined in | Exact shape | Consumed by |
|---|---|---|---|
| `properCrossingQuery(...)` return | Task 1 | `{ crossing, aborted, inconclusive, diagnostics, stats, witnessPoint? }` — `witnessPoint` is a `THREE.Vector3` (r185) present iff `crossing === true`, in `bvhA`'s local frame | Task 3 |
| `anyComponentInside(...)` return | Task 2 | `{ inside, decidingComponentClosed, decidingComponentIndex, diagnostics, unresolvedComponentCount, samplesUsed, budgetExhausted, witnessPoint?, witnessMethod? }` — `witnessPoint` is a `THREE.Vector3` (r185) present iff `inside === true`, in the container's (`targetBvh`'s) local frame; `witnessMethod` is `'vertex-sample' \| 'constructed-interior'`, internal-diagnostic only | Task 3 |
| `constructedInteriorWitness(...)` return | Task 2 | `{ inside, samplesUsed, budgetExhausted, witnessPoint? }` — additive `witnessPoint` when `inside: true`, container-local | Task 2's own `anyComponentInside` call site only |
| `volumeOverlapQuery(...)` return | Task 3 | `{ overlap, via?, diagnostics, stats, witness? }` — `witness` is `{ kind: 'surface-crossing' \| 'containment', point: [x,y,z] } \| null`, meaningful only when `overlap === true`; `point` is a plain array (no Three.js object) | Task 4 |
| `_runNarrowPhasePair(...)` return | Task 4 | `volume-overlap` mode: `{ hit: boolean, witness: {kind,point}\|null }`. `containment`/`surface-intersection`: bare `boolean` (unchanged). Early `buildOne` failures: bare `false` (unchanged) | Task 4's own aggregation-loop call site (the only production call site) |
| `normalizeNarrowPhaseHit(mode, result)` | Task 4 | `{ isHit: boolean, witness: {kind,point}\|null\|undefined }` — `witness` is `undefined` for non-volume-overlap modes | Task 5 |
| `compareWitnessCandidates(a, b)` | Task 5 | `(a, b) => number`, `a`/`b` shaped `{ witness, sourcePlaced, targetPlaced } \| undefined` — total order: valid-over-null, then `kind` (`surface-crossing` < `containment`), then `comparePlacedCanonically` tie-break | Task 5's own aggregation loop |
| `ClashPair.witness` (public) | Task 5 | `{ kind: 'surface-crossing' \| 'containment', point: [x,y,z] } \| null`, present only when `type === 'volume-overlap'` | `ClashFinderExtension` (Task 8), acceptance tests (Task 10), README (Task 11) |
| `statistics.diagnostics` entry, `reason: 'witness-unavailable'` | Task 5 | `{ scope: 'pair', reason: 'witness-unavailable', sourceFragment, targetFragment }` — same shape family as the existing `attach()` pair-scoped diagnostic | Task 5's own tests, Task 10's acceptance assertions (indirectly, via "no unexpected diagnostics on a positive result") |
| `ClashFinderExtension._activeMarkers` | Task 8 | `Array<THREE.Mesh>` (r71, `window.THREE`) — deliberately an array, not a `Set` like `_isolatedModels` | Task 9 (lifecycle), Task 10 (acceptance readback) |
| `ClashFinderExtension._ensureMarkerOverlay/_computeMarkerRadius/_addMarkers/_clearMarkers` | Task 8 | private methods, `_addMarkers(pairs, dbIdsByModel)` | Task 9 (wiring into `onContextMenu`, `_onBeforeModelUnload`, `unload()`) |

No naming or shape mismatch was found across tasks in this reconciliation pass.

---

## Proposed batches

- **Batch 1 — Geometry witness pipeline** (Tasks 1–6): leaf capture → composition transform → narrow-phase integration → deterministic aggregation → alignment fixture. Fully testable with `npm test`, no Viewer/browser dependency.
- **Batch 2 — Viewer marker** (Tasks 7–9): API evidence (already resolved) → marker rendering/resources → lifecycle. Testable with `npm test` against a mock Viewer; no live browser required until Batch 3.
- **Batch 3 — Acceptance / closeout** (Tasks 10–11): live federated marker acceptance → README/CHANGELOG. Requires `npm start` and a real Viewer session.

Review at the two batch checkpoints above, not per-task.

---

## Live marker acceptance criteria (summary — full detail in Task 10)

1. Known positive Hard Clash (`MIXED_CASE`) still returns the existing expected pairs.
2. Every returned positive `volume-overlap` pair has `witness !== null`.
3. A visible marker renders for each witness-bearing pair.
4. At least one marker is confirmed visible while enclosed inside opaque geometry (object presence in the overlay scene is not sufficient — a visual/pixel-level check is required).
5. Camera fit places the marker visibly within the clash region.
6. Known negative source (`NEGATIVE_CASE`) clears previous markers, creates none.
7. Model alignment + `invalidateModelPlacement` moves the marker to the newly-aligned location.
8. Unloading a participating model clears the entire clash visualization (isolation and markers, all models).
9. Zero console errors throughout.

---

## Final M2.1 completion criteria

- `npm test` (full collision-library suite) passes, including every new test from Tasks 1–6, 8–9.
- `npm run test:acceptance:clash-finder` passes, including every new assertion from Task 10.
- `ClashPair.witness` is additive, non-null for every complete well-formed positive `volume-overlap` fixture, and `null` only ever appears with exactly one accompanying `statistics.diagnostics` entry.
- `linear` and `tlas` broad phase produce identical witness kind and point (within tolerance) for equivalent inputs.
- `ClashFinderExtension.js` contains no `three` import and no reference to any r185 object; all marker objects are constructed from `window.THREE`.
- `collision/README.md` and `CHANGELOG.md` accurately reflect the shipped surface.
- No Hard Clash truth semantics, pair-dedup identity, or M1/M2 public API changed incompatibly.

## Verdict

**Ready for execution.** Every code claim this plan depends on has been independently re-verified against the current source (not copied from the spec), the one open Viewer-API evidence item the spec deferred has been resolved with sourced evidence (including one deliberate, evidence-justified deviation — the public `viewer.overlays.*` facade instead of the internal `viewer.impl.*` path — recorded in Task 7), and the one acceptance-fixture gap the spec didn't anticipate (no existing containment/enclosed-witness case in the Clash Finder fixture) is called out as an explicit discovery spike in Task 10 rather than papered over with an invented dbId.
