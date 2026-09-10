# three-mesh-bvh@0.9.14 correctness patch — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to
> implement this plan task-by-task. No worktree — this plan executes directly on the current branch
> `feature/m4-performance-worker-decision-design` (explicit operator instruction; do not create or
> switch to a worktree for this plan).

**Goal:** Fix two confirmed correctness defects in the pinned `three-mesh-bvh@0.9.14` dependency that
are blocking M4 Phase 3's canonical matrix run, via the smallest local dependency patch, carried
in-repo so a reinstall cannot silently revert it — and prove the fix with the mandatory regression
suite. This is a prerequisite dependency hotfix, not an M4 deliverable.

**Spec / sole design source of truth:**
`docs/research/m4-three-mesh-bvh-correctness-blocker-adjudication.md` (the "adjudication doc" below).
Every task in this plan implements one part of its Step 4 recommendation and mandatory regression
list. Read the adjudication doc's relevant section before starting any task — this plan gives the
exact values and file:line anchors that matter, but the adjudication doc has the full derivation,
evidence, and reasoning behind each one.

**Tech stack:** Node.js (`"type": "module"`), `node:test` + `node:assert/strict`, `three@0.185.1`,
pinned `three-mesh-bvh@0.9.14` (`node_modules/three-mesh-bvh`, mirrored to `wwwroot/vendor/` via
`scripts/sync-vendor.mjs` on `prestart`/`pretest`), npm 12.0.2 / node v22.23.1 in this environment
(`npm patch --help` confirmed working here).

## Pre-execution rulings (from a `codex-advisor medium` plan review, request
`20260910-205753-29781-4103`, run before any task was dispatched)

The review confirmed the 4-task decomposition and the exact patch content (Global Constraint 4) match
the adjudication doc, but found five real gaps, all fixed below rather than left for an implementer to
improvise:

1. **Delivery mechanism changed: `patch-package`, not native `npm patch`.** Verified independently
   (`npm root -g`'s own installed `npm` package.json: `"engines": { "node": "^22.22.2 || ^24.15.0 ||
   >=26.0.0" }`) — native `npm patch`/`patchedDependencies` first shipped in npm 12, and npm 12 itself
   requires Node ≥22.22.2, which conflicts with this repo's existing `"node": ">=20"` promise. This
   repo also has no `.npmrc` (confirmed: file doesn't exist), so `engine-strict` is off and an
   `engines.npm` pin would be advisory only, not enforced — exactly the silent-revert failure mode the
   adjudication doc's whole "Delivery mechanism" section warns against. **Ruling:** use the
   adjudication's own designated fallback, `patch-package` + `"postinstall": "patch-package
   --error-on-fail"`, which needs no Node/npm floor change and was already the adjudication's chosen
   mechanism "if npm cannot be standardised." Bumping the Node floor is a project-wide compatibility
   decision out of proportion to a two-line dependency fix (Global Constraint 5) and is not something
   to decide unilaterally inside this plan. Task 3 below is rewritten accordingly. *Cost if wrong:* if
   `patch-package`'s lifecycle-script failure modes (Global Constraint 5 / adjudication §"Delivery
   mechanism" named list — `--ignore-scripts`, `--omit=dev`, direct `node` invocation) ever bite, the
   fix is to add native `npm patch` later as a second layer once the Node floor is deliberately
   raised — not a rewrite.
2. **Task 1's fixtures were under-specified enough to risk producing tests that can't turn GREEN even
   after a correct patch** — fixed inline in Task 1 below: the OBB-matrix construction method, the
   exact predecessor sequence for the order-independence test, Defect-3 contamination in the 5000-case
   sweep, and the finite-threshold test's missing concrete geometry.
3. **Task 3's integrity guard had three latent bugs** — fixed inline in Task 3 below: no importing a
   `*.test.mjs` file's logic into another test (duplicate `node:test` registration risk), no calling
   `sync-vendor.mjs` from inside a concurrently-running test (it recursively deletes/recopies a tracked
   directory), and the "clean install" proof must be a real `npm ci` in an isolated scratch copy, not
   lockfile/artifact inspection alone.
4. **Task 4's fixed "1012 tests / 1011 pass / 1 todo" expectation is already stale** the moment Task 1
   and Task 3 add new tests. Fixed inline in Task 4: measure the new total after those tasks land,
   and separately confirm the pre-existing subset has no *new* failures beyond the named flake.
5. **Live infrastructure (dev server, APS credentials, Playwright, the three fixed URNs) is a
   controller responsibility, not an implementer one.** Added as Global Constraint 12: before
   dispatching Task 2 or Task 4, the controller preflights server/credential/browser reachability
   itself and classifies any live-infra failure separately from a regression finding.

## Global Constraints (binding on every task)

1. **Scope.** This is NOT M4 Phase 4. Do not continue the M4 decision checkpoint. Do not change M4
   verdict semantics. Do not relax §6.4 (the TLAS-vs-linear correctness comparator) — it is the
   mechanism that caught these defects and must stay exactly as strict as written.
2. **Only two defects get fixed.** Defect 1 (stale module-global `obb2` on the root-is-leaf
   `closestPointToGeometry*` path) and Defect 2 (`OrientedBox.distanceToBox`'s `max[f2]`/`max[f3]`
   typo). The independently-observed Defect 3 (`OrientedBox.intersectsBox`'s incomplete 6-of-15-axis
   SAT, adjudication doc §2.3) is explicitly OUT OF SCOPE — it is safe-direction (under-estimate
   only, cannot false-prune) and must not be touched. Record it as a known follow-up only, in the
   provenance doc Task 2 writes — do not modify `OrientedBox.prototype.intersectsBox`.
3. **No upgrade.** Retain `"three-mesh-bvh": "0.9.14"` exactly as pinned in `package.json`. Do not
   bump to `0.9.15` (it fixes neither defect — see adjudication §1.3).
4. **Patch content is fixed, not up for reinterpretation:**
   - **Patch 1** (Defect 1) — in ALL THREE of `src/core/cast/closestPointToGeometry_indirect.generated.js`,
     `src/core/cast/closestPointToGeometry.generated.js`, and
     `src/core/cast/closestPointToGeometry.template.js`: change the OUTER shapecast's
     `intersectsRange: ( offset, count ) => {` (confirmed today at line 94 in both `.generated.js`
     files, line 90 in the template) to
     `intersectsRange: ( offset, count, contained, depth, nodeIndex, box ) => {`, and add as the
     first three statements of that function's body:
     ```js
     obb2.min.copy( box.min );
     obb2.max.copy( box.max );
     obb2.needsUpdate = true;
     ```
     Do NOT touch the nested `otherBvh.shapecast(...)`'s own `intersectsRange` a few lines below
     (confirmed today at line 114 in the `.generated.js` files) — that one is unrelated and already
     correct. Do NOT use the alternative `getBoundingBox`-seeding variant (1a) — it is conservative
     rather than exact for multi-root BVHs and allocates per call; the `intersectsRange`-box variant
     (1b, above) is the one this plan adopts, per adjudication §2.4's recommendation.
   - **Patch 2** (Defect 2) — in `src/math/OrientedBox.js`, inside `distanceToBox`'s AABB
     edge-segment construction (confirmed today at lines 420 and 424): change
     `start[ f3 ] = i2 ? min[ f3 ] : max[ f2 ];` → `start[ f3 ] = i2 ? min[ f3 ] : max[ f3 ];` and
     `end[ f3 ] = i2 ? min[ f3 ] : max[ f2 ];` → `end[ f3 ] = i2 ? min[ f3 ] : max[ f3 ];`. Leave the
     `start[ f2 ]` / `end[ f2 ]` lines immediately above each of those alone — they are already
     correct.
5. **Reproducibility.** The patch must survive `npm ci` / `npm install` / `npm update` without manual
   reapplication, and both the Node/test copy (`node_modules/three-mesh-bvh`) and the browser/vendor
   copy (`wwwroot/vendor/three-mesh-bvh`, produced by `scripts/sync-vendor.mjs`) must carry the
   identical correction. No ephemeral hand-edit. No large dependency-management framework for a
   two-line fix.
6. **RED → GREEN discipline.** Every regression test must be shown failing against the *unpatched*
   dependency before the patch exists, then passing after. Do not manufacture a failing state by
   editing unrelated production code (`collision/`) — the fixtures must be built so the *library
   defect itself* is what fails the assertion.
7. **`collision/` stays untouched by this plan.** These are dependency-only defects; no file under
   `collision/` should need to change to fix them (`ClearanceQuery.js`'s contract with
   `closestPointToGeometry` is unaffected — see adjudication §"API compatibility").
8. **Existing flaky test policy.** `test/query/ContainmentModeQuery.test.mjs`'s "duct through beam, no
   vertex inside either (round 7 regression)" wall-clock-budget flake (and occasionally "a proven
   crossing overlap is conclusive:true") is pre-existing, already characterized in the adjudication
   doc's Step 4 mandatory test 5 baseline table (measured 2026-09-10, four consecutive pre-patch full
   runs). It is NOT a blocker for this plan if it is the only failure. Do not weaken or delete that
   test. Do not use "full suite happened to be green once" as sole proof — cite the existing baseline
   table and, if the flake recurs post-patch, confirm standalone-pass + cite that it's the same named
   test/budget mechanism, per adjudication §Step 4 test 5.
9. **Never make M1/M2/M3 gate scripts unrelated to this fix.** `git diff` must show zero changes to
   `test/performance/run-gate.mjs`, `run-gate-m2.mjs`, `run-gate-m3.mjs`.
10. **Live-fixture scripts are not `*.test.mjs`.** `scripts/run-tests.mjs` recursively picks up every
    `*.test.mjs` file in the repo and runs it as part of plain `npm test`, which must keep working
    without a running dev server or APS credentials. Any new script that needs the live dev server +
    Playwright + real APS models (Task 2's live regression) must NOT be named `*.test.mjs` — follow
    the existing convention of `test/performance/run-gate*.mjs` (invoked directly via `node
    test/performance/...` or an `npm run test:performance:gate:*`-style script), not the `node --test`
    suite.
11. **Dev server for live work.** The M4 gate scripts (`test/performance/run-gate-m4.mjs`) expect a
    dev server already running on `PORT` (default 8080, `npm start`) and real APS credentials in
    `.env`; they launch their own Playwright `chromium` against it. Task 2 and Task 4's live-fixture
    work need the same: start the dev server first (`npm start`, backgrounded), confirm it's up, then
    run the live script/gate against it.
12. **Live infrastructure is controller-owned.** Before dispatching Task 2 or Task 4, the controller
    (not the implementer subagent) confirms: the dev server is reachable on `PORT`, `.env` has valid
    APS credentials, Playwright's Chromium is installed, and the three fixed URNs
    (`ARCH_URN`/`STRUCTURE_URN`/`MECHANICAL_URN` in `run-gate-m4.mjs`) resolve. The dispatch tells the
    implementer this was preflighted and gives it a one-line health check to re-confirm before relying
    on it. If live infrastructure is down or credentials are invalid, that is a **live-infrastructure
    failure**, reported and fixed (or escalated) separately from a regression finding — it must never
    be conflated with "the patch doesn't work."

## Task 1 — RED: unit-level regression tests for Defects 1 and 2 (pure Node, no dev server)

Write the following as new `node:test` files (pick file names/locations that follow this repo's
existing granular per-concern convention — e.g. a new `test/vendor/` directory for tests that exercise
the vendored `three-mesh-bvh` library directly rather than `collision/`'s wrapper around it — and
explain the placement choice in your report). Do NOT modify `node_modules/` or
`wwwroot/vendor/three-mesh-bvh` in this task. Run every new test against the tree exactly as it
stands today (unpatched `0.9.14`) and record the actual failing output in your report — this is the
RED half of RED→GREEN; Task 3 is the GREEN half.

Read `docs/research/m4-three-mesh-bvh-correctness-blocker-adjudication.md` §2.1, §2.2, and the
"Mandatory regression tests" list (tests 1, 2, 8, 9) before writing these — it has the full derivation
for every value below, plus a documented pitfall to avoid (see test 2's note).

Also create a companion **non-test** helper module in the same directory (e.g.
`three-mesh-bvh-defects.fixtures.mjs`) exporting the pure fixture-builders and assertion helpers each
test below needs (the 2-triangle quad anchor builder, the 72-triangle grid builder, the independent
OBB/AABB exact-distance reference from test 2(b), etc.) as plain functions — not wrapped in `test(...)`
blocks. Task 3's clean-install integrity guard will import these same helpers directly; a `node:test`
file must never import another `*.test.mjs` file's contents (risks re-registering the same `test()`
cases twice under `node --test`).

1. **Root-is-leaf `closestPointToGeometry` order-independence** (adjudication mandatory test 1).
   - Build a 2-triangle quad anchor geometry, `new MeshBVH(anchorGeometry, { indirect: true })`.
     Assert its root is a single leaf node (`bvh._roots[0].byteLength === 32`, and the `IS_LEAF` flag
     — `uint16[15] === 0xFFFF` — set on that root, per adjudication §2.1's BVH-shape table).
   - Build a 72-triangle grid "far" operand, parallel to the anchor at `z = 0.05`, with its own
     `boundsTree` (so the nested accelerated path is taken). Ground truth distance: `0.05` (dense
     barycentric sampling, or trust the brute-force value the adjudication doc already established:
     `0.05000000074505806`).
   - Build a "distant" perturber: the same far-operand geometry translated ~1000 units away, with a
     multi-node anchor BVH (so `intersectsBounds` runs normally and this call is itself correct).
   - **Explicit predecessor-before-every-measured-call sequence** (not "interleave before calls 2 and
     4" — a `codex-advisor` review flagged that wording as ambiguous enough to leave stale state
     bleeding into an unintended call). Run exactly this eight-call sequence and record all four
     *measured* results:
     1. warm-up: `closestPointToGeometry(anchor, far, ...)` once, discard the result (this is the
        "near" predecessor for call 2).
     2. **measured call A** — `closestPointToGeometry(anchor, far, ...)`, immediately preceded by
        nothing else since the warm-up.
     3. predecessor: `closestPointToGeometry(distantAnchor, distantFar, ...)` (the distant perturber
        pair, multi-node anchor).
     4. **measured call B** — `closestPointToGeometry(anchor, far, ...)`, immediately preceded by
        step 3.
     5. predecessor: repeat the near warm-up pair (step 1's call) once more.
     6. **measured call C** — `closestPointToGeometry(anchor, far, ...)`, immediately preceded by
        step 5.
     7. predecessor: repeat the distant pair (step 3's call) once more.
     8. **measured call D** — `closestPointToGeometry(anchor, far, ...)`, immediately preceded by
        step 7.
   - **Assert all four measured calls (A, B, C, D) return the same value, `0.05000000074505806`.**
     On the unpatched dependency this must reproduce `[0.05, null, 0.05, null]` for A/B/C/D (run it,
     confirm, record the actual per-call output in your report).
   - Include the multi-node control from the adjudication doc: repeat the same experiment with a
     multi-node anchor (NOT root-is-leaf) and assert it is stable across all four measured calls, both
     before and after Task 3's patch — this is what proves the test isn't passing by accident.

2. **Exact-distance reference regression for `OrientedBox.distanceToBox`** (adjudication mandatory
   test 2). Three parts:
   - **(a) Named worst-case tuple.** OBB local `min [-0.3804163099641057, -0.9479515318050755,
     -2.03228256792402]`, `max [0.4589844705345968, 1.8687230714451164, 0.7140377524374228]`. OBB
     matrix — the 16-element array below is in `Matrix4.elements`/`fromArray` **column-major** storage
     order (confirmed: the translation components sit at indices 12-14). **Construct it with `new
     THREE.Matrix4().fromArray(values)`, NOT `.set(...)`** (`Matrix4.prototype.set` takes its sixteen
     arguments in row-major order and would silently build a different matrix from this same array):
     `[0.00430200927020449, 0.008173964532454317, -0.9999573386000331, 0, -0.5471904444278781,
     0.8369961037130074, 0.004487749554735238, 0, 0.836997078993147, 0.5471477941772834,
     0.008073480282549787, 0, -1.07325792176335, 4.013246063149184, 0.5037035963049643, 1]`, AABB
     `[0,0,0] .. [1.334708213962013, 3.561825842858211, 1.3125964404608106]`. **Assert
     `distanceToBox` returns `0.015450309808991687`**, not the unpatched value
     `0.045563153441575466`.
   - **(b) Independent-reference sweep**, at least 5000 deterministic pseudo-random disjoint
     OBB/AABB pairs with **non-cubic** AABBs. Write an in-test independent exact reference —
     vertex-vs-body plus all 12×12 edge-edge candidates — enumerating **box edges in local index
     space** (pairs of corner indices differing in one bit), transforming only after enumeration.
     **Do NOT test edge candidates by float-equality on already-transformed corners** — the
     adjudication doc's provenance section records that this exact mistake silently discarded every
     edge-edge candidate in an earlier pass and produced a false "0 over-estimates" result; a
     dense-sampling upper bound is what caught it there, so include one here too as a second check.
     **Defect-3 contamination guard (new — a `codex-advisor` review caught this):** the vendored
     `OrientedBox.prototype.intersectsBox` (out of scope, Global Constraint 2) has its own,
     independent, incomplete-SAT defect that makes `distanceToBox` early-return `0` for some
     genuinely-disjoint pairs — unrelated to the `max[f2]`/`max[f3]` typo this test targets. Before
     asserting on a sampled pair, check `obb.intersectsBox(aabb) === false` (i.e. the pair the
     library itself considers disjoint); **skip or separately count pairs where the shipped
     `distanceToBox` result is `0`** rather than asserting on them, so this test measures only
     Defect 2 and cannot fail on Defect 3's already-adjudicated, out-of-scope behavior. Log the
     skipped count in the test output for visibility.
     **Assert zero over-estimates** against the reference on every non-skipped pair. Also assert the
     returned `target1`/`target2` witness points lie on their respective boxes and realize the
     reported distance, again only for non-skipped pairs. Include zero-thickness AABBs (degenerate
     BVH node bounds are common for planar fragments) among the sampled pairs.
   - **(c) Axis-permutation controls.** A rectangular-AABB case per axis permutation (the typo's
     effect depends on which axis lands in the `f2`/`f3` role), plus a cube-AABB control
     (`max.x===max.y===max.z`, where the typo is a literal no-op) asserting zero changes there.

3. **Multi-root fixture, two widely-separated root-leaf groups** (adjudication mandatory test 8). A
   geometry with two groups, each ≤ 10 triangles (default `targetLeafSize`) and far apart, so
   `bvh._roots.length === 2` and **both** roots are leaves. Assert `closestPointToGeometry` returns
   the exact brute-force minimum under the same perturbed-predecessor sequence as test 1.
   **Note (from the `codex-advisor` review, correcting the adjudication's framing):** the *return
   value* of this test cannot by itself distinguish the adopted `intersectsRange`-box patch (1b) from
   the rejected `getBoundingBox` union-seed variant (1a) — both are correctness-safe and can produce
   the same minimum on this fixture. Its real job is to prove the *adopted* patch doesn't regress a
   multi-root BVH (a case 1a is measurably more permissive on, per the adjudication). To actually
   pin down *which* variant is in the tree, Task 3's implementer must additionally verify by
   inspecting the applied patch's content directly (the patch file/diff must show the
   `intersectsRange` signature change and `obb2.min/max.copy(box.min/max)` seeding — not a
   `getBoundingBox` call) — record that check in Task 3's report, not this test.

4. **Finite-`maxThreshold` Defect 2 case** (adjudication mandatory test 9). The adjudication's
   abstract OBB/AABB tuple from test 2(a) is a `distanceToBox` node-pruning score, not a full
   `closestPointToGeometry` scenario — a `codex-advisor` review flagged that reusing it directly is
   under-specified (no concrete triangle geometry/transforms). Instead, **derive a concrete triangle
   fixture using the same randomized-search methodology the adjudication doc's own end-to-end proof
   used (§2.2(b))**: build a multi-node anchor mesh and a multi-node far mesh (so Defect 1 stays out
   of play), run many random rigid-transform placements of the far mesh at deterministic pseudo-random
   seeds, and for each compute (i) the true minimum distance via brute-force triangle-pair sampling
   (no BVH) and (ii) the unpatched `closestPointToGeometry` result with `maxThreshold = Infinity`.
   Keep any sample where the unpatched result differs from the true minimum in the *over-estimating*
   direction (a false-prune signature) by a margin at least 10× the assertion tolerance. From that
   sample's true distance `d`, pick `maxThreshold` just above `d` (e.g. `d * 1.05`) so the true
   answer is within threshold but the unpatched over-estimate exceeds it. Freeze that one fixture
   (fixed seed, fixed transform) as the committed test. **Assert** a non-`null` result equal to the
   true minimum after the patch; **on the unpatched dependency this must currently return `null`**
   (false prune) — confirm and record the actual unpatched output in your report before moving on.

**Report:** commit only these new test file(s) plus the non-test fixture/helper module. State DONE
(tests exist, RED confirmed and recorded with actual output for every test, including per-call output
for test 1 and the skipped-pair count for test 2(b)) — do not proceed to patch anything.
Test command: `node --test <your new file(s)>`.

## Task 2 — RED: live-fixture regression script for the real `structure:2761 → structure:3980` case

Read adjudication doc §2's live evidence and
`.superpowers/sdd/2026-09-09-collision-library-milestone4-performance-worker-decision-implementation/s2-clearance-divergence-investigation.md`
Part 2 (the exact numbers below come from there, re-confirmed in the adjudication doc, both dated
today).

Write a new script (NOT `*.test.mjs` — see Global Constraint 10), e.g.
`test/performance/m4/structure-fragment-clearance-regression.mjs`, modeled on
`test/performance/run-gate-m4.mjs`'s own page-launch/model-load machinery (same URNs — `ARCH_URN`,
`STRUCTURE_URN`, `MECHANICAL_URN` constants at the top of that file — same `PORT` convention). It
should:

- Start (or expect already-running, per Global Constraint 11) the dev server on `PORT` (default
  8080), launch Playwright `chromium`, load the same real federated Audubon package the M1-M4 gates
  use.
- Call `CollisionWorld.findClashes({ mode: 'clearance', clearance: 0.05, source: { model:
  structureModel, dbIds: [2761] }, target: <all loaded models>, groupBy: 'dbId' })` under **both**
  `broadPhase: 'tlas'` and `broadPhase: 'linear'`, each in its own fresh `CollisionWorld` (mirroring
  the M4 gate's per-tuple fresh-world discipline).
- **Assert** the pair `structure:2761 → structure:3980` reports `distance ===
  0.026129089841138233` under **both** arms. On the unpatched dependency, the TLAS arm currently
  reports `0.03193299065509384` instead — run it, confirm this reproduces, and record the actual
  output in your report (this is the RED half).
- **Assert** fragment pair `358 ↔ 461` produces a `clearance-distance-query` diagnostic event with
  outcome `hit` (not `beyond-threshold`) in both arms — use `CollisionWorld`'s existing
  `setDiagnosticEventRecorder` hook (already used elsewhere in the M4 harness/investigation) to
  observe this.

**Report:** commit only this new script. State DONE (RED confirmed and recorded with actual output).
Do not touch `node_modules` or apply any patch in this task.

## Task 3 — GREEN: apply the dependency patch, wire durable delivery, prove Tasks 1 & 2 now pass, add the clean-install integrity guard

This task does the actual fix. Read adjudication doc Step 4 (the recommendation) and the "Delivery
mechanism" subsection of Step 3/Option B in full before starting.

**Delivery mechanism ruling (overrides the adjudication doc's stated preference-order — see
"Pre-execution rulings" above): use `patch-package`, the adjudication's own designated fallback, NOT
native `npm patch`.** Verified before this plan was finalized: native `npm patch` requires npm 12,
and npm 12 itself requires Node ≥22.22.2, which would silently break this repo's `"node": ">=20"`
promise (no `.npmrc`/`engine-strict` exists to make an `engines.npm` pin binding, so it would only be
advisory). Raising the Node floor is a project-wide decision out of scope for this plan.

1. **Add `patch-package` as a devDependency**: `npm install --save-dev patch-package`.
2. **Apply Patch 1 and Patch 2** exactly as specified in Global Constraint 4, directly in
   `node_modules/three-mesh-bvh/src/...` (all four files), then run `npx patch-package
   three-mesh-bvh`. Confirm this produces `patches/three-mesh-bvh+0.9.14.patch` (patch-package's `+`
   naming convention — this matches the adjudication doc's own stated filename).
3. **Wire reapplication**: add `"postinstall": "patch-package --error-on-fail"` to `package.json`'s
   `scripts`. The `--error-on-fail` flag is mandatory — the adjudication doc notes `patch-package`
   otherwise exits 0 after a failed local application, which would silently ship an unpatched
   dependency. Do not touch `package.json`'s `engines` field.
4. **Run `node scripts/sync-vendor.mjs`** (or `npm run build:vendor`) so the patched source is
   copied into `wwwroot/vendor/three-mesh-bvh/src/`. Confirm the patched lines are present in both
   copies.
5. **Confirm GREEN.** Re-run Task 1's unit tests and Task 2's live script (dev server must be up for
   the latter — see Global Constraint 11/12) and confirm all now pass with the corrected values.
   Record actual output in your report.
6. **Regression test 7 — clean-install patch-integrity guard** (adjudication mandatory test 7,
   Step 4 point 6 of Option B's "mitigation for every residual failure mode"). Add a new
   `node:test` (this one MAY be `*.test.mjs`, since it should run as part of plain `npm test`) that
   asserts, WITHOUT running `npm ci` itself and WITHOUT invoking `sync-vendor.mjs` itself (a
   `codex-advisor` review flagged both: importing another `*.test.mjs` file's logic risks duplicate
   `node:test` registration, and calling `sync-vendor.mjs` from inside a test that may run
   concurrently with others is unsafe — it recursively deletes and recopies a tracked directory).
   Instead:
   - (a) the resolved `three-mesh-bvh` version **and** a patch-identity marker (e.g. grep
     `node_modules/three-mesh-bvh/src/math/OrientedBox.js` for the corrected `max[ f3 ]` text on both
     assignment lines) both match what `patches/three-mesh-bvh+0.9.14.patch` declares;
   - (b) import the **pure fixture/helper module** Task 1 created (not the `*.test.mjs` file itself)
     and re-run its order-independence and exact-value assertions inline in this test — both fail on
     an unpatched tree, so this gives a *behavioral* guard, not merely a textual one;
   - (c) the patched files under `node_modules/three-mesh-bvh/src/` and their copies under
     `wwwroot/vendor/three-mesh-bvh/src/` are byte-identical — assume `sync-vendor.mjs` has already
     run (it's `pretest`'s job, and `npm test` always runs `pretest` first per `package.json`); this
     assertion only needs to *read and compare*, never invoke sync itself.
   Additionally, as a **one-time manual verification** (not part of the committed test — a
   `codex-advisor` review specifically requires this be a real install, not artifact/lockfile
   inspection): copy `package.json`, the lockfile, and `patches/` into an isolated scratch directory
   (this session's scratchpad, never the repo itself), run an actual clean `npm ci` there, and confirm
   the patched files are present and the corrected assertions pass against that scratch
   `node_modules`. Report the exact commands and output.
7. **Provenance doc.** Add a short, focused note (do not build a framework) recording: what was
   patched, why (link to the adjudication doc), the exact delivery mechanism and how it's reapplied
   on install, and the out-of-scope Defect 3 follow-up (Global Constraint 2) — a few paragraphs,
   e.g. appended to the adjudication doc itself under a new "## Remediation landed" section, or a new
   short `docs/research/m4-three-mesh-bvh-patch-provenance.md` — your choice, state which in your
   report. Also record here (per adjudication Step 4 point 4) that the pinned build must now be
   identified as `three-mesh-bvh@0.9.14 + <patch identity>`, not version alone, wherever M4 records
   provenance — this plan does not itself need to change M4 harness code to add that field (out of
   scope, Global Constraint 1), just document the requirement for whoever next touches §6.4's
   provenance recording.

**Report:** commit the patch artifacts (`patches/` or equivalent), `package.json`/lockfile changes,
the sync'd vendor tree, the new integrity-guard test, and the provenance doc, as one or more commits.
State DONE with full before/after evidence for Tasks 1, 2, and this task's own test 7.

## Task 4 — Full regression validation: S2 k=100 parity, M1/M2/M3 gates unchanged, full suite + flake baseline

Read adjudication doc Step 4 mandatory tests 4, 5, 6 before starting.

**Live infrastructure note:** every sub-item below launches its own live Playwright browser against
the dev server (not just the S2 parity run) — confirm the controller's Global Constraint 12 preflight
is still valid (server up, credentials good) before starting this task; if it lapses mid-task, treat
it as a live-infrastructure issue, not a regression finding.

1. **Regression test 4 — TLAS-vs-linear §6.4 parity on the previously failing S2 tuple.** With the
   dev server up, run `node test/performance/run-gate-m4.mjs --cases=S2 --runtimes=multi-process
   --repetitions=1`. Note: `--cases=S2` runs the *entire* S2 cohort (all configured `k` levels — 10,
   50, 100, 183 — not only `k=100`); the tuple this test cares about is specifically
   `S2[k=100:typical:clearance]` within that run. **Assert that specific tuple reaches `parity
   cold:MATCH warm:MATCH`** with `distanceDiffCount: 0` and `witnessDiffCount: 0` in the
   `structure|structure` partition, and record the other S2 levels' results too (they should already
   have been passing pre-patch — note if any of them regress, which would itself be a finding). (Pre-
   patch baseline for k=100, already established today in the adjudication doc and the prior
   investigation: `distanceDiffCount: 1`, `witnessDiffCount: 1`, `maxDistanceDelta
   0.0058039008139556085`, `maxWitnessDelta 0.2223360227743285` — cite this as the RED evidence; you
   do not need to re-run against an unpatched tree to reproduce it, since Task 3 already landed the
   patch, but do confirm the command/flags match exactly what produced that baseline.) **Do not relax
   §6.4 to make this pass** — if it doesn't reach MATCH, that is a real finding to report, not
   something to work around.
2. **Regression test 6 — M1/M2/M3 gates unchanged and passing.** `git diff` (against this plan's
   starting commit) must show **zero** changes to `test/performance/run-gate.mjs`,
   `test/performance/run-gate-m2.mjs`, `test/performance/run-gate-m3.mjs`. Run all three
   (`npm run test:performance:gate`, `:m2`, `:m3`) — these are also live, dev-server-backed runs —
   and confirm they pass. `run-gate-m3.mjs`'s existing max-distance-delta-of-exactly-0 measurement
   over shared keys is the specific check that the patch did not perturb agreement between paths —
   call this out explicitly in your report.
3. **Regression test 5 — full suite.** First, run `npm test` once and record the actual total test
   count, pass/fail/todo breakdown, and exit code — this is your new baseline total, since Tasks 1
   and 3 added tests beyond the adjudication doc's pre-patch count of 1012. Do not assume a fixed
   number; measure it. Then run `npm test` a **second** time (matching the adjudication's pre-patch
   multi-run baseline methodology, scaled down since the pre-existing subset is already
   well-characterized in the adjudication doc). For each of the two runs, record pass/fail/todo counts
   and exit code, and confirm: (i) the newly-added tests from Tasks 1 and 3 pass in both runs with no
   exceptions, and (ii) the pre-existing ~1012-test subset shows no new failures beyond the named
   flake below. Compare any failures against the pre-existing baseline table in the adjudication doc
   (Step 4 mandatory test 5): `test/query/ContainmentModeQuery.test.mjs` "duct through beam, no
   vertex inside either (round 7 regression)" and, occasionally, "a proven crossing overlap is
   conclusive:true" — both go through `ProperCrossingQuery`'s wall-clock crossing budget, the one
   legitimately non-deterministic source §6.4 itself names.
   - If a run fails **only** on one or both of those two named tests: confirm each fails test passes
     standalone (`node --test test/query/ContainmentModeQuery.test.mjs`, isolating the specific
     test name), cite the adjudication doc's baseline table as the pre-existing reproduction on the
     pre-patch BASE, and record this run as a pass-with-known-flake — **do not** treat it as a patch
     regression.
   - If any *other* test fails, or fails in a new way, treat it as a genuine finding: for each such
     assertion, determine whether it was encoding a now-corrected defective distance value (in which
     case updating that one assertion to the corrected value is legitimate and must be justified
     explicitly in your report, per adjudication §"M1–M3 behaviour and tests") or whether it's a
     real regression from the patch (in which case do NOT paper over it — report it as a blocking
     finding and stop; do not silently edit `collision/` to route around it).
   - **No assertion may be edited "to make the suite green" without that explicit justification
     recorded in your report.**

**Report:** no new commits are strictly required if everything passes clean (this task is validation,
not code change) — but if you do add/adjust anything (e.g. a genuinely-justified assertion update per
above), commit it separately with a clear message and full justification in the commit body. State
DONE with the full evidence table (test 4's parity numbers, test 6's pass confirmation, test 5's
two-run pass/fail/todo/exit-code table with flake disposition).

---

After Task 4's task review and the final whole-branch review are both clean (or findings are parked
with rulings per the SDD skill's breaker process), the controller (not a subagent) performs the
**Post-fix M4 validation** the operator separately requested — re-running the exact direct
reproductions, the S2 k=100 parity case, and (only if those are green) the complete Phase 3 canonical
matrix via the existing pre-registered protocol — and reports at the M4 decision checkpoint. **Do not
start Phase 4 or any Phase 4 spike as part of this plan.**
