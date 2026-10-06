# For Claude — Viewer Clash Panel Demo-Ready Checkpoint Commit + Push Only

I explicitly authorize **one scoped checkpoint commit and push** for the accepted Viewer Clash Panel demo-ready / product-facing package.

The latest independent Work visual/product review found:

- Critical: 0
- High: 0
- Medium: 0
- Low: 11 non-blocking
- visual evidence: `16 PASS / 0 FAIL / 0 INCONCLUSIVE`
- headed run:
  - `491` completed clashes
  - `394` cancelled partial clashes
- runtime:
  - `0` console errors
  - one expected Viewer deprecation warning
- offline suite:
  - `5,177 total`
  - `5,176 pass`
  - `0 fail`
  - `1 existing todo`
- DOM suite:
  - `83/83`
- readiness:
  **ready for demo/product-facing checkpoint**

This task is checkpoint-only.

It does **not** authorize:

- new G2 acceptance retry;
- new authorization record;
- attempt reset;
- acceptance-procedure changes;
- deep C8 causality research;
- G3/milestone transition;
- unrelated feature expansion.

Use the repository as the source of truth.

---

## 1. Verify authoritative baseline

Before staging, verify:

- repo: `aps-viewer-clash-detection`
- branch: `main`
- baseline HEAD:
  `eeb356dcf14f66afc62735724f134769c7d72e48`
- `main == origin/main`
- working tree contains only the reviewed demo-ready package/review/handoff changes
- historical G2 remains:
  `FAIL (row 3)`
- C6 remains:
  `NOT_EVIDENCED`
- C8 remains unresolved
- no G2 retry occurred
- no new authorization record exists
- no attempt reset occurred
- no acceptance-procedure change occurred

If baseline differs materially, stop and report.

---

## 2. Accepted product-facing state

Preserve these independently accepted conclusions:

### Visible/demo behavior
- Structure + Mechanical SVF2 flow works end to end.
- Full run produces `491` clashes.
- Cancelled run produces `394` partial clashes.
- Panel opens/closes reliably.
- Loading/progress works.
- Result list works.
- Selected-row highlight works.
- Filter works.
- Pager works.
- Empty state works.
- Cleared state works.
- Focus works.
- Isolate works.
- Markers work.
- Result switching works.
- Back to all works.
- Clear/close/reopen leave no stale markers or isolation.
- Default URL behavior remains unchanged.
- Lazy loading protects unrelated default-page features.
- Room Locator and Clash Finder remain unchanged.
- Console/runtime check has no errors aside from one expected Viewer deprecation warning.

### Visual evidence
- `16 PASS`
- `0 FAIL`
- `0 INCONCLUSIVE`

### Product adjudications
- Framing:
  acceptable for v1, even though Floor clashes/markers may appear small.
- Viewer selection:
  correctly excluded by governing spec §9.2.
- Cross-reload result persistence:
  non-blocking and deferred.
- Historical G2/C6/C8:
  separate verification debt; do not treat it as demo/product blocker.

Do not change these during checkpointing.

---

## 3. Inspect working tree

List all modified and untracked files.

Classify each before staging.

Expected in-scope categories:

### Demo-ready implementation/sample wiring
- product-facing implementation changes
- sample/demo integration
- toolbar/host/demo loader/static routes
- lazy-loading changes
- focused DOM/product-facing tests

### Evidence/research package
- `docs/research/2026-10-06-viewer-clash-panel-demo-ready/`
- snapshots/evidence
- demo-ready evidence report
- launch/demo instructions

### Reviews
- demo-ready internal review
- independent visual/product Work review

### Handoff
- `docs/handoffs/latest.md`

### Related prompts
- demo-ready Claude package prompt
- independent Work visual/product review prompt
- this checkpoint prompt, if present in the repo workspace

Do not stage unrelated historical artifacts.

---

## 4. Protected-scope verification

Before staging, confirm there are no unrelated changes to:

- G2 authorization records
- immutable historical evidence
- accepted G2 procedure
- D2 checkpoint
- diagnostic-instrumentation checkpoint
- future live-diagnostic design/preparation checkpoint
- unrelated source/tests/features
- Room Locator / Clash Finder behavior beyond any intentional lazy-loading isolation needed for this demo package

Also confirm:

- no G2 retry
- no new authorization record
- no attempt reset
- no G3 work
- no deep causality research changes

If any unexpected protected change exists, stop.

---

## 5. Final verification before staging

Run the relevant current verification.

### Offline suite
Expected:

- `5,177 total`
- `5,176 pass`
- `0 fail`
- `1 existing todo`

### DOM suite
Expected:

- `83/83`

### Headed product sanity
Do **not** re-run headed/browser validation unless needed because the reviewed evidence is stale or the working tree changed after Work review.

If no post-review implementation change occurred, verify retained evidence/package state rather than regenerating unnecessarily.

### Diff check
Run:

`git diff --check`

Expected:

clean.

---

## 6. Verify visual evidence package

Confirm the checkpoint includes the independently reviewed visual evidence:

- 16 accepted snapshots
- evidence report
- demo launch instructions
- visible-state matrix/review artifacts

Do not omit the evidence package while committing the implementation.

Confirm no screenshot marked FAIL/INCONCLUSIVE exists in the accepted set.

---

## 7. Preserve product decisions in handoff

Before commit, ensure `docs/handoffs/latest.md` clearly records:

- demo-ready package accepted for checkpoint
- `0 Critical / 0 High / 0 Medium`
- `11 Low` non-blocking
- visual review:
  `16 PASS / 0 FAIL / 0 INCONCLUSIVE`
- full-run:
  `491`
- stopped-run:
  `394`
- offline:
  `5,176 pass / 0 fail / 1 todo`
- DOM:
  `83/83`
- framing acceptable for v1
- Viewer selection excluded per spec §9.2
- reload persistence deferred
- default-page/lazy-load regression protection accepted
- historical G2/C6/C8 debt remains separate
- no owner screenshot review required
- next gate after checkpoint is product-facing continuation, not renewed G2 causality research

Do not put the future commit hash into the handoff before the commit exists.

---

## 8. Stage only reviewed artifacts

Stage only:

- reviewed demo-ready implementation/sample wiring
- focused tests
- demo evidence package
- internal review
- independent Work visual/product review
- related demo prompts
- latest handoff

Inspect staged file list and staged diff summary before committing.

Confirm:

- no unrelated artifact
- no authorization-state change
- no acceptance-procedure change
- no hidden G2 retry/live artifact
- no unrelated milestone work

Do not use broad staging if it risks pulling in unrelated files.

---

## 9. Commit

Create exactly **one scoped checkpoint commit**.

Suggested semantic intent:

`checkpoint Viewer Clash Panel demo-ready package`

Use repository convention for exact wording.

After commit verify:

- only intended implementation/tests/docs/evidence/reviews/prompts/handoff entered the commit;
- no unrelated protected artifact entered the commit.

Report full commit hash.

---

## 10. Push

Push that single commit to `origin/main`.

After push verify:

- `main == origin/main == <new commit>`
- ahead/behind `0/0`
- tracked tree clean
- no unexpected untracked durable artifacts
- historical G2/C6/C8 state unchanged
- no authorization-state change
- no acceptance-procedure change
- no G3 work

---

## 11. Working-tree cleanliness

Run:

`git status --short`

Target state:

**completely empty**

Do not intentionally leave durable Markdown/evidence/review artifacts untracked.

If anything remains, list it explicitly and explain why instead of silently ignoring it.

---

## 12. Prohibited

Do not:

- modify demo/product behavior during checkpointing;
- restart G2 causality research;
- run a new G2 acceptance attempt;
- issue/reset authorization records;
- alter acceptance procedure;
- add Viewer selection contrary to current spec;
- change framing policy;
- implement reload persistence;
- start G3;
- perform unrelated cleanup.

---

## 13. Stop gate

Stop immediately after:

- one checkpoint commit;
- one push;
- post-push verification;
- fully clean working tree.

Do not begin another work package in this task.

The next gate should be based on the now-visible product milestone, not historical G2 research.

---

## Final report

Report:

- new checkpoint commit hash;
- exact files committed;
- push result;
- final `main` / `origin/main` relation;
- offline-suite result;
- DOM-suite result;
- retained visual-evidence count/status;
- 491 full-run confirmation;
- 394 partial-run confirmation;
- final `git status --short`;
- confirmation no untracked durable artifacts remain;
- framing v1 decision preserved;
- Viewer-selection §9.2 decision preserved;
- reload-persistence deferment preserved;
- historical G2/C6/C8 debt unchanged;
- confirmation no retry/new record/reset/procedure change/G3 occurred;
- exact next product-facing gate.
