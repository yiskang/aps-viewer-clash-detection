# For Claude — Viewer Clash Panel Demo-Ready / Product-Facing Completion Package

I explicitly authorize one **larger bounded Viewer Clash Panel demo-ready / product-facing completion package**.

The goal is now **visible, usable product progress** — not additional causality research.

This package may proceed autonomously through:

**product-facing integration → headed Viewer validation → snapshot/video evidence capture → Claude visual triage → in-scope fixes → tests → internal review → handoff update**

and then stop at:

**Ready for independent Work visual/product review**

Do not stop for owner approval between those internal steps unless a protected owner-only boundary is reached.

---

# 1. Authoritative baseline

Verify repository and current state before editing.

Use the repository as the source of truth.

Read:

- `docs/handoffs/latest.md`
- current branch/HEAD/origin relation
- relevant Viewer Clash Panel implementation
- Viewer Adapter
- Federated Clash Test Core
- current sample/demo integration
- current product-facing tests
- latest accepted reviews/specs/plans for the panel
- current G2 verification status only as known verification debt

Confirm:

- Viewer Clash Panel implementation exists
- Viewer Adapter is complete
- Federated Clash Test Core is complete
- historical G2 remains `FAIL (row 3)`
- C6 remains `NOT_EVIDENCED`
- C8 remains unresolved
- diagnostic/live research remains checkpointed and deferred
- no current live diagnostic authorization exists

Do not reinterpret unresolved G2 causality as a blocker for demo/product-facing work unless a concrete visible product defect is reproduced.

---

# 2. New standing validation rule

For Viewer/UI/camera/navigation failures, use **two separate tracks**:

## Track A — Product-facing visible validation
This package owns Track A.

Use:

- headed Viewer
- headed Playwright where appropriate
- screenshots/snapshots
- video only if useful
- direct visual inspection
- camera/selection/isolate/fit-to-view state capture
- console/runtime evidence

## Track B — Acceptance/causality verification
This remains separate verification debt.

Do not let unresolved Track B causality block Track A unless:

- the headed/visible run reproduces a real visible defect;
- the product behavior is demonstrably broken;
- or a governing product spec explicitly makes it blocking.

---

# 3. Agent-side visual triage before owner escalation

Do **not** ask the owner to inspect screenshots merely because screenshots exist.

The required escalation sequence is:

1. Claude performs headed validation and captures evidence.
2. Claude reviews the visual evidence first.
3. Claude fixes clear in-scope visible defects autonomously.
4. After Claude reaches a stable result, the package stops for independent Work review.
5. Work independently reviews the same snapshots/video/runtime evidence.
6. Only after Claude + Work review should the owner be asked to inspect or decide, and only if:
   - a genuine visible/product defect remains;
   - Claude and Work disagree;
   - evidence conflicts;
   - or a product/UX choice requires owner intent.

If screenshots look correct but an automated numeric/oracle check fails, classify it first as a **verification discrepancy**, not automatically as a product defect.

---

# 4. Package objective

Deliver a Viewer Clash Panel state that is actually demoable and product-facing.

The user should ultimately be able to launch the sample and visibly exercise:

- opening the Clash Panel;
- selecting/configuring a clash test;
- running a federated clash test;
- seeing progress/loading state;
- seeing results;
- selecting a result;
- selecting corresponding Viewer objects;
- isolate/show/hide behavior where supported;
- fit-to-view / camera navigation;
- marker display;
- empty state;
- error state;
- completed state;
- repeatable demo flow.

Prefer an end-to-end usable result over additional theoretical research.

---

# 5. Inspect current product-facing implementation

Before changing code, inspect current implementation and determine:

- what already works;
- what is wired but not exposed;
- what is missing from the sample;
- what UI is already implemented;
- which interactions are incomplete;
- what real ViewerBridge operations are available;
- whether markers-only v1 remains the intended scope;
- whether Group By or other post-MVP features are explicitly deferred;
- what the current sample/demo entry point is.

Create a concise implementation-gap note under `docs/research/` if useful.

Do not reopen already-settled architecture without evidence of a product-facing blocker.

---

# 6. Demo-ready scope

Implement only what is needed for a coherent demo-ready v1.

At minimum:

## Panel shell
- Docking Panel opens/closes
- correct title/placement
- resizable/scrollable if current design requires it
- no console errors on repeated open/close

## Test execution
- user can initiate the supported federated clash test flow
- loading/progress state is visible
- duplicate execution is prevented or clearly handled
- failure state is visible and recoverable where reasonable

## Result list
- results render predictably
- selected result is visually distinguishable
- empty result state is clear
- counts/labels are understandable
- deterministic ordering where current contract defines it

## Viewer interaction
For a selected result:
- related model/object selection works
- isolate/show/hide works if part of current v1
- fit-to-view works visibly
- camera lands in a useful framing
- marker appears at the intended location
- switching results updates state coherently

## Cleanup
- closing panel/clearing results does not leave stale selection/markers
- repeated runs do not accumulate stale state
- model unload/reload behavior is safe within current scope

Do not add large new feature areas merely for polish.

---

# 7. Headed Playwright / visible Viewer validation

This is mandatory.

Run the actual Viewer sample in a **headed browser**.

Do not rely only on headless acceptance.

Use Playwright in headed mode where practical.

Capture visual evidence for at least:

1. Viewer loaded with required model(s)
2. Clash Panel open
3. clash test ready/configured
4. test running/loading
5. results displayed
6. result selected
7. Viewer objects highlighted/selected
8. isolate/show state if applicable
9. fit-to-view result
10. marker visible
11. empty state
12. error state if reproducible safely
13. repeated result switching
14. panel close/reopen

Store snapshots under a package-local evidence directory, for example:

`docs/research/2026-10-06-viewer-clash-panel-demo-ready/snapshots/`

Use deterministic filenames.

If video adds clear value for camera transitions, capture one short bounded recording; otherwise screenshots are sufficient.

---

# 8. Visual fit-to-view sanity check

Because prior G2 C8 work involved camera/frustum uncertainty, explicitly perform a low-cost product-facing visual check.

For representative selected clash results:

- invoke the real fit-to-view flow;
- capture screenshot after visible stabilization;
- record camera state if useful;
- verify the target objects are visibly framed;
- verify the framing is useful to a human operator;
- compare with any automated camera/frustum check only as secondary evidence.

If the screenshot is visually correct but a numeric/oracle check disagrees:

- do not block the demo;
- record the disagreement as verification debt;
- do not resume deep causality research in this package.

If the screenshot is visibly wrong:

- treat it as a real product-facing bug;
- fix it within scope;
- re-run headed validation.

---

# 9. Claude visual review

After capturing snapshots, Claude must review them before asking anyone else.

For each required screenshot, record:

- PASS
- FAIL
- INCONCLUSIVE

with a short reason.

Check:

- layout
- clipping
- state consistency
- visible selected objects
- marker placement
- camera framing
- stale UI
- duplicate state
- obvious console/runtime symptoms

If FAIL and the fix is inside this package, fix it and regenerate the affected snapshots.

Do not escalate ordinary visual cleanup to the owner.

---

# 10. Product-facing evidence report

Create a concise report under `docs/research/` containing:

- exact launch command
- sample URL/path
- models used
- demo sequence
- screenshots index
- visible PASS/FAIL matrix
- known limitations
- verification debt explicitly separated from product-facing status

Clearly distinguish:

## Product-facing status
What a user can visibly do now.

## Verification debt
What remains unresolved in G2/C8 causality.

Do not conflate them.

---

# 11. Tests

Run all relevant existing tests.

Add only focused tests needed for product-facing regressions.

At minimum verify:

- panel open/close lifecycle
- result selection
- marker lifecycle
- ViewerBridge calls for selected result
- stale-state cleanup
- repeated execution behavior
- error/empty-state transitions
- no obvious regression in existing Clash Panel/Viewer Adapter/Core suites

Do not add research-only acceptance machinery unless required by a real product bug.

---

# 12. Fix policy

Within this package, Claude may autonomously fix:

- visible UI defects
- sample/demo wiring issues
- result-list defects
- marker lifecycle bugs
- selection/isolate/fit-to-view product behavior
- stale state / cleanup defects
- obvious console/runtime errors
- test gaps directly tied to those fixes

Claude may also fix internal-review Critical/High/Medium findings if they remain within this product-facing scope.

Do not stop for owner approval for those fixes.

---

# 13. Hard owner-only boundaries

Stop and ask the owner only if work requires:

- changing accepted product scope in a material way;
- adding a major new feature such as Group By if previously deferred;
- changing the accepted G2 procedure;
- changing real acceptance semantics solely to make tests pass;
- restarting deep C8 causality research;
- live-diagnostic authorization;
- new authorization record;
- attempt reset;
- G3/milestone transition;
- architecture rewrite outside current Viewer Clash Panel scope.

---

# 14. Internal review

Perform a full internal review of the demo-ready package.

Use explicit:

- Critical
- High
- Medium
- Low

Review:

- product-facing completeness
- sample/demo wiring
- Viewer interactions
- panel lifecycle
- result lifecycle
- marker lifecycle
- camera framing
- cleanup
- headed visual evidence
- screenshot coverage
- test coverage
- regression risk
- scope discipline
- separation of product-facing status from G2 verification debt

Fix all in-scope Critical/High/Medium findings autonomously.

If substantial fixes follow review, re-run affected headed validation and regenerate snapshots.

---

# 15. Exit criteria

Continue autonomously until:

- the sample launches reliably;
- the Panel is visibly usable;
- a clash test can visibly run;
- results display;
- selected-result interactions work;
- fit-to-view is visually sane;
- markers behave correctly;
- required snapshots exist;
- Claude visual review has no unresolved in-scope FAIL;
- relevant tests pass;
- internal review has no unresolved in-scope Critical/High/Medium;
- handoff is updated.

Then stop at:

**Ready for independent Work visual/product review**

Do not ask the owner to inspect snapshots yet.

---

# 16. Handoff

Update `docs/handoffs/latest.md` with:

- repo / branch / HEAD / working tree
- current demo-ready package status
- sample launch command
- product-facing capabilities now visible
- snapshot evidence path
- headed validation status
- test results
- known product limitations
- G2 verification debt clearly separated
- no live diagnostic/retry/new authorization/reset
- next action:
  **independent Work visual/product review of Viewer Clash Panel demo-ready package**

---

# 17. Commit policy

Do not commit or push.

Leave implementation/sample/tests/snapshots/reviews/handoff uncommitted for independent Work review.

---

# 18. Prohibited

Do not:

- resume D0/D1/D2-style deep causality research unless a newly reproduced visible defect requires it;
- run a new G2 live acceptance attempt;
- issue/reset authorization records;
- modify acceptance procedure merely to make demo pass;
- start G3;
- commit;
- push.

---

# 19. Final report

Report:

- branch / HEAD / origin relation
- files changed
- exact sample launch command
- exact demo flow
- implemented/fixed product-facing items
- headed browser command/setup
- snapshot evidence path
- snapshot PASS/FAIL summary
- visible fit-to-view verdict
- marker verdict
- panel/result lifecycle verdict
- test results
- internal review C/H/M/L
- autonomous remediations performed
- known product limitations
- G2 verification debt that remains deferred
- working-tree state
- exact next gate:
  **independent Work visual/product review**

Explicitly confirm:

- Claude reviewed the snapshots before owner escalation
- no unresolved in-scope visible FAIL remains
- no G2 live retry occurred
- no new authorization record
- no attempt reset
- no acceptance-procedure workaround was introduced
- no commit
- no push
