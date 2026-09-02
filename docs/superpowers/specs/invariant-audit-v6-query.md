# Invariant-driven consistency audit — Round 6, QUERY SEMANTICS system

Type: per-system invariant audit (one of five parallel auditors), replicating `invariant-audit-v5.md`'s
method and severity bar. Input: `docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md`
read **sequentially, in full, at 4431 lines** (not sampled). Reference baseline:
`docs/superpowers/specs/invariant-audit-v6-model.md` (1362 lines, read in full first).
Working record consulted for "where to look hardest," never trusted for what the text says:
`round-22-h2-derivation-pass-disposition.md`, `round-21-high-only-fix-pass-disposition.md`,
`invariant-audit-v5.md`.

**System boundary (same as v5's query-semantics auditor):** `ProperCrossingQuery`, `ContainmentQuery`
(`classifyPoint` + `anyComponentInside`), `SurfaceCrossingWitness`, `ContainmentModeQuery`,
`VolumeOverlapQuery`, `SurfaceIntersectionQuery`, the `containment` / `volume-overlap` /
`surface-intersection` mode contracts and their preconditions, the containment guarantee, and the
diagnostic-role rules.

**Severity bar applied (this lineage's, from v5):** Critical = unsatisfiable **by construction**, not
merely under-specified or unsatisfiable-as-written; High = a real contradiction or an unsound claim;
Medium/Low = wording, completeness, or cross-reference gaps.

---

## 0. A note on the baseline model's own staleness (read this first)

The v6 model was built at **4429 lines**; the live file is **4431**. Round 22's own edit #5 (see its
disposition doc, lines 84–93) was applied **after** the model-build pass, in response to that pass's
§4.7 residue sweep. Two of the model's Appendix items are therefore **already closed in the live text**
and were not re-flagged by this audit:

- Appendix item 17 / §3.4 `[CONTRADICTION]` — "`bvhcast`'s self-bound cites a gate band that no longer
  exists." **Closed.** Live 1797–1800 now reads "…sits within, not beyond, the performance gate's own
  tolerance band (**Round 22: ≈24ms** — `frameBudgetMs` plus one non-preemptible/abort-only unit's own
  worst case, of which this traversal's own ~2×`frameBudgetMs` is itself one instance — see the
  worst-case-span formula below and the performance gate)". (But see M-Q1 below: the *repair* introduced
  a new, narrower problem.)
- Appendix item 19 / §4.7 `[CONTRADICTION]` — gate criterion 6's "~16ms criterion". **Closed.** Live
  4220–4222 now reads "a total wall-clock figure says nothing about the tolerance criterion above".

Item 20's two remaining `~16ms` references (1857, 2701) are still present and are both explicitly
Round-18-narration-framed; they are the sync-work auditor's territory, not re-litigated here.

**NEW-vs-PRE-EXISTING attribution in this report is diff-verified, not inferred.** Round 22 is
uncommitted, so `git diff -- docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md`
(119 insertions, 33 deletions, one file) isolates exactly what this pass changed. Every attribution
below was checked against that diff rather than against Round 22's own disposition doc. What it shows,
for this system:

- The **abort-only ceiling bullet (1899–1909) is wholly new** — an added hunk, no predecessor text. It
  is the first passage in the document ever to make a collective claim about "the two `bvhcast`-native
  traversals," and the first to extend the private-clock claim beyond `ProperCrossingQuery`.
- **`SurfaceCrossingWitness`'s own passage (2308–2355) does not appear in the diff at all.** Its
  "the shared elapsed-time accumulator" clause at 2351 is pre-existing, dating to Round 21's post-v5
  remediation of H5-Q1.
- The clock-basis passage's only change is the `~16ms → ≈24ms` parenthetical at 1796–1800 (M-Q1).
- **No other line inside this system's boundary appears in the diff** — not the mode table (1559–1563),
  not `anyComponentInside` or its stage-3 scoping, not the containment guarantee or its parity-closure
  preconditions, not `classifyPoint`, not `ContainmentModeQuery`/`VolumeOverlapQuery`/
  `SurfaceIntersectionQuery`, not the `ClashDiagnostic` union or either role table, not one fixture.
  This independently confirms task item (c).

---

# Critical

**None.** No query-semantics claim in the current text is unsatisfiable by construction. The single
hard adjudication this pass faced (H-Q1 below) was explicitly weighed for Critical and rejected on the
lineage's established ground: an implementer *can* satisfy the contract by picking one of the two
stated clock bases, so it is unsatisfiable-**as-written**, not by construction — the same call v5 made
for its structurally identical H1 (`bvhcast`'s clock basis) and for A2/H-G1.

**All query-side protected Critical invariants re-verified intact against the live text:**

- **The mode dependency matrix (1559–1563)** — verified line by line, unchanged and internally
  consistent with every restatement site:
  | | `surface-intersection` | `containment` | `volume-overlap` |
  |---|---|---|---|
  | calls `anyComponentInside` | no (1266, 2370–2372) | yes, **stages 1–2 only** (2290–2296) | yes, **all three** (2178–2179) |
  | requires connectivity | **no** — "the only mode that never calls `anyComponentInside` at all, is genuinely connectivity-free" (1266, 1850, 2747, 3817–3819) | yes (1259–1272) | yes (1259–1266) |
  | parity evaluated against | nothing (1561) | target only (1562) | both (1563) |
  | open source | never diagnosed (1561, 1562, 2109–2112) | never diagnosed (1562, 2109–2112, 3468–3471) | `unverified-parity-operand` and/or `unverified-open-component`, `role:'source'` (1563) |
  | open target | never diagnosed (1561) | `unverified-parity-operand` (`role:'target'`) (1562, 2819–2821) | both, `role:'target'` (1563) |
- **Stage-3 scoping (2178–2198)** — "This stage is scoped to `volume-overlap`; `containment` never runs
  it" still stated exactly once as the single source of truth, with the two-coincident-boxes
  counterexample intact, the explicit non-claim ("not the same as asserting the component is
  clean-false", 2189–2198) intact, and both restatement sites (1259–1266, 2290–2296) still deferring to
  it rather than re-deriving the attribution. Fixture 3767–3774 still pins it.
- **The containment guarantee and its preconditions (2067–2141)** — the conditional statement, its
  Round-21 precondition phrasing ("established by `ProperCrossingQuery` returning false for
  `VolumeOverlapQuery`, and by `ContainmentModeQuery`'s own two-stage negative for `containment`, which
  has no `ProperCrossingQuery` term ahead of it", 2067–2071), the closed-manifold/open-or-non-manifold
  split (2084–2085), bidirectional flagging (2087–2107), the parity-closure precondition and its
  "depends on the deciding path, not on the mode alone" qualifier (2121–2132) — all **byte-consistent
  with the model's §3.5 extraction**. Untouched by Round 22.
- **`classifyPoint`'s two-layer non-circularity (2003–2015)** and the solid model (1517–1544) —
  unchanged.
- **Diagnostic roles (3294–3394)** — the role-tagged `ClashDiagnostic` union, both role tables
  (3336–3343 parity, 3355–3358 open component), the positives-are-diagnosed-only-for-soundness rule
  (3377–3394), and the Error-Handling restatements (3453–3485) — unchanged and mutually consistent.

Round 22's own changelog entry claims it touched "no behavior, fixture, query/lifecycle/cache/extraction
mechanism, or other finding" (750–751). **For this system that claim is true of every item above, and
false only in the narrow sense recorded as H-Q1 and M-Q1 below** — Round 22 did not touch any query
*mechanism*, but its new abort-only bullet makes a *scheduling* claim about a query component
(`SurfaceCrossingWitness`) that contradicts that component's own passage, and that scheduling claim has
a query-semantics (result-determinism) consequence.

---

# High

## H-Q1 — **NEW (contradiction introduced by Round 22) over a PRE-EXISTING (Round-21) unsoundness.** `SurfaceCrossingWitness` is now assigned two different, mutually exclusive clock bases, and the one its own passage states reproduces exactly the result-nondeterminism v5's H1 had Round 21 revert for `ProperCrossingQuery`.

**The two statements.**

- Round 22's new **abort-only ceiling** bullet, 1899–1904, speaking of **both** traversals by name:
  > "**An abort-only ceiling**, for the two `bvhcast`-native traversals (`ProperCrossingQuery`'s
  > `intersectsTriangles`, `SurfaceCrossingWitness`; …). A `bvhcast` traversal cannot pause and resume
  > once started, so its ceiling is enforced by permanently aborting it rather than by a checkpoint
  > inside it, and its **own** duration is self-bounded **independent of what ran before it** — a
  > private, traversal-local clock, **deliberately not the shared accumulator** (see the clock-basis
  > passage), worst case ~2×`frameBudgetMs`."
- `SurfaceCrossingWitness`'s own passage, 2350–2352 (Round 21's remediation text, untouched by Round 22):
  > "Being `bvhcast`-native, this traversal cannot `await`, yield, or resume: **the shared elapsed-time
  > accumulator** is checked at callback entry and immediately before every probe, and exceeding either
  > count ceiling or `frameBudgetMs` sets a traversal-local `aborted` flag…"

**A third site, also new in Round 22.** The Round-22 changelog entry itself (738–739) states the rule
universally over `bvhcast`: "every checkpoint in this design — **`bvhcast`'s own private clock being the
sole, already-documented exception** — is the same conditional, shared-`frameBudgetMs`-accumulator
check". A complete sweep of the document's clock-basis statements (`grep` for shared-accumulator /
traversal-local-clock / private-clock wording) returns exactly five normative sites: 1784 and 1795
(pre-existing, `ProperCrossingQuery`-scoped private clock), 738 and 1903–1904 (**both new in Round 22**,
both universal over `bvhcast`), and 2351 (pre-existing, `SurfaceCrossingWitness`, shared accumulator).
Four of the five now say private; the fifth, describing the traversal the other four sweep in, says
shared.

**Why this is High and not Medium.** Three distinct claims break, not just one wording:

1. **The clock basis is flatly contradictory.** "A private, traversal-local clock, deliberately not the
   shared accumulator" (1902–1903) and "the shared elapsed-time accumulator is checked" (2351) cannot
   both describe the same traversal. Before Round 22, the private-clock passage (1783–1801) was scoped
   to `ProperCrossingQuery` alone, so the two passages described *different* traversals — an
   inconsistency, but not a literal contradiction. Round 22's bullet is what makes it one, by extending
   the private-clock claim collectively to "the two `bvhcast`-native traversals."
2. **The self-bound the bullet asserts is false under 2351's mechanism.** "Its own duration is
   self-bounded **independent of what ran before it** … worst case ~2×`frameBudgetMs`" is precisely the
   property a *private* clock buys. Under the **shared** accumulator, the traversal's own duration is
   entirely a function of what ran before it: a traversal entered with the accumulator already at
   `frameBudgetMs − ε` aborts at its first probe; one entered with a freshly discharged accumulator runs
   a full `frameBudgetMs`. Bullet (b)'s parenthetical "see `ProperCrossingQuery`'s budgets above for the
   full derivation" points at a derivation (1783–1801) that is explicitly *about* the private clock and
   explicitly *about* `ProperCrossingQuery`'s own entry — it derives nothing for
   `SurfaceCrossingWitness` as 2351 describes it.
3. **The corrected formula inherits the error.** The abort-only tier's addend (1951–1954, "that
   traversal's own self-bounded worst case, ~2×`frameBudgetMs`") and the "what the formula *does* bound"
   list (1976–1979, "**the two `bvhcast`-native traversals' own self-bounded worst case**") both range
   over a traversal that, as its own passage describes it, has no such self-bound. Round 22 *widened*
   the formula's coverage claim to include this traversal without reconciling the mechanism.

**The query-semantics consequence — this is why it lands in this system, not only in sync-work.** For
`SurfaceCrossingWitness` the abort is not a scheduling event; it is **result-altering**. Its abort
"produc[es] a diagnosed negative with `crossing-budget-exhausted` rather than a witness" (2354), and
that second term "is not optional" (2298–2306) — it is the only thing that finds the
straddling-source-with-no-vertex-inside case (a duct through a beam; the lone large triangle) the mode
exists to catch. So under 2351's shared accumulator, **two `containment` queries presented with the
identical pair can return opposite verdicts (`true` vs. a diagnosed `false`) depending on how much
budget the rest of the same `findClashes` call already spent before reaching this pair.** That is
verbatim the hazard the clock-basis passage itself names as "the nondeterminism-in-its-own-inputs hazard
this design treats as a defect elsewhere" (1793–1794), and verbatim the finding v5's H1 raised (and
Round 21 remediated) for `ProperCrossingQuery`. The same defect survived, unflagged, in the sibling
traversal — because v5's query auditor's own H5-Q1 was about this passage's *scheduling class* (plain-JS
loop vs. `bvhcast`-native), and the remediation that rewrote it to be `bvhcast`-native landed the
shared-accumulator wording after that audit had reported.

**Adjudicated Critical → rejected.** An implementation can satisfy the design by choosing the private
clock (the side the clock-basis passage's own reasoning, the abort-only bullet, and the formula all
require), leaving only 2351 wrong. Unsatisfiable-as-written, not by construction — High, exactly as v5
rated H1.

**Recommended resolution (not applied by this audit):** change 2351's "the shared elapsed-time
accumulator" to a private, traversal-local clock started at this traversal's own entry, matching
1783–1801 and 1899–1904, and cross-reference the clock-basis passage as the shared derivation for both
traversals. This is a one-clause wording fix that makes three existing claims true rather than a
mechanism change; nothing else in the passage (counters, ceilings, `aborted` flag, post-`bvhcast`
inspection, the outer `CollisionWorld` yield) needs to move.

---

**Verification of the three items this audit was specifically asked to re-check:**

**(a) The abort-only bullet vs. `SurfaceCrossingWitness`'s scheduling class — Round 21's fix is intact;
Round 22 did NOT reintroduce or contradict it.** Confirmed at three independent sites:
`SurfaceCrossingWitness` "performs its own `bvhcast` over the source and target BVHs — a real traversal,
not the plain-JS sampling loop `anyComponentInside` uses" (2341–2343); "Being `bvhcast`-native, this
traversal cannot `await`, yield, or resume" (2350); and `ContainmentQuery`'s own cross-reference,
"`SurfaceCrossingWitness`, below, is **not** a third instance of this pattern — it is its own
`bvhcast`-native traversal, non-resumable like `ProperCrossingQuery`'s, and is checkpointed accordingly"
(2237–2239), sitting immediately after the corrected "**both** this sampling loop and stage 3's are
plain JS loops" (2236–2237 — two, not the pre-Round-21 "all three"). Round 22's bullet names it as one
of the two `bvhcast`-native traversals, which is **consistent** with all three. The scheduling class is
sound; only the clock basis (H-Q1) is not.

**(b) The `bvhcast` clock-basis passage vs. the corrected formula — structurally consistent, with one
new defect.** 1783–1801 still states the private-clock exception, its full determinism rationale, and
now (post-model-build) cites the corrected ≈24ms bound and explicitly identifies its own
~2×`frameBudgetMs` as one instance of the formula's "[unit's own worst case]" term. That is exactly the
formula's treatment of it (1951–1954). **However** the repair made the passage's own supporting
comparison circular — see M-Q1.

**(c) No query-mode contract, diagnostic-role rule, or containment-guarantee precondition was altered by
Round 22 — confirmed.** Each was read against the model's §3.1/§3.2/§3.3/§3.5/§3.7/§3.8 extraction and
matches. See the Critical section above for the site-by-site verification.

---

# Medium

**NEW — introduced by Round 22's own edits:**

- **M-Q1 (new; caused by Round 22 edit #5).** *The `bvhcast` self-bound's supporting comparison is now
  circular.* 1795–1800 argues for the private clock partly on the ground that its worst case "sits
  within, not beyond, the performance gate's own tolerance band (**Round 22: ≈24ms** — `frameBudgetMs`
  plus one non-preemptible/abort-only unit's own worst case, **of which this traversal's own
  ~2×`frameBudgetMs` is itself one instance**)". The band is now *derived from* the very quantity being
  compared against it, so "within, not beyond" is true by construction (16 < 8+16) and carries no
  argumentative weight. Under the pre-Round-22 wording the comparison was against an independently
  stated ~16ms gate figure, which is what made it evidence — and it is cited as evidence in
  `invariant-audit-v5.md`'s own remediation record for H1 ("the private clock's own worst case sits
  within, not beyond, the gate's tolerance band — so the fix traded a non-violation for a correctness
  regression"). The design choice itself remains sound on the *determinism* argument (1789–1794), which
  is independent and untouched; what is lost is the cost argument. Recommend either dropping the
  comparison or restating it against what it actually shows (that admitting this traversal to the
  abort-only tier does not widen the bound beyond the tier the build phases already set, ≈24ms either
  way). Adjudicated High → rejected: the sentence's arithmetic is true and no contract is
  unsatisfiable; only its justificatory force is gone.
- **M-Q2 (new; caused by Round 22's bullet (b)).** *"The two `bvhcast`-native traversals" conflicts with
  the document's own three-traversal count.* Bullet (b) (1899–1900) enumerates exactly two.
  `SurfaceIntersectionQuery`, however, runs a `bvhcast` traversal of its own — described as "the *same*
  `bvhcast` traversal `ProperCrossingQuery` uses, sharing `maxCandidatePairsExamined`, the same
  per-candidate `intersectsTriangle` test, and the same abort protocol — with a weaker predicate"
  (1690–1693) — and the `ContainmentModeQuery` fixture at 3763–3766 explicitly counts
  `SurfaceCrossingWitness` as "a **third** traversal" ("the round-7 lesson was that each new traversal
  needs its own bounding proof rather than inheriting the claim that 'the budgets bound the worst
  case'"), which the Risks entry echoes (4347–4351). Reading "the same traversal" as literally one code
  path makes the count of two defensible, but the formula's coverage list (1976–1979) then bounds
  `surface-intersection` mode's own worst-case span only by that inheritance, which the doc elsewhere
  explicitly warns against relying on. A one-clause note ("`SurfaceIntersectionQuery` runs
  `ProperCrossingQuery`'s traversal under a weaker predicate and is covered by the same term") would
  close it.
- **M-Q3 (new; caused by Round 22's coverage-list widening).** The formula now explicitly bounds "the
  two `bvhcast`-native traversals' own self-bounded worst case" (1978), while the performance gate still
  names no criterion measuring `SurfaceCrossingWitness`'s own span (criteria 7/8/9/10 each name their
  target; criterion 1 covers it only under the generic "any synchronous task"). Round 22 widened the
  claim without widening the measurement obligation. (This is the model's `[SILENT]` Appendix item 21,
  now upgraded from silence to a mismatch between a stated bound and the gate that is supposed to earn
  it.)

**PRE-EXISTING, newly surfaced by this read (not caused by Round 22, not recorded in v5):**

- **M-Q4.** *`SurfaceCrossingWitness`'s count-budget scoping is stated per-traversal while it shares the
  constants with `ProperCrossingQuery`.* 2343–2346 gives it "a **traversal-local**
  `candidatePairsExamined` counter" bounded by `maxCandidatePairsExamined = 50_000` and says a confirmed
  pair "also consumes `maxCrossingPairsExamined = 64`". In `containment` mode this is the only traversal,
  so nothing collides; but nothing states whether the constants are per-traversal or per-pair budgets in
  general, and `SurfaceIntersectionQuery` is described as *sharing* `maxCandidatePairsExamined` with
  `ProperCrossingQuery` (1691–1692) — "sharing the constant" and "sharing a counter" are not
  distinguished anywhere. Low practical risk in Milestone 1 (no mode runs two `bvhcast` traversals over
  one pair), but the wording will not survive a mode that does.
- **M-Q5.** *The `crossing-budget-exhausted` type comment (3305) still omits the time-based trigger*
  ("maxCandidatePairs/maxCrossingPairs hit; traversal aborted"), while both traversals can raise it on
  elapsed time (1783–1784, 2352). Recorded in v5's sync-work Medium list; noted here only because it is
  now *two* traversals' behavior the canonical definition under-describes, not one. **Unchanged, not
  re-litigated.**

**PRE-EXISTING and unchanged (confirmed byte-consistent with the model; not re-litigated):**

- The `maxCrossingPairsExamined` diagnostic-mapping split — 3305 and 3478–3480 map it to
  `crossing-budget-exhausted`; 3483–3485 maps "hitting … `maxCrossingPairsExamined` before deciding" to
  `inconclusive-crossing`. Recorded by v5's query auditor as a second, pre-existing mapping
  contradiction. **Unchanged.**
- The "stage" terminology overload across two nesting levels (`anyComponentInside`'s stages 1/2/3 at
  2152–2167 vs. `ContainmentModeQuery`'s two composition terms at 2357–2361, plus "own two-stage
  negative" at 2069 and "Stage 2 added a third traversal" at 3763). v5's M5-Q1/M-Q2, model item 16.
  **Unchanged.**
- The containment guarantee's "only decides the outcome once no proper crossing exists" wording not
  accounting for `volume-overlap`'s early-exit positive path (v5 M5-Q2). **Unchanged.**
- The `unverified-parity-operand` role table's completeness (v5 M5-Q8/M5-Q9). **Unchanged.**
- The target-side connectivity "the check is free" claim (2131–2132) after H-Q4's own fix (v5 M5-Q3).
  **Unchanged.**
- The Public API comment's diagnostic enumeration omitting `non-manifold-component` (v5 M5-Q4).
  **Unchanged.**

---

# Low

- The containment guarantee's cross-reference "see **Stage ordering is cheapest-first**, under
  `ContainmentModeQuery` below" (2070–2071) points at a phrase that is a plain sentence opener at 2357,
  not a bolded sub-heading like every other target this document cross-references by name. Pre-existing.
- 2348–2350's probe-count comparison ("at most twelve for `ProperCrossingQuery`'s own two-classification
  probes, so at most half the *classification* count per confirmed pair, though total runtime still
  needs measurement, not the 'roughly half' this passage previously overclaimed") is now the only
  runtime-cost statement about `SurfaceCrossingWitness` anywhere in the document, and it explicitly
  declines to bound runtime — which sits oddly beside Round 22's new claim that the traversal's own
  worst case is ~2×`frameBudgetMs` (1904). Not a contradiction (one is a per-pair classification count,
  the other a whole-traversal time bound), but a reader looking for the traversal's cost basis finds a
  disclaimer at one site and an asserted bound at the other. Folded into H-Q1's recommended fix.
- The five finding-label namespaces (v1 "C4/C5", v2 "C-1…C-4", v3 "C-5", v4 "H-*", v5 "H2") with v5's
  "H2" now appearing inside normative text at 1931 — model Appendix item 3, coordinator-level, noted in
  passing.

---

# Summary for this system

| | Count | |
|---|---|---|
| Critical | **0** | all query-side protected invariants (mode dependency matrix, stage-3 scoping, containment guarantee + preconditions, `classifyPoint` non-circularity, diagnostic roles) independently re-read and confirmed intact |
| High | **1** | H-Q1 — `SurfaceCrossingWitness` assigned two mutually exclusive clock bases (1902–1903 vs. 2351); the stated one makes a non-resumable, **result-altering** abort a function of scheduling position, so identical `containment` pairs can reach opposite verdicts, and it falsifies the self-bound Round 22's new bullet and formula both assert for it |
| Medium | **5** | M-Q1 circular gate-band justification (NEW); M-Q2 "two traversals" vs. the doc's own three-traversal count (NEW); M-Q3 formula bounds a traversal the gate never measures by name (NEW); M-Q4 per-traversal vs. shared count-budget scoping (pre-existing, newly surfaced); M-Q5 `crossing-budget-exhausted`'s definition omits the time trigger (pre-existing, known) |
| Low | **3** | cross-reference target formatting; the runtime-cost disclaimer/asserted-bound mismatch at 2348–2350 vs. 1904; label-namespace sprawl |

**NEW vs. PRE-EXISTING, explicitly:**
- **(a) NEW, caused by Round 22's edits:** H-Q1's *contradiction* (bullet (b) at 1899–1909 extended the
  private-clock claim to `SurfaceCrossingWitness`), M-Q1, M-Q2, M-Q3. Round 22 introduced no new query
  mechanism, constant, mode, diagnostic, or fixture — confirmed by reading, not by trusting its entry.
- **(b) PRE-EXISTING, surfaced by this read:** H-Q1's *substantive* half — `SurfaceCrossingWitness`
  reading the shared accumulator has been in the text since Round 21's post-v5 remediation rewrote that
  passage, and reproduces the exact defect v5's H1 had reverted for `ProperCrossingQuery`; it was not
  flagged in v5 because that remediation landed after v5's audits reported. Also M-Q4.
- **(c) Confirmed unchanged:** every prior known query-semantics Medium/Low listed above, plus all six
  protected Critical invariants (the two in this system — the mode dependency matrix and the containment
  guarantee — verified site by site).

---

## Second opinion

`codex-advisor` (per the standing preference over the native `advisor` tool; the native tool was not
used) was consulted once, at `medium`, on the two hard adjudication calls — H-Q1's Critical-vs-High
rating and M-Q1's Medium-vs-High rating. Request `20260902-235644-18725-20047`.

**Outcome: both calls independently confirmed**, with Codex re-deriving each verified fact from the spec
itself rather than from my framing.

- **H-Q1 → High.** "A substantive normative contradiction with observable query consequences, but not an
  architectural impossibility. The spec can become satisfiable by choosing the private clock already
  required by the general rule, formula, and sibling traversal." Explicitly rejected Critical ("Critical
  would only fit if the private-clock repair still could not satisfy another indispensable invariant.
  The repository shows the opposite: the sibling traversal already uses that coherent resolution") and
  explicitly rejected Medium ("The public, result-altering nature establishes materiality and rules out
  Medium"). It also independently pushed back on the *counter*-argument I had asked it to test — that
  the "self-bounded independent of what ran before it" clause might be loose prose: "Do not describe
  Adjudication 1 as merely 'loose prose': the shared-clock passage specifies an exact checkpoint and
  abort mechanism, while the private-clock rule feeds the normative worst-case formula."
- **M-Q1 → Medium.** "Arithmetically true but evidentially vacuous. It weakens the justification without
  creating a false contract, contradictory mechanism, or unsatisfiable acceptance criterion … circular
  support is not automatically an 'unsound claim' at High severity." Noted Low as defensible if
  non-load-bearing rationale is treated as purely editorial, but preferred Medium "because the sentence
  is explicitly presented as technical support and the previous audit relied on it as evidence" — which
  is the ground this report already gave.

Codex's one recorded uncertainty is worth carrying forward: the opposite-verdict scenario under H-Q1 "is
a realistic constructed case, not verified by an executable fixture." No fixture in the document
currently exercises `SurfaceCrossingWitness`'s time-based abort at all — the budget-exhaustion fixture at
3763–3766 exercises the *count* ceilings via the shared interleaved-comb input. Adding a mocked-clock
fixture for this traversal (the analogue of `ProperCrossingQuery`'s own at 3608–3624) would pin whichever
clock basis the fix chooses, and is recommended alongside the wording repair.
