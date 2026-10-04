# G2 C3/C2 Bounded Correction — Independent Review

**Verdict:** ready to commit/push as a bounded C3/C2 checkpoint. This does **not** authorize a live retry or C8/C6/T4 remediation.

**Repository boundary:** `main` at `6f716bc0d0d2c1b1e61d26fe50b4dbe56266f7e4`, equal to `origin/main`. Review scope was the uncommitted C3/C2 harness-and-test correction, its directly affected tests, the accepted remediation plan, the current product intent definitions, and the preserved G2 live evidence.

## Findings

- **Critical:** none.
- **High:** none.
- **Medium:** none.
- **Low L1 — coarse static name guard:** the quoted-key-name scan is deliberately source-shape based. It can false-positive on unrelated quoted text and can miss constructed/template/aliased spellings. This is non-blocking because the direct C3 value tests, direct C2 helper tests, product-drift assertions, exact probe-linkage guard, generated-page-source test, and executable browser binding suite cover the actual repaired path. Keep the static scan as defense in depth, not as proof of all future intent semantics.
- **Low L2 — stale aggregate count in the internal record:** the internal review reports `5154 total / 5153 pass`; the current final tree actually produces `5155 total / 5154 pass / 0 fail / 1 todo` under Node `v22.23.1`. The extra passing test is consistent with the final source-linkage guard added after the earlier aggregate count. This is a documentation/counting discrepancy only; the gate is green.

## C3 correction

Accepted. `clashpanel/core/intents.js` defines `INTENT.PANEL_SHOWN = 'panel/shown'` and `INTENT.PANEL_HIDDEN = 'panel/hidden'`; `ClashDockingPanel` dispatches those values as `intent.type`. The harness-local `PANEL_SHOWN_INTENT_VALUE` and `PANEL_HIDDEN_INTENT_VALUE` match those canonical values, and `evaluateC3` now compares captured dispatch values against them rather than the former symbolic key names.

Keeping literals in the harness and comparing them to production constants only in tests is the correct independence boundary here: the live oracle does not import the product vocabulary it is checking, while drift is detected offline. Importing production `INTENT` into the harness would make the oracle agree automatically with a coordinated product drift and would complicate the page-agent boundary.

The regression tests directly establish that canonical values pass, old key names fail, wrong-kind visibility fails, repetition cardinality is unchanged, and dispose/residue behavior is unchanged.

## C2 correction

Accepted. `countC2DomainWrites` excludes only the two canonical panel-visibility values and counts symbolic names, unrelated intents, and non-intent sentinels as domain writes. `g2CreateShellProbe.c2` passes its actual `constructionDispatches` array through the helper. No other C2 clause changed: clause (vii) still fails whenever construction dispatched anything, while clause (viii) now reports the intended domain-write classification instead of misclassifying visibility values.

The helper adds no hidden runtime behavior beyond the corrected classification. Its input is the local array created by `dispatched.slice(dMark)`, so its array assumption is satisfied by construction.

## Regression, bundle, and sibling audit

- The permanent tests fail on the old bug without relying on the reported manual mutation exercise. The mutation result is supporting evidence only.
- The C2 source-linkage guard is intentionally narrow and brittle, but it closes the internal review's missed-wiring gap for this bounded checkpoint. The generated page source includes both constants and the helper, and the real browser-local binding suite parses/loads the page bundle successfully.
- A bounded scan of all 35 product `INTENT` key names found no remaining quoted key-name literal in the G2 harness. Direct inspection of the C1–C20 captured `intent.type` paths found no second name-versus-value site, including scene-ownership/C4-adjacent code. This conclusion is limited to the requested defect class.
- The changed fake-environment records in the runner and op-refusal suites now use the real values. They do not alter refusal behavior or runner semantics.

## Neutrality and preserved evidence

`git diff -U0` shows the harness change only at the two new constants/helper, the C3 comparisons, the C2 `domainWrites` expression, and three test exports. C8, C6/N2, T4, C20, verdict rows, control states, lifecycle, cleanup, attempt handling, and production/Core/Adapter/Panel code are unchanged.

The accepted procedure remains byte-identical at SHA-256 `d1ccfde224b8ae76fe74b06c93abc532e6df9612933cafaa045053c8e2e45a75`. The immutable evidence directory has no diff against `HEAD`; its retained hashes still match, including R1 `4204e2d3…148`, R2 `5282f01c…da4`, R3 `8de72bb0…28f`, journal `0486d395…352c`, and commit record `3b5b2777…d63`. The only G2 live evidence directory remains `g2-live-20261004-75a3ccb9`; K still commits `FAIL (row 3)` for attempt `59b8713d-1e63-4df8-b641-ac6b830f3ea6`. No retry, new record, attempt reset, or historical rewrite was found.

## Verification reproduced

- Node `v22.23.1`, G2 acceptance test files: **909/909 pass**.
- Node `v22.23.1`, real browser-local binding suite: **8/8 pass**. Combined requested G2 gate: **917/917 pass**.
- Node `v22.23.1`, `npm run test:offline`: **5155 total / 5154 pass / 0 fail / 1 existing todo**. The todo remains the unrelated extreme-aspect-ratio containment gap.
- `git diff --check`: clean.
- Harness SHA-256 independently recomputed: `cc8868cd68b9c2c3382297070289a2aa165c74249c6d82896d76bacc6c6ef09b`.

The first sandboxed browser invocations were refused by macOS Mach-port permissions, not by test assertions. Re-running the same offline browser suites outside that sandbox produced the passing results above. A separate accidental Node-v26 aggregate invocation reproduced the known timing-sensitive baseline failure; the governed Node-v22.23.1 run is green and is the result used for this verdict.

## Gate and next phase

The bounded C3/C2 correction is ready for an owner-authorized checkpoint commit/push. The new harness digest is not bound to any authorization record, and the previous authorization remains historical and spent.

After that clean checkpoint, the next bounded remediation should be read-only/static Viewer API evidence plus R1 replay for C8/C6 (D0/D1), followed—under separate authorization—by the synthetic-transition investigation/design (D2). Do not implement C8/C6, revise frozen T4, instrument or run a diagnostic session, issue a new record, reset an attempt, or authorize a live retry from this review alone.

