# Round 31 — Implementation-planning blockers: disposition

Type: targeted fix pass, two implementation-planning blockers only (not a Codex review round — no
`codex-review spec` pass was run on the whole document, per explicit instruction). Source of truth: a
final comprehensive `codex-advisor high` review of the whole spec (see below), independently re-verified
against the current spec text before any edit was made. Target:
`docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md` (4842 lines before this pass;
`node spike/fixtures.mjs` 55/55 pass both before and after — this pass touches only prose/type
specification, no code, so the spike suite is unaffected either way and is run only as a regression
tripwire).

**Following the doc's own convention (see the Status paragraph near the top): this pass does not add its
own `### Round 31` changelog entry to the main Revision Notes section.** Rounds 24–30 established that
later High/Medium/Low cleanup passes are recorded only in their own standalone disposition document.

## Method

A `codex-advisor high` pass reviewed the whole document as a final pre-implementation-planning gate and
returned three High findings (no Criticals): (1) dbId provenance is lost before `groupBy: 'dbId'`
aggregation, (2) Milestone-1 model-replacement scope was left explicitly undecided
("neither is decided here"), and (3) instance-tree/geometry readiness at extraction time has no public-API
contract. Each finding was independently re-verified against the current spec text (not trusted from the
advisor's report) before being adjudicated:

- **Finding 1 (dbId provenance) — accepted as a real blocker**, and found to be more fundamental on
  inspection than the advisor's own framing: the pipeline never specified *any* mechanism for turning a
  raw fragment hit into a dbId, not only the multi-root-overlap case the advisor called out. Fixed below.
- **Finding 2 (model-replacement scope) — accepted as a real blocker.** The gap was already fully
  documented in the spec (Data Flow step 1 already contained a detailed, self-aware discussion of the
  `keepCurrentModels`/`tearDown()` mechanics), but the spec explicitly declined to choose an outcome. An
  implementation plan cannot be written for "the extension" without knowing which outcome is in scope.
  Fixed below, per explicit instruction: Milestone 1 does not support replacement.
- **Finding 3 (readiness) — rejected as a blocker, on review.** Unlike findings 1 and 2, this gap was
  already scoped correctly in the spec's own Risks section as "deferred to implementation — confirm
  against the official Reference Guide … not assumed here," the same pattern the spec already uses for
  provisional numeric constants. `world.admitModel` makes no readiness claim (pure epoch bookkeeping), so
  there is no contradiction to resolve, only an investigation to schedule. Demoted to an explicit
  implementation-plan research task (small clarifying edit only — see below), per instruction.

---

## What was fixed

### Blocker 1 — dbId provenance through aggregation

**Design chosen: a new call-local `ownerDbId` field, not a per-fragment set of requested dbIds.**

The self-driven extraction walk (Data Flow step 3) already visits the instance tree node-by-node and
calls `enumNodeFragments(node, cb, false)` at each node to collect *that node's own* direct fragments —
this was already the mechanism Round 16 introduced to replace the single recursive
`enumNodeFragments(dbId, cb, true)` call. Critically, at the exact call site where a fragment is yielded,
`node` **is** that fragment's true structural owner in the instance tree — a value that already existed in
scope, for free, before this pass. No new Viewer API call, no reverse-lookup mechanism, and no per-call
extra traversal were needed.

- Added `ownerDbId` to `PlacedCollisionInstance` (`{ instance, worldMatrix, worldBounds, ownerDbId }`) —
  **not** to the frozen `CollisionInstance`, which remains exactly `{ fragmentId, GeometryIdentity }` as
  stated verbatim elsewhere in the document. `ownerDbId` is structurally invariant per fragment (not truly
  "call-varying" the way a transform is), but it is produced by and only needed during one call's own
  extraction/aggregation, so it follows `worldMatrix`/`worldBounds` onto the call-local object rather than
  risk touching the heavily-hardened frozen-identity shape.
- Documented the case the spec itself already half-acknowledges — "a fragment id reported under more than
  one node costs the walk twice" (pre-existing text, kept for `maxFragmentsPerDbId` tally purposes) — and
  resolved it for `ownerDbId` with the same discipline the walk already uses for fragment identity itself:
  **first discovery wins.** This makes `ownerDbId`, and therefore which dbId group a fragment aggregates
  under, deterministic per call without requiring the design to assert real Viewer instance trees never
  report one fragment under two nodes.
- **Answers the two explicit questions the task posed:**
  - *Can a fragment belong to multiple requested-dbId groups?* No — it always aggregates under its one
    `ownerDbId` (first-discovered), regardless of how many of the call's requested dbIds could structurally
    reach it. This is a stronger, simpler answer than a per-fragment membership-set design would have
    given, and required no combinatorial expansion.
  - *What is the expansion from fragment-pair hit → requested dbId pair(s)?* 1:1, not a cartesian
    expansion: one fragment-pair hit maps to exactly one `(sourcePlaced.ownerDbId, targetPlaced.ownerDbId)`
    pair.
- Rewrote the aggregation bullet (Data Flow step 3) to specify: a call-scoped map keyed by the **ordered**
  pair `(sourceDbId, targetDbId)` — source/target order matters, matching `containment`'s directedness;
  first hit for a key publishes the `ClashPair`, later hits for the same key are dropped from `pairs[]`
  only (never from `ClashStatistics.diagnostics`, which remain fragment/pair-scoped via the same
  `ownerDbId` and are already independent of `pairs[]`); Milestone 1 does not populate the idea doc's
  optional `ClashPair.fragmentPairs`/`minimumDistance` fields, consistent with every other unpopulated
  idea-doc-optional field already in this milestone.
- Updated the Public API `groupBy: 'dbId'` comment and the `ClashPair`/`ClashStatistics` type-reuse note to
  state where `ElementRef.dbId`/`FragmentRef.dbId` actually come from — closing, as a direct consequence of
  the same mechanism, a second unstated gap noticed during this pass: `FragmentRef` (reused from the idea
  doc) already required a `dbId` for the existing fragment-scoped `ClashDiagnostic`s, and no site previously
  said where that value came from either.
- Added two new regression fixtures under Testing & Verification, next to the existing self-driven-walk
  coverage-equivalence fixture: (a) an ancestor+descendant dbId pair (mirroring the acceptance model's
  `2527`/`2530` family-node case) asserting `ownerDbId` names the child instance, never the requested
  ancestor; (b) the same fragment reachable from two requested roots on one side, asserting first-discovery
  capture and no overwrite; (c) one target dbId with two colliding fragments, asserting exactly one
  `ClashPair` in `pairs[]` while the narrow phase is still spied running twice (dedup collapses output, not
  collision work); (d) an ordered-key regression asserting `(dbIdX, dbIdY)` never merges with `(dbIdY,
  dbIdX)`.

### Blocker 2 — Milestone-1 model-replacement scope

Rewrote the "Scope of the model-identity apparatus" passage under Data Flow step 1 to replace "neither is
decided here" with an explicit decision, per direct instruction (no alternative scope considered):

**Milestone 1 does not support a Viewer model/document replacement after `RoomLocatorExtension`/
`CollisionWorld` has been established.** The acceptance path covers only the initially loaded, supported
model/session. Extension reload/re-registration and `CollisionWorld` reconstruction across a replacement —
via `keepCurrentModels`, an explicit unload+admit cycle, or another mechanism — are deferred to a later
milestone; this document does not choose among them and no Milestone-1 implementation work should attempt
to build one. All of the pass's own verified Viewer-behavior evidence (the `wwwroot/viewer.js` wiring, the
pinned 7.124.2 `tearDown()`/`unloadModel`/`BEFORE_MODEL_UNLOAD_EVENT` ordering) was kept unchanged — only
the concluding decision changed, not the facts backing it.

Added a matching bullet to **Milestone Scope**'s "Excluded (future milestones)" list (the document's
canonical top-level scope declaration) and to **Open Questions Deferred to Future Milestones** (recording
that *how* a later milestone achieves survival — not *whether* Milestone 1 does — remains open).

Explicitly stated, as its own paragraph, that this decision changes nothing about `world.evictModel`,
`world.dispose`, admission, or any race-safety mechanism for models admitted/evicted/disposed **within**
one supported (pre-replacement) session — per instruction, unload/eviction handling for the supported
lifecycle is untouched.

### Readiness item — demoted to an implementation-plan research task, not fixed as a blocker

Added one sentence to the existing Risks-section bullet ("Instance-tree completeness at extraction time is
unverified") stating explicitly that this is an implementation-plan research task — identify the concrete
Viewer readiness signal, then decide wait/reject/precondition — not a Milestone-1 design blocker, since the
choice among those three outcomes changes no mechanism already specified. Added a matching Open Questions
bullet for symmetry with the other two open items above. No mechanism, contract, or fixture was changed for
this item — per instruction, it was recorded, not resolved.

---

## Verification

- `node spike/fixtures.mjs`: 55/55 before, after the initial fix pass, and after the follow-up fix pass
  below (unaffected by prose/type edits — run as a regression tripwire, not because these edits touch
  code).
- A `codex-advisor medium` targeted consistency audit was run against the first version of the edited
  document, scoped strictly to: (1) whether Blocker 1 is closed, (2) whether Blocker 2 is closed, (3)
  Critical/High regressions introduced by these edits, and (4) whether the two fixes compose correctly
  with the directly-affected protected invariants. It returned **three High-severity problems**, all
  self-inflicted by this pass's own first-draft edits (no Critical regressions, and no contradiction with
  `(loadEpoch, geometryIndex/fragmentId)`, the frozen `CollisionInstance`, the five-step admission
  sequence, or the shared `frameBudgetMs` checkpoint — the aggregation algorithm itself was found sound;
  only its regression fixture and its cross-call scoping claim were not):
  1. The new `ownerDbId` prose claimed unconditional cross-call stability ("the same value on every call
     that captures it") immediately next to a first-discovery-wins rule for the multi-node edge case that
     the document never establishes is stable across separate calls — an internal contradiction.
  2. The "ordered dbId-pair dedup" regression fixture's own setup and asserted outcome couldn't both hold
     (it described operands as "swapped" and then, in the same sentence, as "the same direction").
  3. The pre-existing Error Handling bullet for `world.evictModel`'s `ModelEvictedError` still used "the
     user loads a different model into the same slot" as its example — which the newly-decided Blocker-2
     scope makes wrong: that path now goes through `tearDown()`/`unload()` and produces
     `WorldDisposedError` before the outgoing model's own unload event can reach a still-registered
     extension, per the very passage this pass had just rewritten.
- Each finding was independently re-verified against the current spec text (line numbers, exact wording)
  before being accepted — all three held up. Fixed by: (1) scoping the cross-call-stability claim to the
  ordinary single-owner case and explicitly declining to claim it for the multi-node edge case; (2)
  rewriting the fixture as two distinct fragment-pair hits with genuinely reversed `(sourceDbId,
  targetDbId)` attribution, asserting two separate, unmerged `ClashPair`s; (3) rephrasing the
  `ModelEvictedError` bullet's example around the library's general mid-session eviction mechanism (still
  valid and still needed for its own extensive fixture suite) and explicitly cross-referencing the
  Disposal-mid-query bullet for what this app's own model-replacement path actually produces.
- A second `codex-advisor medium` pass, scoped narrowly to just these three re-edits (not a new
  comprehensive review), confirmed all three **fixed**, with no remaining self-contradiction and no new
  issue introduced by the fix-up itself.

## Final disposition

- **Blocker 1 (dbId provenance through aggregation): closed.**
- **Blocker 2 (Milestone-1 model-replacement scope): closed.**
- **Critical regressions introduced by this pass: none**, at any stage.
- **High regressions introduced by this pass: three, all self-inflicted by this pass's own first-draft
  edits (not present in the spec before this pass began) and all fixed within this same pass** — see
  above. Zero remain.
- **Readiness item: recorded as an implementation-plan research task, not resolved as a blocker, per
  instruction.** Not in scope for closure.
- **Overall: the spec is ready for implementation planning.** Both of the two identified
  implementation-planning blockers are closed, no Critical or High regression remains open, and
  `node spike/fixtures.mjs` passes 55/55 against the final text.
