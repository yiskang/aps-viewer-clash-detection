# Collision Library Milestone-2 Design — Federated Clash Finder

Status: **DESIGN SPEC — not an implementation plan.** No code is changed by this document.

Scope: extend the Milestone-1 (M1) collision library — already implemented, accepted, and packaged
as a reference library (see `docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md`,
`docs/superpowers/specs/collision-library-m1-release-packaging-disposition.md`) — to support a
federated, cross-model "Find Clashes" workflow, per
`docs/prompts/collision-library-milestone2-design-prompt.md`.

Every claim about M1's actual current behavior in this document is sourced directly from the landed
code (`collision/*.js`) and its own comments, not from the M1 design spec's original intent where the
two have drifted (the M1 release-packaging task already found and fixed several such drifts). File:line
references point at the current `main` branch as of this writing.

**Revision note.** This version incorporates fixes from an independent `codex-review spec` pass
(medium effort) run against the first draft. Five findings were CONFIRMED against source and applied
directly (§3.5, §4.4, §5.1-§5.2, §6.1-§6.6, §7.1a, §9.2, §11, §15 all changed as a result — see the
inline "review fix" notes at each site); the review's remaining findings on candidate-budget semantics
and statistics-field granularity are recorded as open items in §15 rather than resolved here.

**Second revision note.** This version additionally incorporates a targeted design-resolution pass
scoped to exactly three previously-open blockers: model-alignment/model-transform TLAS invalidation
(§6.5, new §6.7, §9.2, §10), TLAS candidate-budget semantics (new §9.3, plus a correctness fix to
§7.1a's target-scope filter), and finalized `Statistics` field semantics for the TLAS path (new §7.5).
This pass was itself independently reviewed by a `codex-advisor` (high effort) consult before being
written into this document; see
`docs/superpowers/specs/collision-library-m2-targeted-design-resolution-disposition.md` for the full
disposition, including one genuine correctness bug this pass found and fixed in already-accepted text
(§7.1a's target-scope filter incorrectly compared a TLAS-matched primitive's `ownerDbId` directly
against the caller's requested `dbIds`, which silently produces false-negative exclusions for any
`targets` entry whose requested dbId is an assembly root — exactly the same `ownerDbId`-vs-requested-
dbId mismatch §4.4 already documents for source self-exclusion, just not yet applied to the target-side
filter).

---

## 1. M2 goals and non-goals

### Goals

- A user can select one element in the Viewer, right-click, choose **Find Clashes**, and get every
  **Hard Clash** (`volume-overlap` mode) between that element and any other element across all
  currently loaded Viewer models — same model and federated models alike — with the source excluded.
- Candidate discovery scales sublinearly (in practice) for realistic federated/fragment-dense
  scenarios via a new broad-phase acceleration layer (**TLAS**) above M1's existing per-geometry BVH
  (**BLAS**), while M1's linear AABB scan remains available as a correctness oracle and fallback.
- Every M1 lifecycle, identity, and error-contract invariant that does not need to change to support
  federation is preserved exactly. Section 16 is the explicit ledger of what changes and what doesn't.

### Non-goals (verbatim from the M2 prompt; restated here as the spec's own boundary)

Soft Clash / `clearance` queries and configurable clearance distances; penetration volume; CSG result
geometry; GPU collision; physics/continuous collision; a custom BVH implementation (see §5 for why
none is needed); a worker/off-main-thread rewrite without benchmark justification; a full
clash-management dashboard/workflow; Milestone-3 coordination semantics; general Viewer
document-replacement continuity (only the specific federated-query behaviors this spec defines are
in scope); Viewer explode, animation, or arbitrary per-fragment dynamic-transform support.
Model-level placement changes used for federated coordination (alignment, translation, rotation, and
equivalent model-level transforms) **are** in scope and are supported via explicit, caller-controlled
TLAS invalidation (§6.7), not silently assumed away — see §6.5 for the resulting placement-freshness
contract.

---

## 2. User-facing `Find Clashes` workflow

1. **Two or more Viewer Models are loaded, simultaneously present.** `[review fix, Critical #5]`
   This is an **in-scope app change**, not already-supported behavior: this repo's current
   `wwwroot/viewer.js:38-48` `loadModel()` calls `viewer.loadDocumentNode(doc, ...)` with no
   `keepCurrentModels` option, which replaces (does not add to) the currently loaded model —
   confirmed against the pinned `@types/forge-viewer` typings, which declare
   `loadDocumentNode`'s options as accepting `keepCurrentModels?: boolean`
   (`node_modules/@types/forge-viewer/index.d.ts:261`). M2 requires the app's own model-loading call
   site to pass `keepCurrentModels: true` for every load after the first when the caller wants a
   federated session — this is application wiring the M2 implementation must add, not a precondition
   already met.
2. User selects exactly one element on exactly one model. **Not** `viewer.getSelection()` — that
   API returns a bare `number[]` with no model provenance, which cannot answer "which of the N
   loaded models does this dbId belong to" once more than one model is loaded. `[review fix,
   Critical #5]` Source resolution uses `viewer.getAggregateSelection()`, which returns
   `Array<{model: Model, selection: number[]}>` (confirmed at
   `node_modules/@types/forge-viewer/index.d.ts:1267`) — the M2 workflow requires this array to
   contain exactly one entry with exactly one dbId; any other shape (no selection, multiple models
   selected across, or multiple dbIds within one model) is the "unsupported" case §11.2 defines.
3. Right-click → **Find Clashes** (new context-menu entry, alongside M1's existing "Locate Room").
4. The selected `{ model, dbId }` becomes the query's `source` operand.
5. The target search scope is **every other currently-admitted-or-admittable element across every
   currently loaded model** — same model included, source element excluded (§4.4 defines exclusion
   precisely).
6. `mode: 'volume-overlap'` is the fixed default for this workflow — the context-menu entry never
   exposes a mode picker in M2 (containment/surface-intersection remain available to any direct
   library caller, e.g. the existing Room Locator sample, unchanged).
7. Candidate discovery: TLAS broad phase (§5–§7) narrows the O(federated fragment count) target
   population down to a small candidate set; M1's linear oracle remains selectable as a fallback
   (§7.4).
8. Narrow phase: the unchanged M1 `volumeOverlapQuery` composition (§8) determines which candidates
   are real Hard Clashes.
9. Results aggregate back to `{ model, dbId }` pairs, with correct per-operand model provenance even
   when source and target belong to different models.
10. Viewer isolates/highlights/fits-to the colliding elements (§11 — isolation, not selection, matches
    the existing Room Locator sample's own convention at `RoomLocatorExtension.js:249-250`).
11. UI reports `"<N> clashes found"` or `"No clashes found"`.
12. Any skipped/unsupported/inconclusive geometry surfaces via `statistics.diagnostics`, exactly as
    M1 already requires (`RoomLocatorExtension.js`'s own `describeDiagnostics`/caveat pattern, reused
    verbatim in §11) — never silently folded into "no clashes found."

---

## 3. Public API changes

### 3.1 `findClashes` — cross-model source/target operands

M1's `findClashes` (`CollisionWorld.js:613-754`) currently hard-rejects any query where
`source.model !== target.model` (`_checkEntryLifecycle`, `CollisionWorld.js:498-510`). M2 removes that
rejection and generalizes the query shape:

```js
async findClashes({
  source: { model: Object, dbIds: number[] },
  target:
    | { model: Object, dbIds: number[] }                    // M1 shape — preserved verbatim
    | { targets: Array<{ model: Object, dbIds?: number[] }> }, // M2 addition — see 3.2
  mode: 'surface-intersection' | 'containment' | 'volume-overlap',
  groupBy: 'dbId',
  broadPhase?: 'tlas' | 'linear',   // M2 addition, default 'tlas' — see §7.4
}) -> Promise<{ pairs: ClashPair[], statistics: Statistics }>
```

`source` stays single-model, single-or-multi-dbId, exactly as M1 defines it today — the M2 workflow
always selects one element on one model, and nothing in the acceptance workflow requires a
multi-model source. Widening `source` to multi-model is explicitly **not** attempted here; if a future
milestone needs it, the target-side design below generalizes to it without further API change (a
`source` operand is symmetric to one `targets` entry internally — see §4).

**Rejected API shapes, and why** (this is the concrete design-review finding the M2 architecture
consult surfaced): a naive `target: { models: Model[], dbIds: number[] }` shape — apply the same
`dbIds` array to every model — is rejected. `dbId` is **model-local**; the same numeric dbId means
different elements in different models. Any shape implying "one dbIds list, many models" is an API
footgun and is explicitly not offered.

### 3.2 New target shape: `targets: Array<{ model, dbIds? }>`

- `dbIds` present → identical semantics to M1's existing single-target shape, scoped to that one
  model (extraction walks exactly those requested dbIds' subtrees, per `extractFragments`,
  unchanged).
- `dbIds` omitted (or an explicit sentinel, e.g. `dbIds: undefined`) → **whole-model target scope**,
  meaning "every element in this model is a candidate." This needs a new extraction primitive
  (§3.3) — M1's `extractFragments` walks from a caller-supplied dbId's subtree, which is the wrong
  shape for "the whole model" (it would require the caller to know and pass every top-level root
  dbId, and would apply `maxFragmentsPerDbId`'s per-requested-dbId ceiling to what is really a
  whole-model scan).
- The context-menu **Find Clashes** workflow always calls this with one `targets` entry per
  currently-loaded model (including the source's own model), each with `dbIds` omitted — "every
  other currently loaded model, whole-model scope" is exactly `targets: allLoadedModels.map(model =>
  ({ model }))`. `[review fix, Critical #5]` `allLoadedModels` is `viewer.getAllModels(): Model[]`,
  confirmed at `node_modules/@types/forge-viewer/index.d.ts:1272` — this resolves what was previously
  §15's open question #2 ("authoritative Viewer API for every currently loaded model"); that item is
  removed from §15 below.

### 3.3 New extraction primitive: whole-model fragment enumeration

M1's `extractFragments(model, requestedDbIds, loadEpoch, {checkpoint, THREE})` (`ViewerModelAdapter.js:57-152`)
walks the instance tree from each requested dbId, guarded by `maxFragmentsPerDbId` (per requested
dbId) and `maxChildrenPerNode` (per node). Whole-model enumeration is a **different walk shape**, not
a parameterization of the existing one: it must enumerate every fragment the model's `FragmentList`
holds directly (`model.getFragmentList()`'s own fragment count, e.g. iterating fragment index
`0..fragmentCount-1`, or the model's own top-level enumeration API — the exact Viewer accessor needs
confirming against a real Viewer instance before implementation, flagged in §15), not a tree walk
guarded by per-subtree ceilings that were designed for "one selected element's subtree," not "the
whole model."

Proposed signature (implementation detail, not binding on the eventual implementer beyond the
contract): `extractAllFragments(model, loadEpoch, { checkpoint }) -> Map<fragmentId, ExtractedFragmentRecord>`,
returning the exact same `ExtractedFragmentRecord` shape `extractFragments` already produces
(`{fragmentId, geometryIdentity, worldMatrix, worldBounds, ownerDbId}`, `ViewerModelAdapter.js:113`),
so every downstream consumer (`makePlaced`, admission, TLAS primitive construction) is unchanged.

**Eligibility/enumeration contract (`[review fix, Important #3]`, binding, not left to the
implementer's judgment)**: `extractAllFragments` must define, explicitly:
- the authoritative fragment-count/enumeration accessor (candidate: `model.getFragmentList()`'s own
  fragment count and per-index iteration — not independently confirmed against a real Viewer session
  during this design pass; verify before implementation, same posture as `ViewerGeometryAdapter.js`'s
  own confirmed-against-the-real-bundle layout detection);
- per-fragment owning-dbId resolution (the whole-model walk has no single "requested dbId" to
  attribute a fragment to, unlike `extractFragments`'s own `node`-as-`ownerDbId` capture,
  `ViewerModelAdapter.js:113` — the owning dbId must come from the fragment's own reverse lookup,
  e.g. `instanceTree.findNodeForFragId`/equivalent, confirmed before implementation);
- handling for a fragment index with no live fragment (holes), a hidden/culled fragment, and a
  fragment whose owning dbId cannot be resolved — each must produce a diagnostic (§10), never a
  silently-dropped or silently-malformed primitive;
- the `maxCollisionInstancesPerEpoch` ceiling (§3.3 above) is checked **during** enumeration, not only
  after a potentially-unbounded intermediate `Map` has already been built — mirroring
  `admitCollisionInstances`'s own "precheck before any side effect" discipline
  (`CollisionWorld.js:692-703`).

**New capacity ceiling required**: M1's `maxCollisionInstancesPerEpoch` (20,000, `constants.js:58`) is
already the per-epoch cap on `_instanceCache` — a whole-model scan is naturally bounded by that same
ceiling with no new constant needed, since every extracted fragment still funnels through
`admitCollisionInstances`'s existing capacity check (`CollisionWorld.js:419-475`). A whole-model scan
that would exceed it throws the existing `CapacityExceededError`, unchanged. No new provisional
constant is introduced by this spec.

### 3.4 Result shape — `modelId` alone is not correctness-bearing for a live UI consumer

`[review fix, Critical #4]` The first draft of this spec claimed `ClashPair`'s existing
`{modelId, dbId}` shape (`CollisionWorld.js:743-748`) needed no change for M2. That is wrong, and
self-contradicts §4.1 below, which already documents `modelId` as best-effort/diagnostic-only and
**not guaranteed unique under Viewer modelId reuse** (`CollisionWorld.js:225-229`'s own comment). For
a single-model M1 caller this was harmless — there was only ever one candidate model to mean. For a
federated M2 result, a UI consumer needs to call `viewer.isolate(dbIds, model)`/`viewer.fitToView(dbIds,
model)` — both take a concrete `Model` object as their second argument
(`node_modules/@types/forge-viewer/index.d.ts:1250`), not a `modelId` — and two concurrently loaded
Viewer `Model` objects with the same `.id` cannot be told apart by `modelId` alone.

**Fix**: `ClashPair` gains a correctness-bearing `model` field alongside the existing diagnostic
`modelId`, additively — no field is removed:

```js
ClashPair = {
  source: { modelId, dbId, model },  // `model` is the real Model object reference this operand resolved against
  target: { modelId, dbId, model },
  type,
}
```

`model` is exactly the `Model` object `modelIdOf(model)` was already called on
(`CollisionWorld.js:21-23,743-746`) — no new resolution step, just retaining a reference the code
already holds instead of discarding it after deriving `modelId`. Same-model-vs-cross-model
classification (§11.2) and any isolate/fitToView call must compare/use `pair.source.model`/
`pair.target.model` by object identity, never `modelId` string/number equality.

What changes is the **internal**
dedup key `findClashes` uses while accumulating `pairsByKey` (`CollisionWorld.js:731,741-742`):

```js
// M1 (single-model only, dbId is unambiguous within one call):
const key = `${sourcePlaced.ownerDbId}:${targetPlaced.ownerDbId}`;

// M2 — modelId is diagnostic-only and not guaranteed unique under Viewer modelId reuse
// (CollisionWorld.js:225-229's own comment); loadEpoch is the correctness-bearing identity axis:
const key = `${sourceEpoch}:${sourcePlaced.ownerDbId}:${targetEpoch}:${targetPlaced.ownerDbId}`;
```

This was a specific, verified finding from the architecture review: folding `modelId` into a string
key is not just unnecessary but actively wrong (delimiter/collision hazard, and `modelId` is
explicitly documented as best-effort/non-load-bearing at `CollisionWorld.js:225-229`). `loadEpoch` is
global, monotonic, and never reused — the correct identity axis, exactly as it already is for
`GeometryIdentity` (§4).

### 3.5 `broadPhase` option

New, optional. `[review fix, Important #2]` **Default is shape-dependent, not unconditionally
`'tlas'`**: the first draft defaulted every call to `'tlas'`, which would silently change the
Room Locator sample's own existing `findClashes({source, target, mode:'containment', ...})` call
(`RoomLocatorExtension.js:189-194`, the legacy M1 `{model, dbIds}` target shape, no `broadPhase`
passed) to acquire the placement-staleness limitation §6.4 introduces — contradicting §16's own claim
that this caller's behavior is preserved. Corrected default:

- **Legacy target shape** (`target: {model, dbIds}`, no `targets` array) → defaults to `'linear'`.
  Byte-for-byte M1 behavior, including placement freshness — genuinely zero behavior change for
  every existing caller, as §16 claims.
- **New `targets` shape** (§3.2) → defaults to `'tlas'`, since the federated Find Clashes workflow
  (§2) is the one this spec is built around and the whole point of §5-§7.

Either shape may pass `broadPhase` explicitly to override its own default. `'linear'` always forces
M1's existing `_runBroadPhaseScan` path unchanged — the correctness-oracle/fallback path required by
§12's differential fixtures and available as an escape hatch if a TLAS build is ever suspected of
misbehaving on a particular model. Not exposed in the context-menu UI; a direct-library-caller-only
option.

---

## 4. Cross-model identity/provenance model

### 4.1 What is already cross-model-safe, unchanged (the good news)

This is the single most important finding of this spec's own design-discipline inventory pass: **M1's
identity model was already built to be cross-model-safe**, years ahead of when it was needed, and
nothing here requires touching it.

- `loadEpoch` is a **global** counter on the `CollisionWorld` instance (`this._nextLoadEpoch`,
  `CollisionWorld.js:227,330`) — never scoped to or reset per model, never reused (the "round-11
  ABA-race fix," `CollisionWorld.js:226`). Every model ever admitted to one `CollisionWorld` gets a
  distinct epoch, for the life of that world.
- `GeometryIdentity = { loadEpoch, geometryIndex }` (`GeometryIdentity.js:1-20`) is keyed by
  `loadEpoch`, **never `modelId`** — so it is already immune to modelId-reuse aliasing across models,
  by construction.
- `GeometryRegistry`'s cache (`Map<loadEpoch, Map<geometryIndex, Entry>>`, `GeometryRegistry.js:55`)
  and `CollisionWorld`'s own instance cache (`Map<loadEpoch, Map<fragmentId, CollisionInstance>>`,
  `CollisionWorld.js:239`) are both epoch-keyed. Neither holds a `Model` object reference anywhere in
  the geometry/BLAS pipeline. **The entire BLAS/geometry-registry layer needs zero changes for M2** —
  it is purely additive from the TLAS layer's perspective.
- `comparePlacedCanonically` (`CollisionWorld.js:98-107`), the comparator that keeps
  `volume-overlap`'s canonical operand ordering (and therefore its clash verdict) independent of which
  side the caller calls "source," already sorts by `(loadEpoch, geometryIndex, fragmentId)`
  lexicographically — its own comment states this explicitly: *"all three are included so the order
  stays total if a later milestone lifts the single-model restriction"* (`CollisionWorld.js:86-89`).
  **This needs no change for M2.**
- `_resolveGeometryView(loadEpoch, geometryIndex)` (`CollisionWorld.js:985-1013`) already resolves the
  correct `Model` via `_modelByEpoch.get(loadEpoch)` — it is epoch-keyed, not model-object-keyed, and
  needs no change.

### 4.2 What must change

- **`_checkEntryLifecycle`'s cross-model rejection** (`CollisionWorld.js:498-510`) is removed/replaced
  by the multi-lease entry-order check in §9.2.
- **Pair/diagnostic dedup keys** move from `dbId`-only to `(loadEpoch, dbId)` tuples (§3.4).
- **Fragment-diagnostic dedup** (`oversizedDiagnosedFragments`, keyed by bare `fragmentId`,
  `CollisionWorld.js:816-817`) must become `(loadEpoch, fragmentId)`-keyed. M1's current key is
  already latently wrong the moment two different epochs can be in play in the same call (equal
  `fragmentId` values across models would silently suppress a valid second diagnostic) — this was
  unreachable in M1 (single model per call ⇒ single epoch per call) but becomes reachable the moment
  M2 lifts the restriction.
- **`fragmentRef`/`ownerModelIdHint`/pair diagnostics** (`CollisionWorld.js:54-60,808-824,895-908`)
  currently take one call-level `model`/`epoch` parameter. These become **operand-local** — each of
  `sourcePlaced`/`targetPlaced` carries its own `(model, epoch)` provenance through `_runNarrowPhasePair`,
  rather than one shared value for the whole call.
- **`_runBroadPhaseScan`** (`CollisionWorld.js:765-782`) is replaced/augmented by the TLAS path (§7);
  its `_testBroadPhasePair` exact-AABB predicate (`CollisionWorld.js:786-792`) is **kept and reused**
  as the retest step every TLAS-emitted candidate passes through (§7.3) — not discarded.

### 4.3 Result-pair provenance

Every `ClashPair`'s `source.modelId`/`target.modelId` is derived exactly as M1 already does
(`modelIdOf(model)`, `CollisionWorld.js:21-23,743-746`), just now potentially different per operand.
No change to that derivation.

### 4.4 Source self-exclusion — explicit definition (open question resolved with a default)

The M2 prompt requires "source element itself is excluded" but does not define exclusion granularity
for an assembly whose subtree spans multiple owning dbIds.

`[review fix, Critical #3b]` The first draft of this default ("exclude iff target's `(loadEpoch,
ownerDbId)` equals the source's own `(loadEpoch, dbId)`") was imprecise about what "the source's own
dbId" means once the source is an assembly. `extractFragments`'s first-discovery-wins capture sets
each fragment's `ownerDbId` to whatever tree node it was **directly** discovered under during the walk
(`ViewerModelAdapter.js:103-113`) — for a leaf-element selection this is the same dbId the user
selected, but for an assembly selection (the walk descends into children), individual fragments'
`ownerDbId` can be **child** dbIds different from the single top-level dbId the user actually
right-clicked. A source's own extraction (`sourceExtracted`, `CollisionWorld.js:681`) can therefore
already span more than one distinct `ownerDbId`.

**Corrected default disposition**: exclusion is defined over the source's **entire extracted fragment
set**, not just the single requested dbId — a candidate target instance is excluded iff its
`(loadEpoch, fragmentId)` appears anywhere in the source operand's own `sourceExtracted` map for this
call. This is strictly more correct than dbId-level exclusion (it also correctly excludes a
same-fragment self-pair for a multi-dbId source, which dbId-level exclusion alone would not
guarantee) and is cheap: `sourceExtracted` already exists as an in-memory `Map<fragmentId, ...>` for
the whole call, so the check is a single `.has()` per candidate. The **result-level** dbId question
(§2 step 5's "source excluded from results," matching the M2 prompt's own `groupBy:'dbId'`-shaped
acceptance language) follows automatically: if every one of a dbId's own fragments was excluded as
source-owned, that dbId can never appear as a target in the result set, with no separate dbId-level
rule needed.

Whether the acceptance workflow's real fixture models actually need this distinction (vs. the simpler
dbId-only rule) remains open pending a concrete fixture — retained in §15.

---

## 5. TLAS architecture

### 5.1 Design-discipline requirement and how this section satisfies it

The M2 prompt requires: *"Do not invent a custom BVH implementation unless justified. Evaluate an
appropriate existing packed-BVH representation first."* This section documents that evaluation.

`three-mesh-bvh@0.9.14` is already vendored in this repo (`node_modules/three-mesh-bvh`, pinned in
`package.json`, mirrored via `scripts/sync-vendor.mjs`) — not a new dependency. Reading its source
directly (not its narrower `MeshBVH`-focused public documentation) surfaces three relevant exports:

| Class/function | Shape | Fit for M2's TLAS |
|---|---|---|
| `MeshBVH` (already used, `blas/ThreeMeshBvhBackend.js`) | One BVH per triangle mesh | Wrong level — this **is** the existing BLAS, unchanged |
| `ObjectBVH` (`core/ObjectBVH.js`) | One BVH leaf per `Object3D` (or `InstancedMesh`/`BatchedMesh` instance); requires real `Object3D`s with `.matrixWorld`/`.geometry.boundingBox` | **Rejected.** `CollisionInstance`/`PlacedInstance` are not `Object3D`s; wrapping every admitted instance in a synthetic `Object3D` proxy adds allocation, geometry, matrix, and ID-packing machinery that buys nothing `CollisionInstance`'s own plain `{min,max}` `worldBounds` doesn't already have |
| `BVH` (`core/BVH.js`) | **Abstract base class.** A subclass overrides `writePrimitiveBounds(i, buffer, writeOffset)` (write primitive *i*'s AABB into a flat buffer) and calls `this.init(options)`, which runs the same packed-tree builder (`buildPackedTree`) `MeshBVH`/`ObjectBVH` both use internally | **Adopted.** This is exactly a "packed-BVH representation," already shipped, already exercised in production by two other subclasses in the same package |

**Decision: `CollisionInstanceBVH extends BVH`**, a new class in
`collision/tlas/CollisionInstanceBVH.js`, whose primitives are admitted `CollisionInstance`s'
world-space AABBs (`PlacedInstance.worldBounds`, already captured at extraction time,
`ViewerModelAdapter.js:42-48`, independent of model). This is reuse of the vendored library's own
generic packed-tree build/traversal machinery, not a custom BVH implementation — satisfying the
prompt's requirement directly. `[review fix, Critical #2]` The first draft understated this as
"requiring only a thin primitive-bounds adapter" and (wrongly) called the shared builder an "SAH"
tree builder — `Constants.js:74` shows the package's own default split strategy is `CENTER`, not
`SAH`; this spec does not require `SAH` specifically, and the sentence claiming it is corrected here.
§5.2 below now states the full required adapter surface, not just `writePrimitiveBounds`.

### 5.2 API-surface risk, and the full required adapter contract

`BVH`/`ObjectBVH` are exported from the package's public barrel (`src/index.js:1-6`) and **are**
declared in the shipped `.d.ts` (contrary to this spec's own first-pass assumption during drafting —
verified directly against `src/index.d.ts` before finalizing this section). The narrower risk that
remains: `BVH.prototype.init`, `getRootRanges`, and `writePrimitiveBounds` — methods a subclass must
actually implement/call — are **not** individually typed in the `.d.ts`, and `BVH.prototype.bvhcast`'s
own typing over-narrows its second operand to `MeshBVH` specifically (a typing gap, not a runtime
restriction — `bvhcast`'s actual JS implementation operates on the packed node-buffer representation
any `BVH` subclass shares, per `bvhcast.js:17-30`).

`[review fix, Critical #2]` The first draft's "override just `writePrimitiveBounds`" undersold the
actual required surface. Verified against `BVH.js`: `init()` calls `buildPackedTree(this, options)`
immediately, which calls the subclass's `getRootRanges()` — the base class's own `getRootRanges`
throws `'BVH: getRootRanges() not implemented'` (`BVH.js`, per the vendored source) — so a subclass
that overrides only `writePrimitiveBounds` and calls `super.init()` fails at construction, before the
first query. `CollisionInstanceBVH`'s **complete, binding contract** is:

- `getRootRanges()` — implemented, not merely mentioned; defines the primitive index range(s) the
  builder partitions (a single root range covering every admitted primitive for the epoch, the
  simple/expected case here — no multi-root splitting is needed for one epoch's flat instance list).
- `writePrimitiveBounds(i, buffer, writeOffset)` — writes primitive *i*'s `worldBounds` into the flat
  buffer `buildPackedTree` expects.
- A populated `primitiveBuffer`/valid `primitiveBufferStride` (the base class's own constructor-time
  fields, `BVH.js`'s own comment marks these as required state, not optional) — set from the epoch's
  collected `CollisionInstance` primitive-record array (§5.3) before `init()` runs.
- A **reordered-leaf-to-original-record mapping**: `buildPackedTree` reorders primitives into its own
  packed-tree order (the same reason `ThreeMeshBvhBackend.js:47-52`'s own `indirect: true`/
  `resolveTriangleIndex()` discipline exists for the BLAS layer, §5.2 of that file's own comment) — a
  leaf-range's `offset`/`count` refer to positions in the **builder-reordered** primitive buffer, not
  directly into the original per-epoch instance array. The adapter must retain whatever index/ID
  array the builder produces (or an equivalent one it constructs itself) to resolve a matched leaf
  range back to the original `{loadEpoch, fragmentId, ownerDbId, modelId, worldBounds}` records (§5.3).
- Empty-tree behavior: an epoch with zero admitted instances (a not-yet-populated or fully-evicted
  epoch) must produce a well-defined, queryable-but-always-empty tree, not a construction-time throw
  — a lazily-built TLAS entry for an epoch queried before any target extraction has happened is a
  reachable, non-error case (§6.4).
- Explicit build-strategy/leaf-size configuration passed to `init(options)` (default `CENTER`
  split, `targetLeafSize` chosen and stated, not left implicit) — a tuning decision for
  implementation, but the option **must** be passed explicitly rather than relying on whatever the
  package's own default happens to be, so a future package upgrade cannot silently change this
  adapter's build behavior.
- Callback-exception containment around any traversal callback this adapter exposes, matching §7.2's
  requirement for a future `bvhcast` consumer.

**Mitigation, required as part of implementation (not optional polish)**: treat `CollisionInstanceBVH`
as a version-pinned adapter over an internal-but-shipped contract, protected by contract tests that
assert `BVH`'s actual runtime shape (method presence/behavior, including every item in the list above)
against the exact vendored `0.9.14` build — so an accidental `sync-vendor.mjs` version bump that
changes this contract fails loudly in CI rather than silently. This is the same posture M1 already
takes toward `ThreeMeshBvhBackend.js`'s own reliance on `bvh.resolveTriangleIndex()` (an
`indirect: true` BVH implementation detail, confirmed against vendored source per that file's own
comment, `ThreeMeshBvhBackend.js:47-52`) — M2 extends an existing, accepted risk posture, not a new
one.

### 5.3 Primitive record shape

```js
// One per admitted CollisionInstance, immutable once written into a TLAS entry.
{
  loadEpoch: number,
  fragmentId: number,
  ownerDbId: number,
  modelId: (number|string),  // diagnostic only, per CollisionWorld.js:225-229's existing convention
  worldBounds: { min: [x,y,z], max: [x,y,z] },
}
```

This is deliberately the same shape discipline `PlacedInstance`/`fragmentRef` already use (§4) —
`modelId` is carried for diagnostics/UI display only; every correctness-bearing lookup uses
`loadEpoch`.

### 5.4 What the TLAS layer does NOT own

- Triangle-level geometry, weld/connectivity/BVH build (BLAS) — unchanged, owned by
  `GeometryRegistry`/`BlasCache`/`ThreeMeshBvhBackend` (§4.1).
- Narrow-phase collision semantics — unchanged, owned by `VolumeOverlapQuery`/`ContainmentModeQuery`/
  `SurfaceIntersectionQuery` (§8).
- Exact collision predicates of any kind — the TLAS only ever answers "which primitives' AABBs
  plausibly overlap," coarse and conservative (§7.3 defines the required retest).

---

## 6. TLAS build/cache/lifecycle

`[review fix, Critical #1]` The first draft of this section claimed a TLAS could be built "directly
from already-admitted instances" via `_instanceCache`. That is false and self-contradicted §6.4's own
text one paragraph later: `_instanceCache` stores only `Object.freeze({fragmentId, geometryIdentity})`
per instance (`CollisionWorld.js:461`) — **no `worldBounds`, `worldMatrix`, `ownerDbId`, or
`modelId`** anywhere in it. There is, as of M1, no cache in `CollisionWorld` that retains placement
past the end of one `findClashes` call — `PlacedInstance` (`makePlaced`, `CollisionWorld.js:42-49`) is
deliberately call-local. A cached TLAS needs an epoch-scoped store of placement that M1 simply does
not have today. This section now defines it, plus the cache-completeness rule the first draft was
missing entirely (a TLAS built once and never revisited as an epoch gains more admitted instances
would silently under-report — see §6.3's worked failure scenario below).

### 6.1 New state: a per-epoch placement index (prerequisite for the TLAS)

**New `CollisionWorld` field**: `_placementByEpoch: Map<loadEpoch, Map<fragmentId,
{worldBounds, worldMatrix, ownerDbId, modelId}>>`, populated at the same site extraction already
produces this exact data — `extractFragments`'s own `ExtractedFragmentRecord`
(`{fragmentId, geometryIdentity, worldMatrix, worldBounds, ownerDbId}`, `ViewerModelAdapter.js:113`)
already carries everything needed except `modelId`, which is cheaply derived (`modelIdOf(model)`) at
the same call site. Today this record is discarded once `makePlaced` builds its call-local
`PlacedInstance` (`CollisionWorld.js:719-720`); M2 additionally **writes it into `_placementByEpoch`**,
epoch-scoped, the same "capture once at extraction, keep append-only" discipline
`_recordRepresentativeFragments` (`CollisionWorld.js:965-975`) already uses for a different per-epoch
side table. Released at the same `_releaseEpochScopedState` boundary (`CollisionWorld.js:477-494`) as
every other epoch-scoped table, alongside the new TLAS cache release (§6.5).

This index, not `_instanceCache`, is the TLAS's actual primitive source of truth. It also directly
supplies §3.4's new `ClashPair.source.model`/`target.model` field and answers §4.4's corrected
self-exclusion rule (`sourceExtracted`'s own fragment set) without a second lookup.

### 6.2 Cache identity and structure

One `CollisionInstanceBVH` entry **per `loadEpoch`**, cached in a new `Map<loadEpoch, TlasEntry>` on
`CollisionWorld` (parallel to `_instanceCache`/`_placementByEpoch`, not inside `GeometryRegistry` —
the TLAS operates on placement records directly and has no geometry-build dependency, so it does not
belong in `GeometryRegistry`'s own weld/connectivity/BLAS pipeline). `TlasEntry` additionally carries
the **admission revision** it was built against (§6.3).

### 6.3 Lifecycle pattern — mirror `GeometryRegistry`, do not reinvent

The M2 prompt requires "lazy construction, concurrent build sharing, eviction/disposal cleanup" for
the TLAS layer. `GeometryRegistry` (`GeometryRegistry.js`) already implements exactly this pattern for
a different resource (per-geometry BLAS entries) and is the direct template:

| `GeometryRegistry` mechanism | TLAS equivalent |
|---|---|
| "Insert first, then build" (`GeometryRegistry.js:65-74`) — entry inserted synchronously before any await, so concurrent lookups share the in-flight build | Identical: a `TlasEntry` is inserted into the epoch's slot synchronously, before the (async, checkpoint-yielding) primitive-collection walk begins |
| Per-entry `cancellationSignal`/`rejectSignal` raced against every phase (`GeometryRegistry.js:103-109,219-229`) | Identical: a TLAS build in progress races the same per-epoch cancellation signal |
| `releaseEntriesForEpoch(loadEpoch)` (`GeometryRegistry.js:76-87`) | New `TlasCache.releaseEntryForEpoch(loadEpoch)`, called from the same `_releaseEpochScopedState` call site (`CollisionWorld.js:477-494`) that already calls `_registry.releaseEntriesForEpoch` — one more sibling call, same epoch-eviction boundary |
| `releaseAll()` on world disposal (`GeometryRegistry.js:89-98`) | New `TlasCache.releaseAll()`, called from `CollisionWorld.dispose()` (`CollisionWorld.js:390-413`) alongside `this._registry?.releaseAll?.()` |
| Builder-agnostic constructor injection (`GeometryRegistry`'s `buildWeld`/`buildConnectivity`/`buildAcceleration`) | `TlasCache`'s own constructor takes a `buildPrimitives(loadEpoch)` function — the "collect this epoch's admitted `CollisionInstance`s' `worldBounds`" step — injected the same way, testable in isolation with stub builders exactly as `GeometryRegistry.test.mjs` already does |

**This is a design requirement, not a suggestion**: reusing this exact pattern means the TLAS
inherits M1's already-reviewed answers to "what happens when a build races an eviction," "what
happens when two concurrent callers request the same epoch's TLAS," and "what happens on world
disposal mid-build" for free, rather than re-deriving and re-reviewing those three hazards from
scratch for a second resource type.

### 6.4 Build trigger, scope, and the cache-completeness rule

A TLAS entry for `loadEpoch` is built lazily, on first `findClashes` call that needs to query that
epoch as a **target**. It is built over every `{fragmentId -> placement}` entry `_placementByEpoch`
holds for that epoch **at build time**.

`[review fix, Critical #1]` **This alone is not a sufficient cache-completeness rule**, and the first
draft did not have one — a concrete failure this omission allows: a Room Locator-style query admits
20 room fragments to epoch E and (if it triggered a TLAS build as a target) builds a TLAS over
exactly those 20. A later whole-model Find Clashes query against the same still-live epoch E admits
5,000 more fragments via `extractAllFragments` (§3.3) — but a naive "build once, reuse forever" TLAS
entry would still only contain the original 20, silently missing nearly every real candidate.

**Fix: an epoch-local admission revision.** `CollisionWorld` gains a `_placementRevisionByEpoch:
Map<loadEpoch, number>`, a per-epoch counter incremented every time `_placementByEpoch.get(epoch)`
gains a new entry (i.e. alongside every write described in §6.1 — the same call site that already
writes to `_recordRepresentativeFragments`, `CollisionWorld.js:704-705`, gains one more sibling
write). A `TlasEntry` (§6.2) records the revision number it was built against
(`entry.builtAtRevision`). Before a `findClashes` call queries an epoch's TLAS as a target, it
compares `entry.builtAtRevision` to the epoch's current `_placementRevisionByEpoch.get(epoch)`:

- **Equal** → the cached TLAS is known-complete for this epoch's current admitted population; query
  it directly.
- **Stale** (current revision is higher) → the TLAS does not cover every currently-admitted instance.
  M2's required behavior: **rebuild** the entry (same lazy-build/insert-first-then-build machinery,
  §6.3) rather than querying a known-incomplete tree. Incremental extension (adding only the new
  primitives to an existing packed tree) is a valid future optimization but is **not** required by
  this spec — `buildPackedTree` builds a tree from a primitive set in one pass; there is no
  vendored incremental-insert operation to extend an already-built tree, so a full rebuild is the
  correct M2-scope default, not a shortcut being skipped.

This closes the exact "20 rooms, then 5,000 more fragments" scenario above: the second query observes
a stale revision and rebuilds before using the entry, rather than silently under-reporting.

**Concurrency**: a rebuild triggered mid-flight by one caller while another caller already holds a
reference to the in-flight (now-stale) build follows the identical cancellation-race pattern §6.3
already commits to reusing from `GeometryRegistry` — the stale in-flight promise is superseded, not
raced against, the same "at most one phase unresolved on an entry at a time" discipline
`GeometryRegistry.js:1482-1484`'s own comment already documents for a structurally identical hazard.

### 6.5 Placement-freshness contract — resolved

**This subsection is resolved by the targeted design-resolution pass; the first-draft's open item
asking for explicit human confirmation (formerly §15 item 1) is closed.** Human decision: Milestone 2
**must** support model-level placement changes used for federated coordination — model alignment,
translation, rotation, and equivalent model-level transforms — invalidating a cached TLAS. Milestone 2
explicitly does **not** need to support Viewer explode, animation, arbitrary per-fragment dynamic
transforms, or high-frequency visualization-only displacement.

As established in §6.1/§6.4, `extractFragments` re-reads `worldMatrix`/`worldBounds` fresh from the
Viewer's `FragmentList` on every call, but a cached TLAS entry does not automatically observe a
placement change the way a per-call linear scan does — the cache is exactly the mechanism that must be
told, explicitly, when a placement changed underneath it.

**Default disposition, as resolved**: a TLAS entry's underlying placement data is treated as static
**unless and until the caller explicitly invalidates it** via `invalidateModelPlacement(model)` (§6.7)
— not static unconditionally, as the first draft assumed. Concretely:

- No Viewer transform-change event is wired to invalidate a live TLAS entry automatically in M2 — this
  remains true; invalidation is caller-controlled and explicit, never inferred from a Viewer event, per
  the M2 prompt's own instruction not to rely on an assumed Viewer event unless independently verified
  and intentionally adopted (none is, here).
- A caller that performs a model-alignment/move/rotate operation **must** call
  `invalidateModelPlacement(model)` (§6.7) after the transform is committed and visible through the
  Viewer's own `getWorldMatrix`/`getWorldBounds` accessors — this is a caller-contract precondition
  `CollisionWorld` cannot itself verify (it has no independent way to know whether the Viewer's internal
  `FragmentList` state already reflects the new transform), so the contract is stated here explicitly
  rather than left implicit.
- `broadPhase: 'linear'` (§3.5) remains available, is always placement-fresh on every call regardless
  of any invalidation call having been made, and needs no invalidation call at all — it never reads
  from `_placementByEpoch`/the TLAS cache in the first place (§7.4). This is the correctness escape
  hatch for any workflow that cannot tolerate the TLAS path's cache semantics, exactly as originally
  stated.
- Calling `invalidateModelPlacement` at animation/per-frame rate is not a supported usage pattern: each
  call forces a full placement re-read and TLAS rebuild for that epoch at the next TLAS-consuming query
  (§6.7), which produces **correct but pathologically slow** behavior for a workflow calling it every
  frame — this is exactly why explode/animation remain explicit non-goals (§1) rather than "technically
  works." `invalidateModelPlacement` is designed for a bounded number of discrete coordination actions
  (align model A to model B once, then query), not continuous manipulation.

### 6.6 Eviction/disposal

- `evictModel(model)` → `_releaseEpochScopedState(previous.epoch)` (`CollisionWorld.js:346-370,477-494`)
  gains three new calls at the same site, each held to the same non-throw contract
  `_releaseEpochScopedState`'s existing `_registry.releaseEntriesForEpoch` call already is:
  `this._tlasCache?.releaseEntryForEpoch(epoch)`, `this._placementByEpoch.delete(epoch)`, and
  `this._placementRevisionByEpoch.delete(epoch)` — the last two are plain `Map.delete` calls (like
  the existing `_modelByEpoch.delete(epoch)`/`_representativeFragmentByGeometry.delete(epoch)` pair
  right below them, `CollisionWorld.js:492-493`) and cannot themselves throw.
- `dispose()` gains `this._tlasCache?.releaseAll?.()` alongside `this._registry?.releaseAll?.()`
  (`CollisionWorld.js:400-405`, same defensive try/catch), plus `this._placementByEpoch.clear()`/
  `this._placementRevisionByEpoch.clear()` alongside the existing wholesale-clear calls
  (`CollisionWorld.js:406-412`).

### 6.7 Model-placement invalidation (alignment/move/rotate support)

**New public method**: `invalidateModelPlacement(model)`. This is the explicit, caller-controlled
signal the workflow in the M2 prompt requires: *Model A and Model B are loaded → a model-alignment
tool applies a model-level move/rotate/transform → the alignment workflow informs `CollisionWorld`
that the model's placement changed → the model's placement revision increments → any cached TLAS for
that epoch becomes stale → the next TLAS-backed query re-reads current world matrices/world bounds and
rebuilds before use.*

#### 6.7.1 Contract

```js
world.invalidateModelPlacement(model);
```

- Throws `WorldDisposedError` if the world is disposed — the standard contract every public method
  except `evictModel`/`isLeaseValid` already follows (`CollisionWorld.js:338-344,346-358` — these two,
  not `dispose`, are M1's own documented non-throwing exceptions; `dispose()` itself throws
  `WorldDisposedError` on a second call like any other public method, per its own comment at
  `CollisionWorld.js:392-393`).
- Throws `ModelEvictedError(modelIdOf(model))` if the model was ever evicted — resolved via the
  existing `_modelLifecycle` `WeakMap` (`CollisionWorld.js:224-225,321-326`), the same reverse
  model→epoch lookup `admitModel`/`isLeaseValid`/`evictModel` already use. No new reverse-lookup
  structure is introduced.
- No-ops if the model was never admitted (`_modelLifecycle.get(model)` is `undefined`) — nothing to
  invalidate.
- Otherwise: resolves `epoch = _modelLifecycle.get(model).epoch` and performs the revision-bump/
  dirty-marking sequence in §6.7.2.

#### 6.7.2 Revision and generational-invalidation tracking

**One canonical staleness counter, not two.** `_placementRevisionByEpoch` (§6.4) remains the single
source of truth for "has this epoch's placement changed since a given `TlasEntry` was built" — both a
new-admission ("growth") and an explicit invalidation bump the same counter. A `TlasEntry`'s
`builtAtRevision` mismatching the epoch's current revision means "rebuild," full stop, regardless of
which of the two causes produced the mismatch.

What differs between the two causes is **what a rebuild must do before it can trust
`_placementByEpoch`'s current contents**:

- **Growth** (a new fragment admitted): the newly-written entry is already fresh (extraction always
  reads live Viewer state when it writes a genuinely new entry, §6.7.4) and every other existing entry
  in the epoch's map is untouched — nothing needs to be re-read; a rebuild only needs to run the
  packed-tree builder over the map's current contents.
- **Invalidation** (`invalidateModelPlacement` was called): every *existing* entry's
  `worldMatrix`/`worldBounds` may now be stale — a rebuild must first re-read them from the Viewer
  before trusting the map.

**New field**: `_placementInvalidatedAtRevision: Map<loadEpoch, revision>` — not a boolean `Set`.
`invalidateModelPlacement` performs, synchronously, in one step:

1. `const revision = (this._placementRevisionByEpoch.get(epoch) ?? 0) + 1;`
2. `this._placementRevisionByEpoch.set(epoch, revision);`
3. `this._placementInvalidatedAtRevision.set(epoch, revision);`

Recording the exact revision the invalidation produced (rather than a bare boolean) is what makes the
generation-aware compare-and-publish in §6.7.3 possible: a refresh attempt can tell whether the
invalidation it is responding to is still the *current* one, or whether a second invalidation has
superseded it while the refresh was in flight.

A TLAS-consuming query, on finding `entry.builtAtRevision !== _placementRevisionByEpoch.get(epoch)`,
checks whether `_placementInvalidatedAtRevision.get(epoch)` is defined and `>= entry.builtAtRevision`
(i.e., an invalidation happened since this entry was last built) — if so, it must run the
refresh-then-rebuild path (§6.7.3) rather than the growth-only rebuild-from-current-map path.

#### 6.7.3 Refresh is staged and published atomically, never mutated in place

**Why in-place mutation is wrong**: `_placementByEpoch`'s per-epoch map is shared, readable state. A
refresh that re-reads and overwrites its entries one at a time, yielding at checkpoints between reads
(the same discipline `extractFragments`'s own subtree walk already uses for large populations, §3.3),
would let a concurrent reader — another `findClashes` call touching the same epoch, or this call's own
later self-exclusion/provenance lookups (§4.4, §3.4) — observe a mixture of already-refreshed
(post-transform) and not-yet-refreshed (pre-transform) records for the *same* epoch mid-refresh. That
is exactly the kind of "possibly-wrong-answer" hazard §9.2/§10 already treat as unacceptable for
lifecycle changes generally.

**Required mechanism**: build a private, unpublished replacement map (or an equivalent set of
replacement records — implementation detail) as the refresh walk proceeds, re-reading
`worldMatrix`/`worldBounds` via the exact same primitives `extractFragments` already uses
(`fragList.getWorldMatrix(fragId, scratchMatrix)` / `fragList.getWorldBounds(fragId, scratchBox)`,
`ViewerModelAdapter.js:37-48`) for every `fragmentId` already present in
`_placementByEpoch.get(epoch)` — `ownerDbId`/`geometryIdentity`/`modelId` are carried over unchanged
(alignment does not change tree topology or geometry identity, only transform). The shared
`_placementByEpoch` map is **not touched** while this walk is in progress.

When the walk completes, **synchronously, with no further await in between** (this is the
compare-and-publish step, and it must be atomic with respect to the checks it depends on):

1. Verify the world is not disposed and the model's lease is still live (`_isEpochLive(epoch)`/
   `isLeaseValid`-equivalent).
2. Verify `_placementRevisionByEpoch.get(epoch)` and `_placementInvalidatedAtRevision.get(epoch)` still
   equal exactly the values captured when this refresh attempt began.
3. If both hold: publish — replace `_placementByEpoch.get(epoch)`'s entries with the staged replacement
   map, clear `_placementInvalidatedAtRevision.delete(epoch)` (since this refresh's own captured
   revision is still current), and proceed to rebuild the `TlasEntry` from the now-current map,
   recording `builtAtRevision` as the (still-current) revision.
4. If either check fails: **discard the staged replacement entirely.** A failed disposal/eviction check
   aborts the query as usual (§9.2/§10). A failed revision/invalidation check means a *second*
   invalidation (or new admission) landed while this refresh was reading Viewer state — the staged data
   is now itself stale before it was ever published; the caller retries (the next TLAS-consuming query
   attempt re-enters this same lazy-build/refresh path, which will now correctly respond to whichever
   invalidation is actually current). The first, superseded refresh attempt must never clear the
   second invalidation's marker — that is precisely what the compare-in-step-2 prevents.

This reuses no new concurrency primitive beyond what §6.3 already commits this design to (the
`GeometryRegistry`-style insert-first-then-build/single-flight/cancellation-race pattern) — the refresh
is simply one more phase of the same kind of build the TLAS entry already goes through, gated by one
more precondition check at its publish point.

#### 6.7.4 Extraction remains write-once per fragment; only an explicit refresh may overwrite

**Correction to §6.1's phrasing.** §6.1 describes `_placementByEpoch` as populated "at the same site
extraction already produces this exact data," which could be misread as "extraction refreshes an entry
every time it touches that fragment again." That is not the intended contract and must not be the
implementation: if `extractFragments`/`extractAllFragments` encounters a `fragmentId` that **already**
has an entry in `_placementByEpoch.get(epoch)` (e.g., a later call re-requests an overlapping dbId), it
must **not** overwrite that existing entry — only a fragment with **no** existing entry is inserted (a
new entry, which also increments `_placementRevisionByEpoch` as "growth," §6.4). This is what makes
`_placementInvalidatedAtRevision`/§6.7.3's refresh the **only** legitimate writer of an *existing*
fragment's placement — extraction stays purely additive to this table, exactly the "capture once,
append-only" discipline §6.1 already intends and `_recordRepresentativeFragments` already models
elsewhere in M1. A call's own call-local `PlacedInstance`/`ExtractedFragmentRecord` values (used for
that call's own narrow-phase/self-exclusion work) are unaffected by this rule and continue to reflect a
genuinely fresh per-call read, exactly as M1 already does — the two are allowed to diverge for the
freshness gap between refreshes, which is precisely the accepted static-until-invalidated contract
(§6.5).

#### 6.7.5 A query must not invalidate itself

**A real hazard the first draft of this resolution missed, caught by an independent `codex-advisor`
review of this pass before it was written here (see the disposition report).** A cross-model query
snapshots each captured model's placement revision at query entry for later mid-query comparison
(§9.2). But that same query's **own** extraction work can admit genuinely new fragments into
an epoch it captured (ordinary growth, §6.4) — which increments `_placementRevisionByEpoch` for that
epoch. Comparing the query's original entry-time snapshot against the post-admission current revision
would make the query detect its **own** writes as an external change and incorrectly abort itself.

**Required mechanism**: each query tracks its own **expected revision per captured epoch**, not merely
a static entry-time snapshot:

- At query entry, `expectedRevisionByEpoch.set(epoch, currentRevision)` for every captured epoch,
  exactly as already planned.
- **Before** performing its own genuinely-new-fragment insertion into `_placementByEpoch` for a
  captured epoch (§6.4/§6.7.4's growth path), the query first compares
  `_placementRevisionByEpoch.get(epoch)` against its **own** `expectedRevisionByEpoch.get(epoch)`. If
  they differ, some *other* write already happened that this query never accounted for — abort right
  there (§9.2, §10), **before** attempting the insertion at all. This pre-insertion check is what
  prevents the query from silently absorbing a foreign change into its own bookkeeping: without it, a
  query that inserts unconditionally and merely updates its own `expectedRevisionByEpoch` to whatever
  the resulting revision number happens to be would mask an intervening external bump it never
  actually validated against (its own next self-consistent update would make current and expected
  match again, and the external change would never be caught).
- If the pre-insertion check passes, the insertion and the resulting `_placementRevisionByEpoch`
  increment happen synchronously, and — in that same synchronous step, before any further await — the
  query updates its **own** `expectedRevisionByEpoch.set(epoch, newRevision)` to match.
- The mid-query revalidation (§9.2) compares `_placementRevisionByEpoch.get(epoch)` against **this
  query's own tracked `expectedRevisionByEpoch.get(epoch)`**, not the original entry-time value, at
  every checkpoint/shared-await/return boundary point 7 already requires. A mismatch found there means
  some write happened to that epoch's revision that this query did **not** itself perform and account
  for via the pre-insertion check above — i.e., a different concurrent caller's extraction growth, or
  an explicit `invalidateModelPlacement` call from anywhere — and that is exactly the condition that
  must abort the query (§9.2, §10).

**Consequence, stated plainly**: this makes the abort condition uniform and simple — "any revision
change to a captured epoch not caused by this query's own synchronous writes aborts the query" —
rather than trying to distinguish "benign growth from another caller" from "alignment-caused
invalidation" at the point of decision. The cost is real and worth naming: a long-running cross-model
query racing a *different*, unrelated `findClashes` call that happens to admit new fragments into a
captured epoch will abort and must be retried by its caller, even though no alignment ever happened.
This is treated as an acceptable, symmetric extension of the already-accepted §9.2.4 contract
("eviction of any captured model aborts the whole query, full stop, no partial-federation result") to
a second class of uncoordinated change, not a new category of strictness invented for this pass alone.

#### 6.7.6 Compatibility

Every M1/M2 identity, lifecycle, and eviction/disposal invariant already established (§4.1, §6.6) is
unaffected — `invalidateModelPlacement` only touches the new `_placementRevisionByEpoch`/
`_placementInvalidatedAtRevision` tables and the TLAS cache, never `_instanceCache`, `_modelByEpoch`,
`_modelLifecycle`, or `_liveEpochs`. `evictModel`/`dispose` gain no new responsibility beyond §6.6's
existing `Map.delete`/`Map.clear` calls for the new tables, since an evicted epoch's placement state is
already released at the same boundary.

---

## 7. TLAS traversal and candidate generation

### 7.1 Default M2 query shape: per-source-instance query against a target TLAS

The architecture-review consult for this spec identified a real scheduling hazard in the naive
"TLAS-vs-TLAS" design and this section adopts its recommendation as the M2 default.

`three-mesh-bvh`'s exported `bvhcast` (`core/cast/bvhcast.js`) is **synchronous, non-resumable, and
guarded by module-global `_active` state with no `try/finally`** (`bvhcast.js:17-30`) — an escaping
callback exception poisons every later traversal in the process until manually cleared. M1 already has
first-hand experience with exactly this hazard: `SurfaceIntersectionQuery.js:44`'s own callback
already wraps its body in explicit exception containment for precisely this reason when driving a
single `MeshBVH`-vs-`MeshBVH` `bvhcast`. Two more constraints compound this for a *TLAS*-vs-TLAS
traversal specifically: it cannot yield/checkpoint mid-traversal (frameBudgetMs has no hook inside a
`bvhcast` call — the same "atomic, unbounded, accepted risk" category M1 already documents for
`ProperCrossingQuery`/`SurfaceIntersectionQuery`'s own bvhcast-driven narrow phase, §9.1), and a large
mutual-overlap region between two big federated models could synchronously materialize a very large
candidate list before any checkpoint boundary is reachable at all.

**M2's default broad-phase query pattern** instead queries the **target** epoch's cached TLAS **once
per admitted source `CollisionInstance`**, using the TLAS's own single-shape traversal (the generic
`BVH` base class's box-query traversal, over the source instance's own `worldBounds` transformed into
the target epoch's frame) rather than a second, source-side TLAS. This is a deliberate asymmetry:

- The stated acceptance workflow's source is always **one selected element** — typically a handful of
  fragments, not a whole federated model. Building a *source*-side TLAS for that case is pure
  overhead; iterating its (small) instance list directly and querying each one against the (larger,
  cached, reused-across-calls) target TLAS is both simpler and faster for the actual workflow this
  spec is designed around.
- Each per-source-instance query is a **natural checkpoint boundary** — the existing
  `checkpoint({label: 'broad-phase-scan'})` call site (`CollisionWorld.js:773`) becomes
  `checkpoint({label: 'tlas-broad-phase-query', loadEpoch: sourceEpoch})` around each per-instance TLAS
  query, preserving M1's existing "checkpoint between iterations of the outer loop" granularity with
  no new scheduling primitive.

### 7.1a Target-scope membership filter (`[review fix, Critical #3a]`)

**A gap in the first draft, confirmed and fixed here.** A target epoch's TLAS (§6) is built over
**every** instance admitted for that epoch, regardless of which particular `dbIds` any one
`findClashes` call's `targets` entry asked for — the TLAS is a per-epoch cache reused across calls
(§6.4), not scoped to one call's requested dbId subset. Left unfiltered, a query with an explicit
`targets: [{model, dbIds: [10]}]` entry against an epoch whose TLAS (built for, or reused from, an
earlier broader query) contains dbIds `10, 11, 12` would emit candidates for all three, silently
returning results for elements the caller never asked about.

**`[targeted design-resolution, correctness fix]` Required filter — corrected from the first draft's
`ownerDbId`-vs-requested-`dbIds` comparison, which was wrong for an assembly-rooted target request.**
§4.4 already establishes, for the *source* side, that `extractFragments`'s first-discovery-wins capture
assigns each fragment's `ownerDbId` to whichever tree node the walk *directly* discovered it under —
for an assembly-rooted selection, a descendant fragment's `ownerDbId` can be a **child** dbId different
from the single dbId actually requested. The same is true on the **target** side: a `targets` entry
requesting `dbIds: [ASSEMBLY_ID]` produces extracted fragments whose individual `ownerDbId` values are
the assembly's *children*, not `ASSEMBLY_ID` itself. A filter that checked
`matchedPrimitive.ownerDbId ∈ requestedDbIds` directly (the first draft of this section) would
therefore **incorrectly exclude** every one of those legitimate descendant fragments — a false-negative
correctness bug, not merely an imprecision, caught during this pass by an independent `codex-advisor`
review before being written here (see the disposition report).

**Corrected filter**: for each `targets` entry with explicit `dbIds`, build the entry's own
extracted-fragment-membership set once per call — `extractFragments(model, dbIds, epoch)`'s own output
`Map<fragmentId, ...>` (the same primitive §4.4 already uses for source self-exclusion) — and check
`matchedPrimitive.fragmentId ∈ thatEntrysExtractedFragmentIds` (still an O(1) `Set`/`Map.has` per
candidate; the cost of computing the membership set itself is paid once per call, not per candidate). A
`targets` entry that omits `dbIds` (whole-model scope, §3.2) still applies no filter — every matched
primitive in that epoch is in scope, by definition, unchanged from the first draft.

**Duplicate/overlapping `targets` entries for the same model**: if two or more `targets` entries name
the same `Model` object (§9.2 point 1 already collapses these to one *lease*, but not, in the first
draft, one *filter*), their extracted-fragment-membership sets are **unioned** into one effective
per-epoch filter for that model — never queried as two separate per-entry TLAS passes, which would
otherwise perform genuinely duplicate traversal work against the same target epoch. If **any** entry
for that model omits `dbIds` (whole-model scope), whole-model scope wins for that epoch — a broader
entry is never narrowed by a coexisting narrower one. This closes a real gap the first draft of §9.2
point 1 only addressed at the lease level, not the filter level.

This filter — corrected or not — remains per-call, not baked into the cached TLAS entry itself: the
same cached tree correctly serves both a narrow explicit-`dbIds` query and a later whole-model query
against the same epoch, with the filter (not the tree) carrying the difference.

### 7.1b Candidate dedup and ordering (`[review fix, Critical #3, partial]`)

The M2 prompt's own required-scope list (§"Candidate ownership/dedup") asks for deterministic
candidate ordering and no duplicate narrow-phase work. Two mechanisms already in this spec, restated
together here for traceability: §3.4's `(sourceEpoch, sourceDbId, targetEpoch, targetDbId)` dedup key
prevents a duplicate *result* pair. **Candidate-level dedup (preventing the narrow phase itself from
re-running on the same `(sourceFragmentId, targetFragmentId)` pair twice within one call) is resolved
by this pass, `[targeted design-resolution]`, as: no dedup mechanism is required for M2's adopted
traversal pattern, because that pattern is structurally dedup-free by construction** — not because a
dedup step was added. This holds given the following binding invariants, which this spec now commits
to as part of §5.2/§7.1's contract, not left implicit:

- the packed tree partitions primitives into disjoint leaf ranges (one primitive-buffer entry per
  `(loadEpoch, fragmentId)`, one root range, no overlapping ranges) — a property `buildPackedTree`
  already guarantees and §5.2 already requires the adapter to preserve;
- M2 performs only the single-shape query pattern adopted in §7.1 (one box query per admitted source
  `CollisionInstance` against one target epoch's TLAS) — never the deferred TLAS-vs-TLAS `bvhcast`
  (§7.2), which is the only traversal shape where the same candidate pair could plausibly be reached
  via two different traversal branches;
- each admitted source instance is queried exactly once per call (§7.1's own iteration), and each
  distinct target epoch is queried exactly once per source instance (§7.1a's union-filter resolution,
  above, folding duplicate `targets` entries into one query rather than one query per entry);
- a traversal attempt that aborts (e.g. the candidate-budget exhaustion in §9.3, or a placement-refresh
  publish failure retried per §6.7.3) always starts its candidate accumulation fresh on retry — never
  appends to a partial array left over from a discarded attempt.

Given these, a single per-source-instance traversal cannot emit the same target primitive twice, and
the traversal pattern as a whole cannot reach the same `(sourceFragmentId, targetFragmentId)` pair via
two independent paths. **If the deferred TLAS-vs-TLAS `bvhcast` (§7.2) is ever adopted**, this
conclusion no longer holds automatically — that is exactly the point at which a real candidate-level
dedup mechanism would need to be designed, consistent with `bvhcast` already being deferred rather than
adopted in M2. Deterministic ordering: `_runBroadPhaseScan`'s existing per-call, insertion-order candidate list is preserved
unchanged for `broadPhase:'linear'`; the TLAS path's own candidate order is a function of the packed
tree's own build order (deterministic for a fixed input set and build-strategy configuration, §5.2,
but not defined here to match the linear path's specific order) — §12's differential fixtures compare
*result sets*, not candidate order, so this does not block correctness, only exact statistics
reproducibility across the two paths.

### 7.2 TLAS-vs-TLAS `bvhcast` — deferred, not rejected

A future optimization for source operands with many fragments (e.g. a selected assembly with
thousands of members) remains available, gated on:

- Calling the class's own exported `BVH.prototype.bvhcast` method (never the internal standalone
  `bvhcast` function `core/cast/bvhcast.js` exports directly) — the documented, typed entry point.
- Explicit callback-exception containment around the `intersectsRanges` callback, matching
  `SurfaceIntersectionQuery.js:44`'s existing pattern.
- A measured, bounded traversal cost — this is a "measure before adopting" optimization per the M2
  prompt's own performance-gate discipline (§14), not a day-one requirement.
- The same exact-retest requirement as §7.3 below (leaf-range matches from a TLAS-vs-TLAS traversal
  are exactly as coarse as leaf matches from a single-shape query).

Not required for M2's initial acceptance criteria; §14's performance gate may recommend adopting it
if the per-source-instance query pattern proves insufficient at realistic federated scale — that
recommendation, if made, is this spec's own explicit invitation to revisit, not a scope violation.

### 7.3 Candidates are coarse — exact retest is mandatory

Packed BVH node bounds are stored as `Float32` and may be padded (a general property of the packed
node-buffer representation `buildPackedTree` produces, not specific to this adapter). A TLAS leaf
match — whether from a single-shape query or a future `bvhcast` — names a **primitive-range**
candidate, not a verified-overlapping pair. **Every TLAS-emitted candidate pair is retested with M1's
own existing exact-inclusive predicate**, `_testBroadPhasePair` (`CollisionWorld.js:786-792`), reused
verbatim, before being handed to the narrow phase. This holds even when a leaf's primitive count is
exactly one — a single-primitive leaf's own *node* bounds can still be a padded superset of the
primitive's own exact `worldBounds`.

This retest step is what makes the required invariant (§12) achievable exactly as literally stated,
rather than only approximately:

> `TLAS candidate/result semantics == linear oracle semantics` for equivalent inputs.

Precise statement this spec commits to: the TLAS broad phase's **candidate set** is permitted to be a
**superset** of the linear oracle's candidate set (coarser node bounds can admit more false-positive
candidate pairs than an exact O(n×m) AABB scan would) — but because every candidate, from either
source, is retested with the identical exact predicate before narrow phase runs, the **narrow-phase
input set**, and therefore the **final result set**, is required to be **exactly equal**, not merely
"close," between the two broad-phase implementations, for any given fixture. §12 formalizes this as a
differential test requirement.

### 7.4 `broadPhase: 'linear'` fallback

Unchanged M1 `_runBroadPhaseScan`/`_testBroadPhasePair` (`CollisionWorld.js:765-792`), reachable via
the new `broadPhase` option (§3.5). For a cross-model call, this runs once per `(sourceEpoch,
targetEpoch)` pair in the query's operand set — same O(n×m) shape as M1, just invoked per involved
model pair rather than once for the whole (single-model) call.

### 7.5 `Statistics` field contract for the TLAS path — resolved

**Resolved by this pass**, closing the ambiguity §7.1b/§14.3 both flagged ("candidate count" meaning
three different things) and finalizing the field-level shape §16's compatibility table previously left
open.

#### 7.5.1 New additive fields

All new fields are always present in `Statistics` (`emptyStatistics()`, `CollisionWorld.js:191-206`,
gains these alongside its existing zero-defaulted fields, the same pattern `blasBuilt`/`blasCacheHits`
already use) and default to `0` — never conditionally omitted, including for `broadPhase: 'linear'`
calls and for a call that returns zero results:

| Field | Stage | Meaning |
|---|---|---|
| `tlasLeafRangeEmissions` | 1 | Raw TLAS leaf/range hits from traversal, summed across every per-source-instance query in the call, *before* expansion into per-primitive candidates. |
| `tlasPrimitiveCandidatePairs` | 2 | Every individual primitive-index candidate produced by expanding a leaf/range match, summed across the whole call, counted *before* the target-scope filter (§7.1a) and source self-exclusion (§4.4) are applied. This is exactly the running counter §9.3.1 checks against `maxTlasCandidatePairs`. |
| `tlasExactRetestSurvivors` | 3 | Candidates that passed `_testBroadPhasePair` (§7.3), summed across the call. |
| `tlasNarrowPhaseInputPairs` | 4 | Unique fragment pairs actually handed to narrow phase. Equal to `tlasExactRetestSurvivors` for M2's adopted traversal pattern, given §7.1b's structural no-dedup guarantee — kept as a separate field anyway, both for forward-compatibility with a future `bvhcast` path (§7.2) where the two could genuinely diverge once real dedup is needed, and because an unexpected divergence under M2's current design would itself be a useful bug signal in a test assertion. |
| `tlasBuilds` | — | Count of TLAS builds/rebuilds *this call itself* performed (§6.4/§6.7.3), whether triggered by growth staleness, invalidation staleness, or a first-ever build for a never-built epoch. |
| `tlasCacheHits` | — | Count of times this call found an already-warm, non-stale `TlasEntry` and queried it directly with no build/refresh. |
| `tlasSharedBuildWaits` | — | Count of times this call had to await a *different* concurrent caller's already-in-flight build/refresh (§6.3's single-flight sharing) rather than performing or avoiding a build itself. Without this field, `tlasBuildMs: 0` alone cannot distinguish "this call's target TLAS was already warm" from "this call spent its whole broad phase blocked waiting on someone else's build" — a distinction the performance gate (§14) needs. |
| `tlasBuildMs` | — | Wall-clock time *this call itself* spent performing a build (§6.4) or a placement refresh (§6.7.3) it initiated — `0` for a cache hit and `0` for a call that only awaited another caller's shared build (that wait is reflected in `broadPhaseMs`, not here — see §7.5.3). |
| `tlasQueryMs` | — | Wall-clock time this call spent in its own synchronous TLAS traversal, primitive expansion, filtering, and exact-retest work (stages 1-3 above), locally timed per call. |

#### 7.5.2 Cross-path field semantics and the inequality chain

**`broadPhasePairs` (existing M1 field, `CollisionWorld.js:193,775`) is generalized, compatibly, to one
canonical cross-path meaning: the count of candidate pairs whose exact `_testBroadPhasePair` predicate
was evaluated during broad phase.** This is not a behavior change for any existing caller: under
`broadPhase: 'linear'` the field's numeric value is byte-for-byte unchanged (the linear scan already
retests every one of its Cartesian pairs, so "pairs examined" and "pairs exact-retested" already
coincide exactly for that path, per the code as it stands today — this is a documentation-level
generalization of an already-true fact, not a new computation). Under `broadPhase: 'tlas'`,
`broadPhasePairs` counts every candidate that survived the target-scope/self-exclusion filters and was
handed to `_testBroadPhasePair` — **not** `tlasPrimitiveCandidatePairs` (an earlier draft of this
resolution incorrectly claimed these two were equal; they are not, because filtering happens between
expansion and the exact retest, and filtering is expected to remove real candidates in the ordinary
case, e.g. any query whose target scope is a proper subset of an epoch's admitted population).

This gives one field, one canonical meaning, directly comparable between the two broad-phase
implementations — satisfying "field names must have one canonical meaning" and "linear-vs-TLAS
comparability" simultaneously, rather than requiring a cross-reference table between differently-scoped
linear-only and tlas-only fields (the more conservative alternative this pass considered and rejected,
per the disposition report).

**The resulting inequality chain, which any TLAS-path statistics-consistency test should assert
directly:**

```
tlasPrimitiveCandidatePairs  >=  broadPhasePairs            (filtering removes candidates)
broadPhasePairs              >=  tlasExactRetestSurvivors    (not every retested pair passes)
tlasExactRetestSurvivors     ==  tlasNarrowPhaseInputPairs   (§7.1b's structural no-dedup guarantee)
tlasNarrowPhaseInputPairs    ==  narrowPhasePairs             (same set, same meaning, under either path)
```

`narrowPhasePairs` (existing M1 field, `CollisionWorld.js:194,739`) needs no change to its own meaning
— it is already model-agnostic (§8's "no change" finding) and equals `tlasNarrowPhaseInputPairs` for a
`broadPhase: 'tlas'` call, exactly as it already equals the linear path's own narrow-phase input count
today.

#### 7.5.3 Timing-field ownership under shared builds

`broadPhaseMs` (existing field, `CollisionWorld.js:201,727`) **keeps its existing end-to-end meaning
unchanged**: total wall-clock time this call's broad phase took, as observed by this call, including
any waiting/yielding at checkpoints — a superset measurement that `tlasBuildMs`/`tlasQueryMs` break
down further for a `broadPhase: 'tlas'` call, not a value either of those two replaces. Scheduler span
labels (`'tlas-build'`/`'tlas-broad-phase-query'`, §9.1) are global, shared-clock instrumentation and
must not be conflated with a single call's own attributable statistics under concurrency —
`tlasBuildMs` counts only work *this call itself* initiated (a build or refresh it started and is
responsible for), never time spent merely awaiting another concurrent caller's already-in-flight build
(that wait shows up in `broadPhaseMs`'s end-to-end total and in `tlasSharedBuildWaits`'s count, but
contributes `0` to this call's own `tlasBuildMs`).

---

## 8. Narrow-phase integration with M1

**No change.** This is a confirmed finding, not an assumption: `VolumeOverlapQuery`/
`ContainmentModeQuery`/`SurfaceIntersectionQuery`/`ContainmentQuery` all operate on the model-agnostic
`Instance` typedef (`{geometry, bvh, localDiagonal, connectivity, closedManifold, matrix,
aspectRatioExceeded}`, `VolumeOverlapQuery.js:19`) with zero model/dbId/identity awareness anywhere in
their own bodies — `toInstance()` (`CollisionWorld.js:132-142`) already strips identity before handing
operands to any query mode. `_runNarrowPhasePair` (`CollisionWorld.js:808-960`) needs exactly the
operand-locality changes described in §4.2 (per-operand `model`/`epoch` rather than one shared pair)
and nothing else — the actual collision math, tolerance model, and diagnostic shape are untouched.

`comparePlacedCanonically` (§4.1) needs no change — already total across models.

---

## 9. Scheduling/budget model

### 9.1 Extend the existing taxonomy; do not replace it

New labels, following the exact pattern `collision/scheduler.js`'s existing label taxonomy already
uses (`'broad-phase-scan'`, `'narrow-phase-pair'`, `'composed-narrow-phase-stage'`, weld/connectivity/
bvh-construction phase labels, §6 of the M1 inventory):

- `'tlas-build'` — reported the same way `GeometryRegistry._runPhase`'s weld/connectivity/
  bvh-construction phases already are: a local `performance.now()` timer bracketing the build,
  reported via `reportSpan(label, ms)` directly (`GeometryRegistry.js:173-217`'s own documented reason
  applies identically here — a shared, world-scoped checkpoint port's `lastSpanAt` baseline must not
  be corrupted by two concurrent builds resetting each other's clock).
- `'tlas-broad-phase-query'` — the per-source-instance query checkpoint (§7.1), following
  `'broad-phase-scan'`'s existing conditionally-synchronous checkpoint pattern exactly
  (`const pending = checkpoint({...}); if (pending) await pending;`).

**`frameBudgetMs` does not preempt synchronous atomic work, in M2 exactly as it already does not in
M1** — restated here verbatim per the M2 prompt's explicit instruction not to re-derive or
contradict this: the residual risk is latency on realistic input for the ceilinged (checkpointed) work,
and accepted, unbounded cost for atomic spans excluded from the budget by construction. A single TLAS
build (§6.4, one epoch's whole primitive-collection walk plus one `buildPackedTree` call) and a single
TLAS-vs-one-source-instance query traversal are each such atomic spans, in the same category M1
already accepts for `enumNodeFragments`'s per-node walk and `ProperCrossingQuery`/
`SurfaceIntersectionQuery`'s own non-preemptible bvhcast traversal — **not** a new kind of risk, an
instance of an already-accepted one.

### 9.2 Multi-model entry-order and liveness — the real scheduling change

This is the one place M2 does add genuinely new scheduling complexity, and the architecture-review
consult flagged the naive approach (validating only "whichever epoch is currently being processed" at
each checkpoint, via the existing `ctx.loadEpoch` override, `CollisionWorld.js:591-599`) as
insufficient: it satisfies liveness for the epoch currently in flight, but says nothing about a
*different* captured epoch being evicted while the call is busy on another one.

**Required semantics**, replacing `_checkEntryLifecycle`'s single-model check:

1. **Snapshot and deduplicate** every distinct model across `source` and every `targets` entry at
   query entry, before any extraction begins. Two `targets` entries naming the same `Model` object
   collapse to one lease.
2. **Admit/capture leases** for the whole snapshot up front (existing `admitModel`, called once per
   distinct model) — same lazy-admission behavior M1 already has, just for N models instead of one.
3. **New models loaded after this point are out of scope** for this call — federation is a snapshot at
   query entry, not a live-updating view.
4. **Eviction of any captured model aborts the whole query** — a cross-model `findClashes` call never
   returns a partial federation result silently missing an evicted model's contribution. This is a new
   explicit contract, stronger than "the epoch currently being touched is checked": every checkpoint
   in a cross-model call validates the **entire captured lease set**, not just the operand it happens
   to be processing at that moment — including during the empty-extraction fast path, which today can
   execute zero model-specific checkpoints at all (`CollisionWorld.js:688-691`'s existing early return
   is the precedent this must not silently bypass for a multi-model call).
5. **Practical mechanism**: a small composite wrapper around the existing per-call checkpoint port
   (`createCheckpointPort`, unchanged, §9.1) that, on every invocation, synchronously re-validates
   every captured epoch (`this._isEpochLive(epoch)` for each, `CollisionWorld.js:572-574`, already a
   cheap `Set.has` call) before deferring to the real port's own single-epoch-scoped validate/yield
   logic for the epoch that call site cares about. This requires no change to `collision/scheduler.js`
   itself — `createCheckpointPort`'s contract (`isDisposed`/`isEpochLive` callbacks,
   `scheduler.js:101-110`) already accepts an arbitrary `isEpochLive` predicate; the composite check
   is exactly such a predicate, closing over the captured lease set.
6. If M2 needs caller-initiated cancellation (an `AbortSignal`-shaped "the user navigated away, stop
   this query") that is **new functionality M1 has no equivalent of** — M1's checkpoint port validates
   only disposal and epoch eviction, never an external cancel signal. Not required by the stated
   acceptance workflow; flagged in §15 if a future requirement surfaces it.
7. `[review fix, Important #4]` **Point 5's composite checkpoint alone is not sufficient** — it only
   fires at existing checkpoint call sites, and two real gaps survive that: (a) an `await` on a
   *shared* resource this call did not itself checkpoint around — e.g. this call is waiting on
   another concurrent caller's in-flight TLAS build or `GeometryRegistry` entry for epoch A
   (§6.3/§6.4's own cancellation-race/single-flight sharing) while epoch B, also captured by this
   call, gets evicted — resumes with no checkpoint of its own at that exact resume point; (b) a
   successful **return**, including the empty-candidate/empty-extraction early-return path
   (`CollisionWorld.js:688-691`'s existing precedent), is not itself a checkpoint call site today,
   so a lease invalidated between the last checkpoint and the return is never caught. **Required
   fix**: the full-lease-set validation (point 4) additionally runs (i) synchronously immediately
   after every `await` on a shared/cross-caller resource, whether or not that resource's own
   internal logic already checkpointed, and (ii) synchronously immediately before every `return`
   statement in a cross-model `findClashes` call, success or empty-result alike — not only at the
   existing per-iteration checkpoint call sites.
8. **`[targeted design-resolution]` The composite checkpoint additionally revalidates captured
   placement revisions, not just epoch liveness.** At every point that point 7 already requires (existing
   per-iteration checkpoints, immediately after any await on a shared/cross-caller resource,
   immediately before every return), the composite check also compares each captured epoch's current
   `_placementRevisionByEpoch` value against this query's own tracked `expectedRevisionByEpoch`
   (§6.7.5 — not the query's original entry-time snapshot, to avoid a query invalidating itself via its
   own ordinary extraction growth). A mismatch aborts the whole query with `ModelPlacementChangedError`
   (§10), the same "abort the whole query, never return a partial/possibly-stale result" contract point
   4 already establishes for eviction. **Validation precedence at each check point**: disposed
   (`WorldDisposedError`) → evicted/invalid lease (`ModelEvictedError`) → placement-revision mismatch
   (`ModelPlacementChangedError`) — checked in that order, matching the existing convention that a more
   fundamental lifecycle failure (the world itself, then the model's admission) is diagnosed before a
   narrower one (this model's placement). **Scope**: this revalidation applies only to a query running
   `broadPhase:'tlas'` for the epoch in question — a `broadPhase:'linear'` call never consults
   `_placementByEpoch`/a cached TLAS for its own correctness (§6.5) and would gain nothing from this
   check but spurious aborts from unrelated concurrent growth; a call that mixes modes across its
   operand set (not exposed in M2's own context-menu UI, but possible for a direct library caller
   passing an explicit per-call `broadPhase` override, §3.5) only revalidates placement revisions for
   the epochs it is actually consulting via TLAS.

### 9.3 TLAS candidate-budget semantics

**Resolved by this pass.** M1's Cartesian precheck, `_exceedsBroadPhaseCeiling(sourceCount,
targetCount)`/`maxBroadPhaseInstancePairs` (`CollisionWorld.js:698-703,760-763`), is checked once per
call, *before* any broad-phase work runs, because for the linear scan the total work **is** exactly
`sourceCount × targetCount` — a value computable with zero traversal cost. Under `broadPhase: 'tlas'`
this precondition does not hold: the whole reason a TLAS exists is that real traversal cost is **not**
proportional to the Cartesian product, and a precheck against that product would reject queries the
TLAS was built specifically to make cheap. **`maxBroadPhaseInstancePairs`/`_exceedsBroadPhaseCeiling`
is therefore not applied under `broadPhase: 'tlas'` at all** — a different budget model is required,
defined here.

#### 9.3.1 What is bounded, and where

A TLAS candidate count is not knowable in advance the way a Cartesian product is — nothing is known
about how many primitives a query box will actually hit until the traversal runs. The budget is
therefore an **incremental, checked-as-you-go running counter**, not an upfront precheck:

- **Counted quantity**: every individual primitive-index candidate produced when a TLAS leaf/range
  match (§7.1) is expanded into per-primitive candidates — **before** the target-scope membership
  filter (§7.1a) and source self-exclusion (§4.4) are applied to that candidate, and before the
  exact-AABB retest (§7.3) runs. This is deliberately upstream of both filters: the CPU/memory cost of
  expanding a leaf range into individual primitive candidates is already incurred at expansion time
  regardless of whether a given candidate is later filtered out, so bounding only the *post-filter*
  survivors would leave the actual unbounded-expansion work outside the budget entirely — exactly the
  gap a budget exists to close.
- **Scope**: one running counter for the **entire `findClashes` call**, accumulated across every
  admitted source `CollisionInstance`'s query against every distinct target epoch touched by that call
  — not reset per source instance and not reset per `(sourceEpoch, targetEpoch)` pair. This mirrors
  M1's own existing scope (M1's `_exceedsBroadPhaseCeiling` is checked once per whole call, since M1
  only ever has one source/target pair per call); the goal is bounding the aggregate cost of one
  `findClashes` invocation, and a per-pair-only ceiling would let total call cost grow unboundedly as
  `limit × (number of target epochs in the call)`. A federated call touching many target models each
  individually under a per-pair ceiling could still blow up in aggregate under a per-pair-only rule —
  the whole-call scope is what actually bounds the call.
- **New constant**: `maxTlasCandidatePairs` — the semantic contract (this section) is defined now; the
  tuned numeric value is deferred to implementation/the performance gate (§14), per the M2 prompt's own
  instruction not to invent a provisional ceiling ahead of measurement.

#### 9.3.2 Exhaustion behavior

Permit exactly `maxTlasCandidatePairs` expanded candidates for the call. On the attempted
`(limit + 1)`-th expansion, traversal for the current source-instance/target-epoch pair terminates and
the call throws:

```js
CapacityExceededError('tlas-candidate-budget', {
  limit: maxTlasCandidatePairs,
  completed: maxTlasCandidatePairs,
  attempted: maxTlasCandidatePairs + 1,
  sourceEpoch,   // the pair being processed when the ceiling was reached — diagnostic, not a
  targetEpoch,   // statement that the budget itself is scoped per-pair (it remains whole-call)
})
```

Reusing `CapacityExceededError` (`CollisionWorld.js:212-219`) with a new `kind` follows the class's own
existing discriminated-`kind` pattern (`'call-wide-unique-fragment-precheck'`/`'bucket-capacity'`
today) rather than introducing a new error class — this failure mode ("too much candidate work for
this call") is the same semantic family as the existing kinds. **Required accompanying fix**: the
class's constructor message (`` `CollisionInstance admission rejected (${kind})` ``,
`CollisionWorld.js:214`) is specific to instance-admission failures and is misleading for a
traversal-exhaustion `kind` — generalize the message (e.g. a `kind`-keyed message lookup, or a more
generic template) as part of implementing this `kind`; this is a small, compatible touch to an
existing class's human-readable text, not a change to its `{name, kind, ...details}` structural
contract, so no consumer reasonably depending on that shape is affected.

**Deterministic, no silent truncation**: exhaustion always throws — a call that hits the ceiling never
returns a partial `pairs` result silently reported as complete, matching M1's own "no criterion
silently converted to a pass" discipline (§14) and the general "abort rather than return a
possibly-wrong result" posture this spec already commits to for lifecycle/placement hazards (§9.2,
§6.7).

#### 9.3.3 Callback-safe termination — do not throw from inside the traversal callback

`[targeted design-resolution, implementation-safety requirement]` §7.1 already documents that the
vendored traversal machinery's own callback-driven paths (`bvhcast`, and equally the
box-query/`shapecast`-family traversal `CollisionInstanceBVH`'s single-shape queries use) are **not**
wrapped in `try/finally` internally — an exception escaping a traversal callback can leave
module-global traversal state corrupted for every later call in the process. The candidate-budget check
therefore **must not** throw `CapacityExceededError` directly from inside the expansion callback.
Instead: when the running counter would exceed the limit, record the pending error in a call-scoped
variable and return the traversal API's own normal "stop, do not descend further" signal from the
callback (the same early-termination return-value convention the traversal already supports for an
ordinary "this subtree cannot match" result) — letting the traversal call return and clean up normally
— and only **after** the traversal call has returned to `CollisionWorld`'s own code does the stored
`CapacityExceededError` actually get thrown. This keeps the budget check symmetric with the exact
hazard §7.1 already flags for future `bvhcast` callback exception containment (§7.2's own
requirement), rather than reintroducing that hazard here.

#### 9.3.4 What this budget does not bound

Stated explicitly so the performance gate (§14) and any future reader do not over-read this section's
guarantee: this budget bounds primitive-candidate expansion, the resulting candidate storage, the
exact-retest work those candidates cause, and the narrow-phase input count that follows. It does
**not** bound a TLAS build itself (§6.4's `'tlas-build'` atomic span — already an accepted
unbounded-but-atomic cost category, §9.1), internal (non-leaf) BVH node visits that produce no
candidate, or the number of empty/disjoint per-source-instance traversals a call performs. Those remain
governed by the existing atomic-span acceptance already established in §9.1, unchanged by this section.

---

## 10. Diagnostics/error behavior

- **Whole-query abort on any captured-lease invalidation** (§9.2.4) is itself a diagnostic-relevant
  behavior change from M1's single-model semantics: M1's own errors (`WorldDisposedError`,
  `ModelEvictedError`) are unchanged in shape, but M2's `ModelEvictedError` can now be thrown for a
  model that is neither the current `source` nor the operand currently being processed — its
  `modelId` field (`errors.js:21-27`) still names the specific model that was evicted, so this
  remains diagnosable, just no longer necessarily "the one operand this call is obviously about."
- **Fragment-scoped diagnostics** (`geometry-not-yet-available`, oversized/unsupported-layout
  markers) are unchanged in shape (`{scope: 'fragment', reason, role, fragment: FragmentRef}`,
  `CollisionWorld.js:815-824`) — `FragmentRef` already carries `modelId`/`dbId`/`fragId`
  (`CollisionWorld.js:54-60`), so no shape change is needed, only the dedup-key fix (§4.2).
- **Pair-scoped diagnostics** (`unverified-parity-operand`, `inconclusive-containment`, etc.,
  `CollisionWorld.js:895-908`) are unchanged in shape for the same reason.
- **New diagnostic**: a TLAS build that itself fails to complete (e.g. hits an internal error building
  the packed tree, which the underlying `buildPackedTree` call could in principle throw for a
  malformed primitive set) is **not** silently treated as "no candidates from this epoch." It surfaces
  as a call-aborting error (consistent with M1's own "every yield-point checkpoint... must throw
  WorldDisposedError/ModelEvictedError, never swallow a lifecycle failure silently,"
  `scheduler.js:1-8`) rather than a diagnostic entry, since a TLAS build failure means the broad phase
  cannot be trusted for that epoch at all — this is categorically different from a single fragment's
  geometry being transiently unavailable.
- **New error, `[targeted design-resolution]`**: `ModelPlacementChangedError`, thrown when a
  cross-model query's mid-query placement-revalidation (§9.2 point 8) detects that a captured model's
  placement revision changed for a reason the query did not itself cause (§6.7.5) — distinct from
  `ModelEvictedError` because the model is still live; this is "the input may have moved out from under
  this in-flight query," a different diagnostic fact than "the model is gone," even though both abort
  the whole query under the same no-partial-result contract. Shape, mirroring `ModelEvictedError`'s own
  convention (`errors.js:21-27`) but carrying enough detail to distinguish a stale expectation from a
  live value, since `modelId` alone is not guaranteed unique under Viewer modelId reuse (§4.1):
  ```js
  ModelPlacementChangedError = { modelId, loadEpoch, expectedRevision, actualRevision }
  ```
- **Whole-model extraction capacity** (§3.3): a `targets` entry with `dbIds` omitted that would exceed
  `maxCollisionInstancesPerEpoch` throws the existing `CapacityExceededError` (`CollisionWorld.js:212-219`),
  unchanged shape, `kind: 'bucket-capacity'` or `'call-wide-unique-fragment-precheck'` exactly as
  today — no new error class needed.

---

## 11. Viewer extension/sample design

### 11.1 Placement

A focused new extension, `wwwroot/extensions/ClashFinderExtension.js`, alongside (not replacing)
`RoomLocatorExtension.js` — the M2 prompt allows either "extending the current sample extension
cleanly or adding a focused Clash Finder extension"; a separate extension is preferred because Find
Clashes has a materially different UX shape (isolate-the-clash-set vs. Room Locator's
isolate-the-containing-room) and a different default query mode, and keeping them separate avoids
growing Room Locator's own already-reviewed, accepted surface.

### 11.2 UX definition (per the M2 prompt's required coverage)

- **Exactly one selected source element**: enabled path, described in §2. `[review fix, Critical #5]`
  Determined via `viewer.getAggregateSelection()` (§2 step 2), not `viewer.getSelection()` — the menu
  entry's own enabling condition is "the aggregate selection array has exactly one entry, and that
  entry's `selection` array has exactly one dbId," which also directly yields the source's own `Model`
  object (`entry.model`) with no further resolution step.
- **No selection**: context-menu entry does not appear — the `getAggregateSelection()` array is empty.
  Same intent as `RoomLocatorExtension.onContextMenu`'s own `if (!status.hasSelected) return;` guard
  (`RoomLocatorExtension.js:222-223`), restated against the aggregate-selection API this extension
  actually needs.
- **Multiple selection**: **unsupported in M2** (matches the M2 prompt's own "if unsupported" framing
  for this case, and the acceptance workflow only ever describes one selected source element) — the
  menu entry does not appear when the aggregate selection spans more than one model, or one model with
  more than one dbId selected. Room Locator's own single-model `viewer.getSelection()` guard
  (`RoomLocatorExtension.js:224-226`, silently using only `selection[0]`) is not reused here: "locate
  the room for element X" is well-defined even honoring only the first of several selections; "find
  clashes for a set of elements" is not the same well-defined question, so hiding the entry rather than
  silently picking one element is the correct default.
- **Result highlight/isolation**: `viewer.isolate(dbIds, model)` + `viewer.fitToView(dbIds, model)`
  per involved model — `[review fix, Critical #4]` both take a concrete `Model` as their second
  argument (`node_modules/@types/forge-viewer/index.d.ts:1250`), so this uses each result's own
  `pair.target.model`/`pair.source.model` object reference (§3.4), not a `modelId`-based lookup. Room
  Locator's own single-model call (`RoomLocatorExtension.js:249-250`) omits the `model` argument only
  because M1 never has more than one model in play; that omission does not carry over to a federated
  call site.
- **Clearing/restoring visualization**: `viewer.isolate([], model)` per involved model — same
  correction as above, no new mechanism needed otherwise.
- **Same-model vs. cross-model result identification**: `[review fix, Critical #4]` the UI's result
  summary distinguishes "N clashes found (M in this model, K in other models)" by comparing each
  `ClashPair.target.model` against the source's own `model` **by object identity** (`===`), never by
  comparing `modelId` values — `modelId` is documented as reused-under-collision-prone and
  non-load-bearing (§4.1), so a `modelId`-based comparison could misclassify a cross-model result as
  same-model (or vice versa) if two loaded models happen to share a `modelId`.
- **Diagnostics/caveats**: reuse `RoomLocatorExtension.describeDiagnostics`/`_notifyUser`'s exact
  pattern (`RoomLocatorExtension.js:210-220,235-247`) — the M2 prompt's own requirement ("skipped/
  unsupported/inconclusive geometry must surface diagnostics rather than silently appearing as 'no
  clash'") is word-for-word the same requirement M1's Room Locator sample already satisfies; this is
  not a new UX pattern to design, just a second consumer of an existing one.

### 11.3 Engine/UI coupling

Per the M2 prompt's own instruction ("Do not couple the engine to Viewer UI state") and matching M1's
existing discipline (`RoomLocatorExtension.js`'s own header comment: "Depends ONLY on CollisionWorld's
public surface... never reaches into CollisionWorld internals") — `ClashFinderExtension` is pure UI
glue over `collision/index.js`'s public exports plus the new `targets`/`broadPhase` fields on
`findClashes`. No engine code lives in the extension.

---

## 12. Correctness fixtures

### 12.1 Differential requirement (restated precisely from §7.3)

For every fixture in this section: run the identical query twice, once with `broadPhase: 'tlas'` and
once with `broadPhase: 'linear'`. Required: **identical final `pairs` sets** (as sets of
`(sourceEpoch, sourceDbId, targetEpoch, targetDbId)` tuples — order is not compared, matching M1's own
"insertion-order, not canonicalized" result-ordering disclaimer, `collision/README.md:112-113`).
`statistics` numeric fields (pair/candidate counts, timings) are **not** required to match — the TLAS
path's candidate count may legitimately exceed the linear oracle's (§7.3), only the post-retest,
post-narrow-phase result set must match exactly.

### 12.2 Fixture set

- **Single-model, single geometry pair, known Hard Clash** — the simplest possible case; confirms the
  TLAS path reduces correctly to M1's existing single-model behavior with zero regression.
- **Single-model, known non-clash (AABBs overlap, volumes don't)** — confirms the retest step (§7.3)
  correctly discards a TLAS-coarse false-positive candidate before it reaches (and could be
  misreported by) the narrow phase.
- **Two-model federation, known cross-model Hard Clash** — the core new M2 scenario: source in model
  A, a real volume-overlap target in model B, correct `(modelId, dbId)` provenance on both operands.
- **Two-model federation, source has a same-model AND a cross-model Hard Clash** — confirms both
  target epochs are queried and both results aggregate correctly into one `pairs` array.
- **Source self-exclusion** — a target `dbIds` set that includes the source's own `(loadEpoch, dbId)`
  (per §4.4's definition) must never appear in `pairs`, for both broad-phase implementations.
- **Whole-model target scope, dense model** — `targets: [{model}]` (no `dbIds`) against a model with
  enough fragments to meaningfully exercise `maxCollisionInstancesPerEpoch`'s ceiling at a
  non-trivial fraction (not necessarily to the ceiling itself) — confirms §3.3's whole-model
  extraction primitive produces the same admitted-instance population `extractFragments`-by-dbId-list
  would for the same nominal element set.
- **Model eviction mid-query, cross-model call** — start a federated `findClashes` call spanning
  models A and B, evict B before the call resolves (e.g. via a test double invoking `evictModel`
  during an injected yield point, matching M1's own existing test pattern for single-model eviction
  races) — confirms the whole call throws `ModelEvictedError` (§9.2.4) rather than returning a
  partial A-only result.
- **Zero clashes, correct negative** — a known-negative element against the full federated target set
  returns `pairs: []` with no diagnostics, distinct from a diagnosed-incomplete negative (next
  fixture).
- **Diagnosed incomplete result** — a target fragment whose geometry triggers
  `geometry-not-yet-available`/an oversized marker; confirms the diagnostic carries correct per-operand
  `modelId` even when the diagnosed fragment belongs to a different model than the source.

---

## 13. Federated live acceptance

Mirrors M1's own acceptance-test shape (`test/acceptance/room-locator.acceptance.mjs`,
`test/acceptance/README.md`) rather than inventing a new acceptance methodology:

- **Setup**: a real Viewer session with **at least two loaded models** (federated), one containing a
  known source element with at least one Hard Clash in the same model, and at least one Hard Clash in
  the other loaded model. A known expected `{model, dbId}` result set is established in advance
  (matching M1's own "907 of 1003 vertices classify inside that room" style of ground-truth
  documentation, `collision/README.md:253-257`) — the exact model(s) to use for this are not chosen by
  this spec; §15 flags sourcing a suitable two-model federated fixture as an open item, same category
  as M1's own "no purpose-built MEP sample model" finding
  (`milestone-1-performance-gate-disposition.md`'s own "Model used" section) — expect the same kind of
  substitution/justification exercise, not a blocker unique to M2.
- **Also include a known negative element**: select source → right-click → Find Clashes → verify
  "No clashes found," on the same federated setup.
- **Run**: select known source → right-click → **Find Clashes** → verify:
  - exact expected `{model, dbId}` elements returned, no more, no fewer;
  - correct per-result model provenance (same-model results and cross-model results both correctly
    labeled);
  - correct Viewer visualization (isolation/fit, per §11.2);
  - no duplicate results (confirms the §4.2 dedup-key fix);
  - source excluded from its own results (confirms §4.4).
- **Automation**: Playwright-driven, matching `room-locator.acceptance.mjs`'s existing launch-args/
  sandbox posture (`--no-sandbox --disable-dev-shm-usage --single-process --no-zygote`, already
  required in this dev sandbox per that file's own header comment) — no new automation approach
  needed.

---

## 14. Performance gate

Mirrors `test/performance/run-gate.mjs`'s and
`docs/superpowers/specs/milestone-1-performance-gate-disposition.md`'s exact shape and rigor —
cold/warm protocol, honestly-recorded `NOT EXERCISED` criteria where the available test model can't
trigger them, no criterion silently converted to a pass.

### 14.1 What must be demonstrated (per the M2 prompt's own explicit gate)

**Measurable candidate-search benefit of TLAS over M1's linear broad phase, on a realistic
federated/fragment-dense case — architectural complexity is not accepted without this evidence,**
exactly as the M2 prompt states. This spec does not presume the outcome; it specifies the protocol
that will produce the evidence.

### 14.2 Protocol

One `volume-overlap` federated query (source in model A, targets = all currently loaded models
including A), run with `broadPhase: 'tlas'` and again with `broadPhase: 'linear'`, on the same
federated model set, cold (no TLAS/BLAS cached) then warm (both fully built/cached) for the TLAS path.

### 14.3 Criteria (extending M1's numbered list, same evidentiary standard)

1. TLAS build cost per epoch (cold), reported via the new `'tlas-build'` span label (§9.1).
2. TLAS query cost per source instance, cold vs. warm (target TLAS already cached from a prior call).
3. Candidate count: TLAS path vs. linear-oracle path, for the identical query — TLAS's count is
   expected to be smaller for a realistic federated/fragment-dense case per the M2 prompt's own
   framing, but this spec requires it be **measured**, not assumed. `[targeted design-resolution]`
   `Statistics`'s field-level shape for this is now finalized (§7.5): record
   `tlasLeafRangeEmissions`, `tlasPrimitiveCandidatePairs`, `broadPhasePairs`,
   `tlasExactRetestSurvivors`, and `tlasNarrowPhaseInputPairs` separately for the TLAS run, and
   `broadPhasePairs`/`narrowPhasePairs` for the linear run — §7.5.2's inequality chain is what makes
   the two paths' numbers actually comparable, not a single shared field claimed to mean all stages
   at once.
4. Wall-clock: TLAS path (cold, then warm) vs. linear-oracle path, for the identical query.
5. Memory/cache behavior: TLAS entry retained size, and its growth relative to `_instanceCache`'s own
   already-measured retention behavior (M1's own criterion 12,
   `milestone-1-performance-gate-disposition.md`'s table — this is a direct extension of an existing
   measured criterion, not a new methodology). Report `tlasBuilds`/`tlasCacheHits`/
   `tlasSharedBuildWaits` (§7.5.1) alongside cold/warm timing so a `0` `tlasBuildMs` on a given run can
   be attributed correctly (already-warm cache vs. blocked on another caller's in-flight build) rather
   than read as ambiguous.
6. Fragment/instance counts for whichever federated model set is actually used — recorded plainly,
   same convention M1's own gate uses to make every criterion's scale explicit and auditable.

### 14.4 Model sourcing

Same open item M1's own gate faced and resolved by substitution-with-justification
(`milestone-1-performance-gate-disposition.md`'s "Model used, and how suitability was confirmed"
section) — M2 additionally needs **two or more** such models loaded simultaneously to exercise
federation at all. Not resolved by this spec; flagged in §15.

---

## 15. Risks / open questions

Ranked by how much they gate implementation start, most-blocking first. Updated after an independent
`codex-review spec` pass (medium effort) — items marked `[resolved]` were open in the first draft and
are now settled by direct evidence; items marked `[new]` were surfaced by that review and were not in
the first draft at all.

1. ~~Placement-freshness assumption for a cached TLAS (§6.5) — requires explicit human
   confirmation.~~ **`[resolved]`** Human decision made: M2 must support model-alignment/move/rotate
   invalidating a cached TLAS; explode/animation/arbitrary per-fragment dynamic transforms remain
   unsupported. Resolved via an explicit, caller-controlled `invalidateModelPlacement(model)` (§6.7),
   layered on the same `_placementRevisionByEpoch` staleness mechanism §6.4 already established, with
   a generational `_placementInvalidatedAtRevision` marker, a staged/atomically-published refresh
   (§6.7.3), and a query-self-invalidation-avoidance rule (§6.7.5) needed once a query's own ordinary
   growth is distinguished from an externally-caused revision change. See §6.5 for the resulting
   placement-freshness contract.
2. ~~Authoritative Viewer API for "every currently loaded model."~~ **`[resolved]`** Confirmed:
   `viewer.getAllModels(): Model[]` (`node_modules/@types/forge-viewer/index.d.ts:1272`) — see §3.2.
   Source-model resolution is similarly resolved via `viewer.getAggregateSelection()`
   (`index.d.ts:1267`) — see §2, §11.2. Both were open questions in the first draft of this spec;
   the review that flagged the first draft's unverified assumption that the existing app's loading
   path already supports multiple simultaneous models was itself independently confirmed against
   `wwwroot/viewer.js:38-48` (no `keepCurrentModels`) — see item 8 below, which replaces this one as
   the actually-open item in this category.
3. **Source self-exclusion granularity (§4.4).** Default corrected (via review) to: exclude by the
   source operand's entire extracted fragment set (`(loadEpoch, fragmentId)` membership), not
   dbId-level equality — still needs confirmation against the actual acceptance workflow's real
   fixture models to know whether this finer granularity is actually exercised or whether the
   simpler dbId-only rule would have been equally correct for the real fixtures chosen. Cheap to
   change before implementation, expensive to change after the acceptance fixtures in §12/§13 are
   built against a specific answer.
4. **Two-or-more-model federated fixture sourcing (§13, §14.4).** Same category of problem M1's own
   performance gate solved via a documented substitution — flagged here so it's anticipated, not
   rediscovered mid-implementation.
5. **Whether TLAS-vs-TLAS `bvhcast` (§7.2) is ever actually needed.** Deferred by design; §14's
   performance gate is the mechanism that would surface a real need (a source-heavy scenario where
   per-source-instance querying measurably underperforms).
6. **Caller-initiated cancellation (§9.2.6).** Not required by the stated acceptance workflow; flagged
   only so a future requirement for it is recognized as new functionality, not an oversight in this
   spec.
7. **`CollisionInstanceBVH`'s dependence on `BVH`'s internal-but-shipped contract (§5.2).** Bounded by
   the required contract-test mitigation; not blocking, but the mitigation itself (writing those
   contract tests) is implementation work this spec is flagging as required, not optional.
8. **`[new]` App-side loading-path change is now in scope, not a precondition.** §2/§11 now require
   `wwwroot/viewer.js`'s model-loading call site to pass `keepCurrentModels: true` for a federated
   session (confirmed the current code does not, `wwwroot/viewer.js:38-48`) — this is a small but real
   app-level change this spec's implementation must include, not something "the existing app already
   does." Not blocking (the fix is simple and now specified), but flagged so it is not missed as an
   implementation-planning line item.
9. ~~Candidate-budget/precheck semantics under `broadPhase:'tlas'` are undefined.~~ **`[resolved]`**
   Resolved in §9.3: `maxBroadPhaseInstancePairs`'s Cartesian precheck is not applied under
   `broadPhase:'tlas'`; a new `maxTlasCandidatePairs` bounds primitive-candidate expansion (stage 2,
   pre-filter) with a whole-call-scoped, incremental, checked-as-you-go running counter, exhausted via
   a reused `CapacityExceededError('tlas-candidate-budget', ...)`, terminated callback-safely (§9.3.3)
   rather than by throwing from inside vendored traversal machinery. Resolving this also surfaced and
   fixed a genuine correctness bug in the already-accepted §7.1a target-scope filter (it compared a
   matched primitive's `ownerDbId` directly against a `targets` entry's requested `dbIds`, which
   silently produces false-negative exclusions for any assembly-rooted target request — the same
   `ownerDbId`-vs-requested-dbId hazard §4.4 already documents for source self-exclusion, not
   previously applied to the target side); see §7.1a's corrected text and the disposition report.
10. ~~`Statistics` field semantics need to be finalized for the TLAS path.~~ **`[resolved]`**
    Resolved in §7.5: five new additive candidate/traversal fields
    (`tlasLeafRangeEmissions`/`tlasPrimitiveCandidatePairs`/`tlasExactRetestSurvivors`/
    `tlasNarrowPhaseInputPairs`, plus build-attribution counters `tlasBuilds`/`tlasCacheHits`/
    `tlasSharedBuildWaits`) and two new timing fields (`tlasBuildMs`/`tlasQueryMs`, with explicit
    ownership semantics under shared/single-flight builds, §7.5.3). `broadPhasePairs` is generalized,
    compatibly (zero behavior change for `broadPhase:'linear'` callers), to one canonical cross-path
    meaning — count of candidates exact-retested — rather than kept linear-only; §7.5.2's inequality
    chain formalizes exactly how the paths' numbers relate and are compared.

---

## 16. M1 → M2 compatibility/invariant table

| M1 invariant | M2 disposition |
|---|---|
| `loadEpoch` global, monotonic, never reused, never scoped to modelId (`CollisionWorld.js:227`) | **Preserved unchanged.** This is the invariant M2's entire cross-model identity model is built on. |
| `GeometryIdentity` keyed `(loadEpoch, geometryIndex)`, never `modelId` (`GeometryIdentity.js`) | **Preserved unchanged.** |
| `GeometryRegistry`/`BlasCache` epoch-keyed, no `Model` object references (`GeometryRegistry.js`) | **Preserved unchanged.** Purely additive TLAS layer sits above it. |
| `comparePlacedCanonically` total order via `(loadEpoch, geometryIndex, fragmentId)` (`CollisionWorld.js:98-107`) | **Preserved unchanged** — already documented as cross-model-total. |
| `source.model !== target.model` → hard rejection (`CollisionWorld.js:498-510`) | **Removed**, replaced by the multi-lease entry order in §9.2. |
| `findClashes` result pair dedup key = `dbId:dbId` (`CollisionWorld.js:731,741`) | **Changed** to `(loadEpoch,dbId):(loadEpoch,dbId)` — §3.4/§4.2. |
| Fragment-diagnostic dedup key = bare `fragmentId` (`CollisionWorld.js:816-817`) | **Changed** to `(loadEpoch, fragmentId)` — §4.2. |
| `_runNarrowPhasePair`'s single call-level `model`/`epoch` (`CollisionWorld.js:808`) | **Changed** to operand-local `(model, epoch)` per side — §4.2, §8. |
| `_runBroadPhaseScan`/`_testBroadPhasePair` (`CollisionWorld.js:765-792`) | `_testBroadPhasePair` **reused verbatim** as the TLAS-candidate retest predicate (§7.3); `_runBroadPhaseScan` itself **kept unchanged** as the `broadPhase:'linear'` fallback path (§7.4), not deleted. |
| `extractFragments(model, requestedDbIds, ...)` per-dbId-subtree walk (`ViewerModelAdapter.js`) | **Preserved unchanged**, still used for explicit `dbIds` targets; a **new sibling primitive** `extractAllFragments` added for whole-model scope (§3.3), not a modification of the existing one. |
| `createCheckpointPort`'s `{isDisposed, isEpochLive, accumulator, yieldToScheduler}` contract (`scheduler.js:101-110`) | **Preserved unchanged** at the module level; `CollisionWorld` supplies a composite `isEpochLive` closing over a captured multi-epoch lease set for cross-model calls (§9.2.5) — no change to `collision/scheduler.js` itself. |
| `frameBudgetMs` does not preempt synchronous atomic work | **Preserved, restated, extended** to cover TLAS build/query as new atomic-span categories (§9.1) — no change to the underlying claim. |
| `ClashPair`/`Statistics`/diagnostic shapes (`CollisionWorld.js:743-748`, `errors.js`) | **`ClashPair` gains an additive `model` field per operand** (§3.4, `[review fix]` — `modelId` alone is not correctness-bearing under Viewer modelId reuse). **`Statistics` gains nine additive TLAS-path fields, finalized in §7.5**; `broadPhasePairs`'s canonical meaning is generalized (compatibly — zero behavior change for `broadPhase:'linear'`) to "candidates exact-retested," per §7.5.2. **New `ModelPlacementChangedError`** (§10, §6.7) joins the `WorldDisposedError`/`ModelEvictedError` lifecycle-error family. Existing fragment-/pair-scoped diagnostic entry shapes unchanged. |
| (M2-new) `_placementRevisionByEpoch` only tracked new-admission staleness (§6.4, first draft) | **Extended, not replaced** — the same counter also tracks explicit alignment invalidation (§6.7), disambiguated via a new generational `_placementInvalidatedAtRevision` marker; growth-only staleness still needs no Viewer re-read, invalidation staleness does (§6.7.2). |
| `CapacityExceededError` kinds (`'call-wide-unique-fragment-precheck'`/`'bucket-capacity'`, `CollisionWorld.js:216`) | **Extended additively** with a new `kind: 'tlas-candidate-budget'` (§9.3.2) for TLAS candidate-expansion exhaustion; existing kinds/shape unchanged, constructor message generalized to not literally claim "admission rejected" for a non-admission `kind`. |
| `evictModel`/`dispose` non-throw contracts (`CollisionWorld.js:346-370,390-413`) | **Preserved unchanged**; TLAS cache release calls, plus the new `_placementByEpoch`/`_placementRevisionByEpoch` table releases, added alongside existing registry release calls, held to the same non-throw contract (§6.6). |
| `_instanceCache` scope (`{fragmentId, geometryIdentity}` only, `CollisionWorld.js:461`) | **Preserved unchanged, not repurposed.** `[review fix]` M2 adds a genuinely new, separate epoch-scoped table (`_placementByEpoch`, §6.1) for placement rather than misreading `_instanceCache` as already holding it — the first draft of this spec incorrectly assumed the latter. |
| M1 linear broad phase as correctness oracle | **Preserved as a first-class, always-available mode** (`broadPhase:'linear'`), not merely "kept for old tests" — required by §12's differential fixtures for the life of this design. |
| Package structure: `collision/` in-repo, no separate npm package, no semver contract (`collision-library-m1-release-packaging-disposition.md`) | **Unchanged.** M2 extends `collision/` in place (new `collision/tlas/` subdirectory for `CollisionInstanceBVH`/`TlasCache`); no packaging decision is reopened by this spec. |

---

## Report

**Proposed M2 architecture**: a per-`loadEpoch`-cached `CollisionInstanceBVH` (a subclass of
`three-mesh-bvh`'s already-vendored, generic `BVH` base class, implementing its complete required
adapter contract — §5.2 — not a custom BVH implementation), built from a new epoch-scoped placement
index (`_placementByEpoch`, §6.1 — not, as this spec's first draft wrongly claimed, from
`_instanceCache`, which never held placement) and revalidated against a per-epoch admission-revision
counter so a cache reused after new fragments are admitted rebuilds rather than silently
under-reporting (§6.4). Queried once per admitted source `CollisionInstance` against the relevant
target epoch's TLAS (not a monolithic TLAS-vs-TLAS `bvhcast`, which conflicts with M1's
checkpoint/yield scheduling contract and `bvhcast`'s own non-reentrant, non-resumable implementation),
with every emitted candidate filtered to the calling query's own requested target scope (§7.1a) and
retested with M1's own exact AABB predicate (§7.3) before reaching the unchanged narrow phase. TLAS
lifecycle (lazy build, concurrent-build sharing, per-epoch eviction, world-disposal cleanup) directly
mirrors `GeometryRegistry`'s already-accepted pattern rather than introducing a new one. Cross-model
identity rides on `loadEpoch`, which M1 already built as a global, cross-model-safe identity axis — the
geometry/BLAS layer requires zero changes. `findClashes` gains a `targets` array (with an explicit
whole-model scope), a `broadPhase` escape hatch defaulting per-shape to preserve exact legacy behavior
(§3.5), and an additive `model` reference per result operand (§3.4, since `modelId` alone cannot
safely drive a live Viewer isolate/fitToView call under modelId reuse). The linear M1 broad phase is
retained permanently as the correctness oracle both fixtures and any future doubt about the TLAS path
can fall back to.

**This version already incorporates one full review-and-fix cycle** (an independent `codex-review
spec`, medium effort, run against the first draft — see the Revision note at the top of this
document). Five confirmed critical defects from that pass were fixed directly rather than left as
open questions: the false claim that `_instanceCache` holds placement data (§6), an incomplete `BVH`
subclass contract (§5.2), missing target-scope filtering and an imprecise self-exclusion rule (§4.4,
§7.1a), `modelId`'s insufficiency as correctness-bearing model provenance (§3.4, §11.2), and an
unverified assumption that this repo's existing app already supports multiple simultaneously loaded
models (§2, §11.1 — it does not, `wwwroot/viewer.js:38-48`, and now requires an in-scope
`keepCurrentModels: true` fix). Two of that review's "Important" findings were also fixed directly
(the `broadPhase` default's placement-freshness regression for legacy callers, §3.5; and a gap in
multi-lease liveness validation around shared-resource awaits and early returns, §9.2 point 7). Its
remaining findings (candidate-budget/precheck semantics under TLAS mode, and `Statistics` field-level
granularity for candidate counting) were **not** resolved inline — they need real design work, not a
quick patch — and are recorded as new open items 9-10 in §15 instead.

**This version additionally incorporates one targeted design-resolution pass** (a `codex-advisor`
consult, high effort, run against this pass's draft resolutions before they were written into this
document — see
`docs/superpowers/specs/collision-library-m2-targeted-design-resolution-disposition.md` for the full
disposition). It resolves the three items that were genuinely blocking implementation planning in the
prior revision: model-alignment/model-transform TLAS invalidation (§6.5, §6.7, §9.2, §10 — a human
decision that M2 must support this, previously an open confirmation item, is now designed, not merely
default-adopted), TLAS candidate-budget semantics (§9.3, previously undefined), and finalized
`Statistics` field semantics for the TLAS path (§7.5, previously ambiguous). Resolving the
candidate-budget item also surfaced and fixed one genuine correctness bug in already-accepted text:
§7.1a's target-scope filter compared a TLAS-matched primitive's `ownerDbId` directly against a
`targets` entry's requested `dbIds`, which silently produces false-negative exclusions for any
assembly-rooted target request (the same hazard §4.4 already documents and correctly handles for
source self-exclusion, simply not yet applied to the mirror-image target-side filter) — now corrected
to use extracted-fragment-set membership, consistent with §4.4's own resolution.

**Design decisions requiring human confirmation before implementation** (full detail in §15; items 1
and 4 from the prior revision's list are now resolved by this pass, not merely confirmed — see above):
1. Source self-exclusion granularity — default corrected to fragment-set membership (§4.4), still
   wants confirmation against real fixtures (§15 item 3).
2. Sourcing a real two-or-more-model federated fixture for §12/§13/§14 (§15 item 4).

**M1 contracts that change** (none of the *stabilized correctness* invariants — identity, ordering,
lifecycle non-throw guarantees — change; only *internal bookkeeping keys and the public result shape's
additive field* that were latently single-model-only or single-model-sufficient change): the
result/diagnostic dedup keys (§3.4, §4.2), the addition of a multi-epoch-aware composite liveness
check layered on top of the unchanged single-epoch checkpoint port (§9.2), and `ClashPair`'s new
additive `model` field (§3.4). No narrow-phase query module changes, no `GeometryRegistry`/`BlasCache`
changes, no removal of any existing public field.

**Is this spec ready for implementation planning?** Yes, with two non-blocking items still open for
human/logistics confirmation, not design work: source self-exclusion granularity's real-fixture
confirmation (§15 item 3) and sourcing a real two-or-more-model federated fixture (§15 item 4) — both
can proceed in parallel with implementation planning and do not gate its start, exactly as the prior
revision already characterized them. The three items that genuinely did gate implementation planning
— model-placement invalidation, TLAS candidate-budget semantics, and `Statistics` field finalization —
are now resolved with concrete, reviewed designs (§6.7, §9.3, §7.5) rather than deferred defaults or
open questions. The architecture in §5-§9 remains sound and unrevisited beyond these three targeted
resolutions and the one correctness fix (§7.1a) they surfaced; no other section of this document was
reopened, per this pass's own explicit scope.
