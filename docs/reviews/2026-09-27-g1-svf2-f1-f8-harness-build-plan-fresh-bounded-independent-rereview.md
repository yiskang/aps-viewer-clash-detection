# Fresh bounded independent re-review — G1 SVF2 F1–F8 harness build-plan remediation

- **Date:** 2026-09-27
- **Repository:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`
- **Branch / HEAD reviewed:** `main` / `feeb5b3149ace650598a7cb96a7efabb6360fe29`
- **Primary artifact:** [`docs/research/2026-09-27-g1-svf2-f1-f8-harness-build-plan.md`](../research/2026-09-27-g1-svf2-f1-f8-harness-build-plan.md)
- **Remediation record reviewed:** [`docs/reviews/2026-09-27-g1-svf2-f1-f8-harness-build-plan-bounded-remediation-internal-review.md`](2026-09-27-g1-svf2-f1-f8-harness-build-plan-bounded-remediation-internal-review.md)
- **Prior independent authorities:** [`initial independent review`](2026-09-27-g1-svf2-f1-f8-harness-build-plan-independent-review.md) and [`prior bounded remediation re-review`](2026-09-27-g1-svf2-f1-f8-harness-build-plan-remediation-bounded-independent-rereview.md)
- **Scope:** only the latest remediated/high-risk control, timeout, F4/F5, cleanup, bounds, F8, external-identity, serialization, and aggregate-verdict areas, plus directly referenced repository APIs. No harness implementation or live execution was performed.

## Verdict

**Revise before harness implementation authorization.** The latest remediation resolves the original mandatory-control state gap, makes F4 exercise the real geometry-consumer path, separates F5 capacity semantics correctly, and substantially improves cleanup/evidence accounting. Two High implementation-safety gaps remain: the Viewer-load timeout lifecycle is not mechanically coherent across the browser/Playwright boundary, and the Viewer-script byte identity is not a required input to the aggregate verdict. Four Medium/Low consistency issues should be corrected in the same bounded pass.

**Finding count:** 0 Critical / 2 High / 3 Medium / 1 Low.

## High findings — blocking

### H1 — Viewer-load timeout disposal crosses realms and cannot be implemented as written

**Plan sections:** §4.3 resource ledger; §6.4a “Three-way cancellation classification,” “Document-load vs. loadDocumentNode late-arrival handling”; §6.4b normative load-stage outcome table.

The plan correctly distinguishes a late `Document` from a late `Model`, but its terminal-state mechanism is not coherent with the actual execution boundary:

- `Autodesk.Viewing.Document.load` and `viewer.loadDocumentNode` run in the browser page; their callbacks are in-page callbacks. The existing acceptance scripts explicitly document that functions passed to `page.evaluate` may reference only their argument and page globals.
- §6.4b says both late-arrival handlers first execute `if (page.isClosed()) return;`. `page.isClosed()` is a Node-side Playwright API and is unavailable inside an Autodesk Viewer callback running in the page.
- A timed-out Viewer load is called “drainable,” but no callback-free path is defined that can move its token from `timed-out` to `disposed` before page teardown. The ledger drains tokens before closing the page, while §6.4b relies on page closure to orphan the callback. The stated terminal-state proof therefore cannot be realized in the specified order.

**Concrete failure mode:** a late callback can throw on the nonexistent in-page `page` binding, become a fatal page error, or remain non-terminal until teardown despite the plan claiming it was drained/disposed. That makes the promised `BLOCKED` load-timeout outcome and cleanup integrity depend on an impossible guard or an unstated cross-realm protocol.

**Minimum correction:** define one explicit browser-owned load record (for example `window.__g1.loads[tokenId]`) containing generation, closing/superseded state, and a terminal promise. In-page callbacks consult only that in-page record. A late `Document` is discarded; a late `Model` is unloaded and awaited/observed as gone. Before page close, Node sets the in-page closing state and attempts the bounded drain; if it cannot drain, page closure is the explicit abandonment boundary, followed by a post-close Node token transition to `disposed/abandoned`. Remove `page.isClosed()` from all in-page callbacks and state exactly how the final token/cleanup result is computed after teardown.

### H2 — Viewer-script byte identity can be unavailable or mismatched without affecting `overall`

**Plan sections:** §8 `harnessIntegrity.remoteAssets`, especially the fallback note; §6.3 `computeOverall()`.

Capturing `response.body()` and comparing its decoded bytes with the recorded Viewer 7.124.2 digest is the correct path: the known digest is explicitly the decoded/gunzip digest, and Playwright’s response body is the decoded body. The plan, however, allows a fallback to URL/status/`Content-Length` when body capture is unavailable, and neither missing capture nor `viewerScriptMatchesKnownGood === false` participates in `computeOverall()`.

**Concrete failure mode:** a same-URL, same-length CDN replacement, redirect to different bytes, service-worker response, or unavailable body can still coexist with every Fi/control passing and therefore with `overall: PASS`. That is exactly the stale/contradictory runtime-evidence case this remediation was meant to close.

**Minimum correction:** make the Viewer script’s final response body capture and exact decoded SHA-256 match a required harness-integrity condition. A digest mismatch forces `FAIL`; unavailable body evidence forces a non-PASS outcome (`PARTIAL`/`NOT_EVIDENCED`) unless a separately retained byte source is verified. Record the final response URL, status, redirect chain, cache/service-worker provenance, decoded byte length, actual digest, expected digest, and match result per asset. `style.css` may retain its narrower run-local hash limitation because no known-good digest exists, but its absence must not be described as full byte identity.

## Medium findings — bounded corrections

### M1 — F8’s second coverage equation double-counts loaded-but-unreachable fragments

**Plan sections:** §7.2 F2 accounting; §7.8 F8 coverage/exclusion equations.

`classL` is defined from the dense population scan as every loaded, owner-resolved fragment. It therefore already includes both tree-reachable and loaded-but-unreachable `L` fragments. The F8 equation

`classL + classN + classU + loadedButUnreachableCount === fragListCount`

adds the unreachable `L` subset twice. The repository confirms that `scanPopulation` classifies every dense fragment as exactly `L`, `N`, or `U`, while `resolveWhole` computes unreachable loaded fragments as a subset of `L`.

**Minimum correction:** use both equations explicitly: `classL + classN + classU === fragListCount`, and `treeReachableCount + loadedButUnreachableCount === classL`. Keep `censusedFragmentCount === classL` as F8’s own full-census equation.

### M2 — the proposed F7 tolerance factor is not justified by the cited repository precedent

**Plan section:** §7.7 componentwise bounds tolerance.

`Float32Array(6)` establishes a float32 output floor, and componentwise comparison is appropriate. But `collision/constants.js` does not establish “4 × float32 epsilon” as a transform-roundoff bound. Its `4 × 1e-4` clearance margin is dominated by two operands’ accepted `1e-4` scale anisotropy and covers one-float32-epsilon padding by roughly 3,300×; it is not a measured four-operation matrix-transform bound. Also, a tolerance based only on the final `|coord|` can be too strict when large local coordinate/translation terms cancel to a small world coordinate.

**Minimum correction:** derive a forward-error bound from the actual transformed terms (or record a separate operand-scale/translation magnitude) plus the final Float32 quantization, componentwise. Alternatively classify the constant as a calibration gate and retain the observed deltas without making disagreement a correctness FAIL until the bounded live evidence establishes the envelope. Do not cite the clearance anisotropy constant as proof of this factor.

### M3 — classifier-stop control records fall outside the plan’s exhaustive control enum

**Plan sections:** §6.2 classifier stop; §6.3a `ControlResult`; §8 result schema.

The five local control states are otherwise exhaustive and only `DETECTED_RESTORED` is PASS-compatible. On classifier stop, however, the plan writes controls as `{status:'not-run', ...}` rather than a `ControlResult` with one of those five `state` values. This creates a second, undocumented control-state schema.

**Minimum correction:** prepopulate every control as `NOT_EXECUTABLE` with `reason:'classifier:<state>'`, `executed:false`, `detected:null`, and `restored:null`. Branch 2 still returns overall `BLOCKED`; the correction only makes retained evidence mechanically uniform.

## Low finding

### L1 — the control schema says every control perturbs shared model state, but two controls are synthetic

**Plan sections:** §6.3a `restorationRequired`; §6.5 controls.

`late-completion-after-timeout` and `invalid-geometry-consumer` intentionally perturb only harness-local synthetic state, yet `restorationRequired:true` is documented as universal because every control allegedly perturbs `modelBefore/world`. This does not create a false PASS because both still require a clean terminal/restored assertion, but it is stale normative wording.

**Minimum correction:** define restoration as “shared state restored, or synthetic state proven isolated and terminal,” or make `restorationRequired` accurately reflect the control type while still requiring `DETECTED_RESTORED` for aggregate PASS.

## Requested verification matrix

| Area | Result |
|---|---|
| Mandatory controls / verdict precedence | **Resolved except M3/L1.** Five states are exhaustive for executed control machinery; every non-`DETECTED_RESTORED` state forces FAIL after confirmed SVF2. Fatal runtime/unresolved ownership precedes classifier; Fi FAIL and mandatory-control failure precede PARTIAL; PASS requires all Fi/control success and no cleanup failure. The synthetic late-completion control snapshots F1 and never intentionally mutates its real record. |
| Timeout / late arrival | **Blocking H1.** Census deadlines and macrotask yields are coherent; Playwright `waitForFunction`/`waitForEvent` in the installed version accept `AbortSignal`. Viewer-load callback disposal and final token ownership are not coherent across browser/Node realms. |
| F4 / F5 | **Verified.** `viewer.impl.getRenderProxy(model, fragId)`, exported `adaptViewerGeometry(geometry)`, and exported `compactAndWeld(view, options)` exist with the stated shapes. Indexed/non-indexed inputs are supported. The real consumer detects out-of-range indices; the harness’s additional output-finiteness check covers the consumer’s non-finite gap. `geometry-too-large-for-sync-build` is correctly routed to F5; within-limit fixture PASS is reachable; organic breaches fail; public limits remain unchanged. |
| Cleanup / API signatures | **Correct except H1.** `registry.unregister(model)`, `registry.bindingFor(modelKey)`, `world.evictModel(model)`, and `world.dispose()` are used with the repository’s actual signatures. Viewer/model/listener/registry/world/timer/abort/control resources are listed and independently attempted. Primary evidence remains separate from cleanup failures. |
| Bounds / F8 | **Needs M1/M2.** Componentwise comparison and the class-L denominator are directionally correct; the second coverage equation and tolerance proof are not. |
| External identity / serialization | **Blocking H2; serializer otherwise acceptable.** Error traversal is field-allowlisted, depth/size bounded, circular-safe, normalized, redacted, and truncation/redaction is disclosed. Concrete cap values and exact sensitive-query-key lists may be chosen in the implementation and pinned by the required offline tests; they do not require production changes. Viewer-script hash evidence must gate overall PASS. |

## Remaining decisions and scope

- **Owner/product decisions:** none. The two High findings are technical plan corrections, not product choices.
- **Implementation-time technical confirmation:** `viewer.getAggregateHiddenNodes()`’s exact source/runtime return shape remains a bounded harness-implementation question. It does not require Core/Adapter/host changes and must be resolved before coding F7’s shape assertion.
- **Dependencies:** no production initializer, model upload/retranslation, Viewer Adapter, Core, Viewer Clash Panel, M4, OQ-1, or host-composition change is required. No G2/G3/H1/H2 work appeared.
- **Authorization:** harness implementation remains unauthorized. Live F1–F8 execution remains a separate later owner gate and is also unauthorized.

## Gate disposition

The harness plan is **not ready for implementation authorization** until H1 and H2 are corrected and independently rechecked. M1–M3 and L1 are bounded plan consistency corrections that should be folded into the same pass; none requires reopening production architecture.

