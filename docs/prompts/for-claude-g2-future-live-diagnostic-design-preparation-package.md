# For Claude — G2 Future Live-Diagnostic Design / Preparation Package

I explicitly authorize one **larger bounded G2 future live-diagnostic design / preparation package**.

This package may proceed autonomously through:

**research refinement → live-diagnostic design → exact capture plan → offline preparation/prototype → research-local tests → deterministic verification → internal review → in-scope Critical/High/Medium remediation → handoff update**

and then stop at:

**Ready for independent Work review**

Do **not** stop for owner approval between those internal stages unless a protected owner-only boundary below is reached.

This authorization is for **design and preparation only**.

It does **not** authorize any Viewer/browser/live diagnostic execution.

---

# 1. Authoritative baseline

Verify first:

- repo: `aps-viewer-clash-detection`
- branch: `main`
- committed baseline:
  `f3bab74f460eacd6b6f69bc8fb90110455ceeb68`
- `main == origin/main`
- `git status --short` is completely empty
- zero modified files
- zero untracked files
- historical authorization artifacts are tracked as non-executable provenance
- no active authorization exists

Historical authorization state:

- `g2-live-20261004-75a3ccb9`
  - spent / consumed
- `g2-live-20261004-8a8d49f6`
  - superseded
- `g2-live-20261004-dbd97137`
  - superseded

Read:

- `docs/research/2026-10-06-g2-historical-authorization-records-status.md`
- latest `docs/handoffs/latest.md`

Verify:

- committed harness SHA remains:
  `cc8868cd68b9c2c3382297070289a2aa165c74249c6d82896d76bacc6c6ef09b`
- accepted G2 procedure SHA remains:
  `d1ccfde224b8ae76fe74b06c93abc532e6df9612933cafaa045053c8e2e45a75`
- immutable historical evidence unchanged
- D2 checkpoint unchanged
- diagnostic-instrumentation checkpoint unchanged
- historical G2 remains:
  `FAIL (row 3)`
- C6 remains:
  `NOT_EVIDENCED`
- C8 remains unresolved
- real T4 behavior unchanged
- no Viewer/browser/live run
- no G2 retry
- no new authorization record
- no attempt reset
- no G3 work

If repository state materially differs, stop and report before proceeding.

---

# 2. Larger-batch autonomy

Within this package, you may autonomously:

- inspect committed research/spec/reviews;
- inspect Viewer 7.124.2 source;
- inspect current G2 harness as read-only reference;
- refine diagnostic hypotheses;
- define exact live-diagnostic questions;
- design a future diagnostic capture architecture;
- define instrumentation points;
- define trace/event schemas;
- define controls;
- define evidence capture/provenance;
- create offline preparation tooling;
- create research-local tests;
- run deterministic offline preparation/validation;
- revise package-local docs/prototypes based on review findings;
- fix Critical/High/Medium findings that remain entirely inside this design/preparation package;
- persist internal reviews under `docs/reviews/`;
- update `docs/handoffs/latest.md`.

Do not ask the owner for approval between those in-scope steps.

---

# 3. Hard owner-only boundaries

Stop immediately and request owner authorization if any step would require:

1. Viewer/browser/live diagnostic execution;
2. G2 acceptance retry;
3. issuance of a new authorization record;
4. reset/reuse of an attempt;
5. change to accepted G2 procedure or acceptance contract;
6. change to real T4 semantics;
7. change to real C6/N2 runtime behavior;
8. change to real C8 runtime/oracle behavior;
9. change to production or real harness runtime behavior;
10. mutation of immutable historical evidence;
11. G3 or milestone-transition work;
12. commit or push.

These remain unauthorized.

---

# 4. Governing committed diagnostic findings

Use the committed diagnostic-instrumentation package as the starting point.

Read at minimum:

- `docs/research/2026-10-05-g2-diagnostic-instrumentation-research.md`
- `docs/research/2026-10-05-g2-diagnostic-instrumentation-spec.md`
- `docs/research/2026-10-05-g2-diagnostic-instrumentation/`
- latest diagnostic internal review
- latest diagnostic independent reviews
- latest handoff

Treat these committed conclusions as current unless a new contradiction is found:

- diagnostic summary schemaVersion = 3
- witnesses schemaVersion = 2
- bounded ablation carrier accepted
- NV limit = 406 B
- unique two-window minimum:
  `ID-ON + P-FRM + P-TC + V-PEND + V-EDGE`
- P-XS is redundant for the two-window objective
- OPEN answers `2/13`
- assumption mode answers `3/13`
- only `3/13` questions have any sound procedure
- all 2,048 configurations have wrong-label count = 0
- public-only sound definite owner labels = 0
- public-only sound definite subject labels = 0
- public-only sound definite attribution labels = 0
- residual ambiguity = 5,063 ACTIVE_WITHOUT_VISIBLE_STEP / ACTIVE0 pre-motion schedules
- pending-clear → active-edge gap is fail-closed
- historical C8 remains unresolved
- post-capture VB-3 control is not historical proof and is not yet established as representative of the historical live run

Do not silently change these conclusions.

---

# 5. Package objective

Design everything required so that a **future separately authorized live diagnostic** could be executed safely and produce interpretable evidence.

The package must answer:

- What exact questions should a future live diagnostic try to answer?
- Which questions are actually answerable with the accepted minimum instrumentation?
- Which questions remain structurally unanswerable?
- What data must be captured at request issuance, pending-slot ownership, transition activation, T4 sampling, completion, restore, event delivery and C8/frustum observation?
- What positive/negative controls are required?
- How should the 5,063 pre-motion ambiguity class be handled?
- How must the diagnostic fail closed?
- How is evidence frozen, hashed and attributed?
- What constitutes a successful diagnostic run vs an inconclusive run?
- What conditions would justify a later owner decision to perform live execution?
- What conditions would mean live execution is not worth performing?

Do not assume a live run should happen.

---

# 6. Define exact live diagnostic questions

Create a bounded question set.

Start from the 13-question framework already used by the diagnostic package.

For each question classify:

- answerable with current minimum instrumentation;
- answerable only under an explicit assumption;
- not answerable even with current version-bound instrumentation;
- requires an additional observable;
- should not be pursued because it cannot affect a later decision.

For each question define:

- required observable set;
- positive evidence;
- negative evidence;
- inconclusive state;
- historical interpretation limit.

Do not count synthetic schedule separation as a live answer.

---

# 7. Instrumentation architecture

Design the future diagnostic instrumentation around the accepted minimum:

- `ID-ON`
- `P-FRM`
- `P-TC`
- `V-PEND`
- `V-EDGE`

Where applicable, define exact meanings for:

- harness-tagged request ID
- public frame index
- public step/transition count
- pending-slot identity
- transition-active edge events

Document:

- capture source
- exact timing
- request/transition ownership semantics
- version dependency
- failure mode
- whether observation is:
  - public
  - harness-local
  - Viewer 7.124.2 version-bound internal

Do not add redundant observables without demonstrated diagnostic value.

---

# 8. Exact capture points

Define precise future capture points for at least:

1. before request issuance;
2. immediately after request issuance;
3. pending-slot write/change;
4. pending-slot clear;
5. transition-active rising edge;
6. transition-active falling edge;
7. frame/step increment;
8. T4 sample acquisition;
9. T4 equal/non-equal settle decision;
10. restore invocation;
11. restore camera write if observable;
12. public camera-change event;
13. formal transition completion if observable;
14. C8/frustum measurement;
15. diagnostic terminalization.

For each capture point define:

- required fields;
- ordering guarantee;
- possible race/gap;
- request/transition token availability;
- fail-closed behavior if missing.

---

# 9. Pre-motion ambiguity strategy

The committed package leaves:

`5,063` ACTIVE0 / pre-motion schedules unresolved.

Design the future live diagnostic so this class is handled explicitly.

Determine:

- how such a case would be recognized;
- whether it can be distinguished from:
  - request not consumed;
  - request consumed but zero-motion first step;
  - pending-slot hold;
  - transition not yet active;
  - stale observation;
- whether any additional version-bound observable could soundly resolve it;
- whether adding such an observable is justified;
- whether unresolved pre-motion should simply force an inconclusive verdict.

Prefer fail-closed inconclusive handling over speculative attribution.

---

# 10. Pending-clear → active-edge gap

Define the future diagnostic behavior for the known Viewer 7.124.2 gap:

- pending slot cleared;
- transition-active edge not yet observed.

Specify:

- how the trace records the gap;
- what may be inferred;
- what may not be inferred;
- when correlation must stop/fail closed;
- whether any later observation can safely resolve the gap.

Do not use event order alone as request ownership proof.

---

# 11. Positive and negative controls

Design a control matrix.

At minimum include:

### Positive controls
- known request that should become transition-active;
- known request whose ownership can be independently tagged;
- post-capture VB-3 edge case;
- a control for successful C8/frustum measurement timing.

### Negative controls
- wrong Viewer version;
- wrong Viewer bundle digest;
- missing version-bound observable;
- missing request tag;
- ambiguous request ownership;
- trace-integrity failure;
- truncated trace;
- overflowed trace;
- unmatched META/data/END envelope.

For every control define:

- expected trace pattern;
- expected verdict;
- what a control failure invalidates.

Do not treat the existing post-capture VB-3 control as representative historical evidence.

---

# 12. Live-trace envelope

Use the committed META/data/END integrity design.

Specify the future capture contract concretely.

## META
Include at minimum:

- schema version;
- Viewer version;
- Viewer bundle digest;
- harness/build digest;
- diagnostic spec digest;
- run/session ID;
- capability map;
- version-bound gate state;
- expected bounds;
- start metadata.

## Data
Include bounded records for:

- request issuance;
- pending identity;
- transition edges;
- public frame/transition count;
- T4 samples/decisions;
- restore;
- camera/public events;
- C8/frustum observation;
- control results.

## END
Include:

- same run/session ID;
- terminal sequence;
- record count;
- truncation/overflow state;
- terminal diagnostic status;
- stream digest/commitment.

No partial trace may become positive evidence.

---

# 13. Evidence capture and provenance

Design a future evidence package without creating one now.

Define:

- evidence directory layout;
- filenames;
- manifest;
- SHA-256 inventory;
- authorization-record copy;
- diagnostic spec digest;
- harness digest;
- Viewer bundle digest;
- environment metadata;
- stdout/stderr capture;
- trace files;
- control results;
- terminal verdict file.

Define immutable capture rules:

- write once;
- hash immediately;
- no post-hoc editing;
- copy raw artifacts byte-for-byte;
- distinguish raw capture from derived analysis;
- no current historical evidence mutation.

---

# 14. Diagnostic verdict model

Define a future diagnostic verdict table.

At minimum:

- `SUPPORTED`
- `REJECTED`
- `INCONCLUSIVE`
- `INVALID`
- `BLOCKED`

For each define mechanically:

- required evidence;
- disqualifiers;
- trace-integrity requirements;
- control requirements;
- owner/subject/attribution requirements.

No ambiguous trace may produce `SUPPORTED` or `REJECTED`.

---

# 15. Future-live stop conditions

Design fail-fast conditions for a future run.

Examples:

- wrong Viewer version;
- Viewer bundle digest mismatch;
- required VB observable unavailable;
- request tagging unavailable;
- META validation failure;
- capability mismatch;
- buffer bound too small;
- control failure before target capture;
- existing active authorization ambiguity;
- dirty protected state;
- procedure/harness digest mismatch.

Define which failures mean:

- do not consume attempt;
- consume attempt but classify invalid;
- stop before live invocation.

Do not change current authorization procedure.

---

# 16. Future run sequence

Write a precise future runbook **without executing it**.

At minimum:

### Phase 0 — static preflight
- clean repo;
- hashes;
- Viewer version;
- capability availability;
- controls;
- record authorization presence;
- output directory empty.

### Phase 1 — instrumentation initialization
- create META;
- install diagnostic hooks;
- verify hooks;
- no target action yet.

### Phase 2 — controls
- execute only if a future live authorization permits;
- validate controls;
- abort if controls fail.

### Phase 3 — target diagnostic sequence
- exactly defined request sequence;
- exact capture order;
- no acceptance retry semantics.

### Phase 4 — terminalization
- END record;
- flush;
- hash;
- freeze evidence;
- teardown/cleanup.

### Phase 5 — offline analysis
- correlate;
- verdict;
- evidence manifest.

This is design/preparation only; do not run it.

---

# 17. Authorization-boundary design

Design how a future authorization record would bind the diagnostic run.

Do not issue a record.

Define fields that should eventually be bound, such as:

- repo commit;
- harness digest;
- diagnostic package digest;
- Viewer version;
- Viewer bundle digest;
- exact command;
- exact model inputs;
- output location;
- exactly-one-attempt semantics;
- no retry;
- control requirements.

Do not alter the current authorization-record format unless a future owner decision explicitly authorizes it.

If the existing format cannot bind the required diagnostic state, record that as an owner decision rather than modifying it.

---

# 18. Offline preparation prototype

Create a research-only preparation/prototype directory, for example:

`docs/research/2026-10-06-g2-live-diagnostic-preparation/`

It may include:

- trace-schema validators;
- runbook validators;
- capability-matrix validator;
- synthetic future-live trace fixtures;
- evidence-manifest builder prototype;
- control-verdict evaluator;
- authorization-binding checker;
- dry-run configuration validator.

It must not:

- attach hooks to a real Viewer;
- launch a browser;
- invoke the live harness;
- modify production harness code.

---

# 19. Offline fixtures

Create synthetic fixtures for:

- valid complete trace;
- wrong Viewer version;
- wrong Viewer digest;
- missing VB-1;
- missing VB-3;
- missing request ID;
- pre-motion ambiguity;
- pending-clear/active-edge gap;
- control failure;
- truncated trace;
- overflow trace;
- META/data/END mismatch;
- stream digest mismatch;
- inconclusive C8 case.

Use these to test the future verdict logic.

---

# 20. Research-local tests

Add tests for at least:

- schema validity;
- capability gate;
- runbook validation;
- pre-motion ambiguity handling;
- pending-clear gap handling;
- positive/negative controls;
- evidence-manifest hashing;
- trace envelope integrity;
- fail-closed partial traces;
- verdict classification;
- authorization-binding validation;
- deterministic outputs.

Keep all tests research-local.

Do not modify production test registration.

---

# 21. Deterministic preparation verification

Run all new preparation tests.

Run preparation/prototype generation at least twice from clean output directories.

Verify:

- byte-identical outputs;
- stable IDs;
- stable hashes;
- stable verdict fixtures;
- no timestamps/randomness unless explicitly normalized.

Document commands and digest(s).

---

# 22. Decision gate for whether a live diagnostic is worthwhile

The package must conclude one of:

### A. Prepared and potentially worthwhile
The design can collect information that existing offline research cannot, and controls/integrity are sufficient.

### B. Prepared but currently not worthwhile
Instrumentation is sound, but unresolved ambiguity would still dominate.

### C. Not yet prepared
A design/integrity/control gap remains.

### D. Live diagnostic unnecessary
Offline evidence already answers the actionable question.

Give a concrete justification.

Do not authorize execution.

---

# 23. Internal review and autonomous remediation

Perform a full internal review covering:

- Viewer 7.124.2 source fidelity;
- minimal observable set;
- capture-point correctness;
- pre-motion handling;
- pending-clear gap handling;
- controls;
- trace envelope;
- evidence provenance;
- verdict model;
- authorization binding;
- runbook safety;
- offline prototype correctness;
- determinism;
- owner-boundary compliance.

Use explicit:

- Critical
- High
- Medium
- Low

Within this package:

- fix all Critical;
- fix all High;
- fix all Medium that do not cross owner-only boundaries;
- Low may be fixed or documented.

If substantial changes follow review, perform targeted re-review.

Do not return to owner for each in-scope fix.

---

# 24. Exit criteria

Continue autonomously until:

- design research complete;
- live-diagnostic preparation spec complete;
- runbook complete;
- controls defined;
- evidence/provenance design complete;
- offline preparation prototype complete;
- tests pass;
- deterministic outputs reproduced;
- internal review has no unresolved in-scope Critical/High/Medium;
- handoff updated;
- no protected path changed.

Then stop at:

**Ready for independent Work review**

---

# 25. Handoff

Update `docs/handoffs/latest.md` with:

- repo / branch / HEAD / working tree;
- baseline checkpoint:
  `f3bab74f460eacd6b6f69bc8fb90110455ceeb68`
- preparation package status;
- research/spec/runbook/prototype paths;
- test result;
- deterministic digest;
- minimum live instrumentation set;
- control status;
- pre-motion ambiguity handling;
- pending-clear gap handling;
- live-worthwhile verdict A/B/C/D;
- unresolved owner decisions;
- historical C8 remains unresolved unless this design-only work somehow proves otherwise—which it should not;
- no Viewer/live/retry/new record/reset;
- next action:
  **independent Work review of the future live-diagnostic design/preparation package**.

---

# 26. Commit policy

Do not commit or push.

Leave research/spec/runbook/prototype/tests/results/reviews/handoff changes uncommitted for independent Work review.

---

# 27. Prohibited

Do not:

- run Viewer/browser/live diagnostic;
- run G2 acceptance;
- retry G2;
- issue new authorization record;
- reset attempt state;
- change accepted procedure;
- change real harness runtime behavior;
- change T4/C6/C8 runtime behavior;
- mutate immutable evidence;
- start G3;
- commit;
- push.

---

# 28. Final report

Report:

- branch / HEAD / origin relation;
- files/directories created;
- research/spec/runbook/prototype paths;
- exact minimum instrumentation set;
- exact capture points;
- pre-motion ambiguity strategy;
- pending-clear gap strategy;
- controls;
- evidence envelope design;
- verdict model;
- authorization-binding findings;
- test results;
- deterministic digest(s);
- live-worthwhile verdict A/B/C/D;
- unresolved owner decisions;
- internal review C/H/M/L findings;
- autonomous remediations performed;
- working-tree state;
- exact owner-only boundaries not crossed;
- exact next gate:
  **independent Work review of G2 future live-diagnostic design/preparation package**.

Explicitly confirm:

- no Viewer/browser/live run;
- no G2 retry;
- no new authorization record;
- no attempt reset;
- no real harness/product/procedure change;
- no real T4/C6/C8 runtime change;
- immutable evidence unchanged;
- no commit;
- no push.
