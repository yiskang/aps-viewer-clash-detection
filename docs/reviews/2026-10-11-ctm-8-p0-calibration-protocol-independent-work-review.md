# CTM-8 P0 calibration protocol — Independent Work Review

**Date:** 2026-10-11  
**Repository:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`  
**Branch / HEAD / origin:** `main` / `ac5bcb42b00e668442ce3add9764cba96d883309` / `origin/main` at the same commit (`0` ahead / `0` behind)  
**Working tree:** uncommitted and unpushed; P0 is docs-only  
**Verdict:** **FAIL — P0 REMEDIATION REQUIRED**  
**Findings:** 0 Critical / 5 High / 3 Medium / 1 Low

## Scope and governing inputs

This review covers only CTM-8 P0 protocol design:

- [CTM-8 rebuild-cost calibration protocol](../research/2026-10-11-ctm-8-rebuild-cost-calibration-protocol.md), version `CTM8-P0-v1`;
- upstream read-only [P0 package final report](../research/2026-10-11-ctm-8-p0-calibration-protocol-final-report.md);
- [CTM-8 entry-gate Independent Work Review](2026-10-11-ctm-8-entry-gate-independent-work-review.md);
- the CTM-8 gate in [Viewer Clash Panel design §26.13](../superpowers/specs/2026-09-26-viewer-clash-panel-design.md) and G-PERF/CTM-8 in the [Clash Tests Manager implementation plan](../superpowers/plans/2026-10-10-clash-tests-manager-implementation-plan.md);
- the owner P0 authorization and actual manager/results implementation and test-support APIs.

The upstream protocol and final report were preserved unchanged. No calibration, benchmark, headed run, test execution, support-code creation or instrumentation was performed.

## Repository and milestone verification

- The repository is `main == origin/main == ac5bcb42b00e668442ce3add9764cba96d883309`, the expected Addendum B checkpoint; ahead/behind is `0/0`.
- CTM-7 remains closed and Addendum B is preserved in the checkpoint.
- The pre-review tree contains only `docs/handoffs/latest.md` plus five untracked documentation artifacts: the entry/P0 prompts, entry review, P0 protocol and P0 final report. No production or test file is modified or untracked.
- No CTM-8 harness, generator, observation seam, execution evidence or calibration result exists.
- `git diff --check` is clean.

## Architecture and population adjudication

The repository has two genuine, independent scale axes:

- **Family M:** manager *test records*. `testsManager.js:derivedOf` iterates all manager records and performs readiness and model-change work against catalog/binding/model-reference state; `viewModelOf` then builds the manager/editor composite VM.
- **Family R:** active sealed-set *clash-result records*. `controller.js` filters/orders/groups the result index, warms element labels and, when a group is selected, `groupSelectedInput` re-resolves current group membership.

They must never share one unlabeled “records” axis or be pooled. The governing CTM-8 row explicitly names manager ViewModel rebuilds, while the later owner P0 direction additionally requires selected-group and cold/warm-label paths, which exist only in Family R. Both families are therefore technically relevant, but applying the full 4×3 matrix and every auxiliary scenario/profile to both is not implied unambiguously by the governing artifacts. This remains an owner scope decision (M1).

### Smallest viable owner options

1. **Both families, bounded core matrix — recommended.** Run the full 4 record points × 3 model points headlessly for Family M's manager rebuild and Family R's required baseline, selected-group, cold-label and warm-label paths. Treat R-FLAT, R-GROUP-WARM and all `-PULL` variants as optional refinements. Use only reachable, explicitly selected headed corroboration points; no fake population is called real headed evidence.
2. **Manager-primary, representative Results points.** Keep Family M full 4×3 and measure Family R's required paths only at representative small/middle/large points. This is smaller, but weakens the owner-requested R scaling comparison.
3. **Results-only.** Not recommended: it would satisfy the selected/cold/warm direction but fail the original CTM-8 manager rebuild gate.

The review does not make this owner decision.

## Protocol completeness adjudication

The protocol has strong non-goals, raw-evidence retention, environment capture, no-extrapolation rules, separate cold/warm labels, a production-like subscribed topology, corrected debounce timing, natural-GC retention and clear protected boundaries. It is not yet precise enough to execute without inventing methodology because of H1–H5 and M2 below.

### High H1 — cold/warm preparation still requires private controller state

**Artifact/section:** protocol §5, especially “Public-observable predicates only” and “Cold vs warm preparation” (lines 84 and 88).  
**Problem:** §5 correctly forbids reading private `textIndexed`/`labelsPending` and defines a public sentinel-result predicate, but the normative preparation paragraph still says to wait for `textIndexed === true` and no `labelsPending`. Neither field is in the public ViewModel; `filters.busy` also does not represent `labelsPending`.  
**Execution-validity impact:** a conforming public-API harness cannot satisfy the stated precondition. An implementation may start a supposedly warm sample while label warm-up is still active, or add an unauthorized seam. The label-index commit itself has no public notification, so the three R-COLD sub-phases cannot all be timed independently today; only the cold total and observable result transitions are mechanically available.  
**Minimum correction:** replace every private-state predicate with one canonical public sentinel predicate (committed filter, `busy === false`, and exact warm-only ids/count). State that failure to prove it makes R-WARM unavailable. Keep R-COLD total valid; mark the index-commit sub-phase unavailable unless the owner separately authorizes a calibration-only observation seam.  
**Gate:** blocks execution authorization. Responsible upstream package: CTM-8 P0 protocol.

### High H2 — headed actions and stop conditions do not prove the claimed Viewer work completed

**Artifact/section:** protocol §§6–7 and §11 (lines 108, 118–124, 153).  
**Problem:** exact headed steps are deferred to a future execution plan; R-BASE is not explicitly bound to the same sort transition as headless; timing start is ambiguously “Playwright action returns / injected timestamp”; and the stop condition watches the results-region VM/DOM only. Focus, isolation and `presentGroup` mutate Viewer state outside that root and can still be in flight after the results region is quiet. Yet the timing table claims Viewer render/presentation is included.  
**Execution-validity impact:** two runners can measure different operations, and a headed R-GROUP sample can stop before the Viewer mutation it claims to include. Such results cannot corroborate headless selected-group rebuilds or answer Q6.  
**Minimum correction:** specify one exact action/payload and pre/post-state for every headed scenario; take the start timestamp immediately before/in the relevant in-page event; add operation-specific completion predicates for bridge completion and observable fit/isolation/restore state, or explicitly exclude those Viewer actions from timing and retain them as correctness-only checks. Preserve the results-region semantic/quiet predicate for list rendering.  
**Gate:** blocks headed execution authorization. Responsible upstream package: CTM-8 P0 protocol.

### High H3 — Family M rebuild transitions remain non-executable as written

**Artifact/section:** protocol §4 scenario contract and §9b (lines 45–47, 143).  
**Problem:** M-BASE says catalog content “really differs” but does not define the exact reversible catalog mutation. M-REC names a “rename-equivalent” public manager dispatch against record `⌊N/2⌋`, but there is no direct manager rename operation: `SETUP_NAME` is forwarded to the active editor record. The protocol does not establish/open the target record, name the intent/payload pair, define the editor-notification completion predicate, or state whether editor work is intentionally included.  
**Execution-validity impact:** valid harnesses can toggle model names, load state or catalog membership for M-BASE and can mutate different records/work for M-REC. Their curves measure different workloads while sharing scenario IDs.  
**Minimum correction:** freeze one exact reversible catalog mutation for M-BASE. For M-REC, make record `k` active during untimed setup, use exact alternating `INTENT.SETUP_NAME` payloads, define the manager VM/record-identity completion predicate, and state whether forwarded editor work is included. If the goal is manager-only invalidation, define and authorize an appropriate test-only fixture seam instead of pretending one exists publicly.  
**Gate:** blocks headless execution authorization. Responsible upstream package: CTM-8 P0 protocol.

### High H4 — R-GROUP-WARM can stop being a selected-group cost comparator

**Artifact/section:** protocol §4/§5/§11 (lines 52, 90, 153).  
**Problem:** R-GROUP-WARM permits T1/T2 to change selected-group membership if both sizes are merely recorded. A membership change triggers group reconciliation and may schedule `presentGroup`; the public outcome can also cause another VM touch. That is not the same workload as R-WARM and contradicts the statement that bridge presentation is excluded headlessly.  
**Execution-validity impact:** `R-GROUP-WARM − R-WARM` can include membership-change and presentation-scheduling work rather than the intended incremental selected-group VM cost.  
**Minimum correction:** require identical `memberIndexes` across T1/T2 for the primary paired comparator and assert no bridge presentation occurs in the timed window. If changing membership is useful, define it as a separately named, unpaired scenario with its own boundary.  
**Gate:** blocks the selected-group delta claim. Responsible upstream package: CTM-8 P0 protocol.

### High H5 — the protocol still states that 10,000 is an engine retained cap

**Artifact/section:** protocol §18 item 3 (line 184), contradicting corrected §6.  
**Problem:** §6 accurately says 10,000 was one prior run's effective result and the repository default is 100,000, but §18 again says “10,000 is the engine retained cap.”  
**Execution-validity impact:** an owner or execution agent can select fixtures and classify reachability against a false architectural cap. It also proves the original internal engine-cap finding was not fully reconciled everywhere.  
**Minimum correction:** replace the stale cap statement with the §6 rule: 10,000 is an exploratory target; record configured/produced/retained/truncation values; unreachable real headed points are explicit and never forced with fakes.  
**Gate:** blocks protocol acceptance until internally consistent. Responsible upstream package: CTM-8 P0 protocol.

### Medium M1 — “records” scope and mandatory campaign size need owner disposition

**Artifact/section:** protocol §§2, 4, 6 and 18.  
**Problem:** the current mandatory headless campaign is 36 Family-M cells plus 144 Family-R cells (six R scenarios × 12 points × two profiles). With three launches, 30 warm/15 cold measured repetitions and five warm-ups, this is **15,120 measured samples plus 2,340 warm-ups = 17,460 operations**, before optional `-PULL` variants. The headed subset can reach 45 scenario-points before its extra Focus/Isolate checks. The protocol both defines `-PULL` families and asks later whether they are wanted.  
**Impact:** execution scope is not final, and the two different meanings of N can be mistaken for one owner-approved matrix.  
**Minimum correction/decision:** owner selects one option above, explicitly includes or excludes `-PULL`, and confirms 30/15 repetitions with three launches. The protocol then records the resulting exact mandatory cell count.  
**Gate:** blocks execution authorization, not technical protocol remediation in isolation.

### Medium M2 — fixture/statistical parameters still require execution-time invention

**Artifact/section:** protocol §§5, 8–9 and 13 (lines 94, 130, 138–145, 161).  
**Problem:** Family R participant assignment remains “e.g. round-robin,” uniform/skew profiles are qualitative, T1/T2 are approximate 50%/10% selectors, and the per-sample wall-time cap that may reduce repetitions is not set. The p95 estimator and whether pooled versus per-launch p95 is authoritative are also unspecified.  
**Impact:** generator shape and sample retention can differ materially between conforming runners, affecting grouping/de-duplication cost and tail statistics.  
**Minimum correction:** make the generator algorithm, profile parameters and exact expected counts deterministic; set the timeout/cap before authorization; specify one quantile estimator and label per-launch versus pooled summaries. These may live in a separately reviewed harness specification, but must be fixed before any measurement is authorized.  
**Gate:** blocks execution, not P0's protected architecture. Responsible upstream package: P0 remediation or an explicitly separate pre-execution harness specification.

### Medium M3 — the upstream final report overstates internal-review closure

**Artifact/section:** upstream final report “Internal review.”  
**Problem:** it says all 5 Critical and 5 High findings were remediated. H1, H3 and H5 above are direct remnants of the private-state, manager-mutation and 10,000-cap findings. The full internal review exists only in ignored `.codex-worker` state; the repository durably retains only its category summary, so future reviewers cannot audit the exact original text from committed artifacts.  
**Impact:** the package status understates current protocol risk and overstates review convergence.  
**Minimum correction:** preserve the upstream report unchanged under Work ownership rules; the responsible package should correct its status in an authorized remediation final report/addendum and persist the targeted internal re-review that validates the fixes.  
**Gate:** the inaccurate claim does not independently block execution, but H1/H3/H5 do.

### Low L1 — §18 duplicates the support-code decision and has unstable numbering

**Artifact/section:** protocol §18 items 2a and 4.  
**Problem:** both ask whether calibration-only `test/` support code is authorized, and item numbering mixes `2`, `2a`, `3`, `4`, `5`.  
**Impact:** editorial ambiguity only; the authorization boundary elsewhere remains fail-closed.  
**Minimum correction:** collapse to one explicit owner decision separating generator/harness code from an optional observation seam.

## Cold/warm, selected-group and headed reachability dispositions

- **Cold/warm:** reproducible warm classification is feasible through a deliberately constructed name-only sentinel whose cold and warm result sets differ exactly. The protocol must use only that public predicate. The total cold path is observable; the label-index commit timestamp is not. No production seam is required for the minimum campaign.
- **Selected group:** R-BASE/R-GROUP's identical cached-element-group sort transition is sound. R-GROUP-WARM needs H4's identical-membership rule before it can be paired.
- **Headed 10,000:** 10,000 is not an engine cap. Real SVF2 results may or may not reach each target. Headed records must use actual produced/retained counts; synthetic injection invalidates a “real headed” population claim. `NOT REACHABLE HEADED`, nearest reachable explicitly labelled points and headless-only cells are valid dispositions.
- **Manager headed scale:** creating 10,000 tests through the real UI is likely impractical. The protocol should use only owner-approved practical corroboration points and mark the remainder not reachable; it must not seed fake records and call the run real headed evidence.

## Metrics, evidence and safeguards

The chosen 30 warm repetitions support median/min/max and a coarse p95; 15 cold samples do not support per-launch p95, correctly yielding `n/a`, while pooled p95 is possible only if pooling is explicitly labelled and the estimator is fixed. Natural GC retention and annotation are correct. No silent outlier deletion is permitted.

The proposed evidence layout is sufficient: raw JSONL, invalid/excluded samples, deterministic ids/seeds/manifests, commands, environment, anomalies, screenshots/state/console/timing, checksums and an execution final report. Classifier failures, timeouts, unreachable and inconclusive cells remain visible. P0 contains no fabricated measurement evidence.

The interpretation safeguards are sound: no supported maximum, budget, product limit, scalability claim, cold/warm merge or false headless/headed equivalence may be inferred from exploratory measurements.

## Execution-support boundary

The minimum later package requires explicit owner authorization for:

1. calibration-only headless harness and deterministic fixture generator under `test/` or another clearly non-production support path;
2. headed runner/evidence instrumentation injected at runtime without production edits;
3. execution of the accepted mandatory matrix and evidence/report writes.

No production hook is needed for the minimum campaign. A test-only label-index observation seam is required only if the owner insists on an exact index-commit sub-phase rather than accepting that sub-phase as unavailable. Any production observation hook would be a separate design/implementation decision and is not recommended at this stage.

## Internal-review verification limitation

The original internal review's full response is present only in ignored `.codex-worker` state and is not a durable repository review artifact. Its ten category summaries in the final report match the local response, and the current protocol fixes the debounce, R-BASE/R-GROUP comparison, subscription topology, Family-M model dimension, distribution dimension, launch ordering, natural-GC, §6 cap wording and results-region quiet predicate. This review independently verified those changes against source. H1, H2, H3 and H5 show that remediation was incomplete or not integrated consistently.

## Deferred and protected boundaries

P0 does not pull in Addendum B L1/L2, CTM-7 L1–L8, O-1…O-4, the neighboring single-clash navScope issue, GP-F1 polish, UI polish, Core/collision/Viewer Adapter/host work, persistence/history, theming/selection, grouping changes or public performance/resource limits. They remain deferred.

## Readiness and exact next gate

P0 is not ready for calibration execution authorization. Four methodological High findings plus the stale-cap High must be corrected, and the owner must settle the record-population/campaign and support-code/observability choices.

**Exact next gate:** owner selects the Family M/Family R campaign scope, `-PULL` disposition, repetition/launch policy and minimum observability boundary; then explicitly authorizes a bounded docs-only P0 remediation by the upstream package, followed by a targeted independent Work re-review.

Until that gate closes, do not create harness/generator/observation code, run headless or headed calibration, create evidence, modify production/tests/spec/plan/protocol/upstream report, commit/push, set limits/budgets, make scalability claims, remediate deferred findings, or begin another CTM-8 package.
