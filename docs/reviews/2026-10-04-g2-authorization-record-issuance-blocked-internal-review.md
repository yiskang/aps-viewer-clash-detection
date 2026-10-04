# G2 authorization-record preparation/issuance — blocked at clean-tree gate (internal review)

- **Date:** 2026-10-04
- **Task:** `docs/prompts/for-claude-g2-authorization-record-preparation-issuance-only.md` (record preparation/issuance only)
- **Outcome:** **NO REAL RECORD ISSUED.** Blocked by the clean-tree gate. Nothing written under `docs/prompts/` as a record; no scratch record prepared (see "Why no scratch record").

## Verified baseline (all recomputed from repository, Node `v22.23.1`)

| Item | Expected | Recomputed |
| --- | --- | --- |
| branch / HEAD | `main` @ `7fe9c99b4d1aaf49c3996514132ccd54f9ff1ab0` | match; `== origin/main` |
| harness SHA-256 (`test/acceptance/clashpanel-viewerbridge.acceptance.mjs`) | `471fae40…77ac4` | match |
| procedure SHA-256 | `d1ccfde2…45a75` (also `ACCEPTED_PROCEDURE_SHA256`, harness :80) | match |
| `MODEL_A_URN` SHA-256 | `db7efe5c…dd10d` | match |
| `MODEL_B_URN` SHA-256 | `806f9996…ebb53d` | match |
| `LIVE_PATH_WIRED` / `G2_DUAL_COUNTER_GATE.resolved` | `true` / `true` | harness :119 / :3716 |
| Runtime | Node `v22.23.1`; `playwright`/`playwright-core` `1.62.1`; headless-shell rev `1234` / `151.0.7922.34` | match (`node -v`, `npm ls`, `browsers.json`, installed `chromium_headless_shell-1234` marker) |
| Existing `G2-LIVE-EXECUTION:` candidate under `docs/prompts/` | none | none |
| Attempts dir `test/acceptance/results/clashpanel-viewerbridge-g2-attempts` | absent | absent |

## Blocker (clean-tree gate)

Harness `classifyGitTreeState` (:7743-7762) allows only `??` entries whose path starts with `docs/prompts/`; every other porcelain entry is blocking. Procedure :134 and plan §4/§9 agree. Current `git status --porcelain --untracked-files=all`:

```
 M docs/handoffs/latest.md                                                  <- tracked modification: BLOCKING
?? docs/prompts/for-claude-g2-authorization-record-preparation-issuance-only.md   <- allowed
?? docs/reviews/2026-10-04-g2-committed-activation-identity-independent-verification.md  <- untracked outside docs/prompts/: BLOCKING
```

This task's own review and handoff update add further blocking entries. The clean-tree rule was not weakened.

## Why no scratch record

`Baseline-HEAD` must equal the run-time HEAD **after** every required commit (plan §4, §9 step 4). Resolving the blocker requires a separate docs checkpoint commit, which changes HEAD away from `7fe9c99…`. Any record prepared now would carry a stale `Baseline-HEAD` and would be invalid. The other bound values (procedure SHA, both URN SHAs, `Runtime:` line, harness SHA — harness unchanged unless the docs commit touches it, which it must not) are stable and verified above.

## Findings

- **Critical:** none. **High:** none. **Medium:** none.
- **Low (carried, non-blocking, not acted on):** stale pre-activation wording in plan/harness comments (from the independent verification). Out of scope; harness comments/plan not modified.
- **Process note (not a defect):** the issuance prompt's tracked-tree gate cannot pass while the verification review and handoff are uncommitted; a docs checkpoint is a prerequisite, as the prompt anticipated.

## Boundary check

No record issued; no attempts directory, reservation, journal, or `AUTH_BOUND`/`ATTEMPT_CONSUMED`; harness never executed; no Playwright/browser/Viewer/fixture; no commit; no push. All checks used `shasum`, `grep`, `sed`, `git`, `npm ls`, and a pure `node -e` SHA computation over harness source text.

## Next required owner action

Authorize one docs-only checkpoint commit (+ push) containing the 2026-10-04 verification review, this review, the issuance prompt, and the handoff. Then, with the tree clean and HEAD recomputed, authorize record issuance again (bind the new HEAD).
