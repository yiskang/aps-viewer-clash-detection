# G2 Diagnostic Instrumentation Corrected Package — Independent Re-review

- **Date:** 2026-10-05
- **Repository:** `aps-viewer-clash-detection`
- **Reviewed baseline:** `main == origin/main == 06980ee1e17b1268d4028ed9951c5f8462016cd2`
- **Scope:** complete corrected, uncommitted diagnostic-instrumentation package
- **Verdict:** **bounded correction still required**
- **Findings:** **0 Critical / 0 High / 1 Medium / 2 Low**

## 1. Repository state and protected boundaries

The repository and Git history were used as the source of truth. Before this review wrote its own review and handoff update:

- branch, `HEAD`, `main`, and `origin/main` all resolved to `06980ee1e17b1268d4028ed9951c5f8462016cd2`;
- the committed G2 harness SHA-256 remained `cc8868cd68b9c2c3382297070289a2aa165c74249c6d82896d76bacc6c6ef09b`;
- the accepted G2 procedure SHA-256 remained `d1ccfde224b8ae76fe74b06c93abc532e6df9612933cafaa045053c8e2e45a75`;
- the D2 checkpoint and immutable historical evidence had no tracked changes;
- the package, its prompts/reviews, and the pre-existing authorization records remained untracked; the only tracked modification was `docs/handoffs/latest.md`;
- historical G2 remained `FAIL (row 3)`, C6 remained `NOT_EVIDENCED`, C8 remained unresolved, and real T4/C6/C8 behavior remained unchanged;
- no Viewer or browser was launched, no live G2 path was run, no retry occurred, no authorization record was issued, no attempt state was reset, and no G3 work occurred.

No change was found in `src/`, `test/`, production scripts/config, the real harness, the accepted procedure, immutable evidence, or the D2 checkpoint.

## 2. Findings

### Medium M1 — the normative output schema contradicts the implemented and retained schema

**Locations:**

- `docs/research/2026-10-05-g2-diagnostic-instrumentation-spec.md` §7.4, lines 394–409;
- `docs/research/2026-10-05-g2-diagnostic-instrumentation/run-diagnostic.mjs`, summary construction;
- `docs/research/2026-10-05-g2-diagnostic-instrumentation/results/diag-summary.json`;
- `docs/research/2026-10-05-g2-diagnostic-instrumentation/README.md`, reference-output metadata.

The specification still declares `diag-summary.json` as `schemaVersion: 2`, omits the `ablation` key from the normative key list, and says no per-subset table is written. The implementation and retained output instead use `schemaVersion: 3` and contain `ablation`, including two 1,024-entry `outcomeIndex` arrays and a satisfying-subset bitmap. The README correctly explains elsewhere that schema version 3 adds ablation, but its reference-output line still labels the retained spec hash as `schemaVersion: 2`.

This is not a computational defect: the output is deterministic, bounded, and internally coherent. It is an output-contract defect. A consumer implementing the normative §7.4 schema would reject the retained summary or fail to validate its ablation payload, while the retained evidence claims conformance to that same spec.

**Minimum correction:** update §7.4 to declare summary schema version 3 and normatively describe the bounded `ablation` carrier, including the bitmap/index encodings and their cardinalities; replace the false “no per-subset table” statement with the intended bounded-retention rule; align the README. Because the spec hash is retained in `inputHashes.thisSpec.observed`, regenerate the two deterministic output files and their quoted hashes/digest, then rerun the diagnostic tests and two-run determinism comparison. No harness, product, Viewer, procedure, D2, or live change is required.

This Medium blocks a checkpoint described as a self-contained research-to-ready package.

### Low L1 — Appendix A retains the superseded 400-byte NV cap

The normative bound in specification §6.4 is correctly `406` bytes and the implementation/tests enforce it. Appendix A still says the fixed `NV` record has a `400 B` cap. This is stale review-log wording, not an operative bounds defect. It should be corrected in the same bounded documentation pass.

### Low L2 — the VB-3 positive control remains non-representative historical evidence

The package correctly treats the post-capture VB-3 control as an eligibility/sensitivity gate, not proof that every historical edge was captured or that the control action represents the failing path. This remains a future live-design gate and is non-blocking for the offline package.

## 3. Prior blocking findings — closure

### H1 VB-0 exact-build gate — closed

`validateMeta` and `applyVbGuard` independently require all of:

- exact `META.vv === "7.124.2"`;
- exact pinned decoded `viewer3D.js` SHA-256 `12b9fe49f41dc99ccec62535e5c887da915980829da2e941cfe4da3d7197c02e` in `META.vd`;
- `vg === 1`, consistent `vb` rows, and the required positive-control result.

Missing, malformed, wrong-typed, wrong-version, or wrong-digest inputs fail closed. The reproduced `7.125.0` case is rejected. No fallback enables a version-bound atom. The prior High is closed.

### M1 minimum-bundle proof — closed

The corrected ablation evaluates all 2,048 configurations (1,024 masks × two slot-window modes) over all 40,788 relevant schedules: 83,533,824 correlator evaluations. The declared objective is the full-configuration definite counts for `Q-OWNER`, `Q-SUBJ`, and `Q-ATTR` in both windows with zero wrong labels.

The unique minimum and only minimal two-window set is:

`ID-ON + P-FRM + P-TC + V-PEND + V-EDGE`

Exactly 32 satisfying supersets exist. Removing any minimum element misses the target. `P-XS` appears in no two-window minimum and changes no verdict above the minimum; it is an assumption-only substitute for `P-FRM`, not a two-window co-minimum. `P-TICK`, `P-CC`, `P-CC0`, and `V-ACT` have zero verdict influence. The prior Medium is closed.

### M2 whole-trace integrity — closed

`validateTrace` validates one `META`/data/`END` envelope before `correlateTrace` invokes attribution. It binds run/session identity, schema and Viewer version, capabilities, monotonically contiguous sequence, declared counts/times/sample totals, complete cap declarations, and a canonical stream digest. Duplicate/missing/misordered records, truncation, overflow, data after `END`, mixed version/schema, count mismatches, and digest mismatches fail closed. The 39 stable error codes are covered by mutation tests. Partial or invalid traces cannot become positive evidence. The prior Medium is closed.

## 4. Correlator and historical interpretation

- **P-TC correction:** accepted. The previously unsound 64 configurations now become conservative ambiguity after a false edge without `P-TC`; the fix cannot manufacture a definite label.
- **All configurations:** every one of the 2,048 configurations has `wrong = 0`; the four named baseline runs remain unchanged.
- **Question coverage:** the minimum answers 2 of 13 under `OPEN` (`Q-OWNER`, `Q-SUBJ`) and 3 of 13 under the no-unobserved-writer assumption (adds `Q-ATTR`). Only those three questions have a sound procedure; only `Q-ATTR` is complete in assumption mode.
- **Public-only:** all 128 public subsets in both windows produce zero sound definite owner, subject, and attribution labels. Closed-world D2 schedule separability is not live attribution evidence.
- **Residual ambiguity:** 5,063 schedules remain ambiguous; all are `ACTIVE_WITHOUT_VISIBLE_STEP`, all ground-truth `ACTIVE0` pre-motion cases. No other ambiguity class is hidden in that count.
- **Pending-clear gap:** the interval between pending-slot clear and transition-active edge remains fail-closed; no consumed token or owner is inferred through it.
- **Historical C8:** unresolved. Version-bound pending/edge observations add sound information for the pinned Viewer build but do not resolve the safe read-only consumption/pre-motion gap or retroactively change historical G2 evidence.

The corrected offline results justify preparing a future live-diagnostic **design** after the bounded schema/documentation correction and checkpoint. They do not authorize a live diagnostic or establish that a live run would resolve C8.

## 5. Verification reproduced

| Gate | Independent result |
|---|---|
| Diagnostic tests | **67/67 pass**, 0 fail |
| D2 tests | **55/55 pass**, 0 fail |
| Offline suite | **5,155 total / 5,154 pass / 0 fail / 1 existing todo** |
| Fresh prototype runs | two runs, exit 0, byte-identical to each other and retained `results/` |
| Diagnostic output digest | `cbde203c886cc233cae7ad806798ed77efb0dd91e6ac37f818c05cf151cce7c2` |
| Summary | `197,416 B`; SHA-256 `6d93283affac09bd0c3fe31e49ca9925701889fbdfe18d372ed08e9b15eb9458` |
| Witnesses | `109 B`; SHA-256 `83548e8b37e49ea980e8d1444c970b86b636677480770b76ab0606ddbeaff0d3` |
| D2 output digest field | `e1d1b815ed351e6feba3e34822ba9895e54035158e685bfbe7f628f6d10bbb06` |
| `git diff --check` | clean before review writes; rerun after review writes recorded below |

The two explicit prototype runs each reported 52,308 schedules, 852,312 conformance rows, zero retained witnesses/traces, and identical file sizes/digests. The diagnostic test suite independently performed another full run and compared it byte-for-byte with retained results.

## 6. Internal-review process

The internal full review and targeted follow-up were substantive, and the missing final broad pass is not independently blocking. However, the grep-based wording check did not detect the §7.4 schema-version/key-list contradiction or the stale Appendix A cap. This independent re-review supplies that broader check. The process is acceptable; its claimed `0 Critical / 0 High / 0 Medium` final state is not accepted until M1 is corrected and re-reviewed.

## 7. Checkpoint readiness and next gate

**Checkpoint readiness:** **bounded correction still required**.

The prior High and both prior Medium findings are closed. No Critical or High remains. The single new Medium is limited to the normative output schema/documentation and deterministic evidence binding; it requires no new offline research and no architecture, harness, product, Core, Adapter, procedure, Viewer, runtime, or live change.

**Exact recommended next bounded owner action:** authorize one package-only correction to reconcile specification §7.4/Appendix A and README with the implemented schema version 3 and bounded ablation payload, regenerate the spec-bound deterministic results/hashes, and perform a targeted independent re-review.

Checkpoint commit/push, live Viewer diagnostics, G2 retry, new/reset authorization records, runtime remediation, real T4/C6/C8 changes, and G3 remain unauthorized.
