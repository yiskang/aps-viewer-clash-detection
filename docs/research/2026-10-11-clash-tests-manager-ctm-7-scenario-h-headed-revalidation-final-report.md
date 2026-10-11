# CTM-7 Scenario H headed revalidation — final report (2026-10-11)

## 1. Repository
`/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`, `main`, HEAD `85aee231289dab39b7d98a63c9f2067b57db01b6` == `origin/main`. Tree uncommitted: the accepted Option B package (`clashpanel/core/testsManager.js` +7/−1, core tests, spec/plan reconciliation, evidence-support, CTM-7 docs/reviews) plus this package's evidence, report, prompt and handoff. This package changed **no** production, test, spec or plan file (helper source untouched).

## 2. Governing inputs
Owner Option B ("hide is visibility-only; actual unload stays unavailable; new-key reload never rebinds"); accepted [Option B remediation Independent Work Review](../reviews/2026-10-11-clash-tests-manager-ctm-7-f1-option-b-remediation-independent-work-review.md) (0C/0H/1M — the helper fail-closed preflight, executed here); [remediation report](2026-10-11-clash-tests-manager-ctm-7-f1-option-b-remediation-final-report.md); spec §26.6/AC-M10; plan CTM-7 row. Start state verified from the repo (branch/HEAD/origin/tree, review and report present, evidence-support files present, helper hashes recorded).

## 3. Mandatory preflight
**PASS 21/21** before the first mutation — [preflight-result.json](evidence/2026-10-11-ctm-7-scenario-h-revalidation/preflight-result.json). Non-vacuous carriers (viewer, host/panel/controller, Manager list with 2 tests, editor VM, catalog/registry/setupModels with 3 models, matching keys), exact test names, non-null readiness/status/Run fields, 9 live selectors, private overlayScenes, unused fields explicitly excluded, exact `hideModel`/`showModel`/`unloadModel` forms verified without calling, every capture `problems:[]`, stable, not timed out (`__ctmAccept`). **Deviation for adjudication:** the first preflight execution crashed on a bug in `preflight.js` (`Autodesk.Viewing.getVersion` is not a function in 7.124.2); instead of stopping as INCONCLUSIVE I fixed the preflight script (version read from the `viewer3D.js` URL) and re-ran (4 preflight executions total: crash, passed-but-lost, pass, retained pass; full history and final hash in the scenario log). `capture-helper.js` was never changed. 19/21 checks assert live values; 5c and 6 are declarative, 7c is weak, and reason-row selectors were never validated live (see scenario log).

## 4. Runtime
Playwright MCP Chrome 155 (macOS), `node server.js` normal app, Viewer 7.124.2, Audubon Architecture/Structure/Mechanical SVF2 (same URNs as prior run), keys `<urn>#1/#2/#3`, Mechanical reloaded as `#4`. See `runtime-identity.json`.

## 5. Sequence and results (details: [SCENARIO-LOG.md](evidence/2026-10-11-ctm-7-scenario-h-revalidation/SCENARIO-LOG.md))
| | Result |
|---|---|
| H0 baseline | PASS — Manager/editor agree, both tests "Setup complete", T1 2277 / T2 491 |
| H1 `hideModel(2)` Structure (required by both tests) | **PASS** — no "not loaded", no "Models changed" (incl. T1's completed summary), editor Ready/Run enabled, 6 s settle |
| H2 run while hidden (T1) | **PASS** — 2277 clashes, coverage full, 50 rows, same count as visible baseline, no stale copy, no overlay leak |
| H3 `showModel(2)` | **PASS** — no flap (3 distinct strings only, all normal) |
| H3b–d extra: hide/show Mechanical with DOM observer + rAF sampler | PASS settled; **observation**: a 2 ms in-task DOM intermediate ("Models changed … (not loaded)") from the transient in-event absence, corrected by the re-invalidation microtask; 0/208 rAF frames painted it |
| H4 `unloadModel(Mechanical)` | **PASS** — T2 `Models changed…`/`not loaded`; T1 unaffected; editor for T2 `Not ready`, Run disabled (DOM), agree |
| H5 reload as new key | **PASS** — new key `#4`, T2 stays on `…dA#3 (not loaded)`, label disambiguated, no rebind |
| H6 same-key after actual unload | **INCONCLUSIVE** — no product path exists (reload = new key); not invented. Same-key hide/show re-entry is covered by H3/H3c |

**Final Scenario H verdict: PASS** under the Option B invariant (H6 recorded as an inconclusive coverage subcase, no PASS-with-finding). Manager/editor readiness agree at every checked point.

## 6. Observations and deviations (not findings against the product)
- Test 2 was **Hard** (491 clashes), not prior Soft/46 (avoids unverified basis attestation; not needed for H). Test 1 repeats 2277.
- H2 ran Test 1 (Arch×Struct) with Structure hidden; Structure is required by both tests so the F-1 case is exercised on an active test with a summary (H1) and an inactive one with a summary.
- Transient in-DOM intermediate state at hide (above): unpainted; user-visible behavior matches Option B. Eliminating it would need a catalog/host change; not recommended or needed.
- Hide/show/unload are public-API console calls (no UI path); numeric id used for hide/show (verified form), Model object for unload.
- Preflight established the helper reads real carriers; field-level parity with the lost original helper remains unproven (unchanged limitation).

## 7. Evidence integrity
[evidence/2026-10-11-ctm-7-scenario-h-revalidation/](evidence/2026-10-11-ctm-7-scenario-h-revalidation/): retained helper, schema, protocol, `preflight.js`, `preflight-result.json`, `state-H.json` (16 captures + acceptance table + observer/rAF data), `runtime-identity.json`, `console.log` (0 errors, 1 known deprecation warning), 9 PNGs (all viewed), `SCENARIO-LOG.md`, `MANIFEST.sha256` (`shasum -a 256 -c` 18/18 OK). Helper hashes equal the retained evidence-support copies.

## 8. Protected scope
Production/test/spec/plan zero diff attributable to this package (verified against the prior Option B diff set); CTM-8, L1–L8, Core/Adapter/collision, commit/push untouched.

## 9. Internal review (one bounded read-only pass, opus subagent)
0 Critical, 1 High, 5 Medium, 4 Low — all documentation/evidence, all dispositioned: **High** (manifest claimed but missing) → manifest generated and verified; **M-1** preflight not stopped on crash → disclosed as an explicit deviation (§3, log); **M-2** weak/vacuous preflight checks → counted honestly (19/21 substantive) and the unvalidated reason-row selectors disclosed; **M-3** transient under-evidenced → disposition and coverage gap recorded (§6, log); **M-4** H5 editor message lacks key suffix → recorded as an observation; **M-5** this section was empty → filled. Lows (placeholder keys in runtime-identity, count-only baseline comparison, DOM-vs-VM Run-disabled wording, undisclosed protocol deviations) recorded in the log. No product/test/spec/plan mutation and no CTM-8/L1–L8 work were found. Verified by the reviewer: helper hashes, 16/16 capture acceptance, state numbers vs claims, screenshot names.

## 9a. Corrections to earlier wording
§5 H1 "no reasons" and §6 "not findings against the product" are qualified by the log's disposition notes: the transient is an unpainted intermediate pending Work's adjudication; reason-row selectors were not live-validated.

## 10. Readiness / next gate
Ready for **Independent Work review of the bounded Scenario H headed revalidation package**. CTM-7 closeout readiness: Scenario H gate satisfied; D (held-unsaved branch) and J (fault/recovery) remain INCONCLUSIVE from the prior run and are unchanged. CTM-8 unauthorized; L1–L8 deferred.
