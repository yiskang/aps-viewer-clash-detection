# Viewer Adapter implementation plan — internal Codex review and convergence record

- **Artifact:** [`docs/superpowers/plans/2026-09-26-federated-clash-test-viewer-adapter-implementation.md`](../superpowers/plans/2026-09-26-federated-clash-test-viewer-adapter-implementation.md) (planning only; no production code exists).
- **Branch:** `feature/federated-clash-test-viewer-adapter` (from `main` @ `267801e`).
- **Reviewer:** the configured Codex workflow (project `CLAUDE.md` "Internal review loop"). Raw responses: `.codex-worker/responses/<request-id>/response.md` (local, not committed).
- **Status of this record:** an internal review, **not** an independent gate. The plan is marked **ready for independent ChatGPT Work review**; implementation is not authorized.

## Round 1 — full `codex-review spec` (medium), request `20260925-215323-52419-7846`

Verdict: *requires major revision* (2 Critical, 3 High, 1 Medium, 4 questions). Each finding was checked against the repository before acting.

| # | Codex finding | Verified? | Disposition |
|---|---|---|---|
| C1 | Explicit `digestScope` returns entries `resolveRoots` removes (unknown ids, listed descendants); `checkEnumeratorConformance` (`ElementEnumerator.js:~262-270`) requires equal root lists | **Yes** — helper compares `d.roots.map(project)` to `res.roots.map(project)` for the same raw scope | **Accepted** — see round 2 for the final form (one shared `normalizeExplicit`) |
| C2 | `checkpointNow` declared `async` ⇒ always a microtask hop between "validated" and the model read; repo's own extraction code (`ViewerModelAdapter.js:78-86`, "Item D") deliberately avoids this | **Yes** | **Accepted** — non-`async` passthrough; call sites branch on the return; same-tick tests added |
| I1 | Post-readiness-wait `getObjectTree()` read is unguarded | Yes | **Accepted** — fresh checkpoint after the wait; test added |
| I2 | Adapter omits `maxFragmentsPerDbId` / `maxChildrenPerNode`; cannot checkpoint inside synchronous Viewer callbacks | Partly | **Partially accepted.** Cap parity **rejected** (D-V9): the caps are execution-time limits the executor records as `failed:extraction-limit` (declared gap); throwing at planning would turn a per-unit gap into a total failure. **Accepted:** the callback-burst exemption is now stated explicitly (Global Constraint 5) and recorded under G-CAL |
| I3 | D-V6 reads as universal but is implemented for whole scope only | Yes | **Accepted** — D-V6 limited to whole-population reconciliation; explicit scopes inherit spec §6.2's declared residual limit; two tests pin it |
| I4 | Unload wiring does not check registry/world pairing | Yes (`assertRegistryBelongsToWorld` exists, `ModelRegistry.js:302`) | **Accepted** — wiring calls it; layering allowlist extended for that single import |
| I5 | No mandatory live gate before "production" | Yes | **Accepted** — milestone label is *"implementation complete, live acceptance pending"*; new gate G-VA-T3-EXEC |
| Q4 | Constraint 1 vs handoff edit | Yes | **Accepted** — wording clarified (handoff governed by project `CLAUDE.md`) |

## Round 2 — targeted `codex-advisor` re-check (medium), request `20260925-220044-63448-25759`

Scope: only the round-1 remediations and the invariants they touch (per the review-boundary rule; no full re-review).

| # | Codex finding | Verified? | Disposition |
|---|---|---|---|
| R2-1 (Critical) | The round-1 C1 fix (`digestScope` walking each listed id and using `walkSubtree`'s new `listedDescendants`) could disagree with `resolveExplicit` if `enumNodeChildren`/`enumNodeFragments` on an id absent from the index return content; that Viewer behavior is unevidenced | Reasoning valid; not reproducible on the mock | **Accepted, fix simplified:** remove the `listedDescendants` machinery entirely; **one shared `normalizeExplicit`** (full-tree index → existence, no-listed-ancestor, ≥1 fragment, no shared fragment) is used by *both* `resolveRoots` and `digestScope`, so equivalence is structural and no unknown-id Viewer behavior is relied on. Cost (a whole-tree pass per explicit bracket side) is recorded under D-V4/G-CAL for T3 to measure; spec §6.2.1 already accepts "the same order as the library's own per-call whole-model extraction" |
| R2-2 (Critical) | After `await awaitObjectTree(...)` the callers read `model.getFragmentList()` — a second microtask gap | **Yes** (my own pre-check found the same residual) | **Accepted** — `awaitObjectTree` now returns `{tree, fragList}`, both read in the same tick as the last checkpoint; callers never touch `model` after an `await`; the same-tick test now covers readiness + tree + fragment-list reads |
| R2-3 (High) | Task 6's test called the `resolveRoots` stub | Yes | **Accepted** — the cross-method equality assertions moved to Task 7 |
| — | No defect found in D-V6 scoping, unload wiring, `assertRegistryBelongsToWorld` signature/import, or `{owners, listedDescendants}` consistency (the latter now removed) | — | — |

## Convergence adjudication (project `CLAUDE.md`: "If later review findings are primarily about machinery introduced by earlier remediation … stop the loop")

Round-2 findings R2-1 and R2-3 were about machinery introduced by round-1 remediation (`listedDescendants`, a Task-6 cross-method test); R2-2 was a residual of the round-1 checkpoint fix. The remediation therefore **reduced** machinery instead of adding more, and **the internal loop is stopped here**; no third round was run. Remaining concerns are classified:

| Concern | Class |
|---|---|
| Real Viewer accessor behavior (unknown-id enumeration, `getRootId`, callback semantics) is not proven by mocks | verification/calibration gate → **G-VA-T3-EXEC** (owner-run T3) |
| Per-bracket whole-tree pass cost; `CHECK_EVERY = 64`; `readinessPollMs = 250` | verification/calibration gate → G-CAL (characterize at T3, never asserted) |
| D-V6 (tree-reachable N/U ⇒ `enumeration-failed`) is a **spec-silent** interpretation | product/integration decision → owner may revisit at the Work gate |
| D-V9 (no per-root extraction-cap parity at planning) | design decision → owner may revisit |
| Tasks 10, 11, 13 give test enumerations + contracts rather than full test source | implementation-plan requirement → Work review to rule |
| OQ-1, OQ-16, OQ-17, OQ-4 non-evidenced cases, P5 ordered-pair readers, doc reconciliation, AC-17(d)/AC-19 compare conjuncts | deferred / independent follow-ups (recorded in the plan; none absorbed) |

**Honest limits of this review.** (1) The plan's code and test snippets were **not executed** (implementation is unauthorized); Codex and I checked them by reading against the repo's real signatures. Signatures verified during planning: `EnumerationCancelledError({reason})`, `CapacityExceededError(kind, details)`, `checkEnumeratorConformance({enumerator, binding, cases:{scopes:[{name,scope}]}, checkpoint?}) → {failures}`, `assertRegistryBelongsToWorld(registry, world)`, empty-list digests. (2) Codex reviews found no defect in the core-facing contract (port shapes, digest producers, planner mapping by error name), but the executable proof is the implementation's own TDD run.

**Ready-for-independent-gate check (project `CLAUDE.md`):** no known Critical/High correctness blocker remains at the plan's abstraction level; Medium/Low findings are dispositioned above; unresolved research/measurement/product questions are recorded as gates rather than guessed closed; the artifact is internally consistent enough to be considered for authorization of implementation — **subject to the owner's explicit authorization, which has not been given.**

## Round 3 — Work-review remediation and targeted re-check (2026-09-26)

**Trigger.** The independent ChatGPT Work review of the plan reported **0 Critical / 3 High / 3 Medium / 1 Low** (High 1 unbounded planning; High 2 committed-red Tasks 1–3; High 3 D-V6 unresolved; Medium 1 Task 10 literals/signatures; Medium 2 Task 6 contradiction; Medium 3 live unload wiring not exercised; Low Task 1 miscount). Two owner decisions were supplied and applied verbatim: **D-V6** (fail-closed planning for tree-reachable not-loaded / owner-unresolvable / out-of-range fragments; no partial carrier; Core contract not reopened) and **D-V9** (planning bounded by the existing collision limits before Core execution; no new limit; no Core change). Remediation was made in place in the plan; no production code, no `clashtest/viewer/`.

**Fact-finding (read-only subagents, verified against current source).** Task 10: terminal status `completed`; `validateResultSet(set, { limits })` (`ENGINE_LIMIT_DEFAULTS`); `ledger.rootOwners` is per model with nested `owners`; there is no sealed `ownerMismatch` field (recorded as empty `ledger.planningGaps`); scope digests at `provenance.models[].scopeDigests`; fixture `fragments` is a top-level option; unrecognized/`CapacityExceededError`/`ObjectTreeUnavailableError` throws map to `enumeration-failed`. Mock/limits: `enumNodeChildren` aborts only on strict `true` and has call/callback counters; `enumNodeFragments` is not abortable; library tallies per requested root across the subtree with rediscoveries counted and checks after each node's own list; `> limit` comparators (exactly at limit succeeds); `extractAllFragments` compares `fragList.getCount()` before reading any fragment. Live harness: `viewer.unloadModel` + `BEFORE_MODEL_UNLOAD_EVENT` `event.model` is evidenced only indirectly (clash-finder acceptance); reload of the same URN and an in-page engine/world have never been exercised live — hence step (h) plus the retained `LIVE_UNLOAD_INTEGRATION_UNVERIFIED` fallback.

**Targeted `codex-advisor` (medium), request `20260925-224729-16259-31259`,** scoped to the changed areas only (bounded planning, D-V6, Tasks 1–3 green checkpoints, Task 6 wording, Task 10 signatures, Task 13 (h)). No Critical. Findings, each checked against the plan/source before acting:

| # | Finding | Verified? | Disposition |
| --- | --- | --- | --- |
| 1 (High) | Task 13 (h) could select an already-loaded sibling model as the reloaded `Y` (`getAllModels()` already contains loaded models), falsely passing the production-readiness gate | Yes (my wait condition was "a model with `isLoadDone()`") | **Fixed:** snapshot remaining models after unload; `Y` = a model absent from the snapshot with the reloaded URN identity and `isLoadDone()`; timeout ⇒ step fails |
| 2 (Medium) | Fanout tests used exactly limit + 1 children, so a natural end and an abort are indistinguishable | Yes | **Fixed:** fixtures use limit + 2 (10,002); callback totals unchanged (10,002 / 10,001) |
| 3 (Medium) | Task 2 expected total omitted Task 1's 7 tests | Yes | **Fixed:** 2,848 + 7 + 4 = 2,859 |
| 4 (Medium) | Task 9 Step 4 lacked the full-suite gate | Yes | **Fixed** |
| 5 (Medium) | Task 13 (h) cleanup left a raw listener, the `evictModel` shim and a live registry binding | Yes (`evictModel` does not unregister) | **First fix:** `finally` cleanup. A further bounded Work finding found it not safe under partial initialization; **re-corrected** (guarded, independent steps, original failure primary) — pending Work re-review, not yet closed |

Areas Codex checked and found sound: D-V9 traversal bounds (per-root tally semantics, rediscoveries, check-before-children, population gate before allocation/traversal), all specific arithmetic (7 / 10,002 / 6 nodes, 5,001 callbacks, 19,995 unattributable, `enumNodeChildrenCalls === 1`, `enumNodeFragmentsCalls === 2`), D-V6 tests vs Task 8 code and no remaining "open decision" wording, Task 10 signatures, Task 6 vs D-V4, Task 11 vs real `ModelRegistry`/`CollisionWorld`, gate-label coherence. Also found by the controller while remediating: the pre-existing Task 4 assertion `idx.nodes.size === 8` was wrong (7 nodes) — fixed.

**Convergence.** The re-check's findings were procedural/test-precision corrections in the *changed* areas, not architecture; all were fixed except that finding 5 (Task 13 cleanup) was re-corrected after a later bounded Work finding and awaits Work re-review; no further broad review round was run (project `CLAUDE.md` review-boundary rule). **Honest limits:** the plan's snippets remain un-executed; Viewer callback/abort and event behavior remain live-unverified until an owner-authorized T3 run. Node *count* is bounded by no existing limit — recorded residual (D-V9), not a new limit. **Status:** ready for independent ChatGPT Work re-review; implementation and T3 execution remain unauthorized.

**Round 3 addendum — bounded Task 13 cleanup correction (2026-09-26).** A later bounded Work finding required the (h) cleanup to be safe under partial initialization. The paragraph was rewritten (per-resource guards, independent `try/catch` steps, original failure primary, cleanup-only failures aggregated, acceptance items (a)–(c)). A targeted `codex-advisor` (medium; request `20260925-230401-35637-20346`, scoped to that paragraph and the directly affected handoff/record wording) found no Critical/High and four Medium wording defects, all verified real and fixed: (1) steps (4)/(5) guarded only `X`/`Y`, not `registry`/`world`, and handled both models in one `try/catch` — now separate per-model actions with both operands guarded, and restoration requires both `world` and `evictShim`; (2) acceptance (b) could leak the listener — the injected failure now delegates to the real removal then throws; (3) acceptance (c) described an impossible model-set postcondition — now the expected-sibling snapshot with an explicit failure-path delta; (4) attaching `cleanupFailures` could mask a non-extensible/primitive primary — attachment is guarded and the exact primary value is always re-thrown. Codex confirmed as sound: the real `ModelRegistry.unregister`/`CollisionWorld.evictModel`/`isModelLive`/`dispose`/`engine.dispose` semantics, cleanup ordering, snapshot-based `Y` selection, and the handoff/record accuracy. **No further review round was run (bounded); the cleanup remains pending Work re-review and is not claimed closed.**
