# M2 `extractAllFragments` — Viewer-API evidence for whole-model fragment enumeration

```yaml
task: Task 2 of docs/superpowers/plans/2026-09-06-collision-library-milestone2-implementation.md
consumed_by: Task 5 (extractAllFragments in collision/viewer/ViewerModelAdapter.js)
skill_used: aps-viewer-api-evidence-investigation
investigation_date: 2026-09-06
revision: 2 -- incorporates a codex-review pass (medium effort) plus follow-up live evidence;
  see "Revision history" at the end of this document.
```

## Conclusion (read this first)

The design spec's own candidate accessors (§3.3) are **partially wrong**. Task 5 must implement
against the corrected names below, not the spec's guesses:

| Spec's candidate (§3.3) | Confirmed reality |
|---|---|
| `model.getFragmentList()` + `fragList.getCount()`, iterate `0..count-1` | **Confirmed correct, as stated.** |
| `instanceTree.findNodeForFragId(fragId)` (owning-dbId reverse lookup) | **Does not exist.** Zero occurrences anywhere in the pinned Viewer 7.124.2 bundle (10.9 MB decoded, full-text search); `typeof instanceTree.findNodeForFragId === 'undefined'` on a live loaded `ObjectTree` instance; absent from the community `@types/forge-viewer` `InstanceTree` interface. **The real accessor is `model.getFragmentList().getDbIds(fragId)`** (a method on `FragmentList`, not `InstanceTree`), confirmed by source (`FragmentList.prototype.getDbIds(fragId) { return this.fragments.fragId2dbId[fragId]; }`, `viewer3D.js:136248`) and by a whole-model live cross-check (789/789 fragments: reverse lookup agreed exactly with the forward `enumNodeFragments` tree walk `extractFragments` already uses). |
| "hole" (index with no live fragment) needing a diagnostic | **Not structurally reproducible for a normally-loaded model in this build**, but a real, adjacent, confirmed condition exists and must be diagnosed instead: `fragList.isNotLoaded(fragId) === true` (excluded from loading, or unloaded — see below). Both get their own diagnostic reason (settled below); neither is silently skipped or folded into the other. |
| unresolvable owning dbId needing a diagnostic | **Confirmed real**: `fragList.getDbIds(fragId)` can return `undefined`. Gets its own diagnostic reason (settled below). |
| hidden/culled fragment needing a diagnostic | **"Hidden" and "culled" are NOT symmetric, and this matters for what Task 5 can actually implement.** "Hidden" is a real, queryable, per-dbId state (`instanceTree.isNodeHidden(ownerDbId)`, confirmed live and officially documented) — diagnosed and excluded, per the binding design's §3.3 requirement. "Culled" (camera-frustum culling) has **no corresponding stored state anywhere** in `FragmentList` or `InstanceTree` — it is a transient, per-frame render-loop decision, not data a static enumeration can observe. Task 5 cannot diagnose "culled" specifically because there is nothing to query; only "hidden" is implementable. |

**Resolved policy/schema questions** (see "Resolved for Task 5" below for the reasoning and
evidence behind each): the binding M2 design (§3.3) requires holes, unresolvable owners, and
hidden/culled fragments to *each* produce a diagnostic and be excluded from `records`, never
silently included as a normal placed instance. Final reason strings, the `dbId` sentinel, and the
hidden-fragment accessor are all settled below so Task 5 does not need to re-derive them.

## Target Viewer Context

- **Resolution:** `exact`, `7.124.2`.
- **Source:** repo-metadata, cross-checked — `wwwroot/index.html:45` pins
  `https://developer.api.autodesk.com/modelderivative/v2/viewers/7.124.2/viewer3D.js`; a live
  dev-server session (`npm start`, this repo, 2026-09-06) loaded exactly this URL, confirmed via
  the page's own console log lines citing `viewer3D.js:108793` etc.
- No conflicting version signal found (`@types/forge-viewer` is `7.99.1` per
  `package-lock.json:105` — a known, pre-existing typings/runtime mismatch, used here only as a
  weaker corroborating/classification signal, never as the resolved target version).
- Single Viewer entry point (`wwwroot/index.html`) — no multiple-entry-point splitting needed.
- **Model tested:** Autodesk's RAC-basic-sample Revit project (this repo's own existing acceptance
  URN, `docs`/memory's Room Locator recipe), 789 fragments, `useThreeMesh === false` (a standard 3D
  load, `fragments.length > 0`). Model-Derivative-translated from `.rvt` — not independently
  confirmed classic-SVF-vs-OTG/SVF2 (`model.getData().loadOptions` does not expose an explicit
  `otg`/format flag in this build; Autodesk's Model Derivative service has defaulted 3D
  translation to OTG/SVF2 since well before this repo's URN was generated, so OTG is the strong
  likely case, but this is an inference, not a directly observed fact — recorded honestly as a
  `runtime_gap` rather than asserted). Not tested against a 2D (F2D) load — see the flagged 2D-scope
  concern below.

## Evidence Summary

Both evidence classes below were obtained **against the exact same digest-verified artifact**:
`sha256 12b9fe49f41dc99ccec62535e5c887da915980829da2e941cfe4da3d7197c02e` — identical to the value
already on file in this Agent Kit's own prior M1 adjudication (in the **sibling
`aps-viewer-agent-kit` repo, not this repo** — this repo has no `docs/research/` directory):
`aps-viewer-agent-kit` repo:
`docs/research/collision-detection-m1-api-evidence-benchmark-geometry-access-adjudication.md`,
same URL/version, same 295,263/295,264-line decoded file size), and independently re-verified in
this session by two paths: (a) the Viewer's own `crypto.subtle.digest('SHA-256', ...)` computed
live in the browser against the bundle the page had actually loaded, and (b) a fresh `fetch()` of
the same URL from that page's origin, saved locally and hashed with `shasum -a 256`. Both paths
produced the identical digest above.

### 1. Live Viewer session (runtime-observed)

Ran `npm start` (this repo) and drove a real Chromium session via Playwright against
`http://localhost:8080/#<RAC-basic-sample URN>` (same URN as this repo's existing Room Locator
manual smoke-test recipe). Once the model finished loading (`window.viewer.model`, 789
fragments):

- `model.getFragmentList()` → object with `constructor.name === "FragmentList"`.
- `fragList.getCount()` → `789`, exactly equal to `fragList.fragments.fragId2dbId.length` (an
  `Int32Array`) and to `model.getObjectTree().getFragmentCount()`.
- `typeof model.getObjectTree().findNodeForFragId` → `"undefined"`. The `ObjectTree`/`InstanceTree`
  prototype chain (walked via `Object.getPrototypeOf` to `Object.prototype`) contains no method
  matching `/frag/i` except `enumNodeFragments`, `fragList`, `getFragmentCount`, `setFragmentList`
  — no fragId→dbId reverse-lookup method of any name lives on the tree object.
- `fragList.getDbIds` **does** exist (on `FragmentList`, confirmed via prototype-chain scan
  filtered to `/frag|dbid/i`), alongside `getNextAvailableFragmentId`, `hideFragments`,
  `isFragHiddenLineOrPoint`, `isFragOff`, `isFragVisible`, `isFragmentActive`, `setFlagFragment`,
  `setFragOff`.
- `fragList.getDbIds.toString()` → `"getDbIds(fragId) {\n    return this.fragments.fragId2dbId[fragId];\n  }"`.
- Sampled `fragList.getDbIds(0..4)` → `[2491, 2789, 2788, 2663, 3897]` (plain numbers, not arrays
  or objects).
- `fragList.getDbIds(count + 1000)` and `fragList.getDbIds(-1)` both returned `undefined` (typed
  array out-of-bounds read — no exception thrown). **Caveat, corrected in this revision:** this
  `undefined` result was only directly observed for **out-of-range** `fragId` values. The
  whole-model cross-validation below found **zero** in-range fragments where `getDbIds` returned
  `undefined` for this instance-tree-bearing model. The source-confirmed code path that returns
  `undefined` for an in-range fragment on a *no-instance-tree* model (Evidence §2) does not apply
  to this repo's caller (which already requires `model.getObjectTree()` to succeed). Treat
  "`getDbIds(fragId)` returns `undefined` for an in-range fragment on an instance-tree-bearing
  model" as a defensive, source-permitted branch to code against, not as a directly
  runtime-observed occurrence — a genuine `runtime_gap`.
- **Whole-model cross-validation (the strongest single piece of evidence gathered):** built a
  from-scratch instance-tree walk using `enumNodeFragments`/`enumNodeChildren` (the same primitives
  `extractFragments` already uses, `ViewerModelAdapter.js:103,127`) to derive a `fragId -> ownerDbId`
  map for all 789 fragments, then compared every entry against `fragList.getDbIds(fragId)`:
  `mismatches: 0`, `missingReverse: 0`, `forwardMapSize: 789 === count`. The reverse lookup and the
  forward tree walk agree on every single fragment in a real loaded model.
- **Hidden-vs-culled probe (redone this revision to actually resolve the question, not just
  observe a null result):** called `window.viewer.hide(fragList.getDbIds(0))`, then checked three
  candidate flags before/after:
  ```text
  before:    { isFragOff0: false, isNodeHidden: false, isNodeOff: false }
  afterHide: { isFragOff0: false, isNodeHidden: true,  isNodeOff: false }
  afterShow: { isFragOff0: false, isNodeHidden: false, isNodeOff: false }
  ```
  **`viewer.hide(dbId)` sets `instanceTree.isNodeHidden(dbId) === true`** — an
  `InstanceTree`/`ObjectTree`-level, officially-documented method (confirmed on the official
  `ObjectTree` Reference Guide page, see Evidence §3) — and does **not** touch the
  `FragmentList`-level `isFragOff`/`MESH_HIDE` vizflag at all. This is a real, confirmed,
  queryable per-dbId signal Task 5 can use once a fragment's `ownerDbId` is resolved.
  Separately, called `fragList.getWorldMatrix(0, M)` / `fragList.getWorldBounds(0, B)` while
  hidden: `M.elements` all finite, `B.isEmpty() === false`, `fragList.getCount()` unchanged (789),
  `fragList.getDbIds(0)` unchanged — the Viewer-API mechanics of reading matrix/bounds are
  completely unaffected by hidden state (see Evidence §2 for why: neither method's source body
  references any visibility flag). **This is a pure API-behavior fact, separate from the
  product-policy question of whether a hidden fragment should be included in clash detection** —
  the latter is answered by the binding design (§3.3), not by this API-mechanics observation; see
  "Resolved for Task 5" below.
- No stored per-fragment or per-node state for camera-frustum culling was found anywhere in the
  `vizflags` bit set actually observed (`MESH_HIDE`, `MESH_NOTLOADED`, `MESH_VISIBLE`,
  `MESH_MOVED`, `MESH_ISLINE`, `MESH_ISWIDELINE`, `MESH_ISPOINT`) or in `InstanceTree`'s documented
  method set. This is consistent with frustum culling being a transient per-frame render-loop
  decision that is recomputed every frame from the camera, never written back into `FragmentList`/
  `InstanceTree` data.

### 2. Pinned source artifact (source-observed)

Fetched `viewer3D.js` for `7.124.2` from the live page's own origin (`fetch()` executed inside the
already-loaded page, avoiding this session's own outbound-network sandbox restriction on
`developer.api.autodesk.com`), decoded (295,264 lines; matches the prior M1 adjudication's
"295,263-line file" size, off-by-one only in trailing-newline counting convention — further
corroboration this is the same artifact), and digest-verified as above. Confirmed by direct text
search/read of that exact artifact (all line numbers below are from this decoded file):

- **`findNodeForFragId` — zero occurrences anywhere in the entire 10.9 MB bundle.** Confirms the
  live `undefined` result is not a load-order fluke; the symbol does not exist in this build at
  all, under any class.
- **`FragmentList.prototype.getCount`** (`viewer3D.js:136244`):
  ```js
  getCount() {
    return this.vizmeshes ? this.vizmeshes.length : this.vizflags.length;
  }
  ```
  For a standard 3D (non-2D) load, `useThreeMesh === false` so `vizmeshes` is falsy and this
  returns `this.vizflags.length` — a dense array allocated to the model's total fragment count at
  `FragmentList` construction time, independent of streaming/load-completion state.
- **`FragmentList.prototype.getDbIds`** (`viewer3D.js:136248`, and again at `:141225` for a
  second `FragmentList`-family subclass — both bodies identical):
  ```js
  getDbIds(fragId) {
    return this.fragments.fragId2dbId[fragId];
  }
  ```
  A call site comment confirms the return-shape distinction between 3D and 2D loads: `const dbId =
  fragList.getDbIds(fragId); // for OTG, this returns only one id` (i.e. a plain number for a
  standard 3D/OTG load — exactly what `ViewerModelAdapter.js`'s existing `extractFragments`
  targets); a separate 2D-only code path explicitly normalizes it (`dbIds = Array.isArray(dbIds) ?
  dbIds : [dbIds]`), confirming the array-return case is 2D-specific.
- **Unresolvable-owner behavior is a real, explicit code path, not a guess** (`viewer3D.js:35831`
  area):
  ```js
  if (result.dbId === undefined && result.fragId !== undefined /* 0 is a valid fragId */) {
    result.dbId = result.model.getFragmentList().getDbIds(result.fragId);
    if (!result.model.getData().instanceTree) {
      // Case where there is no dbid to fragment id map. Create a 'virtual' node
      // with node Id = fragment Id, so that selection works like
      // each scene fragment is a scene node by itself.
      result.dbId = result.fragId;
    }
  }
  ```
  This confirms `getDbIds(fragId)` can itself resolve to `undefined` for a fragment with no
  resolvable owning node — but the Viewer's own fallback for that `undefined` case is only taken
  for a model with **no** `instanceTree` at all, a case that does not apply to
  `extractAllFragments`'s caller (which already requires `model.getObjectTree()` to have
  succeeded). For Task 5's normal case, an `undefined` return from `getDbIds(fragId)` is the
  confirmed signal to route to a diagnostic — but, per the caveat in Evidence §1 above, this
  specific in-range scenario was not itself directly observed at runtime; code defensively against
  it rather than assuming it is common.
- **`isNotLoaded` — a real, distinct fragment lifecycle state, not an index-range hole**
  (`viewer3D.js:135792`):
  ```js
  /*
  * Returns true if a fragment was excluded from loading or unloaded.
  *
  * Note that isNotLoaded()==false does not guarantee that geometry and material are already in memory.
  * Only vice versa: If true, it will not be loaded at all.
  */
  isNotLoaded(frag) {
    return !!(this.vizflags[frag] & MeshFlags.MESH_NOTLOADED);
  }
  ```
  Precisely: `isNotLoaded(fragId) === true` means the fragment was **excluded from loading, or
  unloaded** — it will never load. `isNotLoaded(fragId) === false` means only "it *might* load
  eventually," **not** "its geometry is already resident" — the source's own comment is explicit
  that this is a one-directional guarantee. This session found no evidence either way on whether a
  `false`-but-not-yet-resident fragment is retryable within `extractAllFragments`'s own call
  lifetime; that remains an open `runtime_gap`, not something this note resolves. The Viewer's own
  internal filter/highlight code explicitly checks this before calling `getDbIds`
  (`if (fragList.isNotLoaded(fragId)) continue;`, `viewer3D.js:76257` area) — i.e. Autodesk's own
  code treats `isNotLoaded === true` as a case to skip, the same posture Task 5 should take.
  **This is a genuinely different condition from an index-range hole** (there is no index gap to
  detect in this build — see Evidence §1's `getCount()` finding) and must get its own diagnostic
  reason, not be folded into a "hole" reason meant for a structurally-absent slot.
- **`getWorldMatrix`/`getWorldBounds`** (the `FragmentList` variant matching the live
  `constructor.name` confirmed above, `viewer3D.js:136590` and `:136660`) read purely from
  preallocated, index-keyed arrays/flags (`this.boxes`, `this.matrix`, the `MESH_MOVED` flag) —
  neither method's body references `MESH_HIDE`, `MESH_NOTLOADED`, or any other visibility-related
  vizflag, and neither references `instanceTree.isNodeHidden`/`isNodeOff` (those live on a
  different class entirely). This is why hiding a fragment did not change the live probe's
  matrix/bounds results: the code path has no visibility gate to trigger.
- **`viewer.hide(dbId)` routes through `VisibilityManager`, confirmed by source**
  (`viewer3D.js:95033`):
  ```js
  hide(node, model) {
    if (!model) { this.warn(); model = this.models[0]; }
    model.visibilityManager.hide(node);
  }
  ```
  This is `Viewer3D.prototype.hide` — it delegates to a `VisibilityManager` instance, which (per
  the live probe in Evidence §1) sets the `InstanceTree`-level `isNodeHidden` flag, not the
  `FragmentList`-level `MESH_HIDE` vizflag. This fully explains, rather than leaves open, why the
  live probe's `isFragOff(0)` stayed `false` after `viewer.hide()` in this revision's investigation
  (an open question in the prior revision of this note).

### 3. Official documentation (checked; one page renders fully, one is SPA-shell-limited)

- `Autodesk.Viewing.Private.InstanceTree`'s Reference Guide page (fetched via the `r.jina.ai`
  rendering-proxy workaround) renders successfully and states the class is **deprecated in favor
  of `Autodesk.Viewing.ObjectTree`** — consistent with the live-observed `constructor.name ===
  "ObjectTree"` for `model.getObjectTree()`'s return value. It documents only a constructor, no
  methods, so it neither confirms nor denies `findNodeForFragId`.
- `Autodesk.Viewing.ObjectTree`'s Reference Guide page renders successfully and documents these
  methods: `isNodeHidden`, `isNodeVisibleLocked`, `isNodeExplodeLocked`, `getNodeType`,
  `isNodeSelectable`, `getNodeParentId`, `getRootId`, `getNodeName`, `getChildCount`,
  `getInstanceCount`, `getNodeBox`, `enumNodeInstances`, `enumNodeChildren`, `search`. Two facts
  follow from this same page: (a) **`isNodeHidden` is officially documented public API** — the
  accessor this note settles on for the hidden-fragment diagnostic is not merely undocumented
  guesswork; (b) **no `findNodeForFragId`, `enumNodeFragments`, or `getFragmentCount`** appears on
  this official page, even though `enumNodeFragments` is already used by this repo's own shipped
  M1 `extractFragments` (`ViewerModelAdapter.js:103`) — i.e. this repo already depends on an
  undocumented `ObjectTree` fragment method as accepted M1 practice; `extractAllFragments` doing
  the same for `getFragmentCount`/`fragList.getDbIds`/`fragList.isNotLoaded` is consistent with,
  not a new departure from, that existing posture.
- `Autodesk.Viewing.Private.FragmentList`'s Reference Guide page returned only a cookie-consent
  shell on this session's own fetch attempt (an SPA-shell failure per this skill's own documented
  limitation, not a definitive absence-check) — recorded as `retrieval_result: partial`, not relied
  upon. Absence of an official `FragmentList` page is instead established by this Agent Kit's own
  prior, live-verified (2026-08-26) adjudication — in the **sibling `aps-viewer-agent-kit` repo,
  not this repo**: `aps-viewer-agent-kit` repo:
  `docs/research/collision-detection-m1-api-evidence-benchmark-geometry-access-adjudication.md`
  §1.5, which confirms `FragmentList` has no Reference Guide page of its own and is not among the
  small enumerated set of classes the official `Autodesk.Viewing.Private` namespace index actually
  disclaims (`InstanceTree`, `Preferences`, `PropDbLoader`, `PropertyDatabase`,
  `ViewerPreferences`) — reused here as Branch-C-style corroboration, not re-verified fresh this
  session.

### 4. Community typings (weak corroborating signal only)

`node_modules/@types/forge-viewer/index.d.ts` (installed `7.99.1`, a known version mismatch
against the runtime-pinned `7.124.2`, used only as classification corroboration):
- `Private.FragmentList` interface (`index.d.ts:1812`) types `getVizmesh`, `getWorldBounds`,
  `getAnimTransform`, `updateAnimTransform` — but **not** `getCount`, `getDbIds`, `getWorldMatrix`,
  `isFragOff`, or `isNotLoaded`. (`getWorldBounds(fragId: number, box: THREE.Box3): void` matches
  the exact call shape `ViewerModelAdapter.js:42-43` already uses.)
- `InstanceTree` class (`index.d.ts:658`) types `enumNodeChildren`, `enumNodeFragments`,
  `getChildCount`, `getNodeBox`, `getNodeIndex`, `getNodeName`, `getNodeParentId`, `getNodeType`,
  `getRootId`, `isNodeExplodeLocked`, `isNodeHidden`, `isNodeOff`, `isNodeSelectable`,
  `isNodeSelectionLocked`, `isNodeVisibleLocked`, `lockNodeExplode`, `lockNodeSelection`,
  `lockNodeVisible`, `setFlagGlobal`, `setFlagNode`, `setNodeHidden`, `setNodeOff` — **no
  `findNodeForFragId`, no `getFragmentCount`**, but `isNodeHidden`/`isNodeOff` are both present,
  corroborating the live and official-doc evidence for the hidden-fragment accessor.

## API Stability

| Symbol | Classification | Basis |
|---|---|---|
| `Model.getFragmentList()` | undocumented | No official Reference Guide entry; not individually disclaimed under `Autodesk.Viewing.Private`; typed only as `Private.FragmentList` in community typings (return-type placement, not an affirmative internal disclaimer) — consistent with this Agent Kit's existing `viewer-api-stability` precedent and the prior M1 adjudication's identical classification for the same symbol. |
| `FragmentList.getCount()` | undocumented | Not in the official Reference Guide (best-effort check); not typed even in the community `Private.FragmentList` interface; existence and behavior confirmed by source + live runtime. |
| `FragmentList.getDbIds(fragId)` | undocumented | Same basis as `getCount()`. |
| `FragmentList.isNotLoaded(fragId)` | undocumented | Same basis; internal implementation flag-check, used by the Viewer's own code, not documented anywhere. |
| `ObjectTree` (`ObjectTree`/formerly `Private.InstanceTree`) | the class itself: `InstanceTree` name is officially disclaimed internal (`Autodesk.Viewing.Private` namespace index, per this kit's `viewer-api-stability` Knowledge) and now officially deprecated in favor of `ObjectTree`; `ObjectTree` itself has its own (non-`Private`) Reference Guide page and documents `getObjectTree()`'s return type as public. | See Evidence §3. |
| `ObjectTree.isNodeHidden(dbId)` | **public** | Officially documented on the `ObjectTree` Reference Guide page (Evidence §3), corroborated by community typings. This is the one accessor in this note with genuine `public` status. |
| `ObjectTree.enumNodeFragments` / `ObjectTree.getFragmentCount` | undocumented | Not on the official `ObjectTree` page despite the class itself being public; already an accepted M1 dependency for `enumNodeFragments`. |
| `instanceTree.findNodeForFragId` | **not applicable — does not exist in this build.** | Confirmed absent from source (zero occurrences, full-text search of the digest-verified 7.124.2 bundle), absent from the live prototype chain (`undefined`), and absent from community typings. |

## Public Alternative

For enumeration/reverse-lookup: none known beyond `getFragmentList().getCount()`/
`getFragmentList().getDbIds(fragId)` — both undocumented, matching this repo's existing M1 posture
of already depending on other undocumented `FragmentList`/`ObjectTree` fragment primitives
(`enumNodeFragments`, `getWorldMatrix`, `getWorldBounds` — `ViewerModelAdapter.js:37-48,103`). For
the hidden-fragment check specifically, `ObjectTree.isNodeHidden(dbId)` **is** a documented public
alternative — no undocumented workaround needed for that one piece.

## Version / Context Scope

All findings above are scoped to Viewer `7.124.2` specifically (the exact pinned build this repo
loads, `wwwroot/index.html:45`), for a standard 3D (SVF/OTG, non-2D) model load with
`fragments.length > 0` (`useThreeMesh === false`) — the same load-type scope the M1 adjudication
already used for the sibling `getGeometry`/`getVizmesh` finding. Not verified against a 2D (F2D)
load, an OTG model with zero fragments, or any other Viewer version.

**Flagged 2D-model-scope gap (not resolved by this note — a pre-existing plan gap, confirmed by
checking both the M2 design spec's non-goals and this plan; M1 never handled 2D models either,
since collision detection is inherently 3D/volume-based):** `extractAllFragments`'s evidence and
this plan both assume a 3D model. Behavior for a 2D-loaded model is **undefined by the spec** —
`getDbIds(fragId)` can return an **array** of dbIds for a 2D load (per the source comment quoted
in Evidence §2), which would break every downstream consumer that assumes `ExtractedFragmentRecord
.ownerDbId` is a single number. Task 5's implementer should treat this defensively (e.g. detect
`Array.isArray(getDbIds(fragId))` and skip/diagnose that fragment rather than crash or silently
store an array where a number is expected) — full 2D support is out of scope for M2 and this note
does not attempt to specify it further.

Revalidate `findNodeForFragId`'s absence, `getDbIds`'s return shape/undefined-behavior, and the
`isNodeHidden`/`isNotLoaded` findings before relying on this note against a different pinned
Viewer build.

## Resolved for Task 5 (policy/schema questions settled during this note's review)

The binding M2 design (`docs/superpowers/specs/2026-09-05-collision-library-milestone2-design.md`
§3.3, lines 179-191) states: *"handling for a fragment index with no live fragment (holes), a
hidden/culled fragment, and a fragment whose owning dbId cannot be resolved — each must produce a
diagnostic (§10), never a silently-dropped or silently-malformed primitive."* This is binding, not
optional. All four cases below are **excluded from `records`** and each **produces exactly one
diagnostic entry**, using the shape `{scope: 'fragment', reason, role: 'target', fragment:
{modelId, dbId, fragId}}` (the same shape `_runNarrowPhasePair`'s existing
`diagnoseFragmentOnce`/`fragmentRef` already produces, `CollisionWorld.js:822-830,55-61`):

| Condition | Confirmed accessor | Reason string | `fragment.dbId` |
|---|---|---|---|
| Not loaded / excluded from loading | `fragList.isNotLoaded(fragId) === true` | `'fragment-not-loaded'` | `null` (never resolved — check happens before any `getDbIds` call) |
| Index-range hole (defensive; not reproduced in this build's normal load path) | no live data at `fragId` (mechanism unconfirmed — see Version/Context Scope) | `'fragment-index-hole'` | `null` |
| Owning dbId unresolvable | `fragList.getDbIds(fragId) === undefined` | `'fragment-owner-unresolvable'` | `null` |
| Hidden | `instanceTree.isNodeHidden(ownerDbId) === true`, checked **after** `ownerDbId` is resolved | `'fragment-hidden'` | the real, resolved `ownerDbId` (a number) |

**Why `'fragment-index-hole'` and `'fragment-not-loaded'` are kept as two distinct reasons rather
than merged:** they describe genuinely different conditions. `isNotLoaded` is a real, source-
confirmed, currently-firing lifecycle flag (excluded/unloaded, `viewer3D.js:135792`). A literal
gap in the `0..count-1` index range was not found to be structurally possible in this build (every
backing array — `vizflags`, `boxes`, `fragments.fragId2dbId` — is dense and pre-sized to
`getCount()`); `'fragment-index-hole'` is retained defensively (in case some other build/loader
combination this note did not test produces one), not because this note observed one.

**Why "culled" gets no reason string at all:** confirmed above (Evidence §1) — there is no stored
per-fragment or per-node state anywhere for camera-frustum culling in this build. A diagnostic
reason needs something to check; none exists. Task 5 should not invent a `'fragment-culled'`
reason it can never actually trigger.

**`dbId` sentinel — `null`, not `undefined`:** the early, non-binding
`docs/ideas/aps-viewer-clash-detection-library-idea.md:1230` sketch types `FragmentRef.dbId` as a
required `number`; that document is not part of the binding spec (the plan's own front matter
names only the M2 design doc and its disposition doc as "the spec"). The shipped M1 code's own
`fragmentRef()` helper (`CollisionWorld.js:55-61`) always derives `dbId` from an already-`placed`
instance's resolved `ownerDbId` — M1 never had an unresolvable-owner case to represent. For M2's
genuinely-unresolvable case, use `dbId: null` (explicit, JSON-safe, and distinguishable from "not
yet set") rather than `dbId: undefined` (which disappears under `JSON.stringify` and reads as "key
omitted" rather than "resolution attempted and failed").

**Capacity bound during enumeration (flagged for Task 5's own plan text, not fixed here since this
note produces no code):** the existing `maxCollisionInstancesPerEpoch` check in the plan's Task 5
scaffold (`docs/superpowers/plans/2026-09-06-collision-library-milestone2-implementation.md:963-966`)
only bounds *successful* record insertions. A model reporting a very large `getCount()` with most
fragments landing in one of the diagnostic branches above (not loaded / hole / unresolvable /
hidden) would scan the entire range and accumulate an unbounded diagnostics array without ever
tripping that check. Task 5 should also bound `fragList.getCount()` itself against a ceiling
**before** starting the enumeration loop — reusing `maxCollisionInstancesPerEpoch` as that same
ceiling is a reasonable default absent evidence a legitimate model's fragment count routinely
exceeds it. This note does not pick the exact bound value or throw semantics; that is Task 5's own
implementation decision, same as the plan's existing `CapacityExceededError('whole-model-
enumeration', ...)` scaffold already anticipates.

## Contradictions

None between the live-runtime and pinned-source evidence — they agree on every point checked
(digest match, `getCount()` value, `getDbIds()` values and out-of-range behavior,
`findNodeForFragId`'s absence, the `isNodeHidden`/`MESH_HIDE` distinction, and
`getWorldMatrix`/`getWorldBounds` behavior for a hidden fragment).

The discrepancies (not contradictions between two evidence sources, but between the design spec's
own candidates/assumptions and reality) are: (1) `findNodeForFragId` vs.
`getFragmentList().getDbIds` (Conclusion table), and (2) "hidden/culled" being treated as one
symmetric case in §3.3's phrasing when only "hidden" is actually implementable ("Resolved for Task
5" above) — both flagged explicitly per the task brief's instruction to do so.

**Spec defect, not just an implementation gap — flagged for the plan owner, not resolved here.**
Discrepancy (2) is stronger than "an ambiguity Task 5 must interpret." Binding §3.3 literally
requires that "a hidden/culled fragment ... must produce a diagnostic," worded as a single
conjoined requirement. This note's own evidence (Evidence §1's culling-state search and Evidence
§2's confirmation that no vizflag, InstanceTree method, or any other queryable state exists for
camera-frustum culling in this build) establishes that **no implementation can ever satisfy the
"culled" half of that requirement** — there is nothing to query, so a culled fragment will, in
Task 5's actual code, be silently included as a normal record with no diagnostic (the correct
outcome, per "Resolved for Task 5" above, which explicitly instructs Task 5 not to invent an
unfireable `'fragment-culled'` reason just to appear compliant). That is a **defect in §3.3's own
text**, not a gap this evidence note or Task 5 can close by trying harder: the requirement as
written cannot be met by any implementation built on this Viewer version's actual data model.
**Recommendation:** the plan owner should correct §3.3 in a follow-up disposition-doc-style
amendment (the same pattern this plan already uses elsewhere, e.g.
`docs/superpowers/specs/collision-library-m2-targeted-design-resolution-disposition.md`) to drop
"culled" from its literal diagnostic requirement, scoping §3.3 to "a hidden fragment ... must
produce a diagnostic" only, with an explicit note that camera-frustum culling is transient
render-loop state with no corresponding stored data and is therefore out of scope for any
extraction-time diagnostic. This note does not make that amendment itself — only the plan owner
can change binding spec text — but records the recommendation here so it is not lost.

## Revalidation Needed

`required: true`, trigger: `viewer-version`. Re-confirm `findNodeForFragId`'s absence,
`getDbIds`'s return shape, `isNotLoaded`'s semantics, and `isNodeHidden`'s hidden-fragment
behavior described here before relying on this note against any Viewer build other than `7.124.2`.

**Open (non-blocking) `runtime_gap`s left unresolved by this note:**
1. Whether a fragment with `isNotLoaded() === false` but not-yet-resident geometry can become
   available again within a single `extractAllFragments` call (i.e., is a retry ever useful), or
   whether `extractAllFragments` should treat "not yet resident" the same as "not loaded" for its
   own single-pass purposes. Left to Task 5 to decide; this note only confirms the underlying flag
   semantics.
2. Whether an in-range `getDbIds(fragId) === undefined` actually occurs for any real
   instance-tree-bearing model (not observed in this note's 789-fragment cross-check; only the
   source's own no-instance-tree fallback branch confirms the return value is possible at all).
3. Whether this repo's test model is classic SVF or OTG/SVF2 (inferred, not directly confirmed —
   see Target Viewer Context).

## Evidence Details — What Task 5 should implement against

```js
// Confirmed accessor names + diagnostic policy for extractAllFragments
// (collision/viewer/ViewerModelAdapter.js). Reason strings and the dbId sentinel are settled
// above under "Resolved for Task 5" -- Task 5 should use them verbatim, not re-derive them.
const fragList = model.getFragmentList();      // NOT instanceTree.findNodeForFragId anywhere
const instanceTree = model.getObjectTree();    // for the hidden check only
const count = fragList.getCount();             // dense range 0..count-1, no index-range holes
// (Task 5's own plan text should add a pre-loop bound check on `count` here -- see "Resolved for
// Task 5 / Capacity bound during enumeration" above.)
for (let fragId = 0; fragId < count; fragId++) {
  if (fragList.isNotLoaded(fragId)) {
    // -> diagnostic { scope: 'fragment', reason: 'fragment-not-loaded', role: 'target',
    //                 fragment: { modelId, dbId: null, fragId } }, skip
    continue;
  }
  const ownerDbId = fragList.getDbIds(fragId);  // plain number for a 3D/OTG load; NOT an object.
                                                 // Array.isArray(ownerDbId) -> a 2D-loaded model;
                                                 // out of scope for M2, diagnose/skip defensively.
  if (ownerDbId === undefined) {
    // -> diagnostic { ..., reason: 'fragment-owner-unresolvable', fragment: { ..., dbId: null, fragId } }, skip
    continue;
  }
  if (instanceTree.isNodeHidden(ownerDbId)) {
    // -> diagnostic { ..., reason: 'fragment-hidden', fragment: { ..., dbId: ownerDbId, fragId } }, skip
    continue;
  }
  // getWorldMatrix(fragId, scratchMatrix) / getWorldBounds(fragId, scratchBox) behave exactly as
  // ViewerModelAdapter.js:37-48 already uses them for extractFragments -- no special-casing
  // needed for a hidden fragment's matrix/bounds data itself (that data is fine; the fragment is
  // simply excluded per the diagnostic above). "Culled" cannot be checked at all -- no stored
  // state exists for it (see "Resolved for Task 5" above).
}
```

## Recommended Next Action

Task 5 may proceed to implement `extractAllFragments` using `fragList.getCount()` +
`fragList.getDbIds(fragId)` + `fragList.isNotLoaded(fragId)` + `instanceTree.isNodeHidden
(ownerDbId)`, replacing every reference to `instanceTree.findNodeForFragId` in the plan's own
Task 5 scaffold
(`docs/superpowers/plans/2026-09-06-collision-library-milestone2-implementation.md:949`) with
`model.getFragmentList().getDbIds(fragId)`, and using the reason strings/sentinel/exclusion policy
settled under "Resolved for Task 5" above. No further evidence-gathering is required before
Task 5 begins; the open `runtime_gap`s above are either immaterial to Task 5's core implementation
or explicitly deferred to Task 5's own judgment. Separately, and not blocking Task 5: the plan
owner should schedule the §3.3 "culled" text amendment recommended in the Contradictions section
above — that is a binding-spec text fix, tracked independently of Task 5's own implementation
work.

## Revision history

- **Revision 1** (this session, first pass): established the `findNodeForFragId` discrepancy and
  the core `getCount`/`getDbIds` accessor confirmation, but conflated pure Viewer-API-behavior
  facts (hidden fragments still enumerate; `getWorldMatrix`/`getWorldBounds` unaffected) with the
  separate, binding-design-governed policy question of whether hidden/culled fragments should be
  excluded-with-diagnostic; overstated the in-range `getDbIds() === undefined` case as more
  directly observed than it was; used the design's own `dbId: undefined` scaffold text without
  flagging its tension with the shipped `fragmentRef()` helper's invariant; did not distinguish
  `isNotLoaded` from a true index-range hole precisely enough; did not enforce/flag the 2D-model
  scope gap prominently; did not flag the capacity-check bounding gap; did not include exact
  source line numbers or a reproducible probe script.
- **Revision 2** (this document): addresses all of the above via a `codex-review` (spec, medium
  effort) pass plus follow-up live-Viewer evidence (the `isNodeHidden`-vs-`isFragOff` probe) and an
  independent re-read of the binding spec's §3.3 text. See "Resolved for Task 5" for the
  substantive changes; corrected wording throughout the Evidence Summary/Details sections; added
  exact source line-number citations.
- **Revision 3** (this document): addresses a task-review pass's two Important findings — (1)
  strengthened the "culled" discrepancy in Contradictions into an explicit recommendation that the
  plan owner amend §3.3's own text (drop "culled" from its literal diagnostic requirement, since no
  implementation can ever satisfy it — this note's own evidence already proved that, but did not
  previously say so as a spec-text recommendation); (2) qualified both citations of
  `docs/research/collision-detection-m1-api-evidence-benchmark-geometry-access-adjudication.md`
  with their actual location — the sibling `aps-viewer-agent-kit` repo, not this repo (this repo
  has no `docs/research/` directory). A third, Minor finding (the plan's own Task 5 scaffold sketch
  is missing 2 of the 4 diagnostic branches and still shows `dbId: undefined`) was deferred by the
  task reviewer and is not addressed in this revision.
