# For Claude — Viewer Clash Panel Test Setup / Interaction UX Cleanup Package

I explicitly authorize one **larger bounded Viewer Clash Panel Test Setup / Interaction UX Cleanup package**.

This is an owner-authorized **product UX implementation package**, not a research-only package.

The purpose is to clean up the current Clash Panel interaction flow systematically instead of continuing to patch individual UI issues one at a time.

Proceed autonomously through:

**governing-artifact reconciliation → UX audit → product-design/spec update if required → implementation → headed Viewer validation → before/after snapshots → Claude visual triage → in-scope fixes → focused/full tests → internal review → handoff update**

and then stop at:

**Ready for independent Work visual/product review**

Do not stop for owner approval between those in-scope steps unless a hard owner-only boundary is reached.

## 1. Authoritative baseline

Verify first:

- repo: `aps-viewer-clash-detection`
- branch: `main`
- baseline: `060b7385d9ee9f8e73a857111fe8861a7daa83df`
- `main == origin/main`
- `git status --short` is completely empty
- zero modified files
- zero untracked files

Read:

- `docs/handoffs/latest.md`
- governing Clash Panel design/spec
- governing implementation plan
- latest product-facing reviews
- current Clash Panel implementation
- current native-style implementation
- current demo/sample wiring
- current tests
- repository instructions such as `CLAUDE.md`

Treat repository state as authoritative.

## 2. Owner-authorized UX decisions

### 2.1 New test placement

Current issue: `New test` sits at the bottom of Test Setup and is easy to misread as the next step in the setup flow.

Required direction:

Move `New test` into the top Test Setup action row, **to the left of `Hide setup`**.

Target hierarchy:

`[ New test ]                         [ ▾ Hide setup ]`

Requirements:

- `New test` is visually secondary/neutral, not primary;
- `Hide setup` remains the setup-collapse action;
- accidental reset risk is reduced;
- if current state can be lost, define clear reset semantics and appropriate guard/disabled behavior;
- do not add confirmation unless justified by real current state-loss semantics.

### 2.2 Soft / Clearance measurement-basis UX

Current issue: Soft/Clearance becomes unavailable when the host cannot verify a common measurement basis.

The owner explicitly rejects “just disable Soft” as the final product behavior.

Required direction:

**Do not simply disable Soft because the measurement basis cannot be auto-verified.**

Support an explicit safe fallback where the user can provide the measurement interpretation.

At minimum evaluate and implement the appropriate subset of:

#### Verified basis
- system/host verifies common measurement basis;
- Soft available normally;
- tolerance uses explicit physical units;
- result provenance says `verified`.

#### User-supplied basis
When automatic verification is unavailable:
- Soft may become available if the user explicitly supplies required basis/unit information;
- user provides tolerance and unit/basis;
- any required scale/conversion must be explicit and contractually justified;
- UI clearly says the basis is user supplied;
- result provenance must never label this as verified.

#### Raw model units
Only if technically sound with the current collision library:
- allow an advanced/raw mode where tolerance is interpreted in model/Viewer units;
- label it clearly as unverified/raw units;
- never imply physical-unit correctness.

Do not implement raw mode if the underlying library cannot consume it soundly.

## 3. Preserve fail-closed correctness

Improve the UX without weakening correctness.

The product should distinguish, where technically applicable:

- `verified`
- `user-supplied`
- `raw-model-units`
- `unavailable`

Rules:

- no hidden conversion assumptions;
- no unit guessing;
- no silent scale fallback;
- override must be explicit;
- user-supplied basis must never be marked verified;
- Hard mode remains available regardless of Soft basis availability.

## 4. Soft wording

Replace wording that can be misread as “these models cannot be clash-tested.”

Preferred direction:

> **Soft clearance needs a measurement basis. Hard clash is available.**

When not auto-verified:

> **Measurement basis was not verified automatically. Choose the units/basis to run a Soft clearance test.**

Technical details like “host did not provide a measurement-basis check” should be secondary/help text, not primary messaging.

## 5. Systematic Test Setup UX audit

Do not limit this package to only the two owner-reported issues.

Audit the whole Test Setup / interaction flow:

### Test lifecycle
- New test
- test identity/name
- reset semantics
- setup collapse/expand
- readiness

### Mode
- Hard
- Soft/Clearance
- mode affordance
- basis status
- tolerance
- unit
- help/warning copy

### Set A / Set B
- model checkboxes
- `Use selection`
- selected-model labels
- empty-set behavior
- invalid combinations
- self-clash

### Readiness
- `Ready`
- `Not ready`
- why not ready
- redundant status text
- relationship to Run Status

### Run Status
Review wording for:
- Idle
- Ready to run
- Running
- Stopping
- Completed
- Error
- cancelled/partial

Previously observed UX debt now becomes in-scope:
- `Idle · Ready to run` plus `Ready to run.`
- `Completed · Completed`

### Filters and grouping
Only adjust wording/hierarchy if naturally affected.
Do not add new grouping features.

### Results / Selected Clash
Only adjust wording/layout where needed for interaction hierarchy.
Do not change result semantics.

## 6. Preserve Viewer-native style

Keep the newly accepted Viewer-native visual language.

Do not regress:
- typography
- spacing
- controls
- sections
- rows
- selected/hover/disabled states
- focus ring
- panel width
- scrolling
- light-theme consistency

## 7. Governing-spec reconciliation

Because this package changes Soft measurement handling and Test Setup action hierarchy, inspect the governing product spec before implementation.

If current spec explicitly requires the old behavior, this owner authorization permits updating the **product-facing design/spec** to reflect the new owner decision.

Do not modify:
- G2 acceptance procedure
- acceptance semantics
- unrelated collision-library invariants

## 8. Measurement-basis data contract

Define the smallest necessary contract.

Determine whether interfaces need:
- basis status
- user-selected unit
- tolerance
- conversion scale
- provenance

Preferred conceptual states:
- `verified`
- `user-supplied`
- `raw-model-units` if supported
- `unavailable`

Do not invent more states than needed.

Ensure result/test metadata can distinguish user-supplied from verified.

## 9. Soft headed validation must become real

Close the visible product gap.

Validate:

### Case 1 — Hard
- Structure/Mechanical still works
- 491 Hard clashes baseline preserved

### Case 2 — Soft with no auto-verified basis
- Soft is not simply dead/disabled;
- explicit basis/tolerance controls shown;
- Hard availability clearly stated;
- Soft cannot run until required user input is valid.

### Case 3 — Soft with user-supplied basis
- enter valid tolerance + basis/unit;
- Soft becomes ready;
- execute real Soft pipeline if technically supported;
- results provenance says user-supplied/unverified correctly.

### Case 4 — invalid input
- zero/negative/invalid tolerance rejected;
- missing/unsupported basis handled clearly;
- no silent fallback.

If raw model units are implemented:
- add a separate headed case with explicit warning/provenance.

Do not fabricate a `verified` result.

## 10. New test action row

Implement:

- `New test` left
- `Hide setup` right
- responsive layout
- sensible keyboard focus order
- no overlap
- `New test` does not compete with `Run clash test`

Collapsed state must remain coherent.

## 11. Reset safety

Audit exactly what `New test` resets.

Determine whether it clears:
- name
- mode
- sets
- results
- filters
- selected clash
- markers
- isolation
- run state

Make the semantics explicit.

Use confirmation/guarding only if justified by actual state-loss risk.

## 12. Readiness wording cleanup

Remove contradictory/redundant status copy.

Preferred:
- one concise high-level status
- one reason/help line only when needed

Do not reduce error-state clarity.

## 13. Error/help text

Review:
- Soft basis unavailable
- invalid tolerance
- empty Set A/B
- invalid self-clash
- run failure
- no results
- partial/cancelled run
- unavailable action

Use product language, not internal API language.

## 14. Keyboard/focus flow

Review tab/focus sequence through:
- New test
- Hide setup
- test name
- mode
- basis/unit/tolerance
- Set A
- Use selection
- Set B
- self-clash
- Run
- Stop

Verify:
- focus ring visible
- disabled controls skipped
- hidden collapsed controls not focusable
- ordering is logical

## 15. Before/after evidence

Use the current committed native-style screenshots as before-state.

Capture after-state screenshots under a new package, e.g.:

`docs/research/2026-10-07-viewer-clash-panel-test-setup-ux-cleanup/`

Capture at minimum:

1. Test Setup initial
2. New test + Hide setup row
3. Hard ready
4. Soft with no verified basis
5. Soft user-supplied basis controls
6. invalid tolerance/basis
7. valid Soft ready
8. Soft results if runnable
9. collapsed setup
10. Set A/B selection
11. self-clash
12. Idle
13. Running
14. Stopping/partial
15. Completed
16. empty results
17. narrow viewport

Use deterministic filenames.

## 16. Claude visual triage

Claude must inspect every required screenshot.

Classify:
- PASS
- FAIL
- INCONCLUSIVE

Check:
- action hierarchy
- reset risk
- mode clarity
- Hard availability
- Soft basis affordance
- tolerance/unit clarity
- readiness clarity
- duplicate wording
- Set A/B readability
- native styling
- narrow viewport
- focus state where visible

Fix all in-scope visual FAILs before stopping.

Do not ask owner to inspect screenshots yet.

## 17. Product regression baseline

Re-check:

- panel open/close
- X-close sync
- rapid first click
- Structure/Mechanical demo
- Hard full run = 491
- Stop/partial
- Group None
- Group Element
- filter
- pager
- Focus
- Isolate
- Markers
- Back to all
- Clear
- close/reopen
- default URL
- Room Locator
- Clash Finder

Any regression is blocking.

## 18. Tests

Add focused tests for:

### New test
- top-row placement/class structure
- reset semantics
- no duplicate/reset bug

### Soft basis
- no auto-verified basis
- user-supplied basis validation
- tolerance validation
- provenance
- no false verified state
- Hard remains available
- invalid basis fail-closed

### Readiness
- no contradictory duplicate wording
- correct ready/not-ready reasons

### Accessibility
- focus order
- disabled controls
- labels
- keyboard operation where supported

Run relevant full regression suites.

## 19. Internal review

Perform one full internal review after implementation/headed validation.

Use:
- Critical
- High
- Medium
- Low

Review:
- owner-decision fidelity
- measurement-basis correctness
- provenance correctness
- no hidden unit assumptions
- reset safety
- action hierarchy
- readiness wording
- help/error text
- keyboard/focus
- Viewer-native styling
- headed evidence
- Soft headed validation
- regression safety
- scope discipline

Fix all in-scope Critical/High/Medium autonomously.

If substantial fixes occur:
- rerun tests
- rerun headed validation
- refresh screenshots

## 20. Hard boundaries

Stop and ask only if work requires:
- changing collision math/algorithms
- changing acceptance procedure
- changing G2/C6/C8 semantics
- unsupported unit conversion assumptions
- new grouping features
- persistence
- Viewer selection changes
- framing changes
- G3
- major architecture rewrite

## 21. Exit criteria

Continue until:
- New test hierarchy corrected
- Soft basis UX usable and honest
- Hard availability obvious
- user-supplied Soft flow validated if technically supported
- status/readiness wording coherent
- Test Setup flow coherent
- required screenshots exist
- no unresolved in-scope visual FAIL
- relevant tests pass
- regression baseline intact
- internal review has no unresolved in-scope C/H/M
- handoff updated

Then stop at:

**Ready for independent Work visual/product review**

Do not commit/push.

## 22. Handoff

Update `docs/handoffs/latest.md` with:
- repo / branch / HEAD / tree
- scope: `Viewer Clash Panel Test Setup / Interaction UX Cleanup`
- owner decisions implemented
- Soft basis/provenance behavior
- New test placement/reset semantics
- headed validation
- evidence path
- tests
- remaining product debt
- G2/C6/C8 kept separate
- no retry/new record/reset
- next action: independent Work visual/product review

## 23. Prohibited

Do not:
- add unrelated features
- add new Group By behavior
- add persistence
- add Viewer selection
- change framing semantics
- restart G2/C8 research
- run new G2 acceptance
- issue/reset authorization
- alter acceptance procedure
- start G3
- commit
- push

## 24. Final report

Report:
- branch / HEAD / origin relation
- files changed
- governing spec/design updates
- New test placement/result
- reset semantics
- Soft basis states
- tolerance/unit behavior
- provenance behavior
- launch command
- headed flow
- evidence path
- visual totals
- Hard regression result
- Soft headed result
- readiness wording result
- Set A/B UX result
- keyboard/focus result
- focused/full test results
- internal review C/H/M/L
- autonomous fixes
- remaining product debt
- G2/C6/C8 separation
- working tree
- exact next gate: independent Work visual/product review

Explicitly confirm:
- no unsupported unit assumptions
- no result marked verified unless actually verified
- no unauthorized scope expansion
- no G2 retry
- no new authorization record
- no attempt reset
- no acceptance-procedure change
- no G3
- no commit
- no push
