# G2 procedure — internal review record (Codex `spec`, effort `medium`)

- **Date:** 2026-09-30
- **Artifact:** `docs/research/2026-09-30-g2-viewerbridge-dockingpanel-live-verification-procedure.md` (design only; no harness code, no live run)
- **Reviewer:** Codex worker, request `20260930-103613-22525-27137`, `spec` review, `medium`. One pass; no automatic re-review (CLAUDE.md review boundary).
- **Raw verdict:** "Requires major revision" — 5 Critical, 5 High, 5 clarification questions, no Medium/Low tier.
- **Adjudication:** every finding independently checked against the repository before acceptance. Critical 2 and 5 were verified against source (`clashpanel/viewer/isolation.js:139-163`; `test/acceptance/g1-svf2-f1-f8-verification.mjs:5648-5655`, `6085-6120`).

## Dispositions

| # | Finding | Sev. | Disposition | Remediation (procedure section) |
|---|---|---|---|---|
| C1 | N1/N2 states contradict overall roll-up | Critical | **Accepted** | §7 exhaustive per-control terminal states; `NOT_DISCRIMINATING` (N2) = fixture insufficiency ⇒ C6 `NOT_EVIDENCED` ⇒ `PARTIAL`; §8 rows 4–6 rewritten and made exhaustive with an offline matrix requirement |
| C2 | C13 expects `failed` that C15 never produces | Critical | **Accepted** (verified: one-shot faults restore successfully) | C15(e) persistent restore failure added; C13 expected values made scenario-specific |
| C3 | "Exactly one attempt" not crash-durable | Critical | **Accepted** | §4.1 fsynced attempt journal keyed by authorization-prompt digest; refuse on existing `CONSUMED` journal |
| C4 | No timeout contract | Critical | **Accepted** | §4.5 timeout table, taint semantics, 20-min cap, tree-readiness rule (also answers Q2) |
| C5 | C4 cites nonexistent scalar `T_pass` | Critical | **Accepted** (verified: `T_pass = passFactor·u·S_a`, per dbId/axis) | C4 declares G2's own tolerance from G1's four constants with simplified `S_a`; strict-`>` boundaries; near-tolerance band recorded |
| H1 | N3 sentinel not inside a Panel scene | High | **Accepted** | C7(iii) two sentinels (Panel-named pre-created scene + separate scene) |
| H2 | Camera/screenshot oracles under-specified | High | **Accepted** | C6 single settle algorithm + full clip-space predicate, `ε=1e-4`; C7(iv) noise baseline, three colour masks, occlusion ⇒ `NOT_EVIDENCED` |
| H3 | C16 PASS-iff-or wording and event ordering | High | **Accepted** | C16 rewritten; monotonic event log with entry/callback/exit records |
| H4 | Failure propagation / contamination | High | **Accepted** | §5 dependency table + phase-boundary baseline invariant + `sessionTainted` blocking later mutating checks |
| H5 | Redaction/size/attribution | High | **Accepted** | §4.6 redaction, caps, recorder-outermost wrapper composition, `withOrigin` contexts, `unattributed` ⇒ FAIL for prohibited calls |
| Q1 | Must procedure be committed before live authorization? | — | **Answered in procedure** | §11 step 2b: committing accepted artifacts (with separate owner authorization) is a precondition to any live run because Phase 0 permits untracked files only under `docs/prompts/` |
| Q2 | Tree-readiness condition | — | Answered | §4.5 readiness rule |
| Q3 | Model-B URN source | — | Answered, **needs owner confirmation** (D1) | §3 literal constant derived from the screening record |
| Q4 | C2 title-element selector | — | Answered | C2(vi) `.docking-panel-title` discovery rule; subclass override observed via DOM and base-prototype spies (the subclass `initialize` is not wrapped) |
| Q5 | C5 conversion formula | — | Answered | C5 explicit rule; `null` when not derivable |

No finding rejected. No finding required a design/architecture change to production code; all remediation is inside the design artifact's own abstraction level.

## Classification of what remains

- **Design/spec correctness blocker:** none known after remediation.
- **Owner/product decisions (unchanged, recorded as D1–D7 in the procedure):** second fixture (D1), verdict roll-up (D2), foreign-theming seeding (D3, recommended No), failure injection (D4), scope narrowing of selection/stale-binding (D5), OD-12 stays plan-assumed (D6), numeric thresholds (D7).
- **Verification/calibration gates:** numeric thresholds (`N_min`, hue bands, `ε`, timeouts) are proposals for independent challenge, not calibrated values; they may not be tuned against a live run's own observations.
- **Deferred/non-goal:** F7 probe/calibration; G3, H1/H2, OQ-1; T1–T33 follow-ups.

## Limits of this review

Single Codex `medium` pass over the remediated-once artifact; the remediation text was **not** re-reviewed by Codex (targeted re-review is available if the owner or the independent Work review asks). The review examined the design text plus repository files it cited; no live behaviour was observed. This review is a convergence aid, not an independent gate.

## Explicit confirmations

No production/Core/Adapter/M4/Panel/harness code changed; no live run; no G3/H1/H2/OQ-1/host work; nothing committed or pushed.
