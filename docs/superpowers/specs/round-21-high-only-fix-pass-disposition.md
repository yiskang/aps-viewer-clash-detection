# Round 21 — High-only invariant cleanup pass: disposition

Type: system-level fix pass, High findings only (not a Codex review round — no `codex-review spec` pass
was run on the whole document, per explicit instruction). Source of truth:
`docs/superpowers/specs/invariant-audit-v4.md`'s High section. Target:
`docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md` (3987 lines before this pass —
4017 post-Round-20 minus prior read overlap accounted for by `git diff --stat`: 229 insertions / 30
deletions net this pass, 4216 lines after).

Method: four research agents (forks, sharing this session's context), one per system group (lifecycle,
query semantics, synchronous-work/budget model, cache ownership — geometry pipeline had zero confirmed
open Highs per `invariant-audit-v4.md`, so no group was needed there), ran in parallel. Each re-verified
its findings against the *current* spec text (not trusted from the audit report), drafted exact edits, and
reported back without touching the file — edits were applied centrally, afterward, by the coordinating
session, to avoid collisions where two groups' edits landed near the same shared text (the Revision Notes
changelog area, and `world.dispose()`'s pseudocode block). One group (lifecycle) paused mid-task on its own
backgrounded `codex-advisor` consult for the H-L1/H-L2 fix; the coordinator polled for and relayed that
response, which caught a factual error in the group's first draft (see below) before the group produced
its final report.

## What was fixed

**Lifecycle (H-L1/H-L2, H-L4, H-L7, H-L8).**

- **H-L1/H-L2 — `tearDown()`/`keepCurrentModels` never modeled.** The first draft claimed a fresh
  extension instance gets constructed on a model switch; `codex-advisor` caught this as false — this
  app's `wwwroot/viewer.js` registers extensions once, in `config.extensions` at `viewer.start()`, and
  never re-registers after `tearDown()` unloads them. Revised paragraph, inserted into **Data Flow** step
  1, states the accurate result: under this app's current wiring, `RoomLocatorExtension` does not survive
  a second model load at all — a Milestone-1 application-wiring gap, not a defect in the
  `modelLifecycle`/`loadEpoch` identity apparatus, which is explicitly scoped to "while one instance is
  alive" (its actual, still-Critical-protected role). Left the reload-vs-unsupported product decision
  open rather than deciding it. Companion edit narrowed the stale Open Question at the end of the doc
  ("every race-safety guarantee depends on the event firing") to exclude the `tearDown()`-driven path,
  where `world.dispose()`'s own terminal flag — not the per-model event — is what makes in-flight work
  safe.
- **H-L4 — listener-registration timing unstated.** `load()`'s class-sketch comment now states its
  await/registration-ordering contract: the unload listener and context-menu item are registered only
  after `CollisionWorld.fromViewer()` resolves, inside the same call, so no consumer can observe a
  registered listener referencing a not-yet-constructed world.
- **H-L7 — two stale, unannotated disposal-rule Revision Notes entries.** Annotated the Round 12 and
  Round 14 entries (both claiming a single-exception non-throwing rule, superseded when Round 18 added
  `evictModel` as a second exception) with the doc's existing superseded-annotation convention, rather
  than rewriting history.
- **H-L8 — `unload()`'s ordering analysis addressed only one of two throw hazards.** Added the second: a
  repeated `unload()` call re-invokes `world.dispose()`, which is guaranteed to throw
  `WorldDisposedError` on a second call, stranding listener/context-menu removal and the room-cache clear
  for that invocation — swallowed by `Viewer3D.tearDown`'s per-extension try/catch, the same "benign only
  because something else catches it" shape as the first hazard.

**Query semantics (H-Q1, H-Q2, H-Q4, H-B4, and the Public API "certified closed" wording deferred since
Round 19).**

- **H-Q1 — `anyComponentInside`'s caller list stated three incompatible ways.** Fixed the two stale
  restatement sites (one omitted `ContainmentModeQuery` as a caller, one falsely claimed "used by every
  mode") to cross-reference the one canonical enumeration under `ThreeMeshBvhBackend`/`BlasCache` rather
  than restating it.
- **H-Q2 — containment guarantee's precondition unobtainable in `containment` mode.** Restated the
  precondition as the logical fact both modes independently establish ("no proper crossing exists"),
  rather than naming only `VolumeOverlapQuery`'s `ProperCrossingQuery` mechanism as if it applied
  universally.
- **H-Q4 — connectivity trigger rule's own rationale didn't explain the target's independently-consumed
  parity-closure need.** Added the missing half of the rationale: `containment`'s parity-closure
  precondition reads a cached manifold-classification flag off the target's `GeometryConnectivity`,
  independent of `anyComponentInside`'s source-side decomposition — so both operands go through the
  connectivity gate, not only the operand(s) sampled.
- **H-B4 — `SurfaceCrossingWitness` scheduling class stated two incompatible ways.** Resolved in favor of
  the mechanically-correct description (verified against its own definition and the per-call-checkpoint
  passage): a plain JS loop with per-call checkpoints, not a shared `bvhcast` traversal.
- **Public API "Requires... certified closed" wording (deferred in Rounds 19/20, fixed now).** Rewrote
  both mode comments from a hard precondition to the actual contract verified elsewhere in the doc:
  soundest when certified closed, degrading gracefully via `unverified-parity-operand`/
  `unverified-open-component` diagnostics otherwise — consistent with the fixture requiring an
  open-target `containment` call to run and return a diagnosed result, not reject.

**Synchronous-work / budget model (H-B5 through H-B9, and the `getChildCount` changelog residue deferred
since Round 19).**

- **`getChildCount` Revision Notes residue.** Annotated the Round 16 and Round 17 entries (both
  present-tense-asserting the removed preflight is current rule) with the doc's superseded-annotation
  convention, pointing at the canonical current statement that `getChildCount` is not one of the walk's
  primitives.
- **H-B5 — canonical checkpoint enumeration gap.** Named the broad-phase scan's own per-pair checkpoint
  (added by Round 18) in the enumeration that an implementer builds the scheduler from.
- **H-B6 — `releaseEpochScopedState`/`dispose()`'s clear unclassified in the atomic-operations table.**
  Three-part fix: (a) new table row classifying the sweep as a second accepted, unmeasured
  non-preemptible atomic risk alongside `enumNodeFragments`; (b) threaded that exclusion into the
  worst-case-span formula's own honesty statement; (c) added a performance-gate measurement bullet
  requiring it be measured from both `evictModel` and `dispose()` call sites.
- **H-B7 — `bvhcast`'s own-start-vs-shared-accumulator clock ambiguity.** Fixed the actual mechanism, not
  just the sentence: the time-based abort trigger now reads the shared per-call `performance.now()`
  accumulator every other checkpoint reads, not a private clock local to the traversal — closing a real
  up-to-~2× overshoot gap against the ~16ms budget that a private clock would have permitted. Flagged as
  an observable-behavior change (a `bvhcast` call can now abort sooner if the shared budget is already
  nearly spent), not a Critical-invariant change.
- **H-B8 — performance gate's own pass-criterion self-contradiction.** Named the exact two rows (one
  `enumNodeFragments` call, the release-path sweep) the gate's pass criterion now excepts, matching what
  H-B2's rewrite and H-B6(b) already accept as out-of-guarantee — no new exceptions invented.
- **H-B9 — dangling instance-tree-readiness forward reference.** Gave both "(see Risks)" pointers a real
  target: an honest statement that instance-tree completeness at extraction time is unverified, with no
  invented Viewer API — deferred to implementation-time verification against the official Reference
  Guide, matching the constraint against inventing Viewer guarantees.

**Cache ownership (H-2/H-3).**

- **The implied `CollisionInstance` cache — declared, owned, keyed, released nowhere.** Declared the cache
  (keyed per `(loadEpoch, fragmentId)`, mirroring `GeometryRegistry`'s epoch-based keying) once, and
  threaded its release into both existing sweeps (`evictModel`'s `releaseEpochScopedState`, `dispose()`'s
  wholesale clear) by cross-reference rather than a standalone disclaimer — the same structural fix shape
  Round 14 used for the `modelId`-vs-`loadEpoch` keying gap. Also resolved, in the same edit, an
  identified tension between the per-call world-matrix/bounds "snapshot" language and the cache's
  cross-call persistence requirement: a cache hit re-captures current transform values at the start of the
  call reusing it, so the per-yield mixed-state guarantee is preserved.

**Changelog.** Added a Round 21 Revision Notes entry (after Round 19's — Round 20 has no entry, a
pre-existing Low finding from `invariant-audit-v4.md`, out of scope for a High-only pass and left
untouched) summarizing all four groups' fixes and their disposition.

## What was deliberately not touched

Per explicit instruction:

- **M-Q2/M-Q3** and the v2 audit-record gap note about them — untouched, not fixed, left exactly as flagged
  so the gap-note itself isn't lost a second time.
- **The two Round-20 wording Mediums** (the line-2891-region signal-lifetime residual restatement, and the
  intra-bullet tension in the entry-lifetime cancellation-signal paragraph) — byte-identical, confirmed
  unedited by grep after this pass.
- **Every other Medium/Low finding from `invariant-audit-v4.md`** not named above (compaction/gate
  ordering transposition, `>=`/`>` boundary wording, oversized-marking creator/single-flight gap,
  connectivity trigger-point three-way ambiguity, `liveModelByModelId` cache-ownership gaps, room-cache
  release-path gap (SILENT-13), `frameBudgetMs`/tolerance-band wording, extraction's sibling-only
  checkpoint gap, three-way intra-loop clock-basis ambiguity, `referenceCount` dead field, Status-header
  staleness, worst-case-span-formula ordering nitpick, pseudocode variable-naming drift).
- **No Critical invariant was reopened.** Verified by construction: every edit either corrects a
  caller-list/scheduling-class/changelog misstatement, narrows an overclaim to match an already-true
  mechanism, or adds a cross-referenced declaration for previously-undeclared but already-implied state
  (the `CollisionInstance` cache's ownership/keying/release). None touch Model-object identity/
  `loadEpoch`, disposed-first checkpoint semantics, `GeometryRecord` cancellation ownership, active-range
  gating/compaction/weld/connectivity/BVH ownership, extraction's accepted atomic-risk boundaries, or the
  mode dependency matrix.

## Verification

`node spike/fixtures.mjs` — **55/55 pass**, both before this pass began and after all edits landed. As
with every prior round's disposition doc, this is expected and not strong evidence on its own: this pass
edited only the spec's prose, and `spike/*.mjs` is a standalone algorithm prototype the spec's fixtures
describe but don't execute.

## Addendum — third `dispose()` clear-description site missed on first pass

The `invariant-audit-v5-model.md` build step (first stage of the required follow-up audit) found that this
pass's H-2/H-3 fix missed a third restatement of `dispose()`'s wholesale clear, at what was then lines
3032–3034 (in the "Disposal mid-query" prose, distinct from the two pseudocode-block sites already fixed):
it still listed `GeometryRegistry`/`BlasCache`/`GeometryConnectivity` without the newly-declared
`CollisionInstance` cache. Fixed immediately, same pattern (cross-reference to the canonical declaration,
not a restated list) — `node spike/fixtures.mjs` re-run, still 55/55. A full sweep for the same phrase
pattern across the rest of the document found one further occurrence (a Round-14/15-era changelog entry at
~line 414) describing historical state at the time of that round's fix, not a live present-tense contract
claim — left untouched, consistent with this doc's own established annotate-don't-rewrite convention for
historical Revision Notes entries.

## Next step — superseded by the v5 audit and its own remediation pass

A fifth invariant-driven audit, using the same five-system model methodology `invariant-audit-v1.md`
through `invariant-audit-v4.md` were built against, ran and produced `docs/superpowers/specs/invariant-audit-v5.md`.
It found **zero Critical regressions** but **five High-severity regressions this pass's own fixes
introduced** (a `SurfaceCrossingWitness` scheduling-class fix that picked the wrong mechanism; a
`CollisionInstance` cache release/mutability/growth design with three converged problems; a `bvhcast`
clock-basis fix that traded a non-violation for a scheduling-dependent nondeterminism regression; and an
uncited Viewer-behavior claim) plus one pre-existing, previously-unflagged High unrelated to this pass's
edits. All five self-inflicted regressions were fixed within this same session, before `invariant-audit-v5.md`
was finalized — see that document's own Remediation section for the full account, including two
`codex-advisor` consultations, one subagent-run Viewer-evidence investigation against the pinned 7.124.2
bundle, and the final spec state (4345 lines, `node spike/fixtures.mjs` 55/55 both before and after). The
one pre-existing High (a worst-case-span-formula soundness gap, unrelated to any Round-21 edit) is
deliberately deferred to a future round, with rationale recorded in `invariant-audit-v5.md`.
