# Independent Re-review — G2 H1 Cleanup / Operation-Refusal Remediation

**Date:** 2026-10-02  
**Repository state reviewed:** `main == origin/main == b33b7a94eaaefd4b3c7f097a4c743a5bb5abf80a`; working tree dirty with the uncommitted, harness/test-only remediation and review/handoff records.  
**Governing procedure:** `docs/research/2026-09-30-g2-viewerbridge-dockingpanel-live-verification-procedure.md`, SHA-256 `5f9c4c7e124751d09406f07eab63f844fec53add006bd12ad676ecaca3732abb` (unchanged).  
**Gate state:** `G2_DUAL_COUNTER_GATE.resolved=false`; `LIVE_PATH_WIRED=false`; no G2 live attempt/evidence and no production/Core/Adapter/M4/Panel/OQ-1/host change.

## Verdict

**0 Critical / 0 High / 4 Medium / 6 Low.**

The two concrete prior High failure modes are corrected:

1. Cleanup-generated page evidence is now drained before page teardown, rewritten through the page-ordinal map, and merged into authoritative state. Missing or duplicated ingested spy/event/snapshot records, unmapped ordinals, drain failure, and failure to run the drain all prevent PASS.
2. A required operation-begin acknowledgement now gates C16 hide, C17 unload, and cleanup unloads. Missing, thrown/rejected, refused, or malformed acknowledgement cannot reach recorder activity or the Viewer mutation.

The cleanup proof is not yet fully bidirectional for `eventLog`: `pageEvidenceProblems()` reverse-checks unsourced spies and snapshots, but deliberately exempts all event records. A Node-origin event is legal, but the current check does not distinguish it from an extra page-style cleanup event. The cleanup test explicitly accepts such an unsourced event. This does not recreate the original silent-omission path, so the original transfer High is closed, but it leaves H1's evidence-integrity claim incomplete and blocks resolving the H1 gate.

## Findings

### Medium M1 — cleanup event provenance is not checked in the reverse direction

`pageEvidenceProblems()` proves that every ingested page `event` appears exactly once, but its reverse loop covers only `spy` and `snapshot` (`clashpanel-viewerbridge.acceptance.mjs:3654-3667`). The test at `clashpanel-viewerbridge.acceptance.cleanup-evidence.test.mjs:201-214` confirms that an extra Node-sequenced `eventLog` record with no ingested page event is accepted.

This contradicts the handoff/internal-review wording that *any* unsourced cleanup record fails closed. Legitimate Node events mean the correction cannot simply reject every non-page event; it needs a mechanical provenance discriminator or an authoritative Node-allocation/source set, followed by an unsourced cleanup-event negative test. Severity is Medium because the normal `g2CleanupDrain()` source is the recorder's own event array and the one-way check still catches omission of every ingested wrapper event; the gap concerns malformed/extra evidence rather than the prior missing-evidence false-PASS path.

**Disposition:** required before `G2_DUAL_COUNTER_GATE.resolved` may flip and before live planning. H1 is not fully closed until this proof is complete.

### Medium M2 — failed phase runs do not retain cleanup evidence

`drainCleanup()` returns immediately unless `cleanupEvidence.runApplied` is true (`clashpanel-viewerbridge.acceptance.mjs:12627-12629`). A thrown/timed-out phase run is already tainted and cannot PASS, but cleanup still executes and its page-origin records are omitted from the failure artifact.

**Disposition:** before-live-execution hardening, not a blocker to the original transfer High. The accepted durable-evidence model favors retaining the cleanup delta even on failure, or retaining an explicit boundary record stating why it was unavailable.

### Medium M3 — thrown/malformed operation-begin lacks durable exact cause

`runAcknowledgedMutation()` blocks the mutation correctly (`clashpanel-viewerbridge.acceptance.mjs:6878-6889`), but the page's exact exception/refusal detail remains in `phaseLog`, which is not retained by `applyPhaseRunToState`; the durable result only exposes the generic P9 harness-exception outcome. Verdict correctness is preserved, and Node-side refusals still retain their exact `op-begin-refused:<reason>` violation.

**Disposition:** before-live-execution hardening, not an operation-refusal blocker. Retain a bounded/redacted barrier-failure detail or the relevant phase-log entry.

### Medium M4 — static guards cannot prove every future consumer uses the injected allocator

The runtime namespace checks, mutation controls, real Playwright binding gate, and direct source inspection establish one allocator for the current implementation. The static suite can still miss a future consumer-local counter that ignores injected `nextSeq`.

**Disposition:** sufficient for live planning once M1 is fixed and the owner resolves the gate; strengthen before live execution. This limitation alone need not prevent the gate flip because current runtime evidence detects collisions/leaks and the actual current consumers were inspected.

## Prior-High adjudication

### Cleanup transfer/completeness High — concrete failure closed; gate proof incomplete

- `g2CleanupDrain()` snapshots cleanup spies, recorder events (including `wrapper-restore`), snapshots, and page high-water without yielding, then awaits the same pending-ordinal drain (`clashpanel-viewerbridge.acceptance.mjs:11509-11522`).
- `drainCleanup()` runs as `closePage.beforeClose`, under T8, before the page close; it reconciles page fatals, rewrites ordinals, and merges the delta (`:12627-12641`).
- `mergeCleanupDelta()` is idempotent against already-authoritative sequences and preserves event order (`:12174-12183`). Missing/duplicate ingested records and leaked/unmapped ordinals fail closed.
- The focused tests are non-vacuous for omitted wrapper events, omitted spies/snapshots, duplicate records, skipped drain, bad high-water, and unmapped ordinals.

The original silent omission is therefore closed. M1 prevents declaring the broader H1 evidence-integrity gate fully closed.

### Operation-begin refusal High — fully closed

With `requireOps=true`, the helper accepts only `{ok:true, operationId:<non-empty string>}` before recording or invoking. Missing binding, synchronous throw, rejected promise, `ok !== true`, or malformed/empty id throws first. C16, C17, and cleanup unload wiring all set `requireOps`; a cleanup unload without a ledgered A/B model id also blocks. Node phase/descriptor/sealed refusals use one `authority.refuseOperation()` call; ingest refusal returns its existing single violation. Tests cover the direct helper, dormant P9 drivers, cleanup runner, mutation controls, and real `exposeFunction` scheduling.

## Remaining Low dispositions

| Item | State | Required point |
|---|---|---|
| Active-control phase ownership | **Open.** Ingestion/sync checks enum membership only; unlike `activeCheck`, it never compares `activeControl` with `CONTROL_OWNING_PHASE`. | Before live execution |
| Teardown C-e proxy | Open; cleanup marker is still a proxy for terminal records. | Before live execution |
| `T_iso` authority | Open; ledger target is not reconciled with the retained Viewer-call argument. | Before live execution |
| C15(e) direct FAIL routing | PASS is already prevented by schema/R1 contradiction handling. | Optional conformance hardening |
| Refused/throwing `ops.end` | Mutation ran; record remains `not-settled`, which prevents PASS, but the refusal is swallowed. | Before live execution |
| Thrown drain RPC detail | The drain failure remains fatal, but `withDeadline` loses the exact thrown error name in this branch. | Optional diagnostic hardening |

The former active-control Low is **not closed**: `activeCheckPhaseProblem()` has no control analogue, and both ingestion and `syncPage()` only validate the control enum.

## Verification

- Focused G2 suite: **613/613 PASS**.
- Aggregate offline suite: **4859 total / 4858 pass / 0 fail / 1 existing todo**. The first sandboxed attempt could not bind the M4 test server; the permission-correct rerun passed without code changes.
- Real local Playwright binding gate: **8/8 PASS**. It exercises accepted/refused/delayed operation-begin, prevents action start on refusal, and demonstrates one authoritative sequence namespace without APS/Viewer/network.
- `git diff --check`: clean. No live G2 run, gate flip, authorization record, commit, or push occurred.

## Readiness

- **Both prior Highs:** cleanup's original omission failure is closed; operation refusal is fully closed.
- **H1 fully closed:** **No**, because M1 leaves cleanup-event reverse provenance unproved.
- **`G2_DUAL_COUNTER_GATE.resolved` ready to flip:** **No**; first close M1 and re-review the bounded correction.
- **Checkpoint commit:** **Not yet recommended** for an H1-closeout checkpoint. A diagnostic WIP commit would be mechanically possible with both gates false, but it would preserve a known gate blocker.
- **Live planning:** **Not ready** while H1/gate resolution remains open.
- **Before live execution:** M2/M3/M4, active-control phase ownership, teardown C-e, `T_iso`, unsettled `ops.end`, the existing M1/M2 pre-link/closeout static hardening, clean-tree/digest rebinding, and a fresh owner-issued single-use authorization record.

## Exact next authorized action

No harness edit, gate flip, commit, push, authorization-record issuance, or live work is authorized by this review. The next candidate action is explicit owner authorization for a bounded harness/test correction of M1 (page-vs-Node event provenance and an unsourced cleanup-event negative control), followed by a targeted independent re-review.
