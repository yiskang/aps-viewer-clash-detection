# For Claude — Viewer Clash Panel Demo Evidence Reconciliation Checkpoint

I explicitly authorize one **small docs/evidence-only reconciliation checkpoint** before the next product-facing package.

The goal is to resolve two repository-consistency discrepancies from the latest demo-ready checkpoint:

1. Work/evidence review says there were **17 PNGs** with **16 PASS / 0 FAIL / 1 INCONCLUSIVE**, while checkpoint commit `396db3cabe9f21c662a4de68d7264c19c6d3964f` appears to contain only **16 snapshot PNGs**.
2. The reported remaining Low count is still `4`, but the warning-count wording Low was corrected before the checkpoint, so the durable post-checkpoint Low count may now be `3`.

This task is evidence/governance reconciliation only.

Do **not** change product behavior.
Do **not** rerun deep G2/C8 research.
Do **not** run G2 acceptance/live work.
Do **not** issue/reset authorization state.

---

## 1. Verify baseline

Verify:

- repo: `aps-viewer-clash-detection`
- branch: `main`
- `main == origin/main == 396db3cabe9f21c662a4de68d7264c19c6d3964f`
- `git status --short` is empty
- no untracked files
- historical G2/C6/C8 state unchanged

If baseline differs materially, stop and report.

---

## 2. Reconcile the snapshot count from repository evidence

Inspect and compare:

- latest independent Work visual/product review
- product-continuation evidence report
- snapshot index/list
- tracked PNG files under the product-continuation evidence directory
- commit `396db3c...` file list

Determine the exact authoritative reviewed set.

Specifically check whether:

`12-narrow-700.png`

or another PNG was part of the independent review but omitted from the checkpoint commit.

Do not guess from filename counts alone.

Produce an exact table:

| PNG | Present in evidence index | Reviewed by Work | Tracked in Git | Verdict |
|---|---|---|---|---|

for the complete reviewed set.

---

## 3. Branch A — reviewed PNG omitted from Git

If a PNG was genuinely part of the reviewed evidence and is still available byte-for-byte but was omitted from Git:

- add that exact reviewed PNG;
- do not regenerate or replace it;
- preserve its original filename;
- update snapshot index/count wording as necessary;
- verify it does **not** change the existing independent visual adjudication.

If adding the omitted image would materially change the responsive-overflow/framing adjudication, stop for independent Work review instead of silently checkpointing.

If it does not change adjudication, no new headed run is required.

---

## 4. Branch B — 17-count was a review/report counting error

If there was never a seventeenth reviewed PNG and the durable evidence set is correctly 16 files:

- do not create or regenerate an image;
- correct the review/evidence report/snapshot index wording so the count matches the actual reviewed set;
- preserve individual PASS/INCONCLUSIVE verdicts accurately.

Do not alter the substantive product verdict.

---

## 5. Preserve screenshot 13 / 13b semantics

Regardless of branch, preserve:

- screenshot `13` = `INCONCLUSIVE`
- screenshot `13b` = authoritative `PASS`

Do not rewrite history to make every retained capture PASS.

---

## 6. Reconcile the Low count

Inspect the latest independent review, evidence report, internal review, and handoff.

The four Lows previously reported were:

1. UUID fallback entropy
2. ~700 px responsive overflow
3. missing exact width assertion
4. understated Viewer warning count

The warning wording was corrected before commit `396db3c...`.

Determine the correct **current unresolved Low count**.

Expected likely result:

- `3` unresolved Lows, if Low 4 is fully closed by the committed documentation correction.

Do not mechanically change `4 → 3` unless the review artifacts support closure.

Update durable metadata/handoff wording so it distinguishes:

- findings from the independent review at review time;
- current unresolved post-remediation Low debt.

Preferred wording if supported:

> Independent review found 4 Low findings; the warning-count documentation Low was corrected before checkpoint, leaving 3 unresolved non-blocking Lows.

This avoids rewriting the historical review verdict.

---

## 7. Do not change product code

No changes are authorized to:

- Clash Panel source
- tests for product behavior
- sample wiring
- framing
- Viewer selection
- persistence
- responsive behavior
- UUID implementation

This checkpoint is docs/evidence reconciliation only.

---

## 8. Verification

Run:

- `git diff --check`
- exact file-count/list verification for the evidence directory
- any hash/file-existence checks needed to prove the reconciled snapshot set

Do **not** rerun headed validation unless the missing/extra snapshot materially affects the visual adjudication.

Do **not** rerun full product test suites unless an unexpected non-doc/evidence change is discovered.

---

## 9. Handoff update

Update `docs/handoffs/latest.md` concisely with:

- evidence-count reconciliation result
- exact final PNG count
- PASS/FAIL/INCONCLUSIVE count
- 13/13b semantics
- current unresolved Low count
- confirmation that product-facing verdict is unchanged
- G2/C6/C8 debt remains separate
- next gate: product-facing continuation based on governing artifacts

Do not duplicate the full review.

---

## 10. Commit and push

Create exactly one docs/evidence-only reconciliation commit.

Suggested semantic intent:

`reconcile Viewer Clash Panel demo evidence metadata`

Push to `origin/main`.

After push verify:

- `main == origin/main == <new commit>`
- ahead/behind `0/0`
- `git status --short` empty
- zero untracked files
- no product code changes
- no G2/retry/authorization/procedure/G3 changes

---

## 11. Stop gate

Stop after commit, push, and clean-tree verification.

Do not begin the next product package in this task.

---

## Final report

Report:

- whether Branch A or Branch B applied
- exact authoritative reviewed PNG count
- exact tracked PNG count after reconciliation
- PASS/FAIL/INCONCLUSIVE totals
- whether `12-narrow-700.png` was part of the reviewed evidence
- any PNG added or no PNG added
- historical independent-review Low count
- current unresolved Low count
- files changed
- new commit hash
- push result
- final `git status --short`
- confirmation no product code changed
- confirmation no G2 retry/new record/reset/procedure/G3 work occurred
- exact next product-facing gate
