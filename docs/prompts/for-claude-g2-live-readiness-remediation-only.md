# For Claude — G2 Live-Readiness Remediation Only

I explicitly authorize **one bounded G2 live-readiness remediation pass only** against the committed/pushed dormant G2 harness checkpoint.

This authorization is limited to the currently reviewed live-readiness findings:

## Blocking findings
- **High 1** — Node/page sequence counters and phase attribution are not unified.
- **High 2** — C1 uses an asynchronous page fatal mirror instead of the authoritative Node ledger.
- **Medium 1** — item 24 gate-time pending-response finalization is implemented/tested but not integrated with the authoritative live ledger.

## Low findings to adjudicate
- `requestfinished` capture exceptions are swallowed.
- teardown C-e uses a cleanup-marker proxy.
- C15(e) contradictions reach FAIL through R1 rather than primary row 5.
- `T_iso` uses the ledger target rather than the recorded Viewer-call argument.

The Low findings may be fixed in this pass **only if** the correction is local, mechanically justified, and does not widen scope or alter accepted procedure semantics. Otherwise preserve and disposition them for later.

This authorization does **not** include:

- live G2 execution;
- enabling `LIVE_PATH_WIRED`;
- authorization-record issuance;
- real-Viewer failure injection;
- G3;
- H1/H2 host integration;
- OQ-1;
- host integration;
- production/Core/Viewer Adapter/M4/Panel changes;
- unrelated procedure redesign;
- commit or push unless separately authorized.

Use repository state as the source of truth.

## 1. Verify baseline first

Before editing:

- repo: `aps-viewer-clash-detection`
- branch: `main`
- expected HEAD: `d07dea0045a07c3f748618f4f959195f4346db89`
- `main == origin/main`
- working tree clean
- accepted procedure SHA-256: `5f9c4c7e124751d09406f07eab63f844fec53add006bd12ad676ecaca3732abb`
- dormant G2 harness checkpoint present
- `LIVE_PATH_WIRED=false`
- no live G2 attempt/evidence exists

Read:
- `CLAUDE.md`
- `docs/handoffs/latest.md`
- accepted G2 procedure
- `docs/reviews/2026-10-01-g2-harness-followup-implementation-independent-review.md`
- `docs/reviews/2026-10-01-g2-harness-followup-implementation-internal-review.md`
- current G2 harness and affected tests

If baseline differs materially, stop and report.

## 2. High 1 — unify Node/page sequence counters and phase attribution

Establish **one authoritative total-order event sequence** for all verdict-bearing events across Node and page realms.

The design must guarantee:
- unique monotonic sequence numbers across both realms;
- deterministic ordering;
- no collisions;
- every verdict-bearing event carries authoritative sequence, source realm, authoritative phase, and operation id where applicable.

Prefer:
- page emits unsequenced payloads to Node;
- Node assigns the authoritative sequence on ingestion;
- Node assigns/validates phase from the operation/phase ledger.

Fix stale P1 attribution so hide/unload/teardown events receive the correct mutation phase.

Add offline tests for:
- interleaved Node/page events;
- monotonic ordering;
- collision prevention;
- phase transitions;
- hide/unload/teardown attribution;
- no false fatal caused solely by stale P1.

## 3. High 2 — replace async page fatal mirror with authoritative Node ledger

C1 and later verdict gates must consult one authoritative Node-side fatal ledger.

Implement:
- page → Node event transfer;
- Node-side normalization/correlation;
- authoritative fatal-witness creation;
- authoritative fatal count;
- C1 gate read from that ledger.

Demote/remove the page fatal mirror from authoritative use.

Ensure:
- a page fatal cannot exist only in the page realm while C1 passes;
- page-origin fatal evidence is ingested before C1 evaluates;
- quiescence/drain semantics are explicit;
- no late page fatal races past the gate.

Add tests for:
- page fatal immediately before gate;
- page fatal during drain;
- duplicate page/Node representations;
- missing/late transfer;
- fail-closed ambiguous transfer.

## 4. Medium 1 — integrate item 24 pending-response finalization

At the relevant gate/closeout boundary:
- finalize all pending request/response observations;
- convert unresolved pending responses into deterministic ledger outcomes;
- feed HTTP >=400 / request-failure evidence into the authoritative Node ledger;
- recompute fatal witnesses from the finalized event set;
- ensure no pending response escapes verdict accounting.

Add tests for:
- pending response → success;
- pending response → HTTP failure;
- unresolved at finalization;
- duplicate requestfailed/response events;
- one-fatal-witness accounting after finalization.

## 5. Low 1 — requestfinished capture exceptions

If local and safe, stop swallowing them:
- retain capture/parse exceptions in diagnostic evidence;
- fail safe when required request accounting could be compromised;
- keep truly optional capture failures diagnostic.

Otherwise preserve as open Low with exact risk.

## 6. Low 2 — teardown C-e cleanup-marker proxy

Inspect whether direct existing evidence is available.
- If yes, use it.
- If the proxy is the only non-invasive valid evidence, document why and preserve as Low.

Do not change production code.

## 7. Low 3 — C15(e) FAIL routing

Review whether the contradiction must reach primary row 5 or whether deterministic FAIL through R1 is acceptable.
- If procedure requires row 5, fix harness routing.
- Otherwise preserve with rationale.

## 8. Low 4 — `T_iso` source

If the recorded Viewer-call argument exists, use it as authoritative `T_iso`; keep the ledger target as a consistency check.

Add a divergence test.

If impossible without production change, preserve as Low.

## 9. Preserve accepted procedure semantics

Do not change:
- C15(e) `H_iso` oracle;
- global C1 gate;
- synthetic gate-disposition records;
- effective-state accessor;
- NRDB legality;
- N7 = `{C1,C16}`;
- N8 = `{C1,C4,C7,C8}`;
- one-fatal-witness-per-trustworthy-request identity;
- HTTP >=400 default-fatal;
- prefix provenance / `boundPrefix`;
- operation ledgers;
- authoritative K closeout;
- `LIVE_PATH_WIRED=false`.

If remediation requires a procedure change, stop and report.

## 10. Verification

Run offline/non-live verification only.

At minimum:
- focused G2 suite;
- aggregate offline suite;
- new sequence/phase tests;
- authoritative-ledger tests;
- pending-response-finalization tests;
- Low-finding regression tests added;
- `git diff --check`.

Prior baseline:
- focused: 502/502 PASS
- aggregate: 4748 total / 4747 PASS / 0 FAIL / 1 TODO

Do not run live Viewer.

## 11. Focused internal review

After implementation:
1. run one focused internal review;
2. classify Critical/High/Medium/Low;
3. fix genuine Critical/High defects within scope;
4. do not modify production code;
5. do not enable live.

Persist review under `docs/reviews/` and update `docs/handoffs/latest.md`.

The handoff must state:
- remediation status;
- whether both Highs and the Medium are closed;
- disposition of each Low;
- offline test results;
- remaining before-live-execution work;
- `LIVE_PATH_WIRED=false`;
- no live G2;
- next action: none / awaiting independent Work review.

## 12. Commit policy

Do not commit or push unless separately authorized.

## 13. Stop gate

Stop after:
- bounded remediation;
- offline verification;
- focused internal review;
- handoff update.

Do not:
- set `LIVE_PATH_WIRED=true`;
- issue authorization records;
- run live G2;
- run real-Viewer failure injection;
- start G3/H1/H2/OQ-1/host;
- modify production code;
- commit or push.

## 14. Final report

Report:
- branch / HEAD / relation to `origin/main`;
- working-tree state;
- exact files modified/created;
- unified sequence/phase design;
- authoritative Node fatal-ledger design;
- item 24 integration;
- disposition of all four Lows;
- offline test commands/results;
- internal review findings/fixes;
- remaining before-live-execution work;
- explicit confirmation:
  - `LIVE_PATH_WIRED=false`;
  - no live G2;
  - no authorization record;
  - no real-Viewer injection;
  - no production/downstream changes;
  - nothing committed or pushed.
