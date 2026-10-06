# G2 future live-diagnostic preparation package: internal review

- **Date:** 2026-10-06
- **Reviewer role:** internal reviewer (prompt §23). Design/preparation review only. No package file was edited. No Viewer, browser, Playwright, live harness, G2 retry, authorization record, attempt reset, commit or push.
- **Authority:** `docs/prompts/for-claude-g2-future-live-diagnostic-design-preparation-package.md` (untracked owner prompt), §3, §23, §27.
- **Repository boundary:** `main` @ `f3bab74f460eacd6b6f69bc8fb90110455ceeb68` (= `origin/main`). Package under review (`$PKG`): `docs/research/2026-10-06-g2-live-diagnostic-preparation/` (README, `spec-part1-questions-instrumentation-capture.md` contract v4, `spec-part2-controls-envelope-verdict-runbook.md` contract v3, `prototype/` incl. `NOTES.md`, `fixtures/`). All untracked.
- **Independent second reads:** Codex `codex-review spec` medium on Part 2 (request `20261006-110122-98985-15512`); Codex `codex-advisor` medium on `prototype/verdict.mjs`, the false-SUPPORTED question (request `20261006-110140-245-17382`). Every Codex claim kept below was re-verified against the source or reproduced in the scratchpad. Claims that did not survive verification are listed with their disposition in "Codex findings: disposition".

## 1. Scope and commands run

| # | Command (cwd `$PKG` unless stated) | Exact result |
|---|---|---|
| 1 | `node --version` | `v22.23.1` |
| 2 | `node --test prototype/*.prep-test.mjs` | `tests 103, pass 103, fail 0, cancelled 0, skipped 0`. The determinism test wrote two runs under the OS temp directory (no `PREP_SCRATCH`) and deleted them. Nothing was written in the repo |
| 3 | `node prototype/run-preparation.mjs --out <scratch>/runA`, then the same with `--out <scratch>/runB` | both exit 0; 13/13 gates `PASS` (fixturesMatchDisk, inProcessDeterminism, expectedVerdicts, soundnessAudit, noAmbiguousPositive, partialTracesNeverPositive, recorderLifecycle, wireKeyCollisions, peer:runbook/capabilityMatrix/authBinding/dryRunConfig/manifest); `scenarios=65 verdicts={"INCONCLUSIVE":13,"INVALID":43,"BLOCKED":1,"SUPPORTED":7,"REJECTED":1}` |
| 4 | `diff -r runA runB`; `diff runA.log runB.log` | both identical (148 files each) |
| 5 | digests (both runs) | `results.json` `8daccee9246da96a534e152c05d6f667fbe14fceda38b3047617f3ef1033ac2a`; `SHA256SUMS` `b3d7cc9efd97c08368432cc7b3e74619e0d946a6aa012a2333f7ddec12fce378`; sorted per-file `shasum` aggregate `161b4988bc480a11fe30a9d9bf801cceaefee5f57875dd8df759611a052427b3` |
| 6 | `grep -rE` for ISO timestamps, `/Users/`, `/private/`, user name in runA | no match. Prototype source (excluding tests) has no `Date`, `Math.random`, `performance.now`, `randomUUID`, `process.env`, `child_process`, `playwright`, `puppeteer` or `launch(` |
| 7 | `shasum -a 256 test/acceptance/clashpanel-viewerbridge.acceptance.mjs docs/research/2026-09-30-g2-viewerbridge-dockingpanel-live-verification-procedure.md` (repo root) | `cc8868cd68b9c2c3382297070289a2aa165c74249c6d82896d76bacc6c6ef09b` / `d1ccfde224b8ae76fe74b06c93abc532e6df9612933cafaa045053c8e2e45a75` (both as required) |
| 8 | `git rev-parse HEAD origin/main`; `git status --short --untracked-files=all`; `git diff --stat`; `git diff --cached --stat` | HEAD = origin/main = `f3bab74…`; untracked only `docs/prompts/for-claude-g2-future-live-diagnostic-design-preparation-package.md` and files under `$PKG`; both diffs empty |
| 9 | Viewer 7.124.2 source: the bundle is not in the repo (as the package states). The A2 copy at `/private/tmp/claude-501/-Users-kangea-Workspace-Codes-aps-viewer-clash-detection/9ce9183a-24d1-400b-8dea-70f3c52011e5/scratchpad/viewer/viewer3D.js` was re-hashed: `12b9fe49f41dc99ccec62535e5c887da915980829da2e941cfe4da3d7197c02e` (pinned value), 295,263 lines. It was read with `sed`/`grep` only and never executed | see §2.1 |
| 10 | Harness cites `H:6773, 8411-8432, 8420, 8423, 8465, 8489, 8510, 8512, 8516, 8518, 11550-11560` and §17.1 authorization code (`AUTHORIZATION_MARKERS` L513-523, `validateAuthorizationRecord` L629-700, startup scan L923-980) | see §2.1 and §2.10 |
| 11 | Adversarial probes in the scratchpad (`adv.mjs`, `adv2.mjs`, `adv3.mjs`, `caps.mjs`) built with the package's own `Script` DSL, `reseal`, `removeData`, `evaluateScenario` and `auditResult` | results cited in the findings |

## 2. Review by dimension (prompt §23)

### 2.1 Viewer 7.124.2 source fidelity: sound

Every Viewer line I checked matches the pinned bundle:

- slot assignments: only V:95294, 96698, 96709, 96727, 96738 (exhaustive `grep '__destinationView\s*='`);
- `getRequestTransition` V:96747-96749; `getTransitionActive` V:96772;
- `setTransitionActive` V:96758-96764, which fires only on change, with `fireEvent` at V:96763;
- `TRANSITION_ACTIVE_FLAG_CHANGED` V:95234; `Navigation.Events` V:97047; the `EventDispatcher` mixin V:97046;
- consumption in `update()`: V:105006 read, V:105007 `request && !getTransitionActive()`, V:105009 clear, V:105010 `transitionView`; then V:104763 `goToView`;
- V:106802 gotoview gate; V:106816 `elapsedTime = 0`; V:106817 synchronous `animateTransition`;
- the final step V:107093-107118 (fall V:107116, then `transitionCompletedCallback` V:107117); the first-step rise V:107122;
- `unitTime` V:107125 is computed before the increment at V:107127. `_easeClamp(0, …)` returns 0 (V:107051-107056), so step 0 moves nothing: the pre-motion claim holds;
- later steps are scheduled with rAF at V:107155; view-cube rise/fall V:107165/V:107212; interaction V:107728/V:108019;
- `CAMERA_TRANSITION_COMPLETED` V:13923, dispatched through `onTransitionCompleted` V:26684-26686 with payload `{type}` only;
- `autocamChange` → `syncCamera` (V:26673, V:33470); `getCamera` V:27956-27959; `fitToView` V:29941; `FIT_TO_VIEW_EVENT`/`AGGREGATE_FIT_TO_VIEW_EVENT` V:36590-36604; `fitBounds` early return V:95805-95807;
- immediate `restoreCameraState` V:38665-38677 touches neither slot nor flag; the non-immediate branch writes the slot at V:38663;
- main loop V:17604-17631, with `VIEWER_RENDER_TICK` after `_animLoop`;
- default `shotParams.duration = 1.0` (V:106633), so the first `animateTransition` call always takes the rising branch.

The pending-slot, transition-active-edge and gap claims (P1 §9.1, §10.1) are therefore source-faithful.

The harness cites also match: the `SPY_TARGETS` `viewer.fitToView` entry (H:6773); `waitForCameraSettle` (H:8411-8432), whose `sampleCamera`/`waitFrame` adapters are synchronous in-page functions (H:11545-11561), so the I3 "no await between host and slot read" and the CP08 microtask argument hold; the BLOCKED-before-frustum lines H:8510/H:8516.

One rationale is incomplete (L-4).

### 2.2 Minimal observable set: sound

`ID-ON + P-FRM + P-TC + V-PEND + V-EDGE` is unchanged from the committed DS §8.6. P1 §7.3 excludes `P-XS`, `P-TICK`, `P-CC`, `P-CC0`, `V-ACT` and VB-4…VB-8 on the committed basis. No redundant observable was added. The two rejected read sites (a slot read inside the `TE` listener; a value match of the destination) are correctly reasoned from V:105009 → V:107122 and V:107096-107100.

### 2.3 Capture points CP01–CP15: sound, with wording issues

Fields, ordering guarantees, races, token availability and fail-closed behaviour are defined for all 15 points, plus the machine-readable `failClosed` entries. The I1–I7, `RS-PAIR` and I4 rules are mechanical. See L-2 (listener "never removed" wording) and L-4.

### 2.4 Pre-motion handling: sound in mechanism; its prose is overstated (M-2)

`PRE_MOTION` (P1 §9.2) is correctly implemented (`verdict.mjs` `preMotion`). `Q-OWNER` under pre-motion is blocked by T1/T1b, and `auditResult` re-checks it.

`Q-SUBJ = PENDING` stays definite under pre-motion by design (P1 §9.5). This is identity-sound: a consumption clears the slot (V:105009) before the rise (V:107122) in one stack, so a subject object still visible at `t_d` was not consumed. Probe A18 and Codex finding 2 confirm the behaviour.

### 2.5 Pending-clear gap: sound for `OPEN`, with one unimplemented rule (M-3)

GAP annotation classes match P1 §10.2. Token-dependent outputs are `AMBIGUOUS(UNOBSERVED_SLOT_WINDOW)` through the committed correlator, and NC-11 passes.

The §10.4 rule "`CLEAR_WITHOUT_EDGE` gives `IDENTITY_AMBIGUOUS` for the cleared token in both modes" is not enforced (M-3).

### 2.6 Controls: complete matrix; ordering and registry gaps

PC-1…PC-5, `RG` and NC-1a…NC-21 are defined, with an expected pattern, verdict and invalidation scope for each. PC-3 is explicitly "not historical evidence", and the `PENDING` control gap is recorded honestly as `MECHANISM_ONLY`.

Defects: the runbook control-trace ordering (M-4) and the Phase-0/Phase-5 registry (M-7).

### 2.7 Trace envelope: arithmetic verified

I recomputed the following with the committed canonicalizer:

- `META` worst case **1,456 B**, using the exact `LIVE_CAPS_V2` object from `fixtures/shared/binding-a.json`. The cap is 1,536 B.
- `END` worst case **363 B** (cap 384 B). The reserve 2 + 1,536 + 1 + 384 = 1,923 ≤ 2,048.
- `NV` worst case **403 B** (`q` 24,576, `f` 5,376, `tm` 2⁵³−1, 256-byte payload). The cap stays 406 B.
- Projection budget: 2·3,576 + 3 + 8 + 4 + 1,024 = **8,191 ≤ 8,192**.
- Raw worst case: 10,754 + 10,736 + 512 + 26 + 1,024 + 5 = **23,057 ≤ 24,576**.
- Bytes at the caps: 24,064 × 257 + 512 × 407 + 2,048 = **6,394,880 ≤ 6,400,000**.
- Wire keys: the 37 data wire keys in P1 `wireKeys` are pairwise unique. The `META`/`END` intersection is exactly `{f, k, tm}` (gate `wireKeyCollisions` PASS).

One informational number is not reproducible (L-3).

### 2.8 Evidence provenance: two blocking gaps

The layout, write-once rules, ledger, terminal file and manifest are defined. The target plan is not part of the frozen evidence and is never re-verified (H-1). The finalization order is internally impossible (H-2). The ledger closure is self-referential (M-5), `teardown.json` is written twice (M-6), and crash recovery is overclaimed (M-9).

### 2.9 Verdict model: rule engine sound for the trace; external inputs fail open

I found no path where an ambiguous **question** of a primary target, an integrity failure, a proper prefix, a failed required control, an unauthorized assumption, `ei = UNKNOWN`, `cg = 1`, a misbound `C8` or a failed/fabricated PC-3 yields `SUPPORTED`/`REJECTED`. Probes A15, A15b and A16 (foreign rise/fall excursions after a restore, a transition in flight across a restore) all came out `INCONCLUSIVE`. Codex reached the same result for prefixes, duplicate sequences, failed PCs and C8 misbinding.

Confirmed fail-open paths:

- a post-hoc plan swap flips `REJECTED` → `SUPPORTED` (H-1);
- missing or non-boolean `ncRerunOk`/`ledgerOk` → `SUPPORTED` (M-1);
- a source-impossible token reappearance → `SUPPORTED` (M-3);
- a missing subject `C8` / no plan conformance check (M-8).

The spec's "an ambiguous trace can never be SUPPORTED" prose overstates the per-primary-target semantics (M-2).

### 2.10 Authorization binding vs the real existing format: accurate

§17.1 matches the harness exactly:

- the whole-line marker regexes (H:513-523), with the exact `Runtime:` literal built from `RUNTIME_ENVELOPE_REQUESTED`;
- the candidate set: `docs/prompts/**/*.md` with a line beginning `G2-LIVE-EXECUTION:`, exactly one non-superseded (H:686 `candidate-set-ambiguous`);
- `Harness-SHA256` is hashed over the fixed acceptance harness path;
- the startup-scan refusals (`reservation-exists`, `journal-exists:<state>`, `orphan-temp`, `unreadable-reservation`).

I verified the hazard claim: the three records are the only candidates. `75a3ccb9` supersedes `8a8d49f6`, which supersedes `dbd97137`, so `75a3ccb9` is still non-superseded. Neither the untracked prompt nor any package file contains a line beginning `G2-LIVE-EXECUTION:` or `G2-LIVE-DIAGNOSTIC:`, so nothing here joins the candidate set.

The OD-1 conclusion (the existing format cannot bind a diagnostic run, and the format is unchanged) is correct. `auth-binding.mjs` works on synthetic in-memory records only.

### 2.11 Runbook safety: nothing executes

Every step is `NOT EXECUTED`, with `executed:false` / `authorized:false`. Every live-touching step (P0.10–P0.14, P1–P4) has `requiresFutureOwnerAuthorization:true`.

The prototype has no browser, Viewer, network or harness import. Its only write paths are `--out` (staging dir + rename, refusing `docs/research/evidence`, `test/acceptance/results`, the D2/diagnostic packages and the package's own `fixtures/`/`prototype/`), `fixtures-gen.mjs --write` (package-local `fixtures/`), and the determinism test's temp directory. The runbook's internal ordering defects are H-2, M-4 and M-6.

### 2.12 Offline prototype correctness

103/103 tests pass and the 13 gates pass. The defects are in its external-input handling (H-1, M-1, M-3, M-8, L-1, L-9), not in the projection/correlation path. The committed `correlate.mjs`, `schema.mjs`, `pins.mjs` and `project.mjs` are consumed unchanged (tracked; `git diff` is empty).

### 2.13 Determinism: reproduced

The two fresh runs are byte-identical (148 files), with no timestamps, randomness or absolute paths. The digests are in §1, row 5. They are not yet recorded in the package or handoff (L-10).

### 2.14 Committed conclusions: unchanged

README, P1 §4/§11 and the P2 header restate the following unchanged:

- `OPEN` 2/13, assumption 3/13, 3/13 with a sound procedure;
- public-only labels 0; `NV` 406 B; 2,048 configurations with 0 wrong labels; 5,063 residual;
- the gap is fail-closed; C6 `NOT_EVIDENCED`; C8 unresolved; G2 `FAIL (row 3)`; T4 unchanged.

The verdict output carries `historicalStatus` as copied constants, and every verdict has scope `NEW_RUN_ONLY`. None of the findings below touches these conclusions.

### 2.15 Live-worthwhile verdict B: justified, authorizes nothing

§22 grounds B in the one-sidedness under `OPEN` (only `PENDING`/`RESTORE`/`INIT` can be definite, so a stale decision is never excluded), the 3/13 coverage, the 5,063 residual, the dependence on VB internals plus `RG`, the lack of historical transfer and OD-1. It states that it "does not authorize, recommend or schedule execution".

The "Why not C" paragraph (§22.3) claims that provenance and the runbook are "complete and specified mechanically". H-1, H-2 and M-4…M-9 contradict that claim until they are fixed. After those fixes B stands, and none of the findings argues for A.

## 3. Findings

Severity is for the design/preparation abstraction level. Nothing here is a live or acceptance defect.

### High

**H-1. Pre-registered target plan is not bound at evaluation, and is absent from the frozen evidence.**
- **Status:** FIXED (governance/target-plan.json added; Phase 5/evaluator require sha256(plan) = binding.targetPlanSha256 = every raw META.tq, else INVALID TARGET_PLAN_DIGEST_MISMATCH; auditInputs re-checks; label-swap test + fixture target-plan-digest-mismatch)
- **Location:** Part 2 §13.2 (evidence tree), §14.2, §16 P5.01–P5.06, §12.7 "Determinism"; `prototype/verdict.mjs:305-306` (`validateTargetPlan(sc.targetPlan, …)` on the supplied object), `envelope.mjs:326` (checks only `META.tq == binding.targetPlanSha256`), `auditResult` (`verdict.mjs:386-409`).
- **Evidence:**
  - P0.03 hashes the plan before the run.
  - `targetPlan.json` is not in the §13.2 run-root tree. `governance/` holds only `authorization-record.md` and `binding.json`.
  - No Phase-5 step re-hashes the plan that the verdict computation reads.
  - The evaluator never compares `sha256(canonical(targetPlan))` with `META.tq`/`binding.targetPlanSha256`.
  - Probe `adv2.mjs` on `valid-rejected-init`: `META.tq` = `binding.targetPlanSha256` = sha of the plan = `c49db752…`, and the baseline verdict is `REJECTED`. Swapping `supportLabels`/`rejectLabels` without touching `META.tq` or the binding gives `SUPPORTED`, and `auditResult` returns `[]`. Codex advisor finding 5 reproduced this independently.
- **Failure scenario:** after the trace is seen, the analysis is run against an edited plan, or a plan file that differs from the bound one. The pre-registration guarantee (§14.2), which is the only defence against post-hoc label selection, is silently bypassed and produces `SUPPORTED`/`REJECTED`.
- **Recommended fix:**
  - Add `governance/target-plan.json` (a byte copy, write-once and hashed) to §13.2.
  - Add a P5 step, or a `validateTargetPlan` precondition, that requires `sha256(canonicalBytes(plan)) === binding.targetPlanSha256 === META.tq` of every trace, else V2 `INVALID` (`TARGET_PLAN_DIGEST_MISMATCH`).
  - Implement the check in `evaluateScenario` and in `auditResult`.
  - Add a negative fixture (plan swap) with expected `INVALID`.

**H-2. Evidence finalization order is impossible, and the commit precedes the determinism check.**
- **Status:** FIXED (finalization order raw complete -> raw freeze P4.06 -> two scratch analyses compared P5.07 -> publish P5.08 -> manifest P5.09 -> post-publication consistency check P5.10 -> run-root freeze P5.11 -> commit record P5.12; teardown.json once; full NC registry at P0.06/P5.03; runbook-validator checkFinalization + tests)
- **Location:** Part 2 §13.3 rule 3 ("After P4.05 the run root is made read-only"), §16 P4.05 → P4.06 (writes `raw/teardown.json`) → P5.01–P5.07 (write `derived/*`, `TERMINAL-VERDICT.json`, `MANIFEST.json`); P5.07 (commit record with `terminalVerdict`) → P5.08 (determinism; `SC-C03` ⇒ "the verdict is withheld"); Appendix (iii) preconditions encode the same order.
- **Evidence:** verified in §16 lines 720-733 and Appendix (iii) `P4.05 freezeRunRoot` → `P4.06 teardown` → … → `P5.07 writeManifestAndCommitRecord` → `P5.08 rerunAnalysisDeterminismCheck`. Codex spec-review Critical 2 reported the same, and I verified it.
- **Failure scenario:**
  - A literal implementation makes the run root read-only and then fails writing `teardown.json`, or the first derived file, with `EACCES`. That is `SC-B07`: the single consumed attempt becomes `INVALID` on every run.
  - Alternatively, P5.07 durably commits `SUPPORTED`, and P5.08 then detects nondeterminism, which must withhold that same verdict.
- **Recommended fix:** reorder as follows:
  1. finish teardown and all raw files;
  2. freeze only the raw set;
  3. run Phase 5 twice into separate scratch directories and compare;
  4. only then publish one derived set, the terminal verdict and the manifest;
  5. write the commit record last;
  6. make the whole root read-only.

  Update §13.3, §16 and Appendix (iii), and add a runbook-validator assertion for the order.

### Medium

**M-1. Evaluator fails open on missing or non-boolean NC-rerun and ledger inputs.**
- **Status:** FIXED (ncRerunOk/ledgerOk pass only when exactly true; *_UNKNOWN / *_MISMATCH reasons; auditInputs; fixtures gate-nc-rerun-absent, gate-ledger-mistyped)
- **Location:** `prototype/verdict.mjs:319-320` (`if (sc.ncRerunOk === false)`, `if (sc.ledgerOk === false)`); docstring L274 "default true".
- **Evidence:** probe `adv3.mjs` on `valid-complete`: with both fields deleted → `SUPPORTED`; with `ncRerunOk:"FAILED"`, `ledgerOk:0` → `SUPPORTED`. Codex advisor finding 3, verified.
- **Failure scenario:** a future bound evaluator modelled on this prototype receives an unset or mistyped gate and reports a positive verdict, although §14.4 V2 requires `INVALID` unless both gates hold.
- **Recommended fix:** require `=== true` for both (absent ⇒ `INVALID`, reasons `NEGATIVE_CONTROL_RERUN_UNKNOWN` / `HASH_LEDGER_UNKNOWN`). Add both checks to `auditResult`, plus fixtures for the absent and mistyped cases.

**M-2. "An ambiguous trace can never be SUPPORTED or REJECTED" overstates the implemented semantics.**
- **Status:** FIXED (normative per-primary-target ambiguity scope and the exact DEFINITE-PENDING rule in Part 2 §14.3 and Appendix (ii) ambiguityScope; noAmbiguousPositive gate made non-circular; test "M-2")
- **Location:** Part 2 §14.3 L542-547 ("Pre-motion stops at T1/T1b. The slot-window gap stops at T1"), §14.4 L570 (non-primary targets never change the run verdict), P1 §9.5, §10.4.
- **Evidence:**
  - `valid-complete` is `SUPPORTED` while its non-primary `Q-OWNER` target is `AMBIGUOUS`.
  - A pre-motion, `CONSUME_EDGE_BOUND`-gap trace with a visible subject object at `t_d` is `SUPPORTED` with `Q-SUBJ = PENDING` (probe A18; Codex advisor findings 1-2).
  - Both outcomes are correct under the identity argument in §2.4 and the explicit spec rules. The global sentence and the "stops at T1/T1b" bullet are nonetheless literally false. The prompt §14 hard rule ("No ambiguous trace may produce SUPPORTED or REJECTED") is satisfied only under an unstated per-primary-target reading.
- **Failure scenario:** an independent reviewer or implementer reads the global rule literally. Either the package is judged non-compliant, or a "strict" implementation makes `SUPPORTED` unreachable under `OPEN`: `Q-ATTR` is never definite when a `TC` exists, so a trace-wide rule kills every positive verdict.
- **Recommended fix:**
  - State the interpretation normatively: ambiguity is assessed per pre-registered primary target question; non-primary questions are diagnostic only.
  - Correct L545-546 to carve out the identity-based `PENDING` exception (P1 §9.5, §10.4).
  - Add a short rationale for not adopting a trace-wide rule.
  - Record it as an owner-visible interpretation in the handoff.

**M-3. The §10.4 `CLEAR_WITHOUT_EDGE` rule is unimplemented, and a source-fact contradiction yields SUPPORTED.**
- **Status:** FIXED (TOKEN_REAPPEARED detection -> T0c, SC-C04, verdict withheld; CLEAR_WITHOUT_EDGE enforced as T1c; P1 §10.4/§10.4a; fixture token-reappears-after-clear; auditRaw RAW_TOKEN_REAPPEARED)
- **Location:** P1 §10.4 ("`CLEAR_WITHOUT_EDGE` gives `IDENTITY_AMBIGUOUS` for the cleared token in both modes"), §10.3/§6.3 ("a bound object that has left the slot never returns"); P2 `SC-C04`; `verdict.mjs` `gaps()`/`annotate()` (annotations never gate); I7 offline reading (NOTES 6).
- **Evidence:** probe `adv.mjs` A17 (plan A):
  1. the subject object is bound;
  2. it leaves the slot with no rise (a `CLEAR_WITHOUT_EDGE` gap);
  3. it reappears (`sx:"appear"`, `sb:` subject token);
  4. it is read at `t_d`.

  Result: integrity ok, `Q-SUBJ` `DEFINITE PENDING`, run `SUPPORTED`, audit `[]`. The trace contradicts a pinned source fact (only fresh objects are ever assigned: V:96698, V:96727), which should be `SC-C04` (stop, owner decision), and by P1 §10.4 the subject token is `IDENTITY_AMBIGUOUS`. The committed `gap-clear-without-edge` fixture passes only because the slot stays empty at `t_d`.
- **Failure scenario:** a live run on a page where some code (an extension, or a Viewer path outside `viewer3D.js`) re-assigns a retained slot object would report a definite `PENDING` instead of stopping on the broken source premise.
- **Recommended fix:**
  - Add a mechanical check: a token that reappears in a visible read after a visible read without it (offline-detectable, because a token binds exactly one object at CP02) is a new integrity or contradiction code mapped to `SC-C04` / verdict withheld.
  - Either implement the §10.4 `CLEAR_WITHOUT_EDGE` rule as a target-rule gate for the cleared token, or restate §10.4 to match "annotations never override the correlator".
  - Add a fixture.

**M-4. Control-trace terminal ordering in the runbook contradicts the envelope.**
- **Status:** FIXED (P2.02 now TZ targetEnd -> CT -> TZ final -> END; Appendix (iii) controlTraceOrder checked by the validator)
- **Location:** Part 2 §16 P2.02 ("write its `CT`, `TZ targetEnd`, `TZ final` and `END`"), applied to P2.03–P2.05; versus §12.4 L299, P1 I6, NOTES reading 10 and `fixtures-gen.mjs` `controlTrace` (`TZ targetEnd` → `CT` → `TZ final`).
- **Evidence:** text comparison. Codex spec-review Critical 1, verified. The validator raises `CT-PLACEMENT` for the P2.02 order.
- **Failure scenario:** an implementer follows the runbook literally, every control trace fails, `SC-B02` fires, and the consumed attempt is `INVALID`.
- **Recommended fix:** reword P2.02 to `TZ targetEnd → CT → TZ final → END` and encode the order in Appendix (iii).

**M-5. The hash-ledger and manifest closure is self-referential.**
- **Status:** FIXED (ledger lists files only, excludes itself and MANIFEST; META templates persisted as preflight/meta-template.*.json; manifest lists the ledger without ledgerSeq; manifest-builder + test)
- **Location:** Part 2 §13.4 ("one canonical JSON line per file"), §13.6 ("lists every file in the run root except itself"), Appendix (v) `files[].required` includes `ledgerSeq`; P1.04 ("append its canonical-bytes digest to the hash ledger", which is not a file).
- **Evidence:** text comparison. Codex spec-review Critical 3, verified. `raw/hash-ledger.jsonl` must appear in the manifest with a `ledgerSeq`, but the ledger cannot contain its own final digest.
- **Failure scenario:** implementations invent incompatible closure rules, and the Phase-5 ledger/manifest consistency check (V2) is ill-defined.
- **Recommended fix:**
  - Exclude the ledger and the manifest from ledger entries.
  - Give the ledger a manifest entry without `ledgerSeq`, its digest carried by `hashLedgerSha256`.
  - Persist the META template as a file (e.g. `preflight/meta-template.target.json`), or define a typed non-file ledger entry.

**M-6. `raw/teardown.json` is written twice under write-once rules.**
- **Status:** FIXED (P2.07 writes raw/control-disposal.json; raw/teardown.json written once at P4.05; validator PATH_WRITTEN_TWICE)
- **Location:** Part 2 §16 P2.07 ("record the disposals in `teardown.json`") and P4.06 ("Write `raw/teardown.json`"); §13.3 rule 1.
- **Evidence:** text comparison. Codex spec-review Important 4, verified.
- **Failure scenario:** P4.06 hits `EEXIST`, which is `SC-B07`, and a consumed attempt becomes `INVALID`.
- **Recommended fix:** use separate files (`raw/control-disposal.json`, `raw/teardown.json`), or a single write after the final cleanup.

**M-7. The Phase-0/Phase-5 negative-control registry omits NC-15…NC-21.**
- **Status:** FIXED (one ordered registry NC-1a..NC-21 incl. variants, Appendix (vii) selfTestRegistry, run at P0.06 and P5.03, digests bound via diagnosticPackageSha256)
- **Location:** Part 2 §16 P0.06 ("run `NC-1a`…`NC-14`"), §13.2 L412 (`negative-controls.phase0.json`: NC-1a…NC-14), versus §11.1 ("They run in Phase 0 … and again in Phase 5") and the NC-15…NC-21 rows in §11.3.
- **Evidence:** text comparison. Codex spec-review Important 1, verified. The prototype's offline matrix covers all of them.
- **Failure scenario:** a bound pipeline that mishandles `edgeInit`, late callbacks, recorder ordinals, compaction or unrepresentable projections passes the pre-consumption self-test.
- **Recommended fix:** define one ordered NC registry (NC-1a…NC-21, all variants), bind its digest and expected-result digest, and reference it from P0.06/P5.03 and §13.2.

**M-8. The target-plan schema and trace-to-plan conformance are not mechanical.**
- **Status:** FIXED (strict targetPlanSchema; derived maxRefreshHz/raw/projected bounds replace declared duration; Phase-5 planConformance -> INVALID TARGET_PLAN_NONCONFORMANT; fixture target-plan-nonconformant-missing-c8)
- **Location:** Part 2 §14.2 (`steps` has no schema; "declares its worst-case duration"), P0.08 ("validates it mechanically"), `SC-A07`/`SC-A16`; fixtures `steps: "synthetic: …"` (a string); the evaluator never checks that the trace executed the plan's steps.
- **Evidence:**
  - P0.08 cannot derive raw/projected counts or duration mechanically without a step schema.
  - Probe `adv3.mjs`: removing the subject `C8` from `valid-complete` (resealed) still gives integrity ok and `SUPPORTED`. Codex advisor finding 5, verified.
  - `C8` is never a target question, so the label is unaffected, but plan non-conformance (a missing step, an extra restore or fit) is undetected.
- **Failure scenario:** two implementations accept different plans, or trust an understated declared duration. A trace that deviates from the pre-registered sequence is evaluated as if it conformed.
- **Recommended fix:**
  - Add a strict `targetPlan` JSON schema (step variants, ids, settle roles, expected `C8`s).
  - Derive (not declare) the worst-case counts and duration.
  - Add a Phase-5 conformance check (each plan step ↔ its `RQ`/`RS`/`T4`/`C8` records) mapped to `INVALID`.

  This is primarily an implementation-plan requirement, but the spec must state it.

**M-9. Crash recovery is overclaimed, and no recovery/closeout protocol exists for a consumed attempt.**
- **Status:** FIXED (stop guarantee made conditional on the finalizer; separately owner-authorized offline recovery closeout specified in Part 2 §15)
- **Location:** Part 2 §15 L630 ("A stop after consumption always leaves a frozen evidence set and `raw/stop.json`"), §12.5 L325, `SC-B05`.
- **Evidence:** text. Codex spec-review Critical 5, verified as an overclaim. Process death cannot write `stop.json`, freeze, or commit.
- **Failure scenario:** the process is killed after `ATTEMPT_CONSUMED`. The journal stays consumed, no terminal verdict or commit exists, and the attempt is unrecoverable and unclassified.
- **Recommended fix:**
  - Make the guarantee conditional on the finalizer running.
  - Specify a separately authorized, offline-only recovery closeout that preserves partial bytes, classifies `TRUNCATED` → `INVALID`, and finalizes the journal/commit idempotently, never resuming live execution.

### Low

- **L-1. Control-trace run linkage is not enforced.** `META.run` of a control trace need not derive from the target run (spec: `<runId>-pc1`). Probe `adv3.mjs` gives `SUPPORTED` with controls relabelled `other-run`. The risk is mitigated because `ai`/`ah`/`ad` (authorization and attempt id) are bound per trace. Fix: validate `control.run === target.run + "-pcN"`. (Codex advisor finding 4.) Status: FIXED (control META.run must be <target run>-pcN, else INVALID CONTROL_RUN_NOT_LINKED; test).
- **L-2. Listener lifecycle wording.** P1 §7.1 (P-TC "Never removed") and Part 2 P1.02 ("never-removed … listener") conflict with removal at `FINALIZING` (P1 §8.6, P4.02). P4.02 `onFail SC-B04` versus `END.lr = 0` being non-verdict-changing (`SC-C02`). Fix: say "not removed during capture", and split the `TZ final` write failure (`SC-B04`) from listener-removal failure (`lr = 0`). Status: FIXED (P1 §7.1 and P1.02 say "not removed during capture"; P4.02 splits TZ final write failure SC-B04 from listener removal lr=0 SC-C02).
- **L-3. Unreproducible informational number.** Part 2 §12.4a L284 / Appendix (i) `atWorstCaseSizes: 5166592` cannot be reproduced: (24,576−512)·(204+1) + 512·(403+1) + 2,048 = 5,142,016. The cap conclusion is unaffected. Fix: correct or remove it. Status: FIXED (corrected to 5,142,016 B in §12.4a and Appendix (i) with its formula).
- **L-4. Incomplete CP08 rationale.** CP08 says "The `await sampleCamera()` microtask gap cannot admit a tick, because ticks are `setTimeout` tasks (V:17604)". Autocam steps after step 0 are rAF callbacks (V:107155). The conclusion still holds, because a microtask checkpoint runs after each rAF callback, but the rationale should name both task sources. Status: FIXED (CP08 rationale names both setTimeout ticks and rAF autocam steps).
- **L-5. Stale README.** The README status column says "planned" for `prototype/`, `fixtures/` and `results/`; the first two exist and `results/` does not. Fix: update it. Status: FIXED (README lists prototype/ and fixtures/ as written and results/ as generated by prototype/run-preparation.mjs).
- **L-6. No representation for a withheld verdict.** The withheld verdict (`SC-C03`/`SC-C04`) has no field in the Appendix (v) `terminalVerdict` enum or the §13.5 terminal schema. The prototype carries `verdictWithheld`. Fix: add an explicit field and say what the commit record contains in that case. Status: FIXED (TERMINAL-VERDICT verdictWithheld/withheldBy; commit record and manifest terminalVerdict WITHHELD).
- **L-7. Run-root and log handling.** No component-by-component `lstat` / no-follow rule is given for the run root, and no redaction or allowlist is given for `stdout.log`/`stderr.log`, which §13.3 rule 7's privacy rule does not cover. This is an implementation-plan requirement; state it. (Codex spec-review Important 5.) Status: FIXED (§13.3 rule 8: per-component lstat/no-follow and stdout/stderr allowlist, as implementation-plan requirements).
- **L-8. `null` rule conflict.** §12.2 rule 1 ("no `null`", applied to documents too) conflicts with §13.5 `stopCondition: null` and the prototype output. Fix: restrict rule 1 to trace records, or omit absent fields in documents. (Codex spec-review Critical 4, downgraded: hashing is unaffected, because the committed canonicalizer serializes `null` deterministically.) Status: FIXED (§12.2 rule 1 limits the no-null rule to trace records; documents may carry schema-declared nullable fields).
- **L-9. Weak audit gates.** The `noAmbiguousPositive` gate is circular: `ambiguous` is derived from each scenario's own expected verdict. `auditResult` checks neither the plan digest, nor the external gate booleans, nor run linkage. The `metaTemplate` binding check (§12.6 step 4) runs only when a template is passed, and `evaluateScenario` never passes one. Fix: extend `auditResult` as H-1/M-1/L-1 are fixed, and pass the frozen template. Status: FIXED (auditResult adds auditInputs and a withheld-positive check; evaluateScenario passes supplied META templates; noAmbiguousPositive re-derived; fixtures do not carry templates, a unit test covers it).
- **L-10. Process items before the gate.** `docs/handoffs/latest.md` has not been updated for this package, and the deterministic digests (§1, row 5) are not recorded in the package or handoff, as prompt §21/§25 require. Status: DOCUMENTED (handoff and results/ are outside this package-only remediation pass and are left to the orchestrator; fresh deterministic digests are in the Remediation pass section below).

## 4. Codex findings: disposition

| Codex item | Codex severity | Disposition |
|---|---|---|
| Review C1 control-trace ordering | Critical | accepted as M-4. It is a runbook prose list contradicting the normative §12.4 and the prototype, and it fails closed, so not Critical |
| Review C2 freeze/teardown/commit order | Critical | accepted as H-2 |
| Review C3 ledger self-reference | Critical | accepted as M-5 |
| Review C4 `null` vs canonical | Critical | accepted as L-8. No hash or verdict impact |
| Review C5 crash recovery | Critical | accepted as M-9. An overclaim plus a missing protocol; no false verdict |
| Review I1 NC-15…21 not in P0.06 | High | accepted as M-7 |
| Review I2 target-plan schema | High | merged into M-8; the provenance half is H-1 |
| Review I3 listener lifecycle | High | accepted as L-2 (wording) |
| Review I4 `teardown.json` | High | accepted as M-6 |
| Review I5 paths/logs | High | accepted as L-7 (implementation-plan requirement) |
| Review Q4 PC-2 dual slot-window correlation | question | verified (`controls.mjs:94-95`): it is control-only and never feeds a target verdict, as §11.2/§12.7 say. Kept as a note: §12.7 "Configuration" could state that PC-2 also runs `ASSUME` irrespective of `META.sw`. No finding |
| Advisor 1 non-primary ambiguity ignored | — | folded into M-2. Not a soundness defect; the spec states the primary-only rule (L570) |
| Advisor 2 pre-motion/gap + `PENDING` | — | folded into M-2. `PENDING` is identity-sound (§2.4) |
| Advisor 3 `ncRerunOk`/`ledgerOk` fail-open | — | accepted as M-1 (reproduced) |
| Advisor 4 control run id | — | accepted as L-1 (mitigated by attempt-id binding) |
| Advisor 5a plan digest unchecked | — | accepted as H-1 (reproduced independently) |
| Advisor 5b `C8` absent | — | merged into M-8 |
| Advisor 5c `C8` numeric ambiguity with `SUPPORTED` | — | rejected as a defect. By design `C8` is never a target question (P2 §11.3 NC-14; P1 CP14) |

Both Codex requests completed (exit 0). No Codex task remains running.

## 5. Owner-boundary compliance

- **Working tree:** `git status --short --untracked-files=all` lists only `docs/prompts/for-claude-g2-future-live-diagnostic-design-preparation-package.md` and files under `docs/research/2026-10-06-g2-live-diagnostic-preparation/`, plus this review file once it is written. `git diff --stat` and `git diff --cached --stat` are empty, so no tracked file changed. That covers immutable historical evidence under `docs/research/evidence/`, the committed D2 and diagnostic-instrumentation packages, the handoff, the procedure and the harness.
- **HEAD:** `f3bab74f460eacd6b6f69bc8fb90110455ceeb68` = `origin/main`.
- **Pinned digests:** harness SHA-256 `cc8868cd68b9c2c3382297070289a2aa165c74249c6d82896d76bacc6c6ef09b` and procedure SHA-256 `d1ccfde224b8ae76fe74b06c93abc532e6df9612933cafaa045053c8e2e45a75`, both unchanged.
- **Authorization state:** there is no active authorization record. No line beginning `G2-LIVE-EXECUTION:` was added anywhere. The candidate set is unchanged (three historical records).
- **No owner-only act was performed** by the package or by this review: no Viewer, browser, Playwright or live diagnostic; no G2 acceptance or retry; no authorization record; no attempt reset; no procedure, acceptance-contract, T4, C6/N2, C8, production or harness runtime change; no G3 or milestone transition; no commit or push.
- **Scratch outputs:** all go to the session scratchpad, except the package's own determinism test, which used the OS temp directory and deleted it.
- **Owner decisions:** OD-1…OD-8 are recorded and none is decided. B authorizes nothing.

## 6. Verdict on readiness for independent Work review

**Ready after fixes.** The following must be fixed, within the package and without crossing any owner-only boundary, followed by a targeted re-review of the changed areas:

- **2 High:** H-1 (target-plan provenance and digest binding) and H-2 (finalization and commit order);
- **9 Medium:** M-1 to M-9;
- **L-10:** the handoff and deterministic-digest record.

The other Low findings may be fixed or documented. The core design does not need to be reopened. Source fidelity, the minimum set, the capture points, the pre-motion and gap mechanisms, the caps arithmetic, the authorization-format analysis, runbook non-execution, determinism, the committed conclusions and live-worthwhile verdict B all hold.

Counts: **0 Critical / 2 High / 9 Medium / 10 Low.**

## Remediation pass

- **Scope:** files under `docs/research/2026-10-06-g2-live-diagnostic-preparation/` only, plus the Status lines above. Part 1 contract v5, Part 2 contract v4 (Part 1 §12.2, Part 2 coordination item 12, `prototype/NOTES.md` "Remediation of the package internal review"). No Viewer, browser, Playwright, live harness, G2 retry, authorization record, attempt reset, handoff edit, commit or push. Committed conclusions unchanged: `OPEN` 2/13, assumption 3/13, 3/13 sound, `NV` 406 B, 2,048 configurations with 0 wrong labels, 5,063, gap fail-closed, C8 unresolved, C6 `NOT_EVIDENCED`, T4 unchanged.
- **Dispositions:** H-1, H-2, M-1…M-9 and L-1…L-9 FIXED; L-10 DOCUMENTED.
- **Fixtures:** regenerated with `node prototype/fixtures-gen.mjs --write` (182 files, 70 scenarios; plans now structured, one per executed shape; 5 new scenarios). Every pre-existing scenario keeps its expected verdict and reasons.
- **Verification:** `node --test prototype/*.prep-test.mjs` → tests 113, pass 113, fail 0. `node prototype/fixtures-gen.mjs --check` → identical (182 files). `node prototype/run-preparation.mjs --out <scratch>/runA` and `/runB` → both exit 0, 13/13 gates PASS, `scenarios=70 verdicts={"INCONCLUSIVE":14,"INVALID":47,"BLOCKED":1,"SUPPORTED":7,"REJECTED":1}`; `diff -r` and log diff identical (187 files); `results.json` `cb51b655d89ab339d77beca17dc5118ae4196db2bab49ecc22899c09d7824797`, `SHA256SUMS` `f9987fb09f032fae146716f9d509e1af671cc69dfb8a8a97e680b48a516d2d2c`. No timestamps or absolute paths in the outputs.
- **Targeted re-review:** Codex `codex-advisor medium` (request `20261006-113157-35625-8087`) on the changed areas only. It confirmed the standard counter-examples now fail closed (plan swap, non-true gates, token reappearance, non-DEFINITE primary, missing planned C8) and reported 5 further defects, each verified against source and fixed: (1, High) the pre-publication verdict gate required a manifest that did not yet exist, so `ledgerOk` now covers only the raw-set hash chain and a fail-closed post-publication check (P5.10; failure means commit record `INVALID`) precedes the freeze and commit; (2, Medium) an unknown trace role bypassed the every-`META.tq` rule, so unknown roles are now `INVALID UNKNOWN_TRACE_ROLE` and the digest check covers every supplied trace; (3, Medium) a generic `SC-C04` stop withheld but stayed `SUPPORTED`, so it now applies T0c to every target; (4, Low) the V5 row omitted T0c/T1c, now added; (5, Low) `noAmbiguousPositive` now re-checks plan binding, gates and control linkage via `auditInputs`. Regression tests were added for each. No further Codex round was run, because the fixes were direct.
- **Left open:** L-10 (handoff update and `results/` generation, which belong to the orchestrator).


## Addendum: SC-C03 bounded correction (targeted internal review)

- **Authority:** owner prompt `docs/prompts/for-claude-g2-live-diagnostic-sc-c03-bounded-offline-correction.md`; independent finding M1 (+ L1, L2). Baseline `f3bab74f460eacd6b6f69bc8fb90110455ceeb68`.
- **Reviewer:** Codex `codex-advisor high` (request `20261006-141936-93219-14305`), targeted at the 10 owner-listed points; no unrestricted re-review.
- **Result:** 0 Critical / 1 High / 2 Medium / 1 Low. The normal SC-C03 path (A/B unchanged, promotion blocked, deterministic closeout, P5.12 consistent, no stale P5.11 commit-record reference, accepted design and owner boundary preserved) was confirmed sound.
- **H (FIXED):** the simulated commit record cached `manifestSha256` before P5.10 and could bind a tampered manifest on the INVALID path. It now hashes the frozen manifest bytes; regression test added (3 failure paths).
- **M (FIXED):** Appendix (v) `terminalVerdict` rule now states the post-P5.10-failure exception (commit `INVALID` is authoritative; commit `manifestSha256` is always the frozen manifest's hash).
- **M (FIXED):** the global null rule (Appendix (i) `nullAllowedScope`) now includes `SC-C03-CLOSEOUT.json` `promotion.promotedAnalysis` / `authoritativeAnalysis`.
- **L (DOCUMENTED):** §13.5 now says the scenario evaluator's `withheldBy: "SC-C03"` is an effect model of the scenario table, never `TERMINAL-VERDICT.json` bytes. `verdict.mjs` is unchanged.
- **Noted, not in scope:** P5.10 does not cross-check manifest identity fields (`runId`) against the closeout; not required by the spec, left as a possible implementation-plan requirement.
- **Sandbox note:** the reviewer's full-suite run saw 2 sandbox `EPERM` temp-dir errors; the same suites pass 146/146 here.
- **Unresolved in-scope Critical/High/Medium:** none.
