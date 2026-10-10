# Viewer Clash Panel — Design Spec

Status: **DESIGN SPEC — OWNER-ACCEPTED (design gate only, 2026-09-26); not an implementation plan.** No code, tests, or public contract is changed by this document. The independent Work design review returned *revise before owner acceptance* (0 Critical / 2 High / 1 Medium / 1 Low); this revision remediates H1 (markers-only emphasis), H2 (fail-closed common measurement basis for Soft), M1 (registration is host composition) and L1, and makes the v1 UX structure normative (§14). A targeted internal check of the changed areas is recorded in §22. The bounded independent Work re-review returned *ready for owner acceptance* (0 Critical / 0 High / 0 Medium / 2 Low documentation findings, since corrected), and the owner accepted the design. **Acceptance closes the design gate only and authorizes nothing further.** Implementation planning, implementation, an implementation plan, a Panel branch, SVF2 live verification, host integration and OQ-1 work are **not authorized**.

Authorization: owner prompt `docs/prompts/viewer-clash-panel-planning-authorization-prompt.md` — *"Viewer Clash Panel planning/design only … This authorization does not include implementation."*

Source of truth: the repository at `main` = `origin/main` = `255dcca` (working tree: documentation only — this spec, the research artifact, the internal, independent and bounded re-review records, the authorization prompt, and the handoff edit; all uncommitted) — not conversational summaries. Every claim below about landed behavior was read from code, the frozen spec, or a persisted review/research record; where code and frozen-spec text disagree, **code is treated as authoritative** and the disagreement is recorded in §19.

Governing inputs (all read for this spec):

- Frozen Core spec: `docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md` — esp. §4 (identity), §5 (definition), §8–§10 (outcome/progress/cancel), §11–§15 (results/status/derivations), §16 (freshness/unload), §17 (limits), §20 (**what the Panel owns**), §23 (non-goals), §24 (open questions).
- Core code: `clashtest/index.js`, `engine.js`, `options.js`, `definition/validate.js`, `run/Run.js`, `results/*`, `derive/*`, `identity/*`; `clashtest/README.md`.
- Viewer Adapter: `clashtest/viewer/*`, `clashtest/viewer/README.md`; plan `docs/superpowers/plans/2026-09-26-federated-clash-test-viewer-adapter-implementation.md`; independent implementation review and T3 independent verification under `docs/reviews/`; T3 record `docs/research/2026-09-26-federated-clash-test-viewer-adapter-t3-live-acceptance.md`; OQ-4 record.
- Existing Viewer-side code: `wwwroot/extensions/ClashFinderExtension.js`, `RoomLocatorExtension.js`, `wwwroot/viewer.js`, `server.js`, `test/` layout.
- Handoff: `docs/handoffs/latest.md`; project `CLAUDE.md` (authorization, review-boundary and adjudication rules).
- Independent Work design review (a review *claim*, adjudicated per finding): `docs/reviews/2026-09-26-viewer-clash-panel-design-independent-review.md` — its H1/H2/M1/L1 are remediated in this revision (§9, §6, §5, §0).
- Supporting evidence for this design: `docs/research/2026-09-26-viewer-clash-panel-viewer-api-evidence.md` (Viewer API claims against the pinned 7.124.2 bundle; **read §16 for how far it is relied on**).

UX reference: the owner's previously discussed Clash Detection panel screenshot is the **UX reference for the v1 information architecture (§14), not an architecture or runtime reference**. The image is **not archived in the repository**; the only recorded description is the concept list in the authorization prompt (lines 68–96), which this spec uses as its input. No WASM assumption, no CPU/RAM/heap telemetry, and no reference-sample contract is imported (§4 non-goals).

---

## 0. Decision summary and answers to the nine architecture questions

**One-paragraph design.** A new Panel layer, `clashpanel/`, sits **above** `clashtest/` and `clashtest/viewer/` and consumes them only through their public entry points. It has three parts: a headless, Node-testable **Panel core** (draft-definition mapping, run controller, result index, filtering, grouping, paging, wording), a small **ViewerBridge** (the only code that mutates the Viewer; it owns a single restorable "visualization session"), and a thin **DOM/DockingPanel view**. The Panel adds no collision logic, no identity, and no persistence. Filtering is Panel-side presentation over the sealed, frozen `results[]`; Group-by-Element reuses Core's `element` facet once per run and intersects it with the filter as a mask; large sets use bounded pagination over an index-based ordered list; results are browsable only **after** the run seals (Core exposes only a running count). Staleness is decided by **binding generation and version recorded in provenance**, not by digests, so the reload-digest discrepancy and OQ-1 do not block the design or the build — OQ-1 blocks **integration acceptance** only.

| # | Question (prompt §"Architecture questions") | Answer | Basis |
|---|---|---|---|
| Q1 | Minimum Panel API surface over Core + Adapter? | Core: `validateTest`, `startRun` + `RunHandle{getSnapshot,subscribe,cancel,done}`, `retainResultSet`/`releaseResultSet`, `getPersistenceState` (and `RunHandle.persisted`), `getFreshness`, `assessNoClashClaim`, `derivations.{summarize,groupBy,filter}`, and **read-only** `registry.bindingFor`. The Panel core never calls `registry.register`; registration, model-identity derivation, `wireModelUnload` wiring, re-registration after reload and placement invalidation are **host composition** (OQ-1; §5.1). Adapter: `createViewerElementEnumerator` and `wireModelUnload` are used by host composition only. Three Panel-core ports: `ModelCatalog` (host-supplied, read-only), `ViewerBridge`, `EnginePort` (a structural subset of the engine). Full list §5. | §5, digests A/B |
| Q2 | Which Viewer Adapter capabilities are sufficient as-is? | All of them, for what they do: enumeration for planning, and unload → unregister + evict. `registry.bindingFor(modelKey)` is sufficient for identity → live model resolution (null = unavailable). **Qualification:** sufficiency is by design and by SVF non-OTG evidence only; the v1 target is SVF2, for which the Adapter is untested (§2.1, PG-4). | Adapter README; ModelRegistry; §2.1 |
| Q3 | Does the Panel require Viewer Adapter additions? | **No adapter extension is required.** Focus/isolate/marker/restore need `Autodesk`/DOM/`THREE` globals, which the adapter's layering guard forbids in `clashtest/viewer/`; they belong in the Panel-layer ViewerBridge (a **new** layer, not an adapter change). Two optional, non-required adapter-adjacent items are recorded as deferred (§18): a registry change notification, and the stale "live acceptance pending" README wording. No Adapter extension is *proposed*; whether SVF2 verification (PG-4) later reveals an Adapter defect is an open, unassessed possibility and is not pre-judged here. | §5.3, §8, §2.1 |
| Q4 | Is OQ-1 / reload identity a real prerequisite for the first Panel version? | **Not for design or for building/headless-testing** (the Panel takes model identity from an injected `ModelCatalog`). **Yes for integration acceptance** (SPEC §24 OQ-1). The reload-digest discrepancy is **not** a prerequisite: no required Panel interaction depends on cross-reload identity, because the Panel never resolves results across a reload (§11). | §11, §17 |
| Q5 | Is Group by Element presentation-only with current identity? | **Yes.** Core's built-in multi-valued `element` facet already supplies the grouping key, group ids, counts and canonical ordering; the Panel adds only presentation (mask by filter, sort by count, expand/collapse). No new domain support. Roll-up to parent/assembly/level/category **is** unsupported (SPEC §23 item 8; annotation layer excluded) and is deferred. | §10 |
| Q6 | Pagination or virtualization for v1? | **Pagination** (recommended) over an index-based ordered list, page size a presentation constant. Alternative recorded: virtualization (OD-2). | §12 |
| Q7 | Browse results during a running test? | **No.** Core seals results once at the terminal transition; during a run only the `resultsFound` counter exists. Alternative (a new Core partial-snapshot API) is out of scope and recorded (OD-3). | §7.4 |
| Q8 | What Viewer state is restored on close / Back to All? | Panel-owned isolation and Panel-owned markers/overlays are restored/removed (v1 uses **no Viewer theming**, §9.2); the user's selection is never touched; the camera is **not** moved by restore. Restore is ownership-guarded and skips isolation if it was changed externally. §9.6 has the per-trigger table. | §9 |
| Q9 | What is explicitly deferred from v1? | §18. Headlines (category/level/model-pair grouping is no longer deferred — see §25): containment/surface-intersection modes, persistence/saved tests, annotation layer, workflow status, partial browse, virtualization, cross-reload resume, camera restore, ETA/telemetry, multi-test suites, Clash-Finder migration. **Superseded in part by §26 (2026-10-10):** a session-scoped Clash Tests manager (several tests, one active) is now specified; persisted/saved tests, run history and suites remain deferred. | §18 |

Owner decisions are collected in §17 (OD-1 … OD-14). Where an owner decision has not been made, the spec states the recommendation and what it is conditional on; it does not silently resolve product ambiguity.

---

## 1. Purpose, scope and success criteria

**Intended outcome.** A Viewer-facing Clash Detection Panel that makes the completed Federated Clash Test Core + Viewer Adapter usable as one coherent workflow:

> configure test → run/stop → inspect progress/results → navigate clashes → filter/group results → focus/isolate/highlight (highlight = Panel-owned markers, PD-16) → restore Viewer state

**In scope (design only):** the Panel's information architecture, its contracts with Core and the Viewer (via a new Panel-layer bridge), state ownership, failure/stale UX, filtering/grouping/paging strategy, module layering, verification strategy, and owner decisions.

**Success criteria for this artifact:** (a) every Panel control is mapped to an existing Core field or API, or explicitly marked deferred; (b) every UI state is mapped to a real Core run/result contract; (c) no Core, Adapter or M4 change is required; (d) every ambiguous product decision is an explicit owner decision with a recommendation; (e) nothing outside the authorization is started.

**Model format constraint (owner direction, corrected 2026-09-26).** Viewer Clash Panel **v1 targets SVF2-loaded models** (Viewer term: OTG; `model.isOTG()` is true for SVF2 and false for SVF — the historical evidence records `isOTG: false` as "SVF, not SVF2"). SVF2 is the **required model-loading path for v1**. The Panel exposes **no model-format selector**, and plain SVF is **not** the v1 path. Loading is a host-composition duty (PR-HOST). **SVF and SVF2 are not treated as equivalent evidence:** the completed Viewer Adapter live evidence covers **SVF non-OTG only** (see §2.1 for the exact limitation and the resulting verification gap, PG-4). An earlier revision of this document briefly stated SVF as the required path; that was a misunderstanding of the owner's direction and is superseded by this paragraph.

**Not in scope:** anything on the prompt's "Do not" list (Panel production code, a Panel branch, implementation tasks, Adapter/Core/M4 changes, the frozen-Core lease-dead discrepancy, duplicate `owner-mapping-mismatch`, the four walk-helper checkpoints, OQ-1/host integration, the reload-digest investigation, remote persistence/annotation, new public resource limits). Where planning shows one of these is a prerequisite it is recorded as a **dependency/decision** (§17), not implemented.

---

## 2. Facts the design relies on (verified against the repository)

These are load-bearing; each was read from code or a recorded artifact. Doc/code disagreements are in §19.

**Core input.** Definition is closed: `schemaVersion=1, testId, revision, name, description?, selectionA, selectionB, mode, clearance?` (`clashtest/definition/validate.js`). `mode` ∈ `volume-overlap | surface-intersection | containment | clearance`; `clearance` is required iff `mode==='clearance'`, finite > 0, unit-less "world units", **no engine default**. A selection is `{entries:[{kind:'model',modelKey}|{kind:'elements',modelKey,dbIds[]}]}`; `model` entries are enumerated dynamically at run start; a selected dbId selects its subtree. No tolerance, `groupBy`, or run option is a definition field.

**Core run.** `engine.startRun(definition|ref, runOptions?)` returns a `RunHandle{runId,getSnapshot,subscribe,cancel,done,persisted}` synchronously (throws on bad input); `done` resolves once at every terminal status and never rejects with a `RunSummary{runId,status,resultSet,persistence}`. Statuses: `queued, planning, running, cancelling` → terminal `completed, cancelled, failed, invalidated`. Partiality is the **coverage** axis (`full|partial`), not a status; integrity is `clean|caveated`; freshness is `current|stale|unverifiable`. One run is active per world; others queue FIFO within `maxResidentResultSets` (default 4). Cancel is cooperative at unit boundaries and keeps the drained unit's results.

**Core results.** A sealed, deep-frozen, plain-data `ResultSet`; `results[]` in strict canonical PairId order. Each `ClashResult` is closed: `{resultId, pair:{first,second}, mode, evaluatedAs, evidence, flags, unitId}`; `ElementRef = {modelKey, dbId}` — **no name, guid, category, or model name anywhere in a Result Set**, and `provenance.models[]` carries no display name. Evidence: `volume-overlap` → `{witness:{kind,point}|null}`; `clearance` → `{distance, clearance, closestPoints:{first,second}}`; `containment`/`surface-intersection` → `{}` (no location, no magnitude). There is **no penetration depth, overlap volume, bounds, severity, or unit label**. Results are sorted by PairId only; there is no result-level sort/page/`getResult` API.

**Core derivations** (`engine.derivations`): pure, async, abortable, client-side; every call re-captures the whole set (O(results)); at most 2 concurrent (a third rejects `DerivationBusyError` immediately). `filter` is a conjunction over the facet catalog and returns `resultId`s only; raw distance, flags, unitId, free text, OR and pair-status verdicts (other than `caveated`) are **not** filterable in Core. `groupBy` takes 1–4 facets and returns groups with `count` and (last level) `members`; groups are value-ordered, never count-ordered; `element` is multi-valued (a result appears under both of its elements; counts do not sum). `summarize` returns the header data a Panel needs.

**Viewer Adapter / registry.** `clashtest/viewer/index.js` exports exactly `createViewerElementEnumerator` and `wireModelUnload`; it mutates nothing in the Viewer and contains **no** identity→Viewer resolution and **no** focus/isolate/theming/restore helpers, and a layering guard forbids `Autodesk`/`Viewing`/`window`/`document`/`THREE` in that directory. `ModelRegistry.bindingFor(modelKey)` returns `{modelKey, model, modelVersion, lease, bindingGeneration, placementGeneration}` or **`null`** for unknown/dead/lease-invalid keys (stale and never-registered are indistinguishable); the registry has no events, only a `registryRevision` counter. Registration (`register(key, model, {modelVersion})`) is a **host call**; the registry derives nothing (OQ-1).

**Existing Viewer code.** No DockingPanel, toolbar, DOM panel, `setThemingColor`, `clearThemingColors`, `select`, or `setAggregateSelection` exists anywhere in the repo. `ClashFinderExtension` demonstrates: single `setAggregateIsolation` reconcile (full replace; resets all isolation including Room Locator's), per-model `fitToView(ids, model)`, overlay-scene witness markers on `window.THREE` r71, action-token staleness guards, whole-visualization clear on any model unload, nested-`finally` teardown. These are private methods, not importable helpers. No bundler (plain ES modules + import map); `server.js` serves `wwwroot` and `/collision` but **not** `/clashtest`; tests are headless Node fakes with no fake Viewer/DOM.

**Evidence base for sizing.** **No engine result counts on live content exist** (T3 ran no engine test; `test/acceptance/clash-test.acceptance.mjs` does not exist). Only the provisional design cap `maxResultsPerRun=100,000` (ceiling 956,824) bounds the count. Enumerator timings on the largest fixture model are 35 ms (`resolveRoots`) and 8.5 ms (`digestScope`); no planning-latency, run-duration or memory figure exists. The engine as a whole has been verified only with fakes/scripted executors, not end-to-end over a real `CollisionWorld` (`clashtest/README.md` "Verification status").

### 2.1 Model-format evidence gap — v1 targets SVF2; the completed evidence is SVF non-OTG only

**Historical limitation (recorded as-is; those artifacts are not rewritten).** The Viewer Adapter's live evidence — the OQ-4 check and the T3 acceptance (PASS 86/86) — was obtained in the envelope **Audubon three-discipline fixture / SVF non-OTG / Viewer 7.124.2 / Chromium 151**; T3's `[env]` gate asserted `isOTG === false` for every model, and OQ-4 states "SVF, not SVF2". `clashtest/viewer/README.md` states for OTG/SVF2: *"Untested; no behavior is claimed."* Consequently **no completed Adapter evidence establishes SVF2 behavior**, and this design does not claim it.

**What the v1 SVF2 requirement therefore leaves unverified.** Each item below is an assumption the design (or the Adapter it consumes) makes that has been evidenced only under SVF non-OTG, or not at all; none is asserted to fail under SVF2 — they are **unverified**:

| # | Assumption | Where it lives | Evidence today |
|---|---|---|---|
| F1 | Fragment → owner mapping: `fragList.getDbIds(fragId)` returns a plain number per fragment, and the object-tree owner agrees with it (`ownerMismatch === 0`) | Adapter (`populationScan.js`, `ViewerElementEnumerator.js`), `collision/viewer/ViewerModelAdapter.js` (its comment says "a plain number for a standard 3D/OTG load" — a code comment, not live evidence) | OQ-4 (a): 0 of 7,474 fragments mismatched — **SVF only** |
| F2 | Tree-reachable population equals the fragment population; whole-model roots (topmost fragment-owning nodes, D-V3); no unreachable/mixed-owner content | Adapter D-V3/D-V6 | OQ-4 (c) — **SVF only** |
| F3 | Readiness order: object tree available (`getData().instanceTree`, `isObjectTreeCreated()`, `OBJECT_TREE_CREATED_EVENT`) before `isLoadDone()`; not-loaded (`isNotLoaded`) fragments absent once loaded | Adapter readiness wait (D-V2), whole-model fail-closed planning (D-V6) | observed on SVF fixture only; "not a general gate" |
| F4 | Per-fragment reads used by the collision layer and adapter (`getGeometryId`, world matrix/bounds, `viewer.impl.getRenderProxy(model, fragId)`, geometry buffer layout) | `collision/viewer/*`, `CollisionWorld` | not shown for SVF2 by any artifact read for this design; whether earlier Collision Library milestones covered SVF2 live was **not established** here |
| F5 | Population and per-`dbId` fragment counts stay within the existing bounds (`maxCollisionInstancesPerEpoch` 20,000, `maxFragmentsPerDbId` 5,000, `maxChildrenPerNode` 10,000) | Adapter D-V9, Core limits | measured on the SVF fixture only (5,435 / 543 / 1,496 fragments) |
| F6 | Unload wiring, and the same-URN reload behavior (unexplained digest drift observed under SVF) | `wireModelUnload`, Panel §11 | T3 (h), SVF only |
| F7 | Viewer API behaviors relied on by the Panel's ViewerBridge (aggregate isolation, `fitToView` union bounds, element bounds for outlines, the overlay scene, object-tree `getNodeName`, unit scales) — including which visibility implementation branch (`FragmentList` vs Scene-API `InstanceCollection3D`) an SVF2 model takes. Theming is **not** relied on in v1 (PD-16) | research artifact §2–§4 | source-observed; the OTG/SVF2-specific branches were **not examined** |
| F8 | dbId identity across `fragList.getDbIds`, the object tree, and the isolate/fit/name/bounds APIs (the id space Core results carry vs the id space Viewer calls consume) for SVF2 models | ResultIndex → ViewerBridge (§9.1) | not evidenced for SVF2 |

**Resulting verification gap (PG-4).** SVF2 verification of F1–F8 has not been done. The Adapter's own fail-closed checks (readiness, D-V6, D-V9 bounds) mean an SVF2 inconsistency would surface as planning failure `enumeration-failed`, not as a wrong answer — but that is a design property of the Adapter, not evidence of SVF2 support. **When the gap must be closed — RQ-1, adjudicated by the independent Work review: option (b).** Bounded SVF2 verification of F1–F8 is required **before Viewer integration / live acceptance**, and **not** before model-format-agnostic / headless Panel implementation (the Panel core consumes sealed plain data, injected ports and fakeable ViewerBridge outcomes; none exposes SVF/SVF2 representation, and the Adapter/Core fail closed on inconsistent enumeration). Package-scoped: F1–F6 gate live Adapter/Collision/lifecycle work (host registration/composition, real Adapter + `CollisionWorld` over SVF2 content); F7–F8 gate the live ViewerBridge and dbId identity handoff; live acceptance and any "v1 supports SVF2" claim wait for it. This is a gate classification, not a new owner decision, and it does not authorize the verification task itself (a separate, not-yet-authorized activity). **Why this is safe:** the Panel core is model-format-agnostic by construction (it consumes only the Core result/identity contracts, the injected `ModelCatalog` and the ViewerBridge), so the *headless* design and its acceptance criteria AC-P1…P21 do not depend on the outcome; F1–F8 bear on the Adapter's enumeration under SVF2 and on the ViewerBridge's live behavior — the integration side, not the headless side.

---

## 3. Design decisions (PD-n)

| ID | Decision | Rationale (short) |
|---|---|---|
| PD-1 | The Panel is a **new layer above** `clashtest/` and `clashtest/viewer/`; it consumes only their public barrels and adds no collision logic. | Prompt: "must not reimplement collision logic … or Viewer integration primitives"; SPEC §2.1/§20. |
| PD-2 | Panel = **headless core + ViewerBridge + thin view**; only the view and the host shell touch DOM/`Autodesk`. | Existing test style is headless Node with fakes and no jsdom; keeps ~all behavior unit-testable. |
| PD-3 | v1 offers **two modes**: Hard (`volume-overlap`) and Soft (`clearance`). `containment`/`surface-intersection` are deferred. | They are time-sensitive (SPEC §15.1, OQ-12) and `containment` hits the open P5 ordered-pair status-reader decision. |
| PD-4 | All filtering is **Panel-side over `results[]`**. No Core derivation call happens *per interaction*; Core `groupBy`/`filter` are used only to build masks **once per (run, spec)**, cached, abortable. | Core filter lacks raw distance/flags/text/OR; each call re-captures the set and can return `DerivationBusyError`. |
| PD-5 | Group-by-Element calls Core `groupBy(['element'])` **once per (run, grouping spec)** and applies the active filter as a **mask** over `members`. | Reuses canonical group ids/ordering; avoids per-keystroke O(n) re-capture. |
| PD-6 | Large sets use **pagination over an index-based ordered list**; navigation is by index into the full ordered list, not by page. | Bounded DOM, simple selected-outside-page rule; UI can move to virtualization later without changing the view-model. |
| PD-7 | **Results are browsable only after seal.** During a run: progress + `resultsFound` only. | No Core API exposes partial results (§7.4). |
| PD-8 | Result **selection identity is `resultId`**; the Panel never builds PairId/ResultId/GroupId and never treats a list ordinal as durable. | SPEC §20 / prompt: do not derive durable identity Core already provides. |
| PD-9 | Pairs are displayed as **Element 1 ↔ Element 2** in Core's canonical order, not as "source ↔ target". | PairId is role-symmetric; only `evaluatedAs` exposes orientation and it is a library detail (SPEC §4.4, §11.1). |
| PD-10 | Staleness/liveness is decided from **provenance generations/versions + `bindingFor`**, never by assuming cross-reload identity. | Prompt: "Do not silently assume cross-reload identity stability." |
| PD-11 | One **VisualizationSession** owned by the ViewerBridge holds everything the Panel changed in the Viewer; restore is **ownership-guarded**. | Avoid stale visualization; Clash Finder/Room Locator also write isolation (§9.4). |
| PD-12 | The Panel **never presents a bare "No clashes"**; empty and partial outcomes use `assessNoClashClaim` + the wording matrix (§7.5). | SPEC §8.3, §12.5, §20; OQ-16 default is fail-closed. |
| PD-13 | The Panel makes **no ETA, throughput or responsiveness claim**; only fractions and counts from `RunProgress`. | SPEC §9.2.3, §17.4; G-CAL/G-RESP. |
| PD-15 | **SVF2 is the required model-loading path for v1.** The Panel has no format selector; SVF is not the v1 path; gates that depend on model format assume and verify **SVF2**, and existing SVF non-OTG evidence is never cited as SVF2 evidence. | Owner direction (§1); evidence gap in §2.1 / PG-4. |
| PD-16 | **Markers-only clash emphasis in v1.** The Panel does not use Viewer theming colors; emphasis is by Panel-owned overlay markers/outlines plus fit and (guarded) isolate. Exclusive-theming is deferred. | Independent review H1: the Viewer has no supported per-node theming readback, so foreign theming cannot be preserved or rolled back (§9.2, OD-5). |
| PD-17 | **Soft (clearance) fails closed unless a verified common measurement basis exists** for every participating model; otherwise Soft is unavailable for that test and Hard stays available. **(Amended by the owner decision of 2026-10-07, §23: "unavailable" is replaced by "needs a user-supplied basis"; a user-supplied or raw basis is never labelled verified; `verified` remains reserved for a host-verified verdict or a single model.)** Unit *display* is decided only after this. | Independent review H2: `clearance` is one numeric threshold compared with raw world-space numbers; label conversion cannot make an unverified basis valid (§6.2, OD-13). |
| PD-18 | **Registration is host composition, not Panel core.** The core reads `registry.bindingFor` only; it never registers, derives model identity, wires unload, re-registers after reload or repairs a binding. | Independent review M1; SPEC §24 OQ-1 (§5.1, §11.1). |
| PD-19 | **`Autodesk.Viewing.UI.DockingPanel` is the v1 shell** and a thin presentation layer only; workflow/domain state lives in the headless controller and Viewer mutations only in the ViewerBridge. No custom floating-window system. | Owner direction (§14). |
| PD-14 | **No new public resource limit** is introduced. Page size, debounce and cache sizes are named *presentation constants* (§12.4), provisional and uncalibrated. | Prompt: "invent new public resource limits" is forbidden. |

---

## 4. Non-goals inherited from this authorization and reference

- No WASM assumption; no CPU/RAM/heap/runtime telemetry (no independently justified product requirement was found — the only useful runtime signals are Core's own progress fields and elapsed time).
- No full ACC/Model-Coordination clone: no issue/approval/assignment workflow (SPEC §23 item 2), no saved views, no suites/scheduling.
- The reference's controls are used only as the concept list in §5 of the prompt; each is mapped or deferred in §6 and §10.

---

## 5. Architecture

### 5.1 Layers and modules

```
host shell (wwwroot/extensions/ClashPanelExtension.js)      DOM + Autodesk allowed
  └── clashpanel/ui/         DockingPanel + DOM view        DOM + Autodesk allowed
  └── clashpanel/viewer/     ViewerBridge                   injected `viewerApi` + `THREE`; no direct globals
  └── clashpanel/core/       controller, view-models        NO Autodesk / window / document / THREE
        │   imports only: clashtest/index.js (public barrel) + siblings
        ▼
clashtest/  (engine, results, derive, identity)             frozen
clashtest/viewer/  (enumerator, wireModelUnload)            frozen
```

Rules to be enforced by a layering guard test in the implementation phase (mirroring `test/clashtest/viewer/support/layering.mjs`): `clashpanel/core` imports nothing outside `clashtest/index.js` and siblings and contains no `Autodesk|Viewing|window|document|globalThis.THREE`; `clashpanel/viewer` receives the Viewer and `THREE` by injection; nothing under `clashtest/` or `collision/` may import `clashpanel/`; `clashpanel/` never imports `clashtest` internals or `collision/` directly (the host builds the world/engine/enumerator and injects the engine).

**Location is an owner decision (OD-1).** Recommended: top-level `clashpanel/`, because it lets `clashpanel/core` be layer-guarded and Node-tested independent of `wwwroot/`, and it does not touch the frozen layers. Alternative: place everything under `wwwroot/` (the existing home of Viewer/DOM code); rejected as recommendation because it cannot be guard-tested for "no globals" and mixes headless logic with browser-only code.

**Host composition is *not* designed away, and it is not Panel core.** Something must build `CollisionWorld.fromViewer`, `createViewerElementEnumerator`, `createClashTestEngine`, call `wireModelUnload`, register models, serve `/clashtest` and `/clashpanel` statically (today `server.js` serves only `wwwroot` and `/collision`), and register the extension in `wwwroot/viewer.js`. That is **host integration**; per the authorization it is a recorded dependency (§17, PR-HOST), not started here.

**Host-composition boundary (normative; independent review M1).** The following are owned by host composition / OQ-1, **never** by `clashpanel/core` or the ViewerBridge:

| Host-composition duty | Panel core's relationship |
|---|---|
| Loading models (as SVF2, §1) and deciding `modelKey` / `modelVersion` for each loaded model (OQ-1) | consumes them only through the `ModelCatalog` view and `registry.bindingFor`; derives neither |
| `registry.register(...)` for each model, and **re-registration after a reload** | never calls `register`; the port does not expose it (§5.2) |
| `wireModelUnload` (unregister + evict on `BEFORE_MODEL_UNLOAD_EVENT`) | never unregisters or evicts; the Panel's own unload listener only refreshes liveness and clears Panel visualization (§11.2) |
| `invalidateModelPlacement` when a model moves (PR-OQ17) | not on the Panel port; freshness merely reports the outcome |
| Supplying the measurement-basis verdict for Soft runs (PR-BASIS, §6.2) | consumes the verdict; never computes or repairs it |

If a binding is **absent or stale** the Panel *handles that state* (Run disabled with "Model *X* is not registered", rows marked unavailable, §9.1/§11.2) but does **not** create, repair or refresh the binding. Frozen SPEC §20 lists "model→`modelKey` derivation policy" among things "the Panel owns"; this design reads that as the **host-composition side of the Panel product** (the shell that also owns OQ-1), not the headless core.

### 5.2 Ports consumed by the Panel core

```
EnginePort            structural subset of the engine (injected by the host):
  validateTest(def) -> {issues[{path,code,message}], issuesTruncated}
  startRun(def, runOptions?) -> RunHandle     // throws InvalidTestDefinitionError | ResultCapacityError | ...
  retainResultSet(runId) -> lease{release()}   // one-shot lease; throws UnsavedResultSetError unless persistence is 'saved'
  releaseResultSet(runId, {acknowledgeUnsaved?})  // throws ResultSetRetainedError while a lease is outstanding
  getPersistenceState(runId)
  getFreshness(runId|set, {signal?}) / assessNoClashClaim(runId|set, {signal?})   // async; by-id reads a resident set non-touchingly
  derivations.summarize(set,{signal}) / derivations.groupBy(set, facets, {signal}) / derivations.filter(set, clauses, {signal})
  registry.bindingFor(key) -> {modelKey, model, modelVersion, bindingGeneration, ...} | null   // READ-ONLY
  // NOT on this port (host composition, §5.1): registry.register, wireModelUnload,
  // invalidateModelPlacement, model-identity derivation, re-registration after reload.

ModelCatalog          READ-ONLY view supplied by host composition (§5.1):
  list() -> [{modelKey|null, displayName, model, loaded}]            // models currently in the Viewer; modelKey null = host has not identified/registered it
  onChange(cb) -> unsubscribe                                        // model added/removed
  // onChange fires on model add/remove AND on readiness (isLoadDone / object-tree) changes.
  // Holds a WeakMap<Model, modelKey> and a modelKey -> displayName map that OUTLIVES unload,
  // so rows for unloaded models still show a name. modelKey/modelVersion DERIVATION is OQ-1 (host composition), never Panel core.
  measurementBasis(modelKeys) -> BasisVerdict                        // §6.2; host-supplied evidence, consumed not computed
  // BasisVerdict = {state:'verified', basisKey} | {state:'unverified'|'incompatible', reason}.
  // A missing method, a throw, a timeout or any other shape is treated as 'unverified' (fail closed).

ViewerBridge          Panel-owned; only code that mutates the Viewer (§9)
Scheduler             injected timers/yield (debounce, chunked list building) — testability
```

Structural subset means a fake engine in headless tests satisfies the same interface; the real engine satisfies it unchanged.

`EnginePort` deliberately exposes **no effective engine limits**: the public engine object has none (methods, `registry`, `derivations`, `dispose` only), and the host may configure lower limits than the exported defaults. The Panel therefore performs **no numeric pre-check** against any engine limit and never imports `ENGINE_LIMIT_DEFAULTS`/`RUN_OPTION_DEFAULTS` as if they were the effective values; it relies exclusively on `validateTest` issue codes and on typed errors (`GroupingTooLargeError{limit,observed}`, `ResultCapacityError`, …), and reads a *run-recorded* value (e.g. `provenance.runOptions.maxResultsPerRun`) only for wording about a finished run.

**Controller generation (async supersession).** The controller holds one monotonically increasing *generation* per displayed run (incremented by Run, "Clear results", New test, a §26 active-test switch, and dispose). Every asynchronous completion — `handle.done`, `summarize`, `groupBy`, the `caveated` mask, `getFreshness`, `assessNoClashClaim`, label-index passes, model-catalog refreshes — captures the generation at issue time and **commits only if it still matches**; otherwise the result is dropped. Supersession also aborts supported work (`signal`) and unsubscribes the old run's listeners. A late `done` from a superseded run is ignored except for releasing that run's set (§7.6). Viewer presentation uses its own token scheme (§9.2) which is also invalidated by generation change.

**Derivation scheduling.** Core allows at most `maxConcurrentDerivations` (default 2, not readable, §5.2) derivations in flight per engine and rejects the excess immediately with `DerivationBusyError`. The Panel therefore runs its Core derivations (`summarize`, `groupBy`, the `caveated` filter) through a **single-flight sequential queue owned by the controller** (one in flight at a time, in priority order: `summarize`, then the mask/grouping the current view needs). A `DerivationBusyError` from another consumer sharing the engine is treated as "retry later" (bounded, backed off), never as a failure of the run; a superseded generation aborts its queued and running derivations via `signal`. The "once per (run, spec)" rule means **one successful, cached computation per `(generation, spec)`**; bounded retries after `DerivationBusyError` or an abort-and-rerequest are permitted attempts of the same job and do not violate it.

### 5.3 Why no Viewer Adapter change

The prompt's Viewer capabilities (resolve identity → model/dbId, focus, fit, isolate, highlight, clear, restore; "highlight" is realized as Panel-owned markers, PD-16) split into two kinds. **Resolution** is `parseResult…/pair refs → registry.bindingFor(modelKey)?.model` — the composition SPEC §20 assigns to the Panel, and it needs no adapter code. **Mutation** requires Viewer/DOM/THREE globals, which `clashtest/viewer/`'s guard forbids; adding it there would require editing the guard and would breach the frozen layering. Both are therefore Panel-layer work. **Classification: no adapter extension; a new layer.** Reaction to model unload uses the Panel's own `BEFORE_MODEL_UNLOAD_EVENT` listener (as `ClashFinderExtension` already does) plus resolution at action time — the Panel must not depend on registry state inside that handler, because `wireModelUnload` may already have unregistered the model (hence the Panel's own `WeakMap<Model,modelKey>`).

---

## 6. Test setup

### 6.1 Controls → Core mapping

| Control | UX | Maps to | Notes / deferred |
|---|---|---|---|
| Test name | text, default "Clash test N" | `definition.name` (1–256) | display only; not in `semanticDigest`. |
| Mode | segmented: **Hard** / **Soft (clearance)** | `mode` = `volume-overlap` / `clearance` | `containment`, `surface-intersection` deferred (PD-3, OD-4). **Soft is offered only when the common-measurement-basis rule of §6.2 holds** for the participating models; otherwise the Soft option is disabled with an explanation and Hard stays available (PD-17). *(Superseded by §23 (2026-10-07): Soft stays selectable with a host-verified, user-supplied or raw-model-units basis; Run is blocked until a basis is chosen; §23.2/§23.7 are authoritative.)* |
| Clearance | number input, Soft only, shown only while Soft is available (§6.2) | `clearance` (finite > 0) | **No default in Core.** Field starts empty and Run is disabled until entered (OD-9). The unit label is a presentation choice made **only after** the basis is verified (OD-13). This is the reference's "tolerance" **only** for Soft mode. *(Superseded by §23 (2026-10-07): Soft stays selectable with a host-verified, user-supplied or raw-model-units basis; Run is blocked until a basis is chosen; §23.2/§23.7 are authoritative.)* |
| Tolerance for Hard | *(absent)* | — | Core has no tolerance/penetration threshold (SPEC §23 item 6); control is not shown; help text explains. |
| Set A / Set B — models | checklist of models in the Viewer | `selectionA/B.entries[{kind:'model',modelKey}]` | one entry per checked model; model entries win over element entries for the same model. |
| Set A / Set B — current selection | button "Use current selection" | `{kind:'elements',modelKey,dbIds}` from `viewer.getAggregateSelection()` grouped per model | subtree semantics shown ("selecting an element selects its children"); see Clash Finder's `getAggregateSelection()` precedent. No numeric pre-check against `maxExplicitElementsPerSelection` (the effective value is not readable through the engine; §5.2) — `validateTest` reports `too-many-elements` authoritatively. |
| Self-clash (labelled "Compare Set A against itself (Set B = Set A)" since §24) | toggle | `selectionB = selectionA` (identical entries) | hides the Set B picker; a *mirror shortcut* — selecting the same loaded model in Set A and Set B by hand is also a self-clash (§24.4). Core supports same-set self test. Whole-model self-clash may report `hierarchyInternal` (→ no-clash claim blocked, §7.5). |
| Test identity | hidden | `schemaVersion=1`; `testId` = Panel-minted UUID for a **draft**; `revision` per the rule below | direct-definition runs; store interaction to be confirmed in planning (PV-2). |

**Draft identity lifecycle.** With no saved-test UI, "one test" = one Panel *draft*. (*§26, 2026-10-10:* with the session-scoped Clash Tests manager, each manager record holds one such draft; the active record's draft is the editor's draft; `testId` is also minted on Create/Duplicate, and the rules below apply per `testId` unchanged.) `testId` is minted when the Panel is first opened and again on an explicit **New test** action (which also clears results); it is never re-minted by edits. `revision` starts at 1 and is incremented **only when a run is started with a normalized definition (all definition fields including `name`) that differs from the previous run's for this `testId`**; re-running an unchanged definition reuses the revision, so `resultId`s stay stable across reruns of the same question (SPEC §4.4). Editing and then reverting still bumps the counter (it is monotone and never reused) but yields the same `semanticDigest`, hence the same `resultId`s. Whether direct runs with these identities persist cleanly is PV-2.
| Group by element | in the results header, not setup | post-run derivation | **not** a definition/run option (Core rejects it as unknown). |
| Advanced (collapsed) | broad phase, persist, `maxSourceFragmentsPerUnit` | run options | **Not exposed in v1** (defaults only); listed so the owner knows what exists. |

### 6.2 Validation before run

1. **Draft → definition** is built by the Panel core from the form model (pure function).
2. `engine.validateTest(definition)` — synchronous, authoritative. Each `issue.path` (RFC 6901) is mapped to a control (`/clearance` → clearance field, `/selectionA/entries/…` → Set A, …); `issuesTruncated` shows "and more". Messages are Core's; the Panel adds only control-level phrasing.
3. **Panel pre-checks (advisory, never a substitute for step 2):** each side has ≥ 1 entry; every referenced model appears in the `ModelCatalog` with a non-null `modelKey` and has a live binding (`registry.bindingFor(modelKey)` non-null) — registration is done by host composition, never by the Panel (§5.1, §11.1); an unregistered model disables Run with "Model *X* is not registered"; each participating model reports load-complete (`isLoadDone()`), because whole-model planning **fails closed** on tree-reachable not-loaded fragments (Viewer README D-V6) and the Panel cannot distinguish that cause from other `enumeration-failed` causes afterwards (§13). A model still loading disables Run with "Model *X* is still loading". **Readiness refresh:** `isLoadDone()` can change without a model add/remove, so the `ModelCatalog` contract (§5.2) is that `onChange` also fires on readiness changes; the host shell implements this from the Viewer's load/object-tree events (`GEOMETRY_LOADED_EVENT`, `OBJECT_TREE_CREATED_EVENT`; evidence-gated, §16) **plus a low-frequency poll while the Panel is visible and any participating model is not ready** (poll interval is a presentation constant, §12.4).
4. **Soft availability (fail-closed common measurement basis; PD-17).** Applies to Soft mode only. Let *P* = the set of `modelKey`s participating in either side (Set A ∪ Set B, both sides of a self-clash). Soft is **available** iff (i) |*P*| = 1 (a single model has no cross-basis comparison), or (ii) `ModelCatalog.measurementBasis(P)` returns `{state:'verified'}`. Anything else — `incompatible`, `unverified`, a missing method, a throw, a timeout, or any unrecognized shape — makes Soft **unavailable for this test**. Rationale and scope of the rule: Core compares raw world-space numbers — `clearance` is one finite number and `evidence.distance` is a raw distance, neither carries a unit, and the collision layer applies a per-model unit scale only to its weld epsilon (`collision/CollisionWorld.js`, `constants.js`), so it never converts distances between models. A shared threshold is therefore meaningful only if every participating model's coordinates share one verified basis. **Display-unit conversion or a label cannot supply that basis** and is never used as a substitute. The Panel does not compute or repair the verdict (PD-18): what evidence suffices (for example equal `getUnitScale()` across models plus a verified shared world frame, or one evidenced load-time normalization) is a **host-composition requirement, PR-BASIS**, live-verified on SVF2 fixtures under PG-5; this design invents no unit system and no conversion. When Soft is unavailable: the Soft segment is disabled; the setup shows the fixed explanation *"Soft (clearance) isn't available for these models: they don't share a verified common measurement basis."* plus the verdict's `reason` (Viewer-supplied text inserted as text only) — never wording implying a result would merely be approximate or would carry a caveat; if Soft was already selected, Run is disabled with that explanation until the user selects Hard or changes the scope; **Hard is unaffected** (it has no distance threshold, so its definition consumes no unit basis; whether the models are otherwise placed correctly relative to each other is the existing placement/freshness concern, PR-OQ17, unchanged). Unit *display* ("scene units" or a Viewer unit label, OD-13) applies only to Soft results whose run passed this rule; a sealed Soft run's Run details show the basis verdict captured **at run start** (Panel-local record; not part of the sealed set). Core cannot catch a violation (it has no unit concept), so this check is a Panel prerequisite, not a substitute for `validateTest`.
5. Run is enabled only when 2 passes and 3 and 4 have no blocking finding. Core still decides at plan time (`hierarchy-overlap`, `element-unresolvable`, `plan-too-large`); the Panel surfaces those from the sealed outcome (§13). It does **not** pre-detect ancestor/descendant overlap between A and B (needs the instance tree; deferred).

### 6.3 Draft/result relationship

Any setup edit after a run sets a `setupChangedSinceRun` flag shown as "Setup changed — results reflect the previous setup". Filters and grouping **never** trigger a rerun; only Run does. There is no structural compare of draft vs `resultSet.definition` in v1 (a boolean flag suffices).

---

## 7. Run lifecycle

### 7.1 Panel state ↔ Core contract

| Panel state | Entered when (Core signal) | Presentation |
|---|---|---|
| `idle` | no handle | setup enabled; Run button. |
| `preparing` | `startRun` returned a handle; `getSnapshot().status==='queued'` | **indeterminate** "Preparing…". Covers queued-behind-another-run **and** binding/enumeration/planning — the engine publishes **no snapshot or event during those stages** (code fact; §19-1), so "enumerating model 2 of 3" is impossible. |
| `planning` | first `state` event: status `planning`, phase `enumerating` | indeterminate "Planning…". (Code never sets phase `planning`.) |
| `running` | status `running` | progress bar = settled-unit fraction `(unitsEvaluated + unitsFailedOrSkipped) / unitsTotal` (indeterminate while `unitsTotal` is 0), labelled `N% of units`; text `unitsEvaluated/unitsTotal` (plus `(k not evaluated)` when `unitsFailedOrSkipped > 0`), `resultsFound`, `caveatCount`; elapsed time from the **Panel's clock**. `unitsTotal` may grow (splits), so the units fraction can step back slightly; it is shown as-is, never smoothed. The engine's pair-space `fractionProcessed` is **not** used for the bar: it is exact for its own definition but front-loaded for same-model runs (Architecture self-clash showed 66.7% at unit 80 of 4,294) and so misleads as a completion signal. **Amendment 2026-10-07 (owner-authorized Option E).** No ETA (PD-13). |
| `stopping` | user pressed Stop; status `cancelling` | "Stopping… (finishing the current step)". Latency is up to one work unit and is not bounded by the library. |
| `finalizing` | terminal `status` with `phase:'finalizing'` | "Finalizing…" (waits up to `persistTimeoutMs`, default 5 s, for the first persistence attempt). Results not yet available. |
| `done` | `await handle.done` resolved | sub-kind by `RunSummary.status` (§7.3). |

`done` never rejects, so the controller has no error path to lose. `startRun` throws synchronously only before a handle exists (`InvalidTestDefinitionError`, `UnsupportedSchemaVersionError`, `StoreNotConfiguredError`, `InvalidOptionsError`, `ResultCapacityError`, `RunQueueFullError`, `EngineDisposedError`); the Panel converts each to an inline error and stays `idle`.

Drive UI from `state`/`unit` events plus `getSnapshot()` (event payloads carry only `{type,seq,status,phase}`); treat `progress` events as declared-but-unobserved (§19-7).

### 7.2 Run / Stop

- **Run** builds the definition (§6), validates, then `startRun`. **Only after `startRun` returns a handle** does the Panel perform the "new run" visualization clear (§9.6) and, per OD-7, replace and release the previous results (§7.6); an admission failure preserves the previous results and Viewer state.
- **Stop** = `handle.cancel('user')`. In `preparing/planning` it withdraws the run promptly and seals a planning-gap `cancelled` with zero results. While `running` it moves to `stopping`, drains the in-flight unit and seals `cancelled` **with the evaluated units' results and `coverage:'partial'`**.
- Precedence when facts coincide is `failed > invalidated > cancelled > completed` (SPEC §16.7); a Stop can therefore end as `failed`/`invalidated` with `cancel-requested` among `reasons`. The Panel shows the actual status, not "Stopped".
- One active run per world (others would queue). The Panel disables Run while its own run is non-terminal; runs started by other consumers of the same world can still occupy the queue (`preparing` may be long) — shown as "Waiting for another run".

### 7.3 Terminal states

`status` × axes (`coverage`, `integrity`, `freshness`, `environmentSensitive`) — never a single "incomplete" state (there is none in Core).

| Terminal `status` | Results present? | Headline |
|---|---|---|
| `completed` | yes (may be zero) | "Completed — *N* clashes" + axis badges; **not** "no clashes" (§7.5). |
| `cancelled` | evaluated units only; **none** if cancelled during planning | "Stopped — partial results (*N*)" or "Stopped before any results". |
| `failed` | evaluated units only; **none** for planning-stage failures | headline by cause (§13). |
| `invalidated` | evaluated units only | "The model changed during the run — results are partial and stale". |

Axis badges (always visible together): **Coverage** full/partial; **Integrity** clean/caveated; **Freshness** current/stale/unverifiable. `freshness` at seal (`outcome.freshness`) is shown immediately; the live value comes from `engine.getFreshness(runId)` (async) and is re-checked on: run done, any model add/unload event, and Panel show. A pending check displays "Checking freshness…".

**Derivation cost caveat (applies to every Core derivation the Panel uses).** `derivations.summarize/groupBy/filter` are sliced and abortable in their work phase, but each call first **synchronously captures the entire Result Set** (`clashtest/derive/context.js`, O(results) with no yield). Up to three such captures happen per displayed run (`summarize`, the `caveated` mask, `groupBy` when Group-by-Element is first used); each is one main-thread pause proportional to the set size. The Panel does **not** claim these are non-blocking; their duration on a 100,000-result set is unmeasured and gated (PG-3). Removing them would need a Core change (a trusted-sealed-set or fully asynchronous derivation entry path), recorded as a possible follow-up, not assumed.

### 7.4 Partial results during execution — **not browsable**

Core seals results once, at the terminal transition (SPEC §13.3); `getResultSet(runId)` returns `null` for a non-terminal run and events carry no payload; only `RunProgress.resultsFound` (a count of distinct PairIds retained so far) and `caveatCount` exist. The Panel therefore shows a running count and **no list** during a run. Partial results are browsable **after** a `cancelled`/`failed`/`invalidated` seal. *Alternative (OD-3):* add a Core partial-snapshot read API — a new frozen-Core capability (SPEC §23 item 7 excludes incremental/partial products), so it is out of scope and recorded, not assumed.

### 7.5 Wording matrix — claims, empty and partial outcomes (Panel-owned wording, SPEC §20)

The Panel calls `engine.assessNoClashClaim(runId)` and uses **only** these statements:

| Situation | Statement | Detail reachable |
|---|---|---|
| `allowed && unqualified` (completed, full, clean, current, results = ∅, …) | "No clashes found in the evaluated scope." + scope summary | provenance popover |
| `allowed` with `qualifiers` (only if `hierarchyInternalAcceptance` was configured — **not in v1**, OD-14) | "No clashes found, excluding the hierarchy-internal pairs recorded in `ledger.hierarchyInternal`." | list |
| results = ∅ but claim **not** allowed | "0 clashes reported — this is **not** a clearance." + one line per failed conjunct (partial coverage / caveated / stale / empty operand / unresolved selection / unreachable population / hierarchy-internal) | gap list |
| results ≠ ∅ | clashes are valid positives regardless of axes; absences are stated only where `getPairStatus` = `covered-clean`; otherwise "unknown" | per-row caveat badge |
| stale / unverifiable | "Results describe a previous model/placement state." | reasons |

Concrete v1 consequence: a **whole-model self-clash of the Architecture model** hits `hierarchyInternal` (4 fixture roots), so its empty result must use the non-claim wording. **v1 does not call `getPairStatus`/`getElementStatus` on any interactive path.** Reason: the first call synchronously builds an O(results + ledger) reader (`clashtest/results/status.js`), which would stall the main thread on a 100,000-result set, and the ordered-pair over-reporting decision (P5) is still open. Per-row verification is instead taken from Core's async, sliced `caveated` facet through **one** `derivations.filter([{facet:'caveated',op:'eq',value:true}])` call per run whose result-id set is cached as a mask (same pattern as grouping, §10.2). Known v1 limitation: the facet is true only for the `covered-caveated` verdict, so a `not-required` or `undetermined` pair is **not** distinguished from a clean one at row level; that information is carried by the run-level Coverage/Integrity badges and the gap list (§13), and per-pair absence statements are made only at run level through `assessNoClashClaim`. Per-pair/per-element coverage display is deferred (§18) until an async status-reader precomputation exists (a Core follow-up, recorded not assumed).

### 7.6 Result-set residency

The engine counts queued + active + resident sets against `maxResidentResultSets` (default 4). v1 uses the engine's default in-memory stores (no cross-page persistence; G-REMOTE deferred). The Panel keeps **at most one displayed set** (with the §26 manager: the **active** test's only; non-active tests hold no set, §26.3) and manages the engine's residency contract, verified in `clashtest/results/residency.js` / `engine.js`: `retainResultSet(runId)` returns a **one-shot lease** and throws `UnsavedResultSetError` unless persistence is `saved`; `releaseResultSet(runId,…)` throws `ResultSetRetainedError` while a lease is outstanding and `UnsavedResultSetError` for an unsaved set unless `{acknowledgeUnsaved:true}`; unsaved sets are never auto-evicted; releasing a non-resident id is a no-op.

Residency state machine (one per displayed run), driven by `RunSummary.persistence` / `getPersistenceState` / the `persisted` promise:

| Persistence at `done` | Panel action | Displayed-set holding | Note |
|---|---|---|---|
| `saved` | `lease = retainResultSet(runId)` (stored) | leased | by-id `getFreshness`/`assessNoClashClaim` keep working while the set is resident. |
| `pending` (timed out) | none yet; on `persisted`→`saved` do the `saved` row; otherwise the failed/skipped row | engine-held (unsaved, never evicted) | show "Saving results…" only if the Panel offers persistence UX; v1 shows nothing extra unless it fails. |
| `failed` / `skipped` (`no-store`, `persist-false`, `seal-failed`) | none; show a quiet "Results are held in memory only" notice | engine-held (unsaved) | `retryPersist` is **not** offered in v1. |

Release paths (replace, Clear results, dispose): (1) `lease.release()` if a lease is held (idempotent); (2) `releaseResultSet(runId, {acknowledgeUnsaved})` where `acknowledgeUnsaved:true` is passed **only** for an unsaved set **and only after an explicit user action** (Run over unsaved results, or Clear results, each with a one-time "discard unsaved results?" confirmation; dispose has no user to ask and instead passes it and reports the drop in the dispose notice); (3) failures of either step are caught and reported, never allowed to strand the other step or the visualization teardown. **Ordering on Run:** the new run is admitted first (`startRun`); only after it returns a handle are the old visualization cleared and the old set released, so an admission failure (`ResultCapacityError`, `RunQueueFullError`, validation) **preserves the previous results and Viewer state**. If `ResultCapacityError` is caused by the Panel's own previous set, the error offers "Release previous results and retry" (an explicit action). A superseded run's late `done` releases its own set without displaying it. Disposal during an active run cancels it (`'panel-disposed'`) and releases whatever it sealed.

---

## 8. Results

### 8.1 Data flow

On `done`, the controller takes `summary.resultSet` (frozen, plain data) and builds a **ResultIndex** once: an array of *references* to `results[]` (no copies) plus a `Map<resultId, canonicalIndex>` (the Panel needs its own map; Core has no `getResult`, and the id helpers are not exported from the barrel — the Panel needs none, since each record carries `resultId`, `pair` and `evidence`). `derivations.summarize(set,{signal})` is called once for the header (counts by pair-models, unit outcomes, caveat counts, `gapWeight`, axes), and the `caveated` mask (§7.5) once; both commit only if the controller generation still matches (§5.2). Element display labels and model names are resolved lazily (§8.2).

### 8.2 Result row model

| Field | Source | Notes |
|---|---|---|
| Key | `resultId` | list selection identity (PD-8). |
| Ordinal | canonical index + 1 | display only, "#n in this run"; never a durable id. |
| Element 1 ↔ Element 2 | `pair.first/second` → `{model name · element label · #dbId}` | canonical order (PD-9). A "source/target" reading is **not** offered; only when the two sides' `modelKey`s fall in disjoint A-only/B-only model sets may the view order them A-then-B as a presentational convenience (no identity effect). |
| Model chip | Panel-owned `ModelCatalog` name (survives unload) | fallback `Model <modelKey short>`. |
| Element label | `model.getObjectTree()?.getNodeName(dbId)` when the model is live and the object tree exists (the deprecated `getInstanceTree()` is not used); else `#dbId` | cached (§12.4); Core has no names. **All model names, element names, error messages and diagnostic previews are untrusted external text**: the view inserts them with `textContent` (or equivalent escaping) only — no `innerHTML`/template interpolation of such text; a hostile-label test is required (AC-P13). |
| Gap | Soft only: `evidence.distance` (fixed 3 decimals, "scene units") | Hard results have **no magnitude** — column hidden; no invented penetration depth. |
| Location | `evidence.witness.point` (Hard) / midpoint of `closestPoints` (Soft) | absent for `witnessUnavailable`; used for marker/fit. |
| Badges | `flags.*`; membership in the cached `caveated` mask (§7.5) | "no location", "unreachable owner", "mixed owner", "duplicate-evidence conflict", "caveated". |
| Liveness | resolver (§11) | `live` / `model not loaded` / `reloaded since run` / `version mismatch`. |

### 8.3 Counts and states

- Header: **total** (`results.length`), **filtered** (after filters), **shown** (current page), and in grouped view **groups** and per-group "n of m" (filtered of total). In grouped `element` view a note states that each clash is listed under both of its elements, so group counts do not sum to the result count (`multiValued`).
- **Empty** (no results): §7.5. **Empty-after-filter**: "No clashes match the current filters" + "Clear filters".
- **Failed / incomplete** banner (§13) sits above the list and never hides the list of retained results.
- Selected row: highlighted; selection survives filter/sort/page changes (§12.3).

### 8.4 Provenance and run details

A "Run details" popover shows, from the sealed set only: definition summary, `startedAt/finishedAt`, `determinismClass`, per-model `modelKey`/`modelVersion`/binding generation, `libraryExclusions`. It shows **no element counts**: `provenance.models[].elementCount` has undefined semantics (gate G-EC) and must not be consumed. "Copy diagnostics" exports plain JSON of `outcome`, `ledger.planningGaps`, `diagnostics` (its `truncated` flag preserved) for debugging without cluttering the UI (§13).

---

## 9. Navigation, Viewer interaction and state ownership

### 9.1 Resolution contract (Panel core, no Viewer mutation)

For a result and a side `ref`, `resolveSide(ref, provenance)` returns:

- `{state:'live', model, dbId}` iff `registry.bindingFor(ref.modelKey)` is non-null **and** `binding.bindingGeneration === provenance.models[ref.modelKey].bindingGeneration` **and** `binding.modelVersion === provenance.models[ref.modelKey].modelVersion`;
- and the model is currently **in the scene** (`ModelCatalog` reports it in `viewer.getAllModels()`); a model removed with `hideModel` stays registered and lease-valid in the registry but is not in the scene (the Viewer fires `MODEL_REMOVED_EVENT` for it, **not** `BEFORE_MODEL_UNLOAD_EVENT`; §16), and isolation ignores entries for models not in the loaded list;
- otherwise `{state:'unavailable', reason}` with `reason ∈ not-registered/unloaded` (null binding — Core cannot distinguish them), `reloaded-since-run` (generation differs), `version-mismatch`, `not-in-scene`.

This is the Panel's only use of the registry for navigation, exactly as SPEC §20 prescribes; it never stores a `Model` in Panel state beyond the action (results never hold one). The generation check is what makes cross-reload behavior **explicit rather than assumed** (§11).

### 9.2 ViewerBridge contract (the only Viewer mutator)

```
present(request) -> Promise<Outcome>       // serialized presentation transaction (see below)
  request = { sides:[{model, dbId}] (1–2 live sides), point?, closestPoints?,
              options:{ focus, isolate, marker } }   // no theming option: PD-16
  Outcome = { superseded, fitted, isolated, marked, notes[] }   // never throws for expected Viewer refusals
clear() -> Promise<Outcome>                 // invalidates all tokens; queued behind the in-flight step; resolves when Panel-owned resources are gone; restores isolation iff still owned
dispose() -> Promise<void>                  // clear() + remove listeners; idempotent; callers MUST await it
```

`clear()`/`dispose()` are asynchronous because they share the single-flight queue with `present()`: they invalidate all tokens immediately (so any in-flight `present` stops mutating at its next token check) and **resolve only when the queue has drained and cleanup has completed** — that resolution is the defined completion point for AC-P6/AC-P16 and for every restore-table trigger (§9.6). Every call after `dispose()` (including `present`) is a non-mutating no-op returning a `disposed` outcome.

**Presentation transaction (normative).** The bridge serializes `present`/`clear`/`dispose` through a single-flight queue and gives each `present` a **token** (`++n`); `clear()`, `dispose()`, a controller-generation change and any later `present` **invalidate every earlier token**. The bridge keeps a **resource ledger keyed by token**: `{markerMeshes, isolationApplied?}` — both are state the Panel itself creates or can read back; **the Panel never writes Viewer theming** (see the *Emphasis* bullet below). The token is re-checked **immediately before every Viewer mutation**; an invalidated token performs no further mutation. **The ledger is write-ahead:** before each mutation the bridge records the *intent and its pre-image* (the overlay mesh about to be added and the isolation pre-image and target), and marks it *confirmed* only after the call returns. If a Viewer call throws, the state is treated as **ambiguous**: cleanup covers every recorded intent (confirmed or not) — for markers by guarded removal (an overlay mesh the Panel created and can name), for isolation by **read-and-compare** (current isolation equals the intended target → restore the pre-image; equals the pre-image → nothing to do; otherwise it is foreign → leave it). Only an operation whose API is verified atomic-before-throw may skip the write-ahead record (none is verified today). Mutation order, chosen so that everything that can fail without side effects is done first:

1. *Resolve, compute, no mutation:* element boxes / marker radius / target framing (may throw → nothing to roll back).
2. *Markers* (create meshes + add to the Panel's overlay scene; recorded in the ledger).
3. *Isolation*, only if enabled **and** the isolation prerequisite of §9.5 holds: one `setAggregateIsolation` reconcile; record `isolationApplied` with the pre-image needed to undo it.
4. *Fit* (camera) — **outside the transaction guarantee**: best-effort, last, never rolled back; a failure or a stale token only adds a note.

If a step throws or the token is invalidated part-way, the bridge removes **only the resources recorded in that token's ledger** (overlay meshes) and, if that token applied isolation, restores the isolation pre-image **only if** the current isolation still equals what that token applied; it never touches resources of a newer token (a stale completion cannot clear a newer presentation's marker or restore an older isolation). When a newer `present` succeeds it first releases the previous token's ledger, then applies its own (ordered so the displayed state is never a mix). Late completions of superseded operations report `superseded: true` and have no effect.

- **Focus / fit:** frame the union of the live sides' element boxes; for one live side, `fitToView([dbId], model)` (the proven per-model form). Union framing across two models is not available from the existing `fitToView` (framing is per call, per model — recorded in `collision/README.md`), so cross-model union framing depends on Viewer API evidence (§16); fallback is to fit the first live side and note it.
- **Isolate (toggle, default off; enabled only when the §9.5 prerequisite holds):** one `setAggregateIsolation([{model,ids}…])` reconcile per present (full-replace semantics; `[]` clears; an `{model, ids:[]}` entry means *show all*, not *isolate none* — both recorded in `ClashFinderExtension`). Never one call per side.
- **Emphasis = Panel-owned markers only (PD-16; independent review H1).** The Viewer has no supported per-node theming readback, so the Panel could neither capture a theming pre-image, distinguish its own color from a foreign one, nor detect a foreign change after its own write; clearing "its" theming could erase another extension's or the host's. **v1 therefore never calls `setThemingColor`/`clearThemingColors` and never overwrites or clears foreign theming state.** Everything the Panel draws lives in its own overlay scene and is removable deterministically by name from its ledger. An **exclusive-theming mode is deferred** and would need a separate, enforceable ownership contract (for example, a host-guaranteed Panel-exclusive theming scope) designed and reviewed under its own authorization (§18, OD-5).
- **Marker (toggle "Markers", default on; two overlay kinds, both Panel-owned):** (i) a *location marker* — overlay-scene sphere at the Hard witness point / two spheres and a line for Soft `closestPoints` (absent for `witnessUnavailable`); (ii) a *bounds outline* per live side — a wireframe box of that element's world bounds in two distinct colors (side 1 / side 2), so the two clashing elements are identifiable even without a location; the outline is evidence-gated (element bounds retrieval, PG-1, F7) and silently omitted with a note when bounds are unavailable. When neither kind can be produced the outcome reports `marked:false` and the remaining actions (fit, isolate) still apply. Both use the page's r71 `window.THREE` (never npm `three`), a dedicated overlay scene name, `depthTest:false`, manual disposal of geometry/material; the Panel touches only meshes it created. `ClashFinderExtension` is the reference implementation (SPEC §20); v1 **duplicates** the ~100 lines rather than editing that frozen-adjacent extension (OD-10).
- **Selection:** the Panel does **not** change the Viewer selection. (Selecting would race the Clash Finder context menu, which reads it, and adds no information to the workflow.) Deferred.

### 9.3 Navigation behavior

- Row click, **Prev/Next** and the **Focus** button all set the selection (`resultId`) and call `present`, with the same per-toggle options (marker/isolate as toggled). They differ only in the camera: **row click and Prev/Next fit the camera only when the "Focus on select" toggle is on (default on)**; the **Focus** button always re-fits. Prev/Next step over the **navigation list**: the whole filtered/sorted list, or — when the user selected from inside an expanded group — that group's members (`navScope`), so "next" stays inside the group the user is reading. Ends are disabled (no wrap).
- If the selected result is not in the current list (filtered out) Prev/Next go to the first/last element; the detail pane keeps showing it with "hidden by current filters".
- If neither side is live: the row and detail show the reason; Focus/Isolate/Markers are disabled with a tooltip; the result stays selectable and inspectable. If one side is live: the live side is presented and the note "*Model Y* is not loaded" is shown.
- **Back to All** = `bridge.clear()` + clear Panel selection + `navScope` reset. It does not change filters, grouping, page or results.

### 9.4 Ownership and coexistence

`setAggregateIsolation` is global and full-replace: it resets **all** isolation, including Room Locator's and Clash Finder's, and vice versa. v1 therefore rules:

1. The Panel owns isolation **only** between an `present({isolate:true})` and the next `clear()`.
2. The bridge records `lastApplied` (the reconciled isolation set, in canonical normalized form — §9.5). If, at `clear()`, the current isolation (read and normalized the same way) differs from `lastApplied`, it was changed externally: the bridge **skips** restoring isolation (never clobbers foreign state), still removes its own markers, and reports `isolation: 'skipped-external'`. Comparison at `clear()` time is by **read-and-compare**, not by trusting an event, so it does not depend on `AGGREGATE_ISOLATION_CHANGED_EVENT` semantics (§16 may use the event only as an optimization).
3. Coexistence with the two existing context-menu extensions is a recorded owner decision (OD-12): recommended v1 stance is "not used simultaneously" + the guard above; migrating/retiring Clash Finder is deferred. Note that engine runs and direct `findClashes` from Clash Finder can contend on placement (SPEC OQ-11); the Panel builds its own world and does not solve this.

### 9.5 What "prior state" means

**Isolation prerequisite (normative).** Panel isolation is **enabled only if** (a) the bridge can *reliably read and compare* the aggregate isolation state at runtime — `getAggregateIsolation` is present and returns a shape the bridge can normalize (public; source-verified, §16) — **and** (b) at session start **no user-hidden state exists** that a later `setAggregateIsolation([])` would silently reveal: `[]` runs `setAllVisibility(true)` on every model, and `getAggregateIsolation` cannot express hidden nodes/models, so the bridge also reads `getAggregateHiddenNodes()` and requires it to be empty for every model in the scene. If hidden nodes exist, Isolate is disabled with "Some elements are hidden — show all to enable isolation" (restoring hidden state is deferred). **There is no "conservative clear" fallback**: `setAggregateIsolation([])` removes isolation belonging to the user, Room Locator, Clash Finder or another extension, so it is never used to compensate for an unreadable state. If the prerequisite does not hold, the **Isolate control is disabled with an explanation** and the Panel presents with markers (and fit) only.

*Canonical normalization* (used for every compare): a list of `{model, ids}` entries, entries keyed by model **object identity** (never `modelId`, which is reused), ids as a sorted, de-duplicated array, entries with empty `ids` treated as "show all of that model" (a distinct state from absence), entry order irrelevant.

At the first `present` of a visualization session (with isolation enabled) the bridge captures `prior = normalize(viewer.getAggregateIsolation())`. `clear()` restores `prior` if it was non-empty, or `setAggregateIsolation([])` if it was empty — in both cases **only after** the ownership compare of §9.4 passes. Panel-owned overlay meshes are tracked by name in the ledger and removed individually; there is **no theming state** to capture or restore (PD-16), and foreign theming is never read, cleared or overwritten; the camera is neither captured nor restored (OD-6).

### 9.6 Restore table — who restores what, and when

| Trigger | Isolation | Markers/overlays (Panel-owned only) | Selection (Panel) | Camera |
|---|---|---|---|---|
| Change selected clash | replaced by the new reconcile (prior kept) | old removed, new applied | new `resultId` | fit per option |
| Back to All | restored to `prior` (ownership-guarded) | cleared | cleared | unchanged |
| Start a new run | as Back to All, **after `startRun` returns a handle** (an admission failure leaves everything untouched, §7.2/§7.6) | cleared | cleared | unchanged |
| Hide Panel (close button) | restored (guarded) | cleared | **kept** (reapply via Focus) | unchanged |
| Extension unload / dispose | restored (guarded) | cleared | dropped | unchanged; run cancelled `'panel-disposed'`; result released |
| Switch active test / delete the active test (§26.5) | as Start a new run (no admission step; refused while a run is active) | cleared | cleared | unchanged |
| A model referenced by the current visualization unloads | whole visualization cleared (Clash Finder precedent), isolation guarded | cleared | **kept**; rows show `model not loaded` | unchanged |

Teardown is a nested `try/finally` chain so a failure in one restore step never strands another (Clash Finder `unload()` pattern); listeners are added and removed symmetrically.

---

## 10. Filtering and grouping

### 10.1 Filtering — classification of every filter

| Filter | Mechanism | Rerun? | Notes |
|---|---|---|---|
| Model (involves *M*; between *A* and *B*) | Panel-side predicate on `pair.first/second.modelKey` (Core equivalent: `pairModels`) | no | chips from the sealed set's models. |
| Element (exact) | Panel-side match on `ElementRef` (Core equivalent: `element eq`); entered via "Show only this element" from a row/group | no | |
| Text | Panel-side: dbId digits, model display name, element name **when resolvable** | no | names come from the Viewer, not Core; matching for unloaded models' elements is by dbId/model only (stated in the UI); the label index is built lazily in slices. |
| Max gap (Soft only) | Panel-side `evidence.distance ≤ X`, `X ≤ definition.clearance` | no | Core has only `distanceBucket`, not raw distance. This is the reference's "tolerance filter"; **increasing** clearance beyond the run's value **requires a rerun** (Setup changed flag). The Panel makes **no** claim-style statement for the narrowed threshold. |
| Caveated | mask from one cached async Core `filter` on the `caveated` facet (§7.5) | no | covers only the `covered-caveated` verdict; no `getPairStatus` (§7.5). |
| Has location | Panel-side `!flags.witnessUnavailable` | no | |
| Mode / status / hide-overlaps | **not offered** | — | `mode` is constant within a test; a Soft test already excludes Hard-clash pairs, so "hide overlaps" has no meaning in v1 (deferred with the other modes). |

All Panel-side predicates are pure functions over the frozen `results[]`, evaluated in chunks with a yield (§12.4) so a pass does not hold the main thread for long; a monotone `filterEpoch` (inside the controller generation, §5.2) discards superseded passes. Filter text is debounced. The Panel makes **no "never blocks" guarantee**: responsiveness on a 100,000-result set is unmeasured (PG-3) and the chunk size is a provisional presentation constant.

### 10.2 Grouping — Group by Element

- **Grouping key:** Core's `element` facet value, an `ElementRef` (`{modelKey, dbId}`, the fragment-owning owner element). One Core call: `derivations.groupBy(resultSet, ['element'], {signal})`, cached per `(runId, spec)`; a superseding request aborts the previous one (`signal`), and the Panel handles `DerivationBusyError` (max 2 concurrent) and `GroupingTooLargeError` (membership bound; `element` alone is 2 memberships per result, i.e. ≤ 200,000 at the default cap) as a graceful "Grouping unavailable for a set this large — showing the flat list."
- **Source-vs-target behavior:** none. The facet is symmetric — a clash appears under **both** of its elements (multi-valued). "First"/"second" are the canonical order, not roles (PD-9). Any A/B labeling on a group header is the same presentational convenience as in §8.2.
- **Count aggregation:** `count` from Core = clashes involving that element (total); the **filtered** count is computed by intersecting `members` with the active filter's result-id set (mask). The header states "n of m" and the multi-valued note. No other aggregate exists in Core; "worst gap per group" (Soft) is computed from members on demand, not stored.
- **Ordering:** Core order (by `ElementRef`: modelKey code-unit order then dbId). The Panel may re-sort groups client-side by filtered count or by label (presentation-only; Core never orders by count).
- **Expansion/collapse:** state is Panel-local, keyed by Core's `groupId` (stable across reruns for the same spec and value); default collapsed. Selecting a result expands the group it was chosen from.
- **Selected clash inside a group:** selection is `resultId`, global. The same clash under its other element is shown as selected too. `navScope` (§9.3) is set to the group the user selected from.
- **Purely presentation?** **Yes** — no new Core support. Unsupported and deferred: roll-up to parent/assembly/root/system/level/category (no facet; SPEC §23 item 8; annotation layer excluded), per-group aggregates beyond count, group-by-count ordering in Core, and location-cell grouping (Core `locationCell`; not offered). **Superseded in part by §25 (2026-10-08):** Model Pair (Core `pairModels`), Category and Level grouping are now supported as single-level modes; roll-up to parent/assembly/root/system and multi-level grouping remain unsupported.

### 10.3 Sorting

Default = canonical (Core) order. v1 adds **Gap ascending** (Soft only). Sorting builds an index permutation, not a copy of records.

---

## 11. Stale model, unload and reload UX

### 11.1 Registration and identity — a host-composition responsibility (dependency, not solved here)

Before a run, every participating model must be registered under a `modelKey` with a `modelVersion`. **That is host composition, not the Panel** (PD-18, §5.1; independent review M1): the host loads the model, derives `modelKey`/`modelVersion` (**OQ-1** — "must be settled before integration acceptance (not before the spec)", SPEC §24), calls `registry.register`, wires `wireModelUnload`, and **re-registers after a reload**. The Panel core only *reads*: `ModelCatalog.list()` (host-supplied) and `registry.bindingFor(modelKey)`. If a binding is absent or stale the Panel shows the state (Run disabled with "Model *X* is not registered"; rows `unavailable`) and stops; it never creates, repairs or refreshes a binding, and no Panel action triggers registration as a side effect. OQ-1 is recorded as PR-OQ1 / OD-8. For live acceptance the recommended **interim** host policy (owner to accept) is to mint a fresh `modelKey` for every model load with a host-supplied `modelVersion` witness; this makes results non-resumable across reload by construction, the safe reading of "do not assume cross-reload stability". This does not solve OQ-1 and is not implemented here.

### 11.2 Reactions

| Event | Panel reaction |
|---|---|
| A model unloads (`BEFORE_MODEL_UNLOAD_EVENT`) **or leaves the scene** (`MODEL_REMOVED_EVENT`, e.g. `hideModel`, which does not fire the former) | (1) clear the visualization if it references that model (§9.6); (2) mark rows whose either side references it `unavailable/unloaded` (recomputed lazily from the resolver, not eagerly per row); (3) schedule a freshness re-check; (4) keep the results list. The Panel uses the event's `model` and its own `WeakMap`, never `registry.keyOf` (may already be unregistered). |
| Result can no longer resolve to a live model | row badge "model not loaded"; Focus/Isolate/Markers disabled with reason; result remains inspectable; **list, counts, filters, grouping keep working** (they are pure data). |
| Model **reloads** (new `Model` object) | new object ⇒ registry generation/version differ, or the host mints a new key. Either way the resolver returns `unavailable` (`reloaded-since-run` / not-registered), **not** silently `live`. Freshness will typically read `stale` (`scope-drift`); banner "Results describe a previous model state — re-run to refresh." |
| Adapter/Core reports stale/unresolvable identity | freshness banner (`stale`/`unverifiable`) with reason codes; unit-level `model-evicted`, `scope-drift`, `input-changed` shown in the gap list (§13). |
| Result set valid but visualization unavailable | the normal state for unloaded/reloaded models: data browsable, no Viewer actions. |
| Model added | refresh the catalog; re-check freshness (a new model does not affect a sealed run's stale state but may change setup options). |

### 11.3 Is the reload-digest discrepancy a Panel prerequisite? — **No**

After a same-URN reload, `modelId` and population digests changed while fragment ids were equal; the cause is undetermined and classified a non-blocking residual. The Panel design never *resumes* results after a reload and never resolves them by digest: it uses generations/versions and treats any mismatch as unavailable, so no required Panel interaction depends on the discrepancy. A future "re-attach results to a reloaded model" feature would depend on it (and on OQ-1) and is deferred. **Exact condition under which this changes:** if the owner requires results to stay navigable after a reload, that requirement makes the residual a prerequisite; that requirement is not in this authorization.

---

## 12. Large result sets

### 12.1 Strategy

**Pagination over an index-based ordered list** (PD-6). The view-model keeps one immutable *ordered index* — an array of canonical indexes after filter + sort (or, in grouped view, a flattened sequence of group headers and member rows for expanded groups) — and renders only the current page (constant page size). It never materializes DOM for the whole set and never renders synchronously beyond a page.

**Why pagination over virtualization (recommendation, OD-2).** The repo has no fake DOM and no UI framework; pagination keeps DOM bounded by construction, is trivial to unit-test in the headless core, needs no scroll-geometry arithmetic or variable-height group rows, and has accessible, deterministic page controls. Virtualization gives a better continuous-scroll feel but adds scroll math, row recycling and harder headless testing for a first version whose result counts are **unmeasured** (§2). Because navigation is index-based, moving to virtualization later changes only the view, not the view-model.

### 12.2 Selected result outside the rendered page

Domain selection is `resultId` (detail pane, Viewer presentation). In grouped view one result has **several rendered occurrences** (multi-valued `element` grouping), so the list additionally carries a **presentation-only occurrence identity `{groupId, resultId}`** (Core's `groupId`; `null` in the flat view). The controller stores the *selected occurrence*; page and scroll targets are computed from **that occurrence's** position in the ordered index, never from `indexOf(resultId)` (which would find its first occurrence and can jump away from the group the user was reading). Selecting from the flat view or from a non-grouped source uses `{groupId:null,…}`; Prev/Next follow `navScope` (§9.3) and produce the next occurrence within it. Prev/Next and any programmatic select set `page = floor(occurrenceIndex / pageSize)` and scroll the row into view; every occurrence of the selected `resultId` renders as selected. If the selected result is not in the ordered index (hidden by filters), the detail pane keeps it and the list shows the "hidden by filters" note; the page does not jump.

### 12.3 Selection stability

Selection survives filter, sort, grouping and page changes; it is dropped only by Back to All, a new run, or Panel dispose. Changing filters never triggers navigation or a Viewer change.

### 12.4 Presentation constants (not public limits)

Page size (default 50), filter debounce (~150 ms), list-build chunk size and yield cadence, element-label cache size (bounded LRU), and the readiness-poll interval (§6.2) are **Panel-internal presentation constants**: provisional, uncalibrated, not exported as options, not engine limits (PD-14). They may be revised in implementation planning; they must never be described as calibrated or product-approved.

### 12.5 What is bounded by Core, and how the Panel behaves at those bounds

`maxResultsPerRun` (default 100,000; provenance records the run's value in `provenance.runOptions`) — exceeding it discards the overflowing whole unit and the run fails with reason `result-cap` (there is no separate "truncated" boolean; the Panel infers it from `failed` + `result-cap`, §13). Derivation bounds (`maxGroupMemberships`, `maxCapturedNodes`, `maxConcurrentDerivations`) are **never hard-coded and never read from exported defaults** (the effective values are not exposed, §5.2); the Panel reacts to the typed errors that carry them (`GroupingTooLargeError{limit,observed}`, `DerivationBusyError{limit}`, `ResultSetTooLargeError`). Memory: the Panel holds references to the frozen records plus O(n) index arrays and a cached group table; a whole-model run's real memory and latency are **unmeasured** and gated (PG-3).

---

## 13. Error and diagnostic UX

The Panel presents the outcome from the sealed `RunOutcome`, `ledger.planningGaps`, unit outcomes and `diagnostics`. Internal detail is one click away ("Details" / "Copy diagnostics"); the headline is human wording.

| Situation | Core signal | Headline and action | Partial results? |
|---|---|---|---|
| Invalid setup | `validateTest` issues / `InvalidTestDefinitionError` | per-control inline messages | n/a (no run) |
| Engine at capacity | `ResultCapacityError` / `RunQueueFullError` | "Clear previous results and try again." | n/a |
| Enumeration failed | planning gap `enumeration-failed` | "Couldn't read the model's element tree." Likely causes (non-authoritative — Core does not surface the sub-cause): model still loading; whole model > `maxCollisionInstancesPerEpoch` (20,000 fragments); an element over the extraction bounds. Action: wait for load / narrow scope. | none |
| Planning failure (other) | `model-not-bound`, `element-unresolvable`, `owner-mapping-mismatch`, `hierarchy-overlap`, `plan-too-large`, `test-unavailable`… | cause-specific line: unloaded model / an element no longer exists / A and B contain a parent and its own child / plan too large — narrow selections | none |
| Extraction/resource failure at unit level | unit `failed:extraction-limit`, `capacity-exceeded`, `unit-cap`, `object-tree-unavailable`, `target-too-large` | coverage badge "Partial" + gap list "N parts could not be evaluated (cause)"; results found remain valid positives; absences in gaps are "unknown" | yes |
| Result cap | `failed` + `result-cap` | "Too many clashes — stopped at the result limit (*value from provenance*)." Retained results = whole units evaluated before the cap. Action: narrow the selection, or (Soft only) **reduce** the clearance — a larger clearance broadens matching and can reproduce or worsen the failure. Hard mode has no tolerance, so only scope-narrowing is offered. | yes |
| Cancellation | `cancelled` | "Stopped — partial results" (or "before any results") | evaluated units |
| Model unloaded/reloaded during run | unit `model-evicted`/`skipped`, `freshness:'stale'`; `invalidated` on placement/scope change | "The model changed during the run" + partial/stale badges | evaluated units |
| Viewer Adapter resolution failure at navigation | resolver `unavailable` | row/detail reason; Viewer actions disabled | n/a |
| Unexpected Core failure | `failed:internal-error` / `world-disposed` | "The clash engine failed. Details are available to copy." | evaluated units |
| Diagnostics truncated | `diagnostics.truncated` | "Diagnostic detail was truncated" in Details | — |

Rules: (1) the Panel must tolerate **either** cause for a mid-planning unload (`model-not-bound` or a later `enumeration-failed`; frozen-Core Medium residual M1) and must not assume exactly one ledger row per planning failure (Medium residual M2 — duplicate `owner-mapping-mismatch`); (2) deferred/unimplemented `migration-failed` has no producer and needs no UI; (3) never surface implementation noise (unit ids, digests, stack text) outside "Details"; (4) `ClashTestError.name` is the stable discriminator when an error object is shown.

---

## 14. v1 Panel information architecture (normative UX)

### 14.1 Status of the reference

The owner's previously discussed Clash Detection screenshot is the **UX reference** for what the v1 Panel shows and in what order. It is **not** an architecture or runtime reference: no WASM assumption, no WASM-heap/CPU/RAM/runtime telemetry, no ETA, no reference-sample contract, no issue/approval/assignment workflow, and no attempt to clone ACC/Model Coordination (§4). Every visible element below is mapped to a Core field/API (§6–§13) or is explicitly absent.

### 14.2 Shell — `Autodesk.Viewing.UI.DockingPanel` (PD-19, owner direction)

v1 uses **`Autodesk.Viewing.UI.DockingPanel`** as the Viewer-native shell, opened from a toolbar button (`onToolbarCreated` + `ControlGroup` + `Button`, removed in `unload()`; §16). Normative constraints:

1. **The DockingPanel is a thin presentation layer.** It creates/owns the panel container, visibility and DOM rendering of *view-models*, and translates DOM events into *intents* sent to the controller. It holds **no workflow or domain state** — no draft, run, result index, filters, grouping, selection, pagination, residency or restore state. The DOM must be reconstructable from the controller's current view-model alone (so a hidden/re-shown panel, §9.6, loses nothing).
2. **Workflow/domain state belongs to the headless Panel controller** (`clashpanel/core`), which has no DockingPanel/DOM/Autodesk reference (AC-P10).
3. **Viewer mutations belong to the ViewerBridge** only (§9.2); the view never calls the Viewer; intents reach the bridge through the controller.
4. **No separate custom floating-window system**: no bespoke drag/resize/z-order/minimize implementation and no second panel framework. Whatever docking, dragging or resizing the DockingPanel itself provides is used as-is; anything it does not provide is out of v1.
5. Because `DockingPanel`'s `setVisible`/`addVisibilityListener`/`uninitialize` are undocumented and there is no remove-listener, **one small adapter class** in `clashpanel/ui/` owns the panel: exactly one visibility listener, no `setVisible` after `uninitialize()`, subclassing only through `initialize()` as in the official example (live-checked, PG-1).

### 14.3 Workflow spine — five regions in fixed order

**Test Setup → Run / Status → Filters / Grouping → Result Navigation / List → Selected Clash Actions.** One panel, five regions, this order top to bottom; **no** tabs, saved views or issue workflow. Setup auto-collapses when a run starts and re-expands on run failure (a collapsed Setup still shows a one-line summary).

```
┌ Clash Detection ─────────────────────────────── ▢ ✕ ┐   DockingPanel
│ ▾ 1 TEST SETUP                                         │
│   Test name  [Clash test 1        ]                    │
│   Mode  (● Hard  ○ Soft)   Clearance [   ]  ← Soft only, only when available
│   ⓘ Soft isn't available for these models: they don't  │
│     share a verified common measurement basis.  ← when unavailable
│   Set A  ☑ Architecture ☐ Structure ☐ Mechanical  [Use selection]
│   Set B  ☐ Architecture ☑ Structure ☑ Mechanical  [Use selection]
│   ☐ Compare Set A against itself (Set B = Set A)       │
│   ✔ Ready   /   ✖ Set B is empty · Model X is loading  │  ← validation state
│ ─────────────────────────────────────────────────────  │
│ 2 RUN / STATUS                                         │
│ [ Run clash test ]  [ Stop ]   Running · Planning…     │
│ ▓▓▓▓▓▓░░░░ 42%   units 8/19   found 37   caveats 2     │
│ 812 clashes · 37 match filters                         │
│ Coverage: Partial ▸  Integrity: Caveated ▸  Fresh: Current
│ ⚠ banner: partial / stale / failed / cancelled / setup changed
│ ─────────────────────────────────────────────────────  │
│ 3 FILTERS / GROUPING                                   │
│ Filter [ text… ] Model [all ▾] Max gap [ ] ☐ unverified│
│ Group (● None ○ Element)   Sort [Default ▾]            │
│ ─────────────────────────────────────────────────────  │
│ 4 RESULTS                              page 1/17       │
│ ┌─────────────────────────────────────────────────┐    │
│ │ #12 Wall-102 · Arch  ↔  Duct-88 · Mech   0.031  ⚠│   │
│ │ #13 …                                            │   │
│ └─────────────────────────────────────────────────┘    │
│ ◀ Prev  Next ▶   Page ‹ 1 / 17 ›                       │
│ ── 5 SELECTED CLASH ─────────────────────────────────  │
│  Element 1 …  Element 2 …  Gap 0.031  ● location       │
│  [Focus] [☐ Isolate] [☑ Markers] [Back to all]         │
└────────────────────────────────────────────────────────┘
```

### 14.4 Region contracts

| Region | Must visibly account for (v1) | Source / rule | Absent or deferred |
|---|---|---|---|
| **1 Test Setup** | mode selector (Hard / Soft); clearance input where applicable; **source** model/scope (Set A); **target** model/scope (Set B); self-clash toggle; **validation state** (Ready / per-control issues) | §6.1 mapping; §6.2 validation (`validateTest` issue paths → controls; readiness; registration state; **Soft availability**) | tolerance for Hard (Core has none); advanced run options; containment/surface-intersection modes; a "why Soft is unavailable" line replaces the clearance field when the basis is unverified (§6.2 step 4) — never worded as "approximate" *(Superseded by §23 (2026-10-07): Soft stays selectable with a host-verified, user-supplied or raw-model-units basis; Run is blocked until a basis is chosen; §23.2/§23.7 are authoritative.)* |
| **2 Run / Status** | Run clash test; Stop/Cancel (enabled in every non-terminal state); state (idle / preparing / planning / running / stopping / finalizing / completed / failed / cancelled / invalidated); **total result count and filtered count**; Coverage / Integrity / Freshness badges; banners (partial, stale, failed, cancelled, setup changed) | §7.1–§7.3 state ↔ Core contract; §13 wording; progress only from `RunProgress` fractions/counts and the Panel's own elapsed clock | **no ETA**, no throughput/SLO claim, no CPU/RAM/heap/WASM telemetry (PD-13) |
| **3 Filters / Grouping** | result text filter; model filter; **Max gap** (clearance/gap filtering, **Soft only**, ≤ the run's clearance); "unverified" (caveated) filter; **Group by Element**; sort | §10.1 classification; §10.2 grouping (Core `element` facet; presentation-only); §10.3 | status filter and hide-overlaps (not meaningful in v1); **composite / parent / assembly / level / category roll-up** (no facet in Core; annotation layer excluded — deferred, §18); model-pair grouping unless OD-11(b) |
| **4 Results (navigation / list)** | rows showing **source model/element ↔ target model/element** (Element 1 ↔ Element 2, canonical order; A-then-B ordering is presentational only when the sides fall in disjoint A-only/B-only model sets, §8.2); **selected result** state; **Prev/Next**; **pagination**; empty / incomplete / error / stale states | §8 row model and counts; §9.3 navigation; §12 pagination; §7.5 wording matrix (empty ≠ "No clashes"); §13 error table | virtualization; partial browse during a run; per-pair coverage display |
| **5 Selected Clash Actions** | **Focus / fit**; **Isolate** (only where safe — the §9.5 prerequisite holds, else disabled with a reason); **Panel-owned markers** (location marker + per-side bounds outlines); **Back to all** (restore) | §9.2 transaction; §9.4–§9.6 ownership and restore | Viewer theming (PD-16); Viewer selection sync; camera restore |

**State coverage inside the Results region** (each has a defined presentation, none a bare "No clashes"): before any run ("Run a test to see clashes"); during a run (count only, no list, §7.4); completed with results; completed empty (§7.5 claim / non-claim wording); partial/cancelled/failed with retained results (banner above a still-visible list, §8.3); empty after filter ("No clashes match the current filters" + Clear filters); grouping unavailable ("showing the flat list", §10.2); stale/unloaded rows (§11.2); engine/resolution errors (§13).

### 14.5 Reference concepts → v1 treatment

| Reference concept (authorization prompt) | v1 |
|---|---|
| clash mode selector | Region 1 Mode: Hard / Soft (Soft conditional on §6.2 step 4) |
| tolerance input | Region 1 Clearance, Soft only; Hard has no tolerance |
| self-clash toggle | Region 1 |
| group-by-element option | Region 3 (None / Element); composite roll-up deferred |
| run / stop | Region 2 |
| run status and result count | Region 2 (status, total, filtered, axis badges) |
| result filtering | Region 3 |
| result list; paging or virtualization | Region 4; **pagination** (OD-2) |
| current clash navigation; selected-row state | Region 4 Prev/Next; selected occurrence |
| source ↔ target element display | Region 4/5: Element 1 ↔ Element 2 (canonical order) |
| focus / isolate / highlight | Region 5 Focus, Isolate (guarded), **Markers** (highlight is realized as Panel-owned markers, PD-16) |
| back-to-all / restore | Region 5 Back to all (§9.6) |
| *(not imported)* WASM heap, CPU/RAM telemetry, ETA, reference-sample contract | absent by design |

Behavior: the status region has `aria-live="polite"`; all actions are keyboard-reachable; list rows are focusable with Enter to select.

---

## 15. Verification strategy (design-level; the plan is a later, separately authorized step)

- **Headless unit tests (the bulk):** controller state machine driven by a fake `EnginePort` + fake `ViewerBridge` + fake scheduler — every §7 state, every §13 row, filter/sort/page math, group mask, selected-outside-page, stale/unload/reload rules, restore-table rows, ownership guard, token-discarded stale present, symmetrical listener add/remove, teardown-with-failing-step.
- **Layering guard test** for `clashpanel/` (§5.1).
- **ViewerBridge tests** against a hand-rolled fake Viewer (isolation/overlay scene/fit/events; a fake that *fails the test if `setThemingColor`/`clearThemingColors` is ever called*) — no jsdom needed.
- **Live acceptance script** (Playwright, not collected by `npm test`, mirroring the T3 pattern): the first-ever engine run over live Viewer models, **with models loaded as SVF2 and the SVF2 format verified and recorded as a precondition** (as T3 recorded `isOTG: false` for its SVF models; here `isOTG` must be recorded true). **Gated** (PG-2). Records measured result counts, planning/run durations and memory **without** asserting or claiming an SLO (G-CAL/G-RESP; PD-13).
- Not testable headlessly and therefore live-only: isolation/fit behavior against Viewer 7.124.2, DockingPanel lifecycle, marker/outline rendering and element-bounds correctness.

---

## 16. Viewer API evidence status

The evidence artifact `docs/research/2026-09-26-viewer-clash-panel-viewer-api-evidence.md` (pinned 7.124.2 bundle read by symbol; **the read was not SVF2-specific — the OTG/SVF2-specific branches were not examined — so no verdict below is established for SVF2 models, the v1 target (§1, §2.1, PG-4)**; decoded sha256 `12b9fe49…c02e` equal to the Agent Kit's earlier record; official v7 docs cross-checked) supports the design as follows. **Everything is `source-observed`; nothing was run** — behavioral claims stay live-check items (PG-1).

| Design element | Evidence result | Consequence in this spec |
|---|---|---|
| Isolation (`setAggregateIsolation`/`getAggregateIsolation`) | public, docs and bundle agree; `[]` = show-all-of-everything (`setAllVisibility(true)` on every model, i.e. it also clears hidden state); a non-empty array **hides every unlisted model**; `{model, ids:[]}` shows that model; descendants included; the getter omits models with no isolation and **cannot express hidden nodes/models** | §9.5 adds a hidden-state condition to the isolation prerequisite. |
| `AGGREGATE_ISOLATION_CHANGED_EVENT` | public; synchronous; **no origin marker**; fires on no-op calls; not fired on model removal | Ownership is decided by read-and-compare (§9.4), not by the event; the event may only be an optimization guarded by a re-entrancy flag. |
| Theming | `Viewer3D.setThemingColor(dbId, color, model, recursive)` / `clearThemingColors(model)` are public and per-model, but the public API has **no per-node theming getter** (independent review H1); per-node un-theme = `setThemingColor(dbId, undefined, model)` is source-observed only; selection colour overrides theming in the shader | **Not used in v1 (PD-16).** Without a readback the Panel cannot capture a pre-image, distinguish its own color from a foreign one, or detect a later foreign change, so no rollback-safe ownership contract exists; live-checking (PG-1) cannot create one. Emphasis is by Panel-owned overlay meshes (§9.2). Exclusive-theming is deferred (§18, OD-5). The research artifact's theming findings are retained as evidence for that future work, not as a v1 dependency. |
| Framing | `fitToView(ids, model, immediate)` public; the **aggregate form** `fitToView([{model, selection}…], immediate)` frames a cross-model union but is **undocumented** and its key must be `selection` (an `ids` key throws); `navigation.fitBounds` public | Single live side: documented form. Two sides: aggregate form behind a guarded, feature-checked call; fallback fit the first live side. Live check of world-bounds correctness (PG-1). |
| Lifecycle events | `BEFORE_MODEL_UNLOAD_EVENT`, `MODEL_ADDED_EVENT`, `MODEL_REMOVED_EVENT` public with `{model}`; **`hideModel` fires `MODEL_REMOVED_EVENT` but not `BEFORE_MODEL_UNLOAD_EVENT`** | §9.1/§11.2: the Panel also treats `MODEL_REMOVED_EVENT`/absence from `viewer.getAllModels()` as "not in scene" (`unavailable/not-in-scene`); a hidden model is still registered and lease-valid in the registry. |
| Names | model: `getDocumentNode()?.name()` (public) with the viewer's own fallback chain (`modelNameOverride` → `getModelName()` (undocumented) → placeholder); element: `model.getObjectTree()?.getNodeName(dbId)` (sync once the tree exists); `getInstanceTree()` is deprecated | §8.2 uses `getObjectTree`. |
| Units | accessors public; the viewer does **not** rescale models unless `applyScaling` is passed at load (the repo passes none) → models keep native units; live values for the fixtures not verified | Not a display matter: Soft requires a **verified common measurement basis** across the participating models (§6.2 step 4, PD-17): a single participating model is trivially common; for several models the host's `measurementBasis` verdict must be `verified` (evidence may be equal unit scales plus a verified shared frame, or an evidenced load-time normalization — PR-BASIS); anything else → Soft unavailable. Display-unit conversion alone never satisfies it, and no converted distance is ever displayed. Which host evidence suffices is PR-BASIS / PG-5. *(Superseded by §23 (2026-10-07): Soft stays selectable with a host-verified, user-supplied or raw-model-units basis; Run is blocked until a basis is chosen; §23.2/§23.7 are authoritative.)* |
| `DockingPanel` / toolbar | class public; `setVisible`, `addVisibilityListener`, `uninitialize` **undocumented**; **no remove-listener**; toolbar via `onToolbarCreated` + `ControlGroup` + `Button` documented | §14: one adapter wraps the panel; exactly one visibility listener; never `setVisible` after `uninitialize()`; toolbar control removed in `unload()`. |

Still requiring a live check before any plan may call them load-bearing (PG-1): aggregate `fitToView` union world-bounds; unit scales of the fixture models; element world-bounds correctness for the outline overlay and overlay-scene rendering on the SVF2 branch; `getNodeName` behavior for a dbId or model that has just been unloaded (guard on the live model list); DockingPanel subclass lifecycle. Existing-code note recorded, not changed: the `ClashFinderExtension.js` comment near line 388 says unlisted models "become visible again"; per the bundle a non-empty array **hides** unlisted models (the behavior the repo actually relies on is consistent with the bundle). The design degrades safely if any item fails: no element bounds → location marker only (or none; fit and isolate still apply); no union framing → fit the first live side; isolation prerequisite unmet → **Isolate disabled** (§9.5), never a clear-all fallback.

---

## 17. Open questions, dependencies and owner decisions

Alternatives are recorded; each has a recommendation; none is silently resolved. "Blocks" says what the decision gates.

| ID | Decision / dependency | Alternatives | Recommendation | Blocks |
|---|---|---|---|---|
| OD-1 | Panel code location | (a) top-level `clashpanel/` (b) under `wwwroot/` | (a) | implementation plan |
| OD-2 | Large-set rendering | (a) pagination (b) virtualization (c) both | (a) | plan |
| OD-3 | Partial results during a run | (a) none (b) new Core partial-snapshot API (reopens frozen Core) | (a) | none for v1 |
| OD-4 | Modes in v1 | (a) Hard + Soft (b) all four | (a) — others are time-sensitive (OQ-12) and containment meets the P5 ordered-pair reader decision | plan; SPEC OQ-12 |
| OD-5 | Clash emphasis technique — **reframed after independent review H1** | (a) **markers-only in v1** (Panel-owned overlay markers/outlines + fit + guarded isolate; no Viewer theming) — the rollback-safe design constraint; (b) theming later, only under a **separate, enforceable exclusive-theming ownership contract** (host-guaranteed exclusive scope, or a shared theming arbiter, or another readable/owned highlighting mechanism) designed, reviewed and authorized on its own | (a). This is not a free product preference: theming has no readback, so it cannot be offered in v1 without a new ownership contract. The owner's decision is to accept markers-only as v1 and whether (b) is ever pursued | plan (acceptance of (a)); (b) is deferred |
| OD-6 | Back to All camera | (a) do not move camera (b) capture/restore viewpoint (c) fit all | (a) least surprise | none |
| OD-7 | Previous results on a new run | (a) replace immediately (b) keep until the new run seals | (a) simpler; (b) needs two live sets against `maxResidentResultSets` | plan |
| OD-8 | **modelKey/modelVersion policy — OQ-1** (host composition; not Panel core) | per §11.1: fresh key per load + host-supplied version witness; or a stable cross-reload derivation (needs the reload-digest investigation) | interim fresh-key policy **for live acceptance only**, if the owner accepts; the real derivation stays OQ-1 | **integration acceptance** (not design/build) |
| OD-9 | Default clearance (OQ-3) | (a) no default, required entry (b) prefill 0.05 (the extension's provisional value) | (a) | none |
| OD-10 | Marker helper | (a) duplicate ~100 lines in the Panel (b) extract from `ClashFinderExtension` into a shared module (touches an existing extension) | (a) | plan |
| OD-11 | v1 grouping set | (a) None + Element (b) also model-pair (`pairModels`) | (a); (b) is a cheap owner pull-in | none |
| OD-12 | Coexistence with Clash Finder/Room Locator | (a) not used simultaneously + ownership guard (b) coordinate via a shared isolation arbiter (new shared module) (c) retire the old extensions | (a) | plan |
| OD-13 | Soft/clearance validity and unit display — **reframed after independent review H2** | **Part 1 — computation validity (correctness prerequisite, not a display choice):** Soft is available only with a verified common measurement basis (§6.2 step 4, PD-17); otherwise unavailable and Hard remains. The evidence that satisfies it is a host-composition requirement (PR-BASIS, PG-5). Owner action: accept the fail-closed rule and the host-evidence dependency, or choose to defer Soft from v1 entirely. **Part 2 — display wording (only after Part 1 holds):** (a) "scene units" (b) the verified common unit label from the Viewer API | Part 1: accept fail-closed. Part 2: (a) until PG-5 establishes a verified common unit | plan (Part 1); none (Part 2) |
| OD-14 | Qualified-claim acceptance (OQ-16) | ship v1 with `hierarchyInternalAcceptance: null` (claim blocked when hierarchy-internal ≠ ∅) or enable a recorded acceptance | ship blocked | none |

Dependencies recorded (not implemented; each blocks only what is stated):

| ID | Dependency | Blocks |
|---|---|---|
| PR-OQ1 | OQ-1 modelKey/modelVersion derivation (spec §24 vs master G-OQ1 wording conflict recorded, unresolved) | integration acceptance |
| PR-OQ17 | Who calls `invalidateModelPlacement` when a model moves | integration acceptance; freshness accuracy |
| PR-HOST | Host composition: **load models as SVF2**, build world/engine/enumerator, `wireModelUnload`, **register models and re-register after reload (OQ-1)**, supply the read-only `ModelCatalog`, static `/clashtest` + `/clashpanel` route, extension registration. Registration/identity/unload wiring are **never** Panel core (PD-18, §5.1) | live acceptance / implementation |
| PR-BASIS | Host supplies `ModelCatalog.measurementBasis(modelKeys)` with **evidence** of a common world-coordinate/unit basis for the participating models (e.g. equal `getUnitScale()` plus a verified shared world frame, or one evidenced load-time normalization — what suffices is settled under PG-5). No Core change; no new unit system. Without it Soft is unavailable (fail closed) *(Superseded by §23 (2026-10-07): Soft stays selectable with a host-verified, user-supplied or raw-model-units basis; Run is blocked until a basis is chosen; §23.2/§23.7 are authoritative.)* | Soft availability in integration/live acceptance; not the headless build |
| PG-1 | Viewer API evidence for the §16 list (isolation, framing, element bounds, overlay scene, DockingPanel; **not theming**), live-checked against **SVF2**-loaded models (the current read is not SVF2-specific) | implementation plan, for the affected features |
| PG-2 | First live engine run over real **SVF2-loaded** models, with SVF2 verified as a precondition (AC-15(d) acceptance file does not exist); README says the engine is verified only with fakes | Panel live acceptance |
| PG-3 | Measurement of result counts, planning/run latency, memory, and the synchronous Result-Set capture pause of each Core derivation (§7.3) on live content; G-CAL/G-RESP stay open | any claim about scale; page-size/virtualization revisit |
| PG-4 | **SVF2 verification of the model-format-sensitive assumptions F1–F8 (§2.1)** — the completed Adapter/T3 evidence is SVF non-OTG only. Timing **adjudicated by the independent Work review (RQ-1): (b)** — before integration/live acceptance, not before headless Panel implementation; the future implementation plan makes it a package-scoped gate | integration tasks and live acceptance (not the headless package or UI shell) |
| PG-5 | Live verification, on the SVF2 fixture models, of the measurement-basis evidence (unit scales, shared world frame) that PR-BASIS relies on, and of the resulting Soft availability/unavailability behavior | Soft in live acceptance |
| PV-2 | Confirm that direct-definition runs with a Panel-minted `testId`/`revision` persist cleanly to the default in-memory store (no `IdentityConflictError`/revision conflicts) | plan |
| PV-3 | Residency contract is specified in §7.6 from `residency.js`/`engine.js` (one-shot lease; `saved`-only retain; `acknowledgeUnsaved`); planning confirms it with tests for every persistence state, including timeout-then-saved and disposal during an active run | plan |

**Verified to be independent of a first Panel** (with the doc basis in the handoff and reviews): the two frozen-Core Mediums (lease-dead checkpoint, duplicate `owner-mapping-mismatch` — the Panel merely tolerates both, §13); the four optional walk-helper checkpoints (Low); OQ-16 (v1 ships fail-closed); G-CAL/G-RESP (no ETA/SLO claims); G-REMOTE (v1 uses in-memory stores); the P5 ordered-pair status-reader decision (v1 offers only unordered modes); G-EC (`elementCount` not consumed); AC-17/AC-19 conjuncts.

---

## 18. Explicitly deferred from v1

Any model-format selector or a plain-SVF v1 loading path (SVF2 is the required v1 path, PD-15) · containment and surface-intersection modes · saved/persisted tests and persistent result stores (G-REMOTE) · annotation layer and system grouping or filtering (level/category/model-pair single-level grouping shipped — §25) · assembly/parent roll-up · issue/approval/assignment/status workflow (SPEC §23 item 2) — including any "new/active/resolved" vocabulary (the comparison class `resolved` is a rerun-diff fact, not a workflow state) · comparing two runs in the UI (`compareResultSets`) · partial browse during a run · virtualization · camera restore · Viewer selection sync and picking a clash from the Viewer · cross-reload resume/re-attach · location-cell grouping · multi-level/nested grouping, run history and result lifecycle (explicit non-goals, §25; a **session-scoped** Clash Tests manager is no longer deferred — §26 — but any persisted/cross-reload manager remains deferred) · advanced run options (broad phase, unit sizing, persist) · suites/scheduling/multi-mode composites · ETA, CPU/RAM/heap telemetry · migration or retirement of the Clash Finder/Room Locator extensions · registry change notifications and refreshing the stale "live acceptance pending" README wording (both are Adapter-adjacent; recorded, not requested) · pre-run ancestor/descendant overlap detection · text search across unloaded models' element names · per-pair/per-element coverage display via `getPairStatus`/`getElementStatus` (needs an async reader precomputation — a Core follow-up — and the P5 ordered-pair decision) · `retryPersist`/persistence UX · Panel isolation when `getAggregateIsolation` read-and-compare is unavailable (Isolate stays disabled) · **Viewer theming-based emphasis and any exclusive-theming mode** (needs its own enforceable ownership contract; OD-5(b)) · Soft mode for multi-model tests without a verified common measurement basis (fail closed until PR-BASIS/PG-5) *(Superseded by §23 (2026-10-07): Soft stays selectable with a host-verified, user-supplied or raw-model-units basis; Run is blocked until a basis is chosen; §23.2/§23.7 are authoritative.)* · any model registration, re-registration, identity derivation or unload wiring inside the Panel (host composition).

---

## 19. Doc/code disagreements that affect this design (code is authoritative)

1. **No planning-stage progress.** Code never sets phase `planning` and publishes no snapshot/event during binding/enumeration/planning (the snapshot stays `queued` until plan adoption); SPEC §9.2 rule 6 (enumeration counters) is unimplemented. → the `preparing` indeterminate state (§7.1).
2. **Empty operand seals `partial`** in code; SPEC §6.6.4 says `full`. Fail-safe; the Panel reads the sealed axis.
3. **Registry surface.** SPEC §4.3/§18 name `engine.register/unregister/notifyPlacementChanged`; code exposes only `engine.registry.*` plus `engine.invalidateModelPlacement`. The Panel uses the code's surface.
4. **`ModelKeyVersionConflictError` fields** differ (`seen/offered` vs `existingVersion/offeredVersion`).
5. **Diagnostics shape.** SPEC §13.1 `diagnostics.retained`/object `countsByReason` vs code `diagnostics.diagnostics`/array rows. "Copy diagnostics" follows code.
6. **`witness.kind`** is any non-empty string in code (SPEC: two values); the Panel never branches on it.
7. **`progress` events** are specified but only `state`/`unit`/`persistence` were observed; drive UI from those plus `getSnapshot()`.
8. **`caveated` facet** is true only for `covered-caveated`; per-row "not fully verified" uses the cached `caveated` filter mask (§7.5, AC-P4) — `getPairStatus`/`getElementStatus` are never called on any interactive path. *(Corrected 2026-10-10, independent Work review M2; the earlier wording "therefore uses `getPairStatus`" was stale.)*
9. **Two `elementRefKey` encodings** (SPEC §14.5 JSON vs `identity/ids.js` NUL-delimited, not exported). The Panel uses neither as identity; any local map key is presentation-only.
10. **Stale READMEs.** `clashtest/viewer/README.md` and the `clashtest/README.md` adapter row still say "live acceptance pending"; `docs/handoffs/latest.md` records T3 PASS 86/86, merged `04d7054`. Not changed here.
11. **Core barrel omits id helpers** (`makePairId`, `parseResultId`, `elementRefKey`) and free derivations; the Panel needs none (§8.1).
12. **Registration ownership wording.** Frozen SPEC §20 lists "model→`modelKey` derivation policy" under "the Panel owns". This design assigns it to the host-composition side of the Panel product (with OQ-1), not `clashpanel/core` (§5.1, PD-18).

---

## 20. Acceptance criteria for this design's later implementation (design-level; not an implementation plan)

- **AC-P1** Every control in §6.1 maps to a Core field or is absent; no definition/run option is invented.
- **AC-P2** For every status × axis combination in §7 the Panel renders a headline from the wording matrix and never the bare phrase "No clashes".
- **AC-P3** During a non-terminal run the Panel offers no result list and no ETA; Stop is enabled in every non-terminal state.
- **AC-P4** Filter/sort/group/page changes never call `startRun`, never mutate the Viewer, and never invoke a Core derivation per interaction; Core `groupBy` and the `caveated` `filter` each complete **one successful computation per `(generation, spec)`** (bounded retries of the same job allowed, §5.2) and their results are cached as masks; no `getPairStatus`/`getElementStatus` call occurs on any interactive path.
- **AC-P5** Selecting any result — including one outside the current page or hidden by filters — yields a defined page/detail state; Prev/Next follow §9.3.
- **AC-P6** After the awaited `clear()`/`dispose()` of every restore-table trigger (§9.6) the Viewer contains no Panel-owned markers/overlays, and isolation is restored or skipped as specified; a foreign isolation change is never clobbered, and **foreign theming is never read, cleared or overwritten** (the Panel issues no theming call at all, AC-P19).
- **AC-P7** After a model unload the result list, counts, filters and grouping still work; affected rows are marked unavailable; no Viewer action is attempted for an unresolvable side.
- **AC-P8** After a reload no result resolves as `live` unless generation and version both match provenance.
- **AC-P9** Each §13 row is reproducible with a fake engine, with the specified headline and retained-results behavior.
- **AC-P10** `clashpanel/core` passes a layering guard: no Viewer/DOM globals; imports only the `clashtest/` public barrel and siblings; nothing in `clashtest/`/`collision/` imports `clashpanel/`.
- **AC-P11** The Panel introduces no exported option, constant or documentation presenting a presentation constant as an engine limit or as calibrated.
- **AC-P12** No display of `provenance.models[].elementCount`.
- **AC-P13** A model or element name containing markup (e.g. `<img src=x onerror=…>`) is rendered as inert text everywhere (rows, chips, detail, banners, diagnostics preview).
- **AC-P14** Residency: for each persistence state (`saved`, `pending`→`saved`, `pending`→`failed`, `failed`, `skipped`), replace / Clear / dispose / disposal-during-active-run neither throws unhandled nor leaks a lease or slot, and an unsaved set is dropped only after explicit acknowledgement; an admission failure on Run preserves the previous results and Viewer state.
- **AC-P15** Supersession: a late `done`, `summarize`, `groupBy`, mask, `getFreshness` or `assessNoClashClaim` from a superseded run/generation never changes the displayed state; the old run's set is still released.
- **AC-P16** Presentation transaction: an injected failure — including a throw *after* the Viewer call already changed state — at each step (markers, isolation, fit) and each interleaving of `present`/`present`/`clear`/`dispose` leaves the Viewer with exactly the newest surviving token's resources (or none), never a stale marker/isolation from a superseded token; a foreign isolation change is never overwritten; with the isolation prerequisite unmet the Isolate control is disabled and no `setAggregateIsolation([])` is ever issued by the Panel.
- **AC-P17** In grouped view, selecting an occurrence under a group keeps page/scroll/`navScope` on that occurrence after re-sort and filter changes while detail/Viewer state keyed by `resultId` is unchanged.
- **AC-P18 (amended 2026-10-07, §23 — Soft is no longer disabled; see §23 for the replacement criteria)** Soft availability (PD-17): with a fake `ModelCatalog`, Soft is available iff |participating models| = 1 or `measurementBasis` returns `verified`; `incompatible`, `unverified`, a missing method, a throw, a timeout and a malformed verdict each disable Soft with the fixed explanation, keep Hard available, disable Run if Soft was selected, and never display a unit-converted or "approximate" Soft result; Hard runs are unaffected.
- **AC-P19** Markers-only (PD-16): a fake Viewer fails the test if `setThemingColor`, `clearThemingColors` or any theming call is made in any `present`/`clear`/`dispose` path or interleaving; pre-existing (foreign) theming state in the fake is unchanged after every restore-table trigger.
- **AC-P20** Registration boundary (PD-18): the `EnginePort` handed to `clashpanel/core` exposes no `register`, `unregister`, `invalidateModelPlacement` or `wireModelUnload`; a fake engine that throws on any of them proves the controller never calls them; an absent or stale binding yields the §9.1/§11.2 unavailable states and a disabled Run with no registration attempt.
- **AC-P21** Shell thinness (PD-19): the DockingPanel adapter holds no controller/domain state — rebuilding the DOM from the controller's view-model after hide/show or re-creation reproduces the same setup, run, filter, group, page and selection state; the view has no Viewer reference; each of the five §14.3 regions renders from the view-model alone.

---

## 21. Risks

- **First live use of the engine.** The whole-engine path over a real `CollisionWorld` + `LocalUnitExecutor` has only been exercised with fakes; Panel acceptance will be its first live run (PG-2). Failures found there are expected and must be triaged against Core, not silently absorbed by the Panel.
- **Unmeasured scale.** Result counts, latency and memory are unknown (PG-3); page size and the pagination/virtualization choice are revisitable on measured data.
- **Measurement-basis validity for Soft** (OD-13 Part 1, PD-17): until the host supplies a verified common basis (PR-BASIS, PG-5), Soft is unavailable for any multi-model test; single-model Soft and all Hard runs are unaffected. Delivering Soft in v1 depends on that host evidence. *(Superseded by §23 (2026-10-07): Soft stays selectable with a host-verified, user-supplied or raw-model-units basis; Run is blocked until a basis is chosen; §23.2/§23.7 are authoritative.)*
- **SVF2 is unevidenced for the Adapter** (§2.1, PG-4): the v1 target format has no completed live evidence. Adapter fail-closed checks turn an SVF2 inconsistency into `enumeration-failed`, but a systematic SVF2 incompatibility would make the first live SVF2 run fail at planning; this would be triaged against the Adapter/Core under a separate owner authorization, not absorbed by the Panel.

**RQ-1 (was a question for the independent Work review; answered).** The independent review chose option (b): SVF2 verification of F1–F8 is a prerequisite before integration/live acceptance, not before headless Panel implementation (§2.1, PG-4). It is a gate classification, not an owner decision; the SVF2 verification task remains a separate, not-yet-authorized activity (the Adapter must not be modified and no live test is run by this design work).
- **Viewer API drift/uncertainty** for isolation events, framing, element bounds and the overlay scene (PG-1) — mitigated by the degradations in §16.
- **Shared-isolation clobber** with the two existing extensions (OD-12).
- **`enumeration-failed` is opaque** (Core surfaces no sub-cause), so Panel wording can only offer likely causes and pre-run readiness checks.

---

## 22. Review disposition and stop gate

**Internal review** (`docs/reviews/2026-09-26-viewer-clash-panel-design-internal-codex-review.md`): round 1 `codex-review spec` (3 Critical / 3 High / 3 Medium, all verified and remediated) and a targeted round 2 `codex-advisor` (2 High / 2 Medium, all remediated); stopped under the convergence rule. The internal review is not an independent gate.

**Independent Work design review** (`docs/reviews/2026-09-26-viewer-clash-panel-design-independent-review.md`): *revise design before owner acceptance* — 0 Critical / 2 High / 1 Medium / 1 Low. Disposition in this revision: **H1** accepted — markers-only emphasis, no Viewer theming, exclusive-theming deferred (PD-16, §9.2, §9.5, §16, OD-5, AC-P19); **H2** accepted — Soft fails closed without a verified common measurement basis, Hard unaffected (PD-17, §6.2 step 4, §16, OD-13, PR-BASIS, PG-5, AC-P18); **M1** accepted — registration/identity/unload wiring/re-registration are host composition, the Panel port is `bindingFor`-only (PD-18, §5.1, §5.2, §11.1, PR-HOST, AC-P20); **L1** accepted — `derivations.filter` added to §0 Q1. Its RQ-1 disposition (SVF2 verification before integration/live acceptance, not before headless implementation) and F1–F8 adjudication are unchanged. The v1 UX structure and the `DockingPanel` shell constraint were made normative (§14, PD-19, AC-P21) at the owner's direction. A **targeted** internal check of exactly these changed areas is recorded as round 3 in the internal review record; no unrestricted re-review was run.

**Bounded independent re-review and owner acceptance.** `docs/reviews/2026-09-26-viewer-clash-panel-design-bounded-independent-rereview.md`: *ready for owner acceptance*, 0 Critical / 0 High / 0 Medium / 2 Low (stale internal-review theming/PG-1 wording; stale spec working-tree parenthetical — both corrected as documentation only, no design change). H1, H2, M1, L1 confirmed resolved; RQ-1 = (b) and the SVF2 direction confirmed consistent. **The owner explicitly accepted this design (2026-09-26).** Remaining OD items stay deferred owner/product decisions unless explicitly resolved later; OD-8 remains an OQ-1/integration policy decision.

**Stop gate.** Acceptance closes the design gate only. Unless the owner explicitly authorizes each step, the following must not begin: Viewer Clash Panel implementation planning, a Panel branch, any `clashpanel/` code or test, host integration (`wwwroot/`, `server.js`, extensions calling `wireModelUnload`), OQ-1 derivation, SVF2 live verification, reload-digest investigation, changes to the Viewer Adapter, Core or M4, remote persistence, annotation work, new public limits, or pushing.

## 23. Owner-decision addendum 2026-10-07 — Test Setup / Interaction UX cleanup

Authority: owner prompt `docs/prompts/for-claude-viewer-clash-panel-test-setup-interaction-ux-cleanup-package.md`. This addendum supersedes the "Soft disabled" wording of §6.2 step 4, PD-17, OD-13 Part 1, the §14 mockup line "← when unavailable" and AC-P18. It does **not** change collision math, the G2 acceptance procedure, or any Core invariant.

**23.1 Why Soft stays selectable.** Core's `clearance` is one finite, unit-less world-space number compared with raw distances; the collision layer never converts between models. So the question "can this threshold be compared?" is answered by *who attests the basis*, not by a unit conversion. "Not auto-verified" therefore means "needs a basis from the user", not "these models cannot be clash-tested". Hard is unaffected in every case.

**23.2 Basis states** (exactly four; Panel-local; never part of the sealed Result Set):

| State | When | Clearance meaning | Label |
| --- | --- | --- | --- |
| `verified` | host `measurementBasis` verdict is `verified`, or exactly one model participates | unchanged raw Core number, shown as "scene units" | "verified" (only here) |
| `user-supplied` | verdict not verified **and** the user attested a unit (`mm`, `cm`, `m`, `in`, `ft`) | the user attests **all participating models are in that unit** and enters the clearance **in that same unit**; the number reaches Core **unchanged** | "user-supplied, not verified" |
| `raw-model-units` | verdict not verified **and** the user chose "Model units (raw, unverified)" | the number is interpreted in whatever units the Viewer coordinates use; no physical unit is implied | "raw model units, not verified" |
| `unavailable` | Soft selected, verdict not verified, nothing chosen yet | — (Run disabled with "Choose the units/basis for this Soft test.") | — |

**23.3 No hidden assumptions.** No unit conversion, no unit guessing, no silent scale fallback: a declared unit is an *attestation and a label*, and the clearance is never rescaled. Mixed units across models cannot be expressed (one attestation covers the whole participant set); a user who knows the models differ must not attest. The attestation is bound to the current participant set: any change of Set A/Set B/self-clash that changes the participating models drops it, so an attestation for A+B can never apply to A+C. `New test` clears it. A pending host verdict still blocks Soft ("Checking…", fail closed). A user-supplied or raw basis is **never** recorded or displayed as `verified`; Run details record the state captured at run start. Soft gap values in results stay "scene units" (no back-conversion).

**23.4 Wording.** Primary: **"Soft clearance needs a measurement basis. Hard clash is available."** and **"Measurement basis was not verified automatically. Choose the units/basis to run a Soft clearance test."** The host's reason is secondary ("Details: …").

**23.5 Test Setup action row.** `New test` (neutral/secondary) sits at the top, **left of** `Hide setup`/`Show setup`, expanded and collapsed. It is disabled while a run is active. Reset semantics (unchanged, now documented): it creates a blank draft (new test id, name "Clash test N", Hard, empty sets, no clearance, no basis attestation), retires the displayed results, clears the Panel's overlays/isolation, resets run bookkeeping and re-expands Setup. The existing confirmation ("discard unsaved results?") is kept **only** when held results are unsaved — the one real state-loss case; no new confirmation is added. (*§26.8, 2026-10-10:* in a Panel hosting the Clash Tests manager, `New test` performs manager **Create** — a new record becomes active and the previous test's definition is kept — instead of this in-place reset; enablement and the unsaved-results confirmation are unchanged. The standalone editor keeps the in-place semantics.)

**23.6 Status wording.** Idle shows just "Idle" (readiness is shown once, in Test Setup); a headline that already starts with the state label replaces it ("Completed — 491 clashes", not "Completed · Completed"); the live region is visually hidden but still announced; cancelled runs read "Stopped".

**23.7 Replacement for AC-P18.** (a) With a fake `ModelCatalog` whose `measurementBasis` is missing/throws/times out/malformed/`unverified`/`incompatible` and ≥ 2 participating models, Soft stays selectable, Run is disabled until a basis is chosen and a valid clearance entered, and the definition's `clearance` equals the typed number. (b) The recorded and displayed basis is `user-supplied`/`raw-model-units`, never `verified`; `verified` appears only for a host `verified` verdict or a single model. (c) Changing the participant set or `New test` drops the attestation. (d) Hard is ready regardless. (e) Zero/negative/non-numeric clearance is rejected in every state. (f) A pending verdict blocks as "checking".

## 24. Owner-decision addendum 2026-10-07 — Normal-app integration, metadata-driven model identity, overlap = self-clash

**24.1 Normal-app availability.** The Clash Panel extension is registered **and auto-loaded on the flag-free default URL**. `?clashPanelDemo=1` is a *fixture bootstrap only* (loads the two evidenced Audubon SVF2 models, skips the initial hash load); it is not a feature gate. `?svf2=1` / `?clashPanel=1` are harmless legacy aliases. The Panel works over whatever Viewer models are loaded (catalog = `viewer.getAllModels()`).

**24.2 Default environment (owner decision; PD-15 satisfied).** The default initializer is now **SVF2** (`AutodeskProduction2`, `streamingV2`). Consequence recorded, not resolved here: the Room Locator and Clash Finder acceptance suites (`npm run test:acceptance`, `:clash-finder`) were written for legacy SVF and fail under the SVF2 default (observed 2026-10-07: Room Locator name-search/fitToView failures; Clash Finder fixture dbId/pair mismatches). On legacy SVF Room Locator passes and Clash Finder has 5 pre-existing marker-pixel failures. **These are explicit open compatibility regressions / blockers (owner confirmed 2026-10-07: keep SVF2 default; do not revert to legacy SVF; do not change the default or the acceptance suites to make them pass).** Reconciling Room Locator and Clash Finder with SVF2 is separate work that is not authorized by this package.

**24.3 Model naming (metadata-driven; one resolution path for demo and normal app).** Order: (a) source-document name = nearest ancestor of the model's `bubbleNode` with `data.role === 'viewable'` (trailing file extension stripped; the live demo models yield `Audubon_Structure_clash_test` / `Audubon_Mechanical_clash_test`); (b) the bubble node's own name (live demo models both return `New Construction`, so (a) must win); (c) an optional, explicit host/fixture fallback label (none is supplied by default); (d) `Model <n>`. No URN→friendly-name mapping exists any more. Duplicate labels are disambiguated by `labels.js` without changing identity.

**24.4 Identity vs display identity; self-clash.** **Model identity is never inferred from a display name.** A loaded-instance identity is the host `modelKey` = `${urn}#${loadSeq}` — a per-page counter assigned once per Viewer `Model` object and never reused, so the same URN loaded twice yields two distinct identities (appropriate: the Viewer treats them as separate loaded instances/placements). Two different models may share a display name. A model present (whole-model or element selection) in **both** Set A and Set B, compared by `modelKey` only, is a **self-clash** for that exact loaded instance (Core already plans same-model cells, §7.5); different instances sharing a label are *not* a self-clash. The setup shows `Self-clash: <name> is in both sets.` as an informational note. Soft with a single participating model remains available (|P| = 1, §6.2 step 4).

**24.5 The remaining checkbox.** It is retained as a *mirror shortcut* (Set B := Set A, including element-level selections; hides the Set B picker) and relabelled "Compare Set A against itself (Set B = Set A)". It is no longer the only way to express a self-clash. No new pair-generation mode is introduced; Core and G2/C6/C8 are unchanged.

**24.6 Compatibility remediation status (2026-10-07).** Room Locator acceptance now passes under the SVF2 default (suite fixtures resolved by stable Revit ElementId at runtime; no product change). Clash Finder's fixture identity is resolved the same way, but its suite still fails under SVF2 for reasons inside the collision library / SVF2 geometry (missing containment pair from a non-manifold SVF2 flange mesh; two Architecture fragments that never load; Soft clearance aborting with `clearance-anisotropic-scale-unsupported`). These remain **open, explicitly unresolved compatibility debt** pending an owner decision; see the package final report §10.

## 25. Owner-decision addendum 2026-10-08 — Single-level result grouping modes (2026-10-08)

Authority: owner brief `docs/reviews/for-claude-clash-test-result-grouping-navigation.md`. Supersedes the deferral of category/level/model-pair grouping in §0 Q9, §10.2 and §18. Code is authoritative: `clashpanel/core/groupModes.js` (registry), `propertyGrouping.js` (Category/Level builders), `elementProperties.js` (property read), `controller.js`, `viewModel.js`, `ui/render/filters.js`. No Core, collision-math or G2/C6/C8 change.

**25.1 Modes and non-goals.** Group radio: **None, Element, Model Pair, Category, Level**; exactly one active at a time (view preference; survives Clear / New run). **Explicit non-goals:** multi-level/nested grouping ("Then by"), a Clash Tests manager panel (*superseded 2026-10-10 by §26 for a session-scoped manager only*), multi-test persistence, run history, New/Existing/Resolved lifecycle. A mode is a descriptor in `groupModes.js` (`compute`, `labelOf`, optional `unavailableText`); nothing else in the controller is mode-specific. Element stays multi-valued (with its note); the other three are single-valued (each clash in exactly one group, counts add up).

**25.2 Stable group identity.** `groupId` is independent of display text; duplicate labels never merge groups. Model Pair: Core's `pairModels` facet id. Category/Level: `JSON.stringify([modeId, key])` (mode-prefixed so ids never coincide across modes; a group-scoped navigation never survives a mode switch). Members are in canonical result order; default group order is the identity order (known values before missing), overridable by Sort "Group size"/"Group name" (Panel-side).

**25.3 Model Pair.** Identity = the `modelKey` pair, never a display name (§24.4). Unordered in practice: for volume-overlap/clearance Core's PairId orders first ≤ second, so A×B and B×A share one facet value and one group. Self-clash = `[A, A]`, labelled "A ↔ A". Label = `modelName(a) ↔ modelName(b)`; duplicate display names are disambiguated (modelKey suffix) and remain distinct groups; no host name ⇒ fallback `Model <key>`.

**25.4 Category.** Side value = the element property `Category` with `displayCategory === '__category__'` (raw string, e.g. `Revit Walls`; missing/empty/non-string ⇒ missing). Group = the unordered pair of raw categories; same category on both sides ⇒ a single label (`Walls`). Display strips a leading `Revit ` (display only; the key keeps the raw string); missing ⇒ `Unknown category`. If two distinct raw values (or a real value and the unknown label) display alike, the raw text is appended (`Walls (Revit Walls)`). Never derived from dbId or geometry.

**25.5 Level (owner-approved per-side level pair).** Side value by fixed precedence, first non-empty wins: (1) the `Level` property with `displayCategory === '__internalref__'` holding a numeric dbId, resolved to that Level element's name in the same model (second, unfiltered bulk read; trailing ` [digits]` stripped, e.g. `FIRST FLOOR [30]` ⇒ `FIRST FLOOR`); (2) `Level` with displayCategory `Constraints`; (3) `Reference Level`; (4) `Base Level`; (5) `Base Constraint`; none ⇒ `Unknown Level`. Group = the unordered pair of names (code-point order); equal names collapse to one label; a clash spanning two levels is its own pair group. Identity is the raw name with **no cross-model normalization**: equal names from two models are one level, but `Arch-FIRST FLOOR` and `FIRST FLOOR` are two. **No world-Z fallback.**

**25.6 Evidence coverage (probe evidence; Viewer 7.124.2, SVF2 only — a pinned-build assumption, not a contract on other builds/formats).** Category present on 100% of elements on all three Audubon models. Level coverage: Architecture 97.8% (union of sources), Structure 100%, Mechanical 100% as a union but only 39%/49% from the internal-ref source alone (hence the precedence chain). Assumed build behavior: `model.getBulkProperties2(dbIds, {propFilter}, onSuccess, onError)`; a `propFilter` of `['Name']` drops the row `name`, so Level-element names come from an unfiltered read. Other builds/formats must be re-probed before relying on this.

**25.7 Property read design.** Per distinct dbId appearing in the displayed results (both sides), chunks of ≤ 2000 ids (`PROPERTY_CHUNK_SIZE`), one scheduler yield per chunk, generation-guarded (a stale answer is dropped), memoized once per result generation and shared by Category and Level (Level adds one unfiltered read of the referenced Level elements). Falls back to `getBulkProperties` when `getBulkProperties2` is absent. A model unload invalidates the cache and drops cached metadata outcomes. Failure (`properties-unsupported`/`properties-error`) or a participating model that is not loaded ⇒ the mode is **unavailable** ("Category grouping is unavailable (…) — showing the flat list."), never guessed groups; `Unknown` means only "the element reports no such metadata". There is **no read timeout**: a read that never answers leaves the mode pending (busy, flat list) until the next generation/unload — recorded limitation, not debt to fix here.

**25.8 Missing metadata.** A missing side is the reserved null sentinel (sorts last; a real value named "Unknown category" stays a distinct group). A clash with one missing side groups as `X ↔ Unknown …`; both missing ⇒ the single `Unknown …` group.

**25.9 Filtering, sorting, navigation.** Grouping applies to the filtered list: group counts reflect filtered members ("n of m" as in §10.2); empty groups do not render. Sort "Group size"/"Group name" orders groups; items keep canonical order within a group. Prev/Next steps within the origin group when group-scoped; the "(within its group)" suffix appears only when the scope group is still present in the current grouping and expanded (otherwise navigation is whole-list and the suffix is absent; a scope group filtered away or from another mode is dropped). Two previously observed Lows are **closed**: grouping and multi-valued notes are suppressed over an empty filtered list, a filter-mask error and the list-less error state (`listShown`); and no stale "(within its group)" after the origin group is filtered away.

**25.10 Large results (4,770-clash Architecture self-clash, headed measurements).** Cold switch: Model Pair 13 ms, Category 7 ms, Level 7 ms; Element 611 ms (a single long task); warm switches 5–17 ms; expanding a 4,143-row group 24 ms. No virtualization was introduced or found necessary.

## 26. Owner-decision addendum 2026-10-10 — Clash Tests Manager (session-scoped v1)

Authority: owner brief `docs/reviews/for-claude-clash-tests-manager.md` (2026-10-10), which reopens the "Clash Tests manager" non-goal **for a session-scoped manager only**. Supersedes: the "multi-test suites" deferral in §0 Q9, the "a Clash Tests manager" entry of §18, the "a Clash Tests manager panel" non-goal of §25.1, the "one test = one Panel draft" reading of the §6.1 *Draft identity lifecycle*, and the in-place reset semantics of the §23.5 `New test` control **when the Panel hosts the manager** (26.8). It does **not** supersede §25's other non-goals (multi-level grouping, multi-test persistence, run history, New/Existing/Resolved lifecycle), §7.6's one-held-set rule (26.3 keeps it), or any Core/Adapter/collision contract. No `clashtest/`, `clashtest/viewer/` or `collision/` change; the narrowed `EnginePort` (`clashpanel/core/ports.js:33-46`) is unchanged and is not widened. Code read for this addendum (authoritative): `clashpanel/core/controller.js`, `draft.js`, `residency.js`, `generation.js`, `viewModel.js`, `ports.js`, `labels.js`, `resolve.js`, `clashpanel/viewer/ViewerBridge.js`. **Status:** design addendum only; implementation is not authorized (brief "Gate determination").

**26.1 Scope and explicit non-goals.** In scope (v1, current Viewer session only): create a test; list several tests; per row the name, Set A/Set B summary, Hard/Soft, run status and result count; open/edit an existing test; duplicate; delete and reset with safeguards; an active-test state; per-test model readiness / "models changed" state when loaded models change. **Non-goals (unchanged or new):** persistence across reload or any cloud/server/local storage (all manager state is in memory and is lost on reload or Panel disposal — every destructive confirmation and the empty-run copy say "for this session"); run history (a test keeps at most its **last** run summary, 26.4); New/Existing/Resolved comparison; issue lifecycle; multi-level grouping; more than one running test; background runs of non-active tests; re-attaching a test to a reloaded model (26.6); unrelated Low remediation; G2/C6/C8/G3; reflected-fragment and R20-1 work.

**26.2 Architecture: a manager layer around the unchanged single-test editor.** A new headless module in `clashpanel/core/` (name fixed by the plan; same layering guard as AC-P10) owns the **test records**, the **active-test id**, the **session test counter** and the manager's own view state. It drives exactly **one** existing Panel controller (`createPanelController`, `controller.js:40`) for the whole Panel lifetime — the *editor* — which continues to own the active test's draft, validation, Soft availability, run handle, residency, results pipeline, selection and every ViewerBridge call. The manager never calls the engine's run/residency methods, never calls the ViewerBridge's `present`/`clear`, and holds no `Model` object. It reads the catalog, `registry.bindingFor` (through the same narrowed port) and `bridge.onModelLeft` only for per-test readiness (26.6). The editor's draft model (`draft.js`), `prepareRun` revision rule (`draft.js:190-198`), `startRun` admission ordering (`controller.js:289-319`), residency (`residency.js`) and all §6–§25 single-test behavior are reused **unchanged**.

*Required additive editor seam (plan requirement; recorded because the editor is not literally untouched).* Today the controller can only mint a fresh draft (`controller.js:54`, `newTest` at `controller.js:244-254`), keeps `heldUnsaved` private (`controller.js:155-161`, surfaced only as `vm.run.confirm` after an action), and exposes no draft or run summary to a caller. The manager therefore needs exactly these **additive** controller capabilities, each a no-op for existing single-test behavior: (a) a *load test* intent that performs the `newTest` path (`retireDisplayed` → adopt draft → reset run bookkeeping → `revalidate`) with a **supplied** draft instead of a minted one, forcing Soft re-evaluation (`revalidate(c, {reEvaluateSoft:true})`) so no previous test's basis evaluation can commit to the new draft. The intent carries `{draft, acknowledgeUnsaved}` (the consent comes from the manager's own confirmation, 26.2a). The load is **atomic**:
- Before **any** mutation it validates the supplied draft: a non-empty `testId`, and a well-formed `draft.js` draft for exactly that `testId`.
- After a successful load, the editor notifies and returns **only** that exact `testId`.
- An invalid or unknown id or draft is a rejected result (`ok:false`) with **zero** editor mutation and no notification.

It also checks preconditions **before** any retirement and refuses without side effects when a run is active, the editor is disposed, or `heldUnsaved` is true without `acknowledgeUnsaved`. Its observable completion is the value its `dispatch` resolves with (as `DIAGNOSTICS_COPY` already does, `controller.js:1281-1282`): `{ok, testId, version, releaseStuck, reason?}`. That value is mirrored by the same synchronous notification's `vm.test`. (b) A read-only `vm.test` snapshot: `{testId, draft (frozen), runActive, heldUnsaved, pendingConfirm, lastRun: summary|null}` (26.4). (c) An additive *cancel* intent for the editor's existing one-time confirmation: today `c.confirm` has only a confirm action (`controller.js:449-457`, `viewModel.js:67`). The new intent clears `c.confirm` and does nothing else. (d) Nothing else *(amended 2026-10-10, owner decision G-A2 on the independent Work plan review H2: plus one fourth additive seam (e), `INTENT.TEST_LABEL_SCOPE` `{modelKeys}`, which supplies the editor's label resolver with the manager's referenced-model-key scope so the same `modelKey` has the same label in the Tests list and the editor, CTM-2)* — no new engine call, no change to existing intents' semantics, no change to `retireDisplayed`, `startRun`, `dispose` or the residency module. If the plan proves (a)–(c) impossible without changing existing behavior, it stops and records a gate; it does not widen the port or re-architect the controller silently.

**26.2a Manager ↔ editor synchronization and pending operations (normative).**

*Subscription.* The manager subscribes **once** to the editor (`subscribe`, `controller.js:78-83`). It processes every notification **synchronously**, inside the notification callback. The editor notifies synchronously at the end of every state change (`touch`, `controller.js:98-106`), so no editor change can go unobserved. For each notification:

1. **Draft sync.** If `vm.test.testId` equals the committed `activeTestId` (or the `targetTestId` of the in-flight activation whose load result is being awaited), and `vm.test.draft` differs from that record's draft (by identity), the record's draft is replaced. Every admitted editor revision (edits, the revision adopted at admission, `controller.js:308`) is therefore in the record before the next intent runs.
2. **Summary reduction.** If `vm.test.lastRun` describes a terminal run whose `runId` differs from the record's `summary.runId`, it is reduced into the summary (26.4). Ordering: the seal notification is the `touch` at the end of `onRunDone` (`controller.js:415`). Every retirement runs later: `retireDisplayed` (`controller.js:327-343`) is reached only from a subsequent intent (Run, Clear results, New test, load) or from dispose. The summary is therefore always captured **before** any retirement, Clear or switch can null `displayed`. As a second guard, the manager re-reads `vm.test` and performs step 2 synchronously immediately before it dispatches any retiring intent itself.

*Pending operation.* Every manager action that needs confirmation or changes the active test creates the **single** authoritative object `pending = {operationId, kind: 'switch'|'create'|'delete'|'reset', sourceTestId, targetTestId?, expectedEditorVersion}`. While a pending operation exists, a new one cannot be created.
- `sourceTestId`: the record the operation discards from — the outgoing active test for a switch or create, otherwise the deleted or reset test.
- `targetTestId`: the record to activate — the switch target, the newly minted test, or the delete successor. Absent for a reset.
- `expectedEditorVersion`: the editor `vm.version` when the operation was requested.

Both identities are shown in the confirmation copy where relevant (26.9 `confirm` is derived from `pending`). Intents:
- `MANAGER_CONFIRM {operationId}` and `MANAGER_CANCEL {operationId}`. A confirm or cancel whose `operationId` is not the current pending operation is **ignored** (stale).
- **Confirm re-checks** the preconditions against the current editor ViewModel. If `vm.version ≠ expectedEditorVersion` and the outgoing test's `runActive`, `heldUnsaved` or `testId` changed, the operation is not executed blindly: it is re-evaluated and re-prompted, or refused with its reason.
- **Cancel** clears `pending` with no other effect.

While an operation is pending, every other manager action is disabled; the editor's own controls stay usable. While the editor's own confirmation is pending (`vm.test.pendingConfirm`), manager actions are disabled until it is confirmed or cancelled (26.2 (c)).

*Activation (switch, create, delete-of-active).* The steps run in this order:
1. Snapshot the outgoing record (draft sync and summary reduction above).
2. Dispatch the load intent with the target draft and `acknowledgeUnsaved` (true only if the confirmed prompt covered unsaved results).
3. Commit `activeTestId := targetTestId` **only** after the load result is `ok` and its `testId` equals `targetTestId`.

*Failed or cancelled activation.* A cancelled prompt or a rejected or refused load (atomic: zero editor mutation, 26.2 (a)) leaves `activeTestId` **unchanged**, and the editor still holds that test. A record created by Create is removed again if its activation fails, and the session counter is not decremented. A manager notice states the reason.

*Divergence recovery (defence in depth).* A divergence is either of:
- an editor-reported `vm.test.testId` that differs from the committed `activeTestId` while no expected activation is in flight;
- a load result or notification whose `testId` differs from the expected `targetTestId`.

On a divergence, the manager suspends draft sync and attempts **one** compensating load of the committed `activeTestId`'s record (its last snapshotted draft). If that load succeeds with the expected `testId`, the manager resumes and shows a notice. If it fails, the manager enters a terminal **manager fault** state:
- the list shows a fault notice;
- Open, Create, Duplicate, Reset, Delete and every editor run/edit action are disabled;
- the existing Panel Clear results and hide/dispose paths remain available.

While divergent or faulted, the manager **never** syncs a draft into a record by an editor-reported id that disagrees with `activeTestId`.

*Stuck release on a confirmed switch.* Chosen policy: commit only with the explicit acknowledgement. The editor's release is not transactional: `retireDisplayed` stops displaying the set before the engine release is attempted (`residency.js:122`). Activation therefore does **not** block on release success, and it never rolls back. Safety rests on the rule that an unsaved set can be dropped only after the explicit unsaved acknowledgement already given (26.3). A saved set's stuck release loses no data. Either way, the stuck set stays in the residency stuck list and is retried by every later release and `disposeAll` (`residency.js:94-101`, `145-148`). The editor's existing release-error banner remains shown (`load` reports `releaseStuck`), and no record claims the stuck set.

**26.3 Residency: only the active test holds results (default 1).** §7.6 is unchanged: the Panel holds **at most one displayed set**, and it always belongs to the **active** test. A non-active test holds **no** result set, no lease, no `ResultIndex`, no derivation cache and no freshness read; it keeps only the summary record of 26.4. Consequences:

- *Activation switch* (opening a different test) retires the outgoing test's displayed set through the existing `retireDisplayed` path (`controller.js:327-343`: generation bump, poll/listener teardown, `bridge.clear()`, `residency.release({acknowledgeUnsaved})`), exactly like `New test` today. `acknowledgeUnsaved:true` is passed **only** after the manager's confirmation of the pending operation (26.2a), which carries the "discard unsaved results?" wording and is shown **only** when `heldUnsaved` is true (§7.6, §23.5); confirmation copy: *"The results of “<name>” are held in memory only. Opening another test discards them — discard and open?"*. A saved/leased set is released without a prompt (same rule as `New test`). A release failure is reported by the editor's existing release-error banner and kept for retry by `residency.release` (`residency.js:94-128`); the switch still completes.
- *Switching while a run is active is refused*, not confirmed: Open, Create, Delete-of-active and Reset-of-active are disabled while the active test's run is non-terminal (`canStop`, `controller.js:145`), with the reason *"Stop the running test first."* Rationale: the run handle, its late `done`/`persisted` handling and its result adoption live in the one editor (`controller.js:349-426`); a background run would need a second residency slot and an undisplayed adoption path, breaking §7.6 and the one-shot lease discipline.
- *What a non-active test with a prior run shows:* its last status and result count from the summary, plus *"Results not held — open and re-run to view."* It never offers a result list, row, count of filtered results, freshness badge or no-clash statement, and opening it shows the editor **idle** with that test's setup (results are **not** restored; nothing is re-read from any store). A summary with 0 results reads *"0 clashes reported"* — never "No clashes" (PD-12; the claim needs a held set).
- *At most one running test* follows: only the active test can run, and it cannot be switched away from while running. This also matches Core (one active run per world, others queue; §7.2) and the single-owner ViewerBridge (26.5).

**26.4 Per-test record and identity (default 4).** A record is Panel-local plain data: `{testId, draft, summary|null, createdAt, seq}` where `draft` is the full `draft.js` object (it carries `testId`, `revision`, `lastRun.definitionKey`, so the §6.1 revision rule continues to hold across switches — re-running an unchanged definition after reopening the test reuses the revision and hence the `resultId`s), `seq` is the creation order, and `summary` is the **last sealed run only**:

| Field | Source (captured once, at seal, from the editor) |
|---|---|
| `runId` | `RunSummary.runId` (dedupes summary reduction, 26.2a) |
| `status` | `RunSummary.status` (`completed`/`cancelled`/`failed`/`invalidated`) |
| `resultCount` | `resultSet.results.length` (null when no set sealed) |
| `coverage`, `integrity`, `freshnessAtSeal`, `caveatCount` | the sealed set's outcome / progress counts, as already shown by §7.3 |
| `models` | `[{modelKey, bindingGeneration, modelVersion}]` copied from `resultSet.provenance.models` (identity only; for 26.6) |
| `definitionKey` | the `draft.lastRun.definitionKey` of the draft snapshot adopted at admission (`controller.js:308`) — available even when no set sealed (to compute "setup changed since run" for the row) |
| `startedAt`, `sealedAt` | Panel clock (`scheduler.now()`) |
| `resultsHeld` | derived, true only for the active test while the editor displays that run |

*Null result set.* A planning-stage `cancelled` or `failed` run seals with no set (§7.3; `summary.resultSet` null, `controller.js:411-413`). Its summary has `runId`, `status`, `definitionKey`, `startedAt` and `sealedAt` populated. `resultCount`, `coverage`, `integrity`, `freshnessAtSeal` and `caveatCount` are all `null`, and `models` is `[]`; such a run therefore never marks a row "Models changed" (26.6). The row reads the §7.3 headline for the status ("Stopped before any results", or the planning-failure cause), never a count. Nothing else of the set is retained (no `results[]`, no ledger, no provenance beyond the identity triples). An admission failure leaves the previous summary unchanged (consistent with §7.6). The active test's live status ("Running — *n* found", "Stopping…") is read from the editor's ViewModel, not stored.

*Identity.* `testId` = `mintId()` (the controller's injected UUID source, `controller.js:40`), minted on **Create** and **Duplicate** and for the initial test when the Panel first opens (§6.1, unchanged); never re-minted by edits, activation or Reset. Records are keyed by `testId`; names are display only and need not be unique.

*Naming.* A session counter starts at 1 and increments on every Create (never on Duplicate, never decremented, never reused after Delete); the default name is the existing `Clash test <N>` (`draft.js:39`; the brief's "Clash Test N" capitalization is not adopted — code is authoritative). The manager owns the counter; the draft's own `testCounter` (`draft.js:40,99`) is used only in the standalone editor. **Duplicate** = new record with a new `testId`, `revision: 1`, `lastRun: null`, `summary: null`, name `<name> copy` (`<name> copy 2`, `copy 3`, … if that exact name exists; truncated to the 256-character Core bound), and a copy of the setup: mode, clearance text, self-clash, Set A, Set B and the basis attestation (still bound to the same participant set, still never `verified`, still dropped by the reducer on any participant change, §23.3). It does **not** copy results, run status, summary or the "setup changed" flag. Duplicate does not change the active test, so it is allowed while a run is active; duplicating the active test reads its current draft from `vm.test`. **Create** = new record with a blank draft (`createDraft`) and the next counter value, then the activation switch of 26.3 (so it is refused while a run is active).

**26.5 Viewer ownership (default 2).** Only the active test touches the Viewer, because only the editor holds the ViewerBridge and the manager never calls it. On an activation switch the outgoing visualization is torn down **before** anything of the incoming test can be presented: `retireDisplayed` bumps the results generation first (aborting in-flight derivations, freshness reads, property reads and filter passes, and making every late completion of the outgoing test fail its `gen.isCurrent` check, `controller.js:108-115`), then calls `bridge.clear()`, which invalidates every outstanding presentation token synchronously at call time (`ViewerBridge.js:234-239`) and queues the guarded isolation restore and marker removal behind any in-flight step in the single-flight queue (`ViewerBridge.js:27-39`). `clear()` is not awaited by the switch, and does not need to be: the incoming test holds no results, and any later `present()` is serialized behind that `clear()` in the same queue. The setup generation (`setupGen`) is bumped by the forced Soft re-evaluation, so a late basis verdict for the outgoing participants is dropped (`controller.js:177-193`). Selection, `navScope`, filters and page reset with the results (`resetResultsView`, `controller.js:540-546`); the Isolate/Markers/Focus-on-select toggles and the Group-by mode are view preferences and survive, as for `New test`. A foreign isolation change is still never clobbered (§9.4); the `skipped-external` notice is surfaced as today. Viewer selection is never touched (§9.2). §9.6 gains the row "Switch / delete the active test" with the same effects as "Start a new run".

**26.6 Readiness and "models changed" per test (default 3).** Computed for **every** record, active or not, from data the Panel already has, with **no** engine call that needs a held set:

- *Setup readiness* (advisory row badge; the editor's `validateSetup` remains the only Run gate): `setup-complete` — copy *"Setup complete — readiness to run is checked when opened"*, **never** "ready" or "ready to run". It means both sides are non-empty, a Soft test has a clearance, and every `modelKey` referenced by Set A/Set B is in `catalog.list()` with `loaded` true and `registry.bindingFor(modelKey)` non-null; `models-loading` — present but not load-complete; `models-missing` — a referenced key is absent from the catalog or has no binding (text: *"<model> is not loaded"*, one per model); `incomplete` — a side is empty (or Soft with no clearance). Soft-basis availability is **not** evaluated for non-active tests (it is async and host-supplied, §6.2 step 4); it is evaluated by the editor on activation as today. A non-active multi-model Soft test without a basis attestation, under a host verdict that is or would be unverified, therefore reads `setup-complete`. Its Run may still be blocked on opening with the §23.4 basis request; the row claims nothing about the basis.
- *Models changed since last run* (only for records with a summary): for each `summary.models` row, the §9.1 check (`resolve.js`) is applied by model — binding present, `bindingGeneration` and `modelVersion` equal, model in the scene. Any mismatch marks the row *"Models changed since this run"*. This is a Panel-local liveness fact, **not** Core freshness, and is never worded as "current" or "stale results"; Core freshness (`getFreshness`) and the §11.2 table continue to apply **unchanged to the active test's held set only**.
- *Triggers:* `catalog.onChange` and `bridge.onModelLeft` (the bridge already supports several subscribers, `ViewerBridge.js:308-315`); rows are recomputed lazily when the manager ViewModel is built (no per-record subscription, no polling beyond the editor's existing readiness poll).
- *Reload:* the host mints a new `modelKey` per load (§24.4), so a test that referenced a model before an unload/reload stays `models-missing` and the user re-selects the model in the editor; tests are **not** re-bound by URN or name (OQ-1, §11.3). Aligned with §11.2:
  - adding an unrelated, new `modelKey` changes no existing record;
  - re-entry of a **referenced** key — `hideModel`/`showModel` of the same `Model` under the same `modelKey` — recomputes that record's readiness and "models changed" state on the next catalog change, which may clear `models-missing`, or clear "models changed" if generation and version still match;
  - a reload under a new key never re-binds the record.
- *Set A/B summaries* reuse the editor's scope wording (`describeScope`, `viewModel.js:71`) and `labels.js` model names: host display name via `catalog.displayNameFor` (which outlives unload, §5.2), disambiguated against every **known** key — which for the manager must include every key referenced by any record (plan requirement: today `knownModelKeys` covers only the displayed run, `controller.js:70`, `labels.js:97`) — and `Model <first 8 chars of key>` when the host no longer names it (`labels.js:10-13`). A rename by the host is picked up on the next catalog change; no name is snapshotted into a record, and no URN→name registry is reintroduced (§24.3). An unloaded model's name is followed by "(not loaded)".

**26.7 Delete and Reset (default 5).** Two distinct destructive actions, both session-only and neither persisting anything; plus the existing editor `Clear results`, unchanged. Layers: *held results* (active test only) ⊂ *run summary* ⊂ *test definition*.

| | **Delete test** | **Reset results** | `Clear results` (existing, editor) |
|---|---|---|---|
| Removes | the whole record (definition, summary, and — if active — its held set) | held set (if active) **and** the summary → row reads "Not run" | the held set only; the summary stays (row then reads "… · Results not held") |
| Keeps | — | `testId`, draft incl. `revision`/`lastRun` (so a rerun of the same definition reuses `resultId`s) | definition and summary |
| Enabled | not while **that** test's run is active (only the active test can be running) | not while that test's run is active; and the test has a summary or held results | unchanged (`controller.js:435-439`) |
| Confirmation | **always** (definition loss is real and irrecoverable): *"Delete “<name>”? Its setup and results are discarded for this session and can't be recovered."*; when the test is active and `heldUnsaved`, the same single prompt also states that its unsaved results are discarded and serves as the `acknowledgeUnsaved` consent (one prompt, never two) | **only** when it would discard unsaved held results (existing rule, §23.5): *"The results of “<name>” are held in memory only. Resetting discards them — discard?"*; otherwise none | unchanged |
| Path | active: retire via the activation switch to the successor (below), then remove the record; non-active: remove the record (nothing held) | active: the existing `clearResults` path (`controller.js:441-446`) then drop the summary; non-active: drop the summary | unchanged |

*Deleting the active test* activates the next record in list order (else the previous) and returns to the list view. *Deleting the last record* is Delete followed by Create: a fresh `Clash test <N>` becomes the only, active test, so the editor always has exactly one active record (the manager has no empty state). **No existing control is renamed**: `Clear results` keeps its label and effect on held results (§7.6); the manager adds `Reset results` and `Delete test`, whose accessible names include the test name. `New test` is reconciled in 26.8.

**26.8 Panel placement, navigation and lifecycle.** The DockingPanel shell (PD-19) hosts two views: the **Tests list** and the **Test editor** (the existing five §14.3 regions, unchanged). The Panel opens on the editor of the initial `Clash test 1` (preserving first-open behavior and existing acceptance); the editor's header gains an "All tests (*n*)" navigation control and the active test's name; the list shows one row per record in creation order, the active row marked, a `New test` (Create) control, and per-row Open / Duplicate / Reset results / Delete test. Opening the active test, or moving between the two views without opening another test, changes nothing in the editor, the results or the Viewer. **`New test` in a manager-hosted Panel** (both the list control and the editor's existing top-row button, §23.5) performs **Create** (26.4): the previous test's definition is kept in the list instead of being replaced in place; its enablement (disabled while a run is active) and its unsaved-results confirmation are unchanged. Hide/show (dormant) behave as today (`PANEL_HIDDEN` clears the visualization and keeps the selection; `PANEL_SHOWN` re-checks freshness); manager records are kept while hidden. **Dispose:** the manager unsubscribes its catalog/bridge listeners and drops every record, then the editor's existing `dispose()` runs unchanged (cancel `'panel-disposed'`, release, bridge dispose, `controller.js:487-519`); non-active records hold nothing to release. Nothing survives a reload.

**26.9 ViewModel additions (shape at spec level).** The UI renders `{manager, editor}`: `editor` is the existing ViewModel plus `vm.test` (26.2 (b)); `manager` = `{view: 'list'|'editor', activeTestId, count, create:{enabled, reason}, pending: null|{operationId, kind:'switch'|'create'|'delete'|'reset', sourceTestId, targetTestId|null} (26.2a), confirm: null|{operationId, text, confirmLabel, cancelLabel} (derived from `pending`; its buttons dispatch `MANAGER_CONFIRM`/`MANAGER_CANCEL` with that `operationId`), notice: null|text (failed activation / compensation), fault: null|{text} (terminal manager fault, 26.2a; when set, every manager and editor run/edit action reports `enabled:false` with that reason), live: <announcement text>, tests: [{testId, name, active, modeText ('Hard' | 'Soft (clearance …)', basis wording as §23.4), setA, setB, status:{kind:'not-run'|'running'|'stopping'|<terminal status>, text}, resultCount|null, resultsText ('Results not held — open and re-run to view' | null), setupChangedSinceRun, readiness:{state:'setup-complete'|'models-loading'|'models-missing'|'incomplete', text, models:[{name, state}]}, modelsChanged:boolean, actions:{open, duplicate, reset, delete: {enabled, reason}}}]}`. All strings are built in the headless core; names are untrusted text inserted with `textContent` only (AC-P13). The manager ViewModel is frozen and identity-stable between changes, like the editor's.

**26.10 Accessibility and copy (spec level; no pixel design).** The list is a semantic list/table whose row header is the test name; the active row is conveyed in text and `aria-current`, never by color alone; status, readiness and "models changed" are text, not color-only icons. Every disabled action exposes its reason (visible text or `aria-describedby`). Destructive actions are separate buttons with distinct labels ("Reset results", "Delete test"), never a menu default, and their confirmations use the existing in-panel confirmation banner pattern (focus moves to it; it can be cancelled without effect). Activation, creation, duplication, deletion and reset are announced in the existing visually hidden live region (§23.6). Copy never claims persistence ("saved") and states "for this session" on deletion.

**26.11 Testability hooks.** The manager is headless and Node-testable with the existing fakes: injected `mintId` and `scheduler` (ids, timestamps), the same fake engine/catalog/bridge as the controller suite, and the editor controller (or a fake implementing its public surface plus 26.2 (a)/(b)). Its only output is the frozen ViewModel and the intents it dispatches to the editor, so every rule below is assertable without a Viewer or DOM.

**26.12 Acceptance criteria (replacement set for the manager; AC-P1…P21 and §23.7/§25 criteria remain in force for the editor).**

- **AC-M1** Create mints a new `testId`, the next `Clash test <N>` (counter never reused after Delete), activates it through 26.3, and is disabled while a run is active.
- **AC-M2** With *k* records, the Panel never displays, leases or holds more than one set (the active test's); after any switch/Delete/Reset the outgoing set is released (or reported stuck and retried by the existing residency path), and an unsaved set is released only after the single confirmation.
- **AC-M3** A switch/Create/Delete-of-active/Reset-of-active is refused while the active run is non-terminal; Duplicate is permitted.
- **AC-M4** After a switch, no late `done`, `persisted`, derivation, freshness, property-read, basis-verdict or `present` outcome of the outgoing test changes the editor or the Viewer (generation/`setupGen`/token guards); the Viewer holds no Panel-owned marker and isolation is restored or `skipped-external` per §9.4 once the queued `clear()` drains.
- **AC-M5** A non-active test with a prior run shows its last status and count and "Results not held — open and re-run to view"; opening it shows the editor idle with its setup; no result list, freshness badge or no-clash statement is ever produced from a summary; 0 results read "0 clashes reported".
- **AC-M6** Revision continuity: switching away and back, then re-running an unchanged definition, yields the same `revision` (hence `resultId`s); an edited definition bumps it (§6.1).
- **AC-M7** Duplicate creates a new `testId`, `revision 1`, no summary, name `<name> copy[ n]`, identical setup (incl. basis attestation, never `verified`), and leaves the active test unchanged.
- **AC-M8** Delete always confirms; deleting the active test activates its successor (next, else previous); deleting the last test leaves exactly one fresh active test; deleting a running test is impossible.
- **AC-M9** Reset returns a test to "Not run" keeping `testId`/draft/`revision`; it confirms only when unsaved held results would be discarded; `Clear results` keeps the summary with "Results not held".
- **AC-M10** Per-test readiness and "models changed" update for **all** records on catalog change and model-left events without any `getFreshness`/`assessNoClashClaim`/derivation call for a non-active test. Adding an unrelated model changes no record. `hideModel`/`showModel` of a referenced model (same `modelKey`) recomputes readiness and "models changed". A reloaded model (new `modelKey`) leaves referencing tests `models-missing`. The readiness copy is never "ready" or "ready to run".
- **AC-M11** Set A/B summaries of every record use host names via `labels.js`, disambiguated across all referenced keys, falling back to `Model <key8>`; markup in a test or model name renders inert.
- **AC-M12** Dispose drops every record, leaves no manager listener registered, and the editor's existing dispose contract (AC-P14) still holds; nothing is written to any storage.
- **AC-M13** Existing editor suites pass unchanged with the 26.2 seam present (standalone editor: `New test` keeps the §23.5 in-place semantics).
- **AC-M14** Edits survive switches: after edits to the name, mode, clearance, sets or basis on test X (and after a Run admission bumps the revision), switching to Y and back restores X's exact draft. No edit made before the switch request is lost.
- **AC-M15** Seal, then an immediate Clear results, Reset, switch or Create (same tick or the next intent) still leaves X's summary populated from that run (`runId`, status, count). For Clear and switch it keeps that run's summary; for Reset it then deliberately empties it.
- **AC-M16** Failed or cancelled activation leaves `activeTestId` unchanged, and the source record's draft and summary unchanged:
  - cancelling the prompt;
  - a load refused because a run started in the meantime;
  - a load rejected for an invalid or unknown `testId`/draft — atomic, with zero editor mutation and no notification (the editor still holds the active test).

  A mismatched load result or editor-reported `testId` (injected by a fake editor) triggers exactly one compensating load of the committed `activeTestId`'s snapshotted draft:
  - when that load succeeds, editor and manager agree again;
  - when it fails, the manager enters the fault state: run, edit and manager actions are disabled, Clear results and hide/dispose stay available, and no draft is synced by a disagreeing id.

  A Create whose activation fails leaves no record behind. A confirmed switch whose release is stuck commits, shows the release-error banner and keeps the stuck set in the retry list.
- **AC-M17** A run cancelled during planning and a planning-stage failure each yield a summary with `resultCount`, `coverage`, `integrity`, `freshnessAtSeal` and `caveatCount` all null, `models: []`, status, timing and `definitionKey` populated. The row shows the §7.3 headline with no count and no "Models changed".
- **AC-M18** Pending-operation races, each without effect:
  - a `MANAGER_CONFIRM` or `MANAGER_CANCEL` with a stale `operationId` (e.g. after the operation was cancelled and a new list action created another);
  - a second manager action while one is pending (disabled);
  - a confirm after the editor's state changed (run started, or results became unsaved) — re-checked, then re-prompted or refused, never executed with outdated consent.

  Manager actions are disabled while the editor's own confirmation is pending, and the editor's cancel intent clears it with no other effect.
- **AC-M19** A non-active multi-model Soft test with no basis attestation, under an unverified host verdict, reads `setup-complete` (never "ready"). On opening, the editor's §23 basis rule blocks Run until a basis is chosen.

**26.13 Gates and open items.**

| ID | Item | Class |
|---|---|---|
| CTM-1 | Additive editor seam (26.2 (a) **atomic** load-test intent — validates `testId`/draft before any mutation, rejects with zero mutation, only ever notifies/returns the supplied `testId` — with forced Soft re-evaluation, `acknowledgeUnsaved` and a resolved completion result; (b) `vm.test`; (c) cancel intent for the editor confirmation) — the plan must show it leaves every existing intent/test unchanged; if impossible, stop and record (no port widening) | implementation-plan requirement |
| CTM-2 | `labels.js` known-key set must include all records' referenced keys for row disambiguation (`controller.js:70`) | implementation-plan requirement |
| CTM-3 | Duplicate copies the basis attestation (default) vs drops it | product decision (default recorded) |
| CTM-4 | Switch confirms only for unsaved held results (default, §23.5 rule) vs whenever results are held | product decision (default recorded) |
| CTM-5 | Deleting the last test creates a fresh one (default) vs an empty-manager state | product decision (default recorded) |
| CTM-6 | Test names not required unique (default) vs enforced uniqueness | product decision (default recorded) |
| CTM-7 | Headed SVF2 validation of switch/delete teardown (markers removed, isolation restored/`skipped-external`) and of row readiness after unload/hide/reload, within the existing PG-1/G1 evidence envelope | verification gate |
| CTM-8 | Manager ViewModel rebuild cost with many records × models is unmeasured; no record-count limit is introduced (PD-14) | verification/calibration gate |
| CTM-9 | Saved sets retained by the engine's default store after release are outside the Panel port; the Panel offers no store deletion | deferred / non-goal |
| CTM-10 | Re-binding a test to a reloaded model, persistence, run history, background runs, suites | deferred / non-goal |
| CTM-11 | Pre-existing spec inconsistencies observed during the §26 review, **not caused by §26**, left unedited:<br>(i) Soft availability — §23 (line 763; §23.1–23.3, lines 765–776) makes Soft selectable with a user-supplied or raw basis, but §18 (line 691, "Soft mode for multi-model tests without a verified common measurement basis (fail closed until PR-BASIS/PG-5)") and §21 (line 742, "Soft is unavailable for any multi-model test") still state the pre-§23 fail-closed rule;<br>(ii) §19 item 8 (line 704) says per-row "not fully verified" uses `getPairStatus`, contradicting §7.5 (line 297, "v1 does not call `getPairStatus`/`getElementStatus` on any interactive path") and AC-P4 (line 717) | reconciled by the Clash Tests Manager implementation plan Task 1 (independent Work review M2): §23/§23.7 authoritative for Soft, §7.5/AC-P4 authoritative for row verification; no Soft math, Core API or manager-architecture change |

No design/spec correctness blocker is known at this abstraction level. Next gate (brief): bounded internal Codex spec review of §26 and the reconciled pointers → independent Work review → separate implementation plan → separate owner authorization to implement.
