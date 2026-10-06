# G2 Diagnostic Instrumentation Research-to-Ready Package — Independent Review

- **Date:** 2026-10-05
- **Repository:** `aps-viewer-clash-detection`
- **Reviewed baseline:** `main == origin/main == 06980ee1e17b1268d4028ed9951c5f8462016cd2`
- **Package:** `docs/research/2026-10-05-g2-diagnostic-instrumentation-*`
- **Verdict:** **bounded correction required before checkpoint commit/push**
- **Findings:** **0 Critical / 1 High / 2 Medium / 2 Low**

## 1. Scope and repository state

This review used the repository, committed D0/D1/D2 artifacts, immutable historical G2 evidence, the current G2 harness, the retained Viewer 7.124.2 source bytes, the package source/tests/results, and the package internal review as the sources of truth.

Verified before review:

- branch, `HEAD`, `main`, and `origin/main` all resolve to `06980ee1e17b1268d4028ed9951c5f8462016cd2`;
- committed harness SHA-256 is `cc8868cd68b9c2c3382297070289a2aa165c74249c6d82896d76bacc6c6ef09b`;
- accepted procedure SHA-256 is `d1ccfde224b8ae76fe74b06c93abc532e6df9612933cafaa045053c8e2e45a75`;
- historical G2 remains `FAIL (row 3)`, C6 remains `NOT_EVIDENCED`, and C8 remains unresolved;
- the only tracked modification at review start was `docs/handoffs/latest.md`; the package and prompt files were untracked;
- no package change touched the committed harness, accepted procedure, immutable evidence, D2 checkpoint, `src/`, `test/`, or `scripts/`;
- no Viewer/browser/live run, retry, authorization issuance, or attempt reset was performed by this review.

## 2. Findings

### High H1 — the version-bound guard can be enabled by schema-valid metadata from the wrong Viewer version

**Location:** specification §6.1.3 and §6.3 C6; `schema.mjs` `validateMeta`; `correlate.mjs` `applyVbGuard`.

The specification says VB-0 is the exact Viewer 7.124.2 guard and C6 fails closed. The reference schema validates `vv` only as a short string, validates `vg` independently as `0|1`, and does not require `vg === 1` to imply `vv === "7.124.2"`. `applyVbGuard` then trusts `vg` and never reads `vv`.

Independent reproduction:

- `META.vv = "7.125.0"`, `META.vg = 1`, and all `vb` rows `1` passes `validateMeta` with no errors;
- with `END.pc["VB-3"] = 1`, `applyVbGuard` enables both `V-PEND` and `V-EDGE`.

This contradicts the fail-closed version-bound contract. A future trace reader could accept a self-contradictory record and apply 7.124.2-only semantics to another build. The current offline D2 results are unaffected because they do not use live `META`/`END`.

**Minimum correction:** make the live guard derive eligibility from the observed version, not a trusted bit. Require and test at least:

- `vg === 1` only when `vv === "7.124.2"`;
- any other/absent/ambiguous `vv` forces `vg === 0`, every `vb` row `0`, and no VB atom enabled;
- contradictory `vv`/`vg`/`vb` metadata is whole-trace malformed or otherwise cannot enable a VB atom.

This is blocking for checkpointing a package described as research-to-ready.

### Medium M1 — the “minimum sufficient diagnostic set” is not minimal; `P-XS` is demonstrably redundant

**Location:** specification §8.6; research §9; handoff “Minimum instrumentation recommendation.”

The package now qualifies the set as a “candidate minimum” and discloses that its five non-base atoms were not ablated. That avoids an unqualified mathematical claim, but it does not complete the authorized prompt's request for the smallest useful instrumentation footprint.

I independently enumerated all 52,308 D2 schedules and compared the sound correlator over all 40,788 relevant schedules with the proposed bundle and with each non-base atom removed. Removing only `P-XS` preserved the full bundle's results exactly:

| Mode | Bundle | Q-OWNER definite/wrong | Q-SUBJ definite/wrong | Q-ATTR definite/wrong |
|---|---|---:|---:|---:|
| `OPEN` | full | 2,608 / 0 | 17,935 / 0 | 0 / 0 |
| `OPEN` | without `P-XS` | 2,608 / 0 | 17,935 / 0 | 0 / 0 |
| assumption | full | 35,725 / 0 | 35,725 / 0 | 40,788 / 0 |
| assumption | without `P-XS` | 35,725 / 0 | 35,725 / 0 | 40,788 / 0 |

`P-FRM` is not similarly redundant for the fail-closed `OPEN` result: removing it reduces definite ownership from 2,608 to 0 because the restore's own post-call read disappears. `P-TC`, `V-PEND`, `V-EDGE`, and `ID-ON` each protect a distinct question or attribution boundary. The package is therefore correct to call the bundle non-ablated, but incorrect to present the current contents as the best available minimum recommendation after the experiment.

**Minimum correction:** add the sound-correlator ablation to the deterministic experiment/tests and revise the recommended bundle to drop `P-XS`, unless a separately stated live requirement demonstrates unique value not represented by the modeled questions. Keep the “3 of 13” and D2-only limitations.

### Medium M2 — live trace integrity is not fully specified or mechanically validated across records

**Location:** specification §6.1.3 and §6.3 live-entry requirement; `schema.mjs` `validateEnd`; `bounds.mjs` `LiveTraceRecorder`.

The recorder itself constructs internally consistent `END` values, and the correlator validates event order. The evidence-reader contract is weaker: `validateEnd` checks field types plus `iv <= rj`, while the live-entry requirement only mandates fail-closed handling for missing `END`, `truncated`, `overflow`, and `iv > 0`.

It does not require a reader to verify that:

- `END.ne` equals the actual number of accepted data records;
- `END.nb` equals their canonical byte count;
- `END.f`/`tm` are at or beyond the last data event;
- `nvn`/`nvx` agree with the retained `NV`/sample population;
- `META.cp` is the complete expected cap set and matches the caps actually enforced.

A contradictory but type-valid `END` can therefore pass the reference validator. This does not affect the retained offline results, but it leaves a false-confidence path in the future live evidence design.

**Minimum correction:** specify a whole-trace integrity validator, use it before correlation, and add mutation tests for every cross-record count/order/cap mismatch. The live plan may implement it, but the required invariants belong in this specification so a plan cannot omit them.

### Low L1 — the post-capture VB-3 positive control is correctly gated but not yet representative evidence

The corrected control runs after capture, so it does not alter the historical starting condition being measured. It proves only that the pinned session can produce a true/false VB-3 edge for the control action after capture. It does not prove that the listener was effective throughout the capture, that the captured historical path emitted every edge, or that the control's fit is representative of the failing path.

The package explicitly records representativeness as a future live verification gate and does not use the control as historical proof. This is non-blocking for offline checkpoint semantics, but any live design must retain bounded control evidence and define why the control is representative or use a disposable same-build session.

### Low L2 — no final full internal review was run after targeted remediation

The internal review history is accurately reported: round 1 found `0C/2H/6M/6L`; the targeted re-review found `0C/0H/4M/4L`; the recorded High/Medium items were remediated. The targeted checks are substantive and the absence of another unrestricted internal pass is not itself blocking under the repository convergence rules. This independent full review supplies the missing broad gate and found H1/M1/M2 above.

## 3. Verification results

| Gate | Independently verified result |
|---|---|
| Diagnostic tests | **44/44 pass** |
| D2 tests | **55/55 pass** |
| Offline suite | **5,155 total / 5,154 pass / 0 fail / 1 existing todo** |
| Fresh diagnostic run A | exit 0; digest `d64d1535d91453f9124583d9e734cbd7a75fbaf1c1f1b4407a100bb2ea7332fe` |
| Fresh diagnostic run B | exit 0; same digest |
| Byte comparison | A = B = retained `results/` for both files |
| Retained file SHA-256 | summary `8bdc0cf5…9946`; witnesses `83548e8b…f0d3` |
| D2 output digest | `e1d1b815ed351e6feba3e34822ba9895e54035158e685bfbe7f628f6d10bbb06` |
| `git diff --check` | clean before review writes |

The first aggregate run inside the restricted review sandbox failed only where tests attempted repository-local temporary writes and localhost binds. The same command under normal repository test permissions passed with the expected counts. No Viewer or browser was launched.

## 4. Research-fidelity and public-only verdict

The research faithfully separates synthetic mechanical possibility from historical causality. It preserves all important distinctions from D0/D1/D2:

- pre-motion, completion-to-next-consumption, restore/outstanding-request, sub-epsilon/quiet-tail, request-correlation, camera-write ownership, and observation-timing gaps remain separate hypotheses;
- public + harness-tagged schedule separation is explicitly a closed-world fingerprint result;
- historical C8 is never reclassified from the synthetic output.

The 40,788 population is the union of the five relevant D2 result classes (`OWNED`, `STALE_PRIOR_TERMINAL`, `STALE_RESTORE`, `STALE_INIT`, `STALE_IN_FLIGHT`) across the four cells. All nine named configurations yield one projected block per relevant schedule in D2, so every label is a function of the projected trace. That is possible because D2 is deterministic, jitter-free, two-request, and has no foreign writer; per-frame event order reconstructs the synthetic timeline.

This does **not** transfer to a live Viewer. The sound correlator does not fingerprint schedules. Under the public + harness-tagged tier it emits 0 definite owner labels, 0 definite subject labels, and 0 definite attribution labels. That result is vacuous for the public tier alone, but the correlator soundness test is not globally vacuous: the version-bound runs emit tens of thousands of definite labels and still report 0 wrong.

**Verdict:** public + harness-tagged observables are sufficient only for closed-D2 separability, not for sound live attribution.

## 5. Correlator, ambiguity classes, and instrumentation

The correlator is conservative and total on its declared input:

- malformed event/configuration input becomes whole-question `UNDIAGNOSABLE(MALFORMED)`;
- missing atoms produce unavailable/ambiguous outcomes rather than inferred identity;
- contradictions in frame/time, edge order, settle order, and frustum binding fail the whole trace;
- the default slot-window mode is `OPEN`; assumption-derived labels are explicitly tagged;
- a hand-built normal-consumption/foreign-overwrite pair proves the slot-window ambiguity is real.

The **5,063** residual assumption-mode ambiguities are independently consistent with the output: 454 + 213 + 2,310 + 2,086, all `ACTIVE_WITHOUT_VISIBLE_STEP`, all ground-truth `ACTIVE0` (DH-1/pre-motion). VB-1 and VB-3 cannot distinguish “active but no visible step yet” from an unobserved zero-change step. A direct camera-write/step owner or readable transition progress could add information, but Viewer 7.124.2 exposes neither as a safe public/read-only request-correlated witness. O-10/O-11-style access would be private/invasive and crosses the owner-only diagnostic boundary.

The pending-clear gap is source-supported: Viewer 7.124.2 clears `__destinationView` in `ViewingUtilities.update` before `Autocam.animateTransition` raises the transition-active flag. The `OPEN` correlator correctly refuses to infer the consumed token across that gap. This is acceptable for a conservative future diagnostic, but it means the proposed safe observables cannot provide terminal/in-flight ownership or completion attribution. Resolving it would require an atomic consumption witness that 7.124.2 does not expose read-only.

**Minimum-set verdict:** VB-1, VB-3, harness identity, and formal completion each have a demonstrated role, and `P-FRM` is needed for the current fail-closed restore-owner result. `P-XS` is redundant in the modeled sound-correlator bundle. The recommendation is a minimum only after that bounded correction and only for the three modeled questions, never universally.

## 6. Viewer 7.124.2 source fidelity

The retained scratch bundle exists and independently hashes to:

`12b9fe49f41dc99ccec62535e5c887da915980829da2e941cfe4da3d7197c02e`

matching the package and D0. Direct source inspection confirmed:

- each `setRequestTransition*` call writes a fresh plain destination object into `__destinationView`;
- `getRequestTransition()` returns that single pending slot;
- `ViewingUtilities.update` clears the slot before calling `transitionView`;
- `setTransitionActive` emits `TRANSITION_ACTIVE_FLAG_CHANGED` only on an actual flag change;
- `Autocam.animateTransition` raises the flag at transition start and clears it before completion callback.

VB-1 and VB-3 semantics are therefore source-faithful for 7.124.2. They remain undocumented/version-bound and are not stable public APIs. Any production or accepted-procedure dependency requires procedure re-acceptance. The package respects that boundary.

## 7. Schema, fail-closed behavior, and output bounds

The event schema is well motivated by the research and distinguishes public, version-bound, harness-tagged, and synthetic fields. Request identity is harness-owned; pending identity and active edges are version-bound; writer ownership stays synthetic/unavailable. The numeric sample, decision, completion, restore, and frustum-binding fields map to explicit questions rather than speculative logging.

Bounds are deterministic and covered at the boundary and cap+1:

- offline: 1,024 events/trace, 160 B/event, 163,840 B/trace, 16 retained traces, no retained numeric poses, and 4 MiB total output;
- future-live reference: 8,192 data events, 256 B ordinary events, 400 B `NV`, 2,457,600 B trace, 512 numeric samples, 32 excerpts, 64 settle samples, and a 2,048 B `META`/`END` reserve.

No output contains wall-clock timestamps, local absolute paths, model data, credentials, or unbounded camera arrays. Retention is deterministic. Future live evidence is described as new evidence and does not mutate the immutable historical G2 record.

Fail-closed behavior is accepted for event validation, ambiguity, contradiction, overflow, truncation, unavailable VB rows, and uncertainty, subject to H1 and M2. No ambiguous case in the tested offline path becomes a positive attribution.

## 8. Internal review/remediation and protected boundaries

I checked the implemented fixes rather than relying on the review summary. The correlator totality, `OPEN` default, capture-start baseline, unread-restore rule, post-capture positive control placement, VB row/positive-control guard, own-property schema checks, recorder-before-mutation behavior, deterministic staged output, and targeted tests are present and pass.

Protected-boundary verdict: **accepted**. Harness/procedure hashes are unchanged; committed evidence and D2 remain unchanged; package work is confined to `docs/research/`, `docs/reviews/`, `docs/prompts/`, and the handoff. No G3 or runtime implementation work appeared.

## 9. Historical interpretation and next gate

This package establishes an offline result only:

- public + harness-tagged traces can fingerprint every relevant D2 schedule, but cannot soundly attribute the live Viewer path;
- guarded VB-1/VB-3 add unique sound information for pending state and some restore/initial ownership;
- safe read-only observables still cannot identify the consumed slot object or distinguish all pre-motion/zero-change cases;
- historical C8 remains unresolved, C6 remains `NOT_EVIDENCED`, real T4 is unchanged, and historical G2 remains `FAIL (row 3)`.

A future live diagnostic could add unique runtime information about actual pending-slot and active-edge behavior. The package does **not** establish that such a run would resolve historical C8, and it shows that the current safe observable set cannot answer the critical consumption/pre-motion cases completely. No live work should be authorized from this review.

## 10. Checkpoint and recommended next action

**Checkpoint readiness:** **bounded correction required**. Do not commit/push this package yet.

**Exact next bounded owner action:** authorize one offline-only correction package that:

1. binds VB-0 mechanically to `vv === "7.124.2"` and tests contradictory version metadata fail-closed;
2. adds exhaustive sound-bundle ablation, removes `P-XS` from the minimum recommendation if results remain unchanged, and regenerates deterministic results/docs;
3. specifies and tests whole-trace `META`/data/`END` integrity before correlation;
4. runs the same 44 diagnostic tests (updated count expected), 55 D2 tests, offline suite, two-run determinism, and a targeted independent re-review.

Viewer/browser/live diagnostics, G2 retry, authorization issuance/reset, harness/product/procedure/runtime changes, and G3 remain owner-only and unauthorized.
