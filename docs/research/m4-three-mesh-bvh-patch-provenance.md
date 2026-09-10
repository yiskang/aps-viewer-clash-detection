# three-mesh-bvh@0.9.14 correctness patch — provenance

Task 3 of
`.superpowers/sdd/2026-09-10-three-mesh-bvh-correctness-patch-implementation/task-3-brief.md`.
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

**Mitigation already in place for every mode above:** `test/vendor/three-mesh-bvh-patch-integrity.test.mjs`
(regression test 7, adjudication mandatory test 7) fails loudly — both textually (resolved version +
patched-file content match what the patch file declares) and behaviorally (re-running the Defect
1/Defect 2 regression assertions inline against the installed library) — if the patch is ever
silently reverted or desynced. It cannot fix a broken install, but it ensures the failure is never
silent.

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

Per task-3-brief.md point 6, run outside the repo working tree, in this session's scratchpad
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
  assertion converted to a comment (separate commit; see that commit's message and
  `task-3-report.md` for the full derivation).
- This file.
