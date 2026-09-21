# Federated Clash Test core — P0 independent implementation review

- **Review date:** 2026-09-21
- **Repository:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`
- **Branch:** `feature/federated-clash-test-core-engine`
- **Implementation checkpoint:** `be1e8ddac6122411d7ccf539e80570ab20b0f6fb`
- **Reviewed at HEAD:** `e72dde18ebdd26b6d62575d6eb601585aca3b1c5` (the one later commit changes `CLAUDE.md` only)
- **Scope:** P0.1–P0.7 production modules, shared test support, P0 tests, phase acceptance record, and the P0 internal Codex review
- **Excluded by design:** P0.8 / calibrated defaults (G-CAL), P1+, Viewer/adapter work, and every other gated package

## Verdict

P0.1–P0.7 are substantially implemented as planned. The checkpoint has **0 Critical, 0 High, 1 Medium, and 1 Low finding**. The Medium finding is a fail-closed contract gap in the canonical JSON utility, but it does not currently corrupt a production path: every planned production caller supplies captured, normalized, or engine-built plain data. It should be corrected before an external or less-disciplined caller can treat `canonicalJson` / `digestCanonical` as their own validation boundary.

The P0 checkpoint may proceed to the repository-required targeted adjudication. P1 must not begin from this review alone: `CLAUDE.md` requires adjudication of the independent findings and gate verdict, and the handoff separately requires explicit owner/session go-ahead for P1.

## Findings

### Medium — Canonicalization silently projects non-data own properties instead of rejecting them

**Location:** `clashtest/util/canonical.js`, `chunks`, object branch (current lines 41–50); phase interface summary says `canonicalJson` / `canonicalChunks` throw `TypeError` on anything that is not plain JSON data.

The object branch uses `Object.keys(value)` and then reads `value[key]`. Consequently:

- a symbol-keyed own property is silently omitted;
- a non-enumerable own property is silently omitted;
- an enumerable accessor is invoked instead of being rejected as non-data.

Concrete reproduction against the checkpoint:

```js
const s = Symbol('hidden');
digestCanonical({ x: 1 }) === digestCanonical({ x: 1, [s]: 2 }); // true
```

**Failure mode:** two distinct JavaScript objects outside the documented plain-data domain can receive the same durable digest, and an accessor can execute during canonicalization. This weakens the utility's advertised fail-closed boundary and leaves correctness dependent on every caller remembering to capture/normalize first.

**Current impact:** bounded. P1's use is test-local and engine-built; P2 normalizes definitions into a fresh canonical form; P3/P5/P7/P8 plan to digest closed engine-owned projections or validated values. No current production caller accepts an external object directly into this utility.

**Minimum correction:** in the object branch, enumerate own keys with `Reflect.ownKeys` once; reject symbol keys; obtain each own descriptor once; reject accessors and non-enumerable properties (or explicitly define and test non-enumerable-property semantics); recurse only on `descriptor.value`. Add regression tests for symbol-keyed, non-enumerable, and accessor properties, including digest-collision and “getter not invoked” assertions. Conforming canonical bytes and all existing golden vectors remain unchanged.

### Low — `captureData` validates callback presence but not the complete callback contracts

**Location:** `clashtest/util/capture.js`, option validation and per-path limit resolution (current lines 97–109, 163–164, 194–195).

`rootGate` is accepted when it has a callable `check`, even when `key` is absent or not a string. Likewise, `stringLimitFor` / `arrayLimitFor` are validated as functions, but a `NaN` or negative return silently disables the corresponding comparison for that path. Probes with a missing `rootGate.key` and callbacks returning `NaN` capture successfully instead of rejecting the malformed internal configuration.

**Failure mode:** a future internal adapter can accidentally disable schema-first gating or a per-path size bound through a malformed configuration. This is not triggered by untrusted data itself; all current/planned call sites are repository-controlled and specify literal keys/valid numeric limits.

**Minimum correction:** require `rootGate.key` to be a string and validate every non-`undefined` callback result as a non-negative number (integer where the bound counts code units/items; `Infinity` may remain allowed if intended). Add tests proving invalid configurations fail before the root is read.

## Confirmed sound areas

- Error catalogue and typed-field shapes match the P0 plan; persisted/listing errors strip values and cap issue pairs.
- Option ownership, defaults, hard ceilings, derived defaults, cross-field rules, and the producer/reader invariant are implemented and drift-tested. Defaults remain visibly provisional under G-CAL.
- Detached capture is iterative and descriptor-based, rejects accessors/symbols/holes/cycles/non-plain values, bounds nodes before allocation, enforces the unknown-field byte budget before copying, and does not invoke raw-value getters.
- SHA-256 matches FIPS/`node:crypto` vectors; canonical bytes for conforming plain data match the frozen rules; synchronous and sliced digests agree.
- Slicing observes time at the required cadence, has a secondary item ceiling, records spans, supports cancellation after yields, and provides stable sliced sorting.
- Production `clashtest/` code has no `collision/` import. Test-side collision imports are limited to the planned drift/error checks.

## Verification

- Targeted P0 suite: **108 passed, 0 failed**.
- Full repository runner (`node scripts/run-tests.mjs`): **1,234 total; 1,230 passed; 3 failed; 1 todo**. All three failures are the pre-existing M4 spike-server tests failing to bind `0.0.0.0` with sandbox `EPERM`; no P0 test failed. The committed checkpoint's reported unsandboxed result remains 1,233 pass / 0 fail / 1 todo, but that network-binding portion could not be independently reproduced in this restricted environment.
- `npm test` itself could not be used read-only because its pretest rewrites `wwwroot/vendor`; the write was blocked. The repository runner was invoked directly instead.
- `git diff be1e8dd^ be1e8dd --check`: passed.
- Working tree was clean before this review artifact and handoff update.

## Gate disposition

- No Critical/High defect blocks the P0 checkpoint.
- The Medium canonicalization finding should be targeted in adjudication and either fixed in P0 or explicitly accepted as an internal precondition with a test that pins the allowed domain.
- The Low capture-option finding may be fixed with the same bounded hardening pass or carried as a named internal-API obligation.
- Per `CLAUDE.md`, the next action is a **targeted adjudication of these two findings, the checkpoint boundary, the test evidence, and this gate verdict**. Do not start an unrestricted second implementation review.

`P0 checkpoint ready for targeted adjudication`
