# G2 completed-phase result retention — independent re-review

**Date:** 2026-10-02  
**Repository:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`  
**Branch / baseline:** `main` @ `c0f877aee82c078564efdb504bcbe695522b4ed4`; `origin/main` is identical  
**Scope:** current uncommitted completed-result retention correction, its directly affected procedure wording, tests, failed-run transfer and artifact/reader behavior  
**Provisional procedure SHA-256:** `7f68188940da7e9786acaab6802d82fd455f527bc684e8bfaf2676096df06d4c`

## Verdict

**0 Critical / 1 High / 0 Medium / 6 Low.**

The local runner-ordering defect is corrected: a phase driver's returned checks, controls and extras are validated and merged into the runner-owned partial state before the final attribution-clear fence. The original durable completed-history High is **not fully closed**, however, because a realizable clear-fence refusal can also refuse cleanup entry. The page then throws without transferring that partial state, and Node commits a valid failed-run artifact chain that omits completed work.

The open transfer limitation is therefore a **blocking High before checkpoint**, not an acceptable documented limitation. The procedure and provisional SHA are not ready for owner acceptance; the tree is not ready for checkpoint commit or live planning.

## Findings

### High H1 — cleanup-entry refusal still discards completed results before they become Node-authoritative

**Classification:** harness/live-transfer and procedure correctness defect; blocks truthful post-C1 evidence, checkpoint acceptance and live planning.

The corrected `runPhase()` ordering is sound locally:

1. the driver resolves;
2. returned check/control records are validated and merged, control terminal ordinals are allocated, same-phase dependencies are applied, and extras are merged;
3. only then does the final attribution-clear fence run;
4. no later phase starts unless that fence succeeds.

This closes the direct runner reproduction: `C2`, `C2+C3`, `N1`, and mixed check/control/extras results all remain in `partialSink` after the later fence throws. The mutation tests are non-vacuous: moving the fence back before the merge loses those records.

It does not make that history authoritative in Node. The real live path is:

1. the page runner retains the completed results only in its page-realm `partialSink`;
2. the clear fence calls Node's `authority.syncPage()`;
3. an ingestion/high-water/attribution refusal makes the fence throw;
4. `g2RunPhases()` catches the failure and calls `g2EnterCleanupAfterFailure()`;
5. that cleanup-entry fence can refuse the still-unacknowledged/inconsistent ordinal batch, as the existing real-page M2 refusal test demonstrates;
6. `g2RunPhases()` rethrows the original failure without returning `g2PartialHistory(partialSink)`;
7. Node's `runPostReservation()` enters the transport-failure branch, which has the authoritative C1 gate and provenance markers but no check/control result payload. It commits `post-c1-untransferred`, synthesizing checks as blocked and controls as not started.

This path is realistic. It is the fail-closed response to precisely the ingestion/high-water/attribution faults the cross-realm authority is designed to detect; it is not dependent on production Viewer behavior. The completed records do **not** already exist in Node: Node has the gate and any successfully ingested ordinal/provenance/operation facts, while the check/control result values remain only in page memory until the RPC returns a run payload.

The loss violates the accepted truthful-history contract. Procedure §8 states that a post-C1 failure keeps every check/control record already produced. A terminal FAIL is necessary but not sufficient: a schema-valid R1 that states executed work was blocked/not-started is false evidence.

**Minimum correction:** add a bounded Node-authoritative completed-result transfer that happens before, or atomically with, the attribution-clear acknowledgement. The transport-failure branch must be able to reconstruct the retained completed prefix without depending on a later cleanup-entry fence. This requires harness/live-transfer changes plus a bounded procedure reconciliation specifying the transfer, validation, ordinal remapping and failure behavior. It requires no production, Core, Adapter, Panel, OQ-1 or host change. Add an end-to-end real-page/Node test in which a driver returns completed same-phase results, the clear fence refuses, cleanup entry also refuses, and committed R1/R2/R3/K plus the reader retain those results while returning FAIL.

### Low findings introduced or exposed by the ordering change

#### L1 — a mid-merge exception can omit later returned units

The check/control merge loops are not transactional. An unexpected exception while reading or validating one returned record can leave earlier records merged and later records absent. For the harness's own plain, validated driver outputs this is an internal-defect path, and FAIL remains unavoidable. Non-blocking hardening: build a fully validated local batch, then publish it to the partial maps atomically.

#### L2 — a fence throw skips phase taint/baseline finalization

`got.tainted` and `assertPhaseBaseline()` run after the fence. A fence failure therefore leaves the page partial's `sessionTainted`/`taintPhase` without the phase's final taint result. Node still marks a transferred or transport-failed run tainted and commits FAIL, so this is evidence-detail degradation rather than a false-PASS path.

#### L3 — terminal ordinals inherit the driver's last attribution

Control terminal ordinals are allocated before attribution is cleared, so multiple returned control terminals can carry the last driver attribution rather than an item-specific terminal attribution. Existing sequence/history checks remain fail-safe. This is non-blocking provenance hardening.

### Carried independent-review Lows

#### L4 — `post-c1-untransferred` gate facts lack an independent R1 gate anchor

The explicit stage plus Node-derived `gateSeq`/`gateOutcome` distinguish the state from pre-C1 and the reader returns FAIL. Audit corroboration remains weaker because `R1.gates` is null.

#### L5 — null operation id prevents full ledger correlation

An operation-shaped failure without an operation id cannot be cross-correlated to a specific operation-ledger entry. It remains FAIL and does not create a PASS path.

#### L6 — artifact hashes prove consistency, not hostile-source authenticity

R3/K and the reader prove consistency under the accepted local trusted-filesystem model, not authenticity against coordinated tampering. The current correction does not change that trust boundary.

## Requested verification

### 1. Completed-result persistence ordering

The runner-level ordering is correct and the four requested cases are covered:

- `C2` completed, fence fails: retained in `partialSink`;
- `C2+C3` completed, fence fails: both retained;
- `N1` completed, fence fails: executed state and terminal sequence retained;
- mixed checks/controls/extras completed, fence fails: all retained.

The direct ordering High is closed **inside `runChecksInPhaseOrder()`**. The durable end-to-end High remains open through H1.

### 2. Cleanup-entry refusal / live-transfer path

**Disposition: blocking High before checkpoint.** It is realistically reachable; Node does not already own the completed result values; the loss occurs when `g2EnterCleanupAfterFailure()` rethrows before `g2RunPhases()` can return the partial payload. Fixing it requires harness/live-transfer changes and a bounded procedure correction, but no production change.

### 3. R1 / R2 / R3 / K / reader

When the failure transfer reaches Node, failed-run R1 is schema-valid, R2 renders the retained history, R3 hashes R1/R2, K commits terminal FAIL, and the reader reconstructs FAIL while preserving the completed prefix.

When cleanup entry refuses, the same artifact chain can still be schema-valid and the reader still reconstructs FAIL, but the completed prefix is absent. Artifact validity and verdict safety therefore remain intact; truthful history does not.

### 4. Procedure wording

The new “whenever the page's partial-history transfer reaches Node” limitation accurately describes the current harness but is not sufficient. It conflicts with the still-normative §8 statement that a post-C1 failure keeps every already-produced check/control record, and it turns the accepted truthful-history requirement into a best-effort guarantee without an owner decision. The procedure is internally inconsistent until the transfer is fixed or the owner explicitly changes the evidence contract. Merely recording the limitation does not close H1.

### 5. Other findings

The three newly recorded Lows remain non-blocking individually. The three Lows from the prior independent review are unaffected and remain carried. None excuses the H1 loss.

### 6. Procedure SHA

The current procedure digest is exactly:

`7f68188940da7e9786acaab6802d82fd455f527bc684e8bfaf2676096df06d4c`

Earlier digests are stale for these bytes. This digest is **not ready for owner acceptance** because H1 requires another bounded procedure/harness revision and therefore a new digest.

### 7. Verification

- Focused G2: **786/786 PASS**.
- Aggregate offline: **5,032 total / 5,031 PASS / 0 FAIL / 1 existing TODO**.
- Real Playwright binding: **8/8 PASS**.
- `git diff --check`: clean.

The 13 new result-retention tests are meaningful runner-level and mutation coverage. They do not combine completed same-phase results with a real page-to-Node clear-fence refusal plus cleanup-entry refusal and durable closeout; that missing end-to-end case is part of H1.

Repository state remains `main == origin/main == c0f877aee82c078564efdb504bcbe695522b4ed4`; the tree is dirty and uncommitted. `G2_DUAL_COUNTER_GATE.resolved=true`; `LIVE_PATH_WIRED=false`. No live G2 attempt/evidence or authorization record exists. No production/Core/Adapter/M4/Panel/OQ-1/host/G3/H1-milestone/H2-milestone scope was introduced.

## Readiness and authorization

- **Original completed-history High fully closed:** no; the runner half is closed, the durable transfer half is not.
- **Procedure ready for acceptance:** no.
- **Provisional SHA ready for owner acceptance:** no.
- **Tree ready for checkpoint commit:** no.
- **Live planning ready:** no.

## Exact next action

Obtain explicit owner authorization for a bounded procedure/harness/test correction that makes completed phase results Node-authoritative before a clear-fence refusal can prevent cleanup-entry/final transfer, followed by a targeted independent re-review. Commit, push, live activation, authorization-record issuance and live G2 remain unauthorized.
