# Prompt — Authorize G1: Bounded SVF2 Verification Only

I explicitly authorize **G1 — bounded SVF2 verification only** for the Viewer Clash Panel milestone.

This authorization does **not** include G2, G3, H1, H2, implementation changes, host integration, OQ-1, or any production fix.

## Repository baseline

Before starting:

1. Verify the repository currently in scope.
2. Read:
   - `CLAUDE.md`
   - `docs/handoffs/latest.md`
   - `docs/superpowers/specs/2026-09-26-viewer-clash-panel-design.md`
   - `docs/superpowers/plans/2026-09-26-viewer-clash-panel-implementation-plan.md`
   - the latest T1–T33 implementation reviews and closeout artifacts under `docs/reviews/`
   - the historical Viewer Adapter T3 / OQ-4 evidence under `docs/research/` and `docs/reviews/`
3. Verify:
   - branch: `main`
   - expected baseline: `0a58354`
   - `main == origin/main`
   - working tree is clean
   - T1–T33 is accepted, merged, and pushed
   - G1 is the currently authorized action
   - G2, G3, H1, H2, SVF2 Panel live acceptance, OQ-1, and host integration remain unauthorized

If repository state materially differs, stop and report before running G1.

Treat repository artifacts as authoritative.

---

# G1 purpose

G1 closes the remaining **SVF2 / OTG evidence gap** after:

- historical Viewer Adapter live evidence on **SVF non-OTG** only;
- completed Viewer Clash Panel T1–T33 implementation using format-agnostic code and fakes.

The purpose of G1 is to determine whether the existing Viewer Adapter / collision execution assumptions hold on **SVF2 / OTG-loaded models**.

G1 is verification, not implementation.

Do not change production code to make G1 pass.

---

# Model-format requirement

For this gate:

- models must load as **SVF2 / OTG**;
- verify and record `isOTG === true` or the repository's accepted equivalent evidence;
- do not substitute plain SVF;
- do not treat historical SVF evidence as proof of SVF2 behavior;
- do not add a format selector or fallback-to-SVF behavior.

If SVF2 cannot actually be obtained/loaded in the required harness, stop and record the environment/prerequisite failure rather than weakening the gate.

---

# Verify F1–F8

Use the governing design/plan wording for the exact normative definitions. Verify the current accepted F1–F8 assumptions under SVF2.

At minimum, G1 must characterize and retain evidence for:

## F1 — fragment-to-owner mapping

Verify that under SVF2:

- fragment IDs resolve to the expected owning dbIds/elements;
- owner mapping is internally consistent across the tested population;
- no unexplained owner-mapping failures appear.

Record counts and any mismatches.

## F2 — tree / fragment population and whole-model roots

Verify:

- object-tree accessibility;
- fragment population visibility;
- whole-model roots / root derivation behavior;
- population counts and root counts as used by the existing Adapter contracts.

Do not assume SVF population characteristics must numerically match historical SVF evidence.

## F3 — readiness order

Verify the actual SVF2 readiness/event ordering relied on by the Adapter.

Record:

- which Viewer/model readiness signals occur;
- when the instance tree and fragment data become safely readable;
- whether the existing readiness gate is sufficient.

Do not modify readiness logic if a discrepancy appears.

## F4 — collision-layer per-fragment / geometry reads

Verify that the existing collision path can read the SVF2 data it requires for the bounded test population.

This includes the currently accepted per-fragment / geometry access required by the existing collision engine and Viewer Adapter.

If an existing contract fails under SVF2, record the exact API/data assumption and stop short of fixing it.

## F5 — existing limits under SVF2

Verify the observed SVF2 population against existing accepted limits, including as applicable:

- fragment counts;
- per-element fragment counts;
- child fanout;
- collision population ceilings.

Do not invent or change resource limits.

## F6 — unload / reload behavior

Characterize the existing Adapter lifecycle behavior under SVF2:

- unload;
- registration removal / eviction behavior already owned by the Adapter/host boundary;
- same-URN reload behavior where the existing G1 harness permits it;
- stale-event protection.

Do not start host integration or OQ-1 work.

Any cross-reload identity/digest observation remains characterization unless the governing G1 contract explicitly requires more.

## F7 — Viewer API behavior relevant to later Panel integration

Verify only the Viewer API assumptions required by G1 and explicitly identified by the accepted design as SVF2 evidence gaps.

This may include, where the design says G1 owns the check:

- element/dbId visibility;
- model/unit metadata availability;
- bounds / geometry access needed by existing contracts.

Do **not** run G2-style live ViewerBridge / DockingPanel behavior.

In particular, do not start live Panel markers, isolation, fit/focus, or DockingPanel acceptance if those belong to G2.

## F8 — dbId consistency across SVF2 data surfaces

Verify that dbIds used by the relevant SVF2 surfaces are mutually consistent for the tested model population, including the accepted relationships among:

- fragment ownership;
- object tree;
- element identity used by the Adapter/collision path.

Do not expand this into OQ-1 durable host identity derivation.

---

# Boundaries between G1 and later gates

## G2 remains unauthorized

Do not perform the live ViewerBridge / DockingPanel verification gate.

Do not use G1 as an excuse to validate the real Panel UI.

## G3 remains unauthorized

Do not run full Viewer Clash Panel live acceptance.

## H1 remains unauthorized

Do not implement:

- host routes;
- toolbar integration;
- extension composition;
- production host registration wiring.

## H2 remains unauthorized

Do not implement or solve:

- OQ-1;
- production modelKey derivation;
- placement invalidation;
- host measurement-basis evidence plumbing;
- host reload/re-registration architecture.

G1 may expose evidence relevant to H1/H2. Record it; do not implement it.

---

# No production fixes during G1

If G1 finds a failure:

1. preserve the failure evidence;
2. classify it as precisely as possible, for example:
   - harness/environment;
   - Viewer SVF2 behavior;
   - Viewer Adapter contract;
   - collision/Core contract;
   - readiness/lifecycle assumption;
   - unresolved / unknown;
3. identify the smallest suspected affected area;
4. stop for independent review and owner authorization.

Do not:

- modify Viewer Adapter;
- modify Core;
- modify Viewer Clash Panel production code;
- modify M4;
- relax assertions;
- switch to SVF;
- retry with changed semantics merely to obtain a pass.

A rerun is allowed only if the accepted G1 procedure itself explicitly requires repeated observations. Otherwise preserve the first valid run and explain any rerun.

---

# Evidence requirements

Persist G1 evidence durably in the repository.

Use the established artifact roles:

- `docs/research/` for the live SVF2 verification report / characterization evidence;
- `docs/research/evidence/` for retained machine-readable/raw evidence where appropriate;
- `docs/reviews/` for any substantial internal verification/review;
- `docs/handoffs/latest.md` for operational status.

Record at minimum:

- date/time;
- branch and HEAD;
- exact command(s);
- Node version;
- Playwright/Chromium version;
- Viewer version;
- actual model(s) used;
- proof the model(s) loaded as SVF2 / OTG;
- each F1–F8 result;
- counts/metrics needed to support the conclusions;
- console/page errors;
- PASS / FAIL / PARTIAL verdict;
- explicit evidence envelope and limitations.

Do not overclaim beyond the exact model/runtime envelope tested.

---

# Test/runtime discipline

Use the existing accepted live harness patterns where applicable.

Before execution:

- verify required credentials/environment are available;
- verify Chromium/browser prerequisites;
- verify the requested SVF2 model path is actually available;
- verify no production files are modified.

If prerequisites are missing:
- stop;
- report exactly what is missing;
- do not substitute mocks or SVF.

After execution:

- do not automatically fix failures;
- do not proceed to G2/G3/H1/H2.

---

# Review and handoff

After G1 execution:

1. create/update the G1 research/evidence artifact;
2. perform the planned internal evidence sanity check/review if repository convention requires it;
3. update `docs/handoffs/latest.md`.

The handoff must state:

- G1 status;
- exact SVF2 evidence envelope;
- whether F1–F8 passed, failed, or remain partially unverified;
- blockers/residuals;
- G2, G3, H1, and H2 remain unauthorized;
- next authorized action: none / awaiting independent Work verification and owner decision.

Do not claim Viewer Clash Panel production-ready status from G1 alone.

---

# Stop gate

Stop after G1 evidence collection and documentation.

Do NOT:

- start G2;
- start G3;
- start H1;
- start H2;
- run full Panel live acceptance;
- start OQ-1;
- start host integration;
- modify production code;
- start another milestone;
- merge/push unrelated work unless separately authorized.

The next gate is:

**independent ChatGPT Work verification of G1 evidence → owner decision**

---

# Final report

Report:

- branch;
- starting HEAD;
- ending HEAD;
- working-tree state;
- exact G1 command(s);
- runtime versions;
- model(s) used;
- proof of SVF2 / OTG loading;
- F1 result;
- F2 result;
- F3 result;
- F4 result;
- F5 result;
- F6 result;
- F7 result;
- F8 result;
- overall G1 PASS / FAIL / PARTIAL verdict;
- warnings/residuals;
- artifact paths;
- whether any production file changed;
- whether anything was committed or pushed.

Explicitly confirm:

- G2 was not started;
- G3 was not started;
- H1 was not started;
- H2 was not started;
- no OQ-1 work was started;
- no host integration was started;
- no Viewer Adapter/Core/M4/Panel production fix was made.

Stop after the G1 verification gate.
