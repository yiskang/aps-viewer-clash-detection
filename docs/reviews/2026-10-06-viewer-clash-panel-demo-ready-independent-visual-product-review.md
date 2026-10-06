# Viewer Clash Panel demo-ready package — independent visual/product review

Date: 2026-10-06  
Repository: `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`  
Baseline: `main == origin/main == eeb356dcf14f66afc62735724f134769c7d72e48`  
Scope: the uncommitted Viewer Clash Panel demo-ready/product-facing package only

## Verdict

**Ready for demo/product-facing checkpoint.**

**Findings: 0 Critical / 0 High / 0 Medium / 11 Low.** None of the Low findings blocks the current Structure + Mechanical, localhost, SVF2 demo checkpoint.

This is a product/demo verdict, not a G2 acceptance verdict. Historical G2 remains `FAIL (row 3)`; C6 remains `NOT_EVIDENCED`; C8 remains unresolved. No retry, authorization record, attempt reset, procedure change, or G3 work occurred.

## Repository and scope verification

- `main` and `origin/main` both resolve to `eeb356dcf14f66afc62735724f134769c7d72e48`.
- The working tree contains the demo host/extension/loader/styles, the DockingPanel geometry correction, directly related tests, the demo evidence package, its internal review, prompt, and handoff update. No tracked or untracked Core, Viewer Adapter, G2 harness, authorization, acceptance-procedure, or immutable-evidence change was found.
- The Panel host is composed above the existing packages: `CollisionWorld` → Viewer enumerator → Clash Test engine → unload wiring/catalog → `createClashPanel`. The Panel core remains unchanged except for the DockingPanel shell geometry.
- The default page statically imports only the lightweight extension registration. The full `clashtest`/`clashpanel` host graph is loaded by the dynamic import in `ClashPanelExtension._ensureHost()` only on first Panel use.
- `git diff --check` is clean. Nothing was committed or pushed by this review.

## Snapshot-first visual assessment

I inspected every retained PNG directly. The directory contains **16**, not 15, images: the report index omits `09-switch-result-5.png`.

| Snapshot | Independent verdict | Observation |
|---|---|---|
| `01-viewer-loaded.png` | PASS | Both models and the Panel toolbar control are visible. |
| `02-panel-open.png` | PASS | Top-left placement, opaque body, bounded usable viewport. |
| `03-test-configured.png` | PASS | Structure/Mechanical configuration is clear and Run is available. |
| `04-running.png` | PASS | Busy/progress state is coherent; duplicate Run is prevented and Stop is available. |
| `05-results.png` | PASS | Bounded, scrollable ordered result list. |
| `06-result-selected.png` | PASS | Selected row, two-side outlines, marker, details, and action controls are visible. |
| `07-isolate.png` | PASS | Guarded isolation is visibly applied to the selected elements. |
| `08-markers.png` | PASS | Beam/elbow clash is understandable; the marker is small but visible. |
| `09-switch-result-1.png` | PASS | Switching updates selection/presentation coherently; Floor union framing is broad but understandable. |
| `09-switch-result-5.png` | PASS | The additional retained switch/list-scroll state is coherent. |
| `10-switch-result-20.png` | PASS | Repeated switching remains visually coherent. |
| `11-panel-closed.png` | PASS | Panel is hidden and no Panel-owned presentation remains. |
| `12-panel-reopened.png` | PASS | Results persist across hide/show; stale isolation/overlays do not reappear. |
| `13-empty-filter-state.png` | PASS | Empty-filter wording and recovery action are clear. |
| `14-cleared.png` | PASS | Idle/cleared state is coherent and presentation is gone. |
| `15-cancelled-run.png` | PASS | Cancelled partial result is readable and explicitly incomplete. |

**Visual total: 16 PASS / 0 FAIL / 0 INCONCLUSIVE.**

## Independent headed reproduction

The retained evidence was not used as the only proof. I opened `http://localhost:8080/?clashPanelDemo=1` in a headed browser against the real local server and Viewer 7.124.2. `npm start` was attempted; because its prestart vendor-copy step could not write under the read-only implementation review boundary, I started the already-built server directly with `node server.js`. The browser application and server entry point were otherwise the same.

Verified live:

- Structure and Mechanical loaded; the toolbar opened the Panel; A/B configuration ran a Hard federated test.
- Full run: **491 clashes**, coverage full, integrity caveated, freshness current.
- A fresh run stopped after the first work unit sealed **394 partial clashes**, coverage partial, reason `cancel-requested`.
- Result selection, focus-on-select, markers/outlines, guarded Isolate, Back to All, filter empty state, Clear filters, and page `1 / 10` → `2 / 10` → `1 / 10` all worked.
- Hiding and reopening retained the 491-result set without restoring stale Panel-owned isolation/overlays. Clear returned the Panel to `Idle · Ready to run`.
- Console: **0 errors** and no unhandled rejection or duplicate-registration symptom. One expected Viewer deprecation warning was present for `Model#getInstanceTree`.
- The default URL loaded without the Panel demo flag and produced **0 console errors**. Source/config tests confirm the legacy initializer and Room Locator/Clash Finder extension list remain the default; the Panel is not auto-loaded.

## Product adjudications

### Framing / marker scale

**Classification A — acceptable current v1 behavior.** The ViewerBridge implements the accepted §9.2 union-of-live-sides framing. Beam/elbow results are clear. Floor/elbow results make the clash a small speck, but the selected row, element identities, colored bounds outlines, location marker, and Isolate action keep the workflow understandable. This is a worthwhile future UX improvement, not a checkpoint blocker and not evidence that C8 is closed.

### Viewer object selection

**Classification A — implementation is correct; the demo criterion must be read as Panel selection/presentation, not Viewer selection.** Design §9.2 explicitly says the Panel does not change Viewer selection, and §18 defers Viewer selection sync. Source search found no Panel `viewer.select`, `clearSelection`, or theming call. v1 uses Panel selection, outlines, markers, isolation, and fit as designed. No owner decision is required for this checkpoint.

### Reload persistence

The `modelKey = urn#loadSeq` policy makes cross-page reload resume unavailable. This is an explicit §18 v1 deferral and an acceptable demo limitation. It remains future host/OQ-1 integration work; it is not a defect in this in-page demo.

### Lazy loading / default-page containment

Accepted. The full host graph is dynamically imported only after the Panel button is used. A host-graph load failure is caught in the Panel extension and cannot prevent the default sample from starting. The default initializer remains `AutodeskProduction` without an `api` override; Room Locator and Clash Finder remain auto-loaded, while Clash Panel is registered but not auto-loaded.

## Findings

### Critical

None.

### High

None.

### Medium

None. The internal review's framing and Viewer-selection Mediums are design-aligned limitations, not unresolved product defects.

### Low

| ID | Finding | Disposition |
|---|---|---|
| L1 | Toolbar button active state is not synchronized with Panel visibility. | Visible polish only; opening/closing remains stable. |
| L2 | Two rapid first-use clicks can share host creation and toggle twice, ending closed. | Minor first-use race; no leak/corruption. |
| L3 | A failed model registration may retry on later catalog events and repeat warnings. | Noise only on a failed path. |
| L4 | Catalog listeners are removed after engine disposal begins. | Narrow teardown-noise window; all cleanup steps still run. |
| L5 | Viewer does not await an extension's async `unload()`. | Demo teardown can log late errors; normal hide/clear behavior is unaffected. |
| L6 | Plain HTTP on a non-localhost LAN origin lacks `crypto.randomUUID`. | Launch limitation: use localhost or HTTPS. |
| L7 | Panel geometry is fixed at 460 px and can occlude a narrow canvas. | Acceptable at the evidenced desktop viewport; responsive polish remains. |
| L8 | Numbered section headings can read like debug numbering, especially “4 RESULTS.” | Cosmetic wording only. |
| L9 | A later hash change in demo mode can replace the demo pair according to existing load controls. | Documented sample behavior; no current demo-flow impact. |
| L10 | `modelVersion` can show `urn:urn:…` if Viewer data already includes the prefix. | Cosmetic interim OQ-1 witness issue. |
| L11 | Evidence report says/indexes 15 snapshots while 16 PNGs exist. | Documentation indexing defect; the omitted image was reviewed and passed. |

None of the internal-review Low findings is product-blocking. The small marker and broad Floor framing remain known, design-consistent visual limitations rather than additional blocking findings.

## Automated verification

- `npm run test:offline`: **5,177 total / 5,176 pass / 0 fail / 1 existing todo**.
- `npm run test:clashpanel:dom`: **83/83 pass**.
- The focused demo wiring/lifecycle/style tests are included in the offline aggregate and pass: extension lifecycle, host/catalog/teardown, query-option isolation, layering guard, default/opt-in Viewer configuration, and DockingPanel geometry.
- The first sandboxed offline attempt was invalid because tests that deliberately create temporary mutant files and local listeners received `EPERM`; the required unrestricted rerun completed with the exact expected result above. No confidence retry was performed after the clean run.

## Separate verification debt

The product-facing package does not hide or resolve the historical acceptance debt:

- G2 remains `FAIL (row 3)`.
- C6 remains `NOT_EVIDENCED`.
- C8 remains unresolved.
- No G2 retry, live diagnostic, authorization record, attempt reset, procedure edit, or G3 work occurred.

## Readiness and next action

**Product/demo status:** ready for demo/product-facing checkpoint. Framing is acceptable for v1, Viewer selection is correctly excluded by the governing design, and reload persistence is a non-blocking v1 limitation.

**Verification-debt status:** unchanged and separate; this review makes no acceptance-closure claim.

**Exact next action:** obtain owner authorization for one scoped checkpoint commit/push containing the current demo-ready package, this independent review, and the updated handoff. No product correction, G2 research, or owner screenshot adjudication is required first.
