# Collision Library Roadmap

Status: durable architecture guidance. This is not a milestone spec and not an implementation plan. It records what already exists, what M4 is for, the downstream path beyond M4, and the compatibility constraints that bind future milestone design work.

As of 2026-09-08 (`main` at `0368a9d`).

This document does not reopen or redefine M1, M2, M2.1, M3, or M4 scope. Where it lists constraints, those constraints are binding on M4+ design unless explicitly superseded by a later reviewed architecture decision (see §8).

## 1. Current completed capability

Landed on `main`:

- **M1 — Core collision foundation.** Single-model `CollisionWorld` over one Viewer model's fragment geometry (BVH-accelerated), `findClashes` with `surface-intersection` / `containment` / `volume-overlap` modes, explicit model lease/epoch lifecycle, and fragment/pair-scoped diagnostics that distinguish an incomplete result from a genuine negative.
- **M2 — Federated Clash Finder.** Multi-model federated queries (`target: {targets: [...]}`), TLAS broad phase with a `'linear'` correctness oracle retained permanently, and whole-query abort-on-eviction semantics across every touched model.
- **M2.1 — Clash witness marker.** Additive `ClashPair.witness` (surface-crossing / containment point) for `volume-overlap` pairs, deterministic witness aggregation, and Viewer-native marker rendering in `ClashFinderExtension`.
- **M3 — Soft Clash / Clearance.** New `mode: 'clearance'` (`findClashes` with a `clearance` radius) reporting near-miss pairs (`toleranceFloor < distance <= clearance`) via BVH-to-BVH closest-distance queries, excluding any pair already covered by a Hard-Clash; reuses the existing TLAS broad phase inflated by the clearance radius; uniform-scale-only (anisotropic per-instance scale is rejected, not silently mishandled); Soft Clash visualization wired into `ClashFinderExtension`.

These four are completed milestones, merged to `main`. Their public contracts (query shapes, result shapes, identity model, diagnostics semantics) should not be casually reopened.

## 2. M4 remains unchanged

M4's purpose is unchanged: **benchmark-driven evaluation of whether worker/off-main-thread execution is actually necessary.**

M4 must remain evidence-driven. It measures realistic federated workloads, identifies where main-thread cost actually comes from, and decides whether worker/off-main-thread execution is justified. This framing is already consistent across the M2, M2.1, and M3 design/plan prompts ("worker/off-main-thread execution remains deferred unless benchmarks demonstrate it is necessary") and this roadmap does not change it.

M4 is not redefined as Federated Clash Test & Results. Viewer Clash Panel implementation is not inserted into M4.

Before implementation, M4 requires its own reviewed design specification — following the same design-spec convention as M1–M3 — that fixes the workload matrix, measurement protocol, thresholds, and possible outcomes, and that evaluates worker-boundary feasibility (what can actually cross a worker boundary: geometry/BVH transfer or rebuild cost, live `Model`-reference identity, memory duplication) rather than treating "worker vs. not" as a single undifferentiated verdict. This roadmap does not define those specifics; it only requires that M4 not proceed without them.

## 3. Future downstream path

```text
Collision Core
  → Federated Clash Test & Results
  → Viewer Clash Panel
```

Responsibility boundary:

- **Collision Core**: geometry/query execution, correctness, provenance, diagnostics, budgets, scheduling hooks.
- **Federated Clash Test & Results**: batch/many-object orchestration, test definitions, result-set semantics/lifecycle, aggregation/grouping/filtering-ready data, progress/cancellation.
- **Viewer Clash Panel**: user-facing test/result management, grouping/filtering presentation, navigation, inspection, interaction state.

These responsibilities are not collapsed into one layer.

## 4. Cross-milestone compatibility constraints

Binding on future M4+ design work unless explicitly superseded by a later reviewed architecture decision (§8):

- Preserve stable, unambiguous source / target identity across federated models. Today's authoritative identity is the live Viewer `Model` object reference (a runtime/session-local identity, not serializable and not stable across unload, reload, or a new session). A future durable result layer needs its own durable model/version identity and must not persist a `Model` reference or the diagnostic-only `modelId` as if it were one — that identity is Federated Clash Test & Results' to define, not collision core's.
- Do not rely on diagnostic-only `modelId` where true model/load identity is required.
- Avoid changes that force a breaking identity redesign for future persistent/grouped result sets — this binds collision core to keep runtime identity swappable underneath a future durable identity, not to invent that durable identity itself.
- Do not hard-code current single-selected-element Viewer UX assumptions into collision-core contracts.
- Preserve compatibility with many source objects, many target objects, model-vs-model, model-vs-many, many-vs-many, and full-model enumeration — i.e. do not design collision-core contracts in a way that structurally blocks these shapes later. Whether each shape is actually built (in particular many-vs-many, and multi-model sources vs. many `dbId`s within one source model) is a separate question, deferred to the post-M4 Federated Clash Test & Results spec per §6.
- Preserve a viable path for cancellation / abort semantics. Collision core's obligation is limited to exposing cooperative scheduling hooks/checkpoints (§3); cancellation policy and terminal-state semantics (reject vs. partial-result vs. discard) are owned by, and left to, the future result layer.
- Preserve a path for progress reporting, cooperative yielding, batch-stage checkpoints, and later worker/off-main-thread execution if M4 evidence justifies it.
- Keep result semantics rich enough for downstream grouping/filtering.
- Do not implement Group By in collision core merely because future UI will need it. This is about UI-facing result grouping (e.g. by level, category, status) for the future result/panel layers — it does not affect the existing collision-core `groupBy: 'dbId'` query parameter, which stays as-is.
- Keep Viewer panel state, grouping/filtering UI, persistent result-set lifecycle, issue/workflow status, approval state, and presentation concerns outside collision core.

These are compatibility constraints only, not implementation scope.

## 5. Explicit future non-goals for M4

M4 must NOT automatically add:

- Federated Clash Test definitions
- Selection A / Selection B workflows
- persistent clash result sets
- Group By/filtering UI
- Viewer Clash Panel
- result approval/status workflow
- issue-management integration
- model-vs-model orchestration merely as a side effect of worker research

M4 remains benchmark → evidence → architecture decision.

## 6. Post-M4 formal specification

After M4 is complete, the next major specification is:

**Federated Clash Test & Results**

That future spec is where these are formally defined:

- Selection A / Selection B semantics
- full-model enumeration
- model-vs-model
- model-vs-many
- many-vs-many if justified
- test definition lifecycle
- result-set lifecycle
- aggregation
- Group By
- filtering
- progress reporting
- cancellation / abort
- execution state
- diagnostics/incomplete-result semantics at batch scale
- interaction with Hard Clash and Soft Clash query modes
- relationship to Viewer Clash Panel

This roadmap does not design any of those details. It defines only when and where they belong.

## 7. Viewer Clash Panel follows the result layer

The Viewer Clash Panel should be designed only after, or together with, a stable Federated Clash Test & Results contract — not by binding UI state directly to low-level collision-query internals.

The panel may eventually support test selection, result browsing, Group By, filtering, navigation/isolation, visualization, progress/cancel controls, and result status/workflow, but these are downstream concerns.

## 8. Architecture-change discipline

If a proposed M4+ design would change one of the constraints in §4, or reopen one of the settled public contracts named in §1 (query shapes, result shapes, identity model, diagnostics semantics, the `'linear'` correctness oracle, lifecycle behavior), it must explicitly call out:

1. which constraint changes,
2. why the current constraint is insufficient,
3. what public/internal contracts are affected,
4. whether the change is breaking,
5. what migration/compatibility strategy is required.

The roadmap direction is not silently changed inside a later implementation plan.

## Milestone sequence

```text
Completed
  M1    Core collision foundation
  M2    Federated Clash Finder
  M2.1  Clash witness visualization
  M3    Soft Clash / Clearance

Next
  M4    Performance / worker decision gate

After M4
  Federated Clash Test & Results

Downstream
  Viewer Clash Panel
```

- M1–M3 scope remains unchanged.
- M4 purpose remains unchanged.
- This roadmap establishes long-term compatibility constraints only.
- Formal Federated Clash Test & Results design begins after M4.
