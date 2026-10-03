# G2 final live-plan drift correction — focused internal review

- **Date:** 2026-10-03
- **Baseline:** `main` = `origin/main` = `7ae4147b726e20b8183f0522ffabf61ab75895d6`; harness SHA `d34d470c…9c39` and procedure SHA `d1ccfde2…5a75` unchanged.
- **Scope:** plan §9 step 0, G-15, baseline wording, preservation of the two-edit activation diff, consistency with the targeted independent re-review (M1/L1/L2). Docs-only.
- **Result:** 0 Critical / 0 High / 0 Medium / 1 Low (fixed).

## Changes (`docs/research/2026-10-02-g2-live-execution-plan.md`)
- **M1:** §9 step 0 rewritten as completed-and-accepted (`7ae4147`) / pending before flip / pending after flip. Coupled wording reconciled: §3 table, §3.1, §3.2, §8, §10 label, G-7, G-8 (closed), G-9 (closed), G-14, G-15, §12.
- **L1:** `g2-live-authorization.md` filename prohibition removed (§9 step 2 and step 4, G-15); untracked and sole-candidate requirements kept under their clean-tree/W1 rationale. No new precaution added.
- **L2:** header states H line refs are at `7ae4147` unless commit-qualified (symbol is authoritative); §1 rows and §10 label `996305c` values as historical.
- Two-edit activation diff (§9 steps 1a/1b), G-2, `build:vendor` note and Node `v22.23.1` prerequisite unchanged in meaning.

## Review (subagent, read-only; harness spot-checked)
- Harness supports the claims: `checkG2HardRuntimeGates` runs after W1 and before W2a; throwing/missing ownership probes set `cleanupUnresolvedOwnership=true`.
- No stale pending/not-implemented claims remain; no filename prohibition remains (line 6 is a changelog note only).
- **Low (fixed):** step 0 cross-referenced non-existent "§9.2"; changed to "§9 step 2".
- Notes: uncommitted-qualified `H:` refs in §5 and G-11 are covered by the §1 historical-baseline sentence.

`git diff --check`: clean. No scratch simulation rerun; no harness/test/procedure edits.
