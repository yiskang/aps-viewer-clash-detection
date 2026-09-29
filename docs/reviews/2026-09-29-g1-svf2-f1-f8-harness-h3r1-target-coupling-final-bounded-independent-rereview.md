# G1 SVF2 F1–F8 harness H3-R1 target-evidence coupling — final bounded independent re-review

**Date:** 2026-09-29  
**Repository:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`  
**Branch / reviewed HEAD:** `feature/g1-svf2-f1-f8-harness` / `1d9662478fb8ced8bf5ef903b4122669cbdf965e`  
**Scope:** H3-R1 target-evidence coupling and directly affected verdict/schema plumbing only.  
**Verdict:** 0 Critical / 0 High / 0 Medium / 2 Low. **H3-R1 is closed. The harness implementation is accepted and is ready for an explicit owner decision on one live F1–F8 execution. Live execution remains unauthorized.**

## Evidence reviewed

- `test/acceptance/g1-svf2-f1-f8-verification.mjs`
- `test/acceptance/g1-svf2-f1-f8-verification.targetcoupling.test.mjs`
- `test/acceptance/g1-svf2-f1-f8-verification.targetevidence.test.mjs`
- directly affected Stage 8, control-bridge, cleanup-liveness, and harness tests
- `docs/reviews/2026-09-29-g1-svf2-f1-f8-harness-h2r1-h3r1-bounded-remediation-review.md`
- `docs/reviews/2026-09-29-g1-svf2-f1-f8-harness-h2r1-h3r1-bounded-independent-rereview.md`
- `docs/handoffs/latest.md`

The working tree was intentionally uncommitted. The review therefore evaluates the current on-disk remediation rather than treating HEAD alone as its contents.

## 1. PASS gating — verified

`computeOverall()` now accepts `controlTargets` and treats `wrong-owner` and `hidden-fragment` as restored only when both conditions hold: the control state is `DETECTED_RESTORED`, and the same-name target record passes `validateControlTargetEvidence()`. Missing, malformed, semantically inconsistent, or wrongly filed evidence makes `anyControlNotRestored` true and forces `FAIL`; it cannot fall through to `PARTIAL` or `PASS`. A valid same-name record remains PASS-compatible.

`validateResultSchema()` independently applies the same coupling to durable results. It requires a valid corresponding record for a target-bearing `DETECTED_RESTORED` control, rejects a target record for `NOT_EXECUTABLE`, rejects unknown/wrongly keyed records, and validates every stored record against its key.

The browser-to-Node path is coupled end to end: `runBridgedControl()` validates the cross-realm result's booleans, sanitizes target evidence to a known scalar-only shape, and calls the target sink; `runHarness()` revalidates the sink record under the executing control's name, retains it in `controlTargets`, passes that carrier into `computeOverall()`, and includes it in the durable result. A missing or throwing sink cannot create a false PASS because the final verdict gate then sees no valid record.

## 2. Semantic validation — verified

For `wrong-owner`, the durable record requires finite `selectedFragId`, `selectedOwnerDbId`, and `injectedOwnerDbId`; the injected owner must differ from the real owner. It also requires the reviewed source `f1PopulationRecords`, selection rule `numeric-minimum`, and an integer `populationSize >= 1`.

For `hidden-fragment`, the durable record requires finite `selectedFragId`, `selectedTreeOwnerDbId`, and `actedOnFragId`; the acted-on fragment must equal the selected fragment. It requires the reviewed source `f2TreeOwnerByFragId-intersect-f1PopulationClasses-L`, the same deterministic selection rule, and an integer `populationSize >= 1`.

The real bridge copies only these known primitive fields into the Node-side record. Viewer, Model, fragment-list, tree, or other live browser-realm objects cannot enter the durable target evidence through this path.

## 3. `NOT_EXECUTABLE` behavior — verified

`runBridgedControl()` returns `NOT_EXECUTABLE` before target emission for a missing/malformed result, a precondition failure, or malformed boolean fields. In particular, no-eligible-target results do not fabricate or persist target metadata. Schema validation also rejects a `NOT_EXECUTABLE` target-bearing control if a target record is present. Thus both the real bridge and the durable artifact fail closed.

Target evidence may be retained for an actually executed control whose detection or restoration later fails. That is appropriate diagnostic evidence and remains non-PASS because the control result itself fails the mandatory-control verdict gate.

## 4. Findings

### Critical

None.

### High

None.

### Medium

None.

### Low

1. **`validateResultSchema()` does not recompute `overall`.** It validates the overall enum and independently enforces target/result coupling, while the real execution path computes `overall` from the same checks, controls, cleanup state, integrity state, and `controlTargets` immediately before result construction. A hand-edited artifact could therefore contain a syntactically valid but logically stale overall value. This does not create a false-PASS path in the live harness and does not block live authorization; recomputation would be optional evidence-hardening.
2. **Direct dependency-injection tests can submit extra target-record fields.** `runHarness()`'s test seam revalidates required semantics but retains the supplied object, so an injected test control may preserve harmless extra fields. The real browser path always goes through `sanitizeControlTargetEvidence()`, which emits only known scalar fields. This is non-blocking and does not weaken live evidence integrity.

## 5. Test verification

Independent `npm run test:offline` result:

- total: **4183**
- pass: **4182**
- fail: **0**
- todo: **1** existing known todo
- process exit: **0**

The added coverage exercises the required failure and success cases: missing `wrong-owner` and `hidden-fragment` records, missing carrier, malformed record, both semantic-invalid cases, valid PASS-compatible records, wrong-name filing, malformed bridge data producing `NOT_EXECUTABLE` without target evidence, and successful bridge target emission. The Stage 8 and target-evidence suites additionally cover schema rejection, no-eligible-target behavior, sparse/non-zero fragment IDs, durable JSON persistence, and real `runHarness()` non-PASS behavior when either required record is absent.

## 6. Scope and authorization

The current remediation changes only the non-production G1 harness, directly affected offline tests, review records, and the handoff. No live F1–F8 execution or result artifact was produced. No G2/G3, host-integration H1/H2, OQ-1, host integration, Core, Viewer Adapter, M4, Viewer Clash Panel production, or production initializer work was started.

**Disposition:** H3-R1 is fully closed. Together with the preceding H1/H2/H2-R1 closures, the harness implementation is accepted for the next owner gate. One live F1–F8 execution is technically ready for explicit owner authorization, but remains unauthorized until that authorization is given.
