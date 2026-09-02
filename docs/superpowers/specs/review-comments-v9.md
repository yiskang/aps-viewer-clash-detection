I would not approve the specification yet. The round-8 findings were addressed, but three correctness blockers and one performance-contract gap remain.

1. **[P1] `containment`’s constructed witness violates its new surface-only contract.**

   The mode asks whether a point **on the source surface** lies inside the target ([spec:664](/Users/kangea/Documents/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md:664)), yet it reuses `anyComponentInside` verbatim ([spec:1148](/Users/kangea/Documents/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md:1148)). That sampler’s third stage deliberately steps off the surface and constructs a point in the source’s volume ([spec:1043](/Users/kangea/Documents/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md:1043)).

   Two coincident closed boxes are a counterexample: every source-surface point is on the target boundary, so surface containment is false, but the constructed inward witness is inside both boxes and returns true. `ContainmentModeQuery` needs a surface-only sampler that never uses the interior-witness stage, plus a coincident-shell fixture.

2. **[P1] The open-component diagnostic is undefined for reverse containment.**

   `volume-overlap` evaluates both `A inside B` and `B inside A` ([spec:1081](/Users/kangea/Documents/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md:1081)), but `unverified-open-component` is described only as an open **source** component ([spec:1298](/Users/kangea/Documents/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md:1298)).

   With a closed public source containing an open-triangle public target, the spike returns `true` via `containment(B in A)`, with `openComponent: true` and no parity fault. The required public diagnostic is therefore `unverified-open-component`, `role: 'target'`, but the normative rules never state that mapping. Define the diagnostic for the deciding sampled component in either public role and test both operand orders.

3. **[P1] `SurfaceCrossingWitness` can still return a clean false because its probe distances are not constrained by the source triangle.**

   It uses the geometry-wide canonical `offsetLadder` ([spec:591](/Users/kangea/Documents/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md:591)) and simply rejects probes outside the source triangle ([spec:1126](/Users/kangea/Documents/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md:1126)). If the canonical operand has a very large diagonal—or the source geometry contains a small triangle plus a distant component—all three rungs can exceed the triangle’s available in-plane width. No probe is classified and no rule marks that candidate inconclusive.

   This produces the same clean false the new stage was intended to eliminate. Probe distances should adapt to the available distance from the intersection segment to the source-triangle edges; failure to produce a valid off-boundary probe must be inconclusive. The spike is not validating the specified rule: it uses `min(src.L, target.L)` instead of `L_canonical` ([geometry-core.mjs:341](/Users/kangea/Documents/Workspace/Codes/aps-viewer-clash-detection/spike/geometry-core.mjs:341)).

4. **[P1] The one-frame budget still does not bound an actual synchronous browser task.**

   The ~15 ms limit applies to one traversal ([spec:889](/Users/kangea/Documents/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md:889)), while `findClashes` yields only between new BLAS builds—not between cached candidate pairs or query stages ([spec:1209](/Users/kangea/Documents/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md:1209)). A negative pair can synchronously run a full crossing traversal, hundreds of containment classifications, and another traversal; multiple cached pairs then run consecutively.

   Consequently, the performance gate’s “no single synchronous step exceeds ~16ms” criterion ([spec:1663](/Users/kangea/Documents/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md:1663)) is not guaranteed by the design. Add cooperative yielding/a whole-task time budget and measure the browser’s longest event-loop task, particularly on a cache-warm multi-pair query.

Smaller inconsistencies:

- The public API still defines containment as “any part of the source” ([spec:1236](/Users/kangea/Documents/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md:1236)), contradicting the surface-only contract.
- The claim that the 55 spike fixtures cover every eight-round regression is too strong: the spike omits the constructed-interior-witness stage and does not cover reverse open-component roles or disparate-scale crossing witnesses.
- The status header still says revised after six rounds.

The previous round-8 findings themselves were otherwise addressed, including the MEP-scale performance gate. `node spike/fixtures.mjs` passes 55/55. No files were modified.