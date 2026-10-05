# G2 D2-OFFLINE bounded remediation — focused internal review

- **Scope:** `docs/research/2026-10-04-g2-d2-synthetic-transition/` plus the two doc fixes below. Baseline `main == origin/main == 53ea0a74b215b4a3c7463b8fe7da4bf783b8c8fb`. Authority: `docs/prompts/for-claude-g2-d2-offline-bounded-remediation-only.md`, remediating the [independent Work review](2026-10-05-g2-d2-offline-implementation-results-independent-review.md) (0C/0H/2M/3L).
- **Method:** implementer checklist over the 13 required areas + Codex `codex-review code` (medium) on `simulate.mjs` after remediation. Internal review, not the independent re-review.
- **Classification of this review's findings:** **0 Critical / 0 High / 0 Medium / 2 Low** (Codex rated both Medium; reclassified below with reasons). No defect required a fix inside this remediation scope.

## Remediation of the Work findings

| Work finding | Fix | Verified by |
|---|---|---|
| **M1** D=30 described as "not model defects" | Characterization is now `modelValid:false`, `v5ViolationCount:36`, `invalidAmbiguousCount:12`, `excludedFromHypothesisInference:true`, `inferenceDrawn:'none'`; note: "outside the valid exhaustive model domain … model-invalid characterization results … excluded from exhaustive H2/H5 inference". README, review and handoff reworded. D=30 definitions untouched; V5 not relaxed. | test `D=30 is reported as model-invalid characterization…` |
| **M2** no M-GAP witness | `selectWitnesses` additionally keeps the lowest schedule id for every (cell, mechanism): M-GAP witnesses `W-S-00497` (CL-primary), `W-S-00728` (CL-tail), `W-S-01467` (OP-primary), `W-S-02249` (OP-tail); reasons merged on shared witnesses. Retained traces 100 → **104** (cap 154). Trace of `W-S-00497` shows fit(2) pending while camera is static at `T1*`, T4 settles on it. | test `every mechanism with a non-zero count has a retained witness trace` |
| **L1** provenance | `historicalDerived` lists only consumed inputs (U, aspect, fit-pair distance, κ anchor); A:104/C6/N2/C8 scalars moved to `retainedComparisonTargetsOnly`; synthetic list names `SYN-A`/`SYN-B` (not B:111/A:135). | test `provenance labels…` |
| **L2** vacuous dedup test | New pure helper `selectWitnesses` (a refactor of the existing inline code, no new behaviour); test injects one schedule under stale + mechanism + diagnostic reasons and asserts all survive, plus a second shared id. | test `selectWitnesses merges every reason…` |
| **L3** stale wording | Old internal-review headline and open items corrected; `inputs.mjs` comment and README now say the pins were ratified. | read-through |

## Review of the 13 required areas

1. **D=30 semantics** — correct; separate, labelled model-invalid. 2. **V5/INVALID_AMBIGUOUS reporting** — 36 / 12 recorded explicitly. 3. **Exclusion from H2/H5** — `hypotheses`, `classCounts`, `invariantResults`, `outcomeSchedule`, exit code byte-identical to the pre-remediation run (compared key by key). 4. **M-GAP coverage** — all four cells. 5. **Deterministic selection** — lowest id per key, sorted keys, stable ids; run 1 == run 2 byte-for-byte. 6. **Caps** — 104 ≤ 154 traces; 98,819 + 86,011 B well under per-output/total caps. 7. **Dedup test** — non-vacuous. 8. **Provenance** — fixed. 9. **Pin wording** — fixed; pin semantics unchanged. 10. **Count preservation** — 52,308; 4,104 / 4,788 / 18,144 / 25,272; 36. 11. **Determinism** — identical. 12. **Historical/synthetic boundary** — SYN boxes labelled; no historical-causality claim. 13. **Scope** — only D2 directory, two review docs and the handoff changed; harness SHA `cc8868cd…ef09b`, evidence, `src/`, `wwwroot/`, `test/` untouched.

## Findings of this review

| Sev | Finding | Disposition |
|---|---|---|
| Low | (Codex: Medium) `runSimulation` validates input hashes but re-opens `fixtures.json`/R1 to parse them, a theoretical read race if another process rewrites an input in between. | **Deferred, not fixed.** Pre-existing, outside the Work findings; exposure is a single-user offline research CLI reading repo files. Fixing means changing the `inputs.mjs` API (hash and parse from one buffer), which exceeds this bounded pass. Candidate for a later hardening gate. |
| Low | (Codex: Medium) per-row 128 B cap "not enforced". | **Rejected as stated.** Enforced in `machine.mjs` `row()` against `fx.caps.traceRowBytes` (throws on overflow); the reviewer only saw `simulate.mjs`. The aggregate 16 KiB limit is a hard-coded constant in `simulate.mjs` (spec §14 value). Observed max row 47 B, max trace 837 B. No boundary test exists for the row cap; deferred test-gap. |

## Accepted results unchanged

Exhaustive 52,308; cells unchanged; H2 and H5 SUPPORTED in all four cells; C6/N2 outcome E (`d_min=none`, failing pair `P_C6~L_home`); oracle CURES everywhere; no margin; historical C8 unresolved. New output digest `e1d1b815ed351e6feba3e34822ba9895e54035158e685bfbe7f628f6d10bbb06` (companion `75f0596f…`), changed only by characterization/provenance/witness content.

## Verification

D2 tests **49/49**; `npm run test:offline` **5,155 total / 5,154 pass / 0 fail / 1 todo**; two clean simulator runs byte-identical; `git diff --check` clean.
