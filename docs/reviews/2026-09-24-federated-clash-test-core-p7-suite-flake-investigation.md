# P7 full-suite flake investigation (2026-09-24)

- Branch `feature/federated-clash-test-core-engine`, HEAD `fd93121`, clean tree. Node v22.23.1, darwin, 10 cores.
- Scope: the intermittent failures reported in `node scripts/run-tests.mjs` (2530 tests, 3 todo).
- Result: **both flakes are pre-existing and caused by the collision library (production-side). Nothing is fixed here.** Neither is a defect in a P7-owned test. No production code, spec, plan or handoff was changed.

## 1. Runs

### 1.1 Full suite, 12 sequential runs (`node scripts/run-tests.mjs > run-N.log 2>&1`)

| Run | Exit | Seconds | tests / pass / fail / todo |
| --- | --- | --- | --- |
| 1-12 (each) | 0 | 24-26 | 2530 / 2527 / 0 / 3 |

There were **0 failures in 12 runs** on this machine at idle. That fits a low per-run probability. Earlier agents saw 2 of 9 runs and 1 of 6 runs fail.

### 1.2 Stress: the two files concurrently under CPU load

The stress script ran one `node -e 'for(;;){}'` busy loop per core (10). In each iteration it ran 8 copies of `node --test test/clashtest/integration/differential.test.mjs` and 8 copies of `node --test test/query/ContainmentModeQuery.test.mjs` at the same time. There were 6 iterations, so 48 runs of each file.

| Iteration | differential file runs failing (of 8) | ContainmentModeQuery file runs failing (of 8) |
| --- | --- | --- |
| 1 | 0 | 5 |
| 2 | 1 | 7 |
| 3 | 0 | 7 |
| 4 | 0 | 6 |
| 5 | 0 | 6 |
| 6 | 3 | 7 |
| **Total** | **4 / 48 (8%)** | **38 / 48 (79%)** |

Failing tests, with verbatim messages:

- `differential.test.mjs:133` `differential: cross-model explicit, surface-intersection` failed 1 time. It asserts at `assertCleanFull` (`differential.test.mjs:105`):
  ```
  Expected values to be strictly equal:
  + 'caveated'
  - 'clean'
  ```
- `differential.test.mjs:256` `determinism: 10 runs on one world and 10 on fresh worlds agree (AC-6), surface-intersection` failed 3 times. The failure is at `:262`:
  ```
  identical digests, diagnostics accounting and unit taints
  2 !== 1
  ```
- `ContainmentModeQuery.test.mjs:8` `duct through beam, no vertex inside either (round 7 regression)` failed 38 times:
  ```
  duct through beam: contained
  expected: true
  actual: false
  ```
- `ContainmentModeQuery.test.mjs:18` `lone large triangle through room, all 3 corners outside (round 7 regression)` failed 4 times, with the same shape (`contained` expected true, actual false).

The only failing tests were surface-intersection arms and surface-crossing-witness containment cases. No other test failed under stress.

## 2. Root cause

Both flakes come from one cause. The library aborts a narrow-phase traversal on a **real wall-clock budget**: `frameBudgetMs = 8` (`collision/constants.js:42`), measured with `performance.now()`. The test's injected clock cannot reach that budget. Under parallel or CPU load, the OS can deschedule the process, or GC can pause it, for more than 8 ms in the middle of a traversal. The traversal then aborts. An aborted traversal is never read as a hit, so the verdict becomes negative or caveated.

### 2.1 Flake A: surface-intersection turns `caveated` in the real `CollisionWorld`

- `collision/CollisionWorld.js:2231` calls `surfaceIntersectionQuery(sourceRecord.bvh, targetRecord.bvh, relativeMatrix)` and passes **no `now`**. The world's injected `this._now` is not passed, even though the fixture sets it (`CollisionWorld.fromViewer(viewer, { now: () => 0 })`, `test/clashtest/support/realWorld.mjs`).
- `collision/query/SurfaceIntersectionQuery.js:31` falls back to `options.now ?? (() => performance.now())`. At callback entry, `:75` aborts when `now() - traversalStart > timeBudgetMs`. The abort sets `aborted`, and the query emits `crossing-budget-exhausted`.
- `CollisionWorld.js:2240` `attach(result.diagnostics)` surfaces that diagnostic as a pair diagnostic. `clashtest/execution/diagnostics.js:70` classes it as completeness-affecting, and `clashtest/results/resultSet.js:183` then sets `integrity: 'caveated'`. The pair is also dropped, so the determinism arm's digests and diagnostic accounting differ between runs.
- Only surface-intersection is exposed. `ProperCrossingQuery`, used by volume-overlap and clearance, made its clock telemetry-only in "Phase C" (`ProperCrossingQuery.js` around lines 88-110 and 180-195). The in-world containment path uses `createComposedStageScheduler(checkpoint, this._now)`, so it runs on the injected clock.
- **Deterministic reproduction** (a scratch probe, not committed): run the arm with `performance.now` replaced by a clock that advances 20 ms on every read. The four modes give:

  | Mode | integrity | results |
  | --- | --- | --- |
  | volume-overlap | clean | 2 |
  | clearance | clean | 1 |
  | containment | clean | 2 |
  | surface-intersection | **caveated** | **0** |

  The resulting diagnostics are `crossing-budget-exhausted` on pairs (a:100, b:100) and (a:200, b:100). With the real clock at idle, the same arm is `clean` with 2 results.

### 2.2 Flake B: `duct through beam` (and `lone large triangle`) gives `contained: false`

- `collision/query/ContainmentModeQuery.js:27-28`: with no injected scheduler, the default scheduler is `{ elapsedMs: () => performance.now() - t0 }`. It was added on purpose ("final whole-branch review, Finding 3") to make `frameBudgetMs` live for the witness.
- `collision/query/SurfaceCrossingWitness.js:80`: `timeExceeded = () => scheduler.elapsedMs() > timeBudgetMs` aborts the witness. The witness is the only way these two tests can reach `contained: true`, because no vertex is inside either shape.
- **Deterministic reproduction** (same stalled-clock probe): the result was `{contained:false, diagnostics:[{reason:'crossing-budget-exhausted'}], witnessTerm:{aborted:true, candidatePairsExamined:1}}`. With the real clock at idle: `{contained:true, via:'surface-crossing'}`.
- The test calls `containmentModeQuery(duct, beam)` without a scheduler, so it depends directly on real wall-clock time.

### 2.3 Pre-existing status

- `SurfaceIntersectionQuery.js` dates from `a4a8e87` and `1f38d2a` (2026-09-04). The `CollisionWorld.js` surface-intersection call site dates from `4b53396` (2026-09-04). `ContainmentModeQuery.js`'s wall-clock default scheduler dates from `1f38d2a` (2026-09-04). `SurfaceCrossingWitness.js` was last changed in `542c2b3` (2026-09-04).
- `git log 438a832..HEAD -- collision/` is empty, so no library code has changed since `438a832` or during P7. The P7 differential suite (`efefb08` onward) only **exposed** Flake A. It runs surface-intersection through the real world under the parallel runner.

## 3. Disposition

| Flake | Verdict | Owner (suggested) | Fixed here? |
| --- | --- | --- | --- |
| A: differential surface-intersection `caveated`, and the AC-6 determinism digest mismatch | PRODUCTION-side, pre-existing. `CollisionWorld.js:2231` does not pass the world's injected `now` to `surfaceIntersectionQuery`, and `SurfaceIntersectionQuery.js:75` still aborts on semantic wall-clock time. | Collision library owner. Candidate fixes: pass `now: this._now` at `CollisionWorld.js:2231`, and/or make its time trigger telemetry-only as in ProperCrossingQuery Phase C. The owner decides. | No |
| B: `duct through beam` and `lone large triangle` give `contained: false` | PRODUCTION/library-test, pre-existing. `ContainmentModeQuery.js:27-28` has a real-clock default scheduler, and `SurfaceCrossingWitness.js:80` aborts on it. The library test injects no scheduler. | Collision library owner. Candidate fixes: inject a frozen scheduler in these regression tests, or revisit the semantic wall-clock abort in the witness. The owner decides. | No |

Why there is no test-only fix in P7-owned files: the injected clock (`worldOptions.now`) never reaches `surfaceIntersectionQuery`. The only test-side lever is to patch the global `performance.now` inside the differential file. That would hide a real production nondeterminism, where a genuine touching pair is dropped under load. It was not applied, and it is left for the owner to decide.

Repro commands (from repo root):
- Load stress: 10 × `node -e 'for(;;){}' &`, then 8 × each of `node --test test/clashtest/integration/differential.test.mjs` and `node --test test/query/ContainmentModeQuery.test.mjs` concurrently. Measured probability per file run: A ≈ 8%, B ≈ 79%.
- Deterministic: replace `performance.now` with `() => (t += 20)` around one `engine.startRun` of the cross-model explicit surface-intersection definition, or around `containmentModeQuery(duct, beam)`.
