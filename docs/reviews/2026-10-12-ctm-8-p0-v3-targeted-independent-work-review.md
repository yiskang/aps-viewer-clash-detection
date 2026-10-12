# CTM-8 P0-v3 Targeted Independent Work Review

Date: 2026-10-12
Scope: corrected `CTM8-P0-v3` protocol package only (targeted re-review; review-only)
Verdict: **FAIL — P0 REMEDIATION REQUIRED** (0 Critical / 2 High / 2 Medium / 5 Low)

> This file replaces an earlier, uncommitted PASS draft of the same path (found untracked at session start; no git baseline exists). That draft's PASS is **superseded and withdrawn**: it closed H-02 on prose-level source checks and did not detect H-01/H-02 below, which were found by source-level verification in this pass.

## 1. Repository and review boundary (independently verified)

- Repo `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`; branch `main`; HEAD == `origin/main` == `ac5bcb42b00e668442ce3add9764cba96d883309`; ahead/behind `0/0`.
- Tree: ` M docs/handoffs/latest.md` + 13 untracked paths (5 prompts, 4 research, 4 reviews) — all under `docs/`; no untracked/modified path outside `docs/`; `git diff --check` clean.
- CTM-7 closed; Addendum B checkpoint intact (HEAD matches). No CTM-8 harness, generator, seam, instrumentation, evidence directory or calibration exists (`*ctm8*`/`*ctm-8*` files outside docs: none; no `docs/research/evidence/*ctm-8*`).
- Governing: spec gate row `design.md:986` (CTM-8/PD-14; AC-P11 is defined at spec `:724`, not `:986` — Low), plan G-PERF `:4675/:4678`, CTM-8 entry-gate review, prior P0 and P0-v2 Independent Work Reviews.
- Protocol: `docs/research/2026-10-11-ctm-8-rebuild-cost-calibration-protocol.md` (`CTM8-P0-v3`). Upstream input (read-only): `docs/research/2026-10-11-ctm-8-p0-v2-correction-final-report.md`. Prior failed targeted review: `2026-10-11-ctm-8-p0-v2-targeted-independent-work-review.md` (FAIL 0C/2H/1M).
- Method: orchestrator read all primary artifacts; three read-only subagents verified (a) Family M fixture vs source, (b) doc consistency/arithmetic, (c) Family R + cited identifiers/selectors vs source. The two defects rated High were re-checked directly by the reviewer (`controllerHarness.mjs:477-481`; `managerViewModel.js:71,136-141`; `testsManager.js:141-150`). Estimates of build cost are static reasoning, **not measurements** (none permitted).

## 2. Closures that HOLD

- **H-01 (v2) scope / arithmetic — closed.** Recomputed: M 3×4×3=36, R 4×4×3×1=48 → 84/launch, 252 executions; warm 72, cold 12; measured 6,480+540=7,020; warm-ups 1,080; ops 8,100; §4.1 cells column sums to 84; nearest-rank ranks 29/86/43 correct. Old totals (132/396/10,800/1,620/12,420) appear only in explicitly superseded/historical text; SKEWED appears only as optional; `-PULL` optional. No stale-SKEWED-mandatory wording.
- **M-01 (v2) — closed.** §18.1 lists all resolved decisions (UNIFORM-only, SKEWED/-PULL optional, 30 s timeout, cell-local 3-failure abort + `GLOBAL_FAILURE`, headed Family M 5/25/100 × 1/3, unreachable dispositions, public-sentinel-only, no seam); §18.2 leaves one decision.
- **Helper/identifiers:** helper path exists; `setup()` 14–27, `selectAB` 28–31, `confirm` 39; intent constants, VM fields, group-id format, recording-bridge call counting, debounce/cold→warm mechanism, headed selectors, extension handle, capture helper, spec/plan line citations — verified. UNIFORM expected counts (`1.1N` groups, `S*=10`, `W(T1)=N/2+5`, `W(T2)=N/10+9`) recompute exactly for the **harness-name rules as written** (see H-01 for n=3).
- **Family M record semantics verified in source:** toggling `mA` on both sides (n=1) is not rejected or rewritten (`draft.js:83-90`; overlap is not a `buildDefinition` problem); readiness is `setup-complete`; `describeScope` yields `'Architecture'` / `'Structure'` / `'Structure; Mechanical'`; create/open/viewList require no confirm without a run; names are stored verbatim; unique names have no workload side effect.
- **Historical handling:** original P0 report sha256 `4053c28efb8fee30349a9b1b8e303e47f2258465e45fb3fc5ee3c25124dadb99`; remediation report body intact with one-line supersession pointer; prior reviews present. (All untracked — no git baseline; see L-03.)
- **Execution-support boundary (§17) and protected boundaries (§16):** nothing authorizes harness/generator/instrumentation now; no seam required; no protected item pulled in.

## 3. Findings

### Critical: 0

### High

**H-01 — Family R `n_models=3` element-name mechanism is not executable (§6.2).**
- Artifact: protocol §6.2 (lines 162, 168) says element names come "via the harness `names` option" with `mC` supplied through `extraModels`.
- Defect (verified `controllerHarness.mjs:477-481`): `names` reaches only `mA`/`mB`; every `extraModels` model is hard-wired to `makeFakeModel(modelKey, dbId => `${modelKey}-${dbId}`)` (the caller-supplied `model` is overwritten). At `n_models=3`, `PAIRS` = `(mA,mB),(mA,mC),(mB,mC)`; two-thirds of results have a `mC` b-element named `mC-<dbId>` with no `Pipe-<i>`/`tagq`/`tagr`.
- Execution-validity impact: §6.2 exact-count assertions (`W(T1)=N/2+5`, `W(T2)=N/10+9`) fail for every `n_models=3` Family R cell (4 scenarios × 4 scale points = 16 cells/launch, 48 executions); P-WARM can never be proven, so R-WARM/R-GROUP-WARM become `UNAVAILABLE` and R-COLD invalid. An execution agent would have to invent a naming mechanism (e.g. mutating `h.extraModels.mC` object-tree) — i.e. invent methodology. `n_models=1/2` unaffected.
- Minimum correction: protocol must state an exact, non-production mechanism that names `mC` elements per the §6.2 rule (e.g. post-construction replacement of `mC`'s fake object-tree `getNodeName` in the support code, or any equivalent frozen choice), and extend the per-cell manifest/count assertion to cover it.
- Blocker: **YES**. Responsible: CTM-8 P0 protocol package owner.

**H-02 — Family M Step 0 "subscriber before step 1" makes the fixture build infeasible at mandatory N=5,000 / 10,000 (§6.1, §5.1).**
- Artifact: §6.1 Step 0 (subscriber registered before the build), Step 4 (120,000 ms setup timeout), §5.1 common state.
- Defect (verified code path; cost is static estimate): with a subscriber, every manager `changed()` rebuilds the full ManagerViewModel (`testsManager.js:141-150`); each row calls `actionGate` four times (`managerViewModel.js:136-141`), each doing a linear `s.records.find(...)` (`:71`) ⇒ O(N²) per VM build. ≈9–12 VM builds per record during construction (create → request/execute/editor/finally/soft-reevaluation touches, name, each toggle) ⇒ O(N³) overall. Subagent estimate: N=1,000 ≈ 15–35 s (ok); N=5,000 tens of minutes; N=10,000 hours — far beyond the 120 s setup timeout.
- Execution-validity impact: all Family M cells at N=5,000 and 10,000 (up to 18 of 36 cells/launch; 54 of 108 executions) are predicted to end `NOT EXECUTED — setup timeout`, systematically removing the mandatory upper scale points — the opposite of the campaign's purpose (knee/scaling), without any owner decision to accept that. The protocol's disposition rule does not make this valid; it hides a design defect.
- Minimum correction: freeze an executable build that is feasible, e.g. register the no-op subscriber **after** Step 3 and **before** warm-up (this is what §7.2 already requires), read the VM/`vm.confirm` only once at Step 3 (not per step), and state expected feasible build duration/timeout handling; any alternative must preserve public-surface construction. If the build still cannot fit at 10,000, that is an **owner decision** (setup timeout / reduced top point), not an execution-agent choice.
- Blocker: **YES**. Responsible: CTM-8 P0 protocol package owner.

### Medium

**M-01 — M-BASE timed-window boundary is under-specified (§5.1).** Source reading (subagent; not re-verified by reviewer, rate PLAUSIBLE): `catalog.fire()` reaches the controller's catalog listener first (stale manager cache → full VM build), then the manager's (epoch bump → second build), and the controller also starts a forced async soft re-evaluation whose trailing `touch` (a third full build) may land inside or after `t1` depending on `n` (single-key short-circuit vs `readBasisVerdict`). The protocol states neither a quiescence step before `t0`/after reset nor whether the trailing build is in-window. Impact: n-dependent, run-order-dependent measured work. Correction: add explicit pre-`t0`/post-reset settle and state the in-window set. Blocker: yes for M-BASE definition (fix together with H-02). Responsible: protocol owner.

**M-02 — Family M cost attribution and `n_models` meaning need correction and owner visibility (§6.1 line 158, §5.1 line 94, §15).** Verified in source: with no run, no record has a summary, so `modelsChangedOf` returns `false` immediately (`testReadiness.js:44-45`) — §6.1's claim that per-test-record `modelsChangedOf` "scale[s] with `n`" is false. Measured M-REC/M-BASE cost is dominated by the O(N²) `buildManagerViewModel` `actionGate` scan, not by "the full `derivedOf` recompute"; `derivedOf`/`readinessOf` constants grow only slightly with `n`. Consequence: `n_models` (1/2/3 referenced models) is semantically correct but a **weak cost dimension** for Family M, and catalog size is 2/2/3. This does not invalidate comparison, but it changes what the model axis can show, so the owner should be told: **OWNER VISIBILITY (not a blocker by itself)** — keep as-is with corrected wording, or add the owner-listed optional "larger catalog" variant (§4.3). Correction: fix the incorrect statements; state the actual dominant cost source so §15 interpretation cannot misattribute it. Responsible: protocol owner.

### Low

- **L-01** Final 1M+2L internal findings not durably recorded (claim in the review prompt only); correction report line 47 says verification results are recorded "in the final chat summary; results below" but none appear below — chat more authoritative than repo (CLAUDE.md). Responsible: v2-correction package owner (backfill durable internal-review record; do not edit by Work).
- **L-02** Executability details unstated: `setup()` is a non-exported function inside a `node:test` file (must be copied, not imported); support `until(scheduler, predicate, maxRounds)` is round-bounded — the 30 s wall-clock timeout needs its own wrapper; `m.do`'s `settle(30)` adds fixed per-intent overhead to build time.
- **L-03** Prior draft's claim "byte-identical to the previously recorded hash" was unverifiable (no earlier hash record, untracked). Current sha256 recorded in §2 above as the baseline from now on.
- **L-04** Wording: §9.3 HM-REC says "`n_models` models loaded" (should say models referenced per test-record); §6.2/§7.3 "name-only" match is imprecise (filter uses model display name + element name + dbId; tagq/tagr construction still makes W(T) valid).
- **L-05** Spec citation "(:986, PD-14, AC-P11)": AC-P11 is at spec `:724`.

## 4. Readiness and gate

- Blockers: **H-01, H-02** (and M-01 definition fix). Protocol cannot be executed without inventing methodology (mC naming; feasible Family M build).
- Not PASS: Family M build feasibility and Family R `n=3` fixture are not executable as written.
- Unresolved owner decisions: none new *required*; **if** a feasible Family M build still cannot reach N=10,000 within the setup timeout after correction, an owner decision on setup timeout/top point arises. Owner visibility item: M-02. The decision whether to authorize CTM-8 execution/support-code **remains not decidable** until a clean re-review.
- Deferred/protected (unchanged): Addendum B L1/L2; CTM-7 L1–L8; O-1…O-4; hide/departure; navScope; GP-F1; Core/collision/Viewer Adapter/host; Viewer theming/selection; persistence/history; public limits/budgets.

**Exact next authorized action:** **awaiting owner authorization** for a bounded docs-only correction of the protocol (→ `CTM8-P0-v4`) addressing H-01, H-02, M-01, M-02 (+ Low items), followed by another targeted Independent Work re-review. Work did not remediate anything.

**Must not begin:** CTM-8 execution/support-code package, harness/generator/instrumentation/seam, calibration or headed runs, evidence generation, spec/plan/production/test edits, commit/push, any other CTM-8 package.
