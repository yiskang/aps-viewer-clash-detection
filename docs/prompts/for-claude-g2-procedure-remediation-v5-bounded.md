# For Claude — G2 Procedure Remediation v5 Only

I explicitly authorize **one bounded documentation-only remediation** of the G2 ViewerBridge / DockingPanel live-verification procedure based on the latest independent Work v4 re-review.

This authorization is limited to:

- High — resolve the authoritative-verdict contradiction after an ambiguous `K` write;
- Medium — correct the N6 consistency row from `2^900` to the remediated `2^897` domain and include T24;
- Low — clarify R1 payload cutoffs;
- Low — make reservation-boundary terminology consistent;
- Low — remove stale v3 / Table-T2 naming.

It does **not** authorize:

- G2 harness implementation;
- live G2 execution;
- G3;
- H1/H2 host integration;
- OQ-1;
- production host composition;
- Core / Viewer Adapter / M4 / Viewer Clash Panel production changes;
- G1 F7 probe or calibration changes;
- commit or push unless separately authorized.

Use the latest independent Work v4 review as the governing remediation input.

## 1. High — Eliminate the `K` ambiguity / authoritative PASS contradiction

The current procedure still permits a state where:

- `K` appears durable enough for a later reader to derive PASS;
- the harness itself detects ambiguity/failure and exits 1;
- writing failure witness `F` and replacing the journal with `FAILED` both fail;
- stdout/O1 is non-authoritative and cannot resolve the conflict.

This is not acceptable.

Redesign terminal closeout so **no artifact combination can authorize PASS unless the harness has already crossed an unambiguous, durable PASS commit point**.

### Required invariant

> A reader may derive PASS only from a durable artifact/state that the harness writes **after** all required closeout verification has succeeded and from which no later harness-detected ambiguity can require FAIL.

`K` must not become PASS-authoritative before the harness itself knows that terminal completion is unambiguously successful.

### Correct the closeout protocol

Redesign the end of:

`R1 → R2 → R3 → terminal journal → K`

as needed.

Acceptable approaches include an explicit two-phase terminal protocol.

A valid pattern could be:

1. write/verify all required payload artifacts;
2. write a non-PASS terminal candidate / closeout-intent record;
3. verify every artifact needed for PASS;
4. atomically write one final **PASS commit record** only after all verification succeeds;
5. the reader returns PASS only if that final PASS commit record is valid and all referenced artifacts verify.

If `K` remains, define whether it is:

- verification evidence and **not** PASS-authoritative; or
- the final PASS commit record, written only after there can be no later local verification step that turns the run into FAIL.

### Mandatory properties

The corrected procedure must ensure:

- harness and reader cannot disagree PASS vs FAIL from the same durable artifact set;
- no optional stdout/O1 information is needed;
- any ambiguity before the PASS commit point yields FAIL/non-PASS;
- if writing the PASS commit record is ambiguous, the reader must not derive PASS;
- a crash at any pre-PASS point cannot create PASS;
- once the authoritative PASS record is durably committed, the harness performs no later operation whose failure changes the verdict to FAIL;
- reader precedence remains total and fail-safe.

Add an explicit state/artifact truth table covering at least:

- R1/R2/R3 valid, no terminal commit;
- closeout candidate valid, no PASS commit;
- PASS commit write failed;
- PASS commit verification ambiguous;
- PASS commit valid;
- malformed/conflicting PASS commit;
- crash before PASS commit;
- crash after PASS commit.

For each row state exactly what the reader returns.

### D2 implication

D2 remains **not owner-ready** until this contradiction is independently re-reviewed and found closed.

Do not waive this as a low-probability failure combination.

## 2. Medium — Correct N6 consistency-table domain and T24

The N6 consistency row must match the already-remediated N6 contract.

Correct it so that:

- supported N6 input domain is `2^897`, not `2^900`;
- the row references T24 where applicable;
- just-in-range and out-of-range behavior matches the actual N6 procedure;
- non-finite and out-of-domain inputs cannot count as `N6 DETECTED`;
- consistency row, C4/N6 text, boundary tests, and threshold table all use the same domain.

Search for all remaining `2^900` N6-domain references and remove/update them unless they refer to a different, explicitly named mathematical bound.

## 3. Low — Clarify R1 payload cutoffs

Make R1's inclusion cutoff explicit and mechanically testable.

Define:

- exact event/state after which no additional evidence fields may be added to R1;
- which facts are allowed in R1;
- which closeout facts belong only to R2/R3/later terminal records;
- how the harness rejects or flags a late mutation of R1.

R1 must remain immutable once hashed/referenced downstream.

## 4. Low — Normalize reservation-boundary terminology

Use one consistent set of terms for:

- reservation creation/binding;
- `AUTH_BOUND`;
- attempt consumption;
- `ATTEMPT_CONSUMED`;
- first external/live Viewer action.

Remove wording that implies a different boundary elsewhere.

Add one canonical sequence and cross-reference it rather than redefining boundaries in multiple places.

## 5. Low — Remove stale v3 / Table-T2 naming

Remove stale references to:

- procedure v3;
- superseded `Table T2` naming where the current procedure uses another canonical name;
- obsolete section/table identifiers.

Run a stale-reference grep after editing and report the result.

Do not change semantics while cleaning names.

## 6. Preserve independently closed areas

Do not reopen unless this remediation directly reveals a contradiction:

- H1 attempts-directory/reservation durability is technically closed;
- H3/C20 overlay-rendering oracle is technically closed;
- C20 missing/ambiguous rendering => `NOT_EVIDENCED`;
- overall G2 is capped at `PARTIAL` until C20 positively passes;
- N6 construction itself is technically closed;
- repetition/retake rules are closed;
- C7/C18 ownership is closed;
- C4 containment is closed;
- C17 V0–V7/N7 is closed;
- model-A/model-B cleanup is closed;
- C2 title lookup is closed;
- D3 and D5 are technical and confirmed;
- D6 is deferred/non-blocking.

## 7. Owner-decision status

Do not silently approve owner decisions.

Preserve:

- **D1** — owner/operational: Mechanical + Structure;
- **D2** — owner acceptance policy: blocked until this closeout contradiction is fixed and independently re-reviewed;
- **D3** — technical, confirmed;
- **D4** — owner execution-risk decision: bounded real-Viewer failure injection;
- **D5** — technical, confirmed;
- **D6** — deferred/non-blocking;
- **D7** — technically ready for owner acceptance within the bounded evidence envelope.

## 8. Internal review

After editing:

1. Run one targeted internal review only over:
   - authoritative PASS-commit / terminal-closeout protocol;
   - reader/harness agreement;
   - N6 `2^897` + T24 consistency;
   - R1 payload cutoff;
   - reservation-boundary terminology;
   - stale naming cleanup.
2. Fix genuine Critical/High findings within this bounded scope.
3. Do not implement the G2 harness.
4. Persist the remediation internal review under `docs/reviews/`.
5. Update `docs/handoffs/latest.md`.

The handoff must state:

- G2 procedure remediation v5 complete;
- D2 remains pending independent confirmation unless the re-review closes it;
- harness implementation remains unauthorized;
- live G2 remains unauthorized;
- G3/H1/H2/OQ-1/host remain unauthorized;
- next action = bounded independent Work re-review, then owner decisions D1/D2/D4/D7.

## Stop gate

Stop after documentation remediation and targeted internal review.

Do not:

- implement `test/acceptance/clashpanel-viewerbridge.acceptance.mjs`;
- run G2;
- start G3/H1/H2/OQ-1/host integration;
- modify production code;
- commit or push unless separately authorized.

## Final report

Report:

- branch / HEAD / git status;
- exact sections changed;
- authoritative PASS-commit redesign;
- reader/harness verdict agreement;
- corrected N6 `2^897` / T24 consistency;
- R1 payload cutoff rule;
- normalized reservation-boundary terminology;
- stale-reference cleanup result;
- internal review findings/fixes;
- remaining D1/D2/D4/D7 owner decisions;
- explicit confirmation that no harness code or live execution occurred.
