# Invariant audit v6 — SYNCHRONOUS-WORK / BUDGET MODEL

Auditor: one of five parallel per-system auditors for `invariant-audit-v6.md`.
Input: `docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md` at **4431 lines**
(post-Round-22, uncommitted working tree — Round 22's edits are exactly `git diff` against `9c6a846`).
Reference model: `docs/superpowers/specs/invariant-audit-v6-model.md` (built at 4429 lines, i.e. before
Round 22's own two post-model residue fixes landed).
Method: full sequential read of all 4431 lines, plus a line-level diff of Round 22's edits so that NEW
vs. PRE-EXISTING could be decided from the diff rather than from the disposition doc's account of it.
Severity bar, per this lineage: **Critical** = unsatisfiable by construction; **High** = a real
contradiction or an unsound claim; **Medium/Low** = wording or completeness gap.

**Second opinion.** Both High adjudications (H6-B1 and H6-B2) were put to `codex-advisor`
(request `20260902-235637-17980-17692`, effort `medium`) as an independent check, per the standing
codex-only preference. It independently confirmed both as real defects and independently assigned **High**
to each, validated the connectivity+BVH counterexample and the prefix-sum re-derivation, and contributed
three sharpenings incorporated below: the prefix inequality is non-strict (`≤`, since the stated yield
condition is "exceeds"); the gate as written cannot validate the bound it enforces because criterion 7
measures an isolated call while criterion 1 thresholds spans (see H6-B2); and a hard threshold derived as
24.8ms should not be published as "≈24ms" (see L6-B6). It also noted that "only one such unit" is
defensible *only* under the narrow reading "one terminal budget-crossing unit" — which is not the reading
the sentence's own justification clause supports, and is not the reading the "never compound" guarantee
elsewhere depends on.

---

## Headline

- **Critical: 0.**
- **High: 3** — two NEW (introduced by Round 22's own re-derivation), one PRE-EXISTING but newly
  load-bearing because Round 22 built the formula's abort-only tier on top of it.
- **H2 disposition: RESOLVED as to the defect `invariant-audit-v5.md` actually named, but the
  replacement derivation is itself unsound in two places.** The specific thing v5 flagged — the
  `max(...)` form, the "checkpoint always yields" premise, and the ~1.5× understatement — is gone from
  every live passage, and the corrected additive form plus the ≈24ms figure landed consistently at all
  four sites Round 22 claimed. The numeric value ≈24ms is also, as far as I can derive it, **correct**.
  But it is correct for a reason the document does not give, and the two supporting arguments Round 22
  wrote to justify it are contradicted by the document's own measured numbers (H6-B1) and by its own
  tier membership (H6-B2). So: H2 closed, the fix's own derivation not yet earned.

---

## Confirmations first (what I checked and found sound)

1. **The corrected formula is internally consistent across all four of its statement sites.** The main
   passage (1931–1961), the `ThreeMeshBvhBackend`/`BlasCache` mirror (1278–1290), the `bvhcast`
   clock-basis cross-reference (1795–1800), and the performance gate's criterion 1 (4181–4192) all now
   state the same additive form and the same ≈24ms figure. No site still states the two-term `max(...)`
   form as a live claim: `max(frameBudgetMs` appears at exactly two lines, 736 (Round 22's own changelog
   entry) and 1934 (the re-derivation naming the form it replaces), both explicitly retrospective.
2. **`≈16ms` is gone as a live worst-case-span bound.** Gate criterion 1 (4181–4192) and gate criterion 6
   (4221–4222) were both rewritten; the clock-basis parenthetical at 1797–1799 was rewritten. Remaining
   `~16ms` occurrences are either genuine *cost* figures (781, 1443, 1841, 1851, 1274, 4201) or
   changelog/historical narration (275–276, 580, 704, 744, 1287, 1949, 2701, 4177, 4183). One live
   normative exception survives — see **M6-B2**.
3. **The two ceiling-less accepted atomic risks are excluded consistently everywhere the formula is
   discussed.** The exclusion paragraph (1963–1974) names exactly one non-recursive
   `enumNodeFragments(node, cb, false)` call and `releaseEpochScopedState`/`dispose()`'s per-epoch
   registry sweep; the "what the formula *does* bound" list (1976–1979) omits both; the atomic-operations
   table rows (1855, 1858) classify both as ceiling-less accepted risks; and the gate's criterion 1
   carve-out (4185–4190) names exactly the same two, with "above the band is a required recorded finding,
   not a gate failure". **No new exception was invented and none was dropped.** Round 22's claim to have
   left this untouched holds.
4. **The formula's numeric value survives my own re-derivation.** Let a span begin after a yield with `c`
   ms of prior cooperative work, then run non-preemptible/abort-only units `u₁ … u_k` back to back, each
   preceded by a conditional checkpoint. The checkpoint before `u_i` runs only because the accumulator was
   *not* due, i.e. `c + u₁ + … + u_{i-1} ≤ frameBudgetMs` for every `i ≤ k` (non-strict, because the
   stated yield condition at 2767–2769 is "**exceeds** `frameBudgetMs`", so a checkpoint sitting at
   exactly 8 does not yield). Therefore the whole span is `≤ frameBudgetMs + u_k ≤ frameBudgetMs +
   maxᵢ(uᵢ)` = 8 + 16.8 = 24.8ms. The bound holds — but it holds because the *prefix* of the span is
   capped by the checkpoint condition, **not** because only one such unit can occur, which is what the
   document actually argues (H6-B1).
5. **The taxonomy as the design text states it is coherent.** The normative text asserts three in-formula
   tiers (cooperative 1942–1945, enforceably-bounded 1946–1950, abort-only 1951–1954), matching the three
   composition bullets (1878–1898, 1899–1909, 1910–1929), plus a separately-stated excluded class carried
   only by the two table rows and the exclusion paragraph. The four-class framing in
   `round-22-h2-derivation-pass-disposition.md` (lines 20–39) is a working-record artifact and is not
   asserted by the design text; I audited against the text, not the disposition.
6. **The load-bearing general rule (1925–1929) is stated once, unambiguously, and every other scheduling
   claim in my system is checkable against it.** `frameBudgetMs = 8` at 2382 and 2768; the accumulator's
   semantics ("accumulated synchronous time since the last yield", 2767–2769) are the ones the formula
   needs. Checkpoint inventory unchanged: extraction per-dbId (2562–2564), per-sibling-node (2646–2648),
   pre-broad-phase (2689–2696), per-instance-pair (2705–2711), per-candidate-pair / between-sub-queries
   (2762–2769), three build phases (1272–1290), `ProperCrossingQuery` per-probe (1810–1827),
   `ContainmentQuery` per-`classifyPoint` and per-witness-triangle (2208–2237),
   `SurfaceCrossingWitness` (2341–2355).

---

# Critical

**None.** No claim in this system is unsatisfiable by construction. Both High findings below concern
arguments the document gives for a conclusion, and in both cases a correct argument for a (possibly
slightly adjusted) conclusion exists and can be written; nothing here forces an implementation into a
state it cannot occupy. I explicitly weighed H6-B1 for Critical and rejected it: an implementation can
satisfy every mechanism as specified, and the span bound the gate enforces is actually met — it is the
*derivation and the retained guarantee* that are false, not the mechanism.

---

# High

## H6-B1 (NEW — caused directly by Round 22's edits). The "only one non-preemptible unit per span" argument, and the "the three build phases never compound with each other in one span" guarantee it is used to preserve, are both **false by the document's own measured connectivity cost**.

**Three sites, all new text from this pass** (verified against `git diff`):

- **1956–1961**, verbatim: "Only *one* such non-preemptible or abort-only unit can ever be the one
  absorbing prior undischarged work in a given span: **any build phase or traversal at or near this
  ceiling already costs more than `frameBudgetMs` on its own**, so the very next checkpoint immediately
  after it finds the accumulator already overdue and does yield."
- **1284–1286**: "only every phase *after* it is guaranteed a checkpoint that actually yields, **because
  that first phase's own cost alone already exceeds `frameBudgetMs`**."
- **1288–1290** and **1884–1885**: "the three phases never compound *with each other* in one span" /
  "gives each phase its own hard ceiling on *its own* cost, **so no phase ever compounds with another
  build phase in the same span**."

**Why it is false.** The document's own atomic-operations table measures the **connectivity phase at
~6.9ms** (line 1850) — and at the `12_000` sync-triangle ceiling, proportionally lower still (~4.2ms
scaled from the ~19,800-triangle measurement). `frameBudgetMs = 8` (2382, 2768). So connectivity's own
cost **does not exceed `frameBudgetMs`**, and the checkpoint immediately after it is therefore **not**
guaranteed overdue.

The concrete counterexample is an ordinary first-time `containment`/`volume-overlap` build, using only
mechanisms this document already specifies (phase order weld → connectivity → BVH, 1305–1306; per-phase
conditional checkpoints, 1272–1290; accumulator resets at a yield, 2767–2769):

1. Checkpoint before weld finds the accumulator not yet due → weld runs (~16.8ms). Span ends at the next
   checkpoint, which *is* now overdue → yield. Accumulator resets.
2. New span. Checkpoint before connectivity: accumulator ≈ 0 → not due → **connectivity runs (~6.9ms)**.
3. Checkpoint before the BVH: accumulator ≈ 6.9 < 8 → **still not due** → **the BVH runs in the same
   span** (~16ms).

Result: **connectivity and the BVH compound in one uninterrupted synchronous span (~22.9ms)** — two
non-preemptible build phases, in the very span the document says cannot exist. Both quoted claims fail:
*more than one* such unit can occupy one span, and *the three phases can compound with each other*.

**What survives and what does not.**
- The **numeric bound ≈24ms survives** (see Confirmation 4, and the arithmetic above: 22.9ms, plus at
  most `frameBudgetMs − 6.9` of prior cooperative work, stays under 24.8ms). This is not a numerical
  error.
- The **derivation does not survive.** Round 22 replaced an unsound premise ("the checkpoint before a
  phase always yields") with a different unsound premise ("any such unit already costs more than
  `frameBudgetMs`, so the checkpoint after it always yields"). Both are the same shape of error — a
  conditional checkpoint asserted to be unconditional — one step further down the chain. This is
  precisely the "claimed vs. earned" pattern Round 19's own entry (593–603) names as what this audit
  lineage exists to catch, and it is why I rate it High rather than Medium: the sentence is not
  imprecise, it is an assertion the document's own measured table refutes.
- The **`ThreeMeshBvhBackend` guarantee at 1288–1290 is a regression in substance, not only in
  argument.** Round 22 corrected the passage around it and then *retained* — as still-true — the one
  claim its own correction invalidates. Through Round 21 "the three phases never compound with each
  other" followed from the (wrong) unconditional-yield premise. Once that premise is withdrawn, the
  conclusion has to be withdrawn or re-derived too; it was neither.

**Secondary wording consequence, same root cause.** The formula's own bracket (1932–1933) reads "the
**one** non-preemptible or abort-only atomic unit, **if any**, that immediately follows a checkpoint
which found the accumulator not yet due". In the connectivity→BVH span *two* units satisfy that
description, and the text does not say whether to take the last, the largest, or the sum. Read as a sum
it yields 8 + 6.9 + 16 ≈ 30.9ms, which is not the ≈24ms the gate enforces. The uniqueness
presupposition is doing load-bearing work the mechanics do not support.

**Suggested repair (not applied — this is an audit).** Replace the "only one unit" argument with the
prefix-sum argument in Confirmation 4 (`c + u₁ + … + u_{k-1} ≤ frameBudgetMs` by the checkpoint
condition, hence span `≤ frameBudgetMs + maxᵢ(uᵢ)`), restate the bracket as "the **largest** such unit",
and narrow 1288–1290 / 1884–1885 to what remains true: *no build phase can be preceded in its own span by
another unit whose cost alone reaches `frameBudgetMs`*, which is weaker than "never compound".
(`codex-advisor` reached the same repair independently: "Revise A's proof to the checkpoint prefix-sum
invariant and remove the no-compounding language.")

## H6-B2 (NEW — caused by Round 22's edits). ≈24ms is a maximum taken over **three** of the enforceably-bounded tier's **four** members, and the omitted member is one the spec explicitly refuses to bound — yet the gate turns ≈24ms into a hard pass/fail for exactly that member.

- **1946–1950** defines the tier as containing four units: "the three `maxSyncTriangleCount` build
  phases; **the `maxChildrenPerNode`-capped `enumNodeChildren` call**", and then gives the addend as
  "that unit's own worst-case cost — measured at ~16.8ms for welding, **the largest of the three**".
  "The largest of the three" silently drops the fourth member from the maximum.
- **1856** (atomic-operations table, `maxChildrenPerNode` row) says of that fourth member, in bold:
  "**This spec does not claim `10_000` callbacks fit inside `frameBudgetMs`**; that remains unmeasured,
  and the gate is required to measure it." Gate criterion 7 (4229–4241) confirms: `maxChildrenPerNode`
  "is a provisional limit on how many callbacks one such call may cost, **not a figure derived from any
  measurement**", and the gate deliberately declines to borrow the `~0.3µs` `bvhcast` figure as a proxy.
- **1976–1979** nonetheless lists "the `maxChildrenPerNode`-capped `enumNodeChildren` call" among what
  the formula **does** bound.
- **4181–4192** (gate criterion 1) then makes ≈24ms a pass/fail threshold for every synchronous task
  **except** the two explicitly excluded rows — and this call is *not* one of them: "a measurement above
  the corrected bound on any other synchronous task **is** a gate failure."

So the document simultaneously asserts (a) the formula bounds this call at ≈24ms, (b) it claims no bound
on this call's cost at all, and (c) exceeding ≈24ms on this call is a gate failure rather than a recorded
finding. (a) and (b) are a direct contradiction, and (c) is the operational consequence: a
10,000-callback native enumeration measuring, say, 40ms would be a gate *failure* under criterion 1 while
criterion 7 treats measuring it as the whole point of the exercise.

**Is the general caveat enough?** 1979–1983 says the formula "is only as good as the table's unmeasured
rows". I do not think that rescues it. That caveat is about *confidence* in a stated number; here the
number was never computed over the set it claims to range over. And the caveat cannot reach the gate,
which converts ≈24ms into a binary verdict with a carve-out list that deliberately excludes this member.
The distinction the document itself draws — between "unmeasured but ceilinged" (in-formula) and "no
ceiling at all" (excluded) — does not survive contact with this row: `maxChildrenPerNode` ceilings the
**callback count**, not the **cost**, and the spec says so.

**Sharper still: as written, the gate cannot validate the bound it enforces.** Criterion 7 (4229–4241)
measures **one `enumNodeChildren` call in isolation**, while criterion 1 (4181–4192) thresholds
**synchronous spans** at ≈24ms — a figure that already contains the `frameBudgetMs` prefix. So an
enumeration call measured at, say, 20ms passes criterion 7 and passes criterion 1 in isolation, while the
span it can actually produce is `frameBudgetMs + 20` = 28ms, above the bound the gate claims to enforce.
The gate is measuring a different quantity from the one the formula is about, for the one tier member
whose cost is unknown. This is what makes the finding operational rather than editorial.

**Rating.** High. It is a live contradiction between two normative statements, and it is the same
claimed-vs-earned shape as H6-B1. Note this is a *newly created* defect: the pre-Round-22 "what the
formula does bound" list already named `enumNodeChildren`, but the pre-Round-22 formula was a `max(...)`
over "one build-phase's own cost" and never asserted a single ≈Xms number as the tier's maximum, and the
gate criterion was a `frameBudgetMs`-relative "tolerance band", not a derived figure. Round 22 introduced
both the tier enumeration and the single number.

**Suggested repair.** Either (i) state the addend as "the largest **measured** member, ~16.8ms for
welding, with the `enumNodeChildren` call's own cost unmeasured and therefore not covered by this
figure", and give criterion 1 a third named carve-out for it until the gate measures it; or (ii) move the
`enumNodeChildren` row into the excluded class until it has a measured cost. Either is honest; the
current text is not.

## H6-B3 (PRE-EXISTING contradiction; **one side of it newly written by Round 22**, and newly load-bearing for the formula). The two `bvhcast`-native traversals are assigned two different clock bases, and the abort-only tier's ≈24ms addend depends on which one is right.

- **1899–1904** (the abort-only bullet, **new in Round 22**): the ceiling covers "**the two**
  `bvhcast`-native traversals (`ProperCrossingQuery`'s `intersectsTriangles`, **`SurfaceCrossingWitness`**)
  … its **own** duration is self-bounded independent of what ran before it — **a private,
  traversal-local clock, deliberately not the shared accumulator** … worst case ~2×`frameBudgetMs`."
- **2350–2351** (`SurfaceCrossingWitness`'s own passage, untouched since Round 21): "Being
  `bvhcast`-native, this traversal cannot `await`, yield, or resume: **the shared elapsed-time
  accumulator** is checked at callback entry and immediately before every probe."
- **1783–1798** (`ProperCrossingQuery`'s clock-basis passage) argues at length that reading the shared
  accumulator for a non-resumable traversal is a *defect* — it makes "that permanent, result-altering
  abort a function of the traversal's arrival time … two calls presented with the identical pair could
  reach opposite verdicts depending on what else ran first."

This is a flat contradiction between two live normative sentences, and the reasoning at 1789–1793
classifies one of the two readings as a correctness defect — so it is not a harmless naming difference.
Round 22 did not create the `SurfaceCrossingWitness` sentence (that is Round 21's H-B4 rewrite, recorded
in the v6 model as its item 4), but Round 22 **newly extended the private-clock claim to cover it
collectively** and **newly made that claim load-bearing**: the abort-only tier's addend
(~2×`frameBudgetMs`, 1951–1954) and one half of the gate's ≈24ms ("at the measured weld/`bvhcast`
figures", 4183) are derived from the private-clock reading. Under 2350–2351's shared-accumulator reading,
`SurfaceCrossingWitness`'s own contribution to a span is instead bounded by
`frameBudgetMs − accumulator + one probe`, which is a *different* quantity with different determinism
properties — and the abort becomes exactly the scheduling-position-dependent, result-altering abort
1789–1793 rejects.

**Rating.** High, on the lineage bar (a real contradiction between normative statements, with a
correctness argument attached to one side). It is the same finding v5 adjudicated as H1 for
`ProperCrossingQuery`, left unfixed for the sibling traversal, and now promoted from local inconsistency
to a load-bearing input of the worst-case-span formula.

---

# Medium

Listed only where NEW, or where a known item's status changed. `invariant-audit-v5.md`'s sync-work
M1–M9 are not re-litigated except where noted.

- **M6-B1 (NEW).** *The private clock's own justification became circular.* 1795–1800 now reads: the
  private clock's "own worst case … at most ~2×`frameBudgetMs`, which **sits within, not beyond**, the
  performance gate's own tolerance band (**Round 22: ≈24ms** — `frameBudgetMs` plus one
  non-preemptible/abort-only unit's own worst case, **of which this traversal's own ~2×`frameBudgetMs` is
  itself one instance**)". Pre-Round-22 this was a genuine argument: an independently-derived ~16ms
  traversal cost compared against an independently-stated ~16ms gate band. Post-Round-22 the band is
  *defined* as `frameBudgetMs` plus this very quantity, so "sits within, not beyond" is a tautology and
  carries no evidential force. The text honestly flags the circularity in its own parenthetical, which is
  why this is Medium rather than High — and the private-clock decision has an independent, stronger
  justification (determinism, 1789–1793) stated first. But `invariant-audit-v5.md`'s Remediation section
  (lines 176–180) cites this "sits within, not beyond the gate's tolerance band" argument as one of the
  two grounds for reverting to the private clock; that ground is now vacuous and should not be relied on
  again.
- **M6-B2 (NEW as a residue Round 22 did not close, though flagged to it).** *One live normative
  reference to the superseded ~16ms gate criterion survives, inside the atomic-operations table.* Line
  1857 (`maxBroadPhaseInstancePairs` row): "at O(µs)/test the ceiling case is ~1,000ms, **~60× the gate's
  own ~16ms criterion**". The v6 model's §4.7 residue sweep flagged this line explicitly alongside
  1797–1798 and 4219; `round-22-h2-derivation-pass-disposition.md` §5 reports fixing **two** such
  references and consciously leaving **one** (line ~2699, as Round-18 historical narration). Line 1857 is
  neither fixed nor accounted for. It is arguably covered by the same historical-narration convention (it
  carries a "**Round 18:**" prefix), but unlike 2699 it sits inside a normative table row whose other
  clauses are all present-tense design statements, and the disposition's own record is silent on it. At
  minimum the disposition's account of its residue sweep is incomplete.
- **M6-B3 (NEW wording error inside the load-bearing sentence).** 1948 states the enforceably-bounded
  addend is "**measured at ~16.8ms for welding, the largest of the three, at the sync-triangle
  ceiling**". The ~16.8ms figure was measured at **~19,800 triangles** (1247–1248, 1447–1448, table row
  1849), not at the `12_000` ceiling; scaled to the ceiling it is ~10.2ms. Round 22 newly wrote "at the
  sync-triangle ceiling" into the formula's own derivation. The direction of the error is conservative
  (the stated ≈24ms over-estimates), so it is not a soundness hole, but it is a false measurement
  attribution in the sentence the whole re-derivation turns on, and the same conflation is what round 15
  spent a Critical fixing in the opposite direction.
- **M6-B4 (PRE-EXISTING, unchanged, but newly load-bearing).** The `~2×frameBudgetMs` self-bound at
  1795–1797 is asserted without a derivation that reproduces the factor of two: a private clock that trips
  when elapsed exceeds `frameBudgetMs`, with overshoot bounded by one probe (1829–1831), yields
  `frameBudgetMs + one probe`, not `2×frameBudgetMs`. `invariant-audit-v5.md`'s Medium list already noted
  "H-B7's own magnitude reasoning was self-inconsistent". Round 22 now consumes this unexplained figure
  as the abort-only tier's addend (1951–1954) and as half of the gate's ≈24ms (4183), so an unresolved
  Medium has become an input to a normative bound.
- **M6-B5 (PRE-EXISTING, unchanged, sharpened by Round 22).** The budget section's closing sentence
  (1997–2001) still reads "Both mechanisms key off the same constant and **the same clock**". Under the
  charitable reading ("both are wall-clock, not count-based") it is fine; read literally it contradicts
  1903–1904's "deliberately **not** the shared accumulator". Round 22's new general rule at 1925–1929
  makes the exception explicit and prominent, which makes the untouched closing sentence read as a
  contradiction rather than as loose phrasing. Wording-only; the mechanism is stated unambiguously
  elsewhere.

---

# Low

- **L6-B1.** Round 21's changelog entry at 703–704 still asserts, unannotated and in present tense, that
  the private clock's "own worst case sits within, not beyond, the performance gate's **~16ms tolerance
  band**" — a figure Round 22 superseded. The document has an established superseded-annotation
  convention (452–454, applied at 324–326, 389–391, 466–470, 507–512); Round 22 applied it to neither 704
  nor 580 (Round 18's "~60× the gate's ~16ms criterion").
- **L6-B2.** Gate criterion 1 mixes vocabulary: it establishes a "corrected worst-case-span **bound**",
  then calls an excluded measurement "above the **band**" (4189) before returning to "above the corrected
  **bound**" (4190). Criterion 6 now refers to "the **tolerance criterion** above" (4221–4222), a name
  criterion 1 no longer uses. Trivial, but the whole point of the rewrite was to retire the "tolerance
  band" framing.
- **L6-B3.** `≈24ms` (743, 1287, 1798, 1949, 4183) and `~24ms` (1954) are used interchangeably for the
  same quantity within the same paragraph pair.
- **L6-B6 (NEW).** *A hard threshold rounded downward.* The derivation gives `frameBudgetMs (8) +
  ~16.8 = 24.8ms` (1948–1950), but the figure carried into the gate as a pass/fail line is "**≈24ms**"
  (4183). A measured 24.5ms span is inside the derived bound and outside the stated threshold. For a
  criterion whose text says a measurement above it "**is** a gate failure", the rounding direction
  matters; state 24.8ms, or round up.
- **L6-B4 (PRE-EXISTING, unchanged).** The gate still does not name two spans it plausibly should: the
  extraction walk's per-sibling-node `frameBudgetMs` checkpoint (2646–2648), and `SurfaceCrossingWitness`'s
  own traversal span — the second being conspicuous now that Round 22 has promoted "the two
  `bvhcast`-native traversals" into the formula by name (1978). Criterion 1's generic "any synchronous
  task" covers both in principle, but criteria 7/8/9/10 name their targets explicitly and these two are
  not among them.
- **L6-B5 (PRE-EXISTING, unchanged, noted for completeness).** Line 2701's "about **60× the performance
  gate's own ~16ms pass criterion**" was deliberately retained as Round-18 narration per the disposition;
  recorded here so the next round does not re-flag it as an oversight.

---

# NEW vs. PRE-EXISTING — explicit classification

**(a) NEW, caused by Round 22's own edits:**
- H6-B1 — the "only one non-preemptible unit per span" argument (1956–1961) and the retained "three
  phases never compound with each other" guarantee (1288–1290, 1884–1885), both false by the document's
  own ~6.9ms connectivity measurement; plus the formula bracket's uniqueness presupposition (1932–1933).
- H6-B2 — ≈24ms taken as a maximum over three of the tier's four members, contradicting 1856's explicit
  refusal to bound the fourth, and made operational by gate criterion 1.
- M6-B1 — the private-clock justification at 1797–1799 became circular.
- M6-B3 — "~16.8ms … at the sync-triangle ceiling" mis-attributes a ~19,800-triangle measurement.
- L6-B2, L6-B3 — vocabulary residue from the rewrite.
- L6-B6 — the derived 24.8ms published as a hard "≈24ms" gate threshold.

**(b) PRE-EXISTING, surfaced or promoted by this read, not caused by Round 22:**
- H6-B3 — the `SurfaceCrossingWitness` shared-vs-private clock contradiction (2350–2351 vs. 1783–1798).
  Round 21 wrote 2350–2351; Round 22 wrote the collective private-clock claim at 1899–1904 and made the
  contradiction load-bearing for the abort-only tier.
- M6-B2 — line 1857's live ~16ms gate reference, flagged to Round 22 by the v6 model's §4.7 and neither
  fixed nor accounted for.
- M6-B4 — the unexplained `~2×frameBudgetMs` factor, a carried-forward v5 Medium now consumed by a
  normative bound.
- M6-B5 — the "same clock" closing sentence (1997–2001).
- L6-B1, L6-B4, L6-B5.

**(c) Confirmed unchanged / correctly resolved:**
- The `max(...)` formula appears in no live claim (736, 1934 both retrospective) — **v6 model §4.7's
  first bullet confirmed against the current text.**
- The "checkpoint always yields" framing is annotated in place at both sites it occupied (1885–1893,
  1278–1290), and the general rule now states the opposite at 1925–1929.
- The two post-model residue fixes the disposition claims (1797–1799 and 4221–4222) **did land**; the v6
  model's §3.4 `[CONTRADICTION]` and its appendix items 17 and 19 are therefore **closed** against the
  current text. (Item 20's line 1855→1857 half is **not** closed — see M6-B2.)
- The two ceiling-less exclusions are correctly and identically scoped at all four sites (1855, 1858,
  1963–1974, 4185–4190).
- `frameBudgetMs = 8`, the accumulator's definition, the full checkpoint inventory, the atomic-operations
  table's eleven rows, and the four-scheduling-class question (three in-formula tiers plus one
  separately-stated excluded class) are unchanged from the v6 model's extraction.
- `invariant-audit-v5.md`'s sync-work M1–M9 were not touched by Round 22 and remain as recorded, except
  M4-equivalent (H-B7's magnitude reasoning) whose status is escalated in context — see M6-B4.

---

# Answer to the question this audit was run to settle

**Is H2 closed?** Yes for the finding as v5 stated it — the formula no longer treats a build-phase
checkpoint as an unconditional yield, the ≈16ms understatement is gone from every live passage, and
`frameBudgetMs + [one unit's own worst-case cost]` ≈ 24ms is stated consistently at all four sites. The
value itself is, on my own derivation, correct.

**Did the fix introduce a new contradiction?** Yes — two. Round 22 replaced one unconditional-checkpoint
premise with another one step downstream (H6-B1), and computed a tier maximum over a proper subset of the
tier while the gate promoted that number to a pass/fail threshold (H6-B2). Neither breaks the ≈24ms
number; both break the argument for it, and H6-B1 additionally leaves a stale mechanism guarantee ("the
three phases never compound with each other in one span") standing as true when Round 22's own correction
falsifies it. A third High (H6-B3) was pre-existing but is now an input to the formula rather than a
local inconsistency.

**Net standing for this system: 0 Critical, 3 High (2 NEW, 1 pre-existing-but-promoted), 5 Medium
(3 NEW), 6 Low.** Both High adjudications were independently corroborated by `codex-advisor`, which
assigned the same severity to each from the mechanics alone.
