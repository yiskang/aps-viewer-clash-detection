# For Claude — G2 Before-Live Hardening Only

I explicitly authorize **one bounded G2 before-live hardening pass only** against the committed/pushed H1 gate-resolution baseline.

This authorization is limited to the four Medium hardening items already identified by independent Work:

1. finalize `eventLog` **after** the last transfer drain;
2. retain cleanup evidence after failed phase runs;
3. persist exact operation-refusal detail durably;
4. broaden static guards against consumer-local authoritative counters.

It also permits correcting the stale handoff wording that still says the prior gate-resolution commit was "not pushed", as part of the normal handoff update.

This authorization does **not** include:

- changing the accepted procedure;
- flipping `LIVE_PATH_WIRED`;
- changing `G2_DUAL_COUNTER_GATE.resolved` (it is already true);
- issuing any authorization record;
- live G2 execution;
- real-Viewer failure injection;
- production/Core/Viewer Adapter/M4/Panel changes;
- G3;
- H1/H2 host integration;
- OQ-1;
- host integration;
- unrelated Low-finding cleanup unless directly required by one of the four Medium fixes;
- commit or push unless separately authorized.

Use repository state as the source of truth.

## 1. Verify baseline first

Before editing, verify:

- repo: `aps-viewer-clash-detection`
- branch: `main`
- expected HEAD: `c0f877a`
- `main == origin/main`
- working tree clean
- accepted procedure SHA unchanged
- `G2_DUAL_COUNTER_GATE.resolved=true`
- `LIVE_PATH_WIRED=false`
- no live G2 attempt/evidence exists
- no authorization record exists
- no production/Core/Viewer Adapter/M4/Panel/OQ-1/host changes

Read:

- `CLAUDE.md`
- `docs/handoffs/latest.md`
- latest independent H1/gate-resolution review
- latest H1 internal reviews
- current G2 harness and directly affected tests

If baseline differs materially, stop and report.

## 2. Medium 1 — finalize `eventLog` after the last transfer drain

The authoritative final `eventLog` snapshot must be taken **after** the final page→Node transfer/drain has completed, not before.

Required outcome:

- the last transfer drain completes first;
- all newly arrived page-origin events are ingested and assigned authoritative Node seq values;
- only then is the final authoritative `eventLog` snapshot/finalization produced;
- closeout and verdict logic consume that post-drain finalized event set;
- no event produced during the last drain can appear "missing" solely because the snapshot happened too early.

Do not change accepted cleanup provenance semantics.

Add/adjust tests proving:

- an event produced during the final drain is present in the final authoritative `eventLog`;
- the same scenario would have failed before the fix;
- no duplicate merge occurs;
- ordering remains Node-authoritative;
- finalization cannot run before the last drain finishes.

## 3. Medium 2 — retain cleanup evidence after failed phase runs

If a phase run throws/fails, cleanup evidence must still be captured and retained in the failure artifact path as required by the accepted evidence contract.

Required outcome:

- cleanup still runs where safe/required;
- mandatory cleanup page evidence is drained/ingested;
- retained cleanup evidence is attached to the failure result/artifact;
- the failure remains FAIL;
- cleanup evidence retention must not downgrade or overwrite the original failure;
- cleanup evidence failures may add additional fatal detail but may not erase the root cause.

Do not create a second execution path with weaker provenance checks.

Cover at least:

- phase throws, cleanup succeeds, cleanup evidence retained;
- phase throws, cleanup also has evidence problem, both failure causes retained;
- phase throws before cleanup marker;
- phase throws after cleanup marker;
- no false PASS / no loss of original failure.

## 4. Medium 3 — persist exact operation-refusal detail

Current fail-safe behavior is correct, but exact refusal detail is not durably retained in all paths.

Required outcome:

When operation begin is refused/throws/malformed:

- action still does not execute;
- one authoritative violation remains;
- exact refusal detail is durably preserved in authoritative evidence;
- retain at least:
  - operation id / attempted operation kind;
  - refusal reason/category;
  - source realm;
  - phase/check;
  - underlying error/message if available;
  - timestamp/seq;
- generic `harness-exception:P9` may remain as a summary, but the specific refusal detail must be reconstructable from durable evidence.

Do not introduce duplicate violations for the same root cause.

Cover:

- explicit refused begin;
- thrown begin;
- malformed response;
- empty operation id;
- delayed/refused binding path;
- detail survives closeout and appears in persisted evidence.

## 5. Medium 4 — broaden static guards against consumer-local authoritative counters

Strengthen static guards so a future consumer cannot silently create a second authoritative sequence source.

Reject patterns equivalent to:

- local counter used for verdict-bearing event ordering;
- local increment logic that bypasses injected Node allocator;
- consumer receives `nextSeq` but ignores it and synthesizes its own authoritative number;
- helper-local authoritative sequencing reintroduced under another name;
- composite reconstruction of authoritative order from local counters.

Keep guards narrowly targeted so legitimate diagnostic counters remain allowed.

Add mutation-style tests proving guards fail on:

- ignored `nextSeq`;
- local authoritative increment;
- second allocator helper;
- composite local ordering reconstruction.

Preserve the accepted single Node allocator implementation.

## 6. Preserve already-closed work

Do not regress:

- H1 technically closed;
- `G2_DUAL_COUNTER_GATE.resolved=true`;
- `LIVE_PATH_WIRED=false`;
- single Node authoritative allocator;
- real Playwright binding gate;
- cleanup bidirectional provenance;
- cleanup phase/transfer-stage fix;
- operation-refusal action blocking;
- authoritative Node fatal ledger;
- item 24 pending-response finalization;
- C15(e) `H_iso` oracle;
- global C1 gate;
- NRDB/effective-state semantics;
- N7/N8 dependencies;
- one-fatal-witness-per-trustworthy-request identity;
- HTTP >=400 default-fatal;
- prefix provenance / operation ledgers;
- authoritative K closeout.

If any hardening item requires changing the accepted procedure, stop and report instead of changing it.

## 7. Low findings

Do not broaden this task to fix unrelated Low findings unless a local change is strictly necessary for one of the four Medium fixes.

Preserve current Low dispositions, including as applicable:

- teardown C-e proxy;
- C15(e) FAIL routing;
- `T_iso` evidence authority;
- refused `ops.end` unsettled record;
- thrown drain RPC missing exact error name;
- non-object merge entries counted as duplicates;
- any other Work-recorded Low still open.

If one is incidentally resolved, note it and add a regression test.

## 8. Verification

Run offline/non-live verification only.

At minimum:

- focused G2 suite;
- aggregate offline suite;
- `npm run test:g2:binding`;
- final-eventLog timing tests;
- failed-phase cleanup-evidence tests;
- operation-refusal-detail persistence tests;
- strengthened sequencing static-guard tests;
- `git diff --check`.

Prior reviewed baseline:

- focused G2: 693/693 PASS
- aggregate: 4938 PASS / 0 FAIL / 1 TODO
- binding: 8/8 PASS

New tests may increase totals.

Do not run APS Viewer or live G2.

## 9. Focused internal review

After implementation:

1. run one focused internal review over only the four Medium hardening items and directly affected evidence/sequencing paths;
2. classify Critical / High / Medium / Low;
3. fix genuine Critical/High defects within this bounded harness scope;
4. do not change procedure or production code;
5. do not enable live.

Persist the review under `docs/reviews/`.

Update `docs/handoffs/latest.md`.

The handoff must state:

- all four before-live Medium hardening items and their status;
- `G2_DUAL_COUNTER_GATE.resolved=true`;
- `LIVE_PATH_WIRED=false`;
- live planning status remains owner-controlled;
- live execution remains unauthorized;
- remaining Low findings;
- next action: none / awaiting independent Work review.

Also correct any stale "not pushed" wording for the c0f877a gate-resolution commit, since `main == origin/main == c0f877a` at task start.

## 10. Commit policy

Do not commit or push unless separately authorized.

Leave the complete working tree available for independent Work review.

## 11. Stop gate

Stop after:

- the four Medium hardening fixes;
- offline verification;
- focused internal review;
- handoff update.

Do not:

- set `LIVE_PATH_WIRED=true`;
- issue authorization records;
- run live G2;
- run real-Viewer failure injection;
- start G3/H1/H2/OQ-1/host integration;
- modify production/downstream code;
- commit or push.

The next gate is:

**independent ChatGPT Work review of before-live hardening → owner decision on checkpoint commit and live-planning authorization**

## 12. Final report

Report:

- branch / HEAD / relation to `origin/main`;
- working-tree state;
- exact files modified/created;
- final `eventLog` finalization design;
- failed-phase cleanup-evidence retention design;
- exact operation-refusal detail persistence;
- static-guard hardening design;
- focused / aggregate / binding test results;
- internal review findings/fixes;
- remaining Low findings;
- remaining work before live execution;
- explicit confirmation:
  - `G2_DUAL_COUNTER_GATE.resolved=true`
  - `LIVE_PATH_WIRED=false`
  - no live G2
  - no authorization record
  - no production/downstream changes
  - nothing committed or pushed.
