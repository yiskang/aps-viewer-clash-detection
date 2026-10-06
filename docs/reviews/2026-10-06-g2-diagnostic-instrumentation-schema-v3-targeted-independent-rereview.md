# G2 Diagnostic Instrumentation Schema-v3 Correction — Targeted Independent Re-review

- **Date:** 2026-10-06
- **Repository:** `aps-viewer-clash-detection`
- **Reviewed baseline:** `main == origin/main == 06980ee1e17b1268d4028ed9951c5f8462016cd2`
- **Scope:** schema-v3 bounded correction package and directly affected contracts/results
- **Verdict:** **ready to checkpoint**
- **Findings:** **0 Critical / 0 High / 0 Medium / 3 Low**

## 1. Repository state and boundaries

Verified before this review wrote its review and handoff update:

- branch, `HEAD`, `main`, and `origin/main` all resolved to `06980ee1e17b1268d4028ed9951c5f8462016cd2`;
- committed G2 harness SHA-256 remained `cc8868cd68b9c2c3382297070289a2aa165c74249c6d82896d76bacc6c6ef09b`;
- accepted G2 procedure SHA-256 remained `d1ccfde224b8ae76fe74b06c93abc532e6df9612933cafaa045053c8e2e45a75`;
- immutable evidence and the D2 checkpoint had no tracked change;
- historical G2 remained `FAIL (row 3)`, C6 remained `NOT_EVIDENCED`, C8 remained unresolved, and real T4/C6/C8 behavior remained unchanged;
- no Viewer/browser/live G2 run, retry, new authorization record, attempt reset, runtime work, or G3 work occurred;
- nothing was committed or pushed.

The correction is confined to the uncommitted diagnostic-instrumentation research/spec/results/tests/review documentation and handoff. No change was found in the real harness, product code, accepted procedure, immutable evidence, D2 checkpoint, `src/`, `test/`, or production runtime scripts/configuration.

## 2. Findings

### Low L1 — §7.4 does not exhaustively spell out every derived inner field

The top-level summary keys are complete, and the normative `ablation` carrier defines the encodings, dimensions, cardinalities, ordering, bounds, soundness gate, and all aggregate families. It does not enumerate every inner member of several derived aggregates, including:

- `d2Conformance.rowsChecked`;
- the members of `canonical.necessity[]`;
- the inner coverage-record members below `questionCoverage.canonical/full`;
- the three counters below `influence.*.*.*.aboveCanonical`.

This is a documentation completeness limitation, not an evidence-integrity or decoding ambiguity. The omitted values are deterministic derived aggregates whose semantics are already defined in §8.6 and whose presence does not affect the schema-version split, per-subset decoding, cardinality bounds, soundness gate, or acceptance conclusions. A strict generated schema would benefit from their enumeration, but the current contract is sufficient for checkpointing. **Disposition: Low, non-blocking; fold into a future spec-touching round.**

### Low L2 — the retained-summary bitmap test imports the package decoder

`summary-schema.diag-test.mjs` uses `decodeSatisfying` from `ablation.mjs` for its bitmap/lattice consistency assertion. That assertion is not fully independent of the package implementation.

The risk is bounded because the same test independently checks the 256-hex shape, both 1,024-entry indexes, outcome-index ranges, lattice cardinality, canonical-mask membership, first-appearance ordering, fixed carrier dimensions, soundness, and output size. This review also decoded the bitmap with an independent implementation and confirmed exactly 32 masks, equal to the supersets of canonical mask 865. **Disposition: Low, non-blocking; an additional independent decoder unit test would strengthen the suite but is not required before checkpoint.**

### Low L3 — VB-3 positive-control representativeness remains a future live gate

The post-capture VB-3 positive control remains explicitly non-historical and is not treated as representative proof of the historical live path. Any future live design must retain bounded control evidence and prove representativeness or use a disposable same-build Viewer. **Disposition: Low, intentionally deferred verification gate; no offline correction required.**

## 3. Prior blocking Medium — closed

The prior review's schema-contract Medium is fully closed:

- `diag-summary.json` is normatively and actually `schemaVersion: 3`;
- `diag-witnesses.json` intentionally remains `schemaVersion: 2` because its format did not change;
- spec §7.4, README, research, tests, retained results, internal review, and handoff consistently record that split;
- historical references to earlier v2 summaries are explicitly contextualized and do not imply that both current files share one schema version.

No blocking Critical, High, or Medium remains.

## 4. Bounded `ablation` carrier

Specification §7.4 matches `analyzeAblation` and the retained result for the material contract:

- `satisfyingBitmapHex` is exactly 256 lowercase hex characters / 1,024 bits;
- independent decoding yields 32 satisfying masks, exactly the supersets of canonical mask 865;
- `outcomes[]` contains 46 distinct outcomes in deterministic first-appearance order and is bounded to 2,048;
- `outcomeIndex.OPEN` and `.ASSUME` each contain 1,024 valid indexes;
- the carrier records 2,048 configurations and 83,533,824 correlator evaluations;
- all aggregate families, fixed dimensions, deterministic ordering, `unsoundConfigurations: []`, and summary-size cap are present;
- no per-schedule result rows or unbounded raw traces were introduced. Schedule-dependent values are counts plus at most 40 bounded `firstWitness` schedule ids; retained witness traces remain separately capped at 16.

The stale statement that no per-subset table is retained is gone. The replacement correctly distinguishes bounded per-configuration retention from prohibited unbounded per-schedule rows/traces.

## 5. NV limit and output identity

The current normative and tested `NV` limit is **406 B** in spec §6.4, `LIVE_CAPS.bytesPerNv`, and boundary tests. The only 400 B occurrence in Appendix A is explicitly historical and says it was corrected to 406 B. It cannot reasonably be read as the current limit.

Verified retained artifacts:

| Artifact | Size | SHA-256 / digest |
|---|---:|---|
| Corrected spec | — | `385993ba1b5bdb30687ab3235c01f651bca5be2690e5ccdfa6fecd9ed7be594e` |
| `diag-summary.json` | 197,416 B | file `410c637d79e4d78801dcbb98fa75b3f4ce0c56e9cdc12ce1b684b1c8ccb21d47` |
| summary output digest | — | `fe42e53e0e12c19fd9c321b7b038998c1fbe09b42ab1f5c556de71d247a52c35` |
| `diag-witnesses.json` | 109 B | `83548e8b37e49ea980e8d1444c970b86b636677480770b76ab0606ddbeaff0d3` |

The summary's `inputHashes.thisSpec.observed` equals the corrected spec hash. Comparison against independently retained pre-correction bytes from the previous review shows exactly two changed JSON paths: `inputHashes.thisSpec.observed` and `outputDigestSha256`. No technical result changed.

## 6. Technical-result drift adjudication

No drift was found:

- VB-0 still requires exact Viewer `7.124.2`, exact pinned bundle digest, and the fail-closed guard;
- the unique two-window minimum remains `ID-ON + P-FRM + P-TC + V-PEND + V-EDGE`; `P-XS` remains redundant and no co-minimum exists;
- coverage remains OPEN 2/13, assumption mode 3/13, with only 3/13 questions having a sound procedure;
- whole-trace META/data/END integrity is unchanged;
- all 2,048 configurations retain `wrong = 0`;
- public-only sound definite owner/subject/attribution counts remain zero in both windows;
- the 5,063 residuals remain `ACTIVE_WITHOUT_VISIBLE_STEP`, all ground-truth `ACTIVE0` pre-motion;
- the pending-clear gap remains fail-closed;
- historical C8 remains unresolved, G2 remains `FAIL (row 3)`, and C6 remains `NOT_EVIDENCED`.

The schema correction changes evidence metadata binding only. It does not change runtime behavior, causal interpretation, or authorization state.

## 7. Verification reproduced

| Gate | Independent result |
|---|---|
| Diagnostic tests | **72/72 pass**, 0 fail |
| D2 tests | **55/55 pass**, 0 fail |
| Offline suite | **5,155 total / 5,154 pass / 0 fail / 1 existing todo** |
| Explicit prototype run A | exit 0; expected sizes/digests |
| Explicit prototype run B | exit 0; expected sizes/digests |
| Byte comparison | A = B = retained `results/` for both files |
| Independent bitmap decode | 32 satisfying masks; exactly canonical-mask-865 supersets |
| `git diff --check` | clean before review writes; rerun after review writes recorded in the final repository check |

The diagnostic suite itself performed a third fresh full run and verified byte identity with retained results. No Viewer or browser was launched.

## 8. Checkpoint readiness and next gate

**Checkpoint readiness: ready to checkpoint.**

The prior blocking Medium is closed. There are no blocking Critical, High, or Medium findings. The three Low items are explicitly dispositioned and do not require another correction cycle.

**Exact recommended next owner action:** authorize one scoped checkpoint commit/push of the diagnostic-instrumentation package and its directly related prompts, reviews, and handoff. Exclude the three pre-existing untracked G2 authorization-record files and unrelated historical prompt. Any future live-diagnostic design/preparation package requires separate owner authorization after that checkpoint; live execution, G2 retry, authorization issuance/reset, runtime remediation, T4/C6/C8 changes, and G3 remain unauthorized.
