# Internal review — G2 D0/D1 final wording correction

- **Artifact:** [research](../research/2026-10-04-g2-d0-viewer-api-evidence-d1-r1-replay.md)
- **Authority:** owner prompt `docs/prompts/for-claude-g2-d0-d1-final-wording-correction-only.md`, correcting M1/L1/L2 of the [targeted independent re-review](2026-10-04-g2-d0-d1-corrected-targeted-independent-rereview.md).
- **Reviewer:** Codex (`codex-review spec`, medium), request `20261004-180011-54171-24096`. One focused pass; the reviewer treated the file as a would-be D2 implementation contract, so several findings are out of this task's scope.

## Required corrections

| Item | Result |
|---|---|
| M1 §10 historical overclaim | Done. §10 now separates geometric similarity, pattern consistency, and the unproved items (N2 examined C6's result; C6/N2 one stale sequence; `resetHome()` success). "Freshly reset", "stale sequence", "examined C6's result", "is the result of" removed; §8 phrase "identified as C6's result" and the unsupported "13–27-unit field" statement for B:111 removed/qualified; the "mid-transition capture rejected" sentence narrowed to the one reconstructed hypothesis; §12 rows reworded as compatible-with/unproved. |
| L1 "any cwd" | Done. Command labelled "shown from the repository root"; the scripts are cwd-independent only when invoked by absolute path (`<REPO_ROOT>` must be known). Docs-only; scripts unchanged. |
| L2 "checked in (uncommitted)" | Done. Replaced with "present in the working tree (uncommitted, untracked)". Remaining "checked in" uses refer to committed evidence/harness or to the Viewer bundle being *not* checked in. |
| Earlier correction review "M1 done" | Reconciled to "partly done; residue closed here". |

## Codex findings

| # | Sev. (as reported) | Finding | Disposition |
|---|---|---|---|
| C1 | Critical | No implementable D2 contract | **Rejected as out of scope / not a defect.** The artifact is research and already requires a separately authorized D2 spec; it is not offered as an implementation contract. |
| C2 | High | Implementation gate circular; "implementation" ambiguous | **Deferred to the D2 spec.** Noted for the owner: separate simulator specification, offline simulator, diagnostic instrumentation/live run, and T4/harness remediation gates. Not changed here (scope). |
| C3 | High | Completion described as universal in the D2 model | **Accepted, fixed.** "One completion event" limited to a normal animated completion; per-outcome emission is a D2-spec requirement. |
| I1 | Medium | Historical vs current harness not reconciled | **Accepted, fixed.** Both revisions recorded; unchanged-range statement added. |
| I2 | Medium | `restoreState` effect on next step not traced | **Accepted, fixed** as a D2 requirement to model branches separately. |
| I3 | Medium | Referenced review artifact missing | **Accepted; resolved** by this file. |
| I4 | Medium | External Viewer source fragile | **Already stated** (matching SHA and external helper are prerequisites; fail-closed handling documented); an in-repo acquisition process is a D2-spec item. |

**Open:** 0 Critical / 0 High in scope. Dispositioned reviewer severities that were out of scope: C1 (rejected), C2 (deferred).

**Verification:** `git diff --check` clean; stale-wording grep clean; replay output hash unchanged; accepted dispositions unchanged (moderate/partial lag, unproved causality, D2 synthetic inputs, narrow `restoreState`, C6 `NOT_EVIDENCED`, no margin, T4 unchanged, D2 recommended not authorized).
