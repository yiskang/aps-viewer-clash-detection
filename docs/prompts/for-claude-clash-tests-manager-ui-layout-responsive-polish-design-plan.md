Clash Tests Manager — Manager UI Layout / Responsive Polish
Repository
/Users/kangea/Workspace/Codes/aps-viewer-clash-detection
The owner-decision checkpoint fdb8643 has already been pushed.
Before doing any work:
- independently verify the repository, branch, HEAD, origin/main, and working-tree state;
- verify that main == origin/main;
- verify the working tree is clean;
- read repo-level instructions such as CLAUDE.md;
- read docs/handoffs/latest.md;
- read docs/reviews/2026-10-10-clash-tests-manager-ui-architecture-owner-decision.md;
- read the governing Clash Tests Manager spec/design and accepted implementation plan referenced by the handoff.
Treat repository state and checked-in artifacts as authoritative.
Do not rely on conversation summaries as proof.
Governing owner decision
The owner has explicitly selected and ratified:
Option A — single APS Viewer Docking Panel with Manager/List ↔ Test Editor views.
This is now the governing product direction.
The prior governance gap is closed.
Do not reopen or reconsider the separate Manager Panel + Editor Panel architecture in this package.
Preserve:
- one Docking Panel;
- Manager/List and Test Editor as views within that Panel;
- the existing headless manager;
- one editor controller;
- active-test-only result residency;
- Viewer ownership semantics.
Owner-observed product problem
The current Clash Tests Manager functionality is acceptable, but the Manager view layout is not.
In the current real Viewer UI:
- the Manager Panel is too narrow for the amount of information displayed;
- the current dense multi-column/table presentation causes aggressive wrapping;
- Set A / Set B labels become difficult to scan;
- Readiness / status text becomes visually cramped;
- some text can wrap into pathological narrow columns;
- full-text Action buttons consume too much horizontal space;
- the current row structure is poorly suited to normal APS Viewer Docking Panel widths.
The owner specifically wants:
- a better Manager-view information layout;
- more appropriate Panel-width behavior;
- compact icon-based Actions instead of full-text action buttons;
- improved hierarchy for test name, active state, mode, status, Set A, Set B, and readiness;
- robust behavior for long Autodesk model names and narrow widths.
Authorization
The owner authorizes a bounded:
Manager UI layout / responsive polish design + implementation-plan amendment package only.
This package may inspect the existing implementation and CSS/UI conventions as needed.
It may update the governing design/spec and implementation plan only where necessary to make the approved presentation behavior explicit and mechanically implementable.
It must not implement production code yet.
Required design work
1. Manager Panel sizing
Determine and specify:
- appropriate preferred/default width for the Manager view;
- minimum useful Manager width;
- narrow-width behavior;
- whether Manager and Editor views should use the same width or may have different preferred widths;
- behavior when the user has manually resized the Docking Panel;
- whether switching Manager ↔ Editor may adjust width automatically, and if so under exactly what conditions;
- how any width behavior interacts with existing Viewer DockingPanel resize semantics.
Do not solve the layout problem only by making the Panel wider.
The design must still behave acceptably with long model labels and smaller widths.
2. Test item layout
Re-evaluate the current dense multi-column/table layout.
Strongly consider a structure that is more appropriate for a Viewer Docking Panel, such as:
- compact list item;
- two-line or multi-line row;
- compact card-like row;
- another layout that preserves scanability without behaving like a wide desktop table.
Do not assume the current 7-column layout must remain.
The design must define where and how to display:
- test name;
- active-test state;
- mode (Hard / Soft);
- run status;
- result count when applicable;
- Set A summary;
- Set B summary;
- readiness / stale / model-change state;
- action controls.
The visual hierarchy should make the most important information immediately scannable.
Long Set A / Set B model labels must not destroy the row layout.
3. Active-test presentation
Evaluate replacing constrained text such as:
(active)
with a more compact active-state treatment, for example:
- indicator dot;
- native-style badge;
- accent marker;
- another Viewer-consistent visual treatment.
The active state must remain accessible and not rely on color alone.
Do not change active-test semantics.
4. Actions
Current Manager actions include:
- Open/Edit;
- Duplicate;
- Reset results;
- Delete.
The owner wants these represented as compact icon actions where appropriate, instead of full-width textual buttons.
Before choosing icons:
- inspect current repository conventions;
- inspect current APS Viewer/native panel conventions already used by this project;
- reuse existing icon assets/classes/conventions if available;
- do not introduce arbitrary emoji;
- do not introduce a new icon library/system unless there is a demonstrated need and owner approval.
For each icon action, define:
- icon meaning;
- accessible name;
- aria-label;
- tooltip/title or the existing project equivalent;
- keyboard activation;
- focus state;
- disabled styling;
- disabled-reason linkage;
- destructive-action distinction where appropriate.
Existing confirmation behavior for Reset/Delete must not change.
Existing disabled semantics must not change.
5. Responsive and narrow-width behavior
Define explicit behavior for:
- normal width;
- moderately narrow width;
- minimum supported width.
Specify:
- which fields may wrap;
- which fields may truncate;
- whether ellipsis is allowed;
- whether full values remain available via title/tooltip/accessibility text;
- where line breaks are allowed;
- how Set A / Set B summaries behave;
- how readiness text behaves;
- how action icons remain usable;
- how pathological one-character-per-line wrapping is prevented.
The layout must not depend on every model name being short.
6. Information hierarchy
Explicitly define the intended scan order.
A reasonable candidate hierarchy to evaluate is:
Primary line
- active indicator;
- test name;
- compact mode/status metadata;
- action icons.
Secondary content
- Set A;
- Set B;
- readiness / stale state.
Example only — not pre-approved final design:
Clash tests                                      [+ New]

● Clash test 1                         [edit] [copy] [reset] [delete]
  Hard · Not run
  A  Architecture
  B  Mechanical + Structure
  Setup complete · Models unchanged

Treat this only as a product-direction hint.
Inspect the existing UI and Viewer conventions and propose the best concrete structure.
Do not silently treat this example as an already-approved final wireframe.
Existing behavior that must remain unchanged
This package must not alter:
- single-panel Manager/List ↔ Editor architecture;
- headless manager semantics;
- one editor controller;
- active-test-only result residency;
- Viewer ownership;
- manager recovery behavior;
- terminal fault behavior;
- readiness/stale semantics;
- model departure/re-entry behavior;
- test creation semantics;
- Open/Edit semantics;
- Duplicate semantics;
- Reset-results semantics;
- Delete semantics;
- confirmation behavior;
- active-test switching semantics;
- Set A / Set B identity semantics;
- label identity scope;
- public API;
- manager dispatch contracts;
- result ownership contracts;
- existing functional accessibility guarantees.
Deferred findings / scope protection
The previously deferred L1–L8 findings remain deferred and unauthorized.
Do not silently remediate them as part of this UI package.
If the proposed UI change mechanically intersects one of L1–L8:
1. identify the exact overlap;
2. state whether the layout change can proceed without remediating that Low;
3. if remediation would be required, stop and surface it as an owner decision.
Do not expand scope simply because a nearby Low is easy to fix.
Explicitly unauthorized
Do not:
- implement production UI code;
- modify production JavaScript/CSS for the layout;
- run CTM-7;
- run CTM-8;
- remediate L1–L8;
- reopen Manager vs Editor panel architecture;
- add persistence;
- add history;
- add background runs;
- add test lifecycle/history semantics;
- change result lifecycle;
- change public APIs;
- touch Core;
- touch Viewer Adapter;
- touch collision protected areas;
- begin G2/C6/C8/G3;
- begin reflected-fragment / R20-1 work;
- begin another milestone/package;
- commit;
- push.
The owner-decision checkpoint fdb8643 is already pushed.
This package must remain uncommitted until owner review.
Required repository investigation
Before writing the design:
Inspect and document the relevant current implementation, including as applicable:
- current Clash Tests Manager renderer;
- current Manager/List DOM structure;
- current Clash DockingPanel shell/composition;
- current CSS rules affecting width, grid/table layout, wrapping and overflow;
- current Viewer-native styling conventions already adopted by the Clash Panel;
- current button/icon usage in this repo;
- existing accessibility behavior for disabled actions and reasons;
- current tests pinning Manager DOM structure, width, classes, focus, labels, and action text.
Identify the exact production and test files that a later implementation would need to change.
Do not edit them in this package.
Governing artifact update
Determine whether the already-accepted §26 design/spec requires a bounded presentation amendment.
If the approved Manager layout cannot be implemented faithfully without changing §26 wording:
- update only the directly relevant presentation/layout clauses;
- preserve architecture and behavioral contracts;
- clearly identify that this is an owner-authorized UI-presentation amendment, not an architecture reopening.
Likewise, determine whether the accepted implementation plan needs a bounded amendment.
If so:
- update only the tasks/acceptance criteria directly affected by the Manager layout change;
- preserve already-completed functional implementation history;
- do not rewrite historical implementation as though the new UI layout had always been planned;
- distinguish historical completed work from the newly authorized polish package.
Acceptance criteria to define
The design/plan must include mechanical acceptance criteria for at least:
- Manager view no longer depends on the current dense wide-table structure;
- long Set A / Set B labels remain readable;
- no pathological one-character-per-line wrapping;
- preferred Manager width is defined;
- minimum useful width is defined;
- user resize behavior is defined;
- Manager ↔ Editor width behavior is defined;
- active-test indication is compact and accessible;
- Open/Edit icon action is discoverable and keyboard accessible;
- Duplicate icon action is discoverable and keyboard accessible;
- Reset icon action preserves confirmation and disabled reasons;
- Delete icon action preserves confirmation and disabled reasons;
- icon-only controls retain accessible names;
- disabled actions remain non-operable;
- existing disabled-reason accessibility linkage remains intact;
- narrow-width layout remains usable;
- Viewer-native visual alignment is preserved;
- no functional manager semantics change;
- no public API change.
Include expected automated test coverage.
Also define what must be verified later in a headed visual pass.
Upstream final report
Create one durable upstream package report under:
docs/research/*-final-report.md
for this UI-layout design/plan package.
The report should include:
- package scope;
- verified repository / branch / HEAD / origin / tree state;
- governing artifacts read;
- owner-decision record;
- current UI problem;
- implementation/CSS/icon-convention audit;
- proposed Manager layout;
- Panel sizing contract;
- responsive behavior;
- action/icon accessibility contract;
- exact files expected to change later;
- spec amendment summary, if any;
- implementation-plan amendment summary, if any;
- automated acceptance criteria;
- later headed visual acceptance criteria;
- protected semantics;
- deferred work;
- L1–L8 interaction analysis;
- unresolved owner decisions, if any;
- internal review findings and dispositions;
- exact next gate.
This report is the upstream package completion artifact for the design/plan work.
Internal review
Run the repository's normal bounded internal review process for this design/plan package.
Review specifically for:
- accidental product-behavior changes disguised as presentation changes;
- accessibility regressions;
- responsive-layout gaps;
- Viewer-native styling inconsistency;
- accidental dependency on fixed English text;
- action/icon ambiguity;
- width behavior that overrides user resizing;
- overlap with deferred L1–L8;
- spec/plan drift;
- hidden reopening of the separate-panel architecture.
Resolve in-scope review findings within the authorized documentation/design scope.
Do not use internal review findings as authority to expand scope.
Handoff
Update:
docs/handoffs/latest.md
Keep it concise.
Include:
- repository / branch / HEAD / tree state;
- owner-decision checkpoint fdb8643;
- current package status;
- governing spec/plan;
- new UI-layout design/final-report artifact;
- internal review artifact;
- whether the package is ready for independent Work review;
- blockers, if any;
- deferred L1–L8;
- CTM-7 / CTM-8 still unauthorized;
- exact next authorized gate;
- work that must not begin without authorization.
Stop condition
Stop when:
- the Manager UI layout / responsive design is explicit;
- required spec amendment is complete, if needed;
- required implementation-plan amendment is complete, if needed;
- upstream final report exists;
- bounded internal review is complete;
- handoff is updated;
- no production implementation has started;
- no commit or push has occurred.
Final status should be:
Ready for independent Work review / owner implementation authorization, or clearly state the blocking owner decision if one remains.
Do not begin implementation automatically.