# Federated Clash Test Viewer Adapter — T3 live acceptance result

- **Status:** evidence artifact. **Result: T3 = PASS**, gates `T3: "PASS (inside the accepted envelope only)"` and `liveUnloadIntegration: "VERIFIED_IN_ACCEPTED_ENVELOPE"` — 86/86 checks passed, script exit code 0, 0 console errors, 0 page exceptions, 0 failing links. **Valid only inside the accepted envelope: Audubon / SVF non-OTG / Viewer 7.124.2 / Chromium 151.** **Independently verified PASS** by [`docs/reviews/2026-09-26-federated-clash-test-viewer-adapter-t3-independent-verification.md`](../reviews/2026-09-26-federated-clash-test-viewer-adapter-t3-independent-verification.md) (0 Critical / 0 High / 0 Medium / 2 Low); **G-VA-T3-EXEC satisfied**; the owner closed the Viewer Adapter milestone inside the accepted envelope (see §6). The raw console log is stored as `…t3-run.log.txt` because the repository's global `*.log` ignore rule would otherwise drop it (the verification's Low 1; resolved by rename, no `git add -f`).
- **Authorization:** owner message of this session: "I explicitly authorize execution of the existing T3 live acceptance for the Viewer Adapter." Scope: run the already-authored script only; no production/Core change, no optional entry-checkpoint helpers, no lease-dead or duplicate-`owner-mapping-mismatch` remediation, no Viewer Clash Panel/UI, no broadening of the OQ-4 envelope.
- **Governing artifacts:** plan `docs/superpowers/plans/2026-09-26-federated-clash-test-viewer-adapter-implementation.md` (Task 13; gates G-VA-T3-EXEC, LIVE_UNLOAD_INTEGRATION_UNVERIFIED, G-VA-OQ4-ENV, G-VA-READY, G-CAL); independent implementation review `docs/reviews/2026-09-26-federated-clash-test-viewer-adapter-independent-implementation-review.md`; OQ-4 evidence `docs/research/2026-09-26-federated-clash-test-oq4-live-evidence-check.md`.

## 1. Run identity

| Item | Value |
| --- | --- |
| Branch / HEAD (before and after) | `feature/federated-clash-test-viewer-adapter` @ `c7b5d13a15b8da7f9403a9027530bdd0c6f86d55` (unchanged by the run) |
| Working tree before the run | `M docs/handoffs/latest.md`, `?? docs/reviews/…-independent-implementation-review.md` (both pre-existing, uncommitted, documentation only). No production/test/Core file modified |
| Script | `test/acceptance/clashtest-viewer-adapter.acceptance.mjs` — byte-identical to the reviewed commit `58bebb6` (`git diff 58bebb6 HEAD` empty; clean vs HEAD) |
| Command | `npm start` (server on `localhost:8080`, owner's `.env` APS credentials; token endpoint returned 200) then `node test/acceptance/clashtest-viewer-adapter.acceptance.mjs` from the repository root. No arguments, no env overrides. Single run, no retry |
| Run start / duration | 2026-09-26T06:11:59Z start; script-reported `durationMs` 132,806 |
| Host / runtime | macOS Darwin 27.0.0; Node v22.23.1; Playwright 1.62.1 (chromium-1234) |
| Browser | `HeadlessChrome/151.0.7922.34` |
| Viewer | script `https://developer.api.autodesk.com/modelderivative/v2/viewers/7.124.2/viewer3D.js` (pinned); THREE r71 page global; all three models `is3d: true`, `isOTG: false` |
| Model/evidence envelope | Audubon three-discipline fixture: Architecture / Structure / Mechanical `*_clash_test.rvt` (URNs in the script and OQ-4 Appendix A); populations 5,435 / 543 / 1,496; whole-model roots 4,244 / 468 / 1,257 |
| Raw evidence | full console log: `docs/research/evidence/2026-09-26-viewer-adapter-t3-run.log.txt`; full JSON report: `docs/research/evidence/2026-09-26-viewer-adapter-t3-run-report.json` (copy of the git-ignored `test/acceptance/results/clashtest-viewer-adapter-run-report.json`) |

## 2. Gate results (all asserted checks PASS)

| Gate / family | Result |
| --- | --- |
| Imports — `/clashtest/viewer/index.js` (FIRST, browser-loadability), `/clashtest/index.js`, `/collision/index.js`, `/collision/viewer/ViewerModelAdapter.js`, `/clashtest/planning/scopeDigest.js`, `/collision/constants.js` load in-page | 6/6 PASS |
| `[load]` exactly three Models; resolved by URN | 2/2 PASS |
| `[env]` pinned Viewer 7.124.2 script; Chromium major 151; every model SVF (`isOTG === false`) and 3D | 3/3 PASS |
| (a) whole `resolveRoots`: succeeds; `ownerMismatch.count === 0`; `unreachable.count === 0`; `unattributable` 0/0; population and root counts equal the OQ-4 values — Architecture, Structure, Mechanical | 18/18 PASS (5,435/4,244; 543/468; 1,496/1,257) |
| (b) enumerator == library: every root vs `extractFragments` (size/owners/subtree digest), 0 per-root mismatches; population digest recomputed from `extractAllFragments` equals the adapter's; `extractAllFragments` owner ≠ `fragList.getDbIds`: 0 | 12/12 PASS |
| (c) `digestScope('whole')` == `resolveRoots` population; sampled per-root and one multi-root `digestScope` == `resolveRoots`; Structure explicit roots 2734 and 3965 each exactly 1 fragment owned by itself | 11/11 PASS |
| Step-2 negative controls (i)–(v) on Structure (wrong owner, hidden fragment, not-loaded fragment, tree unavailable, capacity), each detected; Structure clean after restore | 6/6 PASS |
| (h) production `wireModelUnload` on the REAL `BEFORE_MODEL_UNLOAD_EVENT`: steps 1–4 (probe saw X and the still-present binding; unregister ran before evict; binding null and X not live after; replacement Y registered, survives the late unload of X, `resolveRoots` on Y succeeds; after dispose + unload(Y) binding and liveness intact, no evict for Y); main run with no primary/cleanup failure; cleanup postcondition (c); no removed listener fired | 17/17 PASS |
| (h) negative controls: `ctrl-no-wiring`, `ctrl-step3-sensitivity`, `ctrl-step4-sensitivity`, `ctrl-cleanup-a-partial-init`, `ctrl-cleanup-b-independence`, `ctrl-cleanup-aggregate` — each detected | 6/6 PASS |
| Zero console errors; zero uncaught page exceptions | 2/2 PASS |
| **Total** | **86/86** (`results.checks`: 86 entries, 0 not ok) |

Gate labels emitted by the script: `T3: PASS (inside the accepted envelope only)`; `liveUnloadIntegration: VERIFIED_IN_ACCEPTED_ENVELOPE` (so `LIVE_UNLOAD_INTEGRATION_UNVERIFIED` is not in force for this envelope); `failingLinks: []`.

## 3. Recorded characterizations (recorded, never asserted — no gate depends on them)

- **D-V9 records:** `max(roots[].fragmentCount)` = 14 (Architecture), 3 (Structure), 2 (Mechanical) — far under `maxFragmentsPerDbId` 5,000; no `EnumerationBoundExceededError` / `CapacityExceededError` finding on any model.
- **(d) Readiness (G-VA-READY; no sufficiency claim).** Per model the order was `MODEL_ADDED` → `OBJECT_TREE_CREATED` → `GEOMETRY_LOADED` / `isLoadDone()`. Instance tree available (`instanceTree` in data, `isObjectTreeCreated()`) at the `OBJECT_TREE_CREATED` time, 1.5–3.7 s before `isLoadDone()`; inside the `OBJECT_TREE_CREATED_EVENT` handler `isLoadDone()` was false and the snapshot (node count, distinct tree fragments, `fragList.getCount()`, not-loaded 0) equalled the `GEOMETRY_LOADED` snapshot (Architecture 4,747 nodes / 5,435; Structure 547 / 543; Mechanical 1,366 / 1,496). An immediate whole `resolveRoots` issued **inside `MODEL_ADDED`** (tree not yet created at call time: `isObjectTreeCreated:false, instanceTreeInData:false, isLoadDone:false`) **resolved** correctly for all three models (roots 4,244/468/1,257; population 5,435/543/1,496; `ownerMismatch` 0; `unreachable` 0), settling at the tree-creation time — i.e. the adapter's readiness wait held the call until the tree existed. This characterizes this build/content only.
- **(e) AC-6 T3 reload arm (cross-reload identity NOT evidenced, NOT asserted).** Mechanical unloaded and reloaded from the same URN: `modelId` 3 → 4; population count 1,496 both times; **population digest differed** (`sha256:aa764b0f…` → `sha256:bf3a8a78…`); per-root: 1,257 compared, 0 missing after reload, **1,257 digests differ**, **1,257 fragment-id lists equal**. Reading (not a claim): fragment ids were stable across reload for this fixture, yet scope digests changed, so digest inputs evidently include something that changes with the model instance. Whether this is expected is for the owner/Work review (relevant to OQ-1 / cross-reload identity, which this milestone does not cover).
- **(f) G-CAL profile (Architecture, largest):** tree nodes 4,747; whole `resolveRoots` 34.9 ms, 1,508 checkpoint calls, max span between checkpoints 15.1 ms, 2 spans over the 8 ms frame budget; whole `digestScope` 8.5 ms, 1,274 checkpoints, max span 4.5 ms, 0 over budget; explicit one-root `digestScope` 0.3 ms, 76 checkpoints. Single run on a headless machine; nothing asserted; no responsiveness or calibration claim.
- **Negative-control observations:** (i) wrong owner → `ownerMismatch` 1 (fragId 0: tree 3663 vs fragList 1003663); (ii) hidden fragment → `unreachable` 1; (iii) not-loaded → `EnumerationInconsistencyError: tree-reachable-fragment-unattributable`; (iv) tree unavailable → `ObjectTreeUnavailableError` (**the previously "not evidenced live" tree-unavailable failure path is now exercised live by an induced control**, still inside the envelope); (v) capacity → `CapacityExceededError('whole-model-enumeration')` with 0 tree callbacks issued (population gate fires before any tree read).

## 4. Warnings and residuals (nothing hidden)

1. **Envelope only.** PASS is for Audubon / SVF non-OTG / Viewer 7.124.2 / Chromium 151. Not evidenced: OTG/SVF2, 2D, non-Revit content, N/U/unreachable/mixed-owner **content** (Audubon has none; controls simulate them), general readiness-gate sufficiency, cross-reload fragment identity (recorded only, digests differed), calibration/responsiveness (G-CAL/G-RESP characterization only).
2. **AC-15 (g) PairId role-symmetry half: NOT EVIDENCED / NOT COVERED** by this script (needs an engine run over two live models with swapped selections; not authorized here).
3. **`env.viewerVersion` recorded as `null`.** The Viewer version was established from the pinned script URL (`…/viewers/7.124.2/viewer3D.js`, an asserted `[env]` check) rather than from a runtime-reported version string; the script did not capture one. Recorded as an evidence-quality residual, not a failure.
4. **Headless launch args** (`--no-sandbox --disable-dev-shm-usage --single-process --no-zygote`, per the repository's acceptance convention) — same as OQ-4; profile timings are from that configuration.
5. **Delegated execution.** As with OQ-4, the agent ran the script on the owner's configured server/credentials at the owner's explicit authorization; G-VA-T3-EXEC's wording ("project owner or an explicitly delegated run accepted by the owner") means the owner/Work review must accept delegated execution or re-run.
6. **Carried, untouched, unrelated to this run:** the lease-dead checkpoint discrepancy (Medium), duplicate `owner-mapping-mismatch` ledger rows (Medium), and the optional four entry-checkpoint helpers (Low) from the independent implementation review — deliberately not addressed, per authorization.
7. **Not production-integrated.** Host integration, `server.js` static route for `/clashtest`, Viewer Clash Panel/UI, OQ-1 derivation, remote persistence remain unauthorized; the adapter is *"live acceptance complete inside the accepted envelope"*, not host-integrated.

## 5. Scope statement

No production, Core, M4, test, plan, spec, README or schema file was changed by this task. No next milestone and no Viewer Clash Panel/UI work was started. Nothing was committed or pushed.

## 6. Closeout record (owner authorization: "Viewer Adapter milestone closeout only")

- **Independent verification:** PASS inside the accepted envelope (no rerun; script SHA-256 `78d2a525…0e8328` identical for the working tree, `HEAD` and reviewed commit `58bebb6`). Its two Low findings are dispositioned: (1) ignored raw log → renamed to `.log.txt` and all references updated; (2) execution provenance not cryptographically self-attesting (no script hash / start time embedded in the runtime report) → accepted as a provenance limitation, not a T3 blocker.
- **G-VA-T3-EXEC: satisfied.** `LIVE_UNLOAD_INTEGRATION_UNVERIFIED` is not in force inside the envelope. **Viewer Adapter milestone: CLOSED inside the accepted envelope** (Audubon / SVF non-OTG / Viewer 7.124.2 / Chromium 151). The owner accepted the delegated execution.
- **Reload digest discrepancy (§3 (e)):** recorded as a **non-blocking future-investigation residual**. Fragment ids were equal but population and per-root digests changed after a same-URN reload; the digest inputs include `ownerDbId` and `geometryId`, and the retained summary does not preserve their row-level before/after values, so drift is established but not its cause. Not investigated here; cross-reload identity and `modelKey`/`modelVersion` derivation belong to OQ-1 / host integration.
- **Remaining follow-ups, all outside this milestone:** two frozen-Core Medium residuals (lease-dead checkpoint classification; duplicate `owner-mapping-mismatch` ledger rows) — separate owner triage; four walk-helper entry checkpoints — optional hardening; AC-15 (g) PairId role-symmetry half, OTG/SVF2, 2D, non-Revit content, calibration/responsiveness, OQ-1, host integration and any broader integration — not evidenced and not authorized.
