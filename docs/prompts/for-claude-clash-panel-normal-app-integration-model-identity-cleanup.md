# For Claude — Clash Panel Normal App Integration + Model Identity Cleanup

This is an owner-authorized **bounded product-integration package** addressing the currently identified Clash Panel integration defects.

Do not expand into unrelated features.

Before making changes, follow `CLAUDE.md`:

- read `docs/handoffs/latest.md`;
- read the latest applicable Independent Work Review Report;
- verify branch / HEAD / origin / tree state;
- verify whether the previously accepted Test Setup / Interaction UX package has already been checkpointed.

## Important checkpoint boundary

The previous package was independently accepted for checkpoint.

If that accepted package has **not** yet been committed/pushed and there is no explicit owner authorization to do so in repository state/current task, **do not silently mix this new package into the old checkpoint**.

Stop and report the exact gate required.

If the accepted checkpoint is already present, proceed with this package.

---

# Scope

Fix these three product/integration problems together because they are all part of making the Clash Test Panel behave like a normal Viewer feature rather than an isolated deterministic demo.

## 1. Clash Test Panel must not exist only behind `?clashPanelDemo=1`

Current problem:

- the Clash Test Panel is only loaded/visible in demo mode;
- `?clashPanelDemo=1` currently acts as both fixture bootstrap and feature enablement.

Required behavior:

- the Clash Test Panel must be available in the normal Viewer app flow;
- the panel must work with the Viewer models that are already loaded;
- `?clashPanelDemo=1` may remain as a deterministic demo/bootstrap convenience, but it must only prepare demo fixtures or demo-specific setup;
- the demo flag must not be required for the panel feature itself to exist.

Preserve existing default app behavior such as Room Locator / Clash Finder.

Do not introduce unrelated toolbar redesign or new product scope.

---

## 2. Demo URNs / model names must not be hardcoded as product identity

Current problem:

- demo fixture URNs are hardcoded;
- demo display names such as `Structure` / `Mechanical` are declared manually for those URNs;
- normal app models fall back to bubble node name or `Model N`.

Owner decision:

> Even in demo mode, product-facing model identity/display behavior should not depend on a hardcoded URN → friendly-name mapping.

Required direction:

- model display naming should be metadata-driven;
- prefer the model/bubble metadata supplied by the Viewer;
- do not infer identity from display name;
- do not require a separate hardcoded `declareModelDisplayName("Structure")` / `("Mechanical")` mapping merely to make the demo look correct;
- if a deterministic fixture fallback label is truly necessary, keep it explicitly scoped to fixture configuration and only use it when real model metadata is unavailable;
- demo and normal app should share the same naming-resolution path.

Preserve duplicate-name disambiguation.

### Identity invariant

**Model identity must never be inferred from display name.**

Two different loaded models may legitimately have the same display name.

---

## 3. Set A / Set B overlap must use loaded-model identity and imply self-clash for the same loaded instance

Current product problem:

- a user may select the same model in Set A and Set B;
- this should naturally represent a self-clash for that exact loaded model instance;
- semantics must not depend on matching display names.

Required identity semantics:

- compare loaded model identity, not label text;
- if the same loaded model instance appears in both sets, that pair is a self-clash pair;
- if two different loaded model instances happen to share the same display name, they are **not** the same model;
- same source URN loaded twice must not automatically collapse to one identity if the Viewer treats them as separate loaded instances/placements.

Review the current model key contract (currently described as `<urn>#<loadSeq>` or equivalent) and determine whether it is the correct loaded-instance identity.

Do not change identity semantics merely for cosmetic convenience.

---

# Self-clash control review

Inspect what the existing `Self-clash` checkbox actually means today.

Do not remove it blindly.

Determine whether it currently means:

- allow Set A / Set B overlap;
- generate within-set self pairs;
- enable same-model pair generation;
- or another behavior.

Then make the UX consistent with the owner decision:

> Selecting the same loaded model instance in Set A and Set B must naturally produce self-clash semantics.

If the existing checkbox becomes redundant or misleading under the corrected semantics:

- redesign/remove/relabel it only as needed;
- update the governing product spec accordingly;
- preserve any genuinely distinct functionality it currently represents.

Do not invent new pair-generation modes outside this scope.

---

# Product behavior examples

The following semantics should hold conceptually:

### Different loaded models

```text
Set A: Structure-instance-1
Set B: Mechanical-instance-1
→ federated clash
```

### Same loaded instance

```text
Set A: Structure-instance-1
Set B: Structure-instance-1
→ self-clash
```

### Same display name, different loaded instances

```text
Set A: Mechanical-instance-1
Set B: Mechanical-instance-2

displayNameA == displayNameB
modelIdentityA != modelIdentityB

→ not the same loaded model
→ do not infer self-clash from the label
```

### Mixed sets

```text
Set A: [Structure-1, Architecture-1]
Set B: [Structure-1, Mechanical-1]

Structure-1 × Structure-1
→ self-clash

Structure-1 × Mechanical-1
Architecture-1 × Structure-1
Architecture-1 × Mechanical-1
→ normal cross-model pairs
```

---

# Governing spec/design

Inspect the current governing Clash Panel spec/design.

Update it if necessary to record:

- normal-app availability
- demo/bootstrap separation
- metadata-driven model naming
- model identity vs display identity
- same-loaded-instance self-clash semantics
- the role of any remaining Self-clash control

Do not alter unrelated G2/C6/C8 acceptance semantics.

---

# Implementation requirements

## Normal app integration

Verify the panel can be loaded/opened without:

`?clashPanelDemo=1`

The normal app path must use currently loaded Viewer models.

The demo flag may still:

- load deterministic fixtures;
- prepare repeatable demo state;
- support headed regression.

It must not be the only feature gate.

## Naming

Centralize/clarify naming resolution so that:

1. Viewer model/bubble metadata is preferred;
2. optional host/fixture fallback is clearly secondary;
3. `Model N` remains a final fallback if needed;
4. duplicate labels are disambiguated without changing model identity;
5. URN-specific friendly-name hardcoding is not the normal naming mechanism.

## Identity

Use a stable loaded-instance key.

Document whether the existing `<urn>#<loadSeq>` key remains appropriate.

Do not compare display names to determine model sameness.

## Pair generation

Same loaded-instance overlap across Set A/B must result in self-clash semantics.

Add/update tests for:

- same model in A and B;
- two different models with same display name;
- same source loaded twice with separate loaded identities if testable;
- mixed self/federated pairs.

---

# Headed validation

Perform headed Viewer validation.

At minimum validate:

## Normal app

- open default app without `?clashPanelDemo=1`;
- Clash Test Panel is available;
- panel model lists reflect currently loaded Viewer models;
- panel does not rely on demo bootstrap names.

## Demo app

- `?clashPanelDemo=1` still works as deterministic fixture bootstrap;
- demo fixtures use the same panel/model-catalog path as normal app;
- no special URN → UI-name dependency is required for core behavior.

## Model naming

- real bubble/model metadata appears when available;
- duplicate names remain distinguishable;
- two same-name different models are independently selectable.

## Self-clash semantics

- select the exact same loaded model instance in A and B;
- verify self-clash behavior is inferred correctly;
- verify no display-name comparison is involved;
- verify different same-name instances do not collapse into one identity.

## Regression

Re-check:

- Hard clash
- Soft/Clearance setup
- New test
- Set A/B controls
- Run/Stop
- result list
- Focus
- Isolate
- Markers
- panel close/reopen
- Room Locator
- Clash Finder

---

# Visual evidence

Capture deterministic screenshots for:

1. normal app with Clash Test Panel available;
2. normal app Set A/B model catalog;
3. demo mode model catalog;
4. two same-name different models if fixture/test harness can represent this;
5. same loaded instance selected in A and B;
6. resulting self-clash state;
7. mixed self/federated selection if applicable;
8. narrow-width panel state.

Claude must inspect all screenshots itself.

Classify:

- PASS
- FAIL
- INCONCLUSIVE

Fix in-scope visual FAILs before stopping.

Do not ask the owner to inspect screenshots unless there is a genuine unresolved product/design issue.

---

# Tests

Add focused tests for:

- normal app panel availability;
- demo flag not being the feature gate;
- metadata-driven naming priority;
- duplicate-name disambiguation;
- identity independent from display name;
- same loaded instance A/B overlap → self-clash;
- same-name different instance → not automatically self-clash;
- existing Self-clash control semantics;
- regression of panel model catalog.

Run relevant DOM/focused/full regression suites.

Run `git diff --check`.

---

# Internal review

Perform one bounded internal review after implementation.

Use:

- Critical
- High
- Medium
- Low

Review specifically for:

- demo/normal app coupling
- hidden hardcoded fixture dependencies
- identity correctness
- display-name misuse
- pair-generation semantics
- Self-clash control semantics
- normal app regressions
- headed visual behavior
- scope discipline

Fix in-scope Critical/High/Medium findings autonomously.

Re-run affected tests/validation after substantial fixes.

---

# Durable package output

Before final chat, persist a complete package final report under:

`docs/research/2026-10-07-viewer-clash-panel-normal-app-model-identity-final-report.md`

Include:

- repository / branch / HEAD / origin / tree state
- governing artifacts
- scope
- files changed
- normal-app integration behavior
- demo/bootstrap behavior
- naming resolution behavior
- identity contract
- self-clash semantics
- Self-clash control disposition
- headed validation
- evidence path
- tests
- internal review findings/fixes
- remaining debt
- protected boundaries
- exact next gate

Update:

`docs/handoffs/latest.md`

Keep it concise and link to the package final report and evidence.

Stop at:

**Ready for independent Work visual/product review**

---

# Boundaries

Do not:

- restart G2/C6/C8 research;
- alter G2 acceptance procedure;
- issue/reset authorization records;
- start G3;
- add unrelated grouping/persistence/framing features;
- change collision math unless a genuine blocker is discovered and owner authorization is required;
- commit or push unless separately authorized.

If a requested behavior requires a product decision beyond the owner decisions above, stop and ask rather than expanding scope.
