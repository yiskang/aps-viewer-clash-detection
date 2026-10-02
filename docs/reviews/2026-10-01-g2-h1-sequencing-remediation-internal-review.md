# Internal Review — G2 H1 Sequencing Remediation (single Node-side allocator)

**Date:** 2026-10-01 · **Baseline:** `main == origin/main == b33b7a94eaaefd4b3c7f097a4c743a5bb5abf80a` · **Procedure SHA-256:** `5f9c4c7e124751d09406f07eab63f844fec53add006bd12ad676ecaca3732abb` (unchanged)
**Authority:** `docs/prompts/for-claude-g2-h1-sequencing-remediation-only.md`. Harness-only; nothing committed; both live gates unchanged (`G2_DUAL_COUNTER_GATE.resolved=false`, `LIVE_PATH_WIRED=false`).

## Design (what changed)

- **One allocator.** `createRunSeqAllocator()` (`next()/peek()`) is the only source of authoritative `seq`; `runPostReservation` builds exactly one. The composite page-major/Node-minor namespace (`SEQ_STRIDE`, `realmOfSeq`, `createPageSeqSource`, `createRunSeqCounter`, `observe`, `ingestHw/ingestPage`, `hw`-only fences) is removed.
- **Page ordinals are non-authoritative.** The page recorder draws from `createPageOrdinalSource` (values `> PAGE_LOCAL_BASE = 2**50`), used only to order the page's own synchronous records. Each allocation queues `{ord, kind, phase, activeCheck, activeControl}`.
- **Ingestion = ordering point.** `createRunAuthority` ingests ordinals and allocates the authoritative seq at ingestion, in ordinal order: awaited fences (`ingestFence` for ops begin/end, drain, gate; `syncPage` for attribution) re-send every unacknowledged ordinal with `hw`; atomic, contiguous, attribution must equal the acknowledged one (or the one being acknowledged from the transition allocation on), `hw` required and equal to the last ordinal. Any failure ingests nothing, is one fail-closed violation, and the page throws before its action (attribution/gate/drain). An early best-effort binding (`__g2NodeIngest`) narrows the chronology window but never violates (deferral); the fence is the single authority.
- **Authoritative state is rewritten.** The final transfer is `reconcilePageFatals → rewritePageRun → applyPhaseRunToState → assertAllocated`; numbers `> PAGE_LOCAL_BASE` and `spyLedger:seq:<n>` references are mapped via ordinal→seq (unmapped ⇒ `page-ordinal-unmapped`); `primarySeqAllocations` reports `page-ordinal-leaked` for any ordinal left in state. Ops `end` translates `spyRef` before storing.
- **Gate.** Node translates C1's page ordinal to its seq before `prepareC1Gate`, so `gateSeq > c1FinalizedSeq` holds on Node seqs; the in-page runner validates the gate against that mapped value and closeout re-verifies after the final remap.
- **Ordering claim.** Authoritative order is Node ingestion order; no stronger causal claim. A page event observed before a Node event can be ingested after it between fences; fences guarantee everything before the fence is ingested before anything Node allocates after it.

## Tests

- Focused G2 suite (`clashpanel-viewerbridge.acceptance.*.test.mjs`): **558/558** (baseline 542; crossrealm rewritten to 38, new sequencing-guards file 8).
- **Local real-Playwright binding test** (`clashpanel-viewerbridge.acceptance.binding.mjs`, `npm run test:g2:binding`): **7/7**, ~2 s, 3+ stable runs. Non-APS, no Viewer, no network; real `page.exposeFunction` bindings with the shipped in-page bundle; covers multi-awaited events, interleaved Node-origin events on the same allocator, unique/monotonic/contiguous seqs, awaited phase-sync before action, rejected sync blocks action (one violation), delayed/out-of-order early hints (no second namespace), late/failing delivery fail-closed, and a negative case (page counting from 0 / second Node counter) that the namespace check catches. It is deliberately **not** a `*.test.mjs` (repo policy: `domIsolation.test.mjs` forbids any `*.test.mjs` importing playwright in the offline suite); it is therefore **outside** `npm run test:offline` and must be run explicitly.
- Static guards: banned composite/second-counter names, page code cannot reference Node allocator/authority, awaited delivery in `g2NodeSync`/`g2NodeOps`, ordinal use confined to the allocator/authority/leak-check functions, positive invariants; each with mutation checks.
- Aggregate `npm run test:offline`: see handoff (final run recorded there). `git diff --check` clean.

## Findings (focused internal review: Codex advisor + own review)

| # | Sev | Finding | Disposition |
|---|---|---|---|
| F1 | Medium (self-found by codex) | `remapPageOrdinals` rewrote any 16-digit run in any string; a hex digest (`argsDigest`) can contain one, so it would be mapped or falsely `page-ordinal-unmapped` | **Fixed**: strings are rewritten only for `spyLedger:seq:<n>`; regression test added |
| F2 | Low | Early path produced two violations for one cause (invalid attribution) | **Fixed**: early path never violates (deferral) |
| F3 | Low | Fences accepted a missing `hw` | **Fixed**: `hw` required; atomic refusal test |
| F4 | Low | `pageHighWater` fallback `0` | **Fixed**: `g2FenceReport().hw` |
| F5 | Medium, **pre-existing, not an H1 regression** | Page records produced during cleanup (e.g. `wrapper-restore` events, cleanup spy records) are never transferred into `state.eventLog`/`spyLedger`; their ordinals are ingested only via ops/early fences. No allocator-vs-state completeness check exists. Same gap existed before this pass | **Deferred** (before-live-execution hardening: post-cleanup awaited drain + merge, and an "allocations missing from state" check). Out of the bounded H1 scope |
| F6 | Medium (guards) | Static guards verify consumers *receive* `runSeq.next`, not that they use it; a consumer-local anonymous counter inside e.g. `createNetworkInstrumentation` is not statically rejected; only the pre-cleanup drain is guarded | **Deferred/accepted**: guards intentionally narrow; runtime namespace checks (binding + crossrealm single-namespace) cover collisions |
| F7 | Low (disclosed) | `g2NodeOps` refusal does not abort the mutation (pre-existing C2 design: mutation runs, abort stays FATAL; the ingest violation is also a fatal) — attribution sync, gate and drain do throw | Preserved |
| F8 | Low (disclosed) | In-page provisional check evaluation still compares page-local ordinals within the page realm (no cross-realm comparison); authoritative verdict is Node closeout over remapped state | Accepted; independent Work should confirm |
| F9 | Low | Concurrent fences: an overtaken older fence is refused (`ingest-hw-mismatch`, fail closed); shipped runner awaits fences sequentially | Accepted, pinned by a test |
| F10 | Low | mainflow fake-page tags runner-default attribution as acknowledged P1 (fidelity compromise) | Test-only; accepted |

Critical: none. High: none after F5 was classified pre-existing (the Codex report rated F5 High; it is not caused by or fixable within the H1 sequencing contract — flagged for the independent Work review to re-classify). No production/Core/Adapter/M4/Panel change.

## Technical readiness

H1 sequencing now conforms to §9.2's single node-side allocator in the offline model and under real Playwright bindings; **H1 appears technically closed, pending independent confirmation**. `G2_DUAL_COUNTER_GATE.resolved` stays `false` (owner/independent decision). The active-control phase-validation Low: unchanged in substance (`syncPage` already validated activeControl enum; `activeCheckPhaseProblem` is applied to both sync and ingested entries — incidental tightening, covered by crossrealm tests) — remaining Lows (teardown C-e proxy, C15(e) FAIL routing, `T_iso` evidence authority) untouched.
