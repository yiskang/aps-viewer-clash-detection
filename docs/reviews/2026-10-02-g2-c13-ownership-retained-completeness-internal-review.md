# G2 C13 P8 ownership + retained-snapshot completeness — focused internal review

**Date:** 2026-10-02 · **Base:** `main` @ `c0f877aee82c078564efdb504bcbe695522b4ed4` (uncommitted) · **Provisional procedure SHA-256:** `d1ccfde224b8ae76fe74b06c93abc532e6df9612933cafaa045053c8e2e45a75` (supersedes stale `59c27e18…`; interim `b22267e5…` also stale)

Scope: the two findings of the node-authoritative partial-transfer independent re-review (High C13 ownership; Medium retained-snapshot completeness). Reviewer: opus subagent, read-only.

## Changes
- **C13 P8-owned everywhere:** `CHECK_OWNING_PHASES.C13=['P8']`; `PHASE_ORDER` P7 no longer lists C13, P8 = `[C14,C15,C13]`; `DEFERRED_UNITS` hack and its use in `phaseUnits` removed (runtime unit order unchanged); procedure §5 phase chain and §9.2 rule (v) say P8; stale driver/test comments updated. Execution phase unchanged (P8).
- **Retained completeness:** the authority records `retainedThroughOrd` on an accepted retain; `pageEvidenceProblems(state,{throughOrdinal})` is the SAME validator with the ingested side limited to ordinals ≤ that bound (malformed scope ⇒ `page-evidence-scope-invalid`). The transport fallback runs it right after admitting retained state (post-c1 only); a problem adds one fatal `retained-evidence:<label>(+n)`; root failure and validated history stay; PASS impossible. Transferred path still calls it unscoped.
- Tests: `…c13-ownership.test.mjs` (8), `…retained-completeness.test.mjs` (13), both with source-mutation non-vacuity tests (temp copies cleaned); sequencing-guards static guard and pin sites updated.

## Findings: 0 Critical / 0 High / 1 Medium (fixed) / 3 Low
- **Medium (fixed in wording):** procedure clause claimed "no unsourced … record", but the validator sources only unsourced `spyLedger`/`stateSnapshots` entries and cleanup events; a fabricated non-cleanup `eventLog` entry is not caught (pre-existing limit, same on the transferred path). The clause now states exactly what is checked and the limit.
- **Low:** collision-type tampering of retained evidence makes closeout `r1-verify` refuse (no K, journal FAILED, F keeps root failure, reader FAIL) — fail-closed and identical to the transferred path, but F records only the `r1-verify` cause, not the `retained-evidence:*` diagnostic.
- **Low:** no test pins the lower bound of the scope (e.g. `throughOrdinal = B+1`); covered indirectly by the end-to-end `ran:C1` omission test.
- **Low (subagent, inherited):** `pageEvidenceProblems` does not compare a record's attribution to its source ordinal outside cleanup, so swapping seqs of two same-kind records is not caught on either path.

Confirmed: C13 accepted in P8 and rejected elsewhere by the real `syncPage` (`sync-activeCheck-phase-inconsistent`); no other check's phase changed (whole-map snapshot test); dependency gating/taint unchanged; no regressions to H1, cleanup provenance, retention, partial transfer.

## Verification (non-live, re-run by controller)
Focused 818/818; aggregate 5,064 total / 5,063 PASS / 0 FAIL / 1 TODO; binding 8/8; `git diff --check` clean.
