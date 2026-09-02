# Invariant-driven consistency audit — Round 4 (post-Round-20)

Type: invariant-model audit (not a Codex review round — no `codex-review spec` pass was run on the whole
document per explicit instruction).
Input: `docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md` (4017 lines, post-Round-20
Critical-only fix pass).
Prior work this audit checks: `docs/superpowers/specs/invariant-audit-v3.md` (Round 3, 1 Critical — C-5 —
found against the post-Round-19 3993-line spec) and `docs/superpowers/specs/round-20-critical-fix-pass-disposition.md`
(the fix pass that closed C-5 and lists what it deliberately left untouched).

**Method, replicating v1–v3's:** one agent (opus) built a fresh consolidated invariant model of the same
five systems **from the current post-Round-20 text**, written to `docs/superpowers/specs/invariant-audit-v4-model.md`
(kept as a separate working artifact). Five parallel agents then audited the full spec text against that
model, one system each, using v1–v3's own findings as a severity calibration reference and explicitly
distinguishing NEW from PRE-EXISTING at every finding. The model-build agent itself flagged three items
requiring adjudication (a fourth, previously-unnoticed dispose()-clear passage at line 2891 restating the
signal-rejection claim without an explicit oversized-marking carve-out; an intra-bullet tension in the
signal-lifetime paragraph itself; and the absence of a Round-20 changelog entry) — both the geometry and
cache-ownership auditors independently adjudicated the first two, each consulting `codex-advisor`
separately, and converged on the same conclusion. No spec edits were made in this pass.

---

# Critical

**None found.** C-5 (`invariant-audit-v3.md`) is closed. Two independent auditors — geometry
ownership/build pipeline and cache ownership/cleanup, each auditing from opposite sides of the same
release-path mechanism, each independently consulting `codex-advisor` — converged on the same answer to the
headline question this round existed to settle: **does a residual instance of C-5 survive the Round-20
fix?** Both concluded no. The two items the model-build agent flagged as candidates are real wording
imprecisions, reported as Medium below, but neither leaves an unsatisfiable literal contract for a
conforming implementer, which is the bar this lineage has held Critical to since C-4 and C-5 were rated by
it.

The reasoning, condensed from both independent adjudications:

- **Line 2891** ("...the clear rejects each entry's cancellation signal as it drops the entry") is not a
  self-contained universal claim like C-5's original defect was. "Each entry" is anaphorically chained to
  "the unresolved phase slots hanging off the registry's entries — whether... `'building'`... or... `'ready'`"
  two clauses earlier, which already restricts the domain to entries with unresolved phase slots — an
  oversized marking has none. A conforming implementation (reject the signal for `'building'`/`'ready'`
  entries; do nothing signal-related for an oversized marking) satisfies the literal wording. It is,
  however, the sole one of four dispose()-clear-describing passages in the document that lacks an explicit
  disclaimer sentence, and the Round-20 fix's own verification grep could not have caught it.
- **The intra-bullet tension at lines 1165–1193** (opens "Every registry entry carries one entry-scoped
  cancellation signal"; closes 17–19 lines later, same bullet, "This entry-lifetime signal is defined only
  for `'building'`/`'ready'` entries") self-resolves within the same bullet and the bullet immediately
  following it (which gives a full three-kinds taxonomy). A reader who reads the whole passage — which its
  density and cross-references invite — reaches a single-valued, implementable rule. A reader who stops at
  the opening sentence would not, which is the real defect here: an editorial one, not a specification one.

---

# High

Grouped by system. All confirmed PRE-EXISTING and unchanged from v1–v3 except where noted; every citation
was independently re-verified against current line numbers by the owning system's auditor (not carried
forward from any prior report), several cross-checked with `git diff HEAD` against the pre-Round-18
commit.

**Lifecycle**
- H-L1/H-L2 (`tearDown()`/`keepCurrentModels` never modeled), H-L4 (listener-registration timing unstated),
  H-L7 (two stale, unannotated disposal-rule Revision Notes entries), H-L8 (`unload()`'s ordering analysis
  addresses only one of two throw hazards) — all confirmed present, unchanged, untouched by Round 20 (which
  edited only geometry/cache-ownership territory).

**Query dependencies**
- H-Q1 (`anyComponentInside`'s caller list stated three incompatible ways), H-Q2 (containment guarantee's
  precondition unobtainable in `containment` mode), H-Q4 (connectivity trigger rule doesn't account for the
  target's independently-consumed parity-closure need), H-B4 (`SurfaceCrossingWitness` scheduling class
  stated two incompatible ways) — all confirmed present, unchanged.
- **H-Q-NEW-1** (Public API's "Requires... certified closed" hard-precondition wording, contradicting the
  `unverified-parity-operand` degrade-gracefully mechanism established everywhere else) — confirmed present,
  byte-identical, deliberately left unfixed this round per instruction.

**Synchronous-work / budget model**
- H-B5 through H-B9 (canonical checkpoint enumeration gap; `releaseEpochScopedState`/`dispose()`'s clear
  unclassified in the atomic-operations table; `bvhcast`'s own-start-vs-shared-accumulator clock ambiguity;
  the performance gate's own pass-criterion self-contradiction; the dangling instance-tree-readiness forward
  reference) — all confirmed present, unchanged. The Round-20 oversized-marking carve-out does add a real
  per-entry branch-cost to the release-path sweep, but since that entire sweep was already 100% absent from
  the atomic-operations table before Round 20 (H-B6), this is one more unmeasured cost inside an operation
  that was already wholly unmeasured — not a new gap, not a resolved one.
- `getChildCount` Revision Notes residue (two present-tense changelog entries asserting the removed
  preflight is current rule) — confirmed present, byte-identical, deliberately left unfixed this round per
  instruction. Severity reconfirmed High, matching v2's H-L7 precedent for the identical defect shape.

**Cache ownership**
- H-2/H-3 (the implied `CollisionInstance` cache — declared, owned, keyed, released nowhere) — confirmed
  present, unchanged, unaffected by Round 20.

---

# Medium

**Geometry / cache-ownership boundary (both NEW, both introduced by Round 20's own fix wording, both
converged-severity between the two independent auditors)**

- **The line-2891 residual restatement** (see Critical section above for the full reasoning): the sole one
  of four dispose()-clear descriptions in the document still relying on indirect anaphora rather than an
  explicit oversized-marking disclaimer. Recommend tightening to mirror the two already-fixed sites:
  "...and the clear rejects each such `'building'`/`'ready'` entry's cancellation signal as it drops the
  entry; an oversized marking carries no such signal and is simply removed."
- **The intra-bullet tension at lines 1165–1193**: the opening sentence should be narrowed to "Every
  `'building'`/`'ready'` registry entry carries one entry-scoped cancellation signal..." when read in
  isolation from the rest of its own bullet — a drafting/readability hazard for a skimming reader or anyone
  quoting the sentence out of context, not a specification-correctness hazard, since the bullet resolves
  itself in full.

**Geometry pipeline (PRE-EXISTING, confirmed unchanged)**
- Compaction/gate ordering header/body transposition (H-G2/H-G5).
- `>=` vs. `>` boundary wording at `maxSyncTriangleCount`.
- The oversized-marking registry entry's creator/single-flight-participation gap (M-3/M-G4).
- Connectivity trigger-point ambiguity (three unreconciled timings: state model declines to decide, Data
  Flow places it inline, a fixture shows a caller driving it later against an already-`'ready'` entry).

**Cache ownership (PRE-EXISTING, confirmed unchanged)**
- `dispose()` never states whether `liveModelByModelId` entries are removed (M-L4/L5).
- `evictModel`'s "nothing left to do" justification never mentions `liveModelByModelId` (M-1/M-G5).
- `dispose()`'s "wholesale-clears three caches" framing stale post-collapse into registry phase slots
  (M-2/M-G6).
- `dispose()` carries no explicit non-throwing requirement, unlike `releaseEpochScopedState`'s — sharper now
  given C-5's history, since the identical mechanism doesn't even violate a written invariant on this side
  (M-3/M-G7).
- "Sweeps `GeometryRegistry`" vs. "a synchronous map/set removal" — same operation, same paragraph
  (M-4/M-G8).
- Room cache has no stated release path on `world.dispose()` (SILENT-13).

**Synchronous-work / budget model (PRE-EXISTING, confirmed unchanged)**
- `frameBudgetMs = 8` vs. the gate's unqualified "~16ms tolerance band" (M-B4).
- Extraction's checkpoint fires only between siblings, never on descent (M-B5).
- Three-way clock-basis ambiguity for intra-loop checkpoints (M-B6).

**Query dependencies — audit-lineage completeness gap flagged, not a spec regression**
- **M-Q2** ("stage 2" overloaded across two different decompositions in the sentence carrying H-Q2's
  attempted repair) and **M-Q3** (`surface-intersection`'s inconclusive-result possibility undocumented in
  the mode table/Public API) are both confirmed still present in the spec, unchanged since v2 — but neither
  appears to have been carried into `invariant-audit-v3.md`'s writeup (grep for both finding IDs returns
  nothing there). This looks like a gap in the audit lineage's own record-keeping between v2 and v3, not a
  spec defect introduced by any fix pass. Flagged here so it isn't dropped a second time.

---

# Low

- **[Lifecycle, NEW]** No Revision Notes entry exists for "Round 20" — the changelog stops at Round 19,
  breaking the pattern Rounds 18 and 19 both followed. The Status header is now further stale (still
  references "seventeen rounds," names only `invariant-audit-v1.md`/`v2.md`, no mention of Round 19/20 or
  `invariant-audit-v3.md`). Confirmed via `codex-advisor` consult: report as one combined Low finding,
  distinct from H-L7 — this is an omission and a stale narrative, not a false present-tense technical claim
  that could misdirect an implementer about an operative rule (Round 20's disposition doc independently
  documents the fix).
- **[Geometry, PRE-EXISTING]** `referenceCount` declared once, never used.
- **[Sync-work, PRE-EXISTING]** Status/line-count drift in the Status header, further out of date at 4017
  lines with two more rounds unmentioned.
- **[Sync-work, PRE-EXISTING]** Worst-case-span formula stated before the performance gate section that
  establishes it — an ordering nitpick.
- **[Query, PRE-EXISTING, confirmed unchanged, not worsened]** The C-3 replacement wording's
  cross-reference indirection — correct but less direct than the old (wrong) prose it replaced; the fact is
  independently stated at 5 other sites.
- **[Cache, cosmetic]** Pseudocode variable-naming drift (`thisPromise` vs. "thisCall's own promise") for
  the same referent, unambiguous from context.

---

# Notes on scope and what was checked and found clean

- **No system found a second Critical.** The one question this round existed to answer — whether C-5
  survived its own fix — was answered independently by two auditors auditing from opposite sides of the same
  mechanism, using two separate `codex-advisor` consults, with the same conclusion: no.
- **All four originally-claimed Round-20 fix sites** (the signal-lifetime/oversized-marking-definition
  paragraph, `evictModel`'s `releaseEpochScopedState`, `dispose()`'s wholesale clear, the two new
  regression fixtures) verified internally correct and mutually consistent, independent of the two flagged
  residual-wording items.
- **Both v3 Highs deliberately left unfixed this round** (`getChildCount` changelog residue, Public API
  "certified closed" wording) confirmed present, byte-identical, exactly as instructed.
- **C-4 (Round 19, room-cache rejection semantics) re-confirmed clean**, no regression — Round 20's edits
  don't overlap that territory at all.
- **Every PRE-EXISTING High/Medium/Low finding from v1 through v3 was individually re-verified** against
  current line numbers by the relevant system auditor, several via direct `git diff` against the
  pre-Round-18 commit, not merely trusted from any prior report.
- **One audit-lineage housekeeping item surfaced**: M-Q2 and M-Q3 (present in v2, confirmed still present
  in the spec) appear to have been dropped from v3's own writeup rather than fixed — flagged above, not
  attributed to any fix pass.

---

# Answer to the specific question this round was run to settle

**No Critical invariant contradiction remains.** C-5 is closed. Two Medium-severity wording-precision items
remain from the fix itself (both are one-sentence tightening jobs, not redesigns) plus the full set of
already-known, already-deliberately-deferred High/Medium/Low findings carried across all four rounds. None
of the currently open High findings require another Critical-only fix pass — the design's five-system
invariant model has now gone two consecutive rounds (C-5's own introduction and this round's re-check)
without producing a second Critical, which is the strongest signal this lineage has produced yet that the
document's Critical-tier contradictions are exhausted, modulo whatever a future architectural change
introduces.
