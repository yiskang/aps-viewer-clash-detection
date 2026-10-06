# For Claude — Viewer Clash Panel Product-Facing Continuation II Checkpoint Commit + Push Only

I explicitly authorize **one scoped checkpoint commit and push** for the accepted Viewer Clash Panel Product-Facing Continuation II package.

Latest independent Work visual/product review:

- Critical: 0
- High: 0
- Medium: 0
- Low: 4 non-blocking
- Scope A: accepted
- readiness: **ready for product-facing checkpoint**

This task is checkpoint-only.

It does **not** authorize:

- additional product changes;
- fixing the remaining four Lows;
- G2 retry;
- new authorization record;
- attempt reset;
- acceptance-procedure changes;
- renewed G2/C8 causality research;
- G3/milestone transition;
- unrelated cleanup.

Use the repository as the source of truth.

---

## 1. Verify authoritative baseline

Before staging, verify:

- repo: `aps-viewer-clash-detection`
- branch: `main`
- HEAD:
  `b24a005d1a7fbe8b76172806a544898fa5aaa4b4`
- `main == origin/main`
- working tree contains only the reviewed Continuation II package/review/handoff/prompt changes
- `git diff --check` clean
- no unrelated modified/untracked files

Historical verification debt remains separate:

- G2: `FAIL (row 3)`
- C6: `NOT_EVIDENCED`
- C8: unresolved

Confirm no:

- G2 retry
- new authorization record
- attempt reset
- acceptance-procedure change
- G3 work

If baseline differs materially, stop and report.

---

## 2. Accepted Scope A state

Preserve these independently accepted product-facing results:

### Scope A
- Group None headed validation: PASS
- Group Element headed validation: PASS
- grouped-row actions:
  - Focus PASS
  - Isolate PASS
  - Markers PASS
  - Back to all PASS
- Soft-unavailable state with two models: PASS
- reachable headed empty/error-related states: accepted
- full Structure/Mechanical run remains:
  `491` clashes

### Regression fixes
- D1:
  stale `Enter a clearance for Soft mode.` message removed when Soft is unavailable
- D2:
  `(within its group)` suffix appears only when Prev/Next actually navigate within that group

Work independently verified both new regression tests:
- fail at baseline HEAD
- pass in working tree

Do not change these during checkpointing.

---

## 3. Accepted final verification

Preserve and verify:

### Offline suite
- total: `5,187`
- pass: `5,186`
- fail: `0`
- todo: `1 existing`

### DOM suite
- `83/83`

### Focused core suites
- `313/313`

### Visual evidence
- total PNGs: `22`
- current PASS: `21`
- current FAIL: `0`
- current INCONCLUSIVE: `0`
- superseded pre-fix FAIL: `1`
  - screenshot `04a`
- corrected authoritative screenshot:
  - screenshot `04`

Do not rewrite or delete `04a`; it remains historical pre-fix evidence.

---

## 4. Preserve the four remaining Low findings

Do not fix these in this checkpoint task.

The remaining non-blocking Lows are:

1. a filtered-away origin group can temporarily leave the `(within its group)` suffix visible, while navigation itself remains correct;
2. a multi-valued grouping note can appear over an empty filtered list;
3. `Idle · Ready to run` can coexist with `Not ready`;
4. `Completed · Completed` repeats wording.

Ensure the handoff preserves them accurately as non-blocking debt.

---

## 5. Preserve deferred coverage limitations

Do not silently upgrade these into blockers:

- Soft verified-basis headed run is unavailable because demo host has no `measurementBasis`;
- fault-injection hard-error states remain covered offline only;
- UUID fallback entropy remains deferred;
- ~700 px responsive overflow remains deferred;
- missing exact-width assertion remains deferred;
- tiny markers remain deferred;
- union framing remains accepted for v1;
- cross-reload persistence remains deferred;
- Viewer selection remains excluded per spec §9.2.

---

## 6. Inspect working tree

List and classify all modified and untracked files.

Expected in-scope categories:

### Source
- `clashpanel/core/viewModel.js`
- `clashpanel/core/controller.js`

### Tests
- `test/clashpanel/core/viewModel.test.mjs`
- `test/clashpanel/core/controller.navigation.test.mjs`
- any other focused tests that were part of the reviewed package

### Evidence
- `docs/research/2026-10-06-viewer-clash-panel-product-facing-continuation-ii/`
- evidence report
- all 22 PNGs

### Reviews
- Continuation II internal review
- independent Work visual/product review

### Handoff
- `docs/handoffs/latest.md`

### Related prompts
- Continuation II Claude prompt
- independent Work review prompt
- this checkpoint prompt if present

Do not stage unrelated files.

---

## 7. Protected-state verification

Before staging, confirm no changes to:

- historical authorization records
- immutable historical evidence
- accepted G2 procedure
- D2 checkpoint
- diagnostic-instrumentation checkpoint
- future live-diagnostic design/preparation checkpoint
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
- `5,187 total`
- `5,186 pass`
- `0 fail`
- `1 existing todo`

### DOM
Expected:
- `83/83`

### Focused core
Expected:
- `313/313`

### Diff
Run:
`git diff --check`

Expected:
clean.

Do not rerun headed validation unless implementation/evidence changed after Work review.

If there was no post-review product code change, use the independently reviewed headed evidence.

---

## 9. Verify evidence package

Confirm checkpoint includes:

- all `22` PNGs;
- evidence report;
- snapshot index;
- `04a` retained as superseded pre-fix FAIL;
- `04` retained as corrected authoritative PASS;
- Group None evidence;
- Group Element evidence;
- grouped-row actions evidence;
- Soft-unavailable evidence;
- headed empty/error-related evidence;
- 491-clash full-run evidence.

Do not omit evidence while committing implementation.

---

## 10. Handoff checkpoint state

Ensure `docs/handoffs/latest.md` accurately records:

- Scope A accepted for checkpoint;
- Critical 0 / High 0 / Medium 0 / Low 4;
- final-state tests:
  - offline `5186/5187 + 1 todo`
  - DOM `83/83`
  - core `313/313`
- visual evidence:
  - 21 current PASS
  - 0 current FAIL
  - 0 current INCONCLUSIVE
  - 1 superseded pre-fix FAIL (`04a`)
- D1/D2 closed;
- Group None/Element headed validation accepted;
- grouped-row actions accepted;
- Soft unavailable accepted;
- Soft verified-basis headed limitation remains;
- hard-error headed fault-injection remains deferred;
- the four remaining Lows are listed;
- G2/C6/C8 debt remains separate;
- no owner screenshot review required;
- next gate is based on governing artifacts; if no further product scope is authorized, stop rather than inventing one.

Do not add the future commit hash before the commit exists.

---

## 11. Stage only reviewed artifacts

Stage only:

- reviewed source changes
- reviewed tests
- reviewed evidence package
- internal review
- independent Work review
- related prompts
- latest handoff

Inspect staged file list and staged diff summary.

Confirm:

- no unrelated artifact
- no authorization-state change
- no acceptance-procedure change
- no G3 work
- no hidden verification-research change

Do not use broad staging if it risks unrelated files.

---

## 12. Commit

Create exactly **one scoped checkpoint commit**.

Suggested semantic intent:

`checkpoint Viewer Clash Panel product continuation II`

Use repository convention for exact wording.

After commit verify:

- only intended source/tests/docs/evidence/reviews/prompts/handoff entered the commit;
- no unrelated protected path entered the commit.

Report the full commit hash.

---

## 13. Push

Push the single commit to `origin/main`.

After push verify:

- `main == origin/main == <new commit>`
- ahead/behind `0/0`
- tracked tree clean
- no unexpected untracked durable artifacts
- G2/C6/C8 unchanged
- no authorization/procedure/G3 changes

---

## 14. Clean working tree requirement

Run:

`git status --short`

Target:

**completely empty**

Do not intentionally leave durable Markdown/evidence/review artifacts untracked.

If anything remains, list and explain it.

---

## 15. Prohibited

Do not:

- change product behavior during checkpointing
- fix the remaining 4 Lows
- add new Group By behavior
- add persistence
- add Viewer selection
- change framing semantics
- restart G2/C8 research
- run a new G2 acceptance attempt
- issue/reset authorization records
- alter acceptance procedure
- start G3
- perform unrelated cleanup

---

## 16. Stop gate

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
- focused core result
- retained visual-evidence summary
- 491 full-run confirmation
- final `git status --short`
- remaining untracked files, if any
- remaining four Low debts
- Soft verified-basis limitation preserved
- hard-error offline-only limitation preserved
- G2/C6/C8 debt unchanged
- confirmation no retry/new record/reset/procedure change/G3 occurred
- exact next product-facing gate
