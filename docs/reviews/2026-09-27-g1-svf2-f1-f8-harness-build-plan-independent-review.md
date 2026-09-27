# Independent review — G1 SVF2 F1–F8 verification harness build plan

- **Date:** 2026-09-27
- **Repository:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`
- **Reviewed state:** `main` at `feeb5b3149ace650598a7cb96a7efabb6360fe29`; `origin/main` at `0a58354b2b281f891fed7bc3ae199475dfaa03e7`; local branch two commits ahead before this review.
- **Scope:** independent implementation-readiness review of `docs/research/2026-09-27-g1-svf2-f1-f8-harness-build-plan.md`, checked against its internal review, the initializer diagnosis, the accepted diagnostic result, the governing Viewer Clash Panel design/implementation plan, the actual Adapter/Collision/Panel source, T3's accepted live-harness pattern, and `docs/handoffs/latest.md`.
- **Restrictions honored:** no harness implementation; no F1–F8 execution; no production-code change; no G2/G3/H1/H2/OQ-1/host work; no model upload/retranslation; no commit or push.

## Verdict

**Not ready for harness implementation authorization.** The plan preserves the accepted G1 boundary and its five-state format classifier is correctly fail-closed, but its aggregate-verdict logic can still report `PASS` when mandatory sensitivity controls or cleanup fail. Seven additional High findings leave required checks ambiguous, unimplementable against the current public surface, vulnerable to phase contamination, or unable to establish that retained evidence came from the reviewed harness.

Finding count: **1 Critical / 7 High / 4 Medium / 2 Low**.

All blocking corrections are confined to the harness plan and eventual test-only harness. No production initializer, Viewer Adapter, Collision Core, Federated Core, M4, OQ-1, host, or Panel implementation change is required by this review.

## Critical finding

### C1 — Overall `PASS` ignores mandatory controls and cleanup integrity

- **Plan sections:** §4.3, §6.3, §6.5, §8.
- **Concrete failure:** §6.5 says a negative control that misses its injected defect is a harness defect and the guarded check cannot be trusted. Section 4.3 records cleanup failures separately. Section 6.3 nevertheless computes the overall verdict from F1–F8 alone. Therefore all eight checks can be `PASS`, a required control can have `detected:false`, or restoration/cleanup can fail, and the plan still produces overall `PASS`.
- **Why this blocks:** the harness's primary safety property is that missing or contradictory required evidence cannot become a G1 pass. The current roll-up violates that property directly.
- **Minimum correction:** define a mandatory-control manifest and make overall `PASS` require: confirmed SVF2; F1–F8 all `PASS`; every applicable mandatory control executed, detected its perturbation, and restored its patch; `cleanupFailures.length === 0`; and no fatal console/page error under the policy in H7. A failed control or cleanup-only failure must make the run `FAIL` (while preserving any earlier Fi failure as the primary diagnostic). A control that could not execute must produce `PARTIAL`, never `PASS`.

## High findings

### H1 — F3 does not exhaustively fail the actual readiness contract, and the reload probe is ordered too late

- **Plan sections:** §6.1 Phase 3/10, §7.3, §7.6 steps 4 and 7.
- **Repository contract:** `clashtest/viewer/readiness.js` makes `awaitObjectTree`/`resolveRoots` reject with `ObjectTreeUnavailableError` when the tree or fragment list cannot become usable.
- **Concrete failures:**
  1. F3's success requires `resolveRoots` to resolve, but its failure wording excludes `ObjectTreeUnavailableError`; that is the exact typed failure of the Adapter readiness gate and cannot be neutral.
  2. No explicit verdict is defined when `MODEL_ADDED_EVENT` is never observed.
  3. F6 step 7 says to repeat the `MODEL_ADDED_EVENT` probe after the reload in step 4. By then the event has already occurred, so the second readiness trace can be vacuous or missing.
- **Minimum correction:** any rejection, including `ObjectTreeUnavailableError`, timeout, missing `MODEL_ADDED_EVENT`, or missing settlement record is F3 `FAIL` with the typed cause retained. Install a distinct reload probe before the reload `Document.load`/`loadDocumentNode` call, invoke `resolveRoots` from that event, and finalize/remove it only after reload settlement. Require the reload probe outcome in F6's verdict.

### H2 — F4 names a non-existent public API and rejects a geometry layout the collision library supports

- **Plan sections:** §5, §7.4.
- **Repository contract:** `CollisionWorld` has no public `getRenderProxy` method. Its private `_resolveGeometryView` calls `viewer.impl.getRenderProxy` and then `adaptViewerGeometry`. `adaptViewerGeometry` explicitly supports non-indexed geometry (`index === null`) and returns `activeTriangleCount`/ranges; a non-empty index buffer is not a universal validity condition.
- **Concrete failure:** the proposed F4 sequence cannot be implemented as written against `CollisionWorld`'s public API, and its “non-empty position/index buffers” oracle would falsely fail a supported non-indexed SVF2 geometry. “Whatever geometry-buffer accessor … uses internally” is not a mechanically testable instruction and invites a duplicate, weaker oracle.
- **Minimum correction:** name one real executable path. Either exercise a public CollisionWorld operation that necessarily reaches `_resolveGeometryView`, or explicitly import and call the existing `adaptViewerGeometry` on the real render proxy in test-only code. Validate the adapter's actual return contract (`unsupported === false`, valid positions/stride/ranges, `activeTriangleCount > 0`, and index validity only when an index exists). Cover every distinct geometry id in the already bounded F1 population, or define a deterministic rule that cannot omit a failing geometry class. No production API addition is needed.

### H3 — F5's current scoring makes a valid G1 `PASS` unreachable for the accepted fixture

- **Plan sections:** §6.3, §6.5, §7.5, §10 questions 1 and 5.
- **Governing contract:** F5 asks whether the observed SVF2 population stays within the existing accepted limits. It does not require the natural fixture to exceed a limit.
- **Concrete failure:** §7.5 first says the real fixture's within-limit result is `PASS`, then changes F5's primary verdict to `NOT_EVIDENCED` unless enforcement is organically exercised. The separate capacity-breach control cannot change that primary verdict, so the intended modest fixture necessarily makes the overall result `PARTIAL`, even when it proves the actual G1 requirement and the sensitivity control proves the enforcement path.
- **Minimum correction / F5 disposition:** G1 F5 `PASS` means the unperturbed SVF2 fixture is completely enumerated, its observed counts are recorded, no silent truncation occurred, and every applicable existing bound is respected. Organic over-limit behavior is not required. Keep `capacity-breach` as a mandatory harness-calibration control; it must pass for overall G1 `PASS`, but it is separate from the primary F5 result. Do not provision a larger model or change a limit.

### H4 — Timeout handling permits abandoned async work to contaminate later phases

- **Plan sections:** §6.1 phase ordering, §6.4.
- **Concrete failure:** the plan says a timed-out read-only Fi is marked `FAIL` and independent checks continue, but it does not cancel, invalidate, or drain the timed-out promise. `resolveRoots` and Viewer load callbacks may settle later against the shared model/world/registry while F6 is unloading or Phase 11 is patching APIs. A timed-out `Document.load` callback can also publish a late model after cleanup begins.
- **Minimum correction:** give every phase an active generation/token and a cancellation-aware checkpoint. On timeout, invalidate the token and abort where supported. If a Viewer operation cannot be cancelled, prevent its callback from publishing shared state; immediately unload any late model it creates. A timed-out operation that cannot be safely drained must poison the shared session and block dependent later phases rather than allowing them to run against racing state.

### H5 — Retained evidence is not cryptographically bound to the reviewed harness and repository state

- **Plan sections:** §8.
- **Concrete failure:** the runtime envelope records branch/HEAD and command, but not the harness bytes, working-tree state, or relevant module bytes. The harness is planned as an uncommitted file. A retained result can therefore be paired with a later or different script at the same path and still appear current; `HEAD` alone does not identify dirty source.
- **Minimum correction:** record at run start the SHA-256 of the harness, its exact repository-relative path, branch, HEAD, `git status --porcelain`, and a stable hash or retained patch for all uncommitted files loaded by the harness. The independent run review must byte-compare the retained/run script to the reviewed implementation and reject stale or mismatched evidence. Record `startedAt`/`finishedAt` and write the durable result atomically only after cleanup and final verdict computation.

### H6 — F7/F8 coverage is left to an arbitrary sample even though a bounded census is available

- **Plan sections:** §7.7, §7.8, §10 questions 2 and 6.
- **Concrete failure:** no deterministic population or minimum is defined. An implementer could choose one convenient dbId, miss another SVF2 representation, and still report F7/F8 `PASS`. Statistical confidence is the wrong model for a correctness gate over a fixture already bounded by `maxCollisionInstancesPerEpoch`.
- **Minimum correction / sampling disposition:** use a deterministic census, not a statistical sample: F7 covers every distinct F1 root with attributable geometry; F8 covers every F1 root and every F1-attributed fragment/dbId relationship, cross-checked against F2. Sort ids for stable evidence and bound retained divergence detail while retaining total counts/digests. The existing 20,000-fragment ceiling is the resource bound. If the census cannot complete inside the declared gate, the check is not evidenced; do not silently reduce the population.

### H7 — Console/page-error disposition is undefined and can hide a broken runtime

- **Plan sections:** §8, §10 question 7.
- **Concrete failure:** console and page errors are retained but excluded from check and overall verdicts. A module-load failure, unhandled exception, WebGL/context loss, or required model-resource failure could coexist with superficially complete check records and overall `PASS`.
- **Minimum correction / error disposition:** `pageerror`, `unhandledrejection`, required script/module/model/resource load failure, WebGL/context loss, and any unknown `console.error` during setup or F1–F8 force overall `FAIL`. Warnings/info remain diagnostics. A non-blocking `console.error` is allowed only by an exact, pre-reviewed fingerprint tied to phase/source/Viewer version; broad substring allowlists are forbidden. Preserve the raw ordered events. Fatality classification must be computed before the aggregate verdict.

## Medium findings

### M1 — F7's numerical oracle can be tuned after observing the fixture

- **Plan section:** §7.7.
- `BOUNDS_TOLERANCE` is to be fixed “against the fixture's actual scale,” which permits post-hoc tolerance selection that converts a disagreement into agreement. Define the absolute-plus-relative tolerance formula before the live run, based on numeric representation and coordinate magnitude, and record both the formula and resolved value.

### M2 — F7 leaves the unit and visibility APIs unresolved

- **Plan section:** §7.7.
- The repository evidence already names public `Model#getUnitScale`, `getUnitString`/`getDisplayUnit`, while the plan says “whatever accessor … to be confirmed.” Visibility similarly uses an optional `isNodeVisible?` without defining which absence is `NOT_EVIDENCED` and without explicitly recording the SVF2 visibility implementation branch named by the design. Name the exact read-only calls and per-subcheck verdict rules before implementation. This remains G1 characterization and does not require ViewerBridge, isolation, fit, or Panel execution.

### M3 — Classifier-stop output does not explicitly populate all required check records

- **Plan sections:** §4.1, §6.2, §8.
- The classifier correctly stops on every state except `CONFIRMED_SVF2`, but the plan only says execution stops before Phase 3. Prepopulate F1–F8 as `BLOCKED` with the classifier reason and controls as `not-run`; otherwise the report can contain missing objects even though the authorization requires every F1–F8 result.

### M4 — F6 mixes “characterization” and gate assertions

- **Plan section:** §7.6.
- F6 calls unload/reload “characterization, not an assertion,” then defines PASS/FAIL conditions. Clarify that digest/identity drift is characterization, while event identity, unregister-before-evict ordering, binding survival after a late old-model event, reload classifier, and repeat-readiness evidence are assertions. This is wording/verification precision, not a design change.

## Low findings

### L1 — The stale-old-model control is duplicated without naming one canonical result

- **Plan sections:** §6.5, §7.6 step 6.
- The primary F6 sequence already performs the same late-event sensitivity control later listed again in Phase 11. Run it once in the F6 sequence and reference that result from `controls`, or define a distinct perturbation. Duplicate mutation adds restoration risk without new evidence.

### L2 — The cleanup sketch is narrower than the later resource contract

- **Plan sections:** §4.3, §6.1/Phase 12, §7.6.
- The sketch shows only listener/page/context/browser cleanup, while later text assigns Phase 12 the wiring, registry/model, world, and optional engine resources. Replace the illustrative list with the complete ordered resource ledger or explicitly label it partial so implementation cannot mistake it for the required cleanup set.

## Requested adjudications

| Item | Disposition | Gate consequence |
|---|---|---|
| **F5** | Prove the real SVF2 fixture is completely observed and within existing limits. Do not require an organic breach. Keep the synthetic breach as a mandatory sensitivity control. | No new fixture, limit, production change, or Core work. |
| **F7/F8 population** | Deterministic full census of the bounded F1 population: all attributable roots for F7; all root/fragment/dbId relationships for F8. | No arbitrary sample count. Failure to complete is not a pass. |
| **Console/page errors** | Page exceptions/unhandled rejections, required resource failures, context loss, and unknown console errors fail G1. Only exact pre-approved benign fingerprints may remain diagnostic. | Policy must be in the plan before implementation. |
| **Authorization sequencing** | Keep separate gates: (1) owner accepts the remediated plan and authorizes harness implementation; (2) implementation is independently reviewed; (3) owner separately authorizes one live F1–F8 execution; (4) retained run evidence receives independent verification. | Implementing the harness never authorizes live execution. |

## Confirmed sound areas

- The five-state classifier is fail-closed: only `isOTG() === true` **and** `isSVF2() === true` reaches F1–F8; contradictory, partial, unavailable, and confirmed-non-SVF2 states stop.
- Initial F3 listeners are correctly required before the first `Document.load`; the check targets the real Adapter `resolveRoots`/`awaitObjectTree` readiness contract rather than `isLoadDone()` alone.
- One coherent browser/Viewer/registry/world session, read-only F1/F2/F4/F5/F7/F8 before mutating F6, and model-identity-based late-unload protection match the accepted T3 lifecycle contract.
- F7 remains read-only G1 evidence: it does not start markers, isolation, fit/focus, DockingPanel, G2, or G3. F8 compares runtime dbId surfaces only and does not derive `modelKey`/`modelVersion` or start OQ-1.
- Structured `Document.load` errors and primary-error preservation are correctly intended; cleanup is independently attempted in principle. C1/H4/L2 tighten the missing aggregate and late-work rules rather than requiring new architecture.

## Scope and dependency conclusion

No unauthorized dependency has appeared. The accepted existing Room Locator fixture, isolated `AutodeskProduction2`/`streamingV2` page, Viewer 7.124.2, actual repository modules, and test-only routing are sufficient to build the harness after plan remediation. Required corrections do **not** need:

- a production initializer change or model upload/retranslation;
- G2/G3 or H1/H2;
- OQ-1 or host composition;
- Viewer Adapter/Core/M4/Panel production changes.

## Owner state

No unresolved product or architecture choice remains. The owner still must accept the four adjudications above and a corrected plan, then explicitly authorize harness implementation. Live F1–F8 execution must remain a later, separate owner authorization after the implemented harness is independently reviewed.

**Final status: revise the harness build plan before implementation authorization.** Blocking findings: **C1 and H1–H7**.
