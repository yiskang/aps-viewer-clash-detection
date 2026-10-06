# For Claude — Viewer Clash Panel Product-Facing Continuation Package II

I explicitly authorize one **larger bounded Viewer Clash Panel product-facing continuation package**.

The goal is continued visible product progress from the current clean checkpoint.

This package must begin by reading the current repository handoff, governing spec/plan, latest product-facing reviews, and current implementation to identify the **next explicitly authorized product-facing scope**.

Do **not** invent a new milestone or silently expand scope.

Proceed autonomously through:

**governing-scope verification → implementation → headed Viewer validation → snapshot capture → Claude visual triage → in-scope fixes → tests → internal review → handoff update**

and then stop at:

**Ready for independent Work visual/product review**

Do not stop for owner approval between those internal steps unless a hard owner-only boundary is reached.

## 1. Authoritative baseline

Verify first:

- repo: `aps-viewer-clash-detection`
- branch: `main`
- baseline: `b24a005`
- `main == origin/main`
- `git status --short` is completely empty
- zero modified files
- zero untracked files

Read:

- `docs/handoffs/latest.md`
- current governing Clash Panel spec
- current governing implementation plan
- latest authoritative product-facing reviews
- current Viewer Clash Panel implementation
- current demo/sample wiring
- current tests
- repository instructions such as `CLAUDE.md`

Treat repository state as authoritative.

The handoff is navigation, not proof.

Independently verify:
- branch / HEAD
- working tree
- current governing spec/plan
- latest accepted product-facing review
- current implementation state
- current test state

## 2. Current accepted product-facing baseline

Preserve the current accepted baseline unless the governing scope intentionally changes it.

Current demo/product-facing state includes:

- headed demo works end to end
- Structure vs Mechanical SVF2 demo
- full run: `491` clashes
- partial cancellation behavior is timing-dependent and non-contractual
- Clash Panel lifecycle works
- Focus works
- Isolate works
- Markers work
- result switching works
- Back to all works
- filtering works
- paging works
- Clear works
- close/reopen cleanup works
- default-page lazy loading protects unrelated features
- Room Locator unchanged
- Clash Finder unchanged

Visual evidence state:

- authoritative PNG count: `17`
- PASS: `16`
- FAIL: `0`
- INCONCLUSIVE: `1`
- screenshot `13`: INCONCLUSIVE
- screenshot `13b`: authoritative PASS
- `12-narrow-700.png`: part of the reviewed/tracked evidence set

Remaining non-blocking product debt:

1. UUID fallback entropy
2. ~700 px responsive overflow
3. missing exact-width assertion

Accepted product decisions:

- framing remains acceptable for v1
- Viewer selection remains excluded by spec §9.2
- cross-reload persistence remains deferred

Do not reopen these unless the governing artifacts explicitly authorize them or new headed evidence shows a genuine product defect.

## 3. Historical verification debt remains frozen and separate

Preserve:

- G2: `FAIL (row 3)`
- C6: `NOT_EVIDENCED`
- C8: unresolved

Do not restart deep C8/G2 causality research unless a **new visible product defect is actually reproduced** in headed validation.

If visual behavior is correct but an older numeric/oracle check disagrees:
- classify it as verification discrepancy/debt
- do not block product-facing progress
- do not start D0/D1/D2-style research

## 4. Determine the next authorized product-facing scope

Before implementation, identify the exact next authorized product-facing work item from the governing artifacts.

Write a short scope statement covering:
- exact feature/work item
- governing artifact and section
- why it is authorized now
- visible user outcome expected
- explicit non-goals

Do not ask the owner for approval merely to restate already-authorized scope.

Stop and ask only if:
- governing artifacts materially conflict
- no next product-facing scope is authorized
- a new milestone would be required
- a material UX/product decision is unresolved
- implementation would require scope expansion

## 5. Do not invent scope

Do not add or change the following unless the governing artifacts explicitly authorize them:

- new Group By behavior
- cross-reload persistence
- Viewer object selection
- framing semantics
- new result model
- major architecture changes
- new milestone
- G3
- new acceptance semantics
- live diagnostic work

If useful but unauthorized, record as deferred product debt.

## 6. Implement the authorized scope directly

Once the next authorized scope is identified, implement it.

Prefer actual product-facing code over standalone research.

Research is allowed only to resolve a concrete implementation question inside the authorized scope.

The package may autonomously include:
- product code
- sample/demo integration
- focused tests
- headed Viewer validation
- screenshots
- evidence report
- internal review
- in-scope Critical/High/Medium remediation
- handoff update

Do not stop for owner approval between those steps.

## 7. Snapshot-first validation rule

For Viewer/UI/camera/navigation behavior, use this priority:

1. headed Viewer behavior
2. screenshots/snapshots
3. runtime/console state
4. automated numeric/oracle checks

If screenshots are visually correct but an old oracle disagrees:
- classify as verification debt
- do not block product-facing readiness

If screenshots show a real product defect:
- fix it within scope
- re-run headed validation
- regenerate affected snapshots

## 8. Headed Viewer validation

Run the actual sample/product in a headed browser.

Capture deterministic visual evidence for the implemented scope.

At minimum capture:
- entry state
- action trigger
- loading/progress state if relevant
- completed state
- selected/active state
- Viewer interaction state
- cleanup/reset state
- empty/error state if relevant

Use screenshots by default.

Use video only if transition/motion behavior genuinely needs it.

Store evidence under a package-local directory with deterministic filenames.

## 9. Claude visual triage before owner escalation

Claude must inspect every required screenshot before stopping.

For each visual state record:
- PASS
- FAIL
- INCONCLUSIVE

with a short reason.

If FAIL and in scope:
- fix it
- rerun headed validation
- regenerate the affected evidence

Do not ask the owner to review screenshots merely because they exist.

Only owner-escalate later if:
- a genuine visible defect remains
- evidence conflicts
- Work disagrees materially with Claude
- or an owner-only UX/product choice exists

## 10. Preserve current demo regression baseline

Unless the authorized scope intentionally changes one of these, re-check:

- Clash Panel open/close
- X-close button synchronization
- rapid first-click handling
- Structure/Mechanical demo
- full-run 491 result
- Stop/partial behavior
- result list
- selected-row highlight
- filter
- pager
- Focus
- Isolate
- Markers
- switching results
- Back to all
- Clear
- close/reopen state
- default URL safety
- Room Locator
- Clash Finder

If any accepted behavior regresses, fix it before stopping.

## 11. Responsive and evidence debt

Do not automatically fix the remaining 3 Lows unless the governing scope includes them:

1. UUID fallback entropy
2. ~700 px responsive overflow
3. missing exact-width assertion

If the authorized work naturally touches one of these areas, fix it only if doing so is clearly within scope and does not distract from the product milestone.

Otherwise leave it deferred.

## 12. Product-facing evidence report

Create/update a concise report under `docs/research/`.

Include:
- governing scope
- exact launch command
- URL/path
- models/data used
- implemented behavior
- demo/user flow
- screenshots index
- visual PASS/FAIL/INCONCLUSIVE matrix
- console/runtime state
- test results
- regressions checked
- known limitations
- deferred product debt

Keep these separate:

### Product-facing status
What visibly works.

### Verification debt
G2/C6/C8 and other non-product-facing verification debt.

## 13. Tests

Run all relevant existing suites.

Add focused tests for the newly implemented scope.

At minimum cover:
- lifecycle
- state transitions
- Viewer integration
- cleanup
- regression of current demo-ready behavior
- newly introduced user-visible behavior

Do not add broad acceptance infrastructure unless required by a real product bug.

## 14. Internal review

Perform one full internal review after implementation and headed validation.

Use explicit:
- Critical
- High
- Medium
- Low

Review:
- governing-scope fidelity
- visible product completeness
- UI correctness
- Viewer integration
- state/lifecycle correctness
- cleanup
- regression safety
- headed evidence
- snapshot coverage
- tests
- deferred debt classification
- no unauthorized scope expansion
- no G2 causality restart

Fix all in-scope Critical/High/Medium findings autonomously.

If substantial fixes occur:
- rerun affected tests
- rerun headed validation
- refresh affected screenshots

## 15. Hard owner-only boundaries

Stop and request owner input only if work requires:
- material product scope change
- new milestone
- Group By expansion not already authorized
- persistence not already authorized
- changing Viewer selection semantics
- changing framing semantics
- acceptance-procedure change
- G2 retry
- new authorization record
- attempt reset
- G3 transition
- major architecture rewrite

Do not silently cross these boundaries.

## 16. Exit criteria

Continue autonomously until:
- next authorized product-facing scope is implemented
- headed validation completed
- required visual evidence exists
- Claude visual triage has no unresolved in-scope FAIL
- relevant tests pass
- current demo regression baseline remains intact
- internal review has no unresolved in-scope Critical/High/Medium
- handoff updated

Then stop at:

**Ready for independent Work visual/product review**

Do not ask the owner to inspect screenshots yet.

## 17. Handoff

Update `docs/handoffs/latest.md` with:
- repo / branch / HEAD / working tree
- governing spec/plan
- exact authorized product-facing work item
- implementation status
- launch/demo command
- headed validation result
- snapshot/evidence path
- test results
- product capabilities now visible
- known limitations
- remaining product debt
- G2/C6/C8 kept separate
- no retry/new record/reset
- next action:
  **independent Work visual/product review**

Keep the handoff concise.

## 18. Commit policy

Do not commit or push.

Leave implementation/tests/evidence/reviews/handoff uncommitted for Work review.

## 19. Prohibited

Do not:
- restart deep G2/C8 causality research without a newly reproduced visible product defect
- run a new G2 acceptance attempt
- issue/reset authorization records
- alter acceptance procedure
- invent a new product milestone
- start G3
- commit
- push

## 20. Final report

Report:
- branch / HEAD / origin relation
- governing artifact and exact authorized scope
- files changed
- implementation completed
- launch command
- demo/user flow
- headed validation result
- snapshot evidence path
- PASS/FAIL/INCONCLUSIVE totals
- console/runtime result
- relevant test results
- regression-baseline status
- internal review C/H/M/L
- autonomous fixes performed
- deferred product debt
- G2/C6/C8 debt separation
- working-tree state
- exact next gate:
  **independent Work visual/product review**

Explicitly confirm:
- no unauthorized scope expansion
- no G2 retry
- no new authorization record
- no attempt reset
- no acceptance-procedure change
- no G3
- no commit
- no push
