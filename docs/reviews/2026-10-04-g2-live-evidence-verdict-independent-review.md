# G2 exactly-one live execution — independent evidence and verdict review

Reviewer: ChatGPT Work. Review date: 2026-10-04. This review was derived independently from the repository, the retained R1/R2/R3/reservation/journal/K artifacts, the raw operator log, the accepted procedure, and the committed harness. The earlier Claude review at this path was treated as a claim, not proof.

No live command was run. No harness, test, procedure, production file, authorization record, or retained live artifact was modified. Only this review and `docs/handoffs/latest.md` were updated.

## Verdict

- **Authoritative terminal verdict:** `FAIL` under procedure row 3.
- **Independent reader result:** `FAIL`, witness `W-6`, journal class `CLOSEOUT_STARTED(commit-present)`.
- **Schema/result recomputation:** R1 passes `validateResultSchema(..., 'payload')`; `computeOverall(R1, 'pre-closeout')` returns row 3 with `check-fail:C3` and `check-fail:C8`.
- **G2 disposition:** the consumed attempt is durably closed as FAIL. It does not establish G2 acceptance. No retry or replacement authorization is authorized.

## Findings

| ID | Severity | Finding | Disposition |
|---|---|---|---|
| H1 | **High** | **C3 is a harness/oracle defect.** `evaluateC3` compares dispatched intent values with the identifier names `'PANEL_SHOWN'` and `'PANEL_HIDDEN'`, while the committed application exports the values `'panel/shown'` and `'panel/hidden'`. A correct production dispatch therefore fails the repetition clause. | Blocks accepting C3 and G2. Before any future-run decision, correct and independently re-review the bounded C3 oracle/tests; retain per-repetition dispatch values in durable evidence. The same literal-name comparison in C2 `domainWrites` should be included in that bounded review. |
| H2 | **High** | **C8 recorded a material oracle failure, but its cause is unresolved.** A:dbId 104 was measured with all eight candidate-box corners outside the frustum; worst excess was `5.858358023546797` against `epsilon=1e-4`. The bounds themselves exactly match the retained fragment-list reference. R1 does not retain C8's settled camera matrix or enough transition-attribution evidence to distinguish Viewer/ViewerBridge behavior from a timing/state-stabilization or observation defect. | Blocks C8 and G2 acceptance. The evidence supports neither “product defect” nor “stale camera” as a fact. A future-run decision first needs a bounded diagnostic/remediation proposal that makes the C8 camera and transition provenance independently auditable, followed by review. |
| M1 | **Medium** | **C6 remains unevidenced because N2 did not discriminate.** The positive C6 predicate passed (`worstExcess=-0.540675686826625`), but the single-side N2 fit also framed the same union (`worstExcess=-0.09999997577575592`), so the required negative control failed to distinguish the aggregate behavior. | Correctly maps to `NOT_EVIDENCED`, not PASS or FAIL. This is an evidence/control-design or fixture-target-selection gap; the retained data does not identify which. It independently prevents a G2 PASS even if H1/H2 were removed. |
| M2 | **Medium** | **The owner clean-window checklist was not followed literally.** The execution prompt itself was an additional untracked `docs/prompts/` file, although the owner prompt listed only the final record, two historical records, and the issuance prompt and said to stop on any unexpected file. | Governance/process nonconformance. It did not alter bound code, become an authorization candidate, or corrupt evidence, so it does not change the technical verdict or attempt consumption. It cannot be retroactively cured; owner disposition should be recorded. |
| L1 | **Low** | **C20 is derivative of C8.** It never started, is `BLOCKED(dependency:C8)`, and N8 is `NOT_APPLICABLE` with `started:false`. | Correct and non-independent. No separate product finding. |
| L2 | **Low** | **The complete authoritative artifacts are currently git-ignored and the operator log is under `/private/tmp`.** | Does not invalidate the present reader result, but durable project closeout should copy the immutable artifacts to a tracked evidence location only under separate authorization. |

No Critical finding.

## 1. Repository and binding state

- Repository: `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`.
- Branch/HEAD: `main` at `75a3ccb9ba160f8afcf3c9b39a301f352b273c08`; `origin/main` matches.
- Committed harness SHA-256: `471fae40d371c292f05d92bbdafdbdaa426a0426af0924a6e0946ac69fe77ac4`.
- Accepted procedure SHA-256: `d1ccfde224b8ae76fe74b06c93abc532e6df9612933cafaa045053c8e2e45a75`.
- Final authorization record: `g2-live-20261004-75a3ccb9`, SHA-256 `f68436dfbab09ad32a2ba248cf6ab63ce652b5615e82f8232f77aae9409c33c6`.
- Attempt ID: `59b8713d-1e63-4df8-b641-ac6b830f3ea6`.

The R1 bindings match the reservation and journal: baseline HEAD, harness, procedure, fixture names/URN hashes, Viewer runtime request, and authorization record identity are consistent.

## 2. Attempt lifecycle

The durable sequence is complete and internally ordered:

1. `AUTH_BOUND` at `2026-10-04T03:28:57.547Z`.
2. Phase-0/runtime checks completed without a `PREFLIGHT_FAILED` transition; script integrity is `VERIFIED`, and the git-tree classifier retained zero blocking paths.
3. `ATTEMPT_CONSUMED` at `03:29:00.172Z`.
4. Model A load began at `03:29:00.181Z`, 9 ms after consumption; model B began at `03:29:05.710Z`. Both completed `ready`, were present in `getAllModels()`, and classified `CONFIRMED_SVF2`.
5. P1–P11 ran, followed by cleanup and evidence closeout. `CLOSEOUT_STARTED` was journaled at `03:29:15.718Z`; K was committed at `03:29:15.913Z`.

The raw operator log records `primaryOverall: FAIL (row 3)`, `finalOverall: FAIL`, successful post-commit unlink/fsync/read-back, and `exit code: 1`. Exit code 1 is log evidence rather than an authoritative verdict input; K and the reader are authoritative.

No lifecycle stage is contradictory. Phase-0 success and the process exit code are reconstructed from the durable state plus the operator log rather than from a dedicated Phase-0 or exit-code artifact.

## 3. Single-attempt and authorization integrity

- The attempts directory contains exactly one reservation, one journal, and one commit, all for the same authorization ID and attempt UUID. No closeout-failure record, second attempt directory, reset, or replacement record exists.
- The raw log contains one runtime-preflight block and one terminal closeout block. Disk evidence therefore supports one consumed live attempt and no retry.
- Absolute process-invocation count cannot be proven from repository artifacts alone because a hypothetical process that terminated before reservation would leave no durable attempt record. No such invocation is evidenced.
- The final record was the sole active candidate. Records `g2-live-20261004-8a8d49f6` and `g2-live-20261004-dbd97137` are retained as superseded candidates. No alternate candidate was selected or reused.

The final record is spent by the durable reservation/journal. A new attempt would require a new owner decision and a new authorization record; neither exists.

## 4. C1–C20 and N1–N8

All 20 check entries and all 8 control entries exist. R1 schema validation succeeds, the global C1 gate is `OPEN`, and no synthetic gate-disposition record is expected.

- **PASS (16):** C1, C2, C4, C5, C7, C9–C19.
- **FAIL (2):** C3 `repetitions`; C8 `element-outside-frustum`.
- **NOT_EVIDENCED (1):** C6 `n2-not-discriminating`.
- **BLOCKED (1):** C20 `dependency:C8`.
- **Controls:** N1/N6 `DETECTED`; N3/N4/N5/N7 `DETECTED_RESTORED`; N2 `NOT_DISCRIMINATING`; N8 `NOT_APPLICABLE`.

Dependencies and phase ordering are coherent. No cyclic dependency artifact appears. N8 correctly does not depend on C20. No otherwise unexpected PASS lacked the fields/ledger evidence required by its committed evaluator and the schema validator.

## 5. Non-PASS adjudication

### C3 — FAIL (`repetitions`)

Observed facts:

- `repetitionsObserved=3`; dispose and residue clauses are true.
- The P3 spy ledger records exactly three main show/hide pairs: sequences 203/204, 205/206, and 207/208, with one `DockingPanel.prototype.setVisible(true)` and one `setVisible(false)` per pair.
- The close-button observation routed through `setVisible(false)` and retained dispatch value `panel/hidden`.
- Production `ClashDockingPanel` dispatches `INTENT.PANEL_SHOWN`/`INTENT.PANEL_HIDDEN`; their actual values are `panel/shown`/`panel/hidden`.
- The harness instead requires literal strings `PANEL_SHOWN`/`PANEL_HIDDEN`.

Thus the recorded harness FAIL matches its implemented oracle, but the oracle contradicts the actual public intent values. The durable result omits the three per-repetition dispatch arrays, so their exact contents cannot be re-read from R1; the static mismatch nonetheless proves that correct production values cannot satisfy the harness condition. Ownership: harness/oracle defect, not fixture or product behavior.

### C8 — FAIL (`element-outside-frustum`)

Observed facts:

- Target: model A, dbId 104, one fragment.
- Candidate/reference box: `[-25.502992630004883, 46.41398620605469, -0.3333333432674408, -24.502992630004883, 47.41398620605469, 0.3333333432674408]`; C4 retained exact candidate/reference equality.
- All eight projected corners have positive `w=1` but lie outside the accepted frustum. The largest recorded excess is `5.858358023546797`; T16 permits `1e-4`. The exceedance is about 58,584 times the tolerance and is not numerical margin.
- The committed evaluator used the specified world-space candidate box and clip-space predicate. It observed the documented per-model `fitToView([104], modelA)` form without a throw.
- R1 retains the C8 corners but not its settled `cameraK`, pre-call camera, transition-completion event, or sample history.

Therefore C8 correctly FAILs the frozen oracle on the captured observation. The evidence is insufficient to decide whether the cause is Viewer/ViewerBridge framing, camera transition timing/state stabilization, or another observation defect. The previous claim that C8's camera was proven to equal N2's camera is not supportable from R1 because neither C8 nor N2 retains the required camera matrix.

### C6 — NOT_EVIDENCED (`n2-not-discriminating`)

C6 selected A:135/B:111 and the aggregate positive observation passed the frustum predicate after settling (`worstExcess=-0.540675686826625`). N2 reset the view, fitted B:111 alone, settled, restored, and still passed the union predicate (`worstExcess=-0.09999997577575592`). Under the procedure, a non-discriminating N2 prevents the positive observation from proving aggregate-union framing. `NOT_EVIDENCED` is exactly correct. The record does not retain enough separate target/camera evidence to distinguish a fixture/target-selection limitation from a settle/control-design limitation.

### C20 — BLOCKED (`dependency:C8`)

C20 did not start; top-level `c20` is null. N8 has `started:false`, `NOT_APPLICABLE`, and reason `phase-checks-not-runnable:P6b`. Blocking before rendering interpretation is safe and matches the dependency rule. C20 carries no independent defect.

## 6. Network, fatal, and cleanup ledgers

The empty failure ledgers are supported rather than missing:

- `requestObservations=80` and `prefixSourceLedger=56` demonstrate active request instrumentation during both load windows.
- `requestFailures=[]`, `responseFailures=[]`, `correlatedRequests=[]`, and `fatalWitnesses=[]`; all retained load-window responses are successful and the witness/count equations close at zero.
- `fatalCount=0`, no page/runtime fatal entry, `sessionTainted=false`, `phaseRunFailure=null`, and `staleContinuationsDropped=0`.
- Viewer script capture returned one attributable 200 response with the expected decoded-byte SHA-256 and `Autodesk.Viewing` present.

All 17 cleanup steps are `ran`. `cleanupFailures=[]`, `cleanupUnresolvedOwnership=false`, bridge/foreign-scene ownership clauses are all true, isolation and hidden-node baselines were restored, models were unloaded/absent, and page/context/browser teardown operations settled. Clean cleanup is compatible with row-3 FAIL: it prevents rows 1–2 but cannot erase check FAILs.

## 7. Evidence and reader verification

Authoritative artifacts are present:

- reservation, journal, and K for `g2-live-20261004-75a3ccb9`;
- R1 `clashpanel-viewerbridge-g2-result.json`;
- R2 `clashpanel-viewerbridge-g2-summary.md`;
- R3 `clashpanel-viewerbridge-g2-closeout.json`;
- raw operator log `/private/tmp/claude-501/g2/g2-live.log` (non-authoritative).

Recomputed hashes match:

- R1: `4204e2d36c9053db8e6601952bc79b27bbf903998637b81bde6bc8dcf2e42148`.
- R2: `5282f01c82c404cf8e39cf68fbf55288bac8509fb6b9adf6fb499f68d71d0da4`.
- R3: `8de72bb0c6cf5883ad5bdd96ffe06a0d8c4c6fd769ee8984865c412a804728f0`.
- Journal: `0486d39547a9854c849ebb13b014bf3c286ef9078f0b4ed405efbf87c2bf352c`.

K binds those hashes, the attempt ID, `primaryOverall=FAIL`, `primaryRow=3`, and `finalOverall=FAIL`. R3 says R1 bytes/schema/snapshot and R2 bytes/headings/verdict line all verified. O2 is explicitly optional and absent. The raw log is optional under the procedure.

Evidence is complete for the authoritative verdict. Its current ignored/temporary storage is a durability concern, not a missing-artifact contradiction.

## 8. Independent verdict recomputation

Procedure precedence is:

1. Rows 1–2 do not match: fatal count is zero, cleanup succeeded, and ownership resolved.
2. Row 3 matches because C3 and C8 are check-run FAIL records.
3. Later outcomes cannot weaken it: C20 would contribute BLOCKED at row 6; C6/N2 would contribute PARTIAL at row 7.
4. Closeout is complete and K is valid, so the authoritative reader uses W-6 and returns K's `FAIL`.

`FAIL (row 3)` is correct even though one FAIL is a proven harness defect and the other has unresolved causal ownership. The procedure does not permit post-hoc reinterpretation of a committed check FAIL.

## 9. Extra untracked prompt

The extra file was `docs/prompts/for-claude-g2-exactly-one-live-execution-only.md`. The owner's pre-run list did not include it, so proceeding was a literal checklist violation. The harness's git-tree classifier intentionally allows untracked `docs/prompts/` paths, and the extra file contains no `G2-LIVE-EXECUTION:` marker; it therefore could not become a candidate or change the authorization selection. The bound harness/modules/HEAD remained unchanged.

Disposition: governance/process issue, not execution-identity or evidence-integrity corruption. The attempt remains consumed and the FAIL remains valid. Owner acknowledgement is required for governance closeout; the checklist must not be retrofitted after the fact.

## 10. Future-run and closeout disposition

No retry is authorized or justified from the current state. G2 should be treated as **durably closed as FAIL, with acceptance blocked pending owner direction**.

A future live attempt could be considered only after separately authorized bounded work:

1. Preserve the current evidence immutably if the owner wants durable tracked closeout.
2. Correct and independently re-review the C3/C2 literal-value oracle defect and its evidence retention.
3. Decide and review a bounded C8/C6 diagnostic/remediation design that retains camera/transition provenance and establishes a discriminating C6 control without changing the accepted outcome after the fact.
4. Obtain a new owner authorization decision and a new authorization record/ID; the spent record cannot be reused.

G3, H1, H2, OQ-1, host integration, production remediation, and any second live attempt remain unauthorized.

## Recommended next authorized action

Owner decision only: choose whether to (a) close G2 at the committed FAIL, (b) authorize bounded remediation planning for H1/H2/M1, and/or (c) authorize immutable evidence persistence. Do not issue a new record or run again as part of that decision.
