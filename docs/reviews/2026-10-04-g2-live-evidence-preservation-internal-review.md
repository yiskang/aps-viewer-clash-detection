# G2 live-evidence preservation — focused internal review

Scope: preservation operation only (`docs/research/evidence/g2-live-20261004-75a3ccb9/`); G2 findings (C3/C8/C6) not reinterpreted.
Reviewer: read-only Claude subagent, independent recomputation of hashes. Findings: **0 Critical / 0 High / 0 Medium / 0 Low**.

| Area | Result |
| --- | --- |
| Completeness | All 6 files under `test/acceptance/results/clashpanel-viewerbridge-g2-*` (R1, R2, R3, reservation, journal, K) and all 3 files in `/private/tmp/claude-501/g2/` preserved, plus the authorization record. |
| Hash equality | 10/10 source = destination SHA-256 (also `cmp`); MANIFEST hashes/paths accurate. |
| Operator log | `g2-live.log` byte-identical (1390 B, sha `e973a356…8c05`); sources still present. |
| Manifest accuracy | HEAD, auth SHA, harness SHA, procedure SHA, attempt ID, journal timestamps, verdict, exit code, "O2 absent" all verified. |
| Authoritative vs supporting | Clearly labelled; R2 and logs marked non-authoritative. |
| Mutation risk | None (`cp -p`; sizes and `cmp` match). |
| Repo state | No source/test/procedure/production file changed; `git diff --check` clean. |

Observation (not a defect): authorization records `8a8d49f6` and `dbd97137` are out of scope and not copied.
