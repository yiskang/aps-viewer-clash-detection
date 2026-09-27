# Final whole-branch review: Area B (ViewerBridge layer)

Reviewer B · range a0134bb..5d02623 · files read at HEAD: `clashpanel/viewer/{ViewerBridge,isolation,markers,fit,viewerApi}.js`,
`test/clashpanel/viewer/*.test.mjs`, `test/clashpanel/support/{fakeViewer,fakeThree,fakeBridge,viewerFaults}.mjs`, and the
bridge-port call sites in `clashpanel/core/controller.js` and `clashpanel/index.js`. The review was read-only. I ran one
throw-away probe script from the session scratchpad; it is not in the repo. I did not run the full suite. I got a second opinion
from codex-advisor (medium, request 20260927-014259-77648-3984). It independently confirmed B-1 from source and agreed with the
fix conditions below. It also raised B-2, which I classify as RECORD. See the note under B-2.

## Counts

| Severity | Count | MUST-FIX | RECORD | DROP |
|---|---|---|---|---|
| Critical | 0 | 0 | 0 | 0 |
| High | 1 | 1 | 0 | 0 |
| Medium | 2 | 0 | 2 | 0 |
| Low | 16 | 0 | 16 | 0 |
| Deferred-minor DROPs (see triage) | | | | 4 |

## MUST-FIX-BEFORE-HANDOFF

### B-1 (High): when a model leaves the scene, the Panel's own isolation is left stranded and reported as a foreign change
- **Where.** `clashpanel/viewer/isolation.js:101` has `ours()`. It compares the current isolation against the *unprojected*
  `target`/`prevTarget`. Line `isolation.js:160-165` in `restore()` treats not-ours as `skipped-external` and drops the record.
  The trigger path is `clashpanel/core/controller.js:1014-1033`: `onModelLeft` calls `clearViewer`, which calls `bridge.clear()`.
  That call is queued, so `releaseHeld()` (`ViewerBridge.js:118-134`) runs in a later microtask, after the Viewer has removed
  the model.
- **Failure (reproduced against the repo fake, whose `removeModel` drops the model's isolation entry, `fakeViewer.mjs:119`).**
  - Two-model case: prior = `[{m3,[42]}]` (for example Room Locator's). `present` of m1:1 + m2:2 with isolate gives
    `[{m1,[1]},{m2,[2]}]`. m2 then unloads, and the awaited `clear()` returns `'skipped-external'`. The Viewer **stays**
    `[{m1,[1]}]` indefinitely: the Panel's own isolation remains, the foreign prior m3:[42] is never restored, and the record is
    dropped, so no later clear or dispose retries it. The controller then shows the "isolation changed externally" notice
    (`controller.js:125`), which is false.
  - Single-model case: prior m3:[42], isolate m1:1, m1 unloads. The result is `'skipped-external'` and the prior is never
    restored.
  - Knock-on effect: the next isolating present starts a *new* session. It captures the Panel's own leftover isolation as the
    "pre-image" (`isolation.js:117-125`), so later restores go back to the stranded state.
- **Contract broken.** Spec §9.6 last row: "whole visualization cleared, isolation guarded". AC-P6: "isolation is restored or
  skipped as specified". The guard is meant to protect foreign state. Here the only difference is the departed model's own entry,
  which cannot be expressed any more.
- **Why the tests miss it.** `test/clashpanel/viewer/ViewerBridge.transaction.test.mjs:208-211` models this restore-table row by
  dispatching `BEFORE_MODEL_UNLOAD` **without removing the model**, so the check passes vacuously. The controller tests use
  `fakeBridge` only. No test calls `removeModel()` before an awaited `clear()` while isolation is held. This is a cross-task
  defect: T18's controller reaction and T24/T25's ownership compare were never exercised together.
- **Fix (confirmed safe by codex, with conditions).** Inside `createIsolationSession`:
  1. Take **one** successful `getAllModels()` snapshot per restore. If it cannot be read or is not an array, return `'failed'`
     and **keep** the record. Never substitute an empty scene.
  2. Project `cur`, `target`, `prevTarget` and `preImage` onto that snapshot.
  3. If projected `cur` equals projected `preImage`, make no write and drop the record (`'none'`/`'restored'`).
  4. Otherwise restore only when projected `cur` equals projected `target` or `prevTarget`, and restore the **projected**
     pre-image.
  5. Any difference on a surviving model is still foreign and is skipped (§9.4 unchanged). There is never a clear-all merely
     because every recorded model departed (§9.5).
  6. Apply the same projection in `apply()`'s ownership-continues check (`isolation.js:114`).
- **Regression tests to add.** For the single-model and the partial-target cases: `removeModel(m)`, then an awaited `clear()`,
  then check that the prior is restored. Also correct `transaction.test.mjs:209` to remove the model. Live semantics of
  `getAggregateIsolation` after an unload remain G2, but the fake contract and the normative restore table already fail.

## RECORD (accept; list in the handoff as known follow-up)

### B-2 (Medium): an isolation restore that fails during dispose cannot be retried, and the host never hears about it
- **Where.** `ViewerBridge.js:241-262`. `disposed = true` and the memoized promise mean that after `releaseHeld()` returns
  `'failed'` (two setter throws, or an unreadable state), no later `clear`/`present`/`dispose` can retry. The comment at
  `ViewerBridge.js:115-117` ("the next clear/present/dispose retries them") overclaims for dispose. The failure is written only to
  `inspectDisposal()` (`:323-325`), which "is never used by the controller". `clashpanel/index.js:63-88`'s AggregateError contract
  ("listing every failed step") therefore resolves cleanly while the Panel's isolation (or a mesh whose removal failed) stays in
  the Viewer.
- **Disposition.** RECORD, with the cheap fix recommended alongside B-1: fold `bridge.inspectDisposal()` `releaseNotes` and
  `listenerErrors` into `createClashPanel`'s AggregateError (area C owns `index.js`), and correct the comment.
- **Note.** Codex rated this "MUST-FIX or explicitly re-specify". I kept it at RECORD because it needs the Viewer to throw
  repeatedly during teardown and the state it leaves is still guarded. The owner may elevate it.

### B-3 (Medium, already a recorded residual): an owned session never re-checks the §9.5 hidden-node prerequisite
- **Where.** `isolation.js:114-116`, and restore to an empty prior.
- **Effect.** Nodes the user hid mid-session are revealed by `setAggregateIsolation([])`.
- **Disposition.** This matches spec §9.5 ("at session start") and plan residual (a) at `plan.md:161`. RECORD as G2; no action.

### Low findings
| # | Finding (file:line) | Scenario | Disp. |
|---|---|---|---|
| B-4 | `ViewerBridge.js:200-203`: a stale present whose Viewer call throws (non-`Superseded`) reports `superseded:false` + FAILED | The controller drops it via `seq !== c.viewerSeq` / generation (`controller.js:938`), so no wrong state results. One-line fix `|| !isLive(t)` if touched | RECORD |
| B-5 | `ViewerBridge.js:317-320`: `inspectLedger()` returns `null` while an isolation record is still held | Diagnostic only. `transaction.test.mjs:365` "ledger empty" does not prove the isolation record was released, but the isolation state is asserted separately | RECORD |
| B-6 | `ViewerBridge.js:299-303,257`: the relay delivers model-left events between the `dispose()` call and the queued dispose task | The controller has already unsubscribed and guards `c.disposed` (`controller.js:1019`), so it is harmless. Add `if (disposed) return` if touched | RECORD |
| B-7 | `ViewerBridge.js:323-325`: `inspectDisposal()` reports `disposed:true` with empty lists before the dispose task has run | Diagnostic only. Add a `settled` flag with B-2 | RECORD |
| B-8 | `ViewerBridge.js:295-306`: `subscribed=true` is set before both `listeners.add` calls, so a throwing 1st/2nd add leaves a half or no subscription | Controller construction throws. `index.js:45-47` disposes the bridge, which removes the add that succeeded. The leak on that path is `controller.js:70-71`: the `catalog.onChange` disposer is never run (area A) | RECORD |
| B-9 | `markers.js:173-194`: `disposeShared` is try/finally with no catch, and the throw is swallowed by `ViewerBridge.js:260` without entering `inspectDisposal`. `markers.js:107-111`: `lineThrough` registers geometry in `perObject` before the `Line` constructor, and `perObject` leftovers are never disposed. `ensureShared` leaks a partially constructed set if a constructor throws | These need real THREE constructors or `dispose()` to throw. Leak only | RECORD |
| B-10 | `markers.js:138,144` with `ViewerBridge.js:181`: the outline colour is indexed by `liveSides` position | When side 1's model left, side 2 is drawn in the side-1 colour (spec: "side 1 / side 2" colours) | RECORD |
| B-11 | `markers.js:24-28`: `validBox` accepts a zero-size box | `marked:true` with an invisible outline | RECORD |
| B-12 | `isolation.js:162-165`: `skipped-external` carries no note, and a confirmed record already back at its pre-image reports `skipped-external` (pinned at `transaction.test.mjs:479`) | The controller shows the "external" notice in a benign case | RECORD |
| B-13 | G2 fidelity items (fakes cannot show these): `restoreTo` returns `'restored'` without a read-back after a setter that does not throw (`isolation.js:138-142`); `hasAggregateFit` is presence-only (`viewerApi.js:31`); `getNodeBox` world space (`viewerApi.js:61-74`); `BufferGeometry#setFromPoints` in r71; `removeMesh` of a never-added mesh on the write-ahead abort path (`markers.js:92-96,152-158`) is assumed to be a no-op; the live `BEFORE_MODEL_UNLOAD`/`MODEL_REMOVED` order; the fake's `removeModel` dropping isolation entries | Live behaviour is unverified | RECORD (G2) |
| B-14 | `controller.js:~489-501` (area A): bridge dispose runs only after the active run's `done` drains | The Panel's markers and isolation stay on screen during the drain. Delayed, not lost | RECORD |
| T-1 | `presentationMatrix.test.mjs:133`: "only the newest token's meshes" is vacuous outside present-then-present | Mitigated by the `length === 3` check and the carry-forward sweeps | RECORD |
| T-2 | `fakeViewer.mjs:169-171` / `viewerFaults.mjs:57`: the "foreign theming unchanged" check is structurally vacuous (the fake theming methods throw before mutating) | The call recording still catches every call, and the negative controls `noTheming.test.mjs:58-83` bite | RECORD |
| T-3 | `viewerApi.test.mjs:99-107`: the static "only viewerApi names Viewer methods" test scans only `clashpanel/viewer/` and only `viewer.`-prefixed calls | My repo-wide grep of `clashpanel/` is clean (only facade calls; `index.js:52` `viewer.container` is a property handed to the shell; `core/labels.js:46` `model.getObjectTree()` is a Model read, area A) | RECORD |
| T-4 | `fakeViewer.mjs:166`: `onCall` does not validate the method name, and `viewerFaults.mjs:48` `addForeignMesh` clears `callLog` | Test hygiene | RECORD |

## Deferred-minor triage (T22–T26 ledger, `progress.md:125,128,133,138,145`)
| Ledger item | Disposition |
|---|---|
| T22 present() catch fallback not exercised | DROP: pinned at `transaction.test.mjs:425-454` |
| T22 missing tests: dispose in flight / dispose invalidates token / removeAll errors / malformed request doesn't invalidate | DROP: covered at `transaction.test.mjs:375-405`, `reads.test.mjs:119`, `queue.test.mjs:106` |
| T22 dispose discards removeAll errors | RECORD → B-2 (surfaced only to a diagnostic) |
| T22 disposed check precedes validation | DROP (intended; disposed calls are no-ops) |
| T22 onCall name validation; addForeignMesh clears callLog | RECORD (T-4) |
| T23 perObject before the Line constructor; disposeShared without catch; ensureShared leak | RECORD (B-9) |
| T23 validBox accepts a zero-size box | RECORD (B-11) |
| T23 removeScene with a foreign mesh in the scene | RECORD (Low): only scenes the Panel itself created are removed (`scenesAdded`), and names are instance-scoped. It is reachable only if a third party adds a mesh into a Panel-named scene |
| T23 missing tests (12 edges / colour index / beforeScene throw) | RECORD (colour issue → B-10) |
| T24 prevTarget / beforeMutation / equals-pre-image branches untested | DROP: the T25 extras at `transaction.test.mjs:457-491` cover them |
| T24 confirmed-at-pre-image reports skipped-external | RECORD (B-12) |
| T25 stale present superseded:false | RECORD (B-4) |
| T25 matrix vacuity | RECORD (T-1) |
| T25 inspectLedger null while an isolation record is held | RECORD (B-5) |
| T25 dispose discards the releaseHeld / removeAll result | Partially fixed by T26 via `inspectDisposal`; the remainder is B-2 (RECORD) |
| T25 mid-file import; stale "aggregate form" comment; T22 names TypeError guard | RECORD (cosmetic / safe deviation) |
| T25 out-of-scope: unguarded releaseHeld restore for a stale token | DROP: by design. It runs before any newer token's task (serial queue) and is ownership-guarded by read-and-compare |
| T25 out-of-scope: no prerequisite re-check when ownership continues | RECORD (B-3) |
| T26 subscribeOnce half-subscription; controller.js:70-71 disposer leak | RECORD (B-8) |
| T26 relay after dispose | RECORD (B-6) |
| T26 inspectDisposal not settled | RECORD (B-7) |
| T26 hasAggregateFit presence-only; 2 fake-only tests | RECORD (B-13, G2) |
| T26 "The panel is closed" inline literal | RECORD (cosmetic) |
| T26 static layering test scans only viewer/ | RECORD (T-3) |

## Invariants checked and found OK
- **Markers only, statically.** `clashpanel/**` has no `setThemingColor|clearThemingColors|getThemingColor`, no `viewer.impl`, no
  `Viewing.Private`, and no selection or visibility mutators (`select/setSelection/clearSelection/isolate/hide/show/showAll/setAllVisibility`).
  Every Viewer method (`fitToView`, `getAggregate*`, `setAggregateIsolation`, `getAllModels`, `add/removeEventListener`,
  `overlays.*`, `getObjectTree/getInstanceTree/getNodeBox`) is named only in `viewerApi.js`. The other viewer modules call the
  injected facade. There is no camera capture or restore anywhere.
- **Markers only, at runtime.** The AC-P19 negative controls (mutant bridges calling `setThemingColor` and `clearThemingColors`) do
  fail the harness. Foreign meshes are untouched in the whole matrix, including after dispose, because the Panel removes only
  scenes it added itself.
- **Transaction.** Tokens are invalidated at call time (`ViewerBridge.js:222-223,236-237,243-245`). The serial queue guarantees a
  stale task finishes before any newer task runs, and every invalidation enqueues a later clear/present/dispose that releases the
  adopted ledger. That gives "newest surviving token's resources or none" apart from B-1 and the noted repeated-removal-failure
  case. The token is re-checked before every overlay add, scene add, isolation set and guarded restore, and before each camera
  call. The write-ahead order is correct: the mesh goes into `created` and the ledger before the guard, the scene into
  `scenesAdded` before `addScene`, and the isolation record before `setAggregateIsolation`. `prevTarget` correctly covers a
  replacement that throws before or after its change. The c4f76b6 fix restores the previous isolation when an isolating
  replacement does not apply. There is no clear-all fallback (`[]` is written only as a real empty pre-image after the ownership
  compare), and a failed restore keeps its record for clear/present.
- **Queue and dispose.** The queue never wedges (`ViewerBridge.js:31-35`). Dispose is idempotent, never rejects, runs nested
  finally blocks, and removes listeners symmetrically with their errors captured. Calls after dispose are no-ops. The model-left
  relay has one listener per event name and a payload guard. The controller handles the BEFORE_MODEL_UNLOAD + MODEL_REMOVED pair
  idempotently (the second event finds `presented === null`).
- **Fit.** It runs last and outside the rollback. Its failures only add notes, and `fitSides` never throws. A stale token makes no
  camera call, including the fallback. There is no fit on clear, restore or dispose. The aggregate form is
  `viewer.fitToView(list keyed selection, undefined, immediate)` (C-4) in `viewerApi.js:32-34` and in the fake. A single model
  uses the per-model form with de-duplicated sorted ids.
- **Layering.** `clashpanel/viewer/**` imports only its siblings. THREE, the facade and the event names are injected, and there
  are no globals (`bridgeInstances` is module-local).
- **Controller use of the port.** It calls only present, clear, checkIsolationPrerequisite, readAggregateSelection, onModelLeft
  and dispose. It never changes the selection. Outcomes from a present that was superseded, disposed, or belongs to an old
  generation or seq are dropped.
