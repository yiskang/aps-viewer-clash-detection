# Bounded independent re-review — G2 ViewerBridge / DockingPanel procedure v5

- **Date:** 2026-09-30
- **Repository state:** `main` @ `f139dda375d6aa466698207def745e94e2cc5abd`; `origin/main` equal; documentation-only uncommitted working tree; no G2 harness and no live G2 execution.
- **Scope:** v5's terminal-commit K model, pre/post-commit invariants, local-POSIX assumptions, reader/crash matrix, R1 freeze, N6/C4 correction and directly affected owner decisions only.
- **Sources:** v5 procedure; v5 remediation internal review and post-review dispositions; prior independent G2 reviews; current handoff; accepted Viewer Clash Panel design/implementation plan; actual `ViewerBridge`, marker and DockingPanel source; the host's Darwin `link(2)` manual.

## Verdict

**Not ready for owner acceptance or G2 harness-implementation authorization.** The single-record K design closes the v4 multi-file verdict contradiction: only exact-name K can authorize a verdict, candidates are non-authoritative, pre-K prefixes fail closed, and post-K failures cannot change the committed verdict. One High race remains at the boundary between the final pre-commit gate and K creation. The procedure does not require that boundary to be non-yielding and non-timeout-wrapped, so an asynchronous `link()` can complete after a timeout or after a verdict-bearing callback that the gate did not observe.

**Findings:** 0 Critical / 1 High / 0 Medium / 2 Low.

No production, Core, Viewer Adapter, M4, Panel, server, OQ-1 or host dependency appeared. The blocking correction is confined to the procedure and future test-only harness contract.

## High finding — blocking

### High-1 — the final verdict gate and K commit are not one non-yielding operation

- **Procedure:** §9.1 steps 1, 7 and 8; §4.2 closeout fault matrix; T8/per-step deadline language; terminal-commit invariant.
- **Failure mode:** step 7 re-evaluates the error ledger/timers/state, then step 8 says only `link(Kc,K)`. It does not require a synchronous `linkSync`-style syscall, forbid a timeout/`Promise.race`, or prove that no verdict-bearing callback can run between the gate and the actual filesystem link. With an asynchronous link, two concrete races remain:
  1. a page/runtime/Node fatal callback can be delivered after the gate but before the link settles, allowing K to commit the earlier PASS/PARTIAL/BLOCKED snapshot;
  2. a per-step timeout can classify the commit as failed and start the pre-B8 failure path while the underlying uncancelled link later succeeds, leaving authoritative K after the harness chose FAIL.
- **Why current wording is insufficient:** cleanup does finish before closeout and closes Viewer/page/context/browser resources, T9 is disarmed, and step 7 catches events already delivered. Those facts narrow the race but do not mechanically eliminate Node callbacks or late completion of an asynchronous filesystem operation. The statement that every pre-B8 uncertainty means “no `link()` is attempted” does not cover an already-started link whose wrapper timed out.
- **Classification:** procedure correctness blocker.
- **Minimum correction:** define steps 7→8 as one non-yielding critical section: fully drain and detach every verdict-bearing asynchronous source; evaluate the final gate; then call a same-directory, non-timeout-wrapped synchronous hard-link primitive immediately, with no `await`, promise scheduling, callback dispatch or deadline race between them. Alternatively, if an asynchronous primitive is retained, the harness must await its real settlement without timeout/cancellation and cannot enter the failure path while it is pending. Add offline/source-order tests proving no timeout wrapper and no event-loop yield between the gate and the commit syscall, plus a negative control where an async late-link implementation is rejected.

**Disposition:** the v5 K model is structurally correct, but D2 is not technically owner-ready until this boundary is specified and independently re-reviewed.

## Low findings

1. **The “11-row” truth table still contains a merged placeholder row.** Row 5 says it was merged into row 3 but remains numbered and populated. This is total and fail-closed, but it is not an actual eleven-case partition. Remove the placeholder or describe the table as numbered historical cases rather than eleven distinct rows.
2. **O1 wording remains inconsistent.** The R1 cutoff correctly says operator-captured O1 is external and never recorded in R1, while the optional-artifact paragraph says O1/O2 absence or write failure is recorded in `closeout.optional[]`. The harness cannot know O1's final status. State that only O2 is recorded by the harness and O1 is recorded later by the reviewer/report. This has no verdict effect.

The fixed R1–R3 filenames remain a fail-safe implementation-plan concern: overwriting an earlier run makes its K hashes fail rather than creating false PASS. They do not block procedure acceptance.

## 1. Authoritative verdict record K

**Closed except for High-1's commit execution boundary.** The reader recognizes only the exact `<Authorization-ID>.commit.json` name as K. Kc, temp and invalid files are explicitly ignored and can never authorize a verdict. R1/R2/R3, the journal and Kc are evidence/candidate material only. W-6 is the only path to a consumed-run verdict; it requires exact legal history, matching binding/attempt identifiers, valid schemas and recomputed R1/R2/R3/journal hashes.

The link destination is non-overwriting, so two successful K commits cannot coexist at the exact name. A correct harness never writes F or `FAILED` after successful K creation; if corruption creates K plus F/`FAILED`, W-1/W-2 deterministically return FAIL. There is therefore no reader PASS without valid K, no authoritative leftover candidate, and no unresolved conflict between durable verdict records.

## 2. Pre-commit fatal-event gate

**Partially closed.** Cleanup, model unload, Viewer/page/context/browser close and ownership verification precede closeout. Step 1 disarms T9 and snapshots the initial verdict; step 7 rechecks the current error ledger, timers, journal bytes and R1 snapshot immediately before commit. Evidence writes and verification all precede step 7.

The remaining gap is temporal: the procedure does not eliminate callback delivery or an async-link late completion after the step-7 check. High-1 is therefore the only blocking pre-commit issue.

## 3. Post-commit invariant

**Closed.** After successful K creation, cleanup is already complete and no required artifact write remains. Candidate unlink, directory fsync, K read-back and logging are explicitly informational and individually prevented from changing `finalOverall` or the exit code. K is never renamed, removed or rewritten. Stdout remains non-authoritative. Process shutdown is not a verdict-bearing step.

The post-link directory-fsync result can change the durability confidence label to `*-UNCONFIRMED`, but not the run verdict. That is consistent with the stated reader-authority model and fail-safe crash behavior, subject to D2 owner acceptance below.

## 4. Local-POSIX assumptions and D2

- **Technically valid bounded assumption:** on this host, the Darwin `link(2)` contract states that link creation is atomic, the destination must not already exist, success returns zero, and listed failure cases create no link. Kc and K are in the same attempts directory/filesystem. The procedure excludes network/FUSE filesystems, power-loss durability and filesystems that falsely acknowledge fsync.
- **Implementation proof required:** the harness must use the actual non-overwriting same-filesystem hard-link primitive, reject symlink/non-directory path components, never substitute copy/rename-overwrite, and preserve the verified Kc bytes. High-1 additionally requires non-yielding/settled commit execution.
- **Fail-safe OS-crash direction:** after link visibility but before directory fsync, K may survive or be lost. Survival yields K's verdict; loss yields `FAIL(commit-missing)`. The durable reservation/journal still spend the authorization, so no retry or false PASS is created.
- **Owner acceptance item:** accepting possible loss of an otherwise successful verdict in that narrow crash window is reasonable for exactly-one-attempt evidence because it can only downgrade evidence to FAIL, never manufacture PASS. A `*-UNCONFIRMED` run must still be checked by the authoritative reader before acceptance, as the procedure states.

The assumption set is explicit and bounded enough for owner consideration after High-1 is corrected. It is not a production, Core, Adapter or host dependency.

## 5. Reader totality and truth table

**Closed.** W-0 defines the exact namespace and rejects malformed, unknown, illegal, missing-field and impossible histories. W-1/W-2 make F/`FAILED` dominant. W-3/W-4 cover missing commit, preflight, crash and empty/no-run states. W-5 validates every K relationship. W-6 alone returns K's recorded verdict.

Candidate, orphan temp, invalid and stale non-authoritative files cannot produce PASS. K without journal/reservation or with mismatched identifiers/hashes returns FAIL. Unknown combinations fall through W-0 to FAIL. The Low row-numbering issue does not affect totality.

## 6. Crash-window walk

| Window | Result |
|---|---|
| Before reservation / during directory setup | Reusable only when no reservation survives and no external effect occurred. Never PASS. |
| Reservation through pre-consumption | Any surviving reservation/journal spends the record; reader non-PASS. No model load before durable `ATTEMPT_CONSUMED`. |
| After consumption through R1/R2/R3/Kc | Authorization consumed; no K means FAIL. Candidates/temps cannot authorize a verdict. |
| Final gate / commit | High-1 remains until late callbacks and asynchronous/timeout completion are mechanically excluded. |
| After successful K link | Process crash leaves visible K and its verdict; an OS crash before directory fsync may lose K and conservatively produce FAIL. Durable K remains authoritative. |

No reviewed crash window permits authorization reuse after live work. Apart from High-1, no window manufactures false PASS.

## 7. R1 payload freeze

**Closed.** S* is a canonical JSON-safe plain-data snapshot; typed arrays, Map, Set and Date are excluded. The cutoff occurs after `CLOSEOUT_STARTED` and O2 status but before closeout artifacts. The top-level whitelist, forbidden closeout keys, legal journal-state cutoff and `finishedAt` definition prevent future facts from entering R1. `snapshotSha256` plus two byte-equal `buildResultPayload(S*)` reserializations detect mutation before R3 and Kc. R1 bytes are serialized and hashed once and remain immutable. O1 needs only the Low wording correction above.

## 8. N6 / C4 consistency

**Closed.** N6's supported mutation domain is `|v| ≤ 2^897`; C4's finite range cutoff is the intentionally wider `|v| ≤ 2^900`. T24 contains both distinct bounds, and the consistency row cites T21/T24/T15 with the correct rejection classes. Searches found no stale N6-domain use of `2^900`; remaining `2^900` references are C4 cutoff or explicit boundary cases.

## 9. Internal-review fixes

- Commit namespace and leftover Kc/temp handling: closed.
- Post-commit verdict/exit-code immutability: closed.
- R1 canonical snapshot and no-run reader cases: closed.
- Late fatal prevention: improved but not closed because of High-1.
- Boundary names and N6/Table-T wording: closed, apart from the two Low editorial issues above.

## 10. Owner-decision readiness

| ID | Status after this review | Required disposition |
|---|---|---|
| D1 | **Owner decision remains** | Accept Mechanical + Structure as the bounded two-model fixture pair. No technical blocker found. |
| D2 | **Not yet owner-ready** | First correct High-1, then accept fail-first/K-authority semantics and the explicit local-POSIX/fail-safe-loss assumptions. |
| D3 | **Technical closure confirmed** | Zero Panel theming calls; no foreign-theming seeding. |
| D4 | **Owner decision remains** | Permit bounded C15 real-Viewer failure injection only after harness implementation review. |
| D5 | **Technical closure confirmed** | Selection and model-departure remain bridge-boundary checks. |
| D6 | **Deferred/non-blocking** | Exercise only the isolation guard; coexistence stays host/integration work. |
| D7 | **Ready for owner decision** | Accept C20's verdict role, PARTIAL fallback and disclosed PASS-granting CA constants/capture budget. |

## Authorization result

- **Procedure v5:** not ready for owner acceptance.
- **Required correction before harness implementation authorization:** High-1; fold in the two Low wording corrections in the same bounded documentation pass.
- **Owner decisions after correction:** D1, corrected D2, D4 and D7.
- **Current authorization:** none. Procedure remediation, harness implementation, live G2, G3, H1/H2, OQ-1, host integration, production changes, commit and push all require explicit owner authorization.

No harness or production code was created or modified; no live run, Playwright, Chromium or Viewer session occurred.
