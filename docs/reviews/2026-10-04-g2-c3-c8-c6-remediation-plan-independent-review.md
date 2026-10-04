# G2 C3/C8/C6 bounded remediation plan — independent review

## Verdict

**0 Critical / 0 High / 2 Medium / 1 Low.** The plan is ready for **bounded C3/C2 implementation authorization only**. It is not yet ready for broader C8/C6 implementation authorization, diagnostic instrumentation implementation, or a live diagnostic/acceptance attempt.

The two Medium items are explicit research/calibration prerequisites, not reasons to reopen the accepted G2 architecture. They do not block the deterministic C3/C2 correction.

## Verified repository boundary

- Repository/branch: `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`, `main`.
- `HEAD == origin/main == 6f716bc0d0d2c1b1e61d26fe50b4dbe56266f7e4`.
- The preserved snapshot at `docs/research/evidence/g2-live-20261004-75a3ccb9/` is present and its ten evidence hashes still match the committed manifest.
- The single live attempt remains closed at `FAIL (row 3)`; no retry, replacement authorization record, attempt reset, or remediation implementation exists.
- Harness SHA-256 remains `471fae40d371c292f05d92bbdafdbdaa426a0426af0924a6e0946ac69fe77ac4`; procedure SHA-256 remains `d1ccfde224b8ae76fe74b06c93abc532e6df9612933cafaa045053c8e2e45a75`.

The working tree contains only the uncommitted planning/handoff artifacts and pre-existing untracked governance/live-review artifacts. No harness, test, procedure, product, Core, Viewer Adapter, M4, Panel, OQ-1, or host implementation file changed. `git diff --check` is clean.

## Findings

### Medium M1 — D0 cannot by itself establish the claimed runtime event semantics

**Plan sections:** §3 D0, §4.2, §6.

D0 is labelled “no live run,” yet asks whether `cameraTransitionCompleted` fires for every `fitToView`, is per-request or coalesced, is final when fired, whether `restoreState(..., true)` cancels an active transition, and what happens when a fit is issued during another transition. Static inspection of the pinned Viewer can establish API/event availability and implementation clues, but it cannot mechanically establish every runtime timing/coalescing behavior in the accepted Viewer/model envelope.

This does not invalidate H2/H5 or the E1–E5 matrix. It changes the gate boundary:

- D0 may establish the API surface and source-level behavior only.
- D2 must prove candidate settle algorithms against delayed/queued/no-op synthetic transitions offline.
- D4, if separately authorized, is the runtime characterization needed for event timing, coalescing, restore, and active-transition behavior.
- T4 must remain unchanged until those results support a specific correction and the owner authorizes procedure amendment/re-acceptance.

**Impact:** blocks broader C8/C6 implementation authorization, not C3/C2 or bounded offline investigation.

### Medium M2 — S3's numeric margin has no defensible derivation yet

**Plan sections:** §4.3 S3, §4.5, §9 question 5.

The proposed `≈1` margin is correctly marked unresolved, but it is not ready for owner approval as a number. `worstExcess` is already dimensionless in clip/NDC space, so an **absolute dimensionless separation margin** is the appropriate form; a geometry-size-relative threshold would mix world-space scale into an already normalized predicate.

Derive the value from:

1. D2's delayed/queued/no-op transition matrix and boundary fixtures;
2. the frozen T16 predicate and finite-value rules;
3. observed repeatability/uncertainty from any separately authorized diagnostic run;
4. a lower bound separating a valid C6 observation from a valid N2 counterexample, with tests immediately below, at, and above the bound.

If no stable separation bound can be justified, do not add S3. Keep the existing fail-closed `NOT_DISCRIMINATING` behavior. This requirement blocks C6 implementation, not C3/C2.

### Low L1 — C2 impact is overstated

**Plan §1.2.** The `domainWrites` filter has the same name/value error, but a construction-time `panel/shown` or `panel/hidden` already makes C2 clause (vii) fail because `dispatchesDuringConstruction !== 0`. Therefore the bad filter misclassifies/double-reports the dispatch under clause (viii); it does not create an otherwise-PASS-to-FAIL transition by itself. The correction remains worthwhile for truthful clause evidence and drift prevention.

## C3 diagnosis and fix

The defect is confirmed directly:

- product `INTENT.PANEL_SHOWN/PANEL_HIDDEN` values are `panel/shown` and `panel/hidden`;
- `ClashDockingPanel` dispatches those values;
- the harness collector stores `intent.type`;
- `evaluateC3` compares those values to the symbolic names `PANEL_SHOWN/PANEL_HIDDEN`.

An independent offline reproduction using the real `INTENT` values returns `FAIL(repetitions)`. Existing oracle tests pass because they use the incorrect symbolic-name fixtures.

The proposed correction is minimal and procedure-neutral: copy canonical values into harness-local constants, use them in C3/C2, and add a test that imports product `INTENT` to detect future drift. Keeping product imports out of the browser page-agent preserves oracle independence and avoids silently changing the served page bundle.

**Verdict:** C3 is ready for a bounded harness/test-only correction. No procedure amendment is required.

## C2 and sibling audit

C2 line 11732 has the same literal mismatch. Its current live PASS is consistent with zero construction dispatches; the defect was latent in clause-(viii) classification.

A repository-wide scan of quoted product-intent key names in the G2 harness finds only the C3 comparisons and the C2 filter. No other C1–C20 intent-key name/value site is present. The remaining unread `sceneOwnershipOracle`/C4 internals do not contain product-intent symbolic-name literals, so deep review of unrelated geometry/ownership logic is unnecessary for this bug class.

**Audit verdict:** sufficient at planning level. The implementation checkpoint should retain one static guard over all C1–C20 harness/probe code for quoted `INTENT` key names and `Object.keys(INTENT)` misuse.

## C8 hypothesis and diagnostics

The plan correctly preserves the authoritative result: C8 materially failed, while root cause remains unproven. The reconstructed projection is useful but remains inference because the original camera descriptor and operation-correlated transition evidence were not retained.

The H1–H5 matrix is appropriately separated:

- E1 compares product behavior after quiescence with the current early sample, distinguishing H2/H5 from a product miss.
- E2 compares direct Viewer fit with product fit from equivalent quiet state, distinguishing H1 from H4.
- E3 tests sequence-dependent one-step lag; E4 tests reset behavior; E5 tests active-transition queue/coalescence.
- D1 can close arithmetic replay/H3 offline; D2 can reproduce the false-settle mechanism without Viewer access.

No single experiment alone proves the cause. The table's instruction to retain ambiguity when results conflict is correct.

**Verdict:** hypothesis/diagnostic design is sound after applying M1's static-versus-runtime boundary. It is ready for a later implementation plan, not for implementation now.

## T4 recommendation

**Keep frozen T4 unchanged during initial diagnostics.** First perform static API evidence and D1/D2 offline work. Decide on a revised settle rule only after that evidence, and use D4 runtime characterization if source/offline evidence cannot establish request ownership and completion behavior.

Any change to T4 alters accepted observation semantics, affects C6/C8/C20, changes the procedure SHA, and requires explicit owner authorization plus independent procedure re-acceptance. It is not a harness-only correction.

## Diagnostic live-run architecture

The split between the diagnostic-live gate and remediation-retry gate removes the former circular dependency. A diagnostic run can gather evidence without claiming G2 acceptance, but it still needs:

- a separately accepted diagnostic implementation/evidence schema;
- a clean checkpoint and new single-use record/attempt identity;
- explicit owner authorization naming diagnostic purpose and immutable output;
- wording that the closed `FAIL (row 3)` is not reinterpreted.

Prefer a separate bounded diagnostic driver/schema over running the full harness as an apparent retry. Resolve as much as possible through D0-static, D1, and D2 first. Authorize D4 only if the remaining runtime ambiguity materially blocks the settle decision.

## C6/N2 decisions

### Control-state representation

Use **M1**: retain `NOT_DISCRIMINATING` and add a precise reason such as invalid/unowned observation. This preserves the accepted control-state/schema/roll-up contract and keeps C6 fail-closed at `NOT_EVIDENCED`. A new `CONTROL_INVALID` state is unnecessary unless the owner specifically requires a new externally visible schema distinction; that choice would require procedure and verdict-contract re-acceptance.

### Offline proof prerequisite

Before any future live diagnostic or acceptance attempt that relies on remediated C6/N2, offline tests must demonstrate:

- a valid aggregate-fit observation that frames the two-model union;
- a request-owned single-side control observation that frames `b*` but excludes enough of the union to discriminate;
- delayed, queued, no-op, timeout, unreadable-camera, and stale-previous-request cases;
- fail-closed `NOT_DISCRIMINATING`/BLOCKED behavior when ownership, self-validation, or the derived margin is absent.

This proof is mandatory before live execution. It does not by itself prove Viewer runtime event behavior.

## C20 disposition

C20 remains derivative and requires no separate remediation workstream. It becomes runnable only after C4/C7 prerequisites pass, C8 reaches a trustworthy PASS under an accepted settle rule, N8 is runnable, and the C20 canvas/DSF/target preconditions are satisfied. Until then `BLOCKED(dependency:C8)` is correct.

## Evidence bounds and test commands

Per-frame cameras, transition/camera events, operation timelines, descriptors, and repeated experiment records can grow. The later implementation plan must define per-operation sample/event caps, total byte caps, first/last/transition-adjacent retention, and explicit truncation metadata. Diagnostic truncation must never create PASS; if it removes data needed to distinguish hypotheses, that experiment is `NOT_EVIDENCED`/inconclusive.

Exact commands are a non-blocking implementation-plan detail. That plan should mechanically require:

- focused G2 oracle/runner/op-refusal/control/schema tests;
- the complete G2 acceptance-test family;
- `npm run test:offline` and `npm run test:g2:binding`;
- the repository's aggregate `npm test` gate before checkpoint closeout.

The current unchanged focused oracle suite passes **25/25** under Node v22.23.1. This is baseline verification, not remediation evidence.

## Remediation order

Accepted order, with one clarification:

1. Authorize and checkpoint C3/C2 deterministic correction plus the bounded name/value audit.
2. Perform D0-static and D1 read-only replay/design; authorize D2 implementation separately.
3. Prove C6/N2 control behavior offline and derive—or explicitly decline—S3.
4. Select T4/C6 semantics through owner decision and, if changed, amend/re-accept the procedure.
5. Implement bounded diagnostics, independently review them, then decide whether D4 is necessary.

A diagnostic run, if still necessary, precedes any acceptance retry. A later acceptance retry requires every gate in §7.1, a clean checkpoint, new superseding record, and explicit exactly-one owner authorization.

## Separate C3/C2 authorization

**Yes.** It is independently safe and has no dependency on C8/C6/Viewer behavior.

Exact bounded scope:

- harness-local canonical `panel/shown` and `panel/hidden` values;
- C3 comparison and C2 domain-write filter/helper only;
- affected oracle/runner/op-refusal fixtures and a real-`INTENT` drift test;
- bounded all-C1–C20 static audit/guard for this name/value bug class;
- focused, G2-family, offline, binding, and aggregate regression gates.

No procedure, product, ViewerBridge, Core, Viewer Adapter, M4, Panel implementation, live instrumentation, authorization record, attempt state, or preserved evidence change belongs in that authorization. Checkpoint and independently review this correction before C8/C6 implementation begins.

## Internal-review adjudication

The internal review's three Critical and four High fixes are present: diagnostic gate circularity is removed; A0/A1 are separated; control-invalid mapping is explicit; E1–E5 exist; instrumentation/evidence bounds are recognized; supersession is required; and procedure-changing work is not described as harness-only.

Its remaining margin/tolerance and exact-command items are correctly deferred to implementation planning, subject to M1/M2 above. No new Critical or High plan defect remains.

## Implementation-readiness and owner decisions

| Decision | Recommendation | Ready now? |
| --- | --- | --- |
| T4 settle rule | Keep unchanged; gather static/offline evidence first, then runtime diagnostic evidence only if needed | No revision authorized |
| N2 invalid observation | Reuse `NOT_DISCRIMINATING` with a new reason (M1) | Ready as preferred design disposition |
| C6 S3 margin | Absolute dimensionless margin derived from offline/runtime variability; do not approve `≈1` now | Not ready |
| Diagnostic live strategy | Offline first; if still needed, separate diagnostic driver/record before any acceptance retry | Not ready for live authorization |
| C3/C2 separation | Authorize the exact harness/test-only scope above and independently checkpoint it | Ready for owner authorization |

## Exact recommended next authorized action

Authorize one bounded C3/C2 harness-and-test correction only, including the name/value static guard and offline regression gates, followed by an independent checkpoint review. Separately authorize D0-static/D1 investigation if desired. Do not authorize C8/C6 implementation, T4/procedure changes, diagnostic instrumentation, a live diagnostic, or an acceptance retry yet.
