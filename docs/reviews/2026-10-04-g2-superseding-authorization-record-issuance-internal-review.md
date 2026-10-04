# G2 superseding authorization-record issuance — internal review

- **Baseline:** `main == origin/main == 8a8d49f6293e9be1bd858ed76ad991319c1e9f8c`; tracked tree clean before issuance; Node `v22.23.1`, playwright/playwright-core `1.62.1`, headless-shell `1234`.
- **Outcome:** SUCCESS. One new record issued; exactly one active candidate; old record preserved byte-identical.
- **Reviewer:** controller self-review plus a read-only subagent analysis of discovery/supersession (claims re-verified by the controller against `test/acceptance/clashpanel-viewerbridge.acceptance.mjs:513–523, 527–530, 663–686` and procedure §4.1).

## Supersession semantics (native, verified)
- Candidate = any regular `*.md` under `docs/prompts/` (recursive) with a line starting `G2-LIVE-EXECUTION:`. No status field, no ignored archive directory.
- A candidate is superseded iff another candidate has `Supersedes: <its ID>`; passing a superseded record gives `record-superseded`; live count must be exactly 1 (`candidate-set-ambiguous` otherwise). Old file need not be moved or edited.

## Identities (recomputed, not invented)
- HEAD `8a8d49f6293e9be1bd858ed76ad991319c1e9f8c`; harness `471fae40d371c292f05d92bbdafdbdaa426a0426af0924a6e0946ac69fe77ac4`; procedure `d1ccfde224b8ae76fe74b06c93abc532e6df9612933cafaa045053c8e2e45a75` (= `ACCEPTED_PROCEDURE_SHA256`).
- Model A URN SHA `db7efe5c237b10757c8e69fbb925facd9a1bf43c307a60702ae42fa2968dd10d`; Model B `806f99964bb937085874557ec2b03101a612db26031469a063446796d7ebb53d`; runtime `viewer=7.124.2 env=AutodeskProduction2 api=streamingV2`.

## Records
- Old (historical, superseded): `g2-live-20261004-dbd97137`, SHA `0f339d964794ceb54d84e3a3c13d1655cce6aac2b9796cf4c4deb3c243baa4ae` — unchanged, untracked, not staged.
- New: `g2-live-20261004-8a8d49f6`, `docs/prompts/g2-live-execution-authorization-record-g2-live-20261004-8a8d49f6.md`, SHA `b520bc712fbf85ad848a234e0472c3f6da9f0fa724c9fe8682c657dc759db461`, `Supersedes: g2-live-20261004-dbd97137`.

## Static verification (read-only; real harness not run)
- Read-only `validateAuthorizationRecord` (file reads + `git rev-parse` only): new record `ok:true`, candidate set `[new: superseded=false, old: superseded=true]`; old record → `record-superseded`.
- Exactly one active candidate; no attempts directory; no reservation/journal; no browser/Viewer/fixture/live evidence; no commit/push.

## Findings
- **Critical / High: none.**
- **Medium M1 — tree dirtiness (same class as prior review):** this review and the handoff edit leave `M docs/handoffs/latest.md` and `?? docs/reviews/…`, which Phase 0's clean-tree rule (only untracked `docs/prompts/` allowed) rejects; running live now would spend the record at `AUTH_BOUND` then fail `git-tree`. Committing them changes HEAD and invalidates the record's `Baseline-HEAD`. Owner must define a terminal sequencing rule before any live run (e.g. keep these docs out of the tree at run time, or re-issue after a docs checkpoint) — no tooling change needed to the record.
- **Low L1 — fragility:** any other `docs/prompts` file with a line starting `G2-LIVE-EXECUTION:` (even quoted) or any later edit to the old record makes discovery reject (`candidate-malformed` / ambiguous). Keep prompt docs free of marker-prefixed lines.
- **Low L2 — accidental-consumption risk:** none found; only the read-only validator was invoked. A live-run interlock still needs `--execute-live-g2`, `G2_LIVE_AUTHORIZED=YES`, and the record flag, none supplied.

## Next gate
Independent Work verification of the superseding record → separate explicit owner authorization of exactly one live G2 execution.
