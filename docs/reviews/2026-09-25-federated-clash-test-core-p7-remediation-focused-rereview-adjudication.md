# Federated Clash Test core — P7 remediation focused re-review: targeted adjudication

**Date:** 2026-09-25
**Repository / branch:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection` @ `feature/federated-clash-test-core-engine`
**Adjudicated review:** [`2026-09-25-federated-clash-test-core-p7-remediation-focused-rereview.md`](2026-09-25-federated-clash-test-core-p7-remediation-focused-rereview.md) (PASS, 0 Critical / 0 High / 0 Medium / 1 Low)
**Adjudicated boundary:** `c598ad3..62395b2`; HEAD at adjudication = `62395b2`
**Method:** three independent read-only subagents (one per claim group, with revert probes on a scratch `git archive` copy) plus one targeted `codex-advisor` pass. Per `CLAUDE.md`: no production, spec, plan or test file was modified; no unrestricted review was run.

## Result

**Work and adjudication AGREE on the boundary, all six remediations, the one Low, and the verification numbers. They DISAGREED on the gate verdict (resolved by owner ruling #8, below): Codex found one further concrete defect in the M3 (A17) freshness path and recommends that the PASS not stand as written.** Per `CLAUDE.md` the disagreement was persisted here and the handoff was set to awaiting owner decision. P7 is not accepted; P8 must not begin.

## Verified (agreement)

| Claim | Result | Evidence |
| --- | --- | --- |
| Boundary / working tree | **Agree** | `git diff --name-only c598ad3..62395b2` = 25 files, all accounted for in the prior adjudication's change lists or the commit's own review records; HEAD `62395b2`; only the handoff and the re-review doc were uncommitted at start. |
| Full-suite count | **Agree** | Re-run on `62395b2`: `npm test` → 2,587 total / 2,586 pass / 0 fail / 0 cancelled / 1 todo (exit 0). |
| Focused counts | **Agree** | Subagents re-ran the touched test files: 5/5 (`recordRef`), 12/12 (`libraryExclusions` 8 + `sizePredicate` 4), 31/31 (`readAbort`, `discardFinalizing`, `readCoordinator.abort`). All pass. |
| H1 `recordRef` | **Resolved** | `resultSetSchema.js:63` `recordRef: 512`, `:153` `Acceptance.recordRef`, enforced `:356`; engine cap `engine.js:118-127` unchanged. Revert probes (restore `str('id')`; remove the cap entry) each fail the round-trip / 513-reject / cap-constant tests. |
| M1 `libraryExclusions` | **Resolved** | One ledger record per seal (`run/Run.js:477`, `:491-492`); `provenanceOf` copies its exclusions (`:1072-1075`); R10 fallback passes the fallback ledger (`:1273`, `:1289`). Revert probes (drop the field; use the live ledger on R10; drop the array copy) fail tests 1/2/3/5, 6 and 8 respectively. |
| M2 size predicate (A16) | **Resolved** | `checkById` hook only on by-id `rerun` (`engine.js:1081-1089`, `:1303-1321`), against the rerun's resolved options (`:1242-1279`), before `admitAndBegin`. Four revert probes fail tests 2/4, 3, 4, 1/3. |
| M3 read cancellation (A17), coordinator and engine surface | **Resolved for the tested paths** | Aborted queued waiter is spliced out with FIFO intact; granted slot released only by its holder; closed `{signal?}` shape; abort checked before slot/capture/store; slot held through non-abortable store calls; abort before rerun admission starts no run. Codex found no waiter/grant or store-get ordering hole. |
| L1 deferred `discardRun` | **Resolved** | One shared deferred discard after `done`; `disposed` is set synchronously so dispose wins before the deferred discard starts; nothing awaited synchronously for listeners. Codex found no ordering hole. |
| L2 traceability | **Resolved** | A16/A17 rows, §13.5.2/§18/AC-13 annotations, P7 plan items, interface-reconciliation S-P7-6 and the cap/root-count wording are consistent; cited test files exist. |
| Existing Low (cross-realm `AbortSignal`) | **Agree; not a correctness failure** | `engine.js:183` (`instanceof AbortSignal`) used at `:214` **and also at `:1227` (`readRerunOptions`)** — the review's citation omitted the second site; effect identical; fails safe with `InvalidOptionsError`, no work started. Does not reopen M3. Not fixed. |

### Citation imprecisions (do not change any verdict)

- M1: `resultParts`/`provenanceOf` are in `clashtest/run/Run.js`, not `engine.js` (engine holds only the `libraryExclusions: []` placeholder in `provenanceBase`, always overwritten).
- H1/M2: the review's evidence names `residency.js`; it contains no `recordRef` or A16 code (its diff is only the M3 `acquire({signal})` change).

## Disagreement — new finding N1 (Codex; code path independently noted by the M3 subagent)

**N1 — an aborted freshness read can reject with a non-`ReadAbortedError`.**
`clashtest/engine.js:1147-1151` (`liveFreshness`) maps an error to `ReadAbortedError` only when `signal.aborted && err?.name === 'EnumerationCancelledError'`; every other error is rethrown even though the signal is aborted. A17 (spec row A17, §13.5.2) states "an abort during the freshness pass rejects `ReadAbortedError`, never a resolved `unverifiable`".

- **What holds:** the safety half of the invariant. The read still **rejects**; it never resolves `{state:'unverifiable'}`; the read slot is released (Codex observed this).
- **What does not:** the error identity. Codex's scenario: `enumerator.digestScope()` aborts the signal and returns a malformed observation whose `kind` accessor throws. The access happens in `compareScopeExpectation` (`planning/scopeDigest.js:228-231`), outside the enumerator-error catch, so the read rejects `Error('malformed-observation')` with `signal.aborted === true`. Codex reports reproducing this read-only; **this adjudication did not independently re-run that reproduction**, but the M3 subagent independently read the same branch of `liveFreshness` and recorded it as a "nuance".
- **Scope of exposure:** requires a hostile/faulty enumerator result (accessor-bearing or otherwise throwing) coinciding with an abort. Same-realm cooperative and non-cooperative enumerators, and abort with no simultaneous freshness error, are covered by `readAbort.test.mjs` (which asserts rejection, not the error class, for the non-cooperative case).
- **Preferred minimal correction (not applied):** in `liveFreshness`'s catch, `if (signal.aborted) throw new ReadAbortedError()` before rethrow, plus one regression test where `digestScope` aborts and returns an observation with a throwing accessor. Narrower alternative: harden `compareScopeExpectation` against throwing property access (does not cover other errors coinciding with an abort).

### Classification (adjudicator's recommendation, for owner decision)

`CLAUDE.md` classes: this is an **implementation-level conformance gap against A17's error-identity wording**, not a design/spec correctness blocker. The adjudicator recommends **Low** (same family as the existing cross-realm Low: an edge-case compatibility/precedence gap on a path that fails safe), so that the Work verdict would stand as **PASS with 0 C / 0 H / 0 M / 2 Low**. Codex recommends the PASS not be accepted until the two-line fix lands. Because that is a difference on a gate verdict, this document does not resolve it.

## Owner decision required (RESOLVED by owner ruling #8 — see the final section)

1. **N1 severity/disposition:**
   - (a) Accept as Low; defer with the cross-realm Low; P7 acceptance may proceed on the existing PASS; **or**
   - (b) Authorize the minimal N1 fix (above) as a bounded remediation before P7 acceptance, then targeted re-verification of `liveFreshness` and the new test only.
2. **Cross-realm Low:** confirm supported/unsupported (unchanged from the review; both `engine.js:214` and `:1227` are affected).
3. **P7 acceptance** remains a separate owner decision.


## Owner ruling #8 (2026-09-25) and remediation — committed as one checkpoint over `62395b2`

**Rulings.** (1) N1: fix now — with the signal aborted when the caught freshness error is observed, the public read rejects `ReadAbortedError` regardless of the underlying error type; unchanged behaviour when not aborted; add a regression test. (2) Cross-realm `AbortSignal` is **supported; fix now** — replace the same-realm `instanceof` check with a narrow, fail-closed, AbortSignal-compatible check at both sites, with five listed tests. (3) P7 is not accepted; only targeted verification plus the affected P7 read/integration suites; update this record and the handoff; do not start P8, run an unrestricted review or commit.

**Change (one production file, `clashtest/engine.js`, +22/−3; no spec, plan, schema, limit, error-code or P5 change):**

- `isAbortSignal` (formerly `instanceof AbortSignal`) now accepts a non-null `object` whose `aborted` is a boolean and whose `addEventListener` and `removeEventListener` are functions — exactly the surface `engine.js` and the P5 read coordinator use. It is wrapped in `try/catch` so a throwing getter or Proxy trap is "not a signal" (fail-closed → `InvalidOptionsError /signal bad-shape`); no member is invoked. It is the single predicate behind BOTH sites: `readReadOptions` (`engine.js:230`, all six reads) and `readRerunOptions` (`engine.js:1247`, formerly `:1227`).
- `liveFreshness`'s catch is now `if (signal.aborted) throw new ReadAbortedError(); throw err;`. With no abort the original error is rethrown unchanged; the unsignalled path is untouched.
- Deliberately not changed: the P5 coordinator's abort path still relies on the `{once: true}` listener option for listener cleanup (standard `AbortSignal` semantics); the spec A17 wording ("non-`AbortSignal` value ⇒ `InvalidOptionsError`") stays accurate for "AbortSignal-compatible".

**Tests (new file `test/clashtest/engine/readAbort.ownerRuling8.test.mjs`, 11 tests).** Written first and observed RED (7 failing) before the fix. The cross-realm signal is a real foreign-realm object built in a `node:vm` context (asserted `instanceof AbortSignal === false` and `instanceof Object === false`), honouring `{once}` and counting leaked listeners.

| Ruling item | Test |
| --- | --- |
| N1 non-`EnumerationCancelledError` failure racing with abort (getFreshness / canClaimNoClashes / assessNoClashClaim × resident / stored / raw) | 1 |
| N1 different error type | 2 |
| N1 original error preserved when not aborted (signalled and unsignalled) | 3 |
| same-realm signal, both sites | 4 |
| cross-realm-compatible signal accepted at both sites (all six reads + `rerun` resident and stored), no leaked listener | 5 |
| already-aborted cross-realm signal (all reads, `rerun`, raw): rejects before slot/capture/store | 6 |
| queued read cancellation with a cross-realm signal: waiter leaves the FIFO, listener released, FIFO of the rest kept, slot/queue depth restored | 7 |
| abort during a pending `store.get`: slot held until it settles, then rejects | 8 |
| malformed signal-like values rejected fail-closed at both sites (12 shapes incl. throwing getter/Proxy; no member invoked) | 9, 10 |
| no unhandled rejection | 11 |

**Verification (on the tree over `62395b2` before the commit).**

- New file: **11/11**.
- Affected P7 read/integration suites (`test/clashtest/{engine,integration,results,run}/*.test.mjs`): **671/671 pass, 0 fail**.
- Full `npm test` (run for the record, not a new review): **2,598 total / 2,597 pass / 0 fail / 1 todo** (= 2,587 + 11; the todo is the pre-existing `ContainmentQuery.classifyPoint` extreme-aspect-ratio gap).

**Status.** N1 and the cross-realm Low are remediated in the ruling-#8 checkpoint commit. The disputed PASS is therefore addressed by the ruled fix rather than by re-classification. P7 remains **NOT ACCEPTED**. Not done / not authorized: push; P8; unrestricted review; any further change. **Next: the owner sends this checkpoint for a focused independent Work re-review** (scope: `62395b2` → the new checkpoint — `clashtest/engine.js` `isAbortSignal` and `liveFreshness`, and `readAbort.ownerRuling8.test.mjs`).
