# G2 D2-OFFLINE input-snapshot hardening — internal review

Baseline `53ea0a74b215b4a3c7463b8fe7da4bf783b8c8fb` (`main == origin/main`). Scope: `docs/research/2026-10-04-g2-d2-synthetic-transition/` only. Reviewer: independent read-only subagent; implementer cross-checked.

## Change
- `inputs.mjs`: `readSnapshot` / `readValidatedSnapshot` (one read via injectable `reader`, owned `Buffer.from` copy, SHA-256 from those bytes; bytes returned only when digest matches). `validateInputs` returns `snapshots` (validated bytes only) plus digest-only `records`.
- `simulate.mjs`: `runSimulation` parses fixtures and R1 from `inputCheck.snapshots`; no path reopen. Mandatory pinned digests unchanged.
- `machine.mjs`: trace-row cap check extracted to `assertTraceRowWithinCap` (inclusive `<=`, same semantics, same sole call site).
- `contract.mjs`: `loadFixtures` annotated TEST-ONLY.
- `infra.d2-test.mjs`: +6 tests (valid one-read; digest mismatch withholds bytes; mismatch fails C1-INVALID before parse; replacement-after-read consumes A; independent snapshots; 127/128/129 B row cap).

## Findings
- **Critical:** none. **High:** none. **Medium:** none.
- **Low 1 (fixed):** `loadFixtures` reopens its path; no production caller. Marked TEST-ONLY.
- **Low 2 (no action):** `JSON.parse` could throw bare SyntaxError, unreachable because pinned digests are mandatory and checked first.
- **Low 3 (accepted):** boundary test exercises `assertTraceRowWithinCap` directly, the sole insertion path.

## Verification
D2 tests 55/55 (was 49); `npm run test:offline` 5,155 / 5,154 pass / 0 fail / 1 todo; two clean runs byte-identical; digest `e1d1b815ed351e6feba3e34822ba9895e54035158e685bfbe7f628f6d10bbb06` unchanged (98,819 + 86,011 B); counts, cells, H2/H5, C6/N2 E, D=30 results unchanged; `git diff --check` clean; no change to spec, harness, `test/`, `src/`, `wwwroot/`, procedure, evidence.
