# Prompt — Authorize Non-Production SVF2 Diagnostic Harness Only

I explicitly authorize a **separate, non-production SVF2 diagnostic harness** to test whether the Viewer initializer configuration is the immediate blocker for G1.

This authorization is deliberately narrow.

It does **not** authorize:

- modifying the production Viewer initializer;
- changing `wwwroot/viewer.js`;
- changing production/runtime host configuration;
- running full G1 F1–F8 verification;
- starting G2/G3/H1/H2;
- starting OQ-1;
- starting host integration;
- modifying Viewer Adapter, Core, Viewer Clash Panel production code, or M4;
- uploading or translating a new model;
- changing Viewer version unless separately authorized;
- fixing Agent Kit skills or routing.

## Repository-first verification

Before any work:

1. Verify the repository currently in scope.
2. Read:
   - `CLAUDE.md`
   - `docs/handoffs/latest.md`
   - the existing G1 blocked-verification evidence
   - `docs/research/2026-09-27-g1-svf2-agent-kit-and-initializer-diagnosis.md` or the actual current diagnosis artifact
3. Verify:
   - branch
   - HEAD
   - working-tree state
   - current production Viewer initializer
   - G1 remains blocked
   - G2/G3/H1/H2 remain unauthorized

Treat repository state as authoritative.

If the current repository state materially differs from the recorded diagnosis, stop and report before creating the harness.

---

# Purpose

Determine whether this initializer configuration is sufficient to make an existing model live-load as SVF2/OTG:

```js
env: 'AutodeskProduction2',
api: 'streamingV2'
```

The test must isolate initializer/load-path behavior from production runtime behavior.

The goal is **not** to prove all G1 F1–F8 assumptions.

The goal is only to answer:

> With an existing model already available to this repo, does a separate non-production Viewer page using the SVF2 initializer path load the model as true SVF2/OTG?

---

# Harness isolation requirement

Create a separate diagnostic-only harness.

It must:

- live outside the production Viewer initialization path;
- not modify `wwwroot/viewer.js`;
- not replace the app's normal Viewer configuration;
- not be wired into the production app;
- not be added to normal user-facing navigation;
- not become part of Viewer Clash Panel runtime behavior;
- be clearly marked diagnostic/test-only.

Use an appropriate existing test/diagnostic location consistent with repository conventions.

If the repository already has an established live acceptance/diagnostic page pattern, reuse that pattern rather than inventing a production-facing route.

Do not create host integration.

---

# Initializer under test

The diagnostic harness must initialize Viewer with exactly the intended SVF2 path:

```js
Autodesk.Viewing.Initializer({
  env: 'AutodeskProduction2',
  api: 'streamingV2',
  getAccessToken
}, ...)
```

Use the existing Viewer version already pinned by the current repo unless the existing diagnostic environment makes that impossible.

Do not change Viewer version as part of this authorization.

Record the exact Viewer version/script URL used.

---

# Existing model only

Use an **existing model already available to this repo/account**.

Do not:

- upload a new source file;
- submit a new Model Derivative translation;
- mutate APS storage;
- create a new persistent fixture.

Prefer a model from the previous G1 candidate set where manifest evidence advertises SVF2.

Record:

- model name/source;
- URN/object identifier as appropriate;
- the pre-existing derivative/manifest evidence;
- why this candidate was selected.

If no suitable existing model can be identified without mutation, stop and report that prerequisite instead of creating one.

---

# Diagnostic checks

Run only the minimum live checks needed to establish model format/runtime path.

Record:

1. Viewer initializer:
   - `env`
   - `api`
   - Viewer version
2. Model load success/failure
3. Runtime model flags:
   - `model.isOTG()` if available
   - `model.isSVF2()` if available
4. Any equivalent accepted Viewer runtime evidence that distinguishes:
   - legacy SVF
   - OTG
   - SVF2
5. Console errors
6. Page exceptions
7. Document/model load errors
8. Any obvious fallback signal visible in the current load path

A model counts as confirmed for the intended G1 precondition only if the live runtime evidence supports true SVF2/OTG according to the Viewer APIs available in the pinned version.

Do not infer success from manifest metadata alone.

---

# Allowed outcomes

Classify the result as exactly one of:

## H1 — Initializer confirmed as the blocker

The existing model:

- failed the previous legacy initializer path; and
- loads through the diagnostic harness with SVF2/OTG runtime evidence.

This establishes that the initializer/load path was the immediate blocker.

Next step would be a separate owner decision about how G1 should consume a non-production SVF2 harness and whether production/host configuration needs later H1/H2 work.

Do not run F1–F8 in this task.

## H2 — Correct initializer still does not produce SVF2

The diagnostic harness uses:

- `AutodeskProduction2`
- `streamingV2`

but the selected model still does not live-load as SVF2/OTG.

Record the exact runtime evidence.

Do not change Viewer version, translation, or model.

The next owner decision may be fixture/derivative investigation.

## H3 — Diagnostic harness cannot load the model

The intended initializer is correct, but model/document loading fails for another reason.

Record the exact failure and stop.

## H4 — Insufficient runtime API evidence

The model loads, but the pinned Viewer does not expose enough reliable runtime evidence to distinguish SVF2/OTG as required.

Record what is and is not available.

## H5 — Existing fixture prerequisite unavailable

No existing model can be used without upload/retranslation/mutation.

Stop and report that the next decision is whether to authorize a controlled SVF2 fixture.

---

# No F1–F8 yet

Even if the diagnostic returns H1 and confirms:

```js
isOTG() === true
isSVF2() === true
```

do **not** continue into:

- F1 owner mapping
- F2 population/root checks
- F3 readiness characterization
- F4 geometry/collision reads
- F5 limit checks
- F6 unload/reload
- F7 Viewer API integration assumptions
- F8 dbId consistency

Those require a separate explicit G1 continuation authorization after this diagnostic result is independently reviewed.

---

# No production fix

Do not modify:

- `wwwroot/viewer.js`
- production initializer configuration
- production server routes
- Viewer Clash Panel production code
- Viewer Adapter
- Core
- M4

Do not reinterpret the diagnostic harness as the production solution.

If the diagnostic proves the production initializer is legacy, record that as a host/runtime integration dependency only.

---

# Agent Kit finding

Preserve the already discovered Agent Kit result:

- SVF2 initializer/runtime loading knowledge is absent from the current Agent Kit formal knowledge;
- current skill routing would not have triggered for this live-Viewer verification path.

Do not modify Agent Kit skills or routing in this task.

Reference the existing diagnosis artifact rather than duplicating a new Agent Kit investigation.

---

# Evidence

Persist a focused diagnostic artifact under:

`docs/research/`

Suggested filename:

`docs/research/2026-09-27-g1-svf2-diagnostic-harness-result.md`

Record:

- branch / HEAD;
- harness files created;
- exact command;
- Viewer version;
- initializer env/api;
- existing model used;
- manifest/derivative evidence;
- live `isOTG()` result;
- live `isSVF2()` result;
- console/page errors;
- H1/H2/H3/H4/H5 disposition;
- limitations;
- recommended next owner action.

Retain raw evidence under `docs/research/evidence/` if useful and consistent with repo convention.

Update `docs/handoffs/latest.md` to record:

- G1 remains not yet completed;
- diagnostic result;
- production initializer remains unchanged;
- no F1–F8 run occurred;
- G2/G3/H1/H2 remain unauthorized;
- next authorized action: none / awaiting independent Work review and owner decision.

---

# Review

After the diagnostic:

- perform only a bounded internal sanity review of the harness/evidence;
- do not turn it into a broad Viewer/Panel review;
- do not fix production behavior based on the outcome.

The next gate is:

**independent ChatGPT Work review of the diagnostic evidence → owner decision**

---

# Commit / push

Do not commit or push unless separately authorized.

Keep any diagnostic harness clearly isolated and reviewable in the working tree.

---

# Final report

Report:

- branch;
- HEAD;
- working-tree state;
- files created/modified;
- exact diagnostic command;
- Viewer version;
- initializer `env`;
- initializer `api`;
- selected existing model;
- derivative evidence;
- `isOTG()` result;
- `isSVF2()` result;
- H1/H2/H3/H4/H5 disposition;
- whether production initializer changed;
- whether any model was uploaded or translated;
- whether F1–F8 was run;
- artifact paths.

Explicitly confirm:

- no production Viewer initializer was changed;
- no production code was changed;
- no upload or translation occurred;
- no G1 F1–F8 verification was run;
- no G2/G3/H1/H2/OQ-1/host integration work was started;
- no Agent Kit skill/routing change was made.

Stop after the diagnostic harness result.
