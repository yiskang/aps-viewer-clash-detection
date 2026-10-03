# G2 live-flag activation preparation — independent review

- **Date:** 2026-10-03
- **Repository:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`
- **Baseline:** `main` = `origin/main` = `7ae4147b726e20b8183f0522ffabf61ab75895d6`
- **Scope:** the current live-flag activation-preparation result, scratch flip simulation, accepted live plan/procedure, and directly affected tests/status records
- **Result:** **0 Critical / 0 High / 1 Medium / 2 Low**
- **Verdict:** the two-file activation diff is technically sufficient and the dormant harness remains safe, but the governing live plan contains known-false activation instructions. A bounded docs-only plan reconciliation is required before the real flag flip may be authorized.

## Verified repository and authorization state

The branch, commit, and remote match the expected baseline. Before this review, the real working tree contained exactly the modified handoff plus the untracked authorizing prompt and internal review. The real harness remains dormant:

| Item | Verified value |
| --- | --- |
| Harness SHA-256 | `d34d470cf51f5f74c5cf3cfa8380944822af2ce6c2e07d27f4117ea71fd19c39` |
| Procedure SHA-256 | `d1ccfde224b8ae76fe74b06c93abc532e6df9612933cafaa045053c8e2e45a75` |
| Dual-counter gate | `G2_DUAL_COUNTER_GATE.resolved=true` |
| Live gate | `LIVE_PATH_WIRED=false` at harness line 119 |
| Live state | no authorization record, attempt/reservation directory, Viewer/fixture load, or live-G2 evidence found |

The default command environment currently resolves `/opt/homebrew/bin/node` at `v26.10.0`. The exact required binary is installed at `/Users/kangea/.nvm/versions/node/v22.23.1/bin/node`; that binary was used for the independent scratch reproduction. Playwright and playwright-core are both `1.62.1`; `browsers.json` still identifies `chromium-headless-shell` revision `1234`, version `151.0.7922.34`. The committed hard gate rejects a Node value other than exact `v22.23.1` before W2a/reservation.

## Findings

### Critical

None.

### High

None.

### Medium

#### M1 — the governing plan gives obsolete and now-disproved activation instructions

The live plan's operational activation section still directs an implementer to edit roughly 20 suites after the flag flip and warns that the CLI suite spawns the real harness and may spend a real record (`§9` steps 1–2 and G-15). Current code and the independent scratch simulation disprove both statements:

- the shared copy helper forces the flag explicitly in isolated copies;
- the CLI test refuses to spawn the real harness, confines its copies and fixtures to temporary roots, and traps browser-package resolution;
- the only real-state pin is the three-line assertion in `clashpanel-viewerbridge.acceptance.live-path-isolation.test.mjs`;
- changing the harness literal and that one pin leaves all focused and aggregate tests green.

The same plan cites harness line 118, while the declaration is now line 119. G-2 and G-15 repeat the obsolete scope/hazard claims. These are not harmless history because the plan is the governing activation artifact and its §9 text is written as future operator instructions. The handoff is navigation and cannot override it.

**Minimum correction:** before any real source flip, perform a bounded docs-only reconciliation of the plan's current baseline/line reference, §9 steps 0–2, G-2, G-15, and verification/runbook wording. It must state that activation is exactly the two-file diff verified below, that the CLI and copy-based suites stay isolated, and that raw `node scripts/run-tests.mjs` on a fresh archive needs `npm run build:vendor` first (or use the canonical `npm test` setup). No procedure, harness, test, production, Core, Adapter, Panel, M4, OQ-1, or host change is needed for this correction.

This is a governance/operational blocker to authorizing the real flip, not a defect in the dormant harness. Correcting the plan in the same source-flip commit would leave the executor starting from known-false authoritative instructions; a prior docs-only checkpoint is the cleaner transition.

### Low

#### L1 — fresh-archive vendor setup is implicit for the raw offline runner

`wwwroot/vendor` is generated/ignored and is absent from `git archive HEAD`. `npm test` invokes `pretest` and therefore `build:vendor`; `npm run test:offline` / direct `node scripts/run-tests.mjs` does not. `scripts/sync-vendor.mjs` copies the already-installed local `three` and `three-mesh-bvh` assets and performs no network operation. This is expected scratch-fixture setup, not a hidden live dependency or activation defect. The plan reconciliation should name the setup so another reviewer can reproduce the archive simulation without irrelevant missing-vendor failures.

#### L2 — internal review wording overstates the currently selected shell

The internal review says “Current shell: Node v22.23.1.” The independently observed default shell is v26.10.0; only the explicitly selected nvm binary is v22.23.1. This does not affect the reproduced results or hard-gate correctness, but the durable wording should distinguish the selected test binary from the default shell. The internal review's metadata-only headless-shell confirmation is otherwise appropriate: launching the binary was out of scope, and the accepted contract makes post-launch `browser.version()` the definitive future check.

The internal review's other Low—the false-state pin not being rerun in the scratch copy—is accepted and not retained as a finding. The committed dormant checkpoint already proves the false state, while the scratch run proves the future true state; rerunning the same false pin would add no missing boundary evidence.

## Scratch flip reproduction

An independent `git archive HEAD` copy was created outside the repository. The only scratch source changes were:

1. `test/acceptance/clashpanel-viewerbridge.acceptance.mjs:119`: `const LIVE_PATH_WIRED = false;` → `true`.
2. `test/acceptance/clashpanel-viewerbridge.acceptance.live-path-isolation.test.mjs:50-52`: change the single pin/title from dormant `false` to flipped `true`.

No third source/test migration was required. After local vendor synchronization, the exact Node `v22.23.1` results were:

| Verification | Independent result |
| --- | --- |
| Focused G2 | **903/903 pass** |
| Runtime gates | **60/60 pass** |
| Offline aggregate | **5,149 total / 5,148 pass / 0 fail / 1 existing TODO** |

The first aggregate invocation inside the review sandbox reported three `spike-server` failures because the sandbox denied an ephemeral `0.0.0.0` listen with `EPERM`. The same unchanged scratch tree passed once under the permission profile needed by those existing local-server tests. This was neither a code retry nor live-G2 work.

Inspection after the runs found no authorization record, attempt directory, or live result in either the real repository or scratch tree. The focused architecture uses forced isolated copies and fakes; no real Viewer, APS model, fixture, browser, or production attempts path was entered. The scratch harness hash is diagnostic only and must never be placed in an authorization record.

## Exact future activation boundary

The future real activation diff should be exactly the two changes above. No additional harness or suite edit is technically required.

After that flip but before a valid record exists:

- importing the module remains side-effect-free because its realpath entry guard does not call `main()`;
- direct execution still requires the CLI flag, `G2_LIVE_AUTHORIZED=YES`, and an explicit record path at W0;
- a missing/invalid record fails in W1 before any write, reservation, Playwright import, browser/Viewer launch, or fixture load;
- with a valid record, exact runtime gates execute after W1 but before W2a/reservation/import;
- offline CLI and main-flow tests use isolated copies/roots and cannot consume a record from the real repository;
- a coincidental filename cannot authorize execution: W0 requires the explicit path and W1 validates the sole eligible record and its bound identities.

No accidental entry path was found.

## Authorization-record boundary

Authorization-record preparation is not ready now. It becomes eligible for a separate owner gate only after all of the following:

1. The docs-only live-plan reconciliation is independently accepted and committed/pushed to a clean baseline.
2. The owner separately authorizes the exact two-file real flip; that diff is independently reviewed, offline-verified, committed, and pushed.
3. Final `Baseline-HEAD` and harness SHA are recomputed from that clean activated commit; the accepted procedure SHA remains `d1ccfde2…5a75`.
4. The operator explicitly selects and verifies Node `v22.23.1`, confirms Playwright/core `1.62.1` and headless-shell `151.0.7922.34`, and preserves the accepted clean-tree/local-runtime assumptions.
5. A separate authorization-record issuance gate binds the final identities and fixture URN digests; exactly-one live execution remains a later, separate authorization.

## Internal-review adjudication and artifact handling

The internal review's `0 Critical / 0 High / 0 Medium / 2 Low` result is not fully accepted. Its stale-plan Low is elevated to **Medium** because the false text is normative operator guidance in the governing plan. Its false-pin/headless metadata Low remains non-blocking as described above.

The cleanest documentation transition is one bounded docs-only checkpoint containing:

- the corrected live plan;
- the authorizing prompt and internal review as historical task records;
- this independent review;
- the updated handoff.

Do not amend the accepted procedure. Do not include either activation source/test file in that docs-only checkpoint. Commit/push remain owner-controlled and are not performed by this review.

## Readiness and exact next action

- **Technical two-file flip:** verified sufficient, but still unauthorized.
- **Real activation authorization:** blocked by M1 until the governing plan is reconciled and accepted.
- **Authorization-record preparation:** not ready; it follows an accepted, clean, committed/pushed real activation checkpoint with recomputed identities.
- **Live G2:** not ready and unauthorized.

**Next authorized action:** none. The recommended next owner authorization is a bounded docs-only reconciliation of the governing live plan and its directly affected review/handoff records, followed by independent confirmation and a documentation checkpoint commit. The real flag flip, authorization-record issuance, attempt reservation/consumption, Viewer/fixture loading, and live G2 must not begin under that authorization.
