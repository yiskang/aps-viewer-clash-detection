# G2 completed-phase result retention — focused internal review

**Date:** 2026-10-02 · **Base:** `main` @ `c0f877aee82c078564efdb504bcbe695522b4ed4` (uncommitted) · **Provisional procedure SHA-256:** `7f68188940da7e9786acaab6802d82fd455f527bc684e8bfaf2676096df06d4c` (supersedes stale `01ab3587…`, `caa9e057…`)

Scope: runner ordering in `runChecksInPhaseOrder`/`runPhase`, procedure "Completed-result retention" paragraph, `…acceptance.result-retention.test.mjs`. Reviewer: opus subagent (read-only).

## Change
Driver results are validated/merged into runner-owned `units/controls/extras` (terminal ordinals allocated) **before** the final attribution-clear fence; the fence follows, before any later phase. Driver-throw path unchanged.

## Findings: 0 Critical / 0 High / 1 Medium / 3 Low
- **Medium (dispositioned: procedure narrowed, limitation recorded):** retention is guaranteed in the runner-owned `partialSink`. If Node's refusal of the clear fence also makes the page's cleanup-entry fence refuse (`ingest-attribution`/`ingest-hw-mismatch`), Node records a `node-observed` failure with no partial history (the M2 final-transfer case). Closing this needs live-transfer/binding changes — outside this bounded authorization. Procedure wording now states the limitation.
- **Low:** a validate/merge throw mid-loop loses later units and leaves `phaseLog` `ran:true,error:null` (pre-existing behavior).
- **Low:** fence throw skips `got.tainted`/`assertPhaseBaseline`, so `partial.sessionTainted` omits that phase's taint (pre-existing; PASS still impossible).
- **Low:** control terminal ordinals now carry the driver's last attribution, not the cleared one (ingestion valid; history rules unaffected).

Confirmed: catch path unchanged; dependency gating, `failureSeq` after retained terminals, and PASS path intact; 13 new tests incl. mutation tests that fail if the fence is moved back.

## Verification (non-live)
Focused 786/786; aggregate 5,032 total / 5,031 PASS / 0 FAIL / 1 TODO; binding 8/8; `git diff --check` clean.
