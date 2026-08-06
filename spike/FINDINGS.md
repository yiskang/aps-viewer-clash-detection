# Spike findings

Two parts. **Part A** (`geometry-core.mjs` + `fixtures.mjs` + `measure.mjs`, Node) tested the
algorithm against synthetic geometry. **Part B** (Playwright against the live viewer) tested the
spec's assumptions against the real acceptance model,
`racbasicsampleproject.rvt` — URN `dXJuOmFkc2sub2JqZWN0czpvcy5vYmplY3Q6dGVzdC1zYW5kYm94LWxrd2VqN3hwYmdwNjN4NGhsMzM1eTZtMjZvYWtnZ29mL3JhY2Jhc2ljc2FtcGxlcHJvamVjdC5ydnQ`
(classic SVF; `isSVF2()` and `isOTG()` both false).

## The acceptance question, answered

> Which room contains `Bathtub-TOTO-Nexus-FBF794S [420270]`?

**Master Bath 207 [857194]** (dbId 3885) — 907 of the bathtub's 1003 world-space vertices classify
inside it. Every one of the other 13 rooms scored exactly 0. No ambiguity, no tie to break.

## Part A — algorithm defects (synthetic)

| # | Finding | Status |
|---|---|---|
| A1 | **Local-axis ray directions are pathological.** A ray along local +X from a symmetric interior point of an axis-aligned box hits the exact centre of a face — where `BoxGeometry` splits its two triangles — so it grazes the diagonal; +Y does the same; the box's own centre returns `boundary`. | Spec fixed: generic non-axis-aligned directions |
| A2 | **Welding is mandatory, not optional repair.** Unwelded, a box splits into 6 components, a cylinder into 49, and `closedManifold` is false for every solid. `mergeVertices` only works on position-only geometry (it compares all attributes; per-face normals make every vertex unique). | Spec fixed: required normalization step |
| A3 | Welding *shrinks* geometry ~23% — so abandoning the zero-copy position strategy costs no memory. | Spec fixed |
| A4 | Measured budgets: BVH build ~16ms @ 18k tris (`maxSyncTriangleCount = 20_000` survives); raw candidate pairs ~0.3µs each, so `maxCandidatePairsExamined` 200_000 (~53ms) → 50_000. | Spec fixed |

`node spike/fixtures.mjs` → 39/39, covering every regression case from seven review rounds.

## Part B — spec assumptions vs the real model

### B1. `Autodesk.Viewing.Private.THREE` does not exist  *(P1 — spec was wrong)*

Viewer 7.124.2 exposes its THREE as the **global `window.THREE`, at revision 71**. The spec's
runtime-isolation section names `Autodesk.Viewing.Private.THREE` throughout; code following it
literally gets `undefined` (this spike hit exactly that).

This makes the isolation requirement *more* important, not less, and for a sharper reason than the
spec gave:

- The global is **already occupied** by Viewer. The rule isn't "don't pollute a free global," it's
  "don't clobber Viewer's r71 and break rendering."
- r71 vs the pinned r185 is a ~114-revision gap, and `three-mesh-bvh@0.9.14` requires `>= 0.159.0`.
  Sharing one runtime is not merely inadvisable, it is impossible. The two-runtime design is
  vindicated.
- The spec's proposed acceptance test ("verify `window.THREE` is unchanged before and after loading
  the library") is exactly right — it just needs to assert `REVISION === '71'`, not absence.

### B2. The bracketed number is a Revit ElementId, not a dbId  *(P1 — would break the extension)*

`Bathtub-TOTO-Nexus-FBF794S [420270]` has **dbId 2530**. `enumNodeFragments(420270, …, true)`
returns an empty array — 420270 is the Revit ElementId embedded in the display name. Anything that
treats the browser-visible number as a dbId silently finds nothing.

Also confirmed: dbId 2527 is the family/type node with one child; `recursive: true` on it correctly
collects the child's fragment, validating the spec's insistence on the recursive flag.

### B3. SVF geometry is fully unwelded triangle soup  *(confirms A2, more starkly)*

Every room fragment has `rawVerts === 3 × triangles` exactly, and raw component count **equals the
triangle count** — no two triangles share a vertex index at all.

| Room | tris | raw verts | welded verts | components raw → welded | closed raw → welded |
|---|---|---|---|---|---|
| Master Bedroom 206 | 64 | 192 | 34 | 64 → **1** | false → **true** |
| Master Bath 207 | 56 | 168 | 30 | 56 → **1** | false → **true** |
| Bedroom 204 | 36 | 108 | 20 | 36 → **1** | false → **true** |
| Bath 203 | 12 | 36 | 8 | 12 → **1** | false → **true** |
| Bath 205 | 16 | 48 | 10 | 16 → **1** | false → **true** |
| Bedroom 202 | 32 | 96 | 18 | 32 → **1** | false → **true** |

### B4. Rooms weld into **perfect closed manifolds**  *(the load-bearing unknown, answered)*

Every room tested: 1 component, **0 boundary edges, 0 non-manifold edges**. The target-side
precondition that ray-parity containment depends on **holds for real Revit room geometry**. This was
the spec's single most load-bearing risk and it lands favourably.

### B5. But source geometry does *not* — and that breaks a round-6 rule  *(P2 — spec needs revision)*

The bathtub, welded: **14 components, 441 boundary edges, 5 non-manifold edges** — open and
non-manifold. Real furniture is not a closed solid.

Round 6 added: *a positive result decided by an open component emits `unverified-open-component`.*
It was motivated by a zero-volume open triangle. But since real source geometry is essentially
always open, **that diagnostic would fire on virtually every query** — noise, not signal, and it
would train users to ignore diagnostics generally.

The distinction the spec missed is which *side* is open:

- **Target open** → ray parity is unreliable. Serious; diagnose.
- **Source open** → parity is still evaluated against a closed target, so "is this point in the
  room" remains well-posed. Common and benign for containment; a 441-boundary-edge bathtub is a
  nearly-closed solid, not a zero-volume sheet.

Suggested revision: scope `unverified-open-component` to genuinely degenerate sources (a component
enclosing no volume), not to any component with boundary edges.

> **Superseded by round 7.** That suggestion was not implementable: no metric in the design separates
> a 441-boundary-edge bathtub from a zero-volume sheet, and defining one is a research task. The
> accepted fix keeps the strict rule and moves the line to the **mode** instead — `volume-overlap`
> requires certified-closed operands, and a new `containment` mode answers the room-locator's actual
> question with open sources sound by construction. Round 7 also found the corollary this section
> missed: the same reasoning that makes source-openness benign makes **target**-openness fatal, and
> nothing was checking it, so a closed source against an open target returned a clean result built on
> meaningless parity. Both rules now have fixtures (`nearly-closed shell`, `open TARGET`).

### B6. Primitive-range machinery is dead code for this format

Across every fragment inspected: `groups = 0`, `drawRange = null`, `offsets` absent. The
`drawRange ∩ groups` intersection rules and legacy-`offsets` rejection that consumed two review
rounds are never exercised here. Worth keeping as defensive normalization, worth *knowing* it is
untested-by-reality.

Likewise the adapter's fallbacks: **100% of fragments took the `vb`/`vbstride` branch** with `ib`
indices. `InterleavedBufferAttribute` and `BufferAttribute` branches never fire on SVF.

### B7. For the room-locator specifically, the BVH may be unnecessary

Brute-force point-in-mesh — no BVH, no TLAS, no caching, plain Möller–Trumbore over raw triangle
arrays — resolved 1003 bathtub vertices against all 14 rooms in **10.2ms**.

Rooms are 12–64 triangles each. The whole BLAS / lazy-build / `maxSyncTriangleCount` /
cache-eviction apparatus is real engineering that this use case does not need. It is justified for
the *general* clash-detection library the idea doc describes; it is over-engineering for the
extension that is meant to prove it. Worth deciding deliberately rather than by momentum.

> **Decided: the BVH stays.** Milestone 1 builds the general clash-detection library; the
> room-locator is its first *consumer*, not its design target. So this measurement does not shrink
> the scope — but it does change what the acceptance test proves. Passing the room-locator at 64
> triangles per room exercises correctness only, and leaves every performance claim in the spec
> (`maxSyncTriangleCount`, `maxCandidatePairsExamined`, lazy BLAS build, cache eviction) resting on
> `measure.mjs`'s synthetic geometry. **The MEP-scale benchmark is therefore load-bearing, not
> optional polish** — it is the only thing that will exercise the machinery this decision keeps.

## Reproducing

```
node spike/fixtures.mjs     # 39/39 — algorithm regression suite
node spike/measure.mjs      # budget measurements
PORT=8080 npm start         # then drive the viewer; Part B ran via Playwright
```
