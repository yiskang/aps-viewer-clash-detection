# G1 SVF2 F1–F8 baseline `3312ae1` live run — independent verification

**Reviewed repository:** `main` @ `3312ae16d69c86def3c29e58cef22e343b310d17` (`origin/main` identical)  
**Retained execution:** `2026-09-29T11:10:43.525Z`–`11:10:49.899Z`  
**Independent verdict:** **0 Critical / 1 High / 1 Medium / 1 Low.** The retained evidence supports one real, completed, no-retry SVF2 run and the recorded overall `FAIL`. The authorization was consumed. F1 is now valid and closes the prior digest-oracle failure, but F4 did not execute the real weld consumer because the harness did not install its module namespace. F5 independently establishes that the fixture exceeds the existing per-geometry synchronous-build ceiling.

No live run was performed by this review. No harness, production, Core, Viewer Adapter, M4, Panel, G2/G3, host H1/H2, OQ-1, or host-integration code was modified.

## Sources and boundary

This review independently read the authorization prompt, raw JSON, empty raw log, human report, current handoff, accepted build plan, governing Panel design, prior live-run review, exact harness source, `compactAndWeld` implementation, current Git state, and commit history. Structural call/dependency checks were made against the indexed repository and source was read directly for exact runtime wiring and evidence fields.

The raw JSON is the authoritative run record. The human report is a faithful summary except where this review supersedes its unresolved F4 diagnosis and its statement that Playwright `1.62.1` is part of the retained run envelope.

## Findings

### Critical

None.

### High — H1: F4 never installed the real `compactAndWeld` module namespace

**Type:** harness wiring/oracle defect. **Disposition:** blocks accepting F4 and blocks another live authorization until a bounded harness/test-only remediation and targeted independent re-review are complete.

The accepted plan requires F4 to exercise the real `viewer.impl.getRenderProxy → adaptViewerGeometry → compactAndWeld` path and treats `geometry-too-large-for-sync-build` as an F5 capacity outcome, not an F4 defect (`docs/research/2026-09-27-g1-svf2-f1-f8-harness-build-plan.md:938-957`). The harness's in-page `observeF4` does attempt to read:

```js
const { compactAndWeld: weld } = mod['/collision/geometry/activeRangeCompaction.js'] || {};
```

at `test/acceptance/g1-svf2-f1-f8-verification.mjs:5123`, then calls `weld(...)` at `:5239`. However:

- `SERVED_MODULE_ENTRY_POINTS` at `:1861-1875` does not include `/collision/geometry/activeRangeCompaction.js`;
- `installG1Modules` at `:7083-7100` imports and stores only the supplied entry points in `window.__g1.mod`;
- `main()` passes exactly `SERVED_MODULE_ENTRY_POINTS` to `installG1Modules` at `:9717-9719`;
- the served-module manifest contains `activeRangeCompaction.js` only because it is a transitive dependency. Manifest discovery/hash coverage does not install its namespace under `g.mod['/collision/geometry/activeRangeCompaction.js']`.

Therefore `weld` was `undefined` during the retained run. Each of the 348 otherwise-successful adapted geometries threw at the same call site and was counted as a weld-consumer failure. This exactly explains `weldConsumerFailures:348`, `weldConsumerSuccessCount:0`, with zero render-proxy and adapter failures. The real `compactAndWeld` consumer never ran.

**Minimum correction:** add the real module to the installation contract (or otherwise import that exact namespace into `g.mod`), fail Phase 0 if its export is unavailable, and add an offline integration test using the real entry-point/install list rather than a pre-populated fake `g.mod`. No production, Core, or Viewer Adapter change is required.

### Medium — M1: the durable F4 record discards the bounded failure detail required by the plan

**Type:** evidence-integrity gap. **Disposition:** include in the bounded harness remediation before another live run.

`observeF4` returns `first20RenderProxyFailures`, `first20GeometryAdapterFailures`, `first20WeldConsumerFailures`, and `oversizedGeometryIds` at `test/acceptance/g1-svf2-f1-f8-verification.mjs:5290-5293`. The accepted plan requires these bounded records at `docs/research/2026-09-27-g1-svf2-f1-f8-harness-build-plan.md:951-952`.

`runHarness` persists only `f4Score.fields` at `test/acceptance/g1-svf2-f1-f8-verification.mjs:8265-8270`. The final JSON therefore retains only aggregate counts and cannot independently show the exception class or affected geometry IDs. Source inspection is sufficient to diagnose this run's deterministic wiring defect, but the durable artifact alone is not sufficient to audit an arbitrary future F4 failure.

**Minimum correction:** persist the bounded F4 detail under `checks.F4.evidence.details`, including the first-20 failure lists and oversized geometry IDs, without changing F4 scoring.

### Low — L1: Playwright version is not bound into the run JSON

The retained runtime envelope records Node `v22.23.1`, Chromium `151.0.7922.34`, Viewer `7.124.2`, model URN, and initializer, but not Playwright. The installed repository dependency currently reports `1.62.1`; the human report explicitly says this value came from the prior envelope and was not re-recorded. This does not invalidate the run, but it is weaker than the authorization's requested per-run version retention.

**Minimum correction:** record the live process's Playwright package version in `runtimeEnvelope` during the bounded harness remediation.

## Execution authenticity and attempt accounting

The retained evidence supports the following:

- branch/HEAD was `main` @ `3312ae16d69c86def3c29e58cef22e343b310d17`, identical to `origin/main`; the recorded harness SHA-256 `fc928289f91a48aaae33f36ace72d9dc77d63560f63b4dee2fde574d7e0611c1` matches the reviewed file, and all 88 recorded served-module SHA-256 values match the current files at that exact baseline;
- the only allowed dirty path before browser activity was the untracked authorization prompt; the captured Viewer script digest matches the pinned expected digest and its integrity state is `VERIFIED`;
- the model URN decodes to the accepted RAC Basic Sample Project fixture; initializer is `AutodeskProduction2` / `streamingV2`; runtime signals are `isOTG() === true`, `isSVF2() === true`, classifier `CONFIRMED_SVF2`;
- the report records the authorized command and process exit `1`, which matches the harness's implemented `FAIL → 1` exit mapping;
- one durable run/result set exists for this authorization and the report records no retry. Repository evidence supports exactly one real live attempt; it cannot prove the absence of activity outside the retained repository records.

Because the real model loaded, classification completed, F1–F8 phases executed, controls ran, and F6 performed the reload sequence, the exactly-one authorization was **consumed**. The empty raw log is acceptable: the harness emits no normal console output and the JSON is the authoritative record.

## F1–F8 verification

| Check | Recorded | Independent disposition |
| --- | --- | --- |
| F1 | `PASS` | Valid. 789/789 population rows, 467/467 roots, equal population digest, no subtree/population oracle errors or mismatches, and retained row samples include `geometryId`. The previous live F1 failure is conclusively attributable to the old harness digest-row defect within this same fixture/runtime envelope; it is not evidence of SVF2 incompatibility. |
| F2 | `PASS` | Accepted as recorded; population accounting closed. |
| F3 | `PASS` | Accepted as recorded; initial readiness probe resolved under the real Adapter gate. |
| F4 | `FAIL` | Recorded score is mechanically explained by H1, but is not a genuine SVF2/Viewer geometry-compatibility result. Render-proxy and geometry adaptation succeeded for all 348 distinct geometries; the real weld consumer was never invoked. |
| F5 | `FAIL` | Genuine existing-capacity finding: `maxActiveTriangleCount` is computed from each successfully adapted geometry before the broken weld call, and its maximum was 21,845 versus the accepted 12,000 limit. This is a per-geometry maximum, not an aggregate/sum. It is independent of H1. |
| F6 | `PASS` | Accepted as recorded; unload/reload and stale-event checks passed. |
| F7 | `NOT_EVIDENCED` | Expected calibration outcome, not H1 fallout: 467 dbIds were censused; 457 agreed and 10 were `exceeds-envelope`, which `scoreF7` intentionally maps to the calibration-gated state. |
| F8 | `PASS` | Accepted as recorded; ownership/tree/Adapter census equations closed. |

F4 and F5 are **not the same failure double-counted**. F4 is a harness module-install defect. F5 uses `activeTriangleCount` obtained before the failed weld invocation and independently proves at least one adapted geometry is above the existing ceiling. However, F4's recorded `oversizedGeometryCount:0` is not reliable because `compactAndWeld` never ran; the current F5 `FAIL` remains correct because 21,845 independently exceeds 12,000. The durable evidence does not retain the responsible geometry ID.

No genuine SVF2 geometry-format incompatibility is established by this run. The supported conclusion is narrower: the fixture's Viewer render proxies and `adaptViewerGeometry` inputs were readable, while the fixture contains at least one geometry above the current synchronous-build capacity ceiling.

## Mandatory controls, ledger, cleanup, and verdict

All nine mandatory controls are `DETECTED_RESTORED`, with `executed:true`, `detected:true`, and `restored:true`. The two target-bearing controls have valid durable target evidence:

- `wrong-owner`: fragment `0`, real owner `4788`, injected owner `2147483647`, authoritative F1 population, deterministic numeric-minimum selection;
- `hidden-fragment`: fragment `0`, tree owner `4788`, acted-on fragment `0`, authoritative F1/F2 intersection, deterministic numeric-minimum selection.

The other seven controls also reached their reviewed success state. The synthetic `invalid-geometry-consumer` control does not rescue F4: it invokes a Node-side imported consumer with synthetic data, while H1 is specifically the browser-realm module-install path used by the live F4 census.

The fatal-error ledger is empty, `sessionTainted:false`, `cleanupFailures:[]`, and `cleanupUnresolvedOwnership:false`. Cleanup and restoration passed.

The overall `FAIL` is mechanically correct. With a confirmed classifier and verified Viewer identity, either F4 `FAIL` or F5 `FAIL` independently reaches `computeOverall`'s Fi-failure branch. F7's missing calibration evidence cannot downgrade either positive failure to `PARTIAL`.

## Evidence sufficiency

Sufficiently retained:

- exact branch/HEAD, command (human report), timestamps, harness/dependency hashes, model/runtime/initializer/classifier identity;
- all F1–F8 verdicts and core fields, all mandatory controls and targets, fatal ledger, cleanup, and overall verdict;
- complete F1 digest/oracle evidence needed to close the prior F1 issue;
- F5 values and limit comparisons needed to establish the 21,845 > 12,000 breach.

Missing or under-specified:

- F4's returned bounded failure lists and oversized geometry IDs are discarded from final JSON (M1);
- Playwright version is not captured in the run JSON (L1);
- the responsible geometry ID for `maxActiveTriangleCount` is not retained. The accepted F5 schema requires the maximum and limit result, so this is useful hardening rather than a separate blocking finding; it should be added while touching the F4/F5 evidence carrier.

## Scope verification

The baseline commit and current working-tree changes contain no production/Core/Viewer Adapter/M4/Panel changes. The live task added only the authorization prompt, report/evidence, and handoff update. No G2/G3, host H1/H2, OQ-1, or host-integration work was started. No production fix was made.

## Gate and exact next owner decision

**G1 is not accepted and another live run is not authorized.** The current authorization is consumed.

The next owner decision is whether to authorize one bounded **harness/test-only** remediation that:

1. installs and validates the real `activeRangeCompaction.js` namespace for browser-realm F4;
2. persists the required bounded F4 failure/oversized evidence and the responsible max-triangle geometry ID;
3. records Playwright version in the run envelope;
4. adds focused offline tests using the actual module-install contract;
5. stops for targeted independent re-review, with no live execution included.

Separately, before any future live authorization, the owner must disposition the genuine F5 capacity result. The frozen G1 contract says an organically over-limit fixture is `FAIL`; it cannot be reinterpreted as a pass or fixed by silently changing the 12,000 limit. Any Core/resource-limit or fixture-policy work requires its own explicit authorization.
