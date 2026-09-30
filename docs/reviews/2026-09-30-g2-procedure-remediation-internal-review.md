# G2 procedure v2 — targeted remediation internal review (Codex advisor, `medium`)

- **Date:** 2026-09-30
- **Artifact:** `docs/research/2026-09-30-g2-viewerbridge-dockingpanel-live-verification-procedure.md` (v2; design only, no harness code, no live run)
- **Authorization:** `docs/prompts/for-claude-g2-procedure-bounded-remediation.md` (H1–H5, M1–M3, directly affected Lows; documentation only).
- **Governing input:** independent Work review `docs/reviews/2026-09-30-g2-viewerbridge-dockingpanel-live-verification-procedure-independent-review.md` (0C/5H/3M/2L).
- **Reviewer:** Codex advisor, request `20260930-122112-22275-17373`, `medium`, **one targeted pass** scoped to H1–H5, M1–M3, Lows and directly affected cross-references (no full-artifact rediscovery). Read-only. Findings adjudicated by me against the procedure text and repository source before acceptance.

## Remediation closure per governing finding

| Finding | Reviewer status | Notes |
|---|---|---|
| H1 scene-ownership contradiction | **Closed** | C7α/C18a/C18b/N3/cleanup/`sceneOwnership` schema agree; matches `markers.js` (`scenesAdded` only for bridge-created scenes; `disposeShared` removes only those) |
| H2 fail-first verdict | Closed after fixes below | rows 1–8, examples X1–X8; two defects found in the remediation itself (F1, F3), both fixed |
| H3 authorization/journal binding | Closed after fix below | one proof-clause defect (F4) fixed |
| H4 C4 containment oracle | Closed after fix below | N6 mutation construction defect (F2) fixed |
| H5 C17 oracle | **Closed** | V4/V5/V6 verified against `ViewerBridge.js`/`isolation.js`/`markers.js` behaviour |
| M1 model-B cleanup | **Closed** | independent guarded `unloadModelA/B` |
| M2 thresholds | **Closed** | only AP value (T17) is diagnostic-only |
| M3 C2 title contract | **Closed** | `ClashDockingPanel.initialize()` calls `this.createTitleBar(...)` exactly once, never `super.initialize()` |
| Lows (sample wording; G1/G2 F7/F8 naming) | **Closed** | table added; no bare F7/F8 |

## New findings from this pass (all accepted, all fixed in the procedure)

| # | Sev. | Section | Finding | Fix |
|---|---|---|---|---|
| F1 | High | §8 row 5 vs §4.1 | row 5 required journal state `ATTEMPT_CONSUMED` at finish, contradicting the mandated `COMPLETED` terminal state — every good run would FAIL | row 5 now requires exactly one `ATTEMPT_CONSUMED` in history and last durable state `COMPLETED`; last state `ATTEMPT_CONSUMED` = incomplete-terminal failure |
| F2 | High | §7 N6 | mutations subtracted from the *original candidate face*, which can exceed the reference by an arbitrary margin, so the mutated box could still contain the reference and the control would mis-report | mutations are constructed relative to the reference (`bMax_x := rMax_x − 2·T_x`, etc.), `S_x/A_x/T_x` recomputed and recorded, validity asserted; (ii) may not be `NOT_APPLICABLE` |
| F3 | Medium | §8 row 8 / §5 | `sessionTainted=true` matched no row 1–7 yet row 8 required false — table not exhaustive | `sessionTainted=true` is now an explicit row-6 predicate; FAIL rows still take precedence |
| F4 | Medium | §4.1 proof clause 3 | proof demanded exactly two load starts, unsatisfiable for a consumed attempt that stopped earlier | clause is now "zero to two ordered starts, ≤1 per fixture, none before consumption, exactly two only when both initiations were reached" |

No Critical finding. The reviewer identified no need for design change or production change.

## Residual uncertainties (recorded, not defects)

- Viewer 7.124.2 event emission/ordering on `unloadModel(B)` and the base `DockingPanel` constructor's virtual dispatch into `initialize()` are live-runtime assumptions; C16/C17/C2 treat them as live evidence, not as pre-established facts.
- The F1–F4 corrections were **not** re-reviewed by Codex (the reviewer recommended a further bounded look at only §4.1, N6 and §8; the remediation authorization stops after one targeted internal review). That further look is left to the bounded independent Work re-review, per the handoff.

## Limits and confirmations

Internal review is a convergence aid, not an independent gate. No harness code written; no live run; no Viewer/Playwright/Chromium session; no G3/H1/H2/OQ-1/host work; no Core/Adapter/M4/Panel/production/`server.js` change; no G1-F7 probe or calibration; nothing committed or pushed.
