# Round 27 — Medium/Low pass: close the geometry-pipeline cluster from `invariant-audit-v6-geometry.md`

Scope: **all remaining geometry-pipeline Medium and Low findings** from `invariant-audit-v6-geometry.md`,
plus its "confirmed unchanged" Mediums that are geometry-pipeline territory (active-range compaction,
size-gate boundary, cancellation-signal wording, oversized-marking gaps, connectivity trigger-point
wording). No Critical or High architecture was touched. No lifecycle findings closed in Round 26 or
cache/concurrency findings closed in Round 24/25 were touched. No query-semantics or budget/scheduling
findings were touched — this explicitly excludes `invariant-audit-v6-geometry.md`'s own three Highs
(H6-G1, H6-G2, H6-G3 — `frameBudgetMs` checkpoint/phase-compounding scheduling, already closed by an
earlier pass per commit `eace98a`, confirmed still closed by this pass's re-audit) and its Medium M6-G1
(extraction sibling-checkpoint coverage — budget/scheduling territory, out of this pass's stated scope).
No Codex *review* was run, per instruction — verification used five parallel research subagents (one per
invariant cluster) to relocate and re-verify every finding against the current live text before editing,
followed by one independent adversarial re-audit subagent (opus) after editing. The standing repo
preference for `codex-advisor`/`codex-review` over the native `advisor` tool was communicated as a hard
constraint to every dispatched subagent; none needed to invoke either.

---

## Findings addressed, grouped by invariant

### Cluster 1 — active-range compaction / size-gate ordering

**Compaction/ceiling-check ordering transposition: CLOSED.** One passage claimed the ceiling check
happens *before* compaction ("Before welding, before the ceiling check..."), directly contradicting the
canonical statement two paragraphs later ("checked against `activeTriangleCount` before any copying
happens") and the fixture that pins the latter. Fixed by removing the false ordering claim from the first
site and making it defer to the canonical statement instead of restating (now: "before anything is handed
to `mergeVertices` — but only once the ceiling check below has passed").

**`>=` vs `>` boundary: CLOSED.** One site said "at or above" (`>=`); three others said "exceeds" (`>`).
No existing fixture discriminated the boundary (13,000/11,000 triangles against a 12,000 ceiling never
exercises 12,000 itself). Fixed by aligning the outlier to the majority ("exceeds"), and — going beyond a
wording fix, per the finding's own genuine ambiguity — added a new fixture bullet pinning the boundary
itself: a fragment at exactly `activeTriangleCount = 12_000` must build, not be skipped, closing the
ambiguity rather than leaving it unresolved.

### Cluster 2 — welded-buffer ownership / bounds-tolerance provenance

**`L_X`'s defining geometry unstated post-compaction: CLOSED.** Nothing said whether
`L_X := diagonal(localBounds(X))` — which scales `surfaceEpsilon`, `mergeDistance`, `offsetLadder`,
`witnessLadder`, and `minPenetrationDepth` — is taken over the raw Viewer geometry or the collision-owned
compacted-then-welded buffer. Fixed by stating it explicitly, cross-referencing the existing "Position is
an owned, compacted-then-welded buffer" passage rather than restating it. No mechanism change.

**Connectivity trigger-point ambiguity: CLOSED.** One site read as if the trigger point were left
undecided ("this state model does not by itself decide that trigger point"), when it is in fact decided
and tested. The re-audit found the fix's first draft pointed at an ambiguous "there" (two antecedents, one
of which — Data Flow step 3 — only covers the first-build-inline case, not the late-trigger-against-an
-already-`'ready'`-entry case a fixture exercises). **Fixed in the fix loop**: reworded to state the rule
directly — connectivity is created lazily, on demand, the first time any call's narrow phase runs a mode
needing `anyComponentInside` against the record, whether during that entry's own first build or a later
call against an already-`'ready'` entry — with accurate, disambiguated pointers to both cases. No
ownership/mechanism change.

### Cluster 3 — oversized-record handling

**Oversized-diagnostic scope vs. its own justification: CLOSED.** The diagnostic was justified
geometry-level ("being oversized is a property of the geometry alone") but scoped fragment-level (one
entry per oversized fragment), with no stated reconciliation. Fixed by adding one sentence: the diagnostic
still names the fragment because that is the unit a caller can act on in the model tree.

**Which code path creates the oversized marking, and the unnamed dedup store: CLOSED.** The narrow-phase
description said "skip the pair" without naming who marks the entry oversized or what deduplicates the
per-fragment diagnostic. Fixed by naming `GeometryRegistry` as the marker (cross-referencing the existing
ceiling-check passage rather than re-deriving it) and naming the dedup structure as "a fragment-keyed set
scoped to this `findClashes` call." **Fix-loop correction**: the re-audit found this edit had
inadvertently dropped the explicit "skip the pair" language the narrow-phase step needs to actually state
the pair is skipped (it became only implicit via "Otherwise..."); restored it as the lead clause.

**Oversized marking vs. the single-flight rule: CLOSED.** The single-flight bullet ("a caller that finds
an existing entry never starts a duplicate build") never said whether an oversized marking counts as "an
existing entry." Fixed by stating that a caller finding an oversized marking instead skips the pair
immediately without awaiting anything, and that either way no second build ever starts.

**Vacuous "cached BLAS and cached connectivity" clause: CLOSED.** `releaseEpochScopedState`'s sweep
comment said it drops each swept entry "together with its cached BLAS and cached connectivity," which is
vacuous for an oversized marking (which has neither). Fixed by stating that explicitly and cross-
referencing the existing oversized-entry-kind bullet.

**`referenceCount` (Low, GeometryRecord field completeness): CLOSED.** Named once, with no
increment/decrement/zero semantics ever stated. Fixed by marking it reserved/unused in Milestone 1 at its
declaration, cross-referencing the epoch-scoped release model that makes it unnecessary — consistent with
the other site that already says `CollisionInstance` release is not derived from a reference count.

### Cluster 4 — `GeometryRecord` cancellation-signal wording (mechanism unchanged)

**Intra-bullet cancellation-signal universality tension: CLOSED.** One clause said "Every registry entry
carries one entry-scoped cancellation signal"; eight lines later, the same bullet narrowed that to
`'building'`/`'ready'` entries only. Fixed by softening the opening clause to say `'building'`/`'ready'`
entries explicitly, and trimming the now-redundant closing restatement to a one-line forward pointer at
the bullet that already states the oversized carve-out correctly. The protected Round 19/20 cancellation
mechanism (created once at insertion, carried unchanged `'building'`→`'ready'`, raced by every phase slot,
settled exactly once by both release paths, identity-guarded) is untouched — verified unchanged by the
re-audit.

**Residual site in "`world.dispose()` is terminal" prose: CLOSED.** This narrative-prose block asserted
universally that "the clear rejects each entry's cancellation signal as it drops the entry," with no
oversized carve-out — unlike the parallel `world.dispose(): void` code-comment block, which already had
one. Fixed by adding the same carve-out here, cross-referencing the code comment rather than duplicating
its reasoning.

### Cluster 5 — geometry-pipeline housekeeping

**Sweep-cost row under-description, propagated to the worst-case-span formula's exclusion list: CLOSED,
with a fix-loop correction.** Round 25 already fixed the atomic-operations table row itself (site 1 of 3);
this pass's first draft at site 2 (the formula's exclusion list) claimed the `CollisionInstance` cache
risk scales with "a pathological number of live entries across one or more epochs" — the re-audit found
this **directly contradicts** the table row it cited, which states `evictModel`'s equivalent deletion is
O(1) *regardless* of entry count, and that only `dispose()`'s cost (which scales with the number of
*simultaneously live epochs*, not entries within one) is actually unmeasured. **Fixed in the fix loop**:
reworded to name the correct driver (live-epoch count on the `dispose()` path) and explicitly note why
`evictModel` is not a source of this risk. Also extended site 3 (the performance-gate criterion's
measurement requirement), which previously scoped the sweep measurement to one epoch's entry count only —
added a clause requiring the gate to additionally vary the number of simultaneously live epochs at
`dispose()`-time teardown, cross-referencing the table row's own already-stated gap.

**Bound/band vocabulary mismatch: CLOSED.** One geometry-relevant "tolerance band" occurrence (near the
`bvhcast` private-clock discussion) still used the pre-Round-22 term after the gate criterion itself had
already switched to "bound" (Round 25 fixed the cache-side instance of this same mismatch). Fixed to
match. Confirmed exactly one "tolerance band" occurrence remains in the file, inside a Round 21 changelog
bullet — correctly preserved as historical narration per this doc's no-rewriting-history convention.

**Status header staleness + finding-label namespace ambiguity: CLOSED, with a fix-loop correction.** The
Status paragraph's "revised after seventeen rounds" framing was stale (the doc has since gone through
Round 26, soon 27), and five different finding-label conventions (v1 "C4/C5" through v5/v6 "H2"/"H6-G1")
are in use with no disambiguating note, including one bare "H2" leaked into normative body text. Fixed by
adding a paragraph after the frozen Round-17→18 status text explaining: the paragraph above it is
intentionally frozen as history; Rounds 24 onward are recorded in standalone disposition documents, not as
`### Round N` changelog entries; and the five label eras are not a global numbering scheme. **Fix-loop
correction**: the re-audit found the first draft was stale on arrival (it enumerated exactly three
post-Round-23 passes, and this pass is a fourth); reworded to name Round 27 too and — to avoid the same
staleness recurring every future round — added an explicit instruction to check
`docs/superpowers/specs/round-*-disposition.md` for the current list rather than trusting the
enumeration to stay exhaustive. Also qualified the leaked "H2" in normative text with a pointer to this
new disambiguation note.

**Round 17 changelog preamble tense: CLOSED (judged marginal).** The re-audit's honest assessment — which
this disposition accepts — is that no real defect existed here: "returned without enumerating those
children" was a faithful, timeless paraphrase of the cited API documentation, not a stale present-tense
claim about pipeline state. Applied a small, low-risk reword ("this round found that count is returned
without enumerating those children") to attribute the observation to the round that made it, at
essentially no cost, rather than leave the finding fully unaddressed.

---

## What was deliberately not touched

- H6-G1, H6-G2, H6-G3 (the three Highs from `invariant-audit-v6-geometry.md`, all scheduling/checkpoint
  findings) — re-verified already closed by an earlier pass (commit `eace98a`), not this pass's scope
  regardless.
- M6-G1 (extraction sibling-checkpoint coverage) — budget/scheduling territory, explicitly out of scope.
- The `CollisionInstance` capacity-check ordering item noted in `invariant-audit-v6-geometry.md`'s
  "confirmed unchanged" list — cache/concurrency territory, closed by Round 24's H-6C1; re-verified
  untouched.
- Post-weld degenerate (zero-area/collapsed) triangle handling, a Round-13 High deferred by explicit
  instruction at the time — checked and confirmed **not separately tracked by any invariant audit since
  v1** (v1 folded it into H-G1/H-G3, unit ambiguity and zero-triangle active range, both since resolved
  via the now-stabilized active-range/unit invariants). No standalone finding exists to close; no action
  taken.
- The Round-16 changelog bullet's own "compaction as a phase before the ceiling check" phrasing (a
  different, historical copy of the same ordering claim Cluster 1 fixed in the normative text) — left as
  historical narration per the doc's no-rewriting-history convention; the re-audit confirmed it
  self-corrects two lines later within the same bullet and creates no live contradiction.
- No second capacity mechanism, secondary cache, dedup store implementation, or new lifecycle/build-phase
  state was introduced anywhere in this pass. No ceiling value, phase order, ownership rule, or
  cancellation contract changed.

---

## Verification performed

1. **Re-verification against current spec before editing**: five parallel research subagents (one per
   invariant cluster) relocated and re-confirmed every finding at its current line location by direct
   read against the live 4581-line (pre-edit) file, not the audit document's stale 4446-line citations —
   the file had grown +135 lines since `invariant-audit-v6-geometry.md` was written, on top of further
   drift from Rounds 24-26.
2. **`node spike/fixtures.mjs`**: **55 passed, 0 failed**, both after the initial edit pass and again after
   the fix-loop corrections below. (As in prior rounds: this spike covers only geometry classification —
   `classifyPoint`, connectivity, containment, volume-overlap, surface-intersection — not the
   active-range/size-gate/oversized-marking/cancellation-signal prose this pass edited; a regression
   sanity check, not a direct test of this pass's changes.)
3. **Independent adversarial geometry Medium/Low re-audit**, dispatched as a fresh subagent (opus, no
   access to this editing session, instructed to be adversarial rather than to rubber-stamp the diff).
   Verdict: 12 of 15 findings CLOSED cleanly; 2 PARTIALLY CLOSED (the connectivity trigger-point pointer's
   ambiguous antecedent; the sweep-cost propagation's incorrect entry-count framing, flagged as a **new
   Medium-severity contradiction this pass itself introduced**); 1 judged NO DEFECT EXISTED (the Round 17
   tense reword, accepted anyway as low-cost). Also flagged two Low regressions (lost "skip the pair"
   wording; status note stale on arrival) and cosmetic line-wrap hygiene at four sites. All were fixed in
   one fix-loop round (below), confirmed via direct re-read against the file (not re-dispatched — the
   corrections were small, textually verifiable against content already quoted in the file itself, and
   did not warrant a second full re-audit pass).
4. **Fix loop (one round)**: corrected the sweep-cost-propagation contradiction (now correctly attributes
   the risk to live-epoch count on the `dispose()` path, not live-entry count, matching Round 25's own
   fixed table row — and extended the gate-criterion measurement requirement to match); disambiguated the
   connectivity trigger-point pointer by stating the rule directly instead of pointing at two antecedents;
   restored "skip the pair" to the narrow-phase oversized-handling text; reworded the status note to name
   Round 27 and stop assuming a fixed, enumerable count of future passes; cleaned up four minor line-wrap
   issues introduced by the initial edit pass.
5. Re-verified directly against current text (not the re-audit's word alone): the three protected
   Critical invariants for the geometry pipeline (`GeometryRecord` entry-lifetime cancellation ownership;
   active-range gating/compaction/weld/connectivity/BVH ownership and phase order; extraction's accepted
   atomic-risk boundaries) are intact; `surface-intersection` still skips connectivity and
   `containment`/`volume-overlap` still require it; geometry identity is still `(loadEpoch,
   geometryIndex)` with `modelId` metadata-only; no ceiling value, phase order, ownership rule, or
   cancellation contract changed anywhere in this pass's diff.

---

## Disposition

**0 Critical regressions. 0 High regressions.** All three protected Critical invariants for the geometry
pipeline are intact and were re-verified directly against current text, not assumed. H6-G1/G2/G3 remain
closed (confirmed, not re-litigated); M6-G1 and the cache-territory `CollisionInstance` capacity-ordering
item remain correctly out of this pass's scope.

**All in-scope geometry Medium findings: CLOSED** — compaction/ceiling-check ordering, `>=`/`>` boundary,
`L_X` provenance, connectivity trigger-point wording, oversized-diagnostic scope, oversized-marking gaps
(single-flight participation, marking ownership, dedup naming, vacuous sweep clause), cancellation-signal
universality wording, `world.dispose()`'s missing carve-out, and sweep-cost-row propagation (all three
sites now consistent).

**All in-scope geometry Low findings: CLOSED** — `referenceCount` completeness, status header staleness,
finding-label namespace ambiguity, "H2" normative-text leak, and the marginal Round-17 tense reword.

**Explicitly deferred, with concrete reason:**
- Post-weld degenerate-triangle handling — not tracked by any invariant audit since v1; no open finding
  exists to close.
- The Round-16 changelog's own historical restatement of the ordering claim Cluster 1 fixed — preserved
  as history per the doc's own convention; self-corrects within the same bullet, no live contradiction.

No second capacity mechanism, secondary cache, or new lifecycle/build-phase state was introduced. All
edits were prose corrections, cross-references, or (in one case, the `12_000`-exact-boundary case) one
new fixture bullet closing a previously untested ambiguity. No diff hunk touches phase ordering, ceiling
values, ownership rules, or the cancellation-signal mechanism itself.
