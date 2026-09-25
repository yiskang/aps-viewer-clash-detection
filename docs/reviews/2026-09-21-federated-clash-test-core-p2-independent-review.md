# Federated Clash Test core — P2 independent implementation review

- **Date:** 2026-09-21
- **Reviewed checkpoint:** `6a74cdd33ec624df2ae556b84df787af7c7ed4f3` (`feat(clashtest): P2 definitions, validation and ClashTestStore`)
- **Branch:** `feature/federated-clash-test-core-engine`
- **Scope:** P2 definitions, normalization, roots-contract helpers, store/lifecycle operations, tests, P2 status records, and the directly consuming P3/P7 plan contracts. P0/P1 and the frozen core design were not reopened.

## Verdict

**No Critical finding. Three High findings block P2 acceptance. No separate Medium or Low finding.** The functional definition, identity-digest, and store semantics are substantially sound and all P2 tests pass, but P2 still contains size-dependent unsliced work and drops the measurement seam required by the downstream AC-12 plan. These are bounded implementation/interface corrections; none requires reopening the frozen core design.

## Findings

### High 1 — the P2 root-contract helpers are synchronous, unsliced planning spans

**Location:** `clashtest/definition/normalize.js`, `assertRootAntichain`, `checkCrossRoleNesting`, and `hierarchyInternalCandidates` (lines 30–117); consumed synchronously by P3 at `docs/superpowers/plans/federated-clash-test-core/p3-planner.md` lines 1018 and 1021.

**Contract:** frozen spec §17.3 says every engine-owned span other than the explicitly excluded definition capture/validation pass must run in deadline-aware slices. P3 must use P2's helpers and is forbidden to reimplement their owned rules.

All three helpers traverse size-dependent root/owner collections without a scheduler checkpoint. The committed maximum-shape antichain test makes the failure concrete: the 20,000-root call took about 69 ms in this review run (about 41 ms in the first targeted run), entirely inside one synchronous call. Yielding before or after the helper in P3 cannot divide that span.

**Concrete failure mode:** a valid large federation can block the main thread during planning well beyond the 8 ms design target, while P3 has no conforming way to insert checkpoints inside the P2-owned work. The internal C3 remediation fixed the asymptotic/allocation defect but left the remediated algorithm behind a synchronous interface.

**Type:** implementation-compatibility issue with a downstream interface obstruction.

**Minimum correction:** provide sliced/checkpoint-aware forms of the three P2 rule helpers (or change their P2 interface to accept the P3 enumeration checkpoint/slicer), preserve their current deterministic outputs, make P3 consume those forms, and add maximum-shape fake-clock tests proving bounded checkpoint cadence. A synchronous small-input helper may remain as a test oracle, but P3 must not call it for unbounded planning data.

### High 2 — model-key ordering still uses native `Array.sort` inside sliced normalization

**Location:** `clashtest/definition/normalize.js`, `normalizeSelectionSteps`, line 195 (`[...byModel.keys()].sort(byCodeUnit)`).

**Contract:** frozen spec §5.3 explicitly places normalization, including ordering each selection by `modelKey`, in sliced work; §17.3 requires clock checks at least every 64 work items. A selection may contain up to 10,000 entries at the hard ceiling, and each key may be 1,024 code units.

The C1 remediation sliced dbId union/deduplication and numeric sorting, but the distinct-model-key sort remains one native, non-yielding span. The existing normalization-yield tests count entry and dbId checkpoints; they do not place a checkpoint inside the model-key comparison sort.

**Concrete failure mode:** `prepareDefinition` can exceed its slice budget while sorting many long, distinct model keys, even though its surrounding generator yields before collection and after the sort. This directly contradicts the sliced-normalization contract.

**Type:** implementation correctness / verification gap.

**Minimum correction:** replace the native model-key sort with a deterministic yielding merge sort (or an equivalent sliced sort that shares comparison semantics with `normalizeDefinition`) and add a hard-ceiling/fake-clock test that fails when the sort is changed back to native `Array.sort`.

### High 3 — the P2 definition pipeline drops `spanRecorder` and uses the wrong digest label for P7 AC-12

**Location:** `clashtest/definition/normalize.js` `prepareDefinition` (lines 237–251), `clashtest/definition/operations.js` `createDefinitionOperations` (lines 18–27), P2 phase-interface rows 39 and 53, and P7 construction at `docs/superpowers/plans/federated-clash-test-core/p7-engine-integration.md` lines 286–296.

**Contract:** frozen spec §17.3 requires the engine's optional `spanRecorder` to receive labeled engine spans. P7.9 explicitly requires recorded `normalize` and `semanticDigest` spans. P0's `createSlicer` already supports `spanRecorder`.

P2 neither accepts nor forwards `spanRecorder`: `prepareDefinition` omits it when constructing the slicer, `createDefinitionOperations` omits it from its configuration and slice bundle, and P7 therefore cannot pass the engine recorder into definition preparation. In addition, P2 calls `digestCanonicalSliced` with label `digest`, while P7's acceptance contract names the definition digest span `semanticDigest` (and reserves generic `digest` for other digest work).

**Concrete failure mode:** P7's planned AC-12 deterministic measurement test cannot observe the definition normalization/digest spans through the public engine configuration. It must either fail or silently weaken the acceptance criterion.

**Type:** downstream implementation-plan compatibility issue / unreachable verification contract.

**Minimum correction:** thread `spanRecorder` through `createDefinitionOperations` into every `prepareDefinition` call and its slicer, accept it in the P2 phase interfaces, have P7 pass its configured recorder, label the definition digest `semanticDigest`, and add a recorder test covering both saved and store-returned definitions.

## Confirmed sound areas

- Definition/reference capture is detached, getter-safe, fail-closed, bounded by resolved limits, and stable against mutation after the asynchronous boundary; `saveTest` delivers data failures as Promise rejections.
- Functional normalization and deterministic identity are sound: model-wins merging, dbId deduplication/order, role-tagged canonical form, golden semantic digests, and sync/sliced byte equality all pass.
- `ClashTestStore` revision sequencing, archive behavior, permanent tombstones, resolve statuses, keyset listing, and per-test linearization behavior match the P2 contracts exercised by the tests.
- Untrusted store definitions and listing pages are recaptured and validated; the `validateTestSummaryPage(page, {returnCopy:true})` deviation is a bounded internal addition and closes the earlier time-of-check/time-of-use defect.
- The near-linear antichain remediation preserves the old helper's results and caps reported violations; the remaining issue is cooperative scheduling, not rule semantics or asymptotic correctness.
- P2 remains Viewer-free and does not enter P3+, remote persistence, annotation, calibration-value promotion, or another gated scope.

## Verification

- P2 suite: `node --test test/clashtest/definition/*.test.mjs test/clashtest/stores/*.test.mjs` → **109 pass, 0 fail**.
- All implemented core tests: `node --test test/clashtest/**/*.test.mjs` → **301 pass, 0 fail**.
- Repository runner: `node scripts/run-tests.mjs` → **1,427 total; 1,423 pass; 3 sandbox-only `listen EPERM` failures in the pre-existing M4 spike-server tests; 1 pre-existing todo; no P2 failure**. The committed handoff's unrestricted run remains 1,426 pass / 0 fail / 1 todo.
- Working tree was clean at `6a74cdd` before this review artifact and handoff update.

## Gate result

`P2 checkpoint requires targeted adjudication and remediation; P3 remains blocked.`

Per `CLAUDE.md`, the next action is a targeted adjudication of these three cited findings and this verdict. If accepted, remediate only these areas, run targeted internal verification, then obtain a focused independent re-review before P2 acceptance. No production code, test, plan, or frozen specification was modified by this review.
