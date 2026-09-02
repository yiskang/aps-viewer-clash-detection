I would not approve the specification yet. The round-7 corrections are mostly incorporated, but two correctness blockers and one milestone-verification gap remain.

1. **[P1] The new `containment` mode is not correct for its stated contract.**

   The mode asks whether “any part of the source” lies inside the target ([spec:656](/Users/kangea/Documents/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md:656)), but directly invokes `anyComponentInside` without a crossing test ([spec:1077](/Users/kangea/Documents/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md:1077)). That sampler’s correctness explicitly assumes `ProperCrossingQuery` already returned false ([spec:940](/Users/kangea/Documents/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md:940)) and stops at the first `inside` or `outside` vertex ([spec:1006](/Users/kangea/Documents/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md:1006)).

   A connected open source can straddle the target boundary. If its first sampled vertex is outside, the mode returns a clean false even when another vertex—or the interior of a triangle—is inside. A large triangle passing through a room with all three vertices outside is a minimal counterexample.

   The spike exposes the same defect: two perpendicular intersecting boxes return clean `contained: false` in both directions, even though they share volume. The current 39 fixtures only test open sources wholly inside a target.

   The spec must either:

   - add intersection-aware containment logic, or
   - narrow and rename the contract to something like “a source component is wholly contained,” then define how that is proven for open components.

   The proposed test asserting `containment(room, element) === false` for an element inside a room ([spec:1482](/Users/kangea/Documents/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md:1482)) also contradicts the current “any part” wording: some room volume necessarily lies inside the element.

2. **[P1] Open-operand diagnostics remain underspecified on the proper-crossing path.**

   The spec correctly recognizes that `ProperCrossingQuery` parity-tests both operands and therefore requires both closed ([spec:664](/Users/kangea/Documents/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md:664)). But `volume-overlap` early-exits on a crossing before containment identifies a “deciding component” ([spec:1053](/Users/kangea/Documents/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md:1053)), while diagnostics define:

   - `unverified-open-component` only for a positive decided by an open source component;
   - `unverified-target` only for parity against the target ([spec:1229](/Users/kangea/Documents/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md:1229), [spec:1263](/Users/kangea/Documents/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md:1263)).

   No rule says what a proper-crossing positive emits when either or both crossing operands are open. The spike papers over this by setting `unverifiedTarget` when *either* operand is open ([geometry-core:306](/Users/kangea/Documents/Workspace/Codes/aps-viewer-clash-detection/spike/geometry-core.mjs:306)), mislabeling an open source as an open target. Its fixtures do not cover an open operand producing a proper crossing.

   Require a closure check before the crossing early exit and define role-accurate diagnostics—preferably an open-operand diagnostic carrying `role`, or explicit source/target reasons.

3. **[P1] The MEP-scale benchmark is called a milestone dependency but is not a milestone test.**

   The spec accepts B7’s BVH retention and correctly says the bathtub acceptance model proves correctness only. It then calls an MEP-scale model a milestone dependency ([spec:1585](/Users/kangea/Documents/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md:1585)). Nevertheless, the scope excludes the benchmark suite ([spec:310](/Users/kangea/Documents/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md:310)), and Testing defines only unit fixtures plus the tiny-room acceptance query ([spec:1520](/Users/kangea/Documents/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md:1520)).

   Keeping the BVH is defensible—I agree with rejecting removal—but the promised single MEP-scale performance gate must be added to milestone verification. It need not become a full benchmark suite.

Smaller stale inconsistencies:

- Included query modes omit the newly public `containment` mode ([spec:301](/Users/kangea/Documents/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md:301)).
- `maxSyncTriangleCount` is still described as unbenchmarked/provisional despite the later measured result ([spec:539](/Users/kangea/Documents/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md:539)).
- The risks section still says connectivity depends on index sharing “not geometric welding,” contradicting mandatory welding ([spec:1554](/Users/kangea/Documents/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md:1554)).
- One test still says retry on an alternate axis ([spec:1407](/Users/kangea/Documents/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md:1407)).
- The room edge-case text still says `volume-overlap` resolves the room instead of `containment` ([spec:1341](/Users/kangea/Documents/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md:1341)).

The original four round-7 P1 findings were otherwise addressed: bounded surface traversal, empty `groups`, explicit target closure, and the unimplementable degeneracy heuristic. `node spike/fixtures.mjs` still passes 39/39, but those fixtures do not cover the two counterexamples above.

The referenced filename is actually `review-comments-v7.md`, with two “m”s. No files were modified.