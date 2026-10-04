# G2 live evidence preservation manifest

- Authorization ID: `g2-live-20261004-75a3ccb9`
- Final authorization record SHA-256: `f68436dfbab09ad32a2ba248cf6ab63ce652b5615e82f8232f77aae9409c33c6`
- Committed HEAD at attempt: `75a3ccb9ba160f8afcf3c9b39a301f352b273c08`
- Harness SHA-256 (`test/acceptance/clashpanel-viewerbridge.acceptance.mjs`): `471fae40d371c292f05d92bbdafdbdaa426a0426af0924a6e0946ac69fe77ac4`
- Procedure SHA-256 (v5): `d1ccfde224b8ae76fe74b06c93abc532e6df9612933cafaa045053c8e2e45a75`
- Attempt ID / reservation ID: `59b8713d-1e63-4df8-b641-ac6b830f3ea6`
- Attempt time (journal, UTC): AUTH_BOUND 2026-10-04T03:28:57.547Z; ATTEMPT_CONSUMED 03:29:00.172Z; CLOSEOUT_STARTED 03:29:15.718Z; K committedAt 03:29:15.913Z
- Final terminal verdict: `FAIL (row 3)` (primaryOverall FAIL, primaryRow 3, finalOverall FAIL)
- Operator-log exit code evidence: `EXIT=1` (g2-live.exit), `exit code: 1` (g2-live.log)

## Preserved files

Paths relative to this directory. Each was copied byte-for-byte (`cp -p`); source and destination SHA-256 were computed and asserted equal at copy time.

| Preserved path | Original source path | SHA-256 | Role |
|---|---|---|---|
| `R1-clashpanel-viewerbridge-g2-result.json` | `test/acceptance/results/clashpanel-viewerbridge-g2-result.json` | `4204e2d36c9053db8e6601952bc79b27bbf903998637b81bde6bc8dcf2e42148` | authoritative raw evidence (R1; contains C1–C20 records (C20 blocked, never ran), N1–N8, cleanup, ledgers, runtime/fixture/Viewer identity) |
| `R2-clashpanel-viewerbridge-g2-summary.md` | `test/acceptance/results/clashpanel-viewerbridge-g2-summary.md` | `5282f01c82c404cf8e39cf68fbf55288bac8509fb6b9adf6fb499f68d71d0da4` | generated summary (R2; non-authoritative rendering) |
| `R3-clashpanel-viewerbridge-g2-closeout.json` | `test/acceptance/results/clashpanel-viewerbridge-g2-closeout.json` | `8de72bb0c6cf5883ad5bdd96ffe06a0d8c4c6fd769ee8984865c412a804728f0` | authoritative raw evidence (R3 closeout manifest) |
| `attempts/g2-live-20261004-75a3ccb9.reservation.json` | `test/acceptance/results/clashpanel-viewerbridge-g2-attempts/g2-live-20261004-75a3ccb9.reservation.json` | `ee513025dc2a8bb04d9f15bd15d3e5f31d814464d34edf5f355ada09507d06d2` | authoritative raw evidence (attempt reservation) |
| `attempts/g2-live-20261004-75a3ccb9.journal.json` | `test/acceptance/results/clashpanel-viewerbridge-g2-attempts/g2-live-20261004-75a3ccb9.journal.json` | `0486d39547a9854c849ebb13b014bf3c286ef9078f0b4ed405efbf87c2bf352c` | authoritative raw evidence (attempt journal) |
| `attempts/g2-live-20261004-75a3ccb9.commit.json` | `test/acceptance/results/clashpanel-viewerbridge-g2-attempts/g2-live-20261004-75a3ccb9.commit.json` | `3b5b2777d8dc088852fb41a520817bbb023909138da2c26baf9748e6e993ad63` | authoritative raw evidence (K terminal commit record) |
| `operator-log/g2-live.log` | `/private/tmp/claude-501/g2/g2-live.log` | `e973a356220292e1d672973f9a97cc28be2193dd9faeab53f92f71b1b71b8c05` | copied operator log (non-authoritative per procedure) |
| `operator-log/g2-live.exit` | `/private/tmp/claude-501/g2/g2-live.exit` | `4bf4fca02e6eeaf7f1c510b82c756e7f8a3c567a230bae1094b254adc774f38b` | copied operator log companion (exit status; non-authoritative) |
| `operator-log/server.log` | `/private/tmp/claude-501/g2/server.log` | `5194dcee3eb982a3d8cff3c4a9a3723bbdd930576911697ea6e4450438a749bf` | copied operator log companion (local server output; non-authoritative) |
| `governance/g2-live-execution-authorization-record-g2-live-20261004-75a3ccb9.md` | `docs/prompts/g2-live-execution-authorization-record-g2-live-20261004-75a3ccb9.md` | `f68436dfbab09ad32a2ba248cf6ab63ce652b5615e82f8232f77aae9409c33c6` | supporting governance artifact (authorization record; untracked in repo, copied here) |

## Operator log

Original path: `/private/tmp/claude-501/g2/g2-live.log` (volatile `/private/tmp`). Still present at preservation time. Source SHA-256 before copy = destination SHA-256 after copy = `e973a356220292e1d672973f9a97cc28be2193dd9faeab53f92f71b1b71b8c05`. Contents not edited.

## Missing artifacts

- O2 (optional): absent in the original attempt (R3 `optional` records `O2: absent`); not invented.
- `operator-log/g2-live.exit` exists at source and is preserved as a distinct file (contents `EXIT=1`; non-authoritative exit-status companion to `g2-live.log`). No separate Phase-0 artifact exists; none was created.
- C20 was `BLOCKED(dependency:C8)` and never ran; no rendering/screenshot evidence existed at source (R1 `screenshots:[]`, `c20:null`), and none was lost during preservation.

## References (not copied)

- `docs/reviews/2026-10-04-g2-live-evidence-verdict-independent-review.md` (Work independent review)
- `docs/reviews/2026-10-04-g2-exactly-one-live-execution-internal-review.md` (Claude internal live review)
- `docs/handoffs/latest.md`

Git note: `.gitignore` carries exact-path negations so `operator-log/g2-live.log` and `operator-log/server.log` (otherwise matched by `*.log`) are stageable.

**No preserved evidence file was modified or normalized during preservation.**
