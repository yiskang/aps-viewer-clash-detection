# G2 Failed-Run Evidence Closeout + Marker/Error Retention — Internal Review (2026-10-02)

Scope: only failed-run R1/R2/R3/K closeout, marker retention, exact error retention and the directly affected reader/F paths. Reviewer: Codex advisor (medium), read-only, plus targeted tests. Authority: owner prompt "G2 Failed-Run Evidence Closeout and Retention Correction Only".

## Result: 0 Critical / 0 High / 2 Medium (both fixed in-pass) / 2 Low (open)

Verified by the reviewer: a failed run cannot become PASS or PASS-eligible (row 3 `phase-run-failed`, row 8 requires `phaseRunFailure === null`, R1 schema forces overall FAIL, reader W-5 `failed-run-final-not-fail`); marker log, attribution/detail capture, cleanup-marker reuse and transport-branch marker reconstruction retain evidence; `failureSeq` and control placeholder seqs come from the single Node allocator and join the primary-seq uniqueness/leak check; non-failed R1/K paths and the K critical section are unchanged.

| # | Sev | Finding | Disposition |
|---|---|---|---|
| M1 | Medium | An unexpected `closeoutProtocol` abort (outer catch) wrote only a generic journal FAILED, so the root failure could be lost. | **Fixed:** the abort path now writes best-effort F carrying `phaseRunFailure` via `closeoutFailurePath`. Test: mainflow "FAILED-RUN CLOSEOUT (5b)". |
| M2 | Medium | Failed-run schema did not enforce the source/seqSource/cleanupEntry discriminated union nor the control placeholder reason. | **Fixed:** `phaseRunFailure.transport-combination`, `.page-combination`, `failed-run-control-reason-mismatch:<N>`. Tests in verdict file. |
| L1 | Low | Hashes give consistency, not authentication: a fully rewritten consistent artifact set with `phaseRunFailure:null` could claim PASS. | Open; same trusted-filesystem model as before this change. |
| L2 | Low | Procedure §10 requires the failed-run R1 to carry `gates:null` even for a run that failed after passing the C1 gate (gate record is lost with the thrown runner result; its `check-finalized` event survives in eventLog). Procedure-author Codex pass suggested splitting before-gate/after-gate cases. | Open design note for Work/owner; no PASS risk. |

Compatibility note: R1 gains an always-present top-level key `phaseRunFailure`; pre-change R1 files no longer validate (none exist as evidence).

## Root-cause model
`phaseRunFailure` is the durable root failure (Node-set, exact keys, `failureSeq` Node-authoritative). Cleanup/closeout failures only add reasons (cleanup-evidence fatals with seq > failureSeq; F `causes`); F also carries `phaseRunFailure`.
