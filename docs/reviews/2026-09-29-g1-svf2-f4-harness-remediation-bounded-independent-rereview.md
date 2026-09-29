# G1 SVF2 F4 harness remediation — bounded independent re-review

**Repository state reviewed:** `main` @ `3312ae16d69c86def3c29e58cef22e343b310d17` (`origin/main` at the same commit), plus the uncommitted F4 harness/test remediation and retained baseline live-run evidence.  
**Review boundary:** F4 remediation, directly affected runtime-envelope/evidence plumbing, the three disclosed Low findings, and the standing F5 capacity fact. No live F1–F8 execution was performed.

## Verdict

**0 Critical / 0 High / 0 Medium / 3 Low.** The bounded F4 remediation is **accepted**. No further F4 harness correction is required before a future live execution. The current remediation/review set is ready for owner-authorized commit and clean-tree closeout, but neither commit nor another live execution is authorized by this review.

## Verified findings

### 1. Browser-realm consumer availability — accepted

- `SERVED_MODULE_ENTRY_POINTS` now includes `/collision/geometry/activeRangeCompaction.js`. The same list drives the Phase-0 module installation and served-module manifest.
- `installG1Modules` therefore imports the real module namespace into `window.__g1.mod`; `observeF4` obtains the exported real `compactAndWeld` from that namespace.
- The executed F4 chain is `viewer.impl.getRenderProxy(model, fragId) → adaptViewerGeometry(proxy.geometry) → compactAndWeld(adapted, options)`. The implementation supplies no substitute consumer.
- Availability is checked before the geometry census. A missing `compactAndWeld` or adapter produces a distinct `ok:false` result and a BLOCKED check record, not a per-geometry F4 defect or false PASS.
- The focused test builds `g.mod` only from the actual served entry-point list and proves identity with the production `compactAndWeld` export. Its entry-point assertion would fail against the old missing-consumer implementation.

### 2. F4 classification — accepted

- Render-proxy failures, adapter failures, consumer exceptions, consumer rejections/falsy results, and consumer non-finite output remain separately counted and durably classified.
- Consumer exceptions select `f4-weld-consumer-exception`; ordinary malformed/rejected geometry selects `f4-render-proxy-adapter-or-weld-consumer-failure`.
- `{oversized:true, reason:'geometry-too-large-for-sync-build'}` increments `oversizedGeometryCount` and is retained as capacity evidence, but does not increment `weldConsumerFailures` and does not make F4 fail.
- A valid geometry above `maxSyncTriangleCount` can therefore produce F4 PASS while F5 independently fails with `oversized-geometry-present`. The real-consumer test exercises exactly this boundary.

### 3. Durable evidence and runtime envelope — accepted

- The final F4 check retains bounded first-20 records for render-proxy, adapter, consumer, and oversized classes, plus five representative traces and unbounded aggregate counts.
- Each trace retains `geometryId`, representative `fragId`, owner `dbId`, render-proxy state, adaptation state, consumer outcome/reason/counts, oversized state, and a bounded/redacted error when present.
- `runHarness` persists these records through `buildF4CheckRecord` into `checks.F4.evidence.details`; the resulting evidence distinguishes render-proxy, adaptation, weld-consumer, and capacity-only outcomes.
- `runtimeEnvelope.playwright` is schema-required on success and Phase-0 failure paths. `main()` reads the installed package version only after Playwright imports successfully; unavailable values remain explicit `null`, never fabricated.

## Low findings

1. **Primitive throw detail loss — non-blocking.** The browser trace records `{primitive,value}`, but the later `describeError` normalization can discard the primitive's textual `value`. The exception class/count, F4 failure, and verdict remain intact; this reduces diagnostic detail only.
2. **Top-level reason precedence — non-blocking.** When a consumer exception co-occurs with another geometry-stage failure, the single top-level reason may name only `f4-weld-consumer-exception`. Counts, `failureBreakdown`, and first-N records retain the concurrent classes, so the verdict and independent audit remain correct.
3. **Exception injection location — non-blocking.** The exception test makes `model.getUnitScale()` throw while the real `compactAndWeld` call is executing, rather than forcing an internal implementation throw. It still exercises the real consumer chain and verifies the harness's exception routing, bounding, and redaction. Direct internal-exception injection would be optional hardening, not a live-run prerequisite.

None of the three Low findings blocks accepting or committing this remediation, and none requires correction before a future live execution.

## F5 standing caveat

The retained RAC result independently records `maxSyncTriangleCount` observed as **21,845** against the existing **12,000** limit. This remediation changes F4's classification and evidence plumbing only; it does not change the limit, `scoreF5`, or the underlying fixture observation. A future run against the same fixture is therefore expected to record F4 PASS for capacity-only oversized geometry and F5 FAIL. Under the current contract, the RAC fixture cannot produce overall G1 PASS without a separately authorized F5 capacity/fixture disposition.

## Verification

- Focused harness suite: **659/659 pass**, 0 fail, 0 todo.
- Aggregate offline suite: **4,246 total / 4,245 pass / 0 fail / 1 existing todo**, exit 0.
- The first restricted aggregate invocation could not open three local test sockets (`EPERM`) and also hit the unchanged timing-sensitive baseline test. The required rerun with local-socket permission completed cleanly; no test or timing threshold was modified and no confidence-only retry was performed.
- No new live G1 evidence was produced and no live rerun occurred.
- The diff contains no production/Core/Viewer Adapter/M4/Panel/host/OQ-1/G2/G3 change. It is confined to the harness, directly affected tests, reviews/research/status artifacts, and handoff.

## Gate disposition

- **F4 remediation:** accepted.
- **Further F4 harness fix before another live run:** none required.
- **Commit/clean-tree closeout:** technically ready, but requires explicit owner authorization.
- **Live F1–F8:** remains unauthorized. F5's genuine capacity finding remains a separate prerequisite/owner decision; this review does not reinterpret it.
