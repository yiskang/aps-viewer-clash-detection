# Federated Clash Test core — P0 independent review: targeted adjudication

- **Date:** 2026-09-21
- **Adjudicated artifact:** [`2026-09-21-federated-clash-test-core-p0-independent-review.md`](2026-09-21-federated-clash-test-core-p0-independent-review.md) (0 Critical, 0 High, 1 Medium, 1 Low; verdict `P0 checkpoint ready for targeted adjudication`)
- **Repository state adjudicated:** branch `feature/federated-clash-test-core-engine`, P0 checkpoint `be1e8ddac6122411d7ccf539e80570ab20b0f6fb`, HEAD `e72dde18ebdd26b6d62575d6eb601585aca3b1c5` (CLAUDE.md-only after P0)
- **Method:** `CLAUDE.md` "Independent review adjudication". Scope limited to the review's cited findings, boundary, test claims and gate verdict. Read-only: no production code, test or spec was modified. Two independent read-only subagents (findings verified by executing repros; boundary and test evidence re-run) plus one `codex-advisor` consult (request `20260921-140608-73877-28119`, medium). All three agree on every disposition below.

## Result

**Work review and adjudication AGREE on the gate verdict.** No Critical/High blocker; P0.1–P0.7 boundary and layering claims hold. The Medium finding is confirmed as stated. The Low finding is confirmed in part (one sub-claim is wrong). Two evidence-level corrections are recorded below. No blocking disagreement, so no owner-decision escalation is required.

## Finding dispositions

| # | Review claim | Adjudication | Evidence |
| --- | --- | --- | --- |
| Medium | `canonical.js` object branch (`Object.keys` + `value[key]`, lines 41–50) silently omits symbol-keyed and non-enumerable own props and invokes enumerable accessors | **CONFIRMED, severity Medium retained** | Executed repros: `digestCanonical({x:1}) === digestCanonical({x:1,[s]:2})` → `true`; non-enumerable prop → `{"x":1}`; enumerable getter invoked once. Contradicts the P0 phase interface "`TypeError` on anything not plain JSON data" (`p0-foundations.md:~101/106`). The frozen spec §5.4 defines output bytes only and does not itself promise rejection. Existing `canonical.test.mjs` has no symbol/non-enumerable/accessor case. No current production caller reaches the gap (captured, normalized, or engine-built data only; `captureData` already rejects these shapes upstream). |
| Low | `captureData` accepts `rootGate` without a string `key`, and `stringLimitFor`/`arrayLimitFor` returning `NaN` **or negative** silently disables the comparison | **PARTIAL** — real for missing/non-string `rootGate.key` and for `NaN`; **negative returns are REFUTED** | Executed repros: `rootGate` with no `key` → `ok:true`; `key:42` → `ok:true` (control `key:'schemaVersion'` → `gated`); `NaN` from either callback → `ok:true`. Negative return fails closed (`length > -1` is always true → `string-too-long` / `array-too-long`). Contract (`p0-foundations.md:~827-829`): `number \| undefined`, `rootGate {key: string, check}`. All current/planned call sites use literal `'schemaVersion'` and valid numeric limits (P2, P5). Severity Low retained. |

## Corrections to the review's evidence

1. **Low finding scope:** delete "or negative" — negative callback results already fail closed. A negative result is still malformed configuration and should preferably be rejected at validation, but it is not a silent bypass.
2. **Full-runner numbers are environment-dependent.** The review reports 1,230 pass / 3 fail (sandbox `EPERM` on the M4 spike-server bind) / 1 todo. In this adjudication's environment (`node scripts/run-tests.mjs`, two runs; `npm test` deliberately not used because its pretest rewrites `wwwroot/vendor`):
   - Run 1: 1,234 total / 1,232 pass / **1 fail** / 1 todo. The single failure was `test/query/ContainmentModeQuery.test.mjs` "duct through beam"; it passed 3/3 in isolation, and `test/query`, `wwwroot`, `collision` are untouched by this branch (`git diff` empty). Zero `EPERM` occurrences.
   - Run 2: 1,234 total / **1,233 pass / 0 fail** / 1 todo, exit 0.
   - Conclusion: the 1,234 total, 1 todo, and P0 108/108 are confirmed; the failures are environment/flaky and unrelated to `clashtest/`. The flaky query test is a pre-existing, out-of-scope observation and is **not** adjudicated here (not a P0 finding).

## Confirmed without change

- **Boundary:** `git diff be1e8dd..e72dde1 --stat` = `CLAUDE.md` only (+23). `be1e8dd` touched 20 files: `clashtest/{errors,options}.js`, `clashtest/util/{canonical,capture,slicer}.js`, `test/clashtest/**` (tests + `support/`), and three docs (handoff, P0 internal Codex review, P0 phase file). No change to `collision/`, `wwwroot/`, `package.json`, `package-lock.json`.
- **Layering:** `grep` for `import|require|from` naming `collision` under `clashtest/` is empty (three comment mentions only).
- **P0 suite:** `node --test` over `test/clashtest/**/*.test.mjs` → 108 tests, 108 pass, 0 fail, 0 todo.
- **Repo state:** `git status --short` identical before and after all test runs (`docs/handoffs/latest.md` modified; the independent review untracked; now also this record).

## Gate verdict

`No Critical/High blocker; P0.1–P0.7 gate: ACCEPTED, subject to disposition of the Medium and Low findings below.` P1 does not begin from this adjudication — `CLAUDE.md` transition rules and the handoff still require explicit owner/session authorization.

## Recommended disposition of the two findings (RECOMMENDED, not yet authorized)

All three verifiers independently recommend **fix in P0** over "accept as documented internal precondition", because the P0 phase interface already promises `TypeError`, the fix is ~10 lines, and it does not change any golden vector or digest (a prototype on a scratch copy, not the repo, passed the existing 20/20 canonical tests unchanged).

1. **Medium:** in `canonical.js`, enumerate with `Reflect.ownKeys` once; throw `TypeError` on symbol keys; read each own descriptor once; throw on accessors and non-enumerable properties; recurse only on `descriptor.value`. Tests: symbol-key digest collision now throws; non-enumerable throws; accessor throws with **0 getter calls**. Related observation from the same code path, not a new finding: the array branch also silently drops non-index own props (`a=[1]; a.foo=2` → `[1]`); include a matching rejection + test in the same hardening pass (`captureData` already rejects `array-extra-key` upstream).
2. **Low:** in `capture.js`, require `typeof rootGate.key === 'string'`; require every non-`undefined` `stringLimitFor`/`arrayLimitFor` result to be a non-negative number (reject `NaN`, non-numbers; decide and pin whether `Infinity` is allowed). Tests: invalid configurations fail before the root is read.
3. Alternatively the owner may defer either as a named internal-API obligation with a test pinning the allowed domain.

**These are production-code changes, which adjudication may not make and which have not been authorized.** Applying them requires an explicit owner instruction; afterwards run a targeted re-check of only the changed areas (per `CLAUDE.md` Review boundary), not a new full review.

## Not adjudicated / unchanged

P0.8 (G-CAL) remains blocked; defaults remain provisional. P1+ not started. Carry-forward P5 notes unchanged. No spec, plan or acceptance mapping was altered.

## Remediation (owner-authorized 2026-09-21: "Fix both in P0, including the related array non-index-property gap")

Applied and committed in the P0 remediation commit; only the two adjudicated findings and the related array gap; no P1 work, no spec/plan change, no unrestricted re-review.

**`clashtest/util/canonical.js`**
- Object branch: `Reflect.ownKeys`; symbol key → `TypeError`; one descriptor read per own key; accessor or non-enumerable → `TypeError`; recurse on `descriptor.value` only; keys sorted by UTF-16 code-unit order (same order as before).
- Array branch: `length` read once from its descriptor (never via a `get` trap); own-key set must be exactly `{'length','0'…'length-1'}` (rejects symbol/named/extra keys and sparse arrays); each element read from its own descriptor (accessor / non-enumerable / missing → `TypeError`, getter never invoked).
- A targeted Codex re-check of only these areas (`20260921-142743-88275-10488`, medium) found one concrete defect in the first version of the array fix (count-only key check + repeated `length` reads let a `Proxy` drop an element or shift `length`); fixed as above and pinned by a Proxy regression test (sync, digest and `digestCanonicalSliced`). It reported no defects in `capture.js`, in conforming-data bytes, key ordering, null-prototype objects, or the sliced path. The loop was stopped after that single fix (convergence rule); the fix was verified mechanically, not by a further Codex round.

**`clashtest/util/capture.js`**
- `rootGate` must have a string `key` (fails before the root is read, like the other malformed options).
- New `pathLimit()`: a `stringLimitFor`/`arrayLimitFor` result is `undefined` (→ fixed cap) or a number ≥ 0; anything else (`NaN`, negative, non-number) throws inside the traversal's existing try and therefore **fails closed** as `{ok:false, code:'unreadable'}` — consistent with how a throwing callback already behaved, and never a silent bypass. `Infinity` remains allowed. (Design note: this is a result, not a thrown `TypeError` to the caller, because callback results are only known per path during traversal.)

**Regression tests** (P0 suite 108 → 112): canonical — symbol/non-enumerable/accessor (digest-collision now throws; getter call count 0), array named/symbol/accessor/non-enumerable/sparse rejection with plain-array and null-prototype controls, Proxy bypass (both repros, incl. sliced); capture — `rootGate` missing/non-string key in the malformed-options test (root never read), callback-result test (NaN/negative/string/null/object/boolean fail closed; 0 rejects, Infinity admits, `undefined` defers). Mutation check: with the pre-fix `clashtest/` restored from stash the four new/extended tests fail (50/54 pass); with the fix all pass.

**Verification (targeted only):** `node --test $(find test/clashtest -name '*.test.mjs')` → 112 tests / 112 pass / 0 fail / 0 todo (all existing golden vectors and pinned digests unchanged); `git diff --check` clean; `grep` for `collision` imports under `clashtest/` empty; only `clashtest/util/{canonical,capture}.js` and their two test files changed in code; nothing outside `clashtest/` imports these modules. The full repository runner was not re-run (no file outside `clashtest/`/`test/clashtest/` changed; the earlier adjudication runs are unaffected).

**Status:** Medium and Low findings REMEDIATED (owner-authorized). Gate: P0.1–P0.7 accepted. Committed with owner authorization. P1 not started and not authorized.

## Adjudication of the follow-up remediation review (2026-09-21)

- **Adjudicated:** [`2026-09-21-federated-clash-test-core-p0-remediation-review.md`](2026-09-21-federated-clash-test-core-p0-remediation-review.md) — verdict `PASS`, no finding remaining, reviewing checkpoint `92fcd20a91a997ce81a38d17fdc7a7e81f5f665b`.
- **Scope (CLAUDE.md):** only the review's cited claims, commit boundary, test evidence and gate verdict; no new implementation review; no production code modified.
- **Method:** direct mechanical re-verification plus one `codex-advisor` consult (`20260921-153424-24900-26930`, low) on the code-level claims.
- **Boundary — CONFIRMED:** `92fcd20` touches 7 files: `clashtest/util/{canonical,capture}.js`, their two test files, the prior review, its adjudication, the handoff. No change to `collision/`, `wwwroot/`, `package.json`, `package-lock.json`, or `docs/superpowers/` (0 files). No P1 files exist. `git diff --check HEAD^ HEAD` clean; no `collision` import under `clashtest/`.
- **Tests — CONFIRMED:** the review's exact command (`node --test test/clashtest/*.test.mjs test/clashtest/util/*.test.mjs`) → 112 tests / 112 pass / 0 fail / 0 skipped / 0 todo; recursive `find` form also 112/112.
- **Code claims — CONFIRMED by Codex** ("Agree; no concrete disagreement"): canonical object/array restrictions, unchanged conforming bytes and key order, Proxy tests pin the two bypasses and the sliced path; capture `rootGate` key/callback-result validation with fail-closed `unreadable`, `0`/`Infinity`/fallback tested.
- **Gate verdict — CONFIRMED:** `P0 remediation checkpoint accepted; no Critical, High, Medium or Low finding remains in the targeted remediation scope.` The Work review and this adjudication **agree**; no disagreement to persist, no owner-decision escalation.
- **Unchanged:** P0.8 remains G-CAL-blocked; P1 is not started and is **not** authorized by either review or this adjudication.

