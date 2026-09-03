# Round 29 — Medium/Low pass: close the budget/scheduling ("synchronous-work") cluster from `invariant-audit-v6-syncwork.md`

Scope: **all remaining budget/scheduling Medium and Low findings** from `invariant-audit-v6-syncwork.md`,
plus two items `round-28-query-medium-low-disposition.md` explicitly deferred to this cluster (M-Q5, and
the `volume-overlap`/`anyComponentInside` "stage" vocabulary overlap). `H6-B1`, `H6-B2`, `H6-B3` (this
system's three Highs) were explicitly out of this pass's stated scope — verified, not touched, see below.
No lifecycle findings closed in Round 26, geometry-pipeline findings closed in Round 27, cache/concurrency
findings closed in Round 25, or query-semantics findings closed in Round 28 were touched. No normal Codex
*review* was run, per instruction; this pass used `codex-advisor` (medium) once, on its three hardest
judgment calls (the unexplained `~2×frameBudgetMs` factor, the rounding direction of the 24.8ms threshold,
and the "stage" vocabulary disambiguation), followed by one independent adversarial re-audit subagent
(opus, no access to this pass's editing session) after editing.

**Following the doc's own convention (see the Status paragraph near the top): this pass does not add its
own `### Round 29` changelog entry to the main Revision Notes section.** Rounds 24–28 established that
later Medium/Low cleanup passes are recorded only in their own standalone disposition document, not as a
new numbered changelog entry in the spec body itself.

---

## A key discovery this pass made: the three Highs were already closed, pre-pass

`invariant-audit-v6-syncwork.md` audited **the uncommitted Round-22 working tree**, before its own final
edits were committed (`eace98a`). Per the same pattern Round 28 discovered independently for the
query-semantics audit (`invariant-audit-v6-query.md`, audited from the identical uncommitted tree), the
*final* committed text already resolves this audit's own Highs — the audit prose was written against an
intermediate draft, not against what actually landed in `eace98a`. Re-verified directly against the live
text before touching anything:

- **H6-B1** ("only one non-preemptible unit per span" / "the three phases never compound with each
  other") — **2 of the audit's 3 sites already resolved pre-pass; the third was not, and this pass's own
  initial read missed it (caught by the adversarial re-audit — see the Fix loop section below).** The live
  `ThreeMeshBvhBackend`/`BlasCache` passage explicitly self-corrects: *"This corrects an earlier draft of
  this passage, which claimed the three phases 'never compound with each other in one span' — false at the
  doc's own measured figures. At those figures, welding (~16.8ms) alone already exceeds `frameBudgetMs`...
  But after that yield, connectivity's own smaller measured cost (~6.9ms) does not carry the same
  guarantee... connectivity and the BVH build can share one span"* — the exact repair the audit's H6-B1
  finding recommended, already landed pre-pass. The worst-case-span formula's own prose states the general
  prefix-sum argument too, also already landed pre-pass. But the audit's own second H6-B1 quote — the
  atomic-operations-and-composition section's "so no phase ever compounds with another build phase in the
  same span" — was still live and unretracted at the start of this pass; fixed in the fix loop below.
- **H6-B2** (≈24ms computed as a max over 3 of 4 tier members, silently dropping `enumNodeChildren`) —
  **already resolved.** The live formula explicitly carries the fourth member: *"Of this tier's four
  members, three are measured... The fourth member, one `enumNodeChildren` call at the `maxChildrenPerNode`
  ceiling, is not one of the three measured costs this ≈24ms is computed from... but ≈24ms is provisional
  for it specifically until the performance gate measures it (gate criterion 7, below): if that
  measurement exceeds ~16.8ms, this tier's addend... must be revised upward to match."* Gate criterion 1
  carries the matching carve-out. Neither silently drops the fourth member nor makes it a hard gate
  failure — both defects the audit found.
- **H6-B3** (`SurfaceCrossingWitness` assigned two contradictory clock bases) — **already resolved.** The
  live abort-only-tier bullet states: *"`SurfaceCrossingWitness` is a second `bvhcast`-native traversal...
  but is not a second instance of this exception: its own passage states its time-based abort checks the
  shared elapsed-time accumulator, at callback entry and before every probe — not a private clock. At that
  fine, per-probe granularity it belongs to the cooperative-composition tier below."* This matches
  `SurfaceCrossingWitness`'s own passage exactly (no contradiction), and matches
  `round-28-query-medium-low-disposition.md`'s independent finding that this same contradiction (audited
  as `H-Q1` by the query-semantics auditor) was "already resolved in the live text by an earlier commit."

**M6-B1** (the private-clock self-bound's justification being circular: "sits within, not beyond" a figure
partly derived from itself) is the same passage `round-28-query-medium-low-disposition.md` closed as its
own `M-Q1` — confirmed already fixed, re-verified against the live text, not touched again this pass.

None of the above required an edit. This pass's actual scope was therefore narrower than the audit
document's own headline Medium/Low count once already-resolved items were excluded.

---

## Findings fixed this pass

### M6-B2 — stale "~60× the gate's own ~16ms criterion" comparison

The `maxBroadPhaseInstancePairs` atomic-operations table row still compared its ~1,000ms unchunked-scan
cost against the gate's pre-Round-22 ~16ms tolerance figure. Fixed by updating the comparison to the
current ≈24ms bound (~1,000ms / ≈24ms ≈ 40×, not 60×) with an explicit note that Round 18's own comparison
used the document's then-current figure and that the conclusion (chunking was necessary) is unchanged
either way.

### M6-B3 — weld measurement mis-attributed to the sync-triangle ceiling

The worst-case-span formula's own derivation said welding was "measured at ~16.8ms... at the sync-triangle
ceiling," but the atomic-operations table's own welding row measured it at ~19,800 triangles, not the
`12_000` ceiling. Fixed by stating the actual measurement point and noting the conservative direction
(scaled to the ceiling, the true cost is smaller, ~10.2ms) — the ≈24ms bound over-estimates, it does not
understate.

### M6-B4 — unexplained "~2×frameBudgetMs" factor for `ProperCrossingQuery`'s private clock

No derivation in the document reproduced why the private clock's own worst case was ~2×`frameBudgetMs`
rather than `frameBudgetMs` + one probe's own cost (the check fires before every probe, per the round-11
fix, so overshoot should be bounded the same way every other cooperatively-checkpointed primitive's
overshoot is). Consulted `codex-advisor` (medium): confirmed no legitimate derivation reproduces the
factor of two for the *traversal's own duration* — a factor near two only appears at the *composed-span*
level (this formula's own outer `frameBudgetMs` prefix, plus the traversal's own `frameBudgetMs` + one
probe bound), which the original text conflated with the traversal's own bound. Fixed at all three sites
that stated the figure (`ProperCrossingQuery`'s clock-basis passage, the abort-only-ceiling bullet, and the
worst-case-span formula's abort-only-tier addend), each now stating `frameBudgetMs` + one probe's own cost
as the traversal's own bound, and re-deriving the composed span as `frameBudgetMs` + (`frameBudgetMs` + one
probe) ≈ 2×`frameBudgetMs` ≈ ~16ms — comfortably under, not equal to, the controlling ≈24ms/24.8ms figure.
**The headline ≈24ms/24.8ms bound is unchanged**: weld (~16.8ms) was already the controlling term before
this fix, and remains so (now by a wider, more defensible margin than the previous ~16.8ms-vs-~16ms
comparison). Annotated one historical Round-22 changelog reference to the old figure per the doc's
established superseded-annotation convention.

### M6-B5 — "Both mechanisms key off the same constant and the same clock" overclaim

Literally false given H6-B3's resolution: `ProperCrossingQuery`'s abort-and-diagnose mechanism reads a
private clock, while `SurfaceCrossingWitness`'s abort-and-diagnose mechanism and every yield-and-resume
checkpoint read the shared accumulator. Fixed by splitting the claim: same constant (`frameBudgetMs`) for
both, same clock only for the shared-accumulator readers, with `ProperCrossingQuery`'s traversal named as
the one documented exception.

### L6-B1 — unannotated stale Round-21 changelog reference to the "~16ms tolerance band"

Annotated per the document's own superseded-annotation convention (matching the pattern already used for
comparable stale changelog claims elsewhere), pointing to the worst-case-span formula for the current
≈24ms figure.

### L6-B3 — "~24ms" vs "≈24ms" symbol inconsistency

Resolved as a side effect of the M6-B4 fix: the one site using the bolded "~24ms" variant was the
abort-only tier's composed-span figure, which the M6-B4 fix re-derives to ~16ms (a genuinely different,
smaller number for this tier specifically, not the same ≈24ms figure) — the inconsistent bolded symbol no
longer applies to the same quantity, so the vocabulary clash is gone rather than merely renamed.

### L6-B4 — gate not explicitly naming `SurfaceCrossingWitness`'s own probe or extraction's per-sibling-node span

Both spans were already covered in principle by gate criterion 1's generic "any synchronous task" wording,
but unlike criteria 7 (`enumNodeChildren`) and its neighbors, neither had its own explicit named
measurement target. Fixed by naming `SurfaceCrossingWitness`'s own in-triangle probe alongside
`classifyPoint`/crossing-probe in the existing per-primitive-cost criterion, and by adding an explicit
"record the extraction walk's longest inter-sibling-checkpoint span" clause to the extraction/broad-phase
measurement criterion, mirroring the broad-phase scan's own longest-inter-yield-span requirement.

### L6-B6 — 24.8ms rounded down to a literal "≈24ms" pass/fail threshold

The formula's own arithmetic (`8 + 16.8 = 24.8ms`) was published everywhere, including the gate's pass/fail
criterion, as "≈24ms" — under a literal reading of "a measurement above it is a gate failure," a measured
24.5ms span (inside the true bound) would misread as a violation. Per `codex-advisor`'s recommendation,
fixed by stating the literal `24.8ms` figure specifically at the gate's own enforceable pass/fail
criterion (and at the formula's own worked-example derivation), while leaving the informal "≈24ms"
shorthand everywhere else in the document — prose that isn't itself an enforcement point — unchanged.

### M-Q5 — `crossing-budget-exhausted` type comment omitted the time-based trigger

Deferred to this cluster by `round-28-query-medium-low-disposition.md`, with a ready-to-use fix text
already on record. Applied verbatim: `// candidate-count, crossing-count, or elapsed-time ceiling hit;
traversal aborted`, replacing the comment that named only the two count-based ceilings.

### Deferred Round-28 item — `volume-overlap`/`anyComponentInside` "stage" vocabulary overlap

`CollisionWorld`'s per-pair scheduling prose uses "stage" for one of a `volume-overlap` pair's up to three
composed sub-queries (`ProperCrossingQuery`, then both `ContainmentQuery` directions); `anyComponentInside`
separately uses its own internally-numbered "stage 1/2/3" for a smaller-granularity concept nested inside
one of those sub-queries. Consulted `codex-advisor` on whether this warrants the full ~15-20-site rename a
literal fix would require, or a narrower disambiguation: recommended the narrower fix, since (a) the two
concepts are never composed with or cross-referenced against each other anywhere in the document, (b) no
contract, fixture, or ceiling depends on distinguishing them, and (c) a full rename across Data Flow,
Testing & Verification, and the atomic-operations/gate prose carries real mechanical-error risk for a
purely cosmetic ambiguity. Fixed by adding one disambiguating clause at the single site that first defines
`CollisionWorld`'s per-pair "stage" composition (the Data Flow passage under the `frameBudgetMs`
cross-pair/cross-stage yielding discussion), naming this as a distinct, coarser-grained concept from
`anyComponentInside`'s own numbering and cross-referencing `anyComponentInside` directly. The Round-9
changelog bullet using the same vocabulary (historical narration) was left untouched, per the document's
no-rewriting-history convention, matching Round 28's own treatment of it.

---

## What was deliberately not touched

- `H6-B1`, `H6-B2`, `H6-B3` — already resolved in the live text by an earlier commit (Round 22's own final
  commit, not audited by `invariant-audit-v6-syncwork.md` since that audit ran against the pre-commit
  working tree); re-verified against the live text, byte-identical, not this pass's own fix.
- `M6-B1` — already closed by Round 28's `M-Q1` fix (same passage); re-verified, not touched again.
- The two accepted, ceiling-less non-preemptible atomic risks (one `enumNodeFragments` call,
  `releaseEpochScopedState`/`dispose()`'s per-epoch sweep) — untouched; both remain explicitly unbounded,
  as this pass's instructions required.
- No new ceiling was introduced anywhere. `maxSyncTriangleCount`, `maxChildrenPerNode`,
  `maxBroadPhaseInstancePairs`, `maxFragmentsPerDbId`, and `maxCollisionInstancesPerEpoch` all keep their
  existing provisional values and enforcement mechanisms, unchanged.
- `SurfaceCrossingWitness`'s classification into the cooperative-composition tier (shared accumulator) and
  `ProperCrossingQuery`'s classification into the abort-only tier (private clock) — unchanged; the M6-B5
  fix only corrected a claim describing this classification, not the classification itself.
- `GeometryRecord` build/cancellation ownership, cache admission ordering, and every lifecycle, geometry,
  and query-semantics invariant closed in Rounds 25–28 — no hunk in this pass's diff touches eviction,
  epochs, disposal, `GeometryRegistry` mutation, `buildState`, cache keying, connectivity/containment
  contracts, or diagnostic-mapping rules.
- The `volume-overlap`/`anyComponentInside` "stage" vocabulary's Round-9 changelog instance — historical
  narration, preserved per the document's own convention (matching Round 28's treatment of the identical
  question for the query-semantics side of this vocabulary).
- A full rename of `CollisionWorld`'s "stage" vocabulary — deliberately not done; see above.

---

## Verification performed

1. **Re-verification against current spec before editing.** Every finding in `invariant-audit-v6-syncwork.md`
   was relocated and re-read against the live ~4680-line file (not the audit's stale ~4431-line citations —
   the file grew across Rounds 23–28 in addition to whatever drift happened before the audit was even
   written) before any edit. This is what surfaced that H6-B1/B2/B3/M6-B1 were already resolved.
2. **`codex-advisor` (medium)**, consulted once, on the pass's three hardest judgment calls: the
   `~2×frameBudgetMs` derivation (M6-B4), the 24.8ms rounding-direction fix (L6-B6), and the "stage"
   vocabulary disambiguation scope decision. All three recommendations were accepted and applied as
   described above.
3. **`node spike/fixtures.mjs`: 55 passed, 0 failed**, after the full edit pass. (As in every prior round:
   this spike covers only geometry classification — `classifyPoint`, connectivity, containment,
   volume-overlap, surface-intersection, and the `bvhcast` abort protocol — and has no lifecycle/cache
   machinery; a regression sanity check, not a direct test of this pass's prose changes, though its
   abort-protocol fixtures do exercise the `crossing-budget-exhausted` path the M-Q5 comment describes.)
4. **Independent adversarial re-audit**, dispatched as a fresh subagent (opus, no access to this editing
   session), instructed to independently re-verify the H6-B1/B2/B3/M6-B1 already-resolved claim from
   scratch, check all ten fix sites for correctness (with special attention to the M6-B4 arithmetic and
   cross-reference integrity), confirm every stabilized invariant is unchanged, confirm no out-of-scope
   territory was touched, and re-check the full audit document's Medium/Low list for anything missed.

## Fix loop (one round, applied after the adversarial re-audit)

The re-audit confirmed all ten fixes' substance and confirmed no stabilized invariant changed, but found
one real semantic gap this pass's own "H6-B1 already resolved" claim had missed, one incompletely-applied
L6-B1/L6-B2 annotation, and a handful of self-inflicted defects in this pass's own new text (four
cross-reference direction errors, one new parse ambiguity, one stale conjunct, minor line-wrap damage). All
were fixed in one round:

- **H6-B1 was only 2 of its 3 sites actually resolved pre-pass.** The `ThreeMeshBvhBackend`/`BlasCache`
  passage and the worst-case-span formula's own prefix-sum argument were both already correct, but the
  atomic-operations-and-composition section (under `ProperCrossingQuery`'s budgets) still carried the
  unretracted conclusion "so no phase ever compounds with another build phase in the same span" —
  verbatim the second quote the audit's H6-B1 finding named — directly contradicting the two already-fixed
  passages. This is a genuine finding this pass's own pre-edit read missed (the parenthetical "**Round 22
  correction:**" immediately following it withdrew the guaranteed-yield *premise* but never withdrew this
  *conclusion*). Fixed by retracting the clause explicitly, with the same connectivity/BVH ~22.9ms
  counterexample the other two sites already cite.
- **L6-B1's second site.** The finding named two stale unannotated changelog references to a superseded
  gate figure; this pass's first draft annotated only one (the Round-21 entry). Annotated the second
  (Round 18's "~60× the gate's ~16ms criterion" changelog bullet) per the same convention.
- **L6-B2's second half.** A residual "the tolerance criterion above" cross-reference (inside the
  broad-phase gate criterion, referring to criterion 1) survived this pass's own L6-B4 edit to that same
  criterion's neighborhood. Reworded to "the worst-case-span bound criterion 1 above enforces."
- **Four cross-reference direction errors, all in this pass's own new text**: two "(criterion 7 above)"
  citations where criterion 7 is below (both corrected to "below"); one "`CollisionWorld`'s ... checkpoints
  below" where the `CollisionWorld` section is above (corrected, and relocated into a self-contained
  parenthetical at a clean sentence boundary rather than interrupting the "three scheduling stages ...
  each sized to roughly one frame" appositive, which the re-audit flagged as a new parse ambiguity); one
  "(see `anyComponentInside` below)" where the section is above, also corrected and restated in the
  document's own plain-code citation form rather than the bolded form this pass had invented.
- **One stale conjunct in the gate's own pass/fail line**, introduced by this pass's L6-B6 edit: after
  making the M6-B4 correction, the abort-only tier's own composed span is ~16ms, not 24.8ms, so "24.8ms ...
  at the measured weld/`bvhcast` figures" was no longer accurate — `bvhcast` does not independently reach
  24.8ms. Fixed to attribute 24.8ms to the weld figure alone, with an explicit note that the abort-only
  tier's own ~16ms composition does not raise it.
- **Minor line-wrap cleanup** at two sites the M6-B4 edit had left with an orphaned short line and one
  121-character overflow line; rewrapped, no content change.

Re-ran `node spike/fixtures.mjs` after the fix loop: **55 passed, 0 failed**, unchanged.
