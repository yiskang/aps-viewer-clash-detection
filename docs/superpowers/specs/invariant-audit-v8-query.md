# Invariant Audit v8 — System 3: Query-mode semantics and dependencies

**Target**: `docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md` (4812 lines,
current working tree — Round 30's edits are uncommitted; HEAD still holds the 4712-line
post-Round-29 text). **Date**: 2026-09-03. **Model consumed**: `invariant-audit-v8-model.md` §3, with
§0, §4 and §6 cross-read.

## Method and evidentiary rules

Every line citation below was re-read by this pass directly against the **current** file. No
disposition doc (`round-18-*` … `round-30-*`) and no prior audit (`invariant-audit-v1` … `v7*`) was
used as evidence that anything is presently fixed. `round-30-high-only-fix-pass-disposition.md` was
read once for orientation and treated as evidence of nothing; each of its H-1 and H-5 claims was
re-derived from live text. `invariant-audit-v7-query.md` was used only for citation context and for
the NEW-vs-PRE-EXISTING classification.

The spec's `## Revision Notes (post-review)` section (lines 40–799) is a past-tense changelog and is
never cited here as a current invariant. All normative citations are from lines 801–4812.

No `codex-advisor` / `codex-review` consult was run this pass: the one judgment call that warranted
it (the severity of **M-Q6**) resolved against this lineage's own precedent — v7 rated the
structurally identical M-SW3 ("welding is the largest" falsified by the same passage's own scaling
argument) **Medium**, and this finding has the same shape (a falsified present-tense *factual* claim
that governs no rule and no result field).

**Nothing in the spec was modified by this pass.**

---

# Critical

**None.** No query-mode composition, on any branch examined, produces a wrong boolean result or an
unrecoverable state. The one soundness question Round 30's H-1 fix newly exposes —
whether `containment`'s exemption is defensible for **non-manifold** (not merely open) sources, a
scope Round 30 added at 3763 that the three canonical sites (2312–2315, 1656, 3088–3089) do not
state — was independently re-derived and **holds**; see "H-1: independent verification", case 3.

---

# High

**None.** Both of v7's High findings are closed in the current text.

- **H-Q1** (`containment` / `non-manifold-component` scope contradiction) — **fixed, cleanly.** All
  six occurrences re-verified individually; see the verification record below.
- **H-Q2** (`SurfaceIntersectionQuery` absent from the scheduling taxonomy) — **fixed** at all four
  passages v7 named, plus the definition site itself. The uniqueness claim is reframed
  protocol-level rather than mechanically incremented, so it is no longer falsified by a second
  traversal. `SurfaceCrossingWitness` stays correctly distinct. See "H-5: independent verification".

Two residuals of those fixes and one Round-30-introduced defect are recorded below at Medium/Low.

---

## H-1: independent verification (the fix is clean)

`grep -n non-manifold-component` on the current file returns **exactly six** occurrences. Each was
read in full context:

| Line | Site | Verdict |
|---|---|---|
| 2291 | `> Round 5 emitted 'non-manifold-component' only on *negative* results, which a review pass showed is backwards…` | Past-tense narration of a superseded round inside the `anyComponentInside` block quote. Not a rule. |
| 2310 | `> - a **negative** result involving any flagged component emits 'non-manifold-component'.` | Governed by the block prefix at 2295–2296 — "So, **in `volume-overlap` mode**:". Scoped correctly. |
| 3082 | Public API mode comment | Physically inside the `'volume-overlap'` comment block (3075–3083); the `'containment'` block begins at 3084. Scoped by position. |
| 3590–3591 | `PairDiagnosticReason` union | **Round 30 added** `// (never emitted in 'containment' mode — see Query modes)`, matching the `unverified-open-component` sibling at 3594. Verified present, correct indentation. |
| 3762–3766 | Error Handling bullet | **Round 30 rewrote.** The Side-B clause "(the public source in `containment` mode;" is **gone** — the parenthetical now reads "(either public operand in `volume-overlap` mode, depending on which containment term is sampling it)" — and "**Not emitted in `containment` mode**" plus the bathtub/14-open-components rationale is added. |
| 3967–3970 | `ContainmentQuery.anyComponentInside` fixture | **Round 30 added** "(this exercises the shared `ContainmentQuery` primitive directly; a negative reaching `findClashes` through `containment` mode's source path never carries it — see **Query modes and their preconditions**)". |

**No site in the current text asserts that `containment` emits `non-manifold-component`.** The three
canonical Side-A sites v7 identified are intact and untouched (2312–2315, 1656, 3088–3089). The
contradiction v7 rated High is genuinely gone, not relocated: the fix touched all three surfaces v7
said it had to (the Error Handling parenthetical, the union comment, and the fixture's mode scope),
which is exactly the "otherwise the contradiction simply relocates" condition v7 recorded at its
§"What a fix would have to touch".

**Cross-check: is the exemption coherent, not merely consistently stated?** Three cases, re-derived:

1. **Only the source is sampled in `containment`.** 2489–2492 composes the mode as
   `ContainmentQuery(anyComponentOf(A) inside B) OR SurfaceCrossingWitness(A, B)`; 2494–2495 fixes it
   to one direction. 3759 scopes the diagnostic to "components **sampled by `anyComponentInside`**".
   So no target component can be a candidate for this diagnostic in `containment` mode at all, and
   the blanket claim at 3591/3763 follows from the source-scoped rationale in one step.
2. **A non-manifold *target* in `containment` is still covered** — by `unverified-parity-operand`,
   via 2326–2328's "every operand that parity is evaluated against must be a **certified closed
   manifold**", a predicate that excludes non-manifold as well as open. This is stated, not merely
   derivable. (The mode table's *column header* says "open target", which is the imprecision recorded
   at **L-Q2**, not a gap in the rule.)
3. **The exemption is sound for non-manifold sources, not only open ones** — the scope Round 30 added
   at 3763 ("whose contract covers open **or non-manifold** sources by construction"), which none of
   the three canonical sites states. Re-derived on the doc's own shared-edge counterexample
   (2280–2285): if a flagged source component has points strictly inside B and points strictly
   outside B, the component is connected, so its surface meets `∂B`; a triangle coplanar with a face
   of B has no strictly-inside points, so the transition must occur at a **non-coplanar** triangle
   pair, which is exactly what `SurfaceCrossingWitness` consumes (2515–2523) — including the
   edge-on case, where `M` sits on the source triangle's own edge and `+u` probes into the triangle's
   interior below `∂B`. Where no such segment exists (a triangle whose vertices all sit on a curved
   target boundary), term 1 leaves the component unresolved after stage 2 (2395–2405) and 2501–2503
   routes the pair to a **diagnosed** negative (`inconclusive-containment`), never a clean one.
   No silent false negative was found on any branch.

**Answer to the brief's explicit question on M-Q1 and M-Q2** (did Round 30 incidentally touch them?):

- **M-Q1 — not touched; marginally aggravated.** The completeness/soundness reconciliation at
  3669–3686 is byte-identical in substance and still omits `non-manifold-component` from both
  enumerations. Round 30 added a *mode scope* to the diagnostic's union comment (3591); the
  reconciliation now carries explicit mode scope for both soundness diagnostics (3678–3679,
  3680–3682) and none at all for this one, so the enumeration desync is one column wider than v7
  found it.
- **M-Q2 — not fixed, but incidentally narrowed, for the better.** Round 30's Error Handling rewrite
  deleted the clause "(the public source in `containment` mode;" from 3759. That clause was one of
  the two v7 cited when it wrote "if H-Q1 resolves to Side B, a containment-mode `role:'source'`
  emission would sit awkwardly against 3634–3635's 'a `containment` result … can indict `target`
  only'". That branch is now moot. The core gap is untouched: 3606–3608's exhaustive `role` rule
  still omits `non-manifold-component` from both its "required" and its "absent" list, no role table
  covers it (3621–3628, 3647–3655), and 3759–3761 still makes it operand-specific in
  `volume-overlap`.

---

## H-5: independent verification (query side)

The brief asks specifically whether `SurfaceIntersectionQuery`'s own definition site (1767–1799)
stays internally consistent after Round 30's added private-clock sentence, and whether
`SurfaceCrossingWitness` stays distinct.

**Definition site (1787–1799) — internally consistent.** The added sentence reads:

> **"The same abort protocol" includes the private, traversal-local time-based trigger** (see
> `ProperCrossingQuery`'s Abort protocol below, and the scheduling taxonomy's abort-only tier, which
> this traversal shares with `ProperCrossingQuery`'s): this traversal's own worst case is therefore
> `frameBudgetMs` + one raw candidate callback's own cost, not a function of the shared accumulator
> or of what else ran earlier in the same call.

Re-derived against primary text rather than accepted: 1927–1930 states that "A raw candidate pair
that never reaches probe classification is still checked at **callback entry**, as before — that
path's per-candidate cost is already measured (~0.3µs) and small enough that entry-granularity is
adequate there." `SurfaceIntersectionQuery` "returns `true` on the first candidate pair that
intersects **at all**, so it needs neither the coplanar split … nor the probe ladder" (1791–1793) —
i.e. it has **only** the callback-entry path, which is precisely the path 1927–1930 already covers.
The inherited-clock claim is therefore not an assertion by fiat; it follows from where the check
already fires. The `frameBudgetMs` + one-raw-callback worst case follows in turn, and matches
2026–2029 and 2129–2132 verbatim. No internal conflict at the definition site.

**`SurfaceCrossingWitness` stays distinct — confirmed at five sites, none edited by Round 30.**
2558–2562 (its own definition: "the **shared** elapsed-time accumulator is checked at callback entry
and immediately before every probe"), 2036–2040 (explicitly "**not** a second instance of this
exception"), 2120–2122, 2170, 2193–2194. Its tolerances row (1584, "`containment` only") and its gate
criterion (4552–4557, "belongs to this same **cooperatively-yieldable** tier") are likewise
untouched. No edit merged the two traversals' treatment; no fifth taxonomy class exists.

Two defects fall out of this fix and are recorded below: **M-Q5** (the phrase "the same abort
protocol" now carries two incompatible meanings) and **M-Q6** (the traversal ordinal at 2034 is now
falsified by an edit fourteen lines above it). The residual tier-assignment seam for
`SurfaceCrossingWitness` (v7 cross-system concern 2) is unchanged and still self-bracketed by the
document at 2040–2044.

---

# Medium

## M-Q1 — `non-manifold-component` is absent from *both* halves of the completeness/soundness reconciliation

**PRE-EXISTING; marginally aggravated by Round 30.** 3669–3686 presents itself as *the*
reconciliation of which diagnostics attach to which result polarity ("This is the reconciliation:
*completeness* diagnostics are negative-only; *soundness* diagnostics apply in both directions",
3684–3686). It enumerates completeness diagnostics at 3671–3673 (`incomplete-component-coverage`,
`inconclusive-containment`, `inconclusive-crossing`, `crossing-budget-exhausted`) and soundness
diagnostics at 3674–3682 ("there are **exactly two** such cases" — `unverified-parity-operand`,
`unverified-open-component`). `non-manifold-component` appears in neither, in a passage that
partitions the space.

Its own union comment (3590) says "**NEGATIVE** result involving a component the guarantee misses",
which would place it in the completeness list; the omission looks like oversight, not deliberate
exclusion. Round 30 added a mode scope to that comment (3591) while the reconciliation section — which
now carries mode scope for both soundness diagnostics (3679 "Applies in `containment` and
`volume-overlap`"; 3680 "`volume-overlap` only") — still says nothing about this diagnostic at all.

## M-Q2 — `non-manifold-component`'s `role` field is unspecified

**PRE-EXISTING; incidentally narrowed by Round 30, not closed.** 3606–3608 states the `role` rule by
exhaustive enumeration: "`role` is required for reasons that indict one operand —
`'unverified-parity-operand'` and `'unverified-open-component'` — and absent for reasons about the
pair as a whole (budget exhaustion, coverage truncation, inconclusive results)."
`non-manifold-component` is in **neither** enumeration, and neither role table covers it (3621–3628,
3647–3655). Meanwhile 3759–3761 still makes it explicitly operand-specific — "either public operand
in `volume-overlap` mode, depending on which containment term is sampling it" — which is exactly the
shape `role` exists to express. An implementer cannot tell whether
`{scope:'pair', reason:'non-manifold-component'}` carries `role`.

What changed: Round 30 deleted the "(the public source in `containment` mode;" half of that
parenthetical, so the finding is now cleanly `volume-overlap`-only and no longer interacts with
3634–3635's "a `containment` result … can indict `target` only". The rule itself was not added.

## M-Q3 — "certified closed manifold" is asserted at operand granularity but read at component granularity

**PRE-EXISTING, untouched by Round 30.** The parity closure precondition is stated per **operand** —
"**every operand that parity is evaluated against must be a certified closed manifold**" (2326) — and
parity is defined over the target's *entire triangle set* (1611–1613). But the flag actually consulted
is per **component**: "this parity check reads its cached manifold classification" (2334–2335) off
`GeometryConnectivity`, which "**classifies each component** while building the edge map: a component
is **manifold** if every one of its edges is shared by exactly two triangles" (1761–1762). 2287–2288
is likewise per-component. No rule states how per-component flags aggregate to an operand-level
predicate.

Not hypothetical: the document's own headline justification for even-odd parity is the **hollow pipe**,
"an outer cylinder plus an inner cylinder" (1615–1616), which after welding is **two** closed manifold
components. Under a single-component reading, every pipe target spuriously emits
`unverified-parity-operand`; under an every-component reading it does not. The acceptance-model
measurement is stated only for the single-component case (2341–2342: "1 component, 0 boundary edges,
0 non-manifold edges"), so nothing in the spec exercises the multi-component target it explicitly
designed for, and MEP models are named as the target domain (1618).

## M-Q4 — `maxCrossingPairsExamined`'s scope is unstated in both traversals that use it

**PRE-EXISTING, untouched by Round 30; implication widened.** `candidatePairsExamined` is explicitly
traversal-local at both traversals that maintain one — "a **fresh traversal-local**
`candidatePairsExamined` counter for each traversal" (1788–1789) and "a **traversal-local**
`candidatePairsExamined` counter" (2551–2552). `maxCrossingPairsExamined = 64` gets no such qualifier
at either site: 1868–1869 introduces it as counting "confirmed intersecting non-coplanar pairs" with
no scope, and 2553–2554 says only that a confirmed pair "also consumes `maxCrossingPairsExamined = 64`".
Grep-confirmed: every "traversal-local" occurrence (1789, 1795, 1897, 2017, 2119, 2196, 2551, 2560)
attaches to the candidate counter, the clock, or the `aborted` flag — never to the crossing counter.

In `containment` mode the ambiguity compounds exactly as v7 recorded: the mode runs one
`SurfaceCrossingWitness` traversal per candidate pair, so a call-scoped 64 would silently truncate
later pairs in a multi-room locate query while a traversal-scoped 64 would not. Round 30's H-5 edit
adds a third traversal to which "the same abort protocol" is now normatively asserted to apply
(1795–1796), so the unscoped budget is now inherited by one more traversal than before — for a mode
(`surface-intersection`) that cannot increment it at all (see **L-Q1**).

## M-Q5 — "the same abort protocol" now carries two incompatible meanings, on the exact axis the taxonomy separates

**PRE-EXISTING latent; ACTIVATED by Round 30's H-5 edit.**

Round 30 made the phrase load-bearing by *defining* it at 1795–1796:

> **"The same abort protocol" includes the private, traversal-local time-based trigger**

But 2558–2562 applies the same phrase to `SurfaceCrossingWitness`, whose trigger is explicitly the
**shared** accumulator, in one sentence:

> …**the shared elapsed-time accumulator** is checked at callback entry and immediately before every
> probe, and exceeding either count ceiling or `frameBudgetMs` sets a traversal-local `aborted` flag
> and returns `true` from the callback — inspected after `bvhcast` returns, **exactly as
> `ProperCrossingQuery`'s own abort protocol works**…

Read with Round 30's definition, "exactly as `ProperCrossingQuery`'s own abort protocol works"
asserts a private clock for a traversal the same sentence says reads the shared one. The em-dash
clause is narrowly scoped to the flag-inspection mechanics on a careful read, so this resolves — but
clock basis is precisely the axis the taxonomy uses to separate the two traversals (2034–2040,
2118–2122, 2193–2196), which makes this the one phrase in the document that must not be ambiguous
about it. Pre-Round-30 the phrase at 1790 was itself undefined (v7 H-Q2's "also unstated" sub-point),
so the collision was latent; Round 30 closed one end and left the other.

**Severity**: Medium, not High — the shared-accumulator statement is explicit and immediately
adjacent, and no normative rule is contradicted, only a cross-reference's vocabulary.

## M-Q6 — the count of `bvhcast`-native traversals is now falsified inside the paragraph that states it

**PRE-EXISTING, AGGRAVATED by Round 30 to a same-paragraph inconsistency.**

2034–2036 reads:

> **`SurfaceCrossingWitness` is a second `bvhcast`-native traversal … but is not a second instance of
> this exception**

Fourteen lines earlier, in the **same bullet**, Round 30 wrote (2020–2021):

> used by both `ProperCrossingQuery`'s traversal **and `SurfaceIntersectionQuery`'s**

Under the bullet's own new framing there are three named `bvhcast`-native traversals, so
`SurfaceCrossingWitness` is the **third**, not "a second"; and the exception now already has two
instances, so "not a second instance" is numerically stale in both halves of the sentence. 4075
independently says "`ContainmentModeQuery`'s second composition term added a **third** traversal to
the design", agreeing with the three-count and disagreeing with 2034.

The mitigating reading — 1787 calls `SurfaceIntersectionQuery` "the *same* `bvhcast` traversal
`ProperCrossingQuery` uses", i.e. one implementation used twice — does not survive 2118–2132, which
costs the two as **distinct addends** with different worst cases, nor 1789's "a fresh traversal-local
`candidatePairsExamined` counter for each traversal".

**Severity**: Medium, not High. The sentence's *operative* content (`SurfaceCrossingWitness` is
excluded from the private-clock exception) is correct and independently stated at four other sites;
the defect is a falsified present-tense ordinal that governs no rule and no result field. This
matches the severity v7 assigned M-SW3, whose shape ("welding is the largest" falsified by the same
passage's own scaling argument) is the same.

---

# Low

## L-Q1 — `crossing-budget-exhausted`'s definition still does not fit `surface-intersection`, but Round 30 narrowed it

**PRE-EXISTING, narrowed.** 1794 asserts "`crossing-budget-exhausted` means the same thing in both"
modes. Its union comment (3588–3589) defines the trigger set as "candidate-count, **crossing-count**,
or elapsed-time ceiling hit". `surface-intersection` "returns `true` on the first candidate pair that
intersects **at all**", needing "neither the coplanar split … nor the probe ladder" (1791–1793), and
`maxCrossingPairsExamined` counts only "confirmed intersecting non-coplanar pairs — the ones that
reach probe classification" (1868–1869), so the crossing-count trigger cannot fire for this mode.

**Round 30 improved this incidentally**: before the fix, the elapsed-time trigger's applicability to
this mode was itself unstated (v7 H-Q2's sub-point), so only *one* of three triggers demonstrably
applied. 1795–1799 now establishes the time trigger, so **two of three** apply. The residual defect
is one dead trigger in a shared definition, plus the fact that "the same abort protocol" (1790,
1879–1883) implies this mode maintains a crossing counter it can never increment.

## L-Q2 — the mode table's open-operand columns read as blanket "never diagnosed", and say "open" where the rule says "not certified closed"

**PRE-EXISTING, untouched.** Two distinct imprecisions in the table at 1653–1657:

- 1655's `surface-intersection` row reads "fine, never diagnosed" for both operands and 1656's
  `containment` row reads the same for the source. Against the column headers these are claims about
  the *parity/closure* diagnostics only, but both modes can still emit `crossing-budget-exhausted`
  (fixture 3877–3883) and `geometry-too-large-for-sync-build` (2993–2998). The narrow reading is
  fixture-pinned (3884–3885: "an open source and an open target — intersects, with **no
  diagnostic**") and is now also asserted as blanket normative text at 3591 and 3594, so the table's
  scoping imprecision is inherited by the type union.
- Both operand columns are headed "**open** source" / "**open** target", while the rule they
  summarize (2326–2328, 3595–3597) is keyed on "**not a certified closed manifold**" — which also
  covers a closed-but-non-manifold operand. A non-manifold `containment` target is correctly covered
  by `unverified-parity-operand` under 2326–2328, but is invisible in the cell that is supposed to
  summarize the mode's diagnostics.

## L-Q3 — "the second term establishes the antecedent" overclaims for the aborted second term

**PRE-EXISTING, untouched.** 2566–2569 says a `containment` negative "requires *both* composition
terms to fail, which strictly **strengthens** `anyComponentInside`'s guarantee … the second term
(`SurfaceCrossingWitness`) is what now **establishes** the antecedent instead of assuming it." That
holds for a *clean* second-term negative. It does not hold when the second term fails by budget abort
(2559–2562 → `crossing-budget-exhausted`) or by unproducible probe (2535–2541 →
`inconclusive-crossing`): those establish nothing about whether a proper crossing exists. Both cases
are correctly *diagnosed*, so no unsound answer escapes — but 2267–2278's containment guarantee is
written as if predicated on the unqualified claim.

## L-Q4 — Round 30 introduced a dangling section cross-reference inside `SurfaceIntersectionQuery`'s own definition

**NEW, Round-30-introduced.** 1783–1785 now reads:

> …it is not, and was never meant to be, the whole-design worst-case-span guarantee that **Budget
> enforcement and yield points** explicitly disclaims (see "still not a finite worst-case-span
> guarantee").

**No section, sub-heading, or bolded anchor by that name exists anywhere in the document.**
Grep-confirmed: the phrase occurs exactly twice (1784 and 4724), both as forward references, both
introduced by Round 30's H-2 edits; the heading list contains no such entry. The quoted sub-phrase
*does* resolve — it is the Round-22 passage at 2149–2164 inside `ProperCrossingQuery`'s budgets — and
every other cross-reference in this region uses the anchors "`ProperCrossingQuery`'s budgets" or "the
worst-case-span formula". Recorded here (rather than left to System 4) because one of the two sites
is inside this system's own `SurfaceIntersectionQuery` passage.

## L-Q5 — the union comment's partial mode exemption implies, by exclusion, that `surface-intersection` can emit `non-manifold-component`

**NEW, residual of the H-1 fix.** 3590–3591 now reads
`// NEGATIVE result involving a component the guarantee misses / (never emitted in 'containment' mode — see Query modes)`.
Exempting exactly one of the two non-`volume-overlap` modes implies the other is not exempt — but
`surface-intersection` "never calls `anyComponentInside` at all" (1333), has "No closure precondition"
(3093), is "fine, never diagnosed" for both operands (1655), and is fixture-pinned to emit **no**
diagnostic on an open/open pair (3884–3885). The implication is unreachable in practice (the mode has
no component-sampling path to emit from), which is why this is Low rather than Medium. Note the
sibling `unverified-open-component` comment (3592–3594) has the same shape and predates Round 30, so
the fix replicated an existing pattern rather than inventing one; the sibling is self-limiting
because its comment text already says "volume-overlap POSITIVE", whereas this one's does not name a
mode at all in its first line.

## L-Q6 — the `ContainmentQuery.anyComponentInside` fixture block mixes primitive-level and mode-level fixtures, and the new parenthetical asserts a framing the block does not honor

**NEW, residual of the H-1 fix.** Round 30's addition at 3967–3969 states the fixture at 3965–3970
"exercises the shared `ContainmentQuery` primitive **directly**". But the same bullet list, filed
under the same `ContainmentQuery.anyComponentInside` heading (3957), contains at least three fixtures
that cannot be run against the primitive alone because they assert on **mode**:

- 3983–3989 — "must report the containment as positive **in both modes**, and carry
  `unverified-open-component` **in `volume-overlap` mode only**";
- 3990–3997 — "must report **`volume-overlap` positive** via `anyComponentOf(target) inside source`";
- 4010–4017 — "an open source producing a **proper crossing** must emit `role: 'source'`", which
  requires `ProperCrossingQuery` to have run.

Diagnostics are a property of `ClashResult.statistics` (3568), not a return value of
`anyComponentInside`, so the primitive/composition distinction Round 30 introduced is real and
useful — it is just not reflected in where the block's other fixtures live. Harmless as written; it
becomes a test-authoring trap if the distinction is later relied on.

## L-Q7 — two cross-reference targets were not updated for `SurfaceIntersectionQuery`'s new taxonomy membership

**NEW/PRE-EXISTING mix, both minor.**

- 1795–1796's new sentence points the reader at "`ProperCrossingQuery`'s **Abort protocol** below"
  for the private-clock trigger. The passage literally headed **"Abort protocol"** (1879–1883) covers
  only the two *count*-based triggers; the time trigger is introduced separately at 1885 as "**A
  third**, time-based trigger". The claim is stated normatively at 1795 so it does not depend on the
  pointer, but the pointer lands one paragraph short of what it cites. (This is the precise sub-gap
  v7's H-Q2 flagged: "1863–1867 is the passage headed 'Abort protocol' and covers only the two
  count-based triggers".)
- 3045–3047 still enumerates the finer-granularity intra-stage checkpoints as
  "`ProperCrossingQuery`'s `bvhcast` traversal and `ContainmentQuery`'s sampling loops", omitting both
  `SurfaceIntersectionQuery`'s traversal (now a first-class abort-only member, 2018–2029) and
  `SurfaceCrossingWitness`'s. PRE-EXISTING for the second; newly incomplete for the first.

---

# Historical-only / non-defect observations

- **All five protected query invariants re-verified intact**, each independently re-read this pass:
  - **The three canonical mode contracts.** `SurfaceIntersectionQuery` (1767–1799),
    `ContainmentModeQuery` (2486–2583), `VolumeOverlapQuery` (2448–2484). All three compositions are
    internally consistent and consistent with the mode table (1653–1657), the Public API comments
    (3074–3093), and the narrow-phase dispatch (2589, 3014–3015).
  - **Containment remains source-surface-only.** 1659–1675 (directedness derivation), 1686–1689 ("The
    source is *sampled* for points; it is never parity-tested"), 2494–2495 ("One direction only"),
    2546–2548 ("stays **on the source surface** … never parity-tests the source"), 3084–3092, and
    fixture 4060–4068. No leakage found.
  - **The stage-3 constructed witness remains `volume-overlap`-only.** 2356–2357 (stage list header),
    2385–2393 (scoping statement plus the coincident-boxes counterexample), 2395–2405 (the explicit
    "not the same as asserting clean-false" caveat), 2497–2503 (`ContainmentModeQuery` restating it),
    2407 ("all three stages fail (`volume-overlap`) or the first two fail (`containment`)"),
    tolerances row 1583 ("`volume-overlap` only"), and fixture 4078–4085. Six sites agree.
  - **`SurfaceCrossingWitness` semantics.** 2515–2523 (construction, `crossingProbeFractions × dAvail`,
    coarsest-first), 2535–2541 (inconclusive-not-rejected), 2543–2563 (scope contrast and budgets),
    tolerances row 1584 ("`containment` only"), fixtures 4053–4085. Consistent throughout, and
    untouched by Round 30. Its **scheduling class** remains the open seam (see cross-system concern 1).
  - **Parity/closure diagnostics and role mapping.** 3613–3635 (`unverified-parity-operand` table plus
    its mode-scope paragraph), 3643–3655 (`unverified-open-component`'s "which operand does the
    component belong to" table), 3637–3641 (the explicit non-collapse of the two), fixtures 4003–4017.
    Internally consistent. The only hole in this apparatus remains `non-manifold-component`'s absence
    from it — M-Q1 and M-Q2.
  - **Mode dependency matrix.** 1321–1339 and 3009–3010 agree that `containment` and `volume-overlap`
    both need connectivity for **both** operands (1334–1339 covers the target-side parity-closure read
    explicitly), and that `surface-intersection` "never calls `anyComponentInside` at all" and is
    "genuinely connectivity-free" (1333); pinned by gate criterion 5's own mode split (4564–4567).
  - **`classifyPoint` non-circularity**: 2203–2215 (the two-layer split), restated 2578–2583. Intact.
- **Tolerance frames still compose correctly across the query layer.** `classifyPoint` is defined to
  scale by whichever BVH it is handed (1562–1567), which is what makes stage 3's use of it against the
  *source's own* BVH (2372–2373) frame-correct without a special rule, and `SurfaceCrossingWitness`'s
  `surfaceEpsilon` check against the target (2535–2536) frame-correct. `witnessLadder`'s `L_source`
  scaling (1583, 2376–2383) and `crossingProbeFractions`' per-candidate `dAvail` scaling (1584,
  2518–2533) are both consistent with their prose. No finding.
- **v7's H-Q1 provenance note is now historical.** `round-28-query-medium-low-disposition.md:149-152`
  claimed its broadening was done "without touching `containment` mode's already-correct source
  exemption", which the diff contradicted. Round 30 removed the offending clause, so the disposition
  doc's claim is now accidentally true of the current text. Recorded as provenance only.
- **The `[SILENT]` audit-vocabulary leak at 3751** ("carrying no named error class, the same
  `[SILENT]` gap those three share") still sits inside the same Error Handling section H-1's fix
  touched, one bullet above it, and was re-observed while reading 3745–3766. It belongs to System 1
  (lifecycle/error types), not to this system; noted here only because Round 30 edited the adjacent
  bullet without addressing it.

---

# Cross-system composition concerns for the synthesis pass

1. **→ System 4: `SurfaceCrossingWitness`'s tier assignment is the one query/scheduling seam v7 left
   open, and Round 30 confirmed the classification without resolving it.** From the query side
   2558–2559 is unambiguous — "Being `bvhcast`-native, this traversal **cannot** `await`, yield, or
   resume" — and 2444–2446 agrees ("**not** a third instance of this pattern — it is its own
   `bvhcast`-native traversal, non-resumable like `ProperCrossingQuery`'s"). Yet the tier it is
   assigned to is characterized by exactly the property it lacks: "It is a plain JS loop this library
   drives, so unlike the native traversals it **can genuinely be paused** rather than only aborted"
   (2058–2059). The document brackets its own verdict-determinism question at 2040–2044 rather than
   answering it. The query-side text is self-consistent; the scheduling-side membership criterion is
   not. Unchanged since v7.

2. **→ System 4: M-Q4's unstated `maxCrossingPairsExamined` scope is a budget-semantics question with
   a query-side consequence.** A call-scoped 64 would silently truncate later pairs in a multi-room
   `containment` locate query, since that mode runs one `SurfaceCrossingWitness` traversal per
   candidate pair; a traversal-scoped 64 would not. Round 30's H-5 edit widened the set of traversals
   the unscoped budget is asserted to apply to.

3. **→ System 4: M-Q5 and M-Q6 are query/scheduling seam defects introduced or activated by H-5's
   fix.** Both live in the taxonomy passage (2013–2044) but are about which traversal is which, which
   is query vocabulary. A fix to either should touch 2034–2036 and 2558–2562 together, not one alone.

4. **→ Synthesis, structural: the diagnostic contract is still specified by four separate exhaustive
   enumerations that are not kept in sync.** M-Q1 and M-Q2 have the same root cause v7 identified: the
   `PairDiagnosticReason` union (3582–3597), the `role`-requirement rule (3606–3608), the two role
   tables (3621–3628, 3647–3655), and the completeness/soundness split (3669–3686) each enumerate
   diagnostics *by name*, and `non-manifold-component` is missing from three of the four. Round 30's
   H-1 fix corrected the **mode** column of the one enumeration that had it wrong and left the other
   three untouched — which is why the H-1 contradiction is genuinely closed while M-Q1/M-Q2 are not.
   The synthesis-level recommendation stands: one table with mode / polarity / `role` columns.

5. **→ System 2 (geometry) and System 4: M-Q3 still has a build-cost dimension.** If "certified
   closed" resolves at component granularity, nothing changes for the build pipeline. If at operand
   granularity, the multi-component hollow-pipe target (1615–1618) becomes a permanently-diagnosed
   case, changing how often the extension's caveat rule (3701–3703) fires — the same noise-budget
   argument H-Q1 turned on, applied to a different diagnostic.

---

## Summary

| Severity | Count | Findings |
|---|---|---|
| Critical | 0 | — |
| High | 0 | v7's H-Q1 and H-Q2 both re-verified **closed** |
| Medium | 6 | M-Q1, M-Q3, M-Q4 (PRE-EXISTING); M-Q2 (PRE-EXISTING, R30-narrowed); M-Q5 (latent, R30-activated); M-Q6 (PRE-EXISTING, R30-aggravated) |
| Low | 7 | L-Q1 (PRE-EXISTING, R30-narrowed), L-Q2, L-Q3 (PRE-EXISTING); L-Q4, L-Q5, L-Q6, L-Q7 (NEW, R30 residuals) |

**H-1's fix is clean.** All six `non-manifold-component` occurrences are mutually consistent with
"never diagnosed for `containment`'s own source", the contradicting Error Handling clause is deleted
rather than relocated, both downstream silent sites are closed, and the exemption was independently
re-derived as sound — including for the non-manifold (not merely open) sources Round 30's new
rationale added to its scope.

**H-5's fix holds on the query side.** `SurfaceIntersectionQuery`'s definition site is internally
consistent after the added private-clock sentence — the claim follows from 1927–1930's
callback-entry rule rather than being asserted — and `SurfaceCrossingWitness` remains distinctly
classified at five untouched sites.

**Round 30 regressions flagged**: one dangling section anchor inside this system's own text (**L-Q4**,
also recorded cross-system), one activated vocabulary collision on the clock-basis axis the taxonomy
depends on (**M-Q5**), one same-paragraph falsified traversal count (**M-Q6**), and two minor residuals
of the H-1 fix (**L-Q5**, **L-Q6**). Round 30 honored its "no Medium fixes" instruction: M-Q1 and M-Q3
are untouched, M-Q4 is untouched, and M-Q2 was only narrowed as a side effect of deleting the
contradicting clause H-1 required it to delete.
