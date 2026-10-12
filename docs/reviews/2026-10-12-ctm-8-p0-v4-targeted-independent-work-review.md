# CTM-8 P0-v4 Targeted Independent Work Review

Date: 2026-10-12  
Scope: corrected `CTM8-P0-v4` protocol package only  
Verdict: **PASS — READY FOR OWNER CTM-8 EXECUTION DECISION**  
Findings: **0 Critical / 0 High / 0 Medium / 5 Low**

## 1. Repository and review boundary

- Repository: `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`.
- Branch: `main`.
- HEAD: `ac5bcb42b00e668442ce3add9764cba96d883309`.
- `origin/main`: `ac5bcb42b00e668442ce3add9764cba96d883309`; ahead/behind `0/0`.
- Pre-review tree: modified `docs/handoffs/latest.md` plus the untracked CTM-8 prompts, research reports/protocol and prior reviews listed by `git status --short`; every changed/untracked path was under `docs/`. `git diff --check` passed.
- CTM-7 remains closed and the Addendum B checkpoint remains the shared HEAD. No CTM-8 harness, fixture generator, observation seam, runtime instrumentation, support code or CTM-8 execution evidence exists outside the documents-only package. The similarly named `pre-ctm8` headed artifacts are Addendum B history, not CTM-8 calibration evidence.
- Governing sources checked: Viewer Clash Panel design gate CTM-8/PD-14 and AC-P11; Clash Tests Manager implementation-plan G-PERF/CTM-8; `CLAUDE.md`; the current handoff.
- Primary protocol: [`docs/research/2026-10-11-ctm-8-rebuild-cost-calibration-protocol.md`](../research/2026-10-11-ctm-8-rebuild-cost-calibration-protocol.md), version `CTM8-P0-v4`, SHA-256 `a6f7a61f1cae8b2aac7868277b67c26422537f88af3c27d908cbd054fc2634c3`.
- Upstream input, preserved read-only: [`docs/research/2026-10-12-ctm-8-p0-v4-correction-final-report.md`](../research/2026-10-12-ctm-8-p0-v4-correction-final-report.md).
- Prior authority: [`docs/reviews/2026-10-12-ctm-8-p0-v3-targeted-independent-work-review.md`](2026-10-12-ctm-8-p0-v3-targeted-independent-work-review.md), FAIL — 0 Critical / 2 High / 2 Medium / 5 Low.
- Verification was review-only. No calibration or proposed implementation test was run.

## 2. Targeted remediation adjudication

### H1 — Family R three-model naming/count contract: closed

The pure `NAME(modelKey, dbId)` rule is deterministic and complete for all three models. Source verification confirms:

- `makeHarness` applies `names.mA` and `names.mB`, creates every extra model as one mutable fake Model object, and places that same object in `h.extraModels`, the catalog and the engine binding.
- The specified immediate replacement of `h.extraModels.mC.getObjectTree` therefore changes the object actually resolved for `mC`; `makeFakeModel` exposes `getObjectTree` as a writable plain property.
- `labels.js` calls `model.getObjectTree().getNodeName(dbId)` at label-read/index-warm time. No element-name value is captured when the harness/controller is constructed. Installation before dispatch, sealing, label reads and manifest hashing prevents stale cache or lifecycle effects.
- The per-cell pre-timing proof checks object identity, every distinct generated reference against `NAME`, exact first-VM counts, and both P-WARM reference lists. This makes a wrong or incomplete `mC` mapping fail as `INVALID_SETUP` before measurement.
- Warm/cold public sentinels use the resulting label index and remain valid for `mC`; no private-state seam or production change is needed.

The later support-code task is fully bounded to a new non-production calibration fixture/helper plus the exact proof. The mandatory three-model Family R matrix is executable without a methodology choice.

### H2 — Family M subscriber placement: closed

The executable sequence is now fixed: build all records with no calibration/user subscriber; perform the Step 3 predicates and untimed settle; attach the no-op counting subscriber; perform the Step 3c settle/cache/notification-stability proof; then warm up and measure; dispose in `unsubscribe → manager.dispose → controller.dispose` order.

Source verification confirms manager `changed()` eagerly calls `viewModelOf()` only when `m.subscribers.size > 0`. The manager's required internal editor/catalog/bridge listeners still exist during construction, but with no calibration/user subscriber they invalidate state without triggering the repeated full manager ViewModel builds that caused H2. All three measured Family M scenarios run after subscription, so their intended subscribed rebuild path is preserved. The text makes no measured feasibility or complexity claim; the earlier risk remains correctly identified as static source reading only.

### M1 — M-BASE boundary: closed

The timed operation is exact and synchronous: the reversible catalog replacement is prepared outside the window; `t0` immediately precedes `catalog.fire()`; the controller listener, manager listener, their synchronous notifications/subscribed rebuilds, the final `manager.getViewModel()` and predicate all complete before `t1`; there is no `await` in the window.

This matches the current sources: the fake catalog iterates listeners synchronously in registration order; controller registration precedes manager registration; controller `revalidate(...reEvaluateSoft:true)` starts an asynchronous continuation but returns synchronously; manager catalog invalidation increments its epoch and calls `changed()` synchronously. The continuation cannot run before `t1`. The protocol records in-window and post-window notification counts separately, and its untimed reset plus double-settle stability check prevents carry-over into the next sample. The result measures the synchronous subscribed manager rebuild path, not catalog-dispatch overhead alone.

### M2 — Family M model-axis framing: closed

`n_models` is consistently the number of models referenced by every test record, while catalog cardinality is separately retained as 2/2/3. The protocol no longer predicts a direction or meaningful slope. It explicitly records that no run summary exists, the model-change check short-circuits, and static inspection only suggests record count may dominate. Whether 1/2/3 has a material effect remains an empirical question.

## 3. Family M 5,000/10,000 setup feasibility

The unmeasured setup feasibility does **not** block P0 readiness:

- The protocol separately fixes the untimed setup/reset safety bound at 120,000 ms and the timed-sample bound at 30,000 ms.
- For initial cell construction, §4.1 and §6.1 Step 4 govern together: a build exceeding 120 seconds is retained as an `INVALID_SETUP` setup failure and the mandatory cell is recorded `NOT EXECUTED — setup timeout`, never omitted. It is unavailable evidence, not failed product performance.
- The cell-local rule permits the rest of Family M and the campaign to continue; only a true shared harness/runtime defect is `GLOBAL_FAILURE`. Setup-reset failures after sampling begins follow the separate three-consecutive-failure cell-abort rule.
- No preflight probe is required. The authorized execution package can discover 5,000/10,000 feasibility empirically under the fixed timeout without changing the matrix or interpreting the timeout as a product limit.
- If upper cells prove unavailable, the execution report must preserve that outcome and the next owner gate decides whether any later refinement is warranted. That future decision is not a prerequisite to executing the accepted protocol.

No new `SETUP_UNREACHABLE` enum or owner decision is required before execution authorization.

## 4. Arithmetic, precision and boundaries

Independent recomputation:

- Family M: `3 × 4 × 3 = 36` cells/launch.
- Family R: `4 × 4 × 3 × 1 = 48` cells/launch.
- Total: 84 cells/launch; 252 cell executions over three launches.
- Warm measured: `72 × 30 × 3 = 6,480`; cold measured: `12 × 15 × 3 = 540`; measured total 7,020.
- Warm-ups: `72 × 5 × 3 = 1,080`; total timed-or-warm-up operations 8,100.

The v4 edits do not change these totals. Older 132/396/10,800/1,620/12,420 values occur only in explicitly superseded historical artifacts/handoff sections, not as current protocol requirements.

The protocol is sufficiently precise for a separately authorized execution agent: scenario IDs, fixtures, `mC` name injection, public sentinels, subscriber timing, M-BASE/M-REC/M-HIT windows, selected-group comparator, repetition/order rules, setup/sample timeouts, failure classification, statistics, environment capture, evidence schema, headed reachability and interpretation safeguards are all fixed. No production observation hook or production edit is required.

## 5. Findings

### Critical: 0

### High: 0

### Medium: 0

### Low: 5 (deferred; unchanged and non-blocking)

1. The earlier internal 1M+2L trace is not durably complete and a historical report sentence dangles. This is workflow traceability only; it does not change v4 methodology.
2. The later support package must copy the non-exported test-local `setup()` pattern and implement a wall-clock timeout wrapper around the round-bounded `until`. These are implementation details already bounded by the protocol, not open methodology.
3. The historical byte-identity claim had no earlier durable hash. The current v4 protocol now has an exact recorded SHA-256 baseline.
4. HM-REC still says “`n_models` models loaded” instead of “referenced per test record”; historical “name-only” wording is also imprecise. Neither changes the executable headless contracts or sentinel arithmetic.
5. The governing citation groups AC-P11 with spec line 986 although AC-P11 is defined near line 724. The referenced rule is nevertheless identifiable and unchanged.

None became worse or contradicts H1/H2/M1/M2. None blocks execution/support-code authorization.

## 6. Upstream report accuracy

The v4 correction final report accurately records the H1/H2/M1/M2 changes, unchanged campaign arithmetic, absence of tests/calibration/support code and the unmeasured upper Family M setup feasibility. Its residual statement that an observed upper-point setup timeout leads to an owner decision is correct as a post-execution next gate; it is not a current prerequisite or a license for the execution package to alter the matrix.

## 7. Readiness, owner decision and protected work

- **Readiness:** `CTM8-P0-v4` is ready for the owner to decide whether to authorize the bounded CTM-8 execution/support-code package.
- **Blocking findings:** none.
- **Current unresolved owner decision:** authorize or decline the §17 package: non-production headless harness, deterministic fixture generator including the exact `mC` step/proof, runtime-injected headed instrumentation, mandatory execution, evidence, and execution final report.
- **Exact next authorized action:** none beyond this review/handoff update. The next gate is the owner's CTM-8 execution decision.
- **Must not begin without explicit owner authorization:** harness/generator/instrumentation/support code; calibration or headed execution; evidence generation; production/test/spec/plan edits; commit/push; a new limit/budget/scalability claim; another CTM-8 package.
- **Protected/deferred and untouched:** Addendum B L1/L2; CTM-7 L1–L8; O-1…O-4; hide/departure; neighboring navScope; GP-F1; Core/collision/Viewer Adapter/host; Viewer theming/selection; persistence/history.

## 8. Verification record

- Repository identity, branch, HEAD, origin and ahead/behind verified from Git.
- Complete changed/untracked path inventory checked; docs-only.
- `git diff --check`: pass.
- Protocol SHA-256 verified: `a6f7a61f1cae8b2aac7868277b67c26422537f88af3c27d908cbd054fc2634c3`.
- Relevant source paths were verified through the codebase knowledge graph and direct repository reads; graph coverage checks reported no recorded issue and metadata matched the current index for every relied-on source file.
- No calibration, headed run or implementation test was executed.

**Final verdict: PASS — READY FOR OWNER CTM-8 EXECUTION DECISION.**
