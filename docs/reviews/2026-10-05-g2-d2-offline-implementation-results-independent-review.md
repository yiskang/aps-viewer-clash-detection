# G2 D2-OFFLINE Implementation and Results — Independent Review

**Verdict:** requires bounded simulator/evidence correction before checkpoint commit/push.

**Findings:** 0 Critical / 0 High / 2 Medium / 3 Low.

The exhaustive D2-OFFLINE result is reproducible and supports the narrow conclusion that stale/early observations are mechanically possible under the accepted synthetic model. It does not establish historical C8 causality, a Viewer defect, a T4 change, or retry readiness. Two evidence-contract defects prevent checkpointing the current package: the D=30 characterization incorrectly dismisses model-invalid results, and the retained witness set contains no M-GAP trace despite reporting that mechanism.

## Verified repository state and scope

- Repository: `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`.
- Branch/HEAD: `main` at `53ea0a74b215b4a3c7463b8fe7da4bf783b8c8fb`; `origin/main` matches.
- Harness SHA-256: `cc8868cd68b9c2c3382297070289a2aa165c74249c6d82896d76bacc6c6ef09b`.
- Accepted procedure SHA-256: `d1ccfde224b8ae76fe74b06c93abc532e6df9612933cafaa045053c8e2e45a75` (unchanged).
- R1 SHA-256: `4204e2d36c9053db8e6601952bc79b27bbf903998637b81bde6bc8dcf2e42148`; immutable evidence under `docs/research/evidence/g2-live-20261004-75a3ccb9/` has no working-tree change.
- Historical state remains G2 `FAIL (row 3)`, C6 `NOT_EVIDENCED`, C8 unresolved, and T4 unchanged. No Viewer/browser/live run, retry, authorization record, or attempt reset occurred.
- Simulator code, fixtures, tests, README, and results are confined to `docs/research/2026-10-04-g2-d2-synthetic-transition/`. Outside that directory, the D2 work adds its internal review/prompt and updates the handoff. No `src/`, `wwwroot/`, `test/acceptance/`, package, harness, procedure, or historical-evidence file changed.

The codebase-memory graph was used for structural discovery of the simulator and harness references, followed by direct source and output inspection. Coverage reported no recorded issue for every relied-on implementation path.

## Findings

### Medium M1 — D=30 model-invalid results are incorrectly described as “not model defects”

**Locations:** `simulate.mjs` lines 116–127; generated `d2-summary.json` `characterization.note`; README “Interpretations made”; current handoff.

All 36 D=30 schedules violate V5 and 12 classify `INVALID_AMBIGUOUS`. The accepted spec defines V5 failures and `INVALID_AMBIGUOUS` as model defects. Section 7.5 separately says characterization never enters an exhaustive cell, and §12.1 makes process exit 2 depend on a cell being C1-invalid. Therefore keeping these 36 schedules outside the four cell outcomes and retaining exit 0 for the valid exhaustive run is consistent. Calling the violations “not model defects,” however, is not.

The D=30 result means the accepted L=0 numeric-sanity assumption does not hold for the compounding-smoothstep D=30 model. Those schedules are model-invalid characterization data and cannot support stale/owned mechanism conclusions. This does not invalidate the 52,308 exhaustive schedules or their four A outcomes.

**Minimum correction:** retain the separate characterization and current cell/exit isolation, but change generated evidence, README, tests, and handoff to label the 36 cases as model-invalid characterization. State that 12 classifications are invalid/ambiguous and that no inference is drawn from the D=30 branch. Do not relax V5 or reinterpret `INVALID_AMBIGUOUS` without a spec change.

### Medium M2 — no retained witness demonstrates M-GAP

**Locations:** `simulate.mjs` lines 130–151; generated summary/witness files.

The result reports M-GAP counts of 537 / 357 / 3,691 / 2,821 across the four cells, but independent replay of every retained exhaustive witness found M-PRE, M-RST, and M-TAIL only. The retained set has zero M-GAP traces. Selection is keyed by stale class, not mechanism, so the lowest `STALE_PRIOR_TERMINAL` witnesses do not necessarily carry M-GAP.

This does not change mechanism counts or H2/H5, but it prevents a reviewer from auditing every claimed mechanism from retained evidence and conflicts with the implementation authorization’s “do not silently drop required representative witnesses.” The 100 retained traces leave 54 slots under the cap.

**Minimum correction:** deterministically retain at least one trace for each reported mechanism (especially M-GAP), merge reasons on shared witnesses, regenerate both outputs/digests, and add a test that proves every non-zero mechanism count has a retained representative.

### Low L1 — provenance labels blur retained inputs and synthetic proxies

`provenance.historicalDerived` lists “A:104 box,” although the geometry computation uses retained U corners and fit-pair distance plus synthetic unit boxes; it does not consume the retained A:104 box as a geometry operand. `provenance.synthetic` names “B:111 geometry” and “A:135 geometry,” while spec §9.1 explicitly defines `SYN-A`/`SYN-B` and says they are not the historical B:111/A:135 boxes.

The surrounding README and `synthetic:true` fields prevent a historical-causality claim, so this is not a result defect. Before checkpoint, relabel the consumed retained inputs precisely and call the boxes `SYN-A`/`SYN-B`; retain historical dbIds only as comparison targets/context.

### Low L2 — the diagnostic-reason dedup regression test is not non-vacuous

The implementation correctly appends a new reason to an existing witness id, but the test at `sim.d2-test.mjs` lines 265–270 only checks that every real-run witness has a non-empty `reasons[]`. The real run has no diagnostic failures and no multi-reason witness, so the test does not exercise the fixed collision/dedup path.

Add a focused injected/isolated test that makes one witness receive two reasons and asserts both survive. The inspected implementation is correct; this is a verification gap, not a current data-loss finding.

### Low L3 — documentation classification/comments are stale

The internal review headline says “0 Critical / 2 High-or-Medium” while its table preserves one High and three Medium fixed findings. `inputs.mjs` still says the fixture digest is null until pinned although it is pinned. These are process/documentation defects only; the substantive dispositions and runtime behavior remain inspectable.

## Implementation and result verification

### Scope and test isolation

- **Implementation scope:** accepted. All executable D2 files are research-local. No production, harness, procedure, or immutable evidence change exists.
- **Test isolation:** accepted. `scripts/run-tests.mjs` discovers only filenames ending `.test.mjs`; `*.d2-test.mjs` is excluded. The documented direct Node command is deterministic and sufficient. No `package.json` or npm-script change is needed.
- **npm-script rejection:** accepted. Adding a script would cross the authorized directory boundary without improving reproducibility.

### Schedule cardinality

Independent arithmetic matches the implementation and spec:

- Valid `(D,L)` pairs: six primary and seven tail.
- CL per pair: `36 + 72 + 576 = 684`; therefore `6×684 = 4,104` primary and `7×684 = 4,788` tail.
- OP uses `(3D+15)×(12+96)`. Primary span sum is 168, giving `18,144`; tail span sum is 234, giving `25,272`.
- Total: `4,104 + 4,788 + 18,144 + 25,272 = 52,308`.
- The 36 D=30 schedules have `CW-*` ids and are absent from exhaustive ids/counts.

Enumeration order, sentinels, ids, duplicate refusal, and count comparison are deterministic and fail closed.

### State machine, T4, and oracle

- **State-machine fidelity:** accepted for the exhaustive domain. Active/pending separation, one last-writer-wins pending slot, tick-gated consumption, zero-motion step 0, compounding blend, completion, restore branches, SAME/NEXT dispatch, H+ δ=0, next-frame δ=1, ownership tags, settle activation, tail sensitivity, THROW abort plus shadow completion all match the frozen spec.
- **T4 fidelity:** accepted. `phi` materializes 32 numeric entries; every entry is compared elementwise at absolute `1e-9`; each settle has its own previous sample; the first equal adjacent pair wins; there is one modeled H sample per frame and exactly 64 samples maximum. No symbolic shortcut is used.
- **Ownership oracle:** accepted. Request tokens and camera-owner tags are carried by separate state transitions; delivery snapshots ownership independently of the sample/destination classifier. The mutation test changes the oracle result without changing the camera sample.

### Classifier, hypotheses, and mechanisms

- **Classifier/outcomes:** accepted for the 52,308 exhaustive schedules. The first-match class decision is exhaustive; class totals close to each cell count; V0–V5/V7, `INVALID_AMBIGUOUS`, timeout, and prerequisite counts are zero. All four cells are A and exit 0 is correct.
- **H2:** mechanically SUPPORTED in every synthetic cell: stale counts are 1,071 / 3,757 / 7,399 / 19,607.
- **H5:** mechanically SUPPORTED in every cell: non-M-GAP stale witness counts are 534 / 3,400 / 3,708 / 16,786.
- **Mechanism counts:** M-PRE, M-GAP, M-RST, and M-TAIL all occur by explicit state predicates, not post-hoc output matching. Retention is incomplete only for M-GAP (M2).
- **Oracle result:** every exhaustive stale schedule is `CURES` for both e=0 and e=1 in this synthetic model. That is not evidence that a public Viewer completion signal exists.

### Tail and D=30

- **Tail branch:** accepted. `L={1,2}`, `tau=1e-10`, valid-pair filtering, non-terminal ownership, V5 tail checks, cell accounting, and retained M-TAIL traces are correct.
- **D=30:** correctly enumerated and isolated from exhaustive cells, but model-invalid under V5 as described in M1. Its 24 stale labels and 12 invalid classifications are characterization observations only and cannot support H2/H5.

### C6/N2 geometry

- **Geometry implementation:** accepted. It uses the specified orthographic xy model, aspect `676/380`, `SYN-A`/`SYN-B`, exact retained distance `263.8571494974672`, `dy={0,38}`, κ variation, offsets, and four home multipliers. The retained distance is checked by strict numeric equality against R1. RET-U reproduces approximately −0.1.
- **Control outcome:** E is correct. `d_min = none`; the required `P_C6~L_home` pair does not satisfy the exploratory `3×max(width)` rule at or above the retained distance. This failure is geometry/variation driven and independent of scheduling.
- **Interpretation:** the synthetic control remains non-discriminating for a required pair. The `3×` rule, candidate separators, and `d_min` remain observations only; no C6 margin or threshold is selected.

### Pins, hashes, caps, and determinism

- **Spec pin:** ratified — observed and expected `635d183415270eb842b47522e21a704bf3cdf5a9b7d0685d6e104f427499c574`.
- **Fixture pin:** ratified — observed and expected `6ee6e9fa94266fcdd26875f60b280f16dc4343909baa03795180997a41f978e0`.
- Both pins implement §15’s accepted fail-closed contract. The spec digest is stored outside the spec, so it is not self-referential. All four mandatory expected digests are validated before enumeration; absent, malformed, unreadable, or mismatched input fails with exit 2.
- **Caps:** 100 traces; summary 93,972 bytes; witnesses 82,385 bytes; total 176,357 bytes. Per-file, summary, total, geometry, trace-count, trace-row/trace-size checks are enforced without truncation. M2 is a representation gap, not a cap pressure issue.
- **Determinism:** two fresh runs were byte-identical to each other and to the retained result files. `outputDigestSha256` is `48bb1f81f5af97129b2098068f17582101d510edb572f0fefc726b5ce34ce82b`; companion digest is `b0f3d40ad8abc2c380cccb2f0bb9f2c1edc640334da34630d655a3ac9a32d9ce`. Schedule and witness ids are stable; outputs contain no path, timestamp, or random input.

## Internal-review fix verification

1. **V2/V4 corruption acceptance:** fixed and tested with frame mismatch and illegal token histories.
2. **Oracle rows omitted from traces:** fixed and tested at completion frame + e.
3. **`expected:{}` disabled hashes:** fixed; all four 64-hex pins are mandatory.
4. **Witness reason loss:** implementation fixed, but its claimed regression test is incomplete (Low L2).

The internal review’s classification headline is imprecise, but the table retains severity and disposition. A rewrite is not required; correct the headline during the bounded remediation.

## Reproduced verification

- D2 suite: **46 tests / 46 pass / 0 fail / 0 skipped / 0 todo**.
- Simulator run 1: exit 0; 52,308 derived/enumerated; cell counts 4,104 / 4,788 / 18,144 / 25,272; 36 characterization schedules; control E.
- Simulator run 2: exit 0; byte-identical to run 1 and retained `results/` files.
- Offline aggregate: **5,155 total / 5,154 pass / 0 fail / 1 existing todo**, exit 0. D2 tests were not included.
- `git diff --check`: clean.

The first aggregate attempt was constrained by the review sandbox (temporary mutation writes and localhost binds were denied). It was rerun once with those offline permissions; the permitted run produced the result above. No Viewer/browser/live path executed.

## Independent interpretation and next gate

| Question | Independent disposition |
|---|---|
| H2 | Mechanically supported in all four declared synthetic cells; no historical-causality inference. |
| H5 | Mechanically supported in all four cells by stale schedules not carrying M-GAP; no historical-causality inference. |
| C6/N2 | Outcome E; the accepted synthetic fixture/rule does not discriminate a required pair and yields no defensible margin. |
| T4 | The frozen rule can settle on stale/early model states under the declared assumptions. This does not prove real Viewer timing or justify changing T4. |
| Historical C8 | Still unresolved. D2 provides mechanical possibility only; request-correlated live diagnostic evidence would be required for causality. |

**Checkpoint readiness:** requires bounded correction. No spec correction is required. Correct M1/M2 and the directly related Low wording/tests, regenerate deterministic results, and perform a targeted independent re-review before any checkpoint commit/push decision.

**Exact recommended next authorized action:** owner authorization for one bounded D2-OFFLINE remediation limited to characterization wording/evidence semantics, mechanism-witness retention, provenance labels, the non-vacuous dedup test, regenerated outputs, and directly affected README/internal-review/handoff text. Do not begin diagnostic instrumentation, a live diagnostic, a G2 retry, T4/C6/C8/harness/product/procedure work, authorization-record issuance, attempt reset, commit/push, or G3.
