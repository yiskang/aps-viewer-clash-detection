# M4 Final Focused Review

Target: `docs/superpowers/specs/2026-09-08-collision-library-milestone4-performance-worker-decision-design.md` (990 lines, current working-tree state, `feature/m4-performance-worker-decision-design`).
Brief: `docs/prompts/m4-final-focused-review-prompt.md`. Fresh full-document pass; every prior-round finding was re-derived from the current text rather than assumed fixed, and every load-bearing claim about the landed library was re-verified against `collision/` source at `file:line`.

This review **supersedes** the previous version of this file.

## Verdict

BLOCKED

Two Critical findings, both concentrated in the machinery that decides between **B/C** and the §1.1 *no-boundary* **D**. Neither touches the unconditional gate work (instrumentation, workload matrix, protocol, partition, S1′/S3′/S4′), which remains implementable as written and is the bulk of the plan. But both control whether M4 can produce a defensible verdict at all once the baseline fails the target, and both would force the implementation plan to invent a design decision the spec does not make.

## Summary

**Both fixes from the last round land as text, and one of them is clean.**

| Prior-round finding | Status | Evidence in current text |
|---|---|---|
| **H1** — S7′'s measured window was undefined and biased toward B/C | **Fixed as text, but with two new defects** | §17 lines 790–812 fix the window as "the baseline's window — the case's full query", enumerate the main-thread remainder that must actually run, define the two permitted differences (relocated computation; inert worker output plus a pre-captured baseline stub), place §6.4's stage-scoped validation *after* the closing mark, scope §15's accounting, handle R6's `refresh` precursors, and reconcile with the "no working worker collision path" prohibition. Propagated correctly to §6.4 line 305, §7.3 condition 3's deferral clause, §7.3 condition 4, §7.4.2 line 380, §17's table row and variant note, and §23's spike bullet. The reconciliation is internally coherent as prose. **But the spec never names the mechanism by which a stage is relocated inside a real `findClashes()` call, and no such seam exists in the landed source** (C1), and the pre-captured baseline output it now depends on is not obtainable through §16.4's closed list (H1 below). |
| **H2** — R6's post-invalidation refresh query had no evaluation state | **Fixed, cleanly, and fully propagated** | The third `refresh` state is declared at §5.2.1 line 196, §5.6 line 240, §6.1.4 line 253, §6.2 X-3 line 275, §7.2 line 342, §7.3 A line 352, §7.3 B condition 1 line 355, §12.4's repeat-rate row line 632, §17 lines 780 and 810, and §23 lines 922/926/930. I found **no** surviving bare `state ∈ {cold, warm}` enumeration that needed the third state and lacks it. |

**On the correctness-vs-target split the brief asked me to scrutinise: it is sound, and it creates no gap.** §7.2 line 342 routes a *target* failure at R6's `refresh` query through §7.3 B condition 1 (identically to cold and warm), while routing a *correctness or lifecycle* failure there through §6.4/§19.1's `FAILED_VALIDATION` path. That is consistent with how correctness is handled everywhere else in the document, and it is strictly *stronger* than a target failure, not weaker: §19.1 line 851 states "No performance finding may be reported as valid from a run that failed a correctness gate", and §16.2 line 720 makes the run exit non-zero. So a real defect at the refresh query cannot escape into a performance verdict — it voids the entire run, which dominates any verdict D would have produced. Routing correctness through condition 1 as well would be actively wrong: condition 1 is the trigger that says *the synchronous baseline is too slow*, and a stale result is not evidence that work should move off the main thread. §19.1's R6 row independently gates the same query on `P₁ ≠ P₀`, exactly one attributable TLAS rebuild, and `P₀` recovery. One Medium-severity label inconsistency in that same sentence is reported below (M1); it affects the disposition string, not whether the defect is caught.

**What is newly wrong** is that the H1 fix made S7′ an *integration* measurement (a real full query with one stage relocated) without supplying the integration seam or the capture mechanism, and that round 1's condition-3 fix built a verdict-controlling screen on top of a §6.3 classification that §6.3 explicitly declines to make.

Checks **B** (gate-first sequencing), **F** (lifecycle/concurrency), **G** (correctness-gate scope), and **I** (scope integrity) hold on the current text with no findings.

## Findings

### Critical

#### C1 — S7′ must relocate a stage inside a real `findClashes()` call, but no seam exists and §16.3 / §16.4 / §17 forbid adding one

**Sections:** §17 lines 777, 790–812 (the S7′ window definition and its two permitted differences); §7.3 B conditions 2 and 4; §7.4.2 line 380; §16.3 line 727; §16.4 item 6 line 758; §17 line 766.

The H1 fix makes S7′ execute "the case's full query executed as in the baseline with only the offloaded stage relocated" (§17 line 777), with everything else — extraction, all computation the vertical does not move, aggregation, provenance mapping, lifecycle validation, publication — required to "**actually run**" inside the same marked window (lines 790–797), and with "**Exactly two things differ** from the baseline **inside that window**, and nothing else" (line 799). Line 802 rests the entire like-for-like claim on the substituted value being the baseline's own, so that "the downstream stages take the **identical branches over the identical pair identities**".

That construction requires a supported way to intercept one stage of a live `CollisionWorld` query. The landed source provides none:

- **Precheck vertical (§17 line 783) — no seam at all.** `volumeOverlapQuery` and `classifyHardClashPrecheck` are static ES-module imports (`collision/CollisionWorld.js:22`, `:26`) invoked as bare function calls at `:2194` and `:2318`, inside `_runClearanceNarrowPhasePair` (`:2262`). They are not properties of any object, not `this.`-dispatched, and not injectable. An ES-module import binding cannot be rebound from outside its module, so no amount of harness-side patching reaches them. The only remaining route is replacing `CollisionWorld.prototype._runClearanceNarrowPhasePair` with a spike-maintained copy — i.e. **forking ~120 lines of the pair pipeline into `spike/m4/`**, which also needs module-private helpers that `CollisionWorld.js` does not export. A fork is precisely what line 802's "identical branches" equivalence claim cannot rest on, since the branches would then be the spike's, not the library's.
- **Geometry-preparation vertical (§17 line 782) — reachable only by undocumented private mutation.** `CollisionWorld.fromViewer` is the only path that wires `_viewer`, `_options`, and `_tlasCache` (`:626`, `:642`, `:652–682`); it hardcodes `world._registry = createGeometryRegistry({ resolveGeometryView, checkpointPort })` with no pass-through for the injectable builders and no `registry` option, even though the constructor accepts one (`:535`). A directly constructed world has `_viewer`/`_options`/`_tlasCache` null (`:585–591`), so it has neither an extraction path nor a TLAS arm — both of which §17 requires to run. And `createGeometryRegistry` calls `compactAndWeld` *inside* its own `buildWeld` (`collision/geometry/createGeometryRegistry.js:51`), so WB-1b's weld is not relocatable through the three documented injectable builders (`connectivityImpl`, `accelerationImpl`, `blasCache`, `:16–22`) at all. The only route is post-`fromViewer` assignment of `world._registry` with a hand-built `new GeometryRegistry({ buildWeld, buildConnectivity, buildAcceleration, checkpointPort })` (`GeometryRegistry.js:26`), reconstructing the checkpoint port from the exported `createCheckpointPort` / `createFrameBudgetAccumulator` (`scheduler.js:111`, `:68`) and reaching into `world._resolveGeometryView`, `world._disposed`, and `world._isEpochLive`.
- `options.narrowPhase` throws for any value but `'three-mesh-bvh'` (`CollisionWorld.js:630–634`), so the reserved option named in §2.6 as a "seam" is a rejection gate, not an injection point.

Meanwhile §16.3 line 727 forbids the harness to "modify `collision/` behavior"; §16.4 item 6 line 758 closes the instrumentation list with "**Nothing else.** No worker code…"; §17 line 766 forbids spike code under `collision/`.

So the implementation plan is forced to invent, unaided, the single decision on which S7′'s validity rests: *is spike-only runtime replacement of a world's internals (or a spike-local fork of the pair pipeline) permitted, and how is "nothing else differs" then verified?* Each answer produces different evidence, and one of them (the fork) silently invalidates the equivalence argument that the H1 fix was written to establish. This is the Critical category "a missing design decision that the implementation plan would be forced to invent", on the conditional branch that decides B/C versus D.

**Smallest correction that preserves the current direction:** add one clause to §17 (and a matching sentence to §16.3) that names the permitted mechanism explicitly — e.g. *"S7′ may replace a live world's `_registry` and may replace named `CollisionWorld.prototype` stage methods from `spike/m4/` at runtime; it may not edit any file under `collision/`. Where a stage method must be replaced, the spike's copy is derived verbatim from the landed method with only the two §17 differences applied, and the harness records the diff in the run's provenance."* If instead runtime mutation is meant to be forbidden, the alternative is to add one narrowly-scoped spike-only injection point to §16.4's list and accept that the list grew — but that must be a stated decision, not one the plan makes silently.

#### C2 — §7.3 condition 3's residual screen claims mechanical determinism but depends on a §6.3 classification §6.3 explicitly refuses to make, and the screen runs before the choice can be made

**Sections:** §7.3 condition 3 line 357; §6.3's table rows for `compactAndWeld` and "Geometry resolution per narrow-phase pair" (lines 288, 293); §8.2's WB-1b row line 450; §1.1's *no-boundary* D; §17 lines 780–786.

Condition 3 states its method is "computed **exactly as follows, so two harnesses cannot disagree**", and the method is: "For each CDP main-thread task interval inside the marked window, subtract the portions of that task covered by stages **§6.3 classifies transferable**; the remainder is that task's main-only-attributed residual."

§6.3 declines to classify two of its thirteen rows:

- `compactAndWeld` — Class: "**main-only as written**; movable only via the extra-copy variant (§8.2)"; M4 requirement: "Report; **classify per variant**." This is the ~176 ms cold stage (§3.1).
- "Geometry resolution per narrow-phase pair" — Class: "main-only on first touch, transferable when warm."

Neither is resolvable at screen time, and the screen is not a diagnostic — it is the sole test that forces the §1.1 *no-boundary* **D**, excluding **both** B and C ("If the screen fails, no boundary in §8.2 can solve it: B **and** C are both excluded… and the verdict is **D**"). Every available reading produces a wrong verdict on some branch:

- **Weld as main-only:** the screen can force *no-boundary* D on a cold failing tuple even though §8.2's WB-1b is a boundary in §8.2 that specifically relocates weld — directly contradicting the screen's own stated rationale, "If main-only work alone already violates the target, no boundary in §8.2 can fix it."
- **Weld as transferable:** the screen passes and licenses B for a boundary (WB-1a, or a narrow-phase boundary) that does **not** relocate weld — so the residual bounds a configuration nobody proposed.
- **Per-boundary screens:** the correct answer, but it is not specified — and it is also circular as ordered, because §17 line 780 selects the S7′ vertical *from* §6.3's attribution, which condition 3 consumes first. WB-1b's own added main-thread `slice()` cost (§8.2 line 443) is furthermore absent from the baseline trace the screen subtracts from, so a WB-1b-specific screen is not a pure re-classification either.

The first-touch/warm row is the milder half — the state label is known per query — but a cold query legitimately contains both first-touch and cache-hit resolutions, and §16.4.5's event schema does not define a field that distinguishes them (`kind: 'geometry-resolve'` with a `stage` enum, line 742).

**Smallest correction:** make condition 3 boundary-specific in one sentence — evaluate the screen once per candidate §8.2 boundary, classifying each §6.3 row against *that* boundary's move set, and require the screen to fail for **every** boundary in §8.2 before §1.1's *no-boundary* D is forced; state explicitly that WB-1b's screen treats `weld` as transferable and charges its extra copy as main-only. Add one clause to §16.4.5's schema making first-touch versus cache-hit an explicit value of `stage` for `kind: 'geometry-resolve'`.

### High

#### H1 — §16.4's closed instrumentation list cannot produce the controlling memory metric or the baseline stage outputs S7′ and §6.4 now depend on

**Sections:** §16.4 items 4 and 5 (lines 738–756); §15.1's Metric M equation lines 671–677; §6.4's stage-scoped validity rule line 317; §17 point 2 lines 802–806.

Three binding requirements exceed what §16.4 authorises:

1. **Metric M — the *controlling* memory metric (§15.1) and an input to B condition 6 — has two of four terms with no accessor.** §16.4 item 4 grants "per-epoch geometry-entry count and enumeration of resident geometry entries (welded buffer byte lengths, BVH, connectivity)". That covers the `Σ_geometry` term. It does **not** cover `Σ_epoch [tlas.primitiveBuffer.byteLength + tlasRecordCount × recordBytes]` or `Σ_epoch [placementCount × …]`. The only existing public accessor is `getEpochCollisionInstanceCount(epoch)` (`CollisionWorld.js:770`), which covers the fourth term only; `_placementByEpoch` and `_tlasCache` have no public reader. §16.4 item 4's own stated purpose is to stop the harness reaching into privates the way `run-gate-m2.mjs:285-310` does — so leaving these two terms to private access defeats the item.
2. **§6.4's stage-scoped geometry criterion needs buffer *contents*, item 4 grants *byte lengths*.** The criterion is that the welded `position`/`index` buffers be "**element-wise equal**" and the serialized BVH "**byte-identical**" to the main thread's. Byte lengths cannot express that. (The contents are physically recoverable through `GeometryRegistry`'s private entries, which reinforces the point: the closed list should say so rather than leaving it to be improvised.)
3. **S7′'s stub result mapping needs complete per-repetition baseline stage output, and §16.4 item 5's retention rule discards exactly that.** Item 5 requires the sink to aggregate online, keeping "counts, §6.1.8's full duration summary, per-covariate correlation accumulators, a per-`inconclusiveCause` histogram, and a bounded top-N (N = 20)"; "**Raw events are discarded after aggregation.**" §17 line 802 requires "the *pre-captured synchronous output of that same offloaded stage*, taken from the baseline arm at the identical `(runtime, case, broadPhase, state, repetition)`" — for the precheck vertical, that is a complete per-pair verdict list over thousands of candidates. §17 line 806 acknowledges the retained artifact exists and classifies it as harness scaffolding for §15 purposes, so retention itself is not unstated; what is unstated is **how it is captured, and how that exception relates to item 5's discard rule**. Item 5's schema also has no field for the four-way `excluded` / `proceed` / `inconclusive` / `skip-precheck` status that §19.1 names and that §17's downstream branches would have to be driven by. A further consequence nobody has stated: S7′ runs only *after* the gate has finished and identified failing tuples, so the **gate** must retain per-repetition raw stage output before it knows whether S7′ will ever be needed.

**Smallest correction:** widen §16.4 item 4's parenthetical to name the TLAS and placement terms and to say the enumeration returns the live typed arrays (read-only), not only their lengths; add one sentence to item 5 saying that raw per-pair stage records may be retained *in-process for the current repetition* as §17 scaffolding — never emitted to the result JSON — and add the precheck status enum to the schema. This keeps the list closed and its "no public contract moves" property intact.

#### H2 — §7.3 conditions 4 and 5 give R1/R2 no acceptance rule, so the same evidence supports B or D

**Sections:** §7.3 B conditions 4 and 5 (lines 358–359); §7.4.2; §17's S7′ bound line 777.

Condition 4 reads: S7′ evidence "at **every failing `(case, broadPhase, state)` tuple plus R1 and R2**, that the named boundary moves the failing metric to within target **with its own overhead included**, by §7.4.2's effect rule." Grammatically, both the "moves the failing metric to within target" test and §7.4.2's effect rule (which requires a *statistically significant improvement*) apply to R1 and R2 as well. But R1/R2 are ordinarily *passing* cases — §17's bound calls them "(small-query overhead)" and condition 5 asks only that their overhead be **measured**, with a narrative rider ("a design winning only at a stress case must not silently become the default") and **no threshold**.

Two faithful implementations therefore disagree on whether B is reachable at all:

- require a significant improvement at R1/R2 under §7.4.2 — which a small query with fixed transfer overhead will essentially never show, making B and C unreachable in practice;
- require only that R1/R2 overhead be recorded, applying the target/effect test to failing tuples alone — B reachable.

Since a failed condition sends the verdict to D, this ambiguity can flip B/C ↔ D on identical measurements, in a section whose whole premise is a mechanical read-off.

**Smallest correction:** restrict condition 4's target/effect test to the failing tuples, and restate condition 5 as its own acceptance rule — e.g. *"at R1 and R2 the arm must still meet T-a/T-b1/T-b2/T-c under §7.2's aggregation rules, and its X-3 makespan regression against the baseline is reported; a regression that pushes R1 or R2 out of target disqualifies the boundary."*

### Medium

#### M1 — §7.2's refresh clause assigns `FAILED_VALIDATION` to a lifecycle error, which §16.2 classifies as `FAILED`

§7.2 line 342: a correctness problem at R6's `refresh` query — "a stale or incorrect result, a parity mismatch against the linear oracle, **or a lifecycle error**" — "invalidates the **run** (`FAILED_VALIDATION`, non-zero exit)". §16.2 line 720 draws the distinction the other way: "Any §6.4 mismatch ⇒ `disposition: 'FAILED_VALIDATION'`… **Any errored run ⇒ `'FAILED'`**." A thrown `ModelPlacementChangedError` at the refresh query is an errored run, not a comparator mismatch. Both dispositions exit non-zero, so nothing escapes; the defect is that the harness's disposition string is specified two ways. One-word fix in §7.2 ("`FAILED_VALIDATION` for a comparator or §19.1 gate failure, `FAILED` for a thrown lifecycle error").

#### M2 — §17's precheck vertical is admitted as evidence for WB-2/WB-4 without the WB-1a/WB-1b isolation caveat's analogue

§17 line 782 is careful on the cold side: the geometry-preparation arm "models WB-1b, and **on its own proves only WB-1b**", and naming WB-1a additionally requires the worker-side `bvh-construction` sub-stage reported in isolation. Line 783 has no counterpart: the "warm Hard-Clash-precheck vertical" is mapped straight to "**WB-2/WB-4**", yet §8.2 defines WB-2 as "precheck + exact queries + distance query" and WB-4 as the whole query below extraction. The arm relocates one of WB-2's three sub-stages and (per line 793) leaves the exact and distance queries running on the main thread inside the window. Line 786's discipline — "each is reported against **only** the boundary it actually models" — is therefore stated but not achievable for the narrow-phase family, because §8.2 contains no precheck-only boundary for B condition 2 to name. Either add one (WB-2a, precheck only) or state the same isolation rule as line 782: a B verdict naming WB-2 or WB-4 additionally requires the exact- and distance-query sub-stages measured, not inferred from the precheck arm.

## Implementation-plan readiness check

- Gate-first sequencing: **PASS** — §17 line 768's ordering (gate partition → S1′/S3′ unconditional → S7′/S8′ only on baseline failure) is stated once and contradicted nowhere; §6.3 line 301, §7.3 condition 4, and §23's spike bullet all agree.
- Conditional spike gates: **FAIL** — trigger conditions are unambiguous, but S7′'s *mechanism* is undefined (C1) and its R1/R2 acceptance rule is not stated (H2).
- Closed instrumentation sufficiency: **FAIL** — H1: Metric M's TLAS/placement terms, buffer contents for §6.4's stage-scoped criterion, and per-repetition raw stage retention for §17's stub mapping all fall outside §16.4 as written.
- Verdict mechanics: **FAIL** — C2: condition 3's screen is not mechanically evaluable and is the sole forcing rule for the *no-boundary* D. Everything else in §7.3/§7.5 checks out: A, B, C, D are each reachable, B/C rest on stage-scoped rather than parity evidence (§1.2), capacity rejection is `CAPACITY_REJECTED` and never a pass (§4), and §7.4.2's effect rule supports the paired comparisons it is used for.
- Lifecycle/concurrency semantics: **PASS** — §10.1's per-call `Map<requestId, RequestState>` is stated as a correctness requirement with the landed justification (`CollisionWorld.js:2591-2599`); §10.2's matrix settles every row exactly once including discard-on-unknown-id, malformed, duplicate, and crash/terminate; the disposed → evicted → placement precedence and the path-specific arming scope (`:1105`, `:1095`) are preserved; `evictModel` stays synchronous and never-throwing; no worker token is identity authority (§9). No new placement-revision abort reaches the linear path.
- Correctness-gate scope: **PASS** — §6.4 is the single canonical comparator with a clean scope split (TLAS-vs-linear and full-result arms versus the stage-scoped rule); §19.2 holds full parity as an adoption prerequisite; §16.2's fail-loudly bullet matches; no section pulls parity back into M4.
- Memory gate implementability: **FAIL** — the methodology itself is sound (Metric M deterministic and controlling, Metric H a separately-reported cross-check with a fixed `--expose-gc` protocol, worker heap never merged, peak defined at maximum simultaneous residency, `measureUserAgentSpecificMemory` recorded as unavailable, `recordBytes`/`instanceBytes` derived rather than guessed, pending-message bytes defined). It fails only on H1's accessor gap for two of Metric M's four terms.
- Scope integrity: **PASS** — every exclusion in the brief's list is restated and nothing contradicts them. §16.3's own-express-instance clause keeps `server.js` untouched; §17 keeps spike code out of `collision/` and `wwwroot/`; no public API, `AbortSignal`, latest-call-wins, COOP/COEP change, or M1–M3 gate rewrite is authorised anywhere. (C1's unnamed mechanism is a gap in §17, not an authorisation to widen scope — but note that one of the two ways to close C1 *would* widen §16.4, which is why it must be decided in the spec rather than in the plan.)

## Required fixes before planning

1. **C1 — name S7′'s interception mechanism.** Add the permitted-mechanism clause to §17 (and mirror it in §16.3), covering both verticals: whether spike-only runtime replacement of `world._registry` and of named `CollisionWorld.prototype` stage methods is allowed, how a replaced method is derived from the landed one, and how "exactly two things differ" is verified and recorded in provenance. If runtime mutation is instead to be forbidden, add the one spike-only injection point to §16.4 as an explicit sixth item and acknowledge the list grew.
2. **C2 — make condition 3's screen boundary-specific.** Evaluate it once per candidate §8.2 boundary against that boundary's own move set; force §1.1's *no-boundary* D only when the screen fails for every boundary; state explicitly that WB-1b's screen treats `weld` as transferable and charges its extra `slice()` copy as main-only; add a first-touch-versus-cache-hit value to §16.4.5's `geometry-resolve` `stage` enum.
3. **H1 — widen §16.4 items 4 and 5 to exactly what §15.1 and §17 need**, and no further: the TLAS and placement terms of Metric M, live read-only typed arrays rather than byte lengths alone, an in-process per-repetition raw-retention exception for §17's scaffolding (never emitted to JSON), and the precheck status enum.
4. **H2 — split conditions 4 and 5.** Confine the target/effect test to failing tuples and give R1/R2 their own stated acceptance rule.

M1 and M2 are one-sentence clarifications and can ride along with the above.

## Planning notes

Useful to `/superpowers:writing-plans` once the four fixes land:

- **The plan splits cleanly at the gate.** Everything through §16.4's five instrumentation additions, `run-gate-m4.mjs`, the §5.4 cohort profiling pass, the §6.1 protocol, the §6.3 partition, and S1′/S3′/S4′ is unconditional and unaffected by every finding above. S7′/S8′ and the §7.3 B/C conditions are downstream of a measurement outcome and should be planned as a gated phase, not as up-front tasks.
- **S1′ is the true first spike and it has a hard prerequisite of its own**: the harness's own express instance (§16.3 line 729) must exist before S1′ can be served same-origin, so that harness-server task precedes S1′ rather than being bundled into it.
- **§16.4 item 3's extraction bracket is on the critical path for two separate things** — §7.5.6's mandatory-D condition (the ~1.4 s unattributed cold cost) and §6.3's partition, which in turn gates §17's variant selection and §7.3 condition 3. It should be sequenced before, not alongside, the first full gate run.
- **§5.4's profiling pass is Viewer-only by construction** and touches no `collision/` narrow phase, so it can be built and validated independently of the instrumentation tasks.
- **R6 mutates shared fixture state** (`viewer.impl.setPlacementTransform` on the Architecture model) inside a page that every other case also runs in, while §6.1.6 rotates case order by repetition. §5.2.1 step 5's reset-and-re-confirm is therefore a cross-case invariant, not an R6-local assertion, and deserves its own harness-level check between cases.
- **§15.1's `recordBytes`/`instanceBytes` derivation** is a standalone calibration step under Metric H's `--expose-gc` protocol and can be planned and verified before any measured case runs.
- **The gate's raw-retention policy is a design input to the very first harness task**, not a late S7′ detail (see H1 point 3): whatever the fix decides, the gate must retain per-repetition stage output from its first run, because it cannot know at that point whether S7′ will be needed.
