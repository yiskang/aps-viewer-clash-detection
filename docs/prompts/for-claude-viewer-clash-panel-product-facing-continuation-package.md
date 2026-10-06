# For Claude — Viewer Clash Panel Product-Facing Continuation Package

I explicitly authorize one **larger bounded Viewer Clash Panel product-facing continuation package**.

This package must begin by reading the repository's current governing artifacts to determine the **already-authorized next product scope**, then implement that scope directly.

Do **not** invent a new milestone, product scope, Group By feature, persistence work, Viewer selection behavior, or other expansion unless the governing repository artifacts explicitly authorize it.

The goal is visible product progress, not another research-only cycle.

---

# 1. Authoritative baseline

Verify first:

- repo: `aps-viewer-clash-detection`
- branch: `main`
- committed baseline:
  `d45703f21b9001bd8114fbf0fcbc7263e5046cb1`
- `main == origin/main`
- `git status --short` is completely empty
- zero modified files
- zero untracked files

Current accepted product-facing baseline:

- headed demo works end to end
- full Structure vs Mechanical run:
  `491` clashes
- cancelled partial run:
  `394` clashes
- visual evidence:
  `16 PASS / 0 FAIL / 0 INCONCLUSIVE`
- offline suite:
  `5,177 total / 5,176 pass / 0 fail / 1 existing todo`
- DOM suite:
  `83/83`
- framing:
  accepted for v1
- Viewer object selection:
  excluded by governing spec §9.2
- cross-reload persistence:
  deferred
- default-page lazy loading:
  accepted and regression-safe

Historical verification debt remains separate:

- G2:
  `FAIL (row 3)`
- C6:
  `NOT_EVIDENCED`
- C8:
  unresolved

Do not reopen that debt unless a new visible product defect is actually reproduced.

---

# 2. Mandatory governing-artifact read

Before proposing or changing any product behavior, read and reconcile:

- `docs/handoffs/latest.md`
- current governing Clash Panel design/spec
- current governing implementation plan
- latest authoritative product-facing review
- current Viewer Clash Panel implementation
- current demo/sample wiring
- current test coverage

Also inspect repository-level instructions such as `CLAUDE.md`.

Treat the repository as the source of truth.

The handoff is navigation, not proof.

Independently verify:

- branch / HEAD
- working tree
- governing spec/plan
- latest authoritative review
- implementation state
- test state

---

# 3. Determine the authorized next product-facing scope

From the governing artifacts, identify the **next authorized product-facing scope**.

Write a short scope statement before implementation covering:

- exact feature/work item
- governing artifact/section
- why it is authorized now
- explicit non-goals
- what visible user outcome should exist when done

Do **not** ask the owner for approval merely to restate already-authorized scope.

Stop and ask only if:

- governing artifacts conflict materially;
- the next milestone is not authorized;
- scope expansion would be required;
- an owner-only product decision is unresolved.

---

# 4. Do not silently expand scope

Specifically do **not** add or change any of the following unless the governing artifacts explicitly authorize them:

- Group By
- cross-reload persistence
- Viewer object selection
- a different framing semantic
- a new result model
- a new milestone
- a new product architecture
- new live acceptance semantics
- G3 work

If one of these is merely useful but not authorized, record it as deferred product debt.

---

# 5. Implement the authorized scope directly

Once the authorized scope is established, implement it.

Prefer actual product-facing implementation over additional standalone research.

Research is allowed only when needed to resolve a concrete implementation question inside the authorized scope.

The package may autonomously include:

- implementation
- sample/demo wiring
- focused tests
- headed Viewer validation
- screenshots/snapshots
- product-facing evidence report
- internal review
- in-scope Critical/High/Medium remediation
- handoff update

Do not stop for owner approval between these steps unless a hard boundary is reached.

---

# 6. Product-facing validation rule

For any Viewer/UI/camera/navigation behavior:

Use visible validation first.

Required priority:

1. headed Viewer behavior
2. screenshots/snapshots
3. runtime/console state
4. automated numeric/oracle checks

If visible behavior is correct but an old acceptance oracle disagrees:

- classify it as verification discrepancy/debt;
- do not block product progress;
- do not restart D0/D1/D2-style causality research.

If visible behavior is actually wrong:

- treat it as a product bug;
- fix it within scope;
- re-run headed validation.

---

# 7. Headed validation

Run the actual product/sample in a headed browser.

Capture deterministic visual evidence for the implemented scope.

At minimum capture:

- initial state
- action entry point
- in-progress/loading state if relevant
- completed state
- selected/active state
- Viewer interaction state
- cleanup/reset state
- empty/error state if relevant

Use screenshots by default.

Use video only if motion/transition behavior materially benefits from it.

Store evidence under a package-local research/evidence directory with deterministic filenames.

---

# 8. Claude visual triage before owner escalation

Claude must inspect all captured screenshots before stopping.

For every required visual state, record:

- PASS
- FAIL
- INCONCLUSIVE

with a short reason.

If FAIL and the issue is in scope:

- fix it;
- regenerate affected screenshots;
- re-review visually.

Do not escalate ordinary visible defects to the owner.

Do not ask the owner to inspect screenshots unless:

- a genuine visible/product defect remains;
- evidence conflicts;
- Work later disagrees with Claude;
- or an owner-only UX/product decision is required.

---

# 9. Product-facing evidence report

Create/update a concise report under `docs/research/` containing:

- exact launch command
- exact URL/path
- exact models/data used
- implemented scope
- demo/user flow
- screenshots index
- visual PASS/FAIL matrix
- console/runtime status
- tests
- known limitations
- deferred product debt

Keep two sections clearly separate:

## Product-facing status
What visibly works now.

## Verification debt
What remains unresolved separately, including G2/C6/C8.

Do not let verification debt obscure the product-facing result.

---

# 10. Tests

Run all relevant existing suites.

Add focused tests only for the authorized product-facing changes.

At minimum cover:

- lifecycle
- state transitions
- Viewer interaction
- cleanup
- regression of existing demo-ready behavior
- any newly introduced user-visible logic

Do not add broad acceptance machinery unless a real implementation defect requires it.

---

# 11. Regression protection

Preserve the already accepted demo-ready behavior unless the governing scope intentionally changes it:

- Clash Panel launch
- Structure/Mechanical demo
- 491 full run
- Stop/partial results
- filtering
- paging
- result selection highlight
- Focus
- Isolate
- Markers
- Back to all
- Clear
- close/reopen cleanup
- default URL safety
- Room Locator unchanged
- Clash Finder unchanged

If any accepted behavior regresses, fix it before stopping.

---

# 12. Internal review

Perform a full internal review after implementation and headed validation.

Use explicit:

- Critical
- High
- Medium
- Low

Review:

- governing-scope fidelity
- product-facing completeness
- visible UX correctness
- Viewer integration
- cleanup/state management
- regression safety
- headed visual evidence
- snapshot coverage
- tests
- deferred debt classification
- no accidental G2 research restart
- no unauthorized milestone/scope expansion

Fix all in-scope Critical/High/Medium findings autonomously.

If substantial fixes occur, re-run affected headed validation and refresh evidence.

---

# 13. Hard owner-only boundaries

Stop and request owner input if work requires:

- changing the governing product scope materially;
- starting a new milestone not already authorized;
- adding Group By when not authorized;
- adding persistence when not authorized;
- changing Viewer selection semantics contrary to spec;
- changing accepted framing semantics;
- changing G2 procedure/acceptance contract;
- G2 retry;
- new authorization record;
- attempt reset;
- G3 transition;
- architecture rewrite outside the current authorized work item.

Do not silently cross these boundaries.

---

# 14. Exit criteria

Continue autonomously until:

- authorized product-facing scope is implemented;
- headed validation completed;
- required screenshots exist;
- Claude visual triage has no unresolved in-scope FAIL;
- relevant tests pass;
- existing demo-ready regression baseline remains intact;
- internal review has no unresolved in-scope Critical/High/Medium;
- handoff is updated.

Then stop at:

**Ready for independent Work visual/product review**

Do not ask the owner to inspect screenshots yet.

---

# 15. Handoff

Update `docs/handoffs/latest.md` with:

- repo / branch / HEAD / working tree
- governing spec/plan
- exact authorized product-facing work item
- implementation status
- demo/launch command
- headed validation status
- snapshot path
- tests
- visible capabilities now available
- known product limitations
- deferred product debt
- G2/C6/C8 verification debt kept separate
- no retry/new record/reset
- next action:
  **independent Work visual/product review**

Keep the handoff concise.

---

# 16. Commit policy

Do not commit or push.

Leave implementation/tests/evidence/reviews/handoff uncommitted for independent Work review.

---

# 17. Prohibited

Do not:

- restart deep G2/C8 causality research without a newly reproduced visible defect;
- run a new G2 acceptance attempt;
- issue/reset authorization records;
- alter acceptance procedure;
- invent a new product milestone;
- start G3;
- commit;
- push.

---

# 18. Final report

Report:

- branch / HEAD / origin relation
- governing artifact and exact authorized scope
- files changed
- implementation completed
- exact launch command
- exact demo/user flow
- headed validation result
- snapshot evidence path
- visual PASS/FAIL/INCONCLUSIVE summary
- console/runtime status
- relevant test results
- regression-baseline status
- internal review C/H/M/L
- autonomous fixes performed
- deferred product debt
- G2/C6/C8 debt still separated
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
