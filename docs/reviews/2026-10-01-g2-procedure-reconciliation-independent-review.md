# Independent Review — G2 Procedure Reconciliation RC1

**Date:** 2026-10-01  
**Repository:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`  
**Branch / HEAD:** `main` @ `68ef222f097d5ff34b475fdb3980fe662574ac3d` (`origin/main` identical)  
**Reviewed artifact:** [`docs/research/2026-09-30-g2-viewerbridge-dockingpanel-live-verification-procedure.md`](../research/2026-09-30-g2-viewerbridge-dockingpanel-live-verification-procedure.md), uncommitted RC1  
**Scope:** C15(e), X4 / `NOT_RUN_DEPENDENCY_BLOCKED`, request-fatality, directly affected schema/verdict/harness-impact text

## Verdict

RC1 is **not ready to commit** and is **not ready to authorize the harness follow-up**. It closes the original `inspectLedger()` contradiction and selects a technically sound dependency-blocked policy, but introduces or leaves two live-readiness blockers:

1. C15(e) requires the hidden-node read to be empty while Panel isolation is still observably applied, even though the procedure already treats that Viewer behavior as an observation-only unknown.
2. HTTP error responses are explicitly outside the fatal-resource policy, so a required resource returning 4xx/5xx can escape the fatal ledger entirely.

The request-cancellation model also needs mechanically auditable prefix-source evidence, and the new NRDB/result schemas need exact shapes before implementation.

**Findings:** 0 Critical / 2 High / 3 Medium / 2 Low.

## Repository and authorization state

- `main` and `origin/main` both resolve to `68ef222f097d5ff34b475fdb3980fe662574ac3d`.
- The dormant G2 harness checkpoint is committed at HEAD. The working tree contains only the uncommitted procedure/handoff reconciliation and its prompt/internal review; production and harness files are unchanged.
- `LIVE_PATH_WIRED` remains `false`. No G2 reservation, journal, result, commit record, or other live-run artifact exists.
- Current committed procedure SHA-256: `940d525fdb2fd17ac4737bcdffe5668afc6956e59c0009b18cc257e222ff1d2e`. Current uncommitted RC1 SHA-256: `6a94713c4b475f752c2bda214812a0d4dc2ce4d7be799a870bedfd4ae3d44fdf`.
- This review changed only this review record and the handoff. Procedure, harness, production code, and live state were not modified.

## Findings

### Critical

None.

### High

#### H1 — C15(e) requires an unsupported empty hidden-node state after the failed clear

**Where:** C15(e) S3, procedure line 303; compare C10, line 279.

RC1 correctly requires the first injected `clear()` to leave aggregate isolation equal to `T_iso`. However, S3 simultaneously requires the hidden-node set to be empty. C10 already recognizes that Viewer 7.124.2 may report nodes excluded by aggregate isolation through `getAggregateHiddenNodes()` and deliberately treats that behavior as observation-only. `ViewerBridge` does not separately clear hidden nodes when isolation restoration fails.

A correct Viewer can therefore retain `T_iso` and report isolation-derived hidden nodes. RC1 would label that correct retained state a C15(e) failure.

**Failure mode:** false C15(e) `FAIL` despite the intended retry mechanism working exactly: first clear fails without applying the original setter, second clear restores, third clear returns `none`.

**Minimum correction:** immediately after the successful setup `present()`, retain `H_iso := canonical(getAggregateHiddenNodes())`. After clear #1 require the hidden read to equal `H_iso`, not to be empty. After clear #2 and clear #3 require the baseline empty hidden read. Add mutations for an unexpected hidden-state change after clear #1 and failure to return to baseline after clear #2. No production or threshold change is needed.

#### H2 — HTTP 4xx/5xx required-resource failures can escape the fatal ledger

**Where:** §9.2 Scope, procedure line 559.

RC1 explicitly limits classification to Playwright `requestfailed`. Playwright does not emit `requestfailed` for an HTTP response merely because its status is 4xx/5xx. The procedure therefore gives HTTP errors no effect beyond whatever the awaited Viewer operation happens to report.

That is insufficient for the stated fail-closed required-resource contract. A bootstrap/module/token/model manifest/geometry/property request can receive an HTTP error without entering `requestFailures[]` or incrementing `fatalCount`. If the Viewer tolerates or defers that resource, G2 can continue without a fatal witness; if load later rejects, X4 can incorrectly become `BLOCKED` rather than the required-resource `FAIL` intended by X23.

**Minimum correction:** add a response-error policy and retained `responseFailures[]` evidence. Every status ≥400 must be fatal by default. Bootstrap and harness-endpoint responses are always fatal; `other` responses remain fatal unless a future procedure explicitly defines a bounded expected-status exception. No broad host/path allow-list is needed. Add fake-page listener tests and an X23-equivalent HTTP-response case.

### Medium

#### M1 — Model-prefix derivation is not independently auditable

**Where:** §9.2 Model binding and Captured fields, lines 565–567.

`modelPrefixes[M]` is derived from requests that started in M's load window and “did not fail,” but RC1 does not define or persist the successful `requestfinished` observations from which that fact is established. The durable record contains only the final prefix sets and failed requests. An independent reviewer therefore cannot recompute which requests qualified, whether the load windows overlapped, or which ambiguous prefixes were removed.

**Minimum correction:** define and persist a verdict-critical prefix-source ledger containing the exact request start/finish outcome, resource type, redacted key, model load-window bounds, and inclusion/exclusion reason. Derive `modelPrefixes` purely from that ledger; retain ambiguous keys separately; recompute and schema-check the derivation at closeout. A candidate request that later fails must not be allowed to prove its own prefix.

#### M2 — The request-classifier result and evidence schemas disagree

**Where:** §9.2 Captured fields, line 567; Classification function, line 569.

The normative `eventTime`/`closeout` records require `boundPrefix`, but the declared return value of `classifyRequestFailure` omits it. RC1 also leaves the `opLedger` union notation (`settledSeq|readySeq|null`) open to more than one JSON shape.

**Minimum correction:** include `boundPrefix` explicitly in the classifier return type and define its exact nullability for `EC-teardown` and all FATAL results. Define exact, disjoint `opLedger` shapes for `loadModel` and mutation/teardown operations, with unknown keys rejected.

#### M3 — NRDB policy is sound, but its schema and harness transition are incomplete

**Where:** §7 legality rule, line 418; §10 controls schema, line 583; internal-review harness impact.

Option B is technically sound: legal NRDB is neutral at row 4 but cannot satisfy PASS, so row 6 can return `BLOCKED`; executed failures and mid-run unrun controls remain row-4 `FAIL`. X20–X23 correctly protect the boundary.

Two mechanical gaps remain:

- `executionRecord: none` is not given an exact JSON type/value, and the required shape for an executed control is not defined. `phaseSeq` is not explicitly constrained to the exact retained C1 finalization event.
- The committed runner does not yet globally gate P2–P11 controls on C1. P2/N1 has no check dependency and currently runs after C1. Also, committed `evaluateC1()` emits reasons such as `prerequisite:model-not-loaded:B`, while L1 permits only exact `prerequisite` or `timeout:load`. The internal follow-up list does not explicitly name these two required changes.

**Minimum correction:** define exact control-record schemas and phase-sequence referential validation in the procedure. The harness follow-up must normalize C1's top-level reason while retaining detailed causes in fields, and add an explicit global C1 gate before every later phase/control.

### Low

1. The procedure header still says “No harness code written” and “Not committed,” although the dormant harness is committed at current HEAD. This is stale status text, not a contract defect.
2. §12 still presents D1/D2/D4/D7 as open even though their owner acceptance is recorded in the committed handoff/closeout. Retain the historical decision table if useful, but label it accepted rather than currently open.

## C15(e) adjudication

### Confirmed sound

- The injection wrapper is explicitly throw-before-apply; the original `setAggregateIsolation` is not called while armed.
- `ViewerBridge.releaseHeld()` removes marker meshes and sets `held=null`, then calls `isolation.restore()` in `finally`.
- `isolation.restore()` leaves its private record intact on a failed restore. With the wrapper removed, clear #2 can restore the retained pre-image and drops the record; clear #3 then returns `none` without another bridge-origin isolation write.
- The oracle no longer depends on post-clear `inspectLedger()`. Its post-clear values are diagnostics-only.
- `getAggregateIsolation()`, `getAggregateHiddenNodes()`, and `getAllModels()` are existing Viewer methods already consumed by the production `createViewerApi` boundary. They are observable without private Viewer or bridge internals in the pinned envelope.
- The sequence is causal, not three unrelated outcomes: after clear #1, markers and the outer ledger are gone and no harness-origin Viewer mutation is allowed; clear #2's bridge-origin setter call and transition from `T_iso` to `E0` can only be explained by the isolation session's retained retry record; clear #3 proves that record was removed.

### Disposition

The original impossible-ledger defect is closed, but **C15(e) as reconciled is not fully resolved** until S3 uses the captured post-present hidden-state baseline rather than requiring empty hidden state.

## X4 / NRDB adjudication

Option B is the correct policy for the already accepted semantics: C1 is the global prerequisite gate, and external prerequisite loss with no earlier failure is `BLOCKED`. Legal NRDB cannot grant PASS and cannot mask an executed failure.

The row ordering is coherent:

- rows 1–3 still dominate;
- illegal NRDB, executed failures, mid-run timeout/taint, driver errors, and controls left unrun after C1 passed remain row-4 `FAIL`;
- only exact C1 prerequisite/load-timeout loss plus never-started controls can reach row 6;
- X4 becomes reachable once the runner actually enforces the global C1 gate and emits the defined records.

**Disposition:** conceptually resolved and technically sound, but **not mechanically complete** until M3's exact schema and runner-transition requirements are added.

## Request-fatality adjudication

### Confirmed sound

- Unknown/unclassifiable `requestfailed` events remain fatal.
- Temporal overlap alone is insufficient. EC-hide and EC-unload additionally require an exact abort code, eligible resource type, in-flight-before-operation proof, unique model prefix, operation-window membership, and phase coherence.
- Prefixes shared between models are removed; overlapping or non-distinguishing load windows cause a fail-safe FATAL result.
- EC-teardown is bounded by actual page/context/browser close operations after every check has a final verdict.
- Event-time and closeout classifications must agree; mismatch is row-5 `FAIL`.

### Disposition

The expected-cancellation concept is bounded and fail-closed, but **request-fatality is not resolved** because HTTP error responses are unobserved and the model-prefix evidence cannot yet be independently recomputed. H2 and M1/M2 require procedure correction before harness follow-up authorization.

## Harness follow-up classification

### Required before live planning

1. **C15:** implement the corrected H-isolation baseline, three-clear driver, pure oracle, evidence schema, and mutation tests; remove the old ledger predicate.
2. **X4/NRDB:** add exact states/schemas/legality, normalize C1 reason/detail, add the global C1 phase gate, preserve executed failures, update X4/X20–X23 and the exhaustive verdict matrix.
3. **Network policy:** add request start/finish/failure and HTTP-response listeners, operation/phase ledgers, auditable prefix derivation, event-time/closeout classifiers, schema/redaction checks, and listener/integration truth tables.
4. Run the focused and aggregate offline gates and obtain a bounded independent implementation re-review. The live switch remains false throughout.

### Required before live execution only

- Complete the prior M1/M2 static-guard hardening over the pre-link dependency graph and full live closeout consumers.
- Commit the final procedure/harness/tests/reviews, obtain a clean tree, recompute final procedure/harness/HEAD digests, and issue a new single-use authorization record only afterward.

### Optional

- Rename `notExecutableState` after its dependency-blocked split and add a dedicated convenience attestation test, provided the required exhaustive matrix already proves the same invariant.

## Procedure SHA and authorization

RC1 changes the procedure bytes, so any future record must bind a new `Procedure-SHA256`. The current RC1 digest is not suitable for issuance because this review requires further procedure correction. After that correction and its commit, recompute the digest from the final bytes.

An old authorization record cannot be reused silently: W1 requires its `Procedure-SHA256` to equal the file's current digest, and also binds baseline HEAD and harness SHA. A mismatch refuses before reservation/consumption. If any older G2 live record is later present in the candidate set, the new record must also satisfy the procedure's unique non-superseded candidate rule. No G2 live record or attempt currently exists.

## Verification

- `node --test test/acceptance/clashpanel-viewerbridge.acceptance.tablet.test.mjs` — **7/7 pass**.
- The test confirms Table T rev-2, deadline classes, phase order, dependency declarations, and single-bridge tracking remain unchanged. It does not verify the new C15/NRDB/network semantics; those tests require the unauthorized harness follow-up.
- `git diff --check` passed before this review was written.
- No live G2, Playwright/Viewer execution, fixture load, real-Viewer injection, or production/harness edit occurred.

## Readiness and authorization

- **C15(e):** not fully resolved; one High oracle correction remains.
- **X4:** policy resolved; mechanical schema/runner transition incomplete.
- **Request-fatality:** not resolved; one High response-coverage gap and two Medium evidence/schema gaps remain.
- **Procedure ready to commit:** no.
- **Additional procedure correction required before harness follow-up authorization:** yes, limited to H1/H2 and M1–M3 plus the two stale Low statements.
- **Live-planning blocker remains:** yes. After procedure acceptance, the committed harness must be reconciled, tested, independently reviewed, committed, and SHA-bound before any live planning/record issuance.
- **External dependency:** none. No production ViewerBridge, Panel, Core, Viewer Adapter, M4, OQ-1, host, initializer, upload, or retranslation change is required.
- **Current authorization:** this independent review and handoff update only. Procedure remediation, harness edits, commit, push, `LIVE_PATH_WIRED=true`, authorization-record issuance, and live G2 remain unauthorized.

