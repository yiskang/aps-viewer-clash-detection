# Bounded independent re-review — remediated G1 SVF2 F1–F8 harness build plan

- **Date:** 2026-09-27
- **Repository state reviewed:** `main` at `feeb5b3149ace650598a7cb96a7efabb6360fe29`; `origin/main` at `0a58354b2b281f891fed7bc3ae199475dfaa03e7`; existing G1 chain remains uncommitted.
- **Primary artifact:** `docs/research/2026-09-27-g1-svf2-f1-f8-harness-build-plan.md`.
- **Supporting artifacts:** the remediation internal review, the prior independent harness-plan review, initializer/fixture diagnostic evidence, accepted Viewer Clash Panel design/implementation-plan F1–F8 definitions, actual Adapter/Collision/Panel source, and `docs/handoffs/latest.md`.
- **Review boundary:** only the remediation of C1/H1–H7 and directly affected verdict, phase, control, evidence, and cleanup contracts. No harness implementation or live execution was performed.

## Verdict

**Not ready for harness implementation authorization.** Most prior findings are substantively resolved, including fatal-error precedence, classifier stop behavior, F3, F5, F6 ordering, full-census F7/F8 coverage, error-ledger policy, and repository-module evidence binding. One Critical verdict/control contradiction and three High implementation-safety gaps remain.

Finding count: **1 Critical / 3 High / 3 Medium / 0 Low**.

## Critical

### C1 — Mandatory-control restoration and the timeout control still have no coherent verdict model

- **Plan sections:** §6.3, §6.4a, §6.5, §8.
- **Requested contract:** any mandatory control that does not both detect and restore must force `FAIL`; `PARTIAL` is reserved for required Fi evidence that remains `BLOCKED`/`NOT_EVIDENCED` without a failure.
- **Concrete contradictions:**
  1. The control enum has only `EXECUTED_DETECTED_RESTORED`, `EXECUTED_NOT_DETECTED`, and `NOT_EXECUTABLE`. It has no state for “detected, restoration failed.” `computeOverall()` fails only `EXECUTED_NOT_DETECTED`; a control restoration failure that is later recovered by fallback cleanup becomes `PARTIAL`, not the required `FAIL`.
  2. `NOT_EXECUTABLE` also routes directly to `PARTIAL`, although the requested precedence says a mandatory control that was not detected/restored cannot be treated as merely incomplete Fi evidence.
  3. `late-completion-after-timeout` is described as a post-F1 control that must not contaminate the already-recorded primary verdict, but §6.4a says the control “confirms F1 is correctly marked `FAIL`” and later protects F1's “already-recorded `FAIL`.” In a successful primary run F1 must still be `PASS`; if the control changes the real F1 record to `FAIL`, an overall `PASS` is impossible.
- **Minimum correction:** give every mandatory control a complete local result independent of `checks.F*`, for example `DETECTED_RESTORED | NOT_DETECTED | RESTORE_FAILED | NOT_EXECUTABLE`. Only `DETECTED_RESTORED` is compatible with overall `PASS`; every other control outcome forces `FAIL` once the classifier has confirmed SVF2. The timeout control must use a control-local synthetic operation/result and assert that the primary F1 record remains byte-for-byte unchanged (`PASS` in a healthy run).

## High

### H1 — Timeout tokens quarantine result publication but do not stop shared-session work

- **Plan sections:** §6.1a, §6.4, §6.4a.
- **Concrete failure:** the shared Adapter context remains `ctx = { checkpoint() {} }`. Marking a token `timed-out` prevents a final continuation from publishing evidence, but does not stop the underlying `resolveRoots`/tree walk or F4/F7/F8 census from continuing to read the shared model while a sensitivity control patches it or F6 unloads it. The plan also does not require per-item token checks/yields in census loops, so a single synchronous in-page loop cannot be interrupted by its timer.
- **Document-load detail:** a timed-out `Document.load` produces a `Document`, not a `Model`; the current generic late-arrival rule says to unload “the model” it produces. Only a late `loadDocumentNode` resolution produces a model that can be unloaded.
- **Minimum correction:** use an operation-scoped, token-aware `ctx.checkpoint()` for Adapter calls; add explicit token checks plus bounded yields inside harness-owned census loops. Before starting a patching control or F6, require every timed-out shared-session operation to be cancelled or drained. If it cannot be cancelled/drained, mark dependent phases `BLOCKED` and proceed to cleanup rather than continuing concurrently. Split late `Document.load` and `loadDocumentNode` handling by their real return types.

### H2 — F4 proves adaptation shape, not that the collision geometry consumer can use it correctly

- **Plan section:** §7.4.
- **Repository contract:** `adaptViewerGeometry` deliberately performs layout normalization only. `compactAndWeld` is the existing consumer that validates index references, copies active ranges, builds position/index buffers, welds geometry, and returns the triangle data later collision stages use.
- **Concrete failure:** F4 can pass a geometry with non-finite positions or out-of-range indices because `adaptViewerGeometry` may still return `unsupported:false` and a positive `activeTriangleCount`. The current “well-formed index array” language has no executable bound/finite-value oracle and never exercises the actual downstream consumer.
- **Minimum correction:** after `adaptViewerGeometry`, exercise the existing test-importable `compactAndWeld` path (or a public CollisionWorld operation that necessarily reaches the same consumer) with the same weld-epsilon semantics used by `CollisionWorld`. Require a usable non-oversized result with finite position data, in-range indices, and a positive resulting triangle count. Keep indexed and non-indexed inputs valid. This is test-only use of existing production code; no new public API or production change is required.

### H3 — The cleanup ledger does not cover all resources named by the gate

- **Plan sections:** §4.3, §6.1 Phase 11, §6.4a.
- **Concrete omissions:** the authoritative ledger has no explicit step/postcondition for harness-loaded Viewer models, outstanding timeout handles, AbortControllers, per-operation tokens/late-arrival handlers, or server ownership. Unregistering/evicting a model releases registry/world state but is not the same as unloading it from the Viewer. Closing the page eventually destroys Viewer state, but does not mechanically prove the model/listener/late-callback postconditions before teardown.
- **Minimum correction:** extend the resource record and cleanup ledger to: abort and clear every owned operation/timer; dispose late-arrival handlers; unload every harness-loaded model still present and verify the final model set; remove all listeners; unregister bindings; evict/dispose world state; then close page/context/browser. State explicitly whether the HTTP server is externally owned (and therefore verified but not stopped) or harness-owned (and then stopped with an exit postcondition). Any failed mandatory cleanup step or failed postcondition must force `FAIL` without masking the primary verification failure.

## Medium

### M1 — F7 tolerance remains an unsupported calibration constant

- **Plan section:** §7.7 and §10 item 6.
- The formula is fixed before execution, which closes post-hoc tuning, but `1e-4 + 1e-4 × diagonal` is not derived from Viewer 7.124.2 numeric representation or repository evidence. It can be too loose for large boxes and too strict for small boxes at large world-coordinate offsets. Define a componentwise tolerance based on the maximum absolute compared coordinate and Float32/transform error, or record a separate pre-run calibration gate. Do not tune it after seeing pass/fail deltas.

### M2 — F8's retained-count equality uses the wrong possible denominator

- **Plan section:** §7.8.
- F8 covers F1-attributed fragment/dbId relationships, while F1's whole-population count can also include `N`/`U` diagnostic classes. Therefore `censusedFragmentCount` is not necessarily equal to total `populationCount`. Cross-check it against F1's attributable class-`L`/claimed-fragment count; retain total population plus excluded `N`/`U` counts separately.

### M3 — External Viewer assets are identified weakly

- **Plan section:** §8 `remoteAssets`.
- The generated repository-module SHA-256 manifest is adequate for local code. URL, status, and `Content-Length` do not bind the actual Viewer 7.124.2 script/style bytes and can miss same-length CDN replacement. Hash the response bodies when accessible, or retain the already-known decoded Viewer bundle digest and explicitly verify it before the run. If the environment prevents hashing, preserve this as an explicit evidence limitation rather than claiming complete runtime byte identity.

## Verification of the requested areas

| Area | Result |
|---|---|
| Overall verdict precedence | **Not closed — C1.** Fatal-before-classifier and Fi precedence are correct; mandatory-control non-restoration/non-execution is not. |
| F3 | **Closed.** Listener-before-load, typed readiness rejection, missing event, timeout, and reload-probe timing are explicit and executable. |
| F4 | **Not closed — H2.** Real Viewer/adapter APIs and non-indexed support are correct; downstream geometry correctness is not established. |
| F5 | **Closed.** Normal within-limit PASS is reachable; truncation cannot pass; the capacity breach is separate and changes no limit. |
| Timeout / late arrival | **Not closed — H1.** Result publication is token-guarded, but underlying shared work is not cancelled/drained. |
| F6 | **Closed.** One session, generation-separated reload probe, non-vacuous old-model event, pre-F6 controls, and OQ-1 boundary are preserved. |
| F7/F8 | **Substantially closed.** No arbitrary sampling; full counts retained; exact APIs and OQ-1 boundary are present. M1/M2 require bounded precision fixes. |
| Fatal-error ledger | **Closed.** Page/runtime/resource/context/unknown-console errors force `FAIL`; no broad allow-list exists. |
| Sensitivity controls | **Not closed — C1.** Defects and ordering are defined, but restoration/non-execution and timeout-control isolation are inconsistent. |
| Evidence integrity | **Substantially closed.** Repository modules and classifier-stop records are strong; external Viewer bytes remain M3. Reports are specified to derive from retained evidence. |
| Cleanup | **Not closed — H3.** Failure continuation/primary preservation are correct; the owned-resource ledger is incomplete. |

## Dependencies and owner state

No production/Core/Adapter/Panel/host dependency has appeared. C1/H1–H3 and M1–M3 can all be corrected in the plan and eventual test-only harness using existing APIs/modules. No production initializer change, upload/retranslation, G2/G3, H1/H2, OQ-1, host integration, Viewer Adapter change, Core change, or M4 change is required.

No product decision remains. The remaining work is technical plan remediation. After a corrected bounded re-review, the owner must separately authorize harness implementation. A later independent implementation review and separate owner authorization are still required before one live F1–F8 execution.

**Final status: revise the harness build plan before implementation authorization.** Blocking findings: **C1 and H1–H3**.
