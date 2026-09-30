# Independent Review — G2 ViewerBridge / DockingPanel Harness Implementation

**Date:** 2026-10-01  
**Repository:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`  
**Branch / HEAD:** `main` @ `82dab8244d8d83f3cb824b05199d7a2ce5b0f2e0` (`origin/main` identical)  
**Governing procedure:** [`docs/research/2026-09-30-g2-viewerbridge-dockingpanel-live-verification-procedure.md`](../research/2026-09-30-g2-viewerbridge-dockingpanel-live-verification-procedure.md)  
**Implementation reviewed:** `test/acceptance/clashpanel-viewerbridge.acceptance.mjs` and its 24 sibling offline test modules  
**Scope:** implementation review only; no live G2, real-Viewer injection, production edit, or procedure amendment

## Verdict

The dormant harness implementation is suitable for a **checkpoint commit once the owner explicitly authorizes that commit**, but it is **not ready for live-execution planning or activation**.

The implementation faithfully encodes most of the accepted procedure, including C1–C20, N1–N8, Table T rev-2, the two-model flow, Viewer-state ownership, durable reservation/journal/closeout, fail-closed artifact reading, cleanup, evidence schema, and fail-first verdict ordering. The live interlock remains closed.

Two High findings are contradictions in the accepted procedure rather than defects in production code: C15(e) requires an impossible diagnostic observation, and X4's prerequisite-loss example conflicts with the mandatory-control state table. A third live policy issue requires the procedure to distinguish required-resource failures from expected request cancellation. These items must be reconciled before any live authorization record is issued.

**Findings:** 0 Critical / 2 High / 3 Medium / 6 Low.

## Verified repository and scope state

- `main` and `origin/main` both resolve to `82dab8244d8d83f3cb824b05199d7a2ce5b0f2e0`.
- The tracked production baseline is unchanged. The working tree contains the modified handoff plus untracked G2 prompt, internal review, harness, and 24 sibling test modules; no harness file is staged or committed.
- `LIVE_PATH_WIRED` is exactly `false`. `main()` refuses after the pure W0 activation parse and before record validation, reservation/journal creation, Playwright import, browser launch, Viewer initialization, or fixture loading.
- No G2 attempt reservation, journal, result, summary, manifest, commit record, or closeout-failure artifact exists. No live G2 execution occurred.
- No G3, H1, H2, OQ-1, host integration, Core, Viewer Adapter, M4, Panel production, `server.js`, or G1-harness change was introduced.

## Findings

### Critical

None.

### High

#### H1 — C15(e) requires an impossible `inspectLedger()` observation

**Contract:** procedure C15(e) requires the first failed `clear()` to remove the markers while retaining `inspectLedger().isolation` with `confirmed:true`; the second `clear()` must restore and drop the isolation record.

**Actual production behavior:** `ViewerBridge.releaseHeld()` sets its outer `held` ledger to `null` when all marker meshes are removed, independently of whether `isolation.restore()` succeeds. `inspectLedger()` returns `null` whenever `held` is `null`. The isolation session correctly retains its internal record after a failed restore, but that record is no longer observable through `inspectLedger()`.

**Harness behavior:** `evaluateC15()` correctly implements the literal procedure by requiring `ledgerIsolationConfirmedRetained === true`. Against the real bridge, a correct C15(e) run therefore necessarily fails that clause.

**Classification:** accepted-procedure defect / unevidenced diagnostic assumption. It is not a harness interpretation defect and not a production correctness defect.

**Minimum correction before live:** amend C15(e) to establish retained retry state non-invasively from the observable sequence already captured: first `clear()` returns `isolation:'failed'` with the exact restore-failure note; markers are removed; after removing the injection wrapper, the second `clear()` returns `isolation:'restored'`; final isolation is empty. Drop the impossible post-first-clear `inspectLedger().isolation` requirement. No production API extension is needed.

#### H2 — X4's prerequisite-loss route contradicts the mandatory-control table

**Contract conflict:** X4 says a contradictory/unavailable model B with all dependents `BLOCKED` and controls acceptable yields overall `BLOCKED`. However, the exhaustive control table gives N2 no dependency-blocked state and treats N3/N4/N5/N7 `NOT_EXECUTABLE` as non-acceptable. Row 4 therefore produces `FAIL` before row 6 can produce `BLOCKED`.

**Harness behavior:** the pure `computeOverall` X4 state is constructible by injecting otherwise acceptable control records, so the worked example itself passes offline. The real runner's missing-model path records dependent controls as non-acceptable (`N2` becomes `NOT_DETECTED`; N3/N4/N5/N7 become `NOT_EXECUTABLE`). Thus the actual X4 prerequisite-loss route is unreachable and resolves to `FAIL`.

**Classification:** accepted-procedure contradiction, not an implementation deviation. The harness follows both the control table and fail-first ordering literally.

**Minimum correction before live:** choose one policy and reconcile §7, row 4, row 6, X4, and the live dependency resolver. The minimum-scope choice is to define an explicit dependency-blocked disposition that is neutral for row 4 only when the associated required prerequisite/check is `BLOCKED`; otherwise state that model loss is `FAIL` and remove X4's `BLOCKED` claim. No production change is required.

### Medium

#### M1 — The pre-link transitive guard is not the required AST assertion

The critical commit block itself has a real restricted-grammar parser and exact whitelist. The broader pre-link dependency check, however, finds only function declarations and direct bare `name(...)` calls, then token-scans their bodies. It can miss arrow/function-expression helpers, functions passed as values, and computed property reads such as `state['closeout' + 'Complete']`.

The current pre-link implementation is synchronous and does not read K or `closeoutComplete`, so this is a regression-guard gap rather than a present D2 violation. Replace the token-based transitive scan with an AST dependency walk, or conservatively reject unanalysed helper forms, before live activation.

#### M2 — Static protection does not fully cover the live consumers of closeout results

The strongest source guard protects the commit critical section and core closeout functions, but does not prove that `runPostReservation`/`runCli` cannot later wrap closeout in a timeout race or mutate the returned verdict/exit code. Current code and real-process tests behave correctly; the gap is future-regression coverage. Extend the guard to the complete live consumer path before live activation.

#### M3 — Every failed browser request is treated as a required-resource failure

The empty `console.error` allow-list exactly matches the accepted procedure: every `console.error` is fatal. The harness also promotes every Playwright `requestfailed` event to `required-resource-failure`. The procedure only makes **required-resource** failures fatal. Expected cancellation during `hideModel(B)`, `unloadModel(B)`, navigation, or teardown can therefore create a false G2 `FAIL`.

Before live execution, the procedure must define the required-resource set and the exact treatment of demonstrably expected cancellations. The harness must then implement that policy without a broad noise allow-list. No filter should be invented solely in implementation.

### Low

1. `runPostReservation` is exported without its own `LIVE_PATH_WIRED` guard. The supported CLI path is protected, but a direct programmatic caller could bypass the defense-in-depth switch.
2. Some post-consumption cleanup/integrity operations outside the principal catch path can reject before a best-effort `FAILED` transition is written. Artifact-derived verdict still fails closed, so correctness is preserved while diagnostics can be poorer.
3. The fail-closed reader validates internal authorization IDs but does not additionally require the requested filename stem to equal that ID. Existing binding/hash checks still prevent PASS from an internally inconsistent set.
4. The restricted source guard does not reject every free-identifier shadowing construction. Current code has no such construction.
5. The CLI refusal test denies Playwright resolution and observes filesystem/process behavior, but its network observer does not instrument every Node networking surface. Source ordering and the closed switch independently make the present refusal safe.
6. The implementation used one whole-harness subagent review instead of the configured Codex internal-review workflow named by `CLAUDE.md`. The implementation prompt required one focused internal review, not per-task reviews; this is a governance-process deviation, not a code defect. This independent review supplies the missing external evidence.

## D2 reservation, journal, and closeout assessment

The implementation preserves the accepted D2 protocol:

- W1 is read-only; W2 durably establishes directories, exclusively creates the reservation, and records `AUTH_BOUND`; W3 records `ATTEMPT_CONSUMED` before the first model-load start.
- Authorization binding covers record, HEAD, procedure, harness, both fixture digests, and requested runtime. Reservation concurrency uses real exclusive-create behavior.
- R1 is a frozen whitelisted payload; R2/R3 and K candidate are written and verified; pre-closeout and pre-link are the only operational verdict phases.
- The final critical block is synchronous: pre-link gate, direct `fs.linkSync(Kc,K)`, `committed=true`, and `finalOverall=primaryOverall`. K is the sole PASS-authoritative artifact; the reader fails closed for partial/crashed/contradictory durable states.
- The post-K path does not change verdict or exit code.

### H1 deadline fix

**Accepted.** The runner now checks the absolute T9 deadline synchronously before primary closeout computation and checks it again while disarming the deadline source. The pre-link evaluation receives the retained deadline record. A run that crosses the cap between the first check and commit cannot retain PASS eligibility. The real-process regression test covers an overdue deadline whose timer callback has not yet dispatched. This closes the reported race without weakening D2.

## C20 / N8 assessment

### H2 oversized-evidence fix

**Accepted.** The oracle evaluates the null-change predicate before applying the 1 MiB evidence-list cap. The N8 null-change control now remains `NOT_EVIDENCED(no-change-observed)` when the real C20 record is `NOT_EVIDENCED(evidence-too-large)`, rather than becoming `NOT_DETECTED` and incorrectly forcing row-4 `FAIL`. The added large-frame test would fail under the previous ordering.

### N8 live discrimination risk

This is a **fixture/camera-dependent evidence limitation already represented by the accepted procedure**, not a harness defect. If the displaced footprints overlap changed pixels, N8 is `NOT_DISCRIMINATING`; C20 is `NOT_EVIDENCED`; overall G2 is capped at `PARTIAL`. That is the explicit D7 outcome. It does not block a faithful live run and does not justify tuning thresholds now. A separate owner-approved procedure revision would be needed only if the project requires this fixture to be capable of a G2 `PASS` rather than an informative `PARTIAL`.

## Model-B identity and preflight requirement

The harness literal for model B is:

```text
dXJuOmFkc2sub2JqZWN0czpvcy5vYmplY3Q6dGVzdC1zYW5kYm94LWxrd2VqN3hwYmdwNjN4NGhsMzM1eTZtMjZvYWtnZ29mL0F1ZHVib25fU3RydWN0dXJlX2NsYXNoX3Rlc3QucnZ0
```

It decodes to:

```text
urn:adsk.objects:os.object:test-sandbox-lkwej7xpbgp63x4hl335y6m26oakggof/Audubon_Structure_clash_test.rvt
```

Its SHA-256, over the encoded URN literal exactly as used by the harness, is:

```text
806f99964bb937085874557ec2b03101a612db26031469a063446796d7ebb53d
```

The encoded literal is byte-identical to the Structure candidate URN retained in [`docs/research/evidence/2026-09-29-g1-svf2-fixture-capacity-screening-result.json`](../research/evidence/2026-09-29-g1-svf2-fixture-capacity-screening-result.json). The same-bucket value is therefore repository evidence, not a fresh derivation that needs manual reconstruction.

Before issuing an authorization record, the operator must mechanically compare the harness literal to that committed screening record and place the exact digest above in `Model-B-URN-SHA256`. The existing authorization validator must bind and verify it. A second CLI/env URN input would weaken the single bound identity and is neither needed nor permitted by the accepted procedure. Live load/classifier results remain required evidence that the retained derivative is still accessible and confirmed SVF2.

## Test verification and quality

- Focused command: `node --test test/acceptance/clashpanel-viewerbridge.acceptance.*.test.mjs` — **361 total / 361 pass / 0 fail**.
- Aggregate command in the unrestricted local environment: `node scripts/run-tests.mjs` — **4607 total / 4606 pass / 0 fail / 1 existing TODO**.
- An initial restricted-environment aggregate run produced three local-socket `EPERM` failures and one unchanged timing-test failure. The required unrestricted rerun passed cleanly; no source or threshold changed and there was no retry of live G2.
- The 24 sibling modules are not merely snapshots of helpers. They exercise real temporary files, exclusive reservation races, multi-process journal behavior, real `fs.linkSync`, child-process closeout/late-event behavior, CLI import/refusal, and negative source mutations, alongside pure oracle matrices.
- Live Viewer calls, C15 injection, render capture, actual APS loads, and Viewer noise remain explicitly unevidenced until a separately authorized run; offline tests do not claim otherwise.

The negative tests meaningfully catch `await`, Promise/timer insertion, async/nested link use, timeout-wrapped commit, direct pre-K `closeoutComplete` reads, operational `final`-phase restoration, and mutations inside the guarded post-link block. M1/M2 describe remaining guard coverage, not vacuity of the existing tests.

## Procedure amendments and dependencies

### Before a checkpoint commit

No procedure amendment or production change is required to preserve this dormant implementation as a checkpoint. The commit itself remains unauthorized. The review and handoff must accompany the harness so the dormant code cannot be mistaken for a live-ready gate.

### Before live-execution planning or authorization

Required:

1. Amend C15(e) to remove the impossible `inspectLedger().isolation` observation and use the two-clear observable sequence.
2. Resolve X4's dependency-blocked control semantics consistently across §7, §8, X4, and the live runner.
3. Define which request failures are required-resource failures and which verified cancellations are non-fatal; retain the empty `console.error` allow-list unless the owner explicitly changes it.
4. Reconcile the harness to those procedure changes and independently re-review the bounded changes. M1/M2 static-guard hardening should be included before the live switch is enabled.

N8 needs no correction under the accepted PARTIAL semantics.

## Authorization and readiness

- **Ready to commit:** yes, as a dormant checkpoint only, after explicit owner commit authorization. The tree is not clean and nothing is currently staged or committed.
- **Ready for live-execution planning:** no. H1/H2 are accepted, but H1/H2 do not close the C15(e), X4, and request-failure-policy blockers.
- **Production dependency:** none. No Core, Viewer Adapter, ViewerBridge, Panel, M4, OQ-1, host, or Viewer initializer change is required by the findings.
- **Current authorization:** the independent review and handoff update only. Harness commit, `LIVE_PATH_WIRED=true`, authorization-record issuance, browser/Viewer execution, fixture load, failure injection, G3, H1/H2, OQ-1, host integration, production edits, and push remain unauthorized.

