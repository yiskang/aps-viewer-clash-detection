# G2 live execution PLAN (planning artifact — NOT execution authorization)

- **Date:** 2026-10-02
- **Status:** PLAN ONLY. Authorizes nothing. Awaiting independent ChatGPT Work review, then explicit owner authorization for (a) activation, (b) single-use authorization-record issuance, (c) exactly one live G2 execution.
- **Scope guard:** no authorization record exists or is issued here; `LIVE_PATH_WIRED=false`; no attempt reserved/consumed; APS Viewer and fixtures not loaded; no production code changed.
- **Authorities:** accepted procedure `docs/research/2026-09-30-g2-viewerbridge-dockingpanel-live-verification-procedure.md` (SHA below; §4.1 activation/authorization/journal, §4.7 Table T, §8 verdicts, §9.1 closeout, §10 evidence, §11 runbook, §12 D2). Harness `test/acceptance/clashpanel-viewerbridge.acceptance.mjs` ("H" below; **H line references are at the current activation baseline `7ae4147b726e20b8183f0522ffabf61ab75895d6` unless individually commit-qualified or labelled historical; the symbol/constant name is always the authoritative locator**). Where this plan and the procedure/harness disagree, the procedure/harness win. Where the procedure and the harness disagree with each other, the **procedure governs**: the plan states only procedure-valid verdicts, and any harness divergence (G-8) must be closed by **mechanical harness conformance before activation** — owner adjudication/acceptance of the divergence is **not** a permitted resolution (it would require a procedure amendment, re-acceptance and a new procedure SHA). *Remediation 2026-10-02 (owner-authorized, plan-only): §3, §4, §6.10-11, §8, §9, §11-§12 corrected per the independent Work review (H1 PARTIAL contradiction; M1 runtime hard gates).* *Second remediation 2026-10-03 (owner-authorized, plan-only): the Chromium pre-reservation gate now binds the actual default-headless `chromium-headless-shell` runtime, not the headed `chromium` bundle — §3, §3.1, new §3.2, §6.1/§6.4/§6.10, §9 step 0, §10, G-9 (targeted independent re-review M1).* *Third remediation 2026-10-03 (owner-authorized, docs-only): activation instructions (§1, §9, G-2, G-15) aligned to the independently verified two-edit activation. Final drift correction 2026-10-03 (owner-authorized, docs-only): §3/§3.1/§3.2, §8, §9 step 0, §11 (G-7/G-8/G-9/G-14/G-15) and §12 reconciled so that work already completed and independently accepted in committed checkpoint `7ae4147` is no longer presented as a future prerequisite; the unsupported `g2-live-authorization.md` filename prohibition is removed; baseline wording reconciled (targeted independent re-review M1/L1/L2). No technical behavior of the accepted runtime gates, cleanup/PARTIAL conformance, `T-same-target`, authorization or attempt semantics is changed.*

## 1. Accepted baseline identities (current activation baseline `7ae4147`; original 2026-10-02 planning values are labelled historical)

| Item | Value |
| --- | --- |
| Branch / HEAD | **Current activation baseline:** `main` @ `7ae4147b726e20b8183f0522ffabf61ab75895d6`; `main == origin/main`. *Historical:* the original planning pass (2026-10-02) was verified at checkpoint `996305c3efc30021180e04099e6007cc1d9afa5f`, which is **not** the activation baseline. |
| Working tree | *Historical (at `996305c`):* clean at baseline except untracked `docs/prompts/for-claude-g2-live-planning-only.md` (the `?? docs/prompts/` exception, H:7484); this task adds only untracked planning/review artifacts and a handoff edit |
| Procedure SHA-256 | `d1ccfde224b8ae76fe74b06c93abc532e6df9612933cafaa045053c8e2e45a75` (== `ACCEPTED_PROCEDURE_SHA256`, H:79) |
| Harness SHA-256 | **Current (committed `7ae4147`):** `d34d470cf51f5f74c5cf3cfa8380944822af2ce6c2e07d27f4117ea71fd19c39` (`test/acceptance/clashpanel-viewerbridge.acceptance.mjs`). *Historical (at `996305c`, superseded by the committed activation-preparation checkpoint; never bind):* `0df40907b054811e34fe7dc55ae166a3f0be34519991193ce28c8ff8d5ce3649`, 13,897 lines. |
| Additional module digests required by procedure | none (single-file harness; the procedure binds only procedure + harness) |
| `package.json` / `package-lock.json` SHA-256 (historical, at `996305c`) | `e3c73b9a110978724785752e21106b7c07824fd6b728d684ae95b2a62a55778a` / `7e0052f46b2e8a6a22959370945f5c6c316528ec33ceb067d27e615327a3d596` (informational) |
| Test identities (historical, at `996305c`; informational; not record-bound) | activation `1eeeabf5…eb2ab`; authorization `2dc5ec4b…85674`; preflight `e68c6e52…01247`; journal `546ad706…0344`; cli `1474cb56…3e5`; gate `5ab23d2c…ab1d`; mainflow `9da6e3c6…c3b`; closeout-realfs `c2990774…c463c18`; binding `d6a57056…3a52` (full digests reproducible with `shasum -a 256`) |
| Interlocks | `G2_DUAL_COUNTER_GATE.resolved=true` (`const G2_DUAL_COUNTER_GATE` in the harness; `H:3716` at `7ae4147`); `LIVE_PATH_WIRED=false` (`const LIVE_PATH_WIRED` in the harness; `H:119` at `7ae4147`) |
| Live evidence / records | none exist; `docs/prompts/` contains no `G2-LIVE-EXECUTION:` line; `test/acceptance/results/clashpanel-viewerbridge-g2-attempts/` does not exist |

**Important:** the harness SHA above is for the *dormant* harness. Activation requires editing the `const LIVE_PATH_WIRED` literal (§9), which changes the harness SHA. Every value in this section that depends on the harness (harness SHA, HEAD) is therefore **provisional and must be recomputed after the activation commit**; only the procedure SHA is expected to stay fixed. H line references in §2–§8 that are not commit-qualified were taken at the historical `996305c` pass and may have shifted; locate by symbol name.

## 2. Fixture bindings (not loaded; verified from committed evidence + local hashing only)

Both in OSS bucket `test-sandbox-lkwej7xpbgp63x4hl335y6m26oakggof`. The harness hashes the **base64url URN constant itself** (UTF-8, no padding, no trailing newline): `sha256Hex(Buffer.from(urn,'utf8'))` (H:444-447).

| | Model A (Mechanical) | Model B (Structure) |
| --- | --- | --- |
| File | `Audubon_Mechanical_clash_test.rvt` (H:107) | `Audubon_Structure_clash_test.rvt` (H:109) |
| Encoded URN | `dXJuOmFkc2sub2JqZWN0czpvcy5vYmplY3Q6dGVzdC1zYW5kYm94LWxrd2VqN3hwYmdwNjN4NGhsMzM1eTZtMjZvYWtnZ29mL0F1ZHVib25fTWVjaGFuaWNhbF9jbGFzaF90ZXN0LnJ2dA` | `dXJuOmFkc2sub2JqZWN0czpvcy5vYmplY3Q6dGVzdC1zYW5kYm94LWxrd2VqN3hwYmdwNjN4NGhsMzM1eTZtMjZvYWtnZ29mL0F1ZHVib25fU3RydWN0dXJlX2NsYXNoX3Rlc3QucnZ0` |
| Decoded | `urn:adsk.objects:os.object:test-sandbox-…/Audubon_Mechanical_clash_test.rvt` | `urn:adsk.objects:os.object:test-sandbox-…/Audubon_Structure_clash_test.rvt` |
| `Model-*-URN-SHA256` | `db7efe5c237b10757c8e69fbb925facd9a1bf43c307a60702ae42fa2968dd10d` | `806f99964bb937085874557ec2b03101a612db26031469a063446796d7ebb53d` (**matches the owner-required value**) |
| Size | 21,700,608 B | 28,983,296 B |
| Screening | `CONFIRMED_SVF2`, isOTG/isSVF2 true/true, 1,496 fragments, `SUITABLE_G1_FIXTURE` (primary) | `CONFIRMED_SVF2`, 543 fragments, `SUITABLE_G1_FIXTURE` (alternate) |
| Evidence | `docs/research/evidence/2026-09-29-g1-svf2-fixture-capacity-screening-result.json` (SHA `6e826ddd…7ec4`), `…f1-f8-mechanical-b811888-live-run-report.md:16` | same JSON (line ~1535); `docs/handoffs/latest.md` |

Notes: (1) the Model A digest `db7efe5c…` is derived here from the committed URN; it is not recorded elsewhere in the repo — the independent reviewer should recompute it. (2) No OSS object id / content digest / ETag is recorded for either file; the binding is name-and-URN identity only. (3) Not verified (would need APS/network, out of scope): that the objects and SVF2 derivatives still exist today; that the CDN `viewer3D.js` still hashes to `EXPECTED_VIEWER_SHA256`. These are caught at run time by Phase-0 / classifier / integrity rows (§8) and, by design, a failure there spends the record.

## 3. Runtime envelope (proposed; nothing launched)

| Pin | Value | Enforcement today |
| --- | --- | --- |
| APS Viewer | `7.124.2` | record `Runtime:` line (exact text), pinned CDN URLs (H:12026-27), `viewer3D.js` SHA `12b9fe49f41dc99ccec62535e5c887da915980829da2e941cfe4da3d7197c02e` (H:7453) must be `VERIFIED` for PASS |
| Initializer | `env: 'AutodeskProduction2'`, `api: 'streamingV2'` | record line + bare-page literal; no runtime read-back |
| Format | `isOTG()===true`, `isSVF2()===true`, 2 models | `classifyFormatSignals` (H:10922); else C1 BLOCKED |
| Node | `v22.23.1` (exact, `process.version`) | **Hard preflight gate (§3.1) — implemented in committed `7ae4147` and independently accepted** |
| Playwright | `1.62.1` (exact; installed `playwright`/`playwright-core` package version, not the `^1.62.1` range) | **Hard preflight gate (§3.1) — implemented in committed `7ae4147` and independently accepted** |
| Chromium | `151.0.7922.34` (revision 1234). **Launched runtime = `chromium-headless-shell`** (`chromium.launch()` passes no options, so Playwright 1.62.1 defaults `headless=true` and selects `chromium-headless-shell`; the headed Chrome-for-Testing bundle `chromium-1234` is never launched). Installed at `~/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell` (resolution contract: §3.2) | **Hard preflight gate (§3.1, §3.2) — implemented in committed `7ae4147` and independently accepted**; post-launch `browser.version()` strict check retained |
| OS | macOS 27.0.1 (26A434), Darwin 27.0.0, arm64 | operator-attested precondition (not in R1 `runtimeEnvelope`) |
| Filesystem (D2) | local POSIX, atomic `rename`/`link`; repo on local APFS (`/dev/disk3s5`, `apfs, local, journaled`); no power-loss (`F_FULLFSYNC`) or network/FUSE claim | assumption only; not checked |
| Browser context | `serviceWorkers:'block'`, `deviceScaleFactor:1`, WebGL required | enforced (DSF≠1 ⇒ C20 `NOT_EVIDENCED`; context loss fatal) |
| Server | operator runs `npm start` on `PORT` (default 8080) | `PORT` is **not** bound by the record |

OS/platform (macOS/arm64) and local-APFS/POSIX filesystem remain **recorded/operator-attested preconditions** under the accepted D2 assumption; no harder gate is added (Work disposition). `PORT` is operational configuration, not an evidence-semantic pin.

### 3.1 Hard runtime-version preflight gates (IMPLEMENTED in committed checkpoint `7ae4147` and independently accepted; the contract below is the accepted specification)

These are **hard preflight gates enforced by the activated harness, bound by its SHA — not manual operator checks.** (The §6.4 operator pre-check remains as an additional manual read-only check, never a substitute.)

| Gate | Required exact value | Detection (no APS/Viewer/fixture action) |
| --- | --- | --- |
| Node | `v22.23.1` | `process.version` strict equality (pure) |
| Playwright | `1.62.1` | `version` in `node_modules/playwright/package.json` **and** `node_modules/playwright-core/package.json` strict equality (not the `^1.62.1` range; reads only, cf. `readPlaywrightVersionG2`) |
| Chromium (headless-shell) | `151.0.7922.34` (revision `1234`), executable `chromium-headless-shell` | **Pre-reservation (file/env reads only, no import/spawn):** the §3.2 contract — resolve the effective Playwright browsers root, validate the `chromium-headless-shell` descriptor (`browserVersion=151.0.7922.34`, `revision=1234`, no `revisionOverrides`), its `INSTALLATION_COMPLETE` marker and the exact regular executable. **Phase 0 (`browser-launch`, after `AUTH_BOUND`):** `browser.version()` strict equality to `151.0.7922.34` — the only check that binds the binary actually launched |

Contract:
1. Detect all three actual values (for Chromium the pre-reservation value is the §3.2 file-level provenance, not a runtime version — see the §3.2 "two checks" table); compare each to the required constant (constants bound by the final harness SHA); reject on **any** mismatch **or any unavailable/undetectable value**.
2. The Node, Playwright and Chromium-installation comparisons run **inside W1, or immediately after W1 and before W2a**, using **local file reads and pure computation only — no `import('playwright')`, no browser/process start, no network** — consistent with procedure :108 (W1 touches no browser) and :134 (Playwright import and browser launch occur only after `AUTH_BOUND`; source-order tests pin this). A mismatch/unavailable value therefore never reaches directory creation, the reservation, `AUTH_BOUND`, `ATTEMPT_CONSUMED`, APS Viewer launch, token/CDN fetch, or fixture load. The pre-reservation Chromium check covers the resolved *installed headless-shell* provenance (§3.2); the Phase-0 post-launch `browser.version()` strict-equality check is the definitive version check and binds the binary *actually used* — a mismatch there is `PREFLIGHT_FAILED` (`consumed:false`, record already spent at W2b, `ATTEMPT_CONSUMED` not written, no Viewer/fixture load) and is a stricter, fail-safe Phase-0 check of the same kind as G-14. This plan does **not** move the Playwright import and requires no procedure amendment.
3. Non-consuming preflight evidence: the refusal (a `G2RefusalError`, reason e.g. `runtime-version-mismatch`) must print every detected value, every required value and the failing reason to stderr, so it is captured in the operator's O1 log. No durable attempt state exists before reservation, so no journal/reservation entry is created for a pre-reservation rejection (the record stays unspent). On a Phase-0 re-check failure the detected values go in the `PREFLIGHT_FAILED` journal detail and R1 `runtimeEnvelope`.
4. A run on any other versions can never be PASS-compatible; a mismatch is a refusal, not a verdict row.
5. Activation-preparation tests (implemented in `7ae4147`; this list is the accepted coverage specification): each of the three mismatching/unavailable cases refuses before any fs write (no D2, no reservation) — for Chromium including the §3.2 cases (headless-shell dir/marker/executable missing, wrong revision/`browserVersion`, `revisionOverrides` present, headed bundle present but headless-shell absent, every `PLAYWRIGHT_BROWSERS_PATH` form, `PWDEBUG`, platform override, ambiguous root); matching values pass; the resolver returns the same executable path Playwright selects for default `chromium.launch()` under an identical env matrix (§3.2 test T-same-target); source-order static guard (no playwright import/spawn before B3; version gate before `establishAttemptsDirectory`); post-launch Chromium mismatch maps to `PREFLIGHT_FAILED`.

### 3.2 Chromium headless-shell resolution contract (pre-reservation; IMPLEMENTED in committed checkpoint `7ae4147` and independently accepted; no live run)

**Why headless-shell.** `H:12970` is `chromium.launch()` with no options. In Playwright 1.62.1 an omitted `headless` is `true` (`headless = true` default in `_validateLaunchOptions`; no `channel`, no `executablePath`), and `getExecutableName` returns `chromium-headless-shell` for headless (`headed ⇒ chromium`). Checking the headed bundle (`chromium-1234/…/Google Chrome for Testing.app`, `Info.plist`) proves nothing about the executable that will run and **is dropped as a gate**: the headed bundle is neither required nor sufficient, and its absence must not block.

**Resolution algorithm (mirrors Playwright 1.62.1 `registryDirectory`, `readDescriptors`, `EXECUTABLE_PATHS`; fail-closed deviations marked ⛔).** Pure `process.env` / `fs` / `os` reads; no Playwright import, no spawn (not even `<exe> --version`).

1. **Platform:** `process.platform==='darwin'` and `process.arch==='arm64'`, else refuse. (Playwright then maps this host to `mac-arm64` ⇒ path tokens `chrome-headless-shell-mac-arm64/chrome-headless-shell`.) ⛔ refuse if `PLAYWRIGHT_HOST_PLATFORM_OVERRIDE` is set to any non-empty value (it changes the platform key and thus the executable path).
2. **Headless mode:** ⛔ refuse if `PWDEBUG`, `npm_config_pwdebug` or `npm_package_config_pwdebug` is set to any non-empty value (Playwright reads PWDEBUG via the same npm-fallback `getFromENV`; any value other than `0`/`false`/`console`, e.g. `1`/`inspector`, forces `headless=false` ⇒ headed `chromium`; refusing every non-empty value is deliberately stricter and safe).
3. **Root-variable sources, Playwright precedence (first source whose value is not `undefined` wins):** `PLAYWRIGHT_BROWSERS_PATH`, then `npm_config_playwright_browsers_path`, then `npm_package_config_playwright_browsers_path`. An empty string is "defined but falsy" ⇒ default root. ⛔ If more than one source is defined with differing non-empty values ⇒ refuse (ambiguous). The future command is invoked via `node`, not `npm run`, so the two `npm_*` sources are expected unset; they are read because Playwright reads them.
4. **Winning value → root:**
   - unset / empty ⇒ **default root** `path.join(os.homedir(),'Library','Caches','ms-playwright')` (macOS cache root; on this machine `/Users/kangea/Library/Caches/ms-playwright`). ⛔ Refuse if `<node_modules/playwright-core>/.local-browsers` exists (a second candidate root; none exists today).
   - **absolute path** ⇒ accepted only if `path.isAbsolute(v)` and `path.normalize(v)===v` (no `..`, no doubled/trailing separator, no NUL); root = `v`. This is also the only accepted form of explicit override.
   - ⛔ `"0"` ⇒ refuse. Playwright maps it to `<node_modules/playwright-core>/.local-browsers`; this repo does not use that layout, and special values are not supported by this gate.
   - ⛔ relative value ⇒ refuse (Playwright would resolve it against `INIT_CWD` or `cwd`, which is ambiguous for a harness run from the repo root).
5. **Descriptor** (read `node_modules/playwright-core/browsers.json`, parsed once): exactly one entry `name==='chromium-headless-shell'` with `revision==='1234'`, `browserVersion==='151.0.7922.34'`, and ⛔ **no** `revisionOverrides` key (an override changes the directory name to `chromium_headless_shell_<hostPlatform>_special-<rev>`). Package versions are already required to be `1.62.1` (§3.1).
6. **Installation paths** (Playwright's directory rule: browser name with `-`→`_`, then `-<revision>`): `D = <root>/chromium_headless_shell-1234`; marker `D/INSTALLATION_COMPLETE` must exist as a regular file; `E = D/chrome-headless-shell-mac-arm64/chrome-headless-shell` must be a regular file (`lstat`: not a symlink), `fs.realpath(E)===E` (no symlink escape), size > 0 and executable (`X_OK`). ⛔ Any missing/unreadable/extra-ambiguous item ⇒ refuse. Only the **exact** path Playwright will select is validated; no scanning for other revisions or directories, so there is never a "guess" between candidates.
7. **Refusal** = `G2RefusalError` reason `runtime-chromium-mismatch` (or `runtime-browser-path-unsupported` for steps 1–4), raised **inside W1 / before W2a**, printing every env source and value, the resolved root, `D`, `E`, the descriptor values and the failing step to stderr (O1). No D2, reservation or journal exists; the record stays unspent.
8. **Evidence recording:** the resolved root (and which source supplied it: `default` / `PLAYWRIGHT_BROWSERS_PATH` / npm source), `D`, `E`, descriptor `revision`/`browserVersion`, marker presence, and `E`'s size are recorded in the Phase-0 journal detail and in R1 `runtimeEnvelope` **if the accepted schema permits the extra fields**; otherwise they go only to the stderr/O1 log, and the activation-preparation task must state that and **stop rather than amend the procedure**.

**Two checks, kept separate**

| | Pre-reservation file-level identity | Post-launch runtime version |
| --- | --- | --- |
| When | inside W1 / before W2a; record unspent | Phase 0 `browser-launch`, after W2b `AUTH_BOUND`; before `ATTEMPT_CONSUMED` |
| Evidence | env + files (§3.2 steps 1–6): descriptor says `151.0.7922.34`/`1234`, marker, exact executable exists, regular, executable | `browser.version()===151.0.7922.34` |
| Binds | package/cache **provenance** and availability of the exact executable | the binary **actually launched** |
| Failure | `G2RefusalError`, non-consuming, exit non-zero | `PREFLIGHT_FAILED`, `consumed:false`, **record already spent**, no retry |

**Residual limit (accepted at plan level).** The headless-shell bundle has no `Info.plist` and no on-disk version field, so a file check cannot prove the binary's version; a replaced/tampered executable under correct names would pass the pre-reservation gate and be caught only by the Phase-0 `browser.version()` check (record spent). The plan **narrows the pre-reservation claim to provenance + availability** and keeps `browser.version()` as the definitive check, rather than binding an executable SHA-256. For information, the executable on the verified machine is a 163,329,264 B regular file, mode 755, SHA-256 `7687bff7cb2db075f250e6d5848bbc8838cac3802ac3952a899c574f8eccab45` (read-only hash, not bound; the owner may elect to bind it in activation preparation, accepting that a legitimate reinstall then needs a plan update).

**Activation-preparation tests (implemented in `7ae4147`; accepted coverage specification):** T-same-target — the oracle is Playwright's internal executable-registry resolution for `chromium-headless-shell` (the equivalent of `registry.findExecutable('chromium-headless-shell').executablePath()`, reachable via `playwright-core/lib/coreBundle`, resolved without launching), which is the actual default `chromium.launch()` target; the public `chromium.executablePath()` is **not** the oracle (it names the headed `chromium` bundle). For each **accepted** env case the resolver's `E` must equal the oracle's path; for each **rejected** env case the test asserts a pre-reservation (pre-W2a) refusal and does **not** assert path equality. The test author classifies each case listed below as accepted or rejected (e.g. headless-shell present with headed absent is accepted; the missing/mismatched/ambiguous cases are rejected); env cases: unset, empty string, absolute override to a temp tree, `"0"`, relative, non-normalized absolute, conflicting `npm_config_*`, empty `PLAYWRIGHT_BROWSERS_PATH` with a non-empty npm source (default root wins), `PWDEBUG=inspector` via each of the three sources, `PLAYWRIGHT_HOST_PLATFORM_OVERRIDE`; install cases: headless-shell dir missing, marker missing, executable missing/symlink/non-executable/zero-size, wrong `revision`/`browserVersion`, `revisionOverrides` present, headed `chromium-1234` present with headless-shell absent (must refuse), headless-shell present with headed absent (must pass); source-order guard (resolver runs before `establishAttemptsDirectory`; no `playwright` import or spawn before B3).

## 4. Single-use authorization-record schema (specification only — no record issued)

Location: exactly one regular, non-symlink UTF-8 `.md` file under `docs/prompts/`, passed as repo-relative `--authorization-record` (H:82, 315-398). Never inferred.

Marker lines — each a whole line, exactly once, not indented (H:260-270). Template (angle-bracket values are placeholders; this template is intentionally **not** a valid record and lives outside `docs/prompts/`):

```text
<line 1>  G2-LIVE-EXECUTION: AUTHORIZED EXACTLY ONE ATTEMPT
Authorization-ID: <[a-z0-9-]{8,64}, unique, never reused>
Baseline-HEAD: <40 hex = run-time HEAD after ALL required commits (activation, plan, review, handoff)>
Procedure-SHA256: <d1ccfde224b8ae76fe74b06c93abc532e6df9612933cafaa045053c8e2e45a75>
Harness-SHA256: <64 hex of the ACTIVATED harness bytes at that HEAD>
Model-A-URN-SHA256: <db7efe5c237b10757c8e69fbb925facd9a1bf43c307a60702ae42fa2968dd10d>
Model-B-URN-SHA256: <806f99964bb937085874557ec2b03101a612db26031469a063446796d7ebb53d>
Runtime: viewer=7.124.2 env=AutodeskProduction2 api=streamingV2
Supersedes: <optional, repeatable, an earlier Authorization-ID>
```
(`<line 1>` is a template annotation, not part of the record.)

| Requirement from the planning prompt | How the accepted design satisfies it |
| --- | --- |
| owner authorization statement/id | the fixed `G2-LIVE-EXECUTION:` line + `Authorization-ID` |
| repository HEAD | `Baseline-HEAD` == `git rev-parse HEAD` (W1) |
| procedure / harness SHA | `Procedure-SHA256` must equal both file bytes hash **and** `ACCEPTED_PROCEDURE_SHA256` (H:441, code-side extra guard); `Harness-SHA256` == harness bytes |
| fixture identities | `Model-A/B-URN-SHA256` == SHA of URN constants (H:444-447) |
| runtime envelope | the exact `Runtime:` line (Viewer/env/api) **plus** the exact Node `v22.23.1` / Playwright `1.62.1` / Chromium `151.0.7922.34` requirements, which are constants in the activated harness and therefore bound by `Harness-SHA256` (no new record marker; the record schema is unchanged). A record issued against a harness that lacks the §3.1 gates is invalid for this plan. |
| live command identity | **not a record field** — fixed by `main()` flag/env interlock (W0). See Gap G-3. |
| exactly-one-attempt | the first line's wording + reservation `open('wx')` per ID + startup scan refusing any artifact for that ID **or** any reservation/journal bearing the same record SHA |
| issuance timestamp / expiry | **none defined** by procedure or code. Freshness = HEAD/SHA bindings + single use. See Gap G-4 |
| unique id | `Authorization-ID`; duplicates across candidates rejected (`candidate-duplicate-authorization-id`) |
| supersession | a record is superseded iff another candidate's `Supersedes:` names its ID; self-supersession ignored (H:429) |

Selection / rejection (H:414-433): candidate set = every regular `docs/prompts/**/*.md` with a line starting `G2-LIVE-EXECUTION:` (symlinks never followed). Reject on: passed path not a candidate; any malformed candidate; duplicate IDs; passed record superseded; non-superseded count ≠ 1 or that one ≠ passed path (`candidate-set-ambiguous`). **Consequence:** a stale/older record left under `docs/prompts/` makes the set ambiguous unless superseded or removed.

Byte-hash binding and proof of "intended record": the record's own SHA-256 is computed (H:407) and copied, with path and ID, into `authorization{path,sha256,id}` of reservation and journal; R1 additionally carries `authorization.fields` and `candidateSet`. After W1 the record bytes are not re-hashed (Gap G-5).

Record-file/HEAD relationship: because `Baseline-HEAD` is the commit hash, the record cannot be committed at that HEAD; it exists **untracked** under `docs/prompts/` during the run, which the clean-tree rule permits (H:7484).

## 5. Preflight / attempt-journal semantics (verified statically; no attempt consumed)

Order in `main()` (H:13337-13378; statically pinned by activation test): W0 `parseLiveActivation` → `LIVE_PATH_WIRED` gate → `G2_DUAL_COUNTER_GATE` gate → W1 `validateAuthorizationRecord` (read-only; runs `git rev-parse`) → W1 `scanAttemptsDirectoryForStartup` (read-only) → `buildBindingRecord` → W2a `establishAttemptsDirectory` → W2b `reserveAttempt` (reservation `wx`+fsync, journal `AUTH_BOUND` = **B3**) → Phase 0 → W3 `markAttemptConsumed` (`ATTEMPT_CONSUMED` = **B5**) → first model RPC.

- Directories: D0 `test/acceptance` must exist; D1 `results` (git-ignored, `.gitignore:486`, exists); D2 `clashpanel-viewerbridge-g2-attempts` (absent; created at W2a with lstat/mkdir/fsync(dir)/fsync(parent), symlinks refused).
- Reservation `<id>.reservation.json`: written once, never modified/deleted. Journal `<id>.journal.json`: tmp+rename+fsync+read-back. States: `null→AUTH_BOUND→{PREFLIGHT_FAILED|ATTEMPT_CONSUMED}→CLOSEOUT_STARTED→FAILED`; no COMPLETED state — success is the K file only.
- Startup scan refuses: `reservation-exists`, `journal-exists`, `orphan-temp`, `own-artifact-exists`, non-directory attempts dir, unreadable reservation/journal, any prior artifact with the same record SHA.
- Phase 0 (after B3, spends the record, does **not** consume the attempt): `evidence-writer`, `harness-sha256` re-hash, `git-tree` (HEAD == binding; clean), `served-module-manifest`, `page-agent-build`, `browser-package-import`, `browser-launch`, `context-create`, `page-create`, `route-setup`, `goto`, `bootstrap-ready`, `module-install`, `agent-ready`. Any failure → `PREFLIGHT_FAILED`, exit 1, `consumed:false`, record spent (E5).
- **Consumption boundary:** `ATTEMPT_CONSUMED` durable write (W3/B5), strictly after `agent-ready` and before the first `g2DocumentLoad`/`g2LoadDocumentNode`. Last point with no live external effect: the `AUTH_BOUND` write. Last point with no model load: W3 read-back returning.
- Crash/orphan: harness never deletes reservation/journal; reader classes `CRASHED(reservation-only | AUTH_BOUND | ATTEMPT_CONSUMED | CLOSEOUT_STARTED | journal-without-reservation | unreadable-journal)` all derive FAIL. Any surviving reservation spends the ID; a new run needs a **new record with a new ID** and the old record removed or superseded.

**Rehearsal performed (historical, at `996305c`; no durable state):** only pure/offline paths: activation 11/11, authorization 26/26, preflight 7/7, journal 35/35 (mkdtemp sandboxes), cli 5/5, gate 19/19, mainflow offline dry-run (mutated copy in `os.tmpdir`, fake fs/git/browser). **No dry-run/`--check` mode exists in the harness**: once `LIVE_PATH_WIRED=true`, any invocation passing W1 creates D2, the reservation and `AUTH_BOUND`. See Gap G-1.

## 6. Exact future live command / operator runbook (NOT AUTHORIZED — do not execute)

The command is deliberately written with placeholders so that it cannot be executed as-is. It becomes runnable only after the owner issues activation + record + execution authorization.

1. **Env vars:** `G2_LIVE_AUTHORIZED=YES` (exact string; set **only** at execution time, never in a shell profile); APS credentials as for `npm start`; optional `PORT`. **Playwright browser-resolution env (§3.2):** `PLAYWRIGHT_BROWSERS_PATH` must be unset/empty (default root) or one normalized absolute path — never `0`, never relative; `npm_config_playwright_browsers_path`, `npm_package_config_playwright_browsers_path`, `PWDEBUG`, `npm_config_pwdebug`, `npm_package_config_pwdebug`, `PLAYWRIGHT_HOST_PLATFORM_OVERRIDE` must be unset or empty. Any other state is refused before reservation.
2. **Authorization-record path:** `docs/prompts/<owner-issued-record>.md`, the only non-superseded candidate.
3. **Fixtures:** record `Model-A/B-URN-SHA256` equal §2.
4. **Operator pre-check (manual, read-only, MUST pass before step 6, because the harness has no preflight-only mode):**
   a. `git rev-parse HEAD` == record `Baseline-HEAD`; `git status --porcelain` shows only `??` entries under `docs/prompts/` (the harness allows any, H:7484);
   b. `shasum -a 256` of procedure and harness == record values; procedure == `d1ccfde2…`;
   c. recompute both URN hashes == §2;
   d. `ls docs/prompts` / `grep -rl '^G2-LIVE-EXECUTION:' docs/prompts` returns exactly this one record;
   e. `ls test/acceptance/results/clashpanel-viewerbridge-g2-attempts` absent or contains no `<id>.*`; **copy any existing R1–R3 elsewhere** (fixed names are overwritten — Gap G-6);
   f. **Node:** fresh shells may default to Homebrew Node `v26.10.0`; before any activation/live work run `nvm use 22.23.1` and verify `node -v` = exactly `v22.23.1` (the §3.1 hard gate stays authoritative and rejects any mismatch before reservation/import; do not install or switch Node outside that authorized step). `node -v` = `v22.23.1`, Playwright = `1.62.1` (both package `version` fields), macOS/APFS local — match §3 (manual duplicate of the §3.1 hard gates);
   f2. **Chromium = the headless-shell, not the headed app.** Record the browser-path state: `env | grep -E '^(PLAYWRIGHT_|PWDEBUG|npm_config_pwdebug|npm_package_config_pwdebug|npm_config_playwright|npm_package_config_playwright)'` (expect nothing, or only an absolute `PLAYWRIGHT_BROWSERS_PATH`) and write the value down (or `<unset>`). Resolved root = that value, else `~/Library/Caches/ms-playwright`. Then read-only: `ls -l <root>/chromium_headless_shell-1234/INSTALLATION_COMPLETE <root>/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell` — this exact executable is what the harness validates and what `chromium.launch()` will run. `chromium-1234` (headed Chrome for Testing) is **not** what runs; do not use it to satisfy this step. **Do not execute the binary, `--version` included, and do not start Playwright/Chromium for any pre-check.** Any mismatch (missing file, other root, forbidden env) blocks execution before reservation: fix the environment and re-check; do not run;
   g. `npm start` serving on the intended `PORT`; credentials valid; Viewer CDN reachable.
5. **Authorization is spent** as soon as a reservation survives (W2b, procedure :99, :117-119; leftover W2a directories alone do not spend it); **attempt consumed** at `ATTEMPT_CONSUMED` (B5).
6. **Run in a fresh terminal from the repository root** (relative harness path), redirecting the raw log **outside the repo** (a log inside the repo dirties the tree and fails Phase-0 `git-tree` after B3, spending the record) (O1). `PORT` must equal the port `npm start` serves on (default 8080); APS credentials belong to the server's environment:

```text
# DO NOT RUN — requires future explicit owner authorization (activation + record + execution)
G2_LIVE_AUTHORIZED=YES PORT=<SERVER_PORT> node test/acceptance/clashpanel-viewerbridge.acceptance.mjs \
  --execute-live-g2 --authorization-record docs/prompts/<RECORD_FILE>.md \
  > <OUTSIDE_REPO>/g2-live.log 2>&1
```
7. **Timeout budget:** T9 whole attempt 20 min (1,200,000 ms); Phase-0 step 30 s; model load+readiness 180 s per model; tree enumeration 60 s; camera settle 5 s; present/clear/dispose 15 s; event window 10 s; screenshot frame 10 s; cleanup step 15 s. Worst case ≈ 30 min (Phase 0 up to 14×30 s before T9 arms, T9 20 min, ~10 closeout steps×15 s after disarm); plan ≥30 min. **Never kill the process** (a kill is a crash ⇒ FAIL).
8. **Artifacts:** §7.
9. **Cleanup:** harness-owned (page→context→browser close, cleanup steps bounded 15 s each). Operator then stops `npm start`.
10. **Exit codes (procedure-valid mapping only):** PASS 0, FAIL 1, BLOCKED 2, PARTIAL 3, unrecognized 4, any throw 1. A §3.1/§3.2 pre-reservation refusal (Node, Playwright, headless-shell resolution) exits non-zero via the refusal path (record unspent); a Phase-0 `browser.version()` mismatch is instead `PREFLIGHT_FAILED` (exit 1, record spent). An exit code never overrides the reader verdict. Exit code and stdout are **not authoritative** — run the reader (`deriveVerdictFromArtifacts` over reservation/journal/K/F/R1–R3); **mandatory** if output says `-UNCONFIRMED`/`COMMIT_DURABILITY_UNCONFIRMED`. Read-only reader (exports at H:5431, 5573), to be dry-validated by the reviewer before use (not executed here): `node --input-type=module -e "import * as H from './test/acceptance/clashpanel-viewerbridge.acceptance.mjs'; const fs=H.createNodeFsLayer(), chain=H.resolveAttemptsChain(); console.log(JSON.stringify(H.deriveVerdictFromArtifacts({...H.readArtifactFileMap({fs,chain}), authorizationId:'<ID>'})))"`.
11. **Terminal-verdict disposition.** PASS: K=PASS only. PARTIAL: legal **only** for procedure row 7 causes — a check `NOT_EVIDENCED` (incl. C20), N2/N8 `NOT_DISCRIMINATING`, N6/N8 `NOT_APPLICABLE`, or a cleanup step that failed **but whose ownership was positively resolved on re-check**; it is not PASS. FAIL: includes any cleanup failure whose ownership is unresolved **or indeterminate** (probe missing, probe threw, RPC timed out — row 2, fail-closed). BLOCKED: row 6 only. **If a K says PARTIAL and any cleanup failure recorded `ownership:'indeterminate'` (or anything other than `resolved`), treat it as a conformance defect: do not accept the verdict, preserve evidence, stop, and adjudicate under `docs/reviews/` (the procedure verdict is FAIL).** **After PASS / PARTIAL / FAIL / BLOCKED (all alike):** preserve evidence; copy R1–R3, reservation, journal, commit (and closeout-failure) **and the authorization record** (procedure :132 proof items 4-5) to `docs/research/evidence/<date>-g2-viewerbridge-dockingpanel-<label>-live-run-*`; write a human report under `docs/research/`; update `docs/handoffs/latest.md`; obtain independent Work verification; then owner decision. PARTIAL/BLOCKED/FAIL do not authorize anything next. Do not commit/push without separate authorization.
12. **No-retry rule:** once consumed, exactly one execution — no retry, no parameter/assertion/fixture change, no patch-and-rerun. A Phase-0 failure also spends the record; any further attempt requires a new owner record with a new `Authorization-ID` (and a fresh review if code changed).
13. **Crash-recovery adjudication:** do not rerun. Classify surviving files with the reader; `CRASHED(*)` ⇒ FAIL; persist the files and an adjudication note under `docs/reviews/`; handoff to `awaiting owner decision`.

## 7. Evidence plan

D1 = `test/acceptance/results/`; D2 = `D1/clashpanel-viewerbridge-g2-attempts/` (git-ignored; transient). Committed copies go to `docs/research/evidence/` in a separately authorized step.

| Category | Artifact / location | Authoritative? |
| --- | --- | --- |
| Reservation | D2 `<id>.reservation.json` | binding authority |
| Attempt journal | D2 `<id>.journal.json` | state authority (until K) |
| **Final verdict (K)** | D2 `<id>.commit.json` `{attemptId, finalOverall, primaryOverall, primaryRow, resultSha256, summarySha256, manifestSha256, journalSha256, committedAt}` created by `linkSync(Kc,K)` (B8) | **only path to PASS/PARTIAL/BLOCKED**; reader returns `K.finalOverall` |
| Candidate / closeout failure | D2 `<id>.commit.candidate-<uuid>` (never authoritative); `<id>.closeout-failure.json` (F) | F ⇒ FAIL |
| R1 result JSON | D1 `clashpanel-viewerbridge-g2-result.json` | evidence payload; its `overall` is not authoritative |
| R2 summary | D1 `clashpanel-viewerbridge-g2-summary.md` | derived, hash-bound by K |
| R3 closeout manifest | D1 `clashpanel-viewerbridge-g2-closeout.json` | hash-bound by K |
| Browser/runtime metadata | R1 `runtimeEnvelope{viewerVersion, chromium, playwright, node, modelUrns, urnSha256, initializer, webgl}` | R1 |
| Fixture identity | reservation/journal `fixtures`; R1 `runtimeEnvelope.urnSha256`, `classifier`, `runtime`, `targets` | reservation (binding) + R1 (observed) |
| Viewer identity/version | R1 `script{integrityResult, expectedSha256, capture…}` | R1 |
| C1–C20 | R1 `checks`, `gates.C1`, `c4Table`, `c17`, `c20`, `sceneOwnership`, `spyLedger`, `eventLog`, `stateSnapshots` | R1 |
| N1–N8 | R1 `controls` (+ `n6`) | R1 |
| Cleanup | R1 `cleanupFailures`, `cleanupStepStatus`, `cleanupUnresolvedOwnership` | R1 |
| Error/fatal ledger | R1 `errorLedger{fatalCount, entries…}` | R1 |
| Request/response | R1 `errorLedger{requestFailures, responseFailures, requestObservations, correlatedRequests, opLedger, …}` | R1 |
| C20 rendering | R1 `c20` (run-length changed-pixel lists ≤1 MiB each, footprints) + `screenshots` RGBA hashes | R1; PNG copies (O2) are **never produced** (not wired) |
| Failed run | R1 `phaseRunFailure` | R1 |
| Raw log (O1) | operator redirect outside repo | optional, non-authoritative |
| Invalid artifacts | `<name>.invalid-<uuid>` | quarantine |

Write order: W0, W1, W2a, W2b(B3), Phase 0, W3(B5), P1…P11, cleanup, closeout steps 1-11 (T9 disarm → CLOSEOUT_STARTED(B7) → S* freeze → R1 → R2 → R3 → Kc → quiescence → sync critical section `linkSync` K (B8)). K is atomic at B8, durable only after the step-9 dir fsync.

## 8. Timeout / cleanup / verdict mapping (procedure §4.7 Table T, §8, §9.1)

- **Timeouts:** see §6.7. Expiry: T1 FAIL (record spent, unconsumed); T2/T3/T4/T5/T7 BLOCKED (T5/T7 + taint); T6 FAIL (C16, C17); T8 FAIL if ownership is unresolved **or indeterminate** (row 2; see the cleanup-ownership mapping); T9 FAIL `ATTEMPT_DEADLINE`.
- **Verdict rows (first match wins):** 1 FAIL fatal ledger (pageerror, unhandledrejection, fatal request/HTTP≥400, crash, WebGL loss, any `console.error`); 2 FAIL `cleanupUnresolvedOwnership` (ownership of a Viewer/harness resource remains **unresolved after re-check**; an indeterminate/unprobeable ownership is by construction not "resolved on re-check" and is therefore treated fail-closed as unresolved); 3 FAIL check FAIL / `phaseRunFailure`; 4 FAIL control state; 5 FAIL journal/binding/schema contradiction, integrity MISMATCH/FETCH_FAILED, deadline, closeout failure pre-link; 6 BLOCKED non-CONFIRMED_SVF2, integrity AMBIGUOUS/UNAVAILABLE, model unloadable, any check BLOCKED, taint; 7 PARTIAL (only when rows 1–6 did not match) any NOT_EVIDENCED, N2/N8 NOT_DISCRIMINATING, N6/N8 NOT_APPLICABLE, or a cleanup step failed **but ownership resolved on re-check** (procedure :460; `ownership:'resolved'` for **every** failed cleanup step); 8 PASS-eligible. **Fail-first precedence** = row order.
- **C20:** has no FAIL outcome; `NOT_EVIDENCED` ⇒ best overall `PARTIAL` (row 7). Unchanged.
- **Cleanup-ownership mapping (procedure-exact):** `resolved` after re-check + step failed ⇒ row 7 PARTIAL (if nothing earlier matches); `unresolved` ⇒ row 2 FAIL; `indeterminate` (no ownership probe, probe throws, timed-out RPC with null ownership, e.g. `closeContext`) ⇒ **not resolved ⇒ row 2 FAIL (fail-closed)**. No plan wording or runbook step may map indeterminate ownership to PARTIAL. The committed harness at `7ae4147` implements exactly this fail-closed mapping (`cleanupUnresolvedOwnership=true` for indeterminate ownership); the earlier G-8 divergence is closed and independently accepted.
- **Consistency note (plan outcome → procedure row):** FAIL ↔ rows 1–5 (row 2 includes indeterminate cleanup ownership) plus non-row FAILs (Phase-0 `PREFLIGHT_FAILED`, reader witnesses W-0/W-1/`commit-missing`/`CRASHED(*)`, `linkSync` failure); the fail-closed reading is grounded in procedure row 8 ("cleanup complete"), row 2 ("unresolved after re-check") and row 7 ("resolved on re-check"), and the independent Work H1; BLOCKED ↔ row 6; PARTIAL ↔ row 7 (resolved-ownership cleanup failure, NOT_EVIDENCED incl. C20, N2/N8 NOT_DISCRIMINATING, N6/N8 NOT_APPLICABLE); PASS ↔ row 8 + K committed; exit codes 1/2/3/0 respectively; pre-reservation version refusal is outside the verdict rows (record unspent). No new verdict state is introduced.
- **Evidence-write failure:** any write/fsync/rename/link/verify failure = closeout failure ⇒ FAIL, no K (step 10); one read-verify repeat allowed, no write retry; optional-artifact failure ignored.
- **Crash:** before any reservation survives the record is reusable; B3–B5 not consumed but spent, FAIL; after B5 consumed, FAIL; after B8 reader returns `K.finalOverall`.
- **K commit semantics:** K only by synchronous `linkSync` after Kc; every partial prefix without K reads `FAIL(commit-missing)`.
- **Cleanup/shutdown bounds:** step 15 s; `closePlaywrightTarget` 15 s inside the 15 s step (see Gap G-7); late completions quarantined (`staleContinuationsDropped`).

## 9. Interlocks and the exact activation boundary

Verified now: `G2_DUAL_COUNTER_GATE.resolved=true` (`const G2_DUAL_COUNTER_GATE` in the harness; `H:3716` at `7ae4147`); `LIVE_PATH_WIRED=false` (`H:119` at `7ae4147`). **This task changes neither.**

Future owner-authorized activation action (explicit authorization required; **not** granted here; activation, record issuance and the single live execution each need their own later authorization):
0. **Status of prerequisites (current activation baseline `7ae4147b726e20b8183f0522ffabf61ab75895d6`):**
   - **Already completed and independently accepted (committed `7ae4147`; NOT future work and not to be re-implemented):** G-8 cleanup-ownership/PARTIAL conformance (indeterminate ⇒ row 2 FAIL; PARTIAL only when every failed cleanup step is `resolved`); the §3.1 hard runtime gates and §3.2 headless-shell resolution contract (`checkG2HardRuntimeGates` runs after W1 and before W2a/reservation/import); `T-same-target`; `SELENIUM_REMOTE_URL` redaction; isolated-copy test architecture; and the independently reviewed scratch simulation of the two-edit activation (see §9 step 2). Authority: the [activation-preparation independent review](../reviews/2026-10-03-g2-activation-preparation-independent-review.md), the [redaction re-review](../reviews/2026-10-03-g2-selenium-remote-url-redaction-targeted-independent-rereview.md) and the [live-flag activation-preparation independent review](../reviews/2026-10-03-g2-live-flag-activation-preparation-independent-review.md).
   - **Still pending BEFORE the real flag flip (each a separate owner gate):** targeted independent Work acceptance of this docs-only drift correction; an owner decision on a docs-only checkpoint commit/push of it; then a separate explicit owner authorization of the real two-file flip. This plan authorizes none of them.
   - **Still pending AFTER the real flag flip:** steps 3–5 below (offline re-run, independent review and activation commit; recompute harness SHA/HEAD; owner-issued single-use record; separate execution authorization), then the single live execution and its closeout.
1. **Real activation is exactly two repository edits** (verified by the independently reviewed scratch simulation of `7ae4147`; neither is made by this plan):
   - (a) `test/acceptance/clashpanel-viewerbridge.acceptance.mjs`: change `const LIVE_PATH_WIRED = false;` to `true` (`H:119` at `7ae4147`; locate by the constant name).
   - (b) `test/acceptance/clashpanel-viewerbridge.acceptance.live-path-isolation.test.mjs`: update the single deliberate real-state pin (the `PIN (single, deliberate)` test: its title and both `assert.equal(..., false)` expectations) to `true`.
2. **No other suite requires migration.** The activation-preparation checkpoint already made every other suite force the flag per isolated harness copy (`support/g2-harness-copy.mjs`), so they pass unchanged after the flip. Scratch simulation of exactly edits (a)+(b) on a `git archive` copy of `7ae4147`: focused G2 903/903 (43 files; runtime-gates 60/60; activation/preflight/CLI/live-path-isolation 11/7/11/11); offline aggregate 5,149 total / 5,148 pass / 0 fail / 1 existing TODO. The earlier "about 20 suites fail after the flip" claim is disproved and withdrawn. See [`2026-10-03-g2-live-flag-activation-preparation-internal-review.md`](../reviews/2026-10-03-g2-live-flag-activation-preparation-internal-review.md) and its [independent review](../reviews/2026-10-03-g2-live-flag-activation-preparation-independent-review.md).
   **Isolation (supersedes the withdrawn G-15 hazard):** the CLI suite runs only isolated temp-root copies of the harness (it refuses to spawn the real harness, with a negative test), static guards in `live-path-isolation.test.mjs` prevent accidental real-harness execution, offline tests do not enter real validation, and authorization-shaped fixtures stay under `os.tmpdir()`. No attempt/reservation state was created by the simulation. Record requirements (independent of the tests): the issued record must be untracked (the clean-tree rule permits the untracked `docs/prompts/` exception) and the sole non-superseded `G2-LIVE-EXECUTION:` candidate under `docs/prompts/` matching the passed path (W1). The record filename carries no production semantic and has no separate restriction.
   **Test setup note (not an activation/live dependency):** `git archive HEAD` omits the generated, ignored `wwwroot/vendor`. A fresh archive/scratch checkout running `node scripts/run-tests.mjs` directly must first run `npm run build:vendor` (a local copy from `node_modules`, no network); `npm test` does this via `pretest`. Without it ~7 vendor-build tests fail for unrelated reasons.
3. Re-run the offline suites, independent review, **commit** (clean-tree rule + `Harness-SHA256` need a committed activated harness).
4. Only then recompute harness SHA/HEAD and have the owner issue the single-use record (untracked) with `Baseline-HEAD` = the final run-time HEAD (after every required commit; W1 rejects any mismatch).
5. Separate explicit owner authorization to execute exactly one attempt.

## 10. Verification performed for this plan (non-live; historical record at `996305c` plus later reviewed checkpoints)

The table below records the original 2026-10-02/03 planning verification at `996305c`; it is evidence, not the current baseline. Current-baseline verification (focused G2 903/903; aggregate offline 5,149 total / 5,148 pass / 0 fail / 1 existing TODO; two-edit scratch simulation) is in the linked activation-preparation reviews (§9).

| Command | Result |
| --- | --- |
| `node --test test/acceptance/clashpanel-viewerbridge.acceptance.*.test.mjs` | exit 0; 818 tests, 818 pass, 0 fail |
| activation / authorization / preflight / journal / cli / gate test files individually | 11 / 26 / 7 / 35 / 5 / 19, all pass |
| `npm run test:offline` | exit 0; 5,064 total, 5,063 pass, 0 fail, 1 todo |
| `npm run test:g2:binding` (header: NON-APS, about:blank, local Playwright) | exit 0; 8/8 |
| digests (`shasum -a 256`), URN hashes | as §1–§2 |
| `git diff --check` | clean; tests created no repo files |
| Headless-shell remediation (2026-10-03, read-only; no Playwright import, no browser launch): Playwright/core `1.62.1`; `browsers.json` `chromium-headless-shell` rev `1234`/`151.0.7922.34`, no `revisionOverrides`; `PLAYWRIGHT_BROWSERS_PATH`, `PWDEBUG`, `PLAYWRIGHT_HOST_PLATFORM_OVERRIDE`, `npm_*playwright*` unset; root `/Users/kangea/Library/Caches/ms-playwright`; `chromium_headless_shell-1234` + `INSTALLATION_COMPLETE` present; executable regular, 755, 163,329,264 B, `realpath` identical; no `.local-browsers` | as stated; see `docs/reviews/2026-10-03-g2-headless-shell-plan-fix-internal-review.md` |

APS Viewer not loaded; fixtures not loaded; no record; no attempt.

## 11. Gaps carried into the owner decision (from static review of procedure vs harness)

| ID | Sev | Gap |
| --- | --- | --- |
| G-1 | Medium | No preflight-only/`--check` mode. Dirty tree, harness drift, module/CDN/browser/token failure after B3 all spend the record. Mitigation: mandatory manual pre-check (§6.4). Work accepted that no separate preflight-only mode is required; the manual pre-check is retained, and the §3.1 hard version gates run before reservation. |
| G-2 | Medium → corrected/closed (docs) | Original claim (flip collides with ~20 pinned tests) was **disproved** by the independently reviewed scratch simulation: after activation-preparation only the single `live-path-isolation` pin changes. The residual requirement stands: activation needs a committed harness (clean-tree rule + `Harness-SHA256`), sequence in §9. |
| G-3 | Low | Live command identity is not a record field (the planning prompt asks for it); procedure §11 mentions a "preflight exception" with no §4.1 marker. Binding is implicit via harness SHA + fixed W0 interlock. Owner may accept as is. |
| G-4 | Low | No issuance timestamp or expiry exists. |
| G-5 | Low | Record bytes not re-hashed after W1; read twice inside W1 without comparing (small TOCTOU). |
| G-6 | Low (Work L3; plan listed Medium) | R1–R3 have fixed names and are overwritten by a later run; startup does not refuse when they exist. Mitigation: copy evidence immediately (§6.4e, §6.11). |
| G-7 | Low (Work L4) | Cleanup budget: `closePage` drain + close share one outer 15 s deadline; `TABLE_T.T8.closeTimeoutMs=10_000` is unused. Fails safe: with the G-8 conformance committed in `7ae4147`, a cleanup timeout without positively resolved ownership is `indeterminate` ⇒ `cleanupUnresolvedOwnership=true` ⇒ row 2 FAIL. Residual Low is timeout plumbing only. |
| G-8 | **High → CLOSED** (independently accepted; committed `7ae4147`) | Indeterminate cleanup ownership (timed-out RPC or no ownership check, e.g. `closeContext`) previously could end as PARTIAL, whereas procedure row 7 allows PARTIAL only when ownership resolved on re-check. Closed by mechanical harness conformance: indeterminate/missing/throwing probes set `cleanupUnresolvedOwnership=true` (row 2 FAIL); PARTIAL only when every failed cleanup step is `resolved`. The plan states only the procedure-valid mapping (§8). No residual action. |
| G-9 | Medium → CLOSED (implemented in `7ae4147`) | Node/Playwright/Chromium exact versions are enforced as hard preflight gates (§3.1; Chromium bound to the actual default-headless `chromium-headless-shell` per §3.2). OS/filesystem remain recorded/attested; Viewer env/api implied by pinned URL + script SHA; `PORT` is operational config. |
| G-10 | Low | W3 post-rename fault can leave `ATTEMPT_CONSUMED` on disk while console says journal stays `AUTH_BOUND`; fail-safe. |
| G-11 | Low | Stale text: H:74-78 ("PENDING…acceptance"), `G2_DUAL_COUNTER_GATE.finding`, procedure header/§12 D2 status wording (cannot change without changing the bound SHA). |
| G-12 | Low | O2 C20 PNG copies never produced (reviewers get run-length pixel lists + hashes only). |
| G-14 | Medium | Other procedure/harness divergences (G-8 is closed in `7ae4147`): harness-only Phase-0 steps `page-agent-build`/`agent-ready`; startup reasons `own-artifact-exists`/`unreadable-journal` (procedure :126 does not list). All stricter/fail-safe. |
| G-15 | Low → closed / informational — original CLI-spawns-real-harness hazard disproved | Withdrawn: CLI tests use isolated temp-root copies, never spawn or touch the real harness; offline tests do not enter real validation; authorization-shaped fixtures stay isolated. The record requirements (untracked; sole non-superseded candidate under `docs/prompts/`) stand on their clean-tree/W1 rationale (§9 step 2, §4); no filename restriction exists. |
| G-16 | Low | The owner's execution-authorization prompt under `docs/prompts/` must contain no line beginning `G2-LIVE-EXECUTION:` other than the record itself (else W1 rejects malformed/duplicate candidate — safe, pre-B3). |
| G-13 | Info | Handoff carries Lows L1–L4 (audit/diagnostic limits) unchanged. |

## 12. Remaining prerequisites before any execution

1. Independent ChatGPT Work review of this plan (and adjudication per `CLAUDE.md`) — prior rounds done; targeted acceptance of the final drift correction pending.
2. Owner decision on G-1/G-14 and on the activation sequence (§9; G-2/G-15 corrected). **G-8 and the §3.1/§3.2 hard runtime gates are already implemented and independently accepted in committed `7ae4147` (§9 step 0); they are not outstanding work.** Accepted dispositions preserved: no preflight-only mode (G-1 manual pre-check retained); Model A identity by committed URN + SHA recomputation; `issuedAt`/`expiresAt`/record version optional; fixed R1–R3 names a non-blocking durability limitation (archive immediately); Lows G-5 (record TOCTOU), G-7 (cleanup-timeout plumbing).
3. Docs-only checkpoint of this plan correction (separate owner decision), then separately owner-authorized real two-file activation (§9) and its commit; recomputed harness SHA / HEAD.
4. Owner-issued single-use record (new unique ID), untracked, only candidate.
5. Separate owner authorization for exactly one live execution.
6. Environment ready: server, credentials, CDN, Chromium headless-shell 1234 (§3.2), objects still translated.

**Not authorized / must not begin:** flipping `LIVE_PATH_WIRED`, issuing a record, reserving/consuming an attempt, loading the Viewer or fixtures, live G2, real-Viewer failure injection, G3/H1/H2/OQ-1/host work, commit/push.
