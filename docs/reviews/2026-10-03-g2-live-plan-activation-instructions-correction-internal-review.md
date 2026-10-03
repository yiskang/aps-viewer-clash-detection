# G2 live-plan activation-instructions correction — focused internal review

- **Date:** 2026-10-03 · **Baseline:** `main` @ `7ae4147b726e20b8183f0522ffabf61ab75895d6` (`== origin/main`).
- **Authority:** [`docs/prompts/for-claude-g2-live-plan-activation-instructions-correction-only.md`](../prompts/for-claude-g2-live-plan-activation-instructions-correction-only.md) (docs-only; remediates M1/L1/L2 of the [independent review](2026-10-03-g2-live-flag-activation-preparation-independent-review.md)).
- **Changed:** only `docs/research/2026-10-02-g2-live-execution-plan.md` (§1 interlock row and provisional-hash note, §9 intro and steps 1-2 and 4, §6.4f, §11 G-2/G-15, §12 item 2), the wording of the prior internal review (default-shell Node), this review, and the handoff. No harness/test/procedure/production file touched.
- **Result:** **0 Critical / 0 High / 0 Medium / 1 Low.**

## Corrections made

1. **§9:** future activation is stated as exactly two edits: harness `const LIVE_PATH_WIRED` `false→true`, and the single `PIN (single, deliberate)` test in `live-path-isolation.test.mjs` → `true`. The ~20-suite list is removed; the simulation (903/903 focused, 5,149/5,148/0/1 aggregate) is recorded as showing the existing activation/pinning migration sufficient.
2. **G-2 / G-15:** disproved wording replaced. G-2 keeps the still-true requirement of a committed harness. G-15 is downgraded to Low and withdrawn as stated (CLI uses isolated temp-root copies, static guards, no real validation, fixtures isolated). Only the pre-existing record-naming/untracked/sole-candidate precaution is retained; no new hazard was invented. The unsupported "do not run `npm test` while a record exists" sentence was dropped (not supported by current tests).
3. **Source references:** `H:118`/`H:3463` replaced by constant name plus "line at `7ae4147`" (`H:119`, `H:3716`).
4. **`build:vendor`:** documented in §9 as ordinary fresh-archive test setup, explicitly not an activation/runtime/live dependency.
5. **Node:** §6.4f now requires `nvm use 22.23.1` then `node -v` == `v22.23.1` in fresh shells (default may be Homebrew `v26.10.0`); hard gate stays authoritative before reservation/import. Prior internal review wording corrected (L2).
6. No accepted semantics touched (hard gates, browser root, T-same-target, cleanup/PARTIAL, redaction, schema, record semantics, executable-SHA, attempt semantics, `browser.version()`, verdict mapping).

## Findings

| # | Sev | Finding | Disposition |
| --- | --- | --- | --- |
| L1 | Low | Prior handoff sections (superseded history) still contain the old "~20 pinning tests" wording. | Left as dated history; the LATEST handoff section and governing plan are corrected. |

## Verification (non-live)

`git diff --check` clean; grep shows the only remaining `~20`/"whole suites" strings are the explicit withdrawal statements in G-2/§9; plan names the exact two-file diff; Node wording matches the hard gate (`v22.23.1`, strict equality). Harness and procedure SHAs unchanged; `LIVE_PATH_WIRED=false`; no record, attempts directory, Viewer/fixture, or live G2.

**Verdict:** ready for targeted independent Work re-review. Real activation remains **unauthorized**.
