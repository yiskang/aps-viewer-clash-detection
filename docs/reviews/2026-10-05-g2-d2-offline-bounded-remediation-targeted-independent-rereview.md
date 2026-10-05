# G2 D2-OFFLINE bounded remediation — targeted independent re-review

**Verdict:** one bounded input-integrity correction remains required before the docs/research checkpoint commit/push.

**Findings:** 0 Critical / 0 High / 1 Medium / 1 Low.

The two prior blocking findings are closed. D=30 is now correctly reported as model-invalid characterization outside the valid exhaustive domain, and deterministic M-GAP witnesses are retained in all four cells. The provenance, multi-reason dedup test, and stale wording corrections are also accepted. The mechanical results remain reproducible and unchanged. A separate read-after-hash TOCTOU issue, identified by the remediation's internal review, is real: the result can record hashes for one pair of fixture/R1 byte sequences while consuming later byte sequences. Because those hashes are the evidence provenance binding, this must be corrected before checkpointing the simulator/results package.

## Verified repository state and scope

- Repository: `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`.
- Branch/HEAD: `main` at `53ea0a74b215b4a3c7463b8fe7da4bf783b8c8fb`; `main == origin/main`.
- Harness SHA-256: `cc8868cd68b9c2c3382297070289a2aa165c74249c6d82896d76bacc6c6ef09b`.
- Accepted procedure SHA-256: `d1ccfde224b8ae76fe74b06c93abc532e6df9612933cafaa045053c8e2e45a75`.
- Accepted D2 spec SHA-256: `635d183415270eb842b47522e21a704bf3cdf5a9b7d0685d6e104f427499c574`; ratified fixture SHA-256: `6ee6e9fa94266fcdd26875f60b280f16dc4343909baa03795180997a41f978e0`.
- Immutable R1 SHA-256: `4204e2d36c9053db8e6601952bc79b27bbf903998637b81bde6bc8dcf2e42148`; the tracked immutable evidence directory has no working-tree difference.
- Historical state remains G2 `FAIL (row 3)`, C6 `NOT_EVIDENCED`, C8 unresolved, and T4 unchanged. No repository artifact indicates a Viewer/browser/live run, retry, new authorization record, attempt reset, or production/procedure change during this remediation.
- The changed executable material remains confined to `docs/research/2026-10-04-g2-d2-synthetic-transition/`. The accepted spec, real G2 harness, `test/acceptance/`, production tests, `src/`, `wwwroot/`, accepted procedure, immutable evidence, and T4/C6/C8 runtime logic have no working-tree change.

The codebase-memory graph was used for structural discovery of `runSimulation`, input validation, witness selection, and trace-row creation, followed by direct source/output inspection. Coverage reported no recorded issue for every relied-on D2 implementation and test file.

## Findings

### Medium M1 — validated hashes do not bind the bytes later consumed

**Locations:** `docs/research/2026-10-04-g2-d2-synthetic-transition/inputs.mjs:18-50`; `simulate.mjs:62-69`; `contract.mjs:21-27`; accepted spec §15.

`assertInputs()` opens and hashes all four files. After it returns, `runSimulation()` independently reopens `fixtures.json` through `loadFixtures()` and independently reopens R1 through `readFileSync()`. An external writer can replace either file between those reads. The output would then retain the earlier accepted digest in `inputHashes`, while schedule/geometry results are derived from later, unverified bytes.

This is a real TOCTOU integrity defect, not only theoretical wording drift. Local, single-user, offline use makes the race unlikely and keeps it below High severity, but does not preserve the provenance contract. The checkpoint would accept a simulator whose evidence can claim the wrong input identity, so M1 blocks checkpointing.

**Minimum correction:** read each mandatory input once into an owned byte snapshot; compute the recorded/validated digest from that snapshot; parse `fixtures.json` and R1 from those exact validated snapshots. Preserve all pins, result semantics, and output formats. Add a focused test that proves consumed fixture/R1 bytes are the validated bytes. No spec, harness, product, procedure, T4, C6, or C8 change is required.

### Low L1 — 128-byte trace-row cap lacks a boundary regression test

**Location:** `machine.mjs:143-148`.

Every trace append goes through the local `row()` helper, which checks the configured `traceRowBytes` limit before the only `trace.push()` call. Current trace fields are ASCII-only, so `JSON.stringify(r).length` equals the UTF-8 byte length for every reachable row; the observed maximum is 47 bytes. No alternate trace-row insertion path exists.

The cap is therefore enforced for the current model. The missing exact-boundary/one-byte-over test is a Low verification gap, not a bypass or checkpoint blocker by itself. A future non-ASCII trace field would require changing the check to canonical/UTF-8 byte length; no such field is currently reachable.

## Bounded remediation verification

### D=30 characterization — closed

- Exactly 36 `CW-*` schedules are produced; all 36 violate V5 and 12 classify `INVALID_AMBIGUOUS`.
- The generated record carries `modelValid:false`, `v5ViolationCount:36`, `invalidAmbiguousCount:12`, `excludedFromExhaustiveCounts:true`, `excludedFromHypothesisInference:true`, and `inferenceDrawn:"none"`.
- The characterization loop runs after the exhaustive outcomes/exit code are computed and writes only the separate `characterization` object and its characterization traces. It does not feed `classCounts`, `cellCounts`, `invariantResults`, `outcomeSchedule`, `hypotheses`, or `exitCode`.
- The README/result/handoff no longer claim the D=30 violations are not model defects. D=30 definitions and V5 are unchanged because the accepted spec has no working-tree difference.

**Verdict:** prior Medium blocker closed. D=30 is useful only as evidence that this extended numeric branch falls outside the valid model domain. It cannot support H2/H5, ownership, mechanism, product, historical-causality, or T4 conclusions.

### M-GAP retention — closed

Independent full enumeration confirmed these are the lowest schedule ids for M-GAP in each cell, and each retained result carries both `M-PRE` and `M-GAP` with a trace showing the prior terminal camera held while the next request is pending:

| Cell | Retained witness |
|---|---|
| CL-primary | `W-S-00497` |
| CL-tail | `W-S-00728` |
| OP-primary | `W-S-01467` |
| OP-tail | `W-S-02249` |

Independent enumeration also confirmed the lowest `(cell, mechanism)` witness for every non-zero M-PRE, M-GAP, M-RST, and M-TAIL count. Shared schedules retain all reasons; the generated result currently contains ten real multi-reason witnesses. Retained traces increased to 104, below the cap of 154.

**Verdict:** prior Medium blocker closed; no mechanism-coverage gap remains.

### Provenance labels — accepted

- `historicalDerived` contains only consumed retained inputs: U, the fit-pair distance, the retained C6 aspect, and the retained κ anchor.
- A:104 and retained C6/N2/C8 scalars are explicitly comparison targets, not simulator geometry operands.
- `SYN-A`, `SYN-B`, and `SYN-U` are explicit synthetic geometry and are explicitly not historical B:111/A:135 reconstruction.
- Timing/order, home geometry, tail stalls, ease, and calibration inputs remain synthetic. No output makes a historical-causality claim.

### Multi-reason dedup test — accepted

The new test calls the production `selectWitnesses()` helper with one schedule simultaneously selected for stale, two mechanism, and two diagnostic reasons. It then asserts the complete ordered reason list on the deduplicated witness. Dropping or overwriting any reason makes the test fail. The assertion is not constructed after dedup and is non-vacuous.

### Stale wording and pins — accepted

The implementation internal review now records the corrected D=30 meaning, the remediation review uses explicit severity classes, and `inputs.mjs`/README state that the spec and fixture pins were ratified. Their values and semantics are unchanged; no new pin policy was introduced.

## Reproduced results

- D2 suite: **49 total / 49 pass / 0 fail / 0 todo**. The three added tests cover the D=30 inference boundary, retained mechanism coverage including M-GAP, and production-path multi-reason dedup.
- Offline aggregate: **5,155 total / 5,154 pass / 0 fail / 1 existing todo**, exit 0. The first sandboxed invocation was denied temporary mutation-file writes and localhost binds; the permitted offline rerun produced the result above. No Viewer/browser/live path ran.
- Two simulator runs: both exit 0 and are byte-identical to each other and to retained `results/`.
- Counts: **52,308** exhaustive schedules, split **4,104 / 4,788 / 18,144 / 25,272**; 36 separate D=30 characterization schedules.
- Exhaustive validity: zero invariant violations, zero invalid exhaustive schedules, zero inconclusive exhaustive schedules; all four cell outcomes A.
- Hypotheses: H2 and H5 `SUPPORTED` in all four exhaustive cells.
- C6/N2: outcome E, `d_min="none"`, failing pair `P_C6~L_home`; no margin selected.
- Retained traces: 104; observed maximum row 47 B and maximum trace 837 B.
- Output sizes: summary **98,819 B**; witnesses **86,011 B**; both and their total are below the 2.5 MiB per-output and 3.5 MiB total caps.
- Output digest: `e1d1b815ed351e6feba3e34822ba9895e54035158e685bfbe7f628f6d10bbb06`; companion digest: `75f0596f8a321fc417706c70e0c19ad7a360e92027ced1bab811155934789407`.
- `git diff --check`: clean before this review artifact/handoff update.

The accepted state machine, numeric T4 model, ownership oracle, classifier, tail branch, class/mechanism counts, four A outcomes, H2/H5 support, and C6/N2 outcome did not drift. The digest change from the prior run is limited to the intended characterization/provenance/witness reporting changes.

## Independent interpretation

| Item | Disposition |
|---|---|
| H2 | Still mechanically supported in all four declared synthetic cells. This proves possibility under the model, not historical C8 causality or live Viewer behavior. |
| H5 | Still mechanically supported in all four cells by stale schedules that do not depend on M-GAP. It remains a synthetic-model result only. |
| C6/N2 | Still non-discriminating under the accepted exploratory synthetic rule: outcome E, no `d_min`, and no defensible C6 margin. |
| D=30 | Shows that the extended compounding-smoothstep branch violates the accepted numeric validity invariant. Because it is outside the valid exhaustive domain, no mechanism or hypothesis inference may be drawn from it. |
| Historical C8 | Still unresolved. The offline model shows a compatible mechanical possibility but does not identify the historical live cause. Request-correlated diagnostic evidence would be needed later under separate authorization. |

## Checkpoint and next gate

**Checkpoint commit/push readiness:** not ready. One bounded simulator-only integrity correction remains: bind hash validation and parsing to the same owned input bytes. The row-cap boundary test is recommended in the same small pass but is not independently blocking. No spec correction is required.

**Exact recommended next authorized action:** the owner may authorize one bounded D2-OFFLINE hardening pass limited to single-read input snapshots for all four mandatory inputs, parsing fixtures/R1 from those validated snapshots, a non-vacuous consumed-bytes regression test, the optional exact row-cap boundary test, regenerated deterministic outputs only if bytes change, directly affected docs/handoff, and targeted independent re-review. Diagnostic instrumentation, another offline characterization, a live diagnostic, G2 retry, new authorization record, attempt reset, T4/C6/C8/harness/product/procedure work, checkpoint commit/push, and G3 remain unauthorized.
