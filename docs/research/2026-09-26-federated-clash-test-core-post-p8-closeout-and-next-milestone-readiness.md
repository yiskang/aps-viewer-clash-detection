# Federated Clash Test core (P0–P8) — post-P8 closeout and next-milestone readiness assessment

- **Status:** bounded assessment. **Recommends; authorizes nothing.** No production code, test, spec, schema or implementation plan was modified to produce it.
- **Basis:** `docs/handoffs/latest.md`; frozen spec `docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md` (§20, §23, §24); master plan `docs/superpowers/plans/2026-09-20-federated-clash-test-core-engine-implementation.md` (§1.2, §4, §5, §7, §8); phase plans P0–P8; the accepted P7 acceptance record and P8 review records in `docs/reviews/`.
- **Repository state assessed:** branch `feature/federated-clash-test-core-engine`, HEAD `d4d4b4c` (accepted P8 production checkpoint `acf3475`), nothing pushed, 127 commits ahead of `main` (`438a832`).
- **Verification performed here (fresh):** `node scripts/run-tests.mjs` at HEAD → **2,848 total / 2,847 pass / 0 fail / 1 pre-existing todo** (identical to the accepted P8 figure). Everything else below is read from the cited artifacts or a targeted grep; where a statement is carried forward rather than re-checked, it says so. This is not a new implementation review.

## 1. Verdict

1. **The core (P0–P8) is complete and accepted phase-by-phase.** Nothing in the accepted core is blocked by a gate; every open item is either outside the core, calibration, or an independently authorizable follow-up.
2. **OQ-4 must be closed before Viewer-adapter planning may begin** — by the spec's own text (§24 OQ-4 and the pre-integration prerequisite table). No OQ-4 evidence artifact exists in `docs/research/` (checked). It is the **only** gate that spec §24 places in front of adapter *planning*.
3. **Smallest milestone that is actually ready to authorize (recommended, not authorized):** an **OQ-4 live evidence check** — a research-only milestone that produces the `docs/research/` artifact and nothing else (§5).
4. Viewer-adapter planning, adapter implementation and every host/Panel step remain unauthorized (§6).

## 2. What the accepted core provides

| Phase | Provides | Status |
| --- | --- | --- |
| P0 | Typed errors, options/limits (provisional), capture-first, canonical JSON/digests, slicer | accepted |
| P1 | `ModelRegistry`, `ElementRef`/`PairId`/`ResultId` durable identity | accepted |
| P2 | Definition validation/normalisation/`semanticDigest`; in-memory `ClashTestStore`; lifecycle | accepted |
| P3 | Planner over the `ElementEnumerator` **port**: scope digests, exact-cover decomposition, splitting, ledger | accepted |
| P4 | `UnitExecutor` + `LocalUnitExecutor`, diagnostics/completeness, bracketed scope-digest protocol | accepted |
| P5 | Sealed Result Set, untrusted-read validation, claim rule, in-memory `ResultStore`, residency/persistence, pair/element status readers | accepted |
| P6 | Run lifecycle: coordinator, state machine, progress, cooperative cancel, freshness, settlement precedence | accepted |
| P7 | `createClashTestEngine` facade, rerun, real-`CollisionWorld` differential/integration suite, docs | accepted (2026-09-25) |
| P8 | `createDerivationContext` / `engine.derivations`: facets, `groupBy`, `filter`, `summarize`, `compareResultSets` (fail-closed), owned/bounded operands | accepted (2026-09-26, checkpoint `acf3475`) |

Master Definition-of-Done (§5) reading: items 1–5 are carried by the per-phase acceptances plus the P7 acceptance run and the fresh full-suite result above (credential-free, no network); item 6 is only partly current — see §7 finding F1. Engine reachable behaviour is verified against the **real `CollisionWorld`** with a **fake `ElementEnumerator`**: the core has never run against a live Viewer.

**Trust boundaries the core states and does not close:** the enumerator's ownership/tree-readiness truth (the adapter, OQ-4); `modelKey`/`modelVersion` witness quality (OQ-1); host duty to route every transform change through `invalidateModelPlacement` (OQ-17); the library's inherited "Mode 2" under-enumeration for explicit scopes; hierarchy-internal exclusion acceptance (OQ-16, fail-closed default).

## 3. Classification key

- **B-ADAPT** blocking before Viewer adapter (planning or implementation, as noted)
- **B-HOST** blocking before host/Panel integration
- **CAL** calibration / verification only
- **INDEP** independent follow-up (own targeted authorization; blocks nothing else)
- **DEFER** genuinely deferred / non-goal

## 4. Inventory of every remaining deferred gate / follow-up

### 4.1 Gates

| Item | Class | What it blocks / when it must close | Source |
| --- | --- | --- | --- |
| **G-OQ4 / OQ-4** live owner-mapping + tree-readiness evidence | **B-ADAPT (planning)** | Viewer-adapter *implementation planning*. Artifact: `docs/research/` from the Audubon fixture: (a) `ownerMismatch.count === 0`, (b) source-side `fragList.getDbIds` distinct-owner enumeration + `fragmentCount` + tree-readiness signal, (c) `unreachablePopulation` and `mixedOwnerDbIds` counts. Fail ⇒ v1 narrowed to agreeing content (recorded, product-owner-accepted) or a roadmap-§8 exact-owner scope (OQ-15). | spec §24 OQ-4 + prerequisite table; master §4 |
| **G-OQ1 / OQ-1** `modelKey`/`modelVersion` witness derivation | **B-HOST** (also gates adapter *acceptance*; see F2 for a wording mismatch) | Integration acceptance: written derivation + test that a retranslation changes `modelVersion` and never reuses a `modelKey`. The `ModelRegistry` Viewer wiring implements it, so the adapter plan must take it as a stated input. | spec §24; master §4 |
| **G-OQ17 / OQ-17** placement-invalidation owner | **B-HOST** | Host integration (inventory of every transform/alignment path calling `invalidateModelPlacement`/`notifyPlacementChanged`). Engine side is tested. | spec §24; master §4 |
| **G-OQ16 / OQ-16** hierarchy-internal acceptance | **B-HOST**, only for *qualified*-claim presentation | Enabling a qualified claim in a host build. Core default `hierarchyInternalAcceptance: null` ⇒ claim blocked (fail-closed); both branches tested. Not a blocker for anything else. | spec §24 |
| **G-CAL** AC-12 memory/stall measurement + confirmed browser budget; **G-RESP** responsiveness target | **CAL** | Promoting provisional caps/schema ceilings to deployable defaults; any responsiveness claim. Blocks release/promotion, not adapter planning or implementation. Includes P4 H3 `dedupMap` bound, the incomplete ~569/512 MiB pair-cover estimate (true total peak unmeasured), P8 `groupBy` finalization/sort, P8's 16M capture default (accepted ~8.4M-node operand ≈ 8.7 s synchronous), standalone-context defaults. | master §4; handoff |
| **G-REMOTE** remote persistence in v1? | **DEFER** | Only the (unwritten) remote-persistence follow-up; carries the AC-11 ambiguous-commit reconciliation conjuncts. Local transactional store only until decided. | master §4, §1.2 |
| **G-EC** `provenance.models[].elementCount` semantics | **INDEP** (becomes B-HOST for any consumer) | A one-line definition at spec §13.2 must exist before any phase consumes the field or makes a durable-provenance compatibility/readiness claim. The field is produced/validated in `resultSetSchema.js`, `diagnostics.js`, `Run.js`; no derivation code reads it (P8 gate honored). Needs an owner-authorized spec erratum. | handoff G-EC; P6 owner ruling |
| **G-OQ19** bracketed-proof tightening | **DEFER** | Non-gating; standing policy already fixed in spec §8.3. | spec §24 |

### 4.2 Accepted-phase carry-forwards

| Item | Class | Note |
| --- | --- | --- |
| **P5 `getPairStatus`/`getElementStatus` over-report coverage for *ordered* (containment) pairs** (`status.js` `findCoveringUnit` matches both orientations) | **INDEP** — and **B-HOST for any consumer that displays containment-mode per-pair/element coverage** | Not used by the claim path (grep: `claim.js` does not call the readers) and neutralised inside `compareResultSets` by a P8-local guard. Public readers unchanged; needs its own targeted authorization (reopens accepted P5). Not an adapter concern. |
| Annotation layer (§14.5, `engine.annotate`, `ElementAttributeSource`, AC-13 annotation parts, AC-16 annotate-beyond-limits) | **INDEP** (own spec/plan) | Attribute facets are always `unavailable`. Needed only if the Panel wants level/category grouping (spec §20). P8's latent `compareFacetValues` mixed-type non-totality becomes live only then. |
| **Three pre-existing High findings + one Medium** from the accidental unrestricted spec review (`dispose()` losing the only copy of a `pending`-persistence set; zero-required-pair-space coverage wording vs code; P1 determinism wording vs §15.1; `dbIds`-array rejection-order) | **INDEP** | Owner ruling: each needs its own targeted adjudication. **Not re-verified here.** The `dispose()`/`pending` concern only becomes practically reachable with a real (non-in-memory) `ResultStore`, so adjudicate before such a backend is wired. |
| Spec §7.1 vs H7.2/AC-3 raw-oversized-diagnostics contradiction | **INDEP** (spec erratum) | P6 fails closed either way. |
| AC-16 (iii)/(iv) `migration-failed` coverage | **DEFER** | Reopen trigger: a real definition migration path (`DEFINITION_SCHEMA_VERSION > 1`). |
| **R-2** (P7, Low): settlement order under hostile re-entrant signal-like objects | **DEFER** | Owner ruling #11; outside supported signal contract. |
| P7 open lower-severity items (attempt-0 `getPersistenceState` snapshot; a discard already inside P5 may finish after dispose; freshness-abort promptness depends on enumerator `checkpoint()`; optional read-time `libraryExclusions`↔ledger check; recorded coverage gaps) | **INDEP** | The `checkpoint()` item is a port-conformance duty the adapter plan must carry (spec §6.2). |
| P8 minors: live `signal` by reference; in-flight derivations finish on `dispose()`; forged both-null definition / non-numeric evidence inside the non-validating-derivation boundary; `near`/`nearPoint` accept non-numbers | **DEFER** | Owner-accepted dispositions. |
| `Run.js` performance findings (O(n²) `queue.shift`, O(s·n log n) renumber near 100,000 units); P4 U5-beats-U8 secondary cause; P3 L-R1; inert `checkpoint(label)`; roots-observation row shape; P5 Item 4 digest-versioning ambiguity; findings J, K; P5-REM5/REM6 accuracy notes (`digestCanonicalSteps` re-implements P0 framing) | **INDEP / CAL** | Non-blocking; performance items belong with G-CAL. |
| Plan/spec text errata not folded in (P5 plan `JSON.stringify` assertion, missing issue-code table rows, spec AC-14(iii) "verified through `getPairStatus`" vs compare's stricter behaviour) | **INDEP** (documentation; frozen artifacts need owner authorization) | |

### 4.3 Open questions (spec §24) that do not gate anything named above

OQ-2, OQ-3, OQ-10, OQ-12, OQ-13 (product/Panel); OQ-5, OQ-8, OQ-9, OQ-14 (plan/measurement → **CAL**); OQ-6 (models > 20,000 fragments uncoverable; the Audubon fixture's largest model is 5,435 fragments, so the fixture is inside the envelope) and OQ-15 (exact-owner scope) → product/core, **DEFER** unless OQ-4 (a) fails; OQ-7 (§21.2 optional library changes), OQ-11 (direct `findClashes` callers bypass the coordinator) → host-integration decisions, **B-HOST-adjacent, not blocking**; OQ-18 (render-proxy readiness witness) → adapter evidence, recorded environmental input meanwhile.

### 4.4 Live-evidence items that arrive *with* the adapter (verification, not prerequisites)

AC-15 live acceptance (`test/acceptance/clash-test.acceptance.mjs`, never in `npm test`), AC-6 T3 reload arm, AC-12 T3 Audubon characterization: **CAL / adapter-milestone verification**.

## 5. OQ-4 determination and the smallest ready milestone

**Must OQ-4 (or any other gate) close before Viewer-adapter planning may begin?**

- **OQ-4: yes.** Spec §24 says implementation planning of the Viewer adapter "must not be authorized until" the three-part live check is recorded in a `docs/research/` artifact. The master plan (§1.2, §4) agrees. The artifact does not exist.
- **No other gate is required for adapter *planning*** by the spec's prerequisite table: OQ-1 and OQ-17 gate *integration acceptance*, OQ-16 gates qualified-claim presentation, G-CAL/G-RESP gate defaults and claims. (F2 records one wording mismatch on OQ-1 that the owner may want to settle explicitly.)
- **Follow-on transition still needs its own authorization:** a *passing* OQ-4 artifact makes adapter planning eligible; it does not authorize it (project `CLAUDE.md`, transition rule). A *failing* (a) produces a product decision (narrow the content envelope, recorded) or a roadmap-§8 collision-core change (OQ-15) — neither is decided here.

**Recommended (not authorized) next milestone — "OQ-4 live evidence check" (research-only):**

- *Deliverable:* one `docs/research/` artifact recording OQ-4 (a), (b), (c) on the Audubon fixture, with pass/fail per the spec table, plus the product-owner decision path if (a) fails.
- *Why it is the smallest ready step:* it is the sole spec-declared predecessor of adapter planning; the port contract it measures (spec §6.2) is fixed and implemented in the fake enumerator/conformance helper; the fixture and live-harness pattern already exist (`test/acceptance/*.acceptance.mjs`, Playwright, `collision/viewer/ViewerModelAdapter.js` accessors, Audubon models in `collision/README.md`); it needs no core change.
- *Its boundary, if authorized:* a throw-away, never-in-`npm test` live probe (or manual procedure) that only **reads** the Viewer's tree-owner and `fragList.getDbIds` mappings; no `clashtest/viewer/`, no production `ElementEnumerator`, no `ModelRegistry` wiring, no core edit.
- *Dependencies on the owner:* APS credentials and a running server, a Chromium-capable environment (see `test/acceptance/README.md` sandbox notes), and — per the spec table — the **project owner runs the check**; the product owner approves any narrowed envelope.

**Ranked alternatives the owner may authorize instead of, or alongside, it (none is a prerequisite of adapter planning):**

1. **Ordered-pair status-reader fix (P5)** — small, code+tests, closes the only known public-behaviour defect; needs explicit authorization to reopen accepted P5. Worth doing before any host/Panel consumer of containment-mode status.
2. **Documentation reconciliation** — F1 below plus the plan/spec errata; documentation-only.
3. **OQ-1 witness-derivation decision record** (host/Panel owner) — shortens the eventual adapter plan.
4. **Annotation follow-up spec** — only if the Panel needs level/category grouping.
5. **G-CAL measurement work**, **G-REMOTE decision** — independent, product-driven.

## 6. Must not begin yet (without explicit owner authorization)

Viewer-adapter planning or implementation (`clashtest/viewer/`, production `ElementEnumerator`, `ModelRegistry` Viewer wiring) — **blocked on OQ-4**; the OQ-4 check itself unless authorized; host/Panel integration (OQ-1, OQ-17); qualified-claim enablement (OQ-16); any change to accepted P0–P8 behaviour, including the P5 ordered-pair fix; remote persistence (G-REMOTE); the annotation layer; freezing any provisional default or making a responsiveness claim (G-CAL/G-RESP); new/tighter public resource limits; M4 Phase 4 / workers; reopening the frozen spec or editing frozen plans/errata; pushing or merging the branch (127 unpushed commits — an outward-facing action). A recommendation in this document is not an authorization.

## 7. Findings recorded by this assessment (documentation/traceability; none blocks adapter planning)

- **F1 — stale narrative docs.** `CHANGELOG.md` (first entry) and the "Verification status of this checkpoint" section of `clashtest/README.md` still say the engine has **not** been verified end-to-end over the real `CollisionWorld`/`LocalUnitExecutor` ("P7.8 … pending open owner decisions") and list derivations/`compareResultSets` as absent. The real-world suites exist and pass (`test/clashtest/integration/*`), P7 and P8 are accepted, and `README.md`'s own table already describes P8. Master DoD item 6 / spec §21.3 want these current. Not edited here (outside the authorized boundary).
- **F2 — OQ-1 gating wording.** Spec §24 gates OQ-1 at *integration acceptance*; master §4 lists it as blocking "Viewer adapter, Panel wiring". Recommended reading: does not block adapter *planning*, but the adapter plan must state the derivation as an input and cannot be accepted without it. Owner may confirm.
- **F3 — AC traceability residual.** The P7 AC table defers the `compareResultSets` sub-conjuncts of AC-10, AC-17 (d) and AC-19 (b), (d′), (e) to "P8". P8's own spec-coverage table claims only AC-13 and AC-14. Targeted grep in this session: the AC-10 classes are covered by `test/clashtest/derive/compare.test.mjs` (both unverified classes), but no named test compares **engine-produced real-world sets** for AC-19 (b)/(d′)/(e) (the fresh-vs-dirty, quiet-vs-contended and geometry-readiness comparisons), and AC-17 (d) exists only in a synthetic mixed-owner case. `realWorldEnvironment.test.mjs` still asserts only that top-level `engine.compareResultSets` is absent (correct: comparison lives on `engine.derivations`). **Not a correctness defect found**; it is an unassigned verification conjunct. It needs an owner disposition (a small test-only follow-up, or an explicit "covered synthetically / deferred" record). This is a grep-level finding, not a full traceability audit.
- **F4 — spec wording drift.** AC-14 (iii) "each verified through `getPairStatus`" no longer matches compare's stricter, guard-protected behaviour for ordered pairs (already recorded in the P8 records); fold into the errata pass when authorized.

## 8. Recommendation summary

| | |
| --- | --- |
| Gate that must close before adapter planning | **OQ-4** (only) |
| Smallest ready milestone (recommended, **not authorized**) | **OQ-4 live evidence check** — research-only, one `docs/research/` artifact |
| Next after a passing artifact | owner decides whether to authorize Viewer-adapter **planning** (a separate transition) |
| Independent items the owner may sequence at will | P5 ordered-pair fix; documentation reconciliation (F1, F4); F3 disposition; OQ-1 decision record |
| Authorized next action | **none — awaiting owner authorization** |
