# Federated Clash Test Viewer Adapter — independent implementation review

Date: 2026-09-26  
Repository: `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`  
Reviewed branch: `feature/federated-clash-test-viewer-adapter`  
Reviewed HEAD: `c7b5d13a15b8da7f9403a9027530bdd0c6f86d55`  
Implementation boundary: `0f29f82..c7b5d13` (16 commits; branch is 17 commits ahead of `main`, including the `0f29f82` planning baseline)  
Plan: `docs/superpowers/plans/2026-09-26-federated-clash-test-viewer-adapter-implementation.md`

## Verdict

**Viewer Adapter implementation is ready for the owner to consider authorizing T3 execution.** This review does not authorize T3 and did not execute it.

No Critical or High defect was found. No Viewer Adapter implementation fix is required before T3 authorization. The review records two Medium frozen-Core discrepancies for separate owner triage and one Low optional adapter hardening item; none blocks T3.

Severity totals for this review: **0 Critical / 0 High / 2 Medium / 1 Low**.

## Repository and scope verification

- Branch/HEAD independently verified as `feature/federated-clash-test-viewer-adapter` at `c7b5d13a15b8da7f9403a9027530bdd0c6f86d55`.
- `main` and `origin/main` are both `267801eae7b87ccc07fb81b03cb4e10f4f4f28d3`; the reviewed branch is 17 commits ahead and 0 behind.
- Before this review's documentation writes, the only working-tree change was `docs/handoffs/latest.md`, modified and uncommitted.
- The implementation diff changes only the new `clashtest/viewer/` leaf, its tests/acceptance script, the additive mock-tree fixture method, the single adapter README row, and planning/review/prompt/handoff documentation. No accepted Core production file, `collision/` production file, M4 artifact, `server.js`, or `wwwroot/` file changed.
- No Viewer Clash Panel/UI implementation was added. The production leaf has no Viewer global or UI dependency; host integration remains absent.

## Findings

### Critical

None.

### High

None.

### Medium

#### M1 — frozen-Core planning checkpoint does not implement the frozen spec's lease-dead/world-disposed contract

This is a pre-existing Core discrepancy, not a Viewer Adapter defect and not introduced by `0f29f82..c7b5d13`.

- Frozen spec §6.2 says the engine-supplied enumeration checkpoint throws `EnumerationCancelledError` when the run is cancelled, a lease dies, or the world/engine is disposed, mapping a dead lease during planning to `model-not-bound`.
- `clashtest/run/Run.js:1106-1113` checks only `run.cancelRequested`, then ticks the slicer. It does not validate the captured binding leases or world state.
- Consequence: a mid-planning unload is not necessarily classified at the checkpoint as `model-not-bound`. Depending on what the detached Viewer objects do, planning can fail later as `enumeration-failed`, or finish and be rejected by later lease/scope execution guards. Existing Core guards still prevent a stale lease from being silently executed as clean work, but the frozen externally observable cause/timing contract is not implemented exactly.

**Disposition:** separate frozen-Core correctness/contract follow-up requiring explicit owner authorization under the freeze rule. Do not change the Viewer Adapter for this. It does not block T3 because T3 is the live adapter/envelope and unload-wiring gate, not authorization to reopen Core.

#### M2 — one planner-returned `owner-mapping-mismatch` is durably recorded twice

This is also pre-existing Core behavior, not introduced by the Viewer Adapter.

- `clashtest/planning/planner.js:308-320` records the failed root-resolution cause at phase `planning`.
- `clashtest/run/Run.js:332-340,435-455` subsequently calls `failPlanning` while the run phase is `enumerating`, adding a second row for the same logical failure.
- Ledger de-duplication is by `(phase, cause)`, so both rows survive. The adapter integration test accurately pins the current result as `[{phase:'planning', cause:'owner-mapping-mismatch'}, {phase:'enumerating', cause:'owner-mapping-mismatch'}]`.
- The duplicate can inflate durable diagnostic counts and present one failure as two phase rows, even though the run still fails closed with no results.

**Disposition:** separate frozen-Core ledger-semantics follow-up requiring explicit owner authorization. It does not block T3: the accepted live envelope requires `ownerMismatch.count === 0`, and the adapter correctly returns the mismatch signal that Core consumes.

### Low

#### L1 — entry checkpoints in four internal walk/scan helpers are optional hardening, not a correctness or resource-safety prerequisite

`indexNodeParents`, `walkSubtree`, `subtreeRecords`, and `scanPopulation` do not each checkpoint on entry. They checkpoint every 64 visited nodes/records, and their public callers checkpoint before initial Viewer reads; `resolveWhole` also performs the planned post-readiness checkpoint before the population scan.

Adding entry checkpoints would improve cancellation responsiveness when cancellation lands in a microtask gap between internal awaited stages, especially for a final stage shorter than 64 items. It would not repair M1 because the actual Core checkpoint does not test leases/world state. Existing D-V9 bounds, per-loop checkpoints, fail-closed reconciliation, and later Core lease/scope brackets preserve correctness and resource safety. The indivisible synchronous Viewer callback burst remains the explicitly accepted limitation either way.

**Disposition:** optional adapter hardening, deferred; no fix required before T3. If later authorized, add the four entry calls with same-tick order probes, without changing public behavior.

## Plan-to-implementation verification

### Task and commit sequence

All 16 commits after the reviewed planning baseline were inspected. Their file boundaries match Tasks 1–13:

| Task | Commit(s) | Verified delivery |
| --- | --- | --- |
| 1 | `e7b626d` | Layering/global/reverse-import/G-EC guards |
| 2 | `f9b6d42` | Additive mock `getRootId` plus model/binding/context builders |
| 3 | `486f998` | Adapter errors, conditionally synchronous checkpoint, readiness gate/tests |
| 4 | `53d7ac0` | Bounded parent/full-tree/subtree traversal and tests |
| 5 | `4dd0369` | Population N/U/L scan and 20,000 count gate |
| 6 | `f159132` | `digestScope` using Core digest producers |
| 7 | `ad83e44` | Explicit-scope `resolveRoots` and normalization |
| 8 | `6b4520a` | Whole-model `resolveRoots`, D-V6 reconciliation, D-V9 ordering |
| 9 | `29eccc1` | Core conformance and collision-library differential tests |
| 10 | `7ca8936` | Real engine/CollisionWorld integration and negative controls |
| 11 | `b78c35e` | Unload wiring and lifecycle tests |
| 12 | `eef7837`, `da4ae49` | Entry point and scoped README updates, followed by wording correction |
| 13 | `298b4a8`, `58bebb6` | Authored T3 script and acceptance README, followed by gate/failing-link correction |
| Honesty closeout | `c7b5d13` | Checkpoint/README/accepted-envelope comments only |

Every commit carries the required Claude co-author trailer. The current committed tree is internally green; historical monotonic per-commit totals are recorded in the handoff but were not re-executed by checking out all 16 historical trees during this read-only review.

### D-V6

Verified implemented for whole-model reconciliation only, as authorized:

- population scan classifies not-loaded as `N`, undefined/array owners as `U`, and numeric owners as `L`;
- a tree-reachable fragment outside the population or classified other than `L` throws `EnumerationInconsistencyError`;
- no partial roots/population carrier is returned;
- explicit scopes retain the frozen declared residual because they have no whole-population witness.

Focused unit and real-engine tests cover N, U-undefined, U-array, out-of-range, deterministic failure, no partial answer, and recovery on a following call.

### D-V9

Verified implemented using existing collision limits without adding a public option:

- whole-population `getCount()` is rejected above `maxCollisionInstancesPerEpoch` before tree traversal or fragment scanning;
- child callback retention aborts at `maxChildrenPerNode + 1`;
- own-fragment retention stops at `maxFragmentsPerDbId`, followed by deterministic rejection;
- whole-tree reachable callback tally is capped by `maxCollisionInstancesPerEpoch`;
- each requested explicit root is capped by `maxFragmentsPerDbId` with rediscoveries counted;
- failed calls retain no module-level index/cache state.

The already-disclosed total tree-node count and aggregate explicit-root retention are not governed by an existing collision limit. They remain T3/calibration residuals, not silently claimed closed.

### Viewer lifecycle

`wireModelUnload` validates registry/world pairing, registers one host-supplied unload listener, calls `registry.unregister(model)` before `world.evictModel(model)`, isolates errors per operation, never awaits in the handler, returns `undefined` synchronously, and disposes idempotently. Tests cover late old-model unload after reload, disposed-world behavior, missing event models, throwing reports/operations, double unload, and listener disposal.

Registration and model-key/version derivation remain host responsibilities. The authored T3 step (h) is the live proof of actual Viewer event payload/order and same-URN reload behavior.

## Verification executed

- Focused Viewer Adapter suite: `node --test test/clashtest/viewer/*.test.mjs` — **124/124 passed**.
- T3 syntax only: `node --check test/acceptance/clashtest-viewer-adapter.acceptance.mjs` — **passed**.
- First full-suite run inside the restricted sandbox: **2,968 pass / 3 fail / 1 todo**; all three failures were the known local-port `EPERM` condition in `test/performance/m4/spike-server.test.mjs`.
- Permitted rerun with local ephemeral-port access: `node scripts/run-tests.mjs` — **2,972 total / 2,971 pass / 0 fail / 1 pre-existing todo**.
- `git diff --check main...HEAD` — clean.
- The T3 script was **not executed**: no server, Viewer, credentials, Playwright browser session, or live APS content was used. No new T3 result exists under `docs/research/`.

## Stated plan deviations

The implementation's recorded deviations were checked and are bounded:

1. Task 1 uses a genuinely forbidden synthetic import in its negative control because the plan text simultaneously listed `ModelRegistry.js` as permitted; `FORBIDDEN_GLOBALS` is implemented as `[name, RegExp]` pairs. Test intent is preserved.
2. Task 8 adds a cancellation/engine checkpoint after readiness and immediately before `scanPopulation`; this strengthens the plan's own same-tick rule without changing results.
3. Task 12 documentation correctly says T3 characterization is planned, not completed, and accurately narrows checkpoint semantics.
4. Task 13 imports non-barrel collision extraction helpers from their real module, checks the typings-only `viewer.hasEventListener` live, corrects the no-wiring negative-control expectation, refuses unevidenced world-construction fallback, and gates the accepted-envelope label on all `[env]`/`[load]` checks.
5. Final comments correctly describe the supplied checkpoint as cancellation/engine scheduling, not lease-liveness validation.

None requires a production implementation correction.

## Authorization result

- **Ready for T3 authorization:** yes.
- **T3 authorized by this review:** no. Only the owner can authorize the credentialed live run.
- **Implementation fixes required before T3:** none.
- **Viewer Clash Panel/UI:** remains out of scope and unauthorized.
- **Core/M4:** remains frozen; M1 and M2 above are triage records, not authorization to modify either area.

