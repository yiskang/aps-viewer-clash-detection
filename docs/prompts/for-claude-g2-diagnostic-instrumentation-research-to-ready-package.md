# For Claude — G2 Diagnostic Instrumentation Research-to-Ready Package

I explicitly authorize one **larger bounded G2 diagnostic-instrumentation package** that may proceed autonomously from research through a review-ready offline prototype, without returning for owner approval at every intermediate step.

The goal is to reduce per-step owner intervention while preserving the hard safety/governance boundaries around live G2 execution, acceptance semantics, and historical evidence.

This package may proceed through:

**research → diagnostic hypothesis refinement → specification/design → offline-only prototype → research-local tests → deterministic verification → internal review → in-scope remediation of Critical/High/Medium findings → handoff update**

and then stop at:

**Ready for independent Work review**

Do not stop for owner approval between those internal stages unless a protected boundary below is reached.

## 1. Authoritative baseline

Verify before starting:

- repo: `aps-viewer-clash-detection`
- branch: `main`
- committed baseline:
  `06980ee1e17b1268d4028ed9951c5f8462016cd2`
- `main == origin/main`
- tracked tree clean
- expected untracked historical artifacts remain:
  - three historical authorization records
  - older unrelated historical-live-artifacts checkpoint prompt
- committed harness SHA remains:
  `cc8868cd68b9c2c3382297070289a2aa165c74249c6d82896d76bacc6c6ef09b`
- accepted procedure SHA remains:
  `d1ccfde224b8ae76fe74b06c93abc532e6df9612933cafaa045053c8e2e45a75`
- immutable live evidence unchanged
- historical G2 remains:
  `FAIL (row 3)`
- historical C6 remains:
  `NOT_EVIDENCED`
- historical C8 remains unresolved
- real T4 runtime behavior unchanged
- no G2 retry
- no new authorization record
- no attempt reset

D2-OFFLINE checkpoint status:

- checkpoint:
  `06980ee1e17b1268d4028ed9951c5f8462016cd2`
- D2 tests:
  `55/55`
- offline suite:
  `5,155 total / 5,154 pass / 0 fail / 1 existing todo`
- exhaustive synthetic schedules:
  `52,308`
- D=30 characterization:
  `36`
- retained deterministic output digest:
  `e1d1b815ed351e6feba3e34822ba9895e54035158e685bfbe7f628f6d10bbb06`
- H2/H5 are mechanically supported only within the synthetic model
- C6/N2 remains synthetic outcome E with no accepted margin
- D=30 supports no inference
- historical C8 causality remains unresolved

Read:

- latest `docs/handoffs/latest.md`
- committed D0/D1 research
- accepted D2 spec
- D2 simulator/results/reviews
- historical G2 live evidence and independent verdict as read-only context
- current real harness T4/C6/C8 code as read-only reference
- pinned Viewer 7.124.2 source used by prior D0 work

If repository state materially differs, stop and report before proceeding.

## 2. Larger-batch autonomy rules

Within this package, you may autonomously:

- perform source-code research;
- inspect Viewer 7.124.2 behavior;
- refine diagnostic hypotheses;
- create research reports;
- create a diagnostic-instrumentation design/spec;
- implement an **offline-only diagnostic prototype**;
- create research-local schemas/trace models;
- add research-local tests;
- run deterministic offline experiments;
- revise research/spec/prototype based on internal findings;
- fix Critical / High / Medium findings that remain inside the authorized package boundary;
- update research artifacts;
- persist internal reviews under `docs/reviews/`;
- update `docs/handoffs/latest.md`.

Do **not** stop for owner approval merely because:

- an internal review finds a fixable Critical/High/Medium inside this offline research package;
- a research assumption needs clarification;
- a local schema/API inside the research package needs revision;
- the prototype/tests need bounded remediation.

Fix these autonomously and continue until the package is ready for independent Work review.

## 3. Hard owner-only boundaries

Stop immediately and request owner authorization if the work would require any of the following:

1. change to accepted G2 procedure or acceptance contract;
2. change to real T4 semantics;
3. change to real C6/N2 runtime behavior;
4. change to real C8 runtime/oracle behavior;
5. change to production/harness behavior;
6. Viewer/browser/live diagnostic execution;
7. G2 retry;
8. new authorization-record issuance;
9. attempt reset;
10. mutation of immutable historical evidence;
11. milestone transition / G3 work;
12. production implementation outside the research package.

These remain owner-only gates.

## 4. Package objective

The purpose of this package is to determine what **diagnostic instrumentation would be necessary to discriminate the remaining historical C8 uncertainty**, while avoiding premature live work.

The package must answer:

- Which hypotheses remain plausible after D0/D1/D2?
- Which observations would distinguish them?
- Which observations are available from public Viewer APIs?
- Which require undocumented/version-bound observables?
- Which can be simulated or validated offline?
- Which cannot be resolved without a separately authorized live diagnostic?
- What is the smallest safe diagnostic data model that would let a later live run distinguish:
  - request issuance;
  - pending-slot ownership;
  - transition consumption;
  - transition start;
  - camera-write ownership;
  - restore interaction;
  - settle/T4 observation;
  - formal completion;
  - event delivery;
  - frustum measurement timing?

Do not assume live instrumentation is necessary until the research proves it.

## 5. Research phase

Create a focused research artifact under:

`docs/research/`

Use a descriptive filename such as:

`2026-10-05-g2-diagnostic-instrumentation-research.md`

Research at minimum:

### 5.1 Remaining hypotheses

Reconcile prior D0/D1/D2 findings into a compact hypothesis set.

At minimum address:

- pre-motion observation;
- completion-to-next-consumption gap;
- restore followed by held/pending request;
- quiet/sub-epsilon transition tail;
- event/request correlation ambiguity;
- camera ownership ambiguity;
- possible harness observation timing gaps;
- product navigation behavior vs harness observation artifact.

Do not invent historical causality.

### 5.2 Observable matrix

For each hypothesis, list candidate observables:

- public Viewer API/event;
- version-bound undocumented Viewer state;
- synthetic/offline surrogate;
- unavailable without live instrumentation.

For each observable, record:

- exact source/location;
- semantic meaning;
- timing/ownership limitations;
- request identity availability;
- whether it is safe for:
  - offline research;
  - separately authorized diagnostic;
  - production/acceptance use.

### 5.3 Discriminating power

Build a hypothesis × observable matrix showing which observation would:

- rule in;
- rule out;
- fail to distinguish

each hypothesis.

Prefer the minimum observable set that maximizes discrimination.

### 5.4 Version-bound internals

If undocumented Viewer internals are needed:

- pin them to Viewer `7.124.2`;
- cite exact source/module/function/property;
- treat them as diagnostic/research-only;
- do not propose them as production or acceptance dependencies without procedure re-acceptance.

### 5.5 Historical evidence mapping

Map retained historical live evidence to the hypothesis matrix.

State exactly:

- what is already known;
- what remains missing;
- what cannot be reconstructed;
- what one additional observation would have changed.

## 6. Diagnostic-instrumentation specification

Create a concrete specification under:

`docs/research/` or the repo's established spec location if clearly appropriate.

This is **not** an acceptance-procedure amendment.

Specify at minimum:

### 6.1 Diagnostic event schema

Design a bounded event/trace schema with fields such as:

- frame/tick index;
- monotonic sequence number;
- request token;
- request type;
- pending-slot token;
- active-transition token;
- transition progress/state;
- camera-write owner token;
- restore token/state;
- event type;
- event dispatch time;
- settle sample index;
- T4 equal/not-equal decision;
- camera sample digest or bounded numeric sample;
- formal completion state;
- frustum observation metadata;
- source classification:
  - public API
  - version-bound internal
  - synthetic/offline

Use only fields justified by the research.

### 6.2 Correlation model

Define how a later diagnostic run could correlate:

- request issuance
- pending ownership
- transition ownership
- camera writes
- completion
- events
- T4 samples
- C8/frustum observation

Avoid relying on event order alone if request identity can be captured.

### 6.3 Fail-closed semantics

Define what happens if:

- a required observable is absent;
- request identity is ambiguous;
- event ordering is contradictory;
- trace truncation occurs;
- diagnostic buffer overflows;
- version-bound internal path is unavailable.

Do not silently classify ambiguous diagnostics as proof.

### 6.4 Bounded output

Specify strict limits for:

- maximum events;
- per-event size;
- total trace size;
- retained camera samples;
- witness retention.

No unbounded diagnostic logs.

### 6.5 Privacy / evidence integrity

The diagnostic schema must avoid unnecessary local paths or unrelated model data.

If future live outputs would become evidence, define:

- immutable capture;
- hashes;
- provenance;
- version/runtime metadata;
- no post-hoc mutation.

Do not create live evidence now.

## 7. Offline prototype

Implement a research-only prototype under a new D2-adjacent research directory, for example:

`docs/research/2026-10-05-g2-diagnostic-instrumentation/`

Keep all code research-local.

Do not modify production or acceptance harness code.

The offline prototype should:

- ingest synthetic D2 transition traces;
- emit the proposed diagnostic event schema;
- correlate request/pending/transition/camera ownership;
- model missing/ambiguous observables;
- classify whether each synthetic schedule would be diagnosable under:
  - public-only observables;
  - public + version-bound diagnostic observables;
  - ideal tagged oracle.

## 8. Diagnostic sufficiency experiment

Use the committed D2 synthetic schedules to answer:

- What fraction of relevant schedules can be distinguished using public-only observables?
- What ambiguities remain?
- What additional version-bound observable resolves each ambiguity?
- Is request identity necessary?
- Is transition-active state necessary?
- Is pending-slot identity necessary?
- Is camera-write ownership necessary?
- Is formal completion state necessary?

Create a deterministic summary.

Do not reinterpret D2 synthetic support as historical proof.

## 9. Minimal instrumentation set

From the experiment, derive:

- **minimum sufficient diagnostic set**
- **nice-to-have observables**
- **redundant observables**
- **unsafe/unnecessary observables**

The final recommendation should aim for the smallest instrumentation footprint that can actually distinguish the target hypotheses.

## 10. Public-only vs version-bound comparison

Produce a clear comparison:

### Public-only diagnostic
- what it can prove;
- what remains ambiguous.

### Public + version-bound diagnostic
- what additional ambiguity is removed;
- exact Viewer 7.124.2 internals required;
- failure behavior if those internals are unavailable.

Do not recommend undocumented internals unless the added discriminating value is demonstrated.

## 11. Offline tests

Add research-local tests only.

Test at minimum:

- event schema validation;
- request correlation;
- ambiguous request identity;
- missing pending-slot identity;
- transition ownership;
- restore interaction;
- T4 sample correlation;
- C8 observation timing correlation;
- trace overflow fail-closed behavior;
- deterministic output;
- public-only ambiguity cases;
- version-bound resolution cases.

Do not add production-suite integration unless separately authorized.

## 12. Deterministic verification

Run the offline diagnostic prototype at least twice from clean output directories.

Verify:

- byte-identical outputs;
- stable event IDs;
- stable schedule IDs;
- stable classification;
- stable summary hashes.

Document exact commands and output digest(s).

## 13. Internal review and autonomous remediation

Perform a focused internal review covering:

- research fidelity;
- hypothesis completeness;
- Viewer-source fidelity;
- public/internal observable classification;
- schema sufficiency;
- correlation soundness;
- fail-closed behavior;
- output bounds;
- determinism;
- historical/synthetic separation;
- no-overclaim discipline;
- scope discipline.

Use explicit:

- Critical
- High
- Medium
- Low

Within this authorized package:

- fix all genuine Critical findings;
- fix all genuine High findings;
- fix Medium findings if they do not require crossing an owner-only boundary;
- Low findings may be fixed or documented.

You may perform additional internal review after substantial remediation if useful.

Do not ask the owner to approve each in-scope remediation.

## 14. Package exit criteria

Continue autonomously until all are true:

- research artifact complete;
- diagnostic spec complete;
- offline prototype implemented;
- research-local tests passing;
- deterministic runs reproduced;
- internal review completed;
- no unresolved Critical;
- no unresolved High;
- no unresolved Medium that can be fixed without crossing an owner-only boundary;
- handoff updated;
- no protected path changed.

Then stop at:

**Ready for independent Work review**

## 15. Handoff requirements

Update `docs/handoffs/latest.md` with:

- repo / branch / HEAD / working tree;
- baseline checkpoint `06980ee1...`;
- diagnostic research package status;
- research artifact path;
- diagnostic spec path;
- prototype path;
- test result;
- deterministic output digest;
- minimum instrumentation recommendation;
- public-only sufficiency verdict;
- version-bound observable necessity verdict;
- unresolved decisions;
- historical C8 still unresolved unless actually proven otherwise—which this package should not claim;
- no live diagnostic/retry/new record/reset;
- next action:
  **independent Work review of the diagnostic instrumentation research-to-ready package**.

## 16. Commit policy

Do not commit or push during this package.

Leave research/spec/prototype/tests/results/reviews/handoff changes uncommitted for independent Work review.

A later standing workflow may allow automatic checkpoint after a clean Work review, but that is not part of this package unless separately authorized.

## 17. Prohibited

Do not:

- change accepted G2 procedure;
- change real T4 semantics;
- change real C6/N2 behavior;
- change real C8 behavior;
- modify production/harness runtime behavior;
- run Viewer/browser/live diagnostic;
- retry G2;
- issue new authorization record;
- reset attempt state;
- mutate immutable evidence;
- begin G3;
- commit;
- push.

## 18. Final report

Report:

- branch / HEAD / origin relation;
- files/directories created;
- research artifact path;
- diagnostic spec path;
- prototype path;
- test results;
- deterministic run digest(s);
- hypothesis matrix summary;
- public-only diagnostic sufficiency;
- public + version-bound sufficiency;
- minimum instrumentation set;
- unresolved ambiguities;
- internal review C/H/M/L findings;
- remediations performed autonomously;
- working-tree state;
- exact owner-only boundaries not crossed;
- exact next gate:
  **independent Work review of G2 diagnostic instrumentation research-to-ready package**.

Explicitly confirm:

- no real harness/product/procedure change;
- no real T4/C6/C8 runtime change;
- no Viewer/browser/live run;
- no G2 retry;
- no new authorization record;
- no attempt reset;
- immutable evidence unchanged;
- no commit;
- no push.
