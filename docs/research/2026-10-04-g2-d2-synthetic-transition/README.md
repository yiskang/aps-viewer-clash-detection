# G2 D2-OFFLINE synthetic transition simulator

Research tooling only. Implements the independently accepted spec
[`../2026-10-04-g2-d2-synthetic-transition-spec.md`](../2026-10-04-g2-d2-synthetic-transition-spec.md).
It proves **mechanical possibility under modelled assumptions only** — never historical causality, a product defect, live Viewer behaviour, a T4 change, or G2 retry readiness. It touches no harness, test, product, procedure, T4/C6/C8 runtime logic, or evidence.

## Commands (pure ESM, Node >=20, no dependencies, no network/browser)

```
node docs/research/2026-10-04-g2-d2-synthetic-transition/simulate.mjs --out <empty-dir>
node --test docs/research/2026-10-04-g2-d2-synthetic-transition/*.d2-test.mjs
node docs/research/2026-10-04-g2-d2-synthetic-transition/simulate.mjs --out <dir2> && diff -r <dir> <dir2>
```

Exit 0 = no cell `C1-INVALID` (C2-INCONCLUSIVE also exits 0); exit 2 = input-hash / count / invariant / cap failure (fail closed, nothing truncated).
Output dir must be empty and may not be under `test/acceptance/results` or `docs/research/evidence`. Committed reference output: `results/`.

**Test naming deviation from spec §15 command shape:** tests are `*.d2-test.mjs`, not `*.test.mjs`, because `scripts/run-tests.mjs` globs `*.test.mjs` and would otherwise pull this research suite into `npm test`. Run them with the explicit command above.

## Files

| File | Role |
|---|---|
| `fixtures.json` | Synthetic constants (poses, domains, tail τ, caps, geometry grids). Pinned by hash. |
| `contract.mjs` | Φ sample map, `cameraSamplesWithin` (T4 equality), fixture loading |
| `schedules.mjs` | Domain-derived counts + enumeration + ids + 36 D=30 witnesses |
| `machine.mjs` | State machine, numeric T4 settle loops, oracle, classifier, invariants V0–V5/V7 |
| `geometry.mjs` | C6/N2 synthetic control study (§9–§11) |
| `canonical.mjs` / `inputs.mjs` / `outputs.mjs` | canonical JSON + digests, input-hash validation, cap enforcement/writes |
| `simulate.mjs` | Orchestrator / CLI |
| `*.d2-test.mjs` | Tests (`sim`, `geometry`, `infra`) |

## Input hashes (validated before enumeration; mismatch ⇒ exit 2)

| Input | SHA-256 |
|---|---|
| spec | `635d183415270eb842b47522e21a704bf3cdf5a9b7d0685d6e104f427499c574` |
| harness | `cc8868cd68b9c2c3382297070289a2aa165c74249c6d82896d76bacc6c6ef09b` |
| R1 | `4204e2d36c9053db8e6601952bc79b27bbf903998637b81bde6bc8dcf2e42148` |
| fixtures.json | `6ee6e9fa94266fcdd26875f60b280f16dc4343909baa03795180997a41f978e0` |

**Pin history:** spec §15 says the D2-OFFLINE authorization pins the spec and `fixtures.json` digests, but the authorization prompt pinned neither, so the implementer pinned the committed spec digest (equal to `git show HEAD:<spec>`) and the digest of the `fixtures.json` it wrote (`inputs.mjs`, `EXPECTED_INPUT_HASHES`). **Both pins were ratified by the independent Work review.** `runSimulation()` requires all four digests (absent/malformed ⇒ exit 2).

## Schedule domains

`D∈{1,2,3,4,6,10}`, `L∈{0,1,2}` (D−L≥2 for L≥1), `S∈{0,1,2}`, `ORD` 6 permutations, `G∈{0,1}`, families F0/F1/F2, modes CL/OP, restore variants `OK-SAME/OK-NEXT/NOOP/THROW`. Count is derived two ways (closed form + enumeration) and compared with the spec: **52,308** = CL-primary 4,104 + CL-tail 4,788 + OP-primary 18,144 + OP-tail 25,272; plus 36 `D=30` characterization schedules (never in a cell). Mismatch ⇒ `C1-INVALID`, exit 2.

## Output schema (spec §15; two files)

`d2-summary.json` (canonical JSON: sorted keys, no whitespace, no trailing newline) and `d2-witnesses.json`. Mapping of the requested reports:

| Requested report | Summary key |
|---|---|
| summary / schedule-count report | `enumerationCount`, `derivedCount`, `cellCounts`, `domains` |
| outcome histogram | `classCounts{cell,family,class}`, `mechanismCounts`, `outcomeSchedule`, `hypotheses` (H2/H5 per cell), `oracle`, `expectationE6`, `invariantResults` |
| bounded witness traces | `witnesses[]` (index) + `d2-witnesses.json` (`traces`, ≤154, ≤16 KiB each) |
| C6/N2 discrimination statistics | `geometry` (interval aggregates, `sep`, `stablePairs`, candidate separators, `d_min`, RET-U anchor), `outcomeControl` (D/E) |
| D=30 characterization | `characterization` |
| metadata / hashes | `inputHashes{expected,observed}`, `companionDigestSha256`, `outputDigestSha256`, `caps`, `provenance`, `interpretationLimits` |

Digests: `companionDigestSha256` = SHA-256 of the canonical `d2-witnesses.json` bytes; `outputDigestSha256` = SHA-256 of the canonical summary with that field omitted. No absolute paths, timestamps, or runtime versions are written.

## Historical / synthetic boundary

Historical-derived inputs actually consumed: U (8 R1 corners), aspect 676/380, fit-pair distance 263.8571494974672 (checked bit-for-bit against R1), κ=0.9 anchor (read from the retained N2-like sample; a synthetic calibration anchor). A:104 and the C6/N2/C8 scalars are D1 *comparison targets only* — not geometry operands. Synthetic: `SYN-A`/`SYN-B` unit boxes (spec §9.1; **not** the historical B:111/A:135 boxes), SYN-U, home/target poses, timing/ordering, tail stalls, ease curve, calibration set V — all tagged `synthetic: true`. `κ=0.9` is not a margin; `3×` is exploratory; `d_min` is observed only; no C6 margin is selected.

## Interpretations made (spec was silent or ambiguous)

- Trace rows are elided for intermediate `A` steps, non-terminal `H` samples and flag-only `T` rows (frames preserved) to respect the 128-row bound (spec L2).
- **D=30 is model-invalid characterization.** The D=30 branch is outside the valid exhaustive model domain: under compounding smoothstep the late steps move <1e-9, so all 36 schedules violate V5 and 12 are `INVALID_AMBIGUOUS` (model defects per the spec). They are recorded in `characterization` (`modelValid:false`, `v5ViolationCount:36`, `invalidAmbiguousCount:12`) and excluded from exhaustive cell counts, outcomes, H2/H5 inference, `invariantResults` and the exit code (spec §7.5, §12.1). No inference is drawn from them. D=30 definitions were not altered to make them valid.
- **Mechanism witnesses:** at least one trace is retained for every (cell, mechanism) with a non-zero count (lowest schedule id; M-PRE/M-GAP/M-RST/M-TAIL), with merged `reasons[]` on shared witnesses.
- Tail base is the pose written after step `D−L−1`, used literally even if a restore intervenes; V5 checks the tail series against itself.
- `SYNC` is taken from the restore variant (`OK-NEXT` ⇒ NEXT, otherwise SAME).
- H5/H2 `INCONCLUSIVE` is assigned whenever a cell contains an inconclusive terminal and no witness (spec text keys it to C2 only).
- Spec THROW example (spec L1): the normative rules put the restore in frame 1's `H+`, not frame 2; tests assert derived frames.
- The shadow run stops at quiescence (all tokens complete, oracle deliveries for e=0,1 taken), capped at frame 127.

## Known limitations

Spec §7.6 applies: not exhaustive beyond the stated domains; the model abstracts camera-dependent destinations; real Viewer ease curve, multi-listener ordering and autocam internal state are not modelled.
