# G1 F4 harness/test remediation — focused internal review (F4 only)

**Base:** `main` @ `3312ae1` + uncommitted diff · **Reviewer:** opus subagent, read-only · **Result:** 0 Critical / 0 High / 0 Medium / 3 Low. Internal review; not an independent gate.

## Root cause (confirmed from source)
`observeF4` reads `compactAndWeld` from `window.__g1.mod['/collision/geometry/activeRangeCompaction.js']`, but `installG1Modules` only populates `g.mod` from `SERVED_MODULE_ENTRY_POINTS`, which did not list that module (it was only transitively reachable and hash-manifested). `weld` was `undefined`; every call threw a TypeError counted as a weld-consumer failure (live: 348/348). Offline tests missed it by injecting the module into `g.mod` by hand.

## Changes (harness/test only)
- `SERVED_MODULE_ENTRY_POINTS` now includes the real `/collision/geometry/activeRangeCompaction.js` (single list feeds install + manifest; Phase-0 import fails closed).
- `observeF4` reports missing consumer distinctly (`f4-compactAndWeld-missing-in-browser-realm` → BLOCKED).
- Per-geometry stage traces (render-proxy, adaptation, consumer, error, geometryId/fragId/dbId, oversized marker), first 20 per class + 5 samples, errors via `describeError`; new reason `f4-weld-consumer-exception`; falsy consumer result now counted as failure.
- Oversized `geometry-too-large-for-sync-build` remains informational for F4 and an F5 capacity finding (`oversized-geometry-present`).
- `runtimeEnvelope.playwright` (null if unreadable) on success and Phase-0 failure paths; schema requires the field.
- Tests: new `g1-svf2-f1-f8-verification.f4consumer.test.mjs` (9, failing-first, real adapter + real `compactAndWeld` in a vm realm) plus additions to stage8/shell/phase0evidence tests.

## Verification
`node --test test/acceptance/g1-svf2-f1-f8-verification*.test.mjs`: 659/659. `npm run test:offline`: 4246 total / 4245 pass / 0 fail / 1 existing todo. Forbidden-change check: no diff in `collision/`, `clashpanel/`, `clashtest/`, `server.js`, initializer, F5 limits, `maxSyncTriangleCount`, RAC model. No live run.

## Low findings (not fixed; dispositioned for Work/owner)
- **L1:** a thrown non-Error primitive (`{primitive,value}`) loses `value` through `describeError`; count/reason unaffected.
- **L2:** `f4-weld-consumer-exception` masks co-occurring render-proxy/adapter reasons in `reason` (still visible in `fields`/`failureBreakdown`); verdict correct.
- **L3:** the consumer-exception test triggers via viewer-side `getUnitScale` throwing, proving routing rather than an exception raised inside `compactAndWeld`.

## Standing caveat
The existing RAC live evidence has a **genuine F5 capacity finding: maxSyncTriangleCount 21,845 > 12,000**. Fixing F4 does not make this fixture capable of an overall G1 PASS; a future live run is expected to show `oversizedGeometryCount > 0` and F5 FAIL.
