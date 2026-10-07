# clashtest/viewer: Viewer adapter

The Viewer seam of the Federated Clash Test core engine: a production `ElementEnumerator` over an Autodesk Viewer
`Model`, and the `ModelRegistry` unload wiring. The core imports nothing from this directory (spec 2.1); the core
barrel `clashtest/index.js` does not export it. Import it from its own entry point, `clashtest/viewer/index.js`,
which exports exactly `createViewerElementEnumerator` and `wireModelUnload`.

**Status: implementation complete, live acceptance pending. This adapter is not yet integrated into any host**
(no Panel, no UI, no `server.js` route, no persistence wiring; all out of scope here). See "Gates" below before
describing it as production-ready.

## Contract

`createViewerElementEnumerator({ scheduleTimeout, clearScheduled, readinessPollMs })` returns a frozen object with
exactly the two `ElementEnumerator` port methods, `resolveRoots(binding, scope, ctx)` and
`digestScope(binding, scope, ctx)`. Return shapes are those validated by `validateResolveRootsResult` /
`validateDigestScopeResult` and `checkEnumeratorConformance` in `clashtest/planning/ElementEnumerator.js`.

- **Never cached.** The enumerator is stateless. Every call re-reads the live model (spec 6.2); a failed call
  leaves nothing behind, and there is no module-level state.
- **Checkpoint cadence.** Each method calls `ctx.checkpoint()` once before it reads the model, in the same tick
  when the checkpoint returns `undefined` (conditionally synchronous, like `collision/scheduler.js`). Later reads after internal asynchronous boundaries are covered by the periodic checkpoints, not a same-tick guarantee. Loops
  checkpoint at least once per `CHECK_EVERY = 64` node visits, fragment scans or records (provisional, G-CAL,
  overridable, never asserted against elapsed time). `EnumerationCancelledError` propagates unwrapped. Items
  delivered inside one synchronous Viewer callback burst (`enumNodeFragments`, `enumNodeChildren` on one node)
  cannot be checkpointed; the Viewer's own burst is not preemptible.
- **Readiness caveat (G-VA-READY).** Every path that reads the instance tree (`resolveRoots`, and `digestScope` for explicit scopes) waits for the object tree: the
  `isObjectTreeCreated()` fast path, else `getObjectTree(onSuccess, onError)`, polling `ctx.checkpoint()` every
  `readinessPollMs` (default 250, provisional) so cancellation is honored. `onError`, or a tree that is absent
  after readiness, throws the collision library's `ObjectTreeUnavailableError`. OQ-4 records general
  readiness-gate sufficiency as **not evidenced**: the gate is an input to re-validate, not a sufficiency claim.
  Geometry-load readiness (`isLoadDone()`) is not gated; not-loaded fragments fail closed (below).

## Evidenced envelope (OQ-4)

**Audubon / SVF non-OTG / Viewer 7.124.2 / Chromium 151**

Source: `docs/research/2026-09-26-federated-clash-test-oq4-live-evidence-check.md`. This README does not claim
more than that envelope.

Not evidenced (OQ-4 §7); per-case behavior below. The planned T3 script (Task 13, not yet executed) is to characterize them.

| Not evidenced | Behavior in this adapter |
| --- | --- |
| OTG / SVF2 models | Untested; no behavior is claimed. Wherever the adapter's own checks detect an inconsistency (readiness, D-V6, D-V9 bounds) planning fails with `enumeration-failed`; nothing is guessed. |
| 2D sheets | Untested; same as above. |
| Non-Revit content | Untested; same as above. |
| Not-loaded (N), owner-unresolvable (U) or out-of-range tree-reachable fragments | Whole-model planning fails for the run (D-V6, below). The one exception is a tree-reachable null-geometry `N` fragment (next row). |
| Null-geometry not-loaded fragments (OTG/SVF2, geometry id 0) | Population class `N` with a transient `nullGeometry` flag (below). Unreachable: informational, not counted as unattributable. Tree-reachable: also informational (owner-authorized D-V6 exception, 2026-10-07): marked reachable, owner comparison skipped, planning proceeds (live: Audubon Architecture under SVF2, fragments 4600/4601). |
| Unreachable or mixed-owner content | Owner mismatch and unreachable fragments are reported through the port (offline-tested); a fragment reachable under two roots fails planning. Not evidenced live. |
| PairId role-symmetry half of AC-15 (g) | Not evidenced; the adapter enables no such claim. |
| Tree-unavailable failure path, live | Offline-tested only; maps to `ObjectTreeUnavailableError`. |
| General readiness-gate sufficiency | Not claimed (G-VA-READY). |
| Cross-reload fragment identity | Not evidenced; a reload is a new `Model` object (unload recipe). |

## Fail-closed policy (D-V6, owner-approved)

During whole-model reconciliation, a tree-reachable fragment that is not loaded (class N), owner-unresolvable
(class U: `getDbIds` undefined or an array), or whose id is outside `0..getCount()-1` throws
`EnumerationInconsistencyError`, which the planner maps to the planning gap `enumeration-failed`: planning fails
for the run. This is conservative by owner decision; it is revisitable only by an explicitly authorized future
design. There is no partial-planning carrier: no partial roots, no population, no diagnostic row. Explicit
`{dbIds}` scopes keep their declared boundary (no independent population witness, same as the library's
`extractFragments`) and are not subject to D-V6; a value an explicit walk cannot digest still fails closed through
the digest producers.
The single exception is a tree-reachable null-geometry `N` fragment (`nullGeometry: true`, section below), which is informational.

## Null-geometry not-loaded fragments (owner-authorized, 2026-10-07)

`populationScan` applies the collision library's own discriminator
(`docs/superpowers/specs/m2-extractAllFragments-viewer-evidence.md`, "OTG / SVF2"): a fragment with
`fragList.isNotLoaded(fragId)` **and** `fragList.getGeometryId(fragId) === 0` is one the Viewer
deliberately never loads because it has no geometry. Its record stays class `N` (the population and
scope digests are byte-identical to before; `scopeDigest.js` encodes an `N` record as `[fragId, 'N']`
only) and carries `nullGeometry: true`. During whole-model reconciliation an **unreachable** such
fragment is informational: it is counted in neither `unreachable.unattributable.notLoaded` nor
`ownerUnresolvable`, so on its own it adds no `unreachablePopulation` row. A **tree-reachable** one is also
informational (owner-authorized bounded D-V6 exception, 2026-10-07; design spec erratum A19): it is marked reachable, skips the owner comparison, stays in the population and root digests, and planning proceeds. Every other tree-reachable `N` (real geometry id), `U` and out-of-range fragment still fails D-V6. The library reports the
fragment as the informational `fragment-null-geometry` diagnostic, which is not completeness-affecting
(`clashtest/execution/diagnostics.js`, design spec erratum A18); its presence in a Result Set is
best-effort telemetry, not a ledger guarantee.

## Bounded planning (D-V9, owner-approved)

Planning is bounded by the collision library's own limits, read from `collision/constants.js` and not changed
(no new limit, no Core change):

| Limit | Value | Bounds |
| --- | --- | --- |
| `maxFragmentsPerDbId` | 5,000 | fragments per requested root (tally spans the root's subtree; rediscoveries count) |
| `maxChildrenPerNode` | 10,000 | children of one node (callback aborts at limit + 1) |
| `maxCollisionInstancesPerEpoch` | 20,000 | whole-model population, compared to `fragList.getCount()`, and the tree-reachable tally |

A planning pass that crosses one fails the run with `enumeration-failed` (`EnumerationBoundExceededError` for the
first two, the library's `CapacityExceededError('whole-model-enumeration')` for the third) instead of deferring to a
per-unit execution gap. Exactly at the limit succeeds. Consequence: a root over 5,000 fragments, a node over 10,000
children, or a population over 20,000 fails the whole run at planning.

**Recorded residual:** the number of tree nodes is bounded by no existing limit. The ids-only parent index, the
whole-model index and the per-root visited sets are O(nodes), the same order as the Viewer's own resident tree.
T3 measures their size and time under G-CAL; nothing is capped or asserted here, and a node ceiling would be a new
public limit this milestone is not authorized to add.
The same class of residual applies to explicit scopes: retention across the requested roots is charged per root (≤ maxFragmentsPerDbId each) but not against a whole-population ceiling; it is bounded by the number of requested roots and, because a fragment shared by two roots is a defect, by the model's own fragment count.

## Registration recipe

Registration is a host call; the adapter wires only unload.

```js
engine.registry.register(modelKey, model, { modelVersion });
```

The host supplies both `modelKey` and `modelVersion`. **OQ-1: the adapter provides no derivation and no default**
(Gate G-VA-OQ1). A `modelKey` names one immutable version: re-translation means a new key.
`ModelKeyVersionConflictError` lasts for the registry's lifetime, even after `unregister`.

## Unload recipe

```js
const wiring = wireModelUnload({
  world,
  registry: engine.registry,
  eventTarget: viewer,
  eventName: Autodesk.Viewing.BEFORE_MODEL_UNLOAD_EVENT,
});
// later: wiring.dispose();
```

On the event the handler calls `registry.unregister(model)` then `world.evictModel(model)`; it never throws and
never awaits (a host `report(stage, error)` callback receives failures). Evicted `Model` objects are permanently
evicted: a reload is a new object. The event name is the host's (this layer references no Viewer global). A
registry that does not belong to `world` is rejected at wiring time (`ModelBindingError`, reason
`registry-mismatch`).

## Gates (recorded, not closed)

- **G-VA-T3-EXEC.** Implementation is complete and live acceptance is pending. The adapter is **not** production-ready
  until the Task 13 T3 script has been executed live (credentials and Chromium, project owner or an explicitly
  delegated run accepted by the owner) and its result recorded under `docs/research/`. Pass criteria include step (h).
  Execution is a separate owner authorization.
- **LIVE_UNLOAD_INTEGRATION_UNVERIFIED.** `wireModelUnload` has only offline proof (a fake event target). The adapter is
  **not** production-ready until T3 has been executed with step (h) (unload wiring on the real Viewer event)
  passing. If (h) cannot be run deterministically, the recorded result stays `LIVE_UNLOAD_INTEGRATION_UNVERIFIED`.
- **G-VA-OQ1.** Integration acceptance is blocked until OQ-1 has a written `modelKey`/`modelVersion` derivation and a
  test that a re-translation changes `modelVersion`.
- **G-VA-READY.** The readiness gate is an input to re-validate; no sufficiency claim.
- **G-CAL / G-RESP.** `CHECK_EVERY`, `readinessPollMs` and the responsiveness claim are characterization-only.

## Out of scope

Host integration, the Panel and any UI, a `server.js` static route for `/clashtest`, and persistence are not part of
this adapter and are not authorized by it.
