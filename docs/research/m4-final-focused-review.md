# M4 Final Focused Review

Target: `docs/superpowers/specs/2026-09-08-collision-library-milestone4-performance-worker-decision-design.md` (1,014 lines, read in full).
Scope: the brief in `docs/prompts/m4-final-focused-review-prompt.md`. Severity policy applied as written — Critical / High / Medium only, nothing below.

## Verdict

BLOCKED

## Summary

This round's edit — demoting S7′ to report-only stage-level evidence, retaining §7.4.2's effect rule but invoking it from no verdict condition, scoping the surviving mechanical B/C check (`Rᵢ + Hᵢ ≤ 50 ms`) to failing tuples where **T-a** is among the failing metrics, and adding the explicitly-named *no-full-query-evidence* D cause (§7.5.9) — is internally coherent and correctly cross-referenced. The three fixes this round claims — scoping `Hᵢ` to boundary-owned sub-marks so ambient Viewer/rAF/input tasks cannot contaminate it, resolving tuple scope by restricting conditions 3 and 4(b) to failing tuples where T-a is among the failing metrics, and mirroring the WB-1a/WB-1b substage caveat onto the narrow-phase branch — are all present in every place they need to be (§1.1, §7.3 conditions 1/3/4, §7.4.1, §7.4.2, §7.5.9, §17, §19.2, §23), and the four previously-confirmed properties re-checked this pass (§6.4's comparator scope, condition 3's pre-registered permissive classification, the `(runtime, case, broadPhase, state)` unit including R6 `refresh`, and the T-b1/T-b2 split) all remain intact and consistent.

The narrowing of C's reachability by §7.5.9 is **not** treated as a defect here: it is a principled, explicitly-labelled evidence-scope limitation with a named resolution path (§19.2), and the disposition rule forbids blocking merely because D is the provisional reading.

The block is for a different reason. **Verdict C has no satisfaction predicate at all.** C requires "§18's C1 refuted by S6′", and §18's C1 row states only "almost certainly fatal … S6′ confirms or refutes" — no named scalar, no comparison, no aggregation rule, no inequality. The default-to-D paragraph added this round does not repair that, because it is itself gated on an undefined judgment ("where S6′'s and S7′'s measured figures do not settle the question **mechanically**"): nothing states what settling it mechanically would consist of. A harness implementing §7.3's mapping therefore cannot evaluate C's third clause at all. It must either hard-code C as never-reached — silently deleting one of the four declared verdicts from a pre-registered experiment — or invent the missing predicate, which is a design decision the spec forbids the plan from making. That is both "an unreachable verdict" and "a missing design decision that the implementation plan would be forced to invent" under this review's own Critical definition. It is a **pre-existing** gap (it predates this round and this round explicitly declines to fix it), but its severity is now materially higher than in earlier rounds, because with condition 4 no longer routed through the effect rule, C's third clause is the *only* remaining discriminator between B and C.

A second determinacy defect sits immediately behind it: B and C can be simultaneously satisfied and the spec states no precedence between them (High, below). That one is latent only while C is unreachable; fixing the Critical makes it live, so the two must be fixed together.

Everything else found is fixable with small, local edits that do not change M4's direction. Lifecycle/concurrency (§9–§11), scope integrity (§16.3, §17, §21), the gate-first ordering (§17), and the memory metrics (§15.1/§15.2) are sound as written.

## Findings

Counts: **1 Critical, 6 High, 2 Medium.** Nothing below Medium is reported, per the severity policy. Every finding was cross-checked against two independent `codex-advisor` passes (H-3 and H-6 were first raised there and then verified against the spec text here; the rest originated in this read). Severities below are this review's own; the one place they differ from the advisor's is stated inside the finding (H-3).

### Critical

**C-1. Verdict C has no pre-registered satisfaction predicate; the default-to-D rule does not make it mechanical (§7.3 verdict C, §18's C1 row, §7.5).**

- §7.3 verdict C requires, in addition to B's conditions 1 and 3–8: "**§18's C1 refuted by S6′.**"
- §18's C1 row is the only place refutation is characterised: "one message pair per candidate — at R2's 1,978 candidates per source instance almost certainly fatal; **S6′ confirms or refutes**". §17's S6′ row produces "ms per message, bytes, total". Nothing anywhere states *which* scalar is compared, *to what*, under *which* aggregation, at *which* threshold.
- This round's mitigation — "where S6′'s and S7′'s measured figures do **not** settle the C1-versus-one-way-population question mechanically, **C is not reached** … the outcome falls to **D**" — presupposes a predicate for "settle mechanically" that does not exist. The evaluator must make exactly the judgment the paragraph exists to forbid before it can decide whether to apply the fallback.
- Consequences, both of which the review's Critical definition names explicitly:
  1. Under a strict pre-registered reading, **no measurement can ever affirmatively satisfy C's third clause**, so C is unreachable and the spec's promise of "exactly one of four verdicts" quietly becomes three.
  2. Under any other reading, C is reached by narrative argument from figures that do not decide it — which §7.3 itself forbids, and which the brief's check E ("B vs C distinction must be evidence-driven rather than narrative") rules out.
- The spec's own text concedes the gap ("Supplying a precommitted numeric predicate for C1 refutation is **not attempted here** and remains an unresolved gap in §18's C1 row"), and this is a *spec-internal* definition, not a missing external input like §7.5.1's target or §5.5's workload confirmation. Those are correctly wired to mandatory D; this one is not wired to anything.
- **This finding is not about C being narrow.** §7.5.9 routing most warm-narrow-phase failure shapes to D is a principled, explicitly-labelled evidence-scope limitation with a named resolution path (§19.2), and it is accepted here as a correct outcome of this round's correction, not a defect. C-1 is about the *remaining* path to C having no evaluable condition on it. The two are independent: even a run whose warm failure did include T-a — the one shape §7.5.9 does not capture — could not reach C today.

**Smallest correction that preserves the current direction** — one sentence in §18's C1 row plus one clause in §7.3, both pre-registered before any measurement:

> **C1 refutation predicate.** Let `Ω_C1` = S6′'s measured total round-trip `postMessage` cost (request + result messages, serialization and deserialization included) at the candidate volume actually measured for the tuple under evaluation, taken as the median across S6′'s repetitions. Let `Σ_sync` = the synchronous main-thread cost of the stage the boundary would move at that same tuple, from the same run. **C1 is refuted iff `Ω_C1 ≥ Σ_sync`** — the per-pair topology's own message cost alone erases the whole benefit it could deliver, which is exactly what §1.1's definition of C asserts. Where `Ω_C1 < Σ_sync`, C1 is **not** refuted and C is not reached.

Both operands are already measured (S6′ per §17; `Σ_sync` is the synchronous arm's figure S7′ already reports under condition 4(a)), so this adds no instrumentation and no spike. If the authors prefer a different anchor, any named scalar + inequality will do; what cannot stand is having none. Whichever is chosen, §7.5 must also gain a named D cause for "C1 predicate evaluated and not refuted / not evaluable" so the resulting D can be named and its resolution stated (see M-1).

### High

**H-1. §15.3 still invokes §7.4.2's effect rule, which §7.4.2 now forbids any condition from invoking, and demands evidence M4 structurally cannot produce (§15.3 vs. §7.4.2, §7.5.5, §7.3 condition 6, §17).**

§15.3's closing rationale reads: "a proposal exceeding `1.0 × base` may only be recommended if it **moves a *failing* target metric to *passing* under §7.4.2's effect rule**, a binary precommitted condition." Three problems, all introduced or exposed by this round's edit:

1. §7.4.2 now states "**No M4 verdict condition currently invokes this rule, and none may be read as invoking it implicitly**", and §7.5.5 declares itself "at present vacuous" **on that basis**. §15.3 is reached from §7.3 B condition 6 ("§15's memory budget met"), so the rule *is* invoked, and §7.5.5's vacuity claim is false as written.
2. "Moves a failing target metric to passing" is precisely the end-to-end demonstration §17 forbids M4 from producing and §19.2 defers to the adoption milestone. The carve-out is therefore unsatisfiable by any evidence M4 can gather.
3. §23's memory paragraph repeats the stale framing ("'proportionate gain' replaced by the binary effect rule"), as does §22.2's I6 entry.

Consequence: the budget itself stays mechanically evaluable (`delta ≤ 1.0 × base`, `peakΔ ≤ 2.0 × base`, Metric M controlling) and a violation simply fails condition 6 → D, which is the safe direction — hence High, not Critical. But an implementer reading §15.3 literally will look for an effect-rule comparison the spec elsewhere forbids.

**Smallest correction:** replace §15.3's final carve-out clause with, e.g.: *"A proposal exceeding either bound fails §7.3 condition 6 and cannot receive B or C in M4; no effect-rule carve-out applies, since §7.4.2's rule is invoked by no M4 verdict condition."* Sweep the matching sentence in §23's "Cache / memory evaluation strategy" paragraph.

**H-2. The narrow-phase B branch has no boundary it is permitted to name: §8.2 contains no precheck-only option (§7.3 condition 2, §8.2, §17's narrow-phase bullet).**

- §7.3 condition 2 requires "a **named** boundary **from §8.2**".
- §8.2's table is WB-0 (none), WB-1a (BVH construction only), WB-1b (full geometry preparation), WB-2 (**narrow-phase pair evaluation = precheck + exact queries + distance query**), WB-3 (clearance distance primitive only), WB-4 (whole query below extraction), WB-5 (extraction, ruled out).
- §17's only narrow-phase vertical is the Hard-Clash-precheck vertical, and this round's mirrored caveat states: "**This arm models a precheck-scoped boundary, and on its own proves only a precheck-scoped boundary**", with "Reporting a precheck-scoped result as evidence for an exact-query or distance-query boundary … forbidden."
- WB-2 strictly contains the exact-query and distance-query stages, so naming WB-2 on precheck-vertical evidence is exactly the over-claim the caveat forbids; WB-3 is a *different* substage; and no other row fits. So in the one narrow-phase branch that actually produces evidence, B has no nameable boundary, and the only strictly-conservative outcome is D — not because the evidence is missing but because the taxonomy is.
- The geometry side has no such gap precisely because §8.2 names both granularities (WB-1a and WB-1b), which is what lets the "isolate the sub-stage" caveat resolve to a named boundary. The narrow-phase side needs the same.

**Smallest correction:** add one row to §8.2 — `WB-2p | Hard-Clash precheck only | the `volumeOverlapQuery` precheck over the candidate list | (measured) | both operands' geometry + BVH + connectivity worker-resident, i.e. a worker-owned cache` — and reference WB-2p from §7.3 condition 2 and §17's narrow-phase bullet as the boundary the precheck vertical proves. (§8.2 already admits substage-scoped boundaries: WB-3 is one.)

**H-3. B and C can be satisfied simultaneously, and no precedence is stated (§7.3 verdicts B and C, §1's "exactly one of four verdicts").**

C is defined as "B's conditions 1 and 3–8 **as revised above** … **Plus all of**: [warm-narrow-phase failure] + [C1 refuted] + [S7′'s one-way-population overhead figure reported alongside]". C's conditions are therefore a strict *superset* of B's minus condition 2. A warm-narrow-phase failing tuple that satisfies B's conditions 1 and 3–8 with a named narrow-phase boundary (condition 2) and also satisfies C's three extra clauses satisfies **both** verdicts. §7.3 states no precedence, no "C wins where its extra clauses hold", and no "evaluate in order"; §1 nevertheless promises exactly one of four verdicts, and §7.3 opens "Read mechanically."

This is latent only for as long as C-1 leaves C unreachable — which is exactly why it must be fixed in the same pass as C-1 rather than after it. (The independent `codex-advisor` pass rated this Critical. It is recorded as High here because, as the spec currently stands, the overlap cannot actually be reached: C's third clause can never be satisfied while C-1 is open, so no run can produce two simultaneously-satisfied verdicts today. The rating would become Critical the moment C-1 is fixed without it.)

**Smallest correction:** state a verdict precedence rule once, at the top of §7.3: *mandatory D first (any §7.5 condition or §1.1 cause), then A, then C, then B; where C's extra clauses hold, C is the verdict and B is not reported.*

**H-4. B condition 8's "structural blocker outstanding" is ambiguous exactly where S1′ is most likely to land (§7.3 condition 8, §8.6, §17's S1′ row).**

Condition 8: "no structural blocker outstanding — in particular §8.6's module-resolution precondition **resolved by S1′**." §8.6 states the app has no bundler, that an import map is document-realm-scoped with no shipped mechanism for reaching a worker realm, and that if that holds "**no module worker built from the current source tree can resolve its imports**, and every worker option … acquires a prerequisite: a worker-specific build/rewrite step, worker entry modules using relative paths only, or a classic worker over a pre-bundled script." §17's S1′ row returns "Yes/no + the minimal change."

Two defensible readings of "resolved", producing opposite verdicts on the *expected* S1′ outcome:
- **(i)** S1′ answered the question and named a feasible minimal change ⇒ nothing is *outstanding* (the change is the next milestone's work) ⇒ condition 8 met;
- **(ii)** a required build/rewrite step is a prerequisite that has not been satisfied ⇒ blocker outstanding ⇒ condition 8 unmet ⇒ B and C both fall to D.

Under reading (ii), the single most likely S1′ result forecloses B and C for reasons unrelated to responsiveness evidence. That is a material, verdict-changing ambiguity in a document whose stated purpose is that the verdict is read off mechanically.

**Smallest correction:** replace condition 8's clause with an explicit three-case rule: (a) an as-served module worker resolves its imports ⇒ met; (b) it does not, but a permitted variant (relative-path-only entry, or a recorded build/rewrite step) is demonstrated feasible and the required change is recorded ⇒ **met**, with that change carried forward as an adoption prerequisite in §19.2; (c) no permitted variant demonstrates a feasible route ⇒ unmet, D, naming module resolution as the blocker.

**H-5. `Hᵢ` is defined at whole-task granularity and does not determine how a task containing both boundary-owned and non-boundary work is handled (§7.3 condition 4(b), §17's window note).**

`Hᵢ` is the only added quantity in the only mechanical check B and C rest on. This round scoped it correctly away from ambient work, but the operative sentence is: "**`Hᵢ` is the largest CDP main-thread task duration overlapping *only those sub-marks*.** Ambient tasks that run during the `await` … are **explicitly excluded**." A CDP task that overlaps a boundary-owned sub-mark *and* also contains other work admits two readings:

- **(A)** "overlapping only those sub-marks" is a filter on the task — a mixed task overlaps something else too, so it is excluded entirely and the boundary is charged nothing for it (`Hᵢ` understated, biasing toward B/C);
- **(B)** only wholly-ambient tasks are excluded, so a mixed task contributes its **full** duration including work the boundary did not add (`Hᵢ` overstated, biasing toward D — and directly contradicting the paragraph's own stated rationale for excluding work "the boundary freed the main thread" to run).

Near the 50 ms threshold these differ materially, and two harnesses can disagree on the verdict. The asymmetry with `Rᵢ` makes the gap sharper: condition 3 defines `Rᵢ` by careful *sub-interval* arithmetic inside each task (subtract covered portions; take the **longest contiguous** uncovered interval, "explicitly **not** the sum"), while `Hᵢ` is defined at whole-task granularity, and the two are then added together.

**Smallest correction:** define `Hᵢ` by per-task intersection arithmetic, at the same granularity as `Rᵢ`: *for each CDP main-thread task overlapping the worker arm's bracket, take the summed duration of that task's (non-overlapping) intersections with the boundary-owned sub-mark intervals; `Hᵢ` is the maximum of that figure over all tasks in the arm's window at repetition `i`. Unmarked portions of a mixed task contribute zero, and a task intersecting no sub-mark contributes nothing.* Note this deliberately **sums** a task's boundary-owned intersections rather than taking the longest contiguous one, and that difference from condition 3's rule is principled, not an inconsistency: `Rᵢ`'s contiguity rule models how a task *splits* once a stage is removed, whereas `Hᵢ` measures occupancy the boundary *adds* to a task — two boundary-owned chunks separated by unmarked work inside one uninterrupted task both lengthen that task. No new instrumentation is required; the sub-marks already exist and are harness-side.

**H-6. §17's vertical-selection rule uses "dominate" / "carries the failing cost" / "cleanly separate" with no numeric definition, and the intra-narrow-phase case has no fallback (§17's variant note).**

§17 says to "Rank the stages in that window by attributed duration; the vertical selected is the one whose stages carry the failing cost", then branches on whether geometry-preparation, narrow-phase, or main-only stages "dominate". No threshold defines dominance, no tie rule is given, and "when the attribution does not cleanly separate the first two" is itself undefined.

The cross-family case has a safe explicit fallback ("both variants run"), but the fallback is conservative only *after* classification — nothing stops one implementation from reading a marginal lead as decisive where another reads the same numbers as inseparable. The **intra-narrow-phase** case has no fallback at all: the precheck vertical "is selected **only when the Hard-Clash-precheck substage carries the failing narrow-phase cost**", and if the exact-query or distance-query substage carries it instead, no vertical exists and condition 4 is unmet at that tuple → D. With precheck at (say) 45% and exact-query at 48% of the failing window's narrow-phase time, one implementer runs the vertical and can reach B, another records condition 4 unmet and reaches D — from identical measurements. A related gap: the spec never says whether stage ranking is done per repetition, on the median across the five, or on the total across all five.

**Smallest correction:** fix the aggregation and use a strict-greater rule — no statistical dominance test is needed. E.g.: *rank stages by attributed duration summed within each family, using the median across the five repetitions; select the strictly larger family; where the two families tie at recorded precision, run both variants. Within the narrow phase, select the precheck vertical only where the precheck substage is the strict winner under the same aggregation; where the exact-query or clearance-distance substage is equal or greater, no matching vertical exists, condition 4 is recorded unmet at that tuple, and that tuple contributes D.*

### Medium

**M-1. Three evidence-based routes to D have no named cause, in a spec whose D reporting requires naming one (§7.5, §7.3's verdict-D paragraph, §17).**

§7.5's preamble requires "Each D verdict names which apply and exactly what would resolve them", and §7.3's verdict-D paragraph presents D as "§7.5's **nine** mandatory conditions … plus §1.1's *no-boundary* cause". But at least three outcomes produce D while matching none of them:

1. condition 4(b) evaluated and **failed** (`Rᵢ + Hᵢ > 50 ms` at some repetition) while condition 3's screen *passed* — §7.5.5 is now vacuous, and §7.5.9 requires T-a to *pass*, so neither applies;
2. condition 4 unmet "for want of a matching vertical" (§17's exact-query / distance-query substage case, and the unisolated-WB-1a case) — §17 names the logic but §7.5 has no entry;
3. C's extra clause recorded unmet (§7.3's default-to-D paragraph, and any successor to C-1's predicate).

The verdict itself stays determinate — A is excluded by the baseline failure, B and C are unmet, and §1.1's "mandatory, not merely available" phrasing makes D the residual — so this is Medium, not higher. But the report cannot name the cause or its resolution, and an unnamed D sits precisely where the spec works hardest to keep two D causes distinct; the risk of it being read as §7.5.9's *no-full-query-evidence* cause (a statement about M4's method) when it is in fact a measured negative about a specific boundary is exactly the conflation §1.1 and §7.5.9 forbid.

**Smallest correction:** add a tenth §7.5 condition covering "the evidence exists and does not satisfy §7.3 condition 4 at every scoped tuple (4(b) failed, no matching vertical, or C's extra clause unmet)", with its resolution stated as a different boundary/topology, lower measured boundary occupancy, or the §19.2 end-to-end measurement — and update the "nine" counts in §1.1, §7.3, and §23.

**M-2. §6.3 requires two main-only stages to be attributed that §16.4's closed instrumentation list cannot name (§6.3, §16.2, §16.4).**

§6.3's table marks "Result aggregation, dbId grouping, provenance mapping" and "Lifecycle validation and result publication" as instrumented "**No**" today with the requirement "**Must be attributed**", and §16.2 makes the §6.3 partition a mandatory first-class report section. §16.4's closed list authorizes yield instrumentation, narrow-phase interior labels plus the cause enum, an **extraction**-stage bracket, memory accessors, and the structured event recorder (whose `kind` enum is fixed at `clearance-distance-query | hard-clash-precheck | narrow-phase-pair | geometry-resolve`) — and "**Nothing else**". None of these brackets aggregation or publication, and neither CDP nor harness-side `performance.mark` can name a semantic stage *inside* `CollisionWorld`'s own synchronous code.

This is Medium rather than a blocker because nothing gates on it: §7.5.6's mandatory-D attribution condition names only the ~1.4 s cold gap, the direct precheck duration, and the inconclusive-cause breakdown (all covered by §16.4 items 2–3), and condition 3's screen derives main-only time by *subtraction* rather than by direct attribution. But as written an implementer faces a choice between adding a sixth hook — which the brief classifies as a blocker against the closed-list claim — and quietly under-delivering §16.2's mandatory partition section.

**Smallest correction:** state in §6.3 (or §16.4) that the aggregation and publication rows are attributed as a **lumped main-only residual** — window main-thread task time minus every classified stage, minus the extraction bracket — and are not separately instrumented; result-message volume for a hypothetical boundary comes from S7′/S6′, not from a library hook.

## Implementation-plan readiness check

- Gate-first sequencing: **PASS** — §17's ordering is explicit (gate partition → S1′/S3′ unconditional → S7′/S8′ only on baseline failure), and this round's added clause correctly handles the "baseline fails but no T-a-failing tuple" case by reducing S7′ to optional report-only coverage. Nothing permits S7′/S8′ before the baseline.
- Conditional spike gates: **PASS with H-6** — S5′, S6′, S7′, S8′ triggers are stated; only S7′'s *variant* selection lacks a numeric rule.
- Closed instrumentation sufficiency: **PASS with M-2** — condition 3's residual, `Hᵢ`'s sub-marks, and the S7′ brackets are all harness-side `performance.mark` + CDP and add nothing to §16.4; the only shortfall is the aggregation/publication attribution above, which does not gate a verdict.
- Verdict mechanics: **FAIL** — C-1 (no C predicate), H-3 (B/C not mutually exclusive), H-5 (`Hᵢ` granularity), M-1 (unnamed D causes). A, B, and D remain mechanically reachable; C does not.
- Lifecycle/concurrency semantics: **PASS** — §10.1's per-call `Map<requestId, RequestState>`, §10.2's complete settlement matrix (including duplicate, malformed, crash/terminate), the preserved disposed → evicted → placement precedence, the path-specific arming scope, and §10.4's eight S4′ scenarios leave no promise unsettled and introduce no latest-call-wins.
- Correctness-gate scope: **PASS** — §6.4's canonical comparator is correctly bounded to the TLAS-vs-linear comparison and full-result worker arms; the stage-scoped rule governs S7′, fails only that spike, and §16.2 and §17 both restate that consistently; full parity stays in §19.2.
- Memory gate implementability: **PASS with H-1** — Metric M is computable from §16.4.4's accessors, Metric H is explicitly a cross-check, worker and main-thread heaps are never mixed, peak/retained scopes are defined, and pending-message bytes have a concrete definition. Only §15.3's stale effect-rule carve-out is defective.
- Scope integrity: **PASS** — §16.3 (no `server.js` change; harness-owned express instance), §17 (no worker collision path, no blob/interception S1′ substitute, spikes confined to `spike/m4/` and deleted at close), §20, and §21 are mutually consistent; nothing authorizes worker implementation, new public APIs, Federated Clash Test work, UI, `AbortSignal`, latest-call-wins, or cross-origin-isolation changes.

## Required fixes before planning

1. **C-1 (Critical).** Supply a pre-registered C1-refutation predicate in §18's C1 row — one named scalar, one aggregation rule, one inequality — and reference it from §7.3's C clause; or, if the authors prefer, state explicitly that C is not reachable in M4 and route all C-shaped evidence to a named D. Either resolves the block; leaving the choice to the implementation plan does not.
2. **H-3 (High, must ship with fix 1).** State verdict precedence in §7.3: mandatory D → A → C → B.
3. **H-2 (High).** Add the `WB-2p` precheck-only row to §8.2 and reference it from §7.3 condition 2 and §17, so the narrow-phase B branch has a boundary it is permitted to name.
4. **H-5 (High).** Redefine `Hᵢ` as the per-task summed intersection with the boundary-owned sub-marks, maximised over tasks, so mixed tasks are handled determinately and the quantity is commensurable with `Rᵢ`.
5. **H-4 (High).** Replace condition 8's "structural blocker outstanding" with the explicit three-case S1′ rule.
6. **H-1 (High).** Delete §15.3's effect-rule carve-out (and the matching §23 sentence); a proposal over budget simply fails condition 6.
7. **H-6 (High).** Fix §17's vertical-selection aggregation (per repetition vs. median vs. total), make selection a strict-greater comparison, and state the intra-narrow-phase "no matching vertical → condition 4 unmet → D" fallback.
8. **M-1, M-2 (Medium).** Add the tenth §7.5 D cause (and update the "nine" counts); state that aggregation/publication are attributed as a lumped residual.

None of these requires re-opening M4's direction, re-designing S7′, reintroducing an improvement test, or loosening §7.5.9.

## Planning notes

- **Task order is already determined by the spec and should be lifted verbatim:** (1) the five §16.4 instrumentation additions; (2) `run-gate-m4.mjs` plus the §5.4 profiling/cohort pass; (3) the baseline gate across both runtimes, five counterbalanced repetitions, fresh world per `(runtime, case, broadPhase, repetition)`; (4) the §6.3 partition as a first-class report section; (5) S1′ and S3′ (unconditional, cheap, and S1′ gates every later worker task); (6) S4′; (7) only then, and only on a baseline target failure with at least one T-a-failing tuple, S7′ → S8′; S5′ and S6′ only if their own triggers fire.
- **S7′ is not plannable as a fixed task.** Its variant, its case set, and whether it runs at all are all functions of gate output. Plan it as a conditional task with the selection rule (post-H-6 fix) as its entry criterion, not as an up-front deliverable.
- **The verdict evaluator is itself an implementation task** and is where C-1 bites. Whoever writes the plan should schedule it explicitly (it encodes §7.2's aggregation rules, §7.3's conditions, §7.5's D causes, and the two distinct D-cause labels) rather than treating the verdict as a manual read of the JSON.
- **Counting nit for the plan, not a finding:** §23 says "Eight" spikes twice, but only seven exist (S1′, S3′, S4′, S5′, S6′, S7′, S8′ — there is no S2′). Plan seven.
- **`Rᵢ` includes ambient main-thread tasks by construction** (any task interval not covered by a transferable stage counts toward the residual), while `Hᵢ` excludes them. That asymmetry is correct — ambient Viewer work does remain on the main thread post-boundary, and counting it in both operands would double-charge it — but it is worth a one-line comment in the harness so a later reader does not "fix" it.
- The `Hᵢ` and condition-3 residual computations both need the CDP trace and the `performance.mark` anchors on the same clock; the harness should assert the anchor correlation per query window rather than assuming it, since every B/C figure depends on it.
