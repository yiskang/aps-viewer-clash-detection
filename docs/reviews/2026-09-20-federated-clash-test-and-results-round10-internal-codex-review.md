# Federated Clash Test & Results round 10 internal Codex review (raw output)

- **Reviewed draft:** [`docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md`](../superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md)
- **Draft SHA-256 at review time:** `22bb434a42c499ea1dd60a32bf802440d5f8414311ca54d3f11a4c46bd31ea55` (HEAD `62aa070`)
- **Reviewer:** internal `codex-review spec` (medium effort), request `20260920-202255-26792-26384` — the *internal* reviewer of the CLAUDE.md review loop, **not** the independent acceptance gate
- **Prior review authority:** [`2026-09-20-federated-clash-test-and-results-round9-review.md`](2026-09-20-federated-clash-test-and-results-round9-review.md)
- **Review date:** 2026-09-20
- **Status:** raw reviewer output, preserved verbatim below. Every finding was checked against the spec text and repository before acceptance; dispositions are in spec §25 "Round 11".

---

# Executive Summary

The specification is thorough and generally fail-closed, but it still has one critical and three high-severity implementation blockers:

- Mutable inputs can change after synchronous validation but before deferred normalization.
- The recorded collision-instance admission baseline does not capture the cache membership that actually determines capacity.
- Exhausted placement retries depend on concurrent callers but are not marked environment-sensitive.
- Cancellation before definition resolution cannot produce a Result Set conforming to the specified schema.

Three additional issues affect lifecycle memory bounds and executor scalability.

No files were modified.

# Critical Issues

## 1. Validated definitions are not snapshotted before asynchronous work

- **Severity:** Critical
- **Location or section:** [§5.3 validation](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:228), [§5.5 start/save behavior](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:249), [§13.3 immutability](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:826), [§17.3 deferred normalization](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:1188)
- **Problem:** `startRun(definition)` validates synchronously, but normalization, deduplication, sorting, and digesting occur later in sliced asynchronous work. The specification does not require an immutable defensive snapshot before returning the handle. The same gap exists between validation and asynchronous work in `saveTest`, migrations, and definitions returned by a store.
- **Why it matters:** Validation and execution may observe different objects. This defeats the guarantee that the embedded definition, semantic digest, plan, and persisted identity all describe the value that passed validation. Deep-freezing only at sealing is too late.
- **Concrete failure scenario:** A caller invokes `startRun(validDefinition)` and then changes a `dbId`, `mode`, or `testId` before the queued normalization slice runs. The modified value was never validated but can control planning or the semantic digest. A mutation to a cyclic or accessor-bearing value can instead produce a delayed internal failure.
- **Recommended specification change:** Define ownership at every asynchronous boundary. During the synchronous validation pass, capture a detached data-only snapshot and immutable run-options copy before returning. If that proportional copy conflicts with the stated synchronous-work restrictions, revise those restrictions or make admission asynchronous. Require the same capture for store/migration results, and add tests that mutate the original object immediately after `startRun`/`saveTest` and during injected yields.

## 2. `admissionBaseline` records a count, but capacity depends on cache membership

- **Severity:** High
- **Location or section:** [§1.3.5](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:93), [§6.4 P1](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:363), [§13.2 admissionBaseline](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:814), [§15.1 determinism](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:954), [actual admission logic](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/collision/CollisionWorld.js:877)
- **Problem:** Provenance records only `epochInstanceCount`. The core admits based on `currentSize + genuinely-new fragment IDs`, so two caches with the same count are not equivalent starting states.
- **Why it matters:** The specification calls the baseline an explicit environmental input, but it is insufficient to reproduce or explain a capacity outcome. Its determinism condition is therefore not externally checkable.
- **Concrete failure scenario:** Two epochs each contain 19,900 cached instances. In one, the next unit’s 200 fragments are already cached and the call succeeds. In the other, all 200 are new and the call fails at the 20,000 limit. Both runs record the same baseline count but produce different coverage and ledgers.
- **Recommended specification change:** Either:
  1. record a stable membership digest or per-planned-scope missing-count witness through an additive collision-core API; or
  2. explicitly state that the baseline is observational only and mark runs potentially environment-sensitive whenever a non-empty, uninspectable bucket can affect admission.

  Update AC-19 with equal-count/different-membership cases.

## 3. Foreign placement-revision exhaustion is an unrecorded environmental input

- **Severity:** High
- **Location or section:** [F13](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:74), [§7.3 concurrency](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:462), [§7.5 retries](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:472), [§15.1 environment inputs](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:963), [core revision check](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/collision/CollisionWorld.js:1152), [growth revision increment](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/collision/CollisionWorld.js:2583)
- **Problem:** A direct `findClashes` caller can repeatedly grow placement state, causing the engine’s TLAS unit to exhaust `maxPlacementRetries` and become a `stale-placement` gap. The run remains `environmentSensitive: false`; only bucket-capacity and geometry-readiness are recognized causes.
- **Why it matters:** This contradicts P1 and the repeatability contract. Identical test inputs can produce either full coverage or a gap based solely on concurrent extension activity.
- **Concrete failure scenario:** A batch unit is aborted three times by concurrent Clash Finder queries that add previously unseen fragments. It becomes `failed:stale-placement`. The same run in a quiet world evaluates successfully, but neither result identifies foreign placement activity as an environmental distinction.
- **Recommended specification change:** Add an environmental cause such as `foreign-placement-revision` when retries are exhausted with unchanged engine `placementGeneration`. Record expected/actual revisions and retry count. Treat comparisons involving that cause like other environment-sensitive runs, and add it to AC-19 and AC-21.

## 4. Cancellation before definition resolution cannot satisfy the Result Set schema

- **Severity:** High
- **Location or section:** [§5.3 deferred digest](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:230), [§8.2 cancellation transition](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:509), [§10.2 queued cancellation](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:591), [Result Set schema](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:775)
- **Problem:** Queued cancellation abandons planning immediately, but a direct definition may not yet have been normalized or assigned a semantic digest. A stored-reference run may not yet have performed its lookup. The schema permits `definition: null` and a null digest only for a stored-reference run that **failed** before resolution—not a cancelled run or a direct-definition run.
- **Why it matters:** Implementers must violate either cancellation semantics or the durable schema.
- **Concrete failure scenario:** `const handle = engine.startRun(def); handle.cancel()` occurs before the queued normalization slice. The engine cannot embed the normalized definition and digest without continuing abandoned work, but cannot legally seal them as null.
- **Recommended specification change:** Define a pre-resolution terminal representation covering both overloads and both `failed` and `cancelled` outcomes, including exactly which caller-supplied identity fields are retained. Alternatively, require definition resolution to complete before cancellation seals and revise the cancellation-latency contract. Add immediate-cancel acceptance cases for direct and stored-reference starts.

# Important Improvements

## 5. Late-observer persistence APIs conflict with bounded lifecycle memory

- **Severity:** Medium
- **Location or section:** [§13.5.1 late observers](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:850), [§13.5.2 eviction/release](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:863), [§18 API](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:1237)
- **Problem:** `getPersistenceState(runId)` is synchronous and advertised for late observers, but the engine also claims to discard its run/summary references after eviction or release. No lifetime, null/error behavior, or bound is defined for historical metadata.
- **Why it matters:** Keeping metadata forever violates the engine memory bound; dropping it makes the specified synchronous API impossible for evicted results.
- **Concrete failure scenario:** A long-lived engine completes and auto-evicts one million saved runs. Either it retains one million persistence records, or `getPersistenceState` cannot honor its declared contract for those run IDs.
- **Recommended specification change:** Limit the API to active/resident run IDs and define a typed not-resident result, or introduce a separately bounded metadata cache. Specify `retainResultSet`, `retryPersist`, and release behavior for nonresident IDs.

## 6. Executor caps are checked only after oversized arrays have been materialized

- **Severity:** Medium
- **Location or section:** [§7.1 validation and overflow](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:420), [UnitOutcome schema](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:641), [§17.5 worker seam](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:1201)
- **Problem:** The engine checks `pairs.length` and `diagnostics.length` only after the executor has projected and returned the arrays. A worker implementation would also clone or transfer them before validation.
- **Why it matters:** These limits bound retained state, not transient allocation, serialization cost, or worker-message size. Lowering a configured cap does not protect the process from the oversized object the executor already built.
- **Concrete failure scenario:** The library returns 300,000 diagnostics with a configured outcome cap of 20,000. The executor constructs 300,000 plain diagnostic objects and transfers them, after which the engine discards their detail.
- **Recommended specification change:** Put the limits in `ExecutionRequest` and require executors to enforce them while projecting. Add explicit overflow metadata—exact total plus a conservative taint—so an oversized array never crosses the port.

## 7. Record-count limits do not establish a usable memory ceiling

- **Severity:** Medium
- **Location or section:** [§6.5.1 ledger budget](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:383), [§13.5.2 resident bound](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:863), [§17.1 defaults](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:1117)
- **Problem:** Defaults permit four resident sets, each with up to four million plan/ledger records plus results and diagnostics. The specification acknowledges that bytes per record are unmeasured, but AC-12 only characterizes memory; it defines no pass threshold or mandatory recalibration for these limits.
- **Why it matters:** A formally bounded implementation can still exhaust browser memory before reaching its declared caps.
- **Concrete failure scenario:** Four held Result Sets approach the default ledger ceiling. Millions of JS objects, strings, arrays, and indexes can consume hundreds of megabytes or more, causing GC stalls or tab termination while still conforming to the specification.
- **Recommended specification change:** Gate default limits on a measured worst-case retained-byte target, or add `maxResidentBytes`/`maxResultSetBytes` with fail-closed accounting. Make calibration a pass condition before defaults are frozen, not characterization only.

# Questions / Clarifications

1. Is `UnitExecutor` a trusted semantic implementation port, or is structural validation expected to protect correctness? A structurally valid executor can return an empty `evaluated` outcome and create a false clean negative.

2. After `releaseResultSet`, eviction, or `discardRun`, which handle and persistence operations remain legal, and what exact error or null result do they return?

3. Should the OQ-4 live Viewer evidence be completed before planning the entire module or only before planning `clashtest/viewer/`? The document currently blocks the adapter but permits core planning.

# Positive Observations

- The three-cell decomposition explicitly addresses recursive subtree extraction and same-model self-exclusion instead of assuming dbId-set disjointness.
- Diagnostic overflow and unattributable fragments degrade conservatively; they cannot silently become clean negative evidence.
- Result-store identity claims and test tombstones have clear atomic, cross-run semantics with useful concurrency acceptance cases.
- Terminal-state precedence is unusually explicit and testable, including cancellation, disposal, drift, eviction, and result-cap combinations.

# Overall Readiness

**Requires major revision**

The four blocking issues affect input integrity, reproducibility, lifecycle sealing, and determinism. In addition, the repository’s required OQ-4 Viewer feasibility evidence is still absent, so Viewer-adapter implementation planning remains blocked even after the specification defects are corrected.
