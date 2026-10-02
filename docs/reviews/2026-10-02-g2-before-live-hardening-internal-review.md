# G2 Before-Live Hardening — Focused Internal Review (2026-10-02)

## Scope / boundary

- Repository: `aps-viewer-clash-detection`, branch `main`, HEAD `c0f877a` (H1 dual-counter gate resolution).
- Artifact under review: the **uncommitted working tree** only:
  - modified: `test/acceptance/clashpanel-viewerbridge.acceptance.mjs` (harness; 4 files total +414/-40), `...mainflow.test.mjs`, `...op-refusal.test.mjs`, `...sequencing-guards.test.mjs`;
  - untracked: `...final-transfer.test.mjs`, `...op-refusal-detail.test.mjs`, `...seq-source-guards.test.mjs`
    (plus prompt files under `docs/prompts/`, not reviewed).
- Authority: `docs/prompts/for-claude-g2-before-live-hardening-only.md` (§§2–6 required outcomes and test lists).
- Scope (per CLAUDE.md "Internal review loop", one focused pass): the four before-live Medium items and their
  directly affected evidence/sequencing paths only. No unrestricted full-harness review. No production / harness /
  test edits were made by this review; no live run; no commit.
- Independent reader: Codex via `codex-advisor medium` (request `20261002-121704-76454-6817`). Every Codex claim
  below was re-verified against source by the reviewer; disagreements on severity are recorded.

## Boundary checks (verified)

| Check | Result |
| --- | --- |
| `git diff --stat` / `git status` | only `test/acceptance/*` (4 modified, 3 untracked) and `docs/prompts/*` (2 untracked); no production/Core/Adapter/M4/Panel/procedure file touched |
| `LIVE_PATH_WIRED` | `false` (harness :116) |
| `G2_DUAL_COUNTER_GATE` | `{ resolved: true, owner: 'before-live-execution', finding: 'h1-single-node-allocator-implemented-awaiting-independent-confirmation' }` (:3458) — unchanged by the diff |
| Node allocator `createRunSeqAllocator` | not in the diff; pinned byte-for-byte by new s0 guard |
| `git diff --check` | clean |
| Focused G2 suite (`node --test test/acceptance/clashpanel-viewerbridge.acceptance.*.test.mjs`) | **731/731 PASS** (baseline 693) |
| Aggregate offline (`npm run test:offline`) | **4976 PASS / 0 FAIL / 1 TODO** (baseline 4938/0/1) |
| `npm run test:g2:binding` | **8/8 PASS** |

## Per-item verdict

### Medium 1 — eventLog finalized after the last transfer drain — **SATISFIED**

`g2FinalizeRunTransfer` (harness :11513) runs a bounded (8-round) stable-fence loop: high-water read, `await
sync.drain()`, compare. Only when the high-water did not move across the last awaited drain is the snapshot taken,
with no `await` below the loop: `eventLog` (recorder events, seq-sorted), `spyLedger`, `stateSnapshots`,
`pageFatalSent`, `pageHighWater` and `g.runResultHw` all in one synchronous tick. Non-stabilising → throws (fail
closed). `g2RunPhases` (:11453) uses `fin.*` for every ordinal-bearing field in both success and failure results;
the runner's pre-drain `run.eventLog` is no longer used.

Test coverage vs §2 list: event produced during final drain present once (final-transfer :275); pre-fix reproduction
on the exact c0f877a `g2RunPhases` loses it (:304); no duplicate merge (:322); Node-authoritative order
(`assertNodeOrderedEventLog`); finalization cannot precede the last drain + bounded non-stabilisation (:350); static
guard (vii) in sequencing-guards with mutation cases. `sync === null` is unreachable for a live failure transfer
(live runner requires sync; `g2EnterCleanupAfterFailure` rethrows on missing sync) — verified.

### Medium 2 — cleanup evidence retained after failed phase runs — **SATISFIED (with one Medium fidelity gap, F1)**

`g2RunPhases` catches the runner throw, `g2EnterCleanupAfterFailure` (:11539) performs the same cleanup entry as the
runner's `mark('cleanup')` (attribution, identity-bound `marker:cleanup` alloc, awaited attribution fence), then the
same `g2FinalizeRunTransfer`. Anything untransferable rethrows the ORIGINAL failure (:11478, :11539). Node
(`runPostReservation` :12820) applies the transfer through the unchanged rewrite / `applyPhaseRunToState` /
`runApplied` / `assertAllocated` path, then `applyPhaseRunFailureToState` (:12319) overwrites every check to
`BLOCKED(phase-run-threw)` with the redacted failure, every control to not-started, `gates=null`, `n6=null`, and taints
the session; page-sent verdicts are ignored. The cleanup drain and bidirectional provenance checks then run unchanged
(`runApplied` is true). No second, weaker transfer path exists (guard viii counts call sites).

Test coverage vs §3 list: throw before marker (final-transfer :414), throw after marker (:438), throw + cleanup-evidence
problem keeps both causes (:457; mainflow full-flow with three cleanup-evidence fault kinds), nothing-transferable
rethrows original (:473), forged PASS never PASS + non-vacuity mutation (mainflow, final-transfer :507). Verified
`applyPhaseRunToState` on a verdict-less failure transfer produces only fail-closed placeholders/empty extras that the
failure overwrite then replaces; nothing PASS-like survives.

### Medium 3 — exact operation-refusal detail persisted — **SATISFIED**

`runAcknowledgedMutation` (:6989) `blocked()` appends ONE `operation-begin-refused` event via `recorder.logEvent`
(never a spy record, never a violation) before throwing; detail from `operationRefusalDetail` (:6944): category
(`refused | begin-threw | malformed-response | empty-operation-id | binding-missing`), sourceRealm, reason, attempted
op (`operationType`, `modelId`, `operationPhase`, `invokedBy`), `operationId`, bounded JSON of a malformed answer,
`{name,message}` of a thrown begin, ISO `at`; recorder stamps seq/phase/activeCheck. All text redacted + truncated.
The recorder is now threaded into cleanup unloads (`guardedUnloadModel` :7029, `createModelCleanupSteps` :7050,
`g2CleanupStepImpls` :11572). The event is a page `event` ordinal, therefore mandatory page evidence
(`pageEvidenceProblems` :3678) — dropping it is detected. Verified no event-kind allowlist rejects it (closed-gate
rules :1798 only constrain seq window/attribution, and P9 refusals occur only under an open gate; cleanup refusals carry
cleanup/null attribution). Action blocking unchanged (guard iii updated to `throw blocked(...)`, still before any
spy record / `invoke()`). Explicit Node refusal: still exactly one `op-begin-refused:*` violation; the detail event is
separate evidence (op-refusal-detail :401, :409). Page-observed failures: no Node violation added (:419). Survives
`closeoutProtocol` into persisted R1 verbatim (:432). §4 list (refused / thrown / malformed / empty id / delayed /
binding missing / persisted after closeout) fully covered, plus non-vacuity mutation (:226).

### Medium 4 — static guards against a second authoritative sequence source — **SATISFIED (heuristic; bypass noted as F2)**

New `seq-source-guards.test.mjs`: s0 allocator byte-pinned + not rebound/redeclared; s1 every `nextSeq`/`seqOf`
receiver (any alias, any function form) must call or forward it, required-consumer set pinned and discovered set
must equal it; s2 no synthesized value (arithmetic, literal, `.length`, clock, `peek()`, template/composite, local
counter) written into `seq|ord|tick|*Seq|*Ord|*Tick` fields, with an exact, live, justified allowlist; s3 no
allocator-shaped closure under any name (count-limited allowlist: the Node allocator + `createCallRecorder` legacy
fallback); s4 seq-ordered sort comparators may only subtract/compare seq fields (+ `[1]` stable tie-break,
`modelId`). Mutation tests cover all four required patterns (ignored nextSeq :523, local increment :549, second
allocator helper :567, composite ordering :578) and a narrowness test (:591) keeps diagnostic counters legal.

## Regression checks (verified)

| Invariant | Status |
| --- | --- |
| Single Node allocator | unchanged; s0 pin; `assertAllocated` still after apply |
| Cleanup bidirectional provenance | `pageEvidenceProblems` untouched; failure path reaches it via the same `runApplied` gate |
| Cleanup phase/transfer-stage fix | unchanged; failure marker is a run-stage `marker:cleanup` alloc (final-transfer :434) |
| Op-refusal action blocking | unchanged ordering; guard iii updated and still mutation-checked |
| Node fatal ledger | no new violation kinds; refusal detail is not a violation |
| Item-24 pending-response finalization | not in diff |
| Authoritative K closeout | not in diff; closeout test exercises it with the refusal event |
| `LIVE_PATH_WIRED=false`, gate `resolved:true`, finding string | unchanged |

## Findings

### F1 — Medium — failure transfer drops the runner's earlier markers; a refused post-marker fence can shift the cleanup boundary

- Where: `g2RunPhases` failure result `markers: [failureMarker]` (harness :11481); `g2EnterCleanupAfterFailure`
  always allocates a new marker (:11539); Node appends only transferred markers (:12359–12361); provenance requires
  exactly one cleanup marker and rejects run-carried cleanup events below it (:3705–3722); cancellation windows end at
  the next marker (`cancellationWindowEnd` :2725).
- Failure scenarios (verified by reading):
  1. Any failed run: the phase markers P1..Pn allocated before the throw are not in `errorLedger.markers` of the
     failure artifact (they are local to `runChecksInPhaseOrder` and lost with the throw). The persisted timeline is
     coarser, and recomputed `cancellationWindow.toSeqExclusive` of operations in the failed run can extend to a later
     op/marker. All checks are already `BLOCKED(phase-run-threw)`, so no verdict changes — evidence fidelity only.
  2. The runner's own `mark('cleanup')` fence is refused (the only throw point after that marker, :9665) AND a
     cleanup-attributed page callback logs an event while that fence is in flight AND the failure path's second
     fence is accepted: the event's seq lies between the two `marker:cleanup` allocations, so it is
     `cleanup-event-before-boundary` → one extra cleanup-evidence fatal. Fail-closed (the run already holds the
     refused-fence violation and is FAIL); the original cause is not erased.
- Test gap: final-transfer :438 asserts two ingested `marker:cleanup` allocations but places no event between them.
- Verified: yes (Codex finding 1; re-derived from source). Severity: Codex rated Medium; reviewer agrees Medium for
  evidence fidelity, while noting it cannot produce a false PASS and does not violate the §3 "may add fatal detail
  but may not erase root cause" rule.
- Disposition: **fix recommended before live (not blocking this checkpoint)** — e.g. attach the runner's accumulated
  markers to the thrown error and transfer them; reuse an already-allocated cleanup marker instead of allocating a
  second one; add a test with an event between the two allocations. Owner/independent-gate decision whether to do this
  in a follow-up bounded pass.

### F2 — Low (Codex: Medium) — seq-source static guards are syntactically bypassable by indirection

- Where: s1 is satisfied by any single call/forward of the injected source (seq-source-guards :194–229); s2 inspects
  only direct ordering-field writes (:300–369); s4 skips call-valued comparator operands (:442).
- Scenario (verified by reading): a consumer calls `nextSeq()` once (s1 satisfied), keeps a local `n += 1`, copies
  it through `holder.value`, and writes `entry.seq = holder.value` (s2 sees a member copy; s3 sees no
  increment-and-return closure). Or `xs.sort((a, b) => cmpPhase(a, b) || a.seq - b.seq)` passes s4.
- Rationale for Low: the authorization asked for guards against the four named pattern classes with mutation proof;
  all four are covered and narrowness is tested. Token-level static guards are inherently heuristic; full data-flow
  analysis is out of scope. Runtime backstops remain (single allocator, `assertAllocated`, page-ordinal rewrite,
  `pageEvidenceProblems`, `primarySeqAllocations`).
- Disposition: **accepted limit / deferred**; optional future hardening: mutation cases for indirect counter flow and
  helper-based comparators.

### F3 — Low — failed phase run never yields a schema-valid committed R1 (pre-existing, known)

- The `phase-run-threw` state (no `gates.C1`, not-started control placeholders sharing seq 0) fails R1 verification;
  closeout takes `r1-verify` and leaves the invalidated diagnostic copy, which now carries the retained run + cleanup
  evidence and the exact failure (mainflow Medium 2 full-flow test). Unchanged from c0f877a.
- Disposition: **accepted limit** (pre-existing; evidence is in state + invalidated R1 copy; outcome FAIL).

### F4 — Low — page-observed op-begin failures add no Node fatal

- `begin-threw | malformed-response | empty-operation-id | binding-missing` produce the durable refusal event but no
  Node violation; the single authoritative failure is `BLOCKED(harness-exception:P9)` with session taint (or a
  failed cleanup step in cleanup). The run cannot PASS (verified op-refusal-detail :419).
- Disposition: **accepted limit** (as stated in the authorization: generic harness-exception summary + reconstructable
  detail; no duplicate violation).

### F5 — Low — s3 allowlist keeps the `createCallRecorder` legacy local counter

- The offline fallback (`seqCounter`) when no external source is injected is tolerated by allowlist (count 1).
  Live/page recorders are fed through the injected source (s1 + existing guard (a)).
- Disposition: **accepted / pre-existing**.

## Remaining Lows (carried, unchanged by this pass)

Per authorization §7, preserved: teardown C-e proxy; C15(e) FAIL routing; `T_iso` evidence authority; refused
`ops.end` unsettled record; thrown drain RPC missing exact error name; non-object merge entries counted as duplicates;
plus F2–F5 above. None was incidentally resolved.

## Conclusion

- **No Critical or High finding remains** in the four before-live hardening items or their directly affected
  evidence/sequencing paths.
- One Medium (F1, failure-artifact marker fidelity / possible extra fail-closed cleanup fatal) is dispositioned
  "fix recommended before live, not blocking this checkpoint"; Lows F2–F5 dispositioned as accepted limits.
- All four items meet their required outcomes and test lists; offline verification green (731 focused, 4976/0/1
  aggregate, 8/8 binding, `git diff --check` clean); `LIVE_PATH_WIRED=false`, `G2_DUAL_COUNTER_GATE.resolved=true`,
  no production/procedure changes.
- Ready for independent ChatGPT Work review of the before-live hardening, subject to owner decision on F1.
