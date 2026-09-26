# Viewer Clash Panel design — independent review

- **Review date:** 2026-09-26
- **Repository / branch / HEAD:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection` · `main` @ `255dcca4650e15193c3bf78a698f2a6f54fdb374` (`origin/main` identical)
- **Artifact:** `docs/superpowers/specs/2026-09-26-viewer-clash-panel-design.md`
- **Verdict:** **revise design before owner acceptance**
- **Findings:** 0 Critical / 2 High / 1 Medium / 1 Low
- **Scope:** independent design gate only. No live Viewer test was run; no production, Core, Viewer Adapter, M4, OQ-1, host-integration, plan, or spec file was changed.

## Repository state independently verified

- Viewer Adapter is merged into `main` through merge `04d7054`; the closed implementation is preserved.
- `main` and `origin/main` both point to `255dcca4650e15193c3bf78a698f2a6f54fdb374`.
- The Panel design, internal review, Viewer API research, authorization prompt, and current handoff are uncommitted documentation only; no `clashpanel/` directory or Panel implementation plan exists.
- Full non-live suite, rerun with local ephemeral-port permission: **2,972 total / 2,971 passed / 0 failed / 1 pre-existing todo**. The restricted first run had only the known three `listen EPERM` failures and is superseded by this passing run.

## Findings

### Critical

None.

### High

#### H1 — Theming cleanup cannot satisfy the claimed rollback-safe ownership contract

- **Spec sections:** §9.2 “Presentation transaction”, §9.5 “What prior state means”, §16 “Theming”, AC-P6 and AC-P16; OD-5.
- **Type:** design correctness blocker / unresolved integration decision.
- **Concrete failure:** the design applies Viewer theming to `(model, dbId)` and later removes it with `setThemingColor(dbId, undefined, model)`. The public/source-observed API has no supported per-node theming getter. The bridge therefore cannot capture the claimed theming “pre-image,” cannot distinguish its colour from a pre-existing foreign colour, and cannot detect a foreign theming change made after its own mutation. Clearing the Panel’s theme can erase another extension’s or the host’s theme on the same element. A write-ahead ledger records intent, but it does not recover state that cannot be read.
- **Why this matters:** isolation has an explicit read-and-compare ownership guard; theming does not. AC-P6/AC-P16 promise that only Panel-owned state is removed, which is not mechanically achievable with the proposed API.
- **Minimum correction:** make **markers-only** the rollback-safe v1 default and defer theming; or state an explicit exclusive-theming integration precondition and disable Highlight when that precondition cannot be guaranteed. If the owner requires coexistence with foreign theming, a shared theming arbiter or another readable/owned highlighting mechanism is required. PG-1 runtime verification alone cannot create a missing ownership readback contract.

#### H2 — Soft/clearance remains enabled when the design says its distance basis is mixed native units

- **Spec sections:** §6.1–§6.2, §8.2 “Gap”, §16 “Units”, OD-13, §21 “Unit ambiguity”.
- **Type:** design correctness blocker / integration contract gap.
- **Concrete failure:** when participating models report different `getUnitScale()` values, the design keeps Run enabled and merely warns that clearance and gaps are in mixed native units. `clearance` is a single numeric world-distance threshold, and the collision layer compares Viewer world matrices/bounds numerically. Presenting one threshold and resulting gaps without a verified common coordinate/unit basis can produce semantically meaningless Soft results; changing only the displayed label does not make the computation valid.
- **Why this matters:** this is not only a unit-label product choice. It affects which pairs qualify as clashes and the numeric evidence shown to the user.
- **Minimum correction:** define a fail-closed run prerequisite: participating models must have a verified common world-coordinate/unit basis, or the host must have loaded them with an evidenced normalization. At minimum, disable Soft when scales are unavailable or incompatible. Record the host normalization as a live-integration gate; do not treat OD-13 as display wording only. No Core change is required.

### Medium

#### M1 — Registration authority is exposed through the Panel-core port despite being assigned to host composition

- **Spec sections:** §0 Q1, §5.2 `EnginePort`, §6.2, §11.1, PR-OQ1/PR-HOST.
- **Type:** layering / OQ-1 dependency ambiguity.
- **Concrete failure:** `EnginePort` exposes `registry.register`, while the surrounding text says registration is a host call, the Panel core does not derive identity, and OQ-1 remains outside the design. An implementer can reasonably place registration/re-registration in the headless controller, coupling it to live `Model` objects and the unresolved identity policy and duplicating host lifecycle ownership.
- **Minimum correction:** expose only `registry.bindingFor` to the Panel core. Put registration, unload wiring, and model-key/version derivation in a separate host-composition boundary. The core may report “not registered”; it must not repair registration itself.

### Low

#### L1 — The architecture summary omits a Core API the normative design uses

- **Spec section:** §0 Q1 versus §5.2 and §7.5.
- **Issue:** Q1 lists `derivations.{summarize,groupBy}` but omits `derivations.filter`, although the cached `caveated` mask normatively uses it.
- **Minimum correction:** add `filter` to Q1’s minimum API summary.

## Confirmed sound areas

- **Layering:** the headless core + ViewerBridge + thin view split correctly sits above the public Core and Viewer Adapter barrels. It adds no collision algorithm, result identity, persistence, or Adapter lifecycle mutation.
- **v1 functional scope:** Hard/`volume-overlap`, Soft/`clearance`, post-seal browsing, bounded DOM pagination, presentation-only grouping, and deferred partial browsing are coherent with current APIs.
- **Sealed-result semantics:** the controller correctly waits for `handle.done`, uses frozen `results[]`, caches derivations, and treats cancelled/failed/invalidated retained positives as browsable only after seal.
- **Pagination/grouping:** canonical result identity plus presentation-only occurrence identity correctly handles the multi-valued `element` facet without inventing durable ids.
- **Stale/reload behavior:** resolving through `bindingFor` and requiring both recorded `bindingGeneration` and `modelVersion` is correct. A fresh key or a generation/version mismatch makes old rows unavailable; digest identity is not used. The observed reload-digest drift is therefore not a Panel prerequisite.
- **Lifecycle separation:** `wireModelUnload` continues to own registry/world cleanup. Panel/ModelCatalog listeners only refresh UI liveness and clear Panel visualization; they do not unregister or evict models.
- **Isolation ownership:** the read-and-compare guard, hidden-state prerequisite, no-clear-all fallback, serialized transaction, and supersession rules are architecturally sound. H1 is specifically about theming, not isolation or markers.

## SVF2 F1–F8 adjudication

The historical Audubon/SVF evidence is not evidence for SVF2/OTG. The following classification is the design gate for future planning:

| Item | Adjudication | Required verification / production impact |
| --- | --- | --- |
| **F1 owner mapping** | Real SVF2 evidence gap; Adapter contract itself is format-agnostic and fail-closed | Bounded live SVF2 enumeration before integration acceptance. Production change only if the contract fails. |
| **F2 tree/population/root decomposition** | Algorithm and D-V6 rules are format-agnostic; the SVF2 object-tree/population shape is unverified | Live SVF2 reconciliation and counts. Content-specific unreachable/mixed-owner observations are evidence, not a new Panel contract. |
| **F3 readiness/not-loaded behavior** | Format-agnostic readiness/fail-closed contract; actual SVF2 event/accessor ordering is unverified | Live SVF2 readiness probe before integration acceptance. Adapter change only if existing gates cannot observe a valid ready state. |
| **F4 geometry/render-proxy reads** | Real, load-bearing SVF2 gap for the collision path | Live SVF2 engine/collision probe is required before integration acceptance. A failure may require separately authorized Collision/Adapter work; it does not alter Panel-core architecture. |
| **F5 capacities** | Existing bounds are format-agnostic; fixture sizes are content/calibration facts, not an SVF2 API contract | Measure chosen SVF2 v1 fixtures before content qualification. No production change unless product scope requires unsupported sizes. |
| **F6 unload/reload** | Event/unregister/evict contract is format-agnostic; SVF2 live behavior remains unverified. Cross-reload digest identity is not required | Live SVF2 unload/reload lifecycle check before integration acceptance. No change unless behavior diverges. |
| **F7 ViewerBridge APIs** | Viewer wrapper contracts are largely format-agnostic; OTG implementation branches and runtime behavior are unverified | Live SVF2 checks for isolation, marker/theming policy, fit, names, units, and DockingPanel. This belongs to Panel ViewerBridge/integration, not Viewer Adapter. |
| **F8 dbId identity across APIs** | Real integration gap | Live SVF2 proof that Core result refs address the same elements in isolate/highlight/fit/name APIs. A mismatch requires host/ViewerBridge mapping or separately authorized Adapter work. |

No F1–F8 item currently proves that a Viewer Adapter extension is required. The current Adapter public surface is sufficient by architecture; verification may reveal a defect, but the design must not pre-authorize or guess a change.

## RQ-1 disposition

**Choose option (b): bounded SVF2 verification is required before Viewer integration/live acceptance, not before model-format-agnostic/headless Panel implementation.**

Reason:

- Panel core consumes sealed plain data, injected ports, generations/versions, and fakeable ViewerBridge outcomes; none exposes SVF/SVF2 representation.
- F1–F6 test the existing Adapter/Collision/Viewer lifecycle against SVF2. F7–F8 test the real ViewerBridge and identity handoff. They do not change filtering, paging, grouping, result lifecycle, or stale-state architecture.
- Existing Adapter and Core behavior fails closed when enumeration is inconsistent, so early headless implementation cannot silently convert an unknown SVF2 contract into a clean result.

### Tasks that may proceed after design acceptance and explicit implementation authorization

- layering scaffold and headless ports/fakes;
- draft mapping, validation presentation, controller lifecycle, residency, and stale-state logic;
- sealed ResultIndex, filtering, grouping, sorting, pagination, and wording;
- thin DOM/view work against fake view-models;
- ViewerBridge transaction/ownership logic tested against fakes, after H1 is corrected.

### Tasks blocked until bounded SVF2 verification passes

- host registration/composition and OQ-1-dependent identity wiring;
- real Adapter + CollisionWorld execution over SVF2 content;
- live ViewerBridge binding for SVF2 isolate/highlight/fit/name/unit behavior and dbId identity;
- live acceptance, production-ready claims, and any statement that v1 supports SVF2.

The future implementation plan should make this a **package-scoped gate**: it blocks integration tasks, not the headless package or UI shell.

## Owner decisions

Twelve decisions are genuine product/design choices as written: OD-1–OD-4, OD-6–OD-12, and OD-14. They choose scope, UX, module placement, or integration policy without hiding a technical contradiction.

Two need reframing before owner acceptance:

- **OD-5:** theming versus markers is constrained by H1. The safe minimum is markers-only unless an explicit exclusive-theming precondition or ownership mechanism is accepted.
- **OD-13:** unit-label wording is a product choice, but mixed-unit run validity is not. The design must first establish the fail-closed common-unit/coordinate prerequisite from H2.

OD-8 does not settle OQ-1 and correctly remains an integration prerequisite. The independent RQ-1 disposition is a gate classification, not a fifteenth product decision.

## Readiness

The design is **not ready for owner acceptance yet**. Blocking corrections:

1. resolve H1 by making v1 highlighting independently owned (minimum: markers-only) or by recording an enforceable exclusive-theming contract;
2. resolve H2 with a fail-closed common-unit/world-coordinate prerequisite for Soft runs;
3. clarify the registration boundary from M1 while touching the affected architecture summary.

After those bounded corrections, a targeted re-review is sufficient. Do not restart an unrestricted defect-finding loop. Implementation planning remains unauthorized until the owner accepts the corrected design.
