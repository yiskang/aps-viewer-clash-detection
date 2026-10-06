# Viewer Clash Panel product continuation — independent visual/product review

Date: 2026-10-06  
Baseline reviewed: `main == origin/main == d45703f21b9001bd8114fbf0fcbc7263e5046cb1`  
Verdict: **ready for product-facing checkpoint**

## Executive verdict

The complete uncommitted L1–L11 continuation package is accepted for a product-facing checkpoint. The final implementation, DOM, and focused suites pass after all source changes. A fresh headed Chromium reproduction completed the Structure-versus-Mechanical Hard run with 491 clashes and exercised the toolbar, panel, Viewer actions, result switching, restore, retention, Clear, and default URL. No in-scope screenshot is a FAIL. Screenshot 13 remains correctly INCONCLUSIVE and screenshot 13b is the authoritative final cancellation state.

Severity: **0 Critical / 0 High / 0 Medium / 4 Low**. None of the Low findings requires an implementation change before checkpoint. The evidence report's console wording should be read with the independent observation below.

## Repository and scope verification

- Repository: `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`; branch `main`; local and remote-tracking HEAD both `d45703f21b9001bd8114fbf0fcbc7263e5046cb1` before review writes.
- The pre-review tree contained only the product-continuation source/tests/docs, its prompt, evidence, internal review, and handoff. `git diff --check` was clean. Nothing was committed or pushed.
- The source diff stays within the eleven authorized polish items: extension visibility/concurrency/unload behavior, catalog failure/disposal/version handling, UUID fallback, responsive panel width, and heading text. No new Group By behavior, cross-reload persistence, Viewer object selection, framing semantics, milestone, or G3 implementation appears.
- Historical verification debt is unchanged: G2 `FAIL (row 3)`, C6 `NOT_EVIDENCED`, C8 unresolved. No G2 retry, authorization issue/reset, attempt reset, acceptance-procedure change, or G3 work occurred.

## Findings

### Critical / High / Medium

None.

### Low

1. **Fallback UUID entropy.** The final fallback uses `crypto.getRandomValues` when available and otherwise combines `Math.random`, time, and a per-generator counter into a UUID-v4-shaped identifier. These identifiers are internal run/controller identifiers, not secrets, authentication credentials, or security boundaries. The remaining collision risk in the rare no-Web-Crypto branch is acceptable for this demo checkpoint, but the fallback must not be represented as cryptographically strong.
2. **Narrow-viewport polish.** At about 700 px, the 460 px Panel remains usable and leaves Viewer canvas visible, but the Viewer/header toolbar clips and the page gains horizontal overflow. This is a Low responsive-polish issue, not a supported desktop-demo blocker.
3. **No exact automated L7 width assertion.** The DOM geometry test still verifies anchoring, bounded height, scroll, and opacity, but does not pin `width: min(460px, 90vw)`. The source value and headed 700 px snapshot establish the current behavior; adding a direct assertion is optional hardening.
4. **Console evidence wording is too narrow.** The independent headed run produced zero console errors, the expected `Model#getInstanceTree` deprecation warning, and three Viewer-origin `BubbleNode.getAecModelData` deprecation warnings while exercising focus/isolation. This is non-blocking third-party Viewer noise, but it contradicts the evidence report's literal “1 warning” statement. The independent record supersedes that count; no product failure accompanied the warnings.

The internal review's stop-count variability observation is **not** a defect. Cancellation is asynchronous and the contract requires a coherent sealed partial result, not an exact clash count.

## Final-state verification

| Gate | Independently observed result | Verdict |
|---|---:|---|
| `npm run test:offline` | 5,185 total; 5,184 pass; 0 fail; 1 existing todo | PASS |
| `npm run test:clashpanel:dom` | 83/83 pass | PASS |
| Focused extension + host tests | 23/23 pass | PASS |
| `git diff --check` before review writes | clean | PASS |

The focused run covers button-state synchronization, rapid first-use coalescing, failed registration, catalog-before-engine disposal, UUID/modelVersion behavior, and unload idempotency. The DOM suite covers the thin shell, close visibility path, Viewer-independent presentation, headings, accessibility, and cleanup.

## Headed product reproduction

Fresh headed Chromium against `http://localhost:8080/?clashPanelDemo=1` verified:

- a rapid first double-click creates one panel and leaves it open with the toolbar button active;
- Structure Set A versus Mechanical Set B completes with **491 clashes**, full coverage, caveated integrity, and current freshness;
- result selection, Focus, guarded Isolate, Markers off/on, switching from clash 5 to clash 6, and Back to all work;
- panel X-close hides the panel and changes the toolbar class to `inactive`; reopen restores the 491-result state without stale selection/overlay; Clear returns to Idle/Ready and an empty Results state;
- the default URL loads without a Clash Panel button/panel and with no console error.

Runtime console: zero errors. Besides the expected `getInstanceTree` warning, the reproduction recorded the additional Viewer-origin AEC-data warnings described under Low 4.

## Snapshot adjudication

All **17** retained continuation PNGs were independently opened and inspected. The request's “16 PNGs” count is stale; the directory and evidence index correctly contain 17 because 05b, 07b, and 13b are separate files.

| Snapshot(s) | Verdict | Independent observation |
|---|---|---|
| 01–04 | PASS | inactive toolbar → active/open Panel → running → completed 491 |
| 05, 05b, 06 | PASS | selected clash, explicit Focus, and guarded isolation are visibly coherent |
| 07, 07b, 08 | PASS | markers on/off and Back to all restore are visually distinct and coherent |
| 09–12 | PASS | X-close state, reopen retention, Clear, and usable 700 px layout |
| 13 | **INCONCLUSIVE** | still `Stopping`; 394 is an interim count and is not a product PASS |
| 13b, 14 | PASS | sealed cancelled partial state at 472 and plain sentence-case headings |

Summary: **16 PASS / 0 FAIL / 1 INCONCLUSIVE**. Screenshot 13b is the authoritative final state for the stop sequence. The change from 394 in an earlier run to 472 here is valid asynchronous-cancellation timing: the current unit is allowed to finish before sealing partial results, so exact counts are not contractual.

## L1–L11 closure

| Item | Disposition |
|---|---|
| L1 toolbar state | Closed: open/toolbar toggle and panel X-close remain synchronized; independently reproduced. |
| L2 rapid first clicks | Closed: concurrent first opens share one creation/open action; one panel exists and remains open. |
| L3 failed registration | Closed: one attempt/one report per model; later catalog events do not retry it. |
| L4 listener disposal | Closed: catalog listeners detach before Panel/engine/wiring/world teardown; every later step is independently attempted. |
| L5 unload idempotency | Closed: one disposal promise, late creation/callbacks are quiet, repeated unload does not double-dispose. |
| L6 LAN UUID fallback | Acceptably closed with Low 1: operationally available without `randomUUID`; non-security fallback only. |
| L7 width | Acceptably closed with Lows 2–3: source is `min(460px, 90vw)` and the narrow snapshot is usable. |
| L8 headings | Closed: plain sentence-case headings are implemented, tested, and visible. |
| L9 hash replacement | Closed as documentation-only behavior; no hidden code scope expansion. |
| L10 modelVersion | Closed: `normalizeUrnKey` prevents `urn:urn:` duplication, with direct tests. |
| L11 evidence index | Closed: the index names every actual PNG; the correct current count is 17. |

All eleven prior Lows are closed or reduced to explicitly non-blocking debt.

## Coverage and product limits

- Hard-error visualization was not forced; existing controller/DOM failure-state tests are sufficient for this checkpoint.
- Soft mode remains deliberately unavailable for this two-model demo without a verified common measurement basis; its fail-closed behavior is covered by tests and is not a checkpoint prerequisite.
- Group by Element is already implemented and tested; a second headed screenshot is not required. URL-hash replacement is documented demo behavior, not a hidden persistence promise.
- Other browsers and video are acceptable deferred coverage. The accepted evidence envelope is headed Chromium plus retained snapshots.
- Tiny markers, union framing, no cross-reload persistence, and no Viewer selection remain explicit v1 limitations. Spec §9.2 excludes Viewer selection and retains Panel-owned presentation only; no new evidence makes these blockers.

## Separate G2 verification debt

Product-facing behavior is ready, but this does not revise verification history: G2 remains `FAIL (row 3)`, C6 remains `NOT_EVIDENCED`, and C8 remains unresolved. This review did not execute or authorize any retry, diagnostic attempt, record change, acceptance-procedure change, or G3 work.

## Readiness and next action

**Ready for product-facing checkpoint.** Final-state tests pass after all source changes; no retained in-scope screenshot is a FAIL; no owner screenshot review or owner-only UX decision is required.

Exact next bounded action: **owner-authorized checkpoint commit and push of the product-continuation package, this independent review, and the updated handoff.**
