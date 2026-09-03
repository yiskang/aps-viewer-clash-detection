# Invariant Audit v7 — System 3: Query-mode semantics and dependencies

**Target**: `docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md` (4712 lines).
**Date**: 2026-09-03. **Model consumed**: `invariant-audit-v7-model.md` §3, with §4 cross-read.

## Method and evidentiary rules

Every line citation below was re-read by this pass directly against the **current** file. No prior
disposition doc (`round-18-*` … `round-29-*`, `invariant-audit-v1` … `v6*`) was used as evidence that
anything is presently fixed; prior docs and `git show` were used **only** to establish *provenance*
(when a passage entered the file) and therefore the NEW-vs-PRE-EXISTING classification.

The spec's `## Revision Notes (post-review)` section (lines 40–799) is a past-tense changelog and is
never cited here as a current invariant. All normative citations are from lines 801–4712.

One `codex-advisor` consult (`medium`, request `20260903-131905-74976-11290`) was used for the
adjudication in **H-Q1** only, per the pass's own escalation rule. Its substantive correction to this
auditor's first draft is recorded inline and was independently re-verified against the text before
being accepted (see H-Q1 §"Why the 'silent false negative' framing was withdrawn").

**Nothing in the spec was modified by this pass.**

---

# Critical

**None.** The single contradiction this pass was asked to adjudicate is rated **High**, not Critical —
see H-Q1's severity rationale. All five protected query invariants named in the audit brief were
re-verified intact in the current text (see "Protected invariants re-verified", below).

---

# High

## H-Q1 — `containment` mode's `non-manifold-component` scope is self-contradictory

**Status: NEW.** The explicit form of this contradiction was introduced by Round 28
(commit `027c567`); see "Provenance" below. A weaker, latent version pre-existed.

### The contradiction, verified in the current text

**Side A — "never diagnosed", three sites.**

- **2267–2272** (the canonical `anyComponentInside` passage). After enumerating the two rules "in
  `volume-overlap` mode" — (i) a positive whose deciding component is not a certified closed manifold
  emits `unverified-open-component` (2255–2266); (ii) "a **negative** result involving any flagged
  component emits `non-manifold-component`" (2267) — the text states at 2269–2272:

  > In **`containment`** mode neither rule applies to the source at all: that mode's contract is
  > containment, which open sources answer soundly, so an open source is not a caveat and is never
  > diagnosed.

  "Neither rule" is unambiguous: it covers rule (ii), i.e. `non-manifold-component`, not only
  `unverified-open-component`.
- **1647** (mode table): `containment` / open **source** → "fine, never diagnosed".
- **3022–3023** (Public API comment for `'containment'`): "open sources are sound here by construction
  and are never diagnosed."

**Side B — "emits", one site.**

- **3692–3696** (Error Handling & Edge Cases):

  > **Non-manifold or open components sampled by `anyComponentInside`** (the public source in
  > `containment` mode; either public operand in `volume-overlap` mode, depending on which containment
  > term is sampling it): the containment guarantee doesn't cover them (see `anyComponentInside`), so a
  > negative result involving one emits `non-manifold-component`.

**The type union does not settle it.** `unverified-open-component` carries an explicit mode scope in
its own comment — "(never emitted in 'containment' mode — see Query modes)" (3527) —
while `non-manifold-component` (3524) carries **none**. An implementer reading only the union would
conclude the omission is deliberate and side with B.

**The fixture set does not settle it either.** The unit fixture at **3895–3898**, filed under
`ContainmentQuery.anyComponentInside` (the layer *both* modes share), states with **no mode scope**:
"two solids joined along a shared edge, one inside and one outside … Whatever the sampled result, the
component must be flagged non-manifold and a negative must carry `non-manifold-component`." By
contrast the sibling fixture at **3911–3917** *is* explicitly mode-scoped for the other diagnostic
("carry `unverified-open-component` **in `volume-overlap` mode only**… asserting the **absence** of
the diagnostic in `containment` mode is what pins that the split actually happened"). The absence of
any equivalent mode-scoping sentence for `non-manifold-component` is exactly the gap.

### Provenance (why this is NEW)

`git show 027c567` shows the Round-28 edit to this bullet:

```
- **Non-manifold or open source components**: the containment guarantee doesn't cover them (see
  `anyComponentInside`), so a negative result involving one emits `non-manifold-component`.
+ **Non-manifold or open components sampled by `anyComponentInside`** (the public source in
+  `containment` mode; either public operand in `volume-overlap` mode, depending on which containment
+  term is sampling it): …
```

Round 28's own disposition (`round-28-query-medium-low-disposition.md:149-152`) states the broadening
was done "without touching `containment` mode's already-correct source exemption." The edit as written
does the opposite: it names containment's source as an emitting case. **Authorial intent was Side A;
the executed edit states Side B.** The pre-Round-28 text was mode-silent (a latent tension), not an
explicit contradiction.

### Adjudication

**Side A is the document's intended and defensible contract. The Error Handling parenthetical at
3692–3696 is the defect.**

Four independent lines of evidence converge:

1. **Weight and canonicality.** Three normative sites, including the canonical `anyComponentInside`
   passage (2269–2272), the public mode table (1647), and the Public API surface (3022–3023), against
   one Error Handling bullet.
2. **Stated authorial intent** at Round 28, contradicted only by that round's own execution.
3. **The mode split's whole purpose is noise elimination on exactly this input.** 1682–1690 measures
   the acceptance model: "every room welds to a perfect closed manifold, and the bathtub welds to 14
   open components with 441 boundary edges. `containment` answers the room-locator's question cleanly,
   with **no diagnostic** … Round 6's diagnostic would have fired on essentially every real query; the
   mode split makes that noise disappear." 2715–2721 repeats it from the data-flow side, and 3634–3636
   makes the consequence concrete: "The extension should surface a visible caveat … when
   `statistics.diagnostics` is non-empty for the queried element." Under Side B, every **negative**
   pair in a room-locate call (the element against each non-containing room — the majority of pairs in
   every call) would carry `non-manifold-component` for the bathtub source, re-creating precisely the
   per-query caveat the split was designed to eliminate. Side B is incompatible with the design's own
   measured motivating scenario.
4. **`containment`'s composition structurally covers the completeness gap that would otherwise
   justify Side B** — see immediately below.

### Why the "silent false negative" framing was withdrawn

This auditor's first reading held that Side A leaves a reachable, undiagnosed false negative, on the
doc's own shared-edge counterexample (2237–2245): source A = two boxes joined along a shared edge,
box1 strictly inside target B, box2 strictly outside; edge-connectivity merges them into one flagged
component (1750–1756); stage-1 strided sampling (2316–2320) may hit a box2 vertex first, read
`outside`, and stop.

That framing is **wrong**, and the reason is in the text. `containment` is a two-term composition
(2446–2449), and 2522–2526 states the load-bearing point explicitly: "A negative now requires *both*
composition terms to fail … the second term (`SurfaceCrossingWitness`) is what now establishes the
antecedent instead of assuming it." Case analysis of the shared edge's position relative to B's
boundary:

- **Shared edge strictly inside or strictly outside B** — then one of the two boxes' surfaces must
  transversally cross B's boundary to reach the other side, so `SurfaceCrossingWitness` (2472–2480)
  gets a non-coplanar intersection segment and an in-plane probe classifying `inside` the target →
  the composed result is **true**. No false negative.
- **Shared edge lying on B's boundary** — box1's triangles incident to that edge intersect B's surface
  non-coplanarly along it; `M` is that segment's midpoint and the in-plane direction `u` pointing into
  box1's own triangle interior yields `P` inside B → witness holds → **true**.
- **Witness unproducible or budget-aborted** — 2492–2498 and 2515–2519 both route this to a
  *diagnosed* negative (`inconclusive-crossing` / `crossing-budget-exhausted`), never a clean one.

So Side A does not create a silent boolean error. `SurfaceCrossingWitness` "is not optional"
(2462–2470) precisely because it closes vertex-sampling's blind spots, and it closes this one too.

Residual uncertainty, recorded rather than asserted: the edge-on case relies on
`ExtendedTriangle.intersectsTriangle` returning a usable segment for a non-coplanar intersection that
coincides with a triangle edge. The spec verifies upstream behavior only for the **coplanar** branch
(1826–1828). If that assumption fails, it is a separate upstream-assumption defect, not an argument
for Side B.

### Severity: High (Critical considered and rejected)

Rejected Critical because no boolean-correctness failure is demonstrated on either branch — the
public `containment` verdict is protected by the second composition term regardless of which
diagnostic scope is adopted. High because: it is a hard contradiction (not an ambiguity) in a
**publicly observable** result field (`statistics.diagnostics`); it is untestable-as-written, since
the doc's own fixtures point both ways (3895–3898 mode-silent vs 3911–3917 mode-scoped); and it
directly governs whether the room-locator extension raises a user-visible caveat on every query
(3634–3636).

### What a fix would have to touch (recorded for the fix pass; not applied here)

3692–3696's parenthetical, **and** the mode-scope status of fixture 3895–3898, **and**
`non-manifold-component`'s union comment at 3524 (which should carry the same "(never emitted in
'containment' mode)" annotation 3527 already carries) — otherwise the contradiction simply relocates.

---

## H-Q2 — `SurfaceIntersectionQuery`'s `bvhcast` traversal is absent from the entire scheduling taxonomy

**Status: PRE-EXISTING** and untouched by Round 28 (query pass) or Round 29 (budget/scheduling pass).
**Owner: System 4 (sync-work/budget/scheduling).** Recorded here because the query side is what
establishes that the traversal exists.

### The query-side facts (confirmed)

`SurfaceIntersectionQuery` genuinely runs a `bvhcast` traversal:

- **1764–1773**: it is built on `bvhcast`, **not** `MeshBVH.intersectsGeometry`, specifically because
  the latter "accepts no budget, exposes no per-candidate callback, and offers no abort hook" and was
  "the last unbounded synchronous path in the design."
- **1775–1779**: it is "the *same* `bvhcast` traversal `ProperCrossingQuery` uses, using the same
  `maxCandidatePairsExamined` ceiling, with a fresh traversal-local `candidatePairsExamined` counter
  for each traversal, the same per-candidate `intersectsTriangle` test, and **the same abort
  protocol**".
- **1782–1783**: "`crossing-budget-exhausted` means the same thing in both."
- **2949**: it is dispatched per candidate pair from the narrow phase alongside `VolumeOverlapQuery`
  and `ContainmentModeQuery`.
- **3807–3813** (fixture): it "must abort with `crossing-budget-exhausted` **and complete within a
  wall-clock bound**", sharing the input with `ProperCrossingQuery`'s budget fixture — "it fails the
  moment they stop sharing a traversal."
- **4003** counts it implicitly: "`ContainmentModeQuery`'s second composition term added a **third**
  traversal to the design."

### The gap

It is named **nowhere** in the scheduling apparatus:

- not in the abort-only tier (1996–2018), which names only `ProperCrossingQuery`'s traversal and then
  explicitly excludes `SurfaceCrossingWitness` as "a **second** `bvhcast`-native traversal … not a
  second instance of this exception" (2008–2013) — a count that silently omits this one;
- not in the worst-case-span formula's per-tier addends (2084–2093);
- not in "what the formula *does* bound" (2127–2132);
- not in the clock-basis reconciliation (2150–2154), which names only the yield-and-resume mechanism,
  `SurfaceCrossingWitness`, and `ProperCrossingQuery`.

### Why this is High rather than a documentation nit

The doc makes a **uniqueness** claim about clock basis, twice, in normative text: "this is **the one**
documented, deliberate exception to the shared-accumulator convention every other checkpoint in this
design follows" (2001–2003) and "`ProperCrossingQuery`'s `bvhcast` abort-and-diagnose check is **the
one** documented exception, reading a private, traversal-local clock" (2151–2154). Combined with
1778's "the same abort protocol", the two readings are:

- **If `SurfaceIntersectionQuery` inherits the private, traversal-local clock** (1869–1884, which is
  part of the abort protocol it is said to share), then 2001–2003 and 2151–2154 are **false as
  written** — there are two such exceptions, not one.
- **If it instead reads the shared accumulator**, then it falls under the unresolved
  verdict-determinism question the doc itself brackets at 2014–2018 ("a permanent, result-altering
  `bvhcast` abort" whose verdict becomes a function of scheduling position), for a **public mode**,
  with nothing recorded about it anywhere.

Either branch falsifies or under-determines a normative claim. Note the substantive risk is small:
`SurfaceIntersectionQuery` has no probe ladder ("no interior classification", 1779–1781), so its only
possible check point is callback entry, where per-candidate cost is measured at ~0.3µs and the doc
already calls entry-granularity "adequate there" (1911–1913). The defect is the taxonomy's
completeness and the falsified uniqueness claim, not an unbounded span.

**Also unstated**: whether `SurfaceIntersectionQuery`'s traversal carries the time-based trigger at
all. 1863–1867 is the passage headed "Abort protocol" and covers only the two **count**-based
triggers; the time trigger is introduced separately at 1869 as "A third, time-based trigger". "The
same abort protocol" (1778) is therefore itself ambiguous about whether the third trigger is
inherited. Fixture 3807–3809's "complete within a wall-clock bound" is satisfiable by the count budget
alone (50,000 × ~0.3µs ≈ 15ms), so it does not disambiguate.

---

# Medium

## M-Q1 — `non-manifold-component` is absent from *both* halves of the completeness/soundness reconciliation

**PRE-EXISTING.** 3602–3619 presents itself as *the* reconciliation of which diagnostics attach to
which result polarity ("This is the reconciliation: *completeness* diagnostics are negative-only;
*soundness* diagnostics apply in both directions", 3617–3619). It enumerates completeness diagnostics
exhaustively at 3604–3606 (`incomplete-component-coverage`, `inconclusive-containment`,
`inconclusive-crossing`, `crossing-budget-exhausted`) and soundness diagnostics exhaustively at
3606–3615 ("there are exactly **two** such cases" — `unverified-parity-operand`,
`unverified-open-component`). `non-manifold-component` appears in neither list, so the section that
claims to settle polarity for every diagnostic never says whether `non-manifold-component` can attach
to a positive. Its own union comment (3524) says "**NEGATIVE** result involving a component the
guarantee misses", which would place it in the completeness list — the omission looks like an
oversight rather than a deliberate exclusion.

## M-Q2 — `non-manifold-component`'s `role` field is unspecified, and Round 28 made it operand-specific without adding a rule

**PRE-EXISTING, aggravated by Round 28.** 3539–3541 states the `role` rule by exhaustive enumeration:
"`role` is required for reasons that indict one operand — `'unverified-parity-operand'` and
`'unverified-open-component'` — and absent for reasons about the pair as a whole (budget exhaustion,
coverage truncation, inconclusive results)." `non-manifold-component` is in **neither** enumeration.
Round 28's broadening at 3693–3694 makes it explicitly operand-specific in `volume-overlap` ("either
public operand … depending on which containment term is sampling it"), which is exactly the shape
`role` exists to express — yet no `role` rule was added, and neither role table (3554–3559,
3580–3584) covers it. An implementer cannot tell whether `{scope:'pair', reason:
'non-manifold-component'}` carries `role`. This interacts with H-Q1: if H-Q1 resolves to Side A, the
missing rule is `volume-overlap`-only; if to Side B, a containment-mode `role:'source'` emission would
sit awkwardly against 3567–3568's "a `containment` result — positive or negative — can indict
`target` only."

## M-Q3 — "certified closed manifold" is asserted at operand granularity but read at component granularity, with no aggregation rule

**PRE-EXISTING.** The parity closure precondition is stated per **operand**: "**every operand that
parity is evaluated against must be a certified closed manifold**" (2283), and parity itself is
defined over the target's *entire triangle set* (1602, 2213–2215). But the flag actually consulted is
per **component**: "this parity check reads its cached manifold classification" (2291–2293) off
`GeometryConnectivity`, which classifies *components* — "a component is **manifold** if every one of
its edges is shared by exactly two triangles" (1752–1756). The text never states how a
multi-component operand aggregates to "certified closed."

This is not hypothetical: the doc's own headline justification for even-odd parity is the **hollow
pipe**, "an outer cylinder plus an inner cylinder" (1606–1610), which after welding is **two** closed
manifold components. Under an "operand is a single closed manifold component" reading, every pipe
target spuriously emits `unverified-parity-operand`; under an "every component is closed manifold"
reading, it does not. The acceptance-model measurement is stated only for the single-component case —
"every room welds to a perfect closed manifold (**1 component**, 0 boundary edges, 0 non-manifold
edges)" (2298–2299) — so nothing in the spec exercises the multi-component target it explicitly
designed for. MEP models are named as the target domain (1609), which makes this the likely-common
case.

## M-Q4 — `maxCrossingPairsExamined`'s scope is unstated in both traversals that use it

**PRE-EXISTING.** `candidatePairsExamined` is explicitly traversal-local in both places it appears —
"a **fresh traversal-local** `candidatePairsExamined` counter for each traversal" (1776–1777) and "a
**traversal-local** `candidatePairsExamined` counter" (2508–2509). `maxCrossingPairsExamined = 64`
gets no such qualifier at either site: 1852–1853 introduces it as counting "confirmed intersecting
non-coplanar pairs" with no scope, and 2510–2511 says only that a confirmed pair "also consumes
`maxCrossingPairsExamined = 64`". Whether the 64 budget is per traversal, per candidate pair, or per
`findClashes` call is undetermined. In `containment` mode the ambiguity compounds: the mode runs one
`SurfaceCrossingWitness` traversal per candidate pair, so a call-scoped 64 would silently truncate
later pairs in a multi-room locate query, while a traversal-scoped 64 would not.

---

# Low

## L-Q1 — `crossing-budget-exhausted`'s definition does not fit `surface-intersection` mode

**PRE-EXISTING.** 1782–1783 asserts "`crossing-budget-exhausted` means the same thing in both" modes.
But its union comment (3522–3523) defines its trigger set as "candidate-count, **crossing-count**, or
elapsed-time ceiling hit", and `surface-intersection` has no crossing concept at all: it "needs
neither the coplanar split … nor the probe ladder (no interior classification …)" (1779–1781), so
`maxCrossingPairsExamined` cannot fire for it, and per H-Q2 the elapsed-time trigger's applicability is
itself unstated. Only one of the three enumerated triggers demonstrably applies. The diagnostic name
also reads oddly for a mode whose vocabulary is "touching", not "crossing".

## L-Q2 — the mode table's open-operand columns read as blanket "never diagnosed"

**PRE-EXISTING.** 1646's `surface-intersection` row reads "fine, never diagnosed" for both operands,
and 1647's `containment` row reads the same for the source. Read literally against the column headers,
these are claims about the *parity/closure* diagnostics only — but the mode can still emit
`crossing-budget-exhausted` (3807–3809) and `geometry-too-large-for-sync-build` (2938–2944). The
fixture at 3814–3815 ("an open source and an open target — intersects, with **no diagnostic**") pins
the narrow reading, so this is a table-header scoping imprecision rather than a substantive conflict.
It nonetheless supplies part of the surface area H-Q1 turns on: 1647's cell is one of the three Side-A
sites, and its scope-imprecision is why an implementer might discount it.

## L-Q3 — "the second term establishes the antecedent" overclaims for the aborted second term

**PRE-EXISTING.** 2522–2526 says a `containment` negative "requires *both* composition terms to fail,
which strictly **strengthens** `anyComponentInside`'s guarantee … the second term
(`SurfaceCrossingWitness`) is what now **establishes** the antecedent instead of assuming it." That
holds for a *clean* second-term negative. It does not hold when the second term fails by budget abort
(2515–2519 → `crossing-budget-exhausted`) or by unproducible probe (2492–2498 →
`inconclusive-crossing`): those establish nothing about whether a proper crossing exists. The
composed result is correctly *diagnosed* in both cases, so no unsound answer escapes — but the prose's
unqualified "establishes" is stronger than the algorithm supports, and 2224–2231's containment
guarantee is written as if predicated on it.

---

# Historical-only / non-defect observations

- **Protected invariants re-verified intact.** Each was independently re-read this pass:
  - The three canonical mode contracts: `SurfaceIntersectionQuery` (1758–1783), `ContainmentModeQuery`
    (2443–2540), `VolumeOverlapQuery` (2405–2441). All three compositions are internally consistent
    and consistent with the mode table (1644–1648) and the Public API comment (3008–3028).
  - **Containment remains source-surface-only.** 1650–1666 (the directedness derivation), 1677–1680
    ("The source is *sampled* for points; it is never parity-tested"), 2451–2452 ("One direction
    only"), 2503–2506 ("stays **on the source surface** … never parity-tests the source"), 3018–3021,
    and fixture 3988–3996. No leakage found.
  - **The stage-3 constructed witness remains `volume-overlap`-only.** 2313–2314 (the stage list's own
    header), 2342–2350 (the scoping statement plus its coincident-boxes counterexample), 2352–2362
    (the explicit "not the same as asserting clean-false" caveat), 2454–2460 (`ContainmentModeQuery`
    restating it), 2364 ("all three stages fail (`volume-overlap`) or the first two fail
    (`containment`)"), the tolerances table's `witnessLadder` row annotated "`volume-overlap` only"
    (1574), and fixture 4006–4013. Five independent sites agree; no leakage into `containment` or
    `surface-intersection`.
  - **`SurfaceCrossingWitness` semantics.** 2472–2498 (construction, `crossingProbeFractions ×
    dAvail`, coarsest-first, inconclusive-not-rejected), 2500–2520 (scope contrast and budgets),
    1575 (tolerances row, annotated "`containment` only"), fixtures 4001–4025. Consistent throughout.
    Its **scheduling class** is a separate matter — see cross-system concern 1.
  - **Parity/closure diagnostics and role mapping.** 3546–3568 (`unverified-parity-operand` table plus
    its mode-scope paragraph), 3576–3588 (`unverified-open-component`'s "which operand does the
    component belong to" table), 3570–3574 (the explicit non-collapse of the two), fixtures 3931–3945.
    Internally consistent. The **only** hole in this apparatus is `non-manifold-component`'s absence
    from all of it — see M-Q1, M-Q2, and H-Q1.
  - **Mode dependency matrix** (connectivity gate): 1326–1339 and 2946 agree that `containment` and
    `volume-overlap` both need connectivity for **both** operands, and that `surface-intersection`
    "never calls `anyComponentInside` at all" and is "genuinely connectivity-free" (1332–1333);
    pinned by fixtures 4062–4064 and 4080–4085.
  - **`classifyPoint` non-circularity**: 2160–2172 (the two-layer split, "the primitive has no such
    precondition, and only the wrapper does"), restated at 2535–2540. Intact.
- **Tolerance frames compose correctly across the query layer.** `classifyPoint` is defined to scale
  by whichever BVH it is handed (1553–1558), which is what makes stage 3's use of it against the
  *source's own* BVH (2329) frame-correct without a special rule, and what makes
  `SurfaceCrossingWitness`'s `surfaceEpsilon` check against the target (2492–2493) frame-correct.
  `witnessLadder`'s `L_source` scaling (1574, 2333–2340) and `crossingProbeFractions`' per-candidate
  `dAvail` scaling (1575, 2482–2490) are both consistent with their prose. No finding.
- **Round 28's disposition doc is inaccurate about its own edit.** `round-28-query-medium-low-disposition.md:149-152`
  claims the Error Handling broadening was done "without touching `containment` mode's already-correct
  source exemption." The diff (`027c567`) shows otherwise. Recorded as provenance for H-Q1, not as a
  spec defect.
- **The `[SILENT]` audit-vocabulary leak at 3684** ("carrying no named error class, the same
  `[SILENT]` gap those three share") sits inside the same Error Handling section as H-Q1's Side B and
  was noticed while reading it. It belongs to System 1 (lifecycle/error types), not to this system.

---

# Cross-system composition concerns for the synthesis pass

1. **→ System 4 (sync-work/budget/scheduling): H-Q2 is yours.** The query side establishes that
   `SurfaceIntersectionQuery` runs a real, budgeted, abort-capable `bvhcast` traversal (1764–1783,
   2949, 3807–3813) that appears in none of the four scheduling passages (1996–2018, 2084–2093,
   2127–2132, 2150–2154). Please decide the clock basis, and note that whichever branch is chosen, the
   "one documented exception" uniqueness claims at 2001–2003 and 2151–2154 need re-checking. Related:
   M-Q4's unstated `maxCrossingPairsExamined` scope is a budget-semantics question with a query-side
   consequence (multi-room `containment` truncation).

2. **→ System 4, seam: `SurfaceCrossingWitness`'s tier assignment.** From the query side, 2515 is
   unambiguous — "Being `bvhcast`-native, this traversal **cannot** `await`, yield, or resume" — and
   2401–2403 agrees ("non-resumable like `ProperCrossingQuery`'s"). Yet the tier it is assigned to
   (cooperative-composition, 2008–2014) is characterized elsewhere by exactly the property it lacks:
   "It is a plain JS loop this library drives, so unlike the native traversals it **can genuinely be
   paused** rather than only aborted" (2032–2033), and "genuinely yield-and-resume in plain JS loops
   that can" (2155–2158). The doc's reconciliation tiers on *overshoot granularity* and *clock basis*
   instead of pausability, but never states those as separable membership criteria. This is a
   query/scheduling seam; the query-side text is self-consistent, the scheduling-side text is not.

3. **→ System 1 (lifecycle): the abort-only sites' two-part revalidation.** From this system's side,
   the three `bvhcast`-native abort points describe **only** time/count triggers and the `aborted`
   flag — `ProperCrossingQuery` at 1908–1920, `SurfaceCrossingWitness` at 2515–2520, and
   `SurfaceIntersectionQuery` nowhere at all. None is said to check `disposed`/epoch. Yet 2034–2035
   asserts "**Every checkpoint named in this document** — the build-phase checkpoints and the
   `bvhcast`-entry checkpoints included — is this same mechanism", and 2039–2041 asserts the two-part
   revalidation "is never itself skipped". Whether a synchronous native callback can perform or act on
   that check is unstated. Query-side note: by contrast, `anyComponentInside`'s plain-JS loops **are**
   explicitly covered (2383–2387, 2398–2401) and fixture-pinned (3959–3965), so the asymmetry is
   confined to the native traversals.

4. **→ Synthesis, structural: the diagnostic contract is specified by four separate exhaustive
   enumerations that are not kept in sync.** H-Q1, M-Q1, and M-Q2 all have the same root cause. The
   `PairDiagnosticReason` union (3516–3530), the `role`-requirement rule (3539–3541), the two role
   tables (3554–3559, 3580–3584), and the completeness/soundness split (3602–3619) each enumerate
   diagnostics *by name*, and `non-manifold-component` is missing from three of the four. Any fix to
   H-Q1 that touches only 3692–3696 will leave the contradiction re-derivable from the union comment's
   asymmetry at 3524 vs 3527. A synthesis-level recommendation: treat the diagnostic contract as one
   table with mode / polarity / `role` columns, so a new or rescoped diagnostic cannot be added to one
   enumeration and omitted from three.

5. **→ System 2 (geometry) and System 4: M-Q3 has a build-cost dimension.** If "certified closed" is
   resolved at component granularity, nothing changes for the build pipeline. If it is resolved at
   operand granularity, the multi-component hollow-pipe target (1606–1610) becomes a
   permanently-diagnosed case, which changes what fraction of real MEP queries carry
   `unverified-parity-operand` and therefore how often the extension's caveat rule (3634–3636) fires —
   the same noise-budget argument H-Q1 turns on, applied to a different diagnostic.

---

## Summary

| Severity | Count | Findings |
|---|---|---|
| Critical | 0 | — |
| High | 2 | H-Q1 (NEW, R28), H-Q2 (PRE-EXISTING) |
| Medium | 4 | M-Q1, M-Q3, M-Q4 (PRE-EXISTING); M-Q2 (PRE-EXISTING, R28-aggravated) |
| Low | 3 | L-Q1, L-Q2, L-Q3 (all PRE-EXISTING) |

All five protected query invariants named in the audit brief were re-verified intact. The one
confirmed contradiction is adjudicated in favour of **Side A** (`containment` never diagnoses its own
source), with the Error Handling parenthetical at 3692–3696 identified as the defect and its
provenance traced to commit `027c567`.
