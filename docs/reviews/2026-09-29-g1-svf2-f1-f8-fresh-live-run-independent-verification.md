# G1 SVF2 F1–F8 fresh live run — independent verification

**Reviewed repository:** `main` @ `9eab858a7f7c314ba43c3416d5345a3124707088`  
**Primary retained run:** `2026-09-29T06:32:02.261Z`–`06:32:07.208Z`  
**Independent verdict:** **0 Critical / 1 High / 3 Medium / 2 Low.** The retained artifacts are authentic evidence of one real SVF2 execution and the recorded overall `FAIL` is mechanically correct. They do **not** establish a Viewer Adapter/SVF2 digest incompatibility: the F1 digest result is caused by a harness/oracle defect that omits the required `geometryId` from both recomputed digest inputs.

No production code was modified, no live G1 execution was intentionally authorized or performed by this review, and no G2/G3/H1/H2/OQ-1/host-integration work was started.

## Sources and verification boundary

This review independently read the durable JSON/log/report, the authorization prompt, the accepted build plan and prior acceptance review, the harness, and the actual digest/Enumerator implementation. It also:

- verified the retained harness SHA-256 against the current file;
- recomputed all 88 served-module manifest hashes with zero mismatches;
- verified Playwright `1.62.1` from the installed package and lockfile;
- compared the retained verdict inputs with `computeOverall`'s source precedence;
- inspected the current branch, HEAD, working tree, and commit range.

The codebase-memory index reported no recorded coverage issue for the relied-on source paths. The untracked raw log and lockfile were read directly because the index marked them `not_tracked`.

## Findings

### High — H1: F1's digest oracle omits the required `geometryId`, so its “mismatches” are harness-generated

**Type:** harness/oracle defect; blocks accepting F1 and blocks any future live G1 execution until bounded remediation and re-review.

The production digest contract is unambiguous:

- `clashtest/planning/scopeDigest.js:42-53` requires loaded population rows to contain `fragId`, `ownerDbId`, and safe-integer `geometryId`.
- `clashtest/planning/scopeDigest.js:59-66` requires subtree rows to contain the same three values.
- `clashtest/viewer/ViewerElementEnumerator.js:18-30` supplies `geometryId: fragList.getGeometryId(fragId)` when computing the authoritative subtree digest.

The harness does not reproduce those inputs:

- `test/acceptance/g1-svf2-f1-f8-verification.mjs:3070-3072` builds subtree rows with only `{fragId, ownerDbId}`. `digestSubtree` therefore throws for every root. The empty `catch` leaves `libDigest = null`, and the harness increments `subtreeDigestMismatch`.
- `test/acceptance/g1-svf2-f1-f8-verification.mjs:3097-3103` builds loaded population rows with only `{fragId, cls:'L', ownerDbId}`. `digestPopulation` therefore throws. The broad `catch` records only `populationDigestEqual = false`.

This exactly explains the retained `467/467` subtree mismatch count and the unequal population flag without requiring any Viewer/SVF2 disagreement. It also explains why `session.artifacts.f1PopulationRecords` was never assigned: that assignment is after the throwing population digest call at `:3113`.

**Disposition:** F1 is a **harness/oracle defect**, not a genuine Viewer Adapter/SVF2 compatibility finding. The narrower ownership/count observations remain useful: 467 roots were visited; root sizes and owner sets matched; `ownerMismatchCount`, `ownersMismatch`, `sizeMismatch`, and `unreachableCount` were all zero. The statement “the existing SVF-era F1 digest equivalence assumption does not hold under this tested SVF2 envelope” is **not supported** by this run because valid comparable digests were never produced.

### Medium — M1: the durable F1 evidence hides the exceptions and drops the required bounded mismatch detail

The build plan §7.1 requires the first 20 mismatches to be retained. `observeF1` returns `first20Mismatches`, but `runHarness` persists only `f1Score.fields` (`test/acceptance/g1-svf2-f1-f8-verification.mjs:8058-8065`). The JSON contains neither those records nor the caught digest exceptions, actual digest values, digest inputs, or differing components.

This omission made the report's “digest-computation disagreement (harness-side or Viewer-side)” diagnosis under-specific and prevented the retained JSON alone from localizing the error. The repository source is sufficient to identify the harness defect, but the run artifact is not.

**Disposition:** evidence is sufficient to authenticate the run and recompute `FAIL`; it is not complete enough to audit F1's claimed digest comparison. Before any future live execution, bounded harness remediation must retain typed digest errors, both compared digest values (when produced), the relevant digest-row component summary, and the required bounded mismatch details.

### Medium — M2: three mandatory controls are `NOT_EXECUTABLE`; all independently prevent `PASS`

These states are correctly fail-closed under `computeOverall`: every mandatory control must be `DETECTED_RESTORED`; any `NOT_EXECUTABLE` state forces overall `FAIL` independently of F1.

| Control | Actual cause/disposition | Runtime-population justification | Future PASS requirement |
| --- | --- | --- | --- |
| `wrong-owner` | `observeF1` never assigned `f1PopulationRecords` because the malformed population digest threw. Target selection then reported `no-eligible-fragment`. | **Not justified by the population.** F2 retained 789 class-L/tree-reachable fragments, and `hidden-fragment` selected frag 0 from that population. This is dependency fallout from H1, with a misleading target-absence reason. | Must become executable and `DETECTED_RESTORED` after the F1 artifact path is corrected. |
| `invalid-bounds` | F7 had no fields, so `buildInvalidBoundsControlDep` found no censused dbId and returned `precondition-unmet`. | Expected F7 dependency fallout, not evidence that the fixture has no eligible dbId. | Must execute and restore after F4/F7 can run. |
| `bounds-beyond-tolerance` | F7 had no fields, so no representable target could be selected. | Expected F7 dependency fallout, not a live finding that the actual bounds perturbation is intrinsically unrepresentable. | Must execute and restore after F4/F7 can run. |

### Medium — M3: shell exit `0` for overall `FAIL` is an unsafe harness exit contract

`main()` returns the result normally regardless of `result.overall`; only a thrown exception sets `process.exitCode = 1` (`test/acceptance/g1-svf2-f1-f8-verification.mjs:9649-9655`). The accepted build plan does not explicitly define process-exit semantics, so this does not invalidate the retained JSON. It does, however, allow a shell/CI operator to interpret a failed G1 gate as success.

**Disposition:** harness defect requiring correction before any future live execution. `PASS` may exit zero; `FAIL`, `PARTIAL`, and `BLOCKED` must not silently communicate successful gate completion. The exact nonzero mapping is an implementation detail; the JSON verdict remains authoritative.

### Low — L1: the report calls the raw log empty, but it is a 379-byte wrapper/server record

The harness emitted no stdout/stderr, but the retained log contains the run header, exit code, and server tail. This is useful metadata and does not affect validity. The report should say “no harness console output,” not “raw log is empty.”

### Low — L2: retained evidence proves one live execution, not the absence of every later preflight invocation

The durable evidence set contains one real execution with model load, confirmed SVF2 classification, F1–F8 activity, and one F6 reload. There is no evidence of a second **live** attempt or retry.

During this independent review, importing the executable harness to call its exported verdict helper unexpectedly triggered its entrypoint and produced a later git-ignored Phase-0 result at `2026-09-29T07:02:57.409Z`. This was a review-process deviation. The clean-tree interlock blocked it before Playwright: it records `resourcesExisted.browser/page/context = false`, has null runtime format signals, and ran no F1–F8/control. It did not consume another live attempt and did not alter the durable fresh-run JSON, but it did overwrite the ignored scratch-result file. Because it exists, the literal broader statement “no retry/invocation occurred” cannot be affirmed; the supportable statement is **exactly one real live attempt and no live retry**.

## Execution authenticity and envelope

The primary evidence is valid and bound to the reviewed repository state:

- branch/HEAD: `main` @ `9eab858a7f7c314ba43c3416d5345a3124707088`, matching `origin/main` at review time;
- harness SHA-256: `c7f3672aebc80f0e12f79334ec7b9a46ad0c03e261bf4c7733f6bc7684aee180`, matching the reviewed harness file;
- served-module manifest: 88 entries, all byte-identical to current files;
- Node `v22.23.1`, Playwright `1.62.1`, Chromium `151.0.7922.34`, Viewer `7.124.2`;
- expected RAC basic sample URN, `AutodeskProduction2`, `streamingV2`;
- `isOTG() === true`, `isSVF2() === true`, classifier `CONFIRMED_SVF2`;
- Viewer script identity `VERIFIED`, decoded length `10,948,159`, SHA-256 matching the pinned expected digest.

No production/Core/Viewer Adapter/M4/Panel file differs in the working tree. The retained run and current diff show no G2/G3, host H1/H2, OQ-1, or host-integration work.

## Independent verdict recomputation

The retained inputs are:

- `F1 = FAIL`;
- `F2/F3/F5/F6/F8 = PASS`;
- `F4 = BLOCKED` because `f1PopulationRecords` was absent;
- `F7 = BLOCKED` because F4 artifacts were absent;
- six mandatory controls `DETECTED_RESTORED`;
- three mandatory controls `NOT_EXECUTABLE`;
- Viewer identity `VERIFIED`, classifier `CONFIRMED_SVF2`;
- empty fatal ledger, clean cleanup, no unresolved ownership, no session taint.

`computeOverall` checks any Fi failure or any non-restored mandatory control before its `PARTIAL` fallback. F1 alone forces `FAIL`; each `NOT_EXECUTABLE` control also independently forces `FAIL`. Therefore the recorded overall **`FAIL` is mechanically correct and cannot be reinterpreted as `PARTIAL` or `BLOCKED`.**

## F4/F7 disposition

F4 and F7 were not accidentally skipped:

1. F4 requires `session.artifacts.f1PopulationRecords` (`:5013-5015`). H1's population-digest exception prevented that artifact from being assigned, so F4 correctly returned `BLOCKED`.
2. F7 requires F4 geometry/world-matrix artifacts (`:5374-5378`). Because F4 did not run, F7 correctly returned `BLOCKED`.

Their missing evidence is expected dependency fallout from the F1 harness defect, not an independent Viewer/SVF2 failure. The report's wording “F1 failed → dependent” is directionally right but imprecise: an ordinary scored F1 mismatch would not itself block F4 if `f1PopulationRecords` existed; the missing artifact caused the block.

## Evidence and attempt accounting

- The durable JSON is valid for runtime identity, check/control outcomes, cleanup, and overall-verdict recomputation.
- The human report faithfully reproduces the main counts and statuses, subject to H1, M1, and the minor raw-log wording correction above.
- The evidence set is insufficient to support a Viewer/SVF2 digest incompatibility claim or to identify differing digest components because no valid comparison digest or digest error was retained.
- The live authorization **was consumed**: the real model loaded, SVF2 was confirmed, F1–F8 phases began, controls ran, and F6 performed its authorized reload. No rerun is currently authorized.

## Required owner decision

The next owner decision is whether to authorize a **bounded harness/test-only remediation** for:

1. correct F1 digest-row construction including the existing `geometryId` contract;
2. durable F1 error/digest/mismatch evidence;
3. the three dependent mandatory-control paths and reasons;
4. nonzero process exit for non-PASS gate outcomes;
5. targeted offline verification and independent re-review.

That decision must not include a live rerun implicitly. After remediation is accepted and committed on a clean tree, any new live G1 execution requires a separate explicit exactly-one authorization. Production/Core/Viewer Adapter/M4/Panel changes, G2/G3, host H1/H2, OQ-1, and host integration remain unauthorized.
