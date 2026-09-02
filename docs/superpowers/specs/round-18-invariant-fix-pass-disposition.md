# Round 18 — Invariant-driven system fix pass: disposition

Type: system-level fix pass (not a Codex review round — no `codex-review spec` pass was run on the whole
document per explicit instruction). Source of truth: `docs/superpowers/specs/invariant-audit-v1.md`.
Target: `docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md` (3303 lines before this
pass, 3851 after — 684 insertions / 133 deletions net).
Method: three parallel drafting agents (opus), one per invariant cluster, each re-verified relevant Viewer
API/source claims (via the `viewer-extension-lifecycle-audit`/`aps-viewer-implementation-research` skills
and direct inspection of the pinned 7.124.2 bundle) and consulted `codex-advisor` on judgment calls per
standing instruction. Agents drafted proposed patch text only — the coordinating session applied every
edit, verifying each quoted "current text" against the live file before applying, and hand-merged the two
spots (the `evictModel` and `dispose()` doc blocks) where the lifecycle and geometry clusters both needed
to touch the same paragraph. See the new "Round 18" Revision Notes entry in the spec itself for the
in-document summary; this file is the fuller working record.

## What was fixed

**Lifecycle/teardown cluster** — C1, C2, H-L5, H-L6:
- **C1**: the "Disposal mid-query" paragraph (Error Handling) still described pre-round-15 mechanics.
  Rewritten to state round 15's actual mechanism: `disposed` set first and synchronously; a resumed query
  rejects `WorldDisposedError`, not `ModelEvictedError`; correctness never depends on tombstoning every
  model.
- **C2**: `evictModel`'s own contract was silent on disposal while two other passages listed it as
  throwing `WorldDisposedError` after disposal. Re-verified against the pinned 7.124.2 bundle
  (`viewer3D.js`, sha256 `12b9fe49f41dc99ccec62535e5c887da915980829da2e941cfe4da3d7197c02e`) that
  `dispatchEvent` has no try/catch and a throw here aborts `unloadCurrentModel`'s teardown loop for every
  remaining model, skips `removeModel` for the throwing model itself, and skips `this.model = null`.
  Fixed by making `evictModel` a second deliberate non-throwing exception (`isLeaseValid` is the first):
  it checks `disposed` first and returns as a no-op, never throws. Every "throws WorldDisposedError"
  method list in the spec was updated to remove `evictModel` and explain both exceptions together.
- **H-L5**: `locateElementByRoom`'s room-search callbacks collapsed disposed-vs-evicted to
  `ModelEvictedError` always, contradicting the class-sketch's `WorldDisposedError`. Fixed: the callback
  now calls `isModelLive` inside a `try`/`catch` to derive the actual cause once `isLeaseValid` returns
  `false`, and both the success and error callbacks use the same mapping.
- **H-L6**: `ContainmentQuery`'s local checkpoint wording (and two propagated sites) re-checked only the
  load epoch, omitting the `disposed`-first half of the universal two-part protocol. Fixed to match the
  correctly-updated sibling site (line ~917 pre-pass).
- Directly-dependent teardown-ordering note added: since `evictModel` is now a no-op on disposal, the
  `unload()` ordering hazard (`dispose()` before listener removal) is benign as a side effect — noted, not
  a full H-L3 fix (isolation/ordering redesign remains open, see Residuals).

**Geometry build / cache publication cluster** — C3, H-G1:
- **C3**: the "publish only once every phase completes" rule was mutually exclusive with `BlasCache`'s
  claimed concurrent-build dedup and with `evictModel`/`dispose()`'s promise to reject every in-flight
  build promise. Fixed at the ownership-model level: a `GeometryRecord` now publishes to `GeometryRegistry`
  with `buildState: 'building'` when its build *starts*; each phase (weld, connectivity, BVH) is a
  single-flight promise slot on that entry; concurrent callers share the entry instead of duplicating
  work; `'ready'` (weld+BVH resolved) is mode-independent and record-level, matching the mode-dependency
  table (`surface-intersection` never needs connectivity; `containment`/`volume-overlap` do); a rejected
  phase removes the entry synchronously so no half-built record is ever observable; `evictModel`/
  `dispose()` reject in-flight builds via an entry-scoped cancellation signal every unresolved phase slot
  races.
- **H-G1**: `TriangleRange.count` (from `groups[].count`/`drawRange.count`/`indices.length`) is an
  index-element count, but the spec compared its raw sum directly against `maxSyncTriangleCount` (a
  triangle count) with no `/3` conversion anywhere in 3300 lines — a ~3× stricter ceiling than intended.
  Verified against `spike/measure.mjs`/`spike/geometry-core.mjs`, which do use `index.count/3` and
  `index.length/3` respectively. Fixed by defining `activeTriangleCount := Σ floor(ranges[i].count / 3)`
  and using it at every comparison site (the size-gate definition, the narrow-phase Data Flow step, Error
  Handling, the round-16 revision note, and the fixtures — including a new fixture pinning the unit
  boundary on both sides).

**Extraction cluster** — C4, C5, H-B1, H-B2:
- **C4**: `ViewerModelAdapter`'s own component contract still specified the recursive
  `enumNodeFragments(dbId, cb, true)` call rounds 16–17 declared Critical and removed elsewhere. Replaced
  with the self-driven walk, plus an explicit coverage-equivalence argument (verified against the pinned
  bundle's `enumNodeInstances` implementation, which the recursive form delegates to) for why the walk's
  per-node union of non-recursive `enumNodeFragments` calls equals what one recursive call would have
  produced — conditioned on two things stated explicitly: the walk completing without truncation, and a
  complete instance-tree snapshot to walk (the latter is H-G4's territory, not closed by this fix — see
  Residuals).
- **C5**: round 17's `getChildCount` preflight was credited with catching a pathological fanout but never
  compared its result to anything. Fixed with a provisional `maxChildrenPerNode = 10_000`, enforced two
  ways: `getChildCount` as a cheap early reject (re-verified against the pinned bundle: O(1) only for a
  fragment-free node, Θ(children) for a mixed node — round 17's flat "O(1)-shaped" claim was too strong),
  and an in-callback abort inside `enumNodeChildren` itself (the Reference Guide's documented
  truthy-return enumeration interrupt, confirmed at two traversal layers in the bundle). Either tripping
  rejects the whole `findClashes` call by name, the same mechanism `maxFragmentsPerDbId` already uses —
  not a new `ClashDiagnostic`, so a fanout truncation can never present as a clean empty result.
- **Consequential correction surfaced by C5's re-verification**: round 17's own stated justification for
  treating one node's direct `enumNodeFragments` call as unboundable — "no fragment-count equivalent to
  `getChildCount` exists, and neither class documents a way to interrupt an enumeration" — is factually
  wrong. `ObjectTree.getInstanceCount(dbId)` (alias `getFragmentCount`) is documented, and the same
  truthy-return interrupt used to fix C5 is documented for `enumNodeInstances`, which `enumNodeFragments`
  aliases. **The accepted-atomic-risk classification is retained unchanged** — bounding it was out of this
  pass's scope — but every place the spec stated round 17's now-refuted justification was corrected to
  say the risk is unbounded *by choice of scope*, not by API limitation, and flagged for a follow-up pass.
- **H-B1**: `maxBroadPhaseInstancePairs = 1_000_000` bought ~1,000ms of uninterruptible work (~60× the
  gate's own ~16ms criterion) with no inner checkpoint — the single largest synchronous span in the
  design. Fixed by chunking: the scan now checks the shared `frameBudgetMs` accumulator before each
  individual instance pair and yields/resumes mid-scan, at round 11's per-primitive granularity (not
  batched, to preserve the existing one-atomic-operation overshoot bound) — preferred over merely
  shrinking the constant, which wouldn't fix "uninterruptible while claiming frame-scale bounds" for a
  genuinely large scene. The ceiling itself is retained, unlowered.
- **H-B2**: round 17's worst-case-span formula (`max(frameBudgetMs + ..., one build-phase's own cost)`)
  silently ranged over the ceiling-less `enumNodeFragments` atomic-risk row as if it were bounded. Fixed:
  the formula is now explicitly scoped to the cooperative-composition tier only, with the unbounded row
  explicitly excluded from any finite worst-case-span guarantee.

**Standalone (H-Q3, applied directly, no drafting agent needed)**: the Public API's `containment`
description restated the exact "any part of the source lies inside the target's interior" wording round 8
identified as wrong and round 8 rejected — the normative mode table and the directedness fixture both use
the surface-only reading. Fixed to match.

## What was deliberately not touched

Per explicit instruction: no other remaining High/Medium/Low findings from `invariant-audit-v1.md` were
fixed in this pass, and no new architecture was introduced beyond what the five invariants above required.
Notably still open: M1 (connectivity eager-vs-lazy trigger point), H-L1–H-L4 (`tearDown`/
`keepCurrentModels` trap, listener-registration timing), H-G2–H-G4 (compaction-ordering header/body
transposition, zero-triangle silent negative, instance-tree completeness), H-Q1–H-Q2 (caller-list staleness,
unobtainable containment precondition), H-B3–H-B4 (diagnostic-code duplication, `SurfaceCrossingWitness`
scheduling class), H-C1 (cache key statement), and the full Medium/Low list.

## Residuals surfaced during this pass (flagged, not fixed — carried forward to the v2 audit)

**From the lifecycle cluster:**
- Room-cache deletion is inconsistent pre-existing: one passage says a rejected room-search promise is
  deleted from the cache so the next call retries fresh; the invalid-lease branch says "leave the cache
  untouched." Preserved as-is (new finding, touches M5, not this pass's to fix).
- H-L3 (per-step teardown isolation, `unload()` step ordering) is not fully fixed — only the specific
  hazard this pass's C2 fix happens to neutralize is noted; the broader ordering/isolation question (should
  the listener be removed before `dispose()`? per-step try/catch?) remains open.
- L5 (`dispose()` never clears `liveModelByModelId`, the one strong-reference cache in the set) — raised
  independently by `codex-advisor` during the lifecycle draft, not fixed (touches the geometry cluster's
  `dispose()` block).
- M10 (whether `dispose()` may be called independently of `unload()`) still unstated.
- H-L1/H-L2 (`tearDown()`/`keepCurrentModels` trap) and H-L4 (listener-registration timing, `load()`
  awaiting `fromViewer()`, rollback on failed construction) untouched.

**From the geometry cluster:**
- M1 (connectivity eager-per-mode vs. lazy-on-genuine-consumption) remains open by design — the new
  `buildState` model is deliberately agnostic about when the connectivity slot is created, only about what
  happens once it exists.
- What happens if connectivity fails for a non-lifecycle reason on an already-`'ready'` record remains
  undefined (only lifecycle-triggered rejections are covered by the new model).
- M4 (oversized records vs. the publication rule, gate enforced by two actors) only half-neutralized — the
  oversized case is now a well-defined third registry-entry kind, but the gate is still enforced in two
  places.
- M3 (welded/compacted buffer's release path) partially touched — it now has a named field (`weldPromise`)
  but no release path beyond "the entry is dropped."
- L2 (`referenceCount` declared once, never used) — left as dead per `codex-advisor`'s read that C3's model
  doesn't need it.
- H-G2 (compaction-vs-gate ordering, round-16 header vs. body transposition) not fixed; the C3 rewrite
  preserves the existing (correct) body+fixture ordering without restating or worsening the header
  mismatch.

**From the extraction cluster:**
- Round 17's own justification for the row-3 accepted atomic risk (one node's `enumNodeFragments` call) is
  refuted by direct source inspection (see above) — the risk **could** now be bounded with the same two
  mechanisms C5 uses, one call over. Actually bounding it is a required follow-up pass, explicitly out of
  this one's scope.
- `InstanceTree === ObjectTree` literally in the pinned bundle (`viewer3D.js:148981`), under
  `Autodesk.Viewing.Private.*` with a deprecation JSDoc; the official Reference Guide's `InstanceTree` page
  documents zero methods. Every "verified on both `InstanceTree` and `ObjectTree`" claim in the spec (and
  in `invariant-audit-v1.md`) is one verification presented as two, and the whole extraction contract sits
  on a `Private.*` surface. Wider than the audit's existing "Positive / resolvable this pass" note on
  `getInstanceTree()`/`getObjectTree()`; not fixed here.
- H-G4 is now load-bearing for C4's coverage-equivalence claim (which explicitly conditions equivalence on
  "a complete instance-tree snapshot") but the spec has zero occurrences of `isObjectTreeCreated`/
  "instance tree readiness" anywhere — the forward reference to **Risks** that C4's fix adds currently
  points at nothing.
- M8 (extraction checkpoints fire only between siblings, never on descent) untouched; C5's new "collect
  children, then descend after the call returns" phrasing makes a future fix easier but doesn't perform it.
- M2 and invariant-model §4 rows 20–21 (`releaseEpochScopedState`/`dispose()`'s wholesale-clear cost)
  remain unclassified in the atomic-operations table.

## Verification

`node spike/fixtures.mjs` — **55/55 pass**, both immediately before this pass began (baseline) and after
all edits landed. This is expected and not strong evidence on its own: the fix pass edited only the spec's
prose (Milestone 1 has no implementation yet), and `spike/*.mjs` is a standalone algorithm prototype the
spec's fixtures describe but don't execute. It confirms the pass didn't touch or destabilize the one
executable artifact in the repo; it does not exercise any of the five Critical fixes, which live entirely
in normative spec text pending implementation.

## Next step

A second invariant-driven audit, using the same five-system model `invariant-audit-v1.md` was built
against, is being run now against the post-Round-18 text, producing `invariant-audit-v2.md`. Findings from
that audit — including whether any of the fixes above introduced a new inconsistency, and the residuals
listed here — will be reported separately, Critical contradictions distinguished from High/Medium/Low.
