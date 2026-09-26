# Viewer Clash Panel design — internal Codex review record

- **Review date:** 2026-09-26
- **Repository / branch / HEAD:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection` · `main` @ `255dcca4650e15193c3bf78a698f2a6f54fdb374` (= `origin/main`); nothing committed.
- **Artifact reviewed:** `docs/superpowers/specs/2026-09-26-viewer-clash-panel-design.md`
- **Nature:** **internal** review (a convergence tool, **not** an independent gate). It does not authorize implementation planning; the next gate is the independent Work design review → owner decision.
- **Authorization:** owner prompt `docs/prompts/viewer-clash-panel-planning-authorization-prompt.md` (Viewer Clash Panel planning/design only).
- **Outcome:** 0 Critical / 0 High remaining after remediation; every finding verified against the repository before acceptance; unresolved product decisions recorded as owner decisions in the spec (§17).

## Round 1 — `codex-review spec` (medium), request `20260926-150306-55433-31418`

Result: **3 Critical / 3 High-or-Important / 3 Medium** as reported (readiness verdict "Requires major revision"). Each finding was re-checked against code (`clashtest/results/residency.js`, `clashtest/engine.js`, `clashtest/results/status.js`, `clashtest/derive/*`) before acceptance.

| ID | Sev. | Finding | Verified | Disposition |
|---|---|---|---|---|
| C1 | Critical | Spec used `retainResultSet`/`releaseResultSet(runId)` as a pair; in Core `retainResultSet` returns a one-shot lease, throws `UnsavedResultSetError` unless persistence is `saved`, and `releaseResultSet` throws `ResultSetRetainedError` while a lease is outstanding | **Yes** (`residency.js:278-300`, `engine.js:961-963`) | **Accepted.** Spec §5.2 (port signature), §7.6 (persistence-state machine, lease-first release, `acknowledgeUnsaved` only after explicit user action, admission-first ordering), PV-3, AC-P14. |
| C2 | Critical | "Never clobber foreign isolation" contradicted by a clear-all fallback when `getAggregateIsolation` is unavailable | Yes (logic) | **Accepted.** §9.5: isolation prerequisite (reliable read-and-compare **and** no hidden state), canonical normalization, **no clear-all fallback**, Isolate disabled instead; §9.4 ownership by read-and-compare; §16; AC-P16. |
| C3 | Critical | "Atomic" `present()` had no mutation order, rollback or supersession protocol | Yes (spec gap) | **Accepted.** §9.2 serialized presentation transaction: single-flight queue, token check before every mutation, per-token resource ledger, mutation order, camera fit outside the guarantee; AC-P16. |
| I1 | High | "Filtering never blocks" false: first `getPairStatus` builds an O(results+ledger) reader synchronously | **Yes** (`status.js:90-108`) | **Accepted.** §7.5/§8.2/§10.1: no `getPairStatus` on any interactive path; `caveated` mask via one cached async derivation; "never blocks" guarantee removed; per-pair coverage display deferred. |
| I2 | High | Grouped view: one `resultId` has several rendered occurrences; `indexOf(resultId)` pages/scrolls to the wrong one | Yes (spec gap) | **Accepted.** §12.2 occurrence identity `{groupId, resultId}`; AC-P17. |
| I3 | High | Async supersession specified only for Viewer presentation and filtering | Yes (spec gap) | **Accepted.** §5.2 controller generation + sequential derivation queue; AC-P15. |
| I4 | Medium | Panel told to read effective engine limits that the engine object does not expose | **Yes** (`engine.js:1352` — methods, registry, derivations only) | **Accepted.** §5.2 "no effective limits" paragraph; §6.1, §12.5 (no numeric pre-checks; react to typed errors; read run-recorded values from provenance only). |
| I5 | Medium | No DOM-safety requirement for Viewer-supplied names | Yes (spec gap) | **Accepted.** §8.2 text-only insertion; AC-P13 (hostile-label test). |
| I6 | Medium | Result-cap advice "raise tolerance" reversed clearance semantics | Yes (semantics) | **Accepted.** §13 row: reduce clearance (Soft) / narrow selection; Hard offers scope-narrowing only. |
| Q1–Q4 | Question | new-run replacement on admission failure; row-click vs Focus; readiness refresh; draft `testId`/`revision` lifecycle | — | **Answered in spec:** §7.2/§7.6 (admission first, previous results preserved on failure), §9.3 ("Focus on select" toggle), §6.2 (`ModelCatalog.onChange` incl. readiness + poll), §6.1 (draft identity lifecycle). |

## Round 2 — targeted `codex-advisor` (medium) on the remediated areas only, request `20260926-150950-68056-13318`

Scope: the changed sections and their directly affected invariants (no unrestricted re-review, per project `CLAUDE.md` review boundary). Result: **2 High + 2 Medium** (plus a Medium restatement), no new Critical; "residency, isolation normalization, draft identity, occurrence identity — no new defects".

| ID | Sev. | Finding | Disposition |
|---|---|---|---|
| R2-H1 | High | §9.6 restore table cleared Viewer state **before** `startRun`, contradicting §7.2/§7.6/AC-P14 (admission failure would erase the previous visualization) | **Accepted.** Row changed to "after `startRun` returns a handle". |
| R2-H2 | High | `clear()`/`dispose()` returned synchronously while sharing an async single-flight queue; no defined completion point; post-dispose `present()` unspecified | **Accepted.** §9.2: both return Promises, resolve only when the queue has drained and cleanup completed; post-dispose calls are non-mutating; AC-P6 text updated. |
| R2-H3 | High | Ledger recorded resources *after* mutation, so a throw-after-partial-effect leaked state | **Accepted.** §9.2: write-ahead ledger (intent + pre-image before each mutation, confirmed after), ambiguous-throw cleanup by read-and-compare; AC-P16 includes throw-after-effect. |
| R2-M1 | Medium | Replacing `getPairStatus` removes the synchronous reader build but each Core derivation still does a synchronous O(n) Result-Set **capture** (`derive/context.js`) | **Accepted.** §7.3 derivation-cost caveat (≤ 3 captures per run, unmeasured, no non-blocking claim), PG-3 extended; Core follow-up recorded, not assumed. |
| R2-M2 | Medium | "Once per (run, spec)" contradicts bounded retries after `DerivationBusyError`/abort | **Accepted.** §5.2/AC-P4: one *successful* cached computation per `(generation, spec)`, retries allowed. |

Verified clean by round 2: §7.6 matches the residency contract (one-shot leases, saved-only retention, retained-release errors, acknowledged unsaved release, non-resident no-op; by-id reads read resident sets and read through / reject after eviction); the sequential derivation queue prevents the Panel's own three derivations from causing `DerivationBusyError`; §9.5 never clears unreadable isolation.

## Round 3 — targeted `codex-advisor` (medium) on the Work-review remediation only, request `20260926-154409-11367-14981`

Scope: exactly the changed areas — H1 markers-only emphasis, H2 fail-closed Soft basis, M1 registration boundary, L1 Q1 list, the new normative §14 UX/`DockingPanel` shell, and their cross-references; SVF2 direction checked for non-alteration. No unrestricted re-review. Result: **0 Critical / 1 High / 1 Medium / 2 Low**; all verified against the spec text and accepted.

| ID | Sev. | Finding | Disposition |
|---|---|---|---|
| R3-H1 | High | RQ-1 recorded as open in §2.1/PG-4/§21 while §22 (and the independent review) had already adjudicated option (b) | **Accepted.** §2.1, PG-4, §21 now record the adjudicated disposition (b), package-scoped, as a gate classification (not an owner decision, not authorization of the verification task). SVF2 direction unchanged. |
| R3-M1 | Medium | §16 Units row said any differing/unavailable unit scale disables Soft, contradicting §6.2 step 4 (single model available; multi-model via host verdict incl. evidenced normalization) | **Accepted.** §16 Units row aligned to §6.2 step 4/PR-BASIS. (Fail-closed; no wording enabled mixed-basis Soft.) |
| R3-L1 | Low | §2.1 F8 still listed "theming" among APIs to verify | **Accepted.** F8 now names isolate/fit/name/bounds APIs. |
| R3-L2 | Low | §0 Q1 omitted `getPersistenceState` / `RunHandle.persisted` used by §5.2/§7.6 | **Accepted.** Added. |

Verified sound by round 3: repository claim that `getUnitScale()` feeds only the weld epsilon (`collision/CollisionWorld.js`, `constants.js`) with no Core distance conversion; the marker/bounds-outline ledger under Panel ownership; markers → guarded isolation → best-effort fit remains rollback-safe; the Panel core never registers, derives identity, repairs bindings, wires unload or invalidates placement; removing `invalidateModelPlacement` from `EnginePort` is consistent with PR-OQ17; §14 has the five regions in order and a thin DockingPanel with no WASM/telemetry; Hide Panel (clear Viewer presentation, keep controller selection) is consistent with DOM reconstruction from the view-model.

Convergence: findings concerned consistency of the remediation (one stale open-question, one aligned row, two cross-reference gaps), not architecture; all fixed; no further automatic round.

## Supporting research (not a review)

`docs/research/2026-09-26-viewer-clash-panel-viewer-api-evidence.md` — static evidence read of the pinned 7.124.2 bundle (nothing executed) produced after round 1 and folded into the spec (§9.5 hidden-state condition, §9.1 `not-in-scene`/`hideModel`, §14 DockingPanel adapter, §16). Its findings that changed the design: `setAggregateIsolation([])` also clears hidden state and `getAggregateIsolation` cannot express hidden nodes; `hideModel` fires `MODEL_REMOVED_EVENT` but not `BEFORE_MODEL_UNLOAD_EVENT`; the aggregate `fitToView` union form is undocumented and requires the key `selection`; the isolation event carries no origin marker.

## Classification of remaining concerns (project `CLAUDE.md` categories)

| Concern | Class |
|---|---|
| Panel code location, pagination vs virtualization, modes offered, emphasis technique (markers-only in v1 after the independent review, OD-5), camera restore, previous-results retention, modelKey policy, default clearance, marker helper, grouping set, extension coexistence, unit display, qualified-claim acceptance (OD-1…OD-14) | product/integration decisions (owner) |
| OQ-1 modelKey/modelVersion derivation; OQ-17 placement-invalidation owner; host composition and static routes | dependencies gating **integration acceptance**, not design |
| Viewer API behaviors not runtime-observed (aggregate `fitToView` union bounds, element bounds/overlay scene, isolation, DockingPanel subclass lifecycle; Viewer theming was removed from v1 after the independent review, PD-16) | verification gate (PG-1); unit-basis validity is PR-BASIS/PG-5 |
| First live engine run over real models; unmeasured result counts, latency, memory, Result-Set capture pause | verification/calibration gates (PG-2, PG-3) |
| Transaction/ownership contracts, residency machine, derivation scheduling, occurrence identity | implementation-plan requirements (specified in the spec; tests enumerated as AC-P13…P17) |
| Per-pair/per-element coverage display; async status-reader precomputation; partial browse; annotation grouping; persistence UX | deferred / non-goal for v1 |

## Convergence and stop

Round 2 found only defects in the machinery introduced by round-1 remediation (ordering, completion semantics, ledger exception-safety) plus one unrelated cost caveat; all are fixed and none touches the original architecture. Per the convergence rule the loop **stops here**: no third automatic round. The spec is at a stable checkpoint under the "Ready for independent gate" criteria — no known Critical/High correctness blocker at its abstraction level; Medium/Low findings dispositioned; research/measurement/product/integration questions recorded as gates or owner decisions rather than guessed closed.

**Not authorized by this record:** an implementation plan, a Panel branch, any `clashpanel/` code or test, host integration, OQ-1 derivation, reload-digest investigation, Adapter/Core/M4 changes, pushing.
