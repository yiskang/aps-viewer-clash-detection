# For Claude — Clash Test Result Grouping / Navigation Package

This is an owner-authorized **bounded product-facing package** for the existing single-test **Clash Detection / Clash Test Panel**.

The goal is to make large clash result sets easier to review without introducing multi-test management, history, issue lifecycle, or a new manager panel.

The current panel remains the UI for **one Clash Test**.

Before changing anything, follow `CLAUDE.md`:

- read `docs/handoffs/latest.md`;
- read the latest applicable Independent Work Review Report;
- verify branch / HEAD / origin / clean tree;
- inspect the current governing Clash Panel spec/design and result/grouping implementation;
- independently verify the current accepted checkpoint.

Expected starting checkpoint:

`e8969cb7d22410c25a476ee294a393eafba469a5`

Do not assume it; verify repository state.

## 1. Product decision

Keep the existing Clash Test Panel as the single-test workflow:

- Test Setup
- Run Status
- Filters / Grouping
- Results
- Selected Clash

Do **not** add a separate Clash Tests manager panel in this package.

Do **not** add:

- multi-test management;
- saved test collections;
- run history;
- New / Existing / Resolved lifecycle;
- issue tracking;
- result persistence across runs;
- multi-level/hierarchical grouping.

This package is only about **single-level richer grouping and result navigation inside one Clash Test**.

## 2. Grouping modes

Support these single-level modes:

1. `None`
2. `Element` — preserve existing behavior
3. `Model Pair`
4. `Category`
5. `Level`

Use one active grouping dimension at a time.

Do not implement nested grouping or `Then by`.

If repository evidence shows one dimension cannot be implemented soundly from available metadata, do not guess. Record the gap and stop for owner input only if it blocks a coherent package.

## 3. Model Pair grouping semantics

Group clashes by the pair of participating loaded model instances.

Requirements:

- use model identity, never display-name equality;
- preserve the current loaded-instance identity contract;
- two different loaded instances with the same display name must remain distinct;
- group labels should use user-facing display names;
- duplicate display names must remain disambiguated;
- A × B and B × A should represent the same unordered model pair for grouping unless the existing result contract explicitly makes order semantically meaningful.

Examples:

```text
Architecture ↔ Mechanical (1211)
Architecture ↔ Structure (2277)
Structure ↔ Mechanical (491)
```

For self-clash:

```text
Architecture ↔ Architecture
```

Do not infer self-clash from names.

## 4. Category grouping semantics

Group clashes using BIM/category metadata of the participating elements.

First inspect what category metadata is reliably available in the current Viewer/result pipeline.

Define:

- how category for side A is resolved;
- how category for side B is resolved;
- how self-clash category groups are labeled;
- how missing category metadata is represented;
- whether category pairs are unordered or preserve role/order.

Preferred examples:

```text
Walls ↔ Ducts
Floors ↔ Pipes
Roofs ↔ Mechanical Equipment
```

For same-category self-clash:

```text
Walls
```

or `Walls ↔ Walls` if that is more consistent with the product contract.

Do not invent category names from dbIds or geometry.

If category retrieval requires asynchronous property loading, design the smallest safe/cacheable path and preserve responsiveness.

## 5. Level grouping semantics

Group clashes by reliable level/elevation-related BIM metadata.

Before implementation, verify what current Viewer/model metadata can provide.

Define and document:

- how level is resolved;
- how a clash spanning two levels is grouped;
- what happens when the two elements report different levels;
- what happens when one/both levels are missing;
- deterministic group identity and ordering.

Do not derive a level purely from world Z unless the governing design explicitly authorizes that fallback.

Preferred behavior is metadata-driven.

Examples:

```text
Level 1
Level 2
Level 3
Roof
Unknown level
```

If level-pair grouping is more semantically correct than a single level, establish that from repository/product evidence before implementation rather than guessing.

## 6. Group identity and determinism

Every group must have a stable identity independent of display text.

Requirements:

- stable group key;
- deterministic membership;
- deterministic group ordering unless user sort overrides it;
- changing display labels must not change result identity;
- filtering must not corrupt group membership;
- duplicate labels must not collapse distinct groups.

Do not key groups by rendered strings alone.

## 7. Group row UX

Reuse the existing Viewer-native styling.

Each group row should show:

- group label;
- clash count;
- clear expand/collapse affordance if groups are collapsible;
- existing group-level actions only where already supported and semantically valid.

Audit current grouped-row actions such as:

- Focus
- Isolate
- Markers
- Prev / Next navigation

Preserve or adapt them coherently.

Do not add unrelated actions.

## 8. Result navigation semantics

Audit navigation when grouping is active.

Requirements:

- Prev / Next behavior is clear;
- `(within its group)` or equivalent appears only when navigation is actually constrained to the active group;
- switching groups updates navigation correctly;
- filtering away the origin group must not leave stale group-navigation wording;
- empty groups must not render;
- group counts must reflect currently visible/filtered results if that is the existing grouping contract; otherwise clearly distinguish total vs filtered counts.

Close the previously observed Low where a filtered-away origin group could leave stale `(within its group)` wording if it still exists.

## 9. Filters + grouping interaction

Verify interaction with:

- text filter;
- model filter;
- Unverified only;
- Has location;
- Sort;
- Clear filters.

Requirements:

- grouping recomputes deterministically after filtering;
- no empty grouping note over an empty filtered list;
- no stale selected group;
- clear filters returns to the correct grouped result state;
- filtering must not change underlying clash identity.

Close the previously observed Low where grouping note could remain over an empty filtered list if still present.

## 10. Sorting

Review how existing sorting applies to grouped results.

Define:

- whether sort applies to groups, items within groups, or both;
- stable/default ordering for new group modes;
- deterministic fallback for missing category/level metadata.

Do not add a new advanced sorting subsystem.

## 11. Large-result usability

Use the real accepted Architecture self-clash result size as a representative workload:

- approximately 4,770 clashes.

Verify:

- group computation cost;
- render cost;
- expand/collapse behavior;
- filter responsiveness;
- navigation responsiveness.

Do not introduce a full virtualization rewrite unless actual evidence shows it is required and owner authorization is obtained.

## 12. Product-facing headed validation

Use normal Viewer paths, not demo-only validation.

At minimum validate grouping on:

### Cross-model results
- Architecture × Mechanical
- Architecture × Structure
- Structure × Mechanical

### Self-clash
- Architecture × Architecture

Do not repeat the expensive full self-clash run if the accepted completed result can be reused safely from current product state/evidence. If a fresh run is needed, explain why before incurring multi-minute runtime.

Validate each grouping mode:

- None
- Element
- Model Pair
- Category
- Level

Capture:

- ungrouped baseline;
- Model Pair;
- Category;
- Level;
- Element;
- filtered grouped state;
- empty filtered state;
- group navigation;
- duplicate-name model case if available;
- narrow panel width.

Claude must inspect screenshots itself and classify:

- PASS
- FAIL
- INCONCLUSIVE

Fix all in-scope visual FAILs before stopping.

## 13. Tests

Add focused tests for:

### Model Pair
- stable identity;
- same loaded instance self-clash;
- same display name, different loaded instances;
- A/B reverse-order grouping behavior;
- missing display metadata fallback.

### Category
- category pair identity;
- same-category self-clash;
- missing category;
- duplicate category labels;
- filtering interaction.

### Level
- stable level identity;
- missing level;
- conflicting levels;
- deterministic ordering;
- filtering interaction.

### Navigation
- within-group Prev/Next;
- filtered-away origin group;
- stale group labels/suffixes;
- empty groups;
- selected clash behavior after group/filter changes.

### Regression
- existing None and Element grouping;
- result list;
- filters;
- pager;
- Focus;
- Isolate;
- Markers;
- Back to all;
- Clear;
- normal Panel lifecycle.

Run relevant focused tests, DOM tests, and full offline regression.

Run `git diff --check`.

## 14. Governing design/spec

Update the existing Clash Panel product/design spec as needed.

Document:

- new supported single-level grouping modes;
- stable group identity;
- Model Pair identity semantics;
- Category metadata resolution;
- Level metadata resolution;
- missing metadata behavior;
- filtering/navigation interaction;
- explicit non-goal: multi-level grouping.

Do not redesign unrelated Clash Panel architecture.

## 15. Internal review

Perform one bounded internal review after implementation and headed validation.

Use:

- Critical
- High
- Medium
- Low

Review specifically for:

- grouping correctness;
- identity vs display-name mistakes;
- BIM metadata assumptions;
- deterministic behavior;
- self-clash semantics;
- filtering/navigation regressions;
- large-result usability;
- Viewer-native visual consistency;
- scope discipline.

Fix all in-scope Critical/High/Medium findings autonomously.

Re-run affected tests/evidence after substantial fixes.

## 16. Durable package output

Before final chat, persist a complete package final report under:

`docs/research/2026-10-08-clash-test-result-grouping-navigation-final-report.md`

Include:

- repo / branch / HEAD / origin / tree state;
- governing artifacts;
- authorized scope;
- files changed;
- grouping modes implemented;
- Model Pair semantics;
- Category semantics;
- Level semantics;
- filtering/sorting/navigation behavior;
- large-result behavior;
- headed validation;
- visual PASS/FAIL/INCONCLUSIVE totals;
- focused/full test results;
- internal review findings/fixes;
- remaining debt;
- protected boundaries;
- exact next gate.

Update:

`docs/handoffs/latest.md`

Keep it concise and link to the final report, evidence, and relevant review artifacts.

Stop at:

**Ready for independent Work visual/product review**

## 17. Boundaries

Do not:

- add a Clash Tests manager panel;
- add multi-test persistence/history;
- add result lifecycle/status workflow;
- add hierarchical/multi-level grouping;
- restart G2/C6/C8 research;
- start G3;
- reopen protected R20-1 performance work;
- implement reflected-fragment work;
- remediate historical Low wording unrelated to this package;
- commit or push unless separately authorized.

If a requested grouping dimension requires a new product contract not supported by current metadata, stop for owner decision rather than inventing one.
