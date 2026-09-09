# M4 Final Focused Review

Target: `docs/superpowers/specs/2026-09-08-collision-library-milestone4-performance-worker-decision-design.md` (964 lines, current working-tree state).
Brief: `docs/prompts/m4-final-focused-review-prompt.md`. Fresh pass over the full document; the prior round's five findings were re-derived from the current text rather than assumed fixed.

## Verdict

READY_FOR_IMPLEMENTATION_PLANNING

With the qualification stated in the summary: two High findings must be closed before the **S7′** portion of the plan is executed and before **R6** results are read as verdict-bearing. Neither blocks planning the unconditional gate work, which is what the plan's first ~80% consists of.

## Summary

No Critical findings. The five issues from the prior focused round are all confirmed fixed in the current text:

| Prior finding | Status | Where |
|---|---|---|
| S7′ comparator scope (canonical comparator wrongly applied to a stage-scoped spike) | **Fixed** | §6.4 now scopes the canonical comparator to (a) TLAS-vs-linear and (b) a full-result worker arm, adds an explicit stage-scoped validity rule for each S7′ vertical, and §16.2's "fail loudly" bullet matches it (a stage-scoped failure disqualifies the spike, not the run) |
| B/C condition 3 (main-only remainder screen not computable) | **Fixed** | §7.3 condition 3 now specifies harness-side receipt timestamping, the `[end − ms, end]` interval, per-CDP-task subtraction of transferable stages, innermost-stage-wins de-duplication, max-over-tasks-and-repetitions, and an explicit T-a-only scope with a stated reason |
| Missing evidence path for cold-side B boundaries | **Fixed** | §7.3 condition 2 now names an evidence path per boundary shape, and §17 adds the geometry-preparation vertical plus the WB-1a-vs-WB-1b isolation rule |
| Evaluation-unit state dimension | **Fixed and propagated** | §7.2's `(runtime, case, broadPhase, state)` unit with both states independently verdict-bearing; propagated to §7.3 A, §7.3 B conditions 1 and 4, §17's S7′ bound and variant-selection note, and §23. (Only §23's spike-summary bullet still says "every failing R-case" rather than "tuple" — a summary imprecision, not reported as a finding.) |
| T-b splitting | **Fixed** | T-b1 (p95 ≤ 32 ms) and T-b2 (max ≤ 100 ms) are separate, classified as percentile vs. hard maximum, with matching aggregation rules; propagated through §7.3 A, §7.3 B condition 1, §7.4.1, and §23. No bare `T-b` remains except the one sentence that explains the split. |

What the fixes introduced, and what remains, is concentrated in one place: **the S7′ arm's measured window is still undefined**, and §7.3 condition 3's newly-added T-a-only scope explicitly *leans on* S7′ to establish T-b1/T-b2/T-c sufficiency. That is finding H1 — a fixed-but-with-a-new-defect outcome for the condition-3 fix, in the sense that condition 3's deferral clause now depends on a property S7′ does not currently have. H2 is an independent gap in the *newly added* state dimension: R6's defining query has no state, so R6's own measurement cannot fail a case or satisfy B condition 1.

Everything the prompt lists under checks D (closed instrumentation), F (lifecycle/concurrency, except M3), G (correctness gates vs. scope), H (memory gate), and I (scope integrity) holds on the current text.

## Findings

### Critical

None.

### High

#### H1 — The S7′ arm's measured window is not defined, so B condition 4's evidence is not established as comparable to the baseline, and condition 3's deferral of T-b1/T-b2/T-c rests on it

**Sections:** §17 (S7′ row and the "stage-scoped measurement vertical with a stub result mapping" rule), §7.3 B conditions 3 and 4, §7.4.2, §6.4's stage-scoped validity rule.

§17 defines S7′ as: "Snapshot representative collision-owned data, transfer it **once** as a one-way population, execute the failing stages' dominant workload in the worker, return compact results," bounded to "the real candidate list … or the real geometry set," and closes with "S7′, in **either** variant, is a stage-scoped measurement vertical with a stub result mapping." §6.4's stage-scoped rule independently confirms such a spike "reproduces only part of the pipeline."

§7.3 B condition 4 then requires S7′ evidence "that the named boundary moves the failing metric to within target **with its own overhead included**, by §7.4.2's effect rule," and §7.4.2 defines that as "a paired comparison between the synchronous baseline and a worker arm on the same case." The failing metrics are X-1 window statistics (T-a, T-b1, T-b2, T-c), and §6.1.7 anchors every observer to one measured query's `performance.mark` pair.

Nothing in the spec says what the main thread executes during the S7′ arm's marked window — specifically whether the main-only remainder (extraction, aggregation, provenance mapping, lifecycle validation, publication, and the non-moved computation) runs there, as it does in the baseline window. "Same case," "the real candidate list," and "overhead included" do not establish equivalent measured work. If the S7′ window contains only the snapshot, the transfer, the await, and a stub mapping, then its frame cadence and input latency improve largely because the rest of the query is *absent*, not because the boundary helped — a bias systematically toward B/C, on exactly the three metrics §7.3 condition 3 declines to screen.

This is load-bearing rather than academic because condition 3 states the reliance in terms: T-b1/T-b2/T-c sufficiency "is **not** screened here and is instead **deferred to condition 4's S7′ measurement, which measures the real thing**." On the current construction S7′ does not measure the real thing for those metrics, so under the present text B and C can be reached with T-b1/T-b2/T-c sufficiency established by neither mechanism.

**Smallest correction (either, not both):**
- (a) Fix the S7′ arm's window equivalence explicitly: state that the arm's `performance.mark` window covers the same case's full query with only the selected stage relocated to the worker and only the *result mapping* stubbed, and enumerate the main-thread remainder that must execute inside it. This must be reconciled with §17's "no spike may build a working worker collision path" so the boundary between the two is unambiguous; or
- (b) If (a) cannot be done without crossing that prohibition, restrict condition 4: S7′ proves stage-level cost and overhead (X-2/X-3 and §15) against a **stage-scoped synchronous control** over identical inputs, and condition 3's clause is amended to say that T-b1/T-b2/T-c sufficiency for the hypothetical configuration is *not* established by M4 — making it, like parity, an adoption prerequisite in §19.2 rather than a B/C condition.

Both preserve M4's direction and neither reopens the A/B/C/D framing.

#### H2 — R6's post-invalidation refresh query has no §7.2 evaluation state, so the one query R6 exists to produce cannot fail a case or satisfy B condition 1

**Sections:** §5.2.1, §6.1.4, §7.2's evaluation-unit bullet, §7.3 B condition 1, §5.6.

§6.1.4 fixes exactly two measured queries per fresh world: "Its **first** measured query is that tuple's *cold* sample; its **immediately following second** query … is the *warm* sample." §7.2 then defines the evaluation unit as `(runtime, case, broadPhase, state)` "where `state ∈ {cold, warm}` are the two measured queries §6.1.4 defines for each fresh world," with both states independently verdict-bearing.

§5.2.1's R6 sequence needs more than two queries in one world: (1) "Run R3 warm; record the pair set `P₀`" — which itself consumes the cold and the warm query; (2) apply the real `setPlacementTransform`; (3) `invalidateModelPlacement`; (4) "Re-run R3; record the pair set `P₁`"; (5) reset and re-confirm `P₀`. The query at step 4 is the third in that world, and it is the one §5.2.1 declares R6 measures — "the cost of the lazy staged refresh plus the forced TLAS rebuild (`tlasBuildMs`, `tlasBuilds`), **on top of the ordinary warm cost**."

That third query therefore falls outside `{cold, warm}` and has no target-evaluation rule. Consequences, both mechanical: R6's target evaluation reduces to two samples that are R3-identical by construction (making R6 redundant as a target case while unique as a cost/correctness case), and a responsiveness failure in the refresh query — plausibly R6's most expensive, since it forces a TLAS rebuild on a warm world — cannot satisfy §7.3 B condition 1, which requires a failure "at one or more verdict-bearing R-cases, **in either measured state**."

**Smallest correction:** add `refresh` as a third R6-only state — cold (setup), warm (`P₀`), and `refresh` (`P₁`, verdict-bearing) — with the reset query at step 5 declared correctness-only and unmeasured; then amend §6.1.4's "exactly two measured queries" to name R6 as the declared exception, and §7.2's state definition to include it. This mirrors how §7.2 already handles the warm-only S4 exception, so it adds no new machinery.

### Medium

#### M1 — Small-query and largest-workload acceptance semantics are ambiguous, and the largest non-failing workload has no stated pass/fail rule

**Sections:** §7.3 B conditions 4 and 5, §7.4.1's third bullet, §7.4.2.

Condition 5 reads: "S7′ overhead measured at **both** the smallest queries (R1/R2) and the largest verdict-bearing workload — a design winning only at a stress case must not silently become the default." That is a measurement obligation plus a rationale; it states no acceptance criterion, and §7.4.1's "Overhead is compared at both ends of the workload range … never only where it looks best" repeats the obligation without supplying one. So for the largest verdict-bearing workload, when it is not itself a failing tuple, nothing determines whether an observed overhead blocks B.

Condition 4 compounds it at R1/R2. Read literally, it requires S7′ evidence "that the named boundary moves the failing metric to within target … **by §7.4.2's effect rule**" at R1 and R2 — but R1/R2 need not be failing, and §7.4.2's rule requires a consistent improvement *direction*, which a non-failing case has no reason to show. The natural reading ("the worker arm must remain within all targets at R1/R2") is not the literal one and the text does not authorize it, so a verdict reader chooses between incompatible interpretations in a spec whose stated premise is that the verdict is read off mechanically.

**Smallest correction:** split the two roles explicitly — §7.4.2's effect rule applies to originally-failing tuples only; R1/R2 and the largest verdict-bearing workload are governed by a stated guardrail, at minimum "the worker arm's X-1 metrics remain within T-a/T-b1/T-b2/T-c under §7.2's aggregation rules," with a named consequence when they do not.

#### M2 — Condition 3's screen counts stages that §8.2/§17 exist to move as irreducible main-only, while a screen failure is interpreted as "no boundary in §8.2 can solve it"

**Sections:** §7.3 condition 3, §6.3's classification table, §8.2 (WB-1b), §17's geometry-preparation vertical, §1.1's *no-boundary* D cause.

Condition 3 computes the residual by subtracting from each CDP task "the portions of that task covered by stages §6.3 classifies **transferable**." Two rows of §6.3 are not classified transferable but are movable under a boundary the spec explicitly contemplates: `compactAndWeld` is "**main-only as written**; movable only via the extra-copy variant (§8.2) … classify per variant," and per-pair geometry resolution is "main-only on first touch, transferable when warm." Condition 3 does not say which classification the screen uses for a variant-dependent stage.

Under the literal reading, weld time in a cold window is counted as irreducible main-only residual, yet §8.2's WB-1b and §17's extra-copy geometry-preparation vertical exist precisely to move it. A screen failure driven by that time would then be read, per condition 3's own closing sentence and §1.1, as "no boundary in §8.2 can solve it" and force the *no-boundary* D — a conclusion the spec's own boundary catalogue contradicts. In practice the screen is unlikely to bind (a 50 ms per-task residual against an 8 ms cooperative budget and a worst measured atomic span of 12.2 ms), which is why this is Medium and not High, but the inference rule is unsound as written.

**Smallest correction:** state in condition 3 that the screen uses the **most permissive** classification — any stage §6.3 marks movable under any §8.2 variant counts as transferable for this screen — so that a screen failure genuinely means no §8.2 boundary can close the gap.

#### M3 — §10.2's settlement matrix is receipt-driven only; a worker that never responds leaves a promise pending, and S4′ is not asked to cover it

**Sections:** §10.2, §10.4, §11.2.

Every row of §10.2's matrix is keyed on "condition at receipt," plus the `onerror`/crash/`terminate()` row. §10.2 then asserts "**No unsettled promise is permitted under any of these conditions.**" A worker that neither responds nor errors — a dropped or mis-routed message, or an unbounded loop inside a worker-side traversal, which §11.2 confirms `postMessage` cannot interrupt — is outside the enumerated conditions, and the owning `findClashes` promise stays pending indefinitely unless the caller happens to `dispose()`. §10.4's eight scenarios do not include it, so S4′ would not surface it either.

This is a design decision M4 may legitimately defer, but the spec does not currently say it is deferred, and §10 is the section whose declared property is that no promise can remain unresolved.

**Smallest correction:** one sentence in §10.2 stating either that a non-response liveness guard (watchdog/timeout) is required of any proposal and adding it as a ninth S4′ scenario, or that liveness against a non-responding worker is explicitly out of M4's scope and recorded in §19.2 as an adoption prerequisite.

#### M4 — S6′'s skip condition is undefined and collides with verdict C's condition, which names S6′ by name

**Sections:** §17's S6′ row, §7.3 verdict C, §18's C1 row.

S6′ is "*conditional — only if S1′ passes and §18's C1 is not already refuted analytically*." "Refuted analytically" is nowhere defined, so an implementer cannot determine whether to run S6′ — one of the prompt's named review targets (ambiguous conditional-spike triggers). It also collides with the verdict it feeds: §7.3's C requires "§18's C1 refuted by S6′," so on the skip path C's own condition cites a spike that was not run and is, read literally, unsatisfiable. §18's C1 row states only "S6′ confirms or refutes."

**Smallest correction:** either delete the analytic escape (S6′ is cheap and C depends on it), or define the escape and restate C's condition as "C1 refuted — by S6′, or by the analytic argument recorded under §18 when the escape applies."

#### M5 — WB-3 remains a candidate boundary in §8.2 and §13 but has no S7′ vertical and is absent from B condition 2's enumeration, so it cannot be named by a B verdict

**Sections:** §8.2 (WB-3 row), §13's closing sentence, §7.3 B condition 2, §17's two-variant selection.

§1.1 requires B to **name** its boundary; §7.3 condition 2 enumerates only "BVH construction, complete geometry preparation, or a batched narrow-phase service," and §17 offers exactly two verticals (precheck / geometry preparation) with the explicit rule that each is "reported against **only** the boundary it actually models." §13 nevertheless leaves open "**Then** determine whether the primitive is itself a worker candidate," and §8.2 keeps WB-3 in the table. There is no path by which a B verdict could name WB-3, because no vertical models the distance primitive in isolation and condition 4 requires S7′ evidence for the named boundary.

**Smallest correction:** state in §8.2 or §13 that WB-3 is characterised but is not independently nameable as a B boundary in M4 — evidence for the narrow phase is produced only at the precheck vertical's granularity — so §13's determination is reported as a finding, not as a candidate verdict.

#### M6 — T-c's per-repetition p95 is computed from ~4–5 input samples, which degenerates to the maximum, and no minimum-sample guard exists

**Sections:** §6.2's X-1 input-responsiveness protocol, §7.2's T-c and its aggregation rule, §6.1.8.

§6.2 fixes the input cadence at "one every 100 ms for the query's duration." §3.1/§3.3 put warm federated queries at ~440–520 ms, so a warm repetition yields roughly four to five input samples. §7.2 then classifies T-c as a **percentile** statistic — "computed **within** each repetition," medianed across five, with a no-repetition-above-1.5× clause — but a p95 over four or five values is the maximum under any standard estimator, so T-c is in practice a hard maximum evaluated by percentile rules, which is exactly the distinction §7.2 introduced T-b1/T-b2 to keep straight. §6.1.8 guards the empty set but sets no minimum-`n` rule and does not fix a percentile estimator.

**Smallest correction:** either raise the input cadence for the query window (e.g. one every 20–25 ms, keeping the dispatch-timestamp discipline of §6.2 unchanged), or state a minimum sample count below which T-c is reported as `NOT EXERCISED` for that repetition, and name the percentile estimator §6.1.8 uses.

## Implementation-plan readiness check

- Gate-first sequencing: **PASS** — §6.3's partition is produced by the gate, §17 states the ordering, S7′/S8′ are gated on the baseline failing §7.2's target, and no section permits either before the baseline establishes the trigger.
- Conditional spike gates: **PASS**, except S6′'s undefined analytic-refutation escape (M4). S1′/S3′ unconditional, S4′ unconditional, S5′ topology-gated, S7′/S8′ target-gated — all stated consistently in §17 and §23.
- Closed instrumentation sufficiency: **PASS** — every required metric maps to §16.4's five items plus CDP/Playwright, browser APIs, harness-only code, or spike-only code. No new hook is necessary. See planning note 3 for the one place the harness must read library internals rather than an accessor.
- Verdict mechanics: **FAIL** — H1, H2, M1, M2, M5.
- Lifecycle/concurrency semantics: **PASS** — `requestId` is per-call (§10.1), concurrent calls settle independently, duplicates are discarded, malformed responses reject the correct request, crash/terminate rejects all, precedence and arming scope reproduce today's behavior, no worker token is an identity authority. M3 is the one enumerated-conditions gap.
- Correctness-gate scope: **PASS** — TLAS-vs-linear parity is a hard gate that fails the process (§6.4, §14, §16.2, §19.1); stage-scoped spike validity is separated and fails only the spike; full parity sits in §19.2 as an adoption prerequisite and no section pulls it back into M4.
- Memory gate implementability: **PASS** — Metric M is computable, Metric H is explicitly a cross-check, worker and main-thread figures are never merged except in §15.3's declared Metric-M equations, peak is defined at a deterministically identifiable point, the provisional multipliers are wired to §7.5.7, and pending-message bytes have a stated definition.
- Scope integrity: **PASS** — every exclusion in the prompt's list is preserved. §16.3's own-express-instance provision serves spike assets without touching `server.js`; §16.4.6 and §17 forbid worker code outside `spike/m4/`; §21 restates the full non-goal set.

## Planning notes

1. **Task order.** The three prerequisite clusters are independent and can be planned in parallel: (a) §16.4's five instrumentation additions in `collision/`, (b) `test/performance/run-gate-m4.mjs` plus its own express instance and CDP/rAF/input observers, (c) the §5.4 profiling pass and cohort resolution. The gate cannot run until (a) and (c) land; §6.3's partition is the gate's first output and the gate for everything downstream.
2. **Unconditional spikes are plannable now.** S1′ (module resolution, both runtimes, blob/interception forbidden), S3′ (cold start), and S4′ (all eight §10.4 scenarios on a stub worker) have complete, self-contained success criteria and no dependency on gate output. S4′ additionally needs a `worldGeneration` construct that exists nowhere in landed source — the stub supplies it; the plan should say so rather than leave it looking like an existing field.
3. **Metric M's non-geometry terms have no accessor.** §16.4.4's read-only accessors cover per-epoch geometry entries (welded buffers, BVH, connectivity). Metric M's TLAS term (`tlas.primitiveBuffer.byteLength`, record count) and placement term (`placementCount` per epoch) have none; the harness must read `_`-prefixed internals, as `run-gate-m2.mjs:285-310` already does and says so. That is permitted (harness-only code, no new hook), but the plan should make it an explicit, commented step rather than a surprise.
4. **"Retained" scope is undefined.** §15.2 requires reporting for "cold, warm, peak, and retained" scopes; §15.3's budget uses only steady state and peak, and "retained" appears nowhere else. Report-only, so not a finding — the harness task should define it (e.g. Metric M after `dispose()` and one GC protocol cycle) and record the definition.
5. **Run volume.** §6.1.5 × §6.1.6 × §5.6 imply 6 R-cases × 2 broad-phase arms × 2 runtimes × 5 repetitions = 120 fresh worlds and ~240 measured queries under CDP tracing, before S-cases and before any S7′ arm. Worth an explicit wall-clock estimate and a resumable/partitioned run design in the plan; nothing in the spec addresses gate duration.
6. **§6.4 clause (b) is dormant in M4.** No M4 spike may be a full-result worker arm (§17), so the canonical comparator's worker-arm branch and its `1e-9` relaxation apply only to §19.2's later milestone. Worth stating in the plan so no task is written to satisfy it.
7. **Which runtime for S-cases.** §6.1.5 and §5.6 bind both runtimes to R1–R6 and S4 only; S1/S2/S3 have no declared runtime. Since S-cases are not verdict-forcing, the plan can pick the representative runtime and record the choice — no spec change needed.
