# D4: M1 / M2 / M2.1 / M3 compatibility classification (regression G)

Task D4 of `docs/superpowers/plans/2026-09-11-canonical-ordering-operand-symmetry-fix-implementation.md`,
design doc §11 regression G (lines 899-904). Confirms Phase A/B'/C's replacement of reload-unstable
`geometryIndex`-based ordering with a canonical `volumeOverlapQuery` wrapper (`orientForCrossing` total
geometric order) over a directional `properCrossingQuery` kernel, plus the tightened coplanarity epsilon,
did not silently regress the already-accepted M1/M2/M2.1/M3 milestones or the acceptance suite.

**Phase B' checkpoint gate (re-confirmed before starting D4):** `docs/research/phase-b-prime-checkpoint.md`
showed `Classification: CAUTION`, `Milestone-owner decision: N/A` — satisfied, proceeded.

## Commands run, in order

1. `node --test` (via `npm test`, `scripts/run-tests.mjs`'s `*.test.mjs` walk)
2. `npm run test:acceptance:clash-finder`
3. `npm run test:performance:gate` (M1)
4. `npm run test:performance:gate:m2` (M2; M2.1 rides along, no separate script)
5. `npm run test:performance:gate:m3` (M3)

Dev server: `node server.js` (port 8080), started manually for this task (the sandbox's
`run_in_background` reaps a long-running server — started as a detached `nohup ... & disown` foreground
Bash call instead, per this project's own documented gotcha).

## Summary

| # | Command | Result | Classification |
|---|---|---|---|
| 1 | `node --test` | 1113 tests, 1112 pass, 0 fail, 1 pre-existing todo | Clean — no classification needed |
| 2 | acceptance:clash-finder | 252/257 checks pass, 5 fail (all one scenario) | Pre-existing, already documented at M3 acceptance — no (i)-(iv) classification applies |
| 3 | gate (M1) | Hard crash, `TypeError: Cannot read properties of undefined (reading 'spans')` | Pre-existing latent defect in `run-gate.mjs` itself, predates Phase A by days — not a "changed result" from this fix |
| 4 | gate:m2 (M2) | disposition `MEASURED`, 0 errors, all correctness cross-checks `true` | Clean — no classification needed |
| 5a | gate:m3 (M3) — counter shift | disposition `MEASURED`, 0 errors/validation failures, all correctness cross-checks `true`; distance-query population shifted 130→133 (inconclusive 464→461), reproduced twice | **(ii)**, routine — the direct, intended effect of the tightened coplanarity epsilon resolving more precheck-inconclusive pairs |
| 5b | gate:m3 (M3) — Criterion 6 verdict | Criterion 6 (informational-only, non-gating) worst-span verdict escalated CAUTION → NO-GO, reproduced twice (19.8ms, 19.5ms; ~2.4x `frameBudgetMs`) | **(ii)-derived, consequential** — a real, reproducible downstream *consequence* of 5a's population shift landing on an unmodified but geometry-dependent, uncapped distance function; not itself a counter shift, and not a defect in Phase A-D's own code. Requires milestone-owner acknowledgment (see below) — not merely noted |

No item is classified **(iv) unexplained**. Nothing here blocks Phase E under design doc §11 regression G's
rule. Item 3 is flagged as a concern worth the milestone owner's attention; item 5b is a consequential
finding requiring the milestone owner's affirmative acknowledgment before or alongside Phase E (see below
— this is a disposition-visibility requirement, not a reclassification: 5b stays (ii)-derived, not (iv),
and does not itself block Phase E).

## Item 1 — `node --test`

1113 tests / 1112 pass / 0 fail / 1 todo. The one `not ok ... # TODO` (test 761, "KNOWN GAP (tracked
separately, not fixed by Task 6): extreme single-geometry aspect ratio (max/min local extent =
2,000,000:1) breaks both mergeDistance and surfaceEpsilon") is explicitly self-marked as a pre-existing,
already-tracked gap in the test file itself — not a new failure, and `node --test`'s own summary correctly
reports `fail 0` (a `# TODO` directive is not counted as a failure). Test count grew from 1078 (at commit
`db64324`, per that commit's own message) to 1113 — expected, since Phase A-D's tasks (A, B, C, D1-D3)
each added new regression tests per the plan.

**Classification:** clean, no (i)-(iv) classification applies (no changed/failing result).

## Item 2 — `test:acceptance:clash-finder`

252/257 checks passed. All 5 failures are pixel-color sampling checks clustered in one scenario:
"Enclosed-witness visibility (containment witness, through opaque geometry)" — e.g. "the pixel at the
occluded witness point's exact projected position is the MARKER colour", "the marker dominates its own
7x7 pixel neighbourhood".

**Investigation (own verification + one `codex-advisor medium` consult, request
`20260912-064744-73818-29074`):**

- `CHANGELOG.md`'s M3 "Live Viewer acceptance result" section (predates Phase A) documents this *exact*
  tally: *"252/257 with 5 such failures on the coordinator's independent re-runs"* and states *"Every
  remaining failure is pre-existing and environment-specific ... none is new, none changed PASS/FAIL
  status, and none is related to clash detection, verified mechanically check-name by check-name against
  a baseline run of the unmodified script."*
- Root cause: commit `726b903` ("M2.1: shrink witness marker radius, make marker translucent",
  2026-09-07 — six days before Phase A's base `e06c6fc`, 2026-09-11) changed `MARKER_RADIUS_FRACTION`
  from `0.01` to `0.002` and made the marker material transparent (`opacity: 0.65`). That commit's own
  message documents this as changing the fixture's marker radius from ~1.04 to ~0.21. The acceptance
  test's *prose comment* (not an assertion) — "the gap is 1.439 world units against a 1.045 radius" —
  was never updated to match; my live run's actual console output showed `viewDepthGap=1.439`
  (bit-identical to that stale comment) but `markerRadius=0.209` (the real, intended post-726b903 value).
- `isMarkerOrange()` requires `r >= 200`; the now-translucent (opacity 0.65) marker blends with the
  occluder color and its rendered RGB no longer crosses that threshold at the sampled pixel — even
  though the marker genuinely renders: attached/detached/depth-tested pixel deltas all prove it
  (`[150,108,31]` attached vs `[131,136,143]` detached or depth-tested, confirmed round-trip).
- The *occlusion-math* checks in the same scenario (not pixel checks) — containment witness point,
  isolated dbId sets (`[mixed] end-state: Structure/Architecture isolated set matches`), occluder
  identity, occlusion gap — all **passed**, proving the actual collision-math outputs this fix could
  plausibly affect (witness point, verdict, isolation) are unchanged.

**Classification:** not a changed result attributable to Phase A-D. Pre-existing, already documented and
accepted at the M3 milestone, caused by an M2.1-era (2026-09-07) marker-rendering tuning change unrelated
to canonical ordering / operand symmetry / coplanarity epsilon. Falls outside regression G's "differences
from the pre-Phase-A baseline" (confirmed identical to that baseline) — no (i)-(iv) classification applies.

## Item 3 — `test:performance:gate` (M1) — pre-existing gate-script defect, not a Phase A-D regression

**Symptom:** hard crash, `TypeError: Cannot read properties of undefined (reading 'spans')` at
`run-gate.mjs:313` (`summarizeSpans(cold.spans)`), because `cold = await runVolumeOverlapOnce('cold')`
resolves to `undefined`.

**Root-caused** via a throwaway instrumented copy of `run-gate.mjs` (created only under
`test/performance/zzz-d4-debug-tmp.mjs`, never committed, deleted before finishing — confirmed via
`git status` showing a clean tree). Findings:

- The browser-side function completes normally all the way through its `return` statement (verified via
  injected marks reaching `cold:done`); `page.evaluate()`'s Promise nonetheless resolves to `undefined`
  in Node.
- Isolating each returned field showed `JSON.stringify(result.pairs)` throws
  `TypeError: Converting circular structure to JSON --> starting at object with constructor 'Window' ---
  property 'window' closes the circle`, while `spans` and `statistics` stringify fine.
- Walking the object graph pinpointed the exact chain: `pairs[0].source.model` is the live Autodesk
  Viewer `Model` object, and `pairs[0].source.model.visibilityManager.viewerImpl._lmvDisplay` closes a
  cycle back to `window`. Playwright's structured-value serialization across the CDP evaluate boundary
  cannot clone this and silently resolves the whole call to `undefined` instead of throwing.

**This is not caused by Phase A-D:**

- `CollisionWorld.js`'s pair construction (`source: { modelId, dbId, model: sourceOperand.model }`) has
  always embedded the live model reference on every `ClashPair` — the surrounding comment marks this
  "M2.1 Task 5", well before Phase A.
- `run-gate.mjs`'s own crashing `return { statistics, pairs: result.pairs, spans: rec.spans, ... }` line
  was last touched in commit `7548fde` (2026-09-05) — six days before Phase A's base `e06c6fc`
  (2026-09-11).
- The newer M2/M3 gates (`run-gate-m2.mjs`, `run-gate-m3.mjs`) already engineer around this exact hazard:
  they never return raw `pairs` across the evaluate boundary — they compute `pairCount`,
  `sameModelPairCount`, `crossModelPairCount`, and `pairSignatures` (plain strings via `modelTag(...)`)
  *inside* the browser first. `run-gate.mjs` (M1, "Task 24", the oldest gate) was simply never updated to
  do the same.

**Confirmed empirically, not just by code archaeology:** checked out a temporary git worktree at
`e06c6fc` (Phase A's own base commit, i.e. immediately pre-Phase-A) and ran the identical
`npm run test:performance:gate` there (own dev server on a free port, `.env`/`node_modules` symlinked
in). It produced **byte-for-byte the same model profile, frontier, chosen dbId pair (232/7), and crash**
at the exact same line. (First two attempts at this baseline run instead hit a `page.waitForFunction`
`TimeoutError` — traced to an unrelated local-environment issue: the chosen comparison port, 8099, was
already bound by an unrelated `OrbStack`-managed service on this machine, not anything code-related;
re-run against a genuinely free port, 18099, reproduced the crash cleanly, twice.)

**Classification:** this is a **pre-existing latent defect in `test/performance/run-gate.mjs` itself**
(never exercised end-to-end successfully since the M2.1 Task 5 live-model field was added to `ClashPair`,
which predates this whole plan), not a "changed result" caused by the canonical-ordering fix. It falls
outside regression G's (i)-(iv) classification (which covers differences *from* Phase A-D) — it crashes
identically with and without Phase A-D's changes. Flagged as a concern below since D1-D3 of this plan
only ever exercised `run-gate-m4.mjs`, so this appears to be the first time anyone has actually run
`npm run test:performance:gate` since M2.1 landed, and it has apparently never worked since.

## Item 4 — `test:performance:gate:m2` (M2)

`disposition: "MEASURED"`, zero errored runs (`"error": null` on every run), `correctnessCrossCheck` all
`true` (`tlasColdPairCount`/`linearColdPairCount`/`tlasWarmPairCount`/`linearWarmPairCount` all 1197,
every `*PairSignaturesEqual` field `true`, `allSignatureSetsAgree: true`). No GO/CAUTION/NO-GO-style
verdict exists in this gate. This is the gate's normal, expected-shape PASS output.

**Classification:** clean, no (i)-(iv) classification applies (no changed/failing result).

## Item 5 — `test:performance:gate:m3` (M3) — two distinct findings (5a, 5b)

`disposition: "MEASURED"`, zero errored runs, zero validation failures. `correctnessCrossCheck` all
`true`: pair signature sets agree across every broad-phase-arm/cold-warm combination, and
`maxAbsoluteDelta: 0` for per-pair clearance distances across broad-phase arms.

### 5a — counter shift (routine)

**Correction to an earlier draft of this doc:** an initial pass at this classification claimed the
fixture's counters were "bit-identical" to `db64324`'s documented baseline. A `codex-advisor medium`
consult (request `20260912-071551-10096-20958`) correctly challenged that — it is only *mostly* true, and
the exception is exactly where the interesting mechanism lives. Directly comparing the saved gate JSON
(`test/performance/results/m3-gate-1789098743072.json`, the `db64324`-era run, vs this task's own
`m3-gate-1789168303898.json` and a second confirmation run `m3-gate-1789168860015.json` — gitignored
scratch data, used here only for a direct paired comparison, not as a mechanically-diffed baseline per
this task's own brief):

| Field (all four broad-phase arms agree) | `db64324`-era | Current (both of this task's runs) |
|---|---|---|
| `clearanceExactAabbSurvivors` | 1978 | 1978 (unchanged) |
| `clearanceOverlapPrechecksRun` | 1913 | 1913 (unchanged) |
| `clearanceHardClashExclusions` | 1197 | 1197 (unchanged) |
| `clearanceHits` | 30 | 30 (unchanged) |
| `clearance-hard-clash-precheck-inconclusive` diagnostic count | 464 | **461** |
| `clearanceDistanceQueriesRun` | 130 | **133** |

The arithmetic is exact and self-consistent: 3 fragment pairs that used to be dropped as
`clearance-hard-clash-precheck-inconclusive` (464→461) are now resolved decisively and fall through to
`clearanceQuery`'s distance computation instead (130→133) — with zero change to
`clearanceHardClashExclusions` or `clearanceHits`, i.e. these 3 pairs were newly *resolved*, not newly
*excluded* or newly *hit*. This is precisely the documented, intended effect of `cae78bb` ("tighten
coplanarity epsilon to symmetric min(D_A, D_B) — design doc C-2"): a tighter epsilon lets the precheck
prove/disprove crossing for pairs it previously couldn't decide, converting `inconclusive` outcomes into
decisive ones. **This part (5a) is squarely classification (ii), routine**, and reproduced identically
across two independent gate runs (both showed `clearanceDistanceQueriesRun: 133` / inconclusive: 461).

### 5b — Criterion 6 verdict escalation (consequential, not routine)

**What else changed:** Criterion 6, the single-call frame-budget disposition — an explicitly non-gating,
reported-only performance finding (`run-gate-m3.mjs`'s own `dispositionCaveat`: *"This is a REPORTED
finding, not a CI gate: this script never fails a build on the verdict ... Per the M3 spec a genuine
NO-GO does not by itself block M3"*). This task's first run measured `worstSpanMs: 19.8` against
`frameBudgetMs: 8` → **NO-GO — worst single-call span substantially exceeds frameBudgetMs**
(`run-gate-m3.mjs`'s own banding: GO ≤ 8ms, CAUTION 8-16ms, NO-GO > 16ms), in the `linearCold` arm
specifically.

Tracing this metric's history on this *exact* fixture, across three points in time:

| When | Worst single-call `clearanceQuery` span | Verdict |
|---|---|---|
| M3 original acceptance (`CHANGELOG.md`, pre-`db64324`) | 6.10-6.50 ms | GO |
| After `db64324` ("remove 8ms wall-clock abort from crossing-query semantic path", 2026-09-11, **before** Phase A's base `e06c6fc` — a separate, already-reviewed-and-merged fix, not part of Phase A-D) — per that commit's own `CHANGELOG.md` entry: *"the fix moved only timing (worst single `clearanceQuery` span 6.40 ms → 10.80 ms)"*, confirmed directly in its saved gate JSON | 10.80 ms | CAUTION (8-16ms band) |
| This task's first run (post Phase A-D) | 19.8 ms | NO-GO (>16ms band) |
| This task's confirmation re-run (same branch, same fixture) | 19.5 ms | NO-GO (>16ms band) |

`db64324` predates Phase A (it sits below `e06c6fc` in `git log`, confirmed by ancestry) and is a
distinct, separately-reviewed correctness fix (removing a wall-clock abort that made crossing-query
verdicts nondeterministic) — not part of this plan's Phase A-D. Its own documented consequence on this
fixture was 6.40 ms → 10.80 ms, i.e. GO → CAUTION, **not** NO-GO. The further escalation to ~19.5-19.8 ms
— CAUTION to NO-GO — is what Phase A-D added, and re-running the gate a second time confirms this is
**reproducible** (19.5 ms and 19.8 ms, both consistently in the `linearCold` arm, both with the identical
`clearanceDistanceQueriesRun: 133`), not a one-off GC/JIT noise spike on a single sample — addressing the
codex-advisor consult's explicit request to establish repeatability before classifying.

**Mechanism (classification ii, revised):** the codex-advisor consult correctly caught that my first draft's
mechanism was wrong — Criterion 6 times `clearanceQuery()`'s own `closestPointToGeometry` call
(`collision/CollisionWorld.js:2321`'s `reportSpan('clearance-distance-query', ...)`), which runs *after*
the Hard-Clash precheck (and its `properCrossingQuery` probe ladder) has already completed; it does not
itself measure the probe ladder. Neither `ClearanceQuery.js` nor the distance-query code path in
`CollisionWorld.js` was touched by any Phase A-D commit (`git log e06c6fc..HEAD` on those paths shows only
unrelated `orientForCrossing`/naming changes, never `closestPointToGeometry` itself) — `closestPointToGeometry`'s
own per-call cost is unmodified and is inherently geometry-dependent with no constant-work or wall-clock
bound (`CHANGELOG.md`'s own "Known limitations" section already discloses this: *"nothing bounds a single
`clearanceQuery` call's own duration"*). The correct causal chain is therefore **indirect**: `cae78bb`'s
tightened epsilon changes *which* 133 (not 130) fragment pairs reach that unmodified, uncapped distance
function — and among the 3 newly-admitted pairs, at least one appears to be a genuinely more expensive
geometry comparison than any of the previously-admitted 130, reproducibly. This is a bounded,
well-explained population change (+3 well-defined pairs), not an unbounded-growth or runaway-cost risk.

**Classification:** **(ii)-derived**, not itself a counter shift — 5a's population change is squarely
(ii) and reproduced twice; 5b (this verdict escalation) is the direct, reproducible downstream
*consequence* of that same (ii) population change reaching an unmodified, geometry-dependent, uncapped
function, not a new defect in Phase A-D's own code, and not (iv) unexplained (the mechanism is understood
and reproduced). This was not accepted at face value: a codex-advisor consult initially and correctly
pushed back on my first-draft mechanism and "bit-identical" claim, and this section was revised (including
one additional confirmation gate run) in response before finalizing.

**Disposition: requires explicit milestone-owner acknowledgment before or alongside Phase E — not merely
a noted concern.** The worst-case single-call span for this fixture has grown roughly 3x from its
M3-acceptance value (6.1-6.5ms → ~19.5-19.8ms, ~2.4x `frameBudgetMs`), reproducibly, and landed the M3
gate's own Criterion 6 in its NO-GO band. `disposition: MEASURED` at the gate-script level is a statement
about *correctness* (no error, no validation failure) — it is not, and does not substitute for, sign-off
on this *performance* finding. The M3 design spec is explicit about exactly this situation: *"A genuine
failure here does not necessarily block M3 ... but it must be an explicit, reported finding, not an
assumption"* (`docs/superpowers/specs/2026-09-07-collision-library-milestone3-clearance-design.md:350`).
This finding is classified (not (iv), does not block Phase E on its own), but classification is not the
same thing as disposition: a NO-GO on this criterion, now measurably worse than the CAUTION the milestone
owner would have seen if this were re-checked right after `db64324`, needs a human — the milestone owner
— to see this specific number and either accept it, request the M3 spec's own suggested mitigation (a
tighter `DEFAULT_CLEARANCE`, or scoping Soft Clash to smaller selections), or decide it needs deeper
investigation, before or alongside Phase E — not have it pass by silently inside a `MEASURED`/(ii) label.
Per this task's explicit brief and the user's standing directive, `frameBudgetMs`, `DEFAULT_CLEARANCE`,
and the §6.4 comparator are not mine to touch, and no tolerance was widened or loosened to make this
pass — this doc is reporting the finding for that acknowledgment, not resolving it. Exact per-pair
attribution of which of the 3 newly-admitted fragment pairs is the expensive one was also not established
— the gate's own span instrumentation does not carry per-pair identity (only aggregate/`byReason`
diagnostics) — so a milestone owner who wants to act on this rather than merely accept it would need new
instrumentation to pin the specific pair down first.

## Files touched by this task

Only this document. No file under `collision/`, `test/`, or `wwwroot/` was modified — the throwaway
`test/performance/zzz-d4-debug-tmp.mjs` instrumentation copy used to root-cause item 3 was deleted before
finishing (confirmed via `git status`), and the temporary `e06c6fc` git worktree used to confirm item 3's
pre-existing status was removed (`git worktree remove --force`) after use.
