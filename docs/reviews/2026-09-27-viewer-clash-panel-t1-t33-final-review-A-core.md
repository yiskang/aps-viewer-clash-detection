# Final whole-branch review — Area A (headless Panel core, T1–T21)

Range a0134bb..5d02623 (HEAD). Scope read: every `clashpanel/core/*.js`, the controller/results/setupRun/navigation/realEngineContract tests and support harness (targeted), ledger `progress.md` T1–T21 minors. Read-only; one scratch probe outside the repo (below). No codex consult was needed: the single MUST-FIX was reproduced directly.

## Counts (new cross-task findings)
Critical 0 · High 0 · Medium 2 · Low 5 · Info 1. **MUST-FIX: 1** (A-1). Everything else is RECORD. The ledger triage (T1–T21) is below; none of those items is MUST-FIX.

## New findings

### A-1 (Medium, MUST-FIX): a stuck release of the Panel's own set can block Run permanently, and the wording blames "other runs"
- `clashpanel/core/controller.js:296`: `mapAdmissionError(error, { heldRunId: c.residency.current()?.runId ?? null })` only looks at the displayed set.
- `clashpanel/core/residency.js:122-126`: after a failed release, `held` is set to null and the entry moves to the private `stuck` list. That list is retried only by `release()` or `disposeAll()`, and `startRun` does not call `release()` before admission on the ordinary path (`controller.js:304`).
- **Scenario (reproduced with `makeHarness({capacity:1})`, scratch probe, test passed):**
  1. Run to done (saved, so leased).
  2. `failNextLeaseRelease`, then Clear results. The set is now stuck and still resident; the release-error banner shows.
  3. Press Run. The engine throws `ResultCapacityError` because the stuck set holds the slot. `heldRunId` is null, so the banner reads "…held by other runs. Try again after they are released." and has no release-and-retry action.
  4. Every later Run fails the same way (startCalls grows, `run-1` stays resident). Clear results is a no-op (nothing is displayed).
  5. Only New test (which also resets the draft) or dispose runs `retryStuck`.
- **Why it matters:** spec §7.6 says: "If `ResultCapacityError` is caused by the Panel's own previous set, the error offers 'Release previous results and retry'". It also says failures are "never allowed to strand". The flow reaches a dead end that misreports whose set is blocking. The default `maxResidentResultSets` of 4 makes it rarer, but it does not remove it.
- **Fix (small, additive):**
  - Have residency expose the runIds of its stuck entries, for example `heldRunIds()` = `current` plus `stuck`.
  - Offer `release-and-retry` when any blocker is one of the Panel's own runIds.
  - `onReleaseAndRetry` needs no change: it already goes through `retireDisplayed`, then `release()`, then `retryStuck()`, then `startRun`.
  - Add one controller test with `capacity:1` and one stuck lease.

### A-6 (Medium, RECORD): dispose never reports an unsaved drop
- `controller.js:498-503`: the plan's shape resolves `{released, errors}`. `c.disposeReport` (which holds `droppedUnsaved`) is computed and then never exposed.
- Spec §7.6 says dispose "passes [acknowledgeUnsaved] and reports the drop in the dispose notice".
- The shape is plan-mandated and there is no UI left after dispose. Record it as a spec→plan gap. Additive fix: include `droppedUnsaved` in the resolved object and document it in `clashpanel/README.md`.
- Related ledger nit: `residency.js:127/146` sets `droppedUnsaved:true` even when the release went to stuck. That is moot until the value is surfaced.

### A-2 (Low, RECORD): a result index that fails to build leaves a permanent "checking freshness"
- When `buildResultIndex` throws, `p.index` is null.
- `recheckFreshness` returns early (`controller.js:587`), so `freshness` stays null and `freshnessPending` stays false.
- `badgesOf` (`viewModel.js:163`) then calls `describeAxes(outcome, null)`. The result is the badge "Freshness: … (at seal) — checking freshness…" plus statusLive "Checking freshness", both forever.
- This needs malformed Core data only. The results region correctly shows `INDEX_FAILED_TEXT`.

### A-3 (Low, RECORD): the "has location" filter and the "no location" badge can disagree
- The filter (`filters.js:60`) excludes only `flags.witnessUnavailable`.
- `locationOf` (`rows.js:33-44`) also returns null for absent or malformed evidence.
- A malformed record can therefore pass the filter while showing the "no location" badge. Real Core always emits evidence.

### A-4 (Low, RECORD): `onModelLeft` swaps the search index during a filter pass
- `onModelLeft` calls `labels.reset()` (`controller.js:1024`), which empties the search index. A text-filter pass already in flight then reads names from two indexes (some chunks with the names, some without) and can commit.
- It corrects itself when `ensureLabelIndex` rebuilds and calls `refreshList`.

### A-5 (Low, RECORD): the discard confirmation survives later setup edits
- `applySetup` clears `admission` but not `confirm` (`controller.js:200-206`).
- Sequence: Run shows "discard and run?", the user edits the setup, then confirms. The run starts with the edited draft (`controller.js:442`).
- It is still an explicit discard and the draft is valid (`canRunNow`), so this is UX only. Clearing `confirm` in `applySetup` is a one-line fix.

### A-7 (Info, RECORD residual)
- A held claim is withdrawn only on the spec §7.3 triggers: done, catalog change, model left, Panel shown.
- A placement invalidation that the host signals to Core without a catalog event is not observed until the next trigger.
- This follows the accepted spec (host duty, §5.1). List it with the G2/H residuals rather than change it.

## Priority checks — results

1. **No-clash claim gate: verified OK.**
   - The only producer of claim wording is `emptyStatement` (`runReport.js:136`). Its only caller is `buildResultsRegion` (`viewModel.js:373`), and only for `l.total === 0`, behind `claimGateOf`: both halves settled and non-null, then `claim.allowed === true`, then `freshnessState === 'current'`.
   - Headline (`Completed — 0 clashes`), banners, statusLive, details and diagnostics never contain `STATEMENTS.CLAIM` or `QUALIFIED_CLAIM`. `EMPTY_FILTERED_TEXT` is used only when total > 0.
   - The controller commits the pair atomically (`land()`, `controller.js:622-627`). `recheckFreshness` withdraws the claim synchronously (`:590-595`, the 054ece9 fix).
   - Invalidation paths confirmed:
     - catalog change: `:261`
     - model left: `:1032`
     - `PANEL_SHOWN`: `:827`
     - new run / Clear / New test: `retireDisplayed`, where `pipe=null` and the generation is bumped, so the check is aborted through `readAbort`
     - dispose: `c.disposed` fails `current()`
     - an admission failure correctly keeps the previous claim (AC-P14)
   - Failed or aborted reads fail closed (`UNVERIFIABLE_FRESHNESS`, `NO_CLAIM`, or stuck at pending).
   - T11 safety-adjacent minors: see the triage. None is MUST-FIX because every one needs a Core value outside its published contract.
2. **Generation guard: verified OK.**
   - Guards per completion:
     - done, persisted, core events, poll: gen + handle
     - summarize, mask, groupBy, freshness, claim: `current(c,g)`, which includes `pipe.gen`
     - filter passes: epoch + `current`
     - label warm: `warmSeq` + `current`
     - Soft verdict: `setupGen`
     - Viewer outcomes: `viewerSeq` + gen
   - The queue is single-flight, cached per (generation, key), and swept on bump.
   - A superseded active run can only arise through dispose, because `canRun` requires idle/done and Clear / New test are refused while active. Its late `done` only calls `releaseSuperseded`.
   - Unhandled-rejection exposure is limited to builder or subscriber bugs: `startSoftEvaluation` `:184` and `void clearViewer` `:318` have no `.catch` (RECORD, ledger T16).
3. **OD-7(a) and residency: verified OK, apart from A-1.**
   - The ordinary path is admission first (`:291` then `:304`). The consented-discard exception releases before `startRun` only when `acknowledgeUnsaved === true` (`:289`), which comes from `RESULTS_CLEAR_CONFIRMED`('run') or `RUN_RELEASE_AND_RETRY`.
   - The `needsAcknowledgement` branch is unreachable by construction: `heldUnsaved` and `release` read the same state in the same tick.
   - The held-in-memory notice is de-duplicated against the report banner (`viewModel.js:192-194`).
   - Covered against the real engine by T20 tests `:202`, `:217`, `:237` and `:253`.
4. **Registration boundary / AC-P4: verified OK.**
   - `narrowEnginePort` (`ports.js:33-46`) exposes exactly the constraint-5 set.
   - A grep of all of `clashpanel/` for getPairStatus, getElementStatus, register, unregister, invalidateModelPlacement, wireModelUnload, keyOf, theming, `viewer.impl`, `Private.`, isOTG and elementCount finds comments only.
   - `clashpanel/index.js:44` hands the engine only to `createPanelController`.
   - The fake engine records forbidden access, and the controller tests assert it stays empty.
5. **Sealed browsing / no ETA / bounded UI / Soft fail-closed / format neutrality / layering: verified OK.**
   - No list while non-terminal (`viewModel.js:360`). Progress shows fractions, counts and the Panel's own elapsed time only.
   - `pageRows` materializes one page. Ordered indexes and filter output are typed arrays. The predicate and label passes are sliced.
   - Soft: a pending verdict counts as unavailable (`controller.js:167`). Every failure path in `readBasisVerdict` resolves unverified. Hard is never gated.
   - Layering: core imports are `./*.js` only, and there are no Autodesk, window, document or THREE tokens.
   - `GAP_UNIT_LABEL` is the single constant, and constants are not exported from the barrel.
6. **Test quality.**
   - No REQUIRED behaviour is left unverified overall.
   - AC-P2 wiring: `viewModel.test` computes the expected value from the fixture's own status and coverage, so a wiring bug would still fail. Literals are pinned in `runReport.test`, `realEngineContract:143` and the DOM suites.
   - A superseded late `done` is covered through dispose only (`setupRun:393`, real engine `:253`). That is the only reachable supersession.
   - Gap: A-1 has no test. The existing stuck test (`setupRun:262`) uses unlimited capacity, which hides the problem.

## Ledger triage (T1–T21 deferred minors)

| Task | Item | Disposition |
|---|---|---|
| T1 | layering.mjs regex evasions (`import (`, `} import`, string-unaware comment strip, over-broad window/document, vendor dir skip) | RECORD (guard hardening; current code clean by independent grep) |
| T2 | settleWithTimeout: a throwing injected clearTimeout ⇒ verdict hangs (fails closed: Soft stays pending) | RECORD |
| T2 | unbounded host `reason` | RECORD (UI wrapping is Area C) |
| T2 | weak late-answer assertion | RECORD |
| T3 | fitToViewAggregate C-4 order untested (fake) | RECORD |
| T4 | freezeSide O(n) recopy; weak self-clash deep-copy assertion; `void revision`; testNumber unvalidated | RECORD |
| T5 | binding-stale wording in registry-ahead direction; shared model reported once (Set A) | RECORD |
| T6 | unreachable defensive fallback | DROP |
| T7 | clearTimeout unguarded in supersede | DROP (implausible) |
| T7 | consumers must apply their own generation guard | DROP (verified done) |
| T7 | `stats().cached` name; missing dup-join / abort-throw tests | RECORD |
| T8 | no runId cross-check in runMachine; `admitted` resets unconditionally | DROP (gen+handle guard and `canRunNow` gate verified; only dispose supersedes) |
| T8 | cosmetic let→const; unknown-status tests | RECORD |
| T9 | onPersisted saved-but-retain-refused ⇒ notice null vs adopt ⇒ HELD notice | RECORD (the set is `saved` there, so no banner is also defensible) |
| T9 | `droppedUnsaved` true on a stuck release | RECORD (see A-6) |
| T9 | no stuck dedup in releaseSuperseded (dispose calls it twice) | DROP (a duplicate entry is harmless; the non-resident retry is a no-op success) |
| T10 | null results entry TypeError | DROP (caught ⇒ INDEX_FAILED; see A-2) |
| T10 | first-wins duplicate untested | RECORD |
| T11 | qualified branch does not require `unqualified===false` | RECORD. Qualified wording still needs `allowed===true`, which is Core's authoritative bit. |
| T11 | describeAxes badge accepts unvalidated state | RECORD. See the recommended hardening below this table. |
| T11 | malformed live read ⇒ at-seal `current` ⇒ no stale banner | RECORD. The claim is withheld; only the banner fails open. |
| T11 | bare-string freshness accepted | RECORD. Concrete effect traced: a bare `'current'` from `getFreshness` gives the CLAIM plus a badge and statusLive saying "checking freshness…" (describeAxes reads only `.state`). Needs a non-contract Core value. |
| T11 | `list()` vs `?? []` nuance; differential test does not assert both verdicts occur | RECORD |
| T12 | bare `#` needle is an active near-no-op filter | RECORD |
| T12 | supersession / yield test gaps | RECORD |
| T13 | weak assertions; priority=3 magic; table identity churn; out-of-range mask TypeError; `undefined` label sort | RECORD |
| T13 | caller must re-check generation | DROP (verified `current(c,g)`) |
| T14 | navScope resultId-only | DROP (controller always scopes to the occurrence's own group, `:971`) |
| T14 | memberOrders for collapsed groups (PG-3) | RECORD |
| T14 | `matching` must not be mutated | DROP (never mutated) |
| T14 | clampPage pageSize≤0 | DROP (constant) |
| T14 | grouped+gap-asc / non-finite sort tests | RECORD |
| T15 | unloaded note uses a non-disambiguated name (`resolve.js:59`) | RECORD |
| T15 | forgetModel/warmSeq | DROP (controller uses `reset()`) |
| T15 | invalidateNames on catalog change and new run | DROP (verified `:259`, `:325`, `:399`) |
| T15 | warm() rejection | DROP (`.catch` present) |
| T15 | long-name wrapping | Area C |
| T15 | warm-vs-warm test | RECORD |
| T16 | retired run's late `persisted` | DROP (now tested, `results:472`) |
| T16 | adoptHandle `.catch` swallows onRunDone/onPersisted throws; `:184`/`:113` chains without `.catch`; retireDisplayed ignores needsAcknowledgement (unreachable) | RECORD |
| T16 | dispose does not bump setupGen | DROP (`c.disposed` guards the commit) |
| T16 | support barrel | RECORD |
| T17 | 7 tail `.catch(()=>{})` losing fail-loud behaviour | RECORD (suggest a counted internal-error sink) |
| T17 | ReadAbortedError swallowed without own abort ⇒ stuck "checking" (fails closed) | RECORD |
| T17 | AC-P4 runtime re-confirms narrowing; PANEL_SHOWN H1 test | DROP (added in fix round) |
| T18 | stale navScope label after grouping→none | RECORD |
| T18 | label index rebuilt on every model-left (PG-3) | RECORD |
| T18 | vacuous fireModelLeft ingredient | RECORD |
| T18 | dead abort/detach lines at `controller.js:608-609` | RECORD (harmless now that recheck supersedes synchronously) |
| T19 | self-referential AC-P2 matrix / statusLive expected | RECORD (not tautological for wiring; see priority 6) |
| T20 | AC-P9 tautological compare; doneKind membership only; test-12 title overclaims; CLAIM pinned by reference; `spied()` hands the full registry; no try/finally dispose; no real-engine superseded late done | RECORD |
| T21 | test 6 title overclaims; loose upper bound; no mutation controls | RECORD |

**Recommended hardening (optional, one place, fixes four T11 items):** normalize at the controller commit.
- `controller.js:640`: accept the freshness only when `typeof value === 'object' && ['current','stale','unverifiable'].includes(value.state) && Array.isArray(value.reasons)`; otherwise use `UNVERIFIABLE_FRESHNESS`.
- `controller.js:644`: accept the claim only when `typeof value.allowed === 'boolean'`; otherwise use `NO_CLAIM`.

The badge, banner and gate would then always see the same validated value.

## Verified OK (invariants actually checked)
- Claim wording has a single producer, and every trigger withdraws it synchronously.
- Freshness and claim commit atomically as a pair; failed or aborted reads fail closed.
- Every async completion checks its generation.
- The derivation queue is single-flight and cached per (generation, key).
- Admission comes first, and the consented-discard exception is scoped to explicit consent.
- Dispose cancels the run, waits for done, releases the set, retries stuck entries, disposes the bridge, and never rejects.
- Engine port narrowing matches constraint 5.
- clashpanel/ has no forbidden members, theming, isOTG or elementCount.
- Core layering is clean.
- There is no ETA or telemetry, and pages are bounded to PAGE_SIZE.
- Indexes are typed arrays and passes are sliced.
- Soft fails closed, including while the verdict is pending.
- Presentation constants are not exported.
