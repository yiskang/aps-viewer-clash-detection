# Invariant audit v8 — System 4: Synchronous-work / budget / scheduling

**Target**: `docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md` (4812 lines,
current working tree — Round 30's edits are uncommitted; HEAD still holds the 4712-line post-Round-29
text).
**Model**: `invariant-audit-v8-model.md` §4 (with §2.4, §5.1–5.2 cross-references).
**Method**: every line citation below was read directly out of the current file during this pass.
`round-30-high-only-fix-pass-disposition.md` was read once for orientation and **treated as evidence of
nothing** — each of its five claimed fixes that touches this system was re-derived from live text.
`invariant-audit-v7-syncwork.md` was used only for the NEW-vs-PRE-EXISTING baseline, never as evidence
that anything still holds. Changelog text (lines 40–799) is historical narration, never an invariant.

**Baseline for NEW-vs-PRE-EXISTING**: `invariant-audit-v7-syncwork.md` + `round-29-*` (the last pass over
this system's Medium/Low set) + `round-30-*` (the last pass over its High set).

**Counts**: Critical 0 · High 3 · Medium 4 · Low 6.

---

## Verification of what I was asked to re-check

| Item | Verdict | Live citations |
|---|---|---|
| **The dangling cross-reference "Budget enforcement and yield points"** | **CONFIRMED BROKEN.** Exactly two occurrences in the file, both forward references, no matching heading/anchor anywhere. `git log -S` returns **zero commits** — the phrase has never existed in any committed revision; both occurrences are Round-30 working-tree text. **Correct anchor to use instead: "Atomic operations and what remains non-preemptible" under `ProperCrossingQuery`'s budgets** (the bolded inline anchor at **1983**, which is the section containing the disclaimer at 2149–2164). See **M1**. | 1784, 4724 vs. 1983, 2149 |
| **H-3's precheck soundness (`\|U\| > maxCollisionInstancesPerEpoch` ⟹ step 4 would reject anyway)** | **SOUND — independently re-derived, in both directions, for every bucket state including empty.** No off-by-one: step 2 and step 4 both use strict "exceeded" (`>`), and the boundary case `\|U\| = C, B = ∅` is admitted by both. See the derivation below. | 2903–2911, 2917–2925 |
| Row 12's (1969) cost/bound claim internally consistent with "five members" (2095), "what the formula does bound" (2166–2172), the new gate criterion (4601–4610) and the new fixture (4366–4374) | **Consistent at four of the five sites. The fixture is wrong** — its stated rationale is factually false and contradicts the precheck's own soundness argument. See **H1**. A second inconsistency sits in gate criterion 1, which Round 30 did not update. See **H2**. | 1969, 2091–2117, 2166–2178, 4601–4610 **vs.** 4366–4374, 4532–4538 |
| `SurfaceIntersectionQuery`'s addition to the abort-only tier and the span-formula addends does not break the ~16ms/≈24ms headlines | **HOLDS — re-derived.** SIQ's addend is `frameBudgetMs` + one raw candidate callback (~0.3µs, the measured `maxCandidatePairsExamined` figure), composing to `8 + (8 + 0.0003) ≈ 16ms`, strictly under `ProperCrossingQuery`'s `8 + (8 + probe) ≈ 16ms`, itself under the enforceably-bounded tier's controlling 24.8ms. Every downstream ~16ms/≈24ms/24.8ms site was re-checked and none is disturbed. One residual naming defect inside the same bullet — see **M4** — and one gate-naming gap, **L6**. | 2018–2029, 2118–2132, 2169, 2194–2196, 1795–1799, 1904–1910, 4520–4522 |
| `frameBudgetMs` bounds cooperative composition only | **HOLDS** | 2045–2047, 2060–2064, 1962, 1460–1461, 3035–3037 |
| Four-class taxonomy structurally intact; nothing merged, no parallel taxonomy | **HOLDS** — the four classes are at 1988–2012 (a), 2013–2044 (b), 2045–2073 (c), 1964/1967 + 2149–2164 (d). `SurfaceCrossingWitness` remains explicitly shared-accumulator and explicitly excluded from (b) at 2034–2040, 2120–2122, 2170, 2193–2194, 2558–2562 | — |
| Structural prefix argument (any number of units may share a span) | **HOLDS** — independently re-derived a second time this lineage. With prefix `c` and units `u₁…u_k` each preceded by a conditional checkpoint, the last unit's checkpoint proceeding implies `c + Σ_{i<k} uᵢ ≤ frameBudgetMs`, so span ≤ `frameBudgetMs + max(uᵢ)`, independent of `k` | 2134–2147 |
| Accepted atomic risks never falsely described as bounded | **HOLDS at every site v7 flagged.** v7's H1 is genuinely fixed: 4720–4721 now reads "the budgets bound the worst case **for every span this document actually ceilings** — they do **not** bound the worst case for the whole design", with an in-place supersession annotation (4725–4730); the secondary site at 1781–1783 is narrowed to "for this traversal". No live present-tense whole-design assertion survives. **But the fix's own cross-reference is broken (M1)** and the bullet still opens with the round-5 narration "With `maxCandidatePairsExamined` added **this round**" (4720), unannotated | 4720–4732, 1781–1785, 2149–2164 |
| v7's M1 (Data Flow's stale "~60× the … ~16ms pass criterion") | **RESOLVED.** 2951–2954 now mirrors row 1966's annotation exactly (`~40×` / `≈24ms` / `24.8ms` / Round-18→22 supersession). Grep-confirmed: the only surviving `~60×` is at 601, inside the Round-18 changelog entry that already carries its own supersession annotation at 605 | 2951–2954 vs. 1966 |
| v7's M2 (`SurfaceIntersectionQuery` absent from the taxonomy) | **RESOLVED** at all four sites v7 named, plus the definition site | 2018–2029, 2118–2132, 2169, 2194–2196, 1795–1799 |
| v7's H2 (capacity-admission span belonged to no class, no formula, no gate criterion) | **RESOLVED as a classification**, and the bound is real (see the derivation). **Two residuals**: the gate carve-out v7 named was never updated (**H2**), and the site that *defines* the step was never updated (**M2**) | 1969, 2091–2117, 4601–4610 |

### The precheck derivation, re-done from primary text

Let `C = maxCollisionInstancesPerEpoch`, `B` = the affected epoch's bucket contents at step 3, `U` = the
call's complete unique fragment-id set.

- **Step 2** (2903–2905): reject iff `|U| > C`.
- **Step 4** (2917–2919): reject iff `currentBucketSize + uniqueMissingCount > C`, i.e. `|B| + |U \ B| > C`.

`B` and `U \ B` are disjoint, so `|B| + |U \ B| = |B ∪ U| ≥ |U|`. Therefore `|U| > C ⟹ |B ∪ U| > C ⟹`
step 4 rejects — **for every `B`, including `B = ∅`**, where the step-4 quantity is exactly `|U|`.
The precheck therefore adds no rejection step 4 would not already have produced ("never premature",
2907, is correct), and every admitted call satisfies `|U| ≤ C`, so step 3's `O(|U|)` recompute and step
4's `|U \ B| ≤ |U|` constructions are both capped at `C` (row 1969's claim, correct). The converse
`|U| ≤ C ⟹ admit` does **not** hold, which is exactly what 2921–2925 preserves ("step 2 only bounds this
step's own *cost*, not its *outcome*"). Both checks use strict `>`; the boundary `|U| = C, B = ∅` is
admitted by both, consistently.

**This derivation is what makes H1 a defect rather than a nit**: the new fixture at 4372–4374 asserts the
negation of its own middle step.

---

## Critical

None.

---

## High

### H1 — The Round-30 regression fixture that pins the new precheck states, as its rationale, a claim the precheck's own soundness argument proves false

**NEW, Round-30-introduced.** Not recorded by the disposition doc, which describes this fixture only as
"asserting the precheck rejects before any bucket lookup or `CollisionInstance` construction".

**The fixture (4366–4374), verbatim on the load-bearing clause:**

> "**`findClashes` called with a walk whose own complete unique fragment-id set exceeds
> `maxCollisionInstancesPerEpoch`, against an epoch whose bucket is still empty** … Regression test
> distinguishing the precheck (step 2 …) from the bucket-capacity check immediately above (step 4, keyed
> on the bucket's combined contents) — a design that only implements the bucket-capacity check passes the
> fixture above but fails this one, **since an empty bucket never trips a combined-total check no matter
> how large the query's own unique set is.**"

**The final clause is false.** Step 4's check is stated as `currentBucketSize + uniqueMissingCount`
(2919). With an empty bucket, `currentBucketSize = 0` and `uniqueMissingCount = |U|`, so the combined
total *is* `|U|` — and the fixture's own scenario stipulates `|U| > maxCollisionInstancesPerEpoch`. An
empty bucket trips the combined-total check for exactly the reason the fixture says it cannot.

**This is not two defensible readings.** The two claims are mutually exclusive and the document asserts
both:

- **2905–2909** (step 2's justification): "a bucket capped at `maxCollisionInstancesPerEpoch` can never
  need more instances constructed in one admission than that ceiling allows, **whatever the bucket's
  existing contents are**, so this rejection is never premature".
- **1969** (the new table row): "since a bucket capped at that ceiling can never need more than that many
  instances constructed in one admission, **every call that reaches this step already has
  `U ≤ maxCollisionInstancesPerEpoch`**".

Both of these are the superset argument — they say the precheck rejects a strict *subset* of what step 4
already rejects. The fixture says the opposite: that step 4 does not reject this call at all. Exactly one
can be true, and it is the superset argument (elementary, re-derived above; the disposition doc's own
account of the `codex-advisor` remedy, 114–118, states it correctly too).

**What the fixture actually tests, and why it still has value.** A bucket-capacity-only design would
reject this call, but only *after* looking up the bucket. The fixture's spy list is "zero calls to the
bucket-lookup path, zero `CollisionInstance` constructions" — the bucket-lookup spy still discriminates.
So the fixture as an assertion is salvageable; its stated *rationale* is not, and the rationale is the
part a reader uses to understand what invariant is being pinned. The intended distinction is
**where the rejection happens** (before vs. after any bucket access), not **whether** it happens.

**Why High.** It is a present-tense normative statement, inside Testing & Verification, that contradicts
the exact soundness argument the whole H-3 fix rests on — and it contradicts it in the one direction that
matters: an implementer who believes "an empty bucket never trips a combined-total check" has a wrong
model of `maxCollisionInstancesPerEpoch`'s existing enforcement, which is the check that guards the
zero-mutation guarantee (1296–1299). Not Critical: no *design* behaviour is under-determined — every
normative site outside this fixture states the check correctly (1296–1297, 1968, 2917–2919, 3745–3747),
so the specified system still produces the right boolean; the false claim lives in a test rationale.

**Fix shape**: replace "since an empty bucket never trips a combined-total check no matter how large the
query's own unique set is" with the true discriminator — an empty bucket *does* trip the combined-total
check, but only after the bucket lookup, so a bucket-capacity-only design rejects the call while failing
the "zero calls to the bucket-lookup path" assertion.

### H2 — Round 30 grew the enforceably-bounded tier to five members with two of them provisional, but gate criterion 1 still carves out exactly one provisional exception and says every other task's tolerance "is not provisional in the same way"

**NEW / aggravated by Round 30.** This is the residual half of v7's H2 that the disposition doc's own
"What was fixed" list does not claim and does not cover.

**The formula passage (2104–2117), after Round 30:**

> "**The fourth and fifth members** — one `enumNodeChildren` call at the `maxChildrenPerNode` ceiling,
> and the capacity-admission recompute-and-commit at the `maxCollisionInstancesPerEpoch` ceiling — **are
> not among the three measured costs this ≈24ms is computed from** … **≈24ms is provisional for both
> specifically until the performance gate measures them** (gate criterion 7 for the fourth; the
> capacity-admission gate criterion below for the fifth) and, for the fifth, until
> `maxCollisionInstancesPerEpoch` itself is given a chosen value … **if either measurement exceeds
> ~16.8ms, this tier's addend, and the ≈24ms figure everywhere it's cited, must be revised upward**".

**Gate criterion 1 (4532–4538), untouched by Round 30:**

> "a measurement above the corrected bound on any other synchronous task **is** a gate failure, **with
> one provisional exception**: one `enumNodeChildren` call at the `maxChildrenPerNode` ceiling (criterion
> 7, below) is **the fourth, still-unmeasured member** of the 24.8ms figure's own enforceably-bounded
> tier, not one of the three costs it was computed from — if its measured cost pushes the true bound
> above 24.8ms, that is this criterion's own tolerance being corrected by measurement, not a failure of
> this criterion; **every other synchronous task's 24.8ms tolerance is not provisional in the same
> way.**"

The two passages now say incompatible things about the same measurement. Round 30's own **new criterion
8** (4601–4610) requires measuring "the step's own wall-clock cost at that ceiling" — precisely the
measurement 2111–2117 says may legitimately push the bound above 24.8ms, and precisely the measurement
criterion 1's closing clause says is a gate failure if it does.

The ordinal "the fourth … member" is not itself wrong (it *is* the fourth of five); what is wrong is
"**one** provisional exception" and "every other synchronous task's … tolerance is not provisional in the
same way", both of which were written when the tier had four members and one provisional non-measured
one.

**Why this is the same defect v7 rated High, relocated rather than closed.** v7's H2 said the
capacity-admission span "would be enforced at 24.8ms as an unnamed 'single synchronous task' … so a
large-model run that exceeds 24.8ms here reads as a **gate failure against a bound nothing in the design
establishes**." Round 30 gave the span a bound and a tier, which is a real improvement — but it left the
gate criterion enforcing the *un-revised* 24.8ms against it as a hard failure, so the operational
consequence v7 identified is unchanged: the first gate run that measures this step above 24.8ms produces
a criterion-1 failure that the formula section says is a tolerance correction. `maxCollisionInstancesPerEpoch`
having no chosen value (1282, 1968, 1969) makes that outcome more likely, not less — the value that
determines the step's worst-case cost is whatever the gate itself sets in criterion 11.

**Fix shape**: criterion 1's exception clause becomes two provisional exceptions (criterion 7's
`enumNodeChildren` call and criterion 8's capacity-admission recompute-and-commit), mirroring 2104–2117's
"fourth and fifth members" language.

### H3 — The `ViewerGeometryAdapter` sub-step is an admittedly unceilinged synchronous unit folded inside an enforceably-bounded, `12_000`-valued table row, in a tier whose addend the 24.8ms figure is derived from, excluded by no gate carve-out and measured by no gate criterion

**NEW, Round-30-introduced** (H-4's fix). Structurally identical to v7's H2 — an unceilinged synchronous
unit sitting inside a taxonomy that asserts its own exhaustiveness — relocated from the capacity-admission
step to the geometry gate's input.

**The row (1958), whose Value column reads `12_000`:**

> "This phase's own checkpoint also gates `ViewerGeometryAdapter`'s layout-normalization and range
> computation, run once per unique `(loadEpoch, geometryIndex)` before the ceiling check … — reasoned,
> not measured: one `getRenderProxy` call plus O(ranges) work, expected small but **not itself ceilinged
> by this spec**"

**The same disclosure at the gate's own passage (1469–1475):**

> "Its own cost is **reasoned, not measured**: one Viewer `getRenderProxy` call — **an internal,
> undocumented API this spec does not claim a measured or Viewer-guaranteed cost for** (see the
> Viewer-API-drift risk under Risks) — plus a constant number of property-existence branches … plus the
> range-count summation itself, which is `O(ranges)` and … **not itself ceilinged by this spec** — a
> residual, disclosed gap, not a claimed bound."

Three consequences the current text does not reconcile:

1. **The 24.8ms derivation excludes it by construction.** 2091–2099 takes this tier's addend to be "that
   unit's own worst-case cost" and computes the controlling term from welding's measured ~16.8ms — a
   Round-15 figure for `mergeVertices` alone (1958: "Measured (round 15, **weld only**)"), taken years of
   rounds before the normalization sub-step was folded into this phase. The tier's controlling member's
   cost is therefore a strict under-count of the phase it now names.
2. **Gate criterion 1 (4518–4538) excludes exactly two spans** — one `enumNodeFragments` call and the
   registry sweep — and names exactly one provisional exception (see H2). The normalization sub-step is
   neither, so a `getRenderProxy` call that blocks is a criterion-1 gate failure against a bound the spec
   explicitly declines to claim for it.
3. **No gate criterion measures it.** Criterion 5 (4558–4567) measures "each of the three
   `GeometryRecord`-build phases — welding, connectivity, BVH construction — … individually, at
   `maxSyncTriangleCount`"; it names neither normalization nor `getRenderProxy`. The formula's own
   measurement-gap list (2173–2178) enumerates six targets and does not include it either. So the one
   mechanism the document uses to promote a "reasoned, not measured" row to measured is not pointed at
   this row's newest sub-step.

**Why High rather than Medium.** It is not the honesty of the disclosure that is at fault — declining to
invent a ceiling for an undocumented internal Viewer API is the right call, and the disposition doc's
reasoning for it (94–97) is sound. The defect is that the disclosure was made *inside* a row and a tier
whose entire semantics are "enforceably bounded", without touching the two places that operationalize
that semantics: the tier's addend derivation and criterion 1's exclusion list. That is a present-tense
normative contradiction between 1958/1469–1475 and 2091–2099 + 4528–4538, on the same unit.

**Fix shape**: either name the normalization sub-step as a third criterion-1 exclusion (or third
provisional exception) and add it to the measurement-gap list and criterion 5, or split it out of row 1
into its own row in the accepted-atomic-risk class (d) with its own gate criterion, alongside rows 7 and
10. The former is smaller and matches how criterion 7 handles `enumNodeChildren`.

---

## Medium

### M1 — Both rewritten sites of the H-2 fix cross-reference a section that does not exist

**NEW, Round-30-introduced. CONFIRMED** by direct grep and `git log -S`.

Two occurrences, both forward references, both introduced by Round 30's H-2 edits:

- **1784** (`SurfaceIntersectionQuery`'s rewrite narrative): "…it is not, and was never meant to be, the
  whole-design worst-case-span guarantee that **Budget enforcement and yield points** explicitly
  disclaims (see 'still not a finite worst-case-span guarantee')."
- **4724** (Risks): "…excluded from the formula on purpose (see **Budget enforcement and yield points**,
  'still not a finite worst-case-span guarantee,' and the atomic-operations table)."

**Verification performed:**

- `grep -n "Budget enforcement"` over all 4812 lines → exactly these two hits. No heading, sub-heading,
  bolded inline anchor, or any other occurrence of the name.
- `git log -S "Budget enforcement and yield points" -- <spec>` → **zero commits**. The phrase has never
  appeared in any committed revision of the file; both hits are uncommitted Round-30 text. (Round 30's
  edits are working-tree-only; `git diff --stat` = 180 insertions / 76 deletions on this file.)
- The quoted sub-phrase **does** resolve: "still not a finite worst-case-span guarantee" occurs once
  outside these two references, at **2149**.

**The section's actual name.** The passage at 2149–2164 sits inside the bolded inline anchor
**"Atomic operations and what remains non-preemptible."** at **1983**, which is item 6 of
`ProperCrossingQuery`'s budget list (1866). The document's own established citation forms for this region,
used consistently at eight other sites, are:

- "the **'Atomic operations and what remains non-preemptible'** table under **`ProperCrossingQuery`**'s
  budgets" (458, 547, 1318)
- "the atomic-operations-and-composition section under `ProperCrossingQuery`'s budgets" (779)
- "the worst-case-span formula under `ProperCrossingQuery`'s budgets" (731)
- "`ProperCrossingQuery`'s budgets" (298, 775, 2002, 2014, 2035, 2124, 4519, 4522, 4553, 4572)

**Correct replacement for both sites**: `**Atomic operations and what remains non-preemptible**` under
`ProperCrossingQuery`'s budgets — or, since both sites are pointing specifically at the exclusion
paragraph, "the worst-case-span formula's explicit exclusion under `ProperCrossingQuery`'s budgets",
which is the exact phrasing gate criterion 1 already uses at 4530.

**Why Medium rather than High.** The reference is a broken pointer, not a semantic contradiction, and it
is self-recovering: both sites quote a phrase that is unique and greppable in the document, so a
determined reader reaches 2149 anyway. A case for High exists and I would not object to the synthesis
pass promoting it — the 4724 instance is the *only* pointer from the Risks bullet (the section an
implementer reads to learn what is accepted rather than guaranteed) to the section that governs it, and
it was introduced by the very fix pass whose purpose was to make that bullet defer to that section. But
"the reader cannot navigate" is a weaker failure than "the reader is told something false", which is the
bar the other Highs in this document meet.

### M2 — The `CollisionInstance` identity cache's own statement of the admission sequence was not updated with the precheck, so it and Data Flow step 3 are now divergent duplicates of one normative sequence

**NEW, Round-30-introduced.**

v7 recorded that this sequence is "stated identically at 2860–2872 and 1289–1300". Round 30 restructured
the Data Flow copy from four steps to five (2894–2939) and left the `CollisionInstance` identity cache
copy at **1289–1300** untouched. The latter still reads, in full:

> "After every requested dbId's extraction walk completes … and after the walk's last possible yield,
> `findClashes` looks up the affected epoch's bucket **without creating it** if absent, and recomputes
> which ids from the call's complete unique fragment-id set are still missing … It then, in that same
> synchronous step … checks `currentBucketSize + uniqueMissingCount` against the limit for the affected
> epoch."

No precheck, no mention of `U ≤ maxCollisionInstancesPerEpoch`, no cost bound. This matters more than an
ordinary duplication drift for three reasons:

1. **Row 1969 names this passage as the step's definition site** — "`CollisionInstance`
   capacity-admission's recompute-and-commit (**steps under '`CollisionInstance` identity cache,'** see
   **`GeometryRegistry`**)" — and then derives its "enforceably bounded" classification from a precheck
   that appears nowhere in the passage it just cited. The reader is sent to the one place that does not
   state the bound.
2. **2934–2936 declares the Data Flow copy canonical**: "'Look up or create,' applied to this cache
   **anywhere else in this document**, means exactly this sequence". So 1289–1300 is now an incomplete
   restatement of a sequence that explicitly claims document-wide authority — the same shape the doc's own
   annotate-in-place convention exists to prevent.
3. **The zero-mutation scope diverged too**: Data Flow now says the guarantee is "specific to a capacity
   rejection (**step 2's or step 4's**)" (2937), while 1301–1302 still says "specific to **a** capacity
   rejection" — singular, written when there was only one.

No behavioural divergence results (a `|U| > C` call is rejected under either text, by the superset
argument), so this is Medium, not High.

### M3 — "Welding is the largest" does not survive the ceiling-normalization argument stated in the same paragraph, and the formula's revision trigger is stated in different units from the measurement that would trigger it

**PRE-EXISTING (v7 M3), untouched by Round 30**, and re-derived rather than carried.

**Part 1 — the controlling-term identification.** 2095–2099:

> "Of this tier's five members, three are measured — **welding is the largest, at ~16.8ms.** That figure
> was measured at ~19,800 triangles …, not at the `12_000` sync-triangle ceiling itself; **scaled down to
> the ceiling the true cost is smaller (~10.2ms)**, so using the as-measured ~16.8ms figure here is
> conservative, not tight."

The scaling argument is applied to the weld row only. The BVH row is also measured above the ceiling and
also unscaled: "**Measured** (Spike Findings): ~16ms to build a BVH at **18k** triangles" (1960).
Applying the identical reasoning: weld = 16.8 × 12000/19800 ≈ **10.2ms** (the doc's own number);
BVH = 16 × 12000/18000 ≈ **10.7ms**. At the ceiling the **BVH phase, not welding, is the controlling
term**. The per-triangle rates already say this: 0.85 µs/tri weld vs. 0.89 µs/tri BVH.

The numeric bound is unaffected and stays conservative (`8 + 16.8 = 24.8` exceeds `8 + 16` and both
ceiling-scaled figures), so this is not a soundness break. Two downstream arguments lean on welding
*specifically* and would need restating against the BVH phase under the ceiling-normalized reading:

- **1904–1910** (the clock-basis admission comparison): "at the Round 22 measurements, the independently
  measured **~16.8ms weld phase** remains larger than this traversal's own `frameBudgetMs` + one probe
  worst case" — the argument that admitting `ProperCrossingQuery`'s traversal (and, now, transitively,
  `SurfaceIntersectionQuery`'s) to the abort-only tier does not move the controlling term.
- **1353–1360** (per-phase compounding): "**welding (~16.8ms) alone already exceeds `frameBudgetMs`**, so
  the checkpoint immediately following it always finds the accumulator overdue and yields" — the premise
  of the ~22.9ms counterexample. (The counterexample itself checks out: 6.9 + 16 = 22.9 < 24.8.)

**Part 2 — the unit mismatch.** The formula's revision trigger is stated in **as-measured**, above-ceiling
units: "if either measurement exceeds **~16.8ms**, this tier's addend, and the ≈24ms figure everywhere
it's cited, must be revised upward" (2114–2117). Gate criterion 5 produces **ceiling-normalized** ones:
"each of the three … build phases … measured individually, **at `maxSyncTriangleCount`**" (4558–4563).
The gate will therefore return three phase costs around ~10ms and the rule for what to do with them is
written against a number in the other unit. Nothing in the text says which unit the ≈24ms figure is meant
to be expressed in after the gate runs. Round 30 made this slightly worse by pointing two more provisional
members (2111–2117) at the same ~16.8ms trigger, both of which will be measured in whatever unit their own
criteria (7, 8) produce.

### M4 — "`SurfaceCrossingWitness` is a second `bvhcast`-native traversal" is now falsified three lines above itself, inside the bullet Round 30 rewrote

**PRE-EXISTING, aggravated by Round 30.** Cross-system: the query auditor is looking at the same
traversal-count inconsistency from the mode side (v8 model §3.7.8).

Within the single abort-only-tier bullet (2013–2044), Round 30 inserted an explicit naming of
`SurfaceIntersectionQuery`'s `bvhcast` traversal at 2020–2029 — and the bullet then continues, at 2034:

> "**`SurfaceCrossingWitness` is a second `bvhcast`-native traversal** … but is not a second instance of
> this exception"

With `ProperCrossingQuery`'s and `SurfaceIntersectionQuery`'s traversals both now named as
`bvhcast`-native in the preceding eleven lines, `SurfaceCrossingWitness` is the **third**. The document
says so elsewhere: a fixture rationale at 4075 states "`ContainmentModeQuery`'s second composition term
added **a third traversal** to the design".

The count was arguably already wrong before Round 30 (`SurfaceIntersectionQuery` has been `bvhcast`-based
since 1773's rewrite), but it was not self-evidently wrong within its own paragraph. It now is.

**No bound is affected** — the sentence's actual content ("not a second instance of *this exception*",
i.e. not a private-clock user) is correct and is restated correctly at 2120–2122, 2170 and 2193–2194.
The defect is a stale ordinal in a passage whose whole purpose is to enumerate the tier's membership
precisely. *(Note: 2445's "**not** a third instance of this pattern" is **not** a second occurrence of
this error — "this pattern" there means the plain-JS yield-and-resume loops of `anyComponentInside`
stages 1–2 and stage 3, and the count is correct.)*

---

## Low

### L1 — Round 30 created a fifth call-level ceiling rejection with no named error class, and the self-labelled bullet still says "those three"

**NEW, Round-30-introduced.** Step 2's precheck "reject[s] the entire call now" (2903–2905) and carries no
named error class. The Error Handling bullet at 3745–3751 enumerates the call-level, pre-mutation
rejection contract and still reads "the same call-level, pre-mutation rejection contract as
`maxFragmentsPerDbId`, `maxChildrenPerNode`, and `maxBroadPhaseInstancePairs` above, and carrying no named
error class, the same `[SILENT]` gap **those three** share". The bullet also never mentions the precheck
at all — it describes only the bucket-capacity rejection ("if committing the call's missing
`CollisionInstance`s would push `maxCollisionInstancesPerEpoch` over its limit"), which is step 4. The
new step-2 rejection path is documented in Data Flow and the atomic-operations table but not in the
section that exists to enumerate rejection paths.

*(The same bullet's garbled predicate — "would push `maxCollisionInstancesPerEpoch` over **its** limit",
where it is the bucket that is pushed over the ceiling — is v7's L-7C1, a cache-system Low, unchanged.)*

### L2 — "step 4's recompute-and-commit" names only half the span it bounds

**NEW, Round-30-introduced.** Step 2's justification closes: "This is what makes **step 4's**
recompute-and-commit an **enforceably bounded** … synchronous span" (2909–2911), and row 1969 calls the
unit "the recompute-missing scan plus the construct-freeze-and-publish loop, run in the same synchronous
step". But the recompute is **step 3** (2912–2916) and the commit is **step 4** (2917–2928). The two are
one synchronous span (step 4 opens "In that same synchronous step"), so the referent is recoverable, and
gate criterion 8's phrasing ("the recompute-and-commit … separately from its own precheck", 4601–4602)
is unit-correct. Only the step number is wrong. "Steps 3–4's recompute-and-commit" would close it.

### L3 — Three distinct senses of "~16ms" coexist; one is unannotated inside the gate section itself

**PRE-EXISTING (v7 L1 + L3), untouched by Round 30.**

- **A per-phase cost allowance**: 1339–1342, "the accepted per-atomic-operation ceiling (**the same ~16ms
  a single BVH build was already allowed to cost**, see the atomic-operations table) now applies to each
  phase individually". The doc's own measured weld figure (~16.8ms, 1958) **exceeds** this "ceiling".
  Two lines later, "up to roughly 3× that ceiling" (~48ms) sits near the 24.8ms span bound with no
  statement that they measure different things (wall-clock across yields vs. one synchronous span); the
  Round-22 correction at 1345–1366 implicitly resolves it but never says so.
- **The abort-only tier's composed span**: ~16ms at 2126, 2132 — the only one defined at its site.
- **The retired gate figure**: annotated as superseded at 605, 729–731, 772–777, 2102–2103, 4525–4527,
  2952–2954 — with one exception, **4514**, inside the gate section: "the build-only yield rule made the
  cold run's **~16ms bound** plausible". Past-tense Round-9 narration, so defensible as historical, but it
  sits four lines above criterion 1's own "not the ≈16ms this criterion stated through Round 21" and,
  unlike every sibling instance, carries no annotation.

### L4 — Both accepted-risk rows describe themselves as "in the same category as" the three ceilinged build phases

**PRE-EXISTING (v7 L2), untouched.** 1964 ("**Non-preemptible, same category as the three
`maxSyncTriangleCount` phases**"), 1967 ("same category as one `enumNodeFragments` call and the three
`maxSyncTriangleCount` phases"), plus the Data Flow restatement at 2877–2879 ("an accepted,
non-preemptible Milestone-1 atomic risk**, in the same category as the three `maxSyncTriangleCount`
phases"). The intended sense is "non-preemptible",
which is correct; the read-off sense is "bounded like them", which is exactly backwards — the three
phases are the formula's covered set and these two are its explicit exclusions (2149–2164). Each row
carries an adjacent "— (no ceiling; accepted atomic risk)" in its Value column, which is why this is Low.

### L5 — Two `ProperCrossingQuery` fixtures assert a wall-clock bound without naming the Round-22-corrected figure

**PRE-EXISTING (v7 L4), untouched.** 3878 / 3915 ("complete within a wall-clock bound") and 3918
("complete within a **`frameBudgetMs`-scaled wall-clock bound**"). The clock-basis passage derives an
exact figure for this traversal (`frameBudgetMs` + one probe, 1897–1899) and the formula composes it to
~16ms (2123–2127). Neither fixture cites either, so a regression of the Round-22 correction — or of
Round 29's replacement of the unexplained ~2× factor — would not be caught by the fixtures nearest to it.

### L6 — `SurfaceIntersectionQuery`'s addend is the only tier addend with no gate criterion naming it as its own measurement target

**NEW, Round-30-introduced, minor.** Round 30 derives SIQ's addend as "one raw candidate callback's own
cost (~0.3µs, **measured** — see the atomic-operations table's `maxCandidatePairsExamined` row)"
(2026–2028, 2129–2131). That figure is genuinely measured (1961) and criterion 3 (4542) records
per-candidate costs, so there is no measurement gap — but criterion 4 (4544–4557) goes out of its way to
name `SurfaceCrossingWitness`'s in-triangle probe explicitly, with the stated reason "**because, unlike
the two accepted-risk exclusions and `enumNodeChildren` (criterion 7 below), no other criterion below
names it as its own single-call measurement target**" (4555–4557). By that passage's own criterion, SIQ's
raw-candidate callback is now in the same position and is not named. Strictly a symmetry gap in the
gate's own stated naming rule, not a missing measurement.

---

## Historical-only / non-defect observations

- **`frameBudgetMs = 8` is stated consistently** at 3035–3037 and in the atomic-operations table's
  reasoning, with the same "half the one-frame target, since a checkpoint can only fire *between*
  primitives" rationale.
- **The two-row exclusion list is still exactly two rows** (2151–2153) and gate criterion 1's carve-out
  names exactly the same two (4528–4530). Round 30 correctly did **not** add the capacity-admission span
  here — it is now class (a), so listing it would have been the error. The disposition doc's stated
  reason for not touching 2149–2164 (180–183) is independently correct.
- **The abort-only tier's protocol-level reframing is coherent at all three sites** that make the
  uniqueness claim (2018–2020, 2194–2196, and the compatible singular at 2002, which refers to the
  *passage*, not a traversal count). No site now claims a single-traversal exception.
- **`SurfaceCrossingWitness`'s shared-accumulator status is stated at five sites** (2036–2038, 2120–2122,
  2170, 2193–2194, 2558–2562) and it is explicitly excluded from the abort-only tier. No Round-30 edit
  merged the two treatments; grep-confirmed no fifth class or parallel taxonomy exists.
- **The structural prefix argument (2134–2147) is sound** and correctly does not depend on how many units
  share a span — the Round-22 error it retracts.
- **Row 10's split accounting is internally correct**: it prices only the `GeometryRegistry` half, states
  `evictModel`'s `CollisionInstance` deletion is one `Map.delete(loadEpoch)` / O(1), and states
  `dispose()`'s is one `Map.clear()` whose live-epoch scaling "is unstated and unmeasured here" (1967) —
  consistent with the exclusion paragraph's third quantity at 2157–2161 and with criterion 10's
  requirement to vary the live-epoch count (4625–4629).
- **The broad-phase scan's three properties hold** and the overflow-safe division is stated identically at
  1966, 2940–2943 and 3740–3741.
- **Criterion numbering survived the insertion.** The only numbered criterion references in the file are
  to "criterion 1" (4576, 4581) and "criterion 7" (2112, 4534, 4556, 4577); `enumNodeChildren` is still
  the seventh bullet after criterion 8's insertion at 4601. Grep-confirmed: no stale "criterion 8" or
  "criterion 9" reference exists. *(But see H2 — criterion 1's prose content, not its numbering, is stale.)*

---

## Cross-system composition concerns for the synthesis pass

1. **H1 and H2 are both residuals of one fix (H-3) and should be dispositioned together.** The H-3 remedy
   is correct; its two supporting artefacts — the regression fixture and the gate criterion that enforces
   the bound — were not brought along. The cache auditor owns the same step from the ownership side
   (zero-mutation scope, step-1 capture ceiling); the scheduling side owns the bound and its enforcement.
   Neither finding requires reopening the remedy itself.

2. **H3 needs a joint verdict with the geometry auditor.** From the geometry side the `ViewerGeometryAdapter`
   fix is a real improvement (call frequency and producer are now determinate at three sites); from the
   scheduling side it moved an unbounded unit into a bounded tier. The geometry auditor is also looking at
   the `[AMBIGUOUS]` anchor at 1460–1462 ("not gated by `frameBudgetMs`") that Round 30 made load-bearing —
   the two findings share a sentence and should be fixed in one edit.

3. **M4 needs a joint verdict with the query auditor** on the `bvhcast`-native traversal count (2035 vs.
   4075). One ordinal correction closes both readings.

4. **The abort-only tier's lifecycle silence (v8 model §1.5.4) grew by one member because of this system's
   fix.** `SurfaceIntersectionQuery` is now normatively in the tier that 2060–2062's "every checkpoint …
   the `bvhcast`-entry checkpoints included" quantifies over, while 1795–1799 specifies only its private
   time trigger and its diagnosed-negative exit — the result shape 3449–3453 forbids for a lifecycle
   failure. That is a lifecycle finding, but the taxonomy's exhaustiveness claim at 2060–2062 is what
   papers over it, and this system owns that claim.

5. **`maxCollisionInstancesPerEpoch` is now load-bearing for two independent purposes** — the retention
   ceiling (1282–1288) and, since Round 30, the capacity-admission span's cost bound (1969, 2109–2114) —
   while still having no chosen value, and the gate criterion that sets it (11, 4632–4641) measures
   steady-state retention, not span cost. Criterion 8 measures the span "at (or just under)" a ceiling
   criterion 11 has not yet chosen. This ordering dependency between two gate criteria is not stated
   anywhere and belongs to whichever system owns the gate's sequencing.

---

## Method notes

- Regions read directly and in full during this pass: 1339–1366, 1454–1521, 1767–1800, 1855–2201,
  1282–1306, 2894–2990, 3740–3755, 4360–4380, 4501–4650, 4712–4732.
- Grep verification for every claim turning on an occurrence count: `Budget enforcement`,
  `still not a finite`, `16ms` / `24.8` / `≈24` / `~24`, `60×`, `bvhcast`-native traversal counts,
  `abort protocol`, `criterion`, `Abort protocol`, plus a full heading/anchor extraction.
- `git log -S "Budget enforcement and yield points"` and `git status` / `git diff --stat` were used
  **only** to establish provenance (Round-30-introduced vs. pre-existing), never as evidence that
  anything is correct.
- No `codex-advisor` / `codex-review` consult was run: the two conclusions that would most warrant a
  second opinion (H1's falsity claim and the precheck's soundness) reduce to elementary set arithmetic
  that I re-derived from primary text twice, in both directions, and the shared `codex-worker` queue had
  an in-flight request from another session at the time. The `advisor` tool was not used, per the
  standing project constraint.
- **No spec text was modified by this pass.**
