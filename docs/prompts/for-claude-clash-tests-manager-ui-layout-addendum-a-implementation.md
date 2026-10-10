# For Claude — Clash Tests Manager UI Layout / Responsive Polish — Addendum A Implementation

## Authorization

The owner explicitly authorizes implementation of the reviewed **Clash Tests Manager — Manager UI Layout / Responsive Polish — Plan Addendum A** package.

This authorization includes the Independent Work Review's single non-blocking documentation correction: rename the new Manager UI presentation amendment from the duplicate `§26.13` to **`§26.14`** and update only its directly affected cross-references.

This authorization does **not** authorize commit or push.

---

## Repository

Work in:

`/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`

Repository state is authoritative.

Before changing anything, independently verify:

- repository identity;
- branch;
- `HEAD`;
- `origin/main` relation;
- working-tree state;
- current governing spec/plan;
- latest handoff and Independent Work Review;
- current production/test diff.

Expected starting checkpoint from the reviewed package is `main` at `fdb8643aa1987e5a1c96355d97a3deb6a0e9a9de`, equal to `origin/main`, with the UI-layout design/spec/plan/final-report/handoff package present as docs-only working-tree changes. **Verify this; do not assume it.**

Read at minimum:

- `CLAUDE.md`
- `docs/handoffs/latest.md`
- governing Viewer Clash Panel design/spec, including the Manager presentation amendment
- `docs/superpowers/plans/2026-10-10-clash-tests-manager-implementation-plan.md`, including Addendum A
- `docs/research/2026-10-11-clash-tests-manager-ui-layout-final-report.md`
- `docs/reviews/2026-10-11-clash-tests-manager-ui-layout-independent-work-review.md`
- prior owner decision record for the single-panel Manager/List ↔ Editor architecture

Treat handoff content as navigation, not proof.

---

## Governing owner decisions

The following product decisions are already resolved and are **authorized product direction**. Do not reopen them:

1. Replace the current seven-column Clash Tests Manager table with a **semantic list/item layout**, one test per item.
2. Keep the preferred Panel width at **460 px** for now.
3. Use **compact icon actions** for Open/Edit, Duplicate, Reset results, and Delete test.
4. Replace the textual `(active)` suffix with a visible **Active badge** while preserving the semantic active-state indication.
5. Deduplicate repeated visible disabled reasons within a test item while preserving every affected disabled control's accessibility linkage to the shared reason.

The single-panel product architecture is also already owner-approved:

- one APS Viewer DockingPanel;
- Manager/List and Test Editor are views within that Panel;
- one headless manager layer;
- one editor controller;
- one active test;
- active-test-only held result residency / Viewer ownership.

Do not reopen separate Manager + Editor DockingPanels.

---

## Independent Work Review authority

The latest Independent Work Review verdict is:

- **acceptable and ready for owner authorization of Addendum A implementation**;
- **0 Critical / 0 High / 0 Medium / 1 Low**;
- no blockers.

The single Low is documentation traceability only: the newly added Manager UI presentation amendment reused the existing `§26.13` section number.

### Authorized documentation correction

Include the following correction in this same bounded implementation package:

- rename the new Manager UI presentation amendment from duplicate `§26.13` to **`§26.14`**;
- update only directly affected cross-references in:
  - the governing spec;
  - Addendum A;
  - the UI-layout package final report;
  - the handoff;
- preserve historical artifacts that correctly refer to the original `§26.13 Gates and open items`;
- do not rewrite historical review/report references that were accurate at the time unless they are direct current-package cross-references explicitly identified by the Work review;
- do not change any product decision, acceptance criterion, architecture, behavior, or implementation scope as part of this renumbering.

This docs correction is part of the current owner authorization.

---

# Implementation scope

Implement **Plan Addendum A exactly as reviewed**, plus the bounded `§26.14` renumbering above.

The implementation is presentation-only.

## 1. Replace the Manager table with semantic list/items

Replace the current dense seven-column Manager table with one semantic list item per Clash Test.

The intended information hierarchy is:

### Item header

- test name;
- visible Active badge when active;
- compact action controls.

### Secondary status line

- test mode (`Hard` / `Soft`);
- run status;
- result count where applicable.

### Set information

- `Set A` value;
- `Set B` value.

### Readiness / disabled-state information

- readiness/status text according to the existing ViewModel contract;
- visible disabled reason text only when relevant;
- identical disabled reasons within the same item should appear once, while all affected disabled controls remain linked to that shared reason.

Preserve the reviewed reading order and semantic `ul` / `li` structure from the spec/Addendum.

Do not change creation order or manager sorting semantics.

---

## 2. Preserve Manager semantics and action contracts

The presentation rewrite must preserve all existing behavior and dispatch semantics.

For each test item, preserve the existing action order and meaning:

1. Open/Edit
2. Duplicate
3. Reset results
4. Delete test

Preserve:

- existing `data-key` action identities;
- existing test identity attributes such as `data-test-id`;
- native button semantics;
- keyboard operation;
- current dispatch intents;
- existing confirmation behavior;
- existing disabled-state logic;
- current run-active/fault/recovery restrictions;
- current manager announcement behavior;
- Delete vs Reset distinction;
- current switch/open behavior.

Do not change manager state or action meaning to make the new layout easier to implement.

---

## 3. Compact icon actions

Convert the Manager item's action buttons from wide text buttons to the reviewed compact icon controls.

Requirements:

- use the reviewed CSS-mask/data-URI glyph approach in Manager-local CSS if that remains exactly what Addendum A specifies;
- do not introduce a new icon library;
- do not use emoji glyphs;
- keep the existing action ordering;
- minimum hit area: **28 × 28 px** as specified by the reviewed design;
- each button must retain a clear accessible name (`aria-label` or the exact reviewed equivalent);
- provide the reviewed text-label/fallback behavior;
- preserve keyboard focusability for enabled native buttons;
- preserve native `disabled` for disabled actions;
- preserve existing confirmation semantics for Reset/Delete;
- retain visible disabled reasons and accessible reason linkage;
- distinguish destructive Delete appropriately using the reviewed presentation contract without introducing new product semantics.

Do not change public APIs or dispatch contracts for icon actions.

---

## 4. Active state

Replace the current `(active)` textual suffix with the reviewed visible **Active** badge.

Requirements:

- preserve `aria-current` or the exact existing semantic active-state mechanism required by the reviewed contract;
- the visual treatment must not rely on color alone;
- no new active-test semantics;
- exactly one active test remains governed by the existing manager state.

---

## 5. Disabled reasons

Implement the reviewed deduplication contract for disabled reasons.

When multiple disabled controls in one test item have the same reason:

- render that visible reason once for the item;
- preserve the exact reason string produced by the existing gate/ViewModel logic;
- give the shared reason a stable DOM id appropriate for the existing rebuild model;
- every affected disabled control must still reference the shared reason through the reviewed accessibility linkage (`aria-describedby` or exact accepted equivalent);
- do not weaken native `disabled`;
- do not make disabled actions operable through pointer or keyboard paths;
- do not silently alter reason priority or fault/recovery/run-active semantics.

Distinct reasons remain distinct visible reason rows.

Do not remediate deferred accessibility/focus debts outside this exact shared-reason presentation contract.

---

## 6. Width and responsive behavior

Keep the existing DockingPanel geometry contract unchanged.

The reviewed product decision is:

- preferred width remains **460 px**;
- the existing `min(460px, 90vw)` / 340 px shell behavior stays intact as governed by the current implementation/spec;
- Manager and Editor continue to share the same Panel width;
- switching between Manager and Editor must **not write or force width**;
- do not add a user-resize feature;
- do not change the DockingPanel shell solely to solve Manager layout.

The new Manager layout must structurally handle narrow widths rather than depending on widening the Panel.

Implement the reviewed responsive behavior down to the supported Manager content floor / Viewer-container envelope defined by Addendum A.

Long values must not degrade into pathological one-character-per-line wrapping.

Follow the reviewed rules for:

- test-name wrapping/clamping;
- Set A / Set B wrapping/clamping;
- full-value discoverability (for example via `title` where specified);
- status/readiness non-truncation;
- action placement;
- item spacing and hierarchy;
- narrow-width fallback.

Do not invent a resize interaction.

---

# Protected architecture and behavior

The following are explicitly protected and must remain unchanged:

- single-panel Manager/List ↔ Editor architecture;
- headless `testsManager` architecture;
- one editor controller;
- active-test-only result residency;
- Viewer ownership and Viewer mutation boundary;
- manager record/state model;
- recovery and terminal-fault contracts;
- readiness and stale-model behavior;
- model departure / same-key re-entry semantics;
- Create/Open/Duplicate/Reset/Delete semantics;
- switching semantics;
- Set A/B identity and label scope;
- confirmations;
- manager live announcements except for the reviewed presentation-only structure needed by Addendum A;
- public API;
- controller intents / dispatch contracts;
- Core/Adapter/collision behavior.

Do not alter these to make layout work easier.

---

# Deferred findings L1–L8

The previous Clash Tests Manager implementation review's L1–L8 remain deferred and unauthorized.

The Independent Work Review specifically confirmed that the layout package can proceed without remediating them.

In particular, where the new list rendering touches the same rebuild/focus/action-key surface as deferred L1/L5/L7:

- retain the existing rebuild model;
- retain the existing action-key identity model;
- do not claim those debts are fixed;
- do not add opportunistic focus restoration, stable-key redesign, lifecycle hardening, copy cleanup, or other Low remediation.

If implementation unexpectedly requires changing one of those deferred contracts, **stop and surface the exact conflict for owner decision** instead of silently expanding scope.

---

# Explicitly unauthorized

Do **not** perform any of the following under this authorization:

- CTM-7;
- CTM-8;
- remediation of L1–L8;
- separate Manager and Editor DockingPanels;
- a resize feature or new resize affordance;
- persistence across reloads;
- history/versioning;
- background clash runs;
- issue lifecycle / New / Existing / Resolved product scope;
- cloud/server persistence;
- multi-level grouping;
- unrelated product polish;
- public API changes;
- controller/manager semantic redesign;
- Core changes;
- Viewer Adapter changes;
- collision-engine changes;
- G2/C6/C8/G3 work;
- reflected-fragment / R20-1 work;
- another milestone or package;
- commit;
- push.

Do not start any unauthorized item merely because it appears easy or adjacent.

---

# Expected production change boundary

Use Addendum A and the Independent Work Review as the source of truth for the exact future production/test file boundary.

The review specifically expected the presentation change to stay concentrated in the Manager renderer and protect the DockingPanel shell and other layers.

Before editing, identify and record the exact paths Addendum A permits.

At minimum, verify whether the reviewed plan still limits the production edit to the Manager renderer (for example `clashpanel/ui/render/manager.js`) and keeps the DockingPanel shell, shared CSS, controller/core, ViewerBridge, other renderers, Adapter, collision, ports, package and host paths protected.

If current repo evidence differs from the reviewed Addendum, stop and report the discrepancy before broadening the change set.

Do not silently expand the production diff.

---

# Tests and implementation method

Follow the repository's normal implementation process and `CLAUDE.md` instructions.

Use the acceptance criteria in Addendum A / AC-UI1–AC-UI12 as the mechanical implementation contract.

Tests must meaningfully cover the reviewed UI behavior, including at least the Addendum-specified cases for:

- semantic list/item structure;
- item reading/order structure;
- preserved test/action identity attributes;
- visible Active badge + semantic active state;
- icon action accessible names;
- icon action order;
- disabled native-button behavior;
- shared/deduplicated disabled reason rendering;
- every affected disabled button retaining reason linkage;
- Reset/Delete confirmation preservation;
- long test names;
- long Set A / Set B labels;
- narrow-width behavior;
- no pathological one-character wrapping;
- status/readiness visibility/non-truncation as specified;
- text fallback / icon fallback requirements;
- no width write on Manager ↔ Editor switching;
- unchanged shell geometry strings/contracts;
- protected-path zero-diff guard;
- prohibited DOM/icon techniques called out by Addendum A.

Do not weaken or delete existing behavioral assertions simply to make the new DOM structure pass.

Where structural tests legitimately must change because the approved product presentation changed, update only the directly affected assertions and preserve the underlying behavior/dispatch/confirmation/a11y contracts.

Use failing-first / TDD where required by repo instructions and the reviewed plan.

---

# Verification

Run the verification required by Addendum A and the repository workflow.

At minimum, run the applicable:

- focused Manager/UI tests;
- Clash Panel DOM suite;
- canonical/offline suite required by the plan;
- `git diff --check`;
- protected-path / zero-diff checks required by Addendum A.

Record exact counts and exit status.

Do not claim CTM-7 or CTM-8 results.

Do not substitute historical test counts for tests that Addendum A requires to be freshly executed.

If a test cannot run because of an environment/tool restriction, record exactly what was and was not executed; do not reinterpret an inconclusive run as pass.

---

# Headed / visual validation boundary

Do not run CTM-7.

If Addendum A explicitly includes a bounded implementation-time headed layout check distinct from CTM-7, follow the reviewed plan exactly and do not broaden it into product closeout.

Otherwise stop after automated implementation verification and leave the headed layout/product validation for its separately governed next gate.

Do not ask the owner to manually review screenshots merely because visual evidence exists. Agents should review/triage headed evidence themselves first; escalate only for a genuine visible/product defect, conflicting evidence, or owner-only product/design decision.

---

# Internal review

After implementation and verification, perform the repository's normal bounded internal review of this implementation package.

The internal review should specifically check for:

- accidental semantic behavior changes hidden inside the renderer rewrite;
- action dispatch changes;
- confirmation regressions;
- accessibility regression from icon-only controls;
- missing accessible names;
- disabled controls losing their reason linkage;
- reason dedup incorrectly merging distinct reasons;
- active badge becoming color-only or losing semantic state;
- long-name/Set A/Set B responsive failures;
- status/readiness clipping or pathological wrapping;
- width code accidentally overriding user/browser/Viewer geometry;
- changes to Manager ↔ Editor width behavior;
- Viewer-native styling inconsistencies;
- icon ambiguity or fallback failure;
- reliance on fixed English text where structural contracts should be used;
- accidental L1–L8 remediation;
- production diff outside the reviewed boundary;
- spec/plan drift;
- hidden reopening of the single-panel architecture;
- `§26.14` cross-reference mistakes.

Resolve in-scope implementation findings before closeout.

Internal review does not authorize scope expansion.

If a finding requires changing protected architecture, deferred Lows, public APIs, or other unauthorized scope, stop and surface it instead of fixing it silently.

---

# Upstream implementation final report

This is a substantial implementation package, so create one durable upstream package completion report under:

`docs/research/*-final-report.md`

Use a clear name for this implementation closeout, e.g.:

`docs/research/2026-10-11-clash-tests-manager-ui-layout-implementation-final-report.md`

The final report should include, as applicable:

- repository / branch / HEAD / origin relation;
- working-tree state;
- governing owner authorization;
- governing spec and Addendum A;
- Independent Work Review input;
- the five owner-approved UI decisions;
- the `§26.13` → `§26.14` bounded docs correction;
- exact production files changed;
- exact test files changed/added;
- implementation outcome;
- list/item structure delivered;
- icon implementation details;
- active-badge behavior;
- disabled-reason dedup/accessibility behavior;
- responsive/width behavior;
- confirmation that Manager ↔ Editor switching does not write width;
- confirmation that protected architecture/semantics stayed unchanged;
- L1–L8 interaction and confirmation they were not remediated;
- verification commands and exact results;
- headed/visual verification status and boundaries;
- internal review findings/dispositions;
- any residuals/gaps;
- exact next gate;
- work that remains unauthorized.

Do not overwrite or rewrite the prior design/package final report as though it were an implementation report. Preserve its historical role.

---

# Handoff update

After implementation/review changes project state, update:

`docs/handoffs/latest.md`

Keep the new top entry concise and link repo-relative artifacts.

Include:

- repo / branch / HEAD / origin / tree state;
- Addendum A implementation status;
- governing spec `§26.14` and plan Addendum A;
- upstream implementation final report;
- internal review artifact if persisted by repo workflow;
- exact automated verification results;
- headed/visual validation status;
- readiness/verdict;
- blockers, if any;
- deferred L1–L8;
- CTM-7 / CTM-8 status (still not run / not authorized here);
- exact next gate;
- work that must not begin without authorization.

Do not let substantive implementation status exist only in chat.

---

# Stop condition / next gate

Stop when all of the following are true:

1. Addendum A implementation is complete within the reviewed production boundary.
2. Required directly affected tests are updated/added.
3. Required automated verification is complete and recorded.
4. The `§26.14` docs correction is complete and mechanically consistent.
5. Bounded internal review is complete and in-scope findings are dispositioned.
6. One upstream implementation final report exists under `docs/research/`.
7. `docs/handoffs/latest.md` is updated.
8. No commit or push has been performed.

The next gate is then:

**Independent Work implementation review of the Clash Tests Manager UI Layout / Responsive Polish package.**

Do not self-authorize that review's outcome.

Do not commit or push.

Do not proceed to CTM-7, CTM-8, L1–L8 remediation, another milestone, or any other product scope without explicit owner authorization.

---

# Final response contract

In Claude's final response, report only the implementation-package closeout needed for the next gate:

- implementation status;
- files/areas changed at a concise level;
- verification results;
- internal review result;
- whether blockers remain;
- final report path;
- handoff update confirmation;
- exact next gate: **Independent Work implementation review**;
- confirmation that nothing was committed or pushed.

Do not imply owner authorization for commit, push, CTM-7, CTM-8, L1–L8, or any later work.
