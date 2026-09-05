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
in scope); fragment/placement transform-change invalidation for an already-open TLAS entry (§15,
flagged for explicit human confirmation — the default disposition below treats this as out of scope).

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

### 6.5 Placement-freshness assumption — explicit, not silent

**This is the one place this spec deliberately introduces a new limitation relative to M1's own
behavior, and it must be stated plainly rather than discovered later.**

M1 does not cache placement across calls: `extractFragments` re-reads `worldMatrix`/`worldBounds`
fresh from the Viewer's `FragmentList` on **every** `findClashes` call
(`ViewerModelAdapter.js:37-48,110-111`); the `CollisionInstance` identity cache (`_instanceCache`)
retains only `{fragmentId, geometryIdentity}` (`CollisionWorld.js:461`), never placement — which is
exactly why §6.1 introduces `_placementByEpoch` as new, M2-only state rather than reusing
`_instanceCache` for a purpose it was never built for. A TLAS entry built at time T and reused at time
T+1 (§6.4's revision check only protects against *new admissions*, not *moved* fragments) is only
correct if nothing under that epoch moved between T and T+1.

**Default disposition for M2**: a TLAS entry assumes static world placement for the life of its
`loadEpoch` — i.e., between admission and eviction, a model's fragments are assumed not to move
(no explode view, no live transform edits, no animation) for the purposes of TLAS-accelerated
queries. This is declared, not silently assumed:

- No Viewer transform-change event is wired to invalidate a live TLAS entry in M2.
- `broadPhase: 'linear'` (§3.5) remains available and is placement-fresh on every call (it re-reads
  `worldBounds` from the same per-call extraction M1 already does) — the escape hatch for any
  workflow that cannot accept this assumption.
- This is flagged in §15 as requiring explicit human confirmation before implementation, together
  with a fallback design (rebuild TLAS fresh per call, forfeiting the cache) if the answer is "no,
  M2 must handle mid-session transforms."

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

**Required filter**: after a TLAS query emits primitive-range matches (§7.1/§7.2) and before the
exact retest (§7.3), every matched primitive is checked against the *calling query's own* target
membership for that operand:

- `targets` entry has explicit `dbIds` → matched primitive's `ownerDbId` must be in that entry's
  requested set (an O(1) `Set.has` check against the caller's own requested-dbId set, built once per
  call).
- `targets` entry omits `dbIds` (whole-model scope, §3.2) → no filter; every matched primitive in
  that epoch is in scope, by definition.

This filter is per-call, not baked into the cached TLAS entry itself — the same cached tree correctly
serves both a narrow explicit-dbIds query and a later whole-model query against the same epoch, with
the filter (not the tree) carrying the difference.

### 7.1b Candidate dedup and ordering (`[review fix, Critical #3, partial]`)

The M2 prompt's own required-scope list (§"Candidate ownership/dedup") asks for deterministic
candidate ordering and no duplicate narrow-phase work. Two mechanisms already in this spec, restated
together here for traceability: §3.4's `(sourceEpoch, sourceDbId, targetEpoch, targetDbId)` dedup key
prevents a duplicate *result* pair; a candidate-level dedup (preventing the *narrow phase itself* from
re-running on the same `(sourceFragmentId, targetFragmentId)` pair twice within one call, e.g. if a
target's dbId-membership filter above and a future `bvhcast` path could in principle emit the same
leaf-pair from two different traversal branches) is tracked as an open item in §15 rather than fully
specified here — the M1 baseline's own linear broad phase has no duplicate-candidate hazard in the
first place (its double loop visits each `(i,j)` pair exactly once), so this is a genuinely new
concern introduced by the TLAS's tree-shaped traversal, not a carried-over M1 gap. Deterministic
ordering: `_runBroadPhaseScan`'s existing per-call, insertion-order candidate list is preserved
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
   framing, but this spec requires it be **measured**, not assumed. `[review fix, Important #5,
   partial]` "Candidate count" is ambiguous across three different stages this spec's own §7
   distinguishes (leaf-range emissions, exact-retest survivors, narrow-phase inputs) — the gate must
   record all three separately, not one field claimed to mean all of them, or the two broad-phase
   paths' numbers are not actually comparable. `Statistics`'s exact field-level shape for this (new
   fields vs. redefining `broadPhasePairs`'s existing meaning) is not finalized by this spec — tracked
   in §15.
4. Wall-clock: TLAS path (cold, then warm) vs. linear-oracle path, for the identical query.
5. Memory/cache behavior: TLAS entry retained size, and its growth relative to `_instanceCache`'s own
   already-measured retention behavior (M1's own criterion 12,
   `milestone-1-performance-gate-disposition.md`'s table — this is a direct extension of an existing
   measured criterion, not a new methodology).
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

1. **Placement-freshness assumption for a cached TLAS (§6.5) — requires explicit human confirmation.**
   Default disposition adopted by this spec: TLAS entries assume static placement for the life of a
   `loadEpoch` (§6.4's admission-revision mechanism catches *new admissions*, but nothing catches a
   fragment that *moved*); no transform-change invalidation in M2. If this is unacceptable (e.g. the
   target Viewer app supports live model manipulation while a `CollisionWorld` session is active), the
   TLAS design in §6 needs a placement-revision key that also tracks transform changes (not just
   admissions) or an explicit rebuild trigger before implementation — this is a real fork in the
   design, not a tuning constant. Still the single most consequential open item in this spec.
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
9. **`[new]` Candidate-budget/precheck semantics under `broadPhase:'tlas'` are undefined.** M1's
   `_exceedsBroadPhaseCeiling`/`maxBroadPhaseInstancePairs` precheck (`CollisionWorld.js:698-703`,
   `sourceCount × targetCount` Cartesian check) is exactly the kind of check the TLAS exists to make
   unnecessary for a realistic case (a small source against a huge target population), but this spec
   does not yet say whether/how that precheck applies under `broadPhase:'tlas'`, whether it applies
   per-`(sourceEpoch,targetEpoch)` pair or once for the whole federated call, or what ceiling (if any)
   bounds TLAS-emitted candidates before the exact retest (§7.3) and narrow phase run. Needs a
   dedicated design pass — likely a *replacement* budget scoped to "candidates surviving retest," not
   a reapplication of the Cartesian-product check the TLAS is specifically meant to route around —
   before implementation; the M2 prompt's own required "candidate-budget behavior... diagnostics for
   budget exhaustion" coverage is not yet satisfied by this spec as written.
10. **`[new]` `Statistics` field semantics need to be finalized for the TLAS path.** §7.1b/§14.3 flag
    that "candidate count" means three different things across this spec (leaf-range emissions,
    exact-retest survivors, narrow-phase inputs) and that a true candidate-level dedup guarantee (as
    opposed to the result-level dedup §3.4 already defines) is not yet specified for the TLAS
    traversal path. Both need resolution before `Statistics`'s exact shape (additive new fields, per
    §14.3's own note, most likely) can be considered final.

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
| `ClashPair`/`Statistics`/diagnostic shapes (`CollisionWorld.js:743-748`, `errors.js`) | **`ClashPair` gains an additive `model` field per operand** (§3.4, `[review fix]` — `modelId` alone is not correctness-bearing under Viewer modelId reuse); `Statistics`'s own field-level shape for TLAS-path candidate counting is **not yet finalized** (§15 item 10). Diagnostic entry shapes unchanged. |
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

**Design decisions requiring human confirmation before implementation** (full detail in §15,
renumbered — items are no longer 1:1 with the first draft's list):
1. Whether TLAS entries may assume static placement for the life of an epoch (no transform-change
   invalidation in M2), or whether live in-session model manipulation must be supported. **Still the
   top blocking item** — unchanged by the review pass, since no repository evidence settles it either
   way (§15 item 1).
2. Source self-exclusion granularity — default corrected to fragment-set membership (§4.4), still
   wants confirmation against real fixtures (§15 item 3).
3. Sourcing a real two-or-more-model federated fixture for §12/§13/§14 (§15 item 4).
4. Candidate-budget/precheck semantics under `broadPhase:'tlas'` — genuinely unresolved, needs a
   dedicated design pass before implementation, not merely a human confirmation of a stated default
   (§15 item 9, no default is proposed).

**M1 contracts that change** (none of the *stabilized correctness* invariants — identity, ordering,
lifecycle non-throw guarantees — change; only *internal bookkeeping keys and the public result shape's
additive field* that were latently single-model-only or single-model-sufficient change): the
result/diagnostic dedup keys (§3.4, §4.2), the addition of a multi-epoch-aware composite liveness
check layered on top of the unchanged single-epoch checkpoint port (§9.2), and `ClashPair`'s new
additive `model` field (§3.4). No narrow-phase query module changes, no `GeometryRegistry`/`BlasCache`
changes, no removal of any existing public field.

**Is this spec ready for review?** Closer than the first draft, but **not yet ready for
implementation planning** — this is a materially different answer from the first draft's, and is
itself the point of running the review pass before reporting completion rather than after. Item 4
above (candidate-budget semantics) is a real, unresolved design gap, not a "confirm and proceed"
item like the others — the M2 prompt's own required scheduling-model coverage
("candidate-budget behavior... diagnostics for budget exhaustion") is not yet satisfied by this
document. Recommend one more targeted design pass on §15 items 9-10 specifically before this spec is
treated as final; items 1-3 above can be resolved by human confirmation alone and do not block that
follow-up pass from starting in parallel. Proceeding straight to an implementation plan before either
the human-confirmation items or the budget-semantics design pass lands would be the wrong call for a
document at this stage — the architecture in §5-§9 is sound and does not need to be revisited, but
this document is not yet a complete enough contract to build against.
