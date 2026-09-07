# M2.1 Design Prompt — Clash Witness Marker

Create a focused design spec for:

**M2.1 — Clash Witness Marker**

This is a design/spec task only.

Do NOT implement code.
Do NOT create an implementation plan yet.
Do NOT reopen settled M1/M2 architecture unless this design exposes a concrete contradiction.
Do NOT broaden this into M3 / Soft Clash / clearance.

Use the ACTUAL landed M2 implementation as the source of truth. Inventory the current code first, especially:

- `collision/CollisionWorld.js`
- current `volume-overlap` narrow-phase composition
- the M1/M2 narrow-phase query modules
- current `ClashPair` result aggregation
- `wwwroot/extensions/ClashFinderExtension.js`
- current marker/overlay/helper patterns already present in this repository, if any
- current stale-action-token / unload / visualization-reset lifecycle in `ClashFinderExtension`

Also read the finalized M2 design/spec and release documentation as context, but prefer landed code whenever design intent and implementation differ.

Save the resulting design spec under:

`docs/superpowers/specs/`

Suggested filename:

`2026-09-07-collision-library-m2.1-clash-witness-marker-design.md`

---

## Goal

Improve the existing M2 **Find Clashes** UX so a user can see a representative marker indicating **where** each Hard Clash occurs.

Today a `ClashPair` tells the caller which two dbId-level elements clash, but does not preserve a collision location.

M2.1 should add a small, additive **clash witness** concept suitable for Viewer visualization.

The marker is intended to answer:

> “Where should I look to understand this clash?”

It is NOT intended to represent a mathematically unique collision point or a complete intersection geometry.

---

## Primary design question

Define a representative witness that can be attached additively to a dbId-level `ClashPair`, conceptually:

```js
{
  source: { modelId, dbId, model },
  target: { modelId, dbId, model },
  type: 'volume-overlap',
  witness: {
    kind: 'surface-crossing' | 'containment',
    point: [x, y, z]
  }
}
```

The exact shape above is illustrative, not binding.

The design must determine the actual public shape and semantics.

---

## Required design decisions

### 1. Public result shape

Decide the additive public shape for a clash witness.

At minimum define:

- field name (`witness`, `representativeWitness`, etc.),
- whether it is optional or always present for a confirmed Hard Clash,
- `kind`,
- point representation,
- coordinate space,
- whether model/fragment provenance is needed inside the witness,
- whether any confidence/diagnostic metadata is useful.

Preserve backward compatibility:

- existing `ClashPair.source`,
- existing `ClashPair.target`,
- existing `type`.

Do not remove or rename M2 fields.

---

### 2. One witness vs. multiple witnesses

For M2.1, explicitly evaluate whether **one representative witness per dbId-level `ClashPair`** is sufficient.

Preferred scope unless evidence strongly argues otherwise:

- one representative witness per pair,
- no full contact-point cloud,
- no exhaustive triangle intersection list.

If one witness is adopted, define how it is chosen when several fragment pairs contribute to the same dbId-level `ClashPair`.

---

### 3. Coordinate-space contract

Determine the coordinate system for `witness.point`.

Strong default candidate:

- **Viewer/world space**, after all supported model-level placement/alignment transforms.

The design must reconcile this with:

- M2's model-alignment support,
- `invalidateModelPlacement(model)`,
- per-fragment world matrices,
- federated models with different original local frames.

A Viewer marker should not need to reconstruct the point from model-local coordinates.

Explode/animation remain out of scope.

---

### 4. Witness taxonomy for `volume-overlap`

A Hard Clash (`volume-overlap`) can arise through different geometric mechanisms.

The design must distinguish at least:

#### A. Surface-crossing overlap

Two closed surfaces cross.

Possible representative evidence may come from:

- a triangle/triangle intersection,
- a segment/triangle crossing,
- another already-computed narrow-phase crossing witness.

Determine what the current M1/M2 narrow-phase code already computes and whether a trustworthy point can be retained without substantially changing the algorithm.

#### B. Containment-caused overlap

One closed solid is contained in another, so positive-volume overlap exists even if there is no useful surface-crossing point.

Define what a representative containment witness means.

Potential examples:

- an already-computed interior/parity sample known to lie in the overlapping volume,
- a source/target witness sample transformed to world space.

Do NOT invent an arbitrary bbox center unless it is proven to satisfy the required geometric semantics.

The witness `kind` should allow UI/debugging code to distinguish these cases if that distinction is materially useful.

---

### 5. Do not change Hard Clash truth semantics

The existing `volume-overlap` verdict remains authoritative.

M2.1 must not redefine:

- what counts as Hard Clash,
- tolerance behavior,
- containment semantics,
- surface-crossing semantics,
- BLAS/TLAS candidate semantics.

Design the witness as **additional evidence produced alongside a verdict**, not a new predicate that changes the verdict.

Explicitly answer:

> Can witness production fail while the clash verdict remains valid?

If yes, define the public/diagnostic behavior.

---

### 6. Narrow-phase integration

Inventory the actual landed narrow-phase code and identify the narrowest insertion points where witness information could be captured.

Determine:

- which current query stages already know a useful point,
- which stages return only booleans/verdicts today,
- whether a small additive internal result object is needed,
- whether existing M1 query APIs can remain backward compatible,
- whether only `volume-overlap` needs witness support in M2.1.

Prefer additive internal APIs such as:

```js
{
  hit: true,
  witness: ...
}
```

only if justified by the current code.

Do not mechanically convert every M1 query module to a new result shape if only a small subset actually needs it.

---

### 7. Fragment-pair → dbId-pair aggregation

M2 aggregates multiple fragment-pair narrow-phase results into one dbId-level `ClashPair`.

Define deterministic witness selection when:

- multiple source fragments clash with one target fragment,
- one source fragment clashes with multiple target fragments,
- several fragment pairs map to the same `(sourceEpoch, sourceDbId, targetEpoch, targetDbId)` pair,
- both a surface-crossing witness and a containment witness are available for the same dbId-level pair.

The selection rule must be:

- deterministic for equivalent input,
- independent of incidental async scheduling/order where possible,
- stable enough that repeated queries do not make the marker jump arbitrarily.

Evaluate options such as:

- first by canonical fragment-pair order,
- prefer surface-crossing over containment,
- lexicographic witness provenance,
- another clearly-defined stable ordering.

Do not choose “first callback wins” if traversal order is not a stable public contract.

---

### 8. Witness provenance

Evaluate whether the witness should retain internal provenance such as:

- `sourceFragmentId`,
- `targetFragmentId`,
- source/target loadEpoch,
- local triangle index,
- witness stage/kind.

Public UI may not need all of this, but some provenance may materially improve:

- deterministic aggregation,
- debugging,
- diagnostics,
- future marker interaction.

Keep the public shape minimal unless provenance is genuinely useful.

---

### 9. No-trustworthy-witness behavior

Define what happens if:

- the clash verdict is confirmed,
- but no reliable representative point can be produced.

Required principle:

**Never turn a confirmed clash into “no clash” because witness generation failed.**

Evaluate one of:

- `witness: null` plus a diagnostic,
- optional witness field plus diagnostic,
- a structured witness-unavailable reason.

Do not silently invent a geometrically unjustified point just to guarantee marker rendering.

---

## Viewer marker design

### 10. Marker rendering approach

Design how `ClashFinderExtension` displays the witness.

The marker should:

- clearly identify the clash location,
- work across federated models,
- use world-space placement,
- remain visually distinct from ordinary selection/highlight,
- not modify collision-engine UI state.

Evaluate the simplest Viewer-appropriate rendering mechanism already used in this repo or available in the current Viewer environment, such as:

- overlay scene geometry,
- a lightweight Three.js marker mesh,
- a screen-space label/HTML overlay if more appropriate,
- another existing helper pattern already present in the project.

Do not build a full clash-management UI.

---

### 11. Marker lifecycle

Define precisely when markers are created and cleared.

At minimum cover:

- a successful `Find Clashes` action,
- a newer action superseding an older in-flight action,
- a zero-clash result,
- a query failure,
- extension unload,
- model unload,
- clearing/restoring clash visualization,
- running `Find Clashes` again on a different source.

Reuse the current monotonic stale-action-token discipline already landed in `ClashFinderExtension`.

A stale async result must never re-add old markers after a newer action has already updated the Viewer.

---

### 12. Multiple clash results

If one source has N `ClashPair`s, decide whether M2.1 shows:

- one marker per pair,
- a capped number,
- one marker at a time,
- or another simple policy.

Strong default candidate:

- one marker per returned `ClashPair` that has a trustworthy witness.

If many clashes can create excessive marker density, document the limitation rather than designing a full filtering/dashboard system in M2.1 unless a minimal cap is clearly necessary.

---

### 13. Marker interaction

Decide whether markers are purely visual in M2.1 or interactive.

Preferred M2.1 scope:

- visual marker only,
- no click-to-select clash pair,
- no tooltip/panel,
- no clash list/dashboard.

If a tiny label or count materially improves usability without expanding scope, evaluate it explicitly.

---

## Non-goals

M2.1 must NOT add:

- penetration volume,
- overlap volume calculation,
- intersection curve,
- intersection mesh,
- all triangle contact points,
- point cloud of contacts,
- Soft Clash / clearance,
- configurable clearance distance,
- TLAS architecture changes,
- BLAS replacement,
- worker/off-main-thread rewrite,
- explode support,
- animation support,
- arbitrary per-fragment dynamic-transform support,
- clash dashboard/history/approval/status workflow,
- persistent clash storage.

---

## Correctness / test design

The design must specify tests for:

### Witness correctness

- known surface-crossing Hard Clash produces a witness of the expected kind,
- known containment-caused Hard Clash produces a containment witness,
- witness point is in the documented coordinate space,
- model alignment followed by `invalidateModelPlacement` produces a witness in the new aligned world location,
- TLAS and linear modes return equivalent clash pairs and compatible representative witnesses for equivalent inputs.

Do not require raw candidate traversal order to match.

### Aggregation determinism

- multiple fragment-pair hits rolling into one dbId-level pair choose the same representative witness deterministically,
- repeated identical queries do not arbitrarily switch witness points.

### Failure behavior

- confirmed clash + unavailable witness still returns the clash,
- the missing witness surfaces the chosen diagnostic/optional-field behavior.

### Marker lifecycle

- markers appear for witness-bearing results,
- zero-clash clears previous markers,
- failed query does not leave stale markers,
- stale in-flight action cannot restore old markers,
- extension unload clears markers,
- model unload clears/invalidate markers referencing the unloaded model.

---

## Acceptance workflow

Define a small live Viewer acceptance extension to the existing M2 flow.

Example:

1. Load the existing real federated Architecture / Structure / Mechanical fixture.
2. Select a source with a known Hard Clash.
3. Right-click → Find Clashes.
4. Existing clash isolation/highlight behavior still works.
5. A visible clash marker appears at the representative witness location for each witness-bearing result.
6. Camera movement/fit confirms the marker visually sits at the clash region.
7. Run a known negative source → previous markers clear, no new marker remains.
8. If practical, perform one model-alignment operation, invalidate placement, rerun, and confirm the marker moves with the newly-aligned clash location.

Do not require pixel-perfect screenshot comparison unless the existing acceptance infrastructure already makes that reliable.

---

## Performance considerations

Witness generation should be designed as a small additive cost to narrow phase.

The design must state:

- whether witness data is already computed and merely retained,
- where any new work is introduced,
- whether only the selected representative pair requires extra work or every narrow-phase hit does,
- expected allocation/storage impact,
- whether performance instrumentation needs any additive field.

Do not add a new performance subsystem unless justified.

---

## Required review

After drafting the design:

1. Run one independent targeted design review focused on:
   - geometric correctness of surface-crossing vs containment witnesses,
   - deterministic fragment→dbId witness aggregation,
   - world-space transform correctness,
   - preserving existing Hard Clash verdict semantics,
   - marker lifecycle/stale-action correctness.
2. Fix genuine Critical/High findings in the same design pass.
3. Do not reopen unrelated M2 architecture.
4. Do not run a broad comprehensive M2 review.

---

## Final report

End the spec with a short report covering:

- adopted public witness shape,
- witness kinds and semantics,
- world/local coordinate decision,
- narrow-phase integration point,
- dbId-level aggregation rule,
- unavailable-witness behavior,
- marker rendering/lifecycle approach,
- compatibility impact,
- remaining open questions,
- explicit verdict:

`ready for implementation planning`

or

`not ready for implementation planning`, with precise blockers.

Do not implement anything yet.
