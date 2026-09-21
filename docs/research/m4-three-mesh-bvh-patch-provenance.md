# three-mesh-bvh@0.9.14 correctness patch — provenance

Written for a future maintainer who has never seen this investigation. This document is
self-contained: it does not depend on any file under the gitignored `.superpowers/` directory
(`.gitignore:294`) existing — everything a fresh clone needs to understand what was patched, why, how
it's delivered, and what was decided along the way is recorded here directly. (An earlier version of
this document cited the underlying SDD task briefs/reports by path; those never survive a clone, so
their substance has been promoted into this file instead — see "Task-by-task summary" and "Key
rulings made during execution" below.)

Full analysis: `docs/research/m4-three-mesh-bvh-correctness-blocker-adjudication.md` (the
"adjudication doc").

## What was patched, and why

Two confirmed correctness defects in the pinned `three-mesh-bvh@0.9.14` dependency, both blocking
M4 Phase 3 (adjudication doc §2.1/§2.2, Step 4):

- **Patch 1 (Defect 1 — stale module-global `obb2`).** `shapecastTraverse` never calls
  `intersectsBounds` on a root-is-leaf node, so the nested traversal inside
  `closestPointToGeometry`/`closestPointToGeometry_indirect` read whatever `obb2.min`/`max` a prior,
  unrelated call last left behind — order-dependent, byte-identical inputs could return a correct
  distance or a false `null`. Fixed by seeding `obb2` from the visited node's own box (already
  supplied to `intersectsRange` by `shapecastTraverse` on every path, including root-is-leaf) inside
  `intersectsRange` itself, in all three files: `src/core/cast/closestPointToGeometry_indirect.generated.js`,
  `src/core/cast/closestPointToGeometry.generated.js`, `src/core/cast/closestPointToGeometry.template.js`.
- **Patch 2 (Defect 2 — `OrientedBox.distanceToBox` indexing typo).** `src/math/OrientedBox.js` lines
  420 and 424: `max[ f2 ]` → `max[ f3 ]` in the `start[ f3 ]`/`end[ f3 ]` assignments only. Caused
  `distanceToBox` to over-estimate the true OBB/AABB distance for non-cubic boxes, which can
  false-prune the true-minimizer node.

Both defects are real, upstream-unfixed (no published version or `master` commit corrects either —
adjudication §1), and both strictly *tighten* correctness (adjudication Step 3, Option B table) —
neither patch widens any pruning bound in a way that could newly admit a wrong result.

## Delivery mechanism

**`patch-package` (devDependency `^8.0.1`) + `"postinstall": "patch-package --error-on-fail"`** in
`package.json`. Patch file: `patches/three-mesh-bvh+0.9.14.patch` (patch-package's own `+`-suffixed
naming convention), diffing all four touched files against the pinned `three-mesh-bvh@0.9.14`
tarball. `--error-on-fail` is mandatory — `patch-package` otherwise exits 0 after a failed local
application, which would silently ship an unpatched dependency (adjudication doc, "Delivery
mechanism" subsection under Step 3/Option B).

Reapplication is automatic on every `npm install`/`npm ci` via the `postinstall` lifecycle script;
verified with a genuine clean install in an isolated scratch directory (see "Clean-install
verification" below). `node_modules/three-mesh-bvh/src` is then copied into
`wwwroot/vendor/three-mesh-bvh/src` by `scripts/sync-vendor.mjs`, which already runs on both
`prestart` and `pretest` — so both the browser runtime and every test run consume the patched
source once `postinstall` has applied it, with no separate step needed for the vendor copy.

### Why `patch-package` over native `npm patch`, and over a vendored fork

Selected during Task 3's own controller ruling (superseding the adjudication doc's stated
preference-order): native `npm patch` (`patchedDependencies`) needs npm 12, which itself needs
Node ≥22.22.2 — silently breaking this repo's `"node": ">=20"` promise (no `.npmrc`/`engine-strict`
exists to make an `engines.npm` pin binding). A vendored fork was evaluated and rejected by the
adjudication doc itself: justified "only if install scripts are prohibited outright *and* npm cannot
be pinned" — neither holds here, and it carries far more vendored source and maintenance burden than
two ~4-line defects warrant.

A pinned git-SHA fork (external repo, `package.json` resolving the dependency directly by git
reference) was raised mid-Task-3 as an alternative and evaluated via an independent `codex-advisor`
consult (request `20260910-220227-36546-27002`, medium effort). Its finding: genuinely different
from a committed vendored fork (no in-repo source, no lifecycle-script dependence), but it trades
`patch-package`'s known weaknesses for new ones — external fork governance/availability, Git/GitHub
reachability required at install time in every environment (vs. today's immutable npm-registry
tarball + integrity hash), and a real risk that a fork missing the upstream package's committed
CommonJS `build/index.umd.cjs` output could break `require()` consumers even though this repo only
imports from `src/`. Ruling: retain `patch-package` per the already-approved plan; a git-SHA fork
was "defensible, but not clearly superior enough to authorize an unreviewed mid-task architecture
change."

### `patch-package` is the approved remediation for *this fix*, not a closed decision for the library

This delivery mechanism is scoped to unblocking M4 Phase 3 now, on the constraints verified today
(npm 12 requirement vs. this repo's Node floor; no evidence install scripts are prohibited or that a
git dependency source is organizationally approved). It does not permanently foreclose revisiting
dependency delivery for `three-mesh-bvh` specifically or for this repo's vendored-dependency strategy
generally.

**Known limitations of `patch-package`, carried forward as accepted risk:**

- `--ignore-scripts` on `npm ci`/`npm install` skips `postinstall` entirely, so the patch is never
  applied. `npm test --ignore-scripts` additionally skips `pretest`, so the vendor tree isn't even
  resynced.
- A restored `node_modules` cache (e.g. some CI caching strategies) that skips lifecycle scripts on
  cache hit will not re-run `postinstall`, silently leaving an unpatched tree in place if the cache
  was populated before the patch existed.
- `patch-package` in `devDependencies` is absent from a production-only install
  (`npm ci --omit=dev`), so `postinstall` fails or no-ops depending on flags.
- Downstream/organizational lifecycle-script policy (an npm config or wrapper that disables install
  scripts by default, e.g. for supply-chain hardening) defeats `postinstall` the same way
  `--ignore-scripts` does.
- A direct `node …` invocation of a script bypasses npm lifecycle hooks altogether, so a developer
  running a script by hand gets whatever is currently on disk, patched or not.
- **`node_modules/three-mesh-bvh`'s prebuilt bundles, `build/index.umd.cjs` and
  `build/index.module.js`, remain unpatched.** `patch-package`/the patch file only touch `src/`.
  Correctly out of scope today — confirmed no consumer reaches them: this repo is `"type": "module"`,
  every import resolves through the package's `exports.import` to `src/index.js`, and
  `scripts/sync-vendor.mjs` only ever copies `src/` into `wwwroot/vendor/`. Flagged here so a future
  CJS or bundler-based consumer of this dependency (were one ever added) knows to check whether it
  resolves to `build/` instead, and if so, extend the patch or the sync/integrity tooling to cover it.

**Mitigation in place, precisely stated (two independent layers, not one):**

1. `test/vendor/three-mesh-bvh-patch-integrity.test.mjs` (regression test 7, adjudication mandatory
   test 7) fails loudly — both textually (resolved version + patched-file content match what the
   patch file declares, cross-checked against the `.patch` artifact itself for BOTH Patch 1 and
   Patch 2) and behaviorally (re-running the Defect 1/Defect 2 regression assertions inline against
   the installed library) — if the patch is ever silently reverted or desynced. **Precondition: this
   only fires when `npm test` actually runs.** It cannot fix a broken install, and it cannot catch
   anything if the failure mode in question is precisely "nothing that runs `npm test` ever ran."
2. `scripts/sync-vendor.mjs` itself now asserts the patch markers are present in the copied
   `three-mesh-bvh/src` files immediately after copying them into `wwwroot/vendor/`, and
   `process.exit(1)`s with a clear error if either patch's markers are missing. **Precondition: this
   fires on every caller of `sync-vendor.mjs`** — `npm start` (via `prestart`), `npm test` (via
   `pretest`), and `npm run build:vendor` directly — which is every route by which the browser
   runtime's copy gets produced. This is what closes the specific gap layer 1 leaves open: `npm ci
   --ignore-scripts && npm start` skips `postinstall` (so `node_modules/three-mesh-bvh` stays
   unpatched) but still runs `prestart` → `sync-vendor.mjs`, which now catches the unpatched copy
   before the browser ever sees it, instead of serving it with zero signal.

Neither layer fires if `sync-vendor.mjs` itself never runs at all (e.g. `npm start --ignore-scripts`,
which skips `prestart` too, or a direct `node server.js` that bypasses npm lifecycle scripts
entirely) — in that residual case the STALE previously-synced `wwwroot/vendor/` copy (patched or not,
whatever was last written there) is served with no check. Neither layer is a general dependency-
validation framework; both are narrowly scoped to this one patch's two known markers.

**If any of the above constraints becomes real** (install scripts get prohibited outright, or a git
dependency source becomes an organizationally-approved supply-chain option), a pinned git-SHA fork
remains available as the next escalation — already evaluated above, not rejected on merits, only
deferred as unnecessary today. Whoever revisits this should re-run the same npm-engine-floor and
install-script-policy checks first, since both could have changed by then.

### A sandbox-specific operational note (not a production/CI concern)

Regenerating the patch file (`npx patch-package three-mesh-bvh`, needed only when the patch content
itself changes) failed in this implementation session's sandboxed shell with an opaque `status: 1`
and no stdout/stderr, because `patch-package` re-installs a clean copy of the pinned dependency into
a temp directory by its exact `package-lock.json`-resolved tarball URL, and this sandbox's npm has
`allow-remote=none` as a built-in default (confirmed via `npm config list -l`; not from any
`.npmrc` — none exists in this repo or at the user level). Worked around locally with
`npm_config_allow_remote=all npx patch-package three-mesh-bvh` for this one-time generation step.
**This does not affect reapplication** — `patch-package --error-on-fail` (the `postinstall` step)
only reads and applies the already-generated `.patch` file against already-installed files; it does
not re-fetch anything over the network. Confirmed via a genuine `npm ci` in an isolated scratch
directory with no `allow-remote` override (see below) — `postinstall` applied the patch cleanly.
Record this here only so a future patch-content update in this same sandbox isn't mistaken for a
patch-package regression.

## Clean-install verification (one-time, manual, not part of the committed test suite)

Run outside the repo working tree, in this session's scratchpad
(`/private/tmp/claude-501/.../scratchpad/clean-install-verify`), never inside the repo itself:

```
cp package.json package-lock.json <scratch>/
cp -R patches <scratch>/
cd <scratch> && npm ci
```

Output: `npm notice run aps-viewer-sandbox@1.0.0 postinstall` → `npm notice run patch-package
--error-on-fail` → `patch-package 8.0.1 / Applying patches... / three-mesh-bvh@0.9.14 ✔` → exit 0,
no `--ignore-scripts`, no `allow-remote` override. Confirmed the scratch install's
`node_modules/three-mesh-bvh/src/math/OrientedBox.js` carries `max[ f3 ]` on both lines 420/424 and
`node_modules/three-mesh-bvh/package.json` reports version `0.9.14`. Then ran the Defect 2
finite-`maxThreshold` regression fixture (`three-mesh-bvh-defects.fixtures.mjs`'s helpers, copied
into the scratch dir alongside a small driver script) against the scratch `node_modules` directly:
result `0.14192432541559227`, exactly `FROZEN_TRUE_MIN_DISTANCE` — PASS.

## Provenance identification going forward (adjudication Step 4 point 4)

§6.4 currently identifies the pinned build **by version alone** ("both sides run the same pinned
`three-mesh-bvh@0.9.14` build"), which is no longer sufficient now that a patch exists — two installs
can report the same version and behave differently if one skipped `postinstall`. **Wherever M4
records provenance, the pinned build must be identified as `three-mesh-bvh@0.9.14 +
patches/three-mesh-bvh+0.9.14.patch` (or an equivalent patch-identity marker), not version alone.**
This document does not itself change M4 harness/provenance-recording code (out of scope, Global
Constraint 1 of the plan) — it records the requirement for whoever next touches §6.4's provenance
recording.

## Out-of-scope follow-up: Defect 3 (Global Constraint 2)

`OrientedBox.prototype.intersectsBox`'s incomplete 6-of-15-axis SAT (adjudication doc §2.3) is a real
correctness defect for the public `OrientedBox` API — it can return a false `0` distance for
separated boxes — but is explicitly **out of scope** for this remediation and was **not** touched:

- It is safe-direction for this repository's traversal (an under-estimate only; both prune predicates
  are `score < …`, so an under-estimate only admits more nodes — it cannot lose the minimum or
  produce a false negative).
- It is performance-bearing only (disables pruning for the affected node), not correctness-bearing
  for the two defects blocking M4 Phase 3.
- Widening this patch to cover it would increase regression surface for no correctness gain on the
  blocked path (adjudication §2.3, "Disposition: real, but not part of this remediation").

Recorded here as a known follow-up: should be reported upstream to `gkjohnson/three-mesh-bvh`
(adjudication Step 4 point 6), and picked up as its own separately-scoped fix if it ever becomes
correctness-bearing for a future use of `OrientedBox.intersectsBox` in this repo. Do not fold it into
this patch set without a fresh adjudication.

## Task-by-task summary

This remediation ran as a 4-task SDD plan
(`docs/superpowers/plans/2026-09-10-three-mesh-bvh-correctness-patch-implementation.md`), each task
individually reviewed and approved before the next began. Summarized here so the plan/task-brief
detail doesn't need to survive for the story to make sense:

- **Task 1 — RED: unit-level regression tests for Defects 1 and 2** (pure Node, no dev server, no
  patch applied). Wrote `test/vendor/MeshBVH.closestPointToGeometry.rootIsLeaf.test.mjs` (root-is-leaf
  order-independence, Defect 1), `test/vendor/OrientedBox.distanceToBox.test.mjs` (named worst-case
  tuple + 5000-sample independent-reference sweep + axis-permutation controls, Defect 2),
  `test/vendor/MeshBVH.closestPointToGeometry.multiRoot.test.mjs` (multi-root BVH variant of Defect
  1), and `test/vendor/MeshBVH.closestPointToGeometry.maxThreshold.test.mjs` (Defect 2 manifesting
  through a finite `maxThreshold`, the way production `ClearanceQuery.js` actually calls it) — plus
  the shared non-test fixture module `test/vendor/three-mesh-bvh-defects.fixtures.mjs`. Every test
  was run and confirmed failing against the then-unpatched tree before this task's commits landed
  (the RED half of RED→GREEN).
- **Task 2 — RED: live-fixture regression script for the real `structure:2761 → structure:3980` case.**
  Wrote `test/performance/m4/structure-fragment-clearance-regression.mjs` (not a `*.test.mjs` file —
  it needs a live dev server, real APS credentials, and Playwright, so it must never run as part of
  plain `npm test`), reproducing Defect 1's real-world manifestation against the actual federated
  Audubon package. Confirmed failing (RED) on the `tlas` broad-phase arm against the then-unpatched
  dependency before this task's commit landed. A mid-task `codex-review` caught one real Medium bug
  (fragment IDs are model-local, not globally unique across the 3-model federation — the script's
  diagnostic-event match needed to pin the epoch to the Structure model specifically) and one Low gap
  (asserting `outcome: 'hit'` alone doesn't prove the correct geometric result — added a distance
  assertion against the ground truth too), both fixed and independently re-verified.
- **Task 3 — GREEN: apply the patch, wire durable delivery, prove Tasks 1 & 2 now pass, add the
  clean-install integrity guard.** Added `patch-package` as a devDependency; applied Patch 1 (Defect
  1) and Patch 2 (Defect 2) exactly as specified in the plan's Global Constraint 4; generated
  `patches/three-mesh-bvh+0.9.14.patch`; wired `"postinstall": "patch-package --error-on-fail"`;
  confirmed Task 1 and Task 2 now pass (GREEN); added the regression-test-7 clean-install integrity
  guard (`test/vendor/three-mesh-bvh-patch-integrity.test.mjs`); wrote this provenance document. Also
  converted one Task 1 assertion (`MeshBVH.closestPointToGeometry.maxThreshold.test.mjs`'s "unpatched
  over-estimates" sanity check) from a live assertion to a documenting comment — see "Key rulings"
  below.
- **Task 4 — full regression validation.** S2 `k=100` TLAS-vs-linear §6.4 parity (the original M4
  Phase 3 blocker) reached `MATCH` on both cold and warm runs, closing the blocker. M2 and M3
  performance gates passed, byte-unchanged in source (Global Constraint 9). Full suite: 1036 tests,
  1035 pass / 0 fail / 1 todo, exit 0, confirmed across two independent runs with the pre-existing
  named `ContainmentModeQuery` flake not triggering in either. Pure validation — no commits were
  needed. One investigative digression produced the M1-gate ruling recorded under "Key rulings"
  below.

## Key rulings made during execution

Several decisions were made mid-implementation, each recorded at the time in this plan's SDD ledger
(`progress.md`, gitignored). Promoted here so the reasoning survives a clone:

- **Delivery mechanism: `patch-package`, not native `npm patch`.** Decided before Task 1 was
  dispatched (a pre-execution `codex-advisor medium` plan review) — see "Why `patch-package` over
  native `npm patch`, and over a vendored fork" above for the full reasoning; not repeated here.
- **Delivery mechanism, reconfirmed mid-Task-3: `patch-package`, not a pinned git-SHA fork.** See "Why
  `patch-package`..." above — also already recorded there in full.
- **Task 1's multi-root test (mandatory test 8) reframed.** A `codex-advisor` review caught that the
  adjudication doc's original framing — "this test distinguishes the adopted `intersectsRange`-box
  patch (1b) from the rejected `getBoundingBox` union-seed variant (1a)" — was wrong: both variants
  are correctness-safe and can produce the same minimum on that fixture, so the test's return value
  alone cannot tell them apart. Corrected framing: the test's real job is proving the adopted patch
  doesn't regress a multi-root BVH; confirming *which* variant actually landed was done separately, by
  inspecting the applied patch's diff content directly during Task 3 (confirmed: the
  `intersectsRange`-box seeding variant, not a `getBoundingBox` call).
- **The Task 1 `maxThreshold.test.mjs` "unpatched over-estimates" assertion was converted to a
  comment, not left as a live test, during Task 3.** That assertion's job was to record the pre-patch
  RED baseline (`0.2446275839242859` vs. the true `0.14192432541559227`) as fixture-selection
  documentation — it structurally requires the defect to remain present, so it can never pass once a
  correct patch lands. Ruling (applying Task 4's own already-written principle for updating an
  assertion that encodes a now-corrected defective value, one task early, after independent
  `codex-advisor` confirmation this is a test-design artifact and not evidence of a wrong patch):
  convert it to a documenting comment recording the pre-patch baseline, in its own labeled commit,
  nothing else in that file touched. The live post-patch assertion (finite `maxThreshold`, mandatory
  test 9) remains a real, passing test right below it.
- **Task 4: the M1 gate's failure was parked as pre-existing and out of scope, not treated as a
  blocker.** `test/performance/run-gate.mjs` fails with a silent `page.evaluate()` → `undefined`
  resolve and zero page-side diagnostics. Proven independent of this patch by reverse-patch isolation
  (patch reversed in both `node_modules` and `wwwroot/vendor`, M1 re-run 3× unpatched, failed
  identically; combined with 2/2 patched-state failures — 5/5 across both states) and by an audit
  reviewer confirming `mode: 'volume-overlap'` (the only mode M1's gate exercises) structurally never
  calls `closestPointToGeometry` (the only function either patch touches). Not a blocker per the
  adjudication doc's own "M1/M2/M3 unchanged and still passing **as applicable**" language — M1 was
  never established as passing before this branch's work began, so "still passing" doesn't apply to
  it. **Lead hypothesis recorded for the separate M1 follow-up ticket** (not tested or fixed here, to
  avoid scope creep into an unrelated defect class): `runVolumeOverlapOnce` returns raw `result.pairs`
  across the `page.evaluate()` boundary, and each pair carries a live Autodesk Viewer `model` object
  reference; Playwright's structured-clone serialization of the return value happens AFTER the
  page-side callback resolves and OUTSIDE any page-side try/catch, so a serialization failure there
  would silently degrade to `undefined` with zero console/pageerror/crash events — exactly matching
  every observed symptom. M2 and M3's own gate scripts already avoid this trap by returning derived
  plain-data summaries instead of raw pairs, which is itself corroborating evidence.
- **Final whole-branch review (`git diff fe6e547..dd4d56f`): "Ready to merge: With fixes."** 0
  Critical, 3 Important (I-1 this provenance chain pointing into the gitignored `.superpowers/`
  directory — fixed by promoting content into this document and repointing every committed reference,
  as recorded here; I-2 `scripts/sync-vendor.mjs` not validating before copying — fixed by adding the
  fail-closed patch-marker check described under "Delivery mechanism" above; I-3 the integrity guard
  checking Patch 1 and Patch 2 asymmetrically — fixed by adding the same artifact cross-check for
  Patch 1 that already existed for Patch 2), 10 Minor (mostly line-number drift in `collision/` doc
  comments from Patch 1's 4-line insertion, stale pre-patch "RED" wording in now-passing scripts, and
  missing known-limitations entries — fixed in the same pass as I-1/I-2/I-3, docs/comments only).

## Files changed by this task

- `package.json` — added `patch-package` devDependency, added `"postinstall": "patch-package
  --error-on-fail"`.
- `package-lock.json` — updated by `npm install --save-dev patch-package`.
- `patches/three-mesh-bvh+0.9.14.patch` — new, the patch artifact itself.
- `node_modules/three-mesh-bvh/src/{core/cast/closestPointToGeometry_indirect.generated.js,
  core/cast/closestPointToGeometry.generated.js, core/cast/closestPointToGeometry.template.js,
  math/OrientedBox.js}` — patched directly (not committed; gitignored; regenerated by
  `patch-package` on every install per the patch file above).
- `wwwroot/vendor/three-mesh-bvh/src/...` (same four files) — synced from the patched
  `node_modules` copy via `scripts/sync-vendor.mjs` (not committed; gitignored; derived, regenerated
  by `prestart`/`pretest`).
- `test/vendor/three-mesh-bvh-patch-integrity.test.mjs` — new, regression test 7.
- `test/vendor/MeshBVH.closestPointToGeometry.maxThreshold.test.mjs` — one obsolete pre-patch-only
  assertion converted to a comment (separate commit; see that commit's message and "Key rulings made
  during execution" above for the full derivation).
- This file.

## Fix wave (final whole-branch review, I-1/I-2/I-3 + docs-only minors)

After the final whole-branch review above, a follow-up fix wave (same date) addressed all 3 Important
findings and the reviewer's recommended docs-only Minor bundle:

- This document's content was expanded as described in "Task-by-task summary" and "Key rulings made
  during execution" above (I-1), and every committed reference into the gitignored `.superpowers/sdd/
  2026-09-10-three-mesh-bvh-correctness-patch-implementation/` directory (5 files under `test/vendor/`,
  the live script under `test/performance/m4/`, and this document's own self-reference) was repointed
  here instead.
- `scripts/sync-vendor.mjs` gained the fail-closed patch-marker check described under "Delivery
  mechanism" above, and this document's earlier "mitigation already in place for every mode" claim was
  corrected to name each layer's actual precondition precisely (I-2).
- `test/vendor/three-mesh-bvh-patch-integrity.test.mjs` gained the Patch-1-vs-`PATCH_FILE` artifact
  cross-check symmetric to the pre-existing Patch-2 one (I-3).
- Docs-only minors: stale line-number citations in `collision/query/ClearanceQuery.js`,
  `test/query/ClearanceQuery.test.mjs`, and the M3 clearance design spec, drifted by Patch 1's 4-line
  insertion; `collision/README.md`'s Known Milestone-1 limitations now note the unpatched-dependency
  risk; the adjudication doc's status line now points here; stale pre-patch "RED"/"unpatched result"
  wording in the now-passing live script and `maxThreshold.test.mjs` was reworded to reflect a GREEN
  regression test; the unpatched-`build/`-bundle known limitation (above) was added; `test/README.md`
  now notes `test/vendor/` as an intentional exception to its "mirrors `collision/`" convention; and
  `CHANGELOG.md` gained a brief correctness-fix note.
