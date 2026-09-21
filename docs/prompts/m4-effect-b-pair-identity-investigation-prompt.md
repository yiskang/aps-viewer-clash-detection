# Prompt — M4 Effect B Pair-Identity Investigation

Open a **fresh Claude session**.

This is a **narrow, read-only investigation**.

Do **not** modify source.
Do **not** commit.
Do **not** relax §6.4.
Do **not** change M4 verdict semantics.
Do **not** run the full M2/M3 gates or the full M4 canonical matrix yet.

## Context

A 20-run pre-fix baseline revealed two distinct effects:

- **Effect A**: timing-tied `crossing-budget-exhausted` variation caused by the known ~8 ms wall-clock semantic abort in `ProperCrossingQuery`. Phase C is intended to remove this.
- **Effect B**: a larger oscillation in `inconclusive-crossing + crossing-budget-exhausted` totals (roughly `85 ↔ 121`) that remains even on warm runs and is not explained by aggregate `wallMs`.

The immediate unanswered question is:

> Are the same fragment pairs producing these diagnostics every run, or are different pairs entering/leaving/changing semantic disposition?

This must be answered before running the expensive M2/M3/full canonical matrix again.

Write the full report directly to:

`docs/research/m4-effect-b-precheck-diagnostic-nondeterminism-investigation.md`

Do not make me manually copy findings between sessions.

---

## Goal

Determine whether Effect B is:

1. diagnostic-only nondeterminism with stable semantic results;
2. semantic precheck nondeterminism;
3. accounting-only drift;
4. candidate-order / predecessor dependence;
5. hidden local timing dependence;
6. shared mutable state;
7. cache-state dependence;
8. or insufficiently evidenced.

---

## Step 1 — Reproduce Effect B with pair identity retained

Run enough identical-condition repetitions to reproduce the oscillation.

Prefer 20 runs; minimum 10 if runtime is excessive.

For every relevant pair, retain at least:

- `sourceFragmentId`
- `targetFragmentId`
- diagnostic reason
- `conclusive`
- precheck disposition (`excluded`, `proceed`, `inconclusive`, `skip-precheck`)
- `inconclusiveCauses`
- whether it contributes to `clearanceHardClashExclusions`
- candidate index/order if already observable
- local precheck/crossing timing if already observable
- deterministic operation counters if already observable

Do not add instrumentation yet.

If existing telemetry cannot retain the required pair identity, stop and report exactly what is missing.

---

## Step 2 — Compare exact pair sets across runs

For every run derive exact sets for:

- `crossing-budget-exhausted`
- `inconclusive-crossing`
- union of both
- Hard-Clash excluded pairs
- final clearance-result pairs

Compare pair identities, not only totals.

Report:

- pairs stable in every run
- pairs entering/leaving diagnostic sets
- pairs changing diagnostic reason
- pairs changing semantic disposition
- pairs changing final clearance outcome

The key discriminator is:

> Are `1762 / 1784`-style totals caused by label/count drift only, or by actual pair-level semantic changes?

---

## Step 3 — Classify every unstable pair

For every pair whose diagnostic classification changes, assign exactly one:

- **A — diagnostic-only**: semantic disposition and final result stable
- **B — semantic precheck drift, final result stable**
- **C — semantic precheck drift, final result changed**
- **D — accounting-only**
- **E — insufficient evidence**

Do not infer “diagnostic-only” from stable aggregate distances/witnesses.

Pair-level semantic disposition must be shown stable.

---

## Step 4 — Investigate only what the unstable pairs justify

For unstable pairs only, check as needed:

### Candidate/order dependence
Compare:

- candidate position
- predecessor pair
- arm order
- work performed before the pair

### Local timing dependence
Compare local:

- ProperCrossingQuery span
- containment spans
- threshold-crossing state
- elapsed time at decision

Do not use full-run `wallMs` alone.

### Shared mutable state
Audit for:

- module-level scratch objects
- reused arrays/maps/sets
- counters not reset per call
- mutable query objects reused across pairs
- cached traversal state

### Cache-state dependence
Compare cold/warm/fresh-world behavior only if pair evidence points there.

Do not broaden the investigation beyond what the pair-level evidence requires.

---

## Step 5 — Determine M4 impact

Choose exactly one disposition:

- `DIAGNOSTIC_ONLY_NONDETERMINISM`
- `SEMANTIC_PRECHECK_NONDETERMINISM`
- `ACCOUNTING_ONLY_NONDETERMINISM`
- `INSUFFICIENT_EVIDENCE`

For the chosen disposition state:

- whether §6.4 should remain strict;
- whether Phase C focused validation may proceed;
- whether M2/M3/full canonical reruns remain blocked;
- whether a fix is required before M4 can continue;
- whether the existing timing-diagnostic carve-out is relevant.

Important:

- Do **not** widen the carve-out if semantic disposition changes.
- Do **not** treat “pre-existing” as permission to ignore it.

---

## Output

Write:

`docs/research/m4-effect-b-precheck-diagnostic-nondeterminism-investigation.md`

Do not edit source.
Do not commit.
Do not run Phase 4.
Do not run M2/M3/full canonical gates.

Return only a concise summary with:

- disposition
- whether pair identities are stable or unstable
- whether semantic disposition changes
- likely mechanism, if established
- whether M4 remains blocked
- report path
