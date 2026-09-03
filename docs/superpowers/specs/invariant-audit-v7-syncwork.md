# Invariant audit v7 — System 4: Synchronous-work / budget / scheduling

**Target**: `docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md` (4712 lines).
**Model**: `invariant-audit-v7-model.md` §4 (with §2/§3 cross-references).
**Method**: every line citation below was read directly out of the current file during this pass.
No prior disposition doc (`round-18-*` … `round-29-*`, `invariant-audit-v1` … `v6*`) was treated as
evidence that anything is fixed; where Round 29 claims a fix, I re-read the live text to confirm or
refute it. Changelog text (lines 40–799) is treated as historical narration, never as an invariant.

**Baseline for NEW-vs-PRE-EXISTING**: `round-29-budget-scheduling-medium-low-disposition.md`, the
most recent pass over this exact system.

**Counts**: Critical 0 · High 2 · Medium 3 · Low 4.

---

## Verification of the six invariants I was asked to re-check

| Invariant | Verdict | Live citations |
|---|---|---|
| Canonical four-class scheduling taxonomy (three in-formula tiers + a separately-stated excluded class) | **Holds structurally, but is not exhaustive** — see M2 and H2 for two units that fall in no class | tiers 1971–1995 / 1996–2018 / 2019–2047; excluded class 2110–2125 + rows 1948, 1951 |
| `frameBudgetMs` bounds cooperative composition only, not everything | **Holds** | 2019–2020, 1946, 2972–2975; the ceiling check is explicitly "**not gated by `frameBudgetMs`** but by the ceiling itself" (1460–1461); "the *composition* of many such calls is what `frameBudgetMs` bounds, not any single call's own cost" (1946) |
| Traversal-local `bvhcast` clock is a deliberate, clearly-scoped exception | **Holds**, and Round 29's M6-B5 split (same constant / not always same clock) is present in the live text at 2150–2154; `SurfaceCrossingWitness` is explicitly excluded from the exception at 2008–2014, 2084–2086, 2151–2152; the "except `bvhcast`'s own internal abort clock" carve-out is at 2035 | 1869–1894, 1996–2003, 2084–2093, 2150–2154, 4439–4440, 4470–4473 |
| Accepted atomic risks never falsely described as bounded | **VIOLATED at exactly one site** — see H1 (4628). Every other site is correct: 1948, 1951 ("— (no ceiling; accepted atomic risk)"), 2110–2125, 2834–2836, gate carve-out 4445–4450 | — |
| Corrected worst-case-synchronous-span derivation internally consistent | **Arithmetic holds** (`8 + 16.8 = 24.8`; abort-only tier `8 + (8 + probe) ≈ 16ms`; the ~22.9ms connectivity+BVH counterexample at 1359–1360 sits under 24ms; the structural prefix argument at 2102–2108 is sound and does not depend on unit count). **The identification of welding as the controlling term does not hold** — see M3 | 2049–2108, 1355–1366 |
| Gate criteria match the guarantees made elsewhere | **Mostly holds** — criterion 1's 24.8ms line, its two accepted-risk carve-outs, and its `enumNodeChildren` provisional exception all mirror 2110–2125 and 2075–2083 exactly. **Two mismatches**: the formula's revision trigger is stated in as-measured units while criterion 5 produces ceiling-normalized ones (M3), and one synchronous unit criterion 1 would enforce at 24.8ms is bounded by nothing in the design (H2) | 4436–4457, 4476–4485 |

Round 29's other claimed fixes were re-verified as **present and correct in the live text**:
M6-B4 (`frameBudgetMs` + one probe, at all three sites: 1881–1888, 2001, 2087–2090; changelog
annotation at 772–777) · M6-B5 (2150–2154) · L6-B1 (annotation at 729–731) · L6-B4
(`SurfaceCrossingWitness` probe named at 4462–4463 and 4470–4475; extraction's per-sibling-node span
named at 4490–4496) · L6-B6 (literal 24.8ms at 4438/4441–4443/4452–4455, with the ≈24ms shorthand
retained in non-enforcement prose) · M-Q5 (`// candidate-count, crossing-count, or elapsed-time
ceiling hit` at 3522) · the "stage" disambiguation clause (2966–2969).
**M6-B2 is only half-fixed — see M1.**

---

## Critical

None. See H1 for why the worst-case-bound contradiction is rated High rather than Critical.

---

## High

### H1 — The Risks section asserts, in the present tense, exactly the worst-case bound the budget section spends 16 lines disclaiming

**PRE-EXISTING.** Round 29 did not touch this bullet and does not list it among its findings.

**Site A (Risks, lines 4622–4632)** — normative body text, not the changelog:

> "With `maxCandidatePairsExamined` added this round, **the budgets do now bound the worst case** — but
> note that claim was made in round 5 and was **false when written**: nothing capped the raw candidate
> loop, so a dense leaf overlap could run for seconds. Treat 'the budgets bound it' as a property to
> re-verify whenever a new traversal is added, not as a standing invariant." (4628–4632)

**Site B (worst-case-span derivation, lines 2110–2125)** — also normative body text:

> "**This corrected formula is still not a finite worst-case-span guarantee for the whole design, and
> Round 22 does not claim it is one** … the table above deliberately contains rows with no ceiling at
> all — one non-recursive `enumNodeFragments(node, cb, false)` call, and
> `releaseEpochScopedState`/`dispose()`'s own per-epoch registry sweep …, for which **this spec claims
> no bound and accepts the cost as a Milestone-1 risk**. Both rows … are **explicitly excluded from the
> formula above and from any finite worst-case-span guarantee this spec makes.** A model in which one
> node directly owns a pathological fragment count … can produce a single synchronous span longer than
> the formula's value **by a margin this spec does not state, because it does not know it**."

**The contradiction still exists**, at the drifted line numbers above. It is sharpened by 2137–2138,
where the budget section reaches into the *same* Risks bullet and cites only its second half — "This
is also the concrete reason for the standing warning under **Risks**: treat 'the budgets bound it' as
a property to re-verify" — quoting the sentence that follows the assertion it contradicts, without
noticing the assertion.

**Adjudication — Site B reflects the document's actual, currently-intended guarantee.** Five
independent, mutually consistent normative statements say the design makes no global bound:

1. the exclusion paragraph itself (2110–2125);
2. the atomic-operations table's two ceiling-less rows, `— (no ceiling; accepted atomic risk —
   flagged for re-derivation)` (1948) and `— (no ceiling; accepted atomic risk)` (1951);
3. the "what the formula *does* bound" enumeration (2127–2136), which is a *subset* list, not a
   universal one, and which closes "Even over those it is only as good as the table's unmeasured rows";
4. `enumNodeFragments`'s own prose: "one non-recursive `enumNodeFragments(node, cb, false)` call
   **remains an accepted, non-preemptible Milestone-1 atomic risk**" (2834–2836);
5. **the performance gate operationalizes Site B, not Site A** — criterion 1 carves out "the two
   synchronous spans this spec explicitly excludes from any worst-case-span guarantee … for which a
   measurement above the corrected bound is a required recorded finding, **not a gate failure**"
   (4445–4450), and criteria 8 and 9 (4519–4539) exist solely to measure those two risks.

Site A's first clause is stale round-5/6-era narration ("added **this round**") that has survived
into the current Risks list unannotated, in a document whose stated convention is to *annotate*
superseded claims rather than leave them standing (the convention is applied elsewhere at 330–334,
605–607, 729–731, 772–777).

**Why this matters rather than being cosmetic.** Risks is the section an implementer reads to learn
what is accepted rather than guaranteed. A reader who stops at 4628 concludes the budgets bound the
worst case and has no reason to run gate criteria 8 and 9 — the two measurements whose entire purpose
is that they are *not* bounded. The document itself names this exact failure pattern as its own
root cause twice: round 11's gap came from "two genuinely different claims … conflated under 'the
budgets bound the worst case'" (1966–1969), and a fixture note states "the round-7 lesson was that
each new traversal needs its own bounding proof rather than inheriting the claim that 'the budgets
bound the worst case'" (4003–4005).

**Secondary, weaker instance of the same shape**: 1772–1773, in `SurfaceIntersectionQuery`'s
normative body — "while the spec claimed its budgets bound the worst case. **That claim is only true
once both modes traverse the same way.**" This states a necessary condition, and both modes now do
traverse the same way, so it reads as a live endorsement of Side A. It is weaker than 4628 (it never
asserts sufficiency) but should be corrected in the same pass.

**Severity: High, not Critical.** No behavioural question is left undetermined — the intended
guarantee is unambiguous under any weighted reading, the offending clause is self-undercut within its
own sentence, and no ceiling, mechanism, fixture, or gate criterion depends on Site A. A reasonable
case for Critical exists (a spec asserting and disclaiming the same guarantee in normative text, on
a claim the document itself twice records as previously false and once names as a root cause) and I
would not object to the synthesis pass promoting it.

### H2 — The `CollisionInstance` capacity admission's recompute-and-commit is a structurally non-preemptible synchronous unit that belongs to no scheduling class, appears in no formula, and is measured by no gate criterion

**NEW as a finding.** Round 29 did not address it; the v7 model flagged it as `[SILENT]` (§4.3.2).
Cross-system: the cache auditor is checking the same step from the ownership side.

**What the step is** (stated identically at 2860–2872 and 1289–1300):

- step 2 — "look up the affected epoch's bucket … and **recompute** — against that bucket's *current*
  contents, not a count carried over from earlier in the walk — **which of the call's unique fragment
  ids are still missing**" (2860–2864). Cost: O(call's complete unique fragment-id set).
- step 3 — "**In that same synchronous step — no intervening `await`, no call out to any external
  callback, getter, or other reentrant operation** — check … capacity … Otherwise create the bucket
  … and **construct and publish a canonical `CollisionInstance`** (frozen, `fragmentId` +
  `GeometryIdentity`, no transform state) **for every missing fragment id**" (2865–2872). Cost:
  O(missing) object constructions, freezes, and `Map` writes.

The await-free property is **mandatory, not incidental**: it is what makes "two concurrent calls
cannot both pass against the same stale capacity observation" (1299) true. So this is a synchronous
span the design *requires* to be non-preemptible.

**What the document says about its cost.** Only line 1952: "A synchronous size comparison against a
bucket's current count is **O(1) per affected epoch**; the check itself is cheap." That costs the
comparison in step 3 and nothing else. The recompute and the commit are never costed, never assigned
a tier, and never named in the formula.

**Why this is a real gap and not a nit.** The taxonomy at 1971–2047 is asserted as exhaustive —
"**Every checkpoint named in this document … is this same mechanism**" (2034–2035) — and the formula
partitions the design into a covered set (2127–2136) and an explicitly-excluded set of exactly two
rows (2110–2125). This unit is in **neither**. Consequences:

- The scale is not small. The recompute runs over the call's whole unique fragment-id set, bounded
  only by `maxFragmentsPerDbId` (`5_000`, provisional) × the number of requested dbIds — and **no
  ceiling anywhere in the spec bounds the number of requested dbIds** (the per-dbId checkpoint at
  2730–2734 bounds composition across dbIds by yielding, which this step's mandatory await-free
  property forbids it from doing). The commit is bounded by `maxCollisionInstancesPerEpoch`, whose
  "value [is] not yet chosen" (1952).
- Gate criterion 1 (4436–4457) would enforce 24.8ms on it as an unnamed "single synchronous task",
  and it is not one of the carve-outs — so a large-model run that exceeds 24.8ms here reads as a
  **gate failure against a bound nothing in the design establishes**.
- Gate criterion 10 (4540–4549) measures this cache's *retained size per epoch across a session* —
  explicitly "the *steady-state ceiling* … not one call's marginal cost" (4544–4545). It is the wrong
  measurement for this span, and no other criterion covers it.

This is the same shape Round 21 closed for `releaseEpochScopedState`'s sweep — an enumerative,
required-non-preemptible step that had grown from "drop some map entries" into real work without
anyone classifying it (1951, "Unmeasured, uncategorized in this table until this pass"). The fix
shape is the same: a table row, a tier assignment (or an explicit third exclusion), and a gate
criterion.

---

## Medium

### M1 — Round 29's M6-B2 fix landed at one of the two sites; the Data Flow copy still states `~16ms` as the gate's *current* pass criterion, unannotated

**PRE-EXISTING, and Round 29 claimed to fix it.** M6-B2's disposition entry (round-29 doc, 70–76)
describes updating "the `maxBroadPhaseInstancePairs` atomic-operations table row" only. The identical
comparison in Data Flow was left untouched.

**Site 1 — atomic-operations table, `maxBroadPhaseInstancePairs` row (line 1950), annotated:**

> "at O(µs)/test the ceiling case is ~1,000ms, **~40× the gate's own ≈24ms worst-case-span bound**
> (Round 18's own comparison used this document's then-current ~16ms figure, superseded by Round 22's
> re-derivation; the conclusion is unchanged either way)"

**Site 2 — Data Flow step 3, broad phase (lines 2893–2898), unannotated:**

> "At this table's own stated O(µs) per AABB-overlap test, `1_000_000` pairs is roughly **1,000ms** of
> uninterruptible synchronous work — the largest single span in this design, about **60× the
> performance gate's own ~16ms pass criterion**"

**Current state confirmed by direct read.** The Data Flow sentence is present-tense and names "the
performance gate's own ~16ms pass criterion" as a live fact about the gate. The gate's own criterion 1
states "**24.8ms** (`8 + 16.8`)" and explicitly says it is "not the ≈16ms this criterion stated
through Round 21" (4438, 4443–4444). So the Data Flow text asserts, as current, a figure the gate
section itself names as retired.

**Correct figure per the document's own derivation**: the enforceable pass/fail line is the literal
**24.8ms** (4441–4443), with **≈24ms** as the sanctioned informal shorthand (2071–2073). The ratio is
therefore ~40×, not ~60× — exactly as the table row now states. The two sites' arithmetic disagrees by
1.5×, and the conclusion each draws (chunking was necessary) is unchanged either way.

`invariant-audit-v6-syncwork.md` line 332 recorded this site as "deliberately retained as Round-18
narration per the disposition" — but **no annotation in the spec says so**, and the document's own
convention for a superseded claim it wants to keep is to annotate it in place (the sibling site at
1950 does exactly that). Round 29 fixing one twin and not the other makes the inconsistency worse than
it was: a reader now sees the same arithmetic done two different ways, one flagged as superseded and
one not.

### M2 — `SurfaceIntersectionQuery`'s `bvhcast` traversal is absent from every part of the scheduling taxonomy

**PRE-EXISTING; not a Round-29 finding.** Cross-system: the query auditor is checking this from the
query side.

`SurfaceIntersectionQuery` is defined as "the *same* `bvhcast` traversal `ProperCrossingQuery` uses,
using the same `maxCandidatePairsExamined` ceiling, with a fresh traversal-local
`candidatePairsExamined` counter for each traversal, the same per-candidate `intersectsTriangle` test,
and **the same abort protocol** — with a weaker predicate" (1775–1779). It is not mentioned in:

- the abort-only tier (1996–2018), which names only `ProperCrossingQuery`'s traversal and then calls
  `SurfaceCrossingWitness` "**a second** `bvhcast`-native traversal" (2008–2010) — a count that
  presupposes only two exist, while a fixture note states "`ContainmentModeQuery`'s second composition
  term added a **third** traversal to the design" (4003–4004);
- the worst-case-span formula's tier list (2084–2093);
- the "what the formula *does* bound" enumeration (2127–2132);
- the clock-basis reconciliation (2150–2154), which names only the yield-and-resume mechanism,
  `SurfaceCrossingWitness`, and `ProperCrossingQuery`.

**What is under-determined.** Whether its time-abort reads the private, traversal-local clock (by
inheritance from "the same abort protocol") or the shared accumulator (like the other witness
traversal) is nowhere stated. If it inherits the private clock, then "**this is the one documented,
deliberate exception** to the shared-accumulator convention" (2001–2003) is either wrong or must be
read as scoped to the mechanism rather than the call site. More concretely, the abort-only tier's
addend is derived as "`frameBudgetMs` + **one probe's own cost**" (2087–2088, 1881–1884) — and
`SurfaceIntersectionQuery` has **no probe ladder at all** ("neither the coplanar split … nor the probe
ladder (no interior classification, hence no parity, hence no closure precondition)", 1779–1781). Its
only checkpoint granularity is callback entry, so its overshoot unit is one triangle-triangle test
(~0.3µs per 1945), not one probe.

**No correctness hazard results** — the substituted unit is strictly cheaper, so the ≈24ms/24.8ms
headline is unaffected. The defect is that a taxonomy that asserts its own exhaustiveness (2034–2035)
omits a member, and that the omitted member's bound is inherited by cross-reference rather than
derived — precisely the pattern 4003–4005 names as the round-7 lesson ("each new traversal needs its
own bounding proof rather than inheriting the claim that 'the budgets bound the worst case'").

### M3 — "welding is the largest" does not survive the ceiling-normalization argument Round 29 itself introduced, and the formula's revision trigger is stated in different units from the measurement that would trigger it

**NEW / aggravated by Round 29's own M6-B3 edit.** The "welding is the largest at ~16.8ms" claim
predates Round 29 (Round 22), but Round 29 added the ceiling-scaling reasoning that now contradicts it.

The formula at 2065–2071:

> "Of this tier's four members, three are measured — **welding is the largest, at ~16.8ms**. That
> figure was measured at ~19,800 triangles …, not at the `12_000` sync-triangle ceiling itself;
> **scaled down to the ceiling the true cost is smaller (~10.2ms)**, so using the as-measured ~16.8ms
> figure here is conservative, not tight. `frameBudgetMs` (`8`) plus that is **≈24ms** — precisely
> `8 + 16.8 = 24.8ms`"

The scaling argument is applied to the weld row only. The BVH row is "**Measured** (Spike Findings):
~16ms to build a BVH at **18k** triangles" (1944) — also above the ceiling, also unscaled. Applying
the same reasoning: weld = 16.8 × 12000/19800 ≈ **10.2ms** (the doc's own number); BVH = 16 ×
12000/18000 ≈ **10.7ms**. **At the ceiling the BVH phase, not welding, is the controlling term.**
Per-triangle the two measurements already say this: 0.85 µs/tri for weld vs 0.89 µs/tri for BVH.
"Welding is the largest" is an artifact of comparing two measurements taken at different triangle
counts.

**The numeric bound is unaffected and remains conservative** (`8 + 16.8 = 24.8` exceeds `8 + 16` and
both ceiling-scaled figures), so this is not a soundness break. Two things do break:

1. **The controlling-term identification is wrong**, and the document leans on it: the clock-basis
   passage justifies admitting the `bvhcast` traversal to the abort-only tier by comparing against
   "the independently measured ~16.8ms weld phase" specifically (1888–1893), and 1355–1360 builds its
   whole per-phase compounding argument on welding-exceeds-`frameBudgetMs`-always. Both would need
   restating against the BVH phase if the ceiling-normalized figures are the operative ones.
2. **Gate/guarantee unit mismatch.** The formula's revision trigger is "if that measurement exceeds
   **~16.8ms**, this tier's addend … must be revised upward" (2081–2082) — an as-measured,
   above-ceiling figure. Gate criterion 5 requires "each of the three build phases … measured
   individually, **at `maxSyncTriangleCount`**" (4476–4477) — i.e. ceiling-normalized. The gate will
   therefore produce three phase costs around ~10ms and one `enumNodeChildren` figure, and the rule
   for what to do with them is stated against a number in the other unit. Nothing in the text says
   which unit the ≈24ms figure is meant to be expressed in after the gate runs.

---

## Low

### L1 — A third, distinct sense of "~16ms" is live in the `ThreeMeshBvhBackend`/`BlasCache` passage

**PRE-EXISTING.** Lines 1339–1345: "so **the accepted per-atomic-operation ceiling (the same ~16ms a
single BVH build was already allowed to cost**, see the atomic-operations table) now applies to each
phase individually … A build that needs all three phases … therefore still costs **up to roughly 3×
that ceiling** in wall-clock time, same as before."

Three problems, none of them severe:

- This "~16ms" is a *per-phase cost allowance*, a different quantity from the retired "~16ms span
  bound" the document elsewhere works hard to distinguish from 24.8ms. Three senses of "~16ms" now
  coexist (per-phase allowance here; the abort-only tier's composed span at 2090; the superseded gate
  figure). Only the second is defined at its site.
- The doc's own measured weld figure (~16.8ms, 1942) **exceeds** the "~16ms ceiling" this sentence
  says each phase now respects.
- "up to roughly 3× that ceiling" (~48ms) sits two lines above the 24.8ms span bound with no
  statement that they measure different things (wall-clock across yields vs. one synchronous span).
  A reader arriving here first can reasonably misread 48ms as a span claim. The passage's own Round-22
  correction (1345–1366) implicitly resolves it, but never says so.

### L2 — "in the same category as the three `maxSyncTriangleCount` phases" invites reading the two ceiling-less risks as bounded

**PRE-EXISTING.** Both accepted-risk descriptions place themselves alongside the three *ceilinged,
measured, in-formula* build phases: "**Non-preemptible, same category as the three
`maxSyncTriangleCount` phases**" (1948, and again 1951), and "in the same category as the three
`maxSyncTriangleCount` phases (welding, connectivity, BVH construction)" (2834–2836). The intended
sense is "non-preemptible", which is correct; the read-off sense is "bounded like them", which is
exactly backwards — the three phases are the formula's covered set and these two are its explicit
exclusions. Each row does carry "— (no ceiling; accepted atomic risk)" adjacent, which is why this is
Low rather than Medium.

### L3 — Unannotated `~16ms` narration inside the gate section

**PRE-EXISTING.** Line 4432: "**Round 9 added the cache-warm run specifically**: the build-only yield
rule made the cold run's **~16ms bound** plausible without ever exercising the composed-stage/cross-pair
case…". Past-tense narration of Round 9's reasoning, so it is defensible as historical — but it sits
four lines above criterion 1's "not the ≈16ms this criterion stated through Round 21" (4443–4444),
and unlike the table row at 1950 it carries no annotation. Distinct from M1: that site states the
figure as current, this one narrates it.

### L4 — Two `ProperCrossingQuery` fixtures assert a `frameBudgetMs`-scaled wall-clock bound without naming the derived figure

**PRE-EXISTING.** 3808 ("must abort with `crossing-budget-exhausted` and complete within a wall-clock
bound") and 3848 ("complete within a **`frameBudgetMs`-scaled wall-clock bound**"). The clock-basis
passage derives an exact figure for this traversal — `frameBudgetMs` + one probe's own cost
(1881–1884) — and the formula composes it to ≈16ms (2087–2090). Neither fixture cites either, so the
Round-29 M6-B4 correction (which replaced the unexplained ~2× factor) is not reflected in the fixtures
that would catch a regression of it.

---

## Historical-only / non-defect observations

- **The Revision Notes annotations are correct and current.** 602–607 (Round 18's "~16ms criterion"),
  729–731 (Round 21's "~16ms tolerance band"), and 772–777 (Round 22's "~2×`frameBudgetMs`"
  parenthetical) all carry in-place superseded-annotations pointing at the current figure. These are
  changelog, not invariants, and are correctly handled. No action.
- **Four historical narrations of "the budgets bound the worst case" are correctly past-tense** and
  are *not* live assertions: 205 (changelog), 1861 ("a direct contradiction of this spec's own claim"),
  1967 ("Two genuinely different claims were being conflated under…"), 4005 (fixture rationale). Only
  4628 (H1) and, weakly, 1772–1773 assert it in the present.
- **The structural span argument at 2102–2108 is sound and I re-derived it independently.** With a
  span beginning `c` ms after a yield and units `u₁…u_k` each preceded by a conditional checkpoint,
  each checkpoint proceeding implies `c + u₁ + … + u_{i-1} ≤ frameBudgetMs`, so the span is
  `≤ frameBudgetMs + max(uᵢ)`. It correctly does **not** depend on how many units share the span —
  which was the Round-22 error the current text names and retracts (2095–2101).
- **The ~22.9ms counterexample (1359–1360) checks out** and sits inside the ≈24ms bound.
- **`frameBudgetMs = 8` is stated consistently** at 2547 and 2969–2971, with the same "half the
  one-frame target, since a checkpoint can only fire *between* primitives" rationale at both.
- **Fixture 4041–4054's "at most one, not three" yield count is correct** for a call entering with a
  drained accumulator and three individually-sub-`frameBudgetMs` phase costs.
- **The pre-scan-vs-mid-scan distinction for `maxBroadPhaseInstancePairs` is stated three times
  consistently** (2884–2890, 2921–2922, 1950) and the "yielding never truncates" rule (2917–2920)
  correctly distinguishes a scheduling checkpoint from a cutoff.

---

## Cross-system composition concerns for the synthesis pass

1. **`SurfaceIntersectionQuery`'s traversal (M2) needs a joint verdict with the query auditor.** From
   the scheduling side the gap is a taxonomy omission with no worse bound; from the query side the
   open question is whether "the same abort protocol" (1778) transfers the *private clock* — which, if
   it does, makes "the one documented, deliberate exception" (2001–2003) a count of mechanisms rather
   than call sites, and needs saying. A single sentence in the abort-only tier fixes both readings.

2. **The capacity admission (H2) needs a joint verdict with the cache auditor.** Cache side owns
   *what* the step does (zero-mutation-on-rejection, no-interleaving); scheduling side owns *how long
   it may block*. The step's await-free property is a cache-correctness requirement (1299) that
   directly creates a scheduling obligation nobody has taken. Any fix that makes it preemptible would
   break the concurrency guarantee, so the resolution is almost certainly "classify and measure", not
   "checkpoint it".

3. **`dispose()`'s `CollisionInstance`-cache clear straddles both systems' bookkeeping.** The
   exclusion paragraph pulls it inside the excluded set (2119–2123: "a pathological number of live
   epochs is simultaneously outstanding — a second, independent keyspace with its own unmeasured
   scaling"), while the sweep row itself says its scaling "is unstated and unmeasured here" (1951).
   These are consistent, but the excluded set is described as "**two** rows" at 2112–2116 while
   actually covering three distinct unmeasured quantities. Worth one clarifying phrase.

4. **The geometry pipeline's ceiling-check-location ambiguity (v7 model §2.4.8) has a scheduling
   consequence.** If the ceiling check lives inside the registry's build path rather than as a
   narrow-phase precondition, then a `'building'` entry (and its entry-lifetime cancellation signal,
   1425–1429) is created for a geometry that turns out oversized — which changes what the per-epoch
   sweep (1951, the second accepted risk) has to enumerate and settle. The scheduling text assumes the
   narrow-phase-precondition reading (2933–2944).

5. **The abort-only tier's silence on the two-part lifecycle revalidation (v7 model §1.5.2) is a
   lifecycle finding with a taxonomy consequence.** Line 2034–2035 asserts "Every checkpoint named in
   this document — the build-phase checkpoints and the `bvhcast`-entry checkpoints included — is this
   same mechanism", and 2039–2041 asserts the revalidation "is never itself skipped". Neither
   `ProperCrossingQuery`'s (1908–1920) nor `SurfaceCrossingWitness`'s (2515–2520) abort-only passage
   states that a synchronous native callback performs a `disposed`/epoch check, or what it could do
   with the answer. Whichever system fixes it, the taxonomy's exhaustiveness claim at 2034 is what
   currently papers over the gap.
