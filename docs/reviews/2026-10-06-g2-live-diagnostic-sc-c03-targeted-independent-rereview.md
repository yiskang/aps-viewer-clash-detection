# G2 live-diagnostic SC-C03 correction: targeted independent re-review

- **Date:** 2026-10-06
- **Scope:** the uncommitted SC-C03 bounded offline correction in `docs/research/2026-10-06-g2-live-diagnostic-preparation/`, its directly affected internal review and handoff, and the committed authorities needed to verify protected state.
- **Baseline verified:** `main == origin/main == f3bab74f460eacd6b6f69bc8fb90110455ceeb68` before this review was written.
- **Verdict:** **ready to checkpoint** — 0 Critical / 0 High / 0 Medium / 1 Low. The prior blocking SC-C03 Medium is closed. No package correction is required before the checkpoint.
- **Boundary:** no package file, real harness, accepted procedure, product source/test/config, immutable evidence, D2 checkpoint, diagnostic checkpoint, authorization state, Viewer/browser state, or G3 artifact was modified or executed by this review.

## 1. Findings

### Critical

None.

### High

None.

### Medium

None.

### Low

#### L1 — P5.10 does not cross-check manifest identity fields against the authoritative run identity

- **Location:** `prototype/manifest-builder.mjs` metadata validation and `prototype/closeout.mjs` `p510Check`; Part 2 Appendix (v) manifest schema.
- **Reproduction:** after `MANIFEST.json` was written, changing only its valid-format `runId` to `other-valid-run` produced no P5.10 finding and still committed `WITHHELD`. The closeout retained the correct `runId` and remained independently valid; the commit record still bound the actual final manifest hash and the correct authorization/attempt identity.
- **Impact:** this cannot mutate A/B, promote either analysis, change `WITHHELD`, manufacture a diagnostic verdict, refund the attempt, or authorize a retry. It can leave a contradictory manifest identity that weakens independent cross-artifact auditability.
- **Disposition:** acceptable at this design/preparation checkpoint. Add an explicit manifest-to-run/closeout identity equality gate and mutation test in the future implementation plan/harness gate, before any diagnostic harness is accepted for live use. It is not a reason to expand this bounded correction or repeat the SC-C03 design cycle.

## 2. Baseline and protected state

- Repository/branch/commit are `aps-viewer-clash-detection`, `main`, and `f3bab74f460eacd6b6f69bc8fb90110455ceeb68`; `origin/main` resolves to the same commit.
- Acceptance harness SHA-256 remains `cc8868cd68b9c2c3382297070289a2aa165c74249c6d82896d76bacc6c6ef09b`; accepted procedure SHA-256 remains `d1ccfde224b8ae76fe74b06c93abc532e6df9612933cafaa045053c8e2e45a75`.
- All three historical authorization records are tracked. `75a3ccb9` is spent/consumed; `8a8d49f6` and `dbd97137` are superseded. No active authorization or new record exists.
- Immutable evidence, the D2 checkpoint, and the diagnostic-instrumentation checkpoint are unchanged. Historical G2 remains `FAIL (row 3)`; C6 remains `NOT_EVIDENCED`; C8 remains unresolved; real T4/C6/C8 behavior is unchanged.
- The pre-review working tree contained only the uncommitted package, its two prompts, its internal/prior independent reviews, and the handoff edit. There is no production, acceptance-harness, accepted-procedure, immutable-evidence, D2, diagnostic-checkpoint, authorization-state, or G3 diff.

## 3. Reproduced verification

| Gate | Independent result |
|---|---|
| Package preparation tests | **146/146 pass**, 0 fail |
| D2 tests | **55/55 pass**, 0 fail |
| Diagnostic-instrumentation tests | **72/72 pass**, 0 fail |
| Offline aggregate | **5,155 total / 5,154 pass / 0 fail / 1 existing todo** |
| Prototype run A | exit 0; **14/14** gates |
| Prototype run B | exit 0; **14/14** gates |
| Byte comparison | fresh A = fresh B = retained `results/` |
| Scenario distribution | 70 total: 7 SUPPORTED / 1 REJECTED / 14 INCONCLUSIVE / 47 INVALID / 1 BLOCKED |
| `git diff --check` | clean before review writes |

The first diagnostic invocation was started concurrently with the full offline aggregate and was manually interrupted while its full deterministic pipeline was still pending. A clean standalone invocation then completed once, without retrying any live operation, and passed 72/72. No Viewer, browser, model, authorization record, or live attempt was involved.

Verified retained hashes:

- `results/results.json`: `b3fb9ef2718910a41a5fdb8fa86223a860419f97da61d6d4a449233558239cfc`
- `results/SHA256SUMS`: `8b1cd4e0e6b4d66e972337f9afe380ab11c09d9185ed26aec5566aea7fbf3717`
- `results/sc-c03/SC-C03-CLOSEOUT.json`: `30acf5bea173aac3ca0b2e8fed1689ed0cf3b681437a83a0938c5e35f76aa78b`

## 4. SC-C03 structural correction

**Accepted.** The design and prototype now enforce the same structure:

1. scratch A and B are written, hashed and compared as exact bytes;
2. both scratch stores are sealed before subsequent processing and remain byte-unchanged;
3. mismatch publishes neither A nor B and creates no `derived/*` or `TERMINAL-VERDICT.json`;
4. a separate canonical `SC-C03-CLOSEOUT.json` is written as the authoritative terminal carrier;
5. P5.10 recomputes it from retained A/B and the authoritative inputs, so post-comparison A/B mutation fails as `SC-B07` and commits `INVALID`.

The adversarial tests mutate A or B after comparison, tamper the closeout/manifest/ledger/file set, and exercise both the normal `WITHHELD` path and fail-closed `INVALID` path. The original contradiction—rewriting A after comparing it—is gone structurally, not just in prose.

## 5. Closeout artifact and A/B immutability

**Accepted.** `SC-C03-CLOSEOUT.json` retains sorted A/B file tables, both bundle SHA-256 values, bounded differing-path records, `SC_C03_AB_MISMATCH`, `WITHHELD`, `promotion.eligible=false`, null promoted/authoritative analysis fields, consumed-attempt/retry state, run identity, and raw-input/provenance digests.

Serialization is canonical UTF-8 with no trailing newline, timestamp, absolute path, or evaluator output. The retained artifact is 2,837 bytes, below the 262,144-byte cap, has a stable path, and is independently hashable. A/B are specified as retained read-only scratch trees outside the run root; the prototype models sealing and byte preservation. The future harness must implement the specified scratch ownership and retention path, but no additional design correction is needed.

## 6. Manifest, terminal carrier, and freeze order

**Accepted.** On mismatch:

- `MANIFEST.json` has exactly one terminal carrier, `SC-C03-CLOSEOUT.json`, and binds its digest;
- manifest and commit record say `WITHHELD`; the journal remains `CLOSEOUT_STARTED`;
- no successful-promotion files or metadata survive;
- ordering is A → B → hash → compare → closeout → manifest/terminal metadata/final hashes → P5.11 freeze → P5.12 external commit;
- the commit record hashes the final frozen manifest bytes, including on the P5.10/`INVALID` path.

The stale-manifest High is closed by the final-bytes hash plus regression coverage for three failure paths. No required run-root write occurs after freeze.

## 7. Documentation reconciliation

- **P5.12 cleanup:** accepted. Current P5.11 references identify run-root freeze; commit-record wording consistently uses P5.12. No stale commit-at-P5.11 statement remains in the package.
- **Appendix (v):** accepted. It explicitly records the P5.10 failure exception: the external `INVALID` commit is authoritative while its `manifestSha256` always hashes the manifest bytes actually frozen.
- **Global null rule:** accepted. The allow-list includes exactly the SC-C03 closeout promotion fields `promotedAnalysis` and `authoritativeAnalysis`; it does not introduce a general permissive-null rule.
- **`withheldBy: "SC-C03"`:** remains non-blocking. It exists only in the offline scenario evaluator's effect model. The normative mismatch path has no `TERMINAL-VERDICT.json`; the separate closeout carrier is authoritative, so the label cannot be confused with A/B mutation or promoted evidence.

## 8. Accepted-area drift and verdict semantics

**No drift found.** Part 1 v5 and Part 2 v4 remain the package versions. The minimum remains `ID-ON + P-FRM + P-TC + V-PEND + V-EDGE`; limits remain 24,576 events and 6,400,000 bytes. Capture, pending-gap, controls, VB-3 limitation, target-plan binding, verdict B (`prepared, currently not worthwhile`), and OD recommendations are unchanged.

SC-C03 mismatch mechanically blocks promotion and yields `WITHHELD`; evidence and exact A/B bytes remain preserved; the attempt remains consumed; `retryAuthorized=false`; no acceptance retry semantics are introduced. The 70-scenario distribution is unchanged.

## 9. Internal-review adjudication

The internal targeted review's 1 High and 2 Medium findings are closed:

- stale commit `manifestSha256`: fixed and regression-tested;
- Appendix (v) P5.10 exception: reconciled;
- null scope for the two closeout promotion fields: reconciled.

Its documented `withheldBy` Low is correctly non-blocking. This independent review adds only L1 above. Final independent count: **0 Critical / 0 High / 0 Medium / 1 Low**.

## 10. Readiness and authorization

**Checkpoint readiness: ready to checkpoint.** The prior SC-C03 blocking Medium is closed and no blocking Critical, High, or Medium remains. The manifest-identity cross-check may remain deferred to the future implementation-plan/harness acceptance gate, where it must be made explicit before live use.

**Exact next owner action:** authorize one scoped checkpoint commit/push of the future live-diagnostic design/preparation package, its two package prompts, internal and independent reviews, and the handoff. Do not authorize a Viewer diagnostic, G2 retry, new/reset authorization record, runtime implementation, accepted-procedure/product/harness change, or G3.
