# Prototype notes: fail-closed readings and spec findings (core: schema, envelope, verdict, controls, fixtures)

Offline research prototype only. No Viewer, browser, live harness, network, authorization record, attempt or evidence is touched. Every fixture is synthetic, and every authorization/attempt/harness/package digest in `fixtures/shared/` is a labelled placeholder.

## Files (core)

| File | Role |
|---|---|
| `trace-schema.mjs` | data-record / `META` / `END` validators from the two contract appendices; sequence rules I1–I7 and the Part 2 §12.6 step-2/3 codes |
| `envelope.mjs` | committed D2 canonicalizer (loaded from digest-verified bytes), JSONL / trace-array forms, `END.sd`, the offline reference `Recorder` (Part 1 §8.6 lifecycle and caps), `validateTraceV2` |
| `verdict.mjs` | Part 1 §8.3 projection, committed C6 guard + committed correlator (both unchanged), `PRE_MOTION`, `GAP`, target rules T0–T6, run rules V1–V5, independent `auditResult` |
| `controls.mjs` | PC-1…PC-5, RG, the negative-control matrix runner, `CONTROL_EFFECTS` |
| `fixtures-gen.mjs` | deterministic script DSL over the recorder; writes `../fixtures/` (`--write`, `--check`) |
| `run-preparation.mjs` | `node run-preparation.mjs --out <empty-dir>`: fixtures check, evaluation, gates, `results.json`, `golden.json`, `gates.json`, `MANIFEST.json`, a fixture copy and `SHA256SUMS` |
| `*.prep-test.mjs` | research-local `node:test` suites (not picked up by `scripts/run-tests.mjs`) |

Run the tests with `PREP_SCRATCH=<scratch dir> node --test *.prep-test.mjs` (the determinism test writes two runs under `$PREP_SCRATCH`, else the OS temp directory, and deletes them).

## Fail-closed readings chosen where the specs are silent or ambiguous

Several readings below were later made normative in the specs (Part 1 contract version 4, Part 2 contract version 3; see "Spec findings"). Where that happened the reading names the spec section that now governs it.

1. **Decision records** (now normative: Part 1 I4, Appendix `t4DecisionRules`). `te = 1` iff `d ∈ {settled, timeout}`; a comparison decision must immediately follow its sample's `PS`, carry that sample's `n` and `ss`, and be the only comparison decision for that sample; a timeout carries `n` = the settle's sample count and `ss` = its last sample.
2. **`settled` on sample 1** is rejected for every role (`I4-T4-DECISION`), not only for projected `G`/`S` settles (committed C3 sees only those). Now normative (Part 1 I4).
3. **Subject terminal decision with `n ≥ 1` must carry `fr = 1`** (mirrors the committed C3 `FR` rule).
4. **Between an `RQ` pair** only `RQ`, `TE` and `TC` are admitted (Part 1 lists FS/T4/PS/RS/C8 as forbidden; NV, CT, TZ and CE are also rejected).
5. **Token rules.** `RQ pre` tokens must be the 1-based call order; every token binding on a visible read must name a token bound at an adjacent CP02 earlier; an interleaved `RQ post` may not carry its own token as binding. Violations are `I1-RQ-PAIR`.
6. **`slotDelta` (I7) offline.** Token→token: `none` iff equal, else `replace`; token↔`"U"`: `replace`; `"U"`→`"U"`: `none` or `replace` (object identity is not recoverable offline).
7. **Frame/time** (now normative: Part 2 §12.6 step 3). Every non-`FS` record's `f` equals the latest `FS` frame, and `f`/`tm` are non-decreasing; violations are `FRAME-ORDER` / `TIME-ORDER` (formerly mapped to `DATA-INVALID`).
8. **Settle association** (now normative: Part 1 I4). A `T4 start` must name a token whose `RQ post` precedes it (`SETTLE-ROLES`).
9. **C8.** A `C8` must follow its settle's terminal decision; at most one `subject` and one `superseded` `C8` per trace.
10. **CT placement.** A target trace carries at most one `CT`, only `PC-3`, only in the control window; a control trace's control window is exactly `TZ targetEnd, CT(ci = META.rl), TZ final`.
11. **Binding** (now normative: Part 2 §12.6 "Result fields"). `OBSERVED_VIEWER_NOT_BOUND` / `OBSERVED_BUNDLE_NOT_BOUND` / `BINDING-MISMATCH:<field>` make `validateTraceV2.ok = false` (§12.6 step 4) and are reported as `bindingErrors`; `envelopeOk` covers steps 1–3. NC-1a/NC-2a now expect `envelopeOk = true`, `ok = false`. Either way the run is `INVALID`.
12. **PC-3 drives the C6 guard only when re-derived** (now normative: Part 2 §11.2 "C6 guard input", §12.7). For the target trace the guard receives `pc["VB-3"] = 1` only if `END.pc["VB-3"] = 1` **and** the evaluator re-derives PC-3 `PASSED` from the control window. A recorded `PASSED` without the pattern disables `V-EDGE`. For a control trace (`END.pc["VB-3"] = 0` by contract) the guard input for that control's own correlator expectation is the control's own re-derived fit → rise → visible step → fall → adjacent `TC` pattern; PC-5 now checks that pattern too.
13. **Positive controls** are `PASSED` only if the trace is present and intact, `META.ei = "LOW"`, its `CT` records `PASSED` with `fu ≤ fb`, **and** the §11.2 pattern (and, for PC-2/PC-5, the correlator expectation) is re-derived. Absent → `NOT_RUN`; non-intact → `FAILED`. PC-1's B1 is taken as the `CT.fb` budget.
14. **PC-4 NV reproduction is LIVE-only** (now normative: Part 2 §11.2 "PC-4 scope"). It needs the frozen C8 frustum oracle, which no offline artifact provides; the prototype never runs or claims it. Offline PC-4 results carry `scope: "STRUCTURAL_ONLY"` and `nvReproduction` (`NOT_RETAINED` when no bound `NV` is retained, where the live rule reduces to the structural pattern; `NOT_EVALUATED_OFFLINE` otherwise, with outcome `FAILED`, reason `NV_REPRODUCTION_LIVE_ONLY`). `results.json` repeats this in `pc4Scope` and per-row `pc4Offline`. In targets, a retained `NV` gives C8 numeric status `NOT_EVALUATED_OFFLINE`; C8 never affects a target verdict.
15. **TE payload.** `payloadActive ≠ edgeValue` (Part 1 "C3 contradiction") is not visible to the committed correlator after projection; it is raised before correlation as `CONTRADICTION:PAYLOAD_MISMATCH` → `INVALID`.
16. **Reasons** (now normative: Part 2 §14.3, §13.5, where the list is called `reasons`). The verdict is the first matching rule; each target also lists `allReasons` (every applicable `INCONCLUSIVE` rule in rule order), so NC-15's `EDGE_INIT_UNKNOWN` is visible although T1 matches first. NC-15 now expects `EDGE_INIT_UNKNOWN` in that list; the rule order is unchanged.
17. **V5 safety net.** If the primaries are not all `SUPPORTED`, or `ei ≠ LOW`, or `cg ≠ 0`, the run is `INCONCLUSIVE`, never `SUPPORTED`.
18. **Abnormal terminalization.** Besides V2's `TZ final` cause, a `TZ targetEnd` with `tzCause ≠ normal` also makes the run `INVALID` (`TARGET_END_TZ_CAUSE_NOT_NORMAL`).
19. **Inconsistent inputs.** A class-a stop with `attemptConsumed = true` → `INVALID`; an invalid target plan or no primary target at evaluation → `INVALID`; `SC-C03`/`SC-C04` set `verdictWithheld`; a `DEFINITE` `FOREIGN`/`ACTIVE0`/`"-"` is never evidence.
20. **JSONL.** A non-canonical, CR-containing or unparsable line is a parse failure (integrity failure); raw bytes are never normalized.
21. **Exact control patterns.** PC-3 requires exactly one adjacent fit in the control window that writes a fresh object bound to its own token, then exactly one rise and one fall after it, at most one `TC`, no `"U"` read and only `RQ/TE/TC/FS/PS/CT` kinds. PC-4 requires two distinct fresh fits in the order fit₁ → S (r = fit₁) → subject C8 → fit₂ → P (r = fit₂) → superseded C8. PC-5 requires exactly one restore.
22. **RS pairing** (now normative: Part 1 CP10/CP11, Part 2 §12.6 step 2). Every `RS pre` is immediately followed by its `RS post` (`seq + 1`) and vice versa (`RS-PAIR`, now a Part 1 contract code).
23. **Independent audit.** `auditResult(res, scenario)` re-checks every `SUPPORTED`/`REJECTED` outcome (intact bound traces, all PCs passed, RG, LOW boundary, `cg = 0`, `DEFINITE`, no unauthorized assumption, no owner label under pre-motion) and, through `auditRaw`, re-derives from the raw records (independently of the validator and control code) that every RQ/RS post has its pre, the target starts at the capture-start `FS`, every trace is LOW-bounded, the PC-3 window is exact and PC-4 uses two distinct fits. `run-preparation` fails its gate on any violation.

## Fixture simplifications (synthetic, documented)

- `t4-sample-index-above-bound` (NC-17 variant) forces the recorder's sample counter to 1,802 instead of writing 1,801 real samples; the recorder rejects the append at the bound and sets `overflow`. `envelope.prep-test.mjs` separately checks that 1,801 is accepted and 1,802 rejected.
- `overflow` (NC-8) simulates a data-event-cap rejection by setting the recorder's overflow counters.
- `CAPACITY` (NC-21b) is tested on an in-memory projection, not a fixture file (a fixture would need > 8,192 projected events).
- `rq-interleaved`: the nested call writes the request; the outer call's post read sees the nested call's bound object (binding refused for the outer token, projected `nw = 0`).
- NC-13 (every proper prefix) is checked exhaustively in the tests and as a run gate, not as fixture files.
- `golden.json` keeps full projections for the Part 1 golden list and per-record byte counts plus digests for every fixture.

## Spec findings (reported by the prototype builders; remediated in the specs)

The builders did not edit the specs. A follow-up pass fixed every finding below in the spec files (Part 1 §12.1 log, contract version 4; Part 2 coordination item 11, contract version 3) and made the prototype, tests and fixtures consistent. Every committed conclusion and every pre-existing scenario verdict and reason is unchanged; three NC-6 fixtures were added (`integrity-frame-order`, `integrity-time-order`, `integrity-rs-post-without-pre`).

| # | Resolution |
|---|---|
| 1 | Collision rule restated: exactly `{f, k, tm}` shared with the same meaning (Part 2 §12.4, Appendix (i) `wireKeyCollisionRule.allowedShared`); the gate and test read that list from the contract |
| 2 | Guard input defined per trace role (Part 2 §11.2, §12.7, Appendix (ii) `c6GuardInput`); target input stricter, control input from the control's own re-derived pattern |
| 3 | Rule order kept; NC-15 expects `EDGE_INIT_UNKNOWN` in the ordered `reasons` list (Part 2 §11.3, §14.3) |
| 4 | Validator result fields named; NC-1a/NC-2a expect `envelopeOk = true`, `ok = false` (Part 2 §12.6) |
| 5 | `END.pc` vs the re-derived PC-3: the guard requires both (Part 2 §12.7) |
| 6 | I4 made exact (Part 1 I4, Appendix `t4DecisionRules`) |
| 7 | `FRAME-ORDER`, `TIME-ORDER` added; `TZ-STATUS-MISMATCH` covers a missing `TZ final` (Part 2 §12.6) |
| 8 | PC-4 NV reproduction is LIVE-only; offline checks the structural pattern (Part 2 §11.2 "PC-4 scope"); PC-1's B1 stays an implementation-plan value |
| 9 | `RS-PAIR` is a Part 1 contract code |
| ancillary (a) | per-step `requiresFutureOwnerAuthorization` boolean (Part 2 §16, Appendix (iii)); `runbook-validator.mjs` requires it and the implicit-marker warning is gone |
| ancillary (b) | per-capture-point `failClosed` (Part 1 Appendix); `capability-matrix.mjs` resolves every reference against the contract (integrity codes incl. the explicit 39-code `committedList`, reason vocabulary, stop conditions) instead of a fixed stop-condition list |
| ancillary (c) | single-document files are exactly the canonical bytes, no trailing newline (Part 2 §12.2 rule 6, §13.5, §13.6, Appendix (v)) |

Original findings, as reported:

1. **Wire-key collision rule (Part 2 §12.4, Appendix (i) `wireKeyCollisionRule`).** "No P1 data wire key equals a META or END key" is false for the common keys `k`, `f`, `tm`. The prototype asserts the collision set is exactly `{f, k, tm}`.
2. **Control traces vs the C6 guard (Part 2 §11.2, §12.5).** Control traces must carry `END.pc = {"VB-3": 0}`, but PC-2 and PC-5 require correlator outputs that need `V-EDGE`; applying the committed C6 guard verbatim to a control trace disables `V-EDGE`, so both controls could never pass. The prototype correlates control traces with the VB-3 behavioural row taken from the control's own verified rise/fall/TC pattern.
3. **NC-15 / T1 precedence (Part 2 §11.3 vs §14.3).** NC-15 expects reason `EDGE_INIT_UNKNOWN`, but T1 (non-`DEFINITE` status) matches first, so the reported first reason is the correlator's (`OBSERVABLE_ABSENT:V-EDGE`, `ACTIVE_STATE_UNOBSERVED`). The verdict is the same.
4. **NC-1a/NC-2a "valid envelope" vs §12.6 step 4.** §12.6 puts the observed-pin check inside `validateTraceV2` ("any failure makes the whole trace unusable"), while NC-1a/NC-2a call the trace valid. Resolved by reporting `envelopeOk` and `bindingErrors` separately (finding 11).
5. **PC-3 recorded vs derived outcome (§11.2, §12.5).** `END.pc` is defined from the recorded `CT` outcome only; nothing requires the evaluator to re-derive the PC-3 pattern before the guard trusts it (resolved fail-closed, reading 12).
6. **I4 under-specification.** Whether `te` must accompany every `settled`/`timeout`, whether a `T4 start` token must be issued earlier, and where a timeout decision may sit relative to the next settle are not stated (readings 1, 8).
7. **Unspecified codes.** No integrity code exists for frame/time ordering or for a record whose `f` is not the current frame (mapped to `DATA-INVALID`), and `END.ds` has no rule when there is no `TZ final` (the recorder writes `2`; the trace is invalid anyway via `I6-TZ-WINDOW`).
8. **PC-4 NV reproduction** depends on the frozen C8 frustum oracle, which no offline artifact provides; and PC-1's B1 is an implementation-plan value (taken from `CT.fb`).
9. **No integrity code for `RS` pairing.** Part 1 CP10/CP11 make an `RS post` without its adjacent `RS pre` malformed, but neither Part 1 nor Part 2 lists a code for it; the prototype adds `RS-PAIR`.

## Internal review

Codex advisor (`codex-advisor medium`, request `20261006-103710-69960-11437`, read-only) reproduced three positive-classification defects, all fixed with regression tests (`verdict.prep-test.mjs` "regression (Codex review)"):

| Finding | Fix |
|---|---|
| An `RS post` without its `RS pre` passed integrity and could yield a DEFINITE `RESTORE` → `SUPPORTED` | `RS-PAIR` adjacency check in `checkSequence` (reading 22) and a raw re-check in `auditRaw` |
| PC-3 accepted extra fits in the control window and still enabled `V-EDGE` | exact PC-3 pattern (reading 21); raw re-check |
| PC-4 accepted one fit reused for both S and P settles | exact two-fit ordered PC-4 pattern (reading 21); raw re-check |

## Remediation of the package internal review (Part 1 contract v5, Part 2 contract v4)

Source: `docs/reviews/2026-10-06-g2-live-diagnostic-preparation-internal-review.md` (0 Critical, 2 High, 9 Medium, 10 Low). Every committed conclusion is unchanged (`OPEN` 2/13, assumption 3/13, 3/13 sound, `NV` 406 B, 2,048 configurations with 0 wrong labels, 5,063, gap fail-closed, C8 unresolved, C6 `NOT_EVIDENCED`, T4 unchanged); the committed correlator and C6 guard are still consumed unchanged.

| Finding | Prototype change | Test / fixture |
|---|---|---|
| H-1 plan not bound | `targetPlanDigest`; `evaluateScenario` requires `sha256(canonical plan) = binding.targetPlanSha256 = META.tq` of every present trace (raw `META`, so it also fires when the binding check already failed) → `TARGET_PLAN_DIGEST_MISMATCH`; `auditInputs` re-checks it for any positive outcome | `verdict.prep-test.mjs` "H-1" (label swap in `valid-rejected-init` → `INVALID`, also with a re-pointed binding); fixture `target-plan-digest-mismatch` |
| H-2 finalization order | `runbook-validator.mjs` `checkFinalization`: one creating step per path, raw files before `rawFrozen`, derived/terminal only in the publish step after `determinismChecked`, manifest before `runRootFrozen`, commit record last | `runbook.prep-test.mjs` "H-2", "M-6", "M-4, M-7" |
| M-1 gates fail open | `ncRerunOk`/`ledgerOk` pass only when exactly `true` (`*_UNKNOWN` / `*_MISMATCH`) | "M-1"; fixtures `gate-nc-rerun-absent`, `gate-ledger-mistyped` |
| M-2 ambiguity wording | no rule change; `noAmbiguousPositive` gate is no longer circular (re-derives the primary-target rule from each positive output) | "M-2" |
| M-3 `CLEAR_WITHOUT_EDGE` / reappearance | `tokenReappearance` (T0c, `SC-C04`, `verdictWithheld`, `withheldBy`), `clearedWithoutEdge` (T1c); `auditRaw` adds `RAW_TOKEN_REAPPEARED` | "M-3"; fixture `token-reappears-after-clear` (the correlator alone still says DEFINITE `PENDING`) |
| M-5 ledger closure | `manifest-builder.mjs` lists `raw/hash-ledger.jsonl` without `ledgerSeq` (`LEDGER_HAS_LEDGERSEQ` otherwise); `WITHHELD` accepted as `terminalVerdict` (L-6) | `manifest.prep-test.mjs` |
| M-8 plan schema / conformance | `validatePlanSteps` (strict schema from Appendix (ii) `targetPlanSchema`), `derivePlanBounds` (derived `maxRefreshHz`, raw/projected worst cases), `planConformance` → `TARGET_PLAN_NONCONFORMANT` | "M-8"; fixture `target-plan-nonconformant-missing-c8` |
| L-1 run linkage | control `META.run` must be `<target run>-pcN` → `CONTROL_RUN_NOT_LINKED:<PC>`; `auditInputs` | "L-1, L-9" |
| L-9 weak audit | `auditResult` now also runs `auditInputs` and flags a withheld positive; `evaluateScenario` passes `metaTemplates[role]` to `validateTraceV2` when supplied | "L-1, L-9" |

Further readings fixed by this pass:

24. **Plan conformance and nested calls.** A top-level `RQ` pair is a plan `fit`; a pair nested inside another call is an open-world call (I1), not a step. A settle's `reqToken` may be the latest top-level fit's token or a call nested in it (`rq-interleaved` stays conformant). A foreign top-level wrapped `fitToView`/restore is indistinguishable from a deviation and fails closed.
25. **Timed-out settles** have no `C8`; the plan's `c8` step is then expected absent (NC-16 stays `INCONCLUSIVE`, not `INVALID`).
26. **Withheld verdicts.** `verdictWithheld = true` (from a class-c `SC-C03`/`SC-C04` stop or a `TOKEN_REAPPEARED` contradiction) means the run/target verdicts are informational only; the audit treats a positive withheld outcome as a violation.

Fixture changes (all synthetic): plans are now structured (`steps` arrays) and one plan per executed shape exists (`a` G/S pair, `b` restore probe, `c` init probe, `d` G/S + superseded P, `e` historical P6, `f` subject probe with a trailing witness fit), each with its own binding and control traces. `valid-rejected-init` moved to plan `c`, `gap-clear-without-edge` to `f`, the superseded-C8 fixtures to `d`, `plan-p6-two-g-settles` to `e`. `rq-threw-unrepresentable` now makes the **subject** fit the throwing one (instead of an extra fit outside the plan); its verdict and reason are unchanged. New fixtures: `target-plan-digest-mismatch`, `target-plan-nonconformant-missing-c8`, `token-reappears-after-clear`, `gate-nc-rerun-absent`, `gate-ledger-mistyped` (70 scenarios; every pre-existing scenario keeps its expected verdict and reasons).

Not changed (documented): the handoff (`docs/handoffs/latest.md`) and `results/` are outside this remediation pass; the owner/orchestrator generates `results/` with `node prototype/run-preparation.mjs --out results` and records its digests. Synthetic fixtures do not carry frozen `META` templates (the live pipeline reads them from `preflight/meta-template.*.json`); the template check is exercised by a unit test.

Targeted Codex re-review (`codex-advisor medium`, request `20261006-113157-35625-8087`) of this pass: 5 further findings, all verified and fixed. `ledgerOk` is now a pre-publication raw-hash-chain gate only (reason `HASH_LEDGER_INCONSISTENT`), and manifest consistency is checked after publication by runbook step P5.10 (failure ⇒ commit record `INVALID`). Unknown trace roles are `INVALID` (`UNKNOWN_TRACE_ROLE`), and the plan-digest check covers every supplied trace. A generic `SC-C04` stop applies T0c to every target. V5 lists T0c/T1c. `noAmbiguousPositive` also runs `auditInputs`. Tests: 113/113. Deterministic digests (two fresh runs, `diff -r` identical, 187 files): `results.json` `cb51b655d89ab339d77beca17dc5118ae4196db2bab49ecc22899c09d7824797`, `SHA256SUMS` `f9987fb09f032fae146716f9d509e1af671cc69dfb8a8a97e680b48a516d2d2c`.

## SC-C03 closeout (M1 correction; `closeout.mjs`, `closeout.prep-test.mjs`)

What: Part 2 §13.7 / Appendix (viii) as an offline model. When scratch analyses A and B differ, A and B stay byte-identical to the compared bytes (never rewritten or annotated), no `derived/*` and no `TERMINAL-VERDICT.json` are published, and a separate deterministic `SC-C03-CLOSEOUT.json` (the terminal carrier) records the `WITHHELD` decision. `closeout.mjs` exports `analysisTable`/`bundleDigest`/`compareAnalyses`, `buildCloseout` (refuses identical analyses, exceeded bounds and bad identity; never truncates), `validateCloseout` (canonical-form, fixed-field and consistency checks plus the P5.10 recompute from retained A/B), `simulateFinalization` (in-memory P5.01-P5.12 with an event log and adversarial hooks) and `syntheticScC03Demo` (used by `run-preparation.mjs`, gate `scC03Closeout`, outputs `sc-c03/SC-C03-CLOSEOUT.json` and `sc-c03/closeout-run.json`). Nothing here writes a file; scratch directories, the run root and the attempts directory are in-memory objects.

Invariants: (1) event order `writeA, writeB, hash, compare, closeout|publish, manifest, finalizeTerminalMetadata, finalHashes, freeze, commit`; (2) the closeout is a pure function of the two compared file tables, the run identity and the raw input digests (no timestamp, absolute path, evaluator output or file content beyond hashes/lengths); (3) scratch is sealed (write throws) from the moment it is hashed, and the run root throws `FreezeViolation` after the freeze; (4) the ledger's last line is the terminal carrier; (5) P5.10 (inside `finalHashes`) checks manifest/ledger/files/carrier and, on the SC-C03 path, recomputes the closeout from the retained A/B and requires byte equality, otherwise the commit record is `INVALID` and the journal `FAILED`; (6) `manifest-builder.mjs` enforces `terminalCarrierPath` (exactly one carrier; closeout carrier requires `WITHHELD`, no `derived/`, no `TERMINAL-VERDICT.json`) and `runbook-validator.mjs` enforces the P5.07 `scC03Branch` and the P5.08 `branchWrites` (closeout written only by the publish step, once, never after a freeze).

Tests: `closeout.prep-test.mjs` groups A (identical: ordinary path, no closeout), B (mismatch: A/B unchanged, closeout hashes recomputed independently with node:crypto, promotion blocked, manifest/commit record, event order, no write after freeze), C (post-comparison mutation of A or B by flip/add/remove/rename, and tampering with closeout/manifest/ledger/file set, all fail closed `INVALID`), D (3x determinism, no timestamp/absolute path), E (worst-case bounds 128x128-byte paths, refusals), F (schema/contract, SC-C03 over SC-C04 precedence); plus mutation tests in `runbook.prep-test.mjs` and `manifest.prep-test.mjs`. `verdict.mjs` is unchanged: its SC-C03 behavior remains the scenario-level offline effect model; the 70 fixtures' verdicts are unchanged.

Modelling choices (not spec text): a ledger line's `prevSha256` hashes the previous canonical line without its LF; on a P5.10 failure the freeze and commit still run (commit record `INVALID`); a bound violation or a malformed analysis aborts before the manifest (`SC-B07`, no commit record in the model); `committedAt` is `null` in the simulated commit record.
