# G2 D2-OFFLINE input-snapshot hardening — targeted independent re-review

**Verdict:** ready to checkpoint. The prior Medium input TOCTOU blocker is closed.

**Findings:** 0 Critical / 0 High / 0 Medium / 2 Low. Both Low items are non-blocking verification/maintenance limitations already bounded by the current production path.

## Verified repository state

- Repository: `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`.
- Branch/HEAD: `main` at `53ea0a74b215b4a3c7463b8fe7da4bf783b8c8fb`; `main == origin/main`.
- Real G2 harness SHA-256: `cc8868cd68b9c2c3382297070289a2aa165c74249c6d82896d76bacc6c6ef09b`.
- Accepted G2 procedure SHA-256: `d1ccfde224b8ae76fe74b06c93abc532e6df9612933cafaa045053c8e2e45a75`.
- Accepted D2 spec SHA-256: `635d183415270eb842b47522e21a704bf3cdf5a9b7d0685d6e104f427499c574`.
- Immutable R1/R2/R3 SHA-256 values remain `4204e2d36c9053db8e6601952bc79b27bbf903998637b81bde6bc8dcf2e42148`, `5282f01c82c404cf8e39cf68fbf55288bac8509fb6b9adf6fb499f68d71d0da4`, and `8de72bb0c6cf5883ad5bdd96ffe06a0d8c4c6fd769ee8984865c412a804728f0`; the immutable evidence directory has no working-tree difference.
- The retained attempt commit still records `finalOverall: FAIL`, `primaryRow: 3`; retained C6 is `NOT_EVIDENCED` (`n2-not-discriminating`) and retained C8 remains `FAIL` (`element-outside-frustum`) with causal ownership unresolved.
- Git shows no working-tree change under the accepted spec, real G2 harness, `test/`, `src/`, `wwwroot/`, accepted procedure, or immutable evidence. HEAD and both branch refs are unchanged, so this remediation introduced no commit or push.
- No newer attempt or authorization identity is present on disk. The existing `g2-live-20261004-75a3ccb9` reservation/journal/commit and the three already-recorded authorization files are unchanged in identity; there is no repository evidence of a Viewer/browser/live rerun, attempt reset, or new record.

The codebase-memory graph was used to establish call relationships, followed by direct source inspection. Coverage reported no recorded issue for all ten relied-on D2 implementation/test files; conclusions below were verified from the files themselves.

## Findings

### Critical

None.

### High

None.

### Medium

None. The prior hash/consume divergence is no longer reachable through `runSimulation`.

### Low L1 — malformed digest-valid JSON would surface a bare parse error

`runSimulation` parses fixtures/R1 after all four snapshots validate. A byte sequence deliberately pinned by its expected digest but containing malformed JSON would therefore throw a `SyntaxError`, rather than a normalized `C1-INVALID` error. This is not reachable with the mandatory accepted pins, and digest-mismatching malformed input is rejected before parsing. It does not weaken the hash/consume binding or checkpoint evidence.

### Low L2 — row-boundary coverage targets the shared primitive directly

The 127/128/129 test calls `assertTraceRowWithinCap` directly instead of constructing a full schedule whose generated trace happens to reach those exact sizes. Direct source and call-graph inspection show that the production `row()` helper calls this same function immediately before the only `trace.push()` site; no bypass exists. Current trace rows are ASCII, so the tested JSON character lengths are also the exact UTF-8 byte lengths. Future non-ASCII trace fields would require a byte-length implementation/test update, but none are reachable now.

The former `loadFixtures` Low is closed rather than carried as a finding: it is explicitly marked TEST-ONLY, imported only by `sim.d2-test.mjs`, and has no `runSimulation` or CLI runtime caller.

## Owned-snapshot and fail-closed verification

`readSnapshot(path, reader)` performs one read and immediately wraps the result with `Buffer.from`, creating an owned byte copy even when the reader returns a mutable `Buffer`. SHA-256 is computed from that copy. `readValidatedSnapshot` returns those bytes only after the digest matches; on mismatch or read failure it returns `bytes:null`. `validateInputs` independently invokes that sequence for spec, harness, R1, and fixtures, retaining separate buffers and digest records.

`runSimulation` then:

1. validates the presence/shape of every mandatory expected digest;
2. calls `assertInputs` once;
3. parses fixtures from `inputCheck.snapshots.fixtures`;
4. parses R1 from `inputCheck.snapshots.r1`.

It does not reopen either semantic input. No hidden helper on the runtime path calls `loadFixtures` or `readFileSync` for fixtures/R1 after validation. A mismatch throws `C1-INVALID` with exit code 2 before parsing, schedule derivation, enumeration, or output assembly. The CLI cannot reach `writeOutputsAtomically` when `runSimulation` throws, so unvalidated input cannot produce normal simulator output. All four accepted digest pins are unchanged.

**Owned-snapshot verdict:** accepted. Hash, validation, and semantic consumption are bound to the same owned bytes. The prior Medium TOCTOU blocker is closed.

## Regression-test verification

The six added tests materially cover the intended fix:

- valid inputs are read exactly once and each returned snapshot hashes to its recorded digest;
- a mismatch withholds the unvalidated snapshot;
- malformed mismatching fixtures fail as `C1-INVALID` before parse/enumeration;
- backing files replaced immediately after their one read do not alter the consumed A bytes or A digests;
- fixtures/R1 buffers and digests are independent, and mutating either the reader's source buffer or one retained snapshot cannot alter another;
- ASCII JSON rows of 127 and exactly 128 bytes pass, while 129 bytes fails against the unchanged inclusive 128-byte cap.

The replacement test exercises the real `runSimulation` injection seam. Its reader obtains A, replaces the backing fixtures/R1 with B after each read, and then lets the full simulation complete. B is intentionally semantically different; nevertheless, the recorded hashes equal A, output bytes equal the baseline A run, each path is read once, and disk is proven to contain B afterward. This directly reproduces the original race boundary and proves the runtime no longer reopens the paths.

## Reproduced verification

- D2 focused tests: **55 total / 55 pass / 0 fail / 0 todo**.
- Offline aggregate: **5,155 total / 5,154 pass / 0 fail / 1 existing todo**. The todo is the pre-existing extreme-aspect-ratio containment gap and is not a failure.
- Two fresh clean simulator runs: both exit 0; their summary and witness files are byte-identical to each other and to retained `results/`.
- Exhaustive schedules: **52,308**, split **4,104 / 4,788 / 18,144 / 25,272**.
- Exhaustive outcomes: all four cells `A`; H2 and H5 `SUPPORTED` in every cell.
- Characterization: **36** D=30 schedules, `modelValid:false`, 36 V5 violations, 12 `INVALID_AMBIGUOUS`, `inferenceDrawn:"none"`.
- C6/N2: outcome `E`, `d_min="none"`, failing pair `P_C6~L_home`.
- Output sizes: `d2-summary.json` **98,819 B**; `d2-witnesses.json` **86,011 B**.
- Output digest: `e1d1b815ed351e6feba3e34822ba9895e54035158e685bfbe7f628f6d10bbb06`; companion digest: `75f0596f8a321fc417706c70e0c19ad7a360e92027ced1bab811155934789407`.
- `git diff --check`: clean.

There is no result drift. The hardened implementation reproduces the retained outputs byte for byte.

## Interpretation and scope

- H2/H5 remain mechanical support inside the declared synthetic model only. They do not establish historical C8 causality, a product defect, or live Viewer behavior.
- C6/N2 remains a synthetic non-discriminating result (outcome E); no accepted margin exists.
- D=30 remains model-invalid characterization outside the exhaustive domain and supports no inference.
- Historical C8 remains unresolved. T4 and all historical runtime logic are unchanged.
- No spec, harness, product, procedure, Viewer, browser, live-run, retry, record, or attempt-state scope entered this remediation.

## Checkpoint and next gate

**Checkpoint commit/push readiness:** ready. No further simulator, test, result, or spec correction is required before the D2 docs/research checkpoint. The complete uncommitted D2 package, its reviews/prompts, and the updated handoff can be checkpointed only under a separate explicit owner commit/push authorization.

**Exact recommended action after checkpointing:** request a separate owner authorization for **diagnostic-instrumentation specification/research only**. That work should define the request-correlated evidence needed to distinguish the unresolved historical C8/C6 mechanisms before any live diagnostic is considered. It must not run a live diagnostic, retry G2, issue/reset an authorization record, or change T4/C6/C8/harness/product/procedure behavior.
