# Tests

Convention for this repo's collision-detection library tests (established here, Task 0,
and binding for every later task in this plan):

- **Runner: Node's built-in `node:test` + `node:assert/strict`.** No new devDependency.
  Chosen over `spike/fixtures.mjs`'s hand-rolled `check(name, actual, expected)`
  PASS/FAIL harness because later tasks need async tests, mocked clocks, and spies
  (e.g. "assert compaction was invoked exactly once", "assert enumNodeChildren was
  called exactly maxChildrenPerNode+1 times") that a hand-rolled equality-only harness
  has no support for and would need to reinvent per file. `node:test`'s built-in
  `t.mock` gives every later task spies/stubs for free, with zero new dependencies.
- **File layout**: mirrors `collision/`'s own tree under `test/`, one `*.test.mjs` per
  source module (e.g. `collision/geometry/GeometryConnectivity.js` ->
  `test/geometry/GeometryConnectivity.test.mjs`). Shared cross-file test-only helpers
  (geometry builders, mocked lifecycle harnesses) belong under `test/fixtures/`.
- **Running tests**:
  - `npm test` runs the whole suite via `scripts/run-tests.mjs` (Batch-5 final review, finding I-1
    fix round 2): a bare `node --test` (no path argument) sweeps in every `.js`/`.mjs` file under
    ANY directory literally named `test`, not just this repo's own `*.test.mjs` convention -- that
    included, disastrously, live-browser/live-server scripts like `test/performance/run-gate.mjs`
    and `test/acceptance/room-locator.acceptance.mjs`, which `npm test` was launching for real as a
    side effect. A quoted shell-glob positional argument (`node --test '**/*.test.mjs'`) fixes the
    file-selection problem but isn't itself a safe long-term answer: glob-pattern positional
    arguments aren't part of this repo's own declared `engines.node` (`>=20`) minimum's documented
    `--test` CLI surface (confirmed against the Node 20.19.0 docs vs. current), and a single-quoted
    pattern isn't portable to Windows' `cmd.exe`. `scripts/run-tests.mjs` sidesteps both: it does
    its own recursive `fs.readdirSync` walk (an unchanged Node API well below the `>=20` floor) to
    find every `*.test.mjs` file, then spawns `node --test` with the fully-resolved, explicit file
    list -- a mechanism `--test` has supported since introduction, on every platform, with nothing
    left for a shell or a Node version to interpret differently.
    **Note:** `npm test` automatically runs `npm run build:vendor` first via a `pretest`
    hook (spec:1038-1076 prerequisite), so the vendor files are always populated when
    tests run.
  - A single file: `node --test test/geometry/GeometryConnectivity.test.mjs`.
  - A directory subset via glob: `node --test 'test/query/**/*.test.mjs'` (glob support for a
    manual, ad hoc invocation like this is fine -- the concern above is specifically about
    `package.json`'s own committed `test` script needing to work unattended across this repo's full
    declared engine/platform range).
- **Assertions**: `node:assert/strict`. Prefer `assert.equal`/`assert.deepEqual` for
  values, `assert.rejects(promise, { name: 'WorldDisposedError' })` for the
  lifecycle-error contract many later tasks need (matches `collision/errors.js`'s
  `.name` fields).
- **Regression comments**: when a test pins a specific round's finding, add a one-line
  comment directly above the assertion naming the round, matching `spike/fixtures.mjs`'s
  own style, e.g. `// ROUND 4 REGRESSION: ...`.

## Runtime isolation

`test/runtime/runtimeIsolation.test.mjs` automates everything about the runtime-isolation
acceptance check (spec:985-987) that does not require a live browser: the import map's
presence/ordering, and that every entry it declares resolves to a real vendored file.
The check's other half -- confirming `window.THREE.REVISION === '71'` is literally
unchanged before and after the collision runtime loads inside a real Viewer page -- is
a documented manual step (see that file's trailing comment block) rather than an
automated one. Reasons: it needs a real Viewer bundle + real DOM (no devDependency on a
browser automation tool was judged justified for this alone at Task 0, when the thing
the manual step would exercise -- `collision/index.js` -- does not exist yet); and once
later tasks add that module, the manual procedure documented here can be re-run against
the real thing without this file needing to change.

## Known risk (Task 0): no MEP-scale test model in this repo -- RESOLVED by Task 24

The spec's Performance Gate (spec:4644-4805, closing statement at 4797-4805) requires
running one `volume-overlap` query against an MEP-scale model (fragment geometries in
the thousands of triangles) as part of this milestone's acceptance criteria, and
explicitly says: "if none available at implementation time, that is a finding to
report, not a step to skip silently."

**Searched at Task 0 time (2026-09-03): no MEP-scale model URN/fixture existed anywhere
in this repo.** `spike/FINDINGS.md` (finding B7) confirms the spike itself never
exercised one either -- its only real-model run used the residential acceptance model
(bathtub/room-locator fixture, rooms of 12-64 triangles each), and its own conclusion
states plainly: "the MEP-scale benchmark is therefore load-bearing, not optional
polish -- it is the only thing that will exercise the machinery this decision keeps."
No APS bucket/URN reference to an MEP-scale model appeared in `docs/`, `spike/`, or any
committed config in this repo as of Task 0.

**Task 24 has since run the real performance gate** (`test/performance/run-gate.mjs`, invoked via
`npm run test:performance:gate`) against `A250-E-MB-CND-STR-03.ifc`, a real bucket model that
satisfies the spec's own literal scale bar (thousands of triangles/fragment, not dozens) even
though it is not itself an MEP-discipline model -- see
`docs/superpowers/specs/milestone-1-performance-gate-disposition.md` (the "Model used, and how
suitability was confirmed" section explains and justifies this substitution in full) for the
complete criterion-by-criterion write-up and verdicts, including the milestone's final
"measured, not reasoned" sign-off on `maxSyncTriangleCount` and the other provisional constants in
`collision/constants.js`. This is no longer an open risk for any future task.
