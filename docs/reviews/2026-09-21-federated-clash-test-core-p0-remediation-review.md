# Federated Clash Test core — P0 remediation checkpoint review

- **Date:** 2026-09-21
- **Reviewed checkpoint:** `92fcd20a91a997ce81a38d17fdc7a7e81f5f665b` (`fix(clashtest): P0 review remediation (canonical own-property domain, capture option validation)`)
- **Branch:** `feature/federated-clash-test-core-engine`
- **Scope:** targeted review of the two adjudicated P0 findings and the directly related array-own-property gap. This is not a new unrestricted P0 review.

## Verdict

**PASS — no unresolved finding in the reviewed remediation scope.** The prior Medium canonicalization-domain finding and Low capture-option finding are resolved. P0.1–P0.7 remains accepted. P0.8 remains blocked by G-CAL. This review does not authorize P1; the handoff's explicit owner/session go-ahead remains required.

## Finding verification

### 1. Canonical own-property domain — resolved

The object encoder now enumerates all own keys, rejects symbol keys, rejects non-enumerable properties and accessors, and recurses only through data-descriptor values. Accessor getters are not invoked. Key sorting and valid plain/null-prototype object output remain deterministic.

The related array gap is also closed: the encoder reads `length` once from its descriptor, requires exactly the dense index-key set plus `length`, rejects symbol/named keys, sparse arrays, accessors and non-enumerable elements, and reads element values from descriptors. Proxy regression coverage pins both the key-substitution and shifting-`length` cases, including the sliced digest path.

**Failure mode removed:** distinct values can no longer collapse to the same canonical bytes merely because a symbol, non-enumerable property or array extra property was silently omitted; canonicalization cannot execute an input getter.

### 2. Capture option validation — resolved

`rootGate` now requires a string `key` and a callable `check` before traversal, so a malformed gate cannot silently read the wrong property. Per-path string/array limit callbacks may return `undefined` to use the fixed cap or a number greater than or equal to zero; `NaN`, negative values and non-numbers fail closed through the traversal's existing `unreadable` path. Zero, `Infinity` and fallback behavior are explicitly tested.

**Failure mode removed:** malformed callback results can no longer disable a capture bound through JavaScript comparison behavior. The established callback-failure contract remains `ok:false` with an `unreadable` issue rather than a caller-visible throw.

## Boundary and verification

- The checkpoint's production changes are limited to `clashtest/util/canonical.js` and `clashtest/util/capture.js`; regression changes are limited to their two test files. The remaining checkpoint files are the prior review, its adjudication and the operational handoff.
- `node --test test/clashtest/*.test.mjs test/clashtest/util/*.test.mjs` → **112 tests, 112 pass, 0 fail, 0 skipped/todo**.
- `git diff --check HEAD^ HEAD` → clean.
- No P1 implementation is present in the checkpoint, and no frozen design or implementation-plan contract was changed.

## Gate result

`P0 remediation checkpoint accepted; no Critical, High, Medium or Low finding remains in the targeted remediation scope.`

The next transition is unchanged: P1 may begin only after the explicit owner/session go-ahead required by the current handoff. P0.8 remains G-CAL-blocked, and all separately gated Viewer, host-integration, remote-persistence, calibration, responsiveness and M4 Phase 4 work remains outside this checkpoint.
