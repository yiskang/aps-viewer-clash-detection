# Collision Library Roadmap — Authoring Prompt

Create a long-term roadmap document for the collision/clash-detection library.

This is a roadmap / architecture-guidance task only.

Do NOT implement code.
Do NOT create a new milestone implementation plan.
Do NOT reopen or rewrite completed M1, M2, M2.1, or M3 scope.
Do NOT change the already-established M4 purpose.
Do NOT start the formal Federated Clash Test & Results specification yet.

Save the roadmap to:

`docs/superpowers/specs/collision-library-roadmap.md`

Use the actual landed `main` branch and the completed M1–M3 specs/plans/README/CHANGELOG only as context for what already exists. The roadmap should be concise, durable, and written to guide future milestone design sessions.

## Required roadmap structure

### 1. Current completed capability

Summarize the current progression without re-specifying implementation details:

- M1 — core Viewer-side collision library / exact geometric clash foundation
- M2 — Federated Clash Finder / scalable federated target search
- M2.1 — clash witness marker / Viewer visualization
- M3 — Soft Clash / Clearance

State clearly that these are completed milestones and their public contracts should not be casually reopened.

### 2. M4 remains unchanged

Preserve the existing M4 direction:

**benchmark-driven evaluation of whether worker/off-main-thread execution is actually necessary.**

M4 must remain evidence-driven. It should measure realistic federated workloads, identify where main-thread cost actually comes from, and decide whether worker/off-main-thread execution is justified.

Do not redefine M4 as Federated Clash Test & Results.
Do not insert Viewer Clash Panel implementation into M4.

### 3. Future downstream path

Record explicitly:

```text
Collision Core
  → Federated Clash Test & Results
  → Viewer Clash Panel
```

Responsibility boundary:

- **Collision Core**: geometry/query execution, correctness, provenance, diagnostics, budgets, scheduling hooks.
- **Federated Clash Test & Results**: batch/many-object orchestration, test definitions, result-set semantics/lifecycle, aggregation/grouping/filtering-ready data, progress/cancellation.
- **Viewer Clash Panel**: user-facing test/result management, grouping/filtering presentation, navigation, inspection, interaction state.

Do not collapse these responsibilities into one layer.

### 4. Cross-milestone compatibility constraints

These constraints are binding on future M4+ design work unless explicitly superseded by a later reviewed architecture decision.

- Preserve stable, unambiguous source / target identity across federated models.
- Do not rely on diagnostic-only `modelId` where true model/load identity is required.
- Avoid changes that force a breaking identity redesign for future persistent/grouped result sets.
- Do not hard-code current single-selected-element Viewer UX assumptions into collision-core contracts.
- Preserve compatibility with many source objects, many target objects, model-vs-model, model-vs-many, many-vs-many, and full-model enumeration.
- Preserve a viable path for cancellation / abort semantics.
- Preserve a path for progress reporting, cooperative yielding, batch-stage checkpoints, and later worker/off-main-thread execution if M4 evidence justifies it.
- Keep result semantics rich enough for downstream grouping/filtering.
- Do not implement Group By in collision core merely because future UI will need it.
- Keep Viewer panel state, grouping/filtering UI, persistent result-set lifecycle, issue/workflow status, approval state, and presentation concerns outside collision core.

These are compatibility constraints only, not implementation scope.

### 5. Explicit future non-goals for M4

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

### 6. Post-M4 formal specification

After M4 is complete, the next major specification should be:

**Federated Clash Test & Results**

That future spec is where these should be formally defined:

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

Do not design all of those details in this roadmap. Define when and where they belong.

### 7. Viewer Clash Panel follows the result layer

State explicitly that the Viewer Clash Panel should be designed only after, or together with, a stable Federated Clash Test & Results contract — not by binding UI state directly to low-level collision-query internals.

The panel may eventually support test selection, result browsing, Group By, filtering, navigation/isolation, visualization, progress/cancel controls, and result status/workflow, but these are downstream concerns.

### 8. Architecture-change discipline

Future milestone work must follow this rule:

If a proposed M4+ design would change one of these roadmap constraints, explicitly call out:

1. which constraint changes,
2. why the current constraint is insufficient,
3. what public/internal contracts are affected,
4. whether the change is breaking,
5. what migration/compatibility strategy is required.

Do not silently change the roadmap direction inside a later implementation plan.

## Required final section

End with a compact milestone sequence:

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

Also state that:

- M1–M3 scope remains unchanged,
- M4 purpose remains unchanged,
- this roadmap establishes long-term compatibility constraints only,
- formal Federated Clash Test & Results design begins after M4.

Do not implement anything.
Do not create implementation tasks.
Do not alter the current M3 branch.
