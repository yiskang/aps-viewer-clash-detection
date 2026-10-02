# G2 post-C1 failed-run evidence — independent re-review

**Date:** 2026-10-02  
**Repository:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`  
**Branch / baseline:** `main` @ `c0f877aee82c078564efdb504bcbe695522b4ed4`; `origin/main` is identical  
**Scope:** current uncommitted procedure and dormant harness correction for post-C1 failed-run evidence only  
**Provisional procedure SHA-256:** `01ab35879ba8ce50bcec267b1257a1008ddc1892e012e9961bf5eb1acfa18d0a`

## Verdict

**0 Critical / 1 High / 0 Medium / 3 Low.**

The three-way failure model, Node-authoritative gate preservation, failure provenance checks, failed-run artifact chain and reader behavior are materially improved and fail closed. They are not sufficient for acceptance because a realizable same-phase failure can still omit work that actually completed. The internal review's open partial-history-trust Medium is therefore a **High blocking harness/procedure defect**.

The procedure is not ready for owner acceptance. The provisional SHA is exact but is not ready for owner acceptance. The tree is not ready for checkpoint commit or live planning.

## Findings

### High H1 — a post-driver attribution-fence failure loses completed same-phase history

**Classification:** harness/procedure correctness defect; blocks truthful failed-run closeout and live planning.

`runChecksInPhaseOrder()` does not publish a successful driver's returned records into its runner-owned `units` / `controls` maps immediately. Its current sequence is:

1. await the phase driver;
2. await `setAttr({ activeCheck:null, activeControl:null })`, including the Node acknowledgement fence;
3. validate and merge the returned check/control records.

The partial-history sink reads only the runner-owned maps. If step 2 refuses or throws after the page driver completed, step 3 never runs. The page has executed the work and returned its record, but post-C1 closeout receives no record and synthesizes it as blocked/not-started.

This is not equivalent to the completed-run trust model: a completed run crosses that fence and returns the merged maps. A failed run at this fence is exactly the case in which the returned page records never enter the trusted partial state.

Two direct offline reproductions against the exported real runner established the failure mode without changing files:

- P3 returned `C2` and `C3` as PASS, then the post-driver attribution fence threw. The partial sink retained only `C1`; both completed checks were absent.
- P2 executed `N1` and returned it as `DETECTED`, then the post-driver attribution fence threw. The partial sink retained no control record, even though `N1` actually ran.

There is no universal Node-visible per-check completion record that reconstructs the omission. Controls have a Node-visible start only after `beginControl`; their terminal record and terminal sequence are created after the vulnerable fence. Existing attributed evidence can reveal some contradictions, but pure computations need emit none. Even when a contradiction is detected, rejecting R1 is not a substitute for the procedure's promised truthful, committed failed-run history.

**Minimum correction:** after a driver resolves, validate and merge its returned check/control/extras records into the runner-owned partial state before awaiting the final attribution-clear fence. Preserve the fence before any later phase starts. Add real-runner negative tests that force this exact post-driver fence failure and prove returned checks and a begun/completed control remain in failed-run R1. If that ordering cannot be made safe, add an explicit Node-observable start/terminal inventory; that is more invasive.

### Low L1 — `post-c1-untransferred` has no independent R1 gate anchor

The state is distinguishable from `pre-c1` through `phaseRunFailure.c1Stage`, `gateSeq`, and `gateOutcome`, and the reader still reconstructs terminal FAIL. Because Node derives those values from its retained authoritative gate, this is reconstructable and fail-safe. The gate facts are not independently repeated in `R1.gates`, so audit corroboration is weaker. This does not block live readiness after H1 is fixed.

### Low L2 — operation provenance is partial when no operation id is available

When an operation reference is present, validation checks the id/type/start sequence against the operation ledger and rejects invalid references. A failure carrying an operation-shaped object with a null id cannot be correlated to a ledger entry. The overall result remains FAIL; this is evidence-detail degradation, not a false-PASS path.

### Low L3 — retained hashes prove consistency, not hostile-source authenticity

R3 and K bind the retained artifacts and the reader validates the chain. Under the accepted local trusted-filesystem model, this is sufficient. It is not an independent authenticity mechanism against coordinated artifact tampering. No new requirement is introduced by this correction.

## Requested verification

### 1. Pre-C1 / post-C1 / post-C1-untransferred

- **Pre-C1:** derived only when Node has no retained authoritative gate. It emits no gate/downstream history and cannot fabricate execution.
- **Post-C1:** requires Node's retained gate to be OPEN plus a structurally valid transferred C1 record matching the authoritative gate. It preserves the gate and whatever valid partial records reached the runner-owned maps.
- **Post-C1-untransferred:** used when Node has a gate but no usable transfer, including every CLOSED gate. It retains `gateSeq`/`gateOutcome` in the failure record and does not fabricate missing execution history.
- A CLOSED gate cannot become `post-c1` because the usability predicate requires `OPEN`.

The model is structurally consistent. H1 prevents the post-C1 branch from always receiving a truthful complete prefix.

### 2. Truthful history preservation

Earlier committed phases preserve their gate, check/control records, terminal states, Node-remapped sequences, markers and root failure. Only missing records are synthesized. H1 shows that “missing record” is not equivalent to “never started”: same-phase driver results can be missing solely because the final attribution-clear fence failed. Therefore the requested truthful-history property is not yet closed.

### 3. Partial-history trust disposition

**Disposition: blocking High.** The omission is realizable in the actual harness and can remove real execution from failed-run R1. The completed-run model is not sufficient justification because it succeeds only after the exact fence whose failure creates this case.

### 4. `phaseRunFailure` provenance

The new cross-validation is sound for the represented data:

- `c1Stage`, `gateSeq`, and `gateOutcome` are checked against Node's authoritative gate;
- `post-c1` requires OPEN and gate/C1 agreement;
- `failureSeq` is ordered after the gate and before later executed terminal/marker history;
- the page failure ordinal is rebound through Node provenance, including phase and active item;
- invalid active-control and operation references fail closed;
- pre-C1 downstream history is prohibited.

H1 is an upstream inventory/persistence defect rather than a defect in these cross-field checks.

### 5. `post-c1-untransferred`

The branch is distinct from pre-C1 and reconstructable through the explicit stage and Node-derived gate facts. Its missing R1 gate anchor is Low, not a correctness blocker, because it cannot become PASS and does not claim fabricated execution.

### 6. R1 / R2 / R3 / K / reader

For a schema-valid represented state:

- R1 is valid failed-run evidence;
- R2 summarizes the retained stage/history;
- R3 hashes the correct retained artifacts;
- K commits terminal FAIL;
- the reader reconstructs FAIL;
- non-null `phaseRunFailure` makes PASS impossible;
- an unexpected closeout abort preserves the root record in F where the best-effort write succeeds, while later failures add detail.

These mechanisms are fail-safe but cannot correct H1's missing execution record.

### 7. `invalid-result`

Classifying a completed RPC with no returned result as `invalid-result` is correct and non-breaking. It improves failure fidelity and remains fail closed.

### 8. Procedure SHA

The current procedure digest is exactly:

`01ab35879ba8ce50bcec267b1257a1008ddc1892e012e9961bf5eb1acfa18d0a`

All earlier procedure digests are stale for the current text. This digest is **not ready for owner acceptance** because H1 requires a bounded procedure/harness correction and a new digest.

### 9. Tests and non-vacuity

- Focused G2: **773/773 PASS**.
- Aggregate offline: **5,019 total / 5,018 PASS / 0 FAIL / 1 existing TODO**.
- Real Playwright binding: **8/8 PASS**.
- `git diff --check`: clean.

The 12 new/updated failed-run cases meaningfully cover the three stages, authoritative-gate agreement, marker/sequence/operation mutations, closeout/reader behavior, and `invalid-result`. They do not exercise failure of the post-driver attribution-clear fence after the same driver returned completed check/control records. That missing mutation is the H1 test gap.

No live G2 attempt/evidence or authorization record exists. `G2_DUAL_COUNTER_GATE.resolved=true`; `LIVE_PATH_WIRED=false`. No production, Core, Adapter, M4, Panel, OQ-1, host-integration, G3, H1-milestone or H2-milestone scope was introduced.

## Readiness and authorization

- **Procedure ready for acceptance:** no.
- **Provisional SHA ready for owner acceptance:** no.
- **Tree ready for checkpoint commit:** no; committing this as accepted would preserve a known truthful-history blocker.
- **Live planning ready:** no.
- **Before live execution:** close H1, independently re-review it, accept the resulting procedure, commit a clean dormant checkpoint, recompute/bind the clean-tree digest, retain the applicable pre-live guards, and obtain a new explicit single-use owner authorization. `LIVE_PATH_WIRED` must remain false until separately authorized.

## Exact next action

Obtain explicit owner authorization for a bounded procedure/harness/test correction that durably publishes a driver's completed records before the post-driver attribution-clear fence can fail, with focused failure-injection coverage, followed by independent re-review. No commit, push, live activation, authorization-record issuance or live G2 is authorized by this review.
