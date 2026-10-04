# Internal review — G2 D0/D1 research correction

- **Artifact:** [research](../research/2026-10-04-g2-d0-viewer-api-evidence-d1-r1-replay.md) + [replay scripts](../research/2026-10-04-g2-d1-replay-scripts/)
- **Authority:** owner prompt `docs/prompts/for-claude-g2-d0-d1-research-correction-only.md`; corrects the [independent review](2026-10-04-g2-d0-viewer-api-evidence-d1-r1-replay-independent-review.md) findings M1, M2, L1, L2.
- **Reviewer:** Codex (`codex-review spec`, medium), request `20261004-165259-90544-22579`; one focused pass over the correction scope. The reviewer also raised items outside strict scope; those that tighten lag/D2 wording were accepted.
- **Replay verification:** run from a different working directory with an explicit output path; output SHA-256 `9d39b4d07b585cba63ed0b89e2a2c933460ad97a1b300bf876d86c8f6ffc21a9` identical to the retained `recompute_out.txt`; all 10 evidence files re-hashed against `MANIFEST.md`, unchanged. Script SHA-256: `load.py` `cc41a0c1…083b0d`, `recompute.py` `249ebed4…faef1`.

## Owner-prompt items

| Item | Status |
|---|---|
| M1 lag claim downgraded | **Partly done; §10 residue found by the targeted independent re-review and closed in the [final-wording correction](2026-10-04-g2-d0-d1-final-wording-correction-internal-review.md).** First pass: "moderate/partial pattern; causality unproved"; observed-fact / pattern / inference / unresolved-causality separated (§9); "exact" reserved for arithmetic; matrix row marked inference. |
| M2 D2 input geometry | Done: retained U/A:104 only; B:111, A:135, home camera are historical-geometry-unavailable and synthetic by construction; D2 tests mechanical possibility, not causality (§13). |
| L1 `restoreState` | Done: valid-state path only; returns `false` on missing state/model (verified in pinned source V:38243-38253); not a cancellation witness; override on next step is inference; pinned-build only. |
| L2 portability | Done: script-relative R1 path, any-cwd command, optional output arg, environment, expected values, hashes, external-vs-checked-in sources, unavailability handling. |
| Accepted D0 conclusions preserved | Yes (async consumption, single slot, held requests, no request identity, T4 gaps, C6 `NOT_EVIDENCED`, no margin, D2 recommended). |

## Findings from the Codex pass

| # | Sev. | Finding | Disposition |
|---|---|---|---|
| 1 | High | Correction workflow incomplete (this review and handoff missing; script hashes delegated) | **Accepted; resolved** by this file, the handoff update, and hashes recorded in the artifact. |
| 2 | High | "Not N" contradicts the admitted no-op alternative | **Accepted, fixed.** Reworded to "not consistent with the expected successful tight framing for N"; ownership marked unresolved; "home equals fit(U) not credible" → "untestable". |
| 3 | High | D2 outcomes not falsifiable | **Accepted, fixed.** "No ordering reproduces" prohibited as a conclusion unless exhaustive and source-derived; D2 needs its own separately authorized specification (state machine, bounded schedules, case matrix, pass/fail). |
| 4 | Medium | T4 does not implicitly observe nav target/pivot | **Accepted, fixed** (T4 observes rendered pose/projection only). |
| 5 | Medium | "Docs silent on animation" too broad | **Accepted with caveat, fixed.** Narrowed to request consumption/holding/coalescing/identity; the cited official statements were supplied by the reviewer and were **not re-fetched** in this correction (stated in the artifact). |
| 6 | Medium | "Request-tagged completion" has no acquisition contract | **Accepted, fixed.** Labelled an instrumentation hypothesis; attribution/ambiguity requirements stated; "ambiguous" is an accepted outcome. |
| 7 | Low | Hash determinism cross-platform; "bitwise"; external helper | **Accepted, fixed** (value-level authoritative; environment bound; "bitwise" defined; source availability a D2 prerequisite). |

**Open:** 0 Critical / 0 High. Remaining gaps are explicit research gaps. No second review pass run after these edits (wording/specification tightening only).

**Unchanged:** T4, C6 `NOT_EVIDENCED`, no margin, C8 unresolved; no harness/test/product/procedure change; no live run; no commit/push.
