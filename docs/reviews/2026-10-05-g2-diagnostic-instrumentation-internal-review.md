# G2 Diagnostic Instrumentation: Internal Review (research, prototype, results)

- **Authority:** `docs/prompts/for-claude-g2-diagnostic-instrumentation-research-to-ready-package.md` §13 (internal review; Critical/High/Medium/Low).
- **Baseline:** `main` @ `06980ee`, uncommitted package (no commit made or authorized by this review).
- **Reviewed:** `docs/research/2026-10-05-g2-diagnostic-instrumentation-research.md` (R), `docs/research/2026-10-05-g2-diagnostic-instrumentation-spec.md` (S, only where results or code bear on it; its Appendix A review was not repeated), and `docs/research/2026-10-05-g2-diagnostic-instrumentation/` (README, `*.mjs`, `results/`).
- **Independent reviewers used:** `codex-review architecture` on R (medium, request `20261005-105519-96436-23611`) and `codex-review code` on a bundle of `schema/project/correlate/sufficiency/bounds/run-diagnostic/observer.mjs` (high, request `20261005-105519-96458-22241`). Every Codex claim below was re-verified by the reviewer against code, data, or a reproduction before being adopted. Codex severities were recalibrated where noted.
- **Status of this file:** review claim only. It does not change any artifact, and it does not authorize any live work.

## 0. Verification performed by the reviewer

| Check | Result |
|---|---|
| `node --test docs/research/2026-10-05-g2-diagnostic-instrumentation/*.diag-test.mjs` | **35/35 pass**, 0 fail (≈111 s; includes a full re-run byte-identical to `results/`) |
| `git status --short` | only untracked: the 3 new `docs/research/2026-10-05-g2-diagnostic-instrumentation*` paths plus the 5 pre-existing untracked `docs/prompts/*` files. No tracked file modified; D2 tree, evidence, harness and product untouched |
| Summary claims (R §8.2-§8.4, §9) recomputed from `results/diag-summary.json` | Minimal sets, `recommended` distribution (`{P-TICK}` 24, `{P-FRM}` 22, `{}` 3, `{P-TC}` 2, `{V-EDGE}` 1), ID-OFF = ID-ON tables, 0 monotonicity violations, all necessity values, the union `{P-FRM, P-TICK}` covering all 52 keys, and "every atom occurs in a CL-cell minimal set" all **confirmed** |
| Correlator ambiguity reasons under `T-VB/ON` (recomputed; not persisted in the summary) | 5,063 `Q-OWNER` and 5,063 `Q-SUBJ` ambiguities, **all** `ACTIVE_WITHOUT_VISIBLE_STEP`, **all** ground-truth `subj=ACTIVE0` (owner INIT 494, PRIOR_TERMINAL 3,019, RESTORE 1,550). R's claim confirmed |
| Viewer-source spot check | Pinned bundle found in the A2 scratchpad with SHA-256 `12b9fe49…c02e` (matches R §1). V:26683-26686, 95232-95234, 96747-96750, 96758-96765, 96772-96775, 105004-105012, 107114-107123, 69859-69862, 14236-14240, 17625-17631 all say what R cites. Not executed |
| Vacuity ablation (reviewer script in scratchpad; ID-OFF; Q-TUPLE) | See §1 below |

## 1. Special focus: is "public-only 40,788 / 40,788" vacuous or by construction?

**Measured** (blocks / mixed-label `Q-TUPLE` blocks, per cell; `-noF` = frame index `f` removed from every projected event; `-noCL` = `cl`/`xc` also removed):

| Projection | CL-primary (3,240) | CL-tail (3,780) | OP-primary (14,112) | OP-tail (19,656) |
|---|---|---|---|---|
| base only | 559 / 150 | 606 / 154 | 1,411 / 657 | 1,065 / 592 |
| base + `P-TICK` | 1,713 / **0** | 2,422 / **0** | 6,825 / 72 | 9,404 / **0** |
| base + `P-TICK`, no `f` | 947 / 0 | 1,272 / 4 | 3,790 / 48 | 3,415 / 0 |
| `T-PUB` | **3,240** / 0 | **3,780** / 0 | **14,112** / 0 | **19,656** / 0 |
| `T-PUB`, no `f` | 1,968 / **0** | 3,055 / **0** | 12,792 / **0** | 19,656 / **0** |
| `T-PUB`, no `f`, no `cl`/`xc` | 1,898 / **0** | 2,736 / **0** | 12,232 / **0** | 16,064 / **0** |

**Judgement.**
1. **No label or schedule-ID leak.** No field in the public projection is a schedule id or a ground-truth label. `ow`/`XTC` (SYN) are gated by oracle atoms only. The base projection alone fails, and single atoms fail in some cells, so the result is not trivially true for every projection.
2. **But it is a closed-world determinism result, not diagnostic evidence.** Labels are deterministic functions of the D2 schedule tuple, and under `T-PUB` (with `f`) every relevant schedule has a unique trace (`blocks = relevant`). At that point every label, for every question, is a function of the trace automatically. That is what "40,788 / 40,788" measures.
3. **R's explanation is partly inaccurate (see M-3).** Trace *uniqueness* depends on `f` (CL-primary drops from 3,240 to 1,968 blocks without it), but label *separability* does **not**. With `f` and all camera classes removed, `T-PUB` still has 0 mixed blocks in all four cells. The per-frame `CAM`/`TCK` records reconstitute the clock, and with zero jitter, two requests and no foreign writer, event order is semantically complete. The driver is D2's determinism and closed universe, not the harness frame index specifically.
4. **Some separability is by construction of the label definitions.** `Q-DH7A` is defined as "the T phase was a D2 skip", and `TCK` is emitted iff the T phase was not a skip (`observer.mjs` `phaseT`). `Q-ACTIVE` equals `ac` on the deciding `SMP`. These are expected (they are the analytic observables), but they make "`P-TICK` resolves DH-7a" a definitional statement inside D2.
5. **R §8-§10 wording.** The doc does say "upper bound", "timing fingerprinting" and "does not transfer". It does not overclaim historical or live meaning. It **does** over-promote the fingerprint result in two places: the §9 "minimum sufficient diagnostic set" slot and the §8.4 necessity table (H-1). It also mis-states the mechanism (M-3) and labels a HAR+PUB tier "public-only" (L-1).
6. **"Minimum set `{P-TICK}`" and "not necessary".** These are arithmetically correct for the stated information-theoretic definition (confirmed against the summary and by the brute-force minimality test). They are **not** justified as instrumentation guidance: `{P-TICK}` yields 0 sound definite labels for `Q-OWNER`/`Q-SUBJ`/`Q-ATTR` (`T-PUB/ON` row of R §8.5 is already 0 with *all* public atoms). "Transition-active / pending-slot not necessary" is contradicted, at the sound-attribution level, by R §8.5/§8.6 itself (`Q-SUBJ` needs `V-PEND` + `V-EDGE` + `ID-ON`; any definite `Q-OWNER` needs `V-EDGE`).

## 2. Findings

Counts: **Critical 0 · High 2 · Medium 6 · Low 6.**

### High

**H-1 (High). The fingerprint-derived set fills the prompt §9 "minimum sufficient diagnostic set" slot and drives live-facing rules, although it supports no sound attribution.**
- *Evidence.* R §9 row 1 labels base + `{P-TICK}` (union base + `{P-FRM, P-TICK}`) as the "Minimum sufficient diagnostic set". S §8.6 (last paragraph) defines the prompt §9 set as `recommended` for `Q-TUPLE`. S §6.3 C1 makes a live question `UNDIAGNOSABLE` only when "the question's minimal-set requirement (§8.6) is not met". S §10 item 1 says live atoms are "informed by the §8.6 `recommended` set". R §8.4 answers the prompt §8 necessity questions only with fingerprint-derived values (`NOT_NECESSARY_IN_D2`). Against that, R §8.5 shows 0 definite labels under public-only `T-PUB/ON`, and §1 above shows the fingerprint result is closed-world determinism. Prompt §9 asks for "the smallest instrumentation footprint that can *actually distinguish* the target hypotheses". Consequences: C1 would never fire for a capture of only `{P-TICK}`, because C1 is keyed to a set that is never short of `V-PEND`/`V-EDGE`. The correlator still fails closed (it returns `AMBIGUOUS`/`UNAVAILABLE`), so no wrong verdict follows, but C1 is ineffective as written and the owner decision input points at the wrong set. Codex architecture finding 2 raised the same point (rated Critical; recalibrated to High because the correlator independently prevents a wrong definite verdict).
- *Recommended fix.* (a) In R §9, make the prompt §9 "minimum sufficient diagnostic set" the **sound-attribution bundle** (base + `ID-ON` + `V-PEND` + `V-EDGE` + the public atoms the correlator reads), with its coverage limits (M-2). Re-label the fingerprint row as "D2 model separability (closed-world; a necessary-condition lower bound only)". (b) In R §8.4, add a second answer column, "required by the sound correlator", next to the information-theoretic one. (c) In S §6.3 C1 and S §8.6, key "required observable" to the correlator's own requirements (for example `Q-SUBJ` needs `V-PEND`, `V-EDGE`, `ID-ON`; `Q-ATTR` needs `P-TC`, and `V-EDGE` for attribution), not to §8.6 minimal sets. (d) In S §10 item 1, reference the sound bundle. State plainly that the five non-base atoms were not ablated, as R §9 already does.

**H-2 (High). R3 has an unobservable poll-to-edge window, so a foreign slot write can produce a wrong *definite* attribution in a live run (the DH-6a case).**
- *Evidence.* S §6.2 R3 attributes a true `AE` edge to the slot binding of the **most recent visible `pd` read**. Its preconditions check only harness calls and `"U"` reads inside the interval. `correlate.mjs:170` implements exactly this. In 7.124.2 the consumer clears the slot (`setRequestTransition(false)`, V:105009) before `transitionView` raises the active flag (V:107122). A slot object written by a non-harness writer after the last `CAM`/`SMP` read and consumed in the next tick is therefore never seen by any read, so no `"U"` binding ever appears. R3 then assigns the consumed transition to the stale harness token, and R4/R5 can emit a wrong definite `Q-ATTR`, `Q-OWNER` (`OWN`/`IN_FLIGHT`) or `Q-SUBJ`. S R2's statement that an unbound later read "is evidence of a foreign slot writer and makes slot ownership `AMBIGUOUS`" overstates coverage. D2 cannot exercise this (no foreign writer), so the offline `wrong = 0` result is silent on it. R §8.6/§10.2 present `V-PEND` + `V-EDGE` + `ID-ON` as giving "sound, identity-bearing attribution", which holds only under a no-unobserved-writer assumption. Codex architecture finding 1 (rated Critical); recalibrated to High because no live run is authorized and R does list DH-6a as outside D2, but the normative spec rule is unsound for the hypothesis class it is meant to detect.
- *Recommended fix.* (a) Add an explicit R3 precondition and assumption: "no unobserved slot writer between the last visible read and the edge". State that VB-1/VB-3 cannot verify it in 7.124.2, because no read-only atomic consumption witness exists. (b) Either report R3-derived attributions as `INFERRED_ASSUMING_NO_FOREIGN_SLOT_WRITER` (never a definite verdict for DH-6a-sensitive questions), or make them `AMBIGUOUS` with reason `UNOBSERVED_SLOT_WINDOW` unless a future, separately authorized instrumentation gives a consumption witness. (c) Add a hand-built unit pair (normal consumption vs foreign-overwrite-then-consume with identical projections) that documents the gap. (d) Qualify R §8.6/§10.2 "sound" as "sound within D2". Record the open-world soundness of R3 as a verification gate before any live diagnostic.

### Medium

**M-1 (Medium). R §8.5 per-cell numbers are mislabelled.** The bullet "each remaining `Q-OWNER`/`Q-SUBJ` ambiguity … By cell: CL-primary 2,786 / 3,240; CL-tail 3,567 / 3,780; OP-primary 11,802 / 14,112; OP-tail 17,570 / 19,656" lists **definite** counts (sum 35,725). The ambiguous counts are 454 / 213 / 2,310 / 2,086 (sum 5,063; verified from the summary and by recomputation). *Fix:* relabel as "definite / relevant", or give the ambiguous counts.

**M-2 (Medium). The sound-attribution tier covers 3 of 13 questions, and its residual is exactly DH-1, but R does not say so.** The correlator evaluates only `Q-OWNER`, `Q-SUBJ` and `Q-ATTR` (`CORRELATOR_QUESTIONS`). The 5,063 `T-VB/ON` ambiguities are all ground-truth `ACTIVE0`, which is the pre-motion hypothesis DH-1 (the C6-type shape). So the sound VB bundle leaves 12.4 % of D2 relevant schedules, all in the DH-1 sub-case, unresolved. Meanwhile R §10.1 lists public-only "can establish" items (DH-7a tick count, DH-7b latency, DH-1/DH-3 value-match candidates) that no sound procedure evaluated. *Fix:* state the 3/13 coverage in R §8.5/§9/§10. Map the residual explicitly to DH-1 (`ACTIVE0`, R5). Mark the §10.1 "can establish" list as analytic (§5), not measured.

**M-3 (Medium). R §8.2 "Why", interpretation limit 11 and README attribute the result to the frame index `f`, but the ablation shows `f` is not required for label separability.** See §1 item 3. Without `f` (and even without `cl`/`xc`), `T-PUB` has 0 mixed `Q-TUPLE` blocks in all four cells; `f` only drives trace *uniqueness*. Some separability is definitional (`Q-DH7A` ≡ `TCK` absence, `Q-ACTIVE` ≡ `ac`). *Fix:* reword to say that "in D2's deterministic, jitter-free, two-request, no-foreign-writer universe, a per-frame public stream reconstitutes the timeline, so event order determines every label; `f` adds trace uniqueness only". Add the `f`-ablation numbers (or an equivalent ablation in the prototype, as Codex code finding 3 recommends). Note the definitional couplings.

**M-4 (Medium). `applyVbGuard` fails open on missing metadata.** Reproduced: `applyVbGuard(['V-PEND','V-ACT','V-EDGE'], {vg:1, vb:{}})` enables all three; `applyVbGuard(['V-EDGE'], {vb:{}})` (no `vg`) enables `V-EDGE`. Only an explicit `0` disables a row, and `vg` defaults to 1. S §6.3 C6 requires the guard to fail closed, and R §10.2 cites "offline tests (VB-0 and VB-1 failure cases)" as coverage. The function is not on the offline experiment path, so no result is affected. Codex code finding 2, rated High; recalibrated to Medium because it is reference code only. *Fix:* require `vg === 1` and an explicit `1` for each needed VB row; treat absent or malformed values as unavailable. Add tests for missing, partial and malformed `vg`/`vb`.

**M-5 (Medium). The schema validator is not total, and the correlator can crash on malformed input.** Reproduced: `validateEvent({f:0,k:'SMP'},{mode:'live'})` → `[]` (no per-kind required fields); a bare `AE` → `[]`; `pd:{p:0,b:1}` → `[]`; `k:'toString'` → `[]` offline (prototype-chain lookup through `in`; in live mode it reaches `KIND_CLASS[k].includes` on a function). `correlate([{FIT without pd}], {atoms:['V-PEND']})` throws `Cannot read properties of undefined (reading 'p')` instead of returning `UNDIAGNOSABLE`. `LiveTraceRecorder` does not call the validator. Offline results are unaffected, because `project.mjs` emits well-formed events by construction, but the README's "schema validation of every full-projection event" gate is weaker than it reads. Codex code finding 1, rated High; recalibrated to Medium for the same reason as M-4. *Fix:* add per-kind required and forbidden fields (both modes), the slot invariant `p=0 ⇒ no b/ch`, `Object.hasOwn` lookups, and `META`/`END` validators. Validate in `LiveTraceRecorder.append` before mutating state. Have `correlate` return `UNDIAGNOSABLE(MALFORMED)` rather than throw. Add negative tests.

**M-6 (Medium). VB-3's positive-control presence check conflicts with `META` being the first, immutable record.** R §6 VB-3 counts "no-fire within a positive-control window" as absent. S §6.1.3/§6.5 require `META.vb` (per-row presence) in the first record of an immutable trace. A behavioural result is not known at `META` time, and running the control before `META` mutates Viewer state without a specified quiescence step. This is not covered by S Appendix A (whose C-3 concerned byte accounting). Codex architecture finding 3, rated Critical; recalibrated to Medium because it is a design-level gap in an unauthorized live path with a straightforward fix. *Fix:* record structural presence in `META`, record behavioural validation (positive-control result, effective atom set) in `END` or the manifest, and require a preflight → quiescent → capture order. A failed preflight prevents capture.

### Low

**L-1 (Low). "Public-only" is HAR+PUB.** The R §8.4/§10.1 headline and the README "public-only `T-PUB/OFF`" include the base HAR atoms (`H-CALL`, `H-T4`, frame index). R §10.1's heading already says "PUB + HAR". *Fix:* say "public + harness-tagged" wherever the 40,788 figure is quoted.

**L-2 (Low). Correlator reason-code distribution is not persisted.** R §8.5's "each remaining ambiguity has reason `ACTIVE_WITHOUT_VISIBLE_STEP`" is true (reviewer recomputation), but `diag-summary.json` stores only `ambiguous/definite/unavailable/wrong`. *Fix:* persist per-reason counts (bounded enum) so the claim is checkable from outputs.

**L-3 (Low). A test asserts less than its comment claims.** `pipeline.diag-test.mjs` lines 154-156 ("the sound correlator never claims a definite label it cannot support") only assert that the projection is non-empty. *Fix:* run `correlate` on both pair members under `T-VB/ON` and assert no definite label differs from ground truth (or delete the comment).

**L-4 (Low; implementation-plan requirement). Live session lifecycle is unspecified.** The never-removed `TC` listener, `AE` listener and rAF sampler have no owner, teardown, abort path or post-overflow stop rule (Codex architecture finding 4, rated High; recalibrated because live is unauthorized and this belongs to an implementation plan). *Fix:* record as a requirement for any future live-diagnostic plan.

**L-5 (Low; implementation-plan requirement). Token-to-procedure-step binding.** `r` is call order only, so an extra or retried fit silently renumbers C6/N2/C8 (Codex architecture finding 5, rated High). *Fix:* a harness operation enum bound in `META`, recorded as a plan requirement.

**L-6 (Low). Offline output pair is not atomic as a unit, and observer effect is unbudgeted.** `writeOutputs` renames each file atomically, but a crash between renames can leave a summary without its companion (Codex architecture finding 6, rated Medium). All gate failures occur before any write, so the README's "nothing is written" holds for exit 2. Separately, the per-frame `CAM` classing/hash cost in a live run is unbudgeted (Codex architecture finding 7, rated High): a calibration gate for any live plan, not a defect of this offline package. *Fix:* write a manifest last (or stage the directory), and record an observer-effect budget as a live verification gate.

## 3. Areas reviewed with no finding

- **Research fidelity and hypothesis completeness:** R §3 covers every prompt §5.1 item (pre-motion DH-1, gap DH-2, restore DH-3a/3b, tail DH-4, correlation DH-5, ownership DH-6a/6b, timing gaps DH-7a/b/c, product vs harness DH-8), plus DH-9/DH-10. Tensions T1-T4 are carried, and D1 is kept as governing.
- **Public / version-bound / harness / synthetic classification:** consistent across R §4, S §6.1 and `project.mjs` `ATOMS`. `r` is HAR only, and `ow`/`tg` are SYN only (tested).
- **Exact-cap / cap+1:** every offline and live cap in S §6.4 is tested at the exact cap and at cap + 1 (`bounds.diag-test.mjs`).
- **Determinism:** byte-identical rerun is enforced by a test, and outputs carry no paths or timestamps.
- **Historical vs synthetic separation:** every result section is marked synthetic. C8 unresolved, C6 `NOT_EVIDENCED`, T4 unchanged, and D=30 unsimulated are all stated, and no historical causality is claimed.
- **Partition exactness:** the fast path is cross-checked against canonical-bytes partitions for every oracle-free named configuration and for all 512 subsets on a subsample.
- **Scope:** no protected path changed (see §0).

## 4. Disposition guidance (prompt §13)

- H-1, H-2: fix within the package. Both are wording/rule changes in R/S plus one unit test; neither crosses an owner-only boundary.
- M-1 through M-6: fix (no owner boundary). M-4/M-5 are code fixes and tests in the research-local prototype. They do not change `results/` unless the summary schema is extended (L-2), in which case README/R digests must be refreshed and determinism re-verified.
- L-1 through L-6: fix or record. L-4, L-5 and the observer-effect part of L-6 belong in any future live-diagnostic implementation plan, which is **not authorized**.
- Nothing here authorizes a live diagnostic, a G2 retry, an authorization record, an attempt reset, or a commit.

## 5. Remediation (appended 2026-10-05; review text above unchanged)

Performed inside the package only (`docs/research/2026-10-05-g2-diagnostic-instrumentation*`). No `src/`, `test/`, `scripts/`, D2, evidence or handoff path was touched. No Viewer, browser, network, live run or commit. Paths: R = research, S = spec, P = prototype directory.

| Finding | Disposition | Where |
|---|---|---|
| **H-1** | **Fixed.** The prompt §9 "minimum sufficient diagnostic set" is now the sound-attribution bundle (base + `ID-ON` + `P-FRM`, `P-XS`, `P-TC`, `V-PEND`, `V-EDGE`), with its 3/13 coverage and assumption dependence stated. The fingerprint row is relabelled "D2 model separability (closed-world; a necessary-condition lower bound only)". R §8.4 has a second "required by the sound correlator" column. S §6.3 C1 is keyed to a new per-question sound-correlator requirement table (the other 10 questions are `UNDIAGNOSABLE(NO_SOUND_PROCEDURE)`), never to §8.6 minimal sets. S §8.6 separates `recommended` (separability) from the §9 set. S §10 item 1 references the sound bundle | R §8 preamble, §8.3, §8.4, §9, §10; S §6.3 C1, §8.6, §10 |
| **H-2** | **Fixed (conservative).** The correlator takes `slotWindow`, default **`OPEN`** (fail-closed): the consumed token is never inferred, and every dependent output is `AMBIGUOUS(UNOBSERVED_SLOT_WINDOW)`. `ASSUME_NO_UNOBSERVED_WRITER` keeps the old R3, and each definite label that relied on it carries `assumption: NO_UNOBSERVED_WRITER`. S R2 "U" coverage is qualified as partial. S R3 states the V:105009 → V:107122 window and makes its open-world soundness a verification gate. A hand-built unit pair (normal vs foreign overwrite-then-consume; byte-identical `T-VB/ON` projections) documents the gap. The summary has a fourth run `T-VB/ON@OPEN`. **0 wrong labels in all four runs.** A `codex-advisor` pass (medium, request `20261005-112036-26029-10294`) on the fix found three related windows that no read covers. All three were re-verified against the code and fixed the same way: `INIT` needs a capture-start `CAM` (`NO_CAPTURE_BASELINE`); a restore without its own read is not credited for a later change (`UNREAD_WRITER`); C3 `TRUE_EDGE_EMPTY_SLOT` is a contradiction only in assumption mode, and is DH-6a evidence under `OPEN` | P `correlate.mjs`, `correlate.diag-test.mjs`, `run-diagnostic.mjs`; S §6.2 R2/R3 + pseudo-code, §6.3 C1/C3, §8.9, §9, §10 item 1a; R §5 note, §5.3, §6 VB-3, §7, §8.5, §8.6, §10.2, §11 |
| **M-1** | **Fixed.** The ambiguous counts are now 454 / 213 / 2,310 / 2,086 (= 5,063). The definite counts 2,786 / 3,567 / 11,802 / 17,570 (= 35,725) are labelled as definite | R §8.5; P README |
| **M-2** | **Fixed.** 3/13 coverage is stated in R §8.5, §8.6, §9 and §11 and in S §6.3 C1 and §9. The residual 5,063 is mapped to DH-1 `ACTIVE0`, with the reviewer-recomputed owners. The R §10.1 "can establish" list is marked analytic, not measured | R §8.5, §8.6, §9, §10.1, §11; S §6.3, §9 |
| **M-3** | **Fixed.** The mechanism is reworded: timeline reconstruction in a deterministic, jitter-free, two-request universe, where `f` adds uniqueness only. The definitional couplings (`Q-DH7A` ≡ `TCK` absence, `Q-ACTIVE` ≡ `ac`) are named. A prototype `f`-ablation test asserts CL-primary `T-PUB/OFF` `Q-TUPLE` blocks/mixed of 3,240/0, 1,968/0 without `f`, and 1,898/0 without `f`, `cl` and `xc`. The interpretation limit was rewritten | R §8.2; P `pipeline.diag-test.mjs`, `run-diagnostic.mjs` `INTERPRETATION_LIMITS`, README; S §9 item 6 |
| **M-4** | **Fixed.** `applyVbGuard` fails closed: it requires `vg === 1`, `vb[row] === 1` (own property) and, for VB-3, `pc["VB-3"] === 1`. Absent, partial or malformed metadata disables the atom. A test covers missing, partial and malformed `vg`/`vb`/`pc`, arrays, prototype-chain rows and non-array atoms | P `correlate.mjs`, `correlate.diag-test.mjs`; S §6.3 C6; R §10.2 |
| **M-5** | **Fixed.** `validateEvent` is total: own-property kind and field lookups (`toString` rejected), per-kind required fields (bare `SMP`/`AE` rejected), slot invariants (`p=0` ⇒ no `b`; `p=1` ⇒ exactly one of `b`/`ch`; `nw` only on `FIT` `pd`), and cross-field rules. `validateMeta`/`validateEnd` were added. `LiveTraceRecorder` validates `META` (the run does not start otherwise) and validates each event before mutating state, counting rejections in a new `END.iv`. `correlate` validates schema plus atom and ID-axis consistency first, and returns `UNDIAGNOSABLE(MALFORMED)` instead of throwing (the `FIT`-without-`pd` crash is reproduced and fixed). New spec case C8. Negative tests were added | P `schema.mjs`, `bounds.mjs`, `correlate.mjs`, `bounds.diag-test.mjs`, `correlate.diag-test.mjs`; S §6.1.2, §6.1.3, §6.2, §6.3 C8 |
| **M-6** | **Fixed.** `META.vb` is structural. The new `META.pc` holds the VB-3 preflight positive-control result, and it is known at `META` time because S §6.1.3 now requires the order structural checks → preflight positive control → quiescence (the run does not start without it) → `META` → capture. A failed control disables `V-EDGE` (C6). The guard and the `META` validator implement it, with tests | S §6.1.3, §6.3 C6; R §6 VB-3; P `schema.mjs`, `correlate.mjs`, tests |
| L-1 | **Fixed.** "Public-only" became "public + harness-tagged" wherever the 40,788 figure or the `T-PUB` tier is quoted | R §8.2, §8.4, §10.1, §10.2; S §8.4, §8.10, §9; P README |
| L-2 | **Fixed.** `correlator.*.*.*` now persists `reasons{code:count}` (bounded enum, checked; the counts sum to ambiguous + unavailable, asserted by a test) and `definiteAssuming`. The summary was `schemaVersion: 2` at this point (superseded: it is now `schemaVersion: 3`, see the schema-v3 correction section) | P `run-diagnostic.mjs`, `pipeline.diag-test.mjs`; S §7.4 |
| L-3 | **Fixed.** The pipeline test now runs `correlate` on both pair members under `T-VB/ON` in both slot modes, and asserts that no definite label differs from ground truth | P `pipeline.diag-test.mjs` |
| L-4 | **Documented** as an implementation-plan requirement (listener and sampler ownership, teardown, abort and post-overflow stop) for any future live-diagnostic plan, which is not authorized | this table |
| L-5 | **Documented** as an implementation-plan requirement (a harness operation enum bound in `META`) | this table |
| L-6 | **Fixed (unit atomicity)**: `writeOutputs` writes into a sibling staging directory and renames it onto the absent or empty target, with a test. **Documented**: the per-frame `CAM` observer-effect budget is a calibration gate for any live plan | P `run-diagnostic.mjs`, `pipeline.diag-test.mjs`; S §7.4 |

**Re-verification after remediation.**

| Check | Result |
|---|---|
| Two CLI runs into fresh empty directories | `diff -r` identical, and both equal to `results/` |
| `results/diag-summary.json` | 137,502 B, SHA-256 `445e298b0473d6eeb5b7be92315ca698f5baba491872cc7649f2a21a0c84a8e9`, `outputDigestSha256` `cff5cd6dc8585bfd0a483c0e1b36282ca8c39924c484816e694e84772a17cdda` |
| `results/diag-witnesses.json` | 109 B, SHA-256 = `companionDigestSha256` `83548e8b37e49ea980e8d1444c970b86b636677480770b76ab0606ddbeaff0d3` (changed only by the then-current witnesses `schemaVersion: 2`, which remains 2) |
| Spec SHA-256 (recorded as `thisSpec.observed`) | `28cc7551ebace97efdaa8975e2ce68d23af3ee6f7a2d4e522c2926eeeaa2e1a9` |
| `node --test docs/research/2026-10-05-g2-diagnostic-instrumentation/*.diag-test.mjs` | **43/43 pass** (was 35) |
| D2 tests (`*.d2-test.mjs`) | 55/55 pass |
| `npm run test:offline` | 5,155 tests / 5,154 pass / 0 fail / 1 todo |
| D2 output digest | `e1d1b815…bb06` verified by the input pins; D2 tree untouched |
| Correlator `wrong` | 0 in all four runs × 4 cells × 3 questions |
| Separability results (R §8.2–§8.4) | unchanged (40,788/40,788; minimal sets, distributions and necessity values identical) |

**Correlator after remediation** (sum over cells, definite / ambiguous / unavailable): `T-VB/ON` (assumption) `Q-OWNER` 35,725 / 5,063 / 0 (33,117 rely on the assumption), `Q-SUBJ` 35,725 / 5,063 / 0 (17,790 rely on it), `Q-ATTR` 40,788 / 0 (all rely on it). `T-VB/ON@OPEN` `Q-OWNER` 2,608 / 38,180 / 0 (all `RESTORE`), `Q-SUBJ` 17,935 / 22,853 / 0 (all `PENDING`), `Q-ATTR` 0 / 40,788. `T-PUB/ON` and `T-VB/OFF` are unchanged (3,193 `T-VB/OFF` owners, of which 585 `INIT` now carry the assumption tag).

**Not restarted:** no new full review was run. Only the changed areas were re-checked, by tests, by the Codex advisor pass above and by recomputation. Nothing here authorizes a live diagnostic, a G2 retry, an authorization record, an attempt reset or a commit. C8 stays unresolved, C6 stays `NOT_EVIDENCED`, and T4 is unchanged.

## 6. Targeted re-review (appended 2026-10-05; sections above unchanged)

**Scope.** This pass checks only the §5 remediation and the invariants it directly affects: the `slotWindow`/`OPEN` mode and its three extra windows, `applyVbGuard`, `validateEvent`/`correlate` totality, recorder validate-before-write, `META` ordering with `pc`, the C1 requirement table, and the re-framed R §8-§10 and spec wording. It is **not** a full review. No code or artifact was edited, and no commit was made.

**Independent reviewer.** `codex-review code` (medium, request `20261005-113848-45203-28512`) ran on a targeted bundle: the §5 log, S §6.1.3-§6.3, and `correlate.mjs`, `schema.mjs` and `bounds.mjs` with line numbers. Codex reported 3 High and 1 Medium. Each one was reproduced by the reviewer with a scratchpad script before adoption, and the severities were recalibrated on the §2 basis: reference code, live not authorized, no offline result affected. The reviewer added one Medium (R-M3) and four Lows from their own reading.

**Verification (reviewer-run).**

| Check | Result |
|---|---|
| `node --test docs/research/2026-10-05-g2-diagnostic-instrumentation/*.diag-test.mjs` | **43/43 pass**, 0 fail (≈122 s; includes the byte-identical full re-run against `results/`) |
| Correlator `wrong` in `results/diag-summary.json` (`schemaVersion` 2 when recorded; now 3) | **0** in every run × cell × question (4 × 4 × 3 = 48 entries; the sum is 0) |
| §5 correlator totals and per-reason counts, recomputed from the summary | All match. `T-VB/ON@OPEN` `Q-OWNER` 2,608 / 38,180 (`UNOBSERVED_SLOT_WINDOW` 35,551 + `ACTIVE_WITHOUT_VISIBLE_STEP` 2,044 + `NO_CAPTURE_BASELINE` 585); `Q-SUBJ` 17,935 / 22,853; `Q-ATTR` 0 / 40,788. `T-VB/ON` residual 5,063 = `ACTIVE_WITHOUT_VISIBLE_STEP` only. `definiteAssuming` 33,117 / 17,790 / 40,788; `T-VB/OFF` 585 |
| `git status --short` (HEAD `06980ee`) | Only the 9 untracked paths, as listed in §0. `git diff --stat HEAD` is empty, so no tracked or protected path changed |

**Findings of this pass.** Counts: **Critical 0 · High 0 · Medium 4 · Low 4.**

**R-M1 (Medium). The M-5 totality claim is still false: `validateEvent` and `correlate` throw on JSON-representable input.** *Evidence (reproduced):* `JSON.parse('{"f":0,"k":{"toString":null,"valueOf":null}}')` makes `validateEvent` throw `TypeError: Cannot convert object to primitive value` (`schema.mjs:71`, `String(ev.k)`), and `correlate([that], {atoms:[], idAxis:'ON'})` throws the same error. It does not return `UNDIAGNOSABLE(MALFORMED)`. The same happens through `cfg.mode` / `{mode}` (`schema.mjs:70`, `String(mode)`). `checkAtomConsistency` does not validate `cfg.mode`. This contradicts S §6.3 C8 ("never throws") and the schema/correlator headers. Codex rated it High; it is recalibrated to Medium, as M-5 was. *Fix:* never stringify untrusted values in error messages (use constant text or a `typeof`-based formatter). Validate `cfg.mode ∈ {offline, live}` in `checkAtomConsistency`. Wrap validation in `correlate` in a `try` that maps any exception to `MALFORMED`. Add these two inputs as negative tests.

**R-M2 (Medium). The `INIT` capture-start baseline is not tied to capture start.** *Evidence (reproduced):* `baselineAtStart` (`correlate.mjs:208`) checks only `events[0].k === 'CAM'`. A trace whose first event is a `CAM` at `f=10` returns `DEFINITE INIT` under `OPEN` (with `V-EDGE`, no assumption tag). An unobserved writer in frames 0-9 is exactly the window that `NO_CAPTURE_BASELINE` is meant to close (S §6.2 R3 "taken at capture start"). Codex rated it High; it is recalibrated to Medium because live is unauthorized and no D2 projection starts with `CAM`. *Fix:* require that the first `CAM` sit at the frame origin (`f === 0`, and in live mode `tm === 0`, matching `META.f`/`tm`), or have the recorder emit a distinct, recorder-enforced capture-start read. Otherwise return `NO_CAPTURE_BASELINE`. Add a delayed-first-`CAM` test.

**R-M3 (Medium). An unread restore with no visible change is definite `RESTORE` under `OPEN`, against the C1 table.** *Evidence (reproduced; reviewer):* `atoms ['V-EDGE','P-TC']`, ID-ON, trace `SST`, `SMP cl=5`, `RST rs=OK` (no read, no `P-FRM`), deciding `SMP cl=5`. `Q-OWNER` is `DEFINITE RESTORE` with **no** assumption tag in both modes. `correlate.mjs:227` treats an unread restore as `UNREAD_WRITER` only when `val !== prevVal`. S §6.3 C1 says `RESTORE` needs "`P-FRM` (or the assumption)". The open-world counterexample: the restore writes a different-class pose, and an unobserved writer restores the pre-restore class before the next read. That is a value-*changing* unobserved write, so the "identical-value write is invisible" limitation does not cover it. Only the changed-value case is tested (`correlate.diag-test.mjs:318-328`). Reach is narrow, because the §9 sound bundle includes `P-FRM` (every `RST` then has its own read), and no offline result is affected. *Fix:* under `OPEN`, report any `RESTORE` without the restore's own post-call read as `AMBIGUOUS(UNREAD_WRITER)` whatever the later value; in assumption mode, tag it. Add the no-change test.

**R-M4 (Medium). The M-6 preflight positive control perturbs the state being diagnosed.** *Evidence:* S §6.1.3 steps 2-3 run a harness-owned fit before capture. Quiescence checks only that the slot is empty, the transition inactive and no edge fires. Nothing restores or verifies the pre-preflight camera pose or other fit side-effects. R §7 records the historical C6 call as the **first fit of the run**, and DH-1/DH-2 (pre-motion, one-request lag) and the `INIT`/`PRIOR_TERMINAL` owner axis depend on prior fit history and the starting pose. A diagnostic that starts after a preflight fit therefore measures a different initial condition from the procedure it is meant to diagnose. Codex raised the same point (Medium); the reviewer found it independently. *Fix:* run the positive control in a disposable Viewer/session, or move the behavioural VB-3 check after capture (record it in `END` or the manifest and apply the C6 guard post hoc, which M-6's original fix text allowed). If a same-session preflight is kept, specify a reset protocol: restore the captured pre-preflight state, verify `cl`/`xc`/`dg` equality with a pre-preflight read, reach quiescence, then take the capture-start `CAM`. Record it as a live verification gate.

**R-L1 (Low). `Q-OWNER` can be definite without `V-EDGE` when no fit precedes the decision.** *Reproduced:* `['P-TC','P-FRM']` with a leading `CAM` and no `FIT` gives `DEFINITE INIT`. The C1 parenthetical ("once a fit was issued") permits this, but the table's column header ("Required for any definite label") and R §8.5 ("without `V-EDGE` it never asserts an owner") do not. G2 settles always follow a fit, so this has no practical reach. Codex rated it High; it is recalibrated to Low. *Fix:* either gate `Q-OWNER` on `edgeV` unconditionally, or align R §8.5 and the C1 header with the "once a fit was issued" scope.

**R-L2 (Low; implementation-plan requirement). No consumer enforces `END.iv > 0` or `END.overflow = 1` ⇒ `UNDIAGNOSABLE`.** `correlate` never sees `META`/`END` (they are rejected as data events), and no wrapper maps them. A rejected (dropped) event can otherwise remove the very read (`"U"` binding, edge) that keeps a label ambiguous. This is normative in S §6.3 C5/C8 but unimplemented in the reference code. *Fix:* record a `META`/`END`-aware entry point (`meta.at`/`id` → cfg, `applyVbGuard`, `iv`/`overflow`/`truncated` → whole-trace `UNDIAGNOSABLE`) as a live-plan requirement.

**R-L3 (Low). The C6 composition path is unspecified.** If a live recorder still emits `AE`/`pd` for an atom that `applyVbGuard` disabled, `checkAtomConsistency` returns `MALFORMED`, not the C6 verdict `AMBIGUOUS(VB_UNAVAILABLE:…)`. This is fail-closed (more conservative), but the spec does not say whether disabled-atom fields are stripped before correlation or never recorded. *Fix:* state that rule in S §6.3 C6 or in the live plan.

**R-L4 (Low). Wording.**
- (a) The 40,788 figure is called a "lower bound" (R §8 preamble, §9, §11) and an "upper bound" (R §8.4, §10.1). Both are right in different senses (a lower bound on live needs, an upper bound on achievable separability), but neither place says which quantity is meant.
- (b) R §8.5 says the advisor "found two further windows", while §5 and S §6.2 list three.
- (c) The `correlate.mjs:272` comment "OPEN only" is inaccurate: under ID-OFF the branch is also reached in assumption mode. This is harmless, because `Q-SUBJ` is `UNAVAILABLE` there.
- (d) The §9 row is titled "Minimum" although its five non-base atoms were not ablated. The caveat is present, but "candidate minimum (non-ablated)" would be exact.

**Remediation areas confirmed with no finding.**
- `applyVbGuard` fails closed: exact own-property `vg`/`vb`/`pc`, with arrays, prototype rows and non-array atoms all disabled.
- `LiveTraceRecorder.append` validates before any state change and counts `iv`/`rj`. `validateMeta` enforces `vb` all 0 when `vg = 0`.
- `OPEN` never infers a consumed token. Terminal, in-flight, `ACTIVE_PLUS`/`COMPLETE` and non-empty attribution are all `AMBIGUOUS`. `PENDING` rests on the deciding sample's own synchronous read.
- C3 `TRUE_EDGE_EMPTY_SLOT` is assumption-mode only and sets `foreign` under `OPEN`. The H-2 hand-built pair is present.
- R/S wording keeps the sound bundle (3/13 questions) separate from the closed-world separability lower bound. The 5,063 residual is stated as all DH-1 `ACTIVE0`. C8 is unresolved, C6 `NOT_EVIDENCED`, T4 unchanged, and the results are D2-only.

**Disposition.** R-M1 to R-M4 can be fixed within the package; no owner boundary is crossed. R-M1, R-M2 and R-M3 are small code and test changes in research-local reference code. They do not change `results/`, because no D2 projection reaches these paths: no D2 trace starts with `CAM`, and every D2 `RST` has its own read under `T-VB/ON`. The determinism test would confirm that. R-M4 is a spec change to the unauthorized live path. The R-L items can be fixed or recorded. Per the CLAUDE.md review boundary, a follow-up should re-check only these items. Nothing here authorizes a live diagnostic, a G2 retry, an authorization record, an attempt reset or a commit.

## 7. Remediation of §6 (appended 2026-10-05; sections above unchanged)

Package-only changes. No protected path, no live run, no commit, and no new full review.

| Finding | Disposition | Where |
|---|---|---|
| **R-M1** | **Fixed.** No untrusted value is stringified: constant or `typeof`-based messages, plus a total `try` wrapper in `validateEvent`. `checkAtomConsistency` validates `cfg.mode`. `correlate` wraps everything in `try`, and any exception becomes `UNDIAGNOSABLE(MALFORMED)`. Tests cover `{"f":0,"k":{"toString":null,"valueOf":null}}` for both the event and `mode`, a hostile `cfg.mode`, and a throwing Proxy trace | P `schema.mjs`, `correlate.mjs`, `correlate.diag-test.mjs`; S §6.2 pseudo-code |
| **R-M2** | **Fixed.** The INIT baseline requires the first `CAM` at `f = 0`, and in live mode also at `tm = 0`; otherwise `NO_CAPTURE_BASELINE`. Tests cover a delayed first `CAM` (f=10), the origin case, and live `tm` 0 vs 3 | P `correlate.mjs`, tests; S §6.2 R3, §6.1.3 step 3 |
| **R-M3** | **Fixed.** Under `OPEN`, any `RESTORE` without its own post-call read is `AMBIGUOUS(UNREAD_WRITER)` whatever the later value. Assumption mode tags it. A no-change test was added | P `correlate.mjs`, tests; S §6.2 R3, C1 table, pseudo-code |
| **R-M4** | **Fixed.** The VB-3 behavioural control moves **after** capture and is recorded in `END.pc`; the C6 guard is applied post hoc (`META.vg`/`vb` + `END.pc`). The new order is read-only structural checks → read-only quiescence → `META` + capture-start `CAM` at f=0/tm=0 → data → post-capture control → `END`. A same-session pre-capture control is prohibited. A disposable-Viewer alternative is allowed. Representativeness of a post-capture control is a live verification gate. `META.pc` was removed (the validator rejects it), and `END.pc` is required (recorder default `{VB-3:0}`, fail-closed). Tests were updated | S §6.1.3, §6.3 C6; R §6 VB-3, §10.2; P `schema.mjs`, `bounds.mjs`, `correlate.mjs`, `bounds.diag-test.mjs` |
| R-L1 | **Fixed (wording).** The C1 header and R §8.5 are scoped to "once a fit was issued (every G2 settle follows a fit)" | S §6.3; R §8.5 |
| R-L2 | **Fixed (spec).** A META/END-aware live entry point is recorded as a live-plan requirement (`END` absent/`truncated`, `overflow`, `iv > 0` ⇒ whole-trace `UNDIAGNOSABLE` before correlation) | S §6.3 |
| R-L3 | **Fixed (spec + code doc).** Composition rule: events and fields of a disabled atom are removed by projection before correlation, so the verdict is C6, never `MALFORMED` | S §6.3 C6; P `correlate.mjs` guard doc |
| R-L4 | **Fixed.** (a) "upper bound on live separability" vs "lower bound on live instrumentation needs" stated everywhere; (b) "three further cases"; (c) the `correlate.mjs` comment was corrected; (d) the §9 row is now "candidate minimum, non-base atoms not ablated" (also S §8.6) | R §8, §9, §10.1, §11; S §8.6, §9; P `correlate.mjs` |

**Re-verification.**

| Check | Result |
|---|---|
| Two fresh CLI runs | `diff -r` identical and equal to `results/` |
| `results/diag-summary.json` | 137,502 B, SHA-256 `8bdc0cf5b21f132a1f568947c4e449fd02b6d6e1bf8ce808172793a5b95c9946`, `outputDigestSha256` `d64d1535d91453f9124583d9e734cbd7a75fbaf1c1f1b4407a100bb2ea7332fe` (changed only through the spec hash) |
| `results/diag-witnesses.json` / companion | `83548e8b37e49ea980e8d1444c970b86b636677480770b76ab0606ddbeaff0d3` (unchanged) |
| Spec SHA-256 (superseded by the schema-v3 correction below) | `7f606269354feb4adc1d6aeef8c10c7cb351f1f05661be05eddb70cc24a76e73` |
| Diag tests | **44/44** pass |
| D2 tests | 55/55 pass |
| `npm run test:offline` | 5,155 / 5,154 / 0 fail / 1 todo |
| D2 digest `e1d1b815…bb06` | verified by pins; `git diff HEAD` empty |
| Correlator | identical to §5 (`wrong` 0 in all 48 entries; `T-VB/ON@OPEN` 2,608 / 17,935 / 0 definite) |

Nothing here authorizes a live diagnostic, retry, record, reset or commit. C8 stays unresolved, C6 stays `NOT_EVIDENCED`, and T4 is unchanged.

---

# Round 3 — Full internal review of the bounded offline correction package

- **Authority:** `docs/prompts/for-claude-g2-diagnostic-instrumentation-bounded-offline-correction-package.md` §13 (one full internal review after remediation).
- **Baseline:** `main == origin/main == 06980ee1e17b1268d4028ed9951c5f8462016cd2`; correction uncommitted.
- **Reviewer:** `codex-advisor` (medium, request `20261005-154738-86802-32433`) full review, plus a targeted `codex-advisor` re-review of the documentation fixes (see "Targeted re-review" below). Codex findings were checked against the source before being acted on. This file is a review claim only; it authorizes no live work.

## Remediations under review

| Independent finding | Remediation |
|---|---|
| H1 VB-0 not bound to the Viewer version | `pins.mjs` pins `vv === "7.124.2"` (strict string equality, one canonical form) and the viewer3D.js SHA-256 `12b9fe49…c02e` (new META field `vd`). `validateMeta` rejects `vg = 1` or any VB row `1` unless both match. `applyVbGuard` derives eligibility from `vv`/`vd` itself, requires `vg === 1`, never throws, and falls back to nothing. `vb0.diag-test.mjs` (6 tests) covers exact, 7.124.1, 7.125.x including the reproduced H1 case, missing/malformed/wrong-typed `vv`, wrong/missing `vd`, and no fallback. |
| M1 minimum not minimal | `ablation.mjs`/`ablation-worker.mjs` run the unmodified correlator on all 40,788 relevant schedules for all 2,048 configurations (9 atoms × `ID-ON`/`ID-OFF` × both slot windows; 83,533,824 evaluations; results independent of worker count). Unique minimum: base + `ID-ON` + `P-FRM`, `P-TC`, `V-PEND`, `V-EDGE`; no co-minimal set under the two-window target (ASSUME alone has `{P-XS,P-TC,V-PEND,V-EDGE,ID-ON}` as a second). Each element's removal fails the target. `P-XS` is redundant; `P-TICK`, `P-CC`, `P-CC0`, `V-ACT` change no verdict in any configuration. `ablation.diag-test.mjs` (7 tests). |
| M2 cross-record integrity | `trace-integrity.mjs` `validateTrace`/`correlateTrace` (total, runs before correlation) with 39 stable error codes; new META (`sv`,`vd`,`ec`,`q0`,`cs`, complete `cp`), data (`q`, optional `rn`) and END (`run`,`lq`,`ts`,`sd`) fields; `LiveTraceRecorder` stamps `q` and builds `sd`. VB atoms are usable only under a META that passes VB-0 and a whole-trace check that passes. `integrity.diag-test.mjs` (10 tests) has a mutation for every listed failure mode. Cap changes: `bytesPerNv` 400→406, `endBytes` 256→384 (inside the 2,048 B reserve). |
| L1 | One sentence added to spec §6.1.3: any live design must retain bounded control evidence and define representativeness or use a disposable same-build session. |
| L2 | This round is the full review. |

## Verification performed

| Check | Result |
|---|---|
| `node --test …/*.diag-test.mjs` | **67/67 pass** (was 44; +6 VB-0, +10 integrity, +7 ablation; includes a full run byte-identical to `results/`) |
| D2 tests | **55/55 pass** |
| `npm run test:offline` | **5,155 total / 5,154 pass / 0 fail / 1 todo** |
| Two fresh `run-diagnostic.mjs` runs from empty directories | exit 0; byte-identical to each other and to retained `results/` |
| Retained digests (superseded by the schema-v3 correction below) | `outputDigestSha256` `cbde203c886cc233cae7ad806798ed77efb0dd91e6ac37f818c05cf151cce7c2`; `diag-summary.json` 197,416 B, SHA-256 `6d93283affac09bd0c3fe31e49ca9925701889fbdfe18d372ed08e9b15eb9458`; `diag-witnesses.json` SHA-256 `83548e8b37e49ea980e8d1444c970b86b636677480770b76ab0606ddbeaff0d3` (unchanged) |
| `git diff --check` | clean |
| Tracked-file diff | only `docs/handoffs/latest.md`; `src/`, `test/`, `scripts/`, D2 tree, evidence, harness untouched |

## Findings (this round)

**Found during remediation (fixed, not in the independent review):**

- **High (fixed) — ablation exposed a correlator soundness defect.** In 64 assumption-mode configurations with `V-PEND`, `V-EDGE`, `ID-ON` and no `P-TC`, a false edge left the transition active and its terminal write was credited as in-flight (first witness `S-00001`: emitted `IN_FLIGHT`/`ACTIVE_PLUS`, truth `OWN`/`COMPLETE`; `[V-PEND,V-EDGE,ID-ON]` had 12,223 wrong `Q-OWNER`). None of the four named runs was affected (all contain `P-TC`). Fix (`correlate.mjs`): after a false edge without `P-TC`, clear the active token and mark `hiddenTerminal`, making `Q-OWNER`/`Q-SUBJ` `AMBIGUOUS(OBSERVABLE_ABSENT:P-TC)`. The fix can only convert definite labels to ambiguous ones. Result: `wrong` = 0 in all 2,048 configurations; named-run verdicts and the minimum unchanged. Regression assertion added to `ablation.diag-test.mjs`.

**Codex full-review findings (checked against source):**

| Sev | Finding | Disposition |
|---|---|---|
| High | Normative spec §6.2 pseudocode and research §8.5 still described the pre-fix, unsound behavior | **Fixed.** Pseudocode now sets `hiddenTerminal` and lists the new ambiguity rules; research §8.5 and spec §8.6 state the fix as applied |
| Medium | Result sizes/hashes in README and research stale | **Fixed** after final regeneration (values above) |
| Medium | D2 minimal-set/separability text implied upper/lower bounds on live instrumentation | **Fixed.** Reworded in spec, research, README and `INTERPRETATION_LIMITS`: closed-world D2 results that imply no live bound |
| Low | Unqualified "3 of 13" wording | **Fixed.** Wording is "3 of 13 questions have a sound procedure; the minimum answers 2 of 13 under `OPEN`, 3 of 13 under the assumption mode" |

Codex found **no defect** in: VB-0 gating; whole-trace integrity; ablation exhaustiveness/minimality computation; `hiddenTerminal` soundness; the `P-XS` minimum claim; historical C8/C6/G2/T4 statements.

**Reviewer checklist (this round):** VB-0 gating, version normalization, digest binding, minimum-set proof, ablation completeness, 13-question coverage, META/data/END integrity, stream commitment, fail-closed partial traces, envelope binding, correlator soundness, deterministic outputs, no historical overclaim, owner-boundary compliance. **Critical 0, High 0, Medium 0, Low 2 remaining, all in scope-dispositioned form:**

- **Low (accepted, documented):** the post-capture VB-3 positive control is gated but not representative evidence (L1). Remains a live-design gate; no offline action.
- **Low (accepted, documented):** `vg = 0` with the pinned `vv`/`vd` is permitted (the guard just disables `V-*`), `vd` accepts `"ABSENT"`, and there is no separate `av` map (availability is derived from `at`, VB-0, `vb`, `pc`). These are design choices recorded in spec §6.1.3, not defects.

## Targeted re-review

Codex `codex-advisor` targeted re-review (request `20261005-182816-44117-3521`) of the documentation fixes: pseudocode parity with `correlate.mjs` — none; stale status/hash text — none (hashes re-verified against `results/`); **Medium** three remaining "lower/upper bound on live …" phrases (spec §10 items 6 and 1 and `INTERPRETATION_LIMITS`) and **Low** coverage wording not leading with OPEN 2 / ASSUME 3 in README, research and spec. **Both fixed** (wording only; no logic change): remaining phrases now read "closed-world D2 result that implies no live bound", and every coverage statement leads with "under `OPEN` 2 of 13; under the assumption mode 3 of 13; only 3 of 13 have a sound procedure". Because the spec and `run-diagnostic.mjs` text feed the output digest, `results/` were regenerated once more (two runs byte-identical) and all quoted hashes updated; a `grep` for `lower bound|upper bound` over the package now returns nothing. No further Codex pass was run on this wording-only change. Final state: **0 Critical / 0 High / 0 Medium unresolved; 2 Low documented.**

## Schema-v3 bounded correction (2026-10-05, package-only)

Trigger: the independent re-review (`2026-10-05-g2-diagnostic-instrumentation-corrected-package-independent-rereview.md`: 0C/0H/1M/2L). Baseline `06980ee1e17b1268d4028ed9951c5f8462016cd2`.

| Finding | Disposition |
|---|---|
| M1 spec §7.4 said `schemaVersion: 2`, omitted `ablation`, claimed no per-subset table | **Fixed.** §7.4 declares summary `schemaVersion: 3`, lists `ablation`, adds the normative "`ablation` carrier" definition (bitmap, `outcomes`, `outcomeIndex`, aggregates, cardinalities, ordering, boundedness) and replaces the false sentence with the bounded-retention rule. Witnesses stay v2. README aligned; no runtime change |
| L1 Appendix A cited the 400 B NV cap | **Fixed.** Row marked as corrected to the current normative 406 B; no 406 B behavior changed |
| L2 VB-3 positive control not representative | **Unchanged.** Still not historical proof, not established as representative, a future live-design gate |

Regenerated (spec hash is bound): two fresh runs byte-identical and equal to `results/`. Only `inputHashes.thisSpec.observed` and `outputDigestSha256` changed. `outputDigestSha256` `fe42e53e0e12c19fd9c321b7b038998c1fbe09b42ab1f5c556de71d247a52c35`; `diag-summary.json` 197,416 B, SHA-256 `410c637d79e4d78801dcbb98fa75b3f4ce0c56e9cdc12ce1b684b1c8ccb21d47`; `diag-witnesses.json` 109 B, `83548e8b37e49ea980e8d1444c970b86b636677480770b76ab0606ddbeaff0d3` (unchanged); spec SHA-256 `385993ba1b5bdb30687ab3235c01f651bca5be2690e5ccdfa6fecd9ed7be594e`.

### Targeted internal re-review of the schema-v3 correction (independent opus subagent, read-only)

Result: **Critical 0 / High 0 / Medium 0 / Low 3.** All 11 prompt §10 items passed: schemaVersion 3 consistency (witnesses intentionally v2), §7.4 `ablation` carrier verified key-by-key against `analyzeAblation` and the real JSON (bitmap decoded independently: 32 satisfying masks = supersets of canonical mask 865), no stale "no per-subset table" text, boundedness, README/spec/results alignment, 406 B, hashes (`outputDigestSha256`/`companionDigestSha256` recomputed), conclusions preserved, VB-3 not strengthened, no protected-boundary change. Determinism was verified statically; the two fresh runs above are the dynamic evidence. The package is untracked, so a byte diff against HEAD is impossible; the equality of everything except `thisSpec.observed` and `outputDigestSha256` was checked against the pre-correction retained file (key-by-key JSON diff before overwrite).

| Low | Disposition |
|---|---|
| L-a §7.4 key lists not fully enumerated (`d2Conformance.rowsChecked` pre-existing omission; inner keys of `canonical.necessity[]`, `questionCoverage.*`, `aboveCanonical`) | **Deferred (non-blocking).** Any spec edit changes the spec-bound hash and would force another regeneration; to be folded into the next spec-touching round if the independent review asks |
| L-b no severity tally in this review | **Fixed** (this section) |
| L-c new test uses the package's own `decodeSatisfying` | **Accepted.** The reviewer's independent decode confirms the encoding; README determinism wording refreshed |
