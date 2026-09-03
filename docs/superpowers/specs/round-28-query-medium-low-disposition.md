# Round 28 — Medium/Low pass: close the query-semantics cluster from `invariant-audit-v6-query.md`

Scope: **all remaining query-semantics Medium and Low findings** from `invariant-audit-v6-query.md`
(query-mode composition and stage ownership, `anyComponentInside` preconditions and guarantee wording,
`SurfaceCrossingWitness` semantics, parity/closure diagnostic wording, containment surface-only
semantics, positive/negative diagnostic mapping, canonical query-mode tables and stale duplicated
descriptions, and the M-Q2/M-Q3 audit-record gaps if still applicable). `H-Q1` (the sole query-system
High) was explicitly out of scope and untouched throughout. No lifecycle findings closed in Round 26,
geometry-pipeline findings closed in Round 27, or cache/concurrency findings closed in Round 25 were
touched. No budget/scheduling findings outside this query cluster were touched. No Codex *review* was
run, per instruction — verification used three parallel research subagents (one per finding sub-cluster)
to relocate and re-verify every finding against the current live text before editing, each of which
independently consulted `codex-advisor` (never the native `advisor` tool, per the standing repo
preference communicated as a hard constraint to every dispatched subagent) on its harder judgment calls,
followed by one independent adversarial re-audit subagent (opus) after editing, which also used
`codex-advisor` for a second opinion on one flagged item.

**A key discovery this pass made: `invariant-audit-v6-query.md` was self-stale at the moment it was
written.** `git blame` shows the audit document and the "abort-only ceiling"/worst-case-span rewrite it
critiques were committed together (`eace98a`, "Fix Round-22 H2 via worst-case-span re-derivation, add v6
five-system invariant audit"). The *final* committed text of that rewrite already resolves M-Q2, M-Q3,
and one Low finding — the audit prose simply wasn't updated to reflect its own commit's final state. This
predates Rounds 23-27 entirely; it is audit self-staleness at creation, not later drift. Separately, the
audit's own H-Q1 finding (the clock-basis contradiction) turned out to already be resolved in the live
text by the same mechanism: the "abort-only ceiling" bullet now names only `ProperCrossingQuery` for the
private-clock exception and explicitly states `SurfaceCrossingWitness` reads the shared accumulator
instead — matching, not contradicting, `SurfaceCrossingWitness`'s own passage. What remains genuinely open
and explicitly out of scope is a narrower, already self-flagged concern the live text itself brackets as
"a pre-existing question this re-derivation does not resolve … out of this pass's scope" (current text,
inside the abort-only bullet) — a verdict-determinism question about `SurfaceCrossingWitness`'s
shared-accumulator abort, not a clock-basis contradiction. This pass did not touch it.

---

## Findings addressed, grouped by cluster

### Cluster 1 — query-mode composition, stage ownership, and canonical tables

**Stage/term terminology overload (pre-existing Medium, v5 M5-Q1/M-Q2, model item 16): CLOSED for its
originally-scoped ambiguity.** `anyComponentInside`'s numbered stages 1/2/3 were being conflated in three
sites with `ContainmentModeQuery`'s two *composition terms* (already separately named "first term"/"second
term" elsewhere). Fixed by renaming the conflated usages from "stage" to "term" at the three primary
sites — the containment guarantee's "two-stage negative" → "two-term negative" and its cross-reference
target, the `ContainmentModeQuery` prose heading itself ("Stage ordering is cheapest-first" → "**Term
ordering is cheapest-first:**", now correctly bolded as a heading matching every other cross-reference
target's convention in this document), and a Testing & Verification fixture bullet ("budget exhaustion in
the surface-crossing stage" / "Stage 2 added a third traversal" → named directly as `SurfaceCrossingWitness`
/ `ContainmentModeQuery`'s second composition term). Three companion Low-severity deictic sites ("this
stage" used to mean `SurfaceCrossingWitness`) were also disambiguated to name the traversal directly. No
mechanism, contract, or fixture assertion changed — pure vocabulary disambiguation, independently confirmed
via `codex-advisor` to introduce no broken cross-references.

**Canonical query-mode/stage reference matrix: confirmed already satisfied, no fix needed.** The mode
dependency matrix (query modes vs. `anyComponentInside` calls, connectivity requirement, parity target,
open-source/open-target diagnostic mapping) is already the document's single stated source of truth and
one of its six explicitly-named stabilized Critical invariants; every other site that states which modes
call which `anyComponentInside` stages already cross-references it rather than restating it (confirmed
fixed by Round 19's C-3 and Round 21). No stale duplication of the mode table itself was found — the two
candidate sites (the Public API TS comment, and the parity/open-component role tables) are a
deliberately-rewritten API-facing restatement and a finer-grained per-path decomposition, respectively,
both already consistent with the matrix and both correctly cross-referenced. No edits made here.

### Cluster 2 — `SurfaceCrossingWitness` self-bound and shared-count-budget wording (M-Q1–M-Q5)

**M-Q1 (circular gate-band self-bound justification): CLOSED.** `ProperCrossingQuery`'s own private-clock
passage justified its ~2×`frameBudgetMs` worst case by showing it "sits within, not beyond" a ≈24ms figure
that was itself partly *derived from* that same ~2×`frameBudgetMs` value — true by construction, carrying
no argumentative weight. Fixed per `codex-advisor`'s sharper wording: replaced the self-referential
comparison with an independently-measured one (the ~16.8ms weld phase, measured separately, remains larger
than ~2×`frameBudgetMs`, so admitting this traversal to the abort-only tier does not raise the formula's
controlling unit-cost term). This is `ProperCrossingQuery`-scoped clock/budget wording that sits inside the
query-semantics system's own audit document (`invariant-audit-v6-query.md`'s own M-Q1), not a foreign
budget/scheduling-system finding — correctly in scope for this pass despite touching cost figures, the same
way prior rounds' own-system housekeeping items were.

**M-Q2 (two vs. three `bvhcast`-native traversals) and M-Q3 (formula bounds a traversal the gate never
measures): ALREADY FIXED, confirmed, no edit.** Both were resolved by the same commit that created the
stale audit itself (see above) — the abort-only bullet now names only `ProperCrossingQuery` for the private
clock and explicitly carves `SurfaceCrossingWitness` out into the cooperative-composition tier instead, and
the worst-case-span formula's coverage list no longer claims a self-bounded span for
`SurfaceCrossingWitness`. Re-verified directly against current text; left untouched.

**M-Q4 (per-traversal vs. shared count-budget scoping wording gap): CLOSED.** `SurfaceIntersectionQuery`'s
description said it was "sharing `maxCandidatePairsExamined`" with `ProperCrossingQuery`, without
distinguishing a shared configuration ceiling from per-traversal counter state — `SurfaceCrossingWitness`'s
own passage already used the more precise "traversal-local counter" vocabulary. Fixed by matching that
vocabulary: "using the same `maxCandidatePairsExamined` ceiling, with a fresh traversal-local
`candidatePairsExamined` counter for each traversal." Low practical risk in Milestone 1 (confirmed by the
original audit), but the wording now generalizes correctly.

**M-Q5 (`crossing-budget-exhausted` type comment omits the time-based trigger): DEFERRED, not fixed.** The
original audit itself classified this as v5's sync-work/budget-scheduling territory. `codex-advisor`'s
nuance — that the comment also documents when an observable query diagnostic fires, so the boundary is
genuinely debatable — is recorded, but this pass defers to that ownership classification rather than
adjudicate a system boundary unilaterally. A ready-to-use, clock-neutral fix text (touching neither H-Q1 nor
any clock-basis question) is on record in this pass's research notes for whichever pass owns it:
`// candidate-count, crossing-count, or elapsed-time ceiling hit; traversal aborted`.

**Low (runtime-cost disclaimer vs. asserted-bound tension): ALREADY RESOLVED, no edit.** Resolved as a side
effect of the same M-Q2/M-Q3 fix — the ~2×`frameBudgetMs` bound is no longer asserted for
`SurfaceCrossingWitness` at all, so the "total runtime still needs measurement" disclaimer no longer sits
beside a contradicting claim.

### Cluster 3 — diagnostic mapping, containment-guarantee wording, and label hygiene

**`maxCrossingPairsExamined` diagnostic-mapping split (pre-existing Medium): CLOSED.** One site mapped
hitting `maxCrossingPairsExamined` to `crossing-budget-exhausted`; a second, independently, mapped hitting
the same ceiling "before deciding" to `inconclusive-crossing` — a genuine contradiction against the
canonical `PairDiagnosticReason` type-union comments (budget exhaustion → `crossing-budget-exhausted`;
boundary-classified or unprobeable → `inconclusive-crossing`). Fixed by realigning the second site: budget
exhaustion stays `crossing-budget-exhausted` (with a cross-reference to the canonical bullet); the
boundary-probe and unproducible-in-triangle-probe cases stay `inconclusive-crossing`. No diagnostic that
actually fires in either scenario changed.

**Containment guarantee's early-exit wording (pre-existing Medium, v5 M5-Q2): CLOSED, with one fix-loop
correction.** The guarantee's "only decides the outcome once no proper crossing exists" wording didn't
account for `volume-overlap`'s early-exit positive path (a true `ProperCrossingQuery` result returns
positive before either containment term runs). Fixed with one clause. **Fix-loop correction**: the
adversarial re-audit found the first draft fixed `volume-overlap`'s case but left the identical asymmetry
for `containment`'s own positive first term unaddressed inside the very sentence it had just edited — the
sentence still read as if "two-term negative for `containment`" needed to hold for every outcome, not only
negatives. Extended with a parallel clause: "for `containment`, a positive first term likewise decides
immediately, without invoking this precondition — it governs negatives only." No mechanism change; the
guarantee's actual scope (negatives only) was already correct, only the prose's coverage was incomplete.

**`unverified-parity-operand` role table completeness (pre-existing Medium, v5 M5-Q8/M5-Q9): CLOSED.** The
role table (decided-by / parity-ran-against / roles-that-can-be-indicted) used unscoped rows that overstate
what's possible in `containment` mode — the unscoped "a negative" row permits `source`, and the "both open
produces two" sentence permits two diagnostics, but neither is reachable in `containment` (both its
mechanisms, `ContainmentQuery` and `SurfaceCrossingWitness`, parity-test only the target). Fixed by adding
a **Mode scope** paragraph immediately after the table, per `codex-advisor`'s reviewed recommendation,
naming exactly which rows/cases are `volume-overlap`-only and restating `containment`'s target-only
consequence — without restructuring the table itself.

**Target-side connectivity "the check is free" claim (pre-existing Medium, v5 M5-Q3, post-H-Q4): CLOSED.**
Stale next to H-Q4's own fix, which established connectivity construction as its own separately-checkpointed
lazy phase rather than something bundled "alongside the BLAS" for free. Fixed by distinguishing the free
*read* of an already-built connectivity record from the non-free *build*, and cross-referencing the
existing connectivity-gate passage (`ThreeMeshBvhBackend`/`BlasCache`) that already guarantees the target's
record has gone through that phase.

**Public API comment's diagnostic enumeration omitting `non-manifold-component` (pre-existing Medium, v5
M5-Q4): CLOSED, with one fix-loop correction.** The `volume-overlap` mode comment enumerated
`unverified-parity-operand` and `unverified-open-component` but not `non-manifold-component`, though the
canonical passage states all three apply. Fixed by completing the enumeration. **Fix-loop correction**: the
adversarial re-audit found a sibling bullet elsewhere in the document ("Non-manifold or open source
components…") still said "source" and "one," narrower than both the canonical "any flagged component"
wording and this pass's own newly-completed Public API comment — an inconsistency this pass's own edit made
more conspicuous by contrast. Fixed by broadening that sibling bullet to name whichever operand
`anyComponentInside` is actually sampling (the public source in `containment` mode; either public operand
in `volume-overlap` mode, depending on which containment term is sampling it), matching the canonical "any
flagged component" scope without touching `containment` mode's already-correct source exemption.

**Cross-reference target formatting (Low): CLOSED as a side effect of Cluster 1's rename.** The
"Stage ordering is cheapest-first" cross-reference target was a plain sentence opener, not bolded like
every other cross-reference target in the document. Cluster 1's rename to "**Term ordering is
cheapest-first:**" both fixed the terminology overload and bolded the target in the same edit — no separate
fix needed.

**Label-namespace sprawl / query-side "H2" leak (Low): ALREADY FIXED, no action.** Round 27 (commit
`1ec8cbe`) already added both the general disambiguation paragraph naming this exact class of issue and a
specific qualifying parenthetical at the query-side "H2" instance itself. Confirmed against Round 27's own
disposition doc and the live text; nothing left to do.

---

## What was deliberately not touched

- `H-Q1` — the query system's sole High finding. Already resolved in the live text by an earlier commit
  (not this pass); re-verified byte-identical across this pass's entire diff at both its clock-basis sites.
  What remains is a narrower, already self-flagged verdict-determinism question the live text itself
  brackets as out of scope — untouched.
- M-Q5 (`crossing-budget-exhausted` comment's missing time-trigger) — deferred to sync-work/budget-scheduling
  ownership per the original audit's own classification, with `codex-advisor`'s scope nuance recorded and a
  ready-to-use fix text left on record for whoever owns it.
- `volume-overlap`'s own, separate "stages" vocabulary (its three independently-budgeted composed
  subqueries: `ProperCrossingQuery`, then both `ContainmentQuery` directions) at three sites in
  `CollisionWorld`'s cross-pair/cross-stage yielding prose and one Round-9 changelog bullet. An adversarial
  re-audit flagged this as a residual, structurally similar "stage" usage not covered by Cluster 1's rename.
  Left untouched: all three current-text sites sit inside `CollisionWorld`'s checkpoint/yield-governance
  mechanism — budget/scheduling territory this pass's scope explicitly excludes ("Do NOT touch
  budget/scheduling findings outside this query cluster") — and the fourth site is historical changelog
  narration preserved per the document's own no-rewriting-history convention.
- Lifecycle (Round 26), geometry-pipeline (Round 27), and cache/concurrency (Round 25) territory — untouched
  throughout; no hunk in this pass's diff mentions eviction, epochs, disposal, `GeometryRegistry` mutation,
  `buildState`, or cache keying.
- No query-mode contract was broadened or narrowed. `surface-intersection`'s touching-inclusive/no-parity/
  no-connectivity contract; `containment`'s directed source-surface/target-interior/target-parity-only
  contract; `volume-overlap`'s symmetric positive-volume/ProperCrossing-or-bidirectional-containment
  contract; containment's exclusion of the constructed interior witness; `SurfaceCrossingWitness`'s
  source-surface-only/target-only classification; and the connectivity dependency matrix are all unchanged
  — independently re-verified by the adversarial re-audit against the live text at every changed site, not
  assumed from the diff's own wording.

---

## Verification performed

1. **Re-verification against current spec before editing**: three parallel research subagents (one per
   finding sub-cluster) relocated and re-confirmed every finding at its current line location by direct
   read against the live 4630-line (pre-edit) file, not the audit document's stale 4431-line citations —
   the file had grown +199 lines since `invariant-audit-v6-query.md` was written, on top of drift from
   Rounds 23-27. Each subagent independently consulted `codex-advisor` (medium effort) on its harder
   dispositions; all consultations returned full or near-full agreement, with two wording refinements
   (M-Q1's explicit-comparison rewrite, M-Q4's sharper counter-scoping clause) and one added item (the
   role-table "Mode scope" paragraph) folded in before editing.
2. **Manual re-read of every proposed edit site against the live file** before applying any edit, to catch
   and merge one direct conflict between two subagents' proposed fixes to the same passage (the containment
   guarantee's "Stage ordering is cheapest-first" cross-reference: one subagent proposed a terminology
   rename, another proposed only bolding it to fix its formatting) — merged into a single edit that
   satisfies both.
3. **`node spike/fixtures.mjs`**: **55 passed, 0 failed**, both after the initial edit pass and again after
   the fix-loop corrections below. (As in prior rounds: this spike covers only geometry classification —
   not the query-mode/diagnostic-mapping prose this pass edited; a regression sanity check, not a direct
   test of this pass's changes.)
4. **Independent adversarial query Medium/Low re-audit**, dispatched as a fresh subagent (opus, no access to
   this editing session, instructed to be adversarial rather than to rubber-stamp the diff), which itself
   consulted `codex-advisor` on one item. Verdict: 10 of 12 hunks CLOSED CLEANLY; 1 (the containment
   guarantee's early-exit sentence) PARTIALLY CLOSED — flagged as a **new asymmetry this pass's own edit
   introduced** by fixing `volume-overlap`'s case and leaving `containment`'s parallel case unaddressed in
   the same sentence; 1 (M-Q1's fix) correctly closed but flagged as a **possible scope deviation** (this
   pass's own read: not a deviation — M-Q1 is `invariant-audit-v6-query.md`'s own finding, reported by the
   query-semantics auditor, and is correctly in this pass's scope despite touching clock/budget figures).
   Also surfaced one genuine Low the original edit pass missed (the sibling "Non-manifold or open source
   components" bullet, narrower than this pass's own newly-completed Public API comment) and one Low judged
   correctly out of scope on inspection (`volume-overlap`'s separate "stages" vocabulary, in
   budget/scheduling territory). Both real findings were fixed in one fix-loop round (below).
5. **Fix loop (one round)**: extended the containment guarantee's early-exit sentence with a parallel clause
   for `containment`'s own positive-first-term case; broadened the sibling "Non-manifold or open source
   components" bullet to match this pass's own completed enumeration; cleaned up four minor line-wrap
   issues introduced by the initial edit pass (M-Q1's rewrite and three `SurfaceCrossingWitness` renames had
   each merged onto an existing line without rewrapping, producing outlier 111-126-character lines against
   the surrounding ~85-105-character paragraphs). Re-ran `node spike/fixtures.mjs` after each change —
   unchanged throughout, 55 passed, 0 failed.
6. Re-verified directly against current text (not the re-audit's word alone): all six preserved query
   invariants (`surface-intersection` touching-inclusive/no-parity/no-connectivity; `containment` directed
   source-surface/target-interior/target-parity-only; `volume-overlap` symmetric/ProperCrossing-or-
   bidirectional-containment; containment's exclusion of the constructed interior witness;
   `SurfaceCrossingWitness`'s source-surface-only/target-only classification; the connectivity dependency
   matrix) are intact; `H-Q1`'s two clock-basis sites are byte-identical across the full diff; no query-mode
   contract, ceiling value, or diagnostic's actual firing condition changed anywhere in this pass's diff.

---

## Disposition

**0 Critical regressions. 0 High regressions.** `H-Q1` — already resolved in the live text by an earlier
commit, not this pass — remains correctly out of scope and byte-untouched; its narrower residual
verdict-determinism question remains explicitly self-flagged as out of scope in the live text itself, as
before this pass.

**All in-scope query Medium findings: CLOSED** — stage/term terminology overload (its originally-scoped
ambiguity), M-Q1 (circular gate-band justification), M-Q4 (shared-ceiling vs. per-traversal-counter
wording), the `maxCrossingPairsExamined` diagnostic-mapping split, the containment guarantee's early-exit
wording (both modes), the `unverified-parity-operand` role table's mode-scope completeness, the
target-side connectivity "free" claim, and the Public API comment's `non-manifold-component` omission
(plus its newly-surfaced sibling bullet).

**All in-scope query Low findings: CLOSED** — the three companion stage-terminology deictic sites, the
cross-reference target-formatting gap (closed as a side effect of the terminology rename), the runtime-cost
disclaimer/asserted-bound tension (already resolved as a side effect of M-Q2/M-Q3), and the label-namespace
sprawl (already fixed by Round 27).

**Confirmed already fixed prior to this pass, no action needed:** M-Q2, M-Q3, the runtime-cost disclaimer
Low, and the label-namespace Low.

**Explicitly deferred, with concrete reason:**
- M-Q5 (`crossing-budget-exhausted` comment's missing time-trigger) — sync-work/budget-scheduling ownership
  per the original audit's own classification; ready-to-use fix text on record.
- `volume-overlap`'s own separate "stages" vocabulary in `CollisionWorld`'s cross-pair/cross-stage yielding
  prose — budget/scheduling territory this pass's scope explicitly excludes; the fourth, historical
  changelog instance is preserved per the document's own no-rewriting-history convention.

No query-mode contract, ceiling value, ownership rule, or diagnostic-firing condition changed anywhere in
this pass. All edits were prose corrections, terminology disambiguation, or cross-reference/completeness
additions.
