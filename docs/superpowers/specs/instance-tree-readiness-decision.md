# Instance-Tree Readiness Decision

Resolves: Risk #6 — "Instance-tree completeness at extraction time is unverified" (spec
`docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md`, **Risks** section,
bullet starting at line 4909, within the section header at line 4888; the line range `:4828-4841`
cited in this task's own brief no longer matches the current spec text — the spec has grown since
that citation was written, and this document cites the bullet's current location instead of
silently repeating a stale range), round-31 disposition Finding 3
(`docs/superpowers/specs/round-31-implementation-planning-blockers-disposition.md:19-21,33-36`, plus
the corresponding Open Question at `:5063-5065` of the design spec).

## Finding

**Bounded question investigated:** does `Autodesk.Viewing.OBJECT_TREE_CREATED_EVENT` reliably
signal that `model.getInstanceTree()`/`model.getObjectTree()`'s enumeration
(`enumNodeChildren`/`enumNodeFragments`) will return a complete result, for pinned Viewer
`7.124.2`?

**Official Reference Guide (checked 2026-09-04, via the kit's documented `r.jina.ai`-prefixed
retrieval workaround against `https://aps.autodesk.com/en/docs/viewer/v7/reference/Viewing/`,
cited by that original `aps.autodesk.com` URL per the investigation skill's own citation rule):**

- `OBJECT_TREE_CREATED_EVENT`: *"Fired when the object tree is successfully created."*
- `GEOMETRY_LOADED_EVENT`: *"Fired when the model/drawing finishes loading."*

Neither description makes any claim about fragment/node enumeration completeness — only about the
tree/model object's existence or the load's nominal finish. This official wording is silent, not
merely terse: it does not say "the tree is created *and fully populated*," nor does it warn that
it might not be. This silence is what sends the investigation to source inspection per the skill's
Branch A/Step-1 escalation rule.

**Pinned-bundle inspection (7.124.2, fetched fresh this session):** the CDN bundle
(`https://developer.api.autodesk.com/modelderivative/v2/viewers/7.124.2/viewer3D.js`) was
re-fetched and decoded; its decoded-bytes SHA-256
(`12b9fe49f41dc99ccec62535e5c887da915980829da2e941cfe4da3d7197c02e`) is byte-identical to the
digest already recorded in this Agent Kit's own `knowledge/viewer-model-lifecycle.md` (fetched
2026-08-26) — **no artifact drift**, so this session's source reading and that Knowledge page's
prior source reading are reading the same bytes.

Tracing by symbol (this session, against that digest):

1. `Autodesk.Viewing.OBJECT_TREE_CREATED_EVENT`'s actual string value is `'propertyDbLoaded'`
   (event-constants module, `const OBJECT_TREE_CREATED_EVENT = 'propertyDbLoaded';`, immediately
   preceded by the JSDoc `Fired when the object tree is successfully created.` — this JSDoc is the
   exact source the Reference Guide's public page is generated from, confirming the two are the
   same claim, not independently corroborating claims).
2. `Model.prototype.isObjectTreeCreated()` — behavioral description: "returns whether the
   frag-to-node-id mapping is done" (its own inline doc comment literally reads `@returns
   {boolean} True if the frag to node id mapping is done`) — is implemented as `return
   !!this._getObjectTree();`, and `_getObjectTree()` is `return this.getData()?.instanceTree ??
   null` in effect (`data.instanceTree`, `data` from `this.getData()`).
3. `PropDbLoader.prototype.processLoadResult(result)` — behavioral description: the terminal,
   single-shot worker-callback handler for property-database/instance-tree loading (registered as
   the dedicated "read" callback, `onObjectTreeRead`, distinct from the separate progress
   callback, so it fires exactly once per load, not incrementally) — is the function that, when
   `result.instanceTreeStorage` is present, constructs `this.instanceTree = new
   ObjectTree(nodeAccess, result.objectCount, result.maxTreeDepth)` from that (already-fully-
   received-from-the-worker) storage, calls `makeBackwardsCompatible(this)` (which assigns
   `propDbLoader.svf.instanceTree = propDbLoader.instanceTree` — `svf` being the same object
   `model.getData()` exposes as `data`), and **only then, in the same synchronous block**,
   dispatches `OBJECT_TREE_CREATED_EVENT`. This confirms: whenever `OBJECT_TREE_CREATED_EVENT`
   fires with a tree present, `isObjectTreeCreated()` is already `true` at the moment listeners
   run — the two are set from the identical code path, not merely correlated.
4. **The same function also has a branch that fires the identical event with no tree at all.**
   `processLoadResult`'s tree-construction step is guarded by `if (result.instanceTreeStorage)
   {...}` — when that field is absent (the function's own comment: *"Case where there is no object
   tree, but objects do still have properties. This is the case for F2D drawings or when the
   caller explicitly skipped instanceTree derivation"* — the latter case reachable via the
   loader's own `options.skipInstanceTreeResult`), `this.instanceTree` is never assigned, yet
   execution still falls through unconditionally to the same `dispatchEvent({type:
   OBJECT_TREE_CREATED_EVENT, ...})` call at the end of the method. So the implication only runs
   one direction: `isObjectTreeCreated() === true` implies the event already fired; **the event
   firing does not imply a tree object was ever created.** This is a strictly weaker guarantee
   than the event's own name, and the Reference Guide's own wording ("fired when the object tree
   is successfully created"), suggest.
5. This `PropDbLoader` class (and its `processLoadResult` dispatch site) is the single generic
   loader used for ordinary SVF/OTG model loads — the *only other* `OBJECT_TREE_CREATED_EVENT`
   dispatch site in the bundle is inside `RcsPropDbLoader.prototype.load()`, a separate class used
   only for RCS reality-capture point-cloud models, not applicable to this app's model type and
   noted here only so a future reader does not mistake it for a second general-purpose path.

**Corroborating runtime evidence (this Agent Kit's own formal Knowledge,
`knowledge/viewer-fragment-geometry.md` §B, `viewer_version: 7.124.2`, last reviewed 2026-08-26,
status `active` — reused per this skill's Branch-A formal-knowledge-first rule, since the target
version matches exactly and the question is not itself freshness-sensitive):** on this exact
pinned build, a controlled runtime observation recorded a direct object-tree traversal reporting
**1 direct child where the model actually has 28**, measured immediately after
`GEOMETRY_LOADED_EVENT` had fired with `model.isObjectTreeCreated() === true` — and that wrong
count remained stable for a full 30-second idle-wait window, not merely a brief race. Per finding
3 above, `isObjectTreeCreated() === true` cannot be observed before `OBJECT_TREE_CREATED_EVENT`
has already fired (same synchronous code path) — so this runtime observation was necessarily made
**after** `OBJECT_TREE_CREATED_EVENT` had already fired for that model, directly transferring the
kit's existing finding onto the specific event this task was asked to evaluate, not only onto
`GEOMETRY_LOADED_EVENT`/`isObjectTreeCreated()` as originally recorded.

**Conclusion — two distinct, separately-classified failure modes, not one:**

- **Mode 1 — tree not yet created at all** (`model.getData().instanceTree` still `null`,
  `isObjectTreeCreated() === false`): fully preventable. `OBJECT_TREE_CREATED_EVENT`
  correlates *reliably* with the tree object's existence in the common case (finding 3), and the
  Viewer's own documented, public async-completion accessor —
  `model.getObjectTree(onSuccessCallback, onErrorCallback)` (Reference Guide: *"Gets the viewer
  model object tree. Once the tree is received it will invoke the specified callback
  function"*; returns the tree synchronously if already loaded, otherwise resolves via callback)
  — is a Viewer-documented, public wait mechanism for exactly this case, distinct from and
  preferred over the deprecated `getInstanceTree()` (a warn-once forward to the same method on
  this build, per `knowledge/viewer-model-lifecycle.md`'s sibling finding).
- **Mode 2 — tree object exists but under-populated** (the runtime-observed 1-of-28 case): **not
  preventable by any known Viewer signal.** No event, callback, or predicate this investigation
  found (official or source-level) is documented or observed to guarantee fragment/node
  enumeration has *stabilized*, only that the tree object itself now exists. The existing kit
  Knowledge page's own prescribed mitigation for this mode is a runtime retry-until-stable
  heuristic (two consecutive non-empty, agreeing reads), explicitly described there as reducing,
  not eliminating, this risk.

The investigation therefore finds the signal **unreliable for full completeness** but **reliable
and load-bearing for tree existence** — these are not the same claim, and conflating them would
either overstate the mitigation (treating the wait as sufficient) or understate it (declining to
close the fully-preventable failure mode because the harder one can't be closed).

## Decision

Outcome chosen: **(a) wait.**

`world.findClashes` waits on `model.getObjectTree()`'s documented completion (per operand — both
`query.source.model` and `query.target.model`) before the extraction walk begins. This closes
Mode 1 outright using the Viewer's own documented, public API — a genuine, preventable defect this
app's current wiring does nothing to guard against today (per this task's pre-gathered context:
`wwwroot/viewer.js`'s `loadModel()` resolves directly from `loadDocumentNode()`'s own return value,
with no listener on any readiness event gating the caller's continuation). It does **not** claim to
close Mode 2, and this record does not assert that it does — Mode 2 is recorded as a residual,
undischarged risk for whoever implements the hook point to read and decide whether to layer the
kit's retry-heuristic on top, which this record does not mandate (that decision is deliberately left
open, consistent with round-31's framing that the choice here "does not change any mechanism
already specified"). This outcome does not touch `world.admitModel`'s contract at all — `admitModel`
remains pure epoch bookkeeping, satisfying this task's protected invariant by construction, because
the wait is scoped entirely to `findClashes`, a function that already has a documented, multi-reason
rejection surface (spec `:3246-3253`) that `getObjectTree()` failure fits into as one more entry,
not a redefinition of an existing one.

## Hook point for implementation

Add the wait inside **`world.findClashes(query)`**, in `collision/CollisionWorld.js`, at the point
the spec's own API comment already names as an ordering seam: *"Entry order, before any geometry
extraction"* (spec `:3246-3253` — disposed check, cross-model check, then per-operand
evicted/admission checks already happen here). Immediately after that existing per-operand
admission step and **before** the extraction walk (Data Flow step 3) begins, for each operand
model (`query.source.model`, then `query.target.model`, deduplicating when they are the same
object): if `model.isObjectTreeCreated()` is already `true`, proceed synchronously (fast path, no
added latency for the common case); otherwise call `model.getObjectTree(onSuccess, onError)` and
await its settlement. If `onError` fires (the Viewer's own signal that the property database/tree
could not be built — e.g. the `propertyDbError`/`OBJECT_TREE_UNAVAILABLE_EVENT` path this
investigation traced), `findClashes` should reject with a clearly-named error distinct from
`WorldDisposedError`/`ModelEvictedError` (exact error class/name left to Task 19/20's own author,
since inventing it here would be implementing rather than researching) — do not silently proceed
into an extraction walk against a tree that the Viewer itself reports as unavailable.

**Owning task: Task 19/20.** `collision/CollisionWorld.js` as a *file* is created by Task 17/18,
but per this batch's own `progress.md:436`, Task 17/18's scope there is lifecycle only (`admitModel`,
`dispose`, `isModelLive`, the checkpoint-port re-architecture) — `findClashes`'s own body and the
extraction pipeline it drives are explicitly Task 19/20's scope (`progress.md:206,214,458-460`
document `findClashes`'s `toInstance()` helper and consumption of extracted data as Task 19/20's
own deliverable). Task 17/18 owns nothing from this decision record — its `admitModel` contract is
explicitly left untouched by this decision (see Decision above) — and should not need to revisit
this document at all. Task 19/20's author should additionally read
`knowledge/viewer-fragment-geometry.md` §B (this kit's own Knowledge base, not reproduced in full
here) before finalizing the hook point's implementation, since it documents the residual Mode-2
risk this decision explicitly declines to close, and a defensible (though not mandatory)
retry-until-stable heuristic for reducing it further.
