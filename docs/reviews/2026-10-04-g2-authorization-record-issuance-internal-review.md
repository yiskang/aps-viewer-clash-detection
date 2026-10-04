# G2 authorization-record issuance (retry) — internal review

- **Date:** 2026-10-04. **Prompt:** `docs/prompts/for-claude-g2-authorization-record-issuance-retry-only.md`.
- **Outcome:** exactly one real record **issued**. No attempt reserved/consumed; harness never executed.

## Issued record

- **Path:** `docs/prompts/g2-live-execution-authorization-record-g2-live-20261004-dbd97137.md` (untracked; filename carries no production semantics)
- **Authorization-ID:** `g2-live-20261004-dbd97137`
- **Record SHA-256:** `0f339d964794ceb54d84e3a3c13d1655cce6aac2b9796cf4c4deb3c243baa4ae` (reread from disk; byte-identical to the scratch candidate)
- **Schema:** the accepted 8-marker schema (plan §4; harness `AUTHORIZATION_MARKERS`), no optional fields (`Supersedes`, `issuedAt`, `expiresAt`, version) and no schema expansion. A free-text scope note (not beginning with any marker key) states issuance-only scope.
- **Bound:** Baseline-HEAD `dbd97137a53890c43a5b89010a73f3dc39f0dc67`; harness `471fae40…77ac4`; procedure `d1ccfde2…45a75`; Model A URN SHA `db7efe5c237b10757c8e69fbb925facd9a1bf43c307a60702ae42fa2968dd10d`; Model B URN SHA `806f99964bb937085874557ec2b03101a612db26031469a063446796d7ebb53d`; `Runtime: viewer=7.124.2 env=AutodeskProduction2 api=streamingV2`. Command identity is not a record field (plan §4, G-3); Node/Playwright/Chromium pins are bound via `Harness-SHA256`.
- **Runtime used:** Node `v22.23.1`; playwright/playwright-core `1.62.1`; headless-shell `1234` / `151.0.7922.34`.

## Verification (static, read-only)

- Pre-issuance tree: only `?? docs/prompts/for-claude-g2-authorization-record-issuance-retry-only.md` (allowed by `classifyGitTreeState`).
- Candidate validated in scratch, then written once with no-clobber; re-validated from the issued path with an independent script that re-implements the harness regexes and W1 digest checks (the real harness was **not** imported or run): all markers once, HEAD == `git rev-parse HEAD`, procedure/harness/URN SHAs recomputed from repo bytes, procedure == `ACCEPTED_PROCEDURE_SHA256`.
- Sole candidate: exactly one file under `docs/prompts/` with a `G2-LIVE-EXECUTION:` line; no `Supersedes`; discovery = recursive regular `*.md` under `docs/prompts/`, filename arbitrary, no forbidden-name rule.
- `test/acceptance/results/clashpanel-viewerbridge-g2-attempts` absent; no reservation/journal; no Viewer/fixture/live evidence.

## Findings

- **Critical / High: none.**
- **Medium M1 (governance sequencing, no code change needed):** this task's own review and handoff edit leave the tree dirty (`M docs/handoffs/latest.md`, `?? docs/reviews/…`), which the harness clean-tree rule (Phase 0 `git-tree`) rejects *after* the record is spent at `AUTH_BOUND`. Committing them changes HEAD and invalidates `Baseline-HEAD`. Before any live run the owner must choose: (a) revert the handoff edit and relocate/remove the review so only `docs/prompts/` untracked files remain (preserving the issued record's HEAD), or (b) commit the docs and have a new record issued against the new HEAD (with `Supersedes`/removal of this one). Do not start live execution with the tree as it stands.
- **Low (carried, non-blocking):** stale pre-activation wording in plan/harness comments; not touched.
- **Low L2:** the retry prompt itself is an untracked `docs/prompts/` file (allowed). Per plan G-16 it contains no line beginning `G2-LIVE-EXECUTION:` (verified).

## Boundary

Issuance crossed no execution boundary: no W1-onward harness invocation, no runtime gates, no directory creation, no reservation, no `AUTH_BOUND`/`ATTEMPT_CONSUMED`, no Playwright/browser/Viewer/fixture, no commit, no push. Exactly-one live execution remains separately unauthorized.
