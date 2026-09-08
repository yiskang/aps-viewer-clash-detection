# M4 Final Focused Review

Reviewed document: `docs/superpowers/specs/2026-09-08-collision-library-milestone4-performance-worker-decision-design.md` (951 lines, read in full).
Review scope: structural readiness for `/superpowers:writing-plans` only. Not a redesign pass; the A/B/C/D verdict is deliberately not pre-decided here.
A second opinion on severity calibration for the three Critical findings was obtained via `codex-advisor` (request `20260909-010555-61018-4142`); it independently verified each against the spec text and reached the same Critical/High classification recorded below, and found no additional Critical contradiction.

## Verdict

BLOCKED

## Summary

Most of the spec is genuinely ready. The gate-first dependency chain (instrumentation → gate → main-only/transferable partition → target evaluation → conditional spikes) is stated consistently across §6.3, §16, and §17; the §16.4 instrumentation list is genuinely closed and, with two narrow scoping gaps, sufficient for every metric the spec binds itself to — no new hook is required; the §10 lifecycle model is complete and consistent against the eight §10.4 proof obligations and against the landed concurrent-call behavior; the §15 memory gate is mechanically evaluable; and no wording anywhere contradicts §17/§21's scope exclusions.

The blocker is confined to the evidence→verdict machinery. Three defects there each fall squarely on this review's own Critical bar, and each would force the implementation plan to invent a binding decision rather than plan specified work:

- **C1** — §6.4's applicability sentence still asserts the full correctness comparator governs "synchronous vs. any worker arm in a spike", with mismatch = `FAILED_VALIDATION` and a non-zero exit (§16.2). S7′ has a *stub result mapping* by §17's own construction, so every S7′ run would fail validation and B/C would be unreachable — an attenuated survival of the prior round's C1 finding.
- **C2** — B/C condition 3 ("the main-only remainder alone would meet the target") has no defined counterfactual measurement against T-b/T-c, and its parenthetical offers verdict C in exactly the case C's own condition list forbids.
- **C3** — §7.3 permits B to name a cold-only geometry-preparation boundary (WB-1a/WB-1b), but §17 pins S7′ to a warm precheck vertical and no other spike measures those boundaries, so two explicitly permitted B outcomes have no evidence path.

Two High findings (§7.2's aggregation unit omits the cold/warm state; T-b's two clauses share one aggregation rule) independently prevent two implementers from computing the same pass/fail from the same recorded data, which defeats the pre-registration §1 is built on.

All five are focused reconciliations, not redesigns. Nothing in the workload matrix (§5), the measurement protocol (§6.1–6.3), the boundary analysis (§8), the lifecycle model (§9–§11), the memory strategy (§15), the harness plan (§16), or the scope exclusions (§17, §21) needs to change. The required fixes total roughly a dozen sentences and are listed below.

## Findings

### Critical

#### C1 — §6.4 still pulls full worker parity back into M4, which would fail S7′ by construction

§6.4 opens: *"One comparator, used for **every** parity comparison (TLAS vs. linear in the gate; synchronous vs. any worker arm in a spike)."* (line 303) and closes: *"A run is **invalid** — `FAILED_VALIDATION`, non-zero exit — if any field above differs."* (line 313). §16.2 restates it as a hard harness requirement: *"Any §6.4 mismatch ⇒ `disposition: 'FAILED_VALIDATION'`, non-zero exit"* (line 715). The `distance` row explicitly anticipates a worker arm inside M4 (*"For a **worker arm only**, an absolute tolerance of `1e-9` is permitted"*, line 308).

But §17 states *"S7′ is a stage-scoped measurement vertical with a **stub result mapping**"* and *"No spike may build a working worker collision path"* (line 779), and §19.2 states the full comparator *"cannot be proven by M4"* and belongs to the next milestone's adoption prerequisites (lines 814–818). §6.4 requires final pair sets, `distance`, `witness`, six `statistics` fields, and a full `diagnostics` multiset. S7′ executes only the Hard-Clash precheck over the candidate list (line 772) — not the exact narrow phase, the clearance distance query, or dbId aggregation — so it cannot produce those fields without becoming the working worker collision path §17 forbids.

Applied as written, every S7′ run is `FAILED_VALIDATION` with a non-zero exit, and B/C become unreachable again. There is a narrower reading — that §6.4 binds only where something is *designated* a parity comparison — but its own parenthetical expressly names synchronous-versus-worker spike arms, so planning would have to choose which binding clause to ignore. §6.4 also offers no *stage-scoped* comparator variant, so the plan would have to invent what correctness checking, if any, S7′ is subject to.

**Smallest correction:** scope §6.4's applicability sentence to the gate's TLAS-vs-linear comparison plus any *full-result* worker arm, and add one sentence stating that a stage-scoped spike is compared only on the outputs it actually reproduces — for S7′, the precheck's `conclusive` / `inconclusiveCause` / excluded-pair distribution over the identical candidate list — with a mismatch there failing the spike, not the gate run. Keep the `1e-9` relaxation as-is, labelled as applying to a worker arm.

#### C2 — B/C condition 3 is self-contradictory and has no defined measurement

§7.3 condition 3 (line 352): *"§6.3's partition showing the **main-only remainder alone** would meet the target (otherwise no boundary can solve it, and the verdict is C or D)"*. Verdict C (line 359): *"Requires B's conditions 1 and 3–8"*.

**(a) The parenthetical contradicts C, and hides a hole in the verdict space.** C requires condition 3. If condition 3 fails, C is excluded by C's own requirement list, so the only remaining verdict is D — yet the parenthetical offers "C or D". §6.3 itself supports D, not C: *"If main-only work alone already violates the target, no boundary in §8.2 can fix it"* (line 299) — a broader off-main-thread architecture still leaves the declared main-only remainder on the main thread. Behind the contradiction is an uncovered outcome: when the baseline fails the target *and* the main-only remainder alone also fails, A, B, and C are all excluded, and D as defined in §1.1 (*"No decision yet / blocked. A prerequisite for a sound decision is missing."*) mischaracterises what is actually a decisive negative finding. None of §7.5's eight mandatory-D conditions covers it either.

**(b) The condition is not mechanically evaluable.** §6.3's partition produces per-stage *durations* and a main-only/transferable classification (lines 281–299). The target is defined (§7.2, lines 327–337) on CDP main-thread task maxima (T-a), rAF inter-frame p95 and max gap (T-b), and externally-generated input-handler delay p95 (T-c). Subtracting transferable stage durations from a trace does not mechanically yield the task boundaries, frame cadence, or input latency of a hypothetical main-only execution — moving work also changes task segmentation, message handling, yield placement, and frame opportunities. The spec supplies neither a direct experimental arm nor a valid transformation for that counterfactual. Only T-a admits a defensible screen (largest main-only-attributed contiguous task residual vs. 50 ms), and the spec does not say that is what is meant.

**Smallest correction:** restate condition 3 as a T-a-only screen on main-only-attributed task time (deferring T-b/T-c sufficiency to condition 4's S7′ measurement, which measures the real thing), change the parenthetical to "the verdict is D", and add one line to §7.5 (or §1.1's D description) recording "no boundary can close the gap because the main-only remainder alone fails the target" as a named D cause distinct from a blocked-on-external-input D.

#### C3 — S7′ cannot supply evidence for two of the three boundaries B is permitted to name

§7.3 B condition 2 permits the named boundary to be *"BVH construction, complete geometry preparation, or a batched narrow-phase service"* (line 351) — WB-1a, WB-1b, or WB-2 in §8.2's table. Condition 4 (line 353) then requires *"spike S7′ evidence … that **the named boundary** moves the failing metric to within target"*, phrased as though S7′ were parameterized by whichever boundary is named.

§17 pins S7′ to exactly one shape (line 772): *"Snapshot representative collision-owned data, transfer it **once** as a one-way population, execute the dominant warm workload (**the Hard-Clash precheck over the real candidate list**) in the worker, return compact results."* — a WB-2-shaped, warm-side vertical. §8.2 is explicit that WB-1a is *"~43 ms cold, zero warm"* (line 444), WB-1b *"up to ~316 ms cold, zero warm"* (line 445), and that *"**WB-1a and WB-1b are cold-only** … while **WB-2/WB-4 are where the warm cost is.** A verdict of B must say which."* (line 451). No spike in §17's table measures a worker-side weld / connectivity / BVH build.

So if the baseline fails T-a on a *cold* case — a live possibility given §3.1's cold profile and §2.1's finding that no checkpoint exists inside `new MeshBVH(...)` or `compactAndWeld` — the boundary the evidence points at has no spike that can satisfy condition 4, while §7.3 simultaneously invites naming it. Planning must invent another spike, broaden S7′, or silently drop two permitted verdict options.

**Smallest correction:** either (a) state in §17 that S7′'s vertical is selected by the failing side of the partition — the precheck vertical when the failure is warm, an extra-copy geometry-preparation vertical (§8.2's WB-1b shape) when it is cold — keeping the same bound, repetitions, and metrics and the same stub-result-mapping restriction; or (b) restrict §7.3 condition 2 to boundaries S7′ actually measures, and state that a cold-side boundary forces D with "no spike measures this boundary" recorded as the cause.

### High

#### H1 — §7.2's target-evaluation unit omits the cold/warm state dimension

§7.2 fixes the aggregation unit as *"Every evaluation is per `(runtime, case, broadPhase)`"* (line 337), and says T-b and T-c are *"computed **within** each repetition"* (line 336). But cold and warm are two distinct measured queries throughout the protocol: §5.6 (*"Cold/warm applies to R1–R6 and S2"*, line 240); §6.1.4 (*"Its **first** measured query is that tuple's *cold* sample; its **immediately following second** query … is the *warm* sample"*, line 251); §6.1.6 (*"5 repetitions per state"*, line 253); §6.1.7 (observers separately bracketed per query, line 254).

The binding decision key omits `state`, and the spec never says whether both states must pass, whether only warm is verdict-bearing, or whether the two windows are combined. The three readings give different numbers — §3.1's cold query is ~2,250 ms against a ~527 ms warm one, with necessarily different frame-cadence and task-timeline distributions — and the choice materially changes whether verdict A is reachable, since the cold path is where the ~1.4 s unattributed cost (§3.1, §7.5.6) lives. It also interacts with C3: a cold-only WB-1a/WB-1b boundary is nameable only if a cold-state failure is verdict-bearing in the first place.

**Correction:** extend the evaluation unit to `(runtime, case, broadPhase, state)` and state the pass requirement explicitly. If cold is deliberately excluded from the target, say so and give the reason — that exclusion is itself a decision the plan must not be left to make.

#### H2 — T-b is a two-clause threshold governed by a single-threshold aggregation rule

§7.2 T-b (line 330): *"the p95 inter-frame interval is at most **32 ms** … **and** no inter-frame gap exceeds **100 ms**"*. The aggregation rule (line 336): *"**T-b and T-c are percentile statistics.** Each is computed **within** each repetition; the case passes only if (i) the **median across the five repetition values** is within the threshold **and** (ii) **no single repetition exceeds 1.5× the threshold**."* — "the threshold", singular.

T-b carries two thresholds of different kinds: a percentile (32 ms) and what reads as a hard maximum (100 ms). §7.2 explicitly carves hard maxima out of medianing for T-a (*"Hard maxima are not medianed; a rare 61 ms task is exactly the event the target exists to catch"*, line 335), then classes T-b wholesale as a percentile statistic. The 100 ms clause therefore admits three defensible aggregations — 5/5 hard maximum like T-a; median of five per-repetition maxima; or the 1.5× rule, which would permit a 149 ms frame gap the clause's own wording forbids. They produce different case verdicts.

**Correction:** split T-b into T-b1 (p95 inter-frame ≤ 32 ms, aggregated as a percentile statistic) and T-b2 (no inter-frame gap > 100 ms, aggregated as a hard maximum requiring 5/5, like T-a), and reference both in §7.3's A condition and in §7.5.

### Medium

#### M1 — §16.4.5's retention rule discards what §12.4's repeat-rate row needs

§12.4 binds the harness to report *"Repeat rate of `(sourceFragmentId, targetFragmentId)` precheck evaluations within one call and across cold/warm"*. §16.4.5's retention rule enumerates what the sink keeps — *"per `kind` and per `stage`, it keeps counts, §6.1.8's full duration summary, per-covariate correlation accumulators (sums, sums of squares, sums of products), a per-`inconclusiveCause` histogram, and a bounded top-N (N = 20)"* — then: *"Raw events are discarded after aggregation."* No pair-keyed counter is in that list, so an implementer following §16.4.5 literally cannot compute the repeat rate. The fix is harness-only (the event payload already carries the pair identity), but the retention list reads as closed.

**Correction:** add "a bounded pair-key repeat histogram (counts of pairs evaluated 1×, 2×, ≥3× within a call, plus the cold/warm intersection size)" to §16.4.5's online-aggregation list.

#### M2 — §16.4.4's accessor scope is narrower than Metric M's inputs

§15.1's Metric M sums geometry terms **plus** `Σ_epoch [ tlas.primitiveBuffer.byteLength + tlasRecordCount × recordBytes ]`, `Σ_epoch [ placementCount × … ]`, and `Σ_epoch [ instanceCount × instanceBytes ]`. §16.4.4 authorizes only *"per-epoch geometry-entry count and enumeration of resident geometry entries (welded buffer byte lengths, BVH, connectivity)"*. Instance count is already public (`getEpochCollisionInstanceCount`), but the TLAS primitive-buffer/record terms and the per-epoch placement count have no accessor, and §2.5 notes `run-gate-m2.mjs` already reaches into privates for want of one. Metric M is the **controlling** memory metric, so the plan must otherwise choose between extending item 4 and reaching into `_placementByEpoch` / the TLAS cache from harness code — a decision the spec should make itself given §16.4's closed-list claim.

**Correction:** widen §16.4.4 to name the TLAS and placement accessors, or state that those two terms are read from privates by harness-only code (leaving §16.3's "must not modify `collision/` behavior" unchanged).

#### M3 — R6's measured sequence does not fit §6.1.4's two-query world model, and its target-evaluation unit is undefined

§5.6 states *"Cold/warm applies to R1–R6"*, and §6.1.4 fixes one world per `(runtime, case, broadPhase, repetition)` whose first query is cold and *"immediately following second"* is warm. But §5.2.1's R6 sequence is: run R3 warm and record `P₀` → apply the transform → `invalidateModelPlacement` → re-run and record `P₁` → reset and re-confirm `P₀`. That is three to four queries in one world, and it is warm-anchored by construction (*"on top of the ordinary warm cost"*). S4 is explicitly declared warm-only in §5.6; R6 is not, and no rule says which of its queries carries the cold sample or which query window the §7.2 target is evaluated on if R6 is verdict-bearing (§5.5).

**Correction:** state in §5.6 that R6 is warm-anchored, enumerate its measured queries (warm baseline / post-invalidation refresh / recovery confirmation), and say which one the target is evaluated on.

#### M4 — S2's `volume-overlap` arm cannot produce the `CAPACITY_REJECTED` finding §5.3 claims for it

§4 computes the linear ceiling as *"`⌊1,000,000 / 5,435⌋ =` **183** source instances (strict `>`, so 183 passes and 184 throws)"*. §5.3's S2 sweeps *"~10 / ~50 / ~100 / ~183"* extracted instances and asserts *"the **`volume-overlap` arms** reach the 183/184-instance linear boundary … **Both** are `CAPACITY_REJECTED` findings, not timings (§4)."* The top level is the largest value that *passes*, so the sweep as specified produces a timing, not a rejection, and whether the boundary is crossed at all depends on incidental overshoot from §5.4 step 4's "first reaches or exceeds `k`" accumulation. No verdict depends on it (S-cases are not verdict-forcing), but it defeats one of S2's two stated purposes and leaves open question 8's linear half unanswered.

**Correction:** add a level at the smallest cohort strictly exceeding the computed cap (184 on this fixture), and state that the cap is computed from the live per-target-epoch-group fragment counts rather than hardcoded.

#### M5 — §10.2's settlement matrix has no rule for a response that is unroutable or never arrives

§10.2 asserts *"**No unsettled promise is permitted under any of these conditions**"* — correctly scoped to the listed conditions. Two liveness cases fall outside that list: a message so malformed that `requestId` cannot be read (the "response malformed / schema-invalid" row presupposes a readable `requestId` to name in the rejection; an unroutable message can only be counted, leaving its request pending), and a response that never arrives without an `onerror` / crash / `terminate()`. Today's synchronous path cannot hang this way; a worker can. §10.4's eight scenarios exercise neither, so S4′ would not catch it. This is a completeness gap in the contract the *next* milestone implements rather than a planning blocker, but §10 exists precisely to close this hazard class.

**Correction:** add one row to §10.2 ("message unroutable — no readable `requestId`: counted, settles nothing; the worker protocol must guarantee exactly one routable response per request") and either a watchdog rule or an explicit entry in §19.2's adoption prerequisites for response liveness.

#### M6 — A failed S1′ has no defined verdict disposition, and no stated effect on the other spikes

§7.3 B condition 8 requires *"no structural blocker outstanding — in particular §8.6's module-resolution precondition **resolved by S1′**"*. §8.6 frames failure not as impossibility but as a prerequisite (*"a worker-specific build/rewrite step, worker entry modules using relative paths only, or a classic worker over a pre-bundled script"*), and §17 says *"If S1′ fails, the recorded finding is that a build step or relative-path rewrite is a prerequisite"*. §7.5's mandatory-D list contains no S1′ condition. So it is undefined whether a failed-but-diagnosed S1′ leaves the blocker "outstanding" (B/C excluded) or merely annotates a B/C verdict with a named prerequisite. Separately, §17's blob-URL / request-interception prohibition is written *for S1′*, without saying whether S7′/S6′/S3′/S4′ may proceed if bare-specifier resolution fails — S1′'s own *"at most one relative-path-only variant"* implies the fallback, but does not state it.

**Correction:** one sentence in §7.3 condition 8 (whether a failed S1′ with a recorded minimal change blocks B), and one in §17 (the other spikes use whichever module form S1′ established as working, under the same no-blob / no-interception rule).

#### M7 — §7.5.2's second clause is a mandatory-D trigger with no mechanical criterion

§7.5.2 makes D mandatory when §6.1.5b *"could not be run, **or produced results materially different from the historical configuration with no explanation**."* In a document that otherwise precommits every threshold, aggregation unit, and effect rule specifically so that *"Narrative judgement may not override a missing prerequisite"* (§7.3), "materially different … with no explanation" has neither a magnitude criterion nor a definition of a sufficient explanation — and §3.5's own argument is that the two configurations *should* differ, which under a strict reading would fire the clause routinely.

**Correction:** bound it (e.g. differences beyond §7.4.2's effect rule on the same paired repetitions, on a metric the verdict depends on), or demote it from a mandatory-D trigger to a mandatory *reported* discrepancy.

#### M8 — §23 states eight spikes; §17 defines seven

§23's "Required spikes" paragraph opens *"Eight, confined to `spike/m4/`"* and then enumerates S1′, S3′, S4′, S5′, S6′, S7′, S8′ — seven. §17's table has the same seven rows; there is no S2′. The count appears taken from the highest label rather than the row count, and a planner reading §23 first may look for a missing spike.

**Correction:** change "Eight" to "Seven" in §23, or note that the numbering skips S2′.

## Implementation-plan readiness check

- Gate-first sequencing: **PASS** — §6.3 (*"the gate must produce it before any worker spike is built"*), §16.4's instrumentation-first list, and §17's *"Ordering is load-bearing … S7′ and S8′ run only if the synchronous baseline fails the §7.2 target"* agree. No section allows or requires S7′/S8′ before the baseline establishes the trigger. S6′ is gated on S1′ and §18's C1 rather than on the baseline, which is a stated and deliberate difference, not a leak.
- Conditional spike gates: **FAIL** — the *triggers* are all explicit and unambiguous, but C3 breaks the required property that a conditional spike's output feeds the decision condition that consumes it: S7′'s fixed warm-precheck scope cannot supply §7.3 condition 4 for the cold-only boundaries §7.3 condition 2 permits B to name. (S7′'s wording is otherwise tight enough — *"stage-scoped measurement vertical with a stub result mapping"* plus *"No spike may build a working worker collision path"* — that an implementer could not reasonably build a production worker path from it. C1 is the inverse problem: a comparator that would reject the stub, not wording that would license a real path.)
- Closed instrumentation sufficiency: **PASS** — every §6.2 / §12.4 / §13 / §15 metric is producible from §16.4's five items plus CDP/Playwright, browser APIs, harness-only code, and spike-only code. **No new hook is required**, so the closed-list claim holds. M1 and M2 are scoping gaps inside items 4 and 5, not missing capabilities.
- Verdict mechanics: **FAIL** — C1 (worker-arm evidence invalidated by the comparator), C2 (condition 3 contradictory and unmeasurable; an uncovered outcome where A/B/C are all excluded), C3 (no evidence path for a cold-side B), H1 (aggregation unit omits state), H2 (T-b's two clauses share one rule). B/C do correctly avoid requiring full parity per §1.2 and §19.2, and D is correctly reachable, but the evidence→verdict mapping is not yet readable purely mechanically.
- Lifecycle/concurrency semantics: **PASS** — §10.1's per-call `Map<requestId, RequestState>` keeps `requestId` per-call and concurrent calls independently settleable; §10.2's matrix covers duplicate, malformed, generation-mismatch, eviction, armed-epoch placement change, and crash/`terminate()`, with precedence disposed → evicted → placement-revision preserving today's error set; the armed-epoch clause explicitly refuses to broaden arming, so the linear path gains no new abort behavior; `evictModel` stays synchronous and never-throwing (§10.3); no worker token is treated as identity authority (§9.2, §9.7, §8.4's *"echoed for revalidation, never an authority"*). Consistent with the landed behavior at `CollisionWorld.js:2591-2599`. M5 is a liveness edge outside the enumerated conditions.
- Correctness-gate scope: **FAIL** — C1. §14, §19.1, and §19.2 are individually correct and consistent (TLAS-vs-linear parity is a hard M4 gate; full real-worker parity is an §19.2 adoption prerequisite); §6.4's applicability sentence is the single place that pulls full worker parity back into M4.
- Memory gate implementability: **PASS** — Metric M's equation is computable and controlling; `recordBytes` / `instanceBytes` are derived empirically rather than guessed and printed for checking; Metric H is explicitly a cross-check under a fixed `--expose-gc` protocol; worker and main-thread heaps are measured and reported separately and never summed; peak is taken at a deterministically identifiable point; pending-message memory has a concrete definition (`byteLength` in flight plus serialized payload size); and §7.5.7 keeps the provisional 1.0×/2.0× multipliers consistent with mandatory D. M2 is the one input-scoping gap.
- Scope integrity: **PASS** — every exclusion in the brief is honored. §16.3 and §17 keep spike code out of `collision/` and `wwwroot/` and obtain a same-origin served worker module via a test-only express instance rather than a `server.js` change; §21 restates the full non-goal set; §11.3 and §20 forbid an `AbortSignal` and latest-call-wins; §8.7 refuses a cross-origin-isolation change and routes that case to D; §16.1 keeps `run-gate*.mjs` for M1–M3 unmodified. §16.4.2's production edit to `volumeOverlapQuery` / `classifyHardClashPrecheck` is genuinely additive (existing diagnostic string and `conclusive` boolean unchanged) and falls inside §1's declared instrumentation carve-out.

## Required fixes before planning

Blocking (all three are focused reconciliations; none changes the M4 direction, the workload matrix, the instrumentation list, or the spike set):

1. **C1** — Scope §6.4's applicability sentence to the gate's TLAS-vs-linear comparison plus any full-result worker arm, and add one sentence giving a stage-scoped spike validation appropriate to the stage it actually executes (for S7′: the precheck's `conclusive` / `inconclusiveCause` / excluded-pair distribution over the identical candidate list), with a mismatch failing the spike rather than the gate run.
2. **C2** — Restate §7.3 condition 3 as a T-a-only screen on main-only-attributed task time; change its parenthetical from "C or D" to "D"; and record in §7.5 (or §1.1) that "the main-only remainder alone fails the target" is a named D cause distinct from a blocked-on-external-input D.
3. **C3** — Either make S7′'s vertical selected by the failing side of the partition (warm precheck vs. cold extra-copy geometry preparation), keeping its bound, repetitions, metrics, and stub-result restriction; or restrict §7.3 condition 2 to boundaries S7′ actually measures and force D for a cold-side boundary with the reason recorded.

Strongly recommended in the same pass, since both defeat §1's pre-registration guarantee and are cheaper to fix now than after the harness's verdict logic exists:

4. **H1** — Add `state ∈ {cold, warm}` to §7.2's evaluation unit with an explicit pass requirement (or state and justify a cold exclusion).
5. **H2** — Split T-b into a percentile clause and a hard-maximum clause with separate aggregation rules.

The eight Medium findings do not block planning and can be folded into the same edit pass or deferred.

## Planning notes

1. **Instrumentation is the only unconditional prerequisite chain.** §16.4 items 1–5 land first; item 3 (extraction bracket) and item 2 (narrow-phase interior labels + cause enum) are what make §6.3's partition and §7.5.6's mandatory-D condition resolvable, so they gate everything downstream. Items 1–3 and 5 are declared useful independent of the verdict, so they are safe to sequence early even if M4 ends at D.
2. **Three tasks look independent but consume measurement output.** §6.3's partition (a *gate* output, not a spike) and §7.2's target evaluation both gate S7′/S8′; S3′'s cold-start figure decides whether S5′ is required at all (§17's S3′ row, §11.3). Plan S5′, S6′, S7′, and S8′ as conditional tasks with their trigger stated, never as unconditional work.
3. **S1′ runs first and is cheap, but its outcome shapes every later spike's module form.** Sequence it ahead of S3′/S4′ even though all three are unconditional, so the later spikes inherit a known-working worker entry form (see M6).
4. **The cohort algorithm degenerates at the top of the S2 sweep, by design.** §5.4 step 3's band width is `w = max(3k, 25)`; at `k = 183` that is 549 entries against a Structure model of 543 fragments (§3), so the band becomes all of `L` and the three density cohorts collapse toward each other. §5.4 already requires this to be recorded — treat "cohorts recorded as degenerate at high `k`" as an expected output, not a bug to chase.
5. **`modelTag` is a harness-side concept with no library backing.** §6.4's pair-set key and diagnostics multiset key both use `modelTag`, while §19.1 requires provenance compared by strict `===` `Model` identity rather than `modelId`. Nothing in `collision/` supplies a tag, so the harness assigns one per fixture role at load time and carries the `Model` reference alongside it. No library change needed, but it belongs in an early harness task.
6. **`run-gate-m4.mjs` is standalone by decision, not by omission.** §16.1 forbids extracting a shared helper and requires the M1–M3 gates byte-stable; plan the ~80 lines of duplicated summarizer/fixture boilerplate as intended duplication so a later reviewer does not "fix" it.
7. **Two harness sub-systems have no prior art in this repo and deserve their own tasks:** CDP trace capture with task-timeline extraction (§6.2 X-1/X-2), and the Node-side trusted-input probe with clock-correlation calibration and censored-observation handling (§6.2 X-1). Both are new capability, unlike the rAF cadence recorder and span recorder, which extend the existing `browser-probes.mjs` / `checkpoint-recorder.mjs` patterns.
