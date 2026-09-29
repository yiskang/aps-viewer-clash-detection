# For Claude — Fresh Exactly-One Live G1 F1–F8 Execution Against Mechanical

I explicitly authorize **one fresh live G1 SVF2 F1–F8 execution against `Audubon_Mechanical_clash_test.rvt`** from the current accepted baseline.

This is a **new owner authorization for exactly one live attempt**.

## Baseline

Before execution, verify:

- branch: `main`
- local `main` = `origin/main`
- expected baseline HEAD: `b811888`
- working tree: clean
- configured G1 fixture is exactly:
  `Audubon_Mechanical_clash_test.rvt`
- configured URN matches the committed fixture-switch evidence
- the accepted screening evidence records:
  - 1,496 fragments
  - 1,257 roots
  - max active triangles 4,228
  - all measured existing G1 limits within bounds
- G2/G3/H1/H2/OQ-1/host integration remain unauthorized

If the actual repository state materially differs, stop and report before any live execution.

## Exactly one fresh live attempt

After preflight succeeds, execute the accepted G1 harness exactly once.

Once the real SVF2 model load / F1–F8 sequence begins:

- this authorization is consumed;
- do not retry;
- do not rerun with changed parameters;
- do not switch to Structure or RAC;
- do not weaken assertions;
- do not patch the harness during the run;
- do not change Viewer version;
- do not change initializer behavior;
- do not change limits or G1 semantics.

## Runtime constraints

Use the accepted runtime path:

- fixture: `Audubon_Mechanical_clash_test.rvt`
- `env: 'AutodeskProduction2'`
- `api: 'streamingV2'`
- reviewed pinned Viewer version
- existing accepted model/URN only

Do not:

- modify production `wwwroot/viewer.js`;
- change production Viewer initialization;
- upload/retranslate a model;
- change Viewer version;
- modify Core/Adapter/M4/Panel production code.

## Evidence retention

Persist the complete evidence from this single run.

At minimum retain:

- exact command
- start/end timestamp
- branch / HEAD
- Node / Playwright / Chromium / Viewer versions
- model name / URN
- initializer `env` / `api`
- `isOTG()` / `isSVF2()`
- Viewer script hash/integrity state
- classifier state
- F1–F8 results
- F1 digest details / mismatch records / oracle errors as applicable
- F4 consumer details
- F5 limit evidence
- all mandatory-control results
- control target evidence
- console/page/runtime error ledger
- cleanup result
- overall verdict
- warnings/residuals/limitations

Retain:

- raw machine-readable JSON
- raw/live log
- human-readable research report

Do not summarize away failures.

## Verdict discipline

Use the implemented reviewed verdict exactly.

Do not manually reinterpret FAIL, BLOCKED, PARTIAL, or PASS.

If the harness returns anything other than PASS:

- preserve it exactly;
- do not fix anything;
- do not rerun;
- stop for independent Work verification and owner decision.

## Scope boundaries

This authorization does **not** include:

- G2 live ViewerBridge / DockingPanel verification
- G3 full Panel live acceptance
- H1 host composition / routes / toolbar
- H2 OQ-1 / placement invalidation / measurement-basis host evidence
- OQ-1
- host integration
- Core changes
- Viewer Adapter changes
- M4 changes
- Viewer Clash Panel production changes
- Agent Kit changes
- any next milestone

If the run exposes a defect requiring one of these, record it and stop.

## After the run

After the one live execution:

1. persist raw evidence and the human-readable report under the established `docs/research/` / `docs/research/evidence/` structure;
2. update `docs/handoffs/latest.md` with:
   - exact G1 verdict;
   - Mechanical fixture identity;
   - F1–F8 statuses;
   - evidence envelope;
   - residuals/blockers;
   - G2/G3/H1/H2/OQ-1/host remain unauthorized;
   - next authorized action: none / awaiting independent Work verification and owner decision;
3. do not modify harness or production code;
4. do not commit or push unless separately authorized.

## Stop gate

Stop immediately after evidence persistence and handoff update.

Do not:

- rerun live F1–F8;
- switch fixture;
- fix failures;
- start G2/G3;
- start H1/H2;
- start OQ-1;
- start host integration;
- modify Core/Adapter/M4/Panel production code;
- begin any next milestone.

The next gate is:

**independent ChatGPT Work verification of this one fresh Mechanical G1 execution → owner decision**

## Final report

Report:

- branch
- HEAD before and after
- working-tree state
- exact live command
- confirmation this was the only live attempt
- runtime versions
- Mechanical model / URN
- `env` / `api`
- `isOTG()` / `isSVF2()`
- F1–F8 results
- mandatory control results
- overall verdict
- warnings/residuals
- evidence artifact paths
- whether anything was committed or pushed

Explicitly confirm:

- no retry occurred;
- no fixture switch occurred after execution began;
- no production fix was made;
- G2/G3 were not started;
- H1/H2 were not started;
- OQ-1/host integration were not started;
- no Viewer Adapter/Core/M4/Panel production change was made.

Stop after the single fresh live Mechanical G1 execution evidence is recorded.
