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
  - `npm test` runs the whole suite (`node --test`, no path argument -- Node 22's
    default discovery recurses into `test/` and matches every `*.test.mjs` file
    automatically; a literal directory argument like `node --test test/` does **not**
    recurse the way you would expect on this Node version -- verified empirically at
    Task 0 time. Use no argument, or an explicit glob, never a bare directory path.).
  - A single file: `node --test test/geometry/GeometryConnectivity.test.mjs`.
  - A directory subset via glob: `node --test 'test/query/**/*.test.mjs'`.
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

## Known risk: no MEP-scale test model in this repo (flagged per spec, not blocking)

The spec's Performance Gate (spec:4644-4805, closing statement at 4797-4805) requires
running one `volume-overlap` query against an MEP-scale model (fragment geometries in
the thousands of triangles) as part of this milestone's acceptance criteria, and
explicitly says: "if none available at implementation time, that is a finding to
report, not a step to skip silently."

**Searched at Task 0 time (2026-09-03): no MEP-scale model URN/fixture exists anywhere
in this repo.** `spike/FINDINGS.md` (finding B7) confirms the spike itself never
exercised one either -- its only real-model run used the residential acceptance model
(bathtub/room-locator fixture, rooms of 12-64 triangles each), and its own conclusion
states plainly: "the MEP-scale benchmark is therefore load-bearing, not optional
polish -- it is the only thing that will exercise the machinery this decision keeps."
No APS bucket/URN reference to an MEP-scale model appears in `docs/`, `spike/`, or any
committed config in this repo as of this task.

**This does not block Tasks 1-23** (per this plan's own sequencing) -- it blocks only
the Performance Gate (Task 24) and the milestone's final "measured, not reasoned"
sign-off on `maxSyncTriangleCount` and the other provisional constants in
`collision/constants.js`. Whoever picks up Task 24 needs to either source a suitable
MEP-scale model (a Revit MEP sample project through Model Derivative, or an
equivalently fragment-dense public sample) before that task can produce a real
measurement, or must report the gap explicitly per the spec's own instruction above
rather than substituting `measure.mjs`'s synthetic figures and calling the gate passed.
