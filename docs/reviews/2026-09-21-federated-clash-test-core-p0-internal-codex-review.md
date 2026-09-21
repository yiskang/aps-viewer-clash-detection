# Federated Clash Test core — P0 internal Codex review (targeted)

- **Date:** 2026-09-21 · **Branch:** `feature/federated-clash-test-core-engine` · **Scope:** P0 foundations only (`clashtest/util/capture.js`, `clashtest/options.js`), per project `CLAUDE.md` targeted-review rule. No spec/plan-architecture question was raised or reopened.
- **Tool:** `codex-review` (independent `codex-worker`), effort `medium`, one pass per file. Requests: `20260921-133733-50295-1893` (`security`, `capture.js`), `20260921-133735-50793-24802` (`code`, `options.js`). Raw responses live in the gitignored `.codex-worker/responses/<id>/response.md`; the findings and dispositions are recorded here.
- **Why these two files:** they are the P0 trust-boundary code (untrusted-input capture; the hard-ceiling authority). `errors.js`, `canonical.js`, `slicer.js` and `test/clashtest/support/` were not reviewed by Codex (plan-verbatim, covered by their tests, and checked against FIPS/`node:crypto` vectors in the phase's own tests).

## Findings and dispositions

| # | File | Severity (Codex) | Finding | Disposition |
|---|---|---|---|---|
| C1 | `capture.js` | Medium | Malformed limit options (`maxIssues: 0`, `NaN` depth/string/key/array limits) disable enforcement; `maxIssues: 0` returned `ok: true` for a truncated capture. | **Accepted, fixed.** Options validated before the root is read (`TypeError`, like the existing `maxNodes` check). Test: `malformed limit options throw before the root is read …` (fails on the original, passes now). No current caller passes such values — latent hardening. |
| C2 | `capture.js` | Medium | An over-long / hostile key was escaped and joined into the diagnostic path *before* the `maxKeyLength` check. | **Accepted, fixed.** Check precedes the join; over-long keys are reported at the parent pointer; symbol descriptions truncated to 64 units (existing `symbol-key@/s` behaviour preserved). Test: `an over-long or hostile key is never copied whole into a diagnostic path`. |
| C3 | `capture.js` | Medium | Synchronous traversal at the 16 M-node default / `Reflect.ownKeys` cost is an availability boundary. | **Deferred — already recorded.** This is the G-CAL / AC-12 calibration item (plan P0.8, "Gates and open items"); defaults stay provisional. No change. |
| C4–C6 | `capture.js` | Low | `deepFreeze*`/`isDeepFrozen` read via `v[k]` (trusted plain data only); descendants mutable while `deepFreezeSliced` yields; captured objects have `Object.prototype`. | **Not applied (documented non-goals for P0).** The helpers' contract is detached captured / engine-built data (plan interface summary); exclusive ownership during sealing is P5's sealing design; own-property discipline is required of P2/P5 validators. Carry to P5 review: never publish a draft before `deepFreezeSliced` resolves. |
| O1 | `options.js` | High (Codex) | Spec tables only shallow-frozen; an importer could raise a hard ceiling. | **Accepted, fixed** (nested specs and enum arrays frozen). Test: `the spec tables are deeply frozen …`. (Codex's "High" is same-realm tampering; fixed because it is a one-line hardening of the ceiling authority.) |
| O2 | `options.js` | High (Codex) | `key in values` mistakes an inherited (polluted) name for a resolved option. | **Accepted, fixed** (`Object.hasOwn`). Test: `an inherited property named like an option …`. |
| O3 | `options.js` | Medium | Supplied `limits` argument unvalidated; `resolveRunOptions(undefined, {})` made the producer/reader invariant vacuously true. | **Accepted, fixed** — a supplied `limits` is re-resolved through `resolveEngineLimits` (idempotent for resolved limits; `{}` = defaults). Test: `a supplied limits argument is validated …`. |
| O4 | `options.js` | testing gap | Unknown-key issue paths not JSON-pointer escaped. | **Accepted, fixed** (RFC 6901 escape). Test: `unknown-key issue paths are JSON-pointer escaped`. |

All six new tests were confirmed to **fail against the plan's original code** and pass against the hardened code (mutation check). The fixes are implementation-level hardening inside P0 modules; **no signature, export surface, default value or spec/plan contract changed** (the five-name `capture.js` export test and the drift/invariant tests still pass).

## Deviation from the plan's code sketch (recorded)

`capture.js` and `options.js` differ from the verbatim blocks in `p0-foundations.md` by the changes above; their test files gained 2 + 4 tests (capture 29 → 31; options 16 → 20; P0 suite 102 → 108). The phase file's counts are historical plan-time counts; the acceptance record in the plan carries the implemented counts. The phase-file sketches were **not** edited (the plan is the accepted artifact; this record is the delta).

## Not reviewed / out of scope

No second review round was run (no finding re-opened an architectural question, per the convergence rule). The Low items C4–C6 and the deferred C3 remain open notes for P5/G-CAL.
