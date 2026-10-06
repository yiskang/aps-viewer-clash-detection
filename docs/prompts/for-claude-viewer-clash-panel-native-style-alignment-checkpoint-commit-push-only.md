# For Claude — Viewer Clash Panel Native Viewer Style Alignment Checkpoint Commit + Push Only

I explicitly authorize **one scoped checkpoint commit and push** for the accepted Viewer Clash Panel Native Viewer Style Alignment package.

Latest independent Work visual/product review:

- Critical: 0
- High: 0
- Medium: 0
- Low: 2 non-blocking
- verdict: **native Viewer style alignment achieved**
- product semantics unchanged
- visual evidence:
  - `16 PASS`
  - `0 FAIL`
  - `0 INCONCLUSIVE`
- responsive behavior:
  accepted
- owner screenshot review:
  not required

Verification:

- Offline:
  - `5,191 pass`
  - `0 fail`
  - `1 existing todo`
- DOM:
  - `83/83`
- Focused style tests:
  - `8/8`
- `git diff --check`:
  clean

This task is checkpoint-only.

It does **not** authorize:

- new product features;
- grouping semantic changes;
- persistence;
- Viewer selection;
- framing semantic changes;
- clash semantic changes;
- G2 retry;
- new authorization record;
- attempt reset;
- acceptance-procedure changes;
- renewed G2/C8 research;
- G3/milestone transition;
- unrelated cleanup.

Use the repository as the source of truth.

---

## 1. Verify baseline

Before staging, verify:

- repo:
  `aps-viewer-clash-detection`
- branch:
  `main`
- HEAD:
  `838bbad40f778483cc9bf082ecaddbab84e19ea2`
- `main == origin/main`
- working tree contains only the reviewed native-style package/review/handoff/prompt changes
- `git diff --check` clean
- no unrelated modified/untracked files

Historical verification debt remains separate:

- G2:
  `FAIL (row 3)`
- C6:
  `NOT_EVIDENCED`
- C8:
  unresolved

Confirm no:

- G2 retry
- new authorization record
- attempt reset
- acceptance-procedure change
- G3 work

If baseline differs materially, stop and report.

---

## 2. Preserve accepted style outcome

Do not alter these during checkpointing.

Accepted outcome:

- Clash Panel now visually aligns with Viewer 7.124.2 native light-theme panels.
- Model Browser and Settings panel were used as the native references.
- Existing Continuation II screenshots are before-state evidence only.
- Current style package after-state evidence is authoritative for style alignment.

Accepted visual result:

- `16 PASS`
- `0 FAIL`
- `0 INCONCLUSIVE`

Do not regenerate or replace the evidence unless hash/file verification fails.

---

## 3. Preserve product semantics

Confirm the style package did not change:

- Run/Stop behavior
- Group None
- Group Element
- grouping semantics
- filter
- pager
- selected-row semantics
- Focus
- Isolate
- Markers
- Back to all
- Clear
- Soft-unavailable behavior
- error/empty semantics
- cancellation semantics
- framing semantics
- Viewer selection semantics
- persistence behavior
- clash result model

Do not change any of these while checkpointing.

---

## 4. Accepted style implementation areas

The reviewed package may include:

### Source/style
- `clashpanel/ui/ClashDockingPanel.js`
- `wwwroot/main.css`

### Focused tests
- style/host/shell tests added or updated by the package

### Research/evidence
- `docs/research/2026-10-06-viewer-clash-panel-native-style-alignment/`
- reference audit
- before/after evidence report
- after-state snapshots

### Reviews
- internal review
- independent Work native-style visual review

### Handoff
- `docs/handoffs/latest.md`

### Related prompts
- Claude native-style package prompt
- Work independent visual review prompt
- this checkpoint prompt, if present

Do not stage unrelated files.

---

## 5. Preserve accepted style decisions

Keep these accepted findings unchanged:

- body uses the selected Viewer-native docking-panel-scroll conventions
- title/body overlap is resolved
- controls/rows use Viewer-native visual values/conventions
- disabled opacity issue is fixed
- text-input focus outline issue is fixed
- cascade conflict is fixed
- panel fits at ~700 px without inner overflow
- remaining page overflow comes from existing header content outside Clash Panel ownership
- exact width assertion is accepted
- Room Locator / Clash Finder regression risk is accepted as sufficiently contained for this style-only package

Do not expand scope to fix unrelated page-level layout.

---

## 6. Preserve remaining non-blocking style debt

Do not fix additional style polish in this checkpoint task.

Keep the two Work-adjudicated Low findings exactly as documented.

If the handoff/review lists the exact two Lows, preserve them.

Do not silently reduce or reclassify them during checkpointing.

---

## 7. Protected-state verification

Before staging, confirm no changes to:

- historical authorization records
- immutable historical evidence
- accepted G2 procedure
- D2 checkpoint
- diagnostic-instrumentation checkpoint
- future live-diagnostic design/preparation checkpoint
- Viewer Clash Panel product-continuation checkpoints
- unrelated product features
- G3 work

Also confirm no:

- G2 retry
- new authorization record
- attempt reset
- acceptance-procedure change
- renewed G2/C8 causality research

If any unexpected protected change exists, stop.

---

## 8. Final verification before staging

Run final-state verification again.

### Offline
Expected:

- `5,191 pass`
- `0 fail`
- `1 existing todo`

Report total count as emitted by the suite.

### DOM
Expected:

- `83/83`

### Focused style tests
Expected:

- `8/8`

### Diff check
Run:

`git diff --check`

Expected:

clean.

Do not rerun headed validation unless implementation/evidence changed after Work review.

If no post-review product/style code changed, use the independently reviewed headed visual evidence.

---

## 9. Verify evidence package

Confirm checkpoint includes:

- reference audit
- after-state visual evidence
- all reviewed PNGs
- style-alignment evidence report
- before-state references to committed Continuation II evidence
- explicit statement that before-state screenshots were not the target reference

Do not omit evidence while committing style changes.

---

## 10. Handoff checkpoint state

Ensure `docs/handoffs/latest.md` accurately records:

- Native Viewer Style Alignment accepted for checkpoint
- Critical 0 / High 0 / Medium 0 / Low 2
- visual evidence:
  - 16 PASS
  - 0 FAIL
  - 0 INCONCLUSIVE
- offline result
- DOM `83/83`
- focused style `8/8`
- Viewer-native references used
- responsive result accepted
- no product semantics changed
- remaining style debt
- G2/C6/C8 kept separate
- no owner screenshot review required
- next gate based on governing product artifacts, not renewed causality research

Do not add the future commit hash before the commit exists.

---

## 11. Inspect working tree

List all modified and untracked files.

Classify each by role.

Stage only:

- reviewed style/source changes
- reviewed focused tests
- reviewed style evidence package
- internal review
- independent Work review
- related prompts
- latest handoff

Do not use broad staging if it risks unrelated files.

---

## 12. Staged-diff inspection

Before commit:

- inspect staged file list
- inspect staged diff summary

Confirm:

- no unrelated artifact
- no product semantic change beyond reviewed style work
- no authorization-state change
- no acceptance-procedure change
- no G3 work
- no hidden verification-research change

If anything unexpected is staged, unstage it and stop/report if disposition is unclear.

---

## 13. Commit

Create exactly **one scoped checkpoint commit**.

Suggested semantic intent:

`checkpoint Viewer Clash Panel native Viewer style alignment`

Use repository convention for exact wording.

After commit verify:

- only intended style/source/tests/docs/evidence/reviews/prompts/handoff entered the commit
- no unrelated protected path entered the commit

Report full commit hash.

---

## 14. Push

Push the single commit to `origin/main`.

After push verify:

- `main == origin/main == <new commit>`
- ahead/behind `0/0`
- tracked tree clean
- no unexpected untracked durable artifacts
- G2/C6/C8 unchanged
- no authorization/procedure/G3 changes

---

## 15. Clean working tree requirement

Run:

`git status --short`

Target:

**completely empty**

Do not intentionally leave durable Markdown/evidence/review artifacts untracked.

If anything remains, list and explain it.

---

## 16. Prohibited

Do not:

- modify product behavior during checkpointing
- fix the remaining style Lows
- add new Group By behavior
- add persistence
- add Viewer selection
- change framing semantics
- change clash semantics
- restart G2/C8 research
- run a new G2 acceptance attempt
- issue/reset authorization records
- alter acceptance procedure
- start G3
- perform unrelated cleanup

---

## 17. Stop gate

Stop immediately after:

- one commit
- one push
- post-push verification
- clean working tree

Do not begin another package in this task.

---

## Final report

Report:

- new checkpoint commit hash
- exact files committed
- push result
- final `main` / `origin/main` relation
- offline result
- DOM result
- focused style-test result
- visual evidence summary
- final `git status --short`
- remaining untracked files, if any
- remaining Low style debt
- confirmation no product semantics changed
- confirmation Viewer-native style alignment remains accepted
- G2/C6/C8 debt unchanged
- confirmation no retry/new record/reset/procedure change/G3 occurred
- exact next product-facing gate
