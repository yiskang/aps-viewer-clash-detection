# G2 diagnostic-instrumentation offline prototype

Research tooling only. It implements the offline prototype and sufficiency experiment of
[`../2026-10-05-g2-diagnostic-instrumentation-spec.md`](../2026-10-05-g2-diagnostic-instrumentation-spec.md) §7–§8.
Every result is **synthetic** and holds only inside D2's closed universe. It is not historical evidence and not a live
diagnostic. It does not change the G2 procedure, T4, C6/N2 or C8. Historical C8 stays unresolved, C6 stays
`NOT_EVIDENCED`, and real T4 is unchanged. Version-bound atoms remain diagnostic/research-only. D=30 is never simulated.

## Commands (pure ESM, Node >= 20, no dependencies, no network/Viewer/browser)

```
node docs/research/2026-10-05-g2-diagnostic-instrumentation/run-diagnostic.mjs --out <empty-dir>
node --test docs/research/2026-10-05-g2-diagnostic-instrumentation/*.diag-test.mjs
node docs/research/2026-10-05-g2-diagnostic-instrumentation/run-diagnostic.mjs --out <empty-dir-2> && diff -r <empty-dir> <empty-dir-2>
```

Exit 0 means every gate passed. Exit 2 means an input-hash, conformance, cap, transitivity, label-conformance,
partition cross-check, malformed-projection or correlator-soundness failure, and nothing is written. The two output
files are written atomically as a unit: into a sibling `.<out>.staging` directory that is then renamed onto the
(absent or empty) output directory. The output directory must be empty or
absent, and may not be under the D2 directory, `docs/research/evidence/` or `test/acceptance/results/`. A full run takes
about 6.5 min on a 10-core machine (about 95 s before the M1 ablation, which runs on worker threads). The test suite takes about 8 min, because one test repeats the full run and compares it byte-for-byte with
`results/`.

Tests are named `*.diag-test.mjs`, not `*.test.mjs`, so `scripts/run-tests.mjs` (which globs `*.test.mjs`) does not
pull them into `npm test` / `npm run test:offline`.

## Reference output (`results/`)

| File | Bytes | SHA-256 (file) |
|---|---|---|
| `diag-summary.json` | 197,416 | `410c637d79e4d78801dcbb98fa75b3f4ce0c56e9cdc12ce1b684b1c8ccb21d47` |
| `diag-witnesses.json` | 109 | `83548e8b37e49ea980e8d1444c970b86b636677480770b76ab0606ddbeaff0d3` |

- `outputDigestSha256` (canonical summary with that field omitted): `fe42e53e0e12c19fd9c321b7b038998c1fbe09b42ab1f5c556de71d247a52c35`
- `companionDigestSha256` (canonical witnesses file): `83548e8b37e49ea980e8d1444c970b86b636677480770b76ab0606ddbeaff0d3`
- Spec SHA-256 recorded as `inputHashes.thisSpec.observed`: `385993ba1b5bdb30687ab3235c01f651bca5be2690e5ccdfa6fecd9ed7be594e` (final schema-v3 package; spec §7.4 reconciled to `schemaVersion: 3` and the `ablation` carrier)

Determinism, as re-verified on 2026-10-05 after the schema-v3 correction (spec-bound regeneration): two CLI runs into fresh empty directories gave `diff -r` with no differences,
and both were byte-identical to `results/`. The determinism test re-runs the pipeline and asserts byte identity with
`results/`.

## Output schema (spec §7.4; `diag-summary.json` is `schemaVersion: 3`)

- `diag-summary.json`: `kind: "g2-diagnostic-sufficiency-summary"`, **`schemaVersion: 3`**. Version 3 adds the bounded top-level `ablation` carrier; a v2 summary (no `ablation`) is not conformant.
- `diag-witnesses.json`: `kind: "g2-diagnostic-collision-witnesses"`, `schemaVersion: 2` (its format is unchanged).
- `ablation` (spec §7.4, "`ablation` carrier (normative)") records the exhaustive sound-correlator ablation over all 2,048 configurations (1,024 element masks × 2 slot windows) in fixed-size form:
  - `satisfyingBitmapHex`: 256 lowercase hex characters, 1,024 bits, hex digit `k` = masks `4k..4k+3`, bit `cm & 3` set iff mask `cm` satisfies the two-window objective;
  - `outcomes[]`: the distinct per-(window, mask) correlator outcomes (≤ 2,048; 46 in the reference run), first-appearance order (`OPEN` then `ASSUME`, mask ascending), integers only;
  - `outcomeIndex{OPEN, ASSUME}`: two 1,024-entry index arrays into `outcomes[]`;
  - fixed-key aggregates: `target`, `lattice`, `canonical` (+ `necessity`), `canonicalIncludingInf`, `coMinimal`, `windowOnly`, `oldBundle`, `allConfigurations`, `publicOnly`, `idOff`, `influence` (10 elements × 2 windows; ≤ 40 `firstWitness` schedule ids), `questionCoverage`, `unsoundConfigurations` (always `[]`).
- Bounds and interpretation: this is the only per-subset (per-configuration) retention. It is bounded (about 58.8 KB of the 197.4 KB summary; the whole summary is capped at 1,048,576 B) and carries no per-schedule rows, per-schedule traces or numeric camera samples. Output is deterministic and independent of the worker-thread count. Retention limits are unchanged: `witnessIndex` ≤ 468, `traces` ≤ 16.
- NV bound: the future-live `NV` record cap is **406 B** (`LIVE_CAPS.bytesPerNv`; spec §6.4(b)). The earlier 400 B figure is superseded.
- `summary-schema.diag-test.mjs` checks the v3 contract against `results/` (schema version, carrier shape and cardinalities, ordering, rejection of a stale v2 summary, 406 B, the spec text).

## Input pins (validated before enumeration; mismatch => exit 2)

| Input | SHA-256 |
|---|---|
| D2 spec | `635d183415270eb842b47522e21a704bf3cdf5a9b7d0685d6e104f427499c574` |
| D2 `fixtures.json` | `6ee6e9fa94266fcdd26875f60b280f16dc4343909baa03795180997a41f978e0` |
| D2 `machine.mjs` | `a78b096d795e058f6adcd02dc0e5c9f707627127c156755d8e639c35b98918bf` |
| D2 `schedules.mjs` | `4b41fac2bec83ac8797c48749fe1cde3bc7f069d5fe5d37c756d2e52e9a85d4d` |
| D2 `contract.mjs` | `71fa49cd85c3680ef560f8778896457444d2f36c90e317bdf7900b0dd7eea626` |
| D2 `canonical.mjs` | `73bbeadcaf0248b9a6f5bb16c4c7c690b3158fa094f192be4dd6c106aeaa038b` |
| D2 `results/d2-summary.json` | `fde4a12a443ad361d8d5f4be59b7b851689fd12f8cf9c2cf57399dd9029f17e2`, and its `outputDigestSha256` field must equal `e1d1b815ed351e6feba3e34822ba9895e54035158e685bfbe7f628f6d10bbb06` |
| this spec | recorded as observed only |

**Read once.** Each input is read exactly once into an owned buffer. The digest is computed over that buffer. The JSON
inputs are parsed from the same buffer. The D2 code modules are loaded from the same buffer as `data:` URLs, so the code
that runs is byte-identical to the code that was hashed. The only transformation is a deterministic rewrite of the single
relative specifier `'./contract.mjs'` to the `data:` URL of the validated `contract.mjs` bytes. Nothing is ever written
into the D2 directory. `runSchedule`'s `opts.mutate` is never used.

## Files

| File | Role |
|---|---|
| `pins.mjs` | input pins, read-once loading (spec §7.1); the VB-0 Viewer pin (`7.124.2` + bundle SHA-256, §6.1.3) |
| `observer.mjs` | observer replica of D2 `runSchedule`, ground-truth DiagEvent emission (§7.3), ground-truth labels and the 13 questions (§8.2) |
| `conformance.mjs` | mandatory conformance gate: fields, D2 trace rows (a)–(d), aggregates (§7.2) |
| `project.mjs` | atoms, named configurations, projection, `cl`/`xc` classing, R2 slot binding, transitivity gate (§8.3–§8.5) |
| `sufficiency.mjs` | exact partitions, exhaustive 512-subset search, minimal sets, necessity (§8.5–§8.7) |
| `correlate.mjs` | R1–R8 correlator with C1/C2/C3/C6 fail-closed semantics (§6.2–§6.3) |
| `ablation.mjs`, `ablation-worker.mjs` | exhaustive sound-correlator ablation: all 2 × 1,024 configurations (9 atoms × ID axis × slot window), minimum/co-minimal extraction, necessity, verdict influence, tier tables (§8.6; worker threads, merge by sums/minima) |
| `bounds.mjs` | every §6.4 cap, the offline trace buffer, output caps, and the live design-bound reference recorder (META/END reserve, NV) used by tests only |
| `schema.mjs` | DiagEvent kinds, fields, class tags, validator (§6.1) |
| `trace-integrity.mjs` | whole-trace META/data/END validator and the META/END-aware live entry point `correlateTrace` (§6.1.3, §6.3); design-bound reference, tests only |
| `run-diagnostic.mjs` | orchestrator and CLI, atomic writes |
| `*.diag-test.mjs` | `bounds` (schema + every bound at cap and cap+1), `correlate` (hand-built traces), `pipeline` (pins, gate, exactness, minimal sets, witness-derived cases, determinism), `vb0` (exact VB-0 pin, H1), `integrity` (whole-trace integrity, one mutation per error code), `ablation` (extraction on synthetic tables, hard gate, real-subsample ablation over all 2,048 configurations), `summary-schema` (schemaVersion 3, the bounded `ablation` carrier, 406 B NV, spec text) |
| `results/` | committed reference output |

## Gates run on every one of the 52,308 exhaustive schedules

- Replica vs D2 `runSchedule` on 10 fields, both with and without `trace`. D2's own trace rows are checked as an ordered subsequence (852,312 rows), together with the deciding row (`subj`/`active`), the restore pre-state row, and the `cons`/`skip`/`final` frames. Aggregate `classCounts`/`mechanismCounts` match `d2-summary.json`.
- Label conformance: `Q-DH1`=M-PRE, `Q-DH2`=M-GAP, `Q-DH4`=M-TAIL (tail cells), and `Q-OWNER`=class counts.
- Offline caps on the full (all atoms + oracle) ground-truth projection for both ID axes. Observed maxima: 114 events, 109 B per event, 5,691 B per trace (limits 1,024 / 160 / 163,840).
- Schema validation of every full-projection event. The 1e-9 transitivity gate.
- Correlator soundness (`wrong` must be 0) for `T-PUB/ON`, `T-VB/OFF` and `T-VB/ON` on every relevant schedule.
- Ablation: the correlator on every relevant schedule in all 2,048 configurations, with `wrong` = 0 in every configuration. The ablation must match the four named correlator runs exactly (counts and reasons). Every relevant schedule must be ablated exactly once. The `interpretationLimits` wording must still match the data.
- The fast exact partition is cross-checked against the canonical-bytes (SHA-256) partition for every oracle-free named configuration. The `pipeline` test checks it for all 512 subsets on both axes over a 120-schedule subsample.

## Headline results (synthetic, D2-closed-universe only; see the research doc §8–§10)

- **Information-theoretic separability is degenerate inside D2 (a closed-world fingerprint result, not a recommendation).**
  - All 9 named configurations distinguish 40,788 / 40,788 relevant schedules for all 13 questions in all 4 cells, including the public + harness-tagged tier `T-PUB/OFF`.
  - Every relevant schedule has a unique projected trace (`blocks` = `relevant`). `witnessIndex` is therefore empty and `diag-witnesses.json` retains 0 traces.
  - Single public atoms (`P-TICK` or `P-FRM`) are already minimal sufficient sets. No `monotonicityViolations` occur.
  - Every §8.7 necessity field is `NOT_NECESSARY_IN_D2`; request identity is `NOT_DEMONSTRATED_IN_D2`.
  - The cause is D2's deterministic, jitter-free, two-request, no-foreign-writer timeline: a per-frame public stream reconstitutes it, so event order determines every label. The frame index `f` adds trace uniqueness only; separability persists without `f` (and without `cl`/`xc`), as the `pipeline` `f`-ablation test shows. Some separability is definitional (`Q-DH7A` ≡ `TCK` absence, `Q-ACTIVE` ≡ `ac`).
- **The sound correlator separates the tiers** (under `OPEN` the minimum answers 2 of 13 questions, under the assumption mode 3 of 13; only 3 of 13 have a sound procedure; definite / relevant; `wrong` = 0 everywhere). `T-PUB/ON`, `T-VB/OFF` and `T-VB/ON` run in the assumption mode (no unobserved writer between the last visible read and a consumption edge; true in D2 by construction, unverifiable live). `T-VB/ON@OPEN` is the fail-closed default (spec §6.2 R3):

  | Run | `Q-OWNER` | `Q-SUBJ` | `Q-ATTR` |
  |---|---|---|---|
  | `T-PUB/ON` | 0 | 0 (unavailable) | 0 |
  | `T-VB/OFF` | 3,193 | 0 (unavailable) | 0 |
  | `T-VB/ON` (assumption) | 35,725 (33,117 rely on it) | 35,725 (17,790 rely on it) | 40,788 (all rely on it) |
  | `T-VB/ON@OPEN` | 2,608 (`RESTORE`) | 17,935 (`PENDING`) | 0 |

  The `T-VB/ON` residual (5,063 per question: 454 / 213 / 2,310 / 2,086 by cell) is all `ACTIVE_WITHOUT_VISIBLE_STEP`, ground-truth `ACTIVE0` (DH-1). Per-reason counts are persisted in `correlator.*.*.*.reasons`.
- **Minimum sufficient diagnostic set (exhaustive ablation, spec §8.6; `ablation` in the summary).** The correlator was run on all 40,788 relevant schedules for all 2,048 configurations. The target is the full-configuration definite counts in both windows, with 0 wrong labels.
  - **Result:** the unique minimum (also the only minimal set) is base + `ID-ON` + `P-FRM`, `P-TC`, `V-PEND`, `V-EDGE`. Exactly its 32 supersets satisfy; there are 0 monotonicity violations and no co-minimal set.
  - **Necessity:** removing `P-FRM` drops `OPEN` `Q-OWNER` 2,608 → 0. Removing `P-TC` drops assumption-mode `Q-ATTR` 40,788 → 0. Removing `V-PEND` or `ID-ON` drops `Q-SUBJ` to 0. Removing `V-EDGE` drops every definite label to 0.
  - **`P-XS` is redundant.** Removing it from the earlier candidate bundle changes no count, and with the minimum present it changes no verdict on any schedule. It can replace `P-FRM` only under the assumption-mode-only objective (`windowOnly.ASSUME` has two co-minimal sets), and loses the 2,608 `OPEN` `RESTORE` owners there.
  - `P-TICK`, `P-CC`, `P-CC0` and `V-ACT` change no verdict in any configuration.
  - **Coverage:** the minimum answers 2 of 13 questions under `OPEN` (`Q-ATTR` has 0 definite labels in every configuration) and 3 of 13 under the assumption mode (only `Q-ATTR` fully).
  - **Tiers:** all 128 public-only subsets × 2 windows give 0 definite owner/subject/attribution labels. `ID-OFF` gives 0 definite `Q-SUBJ`/`Q-ATTR`.
  - Runtime: the ablation runs on worker threads, concurrently with the main passes. It adds about 5 min to a full run on a 10-core machine.
  - **Soundness defect found by the ablation and fixed (M1).** In 64 assumption-mode configurations that contain `V-PEND`, `V-EDGE` and `ID-ON` but lack `P-TC`, the pre-fix correlator emitted wrong labels: a false edge without an observed `TC` left the transition active, so its terminal write was credited as in-flight (first witness `S-00001`). `correlate.mjs` now treats that terminal write as hidden: after a false edge, with `P-TC` absent, `Q-OWNER`/`Q-SUBJ` are `AMBIGUOUS` (`OBSERVABLE_ABSENT:P-TC`). The fix only turns definite labels into ambiguous ones; the four named runs and the minimum are unchanged. The hard gate now holds in all 2,048 configurations (`wrong` = 0).

## Spec deviations (recorded for internal review; none relaxes a check)

1. **Correlator refinements (spec §6.2 pseudo-code, made more conservative).** All seven are listed in the `correlate.mjs` header. The first draft already had 0 wrong labels; these refinements make the procedure follow the R5 prose and close gaps in the pseudo-code. They are not a response to a soundness failure.
   1. R5 `FOREIGN_CANDIDATE`, including the `activeTok == NONE` branch that the pseudo-code omits.
   2. A change after a bracketing writer while a transition is or may be active is `WRITER_RACE` (ambiguous).
   3. The RST post-call read is the restore's own read.
   4. An INIT baseline requires that no transition could have stepped before the first read.
   5. `Q-ATTR` is `UNAVAILABLE` without `P-TC`.
   6. `fr` must sit exactly on the subject's deciding sample (added C3 rule `CONTRADICTION:FR`).
   7. R5 "positive evidence that no step ran" is applied uniformly. Without `V-EDGE` there is never such evidence once a fit was issued, so `Q-OWNER` is `AMBIGUOUS` (`ACTIVE_STATE_UNOBSERVED`). The literal pseudo-code would have emitted INIT/RESTORE from "no visible change" alone. This is the main reason `T-PUB/ON` has 0 definite owners.
2. **Public + harness-tagged ambiguity and version-bound resolution test cases.** Because every named configuration is collision-free, `witnessIndex` is empty. These test cases are therefore taken from actual collision data of the exhaustive subset table, not from `witnessIndex`. The lowest-id `Q-TUPLE` collision under the base atoms in CL-primary is `S-00000` (F0, D=1, ORD `HAT`; `INIT|ACTIVE0|1|NONE`) vs `S-00010` (F0, D=1, ORD `TAH`; `OWN|COMPLETE|0|NONE`). The two traces are byte-identical under the base atoms, and any one of `V-PEND`, `V-EDGE`, `V-ACT`, `P-TICK`, `P-FRM`, `P-TC` or `P-CC` separates them.
3. **`recommendedIncludingInf`** is always the first minimal set in §8.6 order, whether or not it contains `P-CC0`. The spec defines it only for the case where `recommended` is `null`. `recommended` never contains `P-CC0`.
4. **Remediation (internal review 2026-10-05).** The correlator is total and validates every event and its atom/ID-axis consistency first (`MALFORMED`, never an exception); the R3 slot window defaults to fail-closed `OPEN`; `applyVbGuard` fails closed and needs the VB-3 positive control, which runs after capture and is recorded in `END.pc` (guard applied post hoc; re-review R-M4); `INIT` needs a capture-start `CAM` at `f = 0`; an unread restore is never definite under `OPEN`; `schema.mjs` has per-kind required fields, slot invariants, own-property lookups and `META`/`END` validators; the live reference recorder validates before mutating and counts `END.iv`; the summary is `schemaVersion: 2` with a fourth correlator run and per-reason counts (`schemaVersion: 3` adds `ablation`, remediation M1). See the review file's "Remediation" section.
5. **`status`** is `SUFFICIENT_SETS_FOUND` iff some subset is sufficient. If that ever disagreed with "the full 9-atom set is sufficient" (possible only under non-monotonicity), the run exits 2. It never disagrees here (0 monotonicity violations).

## Interpretations (spec silent or ambiguous)

- `H+` operations (`FIT`/`RST`/`SST` issued in the gate's H continuation) are emitted where D2 executes them, after the `SMP` records of that H phase. External operations are emitted at frame start.
- `ow` is also carried on `FIT`/`RST` post-call reads, as in §7.3 (§6.1.2 lists only `SMP`/`CAM`). It is SYN-only either way.
- `ID-OFF` `pd.ch` compares slot-object handles with the null slot treated as a value.
- `pq` under `ID-OFF` is `{p, ch}`. `nw` is carried on the `FIT` `pd` under both axes.
- R2 slot binding is computed in trace order. A read of a never-bound object shows `"U"`.
- `Q-ATTR` label domain is `{-, 1, 1,2, 2}`. `Q-TUPLE` domain is the 160-tuple product. A label outside its domain exits 2.
- `relevantCounts.excluded` is zero-filled over the non-relevant D2 classes.
- `caps.observed.summaryBytes` / `totalOutputBytes` are the actual sizes, found by a fixed-point iteration. Digest fields are fixed-width.
- `d2Conformance.fieldsChecked` lists the 10 fields plus the row checks (a)–(d) and the aggregates. `rowsChecked` is the number of D2 trace rows matched.
- **Fast-path exactness.** Per-event canonical strings from `project.mjs` plus D2 `canonicalStringify` are interned to integers. Blocks use a 53-bit hash of the integer sequence, with every hit confirmed element-wise and collisions chained. Equality is therefore exact byte equality of the canonical projected traces, and is stronger than the digest keys spec §8.5 permits.

## Known limitations

- Spec §9 applies in full. D2 has two requests, no foreign writer, no no-op fit, and never discards the subject.
- Public + harness-tagged separability is a closed-world D2 result that implies no bound for a live Viewer, and minimal separability sets are closed-world D2 results that imply no live instrumentation bound, never recommendations.
- Assumption-mode correlator labels are sound within D2 only; `T-VB/ON@OPEN` is the reference that does not depend on the writer assumption (an identical-value camera write stays invisible in both modes).
- The live recorder in `bounds.mjs` is a design-bound reference for tests only. No live diagnostic is authorized.
