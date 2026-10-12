# Final Report — Post-Checkpoint HV-2 Documentation / Evidence-Tooling Cleanup (2026-10-12)

## 1. Repository state (pre-edit verification)
- Repo `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`, branch `main`, HEAD `9dbf47ad80d32de246cca1f19f116910f3040d4d` (`test(clash-panel): complete CTM-8 rebuild-cost calibration`) == `origin/main` (after `git fetch`), 0/0.
- Pushed CTM-8 checkpoint present on `origin/main`: `9dbf47a`. Not amended, reset or force-pushed.
- Pre-edit working tree: only `?? docs/prompts/ctm8-post-checkpoint-hv2-docs-evidence-tooling-cleanup-prompt.md` (the task prompt).
- Read: `CLAUDE.md`, `docs/handoffs/latest.md` (head + HV-2 entries), HV-2 final report, HV-2 Independent Work Review (L1/L2), protocol `CTM8-P0-v4` §9.4, headed README HV-2 observation, `test/calibration/ctm8/headed/hv2-adjudication.js`.

## 2. Authorized scope
Docs/evidence-tooling cleanup only, three items (HV-2 future check, checksum count 37→38, pre-Focus containment). Governing: owner prompt `docs/prompts/ctm8-post-checkpoint-hv2-docs-evidence-tooling-cleanup-prompt.md`. No product remediation, no calibration rerun, no CTM-8 reopening.

## 3. Delivered
1. **Future HV-2 check definition** — [guidance note](2026-10-12-ctm-8-hv2-future-check-and-evidence-guidance.md) §1–§2: historical predicate ("camera differs from pre-state") declared invalid as a correctness requirement; future check requires a discriminating pre-state (displace-first, or Focus-on-select off), verifies fit dispatch + finite camera at fitted pose F + aggregate participant bounds framed, requires movement only when the pre-pose is not already F, and treats idempotent Focus as valid; an already-fitted pre-state is `INCONCLUSIVE`, not `FAIL`. The accepted protocol `CTM8-P0-v4` was **not** edited (governing artifact); the note states that it governs any future HV-2 run.
2. **Checksum-count correction** — [correction note](2026-10-12-ctm-8-hv2-checksum-count-correction.md): count is **38**, not 37; all 38 verified OK (re-run: 38 OK / 0 failed; `checksums.sha256` has 38 lines). Upstream report and Independent Work Review preserved unchanged; no pointer edit made in the upstream report.
3. **Future pre-Focus containment capture** — guidance note §3: containment captured and labelled `containmentPreFocus` before the click and `containmentPostFocus` separately after, each with explicit phase/settled/source/mark labels; post-click-computed pre-samples invalidate the scenario; no retroactive backfill. Tooling disposition (§3.1): `hv2-adjudication.js` is a historical, runtime-injected one-shot helper with no retained driver or unit test, so it was **left unchanged**; a labelled-capture wrapper plus test is specified for any future package that retains/re-versions it.

## 4. Files changed/added (docs only)
- `docs/research/2026-10-12-ctm-8-hv2-future-check-and-evidence-guidance.md`
- `docs/research/2026-10-12-ctm-8-hv2-checksum-count-correction.md`
- `docs/research/2026-10-12-ctm-8-hv2-documentation-evidence-tooling-cleanup-final-report.md` (this report)
- `docs/handoffs/latest.md` (new LATEST section; prior LATEST relabelled `(prior)`)
- Untracked task prompt `docs/prompts/ctm8-post-checkpoint-hv2-docs-evidence-tooling-cleanup-prompt.md` pre-existed.

## 5. Verification (exact results in §9)
See §9 — `git diff --check`, changed-path limits, protected-path diff, `38`/`37` grep, future-check and pre/post-Focus wording checks.

## 6. Protected boundaries confirmed unchanged
- Historical CTM-8 raw calibration evidence, historical HV-2 9/9 evidence, HV-2 targeted evidence: **preserved, unmodified**.
- Prior Independent Work Reviews and the HV-2 upstream final report: **preserved, unmodified**.
- Protocol `CTM8-P0-v4`, specs/plans: unmodified.
- **No calibration, headless campaign or HV-2 evidence was rerun** (only `shasum -c` on the existing checksum manifest).
- **No production code changed**; no test or `test/calibration/ctm8/` file changed.
- No performance conclusion, limit, budget or scalability claim changed or made.

## 7. Internal review / unresolved
No internal Codex review loop was run (docs-only, narrow, no architectural change); remaining items are none beyond the deferred tooling note in guidance §3.1 (no active code was changed, so no wrapper/test was added). The accepted non-blocking residual HV-2 L1/L2 are now documented as corrected (L1) and as a future requirement (L2).

## 8. Commit / push state
**Nothing committed or pushed.** Commit/push is not authorized until after the independent review.

## 9. Verification results
- `git diff --check`: clean (rc 0).
- Final `git status --short`: ` M docs/handoffs/latest.md`; `?? ` the pre-existing task prompt plus the three new `docs/research/` files. Tracked diff = `docs/handoffs/latest.md` only; 0 paths under `src/`, `test/`, `docs/reviews/`, `docs/research/evidence/`; no protocol/spec/plan or upstream report touched.
- Checksum manifest: 38 lines, `shasum -a 256 -c` → 38 OK, 0 failed. Correction note states `38`; its only `37` mentions are the quoted superseded value.
- Future HV-2 guidance: movement required only when pre-pose is not already F (§2.2.4); idempotent Focus valid (§2.3); already-fitted pre-state = INCONCLUSIVE.
- Guidance §3: `containmentPreFocus` / `containmentPostFocus` explicit and separate.
- Branch `main`, HEAD `9dbf47a`, == `origin/main`, nothing committed.

## 10. Exact next gate
**Independent Work review of this post-checkpoint HV-2 documentation/evidence-tooling cleanup package** (Work authors `docs/reviews/<date>-…-independent-work-review.md`). Not authorized without owner direction: commit/push, any HV-2 rerun, tooling code change, CTM-8 reopening, product remediation, new milestone.
