# Federated Clash Test core — P7 independent implementation review

- **Date:** 2026-09-24
- **Repository:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`
- **Branch:** `feature/federated-clash-test-core-engine`
- **Reviewed checkpoint:** `c598ad36cdf3a1ff9c5c8bfb9af02ffe49c9b535` (`docs(p7): closeout #3 ...`)
- **Implementation boundary:** `b22a0a2..a3774bf` for P7 implementation, tests, targeted fixes, and owner-authorized errata; `c598ad3` adds the rerun-#3 acceptance record and handoff closeout.
- **Scope:** the completed P7 engine-integration checkpoint against the frozen design, the accepted P0–P6 interfaces, the P7 plan, owner rulings through #5, and the committed acceptance evidence. P0–P6 and the frozen architecture were not reopened.

## Verdict

**P7 is not ready for acceptance.** This review found **0 Critical, 1 High, 3 Medium, and 2 Low** findings.

The engine façade, world-scoped orchestration, run admission, lifecycle, real-`CollisionWorld` differential coverage, maximum-shape bounds, and the A11–A15 producer/read-back corrections are otherwise strongly implemented. The blocking issue is narrower: the public engine accepts a 512-code-unit hierarchy-acceptance reference, then produces a sealed Result Set that its own P5 reader rejects because the persisted schema caps that field at 256.

This is an independent Work review claim under `CLAUDE.md`. It requires targeted adjudication before remediation or P7 acceptance. P8 must not start.

## High finding

### H1 — the engine can seal a hierarchy-acceptance record that its own reader rejects

**Code:** `clashtest/engine.js:102-127`, `clashtest/results/resultSetSchema.js:57-60,149`; governing design §8.3, §13.2, §13.6, §18 and AC-20(d).

**Failure mode:** engine construction deliberately accepts `hierarchyInternalAcceptance.recordRef` through 512 code units, matching the frozen design. The sealed provenance carries that value unchanged. P5's persisted `Acceptance.recordRef`, however, uses the generic `id` cap of 256. A legal 257–512 value therefore produces a sealed and potentially durable set that succeeds in memory but rejects on read-back as `CorruptResultSetError` with `/provenance/hierarchyInternalAcceptance/recordRef:string-too-long`.

The mismatch was reproduced at the reviewed checkpoint through the public engine: a hierarchy-internal run with a 512-unit reference sealed and persisted successfully, then rejected with `CorruptResultSetError` / `string-too-long` after `releaseResultSet` forced store read-back. The committed construction test proves 512 is accepted, but no end-to-end test covers persistence, eviction, and read-back at that boundary.

This violates the frozen §13.6 producer/reader invariant: an engine must not produce a set it cannot read. It also makes a host-supplied acceptance record disappear operationally after release/eviction even though the run initially completed and the resident claim path could use it. This is an implementation-compatibility defect and a verification gap, not a reason to reopen the design.

**Minimum correction:** give `Acceptance.recordRef` its own 512-code-unit schema cap (leaving ordinary ids at 256), then add an engine-level produce → persist → release/evict → read/claim regression at 512 and a construction rejection at 513. No Result Set shape, public API, or architectural decision changes.

## Medium findings

### M1 — durable `libraryExclusions` contradicts the ledger and the claim-assessment contract

**Code:** `clashtest/engine.js:566-574`; `clashtest/run/Run.js:1051-1070`; planner source `clashtest/planning/rootResolution.js:301`. Governing design §5.6.3, §6.2, §8.3 and §13.2.

`buildRunSpec` hard-codes `provenance.libraryExclusions: []`, and `Run.provenanceOf` only spreads that static base; it never replaces it with the planner's derived exclusions. The planner already derives `hierarchy-internal` and `tree-unreachable-population` from the ledger facts, but those values are dropped before sealing.

The failure was reproduced with the real engine: a completed whole-model self-test sealed a non-empty `ledger.hierarchyInternal`, while `provenance.libraryExclusions` and `assessNoClashClaim(...).exclusions` were both empty. The qualified hierarchy claim remains fail-safe because the ledger and qualifier still block an unqualified claim, so this is not a false-clean path. It is nevertheless incorrect durable provenance and an externally observable API contradiction: the spec requires the exclusion to remain visible.

**Minimum correction:** derive the two defined exclusion strings from the final ledger at seal time, in deterministic order, and add engine-level tests for hierarchy-internal, unreachable-population, both, and neither. Do not add a second independent source of truth.

### M2 — `getFreshness(runId)` omits the frozen §13.6 by-id size predicate

**Code:** `clashtest/engine.js:998,1082-1105`; `test/clashtest/engine/rerun.test.mjs:491-498`. Governing design §13.6 exact `ResultSetTooLargeError` predicate.

The frozen design explicitly applies predicate (ii) to a valid set read by id for `rerun` **or `getFreshness`** when its result, ledger-record, or retained-diagnostic counts exceed the reading engine's effective bounds. The implementation installs `assertRerunReadable` only as `rerun`'s `checkById`; `getFreshness` has no corresponding check. The committed test explicitly pins the contradictory behavior by asserting that `getFreshness(set.runId)` succeeds for the same set whose by-id rerun is refused.

This does not make a valid set corrupt and the global capture/byte ceilings still bound memory, so it is not the same severity as H1. It is an externally observable error-contract mismatch and leaves the meaning of “effective” run-option bounds for freshness unresolved.

**Minimum correction:** targeted owner adjudication should confirm which run-option values govern `getFreshness` (the natural minimum is the engine's resolved default run options), then apply the same by-id count check and add exact-boundary tests. If the owner intentionally removes freshness from predicate (ii), that requires a bounded frozen-spec erratum rather than a code comment that silently narrows it.

### M3 — the specified read-abort surface is absent

**Code:** `clashtest/engine.js` read methods and `withReadSlot`/`withReadSet`; `ReadAbortedError` exists in `clashtest/errors.js` but has no P7 engine call site. Governing design §13.5.2 and AC-13 read-backpressure conjunct.

The design requires result-set reads to accept an optional `AbortSignal`, check it at slice boundaries, reject `ReadAbortedError`, and release the read slot. P7's `getResultSet`, by-id `rerun`, and freshness/claim paths accept no read signal; the slicer receives none, and no checkpoint test exercises abort-and-release. A queued or large read therefore cannot be cancelled through the public engine surface and can continue holding the sole provisional read slot until validation/freshness completes.

This is an operational/API completeness gap, not a data-correctness defect, because work remains bounded by the read and schema ceilings.

**Minimum correction:** reconcile one optional read-options shape across the affected P7 methods, thread the signal through queue acquisition, store read, validation/freezing, and freshness slices, and add abort-before-start, queued-abort, mid-validation abort, and slot-release tests. If the intended public signatures deliberately omit cancellation, record a bounded spec/plan disposition instead of exporting an unreachable `ReadAbortedError` contract.

## Low findings

### L1 — synchronous `discardRun` during `finalizing` can publish the wrong persistence snapshot

The committed closeout's D-5 reproducer records that `discardRun` invoked from a synchronous `finalizing` listener can make `done.persistence` report `{state:'skipped', attempt:0}` even though a result store is configured. No data loss or claim-safety failure was demonstrated, but the terminal snapshot is observably misleading.

**Minimum correction:** define and test the ordering between the finalizing event, persistence-attempt registration, and discard; either register the attempt before publication or explicitly specify the skipped outcome for this re-entrant case.

### L2 — acceptance traceability and closeout wording still overstate the gate

The rerun-#3 AC walk is mechanically complete, but the plan's AC table still does not cite the regressions that closed D-A, D-B, D-D, D-8/D-8b, and D-10 (proposal P-5), and the handoff says no High/Critical owner decision remains even though D-3 is a reproducible producer/read-back contradiction. Several acknowledged wording drifts remain (`UnreachablePopulation.count`, stale 1,000,000-result comments, and “range record” terminology after A14).

**Minimum correction:** after the blocking remediation is adjudicated, update the P7 AC citations and closeout wording in one documentation-only pass. These documentation gaps do not independently block code acceptance.

## Confirmed sound areas

- P7's public barrel is explicit and side-effect free; P8 annotation/derivation surfaces remain absent.
- Engine construction joins the world coordinator's single registry, enforces the synchronous `startRun` contract, and rolls back slot/queue admission atomically on covered failures.
- Disposal is signal-first, waits for owned runs, preserves unsaved sets in `DisposeSummary`, and keeps an injected never-returning unit as the explicitly accepted P6 drain limit.
- Real-`CollisionWorld` differential tests cover four modes and four selection shapes; deterministic modes, partition/broad-phase invariance, cancellation, readiness, eviction/disposal, placement contention, and mixed/unreachable owner behavior are exercised.
- Owner-authorized A11–A15 corrections close the known producer/read-back node, ledger-expansion, diagnostic, and per-model-root cap failures for producer-reachable shapes.

## Acceptance and verification assessment

- P7 task decomposition and implementation coverage are substantially complete, and the P7.11 acceptance record accurately preserves its evidence and most remaining caveats.
- H1 is a direct producer/read-back violation and blocks P7 acceptance.
- M1–M3 are contract gaps requiring targeted disposition/remediation but do not reopen the frozen architecture.
- G-CAL, G-EC, G-OQ4, G-OQ16, G-REMOTE and the AC-18 byte-measurement/calibration work remain external gates; they do not become P7 implementation defects through this review.
- P8, Viewer/OQ-4 integration, remote persistence, annotation/derivation work, and frozen-default promotion remain outside this checkpoint.

## Verification evidence

- `node --test test/clashtest/engine/*.test.mjs` — **213/213 passed**.
- `node --test test/clashtest/integration/*.test.mjs` — **90/90 passed**.
- `node scripts/run-tests.mjs` with local ephemeral-port access — **2,539 total / 2,538 passed / 0 failed / 1 todo**. The todo is the pre-existing documented extreme-aspect-ratio containment gap. The sandbox-only run first produced three local-port `EPERM` failures; all disappeared when the same command was allowed local ephemeral-port access.
- Direct H1 probe — a 512-unit `recordRef` was rejected on read as `CorruptResultSetError` / `string-too-long`.
- Direct M1 probe — non-empty hierarchy-internal ledger, but sealed `libraryExclusions: []` and claim assessment `exclusions: []`.
- Repository state before this review: branch `feature/federated-clash-test-core-engine`, HEAD `c598ad36cdf3a1ff9c5c8bfb9af02ffe49c9b535`, clean working tree.

## Gate result

`P7 requires targeted adjudication and remediation before acceptance.`

Blocking finding: **H1**. Do not start P8.
