# G2 activation preparation — independent review

- **Date:** 2026-10-03
- **Scope:** the current uncommitted activation-preparation implementation and directly affected tests/documentation only
- **Baseline:** `main` = `origin/main` = `87dac9d63feab7b13e9b2dba2d9e7cba20d266ea`
- **Result:** **0 Critical / 0 High / 3 Medium / 6 Low**
- **Checkpoint verdict:** **requires one bounded implementation correction before commit**
- **Live state:** `G2_DUAL_COUNTER_GATE.resolved=true`; `LIVE_PATH_WIRED=false`; no authorization record, G2 attempts directory, G2 evidence, Viewer/fixture load, or live G2 execution

## Executive finding

The runtime gates, package-resolution binding, headless-shell selection, `T-same-target`, cleanup/PARTIAL correction, and isolated-copy test migration are mechanically sound. The prior shadow-package High is closed. One newly elevated Medium blocks the checkpoint: the pre-reservation O1 report prints environment values verbatim, so a credential-bearing `SELENIUM_REMOTE_URL` is copied into the operator log. The correction is harness/test-only: retain the refusal and source name, but redact the value in every printable failure/report surface. No procedure or evidence-schema change is needed.

The other two Mediums are non-blocking: the accepted local-environment TOCTOU residual and the scratch-copy flag-flip simulation, which is a gate on the later activation change rather than this dormant checkpoint.

## Verified repository state

| Item | Verified state |
| --- | --- |
| Repository | `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection` |
| Branch / HEAD | `main` @ `87dac9d63feab7b13e9b2dba2d9e7cba20d266ea` |
| Remote baseline | `origin/main` is the same commit |
| Working tree | dirty only in the activation-preparation harness/tests/support plus their prompt/internal review/handoff; no production/Core/Viewer Adapter/M4/Panel/OQ-1/host change |
| Procedure SHA-256 | `d1ccfde224b8ae76fe74b06c93abc532e6df9612933cafaa045053c8e2e45a75` (unchanged) |
| Harness SHA-256 | `c9ba6a54d754a00c1afc1bb417d434b7fd84ced9736dad5e29e86add2eeae649` (uncommitted working-tree value) |
| Gates | dual-counter resolved; live path false |
| Live artifacts | no G2 authorization record, reservation, attempts directory, or live evidence |
| Local runtime | Node `v26.10.0`; Playwright and playwright-core `1.62.1` |

The real read-only resolver rejects this shell with `runtime-version-mismatch` at `node-version`, while still detecting the expected Playwright packages and headless-shell descriptor. No browser was imported or launched by that check.

## Findings

### Critical

None.

### High

None. The internal review's package-shadow High is closed: the resolver uses the harness module's `import.meta.resolve('playwright')`, realpaths the result, and requires it to be inside the gated repository `node_modules/playwright`. A nested `playwright-core` beneath that package is refused, so the later package cannot select a second unchecked Core copy. The shadow-copy tests exercise both `test/acceptance/node_modules` and `test/node_modules` using isolated harness copies.

### Medium

#### M1 — printable runtime-gate evidence can disclose remote-browser credentials (checkpoint blocker)

At harness lines 338–339, a non-empty `SELENIUM_REMOTE_URL` is interpolated into the failure message. At lines 423–433, every captured environment value and every failure message is printed to stderr/O1. A value such as `https://user:secret@host/wd/hub?token=...` therefore appears verbatim in the retained operator log. The runbook expecting the variable to be unset does not protect a workstation that already has it set; the refusal itself is specifically designed to diagnose that case.

This does not create a false PASS and occurs before reservation, but it is an evidence-confidentiality defect. Minimum correction:

1. Keep `SELENIUM_REMOTE_URL` as a fail-closed pre-reservation refusal.
2. Print only `unset` / `set (redacted)` for that source, and remove the raw value from its printable failure message.
3. Add a test with userinfo/query credentials proving neither the report nor thrown message exposes them.
4. Recompute the harness SHA and rerun the focused/aggregate gates.

The accepted plan's requirement to report detected values can be satisfied by reporting the source's set/unset state; no procedure or R1 schema amendment is necessary.

#### M2 — gate-to-import/launch TOCTOU (accepted non-blocking residual)

The package metadata, descriptor, install marker, and executable are checked before W2. A concurrent local mutation can occur before the later import/launch. The strict post-launch `browser.version()` catches Chromium version drift after the record is spent, but a Playwright package replacement after the gate is not re-read.

Under the accepted local-operator threat model this is non-blocking. Do not add hashes or a second package check now. Before live execution, the operator must use the committed clean checkpoint, perform no concurrent package/browser install, and keep the execution environment stable from preflight through launch. Revisit only if adversarial local mutation enters scope.

#### M3 — full scratch-copy flag-flip simulation remains a later activation gate

The new helper is tested in both forced-false and forced-true isolated copies, and the static guard catches planted real-harness/spawn/pin violations. That supports the architecture, but it is not the same as running the complete offline suite against a scratch checkout whose harness literal and sole pin are both changed to true.

This simulation is **not required before the dormant activation-preparation checkpoint**. It is required in the separately authorized activation change, before accepting `LIVE_PATH_WIRED=true`: make a disposable checkout/copy, change only the harness literal and single pin, run focused G2 plus the offline aggregate, and prove the real repository and attempts/auth paths remain untouched.

### Low

1. The nested-Core, `SELENIUM_REMOTE_URL`, and Darwin/Apple-CPU refusals are safe hardening implied by binding the actual Playwright target, but the live-plan runbook does not list all three. Add their operator checks in a later plan/runbook documentation correction before record issuance; they do not block this harness after M1 is fixed.
2. The plan says a Phase-0 mismatch appears in journal detail and R1 `runtimeEnvelope`, but procedure-correct Phase-0 failure creates no R1. The harness correctly retains it in `PREFLIGHT_FAILED` detail/in-memory output; this is a plan wording correction, not a procedure or implementation defect.
3. `ownershipRemains()` still treats falsy non-booleans as resolved. Every wired probe returns a boolean or throws, so no current illegal PARTIAL is reachable; hardening to exact booleans is optional and outside this diff.
4. Exact `realpath(E) === E` rejects roots with symlinked ancestors. This is stricter than Playwright but is explicitly required by the accepted plan and matches the intended default install.
5. Requiring `process.arch === 'arm64'` rejects a Rosetta/x64 Node even if Playwright could infer an Apple host. This is plan-literal and consistent with the accepted runtime envelope.
6. Custom Node loaders/hooks remain operator-environment territory. No evidence in the current repository shows a bypass under the accepted controlled local execution model.

## Dimension adjudication

### Runtime gates and ordering

Conforms, subject to M1's logging fix. `main()` performs W0 and the live/dual-counter interlocks, then W1 record validation and startup scan, then `checkG2HardRuntimeGates`, and only afterwards constructs the binding, creates the attempts directory, reserves `AUTH_BOUND`, imports Playwright, launches a browser, and eventually writes `ATTEMPT_CONSUMED`. Mismatch/unreadable values therefore leave the authorization record unspent. The gate itself exposes only four read operations and contains no import, require, spawn, exec, write, or executable invocation.

Exact enforced values are Node `v22.23.1`, Playwright `1.62.1`, playwright-core `1.62.1`, and `chromium-headless-shell` descriptor revision `1234` / version `151.0.7922.34`. The headed Chromium bundle is not accepted as a substitute.

### Browser-root and headless-shell resolution

Conforms. Source precedence is `PLAYWRIGHT_BROWSERS_PATH`, `npm_config_playwright_browsers_path`, then `npm_package_config_playwright_browsers_path`; a first defined empty value selects the default cache root. Conflicting non-empty sources, `0`, relative/non-normalized roots, local-browser ambiguity, PWDEBUG sources, and platform override fail closed. Marker/executable existence, type, non-symlink realpath, size, and execute permission are checked read-only.

The three extra refusals are non-blocking hardening:

- nested playwright-core: necessary to keep the checked Core package authoritative;
- `SELENIUM_REMOTE_URL`: necessary because a bare launch would otherwise use a remote browser rather than the checked executable;
- Darwin release/Apple CPU: mirrors Playwright's platform-token choice and prevents checking an arm64 path that Playwright would not select.

They can reject environments outside the single accepted target, but not a conforming target. Their documentation should be reconciled before authorization-record issuance.

### `T-same-target`

Closed. The oracle is `playwright-core/lib/coreBundle` → `registry.registry.findExecutable('chromium-headless-shell').executablePath()`, never public `chromium.executablePath()`. Every plan case is explicitly accepted or rejected; accepted cases compare exact paths, rejected cases verify pre-reservation refusal only. All cases execute in isolated roots and the real live path remains dormant.

### Cleanup ownership and PARTIAL

Closed. Missing, throwing, or absent ownership probes set `ownership:'indeterminate'` and `cleanupUnresolvedOwnership=true`; row 2 also independently rejects any failed step whose ownership is not exactly `resolved`. Row 7 accepts cleanup-related PARTIAL only when every failed step is resolved. C20 `NOT_EVIDENCED` remains a legal PARTIAL cause. Verdict names, exit codes, journal semantics, and closeout ordering are unchanged.

### Activation/pinning migration

Conforms. There is one deliberate pin of the real harness's current `LIVE_PATH_WIRED=false`. Other scenarios use forced copies rooted outside the repository. CLI tests spawn only those copies, paths are confined, and static guards detect direct real-main use, real harness spawning, default-root authorization scans, or literal flag rewrites. This is sufficient for the dormant checkpoint; M3 remains the acceptance test for the later flip itself.

### Evidence and identity

The current fixed R1 and binding whitelists cannot carry every root/D/E/descriptor detail. O1 is sufficient for these pre-reservation diagnostics under the accepted plan once sensitive values are redacted; none is required to become verdict-authoritative. Adding fields would require a deliberate procedure/schema revision and is not justified here.

Executable SHA remains unnecessary. The current contract proves package/install provenance and availability before reservation and runtime version after launch. This implementation adds no evidence that a machine-specific binary hash would improve the accepted model enough to justify reinstall fragility.

The post-launch check is exact: `browser.version() === '151.0.7922.34'`. A mismatch throws inside Phase 0 before context creation, writes `PREFLIGHT_FAILED` best-effort, returns FAIL/exit 1, leaves `consumed:false`, and spends the authorization because reservation/`AUTH_BOUND` already exists. No retry is legal. This matches the procedure's distinction between record spend and attempt consumption.

### Procedure consistency

No semantic change was found to reservation, `AUTH_BOUND`, `ATTEMPT_CONSUMED`, `PREFLIGHT_FAILED`, cleanup ownership, row precedence, or evidence authority. The procedure file is byte-unchanged. The only documentation mismatch is the Low plan statement about R1 existing on Phase-0 failure.

## Reproduced verification

| Verification | Independent result |
| --- | --- |
| Focused G2 | 901/901 pass |
| activation / authorization / preflight / journal / CLI / gate | 11 / 26 / 7 / 35 / 11 / 19 pass |
| runtime-gates | 58/58 pass |
| live-path-isolation | 11/11 pass |
| `npm run test:offline` | 5,147 total; 5,146 pass; 0 fail; 1 existing todo |
| `git diff --check` | clean |
| real side effects after tests | no G2 attempts directory, authorization record, or G2 evidence created |

The first focused run under the review sandbox failed four mutation tests only because the sandbox denied their temporary repository file. The same canonical command was rerun with the required filesystem permission and passed 901/901; this was not a product/test failure or a retry of live work.

## Readiness and authorization

- **Activation-preparation checkpoint commit:** not ready. Fix M1, rerun verification, independently confirm the bounded fix, then recompute the harness SHA. Keep `LIVE_PATH_WIRED=false`.
- **Later live-flag activation:** not ready and not authorized. Prerequisites are the accepted M1 correction and clean checkpoint commit, exact Node `v22.23.1`, recomputed committed harness SHA, scratch-checkout flip simulation, the one pin update, and a separate independent activation review.
- **Authorization-record preparation:** not ready. It may begin only after the clean activation checkpoint and accepted flag-activation change, with the final committed HEAD/procedure/harness/fixture digests. Never bind the current uncommitted harness SHA.
- **Live G2:** not ready and unauthorized. Record issuance and exactly-one live execution remain separate later owner gates.

## Recommended next action

Authorize one bounded activation-preparation correction that redacts `SELENIUM_REMOTE_URL` from printable O1/failure output, adds a credential-bearing negative test, reruns the specified offline gates, and updates the harness SHA. Do not change the procedure, plan, live flag, authorization state, or production code in that correction.
