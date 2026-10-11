# Clash Tests Manager — CTM-7 headed SVF2 product validation: final report

Date: 2026-10-11. Package: CTM-7 only (owner-authorized by `docs/prompts/for-claude-clash-tests-manager-ctm-7-headed-svf2-validation.md`). Validation only: no production, test, spec or plan change; no commit/push.

## 1. Repository state

- Repo `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`; branch `main`; HEAD `85aee231289dab39b7d98a63c9f2067b57db01b6` (verified, == the prompt's checkpoint); `origin/main` == HEAD; origin `https://github.com/yiskang/aps-viewer-clash-detection.git`.
- Start tree: clean except the untracked task prompt. End tree: that prompt, the new evidence directory, this report, and the `docs/handoffs/latest.md` edit (docs only). `git diff --stat` empty before and after (tracked production/test/spec/plan files unchanged); `git diff --check` clean.
- Start-state discrepancy (reported, not reconciled in product): `docs/handoffs/latest.md` before this package still described HEAD `fdb8643` with an uncommitted tree; git shows the checkpoint `85aee23` already committed. The handoff was stale metadata; it is refreshed by this package's handoff entry.

## 2. Governing contract

CTM-7 = plan row "Headed SVF2 validation of switch/delete teardown (markers removed, isolation restored / `skipped-external`) and row readiness after unload/hide/reload, within the existing PG-1/G1 envelope" (`docs/superpowers/plans/2026-10-10-clash-tests-manager-implementation-plan.md` §gate table; spec §26 in `docs/superpowers/specs/2026-09-26-viewer-clash-panel-design.md`, gate table row CTM-7), scoped by the owner prompt scenarios A–J. Owner Option A record (single panel) and the UI-layout headed validation (accepted) are context only.

## 3. Runtime and launch

- Launch: `PORT=8080 node server.js` (credentials from the existing `.env`, not read); normal app, hash-URN load of Audubon Architecture, then Structure and Mechanical with "Load as additional model"; Clash Panel from the toolbar button. Not `?clashPanelDemo=1`. Server stopped and browser closed afterward.
- Browser Playwright MCP headed Chrome 155 (macOS). Viewer 7.124.2 (`streamingV2`), all three models SVF2 (`isOTG()`), units ft. Models/keys: Architecture `#1`, Structure `#2`, Mechanical `#3` (reloaded later as `#4`). Full URNs: `runtime-identity.json`.
- Assertions use stable state: manager DOM attributes (`aria-current`, `data-test-id`, `data-key`, `data-confirm-op`, `data-banner-id`), editor ViewModel (`getViewModel()`, `vm.test`), Viewer state (overlay-scene child counts, isolated/hidden node counts), plus visible text and screenshots.
- Evidence executed by a delegated subagent; every PNG was then re-read and checked by the package agent (§9).

## 4. Scenario adjudication

| ID | Scenario | Verdict | Key evidence |
|---|---|---|---|
| A | Session manager basics (create, name, Set A/B, Hard/Soft, summary/readiness) | **PASS** | CT-01..05, state-A. Readiness reads "Setup complete — readiness to run is checked when opened" (never "ready"); Soft row shows "clearance 0.1 ft, user-supplied, not verified" |
| B | Multiple tests / active lifecycle / no leak | **PASS** | CT-06,07,14, state-B. Result-row `data-key` testId always equals the active id; overlays [0,0], isolation 0 after each switch; inactive completed test shows "Results not held — open and re-run to view" |
| C | Run lifecycle (Hard; Soft) | **PASS** (Soft caveat in note) | CT-08..12, 15. Arch×Struct 2277 clashes (matches the prior run), status/count/Manager/Editor/held rows/selection/markers/isolation agree; reopen of active test leaves state unchanged. Soft Struct×Mech: 46 clashes only under the user-supplied, unverified `ft` basis (host gives no measurement-basis check) |
| D | Switch with held results / confirmation | **INCONCLUSIVE** (subchecks: teardown and no-spurious-confirmation PASS; unsaved-held confirm/cancel branch not exercised) | CT-13,16,17, state-D. Results were always `saved`, so `heldUnsaved` false and no confirmation appeared (matches contract). Creating a held-unsaved set needs fault injection (prohibited); cancel/confirm exercised headed only via Delete (G) |
| E | Duplicate | **PASS** | CT-18..20, state-E. New id, `revision 1`, no summary/results, mode/sets/clearance/attestation copied (attestation still "not verified"); active test unchanged; own result rows; source stays "Results not held" |
| F | Reset results | **PASS** | CT-21..23, state-F. Active and inactive: status "Not run", config intact, editor idle/0 rows, overlays [0,0], isolation restored; no summary resurrection after round trip/switch |
| G | Delete | **PASS** | CT-35..40, state-G. Confirmation text and banner focus, all row actions disabled with the shared reason, Cancel leaves everything intact (rows 50, selection, overlays [1,2], isolation 1/1); confirm of inactive → active unchanged; confirm of active → successor active, Viewer clean; delete last → fresh active "Clash test 3" (Hard, empty sets, "Setup incomplete") |
| H | Model departure / same-key re-entry | **PASS** (F-1 recorded separately) | CT-24..34, state-H (see §6). Hide/show/unload driven with the public Viewer API from the console (no per-model hide/unload UI exists) |
| I | Manager→Editor→Manager round trips | **PASS** | CT-41, state-I; three passes with identical identity/name/sets/mode/status/count/ownership; also every earlier switch |
| J | Fault/recovery | **INCONCLUSIVE** (not exercised headed) | No safe existing path; automated coverage retained: `testsManager.recovery/pending/realEditor/integration/core.test.mjs`, `managerViewModel.test.mjs`, `testReadiness.test.mjs` (names from the evidence log; not rerun) |

**Totals (A–J, 10 scenarios, one primary verdict each): 8 PASS (A, B, C, E, F, G, H, I) / 0 FAIL / 2 INCONCLUSIVE (D, J) / 0 N/A.** Caveats and subchecks are recorded in the rows and notes (C: Soft ran only under the user-supplied unverified basis; D: teardown/no-spurious-confirmation subchecks PASS, unsaved branch not exercised; H: Manager departure/re-entry contract PASS, with F-1 recorded separately). One finding (F-1) and four observations. No PASS is claimed for any untested branch. If the owner resolves F-1, H should be re-validated against the chosen invariant.

## 5. Ownership, run/status, duplicate/reset/delete, confirmation observations

- Only the active test owns held rows and Viewer presentation; after every switch/reset/delete: marker overlays `[0,0]`, isolated nodes 0, hidden nodes 0, selection cleared (CT-13, 17, 21, 36, 38, 40). Inactive tests retain only session metadata/summary.
- Run/status/count: Manager row, editor headline and `vm.test` agree (2277 / 46). Reopening a completed-but-not-held test shows "Results not held — open and re-run to view".
- Duplicate, reset, delete: see rows E–G. Confirmations appeared only for Delete (saved sets: no unsaved sentence); Open/Reset/Duplicate with saved sets required none.

## 6. Model departure / re-entry (H) and finding F-1

- Model Browser root eye is node-level visibility only (`hiddenNodes` 1, model stays in `getModels()`): no readiness change, correct. No Viewer UI exists for model hide/unload.
- `viewer.hideModel(Mechanical)`: the two Mechanical-using tests show "Audubon_Mechanical_clash_test is not loaded" and Set B "(not loaded)"; Arch×Struct unaffected (CT-26). `viewer.hideModel(Structure)`: Arch×Struct (active, previously run) shows "Models changed since this run" and "Audubon_Structure_clash_test is not loaded" (CT-28); Struct×Mech tests also not-loaded. `showModel` on the same key: readiness and "Models changed" recover with no manual action (CT-27, 29).
- `viewer.unloadModel` then reload through the host Load UI: new key `#4`; old tests stay bound to the old key (`…dA#3 (not loaded)`, label disambiguated); no rebinding (CT-33, 34).
- **F-1 (Low/Medium; owner decision required; not fixed).** With Structure hidden by `viewer.hideModel` (same key still listed by the catalog and registered), the Manager row of the active, previously-run test says "Audubon_Structure_clash_test is not loaded" / "Models changed since this run", but the editor still reports "Ready" with `ready`/`registered` true and `canRun`; Run completed 2277 clashes, coverage full, no banner (CT-30, CT-31, state-H).
  - Cause (verified by package review against source): the Manager treats the model-left event as a recomputation trigger and keeps a `departed` key overlay (`clashpanel/core/testsManager.js`, `departed`/`derivedOf`, "absent at once … binding reads as null"); the editor's `modelFindings` (`clashpanel/core/setupValidation.js`) reads the raw catalog entry and `registry.bindingFor(key)` without that overlay. Both consult binding facts; only the Manager applies the departed overlay until the catalog stops listing the key. (The subagent's earlier hypothesis that the Manager uses `bindingFor` and the editor does not was inaccurate.) Spec §26.6 names the editor's `validateSetup` as the only Run gate, so a successful run may be spec-conformant.
  - Owner decision required between two invariants: (1) model-left/`hideModel` = unavailable → Manager and Editor both blocked until same-key re-entry (editor consumes the same departed fact); or (2) the model stays runnable → Manager must not classify it missing/changed solely from the model-left event. Either choice needs defined event ordering, same-key recovery, active vs inactive behavior, Run enablement, exact copy and acceptance tests. Merely labelling the Manager text advisory does not resolve the contradiction. Not remediated.

## 7. Observations (non-blocking)

- O-1: no Viewer UI path for per-model hide/unload; H used the public API from the console.
- O-2: after Reset, the editor's internal `vm.test.lastRun` still holds the prior sealed run while the Manager shows "Not run"; no user-visible resurrection observed.
- O-3 (added by package review): the editor's Set A/B model checkbox order changed (Architecture, Mechanical, Structure; CT-30/31) after the hide/show cycle versus the original Architecture, Structure, Mechanical order (CT-02..). Cosmetic ordering only; cause not investigated.
- O-4: a transient glyph-font flash at first snapshot was noted by the executor (not a Clash Panel issue).
- Console: 0 errors; 1 expected Viewer `Model#getInstanceTree` deprecation warning (`console.log`).

## 8. Fault/recovery coverage and gaps

Not exercised headed: unsaved-held confirmation, terminal fault, stuck release, divergence recovery, non-Chromium browsers, narrow viewports (covered by the accepted layout run), real Viewer-UI model unload. Automated coverage by name is listed in J; those suites were not rerun here (not required by the prompt).

## 9. Evidence index and integrity

Directory `docs/research/evidence/2026-10-11-ctm-7-headed-svf2/`: `SCENARIO-LOG.md`, `console.log`, `runtime-identity.json`, `state-A..I.json`, 41 PNGs `CT-01…CT-41`, `MANIFEST.sha256` (53 entries; `shasum -a 256 -c MANIFEST.sha256` → 0 failures). The package agent viewed all 41 PNGs; visible content agrees with the written conclusions (Active badge, per-row summaries, confirmation banner with shared disabled reason, "not loaded" lines, successor/fresh test, clean Viewer after switch/delete; isolated wall visible while results are held in CT-09/10/37 and absent in CT-17/38/40). Caveat: the Viewer-state claims (overlay counts, isolation) rest on the JSON captures; screenshots alone show isolation but not overlay counts. Limitation (internal review I3): the executor's in-page capture helper (`window.__cap/__snap`) existed only in the browser page and its source was not retained, so the JSON captures are not reproducible from retained evidence; their field meanings are those named in `SCENARIO-LOG.md` (overlay-scene child counts, `getIsolatedNodes`/`getHiddenNodes` counts, editor ViewModel fields, manager DOM attributes) and the settle conditions were not recorded. Hashes prove integrity, not method. A future rerun should retain the capture script and schema.

## 10. Deviations / limitations

Hide/show/unload via console public API; capture-helper source not retained; (no UI path); Soft is runnable only through the user-supplied unverified basis; non-Chromium and screen readers not exercised; D's unsaved branch and J not exercised headed; F-1 cause unconfirmed. Evidence-gathering was delegated; adjudication and screenshot review were done by the package agent.

## 11. Protected boundaries

No production, test, spec, plan, Core/Adapter/collision, G2/C6/C8/G3, R20-1, persistence/history/background-run or UI-layout change. No model upload/retranslation. CTM-8 and L1–L8 not entered. No commit or push.

## 12. Internal review

One bounded Codex review (`codex-review spec`, medium) of this report/evidence package, 2026-10-11. Findings and dispositions:

| ID | Sev | Finding | Disposition |
|---|---|---|---|
| C1 | Critical | Internal-review disposition was a placeholder | Fixed: this section |
| C2 | Critical | Handoff update claimed but not yet written | Fixed: newest entry added to `docs/handoffs/latest.md` (HEAD `85aee23`, totals, F-1, links, next gate) |
| I1 | High | Verdicts outside PASS/FAIL/INCONCLUSIVE/N/A | Fixed: one primary verdict per scenario; D = INCONCLUSIVE with PASS subchecks; totals 8/0/2/0 recomputed |
| I2 | High | F-1 hypothesis inaccurate; invariant undefined | Accepted and verified against source; §6 rewritten with the two-invariant owner decision; H flagged for re-validation after the decision |
| I3 | Medium | State-capture helper not retained | Accepted as a limitation (source existed only in the page; cannot be reconstructed honestly); disclosed in §9/§10 |

Effect: totals changed from the earlier draft (D PARTIAL → INCONCLUSIVE; H "PASS with finding" → PASS + separate finding); no evidence file changed. Package-agent self-check against the prompt's review list: no evidence gap presented as PASS after the corrections; no stale Viewer state found; no ownership contradiction; Manager/Editor disagreement found and reported (F-1); stale-readiness recovery verified; duplicate/reset/delete as contracted; confirmation not broadened; stable state used with text as corroboration; no production/test mutation; no CTM-8/L1–L8/new-scope work; no unsupported Soft/fault/non-Chromium claims. Unresolved: F-1 (owner decision), D unsaved branch and J (not exercised headed).

## 13. Readiness and next gate

Ready for Independent Work review of the CTM-7 package. **Next gate:** Independent Work review of this package (`docs/reviews/<date>-ctm-7-…-independent-work-review.md`), plus owner decision on F-1 (not self-authorized). CTM-8, L1–L8, remediation, commit/push and any new scope remain unauthorized.
