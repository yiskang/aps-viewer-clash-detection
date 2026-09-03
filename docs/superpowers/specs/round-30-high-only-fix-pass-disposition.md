# Round 30 — High-only fix pass: disposition

Type: system-level fix pass, High findings only (not a Codex review round — no `codex-review spec` pass
was run on the whole document, per explicit instruction). Source of truth:
`docs/superpowers/specs/invariant-audit-v7.md`'s High section (5 findings: H-1 through H-5). Target:
`docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md` (4712 lines before this pass;
`node spike/fixtures.mjs` 55/55 pass both before and after).

**Following the doc's own convention (see the Status paragraph near the top): this pass does not add its
own `### Round 30` changelog entry to the main Revision Notes section.** Rounds 24–29 established that
later High/Medium/Low cleanup passes are recorded only in their own standalone disposition document, not
as a new numbered changelog entry in the spec body itself.

Method: three research forks, one per problem group as scoped by the task instruction (H-1's
containment/`non-manifold-component` contradiction; H-2's "budgets bound the worst case" contradiction;
H-3/H-4/H-5's scheduling-taxonomy completeness sweep, the biggest group). Each re-verified its findings
against the *current* spec text (not trusted from the audit report). The H-1 and H-2 forks drafted exact
edits and reported back without touching the file — those 5 edits were applied centrally by the
coordinating session, since both groups' patch plans were small and the sites (verified) don't overlap.
The H-3/H-4/H-5 fork, after an initial patch-plan draft, was redirected to apply its own 14-edit plan
directly (Read+Edit, one edit at a time, re-reading fresh text before each) rather than relay 14 edits
through a lossy prose summary — its regions were verified to have zero overlap with H-1/H-2's sites both
before and after application. Two `codex-advisor` consults happened during this pass, both inside the
H-3/H-4/H-5 fork, both independently re-verified against primary spec text before acceptance: the H-3
capacity-admission remedy (see below), and the H-5 clock-basis/uniqueness question (see below). One
`aps-viewer-api-evidence-investigation` skill invocation confirmed `viewer.impl.getRenderProxy` has no
documented cost or caching behavior anywhere in the Agent Kit's knowledge, informing the honest-disclosure
framing used in the H-4 fix. The coordinating session independently re-verified `node spike/fixtures.mjs`
after all edits landed, reviewed the full diff line-by-line, traced the H-3 precheck's soundness argument
independently rather than trusting the fork's report, and fixed one cosmetic line-wrap regression the
taxonomy fork's edit left behind (no semantic change).

---

## What was fixed

### H-1 — `containment` mode's `non-manifold-component` diagnostic scope contradiction (3 edits)

Adjudicated by the audit: the three-site "never diagnosed for `containment`'s own source" reading is
canonical (2269–2272, 1647, 3022–3023, all left untouched — already correct). The contradicting outlier
and its two downstream silent sites were fixed:

- **Error Handling parenthetical (~3690–3697).** Removed the false "(the public source in `containment`
  mode...)" scoping clause and added an explicit "**Not emitted in `containment` mode**" sentence with the
  same rationale the sibling `unverified-open-component` bullet immediately below it already carries
  (bathtub/14-open-components motivating scenario), rather than re-deriving the rule from scratch.
- **`non-manifold-component` type-union comment (~3524).** Added the mode-scope annotation its sibling
  `unverified-open-component` comment already carries one line below it ("never emitted in `containment`
  mode — see Query modes"), matching that comment's exact continuation-line indentation.
- **`ContainmentQuery.anyComponentInside` fixture (~3899–3901).** Added a parenthetical clarifying this
  fixture exercises the shared internal `ContainmentQuery` primitive directly (where the diagnostic is
  correctly universal), not the public `containment`-mode path (where it's suppressed) — so the fixture no
  longer reads as an unscoped universal claim.

Grep-confirmed after the fix: exactly 6 occurrences of `non-manifold-component` in the file, all mutually
consistent with the canonical "never diagnosed for `containment`'s own source" rule.

### H-2 — Risks section's stale "budgets now bound the worst case" claim (2 edits)

Adjudicated by the audit: the budget section (2110–2125, untouched — already correct, backed by five
independent normative sites including the performance gate's own criterion 1) states the document's
actual, currently-intended guarantee. The stale present-tense contradiction was fixed at both sites the
audit named:

- **Risks section (~4634–4638).** Rewrote the bullet to state what the budgets actually bound (every span
  the document ceilings) and what they don't (accepted non-preemptible atomic risks — `enumNodeFragments`'s
  non-recursive call, the `dispose()` registry sweep, and, after this pass, the `CollisionInstance`
  capacity-admission span until H-3's fix below made it enforceably bounded instead). The stale round-5
  claim is preserved and annotated as superseded, per the document's own annotate-in-place convention
  (matched against three existing examples of that convention found elsewhere in the doc), rather than
  silently deleted.
- **Secondary instance (~1772–1778, `SurfaceIntersectionQuery`'s rewrite narrative).** Narrowed "the spec
  claimed its budgets bound the worst case" to "bound the worst case for this traversal," with a
  cross-reference making clear this per-traversal claim was never the whole-design guarantee the Risks
  section (before this pass) falsely asserted.

Grep-confirmed after the fix: no other site echoes the stale "budgets now bound the worst case" phrasing;
the 5 other hits of "bound...worst case" in the file are past-tense historical bug narration in earlier
Codex-round writeups, not live present-tense claims.

### H-3/H-4/H-5 — scheduling-taxonomy completeness sweep (14 edits)

Rebuilt the existing four-class taxonomy (cooperatively yieldable/resumable; enforceably bounded
synchronous; abort-only synchronous traversal; accepted non-preemptible atomic risk) to include all three
previously-missing synchronous spans, extending the existing structure rather than creating a parallel one.

**H-4 — geometry size-gate input computation (4 edits).** `ViewerGeometryAdapter`'s producer/pipeline
position was undefined; the narrative hand-waved its `ranges: TriangleRange[]` output as computed by an
undefined "earlier layout-normalization pass," with no stated call frequency.
- Gate-input provenance (~1460–1476): now states `ViewerGeometryAdapter` runs once per unique
  `(loadEpoch, geometryIndex)`, as the first sub-step of the compaction+weld phase's own checkpoint, on the
  registry's first touch of that geometry — never per candidate pair. Cost is disclosed, not invented: one
  Viewer `getRenderProxy` call (internal, undocumented — confirmed via the
  `aps-viewer-api-evidence-investigation` skill that no Agent Kit knowledge documents its cost or caching
  behavior) plus `O(ranges)` arithmetic, itself not ceilinged by this spec — an honest residual gap, not a
  fabricated guarantee, per the task's explicit instruction not to invent ceilings the Viewer API can't
  enforce.
- Narrow phase (~2933–2988): restructured to a registry-lookup-first sequence. An existing oversized
  marking or `'building'`/`'ready'` entry never re-runs `ViewerGeometryAdapter` or the ceiling check; only a
  lookup that finds no entry runs normalization → conversion → gate, once, settling the entry for every
  future pair — resolving the "per pair, ahead of any registry access" reading the audit found
  unimplementable (three plausible call-frequency readings differing by up to O(candidate pairs) calls).
- Atomic-operations table row (compaction+welding phase, ~1958): appended a cross-reference noting this
  phase's checkpoint also gates `ViewerGeometryAdapter`'s work.
- Round-16 regression fixture (~4194–4196): `(from normalization)` → `(from ViewerGeometryAdapter,
  computed once on this geometry's first registry touch — see the active-range gate)`.

**H-3 — `CollisionInstance` capacity admission's recompute-and-commit (5 edits).** This mandatory-atomic,
O(U)-cost span (U = the call's complete unique fragment-id set) was ceilinged nowhere — the interior
checkpoint that's the design's only other fix for an over-long span is forbidden by this exact step's own
atomicity invariant, so a prose fix alone couldn't close it. Resolved via `codex-advisor` (medium effort):
rather than a new `maxRequestedDbIds` public-API constant (the audit's own first guess), reuse the
already-existing `maxCollisionInstancesPerEpoch` ceiling as a call-wide precheck on the walk's own unique
fragment-id count, before any bucket lookup. Independently re-verified: since a bucket's combined contents
(`bucket ∪ U`) is always a superset of `U`, `|U| > maxCollisionInstancesPerEpoch` implies the existing
bucket-capacity check would reject the call anyway — so the precheck adds no new rejections beyond what the
bucket-capacity check already guaranteed, while every call that survives it is now provably bounded to
`U ≤ maxCollisionInstancesPerEpoch` work in the recompute-and-commit step. This makes the span **class 2,
enforceably bounded**, not an accepted atomic risk, using zero new public API surface.
- New atomic-operations table row: classifies the span as enforceably bounded via the precheck.
- New step 2 inserted into the capacity-admission sequence (~2900–2932): the precheck itself, with old
  steps 2–4 renumbered 3–5 and an explicit note that the precheck bounds this step's *cost*, not its
  *outcome* — the existing bucket-capacity check (now step 4) still independently fires.
- Enforceably-bounded tier prose (~2089–2103): "four members" → "five members," capacity-admission added
  alongside `enumNodeChildren` as a provisionally-measured member.
- "What the formula does bound" (~2165–2176, one combined edit with H-5 below): capacity-admission span
  added to both the ceilinged-primitives list and the measurement-gap list.
- New gate criterion (~4597–4606) plus a new regression fixture (~4363–4372, next to the existing
  bucket-capacity fixture) asserting the precheck rejects before any bucket lookup or `CollisionInstance`
  construction, distinguishing it from the pre-existing bucket-capacity check.

**H-5 — `SurfaceIntersectionQuery`'s `bvhcast` traversal absent from the taxonomy (5 edits).** The document
made a normative *uniqueness* claim twice ("the one documented, deliberate exception to the
shared-accumulator convention") while a second real traversal used the same mechanism unacknowledged.
Resolved via `codex-advisor` (medium effort) plus independent re-verification at spec lines 1906–1917: the
private-clock time trigger is checked at callback entry, not inside the probe loop, so it applies unchanged
to a traversal with no probe loop at all — `SurfaceIntersectionQuery` genuinely inherits the same abort
protocol, confirming two traversals share one mechanism rather than there being two independent exceptions.
Fixed by reframing the uniqueness claim at the **protocol level** ("this private-clock abort protocol is
the one documented exception... used by both `ProperCrossingQuery`'s traversal and
`SurfaceIntersectionQuery`'s") rather than mechanically duplicating "one" into "two" wherever it appeared.
- Abort-only tier bullet (~2020–2032): reframed as above, with the callback-entry-timing justification.
- Span formula addends (~2114–2126): added `SurfaceIntersectionQuery`'s addend (`frameBudgetMs` + one raw
  candidate callback, ~0.3µs measured) — strictly smaller than `ProperCrossingQuery`'s, doesn't raise the
  tier's ~16ms composed span.
- "What the formula does bound" — combined with H-3's edit above, one rewrite, not two passes.
- Clock-basis reconciliation (~2188–2192): "the one documented exception" now names both traversals sharing
  one private-clock protocol.
- `SurfaceIntersectionQuery`'s own definition (~1788–1796): added an explicit statement that "the same
  abort protocol" it inherits from `ProperCrossingQuery` includes the private-clock trigger — closing the
  ambiguity at the definition site itself, not only in the taxonomy section.

**M-SW1 recheck (1 edit, in scope per the task's explicit re-check instruction).** Confirmed both live
sites: atomic-operations table row 1950 was already correctly annotated (Round 22's fix, verified intact).
Data Flow (~2949–2955) was still stale — present-tense "~60× the ...~16ms pass criterion." Fixed to mirror
row 1950's exact annotation style: `~40×`/`≈24ms`/`24.8ms`, with the Round-18→22 superseding note.

**Distinctness check.** After all edits, `SurfaceCrossingWitness` remains explicitly stated as reading the
shared accumulator, in the cooperatively-yieldable tier — untouched by any H-3/H-4/H-5 edit.
`SurfaceIntersectionQuery` moved to the abort-only (private-clock) tier alongside `ProperCrossingQuery`. The
two stay distinctly classified, confirmed by grep: no edit merged their treatment, and no fifth taxonomy
class or parallel taxonomy was introduced anywhere in the file.

---

## What was deliberately not touched

Per explicit instruction:

- **No Medium or Low finding was fixed**, except M-SW1's re-check, which the task explicitly named as part
  of the gate-figure sweep. All other Mediums (M-L1, M-L2, M-L3, M7-G2, M7-G3, M-Q1 through M-Q4, M-SW3,
  M-7C1 through M-7C4) and all 19 Lows from `invariant-audit-v7.md` are left exactly as that document
  recorded them, deferred to a future cleanup round in this lineage's established pattern.
- **No stabilized lifecycle, cache, or query architecture was reopened.** Every edit either corrected a
  scoping/classification misstatement, added a previously-missing cross-reference or taxonomy entry, or
  introduced one new enforceable bound (`maxCollisionInstancesPerEpoch`'s reuse as a call-wide precheck)
  using an existing constant, not new architecture. None touch `Model`-object identity, `loadEpoch`
  monotonicity, disposed-first checkpoint semantics, `GeometryRegistry`/`BlasCache` ownership, or the mode
  dependency matrix.
- **2110–2125's worst-case-span exclusion list was left untouched**, per the H-3 resolution: since
  capacity-admission is now enforceably bounded rather than an accepted atomic risk, it does not belong in
  that exclusion list at all — no edit was needed there, avoiding the collision the task flagged as a risk
  between H-2's and H-3's neighboring edit sites.

## Verification

`node spike/fixtures.mjs` — **55/55 pass**, both before this pass began and after all 19 edits landed,
independently re-run by the coordinating session (not only trusted from the fork's report). As with every
prior round's disposition doc, this is expected and not strong evidence on its own: this pass edited only
the spec's prose, and `spike/*.mjs` is a standalone algorithm prototype the spec's fixtures describe but
don't execute.

Full diff reviewed line-by-line by the coordinating session (`git diff --stat`: 175 insertions, 76
deletions, one file). One cosmetic line-wrap regression (a single over-long unwrapped line left by the
taxonomy fork's Data Flow edit) was found and fixed; no semantic content was affected.

## Addendum — superseded by the v8 audit and its own remediation pass

A fresh five-system invariant audit, using the same methodology `invariant-audit-v1.md` through
`invariant-audit-v7.md` were built against, ran against the text above and produced
`docs/superpowers/specs/invariant-audit-v8.md`. It found **zero Critical findings** but **6 High-severity
regressions this pass's own edits introduced** — independently confirmed across the five per-system
audits, several found from two sides at once:

- **A geometry-gate span "relocated, not fixed."** H-4's original fix folded `ViewerGeometryAdapter`
  normalization into the compaction+welding phase's own bounded (`12_000`) atomic-operations-table row,
  while that same row admitted the sub-step is "not itself ceilinged by this spec" — reproducing v7's
  exact defect shape one level down (found independently by the geometry and syncwork auditors).
- **A duplicate-build race window reopened.** The restructured narrow phase ran normalization and the
  ceiling check *before* inserting the `GeometryRegistry` entry, apparently contradicting the doc's own
  "insert first, then build" rule (established specifically to prevent two concurrent `findClashes` calls
  from both missing the registry and starting duplicate builds) — flagged as possibly Critical if left
  unresolved (geometry auditor).
- **A diagnostic-dedup overclaim.** The restructured narrow phase's new "never repeats normalization or
  the ceiling check" claim was false for two of `FragmentDiagnosticReason`'s three members — normalization
  failures (`unsupported-geometry-layout`, `rejected-primitive-range`) get no persistent registry-entry
  dedup, only the oversized case does (geometry auditor).
- **A factually false regression-fixture rationale.** The new capacity-admission-precheck fixture's stated
  reasoning ("an empty bucket never trips a combined-total check…") was the literal negation of the
  superset argument the whole H-3 fix rests on — the fixture's spy assertions were fine, only the prose
  justifying them was wrong (found independently by the syncwork and cache auditors).
- **A stale gate criterion.** Gate criterion 1 still said "one provisional exception" after the
  enforceably-bounded tier grew a second provisional member (syncwork auditor).
- **A duplicated, un-synced description.** The `CollisionInstance` admission sequence's second, older copy
  under **Components** was never updated with the new precheck step, so an implementer working from that
  copy alone would build exactly the design the new regression fixture asserts must fail (cache auditor,
  independently flagged at lower severity by the syncwork auditor from the same underlying defect).

The v8 model-builder additionally found a dangling cross-reference this pass introduced (both H-2 rewrite
sites pointed at a section name — "Budget enforcement and yield points" — that does not exist anywhere in
the document; confirmed via `git log -S` to be pure working-tree text, never committed).

**All regressions were fixed within this same session, before `invariant-audit-v8.md` was finalized.**
Two parallel fixer forks handled the four independent, mechanically-scoped fixes (dangling cross-reference,
fixture rationale, gate-criterion count, Components duplicate) and the geometry-gate redesign
respectively; the geometry-gate fork ran a `codex-advisor` (medium effort) consult on the genuine design
question — insert-before-classify vs. classify-before-insert — which surfaced a subtlety neither the task
nor the original fix had accounted for: synchronous execution alone does not establish atomicity against
reentrant Viewer callbacks, only synchronous-and-non-reentrant does. Rather than the heavier "immediate
provisional entry" redesign codex also offered (which would have reopened the stabilized
`GeometryRecord`/single-flight state machine to model a new pre-classification entry shape, with its own
unresolved edge cases codex flagged explicitly), the fix adopted codex's lighter, equally-sound
alternative: keep the existing classify-then-insert ordering, but state its safety precondition
explicitly and disclosed — `ViewerGeometryAdapter` normalization (including `getRenderProxy`) is assumed
synchronous and non-reentrant, the same disclosed-not-independently-verified category as this spec's other
undocumented-Viewer-API assumptions — rather than leaving it implicit. Classification was given its own
atomic-operations-table row (a third accepted non-preemptible atomic risk, alongside one `enumNodeFragments`
call and the `dispose()`/`evictModel` registry sweep) with its own gate-measurement criterion, and the
narrow-phase paragraph's dedup claim was scoped to match — honestly carving out the two normalization-failure
diagnostic reasons as a pre-existing gap (`invariant-audit-v7-geometry.md`'s M7-G3) this pass narrows, not
closes, consistent with the task's instruction not to touch Medium findings. Every downstream count
reference ("two synchronous spans excluded," "two accepted-risk exclusions") was updated to "three" across
the worst-case-span formula, gate criterion 1, and the measurement-gap enumeration. The coordinating session
independently re-verified every fix against live text (not only trusted from fork/consult reports) and
re-ran `node spike/fixtures.mjs` after each edit — 55/55 throughout, no regression in the algorithm prototype
at any point.

Final spec state: `node spike/fixtures.mjs` 55/55 both before and after this addendum's edits; `git diff
--stat` against the pre-Round-30 baseline: 243 insertions, 113 deletions, one file. See
`invariant-audit-v8.md` for the complete five-system audit this addendum responds to, including the
Mediums and Lows this pass deliberately left untouched (per the original High-only scope).
