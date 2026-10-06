# G2 future live diagnostic: preparation spec, Part 2 (controls, envelope, evidence, verdict, stop conditions, runbook, authorization binding, live-worthwhile decision)

> **Status and limits. Read these first.**
> - **Design only.** Nothing in this part has been executed. No Viewer, browser, live diagnostic, G2 acceptance run, G2 retry, authorization-record issuance or attempt reset has happened, and none is authorized. Every runbook step in §16 is **NOT EXECUTED**.
> - **Scope split with Part 1.**
>   - This part covers sections §11–§17 and §22 of the owner prompt `docs/prompts/for-claude-g2-future-live-diagnostic-design-preparation-package.md`.
>   - Part 1 (`spec-part1-questions-instrumentation-capture.md` in the same directory) covers §5–§10: questions, instrumentation, capture points CP01…CP15, record kinds, data-record fields **and their wire keys**, pairing invariants I1–I7, settle roles, the recorder lifecycle, the target-window boundary read (`edgeInit`), the sample bound, the projection, pre-motion, and the pending-clear gap. This part refers to those by ID.
>   - **Part 1 is authoritative for data-record kinds, fields, wire keys (Part 1 Appendix `wireKeys`, the single source) and the projection.** Part 2 is authoritative for `META`, `END`, caps, controls, evidence, verdicts, stop conditions, the runbook and authorization binding.
>   - **Reconciled** with Part 1 contract version 5 (this file: contract version 4). Contract versions 5/4 remediate the internal review `docs/reviews/2026-10-06-g2-live-diagnostic-preparation-internal-review.md` (coordination item 12); versions 4/3 remediated the spec findings reported by the offline prototype builders (coordination item 11). The earlier reconciliation (P1 v3 / P2 v2) changed Part 2's wire keys to Part 1's, replaced the committed schema-1 caps by derived schema-2 caps (§12.4a), added `META`/`END` fields for `edgeInit`, the boundary read, the sample bound and the recorder lifecycle, added controls `NC-15`…`NC-21`, and resolved CI-1/CI-2 (see "Contradictions, tensions and coordination items").
> - **No acceptance change.** This part is not an acceptance-procedure amendment. It does not change:
>   - the accepted G2 procedure (SHA-256 `d1ccfde224b8ae76fe74b06c93abc532e6df9612933cafaa045053c8e2e45a75`);
>   - the committed harness (SHA-256 `cc8868cd68b9c2c3382297070289a2aa165c74249c6d82896d76bacc6c6ef09b`);
>   - the authorization-record format;
>   - real T4/C6/N2/C8 runtime behaviour;
>   - any production code.
> - **Committed conclusions, restated and unchanged.**
>   - Schema versions: diagnostic summary `schemaVersion` 3; witnesses `schemaVersion` 2.
>   - Bounds and counts: `NV` limit 406 B; all 2,048 configurations have 0 wrong labels; public-only sound definite owner/subject/attribution labels = 0; residual 5,063 `ACTIVE_WITHOUT_VISIBLE_STEP`/`ACTIVE0` schedules.
>   - Instrumentation: the pending-clear → active-edge gap is fail-closed; the unique two-window minimum is `ID-ON + P-FRM + P-TC + V-PEND + V-EDGE`.
>   - Coverage: `OPEN` answers 2/13 questions, assumption mode answers 3/13, and only 3/13 have any sound procedure.
>   - Historical status: G2 `FAIL (row 3)`; C6 `NOT_EVIDENCED`; historical C8 **unresolved**; real T4 unchanged; the post-capture VB-3 control is **not** historical evidence.
> - **Baseline:** `main` @ `f3bab74f460eacd6b6f69bc8fb90110455ceeb68`. The committed diagnostic spec `docs/research/2026-10-05-g2-diagnostic-instrumentation-spec.md` (SHA-256 `385993ba1b5bdb30687ab3235c01f651bca5be2690e5ccdfa6fecd9ed7be594e`) is cited as "DS §n". Part 1 is cited as "P1 §n".

---

## 0. Conventions and coordination with Part 1

**Vocabulary (agreed with Part 1).**
- **Questions.** P1 §6 uses the committed question names. `Q1`…`Q13` follow the committed fixed order of `observer.mjs` `QUESTIONS`: Q1 `Q-STALE`, Q2 `Q-OWNER`, Q3 `Q-SUBJ`, Q4 `Q-ACTIVE`, Q5 `Q-RESTORE`, Q6 `Q-DH1`, Q7 `Q-DH2`, Q8 `Q-DH3A`, Q9 `Q-DH3B`, Q10 `Q-DH4`, Q11 `Q-DH7A`, Q12 `Q-ATTR`, Q13 `Q-TUPLE`.
  - Only `Q-OWNER`, `Q-SUBJ` and `Q-ATTR` have a sound procedure (DS §6.3 C1).
  - The other ten always return `UNDIAGNOSABLE(NO_SOUND_PROCEDURE)`.
- **Capture points** are `CP01`…`CP15` (P1 §8.2).
- **Record kinds.** Data kinds are `RQ`, `PS`, `TE`, `FS`, `T4`, `RS`, `CE`, `TC`, `C8`, `CT` and `TZ` (P1 §8.1). Envelope kinds are `META` and `END`. The committed numeric companion `NV` keeps its committed keys and its 406 B cap and immediately follows the `T4` sample it encodes.
- **Settle roles** (P1 I4): `S` subject (exactly one per target trace), `G` non-subject never-deciding settle (at most two), `P` supersession settle measured by the superseded `C8` (at most one); settles are sequential.
- **Minimum set** is `ID-ON`, `P-FRM`, `P-TC`, `V-PEND`, `V-EDGE` (plus base `H-CALL`, `H-T4`). `CE` (`P-CC`) is **not captured** in the minimum (P1 CP12).
- **Diagnostic verdicts** are `SUPPORTED`, `REJECTED`, `INCONCLUSIVE`, `INVALID` and `BLOCKED`.
  - They describe a new run only.
  - They are never acceptance verdicts and never `PASS`/`FAIL`.
  - They never claim anything about the historical run R1.
- **Control outcomes** are `PASSED`, `FAILED` and `NOT_RUN` (P1 `controlOutcome`). They are not acceptance verdicts.

**Trace schema version.** The future live trace uses **trace schema 2** (`META.sv = 2`), versioned separately from the committed live trace schema 1 (DS §6.1.3; `schema.mjs` `SCHEMA_VERSION = 1`).
- The committed schema-1 validator rejects every schema-2 trace with `SCHEMA-VERSION-UNSUPPORTED`. This is intended fail-closed behaviour; nothing committed changes.
- Trace `sv` is unrelated to the diagnostic **summary** `schemaVersion` 3 and the witnesses `schemaVersion` 2. Neither of those changes.

**Reuse rule.** All correlation uses the committed correlator unchanged:
1. A schema-2 trace is validated (§12.6).
2. It is projected onto committed schema-1 live events by P1 §8.3 (including `edgeInit` handling, long-settle compaction, `q` stamping and the representability check).
3. It then passes through the committed C6 guard (`applyVbGuard`) and `correlate(…, {mode: 'live'})`.

No R1–R8 rule, reason code or precedence is redefined here.

---

## 11. Control matrix

### 11.1 Where controls run

The committed design forbids a control run in the same session **before** capture, because a pre-capture fit would change the starting pose and the fit history (DS §6.1.3 "Capture order"). Prompt §16, however, places controls (Phase 2) before the target (Phase 3). The two are reconciled as follows:

- **Phase 2 positive controls** (`PC-1`, `PC-2`, `PC-4`, `PC-5`) run only in a **separate, disposable Viewer instance**. It is a separate browser context with the same pinned bundle (VB-0) and the same fixtures, which is the alternative DS §6.1.3 explicitly permits.
  - **Each control writes its own control trace** (`META.rl` = the control id), because P1 I4 allows `deciding = 1` at most once per trace.
  - **Each control runs in its own fresh page** (a fresh disposable browser context per control), because P1 §8.6 allows one recorder per page load. A recorder never sees listeners left by an earlier control.
  - Every control trace obeys the same envelope, P1 invariants and `edgeInit` boundary read as the target trace. A control trace with `META.ei = "UNKNOWN"` makes that control `FAILED`.
  - The disposable contexts are disposed of before Phase 3. They never share a page, context or Viewer object with the target instance.
- **`PC-3`** is the committed post-capture VB-3 control. It runs in the target instance, in the **control window** between `TZ{tzPhase:"targetEnd"}` and `TZ{tzPhase:"final"}` (P1 I6). Its result goes to `END.pc`.
- **Negative controls** (`NC-*`) are offline fixtures. They run through the exact validator, projection, correlator and verdict evaluator that the authorization binds by digest.
  - They run in Phase 0, before any live step (self-test, P0.06), and again in Phase 5 (rerun, P5.03). Both runs use **one ordered registry**: `NC-1a` … `NC-21` with every variant named in §11.3 (Appendix (vii) `selfTestRegistry`). Its registry digest and expected-results digest are package contents, so `diagnosticPackageSha256` binds them, and both are recorded in `preflight/negative-controls.phase0.json` and `derived/negative-controls.phase5.json`.
  - Some negative conditions can also occur live. Those are handled as stop conditions (§15).

### 11.2 Positive controls

The patterns below use P1 record names:
- `RQ` and `RS` are pre/post pairs.
- A `PS` follows every host read (P1 I3).
- `T4` has start, sample and decision records.
- `k` is the harness-tagged `reqToken`.
- B1, B3 and the quiescence budget are frame budgets. The implementation plan fixes them and the authorization binds them (§17, `controlRequirements`).

| ID | Purpose (prompt §11) | Where | Expected trace pattern | Expected control result | Effect on diagnostic verdict | A control failure invalidates |
|---|---|---|---|---|---|---|
| `PC-1` | known request that becomes transition-active | disposable fresh page, Phase 2, own trace, quiescent start (`META.ei = "LOW"`) | `RQ pre{k=1, slotPresent:0, slotDelta:"none"}` → `RQ post{k=1, callOutcome:returned, slotPresent:1, slotDelta:"appear", slotNew:1, slotBinding:1}` (adjacent, I1, I7) → 0 or more `PS{slotBinding:1}` → `TE{edgeValue:1,payloadActive:1}` within B1 → at least one `FS` whose `camClass` differs from the last class before the rise → `TE{edgeValue:0}` → `TC` at `seq = fall.seq + 1` (R4) → no `PS` with `slotBinding:"U"` | `PASSED` iff every element holds, with exactly one rise and one fall | `PASSED` is required. `FAILED`/`NOT_RUN` → `SC-B02` → run `INVALID` | the live functional claim for `V-PEND`, `V-EDGE`, `P-TC` and `ID-ON` on this build and environment. No target verdict may be derived |
| `PC-2` | known request whose ownership is independently tagged | disposable fresh page, Phase 2, own trace | two **sequential** fits. `k=2` is issued only after `k=1`'s `TC` and a quiescence window (slot null, inactive, no edge). The independent tag is therefore: "single outstanding request; the harness is the only writer". For each `k`, the `PC-1` pattern with `slotBinding = k`. Then a settle: `T4 start{settleRole:S, reqToken:2}` … `decision{deciding:1}` | `PASSED` iff: (i) both bindings equal call order; (ii) there is exactly one rise and one fall per request; (iii) on the projection, the committed correlator returns `Q-ATTR = "1,2"`, `Q-OWNER = OWN` and `Q-SUBJ = COMPLETE` under `ASSUME_NO_UNOBSERVED_WRITER` (each with `assumption: NO_UNOBSERVED_WRITER`), and all three as `AMBIGUOUS(UNOBSERVED_SLOT_WINDOW)` under `OPEN` | `PASSED` is required. Otherwise `SC-B02` → `INVALID` | R2 binding, R3/R4 inference, and **`OPEN` fail-closed behaviour** on live input. `PASSED` shows agreement with the independent tag **only** in a world where that tag holds by construction. It is never evidence for the open-world assumption |
| `PC-3` | post-capture VB-3 edge (committed, DS §6.1.3 step 4) | target instance, Phase 4, control window (after `TZ targetEnd`) | one harness-owned fit through the tag wrapper: `RQ pre` → `RQ post{callOutcome:returned, slotNew:1}` (P1 I6, CI-2) → `TE{edgeValue:1}` → `TE{edgeValue:0}` within B3 ≤ `controlWindowFrames` (with any `FS`/`PS`/`TC`) → `CT{controlId:"PC-3", controlOutcome, framesUsed, frameBudget}` → `TZ final`. `END.pc["VB-3"] = 1` iff `controlOutcome = PASSED` | `PASSED`/`FAILED` | `FAILED`/`NOT_RUN`: the C6 guard disables `V-EDGE` post hoc (`VB_UNAVAILABLE:VB-3`). Targets that need `V-EDGE` become `INCONCLUSIVE`. The run is **not** `INVALID` (committed C6 composition rule) | in-capture use of `V-EDGE`. **This control is explicitly NOT historical evidence.** It says nothing about R1, and on its own it is not evidence that VB-3 behaved representatively during the capture (§11.4) |
| `PC-4` | C8/frustum measurement timing | disposable fresh page, Phase 2, own trace | a fit → an `S` settle whose terminal decision is `settled` with `deciding = 1` → `C8{sampleSeq:<seq of that terminal T4 sample>, camDigest:<that sample's camDigest>, measureRole:"subject", targetKey, evaluable, inside}`; then a second fit → a `P` settle (`settled`) → `C8{measureRole:"superseded"}` bound to the `P` settle's terminal sample. Other records may come in between (P1 I5). The two fits are distinct and fresh (each `RQ post` adjacent, `slotNew = 1`, bound to its own token), in the order fit₁ → `S` (`reqToken` = fit₁) → subject `C8` → fit₂ → `P` (`reqToken` = fit₂) → superseded `C8` | `PASSED` iff (A) **structural:** I5 holds for both `C8` records and the order above is exact; and (B) **numeric, LIVE-only:** for each `C8` whose bound terminal sample's `NV` is retained (P1 §8.5 retention priority makes this the expected live case), the **frozen C8 frustum oracle**, part of the bound Phase-5 evaluator, recomputes `evaluable`/`inside` from that `NV` and they match. See "PC-4 scope" below the table | `PASSED` is required. Otherwise `SC-B02` → `INVALID` | binding of the C8 measurement to the T4 deciding sample (DS §6.2 R8). Without it, no C8-related observation can be interpreted |
| `PC-5` | reachability of a label that is definite under `OPEN` (`RESTORE`; added, beyond the prompt minimum) | disposable fresh page, Phase 2, own trace | fit `k=1` → `TC` → quiescence → `RS pre` → `RS post{restoreResult:OK, camClass, camDigest, slotPresent:0}` (immediate `restoreState(home, undefined, true)`, P1 CP11) → a settle following `k=1`, with no edge between `RS post` and the deciding sample | `PASSED` iff the correlator returns `Q-OWNER = RESTORE` (DEFINITE, no assumption) under `OPEN` | `PASSED` is required. Otherwise `SC-B02` → `INVALID` | that the `OPEN`-mode `SUPPORTED` path (§14) can be reached live at all |

**Known control gap (recorded, not closed).** `Q-SUBJ = PENDING` is the other label that can be definite under `OPEN`, and it has **no deterministic positive control**:
- `PENDING` needs the deciding sample to fall while the subject's request is still in the slot.
- The deciding sample is at least the second sample, because `settled` on sample 1 is a C3 contradiction.
- Whether that timing window occurs depends on live Viewer timing. The harness cannot force it without a foreign writer or an invasive wrapper, and both are excluded (DS §6.1.4).

`PC-1`/`PC-2` do control the read mechanism behind `PENDING`: the `PS{slotBinding = k}` read after a host read. They do not control whether it coincides with the decision. A target whose support set is `{PENDING}` is therefore reported with `controlCoverage: "MECHANISM_ONLY"` (§14.3). This is a verification/calibration gate, not a design blocker.

**PC-4 scope: structural offline, numeric only live (remediation of prototype finding 8).**
- Part (B) needs the frozen C8 frustum oracle with an `evaluable`/`inside` encoding identical to it. That is an implementation-plan requirement of the future bound Phase-5 evaluator. **No offline artifact of this package provides or runs it.** NV reproduction is therefore a **LIVE-only** requirement.
- Part (B) applies only to a `C8` whose bound terminal-sample `NV` is retained. This is deliberate: the binding PC-4 controls (DS §6.2 R8) is established by I5 (`sampleSeq` + `camDigest` + role), which part (A) checks; the numeric re-check confirms the frustum encoding on top of it. If the bound `NV` was not retained (C7, cap 512), part (B) is vacuous for that `C8` and the evaluator records `nvReproduction: "NOT_RETAINED"`.
- **The offline prototype checks part (A) only** (the structural pattern) and reports `scope: "STRUCTURAL_ONLY"` with `nvReproduction` in every PC-4 result. When no bound `NV` is retained (every synthetic PC-4 fixture), `nvReproduction = "NOT_RETAINED"` and the live rule reduces to part (A), so the offline `PASSED` is the live outcome for that trace. When a bound `NV` **is** retained, the prototype cannot evaluate part (B): it reports `nvReproduction = "NOT_EVALUATED_OFFLINE"` and the outcome `FAILED` (reason `NV_REPRODUCTION_LIVE_ONLY`), fail-closed. No offline output states or implies that the oracle ran.

**C6 guard input for control traces vs target traces (remediation of prototype finding 2).** A control trace (`META.rl ≠ "T"`) has no `PC-3` and carries `END.pc = {"VB-3": 0}` (§12.5). Feeding that `END.pc` to the committed C6 guard would disable `V-EDGE`, so `PC-2` and `PC-5` could never reach their required correlator outputs. The guard input is therefore defined per trace role (§12.7). The committed `applyVbGuard` and correlator are called unchanged in both cases; only the `pc["VB-3"]` value passed to the guard differs:
- **Target trace:** `pc["VB-3"] = 1` iff `END.pc["VB-3"] = 1` **and** the evaluator re-derives `PC-3 = PASSED` from the control window (the exact `PC-3` pattern above). This is stricter than `END.pc` alone and never weaker than the committed rule.
- **Control trace (`PC-2`, `PC-5`; only for computing that control's own outcome):** `pc["VB-3"] = 1` iff the evaluator re-derives, in that same control trace, the control's own edge pattern: for each harness fit of the control, after its adjacent bound `RQ post` (`slotNew = 1`), exactly one rise then one fall, at least one visible `camClass` step between them, and a `TC` at `fall.seq + 1` (the `PC-1` transition pattern). Otherwise `0`, and the control is `FAILED`. `META.vg`/`META.vb` gate the guard unchanged, `META.ei` must be `"LOW"`, and `END.pc` in a control trace stays `0` (`PC-MISMATCH` otherwise).
- This control-trace input **never** feeds a target verdict, `RG` or `END.pc`. The target guard is unchanged by it.

### 11.3 Negative controls

Each negative control is an offline fixture: a schema-2 trace, or a `META`/binding pair, derived by mutating a valid synthetic trace. "Expected" is what the bound pipeline MUST return. Any other output counts as a control failure.

| ID | Prompt §11/§19 item | Fixture mutation | Expected integrity | Expected run verdict | Live occurrence → stop |
|---|---|---|---|---|---|
| `NC-1a` | wrong Viewer version (honest) | `META.vv = "7.124.1"`, `vg = 0`, all `vb = 0` | envelope honest: §12.6 steps 1–3 pass (`envelopeOk = true`, `vbEligible = false`); step 4 fails with `OBSERVED_VIEWER_NOT_BOUND` (`bindingOk = false`), so `validateTraceV2.ok = false` | `INVALID` (`OBSERVED_VIEWER_NOT_BOUND`) | `SC-A09` (pre-consumption → `BLOCKED`) |
| `NC-1b` | wrong Viewer version (claims VB-0) | `META.vv = "7.125.0"`, `vg = 1` | `META-INVALID` + `META-VB0-INCONSISTENT` | `INVALID` | `SC-A09` |
| `NC-2a` | wrong bundle digest (honest) | `META.vd` = another hex64, `vg = 0`, all `vb = 0` | envelope honest (`envelopeOk = true`, `vbEligible = false`); step 4 fails with `OBSERVED_BUNDLE_NOT_BOUND` (`bindingOk = false`), so `ok = false` | `INVALID` (`OBSERVED_BUNDLE_NOT_BOUND`) | `SC-A10` |
| `NC-2b` | wrong bundle digest (claims VB-0) | `META.vd` wrong, `vg = 1` | `META-INVALID` + `META-VB0-INCONSISTENT` | `INVALID` | `SC-A10` |
| `NC-3a` | missing version-bound observable | pinned build, `META.vb["VB-1"] = 0` | valid | `V-PEND` targets `INCONCLUSIVE(VB_UNAVAILABLE:VB-1)` → run `INCONCLUSIVE` | `SC-A11` |
| `NC-3b` | missing VB-3 behaviour | pinned build, `END.pc["VB-3"] = 0`, `CT{PC-3}` `FAILED` | valid | `V-EDGE` targets `INCONCLUSIVE(VB_UNAVAILABLE:VB-3)` → run `INCONCLUSIVE` | none (post-capture; class c) |
| `NC-4a` | missing request tag | one `RQ post` without `reqToken` | `DATA-INVALID` | `INVALID` | `SC-A12` (structural) / `SC-B01` (install) |
| `NC-4b` | request tagging off | `META.id = "OFF"` | `META-INVALID` (schema-2 `id` admits only `"ON"`) | `INVALID` | `SC-A13` |
| `NC-5` | ambiguous request ownership | `PS{slotBinding:"U"}` between the subject's `RQ post` and the deciding sample | valid | subject targets `INCONCLUSIVE(IDENTITY_AMBIGUOUS)` → run `INCONCLUSIVE` | none (analysis outcome) |
| `NC-6` | trace-integrity failure | one `seq` skipped (`SEQ-GAP`). Variants: wrong `END.sd` (`STREAM-DIGEST-MISMATCH`); a data record carrying `vv` (`META-FIELD-IN-DATA`, `VERSION-MIXED`); an `FS` without its `PS` (`I3-HOST-PS`); a gap in `FS` frames (`FS-FRAME-GAP`); an `RS post` without its adjacent `RS pre` (`RS-PAIR`); a record whose `f` differs from the latest `FS` frame (`FRAME-ORDER`); a decreasing `tm` (`TIME-ORDER`) | that code | `INVALID` | `SC-B06` |
| `NC-7` | truncated trace | `END` removed. Variants: `END.truncated = 1` with `ts = "TRUNCATED"`; no `TZ final` | `END-MISSING` / `TRUNCATED` / `I6-TZ-WINDOW` | `INVALID` (`TRUNCATED`) | `SC-B04` |
| `NC-8` | overflowed trace | `END.overflow = 1`, `rj > iv`, `ts = "OVERFLOW"` | `OVERFLOW` | `INVALID` (`OVERFLOW`) | `SC-B04` |
| `NC-9` | unmatched META/data/END envelope | `END.run ≠ META.run`. Variants: a second `META`; data after `END`; `END.ne` off by one; `END.ds ≠` the cause code of `TZ final` | `RUN-ID-MISMATCH` / `META-DUPLICATE` / `DATA-AFTER-END` / `COUNT-MISMATCH` / `TZ-STATUS-MISMATCH` | `INVALID` | `SC-B06` |
| `NC-10` | pre-motion ambiguity | subject rise, then no `camClass` change before the deciding sample (P1 `PRE_MOTION`) | valid | `Q-OWNER` targets `INCONCLUSIVE` (`ACTIVE_WITHOUT_VISIBLE_STEP`/`UNOBSERVED_SLOT_WINDOW`, plus the `preMotionUnresolved` flag) | none |
| `NC-11` | pending-clear → active-edge gap | a visible `slotBinding = subject`, then `TE{edgeValue:1}`, with `META.sw = "OPEN"` (P1 GAP `CONSUME_EDGE_BOUND`) | valid | token-dependent subject targets `INCONCLUSIVE(UNOBSERVED_SLOT_WINDOW)` | none |
| `NC-12` | C8 not bound to the terminal sample of a settled settle of its role | `C8.sampleSeq` names a non-terminal sample; or its `camDigest` differs; or `measureRole:"subject"` names a `G`/`P` sample; or the referenced settle timed out | `I5-C8-BINDING` | `INVALID` | `SC-B06` |
| `NC-13` | a partial trace is never positive | a valid trace whose primary target is `SUPPORTED`, plus each of its proper prefixes | every prefix fails (`END-MISSING`) | `INVALID` for every prefix; `SUPPORTED` only for the complete trace | — |
| `NC-14` | inconclusive C8 case | the deciding sample's `NV` is not retained (C7) | valid | the C8 numeric reproduction is `AMBIGUOUS(NUMERIC_NOT_RETAINED)`. Target verdicts are unaffected, because C8 is never a target question | none |
| `NC-15` | `edgeInit` UNKNOWN (P1 §8.4) | three variants, one per P1 boundary fixture: `META.ei = "UNKNOWN"` with `ba = "TRUE"` (already high at registration); with `qe = 1` (rise during quiescence); with `lb = 0`. A fourth variant claims `ei = "LOW"` with `qe = 1` | variants 1–3 valid; variant 4 `META-INVALID` (`EDGEINIT-INCONSISTENT`) | variants 1–3: the projection drops `V-EDGE`; every `Q-OWNER`/`Q-SUBJ` target and every `Q-ATTR` target with a non-empty label is `INCONCLUSIVE`, with `EDGE_INIT_UNKNOWN` (rule T3a) in its ordered `reasons` list (§14.3). The first-matching `reason` is normally T1's correlator reason (e.g. `OBSERVABLE_ABSENT:V-EDGE`), because dropping `V-EDGE` already makes the label non-`DEFINITE`; the verdict is the same → run `INCONCLUSIVE`. Variant 4: `INVALID` | `SC-B03` (a conforming harness does not start capture without quiescence) / `SC-C05` if a trace is written |
| `NC-16` | zero-sample timeout of the subject settle (P1 I4) | `T4 start{S}` → `T4 decision{decision:"timeout", sampleIndex:0, terminal:1}`, no sample, no `C8` | valid | `Q-OWNER`/`Q-SUBJ` `UNDIAGNOSABLE(NO_DECIDING_SAMPLE)` → targets `INCONCLUSIVE` → run `INCONCLUSIVE`. Variant with a subject `C8`: `I5-C8-BINDING` → `INVALID` | none |
| `NC-17` | > 64 samples, then `settled` (P1 §8.4a) | an `S` settle with 65…1,801 unequal samples and a `settled` terminal decision | valid (sample bound 1,801); a variant with `sampleIndex = 1,802` is rejected at append (`overflow = 1`) → `OVERFLOW` | base: correlated after P1 §8.3 compaction, never `MALFORMED` (verdict per targets). Variant: `INVALID` (`OVERFLOW`) | `SC-B04` for the variant |
| `NC-18` | superseded `C8` (P1 I5) | a valid trace with `S` and `P` settles, a subject `C8` and a superseded `C8` bound to the `P` terminal sample. Variants: superseded `C8` bound to an `S` or `G` sample; superseded `C8` for a timed-out `P` settle | base valid; variants `I5-C8-BINDING` | base: targets unaffected (`C8` is never a target question). Variants: `INVALID` | `SC-B06` |
| `NC-19` | late callback after `TZ final` (P1 §8.6) | recorder-level fixture: a `TE` and a `TC` delivered in `FINALIZING` and in `CLOSED` | trace bytes, `seq`, `rj`, `iv` and `END` identical to the run without the late callbacks; a variant trace with a data record after `TZ final` is `I6-TZ-WINDOW` / `DATA-AFTER-END` | base: unchanged verdict. Variant: `INVALID` | none (base) / `SC-B06` (variant) |
| `NC-20` | repeated-run listener duplication (P1 §8.6) | (a) a second recorder constructed in the same page: refused, no second trace; (b) a trace with `META.rc = 2`; (c) a duplicated `TE` listener: two identical consecutive rises; (d) repeated teardown: no-op | (a) refusal; (b) `META-INVALID` (`RECORDER-ORDINAL`); (c) valid envelope; (d) no change | (a) `SC-B01` → `INVALID`; (b) `INVALID`; (c) committed C3 `EDGE_REPEAT` → `INVALID`; (d) unchanged | `SC-B01` |
| `NC-21` | projection not representable in the committed schema (P1 §8.3) | (a) a target-window `RQ post{callOutcome:"threw"}`; (b) a trace whose projection exceeds 8,192 events | valid | every sound question `UNDIAGNOSABLE(PROJECTION_UNREPRESENTABLE:<cause>)` (cause `FIT_THREW` or `CAPACITY`) → targets `INCONCLUSIVE` → run `INCONCLUSIVE`; never `MALFORMED`/`INVALID` | `SC-C07` |

**A negative-control failure invalidates the analysis pipeline at its bound digest** (validator + projection + correlator + verdict evaluator).
- In Phase 0 it is `SC-A05`: the run stops as `BLOCKED` and the attempt is not consumed.
- In Phase 5 it makes the run `INVALID`. The authorization binds the pipeline, so it MUST NOT be repaired after the data has been seen.

### 11.4 VB-3 representativeness gate (`RG`)

Whether a post-capture control is representative of VB-3 behaviour during capture remains a live verification gate (DS §6.1.3; independent re-reviews L2/L3). This section defines the gate mechanically. It does **not** declare it passed.

`RG` holds iff all three of the following hold:
1. `PC-1 = PASSED` (same pinned build, disposable page).
2. `PC-3 = PASSED` (`END.pc["VB-3"] = 1`).
3. **In-capture witness:** the target window contains at least one `TE{edgeValue:1}` … `TE{edgeValue:0}` pair that follows a harness `RQ post` with `slotNew = 1`. This shows the edge listener delivered edges during the capture itself.

`RG` is independent of `edgeInit`: with `META.ei = "UNKNOWN"` the projection already drops `V-EDGE` (P1 §8.4), and target rule T3a (§14.3) applies whatever `RG` is.

If `RG` fails while `V-EDGE` is otherwise enabled, every target label that depends on `V-EDGE` becomes `INCONCLUSIVE(VB3_NOT_REPRESENTATIVE)`. That covers every `Q-OWNER` and `Q-SUBJ` label and every non-empty `Q-ATTR` list. `RG` never upgrades anything, and passing it is never historical evidence.

---

## 12. Live-trace envelope contract (trace schema 2)

### 12.1 Reused unchanged from DS §6.1.3

The following carry over from DS §6.1.3 without change:
- Canonical serialization: D2 `canonical.mjs`.
- Sequencing and time: the recorder-stamped contiguous sequence (`seq`/wire `q`, `META.q0 = 1`) and non-decreasing `tRel`/`tm` in tenths of a millisecond.
- Byte budget: the 2,048 B reserve for `META` + `END` + delimiters.
- Per-record caps: `META`/`END` 1,536 / 384 B; per event 256 B (`NV` 406 B); 512 retained `NV` samples; 32 retained excerpts. These values are reused; their worst cases are re-verified for schema 2 in §12.3–§12.5.
- **Not reused:** the committed data-event cap (8,192), total trace bytes (2,457,600) and settle samples (64). Schema 2 replaces them with the derived caps of §12.4a (`LIVE_CAPS_V2`). The committed `LIVE_CAPS`, `schema.mjs` and every committed result are unchanged; schema 1 keeps its caps.
- Version gating: the VB-0 exact pin (`vv === "7.124.2"`, `vd === 12b9fe49…c02e`, `vg === 1`) and the post-hoc C6 guard.
- Integrity: the stream commitment `sd`; the terminal status `ts` with precedence `TRUNCATED` > `OVERFLOW` > `MALFORMED` > `OK`; and all 39 committed integrity codes.

**No partial trace and no prefix is ever positive evidence.**

### 12.2 Canonical serialization and file form

Rules 1 and 2 define how **one record** (or one JSON document) is serialized. Rules 3 and 4 define **file framing**. They do not conflict: a canonical string never contains a newline, and only the JSONL framing adds one `\n` after each record.

1. **Record / document serialization.** Each record is a plain JSON object serialized by `canonicalStringify`:
   - UTF-8;
   - keys sorted by UTF-16 code unit;
   - no insignificant whitespace;
   - `-0` written as `0`;
   - no non-finite numbers;
   - no `null` in a trace record (`META`, data, `END`): an absent field is omitted. A single-document file (rule 6) may carry `null` only in a field its schema declares nullable (`TERMINAL-VERDICT.json` `stopCondition`, `withheldBy`); the committed canonicalizer serializes it deterministically;
   - no trailing newline (the serialized string ends with its closing `}`).

   Fields are looked up as own properties only, so a kind or key such as `toString` is invalid.
2. Records use **wire keys** (§12.4). P1's logical camelCase names are the contract names. They map to wire keys through P1 Appendix `wireKeys` (the single source; Part 2 adds none).
3. **JSONL file framing.** The **authoritative raw** capture is a JSONL file: one canonical record per line, each line ending in `\n`, appended on the Node side in dispatch order. The first line is `META` and the last is `END`.
4. The **trace array** used for byte accounting and validation is `[` + the lines without their `\n`, joined by `,` + `]`. It is derived from the JSONL by this rule alone, so its bytes are fully determined. It is written once as `*.trace.json` and hashed.
5. `END.sd` = SHA-256 of the canonical bytes of `[META, ...data]`. This is unchanged.
6. **Single-document files** (`MANIFEST.json`, `TERMINAL-VERDICT.json`, `SC-C03-CLOSEOUT.json`, every `derived/*.json`): the file bytes are **exactly** the UTF-8 encoding of `canonicalStringify(document)`: no BOM, no leading or trailing whitespace, **no trailing newline** (the last byte is `}`). Every SHA-256 of such a file (`manifestSha256`, `terminalVerdictSha256`, ledger entries) is computed over exactly those bytes.

### 12.3 `META` (all fields required, no others)

`META` keeps the schema-1 fields, with schema-2 semantics where noted, and adds fourteen fields: seven for binding (`rl`, `ai`, `ah`, `ad`, `pk`, `tq`, `sw`) and seven for the P1 boundary read, sample bound and recorder lifecycle (`ei`, `ba`, `bp`, `lb`, `qe`, `rr`, `rc`). Its worst-case canonical size is **1,456 B** (computed with the committed canonicalizer: every string at maximum length, `cp` = `LIVE_CAPS_V2`, `ec` = {24,576, 24,576}, `qe` = 2³²−1). That is within the 1,536 B cap.

| Wire key | Contract name | Type / constraint | Meaning (prompt §12 item) |
|---|---|---|---|
| `k` | `kind` | `"META"` | — |
| `f`, `tm` | `frameOrigin`, `timeOrigin` | int `0`, int `0` | start metadata: frame and clock origin |
| `sv` | `schemaVersion` | int, exactly `2` | schema version |
| `run` | `runId` | string 1..32, `[a-z0-9-]` | run/session id. `END.run` and every data `rn` MUST equal it. A control trace's `run` MUST be the target's `<runId>-pc1`, `-pc2`, `-pc4` or `-pc5` (≤ 32 chars); otherwise V2 `INVALID` (`CONTROL_RUN_NOT_LINKED:<PC>`) |
| `rl` | `traceRole` | `"T"` (target), or a control id `"PC-1"`/`"PC-2"`/`"PC-4"`/`"PC-5"` | new |
| `ai` | `authorizationId` | string 8..64, `[a-z0-9-]` | new |
| `ah` | `authorizationRecordSha256` | hex64 | new: SHA-256 of the authorization record bytes |
| `ad` | `attemptId` | lowercase UUIDv4 | new: taken from the diagnostic reservation (§17) |
| `hh` | `diagnosticHarnessSha256` | hex64 | harness/build digest of **the diagnostic harness** (not the acceptance harness) |
| `ph` | `procedureSha256` | hex64; MUST equal `d1ccfde2…2a45a75` | accepted G2 procedure (context binding only; the procedure is not changed) |
| `sh` | `diagnosticSpecSha256` | hex64 | committed instrumentation spec (DS) |
| `pk` | `diagnosticPackageSha256` | hex64 | new: preparation-package manifest (Part 1, Part 2, prototype, contract) |
| `tq` | `targetPlanSha256` | hex64 | new: canonical `targetPlan.json` (sequence plus pre-registered targets, §14.2) |
| `vv` | `viewerVersionObserved` | string matching `^[0-9A-Za-z.+-]{1,16}$`, or `"ABSENT"` | Viewer version, observed and recorded verbatim. An observed value outside the pattern is recorded as `"ABSENT"` (no JSON escape can inflate the size bound) |
| `vd` | `viewerBundleSha256Observed` | hex64, or `"ABSENT"` | Viewer bundle digest of the observed decoded `viewer3D.js` |
| `vg` | `vbGate` | 0/1; `1` only on the exact pin | version-bound gate state (VB-0) |
| `vb` | `vbStructural` | `{"VB-1","VB-2","VB-3"}` → 0/1, all three keys present | capability map, structural (all 0 unless VB-0 holds) |
| `at` | `atoms` | MUST equal exactly `["P-FRM","P-TC","V-PEND","V-EDGE"]` (canonical order) | capability map: configured atoms |
| `id` | `idAxis` | MUST be `"ON"` | capability map: identity axis |
| `sw` | `slotWindow` | `"OPEN"` / `"ASSUME_NO_UNOBSERVED_WRITER"` | new: bound slot-window mode. Default `OPEN`; ASSUME needs owner decision OD-2 |
| `br` | `browserFamily` | string matching `^[0-9A-Za-z .()/-]{1,24}$` | coarse browser family and major version |
| `cp` | `caps` | exactly `LIVE_CAPS_V2` (§12.4a) | expected bounds: caps, including the sample bound (`settleSamples` 1,801 = ⌊5,000 × 360 / 1,000⌋ + 1, `maxRefreshHz` 360, `deadlineMs` 5,000) and the frame budgets |
| `ec` | `expectedCount` | `{min, max}`, `0 ≤ min ≤ max ≤ 24,576` | expected bounds: data-event count derived from `targetPlan.json` (P0.08) |
| `q0` | `firstSeq` | int, exactly `1` | — |
| `cs` | `captureStart` | int, exactly `1` | start metadata: the first data record is the capture-start `FS` at `frame = 0`, `tRel = 0` |
| `ei` | `edgeInit` | `"LOW"` / `"UNKNOWN"` | new: P1 §8.4 target-window boundary state. MUST equal `"LOW"` iff `lb = 1` ∧ `qe = 0` ∧ `ba = "FALSE"` ∧ `bp = "NULL"`, else `META-INVALID` (`EDGEINIT-INCONSISTENT`) |
| `ba` | `boundaryActiveRead` | `"FALSE"` / `"TRUE"` / `"UNREADABLE"` | new: result of the strict boundary read `navigation.getTransitionActive() === false` (VB-2), taken in the same synchronous segment as writing `META` and the capture-start `FS` |
| `bp` | `boundarySlotRead` | `"NULL"` / `"PRESENT"` / `"UNREADABLE"` | new: result of the strict boundary read `navigation.getRequestTransition() === null` (VB-1), same segment. It is also the I7 `slotDelta` baseline |
| `lb` | `listenersBeforeQuiescence` | 0/1 | new: 1 iff the recorder registered its `TE`/`TC` listeners in state `CREATED` before the quiescence window began (P1 §8.6) |
| `qe` | `quiescenceEdgeCount` | int 0..2³²−1 | new: `TE` dispatches observed during the quiescence window (each marks quiescence failure, P1 §8.6) |
| `rr` | `measuredRefreshHz` | int 1..360 | new: rAF rate measured at P0.13 in this trace's page; MUST be ≤ `cp.maxRefreshHz` (`SC-A17`) |
| `rc` | `recorderOrdinal` | int, exactly `1` | new: the recorder's ordinal within its page load (P1 §8.6 one recorder per page). Any other value is `META-INVALID` (`RECORDER-ORDINAL`) |

`META` is built in two steps.
- **Template (Phase 1).** Every field except `ei`, `ba`, `bp`, `lb` and `qe` is computed, validated and frozen in P1.04 (for a control, at its page's creation in P2.01). The frozen template is written once as a file, `preflight/meta-template.<role>.json` (its canonical bytes, rule 6), and hashed like every other file, so every hash-ledger entry names a file (§13.4).
- **Capture start (P3.02 / P2.01).** The recorder fills `ei`, `ba`, `bp`, `lb` and `qe` from the boundary read, in the same synchronous segment that writes `META` as record 0 and the capture-start `FS`, and moves from `CREATED` to `CAPTURING` (P1 §8.6). The written `META` MUST equal the frozen template on every other field (`BINDING-MISMATCH:metaTemplate`). Its origin `f = 0`, `tm = 0` is defined as that instant.

The run does not start if `META` fails validation, exceeds 1,536 B or disagrees with the binding (`SC-A06`/`SC-A13`).

### 12.4 Data records: fields and wire keys from Part 1; byte bounds from Part 2

**Fields, wire keys, read sites, ordering, settle roles and pairing invariants I1–I7 are exactly as defined in P1 §8.1–§8.3 and the P1 Appendix** (`fieldTypes`, `wireKeys`, `wireVariants`, `settleRoles`, `controlWindow`). Part 2 adds no data-record field and no data-record wire key. An earlier draft of this part defined its own extension keys (`sn`, `rx`, `sq`, `ea`, `oc`); they are withdrawn in favour of P1's `nw`, `rd`, `ss`, `el`, `cr`.

**Collision rule (precise; remediation of prototype finding 1).** The earlier statement "no P1 data wire key equals a `META` or `END` key" was false: the common keys `k`, `f` and `tm` occur in every record. The rule is:
- The P1 data wire keys that are also `META`/`END` keys are **exactly** `{f, k, tm}` (Appendix (i) `wireKeyCollisionRule.allowedShared`). Each has the **same meaning** in every record: record kind; frame counter; time in tenths of a millisecond from the origin (`META` carries the origin `f = 0`, `tm = 0`; `END` carries the close values). Sharing is allowed only under that same-meaning condition.
- Every other P1 data wire key differs from every schema-2 `META` and `END` key.
- The **envelope-only keys** are the `META` ∪ `END` keys minus the P1 data wire keys. A data record carrying an envelope-only key is `META-FIELD-IN-DATA` (committed), and one carrying `vv`/`vd`/`sv` with a value different from `META` is also `VERSION-MIXED`. So the committed check stays meaningful.
- The prototype MUST compute the intersection mechanically from the two appendices and assert that it equals `allowedShared`.

**Worst-case canonical sizes** (committed canonicalizer; `q`, `hq`, `ss`, `r`, `sb`, `cl` = 24,576; `f`, `fu`, `fb` = 5,376; `tm` = 2⁵³ − 1; `n` = 1,801; a 32-char `rn` and `tk`; the longest value of every enum; every conditional field present):

| Variant (P1) | Worst case | Variant (P1) | Worst case |
|---|---|---|---|
| `RQ` pre | 145 B | `RS` pre / post | 102 / 183 B |
| `RQ` post returned / threw | **204** / 126 B | `CE` (not in minimum) | 91 B |
| `PS` | 151 B | `TC` | 91 B |
| `TE` | 105 B | `C8` (`targetKey` 32 chars) | 198 B |
| `FS` | 126 B | `CT` | 138 B |
| `T4` start / sample / decision | 122 / 157 / 163 B | `TZ` | 122 B |
| `NV` (committed keys; `q` ≤ 24,576, `f` ≤ 5,376) | **403 B** (cap 406 B, unchanged) | | |

Every non-`NV` variant is at most 204 B, below the 256 B per-event cap. `NV` stays within its committed 406 B cap: the committed worst case (`f` = 99,999,999, `q` = 8,192) is exactly 406 B, and the schema-2 bounds on `f` and `q` keep it at 403 B.

### 12.4a Derived schema-2 caps (`LIVE_CAPS_V2`; resolves P1 §11 item 8)

**Why the committed caps cannot be inherited.** At the P1 sample bound (1,801 samples per settle), a single subject settle alone can produce 1,801 × 5 = 9,005 records (`FS`, `PS`, `T4` sample, `PS`, `T4` decision per frame), above the committed 8,192. A second limit binds first, though: the committed correlator, consumed unchanged, accepts at most **8,192 projected events** (`q` ≤ `MAX_SEQ`). The target-window frame budget is therefore derived from the projection capacity, and the raw data-event cap from that frame budget.

**Step 1: target-window frame budget `F_T` (projection capacity).** In the target window each frame projects to at most one `CAM` (`FS`) plus at most one `SMP`/`CAM` (a `T4` sample; at most one sample per frame, since T4 samples once per `waitFrame`, H:8411-8432). `PS`, `NV`, `T4` decisions, `C8`, `CT`, `TZ` do not project. With at most 3 projected `SST` (`G`, `G`, `S`), 8 target fits (`FIT`), 4 restores (`RST`) and a Viewer-dispatch allowance of 1,024 `TE` + `TC` records (`AE`/`TC`):

`2·F_T + 3 + 8 + 4 + 1,024 ≤ 8,192` ⇒ `F_T ≤ 3,576.5` ⇒ **`targetWindowFrames = 3,576`** (worst-case projection 8,191 events).

**Step 2: control-window frame budget `F_C`.** `PC-3`'s budget B3 is at most one T4-deadline window at the maximum refresh rate: **`controlWindowFrames = 1,801`**. The largest frame index is therefore 3,576 + 1,801 − 1 = 5,376.

**Step 3: worst-case raw data-event count of one trace.**

| Term | Records | Bound |
|---|---|---|
| A. `FS` + its `PS`, every frame of both windows | 2 × (3,576 + 1,801) | 10,754 |
| B. `T4`: ≤ 4 starts + ≤ 4 timeout decisions + 3 records per sample (sample, `PS`, comparison decision); samples ≤ `F_T` (one per frame) and ≤ 1,801 per settle | 4 + 4 + 3 × 3,576 | 10,736 |
| C. `NV` (retained cap) | 512 | 512 |
| D. `RQ` pairs (8 target fits + the `PC-3` fit) and `RS` pairs (≤ 4 restores) | 2 × 9 + 2 × 4 | 26 |
| E. `TE` + `TC` (Viewer-dispatched, both windows) | allowance | 1,024 |
| F. `C8` (≤ 2), `CT` (1), `TZ` (2) | | 5 |
| **Total** | | **23,057** |

**`dataEvents = 24,576`** (= 3 × 8,192; margin 1,519 over the derived worst case). `END.lq`, `END.ne`, `ec.max` and every seq-valued field are bounded by it.

**Step 4: total trace bytes.** At the event cap, with every event at its cap: (24,576 − 512) × (256 + 1) + 512 × (406 + 1) + 2,048 = 6,184,448 + 208,384 + 2,048 = **6,394,880 B**. **`totalTraceBytes = 6,400,000`**, so the event cap is always reached before the byte cap (with actual worst-case sizes the bound is (24,576 − 512) × (204 + 1) + 512 × (403 + 1) + 2,048 = **5,142,016 B**).

**Basis and limits.**
- 1,801 and 360 Hz are P1's (§8.4a). The P0.13 measured rate must not exceed 360 Hz (`SC-A17`).
- The allowance in E is the one non-derived term. A quiescent, input-free page with ≤ 9 harness fits produces ≤ 3 `TE`/`TC` per harness transition (rise, fall, completion), i.e. ≤ 27; 1,024 is a > 30× margin for view-cube or other shared-flag activity. Exceeding any cap is `OVERFLOW` (fail-closed, never a wrong label, P1 §8.4a).
- The frame budgets are counted in frames, not milliseconds. At 60 Hz `F_T` is about 59.6 s, at 360 Hz about 9.9 s. P0.08 and P0.13 check that the plan's worst-case duration at the bound or measured rate fits `F_T` (`SC-A07`, `SC-A17`); a budget exhausted mid-run is `OVERFLOW`.
- If, despite these checks, a projection exceeds 8,192 events, P1 §8.3 refuses it as `PROJECTION_UNREPRESENTABLE:CAPACITY` (target `INCONCLUSIVE`, `NC-21`), never `MALFORMED`.

`LIVE_CAPS_V2` = `{dataEvents: 24576, bytesPerEvent: 256, bytesPerNv: 406, metaBytes: 1536, endBytes: 384, totalTraceBytes: 6400000, retainedNumericSamples: 512, retainedExcerpts: 32, settleSamples: 1801, reserveBytes: 2048, maxRefreshHz: 360, deadlineMs: 5000, targetWindowFrames: 3576, controlWindowFrames: 1801, maxSettles: 4, maxFits: 9, maxRestores: 4, viewerDispatchAllowance: 1024, projectedEventsMax: 8192, projectedSamplesPerSettle: 64}`. `META.cp` MUST equal it exactly.

**Windows (P1 I6).**
- **Target window:** from the capture-start `FS` to `TZ{tzPhase:"targetEnd"}`.
- **Control window:** from `TZ targetEnd` to `TZ{tzPhase:"final"}`. It holds only `PC-3` records: `RQ` (the wrapped `PC-3` fit, CI-2 resolved in P1 I6), `TE`, `TC`, `FS`, `PS` and one `CT`. `T4`, `RS`, `C8`, `NV` and `CE` are forbidden there.
- `TZ final` is the last data record.
- A `CE` record while `P-CC ∉ META.at` is `MALFORMED` (P1 CP12).
- **Control traces** (`rl` = a control id) have the same two `TZ` records. Their control window holds exactly one record, the `CT` that carries the control's outcome, immediately before `TZ final` (no `PC-3` runs in a control trace).
- **Recorder lifecycle** (P1 §8.6): `META` + capture-start `FS` = `CREATED → CAPTURING`; `TZ targetEnd` = `CAPTURING → CONTROL`; `TZ final` = `CONTROL → FINALIZING` (the recorder removes its own `TE`/`TC` listeners by their retained references); `END` = `FINALIZING → CLOSED`. Callbacks in `FINALIZING`/`CLOSED` are no-ops that change no byte, sequence number or counter.

### 12.5 `END` (all fields required, no others)

`END` is the schema-1 `END` plus five fields: `ds`, `zt`, `lr`, `cg` and `mx`. Its worst-case canonical size is **363 B** (committed canonicalizer; `f`/`tm` = 2⁵³ − 1, `lq`/`ne`/`zt` = 24,576, `nb` = 6,400,000, `nvn` = 512, `nvx`/`rj` = 2³² − 1, `iv` = 2³² − 2, every flag 1, a 32-char `run`). The schema-2 integer bounds below keep it within the unchanged 384 B cap. The reserve still holds: 2 + 1,536 + 1 + 384 = 1,923 ≤ 2,048.

| Wire key | Contract name | Type | Meaning (prompt §12 item) |
|---|---|---|---|
| `k` | `kind` | `"END"` | — |
| `f`, `tm` | `frameEnd`, `timeEnd` | int | at close; ≥ the last data record's values |
| `run` | `runId` | string | same run/session id |
| `lq` | `lastSeq` | int 0..24,576 | terminal sequence. MUST equal the `seq` of `TZ final` |
| `ne`, `nb` | `dataCount`, `dataBytes` | int 0..24,576; int 0..6,400,000 | record count; Σ(canonical bytes + 1) |
| `nvn`, `nvx` | `nvRetained`, `nvNotRetained` | int 0..512; int 0..2³²−1 (saturating) | C7 accounting |
| `rj`, `iv` | `appendsRejected`, `appendsInvalid` | int 0..2³²−1 (saturating), `iv ≤ rj` | rejection accounting |
| `overflow`, `truncated` | — | 0/1 | truncation/overflow state |
| `ts` | `traceStatus` | `OK`/`TRUNCATED`/`OVERFLOW`/`MALFORMED` | terminal **trace** status implied by the flags |
| `ds` | `diagnosticStatus` | int: `0` normal, `1` stop, `2` error | terminal **diagnostic** status. MUST equal the code of `TZ final`'s `tzCause` (P1 `normal`/`stop`/`error`), else `TZ-STATUS-MISMATCH`. It is an integer so that `END` stays within 384 B |
| `pc` | `positiveControl` | `{"VB-3": 0/1}` | post-capture `PC-3` result. In a target trace it is `1` iff `CT{controlId:"PC-3", controlOutcome:"PASSED"}` exists, else `PC-MISMATCH`. Control traces use `{"VB-3":0}` |
| `sd` | `streamSha256` | hex64 | stream commitment |
| `zt` | `targetEndSeq` | int 1..24,576 | new (lifecycle): `seq` of `TZ targetEnd`, the `CAPTURING → CONTROL` transition. MUST match the trace (`LIFECYCLE-MISMATCH`) |
| `lr` | `listenersRemoved` | 0/1 | new (lifecycle): 1 iff the recorder removed its `TE`/`TC` listeners by their retained references on entering `FINALIZING` (P1 §8.6). `0` is recorded, never verdict-changing (`SC-C02`), because later callbacks are no-ops |
| `cg` | `classGateFailed` | 0/1 | new: 1 iff the online `camClass` transitivity gate failed (P1 §8.5, `CLASS_NONTRANSITIVE`) |
| `mx` | `maxSampleIndex` | int 0..1,801 | new (sample bound): largest `T4` `sampleIndex` appended. An append that would exceed `cp.settleSamples` is rejected and sets `overflow = 1` (P1 §8.4a) |

If the harness dies before `TZ final`, there is no `END`. The trace is then `TRUNCATED` and the run `INVALID`.

The stop-condition id is not carried in the trace. It is written, once, to `raw/stop.json` at the moment of the stop (§13.2).

### 12.6 Whole-trace validator (schema 2)

`validateTraceV2(records, {canonicalBytes, caps, binding, role})` is **total**: it never throws. It runs before any projection or correlation and checks the following, in order.

1. **Committed integrity invariants** (DS §6.1.3; 39 codes), adapted to schema 2: `sv = 2` is the supported version, the `META`/`END` field sets are the schema-2 ones, and P1's data-record field table replaces the schema-1 data schema.
2. **P1 pairing invariants and data-record rules:**
   - `I1-RQ-PAIR`, `I2-RQ-THREW-READS`, `I3-HOST-PS`, `I4-T4-DECISION` (the exact P1 I4 rules), `I5-C8-BINDING`, `I6-TZ-WINDOW`, `I7-SLOT-DELTA`;
   - `RS-PAIR`: an `RS pre` not immediately followed by its `RS post` (`post.seq = pre.seq + 1`), or an `RS post` not immediately preceded by its `RS pre` (P1 CP10/CP11);
   - `SETTLE-ROLES`: a target trace has exactly one `S`, at most two `G` and at most one `P` settle, strictly sequential (P1 I4); a control trace follows its control's pattern (§11.2);
   - `CONTROL-WINDOW-KIND`: a `T4`, `RS`, `C8`, `NV` or `CE` record in the control window (P1 I6);
   - `FS-FRAME-GAP`: every `frame` 0..last in the target window carries exactly one `FS` (P1 CP07);
   - `CE-NOT-CONFIGURED`;
   - `WIRE-VARIANT`: a record violates its P1 `wireVariants` row (required, conditional or forbidden keys).
3. **Part-2 codes:**
   - `TZ-STATUS-MISMATCH`: `END.ds` ≠ the code of `TZ final`'s `tzCause`, **or** the trace has no `TZ final` (the recorder then writes `ds = 2`; the trace is also `I6-TZ-WINDOW`);
   - `PC-MISMATCH`;
   - `FRAME-ORDER`: a data record's `f` is smaller than the previous data record's `f`, or a non-`FS` data record's `f` differs from the `f` of the latest preceding `FS` (the capture-start `FS` is the first data record);
   - `TIME-ORDER`: a data record's `tm` is smaller than the previous data record's `tm`;
   - `ROLE-MISMATCH`: `META.rl` ≠ the file's role;
   - `CT-PLACEMENT`: a `CT` outside the control window, or anything other than exactly one `CT` in a control trace;
   - `EDGEINIT-INCONSISTENT`: `META.ei` ≠ the value implied by `lb`, `qe`, `ba`, `bp` (§12.3);
   - `RECORDER-ORDINAL`: `META.rc ≠ 1`;
   - `LIFECYCLE-MISMATCH`: `END.zt` ≠ the `seq` of `TZ targetEnd`;
   - `FRAME-BOUND`: a target-window frame index ≥ `cp.targetWindowFrames`, or a control-window frame count above `cp.controlWindowFrames`;
   - `SAMPLE-BOUND`: a `sampleIndex` > `cp.settleSamples`, or `END.mx` ≠ the largest appended `sampleIndex`.

   `END.cg = 1` (`CLASS_NONTRANSITIVE`) is **not** an integrity failure: the trace is intact, but class-dependent analysis is order-dependent, so every target becomes `INCONCLUSIVE` (§14.3, T0b).
4. **Binding check** (`BINDING-MISMATCH:<field>`): each of `META.ai`, `ah`, `ad`, `hh`, `ph`, `sh`, `pk`, `tq`, `at`, `id`, `sw` and `cp` must equal the binding (§17), and every `META` field other than `ei`, `ba`, `bp`, `lb`, `qe` must equal the frozen template (`BINDING-MISMATCH:metaTemplate`, §12.3).
   - The observed `vv`/`vd` must also equal the bound `viewerVersion`/`viewerBundleSha256`.
   - A mismatch there is `OBSERVED_VIEWER_NOT_BOUND` or `OBSERVED_BUNDLE_NOT_BOUND`. It makes the run `INVALID` even when the envelope is honest (NC-1a/NC-2a).

**Result fields** (remediation of prototype finding 4). `validateTraceV2` returns `{ok, envelopeOk, envelopeErrors, bindingOk, bindingErrors, errors, reason, vbEligible}`:
- `envelopeOk` is true iff steps 1–3 raise nothing (`envelopeErrors` empty); `bindingOk` is true iff step 4 raises nothing (`bindingErrors` empty);
- `ok = envelopeOk ∧ bindingOk`, and `errors` is the sorted union;
- `vbEligible` is true only if `ok` and `META` passes VB-0.

An "honest" wrong-Viewer trace (NC-1a/NC-2a) therefore has `envelopeOk = true` but `ok = false`: the observed-Viewer check is part of the validator (step 4), so such a trace is **not** usable.

Any failure (`ok = false`) makes the **whole** trace unusable: committed `UNDIAGNOSABLE`, which maps to run verdict `INVALID` (§14). Validation results are derived files; the raw trace is never modified.

### 12.7 Projection and derived annotations

- **Projection.** The target window is projected to committed schema-1 live events exactly as P1 §8.3 specifies (P1 is the owner; this is a summary):
  - `RQ` pair → `FIT{r, pq, pd{nw}, cl, dg}` (an interleaved pair projects with `nw = 0`)
  - `PS` → `pd` on its host `CAM`/`SMP`
  - `FS` → `CAM`
  - `T4` start → `SST` for `G`/`S`; not projected for `P`
  - `T4` sample + its decision → one `SMP` for `G`/`S`; a `P` sample → `CAM`
  - a `G`/`S` settle with more than 64 samples is compacted: samples 1..63 → `SMP` `n = 1..63`, samples 64..last−1 → `CAM`, last sample → `SMP` `n = 64` with the terminal `d`/`fr`
  - `RS` pair → `RST`
  - `TE` → `AE` (all removed, and `V-EDGE` dropped, when `META.ei ≠ "LOW"`)
  - `TC` → `TC`

  `NV`, `C8`, `CT` and `TZ` are not projected (`NV` feeds only the offline numeric re-checks; `C8` is checked against I5). Control-window records are not projected. `q` is stamped as the projected position; `f` and `tm` are kept.
- **Representability.** If the target window holds a throwing `RQ post`, or the projection exceeds 8,192 events, P1 §8.3 returns `PROJECTION_UNREPRESENTABLE:<cause>` instead of calling the correlator. Every sound question is then `UNDIAGNOSABLE` with that reason, so every target is `INCONCLUSIVE` by T1. A committed `malformed` result on a projection that passed this check is a pipeline defect and stays `INVALID` (V2).
- **Configuration.** `{atoms: guard.atoms, idAxis: META.id, slotWindow: META.sw, mode: "live"}`, where `guard = applyVbGuard(META.at, {vg, vv, vd, vb, pc: {"VB-3": g}})` (committed, unchanged). Events and fields of a disabled `V-*` atom are removed before correlation, following the committed composition rule. The guard input `g` depends on the trace role (§11.2 "C6 guard input"; remediation of prototype finding 2):
  - **target trace:** `g = 1` iff `END.pc["VB-3"] = 1` **and** `PC-3` is re-derived `PASSED` from the control window; else `0`;
  - **control trace (`PC-2`/`PC-5` correlator expectations only):** `g = 1` iff that control's own fit → rise → visible step → fall → adjacent `TC` pattern is re-derived in the same trace; else `0` (the control is then `FAILED`). It never feeds a target verdict.
- **Single subject per trace.** P1 I4 allows `deciding = 1` at most once per trace, so a target trace has exactly one subject settle (`settleRole S`). Every pre-registered target refers to that subject.
- **Derived annotations** (P1 §9.5, §10.2). `GAP` records and the `preMotionUnresolved` flag are computed from raw records in Phase 5 and written to derived files. They never override the correlator (`correlatorOverride: false`). They feed rule T1b (§14.3).
- **Determinism.** Projection and annotations are pure functions of the validated raw trace and `governance/target-plan.json`. Phase 5 runs them twice, into two separate scratch directories outside the run root, and the two outputs must be byte-identical (P5.07) **before** anything derived is published into the run root (P5.08). If they differ (`SC-C03`), neither is published: the closeout path of §13.7 applies and the two scratch directories stay byte-unchanged.

---

## 13. Evidence package layout and provenance (future; nothing is created now)

### 13.1 Locations

| Role | Path (future) | Notes |
|---|---|---|
| diagnostic attempts directory | `test/acceptance/results/g2-live-diagnostic-attempts/` | **Kept separate** from the acceptance attempts directory `clashpanel-viewerbridge-g2-attempts/`. The acceptance harness's startup scan refuses to start if that directory holds any unparseable or foreign `*.reservation.json`/`*.journal.json` (`unreadable-reservation`). A diagnostic reservation placed there would therefore block future acceptance runs. Git-ignored (`.gitignore`: `test/acceptance/results/`) |
| raw run root (write-once) | `test/acceptance/results/g2-live-diagnostic/<authorizationId>/` | MUST be absent at P0.05. Created by the harness. Git-ignored |
| analysis scratch A and B (retained only on `SC-C03`) | `test/acceptance/results/g2-live-diagnostic-scratch/<authorizationId>/A/` and `.../B/` | **Outside** the run root; git-ignored. Created by P5.01–P5.07 and never rewritten, annotated or published. On the ordinary path they are not evidence. On `SC-C03` they are kept read-only and byte-unchanged as the raw artifacts that the closeout hashes (§13.7). A preservation copy is a separately owner-authorized act, as for the preserved evidence copy |
| preserved evidence copy | `docs/research/evidence/g2-diag-<authorizationId>/` | Byte-for-byte copy, made only by a **separately owner-authorized** preservation step (precedent: `docs/research/evidence/g2-live-20261004-75a3ccb9/`). No existing evidence directory is touched |

### 13.2 Directory tree and filenames (under the run root)

```
<authorizationId>/
  governance/
    authorization-record.md            raw: byte copy of the bound record (SHA-256 = META.ah)
    binding.json                       raw: binding record (§17), identical to the reservation's
    target-plan.json                   raw: byte copy of the pre-registered plan (canonical bytes; SHA-256 = binding.targetPlanSha256 = META.tq), P0.11
  preflight/
    phase0-static.json                 raw: P0.02–P0.09 results (digests, git state, toolchain gate, derived plan bounds)
    negative-controls.phase0.json      raw: full NC registry NC-1a…NC-21, every variant, expected vs observed (self-test, P0.06)
    live-preflight.json                raw: P0.12–P0.13 (observed vv, vd, VB-0, VB-1..3 structural, tag-wrapper availability, rr)
    meta-template.target.json          raw: frozen target META template (P1.04); likewise meta-template.pc-1/-2/-4/-5.json (P2.01)
  env/
    environment.json                   raw: node, playwright, browser version, platform/arch (no hostnames, users, absolute paths)
  raw/
    control/pc-1.records.jsonl         raw: Phase 2 control trace (META rl="PC-1"); likewise pc-2, pc-4, pc-5
    control/pc-1.trace.json            raw-derived-by-rule (§12.2 rule 4); likewise for each control
    target/target.records.jsonl        raw: Phase 3–4 target trace (META rl="T")
    target/target.trace.json           raw-derived-by-rule
    control-disposal.json              raw: P2.07 disposal of the probe and control contexts (written once)
    quiescence.json                    raw: P3.01 frames observed, outcome
    stop.json                          raw, only if a stop fired before the raw freeze (P4.06): {stopConditionId, step, attemptConsumed}
    teardown.json                      raw: P4.05 target-instance cleanup ledger, written once (failures recorded, never verdict-changing)
    stdout.log, stderr.log             raw: harness process streams, captured from process start, closed at P4.06 (allowlisted, §13.3 rule 8)
    hash-ledger.jsonl                  raw: append-only hash chain (§13.4); stays appendable until P5.11
  derived/
    integrity.<traceRole>.json         validateTraceV2 results, one per trace
    annotations.target.json            GAP records, preMotionUnresolved (P1 §9–§10)
    controls.json                      PC-1..PC-5 outcomes, RG
    negative-controls.phase5.json      rerun of the NC self-test
    projection.target.json             P1 §8.3 schema-1 array
    correlation.<slotWindowRun>.json   committed correlate outputs
    verdict.json                       per-target and run verdicts (§14)
  TERMINAL-VERDICT.json                derived: terminal verdict file (§13.5), published at P5.08 (ordinary path only)
  SC-C03-CLOSEOUT.json                 terminal: the SC-C03 withheld-closeout record (§13.7), written at P5.08 on the SC-C03 path only; replaces TERMINAL-VERDICT.json and derived/ (never both)
  MANIFEST.json                        derived: written last in the run root (P5.09); SHA-256 inventory (§13.6)
```

The diagnostic attempts directory holds three files per authorization id:
- `<authorizationId>.reservation.json`;
- `<authorizationId>.journal.json`, with the states from procedure §4.1: `AUTH_BOUND` → `PREFLIGHT_FAILED` | `ATTEMPT_CONSUMED` → `CLOSEOUT_STARTED` | `FAILED`;
- the terminal commit record `<authorizationId>.commit.json`, with `attemptId`, `terminalVerdict` (one of the five verdicts, or `WITHHELD` when `TERMINAL-VERDICT.json` has `verdictWithheld = true` or when the terminal carrier is `SC-C03-CLOSEOUT.json`), `terminalCarrierPath`, `manifestSha256`, `terminalVerdictSha256` (the SHA-256 of the file at `terminalCarrierPath`), `journalSha256` and `committedAt`. It is written at P5.12, after the run root is read-only (P5.11), as the last durable act.

These mirror the acceptance design's semantics. The acceptance harness's own files are **not** reused or modified.

### 13.3 Immutable-capture rules

1. **Write once.** Every file is created exclusively (`open(…, 'wx')`), written, `fsync`ed and closed, and then its directory is `fsync`ed.
   - If the path already exists, the run stops: `SC-A15` before `ATTEMPT_CONSUMED`, `SC-B07` after.
   - No file is ever reopened for writing.
   - The only exception is the JSONL traces. They are appended per record, `fsync`ed at least once per settle and at close, and never rewritten.
2. **Hash immediately.** On close, the writer reads the file back, computes its SHA-256 and byte length, and appends a hash-ledger line **before** the next file is created. A read-back mismatch is `SC-A15` before consumption and `SC-B07` after.
3. **No post-hoc editing; freeze order (H-2 remediation).** Raw files are never modified. A correction is a new derived file that names the digest it corrects (`supersedesSha256`). The finalization order is fixed (Appendix (iii) `finalizationOrder`, checked by the runbook validator):
   1. every raw file is complete: the target trace and its `trace.json` (P4.04), then `raw/teardown.json` (P4.05);
   2. **raw freeze** (P4.06): the process logs are closed, and every file under `governance/`, `preflight/`, `env/` and `raw/` is made read-only, except the append-only `raw/hash-ledger.jsonl`;
   3. Phase 5 analysis runs twice into two fresh scratch directories **outside** the run root and is compared byte for byte (P5.07);
   4. only then is the terminal set written into the run root (P5.08): on the ordinary path one derived set, with `TERMINAL-VERDICT.json`; on `SC-C03` only `SC-C03-CLOSEOUT.json` (§13.7), and neither scratch directory is published;
   5. `MANIFEST.json` is written (P5.09);
   6. a fail-closed post-publication consistency check of manifest, files and ledger (P5.10; failure ⇒ commit record `INVALID`);
   7. the whole run root, including the ledger, is made read-only (P5.11);
   8. the commit record is written last (P5.12).

   No step creates a file after the freeze that covers it, and no path is created twice. No scratch file is rewritten or annotated after step 3 on any path.
4. **Byte-for-byte copies.** The authorization-record copy and any later preservation copy are byte copies. Source and destination SHA-256 are asserted equal at copy time. Nothing is normalized: no line endings, encoding or whitespace are changed.
5. **Raw vs derived.**
   - `raw`, `governance`, `preflight` and `env` hold only bytes captured or produced in Phases 0–4.
   - `derived` holds only outputs of Phase 5. Each derived file is a deterministic function of raw files plus the bound pipeline, and it records the input digests it read. It can always be regenerated and never overrides a raw file.
   - `*.trace.json` files are "raw-derived-by-rule". Their bytes are fully determined by the JSONL via §12.2 rule 4, and that is checked by recomputing them.
6. **No mutation of historical evidence.** A run never creates, opens for writing, or modifies anything under `docs/research/evidence/`. Preservation is a separate act that needs owner authorization.
7. **Privacy (DS §6.5).** Traces contain no URNs (only their SHA-256), no property values, no user names, no hostnames, no absolute paths and no absolute timestamps. As in the acceptance design, absolute timestamps appear only in the journal and the commit record.
8. **Path handling and process logs (implementation-plan requirements, stated here).** Every component of the run root, the attempts directory and each created path is checked with `lstat` and must be a real directory or a newly created regular file: no symlink or other special file is followed (`O_NOFOLLOW` where available; a violation is `SC-A04` before consumption, `SC-B07` after). `stdout.log`/`stderr.log` are written through an allowlist filter: the harness prints only its own fixed-format status lines; any other line is replaced by its SHA-256 and byte length, so the logs cannot carry hostnames, user names, absolute paths, URNs or tokens (rule 7).

### 13.4 Hash ledger

`raw/hash-ledger.jsonl` holds one canonical JSON line per **file** of the run root: `{"bytes":int,"path":string,"phase":"P0".."P5","prevSha256":hex64,"seq":int,"sha256":hex64}`.
- **Closure (M-5 remediation).** Every write-once file gets its line when it is closed; an append-only file (a `*.records.jsonl` trace, `stdout.log`, `stderr.log`) gets its line when it is closed. Two files never get a line: the ledger itself (it cannot contain its own digest) and `MANIFEST.json` (written after the ledger is final). There is no non-file entry: the frozen `META` templates are files (`preflight/meta-template.*.json`, §12.3).
- `seq` starts at 1.
- `prevSha256` is the SHA-256 of the previous line's bytes. For `seq` 1 it is the authorization record's SHA-256.
- The ledger is append-only. Its last line is the one for the terminal carrier written at P5.08 (`TERMINAL-VERDICT.json`, or `SC-C03-CLOSEOUT.json` on `SC-C03`). `MANIFEST.json` records the SHA-256 of the final ledger bytes as `hashLedgerSha256` and lists the ledger **without** `ledgerSeq`; every other manifest entry carries the `seq` of its own ledger line (Appendix (v)).
- A missing, reordered or broken link is `SC-A15` before consumption, `SC-B07` after consumption (Phases 1–4), and makes the run `INVALID` when caught by the Phase 5 check.

### 13.5 Terminal verdict file

`TERMINAL-VERDICT.json` is one canonical JSON document (file bytes per §12.2 rule 6: exactly the canonical UTF-8 string, no trailing newline) with these keys:
- **Identity:** `schemaVersion: 1`, `authorizationId`, `attemptId`, `runId`.
- **Outcome:** `runVerdict` (one of the five verdicts), `runReasons` (ordered reason codes), `stopCondition` (an id, or `null`), `attemptConsumed` (bool), `verdictWithheld` (bool) and `withheldBy` (`SC-C04` or `null`; `SC-C03` never appears here, because an `SC-C03` run has no `TERMINAL-VERDICT.json`, see §13.7). When `verdictWithheld = true` (`SC-C04`, whose analysis A and B were byte-identical), `runVerdict` and the target verdicts are the evaluator's output kept for the owner's review only; they are **not** a diagnostic verdict, and the commit record and `MANIFEST.terminalVerdict` carry `WITHHELD`. A withheld outcome is never cited as `SUPPORTED`/`REJECTED`. (The offline scenario evaluator reports an injected `SC-C03` stop as `withheldBy: "SC-C03"` in its scenario row; that is an effect model for the scenario table and never the bytes of a `TERMINAL-VERDICT.json`.)
- **Targets:** an array of `{targetId, questionId, primary, oneSided, status, label, assumption, verdict, reason, reasons, controlCoverage}`. `reason` is the first matching rule's reason; `reasons` is the ordered list of every applicable rule reason (§14.3; the prototype calls it `allReasons`).
- **Controls:** `{PC-1..PC-5: PASSED|FAILED|NOT_RUN, RG: bool}`.
- **Integrity:** `{<traceRole>: {ok, errors}}`.
- **Annotations:** `{preMotionUnresolved, gapClasses}`.
- **Inputs:** `inputDigests`, the digests of the raw files that were read (including `governance/target-plan.json`).
- **Scope:** `scope: "NEW_RUN_ONLY"`.
- **Historical status:** `historicalStatus: {g2: "FAIL (row 3)", c6: "NOT_EVIDENCED", c8: "UNRESOLVED", t4: "UNCHANGED"}`. These are copied constants and are never computed.

### 13.6 Manifest

`MANIFEST.json` lists every file in the run root except itself; its schema is in Appendix (v). Its bytes are exactly the canonical UTF-8 string with **no trailing newline** (§12.2 rule 6), and `manifestSha256` is computed over those bytes. It is the last file written in the run root (P5.09); it is checked against the files and the ledger (P5.10), the run root is then made read-only (P5.11), and the commit record in the attempts directory is the last durable act (P5.12), and its `manifestSha256` binds the manifest.

### 13.7 `SC-C03` closeout: A/B mismatch (M1 correction; design only)

**The defect this corrects.** P5.06 writes `TERMINAL-VERDICT.json` into scratch A before P5.07 can know whether B equals A. Marking A "withheld" after the comparison would change the very bytes that were compared, and publishing A unchanged would leave no carrier for the withholding. The correction is structural: **A and B are never rewritten, and a separate deterministic closeout artifact records the decision.**

**Artifact roles.**

| Artifact | What it is | After an `SC-C03` mismatch |
|---|---|---|
| raw scratch analysis A, B | the files written by P5.01–P5.06 (A) and by the P5.07 rerun (B), in the scratch directories of §13.1 | preserved, read-only, **byte-unchanged**; non-authoritative; **not** published |
| compared artifact | the exact bytes of A and B that were hashed and compared at P5.07 (the same files, not copies or re-serializations) | identical to the raw scratch bytes; this is what the closeout hashes |
| promoted (published) derived artifact | `derived/*` and `TERMINAL-VERDICT.json` published at P5.08 | **none exists**; promotion is prohibited and neither A nor B becomes the authoritative analysis |
| `SC-C03` closeout record | `SC-C03-CLOSEOUT.json` (this section; schema in Appendix (viii)) | **authoritative for why promotion was withheld**; it is the run's terminal carrier |

Any summary (journal, review, handoff) refers to A and B by their hashes in the closeout. It never edits A or B and never quotes either as a diagnostic verdict.

**Procedure on mismatch.**
1. P5.07 hashes every file of A and of B and compares them per file; a path present in one directory only, or a differing byte, is a mismatch. The hash of an analysis (`bundleSha256`) is the SHA-256 of the canonical string of its sorted `{bytes, path, sha256}` file table (Appendix (viii) `bundleRule`).
2. The harness does **not** touch A or B again. It builds the closeout bytes from the frozen raw inputs' digests, the two file tables, the differing paths and the run identity. The closeout contains no timestamp, no absolute path and no evaluator output. It is therefore a pure function of those inputs: the same A and B bytes always produce the same closeout bytes (a run that is re-analysed and happens to give different A/B bytes is a different incident, with its own closeout).
3. P5.08 creates `SC-C03-CLOSEOUT.json` write-once and ledgers it as the last ledger line. It publishes no `derived/*` file and no `TERMINAL-VERDICT.json`.
4. P5.09 writes `MANIFEST.json` with `terminalCarrierPath = "SC-C03-CLOSEOUT.json"`, `terminalVerdict = "WITHHELD"` and `terminalVerdictSha256` = the closeout's SHA-256.
5. P5.10 checks the manifest, the ledger and the closeout. Because A and B are retained, it also **recomputes** the closeout from the raw inputs and the retained A and B and requires byte equality. A mutation of A or B after the comparison therefore fails closed (`SC-B07`, commit record `INVALID`).
6. P5.11 freezes the run root; P5.12 writes the commit record with `terminalVerdict = "WITHHELD"`.

**Ordering on the mismatch path** (every numbered item maps to the runbook step shown; nothing is mutated after item 4, and nothing is frozen before item 8):
1. write A (P5.01–P5.06, scratch);
2. write B (P5.07 rerun, scratch);
3. hash A and B (P5.07);
4. compare A and B (P5.07);
5. generate the deterministic closeout bytes and write them write-once into the run root (P5.08);
6. write the manifest entries (P5.09);
7. finalize the terminal metadata: `terminalVerdict`, `terminalCarrierPath`, `terminalVerdictSha256` (P5.09), and check it (P5.10);
8. compute the final manifest and stream hashes: `hashLedgerSha256`, `traceStreamSha256ByRole`, `manifestSha256` (P5.09, P5.10, P5.12);
9. freeze the run root (P5.11); then write the commit record (P5.12).

**Verdict semantics.**
- **Terminal verdict:** `WITHHELD` (commit record, `MANIFEST.terminalVerdict`, closeout). The run has no diagnostic verdict, and the five verdicts are never produced from A or B. `SC-C03` takes precedence over `SC-C04`: a withheld flag inside A or B is not carried.
- **Promotion:** prohibited. `promotion.eligible = false`, and `promotedAnalysis` and `authoritativeAnalysis` are `null`.
- **Evidence:** preserved. Raw evidence is untouched. A and B are retained byte-unchanged. The closeout and manifest are ledgered and frozen.
- **Journal:** stays `CLOSEOUT_STARTED` (class c, not `FAILED`).
- **Attempt:** the attempt stays consumed (`attemptConsumed = true`, consumed at P0.14). Nothing refunds or resets it. Any further attempt needs a separate owner authorization record; the closeout records `retryAuthorized = false` and `ownerDecisionRequired = true`, and no record is issued by this design.
- **Next state:** `awaiting owner decision`.

**Bounds** (Appendix (viii)): closeout ≤ 262,144 bytes; ≤ 128 files per analysis; ≤ 256 differing entries; every path ≤ 128 UTF-8 bytes. A count above a bound is a harness defect (`SC-B07`), never a truncation.


---

## 14. Diagnostic verdict model

### 14.1 Inputs

- **`stop` and `attemptConsumed`:** the stop condition that fired, if any (§15), and whether `ATTEMPT_CONSUMED` became durable.
- **`integrity[role]`:** the `validateTraceV2` result for each trace (§12.6).
- **`controls`:** the outcomes of `PC-1`…`PC-5`, plus `RG` (§11.4).
- **`ncRerun`:** the result of the Phase-5 negative-control rerun, as a boolean. Only `true` passes; an absent or non-boolean value is `INVALID` (`NEGATIVE_CONTROL_RERUN_UNKNOWN`), `false` is `INVALID` (`NEGATIVE_CONTROL_RERUN_MISMATCH`).
- **`ledger`:** a boolean, with the same fail-closed rule (`HASH_LEDGER_UNKNOWN` / `HASH_LEDGER_INCONSISTENT`). It is a **pre-publication** check only (the manifest does not exist yet): `true` iff the hash chain over the frozen raw set is intact (genesis, `prevSha256` links, and every raw file's bytes match its ledger line). Manifest consistency is **not** a verdict input; it is checked after publication by P5.10 (fail closed, below).
- **`targetPlan`:** the bytes of `governance/target-plan.json`. Its SHA-256 MUST equal `binding.targetPlanSha256` and `META.tq` of every trace (§14.2).
- **`annotations`:** `preMotionUnresolved` and the `GAP` classes (P1).
- **`envelope`:** `META.ei` (`edgeInit`) and `END.cg` (class gate).
- **Per pre-registered target `t`:** `qr = correlate(projection, cfg).questions[t.questionId]`, carrying `status` (`DEFINITE`/`AMBIGUOUS`/`UNAVAILABLE`/`UNDIAGNOSABLE`), `label`, `assumption` and `reason`. The correlator's `contradiction` and `malformed` outputs are also inputs.

### 14.2 Pre-registration (bound by `tq`)

`targetPlan.json` is one canonical JSON document `{planId, steps, targets}` with no other field (strict schema: Appendix (ii) `targetPlanSchema`). A byte copy is kept as `governance/target-plan.json` (§13.2).
- `steps`: the exact target sequence (§16 Phase 3), an array of `{op: "fit"}`, `{op: "restore"}`, `{op: "settle", role: "G"|"S"|"P"}` and `{op: "c8", role: "subject"|"superseded"}`, with no other field. It has exactly one subject settle, at most two `G` settles and at most one `P` settle, strictly sequential (P1 I4; CI-1 resolved), 1–8 fits and at most 4 restores. Every settle has a fit after the previous settle; a `P` settle comes after the `S` settle; exactly one `c8 subject` immediately after the `S` settle, and a `c8 superseded` iff a `P` settle, immediately after it.
- `targets`: an array of `{targetId, questionId ∈ {Q-OWNER, Q-SUBJ, Q-ATTR}, primary: bool, supportLabels: [], rejectLabels: []}`.

**Worst-case bounds are derived, never declared (M-8 remediation).** From the step counts and the bound frame budgets B1 (per fit or restore) and B_post (post-sequence), P0.08 derives `frames(r) = 1 + settles·(⌊deadlineMs·r/1000⌋ + 1) + (fits + restores)·B1 + B_post` and the largest admissible refresh rate `maxRefreshHz(plan)` = the largest integer `r ≤ 360` with `frames(r) ≤ targetWindowFrames`. It also derives the worst-case raw record count and projected event count at that rate (Appendix (ii) `derivedBounds`, the §12.4a terms with the plan's counts). `SC-A07` fires if `maxRefreshHz(plan) = 0` or either count exceeds its cap (`ec.max`/24,576; 8,192); P0.13 then requires the measured `rr ≤ maxRefreshHz(plan)` (`SC-A17`). For example, the four-settle P6 shape with zero budgets gives `maxRefreshHz = 178`, and less once B1/B_post are bound (§22.2).

**Binding and conformance at Phase 5 (H-1, M-8 remediation).**
- **Digest binding.** The evaluator reads the plan from `governance/target-plan.json` and requires `sha256(canonicalBytes(plan)) = binding.targetPlanSha256 = META.tq` of every trace; otherwise the run is `INVALID` (`TARGET_PLAN_DIGEST_MISMATCH`). A plan edited after capture, or any plan file other than the bound one, can therefore never produce `SUPPORTED`/`REJECTED`.
- **Conformance.** The target window's plan-relevant records, in `seq` order, are mapped to steps: a **top-level** `RQ` post → `fit` (an `RQ` pair nested inside another call is an open-world call, I1, not a plan step); an `RS` post → `restore`; a `T4` start → `settle(settleRole)`; a `C8` → `c8(measureRole)`. The mapped list MUST equal `steps`, except that a `c8` step is expected iff its settle's terminal decision is `settled` (a timed-out settle has no `C8`, NC-16). Each settle's `reqToken` MUST be the latest top-level fit's token or a call nested in it. A mismatch (a missing, extra or reordered step) is `INVALID` (`TARGET_PLAN_NONCONFORMANT`). A foreign top-level wrapped `fitToView` or restore cannot be told apart from a deviation and therefore also fails closed.

Phase 0 (P0.08) validates the plan mechanically:
- **Label sets.** `supportLabels ∩ rejectLabels = ∅`, and every label is in the question's live domain:
  - `Q-OWNER` ∈ {`INIT`, `RESTORE`, `OWN`, `PRIOR_TERMINAL`, `IN_FLIGHT`};
  - `Q-SUBJ` ∈ {`PENDING`, `ACTIVE_PLUS`, `COMPLETE`};
  - `Q-ATTR` ∈ non-empty ascending comma-joined token lists.
- **Labels that are never allowed.**
  - `FOREIGN` and `ACTIVE0` are never definite (committed).
  - `Q-ATTR` `"-"` carries no attribution and must not be treated as positive evidence (P1 §6.2 note).
- **Unsound questions.** A target on any of the ten questions without a sound procedure is rejected (`SC-A16`).
- **Reachability under the bound `slotWindow`.**
  - Under `OPEN`, the only labels that can be definite are `Q-OWNER` ∈ {`INIT`, `RESTORE`} and `Q-SUBJ` = `PENDING` (P1 Appendix `openLabels`). Every `Q-ATTR` target is therefore unreachable under `OPEN`.
  - `supportReachable` and `rejectReachable` are computed for each target.
  - A target with neither side reachable is rejected (`SC-A16`).
  - A target with only one side reachable is accepted but flagged `oneSided: true` in every output.
- **Primary target.** At least one target has `primary: true`.
- **Steps.** The step schema and order rules above, and the derived bounds (`SC-A16` for a schema or order violation, `SC-A07` for the bounds).

### 14.3 Target-level rules (first matching rule wins)

The target **verdict** and its `reason` come from the first matching rule. The target also reports `reasons`: the ordered list of the reasons of **every** rule T0b…T3 that applies (in table order), followed by the `FORBIDDEN_LABEL` belt-and-braces reason if it applies; for a target decided by T0, T4, T5 or T6 the list holds that rule's reason only. `reasons` is diagnostic. It never changes the verdict, and it lets an expectation name a cause that a higher rule shadows (NC-15: T1 matches first, and T3a's `EDGE_INIT_UNKNOWN` is in `reasons`).

| # | Condition | Target verdict | Reason |
|---|---|---|---|
| T0 | run verdict is `BLOCKED` or `INVALID` (§14.4) | same as the run | inherited |
| T0b | `END.cg = 1` (P1 §8.5) | `INCONCLUSIVE` | `CLASS_NONTRANSITIVE` |
| T0c | an `SC-C04` contradiction: mechanically, a token visible again after its object left the slot (P1 §10.4a), or any other `SC-C04` stop. The verdict is also withheld | `INCONCLUSIVE` | `SOURCE_FACT_CONTRADICTION:TOKEN_REAPPEARED` (or `:SC-C04`) |
| T1 | `qr.status ≠ DEFINITE` (`AMBIGUOUS`, `UNAVAILABLE` or question-level `UNDIAGNOSABLE`) | `INCONCLUSIVE` | `qr.reason`, e.g. `UNOBSERVED_SLOT_WINDOW`, `ACTIVE_WITHOUT_VISIBLE_STEP`, `IDENTITY_AMBIGUOUS`, `VB_UNAVAILABLE:VB-n`, `OBSERVABLE_ABSENT:<atom>`, `NO_CAPTURE_BASELINE`, `UNREAD_WRITER`, `NO_DECIDING_SAMPLE` (subject zero-sample timeout; the committed correlator reports `TRUNCATED` and the evaluator renames it), `PROJECTION_UNREPRESENTABLE:<cause>` |
| T1b | `preMotionUnresolved`, and either `questionId = Q-OWNER` or `questionId = Q-SUBJ` with a non-`DEFINITE` `qr` (P1 §9.5) | `INCONCLUSIVE` | `PRE_MOTION_UNRESOLVED` |
| T1c | a `CLEAR_WITHOUT_EDGE` GAP cleared a token the label depends on (P1 §10.4): `Q-SUBJ` when the subject token was cleared; `Q-OWNER` with a token label (`OWN`/`PRIOR_TERMINAL`/`IN_FLIGHT`) when any token was cleared; `Q-ATTR` when a listed token was cleared | `INCONCLUSIVE` | `IDENTITY_AMBIGUOUS:CLEAR_WITHOUT_EDGE` |
| T2 | `qr.assumption` is present and the bound `slotWindow ≠ ASSUME_NO_UNOBSERVED_WRITER` | `INCONCLUSIVE` | `ASSUMPTION_NOT_AUTHORIZED` |
| T3a | the label depends on `V-EDGE` (any `Q-OWNER`/`Q-SUBJ` label, or a non-empty `Q-ATTR` list) and `META.ei = "UNKNOWN"` | `INCONCLUSIVE` | `EDGE_INIT_UNKNOWN` |
| T3 | the label depends on `V-EDGE` and `RG` is false | `INCONCLUSIVE` | `VB3_NOT_REPRESENTATIVE` |
| T4 | `qr.label ∈ rejectLabels` | `REJECTED` | `PREREGISTERED_REJECT` (+ the assumption tag, if present) |
| T5 | `qr.label ∈ supportLabels` | `SUPPORTED` | `PREREGISTERED_SUPPORT` (+ the assumption tag, if present) |
| T6 | otherwise | `INCONCLUSIVE` | `LABEL_NOT_PREREGISTERED` |

These rules have the following consequences, all of which hold mechanically.

**Scope of "ambiguous" (normative; M-2 remediation).** Ambiguity is assessed **per pre-registered primary target question**, not per trace. The exact rule is: a run is `SUPPORTED`/`REJECTED` only if every whole-trace condition of V2 holds and every **primary** target's own question is `DEFINITE` with a pre-registered label that no rule T0b, T0c, T1b, T1c, T2, T3a or T3 excludes. Two consequences follow, and both are intended:
- A **non-primary** target may be `AMBIGUOUS` in a `SUPPORTED` run (e.g. `valid-complete`: primary `Q-SUBJ = PENDING`, non-primary `Q-OWNER` ambiguous). Non-primary targets are diagnostic only (§14.4).
- **`Q-SUBJ = PENDING` may be `SUPPORTED`/`REJECTED` under pre-motion or a pending-clear gap**, precisely when the committed correlator returns it `DEFINITE`: the deciding read `PS(hostSeq = D.seq)` shows the subject's own bound object in the slot, with no earlier `"U"` read (P1 §6.3, §9.5, §10.4). This is identity evidence, not order: a consumption clears the slot (V:105009) before the rise (V:107122) in one synchronous stack, so an object still visible at `t_d` was not consumed. It is withdrawn by T1c if a `CLEAR_WITHOUT_EDGE` gap cleared the subject token, and by T0c if that token reappears (a source-fact contradiction).

A trace-wide rule ("any ambiguous question anywhere makes the run `INCONCLUSIVE`") is **not** adopted: under `OPEN`, `Q-ATTR` is never definite when a `TC` exists, so such a rule would make `SUPPORTED` unreachable for every plan while adding no soundness, because non-primary outputs never feed a verdict.

Under this rule, **no ambiguous primary target can be `SUPPORTED` or `REJECTED`**:
- Every non-`DEFINITE` status stops at T1, and every whole-trace failure stops at T0.
- The committed correlator reports `ORDER_ONLY` attributions as `AMBIGUOUS`, so they also stop at T1.
- Pre-motion stops every `Q-OWNER` target at T1b, and every `Q-SUBJ` target at T1/T1b unless the deciding read is a definite `PENDING` (above). The slot-window gap stops every token-dependent output at T1 (`UNOBSERVED_SLOT_WINDOW`), with the same `PENDING` exception; `CLEAR_WITHOUT_EDGE` stops the cleared token's outputs at T1c, and a reappearing token stops every target at T0c.
- An unknown boundary edge state stops at T1 (the projection drops `V-EDGE`, so no edge-dependent label is definite). T3a also applies, so `EDGE_INIT_UNKNOWN` is always in `reasons` for an edge-dependent target; if a label were somehow still `DEFINITE`, T3a is the rule that stops it (belt and braces). The rule order is deliberate and unchanged: the first `reason` is the correlator's own non-definite reason.
- A non-transitive camera class relation stops at T0b. A subject zero-sample timeout and an unrepresentable projection stop at T1.

**Owner, subject and attribution requirements** are inherited from the committed C1 table (DS §6.3):
- `Q-OWNER` needs `V-EDGE` (positive evidence that no transition is active). It also needs `ID-ON` for `OWN`/`PRIOR_TERMINAL`, the capture-start `FS` for `INIT`, and the restore's own post-call read (`P-FRM`) for `RESTORE`.
- `Q-SUBJ` needs `V-PEND`, `V-EDGE` and `ID-ON`.
- `Q-ATTR` needs `P-TC`. A non-empty list additionally needs `V-EDGE`, `V-PEND`, `ID-ON` and the assumption.
- Public-only data gives 0 definite labels (committed). A run whose `V-*` atoms are disabled can therefore only produce `INCONCLUSIVE` targets.

**`controlCoverage` reporting:**
- `CONTROLLED` for `RESTORE` (PC-5) and for assumption-mode ownership or attribution (PC-2);
- `MECHANISM_ONLY` for `PENDING` (the gap in §11.2);
- `NONE` otherwise.

### 14.4 Run-level rules (first matching rule wins)

| # | Run verdict | Required condition | Disqualifiers / notes |
|---|---|---|---|
| V1 | `BLOCKED` | `attemptConsumed = false`: a class-a stop fired (§15), or `ATTEMPT_CONSUMED` was never reached | no trace, or only pre-consumption preflight files. Never a hypothesis verdict |
| V2 | `INVALID` | `attemptConsumed = true` **and** any of: a class-b stop fired; the target trace is absent; any `integrity[role].ok = false`; any of `PC-1`, `PC-2`, `PC-4`, `PC-5` ≠ `PASSED`; the `TZ final` `tzCause ≠ normal`; the Phase-5 NC rerun is not exactly `true`; the pre-publication raw hash-ledger gate is not exactly `true` (manifest consistency is checked after publication, P5.10); the correlator reports `contradiction` (C3) or `malformed` (C8) on the target projection; `BINDING-MISMATCH`, `OBSERVED_VIEWER_NOT_BOUND` or `OBSERVED_BUNDLE_NOT_BOUND`; the target plan is invalid, its digest ≠ `binding.targetPlanSha256`/`META.tq` (`TARGET_PLAN_DIGEST_MISMATCH`) or the trace does not conform to it (`TARGET_PLAN_NONCONFORMANT`); a control trace is not linked to the target run (`CONTROL_RUN_NOT_LINKED`); a trace file of an unknown role (`UNKNOWN_TRACE_ROLE`) | "Integrity" covers every committed, P1 and Part-2 integrity code, including truncation, overflow, `iv > 0`, and digest, sequence and envelope mismatches |
| V3 | `INCONCLUSIVE` | otherwise, any **primary** target is `INCONCLUSIVE` | covers a `PC-3` failure (C6), an `RG` failure, `edgeInit = "UNKNOWN"`, `END.cg = 1`, a subject zero-sample timeout, an unrepresentable projection, pre-motion, the slot-window gap, `"U"` bindings, `CLEAR_WITHOUT_EDGE` (T1c) and a reappearing token (T0c, also withheld) |
| V4 | `REJECTED` | otherwise, any primary target is `REJECTED` | — |
| V5 | `SUPPORTED` | otherwise (every primary target is `SUPPORTED`) | requires: whole-trace integrity of every trace; `PC-1`/`PC-2`/`PC-4`/`PC-5` = `PASSED`; `META.ei = "LOW"`; `END.cg = 0`; and every primary target `DEFINITE`, with a pre-registered support label not excluded by T0b/T0c/T1b/T1c/T2/T3a/T3 |

**Total precedence order:** `BLOCKED` > `INVALID` > `INCONCLUSIVE` > `REJECTED` > `SUPPORTED`. When several conditions apply, the verdict that comes earliest in this order wins. This holds for the run verdict and for T0 inheritance. Non-primary targets are reported individually and never change the run verdict.

**Every verdict has scope `NEW_RUN_ONLY`.**
- No verdict is evidence about R1.
- No verdict changes G2 `FAIL (row 3)`, C6 `NOT_EVIDENCED`, historical C8 (unresolved) or T4 (DS §6.5 item 6; research O-29).

---

## 15. Future-live stop conditions

**Classes.**
- **(a) Stop without consuming the attempt; the run verdict is `BLOCKED`.**
  - **a1** fires *before any live invocation* (no browser, no Viewer). If it fires before W2 (`AUTH_BOUND`), the record stays **unspent**.
  - **a2** fires after the live preflight has invoked the browser or the Viewer script, but before `ATTEMPT_CONSUMED`. The journal records `PREFLIGHT_FAILED`. The attempt is **not consumed** but the record is **spent**. This mirrors the accepted procedure's rule for preflight failures versus consumed attempts.
- **(b) The attempt is consumed and the run is classified `INVALID`.** This class fires at or after the durable `ATTEMPT_CONSUMED`. There is never a retry.
- **(c) Other.** The run remains valid but degraded (targets `INCONCLUSIVE`), or the condition is only recorded, or it needs an owner decision.

**Consumption boundary (a design choice; see OD-5).** `ATTEMPT_CONSUMED` is made durable **before the first model load in either Viewer instance**, which means before the Phase 2 controls.
- Consuming the attempt before the controls rules out "retry until the controls pass".
- The acceptance procedure's boundary is before the first `loadDocumentNode`. This boundary is stricter than that one and consistent with it.

This design does **not** change the current authorization procedure or the acceptance harness. It applies only to a future diagnostic harness.

| ID | Condition (prompt §15 example) | Detected at | Class |
|---|---|---|---|
| `SC-A01` | dirty protected state: `git status --porcelain` not empty (except the record under `docs/prompts/`, per the historical rule), or HEAD ≠ the bound `repoCommit` | P0.02 | a1 |
| `SC-A02` | procedure or harness digest mismatch: any of the diagnostic harness, package, spec, procedure (≠ `d1cc…`), acceptance harness (≠ `cc88…`, a protected-state check) or target plan ≠ its bound value | P0.03 | a1 |
| `SC-A03` | the authorization is absent, malformed, not unique, superseded or already spent (a reservation, journal or commit exists for its id), **or** the active-authorization state is ambiguous (a `G2-LIVE-EXECUTION:` line in the diagnostic record; more than one non-superseded diagnostic record) | P0.04 | a1 |
| `SC-A04` | the output directory is not absent, or the attempts directory is not a real directory | P0.05 | a1 |
| `SC-A05` | the Phase-0 negative-control self-test ≠ expected | P0.06 | a1 |
| `SC-A06` | `META` validation failure (`validateMetaV2`, or size > 1,536 B) | P0.07 / P1.04 | a1 |
| `SC-A07` | buffer bound too small, from the **derived** plan bounds (§14.2): `maxRefreshHz(plan) = 0` (the plan does not fit `targetWindowFrames` at any rate); its worst-case raw record count exceeds `ec.max` or 24,576; its worst-case projected count exceeds 8,192; or `PC-3`'s B3 exceeds `controlWindowFrames` | P0.08 | a1 |
| `SC-A08` | runtime toolchain mismatch: node, playwright or browser is not the bound exact version, or a debug, remote or platform override is set | P0.09 (static) / P0.12 (launched browser) | a1 / a2 |
| `SC-A09` | wrong Viewer version (`vv ≠ "7.124.2"`, strict comparison) | P0.13 | a2 |
| `SC-A10` | Viewer bundle digest mismatch (`vd ≠ 12b9fe49…c02e`) | P0.13 | a2 |
| `SC-A11` | a required VB observable is unavailable (VB-1 or VB-3 structural presence is 0) | P0.13 | a2 |
| `SC-A12` | request tagging unavailable: the `fitToView` call path cannot carry the P1 RQ pre/post reads (structural check) | P0.13 | a2 |
| `SC-A13` | capability mismatch: atoms, ID axis or slot window ≠ the binding | P0.07 / P0.13 | a1 / a2 |
| `SC-A14` | durability failure in W2a/W2b (mkdir, open, write, fsync or rename) | P0.10 | a1 (the record stays unspent only if nothing survived, as in procedure §4.1) |
| `SC-A15` | evidence-writer failure before consumption, or failure to make `ATTEMPT_CONSUMED` durable (in which case the attempt is not consumed) | P0.11 / P0.14 | a2 |
| `SC-A16` | invalid pre-registered target plan: a field outside the strict schema (Appendix (ii) `targetPlanSchema`), an unsound question, overlapping or out-of-domain labels, `"-"` used as a label, neither side reachable, no primary target, a settle-role count outside S = 1, G ≤ 2, P ≤ 1, a step-order rule violated, more than 8 fits or more than 4 restores | P0.08 | a1 |
| `SC-A17` | refresh rate out of bound: the rAF rate measured in the target page exceeds 360 Hz (`cp.maxRefreshHz`) or the plan's derived `maxRefreshHz(plan)` (§14.2), i.e. the plan's worst-case duration at the measured rate exceeds `targetWindowFrames` | P0.13 | a2 |
| `SC-B01` | hook install or verification failure (listeners, tag wrapper, sampler); a second recorder in a page (refused, P1 §8.6); or a control page failing its own VB-0/structural re-check | P1.02–P1.04 / P2.01 | b |
| `SC-B02` | control failure before target capture (`PC-1`, `PC-2`, `PC-4` or `PC-5` ≠ `PASSED`) | P2.06 | b |
| `SC-B03` | quiescence not reached within the bound frame budget | P3.01 | b |
| `SC-B04` | recorder overflow (C5), truncation (no `END`), or `iv > 0` | P3/P4 | b |
| `SC-B05` | page or Viewer crash, harness exception, or whole-attempt deadline | any step after P0.14 | b |
| `SC-B06` | trace-integrity failure found at close or in Phase 5 (any §12.6 code) | P4.04 / P5.01–P5.03 | b |
| `SC-B07` | evidence write-once or hash failure (existing path, read-back mismatch, broken hash chain, a symlink or special file in a path, a freeze that fails) | after P0.14 (incl. P4.06, P5.08–P5.12) | b |
| `SC-B08` | a target-plan step cannot be issued as specified. There is no re-issue; the harness writes `TZ{targetEnd}` and `TZ{final, tzCause:"stop"}` | P3.03 | b |
| `SC-C01` | the post-capture `PC-3` failed | P4.01 | c (the C6 guard disables `V-EDGE`, targets become `INCONCLUSIVE`, and the run is not `INVALID`) |
| `SC-C02` | listener-removal failure at `TZ final` (`END.lr = 0`) or teardown/cleanup failure after `END` | P4.02 / P4.05 | c (recorded in `END.lr` and `raw/teardown.json`; the verdict is unaffected) |
| `SC-C03` | the Phase-5 analysis is not byte-identical across its two scratch runs | P5.07 | c (raw evidence stays frozen; A and B stay byte-unchanged and unpublished; the run's terminal carrier is the separate `SC-C03-CLOSEOUT.json`, commit record and manifest `WITHHELD`; promotion prohibited; attempt stays consumed; owner decision, §13.7) |
| `SC-C04` | a finding contradicts a committed conclusion, such as a schema-1/2 invariant or a Viewer source fact; mechanically detected case: a token visible again after its object left the slot (`TOKEN_REAPPEARED`, P1 §10.4a) | P5 | c (every target `INCONCLUSIVE` by T0c; verdict **withheld**; persist under `docs/reviews/`, and mark `awaiting owner decision`) |
| `SC-C05` | a written target trace has `META.ei = "UNKNOWN"` (only possible under a non-conforming procedure, since P3.01 does not end before an exact boundary read) | P5.04 | c (`V-EDGE` dropped; edge-dependent targets `INCONCLUSIVE(EDGE_INIT_UNKNOWN)`) |
| `SC-C06` | `END.cg = 1` (`CLASS_NONTRANSITIVE`) | P5.04 | c (every target `INCONCLUSIVE`) |
| `SC-C07` | projection not representable (`FIT_THREW` or `CAPACITY`, P1 §8.3) | P5.05 | c (every target `INCONCLUSIVE`) |

A stop before consumption never produces a trace, so it can never appear as `INVALID` evidence.

**While the harness process is alive**, a stop after consumption leaves `raw/stop.json` (if raised before the raw freeze), a trace terminalized through `TZ final` with `tzCause` set to `stop` or `error`, and the normal finalization (P4.05 onward). The verdict is `INVALID` (class b), or the run stays valid but degraded (class c). This guarantee is **conditional on the finalizer running** (M-9 remediation).

**Process death after consumption** (kill, power loss, host crash) cannot write `stop.json`, freeze, publish or commit. The journal then stays `ATTEMPT_CONSUMED` (or `CLOSEOUT_STARTED`) with no commit record, and the attempt is **consumed and unclassified**. It is never resumed live and never retried. The only permitted follow-up is a **recovery closeout**, which needs its own explicit owner authorization and is offline only:
1. preserve the run root byte for byte (no truncation of a partial JSONL line; a partial last line is kept and reported);
2. classify every trace without `END` as `TRUNCATED`, so the run verdict is `INVALID` (`SC-B05`);
3. run Phase 5 on the preserved bytes with `stopCondition = SC-B05` (P5.01–P5.12, idempotent: an already existing derived file with the same bytes is accepted, a differing one is `SC-B07`);
4. write the commit record and set the journal to `FAILED`.

No browser, Viewer or network is used, and no live step is re-entered.

---

## 16. Future run sequence (runbook): **NOT EXECUTED, design only**

Every step below is a design. None has been executed, and none is authorized. Executing any of them would require all three of the following:
1. owner authorization to implement a diagnostic harness, which is a phase transition;
2. an owner-issued diagnostic authorization record, in the format the owner decides under OD-1;
3. a separate, explicit live-execution authorization.

Step ids are stable. `onFail` names the stop condition (§15).

**Per-step owner-authorization marker** (Appendix (iii) `requiresFutureOwnerAuthorization`, a boolean on every step; remediation of ancillary finding (a)). It is `true` for every step that launches or drives a browser, page or Viewer, spends the authorization record, consumes the attempt, or runs inside the consumed attempt before offline analysis: **P0.10–P0.14 and every step of P1–P4**. It is `false` only for the static, pre-reservation checks P0.01–P0.09 and the offline analysis P5.01–P5.12. **`false` never means "executable now"**: the runbook-level `executed: false` / `authorized: false` and the three conditions above apply to every step, and a P5 step has nothing to analyse without an authorized run. The marker identifies the steps that need the separate live-execution authorization (condition 3) on top of conditions 1–2.

### Phase 0: static preflight, reservation, live preflight (no target action; nothing consumed)

- [ ] **P0.01** Interlock: check the exact command, flag and environment taken from the binding (`exactCommand`). If any is missing, exit with no state change (this happens before a1).
- [ ] **P0.02** Repo state: on `main`, HEAD = `repoCommit`, and the tree is clean apart from the bound record path. onFail `SC-A01`.
- [ ] **P0.03** Hashes: the diagnostic harness, `diagnosticPackageSha256`, `diagnosticSpecSha256`, `procedureSha256` (= `d1cc…`), the acceptance harness (= `cc88…`, unchanged), `targetPlanSha256` and the model URN digests. onFail `SC-A02`.
- [ ] **P0.04** Authorization record. onFail `SC-A03`. Check all of the following:
  - path syntax, with no symlink component, and strict UTF-8 content;
  - the diagnostic marker set (OD-1), with no `G2-LIVE-EXECUTION:` line;
  - exactly one non-superseded diagnostic record;
  - no reservation, journal or commit for this id in the diagnostic attempts directory;
  - the acceptance attempts directory is not touched.
- [ ] **P0.05** Output: the run root is absent, and the attempts-directory chain is made of real directories. onFail `SC-A04`.
- [ ] **P0.06** Negative-control self-test: run the **full ordered registry** `NC-1a`…`NC-21`, every variant (Appendix (vii) `selfTestRegistry`, including the `edgeInit`, zero-sample, long-settle, superseded-`C8`, late-callback, recorder-ordinal and unrepresentable-projection controls `NC-15`…`NC-21`), through the bound pipeline and compare against the expected table (canonical form, SHA-256; registry and expected-results digests recorded). onFail `SC-A05`.
- [ ] **P0.07** Build the `META` templates (target and each control) from the binding, and validate their static part. onFail `SC-A06`/`SC-A13`.
- [ ] **P0.08** Validate `targetPlan.json`. onFail `SC-A07`/`SC-A16`. Check:
  - the §14.2 rules, including the strict step schema and order rules (Appendix (ii) `targetPlanSchema`);
  - settle roles: exactly one `S`, at most two `G`, at most one `P`, sequential; 1–8 fits and at most 4 restores;
  - the **derived** bounds (§14.2; nothing is taken from a declared duration): `maxRefreshHz(plan) ≥ 1`; the worst-case raw count at that rate `≤ ec.max ≤ 24,576`; the worst-case projected count `≤ 8,192`; B3 `≤ controlWindowFrames` (1,801); the derived values are written to `preflight/phase0-static.json`;
  - at most 1,801 samples per settle (P1 §8.4a; the committed 64 is not inherited);
  - the reachability flags.
- [ ] **P0.09** Toolchain gate: node, playwright and browser at their exact bound versions, and no debug, remote or platform overrides. onFail `SC-A08`.
- [ ] **P0.10** W2a/W2b: create the diagnostic attempts-directory chain durably, take the exclusive reservation (content: `binding.json`), and write journal state `AUTH_BOUND`. From here on **the record is spent**. onFail `SC-A14`.
- [ ] **P0.11** Evidence writer. onFail `SC-A15`. In order:
  - create the run root (`wx`; no symlink component, §13.3 rule 8) and the hash-ledger genesis;
  - write `governance/` (the authorization-record copy, `binding.json` and the byte copy `target-plan.json`, whose SHA-256 is asserted equal to `targetPlanSha256`), `preflight/phase0-static.json`, `preflight/negative-controls.phase0.json` and `env/environment.json`, hashing each one immediately;
  - start capturing stdout and stderr through the allowlist filter (§13.3 rule 8).
- [ ] **P0.12** Launch the browser with two **separate contexts**: the target context and one disposable probe context. Load the Viewer script in a page of each through the route-verified path, compute `vd` over the served `viewer3D.js` bytes, and read `LMV_VIEWER_VERSION`. No model is loaded. onFail `SC-A08` (a2).
- [ ] **P0.13** In both pages, check the VB-0 exact pin, VB-1…VB-3 structural presence, structural availability of the tag wrapper, and that the configured atoms equal the binding. In the target page, measure the rAF rate over a bound number of frames (`rr`) and check it against 360 Hz and the plan's derived `maxRefreshHz(plan)` (§14.2). Write `preflight/live-preflight.json`. onFail `SC-A09`…`SC-A13`, `SC-A17` (a2; journal `PREFLIGHT_FAILED`).
- [ ] **P0.14** Make journal state `ATTEMPT_CONSUMED` durable. This is the consumption boundary: from here on there is no retry, and every failure is class b or c. onFail `SC-A15`.

### Phase 1: instrumentation initialization (no target action)

- [ ] **P1.01** Load fixtures A and B in the target page. The diagnostic makes no fit, restore or camera call. (Control pages are created and loaded per control in P2.01.)
- [ ] **P1.02** Construct the page's single recorder (P1 §8.6, `rc = 1`; state `CREATED`) and install the P1 §7 hooks in the target page. None of them may mutate Viewer state, and no `CE` listener is installed (P1 CP12). onFail `SC-B01`. The hooks are:
  - a `CAMERA_TRANSITION_COMPLETED` listener (`TC`), not removed during capture (the recorder removes it only on entering `FINALIZING`, P4.02);
  - a `TRANSITION_ACTIVE_FLAG_CHANGED` listener (`TE`, VB-3);
  - the rAF sampler (`FS` + `PS`);
  - the request-tag wrapper, with synchronous slot reads before and after the call (`RQ`, VB-1);
  - the restore wrapper (`RS`);
  - the T4 sample/decision tap (`T4`, `NV`, `PS`);
  - the C8 tap.
- [ ] **P1.03** Verify the hooks structurally: each listener is registered, each wrapper identity is in place, and the sampler ticks without emitting. onFail `SC-B01`.
- [ ] **P1.04** Fill the observed `vv`/`vd`/`vg`/`vb`/`br`/`rr` and `rc` into the target `META` template (all fields except `ei`, `ba`, `bp`, `lb`, `qe`, §12.3), then validate it, freeze it, and write it once as `preflight/meta-template.target.json` (hashed and ledgered like every file). onFail: `SC-A06`, which is treated as `SC-B01` because the attempt is already consumed.

### Phase 2: controls (one fresh disposable page per control; only if a future live authorization permits)

- [ ] **P2.01** Run the controls in the order `PC-1`, `PC-2`, `PC-5`, `PC-4`. For each control, create a **fresh disposable context and page** (one recorder per page, P1 §8.6), load the Viewer script and fixtures, re-check VB-0/VB-1…VB-3 structurally (onFail `SC-B01`), construct its recorder and install its hooks (state `CREATED`), freeze its `META` template (`rl` = the control id; `run` = `<runId>-pcN`) and write it once as `preflight/meta-template.pc-N.json`, wait for quiescence, then in one synchronous segment take the boundary read, write `META` and the capture-start `FS` (`CAPTURING`).
- [ ] **P2.02** Run `PC-1` (§11.2). Then terminalize its trace in the §12.4 / P1 I6 order **`TZ targetEnd` → `CT` → `TZ final` → `END`** (the control window holds exactly the one `CT`), flush, derive `pc-1.trace.json`, and hash both (Appendix (iii) `controlTraceOrder`).
- [ ] **P2.03** Run `PC-2` the same way.
- [ ] **P2.04** Run `PC-5` the same way.
- [ ] **P2.05** Run `PC-4` the same way.
- [ ] **P2.06** Evaluate the controls with the **bound** evaluator. If any outcome ≠ `PASSED`, raise `SC-B02`, dispose of the control contexts (P2.07), skip Phase 3 and P4.01–P4.04 (no target trace), and continue at P4.05. The run verdict is `INVALID`.
- [ ] **P2.07** Dispose of every disposable context (the probe context and each control context) completely before Phase 3, and record the disposals once in `raw/control-disposal.json` (a file of its own, so `raw/teardown.json` is written exactly once, at P4.05).

### Phase 3: target diagnostic sequence (target instance)

- [ ] **P3.01** Quiescence check (read-only, recorder in `CREATED` with its listeners already registered): the slot is null, the transition is inactive, and no edge occurs for the bound number of consecutive frames within the bound budget. The check ends only on an exact boundary read (`getTransitionActive() === false`, `getRequestTransition() === null`, P1 §8.4). Write `raw/quiescence.json`. onFail `SC-B03`.
- [ ] **P3.02** In the **same synchronous segment** as the final boundary read: fill `ei`/`ba`/`bp`/`lb`/`qe`, write `META` (`rl = "T"`) as record 0, then the capture-start `FS` (+ `PS`) at `frame = 0`, `tRel = 0` (`CREATED → CAPTURING`). A conforming run always writes `ei = "LOW"`.
- [ ] **P3.03** Execute `targetPlan.steps` **exactly once each, in order**: no retry, no re-issue, no parameter change and no acceptance semantics. The plan's content is an owner decision (OD-4).
  - Design candidates within the P1 settle roles (CI-1 resolved):
    - **minimal G/S pair:** fit `N−1` → `G` settle; an optional restore (`RS` pair); subject fit `N` → `S` settle with `deciding = 1` → subject `C8`;
    - **full historical P6 shape:** restore + N2 fit → `G` settle; C6 aggregate fit → `G` settle; C8 per-model fit → `S` settle → subject `C8`; superseding p2 fit → `P` settle → superseded `C8`.
  - Each fit records an `RQ` pair, and each restore an `RS` pair.
  - Each settle records `T4` start, samples and decisions, plus `NV` within the cap and `PS`.
  - Every frame records `FS` + `PS`. `TE` and `TC` are recorded as they are dispatched.
- [ ] **P3.04** After the last step, keep sampling until the bound post-sequence quiescence (the subject's fall, then `TC`, then idle frames) or until the bound budget runs out. Questions that need post-decision events depend on this (DS §6.3 C4).
- [ ] **P3.05** If a step cannot be issued as specified, raise `SC-B08`. Write `TZ targetEnd`, skip `PC-3`, write `TZ final` with `tzCause:"stop"`, and go to P4.03.

### Phase 4: terminalization

- [ ] **P4.01** Write `TZ{tzPhase:"targetEnd", tzCause:"normal"}` (`CAPTURING → CONTROL`). Then, in the control window, run `PC-3`: one harness-owned fit through the tag wrapper (its `RQ` pair), its `TE`/`TC`/`FS`/`PS` records, and `CT{controlId:"PC-3", controlOutcome, framesUsed, frameBudget}` within B3. onFail `SC-C01`.
- [ ] **P4.02** Write `TZ{tzPhase:"final", tzCause}` (`CONTROL → FINALIZING`). The recorder removes its own `TE`/`TC` listeners by their retained references; teardown is idempotent, and every later callback is a no-op. onFail: a failure to **write** `TZ final` is `SC-B04` (truncation); a failure to **remove the listeners** only sets `END.lr = 0` and is `SC-C02` (recorded, never verdict-changing).
- [ ] **P4.03** Write `END` (`FINALIZING → CLOSED`), with `pc` from `PC-3`, `ds` = the `tzCause` code, `zt`, `lr`, `cg`, `mx`, and `sd` computed over `[META, ...data]`.
- [ ] **P4.04** Flush and `fsync` `raw/target/target.records.jsonl`, derive `target.trace.json` (§12.2 rule 4), and hash both immediately. Run `validateTraceV2` once as an informational close-time check that never changes raw files. onFail `SC-B06`.
- [ ] **P4.05** Teardown, following the cleanup ledger: remove the wrappers and the sampler (the recorder's listeners were removed in P4.02), unload models, close the contexts and the browser. Write `raw/teardown.json` **once**, recording any failures (`SC-C02`).
- [ ] **P4.06** Raw freeze: close the stdout/stderr capture and hash both logs, then make every file under `governance/`, `preflight/`, `env/` and `raw/` read-only, except the append-only `raw/hash-ledger.jsonl` (§13.3 rule 3). onFail `SC-B07`.
- [ ] **P4.07** Write journal state `CLOSEOUT_STARTED`.

### Phase 5: offline analysis (no browser, Viewer or network)

P5.01–P5.06 write only into a fresh analysis scratch directory **A** outside the run root. Nothing is published into the run root before P5.07 has completed. A and B are never rewritten after they are hashed and compared.

- [ ] **P5.01** Run `validateTraceV2` on every trace (integrity results into A).
- [ ] **P5.02** Binding check: compare every `META` against `binding.json`, and the observed `vv`/`vd` against the bound values; check the plan digest (`governance/target-plan.json` = `binding.targetPlanSha256` = every `META.tq`), the trace-to-plan conformance (§14.2) and the control-trace run linkage (§12.3).
- [ ] **P5.03** Rerun the full negative-control registry (`NC-1a`…`NC-21`, every variant) into A.
- [ ] **P5.04** Evaluate the controls and `RG`, and compute the P1 annotations (`GAP`, `preMotionUnresolved`, `TOKEN_REAPPEARED`).
- [ ] **P5.05** Project per P1 §8.3, apply the committed C6 guard, run the committed `correlate` with the bound `slotWindow`, and write the derived files into A.
- [ ] **P5.06** Compute the verdicts per §14 (with the pre-publication `ledger` gate, §14.1) and write `verdict.json` and the `TERMINAL-VERDICT.json` bytes into A.
- [ ] **P5.07** Determinism check: rerun P5.01–P5.06 from the frozen raw files into a second fresh scratch directory **B**. Every byte of A and B must be identical. onFail `SC-C03`: this is a class-c continuation, not an abort. A and B are retained byte-unchanged, neither is published, and P5.08 takes the closeout branch of §13.7.
- [ ] **P5.08** Precondition: P5.07 completed, either passed or `SC-C03`. **Passed:** publish A into the run root: create each `derived/*` file and `TERMINAL-VERDICT.json` write-once, hashing and ledgering each one; the `TERMINAL-VERDICT.json` line is the last ledger line. **`SC-C03`:** publish nothing from A or B; create only `SC-C03-CLOSEOUT.json` (§13.7) write-once, hashed and ledgered as the last ledger line. onFail `SC-B07`.
- [ ] **P5.09** Write `MANIFEST.json` (§13.6), with `hashLedgerSha256` over the final ledger bytes. onFail `SC-B07`.
- [ ] **P5.10** Post-publication consistency check (fail closed, offline, read-only): the manifest lists exactly the run-root files except itself; each listed SHA-256/byte length matches the file; every entry except the ledger has the `ledgerSeq` of its own ledger line; the ledger chain is intact and its SHA-256 equals `hashLedgerSha256`; `terminalVerdictSha256` matches the file at `terminalCarrierPath`; exactly one terminal carrier exists. On the `SC-C03` branch the closeout is also recomputed from the raw inputs and the retained read-only A and B and must be byte-identical. onFail `SC-B07`: the commit record is written with `terminalVerdict = "INVALID"` (it is authoritative over the already published terminal carrier) and the journal ends `FAILED`.
- [ ] **P5.11** Make the whole run root read-only, including the ledger. onFail `SC-B07`.
- [ ] **P5.12** Write the commit record in the attempts directory (`terminalVerdict` = the run verdict, `WITHHELD` (`SC-C04`, or `SC-C03` with `terminalCarrierPath = "SC-C03-CLOSEOUT.json"`), or `INVALID` after a P5.10 failure). This is the last durable act. onFail `SC-B07`.

---

## 17. Authorization-boundary design (no record is issued)

### 17.1 The existing format, as implemented (read-only inspection)

This is a description of the existing format, read from `test/acceptance/clashpanel-viewerbridge.acceptance.mjs` (`AUTHORIZATION_MARKERS`, `validateAuthorizationRecord`, `buildBindingRecord`, `scanAttemptsDirectoryForStartup`, `JOURNAL_TRANSITIONS`) and procedure §4.1.

**Marker lines.** Each line is matched by a whole-line regex, and every required line must appear exactly once:
- `G2-LIVE-EXECUTION: AUTHORIZED EXACTLY ONE ATTEMPT`
- `Authorization-ID: [a-z0-9-]{8,64}`
- `Baseline-HEAD: <40 hex>`
- `Procedure-SHA256: <64 hex>`
- `Harness-SHA256: <64 hex>`
- `Model-A-URN-SHA256`
- `Model-B-URN-SHA256`
- `Runtime: viewer=7.124.2 env=AutodeskProduction2 api=streamingV2` (exact literal)

`Supersedes:` may appear zero or more times. Any other text is free text and is **not bound**; the historical "Issuance scope note" is an example.

**Validation semantics.**
- The record must be a regular `.md` file under `docs/prompts/`.
- The candidate set is every `docs/prompts/**/*.md` file with a line beginning `G2-LIVE-EXECUTION:`. Ids must not repeat, the record must not be superseded, and exactly one candidate may be non-superseded.
- `Baseline-HEAD` must equal `git rev-parse HEAD`.
- `Procedure-SHA256` is hashed over the fixed procedure path and must also equal the accepted constant.
- `Harness-SHA256` is hashed over the **fixed acceptance harness path**.
- The URN digests are computed over the harness's literal URN constants.

**Exactly-one-attempt mechanism.**
- An exclusive reservation `<id>.reservation.json` carries the binding `{journalVersion, attemptId, authorization{path,sha256,id}, headSha, procedure{path,sha256,version}, harness{path,sha256}, fixtures{A,B}, runtimeEnvelopeRequested}`.
- The journal moves through `AUTH_BOUND → PREFLIGHT_FAILED | ATTEMPT_CONSUMED → CLOSEOUT_STARTED | FAILED`, and a commit record K closes it.
- Startup refuses on `reservation-exists`, `journal-exists:<state>`, `orphan-temp` or `unreadable-reservation`.
- The attempt is consumed when `ATTEMPT_CONSUMED` becomes durable, before the first `loadDocumentNode`. A preflight failure spends the record without consuming the attempt.

### 17.2 Fields a diagnostic run must bind, compared with the existing format

Support levels:
- **SUPPORTED:** the existing format can bind the field as-is.
- **PARTIAL:** it binds something related, but not the diagnostic meaning.
- **NOT_SUPPORTED:** it cannot bind the field.

| Field (contract name) | Existing marker / mechanism | Support | Why |
|---|---|---|---|
| `authorizationId` | `Authorization-ID` | SUPPORTED | — |
| `recordKind` (diagnostic vs acceptance) | none; the single marker `G2-LIVE-EXECUTION` means an acceptance attempt | NOT_SUPPORTED | **Hazard.** A diagnostic record carrying this marker joins the acceptance candidate set. `g2-live-20261004-75a3ccb9` is still non-superseded there (it is spent only via its journal). If the new record does not supersede it, the acceptance validator returns `candidate-set-ambiguous`. If it does, the new record becomes the single acceptance candidate and could authorize an acceptance run |
| `repoCommit` | `Baseline-HEAD` | SUPPORTED | — |
| `procedureSha256` | `Procedure-SHA256` | SUPPORTED | context only for a diagnostic run |
| `acceptanceHarnessSha256` | `Harness-SHA256` | SUPPORTED | binds only the fixed acceptance harness path |
| `diagnosticHarnessSha256` | `Harness-SHA256` (one key, fixed path) | NOT_SUPPORTED | the validator hashes only `test/acceptance/clashpanel-viewerbridge.acceptance.mjs` |
| `diagnosticPackageSha256` | none | NOT_SUPPORTED | — |
| `diagnosticSpecSha256` | none | NOT_SUPPORTED | — |
| `viewerVersion` | `Runtime: viewer=7.124.2 …` | SUPPORTED | exact literal |
| `viewerBundleSha256` | none | NOT_SUPPORTED | the VB-0 pin requires it |
| `runtimeEnvelope` (env, api) | `Runtime:` literal | SUPPORTED | — |
| `runtimeToolchain` (node/playwright/browser) | harness constants (`G2_REQUIRED_RUNTIME`), via `Harness-SHA256` | PARTIAL | bound only indirectly, through the acceptance harness digest |
| `exactCommand` | interlock `--execute-live-g2` + `G2_LIVE_AUTHORIZED=YES`, fixed in code | NOT_SUPPORTED | the existing interlock starts the acceptance run |
| `modelInputs` | `Model-A/B-URN-SHA256` | PARTIAL | URN digests are bound; target dbIds and steps are not |
| `targetPlanSha256` | none | NOT_SUPPORTED | — |
| `atoms`, `idAxis` | none | NOT_SUPPORTED | — |
| `slotWindow` | none | NOT_SUPPORTED | adopting `ASSUME_NO_UNOBSERVED_WRITER` is an owner decision (DS §10 1a) |
| `controlRequirements` (required PCs, budgets B1/B3, quiescence budget) | none | NOT_SUPPORTED | — |
| `caps` (`LIVE_CAPS_V2` digest, §12.4a) | none | NOT_SUPPORTED | — |
| `outputLocation` | fixed in harness code (`test/acceptance/results/…`) | NOT_SUPPORTED | the acceptance paths are fixed and must not be shared (§13.1) |
| `exactlyOneAttempt` | marker text + reservation/journal machinery | PARTIAL | implemented only inside the acceptance harness and its attempts directory |
| `noRetry` | same | PARTIAL | same |
| `consumptionBoundary` | `ATTEMPT_CONSUMED` before the first `loadDocumentNode` | PARTIAL | a diagnostic run needs the boundary before the first model load in **either** instance (§15) |
| `supersedes` | `Supersedes:` | SUPPORTED | — |
| `issuanceSeparateFromExecution` | free-text note (historical practice) | PARTIAL | not machine-bound |

**Conclusion.** The existing authorization-record format **cannot** bind a diagnostic run.
- It cannot bind the diagnostic harness, package or spec, the bundle digest, the command, the target plan, the atoms or ID axis, the slot window, the controls, the caps or the output location.
- Its only marker is an acceptance authorization, and reusing that marker is unsafe because of the candidate-set hazard.

Per prompt §17, this is recorded as **owner decision OD-1**, and the format is **not** modified. Nothing here issues a record, drafts one in executable form, or reserves an attempt.

### 17.3 Proposed binding shape (for a future owner decision)

This applies only if the owner chooses a separate diagnostic record type (OD-1 option A):
- The reservation content, which is the binding record on the harness side, would carry exactly the fields listed in Appendix (iv).
- Each NOT_SUPPORTED field would become a marker in a **distinct namespace**. The first line would be something like `G2-LIVE-DIAGNOSTIC: AUTHORIZED EXACTLY ONE ATTEMPT`, and no line would begin `G2-LIVE-EXECUTION:`.
- Only the future diagnostic harness would validate these markers. The acceptance validator and its candidate set would stay unchanged.

This is the shape of a proposal only. It is not a format change and not a record.

---

## 22. Live-worthwhile decision

**Verdict: B. Prepared, but currently not worthwhile.** This verdict does not authorize, recommend or schedule execution.

### 22.1 What a live run could add that offline research cannot

Offline (D2) support is synthetic only. D2 has no foreign writer, no no-op fit and no jitter, and its assumption holds by construction. A live run on the pinned 7.124.2 build would give the first **observed** evidence of whether the stale-decision mechanisms happen in a new run.

`OPEN` is the only mode that can be used without an owner-accepted assumption that cannot be verified. Under `OPEN`, the minimum set can definitely observe:
- **`Q-SUBJ = PENDING`:** the subject's request was still in the slot at the T4 decision. This is the core of DH-1/DH-2. In D2, 17,935 of 40,788 relevant schedules (44.0%) are definite.
- **`Q-OWNER ∈ {RESTORE, INIT}`:** at the decision, the camera still showed the restore pose (the DH-3a shape) or the initial pose. In D2, 2,608 of 40,788 (6.4%) are definite.

This is real information that offline work cannot provide, so D ("unnecessary") does not apply.

### 22.2 Why it is currently not worthwhile (B rather than A)

1. **One-sided under `OPEN`.**
   - Under `OPEN`, `OWN`, `PRIOR_TERMINAL`, `IN_FLIGHT`, `ACTIVE_PLUS`, `COMPLETE` and every non-empty `Q-ATTR` list are **never** definite (committed correlator; the gap is fail-closed, P1 §10).
   - The C8-relevant question is "did the deciding sample show the subject's own terminal pose?". It can therefore never be `SUPPORTED` or `REJECTED` under `OPEN`.
   - A stale-decision target can be `SUPPORTED` but never `REJECTED`, so a non-stale run always comes out `INCONCLUSIVE`.
   - In short, a run can confirm a mechanism but cannot exclude one.
2. **Coverage.** Only 3 of 13 questions have any sound procedure. The other ten always return `UNDIAGNOSABLE(NO_SOUND_PROCEDURE)`. Those ten include `Q-STALE` (which P1 calls "the C8 core question"), `Q-DH2` and `Q-DH3B`, the questions that name the historical hypotheses directly.
3. **Residual ambiguity.**
   - Even under assumption mode, 5,063 schedules per question remain `ACTIVE_WITHOUT_VISIBLE_STEP`/`ACTIVE0`, and they fail closed (P1 §9.5).
   - The assumption itself cannot be verified in the open world (DS §6.2 R3, H-2).
   - A `SUPPORTED` or `REJECTED` that rests on the assumption is only conditional (T2), and adopting it is an owner decision (OD-2).
4. **No public-only path.** Public-only data yields 0 sound definite labels for owner, subject and attribution. Any useful run therefore depends on two things:
   - Viewer 7.124.2 internals (VB-1, VB-3; OD-3);
   - the `RG` representativeness gate, which a live run can only check, not guarantee.
5. **No transfer to the historical run.**
   - No new run can resolve historical C8, change G2 `FAIL (row 3)`, or move C6 off `NOT_EVIDENCED` (O-29; DS §6.5 item 6).
   - A live result could inform three decisions: a T4 settle-rule change, a C8 remediation, or a G2 retry design. All three are owner-only, and none is currently queued.
6. **Cost and risk.** A run needs all of the following:
   - a new authorization-record format (OD-1), because the existing one cannot bind a diagnostic run and reusing it is hazardous;
   - an implemented and reviewed diagnostic harness, which is a phase transition;
   - one consumable attempt, consumed before the controls, so a control failure wastes it;
   - a target Viewer instance plus one fresh disposable Viewer page per Phase-2 control, all using version-bound internals.

   In addition, a `PENDING` target has only mechanism-level control coverage (§11.2 gap). The full P6-shaped plan is now expressible (CI-1 resolved), but its four 5 s settle deadlines fit the 3,576-frame target budget (§12.4a) only if the measured rAF rate is at most about 170 Hz, so on a faster display it would stop at P0.13 (`SC-A17`).

### 22.3 Why not C (not yet prepared)

At the design level, the following are complete and specified mechanically: controls (§11), envelope and integrity (§12), provenance (§13), verdict (§14), stop conditions (§15) and runbook (§16). This holds after the internal-review remediation (coordination item 12): before it, the target plan was not bound at evaluation (H-1) and the finalization order was impossible (H-2), which contradicted this paragraph. Both are now fixed in the spec and, where mechanical, in the prototype and its runbook validator.

What remains open falls into three groups:
- owner decisions (OD-1…OD-8);
- implementation-plan requirements (budgets B1/B3, the quiescence budget, exact hook code);
- live verification gates (`RG`, `PENDING` timing).

None of these is a design or integrity gap inside this package. The verdict becomes **C** for one reason only: if the owner treats OD-1 (no bindable authorization format) as a preparation gap rather than a decision.

### 22.4 What would move the verdict to A

All three of the following would be needed:
1. The owner names a concrete pending decision that a **one-sided** live confirmation would change, and it is pre-registered as a primary target. Example: "before any T4 settle-rule change is considered, demonstrate on 7.124.2 that a T4 decision can occur while the subject request is still `PENDING`", registered as a primary `Q-SUBJ` target with `supportLabels: ["PENDING"]`.
2. OD-1 is resolved, so a bindable diagnostic authorization format exists.
3. OD-3 permits use of VB-1/VB-3.

Without all three, a live run would mostly add `INCONCLUSIVE` outcomes.

---

## Contradictions, tensions and coordination items

No committed conclusion was changed. These items are listed so that none of them gets resolved silently.

1. **Phase order versus the ban on pre-capture controls (a tension, resolved by design).**
   - Prompt §16 runs the controls (Phase 2) before the target (Phase 3), but DS §6.1.3 forbids a same-session pre-capture control.
   - Resolution: Phase 2 runs only in a disposable same-build instance, which DS §6.1.3 permits, with one trace per control. The target `META` is frozen in Phase 1 and written at capture start.
2. **A tension inside DS §6.1.3: post-capture control events "are not data events", yet bounded evidence of the control itself MUST be retained.**
   - Resolution in schema 2: the control's evidence is recorded as data records in the P1 I6 control window.
   - That window is excluded from projection, and `END.pc` is cross-checked against the `CT` outcome (`PC-MISMATCH`).
   - Schema 1 is unchanged.
3. **Prompt §12 asks `END` to carry a terminal diagnostic status, but schema-1 `END` has only the trace status `ts`, under a 384 B cap (worst case 371 B).**
   - Resolution: schema 2 adds an integer `ds` (plus the lifecycle/bound fields `zt`, `lr`, `cg`, `mx` of §12.5, with schema-2 integer bounds on the counters). The worst case is 363 B, still ≤ 384 B. The `END` cap is unchanged.
4. **The existing authorization machinery cannot bind a diagnostic run** (§17.2). This is a binding gap, recorded as OD-1.
   - A related fact, verified in the harness source: the spent record `g2-live-20261004-75a3ccb9` is still **non-superseded** in the acceptance candidate set. It is unusable only because its journal and reservation exist.
   - Any future acceptance-format record would therefore have to supersede it, or be rejected as `candidate-set-ambiguous`.
   - This is noted for the owner. It changes nothing here.
5. **Coordination with Part 1 (resolved in Part 1's favour; reconciled again against P1 contract version 3 at P2 contract version 2; historical. The current reconciliation is P1 v4 / P2 v3, item 11).** An earlier draft of this part defined its own data-record fields and five extension wire keys (`sn`, `rx`, `sq`, `ea`, `oc`). Both were replaced by P1 §8 and P1 Appendix `wireKeys` (`nw`, `rd`, `ss`, `el`, `cr`), which specify:
   - `RQ`/`RS` as pre/post pairs;
   - a `PS` after every host read (I3);
   - `T4` start, sample and decision records;
   - C8 bound by `sampleSeq` + `camDigest`, not by adjacency (I5);
   - two `TZ` phases (I6);
   - `CE` not captured;
   - `CT` fields `controlId`/`controlOutcome`/`framesUsed`/`frameBudget`.

   Part 2 adds only byte bounds, caps and the envelope.
6. **CI-1 (resolved, owner of the rule: P1 I4).**
   - Problem: the full historical P6 shape has four settles (N2, C6, C8, p2), but the earlier contract allowed one `G` and one `S`.
   - Resolution (minimal; no new enum value): P1 I4 now allows exactly one `S`, at most two `G` ("non-subject, never deciding, never `C8`-bound") and at most one `P` (superseded-`C8` settle, already added by P1), strictly sequential. The P6 shape maps to `G`, `G`, `S`, `P`.
   - Soundness: the committed correlator re-initializes a role's settle state at each `SST` and checks `fr` only on `S`, so sequential `G` settles are consumed unchanged; `P` settles project as `CAM` reads only. P0.08/`SC-A16` enforce the counts; `SETTLE-ROLES` enforces them on the trace.
7. **CI-2 (resolved, owner of the rule: P1 I6).**
   - Problem: the harness-owned `PC-3` fit goes through the wrapped `fitToView` and emits an `RQ` pair, but the earlier I6 control-window list omitted `RQ`.
   - Resolution: P1 I6 admits `RQ` pairs in the control window (I1/I7 apply; the token sequence continues) and forbids `T4`/`RS`/`C8`/`NV`/`CE` there. `PC-3` keeps using the wrapper, so the earlier interim rule ("call the unwrapped original") is withdrawn. Control-window records are never projected, so no correlation result changes.
   - Rejected alternative: calling the unwrapped original would make a foreign `fitToView` in the control window break I6 and would lose `PC-3`'s own `slotNew = 1` evidence.
8. **Schema-2 caps (resolved here, §12.4a).** The committed 8,192-event cap is too small for the P1 sample bound (1,801 per settle), and the unchanged committed correlator accepts at most 8,192 projected events and `SMP.n ≤ 64`. Resolution: the target-window frame budget is derived from the projection capacity (3,576 frames), the data-event cap from the worst-case record count (23,057 → 24,576) and the byte cap from the event cap (6,394,880 → 6,400,000 B); P1 §8.3 compacts long settles and refuses unrepresentable projections. The committed `LIVE_CAPS`, `schema.mjs`, the `NV` 406 B bound and every committed result are unchanged.
9. **Edge-initialization, recorder lifecycle and per-control pages (aligned to P1 §8.4, §8.6).** `META` now binds `ei`, `ba`, `bp`, `lb`, `qe`, `rr`, `rc`; `END` binds `zt`, `lr`, `cg`, `mx`. Phase 2 uses one fresh page per control, because P1 allows one recorder per page; the earlier "all controls in one disposable instance" design is withdrawn. Listener removal moved from teardown (P4.06) to the `FINALIZING` transition (P4.02).
10. **Baseline cleanliness (an observation).**
   - Prompt §1 requires zero untracked files. At the time of writing, `git status --short` shows the authorizing prompt as untracked, plus this package's new directory.
   - HEAD is `f3bab74…` as required.
   - This is not a material state difference. It is reported to the orchestrator.

11. **Remediation of the offline prototype's spec findings (Part 1 contract v4, Part 2 contract v3).** The prototype builders reported spec defects without editing the specs (`prototype/NOTES.md`). Each is fixed in the spec, and the prototype and fixtures were made consistent. No committed conclusion changed (`OPEN` 2/13, assumption 3/13, 3/13 sound, `NV` 406 B, 5,063, gap fail-closed, C8 unresolved, the committed correlator and C6 guard unchanged).
   - **F1 wire-key collision:** rule restated precisely (shared `k`/`f`/`tm` with the same meaning; everything else distinct; envelope-only keys drive `META-FIELD-IN-DATA`), §12.4, Appendix (i) `wireKeyCollisionRule`.
   - **F2 control traces and the C6 guard:** the guard input is defined per trace role; the target-trace input is `END.pc` **and** a re-derived `PC-3` (stricter), the control-trace input is the control's own re-derived edge pattern (only for that control's outcome), §11.2, §12.7, Appendix (ii) `c6GuardInput`.
   - **F3 NC-15 vs T1:** rule order kept; the target result carries the ordered `reasons` list, and NC-15 expects `EDGE_INIT_UNKNOWN` in it, §11.3, §13.5, §14.3.
   - **F4 NC-1a/NC-2a:** `validateTraceV2` result fields named (`envelopeOk`, `bindingOk`, `ok`); the honest wrong-Viewer trace is `envelopeOk = true`, `ok = false`, §11.3, §12.6.
   - **F5 `RS-PAIR`:** added as a Part 1 integrity code, §12.6 step 2, Appendix (i).
   - **F6 I4:** exact rules in P1 I4 / P1 Appendix `t4DecisionRules`.
   - **F7 frame/time ordering:** `FRAME-ORDER` and `TIME-ORDER` added (Part 2 codes), and `TZ-STATUS-MISMATCH` covers a missing `TZ final`, §12.6 step 3.
   - **F8 PC-4 NV reproduction:** LIVE-only (frozen oracle in the bound Phase-5 evaluator); the offline prototype checks the structural pattern only and never claims the oracle ran, §11.2 "PC-4 scope", Appendix (vii).
   - **Ancillary (a):** a per-step `requiresFutureOwnerAuthorization` boolean, §16, Appendix (iii). **(b):** per-capture-point `failClosed` entries in P1 Appendix `capturePoints`, checked against the contract. **(c):** single-document files are canonical bytes with no trailing newline, §12.2 rule 6, §13.5, §13.6, Appendix (v).

12. **Remediation of the internal review** (`docs/reviews/2026-10-06-g2-live-diagnostic-preparation-internal-review.md`; Part 1 contract v5, Part 2 contract v4). No committed conclusion changed (`OPEN` 2/13, assumption 3/13, 3/13 sound, `NV` 406 B, 2,048 configurations with 0 wrong labels, 5,063, gap fail-closed, C8 unresolved, C6 `NOT_EVIDENCED`, T4 unchanged; the committed correlator and C6 guard are consumed unchanged).
   - **H-1 plan binding:** `governance/target-plan.json` is part of the frozen evidence; Phase 5 requires `sha256(plan) = binding.targetPlanSha256 = META.tq` (`TARGET_PLAN_DIGEST_MISMATCH` → `INVALID`), §13.2, §14.1, §14.2, §14.4, Appendix (ii) `targetPlanBindingRule`.
   - **H-2 finalization order:** raw complete → raw freeze → two scratch analysis runs compared → publish → manifest → post-publication consistency check → run-root freeze → commit record, §13.3 rule 3, §16 P4.05–P5.12, Appendix (iii) `finalizationOrder`/`writes` (checked by the runbook validator).
   - **M-1** external gates exactly `true`, §14.1, Appendix (ii) `externalGateRule`. **M-2** per-primary-target ambiguity scope and the precise `PENDING` rule, §14.3, Appendix (ii) `ambiguityScope`. **M-3** `TOKEN_REAPPEARED` (T0c, `SC-C04`, withheld) and `CLEAR_WITHOUT_EDGE` (T1c), §14.3, §15, P1 §10.4/§10.4a. **M-4** control-trace order `TZ targetEnd → CT → TZ final → END`, P2.02, Appendix (iii) `controlTraceOrder`. **M-5** ledger closure, §13.4, Appendix (v). **M-6** `raw/control-disposal.json` (P2.07) and one `raw/teardown.json` (P4.05). **M-7** one ordered NC registry `NC-1a`…`NC-21` at P0.06 and P5.03, Appendix (vii) `selfTestRegistry`. **M-8** strict plan schema, derived bounds, Phase-5 conformance, §14.2, Appendix (ii) `targetPlanSchema`. **M-9** conditional stop guarantee and an owner-authorized offline recovery closeout, §15.
   - **Low:** L-1 control run linkage (§12.3); L-2 listener wording and the P4.02 `onFail` split (P1 §7.1, P1.02, P4.02, `SC-C02`); L-3 5,142,016 B (§12.4a, Appendix (i)); L-4 CP08 rationale (P1); L-6 `verdictWithheld`/`WITHHELD` (§13.5, Appendix (v)); L-7 path and log handling (§13.3 rule 8); L-8 `null` scope (§12.2 rule 1, Appendix (i)).

13. **`SC-C03` closeout correction** (independent review `docs/reviews/2026-10-06-g2-future-live-diagnostic-design-preparation-independent-review.md`, M1, L1, L2; bounded offline correction). Contract versions stay 5/4: no accepted area changes.
   - **M1:** on an A/B mismatch neither analysis is published and neither is rewritten; the separate deterministic `SC-C03-CLOSEOUT.json` is the terminal carrier (§13.7, Appendix (iii) P5.07/P5.08 `scC03Branch`/`branchWrites`, Appendix (v) `terminalCarrierPath`, Appendix (vi) `SC-C03`, Appendix (viii)); the runbook validator checks the branch and the prototype `closeout.mjs` proves A/B immutability, determinism, hash/manifest binding and mutation detection.
   - **L1:** §13.2 now says the commit record is written at P5.12. **L2:** the H-2 cross-reference now ends at P5.12. No phase is renumbered.

## Owner decisions (none decided here)

| ID | Decision | Classification |
|---|---|---|
| OD-1 | Authorization-record format for a diagnostic run. Options: (A) a separate diagnostic record type with its own marker namespace and validator, in a future diagnostic harness; (B) an extension of the acceptance format, which is a procedure/acceptance-contract change and owner-only; (C) no live diagnostic | product/integration decision (blocks any live run) |
| OD-2 | `slotWindow`: `OPEN` (the default) or `ASSUME_NO_UNOBSERVED_WRITER`, and the verification gate that goes with it | design/spec decision (DS §10 1a) |
| OD-3 | Whether a diagnostic may use the VB-1/VB-3 internals | policy (DS §10 item 2) |
| OD-4 | Contents of `targetPlan.json` (the minimal G/S pair or the full P6 shape `G`, `G`, `S`, `P`; CI-1 resolved) and the pre-registered primary targets | product/integration decision |
| OD-5 | Confirm the consumption boundary before the Phase 2 controls (designed conservatively) | owner confirmation |
| OD-6 | Where evidence is preserved, and whether it is checkpointed | owner act |
| OD-7 | Authorization to plan and implement a diagnostic harness (a transition from design to implementation planning) | milestone transition |
| OD-8 | Whether a live diagnostic is wanted at all, given the §22 verdict B | owner decision |

The following are implementation-plan requirements, not owner decisions:
- frame budgets B1/B3;
- the quiescence budget and frame count;
- the exact hook and wrapper code;
- an `evaluable`/`inside` encoding identical to the frozen C8 oracle.

---

## Appendix: Machine-readable contract

All names are camelCase contract names; wire keys are given where they differ. These blocks are normative for the offline prototype.

Data-record field types and wire keys are those of the P1 Appendix (`fieldTypes`, `wireKeys`, `wireVariants`, `capturePoints`, `pairingInvariants`, `settleRoles`, `controlWindow`). Block (i) adds no data-record key; it defines `META`, `END`, `LIVE_CAPS_V2` and the byte bounds. Every block below is strict JSON (parsed with `node` during reconciliation).

### (i) Envelope: META/END fields and types; caps; data-record byte bounds

```json
{
  "contractId": "g2-live-diag-prep-part2",
  "contractVersion": 4,
  "reconciledWith": {"contractId": "g2-live-diag-prep-part1", "contractVersion": 5},
  "remediation": "contract version 4 remediates internal-review findings H-1, H-2, M-1..M-9 and L-1..L-9 (coordination item 12); version 3 remediated prototype spec findings F1-F8 and ancillary (a)-(c) (coordination item 11)",
  "traceSchemaVersion": 2,
  "canonicalization": {"encoding": "utf-8", "keyOrder": "utf16-code-unit", "whitespace": "none", "trailingNewline": false, "nullAllowed": false, "nullAllowedScope": "trace records (META, data, END) never contain null; a single-document file may contain null only in a field its schema declares nullable (TERMINAL-VERDICT.json stopCondition, withheldBy; SC-C03-CLOSEOUT.json promotion.promotedAnalysis, promotion.authoritativeAnalysis)", "nonFiniteAllowed": false},
  "rawFileForm": {"authoritative": "jsonl, one canonical record per line, '\\n' terminated, META first, END last", "traceArray": "'[' + lines.join(',') + ']'"},
  "caps": {"name": "LIVE_CAPS_V2", "dataEvents": 24576, "bytesPerEvent": 256, "bytesPerNv": 406, "metaBytes": 1536, "endBytes": 384, "totalTraceBytes": 6400000, "retainedNumericSamples": 512, "retainedExcerpts": 32, "settleSamples": 1801, "reserveBytes": 2048, "maxRefreshHz": 360, "deadlineMs": 5000, "targetWindowFrames": 3576, "controlWindowFrames": 1801, "maxSettles": 4, "maxFits": 9, "maxRestores": 4, "viewerDispatchAllowance": 1024, "projectedEventsMax": 8192, "projectedSamplesPerSettle": 64},
  "committedCapsUnchanged": {"name": "LIVE_CAPS", "dataEvents": 8192, "totalTraceBytes": 2457600, "settleSamples": 64, "appliesTo": "trace schema 1 only"},
  "capDerivation": {
    "targetWindowFrames": {"formula": "floor((projectedEventsMax - maxSstProjected - maxTargetFits - maxRestores - viewerDispatchAllowance) / 2)", "inputs": {"projectedEventsMax": 8192, "maxSstProjected": 3, "maxTargetFits": 8, "maxRestores": 4, "viewerDispatchAllowance": 1024}, "value": 3576, "worstCaseProjected": 8191},
    "controlWindowFrames": {"formula": "floor(deadlineMs * maxRefreshHz / 1000) + 1", "value": 1801},
    "settleSamples": {"formula": "floor(deadlineMs * maxRefreshHz / 1000) + 1", "value": 1801, "source": "part-1 8.4a"},
    "dataEvents": {"terms": {"A_fsPlusPs": 10754, "B_t4": 10736, "C_nv": 512, "D_rqRs": 26, "E_teTcAllowance": 1024, "F_c8CtTz": 5}, "worstCase": 23057, "value": 24576},
    "totalTraceBytes": {"formula": "(dataEvents - retainedNumericSamples) * (bytesPerEvent + 1) + retainedNumericSamples * (bytesPerNv + 1) + reserveBytes", "atCaps": 6394880, "atWorstCaseSizes": 5142016, "atWorstCaseSizesFormula": "(dataEvents - retainedNumericSamples) * (maxNonNvData + 1) + retainedNumericSamples * (nv + 1) + reserveBytes", "value": 6400000}
  },
  "worstCaseBytes": {"meta": 1456, "end": 363, "maxNonNvData": 204, "nv": 403, "reserveUsed": 1923},
  "meta": {
    "kind": "META",
    "requiredFields": [
      {"key": "k", "name": "kind", "type": "const", "value": "META"},
      {"key": "f", "name": "frameOrigin", "type": "int", "value": 0},
      {"key": "tm", "name": "timeOrigin", "type": "int", "value": 0},
      {"key": "sv", "name": "schemaVersion", "type": "int", "value": 2},
      {"key": "run", "name": "runId", "type": "string", "pattern": "^[a-z0-9-]{1,32}$"},
      {"key": "rl", "name": "traceRole", "type": "enum", "values": ["T", "PC-1", "PC-2", "PC-4", "PC-5"]},
      {"key": "ai", "name": "authorizationId", "type": "string", "pattern": "^[a-z0-9-]{8,64}$"},
      {"key": "ah", "name": "authorizationRecordSha256", "type": "hex64"},
      {"key": "ad", "name": "attemptId", "type": "string", "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"},
      {"key": "hh", "name": "diagnosticHarnessSha256", "type": "hex64"},
      {"key": "ph", "name": "procedureSha256", "type": "hex64", "value": "d1ccfde224b8ae76fe74b06c93abc532e6df9612933cafaa045053c8e2e45a75"},
      {"key": "sh", "name": "diagnosticSpecSha256", "type": "hex64"},
      {"key": "pk", "name": "diagnosticPackageSha256", "type": "hex64"},
      {"key": "tq", "name": "targetPlanSha256", "type": "hex64"},
      {"key": "vv", "name": "viewerVersionObserved", "type": "string", "pattern": "^[0-9A-Za-z.+-]{1,16}$", "absentValue": "ABSENT"},
      {"key": "vd", "name": "viewerBundleSha256Observed", "type": "hex64OrAbsent"},
      {"key": "vg", "name": "vbGate", "type": "flag", "rule": "1 only if vv === '7.124.2' && vd === '12b9fe49f41dc99ccec62535e5c887da915980829da2e941cfe4da3d7197c02e'"},
      {"key": "vb", "name": "vbStructural", "type": "object", "keys": ["VB-1", "VB-2", "VB-3"], "valueType": "flag", "rule": "all 0 unless VB-0 holds"},
      {"key": "at", "name": "atoms", "type": "atomList", "value": ["P-FRM", "P-TC", "V-PEND", "V-EDGE"]},
      {"key": "id", "name": "idAxis", "type": "enum", "values": ["ON"]},
      {"key": "sw", "name": "slotWindow", "type": "enum", "values": ["OPEN", "ASSUME_NO_UNOBSERVED_WRITER"], "rule": "must equal binding.slotWindow"},
      {"key": "br", "name": "browserFamily", "type": "string", "pattern": "^[0-9A-Za-z .()/-]{1,24}$"},
      {"key": "cp", "name": "caps", "type": "object", "rule": "exactly LIVE_CAPS_V2 (caps block above, without 'name')"},
      {"key": "ec", "name": "expectedCount", "type": "object", "keys": ["min", "max"], "rule": "0 <= min <= max <= 24576"},
      {"key": "q0", "name": "firstSeq", "type": "int", "value": 1},
      {"key": "cs", "name": "captureStart", "type": "int", "value": 1},
      {"key": "ei", "name": "edgeInit", "type": "enum", "values": ["LOW", "UNKNOWN"], "rule": "LOW iff lb === 1 && qe === 0 && ba === 'FALSE' && bp === 'NULL'; else UNKNOWN (EDGEINIT-INCONSISTENT)", "filledAt": "captureStart"},
      {"key": "ba", "name": "boundaryActiveRead", "type": "enum", "values": ["FALSE", "TRUE", "UNREADABLE"], "filledAt": "captureStart"},
      {"key": "bp", "name": "boundarySlotRead", "type": "enum", "values": ["NULL", "PRESENT", "UNREADABLE"], "filledAt": "captureStart"},
      {"key": "lb", "name": "listenersBeforeQuiescence", "type": "flag", "filledAt": "captureStart"},
      {"key": "qe", "name": "quiescenceEdgeCount", "type": "int", "min": 0, "max": 4294967295, "filledAt": "captureStart"},
      {"key": "rr", "name": "measuredRefreshHz", "type": "int", "min": 1, "max": 360},
      {"key": "rc", "name": "recorderOrdinal", "type": "int", "value": 1}
    ],
    "templateFrozenAt": {"target": "P1.04", "control": "P2.01"},
    "unknownFieldsAllowed": false
  },
  "end": {
    "kind": "END",
    "requiredFields": [
      {"key": "k", "name": "kind", "type": "const", "value": "END"},
      {"key": "f", "name": "frameEnd", "type": "int", "min": 0},
      {"key": "tm", "name": "timeEnd", "type": "int", "min": 0},
      {"key": "run", "name": "runId", "type": "string", "rule": "=== META.run"},
      {"key": "lq", "name": "lastSeq", "type": "int", "min": 0, "max": 24576, "rule": "=== seq of TZ final"},
      {"key": "ne", "name": "dataCount", "type": "int", "min": 0, "max": 24576},
      {"key": "nb", "name": "dataBytes", "type": "int", "min": 0, "max": 6400000},
      {"key": "nvn", "name": "nvRetained", "type": "int", "min": 0, "max": 512},
      {"key": "nvx", "name": "nvNotRetained", "type": "int", "min": 0, "max": 4294967295, "saturating": true},
      {"key": "rj", "name": "appendsRejected", "type": "int", "min": 0, "max": 4294967295, "saturating": true},
      {"key": "iv", "name": "appendsInvalid", "type": "int", "min": 0, "max": 4294967295, "rule": "iv <= rj; overflow=0 => rj === iv; overflow=1 => rj > iv"},
      {"key": "overflow", "name": "overflow", "type": "flag"},
      {"key": "truncated", "name": "truncated", "type": "flag"},
      {"key": "ts", "name": "traceStatus", "type": "enum", "values": ["OK", "TRUNCATED", "OVERFLOW", "MALFORMED"], "rule": "TRUNCATED > OVERFLOW > MALFORMED(iv>0) > OK"},
      {"key": "ds", "name": "diagnosticStatus", "type": "enum", "values": [0, 1, 2], "labels": {"0": "normal", "1": "stop", "2": "error"}, "rule": "=== code(TZ final tzCause)"},
      {"key": "pc", "name": "positiveControl", "type": "object", "keys": ["VB-3"], "valueType": "flag", "rule": "target trace: 1 iff CT{controlId:'PC-3',controlOutcome:'PASSED'}; control traces: 0"},
      {"key": "sd", "name": "streamSha256", "type": "hex64", "rule": "sha256(canonical([META, ...data]))"},
      {"key": "zt", "name": "targetEndSeq", "type": "int", "min": 1, "max": 24576, "rule": "=== seq of TZ targetEnd (LIFECYCLE-MISMATCH)"},
      {"key": "lr", "name": "listenersRemoved", "type": "flag", "rule": "recorded only; 0 => SC-C02"},
      {"key": "cg", "name": "classGateFailed", "type": "flag", "rule": "1 => every target INCONCLUSIVE(CLASS_NONTRANSITIVE) (T0b); not an integrity failure"},
      {"key": "mx", "name": "maxSampleIndex", "type": "int", "min": 0, "max": 1801, "rule": "=== largest appended T4 sampleIndex (SAMPLE-BOUND)"}
    ],
    "unknownFieldsAllowed": false
  },
  "recorderLifecycle": {"source": "part-1 8.6", "transitions": [{"from": "CREATED", "to": "CAPTURING", "on": "META + capture-start FS"}, {"from": "CAPTURING", "to": "CONTROL", "on": "TZ targetEnd"}, {"from": "CONTROL", "to": "FINALIZING", "on": "TZ final; recorder removes its TE/TC listeners"}, {"from": "FINALIZING", "to": "CLOSED", "on": "END"}], "onePerPage": true, "controlPages": "one fresh disposable context and page per Phase-2 control"},
  "dataRecordFieldsAuthority": "part-1 appendix (fieldTypes, wireKeys, wireVariants, capturePoints, pairingInvariants, settleRoles, controlWindow)",
  "dataWireKeysAuthority": "part-1 appendix wireKeys",
  "withdrawnPart2WireKeys": {"slotNew": "sn", "readSite": "rx", "sampleSeq": "sq", "evaluable": "ea", "controlOutcome": "oc"},
  "wireKeyCollisionRule": {"allowedShared": ["f", "k", "tm"], "sameMeaning": {"k": "record kind", "f": "frame counter (META: origin 0; END: at close)", "tm": "tenths of a millisecond from the origin (META: origin 0; END: at close)"}, "rule": "the intersection of part-1 data wire keys with META/END keys MUST equal allowedShared; every other data wire key differs from every META/END key", "envelopeOnlyKeys": "META keys union END keys minus part-1 data wire keys; a data record carrying one is META-FIELD-IN-DATA"},
  "dataWorstCaseBytes": {"RQ.pre": 145, "RQ.post.returned": 204, "RQ.post.threw": 126, "PS": 151, "TE": 105, "FS": 126, "T4.start": 122, "T4.sample": 157, "T4.decision": 163, "RS.pre": 102, "RS.post": 183, "CE": 91, "TC": 91, "C8": 198, "CT": 138, "TZ": 122, "NV": 403},
  "dataWorstCaseAssumptions": {"seqValuedFields": 24576, "frameValuedFields": 5376, "tm": 9007199254740991, "sampleIndex": 1801, "runIdChars": 32, "targetKeyChars": 32},
  "ceCapturedInMinimum": false,
  "windows": {"target": "capture-start FS .. TZ{tzPhase:targetEnd}", "control": "after TZ targetEnd .. TZ{tzPhase:final}; RQ/TE/TC/FS/PS/CT of PC-3 only; excluded from projection", "controlTrace": "one trace per Phase-2 control; its control window holds exactly one CT"},
  "integrityCodes": {
    "committed": "39 codes of trace-integrity.mjs TRACE_ERRORS (sv=2 supported)",
    "committedList": ["VALIDATION-EXCEPTION", "BAD-OPTIONS", "TRACE-NOT-ARRAY", "RECORD-NOT-OBJECT", "META-MISSING", "META-DUPLICATE", "DATA-BEFORE-META", "META-INVALID", "META-VB0-INCONSISTENT", "SCHEMA-VERSION-UNSUPPORTED", "META-CAPS-MISMATCH", "META-TOO-LARGE", "END-MISSING", "END-DUPLICATE", "DATA-AFTER-END", "END-INVALID", "TERMINAL-STATUS-INCONSISTENT", "END-TOO-LARGE", "RUN-ID-MISMATCH", "META-FIELD-IN-DATA", "VERSION-MIXED", "DATA-INVALID", "EVENT-TOO-LARGE", "SEQ-START", "SEQ-GAP", "SEQ-ROLLBACK", "SEQ-DUPLICATE", "CAPTURE-START-MISSING", "COUNT-MISMATCH", "COUNT-OUT-OF-BOUNDS", "BYTES-MISMATCH", "LAST-SEQ-MISMATCH", "END-BEFORE-LAST-EVENT", "NV-COUNT-MISMATCH", "STREAM-DIGEST-MISMATCH", "TRACE-TOO-LARGE", "TRUNCATED", "OVERFLOW", "MALFORMED-APPENDS"],
    "part1": ["I1-RQ-PAIR", "I2-RQ-THREW-READS", "I3-HOST-PS", "I4-T4-DECISION", "I5-C8-BINDING", "I6-TZ-WINDOW", "I7-SLOT-DELTA", "RS-PAIR", "SETTLE-ROLES", "CONTROL-WINDOW-KIND", "FS-FRAME-GAP", "CE-NOT-CONFIGURED", "WIRE-VARIANT"],
    "part2": ["TZ-STATUS-MISMATCH", "PC-MISMATCH", "ROLE-MISMATCH", "CT-PLACEMENT", "EDGEINIT-INCONSISTENT", "RECORDER-ORDINAL", "LIFECYCLE-MISMATCH", "FRAME-BOUND", "SAMPLE-BOUND", "FRAME-ORDER", "TIME-ORDER", "BINDING-MISMATCH", "OBSERVED_VIEWER_NOT_BOUND", "OBSERVED_BUNDLE_NOT_BOUND"],
    "stepOf": {"envelope": "steps 1-3 (committed, part1, part2 codes other than the binding codes)", "binding": ["BINDING-MISMATCH", "OBSERVED_VIEWER_NOT_BOUND", "OBSERVED_BUNDLE_NOT_BOUND"]}
  },
  "nonIntegrityWholeTraceConditions": {"END.cg=1": "CLASS_NONTRANSITIVE", "META.ei=UNKNOWN": "EDGE_INIT_UNKNOWN", "projectionUnrepresentable": "PROJECTION_UNREPRESENTABLE"},
  "partialTracePolicy": "any integrity failure => whole trace unusable; no prefix is ever positive evidence",
  "validatorResult": {"fields": ["ok", "envelopeOk", "envelopeErrors", "bindingOk", "bindingErrors", "errors", "reason", "vbEligible"], "envelopeOk": "steps 1-3 raise nothing", "bindingOk": "step 4 raises nothing", "ok": "envelopeOk && bindingOk", "vbEligible": "ok && META passes VB-0"},
  "singleDocumentFileBytes": "exactly the UTF-8 canonicalStringify output; no BOM; no trailing newline (last byte '}'); digests over exactly these bytes"
}
```

### (ii) Verdict decision table

```json
{
  "verdicts": ["BLOCKED", "INVALID", "INCONCLUSIVE", "REJECTED", "SUPPORTED"],
  "precedence": ["BLOCKED", "INVALID", "INCONCLUSIVE", "REJECTED", "SUPPORTED"],
  "scope": "NEW_RUN_ONLY",
  "runRules": [
    {"id": "V1", "verdict": "BLOCKED", "when": {"attemptConsumed": false}},
    {"id": "V2", "verdict": "INVALID", "when": {"attemptConsumed": true, "anyOf": ["stopClassB", "targetTraceAbsent", "anyIntegrityNotOk", "requiredPositiveControlNotPassed", "finalTzCauseNotNormal", "negativeControlRerunNotExactlyTrue", "rawHashLedgerNotExactlyTrue", "targetProjectionContradiction", "targetProjectionMalformed", "bindingMismatch", "observedViewerNotBound", "observedBundleNotBound", "targetPlanInvalid", "targetPlanDigestMismatch", "targetPlanNonconformant", "controlRunNotLinked"]}},
    {"id": "V3", "verdict": "INCONCLUSIVE", "when": {"anyPrimaryTarget": "INCONCLUSIVE"}},
    {"id": "V4", "verdict": "REJECTED", "when": {"anyPrimaryTarget": "REJECTED"}},
    {"id": "V5", "verdict": "SUPPORTED", "when": {"allPrimaryTargets": "SUPPORTED", "edgeInit": "LOW", "endClassGateFailed": 0}}
  ],
  "requiredPositiveControls": ["PC-1", "PC-2", "PC-4", "PC-5"],
  "degradingControls": {"PC-3": "C6 guard disables V-EDGE; affected targets INCONCLUSIVE(VB_UNAVAILABLE:VB-3)"},
  "representativenessGate": {"id": "RG", "allOf": ["PC-1 == PASSED", "PC-3 == PASSED", "inCaptureEdgePairAfterRqPostSlotNew1"]},
  "c6GuardInput": {"guard": "committed applyVbGuard, unchanged; only pc['VB-3'] differs by trace role", "target": "1 iff END.pc['VB-3'] == 1 && PC-3 re-derived PASSED from the control window", "controlTrace": "1 iff the control's own fit -> rise -> visible step -> fall -> adjacent TC pattern is re-derived in the same trace (PC-2/PC-5 expectations only; never feeds a target verdict, RG or END.pc)"},
  "externalGateRule": {"ncRerunOk": "only boolean true passes; absent or non-boolean => INVALID NEGATIVE_CONTROL_RERUN_UNKNOWN; false => NEGATIVE_CONTROL_RERUN_MISMATCH", "ledgerOk": "only boolean true passes; absent or non-boolean => INVALID HASH_LEDGER_UNKNOWN; false => HASH_LEDGER_INCONSISTENT", "ledgerOkComputedAt": "before publication: hash chain over the frozen raw set intact; manifest consistency is not a verdict input", "postPublicationCheck": "P5.10: manifest vs run-root files vs ledger vs hashLedgerSha256/terminalVerdictSha256; onFail SC-B07 and the commit record carries INVALID"},
  "targetPlanBindingRule": "sha256(canonicalBytes(targetPlan)) == binding.targetPlanSha256 == META.tq of every trace, else INVALID TARGET_PLAN_DIGEST_MISMATCH; the plan is read from governance/target-plan.json",
  "controlRunLinkageRule": "control META.run == target META.run + '-pc1' | '-pc2' | '-pc4' | '-pc5', else INVALID CONTROL_RUN_NOT_LINKED:<PC>",
  "ambiguityScope": "ambiguity is assessed per pre-registered PRIMARY target question; non-primary targets are diagnostic only and never change the run verdict; a primary target is SUPPORTED/REJECTED only from a DEFINITE, assumption-authorized, non-forbidden label not excluded by T0b/T0c/T1b/T1c/T2/T3a/T3",
  "targetReasons": {"reason": "first matching rule", "reasons": "ordered reasons of every applicable rule T0b..T3 plus FORBIDDEN_LABEL; T0/T4/T5/T6 contribute their own reason only", "prototypeName": "allReasons"},
  "targetRules": [
    {"id": "T0", "verdict": "inherit", "when": {"runVerdictIn": ["BLOCKED", "INVALID"]}},
    {"id": "T0b", "verdict": "INCONCLUSIVE", "when": {"endClassGateFailed": 1}, "reason": "CLASS_NONTRANSITIVE"},
    {"id": "T0c", "verdict": "INCONCLUSIVE", "when": {"sourceFactContradiction": "TOKEN_REAPPEARED, or any SC-C04 stop"}, "reason": "SOURCE_FACT_CONTRADICTION:TOKEN_REAPPEARED | SOURCE_FACT_CONTRADICTION:SC-C04", "alsoSets": {"verdictWithheld": true, "withheldBy": "SC-C04"}},
    {"id": "T1", "verdict": "INCONCLUSIVE", "when": {"questionStatusNot": "DEFINITE"}, "reason": "questionReason", "reasonRenames": {"TRUNCATED (subject zero-sample timeout)": "NO_DECIDING_SAMPLE"}, "includes": ["PROJECTION_UNREPRESENTABLE:FIT_THREW", "PROJECTION_UNREPRESENTABLE:CAPACITY"]},
    {"id": "T1b", "verdict": "INCONCLUSIVE", "when": {"preMotionUnresolved": true, "questionId": "Q-OWNER|Q-SUBJ(non-DEFINITE)"}, "reason": "PRE_MOTION_UNRESOLVED"},
    {"id": "T1c", "verdict": "INCONCLUSIVE", "when": {"clearWithoutEdgeCleared": "Q-SUBJ: subject token; Q-OWNER: label in OWN|PRIOR_TERMINAL|IN_FLIGHT and any token cleared; Q-ATTR: a listed token"}, "reason": "IDENTITY_AMBIGUOUS:CLEAR_WITHOUT_EDGE"},
    {"id": "T2", "verdict": "INCONCLUSIVE", "when": {"assumptionPresent": true, "boundSlotWindowNot": "ASSUME_NO_UNOBSERVED_WRITER"}, "reason": "ASSUMPTION_NOT_AUTHORIZED"},
    {"id": "T3a", "verdict": "INCONCLUSIVE", "when": {"labelDependsOnVEdge": true, "edgeInit": "UNKNOWN"}, "reason": "EDGE_INIT_UNKNOWN"},
    {"id": "T3", "verdict": "INCONCLUSIVE", "when": {"labelDependsOnVEdge": true, "rg": false}, "reason": "VB3_NOT_REPRESENTATIVE"},
    {"id": "T4", "verdict": "REJECTED", "when": {"labelIn": "rejectLabels"}, "reason": "PREREGISTERED_REJECT"},
    {"id": "T5", "verdict": "SUPPORTED", "when": {"labelIn": "supportLabels"}, "reason": "PREREGISTERED_SUPPORT"},
    {"id": "T6", "verdict": "INCONCLUSIVE", "when": {"otherwise": true}, "reason": "LABEL_NOT_PREREGISTERED"}
  ],
  "labelDependsOnVEdge": {"Q-OWNER": "all", "Q-SUBJ": "all", "Q-ATTR": "nonEmptyList"},
  "soundQuestions": ["Q-OWNER", "Q-SUBJ", "Q-ATTR"],
  "preregistrableLabels": {"Q-OWNER": ["INIT", "RESTORE", "OWN", "PRIOR_TERMINAL", "IN_FLIGHT"], "Q-SUBJ": ["PENDING", "ACTIVE_PLUS", "COMPLETE"], "Q-ATTR": ["<non-empty ascending comma-joined token list>"]},
  "forbiddenLabels": {"Q-OWNER": ["FOREIGN"], "Q-SUBJ": ["ACTIVE0"], "Q-ATTR": ["-"]},
  "openReachableLabels": {"Q-OWNER": ["INIT", "RESTORE"], "Q-SUBJ": ["PENDING"], "Q-ATTR": []},
  "controlCoverage": {"RESTORE": "CONTROLLED", "PENDING": "MECHANISM_ONLY", "assumptionModeOwnershipOrAttribution": "CONTROLLED", "default": "NONE"},
  "historicalStatusConstants": {"g2": "FAIL (row 3)", "c6": "NOT_EVIDENCED", "c8": "UNRESOLVED", "t4": "UNCHANGED"},
  "targetPlanSchema": {
    "fields": ["planId", "steps", "targets"],
    "unknownFieldsAllowed": false,
    "planIdPattern": "^[a-z0-9-]{1,64}$",
    "maxSteps": 32,
    "stepOps": {"fit": [], "restore": [], "settle": ["role"], "c8": ["role"]},
    "settleRoles": ["G", "S", "P"],
    "c8Roles": ["subject", "superseded"],
    "counts": {"S": [1, 1], "G": [0, 2], "P": [0, 1], "fit": [1, 8], "restore": [0, 4]},
    "orderRules": ["every settle has at least one fit after the previous settle (or the plan start)", "a P settle comes after the S settle", "exactly one c8 subject, immediately after the S settle", "a c8 superseded iff a P settle, immediately after it"],
    "targetFields": ["targetId", "questionId", "primary", "supportLabels", "rejectLabels"],
    "fileBytes": "governance/target-plan.json: exactly canonicalStringify(plan) (rule 6); its SHA-256 is targetPlanSha256 = META.tq",
    "derivedBounds": {"frames(r)": "1 + settles*(floor(deadlineMs*r/1000)+1) + (fits+restores)*B1 + Bpost", "maxRefreshHz": "largest integer r <= cp.maxRefreshHz with frames(r) <= targetWindowFrames; 0 => SC-A07", "rawRecords(r)": "2*(frames(r)+controlWindowFrames) + 2*settles + 3*min(frames(r), settles*settleSamples) + retainedNumericSamples + 2*(fits+1) + 2*restores + viewerDispatchAllowance + c8Steps + 3 <= ec.max <= dataEvents, else SC-A07", "projectedEvents(r)": "2*frames(r) + (G+S settles) + fits + restores + viewerDispatchAllowance <= projectedEventsMax, else SC-A07", "liveCheck": "P0.13: measured rr <= maxRefreshHz, else SC-A17"},
    "conformance": {"phase": "P5.02", "derive": "target-window records in seq order: top-level RQ post -> fit (a nested RQ pair is an open-world call, not a step); RS post -> restore; T4 start -> settle(settleRole); C8 -> c8(measureRole)", "rule": "the derived list equals plan.steps exactly, except that a c8 step is expected iff its settle's terminal decision is settled; each settle's reqToken is the latest top-level fit's token or a call nested in it", "onMismatch": "INVALID TARGET_PLAN_NONCONFORMANT", "note": "a foreign top-level wrapped fitToView or restore is indistinguishable from a plan deviation and therefore fails closed"}
  }
}
```

### (iii) Runbook phases and steps (NOT EXECUTED)

```json
{
  "executed": false,
  "authorized": false,
  "requiresFutureOwnerAuthorizationRule": "true for every step that launches or drives a browser/page/Viewer, spends the authorization record, consumes the attempt, or runs inside the consumed attempt before offline analysis (P0.10-P0.14, all of P1-P4); false only for the static pre-reservation checks P0.01-P0.09 and offline analysis P5; false never means executable now (executed=false, authorized=false apply to every step)",
  "writesRule": "writes lists the write-once files a step creates (run-root relative; 'attempts:' = the diagnostic attempts directory). Each path is created by exactly one step. Append-only files (raw/hash-ledger.jsonl, *.records.jsonl, raw/stdout.log, raw/stderr.log) are created once and appended until closed. raw/stop.json is written at most once, only by a step that raises a stop before rawFrozen; a stop raised later is recorded only in TERMINAL-VERDICT.json stopCondition",
  "finalizationOrder": ["rawFrozen", "determinismChecked", "derivedPublished", "manifestWritten", "runRootFrozen", "commitRecordWritten"],
  "finalizationRule": "every governance/, preflight/, env/ and raw/ file is created before rawFrozen (raw/hash-ledger.jsonl stays append-only until runRootFrozen); derived/, TERMINAL-VERDICT.json and SC-C03-CLOSEOUT.json are created only by the derivedPublished step, after determinismChecked (the SC-C03 closeout is the alternate of derived/ plus TERMINAL-VERDICT.json, never an addition to them; scratch A and B are never written after they are compared); MANIFEST.json only by manifestWritten; nothing in the run root is created after runRootFrozen; the commit record is the last step",
  "phases": [
    {"phaseId": "P0", "name": "staticPreflightReservationLivePreflight", "consumesAttempt": false, "steps": [
      {"stepId": "P0.01", "action": "checkInterlock", "requiresFutureOwnerAuthorization": false, "preconditions": [], "onFail": null},
      {"stepId": "P0.02", "action": "checkRepoState", "requiresFutureOwnerAuthorization": false, "preconditions": ["P0.01"], "onFail": "SC-A01"},
      {"stepId": "P0.03", "action": "checkDigests", "requiresFutureOwnerAuthorization": false, "preconditions": ["P0.02"], "onFail": "SC-A02"},
      {"stepId": "P0.04", "action": "validateDiagnosticAuthorizationRecord", "requiresFutureOwnerAuthorization": false, "preconditions": ["P0.03"], "onFail": "SC-A03"},
      {"stepId": "P0.05", "action": "checkOutputAbsent", "requiresFutureOwnerAuthorization": false, "preconditions": ["P0.04"], "onFail": "SC-A04"},
      {"stepId": "P0.06", "action": "runNegativeControlSelfTestFullRegistry", "requiresFutureOwnerAuthorization": false, "preconditions": ["P0.05"], "onFail": "SC-A05", "ncRegistry": "controlMatrix.selfTestRegistry (NC-1a..NC-21, every variant)"},
      {"stepId": "P0.07", "action": "validateMetaTemplates", "requiresFutureOwnerAuthorization": false, "preconditions": ["P0.06"], "onFail": "SC-A06|SC-A13"},
      {"stepId": "P0.08", "action": "validateTargetPlan", "requiresFutureOwnerAuthorization": false, "preconditions": ["P0.07"], "onFail": "SC-A07|SC-A16"},
      {"stepId": "P0.09", "action": "checkToolchain", "requiresFutureOwnerAuthorization": false, "preconditions": ["P0.08"], "onFail": "SC-A08"},
      {"stepId": "P0.10", "action": "reserveAuthBound", "requiresFutureOwnerAuthorization": true, "preconditions": ["P0.09"], "onFail": "SC-A14", "effect": "recordSpent"},
      {"stepId": "P0.11", "action": "initEvidenceWriter", "requiresFutureOwnerAuthorization": true, "preconditions": ["P0.10"], "onFail": "SC-A15", "writes": ["raw/hash-ledger.jsonl", "governance/authorization-record.md", "governance/binding.json", "governance/target-plan.json", "preflight/phase0-static.json", "preflight/negative-controls.phase0.json", "env/environment.json", "raw/stdout.log", "raw/stderr.log"]},
      {"stepId": "P0.12", "action": "launchBrowserTwoContextsLoadViewerScript", "requiresFutureOwnerAuthorization": true, "preconditions": ["P0.11"], "onFail": "SC-A08"},
      {"stepId": "P0.13", "action": "checkVb0VbStructuralTagWrapperMeasureRefresh", "requiresFutureOwnerAuthorization": true, "preconditions": ["P0.12"], "onFail": "SC-A09|SC-A10|SC-A11|SC-A12|SC-A13|SC-A17", "writes": ["preflight/live-preflight.json"]},
      {"stepId": "P0.14", "action": "writeAttemptConsumed", "requiresFutureOwnerAuthorization": true, "preconditions": ["P0.13"], "onFail": "SC-A15", "effect": "attemptConsumed"}
    ]},
    {"phaseId": "P1", "name": "instrumentationInitialization", "consumesAttempt": true, "steps": [
      {"stepId": "P1.01", "action": "loadFixturesTargetPage", "requiresFutureOwnerAuthorization": true, "preconditions": ["P0.14"], "onFail": "SC-B05"},
      {"stepId": "P1.02", "action": "constructRecorderInstallHooks", "requiresFutureOwnerAuthorization": true, "preconditions": ["P1.01"], "onFail": "SC-B01", "recorderState": "CREATED"},
      {"stepId": "P1.03", "action": "verifyHooks", "requiresFutureOwnerAuthorization": true, "preconditions": ["P1.02"], "onFail": "SC-B01"},
      {"stepId": "P1.04", "action": "freezeTargetMetaTemplate", "requiresFutureOwnerAuthorization": true, "preconditions": ["P1.03"], "onFail": "SC-B01", "writes": ["preflight/meta-template.target.json"]}
    ]},
    {"phaseId": "P2", "name": "controlsDisposableInstance", "consumesAttempt": true, "steps": [
      {"stepId": "P2.01", "action": "freshContextPageRecorderPerControl", "requiresFutureOwnerAuthorization": true, "preconditions": ["P1.04"], "onFail": "SC-B01|SC-B05", "onePagePerControl": true, "writes": ["preflight/meta-template.pc-1.json", "preflight/meta-template.pc-2.json", "preflight/meta-template.pc-5.json", "preflight/meta-template.pc-4.json"]},
      {"stepId": "P2.02", "action": "runControlTrace", "requiresFutureOwnerAuthorization": true, "control": "PC-1", "preconditions": ["P2.01"], "onFail": "SC-B02", "controlTraceOrder": ["TZ targetEnd", "CT", "TZ final", "END"], "writes": ["raw/control/pc-1.records.jsonl", "raw/control/pc-1.trace.json"]},
      {"stepId": "P2.03", "action": "runControlTrace", "requiresFutureOwnerAuthorization": true, "control": "PC-2", "preconditions": ["P2.02"], "onFail": "SC-B02", "controlTraceOrder": ["TZ targetEnd", "CT", "TZ final", "END"], "writes": ["raw/control/pc-2.records.jsonl", "raw/control/pc-2.trace.json"]},
      {"stepId": "P2.04", "action": "runControlTrace", "requiresFutureOwnerAuthorization": true, "control": "PC-5", "preconditions": ["P2.03"], "onFail": "SC-B02", "controlTraceOrder": ["TZ targetEnd", "CT", "TZ final", "END"], "writes": ["raw/control/pc-5.records.jsonl", "raw/control/pc-5.trace.json"]},
      {"stepId": "P2.05", "action": "runControlTrace", "requiresFutureOwnerAuthorization": true, "control": "PC-4", "preconditions": ["P2.04"], "onFail": "SC-B02", "controlTraceOrder": ["TZ targetEnd", "CT", "TZ final", "END"], "writes": ["raw/control/pc-4.records.jsonl", "raw/control/pc-4.trace.json"]},
      {"stepId": "P2.06", "action": "evaluateControls", "requiresFutureOwnerAuthorization": true, "preconditions": ["P2.05"], "onFail": "SC-B02"},
      {"stepId": "P2.07", "action": "disposeControlContexts", "requiresFutureOwnerAuthorization": true, "preconditions": ["P2.06"], "onFail": "SC-B05", "writes": ["raw/control-disposal.json"]}
    ]},
    {"phaseId": "P3", "name": "targetSequence", "consumesAttempt": true, "steps": [
      {"stepId": "P3.01", "action": "checkQuiescenceEndingOnExactBoundaryRead", "requiresFutureOwnerAuthorization": true, "preconditions": ["P2.07"], "onFail": "SC-B03", "writes": ["raw/quiescence.json"]},
      {"stepId": "P3.02", "action": "sameSegmentBoundaryReadMetaCaptureStartFs", "requiresFutureOwnerAuthorization": true, "preconditions": ["P3.01"], "onFail": "SC-B04", "recorderState": "CAPTURING", "writes": ["raw/target/target.records.jsonl"]},
      {"stepId": "P3.03", "action": "executeTargetPlanStepsExactlyOnce", "requiresFutureOwnerAuthorization": true, "preconditions": ["P3.02"], "onFail": "SC-B08", "retry": false},
      {"stepId": "P3.04", "action": "samplePostSequenceQuiescence", "requiresFutureOwnerAuthorization": true, "preconditions": ["P3.03"], "onFail": "SC-B05"},
      {"stepId": "P3.05", "action": "terminalizeOnStepFailure", "requiresFutureOwnerAuthorization": true, "preconditions": [], "onFail": null}
    ]},
    {"phaseId": "P4", "name": "terminalization", "consumesAttempt": true, "steps": [
      {"stepId": "P4.01", "action": "writeTzTargetEndAndRunPc3", "requiresFutureOwnerAuthorization": true, "control": "PC-3", "preconditions": ["P3.04"], "onFail": "SC-C01", "recorderState": "CONTROL"},
      {"stepId": "P4.02", "action": "writeTzFinalRemoveRecorderListeners", "requiresFutureOwnerAuthorization": true, "preconditions": ["P4.01"], "onFail": "SC-B04", "onListenerRemovalFailure": "END.lr = 0; SC-C02 (recorded only)", "recorderState": "FINALIZING"},
      {"stepId": "P4.03", "action": "writeEnd", "requiresFutureOwnerAuthorization": true, "preconditions": ["P4.02"], "onFail": "SC-B04", "recorderState": "CLOSED"},
      {"stepId": "P4.04", "action": "flushHashValidateAtClose", "requiresFutureOwnerAuthorization": true, "preconditions": ["P4.03"], "onFail": "SC-B06", "writes": ["raw/target/target.trace.json"]},
      {"stepId": "P4.05", "action": "teardownWriteTeardownLedger", "requiresFutureOwnerAuthorization": true, "preconditions": ["P4.04"], "onFail": "SC-C02", "writes": ["raw/teardown.json"]},
      {"stepId": "P4.06", "action": "closeProcessLogsFreezeRawSet", "requiresFutureOwnerAuthorization": true, "preconditions": ["P4.05"], "onFail": "SC-B07", "finalization": "rawFrozen"},
      {"stepId": "P4.07", "action": "journalCloseoutStarted", "requiresFutureOwnerAuthorization": true, "preconditions": ["P4.06"], "onFail": "SC-B07"}
    ]},
    {"phaseId": "P5", "name": "offlineAnalysis", "consumesAttempt": true, "offlineOnly": true, "analysisRule": "P5.01-P5.06 write only into a fresh analysis scratch directory A outside the run root; P5.07 reruns them into a second fresh scratch directory B", "steps": [
      {"stepId": "P5.01", "action": "validateTraceV2AllTraces", "requiresFutureOwnerAuthorization": false, "preconditions": ["P4.07"], "onFail": "SC-B06"},
      {"stepId": "P5.02", "action": "checkBindingTargetPlanDigestConformanceControlLinkage", "requiresFutureOwnerAuthorization": false, "preconditions": ["P5.01"], "onFail": "SC-B06"},
      {"stepId": "P5.03", "action": "rerunNegativeControlsFullRegistry", "requiresFutureOwnerAuthorization": false, "preconditions": ["P5.02"], "onFail": "SC-B06", "ncRegistry": "controlMatrix.selfTestRegistry (NC-1a..NC-21, every variant)"},
      {"stepId": "P5.04", "action": "evaluateControlsRgAndAnnotations", "requiresFutureOwnerAuthorization": false, "preconditions": ["P5.03"], "onFail": null},
      {"stepId": "P5.05", "action": "projectGuardCorrelate", "requiresFutureOwnerAuthorization": false, "preconditions": ["P5.04"], "onFail": null},
      {"stepId": "P5.06", "action": "computeVerdictsIntoScratch", "requiresFutureOwnerAuthorization": false, "preconditions": ["P5.05"], "onFail": null},
      {"stepId": "P5.07", "action": "rerunAnalysisDeterminismCheck", "requiresFutureOwnerAuthorization": false, "preconditions": ["P5.06"], "onFail": "SC-C03", "scC03Branch": {"continuesAt": "P5.08", "publishes": [], "scratchAfterCompare": "READ_ONLY_UNCHANGED"}, "finalization": "determinismChecked"},
      {"stepId": "P5.08", "action": "writeDerivedSetAndTerminalVerdict", "requiresFutureOwnerAuthorization": false, "preconditions": ["P5.07"], "preconditionOutcome": "P5.07 completed: passed, or SC-C03 (closeout branch)", "onFail": "SC-B07", "finalization": "derivedPublished", "writes": ["derived/*", "TERMINAL-VERDICT.json"], "branchWrites": {"SC-C03": ["SC-C03-CLOSEOUT.json"]}},
      {"stepId": "P5.09", "action": "writeManifest", "requiresFutureOwnerAuthorization": false, "preconditions": ["P5.08"], "onFail": "SC-B07", "finalization": "manifestWritten", "writes": ["MANIFEST.json"]},
      {"stepId": "P5.10", "action": "checkManifestLedgerConsistencyPostPublication", "requiresFutureOwnerAuthorization": false, "preconditions": ["P5.09"], "onFail": "SC-B07", "onFailEffect": "commit record terminalVerdict INVALID (authoritative over TERMINAL-VERDICT.json); journal FAILED"},
      {"stepId": "P5.11", "action": "freezeRunRootReadOnly", "requiresFutureOwnerAuthorization": false, "preconditions": ["P5.10"], "onFail": "SC-B07", "finalization": "runRootFrozen"},
      {"stepId": "P5.12", "action": "writeCommitRecord", "requiresFutureOwnerAuthorization": false, "preconditions": ["P5.11"], "onFail": "SC-B07", "finalization": "commitRecordWritten", "writes": ["attempts:<authorizationId>.commit.json"]}
    ]}
  ]
}
```

### (iv) Authorization-binding fields and existing-format support

```json
{
  "existingFormat": {
    "markers": ["G2-LIVE-EXECUTION", "Authorization-ID", "Baseline-HEAD", "Procedure-SHA256", "Harness-SHA256", "Model-A-URN-SHA256", "Model-B-URN-SHA256", "Runtime", "Supersedes"],
    "fixedRuntimeLine": "Runtime: viewer=7.124.2 env=AutodeskProduction2 api=streamingV2",
    "harnessPathHashed": "test/acceptance/clashpanel-viewerbridge.acceptance.mjs",
    "candidateSetRule": "docs/prompts/**/*.md with a line beginning 'G2-LIVE-EXECUTION:'; exactly one non-superseded",
    "canBindDiagnosticRun": false
  },
  "fields": [
    {"name": "authorizationId", "existingMarker": "Authorization-ID", "existingFormatSupport": "SUPPORTED"},
    {"name": "recordKind", "existingMarker": "G2-LIVE-EXECUTION", "existingFormatSupport": "NOT_SUPPORTED", "hazard": "acceptance candidate-set membership"},
    {"name": "repoCommit", "existingMarker": "Baseline-HEAD", "existingFormatSupport": "SUPPORTED"},
    {"name": "procedureSha256", "existingMarker": "Procedure-SHA256", "existingFormatSupport": "SUPPORTED", "requiredValue": "d1ccfde224b8ae76fe74b06c93abc532e6df9612933cafaa045053c8e2e45a75"},
    {"name": "acceptanceHarnessSha256", "existingMarker": "Harness-SHA256", "existingFormatSupport": "SUPPORTED", "requiredValue": "cc8868cd68b9c2c3382297070289a2aa165c74249c6d82896d76bacc6c6ef09b"},
    {"name": "diagnosticHarnessSha256", "existingMarker": null, "existingFormatSupport": "NOT_SUPPORTED"},
    {"name": "diagnosticPackageSha256", "existingMarker": null, "existingFormatSupport": "NOT_SUPPORTED"},
    {"name": "diagnosticSpecSha256", "existingMarker": null, "existingFormatSupport": "NOT_SUPPORTED"},
    {"name": "viewerVersion", "existingMarker": "Runtime", "existingFormatSupport": "SUPPORTED", "requiredValue": "7.124.2"},
    {"name": "viewerBundleSha256", "existingMarker": null, "existingFormatSupport": "NOT_SUPPORTED", "requiredValue": "12b9fe49f41dc99ccec62535e5c887da915980829da2e941cfe4da3d7197c02e"},
    {"name": "runtimeEnvelope", "existingMarker": "Runtime", "existingFormatSupport": "SUPPORTED"},
    {"name": "runtimeToolchain", "existingMarker": "Harness-SHA256 (indirect)", "existingFormatSupport": "PARTIAL"},
    {"name": "exactCommand", "existingMarker": null, "existingFormatSupport": "NOT_SUPPORTED"},
    {"name": "modelInputs", "existingMarker": "Model-A-URN-SHA256, Model-B-URN-SHA256", "existingFormatSupport": "PARTIAL"},
    {"name": "targetPlanSha256", "existingMarker": null, "existingFormatSupport": "NOT_SUPPORTED"},
    {"name": "atoms", "existingMarker": null, "existingFormatSupport": "NOT_SUPPORTED", "requiredValue": ["P-FRM", "P-TC", "V-PEND", "V-EDGE"]},
    {"name": "idAxis", "existingMarker": null, "existingFormatSupport": "NOT_SUPPORTED", "requiredValue": "ON"},
    {"name": "slotWindow", "existingMarker": null, "existingFormatSupport": "NOT_SUPPORTED", "default": "OPEN", "ownerDecision": "OD-2"},
    {"name": "controlRequirements", "existingMarker": null, "existingFormatSupport": "NOT_SUPPORTED", "requiredControls": ["PC-1", "PC-2", "PC-4", "PC-5"], "degradingControls": ["PC-3"]},
    {"name": "caps", "existingMarker": null, "existingFormatSupport": "NOT_SUPPORTED"},
    {"name": "outputLocation", "existingMarker": null, "existingFormatSupport": "NOT_SUPPORTED", "proposed": {"runRoot": "test/acceptance/results/g2-live-diagnostic/<authorizationId>/", "attemptsDir": "test/acceptance/results/g2-live-diagnostic-attempts/"}},
    {"name": "exactlyOneAttempt", "existingMarker": "G2-LIVE-EXECUTION + reservation/journal", "existingFormatSupport": "PARTIAL"},
    {"name": "noRetry", "existingMarker": "G2-LIVE-EXECUTION + journal", "existingFormatSupport": "PARTIAL"},
    {"name": "consumptionBoundary", "existingMarker": "ATTEMPT_CONSUMED before first loadDocumentNode", "existingFormatSupport": "PARTIAL", "proposed": "ATTEMPT_CONSUMED before first model load in either instance"},
    {"name": "supersedes", "existingMarker": "Supersedes", "existingFormatSupport": "SUPPORTED"},
    {"name": "issuanceSeparateFromExecution", "existingMarker": "free text", "existingFormatSupport": "PARTIAL"}
  ],
  "ownerDecisionForUnsupported": "OD-1",
  "recordIssued": false
}
```

### (v) Evidence manifest schema

```json
{
  "manifestSchemaVersion": 1,
  "type": "object",
  "required": ["manifestSchemaVersion", "authorizationId", "attemptId", "runId", "bindingSha256", "authorizationRecordSha256", "digests", "files", "hashLedgerSha256", "terminalVerdict", "terminalCarrierPath", "terminalVerdictSha256"],
  "properties": {
    "authorizationId": {"type": "string", "pattern": "^[a-z0-9-]{8,64}$"},
    "attemptId": {"type": "string", "format": "uuidv4-lowercase"},
    "runId": {"type": "string", "pattern": "^[a-z0-9-]{1,32}$"},
    "bindingSha256": {"type": "hex64"},
    "authorizationRecordSha256": {"type": "hex64"},
    "digests": {
      "type": "object",
      "required": ["repoCommit", "procedureSha256", "acceptanceHarnessSha256", "diagnosticHarnessSha256", "diagnosticPackageSha256", "diagnosticSpecSha256", "targetPlanSha256", "viewerVersionObserved", "viewerBundleSha256Observed", "traceStreamSha256ByRole"]
    },
    "files": {
      "type": "array",
      "sortedBy": "path",
      "items": {
        "type": "object",
        "required": ["path", "sha256", "bytes", "fileClass", "phase"],
        "ledgerSeqExceptPaths": ["raw/hash-ledger.jsonl"],
        "ledgerSeqRule": "every listed file except raw/hash-ledger.jsonl carries the seq of its own hash-ledger line; the ledger itself is bound by hashLedgerSha256",
        "properties": {
          "path": {"type": "string", "rule": "relative to run root, POSIX, no '..'"},
          "sha256": {"type": "hex64"},
          "bytes": {"type": "int", "min": 0},
          "fileClass": {"enum": ["governance", "preflight", "env", "raw", "rawDerivedByRule", "derived", "terminal"]},
          "phase": {"enum": ["P0", "P1", "P2", "P3", "P4", "P5"]},
          "ledgerSeq": {"type": "int", "min": 1},
          "inputs": {"type": "array", "items": {"type": "hex64"}, "requiredFor": ["derived", "rawDerivedByRule", "terminal"]},
          "supersedesSha256": {"type": "hex64", "optional": true}
        }
      }
    },
    "hashLedgerSha256": {"type": "hex64"},
    "terminalVerdict": {"enum": ["BLOCKED", "INVALID", "INCONCLUSIVE", "REJECTED", "SUPPORTED", "WITHHELD"], "rule": "WITHHELD iff the terminal carrier is SC-C03-CLOSEOUT.json (SC-C03) or TERMINAL-VERDICT.json has verdictWithheld = true (SC-C04); the commit record carries the same value, except after a P5.10 failure (SC-B07), where the commit record is INVALID and is authoritative over the manifest's pre-failure terminalVerdict; the commit record's manifestSha256 is always the SHA-256 of the manifest bytes actually frozen"},
    "terminalCarrierPath": {"enum": ["TERMINAL-VERDICT.json", "SC-C03-CLOSEOUT.json"], "rule": "exactly one terminal-class file exists in the run root and it is this path; SC-C03-CLOSEOUT.json requires terminalVerdict WITHHELD and no derived/ file and no TERMINAL-VERDICT.json; TERMINAL-VERDICT.json requires no SC-C03-CLOSEOUT.json"},
    "terminalVerdictSha256": {"type": "hex64", "rule": "SHA-256 of the file at terminalCarrierPath (the field keeps its name for compatibility)"}
  },
  "excludesSelf": true,
  "hashLedgerExcludes": ["raw/hash-ledger.jsonl", "MANIFEST.json"],
  "serialization": "file bytes are exactly the UTF-8 encoding of the D2 canonicalStringify output: no BOM, no whitespace, no trailing newline (the last byte is '}'); manifestSha256 is the SHA-256 of exactly these bytes",
  "boundBy": "<authorizationId>.commit.json manifestSha256"
}
```

### (vi) Stop conditions

```json
{
  "classes": {
    "a": {"attemptConsumed": false, "runVerdict": "BLOCKED", "subclasses": {"a1": "before any browser/Viewer invocation; record unspent iff before AUTH_BOUND", "a2": "after live preflight invocation, before ATTEMPT_CONSUMED; journal PREFLIGHT_FAILED; record spent"}},
    "b": {"attemptConsumed": true, "runVerdict": "INVALID", "retry": false},
    "c": {"attemptConsumed": "n/a", "runVerdict": "unchanged or withheld", "note": "degraded-valid, recorded-only, or owner decision"}
  },
  "stopConditions": [
    {"id": "SC-A01", "class": "a", "subclass": "a1", "condition": "dirtyProtectedStateOrHeadMismatch", "step": "P0.02"},
    {"id": "SC-A02", "class": "a", "subclass": "a1", "condition": "procedureHarnessPackageSpecPlanDigestMismatch", "step": "P0.03"},
    {"id": "SC-A03", "class": "a", "subclass": "a1", "condition": "authorizationAbsentMalformedAmbiguousSupersededOrSpent", "step": "P0.04"},
    {"id": "SC-A04", "class": "a", "subclass": "a1", "condition": "outputDirectoryNotAbsent", "step": "P0.05"},
    {"id": "SC-A05", "class": "a", "subclass": "a1", "condition": "negativeControlSelfTestMismatch", "step": "P0.06"},
    {"id": "SC-A06", "class": "a", "subclass": "a1", "condition": "metaValidationFailure", "step": "P0.07"},
    {"id": "SC-A07", "class": "a", "subclass": "a1", "condition": "bufferBoundTooSmall (raw worst case > ec.max or 24576; projected worst case > 8192; duration at 360 Hz > targetWindowFrames; B3 > controlWindowFrames)", "step": "P0.08"},
    {"id": "SC-A08", "class": "a", "subclass": "a1|a2", "condition": "toolchainMismatch", "step": "P0.09|P0.12"},
    {"id": "SC-A09", "class": "a", "subclass": "a2", "condition": "wrongViewerVersion", "step": "P0.13"},
    {"id": "SC-A10", "class": "a", "subclass": "a2", "condition": "viewerBundleDigestMismatch", "step": "P0.13"},
    {"id": "SC-A11", "class": "a", "subclass": "a2", "condition": "requiredVbObservableUnavailable", "step": "P0.13"},
    {"id": "SC-A12", "class": "a", "subclass": "a2", "condition": "requestTaggingUnavailable", "step": "P0.13"},
    {"id": "SC-A13", "class": "a", "subclass": "a1|a2", "condition": "capabilityMismatch", "step": "P0.07|P0.13"},
    {"id": "SC-A14", "class": "a", "subclass": "a1", "condition": "reservationDurabilityFailure", "step": "P0.10"},
    {"id": "SC-A15", "class": "a", "subclass": "a2", "condition": "evidenceWriterOrConsumptionJournalFailureBeforeConsumption", "step": "P0.11|P0.14"},
    {"id": "SC-A16", "class": "a", "subclass": "a1", "condition": "preregisteredTargetPlanInvalid (incl. settle roles outside S=1, G<=2, P<=1, overlapping settles, >8 fits, >4 restores)", "step": "P0.08"},
    {"id": "SC-A17", "class": "a", "subclass": "a2", "condition": "refreshRateOutOfBound (measured rAF > 360 Hz, or plan duration at measured rate > targetWindowFrames)", "step": "P0.13"},
    {"id": "SC-B01", "class": "b", "condition": "hookInstallOrVerifyFailure (incl. second recorder in a page; control-page VB re-check failure)", "step": "P1.02|P1.03|P1.04|P2.01"},
    {"id": "SC-B02", "class": "b", "condition": "controlFailureBeforeTargetCapture", "step": "P2.02-P2.06"},
    {"id": "SC-B03", "class": "b", "condition": "quiescenceNotReached", "step": "P3.01"},
    {"id": "SC-B04", "class": "b", "condition": "overflowTruncationOrInvalidAppends", "step": "P3|P4"},
    {"id": "SC-B05", "class": "b", "condition": "crashExceptionOrDeadline", "step": "any after P0.14"},
    {"id": "SC-B06", "class": "b", "condition": "traceIntegrityFailure", "step": "P4.04|P5.01|P5.02|P5.03"},
    {"id": "SC-B07", "class": "b", "condition": "evidenceWriteOnceOrHashFailure", "step": "after P0.14"},
    {"id": "SC-B08", "class": "b", "condition": "targetStepNotIssuedAsSpecified", "step": "P3.03"},
    {"id": "SC-C01", "class": "c", "condition": "postCaptureVb3ControlFailed", "step": "P4.01", "effect": "V-EDGE disabled; targets INCONCLUSIVE"},
    {"id": "SC-C02", "class": "c", "condition": "teardownOrListenerRemovalFailureAfterTraceClosed", "step": "P4.02|P4.05", "effect": "recorded only (raw/teardown.json; END.lr = 0)"},
    {"id": "SC-C03", "class": "c", "condition": "analysisNotDeterministic", "step": "P5.07", "effect": "A and B retained byte-unchanged and unpublished; terminal carrier SC-C03-CLOSEOUT.json (no TERMINAL-VERDICT.json, no derived/); manifest and commit record terminalVerdict WITHHELD; promotion prohibited; attempt stays consumed, retry unauthorized; owner decision (section 13.7)"},
    {"id": "SC-C04", "class": "c", "condition": "contradictionWithCommittedConclusion (incl. TOKEN_REAPPEARED, a source-fact contradiction)", "step": "P5", "effect": "every target INCONCLUSIVE (T0c); verdict withheld; persist under docs/reviews; awaiting owner decision"},
    {"id": "SC-C05", "class": "c", "condition": "edgeInitUnknownInWrittenTrace", "step": "P5.04", "effect": "V-EDGE dropped; edge-dependent targets INCONCLUSIVE(EDGE_INIT_UNKNOWN)"},
    {"id": "SC-C06", "class": "c", "condition": "classGateFailed", "step": "P5.04", "effect": "every target INCONCLUSIVE(CLASS_NONTRANSITIVE)"},
    {"id": "SC-C07", "class": "c", "condition": "projectionUnrepresentable", "step": "P5.05", "effect": "every target INCONCLUSIVE(PROJECTION_UNREPRESENTABLE)"}
  ]
}
```

### (vii) Control matrix

```json
{
  "positiveControls": [
    {
      "id": "PC-1",
      "where": "disposable fresh page, Phase 2, own trace",
      "required": true,
      "failureEffect": "SC-B02 -> INVALID"
    },
    {
      "id": "PC-2",
      "where": "disposable fresh page, Phase 2, own trace",
      "required": true,
      "failureEffect": "SC-B02 -> INVALID"
    },
    {
      "id": "PC-3",
      "where": "target page, Phase 4, control window",
      "required": false,
      "failureEffect": "SC-C01: C6 guard disables V-EDGE; edge-dependent targets INCONCLUSIVE"
    },
    {
      "id": "PC-4",
      "where": "disposable fresh page, Phase 2, own trace",
      "required": true,
      "failureEffect": "SC-B02 -> INVALID",
      "passRule": {"structural": "I5 for both C8 records; two distinct fresh fits; order fit1 -> S(r=fit1) -> subject C8 -> fit2 -> P(r=fit2) -> superseded C8", "numericLiveOnly": "for each C8 whose bound terminal-sample NV is retained: the frozen C8 frustum oracle (bound Phase-5 evaluator) reproduces evaluable/inside"},
      "offlinePrototype": {"scope": "STRUCTURAL_ONLY", "oracleAvailable": false, "nvReproduction": ["NOT_RETAINED", "NOT_EVALUATED_OFFLINE"], "boundNvRetained": "FAILED (NV_REPRODUCTION_LIVE_ONLY)"}
    },
    {
      "id": "PC-5",
      "where": "disposable fresh page, Phase 2, own trace",
      "required": true,
      "failureEffect": "SC-B02 -> INVALID"
    }
  ],
  "representativenessGate": {
    "id": "RG",
    "allOf": [
      "PC-1 == PASSED",
      "PC-3 == PASSED",
      "inCaptureEdgePairAfterRqPostSlotNew1"
    ],
    "historicalEvidence": false
  },
  "pendingControlGap": {
    "label": "PENDING",
    "controlCoverage": "MECHANISM_ONLY"
  },
  "negativeControls": [
    {
      "id": "NC-1a",
      "name": "wrongViewerVersionHonest",
      "expectedIntegrity": "envelopeOk=true (steps 1-3); step 4 OBSERVED_VIEWER_NOT_BOUND; ok=false; vbEligible=false",
      "expectedRunVerdict": "INVALID",
      "liveStop": "SC-A09"
    },
    {
      "id": "NC-1b",
      "name": "wrongViewerVersionClaimsVb0",
      "expectedIntegrity": "META-INVALID+META-VB0-INCONSISTENT",
      "expectedRunVerdict": "INVALID",
      "liveStop": "SC-A09"
    },
    {
      "id": "NC-2a",
      "name": "wrongBundleDigestHonest",
      "expectedIntegrity": "envelopeOk=true (steps 1-3); step 4 OBSERVED_BUNDLE_NOT_BOUND; ok=false; vbEligible=false",
      "expectedRunVerdict": "INVALID",
      "liveStop": "SC-A10"
    },
    {
      "id": "NC-2b",
      "name": "wrongBundleDigestClaimsVb0",
      "expectedIntegrity": "META-INVALID+META-VB0-INCONSISTENT",
      "expectedRunVerdict": "INVALID",
      "liveStop": "SC-A10"
    },
    {
      "id": "NC-3a",
      "name": "missingVb1",
      "expectedIntegrity": "valid",
      "expectedRunVerdict": "INCONCLUSIVE",
      "liveStop": "SC-A11"
    },
    {
      "id": "NC-3b",
      "name": "missingVb3Behaviour",
      "expectedIntegrity": "valid",
      "expectedRunVerdict": "INCONCLUSIVE",
      "liveStop": null
    },
    {
      "id": "NC-4a",
      "name": "missingRequestTag",
      "expectedIntegrity": "DATA-INVALID",
      "expectedRunVerdict": "INVALID",
      "liveStop": "SC-A12|SC-B01"
    },
    {
      "id": "NC-4b",
      "name": "requestTaggingOff",
      "expectedIntegrity": "META-INVALID",
      "expectedRunVerdict": "INVALID",
      "liveStop": "SC-A13"
    },
    {
      "id": "NC-5",
      "name": "ambiguousRequestOwnership",
      "expectedIntegrity": "valid",
      "expectedRunVerdict": "INCONCLUSIVE",
      "liveStop": null
    },
    {
      "id": "NC-6",
      "name": "traceIntegrityFailure",
      "expectedIntegrity": "SEQ-GAP|STREAM-DIGEST-MISMATCH|META-FIELD-IN-DATA|VERSION-MIXED|I3-HOST-PS|FS-FRAME-GAP|RS-PAIR|FRAME-ORDER|TIME-ORDER",
      "expectedRunVerdict": "INVALID",
      "liveStop": "SC-B06"
    },
    {
      "id": "NC-7",
      "name": "truncatedTrace",
      "expectedIntegrity": "END-MISSING|TRUNCATED|I6-TZ-WINDOW",
      "expectedRunVerdict": "INVALID",
      "liveStop": "SC-B04"
    },
    {
      "id": "NC-8",
      "name": "overflowedTrace",
      "expectedIntegrity": "OVERFLOW",
      "expectedRunVerdict": "INVALID",
      "liveStop": "SC-B04"
    },
    {
      "id": "NC-9",
      "name": "unmatchedEnvelope",
      "expectedIntegrity": "RUN-ID-MISMATCH|META-DUPLICATE|DATA-AFTER-END|COUNT-MISMATCH|TZ-STATUS-MISMATCH",
      "expectedRunVerdict": "INVALID",
      "liveStop": "SC-B06"
    },
    {
      "id": "NC-10",
      "name": "preMotionAmbiguity",
      "expectedIntegrity": "valid",
      "expectedRunVerdict": "INCONCLUSIVE",
      "liveStop": null
    },
    {
      "id": "NC-11",
      "name": "pendingClearActiveEdgeGap",
      "expectedIntegrity": "valid",
      "expectedRunVerdict": "INCONCLUSIVE",
      "liveStop": null
    },
    {
      "id": "NC-12",
      "name": "c8NotBoundToTerminalSettledSample",
      "expectedIntegrity": "I5-C8-BINDING",
      "expectedRunVerdict": "INVALID",
      "liveStop": "SC-B06"
    },
    {
      "id": "NC-13",
      "name": "partialTraceNeverPositive",
      "expectedIntegrity": "END-MISSING (every prefix)",
      "expectedRunVerdict": "INVALID (every prefix)",
      "liveStop": null
    },
    {
      "id": "NC-14",
      "name": "inconclusiveC8NumericNotRetained",
      "expectedIntegrity": "valid",
      "expectedRunVerdict": "unchanged (C8 numeric AMBIGUOUS(NUMERIC_NOT_RETAINED))",
      "liveStop": null
    },
    {
      "id": "NC-15",
      "name": "edgeInitUnknown",
      "expectedIntegrity": "valid (variants 1-3); META-INVALID EDGEINIT-INCONSISTENT (variant 4)",
      "expectedRunVerdict": "INCONCLUSIVE (1-3) with EDGE_INIT_UNKNOWN in each edge-dependent target's ordered reasons (first reason normally T1's); INVALID (4)",
      "liveStop": "SC-B03|SC-C05"
    },
    {
      "id": "NC-16",
      "name": "subjectZeroSampleTimeout",
      "expectedIntegrity": "valid",
      "expectedRunVerdict": "INCONCLUSIVE (NO_DECIDING_SAMPLE)",
      "liveStop": null
    },
    {
      "id": "NC-17",
      "name": "moreThan64SamplesThenSettled",
      "expectedIntegrity": "valid; sampleIndex 1802 variant OVERFLOW",
      "expectedRunVerdict": "per targets (compacted projection, never MALFORMED); variant INVALID",
      "liveStop": "SC-B04 (variant)"
    },
    {
      "id": "NC-18",
      "name": "supersededC8",
      "expectedIntegrity": "valid; misbound variants I5-C8-BINDING",
      "expectedRunVerdict": "unchanged; variants INVALID",
      "liveStop": "SC-B06 (variants)"
    },
    {
      "id": "NC-19",
      "name": "lateCallbackAfterTzFinal",
      "expectedIntegrity": "bytes/seq/counters unchanged; data-after-final variant I6-TZ-WINDOW|DATA-AFTER-END",
      "expectedRunVerdict": "unchanged; variant INVALID",
      "liveStop": "SC-B06 (variant)"
    },
    {
      "id": "NC-20",
      "name": "repeatedRunListenerDuplication",
      "expectedIntegrity": "second recorder refused | META-INVALID RECORDER-ORDINAL | committed C3 EDGE_REPEAT | repeated teardown no-op",
      "expectedRunVerdict": "INVALID (a-c); unchanged (d)",
      "liveStop": "SC-B01"
    },
    {
      "id": "NC-21",
      "name": "projectionUnrepresentable",
      "expectedIntegrity": "valid",
      "expectedRunVerdict": "INCONCLUSIVE (PROJECTION_UNREPRESENTABLE)",
      "liveStop": "SC-C07"
    }
  ],
  "selfTest": {
    "phase0": "P0.06 (SC-A05 on mismatch)",
    "phase5": "P5.03 (INVALID on mismatch)"
  },
  "selfTestRegistry": {
    "order": ["NC-1a", "NC-1b", "NC-2a", "NC-2b", "NC-3a", "NC-3b", "NC-4a", "NC-4b", "NC-5", "NC-6", "NC-7", "NC-8", "NC-9", "NC-10", "NC-11", "NC-12", "NC-13", "NC-14", "NC-15", "NC-16", "NC-17", "NC-18", "NC-19", "NC-20", "NC-21"],
    "variants": "every variant named in section 11.3 for an id is part of the registry",
    "runAt": ["P0.06", "P5.03"],
    "registryDigest": "SHA-256 of canonicalBytes(negativeControls) of this block",
    "expectedResultsDigest": "SHA-256 of the canonical expected-results document (one entry per registry fixture, in registry order)",
    "boundBy": "diagnosticPackageSha256 (both digests are package contents); preflight/negative-controls.phase0.json and derived/negative-controls.phase5.json record them"
  }
}
```

### (viii) `SC-C03` closeout schema (M1 correction)

```json
{
  "closeoutSchemaVersion": 1,
  "path": "SC-C03-CLOSEOUT.json",
  "fileClass": "terminal",
  "phase": "P5",
  "writtenBy": "P5.08 (SC-C03 branch only)",
  "serialization": "exactly the UTF-8 encoding of the D2 canonicalStringify output: no BOM, no whitespace, no trailing newline; no timestamp, no absolute path, no evaluator output",
  "bounds": {"maxBytes": 262144, "maxFilesPerAnalysis": 128, "maxDifferingEntries": 256, "maxPathBytes": 128},
  "bundleRule": "bundleSha256 = SHA-256 of the canonical UTF-8 string of the analysis file table: an array of {bytes, path, sha256} sorted by path (UTF-16 code-unit order); fileCount = its length; totalBytes = the sum of its bytes",
  "required": ["closeoutSchemaVersion", "kind", "authorizationId", "attemptId", "runId", "stopCondition", "step", "outcome", "reasonCode", "comparison", "analysisA", "analysisB", "terminalVerdict", "verdictWithheld", "withheldBy", "promotion", "attempt", "inputDigests", "bindingSha256", "targetPlanSha256", "scope", "historicalStatus"],
  "fixed": {
    "closeoutSchemaVersion": 1,
    "kind": "SC-C03-CLOSEOUT",
    "stopCondition": "SC-C03",
    "step": "P5.07",
    "outcome": "ANALYSIS_NONDETERMINISTIC",
    "reasonCode": "SC_C03_AB_MISMATCH",
    "terminalVerdict": "WITHHELD",
    "verdictWithheld": true,
    "withheldBy": "SC-C03",
    "scope": "NEW_RUN_ONLY",
    "historicalStatus": {"g2": "FAIL (row 3)", "c6": "NOT_EVIDENCED", "c8": "UNRESOLVED", "t4": "UNCHANGED"}
  },
  "properties": {
    "authorizationId": {"type": "string", "pattern": "^[a-z0-9-]{8,64}$"},
    "attemptId": {"type": "string", "format": "uuidv4-lowercase"},
    "runId": {"type": "string", "pattern": "^[a-z0-9-]{1,32}$"},
    "comparison": {"type": "object", "required": ["method", "result", "differingCount", "differing"], "method": "PER_FILE_BYTE_EQUALITY", "result": "MISMATCH", "differingCount": "int >= 1, equal to differing.length", "differing": {"type": "array", "sortedBy": "path", "items": {"required": ["path", "kind", "sha256A", "bytesA", "sha256B", "bytesB"], "kind": ["CONTENT", "ONLY_IN_A", "ONLY_IN_B"], "rule": "CONTENT: both sides present with different bytes; ONLY_IN_A: sha256B and bytesB are null; ONLY_IN_B: sha256A and bytesA are null"}}},
    "analysisA": {"type": "object", "required": ["bundleSha256", "fileCount", "totalBytes", "files"], "files": "array of {bytes, path, sha256} sorted by path"},
    "analysisB": {"type": "object", "required": ["bundleSha256", "fileCount", "totalBytes", "files"], "files": "array of {bytes, path, sha256} sorted by path"},
    "promotion": {"type": "object", "fixed": {"eligible": false, "promotedAnalysis": null, "authoritativeAnalysis": null, "reason": "SC_C03_NONDETERMINISM"}},
    "attempt": {"type": "object", "fixed": {"attemptConsumed": true, "retryAuthorized": false, "ownerDecisionRequired": true}},
    "inputDigests": {"type": "array", "items": "hex64", "rule": "sorted, unique, non-empty: the digests of the frozen raw files that Phase 5 read (including governance/target-plan.json); every one is listed in MANIFEST.files"},
    "bindingSha256": {"type": "hex64"},
    "targetPlanSha256": {"type": "hex64"}
  },
  "consistencyRules": [
    "analysisA.bundleSha256 !== analysisB.bundleSha256 (a closeout is never produced for identical analyses)",
    "comparison.differing is exactly the per-file difference of the two tables, computed from the tables only",
    "no key of this document comes from the content of an A or B file: only from their file tables, the run identity and the raw input digests",
    "the closeout is the only terminal-class file in the run root; there is no derived/ file and no TERMINAL-VERDICT.json"
  ]
}
```

## Consistency table

Every record kind, capture point, control, stop condition and verdict, with the part and section that defines it. Ids are stable; the prototype generates from the two appendices under these names.

| Id | Defined in | Section |
|---|---|---|
| `RQ` (record kind) | Part 1 | §8.1, CP01/CP02, §8.3 |
| `PS` (record kind) | Part 1 | §8.1, CP03/CP04, I3, I7 |
| `TE` (record kind) | Part 1 | §8.1, CP05/CP06 |
| `FS` (record kind) | Part 1 | §8.1, CP07 |
| `T4` (record kind) | Part 1 | §8.1, CP08/CP09, I4 |
| `RS` (record kind) | Part 1 | §8.1, CP10/CP11 |
| `CE` (record kind) | Part 1 | §8.1, CP12 (not in minimum) |
| `TC` (record kind) | Part 1 | §8.1, CP13 |
| `C8` (record kind) | Part 1 | §8.1, CP14, I5 |
| `TZ` (record kind) | Part 1 | §8.1, CP15, I6 |
| `CT` (record kind) | Part 1 | §8.1 (fields), I6 (placement) |
| `NV` (record kind) | Part 1 / Part 2 | P1 §8.1 (placement), P2 §12.4 (bytes; committed keys, cap 406 B) |
| `META` (record kind) | Part 2 | §12.3 |
| `END` (record kind) | Part 2 | §12.5 |
| `CP01` (beforeRequestIssuance) | Part 1 | §8.2; Appendix `capturePoints` |
| `CP02` (afterRequestIssuance) | Part 1 | §8.2; Appendix `capturePoints` |
| `CP03` (pendingSlotWriteChange) | Part 1 | §8.2; Appendix `capturePoints` |
| `CP04` (pendingSlotClear) | Part 1 | §8.2; Appendix `capturePoints` |
| `CP05` (transitionActiveRise) | Part 1 | §8.2; Appendix `capturePoints` |
| `CP06` (transitionActiveFall) | Part 1 | §8.2; Appendix `capturePoints` |
| `CP07` (frameIncrement) | Part 1 | §8.2; Appendix `capturePoints` |
| `CP08` (t4SampleAcquisition) | Part 1 | §8.2; Appendix `capturePoints` |
| `CP09` (t4SettleDecision) | Part 1 | §8.2; Appendix `capturePoints` |
| `CP10` (restoreInvocation) | Part 1 | §8.2; Appendix `capturePoints` |
| `CP11` (restoreCameraWrite) | Part 1 | §8.2; Appendix `capturePoints` |
| `CP12` (publicCameraChange) | Part 1 | §8.2; Appendix `capturePoints` |
| `CP13` (formalTransitionCompletion) | Part 1 | §8.2; Appendix `capturePoints` |
| `CP14` (c8FrustumMeasurement) | Part 1 | §8.2; Appendix `capturePoints` |
| `CP15` (diagnosticTerminalization) | Part 1 | §8.2; Appendix `capturePoints` |
| `PC-1` | Part 2 | §11.2; Appendix (vii) |
| `PC-2` | Part 2 | §11.2; Appendix (vii) |
| `PC-3` | Part 2 | §11.2; Appendix (vii) |
| `PC-4` | Part 2 | §11.2; Appendix (vii) |
| `PC-5` | Part 2 | §11.2; Appendix (vii) |
| `RG` | Part 2 | §11.4; Appendix (ii), (vii) |
| `NC-1a` | Part 2 | §11.3; Appendix (vii) |
| `NC-1b` | Part 2 | §11.3; Appendix (vii) |
| `NC-2a` | Part 2 | §11.3; Appendix (vii) |
| `NC-2b` | Part 2 | §11.3; Appendix (vii) |
| `NC-3a` | Part 2 | §11.3; Appendix (vii) |
| `NC-3b` | Part 2 | §11.3; Appendix (vii) |
| `NC-4a` | Part 2 | §11.3; Appendix (vii) |
| `NC-4b` | Part 2 | §11.3; Appendix (vii) |
| `NC-5` | Part 2 | §11.3; Appendix (vii) |
| `NC-6` | Part 2 | §11.3; Appendix (vii) |
| `NC-7` | Part 2 | §11.3; Appendix (vii) |
| `NC-8` | Part 2 | §11.3; Appendix (vii) |
| `NC-9` | Part 2 | §11.3; Appendix (vii) |
| `NC-10` | Part 2 | §11.3; Appendix (vii) |
| `NC-11` | Part 2 | §11.3; Appendix (vii) |
| `NC-12` | Part 2 | §11.3; Appendix (vii) |
| `NC-13` | Part 2 | §11.3; Appendix (vii) |
| `NC-14` | Part 2 | §11.3; Appendix (vii) |
| `NC-15` | Part 2 | §11.3; Appendix (vii) |
| `NC-16` | Part 2 | §11.3; Appendix (vii) |
| `NC-17` | Part 2 | §11.3; Appendix (vii) |
| `NC-18` | Part 2 | §11.3; Appendix (vii) |
| `NC-19` | Part 2 | §11.3; Appendix (vii) |
| `NC-20` | Part 2 | §11.3; Appendix (vii) |
| `NC-21` | Part 2 | §11.3; Appendix (vii) |
| `SC-A01` | Part 2 | §15; Appendix (vi) |
| `SC-A02` | Part 2 | §15; Appendix (vi) |
| `SC-A03` | Part 2 | §15; Appendix (vi) |
| `SC-A04` | Part 2 | §15; Appendix (vi) |
| `SC-A05` | Part 2 | §15; Appendix (vi) |
| `SC-A06` | Part 2 | §15; Appendix (vi) |
| `SC-A07` | Part 2 | §15; Appendix (vi) |
| `SC-A08` | Part 2 | §15; Appendix (vi) |
| `SC-A09` | Part 2 | §15; Appendix (vi) |
| `SC-A10` | Part 2 | §15; Appendix (vi) |
| `SC-A11` | Part 2 | §15; Appendix (vi) |
| `SC-A12` | Part 2 | §15; Appendix (vi) |
| `SC-A13` | Part 2 | §15; Appendix (vi) |
| `SC-A14` | Part 2 | §15; Appendix (vi) |
| `SC-A15` | Part 2 | §15; Appendix (vi) |
| `SC-A16` | Part 2 | §15; Appendix (vi) |
| `SC-A17` | Part 2 | §15; Appendix (vi) |
| `SC-B01` | Part 2 | §15; Appendix (vi) |
| `SC-B02` | Part 2 | §15; Appendix (vi) |
| `SC-B03` | Part 2 | §15; Appendix (vi) |
| `SC-B04` | Part 2 | §15; Appendix (vi) |
| `SC-B05` | Part 2 | §15; Appendix (vi) |
| `SC-B06` | Part 2 | §15; Appendix (vi) |
| `SC-B07` | Part 2 | §15; Appendix (vi) |
| `SC-B08` | Part 2 | §15; Appendix (vi) |
| `SC-C01` | Part 2 | §15; Appendix (vi) |
| `SC-C02` | Part 2 | §15; Appendix (vi) |
| `SC-C03` | Part 2 | §15; Appendix (vi) |
| `SC-C03-CLOSEOUT.json` (terminal carrier) | Part 2 | §13.7; Appendix (viii); Appendix (iii) P5.07/P5.08; Appendix (v) `terminalCarrierPath` |
| `SC-C04` | Part 2 | §15; Appendix (vi) |
| `SC-C05` | Part 2 | §15; Appendix (vi) |
| `SC-C06` | Part 2 | §15; Appendix (vi) |
| `SC-C07` | Part 2 | §15; Appendix (vi) |
| `SUPPORTED` (verdict) | Part 2 | §14.3–§14.4; Appendix (ii) |
| `REJECTED` (verdict) | Part 2 | §14.3–§14.4; Appendix (ii) |
| `INCONCLUSIVE` (verdict) | Part 2 | §14.3–§14.4; Appendix (ii) |
| `INVALID` (verdict) | Part 2 | §14.3–§14.4; Appendix (ii) |
| `BLOCKED` (verdict) | Part 2 | §14.3–§14.4; Appendix (ii) |
