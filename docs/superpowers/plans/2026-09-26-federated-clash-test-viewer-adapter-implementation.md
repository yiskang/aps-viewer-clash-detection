# Federated Clash Test — Viewer Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **STATUS: PLAN ONLY — NOT AUTHORIZED FOR IMPLEMENTATION.** The milestone owner authorized *planning* of this milestone (2026-09-26). Nothing below may be executed until the owner explicitly authorizes implementation after an independent Work review of this plan. See §"Authorization boundary".
>
> **REMEDIATION STATE:** an independent ChatGPT Work review of this plan (0 Critical / 3 High / 3 Medium / 1 Low) has been remediated in place (owner decisions D-V6 and D-V9 applied; Tasks 1–3 made green at every commit; Tasks 6, 10 and 13 corrected — record: `docs/reviews/2026-09-26-federated-clash-test-viewer-adapter-plan-internal-codex-review.md` "Round 3"). **The plan is awaiting independent Work re-review and is NOT to be treated as implementation-ready until that re-review says so.** Executing T3 (Task 13) is a separate owner authorization in any case.

**Goal:** Deliver the Viewer seam of the accepted Federated Clash Test core engine: a real `ElementEnumerator` over an Autodesk Viewer `Model`, and the `ModelRegistry` unload wiring, in a new `clashtest/viewer/` directory, with **no edit to any accepted core file**. **Completion label:** when Tasks 1–12 are done the milestone is *"implementation complete, live acceptance pending"*; the adapter may be described as production-ready only after an owner-authorized **execution** of the Task 13 T3 script passes (Gate G-VA-T3-EXEC) — mocks cannot prove that the real Viewer calls its accessors as this layer assumes.

**Architecture:** `clashtest/viewer/` is a leaf layer that *implements* the already-frozen ports (`clashtest/planning/ElementEnumerator.js`, `clashtest/identity/ModelRegistry.js`). It touches the Viewer only through duck-typed accessors on the `Model` object handed to it in a `Binding` (no `Autodesk`/`THREE`/`window` global, no static Viewer import), so it is testable headless over `buildMockModel` (T1/T2) and separately proven live (T3, owner-run, never in `npm test`). It re-reads the live model on every call (never cached), reuses the core's own digest producers (`digestPopulation` / `digestSubtree`) so bytes match the planner's, and fails closed on every inconsistency it can detect.

**Tech Stack:** Node ≥ 22 ESM, `node:test` + `node:assert/strict`, the repo's `buildMockModel` fixture, Playwright (T3 only, already a devDependency).

**Spec:** `docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md` (FROZEN — §2.1, §4.2–4.3, §5.6, §6.2, §6.2.1, §16.6, §17.3, §24 OQ-1/OQ-4/OQ-16/OQ-17). Accepted evidence: `docs/research/2026-09-26-federated-clash-test-oq4-live-evidence-check.md`. Readiness assessment: `docs/research/2026-09-26-federated-clash-test-core-post-p8-closeout-and-next-milestone-readiness.md`. Readiness decision: `docs/superpowers/specs/instance-tree-readiness-decision.md`.

## Global Constraints

Every task's requirements implicitly include these (values copied from the repo/spec):

1. **No core edits.** Nothing under `clashtest/` outside `clashtest/viewer/` is modified, **except** the single adapter row of `clashtest/README.md` (Task 12). The frozen spec, accepted P0–P8 plans, `collision/`, `server.js`, `wwwroot/` and `CHANGELOG.md` are not modified. The only other permitted edits outside `clashtest/viewer/` and `test/` are `docs/superpowers/plans/` (this plan) and `docs/handoffs/latest.md`, the latter governed by the project `CLAUDE.md` "Agent Handoff Convention" (update at the end of a substantial task; not by this plan).
2. **Layering (spec §2.1).** `clashtest/viewer/**/*.js` may import only: sibling `./*.js`; `../planning/ElementEnumerator.js`; `../planning/scopeDigest.js`; `../util/slicer.js`; `../identity/ModelRegistry.js` (only `assertRegistryBelongsToWorld`, Task 11); `../../collision/errors.js`; `../../collision/constants.js`. It must not reference the globals `Autodesk`, `Viewing`, `window`, `document` or `globalThis.THREE`. Nothing outside `clashtest/viewer/` may import it (the core barrel `clashtest/index.js` does **not** export it — the adapter has its own entry point `clashtest/viewer/index.js`).
3. **Port fidelity.** Return shapes must pass `validateResolveRootsResult` / `validateDigestScopeResult` (`clashtest/planning/ElementEnumerator.js:74,174`) and `checkEnumeratorConformance` (`:219`). `resolveRoots` and `digestScope` **re-read the live model on every call; nothing is cached** (spec §6.2).
4. **Never call `instanceTree.getChildCount`** (the mock throws by design; C-1 invariant-audit). Never call `enumNodeChildren`/`enumNodeFragments` with `recursive === true`.
5. **Checkpoints — conditionally synchronous, exactly like `collision/scheduler.js` and `ViewerModelAdapter` ("Item D").** Every method calls `ctx.checkpoint()` once **before** it reads the model, and the read must happen **in the same tick** when the checkpoint returns `undefined`: call sites use `const p = checkpointNow(ctx); if (p) await p;` where `checkpointNow` is a **non-`async`** passthrough — never `await checkpointNow(ctx)` (a bare `await` on `undefined` still inserts a microtask boundary in which an unload could land between "validated" and "read"). A checkpoint also runs immediately before any model read that follows an asynchronous wait (readiness). Loops checkpoint at least once per `CHECK_EVERY = 64` node visits / fragment scans / records. `EnumerationCancelledError` propagates unwrapped (spec §6.2, §17.3). **Exemption (stated, not hidden):** items delivered *inside a single synchronous Viewer callback enumeration* (`enumNodeFragments`, `enumNodeChildren` on one node) cannot be checkpointed; the 64-item rule counts nodes/fragments *between* callbacks. The Viewer's own burst is not preemptible (`enumNodeFragments` cannot be aborted; `enumNodeChildren` is aborted at limit + 1), but what the adapter *retains* from a burst is capped at the existing limit (D-V9: recording stops at `maxFragmentsPerDbId`, the children callback aborts at `maxChildrenPerNode` + 1).
6. **No wall-clock assertions (G-CAL).** Provisional constants (`readinessPollMs = 250`, `CHECK_EVERY = 64`) are overridable and never asserted against elapsed time.
7. **No new tolerance literals** in `clashtest/viewer/` (`test/clashtest/options.defaults.test.mjs` scans all of `clashtest/`).
8. **`npm test` stays offline** (spec §21.3/§22): no live server, no APS credentials, no Chromium in any `*.test.mjs`.
9. **Commits** end with `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` and contain **no** `Claude-Session:` trailer (user's global rule). Commit only when this plan's implementation has been authorized.
10. **Baseline to preserve:** full `node scripts/run-tests.mjs` = **2,848 total / 2,847 pass / 0 fail / 1 pre-existing todo** at `267801e`; every task ends with the full suite green and the total only ever growing.
11. **Green at every commit.** RED exists only *inside* a task's own steps (write the failing test → see it fail → implement → see it pass). Each task's committed checkpoint leaves the **full suite green**; no task scaffolds a test that is expected to stay red until a later task. A guard that must see production files uses the per-task `scaffold.test.mjs` list (Task 3), which grows in the same task that adds each module.
12. **Bounded planning (D-V9).** Planning never retains a structure before it has been charged to an EXISTING collision limit (`maxFragmentsPerDbId`, `maxChildrenPerNode`, `maxCollisionInstancesPerEpoch` — read from `collision/constants.js`, never changed, no new public limit). Crossing one fails planning deterministically (`enumeration-failed`); a failed pass leaves nothing behind (no module-level state). The number of tree *nodes* is bounded by no existing limit and stays an explicitly recorded residual (Task 4).

## Scope determination (independently verified, 2026-09-26)

**Repository state verified** (subagent + controller): branch `feature/federated-clash-test-viewer-adapter` created from `main`; `main` = `origin/main` = `267801eae7b87ccc07fb81b03cb4e10f4f4f28d3`; `clashtest/viewer/` does not exist; the only `resolveRoots`/`digestScope` implementations are test fakes (`test/clashtest/support/fakeEnumerator.mjs`, `syntheticModels.mjs`); full suite re-run at `267801e`: **2,848 total / 2,847 pass / 0 fail / 1 todo**.

**In scope (this milestone's implementation, once authorized):**

| # | Deliverable | Spec basis |
|---|---|---|
| S1 | Production `ElementEnumerator` (`resolveRoots`, `digestScope`) over a Viewer `Model` | §6.2, §6.2.1 |
| S2 | Object-tree readiness gate that fails rather than returns a partial list | §6.2 (tree readiness), instance-tree-readiness-decision |
| S3 | `ModelRegistry` unload wiring (`unregister` + `evictModel` on `BEFORE_MODEL_UNLOAD`, never throws/awaits) | §4.3, §16.6 |
| S4 | Conformance + differential + content-case tests (T1/T2), engine-level integration test (T2) | §6.2.1 AC-2, `checkEnumeratorConformance`, P3 plan "adapter adds its own content cases" |
| S5 | A **T3 live acceptance script authored** (execution is a separate owner authorization) | AC-15 (a)–(g), §1.3.4 |
| S6 | Adapter README + the one `clashtest/README.md` adapter row | — |

**Out of scope (explicitly not absorbed):** host integration (`wwwroot/`, `server.js`, extension code, calling `wireModelUnload` from a real page); the Viewer Clash Panel/UI; `modelKey`/`modelVersion` derivation (OQ-1 — host decision); qualified-claim presentation (OQ-16); host owner/integration acceptance (OQ-17); remote persistence (G-REMOTE); annotation; new/tighter public limits; reopening any accepted phase or M4; OTG/SVF2/2D/non-Revit support (not evidenced).

### Disposition of the three pending items (owner asked: prerequisite or independent?)

Verdict for all three: **independent follow-ups, NOT prerequisites; this plan absorbs none of them.** Evidence: subagent Report C, spot-verified.

| Item | Verdict | Why it is not a prerequisite | What would change the verdict |
|---|---|---|---|
| **P5 ordered-pair status-reader defect** (`clashtest/results/status.js` `findCoveringUnit`, `:179-183`, checks both orientations) | Independent follow-up (needs its own authorization to reopen accepted P5) | The public readers are imported only by `clashtest/derive/*` and the barrel; **no** adapter-side module (`planner`, `rootResolution`, `scopeDigest`, `coordinator`, `Run`, `ModelRegistry`) reaches `status.js`. Adapter acceptance AC-15 (g) runs in `volume-overlap` (unordered), where the defect cannot occur. | A containment-mode acceptance arm, or host display of containment status, that reads `getPairStatus`/`getElementStatus`/`summarize`. **Plan rule:** adapter tests must not assert containment pair status through the public readers. |
| **Documentation reconciliation** (stale `CHANGELOG.md` / `clashtest/README.md` narrative, plan/spec errata) | Independent follow-up | The port and registry docs an implementer reads are accurate (`README.md:45,49`, spec §6.2, `engine.js:480-487` all match code). Only `clashtest/README.md:72` ("Viewer adapter … Proposed … open question OQ-4") concerns the adapter boundary. | Editing that one adapter row becomes adapter-owned **only because this milestone delivers the adapter** (Task 12 edits exactly that row and nothing else). The other stale lines (`README.md:19-23,29-35`, `CHANGELOG.md:10,16-20`, AC-14(iii) wording, P5 plan errata, `2026-09-20-…-core-engine-implementation.md:43`) stay untouched. |
| **AC-19 (b)/(d′)/(e) and AC-17 (d) engine-level `compareResultSets` sub-conjuncts** (P7 table assigns them to P8; P8's coverage table and tests do not name them) | Independent follow-up (traceability gate needing an owner ruling: a test-only follow-up, or an explicit "covered synthetically" ruling) | All four are pure derivations over two sealed Result Sets; none calls the enumerator or registry or needs model identity from a real Viewer (`derive/compare.test.mjs:51-57,156-158` cover mixed-owner and `environment-sensitive:base` synthetically). | The adapter plan claiming AC-19(e) closed at T3, or claiming AC-17/AC-19 closed as a whole. **Plan rule:** this plan claims neither. The *separate* requirement that scope digests do not change when render-proxy readiness changes (§1.3.6/§6.2.1) **is** carried here as Task 6 Review-Focus item 6. |

## Design decisions (owner-visible; every one is reversible in review)

**Owner-resolved in the Work-review remediation (no longer open):** **D-V6** (fail-closed planning for tree-reachable not-loaded / owner-unresolvable / out-of-range fragments — no partial carrier, Core port/result contract not reopened) and **D-V9** (planning bounded by the existing collision limits before Core execution — no new limit, no Core change). Every other decision below remains reversible in review.

- **D-V1 — Own the walk; do not import the library's extraction functions.** The adapter re-implements the tree walk and population scan with the *same rules* (first-discovery-wins pre-order; `getDbIds` owner; N/U/L classes) rather than importing `collision/viewer/ViewerModelAdapter.js`. Reason: those functions are not exported from `collision/index.js`, need a `THREE` scratch and compute world matrices/bounds the digest does not use, throw the library's own execution-limit errors (`ExtractionLimitExceededError`, whose per-unit execution mapping is not the planning mapping — the adapter enforces the same limits itself as planning bounds, D-V9), and importing them would couple the adapter to library internals. Equivalence is instead **proven by a test-only differential** against `extractFragments`/`extractAllFragments` (spec §6.2.1 "Conformance", AC-2) in Task 9. *Alternative rejected:* reuse — smaller code, but a second definition of "what the library extracts" would still be needed for N/U classes.
- **D-V2 — Readiness mirrors the library's recorded decision.** `isObjectTreeCreated() === true` fast path; else `getObjectTree(onSuccess, onError)`; `onError` → `ObjectTreeUnavailableError` (the library's class, so `LocalUnitExecutor` maps it to `failed:object-tree-unavailable` and the planner maps it to `enumeration-failed`, both already pinned); a tree that is absent/duck-type-invalid after readiness also → `ObjectTreeUnavailableError`. **While waiting, the adapter polls `ctx.checkpoint()` every `readinessPollMs` (default 250, provisional) so cancellation is honored instead of hanging.** *Not claimed:* that this gate is sufficient on the general Viewer — OQ-4 §7 records "general readiness-gate sufficiency" as **not evidenced**; the gate stays an explicitly re-validatable input (Gate G-VA-READY below). Geometry-load readiness (`isLoadDone()`) is **not** gated in v1: not-loaded fragments are claim-blocking, so early enumeration fails safe.
- **D-V3 — Whole-model roots = topmost nodes that themselves own fragments.** Starting at `getRootId()`, descend through nodes with no own fragments; the first node on each path that owns ≥1 direct fragment is a root (identical to the OQ-4 probe, Appendix A step 3, which produced 5,969 roots on the fixture). *Note:* `test/clashtest/support/realWorld.mjs` `syntheticSpecOf` uses a different convention ("top-level tree nodes whose subtree holds a fragment"); both coincide only for trees whose top-level nodes own fragments. Task 10 therefore proves the adapter against the **brute-force reference**, not against the synthetic enumerator.
- **D-V4 — Explicit-scope normalization is ONE shared implementation (`normalizeExplicit`) used by BOTH `resolveRoots` and `digestScope`, and it is BOUNDED (D-V9).** (Codex review C1 and its re-check: the frozen conformance helper requires `digestScope`'s roots to equal `resolveRoots`'s roots for the *same raw scope*; two separately-written normalizations can drift, and a per-id "walk it and see" shortcut would silently depend on unevidenced Viewer behavior for unknown ids.) **Exact mechanics:** (1) ONE bounded **parent-index pass** from `getRootId` using `enumNodeChildren` only — node ids and parent ids, per-node fanout ≤ `maxChildrenPerNode` (callback aborts at limit + 1), **no `enumNodeFragments` call at all, no `getNodeParentId`/`getChildCount`** (unevidenced on unknown ids) — answers `not-found` and the no-listed-ancestor rule; (2) for each surviving root, a **bounded subtree walk** (≤ `maxFragmentsPerDbId` per requested root with the library's tally semantics, fanout-bounded) supplies `no-fragments`, the members, and the no-fragment-shared-by-two-roots defect. There is **no separate count/preflight traversal**: the parent pass *is* the bounded whole-tree pass (it retains ids only and is a discarded local), so a second traversal would double the Viewer-callback cost and add no bound. A planned root that has since vanished, lost all its fragments, or become a descendant of another listed id is therefore simply **absent** from `digestScope`, and `compareScopeExpectation` reports the root-count `mismatch` (drift) — never an error. **Cost (recorded, not asserted — G-CAL):** every explicit `digestScope` (two per unit, §16.3) and `resolveRoots` costs one ids-only whole-tree pass plus the named subtrees, i.e. the same order as the library's own per-call whole-model extraction that spec §6.2.1 already accepts ("added cost per unit … of the same order"); the T3 script measures it, and a cheaper existence oracle is a later optimization once one is evidenced.
- **D-V5 — Separate entry point.** `clashtest/viewer/index.js`; the core barrel is untouched (no absence-pin to flip; core "imports nothing from the Viewer", §2.1).
- **D-V6 — OWNER-APPROVED fail-closed policy for tree-reachable N / U / out-of-range fragments (RESOLVED — not an open decision).** Owner disposition (Work-review remediation): *accept fail-closed planning for the current evidenced envelope.* **During WHOLE-model reconciliation, a tree-reachable fragment whose population class is `N` (not loaded) or `U` (owner-unresolvable: `getDbIds` undefined or an array), or whose id is outside `0..getCount()-1`, throws `EnumerationInconsistencyError` ⇒ planning gap `enumeration-failed` — planning fails for the run.** There is **no durable partial/incomplete carrier** in this milestone, the accepted Core port/result contract is **not** reopened, and the failure is the only outcome (no partial roots, no population, no diagnostic row). This is intentionally conservative; it may be revisited only by a future, explicitly authorized design if partial planning across these cases becomes a product requirement. **Explicit scopes keep their declared boundary and are NOT subject to D-V6** (unchanged by the owner disposition): an explicit `{dbIds}` scope has no independent population witness (spec §6.2 "Residual limit for explicit scopes"), the library's `extractFragments` does not check load state either, and the adapter must produce exactly what `extractFragments` would; explicit walks inherit that declared trust boundary, and a degenerate value an explicit walk *cannot digest* (e.g. a non-integer `getGeometryId`) still fails closed via the digest producers' `TypeError` (⇒ `enumeration-failed` at planning, `unverifiable` at a bracket). Task 7 pins both explicit behaviors; Tasks 8 and 10 pin the whole-model policy (each of N, U-undefined, U-array and out-of-range, twice for determinism, plus the engine-level `enumeration-failed` run with no results). Rationale (unchanged): spec §6.2 defines `unreachable.unattributable` only for fragments in *no* root subtree; for tree-reachable N/U fragments the two orientations disagree (target: dropped + `dbId:null` diagnostic; source: silently included) and no port field can carry the fact without changing the frozen `ownerMismatch` typedef (`fragListOwner: number`). Failing closed needs no core change and cannot regress the evidenced envelope (OQ-4: 0 tree-reachable N/U on all three Audubon models). OQ-4 §5 records both a numeric and a stricter count; this decision is the stricter reading. **Amendment 2026-10-07 (owner-authorized bounded D-V6 exception):** a tree-reachable population record with `cls === 'N'` **and** `nullGeometry === true` (SVF2/OTG fragment, geometry id 0, Viewer marks not-loaded) is informational — marked reachable, owner comparison skipped, still present in the population/root digests, planning proceeds (spec erratum A19). Every other tree-reachable `N` (real geometry id), `U` and out-of-range fragment still fails closed with `tree-reachable-fragment-unattributable`; no digest/schema/limit/Core change.
- **D-V7 — `EnumerationInconsistencyError` and `EnumerationBoundExceededError` (D-V9) are adapter-local** (`clashtest/viewer/errors.js`), not added to `clashtest/errors.js` (whose list is pinned to spec §18 by `test/clashtest/errors.test.mjs`). The planner maps any unrecognized throw to `enumeration-failed` by name (`engine.js:449-462`), which is exactly the spec's disposition for enumerator defects (§6.2 last paragraph).
- **D-V9 — OWNER-APPROVED: planning itself is BOUNDED before Core execution, using the existing collision limits (RESOLVED; supersedes the earlier "cap parity NOT mirrored" stance, which the owner reversed).** The adapter does not build an unbounded full-tree index and then rely on Core extraction limits afterward. The boundary is the collision library's own limits, read from `collision/constants.js` and **not changed** (no new public resource-limit policy, no Core change, no new per-unit durable gap representation): `maxFragmentsPerDbId` (5,000 per requested root, `extractFragments` tally semantics — the tally spans the root's whole subtree, rediscoveries count, checked after each node's own list and before its children), `maxChildrenPerNode` (10,000, callback aborts at limit + 1), and the whole-model population ceiling `maxCollisionInstancesPerEpoch` (20,000, compared to `fragList.getCount()` exactly as `extractAllFragments` does). **Crossing any of them fails planning deterministically** — `EnumerationBoundExceededError` (adapter-local, D-V7 style) for the first two, the library's `CapacityExceededError('whole-model-enumeration')` for the third — which the planner maps by name to `enumeration-failed`; exactly-at-limit succeeds. **Explicit scopes:** one ids-only parent pass (fanout-bounded) then bounded per-root walks (D-V4) — per-root fragment/children bounds are enforced *while* traversing and nothing beyond the limit is retained. **Whole-model scope, exact order:** (1) readiness; (2) bounded population/count validation first — the O(1) `getCount()` gate, *before any tree traversal*, then a ≤ 20,000-record scan (Task 5); (3) the retained whole-model index, built by ONE budgeted pass whose every allocation is charged to a limit before it is kept (per-node own list ≤ `maxFragmentsPerDbId`, running tree-reachable tally ≤ `maxCollisionInstancesPerEpoch`, fanout ≤ `maxChildrenPerNode`) and which aborts at the first excess (Task 4); (4) bounded per-root walks; (5) D-V6 reconciliation. **Callback mechanics:** `enumNodeChildren` honors abort (a truthy return; the library returns literal `true`, and dbId 0 is falsy, so a local flag records the excess — `docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md:3106-3111`); `enumNodeFragments` is **not** abortable (`review-comments-v17.md:29`), so the counting callback keeps counting but *stops recording* past the limit and the pass throws when the node's call returns — the retained data is bounded even though the Viewer's own burst is not preemptible. **No partial state survives a failed pass:** every index is a local variable, the enumerator holds no cache, and tests pin that a failed call is followed by a correct in-bounds call (Tasks 4, 7, 8). **Two-pass alternative considered and rejected:** a separate counting traversal followed by a second retained traversal doubles Viewer-callback cost and adds no bound the single budgeted pass lacks. **Recorded residual (not a new limit):** no existing limit bounds the *number of tree nodes*; the ids-only parent index / whole-model index and the per-root visited set are O(nodes), the same order as the Viewer's own resident tree — recorded under G-CAL for T3 to measure, and a node ceiling would be a new public limit that this milestone is not authorized to add. **Known consequence (owner-accepted):** a root over 5,000 fragments, a node over 10,000 children, or a population over 20,000 now fails the whole run at planning (`enumeration-failed`) instead of producing a per-unit `failed:extraction-limit` gap at execution.
- **D-V8 — Registry wiring is only the unload handler.** Registration stays a host call on `engine.registry.register(key, model, {modelVersion})` (interface-reconciliation S-P1-1); the adapter cannot bring its own registry (a foreign one throws `registry-mismatch`, `engine.js:499-509`). `modelKey`/`modelVersion` derivation is **not** provided (OQ-1 is a stated input, Gate G-VA-OQ1).

## Gates and inputs carried (recorded, not closed)

| Gate | Source | Disposition in this milestone |
|---|---|---|
| **G-VA-OQ4-ENV** | OQ-4 accepted PASS, envelope Audubon / SVF non-OTG / Viewer 7.124.2 / Chromium 151 | The adapter and README state this envelope verbatim and do **not** claim more. Non-evidenced (OQ-4 §7): OTG/SVF2, 2D, non-Revit, N/U or unreachable/mixed-owner **content**, PairId role-symmetry half of AC-15 (g), tree-unavailable failure path **live**, general readiness-gate sufficiency, cross-reload fragment identity. Every one is fail-closed in code (see D-V6, Task 8) and characterized — not asserted — by the T3 script. **Amendment 2026-10-07:** the tree-reachable null-geometry `N` (SVF2/OTG, geometry id 0) exception is informational, not fail-closed; all other N/U/out-of-range cases remain fail-closed. |
| **G-VA-READY** | OQ-4 §4(b)/§7, readiness-decision doc | Readiness gate recorded as an input to re-validate; T3 records the signal order per model; no sufficiency claim. |
| **G-VA-OQ1** | Spec §24 OQ-1 ("must be settled before integration acceptance"); master G-OQ1 wording differs ("blocks Viewer adapter, Panel wiring") | **Does not block planning** (readiness assessment F2). The adapter takes identity as host input. **Integration acceptance is blocked until OQ-1 has a written derivation + a test that a retranslation changes `modelVersion`.** Wording conflict (spec §24 vs master §4) is recorded here and left to the owner; not silently resolved. |
| **G-VA-OQ16 / OQ17** | §24 | Deferred; the adapter enables no qualified claim and no host acceptance. |
| **G-CAL / G-RESP** | §17 | `CHECK_EVERY = 64` per checkpoint and the responsiveness claim are characterization-only (T3 measures; nothing asserted). The engine's own checkpoint decides real yielding. **Also recorded for T3 (D-V9 residual): tree node count is bounded by no existing limit; the ids-only parent index and per-root visited sets are O(nodes) — T3 measures their size and time, nothing is capped or asserted.** |
| **G-EC** | READY:53 | No `clashtest/viewer` code reads `provenance.models[].elementCount` (asserted by a grep test in Task 1). |
| **G-VA-T3-EXEC** | Codex review I5; OQ-4 procedural precedent | Tasks 1–12 deliver *"implementation complete, live acceptance pending"*. The adapter is **not** described as production-ready until the Task 13 script has been **executed** live (credentials + Chromium, project owner or an explicitly delegated run accepted by the owner) and its result recorded under `docs/research/`. Execution is a separate owner authorization. **Pass criteria include Task 13 step (h) (real-event unload wiring).** |
| **LIVE_UNLOAD_INTEGRATION_UNVERIFIED** | Work-review Medium 3; OQ-4 §7 / `invariant-audit-v8-model.md:372` (BEFORE_MODEL_UNLOAD payload `[SILENT]`) | The production `wireModelUnload` has only offline (fake event target) proof after Tasks 1–12. Task 13 step (h) installs it on the **real** Viewer event and asserts unload → unregister-then-evict, replacement usable, late unload of the old model harmless, clean dispose. **This gate stays in force — and the adapter must NOT be called production-ready — until T3 has been executed with (h) passing; if (h) cannot be run deterministically in the accepted harness, the recorded result is exactly `LIVE_UNLOAD_INTEGRATION_UNVERIFIED` and the label remains "implementation complete, live acceptance pending".** Does not widen OQ-4 beyond Audubon / SVF / Viewer 7.124.2. |
| **G-VA-AC-COVERAGE** | AC-17 (d), AC-19 (b)/(d′)/(e) engine-level conjuncts | Out of scope; owner ruling needed (see disposition table). |
| **G-VA-P5** | P5 ordered-pair readers | Out of scope; owner authorization needed to reopen P5. |
| **G-VA-INTEG** | READY §6, handoff | Host integration, Panel, `server.js` static route for `/clashtest`, persistence: NOT authorized. T3 serves `/clashtest/**` via Playwright `page.route` from disk precisely to avoid touching `server.js`. |

## Review Focus

Input classes/failure modes the spec implies but no obvious task test would exercise; each has its pinning test in the task named:

1. **A fragment reachable under two different roots (shared fragId in disjoint subtrees)** must fail planning (`enumeration-failed`), never be double-counted or silently owned by whichever root came first — Task 7 (explicit) and Task 8 (whole).
2. **Tree-reachable fragment that is not-loaded / owner-unresolvable / outside `getCount()`** must fail closed (D-V6), never appear as a normal root member — Task 8. — **Amendment 2026-10-07:** except a tree-reachable null-geometry `N` (`nullGeometry === true`), which is informational and proceeds.
3. **The tree never becomes ready, or its `onError` fires, or the run is cancelled while waiting** must yield `ObjectTreeUnavailableError` / `EnumerationCancelledError` — never a partial list, never a hang — Task 3.
4. **Digest sensitivity and determinism:** a count-preserving geometry replacement, an owner change, and a loaded↔not-loaded flip must each change the digest; identical content re-read must give identical bytes; two calls must not share cached state — Tasks 5, 6, 9.
5. **Late unload of an OLD model after a reload under the same `modelKey`** must not kill the new binding; the handler must never throw even if the world is disposed or `evictModel`/`unregister` throw; a `BEFORE_MODEL_UNLOAD` event with no `model` must be a no-op — Task 11.
6. **Digest stability under render-proxy/readiness changes** (§1.3.6): the adapter reads no render-proxy state, so `digestScope` is invariant when `getRenderProxy` availability flips — Task 6.
7. **Hostile/edge inputs at the port:** `{dbIds}` unsorted / duplicated / containing unknown ids; a listed dbId whose subtree owns no fragments; a whole population above `maxCollisionInstancesPerEpoch` (20,000); a tree containing a cycle or a node reachable twice — Tasks 4, 5, 7.
8. **`digestScope` ≡ `resolveRoots` for the SAME raw scope, including unknown ids, no-fragment ids and ancestor/descendant lists** (the frozen conformance helper requires it; Codex review C1) — Tasks 6, 9.
9. **Liveness check and model read in the same tick** when `ctx.checkpoint()` returns `undefined`, and a fresh checkpoint before the read that follows a readiness wait (an unload may land during the wait) — Task 3 (and re-asserted in Task 6).
10. **Explicit scope containing a not-loaded fragment / non-integer geometry id:** resolves like `extractFragments` (D-V6 does not apply) or fails closed via the digest `TypeError` — never a silent wrong digest — Task 7.
11. **Registry from one world wired with `evictModel` of another** must be rejected at wiring time — Task 11.
12. **Bounded planning (D-V9):** a root over `maxFragmentsPerDbId`, a node over `maxChildrenPerNode`, a whole population / tree-reachable tally over `maxCollisionInstancesPerEpoch` each fail planning deterministically **before** the over-limit structure is retained (children callback aborts at limit + 1; population gate before any tree read); exactly-at-limit succeeds; a failed pass leaves no retained index or cache — Tasks 4, 6, 7, 8, 10.
13. **D-V6 owner-approved policy:** each of not-loaded / owner-unresolvable (undefined and array) / out-of-range tree-reachable fragments fails the WHOLE-model run (never a partial answer), deterministically, and at engine level seals a `failed` run with planning gap `enumeration-failed` and zero results — Tasks 8, 10; explicit scopes keep their declared boundary — Task 7. **Amendment 2026-10-07:** a tree-reachable `N` carrying `nullGeometry === true` (SVF2/OTG geometry id 0) is the one owner-authorized exception (informational; marked reachable, owner comparison skipped, digests unchanged); real-geometry `N`, `U` and out-of-range still fail.
14. **Unload wiring against the real Viewer event** (probe payload, unregister-before-evict, replacement survives a late unload of the old model, dispose) — Task 13 (h); offline proof alone is `LIVE_UNLOAD_INTEGRATION_UNVERIFIED`.

## Requirement → task coverage

| Requirement | Task(s) |
|---|---|
| §2.1 layering; §21.3 offline `npm test`; G-EC | 1 |
| §6.2 readiness; instance-tree-readiness-decision | 3 |
| §6.2 first-discovery-wins ownership; §5.6.2 roots; cycle/dup defect | 4 |
| §6.2.1 population classes N/U/L; §6.2.1 cost cap (`whole-model-enumeration`); D-V9 count gate before any tree read | 5, 8 |
| D-V9 bounded planning (`maxFragmentsPerDbId`, `maxChildrenPerNode`, population ceiling; explicit + whole-model; exact-at-limit; no retained state after failure) | 4, 6, 7, 8, 10 |
| §6.2.1 digests via the core's producers; §16.3 bracket use | 6 |
| §6.2 explicit scopes: `not-found`/`no-fragments`/no-listed-ancestor; §6.2 fragment-under-two-roots defect | 7 |
| §6.2 whole scope: `ownerMismatch`, `unreachable` (+`unattributable`); D-V6 (owner-approved fail-closed) | 8, 10 |
| §6.2.1 "Conformance" AC-2 differential; `checkEnumeratorConformance`; P3 "adapter content cases" | 9 |
| End-to-end through the real engine + real `CollisionWorld`; brute-force parity | 10 |
| §4.3 / §16.6 unload wiring (offline) | 11 |
| Unload wiring against the real Viewer `BEFORE_MODEL_UNLOAD_EVENT` (asserted in T3, gate `LIVE_UNLOAD_INTEGRATION_UNVERIFIED`) | 13 (h) |
| Entry point, README, offline suite gate | 12 |
| AC-15 (a)–(f) live (T3), AC-6 T3 reload arm, AC-12 characterization (authored, not run) | 13 |

## File structure

```text
clashtest/viewer/                       (NEW — the only production directory this milestone adds)
  index.js                              entry point: createViewerElementEnumerator, wireModelUnload
  errors.js                             EnumerationInconsistencyError, EnumerationBoundExceededError (adapter-local, D-V7/D-V9)
  checkpoint.js                         CHECK_EVERY, checkpointNow(ctx)
  readiness.js                          awaitObjectTree(model, ctx, opts) → instanceTree
  treeWalk.js                           indexNodeParents, indexInstanceTree (budgeted), walkSubtree (bounded), topmostFragmentOwningRoots, hasListedAncestor
  populationScan.js                     scanPopulation(fragList, ctx, {loadEpoch}) → {count, records}
  ViewerElementEnumerator.js            createViewerElementEnumerator(opts) → {resolveRoots, digestScope}
  unloadWiring.js                       wireModelUnload({world, registry, eventTarget, eventName, report})
  README.md                             contract, envelope, gates
test/clashtest/viewer/                  (NEW)
  support/layering.mjs, support/models.mjs
  layering.test.mjs, scaffold.test.mjs, mockRootId.test.mjs, readiness.test.mjs, treeWalk.test.mjs, populationScan.test.mjs,
  digestScope.test.mjs, resolveRoots.explicit.test.mjs, resolveRoots.whole.test.mjs,
  conformance.test.mjs, differential.test.mjs, engineIntegration.test.mjs, unloadWiring.test.mjs, entry.test.mjs
test/fixtures/mockInstanceTree.mjs      (MODIFIED, additive: instanceTree.getRootId())
test/acceptance/clashtest-viewer-adapter.acceptance.mjs   (NEW, T3, not run by npm test)
clashtest/README.md                     (MODIFIED: the one "Viewer adapter" row only)
docs/handoffs/latest.md                 (MODIFIED at milestone/plan completion per CLAUDE.md)
```

Shared vocabulary used by every task below: `ctx = { checkpoint(): void | Promise<void> }`; a *binding* is `{ modelKey, model, modelVersion, lease: { epoch }, bindingGeneration, placementGeneration }` (spec §4.3); `scope` is `'whole'` or `{ dbIds: number[] }`; `CHECK_EVERY = 64`.

---

### Task 1: Layering guard and scaffold checks (no production code)

**Files:**
- Create: `test/clashtest/viewer/support/layering.mjs`
- Create: `test/clashtest/viewer/layering.test.mjs`

**Interfaces:**
- Produces: `importSpecifiers(source): string[]`, `stripComments(source): string`, `violations(source): {imports: string[], globals: string[]}`, `ALLOWED_IMPORTS: RegExp[]`, `FORBIDDEN_GLOBALS: RegExp` — used only by this test and Task 12.

- [ ] **Step 1: Write the failing test**

```js
// test/clashtest/viewer/layering.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importSpecifiers, stripComments, violations } from './support/layering.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const walk = (dir) => (existsSync(dir) ? readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? walk(p) : [p];
}) : []);

test('checker: finds static, re-export, side-effect and dynamic specifiers', () => {
  const src = [
    "import a from './a.js';",
    "export { b } from '../planning/scopeDigest.js';",
    "import '../x.js';",
    "const m = await import('../../collision/index.js');",
  ].join('\n');
  assert.deepEqual(importSpecifiers(src).sort(),
    ['../../collision/index.js', '../planning/scopeDigest.js', '../x.js', './a.js']);
});

test('checker: ignores specifiers and globals inside comments and strings-in-comments', () => {
  const src = "// import x from '../identity/ModelRegistry.js'\n/* window Autodesk */ export const a = 1;";
  assert.deepEqual(violations(src), { imports: [], globals: [] });
});

test('checker: flags a forbidden import and every forbidden global (negative controls)', () => {
  const v = violations("import r from '../identity/ModelRegistry.js';\nconst v = window.Autodesk.Viewing;");
  assert.deepEqual(v.imports, ['../identity/ModelRegistry.js']);
  assert.ok(v.globals.includes('window') && v.globals.includes('Autodesk'));
  assert.deepEqual(violations("import q from '../../collision/CollisionWorld.js';").imports,
    ['../../collision/CollisionWorld.js']);
});

test('checker: allows exactly the permitted specifiers', () => {
  const ok = [
    "import a from './readiness.js';", "import b from '../planning/ElementEnumerator.js';",
    "import c from '../planning/scopeDigest.js';", "import d from '../util/slicer.js';",
    "import e from '../../collision/errors.js';", "import f from '../../collision/constants.js';",
    "import g from '../identity/ModelRegistry.js';",
  ].join('\n');
  assert.deepEqual(violations(ok), { imports: [], globals: [] });
});

test('real tree: every clashtest/viewer/*.js obeys the layering rules', () => {
  const files = walk(join(ROOT, 'clashtest', 'viewer')).filter((f) => f.endsWith('.js'));
  // With no production files yet this loop is vacuously true; presence of production modules is asserted by the
  // per-task scaffold test introduced in Task 3 (scaffold.test.mjs), not here.
  for (const f of files) {
    const v = violations(readFileSync(f, 'utf8'));
    assert.deepEqual(v, { imports: [], globals: [] }, relative(ROOT, f));
  }
});

test('real tree: nothing outside clashtest/viewer imports it; core never names the viewer layer', () => {
  const core = walk(join(ROOT, 'clashtest')).filter((f) => f.endsWith('.js')
    && !f.includes(`${sep}viewer${sep}`));
  for (const f of core) {
    const specs = importSpecifiers(stripComments(readFileSync(f, 'utf8')));
    assert.deepEqual(specs.filter((s) => /(^|\/)viewer(\/|$)/.test(s)), [], relative(ROOT, f));
  }
});

test('G-EC: no clashtest/viewer code reads provenance.models[].elementCount', () => {
  for (const f of walk(join(ROOT, 'clashtest', 'viewer')).filter((x) => x.endsWith('.js'))) {
    assert.ok(!/elementCount/.test(stripComments(readFileSync(f, 'utf8'))), relative(ROOT, f));
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/clashtest/viewer/layering.test.mjs`
Expected: FAIL — `Cannot find module './support/layering.mjs'`.

- [ ] **Step 3: Write the checker (support module)**

```js
// test/clashtest/viewer/support/layering.mjs
export const ALLOWED_IMPORTS = [
  /^\.\/[A-Za-z0-9_-]+\.js$/,
  /^\.\.\/planning\/(ElementEnumerator|scopeDigest)\.js$/,
  /^\.\.\/util\/slicer\.js$/,
  /^\.\.\/identity\/ModelRegistry\.js$/,                       // assertRegistryBelongsToWorld only (Task 11)
  /^\.\.\/\.\.\/collision\/(errors|constants)\.js$/,
];
export const FORBIDDEN_GLOBALS = [
  ['Autodesk', /\bAutodesk\b/], ['Viewing', /\bViewing\b/], ['window', /\bwindow\b/],
  ['document', /\bdocument\b/], ['globalThis.THREE', /\bglobalThis\.THREE\b/],
];

export function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
}

export function importSpecifiers(source) {
  const out = [];
  const patterns = [
    /(?:^|[\n;])\s*(?:import|export)\s[^'"`;]*?\sfrom\s*['"]([^'"]+)['"]/g, // import x from / export {..} from
    /(?:^|[\n;])\s*import\s*['"]([^'"]+)['"]/g,                                // import 'x'
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,                                       // import('x')
  ];
  for (const re of patterns) for (const m of source.matchAll(re)) out.push(m[1]);
  return [...new Set(out)];
}

export function violations(source) {
  const code = stripComments(source);
  return {
    imports: importSpecifiers(code).filter((s) => !ALLOWED_IMPORTS.some((re) => re.test(s))),
    globals: FORBIDDEN_GLOBALS.filter(([, re]) => re.test(code)).map(([name]) => name),
  };
}
```

- [ ] **Step 4: Run — all 7 tests pass; then the full-suite checkpoint gate**

Run: `node --test test/clashtest/viewer/layering.test.mjs`
Expected: all 7 tests PASS (4 checker tests + 3 real-tree tests: layering-obeyed, reverse guard, G-EC). The three real-tree tests are vacuous while `clashtest/viewer/` does not exist and become real as production modules land.

Checkpoint gate (Global Constraint 10): run `node scripts/run-tests.mjs` and expect green, 0 fail, 1 pre-existing todo, total = 2,848 + 7, BEFORE committing.

- [ ] **Step 5: Commit**

```bash
git add test/clashtest/viewer/support/layering.mjs test/clashtest/viewer/layering.test.mjs
git commit -m "test(viewer): layering guard for clashtest/viewer (imports, globals, reverse guard, G-EC)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Mock `getRootId` and single-rooted test-model builders

**Files:**
- Modify: `test/fixtures/mockInstanceTree.mjs` (add `getRootId` to the `instanceTree` object, inside `buildMockModel`; additive)
- Create: `test/clashtest/viewer/support/models.mjs`
- Create: `test/clashtest/viewer/mockRootId.test.mjs`

**Interfaces:**
- Produces: `rootedModel(children, options?) → { model, stats }` (tree = `[{dbId:1, children}]`, `model.id = options.id ?? 'm1'`, other `options` passed to `buildMockModel`); `bindingOf(modelKey, model, epoch = 1)`; `liveCtx() → { ctx, calls }` (`calls.n` counts checkpoints); `cancellingCtx(afterN) → ctx` (throws a real `EnumerationCancelledError` on the (afterN+1)-th checkpoint); `instanceTree.getRootId(): number`.

- [ ] **Step 1: Write the failing test**

```js
// test/clashtest/viewer/mockRootId.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMockModel } from '../../fixtures/mockInstanceTree.mjs';
import { rootedModel, bindingOf, liveCtx, cancellingCtx } from './support/models.mjs';

test('getRootId: a single-rooted mock tree reports its root dbId', () => {
  const { model } = rootedModel([{ dbId: 10, fragments: [0] }]);
  assert.equal(model.getObjectTree().getRootId(), 1);
});

test('getRootId: a multi-root mock tree refuses (no invented virtual root)', () => {
  const { model } = buildMockModel([{ dbId: 1 }, { dbId: 2 }], new Map());
  assert.throws(() => model.getObjectTree().getRootId(), /single-rooted/);
});

test('builders: bindingOf carries the model and an epoch; liveCtx counts checkpoints', async () => {
  const { model } = rootedModel([]);
  const b = bindingOf('k', model, 7);
  assert.equal(b.model, model); assert.equal(b.lease.epoch, 7); assert.equal(b.modelKey, 'k');
  const { ctx, calls } = liveCtx();
  await ctx.checkpoint(); await ctx.checkpoint();
  assert.equal(calls.n, 2);
});

test('builders: cancellingCtx throws EnumerationCancelledError after N checkpoints', async () => {
  const ctx = cancellingCtx(1);
  await ctx.checkpoint();
  assert.throws(() => ctx.checkpoint(), (e) => e.name === 'EnumerationCancelledError');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/clashtest/viewer/mockRootId.test.mjs`
Expected: FAIL — `Cannot find module './support/models.mjs'`.

- [ ] **Step 3: Implement**

In `test/fixtures/mockInstanceTree.mjs`, inside the `instanceTree` object literal (next to `isNodeHidden`), add:

```js
    // The real Viewer InstanceTree.getRootId(). The mock takes an array of root nodes, so it can answer
    // only when there is exactly one; a multi-root array has no honest single answer and must not get an
    // invented virtual root (whole-model root discovery in clashtest/viewer starts here).
    getRootId() {
      if (rootNodes.length !== 1) {
        throw new Error('mock getRootId requires a single-rooted tree (pass exactly one root node)');
      }
      return rootNodes[0].dbId;
    },
```

```js
// test/clashtest/viewer/support/models.mjs
import { buildMockModel } from '../../../fixtures/mockInstanceTree.mjs';
import { EnumerationCancelledError } from '../../../../clashtest/errors.js';

/** Single-rooted mock model: `children` hang under a non-fragment-owning root, dbId 1. */
export function rootedModel(children, options = {}) {
  const { id = 'm1', ...rest } = options;
  const { model, stats } = buildMockModel([{ dbId: 1, children }], new Map(), rest);
  return { model: { ...model, id }, stats };
}

export const bindingOf = (modelKey, model, epoch = 1) => ({
  modelKey, model, modelVersion: 'v1', lease: { epoch }, bindingGeneration: 1, placementGeneration: 0,
});

export function liveCtx() {
  const calls = { n: 0 };
  return { ctx: Object.freeze({ checkpoint() { calls.n += 1; } }), calls };
}

export function cancellingCtx(afterN) {
  let n = 0;
  return Object.freeze({
    checkpoint() {
      n += 1;
      if (n > afterN) throw new EnumerationCancelledError({ reason: 'cancelled' });
    },
  });
}
```

(`EnumerationCancelledError` takes a `{ reason }` object — verified against `clashtest/planning/ElementEnumerator.js`'s own conformance helper, which constructs `new EnumerationCancelledError({ reason: 'cancelled' })`.)

- [ ] **Step 4: Run to verify it passes, and that no existing mock consumer regressed**

Run: `node --test test/clashtest/viewer/mockRootId.test.mjs test/query test/ViewerModelAdapter.test.mjs test/clashtest/integration/realWorldEnvironment.test.mjs`
Expected: PASS. (If the `test/ViewerModelAdapter.test.mjs` path differs, run `node scripts/run-tests.mjs` instead and expect **2,848 + 7 (Task 1) + 4 (this task) = 2,859** total, 0 fail, 1 pre-existing todo.) Checkpoint gate (Global Constraint 10): the full `node scripts/run-tests.mjs` must be green (0 fail) before the commit.

- [ ] **Step 5: Commit**

```bash
git add test/fixtures/mockInstanceTree.mjs test/clashtest/viewer/support/models.mjs test/clashtest/viewer/mockRootId.test.mjs
git commit -m "test(viewer): additive mock getRootId + single-rooted model/binding/ctx builders

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Adapter errors, checkpoint helper, and the readiness gate

**Files:**
- Create: `clashtest/viewer/errors.js`, `clashtest/viewer/checkpoint.js`, `clashtest/viewer/readiness.js`
- Test: `test/clashtest/viewer/readiness.test.mjs`
- Create: `test/clashtest/viewer/scaffold.test.mjs`

**Interfaces:**
- Produces: `class EnumerationInconsistencyError extends Error { name='EnumerationInconsistencyError'; reason: string; detail: object }`; `CHECK_EVERY = 64`; `checkpointNow(ctx): void | Promise<void>` (**non-`async` passthrough**; call sites branch on the return — Global Constraint 5); `DEFAULT_READINESS_POLL_MS = 250`; `awaitObjectTree(model, ctx, { scheduleTimeout?, clearScheduled?, pollMs? }): Promise<{ tree: InstanceTree, fragList: FragmentList }>` — **both model handles are read in the same tick as the last liveness checkpoint** (Codex re-check C2: reading `model.getFragmentList()` in the caller after `await awaitObjectTree(...)` would reopen the microtask gap), so callers never touch the `model` object again after it returns.

**Call-site rule for every task below:** wherever this plan's code shows `{ const p = checkpointNow(ctx); if (p) await p; }` that is the required form; it is never `await checkpointNow(ctx)`.
- Consumes: `ObjectTreeUnavailableError(modelId, cause)` from `../../collision/errors.js`.

- [ ] **Step 1: Write the failing test**

```js
// test/clashtest/viewer/readiness.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { awaitObjectTree } from '../../../clashtest/viewer/readiness.js';
import { rootedModel, liveCtx, cancellingCtx } from './support/models.mjs';

const named = (e, name) => e && e.name === name;

test('ready fast path: returns the tree, calls no getObjectTree callback wait', async () => {
  const { model, stats } = rootedModel([{ dbId: 10, fragments: [0] }]);
  const { ctx, calls } = liveCtx();
  const { tree, fragList } = await awaitObjectTree(model, ctx);
  assert.equal(typeof tree.enumNodeChildren, 'function');
  assert.equal(typeof fragList.getCount, 'function');
  assert.equal(stats.getObjectTreeWithCallbacksCalls, 0);
  assert.ok(calls.n >= 1, 'a checkpoint runs BEFORE the model is read');
});

test('checkpoint runs before the first model read (liveness discipline)', async () => {
  const { model } = rootedModel([]);
  const order = [];
  const probe = { ...model, isObjectTreeCreated() { order.push('read'); return true; } };
  await awaitObjectTree(probe, { checkpoint() { order.push('cp'); } });
  assert.deepEqual(order.slice(0, 2), ['cp', 'read']);
});

test('not ready: waits for getObjectTree success, then returns the tree', async () => {
  let fire;
  const { model } = rootedModel([{ dbId: 10, fragments: [0] }], {
    objectTreeReady: false,
    settleObjectTree: (ok) => { fire = ok; },
  });
  const p = awaitObjectTree(model, liveCtx().ctx, { scheduleTimeout: () => 0, clearScheduled: () => {} });
  fire();
  const { tree } = await p;
  assert.equal(tree.getRootId(), 1);
});

test('getObjectTree onError => ObjectTreeUnavailableError carrying the Viewer cause', async () => {
  const cause = new Error('boom');
  const { model } = rootedModel([], { objectTreeReady: false, settleObjectTree: (_ok, err) => err(cause) });
  await assert.rejects(
    awaitObjectTree(model, liveCtx().ctx, { scheduleTimeout: () => 0, clearScheduled: () => {} }),
    (e) => named(e, 'ObjectTreeUnavailableError') && e.cause === cause);
});

test('ready-but-absent tree, and a model with no tree accessor, both fail (never a partial list)', async () => {
  const { model } = rootedModel([]);
  const noTree = { ...model, getObjectTree: () => null };
  await assert.rejects(awaitObjectTree(noTree, liveCtx().ctx), (e) => named(e, 'ObjectTreeUnavailableError'));
  const bare = { id: 'x', isObjectTreeCreated: () => false };
  await assert.rejects(awaitObjectTree(bare, liveCtx().ctx), (e) => named(e, 'ObjectTreeUnavailableError'));
  const notATree = { ...model, getObjectTree: () => ({}) };
  await assert.rejects(awaitObjectTree(notATree, liveCtx().ctx), (e) => named(e, 'ObjectTreeUnavailableError'));
});

test('cancellation while waiting is honored by polling ctx.checkpoint (no hang)', async () => {
  const { model } = rootedModel([], { objectTreeReady: false, settleObjectTree: () => {} }); // never settles
  const timers = [];
  const scheduleTimeout = (fn) => { timers.push(fn); return timers.length; };
  const p = awaitObjectTree(model, cancellingCtx(1), { scheduleTimeout, clearScheduled: () => {} });
  // first poll: checkpoint #2 throws
  while (timers.length === 0) await new Promise((r) => setImmediate(r));
  timers.shift()();
  await assert.rejects(p, (e) => named(e, 'EnumerationCancelledError'));
});

test('a synchronous checkpoint throw before any read propagates unwrapped', async () => {
  const { model } = rootedModel([]);
  await assert.rejects(awaitObjectTree(model, cancellingCtx(0)), (e) => named(e, 'EnumerationCancelledError'));
});

test('Review Focus 9 (C2): an undefined-returning checkpoint is followed by EVERY model read (readiness, tree, fragment list) IN THE SAME TICK', async () => {
  const { model } = rootedModel([{ dbId: 10, fragments: [0] }]);
  const order = [];
  queueMicrotask(() => order.push('microtask'));               // an unload could land here if a microtask boundary existed
  const probe = {
    ...model,
    isObjectTreeCreated() { order.push('ready?'); return true; },
    getObjectTree: (...a) => { order.push('tree'); return model.getObjectTree(...a); },
    getFragmentList: () => { order.push('frags'); return model.getFragmentList(); },
  };
  await awaitObjectTree(probe, { checkpoint() { order.push('cp'); } });        // checkpoint returns undefined synchronously
  assert.deepEqual(order.slice(0, 5), ['cp', 'ready?', 'tree', 'frags', 'microtask']);
});

test('Review Focus 9 (I1): a fresh checkpoint runs between readiness success and the final tree read', async () => {
  // readiness succeeds immediately; the run is cancelled at the SECOND checkpoint (entry = 1st, post-wait = 2nd)
  const { model } = rootedModel([], { objectTreeReady: false });      // default settle: onSuccess synchronously
  const reads = [];
  const probe = { ...model, getObjectTree: (ok, err) => { reads.push(ok ? 'wait' : 'final-read'); return model.getObjectTree(ok, err); } };
  await assert.rejects(
    awaitObjectTree(probe, cancellingCtx(1), { scheduleTimeout: () => 0, clearScheduled: () => {} }),
    (e) => named(e, 'EnumerationCancelledError'));
  assert.deepEqual(reads, ['wait']);                                  // the final no-arg getObjectTree() never ran
});
```

```js
// test/clashtest/viewer/scaffold.test.mjs
// Presence guard for the production modules that exist at each checkpoint. Each task that creates a module
// clashtest/viewer/<name>.js appends <name>.js to EXPECTED_MODULES in the SAME task (so this file is RED
// inside a task before the module exists and GREEN at that task's commit; it is never committed red).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('../../../clashtest/viewer/', import.meta.url));
const EXPECTED_MODULES = ['errors.js', 'checkpoint.js', 'readiness.js'];

test('scaffold: every production module created so far exists', () => {
  for (const name of EXPECTED_MODULES) assert.ok(existsSync(join(DIR, name)), `clashtest/viewer/${name} is missing`);
});
```

Tasks 4, 5, 6, 11 and 12 each append their new module file name (`treeWalk.js`, `populationScan.js`, `ViewerElementEnumerator.js`, `unloadWiring.js`, `index.js`) to `EXPECTED_MODULES` in the same task.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/clashtest/viewer/readiness.test.mjs test/clashtest/viewer/scaffold.test.mjs`
Expected: `readiness.test.mjs` FAIL — cannot find module `clashtest/viewer/readiness.js`; `scaffold.test.mjs` FAIL — `errors.js`, `checkpoint.js`, `readiness.js` missing.

- [ ] **Step 3: Implement**

```js
// clashtest/viewer/errors.js
// Adapter-local (D-V7): NOT added to clashtest/errors.js, whose list is pinned to spec 18. The planner maps
// any unrecognized enumerator throw to planning gap `enumeration-failed` by name (engine.js planningCauseOf),
// which is the spec 6.2 disposition for "an enumerator defect".
export class EnumerationInconsistencyError extends Error {
  constructor(reason, detail = {}) {
    super(`Viewer enumeration inconsistent: ${reason}`);
    this.name = 'EnumerationInconsistencyError';
    this.reason = reason;
    this.detail = detail;
  }
}
```

```js
// clashtest/viewer/checkpoint.js
// Same cadence convention as clashtest/planning/rootResolution.js (CHECK_EVERY = 64). Provisional (G-CAL).
export const CHECK_EVERY = 64;

/**
 * Conditionally-synchronous checkpoint (collision/scheduler.js convention). Deliberately NOT `async`: it returns
 * `undefined` synchronously on the not-due fast path and a Promise only when a yield is due, so a caller can
 * `const p = checkpointNow(ctx); if (p) await p;` and keep "checkpoint validated liveness" and the following model
 * read in the SAME tick (ViewerModelAdapter "Item D"). A bare `await checkpointNow(ctx)` is forbidden.
 */
export function checkpointNow(ctx) {
  const pending = ctx.checkpoint();
  return pending ? pending : undefined;
}
```

```js
// clashtest/viewer/readiness.js
// Mirrors CollisionWorld._awaitObjectTreeReady (docs/superpowers/specs/instance-tree-readiness-decision.md):
// `isObjectTreeCreated() === true` fast path, else model.getObjectTree(onSuccess, onError). Adds only
// (a) a ctx.checkpoint() BEFORE any model read and (b) a cancellation poll while waiting.
import { ObjectTreeUnavailableError } from '../../collision/errors.js';
import { checkpointNow } from './checkpoint.js';

export const DEFAULT_READINESS_POLL_MS = 250; // provisional (G-CAL), overridable

const modelIdOf = (model) => (model && model.id !== undefined ? model.id : model);
const isTree = (t) => t !== null && typeof t === 'object'
  && typeof t.getRootId === 'function' && typeof t.enumNodeChildren === 'function'
  && typeof t.enumNodeFragments === 'function';

function waitForTree(model, ctx, { scheduleTimeout, clearScheduled, pollMs }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearScheduled(timer);
      fn(value);
    };
    const poll = () => {
      timer = null;
      if (settled) return;
      let pending;
      try { pending = ctx.checkpoint(); } catch (e) { finish(reject, e); return; }
      Promise.resolve(pending).then(
        () => { if (!settled) timer = scheduleTimeout(poll, pollMs); },
        (e) => finish(reject, e),
      );
    };
    timer = scheduleTimeout(poll, pollMs);
    try {
      model.getObjectTree(
        () => finish(resolve),
        (err) => finish(reject, new ObjectTreeUnavailableError(modelIdOf(model), err)),
      );
    } catch (e) {
      finish(reject, new ObjectTreeUnavailableError(modelIdOf(model), e));
    }
  });
}

/**
 * Resolves to the model's instance tree once the Viewer reports it built; rejects with
 * ObjectTreeUnavailableError (never a partial result) when it cannot be, and with the ctx's own
 * EnumerationCancelledError when the run is cancelled while waiting.
 */
export async function awaitObjectTree(model, ctx, {
  scheduleTimeout = (fn, ms) => setTimeout(fn, ms), clearScheduled = (t) => clearTimeout(t), pollMs = DEFAULT_READINESS_POLL_MS,
} = {}) {
  { const p = checkpointNow(ctx); if (p) await p; } // liveness BEFORE the first model read, same tick when sync ("Item D")
  const ready = typeof model?.isObjectTreeCreated === 'function' && model.isObjectTreeCreated() === true;
  if (!ready) {
    if (typeof model?.getObjectTree !== 'function') {
      throw new ObjectTreeUnavailableError(modelIdOf(model), new Error('model exposes no object-tree accessor'));
    }
    await waitForTree(model, ctx, { scheduleTimeout, clearScheduled, pollMs });
    // The wait is an asynchronous boundary (an unload can land during it): re-validate liveness before the final read.
    { const p = checkpointNow(ctx); if (p) await p; }
  }
  const tree = model.getObjectTree();
  if (!isTree(tree)) {
    throw new ObjectTreeUnavailableError(modelIdOf(model), new Error('object tree absent or not an instance tree after readiness'));
  }
  const fragList = model.getFragmentList(); // SAME tick as the checkpoint above: no caller reads `model` after an await
  if (fragList === null || typeof fragList !== 'object' || typeof fragList.getCount !== 'function') {
    throw new ObjectTreeUnavailableError(modelIdOf(model), new Error('fragment list unavailable'));
  }
  return { tree, fragList };
}
```

- [ ] **Step 4: Run to verify it passes; full-suite checkpoint gate**

Run: `node --test test/clashtest/viewer/readiness.test.mjs test/clashtest/viewer/scaffold.test.mjs test/clashtest/viewer/layering.test.mjs`
Expected: all PASS (the Task 1 real-tree layering tests now exercise the real `errors.js`, `checkpoint.js`, `readiness.js` — they were vacuous before — and `scaffold.test.mjs` passes).

Checkpoint gate (Global Constraint 10): run `node scripts/run-tests.mjs` and expect green (0 fail) BEFORE committing.

- [ ] **Step 5: Commit**

```bash
git add clashtest/viewer/errors.js clashtest/viewer/checkpoint.js clashtest/viewer/readiness.js test/clashtest/viewer/readiness.test.mjs test/clashtest/viewer/scaffold.test.mjs
git commit -m "feat(viewer): object-tree readiness gate (fail-not-partial, cancellable wait) + adapter errors

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Bounded instance-tree walks (parent index, budgeted full index, subtree walk, whole-model roots)

**Files:**
- Create: `clashtest/viewer/treeWalk.js`
- Modify: `clashtest/viewer/errors.js` (add `EnumerationBoundExceededError`, D-V9); `test/clashtest/viewer/scaffold.test.mjs` (append `'treeWalk.js'` to `EXPECTED_MODULES`)
- Test: `test/clashtest/viewer/treeWalk.test.mjs`

**Interfaces:**
- Consumes: `checkpointNow`, `CHECK_EVERY`, `EnumerationInconsistencyError`; `maxChildrenPerNode` / `maxFragmentsPerDbId` / `maxCollisionInstancesPerEpoch` (`../../collision/constants.js`, **read, never changed**); `CapacityExceededError` (`../../collision/errors.js`).
- **Bounded-planning rule (D-V9, applies to every function below):** every structure that survives a call is charged to an EXISTING limit *before* it is retained; the pass aborts at the first exceeded bound and, because each index is a local variable, **a failed pass retains nothing** (no module-level state, no cache). The Viewer's own synchronous callback bursts are not preemptible (Global Constraint 5 exemption) but *recording* stops at the bound, so the retained amount stays bounded even though the burst is not.
- Produces:
  - `class EnumerationBoundExceededError extends Error { name = 'EnumerationBoundExceededError'; bound: 'maxFragmentsPerDbId' | 'maxChildrenPerNode'; detail: object }` in `errors.js` (adapter-local like D-V7; the planner maps any unrecognized throw to `enumeration-failed` by name, `engine.js` `planningCauseOf`).
  - `indexNodeParents(tree, ctx): Promise<{ rootId: number, parents: Map<number, number | null> }>` — the **explicit-scope** existence/ancestor index: node ids and parent ids only, **no `enumNodeFragments` call at all**; per-node fanout bounded by `maxChildrenPerNode` (the callback aborts at limit + 1, exactly like `extractFragments`); throws `EnumerationInconsistencyError('node-visited-twice' | 'root-id-invalid')` or `EnumerationBoundExceededError('maxChildrenPerNode')`.
  - `indexInstanceTree(tree, ctx, { loadEpoch }): Promise<{ rootId: number, nodes: Map<number, { parent: number | null, own: number[], children: number[] }> }>` — the **whole-model** index, budgeted: a node's own list ≤ `maxFragmentsPerDbId` (else `EnumerationBoundExceededError('maxFragmentsPerDbId')`); the running tree-reachable own-fragment tally ≤ `maxCollisionInstancesPerEpoch` (else `CapacityExceededError('whole-model-enumeration', { loadEpoch, requested, limit })` — the same class and kind the population gate uses; `requested` is the tally at the moment of the trip, a lower bound); fanout as above.
  - `walkSubtree(tree, rootDbId, ctx): Promise<Map<number /*fragId*/, number /*ownerDbId*/>>` — pre-order (own fragments, then children left→right), first-discovery-wins; **`extractFragments` tally semantics**: ONE tally per requested root across its whole subtree, every own-fragment callback counts (rediscovered fragments too), checked after each node's own list and **before that node's children are read**; above `maxFragmentsPerDbId` ⇒ `EnumerationBoundExceededError('maxFragmentsPerDbId')`; exactly the limit succeeds.
  - `topmostFragmentOwningRoots(index, ctx): Promise<number[]>` — ascending; the first node on each root→leaf path that owns ≥ 1 direct fragment (over an `indexInstanceTree` index).
  - `hasListedAncestor(index, dbId, listedSet): boolean` — over an `indexNodeParents` index.
- **Residual, stated not hidden (G-CAL):** no existing limit bounds the *number of nodes* (fragment-less nodes). The parent index retains one `Map` entry (two numbers) per node and `walkSubtree`'s visited set one number per subtree node — the same order as the Viewer's own resident tree — and adding a node ceiling would be a new public limit (not authorized). Both are recorded for T3 to measure; nothing else the adapter allocates is unbounded.

- [ ] **Step 1: Write the failing test**

```js
// test/clashtest/viewer/treeWalk.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexNodeParents, indexInstanceTree, walkSubtree, topmostFragmentOwningRoots, hasListedAncestor }
  from '../../../clashtest/viewer/treeWalk.js';
import { rootedModel, liveCtx, cancellingCtx } from './support/models.mjs';

const treeOf = (children, opts) => rootedModel(children, opts).model.getObjectTree();
const range = (from, to) => Array.from({ length: to - from }, (_, i) => from + i);
const kids = (n) => Array.from({ length: n }, (_, i) => ({ dbId: 1000 + i }));
const isBound = (bound) => (e) => e.name === 'EnumerationBoundExceededError' && e.bound === bound;
const SAMPLE = [
  { dbId: 10, fragments: [0, 1], children: [{ dbId: 11, fragments: [2] }] },      // owner 10 with owning descendant
  { dbId: 20, children: [{ dbId: 21, fragments: [3] }, { dbId: 22, fragments: [4] }] }, // non-owning 20 -> two roots
  { dbId: 30 },                                                                    // no fragments anywhere
];

test('indexInstanceTree: nodes, parents, own fragments, children in original order', async () => {
  const idx = await indexInstanceTree(treeOf(SAMPLE), liveCtx().ctx, { loadEpoch: 1 });
  assert.equal(idx.rootId, 1);
  assert.deepEqual(idx.nodes.get(10), { parent: 1, own: [0, 1], children: [11] });
  assert.deepEqual(idx.nodes.get(20).children, [21, 22]);
  assert.equal(idx.nodes.get(1).parent, null);
  assert.equal(idx.nodes.size, 7);                                                  // 1, 10, 11, 20, 21, 22, 30
});

test('indexNodeParents: ids and parents only, and it never asks the Viewer for a fragment', async () => {
  const { model, stats } = rootedModel(SAMPLE);
  const idx = await indexNodeParents(model.getObjectTree(), liveCtx().ctx);
  assert.equal(idx.rootId, 1);
  assert.equal(idx.parents.get(1), null); assert.equal(idx.parents.get(11), 10); assert.equal(idx.parents.size, 7);
  assert.equal(stats.enumNodeFragmentsCalls, 0);
  assert.equal(stats.getChildCountCalls, 0);
});

test('walkSubtree: pre-order own-first, first-discovery-wins owner, discovery order', async () => {
  const shared = [{ dbId: 10, fragments: [0, 1], children: [{ dbId: 11, fragments: [1, 2] }] }];
  const owners = await walkSubtree(treeOf(shared), 10, liveCtx().ctx);
  assert.deepEqual([...owners], [[0, 10], [1, 10], [2, 11]]);   // fragment 1 stays owned by 10
});

test('walkSubtree on a leaf-less/unknown node returns an empty map', async () => {
  assert.equal((await walkSubtree(treeOf(SAMPLE), 30, liveCtx().ctx)).size, 0);
  assert.equal((await walkSubtree(treeOf(SAMPLE), 999, liveCtx().ctx)).size, 0);
});

test('topmostFragmentOwningRoots: stops at the first owning node; descends through non-owning nodes', async () => {
  const idx = await indexInstanceTree(treeOf(SAMPLE), liveCtx().ctx, { loadEpoch: 1 });
  assert.deepEqual(await topmostFragmentOwningRoots(idx, liveCtx().ctx), [10, 21, 22]); // 11 is inside root 10
});

test('hasListedAncestor: climbs parents, excludes self', async () => {
  const idx = await indexNodeParents(treeOf(SAMPLE), liveCtx().ctx);
  assert.equal(hasListedAncestor(idx, 11, new Set([10, 11])), true);
  assert.equal(hasListedAncestor(idx, 10, new Set([10, 11])), false);
  assert.equal(hasListedAncestor(idx, 21, new Set([10, 21])), false);
});

test('a node reachable twice (DAG) or a cycle is an enumerator defect, never an infinite loop', async () => {
  const dag = [{ dbId: 10, children: [{ dbId: 12, fragments: [0] }] }, { dbId: 11, children: [{ dbId: 12, fragments: [0] }] }];
  for (const index of [(t) => indexNodeParents(t, liveCtx().ctx), (t) => indexInstanceTree(t, liveCtx().ctx, { loadEpoch: 1 })]) {
    await assert.rejects(index(treeOf(dag)),
      (e) => e.name === 'EnumerationInconsistencyError' && e.reason === 'node-visited-twice');
  }
  const { model } = rootedModel([{ dbId: 10 }]);
  const tree = model.getObjectTree();
  const cyclic = { ...tree, enumNodeChildren: (id, cb) => { cb(1); } }; // every node's child is the root
  await assert.rejects(walkSubtree(cyclic, 1, liveCtx().ctx), (e) => e.reason === 'node-visited-twice');
});

test('a non-numeric root id fails closed', async () => {
  const tree = { ...treeOf([]), getRootId: () => undefined };
  await assert.rejects(indexNodeParents(tree, liveCtx().ctx), (e) => e.reason === 'root-id-invalid');
  await assert.rejects(indexInstanceTree(tree, liveCtx().ctx, {}), (e) => e.reason === 'root-id-invalid');
});

test('checkpoints: at least one per 64 nodes, cancellation propagates unwrapped, getChildCount is never called', async () => {
  const many = Array.from({ length: 200 }, (_, i) => ({ dbId: 100 + i, fragments: [i] }));
  const { model, stats } = rootedModel(many);
  for (const index of [(t, c) => indexNodeParents(t, c), (t, c) => indexInstanceTree(t, c, { loadEpoch: 1 })]) {
    const { ctx, calls } = liveCtx();
    await index(model.getObjectTree(), ctx);
    assert.ok(calls.n >= 3, `201 nodes => >= 3 checkpoints (got ${calls.n})`);
    await assert.rejects(index(model.getObjectTree(), cancellingCtx(1)), (e) => e.name === 'EnumerationCancelledError');
  }
  assert.equal(stats.getChildCountCalls, 0);
});

// ---- D-V9: bounded planning (RED first: no bound exists until the code below is written) ----

test('D-V9 fanout: a node with MORE than maxChildrenPerNode children (10,002) aborts at exactly limit + 1 callbacks (all three passes)', async () => {
  for (const [run, expectedCallbacks] of [
    [(t) => indexNodeParents(t, liveCtx().ctx), 10_002],                       // root's 1 child + 10,001 at node 10
    [(t) => indexInstanceTree(t, liveCtx().ctx, { loadEpoch: 1 }), 10_002],
    [(t) => walkSubtree(t, 10, liveCtx().ctx), 10_001],
  ]) {
    const { model, stats } = rootedModel([{ dbId: 10, children: kids(10_002) }]);   // limit + 2: an abort and a natural end differ
    await assert.rejects(run(model.getObjectTree()), isBound('maxChildrenPerNode'));
    assert.equal(stats.enumNodeChildrenCallbacks, expectedCallbacks);          // aborted at limit + 1; ignoring `return true` would yield one more callback than expected
  }
});

test('D-V9 fanout: exactly maxChildrenPerNode children succeeds', async () => {
  const { model } = rootedModel([{ dbId: 10, children: kids(10_000) }]);
  const idx = await indexNodeParents(model.getObjectTree(), liveCtx().ctx);
  assert.equal(idx.parents.size, 10_002);                                      // root, 10, and the 10,000 children
  assert.equal((await walkSubtree(model.getObjectTree(), 10, liveCtx().ctx)).size, 0);
});

test('D-V9 subtree tally: 5,001 own-fragment callbacks in one root subtree throw BEFORE the over-limit node\'s children are read', async () => {
  const over = rootedModel([{ dbId: 10, fragments: range(0, 2_500), children: [
    { dbId: 11, fragments: range(2_500, 5_001), children: [{ dbId: 12, fragments: [9_999] }] }] }]);
  await assert.rejects(walkSubtree(over.model.getObjectTree(), 10, liveCtx().ctx), isBound('maxFragmentsPerDbId'));
  assert.equal(over.stats.enumNodeChildrenCalls, 1);                           // node 10's children were read; node 11's were not
});

test('D-V9 subtree tally: exactly maxFragmentsPerDbId (5,000) succeeds', async () => {
  const ok = rootedModel([{ dbId: 10, fragments: range(0, 2_500), children: [{ dbId: 11, fragments: range(2_500, 5_000) }] }]);
  assert.equal((await walkSubtree(ok.model.getObjectTree(), 10, liveCtx().ctx)).size, 5_000);
});

test('D-V9 subtree tally: rediscovered fragments count (library semantics), so 3,000 + 3,000 duplicates is over the limit', async () => {
  const { model } = rootedModel([{ dbId: 10, fragments: range(0, 3_000), children: [{ dbId: 11, fragments: range(0, 3_000) }] }]);
  await assert.rejects(walkSubtree(model.getObjectTree(), 10, liveCtx().ctx), isBound('maxFragmentsPerDbId'));
});

test('D-V9 whole index: a node listing 5,001 own fragments is refused (the Viewer call is not abortable, recording stops at the limit); exactly 5,000 succeeds', async () => {
  const over = rootedModel([{ dbId: 10, fragments: range(0, 5_001) }]);
  await assert.rejects(indexInstanceTree(over.model.getObjectTree(), liveCtx().ctx, { loadEpoch: 1 }), isBound('maxFragmentsPerDbId'));
  assert.equal(over.stats.enumNodeFragmentsCallbacks, 5_001);                  // the burst ran to its end; nothing beyond the limit was kept
  const ok = await indexInstanceTree(treeOf([{ dbId: 10, fragments: range(0, 5_000) }]), liveCtx().ctx, { loadEpoch: 1 });
  assert.equal(ok.nodes.get(10).own.length, 5_000);
});

test('D-V9 whole index: tree-reachable tally above maxCollisionInstancesPerEpoch (20,000) trips CapacityExceededError; exactly 20,000 succeeds', async () => {
  const five = (perNode) => Array.from({ length: 5 }, (_, i) => ({ dbId: 10 + i, fragments: range(0, perNode) })); // ids rediscovered
  await assert.rejects(indexInstanceTree(treeOf(five(4_001)), liveCtx().ctx, { loadEpoch: 7 }),
    (e) => e.name === 'CapacityExceededError');
  const ok = await indexInstanceTree(treeOf(five(4_000)), liveCtx().ctx, { loadEpoch: 7 });
  assert.equal(ok.nodes.size, 6);
});

test('D-V9: a failed pass hands back nothing and leaves nothing behind (a following in-bounds pass equals a never-failed one)', async () => {
  const bad = rootedModel([{ dbId: 10, children: kids(10_002) }]).model.getObjectTree();
  await assert.rejects(indexNodeParents(bad, liveCtx().ctx), isBound('maxChildrenPerNode'));
  const good = () => treeOf(SAMPLE);
  assert.deepEqual([...(await indexNodeParents(good(), liveCtx().ctx)).parents],
    [...(await indexNodeParents(good(), liveCtx().ctx)).parents]);
});
```

- [ ] **Step 2: Run to verify it fails** — `node --test test/clashtest/viewer/treeWalk.test.mjs test/clashtest/viewer/scaffold.test.mjs` → FAIL (module not found; `treeWalk.js` missing from the scaffold list once appended).

- [ ] **Step 3: Implement**

Add to `clashtest/viewer/errors.js` (next to `EnumerationInconsistencyError`):

```js
// D-V9: a planning traversal crossed an EXISTING collision extraction limit (never a new one). Adapter-local
// like D-V7; the planner maps any unrecognized throw to `enumeration-failed` by name (engine.js planningCauseOf).
export class EnumerationBoundExceededError extends Error {
  constructor(bound, detail = {}) {
    super(`Viewer enumeration exceeds ${bound}`);
    this.name = 'EnumerationBoundExceededError';
    this.bound = bound;      // 'maxFragmentsPerDbId' | 'maxChildrenPerNode'
    this.detail = detail;
  }
}
```

```js
// clashtest/viewer/treeWalk.js
// Instance-tree traversal for the ElementEnumerator (spec 6.2, 5.6.2). Iterative (no JS recursion) so a
// checkpoint can be awaited between node visits. Uses ONLY getRootId / enumNodeChildren / enumNodeFragments,
// always non-recursive (recursive=false) and never getChildCount (D-V4, Global Constraint 4). BOUNDED (D-V9):
// the limits are the collision library's own, read from collision/constants.js and never changed.
import { maxChildrenPerNode, maxFragmentsPerDbId, maxCollisionInstancesPerEpoch } from '../../collision/constants.js';
import { CapacityExceededError } from '../../collision/errors.js';
import { EnumerationInconsistencyError, EnumerationBoundExceededError } from './errors.js';
import { CHECK_EVERY, checkpointNow } from './checkpoint.js';

const isDbId = (n) => Number.isSafeInteger(n) && n >= 0;
const ascending = (a, b) => a - b;

/** One node's children, fanout-bounded exactly like extractFragments: abort at limit + 1 callbacks; a LOCAL flag (dbId 0 is falsy). */
function boundedChildren(tree, id, root) {
  const out = [];
  let count = 0;
  let exceeded = false;
  tree.enumNodeChildren(id, (c) => {
    count += 1;
    if (count > maxChildrenPerNode) { exceeded = true; return true; }
    out.push(c);
    return false;
  }, false);
  if (exceeded) throw new EnumerationBoundExceededError('maxChildrenPerNode', { dbId: id, root, count });
  return out;
}

/** One node's own fragments. The Viewer call is not abortable; RECORDING stops at `room`, so retention stays bounded. */
function boundedOwn(tree, id, room) {
  const own = [];
  let tally = 0;
  tree.enumNodeFragments(id, (f) => { tally += 1; if (tally <= room) own.push(f); }, false);
  return { own, tally };
}

/** Explicit-scope existence/ancestor index: ids and parents only; no fragment is ever requested. */
export async function indexNodeParents(tree, ctx) {
  const rootId = tree.getRootId();
  if (!isDbId(rootId)) throw new EnumerationInconsistencyError('root-id-invalid', { rootId });
  const parents = new Map();
  const stack = [{ id: rootId, parent: null }];
  let visited = 0;
  while (stack.length > 0) {
    const { id, parent } = stack.pop();
    if (parents.has(id)) throw new EnumerationInconsistencyError('node-visited-twice', { dbId: id });
    parents.set(id, parent);
    const children = boundedChildren(tree, id, null);
    for (let i = children.length - 1; i >= 0; i--) stack.push({ id: children[i], parent: id });
    if (++visited % CHECK_EVERY === 0) { const p = checkpointNow(ctx); if (p) await p; }
  }
  return { rootId, parents };
}

/** Whole-model index, budgeted: every fragment and child list is charged to an existing limit BEFORE it is retained. */
export async function indexInstanceTree(tree, ctx, { loadEpoch } = {}) {
  const rootId = tree.getRootId();
  if (!isDbId(rootId)) throw new EnumerationInconsistencyError('root-id-invalid', { rootId });
  const nodes = new Map();
  const stack = [{ id: rootId, parent: null }];
  let visited = 0;
  let reachable = 0;                                  // tree-reachable own-fragment callbacks so far (rediscoveries count)
  while (stack.length > 0) {
    const { id, parent } = stack.pop();
    if (nodes.has(id)) throw new EnumerationInconsistencyError('node-visited-twice', { dbId: id });
    const { own, tally } = boundedOwn(tree, id, maxFragmentsPerDbId);
    if (tally > maxFragmentsPerDbId) throw new EnumerationBoundExceededError('maxFragmentsPerDbId', { dbId: id, tally });
    reachable += tally;
    if (reachable > maxCollisionInstancesPerEpoch) {
      throw new CapacityExceededError('whole-model-enumeration', { loadEpoch, requested: reachable, limit: maxCollisionInstancesPerEpoch });
    }
    const children = boundedChildren(tree, id, null);
    nodes.set(id, { parent, own, children });
    for (let i = children.length - 1; i >= 0; i--) stack.push({ id: children[i], parent: id });
    if (++visited % CHECK_EVERY === 0) { const p = checkpointNow(ctx); if (p) await p; }
  }
  return { rootId, nodes };
}

/** The extractFragments rule: pre-order (own fragments, then children L->R), first discovery wins; ONE tally per requested root. */
export async function walkSubtree(tree, rootDbId, ctx) {
  const owners = new Map();
  const seen = new Set();
  const stack = [rootDbId];
  let tally = 0;
  let visited = 0;
  while (stack.length > 0) {
    const node = stack.pop();
    if (seen.has(node)) throw new EnumerationInconsistencyError('node-visited-twice', { dbId: node, root: rootDbId });
    seen.add(node);
    tree.enumNodeFragments(node, (f) => {
      tally += 1;                                     // library semantics: rediscovered fragments count too
      if (tally <= maxFragmentsPerDbId && !owners.has(f)) owners.set(f, node);   // stop recording past the limit
    }, false);
    if (tally > maxFragmentsPerDbId) {                // checked BEFORE this node's children are read (as extractFragments does)
      throw new EnumerationBoundExceededError('maxFragmentsPerDbId', { root: rootDbId, dbId: node, tally });
    }
    const children = boundedChildren(tree, node, rootDbId);
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
    if (++visited % CHECK_EVERY === 0) { const p = checkpointNow(ctx); if (p) await p; }
  }
  return owners;
}

/** Spec 5.6.2 / OQ-4 probe step 3: the first node on each path from the tree root that itself owns fragments. */
export async function topmostFragmentOwningRoots(index, ctx) {
  const roots = [];
  const stack = [index.rootId];
  let visited = 0;
  while (stack.length > 0) {
    const id = stack.pop();
    const node = index.nodes.get(id);
    if (node.own.length > 0) roots.push(id);
    else for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]);
    if (++visited % CHECK_EVERY === 0) { const p = checkpointNow(ctx); if (p) await p; }
  }
  return roots.sort(ascending);
}

export function hasListedAncestor(index, dbId, listedSet) {
  let p = index.parents.get(dbId) ?? null;
  while (p !== null) {
    if (listedSet.has(p)) return true;
    p = index.parents.get(p) ?? null;
  }
  return false;
}
```

- [ ] **Step 4: Run** — `node --test test/clashtest/viewer/treeWalk.test.mjs test/clashtest/viewer/scaffold.test.mjs test/clashtest/viewer/layering.test.mjs` → PASS, then the full `node scripts/run-tests.mjs` → green (checkpoint gate) before committing.
- [ ] **Step 5: Commit** — `git add clashtest/viewer/treeWalk.js clashtest/viewer/errors.js test/clashtest/viewer/treeWalk.test.mjs test/clashtest/viewer/scaffold.test.mjs && git commit -m "feat(viewer): bounded instance-tree walks (parent index, budgeted full index, subtree walk)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"`

---

### Task 5: Population scan (spec §6.2.1 classes N / U / L)

**Files:**
- Create: `clashtest/viewer/populationScan.js`
- Modify: `test/clashtest/viewer/scaffold.test.mjs` (append `'populationScan.js'` to `EXPECTED_MODULES`)
- Test: `test/clashtest/viewer/populationScan.test.mjs`

**Interfaces:**
- Consumes: `maxCollisionInstancesPerEpoch` (`../../collision/constants.js`), `CapacityExceededError` (`../../collision/errors.js`; construct as `new CapacityExceededError('whole-model-enumeration', { loadEpoch, requested, limit })` — verify the constructor against `collision/errors.js:114` before writing), `checkpointNow`, `CHECK_EVERY`, `EnumerationInconsistencyError`.
- Produces: `scanPopulation(fragList, ctx, { loadEpoch }): Promise<{ count: number, records: Array<{fragId, cls:'N'|'U'} | {fragId, cls:'L', ownerDbId, geometryId}> }>` where `records[fragId]` is the record of that fragId (dense, index = fragId).
- **D-V9 role:** this is the whole-model **bounded population/count validation that runs BEFORE any tree traversal or retained index** (Task 8 calls it first): `fragList.getCount()` is an O(1) read, and the ceiling (`maxCollisionInstancesPerEpoch`) is enforced against it before a single fragment record is read or allocated, so the retained `records` array is bounded by 20,000 by construction. The tests below pin exact-at-limit (20,000 succeeds), over-limit (20,001 refused with no fragment read) and the invalid-count defect.

- [ ] **Step 1: Write the failing test**

```js
// test/clashtest/viewer/populationScan.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanPopulation } from '../../../clashtest/viewer/populationScan.js';
import { rootedModel, liveCtx } from './support/models.mjs';

const fragListOf = (children, opts) => rootedModel(children, opts).model.getFragmentList();
const scan = (children, opts, ctx = liveCtx().ctx) => scanPopulation(fragListOf(children, opts), ctx, { loadEpoch: 1 });

test('classes: loaded L(owner, geometryId), not-loaded N, owner-unresolvable U (undefined and array)', async () => {
  const { count, records } = await scan(
    [{ dbId: 10, fragments: [0, 1, 2, 3] }],
    { notLoadedFragIds: [1], ownerDbIdOverrides: new Map([[2, undefined], [3, [10, 11]]]), fragmentCount: 5 });
  assert.equal(count, 5);
  assert.deepEqual(records[0], { fragId: 0, cls: 'L', ownerDbId: 10, geometryId: 0 });
  assert.deepEqual(records[1], { fragId: 1, cls: 'N' });
  assert.deepEqual(records[2], { fragId: 2, cls: 'U' });
  assert.deepEqual(records[3], { fragId: 3, cls: 'U' });
  assert.deepEqual(records[4], { fragId: 4, cls: 'U' });          // in range, claimed by nothing
  assert.equal(records.length, 5);
});

test('not-loaded wins over any owner (checked before the owner lookup, as the library does)', async () => {
  const { model, stats } = rootedModel([{ dbId: 10, fragments: [0] }], { notLoadedFragIds: [0] });
  await scanPopulation(model.getFragmentList(), liveCtx().ctx, { loadEpoch: 1 });
  assert.equal(stats.getDbIdsCalls, 0);   // the mock counts getDbIds calls; an N fragment's owner is never read
});

test('a non-number, non-undefined, non-array owner fails closed', async () => {
  await assert.rejects(scan([{ dbId: 10, fragments: [0] }], { ownerDbIdOverrides: new Map([[0, null]]) }),
    (e) => e.name === 'EnumerationInconsistencyError' && e.reason === 'owner-not-a-number');
});

test('population above maxCollisionInstancesPerEpoch (20,000) is refused before any fragment is read', async () => {
  const { model, stats } = rootedModel([{ dbId: 10, fragments: [0] }], { fragmentCount: 20_001 });
  await assert.rejects(scanPopulation(model.getFragmentList(), liveCtx().ctx, { loadEpoch: 9 }),
    (e) => e.name === 'CapacityExceededError');
  assert.equal(stats.isNotLoadedCalls, 0);
  const ok = await scan([{ dbId: 10, fragments: [0] }], { fragmentCount: 20_000 });
  assert.equal(ok.count, 20_000);
});

test('an invalid count is an enumerator defect', async () => {
  const fl = { ...fragListOf([]), getCount: () => -1 };
  await assert.rejects(scanPopulation(fl, liveCtx().ctx, {}), (e) => e.reason === 'fragment-count-invalid');
});

test('checkpoints at least once per 64 fragments', async () => {
  const { ctx, calls } = liveCtx();
  await scan([{ dbId: 10, fragments: [0] }], { fragmentCount: 200 }, ctx);
  assert.ok(calls.n >= 3);
});
```

- [ ] **Step 2: Run** — `node --test test/clashtest/viewer/populationScan.test.mjs` → FAIL (module not found).

- [ ] **Step 3: Implement**

```js
// clashtest/viewer/populationScan.js
// The population `extractAllFragments` enumerates, INCLUDING its two dropped classes (spec 6.2.1, F17):
// N = fragList.isNotLoaded (checked BEFORE the owner lookup), U = getDbIds undefined or an array,
// L = loaded with a numeric owner and a geometry id. Dense: records[fragId] for every fragId in 0..count-1.
import { maxCollisionInstancesPerEpoch } from '../../collision/constants.js';
import { CapacityExceededError } from '../../collision/errors.js';
import { EnumerationInconsistencyError } from './errors.js';
import { CHECK_EVERY, checkpointNow } from './checkpoint.js';

export async function scanPopulation(fragList, ctx, { loadEpoch } = {}) {
  const count = fragList.getCount();
  if (!Number.isSafeInteger(count) || count < 0) throw new EnumerationInconsistencyError('fragment-count-invalid', { count });
  // spec 6.2.1 "Cost": above the library's own per-epoch ceiling enumeration fails, matching `whole-model-enumeration`.
  if (count > maxCollisionInstancesPerEpoch) {
    throw new CapacityExceededError('whole-model-enumeration', { loadEpoch, requested: count, limit: maxCollisionInstancesPerEpoch });
  }
  const records = new Array(count);
  for (let fragId = 0; fragId < count; fragId++) {
    if (fragList.isNotLoaded(fragId)) {
      records[fragId] = { fragId, cls: 'N' };
    } else {
      const owner = fragList.getDbIds(fragId);
      if (owner === undefined || Array.isArray(owner)) records[fragId] = { fragId, cls: 'U' };
      else if (typeof owner !== 'number') throw new EnumerationInconsistencyError('owner-not-a-number', { fragId, type: typeof owner });
      else records[fragId] = { fragId, cls: 'L', ownerDbId: owner, geometryId: fragList.getGeometryId(fragId) };
    }
    if ((fragId + 1) % CHECK_EVERY === 0) { const p = checkpointNow(ctx); if (p) await p; }
  }
  return { count, records };
}
```

- [ ] **Step 4: Run** — populationScan + scaffold + layering tests → PASS, then full `node scripts/run-tests.mjs` → green (checkpoint gate).
- [ ] **Step 5: Commit** — `feat(viewer): population scan (N/U/L classes, 20k cap)`.

---

### Task 6: `digestScope` (both scopes) and digest sensitivity

**Files:**
- Create: `clashtest/viewer/ViewerElementEnumerator.js` (initial: `digestScope` + shared helpers; `resolveRoots` is added in Tasks 7–8)
- Modify: `test/clashtest/viewer/scaffold.test.mjs` (append `'ViewerElementEnumerator.js'` to `EXPECTED_MODULES`)
- Test: `test/clashtest/viewer/digestScope.test.mjs`

**Interfaces:**
- Consumes: `digestPopulation`, `digestSubtree` (`../planning/scopeDigest.js`), `createSlicer` (`../util/slicer.js`), `awaitObjectTree`, `indexNodeParents`, `walkSubtree`, `hasListedAncestor` (Task 4, bounded), `scanPopulation` (Task 5, count-gated), `checkpointNow`, `CHECK_EVERY`.
- Produces: `createViewerElementEnumerator({ scheduleTimeout?, clearScheduled?, readinessPollMs? }) → Object.freeze({ resolveRoots, digestScope })`; internal helpers `digestSlicer(ctx)`, `subtreeRecords(owners, fragList, ctx)`, `rootRecord(dbId, owners, fragList, ctx)`, `claimFragments(claimed, owners, rootDbId)`.
  - `digestScope(binding, 'whole', ctx) → { kind:'population', count, digest }` — population only; **does not require or wait for the tree**; the population is count-gated before any record is read (Task 5, D-V9).
  - `digestScope(binding, { dbIds }, ctx) → { kind:'roots', roots:[{dbId, fragmentCount, subtreeDigest}] }` — **the same normalization as `resolveRoots` (D-V4, Codex review C1):** only ids that exist, own ≥ 1 fragment, and have no *other listed id* as an ancestor, ascending; all others are simply absent (drift is then visible as a root-count mismatch in `compareScopeExpectation`). **Mechanics (D-V4/D-V9, exactly):** `normalizeExplicit` runs ONE bounded parent-index pass over the tree (`indexNodeParents`: node ids and parents only, per-node fanout ≤ `maxChildrenPerNode`, **no fragment is read in that pass**) to answer existence and ancestry, and then bounded walks (`walkSubtree`: ≤ `maxFragmentsPerDbId` per requested root, fanout-bounded) of **only the surviving roots**. There is no separate count/preflight traversal and no retained fragment-carrying whole-tree index for explicit scopes: the parent index is the only whole-tree structure, it holds ids only, and it is a local discarded on return or throw. A limit crossed in either step ⇒ `EnumerationBoundExceededError` (at a bracket the executor records `unverifiable`, at planning `enumeration-failed`).

- [ ] **Step 1: Write the failing test**

```js
// test/clashtest/viewer/digestScope.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createViewerElementEnumerator } from '../../../clashtest/viewer/ViewerElementEnumerator.js';
import { validateDigestScopeResult } from '../../../clashtest/planning/ElementEnumerator.js';
import { compareScopeExpectation } from '../../../clashtest/planning/scopeDigest.js';
import { rootedModel, bindingOf, liveCtx, cancellingCtx } from './support/models.mjs';

const TREE = [{ dbId: 10, fragments: [0, 1] }, { dbId: 20, fragments: [2], children: [{ dbId: 21, fragments: [3] }] }];
const enumerator = createViewerElementEnumerator();
const digest = (model, scope, ctx = liveCtx().ctx) => enumerator.digestScope(bindingOf('k', model), scope, ctx);

test('whole: returns a valid population digest; identical content => identical bytes (no cache)', async () => {
  const a = await digest(rootedModel(TREE).model, 'whole');
  const b = await digest(rootedModel(TREE).model, 'whole');
  assert.deepEqual(validateDigestScopeResult(a, { scope: 'whole' }), { ok: true, issues: [] });
  assert.equal(a.kind, 'population'); assert.equal(a.count, 4);
  assert.equal(a.digest, b.digest);
});

test('whole: sensitive to owner change, loaded<->not-loaded flip, growth, and count-preserving geometry replacement', async () => {
  const base = (await digest(rootedModel(TREE).model, 'whole')).digest;
  const owner = (await digest(rootedModel(TREE, { ownerDbIdOverrides: new Map([[1, 20]]) }).model, 'whole')).digest;
  const flip = (await digest(rootedModel(TREE, { notLoadedFragIds: [1] }).model, 'whole')).digest;
  const grown = (await digest(rootedModel(TREE, { fragmentCount: 5 }).model, 'whole')).digest;
  const m = rootedModel(TREE).model;
  const replaced = { ...m, getFragmentList: () => ({ ...m.getFragmentList(), getGeometryId: (f) => (f === 2 ? 999 : f) }) };
  const geom = (await digest(replaced, 'whole')).digest;
  assert.equal(new Set([base, owner, flip, grown, geom]).size, 5);
});

test('whole: does not need or wait for the object tree', async () => {
  const { model, stats } = rootedModel(TREE, { objectTreeReady: false, settleObjectTree: () => {} });
  const r = await digest(model, 'whole');
  assert.equal(r.kind, 'population');
  assert.equal(stats.getObjectTreeWithCallbacksCalls, 0);
});

test('explicit: per-root digests, ascending, one per distinct existing fragment-owning root; unsorted/duplicate input tolerated', async () => {
  const r = await digest(rootedModel(TREE).model, { dbIds: [20, 10, 20] });
  assert.deepEqual(validateDigestScopeResult(r, { scope: { dbIds: [10, 20] } }), { ok: true, issues: [] });
  assert.deepEqual(r.roots.map((x) => [x.dbId, x.fragmentCount]), [[10, 2], [20, 2]]);
});

test('explicit: a subtree digest is independent of what else the model holds (per-root, not per-call)', async () => {
  const a = (await digest(rootedModel(TREE).model, { dbIds: [10] })).roots[0].subtreeDigest;
  const other = [{ dbId: 10, fragments: [0, 1] }, { dbId: 50, fragments: [9] }];
  const b = (await digest(rootedModel(other).model, { dbIds: [10] })).roots[0].subtreeDigest;
  assert.equal(a, b);
});

test('Review Focus 8 (C1): unknown ids, no-fragment ids and listed descendants are ABSENT from digestScope', async () => {
  const tree = [{ dbId: 10, fragments: [0] }, { dbId: 20, fragments: [1], children: [{ dbId: 21, fragments: [2] }] }, { dbId: 30 }];
  const r = await digest(rootedModel(tree).model, { dbIds: [999, 30, 21, 20, 10] });
  assert.deepEqual(r.roots.map((x) => x.dbId), [10, 20]);        // 999 unknown, 30 no fragments, 21 under listed 20
  // (the cross-method equality with resolveRoots is asserted in Task 7, where resolveRoots exists)
});

test('a vanished planned root shows up as drift (root-count mismatch), never as an error', async () => {
  const present = (await digest(rootedModel(TREE).model, { dbIds: [10] })).roots;
  const expectation = { modelKey: 'k', role: 'source', scope: 'roots', roots: present.map(({ dbId, subtreeDigest }) => ({ dbId, subtreeDigest })) };
  const after = await digest(rootedModel([{ dbId: 20, fragments: [2] }]).model, { dbIds: [10] });   // root 10 is gone
  assert.deepEqual(after.roots, []);
  assert.deepEqual(compareScopeExpectation(expectation, after), { modelKey: 'k', role: 'source', status: 'mismatch', detail: 'root-count' });
});

test('explicit: sensitive to a geometry replacement or owner change inside the subtree', async () => {
  const base = (await digest(rootedModel(TREE).model, { dbIds: [20] })).roots[0].subtreeDigest;
  const m = rootedModel(TREE).model;
  const tree = m.getObjectTree();
  const owned = { ...m, getObjectTree: () => ({ ...tree, enumNodeFragments: (id, cb, r) => tree.enumNodeFragments(id === 21 ? 20 : id, cb, r) }) };
  const changed = (await digest(owned, { dbIds: [20] })).roots[0].subtreeDigest;
  assert.notEqual(base, changed);
});

test('D-V9 (same normalizer as resolveRoots): an explicit digest over a root above the existing limits fails, exactly-at-limit succeeds, and the parent pass reads no fragments', async () => {
  const range = (a, b) => Array.from({ length: b - a }, (_, i) => a + i);
  const over = rootedModel([{ dbId: 10, fragments: range(0, 5_001) }]);
  await assert.rejects(digest(over.model, { dbIds: [10] }), (e) => e.name === 'EnumerationBoundExceededError' && e.bound === 'maxFragmentsPerDbId');
  const wide = rootedModel([{ dbId: 10, children: Array.from({ length: 10_001 }, (_, i) => ({ dbId: 1_000 + i })) }]);
  await assert.rejects(digest(wide.model, { dbIds: [10] }), (e) => e.name === 'EnumerationBoundExceededError' && e.bound === 'maxChildrenPerNode');
  const ok = await digest(rootedModel([{ dbId: 10, fragments: range(0, 5_000) }]).model, { dbIds: [10] });
  assert.equal(ok.roots[0].fragmentCount, 5_000);
  const probe = rootedModel(TREE);
  await digest(probe.model, { dbIds: [999] });                     // unknown id: index pass only, no root survives to be walked
  assert.equal(probe.stats.enumNodeFragmentsCalls, 0);
});

test('Review Focus 6: digests read no render-proxy/readiness state (invariant when proxy availability flips)', async () => {
  const m = rootedModel(TREE).model;
  const a = await digest(m, 'whole');
  const flipped = { ...m, getRenderProxy: () => undefined, isLoadDone: () => false };
  assert.equal((await digest(flipped, 'whole')).digest, a.digest);
});

test('Review Focus 9 (C2): the whole-scope path reads the model in the same tick as an undefined-returning checkpoint', async () => {
  const m = rootedModel(TREE).model;
  const order = [];
  queueMicrotask(() => order.push('microtask'));
  const probe = { ...m, getFragmentList() { order.push('read'); return m.getFragmentList(); } };
  const p = enumerator.digestScope(bindingOf('k', probe), 'whole', { checkpoint() { order.push('cp'); } });
  await p;
  assert.deepEqual(order.slice(0, 3), ['cp', 'read', 'microtask']);
});

test('every call checkpoints before reading the model; cancellation propagates unwrapped', async () => {
  const { ctx, calls } = liveCtx();
  await digest(rootedModel(TREE).model, 'whole', ctx);
  assert.ok(calls.n >= 1);
  await assert.rejects(digest(rootedModel(TREE).model, { dbIds: [10] }, cancellingCtx(0)),
    (e) => e.name === 'EnumerationCancelledError');
});
```

- [ ] **Step 2: Run** — `node --test test/clashtest/viewer/digestScope.test.mjs` → FAIL (module not found).

- [ ] **Step 3: Implement** (helpers are reused by Tasks 7–8; keep them module-private but in this file)

```js
// clashtest/viewer/ViewerElementEnumerator.js
// The production ElementEnumerator over a Viewer Model (spec 6.2). Stateless: every call re-reads the LIVE model
// (spec 6.2 "never cached"). Digests are produced by the CORE's own producers so bytes equal what the planner folds.
import { digestPopulation, digestSubtree } from '../planning/scopeDigest.js';
import { createSlicer } from '../util/slicer.js';
import { CHECK_EVERY, checkpointNow } from './checkpoint.js';
import { EnumerationInconsistencyError } from './errors.js';
import { awaitObjectTree } from './readiness.js';
import { indexNodeParents, walkSubtree, hasListedAncestor } from './treeWalk.js';
import { scanPopulation } from './populationScan.js';

const asc = (a, b) => a - b;
const uniqueAscending = (ids) => [...new Set(ids)].sort(asc);

/** A P0 slicer whose yield IS the engine's checkpoint: every CHECK_EVERY items the engine validates liveness/cancellation. */
const digestSlicer = (ctx) => createSlicer({ yieldToScheduler: () => ctx.checkpoint(), maxItemsPerSlice: CHECK_EVERY });

async function subtreeRecords(owners, fragList, ctx) {
  const rows = [];
  let i = 0;
  for (const [fragId, ownerDbId] of owners) {
    rows.push({ fragId, ownerDbId, geometryId: fragList.getGeometryId(fragId) });
    if (++i % CHECK_EVERY === 0) { const p = checkpointNow(ctx); if (p) await p; }
  }
  return rows;
}

async function rootRecord(dbId, owners, fragList, ctx) {
  const { digest } = await digestSubtree(await subtreeRecords(owners, fragList, ctx), { slicer: digestSlicer(ctx) });
  return { dbId, fragmentCount: owners.size, ownerDbIds: [...new Set(owners.values())].sort(asc), subtreeDigest: digest };
}

function claimFragments(claimed, owners, rootDbId) {
  for (const fragId of owners.keys()) {
    const prior = claimed.get(fragId);
    if (prior !== undefined && prior !== rootDbId) {
      throw new EnumerationInconsistencyError('fragment-under-multiple-roots', { fragId, roots: [prior, rootDbId] });
    }
    claimed.set(fragId, rootDbId);
  }
}

/**
 * Explicit-scope normalization: ONE implementation shared by resolveRoots and digestScope (D-V4), so the frozen
 * conformance equivalence cannot drift. BOUNDED (D-V9): one parent-index pass (ids + parents only, fanout-bounded,
 * no fragment read) answers existence (`not-found`) and ancestry; the surviving roots are then walked one by one
 * under `maxFragmentsPerDbId` / `maxChildrenPerNode` (at least one fragment, else `no-fragments`; no fragment
 * claimed by two roots, else a defect). Nothing is retained across a throw (all locals).
 * @returns {Promise<{ roots: Array<{dbId:number, owners:Map<number,number>}>, unresolved: Array<{dbId:number, reason:string}> }>}
 */
async function normalizeExplicit(tree, dbIds, ctx) {
  const index = await indexNodeParents(tree, ctx);
  const unresolved = [];
  const found = new Set();
  for (const dbId of uniqueAscending(dbIds)) {
    if (index.parents.has(dbId)) found.add(dbId);
    else unresolved.push({ dbId, reason: 'not-found' });
  }
  const roots = [];
  const claimed = new Map();
  for (const dbId of found) {                       // a Set keeps the ascending insertion order
    if (hasListedAncestor(index, dbId, found)) continue;
    const owners = await walkSubtree(tree, dbId, ctx);   // bounded per root (D-V9)
    if (owners.size === 0) { unresolved.push({ dbId, reason: 'no-fragments' }); continue; }
    claimFragments(claimed, owners, dbId);
    roots.push({ dbId, owners });
  }
  unresolved.sort((a, b) => a.dbId - b.dbId);
  return { roots, unresolved };
}

const requireCall = (binding, ctx) => {
  if (binding === null || typeof binding !== 'object' || binding.model === null || typeof binding.model !== 'object') {
    throw new TypeError('ElementEnumerator: binding.model is required');
  }
  if (ctx === null || typeof ctx !== 'object' || typeof ctx.checkpoint !== 'function') {
    throw new TypeError('ElementEnumerator: ctx.checkpoint is required');
  }
};

export function createViewerElementEnumerator({ scheduleTimeout, clearScheduled, readinessPollMs } = {}) {
  const readiness = {
    ...(scheduleTimeout ? { scheduleTimeout } : {}), ...(clearScheduled ? { clearScheduled } : {}),
    ...(readinessPollMs ? { pollMs: readinessPollMs } : {}),
  };

  async function digestScope(binding, scope, ctx) {
    requireCall(binding, ctx);
    { const p = checkpointNow(ctx); if (p) await p; } // liveness before the first model read
    const model = binding.model;
    if (scope === 'whole') {
      const { count, records } = await scanPopulation(model.getFragmentList(), ctx, { loadEpoch: binding.lease?.epoch });
      const d = await digestPopulation({ count, records }, { slicer: digestSlicer(ctx) });
      return { kind: 'population', count: d.count, digest: d.digest };
    }
    const { tree, fragList } = await awaitObjectTree(model, ctx, readiness);
    const { roots: normalized } = await normalizeExplicit(tree, scope.dbIds, ctx);   // SAME code as resolveRoots (D-V4)
    const roots = [];
    for (const { dbId, owners } of normalized) {
      const { digest } = await digestSubtree(await subtreeRecords(owners, fragList, ctx), { slicer: digestSlicer(ctx) });
      roots.push({ dbId, fragmentCount: owners.size, subtreeDigest: digest });
    }
    return { kind: 'roots', roots };
  }

  async function resolveRoots() { throw new Error('resolveRoots: implemented in Task 7/8'); }

  return Object.freeze({ resolveRoots, digestScope });
}
```

Note for the implementer: `createSlicer` clock-checks with `performance.now()` by default; this is not a wall-clock *assertion* (Global Constraint 6). `digestSubtree([])` and `digestPopulation({count:0, records:[]})` were verified during planning to accept empty input and return valid `sha256:` digests (needed for a zero-fragment model in Task 8).

- [ ] **Step 4: Run** — `node --test test/clashtest/viewer/digestScope.test.mjs test/clashtest/viewer/scaffold.test.mjs test/clashtest/viewer/layering.test.mjs` → PASS, then full `node scripts/run-tests.mjs` → green (checkpoint gate).
- [ ] **Step 5: Commit** — `feat(viewer): digestScope over the core's digest producers (population + per-root)`.

---

### Task 7: `resolveRoots` — explicit scope

**Files:**
- Modify: `clashtest/viewer/ViewerElementEnumerator.js` (add `resolveExplicit`; `resolveRoots` dispatches on scope)
- Test: `test/clashtest/viewer/resolveRoots.explicit.test.mjs`

**Interfaces:** Consumes Task 6's shared helpers (`normalizeExplicit`, `rootRecord`, `awaitObjectTree` → `{tree, fragList}`); Task 4's bounded `indexNodeParents`/`walkSubtree`/`hasListedAncestor` are used only inside `normalizeExplicit` (**D-V9: explicit planning = one ids-only parent pass + bounded walks of the surviving roots; it reads fragments only inside the requested subtrees and enforces `maxFragmentsPerDbId` / `maxChildrenPerNode` per root while walking**). Produces `resolveRoots(binding, {dbIds}, ctx) → { roots:[{dbId, fragmentCount, ownerDbIds, subtreeDigest}], population:null, ownerMismatch:null, unreachable:null, unresolved:[{dbId, reason:'not-found'|'no-fragments'}] }`, roots and unresolved strictly ascending.

- [ ] **Step 1: Write the failing test**

```js
// test/clashtest/viewer/resolveRoots.explicit.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createViewerElementEnumerator } from '../../../clashtest/viewer/ViewerElementEnumerator.js';
import { validateResolveRootsResult } from '../../../clashtest/planning/ElementEnumerator.js';
import { rootedModel, bindingOf, liveCtx } from './support/models.mjs';

const TREE = [
  { dbId: 10, fragments: [0, 1], children: [{ dbId: 11, fragments: [2] }] },
  { dbId: 20, children: [{ dbId: 21, fragments: [3] }] },
  { dbId: 30 },
];
const enumerator = createViewerElementEnumerator();
const resolve = (dbIds, tree = TREE, opts) => enumerator.resolveRoots(bindingOf('k', rootedModel(tree, opts).model), { dbIds }, liveCtx().ctx);

test('a listed node resolves to a root carrying its whole subtree (fragmentCount, ownerDbIds, digest)', async () => {
  const r = await resolve([10]);
  assert.deepEqual(validateResolveRootsResult(r, { scope: { dbIds: [10] } }), { ok: true, issues: [] });
  assert.equal(r.population, null); assert.equal(r.ownerMismatch, null); assert.equal(r.unreachable, null);
  assert.deepEqual(r.roots.map((x) => [x.dbId, x.fragmentCount, x.ownerDbIds]), [[10, 3, [10, 11]]]);
  assert.match(r.roots[0].subtreeDigest, /^sha256:[0-9a-f]{64}$/);
});

test('a listed descendant of a listed ancestor is dropped (no listed ancestor rule), silently', async () => {
  const r = await resolve([10, 11]);
  assert.deepEqual(r.roots.map((x) => x.dbId), [10]);
  assert.deepEqual(r.unresolved, []);
});

test('non-owning listed node with an owning descendant resolves to itself as the root (subtree granularity)', async () => {
  const r = await resolve([20]);
  assert.deepEqual(r.roots.map((x) => [x.dbId, x.fragmentCount, x.ownerDbIds]), [[20, 1, [21]]]);
});

test('unknown id => not-found; existing node with no fragments => no-fragments; both ascending, never roots', async () => {
  const r = await resolve([999, 30, 10]);
  assert.deepEqual(r.roots.map((x) => x.dbId), [10]);
  assert.deepEqual(r.unresolved, [{ dbId: 30, reason: 'no-fragments' }, { dbId: 999, reason: 'not-found' }]);
  assert.deepEqual(validateResolveRootsResult(r, { scope: { dbIds: [10, 30, 999] } }), { ok: true, issues: [] });
});

test('unsorted and duplicated input is normalised; result is strictly ascending', async () => {
  const r = await resolve([21, 10, 21, 10]);
  assert.deepEqual(r.roots.map((x) => x.dbId), [10, 21]);
});

test('Review Focus 1: a fragment shared by two disjoint roots is a defect (planning fails), not a double count', async () => {
  const shared = [{ dbId: 10, fragments: [0] }, { dbId: 20, fragments: [0] }];
  await assert.rejects(resolve([10, 20], shared),
    (e) => e.name === 'EnumerationInconsistencyError' && e.reason === 'fragment-under-multiple-roots');
});

test('Review Focus 7: a node reachable twice makes the whole answer a defect', async () => {
  const dag = [{ dbId: 10, children: [{ dbId: 12, fragments: [0] }] }, { dbId: 11, children: [{ dbId: 12, fragments: [0] }] }];
  await assert.rejects(resolve([10], dag), (e) => e.reason === 'node-visited-twice');
});

test('D-V9 explicit: a root over maxFragmentsPerDbId fails planning; exactly 5,000 succeeds; the failure hands back no partial answer and leaves no state', async () => {
  const range = (a, b) => Array.from({ length: b - a }, (_, i) => a + i);
  const over = [{ dbId: 10, fragments: range(0, 2_500), children: [{ dbId: 11, fragments: range(2_500, 5_001) }] }, { dbId: 20, fragments: [9_000] }];
  await assert.rejects(resolve([10, 20], over),
    (e) => e.name === 'EnumerationBoundExceededError' && e.bound === 'maxFragmentsPerDbId' && e.detail.root === 10);
  const exact = [{ dbId: 10, fragments: range(0, 2_500), children: [{ dbId: 11, fragments: range(2_500, 5_000) }] }, { dbId: 20, fragments: [9_000] }];
  const r = await resolve([10, 20], exact);
  assert.deepEqual(r.roots.map((x) => [x.dbId, x.fragmentCount]), [[10, 5_000], [20, 1]]);
  assert.deepEqual(r, await createViewerElementEnumerator().resolveRoots(     // same answer from a never-failed enumerator
    bindingOf('k', rootedModel(exact).model), { dbIds: [10, 20] }, liveCtx().ctx));
});

test('D-V9 explicit: a node with more than maxChildrenPerNode children (10,002) fails planning (abort at limit + 1); exactly 10,000 succeeds', async () => {
  const kids = (n) => Array.from({ length: n }, (_, i) => ({ dbId: 1_000 + i }));
  const { model, stats } = rootedModel([{ dbId: 10, fragments: [0], children: kids(10_002) }]);   // limit + 2, so an abort is distinguishable from a full enumeration
  await assert.rejects(enumerator.resolveRoots(bindingOf('k', model), { dbIds: [10] }, liveCtx().ctx),
    (e) => e.name === 'EnumerationBoundExceededError' && e.bound === 'maxChildrenPerNode');
  assert.equal(stats.enumNodeChildrenCallbacks, 10_002);                    // root's 1 child + 10,001 at node 10: aborted at limit + 1 (a full enumeration would be 10,003)
  const ok = await resolve([10], [{ dbId: 10, fragments: [0], children: kids(10_000) }]);
  assert.deepEqual(ok.roots.map((x) => [x.dbId, x.fragmentCount]), [[10, 1]]);
});

test('D-V9 explicit: fragments are read only inside the requested subtrees (the existence/ancestor pass reads none)', async () => {
  const { model, stats } = rootedModel(TREE);
  await enumerator.resolveRoots(bindingOf('k', model), { dbIds: [10, 999] }, liveCtx().ctx);
  assert.equal(stats.enumNodeFragmentsCalls, 2);                            // nodes 10 and 11 only; 20, 21, 30 never asked
});

test('Review Focus 10 (D-V6 scope): an explicit root containing a not-loaded fragment resolves like extractFragments (no population witness)', async () => {
  const r = await resolve([10], TREE, { notLoadedFragIds: [1] });
  assert.deepEqual(r.roots.map((x) => [x.dbId, x.fragmentCount]), [[10, 3]]);
});

test('Review Focus 10: a geometry id the digest cannot encode fails closed (TypeError => enumeration-failed at planning)', async () => {
  const m = rootedModel(TREE).model;
  const bad = { ...m, getFragmentList: () => ({ ...m.getFragmentList(), getGeometryId: () => undefined }) };
  await assert.rejects(enumerator.resolveRoots(bindingOf('k', bad), { dbIds: [10] }, liveCtx().ctx), TypeError);
});

test('resolveRoots and digestScope agree byte-for-byte for the SAME RAW scope, incl. unknown / no-fragment / ancestor-descendant ids', async () => {
  const model = rootedModel(TREE).model;
  const b = bindingOf('k', model);
  for (const dbIds of [[10, 21], [999, 20], [10, 11], [30], [30, 10, 11, 999]]) {
    const rr = await enumerator.resolveRoots(b, { dbIds }, liveCtx().ctx);
    const ds = await enumerator.digestScope(b, { dbIds }, liveCtx().ctx);
    assert.deepEqual(ds.roots, rr.roots.map(({ dbId, fragmentCount, subtreeDigest }) => ({ dbId, fragmentCount, subtreeDigest })), JSON.stringify(dbIds));
  }
});

test('(retained) resolveRoots and digestScope agree byte-for-byte for the same roots (the digest the bracket re-checks)', async () => {
  const model = rootedModel(TREE).model;
  const b = bindingOf('k', model);
  const rr = await enumerator.resolveRoots(b, { dbIds: [10, 21] }, liveCtx().ctx);
  const ds = await enumerator.digestScope(b, { dbIds: rr.roots.map((x) => x.dbId) }, liveCtx().ctx);
  assert.deepEqual(ds.roots, rr.roots.map(({ dbId, fragmentCount, subtreeDigest }) => ({ dbId, fragmentCount, subtreeDigest })));
});

test('two calls over unchanged content are identical (stateless, no cache)', async () => {
  assert.deepEqual(await resolve([10, 21]), await resolve([10, 21]));
});
```

- [ ] **Step 2: Run** → FAIL (`resolveRoots: implemented in Task 7/8`).

- [ ] **Step 3: Implement** — in `ViewerElementEnumerator.js` (imports already added in Task 6) replace the `resolveRoots` stub:

```js
  async function resolveExplicit(binding, scope, ctx) {
    const { tree, fragList } = await awaitObjectTree(binding.model, ctx, readiness);
    const { roots: normalized, unresolved } = await normalizeExplicit(tree, scope.dbIds, ctx);
    const roots = [];
    for (const { dbId, owners } of normalized) roots.push(await rootRecord(dbId, owners, fragList, ctx));
    return { roots, population: null, ownerMismatch: null, unreachable: null, unresolved };
  }

  async function resolveRoots(binding, scope, ctx) {
    requireCall(binding, ctx);
    { const p = checkpointNow(ctx); if (p) await p; }
    return scope === 'whole' ? resolveWhole(binding, ctx) : resolveExplicit(binding, scope, ctx);
  }
  async function resolveWhole() { throw new Error('resolveWhole: implemented in Task 8'); }
```

- [ ] **Step 4: Run** — explicit + digestScope + scaffold + layering tests → PASS, then full `node scripts/run-tests.mjs` → green (checkpoint gate).
- [ ] **Step 5: Commit** — `feat(viewer): resolveRoots for explicit scopes (roots, not-found, no-fragments, duplicate-claim defect, D-V9 bounds)`.

---

### Task 8: `resolveRoots` — whole-model scope (roots, `ownerMismatch`, `unreachable`, D-V6)

**Files:**
- Modify: `clashtest/viewer/ViewerElementEnumerator.js` (replace the `resolveWhole` stub)
- Test: `test/clashtest/viewer/resolveRoots.whole.test.mjs`

**Interfaces:** Consumes Tasks 4–6 helpers, `topmostFragmentOwningRoots`, `indexInstanceTree` (budgeted). **Order of work (D-V9, exact):** (1) `awaitObjectTree`; (2) `scanPopulation` — the bounded population/count validation: `getCount()` is checked against `maxCollisionInstancesPerEpoch` (20,000) before any record is read and **before any tree traversal**, so the retained `records` array can never exceed 20,000; (3) `indexInstanceTree` — the retained whole-model index, built in ONE pass whose every allocation is charged to an existing limit (per-node own list ≤ `maxFragmentsPerDbId`, tree-reachable tally ≤ `maxCollisionInstancesPerEpoch`, fanout ≤ `maxChildrenPerNode`), aborting at the first excess; (4) bounded `walkSubtree` per topmost root (≤ `maxFragmentsPerDbId` per root, the library's per-requested-root limit); (5) D-V6 reconciliation. There is deliberately **no separate count/preflight traversal** of the tree: step 2 is the population preflight, and step 3 is itself the bounded pass (a second full traversal would double the Viewer-callback cost and add no bound). **D-V6 (OWNER-APPROVED fail-closed policy):** a tree-reachable fragment that is not loaded (`N`), owner-unresolvable (`U`), or outside `0..count-1` fails planning for the run (`EnumerationInconsistencyError` ⇒ `enumeration-failed`); no durable partial/incomplete carrier exists and none is added. Produces `resolveRoots(binding, 'whole', ctx) → { roots, population:{count,digest}, ownerMismatch:{count, first20}, unreachable:{count, ownerDbIds, unattributable:{notLoaded, ownerUnresolvable}}, unresolved: [] }` where `population.digest` equals `digestScope(binding,'whole').digest` for unchanged content, `first20` is ascending by `fragId`, `unreachable.count` counts loaded owner-resolvable fragments in no root, and `unattributable` counts N / U fragments in no root. **Amendment 2026-10-07 (owner-authorized bounded D-V6 exception):** a tree-reachable population record with `cls === 'N'` **and** `nullGeometry === true` (SVF2/OTG fragment, geometry id 0, Viewer marks not-loaded) is informational — marked reachable, owner comparison skipped, still present in the population/root digests, planning proceeds (spec erratum A19). Every other tree-reachable `N` (real geometry id), `U` and out-of-range fragment still fails closed with `tree-reachable-fragment-unattributable`; no digest/schema/limit/Core change.

- [ ] **Step 1: Write the failing test**

```js
// test/clashtest/viewer/resolveRoots.whole.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createViewerElementEnumerator } from '../../../clashtest/viewer/ViewerElementEnumerator.js';
import { validateResolveRootsResult } from '../../../clashtest/planning/ElementEnumerator.js';
import { rootedModel, bindingOf, liveCtx } from './support/models.mjs';

const TREE = [
  { dbId: 10, fragments: [0, 1], children: [{ dbId: 11, fragments: [2] }] },
  { dbId: 20, children: [{ dbId: 21, fragments: [3] }, { dbId: 22, fragments: [4] }] },
];
const enumerator = createViewerElementEnumerator();
const whole = (tree = TREE, opts) => {
  const b = bindingOf('k', rootedModel(tree, opts).model);
  return enumerator.resolveRoots(b, 'whole', liveCtx().ctx);
};

test('roots = topmost fragment-owning nodes, ascending; hierarchy: root 10 owns fragment-owning descendant 11', async () => {
  const r = await whole();
  assert.deepEqual(validateResolveRootsResult(r, { scope: 'whole' }), { ok: true, issues: [] });
  assert.deepEqual(r.roots.map((x) => [x.dbId, x.fragmentCount, x.ownerDbIds]),
    [[10, 3, [10, 11]], [21, 1, [21]], [22, 1, [22]]]);
  assert.equal(r.unresolved.length, 0);
  assert.deepEqual(r.ownerMismatch, { count: 0, first20: [] });
  assert.deepEqual(r.unreachable, { count: 0, ownerDbIds: [], unattributable: { notLoaded: 0, ownerUnresolvable: 0 } });
});

test('population.digest equals digestScope whole for unchanged content (same function, spec 6.2)', async () => {
  const b = bindingOf('k', rootedModel(TREE).model);
  const rr = await enumerator.resolveRoots(b, 'whole', liveCtx().ctx);
  const ds = await enumerator.digestScope(b, 'whole', liveCtx().ctx);
  assert.deepEqual(rr.population, { count: ds.count, digest: ds.digest });
});

test('real owner mismatch: tree owner != fragList owner is counted with first20 ascending by fragId', async () => {
  const r = await whole(TREE, { ownerDbIdOverrides: new Map([[3, 99], [1, 77]]) });
  assert.equal(r.ownerMismatch.count, 2);
  assert.deepEqual(r.ownerMismatch.first20, [
    { fragId: 1, treeOwner: 10, fragListOwner: 77 }, { fragId: 3, treeOwner: 21, fragListOwner: 99 }]);
});

test('first20 is capped at 20 while count is exact', async () => {
  const many = [{ dbId: 10, fragments: Array.from({ length: 30 }, (_, i) => i) }];
  const overrides = new Map(Array.from({ length: 30 }, (_, i) => [i, 999]));
  const r = await whole(many, { ownerDbIdOverrides: overrides });
  assert.equal(r.ownerMismatch.count, 30); assert.equal(r.ownerMismatch.first20.length, 20);
});

test('unreachable: loaded owner-resolvable fragments in no root subtree (tree under-enumeration)', async () => {
  const r = await whole(TREE, { fragmentCount: 8, ownerDbIdOverrides: new Map([[5, 500], [6, 500], [7, 600]]) });
  assert.deepEqual(r.unreachable, { count: 3, ownerDbIds: [500, 600], unattributable: { notLoaded: 0, ownerUnresolvable: 0 } });
});

test('unattributable: N and U fragments outside every root are counted separately (R12-1)', async () => {
  const r = await whole(TREE, { fragmentCount: 8, notLoadedFragIds: [5], ownerDbIdOverrides: new Map([[6, undefined], [7, [1, 2]]]) });
  assert.deepEqual(r.unreachable, { count: 0, ownerDbIds: [], unattributable: { notLoaded: 1, ownerUnresolvable: 2 } });
});

test('mixed owner: an owner with both a reachable and an unreachable fragment appears in both tables', async () => {
  const r = await whole(TREE, { fragmentCount: 6, ownerDbIdOverrides: new Map([[5, 10]]) });
  assert.deepEqual(r.unreachable.ownerDbIds, [10]);
  assert.ok(r.roots.some((x) => x.ownerDbIds.includes(10)));
});

test('D-V6 (owner-approved fail-closed): a TREE-REACHABLE fragment that is not-loaded / owner-unresolvable (undefined or array) / outside the population fails planning deterministically', async () => {
  for (const [opts, reason] of [
    [{ notLoadedFragIds: [1] }, 'tree-reachable-fragment-unattributable'],
    [{ ownerDbIdOverrides: new Map([[1, undefined]]) }, 'tree-reachable-fragment-unattributable'],
    [{ ownerDbIdOverrides: new Map([[1, [10, 11]]]) }, 'tree-reachable-fragment-unattributable'],
    [{ fragmentCount: 3 }, 'fragment-outside-population'],           // tree names fragment 4; population is 0..2
  ]) {
    const attempt = whole(TREE, opts);
    await assert.rejects(attempt, (e) => e.name === 'EnumerationInconsistencyError' && e.reason === reason, JSON.stringify(reason));
    await assert.rejects(whole(TREE, opts), (e) => e.reason === reason);   // deterministic: the second call fails the same way
  }
});

test('D-V6: the failure is the ONLY outcome (no partial roots, no population, no diagnostic carrier) and the enumerator is unharmed for the next call', async () => {
  let settled;
  await whole(TREE, { notLoadedFragIds: [1] }).then((v) => { settled = { resolved: v }; }, (e) => { settled = { rejected: e.name }; });
  assert.deepEqual(settled, { rejected: 'EnumerationInconsistencyError' });   // never a resolved-but-partial answer
  assert.deepEqual((await whole(TREE)).roots.map((x) => x.dbId), [10, 21, 22]);
});

test('Review Focus 1: a fragment reachable under two roots fails planning', async () => {
  await assert.rejects(whole([{ dbId: 10, fragments: [0] }, { dbId: 20, fragments: [0] }]),
    (e) => e.reason === 'fragment-under-multiple-roots');
});

test('empty tree / no fragments: zero roots, zero-count population, still a valid answer', async () => {
  const r = await whole([{ dbId: 10 }]);
  assert.deepEqual(r.roots, []); assert.equal(r.population.count, 0);
  assert.deepEqual(validateResolveRootsResult(r, { scope: 'whole' }), { ok: true, issues: [] });
});

test('D-V9 whole: population above maxCollisionInstancesPerEpoch fails BEFORE any tree traversal (zero enumNode* calls); exactly 20,000 succeeds', async () => {
  const over = rootedModel(TREE, { fragmentCount: 20_001 });
  await assert.rejects(enumerator.resolveRoots(bindingOf('k', over.model), 'whole', liveCtx().ctx),
    (e) => e.name === 'CapacityExceededError');
  assert.equal(over.stats.enumNodeChildrenCalls, 0);
  assert.equal(over.stats.enumNodeFragmentsCalls, 0);                        // the retained index was never started
  assert.ok(over.stats.getCountCalls >= 1);
  const exact = await whole(TREE, { fragmentCount: 20_000 });                // 5 tree-reachable + 19,995 unclaimed (owner-unresolvable) fragments
  assert.equal(exact.population.count, 20_000);
  assert.equal(exact.unreachable.unattributable.ownerUnresolvable, 19_995);
});

test('D-V9 whole: over-bound TREES fail planning — node over maxChildrenPerNode, node over maxFragmentsPerDbId, a ROOT subtree over maxFragmentsPerDbId, tree-reachable tally over 20,000', async () => {
  const range = (a, b) => Array.from({ length: b - a }, (_, i) => a + i);
  const kids = (n) => Array.from({ length: n }, (_, i) => ({ dbId: 1_000 + i }));
  const five = (perNode) => Array.from({ length: 5 }, (_, i) => ({ dbId: 10 + i, fragments: range(0, perNode) })); // rediscovered ids
  for (const [tree, isExpected] of [
    [[{ dbId: 10, children: kids(10_001) }], (e) => e.name === 'EnumerationBoundExceededError' && e.bound === 'maxChildrenPerNode'],
    [[{ dbId: 10, fragments: range(0, 5_001) }], (e) => e.name === 'EnumerationBoundExceededError' && e.bound === 'maxFragmentsPerDbId'],
    [[{ dbId: 10, fragments: range(0, 2_500), children: [{ dbId: 11, fragments: range(2_500, 5_001) }] }],      // each node <= 5,000; the ROOT subtree is 5,001
      (e) => e.name === 'EnumerationBoundExceededError' && e.bound === 'maxFragmentsPerDbId' && e.detail.root === 10],
    [five(4_001), (e) => e.name === 'CapacityExceededError'],
  ]) {
    await assert.rejects(whole(tree), isExpected);
  }
});

test('D-V9 whole: exactly-at-limit trees succeed (a 10,000-child node, a 5,000-fragment root)', async () => {
  const range = (a, b) => Array.from({ length: b - a }, (_, i) => a + i);
  const wide = await whole([{ dbId: 10, children: Array.from({ length: 10_000 }, (_, i) => ({ dbId: 1_000 + i })) }]);
  assert.deepEqual(wide.roots, []); assert.equal(wide.population.count, 0);
  const full = await whole([{ dbId: 10, fragments: range(0, 2_500), children: [{ dbId: 11, fragments: range(2_500, 5_000) }] }]);
  assert.deepEqual(full.roots.map((x) => [x.dbId, x.fragmentCount]), [[10, 5_000]]);
});

test('D-V9 whole: a failed planning pass leaves no retained index or cache — the next in-bounds call equals a never-failed enumerator', async () => {
  const kids = Array.from({ length: 10_001 }, (_, i) => ({ dbId: 1_000 + i }));
  await assert.rejects(whole([{ dbId: 10, children: kids }]), (e) => e.name === 'EnumerationBoundExceededError');
  assert.deepEqual(await whole(), await createViewerElementEnumerator().resolveRoots(
    bindingOf('k', rootedModel(TREE).model), 'whole', liveCtx().ctx));
});

test('three consecutive calls over unchanged content agree exactly (the planner requires this, spec 6.2)', async () => {
  const b = bindingOf('k', rootedModel(TREE).model);
  const a1 = await enumerator.resolveRoots(b, 'whole', liveCtx().ctx);
  const a2 = await enumerator.resolveRoots(b, 'whole', liveCtx().ctx);
  assert.deepEqual(a1, a2);
});
```

- [ ] **Step 2: Run** → FAIL (`resolveWhole: implemented in Task 8`).

- [ ] **Step 3: Implement** — add `indexInstanceTree` and `topmostFragmentOwningRoots` to the `./treeWalk.js` import and replace the stub:

```js
  async function resolveWhole(binding, ctx) {
    const { tree, fragList } = await awaitObjectTree(binding.model, ctx, readiness);
    const loadEpoch = binding.lease?.epoch;
    // D-V9 order: (2) bounded population/count validation FIRST (O(1) count gate, then <= 20,000 records) ...
    const { count, records } = await scanPopulation(fragList, ctx, { loadEpoch });
    // ... (3) THEN the retained whole-model index, built by one budgeted pass (aborts at the first excess) ...
    const index = await indexInstanceTree(tree, ctx, { loadEpoch });
    const rootIds = await topmostFragmentOwningRoots(index, ctx);

    const roots = [];
    const claimed = new Map();
    const mismatches = [];
    const reachable = new Uint8Array(count);
    for (const dbId of rootIds) {
      const owners = await walkSubtree(tree, dbId, ctx);   // (4) bounded per root (maxFragmentsPerDbId / maxChildrenPerNode)
      claimFragments(claimed, owners, dbId);
      for (const [fragId, treeOwner] of owners) {
        const rec = records[fragId];
        if (rec === undefined) throw new EnumerationInconsistencyError('fragment-outside-population', { fragId, count });
        // (5) D-V6 (OWNER-APPROVED fail-closed policy): a tree-reachable fragment the library would drop as a target.
        if (rec.cls !== 'L') throw new EnumerationInconsistencyError('tree-reachable-fragment-unattributable', { fragId, cls: rec.cls });
        if (rec.ownerDbId !== treeOwner) mismatches.push({ fragId, treeOwner, fragListOwner: rec.ownerDbId });
        reachable[fragId] = 1;
      }
      roots.push(await rootRecord(dbId, owners, fragList, ctx));
    }
    mismatches.sort((a, b) => a.fragId - b.fragId);

    const unreachableOwners = new Set();
    let unreachableCount = 0;
    let notLoaded = 0;
    let ownerUnresolvable = 0;
    for (let fragId = 0; fragId < count; fragId++) {
      if (reachable[fragId] === 0) {
        const rec = records[fragId];
        if (rec.cls === 'L') { unreachableCount += 1; unreachableOwners.add(rec.ownerDbId); }
        else if (rec.cls === 'N') notLoaded += 1;
        else ownerUnresolvable += 1;
      }
      if ((fragId + 1) % CHECK_EVERY === 0) { const p = checkpointNow(ctx); if (p) await p; }
    }
    const pop = await digestPopulation({ count, records }, { slicer: digestSlicer(ctx) });
    return {
      roots,
      population: { count, digest: pop.digest },
      ownerMismatch: { count: mismatches.length, first20: mismatches.slice(0, 20) },
      unreachable: { count: unreachableCount, ownerDbIds: [...unreachableOwners].sort(asc), unattributable: { notLoaded, ownerUnresolvable } },
      unresolved: [],
    };
  }
```

- [ ] **Step 4: Run** — whole + explicit + digestScope + scaffold + layering → PASS, then full `node scripts/run-tests.mjs` → green (checkpoint gate).
- [ ] **Step 5: Commit** — `feat(viewer): resolveRoots for whole-model scope (ownerMismatch, unreachable, D-V6 fail-closed, D-V9 bounded planning)`.

---

### Task 9: Conformance, library differential, and content cases

**Files:**
- Create: `test/clashtest/viewer/conformance.test.mjs`, `test/clashtest/viewer/differential.test.mjs`

**Interfaces:** Consumes `checkEnumeratorConformance({ enumerator, binding, cases, checkpoint })` (`clashtest/planning/ElementEnumerator.js:219`) — read its exact `cases` shape (`:219-294`) and `conformanceCases()` in `test/clashtest/support/syntheticModels.mjs` before writing; test-only imports `extractFragments`/`extractAllFragments` (`collision/viewer/ViewerModelAdapter.js`) and `createGeometryIdentity` (`collision/geometry/GeometryIdentity.js`); `digestSubtree`/`digestPopulation`. No production code.

- [ ] **Step 1: Write the failing tests**

```js
// test/clashtest/viewer/conformance.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkEnumeratorConformance } from '../../../clashtest/planning/ElementEnumerator.js';
import { createViewerElementEnumerator } from '../../../clashtest/viewer/ViewerElementEnumerator.js';
import { rootedModel, bindingOf } from './support/models.mjs';

const TREE = [
  { dbId: 10, fragments: [0, 1], children: [{ dbId: 11, fragments: [2] }] },
  { dbId: 20, children: [{ dbId: 21, fragments: [3] }] },
  { dbId: 30 },
];
const binding = bindingOf('k', rootedModel(TREE).model);

test('the adapter passes the core conformance helper for whole and explicit scopes', async () => {
  const { failures } = await checkEnumeratorConformance({
    enumerator: createViewerElementEnumerator(), binding,
    cases: { scopes: [
      { name: 'whole', scope: 'whole' },
      { name: 'one-root', scope: { dbIds: [10] } },
      { name: 'two-roots', scope: { dbIds: [10, 21] } },
      { name: 'unresolved', scope: { dbIds: [999, 20] } },
      { name: 'ancestor-descendant', scope: { dbIds: [10, 11] } },     // Codex C1: digestScope must normalize like resolveRoots
      { name: 'no-fragments', scope: { dbIds: [30] } },
      { name: 'unsorted-duplicated', scope: { dbIds: [21, 10, 21] } },
    ] },
    checkpoint: () => {},
  });
  assert.deepEqual(failures, []);
});
```

(Signature verified: `checkEnumeratorConformance({ enumerator, binding, cases: { scopes: [{ name, scope }] }, checkpoint? }) → Promise<{ failures: string[] }>`. It also asserts ≥ 1 checkpoint per call, two-call stability, `digestScope` ≡ `resolveRoots`, and that `EnumerationCancelledError` from a synchronously-throwing **and** an async-rejecting checkpoint is propagated **as the same object** from both methods — the adapter's "checkpoint before first read + unwrapped propagation" rules are what satisfy that.)

```js
// test/clashtest/viewer/differential.test.mjs  (spec 6.2.1 "Conformance", AC-2: adapter == library extraction)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../fixtures/mockInstanceTree.mjs'; // installs globalThis.THREE for the library functions (test-only)
import { extractFragments, extractAllFragments } from '../../../collision/viewer/ViewerModelAdapter.js';
import { digestPopulation, digestSubtree } from '../../../clashtest/planning/scopeDigest.js';
import { createViewerElementEnumerator } from '../../../clashtest/viewer/ViewerElementEnumerator.js';
import { rootedModel, bindingOf, liveCtx } from './support/models.mjs';

const enumerator = createViewerElementEnumerator();
const SHAPES = {
  plain: [{ dbId: 10, fragments: [0, 1] }, { dbId: 20, fragments: [2] }],
  hierarchy: [{ dbId: 10, fragments: [0], children: [{ dbId: 11, fragments: [1, 2] }, { dbId: 12, fragments: [3] }] }],
  nonOwningParent: [{ dbId: 20, children: [{ dbId: 21, fragments: [0] }, { dbId: 22, fragments: [1] }] }],
  rediscovery: [{ dbId: 10, fragments: [0, 1], children: [{ dbId: 11, fragments: [1, 2] }] }],
};

for (const [name, tree] of Object.entries(SHAPES)) {
  test(`differential[${name}]: every root's records and digest equal what extractFragments produces`, async () => {
    const { model } = rootedModel(tree);
    const fragList = model.getFragmentList();
    const rr = await enumerator.resolveRoots(bindingOf('k', model), 'whole', liveCtx().ctx);
    for (const root of rr.roots) {
      const lib = await extractFragments(model, [root.dbId], 0, { checkpoint: undefined, THREE: globalThis.THREE });
      assert.equal(lib.size, root.fragmentCount);
      assert.deepEqual([...new Set([...lib.values()].map((r) => r.ownerDbId))].sort((a, b) => a - b), root.ownerDbIds);
      const libRows = [...lib.values()].map((r) => ({ fragId: r.fragmentId, ownerDbId: r.ownerDbId, geometryId: fragList.getGeometryId(r.fragmentId) }));
      assert.equal((await digestSubtree(libRows)).digest, root.subtreeDigest);
    }
  });

  test(`differential[${name}]: the population digest equals the one built from extractAllFragments' records + its two dropped classes`, async () => {
    const { model } = rootedModel(tree, { fragmentCount: 6, notLoadedFragIds: [4], ownerDbIdOverrides: new Map([[5, undefined]]) });
    const fragList = model.getFragmentList();
    const { records, diagnostics } = await extractAllFragments(model, 0, { checkpoint: undefined, THREE: globalThis.THREE });
    const dropped = new Map(diagnostics.map((d) => [d.fragment.fragId, d.reason === 'fragment-not-loaded' ? 'N' : 'U']));
    const rows = [];
    for (let f = 0; f < fragList.getCount(); f++) {
      if (dropped.has(f)) rows.push({ fragId: f, cls: dropped.get(f) });
      else { const r = records.get(f); rows.push({ fragId: f, cls: 'L', ownerDbId: r.ownerDbId, geometryId: fragList.getGeometryId(f) }); }
    }
    const expected = await digestPopulation({ count: fragList.getCount(), records: rows });
    const got = await enumerator.digestScope(bindingOf('k', model), 'whole', liveCtx().ctx);
    assert.equal(got.digest, expected.digest);
  });
}

test('differential: an explicit multi-root call agrees with the library called with the same roots (first-discovery across roots)', async () => {
  const { model } = rootedModel(SHAPES.plain);
  const lib = await extractFragments(model, [10, 20], 0, { checkpoint: undefined, THREE: globalThis.THREE });
  const rr = await enumerator.resolveRoots(bindingOf('k', model), { dbIds: [10, 20] }, liveCtx().ctx);
  assert.equal(lib.size, rr.roots.reduce((n, r) => n + r.fragmentCount, 0));
});
```

Content cases already pinned in Tasks 3–8 (readiness, `ObjectTreeUnavailableError`, real owner mismatch, unreachable/unattributable, D-V6, duplicate claim, cycle/DAG, 20k cap, digest sensitivity) are the P3-plan "adapter content cases"; this task's conformance test is the port-level contract.

- [ ] **Step 2: Run** — `node --test test/clashtest/viewer/conformance.test.mjs test/clashtest/viewer/differential.test.mjs` → expected to FAIL only if the adapter diverges from the library; **if a differential assertion fails, that is a real adapter/library disagreement: stop and report it (do not adjust the test to match)**. If everything passes on first run, add a mutation check: temporarily change `treeWalk.js` `walkSubtree` to last-discovery-wins and confirm `differential[rediscovery]` fails, then revert (proves the differential can fail).
- [ ] **Step 3: (no production change expected).**
- [ ] **Step 4: Run** — the two files + scaffold + layering → PASS, then full `node scripts/run-tests.mjs` → green (checkpoint gate).
- [ ] **Step 5: Commit** — `test(viewer): conformance helper, library differential (AC-2), mutation-checked`.

---

### Task 10: Engine-level integration over a real `CollisionWorld` (T2)

**Files:**
- Create: `test/clashtest/viewer/engineIntegration.test.mjs`

**Interfaces (every name below re-verified against current source in the Work-review remediation, 2026-09-26):**
- `makeRealWorldFixture({ models, fragments })` (`test/clashtest/support/realWorld.mjs`). `models` = `{ <modelKey>: { tree: [...], positions: { <fragId>: [x, y, z] } } }` (tree form; tree nodes are `{ dbId, fragments?: [fragIds], children? }`; `positions` is keyed by **fragId**). **`fragments` is a TOP-LEVEL option keyed by modelKey** (`fragments: { a: { ownerDbIdOverrides, notLoadedFragIds, fragmentCount, hiddenDbIds } }`; its `Map` keys are **fragIds**, never dbIds); `objectTreeReady` / `settleObjectTree` also pass through to `buildMockModel` (`fragments[modelKey]` is handed over whole) but `syntheticSpecOf` ignores them. The fixture returns `{ world, viewer, models, modelFor, enumerator, registry, setRenderProxyAvailable }`; its `fx.enumerator` is the *synthetic* one and is **not used** here; every model is registered on the coordinator's registry as `modelVersion: 'v1'`.
- Engine construction mirrors `engineOver` (`test/clashtest/integration/realWorldEnvironment.test.mjs:52-62`) with the adapter swapped in: `createClashTestEngine({ world: fx.world, enumerator: createViewerElementEnumerator(), now: clock.now, yieldToScheduler: clock.yieldToScheduler, scheduleTimeout: () => () => {} })`, `clock = createFakeClock({ start: Date.UTC(2026, 8, 24) })` (`support/fakeClock.mjs`).
- Definition literal (as `realWorldEnvironment.test.mjs:32-35`): `{ schemaVersion: 1, testId, revision: 1, name, mode: 'volume-overlap', selectionA: { entries: [{ kind: 'model', modelKey: 'a' }] }, selectionB: { entries: [{ kind: 'model', modelKey: 'b' }] } }`. Run and read: `const { resultSet } = await engine.startRun(def).done` (`done` resolves — it does not reject — with a summary whose `resultSet` is the sealed set, for cancel and for failed planning alike).
- Sealed-set fields used (all verified in `clashtest/results/resultSetSchema.js`): `resultSet.outcome.status` ∈ `'completed' | 'failed' | 'cancelled' | 'invalidated'` (**`completed`, not `complete`**); `resultSet.outcome.coverage` ∈ `'full' | 'partial'`; `resultSet.outcome.integrity` ∈ `'clean' | 'caveated'`; `resultSet.ledger.planningGaps` = `[{ phase, cause }]`, causes from `PLANNING_CAUSES` (`clashtest/planning/ElementEnumerator.js:45-49`; `owner-mapping-mismatch` and `enumeration-failed` are members); `resultSet.ledger.rootOwners` = `[{ modelKey, owners: [{ rootDbId, ownerDbIds, cls: 'A' | 'B' | 'C' }] }]` (rows are per **model**, roots nested under `owners`); recorded scope digests = `resultSet.provenance.models.map((m) => [m.modelKey, m.scopeDigests])` (never `elementCount`, G-EC); `resultSet.digests.pairSetDigest` / `.ledgerDigest`; pairs = `resultSet.results.map((r) => pairIdKey(r.pair)).sort()`. There is **no `ownerMismatch` field on a sealed set**: "planning saw no owner mismatch" is recorded as `ledger.planningGaps` being `[]` (plus `outcome.integrity === 'clean'`).
- `validateResultSet(resultSet, { limits: ENGINE_LIMIT_DEFAULTS })` — **the second argument is required** (`validateResultSet.js:1593`; `ENGINE_LIMIT_DEFAULTS` from `clashtest/options.js`); it is synchronous and returns `{ ok, issues }`; assert `.issues` deep-equals `[]` (as `realWorldEnvironment.test.mjs:166`).
- `bruteForceReference(fx, { mode, sources, targets })` (`support/bruteForce.mjs:30`) — `sources` = `[[modelKey, ownerDbId], …]`, `targets` = `[[modelKey, number[] | null], …]` (`null` = whole-model sentinel); returns `{ pairIds, calls }` (sorted canonical keys) and throws on any library diagnostic; compare with `assertPairSets(pairKeysOf(resultSet), ref.pairIds, { mode: 'volume-overlap', resultSet, expect: 'exact' })` (`support/pairSets.mjs`; `pairKeysOf = (rs) => rs.results.map((r) => pairIdKey(r.pair)).sort()`, `pairIdKey` from `support/bruteForce.mjs`).
- Planner error mapping (`engine.js` `planningCauseOf`, verified): any throw that is not `WorldDisposedError` / `ModelEvictedError` / a tagged unavailable-test error — including the adapter's `EnumerationInconsistencyError`, `EnumerationBoundExceededError`, and the library's `CapacityExceededError` and `ObjectTreeUnavailableError` — becomes planning gap `enumeration-failed` (the last is pinned by `test/clashtest/engine/startRun.test.mjs:497`).

- [ ] **Step 1: Write the failing test.** Fixture: model `a` — `tree: [{ dbId: 1, children: [{ dbId: 100, fragments: [0] }, { dbId: 200, fragments: [1] }] }]`, `positions: { 0: [0, 0, 0], 1: [10, 0, 0] }`; model `b` — `tree: [{ dbId: 1, children: [{ dbId: 100, fragments: [0] }, { dbId: 300, fragments: [1] }] }]`, `positions: { 0: [0.5, 0, 0], 1: [20, 0, 0] }` (`b`/100 overlaps `a`/100). Run one `volume-overlap` definition, `selectionA` = whole model `a`, `selectionB` = whole model `b`. Whole-model roots are the **topmost fragment-owning nodes** (D-V3): `a` → 100, 200; `b` → 100, 300 (the tree root `1` owns nothing). Assertions:
  1. `outcome.status === 'completed'`, `outcome.coverage === 'full'`, `outcome.integrity === 'clean'`, `ledger.planningGaps` deep-equals `[]`, and `validateResultSet(resultSet, { limits: ENGINE_LIMIT_DEFAULTS }).issues` deep-equals `[]`;
  2. the retained pair set equals `bruteForceReference(fx, { mode: 'volume-overlap', sources: [['a', 100], ['a', 200]], targets: [['b', null]] })` via `assertPairSets` (form above);
  3. `ledger.rootOwners` deep-equals `[{ modelKey: 'a', owners: [{ rootDbId: 100, ownerDbIds: [100], cls: 'A' }, { rootDbId: 200, ownerDbIds: [200], cls: 'A' }] }, { modelKey: 'b', owners: [{ rootDbId: 100, ownerDbIds: [100], cls: 'B' }, { rootDbId: 300, ownerDbIds: [300], cls: 'B' }] }]` (`A` = in selection A only, `B` = in B only — `ledger.js:32-36`; if the real class letters or row order differ, that is an interface fact to report, not to paper over);
  4. **negative controls through the real engine — every one asserts `outcome.status === 'failed'`, `outcome.coverage === 'partial'`, `ledger.planningGaps.map((g) => g.cause)` equal to the stated cause, `resultSet.results.length === 0` (no misleading partial run) and `validateResultSet(...).issues` equal to `[]`:**
     - (i) `fragments: { a: { ownerDbIdOverrides: new Map([[1, 999]]) } }` (**fragId 1**, tree owner 200) ⇒ cause `owner-mapping-mismatch`;
     - (ii) a model whose object tree errors (`fragments: { a: { objectTreeReady: false, settleObjectTree: (_ok, err) => err(new Error('x')) } }`) ⇒ `enumeration-failed`;
     - (iii) **D-V6, all three tree-reachable classes, one run each:** `notLoadedFragIds: [1]`; `ownerDbIdOverrides: new Map([[1, undefined]])`; `ownerDbIdOverrides: new Map([[1, [200, 201]]])`; and a tree naming fragment 1 with `fragmentCount: 1` (out of range) ⇒ each `enumeration-failed`;
     - (iv) **D-V9 bounds, one run each:** `fragments: { a: { fragmentCount: 20_001 } }` (population over the ceiling); a model whose node `100` has 10,001 children (`maxChildrenPerNode`); a model whose root `100` subtree tallies 5,001 fragments (`maxFragmentsPerDbId`) ⇒ each `enumeration-failed`;
     - (v) a fragment shared by two roots (`a`: `100` and `200` both list fragment `0`) ⇒ `enumeration-failed`.
  5. determinism: two sequential runs over unchanged models produce equal `ledger.rootOwners`, equal `provenance.models.map((m) => [m.modelKey, m.scopeDigests])`, and equal `digests.pairSetDigest` / `digests.ledgerDigest`.
- [ ] **Step 2: Run** — `node --test test/clashtest/viewer/engineIntegration.test.mjs` → FAIL until the fixture wiring is right; fix the *test* wiring only. **If a real-engine assertion (planning-gap cause, coverage, ledger row shape) disagrees with the adapter's behavior, stop and report — it may be an interface mismatch (Global Constraint 1: no core edits).**
- [ ] **Step 3: (no production change expected).**
- [ ] **Step 4: Run** — this file plus `test/clashtest/integration/realWorldEnvironment.test.mjs` (must remain green: proves no shared-fixture regression from Task 2) → PASS, then full `node scripts/run-tests.mjs` → green (checkpoint gate).
- [ ] **Step 5: Commit** — `test(viewer): adapter through the real engine + CollisionWorld (brute-force parity, D-V6/D-V9 negative controls)`.

---

### Task 11: `ModelRegistry` unload wiring

**Files:**
- Create: `clashtest/viewer/unloadWiring.js`
- Modify: `test/clashtest/viewer/scaffold.test.mjs` (append `'unloadWiring.js'` to `EXPECTED_MODULES`)
- Test: `test/clashtest/viewer/unloadWiring.test.mjs`

**Scope note:** these are the OFFLINE (T1/T2) tests of the wiring against a fake event target. **They cannot show that the real Viewer dispatches `BEFORE_MODEL_UNLOAD_EVENT` to the production wiring** — that is Task 13 step (h), which installs this very `wireModelUnload` on the live Viewer; until T3 has been executed with (h) passing, the wiring is `LIVE_UNLOAD_INTEGRATION_UNVERIFIED` (Gates table).

**Interfaces:**
- Consumes: a `registry` (a **real** `ModelRegistry` from `getWorldCoordinator(world).registry`; wiring calls `assertRegistryBelongsToWorld(registry, world)` from `../identity/ModelRegistry.js` and so rejects a registry built for another world, or a partial duck-typed fake, with `ModelBindingError('registry-mismatch')` — Codex I4), a `world` (`CollisionWorld`: `evictModel(model)` — synchronous, idempotent, never throws, permanently evicts that `Model` object), an `eventTarget` with `addEventListener(name, fn)` / `removeEventListener(name, fn)`, and the **host-supplied** `eventName` (`Autodesk.Viewing.BEFORE_MODEL_UNLOAD_EVENT`; never read from a global here). The Viewer payload carries `event.model` (`wwwroot/extensions/RoomLocatorExtension.js:92`).
- Produces: `wireModelUnload({ world, registry, eventTarget, eventName, report? }) → Object.freeze({ dispose(): void })`. The handler is synchronous, never throws, never awaits; it calls `registry.unregister(model)` then `world.evictModel(model)`, each in its own `try/catch` reporting through `report(stage, error)` (`report` itself guarded).

- [ ] **Step 1: Write the failing test** — cases:
  1. argument shape: missing `world.evictModel`/`registry.unregister`/`eventTarget.addEventListener`/`eventName` ⇒ `TypeError` at wiring time (synchronous); **Review Focus 11:** a real registry belonging to world A wired with world B ⇒ `ModelBindingError` reason `registry-mismatch`, and nothing is subscribed (no listener was added);
  2. firing the event with `{ model }` calls `registry.unregister(model)` **and** `world.evictModel(model)` (each once, in that order) — use a real `ModelRegistry` + real `CollisionWorld` via `makeRealWorldFixture`, then assert `registry.bindingFor(key)` is `null` and `world.isModelLive(model)` is `false` afterwards;
  3. **Review Focus 5:** late unload of an OLD model after re-registering a NEW model object under the same `modelKey` does not kill the new binding (`registry.bindingFor(key).model === newModel`, still non-null);
  4. never throws: `registry.unregister` throws ⇒ `evictModel` still runs and `report('unregister', e)` fires; `world.evictModel` throws ⇒ `report('evict', e)`; a throwing `report` is swallowed; a disposed world (`world.dispose()` first) ⇒ no throw;
  5. an event with no `model` (`undefined`, `{}`, `null`) is a no-op (reported once as `report('event', …)`), never a throw;
  6. `dispose()` removes the exact listener (the fake target records add/remove pairs) and a second `dispose()` is a no-op; after dispose, firing does nothing;
  7. double unload of the same model is harmless (idempotent `evictModel`, `unregister` no-op);
  8. the handler returns `undefined` synchronously (not a Promise) — assert `handler(event) === undefined` using the fake target's captured listener.
- [ ] **Step 2: Run** → FAIL (module not found).
- [ ] **Step 3: Implement**

```js
// clashtest/viewer/unloadWiring.js
// Spec 4.3 / 16.6: `unregister` is "wired to BEFORE_MODEL_UNLOAD_EVENT, beside world.evictModel", and any such
// hook "never throws and never awaits" (an uncaught throw aborts the Viewer's teardown of every remaining model).
// The event NAME is the host's (this layer references no Viewer global). Registration stays a host call on
// engine.registry.register(...) (interface-reconciliation S-P1-1); modelKey/modelVersion derivation is OQ-1 (host).
import { assertRegistryBelongsToWorld } from '../identity/ModelRegistry.js';

const isFn = (v) => typeof v === 'function';

export function wireModelUnload({ world, registry, eventTarget, eventName, report = () => {} } = {}) {
  if (!isFn(world?.evictModel)) throw new TypeError('wireModelUnload: world.evictModel is required');
  if (!isFn(registry?.unregister)) throw new TypeError('wireModelUnload: registry.unregister is required');
  if (!isFn(eventTarget?.addEventListener) || !isFn(eventTarget?.removeEventListener)) {
    throw new TypeError('wireModelUnload: eventTarget must implement addEventListener/removeEventListener');
  }
  if (typeof eventName !== 'string' || eventName === '') throw new TypeError('wireModelUnload: eventName is required');
  assertRegistryBelongsToWorld(registry, world); // Codex I4: never split lifecycle state across two worlds (throws ModelBindingError 'registry-mismatch')

  const safeReport = (stage, error) => { try { report(stage, error); } catch { /* a host callback must never break teardown */ } };
  const handler = (event) => {
    let model;
    try { model = event?.model; } catch (e) { safeReport('event', e); return; }
    if (model === undefined || model === null) { safeReport('event', new Error('unload event carried no model')); return; }
    try { registry.unregister(model); } catch (e) { safeReport('unregister', e); }
    try { world.evictModel(model); } catch (e) { safeReport('evict', e); }
  };
  eventTarget.addEventListener(eventName, handler);
  let disposed = false;
  return Object.freeze({
    dispose() {
      if (disposed) return;
      disposed = true;
      try { eventTarget.removeEventListener(eventName, handler); } catch (e) { safeReport('dispose', e); }
    },
  });
}
```

- [ ] **Step 4: Run** — unloadWiring + scaffold + layering → PASS, then full `node scripts/run-tests.mjs` → green (checkpoint gate). (`collision/CollisionWorld.js:732-758` confirms `evictModel` is a no-op when disposed and idempotent when already evicted.)
- [ ] **Step 5: Commit** — `feat(viewer): BEFORE_MODEL_UNLOAD wiring (unregister + evictModel, never throws/awaits)`.

---

### Task 12: Entry point, READMEs, and the offline-suite gate

**Files:**
- Create: `clashtest/viewer/index.js`, `clashtest/viewer/README.md`, `test/clashtest/viewer/entry.test.mjs`
- Modify: `test/clashtest/viewer/scaffold.test.mjs` (append `'index.js'` to `EXPECTED_MODULES`, completing the list: `errors.js`, `checkpoint.js`, `readiness.js`, `treeWalk.js`, `populationScan.js`, `ViewerElementEnumerator.js`, `unloadWiring.js`, `index.js`)
- Modify: `clashtest/README.md` — **only** the adapter row currently reading "Viewer adapter … Proposed `clashtest/viewer/`; open question OQ-4" (`clashtest/README.md:72`); change it to state the adapter now exists at `clashtest/viewer/`, name the OQ-4 envelope verbatim, and link `clashtest/viewer/README.md`. No other line of that file changes.

- [ ] **Step 1: Write the failing test**

```js
// test/clashtest/viewer/entry.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as viewer from '../../../clashtest/viewer/index.js';
import * as core from '../../../clashtest/index.js';

test('entry point exports exactly the adapter surface', () => {
  assert.deepEqual(Object.keys(viewer).sort(), ['createViewerElementEnumerator', 'wireModelUnload']);
});

test('the core barrel is unchanged: it exports nothing named after the viewer layer', () => {
  assert.ok(!Object.keys(core).some((k) => /viewer/i.test(k)));
});

test('the enumerator is frozen and has exactly the port methods', () => {
  const e = viewer.createViewerElementEnumerator();
  assert.deepEqual(Object.keys(e).sort(), ['digestScope', 'resolveRoots']);
  assert.ok(Object.isFrozen(e));
});
```

- [ ] **Step 2: Run** → FAIL (no `index.js`).
- [ ] **Step 3: Implement**

```js
// clashtest/viewer/index.js
// The Viewer adapter entry point (D-V5). Deliberately NOT re-exported by clashtest/index.js: the core imports
// nothing from the Viewer (spec 2.1). Evidenced envelope only: Audubon three-discipline fixture, SVF (non-OTG),
// Autodesk Viewer 7.124.2 (OQ-4, docs/research/2026-09-26-federated-clash-test-oq4-live-evidence-check.md).
export { createViewerElementEnumerator } from './ViewerElementEnumerator.js';
export { wireModelUnload } from './unloadWiring.js';
```

`clashtest/viewer/README.md` must contain (each as a short section, no marketing): the contract (`resolveRoots`/`digestScope`, never cached, checkpoint cadence); **the OQ-4 envelope verbatim and the list of non-evidenced cases with the fail-closed behavior for each** (D-V6 text; OTG/SVF2/2D/non-Revit untested); **the owner-approved D-V6 policy** (a tree-reachable not-loaded / owner-unresolvable / out-of-range fragment fails planning for the run — conservative by owner decision, revisitable only by an explicitly authorized future design; there is no partial-planning carrier) **and the D-V9 planning bounds** (the collision library's own `maxFragmentsPerDbId` = 5,000 per requested root, `maxChildrenPerNode` = 10,000, whole-model population `maxCollisionInstancesPerEpoch` = 20,000: a planning pass that crosses one fails the run with `enumeration-failed` instead of deferring to a per-unit execution gap; node *count* is bounded by no existing limit — recorded residual); registration recipe (`engine.registry.register(modelKey, model, { modelVersion })` — host supplies both; **OQ-1: the adapter provides no derivation and no default**; a `modelKey` names one immutable version — re-translation ⇒ new key; `ModelKeyVersionConflictError` lasts for the registry's lifetime even after `unregister`); unload recipe (`wireModelUnload({ world, registry: engine.registry, eventTarget: viewer, eventName: Autodesk.Viewing.BEFORE_MODEL_UNLOAD_EVENT })` — evicted `Model` objects are permanently evicted, a reload is a new object); that a foreign registry is rejected (`registry-mismatch`); readiness caveat (G-VA-READY); and "not yet integrated into any host".

- [ ] **Step 4: Run the offline gate** — `node scripts/run-tests.mjs`
  Expected: **all green, 0 fail, 1 todo**; total = 2,848 + (tests added in Tasks 1–12); every `clashtest/viewer/*.js` import obeys the layering test; `scaffold.test.mjs` lists all eight production modules; `test/clashtest/errors.test.mjs` and `test/clashtest/options.defaults.test.mjs` unchanged and passing; no test in the new directory touched the network. Also run `git status --short` and confirm the only modified pre-existing files are `test/fixtures/mockInstanceTree.mjs` and `clashtest/README.md` (plus the handoff at completion).
- [ ] **Step 5: Commit** — `feat(viewer): entry point, adapter README, README adapter row`.

---

### Task 13: T3 live acceptance script — AUTHORED ONLY (execution is a separate owner authorization)

**Files:**
- Create: `test/acceptance/clashtest-viewer-adapter.acceptance.mjs`
- Modify: `test/acceptance/README.md` — append a short section naming the new script, its prerequisites and that it is **not** part of `npm test`.

**Constraints:** never imported by `npm test` (`scripts/run-tests.mjs` only walks `*.test.mjs`); must not modify `server.js`/`wwwroot/`. It serves `/clashtest/**` to the page with Playwright `page.route('**/clashtest/**', route => route.fulfill({ path: <repo>/clashtest/<rest>, contentType: 'text/javascript' }))`; `/collision/**` is already served by `server.js:8` (the same `page.route` serves `/clashtest/index.js` and `/clashtest/viewer/index.js`; `clashtest/` has no `node:` imports and reads only `globalThis.crypto`, so it is browser-loadable — **to be confirmed by the script's first in-page import**, not assumed). Follow `test/acceptance/clash-finder.acceptance.mjs` for structure/env/launch-args (`--no-sandbox --disable-dev-shm-usage --single-process --no-zygote`) and reuse, verbatim, the OQ-4 artifact's Appendix A fixture-loading code (three Audubon URNs; first model via URN hash, others via "Load as additional model" + Load) and readiness sampler.

- [ ] **Step 1: Author the in-page measurement** (run through `page.evaluate` after all three models are loaded), for each model with `enumerator = createViewerElementEnumerator()` imported in-page from `/clashtest/viewer/index.js`, `binding = { modelKey, model, modelVersion: 'live', lease: { epoch: 1 }, … }`, `ctx = { checkpoint() {} }`:
  - **(a) AC-15 (a)/(c) ownership & reachability:** `resolveRoots(binding,'whole',ctx)` ⇒ record `ownerMismatch.count`, `unreachable.count`, `unreachable.unattributable`, `population.count`, `roots.length`; **assert** `ownerMismatch.count === 0`, `unreachable.count === 0`, `unattributable` both 0, and that population counts equal 5,435 / 543 / 1,496 and root counts equal 4,244 / 468 / 1,257 (the OQ-4-measured values — a *regression* check inside the evidenced envelope, not a broadened claim). **D-V9:** also record `max(roots[].fragmentCount)`; a *successful* whole-model `resolveRoots` already implies every root ≤ `maxFragmentsPerDbId` (5,000), every node ≤ `maxChildrenPerNode` (10,000) and population ≤ 20,000, so a rejection with `EnumerationBoundExceededError`/`CapacityExceededError` on an Audubon model is a **finding to report** (the owner-approved fail-closed policy would then refuse that model), never something to mask or retry around.
  - **(b) enumerator ≡ library:** for every root, `extractFragments(model,[root.dbId],0,…)` size/owners equal the adapter's `fragmentCount`/`ownerDbIds`; `extractAllFragments` population digest input equals the adapter's (recompute in-page with the same rules; report mismatches, assert 0).
  - **(c) `digestScope` ≡ `resolveRoots`:** whole population digest, and per-root subtree digests for a sample of roots incl. the explicit roots `2734`/`3965` on Structure (each = 1 fragment owned by itself, per OQ-4).
  - **(d) readiness characterization (record, do not assert sufficiency — G-VA-READY):** sample `isObjectTreeCreated()`/`getData().instanceTree`/`isLoadDone()` order per model and whether an immediate `resolveRoots` right after `MODEL_ADDED` succeeds or throws `ObjectTreeUnavailableError`; print both outcomes.
  - **(e) AC-6 T3 reload arm (characterization, not asserted — cross-reload identity is not evidenced):** unload one model, reload the same URN, re-run `resolveRoots('whole')`, and **record** whether `population.digest` and per-root digests are equal before/after and whether fragment ids differ.
  - **(f) AC-12 characterization (G-CAL, never asserted):** record elapsed time and the number of `ctx.checkpoint()` calls for whole-model `resolveRoots` and `digestScope` on the largest model, with a `checkpoint` that records `performance.now()` deltas (max synchronous span vs `frameBudgetMs`).
  - **(g) PairId role-symmetry half of AC-15 (g):** *out of this script's automation* unless the owner requests it — it requires running an engine over two live models with swapped selections; list it in the script header as **not evidenced / not covered** so no reader assumes it is.
  - **(h) Production unload wiring against the REAL Viewer event (Work-review Medium 3; asserted, not merely characterized).** Runs after (a)–(g), on one Audubon model `X` (evidenced load path) and its same-URN reload. *Setup* (page context, already-loaded viewer `window.viewer`): import `/clashtest/index.js`, `/clashtest/viewer/index.js` and `/collision/index.js` (the first two served by the `page.route`); build the in-page `CollisionWorld` **exactly as `wwwroot/extensions/ClashFinderExtension.js` constructs its own** and `engine = createClashTestEngine({ world, enumerator: createViewerElementEnumerator() })`; `registry = engine.registry`; `registry.register(K, X, { modelVersion: 'live-1' })` for a fixed `modelKey` K. Wrap the eventTarget: `recorder = { addEventListener(n, f) { captured = f; viewer.addEventListener(n, f); }, removeEventListener(n, f) { viewer.removeEventListener(n, f); } }`; **install the real wiring** `wiring = wireModelUnload({ world, registry, eventTarget: recorder, eventName: Autodesk.Viewing.BEFORE_MODEL_UNLOAD_EVENT })` and, *before* it, add a raw probe listener on the same event that records `event.model === X` and `registry.bindingFor(K) !== null` at dispatch. Wrap `world.evictModel` (an instance-level shim) to record, at its call time, whether `registry.bindingFor(K)` is already `null`. *Steps, each event-driven with `waitForFunction`, never a fixed sleep:* (1) `viewer.unloadModel(X)`, then wait for `getAllModels()` to lose X; **assert** the probe saw `event.model === X` **with the binding still present** (closes the `[SILENT]` payload gap, `invariant-audit-v8-model.md:372`), the `evictModel` shim saw the binding **already `null`** (unregister ran before evict), `registry.bindingFor(K) === null`, `world.isModelLive(X) === false`; (2) **immediately after step (1) snapshot the identities of every remaining model** (`before = new Set(viewer.getAllModels())`), reload the same URN through the evidenced UI path (`#urn`/`#keep-current-models`/`#load`), and wait (event-driven) for a model that is **absent from `before`**, carries the reloaded URN/document identity and has `isLoadDone() === true` — that object, and only that object, is `Y` (an already-loaded sibling model can never be selected as `Y`; if no such model appears within the harness's load timeout the step FAILS); **assert** `Y !== X` and that `registry.register(K, Y, { modelVersion: 'live-1' })` succeeds (same key, same version, new object — the offline-proven Task 11 case 3 semantics, now live; a `ModelKeyVersionConflictError` here is a **failure of this step**, never worked around with a new key); (3) **late unload of the OLD model:** `captured({ model: X })` (the wiring's own handler, invoked directly — no dependence on an unevidenced synthetic `viewer.fireEvent`); **assert** `registry.bindingFor(K).model === Y`, `world.isModelLive(Y) === true`, and that `resolveRoots({ modelKey: K, model: Y, … }, 'whole', ctx)` still succeeds (the new model is usable, not merely registered); (4) `wiring.dispose()`, then `viewer.unloadModel(Y)`; **assert** nothing changed (`registry.bindingFor(K)` still non-null, `world.isModelLive(Y)` still true — the disposed listener no longer acts). **Cleanup (in a `finally`; safe under partial initialization; the original failure stays primary).** Every resource (h) may create is tracked in one `resources` record whose fields start as `null` and are set only once the resource really exists: `probeListener`, `evictShim` (holding the original `world.evictModel`), `wiring`, `X`, `Y`, `world`, `engine`, `registry`. Cleanup is a fixed list of steps, and **each step is (i) guarded on its own resource being non-null and (ii) run inside its own `try/catch`, so one failing step never prevents a later one**: (1) `wiring?.dispose()`; (2) remove `probeListener` from the viewer; (3) restore the original `world.evictModel` from `evictShim` — only when **both** `world` and `evictShim` are non-null; (4) unregister, as **two separate actions each in its own `try/catch`**: `registry.unregister(X)` only when `registry` and `X` are both non-null, then `registry.unregister(Y)` only when `registry` and `Y` are both non-null (`evictModel` alone does not clear a registry binding; `unregister` is a total, non-throwing no-op for an unknown or already-unregistered model); (5) evict, as **two separate actions each in its own `try/catch`**: `world.evictModel(X)` only when `world` and `X` are both non-null and `world.isModelLive(X)` is true, then the same for `Y` (never for a model that was never created — e.g. `Y` when the reload step failed or timed out; `isModelLive` throws once the world is disposed, which is why this runs before step (7)); (6) `await engine?.dispose()` (asynchronous, idempotent); (7) `world?.dispose()` (a second call rejects, so it is called once and only here). An `X` failure in step (4) or (5) therefore can never skip the `Y` action, and vice versa. **Failure reporting:** the live-test failure that triggered the `finally` (if any) is captured first and is **re-thrown as the primary error**; each cleanup failure is collected as `{ step, error }` in a separate `cleanupFailures` list and reported in the script's result record; the primary failure is **always re-thrown as the exact same value** (it may be a primitive or a non-extensible object, so attaching `cleanupFailures` to it is attempted only inside its own guarded `try/catch`, best-effort, and a failed attachment is itself recorded in the result record and never replaces the primary). When the test itself passed but any cleanup step failed, an `AggregateError` naming only the cleanup failures is thrown — a passing test with a failed cleanup is still a failed run, and a cleanup failure never replaces or masks a primary failure. **Acceptance for the cleanup itself (asserted by the script, negative-controlled like the rest of (h)):** (a) *partial initialization:* a control run that aborts before `Y` exists (e.g. the reload wait forced to time out) must finish cleanup with no exception from steps (4)/(5) about `Y`, must have removed the listener, restored `world.evictModel` and disposed engine/world, and must surface the reload timeout as the primary error; (b) *independence:* a control run where a cleanup step is forced to fail must still execute every later step (assert via step-completion flags) and report that failure in `cleanupFailures` without masking the primary. **The injected failure must not itself cause a leak:** for the listener step the injection **delegates to the real `viewer.removeEventListener` first and then throws**, so the underlying release still happens and item (c) still holds; for the other steps the injection throws from a wrapper around a call that is then still made (or is asserted as skipped only when its resource is legitimately absent); (c) *postcondition:* after cleanup no raw listener remains, `world.evictModel` is the original function, `registry.bindingFor(K)` is `null`, and the page's `getAllModels()` equals the **expected-sibling snapshot** taken right after `X` disappeared in step (1) (`before` in step (2)) — i.e. exactly the models that were never touched by (h), because `X` was unloaded in step (1) and `Y` is unloaded in step (4). For a failure path where `Y` was loaded but step (4) did not run, the only permitted delta is that one extra model `Y`, stated explicitly in the control's expectation (no other difference is tolerated). Nothing installed by (h) may survive it, so later characterization in the same page is unaffected. **Pass criteria:** every assertion above holds. **Fallback gate:** if any step cannot be executed deterministically in the accepted harness — e.g. an in-page `CollisionWorld` cannot be constructed, the reload cannot be awaited by event, or a link behaves unlike the offline model — the script must NOT paper over it: it records the exact failing link and the result stays **`LIVE_UNLOAD_INTEGRATION_UNVERIFIED`** (Gates table), which forbids calling the adapter production-ready. Stays inside the accepted OQ-4 envelope (Audubon / SVF / Viewer 7.124.2 / Chromium 151); it loads no new content, and it characterizes nothing about OTG/SVF2/2D.
- [ ] **Step 2: Author the negative controls** (restored in `finally`, as in OQ-4 Appendix A): (i) make `fragList.getDbIds(0)` return a wrong owner ⇒ adapter reports `ownerMismatch.count ≥ 1`; (ii) hide a fragment from the tree ⇒ `unreachable.count ≥ 1`; (iii) flip a tree-reachable fragment to not-loaded ⇒ `resolveRoots` rejects with `EnumerationInconsistencyError` (D-V6); (iv) stub `getObjectTree` to call `onError` on a not-ready model ⇒ `ObjectTreeUnavailableError`; (v) **D-V9:** make `fragList.getCount()` return 20,001 ⇒ `resolveRoots('whole')` rejects with `CapacityExceededError` **and no `enumNodeChildren`/`enumNodeFragments` call was made** (count the wrappers). For (h): a **negative control per assertion family** — with the wiring never installed (control run) the probe/eviction assertions of step (1) must FAIL (the binding must survive an unload), proving the (h) assertions can detect an absent wiring. The script fails if any control is not detected (a probe that cannot fail proves nothing).
- [ ] **Step 3: Static check only** — `node --check test/acceptance/clashtest-viewer-adapter.acceptance.mjs` passes and `node scripts/run-tests.mjs` total is unchanged from Task 12 (the script is not collected). **Do not run it against a live server: doing so needs credentials, Chromium and an explicit owner authorization to execute (as OQ-4 did).**
- [ ] **Step 4: Commit** — `test(acceptance): authored T3 live acceptance for the Viewer adapter (not executed; not in npm test)`.

---

## Self-review (run against the spec, 2026-09-26)

1. **Spec coverage.** §6.2 port (roots, population, `ownerMismatch`, `unreachable`+`unattributable`, `unresolved`, readiness, checkpoint contract, "topmost fragment-owning", three-answer agreement) → Tasks 3–8, 9, 10; §6.2.1 digests, conformance, 20k cost cap → 5, 6, 9; §4.3/§16.6 unload wiring → 11; §2.1 layering → 1; §21.3 offline → 12/13; AC-15 (a)–(f), AC-6 T3, AC-12 → 13 (authored); AC-15 (g) PairId half → explicitly uncovered (recorded). Gaps recorded, not silent: OQ-1, OQ-16, OQ-17, G-VA-READY, G-VA-OQ4-ENV, G-VA-AC-COVERAGE, G-VA-P5, G-VA-INTEG.
2. **Placeholder scan.** Signatures that had been left as "read this" were verified during planning and are now stated: `EnumerationCancelledError({reason})`, `CapacityExceededError(kind, details)`, `checkEnumeratorConformance({enumerator, binding, cases:{scopes:[{name,scope}]}, checkpoint?}) → {failures}`, empty-list digests. **Remaining honest gaps (for the Work review to rule on):** Task 10 (engine integration fixture wiring — entry shape `{ kind:'model', modelKey }` and `engineOver` to be mirrored from `realWorldEnvironment.test.mjs`), Task 11 (unload wiring) and Task 13 (T3 script) give **test enumerations with exact assertions and contracts rather than full test source**. **Resolved by the owner (Work-review remediation): enumerations are sufficient when each task precisely specifies fixture/setup, action, expected result, negative controls, failure conditions, cleanup and acceptance gate — full test source belongs to implementation.** Tasks 10, 11 and 13 are held to that standard (Task 10 and Task 13 step (h) were tightened in this remediation).
3. **Type consistency.** `awaitObjectTree`, `indexInstanceTree`, `walkSubtree`, `topmostFragmentOwningRoots`, `hasListedAncestor`, `scanPopulation`, `digestSlicer`, `subtreeRecords`, `rootRecord`, `claimFragments`, `createViewerElementEnumerator`, `wireModelUnload` are named identically at every use. `records[fragId]` is dense (Task 5) and indexed by `fragId` in Task 8. `first20` ascending by `fragId` in Task 8 tests and code.
4. **Review Focus.** Each of the fourteen items maps to a named task test (see the list above).
5. **Work-review remediation (High 1–3, Medium 1–3, Low 1) — where each landed.** *High 1 (bounded planning):* D-V4/D-V9 rewritten; Global Constraints 5 and 12; Task 4 (`indexNodeParents`, budgeted `indexInstanceTree`, bounded `walkSubtree`, `EnumerationBoundExceededError`, RED→GREEN bound tests incl. exact-at-limit and no-retained-state), Task 5 (count gate role), Tasks 6/7/8 (explicit and whole-model bounds, zero-tree-read on over-population, order of work), Task 10 (engine-level `enumeration-failed`), Task 13 (v). *High 2 (green commits):* Global Constraint 11; Task 1 layering test no longer asserts presence, Task 3 adds `scaffold.test.mjs`, every task step 4 carries the full-suite gate. *High 3 (D-V6):* D-V6 rewritten as an owner-approved policy; Tasks 8 and 10 pin N / U-undefined / U-array / out-of-range, determinism and "no partial answer"; the "owner may revisit" wording is removed. *Medium 1:* Task 10 signatures corrected against current source (`completed`, `validateResultSet(set, { limits: ENGINE_LIMIT_DEFAULTS })`, ledger/provenance field paths, fixture `fragments` option, brute-force arguments). *Medium 2:* Task 6 explicit-scope prose now matches D-V4 (ids-only parent pass + bounded root walks). *Medium 3:* Task 13 step (h) and gate `LIVE_UNLOAD_INTEGRATION_UNVERIFIED`. *Low:* Task 1's failing-test miscount removed with the red-scaffold state itself. *Found while remediating:* the original Task 4 fixture assertion `idx.nodes.size === 8` was wrong (the sample tree has 7 nodes) — corrected.
6. **Honest limits of this remediation.** The plan's snippets remain **un-executed** (implementation is unauthorized); mock counters/limit comparators used by the new bound tests were checked against `test/fixtures/mockInstanceTree.mjs` and `collision/viewer/ViewerModelAdapter.js` by reading, not by running. Whether the real Viewer aborts `enumNodeChildren` on the library's literal `true` is documented in the milestone-1 design (confirmed there against the pinned 7.124.2 bundle) but not re-observed here; the T3 script exercises it live. Node count remains bounded by no existing limit (D-V9 residual). Deferred items (P5 status readers, docs reconciliation, AC-19 / AC-17(d) conjuncts, OQ-1, remote persistence, annotation, new public limits, M4 Phase 4, Viewer Clash Panel/UI) are untouched and are not prerequisites.

## Authorization boundary (verbatim from the owner's instruction)

Authorized: planning only, on a new branch from current `main`. **Not authorized:** implementing any production Viewer Adapter code; host integration; reopening accepted Core Engine behavior or M4; treating OQ-4 beyond the verified Audubon / SVF / Viewer 7.124.2 envelope. This plan stops here for **independent Work review before implementation**; implementation begins only on the owner's explicit authorization of this plan.
