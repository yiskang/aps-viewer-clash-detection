# For Claude — Authorize Exactly One Live G1 F1–F8 Execution

I explicitly authorize **exactly one live G1 SVF2 F1–F8 execution** using the accepted harness already merged into local `main`.

This authorization is for one live execution attempt only.

It does **not** authorize:
- retries to obtain a green result;
- production fixes;
- harness redesign;
- G2;
- G3;
- H1;
- H2;
- OQ-1;
- host integration;
- Viewer Adapter changes;
- Core changes;
- M4 changes;
- Viewer Clash Panel production changes;
- Viewer initializer changes;
- Viewer version changes;
- model upload or retranslation;
- any next milestone.

## Repository preflight

Before the live run:

1. Verify the repository currently in scope.
2. Read:
   - `CLAUDE.md`
   - `docs/handoffs/latest.md`
   - the accepted G1 F1–F8 harness implementation/review artifacts
   - the accepted harness build plan
3. Verify:
   - branch: `main`
   - working tree is clean
   - the harness implementation is independently accepted
   - live F1–F8 has never been run before
   - G2/G3/H1/H2/OQ-1/host integration remain unauthorized

If repository state materially differs, stop and report before running anything.

## Runtime preflight

Before consuming the one live attempt, verify all required prerequisites without beginning F1–F8:

- required credentials/environment are available;
- Playwright Chromium is available;
- the accepted existing model/fixture is available;
- the harness will use `env: 'AutodeskProduction2'` and `api: 'streamingV2'`;
- Viewer version is the reviewed pinned version;
- activation interlock conditions are explicitly satisfied;
- no production Viewer initializer is modified;
- evidence output paths are writable.

A pure preflight failure does **not** count as the one live F1–F8 attempt if no real model load/F1–F8 execution has started.

If prerequisites are missing, stop and report exactly what is missing.

## Exactly one live attempt

Once the real SVF2 model load / F1–F8 execution begins:

- that is the single authorized live attempt;
- do not retry;
- do not restart with changed parameters;
- do not weaken assertions;
- do not switch to SVF;
- do not change Viewer version;
- do not alter the harness to chase a PASS.

Run the accepted harness exactly as reviewed.

## Evidence requirements

Preserve the complete evidence from the one run, including:

- raw machine-readable JSON;
- raw/live log where available;
- human-readable research/report artifact;
- exact command;
- timestamps;
- branch and HEAD;
- Node / Playwright / Chromium / Viewer versions;
- model/URN;
- initializer `env` / `api`;
- `isOTG()` / `isSVF2()`;
- Viewer-script identity/hash evidence;
- classifier result;
- F1–F8 results;
- all mandatory-control results;
- control target evidence;
- console/page/runtime error ledger;
- cleanup result;
- overall PASS / FAIL / PARTIAL / BLOCKED verdict;
- warnings and limitations.

Do not summarize away failures.

## Verdict discipline

Use the implemented reviewed verdict model exactly.

Do not reinterpret FAIL, BLOCKED, or PARTIAL as PASS.

Do not manually override the harness verdict.

If the harness produces FAIL, PARTIAL, or BLOCKED:
- preserve it;
- do not fix anything;
- do not rerun.

## If a failure occurs

If the live attempt fails or becomes partial/blocked:

1. preserve the exact evidence;
2. classify the likely failure area only from retained evidence;
3. do not implement remediation;
4. stop for independent Work verification and owner decision.

## Scope boundaries

Do not start or execute:

- G2 live ViewerBridge/DockingPanel verification;
- G3 full Panel live acceptance;
- H1 host composition/routes/toolbar;
- H2 OQ-1/placement/measurement-basis host evidence;
- host integration;
- production runtime migration to `AutodeskProduction2` / `streamingV2`;
- production Viewer initializer changes.

This live G1 run is evidence collection only.

## After the run

After the single attempt:

1. persist the live G1 research/evidence artifacts under the established `docs/research/` / `docs/research/evidence/` structure;
2. update `docs/handoffs/latest.md` with the exact G1 verdict, evidence envelope, F1–F8 statuses, residuals, and current authorization state;
3. do not modify production or harness implementation;
4. do not commit or push unless separately authorized.

## Stop gate

Stop immediately after evidence persistence and handoff update.

Do not:
- rerun live F1–F8;
- fix failures;
- start G2/G3;
- start H1/H2;
- start OQ-1;
- start host integration;
- modify production code;
- begin the next milestone.

The next gate is:

**independent ChatGPT Work verification of the single live G1 execution → owner decision**

## Final report

Report:

- branch;
- HEAD before and after;
- working-tree state;
- exact live command;
- confirmation this was the only live attempt;
- runtime versions;
- model used;
- `env` / `api`;
- `isOTG()` / `isSVF2()`;
- F1–F8 results;
- mandatory-control results;
- overall verdict;
- warnings/residuals;
- evidence artifact paths;
- whether any files were committed or pushed.

Explicitly confirm:

- there was no retry;
- no production fix was made;
- G2/G3 were not started;
- H1/H2 were not started;
- OQ-1/host integration were not started;
- no Viewer Adapter/Core/M4/Panel production changes were made.

Stop after the single live G1 execution evidence is recorded.
