# CTM-7 F-1 Option B remediation — final report (2026-10-11)

## 1. Repository state
`/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`, branch `main`, HEAD `85aee23` == `origin/main`. Tree uncommitted/unpushed: production `clashpanel/core/testsManager.js` (+7/−1), `test/clashpanel/core/testsManager.core.test.mjs`, spec §26.6/AC-M10, plan CTM-7 row, handoff, this report, `docs/research/evidence-support/ctm-7-h-revalidation/`, plus the prior untracked CTM-7 package files.

## 2. Authority and scope
Owner selected **F-1 Option B** (hidden model stays runnable; hide is visibility, not unavailability; actual unload/unregister stays unavailable). Governing: spec §26.5–§26.6/AC-M4/AC-M10, plan CTM-7, [Independent Work Review](../reviews/2026-10-11-clash-tests-manager-ctm-7-headed-svf2-validation-independent-work-review.md). Upstream CTM-7 report and the review are unmodified. No CTM-8, L1–L8, commit/push, or headed run.

## 3. Source/event investigation (Viewer 7.124.2 bundle, decompressed to scratchpad only)
- `Viewer3D.hideModel` = `impl.removeModel(model)` (fires `MODEL_REMOVED_EVENT` synchronously) then `modelQueue().addHiddenModel(model)` (**fires no event**). `getAllModels()` = visible ∪ hidden. `ViewerBridge` relays `MODEL_REMOVED` as `reason:'removed'`, `BEFORE_MODEL_UNLOAD` as `'unload'`. `hideModel` fires no `BEFORE_MODEL_UNLOAD`.
- So **during** the hide event the model is in neither list; **after** the synchronous call it is listed again, silently. Real unload of a visible model: `BEFORE_MODEL_UNLOAD` (listed) → catalog drops → `MODEL_REMOVED` (absent). Hide-then-unload leaves a harmless stale `departed` entry (key never reused).
- Same-key `showModel` fires `MODEL_ADDED` (catalog change) — recovery path unchanged. New-key reload: new key, old test stays bound to old key.

## 4. Root cause (corrects the review's mechanism)
The review's "departed overlay" explanation (`listedKeys` still lists the key) is **not** what happens in the real Viewer: at event time the key is already absent, so `departed` was never set. The actual cause: the host catalog's own `MODEL_REMOVED` handler and the bridge event invalidate the Manager's derived cache **inside** the gap, computing "not loaded"/"Models changed"; the model is re-listed with no event, so the cache (keyed on `catalogEpoch`) stays stale until `showModel`'s `MODEL_ADDED`. This matches the headed evidence (stale after 6 s; recovers on show). An initial implementation that only skipped `departed` for `'removed'` passed harness tests but was a **runtime no-op**; the internal review (subagent, verified against the bundle by the package agent) caught it.

## 5. Implementation (`clashpanel/core/testsManager.js` `onModelLeft`)
- `'removed'` additionally schedules one `invalidate(m)` in a microtask (after the synchronous Viewer call returns) so readiness/models-changed recompute against the re-listed model. Real unload stays missing on the second read (key absent or departed).
- Only `reason:'unload'` departs a still-listed key; `'removed'` never departs and never un-departs. Editor/Core/Adapter/collision/host untouched.

## 6. Tests (TDD; red first)
`testsManager.core.test.mjs` +4 tests: (a) real-order hide (remove → `'removed'` → catalog fire → re-add silently → microtask) settles to `setup-complete`/not changed for two records, then a real visible-model unload stays `models-missing`/changed — **red before** the microtask fix; (b) harness hide-only (key still listed) unchanged + show causes no flap; (c) unload/removed in both orders departs and `'removed'` never un-departs; (d) hide-then-unload departs, new-key reload never rebinds. Existing same-key re-entry/removal tests unchanged and green. No test weakened.
Limitation: (b) uses a fake that keeps the key listed during `'removed'` (not real-Viewer order); (a) is the faithful one. The duplicate record in (a) has no summary, so the completed-result "models changed" check covers `test-1` only (the active record with a summary).

## 7. Verification
- Focused `testsManager.core.test.mjs`: 29/29.
- `npm test` exit 0: offline **5617 total / 5616 pass / 0 fail / 1 existing todo** (prior 5613/5612, +4); DOM **136/136**.
- `git diff --check` clean. Protected-path diff (Core other than `testsManager.js` line change, Adapter, collision, host `wwwroot`, ports, server, package): zero diff.

## 8. Normative reconciliation
Spec §26.6 (hide bullet, re-entry bullet) and AC-M10; plan CTM-7 row. Historical reviews/reports untouched. Note: spec §11.2/§9.1 editor-level "not in scene" semantics during the event are unchanged (editor re-polls).

## 9. Internal review (subagent, read-only, opus)
High H-1 (fix no-op in real Viewer) — **verified and fixed** (§4–5). Medium M-1 (harness unlike Viewer; missing real-order test) — fixed by test (a). M-2 (spec/plan mechanism wrong) — fixed. Low L-1 (stale `departed` after hide→unload) — accepted, harmless, not changed. Low L-2 (stale comment) — fixed. Clean: unload ordering, new-key, same-key, evidence-support isolation from production, no L1–L8/CTM-8 drift. Residual: transient in-event missing state is still computed for one microtask (not observable to users); not a headed-verified result.

## 10. Future H revalidation support
`docs/research/evidence-support/ctm-7-h-revalidation/` — `capture-helper.js` (read-only, console-paste, `window.__ctmCapture`), `CAPTURE-SCHEMA.md`, `PROTOCOL.md` (settle rules, H0–H10 sequence, sha256 manifest convention). Not run; rebuilt from prior JSON shape + source, so exact parity with the lost helper is unproven; some DOM selectors and `hideModel` argument types are source-derived, unconfirmed live (listed in the subagent hand-back: `.clash-manager-*` selectors, `draft.revision`, overlay scene internals). Not wired into production paths (grep-verified).

## 11. Limitations / readiness
No headed proof that real hide now stays Ready in the Manager; that is the separately authorized H revalidation. Ready for **Independent Work review** of this package.

## 12. Next gate
Independent Work review of the F-1 Option B remediation; then (only if separately authorized) one bounded headed H revalidation. CTM-8, L1–L8, commit/push remain unauthorized.
