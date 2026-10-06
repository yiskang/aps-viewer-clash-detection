# For Claude — Viewer Clash Panel Product Continuation Checkpoint Commit + Push Only

I explicitly authorize **one scoped checkpoint commit and push** for the accepted Viewer Clash Panel product-continuation package.

Latest independent Work visual/product review:

- Critical: 0
- High: 0
- Medium: 0
- Low: 4 non-blocking
- readiness: **ready for product-facing checkpoint**

Accepted final verification:

- Offline: `5,185 total / 5,184 pass / 0 fail / 1 existing todo`
- DOM: `83/83`
- Focused extension/host: `23/23`
- Headed run: `491` clashes
- Snapshot result: `16 PASS / 0 FAIL / 1 INCONCLUSIVE` across `17` PNGs
- screenshot `13b` supersedes screenshot `13`
- console: `0` errors
- Viewer-origin deprecation warnings include `getInstanceTree` and `getAecModelData`

Historical verification debt remains separate:

- G2: `FAIL (row 3)`
- C6: `NOT_EVIDENCED`
- C8: unresolved

This task is checkpoint-only. It does not authorize further product changes, G2 retry, new authorization record, attempt reset, acceptance-procedure changes, renewed C8 causality research, G3, or unrelated cleanup.

## 1. Verify baseline

Before staging, verify:

- repo: `aps-viewer-clash-detection`
- branch: `main`
- HEAD: `d45703f21b9001bd8114fbf0fcbc7263e5046cb1`
- `main == origin/main`
- working tree contains only the reviewed product-continuation package/review/handoff/prompt changes
- `git diff --check` clean
- no unrelated modified/untracked files

If baseline differs materially, stop and report.

## 2. Preserve accepted adjudications

Do not alter during checkpointing:

- all L1–L11 are closed or reduced to non-blocking debt
- `394` vs `472` partial count is valid asynchronous cancellation variability
- no exact partial count is contractual
- screenshot `13` = INCONCLUSIVE
- screenshot `13b` = authoritative PASS

Remaining Low debt:

1. UUID fallback entropy
2. ~700 px responsive overflow
3. missing exact width assertion
4. evidence report understated Viewer warning count

Product decisions:
- framing acceptable for v1
- Viewer selection excluded by spec §9.2
- cross-reload persistence deferred

## 3. Warning wording

Work independently observed both `getInstanceTree` and `getAecModelData` Viewer-origin deprecation warnings.

If the reviewed working tree already contains the corrected evidence-report/handoff wording, stage it.

If a new text edit is still required after Work review, stop and report rather than silently introducing an unreviewed change during checkpointing.

## 4. Inspect working tree

List and classify all modified/untracked files.

Expected in-scope categories:

- product code: Clash Panel continuation fixes
- tests: extension/host/DOM/focused regressions
- evidence:
  `docs/research/2026-10-06-viewer-clash-panel-product-continuation/`
- reviews: internal + independent visual/product review
- `docs/handoffs/latest.md`
- related prompts, including this checkpoint prompt if present

Do not stage unrelated files.

## 5. Protected-state verification

Confirm no changes to:

- historical authorization records
- immutable historical evidence
- accepted G2 procedure
- D2 checkpoint
- diagnostic-instrumentation checkpoint
- future live-diagnostic design/preparation checkpoint
- unrelated product features
- G3 work

Also confirm no G2 retry, no new authorization record, no attempt reset, no acceptance-procedure change, and no renewed deep G2/C8 causality work.

## 6. Final verification before staging

Run:

- offline suite → expect `5,185 total / 5,184 pass / 0 fail / 1 existing todo`
- DOM suite → expect `83/83`
- focused extension/host tests → expect `23/23`
- `git diff --check` → clean

Do not rerun headed validation unless implementation/evidence changed after Work review.

If there was no post-review implementation change, use the independently reviewed headed evidence.

## 7. Verify evidence package

Confirm the checkpoint includes:

- all 17 PNGs
- evidence report
- snapshot index
- screenshot 13 marked INCONCLUSIVE
- screenshot 13b marked authoritative PASS
- 491 full-run evidence
- partial-stop evidence
- visual states used by Work review

Do not omit evidence while committing implementation.

## 8. Handoff checkpoint state

Ensure `docs/handoffs/latest.md` records:

- product-continuation package accepted for checkpoint
- 0 Critical / 0 High / 0 Medium
- 4 non-blocking Lows
- final-state test results
- `16 PASS / 0 FAIL / 1 INCONCLUSIVE` across 17 PNGs
- 13b supersedes 13
- 491 full-run result
- partial count timing-dependent/non-contractual
- console had 0 errors
- Viewer-origin warnings include both `getInstanceTree` and `getAecModelData`
- framing v1 accepted
- Viewer selection excluded per §9.2
- reload persistence deferred
- G2/C6/C8 debt separate and unchanged
- next gate is product-facing continuation based on governing artifacts, not renewed causality research

Do not add the future commit hash before the commit exists.

## 9. Stage only reviewed artifacts

Stage only:

- reviewed product code
- reviewed tests
- reviewed evidence package
- reviewed internal/independent reviews
- related prompts
- latest handoff

Inspect staged file list and diff summary.

Confirm no unrelated artifact, no authorization-state change, no acceptance-procedure change, no G3 work, and no hidden verification-research change.

## 10. Commit

Create exactly one scoped checkpoint commit.

Suggested semantic intent:

`checkpoint Viewer Clash Panel product continuation`

Use repository convention for exact wording.

After commit verify only intended product/tests/docs/evidence/reviews/prompts/handoff entered the commit.

Report full commit hash.

## 11. Push

Push the single commit to `origin/main`.

After push verify:

- `main == origin/main == <new commit>`
- ahead/behind `0/0`
- tracked tree clean
- no unexpected untracked durable artifacts
- G2/C6/C8 unchanged
- no authorization/procedure/G3 changes

## 12. Clean working tree requirement

Run:

`git status --short`

Target: **completely empty**

Do not intentionally leave durable Markdown/evidence/review artifacts untracked.

If anything remains, list and explain it.

## 13. Prohibited

Do not:

- change product behavior during checkpointing
- fix the remaining 4 Lows
- change framing semantics
- add Viewer selection
- add cross-reload persistence
- restart G2/C8 research
- run a new G2 acceptance attempt
- issue/reset authorization records
- alter acceptance procedure
- start G3
- perform unrelated cleanup

## 14. Stop gate

Stop immediately after one commit, one push, post-push verification, and a clean working tree.

Do not begin another package in this task.

## Final report

Report:

- new checkpoint commit hash
- exact files committed
- push result
- final `main` / `origin/main` relation
- offline result
- DOM result
- focused extension/host result
- retained visual evidence summary
- 491 full-run confirmation
- partial cancellation behavior confirmation
- final `git status --short`
- remaining untracked files, if any
- remaining 4 Low debts
- framing v1 decision preserved
- Viewer-selection §9.2 decision preserved
- reload-persistence deferment preserved
- G2/C6/C8 debt unchanged
- confirmation no retry/new record/reset/procedure change/G3 occurred
- exact next product-facing gate
